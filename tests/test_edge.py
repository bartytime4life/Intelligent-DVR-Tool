import unittest
from edge.rules import Rule,RuleEngine

D={'label':'person','score':.9,'box':[.3,.3,.2,.2]}

class RulesTest(unittest.TestCase):
    def engine(self,**kw):
        return RuleEngine([Rule('dock','person',(0,0,1,1),**kw)],run_id='test')

    def test_dwell_emits_once_then_resets_on_absence(self):
        e=self.engine(dwell=2)
        self.assertEqual(e.update(0,[D]),[])
        self.assertEqual(e.update(1,[D]),[])
        self.assertEqual(len(e.update(2,[D])),1)
        self.assertEqual(e.update(3,[D]),[])
        e.update(4,[])
        self.assertEqual(e.update(5,[D]),[])
        e.update(6,[D])
        self.assertEqual(len(e.update(7,[D])),1)

    def test_gap_resets_dwell(self):
        e=self.engine(dwell=2,max_gap=1)
        e.update(0,[D]);self.assertEqual(e.update(2,[D]),[])
        e.update(3,[D]);self.assertEqual(len(e.update(4,[D])),1)

    def test_wrong_label_low_score_outside_zone(self):
        for d in [{**D,'label':'car'},{**D,'score':.1}]:
            self.assertEqual(self.engine().update(0,[d]),[])
        e=RuleEngine([Rule('left','person',(0,0,.2,1))])
        self.assertEqual(e.update(0,[D]),[])

    def test_timestamps_and_malformed_detections(self):
        e=self.engine();e.update(0,[])
        for t in [0,-1,float('nan'),float('inf')]:
            with self.assertRaises(ValueError):e.update(t,[D])
        with self.assertRaises(ValueError):e.update(1,[{**D,'box':[0,0,2,2]}])
        self.assertEqual(len(e.update(1,[D])),1)

    def test_rules_reject_invalid_geometry_and_numeric_fields(self):
        for kw in [{'rect':(.8,0,.5,1)},{'dwell':float('nan')},{'threshold':True},{'max_gap':0}]:
            data=dict(name='dock',label='person',rect=(0,0,1,1));data.update(kw)
            with self.assertRaises(ValueError):Rule(**data)

    def test_identity_includes_source_model_rule_and_run(self):
        a=self.engine();b=self.engine()
        self.assertEqual(a.update(0,[D])[0]['id'],b.update(0,[D])[0]['id'])
        c=RuleEngine(a.rules,run_id='different-recording')
        self.assertNotEqual(c.update(0,[D])[0]['id'],self.engine().update(0,[D])[0]['id'])

if __name__=='__main__':unittest.main()
