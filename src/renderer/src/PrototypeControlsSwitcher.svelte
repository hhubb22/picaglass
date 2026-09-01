<!--
  PROTOTYPE（throwaway，prototype/buttons-controls 分支专用，勿合入 main）

  Wayfinder #58：控件变体切换条。←/→ 或按钮循环 A/B/C，选择写入
  localStorage(__controlsVariant) 并重载生效。截图回路用
  localStorage(__controlsBar) = 'hidden' 隐藏本条。
-->
<script lang="ts">
  const VARIANTS = [
    { key: 'A', name: '描边派 38/32 · r6' },
    { key: 'B', name: '填充派 36/32 · r8' },
    { key: 'C', name: '紧凑派 32/28 · r5' }
  ] as const
  type VariantKey = (typeof VARIANTS)[number]['key']

  const stored = localStorage.getItem('__controlsVariant')
  const initial: VariantKey = stored === 'B' || stored === 'C' ? stored : 'A'
  let current = $state<VariantKey>(initial)
  const hidden = localStorage.getItem('__controlsBar') === 'hidden'

  function apply(key: VariantKey): void {
    document.documentElement.dataset.pc = key
    localStorage.setItem('__controlsVariant', key)
  }

  function cycle(direction: 1 | -1): void {
    const index = VARIANTS.findIndex((variant) => variant.key === current)
    const next = VARIANTS[(index + direction + VARIANTS.length) % VARIANTS.length]
    current = next.key
    apply(next.key)
  }

  function onKeydown(event: KeyboardEvent): void {
    const target = event.target
    if (
      target instanceof HTMLElement &&
      (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
    ) {
      return
    }
    if (event.key === 'ArrowLeft') {
      cycle(-1)
    }
    if (event.key === 'ArrowRight') {
      cycle(1)
    }
  }

  $effect(() => {
    apply(current)
    window.addEventListener('keydown', onKeydown)
    return () => window.removeEventListener('keydown', onKeydown)
  })

  const currentName = $derived(VARIANTS.find((variant) => variant.key === current)?.name ?? '')
</script>

{#if !hidden}
  <div class="switcher">
    <button type="button" onclick={() => cycle(-1)} aria-label="上一个变体">←</button>
    <span class="label">{current} · {currentName}</span>
    <button type="button" onclick={() => cycle(1)} aria-label="下一个变体">→</button>
  </div>
{/if}

<style>
  .switcher {
    position: fixed;
    bottom: 16px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 10px;
    border-radius: 999px;
    background: #111111;
    color: #ffffff;
    box-shadow: 0 8px 24px rgb(0 0 0 / 35%);
    z-index: 10;
    font-size: 13px;
  }

  .switcher button {
    font: inherit;
    color: inherit;
    background: #2a2a2a;
    border: none;
    border-radius: 999px;
    width: 28px;
    height: 28px;
    cursor: pointer;
  }

  .label {
    min-width: 11rem;
    text-align: center;
    white-space: nowrap;
  }
</style>
