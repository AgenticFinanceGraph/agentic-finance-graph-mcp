#!/usr/bin/env node
/* booksverify.mjs — check an Agent Books statement (agent.books.v1) without trusting the server that issued it.
   No dependencies; Node 18+.

     node booksverify.mjs <agent> [period]            fetch /api/books and check it   (also: afg booksverify <agent> [period])
     node booksverify.mjs --file statement.json        check a saved answer
     node booksverify.mjs --selftest <agent> [period]  also prove the checks fail on altered copies

   Steps: (1) SHA-256 of the canonical text; (2) Ed25519 signature with the published key; (3) the body equals the
   canonical text; (4) the log leaf is built from this statement; (5) RFC 6962 inclusion under a signed head and that
   head's signature; (6) the Base anchor transaction, read from a public node, names a head that covers the leaf.
   Steps 5 and 6 report "not yet" until the next signed head (every three hours) and the daily anchor (04:30 UTC). */
import { createHash, createPublicKey, verify as edVerify } from "node:crypto";
import { readFileSync } from "node:fs";

const SITE = process.env.AFG_SITE || "https://agenticfinancegraph.com";
const BASE_RPC = process.env.BASE_RPC || "https://mainnet.base.org";
const sha256 = (...b) => createHash("sha256").update(Buffer.concat(b)).digest();
const unhex = (s) => Buffer.from(String(s).replace(/^0x/, ""), "hex");
const edKey = (hex) => createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), unhex(hex)]), format: "der", type: "spki" });
const canonicalize = (v) => (v === null || typeof v !== "object" ? JSON.stringify(v) : Array.isArray(v) ? "[" + v.map(canonicalize).join(",") + "]"
  : "{" + Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => JSON.stringify(k) + ":" + canonicalize(v[k])).join(",") + "}");
const getJson = async (url, init) => { const r = await fetch(url, Object.assign({ signal: AbortSignal.timeout(30000) }, init)); if (!r.ok) throw new Error(url + " answered " + r.status); return r.json(); };

/* RFC 9162 §2.1.3.2 */
function inclusionRoot(index, size, leafH, path) {
  if (index >= size) return null;
  let fn = index, sn = size - 1, r = leafH;
  for (const p of path) {
    if (sn === 0) return null;
    if (fn % 2 === 1 || fn === sn) { r = sha256(Buffer.from([1]), p, r); if (fn % 2 === 0) while (fn % 2 === 0 && fn !== 0) { fn >>= 1; sn >>= 1; } }
    else r = sha256(Buffer.from([1]), r, p);
    fn >>= 1; sn >>= 1;
  }
  return sn === 0 ? r : null;
}

export async function verifyStatement(j, { keys, logDoc, rpc = BASE_RPC } = {}) {
  const out = [];
  const step = (n, name, ok, note) => { out.push({ step: n, name, ok, ...(note ? { note } : {}) }); return ok; };
  if (!j.signed) { step(0, "signed", false, j.note || "this answer is not signed"); return out; }
  const canon = Buffer.from(j.canonical, "utf8");
  step(1, "hash", sha256(canon).toString("hex") === j.sha256);
  keys = keys || await getJson(SITE + "/.well-known/afg-pass-keys.json");
  const k = (keys.keys || []).find((x) => x.key_id === j.key_id);
  step(2, "signature", !!k && edVerify(null, canon, edKey(k.public_key_hex), Buffer.from(j.signature, "base64")), k ? undefined : "key " + j.key_id + " is not published");
  step(3, "body equals the signed text", canonicalize(j.body) === j.canonical);
  const leaf = "publication/1|" + j.slug + "|" + j.sha256 + "|" + j.body.produced_at;
  step(4, "log leaf built from this statement", !!j.log && j.log.leaf === leaf && j.log.leaf_hash === "0x" + sha256(Buffer.from([0]), Buffer.from(leaf, "utf8")).toString("hex"));
  const leafH = sha256(Buffer.from([0]), Buffer.from(leaf, "utf8"));
  if (!j.log || !j.log.signed_head) step(5, "inclusion under a signed head", null, "not yet: the next signed head (every three hours) will cover the leaf");
  else {
    const h = j.log.signed_head;
    const root = inclusionRoot(j.log.leaf_index, h.tree_size, leafH, (j.log.audit_path || []).map(unhex));
    logDoc = logDoc || await getJson(SITE + "/api/statements/log");
    const lk = logDoc.key && logDoc.key.public_key_hex;
    const sigOk = !!lk && edVerify(null, Buffer.from(`afg-statement-log:v1:${h.tree_size}:${h.root_hash}:${h.timestamp_ms}`), edKey(lk), Buffer.from(h.signature, "base64"));
    step(5, "inclusion under a signed head", !!root && "0x" + root.toString("hex") === h.root_hash && sigOk, sigOk ? undefined : "the head's signature did not verify");
  }
  if (!j.log || !j.log.base_anchor) step(6, "Base anchor", null, "not yet: the daily anchor (04:30 UTC) will commit to a head that covers the leaf");
  else {
    const a = j.log.base_anchor;
    const root = inclusionRoot(j.log.leaf_index, a.tree_size, leafH, (a.audit_path || []).map(unhex));
    const tx = (await getJson(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getTransactionByHash", params: [a.tx] }) })).result;
    const text = tx ? Buffer.from(tx.input.slice(2), "hex").toString("utf8") : "";
    const named = text.includes("|statement-log:" + a.tree_size + ":" + a.root_hash + ":");
    step(6, "Base anchor", !!root && "0x" + root.toString("hex") === a.root_hash && named && !!tx && tx.from === tx.to, named ? "block " + parseInt(tx.blockNumber, 16) + ", from " + tx.from : "the transaction does not name this head");
  }
  return out;
}

export async function runCli(argv, print = console.log) {
  const args = argv.slice();
  const selftest = args[0] === "--selftest"; if (selftest) args.shift();
  let j;
  if (args[0] === "--file") j = JSON.parse(readFileSync(args[1], "utf8"));
  else { if (!args[0]) { print("usage: booksverify <agent> [YYYY-MM | to-date]   |   --file statement.json   |   --selftest <agent> [period]"); return 2; } j = await getJson(SITE + "/api/books?agent=" + encodeURIComponent(args[0]) + "&period=" + encodeURIComponent(args[1] || "to-date")); }
  const res = await verifyStatement(j);
  for (const r of res) print((r.ok === true ? "ok      " : r.ok === null ? "not yet " : "FAILED  ") + r.step + ". " + r.name + (r.note ? "  (" + r.note + ")" : ""));
  const failed = res.some((r) => r.ok === false);
  if (j.signed) print("statement " + j.body.books_id + ": registration " + j.body.agent.token_id + ", period " + j.body.period.id + ", produced " + j.body.produced_at + ", sha256 " + j.sha256);
  if (selftest && j.signed) {
    const keys = await getJson(SITE + "/.well-known/afg-pass-keys.json");
    const alter = (f) => { const c = JSON.parse(JSON.stringify(j)); f(c); return c; };
    const cases = [
      ["a figure changed in the signed text", alter((c) => { c.canonical = c.canonical.replace(/"payments":(\d+)/, (m, n) => '"payments":' + (Number(n) + 1)); }), [1, 2]],
      ["a figure changed in the body only", alter((c) => { c.body.paid.usd += 1; }), [3]],
      ["the hash replaced to match an altered text", alter((c) => { c.canonical = c.canonical.replace(/"payments":(\d+)/, (m, n) => '"payments":' + (Number(n) + 1)); c.sha256 = sha256(Buffer.from(c.canonical, "utf8")).toString("hex"); }), [2, 4]],
      ["another statement's signature", alter((c) => { c.signature = Buffer.from(c.signature, "base64").reverse().toString("base64"); }), [2]],
    ];
    if (j.log && j.log.signed_head) cases.push(["the leaf index moved", alter((c) => { c.log.leaf_index += 1; }), [5]]);
    if (j.log && j.log.base_anchor) cases.push(["the anchored head swapped", alter((c) => { c.log.base_anchor.root_hash = "0x" + "11".repeat(32); }), [6]]);
    let good = 0;
    for (const [name, c, mustFail] of cases) {
      const r = await verifyStatement(c, { keys });
      const fails = r.filter((x) => x.ok === false).map((x) => x.step);
      const caught = mustFail.every((s) => fails.includes(s));
      print((caught ? "ok      " : "MISSED  ") + "altered copy: " + name + " -> failed steps " + JSON.stringify(fails));
      if (caught) good++;
    }
    print("selftest: " + good + " of " + cases.length + " altered copies rejected");
    if (good !== cases.length) return 1;
  }
  return failed ? 1 : 0;
}
if (process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("booksverify.mjs")) runCli(process.argv.slice(2)).then((code) => process.exit(code)).catch((e) => { console.error("error: " + (e && e.message || e)); process.exit(2); });
