package metaads

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

func TestCreateCampaignRequest(t *testing.T) {
	var auth, path, name, cats string
	c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		auth, path = r.Header.Get("Authorization"), r.URL.Path
		q := r.URL.Query()
		name, cats = q.Get("name"), q.Get("special_ad_categories")
		_, _ = w.Write([]byte(`{"id":"238"}`))
	})
	resp, err := c.CreateCampaign(context.Background(), &CreateCampaignRequest{
		AdAccountId:         "act_1",
		Name:                connector.Ptr("spring"),
		Objective:           connector.Ptr("OUTCOME_TRAFFIC"),
		SpecialAdCategories: connector.Ptr("[]"),
	})
	if err != nil {
		t.Fatal(err)
	}
	if auth != "Bearer tok" {
		t.Errorf("Authorization = %q", auth)
	}
	if path != "/"+DefaultVersion+"/act_1/campaigns" {
		t.Errorf("path = %q", path)
	}
	if name != "spring" || cats != "[]" {
		t.Errorf("params: name=%q special_ad_categories=%q", name, cats)
	}
	if resp.Id == nil || *resp.Id != "238" {
		t.Errorf("resp = %+v", resp)
	}
}

func TestParseGraphError(t *testing.T) {
	c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(400)
		_, _ = w.Write([]byte(`{"error":{"message":"Invalid parameter","type":"OAuthException","code":100,"error_subcode":33}}`))
	})
	err := c.core.Do(context.Background(), &connector.Call{Method: "GET", Path: "/x"})
	apiErr, ok := err.(*connector.APIError)
	if !ok || apiErr.Code != "100/33" || apiErr.Message != "Invalid parameter" {
		t.Fatalf("got %v", err)
	}
}
