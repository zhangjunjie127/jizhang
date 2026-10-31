import { randomUUID } from 'node:crypto';
import {
  closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, realpathSync,
  renameSync, rmSync, writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

function verifyDatabase(bytes) {
  const check = new DatabaseSync(':memory:');
  try {
    check.deserialize(bytes);
    const result = check.prepare('PRAGMA integrity_check').get();
    if (result.integrity_check !== 'ok') throw new Error('SQLite integrity check failed');
  } finally {
    check.close();
  }
}

function snapshot(path) {
  const database = new DatabaseSync(path);
  try {
    const bytes = database.serialize();
    verifyDatabase(bytes);
    return bytes;
  } finally {
    database.close();
  }
}

function writeAtomic(path, bytes) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  let descriptor;
  try {
    descriptor = openSync(temporary, 'wx', 0o600);
    writeFileSync(descriptor, bytes);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporary, path);
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    rmSync(temporary, { force: true });
    throw error;
  }
}

export function writeDatabaseBackup(sourcePath, backupDirectory, now = new Date()) {
  const source = resolve(sourcePath);
  if (!existsSync(source)) throw new Error('Source database does not exist');
  const directory = resolve(backupDirectory);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const destination = join(directory, `zaizai-${stamp}-${randomUUID()}.sqlite`);
  writeAtomic(destination, snapshot(source));
  return destination;
}

export function restoreDatabaseBackup(sourcePath, targetPath, {
  backupDirectory,
  serverStopped = false,
  confirmOverwrite = false,
} = {}) {
  if (!serverStopped || !confirmOverwrite) {
    throw new Error('Restore requires serverStopped and confirmOverwrite acknowledgements');
  }
  const source = realpathSync(resolve(sourcePath)), target = realpathSync(resolve(targetPath));
  if (source === target) throw new Error('Source and target must be different files');
  if (!existsSync(source) || !existsSync(target)) throw new Error('Source backup and target database must both exist');
  if (existsSync(`${target}-wal`) || existsSync(`${target}-shm`) || existsSync(`${target}-journal`)) {
    throw new Error('SQLite sidecar files exist; stop the backend cleanly before restoring');
  }
  const bytes = readFileSync(source);
  verifyDatabase(bytes);
  const targetDirectory = dirname(target);
  mkdirSync(targetDirectory, { recursive: true });
  const savedCurrent = writeDatabaseBackup(target, backupDirectory, new Date());
  const staged = join(targetDirectory, `.${basename(target)}.${randomUUID()}.restore`);
  const displaced = `${staged}.previous`;
  writeAtomic(staged, bytes);
  try {
    renameSync(target, displaced);
    try {
      renameSync(staged, target);
    } catch (error) {
      renameSync(displaced, target);
      throw error;
    }
    rmSync(displaced, { force: true });
  } catch (error) {
    rmSync(staged, { force: true });
    throw error;
  }
  return { restoredFrom: source, safetyBackup: savedCurrent };
}
