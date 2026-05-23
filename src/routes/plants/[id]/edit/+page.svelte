<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { plantStore } from '$lib/stores/plants';
	import { apiFetch } from '$lib/api';
	import PlantForm from '$lib/components/PlantForm.svelte';
	import type { Plant, PlantFormData } from '$lib/types';

	let plant = $state<Plant | null>(null);

	$effect(() => {
		const id = Number(page.params.id);
		apiFetch(resolve(`/api/plants/${id}`))
			.then((res) => {
				if (res.ok) return res.json() as Promise<Plant>;
				goto(resolve('/dashboard'));
			})
			.then((data) => {
				if (data) plant = data;
			});
	});

	async function handleSubmit(data: PlantFormData) {
		await plantStore.update(Number(page.params.id), data);
		goto(resolve('/dashboard'));
	}
</script>

{#if plant}
	<h1>Edit {plant.nickname ?? plant.name}</h1>
	<PlantForm {plant} onsubmit={handleSubmit} />
{:else}
	<p>Loading...</p>
{/if}
