<script lang="ts">
  // PROTOTYPE — throwaway. Variant A: diagnostics as a third workspace tab.
  import { PROTO_BLOCKS, type ProtoBlockId } from './proto-data'
  import ProtoResultView from './ProtoResultView.svelte'

  let open = $state(true)
  let selected: ProtoBlockId = $state('interfaces')
  const block = $derived(PROTO_BLOCKS.find((b) => b.id === selected) ?? PROTO_BLOCKS[0])
</script>

{#if open}
  <div class="proto-a">
    <nav class="tabs" aria-label="Prototype workspace tabs">
      <button type="button" onclick={() => (open = false)}>Overview</button>
      <button type="button" onclick={() => (open = false)}>Terminal</button>
      <button type="button" class="selected">Diagnostics</button>
    </nav>
    <div class="body">
      <aside class="picker">
        {#each PROTO_BLOCKS as b}
          <button
            type="button"
            class:selected={b.id === selected}
            onclick={() => (selected = b.id)}
          >
            {b.label}
          </button>
        {/each}
      </aside>
      <div class="content">
        <ProtoResultView {block} />
      </div>
    </div>
  </div>
{:else}
  <button type="button" class="reopen" onclick={() => (open = true)}>Diagnostics (proto)</button>
{/if}

<style>
  .proto-a {
    position: absolute;
    inset: 0;
    z-index: 5;
    background: var(--bg);
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
  }
  .tabs {
    display: flex;
    gap: 8px;
    padding: 16px 24px 0;
  }
  .tabs button {
    font: inherit;
    padding: 8px 10px;
    border: 1px solid transparent;
    background: transparent;
    color: inherit;
    cursor: pointer;
  }
  .tabs button.selected {
    border-color: var(--fg);
    background: var(--hover);
  }
  .body {
    display: grid;
    grid-template-columns: 180px minmax(0, 1fr);
    min-height: 0;
    padding: 16px 24px 24px;
    gap: 20px;
  }
  .picker {
    display: grid;
    gap: 4px;
    align-content: start;
    border-right: 1px solid var(--border);
    padding-right: 12px;
  }
  .picker button {
    font: inherit;
    text-align: left;
    padding: 8px 10px;
    border: 1px solid transparent;
    background: transparent;
    color: inherit;
    cursor: pointer;
  }
  .picker button.selected {
    border-color: var(--fg);
    background: var(--hover);
  }
  .content {
    overflow: auto;
    min-height: 0;
  }
  .reopen {
    position: absolute;
    top: 18px;
    right: 24px;
    z-index: 6;
    font-size: 12px;
    border: 1px dashed var(--muted);
    background: var(--bg);
    color: var(--muted);
    padding: 6px 10px;
    cursor: pointer;
  }
</style>
