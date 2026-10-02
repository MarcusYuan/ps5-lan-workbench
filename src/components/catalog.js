'use strict';

const CATALOG = Object.freeze({
  y2jb: Object.freeze({
    id: 'y2jb', name: 'Y2JB Autoloader', version: 'v0.9.1', format: 'dat', verification: 'ftp',
    source: 'https://github.com/itsPLK/ps5-y2jb-autoloader',
    release: 'https://github.com/itsPLK/ps5-y2jb-autoloader/releases/tag/v0.9.1-36381e4',
    asset: 'download0.dat', size: 336789504,
    sha256: '19c224c64d9967ecf2c1a2fe4ed6d19afab587adc15c08a3f88bd687149591a9',
    license: 'GPL-3.0 / MIT',
  }),
  y2jbDev: Object.freeze({
    id: 'y2jbDev', name: 'Y2JB Autoloader (Relapse)', version: 'v1.0.0-dev-794049f', format: 'dat', verification: 'ftp',
    source: 'https://github.com/itsPLK/ps5-y2jb-autoloader',
    release: 'https://github.com/itsPLK/ps5-y2jb-autoloader/releases/tag/v1.0.0-dev-794049f',
    asset: 'download0.dat', size: 336789504,
    sha256: '1c9a416a13d458f3825f29443ddd9eccefb54afddefaf9784a4a45815d8cf684',
    license: 'GPL-3.0 / MIT', prerelease: true,
  }),
  autoloader: Object.freeze({
    id: 'autoloader', name: 'WebKit Autoloader', version: 'v0.5.2', verification: 'sent',
    source: 'https://github.com/itsPLK/ps5-webkit-autoloader',
    release: 'https://github.com/itsPLK/ps5-webkit-autoloader/releases/tag/v0.5.2',
    asset: 'webkit-autoloader-installer_v0.5.2.elf', size: 2311424,
    sha256: 'f990e48e8330231d2066a7b8ab6dc25fda83b2cc36cb426c472b35b33767451a',
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
    id: 'kstuffLite', name: 'Kstuff FPKG (drakmor test)', version: '1.13-fpkg-dr-test5', verification: 'sent',
    source: 'https://gbatemp.net/attachments/kstuff-1-13-fpkg-dr-test5-elf-7z.593030/',
    url: 'https://gbatemp.net/attachments/kstuff-1-13-fpkg-dr-test5-elf-7z.593030/',
    asset: 'kstuff-1.13-fpkg-dr-test5.elf', size: 1802280,
    sha256: '829b45fe871dd64fbd53874ae4558076c2f1e1f203fe1ab52db5510d5fc45923',
    archive: Object.freeze({ format: '7z', size: 655243,
      sha256: '60ad3a57276fa665b9b948ab18d068f7dbbdd0263d21eab6c88375c4a3bd13b6' }),
  }),
  payloadManager: Object.freeze({
    id: 'payloadManager', name: 'Payload Manager', version: 'v0.5.2', verification: 'payloadManager',
    source: 'https://github.com/itsPLK/ps5-payload-manager',
    release: 'https://github.com/itsPLK/ps5-payload-manager/releases/tag/v0.5.2',
    asset: 'pldmgr_v0.5.2.elf', size: 2410776,
    sha256: '62b3ba2a4937c2afc502f9a4e7242cca538610ebb4ae2800c7c6f72e7f268e7c',
    license: 'GPL-3.0',
  }),
  shadowMountPlus: Object.freeze({
    id: 'shadowMountPlus', name: 'ShadowMountPlus', version: '1.7beta2', verification: 'sent',
    source: 'https://github.com/drakmor/ShadowMountPlus',
    release: 'https://github.com/drakmor/ShadowMountPlus/releases/tag/1.7beta2',
    asset: 'shadowmountplus.elf', size: 2437704,
    sha256: '3f716a7b2220c7e87e87452ae05cad689ef842d3beb4cdad6c526cb6dfc2b6b5',
    license: 'GPL-3.0',
  }),
  shadowMountPlusBeta3: Object.freeze({
    id: 'shadowMountPlusBeta3', name: 'ShadowMountPlus 1.7beta3', version: '1.7beta3', verification: 'sent',
    source: 'https://github.com/drakmor/ShadowMountPlus',
    release: 'https://github.com/drakmor/ShadowMountPlus/releases/tag/1.7beta3',
    asset: 'shadowmountplus.elf', size: 2437848,
    sha256: '2a7427e20ba7a70bd8cd01e47eb00ee7ca82db82dff3da7884f48f9c3fcbe95a',
    license: 'GPL-3.0', prerelease: true,
  }),
  ftpServer: Object.freeze({
    id: 'ftpServer', name: 'FTP Server (drakmor)', version: '1.16-ng-stable', verification: 'sent',
    source: 'https://github.com/drakmor/ftpsrv',
    release: 'https://github.com/drakmor/ftpsrv/releases/tag/1.16-ng-stable',
    asset: 'ftpsrv-ps5.elf', size: 230640,
    sha256: 'f19ae469b25453a7a4af4529527521d31f143100f18a2c6839666e7121c8bd32',
    license: 'GPL-3.0',
  }),
  webFileManager: Object.freeze({
    id: 'webFileManager', name: 'PS5 Web File Manager', version: 'v1.9', verification: 'sent',
    source: 'https://github.com/owendswang/ps5-web-file-manager',
    release: 'https://github.com/owendswang/ps5-web-file-manager/releases/tag/v1.9',
    asset: 'web-file-mgr-v1.9.elf', size: 345432,
    sha256: '711cb076e887fcd55d973ade8b84bb6c22720be295bfde18e32761f6e0479a3e',
    license: 'GPL-3.0',
  }),
});

function component(id) {
  if (!Object.hasOwn(CATALOG, id)) throw Object.assign(new Error('Unknown component'), { code: 'UNKNOWN_COMPONENT' });
  const item = CATALOG[id];
  return { ...item, url: item.url || `${item.release.replace('/tag/', '/download/')}/${item.asset}` };
}

module.exports = { CATALOG, component };
