# Quality Gates

`make quality` is the blocking local and CI entry point. A change is not ready
to merge until it passes without exceptions.

## Automated rules

- Aggregate Go statement coverage must be at least 80%. Coverage runs with
  `-count=1` so a cached result cannot satisfy the gate.
- Every function, method, and function literal must have cyclomatic complexity
  no greater than 20.
- Every Go file must be formatted by `gofmt`.
- `go vet ./...` and `go test -race ./...` must pass.
- Source-bearing files and source comments must not contain Chinese characters
  or emoji. The scanner covers the repository's Go, web, shell, SQL, Proto,
  configuration, infrastructure, and common systems-language extensions.
  Prose documents and vendored upstream specification JSON are outside this
  rule.
- Generated source is subject to the same formatting, language, complexity,
  test, and coverage rules as handwritten source.
- Project imports must preserve the repository module structure:
  - The root `connector` package is the shared runtime and does not import
    provider or command packages.
  - A provider package may import the root runtime and itself, but never
    another provider or an internal implementation package.
  - An internal package may import the root runtime and other internal
    packages, but never a provider package.
  - A command may import the root runtime and internal packages, but never a
    provider package directly.

The quality checker uses only the Go standard library. It does not download a
lint executable at runtime, so the local gate and CI enforce the same rules.

## Module review checklist

Automated import rules prevent obvious coupling, but module quality still
requires review. For every new or materially changed module:

- Name its interface and list every invariant, ordering constraint, error
  mode, required configuration, and performance fact callers must know.
- Keep the interface smaller than the behavior it hides. If deleting the
  module would not move meaningful complexity into callers, deepen or remove
  it.
- Put a seam where behavior actually varies. A production adapter plus a test
  adapter is a real seam; one implementation behind an interface is usually
  hypothetical indirection.
- Keep internal seams private. Do not export constructors, repositories, or
  transport details only to make tests convenient.
- Accept true external dependencies and return observable results. Do not
  create network clients, credential stores, or clocks inside business logic.
- Test through the same interface callers use. Prefer a real local substitute
  for local infrastructure and a mock adapter only for true external systems.
- Keep provider-specific authentication, request mapping, and error parsing in
  the provider package. Cross-provider policy belongs in the root runtime only
  when at least two providers share the behavior.

## Generated-code verification

CI runs `make gen` after `make quality` and fails if generation changes the
working tree. A generator change must therefore update its generated output
and tests in the same commit.
