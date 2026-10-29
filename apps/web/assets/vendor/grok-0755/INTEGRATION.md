# Scoped original avatar integration

These three assets are byte-exact copies of the already verified 0.75.5 extraction. `manifest.json` records file sizes, source paths and SHA-256. The common module's only direct dependency is the colocated rolldown runtime. The ordinary replica does not import them. `source-chat-avatars.js` dynamically imports the common module only for the explicit synthetic `#reference-chat` layout.

The adapter calls the original `w` controller with `T` shape aliases and `E` appearance. Original exported constant `j` is `.92`, matching the BotMark fill constant; resolution192 matches its sourceId path. The original React wrapper `uP(fill)` sets canvas width and height to `${Ea(fill)*100}%`; the adapter applies the same `M(j)*100`, giving153.33333333333334% for fill.92 and native base zoom.6. Keeping this canvas at100% shrinks the visible body and is not faithful to that wrapper. The source controller hashes strings in `tg(seed ?? id)`; the adapter preserves a string configuration seed and assigns a separate monotonically unique SVG instance ID to prevent document ID collisions.

New DOM hosts omit `.motion-avatar`, so the independent old observer releases the removed legacy nodes rather than controlling native SVGs. The adapter detaches controllers when their hosts are removed, when the reference layout clears, and on pagehide. Sleep uses32px, zero gaze, sleepy expression, paused pointer/play state and450ms reset. Native semantic colors are selected from the original light-theme token export. This is a synthetic fixture configuration, not recovery of the screenshot account's stored shape/seed/settings.

Only matched add/mic/close/waveform/share semantic slots use the original iconfont. Their old `data-icon-semantic` marker is removed so the independent deferred icon refresh cannot replace them. Other icons remain outside this narrow adaptation.

Own Computer Use check after reload:24 original hosts,24 SVGs,5 original glyphs, unique SVG definition IDs, no NaN/Infinity and no load error. This proves the scoped original renderer runs; it does not establish all original app wrapper props, screenshot identity, pixel parity or timing parity.

`node --check source-chat-avatars.js` and `node --check screenshot-chat-layout.js`: exit0. Vendor digest check:3PASS. Parent owns final e2e and independent review.
