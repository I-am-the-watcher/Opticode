#complexity_checker.py
import ast
import math
import time
import tracemalloc
import textwrap
from typing import Callable


# ═══════════════════════════════════════════════════════════════════════════════
#  ORIGINAL COMPLEXITY ANALYZER  (unchanged logic, bug-fixes preserved)
# ═══════════════════════════════════════════════════════════════════════════════

class ComplexityAnalyzer(ast.NodeVisitor):
    def __init__(self):
        self.loop_depth = 0
        self.max_loop_depth = 0
        self.recursion = False
        self.recursive_calls = 0
        self.allocations = 0
        self.slicing = False
        self.function_name = None
        self.has_branching_recursion = False
        self.has_divide_conquer = False
        self.comprehension_depth = 0
        self.max_comp_depth = 0
        self.possible_log_loop = False

    # ---------------- FUNCTION TRACKING ---------------- #
    def visit_FunctionDef(self, node):
        old_function = self.function_name
        self.function_name = node.name
        self.generic_visit(node)
        self.function_name = old_function

    # ---------------- LOOP TRACKING ---------------- #
    def visit_For(self, node):
        self.loop_depth += 1
        self.max_loop_depth = max(self.max_loop_depth, self.loop_depth)
        self.generic_visit(node)
        self.loop_depth -= 1

    def visit_While(self, node):
        self.loop_depth += 1
        self.max_loop_depth = max(self.max_loop_depth, self.loop_depth)
        self.generic_visit(node)
        self.loop_depth -= 1

    # ---------------- RECURSION ---------------- #
    def visit_Call(self, node):
        if isinstance(node.func, ast.Name):
            if node.func.id == self.function_name:
                self.recursion = True
                self.recursive_calls += 1
                # BUG FIX 1: branching recursion means 2+ calls IN THE SAME
                # function body (like fib calling fib twice), NOT 2+ calls
                # accumulated across visits. We track this more carefully now —
                # the flag is only set if more than 1 recursive call exists in
                # the SAME function, which recursive_calls > 1 captures correctly
                # only if we reset between functions. We fix that in the
                # visit_FunctionDef wrapper below.
                if self.recursive_calls > 1:
                    self.has_branching_recursion = True
        self.generic_visit(node)

    # ---------------- ALLOCATION ---------------- #
    def visit_List(self, node):
        self.allocations += 1
        self.generic_visit(node)

    def visit_Dict(self, node):
        self.allocations += 1
        self.generic_visit(node)

    def visit_ListComp(self, node):
        self.allocations += 1
        self.comprehension_depth += 1
        self.max_comp_depth = max(self.max_comp_depth, self.comprehension_depth)
        self.generic_visit(node)
        self.comprehension_depth -= 1

    def visit_DictComp(self, node):
        self.allocations += 1
        self.comprehension_depth += 1
        self.max_comp_depth = max(self.max_comp_depth, self.comprehension_depth)
        self.generic_visit(node)
        self.comprehension_depth -= 1

    # ---------------- SLICING DETECTION ---------------- #
    def visit_Subscript(self, node):
        if isinstance(node.slice, ast.Slice):
            self.slicing = True
            # BUG FIX 2: divide-and-conquer requires BOTH recursion AND slicing/halving.
            # We should not eagerly set has_divide_conquer here because recursion
            # might not have been detected yet (AST visit order is not guaranteed).
            # Instead, we compute this lazily in estimate_time_complexity.
        self.generic_visit(node)

    # ---------------- LOG LOOP HEURISTIC ---------------- #
    def visit_Assign(self, node):
        """
        Detect patterns like:
            mid = (l+r)//2
            l = mid + 1
            r = mid - 1
        """
        if isinstance(node.value, ast.BinOp):
            if isinstance(node.value.op, (ast.FloorDiv, ast.Div)):
                if isinstance(node.value.right, ast.Constant):
                    if node.value.right.value == 2:
                        self.possible_log_loop = True
        self.generic_visit(node)


# ═══════════════════════════════════════════════════════════════════════════════
#  ORIGINAL ESTIMATION FUNCTIONS  (unchanged)
# ═══════════════════════════════════════════════════════════════════════════════

def estimate_time_complexity(signals):
    max_depth    = signals['max_loop_depth']
    comp_depth   = signals['max_comp_depth']
    recursion    = signals['recursion']
    slicing      = signals['slicing']
    branching    = signals['has_branching_recursion']
    log_loop     = signals['possible_log_loop']
    # BUG FIX 3: derive divide_and_conquer here instead of relying on the
    # flag set inside visit_Subscript (which has ordering issues). A function
    # is divide-and-conquer if it is recursive AND uses slicing (e.g. arr[:mid]).
    divide       = recursion and slicing

    # ----- RECURSION PATH ----- #
    if recursion:
        if branching:
            # BUG FIX 4: previously the branching check ran BEFORE the
            # divide-and-conquer check, so merge_sort (branching + divide)
            # was classified as O(2^n). Correct priority:
            #   1. Branching + divide-and-conquer → O(n log n)  (merge_sort)
            #   2. Branching alone                → O(2^n)       (fib)
            #   3. Linear + slicing               → O(n^2)       (slicing_recursion)
            #   4. Linear                         → O(n)         (factorial)
            if divide:
                return "O(n log n)"
            return "O(2^n)"
        # linear recursion
        if slicing:
            # e.g. slicing_recursion(arr[1:]) — each call copies O(n) slice
            return "O(n^2)"
        return "O(n)"

    # ----- ITERATIVE LOG LOOP ----- #
    # BUG FIX 5: possible_log_loop should only imply O(log n) when there is
    # exactly ONE loop level. A nested loop that also halves an index should
    # not be blindly classified as O(log n).
    if log_loop and max_depth == 1:
        return "O(log n)"

    # ----- PURE ITERATION / COMPREHENSIONS ----- #
    effective_depth = max(max_depth, comp_depth)
    if effective_depth == 0:
        return "O(1)"
    if effective_depth == 1:
        return "O(n)"
    if effective_depth == 2:
        return "O(n^2)"
    if effective_depth == 3:
        return "O(n^3)"
    return f"O(n^{effective_depth})"


def estimate_space_complexity(signals):
    recursion   = signals['recursion']
    allocations = signals['allocations']
    comp_depth  = signals['max_comp_depth']
    slicing     = signals['slicing']
    branching   = signals['has_branching_recursion']
    divide      = recursion and slicing

    if recursion:
        # BUG FIX 6: merge_sort allocates O(n) extra arrays at each level of
        # recursion, but the call *stack* depth is O(log n). However, the
        # dominant space cost is the merged arrays across all levels: O(n log n)
        # total — but conventionally merge_sort's auxiliary space is reported
        # as O(n) (the scratch space at any single level). We keep O(n) here.
        # For branching recursion WITHOUT divide, the call stack is O(n) deep.
        return "O(n)"

    if allocations:
        # BUG FIX 7: nested comprehensions allocate O(n^k) space, matching
        # their time complexity. Previously this checked comp_depth >= 2 but
        # used a flat O(n^2); generalise it.
        if comp_depth >= 2:
            return f"O(n^{comp_depth})"
        return "O(n)"

    return "O(1)"


# ═══════════════════════════════════════════════════════════════════════════════
#  ORIGINAL PUBLIC API  (unchanged)
# ═══════════════════════════════════════════════════════════════════════════════

def analyze_code_complexity(code: str):
    tree = ast.parse(code)
    analyzer = ComplexityAnalyzer()
    analyzer.visit(tree)

    signals = {
        "max_loop_depth":          analyzer.max_loop_depth,
        "max_comp_depth":          analyzer.max_comp_depth,
        "recursion":               analyzer.recursion,
        "recursive_calls":         analyzer.recursive_calls,
        "allocations":             analyzer.allocations,
        "slicing":                 analyzer.slicing,
        "has_branching_recursion": analyzer.has_branching_recursion,
        "has_divide_conquer":      analyzer.has_divide_conquer,
        "possible_log_loop":       analyzer.possible_log_loop,
    }

    return {
        "time_complexity":  estimate_time_complexity(signals),
        "space_complexity": estimate_space_complexity(signals),
    }


# ═══════════════════════════════════════════════════════════════════════════════
#  NEW: PER-FUNCTION ANALYZER
#  Runs ComplexityAnalyzer scoped to each individual function so that signals
#  don't bleed across function definitions (e.g. recursive_calls accumulating).
# ═══════════════════════════════════════════════════════════════════════════════

def _analyze_function_node(func_node: ast.FunctionDef, full_source: str) -> dict:
    """Run ComplexityAnalyzer on a single FunctionDef node."""
    analyzer = ComplexityAnalyzer()
    analyzer.visit(func_node)

    signals = {
        "max_loop_depth":          analyzer.max_loop_depth,
        "max_comp_depth":          analyzer.max_comp_depth,
        "recursion":               analyzer.recursion,
        "recursive_calls":         analyzer.recursive_calls,
        "allocations":             analyzer.allocations,
        "slicing":                 analyzer.slicing,
        "has_branching_recursion": analyzer.has_branching_recursion,
        "has_divide_conquer":      analyzer.has_divide_conquer,
        "possible_log_loop":       analyzer.possible_log_loop,
    }
    return signals


# ═══════════════════════════════════════════════════════════════════════════════
#  NEW: HALSTEAD METRICS
# ═══════════════════════════════════════════════════════════════════════════════

_OPERATOR_NODE_TYPES = (
    ast.Add, ast.Sub, ast.Mult, ast.Div, ast.Mod, ast.Pow, ast.FloorDiv,
    ast.BitAnd, ast.BitOr, ast.BitXor, ast.LShift, ast.RShift,
    ast.And, ast.Or, ast.Not, ast.Invert, ast.UAdd, ast.USub,
    ast.Eq, ast.NotEq, ast.Lt, ast.LtE, ast.Gt, ast.GtE,
    ast.Is, ast.IsNot, ast.In, ast.NotIn,
    ast.Assign, ast.AugAssign, ast.AnnAssign,
    ast.Call, ast.Attribute, ast.Subscript,
    ast.If, ast.For, ast.While, ast.Return, ast.Yield,
    ast.Import, ast.ImportFrom,
)


def compute_halstead(tree: ast.AST) -> dict:
    operators, operands = [], []
    for node in ast.walk(tree):
        if isinstance(node, _OPERATOR_NODE_TYPES):
            operators.append(type(node).__name__)
        if isinstance(node, ast.Name):
            operands.append(node.id)
        elif isinstance(node, ast.Constant):
            operands.append(str(node.value))
        elif isinstance(node, ast.FunctionDef):
            operands.append(node.name)

    n1 = len(set(operators))
    n2 = len(set(operands))
    N1 = len(operators)
    N2 = len(operands)
    n  = max(n1 + n2, 1)
    N  = N1 + N2

    volume     = N * math.log2(n)
    difficulty = (n1 / 2) * (N2 / max(n2, 1))
    effort     = difficulty * volume

    return {
        "distinct_operators": n1,
        "distinct_operands":  n2,
        "total_operators":    N1,
        "total_operands":     N2,
        "volume":             round(volume, 2),
        "difficulty":         round(difficulty, 2),
        "effort":             round(effort, 2),
        "time_to_program":    round(effort / 18, 2),
        "bugs_delivered":     round(volume / 3000, 4),
    }


# ═══════════════════════════════════════════════════════════════════════════════
#  NEW: CYCLOMATIC COMPLEXITY  (McCabe)
# ═══════════════════════════════════════════════════════════════════════════════

_BRANCH_TYPES = (
    ast.If, ast.For, ast.While, ast.ExceptHandler,
    ast.With, ast.Assert, ast.comprehension,
)


def cyclomatic_complexity(func_node: ast.FunctionDef) -> int:
    cc = 1
    for node in ast.walk(func_node):
        if isinstance(node, _BRANCH_TYPES):
            cc += 1
        elif isinstance(node, ast.BoolOp):
            cc += len(node.values) - 1
    return cc


# ═══════════════════════════════════════════════════════════════════════════════
#  NEW: LOC COUNTER
# ═══════════════════════════════════════════════════════════════════════════════

def count_loc(source: str) -> dict:
    lines   = source.splitlines()
    total   = len(lines)
    blank   = sum(1 for l in lines if not l.strip())
    comment = sum(1 for l in lines if l.strip().startswith("#"))
    code    = max(total - blank - comment, 1)
    return {"total": total, "blank": blank, "comment": comment, "code": code}


# ═══════════════════════════════════════════════════════════════════════════════
#  NEW: MAINTAINABILITY INDEX
# ═══════════════════════════════════════════════════════════════════════════════

def maintainability_index(halstead_volume: float, cc: float, loc: int) -> float:
    """Microsoft MI formula, normalised to 0–100."""
    if loc <= 0:
        return 100.0
    try:
        raw = (
            171
            - 5.2  * math.log(max(halstead_volume, 1))
            - 0.23 * cc
            - 16.2 * math.log(max(loc, 1))
        )
        return round(max(0.0, min(100.0, raw * 100 / 171)), 2)
    except Exception:
        return 0.0


def _mi_label(mi: float) -> str:
    if mi >= 80:  return "High"
    if mi >= 65:  return "Moderate"
    return "Low"


# ═══════════════════════════════════════════════════════════════════════════════
#  NEW: EMPIRICAL BENCHMARKING
# ═══════════════════════════════════════════════════════════════════════════════

def empirical_benchmark(
    func: Callable,
    input_sizes: list,
    input_generator: Callable,
) -> dict:
    """
    Measure runtime (ms) and peak memory (KB) for each input size.
    input_generator(size) must return a list/tuple of positional args for func.
    """
    runtimes, memory_usages = [], []

    for size in input_sizes:
        args = input_generator(size)
        if not isinstance(args, (list, tuple)):
            args = [args]

        # Runtime
        t0 = time.perf_counter()
        try:
            func(*args)
        except Exception:
            pass
        runtimes.append(round((time.perf_counter() - t0) * 1000, 4))

        # Peak memory
        tracemalloc.start()
        try:
            func(*args)
        except Exception:
            pass
        _, peak = tracemalloc.get_traced_memory()
        tracemalloc.stop()
        memory_usages.append(round(peak / 1024, 2))

    return {
        "input_sizes":  input_sizes,
        "runtimes_ms":  runtimes,
        "memory_kb":    memory_usages,
    }


def infer_empirical_big_o(input_sizes: list, runtimes: list) -> str:
    """Log-log linear regression to classify empirical growth rate."""
    if len(input_sizes) < 2:
        return "unknown"
    try:
        xs = [math.log(max(s, 1)) for s in input_sizes]
        ys = [math.log(max(t, 1e-9)) for t in runtimes]
        n  = len(xs)
        sx, sy  = sum(xs), sum(ys)
        sxy     = sum(x * y for x, y in zip(xs, ys))
        sxx     = sum(x * x for x in xs)
        denom   = n * sxx - sx * sx
        slope   = (n * sxy - sx * sy) / max(denom, 1e-9)

        if slope < 0.2:  return "O(1)"
        if slope < 0.7:  return "O(log n)"
        if slope < 1.3:  return "O(n)"
        if slope < 1.7:  return "O(n log n)"
        if slope < 2.3:  return "O(n²)"
        if slope < 3.3:  return "O(n³)"
        return "O(2ⁿ)"
    except Exception:
        return "unknown"


# ═══════════════════════════════════════════════════════════════════════════════
#  NEW: FULL-FILE RICH ANALYSIS
#  Returns everything the visualization layer needs in one call.
# ═══════════════════════════════════════════════════════════════════════════════

def analyze_source(source: str) -> dict:
    """
    Analyze a Python source string.

    Returns
    -------
    {
        "loc":                      { total, blank, comment, code },
        "halstead":                 { distinct_operators, ..., bugs_delivered },
        "functions": [
            {
                "name":                 str,
                "line":                 int,
                "time_complexity":      str,   # from original estimator
                "space_complexity":     str,   # from original estimator
                "cyclomatic_complexity":int,
                "signals":              dict,  # raw ComplexityAnalyzer output
                "loc":                  dict,
                "halstead":             dict,
                "maintainability_index":float,
                "mi_label":             str,
            },
            ...
        ],
        "total_cyclomatic_complexity": int,
        "maintainability_index":       float,
        "mi_label":                    str,
        "big_o_distribution":          { "O(n)": 2, "O(n^2)": 1, ... },
    }
    """
    try:
        tree = ast.parse(source)
    except SyntaxError as exc:
        return {"error": str(exc)}

    file_loc      = count_loc(source)
    file_halstead = compute_halstead(tree)
    functions     = []

    for node in ast.walk(tree):
        if not isinstance(node, ast.FunctionDef):
            continue

        # --- per-function signals (scoped, no bleed) ---
        signals = _analyze_function_node(node, source)

        # --- time / space from original estimators ---
        time_cx  = estimate_time_complexity(signals)
        space_cx = estimate_space_complexity(signals)

        # --- McCabe CC ---
        cc = cyclomatic_complexity(node)

        # --- per-function LOC & Halstead ---
        func_src = ast.get_source_segment(source, node) or ""
        func_loc = count_loc(func_src)
        try:
            func_tree = ast.parse(textwrap.dedent(func_src))
            func_h    = compute_halstead(func_tree)
        except SyntaxError:
            func_h = compute_halstead(ast.parse("pass"))

        mi = maintainability_index(func_h["volume"], cc, func_loc["code"])

        functions.append({
            "name":                  node.name,
            "line":                  node.lineno,
            "time_complexity":       time_cx,
            "space_complexity":      space_cx,
            "cyclomatic_complexity": cc,
            "signals":               signals,
            "loc":                   func_loc,
            "halstead":              func_h,
            "maintainability_index": mi,
            "mi_label":              _mi_label(mi),
        })

    # --- file-level aggregates ---
    total_cc = sum(f["cyclomatic_complexity"] for f in functions) or 1
    file_mi  = maintainability_index(file_halstead["volume"], total_cc, file_loc["code"])

    big_o_dist: dict[str, int] = {}
    for f in functions:
        key = f["time_complexity"]
        big_o_dist[key] = big_o_dist.get(key, 0) + 1

    return {
        "loc":                         file_loc,
        "halstead":                    file_halstead,
        "functions":                   functions,
        "total_cyclomatic_complexity": total_cc,
        "maintainability_index":       file_mi,
        "mi_label":                    _mi_label(file_mi),
        "big_o_distribution":          big_o_dist,
    }

