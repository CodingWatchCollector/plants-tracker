<script lang="ts">
  import { compressImage, isValidImageType } from '$lib/image';
  import { apiFetch } from '$lib/api';
  import { resolve } from '$app/paths';

  let {
    value = $bindable<string | null>(null),
    onchange,
  }: {
    value?: string | null;
    onchange?: (url: string | null) => void;
  } = $props();

  let loading = $state(false);
  let error = $state('');
  let preview = $state(value);

  async function handleFile(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    if (!isValidImageType(file)) {
      error = 'Please select a JPEG, PNG or WebP image';
      return;
    }

    loading = true;
    error = '';

    try {
      const compressed = await compressImage(file);
      const formData = new FormData();
      formData.append('image', compressed);

      const res = await apiFetch(resolve('/api/images'), {
        method: 'POST',
        body: formData,
        headers: {}, // let browser set multipart boundary, override apiFetch default
      });

      if (!res.ok) throw new Error(await res.text());

      const { url } = await res.json();
      preview = url;
      value = url;
      onchange?.(url);
    } catch (e) {
      error = e instanceof Error ? e.message : 'Upload failed';
    } finally {
      loading = false;
    }
  }

  async function removeImage() {
    if (!preview) return;

    try {
      // extract key from url for deletion
      const key = preview.split('/api/images/')[1];
      if (key) {
        await apiFetch(resolve('/api/images'), {
          method: 'DELETE',
          body: JSON.stringify({ key }),
        });
      }
    } catch {
      // non-fatal, image orphaned in R2 but not a blocker
    }

    preview = null;
    value = null;
    onchange?.(null);
  }
</script>

<div class="image-upload">
  {#if preview}
    <div class="preview">
      <img src={preview} alt="Plant" />
      <button type="button" class="small remove" onclick={removeImage}>Remove</button>
    </div>
  {:else}
    <label class="upload-area" class:loading>
      {#if loading}
        <span class="icon" aria-hidden="true">⏳</span>
        <span>Uploading...</span>
      {:else}
        <span class="icon" aria-hidden="true">📷</span>
        <span>Add photo</span>
        <span class="hint">Camera or gallery</span>
      {/if}
      <input
        type="file"
        accept="image/*"
        capture="environment"
        onchange={handleFile}
        disabled={loading}
        hidden
      />
    </label>
  {/if}

  {#if error}
    <p class="error">{error}</p>
  {/if}
</div>

<style>
  .image-upload {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .upload-area {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.2rem;
    min-height: 9rem;
    border: 2px dashed var(--border);
    border-radius: var(--radius);
    background: var(--surface-2);
    font-weight: 600;
    cursor: pointer;
    transition:
      border-color 0.15s,
      background-color 0.15s;
  }

  .upload-area:hover {
    border-color: var(--primary);
    background: var(--primary-soft);
  }

  .upload-area.loading {
    cursor: progress;
  }

  .icon {
    font-size: 1.75rem;
  }

  .hint {
    color: var(--muted);
    font-size: 0.85rem;
    font-weight: 400;
  }

  .preview {
    position: relative;
  }

  .preview img {
    width: 100%;
    max-height: 18rem;
    border-radius: var(--radius);
    object-fit: cover;
  }

  .remove {
    position: absolute;
    top: 0.5rem;
    right: 0.5rem;
    background: color-mix(in srgb, var(--surface) 85%, transparent);
    backdrop-filter: blur(4px);
  }
</style>
