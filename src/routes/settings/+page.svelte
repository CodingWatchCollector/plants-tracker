<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { homeStore } from '$lib/stores/home';
	import { apiFetch } from '$lib/api';

	let joinLink = $state('');
	let copied = $state(false);
	let loading = $state(true);
	let error = $state('');

	onMount(() => {
		homeStore.init();
		if (!$homeStore) goto(resolve('/'));
	});

	$effect(() => {
		if (!$homeStore) return;
		apiFetch(resolve('/api/home/invite'))
			.then(async (res) => {
				if (!res.ok) throw new Error(await res.text());
				const { join_token } = await res.json();
				joinLink = `${window.location.origin}${resolve('/join/')}${join_token}`;
			})
			.catch((e) => {
				error = e instanceof Error ? e.message : 'Could not load invite link';
			})
			.finally(() => {
				loading = false;
			});
	});

	async function copyLink() {
		await navigator.clipboard.writeText(joinLink);
		copied = true;
		setTimeout(() => (copied = false), 2000);
	}

	function leaveHome() {
		if (!confirm('Leave this home? You will need the invite link to rejoin.')) return;
		homeStore.clear();
		goto(resolve('/'));
	}
</script>

<main>
	<header>
		<a href={resolve('/dashboard')}>← Back</a>
		<h1>Settings</h1>
	</header>

	<section>
		<h2>Home</h2>
		<p><strong>{$homeStore?.name ?? '—'}</strong></p>

		<h3>Invite link</h3>
		<p>Share this link with anyone in your home to give them access.</p>

		{#if loading}
			<p>Loading...</p>
		{:else if error}
			<p class="error">{error}</p>
		{:else}
			<div class="invite">
				<code>{joinLink}</code>
				<button onclick={copyLink}>
					{copied ? '✓ Copied' : 'Copy'}
				</button>
			</div>
		{/if}

		<button class="danger" onclick={leaveHome}>Leave home</button>
	</section>
</main>
