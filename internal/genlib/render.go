package genlib

import (
	"bytes"
	"fmt"
	"go/format"
	"sort"
	"strings"
	"text/template"
)

const connectorImport = `"github.com/pax-beehive/connector"`

// Render produces the generated files, keyed by file name: types_gen.go,
// one <lowertag>_gen.go per tag, and roundtrip_gen_test.go. Output is
// gofmt-formatted.
func Render(ir *IR, cfg *Config) (map[string][]byte, error) {
	files := map[string][]byte{}
	if err := renderFile(files, "types_gen.go", typesTmpl, ir, nil); err != nil {
		return nil, err
	}
	for _, tag := range ir.Tags {
		sub := &IR{Package: ir.Package, Ops: opsForTag(ir, tag)}
		name := strings.ToLower(tag) + "_gen.go"
		if err := renderFile(files, name, opsTmpl, sub, nil); err != nil {
			return nil, err
		}
	}
	testImports := []string{`"context"`, `"net/http"`, `"net/http/httptest"`, `"sync"`, `"testing"`}
	if err := renderFile(files, "roundtrip_gen_test.go", roundtripTmpl, ir, testImports); err != nil {
		return nil, err
	}
	return files, nil
}

func opsForTag(ir *IR, tag string) []Operation {
	var ops []Operation
	for _, op := range ir.Ops {
		if op.Tag == tag {
			ops = append(ops, op)
		}
	}
	return ops
}

// renderFile executes a template, prepends the header and computed imports,
// and gofmt-formats the result. forceImports (sorted in) are always added.
func renderFile(files map[string][]byte, name, tmpl string, data *IR, forceImports []string) error {
	body, err := execTemplate(name, tmpl, data)
	if err != nil {
		return err
	}
	header, err := execTemplate(name+":header", fileHeaderTmpl, data)
	if err != nil {
		return err
	}
	src := header + importBlock(body, forceImports) + body
	formatted, err := format.Source([]byte(src))
	if err != nil {
		return fmt.Errorf("genlib: %s does not gofmt: %w\n%s", name, err, src)
	}
	files[name] = formatted
	return nil
}

func execTemplate(name, tmpl string, data *IR) (string, error) {
	t, err := template.New(name).Parse(tmpl)
	if err != nil {
		return "", err
	}
	var buf bytes.Buffer
	if err := t.Execute(&buf, data); err != nil {
		return "", err
	}
	return buf.String(), nil
}

// importBlock derives the import list from identifiers the body references.
func importBlock(body string, force []string) string {
	imports := append([]string{}, force...)
	if strings.Contains(body, "context.") {
		imports = append(imports, `"context"`)
	}
	if strings.Contains(body, "time.Time") {
		imports = append(imports, `"time"`)
	}
	if strings.Contains(body, "connector.") {
		imports = append(imports, connectorImport)
	}
	if len(imports) == 0 {
		return ""
	}
	imports = dedupe(imports)
	return "\nimport (\n\t" + strings.Join(imports, "\n\t") + "\n)\n"
}

func dedupe(in []string) []string {
	sort.Strings(in)
	var out []string
	for i, s := range in {
		if i == 0 || s != in[i-1] {
			out = append(out, s)
		}
	}
	return out
}
