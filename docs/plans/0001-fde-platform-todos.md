# FDE Platform Implementation TODOs

Source: [RFC 0001: FDE App Platform](../rfcs/0001-fde-platform.md)

These TODOs are ordered tracer bullets. Each item must produce an observable
end-to-end behavior rather than only adding one horizontal layer. `AFK` items
can be implemented and verified without a product decision; `HITL` items need
explicit human review or external authorization.

Implementation sequencing defers every sanity or authorized-provider smoke
check to TODO 16. Deferred checks remain unchecked and must pass before the
platform is production-ready, but they do not block starting the next TODO
after all non-deferred verification for the current TODO passes.

## TODO 01 — Accept the hardened platform contract

- **Type:** HITL
- **Blocked by:** None
- **Title:** Accept the hardened platform contract
- **Description:** Review RFC 0001 as the implementation contract. Confirm the
  new platform repository, manual Phase 1 onboarding, append-only event-log
  semantics, request-path durability, restore-safe tenant-key destruction,
  and the remaining counsel/Meta decisions. Record reviewers and move the RFC
  out of draft only after disagreements are resolved in the document.
- **Verification:**
  - [x] Every remaining question has an owner and decision deadline.
  - [x] Reviewers are named in the RFC and no unresolved blocking comment is
        outside the document.
  - [x] The RFC status is changed only after reviewer approval.

## TODO 02 — Dispatch every generated connector action from JSON

- **Type:** AFK
- **Blocked by:** None
- **Title:** Dispatch every generated connector action from JSON
- **Description:** Extend the connector generator to emit a deterministic
  action manifest and dispatcher. Given provider, method, typed client, and
  JSON request, it must validate the action allowlist, decode the generated
  request type, call the concrete method without reflection, and encode the
  typed response. Include HTTP verb, required scope, and provider-idempotency
  metadata in the manifest.
- **Verification:**
  - [x] Regeneration produces no uncommitted diff on a second run.
  - [x] The manifest and dispatcher contain exactly one entry for every
        generated operation, with no duplicates.
  - [x] Generated tests invoke every entry through JSON and cover malformed
        JSON, unknown provider, unknown method, and typed provider errors.
  - [x] Existing connector tests, lint, generation, and coverage gates pass.

## TODO 03 — Authenticate the first tenant in the platform

- **Type:** AFK
- **Blocked by:** TODO 01
- **Title:** Authenticate the first tenant in the platform
- **Description:** Create the platform repository and a deployable Go
  monolith backed by real Postgres migrations. Add tenant and platform-key
  creation through an operator command, bearer authentication, scope parsing,
  request identity, forced RLS, and a tenant-visible identity endpoint. This
  slice ends when two tenants can authenticate but cannot observe each other.
- **Verification:**
  - [x] Migrations apply from empty and roll forward in a real Postgres test.
  - [x] A generated platform key is displayed once and only its hash/prefix is
        persisted.
  - [x] Valid, revoked, expired, malformed, and wrong-scope keys have stable
        responses.
  - [x] Cross-tenant integration tests attempt direct IDs and unscoped queries
        and are rejected by forced RLS.
  - [x] Health and identity endpoints pass in the container image.

## TODO 04 — Store and rotate an encrypted Instagram connection

- **Type:** AFK
- **Blocked by:** TODO 03
- **Title:** Store and rotate an encrypted Instagram connection
- **Description:** Add FDE-operated connection creation for Instagram using a
  provider-specific credential schema. The Credential Vault must create a
  tenant DEK, wrap it through the KMS adapter, encrypt the credential envelope
  with tenant-bound AEAD data, rotate versions atomically, and invalidate any
  cached client using an older version. Implement GCP KMS and deterministic
  in-memory test adapters at the same seam.
- **Verification:**
  - [x] Database inspection finds no plaintext token or raw endpoint secret.
  - [x] Ciphertext copied to another tenant, record, or key version cannot be
        opened.
  - [x] Rotation makes the new version current, retires the old version, and
        invalidates the old cached client.
  - [x] KMS denial and partial-rotation failures leave one recoverable current
        credential and an audit record.
  - [x] A tenant cannot address or decrypt another tenant's connection.

## TODO 05 — Invoke an idempotent Instagram action with one platform key

- **Type:** AFK
- **Blocked by:** TODO 02, TODO 04
- **Title:** Invoke an idempotent Instagram action with one platform key
- **Description:** Deliver the first complete Action Gateway path: authenticate
  a tenant, authorize the generated action scope, resolve and decrypt its
  Instagram connection, dispatch a typed action, store the action ledger,
  write durable usage/audit facts, and return a sanitized result envelope.
  Mutating calls require an idempotency key and ambiguous upstream outcomes
  remain `unknown` until reconciled.
- **Verification:**
  - [x] Repeating the same idempotency key and request makes one provider call
        and replays the stored result.
  - [x] Reusing a key with a different request hash returns `409`.
  - [x] Timeout-after-send is recorded as `unknown` and is not automatically
        retried as a write.
  - [x] Raw provider bodies, tokens, and request payloads are absent from logs,
        traces, audit metadata, and public errors.
  - [ ] **Deferred to TODO 16:** A guarded smoke test posts through an
        authorized Instagram test account and records the provider
        request/outcome evidence.

## TODO 06 — Deploy and remotely verify the Action Gateway tracer bullet

- **Type:** AFK
- **Blocked by:** TODO 05
- **Title:** Deploy and remotely verify the Action Gateway tracer bullet
- **Description:** Deploy the monolith, Postgres, KMS adapter, migrations, and
  scheduled commands with the documented single-instance semantics. Configure
  origin authentication, backups/PITR, log retention, secret redaction, and a
  rollback release. Record actual resource configuration and cost rather than
  relying on the RFC's target budget.
- **Implementation status:** Platform commit
  `6ace5736e8ee14a7e23ce415b442e5530cad9d52` passes the full quality gate at
  80.1 percent coverage and deployment checks. At the operator's direction, the
  fresh staging project `pax-fde-stg-20260816` was deleted on 2026-08-16 before
  further verification. Minimal production project `pax-fde-prod` was then
  created in `us-west1` with a private versioned state bucket. It runs the same
  source at 100 percent traffic from immutable digest
  `sha256:bd23b7ac483b8ddd95f1b7effa226b2348c95d1648f99e64b270bf5ed644ff04`.
  The digest and OCI revision label match the deployed source. Terraform is
  no-drift; the zonal `db-f1-micro` Cloud SQL instance is `RUNNABLE`; migration
  and runtime-role configuration executions succeeded; and resource evidence
  `20260816T204950Z-resource-config.json` captures the one-instance application,
  scale-to-zero command service, seven retained backups and PITR days, 30-day
  log bucket, KMS boundary, and bounded build storage. Follow-up platform commit
  `b8b36f549f530b71cd5800e21c3592ce12b66f42` makes Terraform applies explicitly
  non-interactive and documents the scoped Cloud Build operator permissions.
  Both official `fde-prod` URLs return an application-external `404` with no
  request or container log even though Ready, ConfigurationsReady, and
  RoutesReady are true, ingress is `all`, and invoker IAM checks are disabled.
  Endpoint identity and direct-origin rejection therefore remain unverified.
  One explicitly authorized request with the correct origin token also returned
  `404` and produced no request or container log, ruling out application origin
  authentication as the rejection point. Domain Restricted Sharing rejects an
  `allUsers` invoker binding. Explicitly reconciling and toggling the disabled
  Invoker IAM check left the same revision at `404`. A temporary secret-free
  `fde-prod-routeprobe` created through the Cloud Run v1 API returned `200` and
  was deleted. A separately authorized `fde-prod-v1probe` used the deployed
  production image, runtime service account, Cloud SQL attachment, KMS key-ring
  setting, and Secret Manager references with zero minimum and one maximum
  instance. Its anonymous `/healthz` request returned the same Google Frontend
  `404`, so the conditional origin-token request was not sent; the probe was
  immediately deleted and deletion was verified. This rules out the v2 create
  API as the sole cause. The scheduled `fde-prod-commands` service uses the same
  image and Cloud SQL instance and continues to return `200`, which narrows the
  failure to the main API service's public invocation path or an API-specific
  configuration interaction. Cloud Run v2 reports the default URI enabled,
  ingress `all`, the Invoker IAM check disabled, 100 percent latest-revision
  traffic, and successful route conditions; no `HttpIngress` policy-denial log
  is present. A single request carrying the project owner's short-lived Google
  OIDC identity token returned the identical Google Frontend `404`, so the
  failure is not limited to anonymous invocation. KMS denial, backup/restore,
  rollback, and observed-cost evidence also remain open. Two additional
  secret-free probes used the same runtime service account with the public
  hello image. `fde-prod-saprobe` returned `200`; `fde-prod-sqlprobe` added the
  production Cloud SQL attachment and also returned `200`. Each probe used
  zero minimum and one maximum instance, received exactly one anonymous
  request, and was deleted with deletion verified. The runtime service account
  and Cloud SQL attachment are therefore ruled out, leaving the production
  image entrypoint or API-mode environment as the remaining differentiators. A
  final secret-free `fde-prod-imageprobe` used the exact production image but
  replaced its entrypoint with a locally verified BusyBox network responder.
  Its single anonymous `HEAD /platformd` request returned `200`, and the probe
  was deleted with deletion verified. An initial attempt used an unavailable
  BusyBox applet, failed before becoming routable, sent no request, and was also
  deleted. The immutable image itself is therefore ruled out; the remaining
  boundary is the `platformd` API-mode process and its environment.
- **Verification:**
  - [ ] Remote revision/image identity matches the validated source commit.
  - [ ] **Deferred to TODO 16:** A remote platform key invokes the authorized
        Instagram smoke action.
  - [ ] Direct-origin, invalid-key, wrong-tenant, and revoked-connection calls
        are rejected.
  - [ ] Backup restore, rollback, migration, and key-access failure drills have
        timestamped evidence.
  - [ ] The first observed bill or cost report is attached to the deployment
        record with unexplained items called out.

## TODO 07 — Ingest one verified Instagram message webhook durably

- **Type:** HITL
- **Blocked by:** TODO 04, TODO 06, authorized Meta app and test account
- **Title:** Ingest one verified Instagram message webhook durably
- **Description:** Add the Instagram Messaging surface and a Meta webhook
  adapter that handles challenge verification, verifies signatures against
  the unmodified raw body, derives a stable dedup key, encrypts the payload,
  and commits receipt plus event before acknowledging. Register and remove the
  subscription through the tenant connection lifecycle.
- **Verification:**
  - [ ] Official/recorded signature fixtures cover valid, invalid, truncated,
        replayed, oversized, and malformed deliveries.
  - [ ] Duplicate provider deliveries return success but create one event.
  - [ ] Database failure before commit returns 5xx and creates no receipt-only
        or event-only state.
  - [ ] Stored message payload is ciphertext and cross-tenant access fails.
  - [ ] An authorized Meta test account completes challenge, subscription,
        live delivery, and unsubscription with retained evidence.

## TODO 08 — Consume, acknowledge, and rewind a named event stream

- **Type:** AFK
- **Blocked by:** TODO 07
- **Title:** Consume, acknowledge, and rewind a named event stream
- **Description:** Expose tenant-scoped poll, ack, stateless replay, and rewind
  operations. Poll begins at a named consumer's checkpoint; ack is monotonic
  compare-and-swap; replay never mutates a checkpoint; rewind is explicit and
  audited. Document at-least-once delivery and duplicate handling.
- **Verification:**
  - [ ] Two consumer names advance independently over the same events.
  - [ ] Stale checkpoint versions, backward ack, future cursor, and another
        tenant's cursor are rejected.
  - [ ] Concurrent polls may duplicate delivery but cannot lose an event after
        acknowledged-position recovery.
  - [ ] Stateless replay leaves the stored checkpoint unchanged.
  - [ ] Rewind changes the checkpoint only through the guarded operation and
        writes an audit row.

## TODO 09 — Repair an Instagram event outage through backfill

- **Type:** HITL
- **Blocked by:** TODO 08, authorized Meta history access
- **Title:** Repair an Instagram event outage through backfill
- **Description:** Add the minimum provider history/conversation operations and
  a resumable backfill command. It must pull a bounded outage window, map each
  item to the same event type and dedup key used by webhooks, and insert through
  the same encryption/dedup path with `source=backfill`.
- **Verification:**
  - [ ] A fixture outage containing pre-existing, missing, and repeated items
        inserts only the missing logical events.
  - [ ] Killing and restarting the job resumes without duplicate events.
  - [ ] A forced live-test outage is repaired and the consumer observes one
        continuous logical stream.
  - [ ] Provider pagination, rate limiting, permission loss, and expired-token
        behavior have tests and auditable failure status.

## TODO 10 — Expire retained events without silently stranding consumers

- **Type:** AFK
- **Blocked by:** TODO 08
- **Title:** Expire retained events without silently stranding consumers
- **Description:** Automate event partition creation/removal and matching
  receipt cleanup. Before deletion, identify checkpoints behind the retention
  floor. Poll and replay must return `cursor_expired` with the earliest
  available cursor rather than silently skipping data. Provide an encrypted
  export path for an authorized tenant before offboarding or expiry.
- **Verification:**
  - [ ] Future partitions exist before writes reach them.
  - [ ] Retention removes only expired partitions and corresponding receipts.
  - [ ] A consumer behind the floor receives `410 cursor_expired` and cannot
        accidentally acknowledge past the gap.
  - [ ] Current consumers continue polling across a partition boundary.
  - [ ] Export content and access are tenant-scoped, encrypted in transit, and
        audited.

## TODO 11 — Choose the LLM gateway implementation against one contract

- **Type:** HITL
- **Blocked by:** TODO 03
- **Title:** Choose the LLM gateway implementation against one contract
- **Description:** Build two time-boxed adapters—Cloudflare AI Gateway and a
  thin Go proxy—behind the same LLM Router interface. Run one black-box suite
  for non-streaming, SSE streaming, tool calls, errors, usage, pre-stream
  failover, cancellation, and no mid-stream replay. Record cost, operational,
  retention, and credential-custody tradeoffs in an ADR, then select one.
- **Verification:**
  - [ ] Both spikes run the same versioned contract suite with pass/fail
        evidence.
  - [ ] Provider data-retention and logging configuration is documented from
        authoritative terms for the tested account.
  - [ ] The ADR names the winner, rejected option, migration seam, and any
        accepted compatibility gaps.
  - [ ] No production implementation begins before the decision is approved.

## TODO 12 — Route and meter one OpenAI-compatible chat request

- **Type:** AFK
- **Blocked by:** TODO 11
- **Title:** Route and meter one OpenAI-compatible chat request
- **Description:** Deliver the first LLM Router path using the selected
  adapter: authenticate tenant, resolve task-class route, use separately
  owned model credentials, complete or stream the request, apply only
  pre-stream failover, and store a terminal usage ledger with route and price
  versions. Do not persist prompt/response content in usage tables.
- **Verification:**
  - [ ] A route update moves the next request without a deploy or client code
        change.
  - [ ] Non-streaming, streaming, tool call, cancellation, upstream error, and
        pre-stream failover cases pass the contract suite.
  - [ ] Mid-stream failure is surfaced once and is not replayed upstream.
  - [ ] Token/cost facts snapshot model, route, price, upstream request id, and
        terminal status and can be reconciled after an injected crash.
  - [ ] Tenant A cannot select or inspect tenant B's route or usage.

## TODO 13 — Operate tenants through audited admin commands

- **Type:** AFK
- **Blocked by:** TODO 06
- **Title:** Operate tenants through audited admin commands
- **Description:** Put operator commands behind verified Cloudflare Access
  identity and role mapping. Support the minimum operational actions:
  suspend/reactivate tenant, revoke keys, disable/rotate connection, retry a
  safe job, inspect metadata-only health, and begin offboarding. Service
  automation uses a distinct service identity.
- **Verification:**
  - [ ] JWT/JWKS fixtures cover valid, expired, wrong-audience, unknown-user,
        viewer, operator, admin, and service identities.
  - [ ] Each command enforces role and writes actor type/id, request id,
        resource, outcome, and safe metadata.
  - [ ] Audit/log redaction tests fail on known secret and tenant-content
        canaries.
  - [ ] Suspension immediately blocks keys, connection use, and background
        tenant jobs without deleting evidence.

## TODO 14 — Roll up durable usage and enforce one budget

- **Type:** AFK
- **Blocked by:** TODO 05, TODO 08, TODO 12
- **Title:** Roll up durable usage and enforce one budget
- **Description:** Reconcile action, event, and LLM request ledgers into
  idempotent usage facts, then roll them into daily tenant totals with a
  watermark. Add one notify budget and one request-path throttle budget,
  internal Grafana views, and a monthly attribution report that preserves an
  explicit unallocated platform delta.
- **Verification:**
  - [ ] Reconciliation recovers a deliberately omitted fact from its source
        ledger exactly once.
  - [ ] Running reconciliation and daily rollup repeatedly produces identical
        totals.
  - [ ] Late-arriving facts update the correct day without double counting.
  - [ ] Notify and throttle thresholds are enforced from current request-path
        state, not stale daily dashboards.
  - [ ] One observed month reconciles against provider/cloud bills and reports
        every unexplained delta.

## TODO 15 — Offboard one tenant and prove restored data is unreadable

- **Type:** HITL
- **Blocked by:** TODO 09, TODO 10, TODO 12, TODO 13, TODO 14, counsel
  retention decision
- **Title:** Offboard one tenant and prove restored data is unreadable
- **Description:** Implement the resumable deletion state machine from request
  through export, access revocation, webhook unsubscription, provider-token
  revocation, tenant-key destruction, bounded row purge, retained-data
  carve-outs, and deletion certificate. Every transition is idempotent and
  records evidence without storing tenant content.
- **Verification:**
  - [ ] Failure injection at every transition resumes without skipping or
        repeating an unsafe external action.
  - [ ] All tenant keys and platform keys are unusable when offboarding begins.
  - [ ] Provider subscription/token cleanup and KMS destruction have external
        confirmation evidence.
  - [ ] Restoring a backup taken before deletion still cannot decrypt or serve
        the destroyed tenant's credentials, events, action results, or optional
        LLM diagnostics.
  - [ ] The certificate lists completed steps, retained carve-outs, deadlines,
        evidence references, and verifier identity.

## TODO 16 — Pass the production-readiness gate

- **Type:** HITL
- **Blocked by:** TODO 06, TODO 09, TODO 12, TODO 14, TODO 15
- **Title:** Pass the production-readiness gate
- **Description:** Run the complete multi-tenant system through load, failure,
  provider smoke, restore, rollback, security, retention, and cost exercises.
  Define initial SLOs from measured behavior, document incident/runbook owners,
  and explicitly record any risk accepted for the first FDE customer.
- **Verification:**
  - [ ] Authorized live smoke evidence covers every capability advertised as
        production-ready, including the deferred TODO 05 guarded action and
        TODO 06 remote action; generated/stub tests alone do not qualify.
  - [ ] Cross-tenant, secret-redaction, idempotency, webhook retry, cursor,
        streaming, key-destruction, restore, and rollback suites pass against
        the release candidate.
  - [ ] Load and failure results support the chosen instance/database sizing
        and initial SLOs.
  - [ ] Remote source SHA, image digest, migration version, cloud resources,
        database health, and public endpoints are verified separately.
  - [ ] A named reviewer accepts or rejects each remaining production risk.
