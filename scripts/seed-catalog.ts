import { createClient } from '@libsql/client';
import catalog from './catalog-seed-data.json' with { type: 'json' };

const url = process.env.TURSO_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;

if (!url) throw new Error('TURSO_URL is not set');

const db = createClient({ url, authToken });

interface CatalogEntry {
  scientific_name: string;
  common_name: string;
  aliases: string[];
  watering_interval_days: number;
  drought_tolerance: 'low' | 'medium' | 'high';
  care_level: 'low' | 'medium' | 'high';
  light_needs: 'low' | 'medium' | 'bright';
  toxic_to_cats: 0 | 1;
  toxic_to_dogs: 0 | 1;
  toxicity_notes: string | null;
  growth_habit: 'trailing' | 'upright' | 'tree' | 'rosette' | 'climbing';
  leaf_size: 'small' | 'medium' | 'large';
  leaf_shape: string;
  variegated: 0 | 1;
  care_tips: string | null;
}

async function seedCatalog() {
  console.log(`Seeding ${catalog.length} plants from catalog-seed-data.json...`);

  const now = new Date().toISOString();

  for (const plant of catalog as CatalogEntry[]) {
    await db.execute({
      sql: `INSERT INTO plant_species (
        scientific_name, common_name, aliases, watering_interval_days,
        drought_tolerance, care_level, light_needs, toxic_to_cats, toxic_to_dogs,
        toxicity_notes, growth_habit, leaf_size, leaf_shape, variegated,
        care_tips, source, source_url, reviewed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(scientific_name) DO UPDATE SET
        common_name = excluded.common_name,
        aliases = excluded.aliases,
        watering_interval_days = excluded.watering_interval_days,
        drought_tolerance = excluded.drought_tolerance,
        care_level = excluded.care_level,
        light_needs = excluded.light_needs,
        toxic_to_cats = excluded.toxic_to_cats,
        toxic_to_dogs = excluded.toxic_to_dogs,
        toxicity_notes = excluded.toxicity_notes,
        growth_habit = excluded.growth_habit,
        leaf_size = excluded.leaf_size,
        leaf_shape = excluded.leaf_shape,
        variegated = excluded.variegated,
        care_tips = excluded.care_tips,
        source = excluded.source,
        reviewed_at = excluded.reviewed_at`,
      args: [
        plant.scientific_name,
        plant.common_name,
        JSON.stringify(plant.aliases),
        plant.watering_interval_days,
        plant.drought_tolerance,
        plant.care_level,
        plant.light_needs,
        plant.toxic_to_cats,
        plant.toxic_to_dogs,
        plant.toxicity_notes,
        plant.growth_habit,
        plant.leaf_size,
        plant.leaf_shape,
        plant.variegated,
        plant.care_tips,
        'ai-draft',
        null,
        now,
      ],
    });
  }

  console.log('Catalog seed complete.');
  db.close();
}

await seedCatalog();
