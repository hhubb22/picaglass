import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    pool: 'forks',
    include: ['src/main/**/*.test.ts'],
    exclude: [...configDefaults.exclude, 'src/renderer/**']
  }
})
