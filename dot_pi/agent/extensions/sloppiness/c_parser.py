"""C frontend for the pinned scb-check pipeline, local to this adapter process."""

from dataclasses import replace

import tree_sitter_c
from tree_sitter import Tree

import scb_check.pipeline as pipeline
import scb_check.walker as walker
import scb_check.tree_walking.languages.generic as generic
from scb_check.logging import get_logger
from scb_check.tree_walking.artifacts import LanguageParseError, ProjectParseError
from scb_check.tree_walking.dispatch import parse_source_file
from scb_check.tree_walking.languages.cpp import CPPParser
from scb_check.tree_walking.languages.generic import (
    GenericTreeSitterParser,
    TreeSitterLanguageConfig,
)
from scb_check.tree_walking.models import Language


C_GRAMMAR_VERSION = "0.24.2"
logger = get_logger(__name__)

# scb-check 0.2.0 has no C enum value. Its validated IR and clone normalizer use
# the compatible CPP tag internally; actual grammar/language are tracked below
# and reported as C. This does not modify the installed package or its parsers.
C_CONFIG = TreeSitterLanguageConfig(
    language=Language.CPP,
    tree_sitter_language=tree_sitter_c.language,
    function_node_types=frozenset({"function_definition"}),
    body_node_types=frozenset({"compound_statement"}),
    branch_node_types=frozenset({"if_statement", "conditional_expression", "switch_statement"}),
    loop_node_types=frozenset({"for_statement", "while_statement", "do_statement"}),
    jump_node_types=frozenset({"break_statement", "continue_statement"}),
    boolean_expression_node_types=frozenset({"binary_expression"}),
    clone_node_types=frozenset({
        "function_definition", "if_statement", "conditional_expression",
        "switch_statement", "for_statement", "while_statement", "do_statement",
    }),
)


def nodes(root):
    stack = [root]
    while stack:
        node = stack.pop()
        yield node
        stack.extend(reversed(node.children))


def cyclomatic_complexity(function):
    """One entry path plus decisions; switch defaults and #if are not decisions."""
    decisions = 0
    for node in nodes(function):
        if node.type in {
            "if_statement", "conditional_expression", "for_statement",
            "while_statement", "do_statement",
        }:
            decisions += 1
        elif node.type == "case_statement" and node.child_by_field_name("value") is not None:
            decisions += 1
        elif node.type == "binary_expression":
            operator = node.child_by_field_name("operator")
            if operator is not None and operator.text in {b"&&", b"||"}:
                decisions += 1
    return 1 + decisions


class CParser(GenericTreeSitterParser):
    def __init__(self, recover=False):
        super().__init__(C_CONFIG)
        self.recover = recover
        self.recovered = {}

    def _parse_tree(self, source):
        tree = self._get_parser().parse(source.encode("utf-8"))
        if tree.root_node.has_error:
            if not self.recover or not any(node.type == "function_definition" for node in nodes(tree.root_node)):
                raise LanguageParseError("failed to parse C source", language=Language.CPP)
        return tree

    def parse(self, path, source):
        parsed = super().parse(path, source)
        if parsed.native_tree.root_node.has_error:
            errors = sum(node.type == "ERROR" or node.is_missing for node in nodes(parsed.native_tree.root_node))
            self.recovered[str(path)] = errors
            logger.warning("C syntax recovery: metrics are approximate", file=str(path), error_nodes=errors)
        complexities = {
            (node.start_point.row + 1, node.start_point.column): cyclomatic_complexity(node)
            for node in nodes(parsed.native_tree.root_node)
            if node.type == "function_definition"
        }
        symbols = tuple(
            symbol.model_copy(update={
                "cyc_complexity": complexities[(symbol.start_line, symbol.span.start_col)],
            })
            for symbol in parsed.module.symbols
            # C macro dispatch blocks can be parsed as nested functions, even
            # without syntax errors. Standard C has no nested functions.
            # Keep their decisions in the enclosing function, without adding the
            # same region to function mass again. This policy also folds genuine
            # GNU nested functions into their parent.
            if symbol.owner_qualified_name is None
        )
        return replace(parsed, module=parsed.module.model_copy(update={"symbols": symbols}))


def cognitive_complexity(node, config, *, nesting):
    """Preserve upstream scores without recursively visiting flow bodies twice."""
    if generic._is_boolean_operation(node, config):
        return 1 + sum(cognitive_complexity(child, config, nesting=nesting) for child in node.children)
    if node.type in config.jump_node_types:
        return 1
    if node.type in config.cognitive_flow_break_node_types:
        return 1 + nesting + sum(cognitive_complexity(child, config, nesting=nesting + 1) for child in node.children)
    return sum(cognitive_complexity(child, config, nesting=nesting) for child in node.children)


def install_c_frontend(recover=False):
    """Extend discovery and dispatch only inside this short-lived subprocess."""
    c_parser = CParser(recover=recover)
    strict_c_parser = CParser()
    cpp_parser = CPPParser()
    parsed_languages = {}
    syntax = {}
    walker.SUPPORTED_SOURCE_SUFFIXES = walker.SUPPORTED_SOURCE_SUFFIXES | {".c", ".h"}

    def dispatch(path, source):
        suffix = path.suffix.lower()
        if suffix not in {".c", ".h"}:
            parsed = parse_source_file(path, source)
            language = parsed.module.language.value
        else:
            try:
                parsed = (strict_c_parser if suffix == ".h" else c_parser).parse(path, source)
                language = "c"
            except LanguageParseError as c_error:
                if suffix == ".c":
                    raise ProjectParseError(f"failed to parse `{path}` as C", file_path=path) from c_error
                try:
                    parsed = cpp_parser.parse(path, source)
                    language = "cpp"
                except LanguageParseError as cpp_error:
                    if not recover:
                        raise ProjectParseError(f"failed to parse `{path}` as C or C++", file_path=path) from cpp_error
                    try:
                        parsed = c_parser.parse(path, source)
                        language = "c"
                    except LanguageParseError as recovery_error:
                        raise ProjectParseError(f"failed to parse `{path}` as C or C++", file_path=path) from recovery_error
        parsed_languages[path] = language
        if isinstance(parsed.native_tree, Tree):
            counts = syntax.setdefault(language, {"tree_count": 0, "node_count": 0})
            counts["tree_count"] += 1
            counts["node_count"] += sum(1 for _ in nodes(parsed.native_tree.root_node))
        return parsed

    pipeline.dispatch_parse_source_file = dispatch
    generic._cognitive_for_node = cognitive_complexity
    return parsed_languages, syntax, c_parser.recovered
