import { test } from "node:test";
import assert from "node:assert/strict";
import { matchPayment } from "../bin/chaincheck.mjs";

const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const EURC = "0x60a3e35cc302bfa44cb288bc5a4f316fdb1adb42";
const DAI = "0x50c5725949a6f0c72e6c4a641f24049a917db0cb";
const FROM = "0x5761d3d1806620c75576c6d1c014bb81d72493e8";
const TO = "0x8a311d7048c35985aa31c131b9a13e03a5f7422d";
const pad = (a) => "0x" + a.slice(2).padStart(64, "0");
const log = (token, from, to, raw) => ({ address: token, topics: [TRANSFER, pad(from), pad(to)], data: "0x" + BigInt(raw).toString(16) });
const receipt = (logs, status = "0x1") => ({ status, logs, blockNumber: "0x1" });

test("a USDC transfer from the bound wallet to the stated recipient, for the stated amount, holds", () => {
  const m = matchPayment(receipt([log(USDC, FROM, TO, 137050000n)]), new Set([FROM]), TO, 137.05);
  assert.equal(m.ok, true);
  assert.equal(m.token, "USDC");
  assert.equal(m.amount, 137.05);
});

test("the same transfer to another recipient does not hold", () => {
  const other = "0x1111111111111111111111111111111111111111";
  assert.equal(matchPayment(receipt([log(USDC, FROM, other, 137050000n)]), new Set([FROM]), TO, 137.05).ok, false);
});

test("a transfer from a wallet that is not bound does not hold", () => {
  const stranger = "0x2222222222222222222222222222222222222222";
  assert.equal(matchPayment(receipt([log(USDC, stranger, TO, 137050000n)]), new Set([FROM]), TO, 137.05).ok, false);
});

test("a reverted transaction does not hold, whatever its logs say", () => {
  const m = matchPayment(receipt([log(USDC, FROM, TO, 137050000n)], "0x0"), new Set([FROM]), TO, 137.05);
  assert.equal(m.ok, false);
  assert.match(m.why, /reverted/);
});

test("an amount off by more than half a percent does not hold", () => {
  assert.equal(matchPayment(receipt([log(USDC, FROM, TO, 140000000n)]), new Set([FROM]), TO, 137.05).ok, false);
});

test("EURC is priced at the day's rate, so a value within 15% holds", () => {
  assert.equal(matchPayment(receipt([log(EURC, FROM, TO, 100000000n)]), new Set([FROM]), TO, 108.2).ok, true);
});

test("DAI has 18 decimals", () => {
  const m = matchPayment(receipt([log(DAI, FROM, TO, 25n * 10n ** 18n)]), new Set([FROM]), TO, 25);
  assert.equal(m.ok, true);
  assert.equal(m.amount, 25);
});

test("a token that is not one of the four counted stablecoins is ignored", () => {
  const fake = "0x3333333333333333333333333333333333333333";
  const m = matchPayment(receipt([log(fake, FROM, TO, 137050000n)]), new Set([FROM]), TO, 137.05);
  assert.equal(m.ok, false);
  assert.match(m.why, /no stablecoin/);
});
