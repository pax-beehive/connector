# RFC 0001: FDE App Platform (Ingress / Egress / LLM)

- Status: Draft for team review
- Date: 2026-08-14
- Owner: todd.zheng
- Reviewers: (add)

## 1. Summary

Turn the connector SDK (this repo) into the kernel of a multi-tenant
platform that FDE teams use as the foundation for customer-specific apps.
The platform has three planes behind one customer-facing API key:

1. **Action Gateway (egress)** — customers connect their downstream
   credentials once; the platform hosts the connections and exposes typed
   actions through the connector SDK.
2. **Event Source (ingress)** — the platform hosts webhook endpoints,
   verifies and deduplicates provider events into an append-only log, and
   customers consume by cursor polling (queue semantics).
3. **LLM Gateway** — an OpenAI-compatible endpoint with rule-based routing
   of task classes to models, hot-swappable via configuration.

The three planes close the canonical FDE loop:
`poll events → LLM decides → invoke action`.

### Goals

- One platform key per customer; provider credentials custodied by us.
- Consumers never need public endpoints, signature code, or provider quirks.
- Per-tenant metering and cost attribution from day one.
- Runs at ~$50/month at the start; no cloud lock-in beyond thin adapters.

### Non-goals (v1)

- Self-serve onboarding, billing/invoicing, public SLAs (FDE-operated).
- Acting as a Meta/Google "Tech Provider" (customers bring their own apps;
  we custody tokens only).
- Normalized cross-provider schemas (we keep full API fidelity; the SDK's
  typed surface is the contract).
- Building our own webhook/event infra for providers we don't yet support.

## 2. Architecture overview

```
                     ┌──────────────── platform (multi-tenant) ────────────────┐
customer app ──key──▶│ Action Gateway   │  Event Source        │  LLM Gateway  │
  (or agent)         │ (egress, typed)  │  (hosted webhooks →  │  (routing,    │
                     │                  │   event log → poll)  │   hot swap)   │
                     │        credential vault ·  metering ·  audit           │
                     │        connector SDK (this repo) as the kernel          │
                     └─────────────────────────────────────────────────────────┘
                        ▼ provider APIs      ▲ provider webhooks    ▼ model APIs
```

- The SDK stays a dependency-light Go library; the platform is a separate
  service repo that embeds it. The generator pipeline remains the moat:
  any OpenAPI spec becomes a production connector (typed methods, tests,
  AGENTS.md, freshness watch) in about a day.
- Terminology: **connector** = code (a provider package in this repo);
  **connection** = one tenant's credentialed instance of a provider
  (0..n per tenant per provider).

## 3. Tenancy and data model

Core chain: `tenant → api_keys` (platform access) and
`tenant → connections → credentials` (provider access). Postgres with
row-level security keyed on `tenant_id`, which is denormalized onto every
high-volume table.

```sql
CREATE TABLE tenants (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug        TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'active',      -- active | suspended
    metadata    JSONB NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE api_keys (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID NOT NULL REFERENCES tenants(id),
    name         TEXT NOT NULL,                      -- "prod", "staging"
    key_prefix   TEXT NOT NULL,                      -- pk_live_3f9a… (display/lookup)
    key_hash     TEXT NOT NULL UNIQUE,               -- SHA-256; plaintext never stored
    scopes       TEXT[] NOT NULL DEFAULT '{actions:*,events:read,llm:invoke}',
    status       TEXT NOT NULL DEFAULT 'active',     -- active | revoked
    last_used_at TIMESTAMPTZ,
    expires_at   TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at   TIMESTAMPTZ
);
CREATE INDEX ON api_keys (tenant_id) WHERE status = 'active';

CREATE TABLE providers (                             -- connector code registry
    id            TEXT PRIMARY KEY,                  -- 'instagram', 'googleads', …
    display_name  TEXT NOT NULL,
    auth_type     TEXT NOT NULL,                     -- api_key | bearer | oauth2_refresh | custom
    capabilities  JSONB NOT NULL DEFAULT '{}',       -- {"actions":true,"events":true}
    status        TEXT NOT NULL DEFAULT 'active'
);

-- One tenant has 0..n connections per provider.
CREATE TABLE connections (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id),
    provider_id         TEXT NOT NULL REFERENCES providers(id),
    name                TEXT NOT NULL,               -- human label
    external_account_id TEXT,                        -- ig user id / act_123 / siteId / customerId
    is_default          BOOLEAN NOT NULL DEFAULT false,
    config              JSONB NOT NULL DEFAULT '{}', -- non-secret: version, login_customer_id, …
    status              TEXT NOT NULL DEFAULT 'active', -- active | needs_reauth | disabled | error
    last_health_at      TIMESTAMPTZ,
    last_error          TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_conn_external ON connections (tenant_id, provider_id, external_account_id)
    WHERE external_account_id IS NOT NULL;
CREATE UNIQUE INDEX uq_conn_default  ON connections (tenant_id, provider_id) WHERE is_default;
CREATE INDEX ON connections (tenant_id, provider_id);

-- Secrets isolated from business data: separate access role, KMS envelope
-- encryption, rotation history, retire-not-delete.
CREATE TABLE credentials (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    connection_id UUID NOT NULL REFERENCES connections(id),
    version       INT  NOT NULL,
    payload_enc   BYTEA NOT NULL,                    -- encrypted JSON payload
    kms_key_id    TEXT  NOT NULL,
    status        TEXT  NOT NULL DEFAULT 'current',  -- current | retired
    expires_at    TIMESTAMPTZ,                       -- drives refresh jobs
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    retired_at    TIMESTAMPTZ,
    UNIQUE (connection_id, version)
);
CREATE UNIQUE INDEX uq_cred_current ON credentials (connection_id) WHERE status = 'current';

CREATE TABLE webhook_endpoints (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    connection_id  UUID NOT NULL REFERENCES connections(id),
    endpoint_token TEXT NOT NULL UNIQUE,             -- /ingest/{provider}/{endpoint_token}
    verify_ref     UUID REFERENCES credentials(id),  -- signing secret / verify token
    subscriptions  JSONB NOT NULL DEFAULT '[]',
    status         TEXT NOT NULL DEFAULT 'active',
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Append-only event log; BIGSERIAL id doubles as the consumption cursor.
CREATE TABLE events (
    id                BIGSERIAL PRIMARY KEY,
    tenant_id         UUID NOT NULL,
    connection_id     UUID NOT NULL REFERENCES connections(id),
    provider_id       TEXT NOT NULL,
    event_type        TEXT NOT NULL,                 -- 'instagram.message', …
    external_event_id TEXT,                          -- dedup key
    occurred_at       TIMESTAMPTZ,
    received_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    payload           JSONB NOT NULL,                -- raw provider payload
    source            TEXT NOT NULL DEFAULT 'webhook' -- webhook | backfill
) PARTITION BY RANGE (received_at);                  -- monthly; retention = drop partition
CREATE UNIQUE INDEX uq_event_dedup ON events (connection_id, external_event_id)
    WHERE external_event_id IS NOT NULL;
CREATE INDEX idx_event_cursor ON events (tenant_id, id);

CREATE TABLE event_cursors (
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    consumer  TEXT NOT NULL,                         -- customer-named consumer group
    position  BIGINT NOT NULL DEFAULT 0,             -- last acked events.id
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, consumer)
);

CREATE TABLE operators (                             -- ops RBAC (authn is Cloudflare Access)
    email      TEXT PRIMARY KEY,                     -- matches Access JWT email claim
    role       TEXT NOT NULL,                        -- admin | operator | viewer
    status     TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

LLM plane and metering tables are in §6 and §7. Design rules:

- `tenant_id` on every high-volume row (RLS, partitioning, isolation).
- Secrets only in `credentials.payload_enc`; non-secret settings in
  `connections.config`.
- Soft-state everywhere; credentials retire, never delete.
- Action requests address a `connection_id`; when only a provider is given,
  the `is_default` connection is used.

## 4. Action Gateway (egress)

- API shape: `POST /v1/actions/{provider}/{Method}` with
  `{"connection_id": "...", "request": {…}}`; the request body maps 1:1 to
  the SDK's typed `XxxRequest`. Full fidelity, no normalization.
- Auth: `Authorization: Bearer <platform key>` → tenant + scopes.
- The gateway resolves connection → decrypts credentials → constructs (and
  caches) the SDK client → invokes. SDK options apply platform-wide
  defaults (`WithTimeout`, `WithRetry`); provider 429/5xx surface as the
  SDK's standardized `APIError` fields in the response envelope.
- Per-connection rate limiting (token bucket, in-process) so one tenant's
  burst cannot exhaust another tenant's provider quota or the pod.
- Credential refresh jobs (driven by `credentials.expires_at`) reuse the
  SDK's Authorizer implementations; failures flip the connection to
  `needs_reauth` and notify the FDE owner.

## 5. Event Source (ingress)

- Hosted endpoint per connection: `POST /ingest/{provider}/{endpoint_token}`
  (unguessable token). Handles provider verification handshakes and
  signature checks (e.g. Meta `hub.challenge` + `X-Hub-Signature-256`).
- Ingest is thin: verify → dedup → append → 200. Store failures return 5xx
  so the provider retries (providers act as a free retry queue), but
  sustained failure risks subscription disablement — the ingest path is
  the one component with a real availability requirement.
- Consumption (queue semantics, at-least-once):
  - `GET /v1/events?after=<cursor>&limit=n[&types=…]`
  - `POST /v1/events/ack {"consumer":"crm-sync","position":123456}`
  - Multiple consumer groups per tenant; rewind = replay.
- Backfill: on gaps/outages a job pulls history via egress APIs (e.g.
  conversations endpoints) into the same log with `source='backfill'`.
  Consumers see one consistent stream.
- Retention: monthly partitions dropped per policy (default 90 days).

## 6. LLM Gateway

- OpenAI-compatible surface (`/v1/chat/completions`) so customer apps and
  agents swap models with zero code changes.
- Routing is **rule-based v1**: `(tenant, task_class) → ordered target
  models` with health-check-driven failover. Hot swap = a config row
  update, no deploy.
- Buy-vs-build: Cloudflare AI Gateway covers routing/fallback/analytics
  off the shelf; a thin Go gateway (reusing the SDK Core's retry/timeout/
  error classification) keeps the stack uniform. Decision deferred to
  Phase 3; the OpenAI-compatible contract makes it swappable.

```sql
CREATE TABLE llm_models (
    id           TEXT PRIMARY KEY,       -- 'anthropic/claude-sonnet-5'
    provider     TEXT NOT NULL,
    endpoint     TEXT NOT NULL,
    secret_ref   UUID,                   -- provider API key in credentials
    in_cost_micros_per_mtok  BIGINT NOT NULL,
    out_cost_micros_per_mtok BIGINT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'active'
);

CREATE TABLE llm_routes (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id  UUID REFERENCES tenants(id),  -- NULL = global default
    task_class TEXT NOT NULL,                -- 'chat' | 'extract' | 'classify' | 'default'
    targets    JSONB NOT NULL,               -- ordered ["model-a","model-b"] (failover order)
    version    INT NOT NULL DEFAULT 1,
    status     TEXT NOT NULL DEFAULT 'active',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, task_class)
);
```

## 7. Metering and cost attribution

Two systems, deliberately separate: **metering** (billing-grade, durable)
and **ops monitoring** (Cloud Monitoring free tier; not covered here).

Layer 1 — raw facts, written by a single middleware (async, batched;
requests are never blocked on accounting):

```sql
CREATE TABLE action_logs (
    id            BIGSERIAL,
    tenant_id     UUID NOT NULL,
    connection_id UUID,
    api_key_id    UUID,
    action        TEXT NOT NULL,           -- 'googleads.MutateCampaigns'
    status_code   INT,
    error_code    TEXT,
    duration_ms   INT,
    requested_at  TIMESTAMPTZ NOT NULL DEFAULT now()
) PARTITION BY RANGE (requested_at);       -- 90-day retention

CREATE TABLE llm_usage (
    id          BIGSERIAL,
    tenant_id   UUID NOT NULL,
    api_key_id  UUID,
    model_id    TEXT NOT NULL,
    task_class  TEXT,
    tokens_in   BIGINT NOT NULL,
    tokens_out  BIGINT NOT NULL,
    cost_micros BIGINT NOT NULL,           -- priced from llm_models at write time
    latency_ms  INT,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT now()
) PARTITION BY RANGE (requested_at);

CREATE TABLE event_usage (                 -- ingested/polled counts + daily storage snapshot
    day        DATE NOT NULL,
    tenant_id  UUID NOT NULL,
    ingested   BIGINT NOT NULL DEFAULT 0,
    polls      BIGINT NOT NULL DEFAULT 0,
    storage_bytes BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (day, tenant_id)
);
```

Layer 2 — daily rollup (idempotent Cloud Scheduler job; kept forever):

```sql
CREATE TABLE usage_daily (
    day         DATE NOT NULL,
    tenant_id   UUID NOT NULL,
    meter       TEXT NOT NULL,   -- actions.calls | llm.tokens_in | llm.tokens_out
                                 -- llm.cost | events.ingested | events.polls | events.storage_bytes
    dims        JSONB NOT NULL DEFAULT '{}',   -- {provider} or {model}
    quantity    BIGINT NOT NULL,
    cost_micros BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (day, tenant_id, meter, dims)
);

CREATE TABLE tenant_budgets (
    tenant_id   UUID NOT NULL REFERENCES tenants(id),
    meter       TEXT NOT NULL,
    daily_limit BIGINT NOT NULL,             -- quantity or cost_micros by meter
    action      TEXT NOT NULL DEFAULT 'notify',  -- notify | throttle
    PRIMARY KEY (tenant_id, meter)
);
```

Layer 3 — attribution: direct costs (LLM tokens dominate) roll up per
tenant precisely; fixed infra ($50–200/month early) is allocated by simple
meter weights. A monthly reconciliation compares attributed totals against
the actual GCP + model-provider bills; the delta is unallocated platform
overhead. Output: a small per-tenant P&L for FDE pricing and renewals.

Consumption: Grafana (free) over Postgres for internal dashboards; later a
tenant-facing `GET /v1/usage`. Rate limiting/quota enforcement runs in
process (token buckets) — never on these tables. If invoicing ever gets
real, `usage_daily` feeds OpenMeter/Lago/Orb unchanged.

## 8. Ops access and security

- **Operator login**: no passwords, no WorkOS. The admin surface sits
  behind Cloudflare Access (Zero Trust free tier, ≤50 seats) with Google
  Workspace as IdP; the app verifies the Access JWT (JWKS) and maps the
  email claim to `operators.role`. Non-browser automation uses Access
  service tokens. Infra-level access is separately governed by GCP IAM.
- **Credential custody**: KMS envelope encryption; `credentials` readable
  only by the data-plane DB role; audit every decrypt. BYO-app model keeps
  us out of Tech Provider scope. Compliance posture (SOC2, deletion flows)
  is deferred but the architecture (KMS, audit logs, RLS, retire-not-
  delete) is chosen to make it reachable.
- Every admin action and every decrypt is written to an audit log with the
  operator identity.

## 9. Deployment and cost

Edge on Cloudflare, core on GCP; the core reduces to the most portable
possible shape (containers + Postgres + KMS + cron).

| Layer | Choice | Monthly (early) |
|---|---|---|
| Ingest edge + WAF | Cloudflare Workers (+ Queues) | ~$5 |
| LLM gateway (option) | Cloudflare AI Gateway | ~$0 (tokens pass through) |
| Services (Go monolith) | Cloud Run, scale-to-zero | ~$0–15 |
| Database | Cloud SQL Postgres, smallest tier, no HA | ~$30–40 |
| Secrets/KMS/Scheduler/registry/logs | GCP | ~$5 |
| **Total** | | **~$50–70** |

Cost traps deliberately avoided: no Global LB (Cloudflare fronts Cloud Run
directly), no VPC connector/NAT (Cloud SQL connector w/ IAM auth), no
Redis/PubSub early (the event table is the queue; Postgres carries all
state). First scale step: Cloud SQL 2vCPU/8GB + HA (~$200–250) — costs
grow linearly with usage, no cliffs.

Portability disciplines (hard rules):

1. No cloud-proprietary SDK calls in business code — everything behind
   interfaces (`Encryptor`, `Store`, cron = plain HTTP).
2. Plain SQL + RLS only; no Firestore/Spanner/BigQuery in the core.
3. Services are stock OCI containers.

Migration to another cloud = move containers + `pg_dump` + swap the KMS
adapter (~a week, not a rewrite).

## 10. Data governance and tenant offboarding

### Roles and processing boundaries

Data on the platform falls into three classes with different obligations:

| Class | Examples | Our role | Processing |
|---|---|---|---|
| Tenant operational data | config, usage, billing, audit logs | Controller | Service operation, billing, improvement |
| Tenant content | event payloads (**DMs are end-user personal data**), action requests, LLM prompts | Processor | Only for purposes named in the DPA |
| Aggregated, de-identified | anonymized usage stats, error rates | — | Retained if the DPA says so |

Boundaries we commit to up front:

- Processing tenant content beyond service delivery requires explicit DPA
  terms; product-improvement analytics use aggregated/de-identified forms.
- **Tenant content is never used for model training** without explicit
  opt-in. LLM providers must be under zero-data-retention terms, or the
  deletion promise cannot be kept downstream.
- Upstream platform terms flow through us (e.g. Meta Platform Terms:
  purpose limits and end-user deletion obligations on IG/FB data). The
  platform honors provider deletion callbacks per connection.
- DPA language itself requires counsel review; this section fixes the
  architecture those terms will rely on.

### Wipeout architecture (60–90 day contractual deletion)

The tenancy model was built for this: every high-volume row carries
`tenant_id`, events are time-partitioned, `action_logs` already expire at
90 days. Four additions complete the guarantee:

1. **Per-tenant crypto-shredding.** Each tenant gets a DEK (wrapped by the
   KMS key). Content-class data — `events.payload`, LLM request/response
   logs, `credentials.payload_enc` — is encrypted with the tenant DEK at
   write time. Wipeout destroys the DEK: primary, replicas, and every
   backup become unreadable at once. This is the only practical answer for
   copies inside backups/PITR. **DEK infrastructure ships in Phase 1** —
   it is part of the write path and cannot be retrofitted without a full
   re-encryption.
2. **Backup window ≤ 30 days**, so purge + natural backup expiry closes
   inside the 90-day promise even without relying on shredding alone.
   Logging discipline: payload content never enters application logs
   (metadata only); log sinks get explicit retention.
3. **Deletion state machine** — auditable process, not a one-off script:

```sql
CREATE TABLE deletion_requests (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID NOT NULL REFERENCES tenants(id),
    requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    due_at       TIMESTAMPTZ NOT NULL,          -- contractual 60/90d deadline
    status       TEXT NOT NULL DEFAULT 'grace', -- grace | exporting | purging | verified
    evidence     JSONB NOT NULL DEFAULT '{}',   -- per-step execution record
    completed_at TIMESTAMPTZ
);
```

   Flow: contract ends → tenant `offboarding` (grace window with **data
   export** — customers usually take their event log) → purge job (delete
   rows, drop tenant partitions, destroy DEK, unsubscribe provider
   webhooks, revoke provider tokens) → **deletion certificate** delivered
   to the customer, generated from `evidence`.
4. **Data inventory (data map).** Every table classified: data class ×
   deletion method × retention exception. Standard carve-outs stay
   explicit: billing records (`usage_daily`, invoices) retained under
   legal/tax obligations; aggregated de-identified stats retained. A
   wipeout claim without this inventory does not survive a customer
   security review.

## 11. Build phases

Each phase ships something FDE can use in production.

| Phase | Deliverable | Acceptance |
|---|---|---|
| 1. Action Gateway | Multi-tenant service: key auth, connection CRUD, credential vault, **per-tenant DEK infrastructure**, typed action invoke, action_logs | An FDE app posts to Instagram via a hosted connection using only a platform key; audit row written; destroying a test tenant's DEK renders its stored content unreadable |
| 2. Event Source | Hosted webhook ingest, event log, poll/ack API, backfill job | Customer app consumes IG DMs by polling; a forced outage window is invisible after backfill |
| 3. LLM Gateway | OpenAI-compatible endpoint, route config, failover; buy-vs-build decision executed | A route flip moves traffic between models with zero client changes; per-tenant token costs land in `llm_usage` |
| 4. Metering & ops | Daily rollups, budgets/alerts, Grafana dashboards, monthly reconciliation | Per-tenant P&L for a real month reconciles against actual bills |

## 12. Open questions

1. Platform repo: new `pax-beehive/platform` (recommended) vs monorepo?
2. OAuth consent flows for BYO apps: which providers first, and how much
   UI does Phase 1 need (vs FDE pasting tokens)?
3. LLM gateway buy (Cloudflare AI Gateway) vs thin Go build — decide at
   Phase 3 entry with a 1-day spike each.
4. Data governance parameters to fix with counsel: DPA processing-purpose
   language, default event retention (proposed 90 days), and the
   contractual wipeout deadline (60 vs 90 days) — architecture in §10
   supports either.
5. When a second consumer of the webhook component appears, do we extract
   it into this SDK repo as a library (`webhook` package) for self-hosted
   customers?
