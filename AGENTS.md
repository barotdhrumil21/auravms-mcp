# AuraVMS MCP agent guidance

## Scope

This repository publishes the `auravms-mcp` stdio server. It maps agent tool calls to the authenticated AuraVMS procurement API at `https://api.auravms.com`.

## Validate changes

- Run `npm install` when dependencies change.
- Run `npm run build` before committing TypeScript or package changes.
- Keep `README.md`, `server.json`, package metadata, and tool descriptions aligned with the implementation.

## Product invariants

- Keep `create_rfq` draft-first. Sending an RFQ must require an explicit `send: true` after user confirmation.
- Keep `place_order` gated by `confirm: true`; it creates a purchase commitment and emails a supplier.
- Keep supplier reminders throttled and require confirmation before contacting external recipients.
- Prefer read-only lookups before mutations, and never guess supplier, RFQ, item, response, quantity, price, or delivery identifiers.
- Preserve structured errors and 429 backoff so agents can stop or retry safely.

## Security

- Never commit API keys, JWTs, supplier links, quotation data, or captured API responses.
- Send `AVMS_API_KEY` only to `https://api.auravms.com`, unless a user explicitly configures `AVMS_BASE_URL` for an authorized environment.
- Do not broaden access to organization settings, billing, user administration, bulk import, or supplier-side quote submission.

## Canonical references

- Agent skill: `skills/auravms-procurement/SKILL.md`
- API contract: https://www.auravms.com/openapi.json
- Authentication: https://www.auravms.com/auth.md
- Agent index: https://www.auravms.com/index.md
- Remote MCP card: https://www.auravms.com/.well-known/mcp/server-card.json
