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
	<div class="install-prompt">
		<p>
			📲 To get watering reminders on iPhone, tap
			<strong>Share</strong> then <strong>Add to Home Screen</strong>.
		</p>
		<button onclick={() => (show = false)}>Dismiss</button>
	</div>
{/if}
