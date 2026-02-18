#error_checker.py
import ast
import re
import tokenize
import io

# ── Language Detection ────────────────────────────────────────────────────────

# FIX 3: Escaped all unescaped parentheses in regex patterns (were causing re.error crashes)
NON_PYTHON_SIGNATURES = [
    r'\bfunction\s+\w+\s*\(',        # JavaScript function declaration
    r'\bvar\s+\w+\s*=',              # JavaScript var
    r'\bconst\s+\w+\s*=',            # JavaScript const
    r'\blet\s+\w+\s*=',              # JavaScript let
    r'#include\s*<',                 # C/C++ include
    r'\bpublic\s+static\s+void\b',   # Java
    r'\bint\s+main\s*\(',            # C/C++ main
    r'^\s*\{\s*$',                   # JSON/JS bare block
    r'=>',                           # Arrow functions (JS)
    r'console\.log\s*\(',            # JavaScript console.log
    r'\bfn\s+\w+\s*\(',              # Rust
    r'\bfunc\s+\w+\s*\(',            # Go
]

# Configurable threshold for optimization checks
LARGE_FUNCTION_THRESHOLD = 15


def check_is_python(code: str) -> dict:
    """
    Verifies that the submitted code is valid Python.
    Returns a result dict with 'is_python' and 'reason'.
    """
    result = {"is_python": False, "reason": ""}

    # Step 1: Must pass AST parsing
    try:
        tree = ast.parse(code)
    except SyntaxError as e:
        result["reason"] = f"Failed to parse as Python: {e}"
        return result

    # Step 2: Reject non-Python language signatures
    for pattern in NON_PYTHON_SIGNATURES:
        if re.search(pattern, code, re.MULTILINE):
            result["reason"] = f"Non-Python syntax pattern detected: '{pattern}'"
            return result

    # Step 3: Tokenize to confirm valid Python token stream
    try:
        tokenize.generate_tokens(io.StringIO(code).readline)
    except tokenize.TokenError as e:
        result["reason"] = f"Tokenization failed: {e}"
        return result

    # Step 4: Confirm meaningful Python construct exists
    has_python_construct = any(
        isinstance(node, (
            ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef,
            ast.Import, ast.ImportFrom, ast.Assign, ast.Return,
            ast.For, ast.While, ast.If, ast.With
        ))
        for node in ast.walk(tree)
    )

    if not has_python_construct and len(code.strip()) > 30:
        result["reason"] = "No recognizable Python constructs found."
        return result

    result["is_python"] = True
    result["reason"] = "Valid Python code confirmed."
    return result


# ── Syntax Check ──────────────────────────────────────────────────────────────

def check_syntax(code: str) -> str | None:
    """
    Checks Python syntax. Returns None if valid, error string if not.
    """
    try:
        ast.parse(code)
        return None
    except SyntaxError as e:
        return f"Syntax Error at line {e.lineno}: {e.msg}"


# ── Security Check ────────────────────────────────────────────────────────────

FORBIDDEN_IMPORTS = {"os", "sys", "subprocess", "shutil", "socket", "ctypes"}
# FIX 4: Corrected __import__ string (was "**import**" due to markdown leak)
FORBIDDEN_FUNCTIONS = {"eval", "exec", "open", "compile", "__import__"}


def check_security(tree: ast.AST) -> list[str]:
    """
    Scans AST for unsafe imports and dangerous function calls.
    Returns a list of security error strings.
    """
    errors = []

    for node in ast.walk(tree):

        # Standard imports: import os / import os.path
        if isinstance(node, ast.Import):
            for alias in node.names:
                if alias.name.split('.')[0] in FORBIDDEN_IMPORTS:
                    errors.append(f"Forbidden import: '{alias.name}'")

        # From imports: from os import system / from subprocess import run
        if isinstance(node, ast.ImportFrom):
            if node.module and node.module.split('.')[0] in FORBIDDEN_IMPORTS:
                errors.append(f"Forbidden import via 'from': '{node.module}'")

        if isinstance(node, ast.Call):

            # Direct calls: eval(...), exec(...), __import__(...)
            if isinstance(node.func, ast.Name):
                if node.func.id in FORBIDDEN_FUNCTIONS:
                    errors.append(f"Forbidden function call: '{node.func.id}'")

            # Attribute calls: os.system(...), subprocess.run(...)
            if isinstance(node.func, ast.Attribute):
                if isinstance(node.func.value, ast.Name):
                    base = node.func.value.id
                    attr = node.func.attr
                    if base in FORBIDDEN_IMPORTS and attr in {
                        "system", "popen", "run", "call", "Popen"
                    }:
                        errors.append(f"Unsafe system call: '{base}.{attr}()'")

    return errors


# ── Runtime Risk Detection ────────────────────────────────────────────────────

def check_runtime_risks(tree: ast.AST) -> list[str]:
    """
    Detects probable runtime risks via static analysis.
    Returns a list of warning strings.
    """
    warnings = []

    for node in ast.walk(tree):

        # Infinite loop: while True with no break
        if isinstance(node, ast.While):
            if isinstance(node.test, ast.Constant) and node.test.value is True:
                has_break = any(isinstance(n, ast.Break) for n in ast.walk(node))
                if not has_break:
                    warnings.append(
                        f"Infinite loop risk: 'while True' at line {node.lineno} "
                        f"has no break statement"
                    )

        # Division by zero (literal denominator)
        if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Div):
            if isinstance(node.right, ast.Constant) and node.right.value == 0:
                warnings.append(
                    f"Division by zero: literal '/ 0' at line {node.lineno}"
                )

        # Recursive functions with no apparent base case
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            calls_itself = any(
                isinstance(n, ast.Call)
                and isinstance(n.func, ast.Name)
                and n.func.id == node.name
                for n in ast.walk(node)
            )
            has_conditional = any(
                isinstance(n, (ast.If, ast.Assert))
                for n in ast.walk(node)
            )
            if calls_itself and not has_conditional:
                warnings.append(
                    f"Possible infinite recursion in '{node.name}' at line "
                    f"{node.lineno}: recursive call with no conditional base case"
                )

            # Unreachable code after return statement
            for stmt in node.body[:-1]:
                if isinstance(stmt, ast.Return):
                    warnings.append(
                        f"Unreachable code after 'return' in '{node.name}' "
                        f"at line {stmt.lineno}"
                    )
                    break

    return warnings


# ── Optimization Readiness ────────────────────────────────────────────────────

def check_optimization_readiness(tree: ast.AST) -> dict:
    """
    Identifies structures with optimization potential.
    Returns a structured report with findings and line references.
    """
    findings = []

    for node in ast.walk(tree):

        # Nested loops — high complexity risk
        if isinstance(node, ast.For):
            # FIX 1: node.body is a list; must iterate it and walk each statement
            # (was: ast.walk(node.body) which throws TypeError on a list)
            has_nested = any(
                isinstance(n, (ast.For, ast.While))
                for stmt in node.body
                for n in ast.walk(stmt)
            )
            if has_nested:
                findings.append({
                    "type": "nested_loop",
                    "line": node.lineno,
                    "suggestion": "Nested loops detected — review for high time complexity (O(n²) or worse)"
                })

        # Large function body — consider modularizing
        if isinstance(node, ast.FunctionDef):
            if len(node.body) > LARGE_FUNCTION_THRESHOLD:
                findings.append({
                    "type": "large_function",
                    "line": node.lineno,
                    "name": node.name,
                    "suggestion": (
                        f"'{node.name}' has {len(node.body)} statements "
                        f"(threshold: {LARGE_FUNCTION_THRESHOLD}) — consider splitting"
                    )
                })

        # Nested binary operations — possible repeated computation
        if isinstance(node, ast.BinOp):
            if isinstance(node.left, ast.BinOp):
                findings.append({
                    "type": "nested_binary_operation",
                    "line": getattr(node, "lineno", "?"),
                    "suggestion": "Chained binary operation — check for redundant repeated computation"
                })

    return {
        "optimizable": len(findings) > 0,
        "finding_count": len(findings),
        "findings": findings
    }


# ── Master Runner ─────────────────────────────────────────────────────────────

def run_all_checks(code: str) -> dict:
    """
    Runs all checks in the correct gate order.
    Short-circuits on language or syntax failure.
    Returns a unified report dict.
    """
    report = {}

    # Gate 1: Language validation
    lang_check = check_is_python(code)
    report["language"] = lang_check
    if not lang_check["is_python"]:
        report["aborted"] = "Code rejected: not valid Python."
        return report

    # Gate 2: Syntax validation
    syntax_error = check_syntax(code)
    report["syntax"] = syntax_error or "OK"
    if syntax_error:
        report["aborted"] = "Code rejected: syntax errors present."
        return report

    # Single parse — tree shared across all remaining checks
    tree = ast.parse(code)

    # Gate 3: Security scan
    report["security"] = check_security(tree)

    # Gate 4: Runtime risk detection
    report["runtime_risks"] = check_runtime_risks(tree)

    # Gate 5: Optimization readiness
    report["optimization"] = check_optimization_readiness(tree)

    return report