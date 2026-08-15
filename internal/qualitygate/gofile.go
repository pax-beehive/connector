package qualitygate

import (
	"bytes"
	"fmt"
	"go/ast"
	"go/format"
	"go/parser"
	"go/token"
	"path/filepath"
	"strconv"
	"strings"
)

func checkGoFile(path string, data []byte, modulePath string, maxComplexity int) ([]Violation, error) {
	fileset := token.NewFileSet()
	file, err := parser.ParseFile(fileset, path, data, parser.ParseComments)
	if err != nil {
		return nil, fmt.Errorf("parse %s: %w", path, err)
	}
	var violations []Violation
	formatted, err := format.Source(data)
	if err != nil {
		return nil, fmt.Errorf("format %s: %w", path, err)
	}
	if !bytes.Equal(data, formatted) {
		violations = append(violations, Violation{
			Path: path, Line: 1, Rule: "gofmt", Message: "file is not gofmt-formatted",
		})
	}
	violations = append(violations, checkComplexity(fileset, file, path, maxComplexity)...)
	violations = append(violations, checkImports(fileset, file, path, modulePath)...)
	return violations, nil
}

func checkComplexity(fileset *token.FileSet, file *ast.File, path string, max int) []Violation {
	var violations []Violation
	ast.Inspect(file, func(node ast.Node) bool {
		var name string
		switch typed := node.(type) {
		case *ast.FuncDecl:
			name = typed.Name.Name
		case *ast.FuncLit:
			name = "function literal"
		default:
			return true
		}
		value := cyclomaticComplexity(node)
		if value > max {
			position := fileset.Position(node.Pos())
			violations = append(violations, Violation{
				Path: path, Line: position.Line, Rule: "complexity",
				Message: fmt.Sprintf("%s has cyclomatic complexity %d; maximum is %d", name, value, max),
			})
		}
		return true
	})
	return violations
}

func cyclomaticComplexity(root ast.Node) int {
	complexity := 1
	ast.Inspect(root, func(node ast.Node) bool {
		if node != root {
			if _, nested := node.(*ast.FuncLit); nested {
				return false
			}
		}
		switch typed := node.(type) {
		case *ast.IfStmt, *ast.ForStmt, *ast.RangeStmt, *ast.CaseClause, *ast.CommClause:
			complexity++
		case *ast.BinaryExpr:
			if typed.Op == token.LAND || typed.Op == token.LOR {
				complexity++
			}
		}
		return true
	})
	return complexity
}

func checkImports(fileset *token.FileSet, file *ast.File, path, modulePath string) []Violation {
	var violations []Violation
	for _, spec := range file.Imports {
		importPath, err := strconv.Unquote(spec.Path.Value)
		if err != nil || !strings.HasPrefix(importPath, modulePath) {
			continue
		}
		if allowedProjectImport(filepath.ToSlash(filepath.Dir(path)), importPath, modulePath) {
			continue
		}
		position := fileset.Position(spec.Pos())
		violations = append(violations, Violation{
			Path: path, Line: position.Line, Rule: "module-import",
			Message: fmt.Sprintf("package in %s must not import %s", filepath.Dir(path), importPath),
		})
	}
	return violations
}

func allowedProjectImport(packageDir, importPath, modulePath string) bool {
	if importPath == modulePath {
		return true
	}
	local := strings.TrimPrefix(importPath, modulePath+"/")
	if packageDir == "." {
		return false
	}
	if strings.HasPrefix(packageDir, "cmd/") || strings.HasPrefix(packageDir, "internal/") {
		return strings.HasPrefix(local, "internal/")
	}
	top := strings.Split(packageDir, "/")[0]
	return local == top
}
