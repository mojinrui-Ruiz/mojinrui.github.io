// AI 分身「小莫」：只根据简历回答的本地问答引擎。
// 不调用大模型：先识别问的是哪段经历、哪个方面，再从简历原文里取句子拼成回答，所以不会编造。
// 纯函数，不碰页面；网页和测试脚本共用这一份。
function createAgent(D) {
  const strip = (s) => String(s || '').replace(/\*\*/g, '').trim();
  const ym = (d) => String(d || '').replace(/^(\d{4})-(\d{2}).*/, '$1.$2');
  const span = (a, b) => (a ? (b && ym(a) === ym(b) ? ym(a) : `${ym(a)} – ${b ? ym(b) : '至今'}`) : ym(b));
  const lines = (d) => String(d || '').split(/\n+/).map((l) => l.trim()).filter(Boolean).map((l) => {
    const m = l.match(/^([^：:]{2,24})[：:]\s*(.+)$/);
    return m ? { head: m[1].trim(), text: m[2].trim() } : { head: '', text: l };
  });
  const clauses = (t) => strip(t).split(/(?<=[；;。])/).map((c) => c.trim()).filter((c) => c.length > 3);
  const first = (t) => clauses(t)[0] || strip(t);

  // ---------- 1. 把简历整理成知识库 ----------
  const E = [];
  const HOW = new Set(); // 原型页的交互说明
  const add = (o) => { E.push(o); return o; };
  const ALIAS = {
    '阿里巴巴': /阿里|alibaba|无影|阿里云|云电脑|工作助手|办公助手|ai\s*办公|办公智能体|skills?\b|技能体系|技能冲突|并行冲突|同类能力|多\s*agent|agent|专家团|主理人|编排|工作流|任务完成率|任务耗时/i,
    '海康威视': /海康|hikvision|智慧社区|智慧城市|安防|12345|市民诉求|独居|高空抛物|电瓶车|误报|识别准确率|算法训练|政务|高新区/i,
    'bili': /b\s*站|哔哩|bilibili|会员购|本命|追谷|谷子|吧唧|二次元|周边|番剧|稍后再看|发售日历/i,
    'health': /健康|心理|ethereal|情绪|压力|正念|say-do-make|卡片分类|仪表盘|热力图/i,
  };
  for (const e of D.experience || []) {
    const ls = lines(e.description);
    add({ id: e.company, kind: 'exp', name: e.company, label: `${e.company}实习`, title: e.title, time: span(e.startDate, e.endDate),
      re: ALIAS[e.company] || new RegExp(e.company), sections: ls, extra: [] });
  }
  for (const p of D.projects || []) {
    const extra = [];
    const walk = (bs) => (bs || []).forEach((b) => {
      if (b.t === 'p' || b.t === 'callout') extra.push(strip(b.text));
      if (b.t === 'list') b.items.forEach((x) => extra.push(strip(x)));
      if (b.t === 'toggle') { walk(b.blocks); }
      if (b.t === 'screens') b.items.forEach((s) => s.points.forEach((x) => { const c = `${s.title}：${strip(x)}`; extra.push(c); HOW.add(c); }));
      if (b.t === 'toggle') extra.push(strip(b.title));
      if (b.t === 'table' && b.head[0] !== '能力') b.rows.forEach((r) => extra.push(r.map(strip).join('：')));
    });
    walk(p.page);
    add({ id: p.id, kind: 'proj', name: p.name, label: p.name, title: p.role, time: span(p.startDate, p.endDate),
      re: ALIAS[p.id] || new RegExp(p.name), sections: lines(p.description), extra, summary: p.summary, link: p.link, linkLabel: p.linkLabel });
  }
  const eduRe = [/爱丁堡|edinburgh|uoe|硕士|研究生|设计信息学|design informatics|\bqs\b/i, /uic|联合国际学院|浸会|北师|本科|学士|计算机科学/i];
  (D.education || []).forEach((s, i) => add({ id: 'edu' + i, kind: 'edu', name: s.school, label: s.school, time: span(s.startDate, s.endDate),
    re: eduRe[i] || new RegExp(s.school), degree: s.degree, major: s.major, courses: s.courses, badge: s.badge, sections: [], extra: [] }));
  (D.papers || []).forEach((x) => add({ id: 'paper', kind: 'campus', name: x.title, label: '学术成果', re: /论文|学术|gemma|海报|poster|dcs|文本风格|微调/i,
    text: `${x.title}（${x.journal}，${x.date}）：${x.description}`, sections: [], extra: [] }));
  (D.leadership || []).forEach((x) => add({ id: 'lead', kind: 'campus', name: x.org, label: '竞赛统筹', re: /学会|竞赛|数学建模|电竞|电子竞技|统筹|社团|学生工作|百人|团队|带过|管理过|领导力/i,
    text: `${x.org}，${x.title}：${x.description}`, sections: [], extra: [] }));
  (D.awards || []).forEach((x) => add({ id: 'award', kind: 'campus', name: x.name, label: '文艺实践', re: /小品|奖|荣誉|文艺|表演|演员/i,
    text: `${x.name}，${x.description}`, sections: [], extra: [] }));
  const byId = Object.fromEntries(E.map((e) => [e.id, e]));
  const exps = E.filter((e) => e.kind === 'exp'), projs = E.filter((e) => e.kind === 'proj'), edus = E.filter((e) => e.kind === 'edu');
  const skills = (D.itSkills || []).map((s) => s.name);
  const langs = (D.languages || []).map((l) => `${l.language}：${l.level}${l.proficiency ? `（${l.proficiency}）` : ''}`);
  const fact = (k) => (D.facts || []).find((f) => f.k === k)?.v || '';

  // ---------- 2. 识别问题 ----------
  const OTHER_CO = /腾讯|字节|抖音|美团|百度|京东|网易|小红书|快手|拼多多|华为|小米|微软|谷歌|google|meta|苹果|apple|亚马逊|amazon|滴滴|携程|蚂蚁|米哈游|bilibili公司|b站实习|在b站(实习|工作|上班)/i;
  const A = {
    background: /背景|是什么|做什么的|干什么|干嘛|介绍|讲讲|说说|聊聊|负责|做了什么|做了哪些|具体做|主要做|工作内容|职责/,
    research: /调研|研究|访谈|问卷|竞品|对标|痛点|洞察|发现|根因|用户需求|需求分析|需求规划|市场/,
    design: /设计|原型|方案|功能|架构|交互|figma|墨刀|流程|规则|怎么做的|怎么做出来|怎么实现|怎么搞|怎么弄|版本|v1|v2/i,
    result: /结果|成果|效果|指标|提升|产出|落地|验证|上线|收获|成绩|业绩|量化|咋样|怎么样/,
    priority: /优先级|kano|取舍|排期|判断|决策|rice|四象限|先做|砍/i,
    hard: /难点|挑战|困难|难题|冲突|坑|问题是|遇到/,
    time: /什么时候|时间|几月|哪年/,
    qty: /多少|几(个|例|次|份|款|轮|条|家|天|类|项|页)|多久|是不是|有没有|多大|几成|规模/,
    role: /角色|职位|岗位|担任|什么身份|title/i,
  };
  // 经历的名字本身（只用来识别是哪段经历，检索细节时去掉）
  const NAMEW = /阿里巴巴|阿里云|阿里|alibaba|海康威视|海康|hikvision|b\s*站|会员购|哔哩哔哩|bilibili|本命追谷助手|追谷助手|心理健康平台|健康平台|心理健康|ethereal|爱丁堡大学|爱丁堡|uic/gi;
  const STOP = ['什么', '怎么', '哪些', '一下', '他的', '他在', '是不', '有没', '没有', '可以', '这个', '那个', '项目', '实习', '经历', '具体', '一些', '的话', '如何', '为什么', '告诉', '介绍', '说说', '讲讲', '晋睿', '莫晋', '多少', '是不', '不是', '几个', '怎么样', '的是', '了多'];
  const norm = (q) => String(q || '').trim().replace(/[？?！!。，,~～\s]+$/g, '').replace(/多智能体/g, '多 Agent').replace(/智能体协作/g, 'Agent 协作').replace(/最多(能|可以)?(设|加|添加|选|设置)?(几|多少)/g, '上限$3');

  function entityOf(q) {
    const hits = E.filter((e) => e.re.test(q));
    if (hits.length <= 1) return hits;
    // 同时命中多个时，优先名字直接出现的；技能 skills 一词只在不提别的经历时归阿里
    const named = hits.filter((e) => q.includes(e.name) || (e.id === 'bili' && /b\s*站|会员购|本命/i.test(q)) || (e.kind === 'exp' && q.includes(e.name.slice(0, 2))));
    return named.length ? named : hits;
  }
  const attrsOf = (q) => Object.keys(A).filter((k) => A[k].test(q));

  // 子串检索：在一组句子里找和问题重合最多的
  function grams(q) {
    const s = q.toLowerCase().replace(/[^\p{L}\p{N}%+]/gu, ' ');
    const out = new Set();
    for (const w of s.split(/\s+/).filter(Boolean)) {
      if (/^[a-z0-9.%+]+$/.test(w)) { if (w.length > 1) out.add(w); continue; }
      for (let n = 2; n <= Math.min(6, w.length); n++) for (let i = 0; i + n <= w.length; i++) { const g = w.slice(i, i + n); if (!STOP.includes(g)) out.add(g); }
    }
    return [...out];
  }
  function rank(q, pool, min = 8) {
    const gs = grams(q), how = /怎么|如何|在哪/.test(q);
    return pool.map((c) => {
      const lc = c.toLowerCase(); let sc = 0;
      for (const g of gs) if (lc.includes(g)) sc += g.length * g.length;
      if (how && HOW.has(c)) sc = Math.round(sc * 1.5);
      return { c, sc };
    }).filter((x) => x.sc >= min).sort((a, b) => b.sc - a.sc);
  }
  const poolOf = (e) => e.kind === 'campus' ? clauses(e.text)
    : e.kind === 'edu' ? [`${e.name}，${e.major}${e.degree}，${e.time}`, `主修课程：${e.courses}`, e.badge || ''].filter(Boolean)
    : [...e.sections.flatMap((s) => clauses(s.text).map((c) => (s.head ? `${s.head}：` : '') + c)), ...e.extra.flatMap(clauses)];

  // ---------- 3. 组织回答 ----------
  const head = (e) => e.kind === 'exp' ? `${e.name}｜${e.title}（${e.time}）` : e.kind === 'proj' ? `${e.name}｜${e.title}（${e.time}）` : e.name;
  const bullet = (arr) => arr.map((x) => '· ' + x).join('\n');
  const secBy = (e, re) => e.sections.filter((s) => re.test(s.head));
  const bg = (e) => e.sections.find((s) => /背景/.test(s.head));
  const CHIPS = {
    exp: (e) => [`${e.name}的成果是什么？`, `${e.name}是怎么做调研的？`, e.id === '阿里巴巴' ? '多 Agent 协作是怎么设计的？' : '遇到过什么难点？'],
    proj: (e) => [`${e.id === 'bili' ? '调研发现的根因是什么？' : '用户调研怎么做的？'}`, '方案是怎么设计的？', '结果怎么样？'],
  };

  function overview(e) {
    if (e.kind === 'edu') return `${e.name}，${e.major}${e.degree}（${e.time}）${e.badge ? `，${e.badge}` : ''}。\n主修课程：${e.courses}。`;
    if (e.kind === 'campus') return e.text;
    const b = bg(e), rest = e.sections.filter((s) => s !== b);
    return `${head(e)}\n${b ? b.text : (e.summary || '')}\n\n主要做了：\n${bullet(rest.map((s) => `${s.head}：${first(s.text)}`))}`;
  }
  function sections(e, ss) { return `${head(e)}\n` + ss.map((s) => `【${s.head}】${s.text}`).join('\n'); }

  function aboutEntity(e, q, at) {
    if (e.kind === 'edu' || e.kind === 'campus') {
      if (at.includes('time') && e.time) return `${e.name}：${e.time}。`;
      if (e.kind === 'edu' && /课|学了|学什么|主修/.test(q)) return `${e.name}的主修课程：${e.courses}。`;
      if (e.kind === 'edu' && /排名|qs|名校/i.test(q)) return e.badge ? `${e.name}：${e.badge}。` : `简历里没有写${e.name}的排名。`;
      return overview(e);
    }
    // 问具体数字或细节：先按句子检索，命中就只答那几句
    // 在某段经历内部检索时，先去掉问题里的经历名本身，免得匹配到带名字的标题
    const qe = q.replace(NAMEW, ' ');
    // 问数字时，单个关键词也算命中，但只要带数字的句子
    const r0 = A.qty.test(q) ? rank(qe, poolOf(e).filter((c) => /\d/.test(c)), 4) : rank(qe, poolOf(e));
    const secAttr = at.some((a) => ['research', 'design', 'result', 'priority'].includes(a));
    if (r0.length && (at.includes('qty') || (!secAttr && r0[0].sc >= 40))) return `${head(e)}\n` + bullet([...new Set(r0.slice(0, 2).map((x) => x.c))]);
    if (at.includes('qty') && !r0.length && /多少|多大|几/.test(qe)) return `简历里没有写${e.label}这方面的具体数字，我不乱猜。${e.title ? `可以告诉你的是：他在其中担任${e.title}（${e.time}）。` : ''}`;
    if (at.includes('time') && !at.some((a) => a !== 'time')) return `${e.label}的时间是 ${e.time}，担任${e.title}。`;
    if (at.includes('role') && at.length === 1) return `在${e.label}中担任${e.title}（${e.time}）。`;
    const want = [];
    if (at.includes('research')) want.push(...secBy(e, /调研|竞品|需求|痛点|研究/));
    if (at.includes('design')) want.push(...secBy(e, /设计|原型|功能|选型|交互|方案/));
    if (at.includes('result')) want.push(...secBy(e, /成果|验证|落地|产出|结果/));
    if (at.includes('priority')) want.push(...secBy(e, /规划|优先|设计|竞品/).filter((s) => /优先级|kano|四象限|v1\.0|首版|排期|成本/i.test(s.text)));
    if (at.includes('hard')) {
      const hard = poolOf(e).filter((c) => /误报|冲突|根因|痛点|脱节|难|问题/.test(c));
      if (hard.length) return `${head(e)}\n` + bullet([...new Set(hard)].slice(0, 2));
    }
    const uniq = [...new Set(want)];
    if (uniq.length) return sections(e, uniq.slice(0, 2));
    // 方面没对上小标题时，按句子检索
    const r = rank(qe, poolOf(e));
    if (at.includes('result') && !r.length) {
      const nums = poolOf(e).filter((c) => /\d/.test(c) && /提升|降|%|满意度|预警|告警|分钟|完成率/.test(c));
      if (nums.length) return `${head(e)}\n` + bullet(nums.slice(0, 3));
    }
    if (r.length && r[0].sc >= 8 && !(at.includes('background') && at.length === 1)) return `${head(e)}\n` + bullet([...new Set(r.slice(0, 3).map((x) => x.c))]);
    return overview(e);
  }

  // 跨经历的通用问题
  const G = {
    list_proj: () => `做过 ${projs.length} 个项目：\n` + bullet(projs.map((p) => `${p.name}（${p.time}，${p.title}）：${p.summary ? first(p.summary) : first(bg(p)?.text)}`)),
    list_exp: () => `有 ${exps.length} 段产品实习：\n` + bullet(exps.map((e) => `${e.name}｜${e.title}（${e.time}）：${first(bg(e)?.text)}`)),
    edu: () => edus.map((s) => `${s.name}，${s.major}${s.degree}（${s.time}）${s.badge ? `，${s.badge}` : ''}`).join('\n'),
    skills: () => `工具与技能：${skills.join('、')}。\n语言：${langs.join('；')}。`,
    lang: () => `语言：${langs.join('；')}。`,
    intent: () => `求职意向：${D.intent?.position || fact('求职意向')}。${D.email ? `\n想沟通可以发邮件：${D.email}` : ''}`,
    contact: (q) => (/手机|电话|号码|微信|wechat|tel/i.test(q) ? '手机号和微信不在主页上公开。' : '') + (D.email ? `联系邮箱：${D.email}，发邮件是最快的方式。` : '请通过主页上的联系方式联系他。'),
    intro: () => `${D.bio || D.intro || ''}\n\n${bullet((D.facts || []).map((f) => `${f.k}：${f.v}`))}`,
    why: () => `从简历看，支撑他做产品经理的是：\n` + bullet([
      `有 ${exps.length} 段产品实习：${exps.map((e) => e.name).join('、')}，覆盖调研、设计到落地验证的全流程`,
      ...exps.map((e) => { const r = secBy(e, /成果|验证|落地/)[0]; return r ? `${e.name}：${first(r.text)}` : null; }).filter(Boolean),
      `擅长：${fact('擅长')}`]),
    ai: () => `和 AI 相关的经历：\n` + bullet([
      ...exps.map((e) => `${e.name}：${poolOf(e).map((c) => c.replace(/^[^：]{2,24}：/, '')).find((c) => /AI 智能|agent|算法/i.test(c)) || first(bg(e)?.text)}`),
      ...E.filter((e) => e.id === 'paper').map((e) => `学术成果：${e.name}`),
      skills.find((s) => /claude|copilot|codex/i.test(s)) ? `工具：${skills.find((s) => /claude|copilot|codex/i.test(s))}` : null].filter(Boolean)),
    priority: () => `排优先级的做法，在几段经历里都有：\n` + bullet([...exps, ...projs].flatMap((e) => poolOf(e).filter((c) => /优先级|kano|四象限|首版|V1\.0 只做/i.test(c)).slice(0, 1).map((c) => `${e.name}：${c.replace(/^[^：]{2,24}：/, '')}`))),
    research: () => `用户调研的做法：\n` + bullet([...exps, ...projs].map((e) => { const s = secBy(e, /调研|研究/)[0]; return s ? `${e.name}：${first(s.text)}` : null; }).filter(Boolean)),
    results: () => `能量化的结果：\n` + bullet([...exps, ...projs].flatMap((e) => poolOf(e).filter((c) => /\d/.test(c) && /提升|降到|满意度|预警|告警|上门|完成率/.test(c)).slice(0, 2).map((c) => `${e.name}：${c.replace(/^[^：]{2,24}：/, '')}`))),
    method: () => {
      const all = [...exps, ...projs];
      const used = new Set();
      const pick = (re, sec) => { for (const e of all) for (const s of secBy(e, sec)) { const c = clauses(s.text).find((x) => re.test(x) && !used.has(x)); if (c) { used.add(c); return `${e.name}：${c}`; } } return null; };
      return '从简历看，他做产品基本是四步：\n' + bullet([
        pick(/调研|问卷|访谈|分析/, /调研|研究|竞品/) && `先弄清问题（调研）——${pick(/调研|问卷|访谈|分析/, /调研|研究|竞品/)}`,
        pick(/优先级|kano|首版|V1\.0/i, /规划|竞品|调研|设计/) && `再决定先做什么（优先级）——${pick(/优先级|kano|首版|V1\.0/i, /规划|竞品|调研|设计/)}`,
        pick(/原型|设计/, /设计|原型|选型/) && `把方案画成原型（设计）——${pick(/原型|设计/, /设计|原型|选型/)}`,
        pick(/提升|满意度|预警|完成率/, /成果|验证|落地|设计/) && `用测试和数据验证（验证）——${pick(/提升|满意度|预警|完成率/, /成果|验证|落地|设计/)}`,
      ].filter(Boolean));
    },
    graduate: () => { const s = edus[0]; return s ? `${s.name}${s.major}${s.degree}，就读时间 ${s.time}。` : '简历里没有写毕业时间。'; },
  };
  const UNKNOWN = '这个简历里没有写，我不确定，不想乱说。' + (D.email ? `可以直接发邮件问他：${D.email}` : '');

  // ---------- 4. 多轮对话 ----------
  const st = { last: null, shown: {}, list: [] };
  const out = (text, entity = null, chips = null, intent = '') => {
    if (entity) st.last = entity;
    st.list = intent === 'list_proj' ? projs : intent === 'list_exp' ? exps : intent === 'multi' ? st.multi || [] : st.list;
    return { text: text.trim(), entity: entity?.id || null, intent, chips: chips || (entity && CHIPS[entity.kind] ? CHIPS[entity.kind](entity) : D.questions || []) };
  };

  function ask(raw) {
    const q = norm(raw);
    if (!q) return out('想问点什么？比如「在阿里巴巴做了什么」。');
    const ql = q.toLowerCase();
    if (/^(你好|您好|hi|hello|嗨|哈喽|在吗|在不在)/i.test(q) && q.length < 8) return out(D.welcome || '你好！可以问我晋睿的经历和项目。', null, null, 'hi');
    if (/谢谢|感谢|thx|thank/i.test(q)) return out('不客气！还想了解什么都可以继续问。', null, null, 'thanks');
    if (/你是谁|你是什么|你叫什么|你是真人|你是ai|你是机器人/i.test(q)) return out('我是「小莫」，晋睿的 AI 分身。我只根据他的简历回答，简历里没有的不会编。', null, null, 'self');
    if (/手机|电话|号码|微信|wechat|联系方式|联系|邮箱|email|e-mail|mail|怎么找他|约面试/i.test(q)) return out(G.contact(q), null, null, 'contact');
    if (/薪资|薪水|工资|期望薪|待遇|多少钱|年龄|几岁|多大了|出生|性别|身高|婚|恋爱|到岗|入职时间|实习时长|能实习多久|base|签证|户口|政治面貌|绩点|gpa|雅思|托福|六级|四级/i.test(q)) return out(UNKNOWN, null, null, 'unknown');
    let ents = entityOf(q);
    const ord = q.match(/第\s*(一|1|二|2|三|3)\s*(个|段|项)|前者|后者|最后一个/);
    if (!ents.length && ord && st.list.length) {
      const k = ord[0] === '前者' ? 0 : ord[0] === '后者' || ord[0] === '最后一个' ? st.list.length - 1 : ({ 一: 0, 1: 0, 二: 1, 2: 1, 三: 2, 3: 2 })[ord[1]];
      if (st.list[k]) { const e = st.list[k]; const rest = q.replace(ord[0], ''); const a2 = attrsOf(rest); return out(/详细|具体|展开|说说|讲讲|介绍/.test(rest) && !a2.some((x) => x !== 'background') ? sections(e, e.sections) : aboutEntity(e, rest, a2), e, null, 'ordinal'); }
    }
    if (/b\s*站|哔哩|bilibili/i.test(q) && /实习|工作过|上班|入职|员工/.test(q) && byId.bili) return out(`不是。${byId.bili.name}是他独立主导的项目（写在项目经历里），不是在 B 站的实习。他的实习是：${exps.map((e) => `${e.name}（${e.time}）`).join('、')}。`, byId.bili, null, 'not_in_cv');
    const co = q.match(OTHER_CO);
    if (co && !ents.some((e) => e.kind === 'exp')) return out(`简历里没有在${co[0].replace(/^在|(实习|工作|上班)$/g, '')}的经历。他的实习是：${exps.map((e) => `${e.name}（${e.time}）`).join('、')}。`, null, null, 'not_in_cv');

    const at = attrsOf(q);
    // 多个经历一起问：分别回答
    if (ents.length >= 2 && ents.length <= 3) {
      const named = ents; st.multi = named;
      return out(named.map((e) => aboutEntity(e, q, at)).join('\n\n'), named[named.length - 1], null, 'multi');
    }
    if (ents.length === 1) return out(aboutEntity(ents[0], q, at), ents[0], null, 'entity');

    // 没点名：先看是不是通用问题
    if (/(哪些|什么|啥|几个|有没有|所有).*(项目|作品)|项目经历|做过.*项目|项目有哪些|^作品/.test(q)) return out(G.list_proj(), null, projs.map((p) => `详细说说「${p.name}」`), 'list_proj');
    if (/(哪些|什么|几段|有没有|所有).*(实习|工作)|实习经历|工作经历|在哪.*(实习|工作|上班)|实习过/.test(q)) return out(G.list_exp(), null, exps.map((e) => `在${e.name}做了什么？`), 'list_exp');
    if (/毕业/.test(q)) return out(G.graduate(), null, null, 'graduate');
    if (/学历|学校|教育|读书|大学|专业|学什么的|哪毕业/.test(q)) return out(G.edu(), null, null, 'edu');
    if (/英语|英文|语言|口语/.test(q)) return out(G.lang(), null, null, 'lang');
    if (/技能|会什么|工具|编程|python|sql|java|figma|墨刀|xmind|axure|代码|技术栈|会不会写/i.test(q)) return out(G.skills(), null, null, 'skills');
    if (/求职|意向|想找|找什么|岗位|方向|找工作|应聘|想做什么/.test(q)) return out(G.intent(), null, null, 'intent');
    if (/为什么.*(产品|pm)|适合|优势|强项|擅长|亮点|竞争力|凭什么|最大的|代表|厉害|优秀|靠谱|能力/i.test(ql)) return out(G.why(), null, null, 'why');
    if (/\bai\b|人工智能|大模型|llm|智能体|算法|模型|aigc/i.test(ql)) return out(G.ai(), null, null, 'ai');
    if (/方法论|工作方法|做事方式|怎么做产品|产品思路|工作流程/.test(q)) return out(G.method(), null, null, 'method');
    if (A.priority.test(q)) return out(G.priority(), null, null, 'priority');
    if (/调研|用户研究|访谈|问卷/.test(q)) return out(G.research(), null, null, 'research');

    // 追问：沿用上一轮聊到的经历
    const follow = /^(那|它|这个|这段|这|那段|该|还有|然后|接着|具体|详细|展开|继续|再说|多说|结果|成果|数据|难点|为什么|怎么)/.test(q) || q.length <= 8 || at.length > 0;
    if (st.last && follow) {
      const e = st.last;
      if (/^(还有|然后|接着|继续|再说|多说|还有吗|还有呢|其他)/.test(q) && e.sections?.length) {
        const seen = st.shown[e.id] || 0; const ss = e.sections.slice(seen + 1, seen + 3); st.shown[e.id] = seen + 2;
        if (ss.length) return out(sections(e, ss), e, null, 'more');
        return out(`${e.label}的内容就这些了。还可以问问另一段经历。`, e, null, 'more_end');
      }
      if (/^(具体|详细|展开)/.test(q) && !at.length) return out(e.sections?.length ? sections(e, e.sections) : overview(e), e, null, 'detail');
      return out(aboutEntity(e, q, at.length ? at : ['background']), e, null, 'follow');
    }
    if (A.result.test(q)) return out(G.results(), null, null, 'results');
    if (/介绍|你好|是谁|背景|概括|总结|简单说|怎么样|了解/.test(q)) return out(G.intro(), null, null, 'intro');
    // 最后：全简历检索
    const all = E.flatMap((e) => poolOf(e).map((c) => ({ c, e })));
    const r = rank(q, all.map((x) => x.c));
    if (r.length && r[0].sc >= 16) {
      const hit = all.find((x) => x.c === r[0].c).e;
      return out(`${head(hit)}\n` + bullet([...new Set(r.slice(0, 2).map((x) => x.c))]), hit, null, 'search');
    }
    return out(UNKNOWN, null, null, 'unknown');
  }
  return { ask, reset: () => { st.last = null; st.shown = {}; }, entities: E };
}
if (typeof module !== 'undefined') module.exports = { createAgent };
