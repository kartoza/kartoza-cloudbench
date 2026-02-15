import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FiPlay, FiRefreshCw, FiAlertTriangle, FiCheck, FiCpu, FiDatabase, FiHelpCircle, FiEdit2 } from 'react-icons/fi';
import { SQLEditor } from './SQLEditor';
import { springs, staggerContainer, staggerItem, slideUp, expandCollapse } from '../utils/animations';

interface QueryResult {
  columns: { name: string; type: string; nullable: boolean }[];
  rows: Record<string, any>[];
  row_count: number;
  duration_ms: number;
  sql: string;
}

interface AIQueryResponse {
  success: boolean;
  sql?: string;
  explanation?: string;
  confidence?: number;
  warnings?: string[];
  result?: QueryResult;
  error?: string;
  duration_ms?: number;
}

interface ProviderStatus {
  name: string;
  available: boolean;
  active: boolean;
}

interface AIQueryPanelProps {
  serviceName: string;
  schemaName?: string;
  onClose?: () => void;
}

export const AIQueryPanel: React.FC<AIQueryPanelProps> = ({ serviceName, schemaName, onClose: _onClose }) => {
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<AIQueryResponse | null>(null);
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [showHelp, setShowHelp] = useState(false);
  const [autoExecute, setAutoExecute] = useState(false);
  const [editableSQL, setEditableSQL] = useState(false);
  const [customSQL, setCustomSQL] = useState('');

  // Check provider availability
  useEffect(() => {
    fetch('/api/ai/providers')
      .then(res => res.json())
      .then(data => setProviders(data.providers || []))
      .catch(err => console.error('Failed to check providers:', err));
  }, []);

  const activeProvider = providers.find(p => p.active);
  const isProviderAvailable = activeProvider?.available;

  const handleSubmit = async () => {
    if (!question.trim() || loading) return;

    setLoading(true);
    setResponse(null);

    try {
      const res = await fetch('/api/ai/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: question.trim(),
          service_name: serviceName,
          schema_name: schemaName || 'public',
          max_rows: 100,
          execute: autoExecute,
        }),
      });

      const data: AIQueryResponse = await res.json();
      setResponse(data);
    } catch (err) {
      setResponse({
        success: false,
        error: 'Network error: ' + (err as Error).message,
      });
    } finally {
      setLoading(false);
    }
  };

  const handleExecute = async () => {
    const sqlToExecute = editableSQL ? customSQL : response?.sql;
    if (!sqlToExecute) return;

    setLoading(true);

    try {
      const res = await fetch('/api/ai/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sql: sqlToExecute,
          service_name: serviceName,
          max_rows: 100,
        }),
      });

      const data = await res.json();
      if (data.success) {
        setResponse(prev => prev ? { ...prev, result: data.result } : null);
      } else {
        setResponse(prev => prev ? { ...prev, error: data.error } : null);
      }
    } catch (err) {
      setResponse(prev => prev ? { ...prev, error: 'Execution failed: ' + (err as Error).message } : null);
    } finally {
      setLoading(false);
    }
  };

  const exampleQuestions = [
    'Show me all countries with population greater than 1 million',
    'What are the top 10 largest cities by area?',
    'Find all roads that intersect with parks',
    'Count features by type',
    'Show the centroid of all polygons',
  ];

  return (
    <motion.div
      className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl p-6 max-w-4xl mx-auto overflow-hidden"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={springs.default}
    >
      <motion.div
        className="flex items-center justify-between mb-4"
        initial={{ opacity: 0, x: -10 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 0.1, ...springs.snappy }}
      >
        <h2 className="text-xl font-bold flex items-center gap-2">
          <motion.div
            animate={{ rotate: [0, 360] }}
            transition={{ duration: 20, repeat: Infinity, ease: 'linear' }}
          >
            <FiCpu className="text-purple-500" />
          </motion.div>
          AI Query Engine
        </h2>
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500">
            <FiDatabase className="inline mr-1" />
            {serviceName}{schemaName && `.${schemaName}`}
          </span>
          <motion.button
            onClick={() => setShowHelp(!showHelp)}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
            title="Help"
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.95 }}
          >
            <FiHelpCircle />
          </motion.button>
        </div>
      </motion.div>

      {/* Provider Status */}
      <AnimatePresence>
        {!isProviderAvailable && (
          <motion.div
            className="mb-4 p-3 bg-yellow-100 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-300 rounded-xl flex items-center gap-2"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={springs.gentle}
          >
            <motion.div
              animate={{ rotate: [0, 10, -10, 0] }}
              transition={{ duration: 0.5, repeat: Infinity, repeatDelay: 2 }}
            >
              <FiAlertTriangle />
            </motion.div>
            <span>
              Ollama is not running. Please start Ollama with:{' '}
              <code className="bg-yellow-200 dark:bg-yellow-800 px-1 rounded">ollama serve</code>
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Help Panel */}
      <AnimatePresence>
        {showHelp && (
          <motion.div
            className="mb-4 p-4 bg-gray-50 dark:bg-gray-800 rounded-xl overflow-hidden"
            variants={expandCollapse}
            initial="collapsed"
            animate="expanded"
            exit="collapsed"
          >
            <h3 className="font-semibold mb-2">How to use</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
              Ask questions about your data in natural language. The AI will generate SQL queries
              that you can review and execute.
            </p>
            <h4 className="font-medium text-sm mb-2">Example questions:</h4>
            <motion.div
              className="flex flex-wrap gap-2"
              variants={staggerContainer}
              initial="hidden"
              animate="visible"
            >
              {exampleQuestions.map((q, i) => (
                <motion.button
                  key={i}
                  onClick={() => setQuestion(q)}
                  className="text-xs px-3 py-1.5 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-full hover:bg-blue-200 dark:hover:bg-blue-900/50 transition-colors"
                  variants={staggerItem}
                  whileHover={{ scale: 1.05, y: -1 }}
                  whileTap={{ scale: 0.95 }}
                >
                  {q}
                </motion.button>
              ))}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Question Input */}
      <motion.div
        className="mb-4"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.2 }}
      >
        <motion.textarea
          value={question}
          onChange={e => setQuestion(e.target.value)}
          placeholder="Ask a question about your data..."
          className="w-full p-4 border-2 rounded-xl dark:bg-gray-800 dark:border-gray-600 resize-none focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 transition-all"
          rows={3}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSubmit();
            }
          }}
        />
        <div className="flex items-center justify-between mt-3">
          <motion.label
            className="flex items-center gap-2 text-sm text-gray-500 cursor-pointer group"
            whileHover={{ x: 2 }}
          >
            <motion.input
              type="checkbox"
              checked={autoExecute}
              onChange={e => setAutoExecute(e.target.checked)}
              className="rounded border-gray-300 text-purple-500 focus:ring-purple-500"
              whileTap={{ scale: 0.9 }}
            />
            <span className="group-hover:text-gray-700 dark:group-hover:text-gray-300 transition-colors">
              Auto-execute query
            </span>
          </motion.label>
          <motion.button
            onClick={handleSubmit}
            disabled={loading || !question.trim() || !isProviderAvailable}
            className="px-5 py-2.5 bg-gradient-to-r from-purple-500 to-purple-600 text-white rounded-xl shadow-lg shadow-purple-500/25 hover:shadow-purple-500/40 disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none flex items-center gap-2 font-medium transition-shadow"
            whileHover={!loading && question.trim() && isProviderAvailable ? { scale: 1.02 } : undefined}
            whileTap={!loading && question.trim() && isProviderAvailable ? { scale: 0.98 } : undefined}
          >
            {loading ? (
              <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}>
                <FiRefreshCw />
              </motion.div>
            ) : (
              <FiPlay />
            )}
            Generate SQL
          </motion.button>
        </div>
      </motion.div>

      {/* Results */}
      <AnimatePresence>
        {response && (
          <motion.div
            className="space-y-4"
            variants={slideUp}
            initial="hidden"
            animate="visible"
            exit="exit"
          >
            {/* Error */}
            <AnimatePresence>
              {response.error && (
                <motion.div
                  className="p-4 bg-red-100 dark:bg-red-900/20 text-red-700 dark:text-red-300 rounded-xl border border-red-200 dark:border-red-800"
                  initial={{ opacity: 0, y: -10, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1, x: [0, -5, 5, -5, 0] }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ x: { duration: 0.4 } }}
                >
                  {response.error}
                </motion.div>
              )}
            </AnimatePresence>

          {/* Generated SQL */}
          {response.sql && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold flex items-center gap-2">
                  {editableSQL ? 'Custom SQL' : 'Generated SQL'}
                  {!editableSQL && response.confidence !== undefined && (
                    <span className={`text-sm px-2 py-0.5 rounded ${
                      response.confidence >= 0.8
                        ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
                        : response.confidence >= 0.5
                        ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300'
                        : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
                    }`}>
                      {Math.round(response.confidence * 100)}% confidence
                    </span>
                  )}
                </h3>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      if (!editableSQL) {
                        setCustomSQL(response.sql || '');
                      }
                      setEditableSQL(!editableSQL);
                    }}
                    className="text-xs text-blue-500 hover:text-blue-600 flex items-center gap-1"
                  >
                    <FiEdit2 size={12} />
                    {editableSQL ? 'Use Generated' : 'Edit SQL'}
                  </button>
                  <button
                    onClick={handleExecute}
                    disabled={loading}
                    className="px-3 py-1 bg-green-500 text-white rounded hover:bg-green-600 disabled:opacity-50 flex items-center gap-2 text-sm"
                  >
                    <FiPlay />
                    Execute
                  </button>
                </div>
              </div>
              <SQLEditor
                value={editableSQL ? customSQL : response.sql}
                onChange={editableSQL ? setCustomSQL : () => {}}
                height="150px"
                serviceName={serviceName}
                readOnly={!editableSQL}
                placeholder="Edit your SQL query..."
              />
            </div>
          )}

          {/* Warnings */}
          {response.warnings && response.warnings.length > 0 && (
            <div className="p-3 bg-yellow-100 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-300 rounded-lg">
              <div className="font-medium flex items-center gap-2 mb-1">
                <FiAlertTriangle />
                Warnings
              </div>
              <ul className="list-disc list-inside text-sm">
                {response.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Query Results */}
          {response.result && (
            <div>
              <h3 className="font-semibold mb-2 flex items-center gap-2">
                <FiCheck className="text-green-500" />
                Results ({response.result.row_count} rows, {response.result.duration_ms.toFixed(2)}ms)
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="bg-gray-100 dark:bg-gray-800">
                      {response.result.columns.map((col, i) => (
                        <th key={i} className="border p-2 text-left font-medium">
                          {col.name}
                          <span className="text-xs text-gray-400 ml-1">({col.type})</span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {response.result.rows.slice(0, 50).map((row, i) => (
                      <tr key={i} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                        {response.result!.columns.map((col, j) => (
                          <td key={j} className="border p-2 truncate max-w-xs">
                            {row[col.name] !== null ? String(row[col.name]) : <span className="text-gray-400">NULL</span>}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {response.result.row_count > 50 && (
                  <p className="text-sm text-gray-500 mt-2">
                    Showing first 50 of {response.result.row_count} rows
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Timing */}
          {response.duration_ms !== undefined && (
            <motion.p
              className="text-sm text-gray-500"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3 }}
            >
              Total time: {response.duration_ms.toFixed(2)}ms
            </motion.p>
          )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};
