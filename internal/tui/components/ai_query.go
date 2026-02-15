package components

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/charmbracelet/bubbles/textarea"
	"github.com/charmbracelet/bubbles/viewport"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/kartoza/kartoza-cloudbench/internal/llm"
)

// AIQueryMode represents the current mode of the AI query component
type AIQueryMode int

const (
	AIQueryModeInput AIQueryMode = iota
	AIQueryModeResults
	AIQueryModeExecuting
)

// AIQuery is a component for natural language to SQL queries
type AIQuery struct {
	width  int
	height int

	mode          AIQueryMode
	questionInput textarea.Model
	resultView    viewport.Model

	serviceName string
	schemaName  string
	engine      *llm.Engine
	executor    *llm.QueryExecutor

	generatedSQL string
	explanation  string
	confidence   float64
	warnings     []string
	queryResult  *llm.QueryResult
	error        string

	showHelp  bool
	cancelled bool
}

// AIQueryResultMsg is sent when SQL generation completes
type AIQueryResultMsg struct {
	SQL         string
	Explanation string
	Confidence  float64
	Warnings    []string
	Error       error
}

// AIQueryExecuteMsg is sent when query execution completes
type AIQueryExecuteMsg struct {
	Result *llm.QueryResult
	Error  error
}

// NewAIQuery creates a new AI query component
func NewAIQuery(serviceName, schemaName string, width, height int) *AIQuery {
	// Create question input
	ti := textarea.New()
	ti.Placeholder = "Ask a question about your data in natural language...\n\nExamples:\n- Show me all countries with population > 1 million\n- What are the top 10 cities by area?\n- Find all roads that intersect with parks"
	ti.Focus()
	ti.SetWidth(width - 4)
	ti.SetHeight(5)
	ti.CharLimit = 1000

	// Create result viewport
	vp := viewport.New(width-4, height-15)

	// Initialize engine
	engine := llm.NewEngine()
	ollamaConfig := llm.ProviderConfig{
		Endpoint:    "http://localhost:11434",
		Model:       "llama3.2",
		MaxTokens:   2048,
		Temperature: 0.1,
	}
	engine.RegisterProvider(llm.NewOllamaProvider(ollamaConfig))

	// Initialize executor
	executor := llm.NewQueryExecutor(
		llm.WithMaxRows(100),
		llm.WithTimeout(30*time.Second),
		llm.WithReadOnly(true),
	)

	return &AIQuery{
		width:         width,
		height:        height,
		mode:          AIQueryModeInput,
		questionInput: ti,
		resultView:    vp,
		serviceName:   serviceName,
		schemaName:    schemaName,
		engine:        engine,
		executor:      executor,
	}
}

// Init implements tea.Model
func (q *AIQuery) Init() tea.Cmd {
	return textarea.Blink
}

// Update implements tea.Model
func (q *AIQuery) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	var cmds []tea.Cmd

	switch msg := msg.(type) {
	case AIQueryResultMsg:
		if msg.Error != nil {
			q.error = msg.Error.Error()
			q.mode = AIQueryModeResults
		} else {
			q.generatedSQL = msg.SQL
			q.explanation = msg.Explanation
			q.confidence = msg.Confidence
			q.warnings = msg.Warnings
			q.mode = AIQueryModeResults
			q.updateResultView()
		}
		return q, nil

	case AIQueryExecuteMsg:
		if msg.Error != nil {
			q.error = msg.Error.Error()
		} else {
			q.queryResult = msg.Result
			q.updateResultView()
		}
		q.mode = AIQueryModeResults
		return q, nil

	case tea.KeyMsg:
		switch msg.String() {
		case "esc":
			if q.mode == AIQueryModeResults {
				q.mode = AIQueryModeInput
				q.generatedSQL = ""
				q.queryResult = nil
				q.error = ""
				return q, nil
			}
			q.cancelled = true
			return q, nil

		case "ctrl+c":
			q.cancelled = true
			return q, nil

		case "?":
			q.showHelp = !q.showHelp
			return q, nil

		case "enter":
			if q.mode == AIQueryModeInput && msg.String() == "enter" {
				// Check for Ctrl/Shift modifier - plain enter submits
				question := strings.TrimSpace(q.questionInput.Value())
				if question != "" && !strings.HasSuffix(question, "\n") {
					q.mode = AIQueryModeExecuting
					return q, q.generateSQL(question)
				}
			}

		case "ctrl+enter":
			// Submit question
			question := strings.TrimSpace(q.questionInput.Value())
			if question != "" {
				q.mode = AIQueryModeExecuting
				return q, q.generateSQL(question)
			}

		case "ctrl+e":
			// Execute generated SQL
			if q.mode == AIQueryModeResults && q.generatedSQL != "" {
				q.mode = AIQueryModeExecuting
				return q, q.executeSQL()
			}

		case "ctrl+n":
			// New query
			q.mode = AIQueryModeInput
			q.generatedSQL = ""
			q.queryResult = nil
			q.error = ""
			q.questionInput.Reset()
			q.questionInput.Focus()
			return q, nil
		}
	}

	// Update appropriate component based on mode
	switch q.mode {
	case AIQueryModeInput:
		var cmd tea.Cmd
		q.questionInput, cmd = q.questionInput.Update(msg)
		cmds = append(cmds, cmd)
	case AIQueryModeResults:
		var cmd tea.Cmd
		q.resultView, cmd = q.resultView.Update(msg)
		cmds = append(cmds, cmd)
	}

	return q, tea.Batch(cmds...)
}

func (q *AIQuery) generateSQL(question string) tea.Cmd {
	return func() tea.Msg {
		ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
		defer cancel()

		// Build schema context
		schemaCtx, err := llm.BuildSchemaContext(q.serviceName)
		if err != nil {
			return AIQueryResultMsg{Error: err}
		}

		// Filter to specific schema
		if q.schemaName != "" {
			var filtered []llm.SchemaInfo
			for _, s := range schemaCtx.Schemas {
				if s.Name == q.schemaName {
					filtered = append(filtered, s)
					break
				}
			}
			schemaCtx.Schemas = filtered
		}

		// Generate SQL
		req := llm.QueryRequest{
			Question:    question,
			ServiceName: q.serviceName,
			SchemaName:  q.schemaName,
			MaxRows:     100,
		}

		resp, err := q.engine.GenerateSQL(ctx, req, *schemaCtx)
		if err != nil {
			return AIQueryResultMsg{Error: err}
		}

		return AIQueryResultMsg{
			SQL:         resp.SQL,
			Explanation: resp.Explanation,
			Confidence:  resp.Confidence,
			Warnings:    resp.Warnings,
		}
	}
}

func (q *AIQuery) executeSQL() tea.Cmd {
	return func() tea.Msg {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()

		result, err := q.executor.Execute(ctx, q.serviceName, q.generatedSQL)
		if err != nil {
			return AIQueryExecuteMsg{Error: err}
		}

		return AIQueryExecuteMsg{Result: result}
	}
}

func (q *AIQuery) updateResultView() {
	var sb strings.Builder

	if q.error != "" {
		sb.WriteString(lipgloss.NewStyle().
			Foreground(lipgloss.Color("196")).
			Bold(true).
			Render("Error: "))
		sb.WriteString(q.error)
		sb.WriteString("\n")
	} else {
		// Show generated SQL
		sb.WriteString(lipgloss.NewStyle().
			Bold(true).
			Foreground(lipgloss.Color("39")).
			Render("Generated SQL:"))
		sb.WriteString("\n\n")
		sb.WriteString(lipgloss.NewStyle().
			Background(lipgloss.Color("236")).
			Padding(1).
			Render(q.generatedSQL))
		sb.WriteString("\n\n")

		// Show confidence
		confStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("82"))
		if q.confidence < 0.7 {
			confStyle = confStyle.Foreground(lipgloss.Color("214"))
		}
		if q.confidence < 0.5 {
			confStyle = confStyle.Foreground(lipgloss.Color("196"))
		}
		sb.WriteString(fmt.Sprintf("Confidence: %s\n", confStyle.Render(fmt.Sprintf("%.0f%%", q.confidence*100))))

		// Show warnings
		if len(q.warnings) > 0 {
			sb.WriteString("\n")
			sb.WriteString(lipgloss.NewStyle().
				Foreground(lipgloss.Color("214")).
				Bold(true).
				Render("Warnings:"))
			sb.WriteString("\n")
			for _, w := range q.warnings {
				sb.WriteString(fmt.Sprintf("  • %s\n", w))
			}
		}

		// Show query results
		if q.queryResult != nil {
			sb.WriteString("\n")
			sb.WriteString(lipgloss.NewStyle().
				Bold(true).
				Foreground(lipgloss.Color("82")).
				Render(fmt.Sprintf("Results: %d rows (%.2fms)", q.queryResult.RowCount, q.queryResult.Duration)))
			sb.WriteString("\n\n")

			// Render results as table
			if len(q.queryResult.Rows) > 0 {
				sb.WriteString(q.renderResultsTable())
			}
		}
	}

	q.resultView.SetContent(sb.String())
}

func (q *AIQuery) renderResultsTable() string {
	if q.queryResult == nil || len(q.queryResult.Rows) == 0 {
		return ""
	}

	var sb strings.Builder

	// Header
	headerStyle := lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("39"))
	for i, col := range q.queryResult.Columns {
		if i > 0 {
			sb.WriteString(" | ")
		}
		sb.WriteString(headerStyle.Render(col.Name))
	}
	sb.WriteString("\n")

	// Separator
	for i := range q.queryResult.Columns {
		if i > 0 {
			sb.WriteString("-+-")
		}
		sb.WriteString("----------")
	}
	sb.WriteString("\n")

	// Data rows (limit to first 20 for display)
	maxDisplay := 20
	for i, row := range q.queryResult.Rows {
		if i >= maxDisplay {
			sb.WriteString(fmt.Sprintf("... and %d more rows\n", q.queryResult.RowCount-maxDisplay))
			break
		}
		for j, col := range q.queryResult.Columns {
			if j > 0 {
				sb.WriteString(" | ")
			}
			val := row[col.Name]
			valStr := fmt.Sprintf("%v", val)
			if len(valStr) > 30 {
				valStr = valStr[:27] + "..."
			}
			sb.WriteString(valStr)
		}
		sb.WriteString("\n")
	}

	return sb.String()
}

// View implements tea.Model
func (q *AIQuery) View() string {
	var sb strings.Builder

	titleStyle := lipgloss.NewStyle().
		Bold(true).
		Foreground(lipgloss.Color("39")).
		MarginBottom(1)

	sb.WriteString(titleStyle.Render("AI Query Engine"))
	sb.WriteString(fmt.Sprintf(" (Service: %s", q.serviceName))
	if q.schemaName != "" {
		sb.WriteString(fmt.Sprintf(", Schema: %s", q.schemaName))
	}
	sb.WriteString(")\n\n")

	// Check if provider is available
	if q.engine.GetActiveProvider() == nil || !q.engine.GetActiveProvider().IsAvailable() {
		sb.WriteString(lipgloss.NewStyle().
			Foreground(lipgloss.Color("214")).
			Render("⚠ Ollama is not running. Please start Ollama with: ollama serve"))
		sb.WriteString("\n\n")
	}

	switch q.mode {
	case AIQueryModeInput:
		sb.WriteString("Ask a question about your data:\n\n")
		sb.WriteString(q.questionInput.View())
		sb.WriteString("\n\n")
		sb.WriteString(lipgloss.NewStyle().Faint(true).Render("Enter: Submit question  Esc: Cancel  ?: Help"))

	case AIQueryModeExecuting:
		sb.WriteString("Generating SQL query...\n\n")
		sb.WriteString("⏳ Please wait, this may take a moment...")

	case AIQueryModeResults:
		sb.WriteString(q.resultView.View())
		sb.WriteString("\n\n")
		if q.generatedSQL != "" && q.queryResult == nil && q.error == "" {
			sb.WriteString(lipgloss.NewStyle().Faint(true).Render("Ctrl+E: Execute query  Ctrl+N: New query  Esc: Back"))
		} else {
			sb.WriteString(lipgloss.NewStyle().Faint(true).Render("Ctrl+N: New query  Esc: Back"))
		}
	}

	if q.showHelp {
		sb.WriteString("\n\n")
		sb.WriteString(q.renderHelp())
	}

	return sb.String()
}

func (q *AIQuery) renderHelp() string {
	helpStyle := lipgloss.NewStyle().
		Border(lipgloss.RoundedBorder()).
		Padding(1).
		BorderForeground(lipgloss.Color("240"))

	help := `AI Query Engine Help

This tool converts natural language questions into SQL queries.

Example questions:
• "Show me all countries with population > 1 million"
• "What are the top 10 largest cities?"
• "Find all roads that intersect with parks"
• "Count features by type"
• "Show the bounding box of all geometries"

For spatial queries, PostGIS functions will be used:
• ST_Area, ST_Length, ST_Centroid
• ST_Intersects, ST_Contains, ST_Within
• ST_Transform, ST_Buffer, ST_Union

Keyboard shortcuts:
• Enter       - Submit question
• Ctrl+E      - Execute generated SQL
• Ctrl+N      - Start new query
• Esc         - Go back / Cancel
• ?           - Toggle this help`

	return helpStyle.Render(help)
}

// IsCancelled returns true if the component was cancelled
func (q *AIQuery) IsCancelled() bool {
	return q.cancelled
}

// GetGeneratedSQL returns the generated SQL
func (q *AIQuery) GetGeneratedSQL() string {
	return q.generatedSQL
}

// GetQueryResult returns the query result
func (q *AIQuery) GetQueryResult() *llm.QueryResult {
	return q.queryResult
}
