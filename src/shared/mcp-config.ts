export const MCP_SERVER_NAME = 'picaglass'
export const MCP_ENDPOINT_FILE = 'mcp-endpoint.json'
export const COPY_MCP_CONFIG_LABEL = '复制 MCP 配置'

export type McpEndpointRecord = {
  url: string
  token: string
  pid: number
  startedAt: string
}

export type McpConfigSnippets = {
  claudeCode: string
  pi: string
}

export type McpConfigResult = ({ available: true } & McpConfigSnippets) | { available: false }

export function mcpConfigSnippets(url: string, token: string): McpConfigSnippets {
  return {
    claudeCode: `claude mcp add --transport http ${MCP_SERVER_NAME} ${url} --header "Authorization: Bearer ${token}"`,
    pi: JSON.stringify(
      {
        mcpServers: {
          [MCP_SERVER_NAME]: {
            url,
            headers: {
              Authorization: `Bearer ${token}`
            }
          }
        }
      },
      null,
      2
    )
  }
}

export function mcpConfigClipboard(snippets: McpConfigSnippets): string {
  return `Claude Code:\n${snippets.claudeCode}\n\npi:\n${snippets.pi}\n`
}
