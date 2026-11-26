/* x402-gate-hook.mjs — an x402 client hook that asks Agentic Finance Graph's free Gate (advisory) before a payment
   is signed, and lets the operator decide what to do with the answer. No dependencies: Node 18+ (global fetch).

   x402 (@x402/core 2.x) runs `onBeforePaymentCreation` hooks after its own spend controls and before the scheme signs
   the payload. The hook receives the selected payment requirements (scheme, network as CAIP-2, asset, atomic amount,
   payTo, …) and aborts by returning { abort: true, reason }.

   The Gate (https://agenticfinancegraph.com/ai-agent-security-layer-gate-watch-pass-shadow) answers
   block / warn / log / allow with every reason, from nine measured facts about the payee, the paying agent's own
   ledger history and a policy in the AP2 constraint vocabulary. AFG never blocks anything itself and records every
   decision; this hook is where the operator's choice lives:

     // npm install agentic-finance-graph
     import { makeGateHook } from "agentic-finance-graph/bin/x402-gate-hook.mjs";
     client.onBeforePaymentCreation(makeGateHook({ agent: "45978", policy_name: "recommended-v3", abortOn: ["block"] }));

   Options: agent (your agent's token id, slug or bound wallet; required), policy_name (log-only | balanced | recommended |
   recommended-v3 | strict) or policy (your own object in the AP2 vocabulary), abortOn (decisions that abort; default
   ["block"]), onUnavailable ("warn" allows and logs when AFG cannot be reached, the default; "abort" fails closed;
   "allow" fails open silently), minUsd (skip the call below this value), client_ref (see below), log (a function
   receiving one object per decision), url (the MCP endpoint), fetchImpl and timeoutMs (tests).

   Since 13 Nov 2026 each decision object passed to log carries receipt: the Gate's signed receipt (agent, payee, amount,
   the policy by name and by the SHA-256 of all its limits, decision, reasons, time; Ed25519; gate.receipt.v2 since
   24 Nov 2026, gate.receipt.v3 for an answer given under a pinned policy), to keep beside the payment as proof that it
   was checked first. It is null when the Gate gave no receipt.

   A pinned policy (gate.policy.pin.v1): the owner of an agent's registration can pin one policy to the agent. While it
   is pinned, the Gate evaluates each check under the policy this hook asks with and under the pinned one, and answers
   with the worse decision, so a weaker policy here cannot weaken the answer. The answer then carries pin (the pinned
   policy's SHA-256, since when), decision_asked, decision_pinned, decided_by and pin_reasons. When the pin decides, the
   abort reason says so and gives the pin's reasons; each decision object passed to log carries the same fields (null
   when no pin is in force). Read an agent's pin at https://agenticfinancegraph.com/api/gate/pin?agent=<number>.

   Since 17 Nov 2026 (gate.context.v2) the Gate's limits also count what it let through for the same caller in the last
   12 hours and has not yet seen on chain, so a payment split into small parts meets the same budget and new-payee caps
   as one large payment. The caller is client_ref: a random string of 16 to 64 characters (letters, digits, _ . -) that
   you create once (for example `openssl rand -hex 16`), keep in this hook's configuration, outside the reach of the
   model you guard, and never change. Without it the Gate counts the ledger only, and a counted payment reaches the
   ledger hours after its block. A check that was allowed and then not paid counts against your own limits for those 12
   hours. Each decision object passed to log carries pending: what the Gate counted (decisions, usd), or
   { counted: false } when no client_ref was sent. */

export const MCP_URL = "https://agenticfinancegraph.com/mcp";
export const DECISIONS = ["block", "warn", "log", "allow"];
export const POLICIES = ["log-only", "balanced", "recommended", "recommended-v3", "strict"];
export const KNOWN_SCHEMES = ["exact", "batch-settlement"];
export const CLIENT_REF = /^[A-Za-z0-9_.-]{16,64}$/;

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

/** The pinned policy's part of an answer (gate.policy.pin.v1), for the log: every field null when no pin is in force. */
export function pinOf(check) {
  const p = check && check.pin;
  if (!p) return { pin: null, decided_by: null, decision_asked: null, decision_pinned: null, pin_reasons: null };
  return { pin: { sha256: p.sha256 ?? null, policy_name: p.policy_name ?? null, since: p.since ?? null, set_by_earlier_owner: p.set_by_earlier_owner ?? null, pinned_by_paying_wallet: p.pinned_by_paying_wallet ?? null },
    decided_by: check.decided_by ?? null, decision_asked: check.decision_asked ?? null, decision_pinned: check.decision_pinned ?? null, pin_reasons: Array.isArray(check.pin_reasons) ? check.pin_reasons : null };
}
/** The reason an abort gives. When the pinned policy decided, it names the pin and gives the pin's reasons, so a block
    under an asked policy that never blocks (log-only) does not read "no reason". */
export function abortReason(check, decision) {
  const tail = `decision ${check.decision_id}; as of ${check.as_of}`;
  if (check.pin && check.decided_by === "pin") {
    const sha = String(check.pin.sha256 || "").slice(0, 12);
    return `AFG gate_check: ${decision}, decided by the policy pinned to this agent (pin ${sha}…, since ${check.pin.since}; ${(check.pin_reasons || []).join(", ") || "no reason"}; asked under ${check.policy?.name}: ${check.decision_asked}; ${tail})`;
  }
  const pinNote = check.pin ? `; a policy is pinned to this agent (pin ${String(check.pin.sha256 || "").slice(0, 12)}…): ${check.decision_pinned}` : "";
  return `AFG gate_check: ${decision} (${(check.reasons || []).join(", ") || "no reason"}; policy ${check.policy?.name}${pinNote}; ${tail})`;
}

export function makeGateHook(opts = {}) {
  if (!opts.agent) throw new Error("makeGateHook: `agent` is required (your agent's token id, slug or bound wallet)");
  if (opts.policy_name && !POLICIES.includes(opts.policy_name)) throw new Error(`unknown policy_name ${opts.policy_name}; known: ${POLICIES.join(", ")}`);
  if (opts.policy && (typeof opts.policy !== "object" || Array.isArray(opts.policy))) throw new Error("policy must be an object in the AP2 constraint vocabulary");
  const abortOn = opts.abortOn || ["block"];
  for (const d of abortOn) if (!DECISIONS.includes(d)) throw new Error(`unknown decision in abortOn: ${d}`);
  const onUnavailable = opts.onUnavailable || "warn";
  if (!["warn", "abort", "allow"].includes(onUnavailable)) throw new Error("onUnavailable must be warn, abort or allow");
  if (opts.client_ref != null && (typeof opts.client_ref !== "string" || !CLIENT_REF.test(opts.client_ref))) throw new Error("client_ref must be 16 to 64 characters: letters, digits, underscore, dot or hyphen");
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
    try { check = await callTool("gate_check", { agent: opts.agent, payee: payTo, amount_usd: usd, ...(opts.policy ? { policy: opts.policy } : { policy_name: opts.policy_name || "log-only" }), ...(opts.client_ref ? { client_ref: opts.client_ref } : {}) }, { url: opts.url, fetchImpl: opts.fetchImpl, timeoutMs: opts.timeoutMs }); }
    catch (e) {
      const reason = `gate_check unavailable: ${e.message}`;
      if (onUnavailable === "abort") { log({ ...base, decision: "abort", reason }); return { abort: true, reason }; }
      log({ ...base, decision: "allow", reason: onUnavailable === "warn" ? `WARN ${reason}` : reason });
      return;
    }
    const decision = check.decision || "allow";
    const pending = check.context?.pending ?? null;
    const facts = { kind: check.facts?.kind ?? null, paid_by_registered_agents: check.facts?.pop ?? null, frozen: !!check.facts?.frozen, v2: check.score_v2 ? { level: check.score_v2.level, reasons: check.score_v2.reasons } : null, as_of: check.as_of || null, decision_id: check.decision_id || null };
    const pinned = pinOf(check);
    if (abortOn.includes(decision)) { const reason = abortReason(check, decision); log({ ...base, decision: "abort", gate: decision, reasons: check.reasons, facts, pending, receipt: check.receipt || null, ...pinned }); return { abort: true, reason }; }
    log({ ...base, decision: "allow", gate: decision, reasons: check.reasons, facts, pending, receipt: check.receipt || null, ...pinned });
  };
}
