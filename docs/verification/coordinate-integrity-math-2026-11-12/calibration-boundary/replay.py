#!/usr/bin/env python3
"""Storage/source-transport adapter around immutable calibration mathematics.

Only expands byte-bound data/checkers, transports baseline source/identity, and
copies imported helpers into the supplement's original snapshot layout. The
original mathematical checkers, expectations, tolerances and strict exits remain
unchanged. Adapter metadata separately binds every executed helper.
"""
import argparse,gzip,hashlib,io,json,re,runpy,shutil,subprocess,sys,tarfile
from pathlib import Path,PurePosixPath
sys.dont_write_bytecode=True
HERE=Path(__file__).resolve().parent
sha=lambda b:hashlib.sha256(b).hexdigest()
def verify():
 manifest=json.loads((HERE/'bundle-manifest.json').read_bytes())
 actual={p.relative_to(HERE).as_posix() for p in HERE.rglob('*') if p.is_file() and p.name!='bundle-manifest.json'}
 if actual!=set(manifest['files']):raise ValueError('Bundle inventory mismatch')
 for name,e in manifest['files'].items():
  p=PurePosixPath(name)
  if p.is_absolute() or '..' in p.parts:raise ValueError('Unsafe manifest path')
  raw=(HERE/name).read_bytes()
  if len(raw)!=e['bytes'] or sha(raw)!=e['sha256']:raise ValueError('Bundle hash mismatch: '+name)
  if name.endswith('.gz'):
   if raw[4:8]!=bytes(4) or raw[3]&8:raise ValueError('Nondeterministic gzip header: '+name)
   decoded=gzip.decompress(raw)
   if len(decoded)!=e['decodedBytes'] or sha(decoded)!=e['decodedSha256']:raise ValueError('Decoded hash mismatch: '+name)
 return manifest

def unpack(name,dest):
 dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(gzip.decompress((HERE/name).read_bytes()))
def preparation(dest):
 dest.mkdir(parents=True)
 with tarfile.open(fileobj=io.BytesIO(gzip.decompress((HERE/'preparation-v1.tar.gz').read_bytes())),mode='r:') as archive:
  for m in archive.getmembers():
   p=PurePosixPath(m.name)
   if not m.isfile() or p.is_absolute() or '..' in p.parts:raise ValueError('Unsafe preparation member')
   target=dest/m.name;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(archive.extractfile(m).read())
def main():
 p=argparse.ArgumentParser(description=__doc__)
 p.add_argument('mode',choices=['verify','baseline-main','baseline-pr117','baseline-turns','candidate','candidate-turns','reference'])
 p.add_argument('--repo',type=Path,default=Path.cwd());p.add_argument('--out',type=Path)
 args=p.parse_args();manifest=verify()
 if args.mode=='verify':print(json.dumps({'verifiedFiles':len(manifest['files'])}));return 0
 if args.out is None:p.error('--out is required')
 out=args.out.resolve();out.mkdir(parents=True,exist_ok=False);harness=out/'harness';harness.mkdir()
 for file in (HERE/'frozen').iterdir():unpack(file.relative_to(HERE).as_posix(),harness/file.name[:-3])
 for file in (HERE/'data').iterdir():unpack(file.relative_to(HERE).as_posix(),harness/file.name[:-3])
 repo=args.repo.resolve();mode=args.mode;baseline=mode.startswith('baseline');turns=mode.endswith('turns');oldOutput=subprocess.check_output;oldCopy=shutil.copyfile;sourceFiles={};sourcePaths={}
 if mode=='reference':
  saved=out/'original-preparation';preparation(saved)
  for name in ['inputs.json','expected.json','freeze-receipt.json']:(harness/name).unlink()
  subprocess.check_call([sys.executable,str(harness/'freeze-corpus.py')])
  for name in ['inputs.json','expected.json']:
   if (harness/name).read_bytes()!=(saved/name).read_bytes():raise ValueError('Original reference regeneration differs: '+name)
  shutil.copyfile(saved/'check-hull.py',harness/'check-hull.py')
  shutil.copytree(saved/'pr117-baseline',harness/'pr117-baseline')
  subprocess.check_call([sys.executable,str(harness/'correct-eligibility.py')])
  for name in ['turn-inputs.json','turn-expected.json','turn-freeze-receipt.json']:(harness/name).unlink()
  subprocess.check_call([sys.executable,str(harness/'freeze-nonzero-turns.py')])
  for name in ['inputs.json','expected.json','turn-inputs.json','turn-expected.json']:
   if (harness/name).read_bytes()!=gzip.decompress((HERE/'data'/f'{name}.gz').read_bytes()):raise ValueError('Final reference regeneration differs: '+name)
  record={'schema':'dvr-calibration-boundary-reference-replay-v1','adapterSha256':sha(Path(__file__).read_bytes()),'bundleManifestSha256':sha((HERE/'bundle-manifest.json').read_bytes()),'referenceBytesRegeneratedIdentically':True,'strictExitCode':0}
  (out/'replay.json').write_text(json.dumps(record,indent=2,sort_keys=True)+'\n');return 0
 if baseline:
  label='main33fedd1' if mode=='baseline-main' else 'pr117'
  repo=out/'baseline-source';unpack(f'baseline-source/{label}/src/facility-calibration.mjs.gz',repo/'src/facility-calibration.mjs')
  retained=json.loads(gzip.decompress((HERE/'retained'/f'{label}-receipt.json.gz').read_bytes()))
  if sha((repo/'src/facility-calibration.mjs').read_bytes())!=retained['sourceFiles']['src/facility-calibration.mjs']:raise ValueError('Baseline source binding mismatch')
  def git_transport(command,*a,**kw):
   if command==['git','rev-parse','HEAD']:
    value=retained['sourceRevision']+'\n';return value if kw.get('text') or kw.get('universal_newlines') else value.encode()
   return oldOutput(command,*a,**kw)
  subprocess.check_output=git_transport
 module=repo/'src/facility-calibration.mjs'
 def copy_dependencies(source,dest):
  name=source.relative_to(repo).as_posix();data=source.read_bytes();sourceFiles[name]=sha(data);sourcePaths[name]=dest
  for dependency in re.findall(r'''(?:from\s*|import\s*)['"]([^'"]+)['"]''',data.decode()):
   if not dependency.startswith('.'):raise ValueError('Review new nonrelative dependency: '+dependency)
   origin=(source.parent/dependency).resolve();origin.relative_to(repo)
   target=(dest.parent/dependency).resolve();target.relative_to(out)
   depname=origin.relative_to(repo).as_posix()
   if depname in sourceFiles:continue
   target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(origin.read_bytes());copy_dependencies(origin,target)
 def copy_transport(source,dest,*a,**kw):
  value=oldCopy(source,dest,*a,**kw)
  if Path(source).resolve()==module.resolve():copy_dependencies(module,Path(dest).resolve())
  return value
 checker=harness/('check-turns.py' if turns else 'check-hull.py')
 if turns:shutil.copyfile=copy_transport
 argv=[str(checker),'--module' if turns else '--repo',str(module if turns else repo),'--out',str(out/'result'),'--require-pass']
 oldArgv=sys.argv;sys.argv=argv;code=0
 try:runpy.run_path(str(checker),run_name='__main__')
 except SystemExit as e:code=e.code if isinstance(e.code,int) else 1
 finally:subprocess.check_output=oldOutput;shutil.copyfile=oldCopy;sys.argv=oldArgv
 receipt=out/'result/receipt.json';result=json.loads(receipt.read_bytes())
 if not turns:sourceFiles=result['sourceFiles']
 else:
  for name,dest in sourcePaths.items():
   if sha(dest.read_bytes())!=sourceFiles[name]:raise ValueError('Transport snapshot changed: '+name)
  if sourceFiles['src/facility-calibration.mjs']!=result['sourceSha256']:raise ValueError('Original checker source mismatch')
 record={'schema':'dvr-calibration-boundary-portable-replay-v1','mode':mode,'adapterSha256':sha(Path(__file__).read_bytes()),'bundleManifestSha256':sha((HERE/'bundle-manifest.json').read_bytes()),'originalCheckerSha256':sha(checker.read_bytes()),'sourceTransport':'hash-bound packaged baseline and explicit revision metadata' if baseline else 'current checkout; supplement imports copied byte-for-byte beside original snapshot','sourceFiles':sourceFiles,'receipt':'result/receipt.json','receiptSha256':sha(receipt.read_bytes()),'strictExitCode':code,'mathematicsOrExpectationsPatched':False}
 (out/'replay.json').write_text(json.dumps(record,indent=2,sort_keys=True)+'\n');return code
if __name__=='__main__':raise SystemExit(main())
