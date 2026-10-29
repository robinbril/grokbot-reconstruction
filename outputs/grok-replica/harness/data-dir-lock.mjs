import { mkdir, open, rename, unlink, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { harnessError } from "./store.mjs";
const uncertain = () => harnessError("DATA_DIR_LOCK_UNCERTAIN", "Ledger ownership is ambiguous; inspect the lock before starting another server", 503);
const locked = () => harnessError("DATA_DIR_LOCKED", "Another local server owns this data directory", 503);
async function syncDirectory(directory) {
  const handle = await open(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}
async function readRecord(filename) {
  let file;
  try {
    file = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await file.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > 4096) throw uncertain();
    const bytes = await file.readFile("utf8"), value = JSON.parse(bytes);
    if (value.schema !== 1 || !Number.isSafeInteger(value.pid) || value.pid < 1 || typeof value.token !== "string" || value.token.length < 16) throw uncertain();
    return { value, bytes, ino: stat.ino, dev: stat.dev };
  } catch (e) {
    if (e.code === "ENOENT") throw e;
    throw uncertain();
  } finally {
    await file?.close();
  }
}
function isDead(pid) {
  try {
    process.kill(pid, 0);
    return false;
  } catch (e) {
    if (e.code === "ESRCH") return true;
    if (e.code === "EPERM") return false;
    throw uncertain();
  }
}
async function writeRecord(filename, record) {
  const file = await open(filename, "wx", 384);
  try {
    await file.writeFile(JSON.stringify(record));
    await file.sync();
  } finally {
    await file.close();
  }
}
async function acquireDataDirLock(dataDir) {
  const directory = path.resolve(dataDir);
  await mkdir(directory, { recursive: true, mode: 448 });
  const filename = path.join(directory, ".dispatch-lock.json"), reclaim = filename + ".reclaim", record = { schema: 1, pid: process.pid, token: randomUUID(), createdAt: (/* @__PURE__ */ new Date()).toISOString() };
  try {
    await writeRecord(filename, record);
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
    const prior = await readRecord(filename);
    if (!isDead(prior.value.pid)) throw locked();
    try {
      await writeRecord(reclaim, record);
    } catch (e2) {
      if (e2.code === "EEXIST") throw uncertain();
      throw e2;
    }
    const temporary = filename + "." + record.token + ".tmp";
    try {
      const checked = await readRecord(filename);
      if (checked.bytes !== prior.bytes || checked.ino !== prior.ino || checked.dev !== prior.dev || !isDead(checked.value.pid)) throw uncertain();
      await writeRecord(temporary, record);
      await rename(temporary, filename);
      await syncDirectory(directory);
    } finally {
      await unlink(temporary).catch((e2) => {
        if (e2.code !== "ENOENT") throw e2;
      });
      const own = await readRecord(reclaim);
      if (own.value.token === record.token) await unlink(reclaim);
    }
  }
  await syncDirectory(directory);
  let released = false;
  return { async release() {
    if (released) return;
    released = true;
    let current;
    try {
      current = await readRecord(filename);
    } catch (e) {
      if (e.code === "ENOENT") return;
      throw e;
    }
    if (current.value.token !== record.token || current.value.pid !== process.pid) return;
    await unlink(filename);
    await syncDirectory(directory);
  } };
}
export {
  acquireDataDirLock
};
