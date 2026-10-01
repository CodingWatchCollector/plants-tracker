<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { homeStore } from '$lib/stores/home';
  import { apiFetch } from '$lib/api';
  import type { HomeProfile } from '$lib/types';

  let joinLink = $state('');
  let copied = $state(false);
  let loading = $state(true);
  let error = $state('');

  onMount(() => {
    homeStore.init();
    if (!$homeStore) goto(resolve('/'));
  });

  $effect(() => {
    if (!$homeStore) return;
    apiFetch(resolve('/api/home/invite'))
      .then(async (res) => {
        if (!res.ok) throw new Error(await res.text());
        const { join_token } = await res.json();
        joinLink = `${window.location.origin}${resolve('/join/')}${join_token}`;
      })
      .catch((e) => {
        error = e instanceof Error ? e.message : 'Could not load invite link';
      })
      .finally(() => {
        loading = false;
      });
  });

  let has_cats = $state(false);
  let has_dogs = $state(false);
  let has_small_kids = $state(false);
  let care_commitment = $state<HomeProfile['care_commitment']>('medium');
  let typical_light = $state<HomeProfile['typical_light']>('medium');
  let travels_often = $state(false);
  let notes = $state('');
  let profileLoading = $state(true);
  let profileError = $state('');
  let saving = $state(false);
  let saved = $state(false);
  let suggesting = $state(false);
  let suggestNote = $state('');

  $effect(() => {
    if (!$homeStore) return;
    apiFetch(resolve('/api/home/profile'))
      .then(async (res) => {
        if (!res.ok) throw new Error(await res.text());
        const profile: HomeProfile = await res.json();
        has_cats = profile.has_cats;
        has_dogs = profile.has_dogs;
        has_small_kids = profile.has_small_kids;
        care_commitment = profile.care_commitment;
        typical_light = profile.typical_light;
        travels_often = profile.travels_often;
        notes = profile.notes ?? '';
      })
      .catch((e) => {
        profileError = e instanceof Error ? e.message : 'Could not load household profile';
      })
      .finally(() => {
        profileLoading = false;
      });
  });

  async function suggestProfile() {
    suggesting = true;
    suggestNote = '';
    profileError = '';
    try {
      const res = await apiFetch(resolve('/api/home/profile/suggest'));
      if (!res.ok) throw new Error(await res.text());
      const suggestion: {
        care_commitment: HomeProfile['care_commitment'] | null;
        typical_light: HomeProfile['typical_light'] | null;
        matched_plants: { plant_name: string }[];
      } = await res.json();
      if (!suggestion.care_commitment && !suggestion.typical_light) {
        suggestNote = 'No owned plants matched the catalog yet';
        return;
      }
      if (suggestion.care_commitment) care_commitment = suggestion.care_commitment;
      if (suggestion.typical_light) typical_light = suggestion.typical_light;
      suggestNote = `Suggested from: ${suggestion.matched_plants.map((p) => p.plant_name).join(', ')}`;
    } catch (e) {
      profileError = e instanceof Error ? e.message : 'Could not get suggestion';
    } finally {
      suggesting = false;
    }
  }

  async function saveProfile() {
    saving = true;
    saved = false;
    profileError = '';
    try {
      const res = await apiFetch(resolve('/api/home/profile'), {
        method: 'PUT',
        body: JSON.stringify({
          has_cats,
          has_dogs,
          has_small_kids,
          care_commitment,
          typical_light,
          travels_often,
          notes: notes.trim(),
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      saved = true;
      setTimeout(() => (saved = false), 2000);
    } catch (e) {
      profileError = e instanceof Error ? e.message : 'Could not save household profile';
    } finally {
      saving = false;
    }
  }

  async function copyLink() {
    await navigator.clipboard.writeText(joinLink);
    copied = true;
    setTimeout(() => (copied = false), 2000);
  }

  function leaveHome() {
    if (!confirm('Leave this home? You will need the invite link to rejoin.')) return;
    homeStore.clear();
    goto(resolve('/'));
  }
</script>

<div class="page narrow">
  <header>
    <a class="back" href={resolve('/dashboard')}>← Back</a>
    <h1>Settings</h1>
  </header>

  <section class="panel">
    <div class="section-head">
      <h2>Home</h2>
      <span class="home-name">{$homeStore?.name ?? '—'}</span>
    </div>

    <div class="stack">
      <h3>Invite link</h3>
      <p class="muted">Share this link with anyone in your home to give them access.</p>

      {#if loading}
        <p class="muted">Loading...</p>
      {:else if error}
        <p class="error">{error}</p>
      {:else}
        <div class="invite">
          <code>{joinLink}</code>
          <button class="primary" onclick={copyLink}>
            {copied ? '✓ Copied' : 'Copy'}
          </button>
        </div>
      {/if}
    </div>

    <div class="danger-zone">
      <button class="danger" onclick={leaveHome}>Leave home</button>
    </div>
  </section>

  <section class="panel">
    <div class="section-head">
      <h2>Household profile</h2>
    </div>

    {#if profileLoading}
      <p class="muted">Loading...</p>
    {:else}
      <div class="stack">
        <div class="checks">
          <label class="check">
            <input type="checkbox" bind:checked={has_cats} />
            🐈 Cats in the home
          </label>
          <label class="check">
            <input type="checkbox" bind:checked={has_dogs} />
            🐕 Dogs in the home
          </label>
          <label class="check">
            <input type="checkbox" bind:checked={has_small_kids} />
            🧒 Small kids in the home
          </label>
          <label class="check">
            <input type="checkbox" bind:checked={travels_often} />
            ✈️ We travel often
          </label>
        </div>

        <div class="row">
          <label class="field">
            Care commitment
            <select bind:value={care_commitment}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </label>

          <label class="field">
            Typical light
            <select bind:value={typical_light}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="bright">Bright</option>
            </select>
          </label>
        </div>

        <label class="field">
          Notes
          <textarea bind:value={notes} maxlength="500"></textarea>
        </label>

        {#if suggestNote}
          <p class="note">{suggestNote}</p>
        {/if}
        {#if profileError}
          <p class="error">{profileError}</p>
        {/if}

        <div class="actions">
          <button onclick={suggestProfile} disabled={suggesting}>
            {suggesting ? 'Suggesting...' : '✨ Suggest from my plants'}
          </button>
          <button class="primary" onclick={saveProfile} disabled={saving}>
            {saving ? 'Saving...' : saved ? '✓ Saved' : 'Save'}
          </button>
        </div>
      </div>
    {/if}
  </section>
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

  .section-head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.25rem 1rem;
    padding-bottom: 0.9rem;
    margin-bottom: 1rem;
    border-bottom: 1px solid var(--border);
  }

  .home-name {
    font-weight: 600;
    color: var(--primary);
  }

  .stack {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .checks {
    display: grid;
    gap: 0.5rem;
  }

  @media (min-width: 560px) {
    .checks {
      grid-template-columns: 1fr 1fr;
    }
  }

  .check {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    min-height: 2.75rem;
    padding: 0.5rem 0.75rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition:
      background-color 0.15s,
      border-color 0.15s;
  }

  .check:hover {
    background: var(--surface-2);
  }

  .check:has(input:checked) {
    border-color: color-mix(in srgb, var(--primary) 50%, var(--border));
    background: var(--primary-soft);
  }

  .row {
    display: grid;
    gap: 0.75rem;
  }

  @media (min-width: 560px) {
    .row {
      grid-template-columns: 1fr 1fr;
    }
  }

  .note {
    padding: 0.6rem 0.8rem;
    border-radius: var(--radius-sm);
    background: var(--surface-2);
    color: var(--muted);
    font-size: 0.9rem;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 0.5rem;
    padding-top: 0.25rem;
  }

  @media (max-width: 559px) {
    .actions button {
      flex: 1 1 100%;
    }
  }

  .danger-zone {
    display: flex;
    justify-content: flex-end;
    margin-top: 1.25rem;
    padding-top: 1rem;
    border-top: 1px solid var(--border);
  }
</style>
