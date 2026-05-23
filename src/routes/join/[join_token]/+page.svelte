<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { homeStore } from '$lib/stores/home';

	let status = $state<'loading' | 'success' | 'error'>('loading');
	let homeName = $state('');
	let errorMsg = $state('');

	$effect(() => {
		const token = page.params.join_token;
		fetch(resolve(`/api/home/join/${token}`))
			.then(async (res) => {
				if (!res.ok) throw new Error(await res.text());
				return res.json();
			})
			.then((home) => {
				homeStore.save({ id: home.id, name: home.name });
				homeName = home.name;
				status = 'success';
				setTimeout(() => goto(resolve('/dashboard')), 1500);
			})
			.catch((e) => {
				errorMsg = e instanceof Error ? e.message : 'Something went wrong';
				status = 'error';
			});
	});
</script>

<main>
	{#if status === 'loading'}
		<p>Joining home...</p>
	{:else if status === 'success'}
		<p>✅ Joined <strong>{homeName}</strong>. Redirecting...</p>
	{:else}
		<p>❌ {errorMsg}</p>
		<a href={resolve('/')}>Go home</a>
	{/if}
</main>
