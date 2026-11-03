import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir, mkdtemp, writeFile, rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {dirname,join,relative} from 'node:path';
import {createServer} from 'vite';
import config from '../vite.config.mjs';

test('development serves the frontend but refuses private runtime files and raw module requests', {skip:process.env.DVR_TEST_SOCKETS !== '1'}, async () => {
  assert.equal(config.server.host, '127.0.0.1');
  assert.equal(config.preview.host, '127.0.0.1');
  const root = fileURLToPath(new URL('../', import.meta.url));
  await mkdir(new URL('../qa-local/',import.meta.url),{recursive:true});
  const fixture = await mkdtemp(join(root,'qa-local','dev-private-'));
  const sentinel = 'test-only-private-dvr-bytes';
  const paths = ['local-feeds.json','local-analysis/recordings/test.webm','local-analysis/people/test.json','Intelligent-DVR-Backup/library.sqlite3','arbitrary-private.json'];
  for (const path of paths) {
    await mkdir(dirname(join(fixture,path)),{recursive:true});
    await writeFile(join(fixture,path),sentinel);
  }
  const server=await createServer({...config,configFile:false,root,cacheDir:join(fixture,'vite-cache'),logLevel:'silent',optimizeDeps:{noDiscovery:true,include:[]},
    server:{...config.server,port:0,strictPort:false,preTransformRequests:false,warmup:{clientFiles:[]}}});
  try {
    await server.listen();
    const base=`http://127.0.0.1:${server.httpServer.address().port}`;
    assert.equal((await fetch(base+'/')).status,200);
    assert.equal((await fetch(base+'/src/main.jsx')).status,200);
    for(const path of paths) for(const url of ['/'+relative(root,join(fixture,path)).replaceAll('\\','/'),'/@fs/'+join(fixture,path).replaceAll('\\','/')+'?raw']) {
      const response=await fetch(base+url);
      assert.equal(response.status,403,url);
      assert.equal((await response.text()).includes(sentinel),false);
    }
  } finally {await server.close();await rm(fixture,{recursive:true,force:true});}
});
