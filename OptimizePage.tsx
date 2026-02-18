import React, { useState } from 'react';
import { auth } from '../auth';
import ErrorReportPanel, { ErrorReport } from './ErrorReportPanel';

interface OptimizationResult {
  original_code: string;
  optimized_code: string;
  optimization_level: string;
  l1_changes?: string[];
  l2?: {
    changes_applied: string[];
    winning_model: string;
  };
  original_analysis: any;
  optimized_analysis: any;
  passed_error_check: boolean;
  error_report?: ErrorReport;
}

const OptimizePage: React.FC = () => {
  const [code, setCode] = useState('');
  const [optimizationLevel, setOptimizationLevel] = useState<1 | 2>(1);
  const [result, setResult] = useState<OptimizationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleOptimize = async () => {
    if (!code.trim()) {
      setError('Please enter Python code to optimize');
      return;
    }

    setLoading(true);
    setError('');
    setResult(null);

    try {
      const response = await fetch('http://localhost:5000/api/analyse', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${auth.getToken()}`,
        },
        body: JSON.stringify({
          code,
          optimization_level: optimizationLevel === 1 ? 'level1' : 'level2'
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to optimize code');
      }

      const data = await response.json();

      // Always store result so ErrorReportPanel can render the details
      setResult(data);
      setError('');

    } catch (err: any) {
      setError(err.message || 'Something went wrong. Make sure the backend is running on port 5000.');
    } finally {
      setLoading(false);
    }
  };

  const handleClearAll = () => {
    setCode('');
    setResult(null);
    setError('');
  };

  const handleCopyOptimized = () => {
    if (result?.optimized_code) {
      navigator.clipboard.writeText(result.optimized_code);
      alert('Optimized code copied to clipboard!');
    }
  };

  const getImprovements = () => {
    if (!result) return [];
    if (optimizationLevel === 1) {
      return result.l1_changes || [];
    } else {
      return result.l2?.changes_applied || [];
    }
  };

  return (
    <div style={{
      padding: '30px',
      maxWidth: '1600px',
      margin: '0 auto',
      background: '#f5f7fa',
      minHeight: 'calc(100vh - 60px)'
    }}>

      {/* Header */}
      <div style={{ marginBottom: '30px' }}>
        <h1 style={{ margin: 0, color: '#121212',marginBottom: '10px' }}>Python Code Optimizer</h1>
        <p style={{ color: '#121212', margin: 0 }}>
          Optimize your Python code with AI-powered analysis and improvements
        </p>
      </div>

      {/* Optimization Level Selector */}
      <div style={{
        background: 'white',
        padding: '20px',
        borderRadius: '10px',
        marginBottom: '20px',
        boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
      }}>
        <label style={{
          display: 'block',
          fontWeight: 'bold',
          color: '#121212',
          marginBottom: '15px',
          fontSize: '1.1rem'
        }}>
          Select Optimization Level:
        </label>

        <div style={{ display: 'flex', gap: '20px' }}>
          {/* Level 1 */}
          <div
            onClick={() => setOptimizationLevel(1)}
            style={{
              flex: 1,
              padding: '20px',
              border: optimizationLevel === 1 ? '3px solid #667eea' : '2px solid #ddd',
              borderRadius: '8px',
              cursor: 'pointer',
              background: optimizationLevel === 1 ? '#f0f4ff' : 'white',
              transition: 'all 0.3s'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: '10px' }}>
              <input
                type="radio"
                checked={optimizationLevel === 1}
                onChange={() => setOptimizationLevel(1)}
                style={{ marginRight: '10px', cursor: 'pointer' }}
              />
              <h3 style={{ margin: 0, color: '#121212' }}>Level 1 - Rule-Based</h3>
            </div>
            <p style={{ margin: 0, color: '#666', fontSize: '0.95rem' }}>
              Fast deterministic optimization using predefined rules and best practices.
              Ideal for quick improvements and code cleanup.
            </p>
            <div style={{ marginTop: '10px', color: '#667eea', fontSize: '0.9rem' }}>
              ⚡ Lightning fast • 🎯 Predictable • 📋 Rule-based
            </div>
          </div>

          {/* Level 2 */}
          <div
            onClick={() => setOptimizationLevel(2)}
            style={{
              flex: 1,
              padding: '20px',
              border: optimizationLevel === 2 ? '3px solid #667eea' : '2px solid #ddd',
              borderRadius: '8px',
              cursor: 'pointer',
              background: optimizationLevel === 2 ? '#f0f4ff' : 'white',
              transition: 'all 0.3s'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: '10px' }}>
              <input
                type="radio"
                checked={optimizationLevel === 2}
                onChange={() => setOptimizationLevel(2)}
                style={{ marginRight: '10px', cursor: 'pointer' }}
              />
              <h3 style={{ margin: 0, color: '#121212' }}>Level 2 - LLM-Powered</h3>
            </div>
            <p style={{ margin: 0, color: '#666', fontSize: '0.95rem' }}>
              Advanced AI-powered optimization with semantic understanding and algorithmic improvements.
              Best for complex refactoring and performance gains.
            </p>
            <div style={{ marginTop: '10px', color: '#667eea', fontSize: '0.9rem' }}>
              🤖 AI-powered • 🧠 Semantic analysis • 🚀 Deep optimization
            </div>
          </div>
        </div>
      </div>

      {/* Network/fetch errors only — not code errors */}
      {error && (
        <div style={{
          padding: '15px',
          background: '#fee',
          color: '#c00',
          borderRadius: '8px',
          marginBottom: '20px',
          border: '1px solid #fcc'
        }}>
          ⚠️ {error}
        </div>
      )}

      {/* ERROR REPORT PANEL — code rejected (syntax / language failure) */}
      {result && !result.passed_error_check && result.error_report && (
        <div style={{ marginBottom: '20px' }}>
          <ErrorReportPanel errorReport={result.error_report} />
        </div>
      )}

      {/* Code Editors */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: result?.passed_error_check ? '1fr 1fr' : '1fr',
        gap: '20px',
        marginBottom: '20px',
        marginTop: '20px'
      }}>
        {/* Input editor */}
        <div style={{
          background: 'white',
          borderRadius: '10px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
          overflow: 'hidden'
        }}>
          <div style={{
            background: '#667eea',
            color: 'white',
            padding: '15px',
            fontWeight: 'bold',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}>
            <span>📝 Your Python Code</span>
            {code && (
              <button
                onClick={handleClearAll}
                style={{
                  background: 'rgba(255,255,255,0.2)',
                  color: 'white',
                  border: 'none',
                  padding: '5px 15px',
                  borderRadius: '5px',
                  cursor: 'pointer',
                  fontSize: '0.9rem'
                }}
              >
                Clear
              </button>
            )}
          </div>
          <textarea
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder={`# Paste your Python code here...\n\ndef example_function():\n    result = []\n    for i in range(10):\n        result.append(i * 2)\n    return result`}
            rows={20}
            style={{
              width: '100%',
              padding: '20px',
              border: 'none',
              fontSize: '14px',
              fontFamily: 'Monaco, Consolas, "Courier New", monospace',
              background: '#1e1e1e',
              color: '#d4d4d4',
              resize: 'vertical',
              boxSizing: 'border-box'
            }}
          />
        </div>

        {/* Output editor — only when code passed all checks */}
        {result?.passed_error_check && (
          <div style={{
            background: 'white',
            borderRadius: '10px',
            boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
            overflow: 'hidden'
          }}>
            <div style={{
              background: '#10b981',
              color: 'white',
              padding: '15px',
              fontWeight: 'bold',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}>
              <span>✨ Optimized Code ({result.optimization_level})</span>
              <button
                onClick={handleCopyOptimized}
                style={{
                  background: 'rgba(255,255,255,0.2)',
                  color: 'white',
                  border: 'none',
                  padding: '5px 15px',
                  borderRadius: '5px',
                  cursor: 'pointer',
                  fontSize: '0.9rem'
                }}
              >
                Copy
              </button>
            </div>
            <textarea
              value={result.optimized_code}
              readOnly
              rows={20}
              style={{
                width: '100%',
                padding: '20px',
                border: 'none',
                fontSize: '14px',
                fontFamily: 'Monaco, Consolas, "Courier New", monospace',
                background: '#1e1e1e',
                color: '#d4d4d4',
                resize: 'vertical',
                boxSizing: 'border-box'
              }}
            />
          </div>
        )}
      </div>

      {/* Action Button */}
      <div style={{ textAlign: 'center', marginBottom: '30px' }}>
        <button
          onClick={handleOptimize}
          disabled={loading || !code.trim()}
          style={{
            padding: '15px 50px',
            background: loading || !code.trim() ? '#ccc' : '#667eea',
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            cursor: loading || !code.trim() ? 'not-allowed' : 'pointer',
            fontSize: '1.2rem',
            fontWeight: 'bold',
            boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
            transition: 'all 0.3s'
          }}
        >
          {loading ? '⏳ Optimizing...' : `🚀 Optimize with Level ${optimizationLevel}`}
        </button>
      </div>

      {/* Results Analytics — only when code passed */}
      {result?.passed_error_check && (
        <div style={{
          background: 'white',
          padding: '30px',
          borderRadius: '10px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
        }}>
          <h2 style={{ marginTop: 0, color: '#121212' }}>📊 Optimization Results</h2>

          {/* WARNINGS PANEL — security / runtime / optimization findings */}
          {result.error_report && (
            <div style={{ marginBottom: '20px' }}>
              <ErrorReportPanel errorReport={result.error_report} warningsOnly />
            </div>
          )}

          {/* Improvements List */}
          <div style={{ marginBottom: '30px', color: '#121212' }}>
            <h3>✨ Improvements Applied:</h3>
            {getImprovements().length > 0 ? (
              <ul style={{ lineHeight: '1.8' }}>
                {getImprovements().map((improvement, idx) => (
                  <li key={idx} style={{ marginBottom: '8px' }}>
                    {improvement}
                  </li>
                ))}
              </ul>
            ) : (
              <p style={{ color: '#666' }}>No changes were needed - your code is already optimal!</p>
            )}
          </div>

          {/* Before / After complexity comparison */}
          {result.original_analysis && result.optimized_analysis && (
            <div style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '20px',
              marginBottom: '30px'
            }}>
              <div style={{
                padding: '20px',
                background: '#fff3cd',
                borderRadius: '8px',
                border: '2px solid #ffc107'
              }}>
                <h4 style={{ marginTop: 0, color: '#121212' }}>⚠️ Before Optimization</h4>
                <p style={{ color: '#121212' }}><strong>Maintainability Index:</strong> {result.original_analysis.maintainability_index?.toFixed(1)} ({result.original_analysis.mi_label})</p>
                <p style={{ color: '#121212' }}><strong>Total Lines:</strong> {result.original_analysis.loc?.total || 'N/A'}</p>
                <p style={{ color: '#121212' }}><strong>Code Lines:</strong> {result.original_analysis.loc?.code || 'N/A'}</p>
                <p style={{ color: '#121212' }}><strong>Comment Lines:</strong> {result.original_analysis.loc?.comment || 'N/A'}</p>
              </div>

              <div style={{
                padding: '20px',
                background: '#d4edda',
                borderRadius: '8px',
                border: '2px solid #28a745'
              }}>
                <h4 style={{ marginTop: 0, color: '#121212' }}>✅ After Optimization</h4>
                <p style={{ color: '#121212' }}><strong>Maintainability Index:</strong> {result.optimized_analysis.maintainability_index?.toFixed(1)} ({result.optimized_analysis.mi_label})</p>
                <p style={{ color: '#121212' }}><strong>Total Lines:</strong> {result.optimized_analysis.loc?.total || 'N/A'}</p>
                <p style={{ color: '#121212' }}><strong>Code Lines:</strong> {result.optimized_analysis.loc?.code || 'N/A'}</p>
                <p style={{ color: '#121212' }}><strong>Comment Lines:</strong> {result.optimized_analysis.loc?.comment || 'N/A'}</p>
              </div>
            </div>
          )}

          {/* LLM model info for Level 2 */}
          {result.l2 && (
            <div style={{
              padding: '15px',
              background: '#e7f3ff',
              borderRadius: '8px',
              border: '1px solid #2196F3',
              marginTop: '20px'
            }}>
              <p style={{ margin: 0, color: '#121212' }}>
                🤖 <strong>AI Model Used:</strong> {result.l2.winning_model}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default OptimizePage;