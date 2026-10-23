/* afg chaincheck <agent-id>: check an agent's free record against the chain itself.

   The record comes from our API; every check below is answered by a public Base RPC that we do not
   run (default https://mainnet.base.org, override with AFG_BASE_RPC). Nothing here trusts our own
   numbers: for the registration it reads the mint transaction, for each open binding it calls the
   registry, and for each payment in the record's money path it reads the receipt and looks for the
   ERC-20 Transfer the record claims. No dependencies (Node 18+). */

const REGISTRY = "0x8004a169fb4a3325136eb29fa0ceb6d2e539a432";
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
/* the four stablecoins the ledger counts on Base, by contract address (never by symbol) */
export const STABLES = {
  "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": { symbol: "USDC", decimals: 6 },
  "0xfde4c96c8593536e31f229ea8f37b2ada2699bb2": { symbol: "USDT", decimals: 6 },
  "0x60a3e35cc302bfa44cb288bc5a4f316fdb1adb42": { symbol: "EURC", decimals: 6 },
  "0x50c5725949a6f0c72e6c4a641f24049a917db0cb": { symbol: "DAI", decimals: 18 }
};

const bare = (a) => String(a || "").toLowerCase().replace(/^eip155:\d+:/, "");
const topicAddr = (t) => "0x" + String(t || "").slice(26).toLowerCase();
const hex64 = (n) => BigInt(n).toString(16).padStart(64, "0");

/* Public RPCs drop answers inside large batches when busy, so calls go in batches of 8 and any call
   left without a result is retried on its own (three tries, with a short pause). A call that still
   has no answer is reported as unread, never as a failed claim. */
async function batch(url, calls, base) {
  const body = calls.map((c, i) => ({ jsonrpc: "2.0", id: base + i, method: c[0], params: c[1] }));
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
  const j = await r.json().catch(() => []);
  return [].concat(j);
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
export async function rpc(url, calls) {
  const out = new Array(calls.length);
  for (let i = 0; i < calls.length; i += 8) {
    let got = [];
    try { got = await batch(url, calls.slice(i, i + 8), i); } catch { got = []; }
    for (const x of got) if (x && typeof x.id === "number") out[x.id] = x.error ? { error: x.error.message || String(x.error) } : { result: x.result };
  }
  for (let i = 0; i < calls.length; i++) {
    for (let t = 0; t < 3 && (!out[i] || out[i].error || out[i].result == null); t++) {
      await pause(250 * (t + 1));
      try { const [x] = await batch(url, [calls[i]], i); if (x) out[i] = x.error ? { error: x.error.message || String(x.error) } : { result: x.result }; } catch { /* try again */ }
    }
  }
  return out;
}

/* Does this receipt carry a stablecoin Transfer from one of `from` to `to` worth about `usd`?
   USDC, USDT and DAI must match to the cent (or 0.5%); EURC is priced at the day's EUR rate, so it
   only has to be within 15%. Returns the matching log, or why none matched. */
export function matchPayment(receipt, fromSet, to, usd) {
  if (!receipt) return { ok: false, why: "no receipt" };
  if (receipt.status !== "0x1") return { ok: false, why: "transaction reverted" };
  const seen = [];
  for (const l of receipt.logs || []) {
    if (!l.topics || l.topics[0] !== TRANSFER || l.topics.length !== 3) continue;
    const token = String(l.address).toLowerCase();
    const meta = STABLES[token];
    if (!meta) continue;
    const f = topicAddr(l.topics[1]), t = topicAddr(l.topics[2]);
    const amount = Number(BigInt(l.data) * 1000000n / (10n ** BigInt(meta.decimals))) / 1e6;
    seen.push(meta.symbol + " " + amount + " " + f.slice(0, 8) + "→" + t.slice(0, 8));
    if (!fromSet.has(f) || t !== to) continue;
    const tol = meta.symbol === "EURC" ? Math.max(0.02, usd * 0.15) : Math.max(0.01, usd * 0.005);
    if (Math.abs(amount - usd) <= tol) return { ok: true, token: meta.symbol, amount };
  }
  return { ok: false, why: seen.length ? "no matching transfer (saw " + seen.slice(0, 3).join(", ") + ")" : "no stablecoin transfer in this transaction" };
}

export async function chainCheck(record, opts = {}) {
  const url = opts.rpc || process.env.AFG_BASE_RPC || "https://mainnet.base.org";
  const a = record.agent || record;
  const checks = [];
  const add = (ok, name, detail) => checks.push({ ok, name, detail });
  const tokenId = String(a.token_id || "").replace(/\D/g, "");
  if (!tokenId) throw new Error("the record has no token id");

  /* 1. the registration: the mint transaction minted this token to the stated account, at the stated time */
  let mintedTo = bare(a.minted_to), mintTime = null;
  if (a.mint_tx) {
    const [rc] = await rpc(url, [["eth_getTransactionReceipt", [a.mint_tx]]]);
    const rec = rc && rc.result;
    if (!rec) checks.push({ ok: null, name: "registration minted in " + a.mint_tx.slice(0, 10) + "…", detail: "the RPC did not return the mint receipt; run again or set AFG_BASE_RPC" });
    const log = rec && (rec.logs || []).find((l) => String(l.address).toLowerCase() === REGISTRY && l.topics && l.topics[0] === TRANSFER && l.topics.length === 4 && BigInt(l.topics[3]) === BigInt(tokenId) && BigInt(l.topics[1]) === 0n);
    if (rec && !log) add(false, "registration minted in " + a.mint_tx.slice(0, 10) + "…", "no mint of token " + tokenId + " in that transaction");
    else if (log) {
      const to = topicAddr(log.topics[2]);
      const [blk] = await rpc(url, [["eth_getBlockByNumber", [rec.blockNumber, false]]]);
      mintTime = blk && blk.result ? Number(BigInt(blk.result.timestamp)) * 1000 : null;
      const when = a.registered_at ? Date.parse(a.registered_at) : null;
      add(!mintedTo || to === mintedTo, "registration minted to the stated account", to);
      if (when && mintTime) add(Math.abs(when - mintTime) <= 2000, "registration time matches the mint block", new Date(mintTime).toISOString());
      else if (when) checks.push({ ok: null, name: "registration time matches the mint block", detail: "the RPC did not return the block" });
      mintedTo = to;
    }
  } else add(false, "registration", "the record carries no mint transaction");

  /* 2. each open binding still holds on the chain now */
  const bindings = (a.bindings || []).filter((b) => b.open !== false && !b.to);
  const fromSet = new Set((a.bindings || []).map((b) => bare(b.wallet)).concat(a.wallet ? [bare(a.wallet)] : []));
  const calls = [], idx = [];
  for (const b of bindings) {
    if (b.method === 1) { calls.push(["eth_call", [{ to: REGISTRY, data: "0x6352211e" + hex64(tokenId) }, "latest"]]); idx.push(b); }
    else if (b.method === 3) { calls.push(["eth_call", [{ to: REGISTRY, data: "0x00339509" + hex64(tokenId) }, "latest"]]); idx.push(b); }
  }
  const answers = calls.length ? await rpc(url, calls) : [];
  idx.forEach((b, i) => {
    const got = answers[i] && answers[i].result ? "0x" + answers[i].result.slice(26).toLowerCase() : null;
    const label = b.method === 1 ? "ownerOf(" + tokenId + ")" : "getAgentWallet(" + tokenId + ")";
    if (!got) { checks.push({ ok: null, name: "binding: " + label + " is " + bare(b.wallet).slice(0, 10) + "…", detail: "the RPC did not answer: " + ((answers[i] && answers[i].error) || "no result") }); return; }
    add(got === bare(b.wallet), "binding: " + label + " is " + bare(b.wallet).slice(0, 10) + "…", got ? (got === bare(b.wallet) ? "holds now" : "now " + got + " (changed since the record?)") : (answers[i] && answers[i].error) || "no answer");
  });
  for (const b of bindings.filter((b) => b.method === 6)) add(bare(b.wallet) === mintedTo, "binding: minting account " + bare(b.wallet).slice(0, 10) + "…", bare(b.wallet) === mintedTo ? "is the account the registration was minted to" : "minted to " + mintedTo);
  for (const b of bindings.filter((b) => ![1, 3, 6].includes(b.method))) add(true, "binding method " + b.method + " " + bare(b.wallet).slice(0, 10) + "…", "not checkable from the chain alone (signed off-chain); shown for completeness");

  /* 3. every payment in the money path is on the chain as stated */
  const path = (a.money_path || []).filter((p) => p && p.tx);
  if (path.length) {
    const rcs = await rpc(url, path.map((p) => ["eth_getTransactionReceipt", [p.tx]]));
    const blocks = [...new Set(rcs.map((r) => r && r.result && r.result.blockNumber).filter(Boolean))];
    const bl = blocks.length ? await rpc(url, blocks.map((n) => ["eth_getBlockByNumber", [n, false]])) : [];
    const timeOf = new Map(blocks.map((n, i) => [n, bl[i] && bl[i].result ? Number(BigInt(bl[i].result.timestamp)) * 1000 : null]));
    path.forEach((p, i) => {
      const rec = rcs[i] && rcs[i].result;
      if (!rec) { checks.push({ ok: null, name: "payment $" + p.usd + " to " + bare(p.to).slice(0, 10) + "… in " + p.tx.slice(0, 10) + "…", detail: "the RPC did not return this receipt; run again or set AFG_BASE_RPC" }); return; }
      const m = matchPayment(rec, fromSet, bare(p.to), Number(p.usd));
      const t = rec ? timeOf.get(rec.blockNumber) : null;
      const afterReg = mintTime == null || t == null || t >= mintTime;
      add(m.ok && afterReg, "payment $" + p.usd + " to " + bare(p.to).slice(0, 10) + "… in " + p.tx.slice(0, 10) + "…",
        m.ok ? m.token + " " + m.amount + (afterReg ? "" : ", but BEFORE the registration") : m.why);
    });
  }
  /* ok is false only when a claim was read and did not hold; unread claims are counted apart */
  return { ok: checks.every((c) => c.ok !== false), failed: checks.filter((c) => c.ok === false).length, unread: checks.filter((c) => c.ok === null).length, checks, rpc: url, as_of: record.as_of || null };
}
