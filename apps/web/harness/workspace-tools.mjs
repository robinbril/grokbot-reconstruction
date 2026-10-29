import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createBrowserTools, browserToolDefinitions } from './browser-tools.mjs';
import { validatePrimitiveArguments } from './browser-interactions.mjs';

const MAX_FILE_BYTES = 256 * 1024;
const string = { type: 'string' };
const schema = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
export const workspaceToolDefinitions = [
  { name: 'workspace_list', description: 'List visible files in a directory of this conversation workspace.', inputSchema: schema({ path: string }) },
  { name: 'workspace_read', description: 'Read a UTF-8 file in this conversation workspace (maximum 256 KiB).', inputSchema: schema({ path: string }, ['path']) },
  { name: 'workspace_write', description: 'Atomically write a UTF-8 file in this conversation workspace (maximum 256 KiB). Parent directories must exist.', inputSchema: schema({ path: string, content: string }, ['path', 'content']) },
];
export const toolDefinitions = [...workspaceToolDefinitions, ...browserToolDefinitions];

export function validateToolArguments(name, args) {
  const definition = toolDefinitions.find(tool => tool.name === name);
  if (!definition) throw new Error('Unknown workspace tool');
  validatePrimitiveArguments(definition, args);
}

export function workspacePathParts(value = '.') {
  if (typeof value !== 'string' || value.length > 1024 || value.includes('\0') || value.includes('\\') || path.isAbsolute(value)) throw new Error('Invalid workspace path');
  if (value === '.' || value === '') return [];
  const parts = value.split('/');
  if (parts.some(part => !part || part.startsWith('.') || part.length > 255)) throw new Error('Hidden and parent paths are forbidden');
  return parts;
}

export async function resolveWorkspacePath(workspace, value, { writing = false } = {}) {
  const root = await fs.realpath(workspace);
  const parts = workspacePathParts(value);
  let current = root;
  for (let index = 0; index < parts.length; index += 1) {
    current = path.join(current, parts[index]);
    let entry;
    try { entry = await fs.lstat(current); }
    catch (error) {
      if (writing && index === parts.length - 1 && error.code === 'ENOENT') return current;
      throw error;
    }
    if (entry.isSymbolicLink()) throw new Error('Symlinks are forbidden in workspace tool paths');
    const real = await fs.realpath(current);
    const relative = path.relative(root, real);
    if (relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) throw new Error('Workspace path escapes its root');
  }
  return current;
}

async function list(workspace, value) {
  const target = await resolveWorkspacePath(workspace, value);
  const directory = await fs.opendir(target);
  const entries = [];
  let truncated = false;
  for await (const entry of directory) {
    if (entry.name.startsWith('.')) continue;
    if (entries.length === 200) { truncated = true; break; }
    entries.push({ name: entry.name, type: entry.isSymbolicLink() ? 'symlink' : entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'other' });
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  return { path: value ?? '.', entries, truncated };
}

async function read(workspace, value, signal) {
  const target = await resolveWorkspacePath(workspace, value);
  const handle = await fs.open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error('Workspace path is not a regular file');
    const bytes = Buffer.alloc(MAX_FILE_BYTES + 1);
    signal?.throwIfAborted();
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    return { path: value, content: bytes.subarray(0, Math.min(bytesRead, MAX_FILE_BYTES)).toString('utf8'), truncated: bytesRead > MAX_FILE_BYTES };
  } finally { await handle.close(); }
}

async function write(workspace, value, content, signal) {
  if (Buffer.byteLength(content, 'utf8') > MAX_FILE_BYTES) throw new Error('Workspace content exceeds 256 KiB');
  const target = await resolveWorkspacePath(workspace, value, { writing: true });
  if (!workspacePathParts(value).length) throw new Error('A file path is required');
  const temporary = path.join(path.dirname(target), `.harness-write-${randomUUID()}`);
  let handle;
  try {
    signal?.throwIfAborted();
    handle = await fs.open(temporary, 'wx', 0o600);
    await handle.writeFile(content, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    signal?.throwIfAborted();
    await resolveWorkspacePath(workspace, value, { writing: true });
    await fs.rename(temporary, target);
    const directory = await fs.open(path.dirname(target), 'r');
    try { await directory.sync(); } finally { await directory.close(); }
    return { path: value, bytesWritten: Buffer.byteLength(content, 'utf8') };
  } finally {
    await handle?.close();
    await fs.rm(temporary, { force: true });
  }
}

export function createWorkspaceTools(options) {
  const browser = createBrowserTools(options);
  return {
    listTools: () => structuredClone(toolDefinitions),
    async callTool(name, args = {}, { signal } = {}) {
      validateToolArguments(name, args);
      signal?.throwIfAborted();
      if (name === 'workspace_list') return list(options.workspace, args.path);
      if (name === 'workspace_read') return read(options.workspace, args.path, signal);
      if (name === 'workspace_write') return write(options.workspace, args.path, args.content, signal);
      return browser.callTool(name, args, { signal });
    },
    browserState: browser.browserState,
    frame: browser.frame,
    close: browser.close,
  };
}
