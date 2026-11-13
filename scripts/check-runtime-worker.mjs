import assert from 'node:assert/strict';
import { workerTransport } from '../src/worker.ts';
const fixture = new URL('../test/fixtures/worker-core.mjs', import.meta.url);
const WorkerType = typeof Bun === 'undefined' ? (await import('node:worker_threads')).Worker : Worker;

async function check(ending) {
  const worker = new WorkerType(fixture);
  const transport = workerTransport(worker);
  let seen;
  const status = new Promise(resolve => { seen = resolve; });
  let nextId = 2;
  const pending = new Map();
  transport.onMessage(message => {
    if (message.type === 'ready') transport.send({ type: 'grant' });
    else if (message.type === 'file.read') transport.send({ type: 'reply', reply_to: message.id, ok: true, result: { data: 'fixture linked' } });
    else if (message.type === 'status') seen(message.line);
    else if (message.type === 'reply') { pending.get(message.reply_to)?.resolve(message.result); pending.delete(message.reply_to); }
  });
  transport.onClose(error => { for (const call of pending.values()) call.reject(error); pending.clear(); });
  const request = path => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    try { transport.send({ type: 'state.read', id, path }); }
    catch (error) { reject(error); }
  });
  try {
    assert.equal(await status, 'fixture linked');
    assert.deepEqual(await request('values'), { path: 'values' });
    await assert.rejects(request(ending), /worker connection (?:closed|failed)/);
    assert.throws(() => transport.send({ type: 'input' }), /worker connection/);
  } finally { transport.close(); }

}

await check('exit');
await check('error');
console.log(JSON.stringify({ runtime: typeof Bun === 'undefined' ? process.version : `Bun ${Bun.version}`, actualWorkers: 2, exchange: 'pass', exit: 'pass', failure: 'pass' }));
