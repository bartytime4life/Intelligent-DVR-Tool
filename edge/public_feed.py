"""Opt-in HTTPS webcam images. Fixed owner catalog, pinned public IPv4, verified TLS."""
import http.client
import ipaddress
import re
import socket
import ssl
import time

MAX_IMAGE = 2 * 1024 * 1024
MAX_PIXELS = 1920 * 1080
KINDS = ('public-jpeg', 'public-mjpeg')


def domain(value):
    if (not isinstance(value, str) or len(value) > 253 or
            not re.fullmatch(r'(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}', value)):
        raise ValueError('Use a lowercase public DNS hostname, without a URL, port or IP address')
    if value.endswith(('.localhost', '.local', '.internal', '.test', '.invalid', '.example')):
        raise ValueError('Use the documented public provider hostname')
    return value


def public_source(item):
    allowed = {'id', 'name', 'kind', 'host', 'path', 'provider', 'provider_url', 'permission', 'refresh_seconds'}
    if set(item) - allowed or item.get('kind') not in KINDS or item.get('permission') != 'public-viewing':
        raise ValueError('Approve only a documented provider-permitted public JPEG/MJPEG source')
    domain(item.get('host'))
    path = item.get('path')
    if (not isinstance(path, str) or not re.fullmatch(r'/[A-Za-z0-9_~.!$&\x27()*+,;=:@%/?-]{0,1023}', path)
            or path.startswith('//')):
        raise ValueError('Use the provider direct image path; no full URL, fragment or control characters')
    provider = item.get('provider')
    if not isinstance(provider, str) or not 1 <= len(provider) <= 80 or any(ord(c) < 32 for c in provider):
        raise ValueError('Include the public webcam provider attribution')
    page = item.get('provider_url')
    if not isinstance(page, str) or not re.fullmatch(r'https://[a-z0-9.-]+/[A-Za-z0-9_~.!$&\x27()*+,;=:@%/?-]{0,1023}', page):
        raise ValueError('Include an HTTPS provider page without credentials, fragment or custom port')
    domain(page.split('/')[2])
    refresh = item.get('refresh_seconds', 60)
    if type(refresh) is not int or not 30 <= refresh <= 3600:
        raise ValueError('Public snapshot refresh must be 30–3600 seconds; respect the provider cadence')
    if item['kind'] == 'public-mjpeg' and 'refresh_seconds' in item:
        raise ValueError('refresh_seconds applies to JPEG snapshots only')
    return {**item, **({'refresh_seconds': refresh} if item['kind'] == 'public-jpeg' else {})}


def resolve_public(host, resolver=socket.getaddrinfo):
    """Validate every returned address, then use an exact IPv4 without resolving again."""
    addresses = resolver(host, 443, socket.AF_UNSPEC, socket.SOCK_STREAM)
    if not addresses or len(addresses) > 32:
        raise ValueError('Unsupported DNS answer')
    ipv4 = []
    for family, _, _, _, address in addresses:
        ip = ipaddress.ip_address(address[0])
        if not ip.is_global or ip.is_multicast or ip.is_reserved or ip.is_unspecified:
            raise ValueError('Public webcams cannot address private, local or reserved networks')
        if family == socket.AF_INET and isinstance(ip, ipaddress.IPv4Address):
            ipv4.append(str(ip))
    if not ipv4:
        raise ValueError('An approved public IPv4 answer is required')
    return sorted(set(ipv4))[0]


class PinnedHTTPS(http.client.HTTPSConnection):
    def connect(self):
        address = resolve_public(self.host)
        raw = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            raw.settimeout(5)
            raw.connect((address, 443))
            self.sock = self._context.wrap_socket(raw, server_hostname=self.host)
        except BaseException:
            raw.close()
            raise


def open_image(source, factory=PinnedHTTPS):
    connection = factory(source['host'], port=443, timeout=5, context=ssl.create_default_context())
    try:
        connection.request('GET', source['path'], headers={
            'Accept': 'image/jpeg' if source['kind'] == 'public-jpeg' else 'multipart/x-mixed-replace',
            'Accept-Encoding': 'identity', 'User-Agent': 'Intelligent-DVR-local-preview/1', 'Connection': 'close'})
        response = connection.getresponse()
        if (response.status != 200 or response.getheader('Location') is not None or
                response.getheader('Content-Encoding', 'identity').lower() != 'identity' or
                sum(len(k) + len(v) for k, v in response.getheaders()) > 16 * 1024):
            raise ValueError('Unsupported response; redirects, authentication and encoded bodies are refused')
        return connection, response
    except BaseException:
        connection.close()
        raise


def jpeg_dimensions(data):
    """Check JPEG SOF dimensions before invoking the native decoder."""
    if not data.startswith(b'\xff\xd8') or not data.endswith(b'\xff\xd9') or len(data) > MAX_IMAGE:
        raise ValueError('Invalid JPEG')
    offset = 2
    while offset + 4 <= len(data):
        if data[offset] != 255:
            raise ValueError('Invalid JPEG marker')
        while offset < len(data) and data[offset] == 255:
            offset += 1
        if offset >= len(data):
            break
        marker = data[offset]; offset += 1
        if marker in (0, 0xD8, 0xD9, 0xDA) or 0xD0 <= marker <= 0xD7:
            break
        length = int.from_bytes(data[offset:offset+2], 'big')
        if length < 2 or offset + length > len(data):
            raise ValueError('Invalid JPEG segment')
        if marker in (0xC0, 0xC1, 0xC2):
            if length < 8:
                raise ValueError('Invalid JPEG dimensions')
            height = int.from_bytes(data[offset+3:offset+5], 'big')
            width = int.from_bytes(data[offset+5:offset+7], 'big')
            if not 0 < width * height <= MAX_PIXELS or max(width, height) > 4096:
                raise ValueError('Use a public image at or below 1080p')
            return width, height
        offset += length
    raise ValueError('Unsupported JPEG structure')


def image_bytes(response, length=None):
    if length is not None and not 4 <= length <= MAX_IMAGE:
        raise ValueError('Oversized image')
    end, data = time.monotonic() + 8, bytearray()
    while length is None or len(data) < length:
        if time.monotonic() > end:
            raise ValueError('Image deadline exceeded')
        block = response.read1(min(65536, (length - len(data)) if length else MAX_IMAGE + 1 - len(data)))
        if not block:
            break
        data.extend(block)
        if len(data) > MAX_IMAGE:
            raise ValueError('Oversized image')
    if length is not None and len(data) != length:
        raise ValueError('Incomplete image')
    jpeg_dimensions(data)
    return bytes(data)


def mjpeg_images(response):
    content_type = response.getheader('Content-Type', '')
    match = re.fullmatch(r'multipart/x-mixed-replace\s*;\s*boundary="?([A-Za-z0-9_-]{1,70})"?', content_type, re.I)
    if not match:
        raise ValueError('Use a direct MJPEG endpoint with a supported boundary')
    boundary = b'--' + match[1].encode('ascii')
    while True:
        line = response.readline(128)
        if line == b'\r\n':
            line = response.readline(128)
        if line.rstrip(b'\r\n') == boundary + b'--':
            return
        if line != boundary + b'\r\n':
            raise ValueError('Invalid multipart boundary')
        headers, total = {}, 0
        while True:
            line = response.readline(4096); total += len(line)
            if total > 8192 or not line.endswith(b'\r\n'):
                raise ValueError('Oversized multipart header')
            if line == b'\r\n':
                break
            key, sep, value = line.partition(b':'); key = key.lower()
            if not sep or key in headers:
                raise ValueError('Invalid multipart headers')
            headers[key] = value.strip()
        if headers.get(b'content-type', b'').lower() != b'image/jpeg' or b'content-length' not in headers:
            raise ValueError('MJPEG parts must be length-bounded JPEG images')
        yield image_bytes(response, int(headers[b'content-length']))


def publish(data, directory):
    from .local_feeds import LIMITS
    import cv2
    import numpy as np
    expected = jpeg_dimensions(data)
    frame = cv2.imdecode(np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_COLOR)
    if frame is None or (frame.shape[1], frame.shape[0]) != expected:
        raise ValueError('JPEG decode failed')
    scale = min(1, LIMITS['preview_width'] / max(frame.shape[:2]))
    if scale < 1:
        frame = cv2.resize(frame, (max(1, int(expected[0] * scale)), max(1, int(expected[1] * scale))))
    ok, encoded = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 75])
    if not ok or len(encoded) > LIMITS['frame_bytes']:
        raise ValueError('Preview frame too large')
    temporary = directory / 'frame.tmp'
    temporary.write_bytes(encoded.tobytes()); temporary.replace(directory / 'frame.jpg')


def capture_public(source, directory):
    from .local_feeds import LIMITS
    import cv2
    cv2.setNumThreads(1)
    source = public_source(source)
    began = time.monotonic()
    while time.monotonic() - began < LIMITS['session_seconds']:
        connection, response = open_image(source)
        try:
            if source['kind'] == 'public-jpeg':
                if response.getheader('Content-Type', '').split(';')[0].strip().lower() != 'image/jpeg':
                    raise ValueError('Use the direct JPEG endpoint, not a website or player')
                publish(image_bytes(response), directory)
            else:
                for data in mjpeg_images(response):
                    now = time.monotonic()
                    if now - began >= LIMITS['session_seconds']:
                        return
                    publish(data, directory)
                    time.sleep(max(0, 1 / LIMITS['preview_fps'] - (time.monotonic() - now)))
                return
        finally:
            connection.close()
        time.sleep(source['refresh_seconds'])  # Explicit snapshot polling only; no automatic recovery after errors.
