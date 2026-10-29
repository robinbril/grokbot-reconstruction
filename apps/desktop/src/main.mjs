import { app, BrowserWindow, Menu, dialog } from 'electron';
import { startDesktop } from './desktop.mjs';

startDesktop({ app, BrowserWindow }, process.env.GROK_DESKTOP_ORIGIN).then(window => {
  if (!window) return;
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Grok Local', submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'quit' }] },
    { role: 'editMenu' },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' }] },
    { role: 'windowMenu' },
  ]));
}).catch(() => {
  dialog.showErrorBox('Grok Local could not open', 'The verified local backend could not be loaded. Restart with npm run desktop from the project.');
  app.exit(1);
});
