package components

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/charmbracelet/bubbles/key"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/kartoza/kartoza-geoserver-client/internal/models"
	"github.com/kartoza/kartoza-geoserver-client/internal/tui/styles"
)

// FileBrowserKeyMap defines the key bindings for the file browser
type FileBrowserKeyMap struct {
	Up       key.Binding
	Down     key.Binding
	Enter    key.Binding
	Back     key.Binding
	Select   key.Binding
	Home     key.Binding
	End      key.Binding
	PageUp   key.Binding
	PageDown key.Binding
}

// DefaultFileBrowserKeyMap returns the default key bindings
func DefaultFileBrowserKeyMap() FileBrowserKeyMap {
	return FileBrowserKeyMap{
		Up: key.NewBinding(
			key.WithKeys("up", "k"),
			key.WithHelp("↑/k", "up"),
		),
		Down: key.NewBinding(
			key.WithKeys("down", "j"),
			key.WithHelp("↓/j", "down"),
		),
		Enter: key.NewBinding(
			key.WithKeys("enter", "l", "right"),
			key.WithHelp("enter/l", "open"),
		),
		Back: key.NewBinding(
			key.WithKeys("backspace", "h", "left"),
			key.WithHelp("backspace/h", "back"),
		),
		Select: key.NewBinding(
			key.WithKeys(" ", "insert"),
			key.WithHelp("space", "select"),
		),
		Home: key.NewBinding(
			key.WithKeys("home", "g"),
			key.WithHelp("home/g", "first"),
		),
		End: key.NewBinding(
			key.WithKeys("end", "G"),
			key.WithHelp("end/G", "last"),
		),
		PageUp: key.NewBinding(
			key.WithKeys("pgup", "ctrl+u"),
			key.WithHelp("pgup", "page up"),
		),
		PageDown: key.NewBinding(
			key.WithKeys("pgdown", "ctrl+d"),
			key.WithHelp("pgdown", "page down"),
		),
	}
}

// FileBrowser is a component for browsing the local filesystem
type FileBrowser struct {
	currentPath string
	files       []models.LocalFile
	cursor      int
	offset      int
	width       int
	height      int
	active      bool
	keyMap      FileBrowserKeyMap
	filter      string // Optional file extension filter
}

// NewFileBrowser creates a new file browser component
func NewFileBrowser(path string) *FileBrowser {
	fb := &FileBrowser{
		currentPath: path,
		keyMap:      DefaultFileBrowserKeyMap(),
	}
	fb.loadDirectory()
	return fb
}

// loadDirectory loads the contents of the current directory
func (fb *FileBrowser) loadDirectory() {
	fb.files = []models.LocalFile{}

	entries, err := os.ReadDir(fb.currentPath)
	if err != nil {
		return
	}

	// Add parent directory entry if not at root
	if fb.currentPath != "/" {
		fb.files = append(fb.files, models.LocalFile{
			Name:  "..",
			Path:  filepath.Dir(fb.currentPath),
			Type:  models.FileTypeDirectory,
			IsDir: true,
		})
	}

	var dirs, files []models.LocalFile

	for _, entry := range entries {
		// Skip hidden files
		if strings.HasPrefix(entry.Name(), ".") {
			continue
		}

		info, err := entry.Info()
		if err != nil {
			continue
		}

		file := models.LocalFile{
			Name:  entry.Name(),
			Path:  filepath.Join(fb.currentPath, entry.Name()),
			IsDir: entry.IsDir(),
			Size:  info.Size(),
		}

		if entry.IsDir() {
			file.Type = models.FileTypeDirectory
			dirs = append(dirs, file)
		} else {
			file.Type = detectFileType(entry.Name())
			files = append(files, file)
		}
	}

	// Sort directories and files separately
	sort.Slice(dirs, func(i, j int) bool {
		return strings.ToLower(dirs[i].Name) < strings.ToLower(dirs[j].Name)
	})
	sort.Slice(files, func(i, j int) bool {
		return strings.ToLower(files[i].Name) < strings.ToLower(files[j].Name)
	})

	fb.files = append(fb.files, dirs...)
	fb.files = append(fb.files, files...)
}

// detectFileType determines the file type based on extension
func detectFileType(name string) models.FileType {
	ext := strings.ToLower(filepath.Ext(name))
	name = strings.ToLower(name)

	switch ext {
	case ".shp":
		return models.FileTypeShapefile
	case ".gpkg":
		return models.FileTypeGeoPackage
	case ".tif", ".tiff", ".geotiff":
		return models.FileTypeGeoTIFF
	case ".geojson", ".json":
		if strings.Contains(name, "geo") || ext == ".geojson" {
			return models.FileTypeGeoJSON
		}
		return models.FileTypeOther
	case ".sld":
		return models.FileTypeSLD
	case ".css":
		// Could be GeoCSS style
		return models.FileTypeCSS
	case ".zip":
		// Could be a zipped shapefile
		if strings.Contains(name, "shp") {
			return models.FileTypeShapefile
		}
		return models.FileTypeOther
	default:
		return models.FileTypeOther
	}
}

// Update handles messages for the file browser
func (fb *FileBrowser) Update(msg tea.Msg) (*FileBrowser, tea.Cmd) {
	if !fb.active {
		return fb, nil
	}

	switch msg := msg.(type) {
	case tea.KeyMsg:
		switch {
		case key.Matches(msg, fb.keyMap.Up):
			if fb.cursor > 0 {
				fb.cursor--
				fb.ensureVisible()
			}

		case key.Matches(msg, fb.keyMap.Down):
			if fb.cursor < len(fb.files)-1 {
				fb.cursor++
				fb.ensureVisible()
			}

		case key.Matches(msg, fb.keyMap.Enter):
			if len(fb.files) > 0 {
				file := fb.files[fb.cursor]
				if file.IsDir {
					fb.currentPath = file.Path
					fb.cursor = 0
					fb.offset = 0
					fb.loadDirectory()
				}
			}

		case key.Matches(msg, fb.keyMap.Back):
			if fb.currentPath != "/" {
				fb.currentPath = filepath.Dir(fb.currentPath)
				fb.cursor = 0
				fb.offset = 0
				fb.loadDirectory()
			}

		case key.Matches(msg, fb.keyMap.Select):
			if len(fb.files) > 0 && !fb.files[fb.cursor].IsDir {
				fb.files[fb.cursor].Selected = !fb.files[fb.cursor].Selected
			}

		case key.Matches(msg, fb.keyMap.Home):
			fb.cursor = 0
			fb.offset = 0

		case key.Matches(msg, fb.keyMap.End):
			fb.cursor = len(fb.files) - 1
			fb.ensureVisible()

		case key.Matches(msg, fb.keyMap.PageUp):
			fb.cursor -= fb.visibleHeight()
			if fb.cursor < 0 {
				fb.cursor = 0
			}
			fb.ensureVisible()

		case key.Matches(msg, fb.keyMap.PageDown):
			fb.cursor += fb.visibleHeight()
			if fb.cursor >= len(fb.files) {
				fb.cursor = len(fb.files) - 1
			}
			fb.ensureVisible()
		}
	}

	return fb, nil
}

// visibleHeight returns the number of visible items
func (fb *FileBrowser) visibleHeight() int {
	return fb.height - 4 // Account for borders and header
}

// ensureVisible ensures the cursor is visible
func (fb *FileBrowser) ensureVisible() {
	visible := fb.visibleHeight()
	if visible <= 0 {
		return
	}

	if fb.cursor < fb.offset {
		fb.offset = fb.cursor
	} else if fb.cursor >= fb.offset+visible {
		fb.offset = fb.cursor - visible + 1
	}
}

// View renders the file browser
func (fb *FileBrowser) View() string {
	var b strings.Builder

	// Header
	pathStyle := styles.PanelHeaderStyle
	if !fb.active {
		pathStyle = pathStyle.Foreground(styles.Muted)
	}
	header := pathStyle.Render(fb.truncatePath(fb.currentPath, fb.width-4))
	b.WriteString(header)
	b.WriteString("\n")

	// Divider
	divider := styles.TreeBranchStyle.Render(strings.Repeat("─", fb.width-4))
	b.WriteString(divider)
	b.WriteString("\n")

	// Files list
	visible := fb.visibleHeight()
	if visible <= 0 {
		visible = 10
	}

	for i := fb.offset; i < fb.offset+visible && i < len(fb.files); i++ {
		file := fb.files[i]
		line := fb.renderFile(file, i == fb.cursor)
		b.WriteString(line)
		if i < fb.offset+visible-1 && i < len(fb.files)-1 {
			b.WriteString("\n")
		}
	}

	// Fill remaining space
	rendered := strings.Count(b.String(), "\n") + 1
	for i := rendered; i < fb.height-2; i++ {
		b.WriteString("\n")
	}

	// Status line
	status := fmt.Sprintf(" %d items", len(fb.files))
	if selected := fb.selectedCount(); selected > 0 {
		status += fmt.Sprintf(" | %d selected", selected)
	}
	b.WriteString("\n")
	b.WriteString(styles.StatusBarStyle.Width(fb.width-4).Render(status))

	// Build panel
	panelStyle := styles.PanelStyle
	if fb.active {
		panelStyle = styles.ActivePanelStyle
	}

	return panelStyle.Width(fb.width).Height(fb.height).Render(b.String())
}

// renderFile renders a single file entry
func (fb *FileBrowser) renderFile(file models.LocalFile, selected bool) string {
	icon := file.Type.Icon()

	// Build the line
	var style lipgloss.Style
	if selected && fb.active {
		style = styles.ActiveItemStyle
	} else if selected {
		style = styles.SelectedItemStyle
	} else if file.IsDir {
		style = styles.DirectoryStyle
	} else if file.Type.CanUpload() {
		style = styles.GeoFileStyle
	} else {
		style = styles.ItemStyle
	}

	// Selection marker
	marker := " "
	if file.Selected {
		marker = "●"
	}

	name := fb.truncateName(file.Name, fb.width-10)
	line := fmt.Sprintf("%s %s %s", marker, icon, name)

	return style.Width(fb.width - 4).Render(line)
}

// truncatePath truncates the path to fit the width
func (fb *FileBrowser) truncatePath(path string, maxWidth int) string {
	if len(path) <= maxWidth {
		return path
	}

	// Try to show at least the last part
	parts := strings.Split(path, string(os.PathSeparator))
	if len(parts) <= 1 {
		return path[:maxWidth-3] + "..."
	}

	// Build from the end
	result := parts[len(parts)-1]
	for i := len(parts) - 2; i >= 0; i-- {
		next := parts[i] + string(os.PathSeparator) + result
		if len(next)+3 > maxWidth {
			return "..." + string(os.PathSeparator) + result
		}
		result = next
	}

	return result
}

// truncateName truncates a file name to fit the width
func (fb *FileBrowser) truncateName(name string, maxWidth int) string {
	if len(name) <= maxWidth {
		return name
	}
	return name[:maxWidth-3] + "..."
}

// selectedCount returns the number of selected files
func (fb *FileBrowser) selectedCount() int {
	count := 0
	for _, f := range fb.files {
		if f.Selected {
			count++
		}
	}
	return count
}

// SetSize sets the size of the file browser
func (fb *FileBrowser) SetSize(width, height int) {
	fb.width = width
	fb.height = height
}

// SetActive sets whether the file browser is active
func (fb *FileBrowser) SetActive(active bool) {
	fb.active = active
}

// IsActive returns whether the file browser is active
func (fb *FileBrowser) IsActive() bool {
	return fb.active
}

// CurrentPath returns the current directory path
func (fb *FileBrowser) CurrentPath() string {
	return fb.currentPath
}

// SetPath sets the current directory path
func (fb *FileBrowser) SetPath(path string) {
	fb.currentPath = path
	fb.cursor = 0
	fb.offset = 0
	fb.loadDirectory()
}

// SelectedFile returns the currently highlighted file
func (fb *FileBrowser) SelectedFile() *models.LocalFile {
	if len(fb.files) == 0 || fb.cursor >= len(fb.files) {
		return nil
	}
	return &fb.files[fb.cursor]
}

// SelectedFiles returns all selected files
func (fb *FileBrowser) SelectedFiles() []models.LocalFile {
	var selected []models.LocalFile
	for _, f := range fb.files {
		if f.Selected {
			selected = append(selected, f)
		}
	}
	return selected
}

// ClearSelection clears all file selections
func (fb *FileBrowser) ClearSelection() {
	for i := range fb.files {
		fb.files[i].Selected = false
	}
}

// Refresh reloads the current directory
func (fb *FileBrowser) Refresh() {
	fb.loadDirectory()
}
