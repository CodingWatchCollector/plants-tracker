<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { homeStore } from '$lib/stores/home';
	import { onMount } from 'svelte';

	onMount(() => {
		homeStore.init();
		if ($homeStore) goto(resolve('/dashboard'));
	});
</script>

<main>
	<h1>🌿 Plant Tracker</h1>
	<p>Keep your plants happy.</p>
	<a href={resolve('/setup')}>Create a new home</a>
</main>
