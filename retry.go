package connector

import (
	"context"
	"net/http"
	"strconv"
	"time"
)

// RetryPolicy controls automatic retries (opt-in via WithRetry).
//
// Transport-level errors are always retried under an active policy. HTTP
// responses are retried when the status is in Statuses — but for
// non-idempotent methods (POST/PATCH) only 429 is retried unless
// RetryNonIdempotent is set, because a 5xx may mean the server already
// processed the request.
type RetryPolicy struct {
	MaxAttempts int           // total attempts including the first; default 3
	MinBackoff  time.Duration // first backoff; doubles per attempt; default 500ms
	MaxBackoff  time.Duration // backoff cap, also caps honored Retry-After; default 10s
	Statuses    []int         // retryable statuses; default 429, 502, 503, 504
	// RetryNonIdempotent also retries POST/PATCH on every status in
	// Statuses instead of only 429.
	RetryNonIdempotent bool
}

func (p RetryPolicy) withDefaults() RetryPolicy {
	if p.MaxAttempts <= 0 {
		p.MaxAttempts = 3
	}
	if p.MinBackoff <= 0 {
		p.MinBackoff = 500 * time.Millisecond
	}
	if p.MaxBackoff <= 0 {
		p.MaxBackoff = 10 * time.Second
	}
	if len(p.Statuses) == 0 {
		p.Statuses = []int{http.StatusTooManyRequests, http.StatusBadGateway, http.StatusServiceUnavailable, http.StatusGatewayTimeout}
	}
	return p
}

func (p *RetryPolicy) shouldRetry(method string, status int) bool {
	found := false
	for _, s := range p.Statuses {
		if s == status {
			found = true
		}
	}
	if !found {
		return false
	}
	if idempotentMethod(method) || p.RetryNonIdempotent {
		return true
	}
	return status == http.StatusTooManyRequests
}

func idempotentMethod(m string) bool {
	switch m {
	case http.MethodGet, http.MethodHead, http.MethodPut, http.MethodDelete, http.MethodOptions:
		return true
	}
	return false
}

// backoff returns the wait before the next attempt: the response's
// Retry-After when present (capped at MaxBackoff), else exponential.
func (p *RetryPolicy) backoff(attempt int, header http.Header) time.Duration {
	if ra := parseRetryAfter(header); ra > 0 {
		if ra > p.MaxBackoff {
			return p.MaxBackoff
		}
		return ra
	}
	d := p.MinBackoff << attempt
	if d > p.MaxBackoff || d <= 0 {
		return p.MaxBackoff
	}
	return d
}

// parseRetryAfter reads a Retry-After header given as delay-seconds or as
// an HTTP date. Returns 0 when absent or unparseable.
func parseRetryAfter(header http.Header) time.Duration {
	v := header.Get("Retry-After")
	if v == "" {
		return 0
	}
	if secs, err := strconv.Atoi(v); err == nil && secs > 0 {
		return time.Duration(secs) * time.Second
	}
	if at, err := http.ParseTime(v); err == nil {
		if d := time.Until(at); d > 0 {
			return d
		}
	}
	return 0
}

// sleepCtx waits d or until the context is done, whichever comes first.
func sleepCtx(ctx context.Context, d time.Duration) error {
	timer := time.NewTimer(d)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}
