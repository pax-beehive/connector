package connector

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
)

// ActionIdempotency describes how the gateway may safely retry an action.
type ActionIdempotency string

const (
	ActionSafe        ActionIdempotency = "safe"
	ActionIdempotent  ActionIdempotency = "idempotent"
	ActionProviderKey ActionIdempotency = "provider-key"
	ActionUnsafe      ActionIdempotency = "unsafe"
)

// ActionDescriptor is one generated action exposed by a connector client.
type ActionDescriptor struct {
	Provider      string            `json:"provider"`
	Method        string            `json:"method"`
	HTTPMethod    string            `json:"http_method"`
	RequestType   string            `json:"request_type"`
	ResponseType  string            `json:"response_type"`
	RequiredScope string            `json:"required_scope"`
	Idempotency   ActionIdempotency `json:"idempotency"`
}

// ActionCall identifies an allowlisted connector action and its JSON request.
type ActionCall struct {
	Provider string          `json:"provider"`
	Method   string          `json:"method"`
	Request  json.RawMessage `json:"request"`
}

// ActionInvoker is implemented by every generated connector client.
type ActionInvoker interface {
	InvokeAction(context.Context, ActionCall) (json.RawMessage, error)
}

// UnknownProviderError reports a call routed to the wrong connector client.
type UnknownProviderError struct {
	Provider string
}

func (e *UnknownProviderError) Error() string {
	return fmt.Sprintf("unknown connector provider %q", e.Provider)
}

// UnknownActionError reports a method absent from a provider's action manifest.
type UnknownActionError struct {
	Provider string
	Method   string
}

func (e *UnknownActionError) Error() string {
	return fmt.Sprintf("unknown connector action %s.%s", e.Provider, e.Method)
}

// InvalidActionRequestError reports JSON that cannot decode into an action request.
type InvalidActionRequestError struct {
	Provider string
	Method   string
	Err      error
}

func (e *InvalidActionRequestError) Error() string {
	return fmt.Sprintf("invalid request for connector action %s.%s: %v", e.Provider, e.Method, e.Err)
}

func (e *InvalidActionRequestError) Unwrap() error {
	return e.Err
}

// DecodeActionRequest strictly decodes exactly one JSON object into target.
func DecodeActionRequest(provider, method string, input json.RawMessage, target any) error {
	if len(bytes.TrimSpace(input)) == 0 {
		input = json.RawMessage(`{}`)
	}
	decoder := json.NewDecoder(bytes.NewReader(input))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return &InvalidActionRequestError{Provider: provider, Method: method, Err: err}
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		if err == nil {
			err = fmt.Errorf("request must contain one JSON value")
		}
		return &InvalidActionRequestError{Provider: provider, Method: method, Err: err}
	}
	return nil
}
