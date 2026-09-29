const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.wasm': 'application/wasm', '.bin': 'application/octet-stream',
  '.elf': 'application/octet-stream', '.txt': 'text/plain; charset=utf-8',
};

function safeFile(root, pathname) {
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { return null; }
  if (decoded.includes('\0') || decoded.includes('\\')) return null;
  const parts = decoded.split('/').filter(Boolean);
  if (parts.some(part => part === '..' || part === '.')) return null;
  const result = path.resolve(root, ...parts);
  if (result !== root && !result.startsWith(root + path.sep)) return null;
  try {
    const realRoot = fs.realpathSync(root);
    const realFile = fs.realpathSync(result);
    if (realFile !== realRoot && !realFile.startsWith(realRoot + path.sep)) return null;
    return realFile;
  } catch { return result; }
}

function createHandler({ root, entryPath, protocol, onEvent = () => {} }) {
  const entryUrl = '/' + entryPath.split('/').map(encodeURIComponent).join('/');
  return (req, res) => {
    let pathname;
    try {
      pathname = req.url.split('?')[0];
      if (!pathname.startsWith('/')) throw new Error('Invalid request path');
    } catch { res.writeHead(400).end(); return; }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
    if (pathname === '/' || /^\/document\/[a-z-]+\/ps5\/?$/.test(pathname)) {
      res.writeHead(302, { Location: entryUrl, 'Cache-Control': 'no-store' }).end();
      onEvent({ type: 'webRequest', protocol, path: pathname, status: 302, userAgent: req.headers['user-agent'] || '' });
      return;
    }
    const file = safeFile(root, pathname);
    let stat;
    try { stat = file && fs.statSync(file); } catch { stat = null; }
    if (!stat?.isFile()) {
      res.writeHead(file ? 404 : 403, { 'Cache-Control': 'no-store' }).end();
      onEvent({ type: 'webRequest', protocol, path: pathname, status: file ? 404 : 403, userAgent: req.headers['user-agent'] || '' });
      return;
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Content-Length': stat.size, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    onEvent({ type: 'webRequest', protocol, path: pathname, status: 200, userAgent: req.headers['user-agent'] || '' });
    if (req.method === 'HEAD') res.end();
    else fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
  };
}

async function listen(server, port, address) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, address, () => { server.off('error', reject); resolve(); });
  });
  return server.address().port;
}

async function startWeb({ address, root, entryPath, cert, key, httpsPort = 443, httpPort = 8000, onEvent = () => {} }) {
  const secure = https.createServer({ cert, key }, createHandler({ root, entryPath, protocol: 'https', onEvent }));
  let plain;
  try {
    const boundHttpsPort = await listen(secure, httpsPort, address);
    plain = http.createServer(createHandler({ root, entryPath, protocol: 'http', onEvent }));
    const boundHttpPort = await listen(plain, httpPort, address);
    return {
      httpsPort: boundHttpsPort, httpPort: boundHttpPort,
      async stop() {
        secure.closeAllConnections();
        plain.closeAllConnections();
        await Promise.all([new Promise(resolve => secure.close(resolve)), new Promise(resolve => plain.close(resolve))]);
      },
    };
  } catch (error) {
    if (secure.listening) await new Promise(resolve => secure.close(resolve));
    if (plain?.listening) await new Promise(resolve => plain.close(resolve));
    throw error;
  }
}

module.exports = { safeFile, createHandler, startWeb };
