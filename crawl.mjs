import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import { buildTopicCredits, addToIndex, createIndex } from './credits.mjs';

const BASE = 'https://sunsetboulevard.jcink.net';
const COOKIE = process.env.JCINK_COOKIE || '';
const FORUMS = ['36', '39'];
const FORUM_NAMES = { '36': 'Project Directory', '39': 'Belmont-Lawrence Production' };
const MAX_PAGES = 30;
const DELAY_MS = 400;

globalThis.location = { host: 'sunsetboulevard.jcink.net' };
globalThis.DOMParser = new JSDOM('').window.DOMParser;

var YEAR_PART = '\\d{4}(?:\\s*[-–—]\\s*(?:\\d{4}|present|now))?';
var BASED_RE = new RegExp('\\((' + YEAR_PART + ')\\)\\s*$', 'i');

var MUSIC_FORMAT_TAG = {
  'studio album': 'ALBUM', 'album': 'ALBUM', 'ep': 'EP', 'single': 'SINGLE',
  'mixtape': 'MIXTAPE', 'soundtrack / score': 'OST', 'soundtrack': 'OST', 'score': 'OST', 'ost': 'OST',
  'live / concert': 'LIVE', 'live': 'LIVE', 'concert': 'LIVE'
};
var SCREEN_FORMAT_TAG = {
  'film': 'FILM', 'series': 'SERIES', 'reality / variety show': 'SHOW', 'show': 'SHOW',
  'animation': 'ANIMATION', 'theater': 'THEATER', 'documentary': 'DOCUMENTARY'
};

var collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
var trim = function (s) { return String(s == null ? '' : s).trim(); };

var esc = function (s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&' + 'amp;')
    .replace(/</g, '&' + 'lt;')
    .replace(/>/g, '&' + 'gt;')
    .replace(/"/g, '&' + 'quot;');
};

function stripAccents(s) {
  var str = String(s == null ? '' : s);
  if (str.normalize) str = str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return str;
}
function normKey(s) {
  return stripAccents(s).toLowerCase().replace(/\(.*?\)|\[.*?\]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}
function compactKey(s) { return normKey(s).replace(/\s+/g, ''); }
function rawKey(s) {
  return stripAccents(s).toLowerCase().replace(/[^a-z0-9]+/g, '');
}
function cleanIrpName(s) {
  return trim(s).replace(/@\[([^\]]+)\]/g, '$1').replace(/^@+/, '');
}

function parseArtistsList(s) {
  var clean = stripAccents(s).toLowerCase()
    .replace(/&amp;/gi, ' & ')
    .replace(/[\(\[\{]/g, ' , ')
    .replace(/[\)\]\}]/g, ' ');
  var parts = clean.split(/\s*(?:,|&|＆|\||\+|\/|;|·|\b(?:feat\.?|ft\.?|featuring|with|and|x|vs\.?)\b)\s*/i);
  var out = [];
  for (var i = 0; i < parts.length; i++) {
    var k = parts[i].replace(/[^a-z0-9]+/g, ' ').trim();
    if (k && out.indexOf(k) < 0) out.push(k);
  }
  out.sort();
  return out;
}

function artistsOverlap(a1, a2) {
  var l1 = Array.isArray(a1) ? a1 : parseArtistsList(a1);
  var l2 = Array.isArray(a2) ? a2 : parseArtistsList(a2);
  if (!l1.length || !l2.length) return false;
  var noSpace = function (str) { return str.replace(/\s+/g, ''); };
  var sortWords = function (str) { return str.split(/\s+/).filter(Boolean).sort().join(' '); };
  var all1 = sortWords(l1.join(' ')), all2 = sortWords(l2.join(' '));
  if (all1 && (all1 === all2 || noSpace(all1) === noSpace(all2))) return true;
  if (noSpace(l1.join('')) === noSpace(l2.join(''))) return true;
  for (var i = 0; i < l1.length; i++) {
    var p1 = ' ' + l1[i] + ' ', w1 = sortWords(l1[i]), c1 = noSpace(l1[i]);
    for (var j = 0; j < l2.length; j++) {
      var c2 = noSpace(l2[j]);
      if (l1[i] === l2[j] || (c1 && c1 === c2) || (w1 && w1 === sortWords(l2[j]))) return true;
      var p2 = ' ' + l2[j] + ' ';
      if (l1[i].length >= 3 && p2.indexOf(p1) > -1) return true;
      if (l2[j].length >= 3 && p1.indexOf(p2) > -1) return true;
      if (c1.length >= 5 && c2.indexOf(c1) > -1) return true;
      if (c2.length >= 5 && c1.indexOf(c2) > -1) return true;
    }
  }
  return false;
}

function splitDashPair(str) {
  var s = trim(str);
  var m = s.match(/^([\s\S]+?)\s+(?:—|–|-)\s+([\s\S]+)$/);
  if (m) return [trim(m[1]), trim(m[2])];
  var m2 = s.match(/^([\s\S]+?)\s*[—–]\s*([\s\S]+)$/);
  if (m2) return [trim(m2[1]), trim(m2[2])];
  return null;
}

function normYr(s) {
  var m = String(s == null ? '' : s).match(/(\d{4})(?:\s*[-–—]\s*(\d{4}|present|now))?/i);
  if (!m) return '';
  return m[2] ? m[1] + '-' + m[2].toLowerCase().replace('now', 'present') : m[1];
}
function startYear(y) { var m = String(y || '').match(/\d{4}/); return m ? m[0] : ''; }

function parseQueryWork(str) {
  var s = trim(str);
  var m = s.match(/^([\s\S]+?)\s*(?:\(\s*(\d{4})(?:\s*[-–—]\s*(?:\d{4}|present|now))?\s*\)|[-–—]\s*(\d{4}))\s*$/i);
  if (!m) return null;
  var t = trim(m[1]);
  return t ? [t, m[2] || m[3]] : null;
}

function normalizeMusicBadge(rawFmt, topicTitle, isMusic) {
  var k = trim(rawFmt).toLowerCase();
  if (MUSIC_FORMAT_TAG[k]) return MUSIC_FORMAT_TAG[k];
  var tm = String(topicTitle || '').match(/^\s*\[([^\]]+)\]/);
  if (tm) {
    var tk = trim(tm[1]).toLowerCase();
    return MUSIC_FORMAT_TAG[tk] || trim(tm[1]).toUpperCase();
  }
  return k ? k.toUpperCase() : (isMusic ? 'ALBUM' : 'OST');
}

function normalizeScreenBadge(rawFmt, topicTitle) {
  var k = trim(rawFmt).toLowerCase();
  if (SCREEN_FORMAT_TAG[k]) return SCREEN_FORMAT_TAG[k];
  var tm = String(topicTitle || '').match(/^\s*\[([^\]]+)\]/);
  if (tm) {
    var tk = trim(tm[1]).toLowerCase();
    return SCREEN_FORMAT_TAG[tk] || trim(tm[1]).toUpperCase();
  }
  return k ? k.toUpperCase() : 'FILM';
}

function parseMusicDoc(doc, item) {
  var wraps = doc.querySelectorAll('pj-wrap');
  var results = [];
  [].forEach.call(wraps, function (wrap) {
    var isMusic = wrap.getAttribute('kind') === 'music' || !!wrap.querySelector('pj-poster[ratio="1:1"]');
    var headEl = wrap.querySelector('pj-head');
    var projTitle = headEl ? trim(headEl.textContent) : trim(item.title.replace(/^\s*\[[^\]]+\]\s*/, ''));
    var metas = [].map.call(wrap.querySelectorAll('pj-m'), function (m) { return trim(m.textContent); });
    var rawFmt = metas[0] || (headEl && headEl.getAttribute('type')) || '';
    var badge = normalizeMusicBadge(rawFmt, item.title, isMusic);
    var isOrigProj = metas.some(function (m) { return /original\s*work/i.test(m); });

    var defaultArtist = '';
    var based = wrap.querySelector('pj-based');
    if (based) {
      var bTxt = trim(based.textContent).replace(BASED_RE, '');
      var dp = splitDashPair(bTxt);
      if (dp) defaultArtist = dp[1];
    }

    var irpArtists = [], curSec = '', curSub = '', tracks = [], seenTracks = {};
    function addTrack(irpT, origS, origA, isOrig, extra) {
      irpT = trim(irpT);
      origS = trim(origS);
      origA = trim(origA);
      var origFlag = !!isOrig || (!origA && (isOrigProj || isMusic));
      if (!origS && !irpT) return;
      if (!origFlag && (!origS || !origA)) return;
      var finalSong = origFlag ? (irpT || origS) : origS;
      var finalArt = origFlag ? '' : origA;
      var tk = rawKey(finalSong) + '|' + parseArtistsList(finalArt).join(',') + '|' + rawKey(irpT || finalSong) + '|' + (origFlag ? '1' : '0');
      if (seenTracks[tk]) return;
      seenTracks[tk] = 1;
      var obj = {
        irpTrack: irpT || finalSong,
        origSong: finalSong,
        origArtist: finalArt,
        artistList: origFlag ? [] : parseArtistsList(finalArt),
        isOriginal: origFlag
      };
      if (extra) {
        if (extra.dzId) obj.dzId = extra.dzId;
        if (extra.noPreview) obj.noPreview = true;
        if (extra.audioEmbed) obj.audioEmbed = true;
      }
      tracks.push(obj);
    }

    [].forEach.call(wrap.querySelectorAll('pj-sec, pj-sub, pj-row, details'), function (el) {
      var tag = el.tagName.toLowerCase();
      if (tag === 'pj-sec') { curSec = trim(el.textContent).toLowerCase(); curSub = ''; return; }
      if (tag === 'pj-sub') { curSub = trim(el.textContent).toLowerCase(); return; }

      if (tag === 'details') {
        if (el.querySelector('pj-row, details')) return;
        var sum = el.querySelector('summary');
        var dSong = trim(el.getAttribute('data-song') || '');
        var dArt = trim(el.getAttribute('data-artist') || '');
        var isTrackSec = curSec === 'tracklist' || /track/i.test(curSec);
        var rawSumTxt = sum ? trim(sum.textContent) : '';
        if (!dSong && !dArt && !isTrackSec && !(isMusic && /^[▸▾▶►•·\s]*\d+\./.test(rawSumTxt))) return;

        var irpT = trim(el.getAttribute('who') || '').replace(/^\d+\.\s*/, '');
        var origS = '', origA = '';

        if (sum) {
          var sClone = sum.cloneNode(true);
          [].forEach.call(sClone.querySelectorAll('*'), function (n) {
            var nt = trim(n.textContent);
            if (/^[▸▾▶►]$/.test(nt) || /^(youtube|spotify|soundcloud|apple music|lyrics|overview|preview|audio|video|mv|watch|listen)$/i.test(nt)) {
              n.remove();
            }
          });
          var pieces = [];
          [].forEach.call(sClone.children, function (ch) {
            var ct = trim(ch.textContent);
            if (!ct || /^[▸▾▶►\-–—]$/.test(ct) || /^\d+:\d{2}$/.test(ct)) return;
            pieces.push(ct);
          });
          if (!pieces.length) {
            var st = trim(sClone.textContent).replace(/^[▸▾▶►]\s*/, '');
            if (st) pieces.push(st);
          }

          pieces.forEach(function (txt) {
            var cleanTxt = txt.replace(/\s*·\s*\d+:\d{2}\s*$/, '');
            var pair = splitDashPair(cleanTxt);
            if (pair && !origS) {
              origS = pair[0];
              origA = pair[1];
            } else if (!irpT && /^\d+\./.test(cleanTxt)) {
              irpT = trim(cleanTxt.replace(/^\d+\.\s*/, ''));
            } else if (!irpT) {
              irpT = cleanTxt;
            }
          });
        }

        if (!origS && dSong) origS = dSong;
        if (!origA && dArt) origA = dArt.replace(/\|/g, ', ');
        if (origS && !origA) origA = defaultArtist;
        if (!origS && irpT && defaultArtist) { origS = irpT; origA = defaultArtist; }

        addTrack(irpT, origS, origA, !origA && (isOrigProj || isMusic), {
          dzId: trim(el.getAttribute('data-dzid') || ''),
          noPreview: el.getAttribute('data-nodz') === '1',
          audioEmbed: !!(el.classList.contains('pj-trk') || el.getAttribute('data-audio') || el.querySelector('iframe'))
        });
        return;
      }

      if (tag !== 'pj-row') return;

      var whoAttr = trim(el.getAttribute('who') || '');
      if (curSec === 'tracklist' || /track/i.test(curSec) || (isMusic && /^\d+\./.test(whoAttr))) {
        var irpTrack = whoAttr.replace(/^\d+\.\s*/, '');
        var rightTxt = trim(el.textContent);
        var parts = rightTxt.split(/\s*·\s*/);
        if (parts.length > 1 && /^\d+:\d{2}$/.test(trim(parts[parts.length - 1]))) {
          parts.pop();
          rightTxt = trim(parts.join(' · '));
        } else if (/^\d+:\d{2}$/.test(rightTxt) || rightTxt === '—') {
          rightTxt = '';
        }
        var origS = '', origA = '';
        var pair = splitDashPair(rightTxt);
        if (pair) { origS = pair[0]; origA = pair[1]; }
        else { origS = rightTxt || irpTrack; origA = defaultArtist; }

        var dSong = el.getAttribute('data-song');
        var dArt = el.getAttribute('data-artist');
        if (!origS && dSong) origS = dSong;
        if (!origA && dArt) origA = dArt.replace(/\|/g, ', ');
        addTrack(irpTrack, origS, origA, !origA && (isOrigProj || isMusic), {
          dzId: trim(el.getAttribute('data-dzid') || ''),
          noPreview: el.getAttribute('data-nodz') === '1'
        });
      } else if (/^(artists|cast)/i.test(curSub)) {
        var rc = el.cloneNode(true);
        var wEl = rc.querySelector('pj-who');
        var aEl = wEl ? wEl.querySelector('a') : null;
        var whoName = aEl ? trim(aEl.textContent) : (wEl ? cleanIrpName(wEl.textContent) : cleanIrpName(whoAttr));
        if (whoName && irpArtists.indexOf(whoName) < 0) irpArtists.push(whoName);
      }
    });

    if (!tracks.length && isMusic && projTitle) {
      addTrack(projTitle, projTitle, '', true);
    }

    if (tracks.length) {
      results.push({
        tid: item.tid, title: projTitle, url: item.url, badge: badge,
        irpArtist: irpArtists.length ? irpArtists.join(', ') : 'Open Artist',
        tracks: tracks
      });
    }
  });

  if (!results.length) {
    var extraTracks = [];
    [].forEach.call(doc.querySelectorAll('.postcolor'), function (pc) {
      var lines = (pc.textContent || '').split(/\r?\n/);
      for (var i = 0; i < lines.length; i++) {
        var m = lines[i].match(/^\s*Song\s*:\s*([\s\S]+)$/i);
        if (m) {
          var sp = splitDashPair(m[1]);
          if (sp && sp[0] && sp[1]) {
            extraTracks.push({
              irpTrack: sp[0], origSong: sp[0], origArtist: sp[1],
              artistList: parseArtistsList(sp[1]),
              isOriginal: false
            });
          }
        }
      }
    });
    if (extraTracks.length) {
      results.push({
        tid: item.tid, title: trim(item.title.replace(/^\s*\[[^\]]+\]\s*/, '')),
        url: item.url, badge: 'OST', irpArtist: 'Soundtrack Claim', tracks: extraTracks
      });
    }
  }
  return results;
}

function parseScreenDoc(doc, item) {
  var results = [];
  [].forEach.call(doc.querySelectorAll('pj-wrap'), function (wrap) {
    if (wrap.getAttribute('kind') === 'music' || wrap.querySelector('pj-poster[ratio="1:1"]')) return;
    var headEl = wrap.querySelector('pj-head');
    var headTxt = headEl ? trim(headEl.textContent) : trim(item.title.replace(/^\s*\[[^\]]+\]\s*/, ''));
    var hm = headTxt.match(BASED_RE);
    var irpYear = hm ? normYr(hm[1]) : '';
    var projTitle = hm ? trim(headTxt.slice(0, hm.index)) : headTxt;

    var metas = [].map.call(wrap.querySelectorAll('pj-m'), function (m) { return trim(m.textContent); });
    var badge = normalizeScreenBadge(metas[0] || (headEl && headEl.getAttribute('type')) || '', item.title);
    var isExistingProj = metas.some(function (m) { return /existing\s*work/i.test(m); });

    var works = [], seen = {};
    function addWork(title, key, year, src, alias, workBadge, isOrig) {
      title = trim(title);
      key = compactKey(key || title);
      if (!title || !key) return;
      var id = key + '|' + startYear(year) + '|' + (isOrig ? '1' : '0');
      if (seen[id]) return;
      seen[id] = 1;
      works.push({
        title: title,
        key: key,
        year: normYr(year),
        src: src || '',
        alias: alias || '',
        badge: workBadge || badge,
        isOriginal: !!isOrig
      });
    }

    function isExternalUrl(href) {
      if (!href || !/^https?:\/\//i.test(href)) return false;
      return !location.host || href.indexOf(location.host) === -1;
    }

    var rows = [], hasFranchise = false, curSec = '';
    [].forEach.call(wrap.querySelectorAll('pj-sec, pj-row, details.pj-inst'), function (el) {
      var tag = el.tagName.toLowerCase();
      if (tag === 'pj-sec') { curSec = trim(el.textContent).toLowerCase(); return; }

      var isInst = tag === 'details' && el.classList.contains('pj-inst');
      var dW = trim(el.getAttribute('data-work') || '');
      var inFranchise = isInst || /franchise|installment|entr(y|ies)|filmography|movies|films|series|seasons|parts|works/i.test(curSec);
      var extA = null;
      [].forEach.call(el.querySelectorAll('a[href]'), function (a) {
        if (!extA && isExternalUrl(a.getAttribute('href') || '')) extA = a;
      });

      if (inFranchise) hasFranchise = true;
      var isOrigRow = !dW && !extA;

      if (isOrigRow && isExistingProj) return;
      if (!dW && !inFranchise) return;

      var titleEl = isInst ? el.querySelector('.pj-inst-title') : null;
      var rawWho = titleEl
        ? trim(titleEl.textContent)
        : trim(el.getAttribute('who') || '').replace(/^\d+\.\s*/, '');
      var whoYear = '';
      var wm = rawWho.match(BASED_RE);
      if (wm) { whoYear = wm[1]; rawWho = trim(rawWho.slice(0, wm.index)); }

      var aTxt = extA ? trim(extA.textContent) : '';
      var aYear = '';
      var am = aTxt.match(BASED_RE);
      if (am) { aYear = am[1]; aTxt = trim(aTxt.slice(0, am.index)); }
      var isSourceLbl = !aTxt || /^\d{4}(?:\s*[-–—]\s*(?:\d{4}|present|now))?$/i.test(aTxt) ||
        /^(imdb|tmdb|wiki|wikipedia|letterboxd|source|link|mal|myanimelist|anilist|spotify|youtube|↗|→)$/i.test(aTxt);

      var workTitle = '';
      if (dW) {
        if (rawWho && compactKey(rawWho) === compactKey(dW)) workTitle = rawWho;
        else if (!isSourceLbl && compactKey(aTxt) === compactKey(dW)) workTitle = aTxt;
        else if (isInst && rawWho) workTitle = rawWho;
        else if (!isSourceLbl && aTxt.length > 1) workTitle = aTxt;
        else workTitle = dW;
      } else {
        workTitle = !isSourceLbl ? aTxt : rawWho;
      }

      if (!workTitle) return;

      var yr = el.getAttribute('data-year') || aYear || whoYear || normYr(el.textContent);
      var alias = (rawWho && workTitle && compactKey(rawWho) !== compactKey(workTitle)) ? rawWho : '';
      var dFmt = trim(el.getAttribute('data-fmt') || '');
      var wBadge = dFmt ? normalizeScreenBadge(dFmt, '') : badge;

      rows.push({
        title: workTitle,
        key: dW || workTitle,
        year: yr,
        alias: alias,
        src: extA ? (extA.getAttribute('href') || '') : '',
        badge: wBadge,
        isOriginal: isOrigRow
      });
    });

    [].forEach.call(wrap.querySelectorAll('pj-based'), function (based) {
      if (hasFranchise && !based.getAttribute('data-work') && rows.length) return;
      var ba = based.querySelector('a');
      var raw = ba ? trim(ba.textContent) : trim(based.textContent);
      var by = based.getAttribute('data-year') || '';
      var ym = raw.match(BASED_RE);
      if (ym) { if (!by) by = ym[1]; raw = trim(raw.slice(0, ym.index)); }
      addWork(raw, based.getAttribute('data-work') || raw, by, ba ? (ba.getAttribute('href') || '') : '', '', badge, false);
    });
    rows.forEach(function (r) { addWork(r.title, r.key, r.year, r.src, r.alias, r.badge, r.isOriginal); });

    if (!works.length && projTitle) {
      addWork(projTitle, projTitle, irpYear, '', '', badge, true);
    }

    if (works.length) {
      results.push({
        tid: item.tid, title: projTitle || item.title, url: item.url,
        badge: badge, irpYear: irpYear, works: works
      });
    }
  });
  return results;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function get(path) {
  const r = await fetch(BASE + path, {
    headers: { cookie: COOKIE, 'user-agent': 'sf-directory-bot' }
  });
  if (!r.ok) throw new Error(path + ' -> HTTP ' + r.status);
  return r.text();
}

function collectTopics(doc, fid, topics, seen) {
  let added = 0;
  let anchors = doc.querySelectorAll('.topic-tit a[href*="showtopic="], .topic-row a[href*="showtopic="]');
  if (!anchors.length) anchors = doc.querySelectorAll('a[href*="showtopic="], a[href*="act=ST"]');
  anchors.forEach(function (a) {
    const href = a.getAttribute('href') || '';
    const m = href.match(/[?&](?:showtopic|t)=(\d+)/i);
    if (!m) return;
    const tid = m[1];
    if (/[?&]view=(?:getlastpost|getnewpost|findpost)/i.test(href)) return;
    const stM = href.match(/[?&]st=(\d+)/i);
    if (stM && parseInt(stM[1], 10) > 0) return;
    if (a.closest && a.closest('.pagination, .topic-pages, .topic-info, #navstrip, .navstrip')) return;
    if (a.classList && a.classList.contains('go-new-post')) return;

    const clone = a.cloneNode(true);
    const tags = [];
    clone.querySelectorAll('.tag').forEach(function (tg) {
      const tt = trim(tg.textContent);
      if (tt) tags.push('[' + tt.toUpperCase() + ']');
      tg.remove();
    });
    const mainTxt = trim(clone.textContent);
    if (!mainTxt || /^\d+$/.test(mainTxt) || /^last post/i.test(mainTxt)) return;
    if (seen[tid]) return;
    seen[tid] = 1;
    added++;
    const fullTitle = (tags.length ? tags.join(' ') + ' ' : '') + mainTxt;
    const rowEl = a.closest ? a.closest('.topic-row, tr, li') : null;
    const dEl = rowEl ? rowEl.querySelector('.desc, .topic-desc, .topic-description') : null;
    const desc = dEl ? trim(dEl.textContent).replace(/^[\s|]+/, '') : '';
    topics.push({ tid: tid, f: fid, title: fullTitle, desc: desc, sig: fullTitle, url: '/index.php?showtopic=' + tid });
  });
  return added;
}

const music = [], screen = [];
const credits = createIndex();
let failed = 0;

for (const fid of FORUMS) {
  const topics = [], seen = {};
  for (let page = 0; page < MAX_PAGES; page++) {
    let html;
    try { html = await get('/index.php?showforum=' + fid + '&st=' + page * 15); }
    catch (e) { console.error('listing gagal:', e.message); failed++; break; }
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const added = collectTopics(doc, fid, topics, seen);
    console.log('board ' + fid + ' halaman ' + (page + 1) + ': +' + added + ' topik');
    if (!added) break;
    await sleep(DELAY_MS);
  }
  for (const t of topics) {
    try {
      const doc = new DOMParser().parseFromString(await get(t.url), 'text/html');
      parseMusicDoc(doc, t).forEach(p => { p.forum = fid; music.push(p); });
      parseScreenDoc(doc, t).forEach(p => { p.forum = fid; screen.push(p); });
      try {
        addToIndex(credits, buildTopicCredits(doc, { tid: t.tid, title: t.title, desc: t.desc, forum: FORUM_NAMES[fid] || '' }));
      } catch (e) { console.error('credits gagal:', t.url, e.message); failed++; }
    } catch (e) { console.error('topik gagal:', t.url, e.message); failed++; }
    await sleep(DELAY_MS);
  }
}

if (!music.length && !screen.length) {
  console.error('Hasil kosong (kemungkinan butuh login / cookie salah). File lama dibiarkan.');
  process.exit(1);
}

fs.mkdirSync('docs', { recursive: true });
fs.writeFileSync('docs/directory.json', JSON.stringify({ updatedAt: Date.now(), music, screen }));
fs.writeFileSync('docs/credits.json', JSON.stringify({ updatedAt: Date.now(), projects: credits.projects, byName: credits.byName }));
console.log('credits: ' + Object.keys(credits.byName).length + ' karakter, ' + Object.keys(credits.projects).length + ' proyek');
console.log('Selesai: ' + screen.length + ' proyek screen, ' + music.length + ' rilis music, gagal: ' + failed);
