// AI 分身回答准确性测试。用法：在网站文件夹里运行  node tests/run.js        （默认跑全部 5 轮）
const fs = require('fs');
const path = require('path');
// 读取网站的 data.js（window.DATA = {...}）和 agent.js
function loadData(p) { const t = fs.readFileSync(p, 'utf8'); const i = t.indexOf('window.DATA ='); return JSON.parse(t.slice(t.indexOf('{', i)).trim().replace(/;\s*$/, '')); }
const root = path.join(__dirname, '..');
let rounds = process.argv.slice(2); if (!rounds.length) rounds = ['r1', 'r2', 'r3', 'r4', 'r5'];
const D = loadData(path.join(root, 'data.js'));
const { createAgent } = require(path.join(root, 'agent.js'));
const C = require('./cases.js');
const corpus = JSON.stringify(D).replace(/\\n/g, ' ');
// 日期在数据里是 2026-09，回答里显示成 2026.09，两种写法都算出自简历
const corpusAll = corpus + ' ' + corpus.replace(/(\d{4})-(\d{2})/g, '$1.$2');
const PHONE = /1\d{10}|188\s*1989|6199/;
const nums = (t) => (t.match(/\d+(?:\.\d+)?/g) || []);
let total = 0, pass = 0; const report = [];
function check(a, c, q) {
  const errs = [];
  if (!a.text) errs.push('空回答');
  (c.must || []).forEach((m) => { if (!a.text.includes(m)) errs.push(`缺少「${m}」`); });
  if (c.any && !c.any.some((m) => a.text.includes(m))) errs.push(`应至少包含其一：${c.any.join(' / ')}`);
  (c.not || []).forEach((m) => { if (a.text.includes(m)) errs.push(`不该出现「${m}」`); });
  if (PHONE.test(a.text)) errs.push('泄露手机号');
  for (const n of nums(a.text)) if (!corpusAll.includes(n)) errs.push(`数字「${n}」不在简历里`);
  return errs;
}
for (const r of rounds) {
  let rp = 0, rt = 0;
  for (const c of C[r]) {
    const bot = createAgent(D);
    const turns = c.conv || [c];
    const res = turns.map((t) => { const a = bot.ask(t.q); return { q: t.q, a: a.text, intent: a.intent, errs: check(a, t, t.q) }; });
    const ok = res.every((x) => !x.errs.length);
    rt++; total++; if (ok) { rp++; pass++; }
    report.push({ round: r, ok, turns: res });
    if (!ok) for (const x of res) if (x.errs.length) console.log(`✗ [${r}] ${x.q}\n   ${x.errs.join('；')}\n   → ${x.a.replace(/\n/g, ' ⏎ ').slice(0, 220)}`);
  }
  console.log(`== ${r}: ${rp}/${rt} 通过`);
}
console.log(`== 合计: ${pass}/${total}`);
if (pass < total) process.exitCode = 1;
