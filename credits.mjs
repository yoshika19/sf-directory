
const trim = s => String(s == null ? '' : s).trim();
const clean = t => trim(String(t || '').replace(/no information/gi, '').replace(/\s+/g, ' '));

export const normName = s =>
  clean(String(s || '').replace(/@\[([^\]]+)\]/g, '$1').replace(/^@/, '')).toLowerCase();

export function parseYearFromText(txt) {
  const s = String(txt || '');
  const m = s.match(/\((\d{4})(?:\s*[\-–—\/]\s*(?:\d{2,4}|present|ongoing))?\)\s*$/i);
  if (m) return parseInt(m[1], 10);
  const any = s.match(/\b((?:19|20)\d{2})\b/);
  return any ? parseInt(any[1], 10) : -1;
}

export function parseYearRange(txt) {
  const s = String(txt || '');
  const rm = s.match(/\b((?:19|20)\d{2})\s*[-–—\/]\s*((?:19|20)\d{2}|\d{2}|present|ongoing)\b/i);
  if (rm) {
    const st = rm[1];
    let en = rm[2];
    if (/^present$/i.test(en)) en = 'Present';
    else if (/^ongoing$/i.test(en)) en = 'Ongoing';
    else if (/^\d{2}$/.test(en)) {
      let c = parseInt(st.slice(0, 2), 10);
      if (parseInt(en, 10) < parseInt(st.slice(2), 10)) c += 1;
      en = String(c) + en;
    }
    if (en === st) en = '';
    return { start: st, end: en };
  }
  const sm = s.match(/\b((?:19|20)\d{2})\b/);
  return sm ? { start: sm[1], end: '' } : null;
}

export function whoKeys(whoText) {
  const w = normName(whoText);
  if (!w) return [];
  const out = [w];
  w.split(/\s*(?:,|&|\/|\+|;|\band\b)\s*/i).forEach(tok => {
    const tk = clean(tok.replace(/^@+/, '').replace(/\s*\([^)]*\)\s*$/, ''));
    if (tk && !out.includes(tk)) out.push(tk);
  });
  return out;
}

function extractProjectMeta(doc, entry) {
  const wrap = doc.querySelector('pj-wrap');
  if (!wrap) return entry;
  const isMusic = wrap.getAttribute('kind') === 'music' || !!wrap.querySelector('pj-poster[ratio="1:1"]');
  const pImg = wrap.querySelector('pj-poster img');
  entry.poster = pImg ? clean(pImg.getAttribute('src') || '') : '';
  entry.isMusic = isMusic;
  const metas = [...wrap.querySelectorAll('pj-m')].map(m => clean(m.textContent)).filter(Boolean);
  entry.format = metas[0] || '';

  const headEl = wrap.querySelector('pj-head');
  const yrCandidates = [];
  if (headEl) yrCandidates.push(clean(headEl.textContent));
  metas.forEach(x => yrCandidates.push(x));
  let foundRange = null;
  yrCandidates.forEach(txt => {
    const r = parseYearRange(txt);
    if (!r) return;
    if (r.end && (!foundRange || !foundRange.end)) foundRange = r;
    else if (!foundRange) foundRange = r;
  });
  if (foundRange) {
    if (foundRange.end || !entry.yearRange || !entry.yearRange.start) entry.yearRange = foundRange;
    if (entry.year < 0) entry.year = parseInt(foundRange.start, 10);
  }

  let prod = '';
  metas.slice(1).forEach(x => {
    if (!x || /^(?:original|existing)\s+work$/i.test(x) || /^\d+\s+(?:seasons?|tracks?)$/i.test(x) ||
        /^franchise/i.test(x) || /^1:1/i.test(x) || /^(?:custom|mix|custom mix)$/i.test(x) ||
        /^project\s*directory$/i.test(x) ||
        /^(?:19|20)\d{2}(?:\s*[-–—\/]\s*(?:(?:19|20)\d{2}|\d{2}|present|ongoing))?$/i.test(x)) return;
    prod = x;
  });
  if (!prod && /belmont[\s\-]*lawrence/i.test(entry.forum || '')) {
    prod = (isMusic || /\bmusic\s+group\b/i.test(entry.desc || ''))
      ? 'Belmont-Lawrence Music Group'
      : 'Belmont-Lawrence Production';
  }
  entry.prod = prod;

  const mainArtists = [], seenArt = {};
  const artEl = wrap.querySelector('pj-artist, pj-by');
  if (artEl) {
    const directArt = clean(artEl.textContent.replace(/^by\s+/i, '').replace(/@\[([^\]]+)\]/g, '$1').replace(/^@/, ''));
    if (directArt) mainArtists.push(directArt);
  }
  if (!mainArtists.length) {
    wrap.querySelectorAll('pj-row').forEach(rNode => {
      if (rNode.closest && rNode.closest('details.pj-inst')) return;
      const clone = rNode.cloneNode(true);
      const whoEl = clone.querySelector('pj-who');
      let whoTxt = '';
      if (whoEl) { whoTxt = clean(whoEl.textContent); whoEl.remove(); }
      else whoTxt = clean(rNode.getAttribute('who') || '');
      const roleTxt = clean(clone.textContent);
      if (!whoTxt || !/^(?:(?:main|lead|primary|solo)\s+)?artist$|^performer$/i.test(roleTxt)) return;
      const cleanWho = clean(whoTxt.replace(/@\[([^\]]+)\]/g, '$1').replace(/^@/, ''));
      const k = cleanWho.toLowerCase();
      if (cleanWho && !seenArt[k]) { seenArt[k] = 1; mainArtists.push(cleanWho); }
    });
  }
  entry.artist = mainArtists.join(', ');
  return entry;
}

function collectRoles(doc) {
  const map = new Map();
  const seen = new Map();
  function add(key, item) {
    if (!map.has(key)) { map.set(key, []); seen.set(key, new Set()); }
    const sig = [item.cat, item.role, item.inst, item.yr].join('|').toLowerCase();
    if (seen.get(key).has(sig)) return;
    seen.get(key).add(sig);
    map.get(key).push(Object.assign({}, item));
  }

  doc.querySelectorAll('pj-wrap').forEach(wrap => {
    function pullRow(rowEl, catLabel, instInfo) {
      const clone = rowEl.cloneNode(true);
      const whoEl = clone.querySelector('pj-who');
      let whoTxt = '';
      if (whoEl) { whoTxt = clean(whoEl.textContent); whoEl.remove(); }
      else whoTxt = clean(rowEl.getAttribute('who') || '');
      const roleTxt = clean(clone.textContent);
      if (!roleTxt || !whoTxt) return;
      const item = {
        cat: catLabel || 'Credit',
        role: roleTxt,
        inst: instInfo ? instInfo.title : '',
        fmt: instInfo ? instInfo.fmt : '',
        yr: instInfo ? instInfo.yr : ''
      };
      whoKeys(whoTxt).forEach(k => add(k, item));
    }

    let curSec = '', curSecRaw = '', curSub = '';
    const skipSecRe = /franchise|installment|tracklist|tracks|episodes|overview|synopsis/i;
    wrap.querySelectorAll('pj-sec, pj-sub, pj-row').forEach(elNode => {
      if (elNode.closest && elNode.closest('details.pj-inst')) return;
      const tag = elNode.tagName.toLowerCase();
      if (tag === 'pj-sec') {
        curSecRaw = clean(elNode.textContent);
        curSec = curSecRaw.toLowerCase();
        curSub = '';
        return;
      }
      if (tag === 'pj-sub') { curSub = clean(elNode.textContent); return; }
      if (tag === 'pj-row') {
        if (elNode.classList.contains('pj-inst-plain') || elNode.classList.contains('pj-trk-plain')) return;
        if (curSec && skipSecRe.test(curSec)) return;
        pullRow(elNode, curSub || curSecRaw || 'Credit', null);
      }
    });

    wrap.querySelectorAll('details.pj-inst').forEach(det => {
      const sum = det.querySelector('summary');
      const tEl = sum && sum.querySelector('.pj-inst-title');
      const fEl = sum && sum.querySelector('.pj-inst-fmt');
      const yEl = sum && sum.querySelector('.pj-inst-yr');
      let titleTxt = tEl ? clean(tEl.textContent) : '';
      if (!titleTxt && sum) {
        const sClone = sum.cloneNode(true);
        sClone.querySelectorAll('.pj-inst-caret, .pj-inst-fmt, .pj-inst-pill, .pj-inst-yr').forEach(x => x.remove());
        titleTxt = clean(sClone.textContent);
      }
      let yrTxt = yEl ? clean(yEl.textContent) : '';
      if (yrTxt === '—') yrTxt = '';
      const instInfo = {
        title: titleTxt,
        fmt: det.getAttribute('data-fmt') || (fEl ? clean(fEl.textContent) : ''),
        yr: yrTxt
      };
      const body = det.querySelector('.pj-inst-body') || det;
      let sub = '';
      body.querySelectorAll('pj-sub, pj-row').forEach(cel => {
        const ctag = cel.tagName.toLowerCase();
        if (ctag === 'pj-sub') sub = clean(cel.textContent);
        else if (ctag === 'pj-row') pullRow(cel, sub || 'Credit', instInfo);
      });
    });
  });

  const hasWrap = new Set(map.keys());
  doc.querySelectorAll('.postcolor').forEach(post => {
    if (post.querySelector('pj-wrap')) return;
    const clone = post.cloneNode(true);
    clone.querySelectorAll('blockquote, .quote, .quotetop, .quotemain, script, style').forEach(q => q.remove());
    const tmp = doc.createElement('div');
    tmp.innerHTML = clone.innerHTML
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(?:p|div|li|tr)>/gi, '\n');
    const txt = (tmp.textContent || '').replace(/\r/g, '');
    txt.split(/(?=(?:^|\n)\s*name\s*:)/i).forEach(blk => {
      const nm = blk.match(/^\s*name\s*:\s*(.+)$/im);
      if (!nm) return;
      const rl = blk.match(/^\s*(?:role\s*\/\s*position|role|position)\s*:\s*(.+)$/im);
      if (!rl) return;
      const roleTxt = clean(rl[1]);
      if (!roleTxt) return;
      const ct = blk.match(/^\s*category\s*:\s*(.+)$/im);
      const item = { cat: (ct ? clean(ct[1]) : '') || 'Credit', role: roleTxt, inst: '', fmt: '', yr: '' };
      whoKeys(nm[1]).forEach(k => { if (!hasWrap.has(k)) add(k, item); });
    });
  });

  return map;
}

export function charYear(entry, roles) {
  let year = entry.year, yearRange = entry.yearRange;
  if ((!yearRange || !yearRange.end) && roles.length) {
    let best = year;
    roles.forEach(r => {
      const rr = parseYearRange(r.yr);
      if (rr) {
        if (rr.end && (!yearRange || !yearRange.end)) yearRange = rr;
        const ry = parseInt(rr.start, 10);
        if (ry > best) best = ry;
      }
    });
    if (year < 0 && best > 0) year = best;
  }
  return { year, yearRange };
}

export function buildTopicCredits(doc, info) {
  const rawTit = clean(info.title), rawDesc = clean(info.desc);
  let yrR = parseYearRange(rawTit);
  if (!yrR || !yrR.end) {
    const dYr = parseYearRange(rawDesc);
    if (dYr && (dYr.end || !yrR)) yrR = dYr;
  }
  const entry = {
    tid: String(info.tid), title: rawTit, forum: info.forum || '', desc: rawDesc,
    poster: '', isMusic: false, format: '', prod: '', artist: '',
    year: yrR ? parseInt(yrR.start, 10) : parseYearFromText(rawTit),
    yearRange: yrR
  };
  extractProjectMeta(doc, entry);

  const refs = {};
  for (const [key, roles] of collectRoles(doc)) {
    if (!roles.length) continue;
    const y = charYear(entry, roles);
    const ref = { tid: entry.tid, roles };
    if (y.year !== entry.year) ref.year = y.year;
    if (y.yearRange !== entry.yearRange) ref.yearRange = y.yearRange;
    refs[key] = ref;
  }
  return { project: entry, refs };
}

export function createIndex() {
  return { projects: Object.create(null), byName: Object.create(null) };
}

export function addToIndex(index, built) {
  const keys = Object.keys(built.refs);
  if (!keys.length) return 0;
  const p = built.project;
  index.projects[p.tid] = {
    title: p.title, forum: p.forum, desc: p.desc, poster: p.poster, isMusic: p.isMusic,
    format: p.format, prod: p.prod, artist: p.artist, year: p.year, yearRange: p.yearRange
  };
  keys.forEach(k => { (index.byName[k] = index.byName[k] || []).push(built.refs[k]); });
  return keys.length;
}
