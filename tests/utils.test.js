'use strict'

const { escapeHtml, escapeAttr, formatDuration } = require('../lib/utils.js')

// ─── escapeHtml ───────────────────────────────────────────────────────────────

describe('escapeHtml', () => {
  test('escapes & < > " \'', () => {
    expect(escapeHtml('&')).toBe('&amp;')
    expect(escapeHtml('<')).toBe('&lt;')
    expect(escapeHtml('>')).toBe('&gt;')
    expect(escapeHtml('"')).toBe('&quot;')
    expect(escapeHtml("'")).toBe('&#39;')
  })

  test('escapes a full XSS payload', () => {
    const input = '<script>alert("xss")</script>'
    const out   = escapeHtml(input)
    expect(out).not.toContain('<script>')
    expect(out).toContain('&lt;script&gt;')
    expect(out).toContain('&quot;')
  })

  test('passes through plain text unchanged', () => {
    expect(escapeHtml('Hello, World!')).toBe('Hello, World!')
  })

  test('handles null → empty string', () => {
    expect(escapeHtml(null)).toBe('')
  })

  test('handles undefined → empty string', () => {
    expect(escapeHtml(undefined)).toBe('')
  })

  test('handles numbers', () => {
    expect(escapeHtml(42)).toBe('42')
  })

  test('handles empty string', () => {
    expect(escapeHtml('')).toBe('')
  })
})

// ─── escapeAttr ───────────────────────────────────────────────────────────────

describe('escapeAttr', () => {
  test('escapes double quotes', () => {
    expect(escapeAttr('he said "hi"')).toBe('he said &quot;hi&quot;')
  })

  test('escapes single quotes', () => {
    expect(escapeAttr("it's fine")).toBe('it&#39;s fine')
  })

  test('handles null / undefined', () => {
    expect(escapeAttr(null)).toBe('')
    expect(escapeAttr(undefined)).toBe('')
  })
})

// ─── formatDuration ──────────────────────────────────────────────────────────

describe('formatDuration', () => {
  test('formats zero', () => {
    expect(formatDuration(0)).toBe('0:00:00')
  })

  test('formats less than a minute', () => {
    expect(formatDuration(45_000)).toBe('0:00:45')
  })

  test('formats exactly one minute', () => {
    expect(formatDuration(60_000)).toBe('0:01:00')
  })

  test('formats 90 seconds', () => {
    expect(formatDuration(90_000)).toBe('0:01:30')
  })

  test('formats exactly one hour', () => {
    expect(formatDuration(3_600_000)).toBe('1:00:00')
  })

  test('formats 1h 23m 45s', () => {
    expect(formatDuration((3600 + 23 * 60 + 45) * 1000)).toBe('1:23:45')
  })

  test('formats 10h 05m 09s (pads minutes and seconds)', () => {
    expect(formatDuration((10 * 3600 + 5 * 60 + 9) * 1000)).toBe('10:05:09')
  })

  test('truncates milliseconds (does not round up)', () => {
    expect(formatDuration(59_999)).toBe('0:00:59')
  })

  test('handles negative values as 0:00:00', () => {
    expect(formatDuration(-1000)).toBe('0:00:00')
  })

  test('handles non-number input as 0:00:00', () => {
    expect(formatDuration(NaN)).toBe('0:00:00')
    expect(formatDuration('abc')).toBe('0:00:00')
  })
})
