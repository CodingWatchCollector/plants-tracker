import { createClient } from '@libsql/client';
import * as fs from 'fs';
import * as path from 'path';

const url = process.env.TURSO_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
const trefleApiKey = process.env.TREFLE_API_KEY;

if (!url) throw new Error('TURSO_URL is not set');
if (!trefleApiKey) throw new Error('TREFLE_API_KEY is not set');

const db = createClient({ url, authToken });

interface TreflePlant {
  id: number;
  common_name: string;
  scientific_name: string;
  slug: string;
  observations_count: number;
  image_url?: string;
  watering: { min: number; max: number } | null;
  hardiness: {
    min: number;
    max: number;
  } | null;
  depth_water_requirement: {
    cm: number;
  } | null;
  main_species_id?: number;
  specifications?: {
    growth_form?: string;
    leaf_color?: string[];
  };
  toxicity?: string;
}

function mapGrowthHabit(growthForm?: string): string {
  if (!growthForm) return 'upright';
  const form = growthForm.toLowerCase();
  if (form.includes('climbing') || form.includes('vine')) return 'climbing';
  if (form.includes('trailing') || form.includes('prostrate')) return 'trailing';
  if (form.includes('tree')) return 'tree';
  if (form.includes('rosette')) return 'rosette';
  return 'upright';
}

function estimateLightNeeds(plant: TreflePlant): string {
  if (plant.specifications?.leaf_color?.some((c) => c.toLowerCase().includes('dark'))) {
    return 'low';
  }
  return 'medium';
}

function estimateWateringInterval(plant: TreflePlant): number {
  if (!plant.watering) return 7;
  const avg = (plant.watering.min + plant.watering.max) / 2;
  if (avg < 30) return 3;
  if (avg < 60) return 7;
  return 14;
}

async function fetchTreflePlants(page = 1, perPage = 50): Promise<TreflePlant[]> {
  const url = `https://trefle.io/api/v1/plants?page=${page}&per_page=${perPage}&token=${trefleApiKey}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Trefle API error: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as { data: TreflePlant[] };
  return data.data || [];
}

async function seedCatalog() {
  console.log('Starting plant catalog seed...');

  // Get page number from command line arg or env var (default: 1)
  const page = parseInt(process.argv[2] || process.env.SEED_PAGE || '1', 10);
  const perPage = parseInt(process.env.SEED_PER_PAGE || '100', 10);

  try {
    const plants = await fetchTreflePlants(page, perPage);
    console.log(`Fetched ${plants.length} plants from Trefle (page ${page})`);

    const now = new Date().toISOString();
    const statements = plants
      .filter((p) => p.scientific_name && p.common_name)
      .map((plant) => ({
        sql: `INSERT OR IGNORE INTO plant_species (
          scientific_name,
          common_name,
          aliases,
          watering_interval_days,
          drought_tolerance,
          care_level,
          light_needs,
          toxic_to_cats,
          toxic_to_dogs,
          toxicity_notes,
          growth_habit,
          leaf_size,
          leaf_shape,
          variegated,
          care_tips,
          source,
          source_url,
          reviewed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          plant.scientific_name,
          plant.common_name,
          JSON.stringify([plant.slug] || []),
          estimateWateringInterval(plant),
          'medium', // drought_tolerance
          'medium', // care_level
          estimateLightNeeds(plant),
          plant.toxicity?.toLowerCase().includes('cat') ? 1 : 0,
          plant.toxicity?.toLowerCase().includes('dog') ? 1 : 0,
          plant.toxicity || null,
          mapGrowthHabit(plant.specifications?.growth_form),
          'medium', // leaf_size
          plant.specifications?.leaf_color?.[0] || 'green',
          0, // variegated - default false
          plant.observations_count > 0
            ? `Popular plant with ${plant.observations_count} observations`
            : null,
          'trefle',
          `https://trefle.io/plants/${plant.id}`,
          now,
        ],
      }));

    console.log(`Inserting ${statements.length} plants into database...`);

    // Insert in batches to avoid overwhelming the DB
    const batchSize = 10;
    for (let i = 0; i < statements.length; i += batchSize) {
      const batch = statements.slice(i, i + batchSize);
      const batchStatements = batch.map((s) => s.sql);
      const flatArgs = batch.flatMap((s) => s.args);

      // Trefle has unique scientific names, so we can use INSERT OR IGNORE
      for (const stmt of batch) {
        try {
          await db.execute({
            sql: stmt.sql,
            args: stmt.args,
          });
        } catch (err) {
          console.warn(`Warning inserting ${stmt.args[0]}:`, err);
        }
      }

      console.log(`Inserted ${Math.min(i + batchSize, statements.length)}/${statements.length}`);
    }

    console.log('✅ Catalog seed complete!');
  } catch (error) {
    console.error('Error seeding catalog:', error);
    process.exit(1);
  } finally {
    db.close();
  }
}

await seedCatalog();
