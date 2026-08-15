package genlib

import (
	"fmt"
	"sort"
	"strings"

	"github.com/getkin/kin-openapi/openapi3"
)

const jsonMIME = "application/json"

// builder carries shared state while translating a spec into the IR.
type builder struct {
	doc      *openapi3.T
	cfg      *Config
	names    map[string]string // definition full name → Go type name
	ir       *IR
	reach    map[string]bool // reachable definition full names
	typeSeen map[string]string
}

// Build translates a loaded OpenAPI 3 document into the renderer IR.
func Build(doc *openapi3.T, cfg *Config) (*IR, error) {
	b := &builder{doc: doc, cfg: cfg, ir: &IR{Package: cfg.Package}, reach: map[string]bool{}, typeSeen: map[string]string{}}
	b.ir.TestNewClient = cfg.TestNewClient
	if b.ir.TestNewClient == "" {
		b.ir.TestNewClient = "NewClient(&Config{BaseURL: srv.URL})"
	}
	ops, err := b.collectRawOps()
	if err != nil {
		return nil, err
	}
	forbidden := map[string]bool{}
	for _, op := range ops {
		forbidden[op.methodName+"Request"] = true
	}
	if b.names, err = defGoNames(b.schemaNames(), cfg, forbidden); err != nil {
		return nil, err
	}
	for _, raw := range ops {
		if err := b.buildOp(raw); err != nil {
			return nil, err
		}
	}
	if err := b.buildModels(); err != nil {
		return nil, err
	}
	b.finish()
	if err := b.checkTypeNames(); err != nil {
		return nil, err
	}
	return b.ir, nil
}

// testPath expands the path template with pinned params and zero values for
// the remaining path params, for use in generated round-trip tests.
func (b *builder) testPath(raw rawOp) string {
	path := raw.path
	for name, value := range b.cfg.PinnedPathParams {
		path = strings.ReplaceAll(path, "{"+name+"}", value)
	}
	for _, pref := range raw.op.Parameters {
		p := pref.Value
		if p.In != "path" {
			continue
		}
		zero := ""
		if typeOf(schemaValue(p.Schema)) == "integer" {
			zero = "0"
		}
		path = strings.ReplaceAll(path, "{"+p.Name+"}", zero)
	}
	return path
}

func schemaValue(ref *openapi3.SchemaRef) *openapi3.Schema {
	if ref == nil {
		return nil
	}
	return ref.Value
}

type rawOp struct {
	methodName string
	httpMethod string
	path       string
	op         *openapi3.Operation
}

func (b *builder) collectRawOps() ([]rawOp, error) {
	var ops []rawOp
	seen := map[string]string{}
	for path, item := range b.doc.Paths.Map() {
		for httpMethod, op := range item.Operations() {
			name := methodName(httpMethod, path, op.OperationID, b.cfg)
			if prev, ok := seen[name]; ok {
				return nil, fmt.Errorf("genlib: duplicate method name %q (operationIds %q and %q); disambiguate via rename config", name, prev, op.OperationID)
			}
			seen[name] = op.OperationID
			ops = append(ops, rawOp{methodName: name, httpMethod: httpMethod, path: path, op: op})
		}
	}
	sort.Slice(ops, func(i, j int) bool { return ops[i].methodName < ops[j].methodName })
	return ops, nil
}

func (b *builder) schemaNames() []string {
	if b.doc.Components == nil {
		return nil
	}
	var names []string
	for name := range b.doc.Components.Schemas {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}

func (b *builder) schemaFor(full string) *openapi3.SchemaRef {
	if b.doc.Components == nil {
		return nil
	}
	return b.doc.Components.Schemas[full]
}

func (b *builder) buildOp(raw rawOp) error {
	if raw.methodName == "InvokeAction" {
		return fmt.Errorf("genlib: operation method name %q is reserved", raw.methodName)
	}
	op := Operation{
		MethodName: raw.methodName,
		HTTPMethod: raw.httpMethod,
		Path:       raw.path,
		Tag:        b.opTag(raw),
		Request:    Struct{Name: raw.methodName + "Request"},
	}
	if err := b.buildParams(&op, raw.op); err != nil {
		return err
	}
	if err := b.buildBody(&op, raw.op); err != nil {
		return err
	}
	op.RequiredScope = "actions:" + b.cfg.Package + ":" + op.MethodName
	op.Idempotency = actionIdempotency(op)
	if err := b.buildResponse(&op, raw.op); err != nil {
		return err
	}
	op.TestPath = b.testPath(raw)
	op.DocPath = raw.path
	for name, value := range b.cfg.PinnedPathParams {
		op.DocPath = strings.ReplaceAll(op.DocPath, "{"+name+"}", value)
	}
	if err := checkFieldNames(op.Request); err != nil {
		return err
	}
	b.ir.Ops = append(b.ir.Ops, op)
	return nil
}

func (b *builder) opTag(raw rawOp) string {
	for _, pt := range b.cfg.PathTags {
		if strings.HasPrefix(raw.path, pt.Prefix) {
			return pt.Tag
		}
	}
	if len(raw.op.Tags) > 0 {
		return raw.op.Tags[0]
	}
	return "Default"
}

// buildParams adds path, query and header parameter fields, in that order.
func (b *builder) buildParams(op *Operation, src *openapi3.Operation) error {
	var path, query, header []Field
	for _, pref := range src.Parameters {
		p := pref.Value
		f, kind, err := b.paramField(p)
		if err != nil {
			return fmt.Errorf("genlib: %s param %q: %w", op.MethodName, p.Name, err)
		}
		if kind != "" {
			b.markReachable(p.Schema)
		}
		switch kind {
		case "path":
			path = append(path, f)
		case "query":
			query = append(query, f)
		case "header":
			header = append(header, f)
		}
	}
	op.Request.Fields = append(append(path, query...), header...)
	return nil
}

// paramField converts one parameter; kind "" means the parameter is skipped.
func (b *builder) paramField(p *openapi3.Parameter) (Field, string, error) {
	switch p.In {
	case "path":
		if _, pinned := b.cfg.PinnedPathParams[p.Name]; pinned {
			return Field{}, "", nil
		}
		return Field{
			Name:       camelize(p.Name),
			Type:       strings.TrimPrefix(b.goType(p.Schema), "*"),
			Tag:        fmt.Sprintf(`json:"-" path:%q`, p.Name),
			ActionName: p.Name,
			ActionTag:  actionJSONTag(p.Name),
			Location:   "path",
		}, "path", nil
	case "query":
		goName := camelize(strings.TrimPrefix(p.Name, b.cfg.QueryPrefixStrip))
		return Field{
			Name:       goName,
			Type:       b.goType(p.Schema),
			Tag:        fmt.Sprintf(`json:"-" query:%q`, p.Name),
			ActionName: p.Name,
			ActionTag:  actionJSONTag(p.Name),
			Location:   "query",
		}, "query", nil
	case "header":
		for _, skip := range b.cfg.SkipHeaders {
			if strings.EqualFold(skip, p.Name) {
				return Field{}, "", nil
			}
		}
		return Field{
			Name:       camelize(p.Name),
			Type:       "*string",
			Tag:        fmt.Sprintf(`json:"-" header:%q`, p.Name),
			ActionName: p.Name,
			ActionTag:  actionJSONTag(p.Name),
			Location:   "header",
		}, "header", nil
	default:
		return Field{}, "", fmt.Errorf("unsupported parameter location %q", p.In)
	}
}

// buildBody flattens an object body into request fields, or adds a single
// Body field for inline array bodies.
func (b *builder) buildBody(op *Operation, src *openapi3.Operation) error {
	schema := bodySchema(src)
	if schema == nil {
		return nil
	}
	if schema.Ref != "" {
		full := refName(schema.Ref)
		def := b.schemaFor(full)
		if def == nil || def.Value == nil {
			return fmt.Errorf("genlib: %s: body ref %q not found", op.MethodName, full)
		}
		op.BodyExpr = "req"
		b.flattenBodyProps(op, def.Value)
		return nil
	}
	if typeOf(schema.Value) == "array" {
		op.BodyExpr = "req.Body"
		op.Request.Fields = append(op.Request.Fields, Field{
			Name:       "Body",
			Type:       "[]" + b.elemType(schema.Value.Items),
			Tag:        `json:"-"`,
			ActionName: "body",
			ActionTag:  actionJSONTag("body"),
			Location:   "body",
		})
		b.markReachable(schema.Value.Items)
		return nil
	}
	return fmt.Errorf("genlib: %s: unsupported body schema", op.MethodName)
}

func bodySchema(src *openapi3.Operation) *openapi3.SchemaRef {
	if src.RequestBody == nil || src.RequestBody.Value == nil {
		return nil
	}
	return contentSchema(src.RequestBody.Value.Content)
}

// contentSchema picks the JSON schema of a content map, falling back to any
// entry when application/json is absent.
func contentSchema(content openapi3.Content) *openapi3.SchemaRef {
	if mt := content.Get(jsonMIME); mt != nil {
		return mt.Schema
	}
	for _, mt := range content {
		if mt.Schema != nil {
			return mt.Schema
		}
	}
	return nil
}

func (b *builder) flattenBodyProps(op *Operation, def *openapi3.Schema) {
	for _, name := range sortedKeys(def.Properties) {
		prop := def.Properties[name]
		op.Request.Fields = append(op.Request.Fields, Field{
			Name:       camelize(name),
			Type:       b.goType(prop),
			Tag:        fmt.Sprintf(`json:"%s,omitempty"`, name),
			ActionName: name,
			ActionTag:  actionJSONTag(name),
			Location:   "body",
		})
		b.markReachable(prop)
	}
}

func actionJSONTag(name string) string {
	return fmt.Sprintf("json:%q", name+",omitempty")
}

func actionIdempotency(op Operation) string {
	switch op.HTTPMethod {
	case "GET", "HEAD", "OPTIONS":
		return "safe"
	case "PUT", "DELETE":
		return "idempotent"
	case "POST", "PATCH":
		for _, field := range op.Request.Fields {
			if field.Location == "header" && strings.EqualFold(field.ActionName, "Idempotency-Key") {
				return "provider-key"
			}
		}
	}
	return "unsafe"
}

// buildResponse resolves the first 2xx response into a type, alias, or
// empty struct.
func (b *builder) buildResponse(op *Operation, src *openapi3.Operation) error {
	schema := successSchema(src)
	if schema == nil {
		op.RespEmpty = true
		return nil
	}
	op.HasOut = true
	op.RespBodyLit = "{}"
	if schema.Ref != "" {
		full := refName(schema.Ref)
		b.reachFrom(full)
		if goName := b.names[full]; goName != op.MethodName+"Response" {
			op.RespAlias = goName
		}
		return nil
	}
	return b.inlineResponse(op, schema.Value)
}

func (b *builder) inlineResponse(op *Operation, schema *openapi3.Schema) error {
	switch typeOf(schema) {
	case "object", "":
		op.RespAlias = "map[string]any"
	case "array":
		op.RespAlias = "[]" + b.elemType(schema.Items)
		op.RespBodyLit = "[]"
		b.markReachable(schema.Items)
	default:
		return fmt.Errorf("genlib: %s: unsupported inline response type %q", op.MethodName, typeOf(schema))
	}
	return nil
}

// successSchema returns the schema of the lowest 2xx response, or nil.
func successSchema(src *openapi3.Operation) *openapi3.SchemaRef {
	if src.Responses == nil {
		return nil
	}
	var codes []string
	m := src.Responses.Map()
	for code := range m {
		if strings.HasPrefix(code, "2") {
			codes = append(codes, code)
		}
	}
	sort.Strings(codes)
	for _, code := range codes {
		if resp := m[code].Value; resp != nil {
			if schema := contentSchema(resp.Content); schema != nil {
				return schema
			}
		}
	}
	return nil
}

// goType maps a schema to a Go type; scalars and struct refs are pointers,
// slices and maps are not.
func (b *builder) goType(schema *openapi3.SchemaRef) string {
	if schema == nil {
		return "any"
	}
	if schema.Ref != "" {
		full := refName(schema.Ref)
		if def := b.schemaFor(full); def != nil && def.Value != nil && !isObjectDef(def.Value) {
			// Non-object definitions (enum strings, arrays, primitives)
			// inline to their underlying Go type instead of a named struct.
			return b.inlineGoType(def.Value)
		}
		return "*" + b.names[full]
	}
	return b.inlineGoType(schema.Value)
}

// isObjectDef reports whether a definition should be emitted as a struct.
// Enum strings, primitives, arrays, and pure anyOf wrappers inline instead.
func isObjectDef(s *openapi3.Schema) bool {
	switch typeOf(s) {
	case "object":
		return true
	case "":
		return len(s.AnyOf) == 0
	default:
		return false
	}
}

func (b *builder) inlineGoType(s *openapi3.Schema) string {
	if len(s.AnyOf) > 0 {
		if collapsed := firstNonNull(s.AnyOf); collapsed != nil {
			return b.goType(collapsed)
		}
	}
	switch typeOf(s) {
	case "string":
		return b.stringGoType(s)
	case "integer":
		if s.Format == "int64" {
			return "*int64"
		}
		return "*int"
	case "number":
		return "*float64"
	case "boolean":
		return "*bool"
	case "array":
		return "[]" + b.elemType(s.Items)
	case "object":
		if s.AdditionalProperties.Schema != nil {
			return "map[string]" + b.elemType(s.AdditionalProperties.Schema)
		}
		return "map[string]any"
	default:
		return "any"
	}
}

func (b *builder) stringGoType(s *openapi3.Schema) string {
	switch s.Format {
	case "byte":
		return "[]byte"
	case "date-time":
		if b.cfg.DateTimeType != "" {
			return "*" + b.cfg.DateTimeType
		}
		return "*time.Time"
	default:
		return "*string"
	}
}

// elemType is goType without the pointer for use as a slice/map element.
func (b *builder) elemType(schema *openapi3.SchemaRef) string {
	return strings.TrimPrefix(b.goType(schema), "*")
}

// firstNonNull collapses a nullable anyOf ({X, null}) to its X branch;
// optionality is already expressed by pointer field types.
func firstNonNull(branches openapi3.SchemaRefs) *openapi3.SchemaRef {
	for _, branch := range branches {
		if branch.Ref != "" || typeOf(branch.Value) != "null" {
			return branch
		}
	}
	return nil
}

func typeOf(s *openapi3.Schema) string {
	if s == nil || s.Type == nil || len(*s.Type) == 0 {
		return ""
	}
	return (*s.Type)[0]
}

// markReachable records every definition referenced from schema, transitively.
func (b *builder) markReachable(schema *openapi3.SchemaRef) {
	if schema == nil {
		return
	}
	if schema.Ref != "" {
		b.reachFrom(refName(schema.Ref))
		return
	}
	b.markInline(schema.Value)
}

func (b *builder) reachFrom(full string) {
	if b.reach[full] {
		return
	}
	b.reach[full] = true
	if def := b.schemaFor(full); def != nil && def.Value != nil {
		b.markInline(def.Value)
	}
}

func (b *builder) markInline(s *openapi3.Schema) {
	if s == nil {
		return
	}
	for _, prop := range s.Properties {
		b.markReachable(prop)
	}
	b.markReachable(s.Items)
	b.markReachable(s.AdditionalProperties.Schema)
	for _, branch := range s.AnyOf {
		b.markReachable(branch)
	}
	for _, branch := range s.OneOf {
		b.markReachable(branch)
	}
	for _, branch := range s.AllOf {
		b.markReachable(branch)
	}
}

// buildModels emits a struct for every reachable definition.
func (b *builder) buildModels() error {
	var fulls []string
	for full := range b.reach {
		fulls = append(fulls, full)
	}
	sort.Strings(fulls)
	for _, full := range fulls {
		def := b.schemaFor(full)
		if def == nil || def.Value == nil {
			return fmt.Errorf("genlib: reachable definition %q not found", full)
		}
		if !isObjectDef(def.Value) {
			continue // inlined at use sites (enum/primitive/array defs)
		}
		m := Struct{Name: b.names[full], Doc: full}
		for _, name := range sortedKeys(def.Value.Properties) {
			m.Fields = append(m.Fields, Field{
				Name: camelize(name),
				Type: b.goType(def.Value.Properties[name]),
				Tag:  fmt.Sprintf(`json:"%s,omitempty"`, name),
			})
		}
		if err := checkFieldNames(m); err != nil {
			return err
		}
		b.ir.Models = append(b.ir.Models, m)
	}
	return nil
}

// finish sorts ops, derives aliases/tags, and validates type-name uniqueness.
func (b *builder) finish() {
	sort.Slice(b.ir.Ops, func(i, j int) bool {
		if b.ir.Ops[i].Tag != b.ir.Ops[j].Tag {
			return b.ir.Ops[i].Tag < b.ir.Ops[j].Tag
		}
		return b.ir.Ops[i].MethodName < b.ir.Ops[j].MethodName
	})
	tags := map[string]bool{}
	for _, op := range b.ir.Ops {
		tags[op.Tag] = true
		if op.RespAlias != "" {
			b.ir.Aliases = append(b.ir.Aliases, Alias{Name: op.MethodName + "Response", Target: op.RespAlias})
		}
	}
	for tag := range tags {
		b.ir.Tags = append(b.ir.Tags, tag)
	}
	sort.Strings(b.ir.Tags)
	sort.Slice(b.ir.Aliases, func(i, j int) bool { return b.ir.Aliases[i].Name < b.ir.Aliases[j].Name })
}

// checkTypeNames verifies every generated type name is unique.
func (b *builder) checkTypeNames() error {
	add := func(name, origin string) error {
		if prev, ok := b.typeSeen[name]; ok {
			return fmt.Errorf("genlib: type name %q generated twice (%s and %s)", name, prev, origin)
		}
		b.typeSeen[name] = origin
		return nil
	}
	for _, m := range b.ir.Models {
		if err := add(m.Name, "model "+m.Doc); err != nil {
			return err
		}
	}
	for _, op := range b.ir.Ops {
		if err := add(op.Request.Name, "operation "+op.MethodName); err != nil {
			return err
		}
		respIsModel := op.RespAlias == "" && !op.RespEmpty && op.HasOut
		if !respIsModel {
			if err := add(op.MethodName+"Response", "operation "+op.MethodName); err != nil {
				return err
			}
		}
	}
	return nil
}

func checkFieldNames(s Struct) error {
	seen := map[string]bool{}
	for _, f := range s.Fields {
		if seen[f.Name] {
			return fmt.Errorf("genlib: duplicate field %q in %s", f.Name, s.Name)
		}
		seen[f.Name] = true
	}
	return nil
}

func sortedKeys(m openapi3.Schemas) []string {
	var keys []string
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}
