/* afg logwatch [state-file]: an outside monitor for the statement log (agent.statement.log.v1).

   Run it now and again later (a daily cron is enough). Each run checks the Ed25519 signature on
   the log's current signed tree head, and, if an earlier head was kept, fetches a consistency proof
   from that head to the new one and verifies it the RFC 9162 way. If the proof fails, the log's
   history was rewritten; if the tree shrank, or the signing key changed, it says so. The heads it
   has seen are kept in a small JSON file (default ~/.afg-statement-log.json). No dependencies. */
import { createHash, createPublicKey, verify as edVerify } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const unhex = (h) => Buffer.from(String(h).replace(/^0x/, ""), "hex");
const hex = (b) => "0x" + Buffer.from(b).toString("hex");
const node = (l, r) => createHash("sha256").update(Buffer.concat([Buffer.from([1]), l, r])).digest();

/* RFC 9162 section 2.1.4.2: verify that the tree of size `first` (root firstHash) is a prefix of
   the tree of size `second` (root secondHash). */
export function verifyConsistency(first, second, firstHash, secondHash, proof) {
  const fh = unhex(firstHash), sh = unhex(secondHash);
  if (first === second) return proof.length === 0 && fh.equals(sh);
  if (first === 0 || first > second || !proof.length) return false;
  let path = proof.map(unhex);
  if ((first & (first - 1)) === 0) path = [fh, ...path];
  let fn = first - 1, sn = second - 1;
  while (fn & 1) { fn >>= 1; sn >>= 1; }
  let fr = path[0], sr = path[0];
  for (const c of path.slice(1)) {
    if (sn === 0) return false;
    if ((fn & 1) || fn === sn) {
      fr = node(c, fr); sr = node(c, sr);
      if (!(fn & 1)) while (!(fn & 1) && fn !== 0) { fn >>= 1; sn >>= 1; }
    } else sr = node(sr, c);
    fn >>= 1; sn >>= 1;
  }
  return fr.equals(fh) && sr.equals(sh) && sn === 0;
}

/* the head is signed over afg-statement-log:v1:<tree_size>:<root_hash>:<timestamp_ms> */
export function verifyHead(sth, publicKeyHex) {
  const key = createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: unhex(publicKeyHex).toString("base64url") }, format: "jwk" });
  const sig = Buffer.from(sth.signature, "base64");
  const forms = [sth.root_hash, String(sth.root_hash).replace(/^0x/, "")];
  return forms.some((r) => edVerify(null, Buffer.from("afg-statement-log:v1:" + sth.tree_size + ":" + r + ":" + sth.timestamp_ms), key, sig));
}

export async function logWatch(getJson, stateFile) {
  const file = stateFile || join(homedir(), ".afg-statement-log.json");
  let kept = null;
  try { kept = JSON.parse(readFileSync(file, "utf8")); } catch { kept = null; }
  const doc = await getJson("/api/statements/log");
  const sth = doc.sth, key = doc.key || {};
  const checks = [];
  const add = (ok, name, detail) => checks.push({ ok, name, detail });
  if (!sth || !key.public_key_hex) throw new Error("the log answer carries no signed head or key");
  const pinned = process.env.AFG_LOG_PUBKEY || (kept && kept.public_key_hex) || null;
  if (pinned && pinned.replace(/^0x/, "").toLowerCase() !== String(key.public_key_hex).replace(/^0x/, "").toLowerCase()) add(false, "signing key unchanged", "the log now signs with " + key.key_id + ", not the key kept or pinned");
  add(verifyHead(sth, pinned || key.public_key_hex), "signature on the head of " + sth.tree_size + " entries", new Date(Number(sth.timestamp_ms)).toISOString() + ", key " + key.key_id + (pinned ? "" : " (taken from the answer on first run; pin it with AFG_LOG_PUBKEY)"));
  if (kept && kept.tree_size) {
    if (sth.tree_size < kept.tree_size) add(false, "the log only grows", "it shrank from " + kept.tree_size + " to " + sth.tree_size + " entries");
    else if (sth.tree_size === kept.tree_size) add(String(sth.root_hash).toLowerCase() === String(kept.root_hash).toLowerCase(), "same size, same root as the head kept on " + new Date(Number(kept.timestamp_ms)).toISOString(), sth.root_hash);
    else {
      const c = (await getJson("/api/statements/log?consistency=" + kept.tree_size)).consistency;
      const firstMatches = c && c.first && String(c.first.root_hash).toLowerCase() === String(kept.root_hash).toLowerCase();
      const ok = !!c && firstMatches && verifyConsistency(kept.tree_size, c.second.tree_size, kept.root_hash, c.second.root_hash, c.proof || []) && c.second.tree_size === sth.tree_size;
      add(ok, "the log of " + sth.tree_size + " entries extends the one of " + kept.tree_size + " kept on " + new Date(Number(kept.timestamp_ms)).toISOString(), ok ? (c.proof || []).length + "-step consistency proof verified" : "the consistency proof does not verify: the history was rewritten, or the answer is broken");
    }
  } else add(true, "first run", "head kept in " + file + "; run again later to check the log only grew");
  const failed = checks.some((c) => c.ok === false);
  if (!failed) writeFileSync(file, JSON.stringify({ tree_size: sth.tree_size, root_hash: sth.root_hash, timestamp_ms: sth.timestamp_ms, key_id: key.key_id, public_key_hex: pinned || key.public_key_hex, kept_at: new Date().toISOString() }, null, 1) + "\n");
  return { ok: !failed, checks, file };
}
