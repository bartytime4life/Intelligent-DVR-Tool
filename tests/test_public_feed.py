import io
import json
from pathlib import Path
import socket
import tempfile
import unittest
from unittest.mock import Mock, patch

from edge import public_feed as public
from edge.local_feeds import Feeds, load_sources

SOURCE = {'id':'public-garden', 'name':'Public garden', 'kind':'public-jpeg',
          'host':'cams.provider.org', 'path':'/garden.jpg', 'provider':'Example provider',
          'provider_url':'https://www.provider.org/webcams/', 'permission':'public-viewing', 'refresh_seconds':60}


def jpeg(width=64, height=48):
    return b'\xff\xd8\xff\xc0\x00\x08\x08' + height.to_bytes(2,'big') + width.to_bytes(2,'big') + b'\x01\xff\xd9'


class Response(io.BytesIO):
    status = 200
    def __init__(self, data=b'', **headers):
        super().__init__(data); self.headers = headers or {'Content-Type':'image/jpeg'}
    def getheader(self, name, default=None): return self.headers.get(name, default)
    def getheaders(self): return list(self.headers.items())


class PublicFeedTest(unittest.TestCase):
    def test_catalog_is_offline_explicit_and_redacts_endpoint(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'sources.json';path.write_text(json.dumps({'sources':[SOURCE]}))
            with patch('socket.getaddrinfo', side_effect=AssertionError('No DNS on load')), patch('socket.socket', side_effect=AssertionError('No network on load')):
                sources=load_sources(path); service=Feeds(sources)
                try:
                    self.assertEqual(service.sessions,{})
                    info=service.available(); self.assertEqual(info['sources'][0]['kind'],'public-jpeg')
                    self.assertEqual(info['sources'][0]['provider'],SOURCE['provider'])
                    self.assertNotIn('/garden.jpg',json.dumps(info))
                    self.assertNotIn('cams.provider.org',json.dumps(info))
                finally: service.close()

    def test_unapproved_credentialed_malformed_and_unsafe_configs_refused(self):
        changes=[{'permission':False},{'permission':'open'}, {'host':'127.0.0.1'}, {'host':'metadata.google.internal'},
                 {'host':'camera.local'}, {'host':'https://cams.provider.org'}, {'host':'cams.provider.org:443'},
                 {'host':'cams.provider.org@evil.org'}, {'host':'user:pass@cams.provider.org'},
                 {'path':'//evil.org/x'}, {'path':'/x\r\nHost: evil'}, {'path':'/x#fragment'}, {'path':'/x\\evil'},
                 {'username':'viewer'}, {'password':'secret'}, {'port':80}, {'url':'http://evil.org'},
                 {'provider_url':'javascript:alert(1)'}, {'provider_url':'https://user:pass@www.provider.org/'},
                 {'provider_url':'https://127.0.0.1/'}, {'refresh_seconds':True}, {'refresh_seconds':1},
                 {'refresh_seconds':3601}, {'kind':'public-mjpeg'}, {'provider':''}]
        for change in changes:
            with self.subTest(change=change),self.assertRaises((ValueError,TypeError)):
                public.public_source({**SOURCE,**change})
        mjpeg={k:v for k,v in {**SOURCE,'kind':'public-mjpeg'}.items() if k!='refresh_seconds'}
        self.assertEqual(public.public_source(mjpeg),mjpeg)

    def test_dns_private_mixed_rebinding_and_ipv6_only_fail_closed(self):
        def answer(ip):return (socket.AF_INET6 if ':' in ip else socket.AF_INET,socket.SOCK_STREAM,6,'',(ip,443))
        for ips in (['127.0.0.1'],['169.254.169.254'],['192.168.1.1'],['100.64.0.1'],['224.0.0.1'],
                    ['0.0.0.0'],['::1'],['fc00::1'],['::ffff:127.0.0.1'],['8.8.8.8','10.0.0.1'],['2001:4860:4860::8888']):
            with self.subTest(ips=ips),self.assertRaises(ValueError):
                public.resolve_public(SOURCE['host'],lambda *a:[answer(ip) for ip in ips])
        calls=[]
        def resolver(*args):calls.append(args);return [answer('8.8.8.8')]
        self.assertEqual(public.resolve_public(SOURCE['host'],resolver),'8.8.8.8');self.assertEqual(len(calls),1)

    def test_tls_connects_exact_validated_ip_preserving_hostname(self):
        context=Mock();raw=Mock()
        with patch.object(public,'resolve_public',return_value='8.8.8.8') as resolve,patch.object(public.socket,'socket',return_value=raw):
            connection=public.PinnedHTTPS(SOURCE['host'],context=context);connection.connect()
        resolve.assert_called_once_with(SOURCE['host']);raw.connect.assert_called_once_with(('8.8.8.8',443))
        context.wrap_socket.assert_called_once_with(raw,server_hostname=SOURCE['host'])
        # TLS errors propagate and release the socket; certificate verification is never disabled.
        context.wrap_socket.side_effect=OSError('TLS failed')
        with patch.object(public,'resolve_public',return_value='8.8.8.8'),patch.object(public.socket,'socket',return_value=raw):
            with self.assertRaises(OSError):public.PinnedHTTPS(SOURCE['host'],context=context).connect()
        raw.close.assert_called()

    def test_redirects_auth_html_encoding_and_excess_headers_not_followed(self):
        for status,headers in [(302,{'Location':'http://169.254.169.254/'}),(401,{}),
                              (200,{'Location':'https://other.org/'}),(200,{'Content-Encoding':'gzip'}),
                              (200,{'X-Oversized':'x'*17000})]:
            response=Response(**headers);response.status=status;connection=Mock();connection.getresponse.return_value=response
            with self.subTest(status=status,headers=list(headers)),self.assertRaises(ValueError):
                public.open_image(SOURCE,lambda *a,**k:connection)
            connection.request.assert_called_once();connection.close.assert_called_once()
        connection=Mock();connection.getresponse.return_value=Response()
        public.open_image(SOURCE,lambda *a,**k:connection)
        headers=connection.request.call_args.kwargs['headers']
        for name in ('Authorization','Cookie','Referer','Origin','Proxy-Authorization'):self.assertNotIn(name,headers)

    def test_bounded_images_reject_truncation_bombs_and_unsupported_jpeg(self):
        self.assertEqual(public.jpeg_dimensions(jpeg()),(64,48))
        self.assertEqual(public.image_bytes(Response(jpeg())),jpeg())
        for data in (b'<html>not an image</html>',jpeg(4096,4096),jpeg()[:-3],b'\xff\xd8'+b'x'*(public.MAX_IMAGE+1)):
            with self.subTest(length=len(data)),self.assertRaises(ValueError):public.image_bytes(Response(data))
        for length in (3,public.MAX_IMAGE+1,100):
            with self.assertRaises(ValueError):public.image_bytes(Response(jpeg()),length)

    def test_mjpeg_success_and_unsupported_multipart_are_bounded(self):
        image=jpeg(); part=b'--camera\r\nContent-Type: image/jpeg\r\nContent-Length: '+str(len(image)).encode()+b'\r\n\r\n'+image
        response=Response(part+b'\r\n'+part+b'\r\n--camera--\r\n',**{'Content-Type':'multipart/x-mixed-replace; boundary=camera'})
        self.assertEqual(list(public.mjpeg_images(response)),[image,image])
        for data in (part.replace(b'Content-Length:',b'X-Length:'),part.replace(b'image/jpeg',b'text/html'),
                     part.replace(b'\r\n\r\n',b'\r\nContent-Length: 4\r\n\r\n'),b'--camera\r\nX: '+b'x'*9000):
            with self.assertRaises(ValueError):list(public.mjpeg_images(Response(data,**{'Content-Type':'multipart/x-mixed-replace; boundary=camera'})))

    def test_snapshot_lifecycle_staleness_cancel_and_recovery(self):
        from test_local_feeds import Process
        now=[100.];processes=[]
        def spawn(*a,**k):p=Process();processes.append(p);return p
        service=Feeds({SOURCE['id']:SOURCE},process_factory=spawn,clock=lambda:now[0])
        try:
            state=service.connect({'source':SOURCE['id']});directory=Path(service.sessions[state['id']]['directory'].name)
            (directory/'frame.jpg').write_bytes(jpeg());self.assertEqual(service.status(state['id'])['state'],'live')
            for _ in range(7):
                now[0]+=10;self.assertEqual(service.status(state['id'])['state'],'live')
            now[0]+=3
            self.assertEqual(service.status(state['id'])['error']['code'],'STALE')
            self.assertTrue(processes[-1].killed);self.assertFalse(directory.exists())
            retry=service.connect({'source':SOURCE['id']});self.assertEqual(retry['state'],'connecting')
            service.disconnect(retry['id']);self.assertTrue(processes[-1].killed)
        finally:service.close()


class NativePublicImageTest(unittest.TestCase):
    def test_capture_snapshot_and_mjpeg_publish_real_native_images(self):
        try:import cv2,numpy as np
        except ImportError:self.skipTest('Install pinned native requirements')
        _,encoded=cv2.imencode('.jpg',np.full((48,64,3),80,dtype=np.uint8));image=encoded.tobytes()
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);connection=Mock()
            with patch.object(public,'open_image',return_value=(connection,Response(image))) as request, \
                    patch.object(public.time,'sleep',side_effect=InterruptedError('test stop after first snapshot')):
                with self.assertRaises(InterruptedError):public.capture_public(SOURCE,root)
            self.assertEqual(request.call_count,1);connection.close.assert_called_once()
            self.assertEqual(cv2.imread(str(root/'frame.jpg')).shape[:2],(48,64))
            source={k:v for k,v in {**SOURCE,'kind':'public-mjpeg'}.items() if k!='refresh_seconds'}
            part=b'--camera\r\nContent-Type: image/jpeg\r\nContent-Length: '+str(len(image)).encode()+b'\r\n\r\n'+image+b'\r\n--camera--\r\n'
            with patch.object(public,'open_image',return_value=(connection,Response(part,**{'Content-Type':'multipart/x-mixed-replace; boundary=camera'}))):
                public.capture_public(source,root)
            self.assertEqual(cv2.imread(str(root/'frame.jpg')).shape[:2],(48,64))
            for headers in ({'Content-Type':'text/html'},{'Content-Type':'application/vnd.apple.mpegurl'}):
                with patch.object(public,'open_image',return_value=(connection,Response(image,**headers))) as request:
                    with self.assertRaises(ValueError):public.capture_public(SOURCE,root)
                self.assertEqual(request.call_count,1)

    def test_real_jpeg_decode_resize_publish_and_bad_image_recovery(self):
        try:import cv2,numpy as np
        except ImportError:self.skipTest('Install pinned native requirements')
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);ok,encoded=cv2.imencode('.jpg',np.full((1080,1920,3),80,dtype=np.uint8));self.assertTrue(ok)
            public.publish(encoded.tobytes(),root)
            frame=cv2.imread(str(root/'frame.jpg'));self.assertEqual(frame.shape[:2],(540,960))
            with self.assertRaises(ValueError):public.publish(jpeg(),root)
            public.publish(encoded.tobytes(),root);self.assertLess((root/'frame.jpg').stat().st_size,512*1024)


if __name__=='__main__':unittest.main()
