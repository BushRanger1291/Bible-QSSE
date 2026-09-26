const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file));
test('manifest points to valid PNG icons with the declared dimensions', () => {
  const manifest = JSON.parse(read('bible-qsse-v7.webmanifest'));
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.id, './');
  for (const icon of manifest.icons) {
    const bytes = read(icon.src);
    assert.deepEqual([...bytes.subarray(0, 8)], [137,80,78,71,13,10,26,10]);
    assert.equal(icon.sizes, bytes.readUInt32BE(16)+'x'+bytes.readUInt32BE(20));
  }
  assert.ok(manifest.icons.some(icon => icon.sizes === '192x192'));
  assert.ok(manifest.icons.some(icon => icon.sizes === '512x512'));
});
function worker(overrides = {}) {
  const events = {};
  const scope = 'https://example.com/Bible-QSSE/';
  vm.runInNewContext(read('sw.js').toString(), {
    URL, Request, Response,
    self: {registration:{scope},addEventListener:(name,fn)=>events[name]=fn,skipWaiting:async()=>{},clients:{claim:async()=>{}}},
    ...overrides
  });
  return events;
}
test('install refreshes every shell asset, including both new icons', async () => {
  let requests, pending;
  const events = worker({caches:{open:async()=>({addAll:async values=>requests=values})}});
  events.install({waitUntil:promise=>pending=promise});
  await pending;
  assert.ok(requests.every(request=>request.cache==='reload'));
  for (const request of requests) {
    const filename = new URL(request.url).pathname.split('/').pop();
    assert.ok(fs.existsSync(path.join(root, filename)),filename);
  }
  assert.ok(requests.some(request=>request.url.endsWith('skull-512-v7.png')));
});
test('activation preserves other applications caches', async () => {
  const deleted=[];let pending;
  const events=worker({caches:{keys:async()=>['bible-qsse-v4','bible-qsse-v6','bible-qsse-v7','orion-v1'],delete:async key=>deleted.push(key)}});
  events.activate({waitUntil:promise=>pending=promise});await pending;
  assert.deepEqual(deleted,['bible-qsse-v4','bible-qsse-v6']);
});
test('offline navigation with a query string returns the cached application', async () => {
  let pending;
  const events=worker({fetch:async()=>{throw new Error('offline')},caches:{match:async key=>{assert.equal(key,'https://example.com/Bible-QSSE/index.html?v=7');return new Response('offline shell')}}});
  events.fetch({request:{url:'https://example.com/Bible-QSSE/?v=7',method:'GET',mode:'navigate'},respondWith:promise=>pending=promise});
  assert.equal(await (await pending).text(),'offline shell');
});
