import { createServer } from 'node:net';
import { createHash } from 'node:crypto';
import { realpath } from 'node:fs/promises';

// OS-owned lifetime lock, acquired before opening or recovering SQLite jobs.
// Windows named pipes avoid stale PID files and survive neither crashes nor exits.
export async function acquireEngineOwnership(dataDirectory) {
  const canonical = await realpath(dataDirectory);
  const key = createHash('sha256').update(process.platform === 'win32' ? canonical.toLowerCase() : canonical).digest('hex');
  const endpoint = process.platform === 'win32'
    ? `\\\\.\\pipe\\vyrealm-engine-${key}`
    : { host: '127.0.0.1', port: 40000 + parseInt(key.slice(0, 6), 16) % 20000, exclusive: true };
  const server = createServer(socket => socket.end());
  await new Promise((resolve, reject) => {
    server.once('error', error => reject(Object.assign(new Error(`Project store is already open or its ownership endpoint is unavailable. Close the other VYREALM engine before opening ${canonical}.`), { code: 'ENGINE_STORE_IN_USE', cause: error })));
    server.listen(endpoint, resolve);
  });
  server.unref();
  let released = false;
  return async () => { if (released) return; released = true; await new Promise(resolve => server.close(resolve)); };
}
