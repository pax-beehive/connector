package connector

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
)

type echoOut struct {
	Got string `json:"Got"`
}

type coreReq struct {
	ID    string  `json:"-" path:"id"`
	Limit *int    `json:"-" query:"request.limit"`
	Tok   *string `json:"-" header:"x-extra"`
	Name  *string `json:"Name,omitempty"`
}

func TestCoreDoSuccess(t *testing.T) {
	var gotPath, gotQuery, gotHeader, gotBody, gotCT string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotQuery = r.URL.RawQuery
		gotHeader = r.Header.Get("x-extra") + "|" + r.Header.Get("Api-Key")
		gotCT = r.Header.Get("Content-Type")
		var b map[string]any
		_ = json.NewDecoder(r.Body).Decode(&b)
		gotBody, _ = b["Name"].(string)
		_ = json.NewEncoder(w).Encode(map[string]string{"Got": "ok"})
	}))
	defer srv.Close()

	core := &Core{
		BaseURL:    srv.URL,
		Headers:    http.Header{"Api-Key": []string{"k1"}},
		PathParams: map[string]string{"version": "6"},
	}
	req := &coreReq{ID: "abc", Limit: Ptr(5), Tok: Ptr("t1"), Name: Ptr("bob")}
	out := &echoOut{}
	err := core.Do(context.Background(), &Call{
		Method: http.MethodPost,
		Path:   "/public/v{version}/thing/{id}",
		Req:    req,
		Body:   req,
		Out:    out,
	})
	if err != nil {
		t.Fatal(err)
	}
	if gotPath != "/public/v6/thing/abc" {
		t.Errorf("path = %q", gotPath)
	}
	if gotQuery != "request.limit=5" {
		t.Errorf("query = %q", gotQuery)
	}
	if gotHeader != "t1|k1" {
		t.Errorf("headers = %q", gotHeader)
	}
	if gotCT != "application/json" {
		t.Errorf("content-type = %q", gotCT)
	}
	if gotBody != "bob" {
		t.Errorf("body Name = %q", gotBody)
	}
	if out.Got != "ok" {
		t.Errorf("out = %+v", out)
	}
}

func TestCoreDoMultiValueStaticHeaders(t *testing.T) {
	var got []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got = r.Header.Values("X-Multi")
		_, _ = w.Write([]byte(`{}`))
	}))
	defer srv.Close()
	core := &Core{BaseURL: srv.URL, Headers: http.Header{"X-Multi": []string{"a", "b"}}}
	if err := core.Do(context.Background(), &Call{Method: "GET", Path: "/x"}); err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 || got[0] != "a" || got[1] != "b" {
		t.Errorf("multi-value header = %v, want [a b]", got)
	}
}

func TestCoreDoAPIError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(400)
		_, _ = w.Write([]byte(`{"Error":{"Code":"Bad","Message":"nope"}}`))
	}))
	defer srv.Close()
	core := &Core{BaseURL: srv.URL, ParseError: func(b []byte) (string, string) {
		var e struct {
			Error struct{ Code, Message string }
		}
		_ = json.Unmarshal(b, &e)
		return e.Error.Code, e.Error.Message
	}}
	err := core.Do(context.Background(), &Call{Method: "GET", Path: "/x"})
	apiErr, ok := err.(*APIError)
	if !ok {
		t.Fatalf("want *APIError, got %T %v", err, err)
	}
	if apiErr.StatusCode != 400 || apiErr.Code != "Bad" || apiErr.Message != "nope" {
		t.Errorf("apiErr = %+v", apiErr)
	}
}

type fakeAuth struct {
	authorized  atomic.Int32
	invalidated atomic.Int32
	retry       bool
}

func (a *fakeAuth) Authorize(_ context.Context, r *http.Request) error {
	a.authorized.Add(1)
	r.Header.Set("Authorization", "tok")
	return nil
}
func (a *fakeAuth) InvalidateAuth(context.Context) bool {
	a.invalidated.Add(1)
	return a.retry
}

func TestCoreDo401RetryOnce(t *testing.T) {
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if calls.Add(1) == 1 {
			w.WriteHeader(401)
			return
		}
		_, _ = w.Write([]byte(`{}`))
	}))
	defer srv.Close()
	auth := &fakeAuth{retry: true}
	core := &Core{BaseURL: srv.URL, Auth: auth}
	if err := core.Do(context.Background(), &Call{Method: "GET", Path: "/x"}); err != nil {
		t.Fatal(err)
	}
	if calls.Load() != 2 || auth.invalidated.Load() != 1 {
		t.Errorf("calls=%d invalidated=%d", calls.Load(), auth.invalidated.Load())
	}
}

func TestCoreDo401NoRetryWhenAuthDeclines(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(401)
	}))
	defer srv.Close()
	auth := &fakeAuth{retry: false}
	core := &Core{BaseURL: srv.URL, Auth: auth}
	err := core.Do(context.Background(), &Call{Method: "GET", Path: "/x"})
	apiErr, ok := err.(*APIError)
	if !ok || apiErr.StatusCode != 401 {
		t.Fatalf("want 401 APIError, got %v", err)
	}
}

func TestCoreDoUnresolvedPathParam(t *testing.T) {
	core := &Core{BaseURL: "http://127.0.0.1:0"}
	err := core.Do(context.Background(), &Call{Method: "GET", Path: "/v{version}/x"})
	if err == nil {
		t.Fatal("expected unresolved path param error")
	}
}
