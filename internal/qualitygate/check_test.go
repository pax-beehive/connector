package qualitygate

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestCheckAcceptsCleanModule(t *testing.T) {
	root := fixtureModule(t)
	writeFixture(t, root, "connector.go", "package fixture\n")
	writeFixture(t, root, "provider/client.go", `package provider

import "example.com/fixture"

var _ = fixture.Value
`)
	violations, err := Check(root, 20)
	if err != nil {
		t.Fatal(err)
	}
	if len(violations) != 0 {
		t.Fatalf("violations = %+v", violations)
	}
}

func TestCheckRejectsChineseAndEmojiInSource(t *testing.T) {
	root := fixtureModule(t)
	bad := "package fixture\n\n// " + string(rune(0x4E2D)) + string(rune(0x1F600)) + "\n"
	writeFixture(t, root, "bad.go", bad)
	violations, err := Check(root, 20)
	if err != nil {
		t.Fatal(err)
	}
	assertRules(t, violations, "source-language", "source-language")
}

func TestCheckIgnoresProseDocuments(t *testing.T) {
	root := fixtureModule(t)
	writeFixture(t, root, "doc.md", string(rune(0x4E2D))+string(rune(0x1F600)))
	violations, err := Check(root, 20)
	if err != nil {
		t.Fatal(err)
	}
	if len(violations) != 0 {
		t.Fatalf("violations = %+v", violations)
	}
}

func TestCheckRejectsExcessiveComplexity(t *testing.T) {
	root := fixtureModule(t)
	writeFixture(t, root, "complex.go", `package fixture

func complex(a, b bool) {
	if a && b {
		return
	}
}
`)
	violations, err := Check(root, 2)
	if err != nil {
		t.Fatal(err)
	}
	assertRules(t, violations, "complexity")
}

func TestComplexityLimitIsInclusive(t *testing.T) {
	root := fixtureModule(t)
	writeFixture(t, root, "allowed.go", `package fixture

func allowed(value bool) {
	if value {
		return
	}
}
`)
	violations, err := Check(root, 2)
	if err != nil {
		t.Fatal(err)
	}
	if len(violations) != 0 {
		t.Fatalf("violations = %+v", violations)
	}
}

func TestCheckRejectsUnformattedGo(t *testing.T) {
	root := fixtureModule(t)
	writeFixture(t, root, "bad.go", "package fixture\nvar value=1\n")
	violations, err := Check(root, 20)
	if err != nil {
		t.Fatal(err)
	}
	assertRules(t, violations, "gofmt")
}

func TestCheckRejectsCrossProviderImport(t *testing.T) {
	root := fixtureModule(t)
	writeFixture(t, root, "alpha/client.go", `package alpha

import _ "example.com/fixture/beta"
`)
	violations, err := Check(root, 20)
	if err != nil {
		t.Fatal(err)
	}
	assertRules(t, violations, "module-import")
}

func TestCheckAllowsCommandsToImportInternalModules(t *testing.T) {
	root := fixtureModule(t)
	writeFixture(t, root, "cmd/tool/main.go", `package main

import _ "example.com/fixture/internal/tool"
`)
	violations, err := Check(root, 20)
	if err != nil {
		t.Fatal(err)
	}
	if len(violations) != 0 {
		t.Fatalf("violations = %+v", violations)
	}
}

func fixtureModule(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	writeFixture(t, root, "go.mod", "module example.com/fixture\n\ngo 1.26\n")
	return root
}

func writeFixture(t *testing.T, root, path, content string) {
	t.Helper()
	fullPath := filepath.Join(root, path)
	if err := os.MkdirAll(filepath.Dir(fullPath), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(fullPath, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func assertRules(t *testing.T, violations []Violation, want ...string) {
	t.Helper()
	var got []string
	for _, violation := range violations {
		got = append(got, violation.Rule)
	}
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("rules = %v, want %v; violations = %+v", got, want, violations)
	}
}
