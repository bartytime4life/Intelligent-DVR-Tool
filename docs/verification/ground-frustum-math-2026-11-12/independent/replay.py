#!/usr/bin/env python3
"""Portable transport/storage adapter around unchanged mathematical checkers.

This adapter only materializes frozen inputs/source and routes baseline Git
transport to hash-verified packaged public bytes. It does not patch mathematical
code, expected values, tolerances, eligibility rules or strict exit gates.
"""
import argparse,gzip,hashlib,io,json,runpy,shutil,subprocess,sys,tarfile
from pathlib import Path,PurePosixPath
sys.dont_write_bytecode=True
HERE=Path(__file__).resolve().parent
sha=lambda b:hashlib.sha256(b).hexdigest()

def verify():
 manifest=json.loads((HERE/'bundle-manifest.json').read_text())
 for name,entry in manifest['files'].items():
  path=HERE/name;raw=path.read_bytes()
  if len(raw)!=entry['bytes'] or sha(raw)!=entry['sha256']:raise ValueError('Bundle binding mismatch: '+name)
  if name.endswith('.gz'):
   if raw[4:8]!=b'\0\0\0\0' or raw[3]&8:raise ValueError('Nondeterministic gzip header: '+name)
   decoded=gzip.decompress(raw)
   if len(decoded)!=entry['decodedBytes'] or sha(decoded)!=entry['decodedSha256']:raise ValueError('Decoded binding mismatch: '+name)
 return manifest

def unpack(name,destination):
 destination.parent.mkdir(parents=True,exist_ok=True)
 destination.write_bytes(gzip.decompress((HERE/name).read_bytes()))
def copy_frozen(prefix,destination):
 destination.mkdir(parents=True)
 for file in (HERE/'frozen'/prefix).iterdir():
  if file.is_file():
   if file.name.endswith('.gz'):unpack(file.relative_to(HERE).as_posix(),destination/file.name[:-3])
   else:shutil.copyfile(file,destination/file.name)
def baseline_source(destination):
 manifest=json.loads((HERE/'baseline-source-manifest.json').read_text())
 destination.mkdir(parents=True)
 with tarfile.open(fileobj=io.BytesIO(gzip.decompress((HERE/'baseline-source.tar.gz').read_bytes())),mode='r:') as archive:
  members=archive.getmembers()
  if len(members)!=len(manifest['files']):raise ValueError('Baseline source count mismatch')
  for member in members:
   name=PurePosixPath(member.name)
   if not member.isfile() or name.is_absolute() or '..' in name.parts or member.name not in manifest['files']:raise ValueError('Unsafe/unexpected baseline archive member')
   data=archive.extractfile(member).read()
   if sha(data)!=manifest['files'][member.name]:raise ValueError('Baseline source mismatch: '+member.name)
   path=destination/member.name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(data)
 return manifest

def main():
 parser=argparse.ArgumentParser(description=__doc__)
 parser.add_argument('mode',choices=['verify','baseline31','candidate31','baseline42','candidate42','consumers42','oracle42'])
 parser.add_argument('--repo',type=Path,default=Path.cwd(),help='Source checkout with npm ci dependencies, required for candidate modes')
 parser.add_argument('--out',type=Path,help='New output directory; no files are written to the checkout')
 parser.add_argument('--source-snapshot',type=Path,help='candidate42 output/result/snapshot, required for consumers42')
 args=parser.parse_args();manifest=verify()
 if args.mode=='verify':print(json.dumps({'verifiedFiles':len(manifest['files'])}));return 0
 if args.out is None:parser.error('--out is required')
 out=args.out.resolve();out.mkdir(parents=True,exist_ok=False);harness=out/'harness';repo=args.repo.resolve();mode=args.mode
 if mode.endswith('31'):
  copy_frozen('ideal31',harness);unpack('data/inputs31.json.gz',harness/'inputs.json')
  unpack('retained/baseline31-receipt.json.gz',harness/'baseline-authoritative/receipt.json')
  unpack('data/expected31.json.gz',harness/'baseline-authoritative/expected.json')
  checker=harness/('check-frustum.py' if mode=='baseline31' else 'check-candidate31.py')
 else:
  copy_frozen('walls42',harness);unpack('data/inputs42.json.gz',harness/'inputs.json');unpack('data/expected42.json.gz',harness/'expected.json')
  shutil.copyfile(HERE/'data/expected42-receipt.json',harness/'expected-receipt.json')
  checker=harness/('freeze-expected.py' if mode=='oracle42' else 'check-metrics.py' if mode=='consumers42' else 'check-wall.py')
 sourceManifest=None;originalCheckOutput=subprocess.check_output
 if mode.startswith('baseline'):
  source=out/'baseline-source';sourceManifest=baseline_source(source)
  if mode=='baseline31':repo=source
  wallReceipt=json.loads(gzip.decompress((HERE/'retained/baseline42-receipt.json.gz').read_bytes()))
  def baseline_transport(command,*positional,**keywords):
   if command==['git','rev-parse','HEAD']:
    value=sourceManifest['sourceRevision']+'\n'
    return value if keywords.get('text') or keywords.get('universal_newlines') else value.encode()
   if isinstance(command,list) and len(command)==3 and command[:2]==['git','show']:
    revision,name=command[2].split(':',1)
    if revision!=wallReceipt['sourceRevision'] or name not in wallReceipt['sourceFiles']:raise ValueError('Unexpected baseline Git request')
    value=(source/name).read_bytes()
    if sha(value)!=wallReceipt['sourceFiles'][name]:raise ValueError('Baseline Git-source binding mismatch')
    return value.decode() if keywords.get('text') or keywords.get('universal_newlines') else value
   return originalCheckOutput(command,*positional,**keywords)
  subprocess.check_output=baseline_transport
 if mode=='oracle42':argv=[str(checker)]
 elif mode=='consumers42':
  if args.source_snapshot is None:parser.error('--source-snapshot is required for consumers42')
  argv=[str(checker),'--repo',str(repo),'--source-snapshot',str(args.source_snapshot.resolve()),'--out',str(out/'result'),'--require-pass']
 else:
  argv=[str(checker),'--repo',str(repo),'--out',str(out/'result'),'--require-pass']
  if mode.endswith('42'):argv+=['--mode','baseline' if mode=='baseline42' else 'candidate']
 before=list(sys.argv);sys.argv=argv;sys.path.insert(0,str(harness));exitCode=0
 try:
  runpy.run_path(str(checker),run_name='__main__')
 except SystemExit as error:exitCode=error.code if isinstance(error.code,int) else 1
 finally:
  subprocess.check_output=originalCheckOutput;sys.argv=before;sys.path.pop(0)
 if mode=='oracle42':
  expected=harness/'expected.json';receipt=harness/'expected-receipt.json'
  frozen=gzip.decompress((HERE/'data/expected42.json.gz').read_bytes())
  if expected.read_bytes()!=frozen:exitCode=1
 else:receipt=out/'result/receipt.json'
 record={'schema':'dvr-frustum-portable-replay-v1','mode':mode,'adapterSha256':sha(Path(__file__).read_bytes()),'bundleManifestSha256':sha((HERE/'bundle-manifest.json').read_bytes()),'originalCheckerSha256':sha(checker.read_bytes()),'sourceTransport':'hash-verified frozen public archive and explicit Git metadata transport' if mode.startswith('baseline') else 'current source checkout and installed public npm dependencies','receipt':receipt.relative_to(out).as_posix(),'receiptSha256':sha(receipt.read_bytes()) if receipt.is_file() else None,'strictExitCode':exitCode,'mathOrExpectationsPatched':False}
 (out/'replay.json').write_text(json.dumps(record,indent=2,sort_keys=True)+'\n')
 return exitCode
if __name__=='__main__':raise SystemExit(main())
