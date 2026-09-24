/**
 * Kartoza CloudBench API Client
 *
 * This module has been refactored for maintainability:
 * - common.ts - Shared utilities and base configuration
 * - connection.ts - GeoServer connection API
 * - workspace.ts - Workspace API
 * - stores.ts - DataStore and CoverageStore API
 * - layer.ts - Layer, FeatureType, Coverage API
 * - style.ts - Style API
 * - layergroup.ts - Layer Group API
 * - s3.ts - S3 Storage API
 * - iceberg.ts - Apache Iceberg API
 *
 * The main client.ts remains for backward compatibility and includes
 * additional APIs (GWC, Sync, Dashboard, Search, PostgreSQL, QGIS, GeoNode)
 */

// Re-export everything from modular files
export * from './common'
export * from './chunkedUpload'
export * from './connection'
export * from './workspace'
export * from './stores'
export * from './layer'
export * from './style'
export * from './layergroup'
export * from './s3'
export * from './iceberg'
export * from './mapExplorer'

// Re-export everything from the main client file for backward compatibility
// This includes APIs that haven't been split yet: GWC, Sync, Dashboard, Search, PostgreSQL, QGIS, GeoNode
export * from './client'
