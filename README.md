# picaglass

Electron + Svelte + TypeScript 空模板。构建工具是 [electron-vite](https://electron-vite.org/)。

```
src/
  main/       Electron 主进程
  preload/    预加载，经 contextBridge 暴露 API
  renderer/   Svelte 渲染进程
```

```bash
pnpm install
pnpm dev
pnpm build:mac
```
