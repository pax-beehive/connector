// Package mindbody is a connector for the Mindbody Public API v6.
// Operation methods and model types are generated; see gen.yaml.
package mindbody

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"sync"

	"github.com/pax-beehive/connector"
)

// DefaultBaseURL is the production Mindbody Public API host.
const DefaultBaseURL = "https://api.mindbodyonline.com"

const issueTokenPath = "/usertoken/issue"

// Config carries the credentials and options for one Mindbody site.
type Config struct {
	APIKey string // required
	SiteID string // required
	// Username/Password are staff credentials; optional, but required by
	// endpoints that need a staff user token. The token is issued, cached,
	// and refreshed automatically.
	Username string
	Password string

	BaseURL    string       // optional, defaults to DefaultBaseURL
	HTTPClient *http.Client // optional
}

// Client is a Mindbody Public API v6 connector instance.
type Client struct {
	core *connector.Core
}

// NewClient creates a connector instance for one Mindbody site.
func NewClient(cfg *Config) (*Client, error) {
	if cfg == nil || cfg.APIKey == "" || cfg.SiteID == "" {
		return nil, errors.New("mindbody: APIKey and SiteID are required")
	}
	baseURL := cfg.BaseURL
	if baseURL == "" {
		baseURL = DefaultBaseURL
	}
	headers := http.Header{}
	headers.Set("Api-Key", cfg.APIKey)
	headers.Set("SiteId", cfg.SiteID)
	headers.Set("Version", "6")
	// issueCore has no Authorizer: the token-issue call must never recurse
	// into auth, and a 401 from it must fail fast instead of triggering the
	// invalidate-and-retry path (which would deadlock on the token mutex).
	issueCore := &connector.Core{
		BaseURL:    baseURL,
		HTTPClient: cfg.HTTPClient,
		Headers:    headers,
		PathParams: map[string]string{"version": "6"},
		ParseError: parseError,
	}
	auth := &staffTokenAuth{username: cfg.Username, password: cfg.Password, core: issueCore}
	core := &connector.Core{
		BaseURL:    baseURL,
		HTTPClient: cfg.HTTPClient,
		Headers:    headers,
		PathParams: map[string]string{"version": "6"},
		Auth:       auth,
		ParseError: parseError,
	}
	return &Client{core: core}, nil
}

func parseError(body []byte) (string, string) {
	var e struct {
		Error struct {
			Code    string
			Message string
		}
	}
	_ = json.Unmarshal(body, &e)
	return e.Error.Code, e.Error.Message
}

// staffTokenAuth lazily issues and caches a Mindbody staff user token.
type staffTokenAuth struct {
	username string
	password string
	core     *connector.Core

	mu    sync.Mutex
	token string
}

func (a *staffTokenAuth) Authorize(ctx context.Context, req *http.Request) error {
	if a.username == "" || strings.HasSuffix(req.URL.Path, issueTokenPath) {
		return nil
	}
	token, err := a.getToken(ctx)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", token)
	return nil
}

func (a *staffTokenAuth) getToken(ctx context.Context) (string, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.token != "" {
		return a.token, nil
	}
	req := &IssueTokenRequest{Username: connector.Ptr(a.username), Password: connector.Ptr(a.password)}
	out := &IssueTokenResponse{}
	err := a.core.Do(ctx, &connector.Call{
		Method: http.MethodPost,
		Path:   "/public/v{version}" + issueTokenPath,
		Body:   req,
		Out:    out,
	})
	if err != nil {
		return "", err
	}
	if out.AccessToken == nil || *out.AccessToken == "" {
		return "", errors.New("mindbody: token issue succeeded but returned no access token")
	}
	a.token = *out.AccessToken
	return a.token, nil
}

func (a *staffTokenAuth) InvalidateAuth(context.Context) bool {
	if a.username == "" {
		return false
	}
	a.mu.Lock()
	a.token = ""
	a.mu.Unlock()
	return true
}
