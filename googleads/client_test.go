package googleads

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	"github.com/pax-beehive/connector"
)

func TestNewClientValidates(t *testing.T) {
	if _, err := NewClient(&Config{}); err == nil {
		t.Fatal("expected error for missing DeveloperToken")
	}
	if _, err := NewClient(&Config{DeveloperToken: "d"}); err == nil {
		t.Fatal("expected error when no token source is configured")
	}
	if _, err := NewClient(&Config{DeveloperToken: "d", AccessToken: "t"}); err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if _, err := NewClient(&Config{DeveloperToken: "d", ClientID: "c", ClientSecret: "s", RefreshToken: "r"}); err != nil {
		t.Fatalf("unexpected: %v", err)
	}
}

func TestStaticTokenAndHeaders(t *testing.T) {
	var auth, dev, login, path, query string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		auth, dev = r.Header.Get("Authorization"), r.Header.Get("developer-token")
		login, path = r.Header.Get("login-customer-id"), r.URL.Path
		var b map[string]any
		_ = json.NewDecoder(r.Body).Decode(&b)
		query, _ = b["query"].(string)
		_, _ = w.Write([]byte(`{"results":[{"campaign":{"id":"1"}}],"fieldMask":"campaign.id"}`))
	}))
	t.Cleanup(srv.Close)
	c, err := NewClient(&Config{
		DeveloperToken: "dev", AccessToken: "tok", LoginCustomerID: "999", BaseURL: srv.URL,
	})
	if err != nil {
		t.Fatal(err)
	}
	resp, err := c.SearchGoogleAds(context.Background(), &SearchGoogleAdsRequest{
		CustomerId: "123",
		Query:      connector.Ptr("SELECT campaign.id FROM campaign"),
	})
	if err != nil {
		t.Fatal(err)
	}
	if auth != "Bearer tok" || dev != "dev" || login != "999" {
		t.Errorf("headers: auth=%q dev=%q login=%q", auth, dev, login)
	}
	if path != "/"+DefaultVersion+"/customers/123/googleAds:search" {
		t.Errorf("path = %q", path)
	}
	if query != "SELECT campaign.id FROM campaign" {
		t.Errorf("query = %q", query)
	}
	if len(resp.Results) != 1 {
		t.Errorf("resp = %+v", resp)
	}
}

// stubTokenServer serves the OAuth token endpoint and, on the same mux, the
// API path used by the tests.
func refreshClient(t *testing.T, issues *atomic.Int32, apiHandler http.HandlerFunc) *Client {
	t.Helper()
	mux := http.NewServeMux()
	mux.HandleFunc("/oauth/token", func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseForm()
		if r.Form.Get("grant_type") != "refresh_token" || r.Form.Get("refresh_token") != "rt" {
			t.Errorf("unexpected token request: %v", r.Form)
		}
		n := issues.Add(1)
		token := "at-1"
		if n > 1 {
			token = "at-2"
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"access_token": token, "expires_in": 3600})
	})
	mux.HandleFunc("/", apiHandler)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	c, err := NewClient(&Config{
		DeveloperToken: "dev", ClientID: "cid", ClientSecret: "cs", RefreshToken: "rt",
		BaseURL: srv.URL, TokenURL: srv.URL + "/oauth/token",
	})
	if err != nil {
		t.Fatal(err)
	}
	return c
}

func TestRefreshFlowCachesToken(t *testing.T) {
	var issues atomic.Int32
	var lastAuth string
	c := refreshClient(t, &issues, func(w http.ResponseWriter, r *http.Request) {
		lastAuth = r.Header.Get("Authorization")
		_, _ = w.Write([]byte(`{"resourceNames":["customers/1"]}`))
	})
	ctx := context.Background()
	for i := 0; i < 3; i++ {
		if _, err := c.ListAccessibleCustomers(ctx, &ListAccessibleCustomersRequest{}); err != nil {
			t.Fatal(err)
		}
	}
	if issues.Load() != 1 {
		t.Errorf("token minted %d times, want 1 (cached)", issues.Load())
	}
	if lastAuth != "Bearer at-1" {
		t.Errorf("Authorization = %q", lastAuth)
	}
}

func TestRefreshFlowRemintsAfter401(t *testing.T) {
	var issues atomic.Int32
	rejected := false
	c := refreshClient(t, &issues, func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") == "Bearer at-1" && !rejected {
			rejected = true
			w.WriteHeader(401)
			_, _ = w.Write([]byte(`{"error":{"code":401,"message":"expired","status":"UNAUTHENTICATED"}}`))
			return
		}
		_, _ = w.Write([]byte(`{"resourceNames":[]}`))
	})
	if _, err := c.ListAccessibleCustomers(context.Background(), &ListAccessibleCustomersRequest{}); err != nil {
		t.Fatalf("expected re-mint to succeed: %v", err)
	}
	if issues.Load() != 2 {
		t.Errorf("issues = %d, want 2", issues.Load())
	}
}

func TestParseGoogleError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(403)
		_, _ = w.Write([]byte(`{"error":{"code":403,"message":"The caller does not have permission","status":"PERMISSION_DENIED"}}`))
	}))
	t.Cleanup(srv.Close)
	c, err := NewClient(&Config{DeveloperToken: "d", AccessToken: "t", BaseURL: srv.URL})
	if err != nil {
		t.Fatal(err)
	}
	callErr := c.core.Do(context.Background(), &connector.Call{Method: "GET", Path: "/x"})
	apiErr, ok := callErr.(*connector.APIError)
	if !ok || apiErr.Code != "PERMISSION_DENIED" || !connector.IsForbidden(callErr) {
		t.Fatalf("got %v", callErr)
	}
}
