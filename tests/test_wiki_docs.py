"""Publication boundaries for generated Wiki pages and public media."""
import importlib.util
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('wiki_docs', ROOT / 'scripts/build-wiki.py')
wiki = importlib.util.module_from_spec(spec)
spec.loader.exec_module(wiki)


class WikiPublicationTests(unittest.TestCase):
    def test_every_top_level_guide_has_a_wiki_page(self):
        self.assertTrue({p.relative_to(ROOT).as_posix() for p in (ROOT / 'docs').glob('*.md')} <= wiki.PAGES.keys())
        self.assertEqual(len(wiki.PAGES), len(set(wiki.PAGES.values())))

    def test_links_pin_code_but_keep_guides_and_media_inside_wiki(self):
        sha = '2' * 40
        pages, assets = wiki.generated(sha)
        home = pages['Home.md']
        self.assertIn(wiki.BASE + '/wiki/Visual-handbook', home)
        self.assertIn(wiki.WIKI_RAW + 'docs/media/guide/overview.jpg', home)
        self.assertIn(wiki.BASE + '/blob/' + sha + '/README.md', home)
        self.assertIn('/wiki/Mac-setup#preserve-data-when-updating', pages['Security-boundary.md'])
        self.assertGreater(len(assets), 23)
        for asset in assets:
            self.assertTrue(asset.startswith('docs/media/'))
            self.assertTrue((ROOT / asset).is_file())
        self.assertIn(wiki.BASE + '/blob/' + sha + '/edge/requirements-macos.txt', pages['Mac-setup.md'])

    def test_only_project_wiki_clone_is_accepted(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp)
            subprocess.run(['git', 'init', '-q', str(target)], check=True)
            subprocess.run(['git', '-C', str(target), 'remote', 'add', 'origin', wiki.BASE + '.git'], check=True)
            with self.assertRaisesRegex(ValueError, 'separate .wiki.git'):
                wiki.wiki_target(target)
            subprocess.run(['git', '-C', str(target), 'remote', 'set-url', 'origin', wiki.BASE + '.wiki.git'], check=True)
            self.assertEqual(wiki.wiki_target(target), target.resolve())
            with self.assertRaises(ValueError):
                wiki.wiki_target(target / 'nested')

    def test_staging_preserves_unknown_pages_and_check_is_read_only(self):
        with tempfile.TemporaryDirectory() as tmp:
            dest = Path(tmp)
            unknown = dest / 'Owner-notes.md'
            unknown.write_text('Keep the owner’s existing notes.')
            files = {'Home.md': b'New home', 'docs/media/image.jpg': b'public fixture'}
            wiki.write_files(dest, files)
            wiki.write_files(dest, files, check=True)
            self.assertEqual(unknown.read_text(), 'Keep the owner’s existing notes.')
            (dest / 'Home.md').write_bytes(b'changed')
            with self.assertRaises(ValueError):
                wiki.write_files(dest, {'../escape.md': b'no'})
            with self.assertRaisesRegex(ValueError, 'Wiki drift'):
                wiki.write_files(dest, files, check=True)
            self.assertEqual((dest / 'Home.md').read_bytes(), b'changed')

    @unittest.skipIf(os.name == "nt", "Symlink creation needs a Windows privilege; traversal is checked separately")
    def test_symlink_or_traversal_refused_before_any_writes(self):
        with tempfile.TemporaryDirectory() as tmp, tempfile.TemporaryDirectory() as outside:
            dest = Path(tmp)
            (dest / 'docs').symlink_to(outside, target_is_directory=True)
            with self.assertRaises(ValueError):
                wiki.write_files(dest, {'Home.md': b'do not write', 'docs/secret.jpg': b'no'})
            self.assertFalse((dest / 'Home.md').exists())
            with self.assertRaises(ValueError):
                wiki.write_files(dest, {'../escape.md': b'no'})
            with self.assertRaises(ValueError):
                wiki.wiki_target(dest / 'docs')

    def test_private_or_outside_media_never_enters_write_set(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve()
            (root / 'docs').mkdir()
            (root / 'private.jpg').write_bytes(b'private')
            (root / 'docs/guide.md').write_text('![do not publish](../private.jpg)')
            with patch.object(wiki, 'ROOT', root), patch.object(wiki, 'PAGES', {'docs/guide.md': 'Home'}):
                with self.assertRaisesRegex(ValueError, 'reviewed public documentation media'):
                    wiki.generated()
            (root / 'docs/guide.md').write_text('[outside](../../outside.md)')
            with patch.object(wiki, 'ROOT', root), patch.object(wiki, 'PAGES', {'docs/guide.md': 'Home'}):
                with self.assertRaisesRegex(ValueError, 'outside-repository'):
                    wiki.generated()

    def test_source_ref_cannot_inject_a_link(self):
        for bad in ('feature/branch', '../main', '" onclick="x', 'abcd', '2' * 39):
            with self.assertRaises(ValueError):
                wiki.generated(bad)


if __name__ == '__main__':
    unittest.main()
