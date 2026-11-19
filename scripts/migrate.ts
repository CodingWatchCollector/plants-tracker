import { createClient } from '@libsql/client';
import { runMigrations } from '../src/lib/server/migrate.ts';

const url = process.env.TURSO_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;

if (!url) throw new Error('TURSO_URL is not set');

const db = createClient({ url, authToken });

await runMigrations(db);
db.close();
