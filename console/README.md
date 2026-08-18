# PAX Console

Operator-facing UI framework for the FDE platform. The app lives independently
from the Go connector SDK and uses a typed repository boundary so prototype data
can be replaced by authenticated platform APIs without changing page modules.

## Current scope

- Operational overview and attention queue
- Tenant context that scopes overview, directory, connectors, routes, events,
  usage, and audit data
- Connector inventory and a two-step, secret-free connection flow
- LLM routing, events, usage and cost, and audit workspaces
- Responsive desktop and compact navigation
- Dark and light themes

The current repository is `prototypeRepository`. It is intentionally labeled in
the interface and makes no live production claims.

## Private preview

The validated prototype is published at
`https://pax-fde-console.toddbarnes.chatgpt.site`. Hosting access is owner-only:
the policy has one allowed owner, no groups, and no external visitors, while an
anonymous request receives `401`. The preview remains sample-only; it does not
connect to platform data or enable operator actions.

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

Implement `ConsoleRepository` in `src/domain/console.ts` when the admin APIs are
available. Server composition happens in `app/page.tsx`; secrets must never be
passed to the browser-facing snapshot. Before replacing prototype data or
enabling actions, require verified Cloudflare Access identity and platform
roles at the server boundary.
