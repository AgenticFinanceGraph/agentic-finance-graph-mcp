import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { generateKeyPairSync, sign } from "node:crypto";
import { leafHash, nodeHash, climb, headMessage, verifyHeadSignature, verifyAgent, uint64be } from "../bin/sumlog.mjs";

const CLI = fileURLToPath(new URL("../bin/afg.mjs", import.meta.url));

/* A key made here, in the test. The raw 32-byte public key is the tail of the SPKI DER. */
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const PUBKEY_HEX = publicKey.export({ type: "spki", format: "der" }).subarray(-32).toString("hex");

/* A hand-built agent tree with three leaves (RFC 6962 shape: AB paired, C carried up). */
const agents = [
  { id: "act_8453_1", root: "0x" + "11".repeat(32), sum: 1_000_000n, leaves: 2 },
  { id: "act_8453_2", root: "0x" + "22".repeat(32), sum: 2_500_000n, leaves: 3 },
  { id: "act_8453_3", root: "0x" + "33".repeat(32), sum: 4_000_000n, leaves: 1 },
];
const leaves = agents.map((a) => ({ data: `${a.id}|${a.root}|${a.sum}|${a.leaves}`, sum: a.sum }));
const L = leaves.map((l) => leafHash(l.sum, l.data));
const AB = nodeHash(L[0], L[1], leaves[0].sum, leaves[1].sum);
const ROOT = nodeHash(AB, L[2], leaves[0].sum + leaves[1].sum, leaves[2].sum);
const TOTAL = leaves[0].sum + leaves[1].sum + leaves[2].sum; // 7_500_000 micro-USD

const head = {
  leaves: 6, sum_micro: String(TOTAL), total_usd: Number(TOTAL) / 1e6, root: "0x" + "ab".repeat(32),
  agent_root: ROOT, agents: 3, timestamp_ms: 1791951056234, key_id: "test-key",
};
head.signature = sign(null, Buffer.from(headMessage(head), "utf8"), privateKey).toString("base64");
head.message = headMessage(head);

const headDoc = { ok: true, key: { alg: "Ed25519", key_id: "test-key", public_key_hex: PUBKEY_HEX }, head };
/* Proof for agent 2: sibling A on the left, then C on the right. */
const proofDoc = {
  ok: true, head, agent_id: "act_8453_2", token_id: "2",
  record: { root: agents[1].root, sum_micro: String(agents[1].sum), total_usd: 2.5, leaves: 3 },
  leaf: { index: 1, data: leaves[1].data, sum_micro: String(agents[1].sum) },
  path: [
    { side: "L", hash: L[0], sum: String(leaves[0].sum) },
    { side: "R", hash: L[2], sum: String(leaves[2].sum) },
  ],
};

const clone = (x) => JSON.parse(JSON.stringify(x));

test("uint64be is big-endian and rejects out-of-range sums", () => {
  assert.equal(uint64be(1).toString("hex"), "0000000000000001");
  assert.equal(uint64be("28694289309262").toString("hex"), "00001a18e8ebde4e");
  assert.throws(() => uint64be(-1n));
  assert.throws(() => uint64be(1n << 64n));
});

test("leaf and node hashes follow sumlog.v1 and the proof climbs to the root", () => {
  const { root, sum } = climb(L[1], leaves[1].sum, proofDoc.path);
  assert.equal(root, ROOT);
  assert.equal(sum, TOTAL);
  assert.notEqual(nodeHash(L[0], L[1], 1n, 2n), nodeHash(L[1], L[0], 2n, 1n), "order matters");
});

test("the head signature verifies with the key and fails with another", () => {
  assert.equal(verifyHeadSignature(head, PUBKEY_HEX), true);
  const other = generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "der" }).subarray(-32).toString("hex");
  assert.equal(verifyHeadSignature(head, other), false);
});

test("a correct head and proof pass every check", () => {
  const r = verifyAgent(headDoc, proofDoc);
  assert.equal(r.ok, true, JSON.stringify(r.checks));
  assert.deepEqual(r.checks.map((c) => c.name), [
    "head signature", "proof head signature", "same head in both answers",
    "leaf data is agent_id|root|sum_micro|leaves", "leaf sum equals the agent record sum",
    "path climbs to head.agent_root", "summed amount equals head.sum_micro", "head.total_usd matches sum_micro",
  ]);
});

test("one changed byte in a sum, a sibling or the signature fails", () => {
  const badSum = clone(proofDoc);
  badSum.path[0].sum = String(leaves[0].sum + 1n);
  let r = verifyAgent(headDoc, badSum);
  assert.equal(r.ok, false);
  assert.equal(r.checks.find((c) => c.name === "path climbs to head.agent_root").ok, false);
  assert.equal(r.checks.find((c) => c.name === "summed amount equals head.sum_micro").ok, false);

  const badSibling = clone(proofDoc);
  badSibling.path[1].hash = "0x" + (L[2].slice(2, 3) === "0" ? "1" : "0") + L[2].slice(3);
  r = verifyAgent(headDoc, badSibling);
  assert.equal(r.checks.find((c) => c.name === "path climbs to head.agent_root").ok, false);
  assert.equal(r.checks.find((c) => c.name === "summed amount equals head.sum_micro").ok, true, "the sum does not depend on the sibling hash");

  const badSig = clone(headDoc);
  const sig = Buffer.from(badSig.head.signature, "base64");
  sig[10] ^= 0x01;
  badSig.head.signature = sig.toString("base64");
  r = verifyAgent(badSig, proofDoc);
  assert.equal(r.checks.find((c) => c.name === "head signature").ok, false);
  assert.equal(r.checks.find((c) => c.name === "proof head signature").ok, true);

  const badLeaf = clone(proofDoc);
  badLeaf.record.leaves = 4;
  r = verifyAgent(headDoc, badLeaf);
  assert.equal(r.checks.find((c) => c.name === "leaf data is agent_id|root|sum_micro|leaves").ok, false);

  const pinnedWrong = verifyAgent(headDoc, proofDoc, { publicKeyHex: "00".repeat(32) });
  assert.equal(pinnedWrong.ok, false);
});

/* The CLI end to end, against a stand-in for /api/sum-log on a local port. */
async function stubServer(docs) {
  const server = createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    res.setHeader("content-type", "application/json");
    if (u.pathname !== "/api/sum-log") { res.statusCode = 404; return res.end("{}"); }
    res.end(JSON.stringify(u.searchParams.get("agent") ? docs.proof : docs.head));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

function run(args, origin, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], { env: { ...process.env, AFG_MCP_URL: origin + "/mcp", ...env } });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (c) => (stdout += c));
    child.stderr.setEncoding("utf8").on("data", (c) => (stderr += c));
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

test("afg verify prints PASS and exits 0 on a good proof", async () => {
  const { server, origin } = await stubServer({ head: headDoc, proof: proofDoc });
  try {
    const r = await run(["verify", "2"], origin);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /^pass {2}head signature/m);
    assert.match(r.stdout, /PASS: agent 2, 3 counted payments, 2\.5 USD/);
    assert.ok(!r.stdout.includes("FAIL"));
  } finally { server.close(); }
});

test("afg verify prints FAIL and exits 1 when a byte of a sum changes", async () => {
  const bad = clone(proofDoc);
  bad.path[1].sum = String(leaves[2].sum - 1n);
  const { server, origin } = await stubServer({ head: headDoc, proof: bad });
  try {
    const r = await run(["verify", "2"], origin);
    assert.equal(r.code, 1);
    assert.match(r.stdout, /FAIL {2}path climbs to head\.agent_root/);
    assert.match(r.stdout, /FAIL {2}summed amount equals head\.sum_micro/);
    assert.match(r.stdout, /^FAIL: agent 2/m);
  } finally { server.close(); }
});

test("afg verify honours a pinned key and fails when it does not match", async () => {
  const { server, origin } = await stubServer({ head: headDoc, proof: proofDoc });
  try {
    const good = await run(["verify", "2"], origin, { AFG_SUMLOG_PUBKEY: PUBKEY_HEX });
    assert.equal(good.code, 0, good.stderr);
    assert.match(good.stdout, /\(pinned\)/);
    const wrong = await run(["verify", "2"], origin, { AFG_SUMLOG_PUBKEY: "11".repeat(32) });
    assert.equal(wrong.code, 1);
    assert.match(wrong.stdout, /FAIL {2}head signature/);
  } finally { server.close(); }
});

test("afg verify without an id is a usage error on stderr", async () => {
  const r = await run(["verify"], "http://127.0.0.1:9");
  assert.equal(r.code, 1);
  assert.match(r.stderr, /usage: afg verify <agent-id>/);
});
