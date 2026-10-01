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

<div class="hero">
  <div class="logo" aria-hidden="true">🌿</div>
  <h1>Plant Tracker</h1>
  <p class="muted">
    Keep your plants happy. Track watering, share with your household, get reminders.
  </p>
  <a class="button primary" href={resolve('/setup')}>Create a new home</a>
  <p class="hint muted">Joining someone else's home? Open the invite link they sent you.</p>
</div>

<style>
  .hero {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1rem;
    max-width: 28rem;
    margin: 0 auto;
    padding: 2rem 0;
    text-align: center;
  }

  .logo {
    display: grid;
    place-items: center;
    width: 5rem;
    height: 5rem;
    border-radius: 1.5rem;
    background: var(--primary-soft);
    font-size: 2.75rem;
  }

  h1 {
    font-size: 2.25rem;
  }

  .button {
    min-height: 3rem;
    padding-inline: 1.5rem;
    margin-top: 0.5rem;
  }

  .hint {
    font-size: 0.85rem;
  }
</style>
