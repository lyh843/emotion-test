const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function loadEnvFile() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[match[1]] = value;
  }
}

async function main() {
  loadEnvFile();
  const apply = process.argv.includes('--apply');
  const dataDir = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
  const databaseFile = path.join(dataDir, 'emotion.sqlite');
  if (!fs.existsSync(databaseFile)) throw Error(`找不到数据库：${databaseFile}`);

  const db = new Database(databaseFile);
  db.pragma('foreign_keys = ON');
  try {
    const counts = db.prepare(`SELECT option_type,COUNT(*) count FROM questions
      WHERE option_type IN ('single','multiple') GROUP BY option_type`).all();
    const byType = Object.fromEntries(counts.map(row => [row.option_type, row.count]));
    console.log(`数据库：${databaseFile}`);
    console.log(`单选题：${byType.single || 0} 道，将设为 3.5 分`);
    console.log(`多选题：${byType.multiple || 0} 道，将设为 4.5 分`);
    if (!apply) {
      console.log('当前为预览模式，未修改数据。确认后添加 --apply 执行。');
      return;
    }

    const backupDir = path.join(dataDir, 'backups');
    fs.mkdirSync(backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFile = path.join(backupDir, `emotion-before-points-${stamp}.sqlite`);
    await db.backup(backupFile);
    const result = db.transaction(() => ({
      single: db.prepare("UPDATE questions SET points=3.5,updated_at=CURRENT_TIMESTAMP WHERE option_type='single'").run().changes,
      multiple: db.prepare("UPDATE questions SET points=4.5,updated_at=CURRENT_TIMESTAMP WHERE option_type='multiple'").run().changes
    }))();
    console.log(`更新完成：单选题 ${result.single} 道，多选题 ${result.multiple} 道。`);
    console.log(`执行前备份：${backupFile}`);
    console.log('历史答卷保存的是生成时的分值快照，本次更新不会改变历史答卷分数。');
  } finally {
    db.close();
  }
}

main().catch(error => {
  console.error(`更新失败：${error.message}`);
  process.exitCode = 1;
});
