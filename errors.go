package connector

import (
	"fmt"
	"time"
)

// APIError is returned for any non-2xx response. Use the package-level
// classifiers (IsRateLimited, IsUnauthorized, IsNotFound, IsRetryable, ...)
// to branch on it without unwrapping.
type APIError struct {
	StatusCode int
	Code       string // service-specific error code, if parseable
	Message    string // service-specific error message, if parseable
	Body       []byte // raw response body
	// RetryAfter is the server's Retry-After hint (0 when absent), typical
	// on 429 responses.
	RetryAfter time.Duration
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
