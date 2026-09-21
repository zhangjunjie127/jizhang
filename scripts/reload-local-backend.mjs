import WebSocket from 'ws';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { openSync, closeSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync, backup } from 'node:sqlite';

// Attach only to the known local backend; never print its credentials.
const pid = Number(process.argv[2]);
const restart = process.argv.includes('--restart');
assert(Number.isInteger(pid) && pid > 0);
const [target] = await (await fetch('http://127.0.0.1:9229/json/list')).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
let sequence = 0;
function command(method, params = {}) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const listener = raw => {
      const reply = JSON.parse(raw);
      if (reply.id !== id) return;
      ws.off('message', listener);
      if (reply.error || reply.result.exceptionDetails) reject(new Error(`Backend inspection failed: ${method}`));
      else resolve(reply.result);
    };
    ws.on('message', listener);
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  return (await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result.value;
}
try {
  assert.equal(await evaluate('process.pid'), pid);
  const scripts = [];
  ws.on('message', raw => {
    const message = JSON.parse(raw);
    if (message.method === 'Debugger.scriptParsed') scripts.push(message.params);
  });
  await command('Debugger.enable');
  const domain = scripts.find(script => script.url.endsWith('/server/domain.mjs'));
  assert(domain, 'Backend domain module not found');
  const { scriptSource } = await command('Debugger.getScriptSource', { scriptId: domain.scriptId });
  console.log(`Running backend has task category validation: ${scriptSource.includes("record.category = input.category ?? '其他'")}`);
  if (restart) {
    const configuration = await evaluate(`Object.fromEntries(['CPA_BASE_URL','CPA_API_KEY','CPA_TEXT_MODEL','CPA_VOICE_MODEL','INVITE_CODE','HOST','PORT','DATA_DIR','NODE_EXTRA_CA_CERTS','NODE_TLS_REJECT_UNAUTHORIZED'].filter(k=>process.env[k]!==undefined).map(k=>[k,process.env[k]]))`);
    assert(configuration.CPA_BASE_URL && configuration.CPA_API_KEY && configuration.INVITE_CODE, 'Missing live configuration; restart cancelled');
    const executable = await evaluate('process.execPath');
    const cwd = await evaluate('process.cwd()');
    const data = configuration.DATA_DIR || join(cwd, 'data');
    mkdirSync(join(data, 'backups'), { recursive: true });
    const db = new DatabaseSync(join(data, 'app.sqlite'), { readOnly: true });
    await backup(db, join(data, 'backups', `before-category-reload-${Date.now()}.sqlite`));
    const counts = () => Object.fromEntries(['users', 'records', 'messages', 'sessions'].map(table => [table, db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count]));
    const before = counts();
    ws.close();
    process.kill(pid);
    for (let i = 0; i < 50; i++) {
      try { process.kill(pid, 0); } catch { break; }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const out = openSync(new URL('../artifacts/backend-runtime.log', import.meta.url), 'a');
    const child = spawn(executable, ['server/index.mjs'], { cwd, env: { ...process.env, ...configuration }, detached: true, windowsHide: true, stdio: ['ignore', out, out] });
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    child.unref();
    closeSync(out);
    console.log(`Backend restarted: ${child.pid}`);
    const origin = `http://${configuration.HOST || '127.0.0.1'}:${configuration.PORT || 8787}`;
    let healthy = false;
    for (let i = 0; i < 50; i++) {
      try {
        const health = await (await fetch(`${origin}/api/health`)).json();
        if (health.ok && health.ai) { healthy = true; break; }
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    assert(healthy, 'Restarted backend health check failed');
    assert.deepEqual(counts(), before);
    db.close();
    console.log('Health and AI configuration OK; account, record, message and session counts unchanged.');
  }
} finally {
  ws.close();
}
