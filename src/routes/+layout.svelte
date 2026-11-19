<script lang="ts">
  import './layout.css';

  let { children } = $props();
</script>

<div class="app">
  <main>
    {@render children()}
  </main>
</div>

<style>
  .app {
    display: flex;
    flex-direction: column;
    min-height: 100vh;
    min-height: 100dvh;
  }

  main {
    flex: 1;
    display: flex;
    flex-direction: column;
    width: 100%;
    max-width: var(--column-width);
    margin: 0 auto;
    padding: var(--gutter);
    padding-top: max(var(--gutter), env(safe-area-inset-top));
    padding-bottom: max(2.5rem, env(safe-area-inset-bottom));
  }
</style>
