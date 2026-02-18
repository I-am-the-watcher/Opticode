import asyncio
import ast
import json
import re
import time
from dataclasses import dataclass, field
from difflib import SequenceMatcher
from typing import Optional

from groq import Groq

import os

api_key = os.getenv("api_key")

# FIX: Must be a dict {model_id: display_name}, NOT a set.
# A set has no .items() method â€” the original fan_out() would crash.
MODELS: dict[str, str] = {
    "llama-3.3-70b-versatile": "LLaMA 3.3 70B (Meta)",
    "openai/gpt-oss-120b":     "ChatGPT OSS 120B (OpenAI via Groq)",
    "qwen/qwen3-32b":          "Qwen 3 32B (Alibaba)",
}

# Qwen 3 supports a "/think" prefix in the user message.
# When enabled it reasons step-by-step before answering â€” better quality,
# slightly slower. Set to False to disable.
QWEN_THINKING_MODE = True

# Scoring weights â€” tune these for your use case
WEIGHT_CONFIDENCE = 0.45   # How sure the LLM is about its own output
WEIGHT_SIMILARITY = 0.35   # How close it stays to original logic
WEIGHT_RISK       = 0.20   # Penalise high-risk / breaking changes

# Ideal similarity ratio to original (0.72 = meaningfully changed, not rewritten)
SIMILARITY_TARGET = 0.72


# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# DATA CLASSES
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

@dataclass
class LLMResult:
    model_id:   str
    model_name: str
    code:       Optional[str]
    changes:    list[str]     = field(default_factory=list)
    confidence: float         = 0.5
    risk:       str           = "medium"   # low | medium | high
    error:      Optional[str] = None
    score:      float         = 0.0
    syntax_ok:  bool          = False
    latency_ms: int           = 0


@dataclass
class OptimizationResult:
    success:                bool
    optimized_code:         str
    winning_model:          str
    score:                  float
    confidence:             float
    risk:                   str
    changes_applied:        list[str]
    additional_suggestions: list[str]
    syntax_valid:           bool
    ranked_models:          list[dict]
    error:                  Optional[str] = None


# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# PROMPT ENGINEERING
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

SYSTEM_PROMPT = """\
You are an expert Python optimization engineer.
Your job is to improve Python code for performance and readability
WITHOUT changing what it does â€” same inputs, same outputs, same side effects.

STRICT RULES:
1. Preserve ALL logic exactly. Never silently change behaviour.
2. Only improve: time/space complexity, Pythonic style, stdlib usage,
   unnecessary loops, redundant variables, or inefficient data structures.
3. If you want to change an algorithm, mark it [OPTIONAL] and explain why.
4. Never add external dependencies that weren't already in the code.
5. Don't add any comments or docstrings that weren't in the original code.
6. Return your answer in EXACTLY this format â€” no extra prose outside the blocks:

```optimized
<your full optimized Python code here>
```
```json
{
  "changes": ["<what you changed and why>", "..."],
  "confidence": <float 0.0-1.0>,
  "risk": "<low|medium|high>"
}
```

confidence = how certain you are the optimized code is logically equivalent.
risk       = chance of subtle behaviour change (low / medium / high).
"""


def build_user_prompt(code: str, model_id: str) -> str:
    """
    Build the user-turn prompt.
    Qwen 3 supports a /think prefix that activates chain-of-thought reasoning
    before producing the final answer â€” same output format, better reasoning.
    """
    prefix = "/think\n\n" if (QWEN_THINKING_MODE and "qwen" in model_id.lower()) else ""
    return (
        f"{prefix}Optimize the following Python code. "
        f"Logic must be preserved exactly.\n\n"
        f"```python\n{code}\n```"
    )


# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# RESPONSE PARSING
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

def strip_thinking_block(raw: str) -> str:
    """
    Qwen 3 (and some reasoning models) wrap internal reasoning in
    <think>â€¦</think> tags before the real answer.
    Strip those so the code/json regex patterns work correctly.
    """
    return re.sub(r"<think>.*?</think>", "", raw, flags=re.DOTALL).strip()


def parse_llm_response(raw: str, model_id: str, model_name: str) -> LLMResult:
    """Extract optimized code + metadata from a raw LLM response."""

    raw = strip_thinking_block(raw)

    code_match = re.search(r"```optimized\s*\n(.*?)```", raw, re.DOTALL)
    json_match = re.search(r"```json\s*\n(.*?)```",      raw, re.DOTALL)

    code = code_match.group(1).strip() if code_match else None

    metadata: dict = {"changes": [], "confidence": 0.5, "risk": "medium"}
    if json_match:
        try:
            metadata = json.loads(json_match.group(1))
        except json.JSONDecodeError:
            pass

    # Fallback: model wrapped code in plain ```python instead of ```optimized
    if not code:
        py_match = re.search(r"```(?:python)?\s*\n(.*?)```", raw, re.DOTALL)
        code = py_match.group(1).strip() if py_match else None

    return LLMResult(
        model_id   = model_id,
        model_name = model_name,
        code       = code,
        changes    = metadata.get("changes", []),
        confidence = float(metadata.get("confidence", 0.5)),
        risk       = str(metadata.get("risk", "medium")),
    )


# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# LLM QUERYING
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

def query_llm_sync(model_id: str, model_name: str,
                   code: str, client: Groq) -> LLMResult:
    """Query a single LLM (blocking). Runs inside asyncio thread pool."""
    start = time.monotonic()
    try:
        response = client.chat.completions.create(
            model    = model_id,
            messages = [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user",   "content": build_user_prompt(code, model_id)},
            ],
            temperature = 0.15,   # Low = conservative, stays close to original
            max_tokens  = 4096,
        )
        raw    = response.choices[0].message.content
        result = parse_llm_response(raw, model_id, model_name)

    except Exception as exc:
        result = LLMResult(
            model_id   = model_id,
            model_name = model_name,
            code       = None,
            error      = str(exc),
        )

    result.latency_ms = int((time.monotonic() - start) * 1000)
    return result


async def fan_out(code: str, client: Groq) -> list[LLMResult]:
    """
    Query all three LLMs concurrently.
    Uses run_in_executor because Groq's client is synchronous.
    """
    loop = asyncio.get_event_loop()

    tasks = [
        loop.run_in_executor(
            None,
            query_llm_sync,
            model_id, model_name, code, client,
        )
        for model_id, model_name in MODELS.items()   # .items() works on a dict âœ“
    ]

    results: list[LLMResult] = await asyncio.gather(*tasks)
    return results


# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# VALIDATION
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

def check_syntax(code: str) -> bool:
    """Return True if the code parses as valid Python 3."""
    try:
        ast.parse(code)
        return True
    except SyntaxError:
        return False


def similarity_ratio(original: str, optimized: str) -> float:
    """Text similarity between original and optimized code (0â€“1)."""
    return SequenceMatcher(None, original, optimized).ratio()


# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# SCORING
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

RISK_PENALTY: dict[str, float] = {"low": 0.00, "medium": 0.10, "high": 0.30}


def score_result(result: LLMResult, original_code: str) -> float:
    """
    Composite score (higher = better).

    Three signals:
      1. confidence  â€” LLM's self-reported certainty of logical equivalence
      2. similarity  â€” peaks at SIMILARITY_TARGET; penalises both
                       "unchanged" (wasted call) and "totally rewritten" (risky)
      3. risk        â€” hard penalty for high-risk suggestions

    Formula:
        score = (confidence Ã— W_conf)
              + (sim_score  Ã— W_sim)
              - (risk_pen   Ã— W_risk)
    """
    if result.code is None:
        return 0.0

    # Hard gate â€” syntactically broken code can never win
    if not check_syntax(result.code):
        result.syntax_ok = False
        return 0.0

    result.syntax_ok = True

    sim       = similarity_ratio(original_code, result.code)
    sim_score = max(0.0, 1.0 - abs(sim - SIMILARITY_TARGET) * 2.5)
    risk_pen  = RISK_PENALTY.get(result.risk, 0.10)

    raw_score = (
        result.confidence * WEIGHT_CONFIDENCE
        + sim_score       * WEIGHT_SIMILARITY
        - risk_pen        * WEIGHT_RISK
    )
    return round(max(0.0, raw_score), 4)


# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# AGGREGATION  â€” score â†’ rank â†’ pick winner
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

def aggregate(results: list[LLMResult], original_code: str) -> OptimizationResult:
    """Score all results, rank them, return the top-scoring one."""

    valid = [r for r in results if r.code is not None]

    if not valid:
        errors = "; ".join(r.error or "unknown" for r in results)
        return OptimizationResult(
            success                = False,
            optimized_code         = original_code,
            winning_model          = "none",
            score                  = 0.0,
            confidence             = 0.0,
            risk                   = "high",
            changes_applied        = [],
            additional_suggestions = [],
            syntax_valid           = False,
            ranked_models          = [],
            error                  = f"All LLMs failed: {errors}",
        )

    for r in valid:
        r.score = score_result(r, original_code)

    ranked = sorted(valid, key=lambda r: r.score, reverse=True)
    winner = ranked[0]

    # Merge all unique change notes; anything not in the winner's list
    # becomes "additional suggestions" from runner-up models.
    all_changes: list[str] = []
    for r in ranked:
        for change in r.changes:
            if change not in all_changes:
                all_changes.append(change)

    extra = [c for c in all_changes if c not in winner.changes]

    return OptimizationResult(
        success                = winner.syntax_ok,
        optimized_code         = winner.code or original_code,
        winning_model          = winner.model_name,
        score                  = winner.score,
        confidence             = winner.confidence,
        risk                   = winner.risk,
        changes_applied        = winner.changes,
        additional_suggestions = extra,
        syntax_valid           = winner.syntax_ok,
        ranked_models          = [
            {
                "model":      r.model_name,
                "score":      r.score,
                "confidence": r.confidence,
                "risk":       r.risk,
                "syntax_ok":  r.syntax_ok,
                "latency_ms": r.latency_ms,
                "error":      r.error,
            }
            for r in ranked
        ],
    )


# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# PUBLIC ENTRY POINT
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async def optimize(code: str) -> OptimizationResult:
    """
    Level 2 optimization pipeline.

    Args:
        code: Raw Python source code to optimize.

    Returns:
        OptimizationResult containing the best optimized code + full rankings.
    """
    client = Groq(api_key=api_key)

    print(f"\nðŸš€  Querying {len(MODELS)} LLMs in parallel â€¦")
    for name in MODELS.values():
        print(f"    â€¢ {name}")
    print()

    t0      = time.monotonic()
    results = await fan_out(code, client)
    elapsed = int((time.monotonic() - t0) * 1000)

    valid_count = sum(1 for r in results if r.code)
    print(f"âœ…  {valid_count}/{len(MODELS)} valid responses in {elapsed}ms")
    print("ðŸ“Š  Scoring and ranking â€¦\n")

    return aggregate(results, code)


# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# DISPLAY HELPER
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

def print_result(original: str, result: OptimizationResult) -> None:
    """Pretty-print the optimization result to the terminal."""
    div = "â”€" * 62

    print(f"\n{div}")
    print(f"  OPTIMIZED CODE  â†  {result.winning_model}")
    print(result.optimized_code.strip())

    print(f"\n{div}")
    print("  CHANGES APPLIED")
    for i, change in enumerate(result.changes_applied, 1):
        print(f"  {i}. {change}")

    if result.additional_suggestions:
        print(f"\n  ðŸ’¡ Additional suggestions from other models:")
        for s in result.additional_suggestions:
            print(f"     â€¢ {s}")


    print(f"\n  Syntax valid : {result.syntax_valid}")
    print(f"  Final score  : {result.score:.4f}")
    print(f"  Risk level   : {result.risk}")
    print(div + "\n")

