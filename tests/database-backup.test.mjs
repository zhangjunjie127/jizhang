import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { restoreDatabaseBackup, writeDatabaseBackup } from '../server/database-backup.mjs';

test('database backup is consistent and restore preserves a safety snapshot', () => {
  const directory = mkdtempSync(join(tmpdir(), 'zaizai-backup-'));
  try {
    const source = join(directory, 'source.sqlite');
    const target = join(directory, 'target.sqlite');
    const backups = join(directory, 'backups');
    const db = new DatabaseSync(source);
    db.exec("CREATE TABLE records(value TEXT); INSERT INTO records VALUES ('source-state')");
    db.close();
    const backup = writeDatabaseBackup(source, backups, new Date('2026-10-22T00:00:00.000Z'));
    const live = new DatabaseSync(target);
    live.exec("CREATE TABLE records(value TEXT); INSERT INTO records VALUES ('current-state')");
    live.close();

    assert.throws(() => restoreDatabaseBackup(backup, target, { backupDirectory: backups }), /acknowledgements/);
    const result = restoreDatabaseBackup(backup, target, {
      backupDirectory: backups, serverStopped: true, confirmOverwrite: true,
    });
    const restored = new DatabaseSync(target);
    assert.equal(restored.prepare('SELECT value FROM records').get().value, 'source-state');
    restored.close();
    const preserved = new DatabaseSync(result.safetyBackup);
    assert.equal(preserved.prepare('SELECT value FROM records').get().value, 'current-state');
    preserved.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('restore rejects corrupt backups without changing the target', () => {
  const directory = mkdtempSync(join(tmpdir(), 'zaizai-backup-corrupt-'));
  try {
    const source = join(directory, 'bad.sqlite');
    const target = join(directory, 'target.sqlite');
    const bad = new DatabaseSync(source);
    bad.exec('CREATE TABLE records(value TEXT)');
    bad.close();
    const live = new DatabaseSync(target);
    live.exec("CREATE TABLE records(value TEXT); INSERT INTO records VALUES ('keep')");
    live.close();
    const valid = writeDatabaseBackup(source, join(directory, 'backups'));
    const corrupt = join(directory, 'corrupt.sqlite');
    copyFileSync(valid, corrupt);
    const bytes = readFileSync(corrupt);
    bytes.set(Buffer.from('not-a-sqlite-db'));
    writeFileSync(corrupt, bytes);
    assert.throws(() => restoreDatabaseBackup(corrupt, target, {
      backupDirectory: join(directory, 'backups'), serverStopped: true, confirmOverwrite: true,
    }));
    const check = new DatabaseSync(target);
    assert.equal(check.prepare('SELECT value FROM records').get().value, 'keep');
    check.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
