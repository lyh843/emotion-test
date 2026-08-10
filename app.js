const app = document.querySelector('#app');
const sessionKey = 'zhijing_attempt';
let current = null, questionIndex = 0, changes = 0;
let timedQuestionPosition = null, activeElapsedMs = 0, activeSince = null;
const icons = { image: '▧', text: '文', audio: '◉', video: '▶' };

function canTrackTime() { return document.visibilityState === 'visible' && document.hasFocus(); }
function resumeTiming() { if (timedQuestionPosition !== null && activeSince === null && canTrackTime()) activeSince = Date.now(); }
function pauseTiming() { if (activeSince !== null) { activeElapsedMs += Math.max(0, Date.now() - activeSince); activeSince = null; } }
function beginQuestionTiming(position) {
  if (timedQuestionPosition !== position) {
    pauseTiming();
    timedQuestionPosition = position;
    activeElapsedMs = 0;
    changes = 0;
  }
  resumeTiming();
}
function currentElapsedMs() { return Math.round(activeElapsedMs + (activeSince === null ? 0 : Math.max(0, Date.now() - activeSince))); }
function finishQuestionTiming() { pauseTiming(); timedQuestionPosition = null; activeElapsedMs = 0; activeSince = null; changes = 0; }
document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' ? pauseTiming() : resumeTiming());
window.addEventListener('blur', pauseTiming);
window.addEventListener('focus', resumeTiming);

async function api(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', ...(current ? { 'X-Attempt-Token': current.token } : {}), ...(options.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Error(data.error || '请求失败');
  return data;
}
function toast(message) { const node = document.querySelector('#toast'); node.textContent = message; node.classList.add('show'); setTimeout(() => node.classList.remove('show'), 2400); }
function header() { return `<header class="topbar"><a class="brand" href="#home"><span class="brand-mark">知</span><span><b>知境</b><small>多模态情绪感知测评</small></span></a><nav class="topnav"><a href="#about">测评说明</a><a href="/admin">管理后台</a>${current ? `<span class="user"><span>匿</span>${current.id.slice(-8)}</span>` : ''}</nav></header>`; }

function home() {
  app.innerHTML = header() + `<main class="content"><section class="hero"><div><div class="eyebrow">EMOTION PERCEPTION LAB</div><h1>从多模态线索，<br>理解情绪的<em>细微差别</em></h1><p>通过图像、文本、语音与视频情境，评估情绪识别和情绪推理能力。全程匿名，完成后即时获得分项反馈。</p><div class="actions"><button class="btn primary" id="start">${current ? '继续测评' : '开始匿名测评'} →</button><a class="btn" href="#about">了解作答方式</a></div><div class="trust-row"><span>✓ 匿名参与</span><span>✓ 即时报告</span><span>✓ 多模态题目</span></div></div><div class="hero-art"><div class="signal-card main-signal"><small>当前测评维度</small><strong>情绪感知</strong><div class="signal-wave"><i></i><i></i><i></i><i></i><i></i><i></i></div></div><span class="float-tag t1">图像 · 表情线索</span><span class="float-tag t2">语音 · 语调变化</span><span class="float-tag t3">文本 · 情境推理</span></div></section><div class="stats"><div class="stat"><small>能力维度</small><b>2</b><small>情绪识别与推理</small></div><div class="stat"><small>选项形式</small><b>单选 / 多选</b><small>适配复杂情绪场景</small></div><div class="stat"><small>素材模态</small><b>4</b><small>图文音视频融合</small></div><div class="stat"><small>隐私方式</small><b>匿名</b><small>不采集身份信息</small></div></div></main>`;
  document.querySelector('#start').onclick = start;
}
function about() {
  app.innerHTML = header() + `<main class="content"><div class="page-head"><div><span class="eyebrow">BEFORE YOU START</span><h1>测评说明</h1><p>预计数分钟，请在安静环境中独立完成</p></div></div><div class="guide-grid"><div class="card guide-card"><b>01</b><h3>观察完整情境</h3><p>结合人物表情、动作、措辞、语调和前后情境，不依赖单一线索。</p></div><div class="card guide-card"><b>02</b><h3>选择情绪并标注强度</h3><p>单选题选择一种情绪；多选题可选择多种，并分别判断 1–5 级强度。</p></div><div class="card guide-card"><b>03</b><h3>补充观看经历</h3><p>影视素材题请如实选择是否看过来源作品，这不会直接影响得分。</p></div><div class="card guide-card"><b>04</b><h3>提交并查看报告</h3><p>系统按题目分值综合计算标签识别与强度判断表现。</p></div></div><div class="card privacy-card"><div><h3>隐私与用途</h3><p>系统生成随机匿名编号，不收集姓名、手机号或学号。结果仅供个人成长和研究参考，不构成医学或心理诊断。</p></div><button class="btn primary" id="aboutStart">我已了解，开始测评</button></div></main>`;
  document.querySelector('#aboutStart').onclick = start;
}
async function start() {
  try {
    if (current) { const attempt = await api(`/api/attempts/${current.id}`); if (attempt.status === 'completed') return void (location.hash = 'report'); current.data = attempt; }
    else { current = await api('/api/attempts', { method: 'POST', body: '{}' }); localStorage.setItem(sessionKey, JSON.stringify(current)); current.data = await api(`/api/attempts/${current.id}`); }
    questionIndex = Math.max(0, current.data.questions.findIndex(q => !q.emotions?.length && !q.skipped)); location.hash = 'assessment';
  } catch (error) { toast(error.message); }
}
function media(q) {
  if (q.media_url) {
    if (q.modality === 'image') return `<div class="media-frame image-frame"><img class="question-media" src="${q.media_url}" alt="题目素材"></div>`;
    if (q.modality === 'audio') return `<audio class="question-audio" controls src="${q.media_url}"></audio>`;
    if (q.modality === 'video') return `<div class="media-frame video-frame"><video class="question-media" controls preload="metadata" src="${q.media_url}"></video></div>`;
  }
  return `<div class="placeholder-media"><span>${icons[q.modality]}</span><small>本题暂无外部素材，请根据情境文字作答</small></div>`;
}
function strengthScale(emotion, value = 3) {
  return `<div class="strength-item" data-for="${emotion}"><div class="strength-head"><span>${emotion}</span><b>${value}</b></div><div class="scale-wrap"><input class="strength-input" data-emotion="${emotion}" type="range" min="1" max="5" step="1" value="${value}"><div class="scale-labels"><span>1</span><span>2</span><span>3</span><span>4</span><span>5</span></div><div class="scale-ends"><small>轻微</small><small>强烈</small></div></div></div>`;
}
function assessment() {
  if (!current?.data) return start();
  const q = current.data.questions[questionIndex]; q.emotions ||= []; q.strengths ||= [];
  beginQuestionTiming(q.position);
  const isMultiple = q.option_type === 'multiple';
  app.innerHTML = header() + `<main class="assessment-wrap"><div class="assessment-meta"><div><span class="question-kicker">${q.question_type === 'reasoning' ? '情绪推理' : '情绪识别'} · ${isMultiple ? '多选题' : '单选题'} · ${q.points} 分</span><h1>${q.title}</h1></div><span class="autosave">● 切题时自动保存</span></div><div class="progress-row"><div class="progress"><div style="width:${(questionIndex + 1) / current.data.questions.length * 100}%"></div></div><b>${String(questionIndex + 1).padStart(2, '0')} / ${String(current.data.questions.length).padStart(2, '0')}</b></div><article class="card question"><div class="question-type"><span>${icons[q.modality]} ${{ image: '图像', text: '文本', audio: '语音', video: '视频' }[q.modality]}素材</span><span>${isMultiple ? '可选 1–5 项' : '请选择 1 项'}</span></div><div class="stimulus"><div class="scene">${media(q)}<blockquote>${q.context}</blockquote><strong>${q.prompt}</strong></div></div><div class="answer-layout"><section class="answer-box"><div class="answer-title"><div><small>STEP 1</small><h3>选择情绪</h3></div><span>${isMultiple ? `已选 ${q.emotions.length}/5` : '单选'}</span></div><div class="emotions">${q.options.map(e => `<button class="emotion ${q.emotions.includes(e) ? 'selected' : ''}" data-emotion="${e}"><i></i>${e}</button>`).join('')}</div></section><section class="answer-box"><div class="answer-title"><div><small>STEP 2</small><h3>标注情绪强度</h3></div><span>1–5 级</span></div><div id="strengthList">${q.emotions.length ? q.emotions.map((e, i) => strengthScale(e, q.strengths[i] || 3)).join('') : '<div class="strength-empty">选择情绪后，在此分别标注强度</div>'}</div></section></div><div class="watched-row"><div><b>你是否看过该影视作品？</b><small>此信息仅用于分析素材熟悉度，不影响得分</small></div><div class="segmented"><button data-watched="true" class="${q.watched_source === 1 || q.watched_source === true ? 'active' : ''}">看过</button><button data-watched="false" class="${q.watched_source === 0 || q.watched_source === false ? 'active' : ''}">没看过</button></div></div><div class="question-actions"><button class="btn" id="previous" ${questionIndex === 0 ? 'disabled' : ''}>← 上一题</button><div><button class="btn ghost" id="skip">暂时跳过</button><button class="btn primary" id="next">${questionIndex === current.data.questions.length - 1 ? '提交测评' : '保存并下一题 →'}</button></div></div></article></main>`;
  document.querySelectorAll('[data-emotion]').forEach(button => button.onclick = () => { const e = button.dataset.emotion, index = q.emotions.indexOf(e); if (isMultiple) { if (index >= 0) { q.emotions.splice(index, 1); q.strengths.splice(index, 1); } else if (q.emotions.length < 5) { q.emotions.push(e); q.strengths.push(3); } else return toast('多选题最多选择 5 个情绪'); } else { q.emotions = [e]; q.strengths = [3]; } q.skipped = 0; changes++; assessment(); });
  document.querySelectorAll('.strength-input').forEach(input => input.oninput = () => { const i = q.emotions.indexOf(input.dataset.emotion); q.strengths[i] = +input.value; input.closest('.strength-item').querySelector('.strength-head b').textContent = input.value; changes++; });
  document.querySelectorAll('[data-watched]').forEach(button => button.onclick = () => { q.watched_source = button.dataset.watched === 'true'; changes++; assessment(); });
  document.querySelector('#skip').onclick = () => save(true, 1); document.querySelector('#next').onclick = () => save(false, 1); document.querySelector('#previous').onclick = () => save(false, -1);
}
async function save(skipped, direction) {
  const q = current.data.questions[questionIndex]; if (!skipped && !q.emotions.length) return toast('请至少选择一个情绪');
  const responseTime = (q.response_time_ms || 0) + currentElapsedMs();
  const modificationCount = (q.modification_count || 0) + changes;
  try { await api(`/api/attempts/${current.id}/responses/${q.position}`, { method: 'PUT', body: JSON.stringify({ emotions: q.emotions, strengths: q.strengths, watched_source: q.watched_source, skipped, response_time_ms: responseTime, modification_count: modificationCount }) }); q.response_time_ms = responseTime; q.modification_count = modificationCount; q.skipped = skipped ? 1 : 0; finishQuestionTiming(); if (direction < 0) questionIndex--; else if (questionIndex < current.data.questions.length - 1) questionIndex++; else return submit(); assessment(); } catch (error) { toast(error.message); }
}
async function submit() { try { await api(`/api/attempts/${current.id}/submit`, { method: 'POST', body: '{}' }); current.data.status = 'completed'; location.hash = 'report'; } catch (error) { toast(error.message); } }
function scoreClass(n) { return n >= 85 ? '优秀' : n >= 70 ? '良好' : n >= 60 ? '尚可' : '需提升'; }
async function report() { if (!current) return home(); try { const r = await api(`/api/attempts/${current.id}/report`), modes = { image: '图像', text: '文本', audio: '语音', video: '视频' }; app.innerHTML = header() + `<main class="content report-page"><div class="page-head"><div><span class="eyebrow">ASSESSMENT REPORT</span><h1>你的情绪感知报告</h1><p>匿名编号 ${current.id}</p></div><button class="btn" onclick="window.print()">打印 / 保存 PDF</button></div><div class="report-hero card"><div><small>综合得分</small><strong>${r.overall}</strong><span>/ 100 · ${scoreClass(r.overall)}</span></div><p>${r.overall >= 85 ? '你能够稳定整合多种线索，对复杂情境中的情绪变化保持敏锐。' : r.overall >= 70 ? '你具备良好的情绪感知基础，大多数情境中能够找到关键线索。' : '你已具备基础识别能力，可通过关注语调、动作和上下文继续提升。'}</p></div><div class="grid"><div class="card span6"><h3>能力分项</h3><div class="score-pair"><div><small>标签识别</small><b>${r.label}</b></div><div><small>强度判断</small><b>${r.strength}</b></div></div></div><div class="card span6"><h3>各模态表现</h3><div class="bars">${Object.entries(r.by_modality).map(([k, v]) => `<div class="bar"><span>${modes[k]}</span><div class="track"><div class="fill" style="width:${v}%"></div></div><b>${v}</b></div>`).join('')}</div></div><div class="card span12"><h3>下一步建议</h3><div class="advice-grid"><p>观察互动时同时留意表情、措辞、语调和身体姿态。</p><p>面对含蓄表达，结合前后情境推测没有直接说出的感受。</p><p>完成判断后尝试寻找另一种解释，减少先入为主。</p></div><button class="btn primary" id="newAttempt">开始新的测评</button></div></div></main>`; document.querySelector('#newAttempt').onclick = () => { localStorage.removeItem(sessionKey); current = null; location.hash = 'home'; }; } catch (error) { toast(error.message); location.hash = 'home'; } }
function route() { ({ home, about, assessment, report }[location.hash.slice(1) || 'home'] || home)(); }
try { current = JSON.parse(localStorage.getItem(sessionKey)); } catch {}
window.addEventListener('hashchange', route); route();
