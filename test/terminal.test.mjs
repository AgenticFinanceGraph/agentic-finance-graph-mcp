import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { forTerminal } from "../bin/terminal.mjs";

const CLI = fileURLToPath(new URL("../bin/afg.mjs", import.meta.url));
const ESC = "\u001b";
const RLO = "‮"; // right-to-left override

test("escapes ANSI escape sequences instead of passing them to the terminal", () => {
  const out = forTerminal(`${ESC}[2J${ESC}[31mSAFE AGENT`);
  assert.equal(out, "\\u001b[2J\\u001b[31mSAFE AGENT");
  assert.ok(!out.includes(ESC));
});

test("escapes bidirectional overrides and isolates", () => {
  const out = forTerminal(`pay 0xabc${RLO}fed and ⁦x⁩ ‏`);
  assert.equal(out, "pay 0xabc\\u202efed and \\u2066x\\u2069 \\u200f");
});

test("escapes C0 (except tab and newline), DEL and C1 controls", () => {
  assert.equal(forTerminal("a\u0000b\u0007c\u007fd\u009be\u0085f"), "a\\u0000b\\u0007c\\u007fd\\u009be\\u0085f");
});

test("leaves ordinary text alone: tabs, newlines, emoji, other scripts", () => {
  const text = "Agent \u{1F916}\tагент 代理 وكيل\nline two, $1,490.10";
  assert.equal(forTerminal(text), text);
});

/* A stand-in for the MCP endpoint that answers every call with `reply(msg)`. */
async function stubServer(reply) {
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(reply(JSON.parse(body))));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { server, url: `http://127.0.0.1:${server.address().port}/mcp` };
}

function run(args, url, stdin) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], { env: { ...process.env, AFG_MCP_URL: url } });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (c) => (stdout += c));
    child.stderr.setEncoding("utf8").on("data", (c) => (stderr += c));
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    if (stdin !== undefined) child.stdin.end(stdin);
  });
}

const hostileName = `${ESC}[2J${ESC}[32mVerified agent ${RLO}0dcba`;
const toolReply = (msg) => ({
  jsonrpc: "2.0",
  id: msg.id,
  result: { content: [{ type: "text", text: `Agent #7: ${hostileName}` }] },
});

test("the CLI prints a stranger-written name without acting on its control characters", async () => {
  const { server, url } = await stubServer(toolReply);
  try {
    const { code, stdout } = await run(["find", "7"], url);
    assert.equal(code, 0);
    assert.ok(!stdout.includes(ESC), "no raw escape byte reaches the terminal");
    assert.ok(!stdout.includes(RLO), "no raw direction override reaches the terminal");
    assert.ok(stdout.includes("\\u001b[2J") && stdout.includes("\\u202e"), "the escapes stay visible");
  } finally {
    server.close();
  }
});

test("error messages from the server are escaped too", async () => {
  const { server, url } = await stubServer((msg) => ({ jsonrpc: "2.0", id: msg.id, error: { code: -32000, message: hostileName } }));
  try {
    const { code, stderr } = await run(["find", "7"], url);
    assert.equal(code, 1);
    assert.ok(!stderr.includes(ESC) && !stderr.includes(RLO));
  } finally {
    server.close();
  }
});

test("the MCP bridge forwards answers unchanged", async () => {
  const { server, url } = await stubServer(toolReply);
  try {
    const request = { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "find_agent", arguments: { query: "7" } } };
    const { code, stdout } = await run(["mcp"], url, JSON.stringify(request) + "\n");
    assert.equal(code, 0);
    assert.equal(stdout, JSON.stringify(toolReply(request)) + "\n");
  } finally {
    server.close();
  }
});
