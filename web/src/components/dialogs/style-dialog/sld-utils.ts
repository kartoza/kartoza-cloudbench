import type { StyleRule } from './types'

// Parse SLD to extract style rules for visual editing
export function parseSLDRules(sldContent: string): StyleRule[] {
  const rules: StyleRule[] = []

  try {
    const parser = new DOMParser()
    const doc = parser.parseFromString(sldContent, 'text/xml')
    const ruleElements = doc.querySelectorAll('Rule')

    ruleElements.forEach((ruleEl, index) => {
      const nameEl = ruleEl.querySelector('Name')
      const rule: StyleRule = {
        name: nameEl?.textContent || `Rule ${index + 1}`,
        symbolizer: { type: 'polygon' }
      }

      // Parse PolygonSymbolizer
      const polySymb = ruleEl.querySelector('PolygonSymbolizer')
      if (polySymb) {
        rule.symbolizer.type = 'polygon'
        const fillParams = polySymb.querySelectorAll('Fill CssParameter')
        fillParams.forEach(param => {
          const name = param.getAttribute('name')
          if (name === 'fill') rule.symbolizer.fill = param.textContent || '#3388ff'
          if (name === 'fill-opacity') rule.symbolizer.fillOpacity = parseFloat(param.textContent || '1')
        })
        const strokeParams = polySymb.querySelectorAll('Stroke CssParameter')
        strokeParams.forEach(param => {
          const name = param.getAttribute('name')
          if (name === 'stroke') rule.symbolizer.stroke = param.textContent || '#2266cc'
          if (name === 'stroke-width') rule.symbolizer.strokeWidth = parseFloat(param.textContent || '1')
          if (name === 'stroke-opacity') rule.symbolizer.strokeOpacity = parseFloat(param.textContent || '1')
        })
      }

      // Parse LineSymbolizer
      const lineSymb = ruleEl.querySelector('LineSymbolizer')
      if (lineSymb) {
        rule.symbolizer.type = 'line'
        const strokeParams = lineSymb.querySelectorAll('Stroke CssParameter')
        strokeParams.forEach(param => {
          const name = param.getAttribute('name')
          if (name === 'stroke') rule.symbolizer.stroke = param.textContent || '#3388ff'
          if (name === 'stroke-width') rule.symbolizer.strokeWidth = parseFloat(param.textContent || '2')
          if (name === 'stroke-opacity') rule.symbolizer.strokeOpacity = parseFloat(param.textContent || '1')
        })
      }

      // Parse PointSymbolizer
      const pointSymb = ruleEl.querySelector('PointSymbolizer')
      if (pointSymb) {
        rule.symbolizer.type = 'point'
        rule.symbolizer.pointShape = 'circle'
        rule.symbolizer.pointSize = 8

        const fillParams = pointSymb.querySelectorAll('Fill CssParameter')
        fillParams.forEach(param => {
          const name = param.getAttribute('name')
          if (name === 'fill') rule.symbolizer.fill = param.textContent || '#3388ff'
          if (name === 'fill-opacity') rule.symbolizer.fillOpacity = parseFloat(param.textContent || '1')
        })
        const strokeParams = pointSymb.querySelectorAll('Stroke CssParameter')
        strokeParams.forEach(param => {
          const name = param.getAttribute('name')
          if (name === 'stroke') rule.symbolizer.stroke = param.textContent || '#2266cc'
          if (name === 'stroke-width') rule.symbolizer.strokeWidth = parseFloat(param.textContent || '1')
        })
        const sizeEl = pointSymb.querySelector('Size')
        if (sizeEl) rule.symbolizer.pointSize = parseFloat(sizeEl.textContent || '8')
      }

      rules.push(rule)
    })
  } catch (e) {
    console.error('Failed to parse SLD:', e)
  }

  return rules.length > 0 ? rules : [{
    name: 'Default',
    symbolizer: {
      type: 'polygon',
      fill: '#3388ff',
      fillOpacity: 0.6,
      stroke: '#2266cc',
      strokeWidth: 1,
    }
  }]
}

// Generate SLD from style rules
export function generateSLD(styleName: string, rules: StyleRule[]): string {
  let rulesXml = ''

  rules.forEach(rule => {
    let symbolizerXml = ''

    if (rule.symbolizer.type === 'polygon') {
      symbolizerXml = `
          <PolygonSymbolizer>
            <Fill>
              <CssParameter name="fill">${rule.symbolizer.fill || '#3388ff'}</CssParameter>
              <CssParameter name="fill-opacity">${rule.symbolizer.fillOpacity ?? 0.6}</CssParameter>
            </Fill>
            <Stroke>
              <CssParameter name="stroke">${rule.symbolizer.stroke || '#2266cc'}</CssParameter>
              <CssParameter name="stroke-width">${rule.symbolizer.strokeWidth || 1}</CssParameter>
            </Stroke>
          </PolygonSymbolizer>`
    } else if (rule.symbolizer.type === 'line') {
      symbolizerXml = `
          <LineSymbolizer>
            <Stroke>
              <CssParameter name="stroke">${rule.symbolizer.stroke || '#3388ff'}</CssParameter>
              <CssParameter name="stroke-width">${rule.symbolizer.strokeWidth || 2}</CssParameter>
              <CssParameter name="stroke-opacity">${rule.symbolizer.strokeOpacity ?? 1}</CssParameter>
            </Stroke>
          </LineSymbolizer>`
    } else if (rule.symbolizer.type === 'point') {
      // Build optional rotation element
      const rotationXml = rule.symbolizer.rotation
        ? `\n              <Rotation>${rule.symbolizer.rotation}</Rotation>`
        : ''

      // Build the main point symbolizer
      const mainSymbolizer = `
          <PointSymbolizer>
            <Graphic>
              <Mark>
                <WellKnownName>${rule.symbolizer.pointShape || 'circle'}</WellKnownName>
                <Fill>
                  <CssParameter name="fill">${rule.symbolizer.fill || '#3388ff'}</CssParameter>
                  <CssParameter name="fill-opacity">${rule.symbolizer.fillOpacity ?? 1}</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">${rule.symbolizer.stroke || '#2266cc'}</CssParameter>
                  <CssParameter name="stroke-width">${rule.symbolizer.strokeWidth || 1}</CssParameter>
                </Stroke>
              </Mark>
              <Size>${rule.symbolizer.pointSize || 8}</Size>${rotationXml}
            </Graphic>
          </PointSymbolizer>`

      // Add halo effect as an additional symbolizer behind the main one
      if (rule.symbolizer.haloColor && rule.symbolizer.haloRadius) {
        const haloSize = (rule.symbolizer.pointSize || 8) + (rule.symbolizer.haloRadius * 2)
        const haloSymbolizer = `
          <PointSymbolizer>
            <Graphic>
              <Mark>
                <WellKnownName>${rule.symbolizer.pointShape || 'circle'}</WellKnownName>
                <Fill>
                  <CssParameter name="fill">${rule.symbolizer.haloColor}</CssParameter>
                  <CssParameter name="fill-opacity">0.4</CssParameter>
                </Fill>
              </Mark>
              <Size>${haloSize}</Size>${rotationXml}
            </Graphic>
          </PointSymbolizer>`
        symbolizerXml = haloSymbolizer + mainSymbolizer
      } else {
        symbolizerXml = mainSymbolizer
      }
    }

    rulesXml += `
        <Rule>
          <Name>${rule.name}</Name>${symbolizerXml}
        </Rule>`
  })

  return `<?xml version="1.0" encoding="UTF-8"?>
<StyledLayerDescriptor version="1.0.0"
  xsi:schemaLocation="http://www.opengis.net/sld StyledLayerDescriptor.xsd"
  xmlns="http://www.opengis.net/sld"
  xmlns:ogc="http://www.opengis.net/ogc"
  xmlns:xlink="http://www.w3.org/1999/xlink"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <NamedLayer>
    <Name>${styleName}</Name>
    <UserStyle>
      <Title>${styleName}</Title>
      <FeatureTypeStyle>${rulesXml}
      </FeatureTypeStyle>
    </UserStyle>
  </NamedLayer>
</StyledLayerDescriptor>`
}
