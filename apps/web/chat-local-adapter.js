const abortError = () => new DOMException('Local work aborted', 'AbortError');
const check = signal => { if (signal?.aborted) throw abortError(); };
// The default releases the browser main thread between actual bounded work chunks.
const schedule = signal => new Promise((resolve, reject) => {
  check(signal);
  let handle;
  const abort = () => { if (globalThis.cancelAnimationFrame) cancelAnimationFrame(handle); else clearTimeout(handle); reject(abortError()); };
  const done = () => { signal?.removeEventListener('abort', abort); signal?.aborted ? reject(abortError()) : resolve(); };
  signal?.addEventListener('abort', abort, {once:true});
  handle = globalThis.requestAnimationFrame ? requestAnimationFrame(done) : setTimeout(done, 0);
});
export function createLocalTextAdapter({yieldWork = schedule} = {}) {
  return {id:'local-text-v1', async execute({text, operation, style, signal, onProgress = () => {}}) {
    if (typeof text !== 'string' || !text.trim() || text.length > 100000 || !['upper', 'count', 'markdown'].includes(operation) || !['short', 'full'].includes(style)) throw new TypeError('Invalid local text operation');
    check(signal);
    let processed = 0, output = '', words = 0, inWord = false, lines = 1;
    const total = text.length;
    const countText = () => `${words} ${words === 1 ? 'woord' : 'woorden'}` + (style === 'full' ? ` · ${total} ${total === 1 ? 'teken' : 'tekens'} · ${lines} ${lines === 1 ? 'regel' : 'regels'}` : '');
    while (processed < total) {
      check(signal);
      let end = Math.min(processed + 4096, total);
      if (end < total && /[\uD800-\uDBFF]/.test(text[end - 1]) && /[\uDC00-\uDFFF]/.test(text[end])) end--;
      const chunk = text.slice(processed, end);
      if (operation === 'count') {
        for (const char of chunk) {
          const word = /\S/u.test(char);
          if (word && !inWord) words++;
          inWord = word;
          if (char === '\n') lines++;
        }
      } else output += operation === 'upper' ? chunk.toUpperCase() : chunk;
      processed = end;
      if (processed < total) {
        onProgress({text:operation === 'count' ? countText() : output, processed, total});
        check(signal);
        await yieldWork(signal);
        check(signal);
      }
    }
    return {text:operation === 'count' ? countText() : output, processed, total};
  }};
}
