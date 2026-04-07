'use strict'

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('bookDiscord', {
  platform: process.platform,

  // ─── Discord RPC ───────────────────────────────────────────────────────────
  rpcConnect:    (clientId) => ipcRenderer.invoke('rpc:connect', { clientId }),
  rpcDisconnect: ()         => ipcRenderer.invoke('rpc:disconnect'),
  rpcStatus:     ()         => ipcRenderer.invoke('rpc:status'),
  rpcSetBook:    (book)     => ipcRenderer.invoke('rpc:set-book', book),
  rpcUpdatePage: (page)     => ipcRenderer.invoke('rpc:update-page', { currentPage: page }),
  rpcStopReading:()         => ipcRenderer.invoke('rpc:stop-reading'),

  // ─── Sessions ─────────────────────────────────────────────────────────────
  sessionsGet: () => ipcRenderer.invoke('sessions:get'),

  // ─── Apple Books ──────────────────────────────────────────────────────────
  detectAppleBooks: () => ipcRenderer.invoke('books:detect-apple'),

  // ─── Library ──────────────────────────────────────────────────────────────
  libraryGet:    ()       => ipcRenderer.invoke('library:get'),
  librarySave:   (book)   => ipcRenderer.invoke('library:save', book),
  libraryRemove: (id)     => ipcRenderer.invoke('library:remove', id),

  // ─── Settings ─────────────────────────────────────────────────────────────
  settingsGet:  ()       => ipcRenderer.invoke('settings:get'),
  settingsSave: (data)   => ipcRenderer.invoke('settings:save', data),

  // ─── Utilities ────────────────────────────────────────────────────────────
  openExternal: (url)    => ipcRenderer.invoke('shell:open-external', url),
  pickImage:    ()       => ipcRenderer.invoke('dialog:pick-image'),
  saveFile:     (opts)   => ipcRenderer.invoke('file:save', opts),

  // ─── Main → Renderer events ───────────────────────────────────────────────
  onRpcStatusChanged: (cb) => ipcRenderer.on('rpc:status-changed', (_, d) => cb(d)),
  onLibraryChanged:   (cb) => ipcRenderer.on('library:changed',    (_, d) => cb(d)),
})
