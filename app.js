const app = document.querySelector('#app');
const testCode = new URLSearchParams(location.search).get('test')?.trim().toUpperCase() || 'DEFAULT';
const participationKey = 'zhijing_participating_test';
const sessionKey = `zhijing_attempt_${testCode}`;
const submissionKey = `zhijing_submission_${testCode}`;
const consentKey = 'zhijing_informed_consent_v2';
let current = null, questionIndex = 0, changes = 0, collectionActive = null;
let lockedTestCode = localStorage.getItem(participationKey), testAccessBlocked = false;
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
function fixed(value) { return value == null || value === '' || !Number.isFinite(Number(value)) ? '—' : Number(value).toFixed(2); }
function header() { return `<header class="topbar"><a class="brand" href="#home"><span class="brand-mark">知</span><span><b>知境</b><small>多模态情绪感知测评</small></span></a><nav class="topnav"><a href="#about">测评说明</a><a href="/admin">管理后台</a>${current ? `<span class="user"><span>匿</span>${current.id.slice(-8)}</span>` : ''}</nav></header>`; }
function showInformedConsent() {
  if (localStorage.getItem(consentKey) === 'accepted') return;
  document.body.classList.add('consent-open');
  document.body.insertAdjacentHTML('beforeend', `<div class="consent-backdrop" id="informedConsent"><section class="consent-dialog" role="dialog" aria-modal="true" aria-labelledby="consentTitle"><header><span class="eyebrow">INFORMED CONSENT</span><h1 id="consentTitle">情绪感知能力测验知情同意书</h1><p>尊敬的参与者：您好！感谢您考虑参加“情绪感知能力测验”。在决定是否参加前，请仔细阅读以下内容。如对测验内容、数据使用方式或其他事项存在疑问，可在参加前通过文末联系方式咨询。是否参加完全由您自主决定。</p></header><div class="consent-content">
    <section><h2>一、测验名称</h2><p>情绪感知能力测验</p></section>
    <section><h2>二、测验目的</h2><p>本项目为团队开发的情绪感知能力测验项目，用于参加2026年第二届“厚粲杯”全国大学生心理与认知智能测评挑战赛（以下简称“厚粲杯”），并对所开发的测验工具进行初步的测量学检验。</p><p>通过收集参与者在测验中的作答数据，团队将对测验的作答情况及相关测量指标进行分析，以了解测验的表现，并进一步开展测验工具的信度、效度等方面的分析，为后续完善情绪感知能力测验提供依据。</p><p>本测验属于科研及测验工具开发性质的项目，测验结果不用于心理疾病诊断，也不能替代专业的心理评估或临床诊断。</p></section>
    <section><h2>三、测验内容与参与过程</h2><p>本次测验采用线上方式进行，预计需要10—15分钟完成。</p><p>测验过程中，您将接触不同形式的情绪材料，并根据材料完成相应的选择题。相关材料可能包括图片、文字、音频和视频等内容，您需要根据自己的判断对材料中所呈现的情绪进行识别并选择情绪的强度。</p><p>请按照测验指导语完成各项题目，并根据您对材料的真实判断进行作答。测验过程中无需提前准备相关知识。</p></section>
    <section><h2>四、可能的风险与不适</h2><p>本测验属于低风险的心理学测验，一般不会造成身体伤害。由于部分测验材料涉及不同类型的情绪内容，个别材料可能使您产生短暂的情绪波动或轻微不适。如果您在测验过程中感到明显不适，可以选择暂停或退出测验。</p><p>参加本测验不会因为答题表现而受到任何评价、惩罚或其他不利影响。</p></section>
    <section><h2>五、可能的获益</h2><p>参加本测验可能帮助您了解自己在本测验所涉及的情绪感知任务中的表现。同时，您的参与将为情绪感知能力测验工具的开发与完善提供数据支持，并有助于团队开展相关的测量学分析。</p><p>需要说明的是，本测验的结果仅反映您在本测验任务中的表现，不代表对您整体情绪能力或心理健康状况的全面评价。</p></section>
    <section><h2>六、费用与报酬</h2><p>参加本次测验无需支付任何费用，本次测验会提供参与报酬。</p></section>
    <section><h2>七、数据收集与隐私保护</h2><p>本测验不要求您提供姓名、联系方式、学号、专业等直接身份识别信息。</p><p>本项目将根据研究和测验分析需要收集与作答相关的数据，包括但不限于：</p><ul><li>性别；</li><li>各题选择情况及作答结果；</li><li>答题正确率等测验表现指标；</li><li>完成题目所用的答题时间等与测验过程相关的数据。</li></ul><p>上述数据将主要用于本项目的测验分析、测验工具的信度与效度分析，以及“厚粲杯”比赛项目的报告撰写和成果整理。团队将对所收集的数据进行合理的保密和安全管理。</p><p>由于本测验不要求收集姓名、联系方式等直接身份识别信息，团队在数据收集后可能无法根据个人身份准确定位某一参与者的数据。因此，如您在完成并提交测验后希望撤回数据，团队可能无法在不具备个人识别信息的情况下定位并删除对应数据。</p></section>
    <section><h2>八、数据的使用与成果传播</h2><p>您所提供的数据将在本项目规定的用途范围内使用，主要包括：</p><ol><li>情绪感知能力测验工具的测量学分析，包括信度、效度等方面的分析；</li><li>“厚粲杯”比赛项目的数据分析及报告撰写；</li><li>与本项目相关的研究成果整理与展示。</li></ol><p>如相关研究成果以报告、论文、汇报或其他形式呈现，将以总体统计结果或经过处理的数据进行展示，而不会披露能够识别个人身份的信息。</p></section>
    <section><h2>九、自愿参加与退出</h2><p>是否参加本次测验完全由您自主决定。您可以拒绝参加本次测验，也可以在测验过程中随时退出，无需说明理由。选择不参加或中途退出不会对您产生任何不利影响。</p><p>如果您在尚未提交测验的情况下退出，可以直接停止答题。</p></section>
    <section><h2>十、疑问与联系方式</h2><p>如果您对本测验的目的、过程、数据使用、隐私保护或其他事项存在疑问，可以联系项目负责人进行咨询。</p><ul><li>电子邮箱：<a href="mailto:241820160@smail.nju.edu.cn">241820160@smail.nju.edu.cn</a></li><li>微信：19593121184</li></ul></section>
    <section><h2>十一、同意声明</h2><p>在阅读并理解上述内容后，如您决定参加本次测验，即表示：</p><ul><li>您已经阅读并理解本知情同意书的主要内容；</li><li>您了解本测验的目的、过程、预计耗时、可能的风险与不适、可能的获益以及数据使用方式；</li><li>您知晓本测验为自愿参加，可以在任何阶段选择退出；</li><li>您了解本测验不会收集姓名、联系方式、专业等直接身份识别信息，并知晓所收集的测验数据可能用于测验工具的信度、效度等分析，以及“厚粲杯”比赛相关报告和成果整理；</li><li>您同意团队按照本知情同意书所说明的范围收集、分析和使用您的测验数据；</li><li>您确认在参加本测验前已有机会提出疑问，并可以通过上述联系方式获得进一步说明。</li></ul><p>如果您同意参加本次测验，请点击“同意并继续”。</p></section>
  </div><footer><p>确认后，本浏览器将记住您对当前版本同意书的选择。</p><button class="btn primary" id="acceptConsent">同意并继续</button></footer></section></div>`);
  const button = document.querySelector('#acceptConsent');
  button.focus();
  button.onclick = () => {
    localStorage.setItem(consentKey, 'accepted');
    document.querySelector('#informedConsent').remove();
    document.body.classList.remove('consent-open');
  };
}

function home() {
  const closed = !current && collectionActive === false;
  app.innerHTML = header() + `<main class="content"><section class="hero"><div><div class="eyebrow">EMOTION PERCEPTION LAB</div><h1>从多模态线索，<br>理解情绪的<em>细微差别</em></h1><p>通过图像、文本、语音与视频情境，评估情绪识别和情绪推理能力。全程匿名，完成后即时获得分项反馈。</p>${closed?'<div class="collection-closed" role="status"><b>当前题目收集已满</b><span>感谢你的关注，本轮测评暂不再接收新的作答。</span></div>':''}<div class="actions"><button class="btn primary" id="start" ${closed?'disabled':''}>${closed?'作答已关闭':current?.completed ? '查看上次测评结果' : current ? '继续测评' : '开始匿名测评'}${closed?'':' →'}</button><a class="btn" href="#about">了解作答方式</a></div>${current?.completed?'<p class="device-submitted">此浏览器已完成测评，再次进入将直接显示上次结果。</p>':''}<div class="trust-row"><span>✓ 匿名参与</span><span>✓ 即时报告</span><span>✓ 多模态题目</span></div></div><div class="hero-art"><div class="signal-card main-signal"><small>当前测评维度</small><strong>情绪感知</strong><div class="signal-wave"><i></i><i></i><i></i><i></i><i></i><i></i></div></div><span class="float-tag t1">图像 · 表情线索</span><span class="float-tag t2">语音 · 语调变化</span><span class="float-tag t3">文本 · 情境推理</span></div></section><div class="stats"><div class="stat"><small>能力维度</small><b>2</b><small>情绪识别与推理</small></div><div class="stat"><small>选项形式</small><b>单选 / 多选</b><small>适配复杂情绪场景</small></div><div class="stat"><small>素材模态</small><b>4</b><small>图文音视频融合</small></div><div class="stat"><small>隐私方式</small><b>匿名</b><small>不采集身份信息</small></div></div></main>`;
  if (!closed) document.querySelector('#start').onclick = start;
}
function about() {
  const closed = !current && collectionActive === false;
  app.innerHTML = header() + `<main class="content guide-page"><div class="page-head guide-head"><div><span class="eyebrow">BEFORE YOU START</span><h1>测评说明</h1><p>请先完整阅读以下说明，了解测评目的、题目形式和作答方法后再开始</p></div></div><section class="card guide-intro"><div><span class="guide-chip">多模态 · 情境化 · 匿名</span><h2>这是一项怎样的测评？</h2><p>本测评关注你在日常社交情境中感知他人情绪的表现。题目使用图像、文本、语音和视频等生活化材料，要求你综合人物的面部表情、身体动作、说话内容、语气语调及前后情境，判断人物可能正在经历的情绪。</p><p>测评包含两个相互关联的能力方向：<b>情绪识别</b>是根据人物已经表现出来的线索判断其当前情绪；<b>情绪推理</b>是在互动关系和事件背景中，推断人物可能产生或即将产生的情绪反应。它考查的是具体题目中的判断表现，不是性格测试，也不用于医学或心理诊断。</p></div><div class="guide-summary"><div><b>4</b><span>图像、文本、语音、视频</span></div><div><b>2</b><span>情绪识别与情绪推理</span></div><div><b>1–5</b><span>情绪表现强度等级</span></div></div></section><section class="guide-section"><div class="section-copy"><span class="eyebrow">WHAT YOU WILL SEE</span><h2>你会遇到哪些题目？</h2><p>不同题目提供的线索不同。请以当前页面实际呈现的全部信息为准，不要只依赖某一个显眼线索。</p></div><div class="material-grid"><div class="card material-card"><i>▧</i><h3>图像题</h3><p>观察表情、目光、姿态、人物距离和场景信息，留意细微但一致的情绪线索。</p></div><div class="card material-card"><i>文</i><h3>文本题</h3><p>阅读对话与背景，结合措辞、停顿描述、言外之意和事件前因后果进行判断。</p></div><div class="card material-card"><i>♪</i><h3>语音题</h3><p>建议佩戴耳机，关注音量、语速、音高、停顿和语气变化，可在作答前充分听取素材。</p></div><div class="card material-card"><i>▶</i><h3>视频题</h3><p>完整观看人物互动和情绪变化过程，综合画面、动作、语言及时间顺序作答。</p></div></div></section><section class="guide-section"><div class="section-copy"><span class="eyebrow">HOW TO ANSWER</span><h2>每道题应该如何作答？</h2></div><div class="steps-list"><div class="card guide-step"><b>01</b><div><h3>完整阅读问题并确认目标人物</h3><p>先确认题目询问的是谁、哪个时刻以及需要进行情绪识别还是情绪推理。多人场景中不要把其他人物的情绪当作目标答案。</p></div></div><div class="card guide-step"><b>02</b><div><h3>完整查看素材和情景内容</h3><p>结合所有可用线索形成整体判断。音频和视频题请先完成播放；如题目提供情景内容，也应一并阅读。</p></div></div><div class="card guide-step"><b>03</b><div><h3>选择情绪词</h3><p><b>单选题</b>选择一个你认为最合适的情绪词；<b>多选题</b>选择你认为确实同时存在的全部情绪。不要为了“多选”而勉强增加缺乏线索的选项。</p></div></div><div class="card guide-step"><b>04</b><div><h3>分别判断情绪强度</h3><p>每个已选情绪都需要单独标注 1–5 级强度。强度表示该情绪在当前素材中的表现程度，而不是你本人看到素材后的感受。</p></div></div><div class="card guide-step"><b>05</b><div><h3>检查并保存作答</h3><p>确认情绪词和强度均已填写后进入下一题。系统会自动保存，你可以返回上一题检查或修改；最终提交前必须完成全部题目。</p></div></div></div></section><section class="guide-section guide-two"><div class="card strength-guide"><span class="eyebrow">INTENSITY SCALE</span><h2>如何理解 1–5 级强度？</h2><div class="scale-guide"><div><b>1</b><span>非常轻微</span><small>仅有隐约线索，情绪表现不明显</small></div><div><b>2</b><span>较弱</span><small>能够察觉，但表达仍较克制</small></div><div><b>3</b><span>中等</span><small>情绪清楚可辨，程度适中</small></div><div><b>4</b><span>较强</span><small>有明显且持续的表达线索</small></div><div><b>5</b><span>非常强烈</span><small>情绪高度突出，占据主要表现</small></div></div><p class="guide-note">请判断素材中人物实际展现的程度。情绪词选得合适但强度与素材差异较大，仍会影响该题表现。</p></div><div class="card answer-principles"><span class="eyebrow">ANSWERING PRINCIPLES</span><h2>作答时请注意</h2><ul><li>请根据第一手观察独立完成，不与他人讨论，也不要搜索素材来源或标准答案。</li><li>没有要求你猜测“研究者想要的答案”；请依据当前情境作出最符合你判断的选择。</li><li>不要仅凭单一表情判断。真实情绪可能由表情、语言、动作和情境共同呈现。</li><li>如果看过某段影视或视频素材，请如实填写观看经历；该信息用于辅助分析，不直接决定得分。</li><li>请认真作答，但不必在一道题上过度停留。无法完全确定时，选择证据最充分的答案。</li></ul></div></section><section class="card before-check"><div><span class="eyebrow">READY CHECK</span><h2>开始前的准备</h2></div><div class="check-grid"><p>✓ 选择安静、光线适宜且网络稳定的环境</p><p>✓ 语音和视频题建议使用耳机并调至舒适音量</p><p>✓ 预留连续时间，尽量不要中途切换页面或处理其他事务</p><p>✓ 使用较新的浏览器，手机端建议保持屏幕常亮</p></div></section><section class="card result-explain"><div><h2>计分、报告与隐私说明</h2><p>每道题同时考虑情绪标签判断和情绪强度判断，并结合题目登记分值形成综合结果。完成后可查看总体得分率、情绪识别与推理、不同素材模态以及标签和强度等分项表现。报告只解释本次作答数据；题量较少的维度应谨慎理解，不代表稳定能力、常模排名或人群比较。</p><p>系统以随机匿名编号保存答卷，不主动收集姓名、手机号或学号。作答选择、强度、用时和修改次数可能用于题目质量与研究分析。请勿在任何文本输入位置填写可识别个人身份的信息。</p></div><div class="result-warning"><b>重要提醒</b><span>本测评及其智能反馈仅供研究和个人成长参考，不构成心理咨询、疾病筛查、医学诊断或任何重要选拔决定。</span></div></section><div class="guide-start"><label><input type="checkbox" id="guideConfirm"> 我已阅读并理解测评目的、作答方法、计分与隐私说明</label><button class="btn primary" id="aboutStart" disabled>我已了解，开始测评 →</button></div></main>`;
  if (closed) {
    const startArea = document.querySelector('.guide-start');
    startArea.classList.add('closed');
    startArea.innerHTML = '<div class="collection-closed" role="status"><b>当前题目收集已满</b><span>感谢你的关注，本轮测评暂不再接收新的作答。</span></div>';
  } else {
    document.querySelector('#guideConfirm').onchange = event => { document.querySelector('#aboutStart').disabled = !event.target.checked; };
    document.querySelector('#aboutStart').onclick = start;
  }
}
async function start() {
  if(testAccessBlocked)return toast('此浏览器已参加其他测试，不能参加当前测试');
  try {
    if (current) { const attempt = await api(`/api/attempts/${current.id}`); if (attempt.status === 'completed') { current.completed = true; localStorage.setItem(submissionKey, JSON.stringify({ id: current.id, token: current.token, completed: true })); return void (location.hash = 'report'); } current.data = attempt; }
    else { current = await api('/api/attempts', { method: 'POST', body: JSON.stringify({ test_code: testCode }) }); localStorage.setItem(participationKey,testCode);lockedTestCode=testCode;localStorage.setItem(sessionKey, JSON.stringify(current)); current.data = await api(`/api/attempts/${current.id}`); }
    questionIndex = Math.max(0, current.data.questions.findIndex(q => !q.emotions?.length && !q.skipped)); location.hash = 'assessment';
  } catch (error) {
    if (!current && error.message === '当前题目收集已满') {
      collectionActive = false;
      if (location.hash === '#about') about(); else home();
    }
    toast(error.message);
  }
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
  app.innerHTML = header() + `<main class="assessment-wrap"><div class="assessment-meta"><div><span class="question-kicker">${q.question_type === 'reasoning' ? '情绪推理' : '情绪识别'} · ${isMultiple ? '多选题' : '单选题'} · ${q.points} 分</span><h1>${q.title}</h1></div><span class="autosave">● 切题时自动保存</span></div><div class="progress-row"><div class="progress"><div style="width:${(questionIndex + 1) / current.data.questions.length * 100}%"></div></div><b>${String(questionIndex + 1).padStart(2, '0')} / ${String(current.data.questions.length).padStart(2, '0')}</b></div><article class="card question"><div class="question-type"><span>${icons[q.modality]} ${{ image: '图像', text: '文本', audio: '语音', video: '视频' }[q.modality]}素材</span><span>${isMultiple ? '选 1 - 5 个' : '请选择 1 项'}</span></div><div class="stimulus"><div class="scene">${media(q)}<blockquote>${q.context}</blockquote><strong>${q.prompt}</strong></div></div><div class="answer-layout"><section class="answer-box"><div class="answer-title"><div><small>STEP 1</small><h3>${isMultiple ? '选择情绪（选 1 - 5 个）' : '选择情绪（单选）'}</h3></div><span class="choice-badge">${isMultiple ? `已选 ${q.emotions.length} 个` : '仅选 1 项'}</span></div><div class="emotions">${q.options.map(e => `<button class="emotion ${q.emotions.includes(e) ? 'selected' : ''}" data-emotion="${e}"><i></i>${e}</button>`).join('')}</div></section><section class="answer-box"><div class="answer-title"><div><small>STEP 2</small><h3>标注情绪强度</h3></div><span>1–5 级</span></div><div id="strengthList">${q.emotions.length ? q.emotions.map((e, i) => strengthScale(e, q.strengths[i] || 3)).join('') : '<div class="strength-empty">选择情绪后，在此分别标注强度</div>'}</div></section></div><div class="watched-row"><div><b>你是否看过该影视作品？</b><small>此信息仅用于分析素材熟悉度，不影响得分</small></div><div class="segmented"><button data-watched="true" class="${q.watched_source === 1 || q.watched_source === true ? 'active' : ''}">看过</button><button data-watched="false" class="${q.watched_source === 0 || q.watched_source === false ? 'active' : ''}">没看过</button></div></div><div class="question-actions"><button class="btn" id="previous" ${questionIndex === 0 ? 'disabled' : ''}>← 上一题</button><div><button class="btn ghost" id="skip" ${isLast ? 'disabled title="最后一题必须作答"' : ''}>${isLast ? '最后一题不可跳过' : '暂时跳过'}</button><button class="btn primary" id="next">${questionIndex === current.data.questions.length - 1 ? '提交测评' : '保存并下一题 →'}</button></div></div></article></main>`;
  document.querySelector('.question-kicker').textContent = `${q.question_type === 'reasoning' ? '情绪推理' : '情绪识别'} · ${isMultiple ? '多选题' : '单选题'} · ${fixed(q.points)} 分`;
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
  try { await api(`/api/attempts/${current.id}/submit`, { method: 'POST', body: '{}' }); current.data.status = 'completed'; current.completed = true; localStorage.setItem(submissionKey, JSON.stringify({ id: current.id, token: current.token, completed: true })); location.hash = 'report'; } catch (error) { toast(error.message); }
}
function scoreClass(n) { return n >= 85 ? '优秀' : n >= 70 ? '良好' : n >= 60 ? '尚可' : '需提升'; }
function radarChart(report) {
  const axes = [['image', '图像'], ['text', '文本'], ['audio', '音频'], ['video', '视频']], cx = 150, cy = 140, radius = 92;
  const point = (index, scale) => { const angle = -Math.PI / 2 + index * Math.PI / 2; return `${(cx + Math.cos(angle) * radius * scale).toFixed(1)},${(cy + Math.sin(angle) * radius * scale).toFixed(1)}`; };
  const grids = [.25, .5, .75, 1].map(scale => `<polygon points="${axes.map((_, i) => point(i, scale)).join(' ')}"></polygon>`).join('');
  const values = axes.map(([key]) => Math.max(0, Math.min(100, report.by_modality?.[key] ?? 0)) / 100);
  const labels = axes.map(([key, label], i) => { const [x, y] = point(i, 1.28).split(','); const n = report.sample_sizes?.modalities?.[key] || 0; return `<text x="${x}" y="${y}" text-anchor="middle">${label} ${fixed(report.by_modality?.[key])}${n ? `% · n=${n}` : ''}</text>`; }).join('');
  return `<svg class="profile-radar" viewBox="0 0 300 280" role="img" aria-label="各素材模态加权得分率雷达图"><g class="radar-grid">${grids}${axes.map((_, i) => `<line x1="${cx}" y1="${cy}" x2="${point(i, 1).replace(',', '" y2="')}"></line>`).join('')}</g><polygon class="radar-area" points="${values.map((value, i) => point(i, value)).join(' ')}"></polygon><g class="radar-labels">${labels}</g></svg>`;
}
function metricRow(label, value, count, detail = '') { const width = typeof value === 'number' ? value : 0; return `<div class="metric-row"><div><b>${label}</b><span>${typeof value === 'number' ? `${fixed(value)}%` : '样本不足'}${count != null ? ` · n=${count}` : ''}</span></div><div class="metric-track"><i style="width:${width}%"></i></div>${detail ? `<small>${detail}</small>` : ''}</div>`; }
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
    const [r, review] = await Promise.all([api(`/api/attempts/${current.id}/report`), api(`/api/attempts/${current.id}/review`)]);
    const typeCounts = r.sample_sizes?.question_types || {}, cached = r.feedback_cache?.warm?.version === 2 ? r.feedback_cache.warm : null;
    const overview = escapeHtml(cached?.overview || '选择反馈风格并生成报告后，这里将结合综合得分、能力结构、素材模态和样本题量，对本次整体表现进行解释。');
    const recommendations = escapeHtml(cached?.recommendations || '系统会根据相对优势与薄弱维度提供下一步练习建议，模型生成内容总计不超过 500 字。');
    const recognitionRows = metricRow('情绪识别', r.by_question_type?.recognition, typeCounts.recognition || 0, '按识别类题目的分值加权') + metricRow('情绪推理', r.by_question_type?.reasoning, typeCounts.reasoning || 0, '按推理类题目的分值加权') + metricRow('标签识别', r.recognition_details?.label, typeCounts.recognition || 0, '情绪识别能力子项') + metricRow('强度判断', r.recognition_details?.strength, typeCounts.recognition || 0, '情绪识别能力子项');
    app.innerHTML = header() + `<main class="content report-page"><div class="page-head"><div><span class="eyebrow">ASSESSMENT REPORT</span><h1>你的情绪感知报告</h1><p>匿名编号 ${current.id} · 共 ${r.sample_sizes?.total || 0} 题</p></div><button class="btn" onclick="window.print()">打印 / 保存 PDF</button></div><div class="report-hero card"><div><small>综合得分率</small><div class="overall-line"><strong>${r.overall}</strong><span>/100</span></div></div><div class="report-method"><b>计分说明</b><p>综合得分率及各维度均按题目分值加权。图中 n 表示该维度包含的题目数；当 n 较小时，结果仅描述本次答题表现，不代表稳定能力或常模排名。</p><span>平均有效作答时间 ${((r.average_response_ms || 0) / 1000).toFixed(1)} 秒/题</span></div></div><div class="grid"><div class="card span7 chart-card"><div class="chart-title"><div><h3>多模态表现轮廓</h3><small>四轴雷达图 · 得分率 0–100%</small></div></div>${radarChart(r)}</div><div class="card span5 chart-card"><div class="chart-title"><div><h3>能力结构</h3><small>加权得分率与样本题数</small></div></div><div class="metric-list">${recognitionRows}</div></div><div class="card span12 feedback-card"><div class="feedback-head"><div><h3>AI 个性化报告</h3><small id="feedbackSource">${cached?.source === 'model' ? '由大语言模型生成' : '选择风格后生成'}</small></div><div class="feedback-tools"><select id="feedbackStyle"><option value="warm">温暖鼓励</option><option value="professional">专业分析</option><option value="concise">简洁直接</option></select><button class="btn primary" id="generateFeedback">生成完整报告</button></div></div><section class="narrative-block"><h4>整体表现解读</h4><p id="feedbackOverview">${overview}</p></section><section class="narrative-block advice"><h4>下一步建议</h4><p id="feedbackRecommendations">${recommendations}</p></section><div class="report-actions"><small>报告仅用于个人成长参考，不构成医学或心理诊断；没有常模时不提供百分位或人群比较。</small><button class="btn" id="newAttempt">开始新的测评</button></div></div></div></main>`;
    const answerText = (emotions, strengths) => emotions.map((emotion,index)=>`${escapeHtml(emotion)}（强度 ${strengths[index] ?? '—'}）`).join('、') || '未作答';
    const reviewMedia = q => !q.media_url ? '' : q.modality === 'image' ? `<div class="review-media image-frame"><img src="${escapeHtml(q.media_url)}" alt="第 ${q.position} 题图片素材"></div>` : q.modality === 'audio' ? `<audio class="review-audio" controls preload="metadata" src="${escapeHtml(q.media_url)}"></audio>` : q.modality === 'video' ? `<div class="review-media video-frame"><video controls preload="metadata" src="${escapeHtml(q.media_url)}"></video></div>` : '';
    document.querySelector('.feedback-card').insertAdjacentHTML('afterend', `<section class="card span12 review-card"><div class="review-head"><div><h3>逐题作答回顾</h3><p>查看本人作答、标准答案和单题表现；如对题目或标准答案有疑问，可匿名提交反馈。</p></div><span>${review.length} 道题</span></div><div class="review-list">${review.map(q=>`<article class="review-item"><div class="review-title"><span>第 ${q.position} 题 · ${escapeHtml(q.code)} · ${escapeHtml(q.title)}</span><b>${q.total_score ?? 0}%</b></div>${reviewMedia(q)}${q.context?`<p class="review-context">${escapeHtml(q.context)}</p>`:''}<p class="review-prompt">${escapeHtml(q.prompt)}</p><div class="review-answer-grid"><div><small>你的作答</small><strong>${answerText(q.emotions,q.strengths)}</strong></div><div><small>标准答案</small><strong>${answerText(q.correct_emotions,q.standard_strengths)}</strong></div><div><small>标签 / 强度得分率</small><strong>${q.label_score ?? 0}% / ${q.strength_score ?? 0}%</strong></div><div><small>本题用时</small><strong>${((q.response_time_ms||0)/1000).toFixed(1)} 秒</strong></div></div><div class="question-feedback"><textarea maxlength="1000" data-feedback-position="${q.position}" placeholder="可选：说明你认为题目、素材、候选情绪或标准答案存在的问题（5–1000字）">${escapeHtml(q.feedback||'')}</textarea><div><small>${q.feedback?`已提交 · ${q.feedback_status==='handled'?'后台已处理':'等待后台处理'}`:'反馈将与本题及匿名答卷编号关联'}</small><button class="btn feedback-submit" data-position="${q.position}">${q.feedback?'更新反馈':'提交反馈'}</button></div></div></article>`).join('')}</div></section>`);
    document.querySelectorAll('.feedback-submit').forEach(button=>button.onclick=async()=>{const textarea=document.querySelector(`[data-feedback-position="${button.dataset.position}"]`),content=textarea.value.trim();if(content.length<5)return toast('请至少输入 5 个字符');button.disabled=true;try{await api(`/api/attempts/${current.id}/questions/${button.dataset.position}/feedback`,{method:'POST',body:JSON.stringify({content})});button.textContent='更新反馈';button.parentElement.querySelector('small').textContent='已提交 · 等待后台处理';toast('反馈已提交，谢谢你的意见')}catch(error){toast(error.message)}finally{button.disabled=false}});
    document.querySelector('.review-card')?.remove();
    document.querySelector('.report-page').insertAdjacentHTML('afterbegin', reportSideNav('report'));
    document.querySelector('.overall-line strong').textContent = fixed(r.overall);
    document.querySelector('.report-method span').textContent = `平均有效作答时间 ${fixed((r.average_response_ms || 0) / 1000)} 秒/题`;
    const printButton = document.querySelector('[onclick="window.print()"]');
    printButton.removeAttribute('onclick');
    printButton.onclick = () => printReport(r);
    bindFeedback();
    const newAttempt = document.querySelector('#newAttempt'); newAttempt.textContent = '返回首页'; newAttempt.onclick = () => { location.hash = 'home'; };
  } catch (error) { toast(error.message); location.hash = 'home'; }
}
function reportSideNav(active) {
  return `<nav class="report-side-nav" aria-label="报告页面导航"><a class="${active === 'report' ? 'active' : ''}" href="#report"><span>01</span>测评报告</a><a class="${active === 'review' ? 'active' : ''}" href="#review"><span>02</span>逐题回顾</a></nav>`;
}
function reviewAnswerText(emotions, strengths) {
  return emotions.map((emotion, index) => `${escapeHtml(emotion)}（强度 ${strengths[index] ?? '—'}）`).join('、') || '未作答';
}
function reviewMedia(q) {
  if (!q.media_url) return '';
  if (q.modality === 'image') return `<div class="review-media image-frame"><img src="${escapeHtml(q.media_url)}" alt="第 ${q.position} 题图片素材"></div>`;
  if (q.modality === 'audio') return `<audio class="review-audio" controls preload="metadata" src="${escapeHtml(q.media_url)}"></audio>`;
  if (q.modality === 'video') return `<div class="review-media video-frame"><video controls preload="metadata" src="${escapeHtml(q.media_url)}"></video></div>`;
  return '';
}
function reviewItems(review) {
  return review.map(q => `<article class="review-item"><div class="review-title"><span>第 ${q.position} 题 · ${escapeHtml(q.code)} · ${escapeHtml(q.title)}</span><b>${q.total_score ?? 0}%</b></div>${reviewMedia(q)}${q.context ? `<p class="review-context">${escapeHtml(q.context)}</p>` : ''}<p class="review-prompt">${escapeHtml(q.prompt)}</p><div class="review-answer-grid"><div><small>你的作答</small><strong>${reviewAnswerText(q.emotions, q.strengths)}</strong></div><div><small>标准答案</small><strong>${reviewAnswerText(q.correct_emotions, q.standard_strengths)}</strong></div><div><small>标签 / 强度得分率</small><strong>${q.label_score ?? 0}% / ${q.strength_score ?? 0}%</strong></div><div><small>本题用时</small><strong>${((q.response_time_ms || 0) / 1000).toFixed(1)} 秒</strong></div></div><div class="question-feedback"><textarea maxlength="1000" data-feedback-position="${q.position}" placeholder="可选：说明你认为题目、素材、候选情绪或标准答案存在的问题（5–1000字）">${escapeHtml(q.feedback || '')}</textarea><div><small>${q.feedback ? `已提交 · ${q.feedback_status === 'handled' ? '后台已处理' : '等待后台处理'}` : '反馈将与本题及匿名答卷编号关联'}</small><button class="btn feedback-submit" data-position="${q.position}">${q.feedback ? '更新反馈' : '提交反馈'}</button></div></div></article>`).join('');
}
function bindReviewFeedback() {
  document.querySelectorAll('.feedback-submit').forEach(button => button.onclick = async () => {
    const textarea = document.querySelector(`[data-feedback-position="${button.dataset.position}"]`), content = textarea.value.trim();
    if (content.length < 5) return toast('请至少输入 5 个字符');
    button.disabled = true;
    try {
      await api(`/api/attempts/${current.id}/questions/${button.dataset.position}/feedback`, { method: 'POST', body: JSON.stringify({ content }) });
      button.textContent = '更新反馈';
      button.parentElement.querySelector('small').textContent = '已提交 · 等待后台处理';
      toast('反馈已提交，谢谢你的意见');
    } catch (error) { toast(error.message); }
    finally { button.disabled = false; }
  });
}
async function reviewPage() {
  if (!current) return home();
  try {
    const review = await api(`/api/attempts/${current.id}/review`);
    app.innerHTML = header() + `<main class="content report-page review-page">${reportSideNav('review')}<div class="page-head"><div><span class="eyebrow">ANSWER REVIEW</span><h1>逐题作答回顾</h1><p>查看本人作答、标准答案与单题表现，并可匿名反馈具体问题。</p></div><a class="btn" href="#report">返回测评报告</a></div><section class="card review-card"><div class="review-head"><div><h3>本次答题明细</h3><p>素材与答题时一致；强度、标签得分均按该题标准答案计算。</p></div><span>${review.length} 道题</span></div><div class="review-list">${reviewItems(review)}</div></section></main>`;
    document.querySelectorAll('.review-item').forEach((item, index) => {
      const q = review[index], answers = item.querySelectorAll('.review-answer-grid strong');
      item.querySelector('.review-title>b').textContent = `${fixed(q.total_score)}%`;
      answers[2].textContent = `${fixed(q.label_score)}% / ${fixed(q.strength_score)}%`;
      answers[3].textContent = `${fixed((q.response_time_ms || 0) / 1000)} 秒`;
    });
    bindReviewFeedback();
  } catch (error) { toast(error.message); location.hash = 'report'; }
}
function printReport(r) {
  const popup = window.open('', '_blank');
  if (!popup) return toast('浏览器阻止了报告窗口，请允许本站弹出窗口后重试');
  popup.opener = null;
  const overview = document.querySelector('#feedbackOverview')?.textContent.trim() || '尚未生成个性化解读。';
  const recommendations = document.querySelector('#feedbackRecommendations')?.textContent.trim() || '尚未生成个性化建议。';
  const rows = [
    ['情绪识别', r.by_question_type?.recognition, r.sample_sizes?.question_types?.recognition],
    ['情绪推理', r.by_question_type?.reasoning, r.sample_sizes?.question_types?.reasoning],
    ['图像素材', r.by_modality?.image, r.sample_sizes?.modalities?.image],
    ['文本素材', r.by_modality?.text, r.sample_sizes?.modalities?.text],
    ['音频素材', r.by_modality?.audio, r.sample_sizes?.modalities?.audio],
    ['视频素材', r.by_modality?.video, r.sample_sizes?.modalities?.video]
  ].map(([label, value, count]) => `<tr><th>${label}</th><td>${value == null ? '暂无数据' : `${value}%`}</td><td>${count || 0} 题</td><td><i style="width:${Math.max(0, Math.min(100, Number(value) || 0))}%"></i></td></tr>`).join('');
  const generatedAt = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'long', timeStyle: 'short' }).format(new Date());
  const safeOverview = escapeHtml(overview).replace(/\n/g, '<br>'), safeRecommendations = escapeHtml(recommendations).replace(/\n/g, '<br>');
  popup.document.write(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>情绪感知测评报告</title><style>@page{size:A4;margin:15mm}*{box-sizing:border-box}body{margin:0;color:#252621;font-family:"Microsoft YaHei",sans-serif;font-size:12px;line-height:1.75}header{padding:18px 22px;color:#fff;background:#292a27;border-radius:12px}header small{color:#f4ad68;letter-spacing:2px}header h1{margin:5px 0;font-size:25px}header p{margin:0;color:#d7d6d1}.score{display:grid;grid-template-columns:190px 1fr;gap:20px;margin:18px 0;padding:20px;border:1px solid #e8e2d8;border-radius:12px}.score strong{display:block;font-size:50px;color:#e87928;line-height:1;white-space:nowrap}.score strong span{font-size:16px;color:#777;white-space:nowrap}.score h2{margin:0 0 5px}.metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:9px;margin:15px 0}.metric{padding:12px;background:#f7f3ec;border-radius:8px}.metric b{display:block;font-size:20px;color:#d96f24}.metric small{color:#777}h2{font-size:17px;margin:20px 0 8px}.dimension{width:100%;border-collapse:collapse}.dimension th,.dimension td{padding:8px;border-bottom:1px solid #eee;text-align:left}.dimension th{width:90px}.dimension td:nth-child(2){width:75px;font-weight:700}.dimension td:nth-child(3){width:55px;color:#777}.dimension td:last-child{width:42%}.dimension i{display:block;height:7px;border-radius:9px;background:#e87928}.narrative{padding:13px 15px;border-left:3px solid #e87928;background:#faf8f4;page-break-inside:avoid}.narrative.advice{border-color:#6c9372}.note{margin-top:22px;padding-top:10px;border-top:1px solid #ddd;color:#777;font-size:10px}footer{position:fixed;bottom:0;color:#999;font-size:9px}@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}</style></head><body><header><small>EMOTION PERCEPTION ASSESSMENT</small><h1>情绪感知能力测评报告</h1><p>匿名答卷编号：${escapeHtml(String(current.id))}　｜　生成时间：${escapeHtml(generatedAt)}</p></header><section class="score"><div><small>综合得分率</small><strong>${r.overall}<span> / 100</span></strong></div><div><h2>${scoreClass(r.overall)}</h2><p>本次共完成 ${r.sample_sizes?.total || 0} 道题，获得 ${r.earned_points ?? '—'} / ${r.max_points ?? '—'} 分。结果按各题登记分值加权，用于描述本次作答表现。</p></div></section><div class="metrics"><div class="metric"><small>标签识别</small><b>${r.label ?? '—'}%</b></div><div class="metric"><small>强度判断</small><b>${r.strength ?? '—'}%</b></div><div class="metric"><small>平均有效用时</small><b>${((r.average_response_ms || 0) / 1000).toFixed(1)} 秒</b></div></div><h2>能力与素材维度</h2><table class="dimension">${rows}</table><h2>整体表现解读</h2><div class="narrative">${safeOverview}</div><h2>下一步建议</h2><div class="narrative advice">${safeRecommendations}</div><p class="note">说明：本报告仅用于个人成长与研究参考，不构成医学或心理诊断。维度题量较少时，结果可能受单题表现影响，不代表稳定能力、百分位或常模排名。逐题作答详情及问题反馈请在网页端“逐题回顾”中查看。</p><footer>知境 · 多模态情绪感知测评</footer></body></html>`);
  popup.document.close();
  popup.document.querySelector('.score strong').firstChild.nodeValue = fixed(r.overall);
  const printMetrics = popup.document.querySelectorAll('.metric b');
  printMetrics[0].textContent = `${fixed(r.label)}%`;
  printMetrics[1].textContent = `${fixed(r.strength)}%`;
  printMetrics[2].textContent = `${fixed((r.average_response_ms || 0) / 1000)} 秒`;
  const printValues = [r.by_question_type?.recognition, r.by_question_type?.reasoning, r.by_modality?.image, r.by_modality?.text, r.by_modality?.audio, r.by_modality?.video];
  popup.document.querySelectorAll('.dimension tr').forEach((row, index) => { if (printValues[index] != null) row.children[1].textContent = `${fixed(printValues[index])}%`; });
  setTimeout(() => { popup.focus(); popup.print(); }, 300);
}
home=function landingHome(){
  const closed=!current&&collectionActive===false,startLabel=closed?'作答已关闭':current?.completed?'查看测评结果':current?'继续测评':'开始测评';
  app.innerHTML=`<main class="landing-home"><section class="landing-copy"><div class="landing-title"><h1>情绪显影室</h1><p>多模态情绪感知能力测评</p></div><div class="landing-intro"><p>通过图像、文本、语音与视频情境，评估情绪识别和情绪推理能力。<br>全程匿名，完成后即时获得分项反馈。</p></div>${closed?'<div class="collection-closed" role="status"><b>当前题目收集已满</b><span>感谢你的关注，本轮测评暂不再接收新的作答。</span></div>':''}<div class="landing-actions"><a class="landing-btn secondary" href="#about">了解作答方式</a><button class="landing-btn primary" id="start" ${closed?'disabled':''}>${startLabel}</button></div>${current?.completed?'<p class="device-submitted">此浏览器已完成测评，再次进入将直接显示上次结果。</p>':''}<div class="landing-trust"><span>✓ 匿名参与</span><span>✓ 即时报告</span><span>✓ 多模态题目</span></div></section></main>`;
  if(!closed)document.querySelector('#start').onclick=start;
};
function blockedTestPage(){app.innerHTML=header()+`<main class="content"><section class="card access-blocked" role="alert"><span class="eyebrow">PARTICIPATION LIMIT</span><h1>此浏览器已参加其他测试</h1><p>为保证不同测试的样本相互独立，同一浏览器只能参加其中一个测试。当前链接对应测试 <b>${escapeHtml(testCode)}</b>，但本浏览器已经绑定测试 <b>${escapeHtml(lockedTestCode||'其他测试')}</b>，因此不能开始当前测评。</p><p>如果你认为这是误判，请联系测试管理员处理。</p></section></main>`}
function route() { if(testAccessBlocked)return blockedTestPage();({ home, about, assessment, report, review: reviewPage }[location.hash.slice(1) || 'home'] || home)(); }
try { current = JSON.parse(localStorage.getItem(submissionKey)) || JSON.parse(localStorage.getItem(sessionKey)); } catch {}
async function bootstrap() {
  if(!lockedTestCode){
    const savedKey=Object.keys(localStorage).find(key=>key.startsWith('zhijing_attempt_')||key.startsWith('zhijing_submission_'));
    if(savedKey)lockedTestCode=savedKey.replace(/^zhijing_(?:attempt|submission)_/,'');
    else if(localStorage.getItem('zhijing_attempt')||localStorage.getItem('zhijing_submission'))lockedTestCode='DEFAULT';
    if(lockedTestCode)localStorage.setItem(participationKey,lockedTestCode);
  }
  testAccessBlocked=!!lockedTestCode&&lockedTestCode!==testCode;
  if(testAccessBlocked){route();return}
  try { collectionActive = (await api(`/api/assessment/status?test=${encodeURIComponent(testCode)}`)).active; } catch { collectionActive = true; }
  route();
  if (current || collectionActive) showInformedConsent();
}
window.addEventListener('hashchange', route); bootstrap();
