# Contributing

Thank you for looking. Anyone can open an issue or a pull request here; changes are merged by the maintainers after review. Please never include private keys, API keys, seed phrases or personal data in an issue or a pull request.

## Where we need help

These are open and welcome. Open an issue first if you plan something large, so two people do not build the same thing.

1. **More MCP clients, tested.** A short, verified setup for Claude Desktop, Cursor, Windsurf, VS Code, Cline, Zed or any other client, added to the README with the client version you tested.
2. **Agent framework adapters.** A thin tool wrapper so agents built with Coinbase AgentKit, ElizaOS, GOAT, LangChain, CrewAI or the OpenAI Agents SDK can ask the eight tools. Read-only, no keys.
3. **A Python client.** The same eight tools and the same CLI commands, standard library only if possible.
4. **Figures you reproduce differently.** If you count an agent's payments, float or level from Base yourself and get a different number, open an issue with your source, window and method. If the difference is ours, it is corrected publicly with a date.
5. **Examples.** Short, working recipes: "alert me when an agent I watch stops paying", "check an agent before my agent pays it", "weekly summary of the market".
6. **Docs and translations** of the README and the setup guide.

## How a change is reviewed

- The CLI and bridge stay dependency-free and read-only. Nothing in this repository may sign, hold or move funds.
- Every figure shown to a user keeps its definition id and measurement time.
- Small, focused pull requests are merged fastest.

## Reporting a problem with the server

If a tool returns an error, a wrong figure or a slow answer, open an issue with the tool name, the arguments and the time (UTC). For anything security-related, see [SECURITY.md](SECURITY.md) instead of opening a public issue.
