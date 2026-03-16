# pipeline.py
"""
Central pipeline orchestrator.

Flow:
    1. Error / language check         (error_checker.run_all_checks)
    2. Complexity analysis             (complexity_checker.analyze_source)
    3. Optimization                    (rule_optimizer OR llm_optimizer)
    4. Re-analysis of optimized code   (complexity_checker.analyze_source)
    5. Return unified dict (JSON-serialisable)
"""

import asyncio
from dataclasses import dataclass, field
from typing import Literal, Optional

from checks.error_checker import run_all_checks
from checks.complexity_checker import analyze_source
from optimizer.rule_optimizer import optimize_code
from optimizer.llm_optimizer import optimize as llm_optimize


# ─────────────────────────────────────────────────────────────────────────────
# TYPES
# ─────────────────────────────────────────────────────────────────────────────

OptimizationLevel = Literal["none", "level1", "level2"]


@dataclass
class PipelineResult:
    # Stage flags
    passed_error_check: bool = False
    passed_complexity:  bool = False
    optimization_ran:   bool = False

    # Stage payloads
    error_report:       dict = field(default_factory=dict)
    original_analysis:  dict = field(default_factory=dict)
    optimized_analysis: dict = field(default_factory=dict)

    # Code
    original_code:      str  = ""
    optimized_code:     str  = ""
    optimization_level: str  = "none"

    # Level 1 metadata
    l1_changes: list = field(default_factory=list)

    # Level 2 metadata
    l2_winning_model:          str   = ""
    l2_score:                  float = 0.0
    l2_confidence:             float = 0.0
    l2_risk:                   str   = ""
    l2_changes_applied:        list  = field(default_factory=list)
    l2_additional_suggestions: list  = field(default_factory=list)
    l2_ranked_models:          list  = field(default_factory=list)
    l2_syntax_valid:           bool  = False

    # Top-level abort error
    error: Optional[str] = None


# ─────────────────────────────────────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────────────────────────────────────

def _detect_l1_changes(original: str, optimized: str) -> list[str]:
    """Produce a human-readable list of what Level-1 rule optimizer changed."""
    changes: list[str] = []
    orig_lines = original.strip().splitlines()
    opt_lines  = optimized.strip().splitlines()

    if len(opt_lines) < len(orig_lines):
        diff = len(orig_lines) - len(opt_lines)
        changes.append(
            f"Reduced code by {diff} line{'s' if diff > 1 else ''} "
            f"via dead-code elimination"
        )

    pattern_checks = [
        ("not not ",   "Removed double negation (not not x → x)"),
        (" and True",  "Removed redundant 'and True' in boolean expression"),
        (" + 0",       "Folded arithmetic identity (x + 0 → x)"),
        (" * 1",       "Folded arithmetic identity (x * 1 → x)"),
        (".append(",   "Converted append-loop to list comprehension"),
    ]
    for sig, description in pattern_checks:
        if sig in original and sig not in optimized:
            changes.append(description)

    if "len(" in original and "len(" not in optimized and "not " in optimized:
        changes.append("Replaced len(x) == 0 with idiomatic 'not x'")

    if not changes and original.strip() != optimized.strip():
        changes.append("Applied constant folding and arithmetic simplification")

    if original.strip() == optimized.strip():
        changes.append(
            "No rule-based optimizations applicable — code is already optimal"
        )

    return changes


def _to_dict(result: PipelineResult) -> dict:
    """Serialize PipelineResult to a plain JSON-safe dict."""
    return {
        "passed_error_check": result.passed_error_check,
        "passed_complexity":  result.passed_complexity,
        "optimization_ran":   result.optimization_ran,
        "error_report":       result.error_report,
        "original_analysis":  result.original_analysis,
        "optimized_analysis": result.optimized_analysis,
        "original_code":      result.original_code,
        "optimized_code":     result.optimized_code,
        "optimization_level": result.optimization_level,
        "l1_changes":         result.l1_changes,
        "l2": {
            "winning_model":          result.l2_winning_model,
            "score":                  result.l2_score,
            "confidence":             result.l2_confidence,
            "risk":                   result.l2_risk,
            "changes_applied":        result.l2_changes_applied,
            "additional_suggestions": result.l2_additional_suggestions,
            "ranked_models":          result.l2_ranked_models,
            "syntax_valid":           result.l2_syntax_valid,
        },
        "error": result.error,
    }


# ─────────────────────────────────────────────────────────────────────────────
# MAIN PIPELINE
# ─────────────────────────────────────────────────────────────────────────────

async def run_pipeline(
    code: str,
    optimization_level: OptimizationLevel = "none",
) -> dict:
    """
    Run the full analysis + optimization pipeline.

    Parameters
    ----------
    code : str
        Raw Python source submitted by the user.
    optimization_level : "none" | "level1" | "level2"
        "none"   — analyse only, no optimization.
        "level1" — rule-based optimizer (rule_optimizer.py).
        "level2" — LLM-based optimizer  (llm_optimizer.py).

    Returns
    -------
    dict
        JSON-serialisable result dict consumed by app.py / Flask.
    """
    result = PipelineResult(
        original_code=code,
        optimization_level=optimization_level,
    )

    # ── STAGE 1: Error & language check ──────────────────────────────────────
    error_report = run_all_checks(code)
    result.error_report = error_report

    if "aborted" in error_report:
        result.error = error_report["aborted"]
        return _to_dict(result)

    result.passed_error_check = True

    # ── STAGE 2: Complexity analysis of original code ─────────────────────────
    original_analysis = analyze_source(code)
    if "error" in original_analysis:
        result.error = f"Complexity analysis failed: {original_analysis['error']}"
        return _to_dict(result)

    result.original_analysis = original_analysis
    result.passed_complexity  = True

    # ── STAGE 3: Optimization ─────────────────────────────────────────────────
    optimized_code = code  # default: unchanged

    if optimization_level == "level1":
        optimized_code    = optimize_code(code)
        result.l1_changes = _detect_l1_changes(code, optimized_code)
        result.optimization_ran = True

    elif optimization_level == "level2":
        llm_result = await llm_optimize(code)

        result.l2_winning_model          = llm_result.winning_model
        result.l2_score                  = llm_result.score
        result.l2_confidence             = llm_result.confidence
        result.l2_risk                   = llm_result.risk
        result.l2_changes_applied        = llm_result.changes_applied
        result.l2_additional_suggestions = llm_result.additional_suggestions
        result.l2_ranked_models          = llm_result.ranked_models
        result.l2_syntax_valid           = llm_result.syntax_valid

        if llm_result.success:
            optimized_code = llm_result.optimized_code
        else:
            result.error = f"LLM optimization failed: {llm_result.error}"

        result.optimization_ran = True

    result.optimized_code = optimized_code

    # ── STAGE 4: Re-analyse optimized code ───────────────────────────────────
    # For level1: ast.unparse() always reformats the code (strips comments,
    # condenses whitespace) so we must always re-analyse, even if the logic
    # is unchanged — otherwise optimized_analysis == original_analysis always.
    if optimization_level == "level1" or optimized_code.strip() != code.strip():
        opt_analysis = analyze_source(optimized_code)
        result.optimized_analysis = (
            opt_analysis if "error" not in opt_analysis else original_analysis
        )
    else:
        # Code truly unchanged — metrics are identical to the original
        result.optimized_analysis = original_analysis

    return _to_dict(result)


# ─────────────────────────────────────────────────────────────────────────────
# SYNC WRAPPER  (for testing / non-async callers)
# ─────────────────────────────────────────────────────────────────────────────

def run_pipeline_sync(
    code: str,
    optimization_level: OptimizationLevel = "none",
) -> dict:
    """Blocking wrapper around run_pipeline. Useful for unit tests."""
    return asyncio.run(run_pipeline(code, optimization_level))