'use strict'

const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, shell, dialog } = require('electron')
const path = require('path')
const fs = require('fs')
const { execFile, execFileSync } = require('child_process')
const zlib = require('zlib')

let DiscordRPC = null
try { DiscordRPC = require('discord-rpc') } catch { /* installed on npm install */ }

// ─── App State ────────────────────────────────────────────────────────────────

const appState = {
  rpc: null,
  rpcConnected: false,
  win: null,
  tray: null,
  currentBook: null,   // { title, authors, pageCount, currentPage, coverUrl, startTime }
  readingTimer: null,
  settings: {},
  library: [],
  isQuitting: false,
}

// ─── Persistence ──────────────────────────────────────────────────────────────

const USER_DATA = app.getPath('userData')
const SETTINGS_PATH  = path.join(USER_DATA, 'settings.json')
const LIBRARY_PATH   = path.join(USER_DATA, 'library.json')
const SESSIONS_PATH  = path.join(USER_DATA, 'sessions.json')

function loadSettings() {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'))
  } catch {
    return { discordClientId: '', showTimer: true, showPages: true, autoDetectBooks: false }
  }
}

function saveSettings(data) {
  const next = { ...appState.settings, ...data }
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(next, null, 2))
  appState.settings = next
}

function loadLibrary() {
  try {
    return JSON.parse(fs.readFileSync(LIBRARY_PATH, 'utf8'))
  } catch {
    return []
  }
}

function saveLibrary(library) {
  fs.writeFileSync(LIBRARY_PATH, JSON.stringify(library, null, 2))
  appState.library = library
}

// ─── Sessions ─────────────────────────────────────────────────────────────────

function loadSessions() {
  try {
    return JSON.parse(fs.readFileSync(SESSIONS_PATH, 'utf8'))
  } catch {
    return []
  }
}

function logSession(session) {
  const sessions = loadSessions()
  // Keep max 500 sessions
  const next = [session, ...sessions].slice(0, 500)
  fs.writeFileSync(SESSIONS_PATH, JSON.stringify(next, null, 2))
}

function endCurrentSession() {
  if (!appState.currentBook || !appState.currentBook.startTime) return
  const now = Date.now()
  const durationMs = now - appState.currentBook.startTime
  if (durationMs < 30_000) return  // ignore sessions under 30s

  logSession({
    bookId:      appState.currentBook.googleBooksId || null,
    title:       appState.currentBook.title || 'Unknown',
    authors:     appState.currentBook.authors || '',
    coverUrl:    appState.currentBook.coverUrl || null,
    startTime:   appState.currentBook.startTime,
    endTime:     now,
    durationMs,
    startPage:   appState.currentBook.startPage || appState.currentBook.currentPage || 1,
    endPage:     appState.currentBook.currentPage || 1,
    date:        new Date(appState.currentBook.startTime).toISOString().slice(0, 10),
  })
}

// ─── Discord RPC ──────────────────────────────────────────────────────────────

function buildActivity() {
  const book = appState.currentBook
  if (!book) return null

  const showPages = appState.settings.showPages !== false
  const title = (book.title || 'Unknown Book').slice(0, 128)
  const authors = (book.authors || '').slice(0, 128)

  // Discord Rich Presence accepts external https URLs as image keys.
  // Fall back to a named asset uploaded in the Discord dev portal.
  const isHttpUrl = typeof book.coverUrl === 'string' && /^https?:\/\//i.test(book.coverUrl)
  const largeImageKey = isHttpUrl ? book.coverUrl : 'book_cover'

  const activity = {
    details: title,
    largeImageKey,
    largeImageText: title,
    smallImageKey: 'reading',
    smallImageText: 'Reading',
    instance: false,
  }

  if (showPages) {
    activity.state = book.pageCount
      ? `Page ${book.currentPage || 1} of ${book.pageCount}`
      : `Page ${book.currentPage || 1}`
  } else if (authors) {
    activity.state = `by ${authors}`
  }

  if (appState.settings.showTimer !== false && book.startTime) {
    activity.startTimestamp = Math.floor(book.startTime / 1000)
  }

  return activity
}

async function connectRPC(clientId) {
  if (!DiscordRPC) {
    return { success: false, error: 'discord-rpc not installed. Run: npm install' }
  }
  if (!clientId) {
    return { success: false, error: 'No Discord Client ID set' }
  }

  await disconnectRPC()

  const client = new DiscordRPC.Client({ transport: 'ipc' })
  appState.rpc = client

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      appState.rpc = null
      appState.rpcConnected = false
      notifyRenderer('rpc:status-changed', { connected: false, error: 'Timed out — is Discord running?' })
      resolve({ success: false, error: 'Connection timed out. Make sure Discord is running.' })
    }, 10000)

    client.on('ready', async () => {
      clearTimeout(timeout)
      appState.rpcConnected = true
      notifyRenderer('rpc:status-changed', { connected: true })
      updateTrayMenu()
      if (appState.currentBook) await updateActivity()
      resolve({ success: true })
    })

    client.on('disconnected', () => {
      appState.rpcConnected = false
      notifyRenderer('rpc:status-changed', { connected: false })
      updateTrayMenu()
    })

    client.login({ clientId }).catch((err) => {
      clearTimeout(timeout)
      appState.rpc = null
      appState.rpcConnected = false
      const msg = err.message || String(err)
      notifyRenderer('rpc:status-changed', { connected: false, error: msg })
      resolve({ success: false, error: msg })
    })
  })
}

async function disconnectRPC() {
  if (appState.rpc) {
    try { await appState.rpc.destroy() } catch { /* ignore */ }
    appState.rpc = null
    appState.rpcConnected = false
    notifyRenderer('rpc:status-changed', { connected: false })
    updateTrayMenu()
  }
}

async function updateActivity() {
  if (!appState.rpcConnected || !appState.rpc || !appState.currentBook) return
  try {
    await appState.rpc.setActivity(buildActivity())
  } catch (err) {
    if (err.message?.includes('disconnected')) {
      appState.rpcConnected = false
      notifyRenderer('rpc:status-changed', { connected: false })
    }
  }
}

async function clearActivity() {
  if (appState.rpcConnected && appState.rpc) {
    try { await appState.rpc.clearActivity() } catch { /* ignore */ }
  }
}

function startReadingTimer() {
  stopReadingTimer()
  // Refresh Discord presence every 15 seconds so elapsed time stays accurate
  appState.readingTimer = setInterval(() => {
    if (appState.rpcConnected && appState.currentBook) updateActivity()
  }, 15_000)
}

function stopReadingTimer() {
  if (appState.readingTimer) {
    clearInterval(appState.readingTimer)
    appState.readingTimer = null
  }
}

// ─── Apple Books Detection ────────────────────────────────────────────────────

function detectAppleBooks() {
  if (process.platform !== 'darwin') return null

  // Strategy 1: Query Books SQLite database (provides rich metadata)
  try {
    const dbDir = path.join(
      process.env.HOME,
      'Library/Containers/com.apple.iBooksX/Data/Documents/BKLibrary'
    )
    const files = fs.readdirSync(dbDir).filter(f => f.endsWith('.sqlite'))
    if (files.length > 0) {
      const dbPath = path.join(dbDir, files[0])
      const query = `SELECT ZTITLE, ZAUTHOR, ZPAGECOUNT, ZREADINGPROGRESS, ZLASTOPENDATE
        FROM ZBKLIBRARYASSET
        WHERE ZISHIDDEN=0 AND ZTITLE IS NOT NULL AND ZSTATE != 0
        ORDER BY ZLASTOPENDATE DESC LIMIT 1;`

      const result = execFileSync('/usr/bin/sqlite3', ['-json', dbPath, query], {
        timeout: 3000,
        encoding: 'utf8'
      }).trim()

      if (result) {
        const rows = JSON.parse(result)
        if (rows && rows.length > 0) {
          const row = rows[0]
          // Core Data timestamp: seconds since Jan 1, 2001 (offset = 978307200)
          const lastOpenMs = (row.ZLASTOPENDATE + 978307200) * 1000
          // Only use if opened within last 30 minutes
          if (Date.now() - lastOpenMs < 30 * 60 * 1000) {
            const estimatedPage = row.ZPAGECOUNT > 0
              ? Math.round((row.ZREADINGPROGRESS || 0) * row.ZPAGECOUNT)
              : null
            return {
              title: row.ZTITLE,
              authors: row.ZAUTHOR || 'Unknown',
              pageCount: row.ZPAGECOUNT || null,
              currentPage: estimatedPage || 1,
              source: 'apple-books',
            }
          }
        }
      }
    }
  } catch { /* fall through to osascript */ }

  // Strategy 2: Read window title via osascript
  try {
    const title = execFileSync('osascript', [
      '-e', 'tell application "Books" to if (count of windows) > 0 then get name of front window'
    ], { timeout: 3000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()

    if (title) {
      return { title, authors: 'Unknown', pageCount: null, currentPage: 1, source: 'apple-books' }
    }
  } catch { /* Books not running */ }

  return null
}

// ─── IPC Handlers ─────────────────────────────────────────────────────────────

function setupIPC() {
  // RPC
  ipcMain.handle('rpc:connect', (_, { clientId }) => connectRPC(clientId))
  ipcMain.handle('rpc:disconnect', async () => { await disconnectRPC(); return { success: true } })
  ipcMain.handle('rpc:status', () => ({ connected: appState.rpcConnected, book: appState.currentBook }))

  ipcMain.handle('rpc:set-book', async (_, book) => {
    // End any previous session before starting a new one
    endCurrentSession()
    appState.currentBook = {
      ...book,
      startTime: book.startTime || Date.now(),
      startPage: book.currentPage || 1,
    }
    startReadingTimer()
    await updateActivity()
    updateTrayMenu()
    return { success: true }
  })

  ipcMain.handle('rpc:update-page', async (_, { currentPage }) => {
    if (!appState.currentBook) return { success: false, error: 'No active book' }
    appState.currentBook = { ...appState.currentBook, currentPage }
    await updateActivity()
    return { success: true }
  })

  ipcMain.handle('rpc:stop-reading', async () => {
    endCurrentSession()
    stopReadingTimer()
    appState.currentBook = null
    await clearActivity()
    updateTrayMenu()
    return { success: true }
  })

  // Sessions
  ipcMain.handle('sessions:get', () => loadSessions())

  ipcMain.handle('file:save', async (_, { content, filename }) => {
    const result = await dialog.showSaveDialog(appState.win, {
      defaultPath: filename,
      filters: [
        { name: 'CSV', extensions: ['csv'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    })
    if (result.canceled || !result.filePath) return false
    fs.writeFileSync(result.filePath, content, 'utf8')
    return true
  })

  // Apple Books
  ipcMain.handle('books:detect-apple', () => detectAppleBooks())

  // Library
  ipcMain.handle('library:get', () => appState.library)

  ipcMain.handle('library:save', (_, book) => {
    const idx = appState.library.findIndex(b => b.googleBooksId === book.googleBooksId)
    const next = idx >= 0
      ? appState.library.map((b, i) => i === idx ? { ...b, ...book } : b)
      : [book, ...appState.library].slice(0, 50)
    saveLibrary(next)
    notifyRenderer('library:changed', next)
    return next
  })

  ipcMain.handle('library:remove', (_, googleBooksId) => {
    const next = appState.library.filter(b => b.googleBooksId !== googleBooksId)
    saveLibrary(next)
    notifyRenderer('library:changed', next)
    return next
  })

  // Settings
  ipcMain.handle('settings:get', () => appState.settings)
  ipcMain.handle('settings:save', (_, data) => { saveSettings(data); return appState.settings })

  // Utilities
  ipcMain.handle('shell:open-external', (_, url) => { shell.openExternal(url); return true })

  ipcMain.handle('dialog:pick-image', async () => {
    const result = await dialog.showOpenDialog(appState.win, {
      title: 'Select Book Cover',
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp'] }],
      properties: ['openFile'],
    })
    if (result.canceled || !result.filePaths.length) return null

    const filePath = result.filePaths[0]
    const img = nativeImage.createFromPath(filePath)
    if (img.isEmpty()) return null

    // Resize to max 300px wide before encoding to keep data URL compact
    const { width } = img.getSize()
    const resized = width > 300 ? img.resize({ width: 300 }) : img
    const buffer  = resized.toJPEG(88)
    return `data:image/jpeg;base64,${buffer.toString('base64')}`
  })
}

// ─── Icon & Tray ──────────────────────────────────────────────────────────────

/** Generates a minimal valid PNG buffer of a solid color */
function makeSolidColorPng(width, height, r, g, b) {
  const rowSize = 1 + width * 3
  const raw = Buffer.alloc(height * rowSize)
  for (let y = 0; y < height; y++) {
    const base = y * rowSize
    raw[base] = 0 // filter None
    for (let x = 0; x < width; x++) {
      raw[base + 1 + x * 3] = r
      raw[base + 1 + x * 3 + 1] = g
      raw[base + 1 + x * 3 + 2] = b
    }
  }
  const compressed = zlib.deflateSync(raw)

  // CRC-32
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  function crc32(buf) {
    let crc = 0xFFFFFFFF
    for (const byte of buf) crc = table[(crc ^ byte) & 0xFF] ^ (crc >>> 8)
    return (crc ^ 0xFFFFFFFF) >>> 0
  }
  function chunk(type, data) {
    const t = Buffer.from(type, 'ascii')
    const crcVal = crc32(Buffer.concat([t, data]))
    const out = Buffer.alloc(12 + data.length)
    out.writeUInt32BE(data.length, 0)
    t.copy(out, 4)
    data.copy(out, 8)
    out.writeUInt32BE(crcVal, 8 + data.length)
    return out
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8; ihdr[9] = 2  // 8-bit RGB

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function createTrayIcon() {
  const iconFile = path.join(__dirname, 'assets', 'tray.png')
  if (fs.existsSync(iconFile)) {
    return nativeImage.createFromPath(iconFile)
  }
  // Fallback: generate a 16x16 Discord purple icon
  const pngBuffer = makeSolidColorPng(16, 16, 88, 101, 242) // #5865F2
  return nativeImage.createFromBuffer(pngBuffer)
}

function updateTrayMenu() {
  if (!appState.tray) return
  const book = appState.currentBook
  const connected = appState.rpcConnected

  const menu = Menu.buildFromTemplate([
    { label: 'Pageline', enabled: false },
    { type: 'separator' },
    {
      label: book ? `📖 ${(book.title || 'Unknown').slice(0, 35)}` : 'Not reading',
      enabled: false,
    },
    {
      label: connected ? '🟢 Discord connected' : '⚪ Discord disconnected',
      enabled: false,
    },
    { type: 'separator' },
    { label: 'Open Pageline', click: () => { appState.win?.show(); appState.win?.focus() } },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => { appState.isQuitting = true; app.quit() },
    },
  ])
  appState.tray.setContextMenu(menu)
  appState.tray.setToolTip(book ? `Reading: ${book.title}` : 'Pageline')
}

// ─── Window ───────────────────────────────────────────────────────────────────

function createWindow() {
  appState.win = new BrowserWindow({
    width: 960,
    height: 680,
    minWidth: 720,
    minHeight: 520,
    backgroundColor: '#0f0f1a',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 16, y: 18 },
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  appState.win.loadFile('index.html')
  appState.win.once('ready-to-show', () => appState.win.show())

  appState.win.on('close', (e) => {
    if (!appState.isQuitting && process.platform === 'darwin') {
      e.preventDefault()
      appState.win.hide()
    }
  })
}

function createTray() {
  const icon = createTrayIcon()
  appState.tray = new Tray(icon)
  appState.tray.on('double-click', () => { appState.win?.show(); appState.win?.focus() })
  updateTrayMenu()
}

function notifyRenderer(channel, data) {
  if (appState.win && !appState.win.isDestroyed()) {
    appState.win.webContents.send(channel, data)
  }
}

// ─── App Lifecycle ────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  appState.settings = loadSettings()
  appState.library = loadLibrary()

  setupIPC()
  createWindow()
  if (process.platform !== 'linux') createTray()

  app.on('activate', () => {
    if (appState.win?.isVisible()) appState.win.focus()
    else appState.win?.show()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', async () => {
  appState.isQuitting = true
  endCurrentSession()
  stopReadingTimer()
  await disconnectRPC()
})
