package instagram

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/pax-beehive/connector"
)

func TestNewClientValidates(t *testing.T) {
	if _, err := NewClient(&Config{}); err == nil {
		t.Fatal("expected error for missing AccessToken")
	}
	if _, err := NewClient(nil); err == nil {
		t.Fatal("expected error for nil config")
	}
	if _, err := NewClient(&Config{AccessToken: "t"}); err != nil {
		t.Fatalf("unexpected: %v", err)
	}
}

func newTestClient(t *testing.T, cfg Config, h http.HandlerFunc) *Client {
	t.Helper()
	srv := httptest.NewServer(h)
	t.Cleanup(srv.Close)
	cfg.BaseURL = srv.URL
	if cfg.AccessToken == "" {
		cfg.AccessToken = "tok"
	}
	c, err := NewClient(&cfg)
	if err != nil {
		t.Fatal(err)
	}
	return c
}

func TestBearerAuthAndVersion(t *testing.T) {
	var auth, path string
	c := newTestClient(t, Config{}, func(w http.ResponseWriter, r *http.Request) {
		auth, path = r.Header.Get("Authorization"), r.URL.Path
		_, _ = w.Write([]byte(`{}`))
	})
	if err := c.core.Do(context.Background(), &connector.Call{Method: "GET", Path: "/{version}/me"}); err != nil {
		t.Fatal(err)
	}
	if auth != "Bearer tok" {
		t.Errorf("Authorization = %q", auth)
	}
	if path != "/"+DefaultVersion+"/me" {
		t.Errorf("path = %q", path)
	}
}

func TestVersionOverride(t *testing.T) {
	var path string
	c := newTestClient(t, Config{Version: "v99.0"}, func(w http.ResponseWriter, r *http.Request) {
		path = r.URL.Path
		_, _ = w.Write([]byte(`{}`))
	})
	if err := c.core.Do(context.Background(), &connector.Call{Method: "GET", Path: "/{version}/me"}); err != nil {
		t.Fatal(err)
	}
	if path != "/v99.0/me" {
		t.Errorf("path = %q", path)
	}
}

func TestParseGraphError(t *testing.T) {
	c := newTestClient(t, Config{}, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(400)
		_, _ = w.Write([]byte(`{"error":{"message":"Unsupported request","type":"GraphMethodException","code":100,"error_subcode":33}}`))
	})
	err := c.core.Do(context.Background(), &connector.Call{Method: "GET", Path: "/x"})
	apiErr, ok := err.(*connector.APIError)
	if !ok {
		t.Fatalf("want *APIError, got %v", err)
	}
	if apiErr.Code != "100/33" || apiErr.Message != "Unsupported request" {
		t.Errorf("apiErr = %+v", apiErr)
	}
}

func TestNo401Retry(t *testing.T) {
	calls := 0
	c := newTestClient(t, Config{}, func(w http.ResponseWriter, r *http.Request) {
		calls++
		w.WriteHeader(401)
		_, _ = w.Write([]byte(`{"error":{"message":"expired","code":190}}`))
	})
	err := c.core.Do(context.Background(), &connector.Call{Method: "GET", Path: "/x"})
	if err == nil || calls != 1 {
		t.Fatalf("want single failing call, got calls=%d err=%v", calls, err)
	}
}
