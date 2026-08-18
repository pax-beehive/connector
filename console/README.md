# PAX Console

Operator-facing, read-only UI for the FDE platform. The app lives independently
from the Go connector SDK and uses a typed repository boundary for prototype
and authenticated production metadata.

## Current scope

- Operational overview and attention queue
- Tenant context that scopes overview, directory, connectors, routes, events,
  usage, and audit data
- Connector inventory and a two-step, secret-free prototype connection flow
- LLM routing, events, usage and cost, and audit workspaces
- Responsive desktop and compact navigation
- Dark and light themes

Production composition uses `PlatformConsoleRepository` on the server. The
Cloudflare deployment validates the Access JWT issuer, audience, signature, and
expiry before it calls the protected admin edge with a dedicated service
credential stored as encrypted Worker secrets. The browser receives only the
mapped metadata snapshot; no service credential, provider credential, payload
body, or credential envelope crosses that boundary. Management actions remain
disabled because their command APIs and user role mapping are not implemented.

## Private preview

The private Console is published at
`https://pax-fde-console.toddbarnes.chatgpt.site`. Hosting access is owner-only:
the policy has one allowed owner, no groups, and no external visitors, while an
anonymous request receives `401`.

## Production deployment

The production Worker uses only `fde-console.paxtech.net`; its `workers.dev`
and preview URLs are disabled. Cloudflare Access allows only the named Console
owner. The Worker validates the Access assertion again before server rendering,
then calls `fde-console-api.paxtech.net` with encrypted service credentials.
Anonymous requests must be rejected before the Worker runs.

## Commands

```bash
pnpm install
pnpm dev
pnpm quality
pnpm build
```

`pnpm quality` enforces ESLint complexity at 20, strict TypeScript, source
language checks, at least 80% aggregate unit-test coverage across application
logic and the Worker adapter, and a rendered application test for the Next
entrypoint.

## API boundary

`ConsoleRepository` in `src/domain/console.ts` isolates page modules from the
platform response. Server composition happens in `app/page.tsx` and fails closed
when live mode lacks the selected host identity or service configuration. Local
execution defaults to the explicitly labeled prototype; production sets
`CONSOLE_DATA_MODE=live` and `CONSOLE_AUTH_MODE=cloudflare_access`. User role
mapping and audited command APIs are required before any management action can
be enabled.
