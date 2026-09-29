'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('localHost', Object.freeze({
  getState: () => ipcRenderer.invoke('host:getState'),
  download: options => ipcRenderer.invoke('host:download', options),
  cancelDownload: () => ipcRenderer.invoke('host:cancelDownload'),
  start: options => ipcRenderer.invoke('host:start', options),
  stop: () => ipcRenderer.invoke('host:stop'),
  setLanguage: language => ipcRenderer.invoke('host:setLanguage', language),
  setDownloadRoute: mode => ipcRenderer.invoke('host:setDownloadRoute', mode),
  setPs5Target: target => ipcRenderer.invoke('host:setPs5Target', target),
  getCatalog: () => ipcRenderer.invoke('host:getCatalog'),
  openContact: id => ipcRenderer.invoke('host:openContact', id),
  openComponentSource: id => ipcRenderer.invoke('host:openComponentSource', id),
  downloadComponent: id => ipcRenderer.invoke('components:download', id),
  cancelComponentDownload: id => ipcRenderer.invoke('components:cancelDownload', id),
  loadComponent: (id, options) => ipcRenderer.invoke('components:load', id, options),
  selectPkg: () => ipcRenderer.invoke('pkg:selectFile'),
  registerDroppedPkg: file => ipcRenderer.invoke('pkg:registerDrop', webUtils.getPathForFile(file)),
  installPkg: fileId => ipcRenderer.invoke('pkg:install', fileId),
  cancelTask: id => ipcRenderer.invoke('tasks:cancel', id),
  onEvent: callback => {
    if (typeof callback !== 'function') throw new TypeError('Expected a callback');
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('host:event', listener);
    return () => ipcRenderer.removeListener('host:event', listener);
  },
}));
