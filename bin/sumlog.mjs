/* Verify the Merkle-sum log (definition sumlog.v1) with nothing but node:crypto.

   leaf = SHA-256(0x00 || uint64be(sum_micro) || data)
   node = SHA-256(0x01 || left || right || uint64be(left_sum) || uint64be(right_sum)), sum = left + right
   head signature: Ed25519 over
     "afg-sum-log:v1:<leaves>:<root>:<sum_micro>:<agent_root>:<agents>:<timestamp_ms>"
   with the published 32-byte key wrapped in the SPKI prefix 302a300506032b6570032100.

   Every check recomputes from the bytes it is given; nothing is trusted because the server said so. */
import { createHash, createPublicKey, verify as edVerify } from "node:crypto";

const SPKI_ED25519_PREFIX = "302a300506032b6570032100";
const MAX_U64 = (1n << 64n) - 1n;

export function uint64be(n) {
  const v = BigInt(n);
  if (v < 0n || v > MAX_U64) throw new Error("sum out of uint64 range: " + n);
  const b = Buffer.alloc(8);
  b.writeBigUInt64BE(v);
  return b;
}

const sha256 = (...parts) => createHash("sha256").update(Buffer.concat(parts)).digest();
const hexOf = (buf) => "0x" + buf.toString("hex");
const bufOf = (hex) => {
  const h = String(hex).replace(/^0x/, "");
  if (!/^[0-9a-fA-F]{64}$/.test(h)) throw new Error("not a 32-byte hex hash: " + hex);
  return Buffer.from(h, "hex");
};

export function leafHash(sumMicro, data) {
  return hexOf(sha256(Buffer.from([0x00]), uint64be(sumMicro), Buffer.from(String(data), "utf8")));
}

export function nodeHash(left, right, leftSum, rightSum) {
  return hexOf(sha256(Buffer.from([0x01]), bufOf(left), bufOf(right), uint64be(leftSum), uint64be(rightSum)));
}

/* Climb an inclusion path from a leaf. Each step is { side: "L"|"R", hash, sum }: the sibling sits on
   that side of the node being built. Returns the root hash and the summed amount at the root. */
export function climb(leafHashHex, leafSum, path) {
  let hash = leafHashHex;
  let sum = BigInt(leafSum);
  for (const step of path) {
    const sib = BigInt(step.sum);
    if (step.side === "R") hash = nodeHash(hash, step.hash, sum, sib);
    else if (step.side === "L") hash = nodeHash(step.hash, hash, sib, sum);
    else throw new Error("bad path side: " + step.side);
    sum += sib;
  }
  return { root: hash, sum };
}

export function headMessage(head) {
  return `afg-sum-log:v1:${head.leaves}:${head.root}:${head.sum_micro}:${head.agent_root}:${head.agents}:${head.timestamp_ms}`;
}

export function publicKeyFromHex(hex32) {
  const raw = String(hex32).replace(/^0x/, "");
  if (!/^[0-9a-fA-F]{64}$/.test(raw)) throw new Error("public key must be 32 bytes of hex");
  return createPublicKey({ key: Buffer.from(SPKI_ED25519_PREFIX + raw, "hex"), format: "der", type: "spki" });
}

export function verifyHeadSignature(head, publicKeyHex) {
  const key = publicKeyFromHex(publicKeyHex);
  const message = headMessage(head);
  const sig = Buffer.from(String(head.signature), "base64");
  if (sig.length !== 64) return false;
  return edVerify(null, Buffer.from(message, "utf8"), key, sig);
}

/* Run every check on the two answers of /api/sum-log (the head document) and /api/sum-log?agent=<id>
   (the proof document). publicKeyHex overrides the key printed in the head document: a client that
   pins the key it was given out of band trusts the server for nothing. Returns ordered checks. */
export function verifyAgent(headDoc, proofDoc, { publicKeyHex } = {}) {
  const checks = [];
  const add = (name, ok, detail) => checks.push({ name, ok: !!ok, detail });
  const keyHex = publicKeyHex || headDoc?.key?.public_key_hex;
  const head = headDoc?.head;
  const phead = proofDoc?.head;

  try {
    add("head signature", head && keyHex && verifyHeadSignature(head, keyHex), head ? `${head.key_id || ""} ${headMessage(head)}` : "no head in /api/sum-log");
  } catch (e) { add("head signature", false, e.message); }

  if (!phead) { add("proof head", false, "no head in the agent proof"); return finish(checks); }
  try {
    add("proof head signature", keyHex && verifyHeadSignature(phead, keyHex), headMessage(phead));
  } catch (e) { add("proof head signature", false, e.message); }
  add("same head in both answers", head && ["leaves", "root", "sum_micro", "agent_root", "agents", "timestamp_ms"].every((k) => String(head[k]) === String(phead[k])),
    head ? `head leaves ${head.leaves} / proof leaves ${phead.leaves}` : "no head document");

  const rec = proofDoc.record || {};
  const leaf = proofDoc.leaf || {};
  const expectedData = `${proofDoc.agent_id}|${rec.root}|${rec.sum_micro}|${rec.leaves}`;
  add("leaf data is agent_id|root|sum_micro|leaves", leaf.data === expectedData, `${leaf.data}`);
  add("leaf sum equals the agent record sum", String(leaf.sum_micro) === String(rec.sum_micro), `${leaf.sum_micro} micro-USD`);

  try {
    const lh = leafHash(leaf.sum_micro, leaf.data);
    const { root, sum } = climb(lh, leaf.sum_micro, proofDoc.path || []);
    add("path climbs to head.agent_root", root === phead.agent_root, `${root}`);
    add("summed amount equals head.sum_micro", sum === BigInt(phead.sum_micro), `${sum} micro-USD`);
    const usd = Number(BigInt(phead.sum_micro)) / 1e6;
    if (headDoc?.head?.total_usd != null) add("head.total_usd matches sum_micro", Math.abs(usd - Number(headDoc.head.total_usd)) < 1e-6, `${usd}`);
  } catch (e) { add("path climbs to head.agent_root", false, e.message); }

  return finish(checks);
}

function finish(checks) {
  return { ok: checks.every((c) => c.ok), checks };
}
