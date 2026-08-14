package genlib

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadConfig(t *testing.T) {
	dir := t.TempDir()
	yml := []byte("package: mindbody\nspec: spec/swagger.json\nout_dir: .\nbase_url: https://x\nquery_prefix_strip: \"request.\"\nskip_headers: [authorization]\npinned_path_params: {version: \"6\"}\n")
	path := filepath.Join(dir, "gen.yaml")
	if err := os.WriteFile(path, yml, 0o644); err != nil {
		t.Fatal(err)
	}
	cfg, err := LoadConfig(path)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Package != "mindbody" || cfg.QueryPrefixStrip != "request." {
		t.Errorf("cfg = %+v", cfg)
	}
	if cfg.Spec != filepath.Join(dir, "spec/swagger.json") || cfg.OutDir != dir {
		t.Errorf("paths not resolved: spec=%q out=%q", cfg.Spec, cfg.OutDir)
	}
}

func TestLoadConfigValidates(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "gen.yaml")
	if err := os.WriteFile(path, []byte("package: x\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := LoadConfig(path); err == nil {
		t.Fatal("expected validation error for missing spec/base_url")
	}
	if _, err := LoadConfig(filepath.Join(dir, "missing.yaml")); err == nil {
		t.Fatal("expected error for missing file")
	}
}

func TestLoadSpecConvertsSwagger2(t *testing.T) {
	doc, err := LoadSpec("testdata/fixture-swagger.json")
	if err != nil {
		t.Fatal(err)
	}
	if doc.Paths == nil || doc.Paths.Find("/public/v{version}/widget/widgets") == nil {
		t.Fatal("paths missing after conversion")
	}
	if _, ok := doc.Components.Schemas["Acme.Api.V1.Widget"]; !ok {
		t.Fatal("definitions not converted to components")
	}
}

func TestLoadSpecMissing(t *testing.T) {
	if _, err := LoadSpec("testdata/does-not-exist.json"); err == nil {
		t.Fatal("expected error")
	}
}
