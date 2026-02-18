/**
 * ErrorReportPanel.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Renders the full `error_report` object returned by the Flask /api/analyse
 * endpoint (produced by error_checker.py) with:
 *   • language / syntax rejection reason + fix tip
 *   • per-issue security warnings with line references
 *   • runtime risk warnings with line references
 *   • optimization findings with line references
 *
 * DROP-IN USAGE (in OptimizePage or wherever results are displayed):
 *
 *   import ErrorReportPanel from './ErrorReportPanel';
 *
 *   // apiResult is the full JSON from POST /api/analyse
 *   {apiResult && !apiResult.passed_error_check && (
 *     <ErrorReportPanel errorReport={apiResult.error_report} />
 *   )}
 *
 *   // Show warnings even when code passes (security / runtime / optimization)
 *   {apiResult?.passed_error_check && (
 *     <ErrorReportPanel errorReport={apiResult.error_report} warningsOnly />
 *   )}
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

import React, { useState } from 'react';

// ── Types mirroring error_checker.py output ───────────────────────────────────

interface LanguageCheck {
  is_python: boolean;
  reason: string;
}

interface OptimizationFinding {
  type: 'nested_loop' | 'large_function' | 'nested_binary_operation';
  line: number | string;
  name?: string;
  suggestion: string;
}

interface OptimizationReport {
  optimizable: boolean;
  finding_count: number;
  findings: OptimizationFinding[];
}

export interface ErrorReport {
  language?: LanguageCheck;
  syntax?: string;           // "OK" or error string
  security?: string[];
  runtime_risks?: string[];
  optimization?: OptimizationReport;
  aborted?: string;
}

interface Props {
  errorReport: ErrorReport;
  /** If true, suppresses the "aborted" banner and only shows warnings */
  warningsOnly?: boolean;
}

// ── Fix suggestions keyed to common error patterns ────────────────────────────

const SYNTAX_FIXES: Array<{ pattern: RegExp; tip: string }> = [
  { pattern: /unexpected indent/i,      tip: 'Check your indentation — Python uses 4 spaces. Mixed tabs/spaces cause this.' },
  { pattern: /expected :/i,             tip: 'Add a colon `:` at the end of your `if`, `for`, `def`, or `class` statement.' },
  { pattern: /invalid syntax/i,         tip: 'Look at the line and the one above it — a missing bracket, comma, or operator is likely.' },
  { pattern: /EOL while scanning/i,     tip: 'A string literal is not closed. Find the opening quote and add the matching closing quote.' },
  { pattern: /EOF while parsing/i,      tip: 'A bracket or parenthesis is never closed. Check all `(`, `[`, `{` have matching closing pairs.' },
  { pattern: /unindent does not match/i,tip: 'Indentation is inconsistent. Ensure every block uses the same number of spaces.' },
  { pattern: /name .+ is not defined/i, tip: 'Variable used before assignment, or a typo in the name. Check spelling and scope.' },
];

function getSyntaxTip(errorMsg: string): string {
  for (const { pattern, tip } of SYNTAX_FIXES) {
    if (pattern.test(errorMsg)) return tip;
  }
  return 'Review the flagged line and the line immediately before it for missing punctuation or mismatched brackets.';
}

const SECURITY_FIXES: Record<string, string> = {
  'os':         'Replace `os.system()` with the `subprocess` module (already blocked) or a pure-Python alternative.',
  'sys':        'Avoid direct `sys` manipulation in shared code. Use function parameters instead of `sys.argv` directly.',
  'subprocess': 'Avoid spawning subprocesses. Use Python libraries that wrap the same functionality safely.',
  'shutil':     'Prefer `pathlib.Path` for file operations and validate all paths before use.',
  'socket':     'Avoid raw socket usage. Use `urllib`, `httpx`, or `requests` for network calls.',
  'ctypes':     'Direct memory access via `ctypes` is disallowed. Use pure Python or an approved C-extension.',
  'eval':       'Replace `eval()` with `ast.literal_eval()` for safe expression parsing, or restructure your logic.',
  'exec':       'Replace `exec()` with explicit function calls or a plugin architecture.',
  'open':       'File I/O via `open()` is restricted here. Pass data as strings/bytes instead.',
  'compile':    'Dynamic code compilation is disallowed. Define logic statically.',
  '__import__': 'Use explicit `import` statements at the top of the module instead of `__import__()`.',
};

function getSecurityTip(issue: string): string {
  for (const [key, tip] of Object.entries(SECURITY_FIXES)) {
    if (issue.toLowerCase().includes(key.toLowerCase())) return tip;
  }
  return 'Remove or replace the flagged construct with a safer alternative.';
}

const RUNTIME_FIXES: Record<string, string> = {
  'infinite loop':       'Add a `break` condition or a counter that limits iterations.',
  'division by zero':    'Guard the division: `if denominator != 0: result = a / denominator`.',
  'infinite recursion':  'Add a base-case `if` at the top of the function that returns without recursing.',
  'unreachable code':    'Remove statements that appear after `return` in the same block — they will never execute.',
};

function getRuntimeTip(warning: string): string {
  for (const [key, tip] of Object.entries(RUNTIME_FIXES)) {
    if (warning.toLowerCase().includes(key)) return tip;
  }
  return 'Review the flagged line for logic errors that could cause unexpected runtime behaviour.';
}

const OPT_FIXES: Record<string, string> = {
  nested_loop:             'Consider replacing inner loops with set/dict lookups, numpy operations, or list comprehensions.',
  large_function:          'Extract logical sub-tasks into smaller helper functions, each with a single responsibility.',
  nested_binary_operation: 'Assign repeated sub-expressions to a variable and reuse it to avoid redundant computation.',
};

// ── Line-number extraction ────────────────────────────────────────────────────

function extractLine(text: string): string | null {
  const m = text.match(/line\s+(\d+)/i);
  return m ? m[1] : null;
}

// ── Sub-components ────────────────────────────────────────────────────────────

interface IssueCardProps {
  icon: string;
  badge: string;
  badgeColor: string;
  line?: string | number | null;
  title: string;
  fix: string;
  defaultOpen?: boolean;
}

const IssueCard: React.FC<IssueCardProps> = ({
  icon, badge, badgeColor, line, title, fix, defaultOpen = false,
}) => {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div
      style={{
        background: '#111',
        border: '1px solid #222',
        borderRadius: 8,
        marginBottom: 8,
        overflow: 'hidden',
        fontFamily: "'JetBrains Mono', monospace",
      }}
    >
      {/* Header row */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '10px 14px',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
          color: '#e5e7eb',
        }}
      >
        <span style={{ fontSize: 16 }}>{icon}</span>

        {/* Badge */}
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: '0.08em',
            padding: '2px 7px',
            borderRadius: 4,
            background: badgeColor,
            color: '#000',
            flexShrink: 0,
          }}
        >
          {badge}
        </span>

        {/* Line pill */}
        {line != null && (
          <span
            style={{
              fontSize: 11,
              color: '#6b7280',
              background: '#1a1a1a',
              border: '1px solid #333',
              borderRadius: 4,
              padding: '1px 7px',
              flexShrink: 0,
            }}
          >
            line {line}
          </span>
        )}

        {/* Title */}
        <span style={{ fontSize: 12, flex: 1, color: '#d1d5db', lineHeight: 1.4 }}>
          {title}
        </span>

        {/* Chevron */}
        <span
          style={{
            color: '#6b7280',
            fontSize: 12,
            transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.2s',
            flexShrink: 0,
          }}
        >
          ▾
        </span>
      </button>

      {/* Fix panel */}
      {open && (
        <div
          style={{
            padding: '10px 14px 12px 44px',
            borderTop: '1px solid #1e1e1e',
            background: '#0d0d0d',
          }}
        >
          <div
            style={{
              fontSize: 11,
              color: '#94a3b8',
              marginBottom: 4,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              fontWeight: 600,
            }}
          >
            💡 How to fix
          </div>
          <div style={{ fontSize: 12, color: '#cbd5e1', lineHeight: 1.6 }}>
            {fix}
          </div>
        </div>
      )}
    </div>
  );
};

// ── Section header ────────────────────────────────────────────────────────────

const SectionHeader: React.FC<{ label: string; count?: number; color?: string }> = ({
  label, count, color = '#3b82f6',
}) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      marginBottom: 10,
      marginTop: 16,
    }}
  >
    <div
      style={{
        width: 3,
        height: 16,
        background: color,
        borderRadius: 2,
        flexShrink: 0,
      }}
    />
    <span
      style={{
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        color: '#9ca3af',
        fontFamily: "'JetBrains Mono', monospace",
      }}
    >
      {label}
    </span>
    {count !== undefined && (
      <span
        style={{
          fontSize: 10,
          background: '#1f2937',
          color: '#6b7280',
          borderRadius: 10,
          padding: '1px 7px',
          fontFamily: "'JetBrains Mono', monospace",
        }}
      >
        {count}
      </span>
    )}
  </div>
);

// ── Main component ────────────────────────────────────────────────────────────

const ErrorReportPanel: React.FC<Props> = ({ errorReport, warningsOnly = false }) => {
  const {
    language,
    syntax,
    security = [],
    runtime_risks = [],
    optimization,
    aborted,
  } = errorReport;

  const isAborted = !!aborted && !warningsOnly;
  const hasSecurityIssues = security.length > 0;
  const hasRuntimeRisks = runtime_risks.length > 0;
  const hasOptFindings = (optimization?.findings?.length ?? 0) > 0;
  const hasAnything = isAborted || hasSecurityIssues || hasRuntimeRisks || hasOptFindings;

  if (!hasAnything) return null;

  return (
    <div
      style={{
        background: '#0a0a0a',
        border: `1px solid ${isAborted ? '#7f1d1d' : '#1f2937'}`,
        borderRadius: 12,
        padding: '16px 18px',
        marginTop: 16,
        fontFamily: "'JetBrains Mono', monospace",
      }}
    >

      {/* ── Panel header ── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          marginBottom: 14,
          paddingBottom: 12,
          borderBottom: '1px solid #1e1e1e',
        }}
      >
        <span style={{ fontSize: 18 }}>{isAborted ? '🚫' : '⚠️'}</span>
        <div>
          <div
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: isAborted ? '#fca5a5' : '#fbbf24',
              letterSpacing: '0.05em',
            }}
          >
            {isAborted ? 'Code Rejected' : 'Warnings Detected'}
          </div>
          {aborted && !warningsOnly && (
            <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
              {aborted}
            </div>
          )}
        </div>

        {/* Summary pill counts */}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          {isAborted && (
            <span style={{ ...pillStyle, background: '#7f1d1d', color: '#fca5a5' }}>
              ✗ blocked
            </span>
          )}
          {hasSecurityIssues && (
            <span style={{ ...pillStyle, background: '#1c1917', color: '#fb923c' }}>
              🔒 {security.length} security
            </span>
          )}
          {hasRuntimeRisks && (
            <span style={{ ...pillStyle, background: '#1e1b4b', color: '#a78bfa' }}>
              ⚡ {runtime_risks.length} runtime
            </span>
          )}
          {hasOptFindings && (
            <span style={{ ...pillStyle, background: '#14532d', color: '#86efac' }}>
              ⚙ {optimization!.finding_count} opt
            </span>
          )}
        </div>
      </div>

      {/* ── Language rejection ── */}
      {!warningsOnly && language && !language.is_python && (
        <>
          <SectionHeader label="Language / Syntax" color="#ef4444" />
          <IssueCard
            icon="🔴"
            badge="REJECTED"
            badgeColor="#ef4444"
            title={language.reason}
            fix="Ensure you are submitting Python code. If your code is Python, check for non-Python keywords or copy-paste artifacts."
            defaultOpen
          />
        </>
      )}

      {/* ── Syntax error ── */}
      {!warningsOnly && syntax && syntax !== 'OK' && (
        <>
          <SectionHeader label="Syntax Error" color="#ef4444" />
          <IssueCard
            icon="🔴"
            badge="SYNTAX"
            badgeColor="#ef4444"
            line={extractLine(syntax)}
            title={syntax}
            fix={getSyntaxTip(syntax)}
            defaultOpen
          />
        </>
      )}

      {/* ── Security issues ── */}
      {hasSecurityIssues && (
        <>
          <SectionHeader label="Security" count={security.length} color="#f97316" />
          {security.map((issue, i) => (
            <IssueCard
              key={i}
              icon="🔒"
              badge="SECURITY"
              badgeColor="#f97316"
              line={extractLine(issue)}
              title={issue}
              fix={getSecurityTip(issue)}
              defaultOpen={i === 0}
            />
          ))}
        </>
      )}

      {/* ── Runtime risks ── */}
      {hasRuntimeRisks && (
        <>
          <SectionHeader label="Runtime Risks" count={runtime_risks.length} color="#a855f7" />
          {runtime_risks.map((warning, i) => (
            <IssueCard
              key={i}
              icon="⚡"
              badge="RUNTIME"
              badgeColor="#a855f7"
              line={extractLine(warning)}
              title={warning}
              fix={getRuntimeTip(warning)}
              defaultOpen={i === 0}
            />
          ))}
        </>
      )}

      {/* ── Optimization findings ── */}
      {hasOptFindings && (
        <>
          <SectionHeader
            label="Optimization Opportunities"
            count={optimization!.finding_count}
            color="#22c55e"
          />
          {optimization!.findings.map((finding, i) => (
            <IssueCard
              key={i}
              icon="⚙️"
              badge={finding.type.replace(/_/g, ' ').toUpperCase()}
              badgeColor="#22c55e"
              line={finding.line}
              title={finding.suggestion}
              fix={OPT_FIXES[finding.type] ?? 'Refactor this section to reduce computational overhead.'}
              defaultOpen={i === 0}
            />
          ))}
        </>
      )}

      {/* ── Footer hint ── */}
      {isAborted && (
        <div
          style={{
            marginTop: 14,
            padding: '10px 14px',
            background: '#111',
            borderRadius: 8,
            border: '1px solid #1f2937',
            fontSize: 11,
            color: '#6b7280',
            lineHeight: 1.6,
          }}
        >
          Click any issue above to expand the fix suggestion. Once you've corrected
          the code, re-submit to run the full analysis pipeline.
        </div>
      )}
    </div>
  );
};

const pillStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  padding: '3px 8px',
  borderRadius: 20,
  letterSpacing: '0.04em',
  whiteSpace: 'nowrap',
};

export default ErrorReportPanel;