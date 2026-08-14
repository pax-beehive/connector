package connector

import (
	"net/http"
	"time"
)

// Option configures cross-cutting client mechanics (timeout, retry, HTTP
// transport). Every connector's NewClient accepts a trailing ...Option.
type Option func(*Core)

// Apply applies options to the core. Connector NewClient implementations
// call this on each Core they build.
func (c *Core) Apply(opts ...Option) {
	for _, opt := range opts {
		opt(c)
	}
}

// WithTimeout sets an overall per-call deadline covering every retry
// attempt of a single operation call.
func WithTimeout(d time.Duration) Option {
	return func(c *Core) { c.Timeout = d }
}

// WithHTTPClient replaces the underlying *http.Client.
func WithHTTPClient(hc *http.Client) Option {
	return func(c *Core) { c.HTTPClient = hc }
}

// WithRetry enables automatic retries with the given policy. Zero fields
// take defaults; see RetryPolicy.
func WithRetry(p RetryPolicy) Option {
	return func(c *Core) {
		filled := p.withDefaults()
		c.Retry = &filled
	}
}
