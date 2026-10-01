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

<div class="center">
  <div class="panel card">
    {#if status === 'loading'}
      <div class="icon" aria-hidden="true">🌱</div>
      <p class="muted">Joining home...</p>
    {:else if status === 'success'}
      <div class="icon" aria-hidden="true">✅</div>
      <p>Joined <strong>{homeName}</strong>.</p>
      <p class="muted">Redirecting...</p>
    {:else}
      <div class="icon" aria-hidden="true">❌</div>
      <p class="error">{errorMsg}</p>
      <a class="button" href={resolve('/')}>Go home</a>
    {/if}
  </div>
</div>

<style>
  .center {
    flex: 1;
    display: grid;
    place-items: center;
  }

  .card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.75rem;
    width: 100%;
    max-width: 24rem;
    text-align: center;
  }

  .icon {
    font-size: 2.5rem;
  }
</style>
