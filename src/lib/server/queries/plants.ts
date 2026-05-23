import type { Client } from '@libsql/client';
import type { Plant } from '$lib/types';
import { computeNextWateringDate } from '$lib/utils';

function rowToPlant(row: Record<string, unknown>): Plant {
	return {
		id: row.id as number,
		home_id: row.home_id as number,
		name: row.name as string,
		nickname: row.nickname as string | null,
		room: row.room as string | null,
		image_url: row.image_url as string | null,
		watering_interval_days: row.watering_interval_days as number,
		last_watered_at: row.last_watered_at as string | null,
		next_watering_date: row.next_watering_date as string,
		notes: row.notes as string | null,
		created_at: row.created_at as string,
		updated_at: row.updated_at as string
	};
}

export async function getPlants(db: Client, home_id: number): Promise<Plant[]> {
	const { rows } = await db.execute({
		sql: `SELECT * FROM plants WHERE home_id = ?
          ORDER BY next_watering_date ASC`,
		args: [home_id]
	});
	return rows.map(rowToPlant);
}

export async function getPlant(db: Client, id: number, home_id: number): Promise<Plant | null> {
	const { rows } = await db.execute({
		sql: 'SELECT * FROM plants WHERE id = ? AND home_id = ?',
		args: [id, home_id]
	});
	return rows[0] ? rowToPlant(rows[0]) : null;
}

export async function createPlant(
	db: Client,
	home_id: number,
	data: {
		name: string;
		nickname?: string;
		room?: string;
		image_url?: string;
		watering_interval_days: number;
		last_watered_at?: string;
		notes?: string;
	}
): Promise<number> {
	const last_watered_at = data.last_watered_at ?? new Date().toISOString();
	const next_watering_date = computeNextWateringDate(last_watered_at, data.watering_interval_days);

	const { lastInsertRowid } = await db.execute({
		sql: `INSERT INTO plants (
            home_id, name, nickname, room, image_url,
            watering_interval_days, last_watered_at,
            next_watering_date, notes
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		args: [
			home_id,
			data.name,
			data.nickname ?? null,
			data.room ?? null,
			data.image_url ?? null,
			data.watering_interval_days,
			last_watered_at,
			next_watering_date,
			data.notes ?? null
		]
	});

	return Number(lastInsertRowid);
}

export async function updatePlant(
	db: Client,
	id: number,
	home_id: number,
	data: {
		name?: string;
		nickname?: string;
		room?: string;
		image_url?: string;
		watering_interval_days?: number;
		last_watered_at?: string;
		notes?: string;
	}
): Promise<void> {
	const current = await getPlant(db, id, home_id);
	if (!current) throw new Error('Plant not found');

	const last_watered_at = data.last_watered_at ?? current.last_watered_at;
	const interval = data.watering_interval_days ?? current.watering_interval_days;
	const next_watering_date = last_watered_at
		? computeNextWateringDate(last_watered_at, interval)
		: current.next_watering_date;

	await db.execute({
		sql: `UPDATE plants SET
            name = ?,
            nickname = ?,
            room = ?,
            image_url = ?,
            watering_interval_days = ?,
            last_watered_at = ?,
            next_watering_date = ?,
            notes = ?,
            updated_at = datetime('now')
          WHERE id = ? AND home_id = ?`,
		args: [
			data.name ?? current.name,
			data.nickname ?? current.nickname,
			data.room ?? current.room,
			data.image_url ?? current.image_url,
			interval,
			last_watered_at,
			next_watering_date,
			data.notes ?? current.notes,
			id,
			home_id
		]
	});
}

/** TODO: possibly pass date as param, so we can undo watering or set a specific date */
export async function markWatered(db: Client, id: number, home_id: number): Promise<void> {
	const current = await getPlant(db, id, home_id);
	if (!current) throw new Error('Plant not found');

	const now = new Date().toISOString();
	const next_watering_date = computeNextWateringDate(now, current.watering_interval_days);

	await db.execute({
		sql: `UPDATE plants SET
            last_watered_at = ?,
            next_watering_date = ?,
            updated_at = datetime('now')
          WHERE id = ? AND home_id = ?`,
		args: [now, next_watering_date, id, home_id]
	});
}

export async function deletePlant(db: Client, id: number, home_id: number): Promise<void> {
	await db.execute({
		sql: 'DELETE FROM plants WHERE id = ? AND home_id = ?',
		args: [id, home_id]
	});
}
