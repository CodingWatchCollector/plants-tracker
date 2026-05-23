<script lang="ts">
	import type { Plant, PlantFormData } from '$lib/types';
	import { resolve } from '$app/paths';
	import ImageUpload from '$lib/components/ImageUpload.svelte';

	let {
		plant = {},
		onsubmit
	}: {
		plant?: Partial<Plant>;
		onsubmit: (data: PlantFormData) => Promise<void>;
	} = $props();

	let name = $state('');
	let nickname = $state('');
	let room = $state('');
	let watering_interval_days = $state(7);
	let last_watered_at = $state(new Date().toISOString().split('T')[0]);
	let notes = $state('');
	let loading = $state(false);
	let error = $state('');
	let image_url = $state<string | null>(null);

	$effect(() => {
		if (!plant) return;
		name = plant.name ?? '';
		nickname = plant.nickname ?? '';
		room = plant.room ?? '';
		watering_interval_days = plant.watering_interval_days ?? 7;
		last_watered_at = plant.last_watered_at
			? plant.last_watered_at.split('T')[0]
			: new Date().toISOString().split('T')[0];
		notes = plant.notes ?? '';
		image_url = plant.image_url ?? null;
	});

	async function handleSubmit() {
		if (!name.trim()) return;
		loading = true;
		error = '';
		try {
			await onsubmit({
				name: name.trim(),
				nickname: nickname.trim() || null,
				room: room.trim() || null,
				watering_interval_days: Number(watering_interval_days),
				last_watered_at: new Date(last_watered_at).toISOString(),
				next_watering_date: '',
				notes: notes.trim() || null,
				image_url // was hardcoded to plant.image_url before
			});
		} catch (e) {
			error = e instanceof Error ? e.message : 'Something went wrong';
			loading = false;
		}
	}
</script>

<form onsubmit={handleSubmit}>
	<ImageUpload bind:value={image_url} />
	<label>
		Plant name *
		<input bind:value={name} placeholder="e.g. Monstera deliciosa" required />
	</label>

	<label>
		Nickname
		<input bind:value={nickname} placeholder="e.g. The big one in the corner" />
	</label>

	<label>
		Room
		<input bind:value={room} placeholder="e.g. Living room" />
	</label>

	<label>
		Watering every (days)
		<input type="number" bind:value={watering_interval_days} min="1" max="365" />
	</label>

	<label>
		Last watered
		<input type="date" bind:value={last_watered_at} />
	</label>

	<label>
		Notes
		<textarea bind:value={notes} placeholder="Any care notes..." rows="3"></textarea>
	</label>

	{#if error}<p class="error">{error}</p>{/if}

	<button type="submit" disabled={loading}>
		{loading ? 'Saving...' : 'Save plant'}
	</button>
	<a href={resolve('/dashboard')}>Cancel</a>
</form>
