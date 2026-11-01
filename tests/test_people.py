import hashlib
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import importlib.util
from edge import faces
from edge.people import PeopleStore, CONSENT_STATEMENT, PEOPLE_LIMIT
from edge.local_service import Jobs, JobError, load_catalog, face_tip

NUMPY = importlib.util.find_spec('numpy') is not None
MODELS = {'detector': faces.DETECTOR['sha256'], 'recognizer': faces.RECOGNIZER['sha256']}


def unit(seed, size=faces.EMBEDDING):
    import numpy as np
    vector = np.random.default_rng(seed).normal(size=size)
    return vector / np.linalg.norm(vector)


@unittest.skipUnless(NUMPY, 'numpy is part of the edge requirements')
class MatchingTest(unittest.TestCase):
    def test_match_needs_the_threshold_and_a_margin_over_the_next_person(self):
        import numpy as np
        a, b = unit(1), unit(2)
        people = [{'id': 'a', 'embeddings': [a]}, {'id': 'b', 'embeddings': [b]}]
        near_a = a * .9 + unit(3) * .1; near_a /= np.linalg.norm(near_a)
        self.assertEqual(faces.match(near_a, people, np)['person'], 'a')
        self.assertIsNone(faces.match(unit(4), people, np))  # A stranger stays below the threshold.
        both = (a + b) / np.linalg.norm(a + b)
        self.assertIsNone(faces.match(both, people, np))  # Too close between two people: no suggestion.
        self.assertIsNone(faces.match(a, [], np))
    def test_templates_skip_near_duplicates_and_keep_the_newest_views(self):
        import numpy as np
        a = unit(5)
        kept = faces.add_diverse([], [a, a, unit(6)], np)
        self.assertEqual(len(kept), 2)
        many = faces.add_diverse(kept, [unit(10 + i) for i in range(60)], np)
        self.assertEqual(len(many), faces.MAX_TEMPLATES)
        self.assertTrue(np.allclose(many[-1], unit(69)))
    def test_models_must_be_the_pinned_files(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / 'model.onnx'; path.write_bytes(b'x' * faces.DETECTOR['bytes'])
            with self.assertRaises(ValueError): faces.verify_model(path, faces.DETECTOR)
            path.write_bytes(b'short')
            with self.assertRaises(ValueError): faces.verify_model(path, faces.DETECTOR)
    def test_tips_name_the_most_common_problem(self):
        self.assertEqual(face_tip({'none': 1, 'dark': 5, 'blurry': 2}), 'It was too dark: add light in front of the face.')
        self.assertEqual(face_tip({'none': 0}), ''); self.assertEqual(face_tip(None), '')


class StoreTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.root = Path(self.temp.name)
        self.store = PeopleStore(self.root / 'people', MODELS)
    def tearDown(self): self.temp.cleanup()
    def test_records_are_private_listed_without_embeddings_and_deleted_completely(self):
        record = self.store.create(' Andy ', [[.1] * faces.EMBEDDING] * 6)
        path = self.root / 'people' / f'{record["id"]}.json'
        if os.name == 'posix':
            self.assertEqual(path.stat().st_mode & 0o777, 0o600); self.assertEqual(path.parent.stat().st_mode & 0o777, 0o700)
        self.assertEqual(record['consent']['statement'], CONSENT_STATEMENT)
        summary = self.store.summary(self.store.records()[0])
        self.assertEqual((summary['name'], summary['views'], summary['baseline']), ('Andy', 6, None))
        self.assertNotIn('embeddings', summary)
        self.store.delete(record['id'])
        self.assertFalse(path.exists()); self.assertEqual(self.store.records(), [])
        with self.assertRaises(KeyError): self.store.delete('../escape')
    def test_damaged_or_other_model_files_are_never_listed(self):
        record = self.store.create('Andy', [[.1] * faces.EMBEDDING] * 5)
        (self.root / 'people' / ('0' * 16 + '.json')).write_text('{broken')
        other = dict(record, id='1' * 16, models={'detector': 'x', 'recognizer': 'y'})
        (self.root / 'people' / ('1' * 16 + '.json')).write_text(json.dumps(other))
        self.assertEqual([r['id'] for r in self.store.records()], [record['id']])
    def test_confirmed_views_skip_duplicates_and_keep_the_newest_forty(self):
        from edge.people import append_view
        first = [1.0] + [0.0] * 127
        self.assertEqual(append_view([first], first), ([first], False))
        kept, added = append_view([first], [0.0, 1.0] + [0.0] * 126)
        self.assertTrue(added); self.assertEqual(len(kept), 2)
        full = [[float(i == j) for j in range(128)] for i in range(40)]
        kept, added = append_view(full, [.5] * 128)
        self.assertTrue(added); self.assertEqual(len(kept), 40); self.assertEqual(kept[-1], [.5] * 128)
    def test_the_store_has_a_limit(self):
        for i in range(PEOPLE_LIMIT): self.store.create(f'P{i}', [[.1] * faces.EMBEDDING] * 5)
        with self.assertRaises(OverflowError): self.store.create('One more', [[.1] * faces.EMBEDDING] * 5)


class ServiceTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.root = Path(self.temp.name)
        recordings = self.root / 'recordings'; recordings.mkdir()
        (recordings / 'clip.webm').write_bytes(b'\x1aE\xdf\xa3' + b'fixture')
        (self.root / 'model.onnx').write_bytes(b'fake'); (self.root / 'labels.json').write_text('["person"]')
        (self.root / 'rules.json').write_text('[{"name":"all","label":"person","rect":[0,0,1,1]}]')
        (self.root / 'det.onnx').write_bytes(b'det'); (self.root / 'rec.onnx').write_bytes(b'rec')
        self.config = self.root / 'config.json'
        self.config.write_text(json.dumps({'models': [{'id': 'model', 'name': 'Test', 'path': 'model.onnx', 'labels': 'labels.json',
            'profile': 'yolov8-raw-640', 'sha256': hashlib.sha256(b'fake').hexdigest()}],
            'rules': [{'id': 'rules', 'name': 'Presence', 'path': 'rules.json'}],
            'faces': {'detector': 'det.onnx', 'recognizer': 'rec.onnx'}}))
        self.calls = []; self.results = []
    def tearDown(self): self.temp.cleanup()
    def service(self, people=True):
        with patch('edge.local_service.verify_model', side_effect=lambda path, spec: path):
            catalog = load_catalog(self.config)
        def runner(payload): self.calls.append(payload); return self.results.pop(0)
        service = Jobs(self.root / 'recordings', catalog, people_dir=self.root / 'people' if people else None, face_runner=runner)
        self.recording = service.available()['recordings'][0]['id']
        return service
    def enroll(self, service, **change):
        body = {'name': 'Andy', 'consent': {'confirmed': True, 'statement': CONSENT_STATEMENT}, 'recording': self.recording, **change}
        return service.people_enroll(body)
    def error(self, call):
        with self.assertRaises(JobError) as raised: call()
        return raised.exception
    def test_face_models_must_match_the_pins_and_enrollment_is_off_by_default(self):
        with self.assertRaises(ValueError): load_catalog(self.config)  # det.onnx is not the pinned YuNet file.
        service = self.service(people=False)
        self.assertFalse(service.available()['people']['enabled'])
        self.assertEqual(self.error(service.people_list).code, 'PEOPLE_DISABLED')
    def test_consent_is_required_before_any_face_processing(self):
        service = self.service()
        for change in ({'consent': {'confirmed': False, 'statement': CONSENT_STATEMENT}}, {'consent': {'confirmed': True, 'statement': 'old'}},
                       {'name': ''}, {'name': 'a\nb'}, {'extra': 1}):
            with self.subTest(change=change):
                self.assertEqual(self.error(lambda: self.enroll(service, **change)).code, 'CONSENT')
        self.assertEqual(self.calls, [])
    def test_enrollment_needs_five_clear_views_then_saves_and_lists_without_embeddings(self):
        service = self.service()
        self.results = [{'checked': 20, 'usable': 3, 'reasons': {'dark': 12}, 'embeddings': [[.1] * faces.EMBEDDING] * 3}]
        error = self.error(lambda: self.enroll(service))
        self.assertEqual(error.code, 'FACE_QUALITY'); self.assertIn('too dark', str(error)); self.assertIn('Nothing was saved', str(error))
        self.assertEqual(service.people_list()['people'], [])
        self.results = [{'checked': 20, 'usable': 12, 'reasons': {}, 'embeddings': [[.1] * faces.EMBEDDING] * 6}]
        enrolled = self.enroll(service)
        self.assertEqual((enrolled['person']['name'], enrolled['person']['views']), ('Andy', 6))
        self.assertEqual(self.calls[-1]['mode'], 'enroll'); self.assertTrue(self.calls[-1]['video'].endswith('clip.webm'))
        self.assertNotIn('embeddings', json.dumps(service.people_list()))
    def test_baseline_check_records_the_rate_and_refines_the_template(self):
        service = self.service()
        self.results = [{'checked': 20, 'usable': 12, 'reasons': {}, 'embeddings': [[.1] * faces.EMBEDDING] * 6},
                        {'checked': 40, 'usable': 20, 'matched': 18, 'other': 0, 'reasons': {}, 'embeddings': [[.2] * faces.EMBEDDING] * 9}]
        person = self.enroll(service)['person']['id']
        checked = service.people_verify(person, {'recording': self.recording})
        self.assertEqual((checked['baseline']['rate'], checked['person']['views']), (.9, 9))
        self.assertEqual(self.calls[-1]['target'], person); self.assertEqual(len(self.calls[-1]['people']), 1)
        self.assertEqual(service.people_list()['people'][0]['baseline']['matched'], 18)
        self.assertEqual(self.error(lambda: service.people_verify('f' * 16, {'recording': self.recording})).code, 'NOT_FOUND')
        self.assertEqual(service.people_delete(person, {}), {'deleted': person})
        self.assertEqual(service.people_list()['people'], [])
    def test_worker_failures_and_invalid_results_save_nothing(self):
        service = self.service()
        for result, code in (({'error': 'VIDEO_OPEN_FAILED'}, 'VIDEO_OPEN_FAILED'), ({'error': 'whatever'}, 'FACE_FAILED'),
                             ({'checked': 1, 'usable': 9, 'embeddings': [[float('nan')] * faces.EMBEDDING] * 9}, 'FACE_FAILED'),
                             ({'checked': 1, 'usable': 9, 'embeddings': [[.1] * 5] * 9}, 'FACE_FAILED')):
            with self.subTest(code=code):
                self.results = [result]
                self.assertEqual(self.error(lambda: self.enroll(service)).code, code)
        self.assertEqual(service.people_list()['people'], [])
        self.assertFalse(service.face_busy)
    def identify_fixture(self, service):
        review = {'trace': {'frames': [
            {'frame_index': 0, 'detections': [{'label': 'person', 'score': .9, 'box': [.1, .1, .3, .6]},
                                              {'label': 'chair', 'score': .9, 'box': [.5, .5, .2, .2]}]},
            {'frame_index': 5, 'detections': [{'label': 'person', 'score': .2, 'box': [.2, .1, .1, .1]}]},
            {'frame_index': 10, 'detections': [{'label': 'person', 'score': .6, 'box': [.4, .2, .2, .5]}]}]}}
        (self.root / 'review.json').write_text(json.dumps(review))
        source = self.root / 'recordings' / 'clip.webm'
        service.artifact = lambda job, kind: (self.root / 'review.json', 'application/json') if kind == 'result' else (source, 'video/webm')
    def test_suggestions_use_person_boxes_keep_embeddings_in_the_service_and_confirm_once(self):
        service = self.service(); job = 'a' * 32
        self.assertEqual(self.error(lambda: service.people_identify({'job': job})).code, 'NO_PEOPLE')
        self.results = [{'checked': 20, 'usable': 12, 'reasons': {}, 'embeddings': [[1.0] + [0.0] * 127] * 6}]
        person = self.enroll(service)['person']['id']
        self.identify_fixture(service)
        view = [0.0, 1.0] + [0.0] * 126
        self.results = [{'faces': 2, 'matches': [{'frame_index': 10, 'box_index': 0, 'person': person, 'similarity': .61, 'embedding': view}]}]
        found = service.people_identify({'job': job})
        self.assertEqual(self.calls[-1]['frames'], [{'frame_index': 0, 'boxes': [[0, [.1, .1, .3, .6]]]},
                                                    {'frame_index': 10, 'boxes': [[0, [.4, .2, .2, .5]]]}])
        self.assertEqual(found['suggestions'], [{'frame_index': 10, 'box_index': 0, 'box': [.4, .2, .2, .5], 'person': person,
                                                 'name': 'Andy', 'similarity': .61}])
        self.assertNotIn('embedding', json.dumps(found))
        body = {'job': job, 'frame_index': 10, 'box_index': 0}
        self.assertEqual(self.error(lambda: service.people_confirm(person, {**body, 'job': 'b' * 32})).code, 'NOT_FOUND')
        self.assertEqual(self.error(lambda: service.people_confirm('f' * 16, body)).code, 'SELECTION')
        confirmed = service.people_confirm(person, body)
        self.assertEqual((confirmed['added'], confirmed['person']['views']), (True, 7))  # The worker de-duplicates enrollment.
        self.assertEqual(self.error(lambda: service.people_confirm(person, body)).code, 'NOT_FOUND')  # Each suggestion confirms once.
    def test_invalid_suggestions_are_rejected_and_deleting_a_person_drops_theirs(self):
        service = self.service(); job = 'a' * 32
        self.results = [{'checked': 20, 'usable': 12, 'reasons': {}, 'embeddings': [[.1] * faces.EMBEDDING] * 6}]
        person = self.enroll(service)['person']['id']
        self.identify_fixture(service)
        good = {'frame_index': 10, 'box_index': 0, 'person': person, 'similarity': .6, 'embedding': [.1] * faces.EMBEDDING}
        for bad in ({**good, 'box_index': 3}, {**good, 'frame_index': 5}, {**good, 'person': 'f' * 16},
                    {**good, 'embedding': [.1] * 3}, {**good, 'similarity': 2.0}):
            with self.subTest(bad=bad):
                self.results = [{'faces': 1, 'matches': [bad]}]
                self.assertEqual(self.error(lambda: service.people_identify({'job': job})).code, 'FACE_FAILED')
        self.results = [{'faces': 1, 'matches': [good]}]
        service.people_identify({'job': job})
        service.people_delete(person, {})
        self.assertEqual(service.suggestions['views'], {})
        self.assertEqual(self.error(lambda: service.people_identify({'job': 'not-a-job'})).code, 'SELECTION')
    def test_analysis_waits_for_face_processing(self):
        service = self.service(); service.face_busy = True
        error = self.error(lambda: service.start({'recording': self.recording, 'model': 'model', 'rules': 'rules'}))
        self.assertEqual((error.code, str(error)), ('BUSY', 'Wait for face processing to finish, then retry.'))
    def test_face_jobs_wait_for_imports_and_unknown_recordings_are_refused(self):
        service = self.service()
        service.importing = True
        self.assertEqual(self.error(lambda: self.enroll(service)).code, 'BUSY'); service.importing = False
        self.assertEqual(self.error(lambda: self.enroll(service, recording='0' * 32)).code, 'SELECTION')
        self.assertEqual(self.calls, [])


if __name__ == '__main__': unittest.main()
