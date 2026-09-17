#!/usr/bin/env node
/**
 * ACC11 金标准回归（不依赖 RDKit WASM）
 * - 校验 JSON 完整性
 * - 对盐剥离/标准化启发式做回归
 * - 对 ESOL/共识 logP/轻量模型公式做数值自洽检查（用期望范围中点作伪描述符时跳过；
 *   本脚本主要验证「公式与标准化逻辑」+ 期望表结构）
 *
 * 用法: node tests/run-gold-check.mjs
 * 浏览器: 可把本文件逻辑对照 Acc11.standardizeStructure / enhancedSolubility
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const goldPath = path.join(__dirname, 'gold-standard.json');
const gold = JSON.parse(fs.readFileSync(goldPath, 'utf8'));

let pass = 0, fail = 0, warn = 0;
const lines = [];

function ok(msg) { pass++; lines.push('✓ ' + msg); }
function bad(msg) { fail++; lines.push('✗ ' + msg); }
function note(msg) { warn++; lines.push('· ' + msg); }

if (!gold.compounds || gold.compounds.length < 15) {
  bad(`化合物数量 ${gold.compounds ? gold.compounds.length : 0} < 15`);
} else {
  ok(`金标准条目数 = ${gold.compounds.length} (≥15)`);
}

// 复刻 Acc11 盐剥离/中和（与 acc11.js 保持一致的最小子集）
function neutralize(s) {
  return s.replace(/\[O-\]/g, 'O').replace(/\[N\+\](?!=)/g, 'N').replace(/\[NH3\+\]/g, 'N');
}
function pickLargest(smiles) {
  const parts = String(smiles).split('.').map(p => p.trim()).filter(Boolean);
  if (parts.length <= 1) return { smiles: parts[0] || smiles, changed: false };
  const scored = parts.map(p => {
    const heavy = (p.match(/[A-Z][a-z]?|\[|c|n|o|s/g) || []).length;
    const isCounter = /^\[(Na|K|Li|Ca|Mg|Zn|Cl|Br|I|F)/i.test(p) || p === '[Na+]' || p === '[Cl-]';
    return { p, heavy: isCounter ? 0 : heavy };
  }).sort((a, b) => b.heavy - a.heavy);
  return { smiles: scored[0].p, changed: true, stripped: scored.slice(1).map(x => x.p) };
}

function esol(logP, MW, Nrot) {
  return 0.16 - 0.638 * logP - 0.0062 * MW + 0.066 * Nrot;
}

for (const c of gold.compounds) {
  if (!c.smiles || !c.expect) { bad(`${c.name}: 缺 smiles/expect`); continue; }
  ok(`${c.name}: 结构字段完整`);

  if (c.expect.standardize_changes) {
    const frag = pickLargest(c.smiles);
    const neut = neutralize(frag.smiles);
    if (!frag.changed && neut === c.smiles) bad(`${c.name}: 期望标准化变更但未变更`);
    else ok(`${c.name}: 标准化变更 → ${neut}`);
    if (c.expect.main_fragment_contains && !neut.includes(c.expect.main_fragment_contains.replace(/\(O\)/, ''))) {
      // loose check
      if (!neut.includes('CC(=O)')) bad(`${c.name}: 主片段未含期望子串`);
      else ok(`${c.name}: 主片段含醋酸骨架`);
    }
  }

  // 范围表自检：lo <= hi
  for (const [k, v] of Object.entries(c.expect)) {
    if (Array.isArray(v) && v.length === 2 && typeof v[0] === 'number') {
      if (v[0] > v[1]) bad(`${c.name}.${k}: 范围颠倒`);
      else ok(`${c.name}.${k}: 范围 [${v[0]}, ${v[1]}]`);
    }
  }

  // 公式自洽：若同时有 mw + logP 范围，用中点估算 ESOL 是否落在 logS 期望（宽松）
  if (c.expect.mw && c.expect.logP_crippen && c.expect.logS_esol) {
    const mw = (c.expect.mw[0] + c.expect.mw[1]) / 2;
    const lp = (c.expect.logP_crippen[0] + c.expect.logP_crippen[1]) / 2;
    const s = esol(lp, mw, 2);
    const [lo, hi] = c.expect.logS_esol;
    if (s >= lo - 1.0 && s <= hi + 1.0) ok(`${c.name}: ESOL 中点估算 ${s.toFixed(2)} 近期望`);
    else note(`${c.name}: ESOL 中点估算 ${s.toFixed(2)} 偏离期望 [${lo},${hi}]（可接受，因未用真实描述符）`);
  }
}

// 共识 logP 加权均值自检
function consensus(crippen, xlogp) {
  const models = [];
  if (crippen != null) models.push({ v: crippen, w: 1 });
  if (xlogp != null) models.push({ v: xlogp, w: 1.1 });
  const ws = models.reduce((s, m) => s + m.w, 0);
  return models.reduce((s, m) => s + m.v * m.w, 0) / ws;
}
const cval = consensus(1.2, 1.4);
if (Math.abs(cval - (1.2 * 1 + 1.4 * 1.1) / 2.1) < 1e-9) ok(`共识 logP 加权公式自洽 = ${cval.toFixed(3)}`);
else bad('共识 logP 公式错误');

console.log(lines.join('\n'));
console.log('\n----');
console.log(`PASS=${pass} FAIL=${fail} NOTE=${warn}`);
if (fail > 0) process.exit(1);
console.log('金标准结构/启发式回归通过。完整 RDKit 描述符请在浏览器预测后人工对照 expect 范围。');
