package main

import (
	"flag"
	"fmt"
	"os"

	"github.com/pax-beehive/connector/internal/qualitygate"
)

func main() {
	maxComplexity := flag.Int("max-complexity", 20, "maximum cyclomatic complexity per function or method")
	flag.Parse()
	root := "."
	if flag.NArg() > 0 {
		root = flag.Arg(0)
	}
	violations, err := qualitygate.Check(root, *maxComplexity)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(2)
	}
	for _, violation := range violations {
		fmt.Printf("%s:%d: %s: %s\n", violation.Path, violation.Line, violation.Rule, violation.Message)
	}
	if len(violations) > 0 {
		os.Exit(1)
	}
}
