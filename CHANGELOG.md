# Changelog

## 0.2.6 — 13 October 2026 (server 1.6.0)

Nothing to install for MCP clients; the CLI is unchanged.

- **The liveness ladder as the code runs it.** Ranks now follow `rank.l7plus.v2` (money left the agent's control: not into its own lending or vault position, not to its own addresses, not a bridge leg that came back), `rank.l8plus.v3` and `rank.l9.v3` (three independent counterparties: contract code, or paid by two or more agents). L6 is measured (`probe.l6.protocol.v1`: an MCP, A2A or x402 handshake) and L5 reads up to 8 endpoints in any order (`probe.l5.endpoint_live.v2`). `definition` resolves a superseded id to its successor; the dated changes are in `/api/changepoints`.
- **A new pack, `exit`** (3 cents), quoted by `evidence_pack_quote`: every window in which a new payee took most of an agent's outflow within 72 hours, its status under `drain.abandoned.v1` (candidate, pending, resumed, service) and the second hop read live. Candidates, never verdicts.
- **A2A.** The same read-only checks answer at `/api/a2a` (JSON-RPC 0.3 `message/send`); the agent card points there.
- **Builder Codes** are now read inside smart-wallet UserOperations as well (`pay.builder.attribution.v2`).
- The skill `afg-check-agent` (0.3.1) states the rungs as above.

## 0.2.5 — 12 October 2026, night (server 1.5.0)

Nothing to install for MCP clients; the CLI is unchanged.

- **A new tool, `payer_set`.** It returns the wallets observed paying one agent (income into its bound wallets, plus counted payments from other registered agents), up to 250, with payments, USD and first and last paid. It also says how much of the agent's ERC-8004 feedback is payment-grounded, meaning the reviewer paid before rating. `get_summary_input` is ready for the Reputation Registry's `getSummary(agentId, clientAddresses)`, the reviewer filter the standard asks for. It is also served at `/api/payers?agent=`. Paying first does not make a reviewer independent: one agent's 85 reviews all came from one wallet that pays it.
- **Address-poisoning rule v2.** The watch now also counts a look-alike that matches a payee on the first 3 and last 4 hex characters, the threshold of Tsuchiya, Dong, Soska and Christin (USENIX Security 2025), and still counts fake-token plants that match only the last 4. Measured before the change:
  - of 82,132 plants either rule counts, the old rule found 80,509 and the paper's 80,880;
  - a second read from the chain found every one of 300 sampled plants sent by somebody other than the wallet.
  
  `poison.*.v2` definitions; v1 is kept and marked superseded.
- **A statement log that cannot be quietly rewritten.** Every signed statement-window root is a leaf of an append-only log in the shape of Certificate Transparency (RFC 6962), with a signed tree head and consistency and inclusion proofs at `/api/statements/log`.
- **Endpoint-domain verification** in the liveness sweep (ERC-8004's `/.well-known/agent-registration.json`), and a data check for unexplained steps in our own series, with the list at `/api/steps`. Both are listed by `list_metrics` and dated in `/api/changepoints`.

## 0.2.4 — 12 October 2026, evening (server 1.4.0)

After a second outside review worked through every tool. Nothing to install for MCP clients; the CLI is unchanged.

- **Two new tools.** `pay_check`: one free call before paying an agent (statement freshness and chain, live incidents, detections in the last 72 hours, last payment, payments since the statement, which documented refuse conditions are met). `list_metrics`: every metric with key, unit, definition id, first stored sample and `comparable_since`.
- **Our own changes, dated.** A register of coverage, method, label and detector-rule changes at `/api/changepoints`; `metric_history` returns the ones inside the range and `comparable_since`; `since_last` flags `changepoint_in_window`; `market_state` figures carry `comparable_since`. The 27 September sweep (four stablecoins, every bound wallet) is the big one: agent counts compare from 3 October.
- **What counted spending consists of.** `market_state.composition`: ten parts from one pass that add up to the counted total (own positions 52%, bridges 17.5%, work escrow 16.8%, swaps 3.3%, other agents 0.4%, x402 sellers 0.01%, unnamed 9.9% on 12 October), plus `pay_usd_left_control_net_self_bridge` and the labelled share by value; a `data_quality` block; `pay_usd_last_day` names its day and provisional days are listed apart.
- **Definitions.** `rank.l8plus.v2` and `rank.l9.v2` state the four-stablecoin rule the counts have followed since 27 September (v1 said USDC; superseded, still served). Every definition returns dated `revisions` and `body_sha256`; an unknown id returns the nearest ids.
- **Smaller.** `metric_history` links each metric's own definition (it pointed at `/api/state`); `since_last` answers `material` for every metric (`threshold_source` says published or default); `ranked_agents` states its order and takes `sort_by`; `detections` filters by kind, severity, time and live incidents, with `compact`; `find_agent` matches declared names and takes up to 25 ids; `agent_statement` and the statement pack show amounts in dollars beside the signed base units; `x402_seller` is `false` when checked and not a seller, `null` only when not checked; the check before paying also stops on a live incident.
- **For a new user.** A `start_here` prompt, server instructions that tell the client how to give the tour, and three resources (`afg://guide`, `afg://changepoints`, `afg://definitions`).

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
