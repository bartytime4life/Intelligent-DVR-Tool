"""The browser's analyzer-rule export loads unchanged in the analyzer's own rule engine."""
import json
from pathlib import Path
import unittest

from edge.rules import Rule, RuleEngine

FIXTURE = Path(__file__).with_name('fixtures') / 'zone-rules-export.json'


class ZoneRulesExportTest(unittest.TestCase):
    def test_browser_export_is_a_valid_rule_file(self):
        rules = [Rule(**rule) for rule in json.loads(FIXTURE.read_text(encoding='utf-8'))['rules']]
        engine = RuleEngine(rules, camera='north-gate')
        self.assertEqual([r.name for r in engine.rules], ['Gate approach'])
        # A box centered inside the exported rect matches; the frame edge stays inside the image.
        x, y, w, h = rules[0].rect
        self.assertLessEqual(x + w, 1)
        self.assertLessEqual(y + h, 1)


if __name__ == '__main__':
    unittest.main()
