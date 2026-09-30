'use strict';

const CATALOG = Object.freeze({
  autoloader: Object.freeze({
    id: 'autoloader', name: 'WebKit Autoloader', version: 'v0.5.1', verification: 'sent',
    source: 'https://github.com/itsPLK/ps5-webkit-autoloader',
    release: 'https://github.com/itsPLK/ps5-webkit-autoloader/releases/tag/v0.5.1',
    asset: 'webkit-autoloader-installer_v0.5.1.elf', size: 2311424,
    sha256: '80083f76383944e1f87c2d4126e4e067cd70bd8013feb538575bc2cb08258a78',
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
