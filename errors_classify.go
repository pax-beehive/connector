package connector

import (
	"errors"
	"net/http"
)

// AsAPIError unwraps err into an *APIError if there is one in the chain.
func AsAPIError(err error) (*APIError, bool) {
	var apiErr *APIError
	if errors.As(err, &apiErr) {
		return apiErr, true
	}
	return nil, false
}

// StatusCode returns the HTTP status of the *APIError in err's chain, or 0.
func StatusCode(err error) int {
	if apiErr, ok := AsAPIError(err); ok {
		return apiErr.StatusCode
	}
	return 0
}

// IsRateLimited reports whether err is an API error with status 429.
func IsRateLimited(err error) bool { return StatusCode(err) == http.StatusTooManyRequests }

// IsUnauthorized reports whether err is an API error with status 401
// (typically an invalid or expired credential/token).
func IsUnauthorized(err error) bool { return StatusCode(err) == http.StatusUnauthorized }

// IsForbidden reports whether err is an API error with status 403.
func IsForbidden(err error) bool { return StatusCode(err) == http.StatusForbidden }

// IsNotFound reports whether err is an API error with status 404.
func IsNotFound(err error) bool { return StatusCode(err) == http.StatusNotFound }

// IsServerError reports whether err is an API error with a 5xx status.
func IsServerError(err error) bool { return StatusCode(err) >= 500 }

// IsRetryable reports whether err is an API error with a status that is
// safe to retry after a backoff: 429, 502, 503, or 504.
func IsRetryable(err error) bool {
	switch StatusCode(err) {
	case http.StatusTooManyRequests, http.StatusBadGateway, http.StatusServiceUnavailable, http.StatusGatewayTimeout:
		return true
	}
	return false
}
