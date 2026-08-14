// Command connector-gen generates a connector package from an OpenAPI spec
// and a per-connector gen.yaml.
package main

import (
	"flag"
	"fmt"
	"os"

	"github.com/pax-beehive/connector/internal/genlib"
)

func main() {
	config := flag.String("config", "gen.yaml", "path to generator config")
	flag.Parse()
	if err := genlib.Run(*config); err != nil {
		fmt.Fprintln(os.Stderr, "connector-gen:", err)
		os.Exit(1)
	}
}
