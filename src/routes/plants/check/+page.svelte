<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { homeStore } from '$lib/stores/home';
  import { apiFetch } from '$lib/api';
  import FitCheckResult from '$lib/components/FitCheckResult.svelte';
  import type { FitCheckBody } from '$lib/server/ai/run-fit-check';

  type Suggestion = { id: number; common_name: string; scientific_name: string };

  const MAX_CANDIDATE_LENGTH = 100;
  const MIN_SUGGESTION_LENGTH = 2;
  const SUGGESTION_DELAY_MS = 250;

  let query = $state('');
  let suggestions = $state<Suggestion[]>([]);
  let loading = $state(false);
  let error = $state('');
  let result = $state<FitCheckBody | null>(null);
  let checkedName = $state('');

  let suggestionTimer: ReturnType<typeof setTimeout> | undefined;

  onMount(() => {
    homeStore.init();
    if (!$homeStore) goto(resolve('/'));
    return () => clearTimeout(suggestionTimer);
  });

  function onInput() {
    clearTimeout(suggestionTimer);
    const q = query.trim();
    if (q.length < MIN_SUGGESTION_LENGTH) {
      suggestions = [];
      return;
    }
    suggestionTimer = setTimeout(() => loadSuggestions(q), SUGGESTION_DELAY_MS);
  }

  async function loadSuggestions(q: string) {
    try {
      const res = await apiFetch(`${resolve('/api/catalog/search')}?q=${encodeURIComponent(q)}`);
      if (!res.ok) return;
      const found: Suggestion[] = await res.json();
      // Ignore an answer for text the user has already changed.
      if (query.trim() === q) suggestions = found;
    } catch {
      // Autocomplete is a convenience: the check works without it.
    }
  }

  // Server errors arrive as { message }; show that instead of raw JSON.
  async function errorMessage(res: Response) {
    const body = await res.json().catch(() => null);
    return body?.message ?? 'Something went wrong';
  }

  async function checkPlant(e: Event) {
    e.preventDefault();
    const candidate = query.trim();
    if (!candidate || loading) return;

    loading = true;
    error = '';
    result = null;
    try {
      const res = await apiFetch(resolve('/api/fit-check'), {
        method: 'POST',
        body: JSON.stringify({ candidate }),
      });
      if (!res.ok) throw new Error(await errorMessage(res));
      result = await res.json();
      checkedName = candidate;
    } catch (e) {
      error = e instanceof Error ? e.message : 'Something went wrong';
    } finally {
      loading = false;
    }
  }
</script>

<div class="page narrow">
  <header>
    <a class="back" href={resolve('/dashboard')}>← Back</a>
    <h1>Check a plant</h1>
    <p class="muted">
      Thinking of getting a plant? See whether it suits your home, pets and routine before you buy.
    </p>
  </header>

  <form class="panel" onsubmit={checkPlant}>
    <label class="field">
      Plant name
      <input
        bind:value={query}
        oninput={onInput}
        list="catalog-suggestions"
        placeholder="e.g. Fiddle leaf fig"
        maxlength={MAX_CANDIDATE_LENGTH}
        autocomplete="off"
        required
      />
    </label>
    <datalist id="catalog-suggestions">
      {#each suggestions as suggestion (suggestion.id)}
        <option value={suggestion.common_name}>{suggestion.scientific_name}</option>
      {/each}
    </datalist>

    <div class="actions">
      <button class="primary" type="submit" disabled={loading || !query.trim()}>
        {loading ? 'Checking...' : 'Check plant'}
      </button>
    </div>
  </form>

  <div aria-live="polite" aria-busy={loading}>
    {#if error}
      <p class="error">{error}</p>
    {:else if result}
      <FitCheckResult name={checkedName} {result} />
    {/if}
  </div>
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

  form {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
  }

  @media (max-width: 559px) {
    .actions > :global(*) {
      flex: 1;
    }
  }
</style>
