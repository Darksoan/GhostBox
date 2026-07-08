window.__errors = [];
window.addEventListener('error', (e) => {
  window.__errors.push({
    message: e.message,
    filename: e.filename,
    line: e.lineno,
    col: e.colno,
    stack: e.error && e.error.stack,
  });
});
window.addEventListener('unhandledrejection', (e) => {
  window.__errors.push({
    message: 'Unhandled rejection: ' + (e.reason && (e.reason.stack || e.reason.message || String(e.reason))),
  });
});