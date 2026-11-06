import type { Client } from '@libsql/client';
import type { OwnedPlant, PlantSpecies } from '$lib/types';

// A plant name matches a species when it equals the scientific name, the common name
// or one of the aliases, ignoring case. Same rule as the profile suggest route.
const speciesNameMatch = (species: string, name: string) => `(
  LOWER(${species}.scientific_name) = LOWER(${name})
  OR LOWER(${species}.common_name) = LOWER(${name})
  OR EXISTS (
    SELECT 1 FROM json_each(${species}.aliases) je WHERE LOWER(je.value) = LOWER(${name})
  )
)`;

// Escapes LIKE wildcards so user input is matched literally (used with ESCAPE '\').
const escapeLike = (text: string) => text.replace(/[\\%_]/g, (c) => `\\${c}`);

function rowToSpecies(row: Record<string, unknown>): PlantSpecies {
  return {
    id: row.id as number,
    scientific_name: row.scientific_name as string,
    common_name: row.common_name as string,
    aliases: JSON.parse((row.aliases as string | null) ?? '[]') as string[],
    watering_interval_days: row.watering_interval_days as number,
    drought_tolerance: row.drought_tolerance as PlantSpecies['drought_tolerance'],
    care_level: row.care_level as PlantSpecies['care_level'],
    light_needs: row.light_needs as PlantSpecies['light_needs'],
    toxic_to_cats: Boolean(row.toxic_to_cats),
    toxic_to_dogs: Boolean(row.toxic_to_dogs),
    toxicity_notes: row.toxicity_notes as string | null,
    growth_habit: row.growth_habit as PlantSpecies['growth_habit'],
    leaf_size: row.leaf_size as PlantSpecies['leaf_size'],
    leaf_shape: row.leaf_shape as string,
    variegated: Boolean(row.variegated),
    care_tips: row.care_tips as string | null,
    source: row.source as string,
    source_url: row.source_url as string | null,
    reviewed_at: row.reviewed_at as string,
  };
}

// Exact match (case-insensitive) on scientific name, common name or alias.
export async function findSpeciesByName(db: Client, text: string): Promise<PlantSpecies | null> {
  const name = text.trim();
  if (!name) return null;
  const { rows } = await db.execute({
    sql: `SELECT * FROM plant_species ps
          WHERE ${speciesNameMatch('ps', '$name')}
          ORDER BY ps.id LIMIT 1`,
    args: { name },
  });
  return rows[0] ? rowToSpecies(rows[0]) : null;
}

// Autocomplete: species whose scientific name, common name or an alias contains the text.
// Names that start with the text come first.
export async function searchSpecies(db: Client, text: string, limit = 8): Promise<PlantSpecies[]> {
  const q = escapeLike(text.trim().toLowerCase());
  if (!q) return [];
  const { rows } = await db.execute({
    sql: `SELECT * FROM plant_species ps
          WHERE LOWER(ps.scientific_name) LIKE $contains ESCAPE '\\'
            OR LOWER(ps.common_name) LIKE $contains ESCAPE '\\'
            OR EXISTS (
              SELECT 1 FROM json_each(ps.aliases) je WHERE LOWER(je.value) LIKE $contains ESCAPE '\\'
            )
          ORDER BY
            CASE
              WHEN LOWER(ps.common_name) LIKE $prefix ESCAPE '\\'
                OR LOWER(ps.scientific_name) LIKE $prefix ESCAPE '\\'
                OR EXISTS (
                  SELECT 1 FROM json_each(ps.aliases) je WHERE LOWER(je.value) LIKE $prefix ESCAPE '\\'
                )
              THEN 0 ELSE 1
            END,
            ps.common_name
          LIMIT $limit`,
    args: { contains: `%${q}%`, prefix: `${q}%`, limit },
  });
  return rows.map(rowToSpecies);
}

// Every plant the home owns, with its catalog row when the name matches one.
export async function getOwnedPlantsWithSpecies(db: Client, homeId: number): Promise<OwnedPlant[]> {
  const { rows } = await db.execute({
    sql: `SELECT p.name AS plant_name, ps.*
          FROM plants p
          LEFT JOIN plant_species ps ON ps.id = (
            SELECT s.id FROM plant_species s
            WHERE ${speciesNameMatch('s', 'p.name')}
            ORDER BY s.id LIMIT 1
          )
          WHERE p.home_id = $homeId
          ORDER BY p.id`,
    args: { homeId },
  });
  return rows.map((row) => ({
    name: row.plant_name as string,
    species: row.id == null ? null : rowToSpecies(row),
  }));
}
