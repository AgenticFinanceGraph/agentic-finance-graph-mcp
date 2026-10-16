import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { makeGateHook, usdOf, signedAmount, callTool } from "../bin/x402-gate-hook.mjs";

const CLI = fileURLToPath(new URL("../bin/afg.mjs", import.meta.url));
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const PAYEE = "0x424b266c22509a9eb47bcb5b908f40c1157cc2a1";

/* A stand-in MCP server: answers tools/call for the security tools the way the real one does. */
function stub(answer) {
  const calls = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", () => {
      const msg = JSON.parse(raw);
      calls.push(msg);
      const name = msg.params && msg.params.name;
      const a = (msg.params && msg.params.arguments) || {};
      const data = typeof answer === "function" ? answer(name, a) : answer;
      res.setHeader("content-type", "application/json");
      if (data && data.__error) { res.end(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: data.__error }], isError: true } })); return; }
      res.end(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data } }));
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ url: `http://127.0.0.1:${server.address().port}/mcp`, calls, close: () => server.close() })));
}
const req = (over = {}) => ({ selectedRequirements: { scheme: "exact", network: "eip155:8453", asset: USDC, amount: "933100000", payTo: PAYEE, ...over } });

test("usdOf prices USDC, USDT and DAI on Base and refuses the rest", () => {
  assert.equal(usdOf(USDC, "933100000", "eip155:8453"), 933.1);
  assert.equal(usdOf("0x50c5725949a6f0c72e6c4a641f24049a917db0cb", "5" + "0".repeat(18), "eip155:8453"), 5);
  assert.equal(usdOf("0x60a3e35cc302bfa44cb288bc5a4f316fdb1adb42", "1000000", "eip155:8453"), null);
  assert.equal(usdOf(USDC, "1000000", "eip155:1"), null);
  assert.equal(signedAmount({ scheme: "batch-settlement", amount: "100" }), "1000");
});

test("makeGateHook refuses bad options before any payment", () => {
  assert.throws(() => makeGateHook({}), /agent/);
  assert.throws(() => makeGateHook({ agent: "1", policy_name: "lenient" }), /unknown policy_name/);
  assert.throws(() => makeGateHook({ agent: "1", abortOn: ["refuse"] }), /unknown decision/);
  assert.throws(() => makeGateHook({ agent: "1", onUnavailable: "retry" }), /onUnavailable/);
});

test("a block from the Gate aborts; warn and log allow; the call carries the agent, payee, USD and policy", async () => {
  const s = await stub((name, a) => ({ decision: a.amount_usd > 250 ? "block" : "log", reasons: a.amount_usd > 250 ? ["new_payee_above_max:933.1>250"] : [], policy: { name: a.policy_name }, decision_id: "gd_test", as_of: "2026-10-16T12:00:00Z", facts: { kind: "key", pop: 1, frozen: false }, score_v2: { level: "none", reasons: [] } }));
  try {
    const log = [];
    const hook = makeGateHook({ agent: "45978", policy_name: "recommended-v3", url: s.url, log: (x) => log.push(x) });
    const r1 = await hook(req());
    assert.equal(r1.abort, true);
    assert.match(r1.reason, /block/);
    assert.match(r1.reason, /new_payee_above_max/);
    const r2 = await hook(req({ amount: "5000000" }));
    assert.equal(r2, undefined);
    assert.equal(s.calls.length, 2);
    assert.equal(s.calls[0].params.name, "gate_check");
    assert.deepEqual(s.calls[0].params.arguments, { agent: "45978", payee: PAYEE, amount_usd: 933.1, policy_name: "recommended-v3" });
    assert.equal(log[0].decision, "abort");
    assert.equal(log[1].decision, "allow");
    assert.equal(log[1].gate, "log");
  } finally { s.close(); }
});

test("abortOn can include warn; a custom policy object travels as `policy`", async () => {
  const s = await stub({ decision: "warn", reasons: ["warn:fresh_destination_size:933.1>99.99"], policy: { name: "custom" }, decision_id: "gd_w", as_of: "2026-10-16T12:00:00Z", facts: {} });
  try {
    const hook = makeGateHook({ agent: "45978", policy: { amount_range: { max: 2500, currency: "USD" } }, abortOn: ["block", "warn"], url: s.url });
    const r = await hook(req());
    assert.equal(r.abort, true);
    assert.ok(s.calls[0].params.arguments.policy);
    assert.equal(s.calls[0].params.arguments.policy_name, undefined);
  } finally { s.close(); }
});

test("when AFG is unreachable: warn allows and logs (default), abort fails closed, allow is silent", async () => {
  const dead = "http://127.0.0.1:9/mcp";
  const log = [];
  assert.equal(await makeGateHook({ agent: "1", url: dead, timeoutMs: 500, log: (x) => log.push(x) })(req()), undefined);
  assert.match(log[0].reason, /^WARN gate_check unavailable/);
  const r = await makeGateHook({ agent: "1", url: dead, timeoutMs: 500, onUnavailable: "abort" })(req());
  assert.equal(r.abort, true);
  assert.equal(await makeGateHook({ agent: "1", url: dead, timeoutMs: 500, onUnavailable: "allow" })(req()), undefined);
});

test("an unknown scheme aborts; a non-address payTo aborts; an unpriced asset is allowed and logged as not checked", async () => {
  const log = [];
  const hook = makeGateHook({ agent: "1", url: "http://127.0.0.1:9/mcp", timeoutMs: 300, log: (x) => log.push(x) });
  assert.equal((await hook(req({ scheme: "permit2-pull" }))).abort, true);
  assert.equal((await hook(req({ payTo: "not-an-address" }))).abort, true);
  assert.equal(await hook(req({ asset: "0x4200000000000000000000000000000000000006" })), undefined);
  assert.match(log[2].reason, /not checked/);
});

test("a tool error from the server is an unavailable answer, not a decision", async () => {
  const s = await stub({ __error: "agent: not a ranked registration" });
  try {
    const log = [];
    const r = await makeGateHook({ agent: "999999999", url: s.url, onUnavailable: "abort", log: (x) => log.push(x) })(req());
    assert.equal(r.abort, true);
    assert.match(r.reason, /not a ranked registration/);
  } finally { s.close(); }
});

function run(args, env) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [CLI, ...args], { env: { ...process.env, ...env } });
    let out = "", err = "";
    p.stdout.on("data", (d) => { out += d; }); p.stderr.on("data", (d) => { err += d; });
    p.on("close", (code) => resolve({ code, out, err }));
  });
}

test("CLI: afg gate, pattern, facts, pass and blast call the matching tools and print JSON", async () => {
  const seen = [];
  const s = await stub((name, a) => { seen.push({ name, a }); return { tool: name, args: a }; });
  try {
    const env = { AFG_MCP_URL: s.url };
    let r = await run(["gate", "45978", PAYEE, "933.1", "recommended-v3"], env);
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(JSON.parse(r.out).args, { agent: "45978", payee: PAYEE, amount_usd: 933.1, policy_name: "recommended-v3" });
    r = await run(["pattern", "57657"], env); assert.equal(JSON.parse(r.out).tool, "agent_pattern");
    r = await run(["facts", PAYEE, "45978", "10"], env); assert.deepEqual(JSON.parse(r.out).args, { payee: PAYEE, agent: "45978", amount_usd: 10 });
    r = await run(["pass", "57657"], env); assert.equal(JSON.parse(r.out).tool, "agent_pass");
    r = await run(["blast", PAYEE], env); assert.deepEqual(JSON.parse(r.out).args, { wallet: PAYEE });
    r = await run(["blast", "57657"], env); assert.deepEqual(JSON.parse(r.out).args, { agent: "57657" });
    assert.equal(seen.length, 6);
  } finally { s.close(); }
});

test("CLI: afg gate without an amount is a usage error", async () => {
  const r = await run(["gate", "45978", PAYEE], { AFG_MCP_URL: "http://127.0.0.1:9/mcp" });
  assert.equal(r.code, 1);
  assert.match(r.err, /usage: afg gate/);
});

test("callTool reads an SSE-framed answer too", async () => {
  const server = createServer((req, res) => { res.setHeader("content-type", "text/event-stream"); res.end('event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":"{\\"decision\\":\\"allow\\"}"}]}}\n\n'); });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try { const out = await callTool("gate_check", {}, { url: `http://127.0.0.1:${server.address().port}/mcp` }); assert.equal(out.decision, "allow"); }
  finally { server.close(); }
});
