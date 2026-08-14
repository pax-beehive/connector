// Package openaiads is a connector for the OpenAI Ads API (ChatGPT Ads):
// campaigns, ad groups, ads, creative uploads, custom audiences,
// conversions setup, and insights. Operation methods and model types are
// generated from OpenAI's official OpenAPI spec; see gen.yaml.
package openaiads

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/pax-beehive/connector"
)

// DefaultBaseURL is the OpenAI Ads API host including the version prefix
// (the official spec's server URL).
const DefaultBaseURL = "https://api.ads.openai.com/v1"

// Config carries the credentials and options for one OpenAI ad account.
type Config struct {
	// APIKey is an Ads API key issued in the Settings tab of the Ads
	// Manager account. Each key is scoped to one ad account. Required.
	APIKey string

	BaseURL    string       // optional, defaults to DefaultBaseURL
	HTTPClient *http.Client // optional
}

// Client is an OpenAI Ads connector instance.
type Client struct {
	core *connector.Core
}

// NewClient creates a connector instance for one OpenAI ad account.
// Options (connector.WithTimeout, connector.WithRetry,
// connector.WithHTTPClient) apply to all calls.
func NewClient(cfg *Config, opts ...connector.Option) (*Client, error) {
	if cfg == nil || cfg.APIKey == "" {
		return nil, errors.New("openaiads: APIKey is required")
	}
	baseURL := cfg.BaseURL
	if baseURL == "" {
		baseURL = DefaultBaseURL
	}
	core := &connector.Core{
		BaseURL:    baseURL,
		HTTPClient: cfg.HTTPClient,
		Auth:       &tokenAuth{token: cfg.APIKey},
		ParseError: parseError,
	}
	core.Apply(opts...)
	return &Client{core: core}, nil
}

// parseError decodes the OpenAI error envelope:
// {"error":{"message":..,"type":..,"code":..}}.
func parseError(body []byte) (string, string) {
	var e struct {
		Error struct {
			Message string `json:"message"`
			Type    string `json:"type"`
			Code    string `json:"code"`
		} `json:"error"`
	}
	_ = json.Unmarshal(body, &e)
	code := e.Error.Code
	if code == "" {
		code = e.Error.Type
	}
	return code, e.Error.Message
}

// tokenAuth attaches the static API key as a Bearer header. Ads API keys
// cannot be transparently re-issued, so a 401 is never retried.
type tokenAuth struct {
	token string
}

func (a *tokenAuth) Authorize(_ context.Context, req *http.Request) error {
	req.Header.Set("Authorization", "Bearer "+a.token)
	return nil
}

func (a *tokenAuth) InvalidateAuth(context.Context) bool { return false }
