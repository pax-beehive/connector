# Connector SDK + Mindbody Connector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Go library `github.com/pax-beehive/connector` with a shared HTTP runtime, a generic OpenAPI code generator, and a fully generated Mindbody Public API v6 connector (150 operations).

**Architecture:** Root package `connector` holds the shared runtime (request building, tagged-struct param encoding, auth hook, error decoding). `internal/genlib` + `cmd/connector-gen` form a generic OpenAPI→Go generator (Swagger 2.0 converted to OpenAPI 3 via kin-openapi, then one template set). `mindbody/` contains a small handwritten layer (Config, NewClient, staff-token auth) plus generated `*_gen.go` files and generated round-trip tests.

**Tech Stack:** Go ≥1.22, `github.com/getkin/kin-openapi` (spec load + 2.0→3.0 conversion), `gopkg.in/yaml.v3` (generator config), stdlib `text/template` + `go/format`.

## Global Constraints

- Cyclomatic complexity < 20 for every function (gate: gocyclo `-over 19`).
- Unit test coverage ≥ 80% total (gate: `make cover`).
- Every operation method: `func (c *Client) Xxx(ctx context.Context, req *XxxRequest) (*XxxResponse, error)`; request carries path+query+body params; client/request/response all pointers.
- Generated methods delegate to `connector.Core` so their complexity is 1.
- Generated code and the spec snapshot are committed.
- Commit after every task; commit messages end with the Claude Co-Authored-By trailer.

## Spec facts discovered (drive generator behavior)

- Spec: Swagger 2.0, 142 paths / 150 operations / 396 definitions (all `object`, no enums), tags: Appointment, Class, Client, CrossSite, Enrollment, Payroll, PickASpot, PricingOption, Sale, Site, Staff, UserToken.
- Every path contains `{version}`; headers `authorization`, `version`, `siteId` on ~every op → all handled by client config, skipped in generation. One op has header `consumer-identity-token` → becomes a request field with `header:` tag.
- Query params named `request.xxx`, arrays use `collectionFormat: multi`.
- Definition names are dotted .NET names (`Mindbody.PublicApi.Dto.Models.V6.ClientController.AddClientRequest`); Go name = last segment; 13 collisions, all `Dto.Models.V6.X` vs `Common.Models.X` → resolved by `prefer_namespaces` config.
- Body is always a `$ref` to an object definition EXCEPT `UpdateProducts`/`UpdateServices` (inline `{"type":"array","items":{$ref}}`).
- 2xx responses: mostly object refs; 12 inline `{"type":"object"}`; 1 inline `{"type":"array","items":{"type":"string"}}` (GetAcceptedCardTypes); 7 with no schema; codes 200/201/202/204.
- operationIds occasionally contain spaces (`Add Multiple Appointments`).

---

### Task 1: Module init + root package basics (Ptr, DateTime, APIError)

**Files:**
- Create: `go.mod`, `connector.go`, `datetime.go`, `errors.go`
- Test: `connector_test.go`

**Interfaces (Produces):**
- `connector.Ptr[T any](v T) *T`
- `type DateTime struct{ time.Time }` — flexible JSON parse (RFC3339Nano, `2006-01-02T15:04:05.999999999`, `2006-01-02T15:04:05`, `2006-01-02`); marshals/Strings as `2006-01-02T15:04:05`.
- `type APIError struct { StatusCode int; Code, Message string; Body []byte }` with `Error() string`
- `type ErrorParser func(body []byte) (code, message string)`

- [ ] Step 1: `go mod init github.com/pax-beehive/connector` (root package name `connector`).
- [ ] Step 2: Write failing tests in `connector_test.go`:

```go
package connector

import (
	"encoding/json"
	"testing"
	"time"
)

func TestPtr(t *testing.T) {
	if *Ptr(42) != 42 || *Ptr("a") != "a" {
		t.Fatal("Ptr roundtrip failed")
	}
}

func TestDateTimeUnmarshal(t *testing.T) {
	cases := []struct {
		in   string
		want time.Time
	}{
		{`"2020-01-02T15:04:05Z"`, time.Date(2020, 1, 2, 15, 4, 5, 0, time.UTC)},
		{`"2020-01-02T15:04:05"`, time.Date(2020, 1, 2, 15, 4, 5, 0, time.UTC)},
		{`"2020-01-02T15:04:05.123"`, time.Date(2020, 1, 2, 15, 4, 5, 123000000, time.UTC)},
		{`"2020-01-02"`, time.Date(2020, 1, 2, 0, 0, 0, 0, time.UTC)},
	}
	for _, c := range cases {
		var dt DateTime
		if err := json.Unmarshal([]byte(c.in), &dt); err != nil {
			t.Fatalf("%s: %v", c.in, err)
		}
		if !dt.Time.Equal(c.want) {
			t.Errorf("%s: got %v want %v", c.in, dt.Time, c.want)
		}
	}
	var dt DateTime
	if err := json.Unmarshal([]byte(`"nope"`), &dt); err == nil {
		t.Error("expected error for garbage datetime")
	}
	if err := json.Unmarshal([]byte(`null`), &dt); err != nil {
		t.Errorf("null should be accepted: %v", err)
	}
}

func TestDateTimeMarshal(t *testing.T) {
	dt := DateTime{time.Date(2020, 1, 2, 15, 4, 5, 0, time.UTC)}
	b, err := json.Marshal(dt)
	if err != nil || string(b) != `"2020-01-02T15:04:05"` {
		t.Fatalf("got %s, %v", b, err)
	}
	if dt.String() != "2020-01-02T15:04:05" {
		t.Fatalf("String() = %s", dt.String())
	}
}

func TestAPIError(t *testing.T) {
	e := &APIError{StatusCode: 400, Code: "BadRequest", Message: "nope", Body: []byte(`{}`)}
	if e.Error() == "" {
		t.Fatal("empty error string")
	}
}
```

- [ ] Step 3: Run `go test ./...` — expect compile failure (undefined symbols).
- [ ] Step 4: Implement. `connector.go`:

```go
// Package connector provides the shared runtime for per-service API
// connectors: request building, tagged-parameter encoding, auth hooks,
// and error decoding.
package connector

// Ptr returns a pointer to v. Use it for optional request fields.
func Ptr[T any](v T) *T { return &v }
```

`datetime.go`:

```go
package connector

import (
	"encoding/json"
	"fmt"
	"time"
)

// DateTime is a time.Time that tolerates API date-time strings with or
// without timezone or fractional seconds, and marshals without a zone
// (site-local convention used by APIs such as Mindbody).
type DateTime struct{ time.Time }

const dateTimeLayout = "2006-01-02T15:04:05"

var dateTimeLayouts = []string{
	time.RFC3339Nano,
	"2006-01-02T15:04:05.999999999",
	dateTimeLayout,
	"2006-01-02",
}

func (t *DateTime) UnmarshalJSON(b []byte) error {
	var s string
	if err := json.Unmarshal(b, &s); err != nil {
		if string(b) == "null" {
			return nil
		}
		return err
	}
	if s == "" {
		return nil
	}
	for _, layout := range dateTimeLayouts {
		if parsed, err := time.Parse(layout, s); err == nil {
			t.Time = parsed
			return nil
		}
	}
	return fmt.Errorf("connector: cannot parse datetime %q", s)
}

func (t DateTime) MarshalJSON() ([]byte, error) {
	return json.Marshal(t.Format(dateTimeLayout))
}

func (t DateTime) String() string { return t.Format(dateTimeLayout) }
```

`errors.go`:

```go
package connector

import "fmt"

// APIError is returned for any non-2xx response.
type APIError struct {
	StatusCode int
	Code       string // service-specific error code, if parseable
	Message    string // service-specific error message, if parseable
	Body       []byte // raw response body
}

func (e *APIError) Error() string {
	if e.Code != "" || e.Message != "" {
		return fmt.Sprintf("api error: status %d, code %q: %s", e.StatusCode, e.Code, e.Message)
	}
	return fmt.Sprintf("api error: status %d: %s", e.StatusCode, e.Body)
}

// ErrorParser extracts a service-specific code and message from an error
// response body. Each connector injects its own format.
type ErrorParser func(body []byte) (code, message string)
```

- [ ] Step 5: `go test ./...` — PASS. Commit: `feat: connector root package basics (Ptr, DateTime, APIError)`.

---

### Task 2: Tagged request-param encoder

**Files:**
- Create: `params.go`
- Test: `params_test.go`

**Interfaces (Produces):**

```go
type RequestParams struct {
	Query  url.Values
	Path   map[string]string
	Header map[string]string
}
// ParseRequestParams walks the struct pointed to by req and collects fields
// tagged `query:"wire.name"`, `path:"name"`, `header:"Name"`. Nil pointer
// fields are skipped; slices produce one query value per element; values are
// formatted via fmt.Stringer if implemented, else by kind. req may be nil.
func ParseRequestParams(req any) (*RequestParams, error)
```

- [ ] Step 1: Failing tests `params_test.go`:

```go
package connector

import (
	"testing"
	"time"
)

type sampleReq struct {
	Limit     *int      `json:"-" query:"request.limit"`
	Name      *string   `json:"-" query:"request.name"`
	Active    *bool     `json:"-" query:"request.active"`
	Rate      *float64  `json:"-" query:"request.rate"`
	IDs       []int     `json:"-" query:"request.ids"`
	Tags      []string  `json:"-" query:"request.tags"`
	Start     *DateTime `json:"-" query:"request.start"`
	ClientID  string    `json:"-" path:"clientId"`
	Token     *string   `json:"-" header:"consumer-identity-token"`
	BodyField *string   `json:"BodyField,omitempty"` // no tag: ignored
}

func TestParseRequestParams(t *testing.T) {
	start := DateTime{time.Date(2020, 5, 1, 9, 0, 0, 0, time.UTC)}
	req := &sampleReq{
		Limit: Ptr(25), Name: Ptr("bob"), Active: Ptr(true), Rate: Ptr(1.5),
		IDs: []int{1, 2}, Tags: []string{"a"}, Start: &start,
		ClientID: "c-9", Token: Ptr("tok"),
	}
	p, err := ParseRequestParams(req)
	if err != nil {
		t.Fatal(err)
	}
	q := p.Query
	if q.Get("request.limit") != "25" || q.Get("request.name") != "bob" ||
		q.Get("request.active") != "true" || q.Get("request.rate") != "1.5" {
		t.Errorf("scalar encoding wrong: %v", q)
	}
	if got := q["request.ids"]; len(got) != 2 || got[0] != "1" || got[1] != "2" {
		t.Errorf("array encoding wrong: %v", got)
	}
	if q.Get("request.start") != "2020-05-01T09:00:00" {
		t.Errorf("datetime encoding wrong: %v", q.Get("request.start"))
	}
	if p.Path["clientId"] != "c-9" {
		t.Errorf("path param wrong: %v", p.Path)
	}
	if p.Header["consumer-identity-token"] != "tok" {
		t.Errorf("header param wrong: %v", p.Header)
	}
	if _, ok := q["BodyField"]; ok {
		t.Error("untagged field must not be encoded")
	}
}

func TestParseRequestParamsNilAndEmpty(t *testing.T) {
	for _, req := range []any{nil, (*sampleReq)(nil), &sampleReq{}} {
		p, err := ParseRequestParams(req)
		if err != nil {
			t.Fatal(err)
		}
		if len(p.Query) != 0 || len(p.Header) != 0 {
			t.Errorf("expected empty params, got %+v", p)
		}
	}
}
```

- [ ] Step 2: Run — FAIL (undefined ParseRequestParams).
- [ ] Step 3: Implement `params.go` with small helpers so no func exceeds complexity 19:

```go
package connector

import (
	"fmt"
	"net/url"
	"reflect"
	"strconv"
)

// RequestParams holds the HTTP-level parameters extracted from a tagged
// request struct.
type RequestParams struct {
	Query  url.Values
	Path   map[string]string
	Header map[string]string
}

func ParseRequestParams(req any) (*RequestParams, error) {
	p := &RequestParams{Query: url.Values{}, Path: map[string]string{}, Header: map[string]string{}}
	if req == nil {
		return p, nil
	}
	v := reflect.ValueOf(req)
	for v.Kind() == reflect.Pointer {
		if v.IsNil() {
			return p, nil
		}
		v = v.Elem()
	}
	if v.Kind() != reflect.Struct {
		return nil, fmt.Errorf("connector: request must be a struct, got %T", req)
	}
	if err := p.walkStruct(v); err != nil {
		return nil, err
	}
	return p, nil
}

func (p *RequestParams) walkStruct(v reflect.Value) error {
	t := v.Type()
	for i := 0; i < t.NumField(); i++ {
		if err := p.field(t.Field(i), v.Field(i)); err != nil {
			return err
		}
	}
	return nil
}

func (p *RequestParams) field(sf reflect.StructField, fv reflect.Value) error {
	name, kind := paramTag(sf)
	if name == "" {
		return nil
	}
	for fv.Kind() == reflect.Pointer {
		if fv.IsNil() {
			return nil
		}
		fv = fv.Elem()
	}
	if kind == "query" && fv.Kind() == reflect.Slice {
		for i := 0; i < fv.Len(); i++ {
			s, err := formatValue(fv.Index(i))
			if err != nil {
				return err
			}
			p.Query.Add(name, s)
		}
		return nil
	}
	s, err := formatValue(fv)
	if err != nil {
		return err
	}
	switch kind {
	case "query":
		p.Query.Add(name, s)
	case "path":
		p.Path[name] = s
	case "header":
		p.Header[name] = s
	}
	return nil
}

func paramTag(sf reflect.StructField) (name, kind string) {
	for _, k := range []string{"query", "path", "header"} {
		if tag, ok := sf.Tag.Lookup(k); ok && tag != "" {
			return tag, k
		}
	}
	return "", ""
}

func formatValue(v reflect.Value) (string, error) {
	if s, ok := v.Interface().(fmt.Stringer); ok {
		return s.String(), nil
	}
	switch v.Kind() {
	case reflect.String:
		return v.String(), nil
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
		return strconv.FormatInt(v.Int(), 10), nil
	case reflect.Float32, reflect.Float64:
		return strconv.FormatFloat(v.Float(), 'f', -1, 64), nil
	case reflect.Bool:
		return strconv.FormatBool(v.Bool()), nil
	default:
		return "", fmt.Errorf("connector: unsupported parameter type %s", v.Type())
	}
}
```

- [ ] Step 4: `go test ./...` — PASS. Commit: `feat: tagged request-param encoder`.

---

### Task 3: Core HTTP execution (`Core.Do`)

**Files:**
- Create: `core.go`
- Test: `core_test.go`

**Interfaces (Produces):**

```go
type Authorizer interface {
	Authorize(ctx context.Context, req *http.Request) error
	// InvalidateAuth is called after a 401. Return true to retry once.
	InvalidateAuth(ctx context.Context) bool
}
type Core struct {
	BaseURL    string
	HTTPClient *http.Client       // defaulted to 30s-timeout client if nil
	Headers    http.Header        // static headers for every request
	PathParams map[string]string  // pinned path params (e.g. version=6)
	Auth       Authorizer         // optional
	ParseError ErrorParser        // optional
}
type Call struct {
	Method string
	Path   string // template: /public/v{version}/class/classes
	Req    any    // tagged request struct (may be nil)
	Body   any    // JSON body value (nil = no body)
	Out    any    // decode target pointer (nil = discard)
}
func (c *Core) Do(ctx context.Context, call *Call) error
```

Behavior: marshal body once to bytes; extract params from Req; expand path (pinned params first, then request path params; `{name}` → `url.PathEscape(value)`; error if unresolved `{` remains); attach static + per-request headers, `Content-Type: application/json` when body present, `Accept: application/json`; call Auth.Authorize; send. On 401 with Auth present and `InvalidateAuth`→true, rebuild and resend exactly once. 2xx: decode into Out unless Out nil or empty body. Non-2xx: return `*APIError` populated via ParseError.

- [ ] Step 1: Failing tests `core_test.go`:

```go
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

func TestCoreDoAPIError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(400)
		_, _ = w.Write([]byte(`{"Error":{"Code":"Bad","Message":"nope"}}`))
	}))
	defer srv.Close()
	core := &Core{BaseURL: srv.URL, ParseError: func(b []byte) (string, string) {
		var e struct{ Error struct{ Code, Message string } }
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
```

- [ ] Step 2: Run — FAIL. Implement `core.go`:

```go
package connector

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// Authorizer applies per-connector authentication to outgoing requests.
type Authorizer interface {
	Authorize(ctx context.Context, req *http.Request) error
	// InvalidateAuth is called after a 401 response. Returning true makes
	// the core rebuild and retry the request exactly once.
	InvalidateAuth(ctx context.Context) bool
}

// Core executes HTTP operations for a connector. Generated methods delegate
// to Do.
type Core struct {
	BaseURL    string
	HTTPClient *http.Client
	Headers    http.Header
	PathParams map[string]string
	Auth       Authorizer
	ParseError ErrorParser
}

// Call describes one HTTP operation.
type Call struct {
	Method string
	Path   string
	Req    any
	Body   any
	Out    any
}

func (c *Core) Do(ctx context.Context, call *Call) error {
	params, err := ParseRequestParams(call.Req)
	if err != nil {
		return err
	}
	body, err := marshalBody(call.Body)
	if err != nil {
		return err
	}
	resp, err := c.send(ctx, call, params, body)
	if err != nil {
		return err
	}
	if resp.StatusCode == http.StatusUnauthorized && c.Auth != nil && c.Auth.InvalidateAuth(ctx) {
		drain(resp)
		if resp, err = c.send(ctx, call, params, body); err != nil {
			return err
		}
	}
	return c.handleResponse(resp, call.Out)
}

func marshalBody(body any) ([]byte, error) {
	if body == nil {
		return nil, nil
	}
	return json.Marshal(body)
}

func (c *Core) send(ctx context.Context, call *Call, params *RequestParams, body []byte) (*http.Response, error) {
	req, err := c.buildRequest(ctx, call, params, body)
	if err != nil {
		return nil, err
	}
	if c.Auth != nil {
		if err := c.Auth.Authorize(ctx, req); err != nil {
			return nil, err
		}
	}
	return c.httpClient().Do(req)
}

func (c *Core) buildRequest(ctx context.Context, call *Call, params *RequestParams, body []byte) (*http.Request, error) {
	path, err := expandPath(call.Path, c.PathParams, params.Path)
	if err != nil {
		return nil, err
	}
	u := strings.TrimSuffix(c.BaseURL, "/") + path
	if enc := params.Query.Encode(); enc != "" {
		u += "?" + enc
	}
	var rd io.Reader
	if body != nil {
		rd = bytes.NewReader(body)
	}
	req, err := http.NewRequestWithContext(ctx, call.Method, u, rd)
	if err != nil {
		return nil, err
	}
	c.setHeaders(req, params, body != nil)
	return req, nil
}

func (c *Core) setHeaders(req *http.Request, params *RequestParams, hasBody bool) {
	req.Header.Set("Accept", "application/json")
	if hasBody {
		req.Header.Set("Content-Type", "application/json")
	}
	for k, vs := range c.Headers {
		for _, v := range vs {
			req.Header.Set(k, v)
		}
	}
	for k, v := range params.Header {
		req.Header.Set(k, v)
	}
}

func expandPath(tmpl string, pinned, fromReq map[string]string) (string, error) {
	path := tmpl
	for k, v := range pinned {
		path = strings.ReplaceAll(path, "{"+k+"}", url.PathEscape(v))
	}
	for k, v := range fromReq {
		path = strings.ReplaceAll(path, "{"+k+"}", url.PathEscape(v))
	}
	if i := strings.IndexByte(path, '{'); i >= 0 {
		return "", fmt.Errorf("connector: unresolved path parameter in %q", tmpl)
	}
	return path, nil
}

func (c *Core) handleResponse(resp *http.Response, out any) error {
	defer func() { _ = resp.Body.Close() }()
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return err
	}
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return c.apiError(resp.StatusCode, data)
	}
	if out == nil || len(bytes.TrimSpace(data)) == 0 {
		return nil
	}
	return json.Unmarshal(data, out)
}

func (c *Core) apiError(status int, body []byte) error {
	e := &APIError{StatusCode: status, Body: body}
	if c.ParseError != nil {
		e.Code, e.Message = c.ParseError(body)
	}
	return e
}

func (c *Core) httpClient() *http.Client {
	if c.HTTPClient != nil {
		return c.HTTPClient
	}
	return defaultHTTPClient
}

var defaultHTTPClient = &http.Client{Timeout: 30 * time.Second}

func drain(resp *http.Response) {
	_, _ = io.Copy(io.Discard, resp.Body)
	_ = resp.Body.Close()
}
```

- [ ] Step 3: `go test ./...` — PASS. Commit: `feat: connector Core HTTP execution with auth hook and 401 retry`.

---

### Task 4: Mindbody handwritten layer (Config, NewClient, staff-token auth)

**Files:**
- Create: `mindbody/client.go`
- Test: `mindbody/client_test.go`

**Interfaces:**
- Consumes: `connector.Core`, `connector.Authorizer`, `connector.APIError`.
- Produces (relied on by generated code): `mindbody.Client` struct with unexported field `core *connector.Core`; `NewClient(cfg *Config) (*Client, error)`; `DefaultBaseURL = "https://api.mindbodyonline.com"`.

Behavior:
- `Config{APIKey, SiteID, Username, Password, BaseURL, HTTPClient}`; APIKey and SiteID required.
- Static headers on every request: `Api-Key`, `SiteId`, `Version: 6`; pinned path param `version=6`.
- `staffTokenAuth` implements `connector.Authorizer`: no-op when Username empty or when the request path ends in `/usertoken/issue`; otherwise lazily POSTs `/public/v6/usertoken/issue` with `{"Username":…,"Password":…}` through the same core, caches `AccessToken` under a mutex, sets `Authorization` header. `InvalidateAuth` clears the cache and returns true iff credentials are configured.
- `parseError` handles Mindbody's `{"Error":{"Code":…,"Message":…}}`.

- [ ] Step 1: Failing tests `mindbody/client_test.go`:

```go
package mindbody

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/pax-beehive/connector"
)

func TestNewClientValidates(t *testing.T) {
	if _, err := NewClient(&Config{}); err == nil {
		t.Fatal("expected error for missing APIKey/SiteID")
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
	var issues, auths atomic.Int32
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
		auths.Add(1)
		lastAuth = r.Header.Get("Authorization")
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
	_ = auths
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
			n := issues.Add(1)
			_ = json.NewEncoder(w).Encode(map[string]string{"AccessToken": map[bool]string{true: "tok-2", false: "tok-1"}[n > 1]})
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
```

- [ ] Step 2: Run — FAIL. Implement `mindbody/client.go`:

```go
// Package mindbody is a connector for the Mindbody Public API v6.
// Operation methods and model types are generated; see gen.yaml.
package mindbody

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"sync"

	"github.com/pax-beehive/connector"
)

// DefaultBaseURL is the production Mindbody Public API host.
const DefaultBaseURL = "https://api.mindbodyonline.com"

const issueTokenPath = "/usertoken/issue"

// Config carries the credentials and options for one Mindbody site.
type Config struct {
	APIKey string // required
	SiteID string // required
	// Username/Password are staff credentials; optional, but required by
	// endpoints that need a staff user token. The token is issued, cached,
	// and refreshed automatically.
	Username string
	Password string

	BaseURL    string       // optional, defaults to DefaultBaseURL
	HTTPClient *http.Client // optional
}

// Client is a Mindbody Public API v6 connector instance.
type Client struct {
	core *connector.Core
}

// NewClient creates a connector instance for one Mindbody site.
func NewClient(cfg *Config) (*Client, error) {
	if cfg == nil || cfg.APIKey == "" || cfg.SiteID == "" {
		return nil, errors.New("mindbody: APIKey and SiteID are required")
	}
	baseURL := cfg.BaseURL
	if baseURL == "" {
		baseURL = DefaultBaseURL
	}
	headers := http.Header{}
	headers.Set("Api-Key", cfg.APIKey)
	headers.Set("SiteId", cfg.SiteID)
	headers.Set("Version", "6")
	auth := &staffTokenAuth{username: cfg.Username, password: cfg.Password}
	core := &connector.Core{
		BaseURL:    baseURL,
		HTTPClient: cfg.HTTPClient,
		Headers:    headers,
		PathParams: map[string]string{"version": "6"},
		Auth:       auth,
		ParseError: parseError,
	}
	auth.core = core
	return &Client{core: core}, nil
}

func parseError(body []byte) (string, string) {
	var e struct {
		Error struct {
			Code    string
			Message string
		}
	}
	_ = json.Unmarshal(body, &e)
	return e.Error.Code, e.Error.Message
}

// staffTokenAuth lazily issues and caches a Mindbody staff user token.
type staffTokenAuth struct {
	username string
	password string
	core     *connector.Core

	mu    sync.Mutex
	token string
}

func (a *staffTokenAuth) Authorize(ctx context.Context, req *http.Request) error {
	if a.username == "" || strings.HasSuffix(req.URL.Path, issueTokenPath) {
		return nil
	}
	token, err := a.getToken(ctx)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", token)
	return nil
}

func (a *staffTokenAuth) getToken(ctx context.Context) (string, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.token != "" {
		return a.token, nil
	}
	body := map[string]string{"Username": a.username, "Password": a.password}
	var out struct{ AccessToken string }
	err := a.core.Do(ctx, &connector.Call{
		Method: http.MethodPost,
		Path:   "/public/v{version}" + issueTokenPath,
		Body:   body,
		Out:    &out,
	})
	if err != nil {
		return "", err
	}
	a.token = out.AccessToken
	return a.token, nil
}

func (a *staffTokenAuth) InvalidateAuth(context.Context) bool {
	if a.username == "" {
		return false
	}
	a.mu.Lock()
	a.token = ""
	a.mu.Unlock()
	return true
}
```

- [ ] Step 3: `go test ./...` — PASS. Commit: `feat: mindbody client with auto-managed staff token`.

---

### Task 5: genlib — config and spec loading (2.0→3.x)

**Files:**
- Create: `internal/genlib/config.go`, `internal/genlib/load.go`
- Test: `internal/genlib/load_test.go`, fixture `internal/genlib/testdata/fixture-swagger.json`

**Interfaces (Produces):**

```go
type Config struct {
	Package          string            `yaml:"package"`
	Spec             string            `yaml:"spec"`
	OutDir           string            `yaml:"out_dir"`
	BaseURL          string            `yaml:"base_url"`
	DateTimeType     string            `yaml:"datetime_type"` // e.g. connector.DateTime; empty → time.Time
	SkipHeaders      []string          `yaml:"skip_headers"`
	QueryPrefixStrip string            `yaml:"query_prefix_strip"`
	PinnedPathParams map[string]string `yaml:"pinned_path_params"`
	PreferNamespaces []string          `yaml:"prefer_namespaces"`
	Rename           map[string]string `yaml:"rename"` // operationId → method name
}
func LoadConfig(path string) (*Config, error) // paths inside resolved relative to the yaml's dir
func LoadSpec(path string) (*openapi3.T, error) // detects swagger 2.0, converts via openapi2conv
```

Fixture spec `testdata/fixture-swagger.json` (Swagger 2.0, exercises every generator feature — reuse throughout genlib tests):

```json
{
  "swagger": "2.0",
  "info": {"title": "Fixture API", "version": "1"},
  "paths": {
    "/public/v{version}/widget/widgets": {
      "get": {
        "operationId": "GetWidgets",
        "tags": ["Widget"],
        "parameters": [
          {"name": "version", "in": "path", "required": true, "type": "string"},
          {"name": "authorization", "in": "header", "type": "string"},
          {"name": "request.limit", "in": "query", "type": "integer", "format": "int32"},
          {"name": "request.ids", "in": "query", "type": "array", "items": {"type": "integer", "format": "int64"}, "collectionFormat": "multi"},
          {"name": "request.startDate", "in": "query", "type": "string", "format": "date-time"},
          {"name": "x-trace", "in": "header", "type": "string"}
        ],
        "responses": {"200": {"schema": {"$ref": "#/definitions/Acme.Api.V1.WidgetController.GetWidgetsResponse"}}}
      },
      "post": {
        "operationId": "Add Widget",
        "tags": ["Widget"],
        "parameters": [
          {"name": "version", "in": "path", "required": true, "type": "string"},
          {"name": "request", "in": "body", "schema": {"$ref": "#/definitions/Acme.Api.V1.WidgetController.AddWidgetRequest"}}
        ],
        "responses": {"201": {"schema": {"$ref": "#/definitions/Acme.Api.V1.Widget"}}}
      }
    },
    "/public/v{version}/widget/{widgetId}/tags": {
      "put": {
        "operationId": "ReplaceTags",
        "tags": ["Widget"],
        "parameters": [
          {"name": "version", "in": "path", "required": true, "type": "string"},
          {"name": "widgetId", "in": "path", "required": true, "type": "integer", "format": "int64"},
          {"name": "tags", "in": "body", "schema": {"type": "array", "items": {"$ref": "#/definitions/Acme.Api.V1.Tag"}}}
        ],
        "responses": {"200": {"schema": {"type": "object"}}}
      }
    },
    "/public/v{version}/widget/cardtypes": {
      "get": {
        "operationId": "GetCardTypes",
        "tags": ["Misc"],
        "parameters": [{"name": "version", "in": "path", "required": true, "type": "string"}],
        "responses": {"200": {"schema": {"type": "array", "items": {"type": "string"}}}}
      },
      "delete": {
        "operationId": "DeleteCardType",
        "tags": ["Misc"],
        "parameters": [{"name": "version", "in": "path", "required": true, "type": "string"}],
        "responses": {"204": {"description": "no content"}}
      }
    }
  },
  "definitions": {
    "Acme.Api.V1.WidgetController.GetWidgetsResponse": {
      "type": "object",
      "properties": {
        "PaginationResponse": {"$ref": "#/definitions/Acme.Api.V1.Pagination"},
        "Widgets": {"type": "array", "items": {"$ref": "#/definitions/Acme.Api.V1.Widget"}}
      }
    },
    "Acme.Api.V1.WidgetController.AddWidgetRequest": {
      "type": "object",
      "properties": {
        "Name": {"type": "string"},
        "Count": {"type": "integer", "format": "int32"},
        "When": {"type": "string", "format": "date-time"},
        "Widget": {"$ref": "#/definitions/Acme.Api.V1.Widget"}
      }
    },
    "Acme.Api.V1.Widget": {
      "type": "object",
      "properties": {
        "Id": {"type": "integer", "format": "int64"},
        "Name": {"type": "string"},
        "Price": {"type": "number", "format": "double"},
        "Active": {"type": "boolean"},
        "Tags": {"type": "array", "items": {"$ref": "#/definitions/Acme.Api.V1.Tag"}},
        "Extra": {"type": "object", "additionalProperties": {"type": "string"}},
        "Blob": {"type": "string", "format": "byte"}
      }
    },
    "Acme.Api.V1.Tag": {
      "type": "object",
      "properties": {"Label": {"$ref": "#/definitions/Acme.Common.Tag"}}
    },
    "Acme.Common.Tag": {
      "type": "object",
      "properties": {"Value": {"type": "string"}}
    },
    "Acme.Api.V1.Unused": {
      "type": "object",
      "properties": {"X": {"type": "string"}}
    }
  }
}
```

Note the deliberate features: opId with space, header skip vs kept header (`x-trace`), query prefix strip, real path param, object body flatten, array body, inline object / array / empty responses, name collision `Acme.Api.V1.Tag` vs `Acme.Common.Tag`, unused definition (must NOT be generated), body definition (`AddWidgetRequest`) that must NOT be generated as a model (flattened) while its nested `Widget` IS generated.

- [ ] Step 1: `go get github.com/getkin/kin-openapi gopkg.in/yaml.v3`.
- [ ] Step 2: Failing test `load_test.go`:

```go
package genlib

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadConfig(t *testing.T) {
	dir := t.TempDir()
	yml := []byte("package: mindbody\nspec: spec/swagger.json\nout_dir: .\nbase_url: https://x\nquery_prefix_strip: \"request.\"\nskip_headers: [authorization]\npinned_path_params: {version: \"6\"}\n")
	path := filepath.Join(dir, "gen.yaml")
	if err := os.WriteFile(path, yml, 0o644); err != nil {
		t.Fatal(err)
	}
	cfg, err := LoadConfig(path)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Package != "mindbody" || cfg.QueryPrefixStrip != "request." {
		t.Errorf("cfg = %+v", cfg)
	}
	if cfg.Spec != filepath.Join(dir, "spec/swagger.json") || cfg.OutDir != dir {
		t.Errorf("paths not resolved: spec=%q out=%q", cfg.Spec, cfg.OutDir)
	}
}

func TestLoadSpecConvertsSwagger2(t *testing.T) {
	doc, err := LoadSpec("testdata/fixture-swagger.json")
	if err != nil {
		t.Fatal(err)
	}
	if doc.Paths == nil || doc.Paths.Find("/public/v{version}/widget/widgets") == nil {
		t.Fatal("paths missing after conversion")
	}
	if _, ok := doc.Components.Schemas["Acme.Api.V1.Widget"]; !ok {
		t.Fatal("definitions not converted to components")
	}
}
```

- [ ] Step 3: Implement `config.go` (LoadConfig: yaml.Unmarshal; resolve `Spec`/`OutDir` relative to config dir; default `OutDir` = config dir; validate Package/Spec/BaseURL non-empty) and `load.go` (read file; `json.Unmarshal` into `map[string]any` to sniff `"swagger":"2.0"`; if 2.0: `openapi2.T` → `openapi2conv.ToV3`; else `openapi3.NewLoader().LoadFromData`).
- [ ] Step 4: `go test ./internal/genlib` — PASS. Commit: `feat: generator config and spec loading with swagger 2.0 conversion`.

---

### Task 6: genlib — IR builder

**Files:**
- Create: `internal/genlib/ir.go`, `internal/genlib/naming.go`, `internal/genlib/build.go`
- Test: `internal/genlib/build_test.go` (uses the Task 5 fixture)

**Interfaces (Produces):**

```go
// ir.go
type Field struct{ Name, Type, Tag, Doc string }
type Struct struct{ Name string; Fields []Field; Doc string }
type Alias struct{ Name, Target, Doc string }
type Operation struct {
	MethodName  string // e.g. GetWidgets
	Tag         string // spec tag → file grouping
	HTTPMethod  string // GET/POST/...
	Path        string // template incl. {version}
	Request     Struct // named MethodName+"Request"
	BodyExpr    string // "", "req", or "req.Body"
	HasOut      bool   // false for empty responses
	RespBodyLit string // canned JSON for generated round-trip test: "{}", "[]", or ""
	TestPath    string // expected expanded path with pinned + zero-value params
}
type IR struct {
	Package      string
	Models       []Struct
	Aliases      []Alias
	Ops          []Operation // sorted by Tag, then MethodName
	Tags         []string    // sorted unique
	UsesDateTime bool
	UsesConnectorImport bool // datetime_type references connector package
}
func Build(doc *openapi3.T, cfg *Config) (*IR, error)
```

Build rules (each rule implemented as a small helper; keep every func under complexity 20):

1. **Method name:** operationId with spaces/illegal chars removed, first letter upper. `cfg.Rename[operationId]` overrides. Duplicate method names → error listing duplicates.
2. **Definition Go names:** last dot-segment, sanitized to a Go identifier. On collision: definitions whose full name starts with any `cfg.PreferNamespaces` entry keep the bare name; every other collider walks namespace segments right-to-left, prepending sanitized segments until unique (e.g. `Acme.Common.Tag` → `CommonTag`). If still ambiguous → error. Names also must not collide with any `MethodName+"Request"/"Response"` — those win; the definition gets the namespace-prefix treatment.
3. **Type mapping** (`goType(schema)`): `string`→`*string`; `string format:date-time`→`*`+cfg.DateTimeType (default `time.Time`); `string format:byte`→`[]byte`; `integer format:int64`→`*int64`; other integer→`*int`; `number`→`*float64`; `boolean`→`*bool`; `array`→`[]T` (element type without pointer for struct refs? No — elements: `$ref`→bare struct name, scalars→bare scalar); `$ref`→`*Name`; `object` with `additionalProperties`→`map[string]T`; bare `object`/no type→`map[string]any`. Slices and maps are never pointers.
4. **Request struct:** fields ordered: path params, query params, header params, then body.
   - Path params: skip names in `cfg.PinnedPathParams`. Non-pointer `string`/`int64`/`int` (required by definition), tag `json:"-" path:"name"`.
   - Query params: skip nothing; strip `cfg.QueryPrefixStrip` from the wire name for the Go field name (capitalize first letter); pointer/slice typing per rule 3; tag `json:"-" query:"wire.name"`.
   - Header params: skip if lowercase name ∈ `cfg.SkipHeaders` (case-insensitive); else field with tag `json:"-" header:"name"`.
   - Body: object `$ref` → flatten each property into a field with tag `json:"PropName,omitempty"` (byte-slice/slice/map fields also omitempty), `BodyExpr = "req"`. Inline array body → single field `Body []Elem` with tag `json:"-"`, `BodyExpr = "req.Body"`. No body → `BodyExpr = ""`.
5. **Response:** first 2xx with schema. `$ref` → if def Go name == MethodName+"Response" it doubles as the response type; else emit `Alias{MethodName+"Response", defGoName}`. Inline `object` → `Alias{…, "map[string]any"}`. Inline array → `Alias{…, "[]"+elemType}`. No schema → `Struct{Name: MethodName+"Response"}` with no fields and `HasOut=false`. `RespBodyLit`: `"[]"` when the resolved response type is a slice, `""` when HasOut is false, else `"{}"`.
6. **Model reachability:** roots = every response `$ref` + every `$ref` reachable from body schemas' properties/items (the body's own top-level def is NOT a root — it's flattened). Traverse transitively over properties, items, additionalProperties. Only reachable defs become `Models` (fields per rule 3, tag `json:"PropName,omitempty"`). The fixture's `Acme.Api.V1.Unused` must be absent; `AddWidgetRequest` must be absent; `Widget`, `Tag`, `CommonTag`, `Pagination`, `GetWidgetsResponse` present.
7. **TestPath:** path template with pinned params substituted, remaining `{p}` replaced by the zero value of the param's Go type (`""` for string, `"0"` for ints).
8. `UsesDateTime` true iff any date-time field was emitted; `UsesConnectorImport` true iff `cfg.DateTimeType` contains `"connector."`.

- [ ] Step 1: Failing test `build_test.go`:

```go
package genlib

import (
	"strings"
	"testing"
)

func fixtureIR(t *testing.T) *IR {
	t.Helper()
	doc, err := LoadSpec("testdata/fixture-swagger.json")
	if err != nil {
		t.Fatal(err)
	}
	cfg := &Config{
		Package: "fixture", BaseURL: "https://x",
		DateTimeType:     "connector.DateTime",
		SkipHeaders:      []string{"authorization", "version", "siteId"},
		QueryPrefixStrip: "request.",
		PinnedPathParams: map[string]string{"version": "6"},
		PreferNamespaces: []string{"Acme.Api.V1"},
	}
	ir, err := Build(doc, cfg)
	if err != nil {
		t.Fatal(err)
	}
	return ir
}

func opByName(t *testing.T, ir *IR, name string) Operation {
	t.Helper()
	for _, op := range ir.Ops {
		if op.MethodName == name {
			return op
		}
	}
	t.Fatalf("operation %s not found in %v", name, len(ir.Ops))
	return Operation{}
}

func fieldByName(t *testing.T, s Struct, name string) Field {
	t.Helper()
	for _, f := range s.Fields {
		if f.Name == name {
			return f
		}
	}
	t.Fatalf("field %s not found in %s", name, s.Name)
	return Field{}
}

func TestBuildOperations(t *testing.T) {
	ir := fixtureIR(t)
	if len(ir.Ops) != 5 {
		t.Fatalf("want 5 ops, got %d", len(ir.Ops))
	}

	get := opByName(t, ir, "GetWidgets")
	if get.HTTPMethod != "GET" || get.BodyExpr != "" || !get.HasOut {
		t.Errorf("GetWidgets = %+v", get)
	}
	limit := fieldByName(t, get.Request, "Limit")
	if limit.Type != "*int" || !strings.Contains(limit.Tag, `query:"request.limit"`) {
		t.Errorf("Limit = %+v", limit)
	}
	ids := fieldByName(t, get.Request, "Ids")
	if ids.Type != "[]int64" {
		t.Errorf("Ids = %+v", ids)
	}
	start := fieldByName(t, get.Request, "StartDate")
	if start.Type != "*connector.DateTime" {
		t.Errorf("StartDate = %+v", start)
	}
	trace := fieldByName(t, get.Request, "XTrace")
	if !strings.Contains(trace.Tag, `header:"x-trace"`) {
		t.Errorf("XTrace = %+v", trace)
	}
	for _, f := range get.Request.Fields {
		if strings.Contains(f.Tag, "authorization") {
			t.Error("authorization header must be skipped")
		}
	}

	add := opByName(t, ir, "AddWidget") // space stripped from "Add Widget"
	if add.BodyExpr != "req" {
		t.Errorf("AddWidget.BodyExpr = %q", add.BodyExpr)
	}
	name := fieldByName(t, add.Request, "Name")
	if name.Type != "*string" || !strings.Contains(name.Tag, `json:"Name,omitempty"`) {
		t.Errorf("Name = %+v", name)
	}
	widget := fieldByName(t, add.Request, "Widget")
	if widget.Type != "*Widget" {
		t.Errorf("Widget = %+v", widget)
	}

	repl := opByName(t, ir, "ReplaceTags")
	if repl.BodyExpr != "req.Body" {
		t.Errorf("ReplaceTags.BodyExpr = %q", repl.BodyExpr)
	}
	body := fieldByName(t, repl.Request, "Body")
	if body.Type != "[]Tag" {
		t.Errorf("Body = %+v", body)
	}
	wid := fieldByName(t, repl.Request, "WidgetId")
	if wid.Type != "int64" || !strings.Contains(wid.Tag, `path:"widgetId"`) {
		t.Errorf("WidgetId = %+v", wid)
	}
	if repl.TestPath != "/public/v6/widget/0/tags" {
		t.Errorf("TestPath = %q", repl.TestPath)
	}

	del := opByName(t, ir, "DeleteCardType")
	if del.HasOut || del.RespBodyLit != "" {
		t.Errorf("DeleteCardType = %+v", del)
	}
	cards := opByName(t, ir, "GetCardTypes")
	if cards.RespBodyLit != "[]" {
		t.Errorf("GetCardTypes.RespBodyLit = %q", cards.RespBodyLit)
	}
}

func TestBuildModelsAndAliases(t *testing.T) {
	ir := fixtureIR(t)
	names := map[string]bool{}
	for _, m := range ir.Models {
		names[m.Name] = true
	}
	for _, want := range []string{"Widget", "Tag", "CommonTag", "Pagination", "GetWidgetsResponse"} {
		if !names[want] {
			t.Errorf("model %s missing (have %v)", want, names)
		}
	}
	for _, absent := range []string{"Unused", "AddWidgetRequest"} {
		if names[absent] {
			t.Errorf("model %s must not be generated", absent)
		}
	}
	aliases := map[string]string{}
	for _, a := range ir.Aliases {
		aliases[a.Name] = a.Target
	}
	if aliases["AddWidgetResponse"] != "Widget" {
		t.Errorf("AddWidgetResponse alias = %q", aliases["AddWidgetResponse"])
	}
	if aliases["ReplaceTagsResponse"] != "map[string]any" {
		t.Errorf("ReplaceTagsResponse alias = %q", aliases["ReplaceTagsResponse"])
	}
	if aliases["GetCardTypesResponse"] != "[]string" {
		t.Errorf("GetCardTypesResponse alias = %q", aliases["GetCardTypesResponse"])
	}
	if !ir.UsesDateTime {
		t.Error("UsesDateTime should be true")
	}
}
```

(Note: fixture needs `Acme.Api.V1.Pagination` definition added referenced from GetWidgetsResponse — include it when writing the fixture in Task 5.)

- [ ] Step 2: Run — FAIL. Implement `naming.go` (goIdent sanitize, exportName, defGoNames collision resolution), `ir.go` (types above), `build.go` (Build orchestrating per-op builders + reachability walker + model emission). Decompose: `buildOp`, `buildRequestFields`, `buildBody`, `buildResponse`, `collectRoots`, `walkSchemaRefs`, `buildModels`, `goType`, `testPath`.
- [ ] Step 3: `go test ./internal/genlib` — PASS. Commit: `feat: generator IR builder`.

---

### Task 7: genlib — rendering (templates + golden test)

**Files:**
- Create: `internal/genlib/render.go`, `internal/genlib/templates.go`
- Test: `internal/genlib/render_test.go`, goldens under `internal/genlib/testdata/golden/`

**Interfaces (Produces):**

```go
// Render produces the generated files, keyed by file name:
// types_gen.go, <lowertag>_gen.go per tag, roundtrip_gen_test.go.
// Output is gofmt-formatted (go/format.Source); formatting errors include
// the offending source for debugging.
func Render(ir *IR, cfg *Config) (map[string][]byte, error)
```

Template contracts (in `templates.go` as consts, rendered with `text/template`):

- Every file starts with:

```go
// Code generated by connector-gen. DO NOT EDIT.

package {{.Package}}
```

- `types_gen.go`: imports (`time` if UsesDateTime && !UsesConnectorImport; `github.com/pax-beehive/connector` if UsesConnectorImport); each Struct as `type Name struct{…}` with fields `Name Type \`Tag\``; each Alias as `type Name = Target`.
- `<tag>_gen.go` (per tag, ops filtered): imports `context`, `github.com/pax-beehive/connector` (+ `time`/nothing per request field usage — simplest: tag files always import context+connector; request structs live here too). Per op:

```go
// {{.MethodName}}Request holds parameters for {{.MethodName}}.
type {{.MethodName}}Request struct {
	…fields…
}

// {{.MethodName}} calls {{.HTTPMethod}} {{.Path}}.
func (c *Client) {{.MethodName}}(ctx context.Context, req *{{.MethodName}}Request) (*{{.MethodName}}Response, error) {
	out := &{{.MethodName}}Response{}
	err := c.core.Do(ctx, &connector.Call{
		Method: "{{.HTTPMethod}}",
		Path:   "{{.Path}}",
		Req:    req,
		{{- if .BodyExpr}}
		Body:   {{.BodyExpr}},
		{{- end}}
		{{- if .HasOut}}
		Out:    out,
		{{- end}}
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}
```

- `roundtrip_gen_test.go` (package `{{.Package}}`, file IS generated): a stub `httptest` server that records method/path and writes the per-op canned body (`RespBodyLit`, empty → 204); table with one entry per op:

```go
{
	name:   "{{.MethodName}}",
	method: "{{.HTTPMethod}}",
	path:   "{{.TestPath}}",
	resp:   {{printf "%q" .RespBodyLit}},
	invoke: func(ctx context.Context, c *Client) (any, error) {
		return c.{{.MethodName}}(ctx, &{{.MethodName}}Request{})
	},
},
```

The test body (also part of the template): for each entry, set server's next response, call invoke, assert err nil, result non-nil, recorded method+path match. Client built with `NewClient(&Config{APIKey: "k", SiteID: "-99", BaseURL: srv.URL})`. NOTE: this template hardcodes the `NewClient(&Config{APIKey…})` contract — acceptable for now (documented in the template comment); a future connector with a different constructor signature would extend the config with a test-constructor override.

- [ ] Step 1: Failing golden test `render_test.go`:

```go
package genlib

import (
	"flag"
	"os"
	"path/filepath"
	"testing"
)

var update = flag.Bool("update", false, "rewrite golden files")

func TestRenderGolden(t *testing.T) {
	ir := fixtureIR(t)
	cfg := &Config{Package: "fixture", BaseURL: "https://x", DateTimeType: "connector.DateTime"}
	files, err := Render(ir, cfg)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"types_gen.go", "widget_gen.go", "misc_gen.go", "roundtrip_gen_test.go"} {
		if _, ok := files[want]; !ok {
			t.Errorf("missing file %s", want)
		}
	}
	for name, got := range files {
		golden := filepath.Join("testdata", "golden", name+".golden")
		if *update {
			if err := os.WriteFile(golden, got, 0o644); err != nil {
				t.Fatal(err)
			}
			continue
		}
		want, err := os.ReadFile(golden)
		if err != nil {
			t.Fatalf("%s: %v (run with -update to create)", name, err)
		}
		if string(want) != string(got) {
			t.Errorf("%s differs from golden; run with -update and inspect diff", name)
		}
	}
}
```

- [ ] Step 2: Implement `templates.go` + `render.go` (execute templates per file, `format.Source` each, return map). Run with `-update`, inspect goldens by eye (imports, tags, method bodies), then run without `-update` — PASS.
- [ ] Step 3: Sanity-compile the fixture output: not required as its own package (golden inspection + Mindbody compile in Task 8 covers it).
- [ ] Step 4: Commit: `feat: generator rendering with golden tests`.

---

### Task 8: CLI, Mindbody generation, compile + round-trip green

**Files:**
- Create: `cmd/connector-gen/main.go`, `internal/genlib/run.go`, `mindbody/gen.go`, `mindbody/gen.yaml`, `mindbody/spec/swagger.json` (snapshot), generated `mindbody/*_gen.go` + `mindbody/roundtrip_gen_test.go`

**Interfaces:**
- Consumes: `genlib.LoadConfig/LoadSpec/Build/Render`.
- Produces: `genlib.Run(configPath string) error` (load→build→render→write files into cfg.OutDir); `connector-gen -config <path>` CLI.

- [ ] Step 1: `internal/genlib/run.go`:

```go
package genlib

import "os"

// Run executes the full generation pipeline for one connector config.
func Run(configPath string) error {
	cfg, err := LoadConfig(configPath)
	if err != nil {
		return err
	}
	doc, err := LoadSpec(cfg.Spec)
	if err != nil {
		return err
	}
	ir, err := Build(doc, cfg)
	if err != nil {
		return err
	}
	files, err := Render(ir, cfg)
	if err != nil {
		return err
	}
	for name, data := range files {
		if err := os.WriteFile(filepath.Join(cfg.OutDir, name), data, 0o644); err != nil {
			return err
		}
	}
	return nil
}
```

Add a small `run_test.go`: run against the fixture into a temp dir, assert files exist.

- [ ] Step 2: `cmd/connector-gen/main.go`:

```go
// Command connector-gen generates a connector package from an OpenAPI spec
// and a per-connector gen.yaml.
package main

import (
	"flag"
	"fmt"
	"os"

	"github.com/pax-beehive/connector/internal/genlib"
)

func main() {
	config := flag.String("config", "gen.yaml", "path to generator config")
	flag.Parse()
	if err := genlib.Run(*config); err != nil {
		fmt.Fprintln(os.Stderr, "connector-gen:", err)
		os.Exit(1)
	}
}
```

- [ ] Step 3: Snapshot the spec: copy the downloaded `mindbody-swagger.json` to `mindbody/spec/swagger.json`. Write `mindbody/gen.yaml`:

```yaml
package: mindbody
spec: spec/swagger.json
out_dir: .
base_url: https://api.mindbodyonline.com
datetime_type: connector.DateTime
skip_headers: [authorization, version, siteId]
query_prefix_strip: "request."
pinned_path_params: {version: "6"}
prefer_namespaces: ["Mindbody.PublicApi.Dto.Models.V6"]
rename: {}
```

`mindbody/gen.go`:

```go
package mindbody

//go:generate go run github.com/pax-beehive/connector/cmd/connector-gen -config gen.yaml
```

- [ ] Step 4: `go generate ./mindbody && go build ./...`. Expect iteration: duplicate operationIds (add `rename:` entries), unexpected schema shapes, name collisions with request/response structs. Fix by improving genlib rules (with a regression case added to the fixture when the rule is generic) or via config. Repeat until `go build ./...` is clean.
- [ ] Step 5: `go test ./mindbody` — the generated `roundtrip_gen_test.go` (150 entries) must pass: every op hits the stub with the right method + expanded path and decodes its canned response.
- [ ] Step 6: `go vet ./...` clean. Commit: `feat: generated mindbody connector (150 ops) + connector-gen CLI` (includes spec snapshot + generated code).

---

### Task 9: Quality gates (Makefile: gen/lint/test/cover) + README

**Files:**
- Create: `Makefile`, `README.md`

- [ ] Step 1: `Makefile`:

```make
GOCYCLO := go run github.com/fzipp/gocyclo/cmd/gocyclo@v0.6.0

.PHONY: gen lint test cover

gen:
	go generate ./...

lint:
	go vet ./...
	$(GOCYCLO) -over 19 -ignore "_test|_gen" .
	$(GOCYCLO) -over 19 mindbody internal cmd connector.go core.go params.go datetime.go errors.go

test:
	go test ./...

cover:
	go test ./... -coverprofile=coverage.out
	@go tool cover -func=coverage.out | tail -1
	@go tool cover -func=coverage.out | tail -1 | awk '{gsub(/%/,"",$$3); if ($$3+0 < 80.0) {print "coverage " $$3 "% is below 80%"; exit 1}}'
```

(Adjust the lint invocation while implementing so generated files are ALSO checked — the complexity rule applies to them too; they should pass trivially. Simplest correct form: `$(GOCYCLO) -over 19 .` — keep tests included; the constraint is "every func". If gocyclo v0.6.0 flags differ, fix to whatever the tool actually supports; verify by running.)

- [ ] Step 2: Run `make lint` — fix any function over 19 (split it).
- [ ] Step 3: Run `make cover` — must print total ≥80% and exit 0. If below: the biggest uncovered chunks will be genlib error paths and `cmd/connector-gen`; add focused unit tests (e.g. malformed config/spec cases in genlib) until the gate passes.
- [ ] Step 4: `README.md` — short: what the library is, install, Mindbody usage example (NewClient + GetClasses with `connector.Ptr`), how to regenerate (`make gen`), how to add a new connector (spec + gen.yaml + handwritten auth layer), quality gates.
- [ ] Step 5: Full check: `make gen && git diff --exit-code mindbody` (generation is reproducible/committed), `make lint test cover`. Commit: `chore: quality gates (gocyclo<20, coverage>=80%) and README`.

---

### Task 10: Final verification + code review

- [ ] Step 1: Run the superpowers:verification-before-completion flow: `make lint && make cover`, `go build ./...`, confirm outputs.
- [ ] Step 2: Run superpowers:requesting-code-review / `/code-review` on the branch; fix confirmed findings.
- [ ] Step 3: Final commit.
