import React, { useState, useEffect } from 'react';
import { getApiBase } from '../config/env';
import { FiDatabase, FiServer, FiFolder, FiTable, FiArrowRight, FiCheck, FiX } from 'react-icons/fi';

interface PGService {
  name: string;
  host?: string;
  port?: string;
  dbname?: string;
  user?: string;
}

interface GeoServerConnection {
  id: string;
  name?: string;
  url: string;
}

interface Workspace {
  name: string;
}

interface BridgeWizardProps {
  connections: GeoServerConnection[];
  onClose: () => void;
  onSuccess: () => void;
}

type WizardStep = 'pg-service' | 'geoserver' | 'workspace' | 'store-name' | 'schema' | 'tables' | 'confirm' | 'creating' | 'complete';

export const BridgeWizard: React.FC<BridgeWizardProps> = ({ connections, onClose, onSuccess }) => {
  const [step, setStep] = useState<WizardStep>('pg-service');
  const [pgServices, setPgServices] = useState<PGService[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [schemas, _setSchemas] = useState<string[]>(['public']);
  const [tables, setTables] = useState<string[]>([]);

  const [selectedPgService, setSelectedPgService] = useState<string>('');
  const [selectedGeoServer, setSelectedGeoServer] = useState<string>('');
  const [selectedWorkspace, setSelectedWorkspace] = useState<string>('');
  const [storeName, setStoreName] = useState<string>('');
  const [selectedSchema, setSelectedSchema] = useState<string>('public');
  const [selectedTables, setSelectedTables] = useState<string[]>([]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const [_success, setSuccess] = useState(false);

  // Load PostgreSQL services
  useEffect(() => {
    fetch(`${getApiBase()}/pg/services`)
      .then(res => res.json())
      .then(data => setPgServices(data || []))
      .catch(err => console.error('Failed to load PG services:', err));
  }, []);

  // Load workspaces when GeoServer is selected
  useEffect(() => {
    if (selectedGeoServer) {
      fetch(`${getApiBase()}/workspaces/${selectedGeoServer}`)
        .then(res => res.json())
        .then(data => setWorkspaces(data?.workspaces || []))
        .catch(err => console.error('Failed to load workspaces:', err));
    }
  }, [selectedGeoServer]);

  // Load tables when PG service and schema are selected
  useEffect(() => {
    if (selectedPgService) {
      fetch(`${getApiBase()}/bridge/tables?service=${encodeURIComponent(selectedPgService)}`)
        .then(res => res.json())
        .then(data => setTables(data?.tables || []))
        .catch(err => console.error('Failed to load tables:', err));
    }
  }, [selectedPgService]);

  const handleNext = () => {
    switch (step) {
      case 'pg-service':
        if (selectedPgService) {
          setStoreName(`${selectedPgService}_store`);
          setStep('geoserver');
        }
        break;
      case 'geoserver':
        if (selectedGeoServer) setStep('workspace');
        break;
      case 'workspace':
        if (selectedWorkspace) setStep('store-name');
        break;
      case 'store-name':
        if (storeName) setStep('schema');
        break;
      case 'schema':
        if (selectedSchema) setStep('tables');
        break;
      case 'tables':
        setStep('confirm');
        break;
      case 'confirm':
        createBridge();
        break;
    }
  };

  const handleBack = () => {
    switch (step) {
      case 'geoserver': setStep('pg-service'); break;
      case 'workspace': setStep('geoserver'); break;
      case 'store-name': setStep('workspace'); break;
      case 'schema': setStep('store-name'); break;
      case 'tables': setStep('schema'); break;
      case 'confirm': setStep('tables'); break;
    }
  };

  const createBridge = async () => {
    setStep('creating');
    setLoading(true);
    setError('');

    try {
      const response = await fetch(`${getApiBase()}/bridge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pg_service_name: selectedPgService,
          geoserver_connection_id: selectedGeoServer,
          workspace: selectedWorkspace,
          store_name: storeName,
          schema: selectedSchema,
          tables: selectedTables,
          publish_layers: selectedTables.length > 0,
        }),
      });

      const data = await response.json();

      if (data.success) {
        setSuccess(true);
        setStep('complete');
        onSuccess();
      } else {
        setError(data.error || 'Failed to create bridge');
        setStep('confirm');
      }
    } catch (err) {
      setError('Network error: ' + (err as Error).message);
      setStep('confirm');
    } finally {
      setLoading(false);
    }
  };

  const toggleTable = (table: string) => {
    setSelectedTables(prev =>
      prev.includes(table)
        ? prev.filter(t => t !== table)
        : [...prev, table]
    );
  };

  const renderStepIndicator = () => {
    const steps = [
      { key: 'pg-service', label: 'PG Service' },
      { key: 'geoserver', label: 'GeoServer' },
      { key: 'workspace', label: 'Workspace' },
      { key: 'store-name', label: 'Store Name' },
      { key: 'schema', label: 'Schema' },
      { key: 'tables', label: 'Tables' },
      { key: 'confirm', label: 'Confirm' },
    ];

    const currentIndex = steps.findIndex(s => s.key === step);

    return (
      <div className="flex items-center justify-center mb-6 flex-wrap gap-1">
        {steps.map((s, i) => (
          <React.Fragment key={s.key}>
            <div
              className={`flex items-center gap-1 px-2 py-1 rounded text-xs ${
                i < currentIndex
                  ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300'
                  : i === currentIndex
                  ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300'
                  : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'
              }`}
            >
              {i < currentIndex && <FiCheck className="w-3 h-3" />}
              {s.label}
            </div>
            {i < steps.length - 1 && (
              <FiArrowRight className="w-3 h-3 text-gray-400" />
            )}
          </React.Fragment>
        ))}
      </div>
    );
  };

  const renderStep = () => {
    switch (step) {
      case 'pg-service':
        return (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <FiDatabase className="text-blue-500" />
              Select PostgreSQL Service
            </h3>
            {pgServices.length === 0 ? (
              <p className="text-gray-500">No PostgreSQL services found. Configure pg_service.conf first.</p>
            ) : (
              <div className="space-y-2">
                {pgServices.map(svc => (
                  <label
                    key={svc.name}
                    className={`block p-3 rounded-lg border cursor-pointer transition-colors ${
                      selectedPgService === svc.name
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                        : 'border-gray-200 dark:border-gray-700 hover:border-blue-300'
                    }`}
                  >
                    <input
                      type="radio"
                      name="pgService"
                      value={svc.name}
                      checked={selectedPgService === svc.name}
                      onChange={() => setSelectedPgService(svc.name)}
                      className="sr-only"
                    />
                    <div className="font-medium">{svc.name}</div>
                    <div className="text-sm text-gray-500">
                      {svc.user}@{svc.host}:{svc.port}/{svc.dbname}
                    </div>
                  </label>
                ))}
              </div>
            )}
          </div>
        );

      case 'geoserver':
        return (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <FiServer className="text-green-500" />
              Select GeoServer Connection
            </h3>
            {connections.length === 0 ? (
              <p className="text-gray-500">No GeoServer connections found. Add a connection first.</p>
            ) : (
              <div className="space-y-2">
                {connections.map(conn => (
                  <label
                    key={conn.id}
                    className={`block p-3 rounded-lg border cursor-pointer transition-colors ${
                      selectedGeoServer === conn.id
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                        : 'border-gray-200 dark:border-gray-700 hover:border-blue-300'
                    }`}
                  >
                    <input
                      type="radio"
                      name="geoServer"
                      value={conn.id}
                      checked={selectedGeoServer === conn.id}
                      onChange={() => setSelectedGeoServer(conn.id)}
                      className="sr-only"
                    />
                    <div className="font-medium">{conn.id}</div>
                    <div className="text-sm text-gray-500">{conn.url}</div>
                  </label>
                ))}
              </div>
            )}
          </div>
        );

      case 'workspace':
        return (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <FiFolder className="text-yellow-500" />
              Select Target Workspace
            </h3>
            {workspaces.length === 0 ? (
              <p className="text-gray-500">No workspaces found. Create a workspace first.</p>
            ) : (
              <div className="space-y-2">
                {workspaces.map(ws => (
                  <label
                    key={ws.name}
                    className={`block p-3 rounded-lg border cursor-pointer transition-colors ${
                      selectedWorkspace === ws.name
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                        : 'border-gray-200 dark:border-gray-700 hover:border-blue-300'
                    }`}
                  >
                    <input
                      type="radio"
                      name="workspace"
                      value={ws.name}
                      checked={selectedWorkspace === ws.name}
                      onChange={() => setSelectedWorkspace(ws.name)}
                      className="sr-only"
                    />
                    <div className="font-medium">{ws.name}</div>
                  </label>
                ))}
              </div>
            )}
          </div>
        );

      case 'store-name':
        return (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Enter Store Name</h3>
            <input
              type="text"
              value={storeName}
              onChange={e => setStoreName(e.target.value)}
              placeholder="my_postgis_store"
              className="w-full px-4 py-2 border rounded-lg dark:bg-gray-800 dark:border-gray-600"
            />
            <p className="text-sm text-gray-500">
              This will be the name of the PostGIS data store in GeoServer.
            </p>
          </div>
        );

      case 'schema':
        return (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Select PostgreSQL Schema</h3>
            <div className="space-y-2">
              {schemas.map(schema => (
                <label
                  key={schema}
                  className={`block p-3 rounded-lg border cursor-pointer transition-colors ${
                    selectedSchema === schema
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                      : 'border-gray-200 dark:border-gray-700 hover:border-blue-300'
                  }`}
                >
                  <input
                    type="radio"
                    name="schema"
                    value={schema}
                    checked={selectedSchema === schema}
                    onChange={() => setSelectedSchema(schema)}
                    className="sr-only"
                  />
                  <div className="font-medium">{schema}</div>
                </label>
              ))}
            </div>
          </div>
        );

      case 'tables':
        return (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <FiTable className="text-purple-500" />
              Select Tables to Publish
            </h3>
            <p className="text-sm text-gray-500">
              Select spatial tables to automatically publish as layers. Leave empty to create store only.
            </p>
            {tables.length === 0 ? (
              <p className="text-gray-500">No spatial tables found in this schema.</p>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {tables.map(table => (
                  <label
                    key={table}
                    className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                      selectedTables.includes(table)
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                        : 'border-gray-200 dark:border-gray-700 hover:border-blue-300'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedTables.includes(table)}
                      onChange={() => toggleTable(table)}
                      className="rounded"
                    />
                    <span className="font-medium">{table}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        );

      case 'confirm':
        return (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Confirm Bridge Configuration</h3>
            {error && (
              <div className="p-3 bg-red-100 text-red-700 rounded-lg dark:bg-red-900/20 dark:text-red-300">
                {error}
              </div>
            )}
            <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 space-y-2">
              <div className="flex justify-between">
                <span className="text-gray-500">PostgreSQL Service:</span>
                <span className="font-medium">{selectedPgService}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">GeoServer:</span>
                <span className="font-medium">{selectedGeoServer}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Workspace:</span>
                <span className="font-medium">{selectedWorkspace}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Store Name:</span>
                <span className="font-medium">{storeName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Schema:</span>
                <span className="font-medium">{selectedSchema}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Tables to Publish:</span>
                <span className="font-medium">
                  {selectedTables.length > 0 ? selectedTables.join(', ') : '(none)'}
                </span>
              </div>
            </div>
          </div>
        );

      case 'creating':
        return (
          <div className="text-center py-8">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
            <p className="text-gray-500">Creating PostGIS data store...</p>
          </div>
        );

      case 'complete':
        return (
          <div className="text-center py-8">
            <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <FiCheck className="w-6 h-6 text-green-600" />
            </div>
            <h3 className="text-lg font-semibold mb-2">Bridge Created Successfully!</h3>
            <p className="text-gray-500">
              Store '{storeName}' is now available in workspace '{selectedWorkspace}'.
            </p>
          </div>
        );
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold">PostgreSQL to GeoServer Bridge</h2>
            <button
              onClick={onClose}
              className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg"
            >
              <FiX className="w-5 h-5" />
            </button>
          </div>

          {step !== 'creating' && step !== 'complete' && renderStepIndicator()}

          <div className="mb-6">
            {renderStep()}
          </div>

          <div className="flex justify-between">
            {step !== 'pg-service' && step !== 'creating' && step !== 'complete' && (
              <button
                onClick={handleBack}
                className="px-4 py-2 border rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                Back
              </button>
            )}
            {step === 'complete' ? (
              <button
                onClick={onClose}
                className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 ml-auto"
              >
                Close
              </button>
            ) : step !== 'creating' && (
              <button
                onClick={handleNext}
                disabled={
                  (step === 'pg-service' && !selectedPgService) ||
                  (step === 'geoserver' && !selectedGeoServer) ||
                  (step === 'workspace' && !selectedWorkspace) ||
                  (step === 'store-name' && !storeName) ||
                  loading
                }
                className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed ml-auto"
              >
                {step === 'confirm' ? 'Create Bridge' : 'Next'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
