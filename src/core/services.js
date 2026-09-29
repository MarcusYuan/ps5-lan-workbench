const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { startDns } = require('./dns');
const { startWeb } = require('./web');
const { getCertificate, validDomain } = require('./certificate');

async function startServices(options) {
  const { address, domain, root, certDir, entryPath, onEvent = () => {} } = options;
  if (!net.isIP(address) || net.isIP(address) !== 4) throw new Error('请选择有效的 IPv4 网卡地址');
  if (!validDomain(domain)) throw new Error('用户指南域名无效');
  const resolved = path.resolve(root);
  if (!fs.statSync(resolved).isDirectory()) throw new Error('资源目录不存在');
  const entry = path.resolve(resolved, entryPath);
  if (!entry.startsWith(resolved + path.sep) || !fs.statSync(entry).isFile()) throw new Error('网页入口不存在');
  const pair = options.certificate || getCertificate(certDir, domain);
  let dns;
  try {
    dns = await startDns({ address, domain, port: options.dnsPort ?? 53, onEvent });
    const web = await startWeb({ address, root: resolved, entryPath, cert: pair.cert, key: pair.key, httpsPort: options.httpsPort ?? 443, httpPort: options.httpPort ?? 8000, onEvent });
    return {
      dnsPort: dns.port, httpsPort: web.httpsPort, httpPort: web.httpPort, certificateReused: !!pair.reused,
      async stop() { await Promise.all([dns.stop(), web.stop()]); },
    };
  } catch (error) {
    if (dns) await dns.stop();
    throw error;
  }
}

module.exports = { startServices };
