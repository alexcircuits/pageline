'use strict'

;(function () {
  const bd = window.bookDiscord

  // Lib globals injected via <script> tags
  const { escapeHtml: esc, escapeAttr, formatDuration } = UtilsLib
  const { searchBooks } = BooksLib

  // ─── State ─────────────────────────────────────────────────────────────────

  let state = {
    selectedBook:  null,
    isReading:     false,
    sessionStart:  null,
    timerInterval: null,
    rpcConnected:  false,
    settings:      {},
    library:       [],
    searchResults: [],
    currentTab:    'reading',
  }

  let currentSearchAbort = null  // tracks in-flight search request

  // ─── Toast ─────────────────────────────────────────────────────────────────

  let toastTimer = null
  function showToast(msg, type = '') {
    const el = document.getElementById('toast')
    el.textContent = msg
    el.className = `toast${type ? ' ' + type : ''}`
    el.classList.remove('hidden')
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => el.classList.add('hidden'), 3200)
  }

  // ─── Tab navigation ────────────────────────────────────────────────────────

  function switchTab(name) {
    document.querySelectorAll('.nav-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.tab === name))
    document.querySelectorAll('.tab-panel').forEach(p =>
      p.classList.toggle('active', p.id === `tab-${name}`))
    state = { ...state, currentTab: name }
    if (name === 'library') renderLibrary()
    if (name === 'stats')   loadAndRenderStats()
  }

  async function loadAndRenderStats() {
    const sessions = await bd.sessionsGet()
    renderStats(sessions)
  }

  // ─── Book selection ─────────────────────────────────────────────────────────

  function selectBook(book, doSwitchTab = true) {
    state = { ...state, selectedBook: { ...book } }
    renderReadingCard()
    if (doSwitchTab) switchTab('reading')
  }

  // ─── Reading session ────────────────────────────────────────────────────────

  async function startReading() {
    if (!state.selectedBook) return

    if (!state.settings.discordClientId) {
      showToast('Enter a Discord Application ID in Settings first', 'warning')
      switchTab('settings')
      return
    }

    const page  = parseInt(document.getElementById('page-current').value, 10) || 1
    const total = parseInt(document.getElementById('page-total').value,   10) || state.selectedBook.pageCount || null
    const book  = { ...state.selectedBook, currentPage: page, pageCount: total, startTime: Date.now() }

    state = { ...state, selectedBook: book, isReading: true, sessionStart: Date.now() }

    const result = await bd.rpcSetBook(book)
    if (!result.success) {
      showToast(result.error || 'Failed to update Discord', 'error')
      state = { ...state, isReading: false, sessionStart: null }
    } else {
      showToast('Now showing on Discord', 'success')
      startTimer()
      await saveToLibrary(book, false)
    }

    renderReadingCard()
  }

  async function stopReading() {
    stopTimer()
    state = { ...state, isReading: false, sessionStart: null }
    await bd.rpcStopReading()
    renderReadingCard()
    showToast('Reading session ended')
  }

  async function updatePage() {
    const page = parseInt(document.getElementById('page-current').value, 10) || 1
    state = { ...state, selectedBook: { ...state.selectedBook, currentPage: page } }
    updateProgress()

    if (state.isReading) {
      await bd.rpcUpdatePage(page)
    }

    if (state.selectedBook?.googleBooksId) {
      const next = await bd.librarySave({ ...state.selectedBook, currentPage: page })
      if (next) state = { ...state, library: next }
    }
  }

  // ─── Timer ─────────────────────────────────────────────────────────────────

  function startTimer() {
    stopTimer()
    state = { ...state, timerInterval: setInterval(renderTimer, 1000) }
  }

  function stopTimer() {
    if (state.timerInterval) {
      clearInterval(state.timerInterval)
      state = { ...state, timerInterval: null }
    }
  }

  function renderTimer() {
    if (!state.sessionStart) return
    document.getElementById('timer-value').textContent =
      formatDuration(Date.now() - state.sessionStart)
  }

  // ─── Render: Reading card ───────────────────────────────────────────────────

  function renderReadingCard() {
    const empty = document.getElementById('reading-empty')
    const card  = document.getElementById('reading-card')
    const book  = state.selectedBook

    if (!book) {
      empty.classList.remove('hidden')
      card.classList.add('hidden')
      return
    }

    empty.classList.add('hidden')
    card.classList.remove('hidden')

    document.getElementById('active-title').textContent   = book.title
    document.getElementById('active-authors').textContent = book.authors
    document.getElementById('active-desc').textContent    = book.description || ''

    // Cover image with placeholder fallback
    const coverImg  = document.getElementById('active-cover')
    const coverPH   = document.getElementById('cover-placeholder')

    coverImg.onload = null
    coverImg.onerror = null
    if (book.coverUrl) {
      coverPH.classList.add('hidden')
      coverImg.classList.remove('hidden')
      coverImg.onerror = () => {
        coverImg.classList.add('hidden')
        showPlaceholder(coverPH, book.title)
      }
      coverImg.src = book.coverUrl
    } else {
      coverImg.classList.add('hidden')
      showPlaceholder(coverPH, book.title)
    }

    document.getElementById('page-current').value = book.currentPage || 1
    document.getElementById('page-total').value   = book.pageCount || ''

    // Start / Stop buttons
    document.getElementById('btn-start-reading').classList.toggle('hidden', state.isReading)
    document.getElementById('btn-stop-reading').classList.toggle('hidden', !state.isReading)

    // Timer
    const timerRow = document.getElementById('timer-row')
    timerRow.style.display = state.isReading ? 'flex' : 'none'
    if (!state.isReading) {
      document.getElementById('timer-value').textContent = '0:00:00'
    }

    updateProgress()
  }

  function showPlaceholder(el, title) {
    el.classList.remove('hidden')
    el.textContent = (title || '?').charAt(0).toUpperCase()
  }

  function updateProgress() {
    const current = parseInt(document.getElementById('page-current').value, 10) || 0
    const total   = parseInt(document.getElementById('page-total').value,   10) || 0
    const wrap    = document.getElementById('progress-wrap')

    if (total > 0 && current > 0) {
      const pct = Math.min(100, (current / total) * 100)
      document.getElementById('progress-fill').style.width = `${pct.toFixed(1)}%`
      document.getElementById('progress-pct').textContent  = `${Math.round(pct)}% complete`
      wrap.style.display = 'block'
    } else {
      wrap.style.display = 'none'
    }
  }

  // ─── Render: Book grid ──────────────────────────────────────────────────────

  function renderBookGrid(books, containerId, { showRemove = false } = {}) {
    const container = document.getElementById(containerId)
    if (!container) return

    container.innerHTML = books.map(book => `
      <div class="book-grid-item" data-id="${escapeAttr(book.googleBooksId)}">
        <img class="book-grid-cover"
             src="${escapeAttr(book.coverUrl || '')}"
             alt="${esc(book.title)}">
        <div class="book-grid-body">
          <div class="book-grid-title">${esc(book.title)}</div>
          <div class="book-grid-author">${esc(book.authors)}</div>
          ${book.pageCount
            ? `<div class="book-grid-meta">${book.pageCount} pages${book.currentPage && book.currentPage > 1 ? ` &middot; p.${book.currentPage}` : ''}</div>`
            : ''}
          <div class="book-grid-actions">
            <button class="btn btn-primary btn-read" data-id="${escapeAttr(book.googleBooksId)}">
              Read
            </button>
            ${showRemove
              ? `<button class="btn btn-ghost btn-remove" data-id="${escapeAttr(book.googleBooksId)}" style="flex:0;padding:5px 8px" title="Remove">
                   <svg class="icon" width="13" height="13"><use href="#icon-trash"/></svg>
                 </button>`
              : `<button class="btn btn-secondary btn-save" data-id="${escapeAttr(book.googleBooksId)}" style="flex:0;padding:5px 10px">
                   <svg class="icon" width="13" height="13"><use href="#icon-plus"/></svg>
                 </button>`
            }
          </div>
        </div>
      </div>
    `).join('')

    // CSP-safe: attach cover error handlers after innerHTML
    container.querySelectorAll('.book-grid-cover').forEach(img => {
      if (!img.getAttribute('src')) { img.style.display = 'none'; return }
      img.addEventListener('error', () => { img.style.display = 'none' }, { once: true })
    })
  }

  function renderLibrary() {
    const empty = document.getElementById('library-empty')
    const grid  = document.getElementById('library-grid')

    if (!state.library.length) {
      empty.classList.remove('hidden')
      grid.innerHTML = ''
      return
    }

    empty.classList.add('hidden')
    renderBookGrid(state.library, 'library-grid', { showRemove: true })
  }

  // ─── Skeleton loader ────────────────────────────────────────────────────────

  function showSearchSkeleton() {
    const el = document.getElementById('search-skeleton')
    el.innerHTML = Array.from({ length: 8 }, () => `
      <div class="skel-card">
        <div class="skel-img"></div>
        <div class="skel-body">
          <div class="skel-line"></div>
          <div class="skel-line short"></div>
          <div class="skel-line shorter"></div>
          <div class="skel-actions">
            <div class="skel-btn"></div>
            <div class="skel-btn" style="flex:0;width:32px"></div>
          </div>
        </div>
      </div>
    `).join('')
    el.classList.remove('hidden')
  }

  function hideSearchSkeleton() {
    const el = document.getElementById('search-skeleton')
    el.classList.add('hidden')
    el.innerHTML = ''
  }

  // ─── Library helpers ────────────────────────────────────────────────────────

  async function saveToLibrary(book, toast = true) {
    if (!book?.googleBooksId) return
    const next = await bd.librarySave(book)
    if (next) state = { ...state, library: next }
    if (toast) showToast('Saved to library', 'success')
  }

  // ─── Apple Books detection ──────────────────────────────────────────────────

  async function handleDetectAppleBooks() {
    const btn = document.getElementById('btn-detect-apple')
    btn.disabled = true

    try {
      const detected = await bd.detectAppleBooks()
      if (!detected?.title) {
        showToast('No recent book found in Apple Books', 'warning')
        return
      }

      showToast(`Searching for "${detected.title}"…`)
      const controller = new AbortController()
      const results    = await searchBooks(detected.title, controller.signal)

      const enriched = results.length > 0
        ? { ...results[0], currentPage: detected.currentPage || 1, pageCount: detected.pageCount || results[0].pageCount }
        : {
            googleBooksId: `apple-${Date.now()}`,
            title:         detected.title,
            authors:       detected.authors || 'Unknown Author',
            description:   '',
            pageCount:     detected.pageCount || null,
            currentPage:   detected.currentPage || 1,
            coverUrl:      null,
          }

      selectBook(enriched)
    } catch (err) {
      if (err.name !== 'AbortError') {
        showToast(`Detection failed: ${err.message}`, 'error')
      }
    } finally {
      btn.disabled = false
    }
  }

  // ─── Search ─────────────────────────────────────────────────────────────────

  async function doSearch() {
    const query = document.getElementById('search-input').value.trim()
    if (!query) return

    // Cancel any in-flight request
    if (currentSearchAbort) {
      currentSearchAbort.abort()
    }
    currentSearchAbort = new AbortController()

    const statusEl = document.getElementById('search-status')
    const btn      = document.getElementById('btn-search')

    btn.disabled = true
    document.getElementById('search-results').innerHTML = ''
    statusEl.classList.add('hidden')
    showSearchSkeleton()

    try {
      const books = await searchBooks(query, currentSearchAbort.signal)
      hideSearchSkeleton()

      if (books.length === 0) {
        statusEl.textContent = 'No results found.'
        statusEl.classList.remove('hidden')
      } else {
        state = { ...state, searchResults: books }
        renderBookGrid(books, 'search-results')
      }
    } catch (err) {
      hideSearchSkeleton()
      if (err.name !== 'AbortError') {
        statusEl.textContent = `Search failed — ${err.message}`
        statusEl.classList.remove('hidden')
      }
    } finally {
      btn.disabled = false
      currentSearchAbort = null
    }
  }

  // ─── Settings ───────────────────────────────────────────────────────────────

  async function loadSettings() {
    const s = await bd.settingsGet()
    state = { ...state, settings: s }

    document.getElementById('input-client-id').value      = s.discordClientId || ''
    document.getElementById('toggle-show-timer').checked  = s.showTimer !== false
    document.getElementById('toggle-show-pages').checked  = s.showPages !== false
    document.getElementById('toggle-auto-detect').checked = !!s.autoDetectBooks
    document.getElementById('input-daily-goal').value     = s.dailyGoalMinutes || ''

    if (bd.platform === 'darwin') {
      document.getElementById('field-auto-detect').style.display = 'block'
      document.getElementById('btn-detect-apple').style.display  = 'inline-flex'
    }
  }

  async function saveSettings() {
    const clientId       = document.getElementById('input-client-id').value.trim()
    const showTimer      = document.getElementById('toggle-show-timer').checked
    const showPages      = document.getElementById('toggle-show-pages').checked
    const autoDetect     = document.getElementById('toggle-auto-detect').checked
    const dailyGoalMins  = parseInt(document.getElementById('input-daily-goal').value, 10) || 0

    const next = await bd.settingsSave({ discordClientId: clientId, showTimer, showPages, autoDetectBooks: autoDetect, dailyGoalMinutes: dailyGoalMins })
    state = { ...state, settings: next }
    showToast('Settings saved', 'success')
    return clientId
  }

  // ─── Discord connection ─────────────────────────────────────────────────────

  async function connectDiscord() {
    const clientId = await saveSettings()
    if (!clientId) {
      showToast('Enter a Discord Application ID first', 'warning')
      return
    }

    const dot  = document.getElementById('status-dot')
    const text = document.getElementById('status-text')
    dot.className    = 'status-dot connecting'
    text.textContent = 'Connecting…'

    const result = await bd.rpcConnect(clientId)
    if (!result.success) {
      showToast(result.error || 'Connection failed', 'error')
    }
  }

  // ─── Stats ──────────────────────────────────────────────────────────────────

  function dayKey(ts) {
    return new Date(ts).toISOString().slice(0, 10)
  }

  function startOfDay(date) {
    const d = new Date(date)
    d.setHours(0, 0, 0, 0)
    return d.getTime()
  }

  function formatMins(ms) {
    const totalMins = Math.floor(ms / 60_000)
    const h = Math.floor(totalMins / 60)
    const m = totalMins % 60
    if (h === 0) return `${m}m`
    return `${h}h ${m}m`
  }

  function computeStreak(sessions) {
    if (!sessions.length) return 0
    const days = new Set(sessions.map(s => dayKey(s.startTime)))
    let streak = 0
    const today = dayKey(Date.now())
    const yesterday = dayKey(Date.now() - 86_400_000)
    // Streak must include today or yesterday to be "active"
    if (!days.has(today) && !days.has(yesterday)) return 0
    let cursor = days.has(today) ? new Date() : new Date(Date.now() - 86_400_000)
    while (true) {
      const key = dayKey(cursor.getTime())
      if (!days.has(key)) break
      streak++
      cursor = new Date(cursor.getTime() - 86_400_000)
    }
    return streak
  }

  function renderStats(sessions) {
    const now = Date.now()
    const todayStart  = startOfDay(now)
    const weekStart   = todayStart - 6 * 86_400_000
    const monthStart  = startOfDay(new Date(new Date().getFullYear(), new Date().getMonth(), 1))

    const todaySessions  = sessions.filter(s => s.startTime >= todayStart)
    const weekSessions   = sessions.filter(s => s.startTime >= weekStart)
    const monthSessions  = sessions.filter(s => s.startTime >= monthStart)

    const sumMs = arr => arr.reduce((a, s) => a + (s.durationMs || 0), 0)
    const sumPages = arr => arr.reduce((a, s) => {
      const pages = Math.max(0, (s.endPage || 1) - (s.startPage || 1))
      return a + pages
    }, 0)

    document.getElementById('stat-today').textContent = formatMins(sumMs(todaySessions))
    document.getElementById('stat-today-sessions').textContent =
      todaySessions.length ? `${todaySessions.length} session${todaySessions.length > 1 ? 's' : ''}` : ''

    document.getElementById('stat-week').textContent = formatMins(sumMs(weekSessions))
    document.getElementById('stat-week-sessions').textContent =
      weekSessions.length ? `${weekSessions.length} session${weekSessions.length > 1 ? 's' : ''}` : ''

    document.getElementById('stat-month').textContent = formatMins(sumMs(monthSessions))
    document.getElementById('stat-month-sessions').textContent =
      monthSessions.length ? `${monthSessions.length} session${monthSessions.length > 1 ? 's' : ''}` : ''

    document.getElementById('stat-streak').textContent = computeStreak(sessions)
    document.getElementById('stat-pages').textContent  = sumPages(monthSessions).toLocaleString()

    // Unique books all time
    const uniqueBooks = new Set(sessions.map(s => s.bookId || s.title))
    document.getElementById('stat-books').textContent = uniqueBooks.size.toLocaleString()

    renderBarChart(sessions, weekStart, todayStart)
    renderSessionList(sessions.slice(0, 20))
    renderGoalProgress(sumMs(todaySessions))
  }

  function renderGoalProgress(todayMs) {
    const goalMins = state.settings.dailyGoalMinutes || 0
    const wrap = document.getElementById('goal-progress-wrap')
    if (!goalMins) { wrap.style.display = 'none'; return }
    wrap.style.display = 'block'
    const goalMs  = goalMins * 60_000
    const pct     = Math.min(100, Math.round((todayMs / goalMs) * 100))
    const done    = todayMs >= goalMs
    document.getElementById('goal-fill').style.width = `${pct}%`
    document.getElementById('goal-fill').className   = `goal-fill${done ? ' goal-done' : ''}`
    document.getElementById('goal-text').textContent =
      done ? `Daily goal reached! ${formatMins(todayMs)} read today`
           : `${formatMins(todayMs)} of ${goalMins}m daily goal · ${pct}%`
  }

  function renderBarChart(sessions, weekStart, todayStart) {
    const DAY_MS = 86_400_000
    // Build day buckets for last 7 days
    const days = []
    for (let i = 6; i >= 0; i--) {
      const start = todayStart - i * DAY_MS
      const label = i === 0 ? 'Today' : new Date(start).toLocaleDateString(undefined, { weekday: 'short' })
      const ms = sessions
        .filter(s => s.startTime >= start && s.startTime < start + DAY_MS)
        .reduce((a, s) => a + (s.durationMs || 0), 0)
      days.push({ label, ms, isToday: i === 0 })
    }

    const maxMs = Math.max(...days.map(d => d.ms), 1)

    const chart = document.getElementById('bar-chart')
    chart.innerHTML = days.map(d => {
      const pct = Math.round((d.ms / maxMs) * 100)
      const tooltip = d.ms > 0 ? `title="${formatMins(d.ms)}"` : ''
      return `<div class="bar-col${d.isToday ? ' bar-today' : ''}" ${tooltip}>
        <div class="bar-fill" style="height:${Math.max(pct, d.ms > 0 ? 4 : 1)}%"></div>
        <div class="bar-label">${d.label}</div>
      </div>`
    }).join('')
  }

  function renderSessionList(sessions) {
    const el = document.getElementById('session-list')
    if (!sessions.length) {
      el.innerHTML = '<div class="empty-state-inline">No sessions recorded yet — start reading to track your progress.</div>'
      return
    }

    const DAY_MS = 86_400_000
    const todayKey     = dayKey(Date.now())
    const yesterdayKey = dayKey(Date.now() - DAY_MS)

    el.innerHTML = sessions.map(s => {
      const dk = dayKey(s.startTime)
      const dateLabel = dk === todayKey ? 'Today' : dk === yesterdayKey ? 'Yesterday'
        : new Date(s.startTime).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
      const timeLabel = new Date(s.startTime).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
      const pages = Math.max(0, (s.endPage || 1) - (s.startPage || 1))
      const pagePart = pages > 0 ? ` · ${pages} p` : ''
      const initials = (s.title || '?')[0].toUpperCase()
      return `<div class="session-item">
        <div class="session-thumb">
          <div class="session-cover-placeholder">${initials}</div>
          ${s.coverUrl ? `<img class="session-cover" src="${escapeAttr(s.coverUrl)}" alt="" loading="lazy">` : ''}
        </div>
        <div class="session-info">
          <div class="session-title">${esc(s.title || 'Unknown')}</div>
          <div class="session-meta">${dateLabel} at ${timeLabel}${pagePart}</div>
        </div>
        <div class="session-duration">${formatMins(s.durationMs || 0)}</div>
      </div>`
    }).join('')

    // CSP-safe: attach cover error handlers after innerHTML
    el.querySelectorAll('.session-cover').forEach(img => {
      img.addEventListener('error', () => { img.style.display = 'none' }, { once: true })
    })
  }

  // ─── Export ─────────────────────────────────────────────────────────────────

  async function exportSessions() {
    const sessions = await bd.sessionsGet()
    if (!sessions.length) {
      showToast('No sessions to export', 'warning')
      return
    }

    const header = 'Date,Start Time,Title,Author,Duration (min),Start Page,End Page,Pages Read'
    const rows = sessions.map(s => {
      const d = new Date(s.startTime)
      const date = d.toLocaleDateString()
      const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
      const mins = (s.durationMs / 60_000).toFixed(1)
      const pages = Math.max(0, (s.endPage || 1) - (s.startPage || 1))
      const csv = v => `"${String(v || '').replace(/"/g, '""')}"`
      return [csv(date), csv(time), csv(s.title), csv(s.authors), mins,
              s.startPage || 1, s.endPage || 1, pages].join(',')
    })

    const content = [header, ...rows].join('\n')
    const saved = await bd.saveFile({ content, filename: 'pageline-sessions.csv' })
    if (saved) showToast('Sessions exported', 'success')
  }

  // ─── Custom Book Modal ──────────────────────────────────────────────────────

  let modalCoverData = null  // base64 data URL picked from disk or URL

  function openCustomBookModal() {
    modalCoverData = null
    const modal = document.getElementById('modal-custom-book')

    // Reset form
    document.getElementById('modal-cover-img').src = ''
    document.getElementById('modal-cover-img').classList.add('hidden')
    document.getElementById('cover-picker-prompt').style.display = ''
    document.getElementById('modal-cover-url').value    = ''
    document.getElementById('btn-clear-cover').style.display = 'none'
    document.getElementById('modal-title-input').value   = ''
    document.getElementById('modal-author-input').value  = ''
    document.getElementById('modal-pages-input').value   = ''
    document.getElementById('modal-current-input').value = ''
    document.getElementById('modal-desc-input').value    = ''
    document.getElementById('modal-title-input').classList.remove('invalid')

    modal.classList.remove('hidden')
    document.getElementById('modal-title-input').focus()
  }

  function closeCustomBookModal() {
    document.getElementById('modal-custom-book').classList.add('hidden')
    modalCoverData = null
  }

  function setCoverPreview(src) {
    const img      = document.getElementById('modal-cover-img')
    const prompt   = document.getElementById('cover-picker-prompt')
    const clearBtn = document.getElementById('btn-clear-cover')
    img.src = src
    img.classList.remove('hidden')
    prompt.style.display = 'none'
    clearBtn.style.display = ''
  }

  function clearCoverPreview() {
    const img      = document.getElementById('modal-cover-img')
    const prompt   = document.getElementById('cover-picker-prompt')
    const clearBtn = document.getElementById('btn-clear-cover')
    img.src = ''
    img.classList.add('hidden')
    prompt.style.display = ''
    clearBtn.style.display = 'none'
    modalCoverData = null
    document.getElementById('modal-cover-url').value = ''
  }

  async function handlePickCover() {
    try {
      const dataUrl = await bd.pickImage()
      if (!dataUrl) return
      modalCoverData = dataUrl
      document.getElementById('modal-cover-url').value = ''
      setCoverPreview(dataUrl)
    } catch (err) {
      showToast('Could not load image: ' + err.message, 'error')
    }
  }

  function handleCoverUrlInput() {
    const url = document.getElementById('modal-cover-url').value.trim()
    if (!url) {
      if (!modalCoverData) clearCoverPreview()
      return
    }
    // Show URL as preview; don't override locally picked file data
    modalCoverData = null
    setCoverPreview(url)
  }

  async function saveCustomBook() {
    const titleEl = document.getElementById('modal-title-input')
    const title   = titleEl.value.trim()

    if (!title) {
      titleEl.classList.add('invalid')
      titleEl.focus()
      showToast('Title is required', 'warning')
      return
    }
    titleEl.classList.remove('invalid')

    const urlField   = document.getElementById('modal-cover-url').value.trim()
    const coverUrl   = modalCoverData || (urlField || null)

    const pageCount  = parseInt(document.getElementById('modal-pages-input').value, 10) || null
    const currentPage = Math.max(1, parseInt(document.getElementById('modal-current-input').value, 10) || 1)

    const book = {
      googleBooksId: `custom-${Date.now()}`,
      title,
      authors:     document.getElementById('modal-author-input').value.trim() || 'Unknown Author',
      description: document.getElementById('modal-desc-input').value.trim()   || '',
      pageCount,
      currentPage,
      coverUrl,
      source: 'custom',
    }

    const next = await bd.librarySave(book)
    if (next) state = { ...state, library: next }
    closeCustomBookModal()
    switchTab('library')
    showToast(`"${title}" added to library`, 'success')
  }

  // ─── Event listeners ────────────────────────────────────────────────────────

  function setupEvents() {
    // Tab nav
    document.querySelectorAll('.nav-btn').forEach(btn =>
      btn.addEventListener('click', () => switchTab(btn.dataset.tab)))

    document.querySelectorAll('[data-tab-link]').forEach(btn =>
      btn.addEventListener('click', () => switchTab(btn.dataset.tabLink)))

    // Reading controls
    document.getElementById('btn-detect-apple').addEventListener('click', handleDetectAppleBooks)
    document.getElementById('btn-start-reading').addEventListener('click', startReading)
    document.getElementById('btn-stop-reading').addEventListener('click', stopReading)
    document.getElementById('btn-update-page').addEventListener('click', updatePage)
    document.getElementById('btn-add-to-library').addEventListener('click', () => {
      if (state.selectedBook) saveToLibrary(state.selectedBook)
    })
    document.getElementById('btn-change-book').addEventListener('click', () => switchTab('search'))

    // Page steppers
    document.getElementById('page-down').addEventListener('click', () => {
      const el = document.getElementById('page-current')
      el.value = Math.max(1, (parseInt(el.value, 10) || 1) - 1)
      updateProgress()
    })
    document.getElementById('page-up').addEventListener('click', () => {
      const el    = document.getElementById('page-current')
      const total = parseInt(document.getElementById('page-total').value, 10) || Infinity
      el.value = Math.min(total, (parseInt(el.value, 10) || 1) + 1)
      updateProgress()
    })

    document.getElementById('page-current').addEventListener('input',  updateProgress)
    document.getElementById('page-total').addEventListener('input',    updateProgress)
    document.getElementById('page-current').addEventListener('keydown', e => {
      if (e.key === 'Enter') updatePage()
    })

    // Search — single handler prevents double-fire
    const searchBtn   = document.getElementById('btn-search')
    const searchInput = document.getElementById('search-input')

    searchBtn.addEventListener('click', doSearch)
    searchInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault()   // prevent any potential form submit
        doSearch()
      }
    })

    // Search results (event delegation)
    document.getElementById('search-results').addEventListener('click', async e => {
      const btn = e.target.closest('button')
      if (!btn) return
      const id   = btn.dataset.id
      const book = state.searchResults.find(b => b.googleBooksId === id)
      if (!book) return

      if (btn.classList.contains('btn-read')) {
        selectBook(book)
      } else if (btn.classList.contains('btn-save')) {
        await saveToLibrary(book)
      }
    })

    // Library grid (event delegation)
    document.getElementById('library-grid').addEventListener('click', async e => {
      const btn = e.target.closest('button')
      if (!btn) return
      const id   = btn.dataset.id
      const book = state.library.find(b => b.googleBooksId === id)

      if (btn.classList.contains('btn-read') && book) {
        selectBook(book)
      } else if (btn.classList.contains('btn-remove')) {
        const next = await bd.libraryRemove(id)
        if (next) state = { ...state, library: next }
        renderLibrary()
      }
    })

    // Custom book modal
    document.getElementById('btn-add-custom').addEventListener('click', openCustomBookModal)
    document.getElementById('modal-close').addEventListener('click', closeCustomBookModal)
    document.getElementById('modal-cancel').addEventListener('click', closeCustomBookModal)
    document.getElementById('modal-save').addEventListener('click', saveCustomBook)
    document.getElementById('modal-custom-book').addEventListener('click', e => {
      if (e.target === e.currentTarget) closeCustomBookModal()
    })
    document.getElementById('cover-picker-zone').addEventListener('click', handlePickCover)
    document.getElementById('modal-cover-url').addEventListener('input', handleCoverUrlInput)
    document.getElementById('btn-clear-cover').addEventListener('click', clearCoverPreview)
    document.getElementById('modal-title-input').addEventListener('input', () =>
      document.getElementById('modal-title-input').classList.remove('invalid'))

    // Escape key closes modal
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && !document.getElementById('modal-custom-book').classList.contains('hidden')) {
        closeCustomBookModal()
      }
    })

    // Stats export
    document.getElementById('btn-export-sessions').addEventListener('click', exportSessions)

    // Settings
    document.getElementById('btn-save-settings').addEventListener('click', saveSettings)
    document.getElementById('btn-connect-discord').addEventListener('click', connectDiscord)
    document.getElementById('btn-disconnect-discord').addEventListener('click', async () => {
      await bd.rpcDisconnect()
      showToast('Disconnected from Discord')
    })

    document.getElementById('link-dev-portal').addEventListener('click',   e => { e.preventDefault(); bd.openExternal('https://discord.com/developers/applications') })
    document.getElementById('link-dev-portal-2').addEventListener('click', e => { e.preventDefault(); bd.openExternal('https://discord.com/developers/applications') })
    document.getElementById('link-dev-portal-3').addEventListener('click', e => { e.preventDefault(); bd.openExternal('https://discord.com/developers/applications') })

    // Push events from main
    bd.onRpcStatusChanged(({ connected, error }) => {
      const dot  = document.getElementById('status-dot')
      const text = document.getElementById('status-text')
      state = { ...state, rpcConnected: connected }

      if (connected) {
        dot.className    = 'status-dot connected'
        text.textContent = 'Connected'
      } else if (error) {
        dot.className    = 'status-dot error'
        text.textContent = 'Error'
        showToast(error, 'error')
      } else {
        dot.className    = 'status-dot'
        text.textContent = 'Disconnected'
      }
    })

    bd.onLibraryChanged(library => {
      state = { ...state, library }
      if (state.currentTab === 'library') renderLibrary()
    })
  }

  // ─── Init ───────────────────────────────────────────────────────────────────

  async function init() {
    setupEvents()

    const [library, rpcStatus] = await Promise.all([
      bd.libraryGet(),
      bd.rpcStatus(),
    ])
    state = { ...state, library }

    await loadSettings()

    // Restore live session if app was restarted mid-session
    if (rpcStatus.connected && rpcStatus.book) {
      state = { ...state, selectedBook: rpcStatus.book, isReading: true, sessionStart: rpcStatus.book.startTime }
      renderReadingCard()
      startTimer()
    }

    // Update status indicator
    if (rpcStatus.connected) {
      document.getElementById('status-dot').className = 'status-dot connected'
      document.getElementById('status-text').textContent = 'Connected'
      state = { ...state, rpcConnected: true }
    }

    // Auto-connect if client ID is saved and not already connected
    if (state.settings.discordClientId && !rpcStatus.connected) {
      document.getElementById('status-dot').className    = 'status-dot connecting'
      document.getElementById('status-text').textContent = 'Connecting…'
      bd.rpcConnect(state.settings.discordClientId)
    }

    // Auto-detect Apple Books if enabled
    if (state.settings.autoDetectBooks && bd.platform === 'darwin' && !state.selectedBook) {
      handleDetectAppleBooks()
    }
  }

  document.addEventListener('DOMContentLoaded', init)
})()
