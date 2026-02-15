import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
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
import { SQLEditor } from './SQLEditor';
import {
  modalBackdrop,
  modalContent,
  springs,
  staggerContainer,
  staggerItem,
  successPop,
} from '../utils/animations';

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
      <motion.div
        className="fixed inset-0 flex items-center justify-center z-50"
        initial="hidden"
        animate="visible"
        exit="exit"
      >
        <motion.div
          className="absolute inset-0 bg-black/50 backdrop-blur-sm"
          variants={modalBackdrop}
          onClick={onClose}
        />
        <motion.div
          className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-2xl max-w-md w-full mx-4 p-6 overflow-hidden"
          variants={modalContent}
        >
          {/* Celebration background effect */}
          <motion.div
            className="absolute inset-0 bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5 }}
          />

          <div className="relative">
            <motion.div
              className="flex items-center mb-4"
              variants={staggerContainer}
              initial="hidden"
              animate="visible"
            >
              <motion.div
                className="bg-green-100 dark:bg-green-900/50 p-3 rounded-full mr-3"
                variants={successPop}
              >
                <motion.div
                  initial={{ scale: 0, rotate: -180 }}
                  animate={{ scale: 1, rotate: 0 }}
                  transition={springs.bouncy}
                >
                  <FiCheck className="text-green-600 dark:text-green-400" size={28} />
                </motion.div>
              </motion.div>
              <motion.h2
                className="text-xl font-bold text-gray-900 dark:text-white"
                variants={staggerItem}
              >
                SQL View Created
              </motion.h2>
            </motion.div>

            <motion.div
              className="space-y-3 mb-6"
              variants={staggerContainer}
              initial="hidden"
              animate="visible"
            >
              <motion.div className="flex items-center text-gray-600 dark:text-gray-300" variants={staggerItem}>
                <FiLayers className="mr-2 text-blue-500" />
                <span className="font-medium">Layer:</span>
                <span className="ml-2">{result.layer_name}</span>
              </motion.div>
              <motion.div className="flex items-center text-gray-600 dark:text-gray-300" variants={staggerItem}>
                <FiMap className="mr-2 text-green-500" />
                <span className="font-medium">Workspace:</span>
                <span className="ml-2">{result.workspace}</span>
              </motion.div>
              <motion.div className="flex items-center text-gray-600 dark:text-gray-300" variants={staggerItem}>
                <FiDatabase className="mr-2 text-purple-500" />
                <span className="font-medium">Store:</span>
                <span className="ml-2">{result.datastore}</span>
              </motion.div>
            </motion.div>

            <motion.div
              className="bg-gray-50 dark:bg-gray-800 rounded-xl p-4 mb-6"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3, ...springs.gentle }}
            >
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
                Your query is now available as a WMS/WFS layer:
              </p>
              <motion.p
                className="text-sm font-mono text-gray-800 dark:text-gray-200 bg-white dark:bg-gray-700 px-3 py-2 rounded-lg"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.4 }}
              >
                {result.workspace}:{result.layer_name}
              </motion.p>
            </motion.div>

            {result.wms_endpoint && (
              <motion.div
                className="flex space-x-4 mb-4"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.5 }}
              >
                <motion.a
                  href={result.wms_endpoint}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center text-blue-600 hover:text-blue-800 text-sm group"
                  whileHover={{ x: 2 }}
                >
                  <FiExternalLink className="mr-1 group-hover:rotate-12 transition-transform" />
                  WMS Capabilities
                </motion.a>
                {result.wfs_endpoint && (
                  <motion.a
                    href={result.wfs_endpoint}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center text-blue-600 hover:text-blue-800 text-sm group"
                    whileHover={{ x: 2 }}
                  >
                    <FiExternalLink className="mr-1 group-hover:rotate-12 transition-transform" />
                    WFS Capabilities
                  </motion.a>
                )}
              </motion.div>
            )}

            <motion.button
              onClick={onClose}
              className="w-full py-3 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-xl font-medium shadow-lg shadow-blue-500/25 hover:shadow-blue-500/40 transition-shadow"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5, ...springs.snappy }}
            >
              Done
            </motion.button>
          </div>
        </motion.div>
      </motion.div>
    );
  }

  return (
    <motion.div
      className="fixed inset-0 flex items-center justify-center z-50"
      initial="hidden"
      animate="visible"
      exit="exit"
    >
      <motion.div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        variants={modalBackdrop}
        onClick={onClose}
      />
      <motion.div
        className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-2xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto"
        variants={modalContent}
      >
        <div className="p-6">
          <div className="flex items-center justify-between mb-6">
            <motion.h2
              className="text-xl font-bold text-gray-900 dark:text-white"
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={springs.snappy}
            >
              Publish SQL View Layer
            </motion.h2>
            <motion.button
              onClick={onClose}
              className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
              whileHover={{ rotate: 90 }}
              whileTap={{ scale: 0.9 }}
            >
              <FiX size={20} />
            </motion.button>
          </div>

          <AnimatePresence>
            {error && (
              <motion.div
                className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 px-4 py-3 rounded-xl mb-4"
                initial={{ opacity: 0, y: -10, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1, x: [0, -5, 5, -5, 5, 0] }}
                exit={{ opacity: 0, y: -10, scale: 0.95 }}
                transition={{ x: { duration: 0.4 }, ...springs.snappy }}
              >
                {error}
              </motion.div>
            )}
          </AnimatePresence>

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
              <SQLEditor
                value={sql}
                onChange={setSQL}
                height="150px"
                serviceName={pgServiceName}
                placeholder="SELECT * FROM my_table WHERE ..."
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
          <motion.div
            className="flex justify-end space-x-3 pt-4 border-t dark:border-gray-700"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2, ...springs.gentle }}
          >
            <motion.button
              onClick={onClose}
              className="px-4 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              Cancel
            </motion.button>
            <motion.button
              onClick={createSQLView}
              disabled={loading || !selectedConnection || !selectedWorkspace || !selectedDatastore || !layerName || !sql}
              className="px-5 py-2 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-lg shadow-md shadow-blue-500/25 hover:shadow-blue-500/40 disabled:from-gray-300 disabled:to-gray-400 disabled:shadow-none disabled:cursor-not-allowed flex items-center transition-shadow"
              whileHover={!loading && selectedConnection && selectedWorkspace && selectedDatastore && layerName && sql ? { scale: 1.02 } : undefined}
              whileTap={!loading && selectedConnection && selectedWorkspace && selectedDatastore && layerName && sql ? { scale: 0.98 } : undefined}
            >
              {loading ? (
                <>
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                  >
                    <FiRefreshCw className="mr-2" />
                  </motion.div>
                  Creating...
                </>
              ) : (
                <>
                  <FiLayers className="mr-2" />
                  Publish Layer
                </>
              )}
            </motion.button>
          </motion.div>
        </div>
      </motion.div>
    </motion.div>
  );
};
