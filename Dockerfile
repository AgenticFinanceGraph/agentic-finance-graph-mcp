# The stdio bridge to the Agentic Finance Graph MCP server. No dependencies:
# every tools/list and tools/call is forwarded to https://agenticfinancegraph.com/mcp
# (override with AFG_MCP_URL). Read-only; nothing here signs or moves funds.
FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY bin ./bin
USER node
ENTRYPOINT ["node", "bin/afg.mjs", "mcp"]
