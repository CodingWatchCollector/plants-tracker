<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import { apiFetch } from '$lib/api';
  import { plantStore } from '$lib/stores/plants';
  import PlantForm from '$lib/components/PlantForm.svelte';
  import type { Plant, PlantFormData } from '$lib/types';

  // ?species=<id> starts the form from a catalog plant (the check page's "Add this plant").
  const speciesId = page.url.searchParams.get('species');

  let prefill = $state<Partial<Plant>>({});
  let prefillNote = $state('');
  // PlantForm resets its fields whenever `plant` changes, so only show it once the lookup is
  // done; otherwise a late answer would overwrite what the user has already typed.
  let ready = $state(!speciesId);

  onMount(async () => {
    if (!speciesId) return;
    try {
      const res = await apiFetch(resolve('/api/catalog/[id]', { id: speciesId }));
      if (!res.ok) throw new Error(await res.text());
      const species = await res.json();
      prefill = {
        name: species.scientific_name,
        watering_interval_days: species.watering_interval_days,
      };
      prefillNote = `Started from ${species.common_name} (${species.scientific_name}). Adjust anything you like.`;
    } catch {
      prefillNote = "Couldn't load that plant's details, so the form is empty.";
    } finally {
      ready = true;
    }
  });

  async function handleSubmit(data: PlantFormData) {
    await plantStore.create(data);
    goto(resolve('/dashboard'));
  }
</script>

<div class="page narrow">
  <header>
    <a class="back" href={resolve('/dashboard')}>← Back</a>
    <h1>Add a plant</h1>
  </header>
  {#if !ready}
    <p class="muted">Loading...</p>
  {:else}
    {#if prefillNote}<p class="muted">{prefillNote}</p>{/if}
    <PlantForm plant={prefill} onsubmit={handleSubmit} />
  {/if}
</div>

<style>
  .narrow {
    width: 100%;
    max-width: 40rem;
    margin: 0 auto;
    gap: 1rem;
  }

  header {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
</style>
