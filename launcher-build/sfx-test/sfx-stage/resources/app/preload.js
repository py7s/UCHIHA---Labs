'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('uchihaLauncher', {
    isDesktop: true,
    version: '1.0.0',
    getInfo: () => ipcRenderer.invoke('launcher:getInfo'),
    openExternal: (url) => ipcRenderer.invoke('launcher:openExternal', url),
    downloadLauncher: () => ipcRenderer.invoke('launcher:downloadLauncherExe'),
});
