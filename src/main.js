'use strict';

const fs = require('node:fs');
const fsp = fs.promises;
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { app, BrowserWindow, ipcMain, Menu, dialog, shell } = require('electron');
const i18n = require('./i18n');
const { DEFAULT_TARGET, normalizeTarget } = require('./ps5/target');
const { CATALOG, component } = require('./components/catalog');
const componentFiles = require('./components/downloader');
const { sendElf } = require('./ps5/elf-client');
const manager = require('./ps5/manager-client');
const pkgFiles = require('./pkg/file');
const pkgInstall = require('./pkg/install-session');
const { downloadArchive, validateEntryPath, METADATA_FILENAME } = require('./core/downloader');
const { getCertificate, validDomain } = require('./core/certificate');
const { createController } = require('./service/controller');

const helperIndex = process.argv.indexOf('--service-helper');
if (helperIndex >= 0) {
  require('./service/helper').runHelper(process.argv[helperIndex + 1]).catch(error => {
    process.stderr.write(error.stack || String(error));
    process.exit(1);
  });
} else {
  const DEFAULT_DOMAIN = 'manuals.playstation.net';
  const diagnostic = process.argv.includes('--diagnostic-ports');
  const ports = diagnostic ? { dns: 5354, https: 8443, http: 18000 } : { dns: 53, https: 443, http: 8000 };
  let window;
  let controller;
  let abortController;
  let configPath;
  let contentDir;
  let certDir;
  let componentDir;
  let selectedPkg = null;
  let remoteAbort = null;
  let remotePromise = null;
  let allowClose = false;
  const componentAborts = new Map();
  let configData = null;
  let state = {
    interfaces: [], selectedIp: '', sourceUrl: '', entryPath: 'index.html', targetDomain: DEFAULT_DOMAIN,
    download: { phase: 'waiting', progress: null, meta: null, error: null },
    service: { dns: 'stopped', https: 'stopped', http: 'stopped', ps5Access: false, error: null, elevated: false },
    ports, diagnostic, language: 'system', locale: 'en', urls: { https: '', http: '' }, logs: [],
    ps5Target: { ...DEFAULT_TARGET }, downloadRoute: 'direct',
    components: Object.fromEntries(Object.keys(CATALOG).map(id => [id, { phase: 'waiting', progress: null, meta: null, error: null }])),
    pkgSelection: null, remoteTask: null,
  };
  let configWrite = Promise.resolve();

  function error(code, key, params) { return i18n.createError(code, key, params); }
  function errorResult(cause) { return { ok: false, error: i18n.serializeError(cause) }; }
  function handle(action) { return async (_event, ...args) => {
    try { return await action(_event, ...args); } catch (cause) { return errorResult(cause); }
  }; }
  function updateLocale() {
    state.locale = i18n.resolveLocale(state.language, app.getLocale());
    if (window && !window.isDestroyed()) window.setTitle(i18n.t(state.locale, 'app.title'));
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: i18n.t(state.locale, 'menu.file'), submenu: [{ label: i18n.t(state.locale, 'menu.quit'), click: () => window?.close() }] },
      { label: i18n.t(state.locale, 'menu.view'), submenu: [
        { label: i18n.t(state.locale, 'menu.reload'), role: 'reload' },
        { label: i18n.t(state.locale, 'menu.fullscreen'), role: 'togglefullscreen' },
        { label: i18n.t(state.locale, 'menu.developerTools'), role: 'toggleDevTools' },
      ] },
    ]));
  }

  function interfaces() {
    return Object.entries(os.networkInterfaces()).flatMap(([name, addresses]) =>
      (addresses || []).filter(item => item.family === 'IPv4' && !item.internal).map(item => ({ name, address: item.address })));
  }
  function emit() {
    if (window && !window.isDestroyed()) window.webContents.send('host:event', structuredClone(state));
  }
  function log(message) {
    state.logs = [{ at: new Date().toISOString(), message }, ...state.logs].slice(0, 100);
    emit();
  }
  function updateUrls() {
    const ip = state.selectedIp;
    state.urls = ip ? {
      https: `https://${state.targetDomain}${ports.https === 443 ? '' : `:${ports.https}`}/document/en/ps5/`,
      http: `http://${ip}:${ports.http}/`,
    } : { https: '', http: '' };
  }
  function commitConfig(patch) {
    const write = async () => {
      const serializable = { ...configData, ...patch };
      const temp = configPath + '.tmp';
      await fsp.writeFile(temp, JSON.stringify(serializable, null, 2), { mode: 0o600 });
      await fsp.rename(temp, configPath);
      configData = serializable;
    };
    const result = configWrite.catch(() => {}).then(write);
    configWrite = result;
    return result;
  }
  async function loadState() {
    const dataDir = app.getPath('userData');
    await fsp.mkdir(dataDir, { recursive: true });
    configPath = path.join(dataDir, 'config.json');
    contentDir = path.join(dataDir, 'content', 'current');
    certDir = path.join(dataDir, 'certificates');
    componentDir = path.join(dataDir, 'components');
    configData = { selectedIp: '', sourceUrl: '', entryPath: 'index.html', targetDomain: DEFAULT_DOMAIN,
      language: 'system', ps5Target: { ...DEFAULT_TARGET }, downloadRoute: 'direct' };
    try {
      const old = JSON.parse(await fsp.readFile(configPath, 'utf8'));
      if (typeof old.sourceUrl === 'string') state.sourceUrl = old.sourceUrl;
      if (typeof old.entryPath === 'string') state.entryPath = validateEntryPath(old.entryPath);
      if (validDomain(old.targetDomain)) state.targetDomain = old.targetDomain;
      if (typeof old.selectedIp === 'string') state.selectedIp = old.selectedIp;
      if (i18n.SUPPORTED_LANGUAGES.includes(old.language)) state.language = old.language;
      if (old.downloadRoute === 'mirror') state.downloadRoute = 'mirror';
      try { state.ps5Target = normalizeTarget(old.ps5Target, { allowEmpty: true }); } catch { /* older config */ }
    } catch (cause) { if (cause.code !== 'ENOENT') log(i18n.message('error.configRead', { detail: cause.message })); }
    updateLocale();
    state.interfaces = interfaces();
    if (!state.interfaces.some(item => item.address === state.selectedIp)) state.selectedIp = state.interfaces[0]?.address || '';
    configData = { selectedIp: state.selectedIp, sourceUrl: state.sourceUrl, entryPath: state.entryPath,
      targetDomain: state.targetDomain, language: state.language, ps5Target: state.ps5Target, downloadRoute: state.downloadRoute };
    await Promise.all(Object.keys(CATALOG).map(async id => {
      const inspected = await componentFiles.inspect(componentDir, id).catch(() => null);
      if (inspected) state.components[id] = { phase: 'ready', progress: 100,
        meta: { ...inspected, file: undefined }, error: null };
    }));
    try {
      const meta = JSON.parse(await fsp.readFile(path.join(contentDir, METADATA_FILENAME), 'utf8'));
      const safeEntry = validateEntryPath(meta.entryPath);
      const entry = path.resolve(contentDir, safeEntry);
      if (typeof meta.sourceUrl === 'string' && entry.startsWith(path.resolve(contentDir) + path.sep) && (await fsp.stat(entry)).isFile()) {
        state.download = { phase: 'ready', progress: 100, meta, error: null };
        state.entryPath = meta.entryPath;
        state.sourceUrl = meta.sourceUrl;
      }
    } catch { /* no installed content */ }
    configData = { ...configData, sourceUrl: state.sourceUrl, entryPath: state.entryPath };
    updateUrls();
  }
  function publicState() {
    state.interfaces = interfaces();
    if (!state.interfaces.some(item => item.address === state.selectedIp)) state.selectedIp = state.interfaces[0]?.address || '';
    updateUrls();
    return structuredClone(state);
  }
  async function setLanguage(_event, language) {
    if (!i18n.SUPPORTED_LANGUAGES.includes(language)) throw error('INVALID_LANGUAGE', 'error.languageInvalid');
    try { await commitConfig({ language }); }
    catch (cause) { throw i18n.createError('CONFIG_SAVE_FAILED', 'error.configSave', {}, cause.message); }
    state.language = configData.language;
    updateLocale();
    emit();
    return publicState();
  }
  async function setDownloadRoute(_event, downloadRoute) {
    if (!['direct', 'mirror'].includes(downloadRoute)) throw error('INVALID_DOWNLOAD_ROUTE', 'downloadRoute.invalid');
    try { await commitConfig({ downloadRoute }); }
    catch (cause) { throw i18n.createError('CONFIG_SAVE_FAILED', 'error.configSave', {}, cause.message); }
    state.downloadRoute = configData.downloadRoute;
    emit();
    return publicState();
  }
  async function startDownload(_event, options) {
    if (controller) throw error('SERVICE_RUNNING', 'error.stopBeforeUpdate');
    if (abortController) throw error('DOWNLOAD_IN_PROGRESS', 'error.downloadInProgress');
    const sourceUrl = String(options?.sourceUrl || '').trim();
    const entryPath = validateEntryPath(String(options?.entryPath || 'index.html'));
    const oldSourceUrl = state.sourceUrl;
    const oldEntryPath = state.entryPath;
    abortController = new AbortController();
    state.sourceUrl = sourceUrl;
    state.entryPath = entryPath;
    const previous = state.download.meta;
    state.download = { phase: 'downloading', progress: 0, meta: previous, error: null };
    emit();
    try {
      const meta = await downloadArchive({ sourceUrl, entryPath, destinationDir: contentDir, signal: abortController.signal,
        downloadRoute: state.downloadRoute,
        onProgress: progress => { state.download.progress = progress.percent; emit(); } });
      state.download = { phase: 'ready', progress: 100, meta, error: null };
      await commitConfig({ sourceUrl, entryPath });
      log(i18n.message('log.filesInstalled', { sha256: meta.sha256 }));
      return publicState();
    } catch (error) {
      if (previous) { state.sourceUrl = oldSourceUrl; state.entryPath = oldEntryPath; }
      state.download = { phase: previous ? 'ready' : 'waiting', progress: null, meta: previous,
        error: error.name === 'AbortError' ? i18n.message('source.canceled') : i18n.serializeError(error) };
      log(i18n.message('log.downloadFailed', { detail: state.download.error }));
      throw error;
    } finally { abortController = null; emit(); }
  }
  async function startHost(_event, options) {
    if (controller) return publicState();
    if (abortController) throw error('DOWNLOAD_IN_PROGRESS', 'error.waitForDownload');
    if (!state.download.meta) throw error('DOWNLOAD_REQUIRED', 'error.downloadFirst');
    const ip = String(options?.interfaceAddress || state.selectedIp);
    if (!interfaces().some(item => item.address === ip)) throw error('INVALID_INTERFACE', 'error.invalidInterface');
    const entryPath = validateEntryPath(String(options?.entryPath || state.entryPath));
    const domain = String(options?.targetDomain || state.targetDomain).trim().toLowerCase();
    if (!validDomain(domain)) throw error('INVALID_DOMAIN', 'error.invalidDomain');
    const entryFullPath = path.resolve(contentDir, entryPath);
    if (!entryFullPath.startsWith(path.resolve(contentDir) + path.sep) || !(await fsp.stat(entryFullPath).catch(() => null))?.isFile())
      throw error('ENTRY_MISSING', 'error.entryMissing');
    const certificate = getCertificate(certDir, domain);
    const config = { address: ip, domain, root: contentDir, entryPath,
      dnsPort: ports.dns, httpsPort: ports.https, httpPort: ports.http,
      certificate: { cert: certificate.cert, key: certificate.key, reused: certificate.reused } };
    const base = { executable: process.execPath, appPath: app.getAppPath(), packaged: app.isPackaged, config,
      onEvent: event => {
        if (event.type === 'webRequest') {
          log(i18n.message('log.webRequest', { protocol: event.protocol.toUpperCase(), status: event.status, path: event.path }));
          if (event.protocol === 'https' && /playstation|ps5/i.test(event.userAgent)) state.service.ps5Access = true;
        } else if (event.type === 'dnsQuery') log(i18n.message('log.dnsQuery', { queryType: event.queryType, name: event.name }));
        else if (event.type === 'serviceExited') {
          controller = null;
          state.service = { dns: 'stopped', https: 'stopped', http: 'stopped', ps5Access: false,
            error: i18n.message('error.serviceExited'), elevated: false };
        }
        emit();
      } };
    state.service.error = null;
    try {
      try { controller = await createController(base); }
      catch (error) {
        if (error.code !== 'EACCES' && error.code !== 'EPERM') throw error;
        log(i18n.message('log.authorization'));
        controller = await createController({ ...base, elevated: true });
      }
      state.selectedIp = ip; state.entryPath = entryPath; state.targetDomain = domain;
      state.service = { dns: 'listening', https: 'listening', http: 'listening', ps5Access: false, error: null, elevated: controller.elevated };
      updateUrls();
      await commitConfig({ selectedIp: ip, entryPath, targetDomain: domain });
      log(i18n.message('log.listening', { ip, dns: ports.dns, https: ports.https, http: ports.http }));
      return publicState();
    } catch (error) {
      if (error.code === 'EADDRINUSE') {
        const port = error.message.match(/:(\d+)(?:\D|$)/)?.[1];
        state.service.error = { ...i18n.message(port ? 'error.portInUse' : 'error.portsInUse', port ? { port } : {}, error.message), code: error.code };
      } else {
        state.service.error = i18n.serializeError(error);
      }
      log(i18n.message('log.startFailed', { detail: state.service.error }));
      error.i18nKey = state.service.error.key;
      error.i18nParams = state.service.error.params;
      error.detail = state.service.error.detail;
      throw error;
    }
  }
  async function stopHost() {
    if (controller) { const active = controller; controller = null; await active.stop(); }
    state.service = { dns: 'stopped', https: 'stopped', http: 'stopped', ps5Access: false, error: null, elevated: false };
    log(i18n.message('log.stopped'));
    return publicState();
  }
  async function setPs5Target(_event, value) {
    if (remoteAbort) throw error('REMOTE_BUSY', 'remote.busy');
    const target = normalizeTarget(value);
    try { await commitConfig({ ps5Target: target }); }
    catch (cause) { throw i18n.createError('CONFIG_SAVE_FAILED', 'error.configSave', {}, cause.message); }
    state.ps5Target = target;
    emit();
    return publicState();
  }
  function publicCatalog() {
    return Object.fromEntries(Object.keys(CATALOG).map(id => {
      const { name, version, source, release, license, asset } = component(id);
      return [id, { name, version, source, release, license, asset }];
    }));
  }
  async function openKnown(_event, kind, id) {
    const contacts = { discord: 'https://discord.gg/3UrdCB47Q8' };
    const url = kind === 'contact' ? contacts[id] : kind === 'component' ? component(id).source : null;
    if (!url || new URL(url).protocol !== 'https:') throw error('INVALID_LINK', 'error.operationFailed');
    await shell.openExternal(url);
    return { ok: true };
  }
  async function downloadComponent(_event, id) {
    component(id);
    if (componentAborts.has(id)) throw error('DOWNLOAD_IN_PROGRESS', 'error.downloadInProgress');
    const abort = new AbortController();
    componentAborts.set(id, abort);
    const previous = state.components[id].meta;
    state.components[id] = { phase: 'downloading', progress: 0, meta: previous, error: null };
    emit();
    try {
      const meta = await componentFiles.download(componentDir, id, { signal: abort.signal,
        downloadRoute: state.downloadRoute,
        onProgress: progress => { state.components[id].progress = progress; emit(); } });
      state.components[id] = { phase: 'ready', progress: 100, meta, error: null };
      log(i18n.message('remote.componentDownloaded', { name: component(id).name }));
      return publicState();
    } catch (cause) {
      state.components[id] = { phase: previous ? 'ready' : 'waiting', progress: null, meta: previous,
        error: i18n.serializeError(cause) };
      emit();
      throw cause;
    } finally { componentAborts.delete(id); }
  }
  function startRemote(type, label, operation) {
    if (remoteAbort) throw error('REMOTE_BUSY', 'remote.busy');
    const target = normalizeTarget(state.ps5Target);
    const id = crypto.randomUUID();
    const abort = new AbortController();
    remoteAbort = abort;
    state.remoteTask = { id, type, label, target: { ...target }, phase: 'checking',
      transferProgress: null, installProgress: null, error: null, startedAt: new Date().toISOString() };
    emit();
    const update = patch => {
      if (state.remoteTask?.id !== id) return;
      state.remoteTask = { ...state.remoteTask, ...patch };
      emit();
    };
    remotePromise = Promise.resolve().then(() => operation(target, abort.signal, update)).then(result => {
      const phase = ['alreadyRunning', 'alreadyRunningBusy'].includes(result?.status) ? result.status :
        result?.status === 'confirmed' ? 'confirmed' : 'sent';
      update({ phase, transferProgress: phase === 'alreadyRunning' || phase === 'alreadyRunningBusy' ? null : 100,
        installProgress: phase === 'confirmed' && type === 'pkg' ? 100 : null });
      return publicState();
    }).catch(cause => {
      update({ phase: cause?.code === 'TASK_CANCELED' ? 'canceled' :
        cause?.code === 'RESULT_UNCONFIRMED' || abort.signal.aborted ? 'unconfirmed' : 'failed',
        error: i18n.serializeError(cause) });
      throw cause;
    }).finally(() => { if (remoteAbort === abort) remoteAbort = null; });
    return remotePromise;
  }
  async function loadComponent(_event, id, options = {}) {
    component(id);
    const reload = options?.reload === true;
    if (reload && (id !== 'pkgManager' || state.remoteTask?.id !== options.expectedTaskId ||
      state.remoteTask?.phase !== 'alreadyRunning' || remoteAbort))
      throw error('TASK_NOT_ACTIVE', 'remote.taskNotActive');
    const inspected = await componentFiles.inspect(componentDir, id);
    if (!inspected) throw error('COMPONENT_NOT_DOWNLOADED', 'remote.downloadFirst');
    return startRemote('component', id, async (target, signal, update) => {
      if (id === 'pkgManager') {
        try {
          const existing = await manager.identify(target, signal);
          if (existing.version === '1.4.1') {
            const decision = manager.loadDecision(existing, reload);
            if (decision !== 'send') return { status: decision };
          }
        } catch (cause) {
          if (!['ECONNREFUSED', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH'].includes(cause.cause?.code || cause.code)) throw cause;
        }
      }
      update({ phase: 'sending', transferProgress: 0 });
      await sendElf(inspected.file, target, { signal,
        onProgress: progress => update({ transferProgress: progress }) });
      if (id === 'autoloader') return { status: 'sent' };
      update({ phase: 'verifying' });
      for (let attempt = 0; attempt < 15; attempt++) {
        if (signal.aborted) throw Object.assign(new Error('Canceled'), { code: 'RESULT_UNCONFIRMED' });
        try { await manager.identify(target, signal); return { status: 'confirmed' }; }
        catch (cause) {
          if (!['ECONNREFUSED', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH'].includes(cause.cause?.code || cause.code)) throw cause;
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
      throw Object.assign(new Error('PKG Manager did not confirm readiness'), { code: 'RESULT_UNCONFIRMED' });
    });
  }
  async function registerPkg(filePath) {
    if (remoteAbort) throw error('REMOTE_BUSY', 'remote.busy');
    selectedPkg = await pkgFiles.selectPkg(filePath);
    state.pkgSelection = pkgFiles.publicFile(selectedPkg);
    emit();
    return publicState();
  }
  async function pickPkg() {
    const result = await dialog.showOpenDialog(window, {
      properties: ['openFile'], filters: [{ name: 'PKG', extensions: ['pkg'] }],
    });
    if (result.canceled || result.filePaths.length !== 1) return publicState();
    return registerPkg(result.filePaths[0]);
  }
  async function installPkg(_event, fileId) {
    if (!selectedPkg || fileId !== selectedPkg.fileId) throw error('PKG_NOT_SELECTED', 'remote.selectPkg');
    const selected = selectedPkg;
    return startRemote('pkg', selected.name, (target, signal, update) =>
      pkgInstall.install(selected, target, { signal, onUpdate: update }));
  }
  app.whenReady().then(async () => {
    await loadState();
    ipcMain.handle('host:getState', () => publicState());
    ipcMain.handle('host:download', handle(startDownload));
    ipcMain.handle('host:cancelDownload', () => { abortController?.abort(); return publicState(); });
    ipcMain.handle('host:start', handle(startHost));
    ipcMain.handle('host:stop', handle(stopHost));
    ipcMain.handle('host:setLanguage', handle(setLanguage));
    ipcMain.handle('host:setDownloadRoute', handle(setDownloadRoute));
    ipcMain.handle('host:setPs5Target', handle(setPs5Target));
    ipcMain.handle('host:getCatalog', () => publicCatalog());
    ipcMain.handle('host:openContact', handle((event, id) => openKnown(event, 'contact', id)));
    ipcMain.handle('host:openComponentSource', handle((event, id) => openKnown(event, 'component', id)));
    ipcMain.handle('components:download', handle(downloadComponent));
    ipcMain.handle('components:cancelDownload', handle((_event, id) => { component(id); componentAborts.get(id)?.abort(); return publicState(); }));
    ipcMain.handle('components:load', handle(loadComponent));
    ipcMain.handle('pkg:selectFile', handle(pickPkg));
    ipcMain.handle('pkg:registerDrop', handle((_event, filePath) => registerPkg(filePath)));
    ipcMain.handle('pkg:install', handle(installPkg));
    ipcMain.handle('tasks:cancel', handle((_event, id) => {
      if (!remoteAbort || state.remoteTask?.id !== id) throw error('TASK_NOT_ACTIVE', 'remote.taskNotActive');
      remoteAbort.abort(); return publicState();
    }));
    window = new BrowserWindow({ width: 1120, height: 800, minWidth: 800, minHeight: 620,
      icon: path.join(__dirname, '..', 'assets', 'app-icon.png'),
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
    window.on('close', event => {
      if (!remoteAbort || allowClose) return;
      event.preventDefault();
      void dialog.showMessageBox(window, { type: 'warning', buttons: [
        i18n.t(state.locale, 'remote.continueRunning'), i18n.t(state.locale, 'remote.stopAndQuit')],
        defaultId: 0, cancelId: 0, message: i18n.t(state.locale, 'remote.quitPrompt') }).then(async result => {
        if (result.response !== 1) return;
        remoteAbort?.abort();
        await Promise.race([remotePromise?.catch(() => {}), new Promise(resolve => setTimeout(resolve, 15000))]);
        allowClose = true;
        window?.close();
      });
    });
    window.loadFile(path.join(__dirname, '..', 'ui-prototype', 'index.html'));
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', event => event.preventDefault());
    window.webContents.on('did-finish-load', emit);
  }).catch(error => { process.stderr.write(error.stack || String(error)); app.quit(); });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', event => {
    if (remoteAbort && !allowClose) { event.preventDefault(); window?.close(); return; }
    abortController?.abort();
    for (const active of componentAborts.values()) active.abort();
    controller?.stop();
  });
}
