<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import { plantStore } from '$lib/stores/plants';
  import { apiFetch } from '$lib/api';
  import PlantForm from '$lib/components/PlantForm.svelte';
  import type { Plant, PlantFormData } from '$lib/types';

  let plant = $state<Plant | null>(null);

  $effect(() => {
    const id = Number(page.params.id);
    apiFetch(resolve(`/api/plants/${id}`))
      .then((res) => {
        if (res.ok) return res.json() as Promise<Plant>;
        goto(resolve('/dashboard'));
      })
      .then((data) => {
        if (data) plant = data;
      });
  });

  async function handleSubmit(data: PlantFormData) {
    await plantStore.update(Number(page.params.id), data);
    goto(resolve('/dashboard'));
  }
</script>

<div class="page narrow">
  <header>
    <a class="back" href={resolve('/dashboard')}>← Back</a>
    {#if plant}<h1>Edit {plant.nickname ?? plant.name}</h1>{/if}
  </header>
  {#if plant}
    <PlantForm {plant} onsubmit={handleSubmit} />
  {:else}
    <p class="muted">Loading...</p>
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

  h1 {
    overflow-wrap: anywhere;
  }
</style>
