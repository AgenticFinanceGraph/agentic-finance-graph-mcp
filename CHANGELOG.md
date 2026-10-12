# Changelog

## 0.2.3 — 12 October 2026, later

- **Prompts on the server** (MCP server 1.3.0): `daily_brief`, `check_before_paying`, `explain_agent` and `where_agents_pay`. Clients such as Claude list them in the prompt menu; nothing to install.
- **Typed results:** `market_state`, `ranked_agents` and `agent_record` return `structuredContent` with an `outputSchema`, so a client can read the fields without parsing text.
- **Protocol:** the server negotiates MCP 2025-11-25 as well as 2025-06-18, 2025-03-26 and 2024-11-05, and declares its prompts and resources.
- `market_state` notes that `actors_l8_plus` moves in steps when an operator funds a fleet of its own registrations, and that `actors_l9` is the steadier measure.
- The bridge and the CLI are unchanged.

## 0.2.2 — 12 October 2026

- **Three new paid packs on the server** (MCP server 1.2.0), quoted by `evidence_pack_quote`:
  - `precheck` (5 cents): the routine check before an agent pays or hires another. Its level and last observed payment, live incidents, how old its latest statement is and whether the chain is intact, and, with `payto`, what the address it gave you is: label and basis, contract or plain key, how many registered agents paid it, whether this agent paid it before, and whether our poisoning watch saw it planted as a look-alike. Facts only, never a verdict.
  - `venue` (3 cents): what one address on Base is, who pays it, and its stablecoin flow over the last 48 hours, read live.
  - `builders` (1 cent): the ERC-8021 Builder Codes on one agent's counted payments.
- `evidence_pack_quote` takes an optional `payto`; the CLI passes it as a third argument: `afg quote precheck 53008 0x…`.
- The skill `afg-check-agent` (0.2.0) names the precheck as the one-call version of its workflow.

## 0.2.1 — 9 October 2026

- **A Dockerfile** for the stdio bridge, so directories that start servers from source (Glama) can introspect it: `docker run -i --rm afg-mcp` serves the same eleven read-only tools by forwarding to the remote endpoint.
- **Where it is listed**, in the README: the official MCP Registry as `com.agenticfinancegraph/agentic-finance-graph` (publisher verified by domain), Smithery, Glama (health-checked), and the paid evidence packs in the Coinbase x402 Bazaar and on x402scan.

## 0.2.0 — 5 October 2026

- **Three new tools on the server**, so nothing to install for MCP clients; this release adds them to the CLI:
  - `since_last` (`afg since <metric> [window]`): a figure beside the stored sample it moved from, with both timestamps, the definition id and whether the move is material. No prior sample is reported as a gap, never as a zero change. `market_state` now also carries its headline figures this way.
  - `counterparty_preview` (`afg payers [address]`): who paid a receiving address, counts only. An address that only received routing hops is not a payee. With no address it lists the endpoints the most ranked agents pay.
  - `agent_statement` (`afg statement <id>`): an agent's latest 3-hour statement, hash-chained to the previous one and provable against an Ed25519-signed Merkle root. Check it before you pay.
- **Two new paid packs**, quoted by `evidence_pack_quote`: `counterparty` (2 cents, the payer list with binding confidence and transaction hashes) and `statement` (1 cent, the last 24 statements with proofs).
- `detections` rows now carry an evidence pointer and the id of the detector's published record; `ranked_agents` and `agent_record` carry the binding method, confidence and wallet set.

## 0.1.1 — 2 October 2026

- **Security scanning on every push and pull request.** The [HOL AI Plugin Scanner](https://github.com/hashgraph-online/ai-plugin-scanner-action) runs in GitHub Actions with read-only permissions, pinned to an exact commit. Its first run scored the repository 88/100 and asked for two things, both done here:
  - a lockfile (`package-lock.json`), so dependency resolution is reproducible. The package still has no dependencies;
  - Dependabot (`.github/dependabot.yml`), which now watches the GitHub Actions and npm manifests weekly.
- **More in `market_state`** (server side, nothing to update in this client): where counted agent money that left Base through bridges arrived, how much of it reached the paying wallet's own address on the other chain, the share of counted money by the paying wallet's account type (contract account, plain key, EIP-7702 delegated), and our own count of ERC-8004 registrations on BNB Smart Chain. Each figure carries its definition id; call `definition` for the method.

## 0.1.0 — 28 September 2026

First release: the remote MCP endpoint, the stdio bridge (`afg mcp`) and the `afg` CLI.
