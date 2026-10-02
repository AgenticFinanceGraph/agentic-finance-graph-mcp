# Changelog

## 0.1.1 — 2 October 2026

- **Security scanning on every push and pull request.** The [HOL AI Plugin Scanner](https://github.com/hashgraph-online/ai-plugin-scanner-action) runs in GitHub Actions with read-only permissions, pinned to an exact commit. Its first run scored the repository 88/100 and asked for two things, both done here:
  - a lockfile (`package-lock.json`), so dependency resolution is reproducible. The package still has no dependencies;
  - Dependabot (`.github/dependabot.yml`), which now watches the GitHub Actions and npm manifests weekly.
- **More in `market_state`** (server side, nothing to update in this client): where counted agent money that left Base through bridges arrived, how much of it reached the paying wallet's own address on the other chain, the share of counted money by the paying wallet's account type (contract account, plain key, EIP-7702 delegated), and our own count of ERC-8004 registrations on BNB Smart Chain. Each figure carries its definition id; call `definition` for the method.

## 0.1.0 — 28 September 2026

First release: the remote MCP endpoint, the stdio bridge (`afg mcp`) and the `afg` CLI.
