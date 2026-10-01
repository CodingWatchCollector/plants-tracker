<script lang="ts">
  let show = $state(false);

  $effect(() => {
    if (typeof window === 'undefined') return;
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const isStandalone = window.navigator.standalone === true;
    show = isIOS && !isStandalone;
  });
</script>

{#if show}
  <div class="banner install-prompt">
    <p>
      📲 To get watering reminders on iPhone, tap
      <strong>Share</strong> then <strong>Add to Home Screen</strong>.
    </p>
    <button class="ghost small" onclick={() => (show = false)}>Dismiss</button>
  </div>
{/if}

<style>
  p {
    flex: 1 1 16rem;
  }
</style>
