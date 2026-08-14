package x

import (
	"context"
	"encoding/json"
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

func newTestClient(t *testing.T, h http.HandlerFunc) *Client {
	t.Helper()
	srv := httptest.NewServer(h)
	t.Cleanup(srv.Close)
	c, err := NewClient(&Config{AccessToken: "tok", BaseURL: srv.URL})
	if err != nil {
		t.Fatal(err)
	}
	return c
}

func TestBearerAuthAndJSONBody(t *testing.T) {
	var auth, text string
	c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		auth = r.Header.Get("Authorization")
		var b map[string]any
		_ = json.NewDecoder(r.Body).Decode(&b)
		text, _ = b["text"].(string)
		_, _ = w.Write([]byte(`{"data":{"id":"1","text":"hi"}}`))
	})
	resp, err := c.CreateTweet(context.Background(), &CreateTweetRequest{Text: connector.Ptr("hi")})
	if err != nil {
		t.Fatal(err)
	}
	if auth != "Bearer tok" {
		t.Errorf("Authorization = %q", auth)
	}
	if text != "hi" {
		t.Errorf("body text = %q", text)
	}
	if resp.Data == nil || *resp.Data.Id != "1" {
		t.Errorf("resp = %+v", resp)
	}
}

func TestParseProblemError(t *testing.T) {
	c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(403)
		_, _ = w.Write([]byte(`{"title":"Unsupported Authentication","detail":"user-context required","status":403}`))
	})
	err := c.core.Do(context.Background(), &connector.Call{Method: "GET", Path: "/x"})
	apiErr, ok := err.(*connector.APIError)
	if !ok || apiErr.Code != "Unsupported Authentication" || apiErr.Message != "user-context required" {
		t.Fatalf("got %v", err)
	}
}

func TestParseLegacyError(t *testing.T) {
	c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(401)
		_, _ = w.Write([]byte(`{"errors":[{"message":"Invalid or expired token","code":89}]}`))
	})
	err := c.core.Do(context.Background(), &connector.Call{Method: "GET", Path: "/x"})
	apiErr, ok := err.(*connector.APIError)
	if !ok || apiErr.Code != "89" || apiErr.Message != "Invalid or expired token" {
		t.Fatalf("got %v", err)
	}
}
