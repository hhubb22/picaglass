<script lang="ts">
  // PROTOTYPE — throwaway. Variant C: IDE-style bottom panel with per-block tabs.
  import { PROTO_BLOCKS, type ProtoBlockId } from './proto-data'
  import ProtoResultView from './ProtoResultView.svelte'

  let collapsed = $state(false)
  let selected: ProtoBlockId = $state('interfaces')
  const block = $derived(PROTO_BLOCKS.find((b) => b.id === selected) ?? PROTO_BLOCKS[0])
</script>

<div class="panel" class:collapsed>
  <header class="strip">
    <div class="tabs">
      {#each PROTO_BLOCKS as b}
        <button
          type="button"
          class:selected={!collapsed && b.id === selected}
          onclick={() => {
            selected = b.id
            collapsed = false
          }}
        >
          {b.label}
        </button>
      {/each}
    </div>
    <button type="button" class="chev" onclick={() => (collapsed = !collapsed)}>
      {collapsed ? '▲' : '▼'}
    </button>
  </header>
  {#if !collapsed}
    <div class="content">
      <ProtoResultView {block} />
    </div>
  {/if}
</div>

<style>
  .panel {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 46%;
    z-index: 5;
    background: var(--bg);
    border-top: 1px solid var(--border);
    box-shadow: var(--shadow);
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
  }
  .panel.collapsed {
    height: auto;
  }
  .strip {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    padding: 4px 16px;
    border-bottom: 1px solid var(--border);
  }
  .tabs {
    display: flex;
    gap: 2px;
    overflow-x: auto;
  }
  .tabs button {
    font: inherit;
    font-size: 13px;
    padding: 6px 10px;
    border: none;
    border-bottom: 2px solid transparent;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    white-space: nowrap;
  }
  .tabs button.selected {
    color: var(--fg);
    border-bottom-color: var(--fg);
  }
  .chev {
    font: inherit;
    border: none;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
  }
  .content {
    overflow: auto;
    padding: 12px 16px 16px;
    min-height: 0;
  }
</style>
