// Package genlib implements a generic OpenAPI-to-connector code generator.
// It loads a Swagger 2.0 or OpenAPI 3.x spec, builds an intermediate
// representation shaped by a per-connector config, and renders Go source.
package genlib

import (
	"errors"
	"os"
	"path/filepath"

	"gopkg.in/yaml.v3"
)

// Config is the per-connector generation config (gen.yaml).
type Config struct {
	Package string `yaml:"package"`
	Spec    string `yaml:"spec"`
	OutDir  string `yaml:"out_dir"`
	// Title, Description and AgentNotes feed the generated AGENTS.md: Title
	// and Description introduce the connector; AgentNotes is handwritten
	// markdown (auth model, usage, boundaries) included verbatim before the
	// generated capability catalog.
	Title            string            `yaml:"title"`
	Description      string            `yaml:"description"`
	AgentNotes       string            `yaml:"agent_notes"`
	// TestNewClient is the Go expression the generated round-trip test uses
	// to build the client; `srv` (an *httptest.Server) is in scope. Defaults
	// to `NewClient(&Config{BaseURL: srv.URL})`.
	TestNewClient    string            `yaml:"test_new_client"`
	DateTimeType     string            `yaml:"datetime_type"` // e.g. connector.DateTime; empty means time.Time
	SkipHeaders      []string          `yaml:"skip_headers"`
	QueryPrefixStrip string            `yaml:"query_prefix_strip"`
	PinnedPathParams map[string]string `yaml:"pinned_path_params"`
	PreferNamespaces []string          `yaml:"prefer_namespaces"`
	Rename           map[string]string `yaml:"rename"`       // operationId -> method name
	RenameTypes      map[string]string `yaml:"rename_types"` // definition full name -> Go type name
	// StripOperationIDSuffix removes a trailing suffix from every
	// operationId before deriving the method name (e.g. "Method").
	StripOperationIDSuffix string `yaml:"strip_operation_id_suffix"`
	// PathTags assigns operation tags by path prefix (first match wins),
	// for specs that declare no tags. Falls back to the spec's own tags.
	PathTags []PathTag `yaml:"path_tags"`
}

// PathTag maps a path prefix to a tag used for file grouping and docs.
type PathTag struct {
	Prefix string `yaml:"prefix"`
	Tag    string `yaml:"tag"`
}

// LoadConfig reads a gen.yaml. Spec and OutDir are resolved relative to the
// config file's directory; OutDir defaults to that directory.
func LoadConfig(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	cfg := &Config{}
	if err := yaml.Unmarshal(data, cfg); err != nil {
		return nil, err
	}
	if cfg.Package == "" || cfg.Spec == "" {
		return nil, errors.New("genlib: package and spec are required")
	}
	dir := filepath.Dir(path)
	cfg.Spec = filepath.Join(dir, cfg.Spec)
	if cfg.OutDir == "" {
		cfg.OutDir = "."
	}
	cfg.OutDir = filepath.Join(dir, cfg.OutDir)
	return cfg, nil
}
