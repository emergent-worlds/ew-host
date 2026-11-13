// Install the Bun message listener synchronously, before any awaited import.
const node = typeof Bun === 'undefined' ? await import('node:worker_threads') : undefined;
const send = node ? value => node.parentPort.postMessage(value) : value => postMessage(value);
const receive = message => {
  if (message.type === 'grant') {
    send({ ew: 1, type: 'file.read', id: 1, path: 'notes.txt' });
  } else if (message.type === 'reply' && message.reply_to === 1) {
    send({ ew: 1, type: 'status', line: message.result.data });
  } else if (message.type === 'state.read') {
    if (message.path === 'exit') process.exit(0);
    if (message.path === 'error') throw new Error('synthetic worker failure');
    send({ ew: 1, type: 'reply', reply_to: message.id, ok: true, result: { path: message.path } });
  }
};
if (node) node.parentPort.on('message', receive);
else addEventListener('message', event => receive(event.data));
send({ ew: 1, type: 'ready', protocol: 1 });
