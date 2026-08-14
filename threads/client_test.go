package threads

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

func TestPublishFlowRequests(t *testing.T) {
	var auth, path, mediaType, text, creationID string
	c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		auth, path = r.Header.Get("Authorization"), r.URL.Path
		q := r.URL.Query()
		if q.Get("media_type") != "" {
			mediaType, text = q.Get("media_type"), q.Get("text")
			_, _ = w.Write([]byte(`{"id":"container-1"}`))
			return
		}
		creationID = q.Get("creation_id")
		_, _ = w.Write([]byte(`{"id":"post-1"}`))
	})
	ctx := context.Background()
	cont, err := c.CreateThreadsContainer(ctx, &CreateThreadsContainerRequest{
		ThreadsUserId: "u1",
		MediaType:     connector.Ptr("TEXT"),
		Text:          connector.Ptr("hello threads"),
	})
	if err != nil {
		t.Fatal(err)
	}
	if auth != "Bearer tok" || mediaType != "TEXT" || text != "hello threads" {
		t.Errorf("container call: auth=%q media_type=%q text=%q", auth, mediaType, text)
	}
	pub, err := c.PublishThread(ctx, &PublishThreadRequest{
		ThreadsUserId: "u1",
		CreationId:    cont.Id,
	})
	if err != nil {
		t.Fatal(err)
	}
	if path != "/"+DefaultVersion+"/u1/threads_publish" {
		t.Errorf("publish path = %q", path)
	}
	if creationID != "container-1" {
		t.Errorf("creation_id = %q", creationID)
	}
	if pub.Id == nil || *pub.Id != "post-1" {
		t.Errorf("pub = %+v", pub)
	}
}

func TestParseGraphError(t *testing.T) {
	c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(400)
		_, _ = w.Write([]byte(`{"error":{"message":"Media posted before business account conversion","type":"OAuthException","code":10,"error_subcode":2207051}}`))
	})
	err := c.core.Do(context.Background(), &connector.Call{Method: "GET", Path: "/x"})
	apiErr, ok := err.(*connector.APIError)
	if !ok || apiErr.Code != "10/2207051" {
		t.Fatalf("got %v", err)
	}
}
