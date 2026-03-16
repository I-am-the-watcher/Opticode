/**
 * AnalyticsPage.tsx
 *
 * Separate /analytics route — deep comparison of original vs optimised code.
 *
 * Charts rendered (all via Recharts):
 *  1. Maintainability Index       — RadialBarChart (gauge-style)
 *  2. Lines of Code breakdown     — Grouped BarChart
 *  3. Halstead metrics            — Radar chart
 *  4. Per-function Cyclomatic CC  — Horizontal BarChart
 *  5. Per-function MI             — LineChart
 *  6. Big-O distribution          — PieChart / DonutChart
 *
 * Data source: /api/history  (latest session) OR sessionStorage passthrough
 * from OptimizePage (key: "analytics_session").
 */

import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  LineChart, Line,
  RadialBarChart, RadialBar,
  PieChart, Pie, Cell,
  LabelList,
} from 'recharts';
import { authApi, historyApi, SessionRecord } from '../api';

// ─────────────────────────────────────────────────────────────────────────────
// DESIGN TOKENS
// ─────────────────────────────────────────────────────────────────────────────
const C = {
  bg:       '#030b17',
  surface:  '#071221',
  border:   'rgba(255,255,255,0.06)',
  borderHi: 'rgba(99,200,140,0.25)',
  orig:     '#38bdf8',   // sky blue  — original
  opt:      '#63c88c',   // mint green — optimised
  accent:   '#f97316',   // orange    — highlight / warning
  purple:   '#a78bfa',
  yellow:   '#fbbf24',
  muted:    '#475569',
  text:     '#e2e8f0',
  subtext:  '#64748b',
};

const FONT = '"JetBrains Mono", "Fira Code", "Cascadia Code", monospace';
const SANS = '"DM Sans", "Segoe UI", system-ui, sans-serif';

// ─────────────────────────────────────────────────────────────────────────────
// SMALL HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function pct(orig: number, opt: number): string {
  if (!orig) return '—';
  const d = ((opt - orig) / orig) * 100;
  const sign = d > 0 ? '+' : '';
  return `${sign}${d.toFixed(1)}%`;
}

function delta(orig: number, opt: number) {
  const d = opt - orig;
  const better = d < 0; // lower is better for most metrics
  return { d, better, sign: d > 0 ? '+' : '' };
}

function miColor(mi: number) {
  if (mi >= 65) return C.opt;
  if (mi >= 40) return C.yellow;
  return C.accent;
}

// ─────────────────────────────────────────────────────────────────────────────
// SHARED CARD
// ─────────────────────────────────────────────────────────────────────────────
const Card: React.FC<{
  title: string; sub?: string; children: React.ReactNode;
  style?: React.CSSProperties; accent?: string;
}> = ({ title, sub, children, style, accent = C.opt }) => (
  <div style={{
    background: C.surface,
    border: `1px solid ${C.border}`,
    borderRadius: 16,
    padding: '24px 26px',
    position: 'relative',
    overflow: 'hidden',
    ...style,
  }}>
    {/* top accent line */}
    <div style={{
      position: 'absolute', top: 0, left: 24, right: 24, height: 2,
      background: `linear-gradient(90deg, ${accent}, transparent)`,
      borderRadius: 1,
    }} />
    <div style={{ marginBottom: 18 }}>
      <p style={{ margin: 0, fontSize: 11, fontWeight: 700, letterSpacing: '0.12em',
        textTransform: 'uppercase', color: C.subtext, fontFamily: SANS }}>
        {title}
      </p>
      {sub && <p style={{ margin: '3px 0 0', fontSize: 12, color: C.muted, fontFamily: SANS }}>{sub}</p>}
    </div>
    {children}
  </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// LEGEND PILL
// ─────────────────────────────────────────────────────────────────────────────
const Pill: React.FC<{ color: string; label: string }> = ({ color, label }) => (
  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6,
    fontSize: 12, color: C.text, fontFamily: SANS }}>
    <span style={{ width: 10, height: 10, borderRadius: 2, background: color, flexShrink: 0 }} />
    {label}
  </span>
);

// custom recharts tooltip
const ChartTip: React.FC<any> = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: '#0d1f35', border: `1px solid ${C.border}`,
      borderRadius: 8, padding: '10px 14px', fontFamily: SANS, fontSize: 12 }}>
      {label && <p style={{ color: C.subtext, marginBottom: 6 }}>{label}</p>}
      {payload.map((p: any, i: number) => (
        <p key={i} style={{ margin: '2px 0', color: p.color || C.text }}>
          {p.name}: <strong>{typeof p.value === 'number' ? p.value.toFixed(2) : p.value}</strong>
        </p>
      ))}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// STAT BADGE  (header summary)
// ─────────────────────────────────────────────────────────────────────────────
const StatBadge: React.FC<{
  label: string; orig: number; opt: number; higherIsBetter?: boolean; unit?: string;
}> = ({ label, orig, opt, higherIsBetter = false, unit = '' }) => {
  const diff = opt - orig;
  const improved = higherIsBetter ? diff > 0 : diff < 0;
  const neutral  = diff === 0;
  const color    = neutral ? C.subtext : improved ? C.opt : C.accent;
  const arrow    = neutral ? '—' : improved ? '▼' : '▲';
  const sign     = diff > 0 ? '+' : '';

  return (
    <div style={{
      background: C.surface, border: `1px solid ${C.border}`,
      borderRadius: 12, padding: '14px 18px', minWidth: 140,
    }}>
      <p style={{ margin: 0, fontSize: 11, color: C.subtext, fontFamily: SANS,
        textTransform: 'uppercase', letterSpacing: '0.1em' }}>{label}</p>
      <p style={{ margin: '6px 0 2px', fontSize: 22, fontWeight: 800,
        color: C.text, fontFamily: FONT }}>
        {orig.toFixed(orig % 1 === 0 ? 0 : 1)}{unit}
      </p>
      <p style={{ margin: 0, fontSize: 12, color, fontFamily: SANS }}>
        {arrow} {sign}{diff.toFixed(diff % 1 === 0 ? 0 : 1)}{unit} after
      </p>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// MAIN PAGE
// ─────────────────────────────────────────────────────────────────────────────

const AnalyticsPage: React.FC = () => {
  const navigate = useNavigate();
  const [session, setSession] = useState<SessionRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const [sessionList, setSessionList] = useState<SessionRecord[]>([]);
  const [selectedId,  setSelectedId]  = useState<string>('');

  // ── load session list ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!authApi.isLoggedIn()) { navigate('/login'); return; }

    historyApi.getAll()
      .then(sessions => {
        if (!sessions.length) { setError('No sessions found. Run an optimization first.'); setLoading(false); return; }
        setSessionList(sessions);

        // prefer session passed from OptimizePage via sessionStorage
        const passedId = sessionStorage.getItem('analytics_session_id');
        const target = passedId
          ? sessions.find(s => s._id === passedId) ?? sessions[0]
          : sessions[0];

        setSelectedId(target._id);
        setSession(target);
        setLoading(false);
      })
      .catch(() => { setError('Could not load sessions.'); setLoading(false); });
  }, [navigate]);

  // ── switch session ─────────────────────────────────────────────────────────
  function pickSession(id: string) {
    const s = sessionList.find(x => x._id === id);
    if (s) { setSession(s); setSelectedId(id); }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // LOADING / ERROR
  // ─────────────────────────────────────────────────────────────────────────
  if (loading) return (
    <div style={{ minHeight: '100vh', background: C.bg, display: 'flex',
      alignItems: 'center', justifyContent: 'center', color: C.subtext, fontFamily: SANS }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>⚙️</div>
        <p>Loading analytics…</p>
      </div>
    </div>
  );

  if (error || !session) return (
    <div style={{ minHeight: '100vh', background: C.bg, display: 'flex',
      alignItems: 'center', justifyContent: 'center', fontFamily: SANS }}>
      <div style={{ textAlign: 'center', maxWidth: 400 }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>📊</div>
        <p style={{ color: C.text, fontSize: 16, marginBottom: 8 }}>{error ?? 'No data available'}</p>
        <Link to="/optimize" style={{
          display: 'inline-block', marginTop: 12,
          background: `linear-gradient(135deg, ${C.opt}, #4ade80)`,
          color: '#0a1628', textDecoration: 'none',
          padding: '10px 22px', borderRadius: 8, fontSize: 13, fontWeight: 700,
        }}>⚡ Run an Optimization</Link>
      </div>
    </div>
  );

  // ─────────────────────────────────────────────────────────────────────────
  // EXTRACT ANALYSIS DATA
  // ─────────────────────────────────────────────────────────────────────────
  const orig = session.original_analysis  as any ?? {};
  const opt  = session.optimized_analysis as any ?? {};

  const oLoc = orig.loc  ?? { total: 0, code: 0, comment: 0, blank: 0 };
  const aLoc = opt.loc   ?? { total: 0, code: 0, comment: 0, blank: 0 };
  const oH   = orig.halstead ?? {};
  const aH   = opt.halstead  ?? {};
  const oFns = (orig.functions ?? []) as any[];
  const aFns = (opt.functions  ?? []) as any[];
  const oMI  = orig.maintainability_index ?? 0;
  const aMI  = opt.maintainability_index  ?? 0;
  const oCC  = orig.total_cyclomatic_complexity ?? 0;
  const aCC  = opt.total_cyclomatic_complexity  ?? 0;
  const oBigO = orig.big_o_distribution ?? {};
  const aBigO = opt.big_o_distribution  ?? {};

  const codeUnchanged = session.original_code === session.optimized_code;

  // ── 1. LOC bar data ────────────────────────────────────────────────────────
  const locData = [
    { name: 'Total',   original: oLoc.total,   optimized: aLoc.total   },
    { name: 'Code',    original: oLoc.code,     optimized: aLoc.code    },
    { name: 'Comment', original: oLoc.comment,  optimized: aLoc.comment },
    { name: 'Blank',   original: oLoc.blank,    optimized: aLoc.blank   },
  ];

  // ── 2. Halstead radar ──────────────────────────────────────────────────────
  // normalise each metric to 0-100 relative to the larger of the two
  function norm(o: number, a: number) {
    const max = Math.max(o, a, 1);
    return { original: +((o / max) * 100).toFixed(1), optimized: +((a / max) * 100).toFixed(1) };
  }
  const radarData = [
    { metric: 'Volume',     ...norm(oH.volume     ?? 0, aH.volume     ?? 0) },
    { metric: 'Difficulty', ...norm(oH.difficulty ?? 0, aH.difficulty ?? 0) },
    { metric: 'Effort',     ...norm(oH.effort     ?? 0, aH.effort     ?? 0) },
    { metric: 'Bugs Est.',  ...norm(oH.bugs_delivered ?? 0, aH.bugs_delivered ?? 0) },
    { metric: 'Operators',  ...norm(oH.distinct_operators ?? 0, aH.distinct_operators ?? 0) },
    { metric: 'Operands',   ...norm(oH.distinct_operands  ?? 0, aH.distinct_operands  ?? 0) },
  ];

  // ── 3. Per-function CC bar ─────────────────────────────────────────────────
  const fnNames = Array.from(new Set([
    ...oFns.map((f: any) => f.name),
    ...aFns.map((f: any) => f.name),
  ]));
  const fnCCData = fnNames.map(name => {
    const of_ = oFns.find((f: any) => f.name === name);
    const af_ = aFns.find((f: any) => f.name === name);
    return {
      name,
      original:  of_?.cyclomatic_complexity ?? 0,
      optimized: af_?.cyclomatic_complexity ?? 0,
    };
  });

  // ── 4. Per-function MI line ────────────────────────────────────────────────
  const fnMIData = fnNames.map(name => {
    const of_ = oFns.find((f: any) => f.name === name);
    const af_ = aFns.find((f: any) => f.name === name);
    return {
      name,
      original:  of_ ? +( of_.maintainability_index ?? 0).toFixed(1) : null,
      optimized: af_ ? +( af_.maintainability_index ?? 0).toFixed(1) : null,
    };
  });

  // ── 5. Big-O donut data ────────────────────────────────────────────────────
  const bigOColors = ['#38bdf8','#63c88c','#a78bfa','#fbbf24','#f97316','#f43f5e'];
  const allBigOKeys = Array.from(new Set([...Object.keys(oBigO), ...Object.keys(aBigO)]));
  const bigOOrigData = allBigOKeys.map((k, i) => ({ name: k, value: oBigO[k] ?? 0, fill: bigOColors[i % bigOColors.length] }));
  const bigOOptData  = allBigOKeys.map((k, i) => ({ name: k, value: aBigO[k] ?? 0, fill: bigOColors[i % bigOColors.length] }));

  // ── 6. MI radial bar ──────────────────────────────────────────────────────
  const miRadialData = [
    { name: 'Optimized', value: +aMI.toFixed(1), fill: miColor(aMI) },
    { name: 'Original',  value: +oMI.toFixed(1), fill: C.orig },
  ];

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100vh', background: C.bg, fontFamily: SANS, color: C.text }}>

      {/* ── subtle grid background ── */}
      <div style={{
        position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0,
        backgroundImage: `
          linear-gradient(rgba(99,200,140,0.03) 1px, transparent 1px),
          linear-gradient(90deg, rgba(99,200,140,0.03) 1px, transparent 1px)
        `,
        backgroundSize: '40px 40px',
      }} />

      <div style={{ position: 'relative', zIndex: 1, maxWidth: 1200, margin: '0 auto', padding: '36px 24px 80px' }}>

        {/* ── PAGE HEADER ── */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
          marginBottom: 32, flexWrap: 'wrap', gap: 16 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
              <span style={{ fontSize: 28 }}>📊</span>
              <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800,
                background: `linear-gradient(90deg, ${C.text}, ${C.subtext})`,
                WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                Code Analytics
              </h1>
            </div>
            <p style={{ margin: 0, fontSize: 13, color: C.subtext }}>
              Deep metric comparison · Original vs Optimised
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            {/* session picker */}
            <select
              value={selectedId}
              onChange={e => pickSession(e.target.value)}
              style={{
                background: C.surface, border: `1px solid ${C.border}`,
                borderRadius: 8, padding: '8px 12px', color: C.text,
                fontSize: 13, fontFamily: SANS, cursor: 'pointer', maxWidth: 260,
              }}
            >
              {sessionList.map(s => (
                <option key={s._id} value={s._id}>{s.name}</option>
              ))}
            </select>
            <Link to="/history" style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              background: 'rgba(99,200,140,0.08)', border: `1px solid ${C.borderHi}`,
              color: C.opt, textDecoration: 'none', padding: '8px 16px',
              borderRadius: 8, fontSize: 13, fontWeight: 600,
            }}>🕐 History</Link>
            <Link to="/optimize" style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              background: `linear-gradient(135deg, ${C.opt}, #4ade80)`,
              color: '#0a1628', textDecoration: 'none', padding: '8px 16px',
              borderRadius: 8, fontSize: 13, fontWeight: 700,
            }}>⚡ Optimize</Link>
          </div>
        </div>

        {/* ── SESSION META ── */}
        <div style={{
          background: C.surface, border: `1px solid ${C.border}`,
          borderRadius: 12, padding: '14px 20px', marginBottom: 28,
          display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'center',
        }}>
          <span style={{ fontSize: 12, color: C.subtext }}>
            Session: <strong style={{ color: C.text }}>{session.name}</strong>
          </span>
          <span style={{ fontSize: 12, color: C.subtext }}>
            Level: <strong style={{ color: C.purple }}>
              {session.level === 'none' ? 'Analysis only' : session.level === 'level1' ? 'Rule-Based' : 'AI (Level 2)'}
            </strong>
          </span>
          <span style={{ fontSize: 12, color: C.subtext }}>
            Date: <strong style={{ color: C.text }}>
              {new Date(session.created_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}
            </strong>
          </span>
          {codeUnchanged && (
            <span style={{ fontSize: 11, background: 'rgba(251,191,36,0.12)',
              border: '1px solid rgba(251,191,36,0.3)', color: C.yellow,
              borderRadius: 6, padding: '3px 10px' }}>
              ⚠ Code unchanged — metrics are identical
            </span>
          )}
        </div>

        {/* ── SUMMARY BADGES ── */}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 36 }}>
          <StatBadge label="Maintainability"  orig={oMI}  opt={aMI}  higherIsBetter unit="" />
          <StatBadge label="Cyclomatic CC"    orig={oCC}  opt={aCC}  higherIsBetter={false} />
          <StatBadge label="Lines of Code"    orig={oLoc.total} opt={aLoc.total} higherIsBetter={false} />
          <StatBadge label="Halstead Volume"  orig={oH.volume ?? 0} opt={aH.volume ?? 0} higherIsBetter={false} />
          <StatBadge label="Est. Bugs"        orig={+(oH.bugs_delivered ?? 0).toFixed(2)} opt={+(aH.bugs_delivered ?? 0).toFixed(2)} higherIsBetter={false} />
        </div>

        {/* ── ROW 1: MI Gauge + Halstead Radar ── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px,1fr))', gap: 20, marginBottom: 20 }}>

          {/* MI Radial Gauge */}
          <Card title="Maintainability Index" sub="Higher = more maintainable (0 – 100)" accent={miColor(aMI)}>
            <div style={{ display: 'flex', justifyContent: 'center', gap: 32, marginBottom: 12, flexWrap: 'wrap' }}>
              <div style={{ textAlign: 'center' }}>
                <p style={{ margin: 0, fontSize: 11, color: C.subtext, fontFamily: SANS }}>ORIGINAL</p>
                <p style={{ margin: '4px 0 0', fontSize: 36, fontWeight: 800, color: C.orig, fontFamily: FONT }}>{oMI.toFixed(1)}</p>
                <p style={{ margin: 0, fontSize: 11, color: C.subtext }}>{orig.mi_label ?? '—'}</p>
              </div>
              <div style={{ textAlign: 'center' }}>
                <p style={{ margin: 0, fontSize: 11, color: C.subtext, fontFamily: SANS }}>OPTIMISED</p>
                <p style={{ margin: '4px 0 0', fontSize: 36, fontWeight: 800, color: miColor(aMI), fontFamily: FONT }}>{aMI.toFixed(1)}</p>
                <p style={{ margin: 0, fontSize: 11, color: C.subtext }}>{opt.mi_label ?? '—'}</p>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={200}>
              <RadialBarChart
                cx="50%" cy="100%"
                innerRadius="60%" outerRadius="110%"
                startAngle={180} endAngle={0}
                data={miRadialData}
              >
                <RadialBar dataKey="value" cornerRadius={6} background={{ fill: 'rgba(255,255,255,0.04)' }} />
                <Tooltip content={<ChartTip />} />
              </RadialBarChart>
            </ResponsiveContainer>
            <div style={{ display: 'flex', justifyContent: 'center', gap: 20, marginTop: 4 }}>
              <Pill color={C.orig} label="Original" />
              <Pill color={miColor(aMI)} label="Optimised" />
            </div>
          </Card>

          {/* Halstead Radar */}
          <Card title="Halstead Metrics Comparison" sub="Normalised to 100 — lower = less complex" accent={C.purple}>
            <div style={{ display: 'flex', justifyContent: 'center', gap: 20, marginBottom: 8 }}>
              <Pill color={C.orig} label="Original" />
              <Pill color={C.opt}  label="Optimised" />
            </div>
            <ResponsiveContainer width="100%" height={260}>
              <RadarChart data={radarData}>
                <PolarGrid stroke={C.border} />
                <PolarAngleAxis dataKey="metric" tick={{ fill: C.subtext, fontSize: 11, fontFamily: SANS }} />
                <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
                <Radar name="Original"  dataKey="original"  stroke={C.orig} fill={C.orig} fillOpacity={0.15} strokeWidth={2} />
                <Radar name="Optimised" dataKey="optimized" stroke={C.opt}  fill={C.opt}  fillOpacity={0.15} strokeWidth={2} />
                <Tooltip content={<ChartTip />} />
              </RadarChart>
            </ResponsiveContainer>
          </Card>
        </div>

        {/* ── ROW 2: LOC Grouped Bar + CC Horizontal Bar ── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px,1fr))', gap: 20, marginBottom: 20 }}>

          {/* LOC Grouped Bar */}
          <Card title="Lines of Code Breakdown" sub="Total · Logical · Comments · Blank" accent={C.orig}>
            <div style={{ display: 'flex', gap: 16, marginBottom: 12 }}>
              <Pill color={C.orig} label="Original" />
              <Pill color={C.opt}  label="Optimised" />
            </div>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={locData} barCategoryGap="30%" barGap={4}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false} />
                <XAxis dataKey="name" tick={{ fill: C.subtext, fontSize: 12, fontFamily: SANS }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: C.subtext, fontSize: 11, fontFamily: FONT }} axisLine={false} tickLine={false} />
                <Tooltip content={<ChartTip />} />
                <Bar dataKey="original"  name="Original"  fill={C.orig} radius={[4,4,0,0]} />
                <Bar dataKey="optimized" name="Optimised" fill={C.opt}  radius={[4,4,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </Card>

          {/* Cyclomatic CC per function horizontal bars */}
          <Card title="Cyclomatic Complexity per Function" sub="McCabe CC — lower is simpler" accent={C.accent}>
            {fnCCData.length === 0 ? (
              <p style={{ color: C.muted, fontSize: 13, textAlign: 'center', paddingTop: 60 }}>No functions detected</p>
            ) : (
              <>
                <div style={{ display: 'flex', gap: 16, marginBottom: 12 }}>
                  <Pill color={C.orig} label="Original" />
                  <Pill color={C.opt}  label="Optimised" />
                </div>
                <ResponsiveContainer width="100%" height={Math.max(200, fnCCData.length * 52)}>
                  <BarChart data={fnCCData} layout="vertical" barCategoryGap="25%" barGap={3}>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.border} horizontal={false} />
                    <XAxis type="number" tick={{ fill: C.subtext, fontSize: 11, fontFamily: FONT }} axisLine={false} tickLine={false} />
                    <YAxis type="category" dataKey="name" width={110}
                      tick={{ fill: C.text, fontSize: 12, fontFamily: FONT }} axisLine={false} tickLine={false} />
                    <Tooltip content={<ChartTip />} />
                    <Bar dataKey="original"  name="Original"  fill={C.orig} radius={[0,4,4,0]}>
                      <LabelList dataKey="original"  position="right" style={{ fill: C.orig, fontSize: 11, fontFamily: FONT }} />
                    </Bar>
                    <Bar dataKey="optimized" name="Optimised" fill={C.opt}  radius={[0,4,4,0]}>
                      <LabelList dataKey="optimized" position="right" style={{ fill: C.opt,  fontSize: 11, fontFamily: FONT }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </>
            )}
          </Card>
        </div>

        {/* ── ROW 3: MI per function Line + Big-O Donuts ── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px,1fr))', gap: 20, marginBottom: 20 }}>

          {/* MI per function line */}
          <Card title="Maintainability Index per Function" sub="Line trend across all functions" accent={C.yellow}>
            {fnMIData.length === 0 ? (
              <p style={{ color: C.muted, fontSize: 13, textAlign: 'center', paddingTop: 60 }}>No functions detected</p>
            ) : (
              <>
                <div style={{ display: 'flex', gap: 16, marginBottom: 12 }}>
                  <Pill color={C.orig} label="Original" />
                  <Pill color={C.opt}  label="Optimised" />
                </div>
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={fnMIData} margin={{ left: 0, right: 16 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                    <XAxis dataKey="name" tick={{ fill: C.subtext, fontSize: 11, fontFamily: FONT }} axisLine={false} tickLine={false} />
                    <YAxis domain={[0, 100]} tick={{ fill: C.subtext, fontSize: 11, fontFamily: FONT }} axisLine={false} tickLine={false} />
                    <Tooltip content={<ChartTip />} />
                    <Line type="monotone" dataKey="original"  name="Original"  stroke={C.orig} strokeWidth={2} dot={{ r: 4, fill: C.orig }} connectNulls />
                    <Line type="monotone" dataKey="optimized" name="Optimised" stroke={C.opt}  strokeWidth={2} dot={{ r: 4, fill: C.opt  }} connectNulls strokeDasharray="5 3" />
                  </LineChart>
                </ResponsiveContainer>
              </>
            )}
          </Card>

          {/* Big-O distribution donuts */}
          <Card title="Time Complexity Distribution" sub="Big-O class breakdown across all functions" accent={C.purple}>
            {allBigOKeys.length === 0 ? (
              <p style={{ color: C.muted, fontSize: 13, textAlign: 'center', paddingTop: 60 }}>No functions detected</p>
            ) : (
              <div style={{ display: 'flex', gap: 16, justifyContent: 'space-around', flexWrap: 'wrap' }}>
                {/* original donut */}
                <div style={{ textAlign: 'center' }}>
                  <p style={{ margin: '0 0 4px', fontSize: 11, color: C.subtext, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Original</p>
                  <PieChart width={170} height={170}>
                    <Pie data={bigOOrigData} cx={85} cy={85} innerRadius={42} outerRadius={72}
                      dataKey="value" paddingAngle={3}>
                      {bigOOrigData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                    </Pie>
                    <Tooltip content={<ChartTip />} />
                  </PieChart>
                </div>
                {/* optimised donut */}
                <div style={{ textAlign: 'center' }}>
                  <p style={{ margin: '0 0 4px', fontSize: 11, color: C.subtext, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Optimised</p>
                  <PieChart width={170} height={170}>
                    <Pie data={bigOOptData} cx={85} cy={85} innerRadius={42} outerRadius={72}
                      dataKey="value" paddingAngle={3}>
                      {bigOOptData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                    </Pie>
                    <Tooltip content={<ChartTip />} />
                  </PieChart>
                </div>
                {/* shared legend */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, justifyContent: 'center' }}>
                  {allBigOKeys.map((k, i) => (
                    <Pill key={k} color={bigOColors[i % bigOColors.length]} label={k} />
                  ))}
                </div>
              </div>
            )}
          </Card>
        </div>

        {/* ── ROW 4: Raw Halstead table ── */}
        <Card title="Halstead Metrics — Raw Values" sub="Exact numbers from the analysis engine" accent={C.subtext}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: FONT, fontSize: 13 }}>
              <thead>
                <tr>
                  {['Metric','Original','Optimised','Delta','Better?'].map(h => (
                    <th key={h} style={{ textAlign: h === 'Metric' ? 'left' : 'right',
                      padding: '8px 14px', color: C.subtext, fontWeight: 600,
                      borderBottom: `1px solid ${C.border}`, fontFamily: SANS, fontSize: 11,
                      textTransform: 'uppercase', letterSpacing: '0.08em' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[
                  { label: 'Distinct Operators', oVal: oH.distinct_operators, aVal: aH.distinct_operators, lowerBetter: true },
                  { label: 'Distinct Operands',  oVal: oH.distinct_operands,  aVal: aH.distinct_operands,  lowerBetter: true },
                  { label: 'Total Operators',    oVal: oH.total_operators,    aVal: aH.total_operators,    lowerBetter: true },
                  { label: 'Total Operands',     oVal: oH.total_operands,     aVal: aH.total_operands,     lowerBetter: true },
                  { label: 'Vocabulary',         oVal: oH.vocabulary,         aVal: aH.vocabulary,         lowerBetter: true },
                  { label: 'Length',             oVal: oH.length,             aVal: aH.length,             lowerBetter: true },
                  { label: 'Volume',             oVal: oH.volume,             aVal: aH.volume,             lowerBetter: true },
                  { label: 'Difficulty',         oVal: oH.difficulty,         aVal: aH.difficulty,         lowerBetter: true },
                  { label: 'Effort',             oVal: oH.effort,             aVal: aH.effort,             lowerBetter: true },
                  { label: 'Est. Bugs',          oVal: oH.bugs_delivered,     aVal: aH.bugs_delivered,     lowerBetter: true },
                ].map(row => {
                  const o = +(row.oVal ?? 0);
                  const a = +(row.aVal ?? 0);
                  const d = a - o;
                  const improved = row.lowerBetter ? d < 0 : d > 0;
                  const neutral  = d === 0;
                  const dColor   = neutral ? C.subtext : improved ? C.opt : C.accent;
                  return (
                    <tr key={row.label} style={{ borderBottom: `1px solid ${C.border}` }}>
                      <td style={{ padding: '9px 14px', color: C.text }}>{row.label}</td>
                      <td style={{ padding: '9px 14px', color: C.orig, textAlign: 'right' }}>{o.toFixed(2)}</td>
                      <td style={{ padding: '9px 14px', color: C.opt,  textAlign: 'right' }}>{a.toFixed(2)}</td>
                      <td style={{ padding: '9px 14px', color: dColor, textAlign: 'right' }}>
                        {d > 0 ? '+' : ''}{d.toFixed(2)}
                      </td>
                      <td style={{ padding: '9px 14px', textAlign: 'right' }}>
                        {neutral ? <span style={{ color: C.subtext }}>—</span>
                          : improved
                            ? <span style={{ color: C.opt }}>✓ Yes</span>
                            : <span style={{ color: C.accent }}>✗ No</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

      </div>
    </div>
  );
};

export default AnalyticsPage;