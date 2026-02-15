package components

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/charmbracelet/bubbles/list"
	"github.com/charmbracelet/bubbles/textinput"
	"github.com/charmbracelet/bubbles/viewport"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/kartoza/kartoza-cloudbench/internal/llm"
	"github.com/kartoza/kartoza-cloudbench/internal/query"
)

// QueryDesignerMode represents the current view mode
type QueryDesignerMode int

const (
	QueryDesignerModeTable QueryDesignerMode = iota
	QueryDesignerModeColumns
	QueryDesignerModeConditions
	QueryDesignerModeOrderBy
	QueryDesignerModeSQL
	QueryDesignerModeResults
	QueryDesignerModeExecuting
)

// QueryDesigner is a visual query builder component
type QueryDesigner struct {
	width  int
	height int

	mode        QueryDesignerMode
	focusIndex  int
	serviceName string

	// Schema/table selection
	schemas       []string
	tables        []string
	selectedSchema string
	selectedTable  string
	schemaList    list.Model
	tableList     list.Model

	// Column selection
	availableColumns []columnInfo
	selectedColumns  []query.Column
	columnList       list.Model

	// Conditions
	conditions      []query.Condition
	conditionInputs []textinput.Model

	// Order by
	orderBy []query.OrderBy

	// Query options
	limit    int
	offset   int
	distinct bool

	// Generated SQL and results
	generatedSQL string
	resultView   viewport.Model
	queryResult  *llm.QueryResult
	error        string

	// Input for new condition
	condColumn   textinput.Model
	condOperator string
	condValue    textinput.Model

	cancelled bool
	showHelp  bool
}

type columnInfo struct {
	name     string
	dataType string
	nullable bool
	isGeom   bool
}

// Column info as list item
func (c columnInfo) FilterValue() string { return c.name }
func (c columnInfo) Title() string       { return c.name }
func (c columnInfo) Description() string {
	desc := c.dataType
	if c.nullable {
		desc += " (nullable)"
	}
	if c.isGeom {
		desc += " [geometry]"
	}
	return desc
}

// String items for schema/table lists
type stringItem string

func (s stringItem) FilterValue() string { return string(s) }
func (s stringItem) Title() string       { return string(s) }
func (s stringItem) Description() string { return "" }

// QueryDesignerResultMsg is sent when column info is loaded
type QueryDesignerColumnsMsg struct {
	Columns []columnInfo
	Error   error
}

// QueryDesignerExecuteMsg is sent when query execution completes
type QueryDesignerExecuteMsg struct {
	Result *llm.QueryResult
	SQL    string
	Error  error
}

// NewQueryDesigner creates a new visual query designer
func NewQueryDesigner(serviceName string, width, height int) *QueryDesigner {
	// Create schema list
	schemaDelegate := list.NewDefaultDelegate()
	schemaList := list.New([]list.Item{stringItem("public")}, schemaDelegate, width/3, height-10)
	schemaList.Title = "Schemas"
	schemaList.SetShowStatusBar(false)
	schemaList.SetShowHelp(false)

	// Create table list
	tableDelegate := list.NewDefaultDelegate()
	tableList := list.New([]list.Item{}, tableDelegate, width/3, height-10)
	tableList.Title = "Tables"
	tableList.SetShowStatusBar(false)
	tableList.SetShowHelp(false)

	// Create column list
	colDelegate := list.NewDefaultDelegate()
	columnList := list.New([]list.Item{}, colDelegate, width/2, height-15)
	columnList.Title = "Available Columns"
	columnList.SetShowStatusBar(false)
	columnList.SetShowHelp(false)

	// Create result viewport
	vp := viewport.New(width-4, height-15)

	// Create condition inputs
	condCol := textinput.New()
	condCol.Placeholder = "column_name"
	condCol.Width = 20

	condVal := textinput.New()
	condVal.Placeholder = "value"
	condVal.Width = 20

	return &QueryDesigner{
		width:          width,
		height:         height,
		mode:           QueryDesignerModeTable,
		serviceName:    serviceName,
		schemas:        []string{"public"},
		selectedSchema: "public",
		schemaList:     schemaList,
		tableList:      tableList,
		columnList:     columnList,
		resultView:     vp,
		condColumn:     condCol,
		condValue:      condVal,
		condOperator:   "=",
		limit:          100,
		conditions:     []query.Condition{},
		orderBy:        []query.OrderBy{},
		selectedColumns: []query.Column{},
	}
}

// Init initializes the component
func (q *QueryDesigner) Init() tea.Cmd {
	return q.loadTables()
}

func (q *QueryDesigner) loadTables() tea.Cmd {
	return func() tea.Msg {
		// Load tables from PostgreSQL service
		executor := llm.NewQueryExecutor(
			llm.WithMaxRows(1000),
			llm.WithTimeout(10*time.Second),
			llm.WithReadOnly(true),
		)

		ctx := context.Background()
		sql := fmt.Sprintf(`
			SELECT table_name
			FROM information_schema.tables
			WHERE table_schema = '%s'
			AND table_type = 'BASE TABLE'
			ORDER BY table_name
		`, q.selectedSchema)

		result, err := executor.Execute(ctx, q.serviceName, sql)
		if err != nil {
			return QueryDesignerColumnsMsg{Error: err}
		}

		var tables []string
		for _, row := range result.Rows {
			if name, ok := row["table_name"].(string); ok {
				tables = append(tables, name)
			}
		}

		return tableListMsg{Tables: tables}
	}
}

type tableListMsg struct {
	Tables []string
}

func (q *QueryDesigner) loadColumns() tea.Cmd {
	return func() tea.Msg {
		executor := llm.NewQueryExecutor(
			llm.WithMaxRows(1000),
			llm.WithTimeout(10*time.Second),
			llm.WithReadOnly(true),
		)

		ctx := context.Background()
		sql := fmt.Sprintf(`
			SELECT
				c.column_name,
				c.data_type,
				c.is_nullable,
				CASE WHEN g.type IS NOT NULL THEN true ELSE false END as is_geometry
			FROM information_schema.columns c
			LEFT JOIN geometry_columns g
				ON g.f_table_schema = c.table_schema
				AND g.f_table_name = c.table_name
				AND g.f_geometry_column = c.column_name
			WHERE c.table_schema = '%s'
			AND c.table_name = '%s'
			ORDER BY c.ordinal_position
		`, q.selectedSchema, q.selectedTable)

		result, err := executor.Execute(ctx, q.serviceName, sql)
		if err != nil {
			return QueryDesignerColumnsMsg{Error: err}
		}

		var cols []columnInfo
		for _, row := range result.Rows {
			col := columnInfo{
				name:     getString(row, "column_name"),
				dataType: getString(row, "data_type"),
				nullable: getString(row, "is_nullable") == "YES",
				isGeom:   getBool(row, "is_geometry"),
			}
			cols = append(cols, col)
		}

		return QueryDesignerColumnsMsg{Columns: cols}
	}
}

func getString(row map[string]interface{}, key string) string {
	if v, ok := row[key].(string); ok {
		return v
	}
	return ""
}

func getBool(row map[string]interface{}, key string) bool {
	if v, ok := row[key].(bool); ok {
		return v
	}
	return false
}

// Update handles messages
func (q *QueryDesigner) Update(msg tea.Msg) (*QueryDesigner, tea.Cmd) {
	var cmds []tea.Cmd

	switch msg := msg.(type) {
	case tea.KeyMsg:
		switch msg.String() {
		case "esc":
			if q.mode == QueryDesignerModeResults {
				q.mode = QueryDesignerModeSQL
				return q, nil
			}
			q.cancelled = true
			return q, nil

		case "tab":
			// Cycle through modes
			q.mode = (q.mode + 1) % 5
			return q, nil

		case "shift+tab":
			if q.mode == 0 {
				q.mode = 4
			} else {
				q.mode--
			}
			return q, nil

		case "enter":
			switch q.mode {
			case QueryDesignerModeTable:
				// Select table and load columns
				if item := q.tableList.SelectedItem(); item != nil {
					q.selectedTable = string(item.(stringItem))
					q.mode = QueryDesignerModeColumns
					return q, q.loadColumns()
				}

			case QueryDesignerModeColumns:
				// Toggle column selection
				if item := q.columnList.SelectedItem(); item != nil {
					col := item.(columnInfo)
					q.toggleColumn(col.name)
				}
				return q, nil

			case QueryDesignerModeSQL:
				// Execute query
				return q, q.executeQuery()
			}

		case "ctrl+e":
			// Execute from any mode
			return q, q.executeQuery()

		case "?":
			q.showHelp = !q.showHelp
			return q, nil

		case "*":
			// Select all columns
			if q.mode == QueryDesignerModeColumns {
				q.selectedColumns = []query.Column{{Name: "*"}}
			}
			return q, nil

		case "d":
			// Toggle distinct
			q.distinct = !q.distinct
			return q, nil
		}

	case tableListMsg:
		q.tables = msg.Tables
		items := make([]list.Item, len(msg.Tables))
		for i, t := range msg.Tables {
			items[i] = stringItem(t)
		}
		q.tableList.SetItems(items)
		return q, nil

	case QueryDesignerColumnsMsg:
		if msg.Error != nil {
			q.error = msg.Error.Error()
			return q, nil
		}
		q.availableColumns = msg.Columns
		items := make([]list.Item, len(msg.Columns))
		for i, c := range msg.Columns {
			items[i] = c
		}
		q.columnList.SetItems(items)
		return q, nil

	case QueryDesignerExecuteMsg:
		q.mode = QueryDesignerModeResults
		if msg.Error != nil {
			q.error = msg.Error.Error()
		} else {
			q.queryResult = msg.Result
			q.generatedSQL = msg.SQL
			q.error = ""
			q.resultView.SetContent(q.formatResults())
		}
		return q, nil
	}

	// Update sub-components based on mode
	switch q.mode {
	case QueryDesignerModeTable:
		var cmd tea.Cmd
		q.tableList, cmd = q.tableList.Update(msg)
		cmds = append(cmds, cmd)

	case QueryDesignerModeColumns:
		var cmd tea.Cmd
		q.columnList, cmd = q.columnList.Update(msg)
		cmds = append(cmds, cmd)

	case QueryDesignerModeConditions:
		var cmd tea.Cmd
		q.condColumn, cmd = q.condColumn.Update(msg)
		cmds = append(cmds, cmd)
		q.condValue, cmd = q.condValue.Update(msg)
		cmds = append(cmds, cmd)

	case QueryDesignerModeResults:
		var cmd tea.Cmd
		q.resultView, cmd = q.resultView.Update(msg)
		cmds = append(cmds, cmd)
	}

	return q, tea.Batch(cmds...)
}

func (q *QueryDesigner) toggleColumn(name string) {
	// Check if already selected
	for i, col := range q.selectedColumns {
		if col.Name == name {
			// Remove it
			q.selectedColumns = append(q.selectedColumns[:i], q.selectedColumns[i+1:]...)
			return
		}
	}
	// Add it
	q.selectedColumns = append(q.selectedColumns, query.Column{Name: name})
}

func (q *QueryDesigner) buildQuery() (string, error) {
	if q.selectedTable == "" {
		return "", fmt.Errorf("no table selected")
	}

	qb := query.NewQueryBuilder()
	qb.Table(q.selectedSchema, q.selectedTable)

	if len(q.selectedColumns) == 0 {
		qb.SelectAll()
	} else {
		qb.Select(q.selectedColumns...)
	}

	for _, cond := range q.conditions {
		qb.Where(cond)
	}

	for _, ob := range q.orderBy {
		qb.OrderBy(ob)
	}

	qb.Limit(q.limit)
	qb.Offset(q.offset)
	qb.Distinct(q.distinct)

	sql, _, err := qb.Build()
	return sql, err
}

func (q *QueryDesigner) executeQuery() tea.Cmd {
	return func() tea.Msg {
		sql, err := q.buildQuery()
		if err != nil {
			return QueryDesignerExecuteMsg{Error: err}
		}

		executor := llm.NewQueryExecutor(
			llm.WithMaxRows(q.limit),
			llm.WithTimeout(30*time.Second),
			llm.WithReadOnly(true),
		)

		ctx := context.Background()
		result, err := executor.Execute(ctx, q.serviceName, sql)
		if err != nil {
			return QueryDesignerExecuteMsg{Error: err, SQL: sql}
		}

		return QueryDesignerExecuteMsg{Result: result, SQL: sql}
	}
}

func (q *QueryDesigner) formatResults() string {
	if q.queryResult == nil {
		return "No results"
	}

	var sb strings.Builder

	// SQL
	sb.WriteString("SQL:\n")
	sb.WriteString(q.generatedSQL)
	sb.WriteString("\n\n")

	// Summary
	sb.WriteString(fmt.Sprintf("Rows: %d | Duration: %.2fms\n\n", q.queryResult.RowCount, q.queryResult.Duration))

	// Column headers
	if len(q.queryResult.Columns) > 0 {
		var headers []string
		for _, col := range q.queryResult.Columns {
			headers = append(headers, col.Name)
		}
		sb.WriteString(strings.Join(headers, " | "))
		sb.WriteString("\n")
		sb.WriteString(strings.Repeat("-", 80))
		sb.WriteString("\n")
	}

	// Data rows
	for _, row := range q.queryResult.Rows {
		var values []string
		for _, col := range q.queryResult.Columns {
			val := fmt.Sprintf("%v", row[col.Name])
			if len(val) > 30 {
				val = val[:27] + "..."
			}
			values = append(values, val)
		}
		sb.WriteString(strings.Join(values, " | "))
		sb.WriteString("\n")
	}

	return sb.String()
}

// View renders the component
func (q *QueryDesigner) View() string {
	if q.cancelled {
		return ""
	}

	titleStyle := lipgloss.NewStyle().
		Bold(true).
		Foreground(lipgloss.Color("205")).
		MarginBottom(1)

	activeTabStyle := lipgloss.NewStyle().
		Bold(true).
		Background(lipgloss.Color("205")).
		Foreground(lipgloss.Color("0")).
		Padding(0, 2)

	inactiveTabStyle := lipgloss.NewStyle().
		Foreground(lipgloss.Color("240")).
		Padding(0, 2)

	errorStyle := lipgloss.NewStyle().
		Foreground(lipgloss.Color("196"))

	selectedStyle := lipgloss.NewStyle().
		Foreground(lipgloss.Color("82"))

	// Build tabs
	tabs := []string{"Table", "Columns", "Conditions", "Order By", "SQL"}
	var tabViews []string
	for i, tab := range tabs {
		if QueryDesignerMode(i) == q.mode {
			tabViews = append(tabViews, activeTabStyle.Render(tab))
		} else {
			tabViews = append(tabViews, inactiveTabStyle.Render(tab))
		}
	}

	var sb strings.Builder

	sb.WriteString(titleStyle.Render("Visual Query Designer"))
	sb.WriteString("\n")
	sb.WriteString(strings.Join(tabViews, " "))
	sb.WriteString("\n\n")

	// Show error if any
	if q.error != "" {
		sb.WriteString(errorStyle.Render("Error: " + q.error))
		sb.WriteString("\n\n")
	}

	// Content based on mode
	switch q.mode {
	case QueryDesignerModeTable:
		sb.WriteString(fmt.Sprintf("Service: %s | Schema: %s\n\n", q.serviceName, q.selectedSchema))
		sb.WriteString(q.tableList.View())

	case QueryDesignerModeColumns:
		sb.WriteString(fmt.Sprintf("Table: %s.%s\n", q.selectedSchema, q.selectedTable))
		sb.WriteString("Selected: ")
		if len(q.selectedColumns) == 0 {
			sb.WriteString("* (all)")
		} else {
			var names []string
			for _, col := range q.selectedColumns {
				names = append(names, col.Name)
			}
			sb.WriteString(selectedStyle.Render(strings.Join(names, ", ")))
		}
		sb.WriteString("\n\n")
		sb.WriteString("Press ENTER to toggle, * for all\n\n")
		sb.WriteString(q.columnList.View())

	case QueryDesignerModeConditions:
		sb.WriteString("WHERE Conditions:\n\n")
		if len(q.conditions) == 0 {
			sb.WriteString("No conditions (press + to add)\n")
		} else {
			for i, cond := range q.conditions {
				sb.WriteString(fmt.Sprintf("%d. %s %s %v\n", i+1, cond.Column, cond.Operator, cond.Value))
			}
		}
		sb.WriteString("\nColumn: ")
		sb.WriteString(q.condColumn.View())
		sb.WriteString(" Operator: ")
		sb.WriteString(q.condOperator)
		sb.WriteString(" Value: ")
		sb.WriteString(q.condValue.View())

	case QueryDesignerModeOrderBy:
		sb.WriteString("ORDER BY:\n\n")
		if len(q.orderBy) == 0 {
			sb.WriteString("No ordering specified\n")
		} else {
			for i, ob := range q.orderBy {
				sb.WriteString(fmt.Sprintf("%d. %s %s\n", i+1, ob.Column, ob.Direction))
			}
		}
		sb.WriteString(fmt.Sprintf("\nLIMIT: %d | DISTINCT: %v\n", q.limit, q.distinct))

	case QueryDesignerModeSQL:
		sql, err := q.buildQuery()
		if err != nil {
			sb.WriteString(errorStyle.Render("Error building query: " + err.Error()))
		} else {
			sb.WriteString("Generated SQL:\n\n")
			sb.WriteString(sql)
			sb.WriteString("\n\nPress ENTER or Ctrl+E to execute")
		}

	case QueryDesignerModeResults:
		sb.WriteString(q.resultView.View())
	}

	// Help
	sb.WriteString("\n\n")
	if q.showHelp {
		sb.WriteString("TAB: Next section | SHIFT+TAB: Previous | ENTER: Select/Execute | ESC: Close | ?: Toggle help")
	} else {
		sb.WriteString("Press ? for help")
	}

	return sb.String()
}

// IsCancelled returns true if the user cancelled
func (q *QueryDesigner) IsCancelled() bool {
	return q.cancelled
}

// GetSQL returns the generated SQL
func (q *QueryDesigner) GetSQL() string {
	sql, _ := q.buildQuery()
	return sql
}

// GetResult returns the query result
func (q *QueryDesigner) GetResult() *llm.QueryResult {
	return q.queryResult
}
