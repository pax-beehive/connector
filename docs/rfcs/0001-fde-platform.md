# RFC 0001: FDE App Platform (Ingress / Egress / LLM)

- Status: Accepted for implementation
- Date: 2026-08-14
- Owner: todd.zheng
- Reviewers: todd.zheng
- Implementation plan: [`docs/plans/0001-fde-platform-todos.md`](../plans/0001-fde-platform-todos.md)

## 1. Summary

Turn the connector SDK (this repo) into the kernel of a multi-tenant
platform that FDE teams use as the foundation for customer-specific apps.
The platform has three planes behind one customer-facing credential surface:

1. **Action Gateway (egress)** — customers connect their downstream
   credentials once; the platform hosts the connections and exposes typed
   actions through the connector SDK.
2. **Event Source (ingress)** — the platform hosts webhook endpoints,
   verifies and deduplicates provider events into an append-only log, and
   customers consume by cursor polling (append-only log semantics).
3. **LLM Gateway** — an OpenAI-compatible endpoint with rule-based routing
   of task classes to models, hot-swappable via configuration.

The three planes close the canonical FDE loop:
`poll events → LLM decides → invoke action`.

### Goals

- One platform credential surface per customer; each tenant may issue multiple
  independently revocable platform keys for environments and workloads.
- Consumers never need public endpoints, signature code, or provider quirks.
- Per-tenant metering and cost attribution from day one.
- Starts with a small, measured cloud footprint; portability is preserved at
  the KMS, provider, and model seams rather than promised as zero lock-in.

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

- The SDK stays a dependency-light Go library; the platform lives in a new
  service repo and imports it. The generator pipeline produces a typed
  connector candidate (methods, tests, AGENTS.md, freshness watch). A
  connector is not production-ready until an authorized provider smoke test
  verifies authentication, one representative read and write, pagination,
  error mapping, and any webhook behavior it claims.
- Terminology: **connector** = code (a provider package in this repo);
  **connection** = one tenant's credentialed instance of a provider
  (0..n per tenant per provider).

### Module seams

The platform is initially one Go deployable with a small number of deep
modules. Their interfaces are the caller and test surfaces:

- **Action Gateway** — `Invoke` validates tenant ownership and scope, resolves
  a connection, enforces idempotency, invokes a generated connector action,
  and returns a sanitized outcome.
- **Credential Vault** — `Seal`, `Open`, `Rotate`, and `DestroyTenantKey` hide
  envelope encryption and key lifecycle. GCP KMS and an in-memory test
  adapter sit at this seam.
- **Event Source** — `Ingest`, `Poll`, `Ack`, and `Rewind` hide verification,
  deduplication, encrypted storage, retention, and consumer checkpoints.
- **LLM Router** — `Complete` and `Stream` hide route selection, upstream
  model adapters, failover, and token accounting.

Postgres is tested as Postgres in integration tests; the platform does not
create a repository interface for every table. Provider HTTP, KMS, and model
upstreams are true external dependencies and receive production and test
adapters. Internal interfaces are not exported merely to make tests easier.

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
    status      TEXT NOT NULL DEFAULT 'active',
                -- active | suspended | offboarding | deleted
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
CREATE INDEX ON api_keys (key_prefix) WHERE status = 'active';
ALTER TABLE api_keys ADD UNIQUE (id, tenant_id);

CREATE TABLE providers (                             -- connector code registry
    id            TEXT PRIMARY KEY,                  -- 'instagram', 'googleads', …
    display_name  TEXT NOT NULL,
    auth_type     TEXT NOT NULL,                     -- api_key | bearer | oauth2_refresh | custom
    capabilities  JSONB NOT NULL DEFAULT '{}',       -- generated action/event manifest
    manifest_sha  TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'active'
);

-- A tenant DEK is wrapped by a tenant-specific KMS key version. Destroying
-- that external KMS version must make restored database backups undecryptable.
CREATE TABLE tenant_keys (
    tenant_id        UUID NOT NULL REFERENCES tenants(id),
    version          INT NOT NULL,
    wrapped_dek      BYTEA NOT NULL,
    kms_key_resource TEXT NOT NULL,
    kms_key_version  TEXT NOT NULL,
    status           TEXT NOT NULL DEFAULT 'current',
                     -- current | retired | destroy_pending | destroyed
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    destroyed_at     TIMESTAMPTZ,
    PRIMARY KEY (tenant_id, version)
);
CREATE UNIQUE INDEX uq_tenant_key_current ON tenant_keys (tenant_id)
    WHERE status = 'current';

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
ALTER TABLE connections ADD UNIQUE (id, tenant_id);
ALTER TABLE connections ADD UNIQUE (id, tenant_id, provider_id);
CREATE UNIQUE INDEX uq_conn_external ON connections (tenant_id, provider_id, external_account_id)
    WHERE external_account_id IS NOT NULL;
CREATE UNIQUE INDEX uq_conn_default  ON connections (tenant_id, provider_id) WHERE is_default;
CREATE INDEX ON connections (tenant_id, provider_id);

-- Secrets are isolated from business data and stored as versioned AEAD
-- envelopes. Rotation retires old versions; offboarding purges them.
CREATE TABLE credentials (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID NOT NULL REFERENCES tenants(id),
    connection_id UUID NOT NULL,
    version       INT  NOT NULL,
    payload_enc   BYTEA NOT NULL,
    tenant_key_version INT NOT NULL,
    status        TEXT  NOT NULL DEFAULT 'current',  -- current | retired
    expires_at    TIMESTAMPTZ,                       -- drives refresh jobs
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    retired_at    TIMESTAMPTZ,
    UNIQUE (id, tenant_id),
    FOREIGN KEY (connection_id, tenant_id)
        REFERENCES connections(id, tenant_id),
    FOREIGN KEY (tenant_id, tenant_key_version)
        REFERENCES tenant_keys(tenant_id, version),
    UNIQUE (connection_id, version)
);
CREATE UNIQUE INDEX uq_cred_current ON credentials (connection_id) WHERE status = 'current';

CREATE TABLE webhook_endpoints (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      UUID NOT NULL REFERENCES tenants(id),
    connection_id  UUID NOT NULL,
    endpoint_prefix TEXT NOT NULL,                    -- safe display/lookup prefix
    endpoint_token_hash BYTEA NOT NULL UNIQUE,        -- raw token shown only once
    verify_ref     UUID,                              -- signing secret / verify token
    subscriptions  JSONB NOT NULL DEFAULT '[]',
    status         TEXT NOT NULL DEFAULT 'active',
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (connection_id, tenant_id)
        REFERENCES connections(id, tenant_id),
    FOREIGN KEY (verify_ref, tenant_id)
        REFERENCES credentials(id, tenant_id)
);

-- A global sequence is the stable logical cursor. Gaps are valid.
CREATE SEQUENCE event_cursor_seq;
CREATE TABLE events (
    id                BIGINT NOT NULL DEFAULT nextval('event_cursor_seq'),
    tenant_id         UUID NOT NULL,
    connection_id     UUID NOT NULL,
    provider_id       TEXT NOT NULL REFERENCES providers(id),
    event_type        TEXT NOT NULL,                 -- 'instagram.message', …
    dedup_key         TEXT NOT NULL,                 -- provider id or canonical delivery hash
    occurred_at       TIMESTAMPTZ,
    received_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    payload_enc       BYTEA NOT NULL,                -- encrypted raw provider payload
    payload_key_version INT NOT NULL,
    source            TEXT NOT NULL DEFAULT 'webhook', -- webhook | backfill
    PRIMARY KEY (received_at, id),
    FOREIGN KEY (connection_id, tenant_id, provider_id)
        REFERENCES connections(id, tenant_id, provider_id),
    FOREIGN KEY (tenant_id, payload_key_version)
        REFERENCES tenant_keys(tenant_id, version)
) PARTITION BY RANGE (received_at);                  -- monthly; retention = drop partition
CREATE INDEX idx_event_cursor ON events (tenant_id, id);

-- Cross-partition dedup is enforced outside the partitioned event table.
-- The receipt and event are inserted in one transaction after allocating id.
CREATE TABLE event_receipts (
    tenant_id         UUID NOT NULL REFERENCES tenants(id),
    connection_id     UUID NOT NULL,
    dedup_key         TEXT NOT NULL,
    event_id          BIGINT NOT NULL,
    event_received_at TIMESTAMPTZ NOT NULL,
    first_seen_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (connection_id, dedup_key),
    FOREIGN KEY (connection_id, tenant_id)
        REFERENCES connections(id, tenant_id)
);
CREATE INDEX idx_event_receipts_tenant ON event_receipts (tenant_id, first_seen_at);

CREATE TABLE event_cursors (
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    consumer  TEXT NOT NULL,                         -- customer-named consumer group
    position  BIGINT NOT NULL DEFAULT 0,             -- last acked events.id
    version   BIGINT NOT NULL DEFAULT 0,             -- compare-and-swap guard
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, consumer)
);

CREATE TABLE operators (                             -- ops RBAC (authn is Cloudflare Access)
    email      TEXT PRIMARY KEY,                     -- matches Access JWT email claim
    role       TEXT NOT NULL,                        -- admin | operator | viewer
    status     TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE audit_log (
    id          BIGSERIAL PRIMARY KEY,
    tenant_id   UUID,
    actor_type  TEXT NOT NULL,                       -- api_key | operator | system
    actor_id    TEXT NOT NULL,
    request_id  UUID,
    action      TEXT NOT NULL,
    resource    TEXT,
    outcome     TEXT NOT NULL,
    metadata    JSONB NOT NULL DEFAULT '{}',          -- never payloads or secrets
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

LLM plane and metering tables are in §6 and §7. Design rules:

- `tenant_id` on every high-volume row; composite foreign keys prevent a row
  from naming a connection owned by another tenant.
- Secrets only in `credentials.payload_enc`; non-secret settings in
  `connections.config`.
- Credentials retire during rotation and are physically purged during tenant
  deletion after their wrapping key is destroyed.
- Action requests address a `connection_id`; when only a provider is given,
  the `is_default` connection is used.
- Tenant-scoped transactions execute `SET LOCAL app.tenant_id = ...`; every
  tenant table enables and forces RLS. The application role does not own the
  tables and cannot bypass RLS. Migration and break-glass roles are separate
  and audited.
- API keys contain at least 256 bits of randomness. Lookup uses a non-secret
  prefix; verification compares the stored hash in constant time. Plaintext
  keys and endpoint tokens are returned once and never stored.
- AEAD associated data includes tenant id, record kind, record id, and key
  version so ciphertext cannot be moved between tenants or tables.

## 4. Action Gateway (egress)

- API shape: `POST /v1/actions/{provider}/{Method}` with
  `{"connection_id": "...", "request": {…}}`; the request body maps 1:1 to
  the SDK's typed `XxxRequest`. Full fidelity, no normalization.
- Auth: `Authorization: Bearer <platform key>` → tenant + scopes.
- Every mutating call requires `Idempotency-Key`. Reusing a key with a
  different canonical request hash returns `409`; reusing it with the same
  request returns the stored terminal outcome. An ambiguous upstream timeout
  becomes `unknown`, not an automatic replay. The hash covers tenant,
  connection, provider, action, and canonical JSON request. Reads may opt into
  idempotency.
- The connector generator emits an action manifest and JSON dispatcher for
  every operation. The manifest contains provider, method, HTTP verb,
  request/response types, required scope, and provider idempotency support.
  The platform never uses reflection over arbitrary exported methods.
- The gateway resolves tenant-owned connection → decrypts credentials →
  validates the provider credential schema → constructs a client → invokes.
  Client cache keys include connection id and credential version, have a
  bounded TTL, and are invalidated on rotation or suspension.
- SDK options apply platform-wide defaults (`WithTimeout`, `WithRetry`), but
  non-idempotent retries remain disabled unless the provider accepts an
  idempotency key for that operation.
- Responses contain `request_id` plus either `result` or a sanitized error
  (`kind`, provider code, safe message, retryable). The SDK's raw `APIError`
  body is never returned or logged.
- In-process token buckets protect one instance. They are not a distributed
  tenant quota; a shared limiter is introduced only when the service scales
  beyond the explicitly configured single-instance v1 deployment.

The action ledger is part of correctness, not just observability:

```sql
CREATE TABLE action_requests (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID NOT NULL REFERENCES tenants(id),
    api_key_id       UUID NOT NULL,
    connection_id    UUID NOT NULL,
    provider_id      TEXT NOT NULL REFERENCES providers(id),
    action           TEXT NOT NULL,
    idempotency_key  TEXT NOT NULL,
    request_hash     BYTEA NOT NULL,
    status           TEXT NOT NULL, -- running | succeeded | failed | unknown
    result_enc       BYTEA,         -- encrypted response for safe replay
    result_key_version INT,
    error_kind       TEXT,
    provider_code    TEXT,
    started_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at     TIMESTAMPTZ,
    UNIQUE (tenant_id, idempotency_key),
    FOREIGN KEY (api_key_id, tenant_id)
        REFERENCES api_keys(id, tenant_id),
    FOREIGN KEY (connection_id, tenant_id, provider_id)
        REFERENCES connections(id, tenant_id, provider_id),
    FOREIGN KEY (tenant_id, result_key_version)
        REFERENCES tenant_keys(tenant_id, version)
);
```

Credential refresh is a provider lifecycle concern, not a reuse of private
SDK authorizer implementations. A provider adapter validates stored secret
JSON, builds the SDK `Config`, refreshes renewable credentials when required,
and persists a new credential version atomically. In-client access-token
caches remain ephemeral. A terminal refresh failure changes the connection
to `needs_reauth` and emits an auditable notification event.

## 5. Event Source (ingress)

- Hosted endpoint per connection: `POST /ingest/{provider}/{endpoint_token}`
  (at least 256 random bits; only its hash is stored). Provider adapters
  handle verification handshakes and signature checks over the unmodified raw
  request body before JSON parsing.
- Ingest is thin: resolve endpoint → verify → normalize metadata/dedup key →
  allocate cursor → encrypt payload → insert receipt and event in one
  transaction → 2xx. A duplicate receipt returns 2xx without another event.
  Store failures return 5xx so the provider retries. The initial deployment
  does not acknowledge before durable Postgres commit.
- This is an append-only log with consumer checkpoints, not an exclusive-job
  queue. Delivery is at least once and concurrent workers in one consumer may
  receive duplicates.
- Consumption:
  - `GET /v1/events?consumer=crm-sync&limit=n[&types=…]` reads after that
    consumer's last acknowledged position.
  - `GET /v1/events?after=<cursor>&limit=n[&types=…]` performs stateless replay
    and does not move a consumer checkpoint.
  - `POST /v1/events/ack` includes `consumer`, `previous_position`,
    `position`, and checkpoint `version`; ack is monotonic compare-and-swap.
  - `POST /v1/events/rewind` is an explicit scoped operation with the same
    compare-and-swap guard and an audit row.
- If a requested cursor predates retained data, the API returns
  `410 cursor_expired` plus the earliest available cursor. Retention cleanup
  removes matching `event_receipts` after the replay window.
- Backfill: on gaps/outages a job pulls history via egress APIs (e.g.
  conversations endpoints) through a provider adapter and inserts through
  the same dedup/encryption path with `source='backfill'`. Consumers see one
  consistent stream.
- Retention: monthly partitions dropped per policy (default 90 days).
  Time partitions are shared by tenants; tenant offboarding uses key
  destruction plus batched tenant-row deletion, never a tenant partition
  drop.

## 6. LLM Gateway

- V1 compatibility is explicitly limited to `/v1/chat/completions`, including
  non-streaming, SSE streaming, tool calls, usage fields, and the documented
  error envelope. Compatibility does not imply every OpenAI endpoint.
- Routing is **rule-based v1**: `(tenant, task_class) → ordered target
  models` with health-check-driven failover. Hot swap = a config row
  update, no deploy.
- Failover is allowed only before response headers or the first streamed
  token. Mid-stream failure is reported to the caller and accounted as a
  failed attempt; it is never silently replayed to another model.
- Buy-vs-build: Cloudflare AI Gateway covers routing/fallback/analytics
  off the shelf; a thin Go gateway (reusing the SDK Core's retry/timeout/
  error classification) keeps the stack uniform. Decision deferred to
  Phase 3 after two one-day contract spikes. The winning implementation must
  satisfy the same black-box compatibility suite.

```sql
CREATE TABLE llm_models (
    id           TEXT PRIMARY KEY,       -- 'anthropic/claude-sonnet-5'
    provider     TEXT NOT NULL,
    endpoint     TEXT NOT NULL,
    secret_ref   TEXT NOT NULL,          -- opaque model-credential-vault reference
    status       TEXT NOT NULL DEFAULT 'active'
);

CREATE TABLE llm_model_prices (
    model_id     TEXT NOT NULL REFERENCES llm_models(id),
    version      INT NOT NULL,
    in_cost_micros_per_mtok  BIGINT NOT NULL,
    out_cost_micros_per_mtok BIGINT NOT NULL,
    effective_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (model_id, version)
);

CREATE TABLE llm_routes (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id  UUID REFERENCES tenants(id),  -- NULL = global default
    task_class TEXT NOT NULL,                -- 'chat' | 'extract' | 'classify' | 'default'
    targets    JSONB NOT NULL,               -- ordered ["model-a","model-b"] (failover order)
    version    INT NOT NULL DEFAULT 1,
    status     TEXT NOT NULL DEFAULT 'active',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_llm_route_tenant
    ON llm_routes (tenant_id, task_class) WHERE tenant_id IS NOT NULL;
CREATE UNIQUE INDEX uq_llm_route_global
    ON llm_routes (task_class) WHERE tenant_id IS NULL;
```

Model credentials have their own ownership and rotation records; they do not
pretend to be downstream tenant connections. Each usage fact snapshots model
id, route version, price version, upstream request id, token counts, and cost
so later price changes do not rewrite historical accounting. Prompt and
response content is not stored in `llm_usage`.

## 7. Metering and cost attribution

Two systems, deliberately separate: **metering** (billing-grade, durable)
and **ops monitoring** (Cloud Monitoring free tier; not covered here).

Layer 1 — durable request ledgers and raw facts. A successful action or LLM
request is not terminal until its request ledger can be reconciled into a
usage fact. Rollups and exports are asynchronous; durability is not. A worker
can regenerate a missing fact from `action_requests`, events, or the LLM
request ledger after a crash.

```sql
CREATE TABLE action_logs (
    id            BIGSERIAL,
    request_id    UUID NOT NULL REFERENCES action_requests(id),
    attempt       INT NOT NULL,
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
    id          UUID PRIMARY KEY,
    tenant_id   UUID NOT NULL REFERENCES tenants(id),
    api_key_id  UUID,
    model_id    TEXT NOT NULL,
    route_version INT NOT NULL,
    price_version INT NOT NULL,
    upstream_request_id TEXT,
    task_class  TEXT,
    tokens_in   BIGINT NOT NULL,
    tokens_out  BIGINT NOT NULL,
    cost_micros BIGINT NOT NULL,           -- priced from llm_models at write time
    latency_ms  INT,
    status       TEXT NOT NULL,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ,
    FOREIGN KEY (api_key_id, tenant_id)
        REFERENCES api_keys(id, tenant_id),
    FOREIGN KEY (model_id, price_version)
        REFERENCES llm_model_prices(model_id, version)
);

CREATE TABLE usage_facts (
    id          UUID PRIMARY KEY,
    tenant_id   UUID NOT NULL REFERENCES tenants(id),
    source_type TEXT NOT NULL,          -- action | event_ingest | event_poll | llm
    source_id   TEXT NOT NULL,
    meter       TEXT NOT NULL,
    dims        JSONB NOT NULL DEFAULT '{}',
    quantity    BIGINT NOT NULL,
    cost_micros BIGINT NOT NULL DEFAULT 0,
    occurred_at TIMESTAMPTZ NOT NULL,
    UNIQUE (source_type, source_id, meter, dims)
);
```

Layer 2 — daily rollup from `usage_facts` (idempotent scheduled job with a
watermark; kept for the contractual accounting period):

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

Layer 3 — attribution: direct costs roll up per tenant precisely; observed
fixed infrastructure cost is allocated by documented meter weights. A
monthly reconciliation compares attributed totals against
the actual GCP + model-provider bills; the delta is unallocated platform
overhead. Output: a small per-tenant P&L for FDE pricing and renewals.

Consumption: Grafana (free) over Postgres for internal dashboards; later a
tenant-facing `GET /v1/usage`. Rate limiting/quota enforcement runs in
the request path — never from eventually consistent daily rollups. If
invoicing becomes a product requirement, `usage_daily` can feed an external
metering system without changing the request ledgers.

## 8. Ops access and security

- **Operator login**: no application passwords in v1. The admin surface sits
  behind Cloudflare Access with Google
  Workspace as IdP; the app verifies the Access JWT (JWKS) and maps the
  email claim to `operators.role`. Non-browser automation uses Access
  service tokens. Infra-level access is separately governed by GCP IAM.
- **Credential custody**: KMS envelope encryption; `credentials` readable
  only by the data-plane DB role; audit every decrypt. BYO-app model keeps
  provider application ownership explicit, but legal classification and
  provider-program obligations still require review. Compliance posture is
  deferred; KMS, audit logs, RLS, and deletion evidence make it reachable.
- Every admin action and decrypt writes metadata-only audit data. The actor
  may be an operator, platform key, or system job; customer data-plane
  decrypts do not falsely claim an operator identity.
- Logs, traces, panic recovery, error envelopes, and analytics must pass a
  secret/payload redaction test. Raw provider error bodies remain in memory
  only for classification unless an explicitly encrypted diagnostic record
  is enabled for a bounded incident window.

## 9. Deployment and cost

Edge on Cloudflare, core on GCP; the core reduces to containers + Postgres +
KMS + scheduled HTTP jobs. Phase 1 runs one application instance so local
client caches and protective rate limits have explicit semantics. Scaling to
multiple instances requires a distributed quota decision first.

| Layer | Choice | Monthly (early) |
|---|---|---|
| Ingest edge + WAF | Cloudflare proxy/Worker; no pre-commit queue in v1 | measure |
| LLM gateway (option) | Cloudflare AI Gateway | measure during Phase 3 spike |
| Services (Go monolith) | Cloud Run; one configured instance for event production | measure |
| Database | Cloud SQL Postgres, smallest tested tier, no HA initially | measure |
| Secrets/KMS/Scheduler/registry/logs | GCP | measure |
| **Target** | | **verify against an observed monthly bill before commitment** |

Cost traps deliberately avoided initially: no Redis/PubSub, no separate
microservices, and no queue that acknowledges a webhook before the event is
durable in Postgres. Network topology, Cloud SQL connectivity, minimum
instances, backup/PITR, log retention, and egress are priced with the actual
deployment configuration rather than estimates in this RFC.

Portability disciplines (hard rules):

1. Cloud-proprietary SDK calls are confined to adapters at real seams, such
   as KMS. Postgres remains a concrete implementation, not a generic `Store`
   interface. Scheduled jobs are ordinary authenticated HTTP commands.
2. Plain SQL + RLS only; no Firestore/Spanner/BigQuery in the core.
3. Services are stock OCI containers.

Cloud migration means moving containers and Postgres plus rewrapping active
tenant keys through a tested KMS migration procedure. It is not assigned a
calendar estimate until that procedure has been exercised.

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

1. **Per-tenant crypto-shredding.** Each tenant gets a random DEK wrapped by
   a tenant-specific KMS key version. Content-class data —
   `events.payload_enc`, replayable action results, optional encrypted LLM
   diagnostics, and `credentials.payload_enc` — is encrypted with that DEK.
   Wipeout requests destruction of the external KMS key version and records
   provider confirmation. Deleting only the wrapped-DEK database row is not
   sufficient because an old backup contains that row. The required test is:
   restore a pre-deletion database backup and prove the destroyed tenant's
   ciphertext still cannot be opened. **DEK infrastructure ships in Phase
   1** because retrofitting it requires re-encryption.
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

   Flow: contract ends → tenant `offboarding` (all platform keys revoked;
   grace window with controlled **data
   export** — customers usually take their event log) → purge job (delete
   tenant rows in bounded batches, destroy the tenant KMS key version,
   unsubscribe provider
   webhooks, revoke provider tokens) → **deletion certificate** delivered
   to the customer, generated from `evidence`.
4. **Data inventory (data map).** Every table classified: data class ×
   deletion method × retention exception. Standard carve-outs stay
   explicit: billing records (`usage_daily`, invoices) retained under
   legal/tax obligations; aggregated de-identified stats retained. A
   wipeout claim without this inventory does not survive a customer
   security review.

The state machine is idempotent and resumes after partial failure. `verified`
requires evidence for access revocation, exports, webhook unsubscription,
provider-token revocation, KMS destruction, primary-row purge, backup expiry
policy, and retained-data carve-outs. A restored backup must consult an
external destruction/tombstone source before serving traffic.

## 11. Build phases

Each phase ships something FDE can use in production.

| Phase | Deliverable | Acceptance |
|---|---|---|
| 0. Connector bridge | Generated action manifest/dispatcher and provider credential lifecycle adapters | Every generated action is dispatchable through JSON without reflection; manifest drift fails CI |
| 1. Action Gateway | Multi-tenant auth, manual connection CRUD, restore-safe tenant keys, idempotent typed invoke, durable action ledger and audit | An FDE app posts to Instagram using only a platform key; duplicate requests do not duplicate the post; a restored backup cannot decrypt a destroyed test tenant |
| 2. Event Source | Provider webhook adapter, encrypted event log, receipt dedup, poll/ack/rewind, retention, and backfill | With an authorized Meta test account, a customer consumes IG DMs by polling; duplicate delivery creates one event; a forced outage is repaired by backfill |
| 3. LLM Gateway | Contract spike, selected OpenAI-compatible implementation, route config, streaming/failover, durable usage | A route flip moves new requests between models without client changes; streaming semantics pass the contract suite; per-tenant cost lands in `llm_usage` |
| 4. Metering & ops | Idempotent daily rollups, budgets/alerts, audit views, Grafana dashboards, monthly reconciliation | Re-running a rollup changes no totals; a real month reconciles to provider/cloud bills with an explicit unallocated delta |
| 5. Offboarding | Export, revocation, provider cleanup, row purge, KMS destruction, deletion certificate | The state machine survives injected failures and a restored backup cannot serve destroyed tenant content |

The dependency-ordered tracer-bullet breakdown is maintained in
[`docs/plans/0001-fde-platform-todos.md`](../plans/0001-fde-platform-todos.md).

## 12. Decisions and remaining questions

Decisions fixed by this revision:

1. The hosted platform is a new repository; this repository remains the Go
   connector SDK and generator.
2. Phase 1 uses FDE-operated manual credential onboarding. Self-serve OAuth UI
   is deferred, but credential schemas and rotation are provider-specific.
3. Postgres is a concrete dependency tested in integration; KMS, provider
   HTTP, and model upstreams are adapter seams.
4. Event delivery is an append-only log with at-least-once consumer
   checkpoints, not an exclusive queue.
5. Billing facts are durable/reconcilable on the request path; only rollups
   and exports are asynchronous.
6. In-process rate limits are instance protection, not distributed quota.

Remaining HITL decisions:

1. LLM gateway buy (Cloudflare AI Gateway) vs thin Go build — owner:
   platform lead; deadline: Phase 3 entry, after a 1-day spike for each option.
2. Data governance parameters to fix with counsel — owner: todd.zheng with
   counsel; deadline: before the first production tenant. Parameters include
   DPA processing-purpose
   language, default event retention (proposed 90 days), and the
   contractual wipeout deadline (60 vs 90 days) — architecture in §10
   supports either.
3. Confirm that the first production event slice may process Instagram DMs —
   owner: todd.zheng with counsel; deadline: before TODO 10 starts. Approval
   must cover the customer's Meta app permissions and provider terms.
4. When a second consumer of the webhook module appears, decide whether to extract
   it into this SDK repo as a library (`webhook` package) for self-hosted
   customers. Owner: platform lead; deadline: the second-consumer design review.
