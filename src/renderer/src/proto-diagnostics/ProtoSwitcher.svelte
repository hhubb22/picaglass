<script lang="ts">
  // PROTOTYPE — throwaway. Floating variant switcher bar: ←/→ clicks and arrow keys,
  // keeps ?variant= in the URL so a variant is shareable and reload-stable.
  const VARIANTS = [
    { key: 'A', name: '第三个标签页' },
    { key: 'B', name: '右侧抽屉' },
    { key: 'C', name: '底部面板' }
  ] as const

  let { variant, onCycle }: { variant: string; onCycle: (next: string) => void } = $props()

  const index = $derived(Math.max(0, VARIANTS.findIndex((v) => v.key === variant)))
  const current = $derived(VARIANTS[index])

  function step(delta: number) {
    const next = VARIANTS[(index + delta + VARIANTS.length) % VARIANTS.length]
    onCycle(next.key)
  }

  function onKeydown(event: KeyboardEvent) {
    const target = event.target as HTMLElement | null
    if (
      target &&
      (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
    ) {
      return
    }
    if (event.key === 'ArrowLeft') step(-1)
    if (event.key === 'ArrowRight') step(1)
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div class="switcher" data-prototype-switcher>
  <button type="button" aria-label="上一个变体" onclick={() => step(-1)}>◀</button>
  <span class="label">{current.key}（{current.name}）</span>
  <button type="button" aria-label="下一个变体" onclick={() => step(1)}>▶</button>
</div>

<style>
  .switcher {
    position: fixed;
    bottom: 16px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 50;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 10px;
    border-radius: 999px;
    background: var(--fg);
    color: var(--bg);
    box-shadow: var(--shadow);
    font-size: 13px;
  }
  .switcher button {
    font: inherit;
    border: none;
    background: transparent;
    color: inherit;
    cursor: pointer;
    padding: 2px 8px;
  }
  .label {
    white-space: nowrap;
  }
</style>
