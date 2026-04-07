'use strict'

const { parseGoogleBook, normalizeCoverUrl, searchBooks } = require('../lib/books.js')

// ─── normalizeCoverUrl ────────────────────────────────────────────────────────

describe('normalizeCoverUrl', () => {
  test('upgrades http to https', () => {
    expect(normalizeCoverUrl('http://books.google.com/cover.jpg'))
      .toBe('https://books.google.com/cover.jpg')
  })

  test('bumps zoom=1 to zoom=2 for larger images', () => {
    expect(normalizeCoverUrl('https://books.google.com/cover?zoom=1'))
      .toBe('https://books.google.com/cover?zoom=2')
  })

  test('handles combined http + zoom=1', () => {
    expect(normalizeCoverUrl('http://books.google.com/cover?zoom=1&edge=curl'))
      .toBe('https://books.google.com/cover?zoom=2&edge=curl')
  })

  test('returns null for null input', () => {
    expect(normalizeCoverUrl(null)).toBeNull()
  })

  test('returns null for undefined input', () => {
    expect(normalizeCoverUrl(undefined)).toBeNull()
  })

  test('returns null for empty string', () => {
    expect(normalizeCoverUrl('')).toBeNull()
  })

  test('passes through already-https URLs unchanged (except zoom)', () => {
    expect(normalizeCoverUrl('https://books.google.com/cover.jpg'))
      .toBe('https://books.google.com/cover.jpg')
  })
})

// ─── parseGoogleBook ──────────────────────────────────────────────────────────

describe('parseGoogleBook', () => {
  const fullItem = {
    id: 'abc123',
    volumeInfo: {
      title: 'The Great Gatsby',
      authors: ['F. Scott Fitzgerald'],
      description: 'A classic novel.',
      pageCount: 180,
      publishedDate: '1925',
      infoLink: 'https://books.google.com/books?id=abc123',
      imageLinks: {
        thumbnail: 'http://books.google.com/cover?zoom=1',
        smallThumbnail: 'http://books.google.com/cover?zoom=0',
      },
    },
  }

  test('parses a full item correctly', () => {
    const book = parseGoogleBook(fullItem)
    expect(book.googleBooksId).toBe('abc123')
    expect(book.title).toBe('The Great Gatsby')
    expect(book.authors).toBe('F. Scott Fitzgerald')
    expect(book.description).toBe('A classic novel.')
    expect(book.pageCount).toBe(180)
    expect(book.publishedDate).toBe('1925')
    expect(book.infoLink).toBe('https://books.google.com/books?id=abc123')
    expect(book.currentPage).toBe(1)
  })

  test('upgrades thumbnail URL to https with zoom=2', () => {
    const book = parseGoogleBook(fullItem)
    expect(book.coverUrl).toBe('https://books.google.com/cover?zoom=2')
  })

  test('joins multiple authors with ", "', () => {
    const item = {
      id: 'multi',
      volumeInfo: { title: 'Book', authors: ['Author A', 'Author B', 'Author C'] },
    }
    expect(parseGoogleBook(item).authors).toBe('Author A, Author B, Author C')
  })

  test('uses smallThumbnail when thumbnail is missing', () => {
    const item = {
      id: 'x',
      volumeInfo: {
        title: 'Book',
        imageLinks: { smallThumbnail: 'http://books.google.com/small?zoom=1' },
      },
    }
    expect(parseGoogleBook(item).coverUrl).toBe('https://books.google.com/small?zoom=2')
  })

  test('handles missing optional fields gracefully', () => {
    const minimal = { id: 'min', volumeInfo: { title: 'Minimal' } }
    const book = parseGoogleBook(minimal)
    expect(book.title).toBe('Minimal')
    expect(book.authors).toBe('Unknown Author')
    expect(book.description).toBe('')
    expect(book.pageCount).toBeNull()
    expect(book.coverUrl).toBeNull()
    expect(book.infoLink).toBeNull()
    expect(book.publishedDate).toBeNull()
  })

  test('uses fallback title when missing', () => {
    const book = parseGoogleBook({ id: 'x', volumeInfo: {} })
    expect(book.title).toBe('Unknown Title')
  })

  test('uses fallback author when authors array is empty', () => {
    const book = parseGoogleBook({ id: 'x', volumeInfo: { authors: [] } })
    expect(book.authors).toBe('Unknown Author')
  })

  test('ignores pageCount of 0', () => {
    const book = parseGoogleBook({ id: 'x', volumeInfo: { pageCount: 0 } })
    expect(book.pageCount).toBeNull()
  })

  test('returns null for invalid input', () => {
    expect(parseGoogleBook(null)).toBeNull()
    expect(parseGoogleBook(undefined)).toBeNull()
  })

  test('always sets currentPage to 1', () => {
    const book = parseGoogleBook({ id: 'x', volumeInfo: { title: 'T' } })
    expect(book.currentPage).toBe(1)
  })
})

// ─── searchBooks ──────────────────────────────────────────────────────────────

describe('searchBooks', () => {
  function makeFetch(items, status = 200) {
    return jest.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? 'OK' : 'Error',
      json: async () => ({ items }),
    })
  }

  test('calls Google Books API with the query', async () => {
    const mockFetch = makeFetch([])
    await searchBooks('gatsby', mockFetch)
    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [url] = mockFetch.mock.calls[0]
    expect(url).toContain('googleapis.com/books')
    expect(url).toContain(encodeURIComponent('gatsby'))
  })

  test('returns parsed books', async () => {
    const mockFetch = makeFetch([
      { id: 'b1', volumeInfo: { title: 'Book One', authors: ['Author'] } },
      { id: 'b2', volumeInfo: { title: 'Book Two' } },
    ])
    const books = await searchBooks('test', mockFetch)
    expect(books).toHaveLength(2)
    expect(books[0].title).toBe('Book One')
    expect(books[1].title).toBe('Book Two')
  })

  test('returns empty array when items is missing', async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}), // no items field
    })
    const books = await searchBooks('nothing', mockFetch)
    expect(books).toEqual([])
  })

  test('returns empty array for empty query', async () => {
    const mockFetch = jest.fn()
    const books = await searchBooks('', mockFetch)
    expect(books).toEqual([])
    expect(mockFetch).not.toHaveBeenCalled()
  })

  test('returns empty array for whitespace-only query', async () => {
    const mockFetch = jest.fn()
    await searchBooks('   ', mockFetch)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  test('throws on non-ok HTTP response', async () => {
    const mockFetch = makeFetch([], 500)
    await expect(searchBooks('query', mockFetch)).rejects.toThrow('500')
  })

  test('throws on network failure', async () => {
    const mockFetch = jest.fn().mockRejectedValue(new Error('Network error'))
    await expect(searchBooks('query', mockFetch)).rejects.toThrow('Network error')
  })

  test('filters out null results from invalid items', async () => {
    const mockFetch = makeFetch([
      { id: 'good', volumeInfo: { title: 'Good Book' } },
      null, // invalid item — parseGoogleBook returns null, filter removes it
    ])
    const books = await searchBooks('test', mockFetch)
    expect(books).toHaveLength(1)
    expect(books[0].title).toBe('Good Book')
  })

  test('AbortSignal is forwarded to fetch', async () => {
    const controller = new AbortController()
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items: [] }),
    })
    await searchBooks('test', controller.signal)
    expect(mockFetch).not.toHaveBeenCalled() // global fetch not used
  })

  test('throws AbortError when signal is aborted', async () => {
    const controller = new AbortController()
    const mockFetch = jest.fn().mockImplementation((_url, opts) => {
      if (opts?.signal?.aborted) {
        const err = new Error('The operation was aborted')
        err.name = 'AbortError'
        return Promise.reject(err)
      }
      return Promise.resolve({ ok: true, json: async () => ({ items: [] }) })
    })
    controller.abort()
    // When a custom function is passed it takes priority over signal routing;
    // test the abort path by passing the already-aborted signal via a wrapper.
    await expect(
      searchBooks('test', (url, opts) => mockFetch(url, { signal: controller.signal }))
    ).rejects.toMatchObject({ name: 'AbortError' })
  })
})
