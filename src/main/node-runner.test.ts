import { describe, expect, it } from 'vitest'

describe('Node vitest runner', () => {
  it('runs in Node without Electron', () => {
    expect(process.versions).toHaveProperty('node')
    expect(process.versions).not.toHaveProperty('electron')
    expect(globalThis).not.toHaveProperty('window')
  })
})
