package genlib

import (
	"flag"
	"os"
	"path/filepath"
	"testing"
)

var update = flag.Bool("update", false, "rewrite golden files")

func TestRenderGolden(t *testing.T) {
	ir := fixtureIR(t)
	files, err := Render(ir, fixtureConfig())
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"types_gen.go", "widget_gen.go", "misc_gen.go", "actions_gen.go", "roundtrip_gen_test.go", "actions_gen_test.go", "AGENTS.md"} {
		if _, ok := files[want]; !ok {
			t.Errorf("missing file %s", want)
		}
	}
	if *update {
		if err := os.MkdirAll(filepath.Join("testdata", "golden"), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	for name, got := range files {
		golden := filepath.Join("testdata", "golden", name+".golden")
		if *update {
			if err := os.WriteFile(golden, got, 0o644); err != nil {
				t.Fatal(err)
			}
			continue
		}
		want, err := os.ReadFile(golden)
		if err != nil {
			t.Fatalf("%s: %v (run with -update to create)", name, err)
		}
		if string(want) != string(got) {
			t.Errorf("%s differs from golden; run with -update and inspect the diff", name)
		}
	}
}
