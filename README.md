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

## Instagram (business accounts)

Connector for operating an Instagram professional account via the Meta Graph
API: publish posts/reels/stories/carousels, read media, manage comments,
fetch insights. Generated from a curated spec (Meta publishes no OpenAPI
spec); see [`instagram/AGENTS.md`](instagram/AGENTS.md) for the full
catalog and the three-step publishing flow.

```go
import "github.com/pax-beehive/connector/instagram"

c, err := instagram.NewClient(&instagram.Config{AccessToken: "EAAG..."})

cont, err := c.CreateMediaContainer(ctx, &instagram.CreateMediaContainerRequest{
	IgUserId: igUserID,
	ImageUrl: connector.Ptr("https://example.com/photo.jpg"),
	Caption:  connector.Ptr("Hello #world"),
})
pub, err := c.PublishMedia(ctx, &instagram.PublishMediaRequest{
	IgUserId: igUserID, CreationId: cont.Id,
})
```

## Facebook (Pages)

Publish and manage content on a Facebook Page: feed posts, photos, videos,
scheduling, comments, insights. See [`facebook/AGENTS.md`](facebook/AGENTS.md).

```go
import "github.com/pax-beehive/connector/facebook"

c, err := facebook.NewClient(&facebook.Config{AccessToken: pageToken})
post, err := c.CreatePagePost(ctx, &facebook.CreatePagePostRequest{
	PageId: pageID, Message: connector.Ptr("Hello from the API"),
})
```

## X (Twitter)

Post and manage tweets: create/delete, timelines, mentions, recent search,
likes, reposts. See [`x/AGENTS.md`](x/AGENTS.md).

```go
import "github.com/pax-beehive/connector/x"

c, err := x.NewClient(&x.Config{AccessToken: userContextToken})
tweet, err := c.CreateTweet(ctx, &x.CreateTweetRequest{
	Text: connector.Ptr("Hello world"),
})
```

## For AI agents

Each connector ships a generated `AGENTS.md`
([mindbody](mindbody/AGENTS.md), [instagram](instagram/AGENTS.md),
[facebook](facebook/AGENTS.md), [x](x/AGENTS.md)) describing
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
