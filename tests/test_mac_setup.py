import contextlib
import errno
import io
import os
from pathlib import Path
import socket
import sys
import tempfile
import unittest
from unittest.mock import patch

from edge import mac_setup as mac, pc_setup as pc


class MacSetupTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)
        for name in ('index.html','package.json','package-lock.json','vite.config.mjs',
                     'scripts/prepare-sites-build.mjs','.openai/hosting.json','worker/index.js',
                     'src/main.jsx','public/icon.svg','dist/client/index.html'):
            file=self.root/name;file.parent.mkdir(parents=True,exist_ok=True);file.write_text('original')
        (self.root/'node_modules').mkdir()
        self.lock=self.root/'node_modules/.dvr-lock.sha256'
        self.stamp=self.root/'dist/.mac-source.sha256'
        self.lock.write_text(pc.digest(self.root/'package-lock.json'))
        self.stamp.write_text(mac.frontend_fingerprint(self.root))
    def tearDown(self):self.temp.cleanup()

    def frontend(self):
        return patch.object(mac.pc,'command',side_effect=lambda args,*a,**kw:'22\n' if '-p' in args else None)

    def test_same_content_needs_no_build_but_changes_and_deletions_do(self):
        with patch('shutil.which',side_effect=lambda n:n),self.frontend() as run:
            mac.ensure_frontend(self.root)
            self.assertEqual(run.call_count,1)
            (self.root/'scripts/prepare-sites-build.mjs').write_text('changed build')
            mac.ensure_frontend(self.root)
            self.assertIn(['npm','run','build'],[c.args[0] for c in run.call_args_list])
            run.reset_mock();(self.root/'public/icon.svg').unlink()
            mac.ensure_frontend(self.root)
            self.assertIn(['npm','run','build'],[c.args[0] for c in run.call_args_list])

    def test_changed_lock_reinstalls_before_build_and_keeps_private_files(self):
        private=self.root/'local-analysis/recordings/keep.webm';private.parent.mkdir(parents=True);private.write_bytes(b'private')
        (self.root/'package-lock.json').write_text('new dependencies')
        with patch('shutil.which',side_effect=lambda n:n),self.frontend() as run:
            mac.ensure_frontend(self.root)
        commands=[c.args[0] for c in run.call_args_list]
        self.assertEqual(commands[1],['npm','ci','--ignore-scripts','--no-audit','--no-fund'])
        self.assertEqual(commands[2],['npm','run','build'])
        self.assertEqual(private.read_bytes(),b'private')

    def test_failed_build_cannot_leave_a_valid_source_stamp(self):
        original=(self.root/'src/main.jsx').read_text();(self.root/'src/main.jsx').write_text('changed')
        with patch('shutil.which',side_effect=lambda n:n),patch.object(pc,'command',side_effect=['22',pc.SetupError('build failed')]):
            with self.assertRaises(pc.SetupError):mac.ensure_frontend(self.root)
        (self.root/'src/main.jsx').write_text(original)
        self.assertFalse(self.stamp.exists())
        with patch('shutil.which',side_effect=lambda n:n),self.frontend() as run:
            mac.ensure_frontend(self.root)
        self.assertIn(['npm','run','build'],[c.args[0] for c in run.call_args_list])

    def test_partial_analysis_never_silently_falls_back_to_preview(self):
        self.assertEqual(mac.analysis_options(self.root),[])
        folder=self.root/'local-analysis';folder.mkdir();(folder/'keep').write_bytes(b'private')
        with self.assertRaisesRegex(pc.SetupError,'incomplete'):mac.analysis_options(self.root)
        (folder/'catalog.json').write_text('{malformed')
        with self.assertRaisesRegex(pc.SetupError,'verification'):mac.analysis_options(self.root)
        self.assertEqual((folder/'keep').read_bytes(),b'private')

    @unittest.skipIf(os.name=='nt','POSIX directory links')
    def test_linked_analysis_folder_is_refused_without_touching_its_contents(self):
        target=self.root/'private';target.mkdir();(target/'catalog.json').write_bytes(b'private')
        (self.root/'local-analysis').symlink_to(target,target_is_directory=True)
        with self.assertRaisesRegex(pc.SetupError,'linked directory'):mac.analysis_options(self.root)
        self.assertEqual((target/'catalog.json').read_bytes(),b'private')

    def test_occupied_port_explains_old_instance_without_stopping_it_or_building(self):
        with patch.object(mac.socket,'socket') as create:
            create.return_value.__enter__.return_value.bind.side_effect=OSError(errno.EADDRINUSE,'busy')
            with self.assertRaisesRegex(pc.SetupError,'No process was stopped'):mac.ensure_port_available(4180)
        with patch.object(mac,'host_check'),patch.object(mac,'ensure_port_available',side_effect=pc.SetupError('busy')), \
             patch.object(mac,'ensure_frontend') as build,contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(mac.main([]),1)
        build.assert_not_called()

    def test_launch_verifies_runtime_and_enables_only_configured_analysis(self):
        options=['--recordings','local-analysis/recordings','--config','local-analysis/catalog.json',
                 '--allow-recording-import','--allow-training','--allow-face-enrollment']
        with patch.object(mac,'host_check'),patch.object(mac,'ensure_port_available'), \
             patch.object(mac,'analysis_options',return_value=options),patch.object(mac,'ensure_frontend',return_value='npm'), \
             patch.object(pc,'validate_environment',return_value=Path('python')),patch.object(pc,'command') as native, \
             patch.object(pc,'create_settings'),patch('os.execv') as launch:
            self.assertEqual(mac.main(['--no-browser']),0)
        self.assertIn('--native-probe',native.call_args.args[0])
        command=launch.call_args.args[1]
        self.assertIn('--allow-face-enrollment',command)
        self.assertNotIn('--open-browser',command)
        self.assertEqual(command[-2:],['--port','4180'])

    def test_readiness_report_is_exclusive_and_skip_port_is_explicit(self):
        report=self.root/'ready.json'
        with patch.object(mac,'host_check'),patch.object(mac,'analysis_options',return_value=[]), \
             patch.object(pc,'check',return_value={'ready':True,'checks':[]}) as check, \
             contextlib.redirect_stdout(io.StringIO()),contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(mac.main(['--check','--skip-port-check','--report',str(report)]),0)
            self.assertFalse(check.call_args.kwargs['bind'])
            original=report.read_bytes()
            self.assertEqual(mac.main(['--check','--report',str(report)]),1)
        self.assertEqual(report.read_bytes(),original)
        if os.name!='nt':self.assertEqual(report.stat().st_mode & 0o777,0o600)

    def test_platform_pins_and_memory_claim_are_separate_from_pc(self):
        pins=pc.pins((mac.ROOT/pc.MAC_REQUIREMENTS).read_text())
        self.assertEqual(pins,{'opencv-python-headless':'4.14.0.94','numpy':'2.5.4','av':'19.0.2'})
        with patch.object(pc.sys,'platform','darwin'):
            self.assertEqual(pc.requirements_file(),pc.MAC_REQUIREMENTS)
            with patch('platform.machine',return_value='x86_64'),self.assertRaises(pc.SetupError):pc.host_check()
        with patch.object(pc.sys,'platform','linux'):
            self.assertEqual(pc.requirements_file(),pc.REQUIREMENTS)

    @unittest.skipUnless(os.environ.get('DVR_TEST_SOCKETS')=='1' and sys.platform in ('linux','darwin'),'Explicit local socket checks')
    def test_duplicate_and_restart_against_actual_listener(self):
        with socket.socket() as listener:
            listener.bind(('127.0.0.1',0));listener.listen();port=listener.getsockname()[1]
            with self.assertRaisesRegex(pc.SetupError,'already in use'):mac.ensure_port_available(port)
        mac.ensure_port_available(port)
