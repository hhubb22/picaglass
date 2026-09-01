// PROTOTYPE（throwaway，prototype/diagnostics-layout 分支专用，勿合入 main）
//
// Wayfinder #59：诊断工作区布局变体的共享状态。'current' 是现状（终端上 +
// 面板下 46%），A/B/C 是粗稿方向。切换条写入 localStorage 并同步到
// <html data-playout>，组件用 protoLayout.current 做模板分支，纯 CSS 部分
// 走 data-playout 选择器（prototype-layout.css）。

export type ProtoLayout = 'current' | 'A' | 'B' | 'C'

const stored = localStorage.getItem('__layoutVariant')
const initial: ProtoLayout =
  stored === 'A' || stored === 'B' || stored === 'C' ? stored : 'current'

export const protoLayout = $state<{ current: ProtoLayout }>({ current: initial })

export function setProtoLayout(next: ProtoLayout): void {
  protoLayout.current = next
  localStorage.setItem('__layoutVariant', next)
  document.documentElement.dataset.playout = next
}

document.documentElement.dataset.playout = protoLayout.current
