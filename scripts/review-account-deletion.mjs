import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { parseArgs } from 'node:util';
import { createAccountDeletionStore } from '../server/account-deletion.mjs';

const { values } = parseArgs({ options: {
  database: { type: 'string' }, list: { type: 'boolean' }, approve: { type: 'string' },
  reject: { type: 'string' }, 'confirm-user': { type: 'string' }, reason: { type: 'string' },
  'server-stopped': { type: 'boolean' },
} });
const path = resolve(values.database || join(process.env.DATA_DIR || 'data', 'app.sqlite'));
if (!existsSync(path)) throw new Error('数据库不存在，请检查 --database 路径');
if ([values.list, values.approve, values.reject].filter(Boolean).length !== 1) throw new Error('仅可选择 --list、--approve 申请ID 或 --reject 申请ID');
if (!values.list && (!values['confirm-user'] || !values['server-stopped'])) throw new Error('先停止应用服务，再提供 --server-stopped 和 --confirm-user 用户ID');
const db = new DatabaseSync(path);
try {
  db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  const store = createAccountDeletionStore(db);
  if (values.list) console.log(JSON.stringify(store.pending(), null, 2));
  else {
    console.log(JSON.stringify(store.review(values.approve || values.reject, values['confirm-user'], values.approve ? 'approve' : 'reject', values.reason), null, 2));
    if (values.approve) console.log('当前数据库内账号及关联数据已删除。历史备份需管理员另行处理；本命令不删除备份文件。');
  }
} finally { db.close(); }
