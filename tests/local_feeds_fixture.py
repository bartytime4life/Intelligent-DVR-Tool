"""Synthetic RTSP/JPEG server for integration tests. Never camera/accuracy evidence."""
import base64
import io
import socketserver
import struct
import threading
import time
from pathlib import Path


def jpeg_payloads():
    import cv2
    import numpy as np
    frame=np.zeros((240,320,3),dtype=np.uint8)
    frame[:]=(45,85,65)
    cv2.putText(frame,'SYNTHETIC TEST',(20,120),cv2.FONT_HERSHEY_SIMPLEX,.6,(220,230,230),1)
    ok,encoded=cv2.imencode('.jpg',frame,[cv2.IMWRITE_JPEG_QUALITY,75])
    if not ok: raise RuntimeError('JPEG fixture encoder unavailable')
    data=encoded.tobytes(); index=2; tables={}; scan=None
    while index < len(data):
        marker=data[index+1]; length=int.from_bytes(data[index+2:index+4],'big'); body=data[index+4:index+2+length]
        if marker==0xDB:
            offset=0
            while offset<len(body):
                table=body[offset]; size=64 if table>>4==0 else 128
                tables[table&15]=body[offset+1:offset+1+size];offset+=size+1
        if marker==0xDA:
            scan=data[index+2+length:-2];break
        index+=2+length
    if scan is None or len(tables.get(0,b''))!=64 or len(tables.get(1,b''))!=64:
        raise RuntimeError('Unexpected JPEG fixture')
    result=[]
    for offset in range(0,len(scan),900):
        header=b'\0'+offset.to_bytes(3,'big')+bytes([1,255,40,30])
        if offset==0: header+=b'\0\0\0\x80'+tables[0]+tables[1]
        result.append(header+scan[offset:offset+900])
    return result


class SyntheticRtsp(socketserver.ThreadingTCPServer):
    allow_reuse_address=True
    daemon_threads=True
    def __init__(self):
        self.payloads=jpeg_payloads(); self.redirects=0; self.disconnect_after=None
        super().__init__(('127.0.0.1',0),RtspHandler)
        self.thread=threading.Thread(target=self.serve_forever,daemon=True);self.thread.start()
    def close(self): self.shutdown();self.server_close();self.thread.join()


class RtspHandler(socketserver.StreamRequestHandler):
    def handle(self):
        self.request.settimeout(30);self.lock=threading.Lock();self.done=threading.Event()
        sender=None
        try:
            while True:
                first=self.rfile.read(1)
                if not first:break
                if first==b'$':
                    h=self.rfile.read(3);self.rfile.read(int.from_bytes(h[1:],'big'));continue
                line=(first+self.rfile.readline(4096)).decode('ascii'); method,url,_=line.strip().split(' ',2)
                headers={}
                while True:
                    line=self.rfile.readline(8192)
                    if line==b'\r\n':break
                    key,value=line.decode('ascii').split(':',1);headers[key.lower()]=value.strip()
                cseq=headers.get('cseq','1'); extra=''; body=b''; status='200 OK'
                if '/redirect' in url:
                    status='302 Found';extra='Location: rtsp://127.0.0.1:9/forbidden\r\n';self.server.redirects+=1
                elif '/missing' in url:status='404 Not Found'
                elif '/stall' in url:
                    self.done.wait(20);break
                elif headers.get('authorization')!='Basic '+base64.b64encode(b'viewer:fixture-secret').decode():
                    status='401 Unauthorized';extra='WWW-Authenticate: Basic realm="synthetic"\r\n'
                elif method=='OPTIONS':extra='Public: OPTIONS, DESCRIBE, SETUP, PLAY, GET_PARAMETER, TEARDOWN\r\n'
                elif method=='DESCRIBE':
                    body=b'v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\ns=Synthetic integration test\r\nc=IN IP4 127.0.0.1\r\nt=0 0\r\na=control:*\r\nm=video 0 RTP/AVP 26\r\na=rtpmap:26 JPEG/90000\r\na=control:trackID=0\r\n'
                    extra='Content-Type: application/sdp\r\n'
                elif method=='SETUP':extra='Session: fixture;timeout=30\r\nTransport: RTP/AVP/TCP;unicast;interleaved=0-1\r\n'
                elif method in ('PLAY','GET_PARAMETER','TEARDOWN'):extra='Session: fixture\r\n'
                reply=f'RTSP/1.0 {status}\r\nCSeq: {cseq}\r\n{extra}Content-Length: {len(body)}\r\n\r\n'.encode()+body
                with self.lock:self.request.sendall(reply)
                if method=='PLAY' and status=='200 OK' and sender is None:
                    sender=threading.Thread(target=self.send_frames,daemon=True);sender.start()
                if method=='TEARDOWN':break
        except (OSError,ValueError):pass
        finally:
            self.done.set()
            if sender:sender.join(timeout=1)
    def send_frames(self):
        seq,stamp,frames=0,0,0
        try:
            while not self.done.is_set():
                frames += 1
                if self.server.disconnect_after is not None and frames > self.server.disconnect_after:
                    self.request.shutdown(2)
                    return
                for i,payload in enumerate(self.server.payloads):
                    packet=struct.pack('!BBHII',128,26|(128 if i==len(self.server.payloads)-1 else 0),seq,stamp,1)+payload
                    with self.lock:self.request.sendall(b'$\0'+len(packet).to_bytes(2,'big')+packet)
                    seq=(seq+1)%65536
                stamp=(stamp+9000)%2**32
                self.done.wait(.1)
        except OSError: self.done.set()


def sources(port):
    return {name:{'id':name,'name':f'Synthetic RTSP {name}', 'host':'127.0.0.1','port':port,'path':'/'+name,
                  'username':'viewer','password':'fixture-secret'} for name in ('video','missing','stall','redirect')}


def port(default):
    """Optional --port N, so parallel checkouts can run the browser suites side by side."""
    import sys
    return int(sys.argv[sys.argv.index('--port')+1]) if '--port' in sys.argv else default


if __name__=='__main__':
    from edge.local_feeds import Feeds
    from edge.local_service import LocalServer
    fixture=SyntheticRtsp();feeds=Feeds(sources(fixture.server_address[1]))
    try:
        with LocalServer(port(4184),None,Path('dist/client'),feeds) as server:
            print('Synthetic-only RTSP browser fixture ready',flush=True);server.serve_forever()
    finally:feeds.close();fixture.close()
