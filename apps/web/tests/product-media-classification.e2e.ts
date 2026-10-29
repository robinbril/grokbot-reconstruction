import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { readFile, readdir } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';

const vector = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="red"/></svg>';
const sha256 = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');

// e2e0.18 returns a download path relative to this attempt, not process.cwd().
// The frozen config uses default .e2e output and one worker. Resolve the newly
// created physical artifact, excluding every pre-existing attempt/download.
const artifactRoot = resolve('.e2e/artifacts');
async function downloadedBytes(download: {path: string}, before: string[]) {
 const old = new Set(before);
 const fresh = (await readdir(artifactRoot, {recursive: true})).filter(p => !old.has(p) && p.split(sep).join('/').endsWith('/' + download.path));
 expect(fresh.length).toBe(1);
 return readFile(resolve(artifactRoot, fresh[0]));
}

async function observeActualDownloads(browser: any) {
 await browser.evaluate(() => {
  const w = window as any; w.__classificationBlobs = new Map(); w.__classificationDownloads = [];
  w.__classificationCreate = URL.createObjectURL; w.__classificationClick = HTMLAnchorElement.prototype.click;
  URL.createObjectURL = function(blob: Blob) { const url = w.__classificationCreate.call(URL, blob); w.__classificationBlobs.set(url, blob); return url; };
  HTMLAnchorElement.prototype.click = function() {
   const blob = w.__classificationBlobs.get(this.href), name = this.download;
   if (name && blob) blob.arrayBuffer().then((bytes: ArrayBuffer) => crypto.subtle.digest('SHA-256', bytes)).then((digest: ArrayBuffer) => w.__classificationDownloads.push({ name, type: blob.type, sha256: Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('') }));
   return w.__classificationClick.call(this);
  };
 });
}
async function restoreDownloads(browser: any) {
 await browser.evaluate(() => { const w = window as any; URL.createObjectURL = w.__classificationCreate; HTMLAnchorElement.prototype.click = w.__classificationClick; w.__classificationBlobs.clear(); });
}

test('SVG uses the inert exact-byte download and is excluded from real raster gallery navigation', async ({ app, screen, browser }) => {
 await app.open('/?reset=1'); await browser.evaluate(async () => { await (window as any).productSurfaces.ready; });
 await screen.getByRole('button', { name: 'Marketing Agent', exact: true }).click();
 await browser.locator('#attachment-input').setInputFiles(['tests/fixtures/vector.svg', 'tests/fixtures/profile.png']);
 await observeActualDownloads(browser);
 try {
  const before = await readdir(artifactRoot, {recursive: true});
  const download = await browser.waitForDownload(() => screen.getByRole('button', { name: 'Bijlage openen: vector.svg', exact: true }).click(), { timeout: 10000 });
  expect(download.suggestedFilename).toBe('vector.svg');
  expect(sha256(await downloadedBytes(download, before))).toBe(sha256(vector));
  await expect.poll(() => browser.evaluate(() => (window as any).__classificationDownloads)).toEqual([{ name: 'vector.svg', type: 'application/octet-stream', sha256: sha256(vector) }]);
  expect(await browser.locator('[data-product-media]').count()).toBe(0);
  await screen.getByRole('button', { name: 'Bijlage openen: profile.png', exact: true }).click();
  await expect(screen.getByRole('button', { name: 'Afbeelding 1 van 1', exact: true })).toBeVisible();
  expect(await browser.locator('[data-media-index]').count()).toBe(1);
  await expect.poll(() => browser.evaluate(() => { const image = document.querySelector('[data-media-image]') as HTMLImageElement; return image?.naturalWidth > 0 && image.alt === 'profile.png' && getComputedStyle(image).opacity === '1'; })).toBe(true);
 } finally { await restoreDownloads(browser); }
});

test('gallery checks authoritative stored bytes metadata when a raster reference disagrees with its record', async ({ app, screen, browser }) => {
 await app.open('/?reset=1'); await browser.evaluate(async () => { await (window as any).productSurfaces.ready; });
 await screen.getByRole('button', { name: 'Marketing Agent', exact: true }).click();
 await browser.locator('#attachment-input').setInputFiles('tests/fixtures/profile.png');
 await expect(screen.getByRole('button', { name: 'Bijlage openen: profile.png', exact: true })).toBeVisible();
 const id = await screen.getByRole('button', { name: 'Bijlage openen: profile.png', exact: true }).getAttribute('data-id');
 // Corrupt only the bytes-owning record; the still-visible original reference remains PNG.
 await browser.evaluate(async ({ id, vector }: { id: string; vector: string }) => {
  const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('grok-local-attachments-v1', 1); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
  try { await new Promise<void>((resolve, reject) => { const tx = db.transaction('files', 'readwrite'), store = tx.objectStore('files'), request = store.getAll(); request.onsuccess = () => { const record = request.result.find(r => r.id === id); if (!record) { tx.abort(); return; } store.put({ ...record, name: 'authoritative.svg', type: 'image/svg+xml', blob: new Blob([vector], { type: 'image/svg+xml' }) }); }; tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(tx.error || new Error('Fixture record mutation failed')); }); } finally { db.close(); }
 }, { id: id!, vector });
 await observeActualDownloads(browser);
 try {
  const before = await readdir(artifactRoot, {recursive: true});
  const download = await browser.waitForDownload(() => screen.getByRole('button', { name: 'Bijlage openen: profile.png', exact: true }).click(), { timeout: 10000 });
  expect(download.suggestedFilename).toBe('authoritative.svg');
  expect(sha256(await downloadedBytes(download, before))).toBe(sha256(vector));
  expect(await browser.locator('[data-product-media]').count()).toBe(0);
  await expect.poll(() => browser.evaluate(() => (window as any).__classificationDownloads)).toEqual([{ name: 'authoritative.svg', type: 'application/octet-stream', sha256: sha256(vector) }]);
 } finally { await restoreDownloads(browser); }
});
