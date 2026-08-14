// Package x is a connector for the X (Twitter) API v2, focused on posting
// and managing tweets for a business account. Operation methods and model
// types are generated; see gen.yaml.
package x

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"github.com/pax-beehive/connector"
)

// DefaultBaseURL is the X API host. https://api.twitter.com also works.
const DefaultBaseURL = "https://api.x.com"

// Config carries the credentials and options for one X account.
type Config struct {
	// AccessToken is an OAuth 2.0 bearer token. Posting and engagement
	// endpoints require a user-context token (obtained via the OAuth 2.0
	// authorization-code + PKCE flow with tweet.read tweet.write users.read
	// scopes); an app-only bearer token works for reads only. Required.
	// The connector does not refresh tokens.
	AccessToken string

	BaseURL    string       // optional, defaults to DefaultBaseURL
	HTTPClient *http.Client // optional
}

// Client is an X connector instance.
type Client struct {
	core *connector.Core
}

// NewClient creates a connector instance for one X account. Options
// (connector.WithTimeout, connector.WithRetry, connector.WithHTTPClient)
// apply to all calls.
func NewClient(cfg *Config, opts ...connector.Option) (*Client, error) {
	if cfg == nil || cfg.AccessToken == "" {
		return nil, errors.New("x: AccessToken is required")
	}
	baseURL := cfg.BaseURL
	if baseURL == "" {
		baseURL = DefaultBaseURL
	}
	core := &connector.Core{
		BaseURL:    baseURL,
		HTTPClient: cfg.HTTPClient,
		Auth:       &tokenAuth{token: cfg.AccessToken},
		ParseError: parseError,
	}
	core.Apply(opts...)
	return &Client{core: core}, nil
}

// parseError decodes both X v2 problem responses
// ({"title","detail","status"}) and legacy error arrays
// ({"errors":[{"message","code"}]}).
func parseError(body []byte) (string, string) {
	var e struct {
		Title  string `json:"title"`
		Detail string `json:"detail"`
		Status int    `json:"status"`
		Errors []struct {
			Message string `json:"message"`
			Code    int    `json:"code"`
		} `json:"errors"`
	}
	_ = json.Unmarshal(body, &e)
	if e.Title != "" || e.Detail != "" {
		return e.Title, e.Detail
	}
	if len(e.Errors) > 0 {
		return strconv.Itoa(e.Errors[0].Code), e.Errors[0].Message
	}
	return "", ""
}

// tokenAuth attaches the static bearer token. X tokens cannot be
// transparently re-issued, so a 401 is never retried.
type tokenAuth struct {
	token string
}

func (a *tokenAuth) Authorize(_ context.Context, req *http.Request) error {
	req.Header.Set("Authorization", "Bearer "+a.token)
	return nil
}

func (a *tokenAuth) InvalidateAuth(context.Context) bool { return false }
