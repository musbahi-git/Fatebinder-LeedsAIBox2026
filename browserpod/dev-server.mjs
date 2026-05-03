// browserpod/dev-server.mjs
// Static file server for the Fatebinder client inside BrowserPod.
// Serves /app/client/index.html and all assets on port 3000 (or PORT env var).
//
// Usage:  node dev-server.mjs
//         PORT=3000 node dev-server.mjs

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = process.env.PORT || 3000;
const CLIENT_DIR = '/app/client';
const TYPES = {
  '.html': 'text/html',
  '.js':   'application/javascript',
  '.mjs':  'application/javascript',
  '.css':  'text/css',
  '.json': 'application/json',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.wasm': 'application/wasm',
};

const server = createServer(async (req, res) => {
  try {
    let urlPath = req.url.split('?')[0];
    if (urlPath === '/') urlPath = '/index.html';

    const filePath = join(CLIENT_DIR, urlPath);

    // Safety: stay inside CLIENT_DIR
    const real = await stat(filePath).catch(() => null);
    if (!real || !real.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found: ' + urlPath);
      return;
    }

    const ext  = extname(filePath).toLowerCase();
    const mime = TYPES[ext] || 'application/octet-stream';

    const body = await readFile(filePath);
    res.writeHead(200, {
      'Content-Type': mime,
      'Cache-Control': 'no-cache',
    });
    res.end(body);
  } catch (err) {
    console.error('[dev-server] Error:', err);
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Internal Server Error');
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[dev-server] Fatebinder client listening on http://0.0.0.0:${PORT}`);
});