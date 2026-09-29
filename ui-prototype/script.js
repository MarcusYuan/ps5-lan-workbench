(() => {
  const api = window.localHost;
  const i18n = window.AppI18n;
  const $ = (selector) => document.querySelector(selector);
  let locale = i18n.resolveLocale('system', navigator.language);
  const t = (key, params) => i18n.t(locale, key, params);
  const elements = {
    sourceUrl: $('#source-url'),
    entryPath: $('#entry-path'),
    targetDomain: $('#target-domain'),
    sourceMessage: $('#source-message'),
    downloadButton: $('#download-source'),
    progressWrap: $('#download-progress'),
    progressPhase: $('#download-phase'),
    progressPercent: $('#download-percent'),
    progressMeter: $('#download-meter'),
    progressMeta: $('#download-meta'),
    cancelDownload: $('#cancel-download'),
    interface: $('#interface'),
    dnsAddress: $('#dns-address'),
    httpsAddress: $('#https-address'),
    httpAddress: $('#http-address'),
    serviceToggle: $('#service-toggle'),
    overallStatus: $('#overall-status'),
    serviceCaption: $('#service-caption'),
    serviceError: $('#service-error'),
    logList: $('#log-list'),
    logCount: $('#log-count'),
    language: $('#language'),
    downloadRoute: $('#download-route'), routeStatus: $('#download-route-status'), routeError: $('#download-route-error'),
    errorDetails: $('#service-error-details'),
    errorRaw: $('#service-error-raw'),
    ps5Ip: $('#ps5-ip'), elfPort: $('#elf-port'), managerPort: $('#manager-port'),
    targetMessage: $('#target-message'), saveTarget: $('#save-ps5-target'),
    pkgName: $('#pkg-name'), pkgDetails: $('#pkg-details'), pkgTarget: $('#pkg-target-ip'),
    pkgSelect: $('#pkg-select'), pkgInstall: $('#pkg-install'), pkgDrop: $('#pkg-drop'),
    remoteStatus: $('#remote-status'), remoteCancel: $('#remote-cancel'),
    remoteDetails: $('#remote-details'), remoteRaw: $('#remote-error-raw'),
  };

  let currentState = null;
  let busyAction = '';
  let cancelRequested = false;
  let eventUnsubscribe = null;
  let savingLanguage = false;
  let savingRoute = false;
  let routeError = null;
  let transientError = null;
  let transientSourceError = null;
  let copyFeedback = null;
  let savingTarget = false;
  let targetFeedback = null;
  let remoteAction = '';
  const logs = [];
  const locallyEdited = new WeakSet();
  const maxLogs = 100;

  function asText(value) {
    if (value == null) return '';
    if (typeof value === 'string' || typeof value === 'number') return String(value);
    if (typeof value === 'object') {
      if (value.key || value.i18nKey) return i18n.formatMessage(locale, value);
      if (typeof value.message === 'string') return value.message;
      if (value.error) return asText(value.error);
      try { return JSON.stringify(value); } catch { return ''; }
    }
    return String(value);
  }

  function applyTranslations() {
    document.documentElement.lang = locale;
    for (const element of document.querySelectorAll('[data-i18n]')) element.textContent = t(element.dataset.i18n);
    for (const element of document.querySelectorAll('[data-i18n-placeholder]')) element.placeholder = t(element.dataset.i18nPlaceholder);
    for (const element of document.querySelectorAll('[data-i18n-aria-label]')) element.setAttribute('aria-label', t(element.dataset.i18nAriaLabel));
    document.title = t('app.title');
  }

  function showError(value) {
    elements.serviceError.hidden = !value;
    elements.errorDetails.hidden = !value?.detail;
    elements.serviceError.textContent = asText(value);
    elements.errorRaw.textContent = value?.detail || '';
  }

  function inputValue(input, fallback) {
    return input.value.trim() || fallback;
  }

  function updateInput(input, value) {
    if (!locallyEdited.has(input) && document.activeElement !== input && value != null && input.value !== String(value)) {
      input.value = String(value);
    }
  }

  function sourcePathIsValid(value) {
    const path = value.trim().replace(/^\.\//, '');
    return Boolean(path && !path.startsWith('/') && !path.split('/').includes('..') && !/[?#\\]/.test(path));
  }

  function sourceUrlIsValid(value) {
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' || !url.hostname) return false;
      const parts = url.pathname.split('/').filter(Boolean);
      if (url.hostname.toLowerCase() === 'github.com') return parts.length >= 2;
      return url.pathname.toLowerCase().endsWith('.zip');
    } catch {
      return false;
    }
  }

  function statusInfo(value) {
    if (value && typeof value === 'object') {
      if (value.error) return { label: t('service.error'), kind: 'failed', active: false };
      if (value.running === true || value.active === true) return { label: t('service.running'), kind: 'running', active: true };
      if (value.running === false || value.active === false) return { label: t('service.stopped'), kind: '', active: false };
      value = value.status ?? value.phase ?? value.state ?? value.message;
    }

    if (value === true) return { label: t('service.running'), kind: 'running', active: true };
    if (value === false || value == null || value === '') return { label: t('service.stopped'), kind: '', active: false };
    const raw = String(value);
    const normalized = raw.toLowerCase().replace(/[ _-]/g, '');
    if (['running', 'started', 'active', 'listening', 'online', 'ready', '运行中', '已启动'].includes(normalized)) {
      return { label: t('service.running'), kind: 'running', active: true };
    }
    if (['stopped', 'idle', 'inactive', 'offline', 'notrunning', '未启动', '已停止'].includes(normalized)) {
      return { label: t('service.stopped'), kind: '', active: false };
    }
    if (['error', 'failed', 'failure', '异常', '失败'].includes(normalized)) {
      return { label: t('service.error'), kind: 'failed', active: false };
    }
    return { label: raw, kind: '', active: false };
  }

  function accessInfo(value) {
    if (value && typeof value === 'object') {
      if (value.accessed === true || value.connected === true || value.success === true) return { label: t('service.accessReceived'), kind: 'running' };
      if (value.error || value.failed === true) return { label: t('service.accessError'), kind: 'failed' };
      value = value.status ?? value.state ?? value.message;
    }
    if (value === true) return { label: t('service.accessReceived'), kind: 'running' };
    if (value === false || value == null || value === '') return { label: t('service.accessPending'), kind: '' };
    const raw = String(value);
    const normalized = raw.toLowerCase().replace(/[ _-]/g, '');
    if (['accessed', 'connected', 'success', 'visited', '已访问', '已收到访问'].includes(normalized)) return { label: t('service.accessReceived'), kind: 'running' };
    if (['error', 'failed', 'failure', '访问异常', '失败'].includes(normalized)) return { label: t('service.accessError'), kind: 'failed' };
    if (['pending', 'waiting', '未访问', '尚未确认'].includes(normalized)) return { label: t('service.accessPending'), kind: '' };
    return { label: raw, kind: '' };
  }

  function valueToHuman(value) {
    if (value == null || value === '') return '';
    if (typeof value === 'object') {
      const entries = Object.entries(value).filter(([, item]) => item != null && item !== '');
      return entries.map(([key, item]) => `${key}: ${typeof item === 'object' ? asText(item) : item}`).join(' · ');
    }
    return String(value);
  }

  function addLog(message, level = 'info', time = new Date()) {
    if (!asText(message).trim()) return;
    logs.push({ message, level, time: time instanceof Date ? time : new Date(time) });
    if (logs.length > maxLogs) logs.splice(0, logs.length - maxLogs);
    renderLogs();
  }

  function renderLogs() {
    elements.logCount.textContent = String(logs.length);
    elements.logList.replaceChildren();
    if (!logs.length) {
      const empty = document.createElement('p');
      empty.className = 'empty-log';
      empty.textContent = t('logs.empty');
      elements.logList.append(empty);
      return;
    }

    for (const entry of [...logs].reverse()) {
      const line = document.createElement('p');
      line.className = 'log-line';
      line.dataset.level = entry.level;
      const time = document.createElement('span');
      time.className = 'log-time';
      time.textContent = Number.isNaN(entry.time.getTime()) ? '' : entry.time.toLocaleTimeString(locale, { hour12: false });
      const content = document.createElement('span');
      content.textContent = asText(entry.message);
      line.append(time, content);
      elements.logList.append(line);
    }
  }

  function mergeState(next) {
    if (!next || typeof next !== 'object') return;
    const snapshot = next.state && typeof next.state === 'object' ? next.state : next;
    currentState = { ...(currentState || {}), ...snapshot };
    if (snapshot.locale && snapshot.locale !== locale) {
      locale = snapshot.locale;
      applyTranslations();
    }
    if (snapshot.language) elements.language.value = snapshot.language;
    if (snapshot.download && typeof snapshot.download === 'object') {
      currentState.download = { ...(currentState?.download || {}), ...snapshot.download };
    }
    if (snapshot.service && typeof snapshot.service === 'object') {
      currentState.service = { ...(currentState?.service || {}), ...snapshot.service };
    }
    if (Array.isArray(snapshot.logs)) {
      logs.length = 0;
      for (const entry of [...snapshot.logs].reverse()) {
        logs.push({ message: entry.message, level: 'info', time: new Date(entry.at) });
      }
      renderLogs();
    }
    renderLogs();
    render();
  }

  function renderInterfaces(state) {
    const interfaces = Array.isArray(state.interfaces) ? state.interfaces : [];
    const selectedAddress = state.selectedIp || '';
    const previousValue = elements.interface.value;
    elements.interface.replaceChildren();

    if (!interfaces.length) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = t('connection.noInterfaces');
      elements.interface.append(option);
      elements.interface.disabled = true;
      return;
    }

    for (const network of interfaces) {
      if (!network || !network.address) continue;
      const option = document.createElement('option');
      option.value = network.address;
      option.textContent = network.name ? `${network.name} · ${network.address}` : network.address;
      elements.interface.append(option);
    }

    const values = [...elements.interface.options].map((option) => option.value);
    const desired = [previousValue, selectedAddress].find((value) => value && values.includes(value)) || values[0] || '';
    elements.interface.value = desired;
    elements.interface.disabled = values.length === 0 || Boolean(busyAction) || hasRunningService(state.service);
  }

  function hasRunningService(service = {}) {
    return ['dns', 'https', 'http'].some((key) => statusInfo(service?.[key]).active);
  }

  function renderStatusRow(key, dotSelector, statusSelector, value) {
    const status = statusInfo(value);
    const dot = $(dotSelector);
    const label = $(statusSelector);
    dot.classList.toggle('active', status.kind === 'running');
    label.classList.remove('running', 'failed');
    if (status.kind) label.classList.add(status.kind);
    label.textContent = status.label;
  }

  function renderDownload(download = {}, selectionReady = false) {
    const phase = String(download.phase || '').toLowerCase();
    const inProgress = ['downloading', 'extracting', 'checking', 'preparing', 'running'].includes(phase);
    const canceled = ['cancelled', 'canceled'].includes(phase) || download.error?.key === 'source.canceled';
    const failed = !canceled && (Boolean(download.error) || ['failed', 'error'].includes(phase));
    const done = ['complete', 'completed', 'success', 'succeeded', 'ready', 'done', 'downloaded', 'verified'].includes(phase);
    elements.progressWrap.hidden = !inProgress && !failed && !done && !canceled;
    elements.progressPhase.textContent = t(failed ? 'source.failed' : canceled ? 'source.canceled' : done ? 'source.complete'
      : phase === 'extracting' ? 'source.extracting' : phase === 'checking' ? 'source.checking' : 'source.downloading');
    const progress = Number(download.progress);
    const knownProgress = download.progress != null && Number.isFinite(progress) && progress >= 0;
    const percentage = knownProgress ? Math.max(0, Math.min(100, progress)) : null;
    elements.progressMeter.value = percentage ?? 0;
    elements.progressMeter.removeAttribute('value');
    if (percentage != null) elements.progressMeter.value = percentage;
    elements.progressPercent.textContent = percentage == null ? '' : `${Math.round(percentage)}%`;
    if (download.meta && typeof download.meta === 'object') {
      const details = [];
      if (download.meta.version) details.push(t('source.commit', { value: String(download.meta.version).slice(0, 12) }));
      if (download.meta.sha256) details.push(`SHA-256 ${String(download.meta.sha256).slice(0, 12)}…`);
      if (Number.isFinite(download.meta.archiveBytes)) details.push(`${(download.meta.archiveBytes / 1024 / 1024).toFixed(1)} MB`);
      elements.progressMeta.textContent = details.join(' · ');
    } else {
      elements.progressMeta.textContent = valueToHuman(download.meta);
    }
    elements.cancelDownload.hidden = !inProgress || typeof api?.cancelDownload !== 'function';
    elements.cancelDownload.disabled = cancelRequested;
    elements.cancelDownload.textContent = t(cancelRequested ? 'source.canceling' : 'source.cancel');
    if (failed) {
      elements.sourceMessage.textContent = asText(transientSourceError || download.error) || t('source.failed');
      elements.sourceMessage.className = download.error?.key === 'source.canceled' ? 'field-message' : 'field-message error';
    } else if (done && selectionReady) {
      elements.sourceMessage.textContent = t('source.ready');
      elements.sourceMessage.className = 'field-message good';
    } else if (done) {
      elements.sourceMessage.textContent = t('source.changed');
      elements.sourceMessage.className = 'field-message';
    } else if (canceled) {
      elements.sourceMessage.textContent = t('source.canceled');
      elements.sourceMessage.className = 'field-message';
    } else if (inProgress) {
      elements.sourceMessage.textContent = elements.progressPhase.textContent;
      elements.sourceMessage.className = 'field-message';
    }
  }

  function render() {
    if (!currentState) return;
    const state = currentState;
    const service = state.service || {};
    const hasApi = Boolean(api);
    const running = hasRunningService(service);
    const download = state.download || {};
    const downloadPhase = String(download.phase || '').toLowerCase();
    const downloadComplete = ['complete', 'completed', 'success', 'succeeded', 'ready', 'done', 'downloaded', 'verified'].includes(downloadPhase);

    updateInput(elements.sourceUrl, state.sourceUrl);
    updateInput(elements.entryPath, state.entryPath);
    updateInput(elements.targetDomain, state.targetDomain);
    updateInput(elements.ps5Ip, state.ps5Target?.address || '');
    updateInput(elements.elfPort, state.ps5Target?.elfPort ?? 9021);
    updateInput(elements.managerPort, state.ps5Target?.managerPort ?? 8844);
    renderInterfaces(state);
    const selectedAddress = elements.interface.value || state.selectedIp || '';
    const sourceMatches = !state.sourceUrl || state.sourceUrl === elements.sourceUrl.value.trim();
    const pathMatches = !state.entryPath || state.entryPath === elements.entryPath.value.trim();
    const downloadReady = downloadComplete && sourceMatches && pathMatches;

    elements.dnsAddress.textContent = state.selectedIp || elements.interface.value || '—';
    $('#computer-ip').textContent = elements.interface.value || state.selectedIp || '—';
    elements.pkgTarget.textContent = state.ps5Target?.address || '—';
    elements.httpsAddress.textContent = state.urls?.https || '—';
    elements.httpAddress.textContent = state.urls?.http || '—';
    $('#dns-port').textContent = t('service.port', { port: state.ports?.dns ?? 53 });
    $('#https-port').textContent = t('service.port', { port: state.ports?.https ?? 443 });
    $('#http-port').textContent = t('service.port', { port: state.ports?.http ?? 8000 });
    document.querySelectorAll('[data-copy]').forEach((button) => {
      const target = document.getElementById(button.dataset.copy);
      button.disabled = !target || !target.textContent || target.textContent === '—';
      button.textContent = t(copyFeedback?.button === button ? copyFeedback.key : 'common.copy');
    });

    renderStatusRow('dns', '#dns-dot', '#dns-status', service.dns);
    renderStatusRow('https', '#https-dot', '#https-status', service.https);
    renderStatusRow('http', '#http-dot', '#http-status', service.http);
    const access = accessInfo(service.ps5Access);
    $('#access-status').textContent = access.label;
    $('#access-status').classList.remove('running', 'failed');
    if (access.kind) $('#access-status').classList.add(access.kind);
    $('#access-dot').classList.toggle('active', access.kind === 'running');

    elements.downloadButton.disabled = !hasApi || Boolean(busyAction) || !sourceUrlIsValid(elements.sourceUrl.value.trim()) || !sourcePathIsValid(elements.entryPath.value);
    elements.downloadButton.textContent = t(busyAction === 'download' ? 'source.processing' : 'source.download');
    elements.serviceToggle.disabled = !hasApi || Boolean(busyAction) || (!running && (!selectedAddress || !downloadReady || !sourcePathIsValid(elements.entryPath.value)));
    elements.serviceToggle.textContent = t(busyAction ? 'source.processing' : running ? 'service.stop' : 'service.start');
    elements.serviceToggle.classList.toggle('stop', running);
    elements.interface.disabled = Boolean(busyAction) || running || !Array.isArray(state.interfaces) || state.interfaces.length === 0;

    const anyFailure = service.error || service.dns?.error || service.https?.error || service.http?.error;
    showError(transientError || anyFailure);
    elements.language.disabled = savingLanguage;
    elements.downloadRoute.disabled = savingRoute || !api?.setDownloadRoute;
    elements.downloadRoute.setAttribute('aria-checked', String(state.downloadRoute === 'mirror'));
    elements.routeStatus.textContent = t(savingRoute ? 'downloadRoute.saving' : state.downloadRoute === 'mirror' ? 'downloadRoute.mirror' : 'downloadRoute.direct');
    elements.routeError.hidden = !routeError;
    elements.routeError.textContent = asText(routeError);

    const activeLabel = t(busyAction ? 'service.busy' : running ? 'service.runningOverall' : 'service.stoppedOverall');
    elements.overallStatus.classList.toggle('active', running && !busyAction);
    elements.overallStatus.classList.toggle('busy', Boolean(busyAction));
    elements.overallStatus.querySelector('span').textContent = activeLabel;
    if (busyAction) {
      elements.serviceCaption.textContent = t(busyAction === 'download' ? 'service.captionDownload' : 'service.captionUpdating');
    } else if (running) {
      elements.serviceCaption.textContent = t(state.diagnostic ? 'service.captionDiagnosticRunning' : 'service.captionRunning');
    } else if (!hasApi) {
      elements.serviceCaption.textContent = t('service.captionNoApi');
    } else if (!selectedAddress) {
      elements.serviceCaption.textContent = t('service.captionNoInterface');
    } else if (!downloadReady) {
      elements.serviceCaption.textContent = t('service.captionNoDownload');
    } else {
      elements.serviceCaption.textContent = t(state.diagnostic ? 'service.captionDiagnosticReady' : 'service.captionReady');
    }
    renderDownload(download, downloadReady);
    if (transientSourceError) {
      elements.sourceMessage.textContent = asText(transientSourceError);
      elements.sourceMessage.className = transientSourceError.key === 'source.canceled' ? 'field-message' : 'field-message error';
    }
    renderRemote(state);
  }

  function renderRemote(state) {
    const target = state.ps5Target || {};
    const targetEdited = [elements.ps5Ip, elements.elfPort, elements.managerPort]
      .some(input => locallyEdited.has(input));
    const task = state.remoteTask;
    const active = task && ['checking', 'sending', 'verifying', 'uploading', 'installing'].includes(task.phase);
    elements.saveTarget.disabled = savingTarget || Boolean(active);
    for (const input of [elements.ps5Ip, elements.elfPort, elements.managerPort]) input.disabled = Boolean(active);
    elements.targetMessage.textContent = targetFeedback ? asText(targetFeedback) : t('target.help');
    elements.pkgName.textContent = state.pkgSelection?.name || t('pkg.none');
    elements.pkgDetails.textContent = state.pkgSelection ?
      `${(state.pkgSelection.size / 1024 / 1024).toFixed(1)} MiB · ${state.pkgSelection.details?.title_name || ''}` : t('pkg.dropHelp');
    elements.pkgSelect.disabled = Boolean(active);
    elements.pkgInstall.disabled = Boolean(active) || targetEdited || !state.pkgSelection || !target.address;
    const transfer = Number(task?.transferProgress);
    const install = Number(task?.installProgress);
    $('#pkg-transfer').value = Number.isFinite(transfer) ? Math.min(100, Math.max(0, transfer)) : 0;
    $('#pkg-transfer-label').textContent = task?.transferProgress == null ? '—' : `${Math.round(transfer)}%`;
    $('#pkg-install-progress').value = Number.isFinite(install) ? Math.min(100, Math.max(0, install)) : 0;
    $('#pkg-install-label').textContent = task?.installProgress == null ? '—' : `${Math.round(install)}%`;
    elements.remoteCancel.hidden = !active;
    elements.remoteCancel.disabled = remoteAction === 'cancel';
    elements.remoteDetails.hidden = !task?.error?.detail;
    elements.remoteRaw.textContent = task?.error?.detail || '';
    elements.remoteStatus.textContent = task ?
      `${task.label || ''} · ${task.target?.address || ''} · ${t(`remote.${task.phase}`, { progress: task.transferProgress ?? 0 })}${task.error ? ` · ${asText(task.error)}` : ''}` : '';
    for (const card of document.querySelectorAll('[data-component]')) {
      const id = card.dataset.component;
      const entry = state.components?.[id] || {};
      const downloading = entry.phase === 'downloading';
      card.querySelector('.component-status').textContent = entry.error ? asText(entry.error) :
        downloading ? t('components.downloading', { progress: entry.progress ?? 0 }) :
          entry.phase === 'ready' ? t('components.ready') : t('components.notDownloaded');
      card.querySelector('progress').value = entry.progress || 0;
      const downloadButton = card.querySelector('.component-download');
      downloadButton.textContent = t(downloading ? 'components.cancelDownload' : 'components.download');
      downloadButton.disabled = remoteAction === `download:${id}`;
      const loadButton = card.querySelector('.component-load');
      loadButton.disabled = Boolean(active) || targetEdited || entry.phase !== 'ready' || !target.address;
      loadButton.textContent = t('components.load');
      const runtime = card.querySelector('.component-runtime');
      if (runtime) {
        const status = state.componentRuntime?.[id] || {};
        const current = status.target === target.address && !targetEdited ? status : { phase: 'unchecked' };
        runtime.textContent = current.phase === 'error' ?
          t('components.runtimeError', { detail: asText(current.error) }) :
          t(`components.runtime${(current.phase || 'unchecked')[0].toUpperCase()}${(current.phase || 'unchecked').slice(1)}`);
        card.querySelector('.component-check').disabled = !target.address || targetEdited || Boolean(active) || Boolean(remoteAction);
        card.querySelector('.component-open').disabled = !target.address || targetEdited || Boolean(active) || Boolean(remoteAction);
      }
      const notice = card.querySelector('.component-notice');
      if (notice) {
        const sameTarget = task?.target?.address === target.address &&
          task?.target?.elfPort === target.elfPort && task?.target?.managerPort === target.managerPort;
        const visible = task?.type === 'component' && task.label === id && sameTarget &&
          ['alreadyRunning', 'alreadyRunningBusy'].includes(task.phase);
        notice.hidden = !visible;
        if (visible) {
          notice.querySelector('.component-notice-text').textContent =
            t(task.phase === 'alreadyRunningBusy' ? 'components.managerRunningBusy' : 'components.managerRunning');
          const reloadButton = notice.querySelector('.component-reload');
          reloadButton.hidden = task.phase !== 'alreadyRunning';
          reloadButton.disabled = targetEdited || Boolean(remoteAction);
        }
      }
    }
  }

  async function refreshState() {
    if (!api || typeof api.getState !== 'function') throw i18n.message('error.controlUnavailable');
    mergeState(await api.getState());
  }

  async function runAction(action, operation) {
    if (busyAction) return;
    transientError = null;
    transientSourceError = null;
    busyAction = action;
    render();
    try {
      const result = await operation();
      if (result?.ok === false) throw result.error || i18n.message('error.operationFailed');
      await refreshState();
      if (action === 'download') {
        if (currentState?.sourceUrl === elements.sourceUrl.value.trim()) locallyEdited.delete(elements.sourceUrl);
        if (currentState?.entryPath === elements.entryPath.value.trim()) locallyEdited.delete(elements.entryPath);
      } else if (action === 'start' && currentState?.targetDomain === (elements.targetDomain.value.trim() || undefined)) {
        locallyEdited.delete(elements.targetDomain);
      }
    } catch (error) {
      const issue = error?.key ? error : i18n.serializeError(error);
      const message = asText(issue) || t('error.operationFailed');
      addLog(issue, issue.key === 'source.canceled' ? 'info' : 'error');
      if (action === 'download') {
        transientSourceError = issue;
        elements.sourceMessage.textContent = message;
        elements.sourceMessage.className = issue.key === 'source.canceled' ? 'field-message' : 'field-message error';
      } else {
        transientError = issue;
        showError(issue);
      }
    } finally {
      if (action === 'download') cancelRequested = false;
      busyAction = '';
      render();
    }
  }

  function stateFromEvent(event) {
    if (!event || typeof event !== 'object') return null;
    const payload = event.state && typeof event.state === 'object' ? event.state : event;
    if (payload.interfaces || payload.service || payload.download || payload.urls || payload.selectedIp) return payload;
    return null;
  }

  function onEvent(event) {
    const next = stateFromEvent(event);
    if (next) mergeState(next);
    if (event && typeof event === 'object') {
      const message = event.log ?? event.message;
      if (message) addLog(message, event.level || 'info', event.timestamp || new Date());
      const error = event.error;
      if (error && !next?.service?.error && !next?.download?.error) addLog(error, 'error', event.timestamp || new Date());
    } else if (typeof event === 'string') {
      addLog(event);
    }
  }

  elements.sourceUrl.addEventListener('input', () => { locallyEdited.add(elements.sourceUrl); render(); });
  elements.entryPath.addEventListener('input', () => { locallyEdited.add(elements.entryPath); render(); });
  elements.targetDomain.addEventListener('input', () => locallyEdited.add(elements.targetDomain));
  for (const input of [elements.ps5Ip, elements.elfPort, elements.managerPort])
    input.addEventListener('input', () => { locallyEdited.add(input); targetFeedback = null; render(); });
  elements.saveTarget.addEventListener('click', async () => {
    if (!api?.setPs5Target || savingTarget) return;
    savingTarget = true; render();
    try {
      const result = await api.setPs5Target({ address: elements.ps5Ip.value.trim(),
        elfPort: Number(elements.elfPort.value), managerPort: Number(elements.managerPort.value) });
      if (result?.ok === false) throw result.error;
      for (const input of [elements.ps5Ip, elements.elfPort, elements.managerPort]) locallyEdited.delete(input);
      targetFeedback = i18n.message('target.saved'); mergeState(result);
    } catch (cause) { targetFeedback = cause?.key ? cause : i18n.serializeError(cause); addLog(targetFeedback, 'error'); }
    finally { savingTarget = false; render(); }
  });
  $('#guide-toggle').addEventListener('click', () => { $('#guide-panel').open = !$('#guide-panel').open; });
  $('#discord-link').addEventListener('click', async () => {
    const result = await api?.openContact?.('discord');
    if (result?.ok === false) addLog(result.error, 'error');
  });
  for (const card of document.querySelectorAll('[data-component]')) {
    const id = card.dataset.component;
    card.querySelector('.component-source').addEventListener('click', async () => {
      const result = await api?.openComponentSource?.(id);
      if (result?.ok === false) addLog(result.error, 'error');
    });
    card.querySelector('.component-download').addEventListener('click', async () => {
      if (currentState?.components?.[id]?.phase === 'downloading') {
        const result = await api.cancelComponentDownload(id);
        if (result?.ok === false) addLog(result.error, 'error');
        return;
      }
      try {
        const result = await api.downloadComponent(id);
        if (result?.ok === false) throw result.error;
        mergeState(result);
      } catch (cause) { addLog(cause?.key ? cause : i18n.serializeError(cause), 'error'); }
    });
    card.querySelector('.component-load').addEventListener('click', async () => {
      const previousTaskId = currentState?.remoteTask?.id;
      await runRemoteAction(`load:${id}`, () => api.loadComponent(id));
      if (id === 'pkgManager' && currentState?.remoteTask?.id !== previousTaskId &&
          ['alreadyRunning', 'alreadyRunningBusy'].includes(currentState?.remoteTask?.phase))
        card.querySelector('.component-notice').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
    card.querySelector('.component-reload')?.addEventListener('click', () =>
      runRemoteAction(`reload:${id}`, () => api.loadComponent(id,
        { reload: true, expectedTaskId: currentState?.remoteTask?.id })));
    card.querySelector('.component-check')?.addEventListener('click', () =>
      runRemoteAction(`check:${id}`, () => api.checkComponent(id)));
    card.querySelector('.component-open')?.addEventListener('click', () =>
      runRemoteAction(`open:${id}`, () => api.openComponentUi(id)));
  }
  elements.pkgSelect.addEventListener('click', () => runRemoteAction('select', () => api.selectPkg()));
  elements.pkgInstall.addEventListener('click', () => runRemoteAction('install', () => api.installPkg(currentState?.pkgSelection?.fileId)));
  elements.pkgDrop.addEventListener('dragover', event => { event.preventDefault(); elements.pkgDrop.classList.add('drag-over'); });
  elements.pkgDrop.addEventListener('dragleave', () => elements.pkgDrop.classList.remove('drag-over'));
  elements.pkgDrop.addEventListener('drop', event => {
    event.preventDefault(); elements.pkgDrop.classList.remove('drag-over');
    if (event.dataTransfer?.files?.length === 1) runRemoteAction('select', () => api.registerDroppedPkg(event.dataTransfer.files[0]));
  });
  elements.remoteCancel.addEventListener('click', async () => {
    if (!currentState?.remoteTask?.id) return;
    remoteAction = 'cancel'; render();
    try { const result = await api.cancelTask(currentState.remoteTask.id); if (result?.ok === false) throw result.error; }
    catch (cause) { addLog(cause?.key ? cause : i18n.serializeError(cause), 'error'); }
    finally { remoteAction = ''; render(); }
  });

  async function runRemoteAction(action, operation) {
    if (remoteAction) return;
    remoteAction = action; render();
    try {
      const result = await operation();
      if (result?.ok === false) throw result.error;
      mergeState(result);
    } catch (cause) { addLog(cause?.key ? cause : i18n.serializeError(cause), 'error'); }
    finally { remoteAction = ''; render(); }
  }
  elements.downloadRoute.addEventListener('click', async () => {
    if (!api?.setDownloadRoute || savingRoute || !currentState) return;
    const mode = currentState.downloadRoute === 'mirror' ? 'direct' : 'mirror';
    savingRoute = true;
    routeError = null;
    render();
    try {
      const result = await api.setDownloadRoute(mode);
      if (result?.ok === false) throw result.error;
      mergeState(result);
    } catch (cause) {
      routeError = cause?.key ? cause : i18n.serializeError(cause);
      addLog(routeError, 'error');
    } finally { savingRoute = false; render(); }
  });
  elements.language.addEventListener('change', async () => {
    if (!api?.setLanguage || savingLanguage) return;
    const previous = currentState?.language || 'system';
    savingLanguage = true;
    render();
    try {
      const result = await api.setLanguage(elements.language.value);
      if (result?.ok === false) throw result.error;
      mergeState(result);
      transientError = null;
    } catch (cause) {
      elements.language.value = previous;
      transientError = cause?.key ? cause : i18n.serializeError(cause);
      addLog(transientError, 'error');
    } finally { savingLanguage = false; render(); }
  });
  elements.interface.addEventListener('change', () => {
    if (!currentState) return;
    currentState.selectedIp = elements.interface.value;
    currentState.urls = { ...(currentState.urls || {}), http: currentState.selectedIp ? `http://${currentState.selectedIp}:${currentState.ports?.http ?? 8000}/` : '' };
    elements.dnsAddress.textContent = currentState.selectedIp || '—';
    elements.httpsAddress.textContent = currentState.urls?.https || '—';
    elements.httpAddress.textContent = currentState.urls?.http || '—';
    render();
  });

  elements.downloadButton.addEventListener('click', () => {
    if (!api || typeof api.download !== 'function') return;
    const sourceUrl = elements.sourceUrl.value.trim();
    const entryPath = elements.entryPath.value.trim();
    if (!sourceUrlIsValid(sourceUrl)) {
      transientSourceError = i18n.message('source.invalidUrl');
      elements.sourceMessage.textContent = asText(transientSourceError);
      elements.sourceMessage.className = 'field-message error';
      return;
    }
    if (!sourcePathIsValid(entryPath)) {
      transientSourceError = i18n.message('source.invalidPath');
      elements.sourceMessage.textContent = asText(transientSourceError);
      elements.sourceMessage.className = 'field-message error';
      return;
    }
    transientSourceError = null;
    elements.sourceMessage.textContent = t('source.starting');
    elements.sourceMessage.className = 'field-message';
    elements.progressWrap.hidden = false;
    elements.progressPhase.textContent = t('source.preparing');
    elements.progressPercent.textContent = '';
    elements.progressMeter.removeAttribute('value');
    runAction('download', () => api.download({ sourceUrl, entryPath }));
  });

  elements.cancelDownload.addEventListener('click', async () => {
    if (!api || typeof api.cancelDownload !== 'function' || cancelRequested) return;
    cancelRequested = true;
    render();
    try {
      await api.cancelDownload();
      await refreshState();
    } catch (error) {
      cancelRequested = false;
      addLog(i18n.message('error.cancelFailed', { detail: asText(error) }), 'error');
    }
    render();
  });

  elements.serviceToggle.addEventListener('click', () => {
    if (!api) return;
    if (hasRunningService(currentState?.service)) {
      if (typeof api.stop === 'function') runAction('stop', () => api.stop());
      return;
    }
    if (typeof api.start !== 'function') return;
    const interfaceAddress = elements.interface.value || currentState?.selectedIp || '';
    const entryPath = elements.entryPath.value.trim();
    if (!interfaceAddress) {
      elements.serviceCaption.textContent = t('service.selectInterface');
      return;
    }
    if (!sourcePathIsValid(entryPath)) {
      elements.serviceCaption.textContent = t('service.invalidEntry');
      return;
    }
    runAction('start', () => api.start({
      interfaceAddress,
      entryPath,
      targetDomain: elements.targetDomain.value.trim() || undefined,
    }));
  });

  document.querySelectorAll('[data-copy]').forEach((button) => button.addEventListener('click', async () => {
    const target = document.getElementById(button.dataset.copy);
    const value = target?.textContent?.trim();
    if (!value || value === '—') return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        const temporary = document.createElement('textarea');
        temporary.value = value;
        temporary.style.position = 'fixed';
        temporary.style.opacity = '0';
        document.body.append(temporary);
        temporary.select();
        const copied = document.execCommand('copy');
        temporary.remove();
        if (!copied) throw new Error('Copy failed');
      }
      copyFeedback = { button, key: 'common.copied' };
      button.textContent = t('common.copied');
    } catch {
      copyFeedback = { button, key: 'common.copyFailed' };
      button.textContent = t('common.copyFailed');
    }
    window.setTimeout(() => { if (copyFeedback?.button === button) copyFeedback = null; button.textContent = t('common.copy'); }, 1400);
  }));

  window.addEventListener('beforeunload', () => {
    if (typeof eventUnsubscribe === 'function') eventUnsubscribe();
  });

  if (!api || typeof api.getState !== 'function') {
    applyTranslations();
    elements.overallStatus.querySelector('span').textContent = t('error.controlUnavailable');
    elements.serviceCaption.textContent = t('service.captionNoApi');
    elements.sourceMessage.textContent = t('error.apiUnavailableDownload');
    elements.sourceMessage.className = 'field-message error';
    renderInterfaces({ interfaces: [] });
    return;
  }

  if (typeof api.onEvent === 'function') {
    try {
      eventUnsubscribe = api.onEvent(onEvent);
    } catch (error) {
      addLog(i18n.message('error.subscribeFailed', { detail: asText(error) }), 'error');
    }
  }

  applyTranslations();
  refreshState().catch((error) => {
    const message = asText(error) || t('error.stateReadFailed');
    elements.overallStatus.querySelector('span').textContent = t('error.stateReadFailed');
    elements.serviceCaption.textContent = message;
    showError(i18n.serializeError(error, 'error.stateReadFailed'));
    addLog(message, 'error');
  });
})();
