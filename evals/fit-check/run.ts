// Fit-check eval runner: `pnpm eval:fit-check [--model <slug>] [--runs <n>] [--case <id>]`, and
// `pnpm eval:fit-check --alternatives` for the stage A vs. stage B comparison of the alternatives.
// Makes live model calls, which cost money. Nothing in `pnpm test` runs this file.
import { createClient, type Client } from '@libsql/client';
import { OpenRouter } from '@openrouter/sdk';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DEFAULT_FIT_CHECK_MODEL } from '../../src/lib/server/ai/fit-check';
import { PROMPT_VERSION } from '../../src/lib/server/ai/fit-check-prompt';
import { RERANK_SHORTLIST_SIZE } from '../../src/lib/server/ai/rerank-alternatives';
import { RERANK_PROMPT_VERSION } from '../../src/lib/server/ai/rerank-prompt';
import { runMigrations } from '../../src/lib/server/migrate';
import { getAlternatives } from '../../src/lib/server/queries/alternatives';
import { findSpeciesByName } from '../../src/lib/server/queries/catalog';
import {
  buildHomeProfile,
  addAlternativesToResults,
  buildResultsFile,
  executeAlternatives,
  executeCases,
  failingCases,
  formatAlternativesReport,
  formatReport,
  parseCases,
  parseEvalArgs,
  summarize,
  summarizeAlternatives,
  type EvalArgs,
  type EvalCase,
  type PreparedAlternatives,
  type PreparedCase,
  type ResultsFile,
  type Prices,
} from './score';

const CONCURRENCY = 4;

// $ per 1M tokens (Anthropic list price; check the OpenRouter model page before trusting it).
// A model that isn't listed has its cost printed as n/a.
const PRICES: Prices = {
  'anthropic/claude-haiku-4.5': { input: 1, output: 5 },
};

const casesPath = join(import.meta.dirname, 'cases.json');
const resultsDir = join(import.meta.dirname, 'results');
const seedPath = join(import.meta.dirname, '../../scripts/catalog-seed-data.json');

// Every plant_species column the runner writes, in INSERT order. aliases, source, source_url and
// reviewed_at are filled in speciesArgs; the rest are copied from the seed JSON by name.
const SPECIES_COLUMNS = [
  'scientific_name',
  'common_name',
  'aliases',
  'watering_interval_days',
  'drought_tolerance',
  'care_level',
  'light_needs',
  'toxic_to_cats',
  'toxic_to_dogs',
  'toxicity_notes',
  'growth_habit',
  'leaf_size',
  'leaf_shape',
  'variegated',
  'care_tips',
  'source',
  'source_url',
  'reviewed_at',
] as const;

type SeedRow = Record<string, unknown>;

const speciesArgs = (row: SeedRow, today: string) =>
  SPECIES_COLUMNS.map((column) => {
    switch (column) {
      case 'aliases':
        return JSON.stringify(row.aliases ?? []);
      case 'source':
        return 'seed';
      case 'source_url':
        return null;
      case 'reviewed_at':
        return today;
      default:
        return (row[column] ?? null) as string | number | null;
    }
  });

const readJson = async (path: string): Promise<unknown> => JSON.parse(await readFile(path, 'utf8'));

// scripts/seed-catalog.ts connects to Turso on import, so it can't be reused here.
const loadCatalog = async (db: Client) => {
  const rows = (await readJson(seedPath)) as SeedRow[];
  // A seed column the INSERT doesn't know about would be dropped silently otherwise.
  const known = new Set<string>(SPECIES_COLUMNS);
  const unknown = new Set(rows.flatMap((r) => Object.keys(r)).filter((k) => !known.has(k)));
  if (unknown.size) {
    throw new Error(
      `seed JSON has columns the eval insert doesn't cover: ${[...unknown].join(', ')}`
    );
  }
  const today = new Date().toISOString().slice(0, 10);
  const sql = `INSERT INTO plant_species (${SPECIES_COLUMNS.join(', ')})
    VALUES (${SPECIES_COLUMNS.map(() => '?').join(', ')})`;
  await db.batch(
    rows.map((row) => ({ sql, args: speciesArgs(row, today) })),
    'write'
  );
  const { rows: counted } = await db.execute('SELECT COUNT(*) AS n FROM plant_species');
  const inserted = Number(counted[0].n);
  if (inserted === 0) throw new Error('no catalog rows were inserted');
  return inserted;
};

// Resolves the candidate and owned names with the real catalog lookup, and checks that the case
// file's expected_data_source agrees with what the catalog says.
const prepareCase = async (db: Client, c: EvalCase): Promise<PreparedCase> => {
  const species = await findSpeciesByName(db, c.candidate);
  const actual = species ? 'catalog' : 'model_knowledge';
  if (actual !== c.expected_data_source) {
    throw new Error(
      `case ${c.id}: "${c.candidate}" resolves to ${actual} but the case expects ${c.expected_data_source}`
    );
  }
  const ownedPlants = await Promise.all(
    c.owned.map(async (name) => ({ name, species: await findSpeciesByName(db, name) }))
  );
  return {
    case: c,
    homeProfile: buildHomeProfile(c),
    ownedPlants,
    candidate: species ?? c.candidate,
  };
};

const resultsPath = (model: string) =>
  join(resultsDir, `${new Date().toISOString().slice(0, 10)}-${model.replaceAll('/', '_')}.json`);

// The fit-check part of the eval: every case, `runs` times, scored and written to the results file.
const runFitCheckEval = async (
  args: EvalArgs,
  client: OpenRouter,
  cases: EvalCase[],
  prepared: PreparedCase[]
) => {
  console.log(
    `Running ${cases.length} case(s) x ${args.runs} run(s) on ${args.model} (prompt ${PROMPT_VERSION})...`
  );
  const results = await executeCases({
    client,
    model: args.model,
    cases: prepared,
    runs: args.runs,
    concurrency: CONCURRENCY,
    prices: PRICES,
  });

  const summary = summarize(results.flatMap((r) => r.runs));
  console.log(`\n${formatReport(args.model, summary, failingCases(cases, results))}`);

  // A single-case run would overwrite the committed full-run results for the same day and model.
  if (args.caseId) {
    console.log('\n--case run: results file not written.');
    return;
  }
  const file = resultsPath(args.model);
  await mkdir(resultsDir, { recursive: true });
  // Keep an alternatives comparison already in today's file (see buildResultsFile).
  const previous = (await readJson(file).catch(() => null)) as Partial<ResultsFile> | null;
  const body = buildResultsFile(
    { model: args.model, prompt_version: PROMPT_VERSION, runs: args.runs, summary, cases: results },
    previous
  );
  await writeFile(file, `${JSON.stringify(body, null, 2)}\n`);
  console.log(
    `\nWrote ${file}${body.alternatives !== undefined ? ' (kept the alternatives comparison from the file it replaced)' : ''}`
  );
};

// The alternatives part: stage A against stage B for every case with a catalog candidate. It does
// not repeat the fit-check calls; it adds an `alternatives` key (and the re-rank prompt version)
// to today's results file for this model, so that file has to exist already.
const runAlternativesEval = async (
  args: EvalArgs,
  db: Client,
  client: OpenRouter,
  prepared: PreparedCase[]
) => {
  const file = resultsPath(args.model);
  let existing: Record<string, unknown> | null = null;
  if (!args.caseId) {
    try {
      existing = (await readJson(file)) as Record<string, unknown>;
    } catch {
      throw new Error(
        `${file} not found or unreadable. Run \`pnpm eval:fit-check\` first today, then add the alternatives to it.`
      );
    }
  }

  const items: PreparedAlternatives[] = [];
  const skipped: string[] = [];
  for (const p of prepared) {
    if (typeof p.candidate === 'string') {
      skipped.push(p.case.id);
      continue;
    }
    const shortlist = await getAlternatives({
      db,
      homeProfile: p.homeProfile,
      candidate: p.candidate,
      excludeSpeciesIds: p.ownedPlants.flatMap((o) => (o.species ? [o.species.id] : [])),
      limit: RERANK_SHORTLIST_SIZE,
    });
    items.push({ prepared: { ...p, candidate: p.candidate }, shortlist });
  }
  if (!items.length) throw new Error('no selected case has a candidate in the catalog');

  console.log(
    `Comparing alternatives for ${items.length} case(s) x ${args.runs} run(s) on ${args.model} (re-rank prompt ${RERANK_PROMPT_VERSION})...`
  );
  const results = await executeAlternatives({
    client,
    model: args.model,
    items,
    runs: args.runs,
    concurrency: CONCURRENCY,
    prices: PRICES,
  });
  const summary = summarizeAlternatives(results.flatMap((r) => r.runs));
  console.log(`\n${formatAlternativesReport(args.model, summary, skipped)}`);

  if (!existing) {
    console.log('\n--case run: results file not written.');
    return;
  }
  const body = addAlternativesToResults(existing, RERANK_PROMPT_VERSION, {
    runs: args.runs,
    summary,
    cases: results,
    skipped_cases: skipped,
  });
  await writeFile(file, `${JSON.stringify(body, null, 2)}\n`);
  console.log(`\nAdded the alternatives comparison to ${file}`);
};

const main = async () => {
  const args = parseEvalArgs(process.argv.slice(2), DEFAULT_FIT_CHECK_MODEL);

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY is not set (run through `pnpm eval:fit-check`)');
  }

  let cases = parseCases(await readJson(casesPath));
  if (args.caseId) {
    cases = cases.filter((c) => c.id === args.caseId);
    if (!cases.length) throw new Error(`no case with id "${args.caseId}"`);
  }

  const db = createClient({ url: ':memory:' });
  await runMigrations(db);
  const catalogRows = await loadCatalog(db);
  console.log(`Catalog: ${catalogRows} rows.`);
  const prepared = await Promise.all(cases.map((c) => prepareCase(db, c)));

  const client = new OpenRouter({ apiKey });
  if (args.alternatives) {
    await runAlternativesEval(args, db, client, prepared);
  } else {
    await runFitCheckEval(args, client, cases, prepared);
  }
};

// Exit 0 after a completed run whatever the scores; non-zero only for setup errors.
main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
