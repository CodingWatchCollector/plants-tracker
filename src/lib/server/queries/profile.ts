import type { Client } from '@libsql/client';
import type { HomeProfile } from '$lib/types';

function rowToProfile(row: Record<string, unknown>): HomeProfile {
	return {
		home_id: row.home_id as number,
		has_cats: Boolean(row.has_cats),
		has_dogs: Boolean(row.has_dogs),
		has_small_kids: Boolean(row.has_small_kids),
		care_commitment: row.care_commitment as HomeProfile['care_commitment'],
		typical_light: row.typical_light as HomeProfile['typical_light'],
		travels_often: Boolean(row.travels_often),
		notes: (row.notes as string | null) ?? '',
		updated_at: row.updated_at as string | null
	};
}

export async function getProfile(db: Client, home_id: number): Promise<HomeProfile> {
	const { rows } = await db.execute({
		sql: 'SELECT * FROM home_profile WHERE home_id = ?',
		args: [home_id]
	});
	if (rows[0]) return rowToProfile(rows[0]);
	return {
		home_id,
		has_cats: false,
		has_dogs: false,
		has_small_kids: false,
		care_commitment: 'medium',
		typical_light: 'medium',
		travels_often: false,
		notes: '',
		updated_at: null
	};
}

export async function upsertProfile(
	db: Client,
	home_id: number,
	data: Partial<Omit<HomeProfile, 'home_id' | 'updated_at'>>
): Promise<void> {
	// Each raw value is bound twice: once for the fresh-row default (COALESCE
	// against the schema default), once for the existing-row default (COALESCE
	// against the current column). `excluded.x` can't do this alone because by
	// the time ON CONFLICT sees it, it's already been coalesced to the insert
	// default, so an omitted field would overwrite an existing row with that
	// default instead of leaving it alone.
	const has_cats = data.has_cats === undefined ? null : data.has_cats ? 1 : 0;
	const has_dogs = data.has_dogs === undefined ? null : data.has_dogs ? 1 : 0;
	const has_small_kids = data.has_small_kids === undefined ? null : data.has_small_kids ? 1 : 0;
	const travels_often = data.travels_often === undefined ? null : data.travels_often ? 1 : 0;
	const care_commitment = data.care_commitment ?? null;
	const typical_light = data.typical_light ?? null;
	const notes = data.notes ?? null;

	await db.execute({
		sql: `INSERT INTO home_profile (
            home_id, has_cats, has_dogs, has_small_kids,
            care_commitment, typical_light, travels_often, notes
          ) VALUES (
            ?, COALESCE(?, 0), COALESCE(?, 0), COALESCE(?, 0),
            COALESCE(?, 'medium'), COALESCE(?, 'medium'), COALESCE(?, 0), COALESCE(?, '')
          )
          ON CONFLICT(home_id) DO UPDATE SET
            has_cats = COALESCE(?, home_profile.has_cats),
            has_dogs = COALESCE(?, home_profile.has_dogs),
            has_small_kids = COALESCE(?, home_profile.has_small_kids),
            care_commitment = COALESCE(?, home_profile.care_commitment),
            typical_light = COALESCE(?, home_profile.typical_light),
            travels_often = COALESCE(?, home_profile.travels_often),
            notes = COALESCE(?, home_profile.notes),
            updated_at = datetime('now')`,
		args: [
			home_id,
			has_cats,
			has_dogs,
			has_small_kids,
			care_commitment,
			typical_light,
			travels_often,
			notes,
			has_cats,
			has_dogs,
			has_small_kids,
			care_commitment,
			typical_light,
			travels_often,
			notes
		]
	});
}
