package styles

import (
	"github.com/charmbracelet/lipgloss"
)

// Color palette inspired by GeoServer/cartography themes
var (
	// Primary colors
	Primary     = lipgloss.Color("#4A90D9") // Blue - water/ocean
	Secondary   = lipgloss.Color("#7BC96F") // Green - land/vegetation
	Accent      = lipgloss.Color("#F5A623") // Orange - highlights
	Danger      = lipgloss.Color("#D9534F") // Red - errors/warnings

	// Neutral colors
	Background  = lipgloss.Color("#1E1E2E") // Dark background
	Surface     = lipgloss.Color("#2D2D3F") // Slightly lighter
	SurfaceHigh = lipgloss.Color("#3D3D4F") // Even lighter for active elements
	Border      = lipgloss.Color("#4D4D5F") // Border color
	Muted       = lipgloss.Color("#6C7086") // Muted text
	Text        = lipgloss.Color("#CDD6F4") // Main text
	TextBright  = lipgloss.Color("#FFFFFF") // Bright text

	// Special colors
	Selected    = lipgloss.Color("#89B4FA") // Selected item
	Directory   = lipgloss.Color("#89DCEB") // Directory color
	Executable  = lipgloss.Color("#A6E3A1") // Executable/action
	GeoFile     = lipgloss.Color("#F9E2AF") // Geospatial files
	StyleFile   = lipgloss.Color("#CBA6F7") // Style files (SLD/CSS)
)

// App-wide styles
var (
	// Base styles
	BaseStyle = lipgloss.NewStyle().
		Background(Background).
		Foreground(Text)

	// Title bar
	TitleStyle = lipgloss.NewStyle().
		Bold(true).
		Foreground(TextBright).
		Background(Primary).
		Padding(0, 1)

	SubtitleStyle = lipgloss.NewStyle().
		Foreground(Muted).
		Italic(true)

	// Muted text style
	MutedStyle = lipgloss.NewStyle().
		Foreground(Muted)

	// Panel styles
	PanelStyle = lipgloss.NewStyle().
		Border(lipgloss.RoundedBorder()).
		BorderForeground(Border).
		Padding(0, 1)

	ActivePanelStyle = PanelStyle.
		BorderForeground(Primary)

	PanelHeaderStyle = lipgloss.NewStyle().
		Bold(true).
		Foreground(Primary).
		Padding(0, 1).
		MarginBottom(1)

	// List item styles
	ItemStyle = lipgloss.NewStyle().
		Foreground(Text).
		Padding(0, 1)

	SelectedItemStyle = lipgloss.NewStyle().
		Foreground(TextBright).
		Background(SurfaceHigh).
		Bold(true).
		Padding(0, 1)

	ActiveItemStyle = lipgloss.NewStyle().
		Foreground(TextBright).
		Background(Primary).
		Bold(true).
		Padding(0, 1)

	// Directory style
	DirectoryStyle = lipgloss.NewStyle().
		Foreground(Directory).
		Bold(true)

	// File type styles
	GeoFileStyle = lipgloss.NewStyle().
		Foreground(GeoFile)

	StyleFileStyle = lipgloss.NewStyle().
		Foreground(StyleFile)

	// Status bar
	StatusBarStyle = lipgloss.NewStyle().
		Foreground(Text).
		Background(Surface).
		Padding(0, 1)

	StatusKeyStyle = lipgloss.NewStyle().
		Foreground(TextBright).
		Background(Primary).
		Padding(0, 1)

	StatusValueStyle = lipgloss.NewStyle().
		Foreground(Text).
		Background(Surface).
		Padding(0, 1)

	// Help bar
	HelpBarStyle = lipgloss.NewStyle().
		Foreground(Muted).
		Background(Surface).
		Padding(0, 1)

	HelpKeyStyle = lipgloss.NewStyle().
		Foreground(Selected).
		Bold(true)

	HelpTextStyle = lipgloss.NewStyle().
		Foreground(Muted)

	// Error styles
	ErrorStyle = lipgloss.NewStyle().
		Foreground(Danger).
		Bold(true)

	ErrorMsgStyle = lipgloss.NewStyle().
		Foreground(Danger).
		Background(Surface).
		Padding(1, 2).
		Border(lipgloss.RoundedBorder()).
		BorderForeground(Danger)

	// Success styles
	SuccessStyle = lipgloss.NewStyle().
		Foreground(Secondary).
		Bold(true)

	// Loading styles
	LoadingStyle = lipgloss.NewStyle().
		Foreground(Accent).
		Italic(true)

	// Dialog styles
	DialogStyle = lipgloss.NewStyle().
		Border(lipgloss.DoubleBorder()).
		BorderForeground(Primary).
		Background(Surface).
		Padding(1, 2)

	DialogTitleStyle = lipgloss.NewStyle().
		Bold(true).
		Foreground(Primary).
		MarginBottom(1)

	// Input styles
	InputStyle = lipgloss.NewStyle().
		Border(lipgloss.NormalBorder()).
		BorderForeground(Border).
		Padding(0, 1)

	FocusedInputStyle = lipgloss.NewStyle().
		Border(lipgloss.NormalBorder()).
		BorderForeground(Primary).
		Padding(0, 1)

	// Button styles
	ButtonStyle = lipgloss.NewStyle().
		Foreground(Text).
		Background(Surface).
		Padding(0, 2).
		Border(lipgloss.NormalBorder()).
		BorderForeground(Border)

	FocusedButtonStyle = lipgloss.NewStyle().
		Foreground(TextBright).
		Background(Primary).
		Padding(0, 2).
		Border(lipgloss.NormalBorder()).
		BorderForeground(Primary)

	// Tree styles
	TreeBranchStyle = lipgloss.NewStyle().
		Foreground(Muted)

	ExpandedNodeStyle = lipgloss.NewStyle().
		Foreground(Secondary)

	CollapsedNodeStyle = lipgloss.NewStyle().
		Foreground(Muted)

	// Connection status
	ConnectedStyle = lipgloss.NewStyle().
		Foreground(Secondary).
		Bold(true)

	DisconnectedStyle = lipgloss.NewStyle().
		Foreground(Danger)

	// Progress styles
	ProgressBarStyle = lipgloss.NewStyle().
		Foreground(Primary)

	ProgressTextStyle = lipgloss.NewStyle().
		Foreground(Text).
		Italic(true)
)

// Helper functions for building complex layouts
func JoinHorizontal(items ...string) string {
	return lipgloss.JoinHorizontal(lipgloss.Top, items...)
}

func JoinVertical(items ...string) string {
	return lipgloss.JoinVertical(lipgloss.Left, items...)
}

func Center(width, height int, content string) string {
	return lipgloss.Place(width, height, lipgloss.Center, lipgloss.Center, content)
}

// RenderHelpKey renders a key-value help item
func RenderHelpKey(key, desc string) string {
	return HelpKeyStyle.Render(key) + " " + HelpTextStyle.Render(desc)
}

// RenderStatusItem renders a status bar item
func RenderStatusItem(key, value string) string {
	return StatusKeyStyle.Render(key) + StatusValueStyle.Render(value)
}
