<!--
  PROTOTYPE（throwaway，prototype/diagnostics-layout 分支专用，勿合入 main）

  Wayfinder #59：布局变体切换条（右下角）。↑/↓ 或按钮循环。截图回路用
  localStorage(__controlsBar) = 'hidden' 连带隐藏本条。
-->
<script lang="ts">
  import { protoLayout, setProtoLayout, type ProtoLayout } from './prototype-layout.svelte'

  const LAYOUTS: Array<{ key: ProtoLayout; name: string }> = [
    { key: 'current', name: '现状 上面板下' },
    { key: 'A', name: 'A 右侧栏' },
    { key: 'B', name: 'B 独立诊断 tab' },
    { key: 'C', name: 'C 折叠抽屉' }
  ]
  const hidden = localStorage.getItem('__controlsBar') === 'hidden'

  function cycle(direction: 1 | -1): void {
    const index = LAYOUTS.findIndex((layout) => layout.key === protoLayout.current)
    const next = LAYOUTS[(index + direction + LAYOUTS.length) % LAYOUTS.length]
    setProtoLayout(next.key)
  }

  function onKeydown(event: KeyboardEvent): void {
    const target = event.target
    if (
      target instanceof HTMLElement &&
      (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
    ) {
      return
    }
    if (event.key === 'ArrowUp') {
      cycle(-1)
    }
    if (event.key === 'ArrowDown') {
      cycle(1)
    }
  }

  $effect(() => {
    window.addEventListener('keydown', onKeydown)
    return () => window.removeEventListener('keydown', onKeydown)
  })

  const currentName = $derived(
    LAYOUTS.find((layout) => layout.key === protoLayout.current)?.name ?? ''
  )
</script>

{#if !hidden}
  <div class="layout-switcher">
    <button type="button" onclick={() => cycle(-1)} aria-label="上一个布局">↑</button>
    <span class="label">{currentName}</span>
    <button type="button" onclick={() => cycle(1)} aria-label="下一个布局">↓</button>
  </div>
{/if}

<style>
  .layout-switcher {
    position: fixed;
    bottom: 16px;
    right: 16px;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 10px;
    border-radius: 999px;
    background: #4a3f8f;
    color: #ffffff;
    box-shadow: 0 8px 24px rgb(0 0 0 / 35%);
    z-index: 10;
    font-size: 13px;
  }

  .layout-switcher button {
    font: inherit;
    color: inherit;
    background: #5d519f;
    border: none;
    border-radius: 999px;
    width: 28px;
    height: 28px;
    cursor: pointer;
  }

  .label {
    min-width: 9rem;
    text-align: center;
    white-space: nowrap;
  }
</style>
