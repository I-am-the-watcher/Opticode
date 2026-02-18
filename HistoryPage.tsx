/**
 * HistoryPage.tsx
 * Reads optimization history directly from MongoDB via /api/history.
 * All data is real — stored per-user, persists across devices.
 */

import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { historyApi, authApi, SessionRecord } from '../api';

// ─────────────────────────────────────────────────────────────
// SMALL COMPONENTS
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

const CodeBlock: React.FC<{ code: string; label: string }> = ({ code, label }) => {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '8px 14px', background: 'rgba(255,255,255,0.04)',
        borderBottom: '1px solid rgba(255,255,255,0.06)', borderRadius: '8px 8px 0 0',
      }}>
        <span style={{ fontSize: 11, color: '#64748b', fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{label}</span>
        <button onClick={() => { navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1500); }} style={{
          background: 'none', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6,
          color: copied ? '#63c88c' : '#94a3b8', fontSize: 11, cursor: 'pointer', padding: '3px 10px',
        }}>{copied ? '✓ Copied' : 'Copy'}</button>
      </div>
      <pre style={{
        margin: 0, padding: '14px', background: 'rgba(0,0,0,0.25)',
        borderRadius: '0 0 8px 8px', overflowX: 'auto', fontSize: 12.5,
        lineHeight: 1.65, color: '#cbd5e1',
        fontFamily: '"Fira Code", "JetBrains Mono", monospace',
        maxHeight: 260, overflowY: 'auto',
        border: '1px solid rgba(255,255,255,0.06)', borderTop: 'none',
      }}>{code || '(no code saved)'}</pre>
    </div>
  );
};

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
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 20 }}>
            {origMI  !== null && <MetricBadge label="Original MI"  value={Number(origMI).toFixed(1)}  />}
            {optMI   !== null && <MetricBadge label="Optimized MI" value={Number(optMI).toFixed(1)}  accent />}
            {miDelta !== null && <MetricBadge label="MI Δ" value={(parseFloat(miDelta) >= 0 ? '+' : '') + miDelta} accent={parseFloat(miDelta) >= 0} />}
            {origLOC !== null && <MetricBadge label="Orig LOC"     value={origLOC} />}
            {optLOC  !== null && <MetricBadge label="Opt LOC"      value={optLOC}  />}
            {locDelta !== null && <MetricBadge label="LOC Δ" value={(locDelta <= 0 ? '' : '+') + locDelta} accent={locDelta <= 0} />}
          </div>

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

          {session.error && (
            <div style={{
              background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)',
              borderRadius: 8, padding: '10px 14px', marginBottom: 20, fontSize: 13, color: '#fca5a5',
            }}>⚠ {session.error}</div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
            <CodeBlock code={session.original_code}  label="Original Code"  />
            <CodeBlock code={session.optimized_code} label="Optimized Code" />
          </div>

          <p style={{ marginTop: 14, fontSize: 11, color: '#334155', textAlign: 'right' }}>
            Saved: {new Date(session.created_at).toLocaleString()}
          </p>
        </div>
      )}
    </div>
  );
};


// ─────────────────────────────────────────────────────────────
// MAIN PAGE
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

  // Load sessions from MongoDB on mount
  useEffect(() => {
    if (!authApi.isLoggedIn()) { navigate('/login'); return; }
    historyApi.getAll()
      .then(data => setSessions(data))
      .catch(err => setFetchError(err.message))
      .finally(() => setLoading(false));
  }, [navigate]);

  // Derived filtered list
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

  // Optimistic handlers — update state immediately, API call runs in background
  const handleDelete = (id: string) => setSessions(prev => prev.filter(s => s._id !== id));
  const handleRename = (id: string, name: string) => setSessions(prev => prev.map(s => s._id === id ? { ...s, name } : s));
  const handleStar   = (id: string) => setSessions(prev => prev.map(s => s._id === id ? { ...s, starred: !s.starred } : s));

  const handleClearAll = async () => {
    // Delete all one by one (simple approach)
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

  // Base styles
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
              <div key={i} style={{ height: 64, background: 'rgba(255,255,255,0.03)', borderRadius: 14, border: '1px solid rgba(255,255,255,0.06)', animation: 'pulse 1.5s infinite' }} />
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