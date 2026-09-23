import { createClient } from '@libsql/client';

const url = process.env.TURSO_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;

if (!url) throw new Error('TURSO_URL is not set');

const db = createClient({ url, authToken });

const { rows } = await db.execute('SELECT COUNT(*) as count FROM plant_species');
const count = rows[0]?.count as number;

console.log(`\n✅ Total plants in database: ${count}`);

if (count > 0) {
  const { rows: plants } = await db.execute(
    'SELECT scientific_name, common_name, watering_interval_days FROM plant_species LIMIT 5'
  );
  console.log('\nFirst 5 plants:');
  plants.forEach((p) => {
    console.log(
      `  - ${p.scientific_name} (${p.common_name}) - waters every ${p.watering_interval_days} days`
    );
  });
} else {
  console.log('⚠️  No plants found in database');
}

db.close();
