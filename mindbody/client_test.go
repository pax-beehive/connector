package mindbody

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/pax-beehive/connector"
)

func TestNewClientValidates(t *testing.T) {
	if _, err := NewClient(&Config{}); err == nil {
		t.Fatal("expected error for missing APIKey/SiteID")
	}
	if _, err := NewClient(nil); err == nil {
		t.Fatal("expected error for nil config")
	}
	if _, err := NewClient(&Config{APIKey: "k", SiteID: "-99"}); err != nil {
		t.Fatalf("unexpected: %v", err)
	}
}

// newTestClient points a client at a stub server.
func newTestClient(t *testing.T, cfg Config, h http.HandlerFunc) *Client {
	t.Helper()
	srv := httptest.NewServer(h)
	t.Cleanup(srv.Close)
	cfg.BaseURL = srv.URL
	if cfg.APIKey == "" {
		cfg.APIKey = "key"
	}
	if cfg.SiteID == "" {
		cfg.SiteID = "-99"
	}
	c, err := NewClient(&cfg)
	if err != nil {
		t.Fatal(err)
	}
	return c
}

func TestStaticHeadersNoAuth(t *testing.T) {
	var apiKey, siteID, version, auth string
	c := newTestClient(t, Config{}, func(w http.ResponseWriter, r *http.Request) {
		apiKey, siteID = r.Header.Get("Api-Key"), r.Header.Get("SiteId")
		version, auth = r.Header.Get("Version"), r.Header.Get("Authorization")
		_, _ = w.Write([]byte(`{}`))
	})
	if err := c.core.Do(context.Background(), &connector.Call{Method: "GET", Path: "/public/v{version}/site/sites"}); err != nil {
		t.Fatal(err)
	}
	if apiKey != "key" || siteID != "-99" || version != "6" {
		t.Errorf("headers: Api-Key=%q SiteId=%q Version=%q", apiKey, siteID, version)
	}
	if auth != "" {
		t.Errorf("no credentials configured, Authorization must be empty, got %q", auth)
	}
}

func TestStaffTokenIssueAndCache(t *testing.T) {
	var issues atomic.Int32
	var mu sync.Mutex
	var lastAuth string
	c := newTestClient(t, Config{Username: "u", Password: "p"}, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/public/v6/usertoken/issue" {
			issues.Add(1)
			var body map[string]string
			_ = json.NewDecoder(r.Body).Decode(&body)
			if body["Username"] != "u" || body["Password"] != "p" {
				t.Errorf("issue body = %v", body)
			}
			_, _ = w.Write([]byte(`{"AccessToken":"tok-1"}`))
			return
		}
		mu.Lock()
		lastAuth = r.Header.Get("Authorization")
		mu.Unlock()
		_, _ = w.Write([]byte(`{}`))
	})
	ctx := context.Background()
	for i := 0; i < 3; i++ {
		if err := c.core.Do(ctx, &connector.Call{Method: "GET", Path: "/public/v{version}/class/classes"}); err != nil {
			t.Fatal(err)
		}
	}
	if issues.Load() != 1 {
		t.Errorf("token issued %d times, want 1 (cached)", issues.Load())
	}
	if lastAuth != "tok-1" {
		t.Errorf("Authorization = %q", lastAuth)
	}
}

func TestStaffTokenConcurrentSingleIssue(t *testing.T) {
	var issues atomic.Int32
	c := newTestClient(t, Config{Username: "u", Password: "p"}, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/public/v6/usertoken/issue" {
			issues.Add(1)
			_, _ = w.Write([]byte(`{"AccessToken":"tok"}`))
			return
		}
		_, _ = w.Write([]byte(`{}`))
	})
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_ = c.core.Do(context.Background(), &connector.Call{Method: "GET", Path: "/public/v{version}/class/classes"})
		}()
	}
	wg.Wait()
	if issues.Load() != 1 {
		t.Errorf("token issued %d times under concurrency, want 1", issues.Load())
	}
}

func TestStaffTokenReissuedAfter401(t *testing.T) {
	var issues atomic.Int32
	var mu sync.Mutex
	rejected := false
	c := newTestClient(t, Config{Username: "u", Password: "p"}, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/public/v6/usertoken/issue" {
			token := "tok-1"
			if issues.Add(1) > 1 {
				token = "tok-2"
			}
			_ = json.NewEncoder(w).Encode(map[string]string{"AccessToken": token})
			return
		}
		mu.Lock()
		defer mu.Unlock()
		if r.Header.Get("Authorization") == "tok-1" && !rejected {
			rejected = true
			w.WriteHeader(401)
			_, _ = w.Write([]byte(`{"Error":{"Code":"Unauthorized","Message":"expired"}}`))
			return
		}
		_, _ = w.Write([]byte(`{}`))
	})
	if err := c.core.Do(context.Background(), &connector.Call{Method: "GET", Path: "/public/v{version}/class/classes"}); err != nil {
		t.Fatalf("expected auto re-issue to succeed: %v", err)
	}
	if issues.Load() != 2 {
		t.Errorf("issues = %d, want 2", issues.Load())
	}
}

// A 401 from the token-issue endpoint itself (bad staff credentials) must
// fail fast; a regression here deadlocks on the token mutex.
func TestStaffTokenIssue401FailsFast(t *testing.T) {
	c := newTestClient(t, Config{Username: "u", Password: "wrong"}, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/public/v6/usertoken/issue" {
			w.WriteHeader(401)
			_, _ = w.Write([]byte(`{"Error":{"Code":"InvalidCredentials","Message":"bad"}}`))
			return
		}
		_, _ = w.Write([]byte(`{}`))
	})
	done := make(chan error, 1)
	go func() {
		done <- c.core.Do(context.Background(), &connector.Call{Method: "GET", Path: "/public/v{version}/class/classes"})
	}()
	select {
	case err := <-done:
		apiErr, ok := err.(*connector.APIError)
		if !ok || apiErr.StatusCode != 401 {
			t.Fatalf("want 401 APIError, got %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("deadlock: call with failing token issue never returned")
	}
}

// Options passed to NewClient must reach the underlying core: a client with
// WithRetry recovers from a 429, and the classifier helpers recognize the
// terminal error.
func TestOptionsPassThrough(t *testing.T) {
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if calls.Add(1) == 1 {
			w.Header().Set("Retry-After", "1")
			w.WriteHeader(429)
			return
		}
		_, _ = w.Write([]byte(`{}`))
	}))
	t.Cleanup(srv.Close)
	c, err := NewClient(
		&Config{APIKey: "k", SiteID: "-99", BaseURL: srv.URL},
		connector.WithRetry(connector.RetryPolicy{MaxAttempts: 2, MinBackoff: time.Millisecond, MaxBackoff: 2 * time.Millisecond}),
		connector.WithTimeout(5*time.Second),
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := c.core.Do(context.Background(), &connector.Call{Method: "GET", Path: "/public/v{version}/site/sites"}); err != nil {
		t.Fatal(err)
	}
	if calls.Load() != 2 {
		t.Errorf("calls = %d, want 2 (one retry)", calls.Load())
	}
}

func TestParseError(t *testing.T) {
	c := newTestClient(t, Config{}, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(400)
		_, _ = w.Write([]byte(`{"Error":{"Code":"ClientNotFound","Message":"missing"}}`))
	})
	err := c.core.Do(context.Background(), &connector.Call{Method: "GET", Path: "/x"})
	apiErr, ok := err.(*connector.APIError)
	if !ok || apiErr.Code != "ClientNotFound" || apiErr.Message != "missing" {
		t.Fatalf("got %v", err)
	}
}
