# Changelog

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
