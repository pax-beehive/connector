// Package instagram is a connector for operating an Instagram professional
// (business/creator) account through the Meta Graph API: content publishing,
// media, comments, insights, and profile. Operation methods and model types
// are generated; see gen.yaml.
package instagram

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"github.com/pax-beehive/connector"
)

// DefaultBaseURL serves the Instagram API with Facebook Login. Accounts
// using Instagram Login should set BaseURL to InstagramLoginBaseURL.
const DefaultBaseURL = "https://graph.facebook.com"

// InstagramLoginBaseURL serves the Instagram API with Instagram Login.
const InstagramLoginBaseURL = "https://graph.instagram.com"

// DefaultVersion is the Graph API version used when Config.Version is empty.
// It must match the pinned version in gen.yaml.
const DefaultVersion = "v23.0"

// Config carries the credentials and options for one Instagram professional
// account.
type Config struct {
	// AccessToken is a long-lived user or page access token with the
	// instagram_business_* / instagram_basic + content publishing
	// permissions. Required. The connector does not refresh it; see
	// RefreshAccessToken for Instagram-Login tokens.
	AccessToken string

	BaseURL    string       // optional, defaults to DefaultBaseURL
	Version    string       // optional Graph API version, defaults to DefaultVersion
	HTTPClient *http.Client // optional
}

// Client is an Instagram connector instance.
type Client struct {
	core *connector.Core
}

// NewClient creates a connector instance for one Instagram professional
// account. Options (connector.WithTimeout, connector.WithRetry,
// connector.WithHTTPClient) apply to all calls.
func NewClient(cfg *Config, opts ...connector.Option) (*Client, error) {
	if cfg == nil || cfg.AccessToken == "" {
		return nil, errors.New("instagram: AccessToken is required")
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

// parseError decodes the Graph API error envelope:
// {"error":{"message":..,"type":..,"code":..,"error_subcode":..}}.
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

// tokenAuth attaches the static access token as a Bearer header. Graph API
// tokens cannot be transparently re-issued, so a 401 is never retried.
type tokenAuth struct {
	token string
}

func (a *tokenAuth) Authorize(_ context.Context, req *http.Request) error {
	req.Header.Set("Authorization", "Bearer "+a.token)
	return nil
}

func (a *tokenAuth) InvalidateAuth(context.Context) bool { return false }
