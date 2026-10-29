/* Browser-local attachments. Bytes and draft references commit together in IndexedDB.
 * The demo deliberately limits each file to 5 MiB and a draft to 10 files / 20 MiB. */
export const attachmentLimits = Object.freeze({ fileBytes: 5 * 1024 * 1024, draftBytes: 20 * 1024 * 1024, count: 10 });
export const attachmentLimitLabel = 'maximaal 10 bestanden, 5 MiB per bestand en 20 MiB per concept.';
export const attachmentSharingLabel = live => (live ? 'Bij verzending gedeeld met het ingestelde model. ' : 'Alleen lokaal. ') + attachmentLimitLabel[0].toUpperCase() + attachmentLimitLabel.slice(1);
const databaseName = 'grok-local-attachments-v1';
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const refOf = record => ({ id: record.id, name: record.name, type: record.type, size: record.size });
const storageError = () => new Error('Bijlage niet opgeslagen. Je concept blijft behouden. Probeer opnieuw; gebruik alleen lokale demobestanden.');

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) { reject(storageError()); return; }
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore('files', { keyPath: 'key' });
      db.createObjectStore('drafts', { keyPath: 'key' });
    };
    request.onerror = () => reject(storageError());
    request.onblocked = () => reject(storageError());
    request.onsuccess = () => resolve(request.result);
  });
}
function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(storageError());
    transaction.onabort = () => reject(storageError());
  });
}
function requestValue(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(storageError());
  });
}

export function createAttachmentStore({ namespace, onChange = () => {}, onError = () => {}, canPersist = () => true, consumedIds = [] }) {
  if (typeof namespace !== 'string' || !namespace) throw new Error('Attachment namespace required');
  const drafts = new Map(), unsaved = new Map(), active = new Map();
  const consumed = new Set(consumedIds.filter(id => typeof id === 'string'));
  let queue = Promise.resolve();
  const keyFor = id => `${namespace}:${id}`;
  let database = openDatabase();
  const initialize = connection => connection.then(async db => {
    db.onversionchange = () => db.close();
    const transaction = db.transaction('drafts', 'readonly');
    const done = transactionDone(transaction);
    const [, records] = await Promise.all([done, requestValue(transaction.objectStore('drafts').getAll())]);
    for (const record of records) {
      if (record.namespace === namespace && Array.isArray(record.refs)) drafts.set(record.conversation, record.refs.filter(ref => !consumed.has(ref.id)));
    }
  });
  let initialization = initialize(database);
  const ready = initialization;
  // Initialization may fail before the user attempts an attachment operation.
  ready.catch(() => {});
  async function ensureReady() {
    try { await initialization; } catch {
      database = openDatabase();
      initialization = initialize(database);
      await initialization;
    }
  }
  const list = conversation => (drafts.get(conversation) || []).filter(ref => !consumed.has(ref.id)).map(ref => ({ ...ref }));
  const failed = conversation => (unsaved.get(conversation) || []).map(record => ({ ...refOf(record), saved: false }));
  function enqueue(conversation, operation) {
    active.set(conversation, (active.get(conversation) || 0) + 1);
    onChange(conversation);
    const result = queue.catch(() => {}).then(operation);
    queue = result.catch(() => {});
    return result.catch(error => { onError(error.message || storageError().message, conversation); throw error; }).finally(() => {
      active.set(conversation, active.get(conversation) - 1);
      onChange(conversation);
    });
  }
  async function writeDraft(conversation, refs, records = []) {
    await ensureReady();
    const db = await database;
    const transaction = db.transaction(['files', 'drafts'], 'readwrite');
    const done = transactionDone(transaction);
    try {
      for (const record of records) transaction.objectStore('files').put(record);
      transaction.objectStore('drafts').put({ key: keyFor(conversation), namespace, conversation, refs });
    } catch (error) {
      transaction.abort();
      await done.catch(() => {});
      throw error;
    }
    await done;
    drafts.set(conversation, refs);
  }
  function validate(conversation, files) {
    const existing = [...list(conversation), ...failed(conversation)];
    if (files.some(file => file.size > attachmentLimits.fileBytes) || existing.length + files.length > attachmentLimits.count || existing.reduce((total, ref) => total + ref.size, 0) + files.reduce((total, file) => total + file.size, 0) > attachmentLimits.draftBytes) {
      throw new Error(attachmentLimitLabel);
    }
  }
  function add(conversation, files) {
    const selected = Array.from(files);
    return enqueue(conversation, async () => {
      validate(conversation, selected);
      const records = selected.map(file => {
        const id = crypto.randomUUID();
        return { key: keyFor(id), namespace, id, name: file.name, size: file.size, type: file.type, blob: file.slice(0, file.size, file.type) };
      });
      try { await ensureReady(); } catch {
        unsaved.set(conversation, [...(unsaved.get(conversation) || []), ...records]);
        throw storageError();
      }
      validate(conversation, selected);
      try {
        if (!canPersist()) throw storageError();
        await writeDraft(conversation, [...list(conversation), ...records.map(refOf)], records);
      } catch {
        unsaved.set(conversation, [...(unsaved.get(conversation) || []), ...records]);
        throw storageError();
      }
      return records.map(refOf);
    });
  }
  function retry(conversation) {
    return enqueue(conversation, async () => {
      const records = unsaved.get(conversation) || [];
      if (!records.length) return;
      await ensureReady();
      validate(conversation, []);
      if (!canPersist()) throw storageError();
      await writeDraft(conversation, [...list(conversation), ...records.map(refOf)], records);
      unsaved.delete(conversation);
    });
  }
  function remove(conversation, id) {
    return enqueue(conversation, async () => {
      const failedRecords = unsaved.get(conversation) || [];
      if (failedRecords.some(record => record.id === id)) {
        unsaved.set(conversation, failedRecords.filter(record => record.id !== id));
        return;
      }
      await ensureReady();
      await writeDraft(conversation, list(conversation).filter(ref => ref.id !== id));
    });
  }
  // Called only after message metadata is durable. Message references are authoritative
  // even if draft cleanup fails or the browser closes before its transaction commits.
  function clear(conversation, sentRefs) {
    for (const ref of sentRefs) consumed.add(ref.id);
    return enqueue(conversation, async () => {
      try {
        await ensureReady();
        await writeDraft(conversation, list(conversation));
      } catch {
        throw new Error('Je bericht en bijlagen zijn opgeslagen. Het bijlageconcept kon nog niet worden opgeruimd.');
      }
    });
  }
  async function read(id) {
    await ensureReady();
    const db = await database;
    const transaction = db.transaction('files', 'readonly');
    const done = transactionDone(transaction);
    const [, record] = await Promise.all([done, requestValue(transaction.objectStore('files').get(keyFor(id)))]);
    if (!record || !(record.blob instanceof Blob)) throw new Error('Deze bijlage is niet beschikbaar in de lokale browseropslag.');
    return record;
  }
  function prepareRecovery(conversation, refs) {
    return enqueue(conversation, async () => {
      const restored = [];
      for (const ref of refs) {
        const record = await read(ref.id);
        if ((ref.namespace !== undefined && ref.namespace !== namespace) || record.namespace !== namespace || record.name !== ref.name || record.type !== ref.type || record.size !== ref.size || record.blob.size !== ref.size) throw storageError();
        restored.push(refOf(record));
      }
      // The metadata journal still marks these IDs consumed. A failed cancellation
      // leaves them hidden; a successful atomic commit unlocks them on reconstruction.
      await stageRecovery(conversation, restored);
    });
  }
  async function stageRecovery(conversation, restored) {
    await ensureReady();const db = await database;
    if (!canPersist()) throw storageError();
    const transaction = db.transaction('drafts', 'readwrite'), done = transactionDone(transaction);
    const table = transaction.objectStore('drafts'), request = table.get(keyFor(conversation));let merged;
    request.onsuccess = () => {
      try {
        const previous = Array.isArray(request.result?.refs) ? request.result.refs : [];
        merged = [...new Map([...previous, ...restored].map(ref => [ref.id, ref])).values()];
        const restoredIds = new Set(restored.map(ref => ref.id)), visible = merged.filter(ref => !consumed.has(ref.id) || restoredIds.has(ref.id));
        if (visible.length > attachmentLimits.count || visible.some(ref => ref.size > attachmentLimits.fileBytes) || visible.reduce((sum, ref) => sum + ref.size, 0) > attachmentLimits.draftBytes) throw storageError();
        table.put({key:keyFor(conversation),namespace,conversation,refs:merged});
      } catch { transaction.abort(); }
    };
    await done;drafts.set(conversation, merged);
  }
  function recoveryReady(conversation, refs) {
    const staged = drafts.get(conversation) || [];
    return refs.every(ref => staged.some(saved => saved.id === ref.id && saved.name === ref.name && saved.type === ref.type && saved.size === ref.size));
  }
  function completeRecovery(conversation, refs) {
    if (!recoveryReady(conversation, refs)) throw storageError();
    for (const ref of refs) consumed.delete(ref.id);
    onChange(conversation);
  }
  return { ready, list, failed, add, retry, remove, clear, read, prepareRecovery, recoveryReady, completeRecovery, busy: conversation => Boolean(active.get(conversation)), idle: () => queue };
}

export function attachmentMarkup(refs, { draft = false } = {}) {
  return (Array.isArray(refs) ? refs : []).filter(ref => ref && typeof ref.id === 'string' && typeof ref.name === 'string').map(ref => `<span class="attachment-chip"><button type="button" class="text-button attachment-open" data-action="attachment-open" data-id="${escapeHTML(ref.id)}" aria-label="Bijlage openen: ${escapeHTML(ref.name)}">${escapeHTML(ref.name)}</button>${ref.saved === false ? '<span class="small muted">Niet opgeslagen</span>' : ''}${draft ? `<button type="button" class="text-button attachment-remove" data-action="remove-attachment" data-id="${escapeHTML(ref.id)}" aria-label="Bijlage verwijderen: ${escapeHTML(ref.name)}">×</button>` : ''}</span>`).join('');
}

export function attachmentPreviewKind(record) {
  const extension = record.name.split('.').pop().toLowerCase();
  const type = record.type.toLowerCase().split(';')[0];
  if (['html', 'htm', 'svg', 'xhtml', 'xml'].includes(extension) || /html|svg|xml/.test(type)) return 'download';
  if (/^image\/(png|jpeg|gif|webp|avif)$/.test(type) && ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif'].includes(extension)) return 'image';
  if ((type.startsWith('text/') || ['application/json', 'application/javascript'].includes(type) || !type) && ['txt', 'md', 'csv', 'json', 'log', 'js', 'ts', 'css'].includes(extension)) return 'text';
  return 'download';
}
export async function attachmentPreview(record) {
  const kind = attachmentPreviewKind(record);
  let url;
  const html = kind === 'text' ? `<pre class="attachment-text">${escapeHTML(await record.blob.text())}</pre>` : kind === 'image' ? `<img class="attachment-image" src="${escapeHTML(url = URL.createObjectURL(record.blob))}" alt="${escapeHTML(record.name)}">` : '<p>Dit bestand is alleen als download beschikbaar.</p>';
  return { html, dispose: () => { if (url) URL.revokeObjectURL(url); } };
}
export function downloadAttachment(record) {
  // Force downloaded HTML/SVG and unknown formats into an inert download response.
  const blob = new Blob([record.blob], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob), anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = record.name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
