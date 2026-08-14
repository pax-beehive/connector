package connector

import (
	"errors"
	"fmt"
	"testing"
	"time"
)

func TestErrorClassifiers(t *testing.T) {
	cases := []struct {
		status  int
		check   func(error) bool
		name    string
		matches bool
	}{
		{429, IsRateLimited, "IsRateLimited", true},
		{401, IsRateLimited, "IsRateLimited", false},
		{401, IsUnauthorized, "IsUnauthorized", true},
		{403, IsForbidden, "IsForbidden", true},
		{404, IsNotFound, "IsNotFound", true},
		{500, IsServerError, "IsServerError", true},
		{503, IsServerError, "IsServerError", true},
		{400, IsServerError, "IsServerError", false},
		{429, IsRetryable, "IsRetryable", true},
		{503, IsRetryable, "IsRetryable", true},
		{400, IsRetryable, "IsRetryable", false},
	}
	for _, c := range cases {
		err := error(&APIError{StatusCode: c.status})
		if got := c.check(err); got != c.matches {
			t.Errorf("%s(%d) = %v, want %v", c.name, c.status, got, c.matches)
		}
	}
}

func TestClassifiersUnwrap(t *testing.T) {
	wrapped := fmt.Errorf("call failed: %w", &APIError{StatusCode: 429, RetryAfter: 2 * time.Second})
	if !IsRateLimited(wrapped) {
		t.Error("wrapped APIError not classified")
	}
	if StatusCode(wrapped) != 429 {
		t.Errorf("StatusCode = %d", StatusCode(wrapped))
	}
	apiErr, ok := AsAPIError(wrapped)
	if !ok || apiErr.RetryAfter != 2*time.Second {
		t.Errorf("AsAPIError = %+v, %v", apiErr, ok)
	}
	if IsRateLimited(errors.New("plain")) || StatusCode(nil) != 0 {
		t.Error("non-API errors must not classify")
	}
}
