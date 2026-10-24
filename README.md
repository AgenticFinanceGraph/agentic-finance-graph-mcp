# Agentic Finance Graph — MCP server and CLI

Ask the independent ledger of machine money directly from Claude, Cursor, an agent framework or your terminal: which AI agents on Base actually pay, how much of their money was really spent, any agent's record, detections, metric histories and the price of an evidence pack.

Read-only and free. Nothing here can move funds, and nothing here needs a key.

**Website:** [agenticfinancegraph.com](https://agenticfinancegraph.com) · **Setup guide:** [MCP server, step by step](https://agenticfinancegraph.com/mcp-server-connect-your-ai-to-agent-money-data) · **Definitions:** [every figure, defined](https://agenticfinancegraph.com/def)

**Listed in:** the [official MCP Registry](https://registry.modelcontextprotocol.io/?q=com.agenticfinancegraph) as `com.agenticfinancegraph/agentic-finance-graph` (publisher verified by domain) · [Smithery](https://smithery.ai/search?q=agentic%20finance%20graph) · [Glama](https://glama.ai/mcp/connectors/com.agenticfinancegraph/agentic-finance-graph) (health-checked) · the paid evidence packs in the [Coinbase x402 Bazaar](https://docs.cdp.coinbase.com/x402/bazaar) and on [x402scan](https://www.x402scan.com)

## The same data on the website (30 seconds)

https://github.com/user-attachments/assets/ee95c1e9-54c2-49fc-b756-5ab58203861d

*The Desk at [agenticfinancegraph.com/desk](https://agenticfinancegraph.com/desk): connect a wallet, watch any agent, see its history, request the data for 1 cent. The MCP tools below read the same ledger.*

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

Or run the same bridge in a container (the image holds only the bridge; every answer still comes from the remote endpoint):

```bash
docker build -t afg-mcp https://github.com/AgenticFinanceGraph/agentic-finance-graph-mcp.git
docker run -i --rm afg-mcp
```

## Tools

| Tool | What it returns |
|---|---|
| `market_state` | Headline figures, each with value, unit, measurement time and definition id |
| `find_agent` | An agent by token id, slug, wallet or declared name, or up to 25 ids at once: rank (and when it last changed), age, wallet, float, payment totals, open incidents |
| `agent_record` | The free record of a ranked agent, with its 25 newest payments |
| `ranked_agents` | Top ranked agents (L7+), optionally from a minimum level |
| `detections` | Newest detections, filtered by agent, kind, severity, time or live incidents only |
| `definition` | A frozen metric definition: method, exclusions, what it does not claim |
| `metric_history` | One metric over 24h, 7d, 30d or 90d, with its own definition, our dated changes inside the range and the date from which it compares |
| `list_metrics` | Every metric we measure: key, unit, definition id, first stored sample, `comparable_since` |
| `since_last` | One figure beside the stored sample it moved from (previous sample, 24h, 7d or 30d); no prior sample is a gap, never a zero |
| `counterparty_preview` | Who paid a receiving address: counted payments, distinct payers, distinct L7+ payers (counts only) |
| `agent_statement` | An agent's latest 3-hour statement, hash-chained and provable against a signed Merkle root: check it before you pay |
| `pay_check` | One free call before paying an agent: statement freshness and chain, live incidents, detections in the last 72 hours, the token approvals its wallet has given (unlimited ones, and any to a plain account), last payment, payments since the statement, and which refuse conditions are met. Facts, never a verdict |
| `payer_set` | The wallets observed paying one agent (up to 250), and how much of its ERC-8004 feedback came from wallets that paid it first. The list is ready to pass to the Reputation Registry's `getSummary` as `clientAddresses` |
| `agent_stability` | Stable for N days: complete UTC days since the last break in an agent's own payment behaviour (a CUSUM against its own history), the last break, and its 30-day heartbeat (scheduled, irregular, bursty, sparse). A break is a change, not a harm; the measured false-break rate is published |
| `agent_independence` | Whether an agent's rank rests on demand outside its own operator set: the seed-based best-path score, its L9 support under the published and the operator-set-aware rule, the inflation ratio, and the size of its operator set |
| `ladder_dynamics` | How ranked agents end (cumulative incidence of drained, abandoned, dormant with numbers at risk), the drain ratio per launch platform with intervals, the day-to-day transition matrix, and the landmark re-check of the survival figures |
| `verify_sum_log` | The skeptical client: verifies the Ed25519 signature on the Merkle-sum head over every counted payment, climbs one agent's proof to the root and the total, reports what changed since the head you kept, and verifies the statement log's signed head and consistency proof |
| `agent_pattern` | Shadow, since 16 Oct 2026: is the agent's newest counted payment in character for it ([`behaviour.out_of_character.v2`](https://agenticfinancegraph.com/def/behaviour.out_of_character.v2)): level none / notable / major with the reasons that fired, how many of its last 30 days of payments scored, and the market's rates. A level is a pattern for a human to read, never a verdict; nothing is blocked from it |
| `payee_facts` | Seven measured facts about an address an agent is about to pay ([`payee.facts.v1`](https://agenticfinancegraph.com/def/payee.facts.v1)): code kind and any known sweeper delegate, relay shape, swaps into unfreezable assets, who funds it and where it exits, claim-on-proof selectors, issuer freeze, how many registered agents pay it; with the paying agent and the amount, whether it is a never-paid destination at a new size or a look-alike of an address in the agent's history. Each fact carries value, evidence, method and time; an unavailable channel is said, never guessed |
| `gate_check` | Log-only: can this agent pay this address, now, this much? The payee facts, the agent's own context from our ledger (past-only, never from the caller), the out-of-character level of the payment, and a decision under a policy in the AP2 mandate vocabulary (`allowed_payees`, `amount_range`, `budget`, `agent_recurrence`, `execution_date`; ours: `new_payee`, `refuse_conditions`, `signal`) — block / warn / log / allow with every reason, recorded. Unknown constraints fail closed. Named policies: `log-only` (default), `balanced`, `recommended`, `recommended-v3`, `strict`. We never block anything; your client decides, and decides its own fail mode |
| `agent_pass` | The Agent Pass ([`agent.pass.v2`](https://agenticfinancegraph.com/def/agent.pass.v2)): eight checks on an agent at one moment, valid three hours — level L7+, no open harm-kind incident, a counted payment in 30 days, newest payment in character, no issuer freeze, no unlimited approval to a plain key, no harm-kind incident in 90 days, a month in character. Holds or not, what failed, what could not be checked (listed, never written as 0), the issuer's public key. Shadow: unsigned until the shadow is lifted. It never says safe, verified or trusted |
| `blast_radius` | What a stolen key would move at one block ([`agent.blast_radius.v1`](https://agenticfinancegraph.com/def/agent.blast_radius.v1)): priced balances and ETH, the EIP-7702 delegate and any known sweeper family, open allowances confirmed on chain and capped at the balance. Agents at L8 or above, read every six hours |
| `canary_register`, `canary_status` | For signed-in operators (send `Authorization: Bearer <Desk session>` with the request): register the public part of a decoy you planted (a bait key that never holds a balance, an address, a URL hash, an API-key hash, a tool name, a paid resource) and read your canaries' state and fires ([`canary.trigger.v1`](https://agenticfinancegraph.com/def/canary.trigger.v1)). Private material is refused before validation; nothing about a plant is ever published |
| `evidence_pack_quote` | Price and URL of a paid evidence pack (1 to 25 cents in USDC over x402); it does not pay. `precheck` (5 cents) is the routine check before you pay or hire an agent, and takes `payto`, the address you were given; `venue` (3 cents) says what one address is; `builders` (1 cent) lists the ERC-8021 Builder Codes on an agent's payments; `exit` (3 cents) lists the windows in which a new payee took most of an agent's outflow, whether it paid anyone after, and where the money went next (candidates under `drain.abandoned.v1`, never verdicts); `trace` (5 cents) follows an agent's exits live up to three hops, with each hop's label, kind, issuer freeze, swap out of a freezable token and Tron activity (`check.trace.v1`) |

`market_state`, `ranked_agents` and `agent_record` also return typed results (`structuredContent`, described by an `outputSchema`). `market_state` carries a `composition` block (what counted spending consists of, ten parts that add up to the cent) and our data-quality checks; every figure that our own coverage changes touched carries `comparable_since`, and the dated register of those changes is at [/api/changepoints](https://agenticfinancegraph.com/api/changepoints). The server speaks MCP 2025-11-25 and the earlier versions. The same read-only checks also answer over A2A (JSON-RPC `message/send`) at `https://agenticfinancegraph.com/api/a2a`; the agent card is at `/.well-known/agent-card.json`.

**Just connected?** Tell your AI, in your own words: *"I connected Agentic Finance Graph. Look through what it offers and show me what we can do with it."* The server's instructions tell it how to give the tour with today's figures. Three resources are also served: `afg://guide`, `afg://changepoints`, `afg://definitions`.

## Prompts

Ready-made workflows. Clients such as Claude show them in the prompt menu once the server is connected.

| Prompt | What it does |
|---|---|
| `start_here` | A guided tour with today's real figures: what the ledger measures and the questions worth asking it |
| `daily_brief` | What moved in the last 24 hours: rank, spending and new detections, each figure with its time and definition id |
| `check_before_paying` (`agent`, optional `payto`) | The routine check before your agent pays or hires another: its statement, level and flags, and who has paid the address you were given. It refuses on a stale statement, a broken chain or open flags, and never pays without your approval |
| `explain_agent` (`agent`) | One agent in plain words: its level and why, what it paid and to whom, its flags, and what the data cannot show |
| `where_agents_pay` | The endpoints the most ranked agents pay, with counts |

## CLI

```
npx -y github:AgenticFinanceGraph/agentic-finance-graph-mcp state
npx -y github:AgenticFinanceGraph/agentic-finance-graph-mcp find 57657
npx -y github:AgenticFinanceGraph/agentic-finance-graph-mcp ranked 10 9
npx -y github:AgenticFinanceGraph/agentic-finance-graph-mcp history actors_l7_plus 30d
npx -y github:AgenticFinanceGraph/agentic-finance-graph-mcp since actors_l7_plus 24h
npx -y github:AgenticFinanceGraph/agentic-finance-graph-mcp payers 0x4cd00e387622c35bddb9b4c962c136462338bc31
npx -y github:AgenticFinanceGraph/agentic-finance-graph-mcp statement 53008
npx -y github:AgenticFinanceGraph/agentic-finance-graph-mcp quote precheck 53008 0x0e84ddedaae6a779c462c22a59f301ec31b6b808
npx -y github:AgenticFinanceGraph/agentic-finance-graph-mcp verify 45978
npx -y github:AgenticFinanceGraph/agentic-finance-graph-mcp chaincheck 57067
npx -y github:AgenticFinanceGraph/agentic-finance-graph-mcp logwatch
npx -y github:AgenticFinanceGraph/agentic-finance-graph-mcp pattern 57657
npx -y github:AgenticFinanceGraph/agentic-finance-graph-mcp facts 0x424b266c22509a9eb47bcb5b908f40c1157cc2a1 45978 100
npx -y github:AgenticFinanceGraph/agentic-finance-graph-mcp gate 45978 0x424b266c22509a9eb47bcb5b908f40c1157cc2a1 100 recommended-v3
npx -y github:AgenticFinanceGraph/agentic-finance-graph-mcp pass 57657
npx -y github:AgenticFinanceGraph/agentic-finance-graph-mcp blast 57657
```

## The security layer (shadow since 16 Oct 2026)

A check before an agent pays (`gate_check`, `payee_facts`), a watch after it (`agent_pattern`), a three-hour signed statement of what was measured (`agent_pass`), what a stolen key would move (`blast_radius`) and planted decoys (`canary_register`, `canary_status`). Everything is measured from the chain and the ledger, never from what an agent says; every answer carries its measurement time and definition id; nothing is a verdict, and in shadow mode nothing is blocked or alerted. How it works, with live figures: [agenticfinancegraph.com/security](https://agenticfinancegraph.com/security).

### Gate hook for x402 clients

[`bin/x402-gate-hook.mjs`](bin/x402-gate-hook.mjs) is an `onBeforePaymentCreation` hook for `@x402/core` 2.x clients. Before the scheme signs, it asks `gate_check` with your agent, the payee, the USD value of what will be signed and your policy, and aborts on the decisions you choose. The default aborts on `block` only and, when AFG cannot be reached, allows and logs a warning (`onUnavailable: "warn"`); `"abort"` fails closed, `"allow"` fails open. No dependencies; tested against a stand-in server (`npm test`).

```js
import { makeGateHook } from "agentic-finance-graph-mcp/bin/x402-gate-hook.mjs";
client.onBeforePaymentCreation(makeGateHook({ agent: "45978", policy_name: "recommended-v3", abortOn: ["block"], log: console.log }));
```

The hook prices USDC, USDT and DAI on Base; other assets and networks are allowed and logged as not checked. A payment the Gate blocks is a block in your client, never ours: AFG records the decision and moves nothing.

`afg verify <agent-id>` trusts nothing it did not recompute: it fetches the signed head of the Merkle-sum log ([`sumlog.v1`](https://agenticfinancegraph.com/def/sumlog.v1)) and the agent's proof, rebuilds the leaf and the path to `head.agent_root`, checks that the summed amount equals the whole counted total, and verifies the Ed25519 signature on the head. One line per check; exit code 1 on any failure. Set `AFG_SUMLOG_PUBKEY` to the 32-byte hex key you were given out of band to stop trusting the key printed in the answer.

`afg chaincheck <agent-id>` checks an agent's free record against the chain itself, through a public Base RPC we do not run (`https://mainnet.base.org` by default; set `AFG_BASE_RPC` to use your own). It reads the mint transaction (minted to the stated account, at the stated time), calls the registry for each open binding (`ownerOf`, `getAgentWallet`; a minting-account binding must equal the account the registration was minted to), and reads the receipt of every payment in the record's money path: a successful USDC, USDT, EURC or DAI transfer, by contract address, from one of the agent's bound wallets to the stated recipient, for the stated amount, after the registration. One line per claim; a claim the RPC did not return is shown as unread, never as passed; exit code 1 if any claim read from the chain does not hold.

`afg editioncheck <period>` is a reader's check of a [State of Agent Money](https://agenticfinancegraph.com/state-of-agent-money-2026-09) edition (`2026-09`, or a quarter such as `2026-Q4`). It fetches the edition file, confirms its SHA-256 is the hash committed to the statement log, re-derives the registrations minted in the period and the total at its end from the ERC-8004 Identity Registry at the period's first and last block (agent ids are sequential, so the highest id that answers `ownerOf` at a block is the count; a public Base RPC we do not run, `AFG_BASE_RPC` to use your own), and checks that every definition id the edition cites resolves. Counted payments are not re-derived here, because they need the ledger's binding set; `afg chaincheck <agent>` does that for one agent. Exit code 1 if any check fails.

`afg logwatch [state-file]` is an outside monitor for the [statement log](https://agenticfinancegraph.com/def/agent.statement.log.v1) (RFC 6962 tree of every signed 3-hour statement root). Run it once and keep running it, a daily cron is enough.
- **Every run:** it checks the Ed25519 signature on the current signed tree head.
- **Later runs:** it fetches a consistency proof from the head it kept last time and verifies it the RFC 9162 way.
- **A failed proof** means the published history was rewritten. A shrinking tree or a changed signing key is reported too.
- **Where the head is kept:** `~/.afg-statement-log.json` by default. `AFG_LOG_PUBKEY` pins the key.

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

## Agent skill: check an agent before paying it

A skill file for assistants and agent frameworks that already speak Agent Skills (Claude Code, Cursor, Codex, OpenClaw and the rest): [skills/afg-check-agent/SKILL.md](skills/afg-check-agent/SKILL.md). It tells the assistant how to use this MCP server before money moves: find the agent, read its record and its signed three-hour statement, read the detections on it and the counterparty it is about to pay, and report evidence with definitions and measurement times, never a verdict.

```bash
npx skills add AgenticFinanceGraph/agentic-finance-graph-mcp --skill afg-check-agent
```

## Licence

Apache-2.0 for the code in this repository. The data served by the endpoint is Agentic Finance Graph's; quote it with the definition id and the measurement time.
