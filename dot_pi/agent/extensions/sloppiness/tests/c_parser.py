"""Behavioral checks for C metrics, without compiling or executing fixtures."""

import importlib.util
from pathlib import Path
import unittest

import scb_check.pipeline as pipeline
from scb_check.tree_walking.artifacts import LanguageParseError, ProjectParseError

spec = importlib.util.spec_from_file_location("c_frontend", Path(__file__).parents[1] / "c_parser.py")
frontend = importlib.util.module_from_spec(spec)
spec.loader.exec_module(frontend)


class CFrontendTests(unittest.TestCase):
    def symbols(self, source):
        parsed = frontend.CParser().parse(Path("fixture.c"), source)
        return {symbol.name: symbol for symbol in parsed.module.symbols}

    def test_c_grammar_supports_c_specific_generic_selection(self):
        symbols = self.symbols("int choose(int x) { return _Generic(x, int: 1, default: 0); }")
        self.assertEqual(set(symbols), {"choose"})
        self.assertEqual(symbols["choose"].cyc_complexity, 1)

    def test_complexity_counts_cases_not_switch_default(self):
        symbol = self.symbols("""
int decisions(int x) {
    int total = 0;
    if (x > 0 && x < 10 || x == 42) total++;
    for (int i = 0; i < x; i++) { if (i) total++; }
    while (x > 100) x--;
    do { total++; } while (total < 2);
    total += x ? 1 : 2;
    switch (x) {
        case 1: total++; break;
        case 2: total += 2; break;
        default: total = 0;
    }
    return total;
}
""")["decisions"]
        self.assertEqual(symbol.cyc_complexity, 11)
        self.assertGreater(symbol.sloc, 0)

    def test_macros_are_not_expanded_and_both_ifdef_branches_are_counted(self):
        symbols = self.symbols("""
#define DECIDE(x) ((x) ? 1 : 2)
int macro_call(int x) { return DECIDE(x); }
int conditional(int x) {
#ifdef FEATURE
    if (x > 0) return 1;
#else
    if (x < 0) return -1;
#endif
    return 0;
}
""")
        self.assertEqual(symbols["macro_call"].cyc_complexity, 1)
        self.assertEqual(symbols["conditional"].cyc_complexity, 3)

    def test_comments_and_declarations_do_not_create_functions(self):
        symbols = self.symbols("""
// int fake(void) { if (1) return 2; }
int declared(int x);
typedef int (*callback_t)(int);
static int apply(callback_t callback, int x) { return callback(x); }
""")
        self.assertEqual(set(symbols), {"apply"})
        self.assertEqual(symbols["apply"].cyc_complexity, 1)

    def test_header_fallback_preserves_cpp_and_labels_actual_parsers(self):
        languages, _, _ = frontend.install_c_frontend()
        pipeline.dispatch_parse_source_file(Path("inline.h"), "static inline int value(int x) { return x; }")
        pipeline.dispatch_parse_source_file(Path("template.h"), "template<class T> T identity(T x) { return x; }")
        pipeline.dispatch_parse_source_file(Path("sample.cpp"), "int answer() { return 42; }")
        self.assertEqual(languages, {Path("inline.h"): "c", Path("template.h"): "cpp", Path("sample.cpp"): "cpp"})
        with self.assertRaises(ProjectParseError):
            pipeline.dispatch_parse_source_file(Path("wrong.c"), "template<class T> T identity(T x) { return x; }")

    def test_invalid_c_is_rejected(self):
        with self.assertRaises(LanguageParseError):
            self.symbols("int broken( { return ;")

    def test_deep_nesting_has_linear_traversal_and_preserves_cognitive_score(self):
        frontend.install_c_frontend()
        source = "int nested(int x) {" + "if (x) {" * 30 + "return x;" + "}" * 30 + "return 0;}"
        symbol = self.symbols(source)["nested"]
        self.assertEqual(symbol.cyc_complexity, 31)
        self.assertEqual(symbol.cog_complexity, sum(range(1, 31)))

    def test_recovery_is_explicit_and_records_approximate_files(self):
        source = "int recovered(int x) { DEBUG(x += 1;) return x; }"
        with self.assertRaises(LanguageParseError):
            self.symbols(source)
        parser = frontend.CParser(recover=True)
        parsed = parser.parse(Path("macro.c"), source)
        self.assertTrue(parsed.module.symbols)
        self.assertGreater(parser.recovered["macro.c"], 0)

    def test_recovery_does_not_misclassify_cpp_headers(self):
        languages, _, recovered = frontend.install_c_frontend(recover=True)
        pipeline.dispatch_parse_source_file(Path("template.h"), "template<class T> T identity(T x) { return x; }")
        self.assertEqual(languages[Path("template.h")], "cpp")
        self.assertEqual(recovered, {})

    def test_macro_dispatch_does_not_double_count_function_mass(self):
        source = """
void execute(int i) {
    vmdispatch (GET_OPCODE(i)) {
        vmcase (OP_MOVE) { if (i) i--; }
        vmcase (OP_ADD) { while (i > 0) i--; }
    }
    if (i) return;
}
"""
        for recover in (False, True):
            with self.subTest(recover=recover):
                text = source.replace("    if (i) return;", "    DEBUG(i += 1;) if (i) return;") if recover else source
                parsed = frontend.CParser(recover=recover).parse(Path("vm.c"), text)
                self.assertEqual(parsed.native_tree.root_node.has_error, recover)
                self.assertGreater(sum(node.type == "function_definition" for node in frontend.nodes(parsed.native_tree.root_node)), 1)
                self.assertEqual([symbol.name for symbol in parsed.module.symbols], ["execute"])
                self.assertEqual(parsed.module.symbols[0].cyc_complexity, 4)

    def test_recovery_keeps_separate_top_level_functions(self):
        parsed = frontend.CParser(recover=True).parse(Path("macro.c"), """
int first(int x) { DEBUG(x += 1;) return x; }
int second(int x) { if (x) return 1; return 0; }
""")
        self.assertEqual([symbol.name for symbol in parsed.module.symbols], ["first", "second"])
        self.assertEqual([symbol.cyc_complexity for symbol in parsed.module.symbols], [1, 2])


if __name__ == "__main__":
    unittest.main()
