import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { makeGateHook, usdOf, signedAmount, callTool, abortReason, pinOf } from "../bin/x402-gate-hook.mjs";

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
  assert.throws(() => makeGateHook({ agent: "1", client_ref: "short" }), /client_ref/);
  assert.throws(() => makeGateHook({ agent: "1", client_ref: "has a space in it 1234567" }), /client_ref/);
  assert.throws(() => makeGateHook({ agent: "1", client_ref: 1234567890123456 }), /client_ref/);
});

test("client_ref travels with every check and the log carries what the Gate counted as pending; without it nothing is sent", async () => {
  const REF = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
  let n = 0;
  const s = await stub((name, a) => { n++; const second = a.client_ref === REF && n === 2; return { decision: second ? "block" : "allow", reasons: second ? ["new_payee_window_above_max:40+40>50/24h"] : [], policy: { name: "custom" }, decision_id: "gd_test" + n, context: { pending: a.client_ref ? { counted: true, hours: 12, decisions: n - 1, usd: 40 * (n - 1) } : { counted: false, why: "no operator_id or client_ref" } } }; });
  try {
    const log = [];
    const hook = makeGateHook({ agent: "57657", policy: { new_payee: { max: 50, window_hours: 24 } }, client_ref: REF, url: s.url, log: (x) => log.push(x) });
    assert.equal(await hook(req({ amount: "40000000" })), undefined);
    const r2 = await hook(req({ amount: "40000000" }));
    assert.equal(r2.abort, true);
    assert.match(r2.reason, /new_payee_window_above_max/);
    assert.equal(s.calls[0].params.arguments.client_ref, REF);
    assert.equal(s.calls[1].params.arguments.client_ref, REF);
    assert.deepEqual(log[0].pending, { counted: true, hours: 12, decisions: 0, usd: 0 });
    assert.deepEqual(log[1].pending, { counted: true, hours: 12, decisions: 1, usd: 40 });
    const plain = makeGateHook({ agent: "57657", url: s.url, log: (x) => log.push(x) });
    assert.equal(await plain(req({ amount: "40000000" })), undefined);
    assert.equal("client_ref" in s.calls[2].params.arguments, false);
    assert.equal(log[2].pending.counted, false);
  } finally { s.close(); }
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

test("under a pinned policy the abort names the pin and its reasons and the log carries both decisions; without a pin the reason is as before", async () => {
  const PIN = { definition: "gate.policy.pin.v1", sha256: "ab".repeat(32), policy_name: "recommended", since: "2026-11-26T09:00:05Z", event_id: "gp_x", set_by_earlier_owner: false, pinned_by_paying_wallet: false };
  const s = await stub((name, a) => (a.amount_usd > 250
    ? { decision: "block", decided_by: "pin", decision_asked: "allow", decision_pinned: "block", reasons: [], pin_reasons: ["new_payee_window_above_max:933.1>250/168h"], pin: PIN, policy: { name: "log-only" }, decision_id: "gd_pin", as_of: "2026-11-26T09:01:00Z", facts: {}, receipt: { body: { schema: "afg-gate-receipt/3" } } }
    : { decision: "log", decided_by: "both", decision_asked: "log", decision_pinned: "log", reasons: ["log:x"], pin_reasons: [], pin: PIN, policy: { name: "log-only" }, decision_id: "gd_pin2", as_of: "2026-11-26T09:01:01Z", facts: {} }));
  try {
    const log = [];
    const hook = makeGateHook({ agent: "45978", url: s.url, log: (x) => log.push(x) });
    const r = await hook(req());
    assert.equal(r.abort, true);
    assert.match(r.reason, /decided by the policy pinned to this agent/);
    assert.match(r.reason, /pin abababababab…/);
    assert.match(r.reason, /new_payee_window_above_max/);
    assert.match(r.reason, /asked under log-only: allow/);
    assert.doesNotMatch(r.reason, /no reason/);
    assert.equal(log[0].decided_by, "pin"); assert.equal(log[0].decision_asked, "allow"); assert.equal(log[0].decision_pinned, "block");
    assert.deepEqual(log[0].pin_reasons, ["new_payee_window_above_max:933.1>250/168h"]); assert.equal(log[0].pin.sha256, "ab".repeat(32));
    assert.equal(log[0].receipt.body.schema, "afg-gate-receipt/3");
    assert.equal(await hook(req({ amount: "5000000" })), undefined);
    assert.equal(log[1].decided_by, "both"); assert.equal(log[1].gate, "log");
  } finally { s.close(); }
  /* no pin: the reason of 0.3.7, character for character, and every pin field null */
  const check = { decision: "block", reasons: ["new_payee_above_max:933.1>250"], policy: { name: "recommended-v3" }, decision_id: "gd_test", as_of: "2026-10-16T12:00:00Z" };
  assert.equal(abortReason(check, "block"), "AFG gate_check: block (new_payee_above_max:933.1>250; policy recommended-v3; decision gd_test; as of 2026-10-16T12:00:00Z)");
  assert.deepEqual(pinOf(check), { pin: null, decided_by: null, decision_asked: null, decision_pinned: null, pin_reasons: null });
  /* a pin in force that did not decide (the asked policy was as strict or stricter): the reason says a pin is in force */
  assert.match(abortReason({ ...check, pin: { sha256: "cd".repeat(32) }, decided_by: "asked", decision_pinned: "warn" }, "block"), /a policy is pinned to this agent \(pin cdcdcdcdcdcd…\): warn/);
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
