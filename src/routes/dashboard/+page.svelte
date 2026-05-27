<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { homeStore } from '$lib/stores/home';
	import { plantStore, dueToday, dueSoon } from '$lib/stores/plants';
	import PlantCard from '$lib/components/PlantCard.svelte';
	import { setupPushNotifications, unsubscribePushNotifications } from '$lib/stores/push';
	import InstallPrompt from '$lib/components/InstallPrompt.svelte';
	import { onMount } from 'svelte';
	import { apiFetch } from '$lib/api';

	let roomFilter = $derived(page.url.searchParams.get('room') ?? '');
	let rooms = $derived([
		...new Set($plantStore.map((p) => p.room).filter((r): r is string => r !== null))
	]);
	let filtered = $derived(
		roomFilter ? $plantStore.filter((p) => p.room === roomFilter) : $plantStore
	);

	function setRoom(room: string) {
		const url = new URL(page.url);
		if (room) url.searchParams.set('room', room);
		else url.searchParams.delete('room');
		// eslint-disable-next-line svelte/no-navigation-without-resolve
		goto(url, { replaceState: true, noScroll: true });
	}

	onMount(() => {
		homeStore.init();
	});

	$effect(() => {
		if (!$homeStore) {
			goto(resolve('/'));
			return;
		}
		plantStore.load();
	});

	// push notifications
	let pushStatus = $state<'idle' | 'granted' | 'denied' | 'unsupported' | 'loading'>('idle');

	$effect(() => {
		if (typeof window === 'undefined') return;
		if (!('Notification' in window)) {
			pushStatus = 'unsupported';
			return;
		}
		if (Notification.permission === 'granted') pushStatus = 'granted';
		else if (Notification.permission === 'denied') pushStatus = 'denied';
	});

	async function enableNotifications() {
		pushStatus = 'loading';
		pushStatus = await setupPushNotifications();
	}

	async function disableNotifications() {
		await unsubscribePushNotifications();
		pushStatus = 'idle';
	}

	// TODO: remove test push
	let testResult = $state('');

	async function testPush() {
		const res = await apiFetch(resolve('/api/push/test'), { method: 'POST' });
		const data = await res.json();
		testResult = JSON.stringify(data);
	}
</script>

<main>
	<header>
		<h1>🌿 {$homeStore?.name ?? 'Plant Tracker'}</h1>
		<div>
			<a href={resolve('/plants/new')}>+ Add plant</a>
			<a href={resolve('/settings')}>Settings</a>
		</div>
	</header>
	<InstallPrompt />
	<div style="margin-top: 2rem; padding: 1rem; border: 1px dashed red;">
		<p>Dev tools</p>
		<button onclick={testPush}>Send test push</button>
		{#if testResult}<pre>{testResult}</pre>{/if}
	</div>
	{#if pushStatus === 'idle' || pushStatus === 'loading'}
		<div class="banner">
			<span>🔔 Enable notifications to get watering reminders</span>
			<button onclick={enableNotifications} disabled={pushStatus === 'loading'}>
				{pushStatus === 'loading' ? 'Setting up...' : 'Enable'}
			</button>
		</div>
	{:else if pushStatus === 'denied'}
		<div class="banner banner--warn">
			<span>Notifications blocked. Enable them in browser settings.</span>
		</div>
	{:else if pushStatus === 'granted'}
		<div class="banner banner--success">
			<span>🔔 Notifications enabled</span>
			<button onclick={disableNotifications}>Disable</button>
		</div>
	{/if}

	{#if $dueToday.length > 0}
		<section>
			<h2>Due today ({$dueToday.length})</h2>
			{#each $dueToday as plant (plant.id)}
				<PlantCard {plant} onwatered={() => plantStore.markWatered(plant.id)} />
			{/each}
		</section>
	{/if}

	{#if $dueSoon.length > 0}
		<section>
			<h2>Coming up</h2>
			{#each $dueSoon as plant (plant.id)}
				<PlantCard {plant} />
			{/each}
		</section>
	{/if}

	<section>
		<h2>All plants</h2>

		{#if rooms.length > 1}
			<div class="filters">
				<button class:active={roomFilter === ''} onclick={() => setRoom('')}>All</button>
				{#each rooms as room (room)}
					<button class:active={roomFilter === room} onclick={() => setRoom(room)}>{room}</button>
				{/each}
			</div>
		{/if}

		{#if filtered.length === 0}
			<p>No plants yet. <a href={resolve('/plants/new')}>Add your first one.</a></p>
		{:else}
			{#each filtered as plant (plant.id)}
				<PlantCard {plant} onwatered={() => plantStore.markWatered(plant.id)} />
			{/each}
		{/if}
	</section>
</main>
