'use strict'
;(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory()
  } else {
    root.UtilsLib = factory()
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  /** Safely escape a string for insertion into HTML text content */
  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  }

  /** Safely escape a string for use inside an HTML attribute value */
  function escapeAttr(str) {
    return String(str == null ? '' : str)
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  }

  /**
   * Format milliseconds as H:MM:SS
   * @param {number} ms
   * @returns {string}
   */
  function formatDuration(ms) {
    if (typeof ms !== 'number' || isNaN(ms) || ms < 0) return '0:00:00'
    const secs = Math.floor(ms / 1000)
    const h = Math.floor(secs / 3600)
    const m = Math.floor((secs % 3600) / 60)
    const s = secs % 60
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }

  return { escapeHtml, escapeAttr, formatDuration }
}))
