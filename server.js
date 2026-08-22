const express = require('express');
const session = require('express-session');
const multer = require('multer');
const Database = require('better-sqlite3');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
function loadEnvFile() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || match[1].startsWith('#') || process.env[match[1]] !== undefined) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[match[1]] = value;
  }
}
loadEnvFile();
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || path.join(ROOT, 'uploads'));
fs.mkdirSync(DATA_DIR, { recursive: true }); fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const db = new Database(path.join(DATA_DIR, 'emotion.sqlite'));
db.pragma('journal_mode = WAL'); db.pragma('foreign_keys = ON');

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return `${salt}:${crypto.scryptSync(password, salt, 64).toString('hex')}`;
}
function verifyPassword(password, stored) {
  const [salt, key] = String(stored).split(':'); if (!salt || !key) return false;
  return crypto.timingSafeEqual(Buffer.from(key, 'hex'), crypto.scryptSync(password, salt, 64));
}
function migrate() {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);`);
  if (!db.prepare('SELECT 1 FROM schema_migrations WHERE version=1').get()) db.transaction(() => {
    db.exec(`
      CREATE TABLE admins(id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE media_files(id INTEGER PRIMARY KEY, original_name TEXT NOT NULL, stored_name TEXT UNIQUE NOT NULL, mime_type TEXT NOT NULL, size INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE questions(id INTEGER PRIMARY KEY, code TEXT UNIQUE NOT NULL, modality TEXT NOT NULL CHECK(modality IN ('image','text','audio','video')), title TEXT NOT NULL, context TEXT NOT NULL, prompt TEXT NOT NULL, options_json TEXT NOT NULL, correct_emotion TEXT NOT NULL, standard_strength INTEGER NOT NULL CHECK(standard_strength BETWEEN 1 AND 5), emotion_category TEXT NOT NULL, difficulty TEXT NOT NULL CHECK(difficulty IN ('easy','medium','hard')), media_id INTEGER REFERENCES media_files(id), published INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE assessment_configs(id INTEGER PRIMARY KEY CHECK(id=1), total_count INTEGER NOT NULL, image_count INTEGER NOT NULL, text_count INTEGER NOT NULL, audio_count INTEGER NOT NULL, video_count INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE attempts(id INTEGER PRIMARY KEY, public_id TEXT UNIQUE NOT NULL, token_hash TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('in_progress','completed')), started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, submitted_at TEXT, total_score REAL, label_score REAL, strength_score REAL, duration_ms INTEGER DEFAULT 0, report_json TEXT);
      CREATE TABLE attempt_questions(id INTEGER PRIMARY KEY, attempt_id INTEGER NOT NULL REFERENCES attempts(id), question_id INTEGER NOT NULL REFERENCES questions(id), position INTEGER NOT NULL, modality_snapshot TEXT NOT NULL, title_snapshot TEXT NOT NULL, context_snapshot TEXT NOT NULL, prompt_snapshot TEXT NOT NULL, options_snapshot TEXT NOT NULL, correct_emotion_snapshot TEXT NOT NULL, standard_strength_snapshot INTEGER NOT NULL, emotion_category_snapshot TEXT NOT NULL, media_url_snapshot TEXT, UNIQUE(attempt_id,position));
      CREATE TABLE responses(id INTEGER PRIMARY KEY, attempt_question_id INTEGER UNIQUE NOT NULL REFERENCES attempt_questions(id), emotion TEXT, strength INTEGER CHECK(strength BETWEEN 1 AND 5), skipped INTEGER NOT NULL DEFAULT 0, response_time_ms INTEGER NOT NULL DEFAULT 0, modification_count INTEGER NOT NULL DEFAULT 0, label_score REAL, strength_score REAL, total_score REAL, saved_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      INSERT INTO assessment_configs(id,total_count,image_count,text_count,audio_count,video_count) VALUES(1,5,2,1,1,1);
    `);
    db.prepare('INSERT INTO schema_migrations(version) VALUES(1)').run();
  })();
  if (!db.prepare('SELECT 1 FROM schema_migrations WHERE version=2').get()) db.transaction(() => {
    db.exec(`
      ALTER TABLE questions ADD COLUMN option_type TEXT NOT NULL DEFAULT 'single';
      ALTER TABLE questions ADD COLUMN question_type TEXT NOT NULL DEFAULT 'recognition';
      ALTER TABLE questions ADD COLUMN points INTEGER NOT NULL DEFAULT 100;
      ALTER TABLE questions ADD COLUMN conflict_code TEXT;
      ALTER TABLE questions ADD COLUMN correct_emotions_json TEXT;
      ALTER TABLE questions ADD COLUMN standard_strengths_json TEXT;
      ALTER TABLE assessment_configs ADD COLUMN single_count INTEGER NOT NULL DEFAULT 5;
      ALTER TABLE assessment_configs ADD COLUMN multiple_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE assessment_configs ADD COLUMN recognition_count INTEGER NOT NULL DEFAULT 5;
      ALTER TABLE assessment_configs ADD COLUMN reasoning_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE attempt_questions ADD COLUMN option_type_snapshot TEXT NOT NULL DEFAULT 'single';
      ALTER TABLE attempt_questions ADD COLUMN question_type_snapshot TEXT NOT NULL DEFAULT 'recognition';
      ALTER TABLE attempt_questions ADD COLUMN points_snapshot INTEGER NOT NULL DEFAULT 100;
      ALTER TABLE attempt_questions ADD COLUMN correct_emotions_snapshot TEXT;
      ALTER TABLE attempt_questions ADD COLUMN standard_strengths_snapshot TEXT;
      ALTER TABLE responses ADD COLUMN emotions_json TEXT;
      ALTER TABLE responses ADD COLUMN strengths_json TEXT;
      ALTER TABLE responses ADD COLUMN watched_source INTEGER;
      UPDATE questions SET correct_emotions_json=json_array(correct_emotion),standard_strengths_json=json_array(standard_strength);
      UPDATE attempt_questions SET correct_emotions_snapshot=json_array(correct_emotion_snapshot),standard_strengths_snapshot=json_array(standard_strength_snapshot);
    `);
    db.prepare('INSERT INTO schema_migrations(version) VALUES(2)').run();
  })();
  if (!db.prepare('SELECT 1 FROM schema_migrations WHERE version=3').get()) db.transaction(() => {
    db.exec(`ALTER TABLE assessment_configs ADD COLUMN combination_counts_json TEXT;`);
    const config=db.prepare('SELECT * FROM assessment_configs WHERE id=1').get(), combinations={};
    for(const modality of ['image','text','audio','video'])for(const optionType of ['single','multiple'])for(const questionType of ['recognition','reasoning'])combinations[`${modality}_${optionType}_${questionType}`]=0;
    const expanded=items=>items.flatMap(item=>Array(config[`${item}_count`]||0).fill(item));
    const modeSlots=expanded(['image','text','audio','video']), optionSlots=expanded(['single','multiple']), kindSlots=expanded(['recognition','reasoning']);
    modeSlots.forEach((modality,index)=>combinations[`${modality}_${optionSlots[index]}_${kindSlots[index]}`]++);
    db.prepare('UPDATE assessment_configs SET combination_counts_json=? WHERE id=1').run(JSON.stringify(combinations));
    db.prepare('INSERT INTO schema_migrations(version) VALUES(3)').run();
  })();
  if (!db.prepare('SELECT 1 FROM schema_migrations WHERE version=4').get()) db.transaction(() => {
    db.exec(`CREATE TABLE question_conflicts(
      question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
      conflicting_question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
      PRIMARY KEY(question_id,conflicting_question_id),
      CHECK(question_id<conflicting_question_id)
    );`);
    db.exec(`INSERT OR IGNORE INTO question_conflicts(question_id,conflicting_question_id)
      SELECT MIN(q.id,c.id),MAX(q.id,c.id) FROM questions q JOIN questions c ON c.code=q.conflict_code
      WHERE q.conflict_code IS NOT NULL AND q.id<>c.id;`);
    db.prepare('INSERT INTO schema_migrations(version) VALUES(4)').run();
  })();
  if (!db.prepare('SELECT 1 FROM schema_migrations WHERE version=5').get()) db.transaction(() => {
    db.exec(`CREATE TABLE attempt_question_feedback(
      id INTEGER PRIMARY KEY,
      attempt_question_id INTEGER UNIQUE NOT NULL REFERENCES attempt_questions(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','handled')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );`);
    db.prepare('INSERT INTO schema_migrations(version) VALUES(5)').run();
  })();
  if (!db.prepare('SELECT 1 FROM schema_migrations WHERE version=6').get()) db.transaction(() => {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_attempt_questions_question_id ON attempt_questions(question_id);`);
    db.prepare('INSERT INTO schema_migrations(version) VALUES(6)').run();
  })();
  if (!db.prepare('SELECT 1 FROM schema_migrations WHERE version=7').get()) db.transaction(() => {
    db.exec(`ALTER TABLE assessment_configs ADD COLUMN assessment_rules_json TEXT;`);
    db.prepare('INSERT INTO schema_migrations(version) VALUES(7)').run();
  })();
  seed();
}
function seed() {
  const username=process.env.ADMIN_USERNAME||'admin', password=process.env.ADMIN_PASSWORD||'admin123!';
  if (!db.prepare('SELECT id FROM admins LIMIT 1').get()) db.prepare('INSERT INTO admins(username,password_hash) VALUES(?,?)').run(username,hashPassword(password));
  if (process.env.SEED_DEMO_DATA !== 'true') return;
  if (db.prepare('SELECT COUNT(*) n FROM questions').get().n) return;
  const options=JSON.stringify(['快乐','悲伤','愤怒','恐惧','惊喜','失落','愧疚','不耐烦']);
  const rows=[
    ['ITEM-00001','image','下班后的沉默','她刚结束一场重要汇报，走出会议室后独自坐在窗边，望着雨幕，轻轻叹了口气。','结合人物表情与场景，她最可能处于哪种情绪？','悲伤',4,'悲伤','medium'],
    ['ITEM-00002','image','小组讨论','讨论中，一位成员频繁看表并抱起双臂；另一位成员仍在热情讲述自己的方案。','第一位成员最可能传递了怎样的情绪？','不耐烦',3,'愤怒','hard'],
    ['ITEM-00003','text','没有说出口的话','“没事，你们先去吧，我正好还有点工作。”他随后把已经买好的电影票放进抽屉。','人物隐含的主导情绪是什么？','失落',3,'悲伤','medium'],
    ['ITEM-00004','audio','迟到的祝福','语音转写：“生日快乐呀……抱歉今天才想起来。”语速较慢，中间有明显停顿。','综合内容与语气判断说话者情绪。','愧疚',4,'愧疚','medium'],
    ['ITEM-00005','video','重逢时刻','两位多年未见的朋友在车站认出彼此，先愣住，随后快步走近并拥抱。','互动中最明显的情绪是什么？','惊喜',5,'惊喜','easy']
  ];
  const add=db.prepare(`INSERT INTO questions(code,modality,title,context,prompt,options_json,correct_emotion,standard_strength,emotion_category,difficulty,published) VALUES(?,?,?,?,?,?,?,?,?,?,1)`);
  db.transaction(()=>rows.forEach(r=>add.run(r[0],r[1],r[2],r[3],r[4],options,r[5],r[6],r[7],r[8])))();
}
migrate();

const app=express(); app.disable('x-powered-by'); app.set('trust proxy',1);
app.use(express.json({limit:'1mb'})); app.use(express.urlencoded({extended:false}));
const cookieSecure = process.env.COOKIE_SECURE === 'true'
  ? true
  : process.env.COOKIE_SECURE === 'false' ? false : 'auto';
app.use(session({secret:process.env.SESSION_SECRET||crypto.randomBytes(32).toString('hex'),resave:false,saveUninitialized:false,cookie:{httpOnly:true,sameSite:'lax',secure:cookieSecure,maxAge:8*60*60*1000}}));
const asyncWrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
const auth=(req,res,next)=>req.session.adminId?next():res.status(401).json({error:'请先登录'});
const modalities=['image','text','audio','video'], difficulties=['easy','medium','hard'], optionTypes=['single','multiple'], questionTypes=['recognition','reasoning'];
const emotionPool=['快乐','惊喜','爱','紧张','痛苦','恐惧','惊讶','自豪','内疚','尴尬','共情痛苦','震惊','不屑','蔑视','愤怒','敌意','怨恨','轻松','愉悦','悲伤','感动','释然','遗憾','崇拜','渴望','嫉妒','感激','焦虑','绝望','烦躁','厌倦','满足','委屈','担忧','冷静','平静','困惑','失望','审美欣赏','抑郁','羡慕','兴趣','好奇','怀旧','愁闷','希望','兴奋','厌恶','羞耻','自满'];
const tokenHash=t=>crypto.createHash('sha256').update(t).digest('hex');
function attemptAuth(req,res,next){const token=req.get('X-Attempt-Token');const a=db.prepare('SELECT * FROM attempts WHERE public_id=?').get(req.params.id);if(!token||!a||a.token_hash!==tokenHash(token))return res.status(401).json({error:'测评会话无效'});req.attempt=a;next()}
function requireCompleteAttempt(req,res,next){const missing=db.prepare(`SELECT aq.position FROM attempt_questions aq LEFT JOIN responses r ON r.attempt_question_id=aq.id WHERE aq.attempt_id=? AND (r.id IS NULL OR r.skipped=1) ORDER BY aq.position`).all(req.attempt.id).map(row=>row.position);if(missing.length)return res.status(400).json({error:`第 ${missing.join('、')} 题还没有作答，请完成全部题目后提交`,missing_positions:missing});next()}
function shuffle(values){for(let i=values.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[values[i],values[j]]=[values[j],values[i]]}return values}
function parseOptions(value){let o=Array.isArray(value)?value:JSON.parse(value||'[]');o=[...new Set(o.map(String).map(x=>x.trim()).filter(Boolean))];if(o.length<1||o.length>10)throw Error('候选情绪需为 1–10 项');return o}
function buildAttemptOptions(value){const entered=parseOptions(value),supplements=shuffle(emotionPool.filter(emotion=>!entered.includes(emotion))).slice(0,10-entered.length);return shuffle([...entered,...supplements])}

app.post('/api/admin/login',(req,res)=>{const a=db.prepare('SELECT * FROM admins WHERE username=?').get(req.body.username);if(!a||!verifyPassword(req.body.password||'',a.password_hash))return res.status(401).json({error:'账号或密码错误'});req.session.adminId=a.id;res.json({username:a.username})});
app.post('/api/admin/logout',auth,(req,res)=>req.session.destroy(()=>res.json({ok:true})));
app.get('/api/admin/me',auth,(req,res)=>res.json(db.prepare('SELECT id,username FROM admins WHERE id=?').get(req.session.adminId)));
app.get('/api/admin/dashboard',auth,(req,res)=>{const q=db.prepare('SELECT COUNT(*) total,SUM(published) published FROM questions').get();const a=db.prepare("SELECT COUNT(*) total,ROUND(AVG(total_score),1) average FROM attempts WHERE status='completed'").get();const recent=db.prepare("SELECT date(submitted_at,'+8 hours') day,COUNT(*) count FROM attempts WHERE status='completed' GROUP BY day ORDER BY day DESC LIMIT 7").all().reverse();res.json({questions:q,attempts:a,recent})});
app.get('/api/admin/questions',auth,(req,res)=>{let where=[],args=[];if(modalities.includes(req.query.modality)){where.push('q.modality=?');args.push(req.query.modality)}if(optionTypes.includes(req.query.option_type)){where.push('q.option_type=?');args.push(req.query.option_type)}if(questionTypes.includes(req.query.question_type)){where.push('q.question_type=?');args.push(req.query.question_type)}if(difficulties.includes(req.query.difficulty)){where.push('q.difficulty=?');args.push(req.query.difficulty)}if(req.query.status==='published'||req.query.status==='draft'){where.push('q.published=?');args.push(req.query.status==='published'?1:0)}if(req.query.search){where.push('(q.code LIKE ? OR q.title LIKE ?)');args.push(`%${req.query.search}%`,`%${req.query.search}%`)}const orders={title_asc:'q.title COLLATE NOCASE ASC,q.id DESC',title_desc:'q.title COLLATE NOCASE DESC,q.id DESC'},order=orders[req.query.sort]||'q.id DESC';res.json(db.prepare(`SELECT q.*,m.original_name,m.mime_type,(SELECT COUNT(*) FROM attempt_questions aq WHERE aq.question_id=q.id) appearance_count,(SELECT GROUP_CONCAT(other.code) FROM question_conflicts qc JOIN questions other ON other.id=CASE WHEN qc.question_id=q.id THEN qc.conflicting_question_id ELSE qc.question_id END WHERE qc.question_id=q.id OR qc.conflicting_question_id=q.id) conflict_codes_text FROM questions q LEFT JOIN media_files m ON m.id=q.media_id ${where.length?'WHERE '+where.join(' AND '):''} ORDER BY ${order}`).all(...args).map(q=>({...q,options:JSON.parse(q.options_json),correct_emotions:JSON.parse(q.correct_emotions_json||JSON.stringify([q.correct_emotion])),standard_strengths:JSON.parse(q.standard_strengths_json||JSON.stringify([q.standard_strength])),conflict_codes:q.conflict_codes_text?q.conflict_codes_text.split(','):[],conflict_codes_text:undefined}))) });
function parseConflictCodes(value){return [...new Set((Array.isArray(value)?value:String(value||'').split(/[、,，\s]+/)).map(String).map(code=>code.trim().toUpperCase()).filter(Boolean))]}
function syncQuestionConflicts(questionId,codes){
  if(codes.length){const rows=db.prepare(`SELECT id,code FROM questions WHERE code IN (${codes.map(()=>'?').join(',')})`).all(...codes),found=new Set(rows.map(row=>row.code));const missing=codes.filter(code=>!found.has(code));if(missing.length)throw Error(`冲突题目编号不存在：${missing.join('、')}`);if(rows.some(row=>row.id===Number(questionId)))throw Error('题目不能与自身冲突');db.prepare('DELETE FROM question_conflicts WHERE question_id=? OR conflicting_question_id=?').run(questionId,questionId);const insert=db.prepare('INSERT OR IGNORE INTO question_conflicts(question_id,conflicting_question_id) VALUES(?,?)');for(const row of rows)insert.run(Math.min(questionId,row.id),Math.max(questionId,row.id));return}
  db.prepare('DELETE FROM question_conflicts WHERE question_id=? OR conflicting_question_id=?').run(questionId,questionId);
}
function questionBody(b){
  const options=parseOptions(b.options), optionType=b.option_type||'single', questionType=b.question_type||'recognition';
  const correct=[...new Set((Array.isArray(b.correct_emotions)?b.correct_emotions:[b.correct_emotion]).map(String).map(x=>x.trim()).filter(Boolean))];
  const strengths=(Array.isArray(b.standard_strengths)?b.standard_strengths:[b.standard_strength]).map(Number);
  const points=Number(b.points||100), conflictCodes=parseConflictCodes(b.conflict_codes??b.conflict_code);
  if(!modalities.includes(b.modality)||!difficulties.includes(b.difficulty)||!optionTypes.includes(optionType)||!questionTypes.includes(questionType)||!b.title?.trim()||!b.prompt?.trim())throw Error('题目字段不完整或不合法');
  if(correct.length<1||correct.length>(optionType==='single'?1:5)||correct.some(x=>!options.includes(x))||strengths.length!==correct.length||strengths.some(x=>![1,2,3,4,5].includes(x)))throw Error('标准情绪及对应强度不合法');
  if(!Number.isFinite(points)||points<=0||points>1000)throw Error('题目分值需为大于 0 且不超过 1000 的数字');
  return {values:[b.modality,optionType,questionType,points,b.title.trim(),String(b.context||'').trim(),b.prompt.trim(),JSON.stringify(options),correct[0],strengths[0],JSON.stringify(correct),JSON.stringify(strengths),b.emotion_category||correct[0],b.difficulty,b.media_id||null,conflictCodes[0]||null,b.published?1:0],conflictCodes};
}
app.post('/api/admin/questions',auth,(req,res)=>{try{const result=db.transaction(()=>{const x=questionBody(req.body),code=`ITEM-${String(db.prepare('SELECT COALESCE(MAX(id),0)+1 n FROM questions').get().n).padStart(5,'0')}`,r=db.prepare(`INSERT INTO questions(code,modality,option_type,question_type,points,title,context,prompt,options_json,correct_emotion,standard_strength,correct_emotions_json,standard_strengths_json,emotion_category,difficulty,media_id,conflict_code,published) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(code,...x.values);syncQuestionConflicts(Number(r.lastInsertRowid),x.conflictCodes);return {id:r.lastInsertRowid,code}})();res.status(201).json(result)}catch(e){res.status(400).json({error:e.message})}});
app.put('/api/admin/questions/:id',auth,(req,res)=>{try{const result=db.transaction(()=>{const x=questionBody({...req.body,id:req.params.id}),r=db.prepare(`UPDATE questions SET modality=?,option_type=?,question_type=?,points=?,title=?,context=?,prompt=?,options_json=?,correct_emotion=?,standard_strength=?,correct_emotions_json=?,standard_strengths_json=?,emotion_category=?,difficulty=?,media_id=?,conflict_code=?,published=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(...x.values,req.params.id);if(!r.changes)return false;syncQuestionConflicts(Number(req.params.id),x.conflictCodes);return true})();result?res.json({ok:true}):res.status(404).json({error:'题目不存在'})}catch(e){res.status(400).json({error:e.message})}});
app.patch('/api/admin/questions/:id/status',auth,(req,res)=>{const r=db.prepare('UPDATE questions SET published=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(req.body.published?1:0,req.params.id);r.changes?res.json({ok:true}):res.status(404).json({error:'题目不存在'})});
app.delete('/api/admin/questions/:id',auth,(req,res)=>{
  const question=db.prepare('SELECT id,code FROM questions WHERE id=?').get(req.params.id);
  if(!question)return res.status(404).json({error:'题目不存在'});
  if(db.prepare('SELECT 1 FROM attempt_questions WHERE question_id=? LIMIT 1').get(question.id))return res.status(409).json({error:'该题目已存在于历史答卷中，不能删除；可将其停用'});
  db.transaction(()=>{
    db.prepare('DELETE FROM question_conflicts WHERE question_id=? OR conflicting_question_id=?').run(question.id,question.id);
    db.prepare('UPDATE questions SET conflict_code=NULL WHERE conflict_code=?').run(question.code);
    db.prepare('DELETE FROM questions WHERE id=?').run(question.id);
  })();
  res.json({ok:true});
});
const storage=multer.diskStorage({destination:UPLOAD_DIR,filename:(req,file,cb)=>cb(null,`${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`)});
const upload=multer({storage,limits:{fileSize:Math.max(Number(process.env.IMAGE_MAX_MB||10),Number(process.env.AUDIO_MAX_MB||30),Number(process.env.VIDEO_MAX_MB||100))*1024*1024},fileFilter:(req,file,cb)=>cb(null,/^(image|audio|video)\//.test(file.mimetype))});
app.post('/api/admin/media',auth,upload.single('file'),(req,res)=>{if(!req.file)return res.status(400).json({error:'请选择有效的图片、音频或视频'});const type=req.file.mimetype.split('/')[0],limits={image:+(process.env.IMAGE_MAX_MB||10),audio:+(process.env.AUDIO_MAX_MB||30),video:+(process.env.VIDEO_MAX_MB||100)};if(req.file.size>limits[type]*1024*1024){fs.unlinkSync(req.file.path);return res.status(400).json({error:`${type} 文件不能超过 ${limits[type]}MB`})}const r=db.prepare('INSERT INTO media_files(original_name,stored_name,mime_type,size) VALUES(?,?,?,?)').run(req.file.originalname,req.file.filename,req.file.mimetype,req.file.size);res.status(201).json({id:r.lastInsertRowid,url:`/uploads/${req.file.filename}`})});
app.delete('/api/admin/media/:id',auth,(req,res)=>{if(db.prepare('SELECT 1 FROM questions WHERE media_id=?').get(req.params.id))return res.status(409).json({error:'素材正在被题目使用'});const m=db.prepare('SELECT * FROM media_files WHERE id=?').get(req.params.id);if(!m)return res.status(404).json({error:'素材不存在'});db.prepare('DELETE FROM media_files WHERE id=?').run(m.id);fs.rmSync(path.join(UPLOAD_DIR,m.stored_name),{force:true});res.json({ok:true})});
function combinationCounts(config){try{return JSON.parse(config.combination_counts_json||'{}')}catch{return {}}}
function assessmentRules(config){try{return JSON.parse(config.assessment_rules_json||'null')}catch{return null}}
app.get('/api/admin/config',auth,(req,res)=>{const config=db.prepare('SELECT * FROM assessment_configs WHERE id=1').get();res.json({...config,combination_counts:combinationCounts(config),assessment_rules:assessmentRules(config)})});
app.patch('/api/admin/config/status',auth,(req,res)=>{
  if(typeof req.body.active!=='boolean')return res.status(400).json({error:'作答状态必须为布尔值'});
  db.prepare('UPDATE assessment_configs SET active=?,updated_at=CURRENT_TIMESTAMP WHERE id=1').run(req.body.active?1:0);
  res.json({active:req.body.active});
});
app.put('/api/admin/config',auth,(req,res)=>{
  if(req.body.assessment_rules){
    try{
      const rules=normalizeAssessmentRules(req.body.assessment_rules), total=Object.values(rules).reduce((sum,rule)=>sum+rule.total,0);
      const sum=(kind,field)=>Object.values(rules[kind][field]).reduce((value,count)=>value+(typeof count==='number'?count:count.min),0);
      db.prepare(`UPDATE assessment_configs SET total_count=?,image_count=?,text_count=?,audio_count=?,video_count=?,single_count=?,multiple_count=?,recognition_count=?,reasoning_count=?,assessment_rules_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=1`).run(total,...modalities.map(mode=>Object.values(rules).reduce((value,rule)=>value+rule.modality[mode].min,0)),...optionTypes.map(type=>Object.values(rules).reduce((value,rule)=>value+rule.option_type[type],0)),rules.recognition.total,rules.reasoning.total,JSON.stringify(rules));
      return res.json({ok:true,total_count:total,assessment_rules:rules});
    }catch(error){return res.status(400).json({error:error.message})}
  }
  const combinations=req.body.combination_counts||{}, keys=modalities.flatMap(m=>optionTypes.flatMap(o=>questionTypes.map(q=>`${m}_${o}_${q}`)));
  const values=keys.map(key=>Number(combinations[key]??0)), total=values.reduce((sum,value)=>sum+value,0);
  if(values.some(value=>!Number.isInteger(value)||value<0)||total<1)return res.status(400).json({error:'每种题目组合数量必须为非负整数，且总题量不能为 0'});
  const count=(index,value)=>keys.reduce((sum,key,i)=>sum+(key.split('_')[index]===value?values[i]:0),0);
  const modes=modalities.map(value=>count(0,value)), choices=optionTypes.map(value=>count(1,value)), kinds=questionTypes.map(value=>count(2,value));
  const stored=JSON.stringify(Object.fromEntries(keys.map((key,index)=>[key,values[index]])));
  db.prepare('UPDATE assessment_configs SET total_count=?,image_count=?,text_count=?,audio_count=?,video_count=?,single_count=?,multiple_count=?,recognition_count=?,reasoning_count=?,combination_counts_json=?,assessment_rules_json=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=1').run(total,...modes,...choices,...kinds,stored);
  res.json({ok:true,total_count:total});
});

function normalizeAssessmentRules(input){
  const output={};
  for(const kind of questionTypes){
    const source=input[kind]||{}, total=Number(source.total), difficulty={}, option_type={}, modality={};
    if(!Number.isInteger(total)||total<1)throw Error(`${kind==='recognition'?'识别':'推理'}题总数必须是正整数`);
    for(const key of difficulties){const value=Number(source.difficulty?.[key]);if(!Number.isInteger(value)||value<0)throw Error('难度题量必须是非负整数');difficulty[key]=value}
    for(const key of optionTypes){const value=Number(source.option_type?.[key]);if(!Number.isInteger(value)||value<0)throw Error('单多选题量必须是非负整数');option_type[key]=value}
    for(const key of modalities){const value=source.modality?.[key]||{},min=Number(value.min),max=Number(value.max);if(!Number.isInteger(min)||!Number.isInteger(max)||min<0||max<min)throw Error('模态范围必须是有效的非负整数');modality[key]={min,max}}
    if(Object.values(difficulty).reduce((a,b)=>a+b,0)!==total)throw Error(`${kind==='recognition'?'识别':'推理'}题的难度数量之和必须等于 ${total}`);
    if(Object.values(option_type).reduce((a,b)=>a+b,0)!==total)throw Error(`${kind==='recognition'?'识别':'推理'}题的单多选数量之和必须等于 ${total}`);
    const minimum=Object.values(modality).reduce((sum,value)=>sum+value.min,0),maximum=Object.values(modality).reduce((sum,value)=>sum+value.max,0);
    if(minimum>total||maximum<total)throw Error(`${kind==='recognition'?'识别':'推理'}题的模态范围无法组成 ${total} 道题`);
    output[kind]={total,difficulty,option_type,modality};
  }
  return output;
}

function selectQuestions(cfg){
  const pool=db.prepare(`SELECT q.*,m.stored_name,(SELECT COUNT(*) FROM attempt_questions aq WHERE aq.question_id=q.id) appearance_count,(SELECT GROUP_CONCAT(CASE WHEN qc.question_id=q.id THEN qc.conflicting_question_id ELSE qc.question_id END) FROM question_conflicts qc WHERE qc.question_id=q.id OR qc.conflicting_question_id=q.id) conflict_ids FROM questions q LEFT JOIN media_files m ON m.id=q.media_id WHERE q.published=1`).all().map(q=>({...q,conflictIds:new Set(String(q.conflict_ids||'').split(',').filter(Boolean).map(Number)),selectionTie:Math.random()})).sort((a,b)=>a.appearance_count-b.appearance_count||a.selectionTie-b.selectionTie);
  const rules=assessmentRules(cfg);
  if(rules){
    const chosen=[], chosenIds=new Set();
    function selectKind(kind){
      const rule=rules[kind], counts={difficulty:{},option_type:{},modality:{}};
      const candidates=pool.filter(question=>question.question_type===kind);
      function search(){
        const selected=Object.values(counts.difficulty).reduce((sum,value)=>sum+value,0);
        if(selected===rule.total)return difficulties.every(key=>(counts.difficulty[key]||0)===rule.difficulty[key])&&optionTypes.every(key=>(counts.option_type[key]||0)===rule.option_type[key])&&modalities.every(key=>(counts.modality[key]||0)>=rule.modality[key].min&&(counts.modality[key]||0)<=rule.modality[key].max);
        const remaining=rule.total-selected;
        for(const field of ['difficulty','option_type'])for(const key of Object.keys(rule[field]))if((counts[field][key]||0)>rule[field][key]||(counts[field][key]||0)+remaining<rule[field][key])return false;
        for(const key of modalities)if((counts.modality[key]||0)>rule.modality[key].max||(counts.modality[key]||0)+remaining<rule.modality[key].min)return false;
        const available=candidates.filter(question=>!chosenIds.has(question.id)&&!chosen.some(item=>question.conflictIds.has(item.id))&&(counts.difficulty[question.difficulty]||0)<rule.difficulty[question.difficulty]&&(counts.option_type[question.option_type]||0)<rule.option_type[question.option_type]&&(counts.modality[question.modality]||0)<rule.modality[question.modality].max);
        available.sort((a,b)=>{const need=q=>(rule.difficulty[q.difficulty]-(counts.difficulty[q.difficulty]||0))+(rule.option_type[q.option_type]-(counts.option_type[q.option_type]||0))+(rule.modality[q.modality].min-(counts.modality[q.modality]||0));return need(b)-need(a)||a.appearance_count-b.appearance_count||a.selectionTie-b.selectionTie});
        for(const question of available){chosen.push(question);chosenIds.add(question.id);for(const field of ['difficulty','option_type','modality'])counts[field][question[field]]=(counts[field][question[field]]||0)+1;if(search())return true;for(const field of ['difficulty','option_type','modality'])counts[field][question[field]]--;chosenIds.delete(question.id);chosen.pop()}
        return false;
      }
      return search();
    }
    return selectKind('recognition')&&selectKind('reasoning')?chosen:null;
  }
  const targets=combinationCounts(cfg), keys=modalities.flatMap(m=>optionTypes.flatMap(o=>questionTypes.map(q=>`${m}_${o}_${q}`)));
  function search(start,chosen,counts){if(chosen.length===cfg.total_count)return keys.every(key=>(counts[key]||0)===(targets[key]||0))?chosen:null;for(let i=start;i<pool.length;i++){const q=pool[i],key=`${q.modality}_${q.option_type}_${q.question_type}`;if((counts[key]||0)>=(targets[key]||0))continue;if(chosen.some(x=>q.conflictIds.has(x.id)))continue;const found=search(i+1,[...chosen,q],{...counts,[key]:(counts[key]||0)+1});if(found)return found}return null}
  return search(0,[],{});
}
app.get('/api/assessment/status',(req,res)=>{const config=db.prepare('SELECT active FROM assessment_configs WHERE id=1').get();res.json({active:!!config?.active})});
app.post('/api/attempts',(req,res)=>{const cfg=db.prepare('SELECT * FROM assessment_configs WHERE id=1 AND active=1').get();if(!cfg)return res.status(503).json({error:'当前题目收集已满'});const selected=selectQuestions(cfg);if(!selected)return res.status(503).json({error:'题库无法满足当前配额或冲突规则，请联系管理员'});selected.sort(()=>Math.random()-.5);const token=crypto.randomBytes(32).toString('base64url'),publicId=`ZJ${new Date().toISOString().slice(0,10).replace(/-/g,'')}${crypto.randomBytes(4).toString('hex').toUpperCase()}`;const create=db.transaction(()=>{const a=db.prepare('INSERT INTO attempts(public_id,token_hash,status) VALUES(?,?,?)').run(publicId,tokenHash(token),'in_progress');const ins=db.prepare(`INSERT INTO attempt_questions(attempt_id,question_id,position,modality_snapshot,title_snapshot,context_snapshot,prompt_snapshot,options_snapshot,correct_emotion_snapshot,standard_strength_snapshot,emotion_category_snapshot,media_url_snapshot,option_type_snapshot,question_type_snapshot,points_snapshot,correct_emotions_snapshot,standard_strengths_snapshot) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);selected.forEach((q,i)=>ins.run(a.lastInsertRowid,q.id,i+1,q.modality,q.title,q.context,q.prompt,JSON.stringify(buildAttemptOptions(q.options_json)),q.correct_emotion,q.standard_strength,q.emotion_category,q.stored_name?`/uploads/${q.stored_name}`:null,q.option_type,q.question_type,q.points,q.correct_emotions_json,q.standard_strengths_json));return a.lastInsertRowid});create();res.status(201).json({id:publicId,token})});
function publicAttempt(a){const qs=db.prepare(`SELECT aq.id,aq.position,aq.modality_snapshot modality,aq.title_snapshot title,aq.context_snapshot context,aq.prompt_snapshot prompt,aq.options_snapshot options_json,aq.media_url_snapshot media_url,aq.option_type_snapshot option_type,aq.question_type_snapshot question_type,aq.points_snapshot points,r.emotion,r.strength,r.emotions_json,r.strengths_json,r.watched_source,r.skipped,r.response_time_ms,r.modification_count FROM attempt_questions aq LEFT JOIN responses r ON r.attempt_question_id=aq.id WHERE aq.attempt_id=? ORDER BY aq.position`).all(a.id).map(q=>({...q,options:JSON.parse(q.options_json),emotions:q.emotions_json?JSON.parse(q.emotions_json):(q.emotion?[q.emotion]:[]),strengths:q.strengths_json?JSON.parse(q.strengths_json):(q.strength?[q.strength]:[]),options_json:undefined,emotions_json:undefined,strengths_json:undefined}));return {id:a.public_id,status:a.status,started_at:a.started_at,submitted_at:a.submitted_at,total_score:a.total_score,questions:qs}}
app.get('/api/attempts/:id',attemptAuth,(req,res)=>res.json(publicAttempt(req.attempt)));
app.put('/api/attempts/:id/responses/:position',attemptAuth,(req,res)=>{if(req.attempt.status==='completed')return res.status(409).json({error:'测评已经提交'});const q=db.prepare('SELECT * FROM attempt_questions WHERE attempt_id=? AND position=?').get(req.attempt.id,req.params.position);if(!q)return res.status(404).json({error:'题目不存在'});const skipped=!!req.body.skipped, options=JSON.parse(q.options_snapshot), emotions=[...new Set((Array.isArray(req.body.emotions)?req.body.emotions:[req.body.emotion]).filter(Boolean))], strengths=(Array.isArray(req.body.strengths)?req.body.strengths:[req.body.strength]).map(Number);if(!skipped&&(emotions.length<1||emotions.length>(q.option_type_snapshot==='single'?1:5)||emotions.some(x=>!options.includes(x))||strengths.length!==emotions.length||strengths.some(x=>![1,2,3,4,5].includes(x))))return res.status(400).json({error:'答案不合法'});const watched=req.body.watched_source===true?1:req.body.watched_source===false?0:null;db.prepare(`INSERT INTO responses(attempt_question_id,emotion,strength,emotions_json,strengths_json,watched_source,skipped,response_time_ms,modification_count) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(attempt_question_id) DO UPDATE SET emotion=excluded.emotion,strength=excluded.strength,emotions_json=excluded.emotions_json,strengths_json=excluded.strengths_json,watched_source=excluded.watched_source,skipped=excluded.skipped,response_time_ms=excluded.response_time_ms,modification_count=excluded.modification_count,saved_at=CURRENT_TIMESTAMP`).run(q.id,skipped?null:emotions[0],skipped?null:strengths[0],skipped?null:JSON.stringify(emotions),skipped?null:JSON.stringify(strengths),watched,skipped?1:0,Math.max(0,Number(req.body.response_time_ms)||0),Math.max(0,Number(req.body.modification_count)||0));res.json({ok:true})});
function weightedRate(rows,key){const weight=rows.reduce((sum,row)=>sum+(row.points||0),0);return weight?+(rows.reduce((sum,row)=>sum+(Number(row[key])||0)*row.points,0)/weight).toFixed(2):null}
function groupedRates(rows,key){const groups={};for(const row of rows)(groups[row[key]]??=[]).push(row);return Object.fromEntries(Object.entries(groups).map(([name,items])=>[name,weightedRate(items,'total_score')]))}
function groupedCounts(rows,key){const counts={};for(const row of rows)counts[row[key]]=(counts[row[key]]||0)+1;return counts}
function dimensionReport(attemptId){const rows=db.prepare(`SELECT aq.modality_snapshot modality,aq.question_type_snapshot question_type,aq.emotion_category_snapshot emotion_category,aq.points_snapshot points,r.label_score,r.strength_score,r.total_score FROM attempt_questions aq JOIN responses r ON r.attempt_question_id=aq.id WHERE aq.attempt_id=?`).all(attemptId);const recognition=rows.filter(row=>row.question_type==='recognition'),reasoning=rows.filter(row=>row.question_type==='reasoning'),maxPoints=rows.reduce((sum,row)=>sum+row.points,0);return {max_points:+maxPoints.toFixed(2),earned_points:+(rows.reduce((sum,row)=>sum+row.total_score*row.points/100,0)).toFixed(2),by_question_type:{recognition:weightedRate(recognition,'total_score'),reasoning:weightedRate(reasoning,'total_score')},recognition_details:{label:weightedRate(recognition,'label_score'),strength:weightedRate(recognition,'strength_score')},by_modality:groupedRates(rows,'modality'),by_emotion:groupedRates(rows,'emotion_category'),sample_sizes:{total:rows.length,question_types:{recognition:recognition.length,reasoning:reasoning.length},modalities:groupedCounts(rows,'modality')}}}
app.post('/api/attempts/:id/submit',attemptAuth,requireCompleteAttempt,(req,res)=>{if(req.attempt.status==='completed')return res.status(409).json({error:'测评已经提交'});const result=db.transaction(()=>{const qs=db.prepare(`SELECT aq.*,r.id response_id,r.emotion,r.strength,r.emotions_json,r.strengths_json,r.skipped,r.response_time_ms FROM attempt_questions aq LEFT JOIN responses r ON r.attempt_question_id=aq.id WHERE aq.attempt_id=?`).all(req.attempt.id);let label=0,strength=0,total=0,weight=0;const byMode={},byEmotion={};for(const q of qs){let ls=0,ss=0;if(q.response_id&&!q.skipped){const answers=q.emotions_json?JSON.parse(q.emotions_json):[q.emotion],values=q.strengths_json?JSON.parse(q.strengths_json):[q.strength],correct=JSON.parse(q.correct_emotions_snapshot||JSON.stringify([q.correct_emotion_snapshot])),standards=JSON.parse(q.standard_strengths_snapshot||JSON.stringify([q.standard_strength_snapshot])),hits=answers.filter(x=>correct.includes(x)).length;ls=correct.length===1?(hits===1?100:0):(hits?100*(2*hits/(answers.length+correct.length)):0);const matched=correct.map((emotion,i)=>{const index=answers.indexOf(emotion);return index<0?0:Math.max(0,1-Math.abs(values[index]-standards[i])/4)*100});ss=matched.reduce((a,b)=>a+b,0)/correct.length}const score=ls*.6+ss*.4,w=q.points_snapshot||100;label+=ls*w;strength+=ss*w;total+=score*w;weight+=w;(byMode[q.modality_snapshot]??=[]).push(score);(byEmotion[q.emotion_category_snapshot]??=[]).push(score);if(q.response_id)db.prepare('UPDATE responses SET label_score=?,strength_score=?,total_score=? WHERE id=?').run(ls,ss,score,q.response_id)}const avg=x=>x.length?x.reduce((a,b)=>a+b,0)/x.length:0,duration=qs.reduce((s,q)=>s+(q.response_time_ms||0),0);const report={overall:+(total/weight).toFixed(2),label:+(label/weight).toFixed(2),strength:+(strength/weight).toFixed(2),average_response_ms:Math.round(duration/qs.length),by_modality:Object.fromEntries(Object.entries(byMode).map(([k,v])=>[k,+avg(v).toFixed(2)])),by_emotion:Object.fromEntries(Object.entries(byEmotion).map(([k,v])=>[k,+avg(v).toFixed(2)]))};Object.assign(report,dimensionReport(req.attempt.id));db.prepare("UPDATE attempts SET status='completed',submitted_at=CURRENT_TIMESTAMP,total_score=?,label_score=?,strength_score=?,duration_ms=?,report_json=? WHERE id=?").run(report.overall,report.label,report.strength,duration,JSON.stringify(report),req.attempt.id);return report})();res.json(result)});
app.get('/api/attempts/:id/report',attemptAuth,(req,res)=>{if(req.attempt.status!=='completed')return res.status(409).json({error:'测评尚未完成'});const report=JSON.parse(req.attempt.report_json);if(!report.by_question_type||!report.sample_sizes){Object.assign(report,dimensionReport(req.attempt.id));db.prepare('UPDATE attempts SET report_json=? WHERE id=?').run(JSON.stringify(report),req.attempt.id)}res.json(report)});
app.get('/api/attempts/:id/review',attemptAuth,(req,res)=>{if(req.attempt.status!=='completed')return res.status(409).json({error:'测评尚未完成'});const rows=db.prepare(`SELECT aq.position,q.code,aq.title_snapshot title,aq.context_snapshot context,aq.prompt_snapshot prompt,aq.modality_snapshot modality,aq.media_url_snapshot media_url,aq.option_type_snapshot option_type,aq.points_snapshot points,aq.correct_emotion_snapshot,aq.standard_strength_snapshot,aq.correct_emotions_snapshot,aq.standard_strengths_snapshot,r.emotion,r.strength,r.emotions_json,r.strengths_json,r.total_score,r.label_score,r.strength_score,r.response_time_ms,f.content feedback,f.status feedback_status FROM attempt_questions aq JOIN questions q ON q.id=aq.question_id JOIN responses r ON r.attempt_question_id=aq.id LEFT JOIN attempt_question_feedback f ON f.attempt_question_id=aq.id WHERE aq.attempt_id=? ORDER BY aq.position`).all(req.attempt.id).map(row=>({...row,emotions:row.emotions_json?JSON.parse(row.emotions_json):[row.emotion].filter(Boolean),strengths:row.strengths_json?JSON.parse(row.strengths_json):[row.strength].filter(value=>value!=null),correct_emotions:row.correct_emotions_snapshot?JSON.parse(row.correct_emotions_snapshot):[row.correct_emotion_snapshot].filter(Boolean),standard_strengths:row.standard_strengths_snapshot?JSON.parse(row.standard_strengths_snapshot):[row.standard_strength_snapshot].filter(value=>value!=null),emotion:undefined,strength:undefined,correct_emotion_snapshot:undefined,standard_strength_snapshot:undefined,emotions_json:undefined,strengths_json:undefined,correct_emotions_snapshot:undefined,standard_strengths_snapshot:undefined}));res.json(rows)});
app.post('/api/attempts/:id/questions/:position/feedback',attemptAuth,(req,res)=>{if(req.attempt.status!=='completed')return res.status(409).json({error:'完成测评后才能反馈'});const content=String(req.body.content||'').trim();if(content.length<5||content.length>1000)return res.status(400).json({error:'反馈内容需为 5–1000 个字符'});const question=db.prepare('SELECT id FROM attempt_questions WHERE attempt_id=? AND position=?').get(req.attempt.id,req.params.position);if(!question)return res.status(404).json({error:'题目不存在'});db.prepare(`INSERT INTO attempt_question_feedback(attempt_question_id,content) VALUES(?,?) ON CONFLICT(attempt_question_id) DO UPDATE SET content=excluded.content,status='pending',updated_at=CURRENT_TIMESTAMP`).run(question.id,content);res.json({ok:true,status:'pending'})});
const feedbackStyles={warm:'温暖鼓励',professional:'专业分析',concise:'简洁直接'};
function completeText(value,maxLength){const text=String(value||'').replace(/\s+/g,' ').trim();if(text.length<=maxLength)return text;const sentences=text.match(/[^。！？]*[。！？]/g)||[],complete=sentences.reduce((result,sentence)=>result.length+sentence.length<=maxLength?result+sentence:result,'');if(complete.length>=80)return complete;return text.slice(0,maxLength-1).replace(/[，、；：\s]+$/,'')+'。'}
function localFeedback(report,style){const recognition=report.by_question_type?.recognition,reasoning=report.by_question_type?.reasoning,opening=style==='professional'?'从加权得分结构看':style==='concise'?'本次测评结果显示':'谢谢你认真完成本次测评。整体来看',comparison=recognition==null||reasoning==null?'当前题型样本尚不足以完成情绪识别与情绪推理的稳定对比':recognition>=reasoning?`情绪识别得分率为 ${recognition}%，高于情绪推理的 ${reasoning}%`:`情绪推理得分率为 ${reasoning}%，高于情绪识别的 ${recognition}%`;return {overview:`${opening}，你的综合得分率为 ${report.overall}%，实际获得 ${report.earned_points}/${report.max_points} 分。${comparison}。各维度结果均按题目分值加权，建议结合图表中的题目数量理解，题目较少的维度暂不宜做稳定能力判断。`,recommendations:'建议在日常交流中同时记录人物措辞、语调、表情、动作与情境背景，再比较这些线索是否指向同一情绪。形成第一判断后，可主动提出另一种可能解释，并回看自己对情绪类别与强度的判断差异。持续进行“观察—判断—验证—复盘”的练习，比单纯记忆情绪标签更有助于提升复杂情境下的感知稳定性。'}}
async function modelFeedback(report,style){const apiKey=process.env.LLM_API_KEY,model=process.env.LLM_MODEL;if(!apiKey||!model)return null;const base=(process.env.LLM_BASE_URL||'https://api.openai.com/v1').replace(/\/$/,'');const summary={overall:report.overall,earned_points:report.earned_points,max_points:report.max_points,question_types:report.by_question_type,recognition_details:report.recognition_details,modalities:report.by_modality,sample_sizes:report.sample_sizes,average_response_ms:report.average_response_ms};const response=await fetch(`${base}/chat/completions`,{method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},body:JSON.stringify({model,temperature:0.6,max_tokens:900,messages:[{role:'system',content:'你是情绪感知测评报告助手。根据量化结果分别撰写整体表现解读和下一步建议，总字数350至500个中文字符。不得进行心理或医学诊断，不得虚构常模、百分位或未提供的数据；样本题数较少时必须提示谨慎解释。只输出JSON对象，格式为{"overview":"整体解读","recommendations":"建议"}，不要使用Markdown。'},{role:'user',content:`反馈风格：${feedbackStyles[style]}。测评结果：${JSON.stringify(summary)}`}]}),signal:AbortSignal.timeout(Number(process.env.LLM_TIMEOUT_MS)||45000)});if(!response.ok){const detail=await response.text().catch(()=>'');throw Error(`模型接口返回 ${response.status}${detail?`: ${detail.slice(0,300)}`:''}`)}const data=await response.json(),content=data.choices?.[0]?.message?.content?.trim();if(!content)throw Error('模型接口未返回报告');let parsed;try{parsed=JSON.parse(content.replace(/^```(?:json)?\s*|\s*```$/g,''))}catch{throw Error('模型接口未返回有效的报告JSON')}if(!parsed.overview||!parsed.recommendations)throw Error('模型报告字段不完整');return {overview:completeText(parsed.overview,278),recommendations:completeText(parsed.recommendations,220)}}
app.post('/api/attempts/:id/feedback',attemptAuth,asyncWrap(async(req,res)=>{if(req.attempt.status!=='completed')return res.status(409).json({error:'测评尚未完成'});const style=feedbackStyles[req.body.style]?req.body.style:'warm',report=JSON.parse(req.attempt.report_json),cached=report.feedback_cache?.[style],modelConfigured=!!(process.env.LLM_API_KEY&&process.env.LLM_MODEL);if(cached?.version===2&&(cached.source==='model'||!modelConfigured))return res.json({...cached,cached:true});let sections,source='model',warning;try{sections=await modelFeedback(report,style);if(!sections){source='local';sections=localFeedback(report,style)}}catch(error){console.error(`LLM feedback failed: ${error.message}`);source='local';warning='模型服务暂不可用，已显示本地报告';sections=localFeedback(report,style)}const feedback={...sections,text:`${sections.overview}\n\n${sections.recommendations}`,version:2,style,style_label:feedbackStyles[style],source};report.feedback_cache={...(report.feedback_cache||{}),[style]:feedback};db.prepare('UPDATE attempts SET report_json=? WHERE id=?').run(JSON.stringify(report),req.attempt.id);res.json({...feedback,warning,cached:false})}));

function attemptFilters(q,{completedOnly=true}={}){let w=completedOnly?["a.status='completed'"]:['1=1'],v=[];if(q.id){w.push('a.public_id LIKE ?');v.push(`%${q.id}%`)}if(q.min_score){w.push('a.total_score>=?');v.push(+q.min_score)}if(q.from){w.push("(a.submitted_at>=datetime(?,'-8 hours') OR (a.submitted_at IS NULL AND a.started_at>=datetime(?,'-8 hours')))");v.push(q.from,q.from)}if(q.to){w.push("(a.submitted_at<=datetime(?,'-8 hours') OR (a.submitted_at IS NULL AND a.started_at<=datetime(?,'-8 hours')))");v.push(q.to+' 23:59:59',q.to+' 23:59:59')}return {sql:w.join(' AND '),values:v}}
function analyticsFilter(q){const where=["a.status='completed'"],values=[],validDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(value||'');if(q.from&&validDate(q.from)){where.push("a.submitted_at>=datetime(?,'-8 hours')");values.push(q.from)}if(q.to&&validDate(q.to)){where.push("a.submitted_at<=datetime(?,'-8 hours')");values.push(q.to+' 23:59:59')}if(!q.from&&!q.to&&['7d','30d','90d'].includes(q.range)){where.push(`a.submitted_at>=datetime('now','-${Number(q.range.slice(0,-1))} days')`)}return {sql:where.join(' AND '),values}}
const round=(value,digits=2)=>value==null?null:+Number(value).toFixed(digits);
function median(values){if(!values.length)return null;const sorted=[...values].sort((a,b)=>a-b),middle=Math.floor(sorted.length/2);return sorted.length%2?sorted[middle]:(sorted[middle-1]+sorted[middle])/2}
function analyticsData(query){
  const filter=analyticsFilter(query),attempts=db.prepare(`SELECT a.id,a.total_score,a.label_score,a.strength_score,a.duration_ms,a.submitted_at FROM attempts a WHERE ${filter.sql} ORDER BY a.submitted_at`).all(...filter.values);
  if(!attempts.length)return {summary:{completed:0,average_score:null,median_score:null,highest_score:null,lowest_score:null,average_duration_ms:null,label_score:null,strength_score:null},trend:[],distribution:[['0–59',0],['60–69',0],['70–79',0],['80–89',0],['90–100',0]].map(([label,count])=>({label,count})),dimensions:{modalities:[],question_types:[],option_types:[]},questions:[]};
  const responses=db.prepare(`SELECT aq.question_id,q.code question_code,aq.title_snapshot title,aq.modality_snapshot modality,aq.question_type_snapshot question_type,aq.option_type_snapshot option_type,aq.points_snapshot points,r.label_score,r.strength_score,r.total_score,r.response_time_ms,r.modification_count,r.emotion,r.emotions_json FROM attempts a JOIN attempt_questions aq ON aq.attempt_id=a.id JOIN questions q ON q.id=aq.question_id JOIN responses r ON r.attempt_question_id=aq.id WHERE ${filter.sql} AND r.skipped=0`).all(...filter.values);
  const scores=attempts.map(row=>Number(row.total_score)).filter(Number.isFinite),durations=attempts.map(row=>Number(row.duration_ms)).filter(value=>value>0),mean=values=>values.length?values.reduce((sum,value)=>sum+value,0)/values.length:null;
  const summary={completed:attempts.length,average_score:round(mean(scores)),median_score:round(median(scores)),highest_score:round(scores.length?Math.max(...scores):null),lowest_score:round(scores.length?Math.min(...scores):null),average_duration_ms:round(mean(durations),0),label_score:round(mean(attempts.map(row=>Number(row.label_score)).filter(Number.isFinite))),strength_score:round(mean(attempts.map(row=>Number(row.strength_score)).filter(Number.isFinite)))};
  const trendMap={};for(const row of attempts){const date=new Date(`${String(row.submitted_at).replace(' ','T')}Z`),day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);trendMap[day]=(trendMap[day]||0)+1}const trend=Object.entries(trendMap).map(([day,count])=>({day,count}));
  const bins=[{label:'0–59',min:0,max:60},{label:'60–69',min:60,max:70},{label:'70–79',min:70,max:80},{label:'80–89',min:80,max:90},{label:'90–100',min:90,max:101}],distribution=bins.map(bin=>({label:bin.label,count:scores.filter(score=>score>=bin.min&&score<bin.max).length}));
  const dimension=(field,values)=>values.map(([key,label])=>{const rows=responses.filter(row=>row[field]===key),weight=rows.reduce((sum,row)=>sum+Number(row.points||0),0),times=rows.map(row=>Number(row.response_time_ms)).filter(value=>value>0);return {key,label,count:rows.length,score:weight?round(rows.reduce((sum,row)=>sum+Number(row.total_score||0)*Number(row.points||0),0)/weight):null,average_time_ms:round(mean(times),0),time_samples:times.length}});
  const dimensions={modalities:dimension('modality',[['image','图像'],['text','文本'],['audio','音频'],['video','视频']]),question_types:dimension('question_type',[['recognition','情绪识别'],['reasoning','情绪推理']]),option_types:dimension('option_type',[['single','单选题'],['multiple','多选题']])};
  const groups={};for(const row of responses)(groups[row.question_id]??=[]).push(row);const questions=Object.entries(groups).map(([questionId,rows])=>{const times=rows.map(row=>Number(row.response_time_ms)).filter(value=>value>0),emotionCounts={};for(const row of rows){let emotions=[];try{emotions=row.emotions_json?JSON.parse(row.emotions_json):[row.emotion].filter(Boolean)}catch{emotions=[row.emotion].filter(Boolean)}for(const emotion of emotions)emotionCounts[emotion]=(emotionCounts[emotion]||0)+1}const top=Object.entries(emotionCounts).sort((a,b)=>b[1]-a[1])[0];return {question_id:+questionId,question_code:rows[0].question_code,title:rows[0].title,modality:rows[0].modality,question_type:rows[0].question_type,option_type:rows[0].option_type,sample_size:rows.length,average_score:round(mean(rows.map(row=>Number(row.total_score)||0))),exact_label_rate:round(rows.filter(row=>Number(row.label_score)===100).length/rows.length*100),average_strength_score:round(mean(rows.map(row=>Number(row.strength_score)||0))),average_time_ms:round(mean(times),0),median_time_ms:round(median(times),0),time_samples:times.length,average_modifications:round(mean(rows.map(row=>Number(row.modification_count)||0)),2),top_emotion:top?.[0]||null,top_emotion_rate:top?round(top[1]/rows.length*100):null,low_sample:rows.length<10}}).sort((a,b)=>a.average_score-b.average_score);
  return {summary,trend,distribution,dimensions,questions};
}
app.get('/api/admin/analytics',auth,(req,res)=>res.json(analyticsData(req.query)));
app.get('/api/admin/analytics/questions.csv',auth,(req,res)=>{
  const rows=analyticsData(req.query).questions, modalityLabels={image:'图像',text:'文本',audio:'音频',video:'视频'}, questionTypeLabels={recognition:'情绪识别',reasoning:'情绪推理'}, optionTypeLabels={single:'单选题',multiple:'多选题'};
  const head=['题目编号','题目标题','素材模态','能力类型','选项形式','作答样本量','平均综合得分率（%）','完全识别正确率（%）','平均强度得分率（%）','平均用时（秒）','中位用时（秒）','有效用时样本量','平均修改次数','最常选择情绪','选择比例（%）','样本状态'];
  const number=value=>value==null?'':Number(value).toFixed(2), seconds=value=>value==null?'':(Number(value)/1000).toFixed(2);
  const body=rows.map(row=>[row.question_code,row.title,modalityLabels[row.modality]||row.modality,questionTypeLabels[row.question_type]||row.question_type,optionTypeLabels[row.option_type]||row.option_type,row.sample_size,number(row.average_score),number(row.exact_label_rate),number(row.average_strength_score),seconds(row.average_time_ms),seconds(row.median_time_ms),row.time_samples,number(row.average_modifications),row.top_emotion||'',number(row.top_emotion_rate),row.low_sample?'样本不足（少于10份）':'样本充足']);
  const period=req.query.from||req.query.to?[req.query.from||'开始',req.query.to||'当前'].join('_'):({all:'全部', '7d':'近7天','30d':'近30天','90d':'近90天'}[req.query.range]||'全部'), filename=`zhijing-question-analysis-${period}.csv`;
  res.type('text/csv; charset=utf-8').set('Content-Disposition',`attachment; filename="question-analysis.csv"; filename*=UTF-8''${encodeURIComponent(filename)}`).send('\ufeff'+[head,...body].map(row=>row.map(csvCell).join(',')).join('\r\n'));
});
app.get('/api/admin/question-feedback',auth,(req,res)=>{const status=['pending','handled'].includes(req.query.status)?req.query.status:null,args=status?[status]:[];res.json(db.prepare(`SELECT f.id,f.content,f.status,f.created_at,f.updated_at,a.public_id,aq.position,q.code,aq.title_snapshot title,aq.prompt_snapshot prompt FROM attempt_question_feedback f JOIN attempt_questions aq ON aq.id=f.attempt_question_id JOIN attempts a ON a.id=aq.attempt_id JOIN questions q ON q.id=aq.question_id ${status?'WHERE f.status=?':''} ORDER BY CASE f.status WHEN 'pending' THEN 0 ELSE 1 END,f.updated_at DESC`).all(...args))});
app.patch('/api/admin/question-feedback/:id',auth,(req,res)=>{if(!['pending','handled'].includes(req.body.status))return res.status(400).json({error:'反馈状态不合法'});const result=db.prepare('UPDATE attempt_question_feedback SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(req.body.status,req.params.id);result.changes?res.json({ok:true}):res.status(404).json({error:'反馈不存在'})});
app.get('/api/admin/attempts',auth,(req,res)=>{const f=attemptFilters(req.query,{completedOnly:false});res.json(db.prepare(`SELECT public_id,status,started_at,submitted_at,total_score,label_score,strength_score,duration_ms FROM attempts a WHERE ${f.sql} ORDER BY COALESCE(submitted_at,started_at) DESC LIMIT 500`).all(...f.values))});
app.get('/api/admin/attempts/:id',auth,(req,res)=>{const a=db.prepare('SELECT * FROM attempts WHERE public_id=?').get(req.params.id);if(!a)return res.status(404).json({error:'答卷不存在'});const rows=db.prepare(`SELECT aq.position,aq.title_snapshot title,aq.modality_snapshot modality,aq.correct_emotion_snapshot correct_emotion,aq.standard_strength_snapshot standard_strength,aq.correct_emotions_snapshot,aq.standard_strengths_snapshot,r.emotion,r.strength,r.emotions_json,r.strengths_json,r.watched_source,r.skipped,r.label_score,r.strength_score,r.total_score,r.response_time_ms,r.modification_count FROM attempt_questions aq LEFT JOIN responses r ON r.attempt_question_id=aq.id WHERE aq.attempt_id=? ORDER BY aq.position`).all(a.id).map(r=>({...r,emotions:r.emotions_json?JSON.parse(r.emotions_json):[r.emotion].filter(Boolean),strengths:r.strengths_json?JSON.parse(r.strengths_json):[r.strength].filter(Boolean),correct_emotions:JSON.parse(r.correct_emotions_snapshot||JSON.stringify([r.correct_emotion])),standard_strengths:JSON.parse(r.standard_strengths_snapshot||JSON.stringify([r.standard_strength]))}));res.json({...a,token_hash:undefined,report:a.report_json?JSON.parse(a.report_json):null,responses:rows})});
app.delete('/api/admin/attempts/:id',auth,(req,res)=>{
  const attempt=db.prepare('SELECT id FROM attempts WHERE public_id=?').get(req.params.id);
  if(!attempt)return res.status(404).json({error:'答卷不存在'});
  db.transaction(()=>{
    db.prepare('DELETE FROM responses WHERE attempt_question_id IN (SELECT id FROM attempt_questions WHERE attempt_id=?)').run(attempt.id);
    db.prepare('DELETE FROM attempt_questions WHERE attempt_id=?').run(attempt.id);
    db.prepare('DELETE FROM attempts WHERE id=?').run(attempt.id);
  })();
  res.json({ok:true});
});
const csvCell=x=>{let value=String(x??'');if(/^[=+\-@]/.test(value))value=`'${value}`;return `"${value.replace(/"/g,'""')}"`};
app.get('/api/admin/attempts.csv',auth,(req,res)=>{
  const f=attemptFilters(req.query), rows=db.prepare(`SELECT a.public_id,datetime(a.submitted_at,'+8 hours') submitted_at,a.total_score attempt_score,aq.position,q.code question_code,aq.title_snapshot title,aq.modality_snapshot modality,aq.question_type_snapshot question_type,aq.option_type_snapshot option_type,aq.points_snapshot points,aq.options_snapshot,aq.correct_emotion_snapshot,aq.standard_strength_snapshot,aq.correct_emotions_snapshot,aq.standard_strengths_snapshot,r.emotion,r.strength,r.emotions_json,r.strengths_json,r.watched_source,r.skipped,r.label_score,r.strength_score,r.total_score question_score,r.response_time_ms,r.modification_count FROM attempts a JOIN attempt_questions aq ON aq.attempt_id=a.id JOIN questions q ON q.id=aq.question_id LEFT JOIN responses r ON r.attempt_question_id=aq.id WHERE ${f.sql} ORDER BY a.submitted_at DESC,aq.position`).all(...f.values);
  const modalityLabels={image:'图像',text:'文本',audio:'音频',video:'视频'}, questionTypeLabels={recognition:'情绪识别',reasoning:'情绪推理'}, optionTypeLabels={single:'单选题',multiple:'多选题'}, parseList=(json,fallback)=>{try{const values=JSON.parse(json||'null');if(Array.isArray(values))return values}catch{}return fallback==null?[]:[fallback]}, join=values=>values.join('｜'), number=value=>value==null?'':Number(value).toFixed(2);
  const head=['匿名答卷编号','提交时间（北京时间）','答卷综合得分率（%）','题号','题目编号','题目标题','素材模态','能力类型','选项形式','题目分值','本题候选情绪','用户选择情绪','用户情绪强度','标准情绪','标准情绪强度','是否看过素材','作答状态','标签得分率（%）','强度得分率（%）','单题综合得分率（%）','单题实得分','作答用时（秒）','修改次数'];
  const body=rows.map(row=>{const options=parseList(row.options_snapshot),emotions=parseList(row.emotions_json,row.emotion),strengths=parseList(row.strengths_json,row.strength),correct=parseList(row.correct_emotions_snapshot,row.correct_emotion_snapshot),standards=parseList(row.standard_strengths_snapshot,row.standard_strength_snapshot);return [row.public_id,row.submitted_at,number(row.attempt_score),row.position,row.question_code,row.title,modalityLabels[row.modality]||row.modality,questionTypeLabels[row.question_type]||row.question_type,optionTypeLabels[row.option_type]||row.option_type,number(row.points),join(options),join(emotions),join(strengths),join(correct),join(standards),row.watched_source==null?'未填写':row.watched_source?'是':'否',row.skipped?'跳过':'已作答',number(row.label_score),number(row.strength_score),number(row.question_score),row.question_score==null?'':number(row.question_score*row.points/100),row.response_time_ms==null?'':number(row.response_time_ms/1000),row.modification_count??'']});
  const period=req.query.from||req.query.to?[req.query.from||'开始',req.query.to||'当前'].join('_'):'全部', filename=`zhijing-attempt-details-${period}.csv`;
  res.type('text/csv; charset=utf-8').set('Content-Disposition',`attachment; filename="attempt-details.csv"; filename*=UTF-8''${encodeURIComponent(filename)}`).send('\ufeff'+[head,...body].map(row=>row.map(csvCell).join(',')).join('\r\n'));
});

app.use('/uploads',express.static(UPLOAD_DIR,{maxAge:'7d',fallthrough:false}));
app.get('/admin/login',(req,res)=>res.sendFile(path.join(ROOT,'admin.html'))); app.get('/admin',(req,res)=>res.sendFile(path.join(ROOT,'admin.html')));
app.get('/',(req,res)=>res.sendFile(path.join(ROOT,'index.html')));
for(const file of ['app.js','desktop.css','mobile.css','media.css','admin.js','admin.css']) app.get(`/${file}`,(req,res)=>res.sendFile(path.join(ROOT,file)));
app.use((err,req,res,next)=>{console.error(`${new Date().toISOString()} ${req.method} ${req.path}: ${err.message}`);if(err instanceof multer.MulterError)return res.status(400).json({error:'上传文件过大或格式不正确'});res.status(500).json({error:'服务器处理失败'})});
const port=Number(process.env.PORT||3001), host=process.env.HOST||'127.0.0.1';
if(require.main===module)app.listen(port,host,()=>console.log(`知境服务已启动: http://${host}:${port}`));
module.exports={app,db,hashPassword,normalizeAssessmentRules,selectQuestions};
