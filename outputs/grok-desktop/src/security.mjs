const operatingSystemKeys = ['HOME', 'USER', 'LOGNAME', 'PATH', 'TMPDIR', 'LANG', 'LC_ALL',
  'DISPLAY', 'WAYLAND_DISPLAY', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS', 'SYSTEMROOT', 'WINDIR'];

export function desktopOrigin(env) {
  const port = Number(env.PORT ?? 8765);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw Error('Invalid local backend PORT');
  const origin = new URL(`http://127.0.0.1:${port}`).origin;
  if (env.GROK_BIND_HOST && env.GROK_BIND_HOST !== '127.0.0.1') {
    throw Error('Desktop requires GROK_BIND_HOST=127.0.0.1');
  }
  if (env.GROK_PUBLIC_ORIGIN && env.GROK_PUBLIC_ORIGIN !== origin) {
    throw Error('Desktop requires the configured local loopback origin');
  }
  return origin;
}

export function electronEnvironment(env, origin) {
  return { ...Object.fromEntries(operatingSystemKeys.filter(key => typeof env[key] === 'string')
    .map(key => [key, env[key]])), GROK_DESKTOP_ORIGIN: origin };
}

export function allowedRequest(value, origin) {
  try {
    const url = new URL(value);
    if (url.username || url.password) return false;
    if (url.protocol === 'data:') return /^data:image\/(?:png|jpeg|gif|webp|svg\+xml);/i.test(value);
    return url.origin === origin && ['http:', 'blob:'].includes(url.protocol);
  } catch { return false; }
}

export function windowOptions(platform = process.platform) {
  return {
    width: 1380, height: 900, minWidth: 760, minHeight: 560,
    title: 'Grok Local', backgroundColor: '#101010', show: false,
    ...(platform === 'darwin' ? { titleBarStyle: 'hiddenInset' } : {}),
    webPreferences: {
      contextIsolation: true, sandbox: true, nodeIntegration: false,
      nodeIntegrationInWorker: false, nodeIntegrationInSubFrames: false,
      webSecurity: true, allowRunningInsecureContent: false, webviewTag: false,
      devTools: false, partition: 'persist:grok-local-desktop',
    },
  };
}

export function installWindowPolicy(window, origin) {
  const contents = window.webContents, session = contents.session;
  const preventForeignNavigation = (event, value) => {
    try { if (new URL(value).origin === origin) return; } catch {}
    event.preventDefault();
  };
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', preventForeignNavigation);
  contents.on('will-redirect', preventForeignNavigation);
  contents.on('will-attach-webview', event => event.preventDefault());
  session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.setPermissionCheckHandler(() => false);
  session.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !allowedRequest(details.url, origin) });
  });
  session.on('will-download', (event, item) => {
    const chain = item.getURLChain();
    const allowed = chain.length > 0 && chain.every(value => {
      try {
        const url = new URL(value);
        return allowedRequest(value, origin) && (url.protocol === 'blob:' ||
          /^\/api\/harness\/conversations\/[^/]+\/attachments\/[^/]+\/(download|content)$/.test(url.pathname));
      } catch { return false; }
    });
    if (!allowed) event.preventDefault();
  });
}
