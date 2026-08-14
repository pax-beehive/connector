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

## Threads

Publish text/image/video/carousel posts, manage replies, and fetch insights
for a Threads professional account. Same two-step container flow as
Instagram. See [`threads/AGENTS.md`](threads/AGENTS.md).

```go
import "github.com/pax-beehive/connector/threads"

c, err := threads.NewClient(&threads.Config{AccessToken: token})
cont, err := c.CreateThreadsContainer(ctx, &threads.CreateThreadsContainerRequest{
	ThreadsUserId: userID,
	MediaType:     connector.Ptr("TEXT"),
	Text:          connector.Ptr("Hello Threads"),
})
pub, err := c.PublishThread(ctx, &threads.PublishThreadRequest{
	ThreadsUserId: userID, CreationId: cont.Id,
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

## Meta Marketing API (Facebook + Instagram ads)

Manage ads across Facebook and Instagram with one surface: ad accounts,
campaigns, ad sets, ads, creatives, insights. See
[`metaads/AGENTS.md`](metaads/AGENTS.md).

```go
import "github.com/pax-beehive/connector/metaads"

c, err := metaads.NewClient(&metaads.Config{AccessToken: token})
camp, err := c.CreateCampaign(ctx, &metaads.CreateCampaignRequest{
	AdAccountId:         "act_123",
	Name:                connector.Ptr("spring sale"),
	Objective:           connector.Ptr("OUTCOME_TRAFFIC"),
	Status:              connector.Ptr("PAUSED"),
	SpecialAdCategories: connector.Ptr("[]"),
})
```

## Google Ads

GAQL queries/reporting plus the core write path (budgets, campaigns, ad
groups, ads, keywords) over the REST interface, with automatic OAuth
access-token refresh. See [`googleads/AGENTS.md`](googleads/AGENTS.md).

```go
import "github.com/pax-beehive/connector/googleads"

c, err := googleads.NewClient(&googleads.Config{
	DeveloperToken: devToken,
	ClientID: id, ClientSecret: secret, RefreshToken: refresh,
})
resp, err := c.SearchGoogleAds(ctx, &googleads.SearchGoogleAdsRequest{
	CustomerId: "5551234567",
	Query:      connector.Ptr("SELECT campaign.id, metrics.clicks FROM campaign"),
})
```

## Client options and error handling

Every connector's `NewClient(cfg, opts...)` accepts shared options:

```go
c, err := mindbody.NewClient(cfg,
	connector.WithTimeout(15*time.Second),           // per-call deadline (covers retries)
	connector.WithRetry(connector.RetryPolicy{}),    // opt-in retries: 3 attempts,
	                                                 // 429/502/503/504, honors Retry-After
	connector.WithHTTPClient(customClient),
)
```

Non-idempotent methods (POST) are only retried on 429 unless
`RetryPolicy.RetryNonIdempotent` is set.

Errors are standardized across connectors: any non-2xx response is a
`*connector.APIError` (status, service code/message, raw body, `RetryAfter`
hint), with classifier helpers:

```go
resp, err := c.GetClasses(ctx, req)
switch {
case connector.IsRateLimited(err):  // 429 — back off (see AsAPIError(err).RetryAfter)
case connector.IsUnauthorized(err): // 401 — credential/token problem
case connector.IsNotFound(err):     // 404
case connector.IsRetryable(err):    // 429/502/503/504
}
```

## For AI agents

Each connector ships a generated `AGENTS.md`
([mindbody](mindbody/AGENTS.md), [instagram](instagram/AGENTS.md),
[threads](threads/AGENTS.md), [facebook](facebook/AGENTS.md),
[x](x/AGENTS.md), [metaads](metaads/AGENTS.md),
[googleads](googleads/AGENTS.md)) describing
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
