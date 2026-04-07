'use strict'
/* UMD shim: works as a browser <script> tag (exposes global BooksLib)
   and as a Node.js require() for Jest tests */
;(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory()
  } else {
    root.BooksLib = factory()
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  const GOOGLE_BOOKS_API = 'https://www.googleapis.com/books/v1/volumes'

  /** Upgrade http thumbnail URLs to https and request a slightly larger image */
  function normalizeCoverUrl(url) {
    if (!url) return null
    return url.replace('http://', 'https://').replace('zoom=1', 'zoom=2')
  }

  /** Parse a single Google Books API item into our book shape */
  function parseGoogleBook(item) {
    if (!item || typeof item !== 'object') return null
    const v = item.volumeInfo || {}
    const images = v.imageLinks || {}
    return {
      googleBooksId: item.id || null,
      title: v.title || 'Unknown Title',
      authors: (Array.isArray(v.authors) && v.authors.length > 0)
        ? v.authors.join(', ')
        : 'Unknown Author',
      description: v.description || '',
      pageCount: (typeof v.pageCount === 'number' && v.pageCount > 0) ? v.pageCount : null,
      coverUrl: normalizeCoverUrl(images.thumbnail || images.smallThumbnail || null),
      infoLink: v.infoLink || null,
      publishedDate: v.publishedDate || null,
      currentPage: 1,
    }
  }

  /**
   * Search the Google Books API.
   *
   * The second argument is intentionally flexible for testability and
   * cancellation support:
   *   searchBooks('gatsby')                  – uses global fetch
   *   searchBooks('gatsby', mockFetchFn)     – uses custom fetch (tests)
   *   searchBooks('gatsby', abortSignal)     – passes signal to fetch
   *
   * @param {string}                     query
   * @param {Function|AbortSignal} [arg] custom fetch function OR AbortSignal
   * @returns {Promise<Array>}
   */
  async function searchBooks(query, arg) {
    if (!query || !query.trim()) return []

    let fn = typeof fetch !== 'undefined' ? fetch : null
    let fetchOptions = {}

    if (typeof arg === 'function') {
      // Injected fetch for testing
      fn = arg
    } else if (
      arg !== null && arg !== undefined &&
      typeof AbortSignal !== 'undefined' && arg instanceof AbortSignal
    ) {
      fetchOptions.signal = arg
    }

    if (!fn) throw new Error('No fetch implementation available')

    const url = `${GOOGLE_BOOKS_API}?q=${encodeURIComponent(query.trim())}&maxResults=20&printType=books`
    const res = await fn(url, fetchOptions)
    if (!res.ok) throw new Error(`Google Books API error: ${res.status} ${res.statusText}`)
    const data = await res.json()
    return (data.items || []).map(parseGoogleBook).filter(Boolean)
  }

  return { parseGoogleBook, normalizeCoverUrl, searchBooks }
}))
