// Utility functions for QueryPanel

import type { Column, Condition, OrderBy } from './types'

/** Quote a PostgreSQL identifier ("my-table", "Name"), doubling any quote inside it. */
export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`
}

/** Quote a string literal, doubling any single quote inside it. */
export function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

/**
 * Build SQL query from visual builder components.
 *
 * Identifiers are quoted (so mixed-case or dashed names work) and values are
 * escaped; columns, conditions and orderings that aren't filled in yet are left out.
 */
export function buildSQL(
  selectedSchema: string,
  selectedTable: string,
  selectedColumns: Column[],
  conditions: Condition[],
  orderBy: OrderBy[],
  limit: number,
  offset: number,
  distinct: boolean
): string {
  if (!selectedTable) return ''

  const columns = selectedColumns.filter(c => c.name)
  const cols = columns.length > 0
    ? columns.map(c => {
        const expr = c.aggregate ? `${c.aggregate}(${quoteIdent(c.name)})` : quoteIdent(c.name)
        return c.alias ? `${expr} AS ${quoteIdent(c.alias)}` : expr
      }).join(', ')
    : '*'

  let sql = `SELECT ${distinct ? 'DISTINCT ' : ''}${cols}\nFROM ${quoteIdent(selectedSchema)}.${quoteIdent(selectedTable)}`

  const filled = conditions.filter(c =>
    c.column && (['IS NULL', 'IS NOT NULL'].includes(c.operator) || c.value.trim() !== ''))
  if (filled.length > 0) {
    const whereClause = filled.map((c, i) => {
      const column = quoteIdent(c.column)
      let clause = i > 0 ? ` ${c.logic} ` : ''
      if (['IS NULL', 'IS NOT NULL'].includes(c.operator)) {
        clause += `${column} ${c.operator}`
      } else if (c.operator === 'IN') {
        const items = c.value.split(',').map(v => v.trim()).filter(Boolean)
        clause += `${column} IN (${items.map(quoteLiteral).join(', ')})`
      } else if (['LIKE', 'ILIKE'].includes(c.operator)) {
        clause += `${column}::text ${c.operator} ${quoteLiteral(`%${c.value}%`)}`
      } else {
        clause += `${column} ${c.operator} ${quoteLiteral(c.value)}`
      }
      return clause
    }).join('')
    sql += `\nWHERE ${whereClause}`
  }

  // Group by if aggregates are used
  const hasAggregates = columns.some(c => c.aggregate)
  const nonAggColumns = columns.filter(c => !c.aggregate)
  if (hasAggregates && nonAggColumns.length > 0) {
    sql += `\nGROUP BY ${nonAggColumns.map(c => quoteIdent(c.name)).join(', ')}`
  }

  const orderings = orderBy.filter(o => o.column)
  if (orderings.length > 0) {
    sql += `\nORDER BY ${orderings.map(o => `${quoteIdent(o.column)} ${o.direction}`).join(', ')}`
  }

  sql += `\nLIMIT ${limit}`
  if (offset > 0) {
    sql += ` OFFSET ${offset}`
  }

  return sql
}

/**
 * Export query results to CSV format
 */
export function exportToCSV(columns: string[], rows: Record<string, unknown>[]): string {
  const headers = columns.join(',')
  const rowsData = rows.map(row =>
    columns.map(col => {
      const val = row[col]
      if (val === null) return ''
      if (typeof val === 'string' && val.includes(',')) return `"${val}"`
      return String(val)
    }).join(',')
  ).join('\n')
  return `${headers}\n${rowsData}`
}

/**
 * Export query results to JSON format
 */
export function exportToJSON(rows: Record<string, unknown>[]): string {
  return JSON.stringify(rows, null, 2)
}

/**
 * Modify SQL query to add or update OFFSET clause
 */
export function modifySQLWithOffset(sql: string, limit: number, currentOffset: number): string {
  const trimmed = sql.trim().replace(/;+\s*$/, '')
  const pattern = /\bLIMIT\s+\d+(\s+OFFSET\s+\d+)?\s*$/i
  return pattern.test(trimmed)
    ? trimmed.replace(pattern, `LIMIT ${limit} OFFSET ${currentOffset}`)
    : `${trimmed}\nLIMIT ${limit} OFFSET ${currentOffset}`
}
