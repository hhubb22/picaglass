import { describe, expect, it } from 'vitest'
import {
  COPY_MCP_CONFIG_LABEL,
  MCP_ENDPOINT_FILE,
  MCP_SERVER_NAME,
  mcpConfigClipboard,
  mcpConfigSnippets
} from './mcp-config'

const URL = 'http://127.0.0.1:43123/mcp'
const TOKEN = 'a'.repeat(64)

describe('MCP config snippets', () => {
  it('builds Claude Code and pi fragments that carry the url and bearer token', () => {
    const snippets = mcpConfigSnippets(URL, TOKEN)

    expect(snippets.claudeCode).toBe(
      `claude mcp add --transport http picaglass ${URL} --header "Authorization: Bearer ${TOKEN}"`
    )
    expect(JSON.parse(snippets.pi)).toEqual({
      mcpServers: {
        picaglass: {
          url: URL,
          headers: {
            Authorization: `Bearer ${TOKEN}`
          }
        }
      }
    })
    expect(snippets.claudeCode.includes(URL)).toBe(true)
    expect(snippets.claudeCode.includes(TOKEN)).toBe(true)
    expect(snippets.pi.includes(URL)).toBe(true)
    expect(snippets.pi.includes(TOKEN)).toBe(true)
    expect(MCP_SERVER_NAME).toBe('picaglass')
    expect(MCP_ENDPOINT_FILE).toBe('mcp-endpoint.json')
    expect(COPY_MCP_CONFIG_LABEL).toBe('复制 MCP 配置')
  })

  it('joins both fragments into one pasteable clipboard payload', () => {
    const snippets = mcpConfigSnippets(URL, TOKEN)
    expect(mcpConfigClipboard(snippets)).toBe(
      `Claude Code:\n${snippets.claudeCode}\n\npi:\n${snippets.pi}\n`
    )
  })
})
