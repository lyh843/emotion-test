const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'zhijing-test-'));
process.env.DATA_DIR = path.join(temp, 'data');
process.env.UPLOAD_DIR = path.join(temp, 'uploads');
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'integration-test-secret';
process.env.ADMIN_PASSWORD = 'integration-test-password';
process.env.SEED_DEMO_DATA = 'true';
process.env.LLM_API_KEY = '';
process.env.LLM_MODEL = '';
const { app, db } = require('../server');
let server, base;

test.before(async () => {
  await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => {
  await new Promise(resolve => server.close(resolve));
  db.close();
  fs.rmSync(temp, { recursive: true, force: true });
});

async function json(url, options = {}) {
  const response = await fetch(base + url, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
  return { response, body: await response.json() };
}

test('管理员接口需要登录，正确密码可建立会话', async () => {
  assert.equal((await json('/api/admin/dashboard')).response.status, 401);
  const login = await json('/api/admin/login', { method: 'POST', body: JSON.stringify({ username: 'admin', password: 'integration-test-password' }) });
  assert.equal(login.response.status, 200);
  assert.match(login.response.headers.get('set-cookie'), /connect\.sid=/);
});

test('测评配置支持模态、选项形式和能力类型的精确组合', async () => {
  const login = await json('/api/admin/login', { method: 'POST', body: JSON.stringify({ username: 'admin', password: 'integration-test-password' }) });
  const cookie = login.response.headers.get('set-cookie').split(';')[0];
  const config = await json('/api/admin/config', { headers: { Cookie: cookie } });
  assert.equal(config.body.combination_counts.image_single_recognition, 2);
  const combination_counts = Object.fromEntries(['image', 'text', 'audio', 'video'].flatMap(mode => ['single', 'multiple'].flatMap(option => ['recognition', 'reasoning'].map(kind => [`${mode}_${option}_${kind}`, 0]))));
  combination_counts.image_single_recognition = 2;
  combination_counts.text_single_recognition = 1;
  combination_counts.audio_single_recognition = 1;
  combination_counts.video_single_recognition = 1;
  const saved = await json('/api/admin/config', { method: 'PUT', headers: { Cookie: cookie }, body: JSON.stringify({ combination_counts }) });
  assert.equal(saved.response.status, 200);
  assert.equal(saved.body.total_count, 5);
});

test('题库可按选项形式和能力类型组合筛选', async () => {
  const login = await json('/api/admin/login', { method: 'POST', body: JSON.stringify({ username: 'admin', password: 'integration-test-password' }) });
  const cookie = login.response.headers.get('set-cookie').split(';')[0];
  const matching = await json('/api/admin/questions?option_type=single&question_type=recognition', { headers: { Cookie: cookie } });
  assert.equal(matching.response.status, 200);
  assert.equal(matching.body.length, 5);
  assert.ok(matching.body.every(question => question.option_type === 'single' && question.question_type === 'recognition'));
  const empty = await json('/api/admin/questions?option_type=multiple&question_type=reasoning', { headers: { Cookie: cookie } });
  assert.deepEqual(empty.body, []);
});

test('匿名测评可保存、恢复、评分，且不可重复提交', async () => {
  const created = await json('/api/attempts', { method: 'POST', body: '{}' });
  assert.equal(created.response.status, 201);
  const auth = { 'X-Attempt-Token': created.body.token };
  const attempt = await json(`/api/attempts/${created.body.id}`, { headers: auth });
  assert.equal(attempt.body.questions.length, 5);
  assert.ok(attempt.body.questions.every(question => question.options.length === 10));
  const standards = { '下班后的沉默': ['悲伤',4], '小组讨论': ['不耐烦',3], '没有说出口的话': ['失落',3], '迟到的祝福': ['愧疚',4], '重逢时刻': ['惊喜',5] };
  for (const q of attempt.body.questions) {
    const [emotion, strength] = standards[q.title];
    const saved = await json(`/api/attempts/${created.body.id}/responses/${q.position}`, { method: 'PUT', headers: auth, body: JSON.stringify({ emotion, strength, response_time_ms: 1000, modification_count: 1 }) });
    assert.equal(saved.response.status, 200);
  }
  const submitted = await json(`/api/attempts/${created.body.id}/submit`, { method: 'POST', headers: auth, body: '{}' });
  assert.deepEqual({ overall: submitted.body.overall, label: submitted.body.label, strength: submitted.body.strength }, { overall: 100, label: 100, strength: 100 });
  const duplicate = await json(`/api/attempts/${created.body.id}/submit`, { method: 'POST', headers: auth, body: '{}' });
  assert.equal(duplicate.response.status, 409);
  const report = await json(`/api/attempts/${created.body.id}/report`, { headers: auth });
  assert.equal(report.body.average_response_ms, 1000);
  assert.deepEqual(report.body.by_question_type, { recognition: 100, reasoning: null });
  assert.deepEqual(report.body.recognition_details, { label: 100, strength: 100 });
  assert.deepEqual(report.body.sample_sizes.question_types, { recognition: 5, reasoning: 0 });
  assert.deepEqual({ earned: report.body.earned_points, maximum: report.body.max_points }, { earned: 500, maximum: 500 });
  const feedback = await json(`/api/attempts/${created.body.id}/feedback`, { method: 'POST', headers: auth, body: JSON.stringify({ style: 'warm' }) });
  assert.equal(feedback.response.status, 200);
  assert.equal(feedback.body.source, 'local');
  assert.equal(feedback.body.version, 2);
  assert.ok(feedback.body.overview.length > 0);
  assert.ok(feedback.body.recommendations.length > 0);
  assert.ok(feedback.body.text.length <= 500);
  const cachedFeedback = await json(`/api/attempts/${created.body.id}/feedback`, { method: 'POST', headers: auth, body: JSON.stringify({ style: 'warm' }) });
  assert.equal(cachedFeedback.body.cached, true);
});

test('非法答案和配额不足被拒绝', async () => {
  const created = await json('/api/attempts', { method: 'POST', body: '{}' });
  const auth = { 'X-Attempt-Token': created.body.token };
  const invalid = await json(`/api/attempts/${created.body.id}/responses/1`, { method: 'PUT', headers: auth, body: JSON.stringify({ emotion: '不存在', strength: 9 }) });
  assert.equal(invalid.response.status, 400);
  const incomplete = await json(`/api/attempts/${created.body.id}/submit`, { method: 'POST', headers: auth, body: '{}' });
  assert.equal(incomplete.response.status, 400);
  assert.deepEqual(incomplete.body.missing_positions, [1, 2, 3, 4, 5]);
});

test('管理员可删除未使用题目和整份答卷，历史题目受保护', async () => {
  const login = await json('/api/admin/login', { method: 'POST', body: JSON.stringify({ username: 'admin', password: 'integration-test-password' }) });
  const cookie = login.response.headers.get('set-cookie').split(';')[0];
  const adminHeaders = { Cookie: cookie };
  const createdQuestion = await json('/api/admin/questions', {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({ modality: 'text', option_type: 'single', question_type: 'recognition', points: 12.5, title: '待删除题目', prompt: '测试问题', options: ['快乐'], correct_emotions: ['快乐'], standard_strengths: [3], difficulty: 'easy' })
  });
  assert.equal(createdQuestion.response.status, 201);
  const questionList = await json('/api/admin/questions', { headers: adminHeaders });
  assert.equal(questionList.body.find(question => question.id === createdQuestion.body.id).points, 12.5);
  assert.equal((await json(`/api/admin/questions/${createdQuestion.body.id}`, { method: 'DELETE', headers: adminHeaders })).response.status, 200);
  assert.equal((await json(`/api/admin/questions/${createdQuestion.body.id}`, { method: 'DELETE', headers: adminHeaders })).response.status, 404);

  const attempt = await json('/api/attempts', { method: 'POST', body: '{}' });
  const records = await json('/api/admin/attempts', { headers: adminHeaders });
  assert.ok(records.body.some(record => record.public_id === attempt.body.id && record.status === 'in_progress'));
  const questions = await json('/api/admin/questions', { headers: adminHeaders });
  const referencedQuestionId = questions.body[0].id;
  assert.equal((await json(`/api/admin/questions/${referencedQuestionId}`, { method: 'DELETE', headers: adminHeaders })).response.status, 409);
  assert.equal((await json(`/api/admin/attempts/${attempt.body.id}`, { method: 'DELETE', headers: adminHeaders })).response.status, 200);
  assert.equal((await json(`/api/admin/attempts/${attempt.body.id}`, { headers: adminHeaders })).response.status, 404);
});
