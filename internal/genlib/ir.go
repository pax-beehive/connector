package genlib

// Field is one generated struct field.
type Field struct {
	Name string
	Type string
	Tag  string // full struct tag, without backticks
}

// Struct is a generated struct type.
type Struct struct {
	Name   string
	Doc    string
	Fields []Field
}

// Alias is a generated type alias (type Name = Target).
type Alias struct {
	Name   string
	Target string
}

// Operation is one generated API method.
type Operation struct {
	MethodName string // e.g. GetWidgets
	Tag        string // spec tag, used for file grouping
	HTTPMethod string // GET/POST/...
	Path       string // path template including {version}
	Request    Struct // named MethodName+"Request"
	BodyExpr   string // "", "req", or "req.Body"
	RespAlias  string // alias target when the response type is not a model named MethodName+"Response"
	RespEmpty  bool   // true → emit empty response struct, no decoding
	HasOut     bool   // false when the response has no schema
	// RespBodyLit is the canned JSON body used by the generated
	// round-trip test: "{}", "[]", or "" (no body / 204).
	RespBodyLit string
	// TestPath is the expected expanded path with pinned params applied and
	// remaining path params replaced by their zero values.
	TestPath string
}

// IR is everything the renderer needs.
type IR struct {
	Package string
	Models  []Struct    // sorted by name
	Aliases []Alias     // response aliases, sorted by name
	Ops     []Operation // sorted by (Tag, MethodName)
	Tags    []string    // sorted unique tags
}
