<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { homeStore } from '$lib/stores/home';

	let name = $state('');
	let loading = $state(false);
	let error = $state('');
	let inviteLink = $state('');

	async function createHome() {
		if (!name.trim()) return;
		loading = true;
		error = '';
		try {
			const res = await fetch(resolve('/api/home'), {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name })
			});
			if (!res.ok) throw new Error(await res.text());
			const home = await res.json();
			homeStore.save({ id: home.id, name: home.name });
			inviteLink = `${window.location.origin}${resolve('/join/')}${home.join_token}`;
		} catch (e) {
			error = e instanceof Error ? e.message : 'Something went wrong';
		} finally {
			loading = false;
		}
	}

	function copyLink() {
		navigator.clipboard.writeText(inviteLink);
	}
</script>

<main>
	<h1>Create your home</h1>

	{#if !inviteLink}
		<form onsubmit={createHome}>
			<label>
				Home name
				<input bind:value={name} placeholder="e.g. Our Home" required />
			</label>
			{#if error}<p class="error">{error}</p>{/if}
			<button type="submit" disabled={loading}>
				{loading ? 'Creating...' : 'Create'}
			</button>
		</form>
	{:else}
		<p>Your home <strong>{name}</strong> is ready.</p>
		<p>Share this link with anyone in your home:</p>
		<div class="invite">
			<code>{inviteLink}</code>
			<button onclick={copyLink}>Copy</button>
		</div>
		<button onclick={() => goto(resolve('/dashboard'))}>Go to dashboard</button>
	{/if}
</main>
