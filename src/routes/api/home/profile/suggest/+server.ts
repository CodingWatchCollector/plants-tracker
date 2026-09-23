import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';

const CARE_LEVELS = ['low', 'medium', 'high'] as const;

interface MatchedPlant {
	plant_name: string;
	common_name: string;
	care_level: (typeof CARE_LEVELS)[number];
	light_needs: 'low' | 'medium' | 'bright';
}

export const GET: RequestHandler = async ({ locals, platform }) => {
	if (!locals.home) throw error(401, 'Unauthorized');
	const db = getDb(platform);

	const { rows } = await db.execute({
		sql: `SELECT DISTINCT p.name AS plant_name, ps.common_name, ps.care_level, ps.light_needs
          FROM plants p
          JOIN plant_species ps
            ON LOWER(p.name) = LOWER(ps.scientific_name)
            OR LOWER(p.name) = LOWER(ps.common_name)
            OR EXISTS (
              SELECT 1 FROM json_each(ps.aliases) je WHERE LOWER(je.value) = LOWER(p.name)
            )
          WHERE p.home_id = ?`,
		args: [locals.home.id]
	});

	const matched_plants: MatchedPlant[] = rows.map((row) => ({
		plant_name: row.plant_name as string,
		common_name: row.common_name as string,
		care_level: row.care_level as MatchedPlant['care_level'],
		light_needs: row.light_needs as MatchedPlant['light_needs']
	}));

	if (matched_plants.length === 0) {
		return json({ care_commitment: null, typical_light: null, matched_plants: [] });
	}

	const levels = matched_plants
		.map((p) => CARE_LEVELS.indexOf(p.care_level) + 1)
		.sort((a, b) => a - b);
	const mid = Math.floor(levels.length / 2);
	const median =
		levels.length % 2 === 1 ? levels[mid] : Math.round((levels[mid - 1] + levels[mid]) / 2);
	const care_commitment = CARE_LEVELS[median - 1];

	const counts = new Map<MatchedPlant['light_needs'], number>();
	for (const p of matched_plants) counts.set(p.light_needs, (counts.get(p.light_needs) ?? 0) + 1);
	let typical_light = matched_plants[0].light_needs;
	for (const [value, count] of counts) {
		if (count > counts.get(typical_light)!) typical_light = value;
	}

	return json({ care_commitment, typical_light, matched_plants });
};
