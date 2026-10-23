import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { verifyConsistency } from "../bin/logwatch.mjs";

/* a reference RFC 6962 tree and its consistency proofs, written from the RFC, to test the verifier */
const H = (...b) => createHash("sha256").update(Buffer.concat(b)).digest();
const leafHash = (s) => H(Buffer.from([0]), Buffer.from(s));
const k2 = (n) => { let k = 1; while (k * 2 < n) k *= 2; return k; };
function mth(d) { if (d.length === 1) return d[0]; const k = k2(d.length); return H(Buffer.from([1]), mth(d.slice(0, k)), mth(d.slice(k))); }
function subproof(m, d, b) {
  const n = d.length;
  if (m === n) return b ? [] : [mth(d)];
  const k = k2(n);
  return m <= k ? [...subproof(m, d.slice(0, k), b), mth(d.slice(k))] : [...subproof(m - k, d.slice(k), false), mth(d.slice(0, k))];
}
const hex = (b) => "0x" + b.toString("hex");
const leaves = Array.from({ length: 40 }, (_, i) => leafHash("afg-statement-root:v1:window-" + i));

test("every prefix of a 40-entry log verifies as consistent with the whole", () => {
  const whole = hex(mth(leaves));
  for (let m = 1; m < 40; m++) {
    const proof = subproof(m, leaves, true).map(hex);
    assert.equal(verifyConsistency(m, 40, hex(mth(leaves.slice(0, m))), whole, proof), true, "m=" + m);
  }
});

test("a rewritten entry inside the old prefix breaks the proof", () => {
  const forged = leaves.slice(); forged[3] = leafHash("rewritten");
  const proof = subproof(10, forged, true).map(hex);
  assert.equal(verifyConsistency(10, 40, hex(mth(leaves.slice(0, 10))), hex(mth(forged)), proof), false);
});

test("same size needs an empty proof and equal roots", () => {
  const r = hex(mth(leaves));
  assert.equal(verifyConsistency(40, 40, r, r, []), true);
  assert.equal(verifyConsistency(40, 40, r, hex(mth(leaves.slice(0, 39))), []), false);
});

test("a log that shrank is not consistent", () => {
  assert.equal(verifyConsistency(40, 20, hex(mth(leaves)), hex(mth(leaves.slice(0, 20))), ["0x00"]), false);
});
