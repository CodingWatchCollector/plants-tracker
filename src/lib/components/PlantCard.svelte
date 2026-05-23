<script lang="ts">
	import { resolve } from '$app/paths';
	import type { Plant } from '$lib/types';
	import { plantStore } from '$lib/stores/plants';

	let {
		plant,
		onwatered
	}: {
		plant: Plant;
		onwatered?: () => void;
	} = $props();

	const today = new Date().toISOString().split('T')[0];

	let isDue = $derived(plant.next_watering_date <= today);
	let label = $derived(plant.nickname ?? plant.name);
	let daysUntil = $derived(
		Math.ceil((new Date(plant.next_watering_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
	);

	async function handleDelete() {
		if (!confirm(`Delete ${label}?`)) return;
		await plantStore.delete(plant.id);
	}
</script>

<div class="card" class:due={isDue}>
	{#if plant.image_url}
		<img src={plant.image_url} alt={label} />
	{:else}
		<div class="placeholder">🪴</div>
	{/if}

	<div class="info">
		<strong>{label}</strong>
		{#if plant.nickname}<span class="species">{plant.name}</span>{/if}
		{#if plant.room}<span class="room">{plant.room}</span>{/if}
		<span class="watering">
			{#if isDue}
				💧 Water today
			{:else}
				💧 in {daysUntil} day{daysUntil === 1 ? '' : 's'}
			{/if}
		</span>
	</div>

	<div class="actions">
		{#if isDue}
			<button onclick={onwatered}>✓ Watered</button>
		{/if}
		<a href={resolve(`/plants/${plant.id}/edit`)}>Edit</a>
		<button onclick={handleDelete}>Delete</button>
	</div>
</div>
