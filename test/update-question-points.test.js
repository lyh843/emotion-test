const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

test('分值脚本更新题库、历史快照和完成答卷', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emotion-points-'));
  const dataDir = path.join(tempDir, 'data');
  const uploadDir = path.join(tempDir, 'uploads');
  fs.mkdirSync(dataDir);
  fs.mkdirSync(uploadDir);
  Object.assign(process.env, {
    DATA_DIR: dataDir,
    UPLOAD_DIR: uploadDir,
    SESSION_SECRET: 'points-test-secret',
    ADMIN_PASSWORD: 'points-test-password',
    SEED_DEMO_DATA: 'true'
  });

  const { db } = require('../server');
  try {
    const addQuestion = db.prepare(`INSERT INTO questions(
      code,modality,option_type,question_type,points,title,context,prompt,options_json,
      correct_emotion,standard_strength,correct_emotions_json,standard_strengths_json,
      emotion_category,difficulty,published
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)`);
    for (const [index, difficulty] of ['easy', 'medium', 'hard'].entries()) {
      addQuestion.run(`REASON-${index + 1}`, 'text', 'single', 'reasoning', 100, `推理${difficulty}`, '', '测试问题', '["快乐"]', '快乐', 3, '["快乐"]', '[3]', '快乐', difficulty);
    }

    const recognitionEasy = db.prepare("SELECT * FROM questions WHERE question_type='recognition' AND difficulty='easy' LIMIT 1").get();
    const reasoningHard = db.prepare("SELECT * FROM questions WHERE question_type='reasoning' AND difficulty='hard' LIMIT 1").get();
    const testId = db.prepare('SELECT id FROM assessment_tests LIMIT 1').get().id;
    const attemptId = Number(db.prepare("INSERT INTO attempts(public_id,token_hash,status,test_id,total_score,label_score,strength_score,duration_ms,report_json) VALUES('POINTS-TEST','hash','completed',?,50,50,50,4000,?)").run(testId, JSON.stringify({ feedback_cache: { warm: { text: '旧报告' } } })).lastInsertRowid);
    const addAttemptQuestion = db.prepare(`INSERT INTO attempt_questions(
      attempt_id,question_id,position,modality_snapshot,title_snapshot,context_snapshot,
      prompt_snapshot,options_snapshot,correct_emotion_snapshot,standard_strength_snapshot,
      emotion_category_snapshot,option_type_snapshot,question_type_snapshot,points_snapshot,
      correct_emotions_snapshot,standard_strengths_snapshot
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const first = Number(addAttemptQuestion.run(attemptId, recognitionEasy.id, 1, 'image', recognitionEasy.title, '', '测试问题', '["快乐"]', '快乐', 3, '快乐', 'single', 'recognition', 100, '["快乐"]', '[3]').lastInsertRowid);
    const second = Number(addAttemptQuestion.run(attemptId, reasoningHard.id, 2, 'text', reasoningHard.title, '', '测试问题', '["快乐"]', '快乐', 3, '快乐', 'single', 'reasoning', 100, '["快乐"]', '[3]').lastInsertRowid);
    const addResponse = db.prepare('INSERT INTO responses(attempt_question_id,skipped,response_time_ms,label_score,strength_score,total_score) VALUES(?,0,?,?,?,?)');
    addResponse.run(first, 1000, 100, 100, 100);
    addResponse.run(second, 3000, 0, 0, 0);
  } finally {
    db.close();
  }

  const { main } = require('../scripts/update-question-points');
  const databaseFile = path.join(dataDir, 'emotion.sqlite');
  await main({ apply: false, databaseFile });
  let check = new Database(databaseFile);
  assert.equal(check.prepare("SELECT points FROM questions WHERE code='REASON-3'").get().points, 100);
  check.close();

  await main({ apply: true, databaseFile });

  check = new Database(databaseFile);
  try {
    const expected = {
      'recognition/easy': 2,
      'recognition/medium': 3,
      'recognition/hard': 4,
      'reasoning/easy': 3,
      'reasoning/medium': 4,
      'reasoning/hard': 6
    };
    for (const row of check.prepare('SELECT question_type,difficulty,MIN(points) min,MAX(points) max FROM questions GROUP BY question_type,difficulty').all()) {
      assert.equal(row.min, expected[`${row.question_type}/${row.difficulty}`]);
      assert.equal(row.max, row.min);
    }
    assert.deepEqual(check.prepare("SELECT points_snapshot FROM attempt_questions WHERE attempt_id=(SELECT id FROM attempts WHERE public_id='POINTS-TEST') ORDER BY position").all().map(row => row.points_snapshot), [2, 6]);
    const attempt = check.prepare("SELECT * FROM attempts WHERE public_id='POINTS-TEST'").get();
    const report = JSON.parse(attempt.report_json);
    assert.deepEqual({ total: attempt.total_score, label: attempt.label_score, strength: attempt.strength_score, duration: attempt.duration_ms }, { total: 25, label: 25, strength: 25, duration: 4000 });
    assert.deepEqual({ overall: report.overall, maximum: report.max_points, earned: report.earned_points, averageTime: report.average_response_ms }, { overall: 25, maximum: 8, earned: 2, averageTime: 2000 });
    assert.deepEqual(report.by_question_type, { recognition: 100, reasoning: 0 });
    assert.equal(Object.hasOwn(report, 'feedback_cache'), false);
    assert.equal(fs.readdirSync(path.join(dataDir, 'backups')).length, 1);
  } finally {
    check.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
