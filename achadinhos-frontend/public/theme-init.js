/* Apply the saved display preference before the first app paint. No media settings are read or written. */
(function () {
  var preference = 'system';
  try {
    var saved = localStorage.getItem('espia-theme');
    if (saved === 'light' || saved === 'dark') preference = saved;
  } catch (_) { /* The system preference also works when storage is blocked. */ }
  var dark = false;
  try { dark = window.matchMedia('(prefers-color-scheme: dark)').matches; } catch (_) { /* Light fallback. */ }
  var theme = preference === 'system' ? (dark ? 'dark' : 'light') : preference;
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'dark' ? '#121926' : '#edf2fa');
})();
