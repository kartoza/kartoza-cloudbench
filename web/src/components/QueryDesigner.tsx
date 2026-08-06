import React, { useState, useEffect } from 'react';
import { getApiBase } from '../config/env';
import {
  FiPlay,
  FiSave,
  FiTrash2,
  FiPlus,
  FiX,
  FiDatabase,
  FiTable as _FiTable,
  FiColumns,
  FiFilter,
  FiArrowDown,
  FiCode,
  FiRefreshCw,
  FiEdit2,
} from 'react-icons/fi';
import { SQLEditor } from './SQLEditor';

interface Column {
  name: string;
  alias?: string;
  table?: string;
  aggregate?: string;
}

interface Condition {
  column: string;
  operator: string;
  value: any;
  logic: 'AND' | 'OR';
}

interface OrderBy {
  column: string;
  direction: 'ASC' | 'DESC';
}

interface QueryDefinition {
  name?: string;
  schema: string;
  table: string;
  columns: Column[];
  conditions: Condition[];
  group_by: string[];
  order_by: OrderBy[];
  limit: number;
  distinct: boolean;
}

interface TableInfo {
  name: string;
  columns: { name: string; type: string; nullable: boolean }[];
  has_geometry: boolean;
  geometry_column?: string;
}

interface SchemaInfo {
  name: string;
  tables: TableInfo[];
}

interface QueryDesignerProps {
  serviceName: string;
  onClose?: () => void;
}

const OPERATORS = [
  { value: '=', label: 'equals' },
  { value: '!=', label: 'not equals' },
  { value: '<', label: 'less than' },
  { value: '<=', label: 'less than or equal' },
  { value: '>', label: 'greater than' },
  { value: '>=', label: 'greater than or equal' },
  { value: 'LIKE', label: 'contains (LIKE)' },
  { value: 'ILIKE', label: 'contains (case-insensitive)' },
  { value: 'IS NULL', label: 'is null' },
  { value: 'IS NOT NULL', label: 'is not null' },
  { value: 'IN', label: 'in list' },
];

const AGGREGATES = [
  { value: '', label: 'None' },
  { value: 'COUNT', label: 'Count' },
  { value: 'SUM', label: 'Sum' },
  { value: 'AVG', label: 'Average' },
  { value: 'MIN', label: 'Minimum' },
  { value: 'MAX', label: 'Maximum' },
  { value: 'ST_Extent', label: 'Extent (Geometry)' },
  { value: 'ST_Union', label: 'Union (Geometry)' },
];

export const QueryDesigner: React.FC<QueryDesignerProps> = ({ serviceName, onClose }) => {
  const [schemas, setSchemas] = useState<SchemaInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [executing, setExecuting] = useState(false);

  const [selectedSchema, setSelectedSchema] = useState('public');
  const [selectedTable, setSelectedTable] = useState('');
  const [columns, setColumns] = useState<Column[]>([]);
  const [conditions, setConditions] = useState<Condition[]>([]);
  const [groupBy, _setGroupBy] = useState<string[]>([]);
  const [orderBy, setOrderBy] = useState<OrderBy[]>([]);
  const [limit, setLimit] = useState(100);
  const [distinct, setDistinct] = useState(false);

  const [generatedSQL, setGeneratedSQL] = useState('');
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState('');
  const [showSQL, setShowSQL] = useState(false);
  const [editableSQL, setEditableSQL] = useState(false);
  const [customSQL, setCustomSQL] = useState('');
  const [queryName, setQueryName] = useState('');

  // Load schema info
  useEffect(() => {
    fetch(`${getApiBase()}/pg/services/${serviceName}/schema`)
      .then(res => res.json())
      .then(data => {
        if (data.schemas) {
          setSchemas(data.schemas);
        }
      })
      .catch(err => console.error('Failed to load schema:', err));
  }, [serviceName]);

  const currentSchema = schemas.find(s => s.name === selectedSchema);
  const currentTable = currentSchema?.tables.find(t => t.name === selectedTable);
  const availableColumns = currentTable?.columns || [];

  const buildDefinition = (): QueryDefinition => ({
    schema: selectedSchema,
    table: selectedTable,
    columns: columns.length > 0 ? columns : [{ name: '*' }],
    conditions,
    group_by: groupBy,
    order_by: orderBy,
    limit,
    distinct,
  });

  const handleBuildSQL = async () => {
    setLoading(true);
    setError('');

    try {
      const res = await fetch(`${getApiBase()}/query/build`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildDefinition()),
      });

      const data = await res.json();
      if (data.sql) {
        setGeneratedSQL(data.sql);
        setShowSQL(true);
      } else if (data.error) {
        setError(data.error);
      }
    } catch (err) {
      setError('Failed to build query: ' + (err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleExecute = async () => {
    setExecuting(true);
    setError('');
    setResult(null);

    try {
      let sql = editableSQL && customSQL ? customSQL : generatedSQL;

      if (!sql) {
        const buildRes = await fetch(`${getApiBase()}/query/build`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(buildDefinition()),
        });
        const buildData = await buildRes.json();
        if (!buildData.sql) {
          setError(buildData.error || 'Failed to build query');
          return;
        }
        sql = buildData.sql;
        setGeneratedSQL(sql);
        setShowSQL(true);
      }

      const res = await fetch(`${getApiBase()}/pg/services/${encodeURIComponent(serviceName)}/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: sql, limit }),
      });

      const data = await res.json();
      if (data.success) {
        setResult(data.result);
        setShowSQL(true);
      } else {
        setError(data.error || 'Execution failed');
      }
    } catch (err) {
      setError('Failed to execute: ' + (err as Error).message);
    } finally {
      setExecuting(false);
    }
  };

  const handleSave = async () => {
    if (!queryName.trim()) {
      setError('Please enter a query name');
      return;
    }

    try {
      const res = await fetch(`${getApiBase()}/query/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: queryName,
          service_name: serviceName,
          definition: buildDefinition(),
        }),
      });

      const data = await res.json();
      if (data.success) {
        alert('Query saved successfully');
      } else {
        setError(data.error || 'Failed to save');
      }
    } catch (err) {
      setError('Failed to save: ' + (err as Error).message);
    }
  };

  const addColumn = () => {
    setColumns([...columns, { name: '' }]);
  };

  const removeColumn = (index: number) => {
    setColumns(columns.filter((_, i) => i !== index));
  };

  const updateColumn = (index: number, updates: Partial<Column>) => {
    const newColumns = [...columns];
    newColumns[index] = { ...newColumns[index], ...updates };
    setColumns(newColumns);
  };

  const addCondition = () => {
    setConditions([...conditions, { column: '', operator: '=', value: '', logic: 'AND' }]);
  };

  const removeCondition = (index: number) => {
    setConditions(conditions.filter((_, i) => i !== index));
  };

  const updateCondition = (index: number, updates: Partial<Condition>) => {
    const newConditions = [...conditions];
    newConditions[index] = { ...newConditions[index], ...updates };
    setConditions(newConditions);
  };

  const addOrderBy = () => {
    setOrderBy([...orderBy, { column: '', direction: 'ASC' }]);
  };

  const removeOrderBy = (index: number) => {
    setOrderBy(orderBy.filter((_, i) => i !== index));
  };

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl shadow-lg p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold flex items-center gap-2">
          <FiDatabase className="text-blue-500" />
          Visual Query Designer
        </h2>
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500">{serviceName}</span>
          {onClose && (
            <button onClick={onClose} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg">
              <FiX />
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-100 dark:bg-red-900/20 text-red-700 dark:text-red-300 rounded-lg">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Panel: Table Selection */}
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Schema</label>
            <select
              value={selectedSchema}
              onChange={e => {
                setSelectedSchema(e.target.value);
                setSelectedTable('');
              }}
              className="w-full p-2 border rounded-lg dark:bg-gray-800 dark:border-gray-600"
            >
              {schemas.map(s => (
                <option key={s.name} value={s.name}>{s.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Table</label>
            <select
              value={selectedTable}
              onChange={e => setSelectedTable(e.target.value)}
              className="w-full p-2 border rounded-lg dark:bg-gray-800 dark:border-gray-600"
            >
              <option value="">Select a table...</option>
              {currentSchema?.tables.map(t => (
                <option key={t.name} value={t.name}>
                  {t.name} {t.has_geometry && '🗺️'}
                </option>
              ))}
            </select>
          </div>

          {currentTable && (
            <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
              <h4 className="font-medium text-sm mb-2 flex items-center gap-1">
                <FiColumns />
                Available Columns
              </h4>
              <div className="max-h-48 overflow-y-auto space-y-1">
                {availableColumns.map(col => (
                  <div key={col.name} className="text-xs flex justify-between">
                    <span>{col.name}</span>
                    <span className="text-gray-400">{col.type}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Middle Panel: Query Builder */}
        <div className="space-y-4">
          {/* Columns */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium flex items-center gap-1">
                <FiColumns />
                Columns
              </label>
              <button
                onClick={addColumn}
                className="text-sm text-blue-500 hover:text-blue-600 flex items-center gap-1"
              >
                <FiPlus size={14} /> Add
              </button>
            </div>
            {columns.length === 0 ? (
              <p className="text-sm text-gray-500">All columns (*)</p>
            ) : (
              <div className="space-y-2">
                {columns.map((col, i) => (
                  <div key={i} className="flex gap-2">
                    <select
                      value={col.name}
                      onChange={e => updateColumn(i, { name: e.target.value })}
                      className="flex-1 p-2 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-600"
                    >
                      <option value="">Select column...</option>
                      {availableColumns.map(c => (
                        <option key={c.name} value={c.name}>{c.name}</option>
                      ))}
                    </select>
                    <select
                      value={col.aggregate || ''}
                      onChange={e => updateColumn(i, { aggregate: e.target.value })}
                      className="w-24 p-2 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-600"
                    >
                      {AGGREGATES.map(a => (
                        <option key={a.value} value={a.value}>{a.label}</option>
                      ))}
                    </select>
                    <button
                      onClick={() => removeColumn(i)}
                      className="p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg"
                    >
                      <FiTrash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Conditions */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium flex items-center gap-1">
                <FiFilter />
                Conditions (WHERE)
              </label>
              <button
                onClick={addCondition}
                className="text-sm text-blue-500 hover:text-blue-600 flex items-center gap-1"
              >
                <FiPlus size={14} /> Add
              </button>
            </div>
            {conditions.length === 0 ? (
              <p className="text-sm text-gray-500">No conditions</p>
            ) : (
              <div className="space-y-2">
                {conditions.map((cond, i) => (
                  <div key={i} className="flex flex-wrap gap-2 items-center">
                    {i > 0 && (
                      <select
                        value={cond.logic}
                        onChange={e => updateCondition(i, { logic: e.target.value as 'AND' | 'OR' })}
                        className="w-16 p-2 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-600"
                      >
                        <option value="AND">AND</option>
                        <option value="OR">OR</option>
                      </select>
                    )}
                    <select
                      value={cond.column}
                      onChange={e => updateCondition(i, { column: e.target.value })}
                      className="flex-1 min-w-[100px] p-2 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-600"
                    >
                      <option value="">Column...</option>
                      {availableColumns.map(c => (
                        <option key={c.name} value={c.name}>{c.name}</option>
                      ))}
                    </select>
                    <select
                      value={cond.operator}
                      onChange={e => updateCondition(i, { operator: e.target.value })}
                      className="w-32 p-2 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-600"
                    >
                      {OPERATORS.map(op => (
                        <option key={op.value} value={op.value}>{op.label}</option>
                      ))}
                    </select>
                    {!['IS NULL', 'IS NOT NULL'].includes(cond.operator) && (
                      <input
                        type="text"
                        value={cond.value}
                        onChange={e => updateCondition(i, { value: e.target.value })}
                        placeholder="Value..."
                        className="flex-1 min-w-[80px] p-2 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-600"
                      />
                    )}
                    <button
                      onClick={() => removeCondition(i)}
                      className="p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg"
                    >
                      <FiTrash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Order By */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium flex items-center gap-1">
                <FiArrowDown />
                Order By
              </label>
              <button
                onClick={addOrderBy}
                className="text-sm text-blue-500 hover:text-blue-600 flex items-center gap-1"
              >
                <FiPlus size={14} /> Add
              </button>
            </div>
            {orderBy.length === 0 ? (
              <p className="text-sm text-gray-500">No sorting</p>
            ) : (
              <div className="space-y-2">
                {orderBy.map((ob, i) => (
                  <div key={i} className="flex gap-2">
                    <select
                      value={ob.column}
                      onChange={e => {
                        const newOrderBy = [...orderBy];
                        newOrderBy[i] = { ...ob, column: e.target.value };
                        setOrderBy(newOrderBy);
                      }}
                      className="flex-1 p-2 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-600"
                    >
                      <option value="">Column...</option>
                      {availableColumns.map(c => (
                        <option key={c.name} value={c.name}>{c.name}</option>
                      ))}
                    </select>
                    <select
                      value={ob.direction}
                      onChange={e => {
                        const newOrderBy = [...orderBy];
                        newOrderBy[i] = { ...ob, direction: e.target.value as 'ASC' | 'DESC' };
                        setOrderBy(newOrderBy);
                      }}
                      className="w-24 p-2 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-600"
                    >
                      <option value="ASC">ASC</option>
                      <option value="DESC">DESC</option>
                    </select>
                    <button
                      onClick={() => removeOrderBy(i)}
                      className="p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg"
                    >
                      <FiTrash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Options */}
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={distinct}
                onChange={e => setDistinct(e.target.checked)}
                className="rounded"
              />
              Distinct
            </label>
            <label className="flex items-center gap-2 text-sm">
              Limit:
              <input
                type="number"
                value={limit}
                onChange={e => setLimit(parseInt(e.target.value) || 100)}
                className="w-20 p-1 border rounded text-sm dark:bg-gray-800 dark:border-gray-600"
                min={1}
                max={10000}
              />
            </label>
          </div>
        </div>

        {/* Right Panel: Actions & Results */}
        <div className="space-y-4">
          {/* Actions */}
          <div className="flex flex-wrap gap-2">
            <button
              onClick={handleBuildSQL}
              disabled={!selectedTable || loading}
              className="flex-1 px-3 py-2 bg-gray-100 dark:bg-gray-800 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <FiCode />
              View SQL
            </button>
            <button
              onClick={handleExecute}
              disabled={!selectedTable || executing}
              className="flex-1 px-3 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {executing ? <FiRefreshCw className="animate-spin" /> : <FiPlay />}
              Execute
            </button>
          </div>

          {/* Save */}
          <div className="flex gap-2">
            <input
              type="text"
              value={queryName}
              onChange={e => setQueryName(e.target.value)}
              placeholder="Query name..."
              className="flex-1 p-2 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-600"
            />
            <button
              onClick={handleSave}
              disabled={!queryName.trim()}
              className="px-3 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 flex items-center gap-2"
            >
              <FiSave />
            </button>
          </div>

          {/* Generated SQL */}
          {showSQL && generatedSQL && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="font-medium text-sm flex items-center gap-1">
                  <FiCode />
                  {editableSQL ? 'Custom SQL' : 'Generated SQL'}
                </h4>
                <button
                  onClick={() => {
                    if (!editableSQL) {
                      setCustomSQL(generatedSQL);
                    }
                    setEditableSQL(!editableSQL);
                  }}
                  className="text-xs text-blue-500 hover:text-blue-600 flex items-center gap-1"
                >
                  <FiEdit2 size={12} />
                  {editableSQL ? 'Use Visual' : 'Edit SQL'}
                </button>
              </div>
              {editableSQL ? (
                <SQLEditor
                  value={customSQL}
                  onChange={setCustomSQL}
                  height="150px"
                  serviceName={serviceName}
                  schemas={schemas}
                  placeholder="Enter your SQL query..."
                />
              ) : (
                <SQLEditor
                  value={generatedSQL}
                  onChange={() => {}}
                  height="120px"
                  serviceName={serviceName}
                  schemas={schemas}
                  readOnly={true}
                />
              )}
            </div>
          )}

          {/* Results */}
          {result && (
            <div>
              <h4 className="font-medium text-sm mb-2">
                Results ({result.row_count} rows, {result.duration_ms?.toFixed(2)}ms)
              </h4>
              <div className="overflow-x-auto max-h-64 border rounded-lg">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-gray-100 dark:bg-gray-800">
                    <tr>
                      {result.columns?.map((col: any, i: number) => (
                        <th key={i} className="p-2 text-left border-b">{col.name}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows?.slice(0, 50).map((row: any, i: number) => (
                      <tr key={i} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                        {result.columns?.map((col: any, j: number) => (
                          <td key={j} className="p-2 border-b truncate max-w-[150px]">
                            {row[col.name] !== null ? String(row[col.name]) : <span className="text-gray-400">NULL</span>}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
