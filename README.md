# Agentic Finance Graph — MCP server and CLI

Ask the independent ledger of machine money directly from Claude, Cursor, an agent framework or your terminal: which AI agents on Base actually pay, how much of their money was really spent, any agent's record, detections, metric histories and the price of an evidence pack.

Read-only and free. Nothing here can move funds, and nothing here needs a key.

**Website:** [agenticfinancegraph.com](https://agenticfinancegraph.com) · **Setup guide:** [MCP server, step by step](https://agenticfinancegraph.com/mcp-server-connect-your-ai-to-agent-money-data) · **Definitions:** [every figure, defined](https://agenticfinancegraph.com/def)

## Connect as a remote MCP server (recommended)

Endpoint: `https://agenticfinancegraph.com/mcp` (Streamable HTTP, stateless, no key).

- **Claude Code:** `claude mcp add --transport http afg https://agenticfinancegraph.com/mcp`
- **Cursor, Windsurf, VS Code and other clients:** add a remote MCP server with that URL.

## Clients that only speak stdio (Claude Desktop and others)

```json
{
  "mcpServers": {
    "afg": { "command": "npx", "args": ["-y", "github:AgenticFinanceGraph/agentic-finance-graph-mcp", "mcp"] }
  }
}
```

The `mcp` command forwards each JSON-RPC message to the remote endpoint. It has no dependencies; Node 18 or newer is enough.

## Tools

| Tool | What it returns |
|---|---|
| `market_state` | Headline figures, each with value, unit, measurement time and definition id |
| `find_agent` | One agent by token id, slug or wallet: rank, wallet, float, payment totals |
| `agent_record` | The free record of a ranked agent, with its 25 newest payments |
| `ranked_agents` | Top ranked agents (L7+), optionally from a minimum level |
| `detections` | Newest detections, optionally for one agent |
| `definition` | A frozen metric definition: method, exclusions, what it does not claim |
| `metric_history` | One metric over 24h, 7d, 30d or 90d |
| `evidence_pack_quote` | Price and URL of a paid evidence pack (1 to 25 cents in USDC over x402); it does not pay |

## CLI

```
npx -y github:AgenticFinanceGraph/agentic-finance-graph-mcp state
npx -y github:AgenticFinanceGraph/agentic-finance-graph-mcp find 57657
npx -y github:AgenticFinanceGraph/agentic-finance-graph-mcp ranked 10 9
npx -y github:AgenticFinanceGraph/agentic-finance-graph-mcp history actors_l7_plus 30d
```

Or install it once: `npm install -g github:AgenticFinanceGraph/agentic-finance-graph-mcp`, then run `afg state`.

## How the numbers are counted

Every figure carries its definition id and the time it was measured. Call `definition` before quoting one, or read them all at [agenticfinancegraph.com/def](https://agenticfinancegraph.com/def). A figure that turns out wrong is corrected publicly, with a date, in the [changelog](https://agenticfinancegraph.com/changelog-september-2026-what-we-added-and-what-it-measures).

## Security

[![Plugin Security Scan](https://github.com/AgenticFinanceGraph/agentic-finance-graph-mcp/actions/workflows/plugin-security-scan.yml/badge.svg)](https://github.com/AgenticFinanceGraph/agentic-finance-graph-mcp/actions/workflows/plugin-security-scan.yml)

Every push and pull request is scanned by the HOL AI Plugin Scanner, pinned to an exact commit and run with read-only permissions. Dependabot watches the workflow's actions. The package has no dependencies, and the server it talks to is read-only: nothing here can move funds. Found a problem? See [SECURITY.md](SECURITY.md). What changed and when: [CHANGELOG.md](CHANGELOG.md).

## Work with us

- **Builders:** see [where we need help](CONTRIBUTING.md) — MCP clients, framework adapters, a Python client, recipes. We are open to people who want to join the founding team.
- **Platforms, institutions and investors:** [agenticfinancegraph.com/contact](https://agenticfinancegraph.com/contact)
- **Agents:** `POST https://agenticfinancegraph.com/api/contact` with `{kind, message, reply_to}`.

[X @AgenticGraph](https://x.com/AgenticGraph) · [Telegram](https://t.me/AgenticFinanceGraph) · [agenticfinancegraph@proton.me](mailto:agenticfinancegraph@proton.me) · ERC-8004 agent #95875 on Base

## Licence

Apache-2.0 for the code in this repository. The data served by the endpoint is Agentic Finance Graph's; quote it with the definition id and the measurement time.
