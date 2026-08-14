package connector

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

func retryCore(srv *httptest.Server, p RetryPolicy) *Core {
	core := &Core{BaseURL: srv.URL}
	core.Apply(WithRetry(p))
	return core
}

func fastRetry() RetryPolicy {
	return RetryPolicy{MaxAttempts: 3, MinBackoff: time.Millisecond, MaxBackoff: 5 * time.Millisecond}
}

func TestRetryOn429ThenSuccess(t *testing.T) {
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if calls.Add(1) < 3 {
			w.WriteHeader(429)
			return
		}
		_, _ = w.Write([]byte(`{}`))
	}))
	defer srv.Close()
	core := retryCore(srv, fastRetry())
	if err := core.Do(context.Background(), &Call{Method: "GET", Path: "/x"}); err != nil {
		t.Fatal(err)
	}
	if calls.Load() != 3 {
		t.Errorf("calls = %d, want 3", calls.Load())
	}
}

func TestRetryExhaustedReturnsAPIError(t *testing.T) {
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		w.WriteHeader(503)
	}))
	defer srv.Close()
	core := retryCore(srv, fastRetry())
	err := core.Do(context.Background(), &Call{Method: "GET", Path: "/x"})
	if !IsRetryable(err) || StatusCode(err) != 503 {
		t.Fatalf("want retryable 503, got %v", err)
	}
	if calls.Load() != 3 {
		t.Errorf("calls = %d, want 3 (MaxAttempts)", calls.Load())
	}
}

func TestNoRetryWithoutPolicy(t *testing.T) {
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		w.WriteHeader(429)
	}))
	defer srv.Close()
	core := &Core{BaseURL: srv.URL}
	if err := core.Do(context.Background(), &Call{Method: "GET", Path: "/x"}); err == nil {
		t.Fatal("expected error")
	}
	if calls.Load() != 1 {
		t.Errorf("calls = %d, want 1", calls.Load())
	}
}

func TestPostNotRetriedOn503ByDefault(t *testing.T) {
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		w.WriteHeader(503)
	}))
	defer srv.Close()
	core := retryCore(srv, fastRetry())
	if err := core.Do(context.Background(), &Call{Method: "POST", Path: "/x"}); err == nil {
		t.Fatal("expected error")
	}
	if calls.Load() != 1 {
		t.Errorf("POST on 503: calls = %d, want 1 (not idempotent)", calls.Load())
	}
}

func TestPostRetriedOn429(t *testing.T) {
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if calls.Add(1) == 1 {
			w.WriteHeader(429)
			return
		}
		_, _ = w.Write([]byte(`{}`))
	}))
	defer srv.Close()
	core := retryCore(srv, fastRetry())
	if err := core.Do(context.Background(), &Call{Method: "POST", Path: "/x"}); err != nil {
		t.Fatal(err)
	}
	if calls.Load() != 2 {
		t.Errorf("calls = %d, want 2", calls.Load())
	}
}

func TestPostRetriedOn503WhenNonIdempotentAllowed(t *testing.T) {
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if calls.Add(1) == 1 {
			w.WriteHeader(503)
			return
		}
		_, _ = w.Write([]byte(`{}`))
	}))
	defer srv.Close()
	p := fastRetry()
	p.RetryNonIdempotent = true
	core := retryCore(srv, p)
	if err := core.Do(context.Background(), &Call{Method: "POST", Path: "/x"}); err != nil {
		t.Fatal(err)
	}
	if calls.Load() != 2 {
		t.Errorf("calls = %d, want 2", calls.Load())
	}
}

func TestRetryHonorsRetryAfterSeconds(t *testing.T) {
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if calls.Add(1) == 1 {
			w.Header().Set("Retry-After", "1")
			w.WriteHeader(429)
			return
		}
		_, _ = w.Write([]byte(`{}`))
	}))
	defer srv.Close()
	p := fastRetry()
	p.MaxBackoff = 50 * time.Millisecond // caps the 1s Retry-After
	core := retryCore(srv, p)
	start := time.Now()
	if err := core.Do(context.Background(), &Call{Method: "GET", Path: "/x"}); err != nil {
		t.Fatal(err)
	}
	if elapsed := time.Since(start); elapsed < 40*time.Millisecond {
		t.Errorf("elapsed %v: Retry-After (capped at MaxBackoff) not honored", elapsed)
	}
}

func TestRetryTransportError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	srv.Close() // immediately: all connections refused
	core := retryCore(srv, fastRetry())
	err := core.Do(context.Background(), &Call{Method: "GET", Path: "/x"})
	if err == nil {
		t.Fatal("expected transport error after retries")
	}
}

func TestRetryRespectsContextCancel(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Retry-After", "5")
		w.WriteHeader(429)
	}))
	defer srv.Close()
	p := fastRetry()
	p.MaxBackoff = 10 * time.Second
	core := retryCore(srv, p)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Millisecond)
	defer cancel()
	start := time.Now()
	err := core.Do(ctx, &Call{Method: "GET", Path: "/x"})
	if err == nil {
		t.Fatal("expected context error")
	}
	if time.Since(start) > time.Second {
		t.Fatal("cancel not respected during backoff sleep")
	}
}

func TestWithTimeout(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(200 * time.Millisecond)
		_, _ = w.Write([]byte(`{}`))
	}))
	defer srv.Close()
	core := &Core{BaseURL: srv.URL}
	core.Apply(WithTimeout(20 * time.Millisecond))
	if err := core.Do(context.Background(), &Call{Method: "GET", Path: "/x"}); err == nil {
		t.Fatal("expected deadline error")
	}
}

func TestWithHTTPClient(t *testing.T) {
	used := false
	hc := &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		used = true
		return nil, http.ErrUseLastResponse
	})}
	core := &Core{BaseURL: "http://example.invalid"}
	core.Apply(WithHTTPClient(hc))
	_ = core.Do(context.Background(), &Call{Method: "GET", Path: "/x"})
	if !used {
		t.Fatal("custom http client not used")
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
