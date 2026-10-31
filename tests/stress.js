// 压力测试：组合问法 + 点击推荐问题两层，只查硬规则。用法：node tests/stress.js
const fs = require('fs');
const path = require('path');
// 读取网站的 data.js（window.DATA = {...}）和 agent.js
function loadData(p) { const t = fs.readFileSync(p, 'utf8'); const i = t.indexOf('window.DATA ='); return JSON.parse(t.slice(t.indexOf('{', i)).trim().replace(/;\s*$/, '')); }
const root = path.join(__dirname, '..');
const D = loadData(path.join(root, 'data.js'));
const { createAgent } = require(path.join(root, 'agent.js'));
const corpus = JSON.stringify(D).replace(/\\n/g, ' '); const all = corpus + ' ' + corpus.replace(/(\d{4})-(\d{2})/g, '$1.$2');
const subj = ['阿里巴巴', '阿里', '海康威视', '海康', 'B站项目', '本命追谷助手', '会员购那个项目', '健康平台', '心理健康平台', '爱丁堡大学', 'UIC', '他', '这个项目', ''];
const asks = ['做了什么', '的背景', '怎么做调研的', '竞品分析', '方案怎么设计的', '结果怎么样', '数据', '难点是什么', '怎么排优先级', '什么时候', '担任什么角色', '用了什么工具', '有多少', '是不是很厉害', '还有呢', '详细说说', '为什么这么做', '学到了什么', '团队多大', '花了多少钱'];
const extra = ['', '？', '呢', '吗'];
let n = 0; const bad = [];
const rule = (q, a) => {
  const e = [];
  if (!a.text || a.text.length < 4) e.push('空回答');
  if (/undefined|null|NaN|\[object/.test(a.text)) e.push('程序错误字样');
  if (/1\d{10}|6199/.test(a.text)) e.push('泄露手机号');
  for (const x of a.text.match(/\d+(?:\.\d+)?/g) || []) if (!all.includes(x)) e.push(`简历外数字 ${x}`);
  if (a.text.length > 900) e.push('回答过长 ' + a.text.length);
  if (e.length) bad.push({ q, e, a: a.text.slice(0, 120) });
};
for (const s of subj) for (const k of asks) for (const x of extra) { const bot = createAgent(D); const q = s + k + x; rule(q, bot.ask(q)); n++; }
// 多轮：先问一个经历，再问每种追问
for (const s of subj.slice(0, 10)) { const bot = createAgent(D); bot.ask(s); for (const k of asks) { rule(`${s} → ${k}`, bot.ask(k)); n++; } }
// 点击推荐问题两层
const start = D.questions; let clicks = 0;
for (const q1 of start) { const bot = createAgent(D); const a1 = bot.ask(q1); rule(q1, a1); clicks++;
  for (const q2 of a1.chips.slice(0, 3)) { const a2 = bot.ask(q2); rule(`${q1} → ${q2}`, a2); clicks++;
    for (const q3 of a2.chips.slice(0, 3)) { const a3 = bot.ask(q3); rule(`${q1} → ${q2} → ${q3}`, a3); clicks++; } } }
console.log(`组合问题 ${n} 个，推荐问题点击 ${clicks} 次，违反硬规则 ${bad.length} 次`);
bad.slice(0, 15).forEach((b) => console.log('✗', b.q, b.e.join('；'), '→', b.a.replace(/\n/g, ' ')));
if (bad.length) process.exitCode = 1;
