import { describe, expect, it } from 'vitest'
import { buildSQL, modifySQLWithOffset } from './utils'

describe('buildSQL', () => {
  it('quotes identifiers so dashed and mixed-case names work', () => {
    expect(buildSQL('public', 'boundary-lines', [{ name: 'Name' }], [], [], 100, 0, false)).toBe(
      'SELECT "Name"\nFROM "public"."boundary-lines"\nLIMIT 100',
    )
  })

  it('leaves out columns, conditions and orderings not filled in yet', () => {
    const sql = buildSQL(
      'public',
      't',
      [{ name: '' }],
      [{ column: '', operator: '=', value: 'x', logic: 'AND' }, { column: 'a', operator: '=', value: '', logic: 'AND' }],
      [{ column: '', direction: 'ASC' }],
      10,
      0,
      false,
    )
    expect(sql).toBe('SELECT *\nFROM "public"."t"\nLIMIT 10')
  })

  it('escapes values', () => {
    const sql = buildSQL(
      's',
      't',
      [],
      [
        { column: 'name', operator: '=', value: "O'Neil", logic: 'AND' },
        { column: 'kind', operator: 'IN', value: 'a, b', logic: 'OR' },
        { column: 'note', operator: 'ILIKE', value: 'park', logic: 'AND' },
        { column: 'geom', operator: 'IS NULL', value: '', logic: 'AND' },
      ],
      [],
      5,
      0,
      false,
    )
    expect(sql).toContain(
      `WHERE "name" = 'O''Neil' OR "kind" IN ('a', 'b') AND "note"::text ILIKE '%park%' AND "geom" IS NULL`,
    )
  })

  it('groups by the columns that are not aggregated', () => {
    const sql = buildSQL(
      's',
      't',
      [{ name: 'kind' }, { name: 'id', aggregate: 'COUNT', alias: 'n' }],
      [],
      [{ column: 'kind', direction: 'DESC' }],
      5,
      0,
      true,
    )
    expect(sql).toBe(
      'SELECT DISTINCT "kind", COUNT("id") AS "n"\nFROM "s"."t"\nGROUP BY "kind"\nORDER BY "kind" DESC\nLIMIT 5',
    )
  })
})

describe('modifySQLWithOffset', () => {
  it('replaces a trailing LIMIT/OFFSET', () => {
    expect(modifySQLWithOffset('SELECT 1\nLIMIT 100 OFFSET 0;', 100, 200)).toBe('SELECT 1\nLIMIT 100 OFFSET 200')
  })

  it('adds one when there is none, after a trailing semicolon', () => {
    expect(modifySQLWithOffset('SELECT speed_limit FROM t;', 50, 50)).toBe(
      'SELECT speed_limit FROM t\nLIMIT 50 OFFSET 50',
    )
  })
})
