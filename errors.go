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
