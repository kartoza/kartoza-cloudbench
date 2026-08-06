type GeoServerEntry = { '@key': string; '$': string }
type GeoServerConnectionParameters = { entry: GeoServerEntry[] }

export function entriesToObject(params: GeoServerConnectionParameters): Record<string, string> {
  return params.entry.reduce<Record<string, string>>((acc, entry) => {
    acc[entry['@key']] = entry['$']
    return acc
  }, {})
}

export function objectToEntries(obj: Record<string, string>): GeoServerConnectionParameters {
  return {
    entry: Object.entries(obj).map(([key, value]) => ({
      '@key': key,
      '$': value,
    })),
  }
}