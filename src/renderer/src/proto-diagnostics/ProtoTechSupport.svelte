<script lang="ts">
  // PROTOTYPE — throwaway. tech_support collection flow: start → poll progress → artifact saved.
  import { TECH_SUPPORT_STAGES } from './proto-data'

  let phase: 'idle' | 'running' | 'done' = $state('idle')
  let stageIndex = $state(0)
  let timer: ReturnType<typeof setInterval> | undefined

  function start() {
    phase = 'running'
    stageIndex = 0
    timer = setInterval(() => {
      stageIndex += 1
      if (stageIndex >= TECH_SUPPORT_STAGES.length) {
        clearInterval(timer)
        phase = 'done'
      }
    }, 700)
  }

  function reset() {
    clearInterval(timer)
    phase = 'idle'
    stageIndex = 0
  }

  $effect(() => () => clearInterval(timer))
</script>

<div class="ts">
  {#if phase === 'idle'}
    <p class="muted">
      一键采集设备快照（版本 / 接口 / 配置 / 软硬表 / 日志…），打包回传本机。设备侧采集约 7
      分钟，产物约 2.5MB。
    </p>
    <button type="button" onclick={start}>开始采集</button>
  {:else if phase === 'running'}
    <p class="muted">设备侧采集中（后台运行，可离开此页）…</p>
    <ul class="stages" aria-live="polite">
      {#each TECH_SUPPORT_STAGES.slice(0, stageIndex + 1) as stage, i}
        <li class:pending={i === stageIndex && i < TECH_SUPPORT_STAGES.length - 1}>{stage}</li>
      {/each}
    </ul>
  {:else}
    <div class="artifact">
      <p class="name">PICOS-20260831-0930-techSupport.log</p>
      <p class="muted">2.5 MB · 已校验 · 已保存到 ~/Downloads/</p>
      <div class="actions">
        <button type="button">打开所在文件夹</button>
        <button type="button" title="提权 file delete，唯一写操作">删除设备侧副本</button>
        <button type="button" onclick={reset}>重新采集</button>
      </div>
    </div>
  {/if}
</div>

<style>
  .ts {
    display: grid;
    gap: 12px;
    align-content: start;
  }
  .muted {
    color: var(--muted);
    margin: 0;
  }
  .stages {
    margin: 0;
    padding-left: 18px;
    font-family: monospace;
    font-size: 12px;
    display: grid;
    gap: 4px;
  }
  .stages .pending {
    color: var(--status-pending);
  }
  .artifact {
    border: 1px solid var(--border);
    padding: 12px;
    display: grid;
    gap: 8px;
  }
  .artifact .name {
    margin: 0;
    font-family: monospace;
  }
  .actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
</style>
