package components

import (
	"fmt"
	"strings"
	"time"

	"github.com/charmbracelet/bubbles/progress"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/harmonica"
	"github.com/charmbracelet/lipgloss"
	"github.com/kartoza/kartoza-geoserver-client/internal/tui/styles"
)

// ProgressDialogAnimationMsg is sent to update animation state
type ProgressDialogAnimationMsg struct {
	ID string
}

// ProgressUpdateMsg is sent to update progress
type ProgressUpdateMsg struct {
	ID                 string
	Current            int
	Total              int
	ItemName           string
	Done               bool
	Error              error
	VerificationResult string // Optional verification result text
	VerificationOK     bool   // Whether verification passed
}

// ProgressDialog displays upload/operation progress with harmonica physics
type ProgressDialog struct {
	id          string
	title       string
	icon        string
	items       []string
	currentItem int
	totalItems  int
	currentName string
	progress    progress.Model
	width       int
	height      int
	visible     bool
	done        bool
	err         error

	// Verification results
	verificationResult string
	verificationOK     bool

	// Callbacks
	onComplete func()
	onError    func(error)

	// Harmonica physics for smooth animations
	spring        harmonica.Spring
	animScale     float64
	animVelocity  float64
	animOpacity   float64
	targetScale   float64
	targetOpacity float64
	animating     bool
	closing       bool
}

// NewProgressDialog creates a new progress dialog
func NewProgressDialog(title, icon string, items []string) *ProgressDialog {
	p := progress.New(
		progress.WithDefaultGradient(),
		progress.WithWidth(40),
		progress.WithoutPercentage(),
	)

	return &ProgressDialog{
		id:            title,
		title:         title,
		icon:          icon,
		items:         items,
		totalItems:    len(items),
		currentItem:   0,
		progress:      p,
		visible:       true,
		spring:        harmonica.NewSpring(harmonica.FPS(60), 6.0, 0.5),
		animScale:     0.0,
		animOpacity:   0.0,
		targetScale:   1.0,
		targetOpacity: 1.0,
		animating:     true,
	}
}

// SetSize sets the dialog size
func (d *ProgressDialog) SetSize(width, height int) {
	d.width = width
	d.height = height
	// Update progress bar width
	barWidth := width/2 - 20
	if barWidth < 30 {
		barWidth = 30
	}
	if barWidth > 50 {
		barWidth = 50
	}
	d.progress.Width = barWidth
}

// SetCallbacks sets the completion callbacks
func (d *ProgressDialog) SetCallbacks(onComplete func(), onError func(error)) {
	d.onComplete = onComplete
	d.onError = onError
}

// IsVisible returns whether the dialog is visible
func (d *ProgressDialog) IsVisible() bool {
	return d.visible
}

// IsDone returns whether the operation is complete
func (d *ProgressDialog) IsDone() bool {
	return d.done
}

// GetError returns any error that occurred
func (d *ProgressDialog) GetError() error {
	return d.err
}

// StartCloseAnimation starts the closing animation
func (d *ProgressDialog) StartCloseAnimation() tea.Cmd {
	d.closing = true
	d.targetScale = 0.0
	d.targetOpacity = 0.0
	d.animating = true
	// Use a stiffer, critically-damped spring for faster closing
	d.spring = harmonica.NewSpring(harmonica.FPS(60), 12.0, 1.0)
	return d.animateCmd()
}

// animateCmd returns a command to continue the animation
func (d *ProgressDialog) animateCmd() tea.Cmd {
	return tea.Tick(time.Second/60, func(t time.Time) tea.Msg {
		return ProgressDialogAnimationMsg{ID: d.id}
	})
}

// Init initializes the dialog and starts the opening animation
func (d *ProgressDialog) Init() tea.Cmd {
	return d.animateCmd()
}

// Update handles messages
func (d *ProgressDialog) Update(msg tea.Msg) (*ProgressDialog, tea.Cmd) {
	var cmds []tea.Cmd

	switch msg := msg.(type) {
	case ProgressDialogAnimationMsg:
		if msg.ID != d.id {
			return d, nil
		}
		return d.updateAnimation()

	case ProgressUpdateMsg:
		if msg.ID != d.id {
			return d, nil
		}
		d.currentItem = msg.Current
		d.currentName = msg.ItemName

		// Store verification results if provided
		if msg.VerificationResult != "" {
			d.verificationResult = msg.VerificationResult
			d.verificationOK = msg.VerificationOK
		}

		if msg.Error != nil {
			d.err = msg.Error
			d.done = true
			if d.onError != nil {
				d.onError(msg.Error)
			}
			// Start close animation after a brief delay to show error
			cmds = append(cmds, tea.Tick(time.Second*2, func(t time.Time) tea.Msg {
				return ProgressDialogAnimationMsg{ID: d.id + "-close"}
			}))
		} else if msg.Done {
			d.done = true
			d.currentItem = d.totalItems
			if d.onComplete != nil {
				d.onComplete()
			}
			// Wait longer if we have verification results to show
			delay := time.Millisecond * 500
			if d.verificationResult != "" {
				delay = time.Second * 3
			}
			cmds = append(cmds, tea.Tick(delay, func(t time.Time) tea.Msg {
				return ProgressDialogAnimationMsg{ID: d.id + "-close"}
			}))
		}

		// Update progress bar
		percent := float64(d.currentItem) / float64(d.totalItems)
		cmds = append(cmds, d.progress.SetPercent(percent))

	case progress.FrameMsg:
		progressModel, cmd := d.progress.Update(msg)
		d.progress = progressModel.(progress.Model)
		if cmd != nil {
			cmds = append(cmds, cmd)
		}

	case tea.KeyMsg:
		// Allow escape to cancel (if not done)
		if !d.done && msg.String() == "esc" {
			d.err = fmt.Errorf("cancelled by user")
			d.done = true
			return d, d.StartCloseAnimation()
		}
		// If done, any key closes
		if d.done {
			return d, d.StartCloseAnimation()
		}
	}

	return d, tea.Batch(cmds...)
}

// updateAnimation updates the harmonica physics animation
func (d *ProgressDialog) updateAnimation() (*ProgressDialog, tea.Cmd) {
	if !d.animating {
		return d, nil
	}

	// Update scale using spring physics
	d.animScale, d.animVelocity = d.spring.Update(d.animScale, d.animVelocity, d.targetScale)

	// Update opacity - faster when closing
	opacityStep := 0.1
	if d.closing {
		opacityStep = 0.15 // Faster fade out
		d.animOpacity -= opacityStep
		if d.animOpacity < 0 {
			d.animOpacity = 0
		}
	} else {
		d.animOpacity += opacityStep
		if d.animOpacity > 1 {
			d.animOpacity = 1
		}
	}

	// Check if animation is complete - use more relaxed threshold when closing
	threshold := 0.01
	if d.closing {
		threshold = 0.05 // More relaxed threshold for faster closing
	}
	scaleClose := abs(d.animScale-d.targetScale) < threshold && abs(d.animVelocity) < threshold
	opacityClose := d.closing && d.animOpacity <= 0.01 || !d.closing && d.animOpacity >= 0.99

	if scaleClose && opacityClose {
		d.animating = false
		d.animScale = d.targetScale
		d.animOpacity = d.targetOpacity

		if d.closing {
			d.visible = false
			return d, nil
		}
	}

	return d, d.animateCmd()
}

// View renders the dialog with animation
func (d *ProgressDialog) View() string {
	if !d.visible {
		return ""
	}

	dialogWidth := d.width/2 + 10
	if dialogWidth < 50 {
		dialogWidth = 50
	}
	maxWidth := 70
	if d.verificationResult != "" {
		maxWidth = 80
	}
	if dialogWidth > maxWidth {
		dialogWidth = maxWidth
	}

	scaledWidth := int(float64(dialogWidth) * d.animScale)
	if scaledWidth < 10 {
		scaledWidth = 10
	}

	dialogStyle := styles.DialogStyle.Width(scaledWidth)
	marginOffset := int((1.0 - d.animScale) * 5)
	dialogStyle = dialogStyle.MarginTop(marginOffset).MarginBottom(marginOffset)

	// When closing, render empty frame only
	if d.closing {
		dialog := dialogStyle.Render("")
		return styles.Center(d.width, d.height, dialog)
	}

	var b strings.Builder

	// Title with icon
	titleText := fmt.Sprintf("%s  %s", d.icon, d.title)
	title := styles.DialogTitleStyle.Render(titleText)
	b.WriteString(title)
	b.WriteString("\n\n")

	// Progress info
	if d.err != nil {
		// Error state
		errorIcon := styles.ErrorStyle.Render("✗")
		b.WriteString(fmt.Sprintf("%s Error: %v\n\n", errorIcon, d.err))
	} else if d.done {
		// Complete state
		successIcon := styles.SuccessStyle.Render("✓")
		b.WriteString(fmt.Sprintf("%s Complete! Uploaded %d file(s)\n\n", successIcon, d.totalItems))

		// Show verification results if available
		if d.verificationResult != "" {
			b.WriteString(styles.DialogTitleStyle.Render("Verification"))
			b.WriteString("\n")
			// Color the result based on success/failure
			if d.verificationOK {
				b.WriteString(styles.SuccessStyle.Render(d.verificationResult))
			} else {
				b.WriteString(styles.ErrorStyle.Render(d.verificationResult))
			}
			b.WriteString("\n")
		}
	} else {
		// In progress state
		b.WriteString(fmt.Sprintf("Uploading %d of %d files...\n\n", d.currentItem+1, d.totalItems))

		// Current file name
		if d.currentName != "" {
			nameStyle := styles.HelpKeyStyle
			truncatedName := d.currentName
			if len(truncatedName) > 35 {
				truncatedName = "..." + truncatedName[len(truncatedName)-32:]
			}
			b.WriteString(nameStyle.Render(truncatedName))
			b.WriteString("\n\n")
		}
	}

	// Progress bar
	b.WriteString(d.progress.View())
	b.WriteString("\n\n")

	// Percentage
	percent := float64(d.currentItem) / float64(d.totalItems) * 100
	if d.done && d.err == nil {
		percent = 100
	}
	percentStyle := styles.ItemStyle
	if d.done && d.err == nil {
		percentStyle = styles.SuccessStyle
	} else if d.err != nil {
		percentStyle = styles.ErrorStyle
	}
	b.WriteString(percentStyle.Render(fmt.Sprintf("%.0f%%", percent)))
	b.WriteString("\n\n")

	// Help text
	if d.done {
		b.WriteString(styles.HelpTextStyle.Render("Press any key to close"))
	} else {
		b.WriteString(styles.HelpTextStyle.Render("Press Esc to cancel"))
	}

	dialog := dialogStyle.Render(b.String())

	// Apply opacity effect
	if d.animOpacity < 1.0 && d.animOpacity > 0.5 {
		dialog = lipgloss.NewStyle().Render(dialog)
	} else if d.animOpacity <= 0.5 {
		fadedStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("#666666"))
		dialog = fadedStyle.Render(dialog)
	}

	return styles.Center(d.width, d.height, dialog)
}

// SendProgress sends a progress update message
func SendProgressUpdate(id string, current, total int, itemName string, done bool, err error) tea.Cmd {
	return func() tea.Msg {
		return ProgressUpdateMsg{
			ID:       id,
			Current:  current,
			Total:    total,
			ItemName: itemName,
			Done:     done,
			Error:    err,
		}
	}
}
