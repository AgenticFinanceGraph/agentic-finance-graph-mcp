/* afg editioncheck <period>: a reader's check of a State of Agent Money edition.

   The edition file comes from our site; every check below is answered by something we do not control:
   the chain, read through a public Base RPC (default https://mainnet.base.org, override with AFG_BASE_RPC),
   or the published statement log whose head `afg logwatch` verifies. Nothing here trusts our own numbers.

   What it checks:
     1. the file's SHA-256 is the hash committed to the statement log as `publication/1|<slug>|<sha>|<at>`;
     2. registrations minted in the period: the ERC-8004 Identity Registry's agent ids are sequential, so the
        highest id that answers ownerOf() at the period's first and last block gives the count minted between
        them, re-derived from the chain and compared with the edition's figure;
     3. registrations at the end of the period, the same way;
     4. every definition id the edition cites resolves on /api/def (frozen definitions exist).
   Counted payments are not re-derived here: they need the ledger's binding set; `afg chaincheck <agent>`
   checks one agent's payments against the chain. No dependencies (Node 18+). */
import { createHash } from "node:crypto";
import { rpc } from "./chaincheck.mjs";

const REGISTRY = "0x8004a169fb4a3325136eb29fa0ceb6d2e539a432";
const hex64 = (n) => BigInt(n).toString(16).padStart(64, "0");

/* every chain read goes through one function so a test can answer it without a network */
const mk = (R, url) => {
  const one = async (method, params) => { const [r] = await R(url, [[method, params]]); if (!r || r.error) throw new Error(method + ": " + (r && r.error ? r.error : "no answer")); return r.result; };
  const ownerExists = async (id, tag) => { const [r] = await R(url, [["eth_call", [{ to: REGISTRY, data: "0x6352211e" + hex64(id) }, tag]]]); if (!r) throw new Error("ownerOf(" + id + "): no answer"); if (r.error) return false; /* ownerOf reverts for an id that was never minted */ return typeof r.result === "string" && r.result.length === 66 && BigInt(r.result) !== 0n; };
  const blockAt = async (isoTime, head) => {
    /* the first block whose timestamp is at or after the instant; about 25 block reads */
    const target = Math.floor(Date.parse(isoTime) / 1000);
    const ts = async (b) => parseInt((await one("eth_getBlockByNumber", ["0x" + b.toString(16), false])).timestamp, 16);
    let lo = 0, hi = head;
    if (await ts(hi) < target) return null; /* the period has not ended yet */
    while (hi - lo > 1) { const mid = Math.floor((lo + hi) / 2); if (await ts(mid) < target) lo = mid; else hi = mid; }
    return hi;
  };
  const highestId = async (block) => {
    const tag = "0x" + block.toString(16);
    if (!(await ownerExists(1, tag))) return 0;
    let lo = 1, hi = 1;
    while (await ownerExists(hi, tag)) { lo = hi; hi *= 2; if (hi > 2 ** 28) break; }
    while (hi - lo > 1) { const mid = Math.floor((lo + hi) / 2); if (await ownerExists(mid, tag)) lo = mid; else hi = mid; }
    return lo;
  };
  return { one, ownerExists, blockAt, highestId };
};

export async function editionCheck(period, { api, rpcUrl, fetchText, rpcFn }) {
  const { one, ownerExists, blockAt, highestId } = mk(rpcFn || rpc, rpcUrl);
  const checks = [];
  const put = (name, ok, detail) => checks.push({ name, ok, detail });
  const slug = "state-of-agent-money-" + String(period).toLowerCase();
  const raw = await fetchText("/research/" + slug + ".json");
  let E; try { E = JSON.parse(raw); } catch { throw new Error("no edition file for " + period + " at " + api + "/research/" + slug + ".json"); }
  const sha = createHash("sha256").update(raw, "utf8").digest("hex");

  /* 1. the hash in the statement log */
  if (E.status !== "final") put("hash committed to the statement log", null, "a running edition is not final yet; its hash enters the log when it closes");
  else {
    const log = await fetchText("/api/statements/log");
    const leaf = "publication/1|" + slug + "|" + sha + "|";
    put("hash committed to the statement log", log.includes(leaf), log.includes(leaf) ? "leaf publication/1|" + slug + "|" + sha.slice(0, 16) + "…; run afg logwatch to verify the log's signed head" : "no leaf for this file's SHA-256 " + sha.slice(0, 16) + "… in the log");
  }

  /* 2 and 3. registrations, re-derived from the registry at the period's block bounds */
  const regs = (E.flows && E.flows.registrations) || {};
  try {
    const head = parseInt(await one("eth_blockNumber", []), 16);
    const bFrom = await blockAt(E.from, head), bTo = await blockAt(E.to, head);
    if (bFrom == null || bTo == null) put("registrations minted in the period", null, "the period has not ended on chain yet");
    else {
      const hFrom = await highestId(bFrom), hTo = await highestId(bTo);
      const zero = await ownerExists(0, "0x" + bTo.toString(16));
      const minted = hTo - hFrom, total = hTo + (zero ? 1 : 0);
      const okMinted = regs.base_minted != null && Number(regs.base_minted) === minted;
      put("registrations minted in the period", regs.base_minted == null ? null : okMinted, "chain: ids " + hFrom + " → " + hTo + " between blocks " + bFrom + " and " + bTo + " = " + minted + " minted; edition says " + (regs.base_minted ?? "n/a"));
      const okTotal = regs.base_total_at_end != null && Number(regs.base_total_at_end) === total;
      put("registrations at the end of the period", regs.base_total_at_end == null ? null : okTotal, "chain: highest id " + hTo + (zero ? " plus id 0" : "") + " = " + total + " at block " + bTo + "; edition says " + (regs.base_total_at_end ?? "n/a"));
    }
  } catch (e) { put("registrations minted in the period", null, "public RPC did not answer: " + String(e.message || e).slice(0, 80)); }

  /* 4. the cited definitions exist, frozen */
  const ids = new Set();
  for (const s of Object.values(E.stocks || {})) if (s && s.definition_id) ids.add(s.definition_id);
  for (const f of Object.values(E.flows || {})) if (f && f.definition_id) ids.add(f.definition_id);
  let resolved = 0, missing = [];
  for (const id of ids) { try { const d = JSON.parse(await fetchText("/api/def?id=" + encodeURIComponent(id))); if (d && (d.id === id || d.definition)) resolved++; else missing.push(id); } catch { missing.push(id); } }
  put("cited definitions resolve", ids.size ? missing.length === 0 : null, resolved + "/" + ids.size + " definition ids on /api/def" + (missing.length ? "; missing: " + missing.join(", ") : ""));

  put("counted payments", null, "not re-derived here: they need the ledger's binding set; afg chaincheck <agent> checks one agent's payments against the chain");
  const ok = checks.every((c) => c.ok !== false);
  return { ok, checks, slug, sha, status: E.status, produced_at: E.produced_at, as_of: new Date().toISOString() };
}
