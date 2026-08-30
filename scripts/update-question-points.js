#!/usr/bin/env node

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const POINTS = {
  recognition: { easy: 2, medium: 3, hard: 4 },
  reasoning: { easy: 3, medium: 4, hard: 6 }
};

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

function weightedRate(rows, key) {
  const weight = rows.reduce((sum, row) => sum + Number(row.points || 0), 0);
  return weight ? +(rows.reduce((sum, row) => sum + (Number(row[key]) || 0) * Number(row.points || 0), 0) / weight).toFixed(2) : null;
}

function groupedRates(rows, key) {
  const groups = {};
  for (const row of rows) (groups[row[key]] ??= []).push(row);
  return Object.fromEntries(Object.entries(groups).map(([name, items]) => [name, weightedRate(items, 'total_score')]));
}

function groupedCounts(rows, key) {
  const counts = {};
  for (const row of rows) counts[row[key]] = (counts[row[key]] || 0) + 1;
  return counts;
}

function calculateReport(db, attemptId) {
  const rows = db.prepare(`SELECT
      aq.modality_snapshot modality,
      aq.question_type_snapshot question_type,
      aq.emotion_category_snapshot emotion_category,
      aq.points_snapshot points,
      COALESCE(r.label_score,0) label_score,
      COALESCE(r.strength_score,0) strength_score,
      COALESCE(r.total_score,0) total_score,
      COALESCE(r.response_time_ms,0) response_time_ms
    FROM attempt_questions aq
    LEFT JOIN responses r ON r.attempt_question_id=aq.id
    WHERE aq.attempt_id=?`).all(attemptId);
  if (!rows.length) throw Error(`完成答卷 ${attemptId} 没有题目，无法重算`);

  const recognition = rows.filter(row => row.question_type === 'recognition');
  const reasoning = rows.filter(row => row.question_type === 'reasoning');
  const duration = rows.reduce((sum, row) => sum + Number(row.response_time_ms || 0), 0);
  const maxPoints = rows.reduce((sum, row) => sum + Number(row.points || 0), 0);
  return {
    duration,
    report: {
      overall: weightedRate(rows, 'total_score'),
      label: weightedRate(rows, 'label_score'),
      strength: weightedRate(rows, 'strength_score'),
      average_response_ms: Math.round(duration / rows.length),
      max_points: +maxPoints.toFixed(2),
      earned_points: +(rows.reduce((sum, row) => sum + Number(row.total_score || 0) * Number(row.points || 0) / 100, 0)).toFixed(2),
      by_question_type: {
        recognition: weightedRate(recognition, 'total_score'),
        reasoning: weightedRate(reasoning, 'total_score')
      },
      recognition_details: {
        label: weightedRate(recognition, 'label_score'),
        strength: weightedRate(recognition, 'strength_score')
      },
      by_modality: groupedRates(rows, 'modality'),
      by_emotion: groupedRates(rows, 'emotion_category'),
      sample_sizes: {
        total: rows.length,
        question_types: { recognition: recognition.length, reasoning: reasoning.length },
        modalities: groupedCounts(rows, 'modality')
      }
    }
  };
}

async function main(options = {}) {
  loadEnvFile();
  const apply = options.apply ?? process.argv.includes('--apply');
  const databaseArg = process.argv.slice(2).find(value => !value.startsWith('-'));
  const databaseFile = path.resolve(options.databaseFile || databaseArg || path.join(process.env.DATA_DIR || path.join(ROOT, 'data'), 'emotion.sqlite'));
  const dataDir = path.dirname(databaseFile);
  if (!fs.existsSync(databaseFile)) throw Error(`找不到数据库：${databaseFile}`);

  const db = new Database(databaseFile);
  db.pragma('foreign_keys = ON');
  try {
    const combinations = db.prepare(`SELECT question_type,difficulty,COUNT(*) count
      FROM questions GROUP BY question_type,difficulty ORDER BY question_type,difficulty`).all();
    const unknown = combinations.filter(row => POINTS[row.question_type]?.[row.difficulty] === undefined);
    if (unknown.length) throw Error(`存在无法映射的题型或难度：${unknown.map(row => `${row.question_type}/${row.difficulty}`).join('、')}`);

    console.log(`数据库：${databaseFile}`);
    for (const row of combinations) console.log(`${row.question_type} / ${row.difficulty}：${row.count} 道，将设为 ${POINTS[row.question_type][row.difficulty]} 分`);
    console.log(`历史题目快照：${db.prepare('SELECT COUNT(*) count FROM attempt_questions').get().count} 条`);
    console.log(`待重算完成答卷：${db.prepare("SELECT COUNT(*) count FROM attempts WHERE status='completed'").get().count} 份`);
    if (!apply) {
      console.log('当前为预览模式，未修改数据。确认后添加 --apply 执行。');
      return;
    }

    const backupDir = path.join(dataDir, 'backups');
    fs.mkdirSync(backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFile = path.join(backupDir, `emotion-before-points-${stamp}.sqlite`);
    await db.backup(backupFile);

    const result = db.transaction(() => {
      const updateQuestions = db.prepare('UPDATE questions SET points=?,updated_at=CURRENT_TIMESTAMP WHERE question_type=? AND difficulty=?');
      let questions = 0;
      for (const [questionType, difficulties] of Object.entries(POINTS)) {
        for (const [difficulty, points] of Object.entries(difficulties)) questions += updateQuestions.run(points, questionType, difficulty).changes;
      }
      const snapshots = db.prepare(`UPDATE attempt_questions SET points_snapshot=(
        SELECT points FROM questions WHERE questions.id=attempt_questions.question_id
      )`).run().changes;
      const attempts = db.prepare("SELECT id FROM attempts WHERE status='completed'").all();
      const updateAttempt = db.prepare('UPDATE attempts SET total_score=?,label_score=?,strength_score=?,duration_ms=?,report_json=? WHERE id=?');
      for (const attempt of attempts) {
        const { duration, report } = calculateReport(db, attempt.id);
        updateAttempt.run(report.overall, report.label, report.strength, duration, JSON.stringify(report), attempt.id);
      }
      return { questions, snapshots, attempts: attempts.length };
    })();

    console.log(`更新完成：题库 ${result.questions} 道，历史题目快照 ${result.snapshots} 条，完成答卷 ${result.attempts} 份。`);
    console.log(`执行前备份：${backupFile}`);
    console.log('单题标签与强度得分率不变；答卷加权总分、报告和后台分析已按新分值重算。');
  } finally {
    db.close();
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(`更新失败：${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { main };
