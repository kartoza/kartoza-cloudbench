package components

import (
	"bytes"
	"fmt"
	"image"
	_ "image/gif"  // Register GIF decoder
	_ "image/jpeg" // Register JPEG decoder
	_ "image/png"  // Register PNG decoder
	"io"
	"math"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/charmbracelet/bubbles/key"
	"github.com/charmbracelet/bubbles/spinner"
	"github.com/charmbracelet/bubbles/textinput"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/kartoza/kartoza-geoserver-client/internal/tui/styles"
)

// ============================================
// DATA STRUCTURES FOR STYLE EDITING
// ============================================

// GeometryType represents the type of geometry being styled
type GeometryType int

const (
	GeomTypePoint GeometryType = iota
	GeomTypeLine
	GeomTypePolygon
	GeomTypeRaster
)

func (g GeometryType) String() string {
	switch g {
	case GeomTypePoint:
		return "Point"
	case GeomTypeLine:
		return "Line"
	case GeomTypePolygon:
		return "Polygon"
	case GeomTypeRaster:
		return "Raster"
	default:
		return "Unknown"
	}
}

// MarkerShape represents available marker shapes
type MarkerShape struct {
	Name          string
	Label         string
	WellKnownName string
}

var MarkerShapes = []MarkerShape{
	{Name: "circle", Label: "Circle", WellKnownName: "circle"},
	{Name: "square", Label: "Square", WellKnownName: "square"},
	{Name: "triangle", Label: "Triangle", WellKnownName: "triangle"},
	{Name: "star", Label: "Star", WellKnownName: "star"},
	{Name: "cross", Label: "Cross", WellKnownName: "cross"},
	{Name: "x", Label: "X", WellKnownName: "x"},
	{Name: "diamond", Label: "Diamond", WellKnownName: "shape://vertline"},
	{Name: "pentagon", Label: "Pentagon", WellKnownName: "pentagon"},
	{Name: "hexagon", Label: "Hexagon", WellKnownName: "hexagon"},
}

// LineDashPattern represents line dash patterns
type LineDashPattern struct {
	Name      string
	Label     string
	DashArray string
}

var LineDashPatterns = []LineDashPattern{
	{Name: "solid", Label: "Solid", DashArray: ""},
	{Name: "dash", Label: "Dash", DashArray: "10 5"},
	{Name: "dot", Label: "Dot", DashArray: "2 5"},
	{Name: "dash-dot", Label: "Dash Dot", DashArray: "10 5 2 5"},
	{Name: "dash-dot-dot", Label: "Dash Dot Dot", DashArray: "10 5 2 5 2 5"},
	{Name: "long-dash", Label: "Long Dash", DashArray: "20 10"},
	{Name: "short-dash", Label: "Short Dash", DashArray: "5 5"},
}

// LineCapStyle represents line cap styles
type LineCapStyle struct {
	Name  string
	Label string
}

var LineCapStyles = []LineCapStyle{
	{Name: "butt", Label: "Flat"},
	{Name: "round", Label: "Round"},
	{Name: "square", Label: "Square"},
}

// LineJoinStyle represents line join styles
type LineJoinStyle struct {
	Name  string
	Label string
}

var LineJoinStyles = []LineJoinStyle{
	{Name: "miter", Label: "Miter"},
	{Name: "round", Label: "Round"},
	{Name: "bevel", Label: "Bevel"},
}

// FillPattern represents polygon fill patterns
type FillPattern struct {
	Name   string
	Label  string
	Type   string // solid, hatch, point-pattern
	Angle  int
	Double bool
}

var FillPatterns = []FillPattern{
	{Name: "solid", Label: "Solid Fill", Type: "solid"},
	{Name: "horizontal", Label: "Horizontal Lines", Type: "hatch", Angle: 0},
	{Name: "vertical", Label: "Vertical Lines", Type: "hatch", Angle: 90},
	{Name: "cross", Label: "Cross Hatch", Type: "hatch", Angle: 0, Double: true},
	{Name: "forward-diagonal", Label: "Forward Diagonal", Type: "hatch", Angle: 45},
	{Name: "backward-diagonal", Label: "Backward Diagonal", Type: "hatch", Angle: 135},
	{Name: "diagonal-cross", Label: "Diagonal Cross", Type: "hatch", Angle: 45, Double: true},
}

// ColorRamp represents a color ramp for classification
type ColorRamp struct {
	Name   string
	Label  string
	Colors []string
}

var ColorRamps = []ColorRamp{
	{Name: "blue-to-red", Label: "Blue to Red", Colors: []string{"#2166ac", "#67a9cf", "#d1e5f0", "#fddbc7", "#ef8a62", "#b2182b"}},
	{Name: "green-to-red", Label: "Green to Red", Colors: []string{"#1a9850", "#91cf60", "#d9ef8b", "#fee08b", "#fc8d59", "#d73027"}},
	{Name: "viridis", Label: "Viridis", Colors: []string{"#440154", "#443983", "#31688e", "#21918c", "#35b779", "#fde725"}},
	{Name: "spectral", Label: "Spectral", Colors: []string{"#9e0142", "#d53e4f", "#f46d43", "#fdae61", "#fee08b", "#e6f598", "#abdda4", "#66c2a5", "#3288bd", "#5e4fa2"}},
	{Name: "blues", Label: "Blues", Colors: []string{"#f7fbff", "#deebf7", "#c6dbef", "#9ecae1", "#6baed6", "#4292c6", "#2171b5", "#084594"}},
	{Name: "reds", Label: "Reds", Colors: []string{"#fff5f0", "#fee0d2", "#fcbba1", "#fc9272", "#fb6a4a", "#ef3b2c", "#cb181d", "#99000d"}},
	{Name: "greens", Label: "Greens", Colors: []string{"#f7fcf5", "#e5f5e0", "#c7e9c0", "#a1d99b", "#74c476", "#41ab5d", "#238b45", "#005a32"}},
}

// PointSymbolizer holds point style properties
type PointSymbolizer struct {
	Shape       int     // Index into MarkerShapes
	Size        float64 // Marker size in pixels
	FillColor   string  // Hex color
	FillOpacity float64 // 0.0 - 1.0
	StrokeColor string  // Hex color
	StrokeWidth float64
	Rotation    float64 // Degrees
}

// LineSymbolizer holds line style properties
type LineSymbolizer struct {
	StrokeColor   string  // Hex color
	StrokeWidth   float64
	StrokeOpacity float64 // 0.0 - 1.0
	DashPattern   int     // Index into LineDashPatterns
	LineCap       int     // Index into LineCapStyles
	LineJoin      int     // Index into LineJoinStyles
}

// PolygonSymbolizer holds polygon style properties
type PolygonSymbolizer struct {
	FillColor     string  // Hex color
	FillOpacity   float64 // 0.0 - 1.0
	FillPattern   int     // Index into FillPatterns
	StrokeColor   string  // Hex color
	StrokeWidth   float64
	StrokeOpacity float64 // 0.0 - 1.0
}

// TextSymbolizer holds label/text style properties
type TextSymbolizer struct {
	Enabled     bool
	Field       string  // Attribute field to use for labels
	FontFamily  string
	FontSize    float64
	FontColor   string  // Hex color
	FontStyle   string  // normal, italic
	FontWeight  string  // normal, bold
	HaloColor   string  // Hex color
	HaloRadius  float64
	AnchorX     float64 // 0.0 - 1.0
	AnchorY     float64 // 0.0 - 1.0
	DisplacementX float64
	DisplacementY float64
	Rotation    float64
}

// StyleRule represents a single rule in the style
type StyleRule struct {
	Name          string
	Title         string
	Filter        string  // OGC filter expression (simplified)
	MinScale      float64 // Min scale denominator (0 = no limit)
	MaxScale      float64 // Max scale denominator (0 = no limit)
	Point         *PointSymbolizer
	Line          *LineSymbolizer
	Polygon       *PolygonSymbolizer
	Text          *TextSymbolizer
}

// StyleDefinition holds the complete style definition
type StyleDefinition struct {
	Name      string
	Title     string
	GeomType  GeometryType
	Rules     []StyleRule
}

// ============================================
// STYLE EDITOR COMPONENT
// ============================================

// StyleEditorKeyMap defines key bindings for the style editor
type StyleEditorKeyMap struct {
	Close        key.Binding
	Save         key.Binding
	Preview      key.Binding
	NextField    key.Binding
	PrevField    key.Binding
	NextValue    key.Binding
	PrevValue    key.Binding
	NextRule     key.Binding
	PrevRule     key.Binding
	AddRule      key.Binding
	DeleteRule   key.Binding
	MoveRuleUp   key.Binding
	MoveRuleDown key.Binding
	EditField    key.Binding
	TogglePanel  key.Binding
}

// DefaultStyleEditorKeyMap returns default key bindings
func DefaultStyleEditorKeyMap() StyleEditorKeyMap {
	return StyleEditorKeyMap{
		Close: key.NewBinding(
			key.WithKeys("esc"),
			key.WithHelp("esc", "close/cancel"),
		),
		Save: key.NewBinding(
			key.WithKeys("ctrl+s"),
			key.WithHelp("ctrl+s", "save style"),
		),
		Preview: key.NewBinding(
			key.WithKeys("ctrl+p"),
			key.WithHelp("ctrl+p", "refresh preview"),
		),
		NextField: key.NewBinding(
			key.WithKeys("tab", "down", "j"),
			key.WithHelp("tab/↓/j", "next field"),
		),
		PrevField: key.NewBinding(
			key.WithKeys("shift+tab", "up", "k"),
			key.WithHelp("shift+tab/↑/k", "prev field"),
		),
		NextValue: key.NewBinding(
			key.WithKeys("right", "l"),
			key.WithHelp("→/l", "next value"),
		),
		PrevValue: key.NewBinding(
			key.WithKeys("left", "h"),
			key.WithHelp("←/h", "prev value"),
		),
		NextRule: key.NewBinding(
			key.WithKeys("ctrl+n", "]"),
			key.WithHelp("]/ctrl+n", "next rule"),
		),
		PrevRule: key.NewBinding(
			key.WithKeys("ctrl+p", "["),
			key.WithHelp("[/ctrl+p", "prev rule"),
		),
		AddRule: key.NewBinding(
			key.WithKeys("ctrl+a"),
			key.WithHelp("ctrl+a", "add rule"),
		),
		DeleteRule: key.NewBinding(
			key.WithKeys("ctrl+d"),
			key.WithHelp("ctrl+d", "delete rule"),
		),
		MoveRuleUp: key.NewBinding(
			key.WithKeys("ctrl+up"),
			key.WithHelp("ctrl+↑", "move rule up"),
		),
		MoveRuleDown: key.NewBinding(
			key.WithKeys("ctrl+down"),
			key.WithHelp("ctrl+↓", "move rule down"),
		),
		EditField: key.NewBinding(
			key.WithKeys("enter"),
			key.WithHelp("enter", "edit field"),
		),
		TogglePanel: key.NewBinding(
			key.WithKeys("ctrl+l"),
			key.WithHelp("ctrl+l", "toggle panel"),
		),
	}
}

// StyleEditorPanel represents which panel is focused
type StyleEditorPanel int

const (
	PanelRules StyleEditorPanel = iota
	PanelProperties
	PanelPreview
)

// PropertyField represents a single property that can be edited
type PropertyField struct {
	Name        string
	Label       string
	Type        string // color, number, select, text
	Value       interface{}
	Options     []string // For select type
	Min         float64
	Max         float64
	Step        float64
}

// StyleEditorMsg is sent for style editor events
type StyleEditorMsg struct {
	Type    string // "preview", "save", "cancel"
	Style   *StyleDefinition
	SLD     string
	Error   error
}

// StylePreviewMsg is sent when preview image is ready
type StylePreviewMsg struct {
	ImageData []byte
	Error     error
}

// StyleEditor is a WYSIWYG style editor component
type StyleEditor struct {
	// Configuration
	geoserverURL string
	username     string
	password     string
	workspace    string
	layerName    string

	// Style being edited
	style        StyleDefinition
	originalSLD  string // Original SLD for cancel/revert

	// UI state
	width        int
	height       int
	visible      bool
	activePanel  StyleEditorPanel
	selectedRule int
	selectedField int
	editingField bool

	// Preview state
	previewImage    image.Image
	previewRendered string
	previewLoading  bool
	previewError    string

	// Input fields for editing
	activeInput  textinput.Model

	// Available fields for the layer (for labels)
	layerFields  []string

	// Components
	keyMap      StyleEditorKeyMap
	spinner     spinner.Model
	colorPicker *ColorPicker // Color picker for editing color fields
	editingColorField string // Name of the field being edited with color picker

	// Callbacks
	onSave   func(string) // Called with generated SLD
	onCancel func()
}

// NewStyleEditor creates a new style editor
func NewStyleEditor(geoserverURL, username, password, workspace, layerName string) *StyleEditor {
	s := spinner.New()
	s.Spinner = spinner.Dot
	s.Style = styles.LoadingStyle

	input := textinput.New()
	input.CharLimit = 50

	// Create default style based on geometry type (will be updated when layer info loads)
	defaultStyle := StyleDefinition{
		Name:     "NewStyle",
		Title:    "New Style",
		GeomType: GeomTypePolygon,
		Rules: []StyleRule{
			{
				Name:  "Default",
				Title: "Default Rule",
				Polygon: &PolygonSymbolizer{
					FillColor:     "#3388ff",
					FillOpacity:   0.6,
					FillPattern:   0,
					StrokeColor:   "#2266cc",
					StrokeWidth:   1,
					StrokeOpacity: 1.0,
				},
			},
		},
	}

	return &StyleEditor{
		geoserverURL: strings.TrimSuffix(geoserverURL, "/"),
		username:     username,
		password:     password,
		workspace:    workspace,
		layerName:    layerName,
		style:        defaultStyle,
		visible:      true,
		activePanel:  PanelProperties,
		selectedRule: 0,
		selectedField: 0,
		keyMap:       DefaultStyleEditorKeyMap(),
		spinner:      s,
		activeInput:  input,
	}
}

// SetGeometryType sets the geometry type and initializes appropriate symbolizers
func (e *StyleEditor) SetGeometryType(geomType GeometryType) {
	e.style.GeomType = geomType

	// Update rules with appropriate symbolizers
	for i := range e.style.Rules {
		rule := &e.style.Rules[i]
		switch geomType {
		case GeomTypePoint:
			if rule.Point == nil {
				rule.Point = &PointSymbolizer{
					Shape:       0, // Circle
					Size:        8,
					FillColor:   "#3388ff",
					FillOpacity: 1.0,
					StrokeColor: "#2266cc",
					StrokeWidth: 1,
					Rotation:    0,
				}
			}
			rule.Line = nil
			rule.Polygon = nil
		case GeomTypeLine:
			if rule.Line == nil {
				rule.Line = &LineSymbolizer{
					StrokeColor:   "#3388ff",
					StrokeWidth:   2,
					StrokeOpacity: 1.0,
					DashPattern:   0, // Solid
					LineCap:       1, // Round
					LineJoin:      1, // Round
				}
			}
			rule.Point = nil
			rule.Polygon = nil
		case GeomTypePolygon:
			if rule.Polygon == nil {
				rule.Polygon = &PolygonSymbolizer{
					FillColor:     "#3388ff",
					FillOpacity:   0.6,
					FillPattern:   0, // Solid
					StrokeColor:   "#2266cc",
					StrokeWidth:   1,
					StrokeOpacity: 1.0,
				}
			}
			rule.Point = nil
			rule.Line = nil
		}
	}
}

// SetLayerFields sets the available fields for labeling
func (e *StyleEditor) SetLayerFields(fields []string) {
	e.layerFields = fields
}

// SetCallbacks sets the save and cancel callbacks
func (e *StyleEditor) SetCallbacks(onSave func(string), onCancel func()) {
	e.onSave = onSave
	e.onCancel = onCancel
}

// SetSize sets the editor size
func (e *StyleEditor) SetSize(width, height int) {
	e.width = width
	e.height = height
}

// GetStyleName returns the name of the style being edited
func (e *StyleEditor) GetStyleName() string {
	return e.style.Name
}

// SetStyleName sets the name of the style
func (e *StyleEditor) SetStyleName(name string) {
	e.style.Name = name
}

// GetWorkspace returns the workspace
func (e *StyleEditor) GetWorkspace() string {
	return e.workspace
}

// IsVisible returns whether the editor is visible
func (e *StyleEditor) IsVisible() bool {
	return e.visible
}

// Hide hides the editor
func (e *StyleEditor) Hide() {
	e.visible = false
}

// Init initializes the editor
func (e *StyleEditor) Init() tea.Cmd {
	return tea.Batch(
		e.spinner.Tick,
		e.fetchPreview(),
	)
}

// Update handles messages
func (e *StyleEditor) Update(msg tea.Msg) (*StyleEditor, tea.Cmd) {
	var cmds []tea.Cmd

	switch msg := msg.(type) {
	case tea.KeyMsg:
		if !e.visible {
			return e, nil
		}

		// If color picker is open, forward keys to it
		if e.colorPicker != nil && e.colorPicker.IsVisible() {
			var cmd tea.Cmd
			e.colorPicker, cmd = e.colorPicker.Update(msg)
			if cmd != nil {
				cmds = append(cmds, cmd)
			}
			// Check if color picker was closed
			if !e.colorPicker.IsVisible() {
				e.colorPicker = nil
				e.editingColorField = ""
				// Refresh preview after color selection
				cmds = append(cmds, e.fetchPreview())
			}
			return e, tea.Batch(cmds...)
		}

		if e.editingField {
			return e.updateFieldEditing(msg)
		}

		switch {
		case key.Matches(msg, e.keyMap.Close):
			if e.onCancel != nil {
				e.onCancel()
			}
			e.visible = false
			return e, nil

		case key.Matches(msg, e.keyMap.Save):
			sld := e.GenerateSLD()
			if e.onSave != nil {
				e.onSave(sld)
			}
			return e, nil

		case key.Matches(msg, e.keyMap.Preview):
			e.previewLoading = true
			return e, e.fetchPreview()

		case key.Matches(msg, e.keyMap.NextField):
			e.nextField()
			return e, nil

		case key.Matches(msg, e.keyMap.PrevField):
			e.prevField()
			return e, nil

		case key.Matches(msg, e.keyMap.NextValue):
			e.adjustValue(1)
			return e, e.fetchPreview()

		case key.Matches(msg, e.keyMap.PrevValue):
			e.adjustValue(-1)
			return e, e.fetchPreview()

		case key.Matches(msg, e.keyMap.EditField):
			return e.startFieldEdit()

		case key.Matches(msg, e.keyMap.NextRule):
			e.nextRule()
			return e, e.fetchPreview()

		case key.Matches(msg, e.keyMap.PrevRule):
			e.prevRule()
			return e, e.fetchPreview()

		case key.Matches(msg, e.keyMap.AddRule):
			e.addRule()
			return e, e.fetchPreview()

		case key.Matches(msg, e.keyMap.DeleteRule):
			e.deleteRule()
			return e, e.fetchPreview()

		case key.Matches(msg, e.keyMap.TogglePanel):
			e.activePanel = (e.activePanel + 1) % 3
			return e, nil
		}

	case StylePreviewMsg:
		e.previewLoading = false
		if msg.Error != nil {
			e.previewError = msg.Error.Error()
		} else if len(msg.ImageData) > 0 {
			if img, _, err := image.Decode(bytes.NewReader(msg.ImageData)); err == nil {
				e.previewImage = img
				e.previewRendered = e.renderPreviewImage()
				e.previewError = ""
			} else {
				e.previewError = "Failed to decode preview: " + err.Error()
			}
		}
		return e, nil

	case spinner.TickMsg:
		var cmd tea.Cmd
		e.spinner, cmd = e.spinner.Update(msg)
		cmds = append(cmds, cmd)
	}

	return e, tea.Batch(cmds...)
}

// updateFieldEditing handles key input when editing a field
func (e *StyleEditor) updateFieldEditing(msg tea.KeyMsg) (*StyleEditor, tea.Cmd) {
	switch msg.String() {
	case "enter":
		// Apply the value
		e.applyFieldEdit()
		e.editingField = false
		e.activeInput.Blur()
		return e, e.fetchPreview()
	case "esc":
		// Cancel editing
		e.editingField = false
		e.activeInput.Blur()
		return e, nil
	default:
		var cmd tea.Cmd
		e.activeInput, cmd = e.activeInput.Update(msg)
		return e, cmd
	}
}

// getPropertyFields returns the editable fields for the current rule
func (e *StyleEditor) getPropertyFields() []PropertyField {
	if e.selectedRule >= len(e.style.Rules) {
		return nil
	}

	rule := &e.style.Rules[e.selectedRule]
	var fields []PropertyField

	// Always include style name and rule name as first fields
	fields = append(fields,
		PropertyField{Name: "style_name", Label: "Style Name", Type: "text", Value: e.style.Name},
		PropertyField{Name: "rule_name", Label: "Rule Name", Type: "text", Value: rule.Name},
	)

	switch e.style.GeomType {
	case GeomTypePoint:
		if rule.Point != nil {
			fields = append(fields,
				PropertyField{Name: "shape", Label: "Shape", Type: "select", Value: rule.Point.Shape, Options: getMarkerShapeNames()},
				PropertyField{Name: "size", Label: "Size", Type: "number", Value: rule.Point.Size, Min: 1, Max: 100, Step: 1},
				PropertyField{Name: "fill_color", Label: "Fill Color", Type: "color", Value: rule.Point.FillColor},
				PropertyField{Name: "fill_opacity", Label: "Fill Opacity", Type: "number", Value: rule.Point.FillOpacity, Min: 0, Max: 1, Step: 0.1},
				PropertyField{Name: "stroke_color", Label: "Stroke Color", Type: "color", Value: rule.Point.StrokeColor},
				PropertyField{Name: "stroke_width", Label: "Stroke Width", Type: "number", Value: rule.Point.StrokeWidth, Min: 0, Max: 10, Step: 0.5},
				PropertyField{Name: "rotation", Label: "Rotation", Type: "number", Value: rule.Point.Rotation, Min: 0, Max: 360, Step: 15},
			)
		}
	case GeomTypeLine:
		if rule.Line != nil {
			fields = append(fields,
				PropertyField{Name: "stroke_color", Label: "Color", Type: "color", Value: rule.Line.StrokeColor},
				PropertyField{Name: "stroke_width", Label: "Width", Type: "number", Value: rule.Line.StrokeWidth, Min: 0.5, Max: 20, Step: 0.5},
				PropertyField{Name: "stroke_opacity", Label: "Opacity", Type: "number", Value: rule.Line.StrokeOpacity, Min: 0, Max: 1, Step: 0.1},
				PropertyField{Name: "dash_pattern", Label: "Dash Pattern", Type: "select", Value: rule.Line.DashPattern, Options: getDashPatternNames()},
				PropertyField{Name: "line_cap", Label: "Line Cap", Type: "select", Value: rule.Line.LineCap, Options: getLineCapNames()},
				PropertyField{Name: "line_join", Label: "Line Join", Type: "select", Value: rule.Line.LineJoin, Options: getLineJoinNames()},
			)
		}
	case GeomTypePolygon:
		if rule.Polygon != nil {
			fields = append(fields,
				PropertyField{Name: "fill_color", Label: "Fill Color", Type: "color", Value: rule.Polygon.FillColor},
				PropertyField{Name: "fill_opacity", Label: "Fill Opacity", Type: "number", Value: rule.Polygon.FillOpacity, Min: 0, Max: 1, Step: 0.1},
				PropertyField{Name: "fill_pattern", Label: "Fill Pattern", Type: "select", Value: rule.Polygon.FillPattern, Options: getFillPatternNames()},
				PropertyField{Name: "stroke_color", Label: "Stroke Color", Type: "color", Value: rule.Polygon.StrokeColor},
				PropertyField{Name: "stroke_width", Label: "Stroke Width", Type: "number", Value: rule.Polygon.StrokeWidth, Min: 0, Max: 10, Step: 0.5},
				PropertyField{Name: "stroke_opacity", Label: "Stroke Opacity", Type: "number", Value: rule.Polygon.StrokeOpacity, Min: 0, Max: 1, Step: 0.1},
			)
		}
	}

	return fields
}

// nextField moves to the next field
func (e *StyleEditor) nextField() {
	fields := e.getPropertyFields()
	if len(fields) > 0 {
		e.selectedField = (e.selectedField + 1) % len(fields)
	}
}

// prevField moves to the previous field
func (e *StyleEditor) prevField() {
	fields := e.getPropertyFields()
	if len(fields) > 0 {
		e.selectedField--
		if e.selectedField < 0 {
			e.selectedField = len(fields) - 1
		}
	}
}

// adjustValue adjusts the current field value
func (e *StyleEditor) adjustValue(delta int) {
	fields := e.getPropertyFields()
	if e.selectedField >= len(fields) {
		return
	}

	field := fields[e.selectedField]
	rule := &e.style.Rules[e.selectedRule]

	switch field.Type {
	case "select":
		// Cycle through options
		currentIdx := 0
		switch v := field.Value.(type) {
		case int:
			currentIdx = v
		}
		newIdx := currentIdx + delta
		if newIdx < 0 {
			newIdx = len(field.Options) - 1
		} else if newIdx >= len(field.Options) {
			newIdx = 0
		}
		e.setFieldValue(rule, field.Name, newIdx)

	case "number":
		// Increment/decrement by step
		currentVal := 0.0
		switch v := field.Value.(type) {
		case float64:
			currentVal = v
		case int:
			currentVal = float64(v)
		}
		newVal := currentVal + float64(delta)*field.Step
		if newVal < field.Min {
			newVal = field.Min
		}
		if newVal > field.Max {
			newVal = field.Max
		}
		e.setFieldValue(rule, field.Name, newVal)

	case "color":
		// For colors, cycle through presets or open color picker
		presetColors := []string{"#3388ff", "#ff3333", "#33ff33", "#ffff33", "#ff33ff", "#33ffff", "#ffffff", "#000000"}
		currentColor := ""
		switch v := field.Value.(type) {
		case string:
			currentColor = v
		}
		currentIdx := -1
		for i, c := range presetColors {
			if c == currentColor {
				currentIdx = i
				break
			}
		}
		newIdx := currentIdx + delta
		if newIdx < 0 {
			newIdx = len(presetColors) - 1
		} else if newIdx >= len(presetColors) {
			newIdx = 0
		}
		e.setFieldValue(rule, field.Name, presetColors[newIdx])
	}
}

// setFieldValue sets a field value on a rule
func (e *StyleEditor) setFieldValue(rule *StyleRule, fieldName string, value interface{}) {
	switch e.style.GeomType {
	case GeomTypePoint:
		if rule.Point != nil {
			switch fieldName {
			case "shape":
				if v, ok := value.(int); ok {
					rule.Point.Shape = v
				}
			case "size":
				if v, ok := value.(float64); ok {
					rule.Point.Size = v
				}
			case "fill_color":
				if v, ok := value.(string); ok {
					rule.Point.FillColor = v
				}
			case "fill_opacity":
				if v, ok := value.(float64); ok {
					rule.Point.FillOpacity = v
				}
			case "stroke_color":
				if v, ok := value.(string); ok {
					rule.Point.StrokeColor = v
				}
			case "stroke_width":
				if v, ok := value.(float64); ok {
					rule.Point.StrokeWidth = v
				}
			case "rotation":
				if v, ok := value.(float64); ok {
					rule.Point.Rotation = v
				}
			}
		}
	case GeomTypeLine:
		if rule.Line != nil {
			switch fieldName {
			case "stroke_color":
				if v, ok := value.(string); ok {
					rule.Line.StrokeColor = v
				}
			case "stroke_width":
				if v, ok := value.(float64); ok {
					rule.Line.StrokeWidth = v
				}
			case "stroke_opacity":
				if v, ok := value.(float64); ok {
					rule.Line.StrokeOpacity = v
				}
			case "dash_pattern":
				if v, ok := value.(int); ok {
					rule.Line.DashPattern = v
				}
			case "line_cap":
				if v, ok := value.(int); ok {
					rule.Line.LineCap = v
				}
			case "line_join":
				if v, ok := value.(int); ok {
					rule.Line.LineJoin = v
				}
			}
		}
	case GeomTypePolygon:
		if rule.Polygon != nil {
			switch fieldName {
			case "fill_color":
				if v, ok := value.(string); ok {
					rule.Polygon.FillColor = v
				}
			case "fill_opacity":
				if v, ok := value.(float64); ok {
					rule.Polygon.FillOpacity = v
				}
			case "fill_pattern":
				if v, ok := value.(int); ok {
					rule.Polygon.FillPattern = v
				}
			case "stroke_color":
				if v, ok := value.(string); ok {
					rule.Polygon.StrokeColor = v
				}
			case "stroke_width":
				if v, ok := value.(float64); ok {
					rule.Polygon.StrokeWidth = v
				}
			case "stroke_opacity":
				if v, ok := value.(float64); ok {
					rule.Polygon.StrokeOpacity = v
				}
			}
		}
	}
}

// startFieldEdit begins editing a field
func (e *StyleEditor) startFieldEdit() (*StyleEditor, tea.Cmd) {
	fields := e.getPropertyFields()
	if e.selectedField >= len(fields) {
		return e, nil
	}

	field := fields[e.selectedField]

	// For color fields, open the color picker
	if field.Type == "color" {
		currentColor := "#3388ff"
		if v, ok := field.Value.(string); ok {
			currentColor = v
		}
		e.colorPicker = NewColorPicker(currentColor)
		e.colorPicker.SetSize(60, 20)
		e.editingColorField = field.Name

		// Set callbacks for color picker
		rule := &e.style.Rules[e.selectedRule]
		e.colorPicker.SetCallbacks(
			func(result ColorPickerResult) {
				if result.Confirmed {
					e.setFieldValue(rule, field.Name, result.Color)
				}
				e.colorPicker = nil
				e.editingColorField = ""
			},
			func() {
				e.colorPicker = nil
				e.editingColorField = ""
			},
		)
		return e, e.colorPicker.Init()
	}

	// For number and text types, use text input
	if field.Type == "number" || field.Type == "text" {
		e.editingField = true
		e.activeInput.Reset()
		switch v := field.Value.(type) {
		case string:
			e.activeInput.SetValue(v)
		case float64:
			e.activeInput.SetValue(fmt.Sprintf("%.2f", v))
		case int:
			e.activeInput.SetValue(fmt.Sprintf("%d", v))
		}
		e.activeInput.Focus()
	}
	return e, nil
}

// applyFieldEdit applies the edited value
func (e *StyleEditor) applyFieldEdit() {
	fields := e.getPropertyFields()
	if e.selectedField >= len(fields) {
		return
	}

	field := fields[e.selectedField]
	value := e.activeInput.Value()

	// Handle style-level and rule-level name fields
	switch field.Name {
	case "style_name":
		if value != "" {
			e.style.Name = value
		}
		return
	case "rule_name":
		if value != "" && e.selectedRule < len(e.style.Rules) {
			e.style.Rules[e.selectedRule].Name = value
			e.style.Rules[e.selectedRule].Title = value
		}
		return
	}

	// Handle other fields
	rule := &e.style.Rules[e.selectedRule]

	switch field.Type {
	case "color":
		// Validate hex color
		if strings.HasPrefix(value, "#") && (len(value) == 7 || len(value) == 4) {
			e.setFieldValue(rule, field.Name, value)
		}
	case "number":
		if f, err := strconv.ParseFloat(value, 64); err == nil {
			if f >= field.Min && f <= field.Max {
				e.setFieldValue(rule, field.Name, f)
			}
		}
	case "text":
		e.setFieldValue(rule, field.Name, value)
	}
}

// addRule adds a new rule
func (e *StyleEditor) addRule() {
	newRule := StyleRule{
		Name:  fmt.Sprintf("Rule %d", len(e.style.Rules)+1),
		Title: fmt.Sprintf("Rule %d", len(e.style.Rules)+1),
	}

	// Copy symbolizer from current rule or create default
	switch e.style.GeomType {
	case GeomTypePoint:
		newRule.Point = &PointSymbolizer{
			Shape:       0,
			Size:        8,
			FillColor:   "#ff6600",
			FillOpacity: 1.0,
			StrokeColor: "#cc4400",
			StrokeWidth: 1,
		}
	case GeomTypeLine:
		newRule.Line = &LineSymbolizer{
			StrokeColor:   "#ff6600",
			StrokeWidth:   2,
			StrokeOpacity: 1.0,
			DashPattern:   0,
			LineCap:       1,
			LineJoin:      1,
		}
	case GeomTypePolygon:
		newRule.Polygon = &PolygonSymbolizer{
			FillColor:     "#ff6600",
			FillOpacity:   0.6,
			FillPattern:   0,
			StrokeColor:   "#cc4400",
			StrokeWidth:   1,
			StrokeOpacity: 1.0,
		}
	}

	e.style.Rules = append(e.style.Rules, newRule)
	e.selectedRule = len(e.style.Rules) - 1
}

// deleteRule deletes the current rule
func (e *StyleEditor) deleteRule() {
	if len(e.style.Rules) <= 1 {
		return // Keep at least one rule
	}

	e.style.Rules = append(e.style.Rules[:e.selectedRule], e.style.Rules[e.selectedRule+1:]...)
	if e.selectedRule >= len(e.style.Rules) {
		e.selectedRule = len(e.style.Rules) - 1
	}
}

// nextRule switches to the next rule
func (e *StyleEditor) nextRule() {
	if len(e.style.Rules) <= 1 {
		return
	}
	e.selectedRule = (e.selectedRule + 1) % len(e.style.Rules)
	e.selectedField = 0 // Reset field selection when switching rules
}

// prevRule switches to the previous rule
func (e *StyleEditor) prevRule() {
	if len(e.style.Rules) <= 1 {
		return
	}
	e.selectedRule--
	if e.selectedRule < 0 {
		e.selectedRule = len(e.style.Rules) - 1
	}
	e.selectedField = 0 // Reset field selection when switching rules
}

// fetchPreview fetches a preview of the style
func (e *StyleEditor) fetchPreview() tea.Cmd {
	return func() tea.Msg {
		// Generate SLD and request preview via WMS with SLD_BODY
		sld := e.GenerateSLD()

		// Build WMS GetMap URL with SLD_BODY
		layer := fmt.Sprintf("%s:%s", e.workspace, e.layerName)
		wmsURL := fmt.Sprintf("%s/wms?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=%s&SLD_BODY=%s&FORMAT=image/png&SRS=EPSG:4326&WIDTH=400&HEIGHT=300&BBOX=-180,-90,180,90",
			e.geoserverURL,
			url.QueryEscape(layer),
			url.QueryEscape(sld))

		req, err := http.NewRequest("GET", wmsURL, nil)
		if err != nil {
			return StylePreviewMsg{Error: err}
		}
		req.SetBasicAuth(e.username, e.password)

		client := &http.Client{Timeout: 30 * time.Second}
		resp, err := client.Do(req)
		if err != nil {
			return StylePreviewMsg{Error: err}
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			body, _ := io.ReadAll(resp.Body)
			return StylePreviewMsg{Error: fmt.Errorf("WMS error (%d): %s", resp.StatusCode, string(body))}
		}

		data, err := io.ReadAll(resp.Body)
		if err != nil {
			return StylePreviewMsg{Error: err}
		}

		return StylePreviewMsg{ImageData: data}
	}
}

// renderPreviewImage renders the preview image to terminal
func (e *StyleEditor) renderPreviewImage() string {
	if e.previewImage == nil {
		return ""
	}

	// Simple ASCII rendering for now - can be enhanced with chafa later
	bounds := e.previewImage.Bounds()
	width := bounds.Dx()
	height := bounds.Dy()

	// Scale down to fit
	maxWidth := e.width / 3
	maxHeight := e.height - 10

	scaleX := float64(maxWidth) / float64(width)
	scaleY := float64(maxHeight) / float64(height) * 2 // *2 because terminal chars are taller than wide
	scale := math.Min(scaleX, scaleY)

	newWidth := int(float64(width) * scale)
	newHeight := int(float64(height) * scale / 2)

	if newWidth < 10 {
		newWidth = 10
	}
	if newHeight < 5 {
		newHeight = 5
	}

	var sb strings.Builder
	for y := 0; y < newHeight; y++ {
		for x := 0; x < newWidth; x++ {
			// Sample the image
			srcX := int(float64(x) / float64(newWidth) * float64(width))
			srcY := int(float64(y) / float64(newHeight) * float64(height))

			if srcX >= width {
				srcX = width - 1
			}
			if srcY >= height {
				srcY = height - 1
			}

			c := e.previewImage.At(bounds.Min.X+srcX, bounds.Min.Y+srcY)
			r, g, b, _ := c.RGBA()

			// Convert to grayscale for ASCII
			gray := (r + g + b) / 3 / 256

			// Choose character based on brightness
			chars := " .:-=+*#%@"
			idx := int(float64(gray) / 256.0 * float64(len(chars)))
			if idx >= len(chars) {
				idx = len(chars) - 1
			}
			sb.WriteByte(chars[idx])
		}
		sb.WriteString("\n")
	}

	return sb.String()
}

// View renders the style editor
func (e *StyleEditor) View() string {
	if !e.visible {
		return ""
	}

	// Split view: left = properties panel, right = preview
	leftWidth := e.width * 2 / 3
	rightWidth := e.width - leftWidth - 3

	// Build left panel (properties)
	leftPanel := e.renderPropertiesPanel(leftWidth)

	// Build right panel (preview)
	rightPanel := e.renderPreviewPanel(rightWidth)

	// Combine panels
	content := lipgloss.JoinHorizontal(
		lipgloss.Top,
		leftPanel,
		" ",
		rightPanel,
	)

	// Help bar
	helpText := "↑↓/jk: nav  ←→/hl: adjust  []: switch rule  enter: edit  ctrl+s: save  ctrl+a: add rule  esc: cancel"
	helpBar := styles.HelpBarStyle.Width(e.width).Render(helpText)

	mainView := lipgloss.JoinVertical(
		lipgloss.Left,
		content,
		helpBar,
	)

	// If color picker is open, render it as an overlay
	if e.colorPicker != nil && e.colorPicker.IsVisible() {
		colorPickerView := e.colorPicker.View()
		// Center the color picker on top of the main view
		return styles.Center(e.width, e.height, colorPickerView)
	}

	return mainView
}

// renderPropertiesPanel renders the properties editing panel
func (e *StyleEditor) renderPropertiesPanel(width int) string {
	var sb strings.Builder

	// Title
	title := fmt.Sprintf(" Style Editor: %s (%s) ", e.style.Name, e.style.GeomType)
	sb.WriteString(styles.TitleStyle.Width(width).Render(title))
	sb.WriteString("\n\n")

	// Rules list
	sb.WriteString(styles.PanelHeaderStyle.Render("Rules:"))
	sb.WriteString("\n")
	for i, rule := range e.style.Rules {
		cursor := "  "
		style := styles.ItemStyle
		if i == e.selectedRule {
			cursor = "> "
			style = styles.SelectedItemStyle
		}
		sb.WriteString(style.Render(fmt.Sprintf("%s%s", cursor, rule.Name)))
		sb.WriteString("\n")
	}
	sb.WriteString("\n")

	// Properties for selected rule
	sb.WriteString(styles.PanelHeaderStyle.Render("Properties:"))
	sb.WriteString("\n")

	fields := e.getPropertyFields()
	for i, field := range fields {
		cursor := "  "
		style := styles.ItemStyle
		if i == e.selectedField {
			cursor = "> "
			style = styles.SelectedItemStyle
		}

		// Format value based on type
		valueStr := ""
		switch field.Type {
		case "text":
			if v, ok := field.Value.(string); ok {
				valueStr = v
			}
		case "color":
			if v, ok := field.Value.(string); ok {
				// Show color swatch using background
				colorStyle := lipgloss.NewStyle().Background(lipgloss.Color(v)).Foreground(lipgloss.Color("#ffffff"))
				valueStr = colorStyle.Render(fmt.Sprintf(" %s ", v))
			}
		case "number":
			switch v := field.Value.(type) {
			case float64:
				valueStr = fmt.Sprintf("%.2f", v)
			case int:
				valueStr = fmt.Sprintf("%d", v)
			}
		case "select":
			if v, ok := field.Value.(int); ok && v < len(field.Options) {
				valueStr = field.Options[v]
			}
		}

		// If editing this field, show input
		if e.editingField && i == e.selectedField {
			valueStr = e.activeInput.View()
		}

		line := fmt.Sprintf("%s%-15s: %s", cursor, field.Label, valueStr)
		sb.WriteString(style.Render(line))
		sb.WriteString("\n")
	}

	return styles.PanelStyle.Width(width).Height(e.height - 4).Render(sb.String())
}

// renderPreviewPanel renders the preview panel
func (e *StyleEditor) renderPreviewPanel(width int) string {
	var sb strings.Builder

	sb.WriteString(styles.TitleStyle.Width(width).Render(" Preview "))
	sb.WriteString("\n\n")

	if e.previewLoading {
		sb.WriteString(e.spinner.View())
		sb.WriteString(" Loading preview...")
	} else if e.previewError != "" {
		sb.WriteString(styles.ErrorStyle.Render("Error: " + e.previewError))
	} else if e.previewRendered != "" {
		sb.WriteString(e.previewRendered)
	} else {
		sb.WriteString("No preview available")
	}

	return styles.PanelStyle.Width(width).Height(e.height - 4).Render(sb.String())
}

// GenerateSLD generates the SLD XML from the style definition
func (e *StyleEditor) GenerateSLD() string {
	var sb strings.Builder

	sb.WriteString(`<?xml version="1.0" encoding="UTF-8"?>
<StyledLayerDescriptor version="1.0.0"
  xsi:schemaLocation="http://www.opengis.net/sld StyledLayerDescriptor.xsd"
  xmlns="http://www.opengis.net/sld"
  xmlns:ogc="http://www.opengis.net/ogc"
  xmlns:xlink="http://www.w3.org/1999/xlink"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <NamedLayer>
`)
	sb.WriteString(fmt.Sprintf("    <Name>%s</Name>\n", e.style.Name))
	sb.WriteString("    <UserStyle>\n")
	sb.WriteString(fmt.Sprintf("      <Title>%s</Title>\n", e.style.Title))
	sb.WriteString("      <FeatureTypeStyle>\n")

	for _, rule := range e.style.Rules {
		sb.WriteString("        <Rule>\n")
		sb.WriteString(fmt.Sprintf("          <Name>%s</Name>\n", rule.Name))

		// Add filter if present
		if rule.Filter != "" {
			sb.WriteString(fmt.Sprintf("          %s\n", rule.Filter))
		}

		// Add scale denominators if set
		if rule.MinScale > 0 {
			sb.WriteString(fmt.Sprintf("          <MinScaleDenominator>%.0f</MinScaleDenominator>\n", rule.MinScale))
		}
		if rule.MaxScale > 0 {
			sb.WriteString(fmt.Sprintf("          <MaxScaleDenominator>%.0f</MaxScaleDenominator>\n", rule.MaxScale))
		}

		// Add symbolizer based on geometry type
		switch e.style.GeomType {
		case GeomTypePoint:
			if rule.Point != nil {
				sb.WriteString(e.generatePointSymbolizerSLD(rule.Point))
			}
		case GeomTypeLine:
			if rule.Line != nil {
				sb.WriteString(e.generateLineSymbolizerSLD(rule.Line))
			}
		case GeomTypePolygon:
			if rule.Polygon != nil {
				sb.WriteString(e.generatePolygonSymbolizerSLD(rule.Polygon))
			}
		}

		// Add text symbolizer if enabled
		if rule.Text != nil && rule.Text.Enabled {
			sb.WriteString(e.generateTextSymbolizerSLD(rule.Text))
		}

		sb.WriteString("        </Rule>\n")
	}

	sb.WriteString("      </FeatureTypeStyle>\n")
	sb.WriteString("    </UserStyle>\n")
	sb.WriteString("  </NamedLayer>\n")
	sb.WriteString("</StyledLayerDescriptor>")

	return sb.String()
}

// generatePointSymbolizerSLD generates SLD for point symbolizer
func (e *StyleEditor) generatePointSymbolizerSLD(p *PointSymbolizer) string {
	shape := "circle"
	if p.Shape < len(MarkerShapes) {
		shape = MarkerShapes[p.Shape].WellKnownName
	}

	return fmt.Sprintf(`          <PointSymbolizer>
            <Graphic>
              <Mark>
                <WellKnownName>%s</WellKnownName>
                <Fill>
                  <CssParameter name="fill">%s</CssParameter>
                  <CssParameter name="fill-opacity">%.2f</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">%s</CssParameter>
                  <CssParameter name="stroke-width">%.1f</CssParameter>
                </Stroke>
              </Mark>
              <Size>%.1f</Size>
              <Rotation>%.1f</Rotation>
            </Graphic>
          </PointSymbolizer>
`, shape, p.FillColor, p.FillOpacity, p.StrokeColor, p.StrokeWidth, p.Size, p.Rotation)
}

// generateLineSymbolizerSLD generates SLD for line symbolizer
func (e *StyleEditor) generateLineSymbolizerSLD(l *LineSymbolizer) string {
	var sb strings.Builder

	sb.WriteString("          <LineSymbolizer>\n")
	sb.WriteString("            <Stroke>\n")
	sb.WriteString(fmt.Sprintf("              <CssParameter name=\"stroke\">%s</CssParameter>\n", l.StrokeColor))
	sb.WriteString(fmt.Sprintf("              <CssParameter name=\"stroke-width\">%.1f</CssParameter>\n", l.StrokeWidth))
	sb.WriteString(fmt.Sprintf("              <CssParameter name=\"stroke-opacity\">%.2f</CssParameter>\n", l.StrokeOpacity))

	// Dash pattern
	if l.DashPattern > 0 && l.DashPattern < len(LineDashPatterns) {
		dashArray := LineDashPatterns[l.DashPattern].DashArray
		if dashArray != "" {
			sb.WriteString(fmt.Sprintf("              <CssParameter name=\"stroke-dasharray\">%s</CssParameter>\n", dashArray))
		}
	}

	// Line cap
	if l.LineCap < len(LineCapStyles) {
		sb.WriteString(fmt.Sprintf("              <CssParameter name=\"stroke-linecap\">%s</CssParameter>\n", LineCapStyles[l.LineCap].Name))
	}

	// Line join
	if l.LineJoin < len(LineJoinStyles) {
		sb.WriteString(fmt.Sprintf("              <CssParameter name=\"stroke-linejoin\">%s</CssParameter>\n", LineJoinStyles[l.LineJoin].Name))
	}

	sb.WriteString("            </Stroke>\n")
	sb.WriteString("          </LineSymbolizer>\n")

	return sb.String()
}

// generatePolygonSymbolizerSLD generates SLD for polygon symbolizer
func (e *StyleEditor) generatePolygonSymbolizerSLD(p *PolygonSymbolizer) string {
	return fmt.Sprintf(`          <PolygonSymbolizer>
            <Fill>
              <CssParameter name="fill">%s</CssParameter>
              <CssParameter name="fill-opacity">%.2f</CssParameter>
            </Fill>
            <Stroke>
              <CssParameter name="stroke">%s</CssParameter>
              <CssParameter name="stroke-width">%.1f</CssParameter>
              <CssParameter name="stroke-opacity">%.2f</CssParameter>
            </Stroke>
          </PolygonSymbolizer>
`, p.FillColor, p.FillOpacity, p.StrokeColor, p.StrokeWidth, p.StrokeOpacity)
}

// generateTextSymbolizerSLD generates SLD for text symbolizer
func (e *StyleEditor) generateTextSymbolizerSLD(t *TextSymbolizer) string {
	return fmt.Sprintf(`          <TextSymbolizer>
            <Label>
              <ogc:PropertyName>%s</ogc:PropertyName>
            </Label>
            <Font>
              <CssParameter name="font-family">%s</CssParameter>
              <CssParameter name="font-size">%.1f</CssParameter>
              <CssParameter name="font-style">%s</CssParameter>
              <CssParameter name="font-weight">%s</CssParameter>
            </Font>
            <Fill>
              <CssParameter name="fill">%s</CssParameter>
            </Fill>
            <Halo>
              <Radius>%.1f</Radius>
              <Fill>
                <CssParameter name="fill">%s</CssParameter>
              </Fill>
            </Halo>
          </TextSymbolizer>
`, t.Field, t.FontFamily, t.FontSize, t.FontStyle, t.FontWeight, t.FontColor, t.HaloRadius, t.HaloColor)
}

// Helper functions to get option names
func getMarkerShapeNames() []string {
	names := make([]string, len(MarkerShapes))
	for i, s := range MarkerShapes {
		names[i] = s.Label
	}
	return names
}

func getDashPatternNames() []string {
	names := make([]string, len(LineDashPatterns))
	for i, p := range LineDashPatterns {
		names[i] = p.Label
	}
	return names
}

func getLineCapNames() []string {
	names := make([]string, len(LineCapStyles))
	for i, s := range LineCapStyles {
		names[i] = s.Label
	}
	return names
}

func getLineJoinNames() []string {
	names := make([]string, len(LineJoinStyles))
	for i, s := range LineJoinStyles {
		names[i] = s.Label
	}
	return names
}

func getFillPatternNames() []string {
	names := make([]string, len(FillPatterns))
	for i, p := range FillPatterns {
		names[i] = p.Label
	}
	return names
}

