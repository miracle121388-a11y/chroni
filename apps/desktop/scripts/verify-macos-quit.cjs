const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
if (process.platform !== 'darwin') throw new Error('This native quit check requires macOS.');
const root = path.resolve(__dirname, '..');
for (const stalled of [false, true]) {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'chroni-quit-check-'));
  try {
    fs.writeFileSync(path.join(fixture, 'package.json'), JSON.stringify({ main: 'main.cjs' }));
    fs.writeFileSync(path.join(fixture, 'index.html'), '<title>Chroni quit regression</title>');
    fs.writeFileSync(path.join(fixture, 'main.cjs'), `
      const {app} = require('electron');
      const fs = require('node:fs');
      const http = require('node:http');
      app.setPath('userData', ${JSON.stringify(path.join(fixture, 'data'))});
      app.whenReady().then(async () => {
        const {installAppShutdown} = await import(${JSON.stringify('file://' + path.join(root, 'dist/app-shutdown.js'))});
        const {createAppWindows} = await import(${JSON.stringify('file://' + path.join(root, 'dist/windows.js'))});
        const server = http.createServer((_, res) => res.end('fixture'));
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        installAppShutdown(app, async () => {
          await new Promise(resolve => setTimeout(resolve, 75));
          await new Promise(resolve => server.close(resolve));
          fs.writeFileSync(${JSON.stringify(path.join(fixture, 'released.json'))}, JSON.stringify({closed: !server.listening}));
        }, 300);
        createAppWindows();
        if (${stalled}) app.on('will-quit', event => event.preventDefault());
        setTimeout(() => { app.quit(); app.quit(); }, 250);
      });`);
    const env = { ...process.env, CHRONI_RENDERER_URL: 'file://' + path.join(fixture, 'index.html') };
    delete env.ELECTRON_RUN_AS_NODE;
    const result = spawnSync(require('electron'), [fixture], { env, timeout: 10000, encoding: 'utf8' });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(fixture, 'released.json'), 'utf8')), { closed: true });
    console.log('PASS: resources closed before process exit (' + (stalled ? 'stalled native quit fallback' : 'normal native quit') + ').');
  } finally { fs.rmSync(fixture, { recursive: true, force: true }); }
}
