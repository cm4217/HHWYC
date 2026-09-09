/* 主逻辑：输入解析、调用 RDKit/PubChem、渲染结果、批量与导出 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const els = {
    inputType: $('inputType'), role: $('role'), roleHint: $('roleHint'), input: $('compoundInput'),
    predictBtn: $('predictBtn'), batchBtn: $('batchBtn'), clearBtn: $('clearBtn'),
    exportCsvBtn: $('exportCsvBtn'), exportJsonBtn: $('exportJsonBtn'),
    printBtn: $('printBtn'),
    chemspiderBtn: $('chemspiderBtn'), chemicalizeBtn: $('chemicalizeBtn'), extNote: $('extNote'),
    status: $('statusMsg'), engineStatus: $('engineStatus'),
    resultSection: $('resultSection'), batchSection: $('batchSection'),
    notFoundPanel: $('notFoundPanel'), resultHero: $('resultHero'),
    identityTable: $('identityTable'), structureImg: $('structureImg'),
    reactiveNotes: $('reactiveNotes'), propGrid: $('propGrid'),
    solubilityPanel: $('solubilityPanel'), phPanel: $('phPanel'),
    admePanel: $('admePanel'), radarChart: $('radarChart'), radarLegend: $('radarLegend'),
    batchTableWrap: $('batchTableWrap'), aboutToggle: $('aboutToggle'), aboutSection: $('aboutSection'),
    aboutContent: $('aboutContent'), exampleChips: $('exampleChips'),
    spectraComputed: $('spectraComputed'),
    spectraLinks: $('spectraLinks'),
    thermoPanel: $('thermoPanel'),
    geometryPanel: $('geometryPanel'),
    formPanel: $('formPanel'),
    conformerPanel: $('conformerPanel'),
    toxPanel: $('toxPanel'),
    medchemPanel: $('medchemPanel'),
    impurityExportBtn: $('impurityExportBtn'), impurityPanel: $('impurityPanel'),
    dictFileInput: $('dictFileInput'), dictImportBtn: $('dictImportBtn'), dictClearBtn: $('dictClearBtn'), dictImportStatus: $('dictImportStatus'),
    chemspiderIdBtn: $('chemspiderIdBtn'), chemblBtn: $('chemblBtn'), drugbankBtn: $('drugbankBtn'),
    drugcentralBtn: $('drugcentralBtn'), zincBtn: $('zincBtn'), chebiBtn: $('chebiBtn'),
    wikiBtn: $('wikiBtn'), patentIdBtn: $('patentIdBtn'), scholarIdBtn: $('scholarIdBtn'),
    historyList: $('historyList'), historyEmpty: $('historyEmpty'),
    historyClearBtn: $('historyClearBtn'), historyToggleBtn: $('historyToggleBtn'),
    suggestBox: $('suggestBox'), calcOverlay: $('calcOverlay'),
    imageDropZone: $('imageDropZone'), imagePreview: $('imagePreview'),
    imageOcrRunBtn: $('imageOcrRunBtn'), mainOcrFile: $('mainOcrFile'),
    onlineOcrBtn: $('onlineOcrBtn'),
    localOcrUrl: $('localOcrUrl'), localOcrTestBtn: $('localOcrTestBtn'),
    localOcrInstallBtn: $('localOcrInstallBtn'), localOcrGuide: $('localOcrGuide'),
    localOcrCopyCmd: $('localOcrCopyCmd'), localOcrDownloadBundle: $('localOcrDownloadBundle'),
    localOcrManualCmd: $('localOcrManualCmd'),
    mainOcrStatus: $('mainOcrStatus'),
    resultToc: $('resultToc'), tocNav: $('tocNav'),
  };

  /* ---------- 查询历史（localStorage 持久化） ---------- */
  const HISTORY_KEY = 'chemprop_history_v1';
  const HISTORY_MAX = 60;
  let queryHistory = [];
  let historyCollapsed = false;

  function loadHistory() {
    try { queryHistory = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]') || []; }
    catch (e) { queryHistory = []; }
    if (!Array.isArray(queryHistory)) queryHistory = [];
  }
  function saveHistory() {
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(queryHistory)); } catch (e) { /* 隐私模式/禁用存储时静默 */ }
  }
  function addHistory(data) {
    const pc = data.pubchem, rd = data.rdkit;
    const name = (pc && (pc.iupac || pc.title)) ? (pc.iupac || pc.title) : data.input;
    const cas = (pc && pc.cas) || (data.type === 'cas' ? data.input : '');
    const mw = (rd && rd.desc && rd.desc.amw != null) ? +rd.desc.amw.toFixed(2) : null;
    const entry = {
      id: Date.now() + '-' + Math.random().toString(36).slice(2, 7),
      time: new Date().toISOString(),
      input: data.input, type: data.type, role: data.role,
      name, smiles: data.smiles || '',
      mw, cid: (pc && pc.cid) ? pc.cid : '', cas: cas || '',
      count: 1,
    };
    // 去重：相同「输入+类型+角色」合并为一条，更新到顶部并累加次数
    const idx = queryHistory.findIndex(h => h.input === entry.input && h.type === entry.type && h.role === entry.role);
    if (idx !== -1) {
      const old = queryHistory[idx];
      entry.count = (old.count || 1) + 1;
      // 保留旧 id 以便稳定化（可选），但重排后 id 用新的也无妨
      queryHistory.splice(idx, 1);
    }
    queryHistory.unshift(entry);
    if (queryHistory.length > HISTORY_MAX) queryHistory = queryHistory.slice(0, HISTORY_MAX);
    saveHistory();
    renderHistory();
  }
  function fmtTime(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  function renderHistory() {
    if (!els.historyList || !els.historyEmpty) return;
    if (!queryHistory.length) {
      els.historyList.innerHTML = '';
      els.historyEmpty.classList.remove('hidden');
      return;
    }
    els.historyEmpty.classList.add('hidden');
    const typeLabel = (t) => ({ smiles: 'SMILES', name: '名称', cas: 'CAS', inchi: 'InChI', auto: '自动' }[t] || t || '');
    els.historyList.innerHTML = queryHistory.map(h => {
      const meta = [];
      if (h.type) meta.push(`<span class="badge badge-neutral">${typeLabel(h.type)}</span>`);
      if (h.mw != null) meta.push(`<span class="badge badge-src-rd">MW ${h.mw}</span>`);
      if (h.cid) meta.push(`<span class="badge badge-src-pub">CID ${h.cid}</span>`);
      if (h.cas && !h.cid) meta.push(`<span class="badge badge-neutral">CAS ${escapeHtml(h.cas)}</span>`);
      const time = fmtTime(h.time);
      const countBadge = (h.count || 1) > 1 ? `<span class="h-count" title="该查询已被重复 ${h.count} 次">×${h.count}</span>` : '';
      return `<div class="history-item" data-id="${h.id}" title="点击重现该查询（已重复 ${h.count || 1} 次）">
        <div class="h-main">
          <div class="h-name">${escapeHtml(h.name || h.input)}${countBadge}</div>
          <div class="h-meta">${meta.join('')}${time ? `<span class="h-time">${time}</span>` : ''}</div>
        </div>
        <div class="h-actions">
          <button class="btn btn-sm btn-secondary" data-act="rerun" type="button">重查</button>
          <button class="btn btn-sm btn-ghost" data-act="remove" type="button" title="从历史中移除">×</button>
        </div>
      </div>`;
    }).join('');
  }
  function rerunHistory(id) {
    const h = queryHistory.find(x => x.id === id);
    if (!h) return;
    els.input.value = h.input;
    if (els.inputType.querySelector(`option[value="${h.type}"]`)) els.inputType.value = h.type;
    if (els.role.querySelector(`option[value="${h.role}"]`)) els.role.value = h.role;
    runSingle();
  }
  function removeHistory(id) {
    queryHistory = queryHistory.filter(x => x.id !== id);
    saveHistory();
    renderHistory();
  }
  function clearHistory() {
    if (!queryHistory.length) return;
    if (!confirm('确定清空全部查询历史？此操作不可撤销。')) return;
    queryHistory = [];
    saveHistory();
    renderHistory();
  }
  // ⑥ 查询历史导出 Excel（SheetJS）
  function exportHistoryXLSX() {
    if (typeof XLSX === 'undefined') { setStatus('Excel 组件未加载，无法导出。', 'err'); return; }
    if (!queryHistory.length) { setStatus('查询历史为空，无需导出。', 'warn'); return; }
    const head = ['时间', '名称', '输入', '类型', '角色', 'SMILES', 'MW', 'CAS', 'PubChem CID', '查询次数'];
    const body = queryHistory.map(h => [
      fmtTime(h.time), h.name || '', h.input, h.type || '', h.role || '',
      h.smiles || '', h.mw != null ? h.mw : '', h.cas || '', h.cid || '', h.count || 1,
    ]);
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([head].concat(body));
    ws['!cols'] = [{ wch: 17 }, { wch: 24 }, { wch: 22 }, { wch: 8 }, { wch: 10 }, { wch: 40 }, { wch: 10 }, { wch: 14 }, { wch: 10 }, { wch: 8 }];
    XLSX.utils.book_append_sheet(wb, ws, '查询历史');
    XLSX.writeFile(wb, '查询历史_' + new Date().toISOString().slice(0, 10) + '.xlsx');
    setStatus('已导出查询历史 Excel。', 'ok');
  }
  function toggleHistory() {
    historyCollapsed = !historyCollapsed;
    const hide = historyCollapsed;
    if (els.historyList) els.historyList.classList.toggle('hidden', hide);
    if (els.historyEmpty) els.historyEmpty.classList.toggle('hidden', hide);
    if (els.historyToggleBtn) els.historyToggleBtn.textContent = hide ? '展开' : '收起';
  }

  let lastSingle = null;
  let lastBatch = [];
  // 警示结构高亮交互所需的模块级状态
  let currentSmiles = '';
  let currentPlainSvg = '';
  let currentToxAlerts = []; // 扁平化后的警示项（含 atoms/bonds），供点击高亮
  let toxHandlerAttached = false;

  /* ---------- 工具 ---------- */
  function setStatus(msg, kind) {
    els.status.textContent = msg || '';
    els.status.className = 'status-msg' + (kind ? ' ' + kind : '');
  }
  function showCalcOverlay(text) {
    if (!els.calcOverlay) return;
    const t = els.calcOverlay.querySelector('.calc-text');
    if (t) t.textContent = text || '正在计算…';
    els.calcOverlay.classList.remove('hidden');
    document.body.classList.add('calc-lock');
  }
  function updateCalcOverlay(text) {
    if (!els.calcOverlay) return;
    const t = els.calcOverlay.querySelector('.calc-text');
    if (t) t.textContent = text || '正在计算…';
  }
  // 进度条（百分比 0~100；传 null 隐藏）
  function setCalcBar(pct) {
    if (!els.calcOverlay) return;
    const bar = els.calcOverlay.querySelector('.calc-bar');
    if (!bar) return;
    if (pct == null) { bar.classList.add('hidden'); return; }
    bar.classList.remove('hidden');
    const fill = bar.querySelector('.calc-bar-fill');
    if (fill) fill.style.width = Math.max(0, Math.min(100, pct)) + '%';
  }
  function hideCalcOverlay() {
    if (!els.calcOverlay) return;
    els.calcOverlay.classList.add('hidden');
    document.body.classList.remove('calc-lock');
  }
  function csvEscape(v) {
    const s = (v == null ? '' : String(v));
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function download(filename, content, mime) {
    const blob = new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /* ---------- 输入识别 ---------- */
  function detectType(s) {
    s = s.trim();
    if (/^inchi=/i.test(s)) return 'inchi';
    if (/^\d{1,7}-\d{2}-\d$/.test(s)) return 'cas';
    if (/^[A-Za-z0-9@+\-[\]().\/=#%~:!\\]+$/.test(s) && /[cnopsCNOPS]/.test(s) && !/\s/.test(s)) return 'smiles';
    return 'name';
  }
  const TYPE_LABEL = { smiles: 'SMILES', name: '化合物名称', cas: 'CAS 号', inchi: 'InChI', auto: '自动' };
  const ROLE_LABEL_ZH = { intermediate: '中间体', api: '原料药', impurity: '杂质', reagent: '试剂', unknown: '未指定' };
  function roleLabelZh(r) { return ROLE_LABEL_ZH[r] || r || '未指定'; }

  /* ---------- 化合物角色智能识别（本地优先，无网络依赖） ----------
   * 返回 'intermediate' | 'api' | 'impurity' | 'reagent' | null（null=无法确定）。
   * 设计原则：
   *  1) 仅在「有把握」时给出结论；把握不足返回 null，交由用户手动选择。
   *  2) 数据源优先级：项目种子库(COMPOUND_SEED, 含 role) > 本地词典(COMPOUND_DICT, cat 类别) > 名称/标题关键词规则。
   *  3) 纯本地推理：不发起任何网络请求，可在输入即时触发。
   */
  function inferRoleLocalOnly(raw, type) {
    const seed = (typeof window !== 'undefined' && window.COMPOUND_SEED) ? window.COMPOUND_SEED : [];
    const dict = (typeof window !== 'undefined' && window.COMPOUND_DICT) ? window.COMPOUND_DICT : [];
    const q = (raw || '').trim().toLowerCase();
    if (!q) return null;
    const casList = [];
    if (type === 'cas') casList.push(q);
    // ① 种子库按 CAS 匹配（种子库自带权威 role 字段）
    for (const e of seed) {
      if (e.cas && casList.includes(String(e.cas).toLowerCase())) {
        if (e.role === 'api') return 'api';
        if (e.role === 'reagent') return 'reagent';
      }
    }
    // ② 本地词典按名称/简称/官方名匹配，再用其类别标签判定
    const dictHit = (e) => {
      const hay = [e.c || '', ...((e.cm || []).map(x => String(x))), ...((e.of || []).map(x => String(x))), ...((e.ab || []).map(x => String(x)))].map(x => x.toLowerCase());
      return hay.some(h => h && (h === q || q.indexOf(h) !== -1 || h.indexOf(q) !== -1));
    };
    for (const e of dict) {
      if (!dictHit(e)) continue;
      const cat = (e.cat || '').toLowerCase();
      if (cat.indexOf('api') !== -1) return 'api';
      if (cat.indexOf('中间体') !== -1) return 'intermediate';
      if (cat.indexOf('杂质') !== -1) return 'impurity';
      if (cat.indexOf('试剂') !== -1 || cat.indexOf('reagent') !== -1) return 'reagent';
    }
    // ③ 用户输入名称关键词规则
    if (/中间体|intermediate/.test(q)) return 'intermediate';
    if (/(api|原料药|原药|原粉)/.test(q)) return 'api';
    if (/(杂质|impurity|genotoxic|mutagenic|致突变)/.test(q)) return 'impurity';
    if (/(试剂|reagent)/.test(q)) return 'reagent';
    return null;
  }

  // 带 PubChem 解析结果（pc）与本地兜底结果（local）的增强识别（仍需联网解析后才调用）
  function inferRole(raw, type, pc, local) {
    const localGuess = inferRoleLocalOnly(raw, type);
    if (localGuess) return localGuess;
    const seed = (typeof window !== 'undefined' && window.COMPOUND_SEED) ? window.COMPOUND_SEED : [];
    const casList = [pc && pc.cas, local && local.refs && local.refs.cas].filter(Boolean).map(String);
    for (const e of seed) {
      if (e.cas && casList.indexOf(String(e.cas)) !== -1) {
        if (e.role === 'api') return 'api';
        if (e.role === 'reagent') return 'reagent';
      }
    }
    if (pc && pc.title) {
      const t = (' ' + pc.title).toLowerCase();
      if (/中间体|intermediate/.test(t)) return 'intermediate';
      if (/(api|原料药|原药|原粉)/.test(t) && !/杂质|impurity|试剂|reagent/.test(t)) return 'api';
      if (/(杂质|impurity|致突变)/.test(t)) return 'impurity';
      if (/(试剂|reagent)/.test(t)) return 'reagent';
    }
    return null;
  }

  /* ---------- 角色 UI 状态提示与跨模块联动 ---------- */
  // 用户手动指定后锁定，自动识别不再覆盖；手动改回「未指定」时解除锁定。
  let roleAutoLocked = false;

  function updateRoleHint(state, role) {
    const el = els.roleHint;
    if (!el) return;
    if (state === 'auto') {
      el.className = 'role-hint auto';
      el.innerHTML = '🤖 ' + T('roleAuto') + '：' + roleLabelZh(role);
      els.role.classList.remove('need-role');
    } else if (state === 'manual') {
      el.className = 'role-hint manual';
      el.innerHTML = '✋ ' + T('roleManual') + '：' + roleLabelZh(role);
      els.role.classList.remove('need-role');
    } else if (state === 'unknown') {
      el.className = 'role-hint unknown';
      el.innerHTML = '⚠️ ' + T('roleUnknownHint');
      els.role.classList.add('need-role');
    } else {
      el.className = 'role-hint';
      el.innerHTML = '';
      els.role.classList.remove('need-role');
    }
  }

  // 统一设置角色并联动所有相关模块：下拉框、当前结果(identity/hero 徽标)、查询历史、结果缓存（跨会话记忆）
  function setCompoundRole(role, opts) {
    opts = opts || {};
    if (!(role in ROLE_LABEL_ZH)) role = 'unknown';
    els.role.value = role;
    if (opts.fromUser) roleAutoLocked = true;
    if (opts.fromAuto) roleAutoLocked = false;
    // 联动当前结果区：更新 lastSingle 角色并重渲染身份/概览徽标
    if (lastSingle) {
      lastSingle.role = role;
      try { renderIdentity(lastSingle); renderHero(lastSingle); } catch (e) {}
      // 联动查询历史中对应条目
      const h = queryHistory.find(x => x.input === lastSingle.input && x.type === lastSingle.type);
      if (h) { h.role = role; saveHistory(); }
    }
    // 联动结果缓存：把角色写入以 SMILES 为键的缓存，下次同结构自动复用角色（自进化记忆）
    if (opts.smiles) {
      const c = loadResultCache();
      if (c && c[opts.smiles]) { c[opts.smiles].role = role; saveResultCache(); }
    }
    updateRoleHint(opts.fromUser ? 'manual' : 'auto', role);
  }

  // 输入即时本地识别（无网络）：仅在未手动锁定时提示建议角色；无法确定时提示手动选择
  function liveRoleCheck() {
    if (roleAutoLocked) return;
    const raw = els.input.value.trim();
    if (!raw) { updateRoleHint(null); return; }
    const type = els.inputType.value === 'auto' ? null : els.inputType.value;
    const g = inferRoleLocalOnly(raw, type);
    if (g) updateRoleHint('auto', g);
    else updateRoleHint(raw.length >= 2 ? 'unknown' : null, null);
  }

  /* ---------- 本地词典兜底（即使 pubchem.js 未更新也能命中） ---------- */
  function findLocalSmiles(raw) {
    const dict = (typeof window !== 'undefined' && window.COMPOUND_DICT) ? window.COMPOUND_DICT : [];
    if (!dict.length || !raw) return null;
    const q = raw.trim().toLowerCase();
    for (const e of dict) {
      if (!e.s) continue;
      const casList = [e.cas, ...(e.cas_alt || [])].filter(Boolean).map(x => String(x).toLowerCase());
      const hay = [
        ...casList,
        (e.c || '').toLowerCase(),
        ...((e.ab || []).map(x => String(x).toLowerCase())),
        ...((e.cm || []).map(x => String(x).toLowerCase())),
        ...((e.of || []).map(x => String(x).toLowerCase())),
      ];
      if (hay.some(h => h === q || h.includes(q))) {
        const refs = Object.assign({ cas: e.cas || null }, e.refs || {});
        return { name: e.c || raw, smiles: e.s, refs };
      }
    }
    return null;
  }

  /* ---------- 核心分析 ---------- */
  /* ---------- PubChem 3D 构象（SDF 解析，为查看器提供真实 3D 坐标） ---------- */
  // 本地 RDKit 最小构建未暴露 EmbedMolecule / MMFF，无法本地生成 3D；
  // 当化合物已匹配 PubChem CID 时，改取 PubChem 3D 构象记录（真实三维坐标）。
  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  async function fetchText(url, timeoutMs, retries) {
    timeoutMs = timeoutMs || 12000;
    retries = retries || 2;
    let lastErr = null;
    for (let i = 0; i < retries; i++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await fetch(url, { signal: ctrl.signal });
        clearTimeout(timer);
        if (res.ok) return await res.text();
        if (res.status === 404) return null;
        if (res.status === 429) { await sleep(700 * (i + 1)); continue; }
        throw new Error('HTTP ' + res.status);
      } catch (e) {
        clearTimeout(timer);
        lastErr = e;
        if (/Failed to fetch|network|timeout|abort/i.test(String(e.message))) { await sleep(600); continue; }
        throw e;
      }
    }
    if (lastErr) throw lastErr;
    throw new Error('fetch 失败（已达重试上限）');
  }

  async function fetchPubChem3D(cid) {
    const url = 'https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/' + encodeURIComponent(cid) + '/SDF?record_type=3d';
    const text = await fetchText(url, 12000, 2).catch(() => null);
    if (!text || !text.trim()) return null;
    return parseSDF3D(text);
  }

  async function fetchPubChem3DBySmiles(smiles) {
    const url = 'https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/smiles/' + encodeURIComponent(smiles) + '/SDF?record_type=3d';
    const text = await fetchText(url, 12000, 2).catch(() => null);
    if (!text || !text.trim()) return null;
    return parseSDF3D(text);
  }

  async function fetchPubChem2D(smiles) {
    const url = 'https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/smiles/' + encodeURIComponent(smiles) + '/SDF?record_type=2d';
    const text = await fetchText(url, 12000, 2).catch(() => null);
    if (!text || !text.trim()) return null;
    const c = parseSDF3D(text);
    if (!c || !c.atoms || !c.atoms.length) return null;
    // 2D SDF 无真实 z，注入伪 z 使其可旋转，避免纯平铺
    const rings = findRings(c.atoms, c.bonds);
    const ringAtoms = new Set();
    rings.forEach(r => r.forEach(i => ringAtoms.add(i)));
    const atoms = c.atoms.map((a, i) => {
      let z = 0;
      if (!ringAtoms.has(i)) {
        const h = Math.sin(i * 12.9898 + a.x * 78.233 + a.y * 43.123) * 43758.5453;
        const r = h - Math.floor(h);
        z = (r - 0.5) * 1.5;
        if (a.sym === 'H') z *= 0.35;
      }
      return { idx: a.idx, x: a.x, y: a.y, z: z, sym: a.sym };
    });
    return { atoms, bonds: c.bonds, has3D: false };
  }

  // SDF 数据用的简单环检测（与 rdkit-engine 逻辑一致）
  function findRings(atoms, bonds, maxSize) {
    maxSize = maxSize || 10;
    const n = atoms.length;
    const adj = atoms.map(() => []);
    bonds.forEach(b => {
      if (b.i >= 0 && b.i < n && b.j >= 0 && b.j < n) {
        adj[b.i].push(b.j);
        adj[b.j].push(b.i);
      }
    });
    const rings = [];
    const seen = new Set();
    function dfs(start) {
      const path = [start];
      const visited = new Set([start]);
      function go(u) {
        for (const v of adj[u]) {
          if (v === start && path.length >= 3 && path.length <= maxSize) {
            const key = path.slice().sort((a, b) => a - b).join(',');
            if (!seen.has(key)) { seen.add(key); rings.push(path.slice()); }
            continue;
          }
          if (visited.has(v)) continue;
          if (path.length >= maxSize) continue;
          path.push(v); visited.add(v); go(v); path.pop(); visited.delete(v);
        }
      }
      go(start);
    }
    for (let i = 0; i < n; i++) dfs(i);
    return rings;
  }

  function parseSDF3D(sdf) {
    const blocks = sdf.split('$$$$');
    const block = (blocks[0] || sdf).trim().split('\n');
    // SDF 标准 counts 行在第 4 行（0-indexed 3），优先使用；若 header 含数字导致误识别再回退搜索
    function isCountsLine(i) {
      const parts = block[i].trim().split(/\s+/);
      return parts.length >= 2 && /^\d+$/.test(parts[0]) && /^\d+$/.test(parts[1]) && parseInt(parts[0], 10) > 0;
    }
    let countsLine = -1;
    if (block[3] && isCountsLine(3)) countsLine = 3;
    else {
      for (let i = 0; i < block.length; i++) {
        if (isCountsLine(i)) { countsLine = i; break; }
      }
    }
    if (countsLine < 0) return null;
    const c = block[countsLine].trim().split(/\s+/);
    const nAtoms = parseInt(c[0], 10), nBonds = parseInt(c[1], 10);
    const atoms = [];
    for (let i = 0; i < nAtoms; i++) {
      const t = (block[countsLine + 1 + i] || '').trim().split(/\s+/);
      if (t.length < 4) continue;
      atoms.push({ idx: i, x: parseFloat(t[0]), y: parseFloat(t[1]), z: parseFloat(t[2]), sym: (t[3] || 'C').replace(/[^A-Za-z]/g, '') });
    }
    const bonds = [];
    for (let i = 0; i < nBonds; i++) {
      const t = (block[countsLine + 1 + nAtoms + i] || '').trim().split(/\s+/);
      const a = parseInt(t[0], 10) - 1, b = parseInt(t[1], 10) - 1;
      let o = parseInt(t[2], 10) || 1;
      const order = o === 4 ? 1.5 : (o === 2 ? 2 : (o === 3 ? 3 : 1));
      if (a >= 0 && b >= 0) bonds.push({ i: a, j: b, order });
    }
    const has3D = atoms.some(a => Math.abs(a.z) > 0.01);
    return { atoms, bonds, has3D };
  }

  // 第二个独立 3D 构象来源：NCI/CADD Cactus 3D 生成器（与 PubChem 不同算法，用于多构象对比）
  async function fetchCactus3D(smiles) {
    const url = 'https://cactus.nci.nih.gov/chemical/structure/' + encodeURIComponent(smiles) + '/file?format=sdf&get3d=true';
    const text = await fetchText(url, 12000, 2).catch(() => null);
    if (!text || !text.trim()) return null;
    const c = parseSDF3D(text);
    if (c && c.atoms && c.atoms.length) return { atoms: c.atoms, bonds: c.bonds, has3D: c.has3D };
    return null;
  }

  // 将构象原子/键重排为「规范顺序」，使来自不同来源（PubChem / Cactus）的同一分子
  // 具有一致的原子编号，从而可在查看器中按原子对应叠加对比。
  function canonicalizeConformer(atoms, bonds) {
    const n = atoms.length;
    const adj = atoms.map(() => []);
    bonds.forEach(b => {
      if (b.i >= 0 && b.i < n && b.j >= 0 && b.j < n) { adj[b.i].push(b.j); adj[b.j].push(b.i); }
    });
    const sig = atoms.map((a, i) => (a.sym || 'C') + ':' + adj[i].length + ':' + adj[i].map(j => (atoms[j].sym || 'C')).sort().join(','));
    const order = atoms.map((_, i) => i).sort((a, b) => sig[a] < sig[b] ? -1 : sig[a] > sig[b] ? 1 : a - b);
    const visited = new Array(n).fill(false);
    const newIndex = new Array(n).fill(-1);
    let k = 0;
    const label = (start) => {
      const queue = [start]; visited[start] = true; newIndex[start] = k++;
      while (queue.length) {
        const u = queue.shift();
        const nbrs = adj[u].slice().sort((a, b) => sig[a] < sig[b] ? -1 : sig[a] > sig[b] ? 1 : a - b);
        for (const v of nbrs) { if (!visited[v]) { visited[v] = true; newIndex[v] = k++; queue.push(v); } }
      }
    };
    for (const s of order) if (!visited[s]) label(s);
    const newAtoms = new Array(n);
    for (let i = 0; i < n; i++) newAtoms[newIndex[i]] = { idx: newIndex[i], x: atoms[i].x, y: atoms[i].y, z: atoms[i].z, sym: atoms[i].sym };
    const newBonds = bonds.filter(b => b.i >= 0 && b.i < n && b.j >= 0 && b.j < n).map(b => ({ i: newIndex[b.i], j: newIndex[b.j], order: b.order }));
    return { atoms: newAtoms, bonds: newBonds };
  }

  /* ---------- ⑨ 结果缓存：同 SMILES 秒回（内存 Map + localStorage 限量） ---------- */
  const RESULT_CACHE_KEY = 'chemprop_cache_v1';
  let resultCache = null; // { smiles -> {desc, pka, smiles, saved} }
  function loadResultCache() {
    if (resultCache) return resultCache;
    try { const raw = localStorage.getItem(RESULT_CACHE_KEY); resultCache = raw ? JSON.parse(raw) : {}; }
    catch (e) { resultCache = {}; }
    if (!resultCache || typeof resultCache !== 'object') resultCache = {};
    return resultCache;
  }
  function saveResultCache() {
    try {
      const keys = Object.keys(resultCache || {});
      if (keys.length > 400) { // 限量：超出时删除最早的 200 条
        const sorted = keys.sort((a, b) => ((resultCache[a] || {}).t || 0) - ((resultCache[b] || {}).t || 0));
        sorted.slice(0, keys.length - 400).forEach(k => delete resultCache[k]);
      }
      localStorage.setItem(RESULT_CACHE_KEY, JSON.stringify(resultCache));
    } catch (e) {}
  }

  async function analyzeSingle(raw, forceType, role, seq) {
    const type = forceType || detectType(raw);
    let pc = null;
    try { pc = await PubChem.resolve(raw, type); } catch (e) { pc = null; }
    if (seq != null && seq !== _runSeq) throw new Error('SUPERSEDED'); // 已有更新的查询发起，立即放弃本次
    updateCalcOverlay('② 解析 PubChem / 本地词库…');

    let smiles = (pc && pc.canonicalSmiles) ? pc.canonicalSmiles : null;
    if (!smiles && type === 'smiles') smiles = raw.trim();

    // PubChem/Cactus 失败时，用本地化合物词典兜底
    let local = null;
    if (!smiles && (type === 'name' || type === 'auto' || type === 'cas')) {
      local = findLocalSmiles(raw);
      if (local) {
        smiles = local.smiles;
        pc = pc || { title: local.name, canonicalSmiles: local.smiles, isomericSmiles: local.smiles, refs: local.refs || null };
      }
    }

    if (!smiles) {
      throw new Error('未能在 PubChem 匹配该' + (TYPE_LABEL[type] || '标识') + '，请直接输入 SMILES 进行本地预测。');
    }

    // ⑨ 结果缓存：命中则复用已计算的描述符/警示（跳过 RDKit 重算），秒回
    const cacheKey = (type === 'smiles' ? raw.trim() : smiles);
    const cache = loadResultCache();
    const hit = cache && cache[cacheKey];

    // ⑩ 角色智能识别：调用方显式传入具体角色（非 unknown）时优先采用（用户/批量统一指定）；
    // 否则优先复用结果缓存中已记忆的角色（跨会话自进化），再回退到自动识别；均无法确定则为 unknown。
    const cachedRole = (hit && hit.role) ? hit.role : null;
    const finalRole = (role && role !== 'unknown') ? role : (cachedRole || inferRole(raw, type, pc, local) || 'unknown');

    if (hit && hit.desc && hit.pka) {
      updateCalcOverlay('③ 命中本地缓存，秒回结果…');
      const rdCached = {
        desc: hit.desc, pka: hit.pka, smiles,
        svg: hit.svg || '', inchi: hit.inchi || '', inchikey: hit.inchikey || '',
        formula: hit.formula || '', groups: hit.groups || [], acidbase: hit.acidbase || null,
        pains: hit.pains || [], brenk: hit.brenk || [],
      };
      const pred = Predict.all(rdCached.desc, rdCached.pka);
      const toxicity = hit.toxicity ? { parsed: true, all: hit.toxicity.all || [], byCat: hit.toxicity.byCat || {}, total: hit.toxicity.total || 0, severe: hit.toxicity.severe || 0, summary: hit.toxicity.summary || '' } : null;
      return { type, input: raw.trim(), role: finalRole, pubchem: pc, rdkit: rdCached, smiles, pred, geometry: hit.geometry || null, toxicity, form: hit.form || null, conformer: null, conformers: [], cached: true };
    }

    const eng = await RDKitEngine.init();
    updateEngineStatus(); // 引擎来源（本地/CDN）在加载后确定，刷新状态徽标
    if (seq != null && seq !== _runSeq) throw new Error('SUPERSEDED'); // RDKit 计算前再校验一次，过期查询不再抢占 wasm 资源
    updateCalcOverlay('③ 本地 RDKit 计算理化描述符…');
    const rd = eng.compute(smiles);
    const pred = Predict.all(rd.desc, rd.pka);
    let geometry = null;
    try { geometry = eng.computeGeometry(smiles); } catch (e) { geometry = null; }
    let toxicity = null;
    try { toxicity = eng.toxicityAlerts(smiles); } catch (e) { toxicity = null; }
    let form = null;
    try { form = eng.analyzeForm(smiles); } catch (e) { form = null; }
    let conformer = null;
    try { conformer = eng.compute3D(smiles); } catch (e) { conformer = null; }
    updateCalcOverlay('④ 生成 3D 构象与警示结构筛查…');
    // 3D 构象：并行取两个独立生成器的真实 3D 坐标（PubChem 3D + Cactus 3D），用于多构象对比/叠加；
    // 本地 RDKit 最小构建无 EmbedMolecule，无法本地生成 3D，故仅作 2D 兜底。
    const conformers = [];
    const seenSources = new Set();
    const pushConf = (c, source, note, sourceType) => {
      if (!c || !c.atoms || !c.atoms.length) return;
      // 简单去重：同来源且原子/键数一致则只保留首个
      const key = source + '|' + c.atoms.length + '|' + c.bonds.length;
      if (seenSources.has(key)) return;
      seenSources.add(key);
      const cc = canonicalizeConformer(c.atoms, c.bonds);
      conformers.push({ ok: true, has3D: !!c.has3D, atoms: cc.atoms, bonds: cc.bonds, source, note, sourceType: sourceType || (c.has3D ? 'real3d' : 'pseudo3d') });
    };

    // 3D 构象：优先真实 3D 坐标（PubChem 3D by CID / SMILES + Cactus 3D）
    // 本地 RDKit 最小构建无 EmbedMolecule，无法本地生成真实 3D，故 online 源失败后回退到 2D→伪 3D / 本地伪 3D。
    const [pc3, ca3, pc3BySmi] = await Promise.all([
      (pc && pc.cid) ? fetchPubChem3D(pc.cid).catch(() => null) : Promise.resolve(null),
      fetchCactus3D(smiles).catch(() => null),
      fetchPubChem3DBySmiles(smiles).catch(() => null)
    ]);
    if (pc3 && pc3.has3D) pushConf(pc3, 'PubChem 3D', 'PubChem 提供的 3D 构象记录（实验/模型坐标）。真实分子存在多种构象异构体，此处为一种构象近似。');
    if (ca3 && ca3.has3D) pushConf(ca3, 'Cactus 3D', 'NCI/CADD Cactus 独立 3D 生成器给出的低能构象（与 PubChem 不同算法），用于构象对比/叠加。');
    if (pc3BySmi && pc3BySmi.has3D) pushConf(pc3BySmi, 'PubChem 3D', 'PubChem（按 SMILES 匹配）提供的 3D 构象记录。真实分子存在多种构象异构体，此处为一种构象近似。');

    // 真实 3D 全部失败后：尝试 PubChem 2D SDF → 伪 3D
    if (!conformers.length) {
      const pc2 = await fetchPubChem2D(smiles).catch(() => null);
      if (pc2 && pc2.atoms && pc2.atoms.length) pushConf(pc2, 'PubChem 2D→伪3D', 'PubChem 2D 坐标经深度扰动生成的伪 3D 投影（非真实力场构象），用于观察分子大致空间排布。', 'pseudo3d');
    }

    // 最后兜底：本地 RDKit 2D→伪 3D（compute3D 已内置伪 3D 生成，通常不会为空）
    if (!conformers.length && conformer && conformer.atoms && conformer.atoms.length) {
      const cc = canonicalizeConformer(conformer.atoms, conformer.bonds);
      conformers.push({
        ok: true, has3D: !!conformer.has3D, atoms: cc.atoms, bonds: cc.bonds,
        source: conformer.has3D ? 'RDKit 3D' : 'RDKit 2D→伪3D',
        note: conformer.note || (conformer.has3D ? '本地力场近似 3D。' : '本地无法生成 3D，已用 2D 坐标平铺（非真实三维）。'),
        sourceType: conformer.has3D ? 'real3d' : 'pseudo3d'
      });
    }
    if (conformers.length) conformer = conformers[0];
    return { type, input: raw.trim(), role: finalRole, pubchem: pc, rdkit: rd, smiles, pred, geometry, toxicity, form, conformer, conformers };
  }

  // ⑨ 结果缓存写入：在 runSingle 成功渲染后调用
  function cacheLastResult() {
    if (!lastSingle || !lastSingle.smiles) return;
    const d = lastSingle;
    const cache = loadResultCache();
    const key = d.smiles;
    try {
      cache[key] = {
        t: Date.now(),
        desc: d.rdkit ? d.rdkit.desc : null,
        pka: d.rdkit ? d.rdkit.pka : null,
        svg: d.rdkit ? d.rdkit.svg : '',
        inchi: d.rdkit ? d.rdkit.inchi : '',
        inchikey: d.rdkit ? d.rdkit.inchikey : '',
        formula: d.rdkit ? d.rdkit.formula : '',
        groups: d.rdkit ? d.rdkit.groups : [],
        acidbase: d.rdkit ? d.rdkit.acidbase : null,
        pains: d.rdkit ? d.rdkit.pains : [],
        brenk: d.rdkit ? d.rdkit.brenk : [],
        toxicity: d.toxicity && d.toxicity.parsed ? {
          all: d.toxicity.all || [], byCat: d.toxicity.byCat || {},
          total: d.toxicity.total || 0, severe: d.toxicity.severe || 0, summary: d.toxicity.summary || '',
        } : null,
        form: d.form || null,
        geometry: d.geometry || null,
        role: d.role || 'unknown',
      };
      saveResultCache();
    } catch (e) {}
  }

  /* ---------- 渲染：结构 + 身份 ---------- */
  function renderIdentity(data) {
    const pc = data.pubchem, rd = data.rdkit;
    const name = (pc && (pc.iupac || pc.title)) ? (pc.iupac || pc.title) : data.input;
    const roleLabel = { intermediate: '中间体', api: '原料药', impurity: '杂质', reagent: '试剂', unknown: '未指定' }[data.role] || data.role;

    // 结构图：优先 RDKit SVG，回退 PubChem PNG
    if (rd.svg && rd.svg.indexOf('<svg') !== -1) {
      els.structureImg.innerHTML = rd.svg;
    } else if (pc && pc.imageUrl) {
      els.structureImg.innerHTML = `<img src="${pc.imageUrl}" alt="structure" style="max-width:100%"/>`;
    } else {
      els.structureImg.innerHTML = '<span style="color:#5b6776">无结构图</span>';
    }

    const rows = [];
    rows.push(['thName', escapeHtml(name)]);
    rows.push(['thRole', `<span class="badge badge-neutral">${roleLabel}</span>`]);
    // CAS 登记号：优先 PubChem 同义词中解析到的，缺失时若用户以 CAS 输入则直接使用输入
    const cas = (pc && pc.cas) || (data.type === 'cas' ? data.input : null);
    if (cas) rows.push(['thCAS', `<a href="https://commonchemistry.cas.org/detail?cas_rn=${encodeURIComponent(cas)}" target="_blank" rel="noopener">${escapeHtml(cas)}</a>`]);
    if (pc && pc.formula) rows.push(['thFormula', escapeHtml(pc.formula)]);
    rows.push(['thSmiles', escapeHtml(data.smiles)]);
    if (rd.inchi) rows.push(['thInChI', escapeHtml(rd.inchi)]);
    if (rd.inchikey) rows.push(['thInChIKey', escapeHtml(rd.inchikey)]);
    if (pc && pc.cid) rows.push(['thCID', `<a href="https://pubchem.ncbi.nlm.nih.gov/compound/${pc.cid}" target="_blank" rel="noopener">${pc.cid}</a>`]);
    const srcBadges = `<span class="badge badge-src-rd">RDKit 本地预测</span>` +
      (pc && pc.cid ? ` <span class="badge badge-src-pub">PubChem CID ${pc.cid}</span>` :
       pc ? ` <span class="badge badge-neutral">PubChem 未匹配 · 本地 SMILES 兜底</span>` :
       ` <span class="badge badge-neutral">PubChem 未匹配</span>`);
    rows.push(['thSource', srcBadges]);

    // 多库引用链接（本地词库或 PubChem 解析命中时）
    const refs = (pc && pc.refs) || {};
    const refLinks = [];
    if (pc && pc.cid) refLinks.push(`<a href="https://pubchem.ncbi.nlm.nih.gov/compound/${pc.cid}" target="_blank" rel="noopener">PubChem CID ${pc.cid}</a>`);
    if (refs.chembook && typeof refs.chembook === 'string') refLinks.push(`<a href="${refs.chembook}" target="_blank" rel="noopener">ChemicalBook</a>`);
    if (refs.chemsrc && typeof refs.chemsrc === 'string') refLinks.push(`<a href="${refs.chemsrc}" target="_blank" rel="noopener">化源网</a>`);
    if (refs.guidechem && typeof refs.guidechem === 'string') refLinks.push(`<a href="${refs.guidechem}" target="_blank" rel="noopener">盖德化工网</a>`);
    if (refs.commonchemistry && typeof refs.commonchemistry === 'string') refLinks.push(`<a href="${refs.commonchemistry}" target="_blank" rel="noopener">CAS Common Chemistry</a>`);
    if (refLinks.length) rows.push(['thMultiRef', refLinks.join(' · ')]);

    els.identityTable.innerHTML = rows.map(r => `<tr><td class="k" data-i18n="${r[0]}">${T(r[0])}</td><td class="v">${r[1]}</td></tr>`).join('');

    // 警示官能团
    const g = rd.groups || [];
    if (g.length) {
      els.reactiveNotes.innerHTML = g.map(x => {
        const sev = sevLabel(x.severity);
        return `<div class="reactive-item ${x.severity}"><b>${escapeHtml(x.name)}</b>（${sev}）：${escapeHtml(x.note)}</div>`;
      }).join('');
    } else {
      els.reactiveNotes.innerHTML = `<div class="reactive-item low" data-i18n="noReactive">未检出高活性 / 警示官能团。</div>`;
    }
  }

  /* ---------- 渲染：结果概览 hero ---------- */
  function renderHero(data) {
    const pc = data.pubchem, rd = data.rdkit;
    const name = (pc && (pc.iupac || pc.title)) ? (pc.iupac || pc.title) : data.input;
    const roleLabel = { intermediate: '中间体', api: '原料药', impurity: '杂质', reagent: '试剂', unknown: '未指定' }[data.role] || data.role;
    const formula = (pc && pc.formula) || rd.formula || '';
    const d = rd.desc;
    const mw = d.amw != null ? (+d.amw).toFixed(2) : '—';
    const logp = d.CrippenClogP != null ? (+d.CrippenClogP).toFixed(2) : '—';
    const tpsa = d.tpsa != null ? (+d.tpsa).toFixed(1) : '—';
    const sol = data.pred.solubility;
    const logs = (sol && sol.consensus) ? sol.consensus.logS.toFixed(2) : '—';
    const srcBadges = `<span class="badge badge-src-rd">RDKit 本地预测</span>` +
      (pc && pc.cid ? `<span class="badge badge-src-pub">PubChem CID ${pc.cid}</span>` :
       pc ? `<span class="badge badge-neutral">PubChem 未匹配 · 本地 SMILES 兜底</span>` :
       `<span class="badge badge-neutral">PubChem 未匹配</span>`);
    const stats = [
      { l: '分子量 MW', v: mw, u: 'g/mol', icon: 'weight', target: 'props-card' },
      { l: 'logP', v: logp, icon: 'droplet', target: 'props-card' },
      { l: 'logS', v: logs, u: 'mol/L', icon: 'glass', target: 'solubility-card' },
      { l: 'TPSA', v: tpsa, u: 'Å²', icon: 'sun', target: 'props-card' },
    ];
    let html = `<div class="hero-head">
      <div class="hero-title">
        <div class="hero-name">${escapeHtml(name)}</div>
        <div class="hero-formula">${formula ? escapeHtml(formula) : '结构式 / 分子式'}<span class="hero-role badge badge-neutral">${roleLabel}</span></div>
      </div>
      <div class="hero-sources">${srcBadges}</div>
    </div><div class="hero-stats">`;
    for (const s of stats) {
      html += `<div class="stat clickable" data-target="${s.target}" title="点击跳转到对应模块" role="button" tabindex="0"><div class="stat-head"><span class="stat-icon">${iconSvg(s.icon)}</span><span class="stat-label">${s.l}</span></div><div class="stat-value">${s.v}${s.u ? `<span class="stat-unit">${s.u}</span>` : ''}</div></div>`;
    }
    html += `</div>`;
    html += `<div class="hero-actions">
      <button class="btn btn-sm btn-secondary" id="favQuickBtn" type="button" data-i18n="favBtn">⭐ 收藏</button>
      <button class="btn btn-sm btn-ghost" id="shareUrlBtn" type="button" data-i18n="shareBtn">🔗 复制分享链接</button>
      <details class="hero-toolset">
        <summary class="btn btn-sm btn-ghost" data-i18n="toolsetSummary">🔧 一键工具 ▼</summary>
        <div class="hero-toolset-menu">
          <button class="hero-tool" data-tool="genotox" type="button" data-i18n="toolGenotox">⚡ 基因毒性限度</button>
          <button class="hero-tool" data-tool="logd" type="button" data-i18n="toolLogd">📈 logD–pH 曲线</button>
          <button class="hero-tool" data-tool="impSpec" type="button" data-i18n="toolImpSpec">📋 杂质谱追踪表</button>
          <button class="hero-tool" data-tool="nmr" type="button" data-i18n="toolNmr">🧬 NMR 估算</button>
          <button class="hero-tool" data-tool="compare" type="button" data-i18n="toolCompare">🔍 加入对比</button>
          <button class="hero-tool" data-tool="saltScreen" type="button" data-i18n="toolSaltScreen">🧂 盐型筛选</button>
          <button class="hero-tool" data-tool="sa" type="button" data-i18n="toolSa">🎯 合成可及性</button>
        </div>
      </details>
    </div>`;
    els.resultHero.innerHTML = html;
    const shareBtn = $('shareUrlBtn');
    if (shareBtn) shareBtn.addEventListener('click', () => {
      const s = data.smiles || '';
      const url = location.origin + location.pathname + '?s=' + encodeURIComponent(s);
      if (navigator.clipboard) { navigator.clipboard.writeText(url); setStatus('分享链接已复制（打开即自动预测该结构）。', 'ok'); }
      else { window.prompt('复制分享链接：', url); }
    });
    // 收藏按钮：结果区快捷收藏（v20250829g 修复：动态渲染后才绑定）
    const favQuickBtn = $('favQuickBtn');
    if (favQuickBtn) favQuickBtn.addEventListener('click', () => {
      if (window.__chemprop && window.__chemprop.favAddQuick) window.__chemprop.favAddQuick();
      else setStatus('收藏功能不可用（工具箱未加载）。', 'err');
    });
    // 一键工具：点击菜单项，联动当前化合物并滚动到对应工具
    const toolset = els.resultHero.querySelector('.hero-toolset');
    if (toolset) {
      toolset.querySelectorAll('.hero-tool').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const tool = btn.dataset.tool;
          if (tool) {
            runQuickTool(tool, data);
            // 点击后自动收起“一键工具”菜单，避免遮挡正文（v20250827f）
            toolset.open = false;
          }
        });
      });
    }
  }

  // 一键工具调度：从结果区快速联动到工具箱对应工具，并直达该工具结果区
  async function runQuickTool(tool, data) {
    const smiles = data && data.smiles;
    const rdkit = data && data.rdkit;
    const pc = data && data.pubchem;
    if (!smiles) { setStatus('请先完成一次预测。', 'warn'); return; }

    // 展开工具箱外壳
    const toolkit = $('researchTools');
    if (toolkit) {
      toolkit.classList.remove('hidden', 'collapsed-toolkit');
      const toggleBtn = $('researchToolsToggleBtn');
      if (toggleBtn) { toggleBtn.setAttribute('aria-expanded', 'true'); toggleBtn.textContent = '📂 收起 ▲'; }
    }

    // 关闭所有 details，再打开目标 tool-block
    document.querySelectorAll('.tool-block').forEach(d => { d.open = false; });
    const targetBlock = document.querySelector(`.tool-block[data-tool="${tool}"]`);
    if (targetBlock) {
      targetBlock.open = true;
      // 滚动到目标工具块顶部（留出固定页头空间）
      setTimeout(() => {
        const rect = targetBlock.getBoundingClientRect();
        const offset = 86; // 固定页头高度 + 少量留白
        const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
        window.scrollTo({ top: scrollTop + rect.top - offset, behavior: 'smooth' });
      }, 50);
    } else {
      // 兜底：旧版按标题关键词匹配
      const map = { genotox: '基因毒性', logd: 'logD', impSpec: '杂质谱', nmr: 'NMR', compare: '对比', saltScreen: '盐型', sa: '可及性' };
      const keyword = map[tool];
      if (keyword) {
        document.querySelectorAll('.tool-block').forEach(d => {
          if (d.querySelector('.tool-head') && d.querySelector('.tool-head').textContent.includes(keyword)) {
            d.open = true;
            setTimeout(() => { const r = d.getBoundingClientRect(); const st = window.pageYOffset || document.documentElement.scrollTop; window.scrollTo({ top: st + r.top - 86, behavior: 'smooth' }); }, 50);
          }
        });
      }
    }

    if (tool === 'genotox') {
      const mwt = rdkit && rdkit.desc && rdkit.desc.amw;
      if (mwt != null) $('genotoxMwt').value = (+mwt).toFixed(1);
      // 自动猜测杂质类别：有 genotoxic 警示→2 类，否则 3 类（保守低关注）
      const tox = data.toxicity;
      let cls = '3';
      if (tox && tox.parsed && (tox.byCat && tox.byCat.genotoxic && tox.byCat.genotoxic.length)) cls = '2';
      $('genotoxClass').value = cls;
      // 一键计算：补全默认值（剂量 100 mg/天、周期 chronic）
      const doseEl = $('genotoxDose'); if (doseEl && !doseEl.value) doseEl.value = '100';
      const periodEl = $('genotoxPeriod'); if (periodEl && !periodEl.value) periodEl.value = 'chronic';
      // 触发计算
      const btn = $('genotoxCalc'); if (btn) btn.click();
    } else if (tool === 'logd') {
      $('logdSmiles').value = smiles;
      const btn = $('logdCalc'); if (btn) btn.click();
    } else if (tool === 'impSpec') {
      const btn = $('impSpecCalc'); if (btn) btn.click();
    } else if (tool === 'nmr') {
      $('nmrSmiles').value = smiles;
      const btn = $('nmrCalc'); if (btn) btn.click();
    } else if (tool === 'compare') {
      // 把当前 SMILES 加入对比输入框
      const inp = $('compareInput');
      if (inp) {
        const cur = inp.value.trim();
        if (cur && !cur.split('\n').includes(smiles)) inp.value = cur + '\n' + smiles;
        else if (!cur) inp.value = smiles;
        const btn = $('compareRun'); if (btn) btn.click();
      }
    } else if (tool === 'saltScreen') {
      // 盐型筛选：自动带入当前化合物信息并生成评分
      const btn = $('saltScreenCalc'); if (btn) btn.click();
    } else if (tool === 'sa') {
      // 合成可及性：带入 SMILES 并评估
      $('saSmiles').value = smiles;
      const btn = $('saCalc'); if (btn) btn.click();
    }
    setStatus('已联动到「' + {genotox:'基因毒性限度',logd:'logD–pH 曲线',impSpec:'杂质谱追踪表',nmr:'NMR 估算',compare:'多化合物对比',saltScreen:'盐型筛选评分',sa:'合成可及性评分'}[tool] + '」工具。', 'ok');
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // 构造各化合物信息网站搜索链接（CAS/名称解析失败时供用户手动核对）
  function buildExternalLinks(query, type) {
    const q = encodeURIComponent(query);
    return {
      pubchem: `https://pubchem.ncbi.nlm.nih.gov/#query=${q}`,
      chembook: `https://www.chemicalbook.com/ProductSearchList.aspx?keyword=${q}`,
      chemsrc: `https://www.chemsrc.com/search?searchStr=${q}`,
      guidechem: `https://www.guidechem.com/search/?keyword=${q}`,
      commonchemistry: type === 'cas' ? `https://commonchemistry.cas.org/detail?cas_rn=${q}` : `https://commonchemistry.cas.org/search?searchText=${q}`,
    };
  }
  function renderNotFound(raw, type) {
    const links = buildExternalLinks(raw, type);
    const typeLabel = { smiles: 'SMILES', name: '化合物名称', cas: 'CAS 号', inchi: 'InChI', auto: '自动识别' }[type] || type;
    const tips = type === 'cas'
      ? T('nfTipCas')
      : T('nfTip').replace('{type}', typeLabel);
    els.notFoundPanel.innerHTML = `<div class="not-found-title" data-i18n="nfTitle">未能在 PubChem / Cactus 自动识别该化合物</div>
      <div class="not-found-body">
        <p>${tips}</p>
        <div class="ext-links">
          <a class="btn btn-ghost" href="${links.pubchem}" target="_blank" rel="noopener">PubChem</a>
          <a class="btn btn-ghost" href="${links.chembook}" target="_blank" rel="noopener">ChemicalBook（化百）</a>
          <a class="btn btn-ghost" href="${links.chemsrc}" target="_blank" rel="noopener">化源网</a>
          <a class="btn btn-ghost" href="${links.guidechem}" target="_blank" rel="noopener">盖德化工网</a>
          <a class="btn btn-ghost" href="${links.commonchemistry}" target="_blank" rel="noopener">CAS Common Chemistry</a>
        </div>
        <div class="row-note" style="margin-top:10px" data-i18n="nfNote">若数据库页面上有 SMILES / InChI / MOL 文件，可复制 SMILES 后直接预测；我们也欢迎把该化合物补充进本地词库。</div>
        ${(type === 'cas' || type === 'name' || type === 'auto') ? `<div class="row-note" style="margin-top:6px;color:var(--brand,#2563eb)" data-i18n="nfQueueNote">该标识已记入「🧠 知识库」的自进化失败队列；可在知识库中手动补充其 SMILES 以便下次离线命中。</div>` : ''}
      </div>`;
    els.notFoundPanel.classList.remove('hidden');
    updateIonizableCardVisibility(null);
    applyI18nDom();
  }
  function hideNotFound() { if (els.notFoundPanel) els.notFoundPanel.classList.add('hidden'); }

  /* ---------- 内联 SVG 图标集（指标卡 / Hero KPI 共用） ---------- */
  const ICONS = {
    weight: '<path d="M3 4h10M8 4v2M5 6l-2 6h4M11 6l-2 6h4"/>',
    target: '<circle cx="8" cy="8" r="6"/><circle cx="8" cy="8" r="2.4"/>',
    droplet: '<path d="M8 2.5S4 7 4 10a4 4 0 0 0 8 0C12 7 8 2.5 8 2.5Z"/>',
    prism: '<path d="M8 2 14 13H2Z"/><path d="M8 2v11"/>',
    sun: '<circle cx="8" cy="8" r="3"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.2 3.2l1.4 1.4M11.4 11.4l1.4 1.4M12.8 3.2l-1.4 1.4M4.6 11.4l-1.4 1.4"/>',
    donor: '<circle cx="5" cy="5" r="2"/><path d="M5 7v6M5 13h4"/>',
    acceptor: '<circle cx="5" cy="11" r="2"/><path d="M5 9V3M5 3h4"/>',
    area: '<rect x="3" y="3" width="10" height="10" rx="1.5" stroke-dasharray="2 1.5"/>',
    rot: '<path d="M4 6a4 4 0 1 1-1 3"/><path d="M3.2 4.5l1.4.8L3.6 7"/>',
    ring: '<circle cx="8" cy="8" r="5.5"/>',
    ring2: '<circle cx="8" cy="8" r="5.5"/><circle cx="8" cy="8" r="1.6" fill="currentColor" stroke="none"/>',
    rings: '<circle cx="6" cy="8" r="3.4"/><circle cx="10" cy="8" r="3.4"/>',
    atoms: '<circle cx="4" cy="4" r="1.7"/><circle cx="12" cy="4" r="1.7"/><circle cx="4" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/>',
    tetra: '<path d="M8 2 14 13H2Z"/><path d="M8 2 5 9M8 2 11 9M5 9h6M8 6.6 5 9M8 6.6 11 9"/>',
    chiral: '<path d="M8 3 13 12H3Z"/><path d="M8 3V12M8 7 11 12M8 7 5 12" stroke-dasharray="1.4 1.4"/>',
    bond: '<path d="M3 8h10"/><path d="M7 5v6"/>',
    atom: '<circle cx="8" cy="8" r="2.6"/><path d="M8 1.5v3M8 11.5v3M1.5 8h3M11.5 8h3" stroke-dasharray="1.5 1.5"/>',
    bars: '<path d="M3 13V8M8 13V4M13 13V10"/>',
    glass: '<path d="M5 3h6M6 3v8l-1.2 3h6.4L10 11V3"/><path d="M6.5 9h3"/>',
  };
  function iconSvg(name) {
    const inner = ICONS[name] || ICONS.atom;
    return `<svg class="ico" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
  }
  function scrollToModule(id) {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ---------- 渲染：性质卡片（分组展示） ---------- */
  const PROP_GROUPS = [
    { title: '分子量与元素', items: [
      { label: '分子量 MW', unit: 'g/mol', src: 'rd', ideal: [150, 500], icon: 'weight', get: d => d.amw != null ? +d.amw.toFixed(2) : null, tip: '投料摩尔数 / API 剂量计算的依据' },
      { label: '精确分子量', unit: 'g/mol', src: 'rd', icon: 'target', get: d => d.exactmw != null ? +d.exactmw.toFixed(4) : null, tip: '高分辨质谱（HRMS）的精确分子量' },
    ]},
    { title: '亲脂性 (Lipophilicity)', items: [
      { label: 'logP (Crippen)', src: 'rd', ideal: [0, 4], icon: 'droplet', get: d => d.CrippenClogP != null ? +d.CrippenClogP.toFixed(2) : null, tip: '脂水分配系数；Lipinski ≤5' },
      { label: 'XLogP (PubChem)', src: 'pub', ideal: [0, 4], icon: 'droplet', get: (d, pc) => (pc && pc.xlogp != null) ? +pc.xlogp.toFixed(2) : null, tip: 'PubChem 经验 logP；与 Crippen 互为印证' },
      { label: '摩尔折射率 MR', src: 'rd', icon: 'prism', get: d => d.CrippenMR != null ? +d.CrippenMR.toFixed(2) : null, tip: '与分子体积相关，用于 Lipinski 类药五规则' },
    ]},
    { title: '极性 / 氢键', items: [
      { label: 'TPSA', unit: 'Å²', src: 'rd', ideal: [20, 140], icon: 'sun', get: d => d.tpsa != null ? +d.tpsa.toFixed(1) : null, tip: '拓扑极性表面积；Veber ≤140Å² 影响吸收' },
      { label: 'HBD（氢键供体）', src: 'rd', ideal: [0, 5], icon: 'donor', get: d => d.NumHBD != null ? d.NumHBD : null, tip: '与受体的氢键结合；Lipinski ≤5' },
      { label: 'HBA（氢键受体）', src: 'rd', ideal: [0, 10], icon: 'acceptor', get: d => d.NumHBA != null ? d.NumHBA : null, tip: '与受体的氢键结合；Lipinski ≤10' },
      { label: 'Labute ASA', unit: 'Å²', src: 'rd', icon: 'area', get: d => d.labuteASA != null ? +d.labuteASA.toFixed(1) : null, tip: '分子范德华表面积（范德华 SASA）' },
    ]},
    { title: '空间与柔性', items: [
      { label: '可旋转键', src: 'rd', ideal: [0, 10], icon: 'rot', get: d => d.NumRotatableBonds != null ? d.NumRotatableBonds : null, tip: 'Veber ≤10；影响口服吸收' },
      { label: '芳香环数', src: 'rd', icon: 'ring', get: d => d.NumAromaticRings != null ? d.NumAromaticRings : null, tip: 'π-π 堆积 / 刚性 / 平面性' },
      { label: '杂环数', src: 'rd', icon: 'ring2', get: d => d.NumHeterocycles != null ? d.NumHeterocycles : null, tip: '含 N/O/S 的环；与溶解度 / 反应位点相关' },
      { label: '环数', src: 'rd', icon: 'rings', get: d => d.NumRings != null ? d.NumRings : null, tip: '结构复杂度指标' },
      { label: '重原子数', src: 'rd', icon: 'atoms', get: d => d.NumHeavyAtoms != null ? d.NumHeavyAtoms : null, tip: '非 H 原子数；分子体积估算' },
      { label: 'sp³ 碳比例', src: 'rd', icon: 'tetra', get: d => d.FractionCSP3 != null ? +d.FractionCSP3.toFixed(2) : null, tip: 'sp³ 碳占比；越高越三维（接近天然产物）' },
      { label: '立体中心数', src: 'rd', icon: 'chiral', get: d => d.NumAtomStereoCenters != null ? d.NumAtomStereoCenters : null, tip: '不对称合成成本 / 手性拆分难度' },
      { label: '酰胺键数', src: 'rd', icon: 'bond', get: d => d.NumAmideBonds != null ? d.NumAmideBonds : null, tip: '酰胺键计数（与代谢稳定性相关）' },
    ]},
    { title: '其他结构参数', items: [
      { label: '杂原子数', src: 'rd', icon: 'atom', get: d => d.NumHeteroatoms != null ? d.NumHeteroatoms : null, tip: 'N/O/F/Cl 等杂原子总数' },
      { label: '复杂度 (PubChem)', src: 'pub', icon: 'bars', get: (d, pc) => (pc && pc.complexity != null) ? +pc.complexity.toFixed(1) : null, tip: 'PubChem 复杂度指标（值越大结构越复杂）' },
    ]},
  ];

  // 根据理想区间给出 traffic-light 色调（仅对定义 ideal 的指标生效）
  function metricTone(p, val) {
    if (p.ideal == null) return '';
    const [lo, hi] = p.ideal;
    if (val >= lo && val <= hi) return 'good';
    const span = (hi - lo) || 1;
    if (val < lo) return (lo - val) <= span * 0.5 ? 'warn' : 'bad';
    return (val - hi) <= span * 0.5 ? 'warn' : 'bad';
  }

  function renderProps(data) {
    const d = data.rdkit.desc, pc = data.pubchem;
    let html = '';
    for (let gi = 0; gi < PROP_GROUPS.length; gi++) {
      const g = PROP_GROUPS[gi];
      const cards = g.items.map(p => {
        const val = p.get(d, pc);
        if (val == null) return '';
        const cls = p.src === 'pub' ? 'badge-src-pub' : 'badge-src-rd';
        const lbl = p.src === 'pub' ? 'PubChem' : 'RDKit';
        const tone = metricTone(p, Number(val));
        const unit = p.unit ? `<span class="m-unit">${p.unit}</span>` : '';
        return `<div class="metric${tone ? ' ' + tone : ''}">` +
          `<div class="m-head"><span class="m-icon">${iconSvg(p.icon)}</span><span class="m-label">${p.label}</span></div>` +
          `<div class="m-value">${val}${unit}</div>` +
          (p.tip ? `<div class="m-tip" title="${escapeHtml(p.tip)}">💡 ${escapeHtml(p.tip)}</div>` : '') +
          `<div class="m-src"><span class="badge ${cls}">${lbl}</span></div>` +
          `</div>`;
      }).join('');
      html += `<div class="prop-group"><div class="prop-group-title" data-i18n="pg${gi}">${T('pg' + gi)}</div><div class="metric-grid">${cards}</div></div>`;
    }
    html += renderPkaBlock(data);
    els.propGrid.innerHTML = html;
    applyI18nDom();
  }

  // pKa 专节：电离基团列表 + 由 pKa/logP 派生的 logD、净电荷、等电点
  function renderPkaBlock(data) {
    const pk = data.pred.pka;
    let html = '<div class="sub-title" style="margin-top:14px" data-i18n="subIonGroup">电离基团与 pKa（官能团经验估算）</div>';
    if (!pk.hasIonizable) {
      html += '<div class="row-note">未检出可电离基团（中性分子），logD ≈ logP，生理 pH 下净电荷 ≈ 0，无等电点。</div>';
      return html;
    }
    const rows = [].concat(pk.acids, pk.bases).map(g => {
      const isAcid = g.type === 'acid';
      const typeCell = isAcid
        ? '<td style="color:#c0392b">酸·去质子</td>'
        : '<td style="color:#2980b9">碱·质子化</td>';
      return `<tr><td class="p-name">${escapeHtml(g.name)}</td>${typeCell}<td class="p-val">${g.pka.toFixed(2)}${g.corrected ? ' *' : ''}</td><td>${g.count}</td></tr>`;
    }).join('');
    html += `<table class="data prop-table"><thead><tr><th data-i18n="thIonGroup">电离基团</th><th data-i18n="thType">类型</th><th data-i18n="thPka">pKa（估算）</th><th data-i18n="thCount">数量</th></tr></thead><tbody>${rows}</tbody></table>`;
    html += '<div class="row-note">* 经芳香环取代基电子效应校正。pKa 为<b>官能团结构经验估算</b>（RDKit SMARTS 识别 + 取代基校正，非实验值）；多电离基团时为近似，未计入相邻基团耦合效应。</div>';
    html += renderPkaBars(pk);
    html += '<div class="sub-title" style="margin-top:12px" data-i18n="subDerived">派生酸碱参数（由 pKa 与 logP 计算）</div>';
    const logD74 = pk.logD74 != null ? pk.logD74.toFixed(2) : '—';
    const charge74 = pk.charge74 != null ? pk.charge74.toFixed(3) : '—';
    const pI = pk.pI != null ? pk.pI.toFixed(2) : '—';
    html += `<table class="data prop-table"><tbody>` +
      `<tr><td class="p-name">logD (pH 7.4)</td><td class="p-val">${logD74}</td><td class="p-src"><span class="badge badge-src-rd">计算</span></td></tr>` +
      `<tr><td class="p-name">净电荷 @ pH 7.4</td><td class="p-val">${charge74}</td><td class="p-src"><span class="badge badge-src-rd">计算</span></td></tr>` +
      `<tr><td class="p-name">等电点 pI</td><td class="p-val">${pI}</td><td class="p-src"><span class="badge badge-src-rd">计算</span></td></tr>` +
      `</tbody></table>`;
    html += `<div class="row-note">logD = logP + log₁₀(中性分数)；净电荷与 pI 由 Henderson-Hasselbalch 方程对各电离基团独立叠加估算。实验 pKa 请以 SpectraBase / DrugBank / 文献为准（见身份识别按钮）。${pk.pINote ? ' ' + escapeHtml(pk.pINote) : ''}</div>`;
    return html;
  }

  // pKa 电离基团可视化条：在 pH 0–14 横轴上以标记点位置展示各基团 pKa（酸红 / 碱蓝）
  function renderPkaBars(pk) {
    const groups = [].concat(pk.acids || [], pk.bases || []).slice().sort((a, b) => a.pka - b.pka);
    if (!groups.length) return '';
    const rows = groups.map(g => {
      const pct = Math.max(0, Math.min(100, (g.pka / 14) * 100));
      const isAcid = g.type === 'acid';
      const cls = isAcid ? 'acid' : 'base';
      const pkaStr = g.pka.toFixed(2);
      return `<div class="pka-row">
        <div class="pka-label">
          <div class="pka-group">${escapeHtml(g.name)}</div>
          <div class="pka-meta">
            <span class="pka-count">×${g.count}</span>
            <span class="pka-tag ${cls}">${isAcid ? '酸' : '碱'}</span>
          </div>
        </div>
        <div class="pka-track">
          <div class="pka-grid"></div>
          <div class="pka-marker ${cls}" style="left:${pct}%" title="pKa ${pkaStr}"></div>
          <div class="pka-value" style="left:${pct}%">pKa ${pkaStr}</div>
        </div>
      </div>`;
    }).join('');
    return `<div class="pka-viz">
      <div class="pka-viz-title" data-i18n="pkaVizTitle">电离基团 pKa 可视化（横轴 pH 0–14，标记位置 = 基团 pKa）</div>
      ${rows}
      <div class="pka-axis"><span>0</span><span>3.5</span><span>7.0</span><span>10.5</span><span>14</span></div>
      <div class="pka-legend" data-i18n="pkaVizLegend"><span class="dot acid"></span>酸（pH &gt; pKa 去质子化）&nbsp;&nbsp;<span class="dot base"></span>碱（pH &lt; pKa 质子化）</div>
    </div>`;
  }

  /* ---------- 渲染：谱图可计算参数 ---------- */
  function renderSpectra(data) {
    const rd = data.rdkit;
    const iso = Predict.isotopePattern(rd.formula, rd.desc.exactmw);
    if (!iso) {
      els.spectraComputed.innerHTML = '<div class="row-note">分子式不可用，无法计算同位素分布与不饱和度（请确认结构解析成功）。</div>';
      return;
    }
    // 谱图参数也改用 HTML table，结构紧凑、跨页稳定
    const rows = [
      ['分子式', escapeHtml(iso.formula || '—')],
      ['精确质量 (单同位素)', iso.exactMass != null ? (+iso.exactMass).toFixed(4) + ' g/mol' : '—'],
      ['标称质量', iso.nominalMass != null ? iso.nominalMass + ' Da' : '—'],
      ['不饱和度 (DBE)', iso.dbe != null ? iso.dbe : '—'],
      ['预测分子离子 M⁺', 'm/z ' + iso.molecularIon],
    ].map(([k, v]) => `<tr><td class="s-label">${k}</td><td class="s-val">${v}</td></tr>`).join('');
    let html = '<div class="sub-title" data-i18n="subSpectraCalc">可计算谱图参数（RDKit 本地预测）</div>';
    html += `<table class="data spectra-table"><tbody>${rows}</tbody></table>`;
    if (iso.peaks && iso.peaks.length) {
      html += '<div class="sub-title" style="margin-top:12px" data-i18n="subEIMS">EI-MS 同位素峰型（天然丰度卷积估算，相对最强峰 %）</div>';
      html += '<table class="data"><thead><tr><th data-i18n="thPeak">峰</th><th data-i18n="thMz">m/z (标称)</th><th data-i18n="thRelInt">相对强度</th></tr></thead><tbody>';
      for (const p of iso.peaks) {
        const label = p.delta === 0 ? 'M' : 'M+' + p.delta;
        html += `<tr><td>${label}</td><td>${iso.nominalMass + p.delta}</td><td>${p.relInt}%</td></tr>`;
      }
      html += '</tbody></table>';
      html += '<div class="row-note">基于天然同位素丰度卷积估算；Cl/Br 等特征峰（M+2 显著增高）可辅助判断卤素与元素组成。实际质谱以实验测定为准。</div>';
    } else {
      html += '<div class="row-note">未生成有效同位素峰型。</div>';
    }
    els.spectraComputed.innerHTML = html;
  }

  /* ---------- 渲染：热力学与几何/键参数 ---------- */
  function fmtVal(obj) {
    if (!obj || obj.value == null) return '—';
    return obj.value + (obj.sd != null ? ' ± ' + obj.sd : '');
  }
  function renderThermo(data) {
    // —— 热力学（来自 pred.thermo，SolProp_ML 框架经验估算）——
    const th = data.pred.thermo;
    let html = '<div class="sub-title" data-i18n="subThermoSolv">溶剂化热力学（ΔG / ΔH / ΔS，由 logS 反推）</div>';
    if (!th) {
      els.thermoPanel.innerHTML = '<div class="row-note">热力学模型不可用（缺少溶解度描述符）。</div>';
    } else {
      const rows = [
        ['溶解度 logS (mol/L)', th.logS != null ? th.logS.toFixed(2) : '—'],
        ['摩尔溶解度 S (mol/L)', th.solM != null ? fmtSci(th.solM) : '—'],
        ['ΔG_solv (kcal/mol)', fmtVal(th.dG_solv) + ' <span class="m-unit">负值=易溶于水</span>'],
        ['ΔH_solv (kcal/mol)', fmtVal(th.dH_solv)],
        ['ΔS_solv (cal/mol·K)', fmtVal(th.dS_solv)],
      ].map(([k, v]) => `<tr><td class="s-label">${k}</td><td class="s-val">${v}</td></tr>`).join('');
      html += `<table class="data spectra-table"><tbody>${rows}</tbody></table>`;

      const ab = th.abraham || {};
      const abRows = [
        ['E（过量摩尔折射）', fmtVal(ab.E)],
        ['S（偶极/极性）', fmtVal(ab.S)],
        ['A（氢键酸性）', fmtVal(ab.A)],
        ['B（氢键碱性）', fmtVal(ab.B)],
        ['L（疏水项）', fmtVal(ab.L)],
        ['V（分子体积）', fmtVal(ab.V)],
      ].map(([k, v]) => `<tr><td class="s-label">${k}</td><td class="s-val">${v}</td></tr>`).join('');
      html += '<div class="sub-title" style="margin-top:12px" data-i18n="subAbraham">Abraham 溶剂化参数（经验映射）</div>';
      html += `<table class="data spectra-table"><tbody>${abRows}</tbody></table>`;

      html += '<div class="sub-title" style="margin-top:12px" data-i18n="subLogK">分配系数（logK）</div>';
      html += `<table class="data spectra-table"><tbody>` +
        `<tr><td class="s-label">logK（正辛醇–气）</td><td class="s-val">${fmtVal(th.logK)}</td></tr>` +
        `<tr><td class="s-label">logK_aq（水–气）</td><td class="s-val">${fmtVal(th.logK_aq)}</td></tr>` +
        `</tbody></table>`;
      html += `<div class="row-note">${escapeHtml(th.note)}</div>`;
    }
    els.thermoPanel.innerHTML = html;

    // —— 几何与键参数（来自 rdkit.computeGeometry）——
    const g = data.geometry;
    if (!g || !g.bonds || !g.bonds.length) {
      els.geometryPanel.innerHTML = '<div class="sub-title" style="margin-top:14px" data-i18n="subGeoBonds">键长 / 键能 / 键角</div><div class="row-note">几何参数不可用（结构解析失败）。</div>';
      return;
    }
    let ghtml = '<div class="sub-title" style="margin-top:14px" data-i18n="subBondLen">键长 / 键能（共价半径与平均 BDE 估算）</div>';
    ghtml += '<table class="data"><thead><tr><th data-i18n="thKey">键</th><th data-i18n="thBondType">类型</th><th data-i18n="thBondLen">估算键长 (Å)</th><th data-i18n="thBondEnergy">估算键能 (kJ/mol)</th></tr></thead><tbody>';
    for (const b of g.bonds) {
      const label = `${b.ei}${b.i + 1}–${b.ej}${b.j + 1}`;
      const en = b.en != null ? b.en : '—<span class="m-unit">（非典型键）</span>';
      ghtml += `<tr><td class="p-name">${label}</td><td>${b.orderText}</td><td>${b.len.toFixed(2)}</td><td>${en}</td></tr>`;
    }
    ghtml += '</tbody></table>';

    ghtml += '<div class="sub-title" style="margin-top:12px" data-i18n="subHybrid">原子杂化与理想几何（按配位数估计）</div>';
    ghtml += '<table class="data"><thead><tr><th data-i18n="thAtom">原子</th><th data-i18n="thElement">元素</th><th data-i18n="thCoord">配位数</th><th data-i18n="thHyb">杂化估计</th><th data-i18n="thIdealAngle">理想键角</th></tr></thead><tbody>';
    for (const a of g.atoms) {
      const n = g.bonds.filter(b => b.i === a.idx || b.j === a.idx).length;
      ghtml += `<tr><td>${a.idx + 1}</td><td>${escapeHtml(a.sym)}</td><td>${n}</td><td>${a.hyb}</td><td>${a.ideal != null ? a.ideal + '°' : '—'}</td></tr>`;
    }
    ghtml += '</tbody></table>';

    if (g.angles && g.angles.length) {
      ghtml += `<div class="sub-title" style="margin-top:12px" data-i18n="subBondAngle">键角（坐标计算，仅作参考）</div>`;
      ghtml += '<table class="data"><thead><tr><th data-i18n="thAngle">角</th><th data-i18n="thDeg">度数 (°)</th></tr></thead><tbody>';
      for (const ang of g.angles.slice(0, 40)) {
        ghtml += `<tr><td>${ang.a + 1}–${ang.center + 1}–${ang.d + 1}</td><td>${ang.deg.toFixed(1)}</td></tr>`;
      }
      ghtml += '</tbody></table>';
    }
    ghtml += `<div class="row-note">键长优先采用常见键的参考值（如 C–C 1.54 Å、C=O 1.23 Å），未收录键由共价半径推算；键能为常见键的平均键解离能（BDE）近似值，非本分子实际值。几何为 RDKit ${g.has3D ? '3D' : '2D'} 构型的经验估算，精确结构请以 X 射线单晶 / 计算化学为准。</div>`;
    els.geometryPanel.innerHTML = ghtml;
  }

  /* ---------- 渲染：毒性 / 基因毒性结构警示 ---------- */
  /* ---------- 渲染：盐型 / 互变异构提示 ---------- */
  function renderForm(data) {
    const f = data.form;
    if (!f || !f.ok) {
      els.formPanel.innerHTML = '<div class="row-note">盐型 / 互变异构提示不可用（结构解析失败）。</div>';
      return;
    }
    const saltCls = f.isSalt ? 'bad' : 'ok';
    let html = `<div class="form-banner ${saltCls}">
      <div class="form-banner-head">盐型 / 成盐识别：${f.isSalt ? '⚠️ 疑似盐型 / 成盐形式' : '✅ 单一中性组分'}</div>
      <div class="row-note" style="margin-top:4px">${f.note}</div>
    </div>`;
    if (f.counterions.length) {
      html += `<div class="sub-title" style="margin-top:10px"><span data-i18n="subCounterions">检出的抗衡离子 / 组分</span>（${f.counterions.length}）</div>`;
      html += '<div class="alert-list">' + f.counterions.map(c => `<span class="badge badge-warn">${escapeHtml(c.name)} ×${c.count}</span>`).join(' ') + '</div>';
    }
    if (f.components > 1) {
      html += `<div class="row-note" style="margin-top:4px">SMILES 含 ${f.components} 个组分（以「.」分隔），提示为多组分体系（盐 / 共晶 / 混合物）。</div>`;
    }
    html += `<div class="sub-title" style="margin-top:12px" data-i18n="subTautSites">互变异构敏感位点（提示）</div>`;
    if (!f.tautomers.length) {
      html += '<div class="row-note">未检出常见互变异构敏感基团。</div>';
    } else {
      html += '<div class="alert-list">' + f.tautomers.map(t => `<span class="badge badge-neutral" title="${escapeHtml(t.note)}">${escapeHtml(t.name)} ×${t.count}</span>`).join(' ') + '</div>';
      html += f.tautomers.map(t => `<div class="row-note" style="margin-top:2px"><b>${escapeHtml(t.name)}</b>：${escapeHtml(t.note)}</div>`).join('');
    }
    html += '<div class="row-note" style="margin-top:10px">说明：盐型识别基于 SMILES 多组分与无机抗衡离子 SMARTS；互变异构基于 ' + (f.tautomerCount || '') + ' 类敏感位点 SMARTS 做经验提示（非完整枚举）。互变异构影响 pKa、logP、溶解度与 H 键模式，建议以实验 / 数据库（PubChem、ChEMBL）确认主互变异构体。</div>';
    els.formPanel.innerHTML = html;
    renderSaltTautomerViz(f, data);
  }

  /* ---------- 盐型 / 互变异构可视化枚举（扩展 form panel） ---------- */
  // 常见盐型抗衡离子信息卡（不再依赖 RDKit 渲染图片，用分子式 / SMILES / 近似 MW / 建议等结构化文本稳定展示）
  const SALT_FORMS = [
    { name: '盐酸盐', ion: '[Cl-]', formula: 'Cl⁻', charge: '-1', mw: 35.45, note: '最常用成盐形式，溶解度好，晶型数据丰富。' },
    { name: '氢溴酸盐', ion: '[Br-]', formula: 'Br⁻', charge: '-1', mw: 79.90, note: '用于盐酸盐不稳定或晶型不佳时。' },
    { name: '碘酸盐', ion: '[I-]', formula: 'I⁻', charge: '-1', mw: 126.90, note: '较少用，多用于改善亲脂性 or 提高结晶度。' },
    { name: '钠盐', ion: '[Na+]', formula: 'Na⁺', charge: '+1', mw: 22.99, note: '酸性 API 常用；水溶性通常较好。' },
    { name: '钾盐', ion: '[K+]', formula: 'K⁺', charge: '+1', mw: 39.10, note: '钠盐吸湿或晶型不佳时的替代。' },
    { name: '钙盐', ion: '[Ca+2]', formula: 'Ca²⁺', charge: '+2', mw: 40.08, note: '双电荷，2:1 计量常见；可改善口感与稳定性。' },
    { name: '镁盐', ion: '[Mg+2]', formula: 'Mg²⁺', charge: '+2', mw: 24.31, note: '双电荷；生物利用度与钙盐有所差异。' },
    { name: '硫酸盐', ion: 'O=S(=O)([O-])[O-]', formula: 'SO₄²⁻', charge: '-2', mw: 96.06, note: '双电荷阴离子，碱性 API 常用；溶解度适中。' },
    { name: '磷酸盐', ion: 'O=P([O-])([O-])[O-]', formula: 'PO₄³⁻', charge: '-3', mw: 94.97, note: '生理相容性好，注射剂常用。' },
    { name: '乙酸盐', ion: 'CC(=O)[O-]', formula: 'CH₃COO⁻', charge: '-1', mw: 59.04, note: '有机弱酸根，常用于改善油溶性与结晶。' },
    { name: '琥珀酸盐', ion: 'O=C(O)CCC(=O)[O-]', formula: 'C₄H₅O₄⁻', charge: '-1', mw: 116.07, note: '酸性 counterion，常用于提高熔点与稳定性。' },
    { name: '马来酸盐', ion: 'O=C(O)/C=C/C(=O)[O-]', formula: 'C₄H₃O₄⁻', charge: '-1', mw: 114.06, note: '顺丁烯二酸盐，晶型筛选常用。' },
    { name: '富马酸盐', ion: 'O=C(O)/C=C\C(=O)[O-]', formula: 'C₄H₃O₄⁻', charge: '-1', mw: 114.06, note: '反丁烯二酸盐，常比马来酸盐更稳定。' },
    { name: '甲磺酸盐', ion: 'CS(=O)(=O)[O-]', formula: 'CH₃SO₃⁻', charge: '-1', mw: 95.10, note: '强酸根，成盐率高，常用于碱性胺。' },
    { name: '对甲苯磺酸盐', ion: 'Cc1ccc(S(=O)(=O)[O-])cc1', formula: 'C₇H₇SO₃⁻', charge: '-1', mw: 171.20, note: '疏水性较强，可改善结晶与溶出。' },
    { name: '枸橼酸盐', ion: 'O=C(O)CC(O)(CC(=O)[O-])C(=O)[O-]', formula: 'C₆H₇O₇²⁻*', charge: '-2/-3', mw: 189.10, note: '三元酸，常形成 1:1 或 2:1 盐；口感较好。' },
    { name: '酒石酸盐', ion: 'O=C(O)[C@H](O)[C@@H](O)C(=O)[O-]', formula: 'C₄H₅O₆⁻', charge: '-1/-2', mw: 148.07, note: '手性 counterion，可用于拆分对映体。' },
    { name: '三氟乙酸盐', ion: 'C(F)(F)(F)C(=O)[O-]', formula: 'CF₃COO⁻', charge: '-1', mw: 113.00, note: '常用于液相制备与临时盐型，制剂中慎用。' },
  ];
  // 互变异构「通用示意」配对（key 对应 TAUT_SITES.key；渲染为代表性示例，非该分子真实互变异构体）
  const TAUT_EXAMPLES = {
    amide: { a: 'CC(=O)NC', b: 'CC(O)=NC', label: '酰胺 ⇌ 亚胺酸' },
    enol: { a: 'CC(=O)C', b: 'C=C(O)C', label: '酮 ⇌ 烯醇' },
    imine: { a: 'CC=NCC', b: 'C=C(NC)C', label: '亚胺 ⇌ 烯胺' },
    hetNH: { a: 'c1c[nH]cn1', b: 'c1[nH]cnc1', label: '1H ⇌ 3H（咪唑/吡唑类）' },
    lactam: { a: 'O=C1NCC1', b: 'O=C1NC=C1', label: '内酰胺 ⇌ 内酰亚胺' },
    nitro: { a: 'CC[N+](=O)[O-]', b: 'CC(=N[O-])O', label: '硝基 ⇌ 酸式(aci)' },
    pyridone: { a: 'O=c1cc[nH]cc1', b: 'Oc1cc[nH]cc1', label: '2-吡啶酮 ⇌ 2-羟基吡啶' },
    barbituric: { a: 'O=C1NC(=O)NC(=O)1', b: 'O=C1NC(O)=CNC1=O', label: '巴比妥酸互变异构' },
    guanidine: { a: 'NC(N)=N', b: 'N=C(N)N', label: '胍/脒质子共振' },
    thioamide: { a: 'CC(=S)NC', b: 'CC(O)=NC', label: '硫酰胺(硫酮) ⇌ 硫醇' },
    oxime: { a: 'CC=NOC', b: 'CC(O)=NOC', label: '醛肟互变异构' },
    enamine2: { a: 'C=CNC', b: 'CC=NCC', label: '烯胺 ⇌ 亚胺' },
    lactol: { a: 'O1CC(O)O1', b: 'O=CCO', label: '半缩醛 ⇌ 开链羰基' },
    thiourea: { a: 'NC(=S)N', b: 'N=C(S)N', label: '硫脲(硫酮) ⇌ 硫醇' },
    phosphoramide: { a: 'O=P(N)(N)N', b: 'O=P(N)(N)N', label: '磷酰胺 NH 共振' },
  };
  function smilesToSVG(smiles, w, h) {
    if (!smiles) return '';
    const key = smiles + '|' + (w || '') + '|' + (h || '');
    if (_svgCache.has(key)) return _svgCache.get(key);
    try {
      if (!window.RDKitEngine || typeof window.RDKitEngine.highlightStructure !== 'function') return '';
      // 重试一次：RDKit wasm 在连续大量调用下偶发瞬时失败，重试可恢复，避免盐型图误判“渲染失败”
      let svg = '';
      for (let attempt = 0; attempt < 2 && (!svg || svg.indexOf('<svg') === -1); attempt++) {
        svg = window.RDKitEngine.highlightStructure(smiles) || '';
      }
      if (!svg || svg.indexOf('<svg') === -1) return ''; // 失败不入缓存，避免污染后续所有查询
      // 限定尺寸，避免内部画布过大（RDKit 输出为单引号 + px 后缀，需兼容）
      if (w) svg = svg.replace(/width=['"]\d+(\.\d+)?(px)?['"]/, 'width="' + w + '"').replace(/height=['"]\d+(\.\d+)?(px)?['"]/, 'height="' + (h || w) + '"');
      _svgCache.set(key, svg);
      return svg;
    } catch (e) { return ''; }
  }
  // SMILES→SVG 缓存：避免 18+ 盐型 / 互变异构图反复解析同一 SMILES 导致 wasm 偶发失败
  const _svgCache = new Map();
  // 抗衡离子分子量缓存（常量，整个会话只算一次，避免每次查询都调 RDKit compute 18 次）
  const _ionMwCache = new Map();
  // 渲染代际令牌：重复查询时旧的异步批次若仍在飞行，凭此令牌丢弃，避免写入已失效的 DOM
  let _saltVizGen = 0;
  // 查询代际令牌：每次发起新查询 +1；旧查询据此在渲染前/计算中自我取消（latest-wins），杜绝并发查询互相同步覆盖 DOM、污染缓存
  let _runSeq = 0;
  function renderSaltTautomerViz(f, data) {
    if (!els.formPanel) return;
    const smiles = data.smiles || '';
    const parentMW = (data.rdkit && data.rdkit.desc && data.rdkit.desc.amw != null) ? +data.rdkit.desc.amw : null;
    let html = '';
    // —— 常见盐型信息卡（纯文本，不依赖 RDKit 渲染图片，从根本上避免无机离子 SVG 失败）——
    const saltCards = SALT_FORMS.map((sf, i) => {
      const approx = (parentMW != null && sf.mw != null) ? (parentMW + sf.mw).toFixed(1) : '—';
      const delta = (parentMW != null && sf.mw != null) ? '+' + sf.mw.toFixed(1) : '—';
      const smiBlock = escapeHtml(sf.ion);
      return `<div class="salt-cell salt-info-cell" data-index="${i}" title="${escapeHtml(sf.name)}">
        <div class="salt-info-head">
          <span class="salt-info-num">${i + 1}</span>
          <span class="salt-name">${escapeHtml(sf.name)}</span>
        </div>
        <div class="salt-formula" title="抗衡离子分子式">${escapeHtml(sf.formula)}</div>
        <div class="salt-ion" title="抗衡离子 SMILES">${smiBlock}</div>
        <div class="salt-charge">电荷：${escapeHtml(sf.charge)}</div>
        <div class="salt-mw-line">盐 MW ≈ <b>${approx}</b> <span class="salt-delta">Δ${delta}</span></div>
        <div class="salt-note">${escapeHtml(sf.note)}</div>
      </div>`;
    }).join('');
    html += `<div class="sub-title" style="margin-top:14px" data-i18n="subSaltViz">常见盐型信息卡（示意）</div>`;
    html += '<div class="row-note">以下为「当前结构 + 常见抗衡离子」的 1:1 盐型近似信息（分子式、SMILES、电荷、近似分子量、成盐建议）。<b>分子量为游离 API + 抗衡离子估算值（未计化学计量与质子化），非实测晶型/溶解度</b>。</div>';
    html += '<div class="salt-grid salt-info-grid" id="saltVizGrid">' + saltCards + '</div>';
    // —— 互变异构可视化（通用示意，仍尝试 SVG；失败时降级为文本描述）——
    const tautKeys = (f.tautomers || []).map(t => t.key);
    const examples = tautKeys.map(k => TAUT_EXAMPLES[k]).filter(Boolean);
    if (examples.length) {
      html += `<div class="sub-title" style="margin-top:14px" data-i18n="subTautViz">互变异构可视化（通用示意）</div>`;
      html += '<div class="row-note">下图为各检出位点对应的<b>代表性</b>互变异构对（通用小分子示例，非该分子真实互变异构体）。若结构渲染失败，将显示文本互变描述。</div>';
      html += '<div class="taut-grid">' + examples.map(ex => {
        const sa = smilesToSVG(ex.a, 130, 100), sb = smilesToSVG(ex.b, 130, 100);
        const hasImg = !!(sa && sb);
        return `<div class="taut-cell">
          <div class="taut-pair">${hasImg ? `<div class="taut-img">${sa}</div><div class="taut-arrow">⇌</div><div class="taut-img">${sb}</div>` : `<div class="taut-text-fallback">${escapeHtml(ex.label)}</div>`}</div>
          <div class="taut-label">${escapeHtml(ex.label)}</div>
        </div>`;
      }).join('') + '</div>';
    }
    // 保留 banner、仅追加可视化区块；移除上一次残留，杜绝重复/错位。
    const wrap = document.createElement('div');
    wrap.id = 'saltVizWrap';
    wrap.innerHTML = html;
    const old = document.getElementById('saltVizWrap');
    if (old && old !== wrap) old.remove();
    els.formPanel.appendChild(wrap);
  }

  /* ---------- 3D 构象交互查看器（自包含 Canvas 渲染，无外部依赖） ---------- */
  // conformersIn: 数组，每项 { atoms:[{idx,x,y,z,sym}], bonds:[{i,j,order}], source }
  function mountConformerViewer(canvas, conformersIn) {
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    const BG = '#ffffff';
    const CPK = {
      H: '#ffffff', C: '#4a4a4a', N: '#2b6cff', O: '#e23636', F: '#4fd14f', Cl: '#1a9d1a',
      Br: '#9c2a2a', I: '#7a1f7a', S: '#d8c400', P: '#d97b1f', Na: '#ab5cf2', K: '#8f40d4',
      Ca: '#3b9c3b', Mg: '#3b9c3b', Zn: '#7a7a7a', Li: '#c033c0', default: '#ff66cc',
    };
    const ATOM_R = { H: 5.5, C: 8.5, N: 9, O: 9, F: 7, Cl: 10.5, Br: 11.5, I: 12.5, S: 10, P: 10, default: 9 };
    const state = { yaw: 0.7, pitch: 0.35, zoom: 1, showH: true, drag: false, lx: 0, ly: 0, confIdx: 0, overlay: false, measureMode: false, _screen: [], _curAtoms: [], _picks: [], _downX: 0, _downY: 0 };
    function fitZoom() {
      let ext = 1;
      conformersIn.forEach(c => c.atoms.forEach(a => { ext = Math.max(ext, Math.abs(a.x), Math.abs(a.y), Math.abs(a.z)); }));
      return (Math.min(W, H) * 0.40) / ext;
    }
    state.zoom = fitZoom();
    state.fitZoom = fitZoom;

    function rotate(p) {
      let x = p.x, y = p.y, z = p.z;
      const cY = Math.cos(state.yaw), sY = Math.sin(state.yaw);
      const x1 = x * cY - z * sY, z1 = x * sY + z * cY;
      const cX = Math.cos(state.pitch), sX = Math.sin(state.pitch);
      const y1 = y * cX - z1 * sX, z2 = y * sX + z1 * cX;
      return { x: x1, y: y1, z: z2 };
    }

    function projectConformer(conf) {
      const vis = [];
      conf.atoms.forEach((a, i) => { if (state.showH || a.sym !== 'H') vis.push({ i, a }); });
      const n = vis.length || 1;
      let cx = 0, cy = 0, cz = 0;
      vis.forEach(v => { cx += v.a.x; cy += v.a.y; cz += v.a.z; });
      cx /= n; cy /= n; cz /= n;
      const proj = vis.map(v => {
        const r = rotate({ x: v.a.x - cx, y: v.a.y - cy, z: v.a.z - cz });
        return { i: v.i, sym: v.a.sym, rx: r.x, ry: r.y, rz: r.z };
      });
      const pm = {}; proj.forEach(p => pm[p.i] = p);
      proj.forEach(p => { p.sx = W / 2 + p.rx * state.zoom; p.sy = H / 2 - p.ry * state.zoom; });
      return { proj, pm };
    }

    function drawConformer(conf, alphaMul) {
      const { proj, pm } = projectConformer(conf);
      if (!proj.length) return;
      let zmin = Infinity, zmax = -Infinity;
      proj.forEach(p => { zmin = Math.min(zmin, p.rz); zmax = Math.max(zmax, p.rz); });
      const zspan = (zmax - zmin) || 1;
      const bs = [];
      conf.bonds.forEach(b => {
        const ia = pm[b.i], jb = pm[b.j];
        if (!ia || !jb) return;
        bs.push({ ia, jb, order: b.order, z: (ia.rz + jb.rz) / 2 });
      });
      bs.sort((a, b) => a.z - b.z);
      ctx.lineCap = 'round';
      bs.forEach(bd => {
        const far = (bd.z - zmin) / zspan;
        const alpha = (1 - far * 0.45) * alphaMul;
        const shade = Math.round(120 - far * 60);
        ctx.strokeStyle = 'rgba(' + shade + ',' + shade + ',' + shade + ',' + alpha.toFixed(2) + ')';
        const dx = bd.jb.sx - bd.ia.sx, dy = bd.jb.sy - bd.ia.sy;
        const len = Math.hypot(dx, dy) || 1;
        const nx = -dy / len, ny = dx / len;
        const off = 2.2 * (state.zoom / 30 + 0.4);
        const lines = (bd.order === 1 || bd.order === 1.5) ? 1 : bd.order;
        if (lines === 1) {
          ctx.lineWidth = Math.max(1.2, 2.2 * (state.zoom / 60 + 0.5));
          ctx.beginPath(); ctx.moveTo(bd.ia.sx, bd.ia.sy); ctx.lineTo(bd.jb.sx, bd.jb.sy); ctx.stroke();
        } else {
          for (let k = 0; k < lines; k++) {
            const t = (k - (lines - 1) / 2);
            const ox = nx * off * t, oy = ny * off * t;
            ctx.lineWidth = Math.max(1, 1.8 * (state.zoom / 60 + 0.5));
            ctx.beginPath(); ctx.moveTo(bd.ia.sx + ox, bd.ia.sy + oy); ctx.lineTo(bd.jb.sx + ox, bd.jb.sy + oy); ctx.stroke();
          }
        }
      });
      const ap = proj.slice().sort((a, b) => a.rz - b.rz);
      ap.forEach(p => {
        const far = (p.rz - zmin) / zspan;
        const alpha = (1 - far * 0.35) * alphaMul;
        const base = CPK[p.sym] || CPK.default;
        const rad = (ATOM_R[p.sym] || ATOM_R.default) * (state.zoom / 60 + 0.6);
        ctx.globalAlpha = alpha;
        ctx.beginPath(); ctx.arc(p.sx, p.sy, rad, 0, Math.PI * 2);
        ctx.fillStyle = base; ctx.fill();
        ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(40,50,60,0.55)'; ctx.stroke();
        ctx.globalAlpha = 1;
        if (p.sym !== 'H' && rad > 8.5) {
          ctx.font = Math.max(9, rad * 0.9).toFixed(0) + 'px sans-serif';
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.lineWidth = 2.5; ctx.strokeStyle = 'rgba(255,255,255,0.92)';
          ctx.strokeText(p.sym, p.sx, p.sy);
          ctx.fillStyle = '#16202e'; ctx.fillText(p.sym, p.sx, p.sy);
        }
      });
    }

    function draw() {
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = BG; ctx.fillRect(0, 0, W, H);
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      if (!conformersIn.length) { ctx.fillStyle = '#5b6776'; ctx.font = '13px sans-serif'; ctx.fillText('无可见原子', 12, 24); return; }
      if (state.overlay) {
        conformersIn.forEach((c, idx) => { if (idx !== state.confIdx) drawConformer(c, 0.26); });
        drawConformer(conformersIn[state.confIdx], 1);
      } else {
        drawConformer(conformersIn[state.confIdx], 1);
      }
      // 记录当前显示构象的可见原子屏幕坐标（用于测量）
      state._screen = [];
      const primary = conformersIn[state.confIdx];
      if (primary) {
        state._curAtoms = primary.atoms;
        const { proj } = projectConformer(primary);
        state._screen = proj.map(p => ({ i: p.i, sx: p.sx, sy: p.sy, sym: p.sym }));
      }
      // 测量模式下绘制已选原子标记
      if (state.measureMode && state._picks.length) {
        state._picks.forEach(pk => {
          const sp = state._screen.find(s => s.i === pk);
          if (!sp) return;
          ctx.beginPath(); ctx.arc(sp.sx, sp.sy, 7, 0, Math.PI * 2);
          ctx.lineWidth = 2; ctx.strokeStyle = '#e23636'; ctx.stroke();
        });
      }
    }

    canvas.addEventListener('pointerdown', e => { state.drag = true; state._downX = e.clientX; state._downY = e.clientY; state.lx = e.clientX; state.ly = e.clientY; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener('pointermove', e => {
      if (!state.drag) return;
      state.yaw += (e.clientX - state.lx) * 0.01;
      state.pitch = Math.max(-1.5, Math.min(1.5, state.pitch + (e.clientY - state.ly) * 0.01));
      state.lx = e.clientX; state.ly = e.clientY; draw();
    });
    canvas.addEventListener('pointerup', () => { state.drag = false; });
    canvas.addEventListener('pointercancel', () => { state.drag = false; });
    canvas.addEventListener('click', e => {
      if (Math.abs(e.clientX - state._downX) > 5 || Math.abs(e.clientY - state._downY) > 5) return; // 拖拽不触发测量
      if (!state.measureMode) return;
      const rect = canvas.getBoundingClientRect();
      const mx = (e.clientX - rect.left) * (W / rect.width), my = (e.clientY - rect.top) * (H / rect.height);
      let best = -1, bd = 1e9;
      state._screen.forEach(s => { const d = Math.hypot(s.sx - mx, s.sy - my); if (d < bd) { bd = d; best = s.i; } });
      if (best < 0 || bd > 22) return;
      if (state._picks.length >= 2) state._picks = [];
      state._picks.push(best);
      draw();
      const mEl = document.getElementById('confMeasure');
      if (mEl) {
        if (state._picks.length < 2) {
          mEl.textContent = '已选原子 #' + best + ' (' + (state._curAtoms[best] ? state._curAtoms[best].sym : '') + ')，再点选第二个原子…';
        } else {
          const a = state._curAtoms[state._picks[0]], b = state._curAtoms[state._picks[1]];
          if (a && b) {
            const d = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
            mEl.textContent = '键长 #' + state._picks[0] + '(' + a.sym + ')–#' + state._picks[1] + '(' + b.sym + ') ≈ ' + d.toFixed(2) + ' Å（基于当前构象坐标）';
          }
        }
      }
    });
    canvas.addEventListener('wheel', e => { e.preventDefault(); state.zoom = Math.max(8, Math.min(400, state.zoom * (e.deltaY > 0 ? 0.9 : 1.1))); draw(); }, { passive: false });
    draw();
    state.redraw = draw;
    state.nextConf = () => { if (conformersIn.length > 1) { state.confIdx = (state.confIdx + 1) % conformersIn.length; draw(); } };
    state.toggleOverlay = () => { state.overlay = !state.overlay; draw(); };
    state.exportPNG = () => canvas.toDataURL('image/png');
    state.confCount = conformersIn.length;
    return state;
  }

  function renderConformer(data) {
    const confs = (data.conformers && data.conformers.length) ? data.conformers
      : (data.conformer ? [data.conformer] : []);
    if (!confs.length || !confs[0].atoms || !confs[0].atoms.length) {
      els.conformerPanel.innerHTML = '<div class="row-note">无可用构象数据。</div>';
      return;
    }
    const multi = confs.length > 1;
    const anyReal3D = confs.some(c => c.has3D && c.sourceType === 'real3d');
    const anyPseudo3D = confs.some(c => !c.has3D || c.sourceType === 'pseudo3d');
    const W = 440, H = 320;
    const sources = confs.map(c => c.source).join(' / ');
    let controls = `
      <button class="btn btn-sm btn-ghost" id="confReset" data-i18n="confReset">↺ 复位视角</button>
      <button class="btn btn-sm btn-ghost" id="confToggleH" data-i18n="confToggleH">隐藏 H</button>
      <button class="btn btn-sm btn-ghost" id="confMeasure" data-i18n="confMeasure">📏 测量键长</button>
      <button class="btn btn-sm btn-ghost" id="confPNG" data-i18n="confPng">⬇ 导出PNG</button>`;
    if (multi) {
      controls += `
      <button class="btn btn-sm btn-ghost" id="confNext" data-i18n="confNext">下一构象 ▶</button>
      <button class="btn btn-sm btn-ghost" id="confOverlay" data-i18n="confOverlay">叠加显示</button>
      <span class="conf-label" id="confLabel"></span>`;
    }
    const statusText = anyReal3D
      ? ('✅ 真实 3D 坐标' + (anyPseudo3D ? ' · 含伪 3D 投影' : '') + '（来源：' + escapeHtml(sources) + '）')
      : ('⚠️ 伪 3D 投影（非真实力场构象；来源：' + escapeHtml(sources) + '）');
    els.conformerPanel.innerHTML = `
      <div class="conf-viewer">
        <canvas id="confCanvas" width="${W}" height="${H}" class="conf-canvas"></canvas>
        <div class="conf-controls">${controls}</div>
        <div id="confMeasure" class="conf-measure" data-i18n="confMeasureHint">点击「测量键长」后，依次点选两个原子即可读取其间距（基于当前构象坐标，单位为 Å）。</div>
        <div class="conf-note">${statusText}：不同来源/算法的 3D 构象均为低能近似，真实分子存在多种构象异构体。</div>
        <div class="row-note conf-note" data-i18n="confNote">拖拽旋转 · 滚轮缩放；CPK 元素配色，白色小球为氢原子。${multi ? '可用「下一构象」切换、或「叠加显示」对比多个来源的 3D 构象。' : ''}</div>
      </div>`;
    const canvas = $('confCanvas');
    const state = mountConformerViewer(canvas, confs);
    const resetBtn = $('confReset');
    if (resetBtn) resetBtn.addEventListener('click', () => {
      state.yaw = 0.7; state.pitch = 0.35; state.zoom = state.fitZoom();
      if (state.redraw) state.redraw();
    });
    const toggleBtn = $('confToggleH');
    if (toggleBtn) toggleBtn.addEventListener('click', () => {
      state.showH = !state.showH;
      toggleBtn.textContent = state.showH ? T('confToggleH') : T('confShowH');
      if (state.redraw) state.redraw();
    });
    const measureBtn = $('confMeasure');
    if (measureBtn) measureBtn.addEventListener('click', () => {
      state.measureMode = !state.measureMode;
      state._picks = [];
      measureBtn.classList.toggle('active', state.measureMode);
      const mEl = document.getElementById('confMeasure');
      if (mEl) mEl.textContent = state.measureMode ? T('confMeasureMode') : T('confMeasureHint');
      if (state.redraw) state.redraw();
    });
    const pngBtn = $('confPNG');
    if (pngBtn) pngBtn.addEventListener('click', () => {
      const url = state.exportPNG ? state.exportPNG() : canvas.toDataURL('image/png');
      const a = document.createElement('a'); a.href = url; a.download = 'conformer_' + Date.now() + '.png';
      document.body.appendChild(a); a.click(); setTimeout(() => document.body.removeChild(a), 300);
      setStatus('已导出 3D 构象 PNG。', 'ok');
    });
    if (multi) {
      const label = $('confLabel');
      const updateLabel = () => {
        if (!label) return;
        const c = confs[state.confIdx];
        const tag = (c.has3D && c.sourceType === 'real3d') ? '真实3D' : '伪3D';
        label.textContent = '构象 ' + (state.confIdx + 1) + '/' + confs.length + ' · ' + c.source + ' · ' + tag + (state.overlay ? ' · 叠加' : '');
      };
      const nextBtn = $('confNext');
      if (nextBtn) nextBtn.addEventListener('click', () => { if (state.nextConf) state.nextConf(); updateLabel(); });
      const ovBtn = $('confOverlay');
      if (ovBtn) ovBtn.addEventListener('click', () => {
        if (state.toggleOverlay) state.toggleOverlay();
        ovBtn.classList.toggle('active', state.overlay);
        updateLabel();
      });
      updateLabel();
    }
  }

  /* ---------- 渲染：毒性 / 基因毒性结构警示（含点击高亮） ---------- */
  // 警示等级 → 高亮 / 徽标配色（RGB 0~1，供 RDKit get_svg_with_highlights 使用）
  const ALERT_COLORS = {
    high: [1.0, 0.20, 0.20],    // 红：高风险（基因毒性/烷化剂/酰卤等）
    medium: [1.0, 0.62, 0.0],   // 橙：中风险
    low: [0.17, 0.45, 0.85],    // 蓝：低风险（hERG/CYP 粗筛等）
  };
  function attachToxHandlers() {
    if (toxHandlerAttached) return;
    toxHandlerAttached = true;
    els.toxPanel.addEventListener('click', (ev) => {
      const item = ev.target.closest('.alert-item');
      if (!item) return;
      const idx = parseInt(item.getAttribute('data-alert-idx'), 10);
      const al = currentToxAlerts[idx];
      if (!al) return;
      const ts = $('toxStructure');
      try {
        const color = ALERT_COLORS[al.severity] || ALERT_COLORS.high;
        const svg = RDKitEngine.highlightStructure(currentSmiles, al.atoms || [], al.bonds || [], color);
        if (ts) ts.innerHTML = svg;
        const an = $('toxActiveName'); if (an) an.textContent = al.name + '（' + sevLabel(al.severity) + '）';
        document.querySelectorAll('.alert-item.active').forEach(e => e.classList.remove('active'));
        item.classList.add('active');
      } catch (e) {
        if (ts) ts.innerHTML = '<span style="color:#dc2626">高亮失败：' + escapeHtml(e.message) + '</span>';
      }
    });
  }

  function renderToxicity(data) {
    const t = data.toxicity;
    currentSmiles = data.smiles || '';
    currentPlainSvg = (data.rdkit && data.rdkit.svg) ? data.rdkit.svg : '';
    currentToxAlerts = [];
    if (!t || !t.parsed) {
      els.toxPanel.innerHTML = '<div class="row-note">毒性 / 基因毒性警示筛查不可用（结构解析失败）。</div>';
      return;
    }
    const sevBadge = t.severe > 0
      ? `<span class="badge badge-bad">${t.severe} 类高风险</span>`
      : `<span class="badge badge-neutral">无高风险</span>`;
    const tone = t.total > 0 ? (t.severe > 0 ? 'bad' : 'warn') : 'ok';
    let html = `<div class="tox-banner ${tone}">
      <div class="tox-banner-head">结构警示筛查：共 <b>${t.total}</b> 类${t.total > 0 ? '，' + sevBadge : ''}</div>
      <div class="row-note" style="margin-top:4px">${escapeHtml(t.summary)}</div>
    </div>`;
    // 结构高亮查看器
    html += `<div class="tox-structure-wrap">
      <div class="sub-title" style="margin-top:12px" data-i18n="toxHighlight">警示结构高亮查看器</div>
      <div class="row-note">点击下方任意警示项，将在结构图中以其<b>风险等级配色</b>高亮对应子结构（<span style="color:#dc2626;font-weight:600">红=高风险</span> / <span style="color:#ea8a00;font-weight:600">橙=中风险</span> / <span style="color:#2f72d9;font-weight:600">蓝=低风险</span>）；点击「复位」恢复原始结构图。</div>
      <div class="tox-structure-bar">
        <button class="btn btn-sm btn-ghost" id="toxResetBtn" data-i18n="toxReset">复位结构图</button>
        <span class="row-note" style="margin:0"><span data-i18n="toxActiveOrig">当前高亮：</span><b id="toxActiveName" data-i18n="toxOrigStruct">原始结构</b></span>
      </div>
      <div class="tox-structure" id="toxStructure">${currentPlainSvg}</div>
    </div>`;
    const CAT = [
      ['genotoxic', 'toxGenotox', 'badge-bad'],
      ['herg', 'toxHerg', 'badge-warn'],
      ['sensitization', 'toxSens', 'badge-warn'],
      ['cyp', 'toxCyp', 'badge-neutral'],
    ];
    for (const [key, titleKey, cls] of CAT) {
      const list = (t.byCat && t.byCat[key]) || [];
      html += `<div class="sub-title" style="margin-top:12px">${T(titleKey)}（${list.length}）</div>`;
      if (!list.length) {
        html += '<div class="row-note">未检出相关警示结构。</div>';
      } else {
        html += '<div class="alert-list">' + list.map(a => {
          const sev = a.severity === 'high' ? 'badge-bad' : a.severity === 'medium' ? 'badge-warn' : 'badge-neutral';
          return `<span class="badge ${sev}" title="${escapeHtml(a.note)}">${escapeHtml(a.name)} ×${a.count}</span>`;
        }).join(' ') + '</div>';
        html += list.map(a => {
          const idx = currentToxAlerts.length;
          currentToxAlerts.push(a);
          const sevText = sevLabel(a.severity);
          return `<div class="alert-item sev-${a.severity}" data-alert-idx="${idx}"><span class="alert-sev alert-sev-${a.severity}"></span><div><b>${escapeHtml(a.name)}</b>（${sevText}）：${escapeHtml(a.note)}</div></div>`;
        }).join('');
      }
    }
    html += '<div class="row-note" style="margin-top:10px">说明：本筛查基于一组结构警示 SMARTS 子集，覆盖 ICH M7 重点关注类别（亚硝胺、环氧化物、烷化卤/磺酸酯、肼、重氮、芳香胺/硝基等）、hERG、皮肤致敏与 CYP 代谢相关片段。<b>仅为结构层面粗筛，不能替代正式毒理 / 致突变研究（Ames、微核、ICH M7 评估等）。点击警示项可在上方结构图中高亮对应子结构。</b></div>';
    els.toxPanel.innerHTML = html;
    attachToxHandlers();
    const resetBtn = $('toxResetBtn');
    if (resetBtn) resetBtn.addEventListener('click', () => {
      const ts = $('toxStructure');
      if (ts) ts.innerHTML = currentPlainSvg;
      const an = $('toxActiveName'); if (an) an.textContent = T('toxOrigStruct');
      document.querySelectorAll('.alert-item.active').forEach(e => e.classList.remove('active'));
    });
  }

  /* ---------- 警示结构高亮导出（SVG / 可打印 PDF） ---------- */
  function buildToxSvgDoc(forPrint) {
    if (!currentSmiles || !currentToxAlerts.length) return '';
    const alerts = currentToxAlerts;
    const W = 920, perRow = 2, cellW = W / perRow, cellH = 320;
    const rows = Math.ceil(Math.min(alerts.length, 16) / perRow);
    let cells = '';
    alerts.slice(0, 16).forEach((a, i) => {
      const color = a.severity === 'high' ? [0.86, 0.21, 0.21] : a.severity === 'medium' ? [0.85, 0.55, 0.13] : [0.2, 0.6, 0.86];
      let inner = '';
      try { const svg = RDKitEngine.highlightStructure(currentSmiles, a.atoms || [], a.bonds || [], color); inner = svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, ''); } catch (e) {}
      const cx = (i % perRow) * cellW, cy = Math.floor(i / perRow) * cellH;
      const label = escapeHtml((a.name || '未知') + '  [' + sevLabel(a.severity) + ']');
      cells += `<svg x="${cx}" y="${cy}" width="${cellW}" height="${cellH}"><rect width="100%" height="100%" fill="#fff" stroke="#ddd"/>` +
        `<text x="10" y="22" font-size="15" font-family="sans-serif" fill="#222">${label}</text>` +
        `<svg x="10" y="34" width="${cellW - 20}" height="${cellH - 50}">${inner}</svg></svg>`;
    });
    const title = forPrint ? '<text x="20" y="34" font-size="22" font-family="sans-serif" fill="#111">基因毒性 / 警示结构高亮视图</text>' : '';
    const totalH = title ? rows * cellH + 50 : rows * cellH;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${totalH}" viewBox="0 0 ${W} ${totalH}">${title}${cells}</svg>`;
  }
  function exportToxSVG() {
    const svg = buildToxSvgDoc(false);
    if (!svg) { setStatus('当前无检出警示结构，无法导出。', 'warn'); return; }
    download('tox_alerts_' + Date.now() + '.svg', svg, 'image/svg+xml');
    setStatus('已导出警示结构高亮 SVG。', 'ok');
  }
  function exportToxPDF() {
    const svg = buildToxSvgDoc(true);
    if (!svg) { setStatus('当前无检出警示结构，无法导出。', 'warn'); return; }
    const w = window.open('', '_blank');
    if (!w) { setStatus('浏览器拦截了打印窗口，请允许弹出。', 'err'); return; }
    w.document.write('<!DOCTYPE html><html><head><meta charset="utf-8"><title>警示结构高亮视图</title><style>body{font-family:sans-serif;margin:0}svg{width:100%;height:auto}@media print{body{margin:0}}</style></head><body>' + svg + '<script>window.onload=function(){setTimeout(function(){window.print();},300);}<\/script></body></html>');
    w.document.close();
  }

  /* ---------- 渲染：类药性进阶（先导优化 / 片段规则） ---------- */
  function renderLead(data) {
    const ll = data.pred.lead;
    if (!ll) { els.medchemPanel.innerHTML = '<div class="row-note">类药性进阶规则不可用。</div>'; return; }
    let html = '<div class="sub-title" data-i18n="subLead">类药性进阶规则（先导优化 / 片段筛选）</div>';
    html += ll.rules.map(r => {
      const verdict = r.pass
        ? `<span class="verdict pass" data-i18n="verdictPass">达标</span>`
        : `<span class="verdict fail" data-i18n="verdictFail">未达标</span>`;
      return `<div class="rule-block"><div class="rule-head"><span class="rule-name">${r.name}</span>${verdict}</div><div class="row-note" style="margin:2px 0 4px">${r.detail}</div><div style="font-size:11.5px;color:#5b6776">${r.note}</div></div>`;
    }).join('');
    html += `<div class="row-note">${ll.passCount}/${ll.total} 项达标。这些规则用于先导物优化与片段筛选，与 Lipinski 等口服成药性规则互补。</div>`;
    els.medchemPanel.innerHTML = html;
  }

  /* ---------- 渲染：水溶解度 + pH 依赖 ---------- */
  function fmtSci(x) {
    if (x == null || !isFinite(x)) return '—';
    if (x === 0) return '0';
    if (Math.abs(x) >= 0.01) return (+x).toFixed(3);
    const [m, e] = (+x).toExponential(2).split('e');
    // 使用 HTML <sup> 而非 Unicode 上标字符（部分字体不渲染上标 Unicode，会回退到基线大小）
    return m + '×10<sup>' + e + '</sup>';
  }
  function clsBadge(label) {
    if (label === '高溶解' || label === '易溶' || label === '可溶') return 'ok';
    if (label === '中等可溶') return 'neutral';
    return 'warn';
  }
  function renderSolubility(data) {
    const sol = data.pred.solubility;
    if (!sol) { els.solubilityPanel.innerHTML = '<div class="row-note">溶解度模型不可用（缺少 logP/TPSA 描述符）。</div>'; els.phPanel.innerHTML = ''; return; }
    let html = '<table class="data sol-table"><thead><tr><th data-i18n="thModel">模型</th><th data-i18n="thLogS">logS (mol/L)</th><th data-i18n="thMgml">溶解度 (mg/mL)</th><th data-i18n="thMolL">溶解度 (mol/L)</th><th data-i18n="thCls">溶解度等级</th></tr></thead><tbody>';
    for (const m of sol.models) {
      html += `<tr><td>${m.name}</td><td>${m.logS.toFixed(2)}</td><td>${fmtSci(m.mgml)}</td><td>${fmtSci(m.molL)}</td><td><span class="badge badge-${clsBadge(m.cls.label)}">${m.cls.label}</span></td></tr>`;
    }
    if (sol.consensus) {
      html += `<tr class="consensus-row"><td><span data-i18n="thConsensus">综合参考</span> (ESOL/Ali 均值)</td><td><b>${sol.consensus.logS.toFixed(2)}</b></td><td><b>${fmtSci(sol.consensus.mgml)}</b></td><td><b>${fmtSci(sol.consensus.molL)}</b></td><td><span class="badge badge-${clsBadge(sol.consensus.cls.label)}">${sol.consensus.cls.label}</span></td></tr>`;
    }
    html += '</tbody></table>';
    html += `<div class="row-note" style="margin-top:8px">${escapeHtml(sol.note)}</div>`;
    // 溶解度等级标尺（logS 区间可视化）
    if (sol.consensus) {
      const logs = sol.consensus.logS;
      const pct = Math.max(0, Math.min(100, ((logs - (-6)) / (0 - (-6))) * 100));
      const tier = logs >= 0 ? '高溶' : logs >= -2 ? '易溶' : logs >= -4 ? '可溶' : logs >= -6 ? '中等可溶' : '难溶';
      html += `<div class="sol-gauge-wrap">
        <div class="sol-gauge-title"><span data-i18n="solGauge">溶解度等级标尺</span> · 综合 logS = <b>${logs.toFixed(2)}</b>（${tier}）</div>
        <div class="sol-gauge"><div class="sol-gauge-fill" style="width:${pct}%"></div><div class="sol-gauge-marker" style="left:${pct}%"></div></div>
        <div class="sol-gauge-scale"><span>难溶 −6</span><span>中等 −4</span><span>可溶 −2</span><span>高溶 0</span></div>
      </div>`;
    }
    els.solubilityPanel.innerHTML = html;
    renderPH(data);
  }
  function estimatePH(ab) {
    if (!ab || !ab.length) return null;
    const acids = ab.filter(g => g.type === 'acid');
    const bases = ab.filter(g => g.type === 'base');
    let pick;
    if (acids.length) pick = acids.reduce((a, b) => (a.pka < b.pka ? a : b));
    else if (bases.length) pick = bases.reduce((a, b) => (a.pka > b.pka ? a : b));
    else return null;
    const cn = {
      carboxylic_aliphatic: '羧酸', carboxylic_aryl: '芳香羧酸', phenol: '酚羟基', sulfonamide_nh: '磺酰胺',
      thiol: '硫醇', thiophenol: '芳香硫酚', imide_nh: '酰亚胺', hydroxamic_oh: '异羟肟酸',
      amine_prim: '伯脂肪胺', amine_sec: '仲脂肪胺', amine_tert: '叔脂肪胺',
      aniline_prim: '苯胺', aniline_sec: 'N-烷基芳胺', pyridine: '吡啶/杂芳N', imidazole: '咪唑N',
      guanidine: '胍基', amidine: '脒基', hydrazine: '肼',
    };
    return { groupName: cn[pick.key] || pick.name, type: pick.type, pka: pick.pka };
  }
  function phSolubility(ph, info) {
    const S0 = Math.pow(10, info.intrinsicLogS); // mol/L
    let S, form;
    if (info.type === 'acid') {
      S = S0 * (1 + Math.pow(10, ph - info.pka));
      form = ph > info.pka + 0.5 ? '离子化形态为主' : (ph < info.pka - 0.5 ? '中性分子为主' : '中性/离子共存');
    } else {
      S = S0 * (1 + Math.pow(10, info.pka - ph));
      form = ph < info.pka - 0.5 ? '质子化形态为主' : (ph > info.pka + 0.5 ? '中性形态为主' : '质子化/中性共存');
    }
    return { mgml: S * (info.MW || 1), molL: S, form };
  }
  function renderPH(data) {
    const sol = data.pred.solubility;
    if (!sol || !sol.consensus) { els.phPanel.innerHTML = ''; return; }
    const info = estimatePH(data.rdkit.acidbase);
    if (!info) {
      els.phPanel.innerHTML = '<div class="ph-block"><div class="sub-title" data-i18n="subPH">pH 依赖溶解度（估算）</div><div class="row-note" data-i18n="phNoIon">未检出可电离基团，溶解度不随 pH 显著变化。</div></div>';
      return;
    }
    const full = Object.assign({}, info, { intrinsicLogS: sol.consensus.logS, MW: data.rdkit.desc.amw });
    const phs = [1.7, 4.6, 6.5, 7.4, 8.0];
    let html = '<div class="ph-block"><div class="sub-title" data-i18n="subPH">pH 依赖溶解度（估算）</div>';
    html += `<div class="row-note">主要可电离基团：<b>${escapeHtml(full.groupName)}</b>（${full.type === 'acid' ? '酸，pKa≈' + full.pka : '碱，pKa≈' + full.pka}）；基于 Henderson-Hasselbalch 方程，固有溶解度取综合 logS。实际 pH-溶解度曲线需实验测定。</div>`;
    html += '<table class="data sol-table"><thead><tr><th data-i18n="thPH">pH</th><th data-i18n="thAppSol">表观溶解度 (mg/mL)</th><th data-i18n="thForm">主要存在形态</th></tr></thead><tbody>';
    for (const ph of phs) {
      const r = phSolubility(ph, full);
      html += `<tr><td>${ph}</td><td>${fmtSci(r.mgml)}</td><td>${r.form}</td></tr>`;
    }
    html += '</tbody></table></div>';
    els.phPanel.innerHTML = html;
  }

  /* ---------- 渲染：ADME ---------- */
  function ruleBlock(r) {
    const items = r.criteria.map(c =>
      `<div class="rule-item"><span>${escapeHtml(c.name)}</span><span class="${c.pass ? 'ok' : 'no'}">${c.pass ? '✓' : '✗'} ${c.value}</span></div>`
    ).join('');
    const verdict = r.pass
      ? `<span class="verdict pass">达标</span>`
      : `<span class="verdict fail">${r.violations} 项不符</span>`;
    return `<div class="rule-block"><div class="rule-head"><span class="rule-name">${r.name}</span>${verdict}</div>${items}<div style="font-size:11.5px;color:#5b6776;margin-top:4px">${r.note || ''}</div></div>`;
  }

  function drugFriendliness(data) {
    const pains = data.rdkit.pains || [];
    const brenk = data.rdkit.brenk || [];
    let html = '<div class="sub-title" style="margin-top:14px" data-i18n="subChemFriendly">化学友好性（PAINS / Brenk 警示子集）</div>';
    const items = [];
    pains.forEach(g => items.push({ name: g.name, src: 'PAINS' }));
    brenk.forEach(g => items.push({ name: g.name, src: 'Brenk' }));
    if (!items.length) {
      html += '<div class="row-note">未检出常见 PAINS/Brenk 警示结构（基于高频子集，非完整过滤库）。</div>';
    } else {
      html += '<div class="alert-list">' + items.map(i => `<span class="badge badge-warn">${i.src}：${escapeHtml(i.name)}</span>`).join(' ') + '</div>';
    }
    html += '<div class="row-note" style="margin-top:4px">注：PAINS/Brenk 为高频警示子集（非完整过滤库），仅作结构筛查参考。</div>';
    return html;
  }
  function bcsBadge(cls) {
    return ({ I: 'ok', II: 'warn', III: 'neutral', IV: 'bad' })[cls] || 'neutral';
  }

  function renderADME(data) {
    const p = data.pred;
    const ruleHTML = [p.lipinski, p.veber, p.egan, p.muegge, p.ghose].map(ruleBlock).join('');

    const bio = p.bioavailability, bbb = p.bbb, gi = p.gi, sa = p.sa, bcs = p.bcs;
    const scoreHTML = `
      <div style="margin-top:6px;font-weight:700;font-size:13.5px;margin-bottom:8px" data-i18n="admeSummary">综合 ADME 估计</div>
      <div class="score-line">
        <div class="score-box"><div class="s-label" data-i18n="admeBio">生物利用度评分</div><div class="s-val">${bio.score.toFixed(2)}</div><div style="font-size:11.5px;color:#5b6776">${bio.label}</div></div>
        <div class="score-box"><div class="s-label" data-i18n="admeBBB">血脑屏障透过</div><div class="s-val">${bbb.level.split(' ')[0]}</div><div style="font-size:11.5px;color:#5b6776">logBB ≈ ${bbb.logBB}</div></div>
        <div class="score-box"><div class="s-label" data-i18n="admeGI">胃肠道吸收</div><div class="s-val">${gi.level}</div><div style="font-size:11.5px;color:#5b6776">SwissADME 估计</div></div>
        <div class="score-box"><div class="s-label" data-i18n="admeSA">合成可及性</div><div class="s-val">${sa.level}</div><div style="font-size:11.5px;color:#5b6776">SA≈${sa.score}${sa.approximate ? ' (近似)' : ''}</div></div>
      </div>
      <div class="bcs-line"><span data-i18n="bcsTitle">BCS 分类预估：</span><span class="badge badge-${bcsBadge(bcs.class)}">第 ${bcs.class} 类</span> （${bcs.desc}）— 溶解度${bcs.solubilityHigh ? T('bcsSolHi') : T('bcsSolLo')} / 渗透性${bcs.permeabilityHigh ? T('bcsPermHi') : T('bcsPermLo')}</div>`;

    els.admePanel.innerHTML = ruleHTML + drugFriendliness(data) + scoreHTML;
  }

  /* ---------- 渲染：雷达图 ---------- */
  function radarSVG(axes) {
    const size = 320, cx = size / 2, cy = size / 2, R = 118, n = axes.length;
    const angle = i => (-90 + i * 360 / n) * Math.PI / 180;
    const pt = (i, r) => [cx + r * Math.cos(angle(i)), cy + r * Math.sin(angle(i))];
    let rings = '';
    [0.25, 0.5, 0.75, 1].forEach(lv => {
      const pts = axes.map((_, i) => pt(i, R * lv).join(',')).join(' ');
      rings += `<polygon points="${pts}" fill="none" stroke="#e3e8ef" stroke-width="1"/>`;
    });
    let lines = '', labels = '';
    axes.forEach((a, i) => {
      const [x, y] = pt(i, R);
      lines += `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="#e3e8ef"/>`;
      const [lx, ly] = pt(i, R + 18);
      labels += `<text x="${lx}" y="${ly}" font-size="11" fill="#5b6776" text-anchor="middle" dominant-baseline="middle">${a.axis}</text>`;
    });
    const dpts = axes.map((a, i) => pt(i, R * (a.value || 0)).join(',')).join(' ');
    const dots = axes.map((a, i) => { const [x, y] = pt(i, R * (a.value || 0)); return `<circle cx="${x}" cy="${y}" r="3" fill="#2563eb"/>`; }).join('');
    return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">${rings}${lines}<polygon points="${dpts}" fill="rgba(37,99,235,0.18)" stroke="#2563eb" stroke-width="2"/>${dots}${labels}</svg>`;
  }
  function renderRadar(data) {
    els.radarChart.innerHTML = radarSVG(data.pred.radar);
    els.radarLegend.innerHTML = T('radarLegend');
  }

  /* ---------- pH / 电离相关结果卡片的条件显隐 ---------- */
  // GSE pH–溶解度、缓冲容量：含酸性或碱性 pKa 任一方即显示；
  // pH 质量标准：需同时含酸性与碱性 pKa（两性游离碱场景）。
  // 隐藏后 buildResultToc() 会自动跳过该卡片，目录同步消失。
  function updateIonizableCardVisibility(data) {
    const pka = data && data.rdkit && data.rdkit.pka;
    const acids = (pka && pka.acids) || [];
    const bases = (pka && pka.bases) || [];
    const hasAcid = acids.length > 0;
    const hasBase = bases.length > 0;
    const map = [
      { id: 'gsePh-card', show: hasAcid || hasBase, out: 'gsePhOut' },
      { id: 'bufferCap-card', show: hasAcid || hasBase, out: 'bufferCapOut' },
      { id: 'phSpec-card', show: hasAcid && hasBase, out: 'phSpecOut' },
    ];
    map.forEach(item => {
      const el = document.getElementById(item.id);
      if (!el) return;
      el.classList.toggle('hidden', !item.show);
      if (!item.show) {
        const out = document.getElementById(item.out);
        if (out) out.innerHTML = '';
      }
    });
  }

  /* ---------- 结果区目录引导 ---------- */
  const TOC_SECTIONS = [
    { id: 'resultHero', i18n: 'tocOverview' },
    { id: 'identity-card', i18n: 'tocIdentity' },
    { id: 'props-card', i18n: 'tocProps' },
    { id: 'adv-confidence-card', i18n: 'tocAdvConf' },
    { id: 'adv-speciation-card', i18n: 'tocAdvSpec' },
    { id: 'form-card', i18n: 'tocForm' },
    { id: 'solubility-card', i18n: 'tocSolubility' },
    { id: 'thermo-card', i18n: 'tocThermo' },
    { id: 'conformer-card', i18n: 'tocConformer' },
    { id: 'tox-card', i18n: 'tocTox' },
    { id: 'spectra-card', i18n: 'tocSpectra' },
    { id: 'adme-card', i18n: 'tocAdme' },
    { id: 'radar-card', i18n: 'tocRadar' },
    { id: 'medchem-card', i18n: 'tocMedchem' },
    { id: 'adv-esol-card', i18n: 'tocAdvEsol' },
    { id: 'adv-ichm7-card', i18n: 'tocAdvM7' },
    { id: 'adv-salt-card', i18n: 'tocAdvSalt' },
    { id: 'adv-hansen-card', i18n: 'tocAdvHansen' },
    { id: 'adv-tempsol-card', i18n: 'tocAdvTemp' },
    { id: 'adv-soldist-card', i18n: 'tocAdvSol' },
    { id: 'adv-green-card', i18n: 'tocAdvGreen' },
    { id: 'adv-excipient-card', i18n: 'tocAdvExc' },
    { id: 'adv-retro-card', i18n: 'tocAdvRetro' },
    { id: 'adv-keyprops-card', i18n: 'tocAdvKey' },
    { id: 'adv-electronic-card', i18n: 'tocAdvQM' },
    { id: 'orgSolub-card', i18n: 'tocOrgSolub' },
    { id: 'gsePh-card', i18n: 'tocGsePh' },
    { id: 'bufferCap-card', i18n: 'tocBufferCap' },
    { id: 'phSpec-card', i18n: 'tocPhSpec' },
  ];
  let tocScrollHandler = null;
  let tocScrollTicking = false;
  let tocClickActiveUntil = 0;

  function buildResultToc() {
    if (!els.tocNav) return;
    els.tocNav.innerHTML = '';
    const visible = [];
    TOC_SECTIONS.forEach(sec => {
      const el = document.getElementById(sec.id);
      if (!el) return;
      const style = window.getComputedStyle(el);
      if (el.classList.contains('hidden') || style.display === 'none' || style.visibility === 'hidden') return;
      if (el.offsetHeight < 8) return;
      visible.push(sec);
    });
    if (!visible.length) {
      if (els.resultToc) els.resultToc.classList.add('hidden');
      return;
    }
    visible.forEach((sec, idx) => {
      const a = document.createElement('a');
      a.className = 'toc-item';
      a.href = '#' + sec.id;
      a.innerHTML = '<span class="toc-num">' + (idx + 1) + '</span><span class="toc-label">' + escapeHtml(T(sec.i18n)) + '</span><span class="toc-chevron">▶</span>';
      a.addEventListener('click', (e) => { e.preventDefault(); scrollToSection(sec.id); closeTocSheet(); });
      els.tocNav.appendChild(a);
    });
    if (els.resultToc) {
      els.resultToc.classList.remove('hidden');
      els.resultToc.classList.add('visible');
    }
    initTocScrollSpy();
  }

  function scrollToSection(id) {
    const el = document.getElementById(id);
    if (!el) return;
    const header = document.querySelector('.site-header');
    const headerH = header ? header.offsetHeight : 64;
    const gap = 18;
    const y = el.getBoundingClientRect().top + window.scrollY - headerH - gap;
    window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
    // 立即高亮目标条目，并在滚动过程中短暂屏蔽 scrollspy，防止高亮乱跳
    if (els.tocNav) {
      const link = els.tocNav.querySelector('a[href="#' + id + '"]');
      if (link) {
        Array.from(els.tocNav.querySelectorAll('.toc-item')).forEach(a => a.classList.remove('active'));
        link.classList.add('active');
        scrollTocItemIntoView(link);
        tocClickActiveUntil = Date.now() + 900;
      }
    }
  }

  function updateTocActive(items) {
    if (!items || !items.length) return;
    if (Date.now() < tocClickActiveUntil) return;
    const header = document.querySelector('.site-header');
    const headerH = header ? header.offsetHeight : 64;
    const threshold = headerH + 24;
    let best = null, bestTop = -Infinity;
    items.forEach(a => {
      const id = a.getAttribute('href').slice(1);
      const el = document.getElementById(id);
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (rect.top <= threshold && rect.bottom > threshold) {
        if (rect.top > bestTop) { bestTop = rect.top; best = a; }
      }
    });
    if (!best) {
      let minTop = Infinity;
      items.forEach(a => {
        const id = a.getAttribute('href').slice(1);
        const el = document.getElementById(id);
        if (!el) return;
        const rect = el.getBoundingClientRect();
        if (rect.top >= threshold && rect.top < window.innerHeight && rect.bottom > threshold) {
          if (rect.top < minTop) { minTop = rect.top; best = a; }
        }
      });
    }
    items.forEach(a => a.classList.toggle('active', a === best));
    if (best) scrollTocItemIntoView(best);
  }

  function scrollTocItemIntoView(item) {
    if (!item || !els.tocNav) return;
    const nav = els.tocNav;
    const navRect = nav.getBoundingClientRect();
    const itemRect = item.getBoundingClientRect();
    const pad = 6;
    if (itemRect.top < navRect.top + pad) {
      nav.scrollTop += itemRect.top - navRect.top - pad;
    } else if (itemRect.bottom > navRect.bottom - pad) {
      nav.scrollTop += itemRect.bottom - navRect.bottom + pad;
    }
  }

  function initTocScrollSpy() {
    if (!els.tocNav) return;
    const items = Array.from(els.tocNav.querySelectorAll('.toc-item'));
    if (!items.length) return;
    if (tocScrollHandler) window.removeEventListener('scroll', tocScrollHandler, { passive: true });
    tocScrollHandler = () => {
      if (tocScrollTicking) return;
      tocScrollTicking = true;
      requestAnimationFrame(() => { updateTocActive(items); tocScrollTicking = false; });
    };
    window.addEventListener('scroll', tocScrollHandler, { passive: true });
    updateTocActive(items);
  }

  // 手机端底部抽屉：打开 / 关闭
  function openTocSheet() {
    const rt = els.resultToc;
    if (!rt || !rt.classList.contains('visible')) return;
    rt.classList.add('open');
    document.body.classList.add('toc-open');
    const bd = $('tocBackdrop');
    if (bd) { bd.classList.add('show'); bd.removeAttribute('hidden'); }
    document.body.style.overflow = 'hidden';
  }
  function closeTocSheet() {
    const rt = els.resultToc;
    if (rt) rt.classList.remove('open');
    document.body.classList.remove('toc-open');
    const bd = $('tocBackdrop');
    if (bd) { bd.classList.remove('show'); bd.setAttribute('hidden', ''); }
    document.body.style.overflow = '';
  }

  // 目录收起/展开切换（可收起或隐藏导航项）
  function initTocToggle() {
    const btn = $('tocToggle');
    const card = $('tocCard');
    const fab = $('tocFab');
    const closeBtn = $('tocClose');
    const backdrop = $('tocBackdrop');
    if (!btn || !card) return;
    let collapsed = false;
    try { collapsed = localStorage.getItem('chemprop_toc_collapsed') === '1'; } catch (e) {}
    function apply() {
      card.classList.toggle('collapsed', collapsed);
      btn.textContent = collapsed ? '▶' : '▼';
      btn.setAttribute('aria-label', collapsed ? '展开目录' : '收起目录');
      btn.setAttribute('title', collapsed ? '展开目录' : '收起目录');
    }
    apply();
    btn.addEventListener('click', () => {
      collapsed = !collapsed;
      apply();
      try { localStorage.setItem('chemprop_toc_collapsed', collapsed ? '1' : '0'); } catch (e) {}
    });
    if (fab) fab.addEventListener('click', () => {
      const rt = els.resultToc;
      if (rt && rt.classList.contains('open')) closeTocSheet(); else openTocSheet();
    });
    if (closeBtn) closeBtn.addEventListener('click', closeTocSheet);
    if (backdrop) backdrop.addEventListener('click', closeTocSheet);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeTocSheet(); });
    // 离开手机宽度时复位抽屉，避免残留
    window.addEventListener('resize', () => {
      if (window.matchMedia('(min-width: 768px)').matches) closeTocSheet();
    });
  }
  initTocToggle();

  // 一键置顶：悬浮按钮（手机/平板）+ 目录底部按钮（桌面）
  function initScrollTopBtn() {
    const floatBtn = document.getElementById('scrollTopBtn');
    const tocBtn = document.getElementById('tocScrollTopBtn');
    if (!floatBtn && !tocBtn) return;
    let ticking = false;
    function onScroll() {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const y = window.scrollY || document.documentElement.scrollTop;
        if (floatBtn) floatBtn.classList.toggle('visible', y > 300);
        ticking = false;
      });
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    [floatBtn, tocBtn].forEach(btn => {
      if (!btn) return;
      btn.addEventListener('click', () => { window.scrollTo({ top: 0, behavior: 'smooth' }); });
    });
  }

  /* ---------- 单条流程 ---------- */
  async function runSingle() {
    const raw = els.input.value.trim();
    if (!raw) { setStatus('请输入化合物标识。', 'err'); return; }
    const mySeq = ++_runSeq; // 查询代际令牌：最新一次查询覆盖之前尚未完成的查询（latest-wins）
    els.predictBtn.disabled = true; els.batchBtn.disabled = true;
    showCalcOverlay('① 识别输入类型并加载引擎…');
    setStatus('① 识别输入类型并加载引擎…');
    hideNotFound();
    try {
      const data = await analyzeSingle(raw, els.inputType.value === 'auto' ? null : els.inputType.value, els.role.value, mySeq);
      if (mySeq !== _runSeq) return; // 已有更新的查询发起，本次结果作废，禁止写入 DOM
      lastSingle = data;
      // 进阶分析增强：基于已有 rdkit.desc / pka / pred / toxicity 计算 12 个新模块
      try { data.advance = (window.Advance ? Advance.compute(data) : null); } catch (e) { data.advance = null; console.error('Advance.compute failed:', e); }
      updateCalcOverlay('⑤ 渲染结果卡片…');
      renderHero(data); renderIdentity(data); renderProps(data); renderForm(data); renderSpectra(data); renderSpectraLinks(data); renderSolubility(data); renderThermo(data); renderToxicity(data); renderImpurity(data); renderConformer(data); renderLead(data); renderADME(data); renderRadar(data);
      if (window.Advance) { try { Advance.renderAll(data); } catch (e) { console.error('Advance.renderAll failed:', e); } }
      updateIonizableCardVisibility(data);
      els.resultSection.classList.remove('hidden');
      els.batchSection.classList.add('hidden');
      buildResultToc();
      // v20250829p：预测后自动将当前化合物带入「溶解度与 pH 工艺」结果卡片并计算。
      // v20250829v 修正：若卡片因缺少对应 pKa 已被隐藏，则跳过其自动计算，避免填充不可见内容。
      ['orgSolubUseCurrent', 'gsePhUseCurrent', 'bufferCapUseCurrent', 'phSpecUseCurrent'].forEach(id => {
        const b = document.getElementById(id);
        if (!b) return;
        const card = b.closest('.card');
        if (card && card.classList.contains('hidden')) return;
        try { b.click(); } catch (e) { /* 数据不足时静默跳过 */ }
      });
      applyI18nDom();
      addHistory(data);
      els.resultSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
      const usedLocal = data.pubchem && !data.pubchem.cid;
      setStatus(usedLocal ? '计算完成（PubChem 未匹配，已使用本地 SMILES 兜底）。' : '计算完成。', usedLocal ? 'warn' : 'ok');
      cacheLastResult(); // ⑨ 写入结果缓存
      // ⑩ 角色联动：用最终识别/缓存/用户指定的角色同步下拉框与提示；无法确定时提示手动选择
      els.role.value = data.role;
      if (data.role && data.role !== 'unknown') {
        updateRoleHint('auto', data.role);
        roleAutoLocked = false;
      } else {
        updateRoleHint('unknown', null);
      }
    } catch (e) {
      if (mySeq !== _runSeq || (e && e.message === 'SUPERSEDED')) return; // 被新查询取代，静默放弃，不报错不渲染
      const type = els.inputType.value === 'auto' ? detectType(raw) : els.inputType.value;
      setStatus('错误：' + e.message, 'err');
      renderNotFound(raw, type);
      els.resultSection.classList.remove('hidden');
      els.batchSection.classList.add('hidden');
      els.resultSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } finally {
      if (mySeq === _runSeq) { // 仅当自己仍是最新一次时才收尾，避免过期查询提前解除遮罩/恢复按钮
        hideCalcOverlay();
        els.predictBtn.disabled = false; els.batchBtn.disabled = false;
      }
    }
  }

  /* ---------- 批量流程 ---------- */
  async function runBatch() {
    const lines = els.input.value.split('\n').map(s => s.trim()).filter(Boolean);
    if (!lines.length) { setStatus('请输入至少一个化合物（每行一个）。', 'err'); return; }
    els.batchBtn.disabled = true; els.predictBtn.disabled = true;
    showCalcOverlay(`批量处理中 0/${lines.length}…`);
    setCalcBar(0);
    lastBatch = [];
    setStatus(`批量处理中 0/${lines.length}…`);
    try {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        let row = { idx: i + 1, input: line };
        try {
          const data = await analyzeSingle(line, els.inputType.value === 'auto' ? null : els.inputType.value, els.role.value);
          fillBatchRow(row, data);
        } catch (e) {
          row.ok = false; row.err = e.message;
        }
        lastBatch.push(row);
        const progress = `批量处理中 ${i + 1}/${lines.length}…`;
        updateCalcOverlay(progress);
        setCalcBar((i + 1) / lines.length * 100);
        setStatus(progress);
      }
      renderBatchTable();
      els.batchSection.classList.remove('hidden');
      els.resultSection.classList.add('hidden');
      els.batchSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setStatus(`批量完成：${lastBatch.filter(r => r.ok).length}/${lastBatch.length} 成功。`, 'ok');
    } catch (e) {
      setStatus('批量处理错误：' + e.message, 'err');
    } finally {
      hideCalcOverlay();
      setCalcBar(null);
      els.batchBtn.disabled = false; els.predictBtn.disabled = false;
    }
  }

  function fillBatchRow(r, data) {
    const d = data.rdkit.desc, p = data.pred;
    r.ok = true; r.err = '';
    r.role = data.role || 'unknown';
    r.name = (data.pubchem && (data.pubchem.iupac || data.pubchem.title)) ? (data.pubchem.iupac || data.pubchem.title) : r.input;
    r.smiles = data.smiles;
    r.mw = d.amw != null ? (+d.amw).toFixed(2) : '';
    r.logp = d.CrippenClogP != null ? (+d.CrippenClogP).toFixed(2) : '';
    r.tpsa = d.tpsa != null ? (+d.tpsa).toFixed(1) : '';
    r.hbd = d.NumHBD != null ? d.NumHBD : '';
    r.hba = d.NumHBA != null ? d.NumHBA : '';
    r.rot = d.NumRotatableBonds != null ? d.NumRotatableBonds : '';
    r.lipinski = p.lipinski.violations;
    r.bbb = p.bbb.level.split(' ')[0];
    r.gi = p.gi.level;
    r.bio = p.bioavailability.label;
    r.groups = (data.rdkit.groups || []).map(g => g.name).join('; ');
    const tox = data.toxicity, f = data.form;
    r.isSalt = f ? f.isSalt : null;
    r.toxTotal = (tox && tox.parsed) ? tox.total : '';
    r.toxSevere = (tox && tox.parsed) ? tox.severe : '';
  }
  function renderBatchTable() {
    const cols = [
      { k: 'thIdx', f: 'idx' }, { k: 'thNameIn', f: 'name' }, { k: 'thRoleCol', f: 'role' }, { k: 'thSmilesShort', f: 'smiles' }, { k: 'thMW', f: 'mw' }, { k: 'thLogP', f: 'logp' },
      { k: 'thTPSA', f: 'tpsa' }, { k: 'thHBD', f: 'hbd' }, { k: 'thHBA', f: 'hba' }, { k: 'thRotB', f: 'rot' }, { k: 'thLipViol', f: 'lipinski' },
      { k: 'thBBB', f: 'bbb' }, { k: 'thGI', f: 'gi' }, { k: 'thBio', f: 'bio' }, { k: 'thToxTotal', f: 'toxTotal' }, { k: 'thToxSevere', f: 'toxSevere' }, { k: 'thGroups', f: 'groups' },
    ];
    const head = '<tr>' + cols.map(c => `<th data-i18n="${c.k}">${T(c.k)}</th>`).join('') + `<th data-i18n="thOp">${T('thOp')}</th></tr>`;
    const body = lastBatch.map(r => {
      if (!r.ok) {
        return '<tr><td>' + r.idx + '</td><td colspan="' + (cols.length - 1) + '" style="color:#dc2626">' + T('batchFail') + escapeHtml(r.err) + '</td>' +
          `<td><button class="btn btn-sm btn-ghost batch-retry" data-idx="${r.idx}" type="button" data-i18n="batchRetry">${T('batchRetry')}</button></td></tr>`;
      }
      const cells = cols.map(c => {
        if (c.f === 'idx') return `<td>${r.idx}</td>`;
        if (c.f === 'smiles') return `<td style="font-family:monospace;font-size:11px">${escapeHtml(r.smiles)}</td>`;
        return `<td>${escapeHtml(r[c.f])}</td>`;
      }).join('');
      return '<tr>' + cells + `<td><button class="btn btn-sm btn-ghost batch-retry" data-idx="${r.idx}" type="button" data-i18n="batchRecalc">${T('batchRecalc')}</button> <button class="btn btn-sm btn-ghost batch-rowcsv" data-idx="${r.idx}" type="button" data-i18n="batchCSV">${T('batchCSV')}</button></td></tr>`;
    }).join('');
    els.batchTableWrap.innerHTML = `<table class="data">${head}${body}</table>`;
    applyI18nDom();
  }
  async function retryBatchRow(idx) {
    const r = lastBatch.find(x => x.idx === idx);
    if (!r) return;
    showCalcOverlay('重新计算 ' + r.input + '…'); setCalcBar(null);
    try {
      const data = await analyzeSingle(r.input, els.inputType.value === 'auto' ? null : els.inputType.value, els.role.value);
      fillBatchRow(r, data);
      setStatus('已重算 #' + idx + '。', 'ok');
    } catch (e) { r.ok = false; r.err = e.message; }
    renderBatchTable();
    hideCalcOverlay();
  }
  function exportRowCSV(idx) {
    const r = lastBatch.find(x => x.idx === idx);
    if (!r) return;
    const header = ['#', '名称/输入', '角色', 'SMILES', 'MW', 'logP', 'TPSA', 'HBD', 'HBA', 'RotB', 'Lipinski违例', 'BBB', 'GI吸收', '生物利用度', '盐型', '警示官能团'];
    const row = [r.idx, r.name || r.input, roleLabelZh(r.role), r.smiles || '', r.mw || '', r.logp || '', r.tpsa || '', r.hbd || '',
      r.hba || '', r.rot || '', r.lipinski != null ? r.lipinski : '', r.bbb || '', r.gi || '', r.bio || '',
      r.isSalt != null ? (r.isSalt ? '是' : '否') : '', r.groups || ''].map(csvEscape);
    download('chemprop_row_' + idx + '.csv', '﻿' + header.map(csvEscape).join(',') + '\n' + row.join(',') + '\n', 'text/csv;charset=utf-8');
  }

  /* ---------- 导出 ---------- */
  function exportSingleCSV() {
    if (!lastSingle) return;
    const d = lastSingle.rdkit.desc, pc = lastSingle.pubchem, p = lastSingle.pred;
    const iso = Predict.isotopePattern(lastSingle.rdkit.formula, d.exactmw);
    const isoP = (k) => { if (!iso || !iso.peaks) return ''; const x = iso.peaks.find(pp => pp.delta === k); return x ? x.relInt : '0'; };
    const tox = lastSingle.toxicity;
    const frm = lastSingle.form;
    const header = ['名称', 'SMILES', '分子式', 'MW', 'ExactMW', 'logP', 'XLogP', 'TPSA', 'HBD', 'HBA', 'RotBonds', '芳香环', 'Lipinski违例', 'BBB', 'GI吸收', '生物利用度', '合成可及性', 'Ghose违例', '综合logS', '溶解度等级', 'BCS分类', '警示官能团', '化学警示(PAINS/Brenk)', '盐型', '抗衡离子', '互变异构位点', '基因毒性类数', '高风险警示数', 'hERG警示', '致敏警示', 'CYP警示', '先导达标', '精确质量(单同位素)', '标称质量', '不饱和度', '预测M⁺', '同位素M+1(%)', '同位素M+2(%)', 'InChIKey', 'CID'];
    const name = (pc && (pc.iupac || pc.title)) ? (pc.iupac || pc.title) : lastSingle.input;
    const alerts = [].concat(
      (lastSingle.rdkit.pains || []).map(g => 'PAINS:' + g.name),
      (lastSingle.rdkit.brenk || []).map(g => 'Brenk:' + g.name)
    ).join('; ');
    const row = [
      name, lastSingle.smiles, pc && pc.formula || '', d.amw != null ? (+d.amw).toFixed(2) : '',
      d.exactmw != null ? (+d.exactmw).toFixed(4) : '', d.CrippenClogP != null ? (+d.CrippenClogP).toFixed(2) : '',
      pc && pc.xlogp != null ? (+pc.xlogp).toFixed(2) : '', d.tpsa != null ? (+d.tpsa).toFixed(1) : '',
      d.NumHBD != null ? d.NumHBD : '', d.NumHBA != null ? d.NumHBA : '', d.NumRotatableBonds != null ? d.NumRotatableBonds : '',
      d.NumAromaticRings != null ? d.NumAromaticRings : '', p.lipinski.violations, p.bbb.level.split(' ')[0],
      p.gi.level, p.bioavailability.label, p.sa.level, p.ghose.violations,
      p.solubility.consensus ? p.solubility.consensus.logS.toFixed(2) : '',
      p.solubility.consensus ? p.solubility.consensus.cls.label : '',
      p.bcs.class + '类 (' + p.bcs.desc + ')',
      (lastSingle.rdkit.groups || []).map(g => g.name).join('; '), alerts,
      frm ? (frm.isSalt ? '是' : '否') : '',
      frm ? (frm.counterions || []).map(c => c.name).join('; ') : '',
      frm ? (frm.tautomers || []).map(t => t.name).join('; ') : '',
      tox ? tox.total : '', tox ? tox.severe : '',
      tox ? (tox.byCat.herg || []).length : '', tox ? (tox.byCat.sensitization || []).length : '', tox ? (tox.byCat.cyp || []).length : '',
      p.lead ? (p.lead.passCount + '/' + p.lead.total) : '',
      iso && iso.exactMass != null ? (+iso.exactMass).toFixed(4) : '',
      iso && iso.nominalMass != null ? iso.nominalMass : '',
      iso && iso.dbe != null ? iso.dbe : '',
      iso && iso.molecularIon != null ? iso.molecularIon : '',
      isoP(1), isoP(2),
      lastSingle.rdkit.inchikey || '', pc && pc.cid || '',
    ].map(csvEscape);
    download('chemprop_single.csv', '﻿' + header.map(csvEscape).join(',') + '\n' + row.join(',') + '\n', 'text/csv;charset=utf-8');
  }
  function exportBatchCSV() {
    if (!lastBatch.length) return;
    const header = ['#', '名称/输入', 'SMILES', 'MW', 'logP', 'TPSA', 'HBD', 'HBA', 'RotB', 'Lipinski违例', 'BBB', 'GI吸收', '生物利用度', '盐型', '警示官能团'];
    const rows = lastBatch.map(r => [
      r.idx, r.name || r.input, r.smiles || '', r.mw || '', r.logp || '', r.tpsa || '', r.hbd || '',
      r.hba || '', r.rot || '', r.lipinski != null ? r.lipinski : '', r.bbb || '', r.gi || '', r.bio || '',
      r.isSalt != null ? (r.isSalt ? '是' : '否') : '', r.groups || '',
    ].map(csvEscape));
    download('chemprop_batch.csv', '﻿' + header.map(csvEscape).join(',') + '\n' + rows.map(r => r.join(',')).join('\n') + '\n', 'text/csv;charset=utf-8');
  }
  function exportSingleJSON() {
    if (!lastSingle) return;
    const out = {
      input: lastSingle.input, type: lastSingle.type, role: lastSingle.role, smiles: lastSingle.smiles,
      pubchem: lastSingle.pubchem, descriptors: lastSingle.rdkit.desc,
      inchi: lastSingle.rdkit.inchi, inchikey: lastSingle.rdkit.inchikey,
      reactive_groups: (lastSingle.rdkit.groups || []).map(g => ({ name: g.name, severity: g.severity })),
      ionizable_groups: (lastSingle.rdkit.acidbase || []).map(g => ({ name: g.name, type: g.type, pka: g.pka })),
      drug_alerts: {
        pains: (lastSingle.rdkit.pains || []).map(g => g.name),
        brenk: (lastSingle.rdkit.brenk || []).map(g => g.name),
      },
      spectral: (function () {
        const iso = Predict.isotopePattern(lastSingle.rdkit.formula, lastSingle.rdkit.desc.exactmw);
        if (!iso) return null;
        return {
          formula: iso.formula, exactMass: iso.exactMass, nominalMass: iso.nominalMass,
          dbe: iso.dbe, molecularIon: iso.molecularIon, isotopePeaks: iso.peaks,
        };
      })(),
      toxicity: (function () {
        const t = lastSingle.toxicity;
        if (!t || !t.parsed) return null;
        return {
          total: t.total, severe: t.severe,
          byCategory: {
            genotoxic: (t.byCat.genotoxic || []).map(a => ({ name: a.name, severity: a.severity, count: a.count })),
            herg: (t.byCat.herg || []).map(a => ({ name: a.name, severity: a.severity, count: a.count })),
            sensitization: (t.byCat.sensitization || []).map(a => ({ name: a.name, severity: a.severity, count: a.count })),
            cyp: (t.byCat.cyp || []).map(a => ({ name: a.name, severity: a.severity, count: a.count })),
          },
        };
      })(),
      leadLikeness: lastSingle.pred.lead,
      saltTautomer: (function () {
        const f = lastSingle.form;
        if (!f || !f.ok) return null;
        return {
          isSalt: f.isSalt, components: f.components,
          counterions: (f.counterions || []).map(c => ({ name: c.name, count: c.count })),
          tautomerSites: (f.tautomers || []).map(t => ({ name: t.name, count: t.count })),
        };
      })(),
      prediction: lastSingle.pred,
    };
    download('chemprop_single.json', JSON.stringify(out, null, 2), 'application/json');
  }



    /* ---------- 关于 ---------- */
  function renderAbout() {
    els.aboutContent.innerHTML = `
      <p>本平台将三类资源组合，对化合物（尤其原料药及工艺中间体）的理化性质与 ADME 类药性进行预测：</p>
      <ul>
        <li><b>PubChem PUG-REST</b>（NCBI）：由名称/CAS/SMILES/InChI 解析 CID，并获取分子量、XLogP、TPSA、HBD/HBA、可旋转键、分子式与 2D 结构图等实验/计算数据。<code>https://pubchem.ncbi.nlm.nih.gov/rest/pug</code></li>
        <li><b>RDKit（WASM 本地运行）</b>：开源化学信息学库 <code>rdkit/rdkit</code>，在浏览器内本地计算 Crippen logP、TPSA、Lipinski HBD/HBA、可旋转键、芳香环、sp³ 比例、精确分子量、2D 结构 SVG 与 InChIKey。<b>已内置 wasm 的 base64 内嵌（<code>RDKit_minimal.wasm.b64.js</code>），无论 http 服务器、<code>file://</code> 双击还是预览环境均可完全离线预测；仅当内嵌文件缺失时才回退 CDN（需联网）。</b></li>
        <li><b>SwissADME 风格规则</b>：基于公开文献的 Lipinski / Veber / Egan / Muegge / Ghose 规则，生物利用度评分、BBB 透过、GI 吸收、合成可及性（近似），以及 BCS 分类预估（溶解度×渗透性）。</li>
        <li><b>水溶解度预测（QSAR）</b>：ESOL（Delaney 2004）与 Ali 2012（model 3）两种 logS 模型，给出 logS、mg/mL、mol/L 与 SwissADME 溶解度分级；并以 Henderson-Hasselbalch 方程对检出的可电离基团（羧酸/酚/胺等，pKa 取经验值）做 pH 依赖溶解度估算。SILICOS-IT 为片段贡献法，需 FILTER-IT 片段库，纯前端无法复现（可在 swissadme.ch 查询）。</li>
        <li><b>热力学与几何 / 键参数（SolProp_ML 框架 + RDKit 几何）</b>：基于综合 logS 反推溶剂化自由能 ΔG_solv，并经验估算焓 ΔH_solv、熵 ΔS_solv 与 Abraham 溶剂化参数（E/S/A/B/L/V）及分配系数 logK / logK_aq；同时由 RDKit 原子坐标与共价半径、平均键解离能（BDE）表估算各键的键长 / 键能，并由配位数推断原子杂化与理想键角。全部为前端经验估算，非实验值；精确结构请以 X 射线单晶 / 计算化学为准。</li>
        <li><b>化学友好性筛查</b>：常用 PAINS / Brenk 结构警示子集（非完整过滤库），用于快速识别可能干扰活性或成药性的高频结构。</li>
        <li><b>毒性 / 基因毒性结构警示</b>：基于一组结构警示 SMARTS 子集，对化合物做 <b>基因毒性（ICH M7 框架：亚硝胺、环氧化物、烷化卤/磺酸酯、肼、重氮、芳香胺/硝基等）、hERG 心脏毒性、皮肤致敏（hapten）、CYP 代谢/抑制</b>四类子结构筛查，并汇总高风险类数。对基因毒性杂质评估（ICH M7）与工艺安全有提示意义，但仅为结构粗筛，不能替代正式毒理/致突变研究（Ames、微核、ICH M7 评估等）。</li>
        <li><b>类药性进阶（先导优化 / 片段规则）</b>：在口服成药性规则之外，给出 GSK 4/400、Pfizer 3/75、Golden Triangle（Johnson 2009）、Rule of Three（Ro3）等先导物优化与片段筛选规则，判断化合物是否落在「易优化」的化学空间。</li>
        <li><b>盐型 / 互变异构提示</b>：基于 SMILES 多组分（含「.」）与无机抗衡离子 SMARTS 识别盐型 / 成盐形式，并列出检出的抗衡离子；同时基于酰胺、酮-烯醇、亚胺、杂芳环 NH、内酰胺、硝基等常见敏感基团的 SMARTS 给出互变异构提示。盐型会改变分子量、logP、溶解度与 pKa，建议同时评估游离 API；互变异构影响 pKa/logP/溶解度，建议以实验/数据库确认主型。</li>
        <li><b>3D 构象交互查看器</b>：优先并行拉取 PubChem 3D 记录与 NCI/CADD Cactus 3D 的真实三维坐标；无真实 3D 时回退到 PubChem / RDKit 2D → 伪 3D 投影。以自包含 Canvas 渲染器实现拖拽旋转、滚轮缩放、隐藏/显示氢原子等交互；真实分子存在多构象，此处仅为一种近似。伪 3D 非力场构象，仅用于观察空间排布。</li>
        <li><b>警示结构可点击高亮</b>：在毒性/基因毒性筛查卡片中，点击下方任一警示项，即可在上方结构查看器中以红色高亮其匹配的子结构（基于 RDKit 子结构匹配与 SVG 高亮），便于直观定位风险基团。</li>
        <li><b>谱图与固态表征</b>：可本地计算的参数包括分子式、精确质量（单同位素）、标称质量、不饱和度（DBE）与 EI-MS 同位素峰型（天然丰度卷积估算），以及预测分子离子 M⁺；实际 ¹H NMR / ¹³C NMR / IR / MS 四大谱图与 API 的晶型（多晶型）、DSC、TGA 等固态数据，通过外部权威免费数据库/专利/文献入口查询——<b>SDBS</b>（AIST，覆盖 IR/MS/¹H/¹³C NMR/Raman）、<b>NIST WebBook</b>（IR/MS/UV）、<b>MassBank</b>（MS/MS）、<b>PubChem 谱图</b>、<b>SpectraBase</b>（Wiley，IR/MS/NMR/Raman）；API 固态：<b>COD</b>（开放晶体结构库）、<b>CCDC/WebCSD</b>、<b>PubChem 3D 构象</b>、<b>Google Patents</b>（晶型/多晶型、DSC/TGA 专利）、<b>Google Scholar</b> 文献检索。这些是跳转式外部查询，实测算图/热分析需实验测定或检索文献、结晶工艺专利与监管审评资料。</li>
        <li><b>SpectraBase</b>（Wiley）：免费谱图数据库，覆盖 IR、MS、NMR、Raman 等实验谱图。本站点以<b>外部查询链接</b>方式整合，点击在新标签按化合物名称检索相关谱图记录。</li>
        <li><b>ChemAxon Chemicalize</b>：免费网页版可手动查询 pKa / logP / logD / 溶解度 / IUPAC 命名。<b>其 Chemicalize Pro（API 与可嵌入组件）已于 2025-12-31 退役，且页面禁止 iframe 嵌入、无公开免费 API</b>，故仅以外部链接形式整合，无法在本站直接拉取数据。</li>
      </ul>
      <p><b>相关开源项目（GitHub / 工具）：</b></p>
      <ul>
        <li>RDKit — <code>github.com/rdkit/rdkit</code>（化学信息学核心库，本站点 WASM 来源）</li>
        <li>SwissADME — <code>swissadme.ch</code>（类药性在线预测，本规则的方法学参考）</li>
        <li>DeepChem — <code>github.com/deepchem/deepchem</code>（机器学习分子属性预测）</li>
        <li>Chemprop — <code>github.com/chemprop/chemprop</code>（基于消息传递神经网络的物化/活性预测）</li>
        <li>SolProp_ML — <code>github.com/fhvermei/SolProp_ML</code>（有机化合物水溶解度机器学习预测模型）</li>
        <li>solu — <code>github.com/garyzhang1006/solu</code>（化合物溶解度预测开源项目）</li>
        <li>Open Babel — <code>github.com/openbabel/openbabel</code>（格式转换与描述符）</li>
        <li>MolVS — <code>github.com/mcs07/MolVS</code>（分子标准化与校验）</li>
        <li>swissadme-web — <code>github.com/narwhalacademy/swissadme-web</code>（SwissADME 的 Web 复刻参考）</li>
      </ul>
      <p style="color:#5b6776;font-size:12.5px">说明：本工具性质预测为<b>计算/规则近似</b>，合成可及性与 BBB/GI 为经验模型估计，仅供研发参考，不构成监管申报或临床依据。基因毒性相关官能团提示仅基于结构警示，需以正式毒理/致突变研究为准。</p>
    `;
  }

  /* ---------- ⑦ 查询历史统计面板 ---------- */
  function openStats() {
    const total = queryHistory.length;
    if (!total) { setStatus('暂无查询历史，无法统计。', 'warn'); return; }
    // 最常查 Top
    const byInput = {};
    queryHistory.forEach(h => { const k = h.name || h.input; byInput[k] = (byInput[k] || 0) + (h.count || 1); });
    const top = Object.entries(byInput).sort((a, b) => b[1] - a[1]).slice(0, 8);
    // 类型分布
    const byType = {};
    queryHistory.forEach(h => { const t = h.type || 'auto'; byType[t] = (byType[t] || 0) + 1; });
    const typeLabel = { smiles: 'SMILES', name: '名称', cas: 'CAS', inchi: 'InChI', auto: '自动' };
    // 角色分布
    const byRole = {};
    queryHistory.forEach(h => { const r = h.role || 'unknown'; byRole[r] = (byRole[r] || 0) + 1; });
    const roleLabel = { intermediate: '中间体', api: '原料药', impurity: '杂质', reagent: '试剂', unknown: '未指定' };
    // 分子量分布（近 30 条）
    const mws = queryHistory.slice(0, 30).filter(h => h.mw != null).map(h => +h.mw);
    const avgMw = mws.length ? (mws.reduce((a, b) => a + b, 0) / mws.length).toFixed(0) : '—';
    const totalQueries = queryHistory.reduce((s, h) => s + (h.count || 1), 0);
    const modal = document.createElement('div');
    modal.className = 'stats-modal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:200;display:flex;align-items:flex-start;justify-content:center;padding:48px 16px;';
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
    const box = document.createElement('div');
    box.className = 'stats-box';
    box.style.cssText = 'background:var(--panel,#fff);border:1px solid var(--line,#e3e8ef);border-radius:16px;max-width:560px;width:100%;max-height:82vh;overflow:auto;padding:22px;box-shadow:0 20px 60px rgba(15,23,42,.25);';
    const bar = (label, v, max) => `<div class="row-note" style="margin:2px 0"><span style="display:inline-block;width:120px">${label}</span><span style="display:inline-block;height:10px;width:${Math.max(2, v / max * 150)}px;background:var(--brand,#2563eb);border-radius:4px;vertical-align:middle"></span> <b>${v}</b></div>`;
    const maxT = Math.max(1, ...Object.values(byType));
    const maxR = Math.max(1, ...Object.values(byRole));
    box.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
        <div class="card-title" style="margin:0;border:none;padding:0" data-i18n="statsTitle">📊 查询历史统计</div>
        <button class="btn btn-sm btn-ghost" data-close="1" type="button" data-i18n="statsClose">关闭 ✕</button>
      </div>
      <div class="stats-kpis" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(100px,1fr));gap:10px;margin-bottom:16px">
        <div class="stat"><div class="stat-label" data-i18n="statsRecords">历史记录</div><div class="stat-value">${total}</div></div>
        <div class="stat"><div class="stat-label" data-i18n="statsQueries">累计查询次数</div><div class="stat-value">${totalQueries}</div></div>
        <div class="stat"><div class="stat-label" data-i18n="statsAvgMw">平均 MW</div><div class="stat-value">${avgMw}</div></div>
      </div>
      <div class="sub-title">${T('statsTop')} ${top.length}）</div>
      ${top.map(([n, c]) => `<div class="row-note" style="margin:3px 0"><span style="font-weight:600">${escapeHtml(n)}</span> <span class="badge badge-src-rd">×${c}</span></div>`).join('')}
      <div class="sub-title" style="margin-top:14px" data-i18n="statsTypeDist">输入类型分布</div>
      ${Object.entries(byType).sort((a,b)=>b[1]-a[1]).map(([t,c]) => bar(typeLabel[t] || t, c, maxT)).join('')}
      <div class="sub-title" style="margin-top:14px" data-i18n="statsRoleDist">化合物角色分布</div>
      ${Object.entries(byRole).sort((a,b)=>b[1]-a[1]).map(([r,c]) => bar(roleLabel[r] || r, c, maxR)).join('')}
      <div class="row-note" style="margin-top:14px">${T('statsLocal')} ${HISTORY_MAX} 条，点击历史条目可一键重查）。</div>`;
    box.querySelector('[data-close]').addEventListener('click', () => modal.remove());
    modal.appendChild(box);
    document.body.appendChild(modal);
    applyI18nDom();
  }

  /* ---------- ⑦b 化学知识库 / CAS→SMILES 自进化管理面板 ---------- */
  async function openKb() {
    if (!window.CAS_KB) { setStatus('化学知识库模块未加载。', 'err'); return; }
    const KB = window.CAS_KB;
    const stats = await KB.getStats();
    const info = await KB.getCacheInfo();
    const fail = await KB.getFail();
    const srcLabel = { seed: '种子库', cache: '本地缓存', wikidata: 'Wikidata', pubchem: 'PubChem', cactus: 'Cactus NCI', opsin: 'OPSIN' };
    const roleLabel = { api: '原料药', intermediate: '中间体', impurity: '杂质', reagent: '试剂', ref: '参照', unknown: '未指定' };
    const totalReq = stats.totalResolved + stats.totalFailed;
    const rate = totalReq ? Math.round(stats.totalResolved / totalReq * 100) : 100;

    const modal = document.createElement('div');
    modal.className = 'stats-modal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:200;display:flex;align-items:flex-start;justify-content:center;padding:48px 16px;';
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
    const box = document.createElement('div');
    box.className = 'stats-box';
    box.style.cssText = 'background:var(--panel,#fff);border:1px solid var(--line,#e3e8ef);border-radius:16px;max-width:640px;width:100%;max-height:86vh;overflow:auto;padding:22px;box-shadow:0 20px 60px rgba(15,23,42,.25);';

    const srcBars = Object.keys(stats.sources).map(k => {
      const s = stats.sources[k];
      const tot = s.ok + s.fail;
      const pct = tot ? Math.round(s.ok / tot * 100) : (s.ok ? 100 : 0);
      const w = Math.max(2, Math.round(pct / 100 * 150));
      return `<div class="row-note" style="margin:3px 0"><span style="display:inline-block;width:110px">${srcLabel[k] || k}</span><span style="display:inline-block;height:10px;width:${w}px;background:var(--brand,#2563eb);border-radius:4px;vertical-align:middle"></span> <b>${pct}%</b> <span class="badge badge-src-rd">${s.ok}/${tot}</span></div>`;
    }).join('');

    const failRows = fail.length ? fail.map((f, i) =>
      `<div class="kb-fail-row" style="display:flex;gap:6px;align-items:center;margin:4px 0">
         <code style="flex:0 0 auto;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(f.q)}</code>
         <input class="kb-smiles-input" data-idx="${i}" placeholder="${T('kbAddPlaceholder')}" style="flex:1;min-width:80px;padding:3px 6px;border:1px solid var(--line,#e3e8ef);border-radius:6px;font-size:12px" />
         <button class="btn btn-sm btn-primary kb-add-btn" data-idx="${i}" type="button">${T('kbAddBtn')}</button>
       </div>`).join('')
      : `<div class="row-note" style="margin:6px 0">${T('kbEmptyFail')}</div>`;

    box.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
        <div class="card-title" style="margin:0;border:none;padding:0" data-i18n="kbTitle">🧠 化学知识库</div>
        <button class="btn btn-sm btn-ghost" data-close="1" type="button" data-i18n="kbClose">关闭 ✕</button>
      </div>
      <div class="stats-kpis" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(100px,1fr));gap:10px;margin-bottom:14px">
        <div class="stat"><div class="stat-label" data-i18n="kbKpiCache">本地缓存</div><div class="stat-value">${info.count}</div></div>
        <div class="stat"><div class="stat-label" data-i18n="kbKpiResolved">解析成功</div><div class="stat-value">${stats.totalResolved}</div></div>
        <div class="stat"><div class="stat-label" data-i18n="kbKpiSuccessRate">成功率</div><div class="stat-value">${rate}%</div></div>
        <div class="stat"><div class="stat-label" data-i18n="kbKpiSeed">种子库</div><div class="stat-value">${info.seeds}</div></div>
      </div>
      <div class="sub-title" data-i18n="kbSectionSeed">📦 项目专属种子库</div>
      <div class="row-note">${T('kbSeedInfo').replace('{n}', info.seeds)}</div>
      <div class="sub-title" style="margin-top:12px" data-i18n="kbSectionSrc">📡 在线源成功率</div>
      ${srcBars}
      <div class="sub-title" style="margin-top:12px" data-i18n="kbSectionFail">🚧 自进化失败队列</div>
      ${failRows}
      <div class="sub-title" style="margin-top:12px" data-i18n="kbSectionIO">⬆ 导入 / ⬇ 导出</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-sm btn-ghost" id="kbExportBtn" type="button">${T('kbExport')}</button>
        <button class="btn btn-sm btn-ghost" id="kbImportBtn" type="button">${T('kbImport')}</button>
        <input type="file" id="kbImportFile" accept="application/json" style="display:none" />
      </div>
      <div class="row-note" style="margin-top:12px;color:var(--muted,#64748b)">${T('kbLearnNote')}</div>`;
    box.querySelector('[data-close]').addEventListener('click', () => modal.remove());

    box.querySelectorAll('.kb-add-btn').forEach(btn => btn.addEventListener('click', async () => {
      const idx = +btn.getAttribute('data-idx');
      const inp = box.querySelector('.kb-smiles-input[data-idx="' + idx + '"]');
      const smi = inp.value.trim();
      if (!smi) { setStatus('请先粘贴 SMILES。', 'warn'); return; }
      const ok = await KB.addManual(fail[idx].q, smi, 'unknown');
      if (ok) { setStatus('已加入知识库，下次该标识将离线命中。', 'ok'); openKbRefresh(modal); }
      else setStatus('SMILES 校验未通过，请检查格式。', 'err');
    }));

    const kbExport = box.querySelector('#kbExportBtn');
    if (kbExport) kbExport.addEventListener('click', async () => {
      const data = await KB.exportJSON();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'chemprop-kb-cache.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });
    const kbImport = box.querySelector('#kbImportBtn');
    const kbFile = box.querySelector('#kbImportFile');
    if (kbImport && kbFile) kbImport.addEventListener('click', () => kbFile.click());
    if (kbFile) kbFile.addEventListener('change', async () => {
      const f = kbFile.files && kbFile.files[0];
      if (!f) return;
      try {
        const txt = await f.text();
        const obj = JSON.parse(txt);
        const n = await KB.importJSON(obj.cache || obj);
        setStatus('已导入 ' + n + ' 条缓存。', 'ok');
        openKbRefresh(modal);
      } catch (e) { setStatus('导入失败：' + e.message, 'err'); }
    });

    modal.appendChild(box);
    document.body.appendChild(modal);
    applyI18nDom();
  }
  // 关闭旧面板并以最新数据重绘
  function openKbRefresh() {
    document.querySelectorAll('.stats-modal').forEach(m => m.remove());
    openKb();
  }

  /* ---------- ⑧ 英文界面切换（轻量 i18n：统一 data-i18n + T()） ---------- */
  const LABELS = {
    // 顶部 / 输入区
    brand: { zh: '化合物理化性质预测平台', en: 'Chem Property Predictor' },
    subtitle: { zh: 'PubChem · RDKit (WASM) · SwissADME 规则 — 面向原料药与中间体研发', en: 'PubChem · RDKit (WASM) · SwissADME rules — for API & intermediate R&D' },
    inputType: { zh: '输入类型', en: 'Input type' },
    inputTypeAuto: { zh: '自动识别', en: 'Auto' },
    inputTypeName: { zh: '化合物名称', en: 'Compound name' },
    inputTypeCas: { zh: 'CAS 号', en: 'CAS' },
    inputTypeInchi: { zh: 'InChI', en: 'InChI' },
    role: { zh: '化合物角色', en: 'Compound role' },
    roleIntermediate: { zh: '中间体', en: 'Intermediate' },
    roleApi: { zh: '原料药 (API)', en: 'API' },
    roleImpurity: { zh: '杂质', en: 'Impurity' },
    roleReagent: { zh: '试剂', en: 'Reagent' },
    roleUnknown: { zh: '未指定', en: 'Unspecified' },
    roleAuto: { zh: '已自动识别', en: 'Auto-identified' },
    roleManual: { zh: '已手动指定', en: 'Manually set' },
    roleUnknownHint: { zh: '无法确定角色，请在下拉框手动选择', en: 'Cannot auto-determine role; please select manually' },
    thRoleCol: { zh: '角色', en: 'Role' },
    compoundInput: { zh: '化合物标识（支持 SMILES / 名称 / CAS / InChI）', en: 'Compound identifier (SMILES / name / CAS / InChI)' },
    compoundInputPh: { zh: '例如：CC(=O)Oc1ccccc1C(=O)O（阿司匹林）；SMILES / 名称 / CAS / InChI 均可，输入自动联想', en: 'e.g. CC(=O)Oc1ccccc1C(=O)O (aspirin); SMILES / name / CAS / InChI; auto-suggest on input' },
    suggestHint: { zh: '💡 输入时自动联想常用简称 / 通用名 / 官方名：↓↑ 选择，Enter 或 Tab 填入，Esc 关闭', en: '💡 Auto-suggest common abbreviations / generic / official names while typing: ↓↑ select, Enter or Tab to fill, Esc to close' },
    ocrBtn: { zh: '🖼 上传图片识别为 SMILES', en: '🖼 Image → SMILES' },
    predictBtn: { zh: '🔍 预测性质', en: '🔍 Predict' },
    batchBtn: { zh: '📊 批量模式', en: '📊 Batch' },
    clearBtn: { zh: '清空', en: 'Clear' },
    statsBtn: { zh: '📊 统计', en: '📊 Stats' },
    aboutBtn: { zh: 'ℹ️ 说明', en: 'ℹ️ Info' },
    darkBtn: { zh: '🌙 暗色', en: '🌙 Dark' },
    darkAuto: { zh: '跟随系统', en: 'Auto' },
    darkLight: { zh: '浅色', en: 'Light' },
    darkDark: { zh: '暗色', en: 'Dark' },
    darkToggleTitle: { zh: '主题：自动跟随系统 / 浅色 / 暗色（点击切换）', en: 'Theme: follow system / light / dark (click to switch)' },
    inputCardTitle: { zh: '化合物输入', en: 'Compound Input' },
    tabTextInput: { zh: '文本输入', en: 'Text Input' },
    tabDrawInput: { zh: '结构绘制', en: 'Structure Drawing' },
    tabImageInput: { zh: '图片识别', en: 'Image Recognition' },
    imageDropText: { zh: '点击 / 拖拽 / Ctrl+V 粘贴', en: 'Click / Drag / Ctrl+V to paste' },
    imageDropSub: { zh: '结构式图片 → SMILES · PNG/JPG', en: 'Structure image → SMILES · PNG/JPG' },
    imageOcrRunBtn: { zh: 'AI 识别结构', en: 'AI Recognize Structure' },
    localOcrUrlLabel: { zh: '本地 OCR 服务地址（推荐）', en: 'Local OCR server URL (recommended)' },
    localOcrTest: { zh: '检测', en: 'Test' },
    localOcrInstall: { zh: '🚀 一键安装并启动本地服务', en: '🚀 One-click install local server' },
    localOcrHint: { zh: '💡 在线 OCR 服务目前不稳定。使用本机 OCR 服务可离线识别、数据不出内网，且成功率最高。', en: '💡 Online OCR services are currently unstable. Use a local OCR server for offline, in-house recognition with the highest success rate.' },
    historyTitle: { zh: '🕘 查询历史', en: '🕘 History' },
    historyExpand: { zh: '📂 展开历史', en: '📂 Expand' },
    historyExport: { zh: '⬇ 导出', en: '⬇ Export' },
    historyClear: { zh: '清空', en: 'Clear' },
    historyToggle: { zh: '收起', en: 'Collapse' },
    historyEmpty: { zh: '暂无查询记录。每次预测完成后，这里会按时间倒序保存最近查询，点击可一键重现（刷新页面也不会丢）。', en: 'No query history yet. After each prediction, recent queries are saved here (newest first); click to replay (persists across reloads).' },
    // 结果卡片标题
    ctStruct: { zh: '结构式与身份信息', en: 'Structure & Identity' },
    ctProps: { zh: '理化性质（预测 / 计算）', en: 'Physicochemical Properties' },
    ctForm: { zh: '盐型 / 互变异构提示', en: 'Salt Form / Tautomer Hints' },
    ctSol: { zh: '水溶解度预测（QSAR 模型）', en: 'Aqueous Solubility (QSAR)' },
    ctThermo: { zh: '热力学与几何 / 键参数', en: 'Thermodynamics & Geometry' },
    ctConf: { zh: '3D 构象交互查看', en: '3D Conformer Viewer' },
    ctTox: { zh: '毒性 / 基因毒性结构警示', en: 'Toxicity / Genotoxicity Warnings' },
    ctSpectra: { zh: '谱图与固态表征（四大谱图 / 晶型·DSC·TGA）', en: 'Spectra & Solid-State' },
    ctAdme: { zh: 'ADME 与类药性规则（SwissADME 风格）', en: 'ADME & Drug-likeness Rules' },
    ctRadar: { zh: '类药性雷达图', en: 'Drug-likeness Radar' },
    ctLead: { zh: '类药性进阶（先导优化 / 片段规则）', en: 'Advanced Drug-likeness' },
    ctOrgSolub: { zh: '有机溶剂溶解度预测', en: 'Organic Solubility Prediction' },
    ctGsePh: { zh: 'GSE pH–溶解度曲线', en: 'GSE pH–Solubility Curve' },
    ctBufferCap: { zh: '缓冲容量计算', en: 'Buffer Capacity β' },
    ctPhSpec: { zh: 'pH 质量标准评估', en: 'pH Specification Eval' },
    // 结果区目录引导
    tocTitle: { zh: '目录', en: 'Contents' },
    tocOverview: { zh: '结果概览', en: 'Overview' },
    tocIdentity: { zh: '结构式与身份', en: 'Structure & Identity' },
    tocProps: { zh: '理化性质', en: 'Physicochemical' },
    tocForm: { zh: '盐型 / 互变异构', en: 'Salt / Tautomer' },
    tocSolubility: { zh: '水溶解度', en: 'Solubility' },
    tocThermo: { zh: '热力学与几何', en: 'Thermo & Geometry' },
    tocConformer: { zh: '3D 构象', en: '3D Conformer' },
    tocTox: { zh: '毒性警示', en: 'Toxicity' },
    tocSpectra: { zh: '谱图与固态表征', en: 'Spectra & Solid-state' },
    tocAdme: { zh: 'ADME 与类药性', en: 'ADME & Drug-likeness' },
    tocRadar: { zh: '类药性雷达图', en: 'Radar Chart' },
    tocMedchem: { zh: '类药性进阶', en: 'Lead Optimization' },
    tocOrgSolub: { zh: '有机溶剂溶解度', en: 'Organic Solubility' },
    tocGsePh: { zh: 'GSE pH–溶解度', en: 'GSE pH–Solubility' },
    tocBufferCap: { zh: '缓冲容量 β', en: 'Buffer Capacity β' },
    tocPhSpec: { zh: 'pH 质量标准', en: 'pH Spec Eval' },
    tocAdvConf: { zh: '可信度评分', en: 'Confidence' },
    tocAdvSpec: { zh: '种态分布', en: 'Speciation' },
    tocAdvEsol: { zh: 'ESOL 贡献分解', en: 'ESOL Decomp' },
    tocAdvM7: { zh: 'ICH M7 杂质', en: 'ICH M7' },
    tocAdvSalt: { zh: '盐型/晶型+BCS', en: 'Salt/Form+BCS' },
    tocAdvHansen: { zh: 'Hansen 参数', en: 'Hansen' },
    tocAdvTemp: { zh: '温度依赖溶解度', en: 'Temp-Solubility' },
    tocAdvSol: { zh: 'pH–表观溶解度分布', en: 'pH-Solubility Dist' },
    tocAdvGreen: { zh: '绿色化学评分', en: 'Green Score' },
    tocAdvExc: { zh: '辅料兼容性', en: 'Excipients' },
    tocAdvRetro: { zh: '逆合成提示', en: 'Retro Hints' },
    tocAdvKey: { zh: '关键/传输物性', en: 'Key/Transport' },
    tocAdvQM: { zh: '电子结构(近似)', en: 'Electronic' },
    tocToolkit: { zh: '研发工具箱', en: 'R&D Toolkit' },
    howtoread: { zh: '怎么读', en: 'How to read' },
    moduleSummary: { zh: '这里汇总该模块的读数要点；详见各子表与说明。', en: 'Key reading notes for this module; see sub-tables and notes for details.' },
    exportCsv: { zh: '⬇ 导出 CSV', en: '⬇ Export CSV' },
    exportJson: { zh: '⬇ 导出 JSON', en: '⬇ Export JSON' },
    printBtn: { zh: '🖨 打印', en: '🖨 Print' },
    extRowLabel: { zh: '外部数据库查询：', en: 'External DB query:' },
    extNote: { zh: '在新标签打开；SpectraBase 为 Wiley 免费谱图库（IR/MS/NMR/Raman），Chemicalize 免费网页版可手动补全', en: 'Opens in a new tab; SpectraBase is Wiley free spectra library (IR/MS/NMR/Raman), Chemicalize free web edition for manual lookup' },
    toolkitTitle: { zh: '🧪 工艺与法规研发工具箱', en: '🧪 Process & Regulatory Toolkit' },
    toolkitToggle: { zh: '📂 展开 ▼', en: '📂 Expand ▼' },
    toolkitIntro: { zh: '面向原料药工艺研发的辅助计算工具（基因毒性限度、pKa 物种分布、路线成本/评估、溶剂绿色化、盐型筛选、NMR 估算、多化合物对比、结构式构建、工艺路线成本）。全部为前端启发式估算，仅供研发参考，非监管用途。', en: 'Auxiliary calculators for API process R&D (genotoxic limit, pKa species distribution, route cost/assessment, solvent greenness, salt screening, NMR estimation, multi-compound compare, structure builder, process route cost). All front-end heuristic estimates for R&D reference only, not for regulatory use.' },
    batchTitle: { zh: '批量预测结果', en: 'Batch Results' },
    batchExportCsv: { zh: '⬇ 导出全部 CSV', en: '⬇ Export all CSV' },
    dataSources: { zh: '数据来源与开源项目', en: 'Data Sources & Open Source' },
    // hero 一键工具
    favBtn: { zh: '⭐ 收藏', en: '⭐ Favorite' },
    shareBtn: { zh: '🔗 复制分享链接', en: '🔗 Copy Share Link' },
    toolsetSummary: { zh: '🔧 一键工具 ▼', en: '🔧 Tools ▼' },
    toolGenotox: { zh: '⚡ 基因毒性限度', en: '⚡ Genotox Limit' },
    toolLogd: { zh: '📈 logD–pH 曲线', en: '📈 logD–pH Curve' },
    toolImpSpec: { zh: '📋 杂质谱追踪表', en: '📋 Impurity Spec' },
    toolNmr: { zh: '🧬 NMR 估算', en: '🧬 NMR Est.' },
    toolCompare: { zh: '🔍 加入对比', en: '🔍 Compare' },
    toolLabReport: { zh: '📑 小试报告', en: '📑 Lab Report' },
    toolRouteCost: { zh: '💰 工艺路线成本', en: '💰 Route Cost' },
    // not-found
    nfTitle: { zh: '未能在 PubChem / Cactus 自动识别该化合物', en: 'Could not auto-identify this compound in PubChem / Cactus' },
    nfNote: { zh: '若数据库页面上有 SMILES / InChI / MOL 文件，可复制 SMILES 后直接预测；我们也欢迎把该化合物补充进本地词库。', en: 'If the database page has a SMILES / InChI / MOL file, copy the SMILES and predict directly; we also welcome adding this compound to the local dictionary.' },
    nfTipCas: { zh: 'PubChem 与 Cactus 均未返回该 CAS 的结构。请尝试在以下数据库核对 CAS，获取 SMILES 后粘贴到输入框进行本地预测。', en: 'Neither PubChem nor Cactus returned a structure for this CAS. Verify the CAS in the databases below, then paste the SMILES for local prediction.' },
    nfTip: { zh: '自动解析未能识别该{type}。请尝试在以下数据库核对，获取 SMILES 后粘贴到输入框进行本地预测。', en: 'Auto-parsing could not recognize this {type}. Verify in the databases below, then paste the SMILES for local prediction.' },
    // 统计面板
    statsTitle: { zh: '📊 查询历史统计', en: '📊 Query Stats' },
    statsClose: { zh: '关闭 ✕', en: 'Close ✕' },
    statsRecords: { zh: '历史记录', en: 'Records' },
    statsQueries: { zh: '累计查询次数', en: 'Total queries' },
    statsAvgMw: { zh: '平均 MW', en: 'Avg MW' },
    statsTop: { zh: '最常查化合物（Top', en: 'Top compounds (Top' },
    statsTypeDist: { zh: '输入类型分布', en: 'Input type distribution' },
    statsRoleDist: { zh: '化合物角色分布', en: 'Compound role distribution' },
    statsLocal: { zh: '历史保存在浏览器本地（最多', en: 'History is saved locally in your browser (max' },
    // 3D 构象
    confReset: { zh: '↺ 复位视角', en: '↺ Reset view' },
    confToggleH: { zh: '隐藏 H', en: 'Hide H' },
    confShowH: { zh: '显示 H', en: 'Show H' },
    confMeasure: { zh: '📏 测量键长', en: '📏 Measure' },
    confPng: { zh: '⬇ 导出PNG', en: '⬇ Export PNG' },
    confNext: { zh: '下一构象 ▶', en: 'Next ▶' },
    confOverlay: { zh: '叠加显示', en: 'Overlay' },
    confMeasureHint: { zh: '点击「测量键长」后，依次点选两个原子即可读取其间距（基于当前构象坐标，单位为 Å）。', en: 'After clicking "Measure", select two atoms in turn to read their distance (based on current conformer coordinates, in Å).' },
    confNote: { zh: '拖拽旋转 · 滚轮缩放；CPK 元素配色，白色小球为氢原子。', en: 'Drag to rotate · scroll to zoom; CPK element colors, white balls are hydrogens.' },
    // 通用 verdict / 等级
    verdictPass: { zh: '达标', en: 'Pass' },
    verdictFail: { zh: '未达标', en: 'Fail' },
    // 结果子标题（render 内）
    subIdentityLinks: { zh: '化合物身份识别（多数据库搜索）', en: 'Compound identity (multi-DB search)' },
    subIonGroup: { zh: '电离基团与 pKa（官能团经验估算）', en: 'Ionizable groups & pKa (group estimates)' },
    subDerived: { zh: '派生酸碱参数（由 pKa 与 logP 计算）', en: 'Derived acid-base parameters (from pKa & logP)' },
    subSpectraCalc: { zh: '可计算谱图参数（RDKit 本地预测）', en: 'Computable spectral parameters (RDKit)' },
    subEIMS: { zh: 'EI-MS 同位素峰型（天然丰度卷积估算，相对最强峰 %）', en: 'EI-MS isotope pattern (natural abundance, % of base peak)' },
    subThermoSolv: { zh: '溶剂化热力学（ΔG / ΔH / ΔS，由 logS 反推）', en: 'Solvation thermodynamics (ΔG / ΔH / ΔS from logS)' },
    subAbraham: { zh: 'Abraham 溶剂化参数（经验映射）', en: 'Abraham solvation parameters' },
    subLogK: { zh: '分配系数（logK）', en: 'Partition coefficients (logK)' },
    subBondLen: { zh: '键长 / 键能（共价半径与平均 BDE 估算）', en: 'Bond length / energy (covalent radius & avg BDE)' },
    subHybrid: { zh: '原子杂化与理想几何（按配位数估计）', en: 'Atomic hybridization & ideal geometry' },
    subBondAngle: { zh: '键角（坐标计算，仅作参考）', en: 'Bond angles (from coordinates, reference only)' },
    subTautSites: { zh: '互变异构敏感位点（提示）', en: 'Tautomer-sensitive sites' },
    subSaltViz: { zh: '常见盐型可视化（示意）', en: 'Common salt forms (illustrative)' },
    subTautViz: { zh: '互变异构可视化（通用示意）', en: 'Tautomer visualization (generic)' },
    subPH: { zh: 'pH 依赖溶解度（估算）', en: 'pH-dependent solubility (estimate)' },
    subFourSpectra: { zh: '四大谱图（IR / MS / NMR / Raman）直达链接', en: 'Four spectra (IR / MS / NMR / Raman) links' },
    subXRD: { zh: '晶体结构 / XRD 直达链接', en: 'Crystal structure / XRD links' },
    subThermal: { zh: '热分析 TGA / DSC（固态表征，主要见于专利与文献）', en: 'Thermal analysis TGA / DSC (solid-state)' },
    subImpurity: { zh: '结构警示 / 潜在杂质评估表（ICH M7 参考草稿）', en: 'Structural alerts / potential impurity table (ICH M7 draft)' },
    subChemFriendly: { zh: '化学友好性（PAINS / Brenk 警示子集）', en: 'Chemical friendliness (PAINS / Brenk subset)' },
    subLead: { zh: '类药性进阶规则（先导优化 / 片段筛选）', en: 'Advanced drug-likeness rules' },
    radarLegend: { zh: '轴值越高越“类药”（MW/logP/TPSA/HBD/HBA/RotB 的归一化得分，1=理想）', en: 'Higher axis = more drug-like (normalized scores of MW/logP/TPSA/HBD/HBA/RotB, 1=ideal)' },
    // 表格表头
    thName: { zh: '名称', en: 'Name' },
    thRole: { zh: '化合物角色', en: 'Role' },
    thCAS: { zh: 'CAS 登记号', en: 'CAS RN' },
    thFormula: { zh: '分子式', en: 'Formula' },
    thSmiles: { zh: 'Canonical SMILES', en: 'Canonical SMILES' },
    thInChI: { zh: 'InChI', en: 'InChI' },
    thInChIKey: { zh: 'InChIKey', en: 'InChIKey' },
    thCID: { zh: 'PubChem CID', en: 'PubChem CID' },
    thSource: { zh: '数据来源', en: 'Source' },
    thMultiRef: { zh: '多库引用', en: 'Cross-refs' },
    thReactive: { zh: '警示官能团', en: 'Reactive groups' },
    // 结果子标题 / 分组标题（render 内）
    confMeasureMode: { zh: '测量模式：依次点选两个原子…', en: 'Measure mode: select two atoms in turn…' },
    pg0: { zh: '分子量与元素', en: 'Molecular weight & elements' },
    pg1: { zh: '亲脂性 (Lipophilicity)', en: 'Lipophilicity' },
    pg2: { zh: '极性 / 氢键', en: 'Polarity / H-bonds' },
    pg3: { zh: '空间与柔性', en: 'Sterics & flexibility' },
    pg4: { zh: '其他结构参数', en: 'Other structural parameters' },
    toxGenotox: { zh: '基因毒性警示（ICH M7 框架）', en: 'Genotoxicity alerts (ICH M7)' },
    toxHerg: { zh: 'hERG 心脏毒性（粗筛）', en: 'hERG cardiotoxicity (screen)' },
    toxSens: { zh: '皮肤致敏（hapten）', en: 'Skin sensitization (hapten)' },
    toxCyp: { zh: 'CYP 代谢 / 抑制（粗筛）', en: 'CYP metabolism / inhibition (screen)' },
    // 表格表头（render 内）
    thIonGroup: { zh: '电离基团', en: 'Ionizable group' },
    thType: { zh: '类型', en: 'Type' },
    thPka: { zh: 'pKa（估算）', en: 'pKa (est.)' },
    thCount: { zh: '数量', en: 'Count' },
    thModel: { zh: '模型', en: 'Model' },
    thLogS: { zh: 'logS (mol/L)', en: 'logS (mol/L)' },
    thMgml: { zh: '溶解度 (mg/mL)', en: 'Solubility (mg/mL)' },
    thMolL: { zh: '溶解度 (mol/L)', en: 'Solubility (mol/L)' },
    thCls: { zh: '溶解度等级', en: 'Solubility class' },
    thConsensus: { zh: '综合参考', en: 'Consensus' },
    thPH: { zh: 'pH', en: 'pH' },
    thAppSol: { zh: '表观溶解度 (mg/mL)', en: 'Apparent sol. (mg/mL)' },
    thForm: { zh: '主要存在形态', en: 'Predominant form' },
    thKey: { zh: '键', en: 'Bond' },
    thBondType: { zh: '类型', en: 'Type' },
    thBondLen: { zh: '估算键长 (Å)', en: 'Est. length (Å)' },
    thBondEnergy: { zh: '估算键能 (kJ/mol)', en: 'Est. energy (kJ/mol)' },
    thAtom: { zh: '原子', en: 'Atom' },
    thElement: { zh: '元素', en: 'Element' },
    thCoord: { zh: '配位数', en: 'Coordination' },
    thHyb: { zh: '杂化估计', en: 'Hybridization' },
    thIdealAngle: { zh: '理想键角', en: 'Ideal angle' },
    thAngle: { zh: '角', en: 'Angle' },
    thDeg: { zh: '度数 (°)', en: 'Degrees (°)' },
    thPeak: { zh: '峰', en: 'Peak' },
    thMz: { zh: 'm/z (标称)', en: 'm/z (nominal)' },
    thRelInt: { zh: '相对强度', en: 'Rel. intensity' },
    thRule: { zh: '规则', en: 'Rule' },
    thVerdict: { zh: '结论', en: 'Verdict' },
    sevHigh: { zh: '高风险', en: 'High risk' },
    sevMed: { zh: '中风险', en: 'Medium risk' },
    sevLow: { zh: '低风险', en: 'Low risk' },
    noReactive: { zh: '未检出高活性 / 警示官能团。', en: 'No high-activity / alert functional groups detected.' },
    // 谱图可视化 / 几何 / 毒性 / ADME / 批量 等子标题与按钮
    pkaVizTitle: { zh: '电离基团 pKa 可视化（横轴 pH 0–14，标记位置 = 基团 pKa）', en: 'Ionizable-group pKa visualization (x-axis pH 0–14; marker position = group pKa)' },
    pkaVizLegend: { zh: '酸（pH > pKa 去质子化）  碱（pH < pKa 质子化）', en: 'Acid (deprotonated when pH > pKa)   Base (protonated when pH < pKa)' },
    subCounterions: { zh: '检出的抗衡离子 / 组分', en: 'Detected counterions / components' },
    toxHighlight: { zh: '警示结构高亮查看器', en: 'Structural-alert highlighter' },
    toxReset: { zh: '复位结构图', en: 'Reset structure' },
    toxActiveOrig: { zh: '当前高亮：', en: 'Current highlight: ' },
    toxOrigStruct: { zh: '原始结构', en: 'Original structure' },
    solGauge: { zh: '溶解度等级标尺', en: 'Solubility tier scale' },
    admeSummary: { zh: '综合 ADME 估计', en: 'Combined ADME estimate' },
    admeBio: { zh: '生物利用度评分', en: 'Bioavailability score' },
    admeBBB: { zh: '血脑屏障透过', en: 'BBB permeability' },
    admeGI: { zh: '胃肠道吸收', en: 'GI absorption' },
    admeSA: { zh: '合成可及性', en: 'Synthetic accessibility' },
    bcsTitle: { zh: 'BCS 分类预估：', en: 'BCS class estimate: ' },
    bcsSolHi: { zh: '高', en: 'high' },
    bcsSolLo: { zh: '低', en: 'low' },
    bcsPermHi: { zh: '高', en: 'high' },
    bcsPermLo: { zh: '低', en: 'low' },
    noteFour: { zh: '结构确证通常指 ¹H NMR、¹³C NMR、IR（FT-IR）、MS 四大谱；UV/Vis、Raman 可作补充。', en: 'Structure confirmation typically uses the four spectra ¹H NMR, ¹³C NMR, IR (FT-IR), MS; UV/Vis and Raman are supplementary.' },
    noteXRD: { zh: '晶型（多晶型）与晶体结构多源自结晶工艺专利、FDA/EMA 审评资料与 COD 开放库。', en: 'Polymorphs and crystal structures mostly come from crystallization patents, FDA/EMA reviews, and the COD open database.' },
    noteThermal: { zh: 'TGA/DSC 曲线多为期刊/专利实测数据，目前无统一免费谱库；以下为按本化合物预填的专利与文献检索入口，落地结果页即可查看相关报道。', en: 'TGA/DSC curves are mostly experimental data from journals/patents; no unified free library exists. Below are prefilled patent & literature search entries for this compound.' },
    noteExt: { zh: '直达 = 直接打开该化合物在数据库中的记录页；检索 = 已按名称/CAS 预填的搜索（落地结果页，无需手动输入）。', en: '"Direct" = opens the compound record page in the database; "Search" = prefilled search by name/CAS (landing on results, no manual input).' },
    // 批量表头与按钮
    thIdx: { zh: '#', en: '#' },
    thNameIn: { zh: '名称/输入', en: 'Name/Input' },
    thSmilesShort: { zh: 'SMILES', en: 'SMILES' },
    thMW: { zh: 'MW', en: 'MW' },
    thLogP: { zh: 'logP', en: 'logP' },
    thTPSA: { zh: 'TPSA', en: 'TPSA' },
    thHBD: { zh: 'HBD', en: 'HBD' },
    thHBA: { zh: 'HBA', en: 'HBA' },
    thRotB: { zh: 'RotB', en: 'RotB' },
    thLipViol: { zh: 'Lipinski违例', en: 'Lipinski viol.' },
    thBBB: { zh: 'BBB', en: 'BBB' },
    thGI: { zh: 'GI吸收', en: 'GI abs.' },
    thBio: { zh: '生物利用度', en: 'Bioavail.' },
    thToxTotal: { zh: '基因毒性类数', en: 'Genotox. classes' },
    thToxSevere: { zh: '高风险数', en: 'High-risk #' },
    thGroups: { zh: '警示官能团', en: 'Alert groups' },
    thOp: { zh: '操作', en: 'Action' },
    batchRetry: { zh: '重试', en: 'Retry' },
    batchRecalc: { zh: '重算', en: 'Recalc' },
    batchCSV: { zh: 'CSV', en: 'CSV' },
    batchFail: { zh: '失败：', en: 'Failed: ' },
    // 杂质表头
    thImpAlert: { zh: '警示结构/杂质', en: 'Alert/impurity' },
    thImpCat: { zh: '类别', en: 'Category' },
    thImpSev: { zh: '严重度', en: 'Severity' },
    thImpSrc: { zh: '来源推测', en: 'Likely source' },
    thImpSmiles: { zh: 'SMILES(父)', en: 'SMILES (parent)' },
    thImpCount: { zh: '检出次数', en: 'Hits' },
    thImpLimit: { zh: '控制限度建议', en: 'Limit suggestion' },
    thImpNote: { zh: '警示说明', en: 'Note' },
    phNoIon: { zh: '未检出可电离基团，溶解度不随 pH 显著变化。', en: 'No ionizable groups detected; solubility does not change significantly with pH.' },
    subGeoBonds: { zh: '键长 / 键能 / 键角', en: 'Bond length / energy / angle' },
    // 化学知识库（CAS→SMILES 自进化）
    kbTitle: { zh: '🧠 化学知识库（CAS→SMILES 自进化）', en: '🧠 Chemical Knowledge Base' },
    kbClose: { zh: '关闭 ✕', en: 'Close ✕' },
    kbKpiCache: { zh: '本地缓存条目', en: 'Cache entries' },
    kbKpiResolved: { zh: '累计解析成功', en: 'Total resolved' },
    kbKpiSuccessRate: { zh: '综合成功率', en: 'Overall success' },
    kbKpiSeed: { zh: '项目种子库', en: 'Project seed DB' },
    kbSectionSeed: { zh: '📦 项目专属种子库（离线优先）', en: '📦 Project seed DB (offline-first)' },
    kbSectionCache: { zh: '💾 持久缓存（跨会话命中）', en: '💾 Persistent cache' },
    kbSectionSrc: { zh: '📡 在线源成功率（学习闭环，按成功率动态排序）', en: '📡 Online source success (learning loop)' },
    kbSectionFail: { zh: '🚧 自进化失败队列（人工补齐 SMILES 即进缓存）', en: '🚧 Self-evolving fail queue' },
    kbSectionIO: { zh: '⬆ 导入 / ⬇ 导出', en: '⬆ Import / ⬇ Export' },
    kbSeedInfo: { zh: '已打包 {n} 个管线品种 / 关键杂质 / 常用参照，离线即可命中，彻底规避“偶发识别不了”。', en: 'Bundled {n} pipeline compounds / key impurities / references; resolved offline to avoid intermittent failures.' },
    kbAddSmiles: { zh: '补充 SMILES', en: 'Add SMILES' },
    kbAddPlaceholder: { zh: '粘贴该化合物的 SMILES', en: 'Paste the compound SMILES' },
    kbAddBtn: { zh: '加入知识库', en: 'Add to KB' },
    kbExport: { zh: '⬇ 导出缓存 JSON', en: '⬇ Export cache JSON' },
    kbImport: { zh: '⬆ 导入 JSON', en: '⬆ Import JSON' },
    kbRole: { zh: '角色', en: 'Role' },
    kbSource: { zh: '来源', en: 'Source' },
    kbEmptyFail: { zh: '暂无失败记录，所有查询均已成功解析 🎉', en: 'No failures recorded; all queries resolved 🎉' },
    kbLearnNote: { zh: '每次成功解析都会写入本地缓存并被成功率统计计入；失败则进入队列，由你人工补齐——用得越多越准，且弱网/离线也可命中。', en: 'Every successful resolution is cached and counted; failures enter the queue for manual completion — the more you use it, the smarter it gets, and it works offline / on weak networks.' },
    nfQueueNote: { zh: '该标识已记入「🧠 知识库」的自进化失败队列；可在知识库中手动补充其 SMILES 以便下次离线命中。', en: 'This identifier has been logged to the self-evolving fail queue in the Knowledge Base; add its SMILES there to resolve it offline next time.' },
  };
  // 保留 i18n 骨架但固定为中文（不再提供语言切换按钮）
  const currentLang = 'zh';
  function T(key) { const e = LABELS[key]; if (!e) return key; return e.zh; }
  function sevLabel(s) { return s === 'high' ? T('sevHigh') : s === 'medium' ? T('sevMed') : T('sevLow'); }
  function applyI18nDom() {
    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      const k = el.getAttribute('data-i18n');
      if (!k || !LABELS[k]) return;
      el.textContent = T(k);
    });
    document.querySelectorAll('[data-i18n-ph]').forEach(function (el) {
      const k = el.getAttribute('data-i18n-ph');
      if (!k || !LABELS[k]) return;
      el.setAttribute('placeholder', T(k));
    });
  }

  /* ---------- 引擎状态 ---------- */
  function updateEngineStatus() {
    const hasJS = typeof window.initRDKitModule === 'function';
    const src = RDKitEngine.source; // '' 未加载 | 'local' 离线 | 'cdn' 联网
    if (src === 'local') {
      els.engineStatus.textContent = '✓ 本地引擎（离线可用）';
      els.engineStatus.className = 'badge badge-ok';
      els.engineStatus.title = 'RDKit WASM 已从本地 assets/rdkit/ 加载，无需联网即可预测。';
    } else if (src === 'cdn') {
      els.engineStatus.textContent = '⚠ CDN 引擎（需联网）';
      els.engineStatus.className = 'badge badge-warn';
      els.engineStatus.title = '本地 wasm 未能加载（常见原因：file:// 协议限制，或当前预览服务器未放行 .wasm 文件），已自动回退 CDN。';
    } else if (hasJS) {
      els.engineStatus.textContent = '本地 JS 已就绪，WASM 待加载';
      els.engineStatus.className = 'badge badge-neutral';
      els.engineStatus.title = 'RDKit JS 已加载，首次预测时会加载 WASM。';
    } else {
      els.engineStatus.textContent = '引擎：待加载（将按需从 CDN 获取）';
      els.engineStatus.className = 'badge badge-neutral';
      els.engineStatus.title = 'RDKit 引擎尚未加载。';
    }
  }

  /* ---------- 外部数据库查询（新标签打开，规避密钥暴露与 CORS） ---------- */
  function externalQuery() {
    if (!lastSingle) return null;
    const d = lastSingle;
    const name = (d.pubchem && (d.pubchem.iupac || d.pubchem.title)) ? (d.pubchem.iupac || d.pubchem.title) : '';
    return { name: name || d.input, smiles: d.smiles };
  }
  function openExternal(provider) {
    if (!lastSingle) { setStatus('请先完成一次预测，再使用外部数据库查询。', 'err'); return; }
    const q = externalQuery();
    let url = '';
    if (provider === 'chemspider') {
      url = 'https://www.chemspider.com/Search.aspx?q=' + encodeURIComponent(q.name || q.smiles);
    } else if (provider === 'chemicalize') {
      url = 'https://chemicalize.com/#/calculation?smiles=' + encodeURIComponent(q.smiles);
    }
    if (url) window.open(url, '_blank', 'noopener');
  }

  /* ---------- 化合物身份识别：多专业数据库搜索 ---------- */
  function openIdentitySearch(provider) {
    if (!lastSingle) { setStatus('请先完成一次预测，再使用数据库搜索。', 'err'); return; }
    const pc = lastSingle.pubchem;
    const rd = lastSingle.rdkit;
    const name = (pc && (pc.iupac || pc.title)) ? (pc.iupac || pc.title) : lastSingle.input;
    const cas = (pc && pc.cas) || (lastSingle.type === 'cas' ? lastSingle.input : '');
    const smiles = lastSingle.smiles || '';
    const inchiKey = (rd && rd.inchikey) || '';
    const cid = (pc && pc.cid) || '';
    let url = '';
    if (provider === 'chemspider') {
      // ChemSpider 整个域名已被 CloudFront 403 封锁；改用 SpectraBase（Wiley 免费谱图库）
      url = 'https://spectrabase.com/search?q=' + encodeURIComponent(name);
    } else if (provider === 'chembl') {
      // ChEMBL 生物活性：按名称/InChIKey 搜索
      const q = inchiKey || name;
      url = 'https://www.ebi.ac.uk/chembl/g/#search_results/all/query=' + encodeURIComponent(q);
    } else if (provider === 'drugbank') {
      // DrugBank 药物信息：按名称/CAS/SMILES 搜索
      const q = name || cas || smiles;
      url = 'https://go.drugbank.com/unearth/q?searcher=drugs&query=' + encodeURIComponent(q);
    } else if (provider === 'drugcentral') {
      // DrugCentral 适应症/靶点：按名称搜索（主页 query 参数为可用入口）
      url = 'https://drugcentral.org/?query=' + encodeURIComponent(name);
    } else if (provider === 'zinc') {
      // ZINC15 可购买性/铅样：按 SMILES 结构搜索
      url = 'https://zinc.docking.org/substances/search?query-structure=' + encodeURIComponent(smiles);
    } else if (provider === 'chebi') {
      // ChEBI 生物语境：按名称搜索（advancedSearchForward 为有效入口）
      url = 'https://www.ebi.ac.uk/chebi/advancedSearchForward.do?searchString=' + encodeURIComponent(name);
    } else if (provider === 'wiki') {
      // Wikipedia 通用：按名称搜索
      url = 'https://en.wikipedia.org/w/index.php?search=' + encodeURIComponent(name);
    } else if (provider === 'patent') {
      // Google Patents：名称 + 结构关键词
      url = 'https://patents.google.com/?q=' + encodeURIComponent((name + ' ' + smiles).trim());
    } else if (provider === 'scholar') {
      // Google Scholar：按名称 + InChIKey 搜索
      url = 'https://scholar.google.com/scholar?q=' + encodeURIComponent(name + ' ' + inchiKey);
    }
    if (url) window.open(url, '_blank', 'noopener');
  }

  /* ---------- 谱图 / 固态表征：渲染式直达链接（按已解析标识自动构造） ---------- */
  // 单个外链：直达（绿）= 直接打开该化合物在数据库中的记录页；检索（灰）= 已按标识预填的搜索
  function extLink(href, label, tag) {
    const cls = tag === '直达' ? 'badge-ok' : 'badge-neutral';
    return `<a class="btn btn-ghost ext-link" href="${href}" target="_blank" rel="noopener">🔗 ${escapeHtml(label)} <span class="badge ${cls}">${tag}</span></a>`;
  }

  function renderSpectraLinks(data) {
    const pc = data.pubchem, rd = data.rdkit;
    const name = (pc && (pc.iupac || pc.title)) ? (pc.iupac || pc.title) : data.input;
    const cas = (pc && pc.cas) || (data.type === 'cas' ? data.input : '');
    const cid = (pc && pc.cid) || '';
    const formula = (rd && rd.formula) || (pc && pc.formula) || '';
    const inchiKey = (rd && rd.inchikey) || '';
    const qName = encodeURIComponent(name);
    const nistId = cas ? 'C' + cas.replace(/-/g, '') : '';

    // ① 四大谱图（IR / MS / NMR / Raman）
    const spec = [];
    spec.push(cid
      ? extLink(`https://pubchem.ncbi.nlm.nih.gov/compound/${cid}#section=Spectra`, `PubChem 谱图 (CID ${cid})`, '直达')
      : extLink(`https://pubchem.ncbi.nlm.nih.gov/#query=${qName}`, `PubChem 谱图`, '检索'));
    spec.push(nistId
      ? extLink(`https://webbook.nist.gov/cgi/cbook.cgi?ID=${nistId}&Units=SI`, `NIST WebBook (CAS ${cas})`, '直达')
      : extLink(`https://webbook.nist.gov/cgi/cbook.cgi?Name=${qName}&Units=SI`, `NIST WebBook`, '检索'));
    spec.push(extLink(`https://sdbs.db.aist.go.jp/sdbs/cgi-bin/cre_frame_disp.cgi?sdbsno=0&col=1&target=NAME&option=1&text=${qName}`, `SDBS (AIST)`, '检索'));
    spec.push(extLink(`https://massbank.eu/MassBank/Search?type=name&value=${qName}`, `MassBank (MS/MS)`, '检索'));
    spec.push(extLink(`https://spectrabase.com/search?q=${qName}`, `SpectraBase 谱图`, '检索'));

    // ② 晶体结构 / XRD
    const xrd = [];
    xrd.push(formula
      ? extLink(`https://www.crystallography.net/cod/?formula=${encodeURIComponent(formula)}`, `COD 晶体结构库 (${formula})`, '直达')
      : extLink(`https://www.crystallography.net/cod/search`, `COD 晶体结构库`, '检索'));
    xrd.push(cid
      ? extLink(`https://pubchem.ncbi.nlm.nih.gov/compound/${cid}#section=3D-Conformer`, `PubChem 3D 构象 (CID ${cid})`, '直达')
      : extLink(`https://pubchem.ncbi.nlm.nih.gov/#query=${qName}`, `PubChem 3D 构象`, '检索'));
    xrd.push(extLink(`https://www.ccdc.cam.ac.uk/`, `CCDC / WebCSD`, '检索'));

    // ③ 热分析 TGA / DSC（固态表征，主要见于专利与文献）
    const thermal = [];
    thermal.push(extLink(`https://patents.google.com/?q=${encodeURIComponent((name + ' DSC TGA thermogravimetric').trim())}`, `DSC/TGA 专利 (Google Patents)`, '检索'));
    thermal.push(extLink(`https://scholar.google.com/scholar?q=${encodeURIComponent((name + ' crystal form polymorph DSC TGA').trim())}`, `热分析/晶型 文献 (Scholar)`, '检索'));

    let html = '';
    if (cid || cas || formula) {
      const ids = [];
      if (cid) ids.push(`CID ${cid}`);
      if (cas) ids.push(`CAS ${cas}`);
      if (formula) ids.push(`分子式 ${formula}`);
      html += `<div class="row-note" style="margin-top:12px">已解析标识用于精准跳转：<b>${ids.join(' · ')}</b></div>`;
    }
    html += '<div class="sub-title" style="margin-top:12px" data-i18n="subFourSpectra">四大谱图（IR / MS / NMR / Raman）直达链接</div>';
    html += '<div class="row-note" data-i18n="noteFour">结构确证通常指 ¹H NMR、¹³C NMR、IR（FT-IR）、MS 四大谱；UV/Vis、Raman 可作补充。</div>';
    html += `<div class="action-row ext-row">${spec.join('')}</div>`;
    html += '<div class="sub-title" style="margin-top:16px" data-i18n="subXRD">晶体结构 / XRD 直达链接</div>';
    html += '<div class="row-note" data-i18n="noteXRD">晶型（多晶型）与晶体结构多源自结晶工艺专利、FDA/EMA 审评资料与 COD 开放库。</div>';
    html += `<div class="action-row ext-row">${xrd.join('')}</div>`;
    html += '<div class="sub-title" style="margin-top:16px" data-i18n="subThermal">热分析 TGA / DSC（固态表征，主要见于专利与文献）</div>';
    html += '<div class="row-note" data-i18n="noteThermal">TGA/DSC 曲线多为期刊/专利实测数据，目前无统一免费谱库；以下为按本化合物预填的专利与文献检索入口，落地结果页即可查看相关报道。</div>';
    html += `<div class="action-row ext-row">${thermal.join('')}</div>`;
    html += '<div class="row-note" style="margin-top:8px" data-i18n="noteExt"><span class="badge badge-ok">直达</span> = 直接打开该化合物在数据库中的记录页；<span class="badge badge-neutral">检索</span> = 已按名称/CAS 预填的搜索（落地结果页，无需手动输入）。</div>';
    els.spectraLinks.innerHTML = html;
  }

  /* ---------- 化合物联想（输入时自动提示简称/通用名/官方名） ---------- */
  const COMPOUND_DICT = window.COMPOUND_DICT || [];
  let currentMatches = [];
  let activeIndex = 0;
  let suggestOpen = false;

  // 取输入框最后一行作为联想查询（兼容批量多行：只对当前行联想）
  function getQueryLine() {
    const v = els.input.value;
    const lines = v.split('\n');
    return (lines[lines.length - 1] || '').trim();
  }
  // 用 canonical 替换输入框最后一行（多行批量时只改当前行）
  function replaceLastLine(canonical) {
    const v = els.input.value;
    const idx = v.lastIndexOf('\n');
    return idx === -1 ? canonical : v.slice(0, idx + 1) + canonical;
  }
  // 当输入看起来像 SMILES / InChI / CAS 时，不进行名称联想（避免噪声）
  function looksStructured(q) {
    if (/^\d{1,7}-\d{2}-\d$/.test(q)) return true;        // CAS
    if (/^inchi=/i.test(q)) return true;                  // InChI
    if (/[()=[\]@/\\#%]/.test(q)) return true;            // SMILES / InChI 符号
    return false;
  }
  function matchCompounds(q) {
    q = q.trim().toLowerCase();
    if (!q || !COMPOUND_DICT.length) return [];
    const out = [];
    for (const e of COMPOUND_DICT) {
      const hay = [
        { s: (e.c || '').toLowerCase(), kind: '名称' },
        ...(e.ab || []).map(x => ({ s: String(x).toLowerCase(), kind: '简称' })),
        ...(e.cm || []).map(x => ({ s: String(x).toLowerCase(), kind: '通用名' })),
        ...(e.of || []).map(x => ({ s: String(x).toLowerCase(), kind: '官方名' })),
      ];
      let best = null, bestScore = 0;
      for (const h of hay) {
        if (!h.s) continue;
        let score = 0;
        if (h.s === q) score = 100;
        else if (h.s.startsWith(q)) score = 80;
        else if (h.s.includes(q)) score = 60;
        if (score > bestScore) { bestScore = score; best = h; }
      }
      if (best) out.push({ e, primary: best.s, kind: best.kind, score: bestScore });
    }
    out.sort((a, b) => b.score - a.score || a.primary.length - b.primary.length);
    return out.slice(0, 12);
  }
  function hideSuggest() {
    suggestOpen = false;
    if (els.suggestBox) els.suggestBox.classList.add('hidden');
  }
  function renderSuggest(matches) {
    currentMatches = matches;
    activeIndex = 0;
    suggestOpen = true;
    const html = matches.map((m, i) => {
      const e = m.e;
      const kindTag = `<span class="s-kind">${m.kind}</span>`;
      const catTag = e.cat ? `<span class="s-cat">${escapeHtml(e.cat)}</span>` : '';
      return `<div class="suggest-item${i === 0 ? ' active' : ''}" data-i="${i}">
        <span class="s-primary">${escapeHtml(m.primary)}</span>
        ${kindTag}
        <span class="s-canon">${escapeHtml(e.c)}</span>
        ${catTag}
      </div>`;
    }).join('');
    els.suggestBox.innerHTML = html;
    els.suggestBox.classList.remove('hidden');
  }
  function updateActive() {
    const items = els.suggestBox.querySelectorAll('.suggest-item');
    items.forEach((it, i) => it.classList.toggle('active', i === activeIndex));
    if (items[activeIndex]) items[activeIndex].scrollIntoView({ block: 'nearest' });
  }
  function selectCompound(m) {
    const e = m.e;
    els.input.value = replaceLastLine(e.c);
    // 选中的是名称类词条，强制以名称（或自动识别）提交，避免沿用用户此前手动选的 SMILES/CAS 类型导致解析失败
    let newType = e.t || 'name';
    if (!els.inputType.querySelector(`option[value="${newType}"]`)) newType = 'auto';
    els.inputType.value = newType;
    hideSuggest();
    els.input.focus();
    // 单行输入时自动预测；批量（多行）仅填入，避免误触发单条计算
    if (els.input.value.indexOf('\n') === -1) runSingle();
  }
  function onSuggestInput() {
    const q = getQueryLine();
    if (!q || looksStructured(q)) { hideSuggest(); return; }
    const matches = matchCompounds(q);
    if (!matches.length) { hideSuggest(); return; }
    renderSuggest(matches);
  }
  function onSuggestKey(e) {
    if (!suggestOpen) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); activeIndex = (activeIndex + 1) % currentMatches.length; updateActive(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); activeIndex = (activeIndex - 1 + currentMatches.length) % currentMatches.length; updateActive(); }
    else if (e.key === 'Enter' || e.key === 'Tab') {
      if (currentMatches.length) { e.preventDefault(); selectCompound(currentMatches[activeIndex]); }
    }
    else if (e.key === 'Escape') { hideSuggest(); }
  }

  /* ===================================================================
   * 研发辅助工具模块：杂质评估表 / 成本速算 / 词库自助导入
   * =================================================================== */

  /* ---------- 1. 杂质评估表（基于检出警示结构，Excel 双 Sheet） ---------- */
  const CAT_LABEL = { genotoxic: '基因毒性', herg: 'hERG心脏毒性', sensitization: '皮肤致敏', cyp: 'CYP代谢' };
  function buildImpurityRows(data) {
    const t = data.toxicity;
    const pc = data.pubchem;
    const name = (pc && (pc.iupac || pc.title)) ? (pc.iupac || pc.title) : data.input;
    const cas = (pc && pc.cas) || (data.type === 'cas' ? data.input : '');
    const cid = (pc && pc.cid) ? pc.cid : '';
    const base = { name, cas, cid, smiles: data.smiles || '' };
    if (!t || !t.parsed || !t.all.length) return { base, rows: [] };
    const rows = t.all.map((a, i) => {
      const cats = (a.cats || []).map(c => CAT_LABEL[c] || c).join('/');
      const sev = a.severity === 'high' ? '高风险' : a.severity === 'medium' ? '中风险' : '低风险';
      const limit = (a.cats || []).indexOf('genotoxic') !== -1
        ? (a.severity === 'high' ? '按 ICH M7 评估（关注队列/Class 1–2，TTC 1.5 µg/天，ppm 需结合日剂量）' : '按 ICH M7 评估（TTC 1.5 µg/天，ppm 需结合日剂量）')
        : '结合工艺与剂量评估控制限度';
      const searchUrl = 'https://www.google.com/search?q=' + encodeURIComponent((a.name) + ' ' + (cas || name));
      return {
        idx: i + 1,
        alert: a.name,
        cats, sev,
        src: '结构警示（潜在工艺/降解杂质）',
        smiles: base.smiles,
        count: a.count,
        limit,
        note: a.note || '',
        link: searchUrl,
      };
    });
    return { base, rows };
  }
  function renderImpurity(data) {
    if (!els.impurityPanel) return;
    const { base, rows } = buildImpurityRows(data);
    if (data.toxicity && data.toxicity.parsed && rows.length) {
      const headKeys = ['thIdx', 'thImpAlert', 'thImpCat', 'thImpSev', 'thImpSrc', 'thImpSmiles', 'thImpCount', 'thImpLimit', 'thImpNote'];
      const headLabels = ['#', '警示结构/杂质', '类别', '严重度', '来源推测', 'SMILES(父)', '检出次数', '控制限度建议', '警示说明'];
      const headMap = { '警示结构/杂质': 'alert', '类别': 'cats', '严重度': 'sev', '来源推测': 'src', 'SMILES(父)': 'smiles', '检出次数': 'count', '控制限度建议': 'limit', '警示说明': 'note' };
      const body = rows.map(r => `<tr>${headLabels.slice(1).map(k => {
        const v = r[headMap[k]];
        return `<td>${escapeHtml(String(v))}</td>`;
      }).join('')}</tr>`).join('');
      els.impurityPanel.innerHTML = `<div class="sub-title" style="margin-top:14px" data-i18n="subImpurity">结构警示 / 潜在杂质评估表（ICH M7 参考草稿）</div>
        <div class="row-note">基于当前分子检出的警示结构生成；每一行为一个潜在杂质/结构关注点。限度列为<b>模板建议</b>，正式限度需结合日剂量与 ICH M7 决策树确定。点击右上「导出杂质评估表」可下载 Excel（QS-1 限度 / API 明细 双 Sheet）。</div>
        <div class="table-wrap"><table class="impurity-table"><thead><tr>${headKeys.slice(1).map(h => `<th data-i18n="${h}">${T(h)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></div>`;
      els.impurityPanel.classList.remove('hidden');
    } else {
      els.impurityPanel.innerHTML = '';
      els.impurityPanel.classList.add('hidden');
    }
  }
  function exportImpurityXLSX(data) {
    if (typeof XLSX === 'undefined') { setStatus('Excel 组件未加载，无法导出。', 'err'); return; }
    const { base, rows } = buildImpurityRows(data);
    if (!rows.length) { setStatus('当前分子未检出警示结构，无需生成杂质评估表。', 'warn'); return; }
    const wb = XLSX.utils.book_new();
    // Sheet 1: QS-1 限度评估
    const qsHead = ['序号', '杂质/警示结构', '类别', '严重度', '来源推测', 'SMILES(父)', '检出次数', '控制限度建议(ppm)', '依据/备注'];
    const qsRows = rows.map(r => [r.idx, r.alert, r.cats, r.sev, r.src, r.smiles, r.count, r.limit, r.note]);
    const qsInfo = [
      ['化合物', base.name],
      ['CAS', base.cas || ''],
      ['PubChem CID', base.cid || ''],
      ['SMILES', base.smiles || ''],
      ['生成时间', new Date().toLocaleString('zh-CN')],
      ['说明', '本表为结构警示/潜在杂质评估草稿（ICH M7 参考），限度需结合日剂量与正式毒理评估确定。'],
    ];
    const qsAoa = qsInfo.concat([[''], qsHead], qsRows);
    const ws1 = XLSX.utils.aoa_to_sheet(qsAoa);
    ws1['!cols'] = [{ wch: 6 }, { wch: 22 }, { wch: 18 }, { wch: 10 }, { wch: 20 }, { wch: 30 }, { wch: 8 }, { wch: 36 }, { wch: 40 }];
    XLSX.utils.book_append_sheet(wb, ws1, 'QS-1 限度');
    // Sheet 2: API 杂质明细
    const apiHead = ['序号', '杂质/警示结构', '类别', '严重度', 'SMILES(父)', '警示说明', '关联检索'];
    const apiRows = rows.map(r => [r.idx, r.alert, r.cats, r.sev, r.smiles, r.note, r.link]);
    const ws2 = XLSX.utils.aoa_to_sheet([apiHead].concat(apiRows));
    ws2['!cols'] = [{ wch: 6 }, { wch: 22 }, { wch: 18 }, { wch: 10 }, { wch: 30 }, { wch: 50 }, { wch: 40 }];
    XLSX.utils.book_append_sheet(wb, ws2, 'API 杂质明细');
    const safe = (base.name || 'compound').replace(/[\\/:*?"<>|]/g, '_');
    XLSX.writeFile(wb, `杂质评估_${safe}.xlsx`);
    setStatus('已导出杂质评估表（QS-1 限度 / API 杂质明细 双 Sheet）。', 'ok');
  }

  /* ---------- 3. 本地词库自助导入（含管理：列表 / 单条删除） ---------- */
  const USERDICT_KEY = 'chemprop_userdict_v1';
  let BUILTIN_DICT = null;       // 内置词条快照（用于安全清空而不误删内置）
  let userDictStore = [];        // 用户导入词条（持久化主体）
  function loadUserDict() {
    if (!window.COMPOUND_DICT) window.COMPOUND_DICT = [];
    if (BUILTIN_DICT === null) BUILTIN_DICT = window.COMPOUND_DICT.slice(); // 仅首次捕获内置
    try {
      const raw = localStorage.getItem(USERDICT_KEY);
      if (raw) { const arr = JSON.parse(raw); if (Array.isArray(arr)) userDictStore = arr; }
    } catch (e) { userDictStore = []; }
    userDictStore.forEach(e => { if (e && e.c) window.COMPOUND_DICT.push(e); });
  }
  function persistUserDict() {
    try { localStorage.setItem(USERDICT_KEY, JSON.stringify(userDictStore)); } catch (e) {}
  }
  function matchEntry(a, b) { return a && b && a.c === b.c && (a.s || '') === (b.s || '') && (a.cas || '') === (b.cas || ''); }
  function mergeUserDict(entries, save) {
    const dict = (typeof window !== 'undefined' && window.COMPOUND_DICT) ? window.COMPOUND_DICT : (window.COMPOUND_DICT = []);
    let added = 0;
    for (const e of entries) {
      if (!e || !e.c) continue;
      dict.push(e); userDictStore.push(e); added++;
    }
    if (save) persistUserDict();
    renderDictList();
    return added;
  }
  function renderDictList() {
    const box = document.getElementById('dictList');
    if (!box) return;
    if (!userDictStore.length) { box.innerHTML = '<div class="row-note" style="margin:6px 0">尚未导入任何词条。</div>'; return; }
    box.innerHTML = '<div class="row-note" style="margin:6px 0">已导入 ' + userDictStore.length + ' 条（点击 × 单条删除）：</div>' +
      '<div class="dict-list">' + userDictStore.map((e, i) => {
        const names = [].concat(e.cm || [], e.of || [], e.ab || []).filter(Boolean).join('、');
        return `<div class="dict-item"><span class="dict-name">${escapeHtml(e.c)}</span>` +
          (e.s ? `<code class="dict-smiles">${escapeHtml(e.s)}</code>` : '') +
          (e.cas ? `<span class="badge badge-neutral">CAS ${escapeHtml(e.cas)}</span>` : '') +
          (names ? `<span class="row-note">别名：${escapeHtml(names)}</span>` : '') +
          `<button class="btn btn-sm btn-ghost dict-del" data-i="${i}" type="button" title="删除该词条">×</button></div>`;
      }).join('') + '</div>';
  }
  function splitList(s) { return (s || '').split(/[,;，；]/).map(x => x.trim()).filter(Boolean); }
  function normalizeDictRow(obj) {
    const o = {};
    if (obj.c != null) o.c = String(obj.c).trim();
    if (obj.s != null) o.s = String(obj.s).trim();
    if (obj.cas != null) o.cas = String(obj.cas).trim();
    if (!o.c && !o.s && !o.cas) return null;
    if (obj.cm != null) o.cm = splitList(obj.cm);
    if (obj.of != null) o.of = splitList(obj.of);
    if (obj.ab != null) o.ab = splitList(obj.ab);
    if (obj.cas_alt != null) o.cas_alt = splitList(obj.cas_alt);
    if (obj.cat != null) o.cat = String(obj.cat).trim();
    return o;
  }
  function parseDictFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      const isCsv = /\.csv$/i.test(file.name);
      reader.onload = (e) => {
        try {
          let rows = [];
          if (isCsv) {
            const text = e.target.result;
            const lines = text.split(/\r?\n/).filter(l => l.trim().length);
            if (!lines.length) return reject(new Error('文件为空'));
            const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
            for (let i = 1; i < lines.length; i++) {
              const cells = lines[i].split(',');
              const obj = {}; headers.forEach((h, j) => { obj[h] = (cells[j] || '').trim(); });
              rows.push(obj);
            }
          } else {
            const wb = XLSX.read(e.target.result, { type: 'array' });
            const ws = wb.Sheets[wb.SheetNames[0]];
            const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
            if (!aoa.length) return reject(new Error('文件为空'));
            const headers = aoa[0].map(h => String(h).trim().toLowerCase());
            for (let i = 1; i < aoa.length; i++) {
              const cells = aoa[i]; if (!cells || !cells.length) continue;
              const obj = {}; headers.forEach((h, j) => { obj[h] = (cells[j] == null ? '' : String(cells[j])).trim(); });
              rows.push(obj);
            }
          }
          const norm = rows.map(normalizeDictRow).filter(Boolean);
          if (!norm.length) return reject(new Error('未解析到有效条目（需至少含 c / s / cas 之一）'));
          resolve(norm);
        } catch (err) { reject(err); }
      };
      reader.onerror = () => reject(new Error('文件读取失败'));
      if (isCsv) reader.readAsText(file, 'utf-8'); else reader.readAsArrayBuffer(file);
    });
  }
  function initDictImport() {
    if (!els.dictImportBtn || !els.dictFileInput) return;
    els.dictImportBtn.addEventListener('click', async () => {
      const file = els.dictFileInput.files && els.dictFileInput.files[0];
      if (!file) { setStatus('请先选择 CSV / Excel 文件。', 'warn'); return; }
      try {
        const entries = await parseDictFile(file);
        const added = mergeUserDict(entries, true);
        if (els.dictImportStatus) els.dictImportStatus.textContent = `已导入并合并 ${added} 条（共 ${entries.length} 条有效），已本地持久化。`;
        setStatus(`词库导入成功：合并 ${added} 条。`, 'ok');
      } catch (err) {
        if (els.dictImportStatus) els.dictImportStatus.textContent = '导入失败：' + err.message;
        setStatus('词库导入失败：' + err.message, 'err');
      }
    });
    if (els.dictClearBtn) els.dictClearBtn.addEventListener('click', () => {
      try {
        const n = userDictStore.length;
        userDictStore = [];
        window.COMPOUND_DICT = BUILTIN_DICT ? BUILTIN_DICT.slice() : [];
        persistUserDict();
        renderDictList();
        if (els.dictImportStatus) els.dictImportStatus.textContent = `已清空 ${n} 条导入词条。`;
        setStatus('已清空导入的词库。', 'ok');
      } catch (e) {}
    });
    const dictListBox = document.getElementById('dictList');
    if (dictListBox) dictListBox.addEventListener('click', (e) => {
      const b = e.target.closest('.dict-del');
      if (!b) return;
      const i = +b.dataset.i;
      const entry = userDictStore[i];
      userDictStore.splice(i, 1);
      if (entry) {
        const di = window.COMPOUND_DICT.findIndex(d => matchEntry(d, entry));
        if (di >= 0) window.COMPOUND_DICT.splice(di, 1);
      }
      persistUserDict(); renderDictList();
      setStatus('已删除一条导入词条。', 'ok');
    });
    renderDictList();
  }

  /* ---------- 事件绑定 ---------- */
  function init() {
    updateEngineStatus();
    renderAbout();
    loadUserDict(); // 在任意解析前注入用户导入词库
    loadHistory();
    renderHistory();
    initDictImport();
    els.historyClearBtn.addEventListener('click', clearHistory);
    els.historyToggleBtn.addEventListener('click', toggleHistory);
    // 历史区默认折叠：点击"📂 展开历史"展开
    const hExpBtn = $('historyExpandBtn');
    if (hExpBtn) hExpBtn.addEventListener('click', () => {
      const sec = document.getElementById('historySection');
      if (sec) sec.classList.remove('collapsed-history');
      hExpBtn.style.display = 'none';
    });
    const hExpBtn2 = $('historyExportBtn'); if (hExpBtn2) hExpBtn2.addEventListener('click', exportHistoryXLSX);
    els.historyList.addEventListener('click', (e) => {
      const item = e.target.closest('.history-item');
      if (!item) return;
      const id = item.dataset.id;
      const actBtn = e.target.closest('[data-act]');
      if (actBtn) {
        const act = actBtn.dataset.act;
        if (act === 'remove') { removeHistory(id); return; }
        if (act === 'rerun') { rerunHistory(id); return; }
      } else {
        rerunHistory(id);
      }
    });
    // 工具箱 section 折叠
    const ttBtn = $('researchToolsToggleBtn');
    const ttSection = $('researchTools');
    if (ttBtn && ttSection) ttBtn.addEventListener('click', () => {
      const collapsed = ttSection.classList.toggle('collapsed-toolkit');
      ttBtn.textContent = collapsed ? '📂 展开 ▼' : '📁 收起 ▲';
      ttBtn.setAttribute('aria-expanded', String(!collapsed));
    });
    // 示例 chips
    els.exampleChips.innerHTML = (window.EXAMPLES || []).map((e, i) =>
      `<span class="chip" data-i="${i}">${escapeHtml(e.label)}</span>`).join('');
    els.exampleChips.querySelectorAll('.chip').forEach(ch => {
      ch.addEventListener('click', () => {
        const e = window.EXAMPLES[+ch.dataset.i];
        els.input.value = e.input;
        els.inputType.value = e.type;
        runSingle();
      });
    });

    els.predictBtn.addEventListener('click', runSingle);
    els.batchBtn.addEventListener('click', runBatch);
    // ④ Enter 快捷预测：输入框内 Ctrl/Cmd+Enter = 批量；普通 Enter = 单条预测
    els.input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      if (e.ctrlKey || e.metaKey || e.shiftKey) runBatch();
      else runSingle();
    });
    // ⑤ URL 分享：?s=SMILES 或 ?q=名称 自动载入并预测（分享链接一键重现）
    (function handleShareUrl() {
      try {
        const sp = new URLSearchParams(location.search);
        const s = sp.get('s'), q = sp.get('q');
        if (s || q) {
          els.input.value = s || q;
          els.inputType.value = s ? 'smiles' : 'name';
          setTimeout(runSingle, 300);
        }
      } catch (e) {}
    })();
    els.clearBtn.addEventListener('click', () => {
      els.input.value = ''; setStatus('');
      els.resultSection.classList.add('hidden'); els.batchSection.classList.add('hidden');
      lastSingle = null; lastBatch = [];
    });
    // ⑩ 化合物角色联动：手动改下拉框→联动当前结果/历史/缓存；输入/类型变化→即时本地识别建议
    if (els.role) {
      els.role.addEventListener('change', () => {
        const v = els.role.value;
        if (v === 'unknown') { roleAutoLocked = false; updateRoleHint('unknown', null); return; }
        // 手动改下拉框：若当前有结果，联动重渲染身份/概览徽标与历史
        if (lastSingle) {
          setCompoundRole(v, { fromUser: true });
        } else {
          roleAutoLocked = true;
          updateRoleHint('manual', v);
        }
      });
    }
    if (els.input) els.input.addEventListener('input', liveRoleCheck);
    if (els.inputType) els.inputType.addEventListener('change', liveRoleCheck);
    // 收藏成功后给出即时视觉反馈（按钮变「已收藏」并刷新状态栏）
    window.addEventListener('chemprop-fav-added', (e) => {
      const btn = $('favQuickBtn');
      if (btn) {
        const original = btn.getAttribute('data-i18n') === 'favBtn' ? T('favBtn') : btn.textContent;
        btn.textContent = '✓ 已收藏';
        btn.classList.add('fav-added');
        setTimeout(() => {
          btn.textContent = original;
          btn.classList.remove('fav-added');
        }, 2000);
      }
      if (e.detail && e.detail.name) {
        setStatus('已收藏：' + e.detail.name + (e.detail.project ? '（' + e.detail.project + '）' : ''), 'ok');
      }
    });
    // 化合物联想：输入/聚焦时提示，键盘选择，点击填充
    if (els.suggestBox) {
      els.input.addEventListener('input', onSuggestInput);
      els.input.addEventListener('focus', onSuggestInput);
      els.input.addEventListener('keydown', onSuggestKey);
      els.input.addEventListener('blur', () => setTimeout(hideSuggest, 150));
      els.suggestBox.addEventListener('mousedown', (e) => {
        const it = e.target.closest('.suggest-item');
        if (!it) return;
        e.preventDefault(); // 避免 blur 先触发导致点击丢失
        selectCompound(currentMatches[+it.dataset.i]);
      });
    }
    els.exportCsvBtn.addEventListener('click', exportSingleCSV);
    els.exportJsonBtn.addEventListener('click', exportSingleJSON);
    if (els.impurityExportBtn) els.impurityExportBtn.addEventListener('click', () => { if (lastSingle) exportImpurityXLSX(lastSingle); else setStatus('请先完成一次预测，再导出杂质评估表。', 'err'); });
    els.printBtn.addEventListener('click', () => window.print());
    els.chemspiderBtn.addEventListener('click', () => openExternal('chemspider'));
    els.chemicalizeBtn.addEventListener('click', () => openExternal('chemicalize'));
    // 主流程图片识别：上传/拖拽/粘贴图片 → 显示预览 → 点击 AI 识别 → 填入输入框并预测
    const mainOcrStatus = els.mainOcrStatus;
    let lastOcrBlob = null; // 缓存最近一次图片 blob
    let lastOcrDataUrl = null;
    function setActiveInputTab(tab) {
      document.querySelectorAll('.input-tab-btn').forEach(b => {
        const active = b.dataset.tab === tab;
        b.classList.toggle('active', active);
        b.setAttribute('aria-selected', active ? 'true' : 'false');
      });
      document.querySelectorAll('.input-tab-panel').forEach(p => {
        p.classList.toggle('active', p.dataset.panel === tab);
      });
      if (tab === 'draw') { /* 分子结构编辑器已移除，仅保留文本/图片输入 */ }
    }
  function showImagePreview(blob, dataUrl) {
      if (!els.imagePreview) return;
      const name = blob.name || (blob.type === 'image/png' ? 'pasted.png' : 'pasted.jpg');
      els.imagePreview.innerHTML = `
        <img src="${dataUrl}" alt="结构式预览">
        <div class="image-preview-info">
          <div class="file-name">${escapeHtml(name)}</div>
          <div>${(blob.size / 1024).toFixed(1)} KB · 已就绪，点击下方按钮识别</div>
        </div>
        <button class="btn btn-ghost" id="imagePreviewRemove" type="button">移除</button>`;
      els.imagePreview.classList.remove('hidden');
      const rm = $('imagePreviewRemove');
      if (rm) rm.addEventListener('click', clearImagePreview);
      if (els.imageOcrRunBtn) els.imageOcrRunBtn.disabled = false;
    }
    function clearImagePreview() {
      lastOcrBlob = null; lastOcrDataUrl = null;
      if (els.imagePreview) { els.imagePreview.innerHTML = ''; els.imagePreview.classList.add('hidden'); }
      if (els.imageOcrRunBtn) els.imageOcrRunBtn.disabled = true;
      if (mainOcrStatus) mainOcrStatus.textContent = '';
      if (els.mainOcrFile) els.mainOcrFile.value = '';
    }

    function handleImageFile(file) {
      if (!file || !file.type.startsWith('image/')) return;
      lastOcrBlob = file;
      const reader = new FileReader();
      reader.onload = () => { lastOcrDataUrl = reader.result; showImagePreview(file, reader.result); };
      reader.readAsDataURL(file);
    }
    function ocrLoadingHtml(text) {
      return `<div class="ocr-loading"><span class="ocr-spinner" aria-hidden="true"></span><span>${escapeHtml(text || '正在识别…')}</span></div>`;
    }
    function showOcrConfirm(smiles, source) {
      if (!mainOcrStatus) return;
      mainOcrStatus.innerHTML = `
        <div style="background:#eef4ff;border:1px solid #c7d6f7;border-radius:8px;padding:8px 10px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <span class="row-note" style="margin:0;flex:1 1 auto"><b>🖼 识别完成（${escapeHtml(source)}）</b>　预览：<code style="background:#fff;padding:1px 5px;border-radius:3px;border:1px solid #d4d8de">${escapeHtml(smiles)}</code></span>
          <button class="btn btn-sm btn-primary" id="mainOcrConfirm" type="button">✅ 确认使用并预测</button>
          <button class="btn btn-sm btn-ghost" id="mainOcrEdit" type="button">✏ 编辑</button>
          <button class="btn btn-sm btn-ghost" id="mainOcrCancel" type="button">✖ 取消</button>
        </div>`;
      const cf = $('mainOcrConfirm'); if (cf) cf.addEventListener('click', () => {
        els.input.value = smiles;
        setActiveInputTab('text');
        setStatus(`图片识别已应用（${source}），开始预测。`, 'ok');
        if (mainOcrStatus) mainOcrStatus.innerHTML = '<span style="color:#16a34a">✅ 已预测</span>';
        runSingle();
      });
      const ed = $('mainOcrEdit'); if (ed) ed.addEventListener('click', () => {
        const v = window.prompt('请编辑 SMILES（直接修改识别结果）：', smiles);
        if (v && v.trim()) {
          els.input.value = v.trim();
          setActiveInputTab('text');
          setStatus('已应用编辑后的 SMILES，开始预测。', 'ok');
          if (mainOcrStatus) mainOcrStatus.innerHTML = '<span style="color:#16a34a">✅ 已预测（编辑后）</span>';
          runSingle();
        }
      });
      const cn = $('mainOcrCancel'); if (cn) cn.addEventListener('click', () => {
        if (mainOcrStatus) mainOcrStatus.textContent = '已取消图片识别。';
        setStatus('已取消。', 'ok');
      });
    }
    function showOcrToolPicker(details) {
      if (!mainOcrStatus) return;
      let detailHtml = '';
      if (details && details.length) {
        detailHtml = '<div class="ocr-fail-details"><b>后端诊断明细</b>' +
          details.map(d => `<div class="ocr-fail-detail-item"><span class="ocr-fail-source">${escapeHtml(d.source)}</span><span class="ocr-fail-state ${d.result && d.result.ok ? 'ok' : 'bad'}">${d.result && d.result.ok ? '成功' : ('失败 ' + escapeHtml(d.result && d.result.error || ''))}</span></div>`).join('') +
          '</div>';
      }
      const localUrl = getLocalOcrUrl();
      const localTip = localUrl
        ? `<div class="ocr-fail-local-tip">⚠️ 已填写本地地址 <code>${escapeHtml(localUrl)}</code> 但连接失败。请先确认本地服务已启动：解压安装包 → 双击 <code>setup_ocr_server.bat</code> → 看到「本地 OCR 服务已启动」后，再点「检测」。</div>`
        : `<div class="ocr-fail-local-tip">💡 当前走在线 MolScribe / OSRA 兜底，但第三方服务大面积不可用。建议部署<b>本地 OCR 服务</b>：数据不出内网、无需外网、成功率最高。</div>`;
      mainOcrStatus.innerHTML = `
        <div class="ocr-fail-panel">
          <button class="ocr-fail-close" id="ocrFailClose" type="button" title="收起">✕</button>
          <div class="ocr-fail-title">❌ 图片识别未成功</div>
          <div class="ocr-fail-body">已尝试本地服务、MolScribe 镜像池、NCI OSRA，但当前均不可用。在线免费 OCR 服务不稳定，<b>最可靠的方案是在本机运行本地 OCR 服务</b>。</div>
          ${localTip}
          ${detailHtml}
          <div class="ocr-fail-actions">
            <button class="btn btn-sm btn-primary" id="ocrFailInstall" type="button">🚀 一键安装本地服务</button>
            <button class="btn btn-sm btn-secondary" id="ocrFailCopyCmd" type="button">📋 复制手动命令</button>
            <button class="btn btn-sm btn-ghost" id="ocrFailUpload" type="button">📁 重新上传</button>
            <button class="btn btn-sm btn-ghost" id="ocrFailPaste" type="button">重新粘贴</button>
            <button class="btn btn-sm btn-ghost" id="ocrFail30s" type="button">等 30s 重试</button>
            <button class="btn btn-sm btn-ghost" id="ocrFailManual" type="button">✍ 手动输入 SMILES</button>
          </div>
        </div>`;
      const fc = $('ocrFailClose'); if (fc) fc.addEventListener('click', () => { if (mainOcrStatus) mainOcrStatus.innerHTML = '<span class="row-note">已收起识别失败提示。可重新上传/粘贴图片、一键安装本地服务或手动输入 SMILES。</span>'; });
      const fi = $('ocrFailInstall'); if (fi) fi.addEventListener('click', toggleLocalOcrGuide);
      const fcc = $('ocrFailCopyCmd'); if (fcc) fcc.addEventListener('click', copyLocalOcrCmd);
      const f1 = $('ocrFailUpload'); if (f1) f1.addEventListener('click', () => { if (els.mainOcrFile) els.mainOcrFile.click(); });
      const f2 = $('ocrFailPaste'); if (f2) f2.addEventListener('click', () => setStatus('请在图片识别页再次 Ctrl+V 粘贴图片。', 'ok'));
      const f3 = $('ocrFail30s'); if (f3) f3.addEventListener('click', () => { setStatusNote('30s 后自动重试…', 'ok'); setTimeout(() => { if (lastOcrBlob) runMainOcrFromBlob(lastOcrBlob, 'retry'); }, 30000); });
      const f5 = $('ocrFailManual'); if (f5) f5.addEventListener('click', () => {
        const v = window.prompt('请输入该结构的 SMILES：', '');
        if (v && v.trim()) { els.input.value = v.trim(); setActiveInputTab('text'); runSingle(); }
      });
    }
    function getLocalOcrUrl() {
      let url = '';
      try { url = localStorage.getItem('chemprop_local_ocr_url') || ''; } catch (e) {}
      if (!url && els.localOcrUrl) url = els.localOcrUrl.value || '';
      return url.trim();
    }
    function setLocalOcrUrl(url) {
      if (els.localOcrUrl) els.localOcrUrl.value = url;
      try { localStorage.setItem('chemprop_local_ocr_url', url); } catch (e) {}
    }
    // 初始化本地 OCR 地址
    if (els.localOcrUrl) {
      const saved = getLocalOcrUrl();
      if (saved) els.localOcrUrl.value = saved;
    }
    async function testLocalOcr() {
      const url = getLocalOcrUrl();
      if (!url) { setStatus('请先填写本地 OCR 服务地址。', 'warn'); return; }
      if (mainOcrStatus) mainOcrStatus.innerHTML = ocrLoadingHtml('正在检测本地 OCR 服务…');
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 8000);
        const r = await fetch(url.replace(/\/$/, '') + '/health', { signal: ctrl.signal });
        clearTimeout(t);
        if (!r.ok) { if (mainOcrStatus) mainOcrStatus.innerHTML = '❌ 本地服务不可达（HTTP ' + r.status + '）'; return; }
        const j = await r.json().catch(() => null);
        const engines = j ? `MolScribe=${j.MolScribe}, DECIMER=${j.DECIMER}, MolNexTR=${j.MolNexTR}` : '';
        if (mainOcrStatus) mainOcrStatus.innerHTML = '✅ 本地服务正常' + (engines ? '（' + engines + '）' : '');
      } catch (e) {
        const isLocal = /^(http:\/\/localhost|http:\/\/127\.0\.0\.1)/i.test(url);
        const reason = e.name === 'AbortError' ? '连接超时（8s 内无响应）' : (e.message || e);
        const tip = isLocal ? '服务似乎未启动。请在终端运行 <code>python local_ocr_server.py</code>，看到「本地 OCR 服务已启动」后再点「检测」。' : '请检查地址、网络或防火墙。';
        if (mainOcrStatus) mainOcrStatus.innerHTML = `❌ 无法连接本地服务：${escapeHtml(reason)}。<br><span class="row-note" style="margin:0">${tip}</span>`;
      }
    }
    function toggleLocalOcrGuide() {
      if (!els.localOcrGuide) return;
      const hidden = els.localOcrGuide.classList.toggle('hidden');
      if (els.localOcrInstallBtn) els.localOcrInstallBtn.textContent = hidden ? (T('localOcrInstall') || '🚀 一键安装并启动本地服务') : '🔼 收起安装向导';
      if (!hidden && mainOcrStatus) mainOcrStatus.innerHTML = '<span class="row-note">已展开安装向导，请按步骤操作。</span>';
    }
    async function copyLocalOcrCmd() {
      const cmd = els.localOcrManualCmd ? els.localOcrManualCmd.textContent : 'python -m venv venv_ocr && venv_ocr\\Scripts\\activate && pip install molscribe decimer molnextr pillow rdkit && python local_ocr_server.py';
      try {
        await navigator.clipboard.writeText(cmd);
        setStatus('手动安装命令已复制到剪贴板。', 'ok');
      } catch (e) {
        // fallback
        const ta = document.createElement('textarea'); ta.value = cmd; document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); setStatus('手动安装命令已复制到剪贴板。', 'ok'); } catch (e2) { setStatus('复制失败，请手动选中命令复制。', 'warn'); }
        document.body.removeChild(ta);
      }
    }
    async function downloadOcrBundle() {
      const btn = els.localOcrDownloadBundle;
      const originalText = btn ? btn.textContent : '📥 下载安装包';
      try {
        if (btn) { btn.disabled = true; btn.textContent = '⏳ 打包中…'; }
        if (typeof window.JSZip !== 'function') throw new Error('JSZip 未加载，请刷新页面重试。');
        // .bat 与 .zip 会被静态服务器拦截，改为浏览器本地生成 zip：内含 .bat 启动器 + 同目录 .ps1 + local_ocr_server.py
        const [ps1, py] = await Promise.all([
          fetch('setup_ocr_server.ps1', { cache: 'no-store' }).then(r => { if (!r.ok) throw new Error('ps1 ' + r.status); return r.text(); }),
          fetch('local_ocr_server.py', { cache: 'no-store' }).then(r => { if (!r.ok) throw new Error('py ' + r.status); return r.text(); })
        ]);
        const bat = '@echo off\r\nchcp 65001 >nul\r\ntitle chem-prop-predictor Local OCR Server Setup\r\necho ==================================================\r\necho  chem-prop-predictor Local OCR Server Setup\r\necho ==================================================\r\necho.\r\necho This will create a Python virtual environment and\r\necho install MolScribe / DECIMER / MolNexTR, then start\r\necho the local OCR server. First run may take 5-15 min.\r\necho.\r\npause\r\necho.\r\npowershell -ExecutionPolicy Bypass -File "%~dp0setup_ocr_server.ps1"\r\necho.\r\necho Server stopped. Press any key to close.\r\npause >nul\r\n';
        const zip = new window.JSZip();
        zip.file('setup_ocr_server.bat', bat);
        zip.file('setup_ocr_server.ps1', ps1);
        zip.file('local_ocr_server.py', py);
        const blob = await zip.generateAsync({ type: 'blob' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = 'ocr_server_bundle.zip'; a.style.display = 'none';
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        URL.revokeObjectURL(url);
        setStatus('安装包已生成并开始下载，解压后双击 setup_ocr_server.bat 即可。', 'ok');
      } catch (e) {
        setStatus('安装包下载失败：' + (e.message || e) + '。可改用「复制手动命令」。', 'warn');
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = originalText; }
      }
    }
    if (els.localOcrInstallBtn) els.localOcrInstallBtn.addEventListener('click', toggleLocalOcrGuide);
    if (els.localOcrCopyCmd) els.localOcrCopyCmd.addEventListener('click', copyLocalOcrCmd);
    if (els.localOcrDownloadBundle) els.localOcrDownloadBundle.addEventListener('click', downloadOcrBundle);
    if (els.localOcrTestBtn) els.localOcrTestBtn.addEventListener('click', testLocalOcr);
    if (els.localOcrUrl) els.localOcrUrl.addEventListener('change', () => setLocalOcrUrl(els.localOcrUrl.value));

    function runMainOcrFromBlob(blob, from) {
      lastOcrBlob = blob;
      const reader = new FileReader();
      reader.onload = async () => {
        const localUrl = getLocalOcrUrl();
        const modeHint = localUrl ? '本地服务优先' : '在线 MolScribe / OSRA 兜底（成功率依赖第三方，建议部署本地服务）';
        if (mainOcrStatus) mainOcrStatus.innerHTML = ocrLoadingHtml('正在预处理图片并识别结构（' + modeHint + '）…');
        if (els.imageOcrRunBtn) els.imageOcrRunBtn.disabled = true;
        try {
          if (typeof window.ocrViaMolScribe === 'function') {
            const r = await window.ocrViaMolScribe(reader.result, { localUrl });
            if (r && r.ok) showOcrConfirm(r.smiles, r.source);
            else showOcrToolPicker(r.details);
          } else {
            if (mainOcrStatus) mainOcrStatus.textContent = 'OCR 模块未加载';
          }
        } finally {
          if (els.imageOcrRunBtn) els.imageOcrRunBtn.disabled = !lastOcrBlob;
        }
      };
      reader.readAsDataURL(blob);
    }
    function runMainOcr(dataUrl) { // 保留兼容旧签名（图片工具箱引用）
      const byteString = atob(dataUrl.split(',')[1]);
      const mime = (dataUrl.match(/data:(.*?);/) || [])[1] || 'image/png';
      const buf = new Uint8Array(byteString.length);
      for (let i = 0; i < byteString.length; i++) buf[i] = byteString.charCodeAt(i);
      runMainOcrFromBlob(new Blob([buf], { type: mime }));
    }
    // 在线识别（外部工具）选择器：打开第三方站点手动识别，回填 SMILES
    const ONLINE_OCR_SITES = [
      { name: 'DECIMER.ai', url: 'https://decimer.ai/', desc: '深度学习 图片→SMILES' },
      { name: 'MolScribe', url: 'https://huggingface.co/spaces/yujieq/MolScribe', desc: '深度学习 图片→SMILES' },
      { name: 'NCI OSRA', url: 'https://cactus.nci.nih.gov/osra/', desc: 'OSRA 光学结构识别（在线表单）' },
      { name: 'FreeChemDraw', url: 'https://www.freechemdraw.com/', desc: '在线绘制→SMILES' },
      { name: 'MolView', url: 'https://molview.org/', desc: '在线结构编辑/查看（可粘贴 SMILES）' }
    ];
    function downloadCurrentOcrImage() {
      const blob = lastOcrBlob, dataUrl = lastOcrDataUrl;
      try {
        if (blob) {
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a'); a.href = url; a.download = (blob.name || 'structure.png'); a.style.display = 'none';
          document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
          setStatus('当前结构图已下载，可上传到外部识别网站。', 'ok');
        } else if (dataUrl) {
          const a = document.createElement('a'); a.href = dataUrl; a.download = 'structure.png'; a.style.display = 'none';
          document.body.appendChild(a); a.click(); document.body.removeChild(a);
          setStatus('当前结构图已下载，可上传到外部识别网站。', 'ok');
        } else {
          setStatus('当前没有可下载的结构图（请先上传或粘贴图片）。', 'warn');
        }
      } catch (e) {
        setStatus('下载图片失败：' + (e && e.message || e), 'warn');
      }
    }
    function showOnlineOcrPicker() {
      if (!mainOcrStatus) return;
      const hasImg = !!(lastOcrBlob || lastOcrDataUrl);
      const sitesHtml = ONLINE_OCR_SITES.map(s =>
        `<button class="ocr-online-site" type="button" data-url="${s.url}" title="${s.url}">` +
          `<span class="ocr-online-site-name">${escapeHtml(s.name)}</span>` +
          `<span class="ocr-online-site-desc">${escapeHtml(s.desc)}</span>` +
        `</button>`).join('');
      mainOcrStatus.innerHTML = `
        <div class="ocr-online-panel">
          <button class="ocr-fail-close" id="onlineOcrClose" type="button" title="收起">✕</button>
          <div class="ocr-online-title">🌐 在线识别（外部工具）</div>
          <div class="ocr-online-body">选择一个在线识别网站 → 在<b>新标签页</b>上传<b>同一张结构图</b>完成识别 → 复制 SMILES → 粘贴回下方框确认。数据将在第三方站点处理，请注意保密。</div>
          <div class="ocr-online-sites">${sitesHtml}</div>
          <div class="ocr-online-actions">
            ${hasImg ? `<button class="btn btn-sm btn-ghost" id="onlineOcrDownload" type="button">📥 下载当前图片</button>` : ''}
            <button class="btn btn-sm btn-ghost" id="onlineOcrManual" type="button">✍ 手动输入 SMILES</button>
          </div>
          <div class="ocr-online-backfill">
            <label class="sub-title" style="margin-top:10px;display:block">回填识别结果（SMILES）</label>
            <textarea class="tool-area-sm" id="onlineOcrSmiles" rows="2" placeholder="将外部工具识别出的 SMILES 粘贴到这里…"></textarea>
            <div class="action-row" style="margin-top:8px">
              <button class="btn btn-sm btn-primary" id="onlineOcrConfirm" type="button">✅ 确认使用并预测</button>
            </div>
          </div>
        </div>`;
      const closeBtn = $('onlineOcrClose'); if (closeBtn) closeBtn.addEventListener('click', () => { if (mainOcrStatus) mainOcrStatus.innerHTML = '<span class="row-note">已收起在线识别面板。</span>'; });
      const sitesWrap = mainOcrStatus.querySelector('.ocr-online-sites');
      if (sitesWrap) sitesWrap.addEventListener('click', (e) => {
        const btn = e.target.closest('.ocr-online-site'); if (!btn) return;
        const url = btn.getAttribute('data-url'); if (!url) return;
        const w = window.open(url, '_blank', 'noopener,noreferrer');
        if (!w) setStatus('浏览器拦截了新窗口，请允许弹出窗口后重试。', 'warn');
        else {
          const nm = btn.querySelector('.ocr-online-site-name');
          setStatus('已在新标签页打开 ' + (nm ? nm.textContent : url) + '，识别后复制 SMILES 回填即可。', 'ok');
        }
      });
      const dl = $('onlineOcrDownload'); if (dl) dl.addEventListener('click', downloadCurrentOcrImage);
      const mn = $('onlineOcrManual'); if (mn) mn.addEventListener('click', () => {
        const v = window.prompt('请输入该结构的 SMILES：', '');
        if (v && v.trim()) { els.input.value = v.trim(); setActiveInputTab('text'); runSingle(); }
      });
      const cf = $('onlineOcrConfirm'); if (cf) cf.addEventListener('click', () => {
        const ta = $('onlineOcrSmiles');
        const v = ta ? ta.value.trim() : '';
        if (!v) { setStatus('请先粘贴外部工具识别出的 SMILES。', 'warn'); if (ta) ta.focus(); return; }
        els.input.value = v;
        setActiveInputTab('text');
        setStatus('已应用在线识别回填的 SMILES，开始预测。', 'ok');
        if (mainOcrStatus) mainOcrStatus.innerHTML = '<span style="color:#16a34a">✅ 已预测</span>';
        runSingle();
      });
    }
    // Tab 切换
    document.querySelectorAll('.input-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => setActiveInputTab(btn.dataset.tab));
    });
    // 图片识别区：点击上传
    if (els.imageDropZone && els.mainOcrFile) {
      els.imageDropZone.addEventListener('click', () => els.mainOcrFile.click());
      els.mainOcrFile.addEventListener('change', () => {
        const file = els.mainOcrFile.files && els.mainOcrFile.files[0];
        if (file) handleImageFile(file);
      });
      // 拖拽
      ['dragenter','dragover'].forEach(ev => {
        els.imageDropZone.addEventListener(ev, (e) => { e.preventDefault(); e.stopPropagation(); els.imageDropZone.classList.add('drag-over'); });
      });
      ['dragleave','drop'].forEach(ev => {
        els.imageDropZone.addEventListener(ev, (e) => { e.preventDefault(); e.stopPropagation(); els.imageDropZone.classList.remove('drag-over'); });
      });
      els.imageDropZone.addEventListener('drop', (e) => {
        const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (file) handleImageFile(file);
      });
    }
    // AI 识别结构按钮
    if (els.imageOcrRunBtn) {
      els.imageOcrRunBtn.addEventListener('click', () => {
        if (lastOcrBlob) runMainOcrFromBlob(lastOcrBlob, 'file');
      });
    }
    // 在线识别（外部工具）按钮
    if (els.onlineOcrBtn) els.onlineOcrBtn.addEventListener('click', showOnlineOcrPicker);
    // 全局粘贴图片：若当前在图片识别 tab 则捕获；否则交给输入框文本粘贴（保留原有体验）
    document.addEventListener('paste', (e) => {
      const items = e.clipboardData && e.clipboardData.items;
      if (!items) return;
      let imgItem = null;
      for (const it of items) { if (it.type && it.type.indexOf('image/') === 0) { imgItem = it; break; } }
      if (!imgItem) return;
      const blob = imgItem.getAsFile(); if (!blob) return;
      // 只有在图片识别 tab 激活、或当前焦点不在文本输入框时才接管
      const activePanel = document.querySelector('.input-tab-panel.active');
      const inTextInput = document.activeElement === els.input;
      if (activePanel && activePanel.dataset.panel === 'image' && !inTextInput) {
        e.preventDefault();
        setActiveInputTab('image');
        handleImageFile(blob);
        if (mainOcrStatus) mainOcrStatus.textContent = '📋 检测到粘贴图片，请点击“AI 识别结构”。';
      }
    });
    // 保留：在文本输入框内粘贴图片仍自动识别（旧体验兼容）
    els.input.addEventListener('paste', (e) => {
      const items = e.clipboardData && e.clipboardData.items;
      if (!items) return;
      let imgItem = null;
      for (const it of items) { if (it.type && it.type.indexOf('image/') === 0) { imgItem = it; break; } }
      if (!imgItem) return;
      e.preventDefault();
      const blob = imgItem.getAsFile(); if (!blob) return;
      setActiveInputTab('image');
      handleImageFile(blob);
      if (mainOcrStatus) mainOcrStatus.textContent = '📋 检测到粘贴图片，请点击“AI 识别结构”。';
    });
    // 化合物身份识别 - 多专业数据库搜索
    els.chemspiderIdBtn.addEventListener('click', () => openIdentitySearch('chemspider'));
    els.chemblBtn.addEventListener('click', () => openIdentitySearch('chembl'));
    els.drugbankBtn.addEventListener('click', () => openIdentitySearch('drugbank'));
    els.drugcentralBtn.addEventListener('click', () => openIdentitySearch('drugcentral'));
    els.zincBtn.addEventListener('click', () => openIdentitySearch('zinc'));
    els.chebiBtn.addEventListener('click', () => openIdentitySearch('chebi'));
    els.wikiBtn.addEventListener('click', () => openIdentitySearch('wiki'));
    els.patentIdBtn.addEventListener('click', () => openIdentitySearch('patent'));
    els.scholarIdBtn.addEventListener('click', () => openIdentitySearch('scholar'));
    $('batchExportCsv').addEventListener('click', exportBatchCSV);
    if (els.batchTableWrap) els.batchTableWrap.addEventListener('click', (e) => {
      const b = e.target.closest('[data-idx]');
      if (!b) return;
      const idx = +b.dataset.idx;
      if (b.classList.contains('batch-retry')) retryBatchRow(idx);
      else if (b.classList.contains('batch-rowcsv')) exportRowCSV(idx);
    });
    els.aboutToggle.addEventListener('click', () => els.aboutSection.classList.toggle('hidden'));
    // ⑦ 历史统计面板
    const statsBtn = $('statsBtn'); if (statsBtn) statsBtn.addEventListener('click', openStats);
    const kbBtn = $('kbBtn'); if (kbBtn) kbBtn.addEventListener('click', openKb);
    // ⑧ 一键置顶
    initScrollTopBtn();
    // Hero KPI 卡点击 / 键盘跳转到对应模块
    els.resultHero.addEventListener('click', (e) => {
      const st = e.target.closest('.stat.clickable');
      if (st && st.dataset.target) scrollToModule(st.dataset.target);
    });
    els.resultHero.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const st = e.target.closest('.stat.clickable');
      if (st && st.dataset.target) { e.preventDefault(); scrollToModule(st.dataset.target); }
    });
    // ⑨ 头部智能显隐：向下滚动折叠腾出阅读空间；仅当回顶（化合物输入区域）或预测遮罩忙时重新出现，避免中途反复弹出干扰阅读。
    (function setupHeaderAutoHide() {
      const header = document.querySelector('.site-header');
      if (!header) return;
      let ticking = false;
      const TOP_GUARD = 120;     // 顶部保护区：回到化合物输入（顶部）区域时才重新展开
      function show() { header.classList.remove('is-hidden'); }
      function hide() { header.classList.add('is-hidden'); }
      function update() {
        const y = window.scrollY || window.pageYOffset || 0;
        // 预测遮罩显示时强制展开，保证状态/按钮可见
        const overlayBusy = els.calcOverlay && !els.calcOverlay.classList.contains('hidden') &&
          getComputedStyle(els.calcOverlay).display !== 'none';
        // 仅当回到顶部（化合物输入区域）或遮罩忙时展开；向下滚动 / 任意位置向上滚动均保持收起，避免中途反复弹出
        if (overlayBusy || y <= TOP_GUARD) show();
        else hide();
        ticking = false;
      }
      function onScroll() { if (!ticking) { ticking = true; requestAnimationFrame(update); } }
      window.addEventListener('scroll', onScroll, { passive: true });
      // 头部按钮键盘聚焦时保持展开（无障碍）
      header.addEventListener('focusin', show);
      update();
    })();
  }

  /* ---------- 对外暴露（供研发工具箱 research-tools.js 调用） ---------- */
  window.__chemprop = {
    getSingle: () => lastSingle,
    getBatch: () => lastBatch,
    getSmiles: () => currentSmiles,
    getTox: () => currentToxAlerts,
    setStatus: setStatus,
    showOverlay: showCalcOverlay,
    updateOverlay: updateCalcOverlay,
    hideOverlay: hideCalcOverlay,
    // 同步本地词典查询（离线可用、零网络等待），供工具箱按名称解析 SMILES
    findLocal: (raw) => { try { return findLocalSmiles(raw); } catch (e) { return null; } },
    // 收藏当前化合物（由工具箱 ⑮ 实现，这里转发给 hero 快捷按钮）
    favAddQuick: () => { try { window.dispatchEvent(new CustomEvent('chemprop-fav-add')); } catch (e) {} },
    // 供 research-tools.js（主题切换按钮等）安全读取 i18n 文案，避免跨 IIFE 直接依赖内部变量
    T: (key) => T(key),
  };

  // 给结果区所有卡片加折叠按钮：结构/身份、理化性质、盐型、溶解度、热力学、3D、毒性、谱图、ADME 等
  function initResultCardCollapse() {
    const rs = document.getElementById('resultSection');
    if (!rs) return;
    rs.querySelectorAll('.card').forEach(card => {
      if (card.querySelector('.card-collapse-btn') || card.querySelector('.section-toggle-btn')) return;
      let titleRow = card.querySelector('.card-title-row');
      if (!titleRow) {
        // 兼容查找：找 card 的子元素中第一个 .card-title（避免 :scope 兼容性问题）
        let t = null;
        for (const c of card.children) { if (c.classList && c.classList.contains('card-title')) { t = c; break; } }
        if (!t) return;
        titleRow = document.createElement('div');
        titleRow.className = 'card-title-row';
        card.insertBefore(titleRow, t);
        titleRow.appendChild(t);
      }
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-sm btn-ghost section-toggle-btn card-collapse-btn';
      btn.style.whiteSpace = 'nowrap';
      btn.textContent = '收起 ▲';
      btn.setAttribute('aria-expanded', 'true');
      btn.addEventListener('click', () => {
        const collapsed = card.classList.toggle('collapsed');
        btn.textContent = collapsed ? '📂 展开 ▼' : '收起 ▲';
        btn.setAttribute('aria-expanded', String(!collapsed));
      });
      titleRow.appendChild(btn);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
  // 结果区卡片折叠（DOMContentLoaded 之后绑，因为 resultSection 默认 hidden）
  if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', initResultCardCollapse);
  else initResultCardCollapse();
})();
