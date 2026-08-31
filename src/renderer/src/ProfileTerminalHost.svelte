<script lang="ts">
  import type { TerminalRegistry } from './terminal-registry'

  let {
    profileId,
    registry,
    hidden
  }: {
    profileId: string
    registry: TerminalRegistry
    hidden: boolean
  } = $props()

  let host = $state<HTMLDivElement | undefined>()

  $effect(() => {
    const el = host
    if (el === undefined) {
      return
    }
    registry.attach(profileId, el)
  })

  $effect(() => {
    if (!hidden) {
      registry.fit(profileId)
    }
  })
</script>

<div class="host" class:hidden bind:this={host}></div>

<style>
  .host {
    position: absolute;
    inset: 0;
    min-height: 0;
  }

  .hidden {
    visibility: hidden;
    pointer-events: none;
  }
</style>
