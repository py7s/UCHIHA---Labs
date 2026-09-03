'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('uchihaLauncher', {
    isDesktop: true,
    version: '1.0.0',
    getInfo: () => ipcRenderer.invoke('launcher:getInfo'),
    setApiBase: (apiBase) => ipcRenderer.invoke('launcher:setApiBase', apiBase),
    setAuth: (payload) => ipcRenderer.invoke('launcher:setAuth', payload),
    openExternal: (url) => ipcRenderer.invoke('launcher:openExternal', url),
    downloadLauncher: () => ipcRenderer.invoke('launcher:downloadLauncherExe'),
});
