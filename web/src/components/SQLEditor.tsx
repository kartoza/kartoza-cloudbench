import React, { useMemo, useEffect, useState } from 'react';
import { getApiBase } from '../config/env';
import CodeMirror from '@uiw/react-codemirror';
import { sql, PostgreSQL } from '@codemirror/lang-sql';
import { autocompletion, CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import { EditorView } from '@codemirror/view';

// Schema information for autocompletion
interface ColumnInfo {
  name: string;
  type: string;
  nullable?: boolean;
}

interface TableInfo {
  name: string;
  columns: ColumnInfo[];
  schema?: string;
}

interface SchemaInfo {
  name: string;
  tables: TableInfo[];
}

type SQLDialect = 'postgresql' | 'duckdb';

interface SQLEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  height?: string;
  minHeight?: string;
  maxHeight?: string;
  schemas?: SchemaInfo[];
  serviceName?: string;
  readOnly?: boolean;
  className?: string;
  dialect?: SQLDialect;
}

// PostgreSQL keywords for completion
const PG_KEYWORDS = [
  'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'IN', 'BETWEEN', 'LIKE', 'ILIKE',
  'IS', 'NULL', 'TRUE', 'FALSE', 'AS', 'ON', 'JOIN', 'LEFT', 'RIGHT', 'INNER',
  'OUTER', 'FULL', 'CROSS', 'NATURAL', 'USING', 'GROUP', 'BY', 'HAVING', 'ORDER',
  'ASC', 'DESC', 'NULLS', 'FIRST', 'LAST', 'LIMIT', 'OFFSET', 'DISTINCT', 'ALL',
  'UNION', 'INTERSECT', 'EXCEPT', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'CAST',
  'COALESCE', 'NULLIF', 'EXISTS', 'ANY', 'SOME', 'WITH', 'RECURSIVE', 'OVER',
  'PARTITION', 'WINDOW', 'ROWS', 'RANGE', 'UNBOUNDED', 'PRECEDING', 'FOLLOWING',
  'CURRENT', 'ROW', 'FILTER', 'WITHIN', 'LATERAL', 'FETCH', 'NEXT', 'ONLY',
];

// PostgreSQL functions
const PG_FUNCTIONS = [
  // Aggregate functions
  'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'ARRAY_AGG', 'STRING_AGG', 'BOOL_AND',
  'BOOL_OR', 'BIT_AND', 'BIT_OR', 'EVERY', 'PERCENTILE_CONT', 'PERCENTILE_DISC',
  // String functions
  'LENGTH', 'LOWER', 'UPPER', 'TRIM', 'LTRIM', 'RTRIM', 'SUBSTRING', 'POSITION',
  'REPLACE', 'CONCAT', 'CONCAT_WS', 'SPLIT_PART', 'REGEXP_REPLACE', 'REGEXP_MATCHES',
  'LEFT', 'RIGHT', 'REVERSE', 'REPEAT', 'LPAD', 'RPAD', 'INITCAP', 'FORMAT',
  // Numeric functions
  'ABS', 'CEIL', 'CEILING', 'FLOOR', 'ROUND', 'TRUNC', 'MOD', 'POWER', 'SQRT',
  'EXP', 'LN', 'LOG', 'RANDOM', 'SIGN', 'GREATEST', 'LEAST',
  // Date/time functions
  'NOW', 'CURRENT_DATE', 'CURRENT_TIME', 'CURRENT_TIMESTAMP', 'DATE_PART',
  'DATE_TRUNC', 'EXTRACT', 'AGE', 'INTERVAL', 'TO_CHAR', 'TO_DATE', 'TO_TIMESTAMP',
  // JSON functions
  'JSON_AGG', 'JSONB_AGG', 'JSON_BUILD_OBJECT', 'JSONB_BUILD_OBJECT',
  'JSON_OBJECT_AGG', 'JSONB_OBJECT_AGG', 'ROW_TO_JSON', 'JSON_ARRAY_LENGTH',
  // Array functions
  'ARRAY_LENGTH', 'ARRAY_TO_STRING', 'STRING_TO_ARRAY', 'UNNEST', 'ARRAY_CAT',
  // Type conversion
  'CAST', 'TO_NUMBER', 'TO_TEXT',
];

// PostGIS functions
const POSTGIS_FUNCTIONS = [
  // Geometry constructors
  'ST_Point', 'ST_MakePoint', 'ST_MakeLine', 'ST_MakePolygon', 'ST_MakeEnvelope',
  'ST_GeomFromText', 'ST_GeomFromWKB', 'ST_GeomFromGeoJSON', 'ST_GeogFromText',
  'ST_SetSRID', 'ST_Transform', 'ST_Collect', 'ST_Union', 'ST_Buffer',
  // Geometry accessors
  'ST_X', 'ST_Y', 'ST_Z', 'ST_M', 'ST_SRID', 'ST_GeometryType', 'ST_Dimension',
  'ST_CoordDim', 'ST_NPoints', 'ST_NRings', 'ST_NumGeometries', 'ST_NumPoints',
  'ST_ExteriorRing', 'ST_InteriorRingN', 'ST_GeometryN', 'ST_PointN', 'ST_StartPoint',
  'ST_EndPoint', 'ST_Centroid', 'ST_PointOnSurface', 'ST_Envelope', 'ST_Boundary',
  // Geometry outputs
  'ST_AsText', 'ST_AsBinary', 'ST_AsGeoJSON', 'ST_AsKML', 'ST_AsSVG', 'ST_AsGML',
  'ST_AsEWKT', 'ST_AsEWKB', 'ST_AsMVT', 'ST_AsMVTGeom',
  // Spatial relationships
  'ST_Intersects', 'ST_Contains', 'ST_Within', 'ST_Overlaps', 'ST_Touches',
  'ST_Crosses', 'ST_Disjoint', 'ST_Equals', 'ST_Covers', 'ST_CoveredBy',
  'ST_ContainsProperly', 'ST_DWithin', 'ST_Distance', 'ST_3DDistance',
  // Spatial measurements
  'ST_Area', 'ST_Perimeter', 'ST_Length', 'ST_Length2D', 'ST_3DLength',
  'ST_Distance', 'ST_MaxDistance', 'ST_HausdorffDistance', 'ST_FrechetDistance',
  // Geometry processing
  'ST_Simplify', 'ST_SimplifyPreserveTopology', 'ST_SimplifyVW', 'ST_ChaikinSmoothing',
  'ST_ConvexHull', 'ST_ConcaveHull', 'ST_Buffer', 'ST_OffsetCurve', 'ST_Difference',
  'ST_Intersection', 'ST_SymDifference', 'ST_Split', 'ST_Subdivide', 'ST_MakeValid',
  'ST_Snap', 'ST_SnapToGrid', 'ST_Segmentize', 'ST_LineMerge', 'ST_UnaryUnion',
  // Clustering
  'ST_ClusterDBSCAN', 'ST_ClusterKMeans', 'ST_ClusterWithin', 'ST_ClusterIntersecting',
  // Aggregates
  'ST_Extent', 'ST_3DExtent', 'ST_MemUnion', 'ST_Collect', 'ST_MakeLine',
  // Bounding box
  'ST_MakeBox2D', 'ST_XMin', 'ST_XMax', 'ST_YMin', 'ST_YMax', 'ST_ZMin', 'ST_ZMax',
  'ST_Expand', 'ST_EstimatedExtent', 'Box2D', 'Box3D',
  // Linear referencing
  'ST_LineInterpolatePoint', 'ST_LineInterpolatePoints', 'ST_LineLocatePoint',
  'ST_LineSubstring', 'ST_LocateAlong', 'ST_LocateBetween', 'ST_AddMeasure',
  // Miscellaneous
  'ST_IsValid', 'ST_IsSimple', 'ST_IsEmpty', 'ST_IsClosed', 'ST_IsRing',
  'ST_IsCollection', 'ST_HasArc', 'ST_NumPatches', 'ST_Force2D', 'ST_Force3D',
  'ST_ForceRHR', 'ST_Reverse', 'ST_FlipCoordinates', 'ST_OrientedEnvelope',
];

// DuckDB-specific functions
const DUCKDB_FUNCTIONS = [
  // Aggregate functions
  'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'FIRST', 'LAST', 'LIST', 'STRING_AGG',
  'ARG_MIN', 'ARG_MAX', 'BIT_AND', 'BIT_OR', 'BIT_XOR', 'BOOL_AND', 'BOOL_OR',
  'APPROX_COUNT_DISTINCT', 'APPROX_QUANTILE', 'RESERVOIR_SAMPLE', 'HISTOGRAM',
  'MODE', 'ENTROPY', 'KURTOSIS', 'SKEWNESS', 'STDDEV', 'STDDEV_POP', 'STDDEV_SAMP',
  'VARIANCE', 'VAR_POP', 'VAR_SAMP', 'COVAR_POP', 'COVAR_SAMP', 'CORR', 'REGR_SLOPE',
  // String functions
  'LENGTH', 'LOWER', 'UPPER', 'TRIM', 'LTRIM', 'RTRIM', 'SUBSTRING', 'REPLACE',
  'CONCAT', 'CONCAT_WS', 'SPLIT_PART', 'REGEXP_REPLACE', 'REGEXP_MATCHES',
  'REGEXP_EXTRACT', 'REGEXP_EXTRACT_ALL', 'LEFT', 'RIGHT', 'REVERSE', 'REPEAT',
  'LPAD', 'RPAD', 'INSTR', 'POSITION', 'CONTAINS', 'STARTS_WITH', 'ENDS_WITH',
  'STRIP_ACCENTS', 'LEVENSHTEIN', 'JACCARD', 'JARO_WINKLER_SIMILARITY',
  'PRINTF', 'FORMAT', 'ASCII', 'CHR', 'MD5', 'SHA256', 'HASH', 'BASE64', 'ENCODE', 'DECODE',
  // Numeric functions
  'ABS', 'CEIL', 'CEILING', 'FLOOR', 'ROUND', 'TRUNC', 'MOD', 'POWER', 'POW', 'SQRT',
  'EXP', 'LN', 'LOG', 'LOG2', 'LOG10', 'RANDOM', 'SETSEED', 'SIGN', 'GREATEST', 'LEAST',
  'RADIANS', 'DEGREES', 'SIN', 'COS', 'TAN', 'ASIN', 'ACOS', 'ATAN', 'ATAN2',
  'PI', 'EVEN', 'FACTORIAL', 'GCD', 'LCM', 'ISNAN', 'ISINF', 'ISFINITE',
  // Date/time functions
  'NOW', 'CURRENT_DATE', 'CURRENT_TIME', 'CURRENT_TIMESTAMP', 'TODAY',
  'DATE_PART', 'DATEPART', 'DATE_TRUNC', 'DATETRUNC', 'DATE_DIFF', 'DATEDIFF',
  'DATE_ADD', 'DATE_SUB', 'EXTRACT', 'YEAR', 'MONTH', 'DAY', 'HOUR', 'MINUTE', 'SECOND',
  'DAYOFWEEK', 'DAYOFYEAR', 'WEEK', 'WEEKOFYEAR', 'QUARTER', 'EPOCH', 'EPOCH_MS',
  'STRFTIME', 'STRPTIME', 'TO_TIMESTAMP', 'MAKE_DATE', 'MAKE_TIME', 'MAKE_TIMESTAMP',
  'AGE', 'LAST_DAY', 'MONTHNAME', 'DAYNAME',
  // List/Array functions
  'LIST_VALUE', 'LIST_AGGREGATE', 'LIST_DISTINCT', 'LIST_UNIQUE', 'LIST_SORT',
  'LIST_REVERSE', 'LIST_CONTAINS', 'LIST_ELEMENT', 'LIST_EXTRACT', 'LIST_SLICE',
  'LIST_CONCAT', 'LIST_FILTER', 'LIST_TRANSFORM', 'LIST_REDUCE', 'LIST_APPLY',
  'UNNEST', 'FLATTEN', 'ARRAY_AGG', 'ARRAY_LENGTH', 'ARRAY_SLICE', 'GENERATE_SERIES',
  // Struct functions
  'STRUCT_PACK', 'STRUCT_EXTRACT', 'ROW',
  // Map functions
  'MAP', 'MAP_EXTRACT', 'MAP_KEYS', 'MAP_VALUES', 'MAP_ENTRIES', 'ELEMENT_AT',
  // JSON functions
  'JSON', 'JSON_EXTRACT', 'JSON_EXTRACT_STRING', 'JSON_TYPE', 'JSON_VALID',
  'JSON_ARRAY_LENGTH', 'JSON_KEYS', 'JSON_STRUCTURE', 'JSON_TRANSFORM',
  'TO_JSON', 'JSON_SERIALIZE', 'JSON_DESERIALIZE', 'JSON_QUOTE',
  // Type conversion
  'CAST', 'TRY_CAST', 'TYPEOF', 'COALESCE', 'NULLIF', 'IFNULL', 'NVL',
  // Window functions
  'ROW_NUMBER', 'RANK', 'DENSE_RANK', 'PERCENT_RANK', 'CUME_DIST', 'NTILE',
  'LAG', 'LEAD', 'FIRST_VALUE', 'LAST_VALUE', 'NTH_VALUE',
  // Table functions
  'READ_PARQUET', 'READ_CSV', 'READ_CSV_AUTO', 'READ_JSON', 'READ_JSON_AUTO',
  'GLOB', 'RANGE', 'GENERATE_SERIES', 'UNNEST',
  // Utility functions
  'ALIAS', 'COLUMNS', 'EXCLUDE', 'REPLACE', 'DESCRIBE', 'SUMMARIZE',
  'SAMPLE', 'TABLESAMPLE', 'QUALIFY',
];

// DuckDB Spatial extension functions (similar to PostGIS but with some DuckDB-specific ones)
const DUCKDB_SPATIAL_FUNCTIONS = [
  // Geometry constructors
  'ST_Point', 'ST_MakePoint', 'ST_MakeLine', 'ST_MakePolygon', 'ST_MakeEnvelope',
  'ST_GeomFromText', 'ST_GeomFromWKB', 'ST_GeomFromGeoJSON', 'ST_GeomFromHEXWKB',
  'ST_Point2D', 'ST_Point3D', 'ST_Point4D', 'ST_LineString2D', 'ST_Polygon2D',
  // Geometry outputs
  'ST_AsText', 'ST_AsBinary', 'ST_AsGeoJSON', 'ST_AsHEXWKB', 'ST_AsWKB', 'ST_AsWKT',
  // Geometry accessors
  'ST_X', 'ST_Y', 'ST_Z', 'ST_M', 'ST_XMin', 'ST_XMax', 'ST_YMin', 'ST_YMax',
  'ST_GeometryType', 'ST_Dimension', 'ST_NPoints', 'ST_NumGeometries', 'ST_NumPoints',
  'ST_NumInteriorRings', 'ST_ExteriorRing', 'ST_InteriorRingN', 'ST_GeometryN',
  'ST_PointN', 'ST_StartPoint', 'ST_EndPoint', 'ST_Centroid', 'ST_Envelope', 'ST_Boundary',
  // Spatial relationships
  'ST_Intersects', 'ST_Contains', 'ST_Within', 'ST_Overlaps', 'ST_Touches',
  'ST_Crosses', 'ST_Disjoint', 'ST_Equals', 'ST_Covers', 'ST_CoveredBy',
  'ST_DWithin', 'ST_Distance', 'ST_Distance_Sphere', 'ST_Distance_Spheroid',
  // Spatial measurements
  'ST_Area', 'ST_Area_Spheroid', 'ST_Perimeter', 'ST_Length', 'ST_Length_Spheroid',
  // Geometry processing
  'ST_Simplify', 'ST_SimplifyPreserveTopology', 'ST_ConvexHull', 'ST_Buffer',
  'ST_Difference', 'ST_Intersection', 'ST_SymDifference', 'ST_Union', 'ST_UnaryUnion',
  'ST_MakeValid', 'ST_Normalize', 'ST_ReducePrecision', 'ST_RemoveRepeatedPoints',
  'ST_Reverse', 'ST_FlipCoordinates', 'ST_Transform', 'ST_Collect', 'ST_Multi',
  // Validation
  'ST_IsValid', 'ST_IsSimple', 'ST_IsEmpty', 'ST_IsClosed', 'ST_IsRing', 'ST_IsCollection',
  // Aggregates
  'ST_Extent', 'ST_Union_Agg', 'ST_Collect_Agg',
  // Bounding box
  'ST_Extent', 'Box2D',
  // Coordinate reference system
  'ST_SRID', 'ST_SetSRID', 'ST_Transform',
  // H3 functions (DuckDB specific)
  'H3_LATLNG_TO_CELL', 'H3_CELL_TO_LAT', 'H3_CELL_TO_LNG', 'H3_CELL_TO_LATLNG',
  'H3_CELL_TO_BOUNDARY_WKT', 'H3_GET_RESOLUTION', 'H3_CELL_TO_PARENT', 'H3_CELL_TO_CHILDREN',
  'H3_GRID_DISK', 'H3_GRID_RING_UNSAFE', 'H3_IS_VALID_CELL', 'H3_IS_PENTAGON',
  'H3_STRING_TO_H3', 'H3_H3_TO_STRING',
];

// Data types
const PG_TYPES = [
  'integer', 'int', 'int4', 'bigint', 'int8', 'smallint', 'int2',
  'numeric', 'decimal', 'real', 'float4', 'double precision', 'float8',
  'text', 'varchar', 'char', 'character varying', 'character',
  'boolean', 'bool', 'date', 'time', 'timestamp', 'timestamptz', 'interval',
  'json', 'jsonb', 'uuid', 'bytea', 'array', 'point', 'line', 'polygon',
  'geometry', 'geography', 'box', 'circle', 'inet', 'cidr', 'macaddr',
];

// DuckDB types
const DUCKDB_TYPES = [
  'BIGINT', 'INT8', 'LONG', 'BOOLEAN', 'BOOL', 'LOGICAL', 'BLOB', 'BYTEA', 'BINARY', 'VARBINARY',
  'DATE', 'DOUBLE', 'FLOAT8', 'NUMERIC', 'DECIMAL', 'HUGEINT', 'INTEGER', 'INT4', 'INT', 'SIGNED',
  'INTERVAL', 'REAL', 'FLOAT4', 'FLOAT', 'SMALLINT', 'INT2', 'SHORT', 'TIME', 'TIMESTAMP',
  'TIMESTAMP WITH TIME ZONE', 'TIMESTAMPTZ', 'TINYINT', 'INT1', 'UBIGINT', 'UHUGEINT',
  'UINTEGER', 'USMALLINT', 'UTINYINT', 'UUID', 'VARCHAR', 'CHAR', 'BPCHAR', 'TEXT', 'STRING',
  'BIT', 'BITSTRING', 'GEOMETRY', 'POINT_2D', 'LINESTRING_2D', 'POLYGON_2D', 'BOX_2D',
  'LIST', 'MAP', 'STRUCT', 'UNION', 'ENUM',
];

export const SQLEditor: React.FC<SQLEditorProps> = ({
  value,
  onChange,
  placeholder = 'Enter SQL query...',
  height = '150px',
  minHeight,
  maxHeight,
  schemas = [],
  serviceName,
  readOnly = false,
  className = '',
  dialect = 'postgresql',
}) => {
  const [loadedSchemas, setLoadedSchemas] = useState<SchemaInfo[]>(schemas);

  // Sync loadedSchemas with schemas prop when it changes
  useEffect(() => {
    if (schemas.length > 0) {
      setLoadedSchemas(schemas);
    }
  }, [schemas]);

  // Load schema information if serviceName is provided and schemas are empty
  useEffect(() => {
    if (serviceName && schemas.length === 0 && loadedSchemas.length === 0) {
      loadSchemaInfo(serviceName);
    }
  }, [serviceName, schemas.length, loadedSchemas.length]);

  const loadSchemaInfo = async (service: string) => {
    try {
      // Try to load schema information from the API
      const response = await fetch(`${getApiBase()}/pg/services/${service}/schemas`);
      if (response.ok) {
        const data = await response.json();
        if (data.schemas) {
          setLoadedSchemas(data.schemas);
        }
      }
    } catch (err) {
      console.error('Failed to load schema info:', err);
    }
  };

  // Build completion source with schema awareness
  const schemaCompletion = useMemo(() => {
    return (context: CompletionContext): CompletionResult | null => {
      const word = context.matchBefore(/[\w.]+/);
      if (!word || (word.from === word.to && !context.explicit)) {
        return null;
      }

      const text = word.text.toLowerCase();
      const options: { label: string; type: string; detail?: string; boost?: number }[] = [];

      // Check if we're completing after a dot (schema.table or table.column)
      const dotIndex = text.lastIndexOf('.');
      if (dotIndex >= 0) {
        const prefix = text.substring(0, dotIndex);
        const partial = text.substring(dotIndex + 1);

        // Look for matching schema or table
        for (const schema of loadedSchemas) {
          if (schema.name.toLowerCase() === prefix) {
            // Complete tables in this schema
            for (const table of schema.tables) {
              if (table.name.toLowerCase().startsWith(partial)) {
                options.push({
                  label: table.name,
                  type: 'class',
                  detail: `table in ${schema.name}`,
                  boost: 10,
                });
              }
            }
          }
          // Check if prefix is a table name
          for (const table of schema.tables) {
            const fullTableName = `${schema.name}.${table.name}`.toLowerCase();
            const shortTableName = table.name.toLowerCase();
            if (prefix === fullTableName || prefix === shortTableName) {
              // Complete columns in this table
              for (const col of table.columns) {
                if (col.name.toLowerCase().startsWith(partial)) {
                  options.push({
                    label: col.name,
                    type: 'property',
                    detail: col.type,
                    boost: 15,
                  });
                }
              }
            }
          }
        }
      } else {
        // Complete keywords, functions, schemas, and tables

        // Keywords (high priority after SELECT, FROM, WHERE, etc.)
        for (const kw of PG_KEYWORDS) {
          if (kw.toLowerCase().startsWith(text)) {
            options.push({
              label: kw,
              type: 'keyword',
              boost: 5,
            });
          }
        }

        if (dialect === 'postgresql') {
          // PostgreSQL functions
          for (const fn of PG_FUNCTIONS) {
            if (fn.toLowerCase().startsWith(text)) {
              options.push({
                label: fn + '()',
                type: 'function',
                detail: 'PostgreSQL',
                boost: 3,
              });
            }
          }

          // PostGIS functions
          for (const fn of POSTGIS_FUNCTIONS) {
            if (fn.toLowerCase().startsWith(text)) {
              options.push({
                label: fn + '()',
                type: 'function',
                detail: 'PostGIS',
                boost: 4,
              });
            }
          }

          // PostgreSQL types
          for (const t of PG_TYPES) {
            if (t.toLowerCase().startsWith(text)) {
              options.push({
                label: t,
                type: 'type',
                boost: 1,
              });
            }
          }
        } else if (dialect === 'duckdb') {
          // DuckDB functions
          for (const fn of DUCKDB_FUNCTIONS) {
            if (fn.toLowerCase().startsWith(text)) {
              options.push({
                label: fn + '()',
                type: 'function',
                detail: 'DuckDB',
                boost: 3,
              });
            }
          }

          // DuckDB Spatial functions
          for (const fn of DUCKDB_SPATIAL_FUNCTIONS) {
            if (fn.toLowerCase().startsWith(text)) {
              options.push({
                label: fn + '()',
                type: 'function',
                detail: 'DuckDB Spatial',
                boost: 4,
              });
            }
          }

          // DuckDB types
          for (const t of DUCKDB_TYPES) {
            if (t.toLowerCase().startsWith(text)) {
              options.push({
                label: t,
                type: 'type',
                boost: 1,
              });
            }
          }
        }

        // Schemas
        for (const schema of loadedSchemas) {
          if (schema.name.toLowerCase().startsWith(text)) {
            options.push({
              label: schema.name,
              type: 'namespace',
              detail: 'schema',
              boost: 6,
            });
          }

          // Tables
          for (const table of schema.tables) {
            if (table.name.toLowerCase().startsWith(text)) {
              options.push({
                label: table.name,
                type: 'class',
                detail: `table in ${schema.name}`,
                boost: 8,
              });
            }
            // Also offer fully qualified table names
            const fqn = `${schema.name}.${table.name}`;
            if (fqn.toLowerCase().startsWith(text)) {
              options.push({
                label: fqn,
                type: 'class',
                detail: 'table',
                boost: 7,
              });
            }
          }
        }
      }

      // Sort by boost and limit results
      options.sort((a, b) => (b.boost || 0) - (a.boost || 0));
      const limitedOptions = options.slice(0, 50);

      if (limitedOptions.length === 0) {
        return null;
      }

      return {
        from: word.from,
        options: limitedOptions,
        validFor: /^[\w.]*$/,
      };
    };
  }, [loadedSchemas, dialect]);

  // Build SQL dialect with schema info
  const sqlExtension = useMemo(() => {
    // Build schema object for CodeMirror SQL
    const schemaObj: { [key: string]: readonly string[] } = {};

    for (const schema of loadedSchemas) {
      for (const table of schema.tables) {
        const tableName = `${schema.name}.${table.name}`;
        schemaObj[tableName] = table.columns.map(c => c.name);
        // Also add without schema prefix
        schemaObj[table.name] = table.columns.map(c => c.name);
      }
    }

    return sql({
      dialect: PostgreSQL,
      schema: schemaObj,
      upperCaseKeywords: true,
    });
  }, [loadedSchemas]);

  // Custom theme for SQL
  const theme = useMemo(() => EditorView.theme({
    '&': {
      fontSize: '14px',
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
    },
    '.cm-content': {
      padding: '8px 0',
    },
    '.cm-line': {
      padding: '0 8px',
    },
    '.cm-gutters': {
      backgroundColor: '#f7f7f7',
      borderRight: '1px solid #e0e0e0',
    },
    '&.cm-focused .cm-cursor': {
      borderLeftColor: '#3b82f6',
    },
    '.cm-placeholder': {
      color: '#9ca3af',
    },
    '.cm-tooltip.cm-tooltip-autocomplete': {
      backgroundColor: '#fff',
      border: '1px solid #e5e7eb',
      borderRadius: '6px',
      boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
    },
    '.cm-tooltip.cm-tooltip-autocomplete > ul': {
      fontFamily: 'inherit',
    },
    '.cm-tooltip.cm-tooltip-autocomplete > ul > li': {
      padding: '4px 8px',
    },
    '.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': {
      backgroundColor: '#3b82f6',
      color: '#fff',
    },
    '.cm-completionIcon': {
      width: '1em',
      marginRight: '0.5em',
    },
    '.cm-completionIcon-keyword': {
      '&::after': { content: '"K"', color: '#9333ea' },
    },
    '.cm-completionIcon-function': {
      '&::after': { content: '"ƒ"', color: '#2563eb' },
    },
    '.cm-completionIcon-class': {
      '&::after': { content: '"T"', color: '#059669' },
    },
    '.cm-completionIcon-property': {
      '&::after': { content: '"c"', color: '#d97706' },
    },
    '.cm-completionIcon-namespace': {
      '&::after': { content: '"S"', color: '#dc2626' },
    },
    '.cm-completionIcon-type': {
      '&::after': { content: '"t"', color: '#6366f1' },
    },
  }), []);

  const extensions = useMemo(() => [
    sqlExtension,
    autocompletion({
      override: [schemaCompletion],
      activateOnTyping: true,
      maxRenderedOptions: 50,
    }),
    EditorView.lineWrapping,
    theme,
  ], [sqlExtension, schemaCompletion, theme]);

  return (
    <div className={`sql-editor-wrapper border rounded ${className}`}>
      <CodeMirror
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        height={height}
        minHeight={minHeight}
        maxHeight={maxHeight}
        extensions={extensions}
        readOnly={readOnly}
        basicSetup={{
          lineNumbers: true,
          highlightActiveLineGutter: true,
          highlightSpecialChars: true,
          history: true,
          foldGutter: false,
          drawSelection: true,
          dropCursor: true,
          allowMultipleSelections: true,
          indentOnInput: true,
          syntaxHighlighting: true,
          bracketMatching: true,
          closeBrackets: true,
          autocompletion: false, // We're using our own
          rectangularSelection: true,
          crosshairCursor: false,
          highlightActiveLine: true,
          highlightSelectionMatches: true,
          closeBracketsKeymap: true,
          defaultKeymap: true,
          searchKeymap: true,
          historyKeymap: true,
          foldKeymap: false,
          completionKeymap: true,
          lintKeymap: true,
        }}
      />
    </div>
  );
};

export default SQLEditor;
