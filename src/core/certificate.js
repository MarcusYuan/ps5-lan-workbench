const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const forge = require('node-forge');

function validDomain(domain) {
  return typeof domain === 'string' && domain.length <= 253 &&
    /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(domain);
}

function existingPair(certFile, keyFile, domain) {
  try {
    const cert = fs.readFileSync(certFile, 'utf8');
    const key = fs.readFileSync(keyFile, 'utf8');
    const parsed = new crypto.X509Certificate(cert);
    const remaining = new Date(parsed.validTo).getTime() - Date.now();
    if (remaining < 30 * 24 * 3600 * 1000 || !parsed.subjectAltName?.split(', ').includes(`DNS:${domain}`)) return null;
    const privateKey = crypto.createPrivateKey(key);
    const publicFromKey = crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'der' });
    const publicFromCert = parsed.publicKey.export({ type: 'spki', format: 'der' });
    if (!publicFromKey.equals(publicFromCert)) return null;
    return { cert, key, certFile, keyFile, reused: true };
  } catch { return null; }
}

function getCertificate(directory, domain) {
  if (!validDomain(domain)) throw new Error('HTTPS 目标域名无效');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const certFile = path.join(directory, 'server.crt');
  const keyFile = path.join(directory, 'server.key');
  const old = existingPair(certFile, keyFile, domain);
  if (old) return old;

  const keys = forge.pki.rsa.generateKeyPair({ bits: 2048, e: 0x10001 });
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = crypto.randomBytes(16).toString('hex').replace(/^0/, '1');
  cert.validity.notBefore = new Date(Date.now() - 60 * 60 * 1000);
  cert.validity.notAfter = new Date(Date.now() + 365 * 24 * 3600 * 1000);
  const attrs = [{ name: 'commonName', value: domain }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.setExtensions([
    { name: 'basicConstraints', cA: false },
    { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
    { name: 'extKeyUsage', serverAuth: true },
    { name: 'subjectAltName', altNames: [{ type: 2, value: domain }] },
  ]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const certPem = forge.pki.certificateToPem(cert);
  const keyPem = forge.pki.privateKeyToPem(keys.privateKey);
  const suffix = crypto.randomBytes(5).toString('hex');
  const pendingCert = certFile + '.' + suffix + '.tmp';
  const pendingKey = keyFile + '.' + suffix + '.tmp';
  try {
    fs.writeFileSync(pendingCert, certPem, { mode: 0o600 });
    fs.writeFileSync(pendingKey, keyPem, { mode: 0o600 });
    fs.renameSync(pendingCert, certFile);
    fs.renameSync(pendingKey, keyFile);
  } finally {
    fs.rmSync(pendingCert, { force: true });
    fs.rmSync(pendingKey, { force: true });
  }
  return { cert: certPem, key: keyPem, certFile, keyFile, reused: false };
}

module.exports = { getCertificate, validDomain };
