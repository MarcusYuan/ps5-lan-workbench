'use strict';

const CATALOG = Object.freeze({
  autoloader: Object.freeze({
    id: 'autoloader', name: 'WebKit Autoloader', version: 'v0.5.0', verification: 'sent',
    source: 'https://github.com/itsPLK/ps5-webkit-autoloader',
    release: 'https://github.com/itsPLK/ps5-webkit-autoloader/releases/tag/v0.5.0',
    asset: 'webkit-autoloader-installer_v0.5.0.elf', size: 1950976,
    sha256: '83c2128520267515fe2f197db35427bb95b7273934e52ad3c6bf668a4ef27b7f',
    license: 'GPL-3.0',
  }),
  pkgManager: Object.freeze({
    id: 'pkgManager', name: 'PKG Manager', version: 'v1.4.1', verification: 'pkgManager',
    source: 'https://github.com/itsPLK/ps5-pkg-manager',
    release: 'https://github.com/itsPLK/ps5-pkg-manager/releases/tag/v1.4.1',
    asset: 'pkg-manager_v1.4.1.elf', size: 1939016,
    sha256: '09adaff13b858bb3db519faaea673ee3fa67298081e608d32f6501ed6e9f706e',
    license: 'GPL-3.0',
  }),
  kstuffLite: Object.freeze({
    id: 'kstuffLite', name: 'Kstuff Lite', version: 'v1.11 Beta', verification: 'sent',
    source: 'https://github.com/EchoStretch/kstuff-lite',
    release: 'https://github.com/EchoStretch/kstuff-lite/releases/tag/v1.11',
    asset: 'kstuff.elf', size: 1737080,
    sha256: 'ab9a6cb4d3b1daf139d4d646e402b1cf569071acd64599c936d7a3a6164dc779',
  }),
  payloadManager: Object.freeze({
    id: 'payloadManager', name: 'Payload Manager', version: 'v0.5.2', verification: 'payloadManager',
    source: 'https://github.com/itsPLK/ps5-payload-manager',
    release: 'https://github.com/itsPLK/ps5-payload-manager/releases/tag/v0.5.2',
    asset: 'pldmgr_v0.5.2.elf', size: 2410776,
    sha256: '62b3ba2a4937c2afc502f9a4e7242cca538610ebb4ae2800c7c6f72e7f268e7c',
    license: 'GPL-3.0',
  }),
});

function component(id) {
  if (!Object.hasOwn(CATALOG, id)) throw Object.assign(new Error('Unknown component'), { code: 'UNKNOWN_COMPONENT' });
  const item = CATALOG[id];
  return { ...item, url: `${item.release.replace('/tag/', '/download/')}/${item.asset}` };
}

module.exports = { CATALOG, component };
