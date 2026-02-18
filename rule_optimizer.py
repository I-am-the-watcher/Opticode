#rule_optimizer.py
import ast

class LevelOneOptimizer(ast.NodeTransformer):

    # 1. Constant Folding
    def visit_BinOp(self, node):
        self.generic_visit(node)

        if isinstance(node.left, ast.Constant) and isinstance(node.right, ast.Constant):
            try:
                value = eval(compile(ast.Expression(node), "", "eval"))
                return ast.Constant(value=value)
            except Exception:
                pass

        # Arithmetic identities
        if isinstance(node.op, ast.Add):
            if isinstance(node.right, ast.Constant) and node.right.value == 0:
                return node.left
            if isinstance(node.left, ast.Constant) and node.left.value == 0:
                return node.right

        if isinstance(node.op, ast.Mult):
            if isinstance(node.right, ast.Constant):
                if node.right.value == 1:
                    return node.left
                if node.right.value == 0:
                    return ast.Constant(value=0)
            if isinstance(node.left, ast.Constant):
                if node.left.value == 1:
                    return node.right
                if node.left.value == 0:
                    return ast.Constant(value=0)

        return node

    # 2. Remove Double Negation
    def visit_UnaryOp(self, node):
        self.generic_visit(node)
        if isinstance(node.op, ast.Not) and isinstance(node.operand, ast.UnaryOp):
            if isinstance(node.operand.op, ast.Not):
                return node.operand.operand
        return node

    # 3. Simplify Boolean AND
    def visit_BoolOp(self, node):
        self.generic_visit(node)
        if isinstance(node.op, ast.And):
            node.values = [v for v in node.values if not (isinstance(v, ast.Constant) and v.value is True)]
            if len(node.values) == 1:
                return node.values[0]
        return node

    # 4. len(x) == 0 → not x
    def visit_Compare(self, node):
        self.generic_visit(node)
        if (
            isinstance(node.left, ast.Call)
            and isinstance(node.left.func, ast.Name)
            and node.left.func.id == "len"
            and isinstance(node.ops[0], ast.Eq)
            and isinstance(node.comparators[0], ast.Constant)
            and node.comparators[0].value == 0
        ):
            return ast.UnaryOp(op=ast.Not(), operand=node.left.args[0])
        return node

    # 5. If–Else Reduction
    def visit_If(self, node):
        self.generic_visit(node)

        # Remove if False
        if isinstance(node.test, ast.Constant):
            if node.test.value is True:
                return node.body
            if node.test.value is False:
                return node.orelse

        # x = True / False pattern
        if (
            len(node.body) == 1 and len(node.orelse) == 1
            and isinstance(node.body[0], ast.Assign)
            and isinstance(node.orelse[0], ast.Assign)
            and isinstance(node.body[0].value, ast.Constant)
            and isinstance(node.orelse[0].value, ast.Constant)
            and node.body[0].value.value is True
            and node.orelse[0].value.value is False
        ):
            return ast.Assign(
                targets=node.body[0].targets,
                value=node.test
            )

        return node

    # 6. Loop → List Comprehension
    def visit_For(self, node):
        self.generic_visit(node)

        if (
            len(node.body) == 1
            and isinstance(node.body[0], ast.Expr)
            and isinstance(node.body[0].value, ast.Call)
            and isinstance(node.body[0].value.func, ast.Attribute)
            and node.body[0].value.func.attr == "append"
        ):
            return ast.Assign(
                targets=[node.body[0].value.func.value],
                value=ast.ListComp(
                    elt=node.body[0].value.args[0],
                    generators=[
                        ast.comprehension(
                            target=node.target,
                            iter=node.iter,
                            ifs=[],
                            is_async=0
                        )
                    ]
                )
            )

        return node

    # 7. Remove x = x
    def visit_Assign(self, node):
        self.generic_visit(node)
        if (
            isinstance(node.value, ast.Name)
            and isinstance(node.targets[0], ast.Name)
            and node.value.id == node.targets[0].id
        ):
            return None
        return node
    def remove_unused_variables(self, tree):
        # First pass: find all used variable names
        self.used_vars = set()

        class VarUsageVisitor(ast.NodeVisitor):
            def __init__(self, used_vars):
                self.used_vars = used_vars

            def visit_Name(self, node):
                if isinstance(node.ctx, ast.Load):
                    self.used_vars.add(node.id)

        VarUsageVisitor(self.used_vars).visit(tree)

        # Second pass: remove assignments to unused variables
        class RemoveUnusedAssign(ast.NodeTransformer):
            def __init__(self, used_vars):
                self.used_vars = used_vars

            def visit_Assign(self, node):
                # Only keep assignments if the target is used later
                targets = [t for t in node.targets if isinstance(t, ast.Name) and t.id in self.used_vars]
                if not targets:
                    return None
                node.targets = targets
                return node

        return RemoveUnusedAssign(self.used_vars).visit(tree)


def optimize_code(source_code: str) -> str:
    try:
        tree = ast.parse(source_code)
    except SyntaxError:
        # Should never happen because syntax check already ran
        return source_code

    optimizer = LevelOneOptimizer()
    optimized_tree = optimizer.visit(tree)
    ast.fix_missing_locations(optimized_tree)

    optimized_tree = optimizer.remove_unused_variables(optimized_tree)
    ast.fix_missing_locations(optimized_tree)

    return ast.unparse(optimized_tree)

