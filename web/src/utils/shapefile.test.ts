import { describe, it, expect } from 'vitest'
import { checkShapefileParts } from './shapefile'

const files = (...names: string[]) => names.map((name) => new File([''], name))

describe('checkShapefileParts', () => {
  it('accepts a complete shapefile', () => {
    const check = checkShapefileParts(files('roads.shp', 'roads.shx', 'roads.dbf', 'roads.prj', 'roads.cpg'))
    expect(check.problems).toEqual([])
    expect(check.missing).toEqual([])
  })

  it('names the parts that are missing', () => {
    const check = checkShapefileParts(files('roads.shp', 'roads.prj'))
    expect(check.missing).toEqual(['.shx', '.dbf'])
    expect(check.problems[0]).toMatch(/Missing \.shx, \.dbf/)
  })

  it('never needs the .prj, but says what happens without it', () => {
    const parts = files('roads.shp', 'roads.shx', 'roads.dbf')
    const converting = checkShapefileParts(parts)
    expect(converting.problems).toEqual([])
    expect(converting.missing).toEqual([])
    expect(converting.warnings[0]).toMatch(/taken to be WGS84/)
    expect(checkShapefileParts(parts, false).warnings[0]).toMatch(/have to know its coordinate system/)
  })

  it('catches parts of another shapefile, strangers and duplicates, case-insensitively', () => {
    const check = checkShapefileParts(
      files('Roads.SHP', 'roads.shx', 'roads.dbf', 'roads.prj', 'rivers.dbf', 'notes.txt', 'ROADS.shx')
    )
    expect(check.problems).toEqual([
      'Not part of roads: rivers.dbf, notes.txt.',
      'More than one .shx, .dbf file.',
    ])
  })

  it('without the .shp, says so', () => {
    expect(checkShapefileParts(files('roads.shx', 'roads.dbf', 'roads.prj')).missing).toEqual(['.shp'])
  })
})
