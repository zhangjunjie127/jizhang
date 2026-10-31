import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeDatabaseBackup } from '../server/database-backup.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const source = resolve(process.argv[2] || join(root, 'data', 'app.sqlite'));
const destination = resolve(process.argv[3] || join(root, 'data', 'backups'));
const backup = writeDatabaseBackup(source, destination);
process.stdout.write(`Database backup created: ${backup}\n`);
