// Package facebook is a connector for publishing and managing content on a
// Facebook Page through the Meta Graph API. Operation methods and model
// types are generated; see gen.yaml.
package facebook

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"github.com/pax-beehive/connector"
)

// DefaultBaseURL is the Meta Graph API host.
const DefaultBaseURL = "https://graph.facebook.com"

// DefaultVersion is the Graph API version used when Config.Version is empty.
// It must match the pinned version in gen.yaml.
const DefaultVersion = "v23.0"

// Config carries the credentials and options for one Facebook Page.
type Config struct {
	// AccessToken is a Page access token with pages_manage_posts /
	// pages_read_engagement (use a user token only for ListManagedPages,
	// which returns the page tokens). Required. The connector does not
	// refresh tokens.
	AccessToken string

	BaseURL    string       // optional, defaults to DefaultBaseURL
	Version    string       // optional Graph API version, defaults to DefaultVersion
	HTTPClient *http.Client // optional
}

// Client is a Facebook Page connector instance.
type Client struct {
	core *connector.Core
}

// NewClient creates a connector instance for one Facebook Page.
func NewClient(cfg *Config) (*Client, error) {
	if cfg == nil || cfg.AccessToken == "" {
		return nil, errors.New("facebook: AccessToken is required")
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
