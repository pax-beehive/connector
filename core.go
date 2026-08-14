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
		req.Header.Del(k)
		for _, v := range vs {
			req.Header.Add(k, v)
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
	if strings.IndexByte(path, '{') >= 0 {
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
