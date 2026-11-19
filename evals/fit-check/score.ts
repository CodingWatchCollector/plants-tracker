// Pure parts of the fit-check eval: case parsing, scoring, aggregation, and running cases against
// a client. No DB, no env, no file access, so `pnpm test` covers it with a mocked client.
// Only relative value imports: the eval runs under tsx, which doesn't resolve SvelteKit aliases.
import type { OpenRouter } from '@openrouter/sdk';
import { parseArgs } from 'node:util';
import z from 'zod';
import {
  evaluateFitCheck,
  warnsAbout,
  type FitCheckFailure,
  type FitCheckOutcome,
  type WarningSubject,
} from '../../src/lib/server/ai/fit-check';
import type { FitCheckVerdict, HomeProfile, OwnedPlant, PlantSpecies } from '../../src/lib/types';

const verdictSchema = z.enum(['good_fit', 'caution', 'poor_fit']);

export const evalCaseSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'id must be kebab-case'),
    description: z.string().min(1),
    profile: z
      .object({
        has_cats: z.boolean(),
        has_dogs: z.boolean(),
        has_small_kids: z.boolean(),
        care_commitment: z.enum(['low', 'medium', 'high']),
        typical_light: z.enum(['low', 'medium', 'bright']),
        travels_often: z.boolean(),
        notes: z.string(),
      })
      .strict(),
    owned: z.array(z.string()),
    candidate: z.string().min(1),
    // An array means any of these passes.
    expected_verdict: z.union([verdictSchema, z.array(verdictSchema).min(1)]),
    required_warnings: z.array(z.enum(['cats', 'dogs', 'kids'])),
    expected_data_source: z.enum(['catalog', 'model_knowledge']),
  })
  .strict();

export type EvalCase = z.infer<typeof evalCaseSchema>;

// Throws on a bad shape or a repeated id, so a typo in cases.json stops the run before any spend.
export const parseCases = (json: unknown): EvalCase[] => {
  const cases = z.array(evalCaseSchema).min(1).parse(json);
  const seen = new Set<string>();
  for (const c of cases) {
    if (seen.has(c.id)) throw new Error(`duplicate case id: ${c.id}`);
    seen.add(c.id);
  }
  return cases;
};

export const buildHomeProfile = (c: EvalCase): HomeProfile => ({
  home_id: 0,
  ...c.profile,
  updated_at: null,
});

export const expectedVerdicts = (c: EvalCase): FitCheckVerdict[] =>
  Array.isArray(c.expected_verdict) ? c.expected_verdict : [c.expected_verdict];

// $ per 1M tokens.
export type Prices = Record<string, { input: number; output: number }>;

export const runCost = (
  prices: Prices,
  model: string,
  inputTokens: number | null,
  outputTokens: number | null
): number | null => {
  const price = prices[model];
  if (!price || inputTokens === null || outputTokens === null) return null;
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
};

export type RunScore = {
  schema_ok: boolean;
  failure: FitCheckFailure | null;
  detail: string | null;
  verdict: FitCheckVerdict | null; // after the guardrail
  raw_verdict: FitCheckVerdict | null; // as the model returned it
  warnings: string[]; // after the guardrail
  verdict_ok: boolean;
  warnings_ok_final: boolean;
  warnings_ok_raw: boolean;
  guardrail_fired: boolean;
  input_tokens: number | null;
  output_tokens: number | null;
  latency_ms: number | null;
  cost: number | null;
};

const warningsOk = (required: WarningSubject[], warnings: string[]) =>
  required.every((subject) => warnsAbout(warnings, subject));

// A failed run (no usable answer) fails schema, verdict and both warning checks.
export const scoreRun = (
  c: EvalCase,
  outcome: FitCheckOutcome,
  model: string,
  prices: Prices
): RunScore => {
  const usage = outcome.usage;
  const inputTokens = usage?.inputTokens ?? null;
  const outputTokens = usage?.outputTokens ?? null;
  const common = {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    latency_ms: usage?.latencyMs ?? null,
    cost: runCost(prices, model, inputTokens, outputTokens),
  };
  if (!outcome.ok) {
    return {
      schema_ok: false,
      failure: outcome.failure,
      detail: outcome.detail,
      verdict: null,
      raw_verdict: null,
      warnings: [],
      verdict_ok: false,
      warnings_ok_final: false,
      warnings_ok_raw: false,
      guardrail_fired: false,
      ...common,
    };
  }
  return {
    schema_ok: true,
    failure: null,
    detail: null,
    verdict: outcome.response.verdict,
    raw_verdict: outcome.rawResponse.verdict,
    warnings: outcome.response.warnings,
    verdict_ok: expectedVerdicts(c).includes(outcome.response.verdict),
    warnings_ok_final: warningsOk(c.required_warnings, outcome.response.warnings),
    warnings_ok_raw: warningsOk(c.required_warnings, outcome.rawResponse.warnings),
    guardrail_fired: outcome.guardrailFired,
    ...common,
  };
};

// Nearest-rank percentile; null for no values.
export const percentile = (values: number[], p: number): number | null => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1];
};

const average = (values: (number | null)[]): number | null => {
  const present = values.filter((v): v is number => v !== null);
  return present.length ? present.reduce((a, b) => a + b, 0) / present.length : null;
};

export type Summary = {
  runs: number;
  schema_pass_rate: number;
  verdict_pass_rate: number;
  warnings_final_pass_rate: number;
  warnings_raw_pass_rate: number;
  guardrail_fire_rate: number;
  failures: Partial<Record<FitCheckFailure, number>>;
  avg_input_tokens: number | null;
  avg_output_tokens: number | null;
  avg_cost: number | null;
  latency_p50_ms: number | null;
  latency_p95_ms: number | null;
};

// Every rate uses all runs as the denominator, failed runs included.
export const summarize = (runs: RunScore[]): Summary => {
  const rate = (pass: (r: RunScore) => boolean) =>
    runs.length ? runs.filter(pass).length / runs.length : 0;
  const failures: Summary['failures'] = {};
  for (const r of runs) if (r.failure) failures[r.failure] = (failures[r.failure] ?? 0) + 1;
  const latencies = runs.map((r) => r.latency_ms).filter((v): v is number => v !== null);
  return {
    runs: runs.length,
    schema_pass_rate: rate((r) => r.schema_ok),
    verdict_pass_rate: rate((r) => r.verdict_ok),
    warnings_final_pass_rate: rate((r) => r.warnings_ok_final),
    warnings_raw_pass_rate: rate((r) => r.warnings_ok_raw),
    guardrail_fire_rate: rate((r) => r.guardrail_fired),
    failures,
    avg_input_tokens: average(runs.map((r) => r.input_tokens)),
    avg_output_tokens: average(runs.map((r) => r.output_tokens)),
    avg_cost: average(runs.map((r) => r.cost)),
    latency_p50_ms: percentile(latencies, 50),
    latency_p95_ms: percentile(latencies, 95),
  };
};

export type CaseResult = { id: string; runs: RunScore[] };

// A run fails when the answer is unusable, the verdict is wrong or a required warning is missing
// from the final response. A missing raw warning isn't a failure: the guardrail covers it, and it
// shows up in warnings_raw_pass_rate.
export const runFailed = (r: RunScore) => !(r.schema_ok && r.verdict_ok && r.warnings_ok_final);

export const failingCases = (cases: EvalCase[], results: CaseResult[]) =>
  results
    .filter((res) => res.runs.some(runFailed))
    .map((res) => {
      const c = cases.find((x) => x.id === res.id)!;
      return {
        id: res.id,
        expected: expectedVerdicts(c),
        required_warnings: c.required_warnings,
        got: res.runs.map((r) => r.verdict ?? r.failure ?? 'unknown'),
        failed_runs: res.runs.filter(runFailed).length,
        runs: res.runs.length,
      };
    });

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const num = (x: number | null, digits = 0) => (x === null ? 'n/a' : x.toFixed(digits));

export const formatReport = (
  model: string,
  s: Summary,
  failing: ReturnType<typeof failingCases>
) => {
  const rows: [string, string][] = [
    ['model', model],
    ['runs', String(s.runs)],
    ['schema pass rate', pct(s.schema_pass_rate)],
    ['verdict pass rate', pct(s.verdict_pass_rate)],
    ['warnings pass rate (final)', pct(s.warnings_final_pass_rate)],
    ['warnings pass rate (raw)', pct(s.warnings_raw_pass_rate)],
    ['guardrail fire rate', pct(s.guardrail_fire_rate)],
    ['avg input tokens', num(s.avg_input_tokens)],
    ['avg output tokens', num(s.avg_output_tokens)],
    ['avg cost per check', s.avg_cost === null ? 'n/a' : `$${s.avg_cost.toFixed(5)}`],
    ['latency p50 / p95 (ms)', `${num(s.latency_p50_ms)} / ${num(s.latency_p95_ms)}`],
  ];
  if (Object.keys(s.failures).length) {
    rows.push(['failures by type', JSON.stringify(s.failures)]);
  }
  const width = Math.max(...rows.map(([k]) => k.length));
  const lines = rows.map(([k, v]) => `${k.padEnd(width)}  ${v}`);
  if (failing.length) {
    lines.push('', 'Failing cases:');
    for (const f of failing) {
      const warn = f.required_warnings.length
        ? `; needs warnings: ${f.required_warnings.join(', ')}`
        : '';
      lines.push(
        `  ${f.id}: expected ${f.expected.join(' | ')}${warn}; got ${f.got.join(', ')} (${f.failed_runs}/${f.runs} runs failed)`
      );
    }
  } else {
    lines.push('', 'No failing cases.');
  }
  return lines.join('\n');
};

// Runs fn over the items with at most `concurrency` in flight. Results keep the item order.
export const runPool = async <T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> => {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
};

// A case with its names already resolved against the catalog.
export type PreparedCase = {
  case: EvalCase;
  homeProfile: HomeProfile;
  ownedPlants: OwnedPlant[];
  candidate: PlantSpecies | string;
};

type ExecuteCasesProps = {
  client: OpenRouter;
  model: string;
  cases: PreparedCase[];
  runs: number;
  concurrency: number;
  prices: Prices;
};

export const executeCases = async ({
  client,
  model,
  cases,
  runs,
  concurrency,
  prices,
}: ExecuteCasesProps): Promise<CaseResult[]> => {
  const jobs = cases.flatMap((prepared) => Array.from({ length: runs }, () => prepared));
  const scores = await runPool(jobs, concurrency, async (p) => {
    const outcome = await evaluateFitCheck({
      client,
      model,
      homeProfile: p.homeProfile,
      ownedPlants: p.ownedPlants,
      candidate: p.candidate,
    });
    return scoreRun(p.case, outcome, model, prices);
  });
  return cases.map((p, i) => ({
    id: p.case.id,
    runs: scores.slice(i * runs, (i + 1) * runs),
  }));
};

export type EvalArgs = { model: string; runs: number; caseId: string | null };

// Throws on an unknown flag (--alternatives arrives with step 19) or a bad value.
export const parseEvalArgs = (argv: string[], defaultModel: string): EvalArgs => {
  const { values } = parseArgs({
    args: argv,
    options: {
      model: { type: 'string' },
      runs: { type: 'string' },
      case: { type: 'string' },
    },
    strict: true,
  });
  const runs = values.runs === undefined ? 3 : Number(values.runs);
  if (!Number.isInteger(runs) || runs < 1) {
    throw new Error(`--runs must be a positive integer, got "${values.runs}"`);
  }
  return { model: values.model ?? defaultModel, runs, caseId: values.case ?? null };
};
