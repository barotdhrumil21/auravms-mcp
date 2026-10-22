#!/usr/bin/env node
/**
 * auravms-mcp — stdio connection to the AuraVMS MCP server.
 *
 * AuraVMS runs one MCP server, https://mcp.auravms.com/mcp. This package is a
 * thin relay to it for clients that start local stdio servers (Claude Desktop,
 * Claude Code, Codex, Cursor configs using `npx auravms-mcp`): every JSON-RPC
 * message from stdin is POSTed there with the user's API key as the bearer
 * token, and every reply is written to stdout. Tools, their safety annotations,
 * error and paywall texts all come from the server, so they are the same as in
 * the Claude and ChatGPT connectors.
 *
 * Environment:
 *   AVMS_API_KEY (or AURAVMS_API_KEY)  AuraVMS API key, avms_...
 *   AURAVMS_MCP_URL                    another MCP server URL (tests, staging)
 */

import { StreamableHTTPClientTransport, StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";

const VERSION = "0.2.0";
const SERVER_URL = process.env.AURAVMS_MCP_URL ?? "https://mcp.auravms.com/mcp";
const API_KEY = process.env.AVMS_API_KEY ?? process.env.AURAVMS_API_KEY;

if (!API_KEY) {
  console.error(
    "auravms-mcp: AVMS_API_KEY environment variable is not set.\n" +
      "Create an API key in the AuraVMS app under Settings > API Keys " +
      "(https://app.auravms.com), then run with AVMS_API_KEY=avms_... " +
      "(e.g. claude mcp add auravms -e AVMS_API_KEY=avms_... -- npx auravms-mcp).\n" +
      "Or skip the key: connect to https://mcp.auravms.com/mcp directly and sign in with your AuraVMS account."
  );
  process.exit(1);
}
if (process.env.AVMS_BASE_URL) {
  console.error("auravms-mcp: AVMS_BASE_URL is no longer used; tools now run on the AuraVMS MCP server. Set AURAVMS_MCP_URL to use another server.");
}

const local = new StdioServerTransport();
const remote = new StreamableHTTPClientTransport(new URL(SERVER_URL), {
  requestInit: { headers: { Authorization: `Bearer ${API_KEY}`, "User-Agent": `auravms-mcp/${VERSION}` } },
});

// initialize requests in flight, to read the negotiated protocol version from their reply.
const initializeIds = new Set<string | number>();

const isRequest = (message: JSONRPCMessage): message is JSONRPCMessage & { id: string | number; method: string } =>
  "method" in message && "id" in message && message.id !== undefined;

// The server's own words when it refuses the request (e.g. a rejected API key).
function describeFailure(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error);
  const body = raw.replace(/^Streamable HTTP error: Error POSTing to endpoint: /, "");
  try {
    const parsed = JSON.parse(body);
    const text = parsed?.error_description ?? parsed?.error?.message ?? (typeof parsed?.error === "string" ? parsed.error : undefined);
    if (text) return String(text);
  } catch {
    // Not JSON; fall through.
  }
  if (error instanceof StreamableHTTPError) return `The AuraVMS MCP server answered HTTP ${error.code}: ${body.slice(0, 300)}`;
  return `Could not reach the AuraVMS MCP server at ${SERVER_URL}: ${raw}`;
}

local.onmessage = async (message) => {
  if (isRequest(message) && message.method === "initialize") initializeIds.add(message.id);
  try {
    await remote.send(message);
  } catch (error) {
    if (!isRequest(message)) return;
    initializeIds.delete(message.id);
    await local.send({ jsonrpc: "2.0", id: message.id, error: { code: -32603, message: describeFailure(error) } });
  }
};

remote.onmessage = async (message) => {
  // Later requests carry the negotiated MCP-Protocol-Version header.
  if ("id" in message && initializeIds.delete(message.id as string | number) && "result" in message) {
    const version = (message.result as { protocolVersion?: unknown })?.protocolVersion;
    if (typeof version === "string") remote.setProtocolVersion(version);
  }
  await local.send(message);
};

remote.onerror = (error) => console.error(`auravms-mcp: ${describeFailure(error)}`);
local.onclose = () => {
  void remote.close().finally(() => process.exit(0));
};

await remote.start();
await local.start();
console.error(`auravms-mcp ${VERSION}: relaying stdio to ${SERVER_URL}`);
