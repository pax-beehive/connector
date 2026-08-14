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
	DateTimeType     string            `yaml:"datetime_type"` // e.g. connector.DateTime; empty means time.Time
	SkipHeaders      []string          `yaml:"skip_headers"`
	QueryPrefixStrip string            `yaml:"query_prefix_strip"`
	PinnedPathParams map[string]string `yaml:"pinned_path_params"`
	PreferNamespaces []string          `yaml:"prefer_namespaces"`
	Rename           map[string]string `yaml:"rename"`       // operationId -> method name
	RenameTypes      map[string]string `yaml:"rename_types"` // definition full name -> Go type name
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
