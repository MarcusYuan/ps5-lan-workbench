'use strict';

const CATALOG = Object.freeze({
  autoloader: Object.freeze({
    id: 'autoloader', name: 'WebKit Autoloader', version: 'v0.5.0',
    source: 'https://github.com/itsPLK/ps5-webkit-autoloader',
    release: 'https://github.com/itsPLK/ps5-webkit-autoloader/releases/tag/v0.5.0',
    asset: 'webkit-autoloader-installer_v0.5.0.elf', size: 1950976,
    sha256: '83c2128520267515fe2f197db35427bb95b7273934e52ad3c6bf668a4ef27b7f',
    license: 'GPL-3.0',
  }),
  pkgManager: Object.freeze({
    id: 'pkgManager', name: 'PKG Manager', version: 'v1.4.1',
    source: 'https://github.com/itsPLK/ps5-pkg-manager',
    release: 'https://github.com/itsPLK/ps5-pkg-manager/releases/tag/v1.4.1',
    asset: 'pkg-manager_v1.4.1.elf', size: 1939016,
    sha256: '09adaff13b858bb3db519faaea673ee3fa67298081e608d32f6501ed6e9f706e',
    license: 'GPL-3.0',
  }),
});

function component(id) {
  if (!Object.hasOwn(CATALOG, id)) throw Object.assign(new Error('Unknown component'), { code: 'UNKNOWN_COMPONENT' });
  const item = CATALOG[id];
  return { ...item, url: `${item.release.replace('/tag/', '/download/')}/${item.asset}` };
}

module.exports = { CATALOG, component };
