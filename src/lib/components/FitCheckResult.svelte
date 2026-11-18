<script lang="ts">
  import { resolve } from '$app/paths';
  import type { FitCheckBody } from '$lib/server/ai/run-fit-check';

  let { name, result }: { name: string; result: FitCheckBody } = $props();

  const VERDICT_LABEL: Record<FitCheckBody['verdict'], string> = {
    good_fit: 'Good fit',
    caution: 'Proceed with caution',
    poor_fit: 'Poor fit',
  };

  const FACTOR_LABEL: Record<FitCheckBody['reasons'][number]['factor'], string> = {
    care: 'Care',
    pets: 'Pets',
    kids: 'Kids',
    light: 'Light',
    travel: 'Travel',
    other: 'Other',
  };
</script>

<section class="panel result" aria-label="Plant check result">
  <header>
    <h2>{name}</h2>
    <span class="verdict {result.verdict}">{VERDICT_LABEL[result.verdict]}</span>
  </header>

  {#if result.data_source === 'model_knowledge'}
    <p class="banner banner--warn">
      <span>
        <strong>Unverified.</strong>
        This plant isn't in our reviewed catalog{result.identified_as
          ? `; the assistant recognised it as ${result.identified_as}`
          : ''}. The answer comes from general knowledge, so double-check before buying.
      </span>
    </p>
  {/if}

  <p>{result.summary}</p>

  {#if result.warnings.length}
    <ul class="warnings" aria-label="Warnings">
      {#each result.warnings as warning, i (i)}
        <li class="banner banner--warn">⚠️ {warning}</li>
      {/each}
    </ul>
  {/if}

  {#if result.reasons.length}
    <ul class="reasons" aria-label="Reasons">
      {#each result.reasons as reason, i (i)}
        <li><span class="factor">{FACTOR_LABEL[reason.factor]}</span> {reason.detail}</li>
      {/each}
    </ul>
  {/if}

  {#if result.alternatives.length}
    <div class="alternatives">
      <h3>
        {result.verdict === 'good_fit'
          ? 'You might also like'
          : 'Similar plants that fit your home'}
      </h3>
      <ul>
        {#each result.alternatives as alt (alt.species_id)}
          <li class="alt">
            <div>
              <strong>{alt.common_name}</strong>
              <em class="muted">{alt.scientific_name}</em>
              <p class="muted">{alt.explanation}</p>
            </div>
            <a class="button small" href="{resolve('/plants/new')}?species={alt.species_id}">
              Add this plant
            </a>
          </li>
        {/each}
      </ul>
    </div>
  {/if}
</section>

<style>
  .result {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem 1rem;
  }

  .verdict {
    padding: 0.25rem 0.75rem;
    border-radius: 999px;
    font-size: 0.9rem;
    font-weight: 600;
  }

  .verdict.good_fit {
    background: var(--primary-soft);
    color: var(--primary);
  }

  .verdict.caution {
    background: var(--warn-soft);
    color: var(--warn);
  }

  .verdict.poor_fit {
    background: var(--danger-soft);
    color: var(--danger);
  }

  ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .warnings {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .reasons {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .factor {
    display: inline-block;
    min-width: 4rem;
    margin-right: 0.25rem;
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--muted);
  }

  .alternatives {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding-top: 1rem;
    border-top: 1px solid var(--border);
  }

  .alternatives ul {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .alt {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem 1rem;
    padding: 0.75rem 1rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface-2);
  }

  .alt p {
    margin: 0.15rem 0 0;
    font-size: 0.9rem;
  }
</style>
