package genlib

import (
	"os"
	"path/filepath"
	"testing"
)

func TestRunGeneratesFiles(t *testing.T) {
	dir := t.TempDir()
	fixture, err := os.ReadFile("testdata/fixture-swagger.json")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "spec.json"), fixture, 0o644); err != nil {
		t.Fatal(err)
	}
	yml := []byte("package: fixture\nspec: spec.json\ndatetime_type: connector.DateTime\nskip_headers: [authorization]\nquery_prefix_strip: \"request.\"\npinned_path_params: {version: \"6\"}\nprefer_namespaces: [\"Acme.Api.V1\"]\n")
	cfgPath := filepath.Join(dir, "gen.yaml")
	if err := os.WriteFile(cfgPath, yml, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := Run(cfgPath); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"types_gen.go", "widget_gen.go", "misc_gen.go", "actions_gen.go", "roundtrip_gen_test.go", "actions_gen_test.go", "AGENTS.md"} {
		if _, err := os.Stat(filepath.Join(dir, name)); err != nil {
			t.Errorf("expected %s: %v", name, err)
		}
	}
}

func TestRunBadConfig(t *testing.T) {
	if err := Run(filepath.Join(t.TempDir(), "missing.yaml")); err == nil {
		t.Fatal("expected error")
	}
}
