/**
 * HistoryPage.tsx
 * Reads optimization history directly from MongoDB via /api/history.
 * Includes a built-in diff viewer that highlights deleted/added lines.
 */

import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { historyApi, authApi, SessionRecord } from '../api';

// ─────────────────────────────────────────────────────────────
// DIFF ENGINE
// Computes a line-by-line diff between two strings.
// Returns an array of { type: 'same'|'removed'|'added', line: string }
// ─────────────────────────────────────────────────────────────

type DiffLine = { type: 'same' | 'removed' | 'added'; line: string; lineNo: number };

function computeDiff(original: string, optimized: string): DiffLine[] {
  const origLines = original.split('\n');
  const optLines  = optimized.split('\n');

  // Myers diff via LCS (longest common subsequence)
  const m = origLines.length;
  const n = optLines.length;

  // Build LCS table
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (origLines[i - 1] === optLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to build diff
  const result: DiffLine[] = [];
  let i = m, j = n;
  let origNo = m, optNo = n;

  const stack: DiffLine[] = [];

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && origLines[i - 1] === optLines[j - 1]) {
      stack.push({ type: 'same', line: origLines[i - 1], lineNo: i });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      stack.push({ type: 'added', line: optLines[j - 1], lineNo: j });
      j--;
    } else {
      stack.push({ type: 'removed', line: origLines[i - 1], lineNo: i });
      i--;
    }
  }

  return stack.reverse();
}

// ─────────────────────────────────────────────────────────────
// CODE BLOCK  (plain code view with copy button)
// ─────────────────────────────────────────────────────────────

const CodeBlock: React.FC<{ code: string; label: string; accentColor?: string }> = ({ code, label, accentColor = '#64748b' }) => {
  const [copied, setCopied] = useState(false);
  return (
    <div style={{ borderRadius: 8, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.08)' }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '8px 14px', background: 'rgba(255,255,255,0.04)',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
      }}>
        <span style={{ fontSize: 11, color: accentColor, fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 700 }}>{label}</span>
        <button onClick={() => { navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1500); }} style={{
          background: 'none', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6,
          color: copied ? '#63c88c' : '#94a3b8', fontSize: 11, cursor: 'pointer', padding: '3px 10px',
        }}>{copied ? '✓ Copied' : 'Copy'}</button>
      </div>
      <pre style={{
        margin: 0, padding: '14px', background: '#0d1117',
        overflowX: 'auto', fontSize: 12.5, lineHeight: 1.65, color: '#8b9cb8',
        fontFamily: '"Fira Code", "JetBrains Mono", monospace',
        maxHeight: 320, overflowY: 'auto',
      }}>
        {code.split('\n').map((line, i) => (
          <div key={i} style={{ display: 'flex' }}>
            <span style={{ minWidth: 36, marginRight: 16, color: '#334155', textAlign: 'right', userSelect: 'none', flexShrink: 0, fontSize: 11 }}>{i + 1}</span>
            <span style={{ whiteSpace: 'pre' }}>{line || ' '}</span>
          </div>
        ))}
      </pre>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// CODE TABS  — Original | Optimized | Diff
// ─────────────────────────────────────────────────────────────

const CodeTabs: React.FC<{ original: string; optimized: string }> = ({ original, optimized }) => {
  const [activeTab, setActiveTab] = useState<'original' | 'optimized' | 'diff'>('original');

  const tabs = [
    { id: 'original',  label: '📄 Original',  color: '#38bdf8' },
    { id: 'optimized', label: '✅ Optimized',  color: '#63c88c' },
    { id: 'diff',      label: '⚡ Diff',       color: '#f97316' },
  ] as const;

  return (
    <div>
      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 0, borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              background: activeTab === tab.id ? 'rgba(255,255,255,0.06)' : 'none',
              border: 'none',
              borderBottom: activeTab === tab.id ? `2px solid ${tab.color}` : '2px solid transparent',
              color: activeTab === tab.id ? tab.color : '#475569',
              padding: '8px 18px', fontSize: 12, fontWeight: activeTab === tab.id ? 700 : 400,
              cursor: 'pointer', borderRadius: '6px 6px 0 0',
              transition: 'all 0.15s',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div style={{ marginTop: 0 }}>
        {activeTab === 'original'  && <CodeBlock code={original}  label="Original Code"  accentColor="#38bdf8" />}
        {activeTab === 'optimized' && <CodeBlock code={optimized} label="Optimized Code" accentColor="#63c88c" />}
        {activeTab === 'diff'      && <DiffViewer original={original} optimized={optimized} />}
      </div>
    </div>
  );
};



const DiffViewer: React.FC<{ original: string; optimized: string }> = ({ original, optimized }) => {
  const [mode, setMode] = useState<'diff' | 'split'>('diff');
  const [copied, setCopied] = useState<'orig' | 'opt' | null>(null);

  const diffLines = useMemo(() => computeDiff(original, optimized), [original, optimized]);

  const removedCount = diffLines.filter(l => l.type === 'removed').length;
  const addedCount   = diffLines.filter(l => l.type === 'added').length;
  const unchanged    = original === optimized;

  const copy = (text: string, which: 'orig' | 'opt') => {
    navigator.clipboard.writeText(text);
    setCopied(which);
    setTimeout(() => setCopied(null), 1500);
  };

  const btnBase: React.CSSProperties = {
    background: 'none', border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 6, fontSize: 11, cursor: 'pointer', padding: '3px 10px',
  };

  return (
    <div style={{ borderRadius: 10, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.08)', width: '100%', boxSizing: 'border-box' }}>

      {/* Toolbar */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 14px', background: 'rgba(255,255,255,0.04)',
        borderBottom: '1px solid rgba(255,255,255,0.06)', flexWrap: 'wrap', gap: 8,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: '#94a3b8', fontFamily: 'monospace' }}>
            Code Diff
          </span>
          {!unchanged && (
            <div style={{ display: 'flex', gap: 6 }}>
              <span style={{
                fontSize: 11, background: 'rgba(239,68,68,0.15)',
                border: '1px solid rgba(239,68,68,0.3)',
                color: '#f87171', borderRadius: 4, padding: '1px 7px', fontFamily: 'monospace',
              }}>−{removedCount}</span>
              <span style={{
                fontSize: 11, background: 'rgba(34,197,94,0.15)',
                border: '1px solid rgba(34,197,94,0.3)',
                color: '#4ade80', borderRadius: 4, padding: '1px 7px', fontFamily: 'monospace',
              }}>+{addedCount}</span>
            </div>
          )}
          {unchanged && (
            <span style={{ fontSize: 11, color: '#64748b', fontStyle: 'italic' }}>No changes</span>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {/* Mode toggle */}
          <div style={{
            display: 'flex', background: 'rgba(0,0,0,0.3)',
            borderRadius: 6, border: '1px solid rgba(255,255,255,0.08)', overflow: 'hidden',
          }}>
            {(['diff', 'split'] as const).map(m => (
              <button key={m} onClick={() => setMode(m)} style={{
                ...btnBase, border: 'none', borderRadius: 0,
                background: mode === m ? 'rgba(99,200,140,0.15)' : 'none',
                color: mode === m ? '#63c88c' : '#64748b',
                padding: '4px 12px', fontSize: 11,
              }}>
                {m === 'diff' ? '⚡ Unified' : '⬛ Split'}
              </button>
            ))}
          </div>

          <button onClick={() => copy(original, 'orig')} style={{ ...btnBase, color: copied === 'orig' ? '#63c88c' : '#94a3b8' }}>
            {copied === 'orig' ? '✓' : '⎘'} Original
          </button>
          <button onClick={() => copy(optimized, 'opt')} style={{ ...btnBase, color: copied === 'opt' ? '#63c88c' : '#94a3b8' }}>
            {copied === 'opt' ? '✓' : '⎘'} Optimized
          </button>
        </div>
      </div>

      {/* UNIFIED DIFF VIEW */}
      {mode === 'diff' && (
        <div style={{
          background: '#0d1117', maxHeight: 420, overflowY: 'auto', overflowX: 'auto',
          fontFamily: '"Fira Code", "JetBrains Mono", monospace', fontSize: 12.5, lineHeight: 1.6,
        }}>
          {diffLines.map((dl, idx) => {
            const isRemoved = dl.type === 'removed';
            const isAdded   = dl.type === 'added';
            return (
              <div key={idx} style={{
                display: 'flex',
                background: isRemoved
                  ? 'rgba(239,68,68,0.12)'
                  : isAdded
                    ? 'rgba(34,197,94,0.10)'
                    : 'transparent',
                borderLeft: isRemoved
                  ? '3px solid rgba(239,68,68,0.6)'
                  : isAdded
                    ? '3px solid rgba(34,197,94,0.6)'
                    : '3px solid transparent',
              }}>
                {/* Line number */}
                <span style={{
                  minWidth: 42, padding: '0 10px', color: '#334155',
                  borderRight: '1px solid rgba(255,255,255,0.05)',
                  userSelect: 'none', textAlign: 'right', flexShrink: 0,
                  background: isRemoved
                    ? 'rgba(239,68,68,0.08)'
                    : isAdded
                      ? 'rgba(34,197,94,0.06)'
                      : 'rgba(0,0,0,0.2)',
                }}>
                  {dl.lineNo}
                </span>

                {/* Diff symbol */}
                <span style={{
                  width: 22, textAlign: 'center', flexShrink: 0, userSelect: 'none',
                  color: isRemoved ? '#f87171' : isAdded ? '#4ade80' : '#334155',
                  fontWeight: 700,
                }}>
                  {isRemoved ? '−' : isAdded ? '+' : ' '}
                </span>

                {/* Line content */}
                <span style={{
                  padding: '0 12px 0 4px', whiteSpace: 'pre', flex: 1,
                  color: isRemoved
                    ? '#fca5a5'
                    : isAdded
                      ? '#86efac'
                      : '#8b9cb8',
                }}>
                  {dl.line || ' '}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* SPLIT VIEW */}
      {mode === 'split' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', background: '#0d1117', overflow: 'hidden' }}>
          {/* Original */}
          <div style={{ borderRight: '1px solid rgba(255,255,255,0.06)', minWidth: 0, overflow: 'hidden' }}>
            <div style={{
              padding: '6px 12px', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em',
              color: '#f87171', textTransform: 'uppercase',
              background: 'rgba(239,68,68,0.06)', borderBottom: '1px solid rgba(239,68,68,0.15)',
            }}>Original</div>
            <div style={{ maxHeight: 380, overflowY: 'auto', overflowX: 'auto',
              fontFamily: '"Fira Code", "JetBrains Mono", monospace', fontSize: 12, lineHeight: 1.65 }}>
              {original.split('\n').map((line, i) => (
                <div key={i} style={{ display: 'flex', minWidth: 0,
                  background: diffLines.find(d => d.type === 'removed' && d.line === line) ? 'rgba(239,68,68,0.10)' : 'transparent',
                }}>
                  <span style={{ minWidth: 36, padding: '0 8px', color: '#334155', textAlign: 'right',
                    borderRight: '1px solid rgba(255,255,255,0.05)', userSelect: 'none', flexShrink: 0,
                    background: 'rgba(0,0,0,0.2)', fontSize: 11 }}>{i + 1}</span>
                  <span style={{ padding: '0 12px', whiteSpace: 'pre', color: '#8b9cb8', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{line || ' '}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Optimized */}
          <div style={{ minWidth: 0, overflow: 'hidden' }}>
            <div style={{
              padding: '6px 12px', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em',
              color: '#4ade80', textTransform: 'uppercase',
              background: 'rgba(34,197,94,0.06)', borderBottom: '1px solid rgba(34,197,94,0.15)',
            }}>Optimized</div>
            <div style={{ maxHeight: 380, overflowY: 'auto', overflowX: 'auto',
              fontFamily: '"Fira Code", "JetBrains Mono", monospace', fontSize: 12, lineHeight: 1.65 }}>
              {optimized.split('\n').map((line, i) => (
                <div key={i} style={{ display: 'flex', minWidth: 0,
                  background: diffLines.find(d => d.type === 'added' && d.line === line) ? 'rgba(34,197,94,0.08)' : 'transparent',
                }}>
                  <span style={{ minWidth: 36, padding: '0 8px', color: '#334155', textAlign: 'right',
                    borderRight: '1px solid rgba(255,255,255,0.05)', userSelect: 'none', flexShrink: 0,
                    background: 'rgba(0,0,0,0.2)', fontSize: 11 }}>{i + 1}</span>
                  <span style={{ padding: '0 12px', whiteSpace: 'pre', color: '#8b9cb8', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{line || ' '}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// SMALL COMPONENTS  (unchanged from original)
// ─────────────────────────────────────────────────────────────

const MetricBadge: React.FC<{ label: string; value: string | number; accent?: boolean }> = ({ label, value, accent }) => (
  <div style={{
    background: accent ? 'rgba(99,200,140,0.12)' : 'rgba(255,255,255,0.04)',
    border: `1px solid ${accent ? 'rgba(99,200,140,0.3)' : 'rgba(255,255,255,0.08)'}`,
    borderRadius: 8, padding: '6px 12px',
    display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 72,
  }}>
    <span style={{ fontSize: 16, fontWeight: 700, color: accent ? '#63c88c' : '#e2e8f0', fontFamily: 'monospace' }}>{value}</span>
    <span style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: 2 }}>{label}</span>
  </div>
);

const LevelBadge: React.FC<{ level: string }> = ({ level }) => {
  const map: Record<string, { label: string; color: string; bg: string }> = {
    none:   { label: 'Analysis Only', color: '#94a3b8', bg: 'rgba(148,163,184,0.1)' },
    level1: { label: 'Rule-Based',    color: '#60a5fa', bg: 'rgba(96,165,250,0.1)'  },
    level2: { label: 'AI Optimized',  color: '#a78bfa', bg: 'rgba(167,139,250,0.1)' },
  };
  const s = map[level] ?? map['none'];
  return (
    <span style={{
      fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 20,
      color: s.color, background: s.bg, border: `1px solid ${s.color}33`,
      textTransform: 'uppercase', letterSpacing: '0.07em',
    }}>{s.label}</span>
  );
};

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min  = Math.floor(diff / 60_000);
  const hr   = Math.floor(diff / 3_600_000);
  const day  = Math.floor(diff / 86_400_000);
  if (min < 1)  return 'just now';
  if (min < 60) return `${min}m ago`;
  if (hr  < 24) return `${hr}h ago`;
  return `${day}d ago`;
}

// ─────────────────────────────────────────────────────────────
// SESSION CARD
// ─────────────────────────────────────────────────────────────

interface CardProps {
  session: SessionRecord;
  onDelete: (id: string) => void;
  onRename: (id: string, newName: string) => void;
  onStar:   (id: string) => void;
}

const SessionCard: React.FC<CardProps> = ({ session, onDelete, onRename, onStar }) => {
  const [expanded,   setExpanded]   = useState(false);
  const [renaming,   setRenaming]   = useState(false);
  const [nameInput,  setNameInput]  = useState(session.name);
  const [confirmDel, setConfirmDel] = useState(false);
  const [loading,    setLoading]    = useState(false);

  const origMI   = (session.original_analysis  as any)?.maintainability_index ?? null;
  const optMI    = (session.optimized_analysis as any)?.maintainability_index ?? null;
  const origLOC  = (session.original_analysis  as any)?.loc?.code ?? null;
  const optLOC   = (session.optimized_analysis as any)?.loc?.code ?? null;
  const miDelta  = origMI !== null && optMI !== null ? (optMI - origMI).toFixed(1) : null;
  const locDelta = origLOC !== null && optLOC !== null ? optLOC - origLOC : null;

  const handleRenameConfirm = async () => {
    const trimmed = nameInput.trim();
    if (trimmed && trimmed !== session.name) {
      setLoading(true);
      try { await historyApi.rename(session._id, trimmed); onRename(session._id, trimmed); }
      catch { setNameInput(session.name); }
      finally { setLoading(false); }
    }
    setRenaming(false);
  };

  const handleDelete = async () => {
    setLoading(true);
    try { await historyApi.delete(session._id); onDelete(session._id); }
    catch { setLoading(false); setConfirmDel(false); }
  };

  const handleStar = async () => {
    try { await historyApi.toggleStar(session._id); onStar(session._id); }
    catch { /* silent */ }
  };

  return (
    <div style={{
      background: 'rgba(15,20,30,0.8)',
      border: `1px solid ${session.starred ? 'rgba(251,191,36,0.3)' : 'rgba(255,255,255,0.07)'}`,
      borderRadius: 14, overflow: 'hidden',
      opacity: loading ? 0.6 : 1, transition: 'opacity 0.2s',
    }}>
      {/* Header */}
      <div style={{
        padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 12,
        borderBottom: expanded ? '1px solid rgba(255,255,255,0.07)' : 'none',
        cursor: 'pointer',
      }} onClick={() => !renaming && setExpanded(e => !e)}>

        <button onClick={e => { e.stopPropagation(); handleStar(); }} style={{
          background: 'none', border: 'none', cursor: 'pointer', fontSize: 18,
          color: session.starred ? '#fbbf24' : '#334155', flexShrink: 0,
        }}>★</button>

        <div style={{ flex: 1, minWidth: 0 }} onClick={e => e.stopPropagation()}>
          {renaming ? (
            <input autoFocus value={nameInput}
              onChange={e => setNameInput(e.target.value)}
              onBlur={handleRenameConfirm}
              onKeyDown={e => { if (e.key === 'Enter') handleRenameConfirm(); if (e.key === 'Escape') { setNameInput(session.name); setRenaming(false); } }}
              style={{
                background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(99,200,140,0.4)',
                borderRadius: 6, color: '#e2e8f0', fontSize: 14, fontWeight: 600,
                padding: '4px 10px', outline: 'none', width: '100%',
              }}
            />
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {session.name}
              </span>
              <button onClick={e => { e.stopPropagation(); setNameInput(session.name); setRenaming(true); }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: '#475569', padding: 0, flexShrink: 0 }}>
                ✏️
              </button>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <LevelBadge level={session.level} />
          <span style={{ fontSize: 12, color: '#475569' }}>{relativeTime(session.created_at)}</span>

          {confirmDel ? (
            <div style={{ display: 'flex', gap: 6 }} onClick={e => e.stopPropagation()}>
              <button onClick={handleDelete} style={{
                background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.4)',
                color: '#f87171', borderRadius: 6, padding: '3px 10px', fontSize: 12, cursor: 'pointer',
              }}>Delete</button>
              <button onClick={() => setConfirmDel(false)} style={{
                background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                color: '#94a3b8', borderRadius: 6, padding: '3px 10px', fontSize: 12, cursor: 'pointer',
              }}>Cancel</button>
            </div>
          ) : (
            <button onClick={e => { e.stopPropagation(); setConfirmDel(true); }} style={{
              background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: '#334155', padding: 0,
            }}>🗑</button>
          )}

          <span style={{ fontSize: 12, color: '#475569', transform: expanded ? 'rotate(180deg)' : 'none', display: 'inline-block', transition: 'transform 0.2s' }}>▼</span>
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div style={{ padding: '20px' }}>
          {/* Metric badges */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 20 }}>
            {origMI  !== null && <MetricBadge label="Original MI"  value={Number(origMI).toFixed(1)}  />}
            {optMI   !== null && <MetricBadge label="Optimized MI" value={Number(optMI).toFixed(1)}  accent />}
            {miDelta !== null && <MetricBadge label="MI Δ" value={(parseFloat(miDelta) >= 0 ? '+' : '') + miDelta} accent={parseFloat(miDelta) >= 0} />}
            {origLOC !== null && <MetricBadge label="Orig LOC"     value={origLOC} />}
            {optLOC  !== null && <MetricBadge label="Opt LOC"      value={optLOC}  />}
            {locDelta !== null && <MetricBadge label="LOC Δ" value={(locDelta <= 0 ? '' : '+') + locDelta} accent={locDelta <= 0} />}
          </div>

          {/* Changes list */}
          {session.changes.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <p style={{ fontSize: 12, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>Changes Applied</p>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {session.changes.map((c, i) => (
                  <li key={i} style={{ fontSize: 13, color: '#94a3b8', paddingLeft: 14, borderLeft: '2px solid rgba(99,200,140,0.4)' }}>{c}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Error */}
          {session.error && (
            <div style={{
              background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)',
              borderRadius: 8, padding: '10px 14px', marginBottom: 20, fontSize: 13, color: '#fca5a5',
            }}>⚠ {session.error}</div>
          )}

          {/* ── CODE VIEWER: Original | Optimized | Diff tabs ── */}
          <CodeTabs
            original={session.original_code}
            optimized={session.optimized_code}
          />

          <p style={{ marginTop: 14, fontSize: 11, color: '#334155', textAlign: 'right' }}>
            Saved: {new Date(session.created_at).toLocaleString()}
          </p>
        </div>
      )}
    </div>
  );
};


// ─────────────────────────────────────────────────────────────
// MAIN PAGE  (unchanged from original)
// ─────────────────────────────────────────────────────────────

type FilterTab = 'all' | 'starred' | 'level1' | 'level2' | 'analysis';

const HistoryPage: React.FC = () => {
  const navigate = useNavigate();

  const [sessions,     setSessions]     = useState<SessionRecord[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [fetchError,   setFetchError]   = useState<string | null>(null);
  const [searchQuery,  setSearchQuery]  = useState('');
  const [activeFilter, setActiveFilter] = useState<FilterTab>('all');
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    if (!authApi.isLoggedIn()) { navigate('/login'); return; }
    historyApi.getAll()
      .then(data => setSessions(data))
      .catch(err => setFetchError(err.message))
      .finally(() => setLoading(false));
  }, [navigate]);

  const filtered = useMemo(() => {
    let list = sessions;
    if (activeFilter === 'starred')  list = list.filter(s => s.starred);
    if (activeFilter === 'level1')   list = list.filter(s => s.level === 'level1');
    if (activeFilter === 'level2')   list = list.filter(s => s.level === 'level2');
    if (activeFilter === 'analysis') list = list.filter(s => s.level === 'none');
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(s =>
        s.name.toLowerCase().includes(q) ||
        s.original_code.toLowerCase().includes(q) ||
        s.optimized_code.toLowerCase().includes(q) ||
        s.changes.some(c => c.toLowerCase().includes(q))
      );
    }
    return list;
  }, [sessions, searchQuery, activeFilter]);

  const handleDelete = (id: string) => setSessions(prev => prev.filter(s => s._id !== id));
  const handleRename = (id: string, name: string) => setSessions(prev => prev.map(s => s._id === id ? { ...s, name } : s));
  const handleStar   = (id: string) => setSessions(prev => prev.map(s => s._id === id ? { ...s, starred: !s.starred } : s));

  const handleClearAll = async () => {
    for (const s of sessions) {
      try { await historyApi.delete(s._id); } catch { /* continue */ }
    }
    setSessions([]);
    setConfirmClear(false);
  };

  const tabs: { id: FilterTab; label: string; count: number }[] = [
    { id: 'all',      label: 'All',           count: sessions.length },
    { id: 'starred',  label: '★ Starred',     count: sessions.filter(s => s.starred).length },
    { id: 'level1',   label: 'Rule-Based',    count: sessions.filter(s => s.level === 'level1').length },
    { id: 'level2',   label: 'AI Optimized',  count: sessions.filter(s => s.level === 'level2').length },
    { id: 'analysis', label: 'Analysis Only', count: sessions.filter(s => s.level === 'none').length },
  ];

  const page: React.CSSProperties = {
    minHeight: '100vh',
    background: 'linear-gradient(135deg, #050c18 0%, #0a1628 50%, #07101f 100%)',
    fontFamily: '"Inter", "Segoe UI", sans-serif',
    color: '#e2e8f0',
  };

  return (
    <div style={page}>
      <div style={{ maxWidth: 900, margin: '0 auto', padding: '40px 24px' }}>

        {/* Header */}
        <div style={{ marginBottom: 32 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
            <div>
              <h1 style={{
                fontSize: 28, fontWeight: 800, margin: 0,
                background: 'linear-gradient(90deg, #e2e8f0, #94a3b8)',
                WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
              }}>Optimization History</h1>
              <p style={{ fontSize: 14, color: '#475569', margin: '6px 0 0' }}>
                {loading ? 'Loading...' : `${sessions.length} session${sessions.length !== 1 ? 's' : ''} saved to MongoDB`}
              </p>
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <Link to="/profile" style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                color: '#94a3b8', textDecoration: 'none', padding: '8px 16px', borderRadius: 8, fontSize: 13,
              }}>👤 Profile</Link>
              {sessions.length > 0 && (
                confirmClear ? (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={handleClearAll} style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.4)', color: '#f87171', borderRadius: 8, padding: '8px 16px', fontSize: 13, cursor: 'pointer' }}>Confirm Clear All</button>
                    <button onClick={() => setConfirmClear(false)} style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#94a3b8', borderRadius: 8, padding: '8px 16px', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
                  </div>
                ) : (
                  <button onClick={() => setConfirmClear(true)} style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171', borderRadius: 8, padding: '8px 16px', fontSize: 13, cursor: 'pointer' }}>
                    Clear All
                  </button>
                )
              )}
            </div>
          </div>
        </div>

        {/* Error state */}
        {fetchError && (
          <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 10, padding: '16px 20px', marginBottom: 24, color: '#fca5a5', fontSize: 14 }}>
            ⚠ Could not load history: {fetchError}
          </div>
        )}

        {/* Loading skeleton */}
        {loading && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[1, 2, 3].map(i => (
              <div key={i} style={{ height: 64, background: 'rgba(255,255,255,0.03)', borderRadius: 14, border: '1px solid rgba(255,255,255,0.06)' }} />
            ))}
          </div>
        )}

        {!loading && (
          <>
            {/* Search */}
            <div style={{ position: 'relative', marginBottom: 20 }}>
              <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', fontSize: 16, color: '#475569', pointerEvents: 'none' }}>🔍</span>
              <input
                placeholder="Search by name, code, or changes..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                style={{
                  width: '100%', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: 10, color: '#e2e8f0', fontSize: 14, padding: '12px 14px 12px 42px',
                  outline: 'none', boxSizing: 'border-box',
                }}
                onFocus={e => e.target.style.borderColor = 'rgba(99,200,140,0.4)'}
                onBlur={e  => e.target.style.borderColor = 'rgba(255,255,255,0.08)'}
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery('')} style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#475569', cursor: 'pointer', fontSize: 16 }}>×</button>
              )}
            </div>

            {/* Tabs */}
            <div style={{ display: 'flex', gap: 6, marginBottom: 24, flexWrap: 'wrap' }}>
              {tabs.map(tab => (
                <button key={tab.id} onClick={() => setActiveFilter(tab.id)} style={{
                  background: activeFilter === tab.id ? 'rgba(99,200,140,0.15)' : 'rgba(255,255,255,0.04)',
                  border: `1px solid ${activeFilter === tab.id ? 'rgba(99,200,140,0.4)' : 'rgba(255,255,255,0.08)'}`,
                  color: activeFilter === tab.id ? '#63c88c' : '#64748b',
                  borderRadius: 8, padding: '7px 14px', fontSize: 13, cursor: 'pointer',
                  fontWeight: activeFilter === tab.id ? 600 : 400,
                }}>
                  {tab.label}
                  {tab.count > 0 && (
                    <span style={{ marginLeft: 6, fontSize: 11, background: 'rgba(255,255,255,0.08)', borderRadius: 10, padding: '1px 6px', color: '#64748b' }}>{tab.count}</span>
                  )}
                </button>
              ))}
            </div>

            {/* Session list */}
            {sessions.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '80px 24px', background: 'rgba(255,255,255,0.02)', border: '1px dashed rgba(255,255,255,0.08)', borderRadius: 16 }}>
                <div style={{ fontSize: 48, marginBottom: 16 }}>🗂</div>
                <h3 style={{ fontSize: 18, fontWeight: 600, color: '#94a3b8', margin: '0 0 8px' }}>No history yet</h3>
                <p style={{ fontSize: 14, color: '#475569', margin: '0 0 24px' }}>Run your first optimization and it will appear here, saved to MongoDB.</p>
                <Link to="/optimize" style={{ display: 'inline-block', background: 'linear-gradient(135deg, #63c88c, #4ade80)', color: '#0a1628', textDecoration: 'none', padding: '10px 24px', borderRadius: 8, fontSize: 14, fontWeight: 700 }}>
                  Start Optimizing →
                </Link>
              </div>
            ) : filtered.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '60px 24px', color: '#475569', fontSize: 15 }}>
                <div style={{ fontSize: 36, marginBottom: 12 }}>🔍</div>
                No sessions match <strong>"{searchQuery}"</strong>
                <br />
                <button onClick={() => { setSearchQuery(''); setActiveFilter('all'); }} style={{ marginTop: 16, background: 'none', border: 'none', color: '#63c88c', cursor: 'pointer', fontSize: 13, textDecoration: 'underline' }}>
                  Clear filters
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {filtered.map(session => (
                  <SessionCard key={session._id} session={session} onDelete={handleDelete} onRename={handleRename} onStar={handleStar} />
                ))}
              </div>
            )}
          </>
        )}

        <div style={{ height: 60 }} />
      </div>
    </div>
  );
};

export default HistoryPage;