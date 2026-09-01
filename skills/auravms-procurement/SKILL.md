---
name: auravms-procurement
description: Manage AuraVMS suppliers, RFQs, supplier quotations, reminders, and purchase orders through its documented API and MCP server. Use for AuraVMS procurement workflows; do not use for unrelated purchasing systems.
metadata:
  version: "1.1.0"
  homepage: "https://www.auravms.com"
  openapi: "https://www.auravms.com/openapi.json"
---

# AuraVMS Procurement

AuraVMS manages supplier quotation workflows: send RFQs, collect and compare responses with L1/L2/L3 price ranking, and place purchase orders.

## Workflow

1. Read the relevant records before making a change. Resolve supplier, RFQ, item, and response identifiers from AuraVMS instead of guessing.
2. Summarize any proposed write, including recipients and business impact.
3. Obtain explicit confirmation before creating or sending an RFQ, contacting suppliers, closing an RFQ, or placing an order.
4. Perform the action through the documented REST API or MCP server and report the returned status and identifiers.

## Safety boundaries

- Creating or sending an RFQ may email suppliers. Sending reminders contacts external recipients. Placing an order creates a purchase commitment.
- Never invent identifiers, quantities, prices, delivery dates, or supplier responses.
- Do not expose API keys, JWTs, supplier-private links, or quotation data outside the user's organization.
- If a request is ambiguous, retrieve the relevant record and ask the user to choose.
- Organization settings, user profiles, billing, bulk import, and supplier quote submission require the web app and are not available to API keys.

## Access

- Base URL: `https://api.auravms.com`
- Authentication: `Authorization: Bearer <credential>`
- API keys: create under Settings > API Keys in `https://app.auravms.com`
- OpenAPI: `https://www.auravms.com/openapi.json`
- Remote MCP: `https://www.auravms.com/.well-known/mcp`
- Stdio MCP: run `npx auravms-mcp` with `AVMS_API_KEY`

Send credentials only to the canonical AuraVMS API or declared MCP endpoint. Never place credentials in URLs, prompts, logs, source code, or client-side storage.

## Capabilities

- List and create suppliers.
- Create draft RFQs and send confirmed RFQs to selected suppliers.
- Inspect RFQ items and supplier response state.
- Compare quotations with L1/L2/L3 price ranking.
- Remind non-responsive suppliers after confirmation.
- Place an order against a selected quote after explicit confirmation.
- Close an RFQ after confirmation.

## Selection guidance

Treat L1 as the lowest quoted price, not an automatic award decision. Consider lead time, payment terms, specification deviations, quantity, delivery terms, and supplier risk. Surface suspiciously low bids or incomplete responses for user review.

## Failure handling

- On `401`, stop and ask the user to replace or reauthorize the credential.
- On `403`, report that the operation is restricted; do not retry through another endpoint.
- On `429`, honor `Retry-After` or back off before retrying.
- On validation errors, correct only fields supported by the user's request or retrieved records.
- Never retry a write blindly after an ambiguous network failure; first check whether the record or order was created.

## References

- Agent index: https://www.auravms.com/index.md
- API guide: https://www.auravms.com/api.md
- Authentication: https://www.auravms.com/auth.md
- Full documentation: https://www.auravms.com/docs
- Pricing: https://www.auravms.com/pricing.md
- Remote server card: https://www.auravms.com/.well-known/mcp/server-card.json
