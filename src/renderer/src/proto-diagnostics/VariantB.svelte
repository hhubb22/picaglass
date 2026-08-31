<script lang="ts">
  // PROTOTYPE — throwaway. Variant B: collapsible right drawer next to the terminal.
  import { PROTO_BLOCKS, type ProtoBlockId } from './proto-data'
  import ProtoResultView from './ProtoResultView.svelte'

  let open = $state(true)
  let selected: ProtoBlockId = $state('interfaces')
  const block = $derived(PROTO_BLOCKS.find((b) => b.id === selected) ?? PROTO_BLOCKS[0])
</script>

{#if open}
  <aside class="drawer">
    <header class="head">
      <strong>诊断</strong>
      <button type="button" onclick={() => (open = false)} title="收起">▸</button>
    </header>
    <div class="picker">
      {#each PROTO_BLOCKS as b}
        <button
          type="button"
          class:selected={b.id === selected}
          onclick={() => (selected = b.id)}
        >
          {b.label}
        </button>
      {/each}
    </div>
    <div class="content">
      <ProtoResultView {block} />
    </div>
  </aside>
{:else}
  <button type="button" class="handle" onclick={() => (open = true)}>◂ 诊断</button>
{/if}

<style>
  .drawer {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    width: 400px;
    z-index: 5;
    background: var(--bg);
    border-left: 1px solid var(--border);
    box-shadow: var(--shadow);
    display: grid;
    grid-template-rows: auto auto minmax(0, 1fr);
  }
  .head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 16px;
    border-bottom: 1px solid var(--border);
  }
  .picker {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    padding: 10px 16px;
    border-bottom: 1px solid var(--border);
  }
  .picker button {
    font: inherit;
    font-size: 12px;
    padding: 4px 8px;
    border: 1px solid var(--border);
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
    padding: 12px 16px 16px;
    min-height: 0;
  }
  .handle {
    position: absolute;
    right: 0;
    top: 40%;
    z-index: 6;
    writing-mode: vertical-rl;
    padding: 10px 4px;
    font-size: 12px;
    border: 1px solid var(--border);
    border-right: none;
    background: var(--bg);
    color: inherit;
    cursor: pointer;
  }
</style>
