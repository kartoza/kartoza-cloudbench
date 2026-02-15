import React, { useState, useEffect } from 'react';
import {
  FiDatabase,
  FiLayers,
  FiMap,
  FiCheck,
  FiX,
  FiRefreshCw,
  FiExternalLink,
  FiCode,
} from 'react-icons/fi';

interface GeoServerConnection {
  id: string;
  name?: string;
  url: string;
}

interface Workspace {
  name: string;
}

interface SQLViewPublisherProps {
  connections: GeoServerConnection[];
  initialSQL?: string;
  initialQueryName?: string;
  pgServiceName?: string;
  onClose: () => void;
  onSuccess?: (result: SQLViewResult) => void;
}

interface SQLViewResult {
  success: boolean;
  layer_name: string;
  workspace: string;
  datastore: string;
  sql: string;
  wms_endpoint?: string;
  wfs_endpoint?: string;
  error?: string;
}

interface GeometryInfo {
  geometry_column: string;
  geometry_type: string;
  srid: number;
  detected: boolean;
}

const GEOMETRY_TYPES = [
  'Point',
  'LineString',
  'Polygon',
  'MultiPoint',
  'MultiLineString',
  'MultiPolygon',
  'Geometry',
  'GeometryCollection',
];

export const SQLViewPublisher: React.FC<SQLViewPublisherProps> = ({
  connections,
  initialSQL = '',
  initialQueryName = '',
  pgServiceName = '',
  onClose,
  onSuccess,
}) => {
  // Connection selection
  const [selectedConnection, setSelectedConnection] = useState<string>('');
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [selectedWorkspace, setSelectedWorkspace] = useState<string>('');
  const [datastores, setDatastores] = useState<string[]>([]);
  const [selectedDatastore, setSelectedDatastore] = useState<string>('');

  // Layer configuration
  const [layerName, setLayerName] = useState<string>(initialQueryName.replace(/\s+/g, '_').toLowerCase() || '');
  const [title, setTitle] = useState<string>(initialQueryName || '');
  const [abstract, setAbstract] = useState<string>('');
  const [sql, setSQL] = useState<string>(initialSQL);

  // Geometry configuration
  const [geometryColumn, setGeometryColumn] = useState<string>('geom');
  const [geometryType, setGeometryType] = useState<string>('Geometry');
  const [srid, setSRID] = useState<number>(4326);
  const [keyColumn, setKeyColumn] = useState<string>('');

  // State
  const [loading, setLoading] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [error, setError] = useState<string>('');
  const [result, setResult] = useState<SQLViewResult | null>(null);
  const [showSQL, setShowSQL] = useState(false);

  // Load workspaces when connection changes
  useEffect(() => {
    if (selectedConnection) {
      fetch(`/api/workspaces/${selectedConnection}`)
        .then(res => res.json())
        .then(data => {
          const ws = data.workspaces?.workspace || [];
          setWorkspaces(ws);
          if (ws.length > 0) {
            setSelectedWorkspace(ws[0].name);
          }
        })
        .catch(err => console.error('Failed to load workspaces:', err));
    }
  }, [selectedConnection]);

  // Load PostGIS datastores when workspace changes
  useEffect(() => {
    if (selectedConnection && selectedWorkspace) {
      fetch(`/api/sqlview/datastores?connection=${selectedConnection}&workspace=${selectedWorkspace}`)
        .then(res => res.json())
        .then(data => {
          const stores = data.datastores || [];
          setDatastores(stores);
          if (stores.length > 0) {
            setSelectedDatastore(stores[0]);
          }
        })
        .catch(err => console.error('Failed to load datastores:', err));
    }
  }, [selectedConnection, selectedWorkspace]);

  // Detect geometry info from SQL
  const detectGeometry = async () => {
    if (!pgServiceName || !sql) {
      return;
    }

    setDetecting(true);
    try {
      const response = await fetch('/api/sqlview/detect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pg_service_name: pgServiceName,
          sql: sql,
        }),
      });

      const data: GeometryInfo = await response.json();
      if (data.detected) {
        setGeometryColumn(data.geometry_column);
        setGeometryType(data.geometry_type);
        setSRID(data.srid);
      }
    } catch (err) {
      console.error('Failed to detect geometry:', err);
    } finally {
      setDetecting(false);
    }
  };

  // Create SQL View layer
  const createSQLView = async () => {
    if (!selectedConnection || !selectedWorkspace || !selectedDatastore || !layerName || !sql) {
      setError('Please fill in all required fields');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await fetch('/api/sqlview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          connection_id: selectedConnection,
          workspace: selectedWorkspace,
          datastore: selectedDatastore,
          layer_name: layerName,
          title: title || layerName,
          abstract: abstract,
          sql: sql,
          geometry_column: geometryColumn,
          geometry_type: geometryType,
          srid: srid,
          key_column: keyColumn || undefined,
        }),
      });

      const data: SQLViewResult = await response.json();

      if (data.success) {
        setResult(data);
        if (onSuccess) {
          onSuccess(data);
        }
      } else {
        setError(data.error || 'Failed to create SQL view layer');
      }
    } catch (err) {
      setError('Network error: ' + (err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  // Success view
  if (result?.success) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
          <div className="flex items-center mb-4">
            <div className="bg-green-100 p-2 rounded-full mr-3">
              <FiCheck className="text-green-600" size={24} />
            </div>
            <h2 className="text-xl font-bold text-gray-900">SQL View Created</h2>
          </div>

          <div className="space-y-3 mb-6">
            <div className="flex items-center text-gray-600">
              <FiLayers className="mr-2" />
              <span className="font-medium">Layer:</span>
              <span className="ml-2">{result.layer_name}</span>
            </div>
            <div className="flex items-center text-gray-600">
              <FiMap className="mr-2" />
              <span className="font-medium">Workspace:</span>
              <span className="ml-2">{result.workspace}</span>
            </div>
            <div className="flex items-center text-gray-600">
              <FiDatabase className="mr-2" />
              <span className="font-medium">Store:</span>
              <span className="ml-2">{result.datastore}</span>
            </div>
          </div>

          <div className="bg-gray-50 rounded p-3 mb-6">
            <p className="text-sm text-gray-600 mb-2">
              Your query is now available as a WMS/WFS layer:
            </p>
            <p className="text-sm font-mono text-gray-800">
              {result.workspace}:{result.layer_name}
            </p>
          </div>

          {result.wms_endpoint && (
            <div className="flex space-x-2 mb-4">
              <a
                href={result.wms_endpoint}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center text-blue-600 hover:text-blue-800 text-sm"
              >
                <FiExternalLink className="mr-1" />
                WMS Capabilities
              </a>
              {result.wfs_endpoint && (
                <a
                  href={result.wfs_endpoint}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center text-blue-600 hover:text-blue-800 text-sm"
                >
                  <FiExternalLink className="mr-1" />
                  WFS Capabilities
                </a>
              )}
            </div>
          )}

          <button
            onClick={onClose}
            className="w-full py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold text-gray-900">Publish SQL View Layer</h2>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
              <FiX size={24} />
            </button>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
              {error}
            </div>
          )}

          {/* GeoServer Selection */}
          <div className="space-y-4 mb-6">
            <h3 className="font-medium text-gray-700">GeoServer Target</h3>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm text-gray-600 mb-1">Connection</label>
                <select
                  value={selectedConnection}
                  onChange={e => setSelectedConnection(e.target.value)}
                  className="w-full border rounded px-3 py-2"
                >
                  <option value="">Select connection...</option>
                  {connections.map(conn => (
                    <option key={conn.id} value={conn.id}>
                      {conn.name || conn.url}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm text-gray-600 mb-1">Workspace</label>
                <select
                  value={selectedWorkspace}
                  onChange={e => setSelectedWorkspace(e.target.value)}
                  className="w-full border rounded px-3 py-2"
                  disabled={!selectedConnection}
                >
                  <option value="">Select workspace...</option>
                  {workspaces.map(ws => (
                    <option key={ws.name} value={ws.name}>
                      {ws.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm text-gray-600 mb-1">PostGIS Store</label>
                <select
                  value={selectedDatastore}
                  onChange={e => setSelectedDatastore(e.target.value)}
                  className="w-full border rounded px-3 py-2"
                  disabled={!selectedWorkspace}
                >
                  <option value="">Select store...</option>
                  {datastores.map(store => (
                    <option key={store} value={store}>
                      {store}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Layer Info */}
          <div className="space-y-4 mb-6">
            <h3 className="font-medium text-gray-700">Layer Information</h3>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-gray-600 mb-1">
                  Layer Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={layerName}
                  onChange={e => setLayerName(e.target.value.replace(/[^a-zA-Z0-9_]/g, '_'))}
                  placeholder="my_layer"
                  className="w-full border rounded px-3 py-2"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">Title</label>
                <input
                  type="text"
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  placeholder="Human-readable title"
                  className="w-full border rounded px-3 py-2"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm text-gray-600 mb-1">Abstract / Description</label>
              <textarea
                value={abstract}
                onChange={e => setAbstract(e.target.value)}
                placeholder="Description of this layer..."
                className="w-full border rounded px-3 py-2 h-20"
              />
            </div>
          </div>

          {/* SQL Query */}
          <div className="space-y-4 mb-6">
            <div className="flex items-center justify-between">
              <h3 className="font-medium text-gray-700">SQL Query</h3>
              <button
                onClick={() => setShowSQL(!showSQL)}
                className="text-sm text-blue-600 hover:text-blue-800 flex items-center"
              >
                <FiCode className="mr-1" />
                {showSQL ? 'Hide SQL' : 'Show SQL'}
              </button>
            </div>

            {showSQL ? (
              <textarea
                value={sql}
                onChange={e => setSQL(e.target.value)}
                placeholder="SELECT * FROM my_table WHERE ..."
                className="w-full border rounded px-3 py-2 font-mono text-sm h-32"
              />
            ) : (
              <div className="bg-gray-50 rounded p-3 font-mono text-sm text-gray-700 max-h-32 overflow-auto">
                {sql || 'No SQL query provided'}
              </div>
            )}
          </div>

          {/* Geometry Configuration */}
          <div className="space-y-4 mb-6">
            <div className="flex items-center justify-between">
              <h3 className="font-medium text-gray-700">Geometry Configuration</h3>
              {pgServiceName && (
                <button
                  onClick={detectGeometry}
                  disabled={detecting}
                  className="text-sm text-blue-600 hover:text-blue-800 flex items-center disabled:text-gray-400"
                >
                  <FiRefreshCw className={`mr-1 ${detecting ? 'animate-spin' : ''}`} />
                  Auto-detect
                </button>
              )}
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm text-gray-600 mb-1">Geometry Column</label>
                <input
                  type="text"
                  value={geometryColumn}
                  onChange={e => setGeometryColumn(e.target.value)}
                  placeholder="geom"
                  className="w-full border rounded px-3 py-2"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">Geometry Type</label>
                <select
                  value={geometryType}
                  onChange={e => setGeometryType(e.target.value)}
                  className="w-full border rounded px-3 py-2"
                >
                  {GEOMETRY_TYPES.map(type => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">SRID</label>
                <input
                  type="number"
                  value={srid}
                  onChange={e => setSRID(parseInt(e.target.value) || 4326)}
                  className="w-full border rounded px-3 py-2"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm text-gray-600 mb-1">Primary Key Column (optional)</label>
              <input
                type="text"
                value={keyColumn}
                onChange={e => setKeyColumn(e.target.value)}
                placeholder="e.g., id, gid"
                className="w-full border rounded px-3 py-2"
              />
              <p className="text-xs text-gray-500 mt-1">
                Improves performance for WFS queries. Leave empty to auto-generate.
              </p>
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end space-x-3 pt-4 border-t">
            <button
              onClick={onClose}
              className="px-4 py-2 text-gray-600 hover:text-gray-800"
            >
              Cancel
            </button>
            <button
              onClick={createSQLView}
              disabled={loading || !selectedConnection || !selectedWorkspace || !selectedDatastore || !layerName || !sql}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed flex items-center"
            >
              {loading ? (
                <>
                  <FiRefreshCw className="animate-spin mr-2" />
                  Creating...
                </>
              ) : (
                <>
                  <FiLayers className="mr-2" />
                  Publish Layer
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
