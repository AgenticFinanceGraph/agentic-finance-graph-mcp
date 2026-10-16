/* x402-gate-hook.mjs — an x402 client hook that asks Agentic Finance Graph's free, log-only Gate before a payment
   is signed, and lets the operator decide what to do with the answer. No dependencies: Node 18+ (global fetch).

   x402 (@x402/core 2.x) runs `onBeforePaymentCreation` hooks after its own spend controls and before the scheme signs
   the payload. The hook receives the selected payment requirements (scheme, network as CAIP-2, asset, atomic amount,
   payTo, …) and aborts by returning { abort: true, reason }.

   The Gate (https://agenticfinancegraph.com/ai-agent-security-layer-gate-watch-pass-shadow) answers
   block / warn / log / allow with every reason, from seven measured facts about the payee, the paying agent's own
   ledger history and a policy in the AP2 constraint vocabulary. AFG never blocks anything itself and records every
   decision; this hook is where the operator's choice lives:

     import { makeGateHook } from "agentic-finance-graph-mcp/bin/x402-gate-hook.mjs";
     client.onBeforePaymentCreation(makeGateHook({ agent: "45978", policy_name: "recommended-v3", abortOn: ["block"] }));

   Options: agent (your agent's token id, slug or bound wallet; required), policy_name (log-only | balanced | recommended |
   recommended-v3 | strict) or policy (your own object in the AP2 vocabulary), abortOn (decisions that abort; default
   ["block"]), onUnavailable ("warn" allows and logs when AFG cannot be reached, the default; "abort" fails closed;
   "allow" fails open silently), minUsd (skip the call below this value), log (a function receiving one object per
   decision), url (the MCP endpoint), fetchImpl and timeoutMs (tests). */

export const MCP_URL = "https://agenticfinancegraph.com/mcp";
export const DECISIONS = ["block", "warn", "log", "allow"];
export const POLICIES = ["log-only", "balanced", "recommended", "recommended-v3", "strict"];
export const KNOWN_SCHEMES = ["exact", "batch-settlement"];

/** USD value of an atomic amount for USDC, USDT and DAI on Base; null for EURC (no rate here) and anything else. */
export function usdOf(asset, amount, network) {
  if (network !== "eip155:8453") return null;
  const a = String(asset || "").toLowerCase();
  if (["0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", "0xfde4c96c8593536e31f229ea8f37b2ada2699bb2"].includes(a)) return Number(BigInt(amount)) / 1e6;
  if (a === "0x50c5725949a6f0c72e6c4a641f24049a917db0cb") return Number(BigInt(amount)) / 1e18;
  return null;
}
/** What the client will sign: the amount, or for batch-settlement the deposit (extra.minDeposit, default 10 × amount). */
export function signedAmount(req) {
  if (req.scheme === "batch-settlement") { const dep = req.extra && req.extra.minDeposit != null ? BigInt(req.extra.minDeposit) : BigInt(req.amount) * 10n; return dep > BigInt(req.amount) ? dep.toString() : String(req.amount); }
  return String(req.amount);
}

/** One MCP tools/call over HTTP. */
export async function callTool(name, args, { url = MCP_URL, fetchImpl = globalThis.fetch, timeoutMs = 12000 } = {}) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }), signal: ac.signal });
    if (!res.ok) throw new Error(`MCP HTTP ${res.status}`);
    const text0 = await res.text();
    const line = text0.split("\n").find((l) => l.startsWith("data: "));
    const j = JSON.parse(line ? line.slice(6) : text0);
    if (j.error) throw new Error(`MCP error ${j.error.code}: ${j.error.message}`);
    const r = j.result || {};
    if (r.isError) throw new Error(`tool error: ${(r.content || []).map((c) => c.text).join(" ").slice(0, 200)}`);
    if (r.structuredContent) return r.structuredContent;
    const text = (r.content || []).find((c) => c.type === "text")?.text;
    return text ? JSON.parse(text) : {};
  } finally { clearTimeout(timer); }
}

export function makeGateHook(opts = {}) {
  if (!opts.agent) throw new Error("makeGateHook: `agent` is required (your agent's token id, slug or bound wallet)");
  if (opts.policy_name && !POLICIES.includes(opts.policy_name)) throw new Error(`unknown policy_name ${opts.policy_name}; known: ${POLICIES.join(", ")}`);
  if (opts.policy && (typeof opts.policy !== "object" || Array.isArray(opts.policy))) throw new Error("policy must be an object in the AP2 constraint vocabulary");
  const abortOn = opts.abortOn || ["block"];
  for (const d of abortOn) if (!DECISIONS.includes(d)) throw new Error(`unknown decision in abortOn: ${d}`);
  const onUnavailable = opts.onUnavailable || "warn";
  if (!["warn", "abort", "allow"].includes(onUnavailable)) throw new Error("onUnavailable must be warn, abort or allow");
  const minUsd = opts.minUsd ?? 0;
  const log = opts.log || (() => {});
  return async function onBeforePaymentCreation(context) {
    const req = context?.selectedRequirements || context?.paymentRequirements || context || {};
    const payTo = String(req.payTo || "").toLowerCase();
    const resource = context?.paymentRequired?.resource?.url || req.resource || context?.resource || null;
    const base = { agent: opts.agent, payTo, network: req.network, asset: req.asset, scheme: req.scheme, amount: req.amount, resource, at: new Date().toISOString() };
    if (!/^0x[0-9a-f]{40}$/.test(payTo)) { log({ ...base, decision: "abort", reason: "payTo is not an address" }); return { abort: true, reason: "payTo is not an address" }; }
    if (req.scheme && !KNOWN_SCHEMES.includes(req.scheme)) { const reason = `unknown x402 scheme ${req.scheme}: the signed value cannot be read`; log({ ...base, decision: "abort", reason }); return { abort: true, reason }; }
    const signed = signedAmount(req);
    const usd = usdOf(req.asset, signed, req.network);
    base.signed_amount = signed; base.usd = usd;
    if (usd != null && usd < minUsd) { log({ ...base, decision: "allow", reason: `under ${minUsd} USD, not checked` }); return; }
    if (usd == null) { log({ ...base, decision: "allow", reason: "unpriced asset or other network: the Gate prices USD stablecoins on Base; not checked" }); return; }
    let check;
    try { check = await callTool("gate_check", { agent: opts.agent, payee: payTo, amount_usd: usd, ...(opts.policy ? { policy: opts.policy } : { policy_name: opts.policy_name || "log-only" }) }, { url: opts.url, fetchImpl: opts.fetchImpl, timeoutMs: opts.timeoutMs }); }
    catch (e) {
      const reason = `gate_check unavailable: ${e.message}`;
      if (onUnavailable === "abort") { log({ ...base, decision: "abort", reason }); return { abort: true, reason }; }
      log({ ...base, decision: "allow", reason: onUnavailable === "warn" ? `WARN ${reason}` : reason });
      return;
    }
    const decision = check.decision || "allow";
    const facts = { kind: check.facts?.kind ?? null, paid_by_registered_agents: check.facts?.pop ?? null, frozen: !!check.facts?.frozen, v2: check.score_v2 ? { level: check.score_v2.level, reasons: check.score_v2.reasons } : null, as_of: check.as_of || null, decision_id: check.decision_id || null };
    if (abortOn.includes(decision)) { const reason = `AFG gate_check: ${decision} (${(check.reasons || []).join(", ") || "no reason"}; policy ${check.policy?.name}; decision ${check.decision_id}; as of ${check.as_of})`; log({ ...base, decision: "abort", gate: decision, reasons: check.reasons, facts }); return { abort: true, reason }; }
    log({ ...base, decision: "allow", gate: decision, reasons: check.reasons, facts });
  };
}
