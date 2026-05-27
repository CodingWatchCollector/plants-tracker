import { writable, derived } from 'svelte/store';
import type { Plant } from '$lib/types';
import { apiFetch } from '$lib/api';
import { computeNextWateringDate } from '$lib/utils';

function createPlantStore() {
	const { subscribe, set, update } = writable<Plant[]>([]);
	let loading = false;

	return {
		subscribe,

		async load() {
			if (loading) return;
			loading = true;
			try {
				const res = await apiFetch('/api/plants');
				if (res.ok) set(await res.json());
			} finally {
				loading = false;
			}
		},

		async create(data: Partial<Plant>) {
			const res = await apiFetch('/api/plants', {
				method: 'POST',
				body: JSON.stringify(data)
			});
			if (!res.ok) throw new Error(await res.text());
			await this.load();
		},

		async update(id: number, data: Partial<Plant>) {
			const res = await apiFetch(`/api/plants/${id}`, {
				method: 'PATCH',
				body: JSON.stringify(data)
			});
			if (!res.ok) throw new Error(await res.text());
			await this.load();
		},

		/** TODO: possibly get last watered date from api response, so we can be more accurate */
		async markWatered(id: number) {
			const res = await apiFetch(`/api/plants/${id}/water`, {
				method: 'POST'
			});
			if (!res.ok) throw new Error(await res.text());
			const today = new Date().toISOString().split('T')[0];
			update((plants) =>
				plants.map((p) =>
					p.id === id
						? {
								...p,
								last_watered_at: today,
								next_watering_date: computeNextWateringDate(today, p.watering_interval_days)
							}
						: p
				)
			);
		},

		async delete(id: number) {
			const res = await apiFetch(`/api/plants/${id}`, { method: 'DELETE' });
			if (!res.ok) throw new Error(await res.text());
			update((plants) => plants.filter((p) => p.id !== id));
		}
	};
}

export const plantStore = createPlantStore();

const today = new Date().toISOString().split('T')[0];
const soon = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

export const dueToday = derived(plantStore, ($plants) =>
	$plants.filter((p) => p.next_watering_date <= today)
);

export const dueSoon = derived(plantStore, ($plants) =>
	$plants.filter((p) => p.next_watering_date > today && p.next_watering_date <= soon)
);
