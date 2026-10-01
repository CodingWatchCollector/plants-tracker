<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { plantStore } from '$lib/stores/plants';
  import PlantForm from '$lib/components/PlantForm.svelte';
  import type { PlantFormData } from '$lib/types';

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
  <PlantForm onsubmit={handleSubmit} />
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
