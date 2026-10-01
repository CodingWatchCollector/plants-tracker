<script lang="ts">
  import { resolve } from '$app/paths';
  import type { Plant } from '$lib/types';
  import { plantStore } from '$lib/stores/plants';

  let {
    plant,
    onwatered,
  }: {
    plant: Plant;
    onwatered?: () => void;
  } = $props();

  const today = new Date().toISOString().split('T')[0];

  let isDue = $derived(plant.next_watering_date <= today);
  let label = $derived(plant.nickname ?? plant.name);
  let daysUntil = $derived(
    Math.ceil((new Date(plant.next_watering_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
  );

  async function handleDelete() {
    if (!confirm(`Delete ${label}?`)) return;
    await plantStore.delete(plant.id);
  }
</script>

<article class="card" class:due={isDue}>
  {#if plant.image_url}
    <img class="thumb" src={plant.image_url} alt={label} loading="lazy" />
  {:else}
    <div class="thumb placeholder" aria-hidden="true">🪴</div>
  {/if}

  <div class="info">
    <strong class="name">{label}</strong>
    {#if plant.nickname}<span class="species">{plant.name}</span>{/if}
    <div class="meta">
      {#if plant.room}<span class="tag">{plant.room}</span>{/if}
      <span class="tag watering" class:watering--due={isDue}>
        {#if isDue}
          💧 Water today
        {:else}
          💧 in {daysUntil} day{daysUntil === 1 ? '' : 's'}
        {/if}
      </span>
    </div>
  </div>

  <div class="actions">
    {#if isDue}
      <button class="primary small" onclick={onwatered}>✓ Watered</button>
    {/if}
    <a class="button small ghost" href={resolve(`/plants/${plant.id}/edit`)}>Edit</a>
    <button class="small ghost danger" onclick={handleDelete}>Delete</button>
  </div>
</article>

<style>
  .card {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0.75rem 0.9rem;
    align-items: center;
    padding: 0.85rem;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    box-shadow: var(--shadow-sm);
    transition:
      box-shadow 0.15s,
      border-color 0.15s;
  }

  .card:hover {
    box-shadow: var(--shadow);
  }

  .card.due {
    border-color: color-mix(in srgb, var(--water) 45%, var(--border));
    background: linear-gradient(
      90deg,
      color-mix(in srgb, var(--water-soft) 70%, var(--surface)),
      var(--surface) 60%
    );
  }

  .thumb {
    width: 4.5rem;
    height: 4.5rem;
    border-radius: var(--radius-sm);
    object-fit: cover;
  }

  .placeholder {
    display: grid;
    place-items: center;
    background: var(--primary-soft);
    font-size: 2rem;
  }

  .info {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    min-width: 0;
  }

  .name {
    font-size: 1.05rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .species {
    color: var(--muted);
    font-size: 0.875rem;
    font-style: italic;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .meta {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    margin-top: 0.3rem;
  }

  .tag {
    padding: 0.1rem 0.55rem;
    border-radius: 999px;
    background: var(--surface-2);
    color: var(--muted);
    font-size: 0.78rem;
    font-weight: 550;
  }

  .watering {
    background: var(--water-soft);
    color: var(--water);
  }

  .watering--due {
    background: var(--water);
    color: var(--surface);
  }

  .actions {
    grid-column: 1 / -1;
    display: flex;
    justify-content: flex-end;
    gap: 0.35rem;
    padding-top: 0.6rem;
    border-top: 1px solid var(--border);
  }

  .actions .primary {
    margin-right: auto;
  }
</style>
