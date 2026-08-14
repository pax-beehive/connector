// Package connector provides the shared runtime for per-service API
// connectors: request building, tagged-parameter encoding, auth hooks,
// and error decoding.
package connector

// Ptr returns a pointer to v. Use it for optional request fields.
func Ptr[T any](v T) *T { return &v }
