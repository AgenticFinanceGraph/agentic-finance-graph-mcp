import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { editionCheck } from "../bin/editioncheck.mjs";

/* A fake chain: block b has timestamp 1,000,000 + 2b; the registry minted ids 0..80 by block 1000 and
   0..100 by block 2000 (so 20 in between); ownerOf reverts above the highest id of the block asked. */
const T0 = 1000000;
const highestAt = (block) => (block >= 2000 ? 100 : block >= 1000 ? 80 : 10);
const fakeRpc = async (_url, calls) => calls.map(([method, params]) => {
  if (method === "eth_blockNumber") return { result: "0x" + (3000).toString(16) };
  if (method === "eth_getBlockByNumber") return { result: { timestamp: "0x" + (T0 + 2 * parseInt(params[0], 16)).toString(16) } };
  if (method === "eth_call") {
    const id = parseInt(params[0].data.slice(10), 16), block = parseInt(params[1], 16);
    return id <= highestAt(block) ? { result: "0x" + "0".repeat(24) + "ab".repeat(20) } : { error: "execution reverted" };
  }
  return { error: "unknown method " + method };
});
const iso = (block) => new Date((T0 + 2 * block) * 1000).toISOString();
const edition = (over) => JSON.stringify({ slug: "state-of-agent-money-2026-09", status: "final", produced_at: "2026-10-23T22:47:12Z",
  from: iso(1000), to: iso(2000), stocks: { registrations_minted_total: { definition_id: "reg.minted.base.v1" } },
  flows: { registrations: { base_minted: 20, base_total_at_end: 101 }, payments: { definition_id: "pay.usd.total.v2" } }, ...over });
const fetcher = (raw, inLog) => async (path) => {
  if (path.startsWith("/research/")) return raw;
  if (path === "/api/statements/log") { const sha = createHash("sha256").update(raw, "utf8").digest("hex"); return JSON.stringify({ leaves: inLog ? ["publication/1|state-of-agent-money-2026-09|" + sha + "|2026-10-23T22:47:12.940Z"] : [] }); }
  if (path.startsWith("/api/def?id=")) { const id = decodeURIComponent(path.slice(12)); return JSON.stringify(id === "missing.v1" ? { error: "unknown" } : { id }); }
  throw new Error("unexpected path " + path);
};

test("editioncheck passes when the hash is in the log and the chain agrees", async () => {
  const raw = edition({});
  const res = await editionCheck("2026-09", { api: "x", rpcUrl: "x", fetchText: fetcher(raw, true), rpcFn: fakeRpc });
  assert.equal(res.ok, true);
  const by = Object.fromEntries(res.checks.map((c) => [c.name, c]));
  assert.equal(by["hash committed to the statement log"].ok, true);
  assert.equal(by["registrations minted in the period"].ok, true);
  assert.match(by["registrations minted in the period"].detail, /ids 80 → 100 between blocks 1000 and 2000 = 20 minted/);
  assert.equal(by["registrations at the end of the period"].ok, true);
  assert.match(by["registrations at the end of the period"].detail, /highest id 100 plus id 0 = 101/);
  assert.equal(by["cited definitions resolve"].ok, true);
  assert.equal(by["counted payments"].ok, null);
});

test("editioncheck fails when the file's hash is not in the log, and when the chain disagrees", async () => {
  const raw = edition({});
  const a = await editionCheck("2026-09", { api: "x", rpcUrl: "x", fetchText: fetcher(raw, false), rpcFn: fakeRpc });
  assert.equal(a.ok, false);
  assert.equal(a.checks.find((c) => c.name === "hash committed to the statement log").ok, false);
  const wrong = edition({ flows: { registrations: { base_minted: 21, base_total_at_end: 101 }, payments: { definition_id: "pay.usd.total.v2" } } });
  const b = await editionCheck("2026-09", { api: "x", rpcUrl: "x", fetchText: fetcher(wrong, true), rpcFn: fakeRpc });
  assert.equal(b.ok, false);
  assert.match(b.checks.find((c) => c.name === "registrations minted in the period").detail, /= 20 minted; edition says 21/);
});

test("editioncheck marks a running edition and a missing definition", async () => {
  const raw = edition({ status: "running", stocks: { x: { definition_id: "missing.v1" } } });
  const res = await editionCheck("2026-09", { api: "x", rpcUrl: "x", fetchText: fetcher(raw, true), rpcFn: fakeRpc });
  const by = Object.fromEntries(res.checks.map((c) => [c.name, c]));
  assert.equal(by["hash committed to the statement log"].ok, null);
  assert.equal(by["cited definitions resolve"].ok, false);
  assert.match(by["cited definitions resolve"].detail, /missing: missing.v1/);
});
