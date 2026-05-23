import type { Client } from '@libsql/client';

const migrations = [
	{
		version: 1,
		sql: `
      CREATE TABLE IF NOT EXISTS _migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `
	}
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
			await db.execute(migration.sql);
			await db.execute({
				sql: 'INSERT INTO _migrations (version) VALUES (?)',
				args: [migration.version]
			});
			console.log(`Migration ${migration.version} applied`);
		}
	}
}
