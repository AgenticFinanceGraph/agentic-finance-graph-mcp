import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { verifyStatement, runCli } from "../bin/booksverify.mjs";

/* An Agent Books answer built here with a throwaway key, so the test needs no network: the statement, its
   canonical text, hash and signature, a log leaf, and a two-leaf log signed by a second throwaway key. */
const canonicalize = (v) => (v === null || typeof v !== "object" ? JSON.stringify(v) : Array.isArray(v) ? "[" + v.map(canonicalize).join(",") + "]"
  : "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canonicalize(v[k])).join(",") + "}");
const sha = (...b) => createHash("sha256").update(Buffer.concat(b)).digest();
const rawPub = (k) => k.export({ type: "spki", format: "der" }).subarray(12).toString("hex");

function make() {
  const kp = generateKeyPairSync("ed25519"), logKp = generateKeyPairSync("ed25519");
  const body = { schema: "afg-agent-books/1", books_id: "00".repeat(16), key_id: "test-key", agent: { token_id: "7" }, period: { id: "2026-10", kind: "month" },
    produced_at: "2026-11-13T08:00:00.000Z", paid: { payments: 3, usd: 12.5 }, received: { receipts: 1, usd: 4 } };
  const canonical = canonicalize(body), sha256 = sha(Buffer.from(canonical, "utf8")).toString("hex");
  const signature = sign(null, Buffer.from(canonical, "utf8"), kp.privateKey).toString("base64");
  const slug = "agent-books/7/2026-10/20261113";
  const leaf = "publication/1|" + slug + "|" + sha256 + "|" + body.produced_at;
  const other = sha(Buffer.from([0]), Buffer.from("afg-statement-root:v1:1:2:0xaa:0xbb:5", "utf8"));
  const leafH = sha(Buffer.from([0]), Buffer.from(leaf, "utf8"));
  const root = sha(Buffer.from([1]), other, leafH);          // tree of two leaves: [other, ours]
  const head = { tree_size: 2, root_hash: "0x" + root.toString("hex"), timestamp_ms: 1794550000000 };
  head.signature = sign(null, Buffer.from(`afg-statement-log:v1:${head.tree_size}:${head.root_hash}:${head.timestamp_ms}`), logKp.privateKey).toString("base64");
  const answer = { ok: true, signed: true, body, canonical, sha256, signature, key_id: "test-key", slug,
    log: { logged: true, leaf, leaf_hash: "0x" + leafH.toString("hex"), leaf_index: 1, signed_head: head, audit_path: ["0x" + other.toString("hex")] } };
  return { answer, keys: { keys: [{ key_id: "test-key", alg: "Ed25519", public_key_hex: rawPub(kp.publicKey) }] }, logDoc: { key: { public_key_hex: rawPub(logKp.publicKey) } } };
}
const failed = (r) => r.filter((x) => x.ok === false).map((x) => x.step);

test("a correct statement passes steps 1 to 5 and reports the anchor as not yet", async () => {
  const { answer, keys, logDoc } = make();
  const r = await verifyStatement(answer, { keys, logDoc });
  assert.deepEqual(failed(r), []);
  assert.deepEqual(r.filter((x) => x.ok === true).map((x) => x.step), [1, 2, 3, 4, 5]);
  assert.equal(r.find((x) => x.step === 6).ok, null);
});

test("a figure changed in the signed text fails the hash and the signature", async () => {
  const { answer, keys, logDoc } = make();
  answer.canonical = answer.canonical.replace('"payments":3', '"payments":4');
  const f = failed(await verifyStatement(answer, { keys, logDoc }));
  assert.ok(f.includes(1) && f.includes(2));
});

test("a figure changed in the body only fails the body check", async () => {
  const { answer, keys, logDoc } = make();
  answer.body.paid.usd = 13.5;
  assert.deepEqual(failed(await verifyStatement(answer, { keys, logDoc })), [3]);
});

test("a re-hashed altered text still fails the signature and the leaf", async () => {
  const { answer, keys, logDoc } = make();
  answer.canonical = answer.canonical.replace('"payments":3', '"payments":4');
  answer.sha256 = sha(Buffer.from(answer.canonical, "utf8")).toString("hex");
  const f = failed(await verifyStatement(answer, { keys, logDoc }));
  assert.ok(f.includes(2) && f.includes(4));
});

test("a wrong position in the log, a wrong path or a head signed by another key fails step 5", async () => {
  for (const alter of [(a) => { a.log.leaf_index = 0; }, (a) => { a.log.audit_path = ["0x" + "22".repeat(32)]; }, (a) => { a.log.signed_head.timestamp_ms += 1; }]) {
    const { answer, keys, logDoc } = make(); alter(answer);
    assert.ok(failed(await verifyStatement(answer, { keys, logDoc })).includes(5));
  }
});

test("an unsigned answer is reported as unsigned, and an unknown key fails", async () => {
  const { answer, keys, logDoc } = make();
  assert.equal((await verifyStatement({ signed: false, note: "limit reached" }, { keys, logDoc }))[0].ok, false);
  assert.ok(failed(await verifyStatement(answer, { keys: { keys: [] }, logDoc })).includes(2));
});

test("--id wants 32 hex characters, and rejects an answer that is another statement", async () => {
  const lines = [];
  assert.equal(await runCli(["--id", "zz"], (l) => lines.push(l)), 2);
  assert.match(lines.join("\n"), /usage: booksverify --id/);
  const { answer } = make();                       // carries books_id 00…00
  const realFetch = globalThis.fetch, asked = [];
  globalThis.fetch = async (url) => { asked.push(String(url)); return { ok: true, status: 200, json: async () => answer }; };
  try {
    const out = [];
    assert.equal(await runCli(["--id", "ab".repeat(16)], (l) => out.push(l)), 1);
    assert.match(out.join("\n"), /not the statement asked for/);
    assert.ok(asked[0].endsWith("/api/books?id=" + "ab".repeat(16)));
    globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({ ok: false }) });
    const none = [];
    assert.equal(await runCli(["--id", "cd".repeat(16)], (l) => none.push(l)), 1);
    assert.match(none.join("\n"), /no stored statement with this id/);
  } finally { globalThis.fetch = realFetch; }
});
