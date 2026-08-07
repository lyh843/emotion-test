const express = require('express');
const session = require('express-session');
const multer = require('multer');
const Database = require('better-sqlite3');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
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
  seed();
}
function seed() {
  const username=process.env.ADMIN_USERNAME||'admin', password=process.env.ADMIN_PASSWORD||'admin123!';
  if (!db.prepare('SELECT id FROM admins LIMIT 1').get()) db.prepare('INSERT INTO admins(username,password_hash) VALUES(?,?)').run(username,hashPassword(password));
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
app.use(session({secret:process.env.SESSION_SECRET||crypto.randomBytes(32).toString('hex'),resave:false,saveUninitialized:false,cookie:{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',maxAge:8*60*60*1000}}));
const asyncWrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
const auth=(req,res,next)=>req.session.adminId?next():res.status(401).json({error:'请先登录'});
const modalities=['image','text','audio','video'], difficulties=['easy','medium','hard'], optionTypes=['single','multiple'], questionTypes=['recognition','reasoning'];
const tokenHash=t=>crypto.createHash('sha256').update(t).digest('hex');
function attemptAuth(req,res,next){const token=req.get('X-Attempt-Token');const a=db.prepare('SELECT * FROM attempts WHERE public_id=?').get(req.params.id);if(!token||!a||a.token_hash!==tokenHash(token))return res.status(401).json({error:'测评会话无效'});req.attempt=a;next()}
function parseOptions(value){let o=Array.isArray(value)?value:JSON.parse(value||'[]');o=[...new Set(o.map(String).map(x=>x.trim()).filter(Boolean))];if(o.length<2||o.length>20)throw Error('候选情绪需为 2–20 项');return o}

app.post('/api/admin/login',(req,res)=>{const a=db.prepare('SELECT * FROM admins WHERE username=?').get(req.body.username);if(!a||!verifyPassword(req.body.password||'',a.password_hash))return res.status(401).json({error:'账号或密码错误'});req.session.adminId=a.id;res.json({username:a.username})});
app.post('/api/admin/logout',auth,(req,res)=>req.session.destroy(()=>res.json({ok:true})));
app.get('/api/admin/me',auth,(req,res)=>res.json(db.prepare('SELECT id,username FROM admins WHERE id=?').get(req.session.adminId)));
app.get('/api/admin/dashboard',auth,(req,res)=>{const q=db.prepare('SELECT COUNT(*) total,SUM(published) published FROM questions').get();const a=db.prepare("SELECT COUNT(*) total,ROUND(AVG(total_score),1) average FROM attempts WHERE status='completed'").get();const recent=db.prepare("SELECT substr(submitted_at,1,10) day,COUNT(*) count FROM attempts WHERE status='completed' GROUP BY day ORDER BY day DESC LIMIT 7").all().reverse();res.json({questions:q,attempts:a,recent})});
app.get('/api/admin/questions',auth,(req,res)=>{let where=[],args=[];if(req.query.modality){where.push('q.modality=?');args.push(req.query.modality)}if(req.query.status!==''){if(req.query.status==='published'||req.query.status==='draft'){where.push('q.published=?');args.push(req.query.status==='published'?1:0)}}if(req.query.search){where.push('(q.code LIKE ? OR q.title LIKE ?)');args.push(`%${req.query.search}%`,`%${req.query.search}%`)}res.json(db.prepare(`SELECT q.*,m.original_name,m.mime_type FROM questions q LEFT JOIN media_files m ON m.id=q.media_id ${where.length?'WHERE '+where.join(' AND '):''} ORDER BY q.id DESC`).all(...args).map(q=>({...q,options:JSON.parse(q.options_json),correct_emotions:JSON.parse(q.correct_emotions_json||JSON.stringify([q.correct_emotion])),standard_strengths:JSON.parse(q.standard_strengths_json||JSON.stringify([q.standard_strength]))}))) });
function questionBody(b){
  const options=parseOptions(b.options), optionType=b.option_type||'single', questionType=b.question_type||'recognition';
  const correct=[...new Set((Array.isArray(b.correct_emotions)?b.correct_emotions:[b.correct_emotion]).map(String).map(x=>x.trim()).filter(Boolean))];
  const strengths=(Array.isArray(b.standard_strengths)?b.standard_strengths:[b.standard_strength]).map(Number);
  const points=Number(b.points||100), conflict=(b.conflict_code||'').trim()||null;
  if(!modalities.includes(b.modality)||!difficulties.includes(b.difficulty)||!optionTypes.includes(optionType)||!questionTypes.includes(questionType)||!b.title?.trim()||!b.context?.trim()||!b.prompt?.trim())throw Error('题目字段不完整或不合法');
  if(correct.length<1||correct.length>(optionType==='single'?1:5)||correct.some(x=>!options.includes(x))||strengths.length!==correct.length||strengths.some(x=>![1,2,3,4,5].includes(x)))throw Error('标准情绪及对应强度不合法');
  if(!Number.isInteger(points)||points<1||points>1000)throw Error('题目分值需为 1–1000 的整数');
  if(conflict&&!db.prepare('SELECT 1 FROM questions WHERE code=? AND id<>?').get(conflict,Number(b.id)||0))throw Error('冲突题目编号不存在');
  return {values:[b.modality,optionType,questionType,points,b.title.trim(),b.context.trim(),b.prompt.trim(),JSON.stringify(options),correct[0],strengths[0],JSON.stringify(correct),JSON.stringify(strengths),b.emotion_category||correct[0],b.difficulty,b.media_id||null,conflict,b.published?1:0]};
}
app.post('/api/admin/questions',auth,(req,res)=>{try{const x=questionBody(req.body), code=`ITEM-${String(db.prepare('SELECT COALESCE(MAX(id),0)+1 n FROM questions').get().n).padStart(5,'0')}`;const r=db.prepare(`INSERT INTO questions(code,modality,option_type,question_type,points,title,context,prompt,options_json,correct_emotion,standard_strength,correct_emotions_json,standard_strengths_json,emotion_category,difficulty,media_id,conflict_code,published) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(code,...x.values);res.status(201).json({id:r.lastInsertRowid,code})}catch(e){res.status(400).json({error:e.message})}});
app.put('/api/admin/questions/:id',auth,(req,res)=>{try{const x=questionBody({...req.body,id:req.params.id});const r=db.prepare(`UPDATE questions SET modality=?,option_type=?,question_type=?,points=?,title=?,context=?,prompt=?,options_json=?,correct_emotion=?,standard_strength=?,correct_emotions_json=?,standard_strengths_json=?,emotion_category=?,difficulty=?,media_id=?,conflict_code=?,published=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(...x.values,req.params.id);if(!r.changes)return res.status(404).json({error:'题目不存在'});res.json({ok:true})}catch(e){res.status(400).json({error:e.message})}});
app.patch('/api/admin/questions/:id/status',auth,(req,res)=>{const r=db.prepare('UPDATE questions SET published=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(req.body.published?1:0,req.params.id);r.changes?res.json({ok:true}):res.status(404).json({error:'题目不存在'})});
const storage=multer.diskStorage({destination:UPLOAD_DIR,filename:(req,file,cb)=>cb(null,`${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`)});
const upload=multer({storage,limits:{fileSize:Math.max(Number(process.env.IMAGE_MAX_MB||10),Number(process.env.AUDIO_MAX_MB||30),Number(process.env.VIDEO_MAX_MB||100))*1024*1024},fileFilter:(req,file,cb)=>cb(null,/^(image|audio|video)\//.test(file.mimetype))});
app.post('/api/admin/media',auth,upload.single('file'),(req,res)=>{if(!req.file)return res.status(400).json({error:'请选择有效的图片、音频或视频'});const type=req.file.mimetype.split('/')[0],limits={image:+(process.env.IMAGE_MAX_MB||10),audio:+(process.env.AUDIO_MAX_MB||30),video:+(process.env.VIDEO_MAX_MB||100)};if(req.file.size>limits[type]*1024*1024){fs.unlinkSync(req.file.path);return res.status(400).json({error:`${type} 文件不能超过 ${limits[type]}MB`})}const r=db.prepare('INSERT INTO media_files(original_name,stored_name,mime_type,size) VALUES(?,?,?,?)').run(req.file.originalname,req.file.filename,req.file.mimetype,req.file.size);res.status(201).json({id:r.lastInsertRowid,url:`/uploads/${req.file.filename}`})});
app.delete('/api/admin/media/:id',auth,(req,res)=>{if(db.prepare('SELECT 1 FROM questions WHERE media_id=?').get(req.params.id))return res.status(409).json({error:'素材正在被题目使用'});const m=db.prepare('SELECT * FROM media_files WHERE id=?').get(req.params.id);if(!m)return res.status(404).json({error:'素材不存在'});db.prepare('DELETE FROM media_files WHERE id=?').run(m.id);fs.rmSync(path.join(UPLOAD_DIR,m.stored_name),{force:true});res.json({ok:true})});
app.get('/api/admin/config',auth,(req,res)=>res.json(db.prepare('SELECT * FROM assessment_configs WHERE id=1').get()));
app.put('/api/admin/config',auth,(req,res)=>{const modes=modalities.map(m=>Number(req.body[`${m}_count`])), choices=optionTypes.map(x=>Number(req.body[`${x}_count`])), kinds=questionTypes.map(x=>Number(req.body[`${x}_count`])), total=Number(req.body.total_count);if([...modes,...choices,...kinds].some(x=>!Number.isInteger(x)||x<0)||total<1||[modes,choices,kinds].some(group=>group.reduce((a,b)=>a+b,0)!==total))return res.status(400).json({error:'每组分类题量之和都必须等于总题量'});db.prepare('UPDATE assessment_configs SET total_count=?,image_count=?,text_count=?,audio_count=?,video_count=?,single_count=?,multiple_count=?,recognition_count=?,reasoning_count=?,updated_at=CURRENT_TIMESTAMP WHERE id=1').run(total,...modes,...choices,...kinds);res.json({ok:true})});

function selectQuestions(cfg){
  const pool=db.prepare('SELECT q.*,m.stored_name FROM questions q LEFT JOIN media_files m ON m.id=q.media_id WHERE q.published=1 ORDER BY RANDOM()').all();
  const targets={};[...modalities,...optionTypes,...questionTypes].forEach(k=>targets[k]=cfg[`${k}_count`]);
  function search(start,chosen,counts){if(chosen.length===cfg.total_count)return Object.keys(targets).every(k=>counts[k]===targets[k])?chosen:null;for(let i=start;i<pool.length;i++){const q=pool[i];if(counts[q.modality]>=targets[q.modality]||counts[q.option_type]>=targets[q.option_type]||counts[q.question_type]>=targets[q.question_type])continue;if(chosen.some(x=>x.conflict_code===q.code||q.conflict_code===x.code))continue;const next={...counts,[q.modality]:counts[q.modality]+1,[q.option_type]:counts[q.option_type]+1,[q.question_type]:counts[q.question_type]+1};const found=search(i+1,[...chosen,q],next);if(found)return found}return null}
  return search(0,[],Object.fromEntries(Object.keys(targets).map(k=>[k,0])));
}
app.post('/api/attempts',(req,res)=>{const cfg=db.prepare('SELECT * FROM assessment_configs WHERE id=1 AND active=1').get();if(!cfg)return res.status(503).json({error:'测评暂未开放'});const selected=selectQuestions(cfg);if(!selected)return res.status(503).json({error:'题库无法满足当前配额或冲突规则，请联系管理员'});selected.sort(()=>Math.random()-.5);const token=crypto.randomBytes(32).toString('base64url'),publicId=`ZJ${new Date().toISOString().slice(0,10).replace(/-/g,'')}${crypto.randomBytes(4).toString('hex').toUpperCase()}`;const create=db.transaction(()=>{const a=db.prepare('INSERT INTO attempts(public_id,token_hash,status) VALUES(?,?,?)').run(publicId,tokenHash(token),'in_progress');const ins=db.prepare(`INSERT INTO attempt_questions(attempt_id,question_id,position,modality_snapshot,title_snapshot,context_snapshot,prompt_snapshot,options_snapshot,correct_emotion_snapshot,standard_strength_snapshot,emotion_category_snapshot,media_url_snapshot,option_type_snapshot,question_type_snapshot,points_snapshot,correct_emotions_snapshot,standard_strengths_snapshot) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);selected.forEach((q,i)=>ins.run(a.lastInsertRowid,q.id,i+1,q.modality,q.title,q.context,q.prompt,q.options_json,q.correct_emotion,q.standard_strength,q.emotion_category,q.stored_name?`/uploads/${q.stored_name}`:null,q.option_type,q.question_type,q.points,q.correct_emotions_json,q.standard_strengths_json));return a.lastInsertRowid});create();res.status(201).json({id:publicId,token})});
function publicAttempt(a){const qs=db.prepare(`SELECT aq.id,aq.position,aq.modality_snapshot modality,aq.title_snapshot title,aq.context_snapshot context,aq.prompt_snapshot prompt,aq.options_snapshot options_json,aq.media_url_snapshot media_url,aq.option_type_snapshot option_type,aq.question_type_snapshot question_type,aq.points_snapshot points,r.emotion,r.strength,r.emotions_json,r.strengths_json,r.watched_source,r.skipped,r.response_time_ms,r.modification_count FROM attempt_questions aq LEFT JOIN responses r ON r.attempt_question_id=aq.id WHERE aq.attempt_id=? ORDER BY aq.position`).all(a.id).map(q=>({...q,options:JSON.parse(q.options_json),emotions:q.emotions_json?JSON.parse(q.emotions_json):(q.emotion?[q.emotion]:[]),strengths:q.strengths_json?JSON.parse(q.strengths_json):(q.strength?[q.strength]:[]),options_json:undefined,emotions_json:undefined,strengths_json:undefined}));return {id:a.public_id,status:a.status,started_at:a.started_at,submitted_at:a.submitted_at,total_score:a.total_score,questions:qs}}
app.get('/api/attempts/:id',attemptAuth,(req,res)=>res.json(publicAttempt(req.attempt)));
app.put('/api/attempts/:id/responses/:position',attemptAuth,(req,res)=>{if(req.attempt.status==='completed')return res.status(409).json({error:'测评已经提交'});const q=db.prepare('SELECT * FROM attempt_questions WHERE attempt_id=? AND position=?').get(req.attempt.id,req.params.position);if(!q)return res.status(404).json({error:'题目不存在'});const skipped=!!req.body.skipped, options=JSON.parse(q.options_snapshot), emotions=[...new Set((Array.isArray(req.body.emotions)?req.body.emotions:[req.body.emotion]).filter(Boolean))], strengths=(Array.isArray(req.body.strengths)?req.body.strengths:[req.body.strength]).map(Number);if(!skipped&&(emotions.length<1||emotions.length>(q.option_type_snapshot==='single'?1:5)||emotions.some(x=>!options.includes(x))||strengths.length!==emotions.length||strengths.some(x=>![1,2,3,4,5].includes(x))))return res.status(400).json({error:'答案不合法'});const watched=req.body.watched_source===true?1:req.body.watched_source===false?0:null;db.prepare(`INSERT INTO responses(attempt_question_id,emotion,strength,emotions_json,strengths_json,watched_source,skipped,response_time_ms,modification_count) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(attempt_question_id) DO UPDATE SET emotion=excluded.emotion,strength=excluded.strength,emotions_json=excluded.emotions_json,strengths_json=excluded.strengths_json,watched_source=excluded.watched_source,skipped=excluded.skipped,response_time_ms=excluded.response_time_ms,modification_count=excluded.modification_count,saved_at=CURRENT_TIMESTAMP`).run(q.id,skipped?null:emotions[0],skipped?null:strengths[0],skipped?null:JSON.stringify(emotions),skipped?null:JSON.stringify(strengths),watched,skipped?1:0,Math.max(0,Number(req.body.response_time_ms)||0),Math.max(0,Number(req.body.modification_count)||0));res.json({ok:true})});
app.post('/api/attempts/:id/submit',attemptAuth,(req,res)=>{if(req.attempt.status==='completed')return res.status(409).json({error:'测评已经提交'});const result=db.transaction(()=>{const qs=db.prepare(`SELECT aq.*,r.id response_id,r.emotion,r.strength,r.emotions_json,r.strengths_json,r.skipped,r.response_time_ms FROM attempt_questions aq LEFT JOIN responses r ON r.attempt_question_id=aq.id WHERE aq.attempt_id=?`).all(req.attempt.id);let label=0,strength=0,total=0,weight=0;const byMode={},byEmotion={};for(const q of qs){let ls=0,ss=0;if(q.response_id&&!q.skipped){const answers=q.emotions_json?JSON.parse(q.emotions_json):[q.emotion],values=q.strengths_json?JSON.parse(q.strengths_json):[q.strength],correct=JSON.parse(q.correct_emotions_snapshot||JSON.stringify([q.correct_emotion_snapshot])),standards=JSON.parse(q.standard_strengths_snapshot||JSON.stringify([q.standard_strength_snapshot])),hits=answers.filter(x=>correct.includes(x)).length;ls=correct.length===1?(hits===1?100:0):(hits?100*(2*hits/(answers.length+correct.length)):0);const matched=correct.map((emotion,i)=>{const index=answers.indexOf(emotion);return index<0?0:Math.max(0,1-Math.abs(values[index]-standards[i])/4)*100});ss=matched.reduce((a,b)=>a+b,0)/correct.length}const score=ls*.6+ss*.4,w=q.points_snapshot||100;label+=ls*w;strength+=ss*w;total+=score*w;weight+=w;(byMode[q.modality_snapshot]??=[]).push(score);(byEmotion[q.emotion_category_snapshot]??=[]).push(score);if(q.response_id)db.prepare('UPDATE responses SET label_score=?,strength_score=?,total_score=? WHERE id=?').run(ls,ss,score,q.response_id)}const avg=x=>x.length?x.reduce((a,b)=>a+b,0)/x.length:0,duration=qs.reduce((s,q)=>s+(q.response_time_ms||0),0);const report={overall:+(total/weight).toFixed(1),label:+(label/weight).toFixed(1),strength:+(strength/weight).toFixed(1),average_response_ms:Math.round(duration/qs.length),by_modality:Object.fromEntries(Object.entries(byMode).map(([k,v])=>[k,+avg(v).toFixed(1)])),by_emotion:Object.fromEntries(Object.entries(byEmotion).map(([k,v])=>[k,+avg(v).toFixed(1)]))};db.prepare("UPDATE attempts SET status='completed',submitted_at=CURRENT_TIMESTAMP,total_score=?,label_score=?,strength_score=?,duration_ms=?,report_json=? WHERE id=?").run(report.overall,report.label,report.strength,duration,JSON.stringify(report),req.attempt.id);return report})();res.json(result)});
app.get('/api/attempts/:id/report',attemptAuth,(req,res)=>{if(req.attempt.status!=='completed')return res.status(409).json({error:'测评尚未完成'});res.json(JSON.parse(req.attempt.report_json))});

function attemptFilters(q){let w=["a.status='completed'"],v=[];if(q.id){w.push('a.public_id LIKE ?');v.push(`%${q.id}%`)}if(q.min_score){w.push('a.total_score>=?');v.push(+q.min_score)}if(q.from){w.push('a.submitted_at>=?');v.push(q.from)}if(q.to){w.push('a.submitted_at<=?');v.push(q.to+' 23:59:59')}return {sql:w.join(' AND '),values:v}}
app.get('/api/admin/attempts',auth,(req,res)=>{const f=attemptFilters(req.query);res.json(db.prepare(`SELECT public_id,status,started_at,submitted_at,total_score,label_score,strength_score,duration_ms FROM attempts a WHERE ${f.sql} ORDER BY submitted_at DESC LIMIT 500`).all(...f.values))});
app.get('/api/admin/attempts/:id',auth,(req,res)=>{const a=db.prepare('SELECT * FROM attempts WHERE public_id=?').get(req.params.id);if(!a)return res.status(404).json({error:'答卷不存在'});const rows=db.prepare(`SELECT aq.position,aq.title_snapshot title,aq.modality_snapshot modality,aq.correct_emotion_snapshot correct_emotion,aq.standard_strength_snapshot standard_strength,aq.correct_emotions_snapshot,aq.standard_strengths_snapshot,r.emotion,r.strength,r.emotions_json,r.strengths_json,r.watched_source,r.skipped,r.label_score,r.strength_score,r.total_score,r.response_time_ms,r.modification_count FROM attempt_questions aq LEFT JOIN responses r ON r.attempt_question_id=aq.id WHERE aq.attempt_id=? ORDER BY aq.position`).all(a.id).map(r=>({...r,emotions:r.emotions_json?JSON.parse(r.emotions_json):[r.emotion].filter(Boolean),strengths:r.strengths_json?JSON.parse(r.strengths_json):[r.strength].filter(Boolean),correct_emotions:JSON.parse(r.correct_emotions_snapshot||JSON.stringify([r.correct_emotion])),standard_strengths:JSON.parse(r.standard_strengths_snapshot||JSON.stringify([r.standard_strength]))}));res.json({...a,token_hash:undefined,report:a.report_json?JSON.parse(a.report_json):null,responses:rows})});
const csvCell=x=>`"${String(x??'').replace(/"/g,'""')}"`;
app.get('/api/admin/attempts.csv',auth,(req,res)=>{const f=attemptFilters(req.query);const rows=db.prepare(`SELECT a.public_id,a.submitted_at,a.total_score,aq.position,aq.modality_snapshot,aq.title_snapshot,r.emotion,aq.correct_emotion_snapshot,r.strength,aq.standard_strength_snapshot,r.label_score,r.strength_score,r.total_score,r.response_time_ms,r.modification_count FROM attempts a JOIN attempt_questions aq ON aq.attempt_id=a.id LEFT JOIN responses r ON r.attempt_question_id=aq.id WHERE ${f.sql} ORDER BY a.submitted_at DESC,aq.position`).all(...f.values);const head=['匿名编号','提交时间','总分','题号','模态','题目','用户情绪','标准情绪','用户强度','标准强度','标签分','强度分','单题分','用时毫秒','修改次数'];res.type('text/csv').set('Content-Disposition','attachment; filename="attempts.csv"').send('\ufeff'+[head,...rows.map(r=>Object.values(r))].map(row=>row.map(csvCell).join(',')).join('\r\n'))});

app.use('/uploads',express.static(UPLOAD_DIR,{maxAge:'7d',fallthrough:false}));
app.get('/admin/login',(req,res)=>res.sendFile(path.join(ROOT,'admin.html'))); app.get('/admin',(req,res)=>res.sendFile(path.join(ROOT,'admin.html')));
app.get('/',(req,res)=>res.sendFile(path.join(ROOT,'index.html')));
for(const file of ['app.js','styles.css','media.css','admin.js','admin.css']) app.get(`/${file}`,(req,res)=>res.sendFile(path.join(ROOT,file)));
app.use((err,req,res,next)=>{console.error(`${new Date().toISOString()} ${req.method} ${req.path}: ${err.message}`);if(err instanceof multer.MulterError)return res.status(400).json({error:'上传文件过大或格式不正确'});res.status(500).json({error:'服务器处理失败'})});
const port=Number(process.env.PORT||3000); if(require.main===module)app.listen(port,()=>console.log(`知境服务已启动: http://localhost:${port}`));
module.exports={app,db,hashPassword};
