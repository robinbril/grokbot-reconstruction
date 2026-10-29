// Local desktop chrome adapter, not a recovered original titlebar implementation.
// Cosmetic only: the query flag grants no native APIs or privileged capabilities.
if (new URLSearchParams(location.search).get('desktop') === '1') {
  document.documentElement.dataset.desktopShell = '';
}
