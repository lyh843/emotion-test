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
let server, base, completedAttempt;

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

test('测评配置支持识别与推理的独立边际配额和模态范围', async () => {
  const login = await json('/api/admin/login', { method: 'POST', body: JSON.stringify({ username: 'admin', password: 'integration-test-password' }) });
  const headers = { Cookie: login.response.headers.get('set-cookie').split(';')[0] };
  const original = await json('/api/admin/config', { headers });
  const assessment_rules = {
    recognition: { total: 18, difficulty: { easy: 5, medium: 9, hard: 4 }, option_type: { single: 7, multiple: 11 }, modality: { image: { min: 6, max: 7 }, text: { min: 3, max: 4 }, audio: { min: 3, max: 3 }, video: { min: 5, max: 5 } } },
    reasoning: { total: 6, difficulty: { easy: 1, medium: 3, hard: 2 }, option_type: { single: 2, multiple: 4 }, modality: { image: { min: 0, max: 1 }, text: { min: 1, max: 1 }, audio: { min: 1, max: 2 }, video: { min: 3, max: 3 } } }
  };
  try {
    const saved = await json('/api/admin/config', { method: 'PUT', headers, body: JSON.stringify({ assessment_rules }) });
    assert.equal(saved.response.status, 200);
    assert.equal(saved.body.total_count, 24);
    assert.deepEqual(saved.body.assessment_rules, assessment_rules);
    const impossible = structuredClone(assessment_rules);
    impossible.reasoning.modality.video = { min: 7, max: 7 };
    assert.equal((await json('/api/admin/config', { method: 'PUT', headers, body: JSON.stringify({ assessment_rules: impossible }) })).response.status, 400);
  } finally {
    await json('/api/admin/config', { method: 'PUT', headers, body: JSON.stringify({ combination_counts: original.body.combination_counts }) });
  }
});

test('管理员可关闭新作答且不影响已创建答卷，并可重新开放', async () => {
  const statusBefore = await json('/api/assessment/status');
  assert.deepEqual(statusBefore.body, { active: true });
  const existing = await json('/api/attempts', { method: 'POST', body: '{}' });
  assert.equal(existing.response.status, 201);
  const attemptHeaders = { 'X-Attempt-Token': existing.body.token };

  const unauthorized = await json('/api/admin/config/status', { method: 'PATCH', body: JSON.stringify({ active: false }) });
  assert.equal(unauthorized.response.status, 401);
  const login = await json('/api/admin/login', { method: 'POST', body: JSON.stringify({ username: 'admin', password: 'integration-test-password' }) });
  const adminHeaders = { Cookie: login.response.headers.get('set-cookie').split(';')[0] };
  const invalid = await json('/api/admin/config/status', { method: 'PATCH', headers: adminHeaders, body: JSON.stringify({ active: 0 }) });
  assert.equal(invalid.response.status, 400);
  const closed = await json('/api/admin/config/status', { method: 'PATCH', headers: adminHeaders, body: JSON.stringify({ active: false }) });
  assert.deepEqual(closed.body, { active: false });
  assert.deepEqual((await json('/api/assessment/status')).body, { active: false });

  const denied = await json('/api/attempts', { method: 'POST', body: '{}' });
  assert.equal(denied.response.status, 503);
  assert.equal(denied.body.error, '当前题目收集已满');
  const resumed = await json(`/api/attempts/${existing.body.id}`, { headers: attemptHeaders });
  assert.equal(resumed.response.status, 200);
  const standards = { '下班后的沉默': ['悲伤',4], '小组讨论': ['不耐烦',3], '没有说出口的话': ['失落',3], '迟到的祝福': ['愧疚',4], '重逢时刻': ['惊喜',5] };
  for (const question of resumed.body.questions) {
    const [emotion, strength] = standards[question.title];
    const saved = await json(`/api/attempts/${existing.body.id}/responses/${question.position}`, { method: 'PUT', headers: attemptHeaders, body: JSON.stringify({ emotion, strength }) });
    assert.equal(saved.response.status, 200);
  }
  const submitted = await json(`/api/attempts/${existing.body.id}/submit`, { method: 'POST', headers: attemptHeaders, body: '{}' });
  assert.equal(submitted.response.status, 200);

  const config = await json('/api/admin/config', { headers: adminHeaders });
  await json('/api/admin/config', { method: 'PUT', headers: adminHeaders, body: JSON.stringify({ combination_counts: config.body.combination_counts }) });
  assert.deepEqual((await json('/api/assessment/status')).body, { active: false });
  const reopened = await json('/api/admin/config/status', { method: 'PATCH', headers: adminHeaders, body: JSON.stringify({ active: true }) });
  assert.deepEqual(reopened.body, { active: true });
  assert.equal((await json('/api/attempts', { method: 'POST', body: '{}' })).response.status, 201);
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
  const sorted = await json('/api/admin/questions?sort=title_asc', { headers: { Cookie: cookie } });
  const titles = sorted.body.map(question => question.title);
  assert.deepEqual(titles, [...titles].sort());
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
  completedAttempt = { ...created.body };
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
  const review = await json(`/api/attempts/${created.body.id}/review`, { headers: auth });
  assert.equal(review.response.status, 200);
  assert.equal(review.body.length, 5);
  assert.ok(review.body.every(question => question.emotions.length && question.correct_emotions.length));
  assert.ok(review.body.every(question => Object.hasOwn(question, 'media_url')));
});

test('答卷明细CSV导出实际候选情绪、多选答案与对应强度', async () => {
  const login = await json('/api/admin/login', { method: 'POST', body: JSON.stringify({ username: 'admin', password: 'integration-test-password' }) });
  const adminHeaders = { Cookie: login.response.headers.get('set-cookie').split(';')[0] };
  const originalConfig = await json('/api/admin/config', { headers: adminHeaders });
  const createdQuestion = await json('/api/admin/questions', {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({ modality: 'text', option_type: 'multiple', question_type: 'recognition', points: 25, title: '多选导出验证', prompt: '选择两种情绪', options: ['快乐', '惊喜', '平静,又"特别"'], correct_emotions: ['快乐', '惊喜'], standard_strengths: [4, 5], difficulty: 'medium', published: true })
  });
  assert.equal(createdQuestion.response.status, 201);
  const combination_counts = Object.fromEntries(Object.keys(originalConfig.body.combination_counts).map(key => [key, 0]));
  combination_counts.text_multiple_recognition = 1;
  assert.equal((await json('/api/admin/config', { method: 'PUT', headers: adminHeaders, body: JSON.stringify({ combination_counts }) })).response.status, 200);

  const attempt = await json('/api/attempts', { method: 'POST', body: '{}' });
  const attemptHeaders = { 'X-Attempt-Token': attempt.body.token };
  const fetchedAttempt = await json(`/api/attempts/${attempt.body.id}`, { headers: attemptHeaders });
  assert.equal(fetchedAttempt.response.status, 200);
  const shownOptions = fetchedAttempt.body.questions[0].options;
  assert.equal(shownOptions.length, 10);
  assert.ok(shownOptions.includes('快乐'));
  assert.ok(shownOptions.includes('惊喜'));
  assert.ok(shownOptions.includes('平静,又"特别"'));
  const supplementedOptions = shownOptions.filter(option => !['快乐', '惊喜', '平静,又"特别"'].includes(option));
  assert.ok(supplementedOptions.length > 0);
  const saved = await json(`/api/attempts/${attempt.body.id}/responses/1`, { method: 'PUT', headers: attemptHeaders, body: JSON.stringify({ emotions: ['快乐', '惊喜'], strengths: [4, 5], watched_source: false, response_time_ms: 12500, modification_count: 2 }) });
  assert.equal(saved.response.status, 200);
  assert.equal((await json(`/api/attempts/${attempt.body.id}/submit`, { method: 'POST', headers: attemptHeaders, body: '{}' })).response.status, 200);

  const csv = await fetch(base + `/api/admin/attempts.csv?id=${attempt.body.id}`, { headers: adminHeaders });
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get('content-disposition'), /filename\*=UTF-8''zhijing-attempt-details-/);
  const csvBytes = new Uint8Array(await csv.arrayBuffer());
  assert.deepEqual([...csvBytes.slice(0, 3)], [0xef, 0xbb, 0xbf]);
  const csvText = new TextDecoder().decode(csvBytes);
  assert.match(csvText, /本题候选情绪/);
  assert.match(csvText, /用户选择情绪/);
  assert.match(csvText, /用户情绪强度/);
  assert.match(csvText, /作答用时（秒）/);
  assert.match(csvText, /"快乐｜惊喜"/);
  assert.match(csvText, /"4｜5"/);
  assert.match(csvText, /"多选题"/);
  assert.match(csvText, /"12\.50"/);
  for (const option of shownOptions) assert.ok(csvText.includes(option.replace(/"/g, '""')), `CSV 应包含实际呈现的候选情绪：${option}`);
  for (const option of supplementedOptions) assert.ok(csvText.includes(option.replace(/"/g, '""')), `CSV 应包含随机补充项：${option}`);
  assert.match(csvText, /平静,又""特别""/);

  assert.equal((await json('/api/admin/config', { method: 'PUT', headers: adminHeaders, body: JSON.stringify({ combination_counts: originalConfig.body.combination_counts }) })).response.status, 200);
  assert.equal((await json(`/api/admin/attempts/${attempt.body.id}`, { method: 'DELETE', headers: adminHeaders })).response.status, 200);
  assert.equal((await json(`/api/admin/questions/${createdQuestion.body.id}`, { method: 'DELETE', headers: adminHeaders })).response.status, 200);
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

test('抽题记录历史入卷次数并用于低频题加权', async () => {
  const login = await json('/api/admin/login', { method: 'POST', body: JSON.stringify({ username: 'admin', password: 'integration-test-password' }) });
  const headers = { Cookie: login.response.headers.get('set-cookie').split(';')[0] };
  const before = await json('/api/admin/questions', { headers });
  assert.ok(before.body.every(question => Number.isInteger(question.appearance_count)));
  const totalBefore = before.body.reduce((sum, question) => sum + question.appearance_count, 0);
  assert.equal((await json('/api/attempts', { method: 'POST', body: '{}' })).response.status, 201);
  const after = await json('/api/admin/questions', { headers });
  const totalAfter = after.body.reduce((sum, question) => sum + question.appearance_count, 0);
  assert.equal(totalAfter - totalBefore, 5);
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

test('题目支持保存多道双向冲突题', async () => {
  const login = await json('/api/admin/login', { method: 'POST', body: JSON.stringify({ username: 'admin', password: 'integration-test-password' }) });
  const headers = { Cookie: login.response.headers.get('set-cookie').split(';')[0] };
  const listed = await json('/api/admin/questions?sort=title_asc', { headers });
  const target = listed.body[0], conflicts = listed.body.slice(1, 3).map(question => question.code);
  const updated = await json(`/api/admin/questions/${target.id}`, { method: 'PUT', headers, body: JSON.stringify({ ...target, conflict_codes: conflicts }) });
  assert.equal(updated.response.status, 200);
  const refreshed = await json('/api/admin/questions', { headers });
  assert.deepEqual(refreshed.body.find(question => question.id === target.id).conflict_codes.sort(), [...conflicts].sort());
  assert.ok(refreshed.body.find(question => question.code === conflicts[0]).conflict_codes.includes(target.code));
  const invalid = await json(`/api/admin/questions/${target.id}`, { method: 'PUT', headers, body: JSON.stringify({ ...target, conflict_codes: ['ITEM-99999'] }) });
  assert.equal(invalid.response.status, 400);
});

test('数据分析仅汇总完成答卷并支持北京时间筛选和CSV', async () => {
  assert.equal((await json('/api/admin/analytics')).response.status, 401);
  const login = await json('/api/admin/login', { method: 'POST', body: JSON.stringify({ username: 'admin', password: 'integration-test-password' }) });
  const headers = { Cookie: login.response.headers.get('set-cookie').split(';')[0] };
  const before = await json('/api/admin/analytics?range=all', { headers });
  assert.ok(before.body.summary.completed >= 1);
  assert.equal(before.body.summary.average_score, 100);
  assert.equal(before.body.distribution.find(bin => bin.label === '90–100').count, before.body.summary.completed);
  assert.equal(before.body.questions.length, 5);
  assert.ok(before.body.questions.every(question => /^ITEM-\d{5}$/.test(question.question_code)));
  assert.ok(before.body.questions.every(question => question.sample_size >= 1 && question.low_sample === true));
  assert.equal(before.body.dimensions.question_types.find(item => item.key === 'recognition').score, 100);

  await json('/api/attempts', { method: 'POST', body: '{}' });
  const after = await json('/api/admin/analytics?range=all', { headers });
  assert.equal(after.body.summary.completed, before.body.summary.completed);
  const outside = await json('/api/admin/analytics?from=2000-01-01&to=2000-01-01', { headers });
  assert.equal(outside.body.summary.completed, 0);
  assert.deepEqual(outside.body.questions, []);

  const csv = await fetch(base + '/api/admin/analytics/questions.csv?range=all', { headers });
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get('content-type'), /text\/csv/);
  assert.match(csv.headers.get('content-disposition'), /filename\*=UTF-8''zhijing-question-analysis-/);
  const csvBytes = new Uint8Array(await csv.arrayBuffer());
  assert.deepEqual([...csvBytes.slice(0, 3)], [0xef, 0xbb, 0xbf]);
  const csvText = new TextDecoder().decode(csvBytes);
  assert.match(csvText, /完全识别正确率（%）/);
  assert.match(csvText, /平均用时（秒）/);
  assert.match(csvText, /"图像"|"文本"|"音频"|"视频"/);
  assert.match(csvText, /"情绪识别"/);
  assert.match(csvText, /"单选题"/);
  assert.match(csvText, /"100\.00"/);
  assert.match(csvText, /样本不足（少于10份）/);
  assert.doesNotMatch(csvText, /"image"|"recognition"|"single"/);
});

test('被试可逐题反馈且后台可接收并处理', async () => {
  const attemptHeaders = { 'X-Attempt-Token': completedAttempt.token };
  const created = await json(`/api/attempts/${completedAttempt.id}/questions/1/feedback`, { method: 'POST', headers: attemptHeaders, body: JSON.stringify({ content: '这道题的情景线索可能存在歧义。' }) });
  assert.equal(created.response.status, 200);
  assert.equal(created.body.status, 'pending');
  const invalid = await json(`/api/attempts/${completedAttempt.id}/questions/2/feedback`, { method: 'POST', headers: attemptHeaders, body: JSON.stringify({ content: '短' }) });
  assert.equal(invalid.response.status, 400);
  const review = await json(`/api/attempts/${completedAttempt.id}/review`, { headers: attemptHeaders });
  assert.equal(review.body[0].feedback, '这道题的情景线索可能存在歧义。');

  const login = await json('/api/admin/login', { method: 'POST', body: JSON.stringify({ username: 'admin', password: 'integration-test-password' }) });
  const adminHeaders = { Cookie: login.response.headers.get('set-cookie').split(';')[0] };
  const feedback = await json('/api/admin/question-feedback?status=pending', { headers: adminHeaders });
  assert.equal(feedback.body.length, 1);
  assert.equal(feedback.body[0].public_id, completedAttempt.id);
  const handled = await json(`/api/admin/question-feedback/${feedback.body[0].id}`, { method: 'PATCH', headers: adminHeaders, body: JSON.stringify({ status: 'handled' }) });
  assert.equal(handled.response.status, 200);
  const pending = await json('/api/admin/question-feedback?status=pending', { headers: adminHeaders });
  assert.deepEqual(pending.body, []);
});
