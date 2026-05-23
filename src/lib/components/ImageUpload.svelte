<script lang="ts">
	import { compressImage, isValidImageType } from '$lib/image';
	import { apiFetch } from '$lib/api';
	import { resolve } from '$app/paths';

	let {
		value = $bindable<string | null>(null),
		onchange
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
				headers: {} // let browser set multipart boundary, override apiFetch default
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
					body: JSON.stringify({ key })
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
			<button type="button" onclick={removeImage}>Remove</button>
		</div>
	{:else}
		<label class="upload-area">
			{#if loading}
				<span>Uploading...</span>
			{:else}
				<span>📷 Add photo</span>
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
