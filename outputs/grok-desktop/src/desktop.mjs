import path from 'node:path';
import { installWindowPolicy, windowOptions } from './security.mjs';

export async function startDesktop({ app, BrowserWindow }, origin, platform = process.platform) {
  if (typeof origin !== 'string' || !/^http:\/\/127\.0\.0\.1(?::[1-9]\d{0,4})?$/.test(origin)
    || Number(new URL(origin).port) > 65535) throw Error('A verified local backend origin is required');
  app.setName('Grok Local');
  app.setPath('userData', path.join(app.getPath('appData'), 'GrokLocalDesktop'));
  app.enableSandbox();
  if (!app.requestSingleInstanceLock()) { app.quit(); return; }
  let window;
  function restoreWindow() {
    if (!window || window.isDestroyed()) {
      createWindow().catch(() => app.quit());
      return;
    }
    if (window.isMinimized()) window.restore();
    window.focus();
  }
  app.on('second-instance', restoreWindow);
  app.on('window-all-closed', () => { if (platform !== 'darwin') app.quit(); });
  async function createWindow() {
    const next = new BrowserWindow(windowOptions(platform));
    window = next;
    installWindowPolicy(next, origin);
    next.once('ready-to-show', () => next.show());
    next.once('closed', () => { if (window === next) window = undefined; });
    await next.loadURL(`${origin}/?desktop=1`);
    return next;
  }
  app.on('activate', restoreWindow);
  await app.whenReady();
  return createWindow();
}
