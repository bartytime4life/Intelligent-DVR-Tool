import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
const root = path.resolve(process.argv[2] || process.cwd());
const require = createRequire(path.join(root, 'package.json'));
const vitePackage = require.resolve('vite/package.json');
const { build } = await import(pathToFileURL(path.join(path.dirname(vitePackage), 'dist/node/index.js')));
const sources = new Map();
function capture(dir) {
  for (const ent of readdirSync(dir, { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name))) {
    const file = path.join(dir, ent.name);
    if (ent.isDirectory()) capture(file);
    else if (/\.(?:m?js|jsx|css)$/.test(file)) sources.set(file, readFileSync(file, 'utf8'));
  }
}
capture(path.join(root, 'src'));
const before = new Map(sources);
const appFile = path.join(root, 'src/App.jsx');
let app = before.get(appFile);
assert(app.includes('const LiveMonitor = lazy(() => import("./LiveMonitor.jsx"));'));
app = app.replace('const LiveMonitor = lazy(() => import("./LiveMonitor.jsx"));', 'import LiveMonitor from "./LiveMonitor.jsx";');
const monitorStart = app.indexOf('{tab === "Monitor" &&');
const monitorEnd = app.indexOf('{tab === "Events" &&', monitorStart);
assert(monitorStart >= 0 && monitorEnd > monitorStart);
let region = app.slice(monitorStart, monitorEnd);
assert(region.includes('<Suspense fallback={<div className="content-page"><h1>Opening Monitor…</h1></div>}>'));
region = region.replace('<Suspense fallback={<div className="content-page"><h1>Opening Monitor…</h1></div>}>', '').replace('</Suspense></WorkspaceBoundary>', '</WorkspaceBoundary>');
app = app.slice(0, monitorStart) + region + app.slice(monitorEnd);
before.set(appFile, app);
const reportFile = path.join(root, 'src/recognition-report.mjs');
let report = before.get(reportFile);
const helperImports = "import { csvCell } from './csv.mjs';\nexport { csvCell } from './csv.mjs';\n";
assert(report.includes(helperImports));
report = report.replace(helperImports, '');
report = report.replace('export function reportCSV(report) {', `export const csvCell = v => { let s=String(v ?? ''); if (/^[\\s]*[=+\\-@]/.test(s)) s="'"+s; return '"'+s.replaceAll('"','""')+'"'; };\nexport function reportCSV(report) {`);
before.set(reportFile, report);
const queueFile = path.join(root, 'src/review-queue.mjs');
assert(before.get(queueFile).includes("import { csvCell } from './csv.mjs';"));
before.set(queueFile, before.get(queueFile).replace("import { csvCell } from './csv.mjs';", "import { csvCell } from './recognition-report.mjs';"));
const sha256 = value => createHash('sha256').update(value).digest('hex');
const sourceHashes = Object.fromEntries([...sources].map(([name,source]) => [path.relative(root,name),sha256(source)]));
const snapshotSha256 = sha256([...sources].map(([name,source]) => `${path.relative(root,name)}\0${sha256(source)}`).join('\n'));
function bytes(value) { return {bytes: Buffer.byteLength(value), gzip: gzipSync(value).length}; }
async function measure(snapshot, name) {
  const result = await build({root, logLevel:'silent', plugins:[{name:'measurement-source-snapshot', enforce:'pre', transform(code,id) {return snapshot.get(id.split('?')[0]) ?? null;}}], build:{write:false,reportCompressedSize:false}});
  const output = result.output, files = new Map(output.map(item=>[item.fileName,item]));
  const entry = output.find(item=>item.type === 'chunk' && item.isEntry);
  const monitor = output.find(item=>item.type === 'chunk' && Object.keys(item.modules).some(id=>id.endsWith('/src/LiveMonitor.jsx')));
  assert(entry && monitor);
  function closure(roots) {
    const included = new Set();
    function add(name) {
      if (included.has(name)) return;
      const file=files.get(name); if(!file) return;
      included.add(name);
      if(file.type === 'chunk') {file.imports.forEach(add); file.viteMetadata?.importedCss.forEach(add);}
    }
    roots.forEach(add); return [...included];
  }
  function summarize(names) {
    const items=names.map(name=>{const file=files.get(name),value=file.type === 'chunk'?file.code:file.source;return {file:name,kind:file.type === 'chunk'?'js':'css',...bytes(value)};});
    return {files:items,jsBytes:items.filter(item=>item.kind === 'js').reduce((sum,item)=>sum+item.bytes,0),jsGzip:items.filter(item=>item.kind === 'js').reduce((sum,item)=>sum+item.gzip,0)};
  }
  return {name,entry:summarize(closure([entry.fileName])),firstMonitor:summarize(closure([entry.fileName,monitor.fileName])),entryHasMonitor:Object.keys(entry.modules).some(id=>id.endsWith('/src/LiveMonitor.jsx')),entryHasReport:Object.keys(entry.modules).some(id=>id.endsWith('/src/recognition-report.mjs'))};
}
const baseline = await measure(before,'same snapshot with only csv/lazy Monitor patch reversed');
const after = await measure(sources,'current patch');
console.log(JSON.stringify({root,snapshotSha256,sourceHashes,baseline,after},null,2));
