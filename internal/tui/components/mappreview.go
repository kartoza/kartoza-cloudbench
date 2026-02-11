package components

import (
	"bytes"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	_ "image/gif"  // Register GIF decoder
	_ "image/jpeg" // Register JPEG decoder
	"image/png"
	"io"
	"math"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"strings"
	"time"

	"github.com/charmbracelet/bubbles/key"
	"github.com/charmbracelet/bubbles/spinner"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/kartoza/kartoza-geoserver-client/internal/tui/styles"
)

// ImageProtocol represents the terminal image rendering protocol
type ImageProtocol int

const (
	ProtocolNone ImageProtocol = iota
	ProtocolKitty
	ProtocolSixel
	ProtocolChafa
	ProtocolASCII
)

// MapPreviewKeyMap defines key bindings for the map preview
type MapPreviewKeyMap struct {
	Close           key.Binding
	ZoomIn          key.Binding
	ZoomOut         key.Binding
	PanUp           key.Binding
	PanDown         key.Binding
	PanLeft         key.Binding
	PanRight        key.Binding
	Refresh         key.Binding
	NextStyle       key.Binding
	PrevStyle       key.Binding
	ToggleLayers    key.Binding
	CrosshairUp     key.Binding
	CrosshairDown   key.Binding
	CrosshairLeft   key.Binding
	CrosshairRight  key.Binding
	GetFeatureInfo  key.Binding
	ToggleOverlay   key.Binding
}

// DefaultMapPreviewKeyMap returns the default key bindings
func DefaultMapPreviewKeyMap() MapPreviewKeyMap {
	return MapPreviewKeyMap{
		Close: key.NewBinding(
			key.WithKeys("esc", "q"),
			key.WithHelp("esc/q", "close"),
		),
		ZoomIn: key.NewBinding(
			key.WithKeys("+", "="),
			key.WithHelp("+", "zoom in"),
		),
		ZoomOut: key.NewBinding(
			key.WithKeys("-", "_"),
			key.WithHelp("-", "zoom out"),
		),
		PanUp: key.NewBinding(
			key.WithKeys("up", "k"),
			key.WithHelp("up/k", "pan up"),
		),
		PanDown: key.NewBinding(
			key.WithKeys("down", "j"),
			key.WithHelp("down/j", "pan down"),
		),
		PanLeft: key.NewBinding(
			key.WithKeys("left", "h"),
			key.WithHelp("left/h", "pan left"),
		),
		PanRight: key.NewBinding(
			key.WithKeys("right"),
			key.WithHelp("right", "pan right"),
		),
		Refresh: key.NewBinding(
			key.WithKeys("r"),
			key.WithHelp("r", "refresh"),
		),
		NextStyle: key.NewBinding(
			key.WithKeys("s"),
			key.WithHelp("s", "next style"),
		),
		PrevStyle: key.NewBinding(
			key.WithKeys("S"),
			key.WithHelp("S", "prev style"),
		),
		ToggleLayers: key.NewBinding(
			key.WithKeys("l"),
			key.WithHelp("l", "toggle layers"),
		),
		CrosshairUp: key.NewBinding(
			key.WithKeys("shift+up", "K"),
			key.WithHelp("Shift+↑/K", "crosshair up"),
		),
		CrosshairDown: key.NewBinding(
			key.WithKeys("shift+down", "J"),
			key.WithHelp("Shift+↓/J", "crosshair down"),
		),
		CrosshairLeft: key.NewBinding(
			key.WithKeys("shift+left", "H"),
			key.WithHelp("Shift+←/H", "crosshair left"),
		),
		CrosshairRight: key.NewBinding(
			key.WithKeys("shift+right", "L"),
			key.WithHelp("Shift+→/L", "crosshair right"),
		),
		GetFeatureInfo: key.NewBinding(
			key.WithKeys("i"),
			key.WithHelp("i", "feature info"),
		),
		ToggleOverlay: key.NewBinding(
			key.WithKeys("o"),
			key.WithHelp("o", "toggle overlay"),
		),
	}
}

// LayerToggleItem represents a layer that can be toggled on/off in layer group preview
type LayerToggleItem struct {
	Name            string
	Enabled         bool
	CurrentStyle    string   // Currently selected style
	AvailableStyles []string // Available styles for this layer
}

// MapPreview is a TUI component for previewing map layers
type MapPreview struct {
	// Configuration
	geoserverURL string
	username     string
	password     string
	workspace    string
	layerName    string
	styles       []string
	currentStyle int

	// Layer group support
	isLayerGroup    bool              // Whether we're viewing a layer group
	layerGroupMode  string            // SINGLE, NAMED, CONTAINER, EO
	groupLayers     []LayerToggleItem // Layers in the group with enabled state
	showLayerPanel  bool              // Whether layer toggle panel is visible
	layerPanelCursor int             // Cursor position in layer panel

	// View state
	width      int
	height     int
	visible    bool
	loading    bool
	errorMsg   string
	statusMsg  string
	imageData  []byte
	renderedImage string

	// Double buffering - keep previous image while loading new one
	previousImage string

	// Map state
	centerX    float64 // Center longitude
	centerY    float64 // Center latitude
	zoomLevel  float64 // Zoom level (higher = more zoomed in)
	bbox       [4]float64 // Current bounding box [minX, minY, maxX, maxY]

	// Image rendering
	protocol   ImageProtocol
	imgWidth   int
	imgHeight  int

	// Crosshair state - position in terminal character coordinates (0.0-1.0 normalized)
	crosshairX      float64 // Normalized X position (0.0 = left, 1.0 = right)
	crosshairY      float64 // Normalized Y position (0.0 = top, 1.0 = bottom)
	showOverlay     bool    // Whether to show overlay controls on map
	featureInfo     string  // Last GetFeatureInfo result
	showFeatureInfo bool    // Whether to show feature info popup

	// Cached base image for overlay rendering (without crosshair)
	baseImage      image.Image // The original decoded PNG from WMS (without crosshair)
	compositeImage []byte      // PNG data with crosshair drawn in, ready for rendering

	// Legend image cached from GetLegendGraphic
	legendImage    image.Image // Cached legend image
	legendFetched  bool        // Whether legend has been fetched

	// Components
	keyMap  MapPreviewKeyMap
	spinner spinner.Model

	// Callbacks
	onClose func()
}

// MapPreviewMsg is sent when the map image is loaded
type MapPreviewMsg struct {
	ImageData []byte
	Error     error
}

// MapPreviewCloseMsg is sent when the preview should close
type MapPreviewCloseMsg struct{}

// FeatureInfoMsg is sent when GetFeatureInfo results are ready
type FeatureInfoMsg struct {
	Info  string
	Error error
}

// LegendMsg is sent when GetLegendGraphic results are ready
type LegendMsg struct {
	ImageData []byte
	Error     error
}

// LayerGroupLayerInfo contains info about a layer in a layer group
type LayerGroupLayerInfo struct {
	Name            string
	DefaultStyle    string   // Style assigned in the layer group
	AvailableStyles []string // All available styles for this layer
}

// MapPreviewMetadataMsg is sent when layer metadata (bounds/styles) is ready
type MapPreviewMetadataMsg struct {
	Bounds *[4]float64 // [minX, minY, maxX, maxY] or nil if not available
	Styles []string
	// Layer group specific
	IsLayerGroup   bool
	LayerGroupMode string                // SINGLE, NAMED, CONTAINER, EO
	GroupLayers    []LayerGroupLayerInfo // Layers in the group with style info
}

// NewMapPreview creates a new map preview component
func NewMapPreview(geoserverURL, username, password, workspace, layerName string) *MapPreview {
	s := spinner.New()
	s.Spinner = spinner.Dot
	s.Style = styles.LoadingStyle

	return &MapPreview{
		geoserverURL: strings.TrimSuffix(geoserverURL, "/"),
		username:     username,
		password:     password,
		workspace:    workspace,
		layerName:    layerName,
		styles:       []string{}, // Will be populated when layer info is loaded
		currentStyle: 0,
		visible:      true,
		loading:      true,
		zoomLevel:    2.0,
		centerX:      0,
		centerY:      0,
		bbox:         [4]float64{-180, -90, 180, 90}, // World extent
		imgWidth:     800,
		imgHeight:    600,
		crosshairX:   0.5, // Start in center
		crosshairY:   0.5, // Start in center
		showOverlay:  true, // Show overlay by default
		keyMap:       DefaultMapPreviewKeyMap(),
		spinner:      s,
		protocol:     detectImageProtocol(),
	}
}

// SetStyles sets the available styles for the layer
func (m *MapPreview) SetStyles(styleNames []string) {
	m.styles = styleNames
	if len(m.styles) > 0 {
		m.currentStyle = 0
	}
}

// SetBounds sets the bounding box for the map
func (m *MapPreview) SetBounds(minX, minY, maxX, maxY float64) {
	m.bbox = [4]float64{minX, minY, maxX, maxY}
	m.centerX = (minX + maxX) / 2
	m.centerY = (minY + maxY) / 2
}

// SetOnClose sets the callback for when the preview closes
func (m *MapPreview) SetOnClose(fn func()) {
	m.onClose = fn
}

// SetSize sets the component size
func (m *MapPreview) SetSize(width, height int) {
	m.width = width
	m.height = height
	// Calculate image size based on terminal size
	// Leave room for controls and padding
	m.imgWidth = (width - 20) * 8  // Approximate pixel width
	m.imgHeight = (height - 10) * 16 // Approximate pixel height
	if m.imgWidth > 1024 {
		m.imgWidth = 1024
	}
	if m.imgHeight > 768 {
		m.imgHeight = 768
	}
	if m.imgWidth < 256 {
		m.imgWidth = 256
	}
	if m.imgHeight < 192 {
		m.imgHeight = 192
	}
}

// IsVisible returns whether the preview is visible
func (m *MapPreview) IsVisible() bool {
	return m.visible
}

// Init initializes the component - does NOT fetch map yet, waits for metadata
func (m *MapPreview) Init() tea.Cmd {
	// Only start spinner - map fetch is triggered by MapPreviewMetadataMsg
	return m.spinner.Tick
}

// Update handles messages
func (m *MapPreview) Update(msg tea.Msg) (*MapPreview, tea.Cmd) {
	var cmds []tea.Cmd

	switch msg := msg.(type) {
	case tea.KeyMsg:
		// If layer panel is open, handle its keys first
		if m.showLayerPanel {
			switch {
			case key.Matches(msg, m.keyMap.Close), key.Matches(msg, m.keyMap.ToggleLayers):
				m.showLayerPanel = false
				return m, nil
			case msg.String() == "up" || msg.String() == "k":
				if m.layerPanelCursor > 0 {
					m.layerPanelCursor--
				}
				return m, nil
			case msg.String() == "down" || msg.String() == "j":
				if m.layerPanelCursor < len(m.groupLayers)-1 {
					m.layerPanelCursor++
				}
				return m, nil
			case msg.String() == " ", msg.String() == "enter":
				// Toggle layer enabled state
				if m.layerPanelCursor < len(m.groupLayers) {
					m.groupLayers[m.layerPanelCursor].Enabled = !m.groupLayers[m.layerPanelCursor].Enabled
					// Refresh map with new layer selection
					m.showLayerPanel = false
					m.loading = true
					// Double buffer: save current image before fetching new one
					if m.renderedImage != "" {
						m.previousImage = m.renderedImage
					}
					return m, m.fetchMap()
				}
				return m, nil
			case msg.String() == "left" || msg.String() == "h":
				// Previous style for current layer
				if m.layerPanelCursor < len(m.groupLayers) {
					layer := &m.groupLayers[m.layerPanelCursor]
					if len(layer.AvailableStyles) > 1 {
						currentIdx := m.findStyleIndex(layer.CurrentStyle, layer.AvailableStyles)
						currentIdx--
						if currentIdx < 0 {
							currentIdx = len(layer.AvailableStyles) - 1
						}
						layer.CurrentStyle = layer.AvailableStyles[currentIdx]
					}
				}
				return m, nil
			case msg.String() == "right" || msg.String() == "l":
				// Next style for current layer (note: 'l' is overloaded here but panel is open)
				if m.layerPanelCursor < len(m.groupLayers) {
					layer := &m.groupLayers[m.layerPanelCursor]
					if len(layer.AvailableStyles) > 1 {
						currentIdx := m.findStyleIndex(layer.CurrentStyle, layer.AvailableStyles)
						currentIdx++
						if currentIdx >= len(layer.AvailableStyles) {
							currentIdx = 0
						}
						layer.CurrentStyle = layer.AvailableStyles[currentIdx]
					}
				}
				return m, nil
			case msg.String() == "a":
				// Apply style changes and refresh map
				m.showLayerPanel = false
				m.loading = true
				if m.renderedImage != "" {
					m.previousImage = m.renderedImage
				}
				return m, m.fetchMap()
			}
			return m, nil
		}

		switch {
		case key.Matches(msg, m.keyMap.Close):
			m.visible = false
			if m.onClose != nil {
				m.onClose()
			}
			return m, tea.ClearScreen

		case key.Matches(msg, m.keyMap.ToggleLayers):
			// Only show layer panel for layer groups that support layer toggling
			if m.isLayerGroup && m.canToggleLayers() && len(m.groupLayers) > 0 {
				m.showLayerPanel = true
				m.layerPanelCursor = 0
			}
			return m, nil

		case key.Matches(msg, m.keyMap.ZoomIn):
			m.zoomIn()
			m.loading = true
			// Double buffer: save current image before fetching new one
			if m.renderedImage != "" {
				m.previousImage = m.renderedImage
			}
			return m, m.fetchMap()

		case key.Matches(msg, m.keyMap.ZoomOut):
			m.zoomOut()
			m.loading = true
			if m.renderedImage != "" {
				m.previousImage = m.renderedImage
			}
			return m, m.fetchMap()

		case key.Matches(msg, m.keyMap.PanUp):
			m.panUp()
			m.loading = true
			if m.renderedImage != "" {
				m.previousImage = m.renderedImage
			}
			return m, m.fetchMap()

		case key.Matches(msg, m.keyMap.PanDown):
			m.panDown()
			m.loading = true
			if m.renderedImage != "" {
				m.previousImage = m.renderedImage
			}
			return m, m.fetchMap()

		case key.Matches(msg, m.keyMap.PanLeft):
			m.panLeft()
			m.loading = true
			if m.renderedImage != "" {
				m.previousImage = m.renderedImage
			}
			return m, m.fetchMap()

		case key.Matches(msg, m.keyMap.PanRight):
			m.panRight()
			m.loading = true
			if m.renderedImage != "" {
				m.previousImage = m.renderedImage
			}
			return m, m.fetchMap()

		case key.Matches(msg, m.keyMap.Refresh):
			m.loading = true
			if m.renderedImage != "" {
				m.previousImage = m.renderedImage
			}
			return m, m.fetchMap()

		case key.Matches(msg, m.keyMap.NextStyle):
			m.nextStyle()
			m.loading = true
			if m.renderedImage != "" {
				m.previousImage = m.renderedImage
			}
			return m, m.fetchMap()

		case key.Matches(msg, m.keyMap.PrevStyle):
			m.prevStyle()
			m.loading = true
			if m.renderedImage != "" {
				m.previousImage = m.renderedImage
			}
			return m, m.fetchMap()

		case key.Matches(msg, m.keyMap.CrosshairUp):
			m.moveCrosshair(0, -1) // Move 1 pixel up
			m.updateCompositeImage()
			m.renderedImage = m.renderCompositeImage()
			return m, nil

		case key.Matches(msg, m.keyMap.CrosshairDown):
			m.moveCrosshair(0, 1) // Move 1 pixel down
			m.updateCompositeImage()
			m.renderedImage = m.renderCompositeImage()
			return m, nil

		case key.Matches(msg, m.keyMap.CrosshairLeft):
			m.moveCrosshair(-1, 0) // Move 1 pixel left
			m.updateCompositeImage()
			m.renderedImage = m.renderCompositeImage()
			return m, nil

		case key.Matches(msg, m.keyMap.CrosshairRight):
			m.moveCrosshair(1, 0) // Move 1 pixel right
			m.updateCompositeImage()
			m.renderedImage = m.renderCompositeImage()
			return m, nil

		case key.Matches(msg, m.keyMap.GetFeatureInfo):
			// Perform GetFeatureInfo at crosshair location
			m.showFeatureInfo = false // Hide any previous info
			m.statusMsg = "Fetching feature info..."
			return m, m.fetchFeatureInfo()

		case key.Matches(msg, m.keyMap.ToggleOverlay):
			m.showOverlay = !m.showOverlay
			m.updateCompositeImage()
			m.renderedImage = m.renderCompositeImage()
			return m, nil
		}

	case FeatureInfoMsg:
		if msg.Error != nil {
			m.featureInfo = "Error: " + msg.Error.Error()
			m.statusMsg = "FeatureInfo error: " + msg.Error.Error()
		} else {
			m.featureInfo = msg.Info
			m.statusMsg = fmt.Sprintf("FeatureInfo: %d chars", len(msg.Info))
		}
		m.showFeatureInfo = true
		// Re-render composite with feature info overlay
		m.updateCompositeImage()
		m.renderedImage = m.renderCompositeImage()
		return m, nil

	case spinner.TickMsg:
		var cmd tea.Cmd
		m.spinner, cmd = m.spinner.Update(msg)
		cmds = append(cmds, cmd)

	case MapPreviewMsg:
		m.loading = false
		if msg.Error != nil {
			m.errorMsg = msg.Error.Error()
			m.imageData = nil
			m.baseImage = nil
			m.compositeImage = nil
			m.renderedImage = ""
			m.previousImage = ""
		} else {
			m.errorMsg = ""
			m.imageData = msg.ImageData
			// Decode and cache the base image (supports PNG, GIF, JPEG)
			if img, _, err := image.Decode(bytes.NewReader(msg.ImageData)); err == nil {
				m.baseImage = img
			}
			// Render composite with crosshair and legend
			m.updateCompositeImage()
			m.renderedImage = m.renderCompositeImage()
			m.previousImage = ""
			// Fetch legend on first successful map load
			if !m.legendFetched {
				m.legendFetched = true
				return m, m.fetchLegend()
			}
		}

	case LegendMsg:
		if msg.Error != nil {
			m.statusMsg = "Legend error: " + msg.Error.Error()
		} else if len(msg.ImageData) > 0 {
			// Decode and cache the legend image (supports PNG, GIF, JPEG)
			if img, _, err := image.Decode(bytes.NewReader(msg.ImageData)); err == nil {
				m.legendImage = img
				m.statusMsg = fmt.Sprintf("Legend loaded: %dx%d", img.Bounds().Dx(), img.Bounds().Dy())
				// Re-render composite with legend
				m.updateCompositeImage()
				m.renderedImage = m.renderCompositeImage()
			} else {
				m.statusMsg = "Legend decode error: " + err.Error()
			}
		}
		return m, nil

	case MapPreviewMetadataMsg:
		// Apply metadata and fetch map
		if msg.Bounds != nil {
			m.SetBounds(msg.Bounds[0], msg.Bounds[1], msg.Bounds[2], msg.Bounds[3])
		}
		if len(msg.Styles) > 0 {
			m.SetStyles(msg.Styles)
		}
		// Apply layer group info
		if msg.IsLayerGroup {
			m.isLayerGroup = true
			m.layerGroupMode = msg.LayerGroupMode
			m.groupLayers = make([]LayerToggleItem, len(msg.GroupLayers))
			for i, layerInfo := range msg.GroupLayers {
				m.groupLayers[i] = LayerToggleItem{
					Name:            layerInfo.Name,
					Enabled:         true, // All layers enabled by default
					CurrentStyle:    layerInfo.DefaultStyle,
					AvailableStyles: layerInfo.AvailableStyles,
				}
			}
		}
		// Now fetch the map with proper bounds
		m.loading = true
		return m, m.fetchMap()
	}

	return m, tea.Batch(cmds...)
}

// canToggleLayers returns true if the layer group mode supports toggling individual layers
func (m *MapPreview) canToggleLayers() bool {
	// NAMED mode allows individual layers to be visible separately
	// SINGLE mode merges all layers into one, so toggling doesn't make sense
	// CONTAINER is organizational only
	// EO is for Earth Observation
	return m.layerGroupMode == "NAMED" || m.layerGroupMode == "EO"
}

// findStyleIndex finds the index of a style in the available styles list
func (m *MapPreview) findStyleIndex(styleName string, styles []string) int {
	for i, s := range styles {
		if s == styleName {
			return i
		}
	}
	return 0
}

// View renders the component with full-screen map and crosshair overlay
func (m *MapPreview) View() string {
	if !m.visible {
		return ""
	}

	// If we have the layer panel open, show that instead of full-screen map
	if m.showLayerPanel {
		return m.renderLayerPanelView()
	}

	// Get the map image (or loading state)
	var mapImage string
	if m.errorMsg != "" {
		mapImage = styles.ErrorStyle.Render("Error: " + m.errorMsg)
	} else if m.loading {
		if m.previousImage != "" {
			mapImage = m.previousImage
		} else {
			mapImage = m.spinner.View() + " Loading map..."
		}
	} else if m.renderedImage != "" {
		mapImage = m.renderedImage
	}

	// Build final output
	var content strings.Builder

	// Add map image with overlay
	content.WriteString(mapImage)

	// Add status line below the map (always show legend status for debugging)
	legendStatus := m.statusMsg
	if legendStatus == "" {
		if m.legendImage != nil {
			legendStatus = fmt.Sprintf("Legend: loaded (%dx%d)", m.legendImage.Bounds().Dx(), m.legendImage.Bounds().Dy())
		} else if m.legendFetched {
			legendStatus = "Legend: fetch attempted but no image"
		} else {
			legendStatus = "Legend: not yet fetched"
		}
	}
	content.WriteString("\n")
	content.WriteString(styles.HelpBarStyle.Render(legendStatus))

	// Add coordinates and help
	lon, lat := m.getCrosshairCoordinates()
	coordStr := fmt.Sprintf("Crosshair: %.4f, %.4f | Press 'i' for info, 'o' toggle overlay, Shift+arrows move crosshair", lon, lat)
	content.WriteString("\n")
	content.WriteString(styles.HelpBarStyle.Render(coordStr))

	// If showing feature info, render it at the bottom
	if m.showFeatureInfo && m.featureInfo != "" {
		content.WriteString("\n")
		content.WriteString(m.renderFeatureInfoPopup())
	}

	return content.String()
}

// renderLayerPanelView renders the layer panel with the map visible behind
func (m *MapPreview) renderLayerPanelView() string {
	var content strings.Builder

	// Title bar
	titleText := fmt.Sprintf(" Layer Preview: %s:%s ", m.workspace, m.layerName)
	if m.isLayerGroup {
		titleText = fmt.Sprintf(" Layer Group Preview: %s:%s ", m.workspace, m.layerName)
	}
	title := styles.DialogTitleStyle.Render(titleText)
	content.WriteString(title)
	content.WriteString("\n\n")

	content.WriteString(m.renderLayerPanel())

	return content.String()
}

// updateCompositeImage draws crosshair and overlays onto the base image
func (m *MapPreview) updateCompositeImage() {
	if m.baseImage == nil {
		m.compositeImage = m.imageData // Fallback to original
		return
	}

	bounds := m.baseImage.Bounds()
	width := bounds.Dx()
	height := bounds.Dy()

	// Create a new RGBA image to draw on
	composite := image.NewRGBA(bounds)

	// Copy base image to composite
	draw.Draw(composite, bounds, m.baseImage, bounds.Min, draw.Src)

	// Only draw crosshair if overlay is enabled
	if m.showOverlay {
		// Calculate crosshair position in pixels
		crossX := int(m.crosshairX * float64(width-1))
		crossY := int(m.crosshairY * float64(height-1))

		// Crosshair colors
		lineColor := color.RGBA{255, 68, 68, 255}   // Red
		centerColor := color.RGBA{255, 255, 255, 255} // White

		// Draw vertical line
		for y := 0; y < height; y++ {
			if y == crossY {
				continue // Skip center point
			}
			composite.Set(crossX, y, lineColor)
		}

		// Draw horizontal line
		for x := 0; x < width; x++ {
			if x == crossX {
				continue // Skip center point
			}
			composite.Set(x, crossY, lineColor)
		}

		// Draw center point (3x3 white square for visibility)
		for dy := -1; dy <= 1; dy++ {
			for dx := -1; dx <= 1; dx++ {
				px := crossX + dx
				py := crossY + dy
				if px >= 0 && px < width && py >= 0 && py < height {
					composite.Set(px, py, centerColor)
				}
			}
		}

		// Draw coordinate text overlay at top-left
		m.drawTextOverlay(composite, width)
	}

	// Draw legend in bottom-left corner if available
	if m.legendImage != nil {
		m.drawLegendOverlay(composite, width, height)
	} else {
		// Draw a placeholder box to show where legend would go
		m.drawLegendPlaceholder(composite, width, height)
	}

	// Draw feature info overlay if showing
	if m.showFeatureInfo && m.featureInfo != "" {
		m.drawFeatureInfoOverlay(composite, width, height)
	}

	// Encode composite to PNG
	var buf bytes.Buffer
	if err := png.Encode(&buf, composite); err == nil {
		m.compositeImage = buf.Bytes()
	} else {
		m.compositeImage = m.imageData // Fallback
	}
}

// drawTextOverlay draws coordinate and help text on the image
func (m *MapPreview) drawTextOverlay(img *image.RGBA, width int) {
	// Draw a semi-transparent black bar at the top for text
	barHeight := 20
	barColor := color.RGBA{0, 0, 0, 200} // Semi-transparent black

	bounds := img.Bounds()
	for y := 0; y < barHeight && y < bounds.Dy(); y++ {
		for x := 0; x < width; x++ {
			// Blend with existing pixel
			existing := img.RGBAAt(x, y)
			blended := blendColors(existing, barColor)
			img.Set(x, y, blended)
		}
	}

	// Note: Drawing actual text would require a font rendering library
	// For now, the bar provides visual separation and the coordinates
	// are shown in the terminal help bar rendered separately
}

// drawLegendOverlay draws the legend image in the bottom-left corner
func (m *MapPreview) drawLegendOverlay(composite *image.RGBA, width, height int) {
	if m.legendImage == nil {
		return
	}

	legendBounds := m.legendImage.Bounds()
	legendWidth := legendBounds.Dx()
	legendHeight := legendBounds.Dy()

	// Position legend in bottom-left with 10px padding
	padding := 10
	destX := padding
	destY := height - legendHeight - padding

	// Draw semi-transparent background behind legend
	bgColor := color.RGBA{0, 0, 0, 180}
	bgPadding := 5
	for y := destY - bgPadding; y < destY+legendHeight+bgPadding && y < height; y++ {
		if y < 0 {
			continue
		}
		for x := destX - bgPadding; x < destX+legendWidth+bgPadding && x < width; x++ {
			if x < 0 {
				continue
			}
			existing := composite.RGBAAt(x, y)
			blended := blendColors(existing, bgColor)
			composite.Set(x, y, blended)
		}
	}

	// Draw legend image
	for y := 0; y < legendHeight; y++ {
		for x := 0; x < legendWidth; x++ {
			destPx := destX + x
			destPy := destY + y
			if destPx >= 0 && destPx < width && destPy >= 0 && destPy < height {
				c := m.legendImage.At(legendBounds.Min.X+x, legendBounds.Min.Y+y)
				r, g, b, a := c.RGBA()
				if a > 0 {
					composite.Set(destPx, destPy, color.RGBA{uint8(r >> 8), uint8(g >> 8), uint8(b >> 8), uint8(a >> 8)})
				}
			}
		}
	}
}

// drawLegendPlaceholder draws a placeholder box where the legend would go
func (m *MapPreview) drawLegendPlaceholder(composite *image.RGBA, width, height int) {
	// Draw a yellow box in bottom-left to show legend area (for debugging)
	boxWidth := 60
	boxHeight := 40
	padding := 10
	destX := padding
	destY := height - boxHeight - padding

	// Draw yellow background
	bgColor := color.RGBA{255, 200, 0, 200} // Yellow
	for y := destY; y < destY+boxHeight && y < height; y++ {
		if y < 0 {
			continue
		}
		for x := destX; x < destX+boxWidth && x < width; x++ {
			if x < 0 {
				continue
			}
			composite.Set(x, y, bgColor)
		}
	}

	// Draw border
	borderColor := color.RGBA{200, 150, 0, 255}
	for x := destX; x < destX+boxWidth && x < width; x++ {
		if destY >= 0 && destY < height {
			composite.Set(x, destY, borderColor)
		}
		endY := destY + boxHeight - 1
		if endY >= 0 && endY < height {
			composite.Set(x, endY, borderColor)
		}
	}
	for y := destY; y < destY+boxHeight && y < height; y++ {
		if y >= 0 {
			composite.Set(destX, y, borderColor)
			endX := destX + boxWidth - 1
			if endX < width {
				composite.Set(endX, y, borderColor)
			}
		}
	}
}

// drawFeatureInfoOverlay draws the feature info in the bottom-right corner
func (m *MapPreview) drawFeatureInfoOverlay(composite *image.RGBA, width, height int) {
	// Draw a semi-transparent box in bottom-right for feature info
	// Since we can't render text directly, we draw a colored box to indicate info is available
	boxWidth := 150
	boxHeight := 80
	padding := 10

	startX := width - boxWidth - padding
	startY := height - boxHeight - padding

	// Draw semi-transparent background
	bgColor := color.RGBA{0, 50, 100, 220} // Dark blue
	for y := startY; y < startY+boxHeight && y < height; y++ {
		if y < 0 {
			continue
		}
		for x := startX; x < startX+boxWidth && x < width; x++ {
			if x < 0 {
				continue
			}
			existing := composite.RGBAAt(x, y)
			blended := blendColors(existing, bgColor)
			composite.Set(x, y, blended)
		}
	}

	// Draw a border
	borderColor := color.RGBA{100, 150, 255, 255} // Light blue border
	// Top border
	for x := startX; x < startX+boxWidth && x < width; x++ {
		if x >= 0 && startY >= 0 && startY < height {
			composite.Set(x, startY, borderColor)
		}
	}
	// Bottom border
	endY := startY + boxHeight - 1
	for x := startX; x < startX+boxWidth && x < width; x++ {
		if x >= 0 && endY >= 0 && endY < height {
			composite.Set(x, endY, borderColor)
		}
	}
	// Left border
	for y := startY; y < startY+boxHeight && y < height; y++ {
		if startX >= 0 && y >= 0 {
			composite.Set(startX, y, borderColor)
		}
	}
	// Right border
	endX := startX + boxWidth - 1
	for y := startY; y < startY+boxHeight && y < height; y++ {
		if endX >= 0 && endX < width && y >= 0 {
			composite.Set(endX, y, borderColor)
		}
	}

	// Draw an "i" icon to indicate info (simple pixel art)
	iconX := startX + 10
	iconY := startY + 10
	iconColor := color.RGBA{255, 255, 255, 255}
	// Draw "i" - dot
	if iconX >= 0 && iconX < width && iconY >= 0 && iconY < height {
		composite.Set(iconX, iconY, iconColor)
		composite.Set(iconX+1, iconY, iconColor)
	}
	// Draw "i" - stem
	for dy := 3; dy < 12; dy++ {
		if iconX >= 0 && iconX < width && iconY+dy >= 0 && iconY+dy < height {
			composite.Set(iconX, iconY+dy, iconColor)
			composite.Set(iconX+1, iconY+dy, iconColor)
		}
	}
}

// blendColors blends two colors with alpha
func blendColors(base, overlay color.RGBA) color.RGBA {
	alpha := float64(overlay.A) / 255.0
	return color.RGBA{
		R: uint8(float64(base.R)*(1-alpha) + float64(overlay.R)*alpha),
		G: uint8(float64(base.G)*(1-alpha) + float64(overlay.G)*alpha),
		B: uint8(float64(base.B)*(1-alpha) + float64(overlay.B)*alpha),
		A: 255,
	}
}

// renderCompositeImage renders the composite image (with crosshair) to terminal
func (m *MapPreview) renderCompositeImage() string {
	if len(m.compositeImage) == 0 {
		return m.renderImage() // Fallback to original rendering
	}

	// Use the composite image data for rendering
	originalData := m.imageData
	m.imageData = m.compositeImage
	result := m.renderImage()
	m.imageData = originalData

	return result
}

// renderFeatureInfoPopup renders the GetFeatureInfo result as a popup
func (m *MapPreview) renderFeatureInfoPopup() string {
	// Truncate long info
	info := m.featureInfo
	lines := strings.Split(info, "\n")
	maxLines := 10
	if len(lines) > maxLines {
		lines = lines[:maxLines]
		lines = append(lines, "... (truncated)")
	}
	info = strings.Join(lines, "\n")

	// Style the popup
	popupStyle := lipgloss.NewStyle().
		Border(lipgloss.RoundedBorder()).
		BorderForeground(styles.KartozaOrange).
		Background(lipgloss.Color("#1a1a2e")).
		Foreground(styles.TextBright).
		Padding(0, 1).
		MaxWidth(m.width - 4)

	headerStyle := lipgloss.NewStyle().
		Foreground(styles.KartozaOrangeLight).
		Bold(true)

	content := headerStyle.Render("Feature Info") + "\n" + info

	return popupStyle.Render(content)
}

// renderLayerPanel renders the layer toggle panel for layer groups
func (m *MapPreview) renderLayerPanel() string {
	var b strings.Builder

	// Panel header
	headerStyle := lipgloss.NewStyle().
		Background(styles.Accent).
		Foreground(lipgloss.Color("#FFFFFF")).
		Padding(0, 1).
		Bold(true)
	b.WriteString(headerStyle.Render(" Layer Settings "))
	b.WriteString("\n")

	// Help text
	helpStyle := lipgloss.NewStyle().Foreground(styles.Muted).Italic(true)
	b.WriteString(helpStyle.Render("  ↑/↓ navigate  Space toggle  ←/→ change style  a apply  Esc close"))
	b.WriteString("\n\n")

	// Calculate max layer name width for alignment
	maxNameLen := 0
	for _, layer := range m.groupLayers {
		if len(layer.Name) > maxNameLen {
			maxNameLen = len(layer.Name)
		}
	}

	// Layer list
	for i, layer := range m.groupLayers {
		// Checkbox
		checkbox := "[ ]"
		if layer.Enabled {
			checkbox = "[✓]"
		}

		// Style indicator
		styleText := ""
		if len(layer.AvailableStyles) > 0 {
			styleName := layer.CurrentStyle
			if styleName == "" {
				styleName = "(default)"
			}
			// Show style with arrows if multiple styles available
			if len(layer.AvailableStyles) > 1 {
				styleText = fmt.Sprintf("  ◀ %s ▶", styleName)
			} else {
				styleText = fmt.Sprintf("  [%s]", styleName)
			}
		}

		// Style based on selection and enabled state
		var lineStyle, styleStyle lipgloss.Style
		if i == m.layerPanelCursor {
			lineStyle = lipgloss.NewStyle().
				Background(styles.KartozaBlueLight).
				Foreground(styles.TextBright).
				Bold(true)
			styleStyle = lipgloss.NewStyle().
				Background(styles.KartozaBlueLight).
				Foreground(styles.KartozaOrangeLight).
				Bold(true)
		} else if layer.Enabled {
			lineStyle = lipgloss.NewStyle().Foreground(styles.TextBright)
			styleStyle = lipgloss.NewStyle().Foreground(styles.KartozaOrange)
		} else {
			lineStyle = lipgloss.NewStyle().Foreground(styles.Muted)
			styleStyle = lipgloss.NewStyle().Foreground(styles.Muted)
		}

		// Pad layer name for alignment
		paddedName := layer.Name
		for len(paddedName) < maxNameLen {
			paddedName += " "
		}

		line := fmt.Sprintf("  %s %s", checkbox, paddedName)
		b.WriteString(lineStyle.Render(line))
		if styleText != "" {
			b.WriteString(styleStyle.Render(styleText))
		}
		b.WriteString("\n")
	}

	// Wrap in a border
	panelStyle := lipgloss.NewStyle().
		Border(lipgloss.RoundedBorder()).
		BorderForeground(styles.Accent).
		Padding(0, 1)

	return panelStyle.Render(b.String())
}

// renderKey renders a key hint in a compact style
func (m *MapPreview) renderKey(key string) string {
	return lipgloss.NewStyle().
		Foreground(styles.Accent).
		Bold(true).
		Render(key)
}

// fetchMap fetches the WMS GetMap image
func (m *MapPreview) fetchMap() tea.Cmd {
	return func() tea.Msg {
		m.loading = true

		// Build WMS GetMap URL
		style := ""
		if len(m.styles) > 0 && m.currentStyle < len(m.styles) {
			style = m.styles[m.currentStyle]
		}

		// Build layer list and styles
		var layers string
		var layerStyles string
		if m.isLayerGroup && m.canToggleLayers() && len(m.groupLayers) > 0 {
			// For layer groups with togglable layers, request only enabled layers
			enabledLayers := []string{}
			enabledStyles := []string{}
			for _, layer := range m.groupLayers {
				if layer.Enabled {
					enabledLayers = append(enabledLayers, layer.Name)
					// Add the style for this layer (empty string uses default)
					enabledStyles = append(enabledStyles, layer.CurrentStyle)
				}
			}
			if len(enabledLayers) == 0 {
				// No layers enabled, show an empty/placeholder
				return MapPreviewMsg{Error: fmt.Errorf("no layers enabled")}
			}
			layers = strings.Join(enabledLayers, ",")
			layerStyles = strings.Join(enabledStyles, ",")
		} else {
			// Single layer or layer group as whole
			layers = fmt.Sprintf("%s:%s", m.workspace, m.layerName)
			layerStyles = style
		}

		wmsURL := fmt.Sprintf("%s/wms?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=%s&STYLES=%s&FORMAT=%s&TRANSPARENT=true&SRS=EPSG:4326&WIDTH=%d&HEIGHT=%d&BBOX=%f,%f,%f,%f",
			m.geoserverURL, url.QueryEscape(layers), url.QueryEscape(layerStyles), url.QueryEscape("image/png"), m.imgWidth, m.imgHeight,
			m.bbox[0], m.bbox[1], m.bbox[2], m.bbox[3])

		// Create HTTP request with auth
		req, err := http.NewRequest("GET", wmsURL, nil)
		if err != nil {
			return MapPreviewMsg{Error: err}
		}
		req.SetBasicAuth(m.username, m.password)

		client := &http.Client{Timeout: 30 * time.Second}
		resp, err := client.Do(req)
		if err != nil {
			return MapPreviewMsg{Error: err}
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			body, _ := io.ReadAll(resp.Body)
			return MapPreviewMsg{Error: fmt.Errorf("WMS error (%d): %s", resp.StatusCode, string(body))}
		}

		data, err := io.ReadAll(resp.Body)
		if err != nil {
			return MapPreviewMsg{Error: err}
		}

		return MapPreviewMsg{ImageData: data}
	}
}

// renderImage converts the PNG image data to terminal graphics
func (m *MapPreview) renderImage() string {
	if len(m.imageData) == 0 {
		return ""
	}

	switch m.protocol {
	case ProtocolKitty:
		return m.renderKitty()
	case ProtocolSixel:
		return m.renderSixel()
	case ProtocolChafa:
		return m.renderChafa()
	default:
		return m.renderASCII()
	}
}

// renderKitty renders for Kitty terminal using chafa with kitty protocol
func (m *MapPreview) renderKitty() string {
	// Calculate display size - use most of screen since controls are at top
	displayWidth := m.width - 4
	if displayWidth > 120 {
		displayWidth = 120
	}
	if displayWidth < 40 {
		displayWidth = 40
	}
	displayHeight := m.height - 8 // Leave room for title and control bar
	if displayHeight > 50 {
		displayHeight = 50
	}
	if displayHeight < 15 {
		displayHeight = 15
	}

	// Create temp file for image
	tmpFile, err := os.CreateTemp("", "geoserver-preview-*.png")
	if err != nil {
		return m.renderASCII()
	}
	defer os.Remove(tmpFile.Name())

	if _, err := tmpFile.Write(m.imageData); err != nil {
		tmpFile.Close()
		return m.renderASCII()
	}
	tmpFile.Close()

	// Use chafa with kitty format for best quality in Kitty terminal
	// Use --clear flag to clear previous images and avoid ghosting
	cmd := exec.Command("chafa",
		"--format", "kitty",
		"--size", fmt.Sprintf("%dx%d", displayWidth, displayHeight),
		"--colors", "full",
		"--color-space", "rgb",
		"--clear",
		tmpFile.Name())

	output, err := cmd.Output()
	if err != nil {
		// Fallback to symbols format if kitty format fails
		cmd = exec.Command("chafa",
			"--format", "symbols",
			"--size", fmt.Sprintf("%dx%d", displayWidth, displayHeight),
			"--colors", "full",
			tmpFile.Name())
		output, err = cmd.Output()
		if err != nil {
			return m.renderASCII()
		}
	}

	return string(output)
}

// renderSixel renders using Sixel graphics
func (m *MapPreview) renderSixel() string {
	// Try to use img2sixel if available
	cmd := exec.Command("img2sixel", "-")
	cmd.Stdin = bytes.NewReader(m.imageData)

	output, err := cmd.Output()
	if err != nil {
		return m.renderASCII()
	}

	return string(output)
}

// renderChafa renders using chafa
func (m *MapPreview) renderChafa() string {
	// Calculate display size - use most of screen since controls are at top
	displayWidth := m.width - 4
	if displayWidth > 120 {
		displayWidth = 120
	}
	if displayWidth < 40 {
		displayWidth = 40
	}
	displayHeight := m.height - 8
	if displayHeight > 50 {
		displayHeight = 50
	}
	if displayHeight < 15 {
		displayHeight = 15
	}

	// Create temp file for image
	tmpFile, err := os.CreateTemp("", "geoserver-preview-*.png")
	if err != nil {
		return m.renderASCII()
	}
	defer os.Remove(tmpFile.Name())

	if _, err := tmpFile.Write(m.imageData); err != nil {
		tmpFile.Close()
		return m.renderASCII()
	}
	tmpFile.Close()

	// Run chafa
	cmd := exec.Command("chafa",
		"--size", fmt.Sprintf("%dx%d", displayWidth, displayHeight),
		"--colors", "256",
		tmpFile.Name())

	output, err := cmd.Output()
	if err != nil {
		return m.renderASCII()
	}

	return string(output)
}

// renderASCII renders a simple ASCII representation
func (m *MapPreview) renderASCII() string {
	// Decode PNG to get dimensions
	img, err := png.Decode(bytes.NewReader(m.imageData))
	if err != nil {
		return "[Image decode error]"
	}

	bounds := img.Bounds()

	// Calculate ASCII size - use most of screen since controls are at top
	asciiWidth := m.width - 4
	if asciiWidth > 100 {
		asciiWidth = 100
	}
	if asciiWidth < 40 {
		asciiWidth = 40
	}
	asciiHeight := m.height - 8
	if asciiHeight > 40 {
		asciiHeight = 40
	}
	if asciiHeight < 15 {
		asciiHeight = 15
	}

	// Sample pixels and convert to ASCII art
	chars := " .:-=+*#%@"
	xScale := float64(bounds.Dx()) / float64(asciiWidth)
	yScale := float64(bounds.Dy()) / float64(asciiHeight)

	var result strings.Builder
	for y := 0; y < asciiHeight; y++ {
		for x := 0; x < asciiWidth; x++ {
			px := int(float64(x) * xScale)
			py := int(float64(y) * yScale)
			if px >= bounds.Max.X {
				px = bounds.Max.X - 1
			}
			if py >= bounds.Max.Y {
				py = bounds.Max.Y - 1
			}

			r, g, b, a := img.At(px+bounds.Min.X, py+bounds.Min.Y).RGBA()
			if a < 128 {
				result.WriteByte(' ')
				continue
			}

			// Convert to grayscale
			gray := (r + g + b) / 3
			// Map to character (0-65535 range from RGBA)
			idx := int(gray * uint32(len(chars)-1) / 65535)
			result.WriteByte(chars[idx])
		}
		result.WriteByte('\n')
	}

	return result.String()
}

// Pan and zoom methods
func (m *MapPreview) zoomIn() {
	if m.zoomLevel < 20 {
		m.zoomLevel += 0.5 // Zoom in by half a level
		m.updateBBox()
	}
}

func (m *MapPreview) zoomOut() {
	if m.zoomLevel > 0 {
		m.zoomLevel -= 0.5 // Zoom out by half a level
		m.updateBBox()
	}
}

func (m *MapPreview) panUp() {
	height := m.bbox[3] - m.bbox[1]
	m.centerY += height * 0.125 // Move by 12.5% of view
	m.updateBBox()
}

func (m *MapPreview) panDown() {
	height := m.bbox[3] - m.bbox[1]
	m.centerY -= height * 0.125 // Move by 12.5% of view
	m.updateBBox()
}

func (m *MapPreview) panLeft() {
	width := m.bbox[2] - m.bbox[0]
	m.centerX -= width * 0.125 // Move by 12.5% of view
	m.updateBBox()
}

func (m *MapPreview) panRight() {
	width := m.bbox[2] - m.bbox[0]
	m.centerX += width * 0.125 // Move by 12.5% of view
	m.updateBBox()
}

func (m *MapPreview) updateBBox() {
	// Calculate bbox size based on zoom level
	// Zoom 0 = world extent, each level halves the extent
	worldWidth := 360.0
	worldHeight := 180.0

	// Use math.Pow for fractional zoom levels
	scale := 1.0 / math.Pow(2, m.zoomLevel)
	width := worldWidth * scale
	height := worldHeight * scale

	m.bbox[0] = m.centerX - width/2
	m.bbox[1] = m.centerY - height/2
	m.bbox[2] = m.centerX + width/2
	m.bbox[3] = m.centerY + height/2

	// Clamp to world bounds
	if m.bbox[0] < -180 {
		m.bbox[0] = -180
		m.bbox[2] = m.bbox[0] + width
	}
	if m.bbox[2] > 180 {
		m.bbox[2] = 180
		m.bbox[0] = m.bbox[2] - width
	}
	if m.bbox[1] < -90 {
		m.bbox[1] = -90
		m.bbox[3] = m.bbox[1] + height
	}
	if m.bbox[3] > 90 {
		m.bbox[3] = 90
		m.bbox[1] = m.bbox[3] - height
	}
}

func (m *MapPreview) nextStyle() {
	if len(m.styles) > 0 {
		m.currentStyle = (m.currentStyle + 1) % len(m.styles)
	}
}

func (m *MapPreview) prevStyle() {
	if len(m.styles) > 0 {
		m.currentStyle--
		if m.currentStyle < 0 {
			m.currentStyle = len(m.styles) - 1
		}
	}
}

// moveCrosshair moves the crosshair by the given delta (normalized 0-1)
func (m *MapPreview) moveCrosshair(dx, dy int) {
	// Move crosshair by pixel count - calculate normalized delta based on image dimensions
	if m.baseImage == nil {
		return
	}
	bounds := m.baseImage.Bounds()
	width := float64(bounds.Dx())
	height := float64(bounds.Dy())

	// Convert pixel delta to normalized coordinates
	m.crosshairX += float64(dx) / width
	m.crosshairY += float64(dy) / height

	// Clamp to valid range
	if m.crosshairX < 0 {
		m.crosshairX = 0
	}
	if m.crosshairX > 1 {
		m.crosshairX = 1
	}
	if m.crosshairY < 0 {
		m.crosshairY = 0
	}
	if m.crosshairY > 1 {
		m.crosshairY = 1
	}
	// Hide feature info when crosshair moves
	m.showFeatureInfo = false
}

// getCrosshairCoordinates returns the geographic coordinates at the crosshair position
func (m *MapPreview) getCrosshairCoordinates() (lon, lat float64) {
	// Convert normalized position to geographic coordinates
	lon = m.bbox[0] + (m.bbox[2]-m.bbox[0])*m.crosshairX
	lat = m.bbox[3] - (m.bbox[3]-m.bbox[1])*m.crosshairY // Y is inverted
	return lon, lat
}

// getCrosshairPixelPosition returns the pixel position for GetFeatureInfo request
func (m *MapPreview) getCrosshairPixelPosition() (x, y int) {
	x = int(m.crosshairX * float64(m.imgWidth))
	y = int(m.crosshairY * float64(m.imgHeight))
	return x, y
}

// fetchFeatureInfo performs a WMS GetFeatureInfo request at the crosshair location
func (m *MapPreview) fetchFeatureInfo() tea.Cmd {
	return func() tea.Msg {
		// Get pixel position
		pixelX, pixelY := m.getCrosshairPixelPosition()

		// Build layer name
		var layers string
		if m.isLayerGroup && m.canToggleLayers() && len(m.groupLayers) > 0 {
			enabledLayers := []string{}
			for _, layer := range m.groupLayers {
				if layer.Enabled {
					enabledLayers = append(enabledLayers, layer.Name)
				}
			}
			if len(enabledLayers) == 0 {
				return FeatureInfoMsg{Error: fmt.Errorf("no layers enabled")}
			}
			layers = strings.Join(enabledLayers, ",")
		} else {
			layers = fmt.Sprintf("%s:%s", m.workspace, m.layerName)
		}

		// Build WMS GetFeatureInfo URL
		wfsURL := fmt.Sprintf("%s/wms?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetFeatureInfo&LAYERS=%s&QUERY_LAYERS=%s&INFO_FORMAT=%s&SRS=EPSG:4326&WIDTH=%d&HEIGHT=%d&BBOX=%f,%f,%f,%f&X=%d&Y=%d",
			m.geoserverURL,
			url.QueryEscape(layers),
			url.QueryEscape(layers),
			url.QueryEscape("text/plain"),
			m.imgWidth, m.imgHeight,
			m.bbox[0], m.bbox[1], m.bbox[2], m.bbox[3],
			pixelX, pixelY)

		// Create HTTP request with auth
		req, err := http.NewRequest("GET", wfsURL, nil)
		if err != nil {
			return FeatureInfoMsg{Error: err}
		}
		req.SetBasicAuth(m.username, m.password)

		client := &http.Client{Timeout: 30 * time.Second}
		resp, err := client.Do(req)
		if err != nil {
			return FeatureInfoMsg{Error: err}
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			body, _ := io.ReadAll(resp.Body)
			return FeatureInfoMsg{Error: fmt.Errorf("WMS error (%d): %s", resp.StatusCode, string(body))}
		}

		data, err := io.ReadAll(resp.Body)
		if err != nil {
			return FeatureInfoMsg{Error: err}
		}

		info := strings.TrimSpace(string(data))
		if info == "" {
			info = "No features found at this location"
		}

		return FeatureInfoMsg{Info: info}
	}
}

// fetchLegend performs a WMS GetLegendGraphic request
func (m *MapPreview) fetchLegend() tea.Cmd {
	return func() tea.Msg {
		// Build layer name
		var layer string
		if m.workspace != "" {
			layer = fmt.Sprintf("%s:%s", m.workspace, m.layerName)
		} else {
			layer = m.layerName
		}

		// Get current style if any
		style := ""
		if len(m.styles) > 0 && m.currentStyle < len(m.styles) {
			style = m.styles[m.currentStyle]
		}

		// Build WMS GetLegendGraphic URL
		legendURL := fmt.Sprintf("%s/wms?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetLegendGraphic&LAYER=%s&FORMAT=image/png&WIDTH=20&HEIGHT=20",
			m.geoserverURL,
			url.QueryEscape(layer))

		if style != "" {
			legendURL += "&STYLE=" + url.QueryEscape(style)
		}

		// Create HTTP request with auth
		req, err := http.NewRequest("GET", legendURL, nil)
		if err != nil {
			return LegendMsg{Error: err}
		}
		req.SetBasicAuth(m.username, m.password)

		client := &http.Client{Timeout: 30 * time.Second}
		resp, err := client.Do(req)
		if err != nil {
			return LegendMsg{Error: err}
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			return LegendMsg{Error: fmt.Errorf("legend request failed: %d", resp.StatusCode)}
		}

		data, err := io.ReadAll(resp.Body)
		if err != nil {
			return LegendMsg{Error: err}
		}

		return LegendMsg{ImageData: data}
	}
}

func (m *MapPreview) protocolName() string {
	switch m.protocol {
	case ProtocolKitty:
		return "Kitty"
	case ProtocolSixel:
		return "Sixel"
	case ProtocolChafa:
		return "Chafa"
	default:
		return "ASCII"
	}
}

// detectImageProtocol detects the best available image rendering protocol
func detectImageProtocol() ImageProtocol {
	// Check for Kitty graphics support
	if isKittyTerminal() {
		return ProtocolKitty
	}

	// Check for Sixel support (img2sixel available)
	if _, err := exec.LookPath("img2sixel"); err == nil {
		return ProtocolSixel
	}

	// Check for chafa
	if _, err := exec.LookPath("chafa"); err == nil {
		return ProtocolChafa
	}

	// Fallback to ASCII art
	return ProtocolASCII
}

// isKittyTerminal checks if we're running in a Kitty terminal
func isKittyTerminal() bool {
	term := os.Getenv("TERM")
	kitty := os.Getenv("KITTY_WINDOW_ID")
	return strings.Contains(term, "kitty") || kitty != ""
}

// decodeImage decodes image data to an image.Image
func decodeImage(data []byte) (image.Image, error) {
	return png.Decode(bytes.NewReader(data))
}
