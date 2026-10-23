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
   afg quote <kind> <id> [payto]  price and URL of an evidence pack (does not pay); precheck takes the address you are about to pay
   afg verify <agent-id>          recompute one agent's proof against the signed Merkle-sum head (exit 1 on failure)
   afg chaincheck <agent-id>      check the agent's free record against a public Base RPC: its mint, its open bindings, every payment in its money path (exit 1 on failure)
   afg pattern <agent-id>         is the agent's newest payment in character for it (behaviour.out_of_character.v2, shadow)
   afg facts <payee> [agent] [usd] seven measured facts about an address before paying it (payee.facts.v1)
   afg gate <agent> <payee> <usd> [policy]   the Gate's decision under a named policy (log-only: recorded, never enforced by us)
   afg pass <agent-id>            the Agent Pass: eight checks at one moment, what held and what could not be checked
   afg blast <agent-id|0xwallet>  what a stolen key would move at one block (agent.blast_radius.v1)
   afg mcp                        run as a stdio MCP server (for clients without remote MCP)
   afg tools                      list the tools

   Environment: AFG_MCP_URL overrides the endpoint (default https://agenticfinancegraph.com/mcp);
   AFG_API_URL overrides the API origin for `verify` (default: the MCP URL without /mcp);
   AFG_BASE_RPC sets the RPC `chaincheck` reads (default https://mainnet.base.org, which we do not run);
   AFG_SUMLOG_PUBKEY pins the 32-byte hex Ed25519 key for `verify` instead of the one the head answer carries. */
import { forTerminal } from "./terminal.mjs";
import { verifyAgent } from "./sumlog.mjs";
import { chainCheck } from "./chaincheck.mjs";

const URL_ = process.env.AFG_MCP_URL || "https://agenticfinancegraph.com/mcp";
const API_ = process.env.AFG_API_URL || URL_.replace(/\/mcp\/?$/, "");
const VERSION = "0.3.1";

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
const print = (x) => process.stdout.write(forTerminal(typeof x === "string" ? x : JSON.stringify(x, null, 2)) + "\n");

async function getJson(path) {
  const r = await fetch(API_ + path, { headers: { accept: "application/json", "user-agent": "afg-cli/" + VERSION }, signal: AbortSignal.timeout(30000) });
  const t = await r.text();
  try { return JSON.parse(t); } catch { throw new Error("unexpected answer from " + API_ + path + " (HTTP " + r.status + ")"); }
}

/* afg verify <agent-id>: fetch the signed head and the agent's proof, recompute everything, print one line per check. */
async function verifyCmd(id) {
  if (!id) throw new Error("usage: afg verify <agent-id>");
  const headDoc = await getJson("/api/sum-log");
  const proofDoc = await getJson("/api/sum-log?agent=" + encodeURIComponent(id));
  if (proofDoc.ok === false || proofDoc.error) throw new Error("no proof for agent " + id + (proofDoc.error ? ": " + proofDoc.error : ""));
  const { ok, checks } = verifyAgent(headDoc, proofDoc, { publicKeyHex: process.env.AFG_SUMLOG_PUBKEY });
  const head = proofDoc.head || {};
  const rec = proofDoc.record || {};
  const lines = checks.map((c) => (c.ok ? "pass  " : "FAIL  ") + c.name + (c.detail ? "  (" + c.detail + ")" : ""));
  lines.push("", (ok ? "PASS" : "FAIL") + ": agent " + id + ", " + rec.leaves + " counted payments, " + rec.total_usd + " USD; head of " + new Date(Number(head.timestamp_ms)).toISOString() + ", " + head.leaves + " leaves, " + head.agents + " agents, key " + (head.key_id || "?") + (process.env.AFG_SUMLOG_PUBKEY ? " (pinned)" : " (from the head answer; pin it with AFG_SUMLOG_PUBKEY)"));
  print(lines.join("\n"));
  if (!ok) process.exit(1);
}

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

const [cmd, a1, a2, a3] = process.argv.slice(2);
try {
  switch (cmd) {
    case "state": { const s = await tool("market_state", {}); const rows = Object.entries(s.figures).map(([k, v]) => k.padEnd(36) + String(v.value).padStart(16) + "  " + (v.unit || "") + "  " + (v.as_of || "")); print("as of " + s.as_of + "\n" + rows.join("\n")); break; }
    case "find": print(await tool("find_agent", { query: a1 || "" })); break;
    case "agent": print(await tool("agent_record", { id: a1 || "" })); break;
    case "ranked": print(await tool("ranked_agents", Object.assign({ limit: Number(a1) || 10 }, a2 ? { min_level: Number(a2) } : {}))); break;
    case "detections": print(await tool("detections", Object.assign({ limit: Number(a2) || 10 }, a1 ? { agent: a1 } : {}))); break;
    case "def": print(await tool("definition", { id: a1 || "" })); break;
    case "history": print(await tool("metric_history", { key: a1 || "", range: a2 || "30d" })); break;
    case "quote": print(await tool("evidence_pack_quote", Object.assign({ kind: a1 || "", id: a2 || "" }, a3 ? { payto: a3 } : {}))); break;
    case "since": print(await tool("since_last", { metric_id: a1 || "", window: a2 || "sweep" })); break;
    case "payers": print(await tool("counterparty_preview", a1 ? { address: a1 } : {})); break;
    case "statement": print(await tool("agent_statement", { id: a1 || "" })); break;
    case "verify": await verifyCmd(a1); break;
    case "chaincheck": {
      if (!a1) throw new Error("usage: afg chaincheck <agent-id>");
      const rec = await tool("agent_record", { id: a1 });
      if (!rec || !rec.agent) throw new Error("no record for " + a1 + (rec && rec.error ? ": " + (rec.error.message || rec.error) : ""));
      const res = await chainCheck(rec);
      const lines = res.checks.map((c) => (c.ok === true ? "pass  " : c.ok === null ? "unread " : "FAIL  ") + c.name + (c.detail ? "  (" + c.detail + ")" : ""));
      lines.push("", (res.ok ? "PASS" : "FAIL") + ": " + res.checks.filter((c) => c.ok === true).length + "/" + res.checks.length + " claims in the record of agent " + rec.agent.token_id + " (as of " + res.as_of + ") hold on " + res.rpc + (res.unread ? "; " + res.unread + " could not be read from it" : "") + (res.failed ? "; " + res.failed + " did not hold" : ""));
      print(lines.join("\n"));
      if (!res.ok) process.exit(1);
      break;
    }
    /* 16 Oct 2026: the security layer (shadow / log-only): pattern, facts, gate, pass, blast */
    case "pattern": print(await tool("agent_pattern", { agent: a1 || "" })); break;
    case "facts": print(await tool("payee_facts", Object.assign({ payee: a1 || "" }, a2 ? { agent: a2 } : {}, a3 ? { amount_usd: Number(a3) } : {}))); break;
    case "gate": {
      const amount = Number(a3);
      if (!a1 || !a2 || !Number.isFinite(amount)) throw new Error("usage: afg gate <agent> <payee 0x…> <usd> [policy: log-only|balanced|recommended|recommended-v3|strict]");
      const policy = process.argv[6] || "log-only";
      print(await tool("gate_check", { agent: a1, payee: a2, amount_usd: amount, policy_name: policy })); break;
    }
    case "pass": print(await tool("agent_pass", { agent: a1 || "" })); break;
    case "blast": print(await tool("blast_radius", /^0x[0-9a-fA-F]{40}$/.test(a1 || "") ? { wallet: a1 } : { agent: a1 || "" })); break;
    case "tools": { const j = await post({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }); print(j.result.tools.map((t) => t.name.padEnd(22) + t.title).join("\n")); break; }
    case "mcp": await bridge(); break;
    case "--version": case "-v": print(VERSION); break;
    default: print("afg " + VERSION + " — Agentic Finance Graph from the command line\n\n  afg state | find <q> | agent <id> | ranked [n] [level] | detections [agent] [n]\n  afg def <id> | history <metric> [range] | since <metric> [window] | payers [address]\n  afg statement <id> | verify <id> | chaincheck <id> | quote <kind> <id> | tools | mcp\n  afg pattern <id> | facts <payee> [agent] [usd] | gate <agent> <payee> <usd> [policy] | pass <id> | blast <id|0xwallet>\n    (the security layer, shadow / log-only: measurements, never verdicts; nothing is blocked by us)\n\nData: " + URL_);
  }
} catch (e) { process.stderr.write("afg: " + forTerminal(e.message || e) + "\n"); process.exit(1); }
