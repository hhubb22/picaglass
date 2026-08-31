<script lang="ts">
  // PROTOTYPE — throwaway (wayfinder #35). Mounts the three diagnostics-UI variants
  // inside ProfileWorkspace and the floating switcher. DEV builds only.
  import VariantA from './VariantA.svelte'
  import VariantB from './VariantB.svelte'
  import VariantC from './VariantC.svelte'
  import ProtoSwitcher from './ProtoSwitcher.svelte'

  let variant = $state(new URLSearchParams(window.location.search).get('variant') ?? 'A')

  function onCycle(next: string) {
    variant = next
    const url = new URL(window.location.href)
    url.searchParams.set('variant', next)
    window.history.replaceState(null, '', url)
  }
</script>

{#if variant === 'A'}
  <VariantA />
{:else if variant === 'B'}
  <VariantB />
{:else}
  <VariantC />
{/if}
<ProtoSwitcher {variant} {onCycle} />
