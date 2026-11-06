/* Study garden add-on for "Our Little Garden".
   Adds: 60-minute focus timer, a decorated study garden (5 flower kinds, bloom / wilt),
   fish food earned per finished session, break-time bunny prompts, a black pop-up bunny and focus music.
   Load it with one line at the end of index.html:  <script src="study.js"></script>
   Tip: open the page with ?testtimer on the end of the address to make a session 10 seconds long for testing. */
(function () {
  'use strict';
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var TEST = /[?&]testtimer/.test(location.search);
  var FOOD_PER_SESSION = 3; /* used only in ?testtimer mode; normally 1 food per 20 minutes studied */
  var CIRC = 553; /* 2 * pi * 88 */
  var K_GARDEN = 'study-garden', K_FOOD = 'study-food', K_RUN = 'study-run', K_MIN = 'study-minutes';

  /* ---------- settings from my-stuff.js (all optional) ---------- */
  function parseSections(txt) {
    var out = {}, cur = null;
    String(txt || '').split(/\r?\n/).forEach(function (line) {
      var l = line.trim(); if (!l || l.charAt(0) === '#') return;
      var m = l.match(/^==\s*(.+?)\s*==$/);
      if (m) { cur = m[1].toLowerCase(); out[cur] = []; return; }
      if (cur) out[cur].push(l);
    });
    return out;
  }
  function fileOf(v) { return (!v || v === '-') ? '' : v; }
  var CFG = parseSections(window.MY_STUFF);
  var STUDY = {};
  (CFG['study'] || []).forEach(function (l) { var k = l.indexOf(':'); if (k > 0) STUDY[l.slice(0, k).trim().toLowerCase()] = l.slice(k + 1).trim(); });
  var LENGTHS = [];
  (STUDY['lengths'] || '25, 45, 60, 90').split(',').forEach(function (n) { n = parseInt(n, 10); if (n >= 5 && n <= 300 && LENGTHS.indexOf(n) < 0) LENGTHS.push(n); });
  if (!LENGTHS.length) LENGTHS = [25, 45, 60, 90];
  var DEF_MIN = parseInt(STUDY['default length'], 10); if (!(DEF_MIN >= 5 && DEF_MIN <= 300)) DEF_MIN = 60;
  var END_SOUND = fileOf(STUDY['end sound']);
  var LOFI = (CFG['lofi'] || []).map(function (l) { var c = l.split('|').map(function (x) { return x.trim(); }); return { src: fileOf(c[0]), title: c[1] || c[0] }; }).filter(function (t) { return t.src; });
  var BREAKS = (CFG['motivation'] && CFG['motivation'].length) ? CFG['motivation'] : [
    'drink sum water stupid \uD83D\uDCA7',
    'go take a break and stretch ur body \uD83E\uDDD8',
    'Text me i miss u \uD83D\uDC99'
  ];
  function msFor(m) { return TEST ? 10 * 1000 : m * 60 * 1000; }
  function foodFor(ms) { return TEST ? FOOD_PER_SESSION : Math.max(1, Math.round(ms / 60000 / 20)); }

  function $(id) { return document.getElementById(id); }
  function rand(a, b) { return a + Math.random() * (b - a); }
  function get(k, d) { try { var v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } }
  function put(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function del(k) { try { localStorage.removeItem(k); } catch (e) {} }
  function fmt(ms) { var s = Math.max(0, Math.ceil(ms / 1000)), m = Math.floor(s / 60); return (m < 10 ? '0' : '') + m + ':' + ('0' + (s % 60)).slice(-2); }

  var garden = get(K_GARDEN, []);
  var food = get(K_FOOD, 0);
  var run = get(K_RUN, null); /* { end: timestamp } */
  var tick = null, ctx = null, baseTitle = document.title, justBloomed = -1;
  var minutes = parseInt(get(K_MIN, DEF_MIN), 10); if (!(minutes >= 5 && minutes <= 300)) minutes = DEF_MIN;
  var sessionMs = msFor(minutes);

  /* ---------- styles ---------- */
  var css = document.createElement('style');
  css.textContent =
    '.study{display:grid;grid-template-columns:minmax(0,340px) minmax(0,1fr);gap:32px;align-items:start;justify-content:center;padding-top:30px}' +
    '.st-clock{padding:22px 20px 20px;background:var(--paper);color:var(--paper-ink);border-radius:26px;text-align:center;box-shadow:0 14px 28px var(--shadow);transform:rotate(-1deg)}' +
    '.st-ring{position:relative;width:210px;height:210px;margin:0 auto}' +
    '.st-ring svg{display:block;width:100%;height:100%;transform:rotate(-90deg)}' +
    '.st-track{fill:none;stroke:var(--page-line);stroke-width:12}' +
    '.st-bar{fill:none;stroke:var(--heart);stroke-width:12;stroke-linecap:round;stroke-dasharray:' + CIRC + ';stroke-dashoffset:' + CIRC + ';transition:stroke-dashoffset .5s linear}' +
    '.st-time{position:absolute;inset:0;display:grid;place-content:center;justify-items:center;font-family:var(--hand);font-size:58px;font-weight:700;line-height:1}' +
    '.st-time small{font-family:var(--body);font-size:13px;font-weight:400;color:var(--paper-soft);margin-top:4px}' +
    '.st-go{margin-top:18px;min-height:50px;padding:8px 28px;border:0;border-radius:999px;background:var(--heart);color:#fff;font-weight:600;font-size:17px;box-shadow:0 8px 18px var(--shadow);transition:transform .15s}' +
    '.st-go:active{transform:scale(.92,1.08)}' +
    '.st-go.stop{background:transparent;color:var(--paper-ink);box-shadow:none;border:2px solid var(--chip-line)}' +
    '.st-hint{margin:12px 0 0;font-size:14px;color:var(--paper-soft)}' +
    '.st-plot{--sk1:#bcdcff;--sk2:#e6f1ff;--sk3:#fdeef3;--hill1:#c3e6d1;--hill2:#a9d9bf;--mound:#8fcfa8;--mound2:#b8e6c8;position:relative;overflow:hidden;isolation:isolate;padding:22px 16px 16px;border:1.5px solid var(--chip-line);border-radius:26px;background:linear-gradient(180deg,var(--sk1) 0%,var(--sk2) 55%,var(--sk3) 100%);box-shadow:0 14px 28px var(--shadow)}' +
    '@media (prefers-color-scheme: dark){:root:not([data-theme="light"]) .st-plot{--sk1:#121843;--sk2:#241f55;--sk3:#1c3150;--hill1:#2a5a5c;--hill2:#224b52;--mound:#2f6b62;--mound2:#3f8575}}' +
    ':root[data-theme="dark"] .st-plot{--sk1:#121843;--sk2:#241f55;--sk3:#1c3150;--hill1:#2a5a5c;--hill2:#224b52;--mound:#2f6b62;--mound2:#3f8575}' +
    '.st-plot::before{content:"";position:absolute;left:-10%;right:-10%;bottom:0;height:46%;z-index:0;pointer-events:none;background:radial-gradient(90% 100% at 18% 100%,var(--hill1) 62%,transparent 63%),radial-gradient(80% 90% at 85% 100%,var(--hill2) 62%,transparent 63%)}' +
    '.st-plot>*{position:relative;z-index:1}' +
    '.st-plot>.st-deco{position:absolute;z-index:0;pointer-events:none}' +
    '.st-sun{top:14px;right:20px;width:44px;height:44px;border-radius:50%;background:radial-gradient(circle at 40% 35%,#fffbe0,#ffe28a);box-shadow:0 0 0 8px rgba(255,236,160,.35),0 0 34px 16px rgba(255,236,160,.45);animation:stpulse 5s ease-in-out infinite alternate}' +
    '@keyframes stpulse{from{transform:scale(.94)}to{transform:scale(1.06)}}' +
    '@media (prefers-color-scheme: dark){:root:not([data-theme="light"]) .st-sun{background:radial-gradient(circle at 36% 34%,#fff,#d6defc);box-shadow:0 0 0 7px rgba(190,205,255,.18),0 0 30px 12px rgba(160,185,255,.35)}}' +
    ':root[data-theme="dark"] .st-sun{background:radial-gradient(circle at 36% 34%,#fff,#d6defc);box-shadow:0 0 0 7px rgba(190,205,255,.18),0 0 30px 12px rgba(160,185,255,.35)}' +
    '.st-cloud{top:22px;left:-90px;width:64px;height:18px;border-radius:20px;background:#fff;opacity:.9;animation:stcloud 70s linear infinite}' +
    '.st-cloud::before,.st-cloud::after{content:"";position:absolute;background:#fff;border-radius:50%}' +
    '.st-cloud::before{width:26px;height:26px;left:10px;top:-13px}.st-cloud::after{width:20px;height:20px;left:32px;top:-9px}' +
    '.st-cloud.c2{top:62px;transform:scale(.7);animation-duration:95s;animation-delay:-40s;opacity:.7}' +
    '@keyframes stcloud{from{left:-100px}to{left:110%}}' +
    '@media (prefers-color-scheme: dark){:root:not([data-theme="light"]) .st-cloud{opacity:.12}}' +
    ':root[data-theme="dark"] .st-cloud{opacity:.12}' +
    '.st-bf{width:24px;height:20px;animation:stfly 18s ease-in-out infinite}' +
    '.st-bf svg{display:block;width:100%;height:100%;animation:stflap .32s ease-in-out infinite alternate}' +
    '.st-bf.b2{animation-duration:24s;animation-delay:-9s}' +
    '@keyframes stfly{0%{left:4%;top:55%}20%{left:30%;top:30%}40%{left:55%;top:50%}60%{left:80%;top:25%}80%{left:60%;top:62%}100%{left:4%;top:55%}}' +
    '@keyframes stflap{from{transform:scaleX(1)}to{transform:scaleX(.3)}}' +
    '.st-flowers{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:4px 4px;padding-top:34px}' +
    '.st-slot{position:relative;height:100px;display:flex;align-items:flex-end;justify-content:center}' +
    '.st-slot::after{content:"";position:absolute;bottom:0;left:6%;right:6%;height:13px;border-radius:50% 50% 40% 40%;background:radial-gradient(ellipse at 50% 0,var(--mound2),var(--mound))}' +
    '.st-slot svg{position:relative;z-index:1;display:block;height:92px;width:auto;max-width:100%;transform-origin:50% 100%;margin-bottom:6px;filter:drop-shadow(0 3px 4px rgba(40,70,120,.18))}' +
    '.st-slot.new svg{animation:stbloom 1.1s cubic-bezier(.3,1.5,.5,1)}' +
    '@keyframes stbloom{0%{transform:scale(.05) rotate(-25deg)}100%{transform:scale(1) rotate(0)}}' +
    '.st-slot.ok svg{animation:swayflower 4s ease-in-out infinite alternate}' +
    '.st-slot.wilt svg{animation:none;filter:grayscale(.75) brightness(.95);transform:rotate(20deg) scale(.8,.72)}' +
    '.st-slot.seed::before{content:"";position:absolute;bottom:14px;left:50%;width:7px;height:7px;margin-left:-3px;border-radius:50%;background:#e6c7a0;opacity:.8;z-index:1}' +
    '.st-msg{margin:16px 2px 0;font-family:var(--hand);font-size:27px;font-weight:700;line-height:1.15;color:var(--ink);text-shadow:0 1px 0 rgba(255,255,255,.35)}' +
    '.st-music{display:flex;align-items:center;justify-content:center;gap:8px;margin-top:14px}' +
    '.st-music label{font-size:14px;color:var(--paper-soft);white-space:nowrap}' +
    '.st-music select{min-width:0;max-width:170px;min-height:40px;padding:4px 12px;border:1.5px solid var(--chip-line);border-radius:999px;background:var(--paper);color:var(--paper-ink);font:inherit;font-size:14px}' +
    '.st-play{flex:none;width:40px;height:40px;border:0;border-radius:50%;background:var(--blue-deep);color:#fff;font-size:15px;line-height:1;box-shadow:0 6px 12px var(--shadow)}' +
    '.st-play.on{background:var(--heart)}' +
    '.peek{--bunny:#15182f;--bunny-line:#8a96d2;--bunny-in:#f48fb1}' +
    '.peek svg circle[fill="#35406f"]{fill:#fff}' +
    '.st-aq{display:flex;flex-wrap:wrap;align-items:center;gap:10px}' +
    '.st-chip{display:inline-flex;align-items:center;gap:6px;min-height:42px;padding:6px 16px;background:var(--chip);border:1.5px solid var(--chip-line);border-radius:999px;font-weight:500;backdrop-filter:blur(6px)}' +
    '.st-say{position:fixed;z-index:60;left:0;top:0;max-width:min(240px,calc(100vw - 16px));padding:12px 16px;background:var(--paper);color:var(--paper-ink);border-radius:18px;font-family:var(--hand);font-size:25px;font-weight:700;line-height:1.1;white-space:pre-line;box-shadow:0 10px 24px var(--shadow);cursor:pointer;opacity:0;pointer-events:none;transition:opacity .25s}' +
    '.st-say.on{opacity:1;pointer-events:auto;animation:boing .6s cubic-bezier(.3,1.5,.5,1)}' +
    '.st-say::after{content:"";position:absolute;bottom:-9px;left:var(--tx,50%);width:18px;height:18px;margin-left:-9px;background:var(--paper);transform:rotate(45deg);border-radius:3px}' +
    '.st-say small{display:block;margin-top:4px;font-family:var(--body);font-size:11px;font-weight:400;color:var(--paper-soft)}' +
    '.st-toast{position:fixed;left:50%;bottom:150px;z-index:80;max-width:calc(100vw - 32px);padding:10px 20px;background:var(--paper);color:var(--paper-ink);border-radius:999px;font-weight:500;box-shadow:0 10px 24px var(--shadow);transform:translate(-50%,20px);opacity:0;pointer-events:none;transition:opacity .25s,transform .25s;text-align:center}' +
    '.st-toast.on{opacity:1;transform:translate(-50%,0)}' +
    '@media (max-width:760px){.study{grid-template-columns:minmax(0,1fr)}.st-clock{max-width:360px;width:100%;margin:0 auto}}' +
    '@media (max-width:420px){.st-slot{height:80px}.st-slot svg{height:72px}}';
  document.head.appendChild(css);

  /* black pop-up bunny: bigger white eyes with a little shine, so they show on black */
  Array.prototype.forEach.call(document.querySelectorAll('.peek svg'), function (svg) {
    Array.prototype.slice.call(svg.querySelectorAll('circle')).forEach(function (c) {
      var f = (c.getAttribute('fill') || '').toLowerCase();
      if (f !== '#35406f') return;
      c.setAttribute('fill', '#ffffff'); c.setAttribute('r', '3.2'); c.style.fill = '#ffffff';
      var s = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      s.setAttribute('cx', String(parseFloat(c.getAttribute('cx')) + 1)); s.setAttribute('cy', String(parseFloat(c.getAttribute('cy')) - 1));
      s.setAttribute('r', '1.2'); s.setAttribute('fill', '#15182f');
      c.parentNode.insertBefore(s, c.nextSibling);
    });
  });

  /* fireflies (only shown in night mode) */
  var ffCss = document.createElement('style');
  ffCss.textContent =
    '.st-ff{position:absolute;display:none;width:6px;height:6px;border-radius:50%;background:#fff7a8;box-shadow:0 0 6px 3px rgba(255,240,140,.8),0 0 16px 7px rgba(255,230,120,.4);pointer-events:none;left:var(--x);top:var(--y);animation:stff var(--dur) ease-in-out infinite alternate,stglow var(--g) ease-in-out infinite;animation-delay:var(--dl)}' +
    '.st-plot>.st-ff{z-index:2}' +
    '@keyframes stff{0%{transform:translate(0,0)}33%{transform:translate(var(--dx),calc(var(--dy) * -1))}66%{transform:translate(calc(var(--dx) * -.6),var(--dy))}100%{transform:translate(var(--dx2),calc(var(--dy) * .5))}}' +
    '@keyframes stglow{0%,100%{opacity:.12}50%{opacity:1}}' +
    '@media (prefers-color-scheme: dark){:root:not([data-theme="light"]) .st-ff{display:block}:root:not([data-theme="light"]) .st-bf{display:none}}' +
    ':root[data-theme="dark"] .st-ff{display:block}:root[data-theme="dark"] .st-bf{display:none}' +
    '@media (prefers-reduced-motion: reduce){.st-ff{animation:none;opacity:.8}}';
  document.head.appendChild(ffCss);
  function fireflies(parent, n, cls) {
    for (var i = 0; i < n; i++) {
      var f = document.createElement('span');
      f.className = 'st-ff' + (cls ? ' ' + cls : ''); f.setAttribute('aria-hidden', 'true');
      f.style.setProperty('--x', rand(4, 94).toFixed(1) + '%'); f.style.setProperty('--y', rand(18, 86).toFixed(1) + '%');
      f.style.setProperty('--dx', rand(-40, 40).toFixed(0) + 'px'); f.style.setProperty('--dy', rand(14, 36).toFixed(0) + 'px'); f.style.setProperty('--dx2', rand(-50, 50).toFixed(0) + 'px');
      f.style.setProperty('--dur', rand(7, 13).toFixed(1) + 's'); f.style.setProperty('--g', rand(2.4, 4.6).toFixed(1) + 's'); f.style.setProperty('--dl', '-' + rand(0, 9).toFixed(1) + 's');
      parent.appendChild(f);
    }
  }

  /* ---------- extra flower drawings ---------- */
  var BFLY = '<span class="CLS" aria-hidden="true"><svg viewBox="0 0 24 20"><ellipse cx="7" cy="7" rx="6" ry="6" fill="#f6a3bb"/><ellipse cx="17" cy="7" rx="6" ry="6" fill="#8bb4f0"/><ellipse cx="8" cy="14" rx="4" ry="4.5" fill="#cbb9ee"/><ellipse cx="16" cy="14" rx="4" ry="4.5" fill="#f6d6e2"/><rect x="11" y="3" width="2" height="14" rx="1" fill="#35406f"/></svg></span>';
  var defs = document.createElement('div');
  defs.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
  defs.setAttribute('aria-hidden', 'true');
  defs.innerHTML =
    '<svg width="0" height="0"><defs>' +
    '<symbol id="st-daisy" viewBox="0 0 60 130"><path d="M30 44 C30 80 29 104 30 130" stroke="#6fb28f" stroke-width="3" stroke-linecap="round" fill="none"/>' +
      '<path d="M30 108 C15 100 9 88 7 76 C21 80 28 92 30 108Z" fill="#8cc7a6"/>' +
      '<g fill="#fff" stroke="#d9e4fb" stroke-width="1"><ellipse cx="30" cy="22" rx="6" ry="13"/><ellipse cx="30" cy="22" rx="6" ry="13" transform="rotate(45 30 36)"/><ellipse cx="30" cy="22" rx="6" ry="13" transform="rotate(90 30 36)"/><ellipse cx="30" cy="22" rx="6" ry="13" transform="rotate(135 30 36)"/><ellipse cx="30" cy="22" rx="6" ry="13" transform="rotate(180 30 36)"/><ellipse cx="30" cy="22" rx="6" ry="13" transform="rotate(225 30 36)"/><ellipse cx="30" cy="22" rx="6" ry="13" transform="rotate(270 30 36)"/><ellipse cx="30" cy="22" rx="6" ry="13" transform="rotate(315 30 36)"/></g>' +
      '<circle cx="30" cy="36" r="7" fill="#ffd45e"/><circle cx="28" cy="34" r="2" fill="#fff3b5"/></symbol>' +
    '<symbol id="st-pink" viewBox="0 0 60 130"><path d="M30 50 C30 82 28 106 30 130" stroke="#6fb28f" stroke-width="3" stroke-linecap="round" fill="none"/>' +
      '<path d="M30 112 C45 104 52 92 53 80 C41 84 32 96 30 112Z" fill="#8cc7a6"/>' +
      '<path d="M30 52 C14 50 6 34 12 16 C20 24 26 28 30 14 C34 28 40 24 48 16 C54 34 46 50 30 52Z" fill="#f6a3bb"/>' +
      '<path d="M30 52 C22 46 20 30 30 14 C40 30 38 46 30 52Z" fill="#ee7fa2"/>' +
      '<path d="M30 20 C28 30 28 40 30 48" stroke="#fff" stroke-width="1.5" opacity=".5" fill="none"/></symbol>' +
    '<symbol id="st-lav" viewBox="0 0 60 130"><path d="M30 40 C30 80 29 104 30 130" stroke="#6fb28f" stroke-width="3" stroke-linecap="round" fill="none"/>' +
      '<path d="M30 112 C16 104 10 92 9 82 C21 86 28 98 30 112Z" fill="#8cc7a6"/>' +
      '<g fill="#b79cf0"><ellipse cx="30" cy="10" rx="4" ry="5.5"/><ellipse cx="24" cy="19" rx="4.5" ry="5.5"/><ellipse cx="36" cy="19" rx="4.5" ry="5.5"/><ellipse cx="23" cy="30" rx="4.5" ry="5.5"/><ellipse cx="37" cy="30" rx="4.5" ry="5.5"/><ellipse cx="30" cy="27" rx="4.5" ry="5.5" fill="#cbb9ee"/><ellipse cx="25" cy="41" rx="4" ry="5"/><ellipse cx="35" cy="41" rx="4" ry="5"/></g>' +
      '<g fill="#d9c9fa" opacity=".8"><circle cx="28" cy="16" r="1.6"/><circle cx="34" cy="26" r="1.6"/><circle cx="26" cy="37" r="1.4"/></g></symbol>' +
    '</defs></svg>';
  document.body.appendChild(defs);
  var KINDS = ['lily', 'tulip', 'daisy', 'pink', 'lav'];
  var SYM = { lily: 'lily', tulip: 'tulip', daisy: 'st-daisy', pink: 'st-pink', lav: 'st-lav' };
  function nextKind() { return KINDS[garden.length % KINDS.length]; }

  /* ---------- section ---------- */
  var sec = document.createElement('section');
  sec.className = 'sec'; sec.id = 'study'; sec.setAttribute('aria-labelledby', 'h-study');
  sec.innerHTML =
    '<div class="sec-head"><div><h2 id="h-study">Study garden</h2><p class="sec-sub">pick a length, focus, grow a flower</p></div>' +
    '<div class="favs"><svg viewBox="0 0 24 24" aria-hidden="true"><use href="#i-heart"/></svg><span id="stWeek"></span></div></div>' +
    '<div class="study">' +
      '<div class="st-clock">' +
        '<div class="st-ring"><svg viewBox="0 0 200 200" aria-hidden="true"><circle class="st-track" cx="100" cy="100" r="88"/><circle class="st-bar" id="stBar" cx="100" cy="100" r="88"/></svg>' +
        '<div class="st-time"><span id="stTime">60:00</span><small id="stSub">ready when you are</small></div></div>' +
        '<div class="st-lens" id="stLens" role="group" aria-label="Session length"></div>' +
        '<button class="st-go" id="stGo" type="button">Start studying</button>' +
        '<p class="st-hint" id="stHint"></p>' +
        '<div class="st-music"><label for="stMusic">🎵 Focus music</label>' +
        '<select id="stMusic"><option value="off">Off</option><option value="rain">Calm rain &amp; pads</option><option value="lofi">Lofi songs</option><option value="songs">Our jukebox songs</option></select>' +
        '<button class="st-play" id="stPlay" type="button" aria-label="Play focus music">▶</button>' +
        '<button class="st-play nx" id="stNext" type="button" aria-label="Next lofi song" hidden>⏭</button></div>' +
        '<p class="st-now" id="stNow" aria-live="polite"></p>' +
      '</div>' +
      '<div class="st-plot">' +
        '<span class="st-deco st-sun" aria-hidden="true"></span><span class="st-deco st-cloud" aria-hidden="true"></span><span class="st-deco st-cloud c2" aria-hidden="true"></span>' +
        BFLY.replace('CLS', 'st-deco st-bf') + BFLY.replace('CLS', 'st-deco st-bf b2') +
        '<div class="st-flowers" id="stFlowers" role="img"></div>' +
        '<p class="st-msg" id="stMsg" aria-live="polite"></p>' +
        (TEST ? '<button class="link-btn" id="stClear" type="button">clear garden (test mode)</button>' : '') +
      '</div>' +
    '</div>';
  fireflies(sec.querySelector('.st-plot'), 9, 'st-deco');
  var pageGarden = document.querySelector('.garden');
  if (pageGarden) fireflies(pageGarden, 7, '');
  var anchor = $('aquarium') || $('why');
  if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(sec, anchor);
  else (document.querySelector('.wrap') || document.body).appendChild(sec);
  function updateHint() {
    $('stHint').textContent = (TEST ? '10 seconds (test)' : minutes + ' minutes') + ' \u00B7 finish it to bloom a flower and earn ' + foodFor(sessionMs) + ' fish food \uD83D\uDC1F';
  }
  updateHint();

  /* session length picker */
  var lenCss = document.createElement('style');
  lenCss.textContent =
    '.st-lens{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:8px;margin-top:16px}' +
    '.st-len{min-height:38px;padding:4px 14px;border:1.5px solid var(--chip-line);border-radius:999px;background:transparent;color:var(--paper-ink);font-weight:500}' +
    '.st-len[aria-pressed="true"]{background:var(--blue-deep);border-color:var(--blue-deep);color:#fff}' +
    '.st-len:disabled,.st-custom:disabled{opacity:.45;cursor:default}' +
    '.st-custom{width:84px;min-height:38px;padding:4px 10px;border:1.5px solid var(--chip-line);border-radius:999px;background:var(--paper);color:var(--paper-ink);font:inherit;text-align:center}' +
    '.st-now{min-height:18px;margin:8px 0 0;font-size:13px;color:var(--paper-soft);overflow-wrap:anywhere}';
  document.head.appendChild(lenCss);
  var lensEl = $('stLens'), lensHtml = '';
  LENGTHS.forEach(function (m) { lensHtml += '<button class="st-len" type="button" data-m="' + m + '" aria-pressed="false">' + m + ' min</button>'; });
  lensHtml += '<input class="st-custom" id="stCustom" type="number" min="10" max="300" inputmode="numeric" placeholder="custom" aria-label="Custom session length in minutes (10 to 300)">';
  lensEl.innerHTML = lensHtml;
  var customEl = $('stCustom');
  function markLens() {
    Array.prototype.forEach.call(lensEl.querySelectorAll('.st-len'), function (b) { b.setAttribute('aria-pressed', String(+b.dataset.m === minutes)); });
    customEl.value = LENGTHS.indexOf(minutes) > -1 ? '' : minutes;
  }
  function lensLock(on) {
    Array.prototype.forEach.call(lensEl.querySelectorAll('button,input'), function (el) { el.disabled = on; });
  }
  function setMinutes(m) {
    m = Math.round(m); if (!(m >= 5 && m <= 300)) return;
    minutes = m; sessionMs = msFor(m); put(K_MIN, m); markLens(); updateHint();
    if (!run) showIdle();
  }
  lensEl.addEventListener('click', function (e) { var b = e.target.closest && e.target.closest('.st-len'); if (b && !run) setMinutes(+b.dataset.m); });
  customEl.addEventListener('change', function () {
    var v = parseInt(customEl.value, 10);
    if (v >= 10 && v <= 300) setMinutes(v); else { toast('pick a length between 10 and 300 minutes'); markLens(); }
  });
  markLens();

  /* nav pill */
  var nav = $('secnav');
  if (nav) {
    var pill = document.createElement('button');
    pill.type = 'button'; pill.className = 'pill'; pill.textContent = 'Study garden'; pill.dataset.k = 'study';
    var aqPill = nav.querySelector('[data-k="aquarium"]');
    if (aqPill) nav.insertBefore(pill, aqPill); else nav.appendChild(pill);
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (en) {
        if (!en[0].isIntersecting) return;
        Array.prototype.forEach.call(nav.children, function (b) { b.setAttribute('aria-current', b.dataset.k === 'study' ? 'true' : 'false'); });
      }, { rootMargin: '-35% 0px -60% 0px' }).observe(sec);
    }
  }

  /* ---------- bunny speech ---------- */
  var say = document.createElement('div'); say.className = 'st-say'; say.setAttribute('role', 'status');
  document.body.appendChild(say);
  var sayTimer = null;
  function follow() {
    if (!say.classList.contains('on')) return;
    var bn = $('bunny'); if (!bn) return;
    var b = bn.getBoundingClientRect(), w = say.offsetWidth, h = say.offsetHeight;
    var left = Math.min(window.innerWidth - w - 8, Math.max(8, b.left + b.width / 2 - w / 2));
    say.style.left = left + 'px'; say.style.top = Math.max(8, b.top - h - 14) + 'px';
    say.style.setProperty('--tx', Math.min(w - 20, Math.max(20, b.left + b.width / 2 - left)) + 'px');
    requestAnimationFrame(follow);
  }
  function bunnySay(text, ms) {
    say.innerHTML = '';
    var t = document.createElement('span'); t.textContent = text; say.appendChild(t);
    var s = document.createElement('small'); s.textContent = 'tap to dismiss'; say.appendChild(s);
    var was = say.classList.contains('on');
    say.classList.remove('on'); void say.offsetWidth; say.classList.add('on');
    if (!was) requestAnimationFrame(follow); else requestAnimationFrame(follow);
    clearTimeout(sayTimer); sayTimer = setTimeout(hideSay, ms || 15000);
  }
  function hideSay() { say.classList.remove('on'); }
  say.addEventListener('click', hideSay);
  function bunnyCheer() {
    var hop = $('bHop'); if (!hop || reduce) return;
    var n = 0;
    (function go() {
      hop.classList.remove('hop', 'joy'); void hop.offsetWidth; hop.classList.add('joy');
      if (++n < 3) setTimeout(go, 850);
    })();
  }

  /* ---------- effects ---------- */
  function hearts(x, y, n) {
    if (reduce) return;
    for (var i = 0; i < n; i++) {
      var a = (Math.PI * 2 * i) / n + rand(-.3, .3), r = rand(50, 110), d = document.createElement('div');
      d.className = 'fx fh'; d.style.left = x + 'px'; d.style.top = y + 'px'; d.style.color = i % 2 ? '#f6a3bb' : '#ee6a92';
      d.style.setProperty('--dx', Math.cos(a) * r + 'px'); d.style.setProperty('--dy', (Math.sin(a) * r - 20) + 'px'); d.style.setProperty('--rot', rand(-40, 40) + 'deg');
      d.innerHTML = '<svg viewBox="0 0 24 24"><use href="#i-heart"/></svg>';
      document.body.appendChild(d); (function (el) { setTimeout(function () { el.remove(); }, 1000); })(d);
    }
  }
  function chime() {
    try {
      var AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      if (!ctx) ctx = new AC(); ctx.resume();
      [523.25, 659.25, 783.99, 1046.5].forEach(function (f, i) {
        var o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime + i * .18;
        o.type = 'sine'; o.frequency.value = f;
        g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(.25, t + .02); g.gain.exponentialRampToValueAtTime(.0001, t + .9);
        o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + 1);
      });
    } catch (e) {}
  }
  var toastEl = document.createElement('div'); toastEl.className = 'st-toast'; toastEl.setAttribute('role', 'status'); document.body.appendChild(toastEl);
  var toastT = null;
  function toast(t) { toastEl.textContent = t; toastEl.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(function () { toastEl.classList.remove('on'); }, 3200); }

  /* ---------- garden render ---------- */
  function render() {
    var list = garden.slice(-28), slots = Math.max(14, Math.ceil(list.length / 7) * 7), h = '', i;
    for (i = 0; i < slots; i++) {
      var f = list[i];
      if (!f) { h += '<div class="st-slot' + (i === list.length ? ' seed' : '') + '" aria-hidden="true"></div>'; continue; }
      var cls = 'st-slot ' + (f.w ? 'wilt' : 'ok') + (i === justBloomed ? ' new' : '');
      h += '<div class="' + cls + '" aria-hidden="true"><svg style="animation-delay:-' + ((i * 0.7) % 4).toFixed(1) + 's" viewBox="' + (f.t === 'tulip' ? '0 0 50 120' : '0 0 60 130') + '"><use href="#' + (SYM[f.t] || 'lily') + '"/></svg></div>';
    }
    justBloomed = -1;
    var el = $('stFlowers'); el.innerHTML = h;
    var done = garden.filter(function (g) { return !g.w; }).length;
    el.setAttribute('aria-label', 'Study garden with ' + done + ' blooming flowers');
    var weekAgo = Date.now() - 7 * 864e5, wk = garden.filter(function (g) { return !g.w && g.d >= weekAgo; }).length;
    $('stWeek').textContent = wk + (wk === 1 ? ' flower' : ' flowers') + ' this week';
    if (!$('stMsg').textContent) $('stMsg').textContent = done ? 'your garden is growing \uD83D\uDC99' : 'finish a session and your first flower blooms here';
  }
  function setMsg(t) { $('stMsg').textContent = t; }

  /* ---------- fish food ---------- */
  var chip = null;
  (function () {
    var fb = $('feedBtn'), aq = $('aquarium');
    if (!fb) return;
    var head = fb.parentNode, wrap = document.createElement('div'); wrap.className = 'st-aq';
    chip = document.createElement('span'); chip.className = 'st-chip'; chip.setAttribute('aria-live', 'polite');
    head.insertBefore(wrap, fb); wrap.appendChild(chip); wrap.appendChild(fb);
    var sub = aq && aq.querySelector('.sec-sub'); if (sub) sub.textContent = 'fish only eat when you study \u2014 earn food, then tap the water';
  })();
  function foodUi() { if (chip) chip.textContent = '\uD83D\uDC1F food: ' + food; }
  function spendFood(e) {
    if (food > 0) { food--; put(K_FOOD, food); foodUi(); return; }
    e.stopPropagation(); e.stopImmediatePropagation();
    toast('The fish are hungry \u2014 finish a study session to earn food \uD83D\uDC1F');
  }
  window.addEventListener('pointerdown', function (e) { if (e.target && e.target.id === 'tankCv') spendFood(e); }, true);
  window.addEventListener('click', function (e) { if (e.target && e.target.closest && e.target.closest('#feedBtn')) spendFood(e); }, true);
  foodUi();

  /* ---------- focus music ---------- */
  var K_MUSIC = 'study-music', amb = null, songsOn = false, musicOn = false;
  var musicSel = $('stMusic'), playBtn = $('stPlay');
  if (!$('jPlay') || !$('juke')) { var so = musicSel.querySelector('option[value="songs"]'); if (so) so.remove(); }
  var savedMusic = get(K_MUSIC, 'off');
  if (musicSel.querySelector('option[value="' + savedMusic + '"]')) musicSel.value = savedMusic;

  function ambStart() {
    if (amb) return;
    var AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    if (!ctx) ctx = new AC(); ctx.resume();
    var m = ctx.createGain(); m.gain.value = .0001; m.gain.exponentialRampToValueAtTime(.5, ctx.currentTime + 2.5); m.connect(ctx.destination);
    var dl = ctx.createDelay(1), fb = ctx.createGain(), lp = ctx.createBiquadFilter();
    dl.delayTime.value = .42; fb.gain.value = .38; lp.type = 'lowpass'; lp.frequency.value = 1800;
    m.connect(dl); dl.connect(lp); lp.connect(fb); fb.connect(dl); lp.connect(ctx.destination);
    var len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0), i, last = 0;
    for (i = 0; i < len; i++) { last = (last + .02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.2; }
    var wbuf = ctx.createBuffer(1, len, ctx.sampleRate), wd = wbuf.getChannelData(0);
    for (i = 0; i < len; i++) wd[i] = Math.random() * 2 - 1;
    var brown = ctx.createBufferSource(); brown.buffer = buf; brown.loop = true;
    var white = ctx.createBufferSource(); white.buffer = wbuf; white.loop = true;
    var bg = ctx.createGain(); bg.gain.value = .22; brown.connect(bg); bg.connect(m);
    var hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 900;
    var lp2 = ctx.createBiquadFilter(); lp2.type = 'lowpass'; lp2.frequency.value = 6500;
    var wg = ctx.createGain(); wg.gain.value = .03; white.connect(hp); hp.connect(lp2); lp2.connect(wg); wg.connect(m);
    brown.start(); white.start();
    var CH = [[220, 261.63, 329.63, 392], [174.61, 220, 261.63, 329.63], [196, 261.63, 329.63, 392], [196, 246.94, 293.66, 329.63]];
    var BELL = [523.25, 587.33, 659.25, 783.99, 880], ci = 0;
    function pad() {
      var ch = CH[ci++ % CH.length], t = ctx.currentTime;
      ch.forEach(function (f, k) {
        var o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'triangle'; o.frequency.value = f; o.detune.value = (k % 2 ? 6 : -6);
        g.gain.setValueAtTime(.0001, t); g.gain.linearRampToValueAtTime(.05, t + 2.6); g.gain.linearRampToValueAtTime(.0001, t + 8.6);
        var f2 = ctx.createBiquadFilter(); f2.type = 'lowpass'; f2.frequency.value = 900;
        o.connect(f2); f2.connect(g); g.connect(m); o.start(t); o.stop(t + 9);
      });
    }
    function bell() {
      if (Math.random() < .4) return;
      var f = BELL[Math.floor(Math.random() * BELL.length)], t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(.1, t + .02); g.gain.exponentialRampToValueAtTime(.0001, t + 2.4);
      o.connect(g); g.connect(m); o.start(t); o.stop(t + 2.5);
    }
    pad();
    amb = { m: m, srcs: [brown, white], padT: setInterval(pad, 8000), bellT: setInterval(bell, 2600), nodes: [dl, fb, lp] };
  }
  function ambStop() {
    if (!amb) return;
    var a = amb; amb = null;
    clearInterval(a.padT); clearInterval(a.bellT);
    try { a.m.gain.cancelScheduledValues(ctx.currentTime); a.m.gain.setValueAtTime(Math.max(.0001, a.m.gain.value), ctx.currentTime); a.m.gain.exponentialRampToValueAtTime(.0001, ctx.currentTime + 1.2); } catch (e) {}
    setTimeout(function () {
      a.srcs.forEach(function (s) { try { s.stop(); } catch (e) {} });
      try { a.m.disconnect(); a.nodes.forEach(function (n) { n.disconnect(); }); } catch (e) {}
    }, 1400);
  }
  function jukePlaying() { var j = $('juke'); return !!(j && j.classList.contains('playing')); }
  function musicUi() { playBtn.textContent = musicOn ? '❚❚' : '▶'; playBtn.classList.toggle('on', musicOn); playBtn.setAttribute('aria-label', musicOn ? 'Pause focus music' : 'Play focus music'); }
  /* lofi songs from my-stuff.js */
  var lofi = { a: null, i: 0, fails: 0, on: false }, nextBtn = $('stNext');
  if (!LOFI.length) { var lo = musicSel.querySelector('option[value="lofi"]'); if (lo) lo.remove(); }
  var savedMusic2 = get(K_MUSIC, 'off');
  if (musicSel.querySelector('option[value="' + savedMusic2 + '"]')) musicSel.value = savedMusic2;
  function setNow(t) { $('stNow').textContent = t || ''; }
  function lofiPlay(i) {
    if (!LOFI.length) return;
    lofi.i = (i + LOFI.length) % LOFI.length;
    var t = LOFI[lofi.i];
    if (!lofi.a) {
      lofi.a = new Audio(); lofi.a.preload = 'auto'; lofi.a.volume = .65;
      lofi.a.addEventListener('ended', function () { lofi.fails = 0; if (lofi.on) lofiPlay(lofi.i + 1); });
      lofi.a.addEventListener('error', function () {
        if (!lofi.on) return;
        lofi.fails++;
        if (lofi.fails >= LOFI.length) { setNow('could not play the lofi files, check the names in my-stuff.js'); musicStop(); return; }
        lofiPlay(lofi.i + 1);
      });
    }
    lofi.a.src = t.src;
    var p = lofi.a.play(); if (p && p.catch) p.catch(function () {});
    setNow('♪ ' + t.title);
  }
  function lofiStop() { lofi.on = false; if (lofi.a) lofi.a.pause(); setNow(''); nextBtn.hidden = true; }
  nextBtn.addEventListener('click', function () { if (lofi.on) lofiPlay(lofi.i + 1); });
  function musicStop() {
    ambStop(); lofiStop();
    if (songsOn) { if (jukePlaying()) $('jPlay').click(); songsOn = false; }
    musicOn = false; musicUi();
  }
  function musicStart() {
    var v = musicSel.value; if (v === 'off') return;
    musicStop();
    if (v === 'songs') { if (!jukePlaying()) $('jPlay').click(); songsOn = true; musicOn = true; }
    else if (v === 'lofi') { lofi.on = true; lofi.fails = 0; musicOn = true; nextBtn.hidden = false; lofiPlay(Math.floor(Math.random() * LOFI.length)); }
    else { ambStart(); musicOn = !!amb; }
    musicUi();
  }

  /* session end sound (my-stuff.js: end sound) */
  var endAudio = null, endTimer = null;
  function endSound() {
    if (!END_SOUND) { chime(); return; }
    try {
      if (!endAudio) { endAudio = new Audio(END_SOUND); endAudio.addEventListener('error', function () { chime(); }); }
      endAudio.currentTime = 0;
      var p = endAudio.play(); if (p && p.catch) p.catch(function () { chime(); });
      clearTimeout(endTimer); endTimer = setTimeout(function () { endAudio.pause(); }, 30000);
    } catch (e) { chime(); }
  }
  say.addEventListener('click', function () { if (endAudio) endAudio.pause(); });
  musicSel.addEventListener('change', function () {
    put(K_MUSIC, musicSel.value);
    if (musicSel.value === 'off') musicStop(); else if (musicOn || run) musicStart();
  });
  playBtn.addEventListener('click', function () {
    if (musicOn) { musicStop(); return; }
    if (musicSel.value === 'off') { musicSel.value = 'rain'; put(K_MUSIC, 'rain'); }
    musicStart();
  });
  musicUi();

  /* ---------- timer ---------- */
  var go = $('stGo'), bar = $('stBar');
  function paint(remaining) {
    $('stTime').textContent = fmt(remaining);
    var total = (run && run.total) || sessionMs;
    bar.style.strokeDashoffset = String(CIRC * Math.max(0, Math.min(1, remaining / total)));
  }
  function showIdle() {
    lensLock(false); paint(sessionMs); $('stSub').textContent = 'ready when you are';
    go.textContent = 'Start studying'; go.classList.remove('stop'); document.title = baseTitle;
  }
  function onTick() {
    if (!run) return;
    var remaining = run.end - Date.now();
    if (remaining <= 0) { complete(); return; }
    paint(remaining); document.title = fmt(remaining) + ' \u00B7 studying';
  }
  function begin(resume) {
    if (!resume) { run = { end: Date.now() + sessionMs, total: sessionMs }; put(K_RUN, run); }
    lensLock(true);
    try { var AC = window.AudioContext || window.webkitAudioContext; if (AC && !ctx) ctx = new AC(); if (ctx) ctx.resume(); } catch (e) {}
    go.textContent = 'Stop'; go.classList.add('stop'); $('stSub').textContent = 'growing\u2026';
    setMsg(resume ? 'welcome back, keep going \uD83C\uDF31' : 'a little seed is planted. you got this \uD83C\uDF31');
    if (!resume && musicSel.value !== 'off') musicStart();
    clearInterval(tick); tick = setInterval(onTick, 500); onTick();
  }
  function endRun() { clearInterval(tick); tick = null; run = null; del(K_RUN); musicStop(); }
  function complete() {
    var earned = foodFor((run && run.total) || sessionMs);
    endRun();
    garden.push({ t: nextKind(), w: false, d: Date.now() });
    put(K_GARDEN, garden); justBloomed = Math.min(garden.length, 28) - 1;
    food += earned; put(K_FOOD, food); foodUi();
    $('stMsg').textContent = ''; render();
    setMsg('a new flower bloomed, and you earned ' + earned + ' fish food \uD83C\uDF38\uD83D\uDC1F');
    showIdle(); endSound(); bunnyCheer();
    var r = $('stFlowers').getBoundingClientRect(); hearts(r.left + r.width / 2, r.top + r.height / 2, 10);
    bunnySay('you did it!! \uD83C\uDF89\n' + BREAKS[Math.floor(Math.random() * BREAKS.length)], 18000);
  }
  function giveUp() {
    endRun();
    garden.push({ t: nextKind(), w: true, d: Date.now() });
    put(K_GARDEN, garden); $('stMsg').textContent = ''; render();
    setMsg('that flower is a little droopy, it just needs more sun. no guilt, try again when you\'re ready \uD83D\uDC99');
    showIdle();
  }
  go.addEventListener('click', function () { if (run) giveUp(); else begin(false); });
  var clr = $('stClear');
  if (clr) clr.addEventListener('click', function () { garden = []; food = 0; put(K_GARDEN, garden); put(K_FOOD, food); foodUi(); $('stMsg').textContent = ''; render(); });

  /* ---------- start up ---------- */
  render();
  if (run && typeof run.end === 'number') {
    if (run.end <= Date.now()) complete(); else begin(true);
  } else { run = null; showIdle(); }
})();