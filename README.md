# connector

[![CI](https://github.com/pax-beehive/connector/actions/workflows/ci.yml/badge.svg)](https://github.com/pax-beehive/connector/actions/workflows/ci.yml)

A Go connector SDK library. Each external service gets one connector package;
a connector instance is constructed with the credentials it needs. Every API
operation is one method:

```go
func (c *Client) Xxx(ctx context.Context, req *XxxRequest) (*XxxResponse, error)
```

The request struct carries every HTTP input (path params, query params,
request body). Client, request, and response are all pointers.

## Install

```sh
go get github.com/pax-beehive/connector
```

## Mindbody (Public API v6)

Full coverage of the Mindbody Public API v6 (150 operations), generated from
the official spec.

```go
import (
	"github.com/pax-beehive/connector"
	"github.com/pax-beehive/connector/mindbody"
)

c, err := mindbody.NewClient(&mindbody.Config{
	APIKey:   "your-api-key",
	SiteID:   "-99",
	Username: "staff-user", // optional: only needed for staff-token endpoints
	Password: "staff-pass",
})
if err != nil { ... }

resp, err := c.GetClasses(ctx, &mindbody.GetClassesRequest{
	Limit:       connector.Ptr(25),
	LocationIds: []int{1},
})
```

- `Api-Key`, `SiteId`, and `Version` headers are attached automatically.
- When `Username`/`Password` are set, the staff user token is issued lazily,
  cached, and re-issued automatically after a 401.
- Optional parameters are pointer fields; use `connector.Ptr(v)`.
- Non-2xx responses return a `*connector.APIError` with the Mindbody error
  code and message parsed.

## For AI agents

Each connector ships a generated [`AGENTS.md`](mindbody/AGENTS.md) describing
its capability boundary: how to construct the client, the auth model, error
and data conventions, what is out of scope, and a catalog of every operation
with its HTTP mapping. It is generated from the spec (plus handwritten notes
in `gen.yaml`), so it never drifts from the code. Point your agent at it
before using the SDK.

## Regenerating

Generated files (`*_gen.go`) and the spec snapshot (`mindbody/spec/`) are
committed. To regenerate after updating a spec or the generator:

```sh
make gen
```

## Adding a new connector

1. Create a package directory with the service's OpenAPI spec snapshot
   (Swagger 2.0 or OpenAPI 3.x both work).
2. Write a `gen.yaml` (see `mindbody/gen.yaml`) — including the
   `title`/`description`/`agent_notes` that feed the generated `AGENTS.md` —
   and a `gen.go` with the `go:generate` line.
3. Write the handwritten layer: a `Config`, a `Client` struct with a
   `core *connector.Core` field, a `NewClient` that wires base URL, static
   headers, an optional `connector.Authorizer`, and an error-body parser.
4. `make gen`.

## Development

```sh
make lint   # go vet + cyclomatic complexity gate (<20 per function)
make test   # unit tests
make cover  # coverage gate (>=80%)
```
