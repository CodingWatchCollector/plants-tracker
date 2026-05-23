<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { plantStore } from '$lib/stores/plants';
	import PlantForm from '$lib/components/PlantForm.svelte';
	import type { PlantFormData } from '$lib/types';

	async function handleSubmit(data: PlantFormData) {
		await plantStore.create(data);
		goto(resolve('/dashboard'));
	}
</script>

<h1>Add a plant</h1>
<PlantForm onsubmit={handleSubmit} />
