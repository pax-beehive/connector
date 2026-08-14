# Connector SDK + Mindbody Connector — Design

Date: 2026-08-13
Status: Approved

## Goal

A Go library (`github.com/pax-beehive/connector`) providing per-service API
connectors. One connector serves one external service; a connector instance is
constructed with the credentials it needs. First connector: Mindbody Public
API v6, full coverage (150 operations), produced by a generic OpenAPI code
generator.

## Interface conventions (fixed requirements)

- One func per API operation: `func (c *Client) Xxx(ctx context.Context, req *XxxRequest) (*XxxResponse, error)`.
- `XxxRequest` carries every HTTP input: path params, query params, request body.
- Request and response are pointers; the client receiver is a pointer.
- Optional parameters are pointer fields; `connector.Ptr[T]` helper provided.

## Repo layout

```
go.mod                      module github.com/pax-beehive/connector
connector.go / errors.go    root package `connector`: shared runtime
                            (HTTP core, APIError, auth hook, Ptr helper)
cmd/connector-gen/          generic OpenAPI generator CLI (no Mindbody logic)
internal/genlib/            generator implementation (spec load, 2.0→3.x
                            conversion, template rendering)
mindbody/
  client.go                 handwritten: Config, NewClient, token manager,
                            error-format parser
  gen.yaml                  generation config for this connector
  spec/swagger.json         committed spec snapshot (reproducible generation)
  <tag>_gen.go              generated methods, one file per spec tag (12 files)
  types_gen.go              generated model types (~396 definitions)
  *_gen_test.go             generated round-trip tests
```

A future connector = a new sibling package + its `gen.yaml` + a small
handwritten auth layer.

## Caller usage

```go
c, err := mindbody.NewClient(&mindbody.Config{
    APIKey:   "...",
    SiteID:   "-99",
    Username: "...", // optional: only for staff-token endpoints
    Password: "...",
    // HTTPClient / BaseURL optional overrides
})
resp, err := c.GetClasses(ctx, &mindbody.GetClassesRequest{
    Limit: connector.Ptr(10),
})
```

## Shared runtime (root package `connector`)

One core execution path used by every generated method:

- Build URL from base URL + path template + path params.
- Encode query params from tagged request fields (`query:"request.limit"`).
- Marshal JSON body when the operation has one.
- Apply per-connector auth via a hook interface (set headers, and optionally
  retry once after re-auth on 401).
- Decode 2xx JSON into the response pointer; decode non-2xx into `*APIError`.

`APIError` carries `StatusCode`, raw `Body`, and parsed `Code`/`Message`. The
error-body format parser is injected per connector (Mindbody:
`{"Error":{"Code","Message"}}`).

## Mindbody handwritten layer

- Every request gets `Api-Key`, `siteId`, and `version` headers; the
  `{version}` path segment is fixed to `6` by the client and never appears in
  request structs.
- Staff user token: when Username/Password are configured, lazily POST
  `/usertoken/issue` on first need, cache the token in memory (mutex-guarded).
  On a 401 response, re-issue once and retry the request; if it still fails,
  return the error. Without credentials, no `authorization` header is sent.

## Generator (generic)

- Input: any OpenAPI spec. Loaded with kin-openapi; Swagger 2.0 is converted
  to OpenAPI 3.x internally so one template set serves both.
- Per-connector `gen.yaml`: spec path, package name, header params to skip
  (auth-handled), query-name prefix stripping (`request.` → field name),
  pinned path params (`version: "6"`), operation file grouping by tag.
- Method name = operationId. Request struct fields: query params (prefix
  stripped, camel-cased, wire name kept in tag), real path params, and the
  body model embedded (Go embedding) so its fields are promoted.
- Response type = the 200-response definition.
- Generated methods are 2–3 line delegations to the shared core, so their
  cyclomatic complexity is 1.
- Also generates `*_gen_test.go`: a table-driven round trip per operation
  against an `httptest` stub asserting method, path, query, headers, body,
  and response decoding — regression coverage and coverage-gate fuel.
- Driven by `//go:generate`; generated code and spec snapshot are committed.

## Quality gates

- Cyclomatic complexity < 20 per func: golangci-lint `cyclop` with max 19.
- Unit-test coverage ≥ 80%: `make cover` runs `go test -coverprofile` and
  fails below the threshold.
- Makefile targets: `gen`, `lint`, `test`, `cover`.

## Testing strategy

- Root package core + Mindbody auth layer: httptest unit tests, including
  401-retry and concurrent token-cache behavior.
- Generator: golden-file tests over a small fixture spec.
- Generated code: covered by the generated round-trip tests.

## Out of scope (YAGNI)

- Retry/backoff policies beyond the single 401 re-auth retry.
- Rate limiting, pagination helpers, webhooks API.
- Other connectors beyond Mindbody.
