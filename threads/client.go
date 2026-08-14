// Package threads is a connector for the Meta Threads API: publishing
// posts, reading media, managing replies, and fetching insights for a
// Threads professional account. Operation methods and model types are
// generated; see gen.yaml.
package threads

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"github.com/pax-beehive/connector"
)

// DefaultBaseURL is the Threads API host.
const DefaultBaseURL = "https://graph.threads.net"

// DefaultVersion is the Threads API version used when Config.Version is
// empty. It must match the pinned version in gen.yaml.
const DefaultVersion = "v1.0"

// Config carries the credentials and options for one Threads account.
type Config struct {
	// AccessToken is a Threads long-lived access token (threads_basic +
	// threads_content_publish scopes; replies/insights scopes as needed).
	// Required. Long-lived tokens last 60 days; refresh them with
	// RefreshAccessToken and persist the returned token — the connector
	// does not refresh automatically.
	AccessToken string

	BaseURL    string       // optional, defaults to DefaultBaseURL
	Version    string       // optional, defaults to DefaultVersion
	HTTPClient *http.Client // optional
}

// Client is a Threads connector instance.
type Client struct {
	core *connector.Core
}

// NewClient creates a connector instance for one Threads account. Options
// (connector.WithTimeout, connector.WithRetry, connector.WithHTTPClient)
// apply to all calls.
func NewClient(cfg *Config, opts ...connector.Option) (*Client, error) {
	if cfg == nil || cfg.AccessToken == "" {
		return nil, errors.New("threads: AccessToken is required")
	}
	baseURL := cfg.BaseURL
	if baseURL == "" {
		baseURL = DefaultBaseURL
	}
	version := cfg.Version
	if version == "" {
		version = DefaultVersion
	}
	core := &connector.Core{
		BaseURL:    baseURL,
		HTTPClient: cfg.HTTPClient,
		PathParams: map[string]string{"version": version},
		Auth:       &tokenAuth{token: cfg.AccessToken},
		ParseError: parseError,
	}
	core.Apply(opts...)
	return &Client{core: core}, nil
}

// parseError decodes the Graph-style error envelope used by the Threads
// API: {"error":{"message":..,"type":..,"code":..,"error_subcode":..}}.
func parseError(body []byte) (string, string) {
	var e struct {
		Error struct {
			Message      string `json:"message"`
			Type         string `json:"type"`
			Code         int    `json:"code"`
			ErrorSubcode int    `json:"error_subcode"`
		} `json:"error"`
	}
	_ = json.Unmarshal(body, &e)
	if e.Error.Code == 0 && e.Error.Message == "" {
		return "", ""
	}
	code := strconv.Itoa(e.Error.Code)
	if e.Error.ErrorSubcode != 0 {
		code += "/" + strconv.Itoa(e.Error.ErrorSubcode)
	}
	return code, e.Error.Message
}

// tokenAuth attaches the static access token as a Bearer header. Threads
// long-lived tokens are refreshed explicitly via RefreshAccessToken, so a
// 401 is never retried.
type tokenAuth struct {
	token string
}

func (a *tokenAuth) Authorize(_ context.Context, req *http.Request) error {
	req.Header.Set("Authorization", "Bearer "+a.token)
	return nil
}

func (a *tokenAuth) InvalidateAuth(context.Context) bool { return false }
