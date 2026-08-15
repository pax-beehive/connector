// Package qualitygate enforces repository-wide source quality rules.
package qualitygate

import (
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// Violation describes one deterministic quality-gate failure.
type Violation struct {
	Path    string
	Line    int
	Rule    string
	Message string
}

// Check applies all source and module rules below root.
func Check(root string, maxComplexity int) ([]Violation, error) {
	modulePath, err := readModulePath(filepath.Join(root, "go.mod"))
	if err != nil {
		return nil, err
	}
	var violations []Violation
	err = filepath.WalkDir(root, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() {
			if path != root && skippedDir(entry.Name()) {
				return filepath.SkipDir
			}
			return nil
		}
		if !sourceFile(path) {
			return nil
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		rel = filepath.ToSlash(rel)
		violations = append(violations, checkText(rel, data)...)
		if filepath.Ext(path) == ".go" {
			goViolations, err := checkGoFile(rel, data, modulePath, maxComplexity)
			if err != nil {
				return err
			}
			violations = append(violations, goViolations...)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	sort.Slice(violations, func(i, j int) bool {
		if violations[i].Path != violations[j].Path {
			return violations[i].Path < violations[j].Path
		}
		if violations[i].Line != violations[j].Line {
			return violations[i].Line < violations[j].Line
		}
		return violations[i].Rule < violations[j].Rule
	})
	return violations, nil
}

func readModulePath(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", fmt.Errorf("read module path: %w", err)
	}
	for _, line := range strings.Split(string(data), "\n") {
		fields := strings.Fields(line)
		if len(fields) == 2 && fields[0] == "module" {
			return fields[1], nil
		}
	}
	return "", fmt.Errorf("read module path: no module directive in %s", path)
}

func skippedDir(name string) bool {
	switch name {
	case ".git", "node_modules", "vendor":
		return true
	default:
		return false
	}
}

func sourceFile(path string) bool {
	base := filepath.Base(path)
	switch base {
	case "Dockerfile", "Makefile", "go.mod":
		return true
	}
	switch filepath.Ext(path) {
	case ".bash", ".c", ".cc", ".cpp", ".css", ".go", ".graphql", ".h", ".hpp",
		".html", ".java", ".js", ".jsx", ".kt", ".kts", ".mk", ".proto", ".py",
		".rb", ".rs", ".scss", ".sh", ".sql", ".svelte", ".swift", ".tf", ".toml",
		".ts", ".tsx", ".vue", ".yaml", ".yml", ".zsh":
		return true
	default:
		return false
	}
}
