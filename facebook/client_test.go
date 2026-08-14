package facebook

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

func TestBearerAuthVersionAndQuery(t *testing.T) {
	var auth, path, msg string
	c := newTestClient(t, Config{}, func(w http.ResponseWriter, r *http.Request) {
		auth, path = r.Header.Get("Authorization"), r.URL.Path
		msg = r.URL.Query().Get("message")
		_, _ = w.Write([]byte(`{"id":"123_456"}`))
	})
	resp, err := c.CreatePagePost(context.Background(), &CreatePagePostRequest{
		PageId:  "123",
		Message: connector.Ptr("hello"),
	})
	if err != nil {
		t.Fatal(err)
	}
	if auth != "Bearer tok" {
		t.Errorf("Authorization = %q", auth)
	}
	if path != "/"+DefaultVersion+"/123/feed" {
		t.Errorf("path = %q", path)
	}
	if msg != "hello" {
		t.Errorf("message = %q", msg)
	}
	if resp.Id == nil || *resp.Id != "123_456" {
		t.Errorf("resp = %+v", resp)
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
		w.WriteHeader(403)
		_, _ = w.Write([]byte(`{"error":{"message":"Permissions error","type":"OAuthException","code":200,"error_subcode":1}}`))
	})
	err := c.core.Do(context.Background(), &connector.Call{Method: "GET", Path: "/x"})
	apiErr, ok := err.(*connector.APIError)
	if !ok || apiErr.Code != "200/1" || apiErr.Message != "Permissions error" {
		t.Fatalf("got %v", err)
	}
}
