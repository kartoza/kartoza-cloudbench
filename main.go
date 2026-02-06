package main

import (
	"fmt"
	"os"

	"github.com/kartoza/kartoza-geoserver-client/cmd"
)

var version = "dev"

func main() {
	if err := cmd.Execute(version); err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}
}
