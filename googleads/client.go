// Package googleads is a connector for the Google Ads API (REST interface):
// GAQL queries/reporting and the core campaign-management write path.
// Operation methods and model types are generated; see gen.yaml.
package googleads

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/pax-beehive/connector"
)

// DefaultBaseURL is the Google Ads API host.
const DefaultBaseURL = "https://googleads.googleapis.com"

// DefaultVersion is the API version used when Config.Version is empty. It
// must match the pinned version in gen.yaml.
const DefaultVersion = "v23"

// DefaultTokenURL is Google's OAuth 2.0 token endpoint.
const DefaultTokenURL = "https://oauth2.googleapis.com/token"

// Config carries the credentials and options for one Google Ads
// integration. DeveloperToken is always required, plus either a static
// AccessToken or the ClientID/ClientSecret/RefreshToken triple for
// automatic access-token refresh.
type Config struct {
	DeveloperToken string // required; from the API Center of a manager account

	// Static access token (no refresh). Mutually exclusive with the
	// refresh-token flow below.
	AccessToken string

	// OAuth refresh flow: access tokens are minted lazily from the refresh
	// token, cached until expiry, and re-minted after a 401.
	ClientID     string
	ClientSecret string
	RefreshToken string

	// LoginCustomerID is the manager (MCC) customer ID, digits only.
	// Required when accessing a client account through a manager.
	LoginCustomerID string

	BaseURL    string       // optional, defaults to DefaultBaseURL
	Version    string       // optional, defaults to DefaultVersion
	TokenURL   string       // optional, defaults to DefaultTokenURL
	HTTPClient *http.Client // optional
}

func (c *Config) hasRefreshFlow() bool {
	return c.ClientID != "" && c.ClientSecret != "" && c.RefreshToken != ""
}

// Client is a Google Ads connector instance.
type Client struct {
	core *connector.Core
}

// NewClient creates a connector instance. Options (connector.WithTimeout,
// connector.WithRetry, connector.WithHTTPClient) apply to all calls.
func NewClient(cfg *Config, opts ...connector.Option) (*Client, error) {
	if cfg == nil || cfg.DeveloperToken == "" {
		return nil, errors.New("googleads: DeveloperToken is required")
	}
	if cfg.AccessToken == "" && !cfg.hasRefreshFlow() {
		return nil, errors.New("googleads: either AccessToken or ClientID+ClientSecret+RefreshToken is required")
	}
	baseURL := cfg.BaseURL
	if baseURL == "" {
		baseURL = DefaultBaseURL
	}
	version := cfg.Version
	if version == "" {
		version = DefaultVersion
	}
	tokenURL := cfg.TokenURL
	if tokenURL == "" {
		tokenURL = DefaultTokenURL
	}
	headers := http.Header{}
	headers.Set("developer-token", cfg.DeveloperToken)
	if cfg.LoginCustomerID != "" {
		headers.Set("login-customer-id", cfg.LoginCustomerID)
	}
	core := &connector.Core{
		BaseURL:    baseURL,
		HTTPClient: cfg.HTTPClient,
		Headers:    headers,
		PathParams: map[string]string{"version": version},
		Auth: &oauthAuth{
			static:       cfg.AccessToken,
			clientID:     cfg.ClientID,
			clientSecret: cfg.ClientSecret,
			refreshToken: cfg.RefreshToken,
			tokenURL:     tokenURL,
			httpClient:   cfg.HTTPClient,
		},
		ParseError: parseError,
	}
	core.Apply(opts...)
	return &Client{core: core}, nil
}

// parseError decodes the google.rpc.Status envelope:
// {"error":{"code":403,"message":..,"status":"PERMISSION_DENIED"}}.
func parseError(body []byte) (string, string) {
	var e struct {
		Error struct {
			Code    int    `json:"code"`
			Message string `json:"message"`
			Status  string `json:"status"`
		} `json:"error"`
	}
	_ = json.Unmarshal(body, &e)
	return e.Error.Status, e.Error.Message
}

// oauthAuth attaches a Bearer token: either static, or minted from a
// refresh token and cached until shortly before expiry.
type oauthAuth struct {
	static       string
	clientID     string
	clientSecret string
	refreshToken string
	tokenURL     string
	httpClient   *http.Client

	mu     sync.Mutex
	token  string
	expiry time.Time
}

func (a *oauthAuth) Authorize(ctx context.Context, req *http.Request) error {
	if a.static != "" {
		req.Header.Set("Authorization", "Bearer "+a.static)
		return nil
	}
	token, err := a.getToken(ctx)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	return nil
}

func (a *oauthAuth) getToken(ctx context.Context) (string, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.token != "" && time.Now().Before(a.expiry) {
		return a.token, nil
	}
	token, expiresIn, err := a.refresh(ctx)
	if err != nil {
		return "", err
	}
	a.token = token
	// Refresh one minute early to avoid using a token at the expiry edge.
	a.expiry = time.Now().Add(time.Duration(expiresIn)*time.Second - time.Minute)
	return a.token, nil
}

func (a *oauthAuth) refresh(ctx context.Context) (string, int, error) {
	form := url.Values{}
	form.Set("client_id", a.clientID)
	form.Set("client_secret", a.clientSecret)
	form.Set("refresh_token", a.refreshToken)
	form.Set("grant_type", "refresh_token")
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, a.tokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return "", 0, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	hc := a.httpClient
	if hc == nil {
		hc = http.DefaultClient
	}
	resp, err := hc.Do(req)
	if err != nil {
		return "", 0, err
	}
	defer func() { _ = resp.Body.Close() }()
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", 0, err
	}
	if resp.StatusCode != http.StatusOK {
		return "", 0, fmt.Errorf("googleads: token refresh failed: status %d: %s", resp.StatusCode, data)
	}
	var out struct {
		AccessToken string `json:"access_token"`
		ExpiresIn   int    `json:"expires_in"`
	}
	if err := json.Unmarshal(data, &out); err != nil {
		return "", 0, err
	}
	if out.AccessToken == "" {
		return "", 0, errors.New("googleads: token refresh returned no access token")
	}
	return out.AccessToken, out.ExpiresIn, nil
}

// InvalidateAuth drops the cached access token after a 401 so the retry
// mints a fresh one; a static token cannot be refreshed.
func (a *oauthAuth) InvalidateAuth(context.Context) bool {
	if a.static != "" {
		return false
	}
	a.mu.Lock()
	a.token = ""
	a.expiry = time.Time{}
	a.mu.Unlock()
	return true
}
