// auravms-mcp is a stdio relay to the AuraVMS MCP server (src/index.ts).
//
// Part 1 runs anywhere: a fake MCP server checks what the relay sends and that
// replies come back byte-for-byte as JSON-RPC.
// Part 2 is end to end: with MCP_GATEWAY_DIR pointing at a vms-frontend checkout's
// mcp-gateway (npm ci done there), it starts the real gateway under wrangler dev
// against its fake backend, and checks that the relay with an API key gets the
// same tools and the same error and paywall texts as an OAuth client of
// mcp.auravms.com.
// Run: npm run build && npm test
//      MCP_GATEWAY_DIR=../vms-frontend/mcp-gateway npm test
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const RELAY = join(fileURLToPath(new URL("..", import.meta.url)), "dist/index.js");

// Drives the relay over stdio with raw JSON-RPC lines, as an MCP client does.
function startRelay(env) {
  const child = spawn(process.execPath, [RELAY], {
    env: { PATH: process.env.PATH, ...env },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const waiting = new Map();
  let buffer = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      const message = JSON.parse(line);
      waiting.get(message.id)?.(message);
      waiting.delete(message.id);
    }
  });
  child.stderr.on("data", (chunk) => (stderr += chunk));
  let nextId = 1;
  const request = (method, params = {}) =>
    new Promise((resolveReply, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => reject(new Error(`no reply to ${method}; stderr: ${stderr}`)), 15000);
      waiting.set(id, (message) => {
        clearTimeout(timer);
        resolveReply(message);
      });
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  const notify = (method, params = {}) => child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  const initialize = async () => {
    const reply = await request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "relay-test", version: "1" } });
    if (reply.result) notify("notifications/initialized");
    return reply;
  };
  const exited = new Promise((r) => child.on("exit", (code) => r(code)));
  return { request, notify, initialize, exited, stderr: () => stderr, stop: () => child.kill() };
}

async function startFakeServer() {
  const seen = [];
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    seen.push({ method: req.method, headers: req.headers, body: raw ? JSON.parse(raw) : null });
    if (req.method !== "POST") {
      res.writeHead(405, { Allow: "POST" });
      return res.end();
    }
    if (req.headers.authorization !== "Bearer avms_good") {
      res.writeHead(401, { "Content-Type": "application/json", "WWW-Authenticate": 'Bearer error="invalid_token"' });
      return res.end(JSON.stringify({ error: "invalid_token", error_description: "AuraVMS did not accept this API key: test." }));
    }
    const message = JSON.parse(raw);
    if (!("id" in message)) {
      res.writeHead(202);
      return res.end();
    }
    const result =
      message.method === "initialize"
        ? { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "auravms", version: "1.0.0" } }
        : message.method === "tools/list"
          ? { tools: [{ name: "list_rfqs", inputSchema: { type: "object" }, annotations: { readOnlyHint: true } }] }
          : { content: [{ type: "text", text: "PAYMENT_REQUIRED: test" }], isError: true };
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
  });
  await new Promise((r) => server.listen(0, r));
  return { url: `http://localhost:${server.address().port}/mcp`, seen, close: () => server.close() };
}

test("relays initialize, tools/list and tools/call with the API key as bearer", async () => {
  const server = await startFakeServer();
  const relay = startRelay({ AVMS_API_KEY: "avms_good", AURAVMS_MCP_URL: server.url });
  try {
    const init = await relay.initialize();
    assert.equal(init.result.serverInfo.name, "auravms");
    const list = await relay.request("tools/list");
    assert.deepEqual(list.result.tools, [{ name: "list_rfqs", inputSchema: { type: "object" }, annotations: { readOnlyHint: true } }]);
    const call = await relay.request("tools/call", { name: "list_rfqs", arguments: {} });
    assert.deepEqual(call.result, { content: [{ type: "text", text: "PAYMENT_REQUIRED: test" }], isError: true });
    const posts = server.seen.filter((r) => r.method === "POST");
    assert.ok(posts.every((r) => r.headers.authorization === "Bearer avms_good"));
    assert.match(posts[0].headers["user-agent"], /^auravms-mcp\/0\.2\.0/);
    const toolsList = posts.find((r) => r.body?.method === "tools/list");
    assert.equal(toolsList.headers["mcp-protocol-version"], "2025-06-18");
  } finally {
    relay.stop();
    server.close();
  }
});

test("AURAVMS_API_KEY works as well as AVMS_API_KEY", async () => {
  const server = await startFakeServer();
  const relay = startRelay({ AURAVMS_API_KEY: "avms_good", AURAVMS_MCP_URL: server.url });
  try {
    assert.ok((await relay.initialize()).result);
  } finally {
    relay.stop();
    server.close();
  }
});

test("a rejected key answers initialize with the server's message", async () => {
  const server = await startFakeServer();
  const relay = startRelay({ AVMS_API_KEY: "avms_revoked", AURAVMS_MCP_URL: server.url });
  try {
    const init = await relay.initialize();
    assert.equal(init.error.code, -32603);
    assert.equal(init.error.message, "AuraVMS did not accept this API key: test.");
  } finally {
    relay.stop();
    server.close();
  }
});

test("server unreachable -> JSON-RPC error, not a crash", async () => {
  const relay = startRelay({ AVMS_API_KEY: "avms_good", AURAVMS_MCP_URL: "http://localhost:9/mcp" });
  try {
    const init = await relay.initialize();
    assert.match(init.error.message, /Could not reach the AuraVMS MCP server/);
  } finally {
    relay.stop();
  }
});

test("no API key -> exits 1 with setup help", async () => {
  const relay = startRelay({});
  assert.equal(await relay.exited, 1);
  assert.match(relay.stderr(), /AVMS_API_KEY environment variable is not set/);
});

const gatewayDir = process.env.MCP_GATEWAY_DIR;
test("end to end: relay with an API key == OAuth client of mcp.auravms.com", { skip: gatewayDir ? false : "set MCP_GATEWAY_DIR to a vms-frontend/mcp-gateway checkout" }, async () => {
  const { startHarness, signInWithOAuth, mintApiKey, mcp, toolOutcome } = await import(pathToFileURL(join(resolve(gatewayDir), "test/harness.mjs")).href);
  const { GATEWAY, BACKEND, stop } = await startHarness();
  const relays = [];
  try {
    const direct = `${GATEWAY}/mcp`;
    const { accessToken } = await signInWithOAuth(GATEWAY, BACKEND);
    const relay = startRelay({ AVMS_API_KEY: await mintApiKey(BACKEND), AURAVMS_MCP_URL: direct });
    const expiredRelay = startRelay({ AVMS_API_KEY: await mintApiKey(BACKEND, { expired: true }), AURAVMS_MCP_URL: direct });
    relays.push(relay, expiredRelay);

    const init = await relay.initialize();
    const oauthInit = await mcp(direct, accessToken, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "x", version: "1" } });
    assert.deepEqual(init.result, oauthInit.body.result);

    const oauthTools = (await mcp(direct, accessToken, "tools/list")).body.result.tools;
    assert.deepEqual((await relay.request("tools/list")).result.tools, oauthTools);
    assert.ok(oauthTools.length >= 12);

    const viaRelay = async (r, name, args) => toolOutcome({ status: 200, body: await r.request("tools/call", { name, arguments: args }) });
    for (const [name, args] of [["close_rfq", { rfq_id: 9 }], ["get_rfq", { rfq_id: 404 }], ["get_rfq", { rfq_id: -1 }], ["list_rfqs", {}]]) {
      const expected = toolOutcome(await mcp(direct, accessToken, "tools/call", { name, arguments: args }));
      assert.deepEqual(await viaRelay(relay, name, args), expected, `${name} ${JSON.stringify(args)}`);
    }
    const paywall = toolOutcome(await mcp(direct, accessToken, "tools/call", { name: "close_rfq", arguments: { rfq_id: 9 } }));
    assert.match(paywall.text, /^PAYMENT_REQUIRED: /);

    await expiredRelay.initialize();
    const expired = await viaRelay(expiredRelay, "list_suppliers", {});
    assert.equal(expired.isError, true);
    assert.equal(expired.text, paywall.text);

    const rejected = startRelay({ AVMS_API_KEY: "avms_0000000000000000000000000000000000000000", AURAVMS_MCP_URL: direct });
    relays.push(rejected);
    assert.match((await rejected.initialize()).error.message, /^AuraVMS did not accept this API key/);
  } finally {
    relays.forEach((r) => r.stop());
    stop();
  }
});
