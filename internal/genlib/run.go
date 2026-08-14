package genlib

import (
	"os"
	"path/filepath"
)

// Run executes the full generation pipeline for one connector config.
func Run(configPath string) error {
	cfg, err := LoadConfig(configPath)
	if err != nil {
		return err
	}
	doc, err := LoadSpec(cfg.Spec)
	if err != nil {
		return err
	}
	ir, err := Build(doc, cfg)
	if err != nil {
		return err
	}
	files, err := Render(ir, cfg)
	if err != nil {
		return err
	}
	for name, data := range files {
		if err := os.WriteFile(filepath.Join(cfg.OutDir, name), data, 0o644); err != nil {
			return err
		}
	}
	return nil
}
