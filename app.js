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
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])); }
function header() { return `<header class="topbar"><a class="brand" href="#home"><span class="brand-mark">知</span><span><b>知境</b><small>多模态情绪感知测评</small></span></a><nav class="topnav"><a href="#about">测评说明</a><a href="/admin">管理后台</a>${current ? `<span class="user"><span>匿</span>${current.id.slice(-8)}</span>` : ''}</nav></header>`; }

function home() {
  app.innerHTML = header() + `<main class="content"><section class="hero"><div><div class="eyebrow">EMOTION PERCEPTION LAB</div><h1>从多模态线索，<br>理解情绪的<em>细微差别</em></h1><p>通过图像、文本、语音与视频情境，评估情绪识别和情绪推理能力。全程匿名，完成后即时获得分项反馈。</p><div class="actions"><button class="btn primary" id="start">${current ? '继续测评' : '开始匿名测评'} →</button><a class="btn" href="#about">了解作答方式</a></div><div class="trust-row"><span>✓ 匿名参与</span><span>✓ 即时报告</span><span>✓ 多模态题目</span></div></div><div class="hero-art"><div class="signal-card main-signal"><small>当前测评维度</small><strong>情绪感知</strong><div class="signal-wave"><i></i><i></i><i></i><i></i><i></i><i></i></div></div><span class="float-tag t1">图像 · 表情线索</span><span class="float-tag t2">语音 · 语调变化</span><span class="float-tag t3">文本 · 情境推理</span></div></section><div class="stats"><div class="stat"><small>能力维度</small><b>2</b><small>情绪识别与推理</small></div><div class="stat"><small>选项形式</small><b>单选 / 多选</b><small>适配复杂情绪场景</small></div><div class="stat"><small>素材模态</small><b>4</b><small>图文音视频融合</small></div><div class="stat"><small>隐私方式</small><b>匿名</b><small>不采集身份信息</small></div></div></main>`;
  document.querySelector('#start').onclick = start;
}
function about() {
  app.innerHTML = header() + `<main class="content guide-page"><div class="page-head guide-head"><div><span class="eyebrow">BEFORE YOU START</span><h1>测评说明</h1><p>请先完整阅读以下说明，了解测评目的、题目形式和作答方法后再开始</p></div></div><section class="card guide-intro"><div><span class="guide-chip">多模态 · 情境化 · 匿名</span><h2>这是一项怎样的测评？</h2><p>本测评关注你在日常社交情境中感知他人情绪的表现。题目使用图像、文本、语音和视频等生活化材料，要求你综合人物的面部表情、身体动作、说话内容、语气语调及前后情境，判断人物可能正在经历的情绪。</p><p>测评包含两个相互关联的能力方向：<b>情绪识别</b>是根据人物已经表现出来的线索判断其当前情绪；<b>情绪推理</b>是在互动关系和事件背景中，推断人物可能产生或即将产生的情绪反应。它考查的是具体题目中的判断表现，不是性格测试，也不用于医学或心理诊断。</p></div><div class="guide-summary"><div><b>4</b><span>图像、文本、语音、视频</span></div><div><b>2</b><span>情绪识别与情绪推理</span></div><div><b>1–5</b><span>情绪表现强度等级</span></div></div></section><section class="guide-section"><div class="section-copy"><span class="eyebrow">WHAT YOU WILL SEE</span><h2>你会遇到哪些题目？</h2><p>不同题目提供的线索不同。请以当前页面实际呈现的全部信息为准，不要只依赖某一个显眼线索。</p></div><div class="material-grid"><div class="card material-card"><i>▧</i><h3>图像题</h3><p>观察表情、目光、姿态、人物距离和场景信息，留意细微但一致的情绪线索。</p></div><div class="card material-card"><i>文</i><h3>文本题</h3><p>阅读对话与背景，结合措辞、停顿描述、言外之意和事件前因后果进行判断。</p></div><div class="card material-card"><i>♪</i><h3>语音题</h3><p>建议佩戴耳机，关注音量、语速、音高、停顿和语气变化，可在作答前充分听取素材。</p></div><div class="card material-card"><i>▶</i><h3>视频题</h3><p>完整观看人物互动和情绪变化过程，综合画面、动作、语言及时间顺序作答。</p></div></div></section><section class="guide-section"><div class="section-copy"><span class="eyebrow">HOW TO ANSWER</span><h2>每道题应该如何作答？</h2></div><div class="steps-list"><div class="card guide-step"><b>01</b><div><h3>完整阅读问题并确认目标人物</h3><p>先确认题目询问的是谁、哪个时刻以及需要进行情绪识别还是情绪推理。多人场景中不要把其他人物的情绪当作目标答案。</p></div></div><div class="card guide-step"><b>02</b><div><h3>完整查看素材和情景内容</h3><p>结合所有可用线索形成整体判断。音频和视频题请先完成播放；如题目提供情景内容，也应一并阅读。</p></div></div><div class="card guide-step"><b>03</b><div><h3>选择情绪词</h3><p><b>单选题</b>选择一个你认为最合适的情绪词；<b>多选题</b>选择你认为确实同时存在的全部情绪。不要为了“多选”而勉强增加缺乏线索的选项。</p></div></div><div class="card guide-step"><b>04</b><div><h3>分别判断情绪强度</h3><p>每个已选情绪都需要单独标注 1–5 级强度。强度表示该情绪在当前素材中的表现程度，而不是你本人看到素材后的感受。</p></div></div><div class="card guide-step"><b>05</b><div><h3>检查并保存作答</h3><p>确认情绪词和强度均已填写后进入下一题。系统会自动保存，你可以返回上一题检查或修改；最终提交前必须完成全部题目。</p></div></div></div></section><section class="guide-section guide-two"><div class="card strength-guide"><span class="eyebrow">INTENSITY SCALE</span><h2>如何理解 1–5 级强度？</h2><div class="scale-guide"><div><b>1</b><span>非常轻微</span><small>仅有隐约线索，情绪表现不明显</small></div><div><b>2</b><span>较弱</span><small>能够察觉，但表达仍较克制</small></div><div><b>3</b><span>中等</span><small>情绪清楚可辨，程度适中</small></div><div><b>4</b><span>较强</span><small>有明显且持续的表达线索</small></div><div><b>5</b><span>非常强烈</span><small>情绪高度突出，占据主要表现</small></div></div><p class="guide-note">请判断素材中人物实际展现的程度。情绪词选得合适但强度与素材差异较大，仍会影响该题表现。</p></div><div class="card answer-principles"><span class="eyebrow">ANSWERING PRINCIPLES</span><h2>作答时请注意</h2><ul><li>请根据第一手观察独立完成，不与他人讨论，也不要搜索素材来源或标准答案。</li><li>没有要求你猜测“研究者想要的答案”；请依据当前情境作出最符合你判断的选择。</li><li>不要仅凭单一表情判断。真实情绪可能由表情、语言、动作和情境共同呈现。</li><li>如果看过某段影视或视频素材，请如实填写观看经历；该信息用于辅助分析，不直接决定得分。</li><li>请认真作答，但不必在一道题上过度停留。无法完全确定时，选择证据最充分的答案。</li></ul></div></section><section class="card before-check"><div><span class="eyebrow">READY CHECK</span><h2>开始前的准备</h2></div><div class="check-grid"><p>✓ 选择安静、光线适宜且网络稳定的环境</p><p>✓ 语音和视频题建议使用耳机并调至舒适音量</p><p>✓ 预留连续时间，尽量不要中途切换页面或处理其他事务</p><p>✓ 使用较新的浏览器，手机端建议保持屏幕常亮</p></div></section><section class="card result-explain"><div><h2>计分、报告与隐私说明</h2><p>每道题同时考虑情绪标签判断和情绪强度判断，并结合题目登记分值形成综合结果。完成后可查看总体得分率、情绪识别与推理、不同素材模态以及标签和强度等分项表现。报告只解释本次作答数据；题量较少的维度应谨慎理解，不代表稳定能力、常模排名或人群比较。</p><p>系统以随机匿名编号保存答卷，不主动收集姓名、手机号或学号。作答选择、强度、用时和修改次数可能用于题目质量与研究分析。请勿在任何文本输入位置填写可识别个人身份的信息。</p></div><div class="result-warning"><b>重要提醒</b><span>本测评及其智能反馈仅供研究和个人成长参考，不构成心理咨询、疾病筛查、医学诊断或任何重要选拔决定。</span></div></section><div class="guide-start"><label><input type="checkbox" id="guideConfirm"> 我已阅读并理解测评目的、作答方法、计分与隐私说明</label><button class="btn primary" id="aboutStart" disabled>我已了解，开始测评 →</button></div></main>`;
  document.querySelector('#guideConfirm').onchange = event => { document.querySelector('#aboutStart').disabled = !event.target.checked; };
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
  const isLast = questionIndex === current.data.questions.length - 1;
  app.innerHTML = header() + `<main class="assessment-wrap"><div class="assessment-meta"><div><span class="question-kicker">${q.question_type === 'reasoning' ? '情绪推理' : '情绪识别'} · ${isMultiple ? '多选题' : '单选题'} · ${q.points} 分</span><h1>${q.title}</h1></div><span class="autosave">● 切题时自动保存</span></div><div class="progress-row"><div class="progress"><div style="width:${(questionIndex + 1) / current.data.questions.length * 100}%"></div></div><b>${String(questionIndex + 1).padStart(2, '0')} / ${String(current.data.questions.length).padStart(2, '0')}</b></div><article class="card question"><div class="question-type"><span>${icons[q.modality]} ${{ image: '图像', text: '文本', audio: '语音', video: '视频' }[q.modality]}素材</span><span>${isMultiple ? '可选 1–5 项' : '请选择 1 项'}</span></div><div class="stimulus"><div class="scene">${media(q)}<blockquote>${q.context}</blockquote><strong>${q.prompt}</strong></div></div><div class="answer-layout"><section class="answer-box"><div class="answer-title"><div><small>STEP 1</small><h3>选择情绪（${isMultiple ? '多选' : '单选'}）</h3></div><span class="choice-badge">${isMultiple ? `已选 ${q.emotions.length} / 5` : '仅选 1 项'}</span></div><div class="emotions">${q.options.map(e => `<button class="emotion ${q.emotions.includes(e) ? 'selected' : ''}" data-emotion="${e}"><i></i>${e}</button>`).join('')}</div></section><section class="answer-box"><div class="answer-title"><div><small>STEP 2</small><h3>标注情绪强度</h3></div><span>1–5 级</span></div><div id="strengthList">${q.emotions.length ? q.emotions.map((e, i) => strengthScale(e, q.strengths[i] || 3)).join('') : '<div class="strength-empty">选择情绪后，在此分别标注强度</div>'}</div></section></div><div class="watched-row"><div><b>你是否看过该影视作品？</b><small>此信息仅用于分析素材熟悉度，不影响得分</small></div><div class="segmented"><button data-watched="true" class="${q.watched_source === 1 || q.watched_source === true ? 'active' : ''}">看过</button><button data-watched="false" class="${q.watched_source === 0 || q.watched_source === false ? 'active' : ''}">没看过</button></div></div><div class="question-actions"><button class="btn" id="previous" ${questionIndex === 0 ? 'disabled' : ''}>← 上一题</button><div><button class="btn ghost" id="skip" ${isLast ? 'disabled title="最后一题必须作答"' : ''}>${isLast ? '最后一题不可跳过' : '暂时跳过'}</button><button class="btn primary" id="next">${questionIndex === current.data.questions.length - 1 ? '提交测评' : '保存并下一题 →'}</button></div></div></article></main>`;
  document.querySelectorAll('.emotion[data-emotion]').forEach(button => button.onclick = () => { const e = button.dataset.emotion, index = q.emotions.indexOf(e); if (isMultiple) { if (index >= 0) { q.emotions.splice(index, 1); q.strengths.splice(index, 1); } else if (q.emotions.length < 5) { q.emotions.push(e); q.strengths.push(3); } else return toast('多选题最多选择 5 个情绪'); } else if (index < 0) { q.emotions = [e]; q.strengths = [3]; } q.skipped = 0; changes++; assessment(); });
  document.querySelectorAll('.strength-input').forEach(input => input.oninput = () => { const i = q.emotions.indexOf(input.dataset.emotion); q.strengths[i] = +input.value; input.closest('.strength-item').querySelector('.strength-head b').textContent = input.value; changes++; });
  document.querySelectorAll('[data-watched]').forEach(button => button.onclick = () => { q.watched_source = button.dataset.watched === 'true'; changes++; assessment(); });
  document.querySelector('#skip').onclick = () => { if (!isLast) save(true, 1); }; document.querySelector('#next').onclick = () => save(false, 1); document.querySelector('#previous').onclick = () => save(!q.emotions.length, -1);
}
async function save(skipped, direction) {
  const q = current.data.questions[questionIndex]; if (!skipped && !q.emotions.length) return toast('请至少选择一个情绪');
  const responseTime = (q.response_time_ms || 0) + currentElapsedMs();
  const modificationCount = (q.modification_count || 0) + changes;
  try { await api(`/api/attempts/${current.id}/responses/${q.position}`, { method: 'PUT', body: JSON.stringify({ emotions: q.emotions, strengths: q.strengths, watched_source: q.watched_source, skipped, response_time_ms: responseTime, modification_count: modificationCount }) }); q.response_time_ms = responseTime; q.modification_count = modificationCount; q.skipped = skipped ? 1 : 0; finishQuestionTiming(); if (direction < 0) questionIndex--; else if (questionIndex < current.data.questions.length - 1) questionIndex++; else return submit(); assessment(); } catch (error) { toast(error.message); }
}
async function submit() {
  const missing = current.data.questions.filter(question => question.skipped || !question.emotions?.length).map(question => question.position);
  if (missing.length) {
    toast(`第 ${missing.join('、')} 题还没有作答，请完成全部题目后提交`);
    questionIndex = current.data.questions.findIndex(question => question.position === missing[0]);
    assessment();
    return;
  }
  try { await api(`/api/attempts/${current.id}/submit`, { method: 'POST', body: '{}' }); current.data.status = 'completed'; location.hash = 'report'; } catch (error) { toast(error.message); }
}
function scoreClass(n) { return n >= 85 ? '优秀' : n >= 70 ? '良好' : n >= 60 ? '尚可' : '需提升'; }
function radarChart(report) {
  const axes = [['image', '图像'], ['text', '文本'], ['audio', '音频'], ['video', '视频']], cx = 150, cy = 140, radius = 92;
  const point = (index, scale) => { const angle = -Math.PI / 2 + index * Math.PI / 2; return `${(cx + Math.cos(angle) * radius * scale).toFixed(1)},${(cy + Math.sin(angle) * radius * scale).toFixed(1)}`; };
  const grids = [.25, .5, .75, 1].map(scale => `<polygon points="${axes.map((_, i) => point(i, scale)).join(' ')}"></polygon>`).join('');
  const values = axes.map(([key]) => Math.max(0, Math.min(100, report.by_modality?.[key] ?? 0)) / 100);
  const labels = axes.map(([key, label], i) => { const [x, y] = point(i, 1.28).split(','); const n = report.sample_sizes?.modalities?.[key] || 0; return `<text x="${x}" y="${y}" text-anchor="middle">${label} ${report.by_modality?.[key] ?? '—'}${n ? `% · n=${n}` : ''}</text>`; }).join('');
  return `<svg class="profile-radar" viewBox="0 0 300 280" role="img" aria-label="各素材模态加权得分率雷达图"><g class="radar-grid">${grids}${axes.map((_, i) => `<line x1="${cx}" y1="${cy}" x2="${point(i, 1).replace(',', '" y2="')}"></line>`).join('')}</g><polygon class="radar-area" points="${values.map((value, i) => point(i, value)).join(' ')}"></polygon><g class="radar-labels">${labels}</g></svg>`;
}
function metricRow(label, value, count, detail = '') { const width = typeof value === 'number' ? value : 0; return `<div class="metric-row"><div><b>${label}</b><span>${typeof value === 'number' ? `${value}%` : '样本不足'}${count != null ? ` · n=${count}` : ''}</span></div><div class="metric-track"><i style="width:${width}%"></i></div>${detail ? `<small>${detail}</small>` : ''}</div>`; }
function bindFeedback() {
  const button = document.querySelector('#generateFeedback'), select = document.querySelector('#feedbackStyle'), overview = document.querySelector('#feedbackOverview'), recommendations = document.querySelector('#feedbackRecommendations');
  if (!button || !select || !overview || !recommendations) return;
  button.onclick = async () => {
    button.disabled = true; button.textContent = '正在生成…';
    try {
      const feedback = await api(`/api/attempts/${current.id}/feedback`, { method: 'POST', body: JSON.stringify({ style: select.value }) });
      overview.textContent = feedback.overview;
      recommendations.textContent = feedback.recommendations;
      document.querySelector('#feedbackSource').textContent = feedback.source === 'model' ? '由大语言模型生成' : '本地规则反馈';
      if (feedback.warning) toast(feedback.warning);
    } catch (error) { toast(error.message); }
    finally { button.disabled = false; button.textContent = '生成完整报告'; }
  };
}
async function report() {
  if (!current) return home();
  try {
    const r = await api(`/api/attempts/${current.id}/report`);
    const typeCounts = r.sample_sizes?.question_types || {}, cached = r.feedback_cache?.warm?.version === 2 ? r.feedback_cache.warm : null;
    const overview = escapeHtml(cached?.overview || '选择反馈风格并生成报告后，这里将结合综合得分、能力结构、素材模态和样本题量，对本次整体表现进行解释。');
    const recommendations = escapeHtml(cached?.recommendations || '系统会根据相对优势与薄弱维度提供下一步练习建议，模型生成内容总计不超过 500 字。');
    const recognitionRows = metricRow('情绪识别', r.by_question_type?.recognition, typeCounts.recognition || 0, '按识别类题目的分值加权') + metricRow('情绪推理', r.by_question_type?.reasoning, typeCounts.reasoning || 0, '按推理类题目的分值加权') + metricRow('标签识别', r.recognition_details?.label, typeCounts.recognition || 0, '情绪识别能力子项') + metricRow('强度判断', r.recognition_details?.strength, typeCounts.recognition || 0, '情绪识别能力子项');
    app.innerHTML = header() + `<main class="content report-page"><div class="page-head"><div><span class="eyebrow">ASSESSMENT REPORT</span><h1>你的情绪感知报告</h1><p>匿名编号 ${current.id} · 共 ${r.sample_sizes?.total || 0} 题</p></div><button class="btn" onclick="window.print()">打印 / 保存 PDF</button></div><div class="report-hero card"><div><small>综合得分率</small><div class="overall-line"><strong>${r.overall}</strong><span>/100</span></div><em>${scoreClass(r.overall)} · ${r.earned_points ?? '—'} / ${r.max_points ?? '—'} 分</em></div><div class="report-method"><b>计分说明</b><p>综合得分率及各维度均按题目分值加权。图中 n 表示该维度包含的题目数；当 n 较小时，结果仅描述本次答题表现，不代表稳定能力或常模排名。</p><span>平均有效作答时间 ${((r.average_response_ms || 0) / 1000).toFixed(1)} 秒/题</span></div></div><div class="grid"><div class="card span7 chart-card"><div class="chart-title"><div><h3>多模态表现轮廓</h3><small>四轴雷达图 · 得分率 0–100%</small></div></div>${radarChart(r)}</div><div class="card span5 chart-card"><div class="chart-title"><div><h3>能力结构</h3><small>加权得分率与样本题数</small></div></div><div class="metric-list">${recognitionRows}</div></div><div class="card span12 feedback-card"><div class="feedback-head"><div><h3>AI 个性化报告</h3><small id="feedbackSource">${cached?.source === 'model' ? '由大语言模型生成' : '选择风格后生成'}</small></div><div class="feedback-tools"><select id="feedbackStyle"><option value="warm">温暖鼓励</option><option value="professional">专业分析</option><option value="concise">简洁直接</option></select><button class="btn primary" id="generateFeedback">生成完整报告</button></div></div><section class="narrative-block"><h4>整体表现解读</h4><p id="feedbackOverview">${overview}</p></section><section class="narrative-block advice"><h4>下一步建议</h4><p id="feedbackRecommendations">${recommendations}</p></section><div class="report-actions"><small>报告仅用于个人成长参考，不构成医学或心理诊断；没有常模时不提供百分位或人群比较。</small><button class="btn" id="newAttempt">开始新的测评</button></div></div></div></main>`;
    bindFeedback();
    document.querySelector('#newAttempt').onclick = () => { localStorage.removeItem(sessionKey); current = null; location.hash = 'home'; };
  } catch (error) { toast(error.message); location.hash = 'home'; }
}
function route() { ({ home, about, assessment, report }[location.hash.slice(1) || 'home'] || home)(); }
try { current = JSON.parse(localStorage.getItem(sessionKey)); } catch {}
window.addEventListener('hashchange', route); route();
