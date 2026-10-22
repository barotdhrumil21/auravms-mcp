# AuraVMS MCP agent guidance

## Scope

This repository publishes the `auravms-mcp` stdio package: a relay from stdio to the AuraVMS MCP server at `https://mcp.auravms.com/mcp` (vms-frontend `mcp-gateway/`), authenticated with the user's API key. Tools are implemented and changed in the gateway, not here.

## Validate changes

- Run `npm install` when dependencies change.
- Run `npm run build` and `npm test` before committing TypeScript or package changes. With a vms-frontend checkout, also run `MCP_GATEWAY_DIR=<vms-frontend>/mcp-gateway npm test`.
- Keep `README.md`, `server.json` and package metadata aligned with the implementation and the gateway's tools.

## Product invariants

- The relay passes messages through unchanged: it adds no tools and rewrites no results, so stdio users get exactly what Claude and ChatGPT connector users get.
- Product rules (draft-first RFQs, destructive annotations on tools that email suppliers or commit purchases, the reminder throttle, PAYMENT_REQUIRED texts) live in the gateway.
- Prefer read-only lookups before mutations, and never guess supplier, RFQ, item, response, quantity, price, or delivery identifiers.

## Security

- Never commit API keys, JWTs, supplier links, quotation data, or captured API responses.
- Send `AVMS_API_KEY` only to `https://mcp.auravms.com/mcp`, unless a user explicitly configures `AURAVMS_MCP_URL` for an authorized environment.
- Do not broaden access to organization settings, billing, user administration, bulk import, or supplier-side quote submission.

## Canonical references

- Agent skill: `skills/auravms-procurement/SKILL.md`
- API contract: https://www.auravms.com/openapi.json
- Authentication: https://www.auravms.com/auth.md
- Agent index: https://www.auravms.com/index.md
- Remote MCP card: https://www.auravms.com/.well-known/mcp/server-card.json
