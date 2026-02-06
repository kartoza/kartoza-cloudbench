package cmd

import (
	"fmt"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/kartoza/kartoza-geoserver-client/internal/config"
	"github.com/kartoza/kartoza-geoserver-client/internal/tui"
	"github.com/spf13/cobra"
)

var (
	appVersion string
	rootCmd    = &cobra.Command{
		Use:   "geoserver-client",
		Short: "A dual-panel TUI for managing GeoServer instances",
		Long: `Kartoza GeoServer Client is a Midnight Commander-style TUI application
for browsing local geospatial files and managing GeoServer instances.

Upload layers and styles to GeoServer and publish them as services.`,
		RunE: runTUI,
	}
)

func Execute(version string) error {
	appVersion = version
	return rootCmd.Execute()
}

func init() {
	rootCmd.AddCommand(versionCmd)
}

var versionCmd = &cobra.Command{
	Use:   "version",
	Short: "Print the version number",
	Run: func(cmd *cobra.Command, args []string) {
		fmt.Printf("Kartoza GeoServer Client %s\n", appVersion)
	},
}

func runTUI(cmd *cobra.Command, args []string) error {
	cfg, err := config.Load()
	if err != nil {
		return fmt.Errorf("failed to load config: %w", err)
	}

	app := tui.NewApp(cfg, appVersion)
	p := tea.NewProgram(app, tea.WithAltScreen(), tea.WithMouseCellMotion())

	if _, err := p.Run(); err != nil {
		return fmt.Errorf("failed to run TUI: %w", err)
	}

	return nil
}
