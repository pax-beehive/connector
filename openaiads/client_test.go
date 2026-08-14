package openaiads

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
		t.Fatal("expected error for missing APIKey")
	}
	if _, err := NewClient(nil); err == nil {
		t.Fatal("expected error for nil config")
	}
	if _, err := NewClient(&Config{APIKey: "k"}); err != nil {
		t.Fatalf("unexpected: %v", err)
	}
}

func newTestClient(t *testing.T, h http.HandlerFunc) *Client {
	t.Helper()
	srv := httptest.NewServer(h)
	t.Cleanup(srv.Close)
	c, err := NewClient(&Config{APIKey: "key", BaseURL: srv.URL})
	if err != nil {
		t.Fatal(err)
	}
	return c
}

func TestBearerAuthAndJSONBody(t *testing.T) {
	var auth, path, name string
	c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		auth, path = r.Header.Get("Authorization"), r.URL.Path
		var b map[string]any
		_ = json.NewDecoder(r.Body).Decode(&b)
		name, _ = b["name"].(string)
		_, _ = w.Write([]byte(`{"id":"cmpn_101","name":"Spring launch","status":"active"}`))
	})
	resp, err := c.CreateCampaign(context.Background(), &CreateCampaignRequest{
		Name:   connector.Ptr("Spring launch"),
		Status: connector.Ptr("active"),
	})
	if err != nil {
		t.Fatal(err)
	}
	if auth != "Bearer key" {
		t.Errorf("Authorization = %q", auth)
	}
	if path != "/campaigns" {
		t.Errorf("path = %q", path)
	}
	if name != "Spring launch" {
		t.Errorf("body name = %q", name)
	}
	if resp.Id == nil || *resp.Id != "cmpn_101" {
		t.Errorf("resp = %+v", resp)
	}
}

func TestParseError(t *testing.T) {
	c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(401)
		_, _ = w.Write([]byte(`{"error":{"message":"Invalid API key","type":"invalid_request_error","code":"invalid_api_key"}}`))
	})
	err := c.core.Do(context.Background(), &connector.Call{Method: "GET", Path: "/ad_account"})
	apiErr, ok := err.(*connector.APIError)
	if !ok || apiErr.Code != "invalid_api_key" || apiErr.Message != "Invalid API key" {
		t.Fatalf("got %v", err)
	}
	if !connector.IsUnauthorized(err) {
		t.Error("expected IsUnauthorized")
	}
}
