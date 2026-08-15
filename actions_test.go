package connector

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

type actionRequestFixture struct {
	Name string `json:"name"`
}

func TestDecodeActionRequest(t *testing.T) {
	tests := []struct {
		name    string
		input   json.RawMessage
		want    string
		wantErr string
	}{
		{name: "valid", input: json.RawMessage(`{"name":"Ada"}`), want: "Ada"},
		{name: "empty", input: nil},
		{name: "malformed", input: json.RawMessage(`{"name":`), wantErr: "unexpected EOF"},
		{name: "unknown field", input: json.RawMessage(`{"extra":true}`), wantErr: "unknown field"},
		{name: "trailing value", input: json.RawMessage(`{} {}`), wantErr: "one JSON value"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			var got actionRequestFixture
			err := DecodeActionRequest("fixture", "Create", tc.input, &got)
			if tc.wantErr == "" {
				if err != nil {
					t.Fatal(err)
				}
				if got.Name != tc.want {
					t.Fatalf("Name = %q, want %q", got.Name, tc.want)
				}
				return
			}
			if err == nil || !strings.Contains(err.Error(), tc.wantErr) {
				t.Fatalf("error = %v, want substring %q", err, tc.wantErr)
			}
			var invalid *InvalidActionRequestError
			if !errors.As(err, &invalid) {
				t.Fatalf("error type = %T, want *InvalidActionRequestError", err)
			}
			if invalid.Provider != "fixture" || invalid.Method != "Create" {
				t.Fatalf("invalid action context = %+v", invalid)
			}
		})
	}
}

func TestActionLookupErrors(t *testing.T) {
	providerErr := &UnknownProviderError{Provider: "missing"}
	if got := providerErr.Error(); !strings.Contains(got, "missing") {
		t.Fatalf("provider error = %q", got)
	}

	actionErr := &UnknownActionError{Provider: "fixture", Method: "Missing"}
	if got := actionErr.Error(); !strings.Contains(got, "fixture.Missing") {
		t.Fatalf("action error = %q", got)
	}
}

type actionInvokerFixture struct{}

func (actionInvokerFixture) InvokeAction(context.Context, ActionCall) (json.RawMessage, error) {
	return json.RawMessage(`{}`), nil
}

func TestActionInvokerContract(t *testing.T) {
	var invoker ActionInvoker = actionInvokerFixture{}
	out, err := invoker.InvokeAction(context.Background(), ActionCall{Provider: "fixture", Method: "Get"})
	if err != nil {
		t.Fatal(err)
	}
	if !json.Valid(out) {
		t.Fatalf("invalid JSON response: %s", out)
	}
}
