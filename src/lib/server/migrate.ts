import type { Client } from '@libsql/client';

interface Migration {
  version: number;
  statements: string[];
}

const migrations: Migration[] = [
  {
    version: 1,
    statements: [
      `CREATE TABLE IF NOT EXISTS _migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
    ],
  },
  {
    // Baseline: home/plants/push_subscriptions were created outside the migration
    // system, so this reproduces the production schema. No-op there; on a fresh
    // local DB it recreates the real schema so later migrations can be tested.
    version: 2,
    statements: [
      `CREATE TABLE IF NOT EXISTS home (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT,
        join_token TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
      `CREATE TABLE IF NOT EXISTS plants (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        home_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        nickname TEXT,
        room TEXT,
        image_url TEXT,
        watering_interval_days INTEGER NOT NULL DEFAULT 7,
        last_watered_at TEXT,
        next_watering_date TEXT NOT NULL,
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        CONSTRAINT fk_plants_home_id_home_id_fk FOREIGN KEY (home_id) REFERENCES home(id) ON DELETE CASCADE
      )`,
      `CREATE TABLE IF NOT EXISTS push_subscriptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        home_id INTEGER NOT NULL,
        endpoint TEXT NOT NULL,
        p256dh_key TEXT NOT NULL,
        auth_key TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        CONSTRAINT fk_push_subscriptions_home_id_home_id_fk FOREIGN KEY (home_id) REFERENCES home(id) ON DELETE CASCADE
      )`,
      `CREATE INDEX IF NOT EXISTS idx_plants_next_watering ON plants(next_watering_date)`,
      `CREATE INDEX IF NOT EXISTS idx_plants_home_id ON plants(home_id)`,
      `CREATE INDEX IF NOT EXISTS idx_push_home_id ON push_subscriptions(home_id)`,
    ],
  },
  {
    version: 3,
    statements: [
      // Plant catalog. Named plant_species with a superset of the parked spec's
      // columns so the roadmap's "Plant Intelligence" can reuse it instead of
      // adding a second table.
      `CREATE TABLE plant_species (
        id                     INTEGER PRIMARY KEY AUTOINCREMENT,
        scientific_name        TEXT NOT NULL UNIQUE,
        common_name            TEXT NOT NULL,
        aliases                TEXT NOT NULL DEFAULT '[]',
        watering_interval_days INTEGER NOT NULL,
        drought_tolerance      TEXT NOT NULL CHECK (drought_tolerance IN ('low','medium','high')),
        care_level             TEXT NOT NULL CHECK (care_level IN ('low','medium','high')),
        light_needs            TEXT NOT NULL CHECK (light_needs IN ('low','medium','bright')),
        toxic_to_cats          INTEGER NOT NULL,
        toxic_to_dogs          INTEGER NOT NULL,
        toxicity_notes         TEXT,
        growth_habit           TEXT NOT NULL CHECK (growth_habit IN ('trailing','upright','tree','rosette','climbing')),
        leaf_size              TEXT NOT NULL CHECK (leaf_size IN ('small','medium','large')),
        leaf_shape             TEXT NOT NULL,
        variegated             INTEGER NOT NULL DEFAULT 0,
        care_tips              TEXT,
        source                 TEXT NOT NULL DEFAULT 'seed',
        source_url             TEXT,
        reviewed_at            TEXT NOT NULL
      )`,
      // Household profile, one row per home.
      `CREATE TABLE home_profile (
        home_id          INTEGER PRIMARY KEY REFERENCES home(id) ON DELETE CASCADE,
        has_cats         INTEGER NOT NULL DEFAULT 0,
        has_dogs         INTEGER NOT NULL DEFAULT 0,
        has_small_kids   INTEGER NOT NULL DEFAULT 0,
        care_commitment  TEXT NOT NULL DEFAULT 'medium' CHECK (care_commitment IN ('low','medium','high')),
        typical_light    TEXT NOT NULL DEFAULT 'medium' CHECK (typical_light IN ('low','medium','bright')),
        travels_often    INTEGER NOT NULL DEFAULT 0,
        notes            TEXT NOT NULL DEFAULT '' CHECK (length(notes) <= 500),
        updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
    ],
  },
  {
    // push_subscriptions upsert does INSERT ... ON CONFLICT(home_id, endpoint),
    // but no unique constraint on that pair exists yet — every call fails.
    version: 4,
    statements: [
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_push_home_id_endpoint ON push_subscriptions(home_id, endpoint)`,
    ],
  },
];

export async function runMigrations(db: Client) {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS _migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  const { rows } = await db.execute(
    'SELECT version FROM _migrations ORDER BY version DESC LIMIT 1'
  );
  const currentVersion = (rows[0]?.version as number) ?? 0;

  for (const migration of migrations) {
    if (migration.version > currentVersion) {
      await db.batch(migration.statements, 'write');
      await db.execute({
        sql: 'INSERT INTO _migrations (version) VALUES (?)',
        args: [migration.version],
      });
      console.log(`Migration ${migration.version} applied`);
    }
  }
}
