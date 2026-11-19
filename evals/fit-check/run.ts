// Fit-check eval runner: `pnpm eval:fit-check [--model <slug>] [--runs <n>] [--case <id>]`.
// Makes live model calls, which cost money. Nothing in `pnpm test` runs this file.
import { createClient, type Client } from '@libsql/client';
import { OpenRouter } from '@openrouter/sdk';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DEFAULT_FIT_CHECK_MODEL } from '../../src/lib/server/ai/fit-check';
import { PROMPT_VERSION } from '../../src/lib/server/ai/fit-check-prompt';
import { runMigrations } from '../../src/lib/server/migrate';
import { findSpeciesByName } from '../../src/lib/server/queries/catalog';
import {
  buildHomeProfile,
  executeCases,
  failingCases,
  formatReport,
  parseCases,
  parseEvalArgs,
  summarize,
  type EvalCase,
  type PreparedCase,
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
  const prepared = await Promise.all(cases.map((c) => prepareCase(db, c)));

  console.log(
    `Running ${cases.length} case(s) x ${args.runs} run(s) on ${args.model} (${catalogRows} catalog rows, prompt ${PROMPT_VERSION})...`
  );
  const client = new OpenRouter({ apiKey });
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
  const date = new Date().toISOString().slice(0, 10);
  const file = join(resultsDir, `${date}-${args.model.replaceAll('/', '_')}.json`);
  await mkdir(resultsDir, { recursive: true });
  await writeFile(
    file,
    `${JSON.stringify({ model: args.model, prompt_version: PROMPT_VERSION, runs: args.runs, summary, cases: results }, null, 2)}\n`
  );
  console.log(`\nWrote ${file}`);
};

// Exit 0 after a completed run whatever the scores; non-zero only for setup errors.
main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
