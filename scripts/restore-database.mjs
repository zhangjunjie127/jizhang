import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { restoreDatabaseBackup } from '../server/database-backup.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const [source, target, ...flags] = process.argv.slice(2);
if (!source || !target) {
  throw new Error('Usage: node scripts/restore-database.mjs BACKUP TARGET --server-stopped --confirm-overwrite [BACKUP_DIR]');
}
const result = restoreDatabaseBackup(resolve(source), resolve(target), {
  serverStopped: flags.includes('--server-stopped'),
  confirmOverwrite: flags.includes('--confirm-overwrite'),
  backupDirectory: resolve(flags.find(value => !value.startsWith('--')) || join(root, 'data', 'backups')),
});
process.stdout.write(`Database restored. Previous database preserved at: ${result.safetyBackup}\n`);
