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

  let roomFilter = $derived(page.url.searchParams.get('room') ?? '');
  let rooms = $derived([
    ...new Set($plantStore.map((p) => p.room).filter((r): r is string => r !== null)),
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
</script>

<div class="page">
  <header class="page-header">
    <div class="title">
      <span class="eyebrow">Your home</span>
      <h1>🌿 {$homeStore?.name ?? 'Plant Tracker'}</h1>
    </div>
    <nav class="header-actions">
      <a class="button primary" href={resolve('/plants/new')}>+ Add plant</a>
      <a class="button" href={resolve('/settings')} aria-label="Settings"
        >⚙️<span class="label">Settings</span></a
      >
    </nav>
  </header>

  <InstallPrompt />

  {#if pushStatus === 'idle' || pushStatus === 'loading'}
    <div class="banner">
      <span>🔔 Enable notifications to get watering reminders</span>
      <button
        class="primary small"
        onclick={enableNotifications}
        disabled={pushStatus === 'loading'}
      >
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
      <button class="ghost small" onclick={disableNotifications}>Disable</button>
    </div>
  {/if}

  {#if $dueToday.length > 0}
    <section>
      <h2>Due today <span class="count count--due">{$dueToday.length}</span></h2>
      <div class="grid">
        {#each $dueToday as plant (plant.id)}
          <PlantCard {plant} onwatered={() => plantStore.markWatered(plant.id)} />
        {/each}
      </div>
    </section>
  {/if}

  {#if $dueSoon.length > 0}
    <section>
      <h2>Coming up <span class="count">{$dueSoon.length}</span></h2>
      <div class="grid">
        {#each $dueSoon as plant (plant.id)}
          <PlantCard {plant} />
        {/each}
      </div>
    </section>
  {/if}

  <section>
    <h2>All plants <span class="count">{$plantStore.length}</span></h2>

    {#if rooms.length > 1}
      <div class="filters" role="group" aria-label="Filter by room">
        <button class="chip" class:active={roomFilter === ''} onclick={() => setRoom('')}
          >All</button
        >
        {#each rooms as room (room)}
          <button class="chip" class:active={roomFilter === room} onclick={() => setRoom(room)}>
            {room}
          </button>
        {/each}
      </div>
    {/if}

    {#if filtered.length === 0}
      <div class="empty panel">
        <div class="empty-icon" aria-hidden="true">🪴</div>
        <p>No plants yet.</p>
        <a class="button primary" href={resolve('/plants/new')}>Add your first one</a>
      </div>
    {:else}
      <div class="grid">
        {#each filtered as plant (plant.id)}
          <PlantCard {plant} onwatered={() => plantStore.markWatered(plant.id)} />
        {/each}
      </div>
    {/if}
  </section>
</div>

<style>
  .title {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    min-width: 0;
  }

  .eyebrow {
    font-size: 0.75rem;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--muted);
  }

  h1 {
    overflow-wrap: anywhere;
  }

  .header-actions {
    display: flex;
    gap: 0.5rem;
  }

  .header-actions .label {
    display: none;
  }

  @media (min-width: 560px) {
    .header-actions .label {
      display: inline;
    }
  }

  section {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  h2 {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .count {
    display: inline-grid;
    place-items: center;
    min-width: 1.6rem;
    height: 1.6rem;
    padding: 0 0.45rem;
    border-radius: 999px;
    background: var(--surface-2);
    color: var(--muted);
    font-size: 0.8rem;
    font-weight: 600;
  }

  .count--due {
    background: var(--water-soft);
    color: var(--water);
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 22rem), 1fr));
    gap: 0.75rem;
  }

  .filters {
    display: flex;
    gap: 0.5rem;
    overflow-x: auto;
    margin-inline: calc(var(--gutter) * -1);
    padding: 0.1rem var(--gutter) 0.25rem;
    scrollbar-width: none;
  }

  .filters::-webkit-scrollbar {
    display: none;
  }

  .chip {
    flex: none;
    min-height: 2.1rem;
    padding: 0.3rem 0.9rem;
    border-radius: 999px;
    font-size: 0.875rem;
  }

  .chip.active {
    background: var(--primary);
    border-color: var(--primary);
    color: var(--on-primary);
  }

  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.75rem;
    padding-block: 2.5rem;
    text-align: center;
    color: var(--muted);
  }

  .empty-icon {
    font-size: 2.5rem;
  }
</style>
