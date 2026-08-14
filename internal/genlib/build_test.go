package genlib

import (
	"strings"
	"testing"
)

func fixtureIR(t *testing.T) *IR {
	t.Helper()
	doc, err := LoadSpec("testdata/fixture-swagger.json")
	if err != nil {
		t.Fatal(err)
	}
	ir, err := Build(doc, fixtureConfig())
	if err != nil {
		t.Fatal(err)
	}
	return ir
}

func fixtureConfig() *Config {
	return &Config{
		Package: "fixture", BaseURL: "https://x",
		DateTimeType:     "connector.DateTime",
		SkipHeaders:      []string{"authorization", "version", "siteId"},
		QueryPrefixStrip: "request.",
		PinnedPathParams: map[string]string{"version": "6"},
		PreferNamespaces: []string{"Acme.Api.V1"},
	}
}

func opByName(t *testing.T, ir *IR, name string) Operation {
	t.Helper()
	for _, op := range ir.Ops {
		if op.MethodName == name {
			return op
		}
	}
	t.Fatalf("operation %s not found among %d ops", name, len(ir.Ops))
	return Operation{}
}

func fieldByName(t *testing.T, s Struct, name string) Field {
	t.Helper()
	for _, f := range s.Fields {
		if f.Name == name {
			return f
		}
	}
	t.Fatalf("field %s not found in %s", name, s.Name)
	return Field{}
}

func TestBuildOperations(t *testing.T) {
	ir := fixtureIR(t)
	if len(ir.Ops) != 5 {
		t.Fatalf("want 5 ops, got %d", len(ir.Ops))
	}

	get := opByName(t, ir, "GetWidgets")
	if get.HTTPMethod != "GET" || get.BodyExpr != "" || !get.HasOut {
		t.Errorf("GetWidgets = %+v", get)
	}
	limit := fieldByName(t, get.Request, "Limit")
	if limit.Type != "*int" || !strings.Contains(limit.Tag, `query:"request.limit"`) {
		t.Errorf("Limit = %+v", limit)
	}
	ids := fieldByName(t, get.Request, "Ids")
	if ids.Type != "[]int64" {
		t.Errorf("Ids = %+v", ids)
	}
	start := fieldByName(t, get.Request, "StartDate")
	if start.Type != "*connector.DateTime" {
		t.Errorf("StartDate = %+v", start)
	}
	trace := fieldByName(t, get.Request, "XTrace")
	if !strings.Contains(trace.Tag, `header:"x-trace"`) {
		t.Errorf("XTrace = %+v", trace)
	}
	for _, f := range get.Request.Fields {
		if strings.Contains(f.Tag, "authorization") {
			t.Error("authorization header must be skipped")
		}
	}

	add := opByName(t, ir, "AddWidget") // space stripped from "Add Widget"
	if add.BodyExpr != "req" {
		t.Errorf("AddWidget.BodyExpr = %q", add.BodyExpr)
	}
	name := fieldByName(t, add.Request, "Name")
	if name.Type != "*string" || !strings.Contains(name.Tag, `json:"Name,omitempty"`) {
		t.Errorf("Name = %+v", name)
	}
	widget := fieldByName(t, add.Request, "Widget")
	if widget.Type != "*Widget" {
		t.Errorf("Widget = %+v", widget)
	}

	repl := opByName(t, ir, "ReplaceTags")
	if repl.BodyExpr != "req.Body" {
		t.Errorf("ReplaceTags.BodyExpr = %q", repl.BodyExpr)
	}
	body := fieldByName(t, repl.Request, "Body")
	if body.Type != "[]Tag" {
		t.Errorf("Body = %+v", body)
	}
	wid := fieldByName(t, repl.Request, "WidgetId")
	if wid.Type != "int64" || !strings.Contains(wid.Tag, `path:"widgetId"`) {
		t.Errorf("WidgetId = %+v", wid)
	}
	if repl.TestPath != "/public/v6/widget/0/tags" {
		t.Errorf("TestPath = %q", repl.TestPath)
	}

	del := opByName(t, ir, "DeleteCardType")
	if del.HasOut || del.RespBodyLit != "" {
		t.Errorf("DeleteCardType = %+v", del)
	}
	cards := opByName(t, ir, "GetCardTypes")
	if cards.RespBodyLit != "[]" {
		t.Errorf("GetCardTypes.RespBodyLit = %q", cards.RespBodyLit)
	}
}

func TestBuildModelsAndAliases(t *testing.T) {
	ir := fixtureIR(t)
	names := map[string]bool{}
	for _, m := range ir.Models {
		names[m.Name] = true
	}
	for _, want := range []string{"Widget", "Tag", "CommonTag", "Pagination", "GetWidgetsResponse"} {
		if !names[want] {
			t.Errorf("model %s missing (have %v)", want, names)
		}
	}
	for _, absent := range []string{"Unused", "AddWidgetRequest"} {
		if names[absent] {
			t.Errorf("model %s must not be generated", absent)
		}
	}
	aliases := map[string]string{}
	for _, a := range ir.Aliases {
		aliases[a.Name] = a.Target
	}
	if aliases["AddWidgetResponse"] != "Widget" {
		t.Errorf("AddWidgetResponse alias = %q", aliases["AddWidgetResponse"])
	}
	if aliases["ReplaceTagsResponse"] != "map[string]any" {
		t.Errorf("ReplaceTagsResponse alias = %q", aliases["ReplaceTagsResponse"])
	}
	if aliases["GetCardTypesResponse"] != "[]string" {
		t.Errorf("GetCardTypesResponse alias = %q", aliases["GetCardTypesResponse"])
	}
	if !ir.UsesDateTime {
		t.Error("UsesDateTime should be true")
	}
	if !ir.UsesConnectorImport {
		t.Error("UsesConnectorImport should be true")
	}
}

func TestBuildModelFieldTypes(t *testing.T) {
	ir := fixtureIR(t)
	var widget Struct
	for _, m := range ir.Models {
		if m.Name == "Widget" {
			widget = m
		}
	}
	if widget.Name == "" {
		t.Fatal("Widget model missing")
	}
	cases := map[string]string{
		"Id": "*int64", "Name": "*string", "Price": "*float64", "Active": "*bool",
		"Tags": "[]Tag", "Extra": "map[string]string", "Blob": "[]byte",
	}
	for fname, ftype := range cases {
		f := fieldByName(t, widget, fname)
		if f.Type != ftype {
			t.Errorf("Widget.%s type = %q, want %q", fname, f.Type, ftype)
		}
		if !strings.Contains(f.Tag, `json:"`+fname+`,omitempty"`) {
			t.Errorf("Widget.%s tag = %q", fname, f.Tag)
		}
	}
}

func TestBuildDuplicateMethodNames(t *testing.T) {
	doc, err := LoadSpec("testdata/fixture-swagger.json")
	if err != nil {
		t.Fatal(err)
	}
	cfg := fixtureConfig()
	cfg.Rename = map[string]string{"Add Widget": "GetWidgets"} // force a clash
	if _, err := Build(doc, cfg); err == nil {
		t.Fatal("expected duplicate method name error")
	}
}

func TestRenameByMethodAndPath(t *testing.T) {
	doc, err := LoadSpec("testdata/fixture-swagger.json")
	if err != nil {
		t.Fatal(err)
	}
	cfg := fixtureConfig()
	cfg.Rename = map[string]string{"POST /public/v{version}/widget/widgets": "CreateWidget"}
	ir, err := Build(doc, cfg)
	if err != nil {
		t.Fatal(err)
	}
	opByName(t, ir, "CreateWidget")
}

func TestRenameTypes(t *testing.T) {
	doc, err := LoadSpec("testdata/fixture-swagger.json")
	if err != nil {
		t.Fatal(err)
	}
	cfg := fixtureConfig()
	cfg.RenameTypes = map[string]string{"Acme.Api.V1.Widget": "WidgetModel"}
	ir, err := Build(doc, cfg)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, m := range ir.Models {
		if m.Name == "WidgetModel" {
			found = true
		}
		if m.Name == "Widget" {
			t.Error("Widget should have been renamed")
		}
	}
	if !found {
		t.Error("WidgetModel missing")
	}
}
