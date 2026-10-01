// Checks a set of loose shapefile components before uploading them, with the
// same rules the server applies (apps.s3.pmtiles.prepare_shapefile) - which
// it can only apply once every byte has arrived, gigabytes later for a big
// shapefile.

export const REQUIRED_PARTS = ['.shp', '.shx', '.dbf'] as const
const ALLOWED_PARTS = new Set(['.shp', '.shx', '.dbf', '.prj', '.cpg', '.qix', '.sbn', '.sbx'])

// The file-name extensions of a shapefile's components.
export const SHAPEFILE_PART = /\.(shp|shx|dbf|prj|cpg|qix|sbn|sbx)$/i

export interface ShapefileCheck {
  // Required parts (".shx", ".dbf", ...) not among the files.
  missing: string[]
  // Why the upload can't go ahead as it is (empty when it can).
  problems: string[]
  // Worth knowing, but the upload can go ahead.
  warnings: string[]
}

function suffixOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot).toLowerCase() : ''
}

function stemOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return (dot >= 0 ? name.slice(0, dot) : name).toLowerCase()
}

// `converting`: a conversion assumes WGS84 for a shapefile without its .prj
// (CloudNativeGIS does), which is worth saying before it happens.
export function checkShapefileParts(files: File[], converting = true): ShapefileCheck {
  const main = files.find((file) => suffixOf(file.name) === '.shp')
  const stem = main ? stemOf(main.name) : stemOf(files[0]?.name ?? '')
  const seen = new Map<string, number>()
  const strangers: string[] = []
  for (const file of files) {
    const suffix = suffixOf(file.name)
    if (!ALLOWED_PARTS.has(suffix) || stemOf(file.name) !== stem) strangers.push(file.name)
    seen.set(suffix, (seen.get(suffix) ?? 0) + 1)
  }

  const missing = REQUIRED_PARTS.filter((part) => !seen.has(part))
  const problems: string[] = []
  if (missing.length) {
    problems.push(`Missing ${missing.join(', ')}: a shapefile needs its .shp, .shx and .dbf together.`)
  }
  if (strangers.length) {
    problems.push(`Not part of ${stem || 'this shapefile'}: ${strangers.join(', ')}.`)
  }
  const duplicates = [...seen].filter(([, count]) => count > 1).map(([suffix]) => suffix)
  if (duplicates.length) problems.push(`More than one ${duplicates.join(', ')} file.`)

  const warnings = seen.has('.prj')
    ? []
    : [
        converting
          ? 'No .prj: its coordinate system will be taken to be WGS84 (EPSG:4326).'
          : 'No .prj: anyone using this shapefile will have to know its coordinate system.',
      ]
  return { missing, problems, warnings }
}
