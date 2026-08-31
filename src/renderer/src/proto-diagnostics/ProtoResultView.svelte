<script lang="ts">
  // PROTOTYPE — throwaway. Renders one diagnostic block's result: structured view,
  // raw toggle, parse-failed degraded state, empty-table state.
  import {
    PROTO_EMPTY_NOTE,
    PROTO_PARSE_FAILED,
    PROTO_RAW,
    protoBriefRows,
    protoVersionFacts,
    PROTO_LOG_LINES,
    type ProtoBlock
  } from './proto-data'
  import ProtoTechSupport from './ProtoTechSupport.svelte'

  let { block }: { block: ProtoBlock } = $props()

  let showRaw = $state(false)
  const failed = $derived(PROTO_PARSE_FAILED[block.id])
  const emptyNote = $derived(PROTO_EMPTY_NOTE[block.id])
  const raw = $derived(PROTO_RAW[block.id] ?? '')
  const upCount = $derived(protoBriefRows.filter((r) => r.status === 'Up').length)
</script>

<div class="result">
  <header class="bar">
    <span class="cmds">{block.commands.join('  ·  ')}</span>
    {#if block.id !== 'tech-support'}
      <button type="button" class="toggle" onclick={() => (showRaw = !showRaw)}>
        {showRaw ? '查看结构' : '查看原文'}
      </button>
    {/if}
  </header>

  {#if failed}
    <div class="degraded" role="alert">
      <strong>解析失败，已降级为原文。</strong>
      <span>{failed.reason}</span>
    </div>
  {/if}

  {#if block.id === 'tech-support'}
    <ProtoTechSupport />
  {:else if showRaw || failed}
    <pre class="raw">{raw || '（无输出）'}</pre>
  {:else if block.id === 'interfaces'}
    <p class="summary">{protoBriefRows.length} 个端口 · {upCount} up / {protoBriefRows.length - upCount} down</p>
    <table>
      <thead>
        <tr><th>接口</th><th>状态</th><th>管理</th><th>速率</th><th>描述</th></tr>
      </thead>
      <tbody>
        {#each protoBriefRows as row}
          <tr>
            <td class="mono">{row.name}</td>
            <td><span class="dot" class:down={row.status !== 'Up'}></span>{row.status}</td>
            <td>{row.management}</td>
            <td>{row.speed}</td>
            <td>{row.description}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {:else if block.id === 'device-facts'}
    <dl class="facts">
      {#each protoVersionFacts as [key, value]}
        <div><dt>{key}</dt><dd>{value}</dd></div>
      {/each}
    </dl>
    <p class="summary muted">风扇 / 温度 / 电源表格略（fixtures 已就位，结构同上）</p>
  {:else if block.id === 'logs'}
    <ul class="logs">
      {#each PROTO_LOG_LINES as line}
        <li>{line}</li>
      {/each}
    </ul>
  {:else}
    <p class="summary muted">{emptyNote ?? ''}</p>
  {/if}
</div>

<style>
  .result {
    display: grid;
    gap: 10px;
    align-content: start;
    min-height: 0;
  }
  .bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
  }
  .cmds {
    color: var(--muted);
    font-family: monospace;
    font-size: 12px;
  }
  .toggle {
    font-size: 12px;
  }
  .degraded {
    border: 1px solid var(--status-pending);
    padding: 8px 10px;
    display: grid;
    gap: 4px;
    font-size: 13px;
  }
  .raw {
    margin: 0;
    padding: 10px;
    background: var(--terminal-bg);
    color: #e8e8e8;
    font-size: 12px;
    overflow: auto;
    max-height: 100%;
  }
  table {
    border-collapse: collapse;
    font-size: 13px;
  }
  th,
  td {
    text-align: left;
    padding: 4px 10px 4px 0;
    border-bottom: 1px solid var(--border);
  }
  .mono {
    font-family: monospace;
  }
  .dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    margin-right: 6px;
    background: var(--status-live);
  }
  .dot.down {
    background: var(--status-danger);
  }
  .summary {
    margin: 0;
    font-size: 13px;
  }
  .muted {
    color: var(--muted);
  }
  .facts {
    margin: 0;
    display: grid;
    gap: 6px;
    font-size: 13px;
  }
  .facts div {
    display: grid;
    grid-template-columns: 200px 1fr;
    gap: 12px;
  }
  .facts dt {
    color: var(--muted);
  }
  .facts dd {
    margin: 0;
    font-family: monospace;
  }
  .logs {
    margin: 0;
    padding: 10px;
    list-style: none;
    background: var(--terminal-bg);
    color: #e8e8e8;
    font-family: monospace;
    font-size: 12px;
    display: grid;
    gap: 2px;
    overflow: auto;
  }
</style>
