import React, { useState, useEffect } from 'react';
import { FiPlay, FiRefreshCw, FiAlertTriangle, FiCheck, FiCpu, FiDatabase, FiHelpCircle } from 'react-icons/fi';

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

export const AIQueryPanel: React.FC<AIQueryPanelProps> = ({ serviceName, schemaName, onClose }) => {
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<AIQueryResponse | null>(null);
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [showHelp, setShowHelp] = useState(false);
  const [autoExecute, setAutoExecute] = useState(false);

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
    if (!response?.sql) return;

    setLoading(true);

    try {
      const res = await fetch('/api/ai/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sql: response.sql,
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
    <div className="bg-white dark:bg-gray-900 rounded-xl shadow-lg p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold flex items-center gap-2">
          <FiCpu className="text-purple-500" />
          AI Query Engine
        </h2>
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500">
            <FiDatabase className="inline mr-1" />
            {serviceName}{schemaName && `.${schemaName}`}
          </span>
          <button
            onClick={() => setShowHelp(!showHelp)}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg"
            title="Help"
          >
            <FiHelpCircle />
          </button>
        </div>
      </div>

      {/* Provider Status */}
      {!isProviderAvailable && (
        <div className="mb-4 p-3 bg-yellow-100 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-300 rounded-lg flex items-center gap-2">
          <FiAlertTriangle />
          <span>
            Ollama is not running. Please start Ollama with:{' '}
            <code className="bg-yellow-200 dark:bg-yellow-800 px-1 rounded">ollama serve</code>
          </span>
        </div>
      )}

      {/* Help Panel */}
      {showHelp && (
        <div className="mb-4 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
          <h3 className="font-semibold mb-2">How to use</h3>
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
            Ask questions about your data in natural language. The AI will generate SQL queries
            that you can review and execute.
          </p>
          <h4 className="font-medium text-sm mb-2">Example questions:</h4>
          <div className="flex flex-wrap gap-2">
            {exampleQuestions.map((q, i) => (
              <button
                key={i}
                onClick={() => setQuestion(q)}
                className="text-xs px-2 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded hover:bg-blue-200 dark:hover:bg-blue-900/50"
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Question Input */}
      <div className="mb-4">
        <textarea
          value={question}
          onChange={e => setQuestion(e.target.value)}
          placeholder="Ask a question about your data..."
          className="w-full p-3 border rounded-lg dark:bg-gray-800 dark:border-gray-600 resize-none"
          rows={3}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSubmit();
            }
          }}
        />
        <div className="flex items-center justify-between mt-2">
          <label className="flex items-center gap-2 text-sm text-gray-500">
            <input
              type="checkbox"
              checked={autoExecute}
              onChange={e => setAutoExecute(e.target.checked)}
              className="rounded"
            />
            Auto-execute query
          </label>
          <button
            onClick={handleSubmit}
            disabled={loading || !question.trim() || !isProviderAvailable}
            className="px-4 py-2 bg-purple-500 text-white rounded-lg hover:bg-purple-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {loading ? <FiRefreshCw className="animate-spin" /> : <FiPlay />}
            Generate SQL
          </button>
        </div>
      </div>

      {/* Results */}
      {response && (
        <div className="space-y-4">
          {/* Error */}
          {response.error && (
            <div className="p-3 bg-red-100 dark:bg-red-900/20 text-red-700 dark:text-red-300 rounded-lg">
              {response.error}
            </div>
          )}

          {/* Generated SQL */}
          {response.sql && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold flex items-center gap-2">
                  Generated SQL
                  {response.confidence !== undefined && (
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
                {!response.result && (
                  <button
                    onClick={handleExecute}
                    disabled={loading}
                    className="px-3 py-1 bg-green-500 text-white rounded hover:bg-green-600 disabled:opacity-50 flex items-center gap-2 text-sm"
                  >
                    <FiPlay />
                    Execute
                  </button>
                )}
              </div>
              <pre className="p-3 bg-gray-100 dark:bg-gray-800 rounded-lg overflow-x-auto text-sm">
                {response.sql}
              </pre>
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
            <p className="text-sm text-gray-500">
              Total time: {response.duration_ms.toFixed(2)}ms
            </p>
          )}
        </div>
      )}
    </div>
  );
};
