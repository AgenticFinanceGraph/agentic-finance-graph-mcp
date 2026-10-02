#!/usr/bin/env node
/* afg — Agentic Finance Graph from the command line, and a stdio bridge to its MCP server.
   No dependencies: Node 18+ (global fetch). Everything goes through the public, read-only
   MCP endpoint, so the CLI and an MCP client always see the same answers.

   afg state                      headline figures with measurement times
   afg find <id|slug|0xwallet>    look up one agent
   afg agent <id>                 the free record of a ranked agent
   afg ranked [n] [min_level]     top ranked agents (n <= 25)
   afg detections [agent] [n]     newest detections
   afg def <definition-id>        a frozen metric definition
   afg history <metric> [range]   a metric's history (24h, 7d, 30d, 90d)
   afg quote <kind> <id>          price and URL of an evidence pack (does not pay)
   afg mcp                        run as a stdio MCP server (for clients without remote MCP)
   afg tools                      list the tools

   Environment: AFG_MCP_URL overrides the endpoint (default https://agenticfinancegraph.com/mcp). */
const URL_ = process.env.AFG_MCP_URL || "https://agenticfinancegraph.com/mcp";
const VERSION = "0.1.1";

async function post(msg) {
  const r = await fetch(URL_, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "user-agent": "afg-cli/" + VERSION }, body: JSON.stringify(msg), signal: AbortSignal.timeout(30000) });
  if (r.status === 202) return null;
  const t = await r.text();
  try { return JSON.parse(t); } catch { throw new Error("unexpected answer from " + URL_ + " (HTTP " + r.status + ")"); }
}
async function tool(name, args) {
  const j = await post({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
  if (j.error) throw new Error(j.error.message);
  const text = (j.result.content || []).map((c) => c.text || "").join("\n");
  if (j.result.isError) throw new Error(text);
  try { return JSON.parse(text); } catch { return text; }
}
const print = (x) => process.stdout.write((typeof x === "string" ? x : JSON.stringify(x, null, 2)) + "\n");

async function bridge() {
  /* newline-delimited JSON-RPC on stdin/stdout, forwarded to the remote endpoint */
  let buf = "";
  const queue = [];
  let busy = false;
  const pump = async () => {
    if (busy) return; busy = true;
    while (queue.length) {
      const line = queue.shift();
      let msg; try { msg = JSON.parse(line); } catch { process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }) + "\n"); continue; }
      try { const out = await post(msg); if (out) process.stdout.write(JSON.stringify(out) + "\n"); }
      catch (e) { if (msg && msg.id != null) process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, error: { code: -32603, message: String(e.message || e) } }) + "\n"); }
    }
    busy = false;
  };
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (line) queue.push(line); }
    pump();
  });
  process.stdin.on("end", () => { const line = buf.trim(); if (line) queue.push(line); pump(); });
}

const [cmd, a1, a2] = process.argv.slice(2);
try {
  switch (cmd) {
    case "state": { const s = await tool("market_state", {}); const rows = Object.entries(s.figures).map(([k, v]) => k.padEnd(36) + String(v.value).padStart(16) + "  " + (v.unit || "") + "  " + (v.as_of || "")); print("as of " + s.as_of + "\n" + rows.join("\n")); break; }
    case "find": print(await tool("find_agent", { query: a1 || "" })); break;
    case "agent": print(await tool("agent_record", { id: a1 || "" })); break;
    case "ranked": print(await tool("ranked_agents", Object.assign({ limit: Number(a1) || 10 }, a2 ? { min_level: Number(a2) } : {}))); break;
    case "detections": print(await tool("detections", Object.assign({ limit: Number(a2) || 10 }, a1 ? { agent: a1 } : {}))); break;
    case "def": print(await tool("definition", { id: a1 || "" })); break;
    case "history": print(await tool("metric_history", { key: a1 || "", range: a2 || "30d" })); break;
    case "quote": print(await tool("evidence_pack_quote", { kind: a1 || "", id: a2 || "" })); break;
    case "tools": { const j = await post({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }); print(j.result.tools.map((t) => t.name.padEnd(22) + t.title).join("\n")); break; }
    case "mcp": await bridge(); break;
    case "--version": case "-v": print(VERSION); break;
    default: print("afg " + VERSION + " — Agentic Finance Graph from the command line\n\n  afg state | find <q> | agent <id> | ranked [n] [level] | detections [agent] [n]\n  afg def <id> | history <metric> [range] | quote <kind> <id> | tools | mcp\n\nData: " + URL_);
  }
} catch (e) { process.stderr.write("afg: " + (e.message || e) + "\n"); process.exit(1); }
