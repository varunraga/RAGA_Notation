/* ============================================================
   CA STUDY — single-file app logic. Vanilla JS, no build step.
   Persistence: IndexedDB (db "castudy"). See DB module below.
   ============================================================ */
"use strict";

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
const nowISO = () => new Date().toISOString();
const fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
const fmtDateShort = (iso) => iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—';
const MOBILE_LAYOUT_QUERY = '(max-width:700px), (max-width:1024px) and (max-height:500px)';
function isMobileLayout() { return window.matchMedia(MOBILE_LAYOUT_QUERY).matches; }
function relTime(iso) {
  if (!iso) return '';
  const mins = Math.floor(Math.max(0, Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + 'm ago';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h ago';
  return Math.floor(hrs / 24) + 'd ago';
}
const esc = (s) => (s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const daysFromNow = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString(); };
const isPastOrToday = (iso) => !iso || new Date(iso) <= new Date(new Date().toDateString() + ' 23:59:59');
function stripHtml(html) {
  const div = document.createElement('div');
  div.innerHTML = html || '';
  return (div.textContent || div.innerText || '').replace(/\s+/g, ' ').trim();
}
/* Rich-text toolbar extras (undo/redo, superscript, font color) — shared
   between the main note editor and the PDF "Split with Notes" editor, since
   both are plain contenteditable regions using the same execCommand API.
   Font color needs special care: opening the native <input type=color>
   picker blurs the contenteditable and clears its selection in most
   browsers, so we save the Range on mousedown and restore it on change,
   right before applying the color. */
let _savedEditorRange = null;
function saveEditorSelection() {
  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0) _savedEditorRange = sel.getRangeAt(0).cloneRange();
}
function applyColorToSelection(color) {
  const sel = window.getSelection();
  if (_savedEditorRange) { sel.removeAllRanges(); sel.addRange(_savedEditorRange); }
  document.execCommand('foreColor', false, color);
}
function richTextExtrasHTML() {
  const colors = ['#E5534B', '#D9B24C', '#4FAE71', '#5B9BE0', '#B07CD9'];
  return `
    <button onmousedown="event.preventDefault();document.execCommand('superscript')" title="Superscript — e.g. numbering a point (¹ ² ³) or a footnote marker">x²</button>
    <div class="sep"></div>
    ${colors.map(c => `<span class="draw-color-dot" style="background:${c};" onmousedown="event.preventDefault();document.execCommand('foreColor',false,'${c}')" title="Text color"></span>`).join('')}
    <input type="color" onmousedown="saveEditorSelection()" onchange="applyColorToSelection(this.value)" title="Custom text color" style="width:22px;height:22px;padding:0;border:1px solid var(--border);border-radius:6px;background:none;cursor:pointer;vertical-align:middle;">
    <button onmousedown="event.preventDefault();document.execCommand('foreColor',false,getComputedStyle(document.body).color)" title="Reset text color to default">Aa</button>
    <div class="sep"></div>
    <button onmousedown="event.preventDefault();document.execCommand('undo')" title="Undo (Ctrl/Cmd+Z)">↶ Undo</button>
    <button onmousedown="event.preventDefault();document.execCommand('redo')" title="Redo (Ctrl/Cmd+Shift+Z, or Ctrl+Y)">↷ Redo</button>`;
}
/* PDF text is made of individually-positioned per-word/per-fragment spans
   (that's just how PDF text extraction works), so a raw selection's
   getClientRects() returns one tiny rect per word with gaps between them —
   the "picket fence" look. Real PDF readers merge same-line rects into one
   continuous band; these two helpers do that, one for live DOMRects (at
   the moment of selection, CSS-pixel space) and one for already-stored
   {x,y,w,h} page-space rects (so even old, already-granular highlights
   render/export cleanly without needing any data migration).
   Slight vertical variation between adjacent glyphs (subscripts, accents,
   font metrics) is tolerated within lineTolerance before starting a new line. */
function mergeLineRectsDOM(domRectList, lineTolerance) {
  const tol = lineTolerance || 3;
  const rects = Array.from(domRectList).filter(r => r.width > 0.5 && r.height > 0.5);
  const lines = [];
  rects.forEach(r => {
    let line = lines.find(l => Math.abs(l.top - r.top) < tol && Math.abs(l.height - r.height) < tol);
    if (!line) { line = { top: r.top, height: r.height, left: r.left, right: r.left + r.width }; lines.push(line); }
    else { line.left = Math.min(line.left, r.left); line.right = Math.max(line.right, r.left + r.width); line.top = Math.min(line.top, r.top); line.height = Math.max(line.height, r.height); }
  });
  return lines.map(l => ({ left: l.left, top: l.top, width: l.right - l.left, height: l.height }));
}
function mergeLineRectsXYWH(rects, lineTolerance) {
  const tol = lineTolerance || 2;
  const filtered = (rects || []).filter(r => r.w > 0.3 && r.h > 0.3);
  const lines = [];
  filtered.forEach(r => {
    let line = lines.find(l => Math.abs(l.y - r.y) < tol && Math.abs(l.h - r.h) < tol);
    if (!line) { line = { y: r.y, h: r.h, x: r.x, right: r.x + r.w }; lines.push(line); }
    else { line.x = Math.min(line.x, r.x); line.right = Math.max(line.right, r.x + r.w); line.y = Math.min(line.y, r.y); line.h = Math.max(line.h, r.h); }
  });
  return lines.map(l => ({ x: l.x, y: l.y, w: l.right - l.x, h: l.h }));
}
function downloadText(filename, text, mime) {
  const blob = new Blob([text], { type: mime || 'text/plain' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; a.click();
}
function slugify(s) { return (s || 'note').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'note'; }
function hexToRgbFloat(hex) {
  hex = (hex || '#202A22').replace('#', '');
  if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
  const r = parseInt(hex.substring(0, 2), 16) / 255 || 0;
  const g = parseInt(hex.substring(2, 4), 16) / 255 || 0;
  const b = parseInt(hex.substring(4, 6), 16) / 255 || 0;
  return { r, g, b };
}
function sanitizeHtml(html) {
  const div = document.createElement('div');
  div.innerHTML = html || '';
  div.querySelectorAll('script,style,iframe,object,embed').forEach(el => el.remove());
  div.querySelectorAll('*').forEach(el => {
    [...el.attributes].forEach(attr => { if (/^on/i.test(attr.name) || attr.name === 'srcdoc') el.removeAttribute(attr.name); });
  });
  return div.innerHTML;
}
/* Minimal, dependency-free HTML <-> Markdown conversion, covering exactly the
   tags the note editor itself produces (h2/h3/p/strong/em/u/s/ul/ol/blockquote/
   hr/a/mark/table) plus common tags likely to appear in imported material. */
function htmlToMarkdown(html) {
  const container = document.createElement('div');
  container.innerHTML = html || '';
  function tableToMarkdown(table) {
    const rows = Array.from(table.querySelectorAll('tr')).map(tr => Array.from(tr.children).map(td => td.textContent.trim()));
    if (!rows.length) return '';
    const header = rows[0], body = rows.slice(1);
    let md = '| ' + header.join(' | ') + ' |\n| ' + header.map(() => '---').join(' | ') + ' |\n';
    body.forEach(r => { md += '| ' + r.join(' | ') + ' |\n'; });
    return md;
  }
  function walk(node) {
    let out = '';
    node.childNodes.forEach(child => {
      if (child.nodeType === 3) { out += child.textContent; return; }
      if (child.nodeType !== 1) return;
      const tag = child.tagName.toLowerCase();
      if (tag === 'table') { out += `\n${tableToMarkdown(child)}\n`; return; }
      const inner = walk(child);
      switch (tag) {
        case 'h2': out += `\n## ${inner.trim()}\n`; break;
        case 'h3': out += `\n### ${inner.trim()}\n`; break;
        case 'p': out += `\n${inner.trim()}\n`; break;
        case 'strong': case 'b': out += `**${inner}**`; break;
        case 'em': case 'i': out += `*${inner}*`; break;
        case 'u': out += `_${inner}_`; break;
        case 's': case 'strike': out += `~~${inner}~~`; break;
        case 'mark': out += `==${inner}==`; break;
        case 'blockquote': out += `\n> ${inner.trim().replace(/\n/g, '\n> ')}\n`; break;
        case 'ul': out += `\n` + Array.from(child.children).map(li => `- ${walk(li).trim()}`).join('\n') + `\n`; break;
        case 'ol': out += `\n` + Array.from(child.children).map((li, i) => `${i + 1}. ${walk(li).trim()}`).join('\n') + `\n`; break;
        case 'li': out += inner; break;
        case 'hr': out += `\n---\n`; break;
        case 'br': out += `\n`; break;
        case 'a': out += `[${inner}](${child.getAttribute('href') || ''})`; break;
        default: out += inner;
      }
    });
    return out;
  }
  return walk(container).replace(/\n{3,}/g, '\n\n').trim();
}
function markdownToHtml(md) {
  const lines = (md || '').split(/\r?\n/);
  let html = '', inList = null;
  const closeList = () => { if (inList) { html += `</${inList}>`; inList = null; } };
  const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*(.+?)\*/g, '<em>$1</em>').replace(/`(.+?)`/g, '<code>$1</code>');
  lines.forEach(line => {
    if (/^###\s+/.test(line)) { closeList(); html += `<h3>${inline(line.replace(/^###\s+/, ''))}</h3>`; return; }
    if (/^##\s+/.test(line)) { closeList(); html += `<h2>${inline(line.replace(/^##\s+/, ''))}</h2>`; return; }
    if (/^#\s+/.test(line)) { closeList(); html += `<h2>${inline(line.replace(/^#\s+/, ''))}</h2>`; return; }
    if (/^>\s?/.test(line)) { closeList(); html += `<blockquote>${inline(line.replace(/^>\s?/, ''))}</blockquote>`; return; }
    if (/^---+$/.test(line.trim())) { closeList(); html += `<hr>`; return; }
    if (/^[-*]\s+/.test(line)) { if (inList !== 'ul') { closeList(); html += '<ul>'; inList = 'ul'; } html += `<li>${inline(line.replace(/^[-*]\s+/, ''))}</li>`; return; }
    if (/^\d+\.\s+/.test(line)) { if (inList !== 'ol') { closeList(); html += '<ol>'; inList = 'ol'; } html += `<li>${inline(line.replace(/^\d+\.\s+/, ''))}</li>`; return; }
    if (line.trim() === '') { closeList(); return; }
    closeList(); html += `<p>${inline(line)}</p>`;
  });
  closeList();
  return html || '<p></p>';
}

function toast(msg) {
  const wrap = document.getElementById('toastWrap');
  const el = document.createElement('div');
  el.className = 'toast'; el.textContent = msg;
  wrap.appendChild(el);
  const duration = Math.min(9000, Math.max(2600, msg.length * 60)); // longer messages stay up longer, capped at 9s
  setTimeout(() => el.remove(), duration);
}

/* ============================== DB ============================== */
const STORES = ['courses', 'subjects', 'chapters', 'topics', 'notes', 'pdfs', 'pdfBookmarks',
  'annotations', 'mnemonics', 'jargons', 'questions', 'flashcards', 'bookmarks',
  'studySessions', 'settings', 'trash', 'noteVersions'];

const DB = (() => {
  let db;
  function open() {
    return new Promise((resolve, reject) => {
      // v2 adds the noteVersions store (note version history). onupgradeneeded
      // fires for both brand-new browsers and anyone upgrading from v1, and
      // just creates whatever stores are missing — existing data is untouched.
      const req = indexedDB.open('castudy', 2);
      req.onupgradeneeded = (e) => {
        const d = e.target.result;
        STORES.forEach(name => {
          if (!d.objectStoreNames.contains(name)) d.createObjectStore(name, { keyPath: 'id' });
        });
      };
      req.onsuccess = () => { db = req.result; resolve(db); };
      req.onerror = () => reject(req.error);
    });
  }
  function tx(store, mode = 'readonly') { return db.transaction(store, mode).objectStore(store); }
  const all = (store) => new Promise((res, rej) => { const r = tx(store).getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const get = (store, id) => new Promise((res, rej) => { const r = tx(store).get(id); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const put = (store, obj) => new Promise((res, rej) => { const r = tx(store, 'readwrite').put(obj); r.onsuccess = () => res(obj); r.onerror = () => rej(r.error); });
  const del = (store, id) => new Promise((res, rej) => { const r = tx(store, 'readwrite').delete(id); r.onsuccess = () => res(); r.onerror = () => rej(r.error); });
  const clearStore = (store) => new Promise((res, rej) => { const r = tx(store, 'readwrite').clear(); r.onsuccess = () => res(); r.onerror = () => rej(r.error); });
  return { open, all, get, put, del, clearStore };
})();

/* In-memory cache mirrors IndexedDB for fast sync rendering. */
const Cache = {};
async function loadAllToCache() {
  for (const s of STORES) Cache[s] = await DB.all(s);
}
async function saveItem(store, obj) {
  obj.updatedAt = nowISO();
  await DB.put(store, obj);
  const arr = Cache[store];
  const i = arr.findIndex(x => x.id === obj.id);
  if (i >= 0) arr[i] = obj; else arr.push(obj);
  if (typeof DriveSync !== 'undefined') DriveSync.markDirty();
  return obj;
}
async function trashItem(store, id) {
  const obj = Cache[store].find(x => x.id === id);
  if (!obj) return;
  await DB.put('trash', { id: uid(), type: store, data: obj, deletedAt: nowISO() });
  Cache.trash = await DB.all('trash');
  await DB.del(store, id);
  Cache[store] = Cache[store].filter(x => x.id !== id);
}
async function restoreTrash(trashId) {
  const t = Cache.trash.find(x => x.id === trashId);
  if (!t) return;
  await DB.put(t.type, t.data);
  Cache[t.type] = await DB.all(t.type);
  await DB.del('trash', trashId);
  Cache.trash = Cache.trash.filter(x => x.id !== trashId);
  toast('Restored');
}

/* ============================== SETTINGS ============================== */
// Embedded default: this is a public OAuth Client ID (not a secret — the
// real security boundary is the "Authorized JavaScript origins" allowlist
// configured for it in Google Cloud Console, which only your actual hosted
// URL can pass). Anyone can still override it in Settings if they redeploy
// this app under their own Google Cloud project.
const EMBEDDED_GOOGLE_CLIENT_ID = '343192402137-kb2aoc77kv4enpsf37eaapde1pnua316.apps.googleusercontent.com';
const Settings = {
  defaults: {
    theme: 'dark',
    fontSize: 'md',
    revisionIntervals: [1, 3, 7, 14, 30],
    googleClientId: EMBEDDED_GOOGLE_CLIENT_ID,
    highlightColors: [
      { key: 'y', label: 'Important', color: '#FFD84D' },
      { key: 'g', label: 'Definition', color: '#7FE0A0' },
      { key: 'b', label: 'Concept', color: '#8FC7FA' },
      { key: 'r', label: 'Exam Alert', color: '#FF9585' },
      { key: 'p', label: 'Mnemonic', color: '#D9AEFF' },
      { key: 'o', label: 'Exception', color: '#FFB870' },
    ],
  },
  get(key) {
    const row = Cache.settings.find(s => s.id === key);
    return row ? row.value : this.defaults[key];
  },
  async set(key, value) {
    await saveItem('settings', { id: key, value });
  }
};

const Theme = {
  apply() {
    const t = Settings.get('theme');
    document.documentElement.classList.toggle('light', t === 'light');
  },
  toggle() {
    const cur = Settings.get('theme');
    Settings.set('theme', cur === 'light' ? 'dark' : 'light').then(() => this.apply());
  }
};

/* ============================== ROUTER / UI ============================== */
const UI = {
  route: 'dashboard',
  params: {},
  nav(route, params = {}) {
    this.route = route; this.params = params;
    document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.route === route));
    document.querySelectorAll('.bottom-nav button').forEach(n => n.classList.toggle('active', n.dataset.route === route));
    this.closeSidebar();
    Router.render();
    document.getElementById('content').scrollTop = 0;
  },
  toggleSidebar() {
    document.getElementById('sidebar').classList.toggle('open');
    document.getElementById('scrim').classList.toggle('show');
  },
  closeSidebar() {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('scrim').classList.remove('show');
  },
  newQuick() {
    Modal.open('Quick Add', `
      <div style="display:flex;flex-direction:column;gap:8px;">
        <button class="btn secondary" onclick="Modal.close();Notes.promptNew();" title="Create a new note">📝 New Note</button>
        <button class="btn secondary" onclick="Modal.close();UI.nav('pdfs');" title="Go to the PDF library to upload one">📄 Import PDF</button>
        <button class="btn secondary" onclick="Modal.close();Mnemonics.promptNew();" title="Create a new memory aid">🧠 Add Mnemonic</button>
        <button class="btn secondary" onclick="Modal.close();Jargons.promptNew();" title="Add a term, keyword or abbreviation">🔤 Add Jargon</button>
        <button class="btn secondary" onclick="Modal.close();Questions.promptNew();" title="Add a question to your question bank">❓ Add Question</button>
        <button class="btn secondary" onclick="Modal.close();Notes.importFile();" title="Turn a text, Markdown or HTML file into a note">📥 Import file as Note (.txt/.md/.html)</button>
      </div>`, true);
  }
};

const Modal = {
  open(title, bodyHtml, noFooter) {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop'; backdrop.id = 'modalBackdrop';
    backdrop.onclick = (e) => { if (e.target === backdrop) Modal.close(); };
    backdrop.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}"><h3>${esc(title)}</h3>${bodyHtml}</div>`;
    document.body.appendChild(backdrop);
  },
  close() { const b = document.getElementById('modalBackdrop'); if (b) b.remove(); }
};

/* ============================== COURSE / SUBJECT / CHAPTER / TOPIC TREE ============================== */
const SUBJECT_COLORS = ['#D9B24C', '#E5534B', '#4FAE71', '#5B9BE0', '#B07CD9', '#45B8AC', '#E07BA8', '#E08A45'];
const Courses = {
  promptNew() {
    Modal.open('New Course', `
      <label>Course name</label><input type="text" id="mCourseName" placeholder="e.g. CA Intermediate" title="Course name">
      <div class="modal-actions"><button class="btn secondary" onclick="Modal.close()" title="Discard and close this dialog">Cancel</button>
      <button class="btn" onclick="Courses.create()" title="Create this course">Create</button></div>`);
    setTimeout(() => document.getElementById('mCourseName')?.focus(), 50);
  },
  async create() {
    const name = document.getElementById('mCourseName').value.trim();
    if (!name) return;
    await saveItem('courses', { id: uid(), name, createdAt: nowISO() });
    Modal.close(); Tree.render(); toast('Course created');
  },
  promptNewSubject(courseId) {
    Modal.open('New Subject', `
      <label>Subject name</label><input type="text" id="mSubjectName" placeholder="e.g. GST" title="Subject name">
      <label>Color</label>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px;">
        ${SUBJECT_COLORS.map((c, i) => `<span class="subject-color-swatch ${i === 0 ? 'selected' : ''}" data-color="${c}" style="background:${c};" onclick="Courses.pickSubjectColor(this)" title="Use this color"></span>`).join('')}
      </div>
      <input type="hidden" id="mSubjectColor" value="${SUBJECT_COLORS[0]}">
      <div class="modal-actions"><button class="btn secondary" onclick="Modal.close()" title="Discard and close this dialog">Cancel</button>
      <button class="btn" onclick="Courses.createSubject('${courseId}')" title="Create this subject">Create</button></div>`);
    setTimeout(() => document.getElementById('mSubjectName')?.focus(), 50);
  },
  pickSubjectColor(el) {
    const container = el.parentElement;
    container.querySelectorAll('.subject-color-swatch').forEach(s => s.classList.remove('selected'));
    el.classList.add('selected');
    const hidden = container.parentElement.querySelector('#mSubjectColor');
    if (hidden) hidden.value = el.dataset.color;
  },
  async createSubject(courseId) {
    const name = document.getElementById('mSubjectName').value.trim(); if (!name) return;
    const color = document.getElementById('mSubjectColor').value;
    const order = (Cache.subjects || []).filter(s => s.courseId === courseId).length;
    await saveItem('subjects', { id: uid(), courseId, name, color, order, createdAt: nowISO() });
    Modal.close(); Tree.render(); toast('Subject added');
  },
  editSubjectColor(id) {
    const s = (Cache.subjects || []).find(x => x.id === id); if (!s) return;
    Modal.open(`Color for "${s.name}"`, `
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        ${SUBJECT_COLORS.map(c => `<span class="subject-color-swatch ${c === s.color ? 'selected' : ''}" data-color="${c}" style="background:${c};" onclick="Courses.pickSubjectColor(this)" title="Use this color"></span>`).join('')}
      </div>
      <input type="hidden" id="mSubjectColor" value="${s.color || SUBJECT_COLORS[0]}">
      <div class="modal-actions"><button class="btn secondary" onclick="Modal.close()" title="Cancel">Cancel</button>
      <button class="btn" onclick="Courses.saveSubjectColor('${id}')" title="Save this color">Save</button></div>`);
  },
  async saveSubjectColor(id) {
    const s = (Cache.subjects || []).find(x => x.id === id); if (!s) return;
    s.color = document.getElementById('mSubjectColor').value;
    await saveItem('subjects', s);
    Modal.close(); Tree.render();
  },
  promptNewChapter(subjectId) {
    Modal.open('New Chapter', `
      <label>Chapter name</label><input type="text" id="mChapterName" placeholder="e.g. Input Tax Credit" title="Chapter name">
      <div class="modal-actions"><button class="btn secondary" onclick="Modal.close()" title="Discard and close this dialog">Cancel</button>
      <button class="btn" onclick="Courses.createChapter('${subjectId}')" title="Create this chapter">Create</button></div>`);
    setTimeout(() => document.getElementById('mChapterName')?.focus(), 50);
  },
  async createChapter(subjectId) {
    const name = document.getElementById('mChapterName').value.trim(); if (!name) return;
    const order = (Cache.chapters || []).filter(c => c.subjectId === subjectId).length;
    await saveItem('chapters', { id: uid(), subjectId, name, order, createdAt: nowISO() });
    Modal.close(); Tree.render(); toast('Chapter added');
  },
  promptNewTopic(chapterId) {
    Modal.open('New Topic', `
      <label>Topic name</label><input type="text" id="mTopicName" placeholder="e.g. Section 16 — Eligibility" title="Topic name">
      <div class="modal-actions"><button class="btn secondary" onclick="Modal.close()" title="Discard and close this dialog">Cancel</button>
      <button class="btn" onclick="Courses.createTopic('${chapterId}')" title="Create this topic">Create</button></div>`);
    setTimeout(() => document.getElementById('mTopicName')?.focus(), 50);
  },
  async createTopic(chapterId) {
    const name = document.getElementById('mTopicName').value.trim(); if (!name) return;
    const order = (Cache.topics || []).filter(t => t.chapterId === chapterId).length;
    await saveItem('topics', { id: uid(), chapterId, name, order, createdAt: nowISO() });
    Modal.close(); Tree.render(); toast('Topic added');
  },
  async deleteTopic(id, opts = {}) {
    const t = (Cache.topics || []).find(x => x.id === id); if (!t) return false;
    if (!opts.skipConfirm) {
      const noteCount = (Cache.notes || []).filter(n => n.topicId === id).length;
      const mnemCount = (Cache.mnemonics || []).filter(m => m.topicId === id).length;
      const qCount = (Cache.questions || []).filter(q => q.topicId === id).length;
      if (!confirm(`Delete topic "${t.name}"? ${noteCount} note(s), ${mnemCount} mnemonic(s) and ${qCount} question(s) inside it will be moved to Trash.`)) return false;
    }
    for (const n of (Cache.notes || []).filter(n => n.topicId === id)) await trashItem('notes', n.id);
    for (const m of (Cache.mnemonics || []).filter(m => m.topicId === id)) { await Flashcards.removeForSource('mnemonic', m.id); await trashItem('mnemonics', m.id); }
    for (const q of (Cache.questions || []).filter(q => q.topicId === id)) { await Flashcards.removeForSource('question', q.id); await trashItem('questions', q.id); }
    await DB.del('topics', id);
    Cache.topics = Cache.topics.filter(x => x.id !== id);
    if (!opts.skipConfirm) {
      Tree.render();
      if (UI.route === 'topic' && UI.params.id === id) UI.nav('dashboard');
      toast('Topic deleted');
    }
    return true;
  },
  async deleteChapter(id, opts = {}) {
    const c = (Cache.chapters || []).find(x => x.id === id); if (!c) return false;
    const topics = (Cache.topics || []).filter(t => t.chapterId === id);
    if (!opts.skipConfirm) {
      if (!confirm(`Delete chapter "${c.name}" and all ${topics.length} topic(s) inside it? Notes, mnemonics and questions inside those topics will be moved to Trash.`)) return false;
    }
    const viewingDeletedTopic = UI.route === 'topic' && topics.some(t => t.id === UI.params.id);
    for (const t of topics) await Courses.deleteTopic(t.id, { skipConfirm: true });
    await DB.del('chapters', id);
    Cache.chapters = Cache.chapters.filter(x => x.id !== id);
    if (!opts.skipConfirm) {
      Tree.render();
      if (viewingDeletedTopic) UI.nav('dashboard');
      toast('Chapter deleted');
    }
    return true;
  },
  async deleteSubject(id, opts = {}) {
    const s = (Cache.subjects || []).find(x => x.id === id); if (!s) return false;
    const chapters = (Cache.chapters || []).filter(c => c.subjectId === id);
    const jargons = (Cache.jargons || []).filter(j => j.subjectId === id);
    if (!opts.skipConfirm) {
      if (!confirm(`Delete subject "${s.name}" and everything inside it — ${chapters.length} chapter(s) with their topics, notes, mnemonics and questions (moved to Trash), plus ${jargons.length} jargon(s)? PDFs tagged to this subject will be kept, just un-tagged.`)) return false;
    }
    const topicIdsUnder = chapters.flatMap(c => (Cache.topics || []).filter(t => t.chapterId === c.id).map(t => t.id));
    const viewingDeletedTopic = UI.route === 'topic' && topicIdsUnder.includes(UI.params.id);
    for (const c of chapters) await Courses.deleteChapter(c.id, { skipConfirm: true });
    for (const j of jargons) await trashItem('jargons', j.id);
    for (const p of (Cache.pdfs || []).filter(p => p.subjectId === id)) { p.subjectId = ''; await saveItem('pdfs', p); }
    await DB.del('subjects', id);
    Cache.subjects = Cache.subjects.filter(x => x.id !== id);
    if (!opts.skipConfirm) {
      Tree.render();
      if (viewingDeletedTopic) UI.nav('dashboard');
      toast('Subject deleted');
    }
    return true;
  },
  async deleteCourse(id) {
    const c = (Cache.courses || []).find(x => x.id === id); if (!c) return;
    const subjects = (Cache.subjects || []).filter(s => s.courseId === id);
    if (!confirm(`Delete the course "${c.name}" and everything inside it — ${subjects.length} subject(s) and all their chapters, topics, notes, mnemonics, questions and jargons? The course/subject/chapter/topic structure is removed permanently; notes, mnemonics, questions and jargons go to Trash and can be restored from there.`)) return;
    const allTopicIds = subjects.flatMap(s => (Cache.chapters || []).filter(ch => ch.subjectId === s.id).flatMap(ch => (Cache.topics || []).filter(t => t.chapterId === ch.id).map(t => t.id)));
    const viewingDeletedTopic = UI.route === 'topic' && allTopicIds.includes(UI.params.id);
    for (const s of subjects) await Courses.deleteSubject(s.id, { skipConfirm: true });
    await DB.del('courses', id);
    Cache.courses = Cache.courses.filter(x => x.id !== id);
    Tree.render();
    if (viewingDeletedTopic) UI.nav('dashboard');
    toast('Course deleted');
  }
};

const Tree = {
  /* Tree used to render the sidebar's nested subject list directly — that's
     gone now (see SubjectsHub, the dedicated Subjects page). This module is
     kept for its drag-and-drop reorder logic, reused by SubjectsHub's cards.
     render() is called from many places whenever the subject/chapter/topic
     structure changes (create, delete, reorder) — it just means "something
     changed, refresh whatever's currently showing it". */
  render() { if (UI.route === 'subjects') Router.render(); },
  dragStart(e, kind, id) { e.dataTransfer.setData('text/plain', JSON.stringify({ kind, id })); e.stopPropagation(); },
  allowDrop(e) { e.preventDefault(); e.stopPropagation(); },
  async onDrop(e, kind, store, parentKey, parentId, targetId) {
    e.preventDefault(); e.stopPropagation();
    let data; try { data = JSON.parse(e.dataTransfer.getData('text/plain')); } catch (err) { return; }
    if (!data || data.kind !== kind || data.id === targetId) return;
    const siblings = (Cache[store] || []).filter(x => x[parentKey] === parentId).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const ids = siblings.map(x => x.id).filter(id => id !== data.id);
    const targetIdx = ids.indexOf(targetId);
    if (targetIdx === -1) return;
    ids.splice(targetIdx, 0, data.id);
    for (let i = 0; i < ids.length; i++) {
      const obj = siblings.find(s => s.id === ids[i]);
      if (obj && obj.order !== i) { obj.order = i; await saveItem(store, obj); }
    }
    Tree.render();
  }
};

/* ============================== SUBJECTS HUB ==============================
   The dedicated home for browsing your syllabus — subjects (grouped by
   course, each with its own color and a mastery ring) drilling down into
   chapters, then topics. Replaces the old sidebar tree entirely. */
const SubjectsHub = {
  view: 'overview', // 'overview' | 'subject' | 'chapter'
  subjectId: null, chapterId: null,
  openSubject(id) { this.view = 'subject'; this.subjectId = id; this.chapterId = null; Router.render(); },
  openChapter(id) { this.view = 'chapter'; this.chapterId = id; Router.render(); },
  backToOverview() { this.view = 'overview'; this.subjectId = null; this.chapterId = null; Router.render(); },
  breadcrumb(parts) {
    return `<div class="hub-crumb">${parts.map((p, i) => `${i > 0 ? '<span class="hub-crumb-sep">›</span>' : ''}${p.onclick ? `<span class="hub-crumb-item" onclick="${p.onclick}" title="Go back">${esc(p.label)}</span>` : `<span class="hub-crumb-item current">${esc(p.label)}</span>`}`).join('')}</div>`;
  },
  ring(pct, color, size, strokeW) {
    const r = (size - strokeW) / 2, circ = 2 * Math.PI * r, offset = circ * (1 - pct / 100);
    return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--border)" stroke-width="${strokeW}"/>
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="${strokeW}" stroke-linecap="round"
        stroke-dasharray="${circ}" stroke-dashoffset="${offset}" transform="rotate(-90 ${size / 2} ${size / 2})"/>
    </svg>`;
  },
  render() {
    if (this.view === 'subject' && this.subjectId && (Cache.subjects || []).some(s => s.id === this.subjectId)) return this.renderSubjectDetail();
    if (this.view === 'chapter' && this.chapterId && (Cache.chapters || []).some(c => c.id === this.chapterId)) return this.renderChapterDetail();
    this.view = 'overview';
    return this.renderOverview();
  },
  renderOverview() {
    const courses = Cache.courses || [];
    if (!courses.length) return emptyState('📚', 'Create your first course to start building your syllabus.', 'Create Course', 'Courses.promptNew()');
    return `<div style="display:flex;justify-content:space-between;align-items:baseline;">
      <h2 style="margin:0;">Subjects</h2>
      <button class="btn sm secondary" onclick="Courses.promptNew()" title="Add another course">+ Course</button>
    </div>
    <p class="subtle" style="margin-top:6px;margin-bottom:26px;">Your whole syllabus, at a glance. Click any subject to drill in.</p>
    ${courses.map(c => this.courseSection(c)).join('')}`;
  },
  courseSection(c) {
    const subjects = (Cache.subjects || []).filter(s => s.courseId === c.id).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    return `<div style="margin-bottom:34px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
        <h3 style="margin:0;">📘 ${esc(c.name)}</h3>
        <div class="note-meta-row" style="margin:0;">
          <button class="btn sm secondary" onclick="Courses.promptNewSubject('${c.id}')" title="Add a subject to this course">+ Subject</button>
          <button class="btn sm secondary" onclick="Courses.deleteCourse('${c.id}')" title="Delete this whole course">Delete course</button>
        </div>
      </div>
      ${subjects.length ? `<div class="subject-grid">${subjects.map(s => this.subjectCard(s)).join('')}</div>` : `<div class="subtle">No subjects yet — click "+ Subject" to add one.</div>`}
    </div>`;
  },
  subjectCard(s) {
    const chapters = (Cache.chapters || []).filter(c => c.subjectId === s.id);
    const topics = chapters.flatMap(c => (Cache.topics || []).filter(t => t.chapterId === c.id));
    const notes = (Cache.notes || []).filter(n => n.subjectId === s.id);
    const mastered = notes.filter(n => n.status === 'mastered').length;
    const pct = notes.length ? Math.round((mastered / notes.length) * 100) : 0;
    const color = s.color || SUBJECT_COLORS[0];
    return `<div class="subject-card" draggable="true"
      ondragstart="Tree.dragStart(event,'subject','${s.id}')" ondragover="Tree.allowDrop(event)"
      ondrop="Tree.onDrop(event,'subject','subjects','courseId','${s.courseId}','${s.id}')"
      onclick="SubjectsHub.openSubject('${s.id}')" style="border-top-color:${color};" title="Open ${esc(s.name)}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
        <div class="subject-card-name">${esc(s.name)}</div>
        ${this.ring(pct, color, 44, 5)}
      </div>
      <div class="subject-card-stats">
        <span>${chapters.length} chapter${chapters.length === 1 ? '' : 's'}</span>
        <span>${topics.length} topic${topics.length === 1 ? '' : 's'}</span>
        <span>${notes.length} note${notes.length === 1 ? '' : 's'}</span>
      </div>
      <span class="del-mini" style="position:absolute;top:10px;right:10px;" onclick="event.stopPropagation();Courses.deleteSubject('${s.id}')" title="Delete this subject">✕</span>
    </div>`;
  },
  renderSubjectDetail() {
    const s = (Cache.subjects || []).find(x => x.id === this.subjectId);
    const course = (Cache.courses || []).find(c => c.id === s.courseId);
    const chapters = (Cache.chapters || []).filter(c => c.subjectId === s.id).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const notes = (Cache.notes || []).filter(n => n.subjectId === s.id);
    const questions = (Cache.questions || []).filter(q => q.subjectId === s.id);
    const mastered = notes.filter(n => n.status === 'mastered').length;
    const pct = notes.length ? Math.round((mastered / notes.length) * 100) : 0;
    const color = s.color || SUBJECT_COLORS[0];
    return `${this.breadcrumb([{ label: 'Subjects', onclick: "SubjectsHub.backToOverview()" }, { label: course?.name || '' }, { label: s.name }])}
    <div class="subject-hero" style="border-top-color:${color};">
      <div>
        <h2 style="margin:0 0 8px;">${esc(s.name)}</h2>
        <div class="note-meta-row">
          <span class="pill">${chapters.length} chapter${chapters.length === 1 ? '' : 's'}</span>
          <span class="pill">${notes.length} note${notes.length === 1 ? '' : 's'}</span>
          <span class="pill">${questions.length} question${questions.length === 1 ? '' : 's'}</span>
        </div>
        <div class="note-meta-row" style="margin-top:16px;">
          <button class="btn sm" onclick="Courses.promptNewChapter('${s.id}')" title="Add a chapter to this subject">+ Chapter</button>
          <button class="btn sm secondary" onclick="Courses.editSubjectColor('${s.id}')" title="Change this subject's color">🎨 Color</button>
          <button class="btn sm secondary" onclick="Courses.deleteSubject('${s.id}')" title="Delete this subject">Delete subject</button>
        </div>
      </div>
      <div style="position:relative;display:flex;align-items:center;justify-content:center;">
        ${this.ring(pct, color, 92, 8)}
        <div style="position:absolute;text-align:center;font-family:var(--mono);"><b style="font-size:20px;">${pct}%</b><br><span style="font-size:10px;color:var(--text-dim);">mastered</span></div>
      </div>
    </div>
    <h3 style="margin-top:26px;">Chapters</h3>
    ${chapters.length ? chapters.map(c => this.chapterRow(c)).join('') : '<div class="subtle">No chapters yet — click "+ Chapter" above to add one.</div>'}`;
  },
  chapterRow(c) {
    const topics = (Cache.topics || []).filter(t => t.chapterId === c.id);
    const notes = topics.flatMap(t => (Cache.notes || []).filter(n => n.topicId === t.id));
    return `<div class="list-row" draggable="true"
      ondragstart="Tree.dragStart(event,'chapter','${c.id}')" ondragover="Tree.allowDrop(event)"
      ondrop="Tree.onDrop(event,'chapter','chapters','subjectId','${c.subjectId}','${c.id}')"
      onclick="SubjectsHub.openChapter('${c.id}')" title="Open this chapter">
      <span>📖</span>
      <div style="flex:1;">${esc(c.name)}<div class="subtle">${topics.length} topic${topics.length === 1 ? '' : 's'} · ${notes.length} note${notes.length === 1 ? '' : 's'}</div></div>
      <span class="del-mini" onclick="event.stopPropagation();Courses.deleteChapter('${c.id}')" title="Delete this chapter">✕</span>
    </div>`;
  },
  renderChapterDetail() {
    const c = (Cache.chapters || []).find(x => x.id === this.chapterId);
    const s = (Cache.subjects || []).find(x => x.id === c.subjectId);
    const topics = (Cache.topics || []).filter(t => t.chapterId === c.id).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    return `${this.breadcrumb([{ label: 'Subjects', onclick: "SubjectsHub.backToOverview()" }, { label: s?.name || '', onclick: `SubjectsHub.openSubject('${s?.id}')` }, { label: c.name }])}
    <div style="display:flex;justify-content:space-between;align-items:center;margin:16px 0;">
      <h2 style="margin:0;">${esc(c.name)}</h2>
      <div class="note-meta-row" style="margin:0;">
        <button class="btn sm" onclick="Courses.promptNewTopic('${c.id}')" title="Add a topic to this chapter">+ Topic</button>
        <button class="btn sm secondary" onclick="Courses.deleteChapter('${c.id}')" title="Delete this chapter">Delete chapter</button>
      </div>
    </div>
    ${topics.length ? topics.map(t => this.topicRow(t)).join('') : '<div class="subtle">No topics yet — click "+ Topic" above to add one.</div>'}`;
  },
  topicRow(t) {
    const notes = (Cache.notes || []).filter(n => n.topicId === t.id);
    const mnemonics = (Cache.mnemonics || []).filter(m => m.topicId === t.id);
    const questions = (Cache.questions || []).filter(q => q.topicId === t.id);
    return `<div class="list-row" draggable="true"
      ondragstart="Tree.dragStart(event,'topic','${t.id}')" ondragover="Tree.allowDrop(event)"
      ondrop="Tree.onDrop(event,'topic','topics','chapterId','${t.chapterId}','${t.id}')"
      onclick="UI.nav('topic',{id:'${t.id}'})" title="Open this topic">
      <span>📄</span>
      <div style="flex:1;">${esc(t.name)}<div class="subtle">${notes.length} note${notes.length === 1 ? '' : 's'} · ${mnemonics.length} mnemonic${mnemonics.length === 1 ? '' : 's'} · ${questions.length} question${questions.length === 1 ? '' : 's'}</div></div>
      <span class="del-mini" onclick="event.stopPropagation();Courses.deleteTopic('${t.id}')" title="Delete this topic">✕</span>
    </div>`;
  }
};

function chapterName(id) { return (Cache.chapters || []).find(c => c.id === id)?.name || '—'; }
function subjectName(id) { return (Cache.subjects || []).find(s => s.id === id)?.name || '—'; }
function topicName(id) { return (Cache.topics || []).find(t => t.id === id)?.name || '—'; }
function topicSubjectId(topicId) {
  const t = (Cache.topics || []).find(x => x.id === topicId);
  const c = t ? (Cache.chapters || []).find(x => x.id === t.chapterId) : null;
  return c ? c.subjectId : '';
}
function subjectOptions(selected) {
  return (Cache.subjects || []).map(s => `<option value="${s.id}" ${s.id === selected ? 'selected' : ''}>${esc(s.name)}</option>`).join('');
}
function chapterOptions(selected) {
  return (Cache.chapters || []).map(c => `<option value="${c.id}" ${c.id === selected ? 'selected' : ''}>${esc(c.name)} (${esc(subjectName(c.subjectId))})</option>`).join('');
}
function topicOptions(selected) {
  return (Cache.topics || []).map(t => `<option value="${t.id}" ${t.id === selected ? 'selected' : ''}>${esc(t.name)}</option>`).join('');
}

/* ============================== REVISION ENGINE ============================== */
const Revision = {
  intervals() { return Settings.get('revisionIntervals'); },
  schedule(idx) {
    const iv = this.intervals();
    const i = Math.min(idx, iv.length - 1);
    return { nextDate: daysFromNow(iv[i]), stage: i };
  },
  dueItems() {
    const items = [];
    (Cache.notes || []).forEach(n => { if (n.revision?.nextDate && isPastOrToday(n.revision.nextDate) && n.status !== 'mastered') items.push({ type: 'note', obj: n }); });
    // Flashcards (auto-generated from Questions & Mnemonics) are due once their
    // scheduled date arrives — and also the very first time, since a flashcard
    // has no separate detail page to rate it from the way a note does.
    (Cache.flashcards || []).forEach(f => { if (f.nextDate == null || isPastOrToday(f.nextDate)) items.push({ type: 'flashcard', obj: f }); });
    return items;
  },
  async rate(type, id, rating) {
    // rating: again|hard|good|easy
    const store = type === 'note' ? 'notes' : 'flashcards';
    const obj = Cache[store].find(x => x.id === id);
    if (!obj) return;
    if (type !== 'flashcard') obj.revision = obj.revision || { stage: 0 };
    let stage = (type === 'flashcard' ? obj.stage : obj.revision.stage) || 0;
    if (rating === 'again') stage = 0;
    else if (rating === 'hard') stage = Math.max(0, stage - 1);
    else if (rating === 'good') stage = stage + 1;
    else if (rating === 'easy') stage = stage + 2;
    const sched = this.schedule(stage);
    if (type === 'flashcard') { obj.stage = sched.stage; obj.nextDate = sched.nextDate; obj.history = obj.history || []; obj.history.push({ date: nowISO(), rating }); }
    else { obj.revision.stage = sched.stage; obj.revision.nextDate = sched.nextDate; obj.revision.history = obj.revision.history || []; obj.revision.history.push({ date: nowISO(), rating }); }
    await saveItem(store, obj);
    updateRevBadge();
  }
};
function updateRevBadge() {
  const n = Revision.dueItems().length;
  const b = document.getElementById('revBadge');
  if (b) { b.textContent = n; b.style.display = n ? 'inline-block' : 'none'; }
}

/* Auto-generated flashcards, kept in sync with their source Question/Mnemonic.
   This is the "front/back" deck the spec asks for — Questions and Mnemonics
   themselves no longer carry their own separate revision schedule. */
const Flashcards = {
  findFor(sourceType, sourceId) {
    return (Cache.flashcards || []).find(f => f.sourceType === sourceType && f.sourceId === sourceId);
  },
  async generateForQuestion(q) {
    const front = q.questionText;
    const back = (q.modelAnswer && q.modelAnswer.trim()) ? q.modelAnswer : '(No model answer recorded)';
    const existing = this.findFor('question', q.id);
    if (existing) { existing.front = front; existing.back = back; return saveItem('flashcards', existing); }
    return saveItem('flashcards', { id: uid(), front, back, sourceType: 'question', sourceId: q.id, stage: -1, nextDate: null, createdAt: nowISO() });
  },
  async generateForMnemonic(m) {
    const front = `Mnemonic for "${m.title}"?`;
    const back = `${m.mnemonicText}${m.meaning ? '\n' + m.meaning : ''}`;
    const existing = this.findFor('mnemonic', m.id);
    if (existing) { existing.front = front; existing.back = back; return saveItem('flashcards', existing); }
    return saveItem('flashcards', { id: uid(), front, back, sourceType: 'mnemonic', sourceId: m.id, stage: -1, nextDate: null, createdAt: nowISO() });
  },
  async removeForSource(sourceType, sourceId) {
    const fc = this.findFor(sourceType, sourceId);
    if (!fc) return;
    await DB.del('flashcards', fc.id);
    Cache.flashcards = Cache.flashcards.filter(f => f.id !== fc.id);
  }
};

/* ============================== NOTES ============================== */
const Notes = {
  promptNew(topicId) {
    const t = topicId || UI.params.id;
    Modal.open('New Note', `
      <label>Title</label><input type="text" id="mNoteTitle" placeholder="e.g. Conditions for ITC" title="Note title">
      <label>Topic</label><select id="mNoteTopic" title="Which topic this note belongs to">${topicOptions(t)}</select>
      <div class="modal-actions"><button class="btn secondary" onclick="Modal.close()" title="Discard and close this dialog">Cancel</button>
      <button class="btn" onclick="Notes.create()" title="Create this note">Create</button></div>`);
    setTimeout(() => document.getElementById('mNoteTitle')?.focus(), 50);
  },
  async create() {
    const title = document.getElementById('mNoteTitle').value.trim() || 'Untitled note';
    const topicId = document.getElementById('mNoteTopic').value;
    const topic = (Cache.topics || []).find(t => t.id === topicId);
    const chapter = topic ? (Cache.chapters || []).find(c => c.id === topic.chapterId) : null;
    const order = (Cache.notes || []).filter(n => n.topicId === topicId).length;
    const note = {
      id: uid(), title, topicId, chapterId: chapter?.id, subjectId: chapter?.subjectId, order,
      content: '<p>Start typing…</p>', tags: [], importance: 3, examFrequency: 'medium', status: 'learning',
      createdAt: nowISO(), revision: { stage: -1, nextDate: null }
    };
    await saveItem('notes', note);
    Modal.close();
    UI.nav('note', { id: note.id });
  },
  render(id) {
    const note = Cache.notes.find(n => n.id === id);
    if (!note) return `<div class="empty-state"><h3>Note not found</h3></div>`;
    const annots = (Cache.annotations || []).filter(a => a.targetType === 'note' && a.targetId === id);
    const linkedMnemonics = (Cache.mnemonics || []).filter(m => m.topicId === note.topicId);
    const linkedQuestions = (Cache.questions || []).filter(q => q.topicId === note.topicId);
    const relatedJargons = (Cache.jargons || []).filter(j => note.subjectId && j.subjectId === note.subjectId);
    const relatedPdfs = (Cache.pdfs || []).filter(p => note.subjectId && p.subjectId === note.subjectId);
    const colors = Settings.get('highlightColors');
    return `
    <div class="two-col">
      <div>
        <input class="note-title-input" value="${esc(note.title)}" oninput="Notes.updateTitle('${id}', this.value)" title="Note title">
        <div class="note-meta-row subtle">
          ${subjectName(note.subjectId)} › ${chapterName(note.chapterId)} › ${topicName(note.topicId)}
        </div>
        <div class="note-meta-row" style="margin-top:8px;cursor:pointer;" onclick="Notes.editMeta('${id}')" title="Click to edit importance, exam frequency, status and tags">
          <span class="pill">Importance <span class="stars">${'★'.repeat(note.importance)}${'☆'.repeat(5 - note.importance)}</span></span>
          <span class="pill ${note.examFrequency === 'high' ? 'warn' : ''}">Exam freq: ${note.examFrequency}</span>
          <span class="pill">${note.status}</span>
          ${(note.tags || []).map(t => `<span class="tag">#${esc(t)}</span>`).join('')}
          <span class="tag" style="border-style:dashed;">✎ edit</span>
        </div>
        <div class="editor-toolbar">
          <button onclick="document.execCommand('bold')" aria-label="Bold" title="Bold (Ctrl/Cmd+B)"><b>B</b></button>
          <button onclick="document.execCommand('italic')" aria-label="Italic" title="Italic (Ctrl/Cmd+I)"><i>I</i></button>
          <button onclick="document.execCommand('underline')" aria-label="Underline" title="Underline (Ctrl/Cmd+U)"><u>U</u></button>
          <button onclick="document.execCommand('strikeThrough')" aria-label="Strikethrough" title="Strikethrough"><s>S</s></button>
          <div class="sep"></div>
          ${richTextExtrasHTML()}
          <div class="sep"></div>
          <button onclick="document.execCommand('formatBlock',false,'H2')" title="Heading 2 — large section heading">H2</button>
          <button onclick="document.execCommand('formatBlock',false,'H3')" title="Heading 3 — smaller sub-heading">H3</button>
          <button onclick="document.execCommand('formatBlock',false,'P')" title="Paragraph — plain body text">¶</button>
          <div class="sep"></div>
          <button onclick="document.execCommand('insertUnorderedList')" title="Bullet list">• List</button>
          <button onclick="document.execCommand('insertOrderedList')" title="Numbered list">1. List</button>
          <button onclick="document.execCommand('formatBlock',false,'BLOCKQUOTE')" title="Quote block — for asides or exact wording">❝ Quote</button>
          <button onclick="document.execCommand('insertHorizontalRule')" title="Horizontal rule — divides the note into sections">―</button>
          <div class="sep"></div>
          <button onclick="Notes.insertTable('${id}')" title="Insert a 2×2 table">▦ Table</button>
          <button onclick="Notes.insertLink()" title="Turn selected text into a link">🔗 Link</button>
          <div class="sep"></div>
          <button onclick="Focus.enter()" title="Focus Mode — hide the sidebar and menus for distraction-free writing (Esc to exit)">🕶 Focus</button>
        </div>
        <div class="editor-body" id="editorBody" contenteditable="true" aria-label="Note content"
             oninput="Notes.onEdit('${id}')" onmouseup="Notes.onSelect(event,'${id}')" onkeyup="Notes.onSelect(event,'${id}')">${note.content}</div>
        <div class="save-status" id="saveStatus">Saved</div>
      </div>
      <div class="inspector">
        <div class="block">
          <h4>Highlight legend</h4>
          ${colors.map(c => `<span class="tag" style="border-color:${c.color}"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${c.color};margin-right:4px;"></span>${c.label}</span>`).join('')}
        </div>
        <div class="block">
          <h4>Annotations (${annots.length})</h4>
          ${annots.length ? annots.map(a => `<div class="card" style="padding:8px;margin-bottom:6px;font-size:13px;"><b>${esc(a.type)}</b>: ${esc(a.comment)}
            <div style="text-align:right;"><button class="btn sm secondary" onclick="Notes.deleteAnnotation('${a.id}','${id}')" title="Delete this annotation">✕</button></div></div>`).join('') : `<div class="subtle">None yet — select text to annotate.</div>`}
        </div>
        <div class="block">
          <h4>Revision</h4>
          <div class="subtle">Next: ${note.revision?.nextDate ? fmtDate(note.revision.nextDate) : 'Not scheduled'}</div>
          <div class="rate-row" style="margin-top:8px;">
            <button class="btn sm secondary" onclick="Revision.rate('note','${id}','again');Router.render();" title="Forgot it — review again soon">Again</button>
            <button class="btn sm secondary" onclick="Revision.rate('note','${id}','good');Router.render();" title="Got it — review on the normal schedule">Good</button>
            <button class="btn sm secondary" onclick="Revision.rate('note','${id}','easy');Router.render();" title="Knew it well — push the next review out further">Easy</button>
          </div>
        </div>
        <div class="block">
          <h4>Linked mnemonics</h4>
          ${linkedMnemonics.length ? linkedMnemonics.map(m => `<div class="subtle">🧠 ${esc(m.title)}</div>`).join('') : `<div class="subtle">None linked.</div>`}
          <button class="btn sm secondary" style="margin-top:6px;" onclick="Mnemonics.promptNew('${note.topicId}')" title="Create a mnemonic for this topic">+ Add mnemonic</button>
        </div>
        <div class="block">
          <h4>Linked questions</h4>
          ${linkedQuestions.length ? linkedQuestions.map(q => `<div class="subtle">❓ ${esc(q.questionText.slice(0, 40))}…</div>`).join('') : `<div class="subtle">None linked.</div>`}
          <button class="btn sm secondary" style="margin-top:6px;" onclick="Questions.promptNew('${note.topicId}')" title="Add a question for this topic">+ Add question</button>
        </div>
        <div class="block">
          <h4>Related content</h4>
          ${relatedJargons.length ? relatedJargons.map(j => `<div class="subtle" style="cursor:pointer;" onclick="UI.nav('jargons')" title="Open Jargons">🔤 ${esc(j.term)}</div>`).join('') : ''}
          ${relatedPdfs.length ? relatedPdfs.map(p => `<div class="subtle" style="cursor:pointer;" onclick="UI.nav('pdf',{id:'${p.id}'})" title="Open this PDF">📄 ${esc(p.title)}</div>`).join('') : ''}
          ${(!relatedJargons.length && !relatedPdfs.length) ? '<div class="subtle">Nothing else tagged to this subject yet.</div>' : ''}
        </div>
        <div class="block">
          <h4>Export &amp; history</h4>
          <button class="btn sm secondary" onclick="Notes.exportMarkdown('${id}')" title="Download this note as a Markdown file">⬇ Markdown</button>
          <button class="btn sm secondary" onclick="Notes.exportHtml('${id}')" title="Download this note as an HTML file">⬇ HTML</button>
          <button class="btn sm secondary" style="margin-top:6px;" onclick="Notes.showHistory('${id}')" title="See and restore earlier versions of this note">🕘 Version history</button>
        </div>
        <div class="block">
          <button class="btn secondary sm" onclick="Bookmarks.add('note','${id}','${esc(note.title)}')" title="Save this note to your Bookmarks">🔖 Bookmark this note</button>
          <button class="btn danger sm" style="margin-top:6px;" onclick="Notes.remove('${id}')" title="Move this note to Trash">Delete note</button>
        </div>
      </div>
    </div>`;
  },
  updateTitle: debounce(async (id, val) => {
    const n = Cache.notes.find(x => x.id === id); if (!n) return; n.title = val || 'Untitled';
    await saveItem('notes', n);
  }, 400),
  lastVersionSaved: {}, // noteId -> timestamp, throttles how often a version snapshot is taken
  onEdit: debounce(async function (id) {
    const status = document.getElementById('saveStatus');
    if (status) status.textContent = 'Saving…';
    const n = Cache.notes.find(x => x.id === id); if (!n) return;
    n.content = document.getElementById('editorBody').innerHTML;
    await saveItem('notes', n);
    if (status) status.textContent = 'Saved · ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const last = Notes.lastVersionSaved[id] || 0;
    if (Date.now() - last > 3 * 60 * 1000) { // at most one snapshot every 3 minutes per note
      Notes.lastVersionSaved[id] = Date.now();
      await Notes.saveVersionSnapshot(n);
    }
  }, 600),
  async saveVersionSnapshot(n) {
    await saveItem('noteVersions', { id: uid(), noteId: n.id, title: n.title, content: n.content, createdAt: nowISO() });
    Cache.noteVersions = Cache.noteVersions || [];
    Cache.noteVersions = await DB.all('noteVersions');
    // keep at most the 20 most recent snapshots per note
    const versions = Cache.noteVersions.filter(v => v.noteId === n.id).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    for (const stale of versions.slice(20)) {
      await DB.del('noteVersions', stale.id);
    }
    Cache.noteVersions = await DB.all('noteVersions');
  },
  showHistory(id) {
    const versions = (Cache.noteVersions || []).filter(v => v.noteId === id).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    Modal.open('Version history', versions.length ? `
      <div style="max-height:50vh;overflow-y:auto;">
        ${versions.map(v => `<div class="list-row" style="padding:8px 4px;">
          <div style="flex:1;">${fmtDate(v.createdAt)} · ${new Date(v.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}<div class="subtle">${esc(v.title)}</div></div>
          <button class="btn sm secondary" onclick="Notes.previewVersion('${v.id}')" title="View this version without changing your current note">Preview</button>
          <button class="btn sm secondary" onclick="Notes.restoreVersion('${id}','${v.id}')" title="Replace your current content with this version (your current version is saved first)">Restore</button>
        </div>`).join('')}
      </div>
      <div class="modal-actions"><button class="btn secondary" onclick="Modal.close()" title="Close this dialog">Close</button></div>` :
      `<p class="subtle">No earlier versions yet — they're captured automatically as you edit (roughly every few minutes of active writing).</p>
      <div class="modal-actions"><button class="btn secondary" onclick="Modal.close()" title="Close this dialog">Close</button></div>`, true);
  },
  previewVersion(versionId) {
    const v = (Cache.noteVersions || []).find(x => x.id === versionId); if (!v) return;
    Modal.open(`Preview · ${fmtDate(v.createdAt)}`, `
      <div class="subtle" style="margin-bottom:8px;">${esc(v.title)}</div>
      <div style="max-height:50vh;overflow-y:auto;border:1px solid var(--border);border-radius:8px;padding:10px;">${v.content}</div>
      <div class="modal-actions"><button class="btn secondary" onclick="Modal.close()" title="Close this dialog">Close</button></div>`, true);
  },
  async restoreVersion(noteId, versionId) {
    if (!confirm('Restore this version? Your current content will be saved as a version too, so nothing is lost.')) return;
    const n = Cache.notes.find(x => x.id === noteId); if (!n) return;
    await Notes.saveVersionSnapshot(n); // preserve current state before overwriting
    const v = (Cache.noteVersions || []).find(x => x.id === versionId); if (!v) return;
    n.title = v.title; n.content = v.content;
    await saveItem('notes', n);
    Modal.close();
    toast('Version restored');
    Router.render();
  },
  exportMarkdown(id) {
    const n = Cache.notes.find(x => x.id === id); if (!n) return;
    downloadText(`${slugify(n.title)}.md`, `# ${n.title}\n\n${htmlToMarkdown(n.content)}\n`, 'text/markdown');
  },
  exportHtml(id) {
    const n = Cache.notes.find(x => x.id === id); if (!n) return;
    downloadText(`${slugify(n.title)}.html`, `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(n.title)}</title></head><body><h1>${esc(n.title)}</h1>${n.content}</body></html>`, 'text/html');
  },
  importFile() { document.getElementById('noteImportInput')?.click(); },
  async handleImportFile(input) {
    const file = input.files[0]; if (!file) return;
    const text = await file.text();
    const ext = file.name.split('.').pop().toLowerCase();
    let contentHtml;
    if (ext === 'html' || ext === 'htm') contentHtml = sanitizeHtml(text);
    else if (ext === 'md' || ext === 'markdown') contentHtml = markdownToHtml(text);
    else contentHtml = text.split(/\r?\n\s*\r?\n/).map(p => `<p>${esc(p).replace(/\r?\n/g, '<br>')}</p>`).join('') || '<p></p>';
    Notes._pendingImportHtml = contentHtml;
    input.value = '';
    const title = file.name.replace(/\.[^.]+$/, '');
    Modal.open('Import as Note', `
      <p class="subtle">Imported from ${esc(file.name)}.</p>
      <label>Title</label><input type="text" id="mImportTitle" value="${esc(title)}" title="Title for the imported note">
      <label>Topic</label><select id="mImportTopic" title="Which topic this imported note belongs to">${topicOptions()}</select>
      <div class="modal-actions"><button class="btn secondary" onclick="Modal.close()" title="Discard and close this dialog">Cancel</button>
      <button class="btn" onclick="Notes.finishImport()" title="Create the note from this file">Import</button></div>`);
  },
  async finishImport() {
    const title = document.getElementById('mImportTitle').value.trim() || 'Imported note';
    const topicId = document.getElementById('mImportTopic').value;
    const topic = (Cache.topics || []).find(t => t.id === topicId);
    const chapter = topic ? (Cache.chapters || []).find(c => c.id === topic.chapterId) : null;
    const note = await saveItem('notes', {
      id: uid(), title, topicId, chapterId: chapter?.id, subjectId: chapter?.subjectId,
      content: Notes._pendingImportHtml || '<p></p>', tags: [], importance: 3, examFrequency: 'medium', status: 'learning',
      createdAt: nowISO(), revision: { stage: -1, nextDate: null }
    });
    Notes._pendingImportHtml = null;
    Modal.close(); toast('Note imported');
    UI.nav('note', { id: note.id });
  },
  insertTable() {
    document.execCommand('insertHTML', false, `<table><tr><td>Cell</td><td>Cell</td></tr><tr><td>Cell</td><td>Cell</td></tr></table><p><br></p>`);
  },
  insertLink() {
    const url = prompt('URL?'); if (url) document.execCommand('createLink', false, url);
  },
  onSelect(e, noteId) {
    const sel = window.getSelection();
    const existing = document.getElementById('selToolbar');
    if (existing) existing.remove();
    if (!sel || sel.isCollapsed || !sel.toString().trim()) return;
    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    const colors = Settings.get('highlightColors');
    const bar = document.createElement('div');
    bar.id = 'selToolbar'; bar.className = 'sel-toolbar';
    bar.style.top = (rect.top + window.scrollY - 40) + 'px';
    bar.style.left = (rect.left + window.scrollX) + 'px';
    bar.innerHTML = colors.map(c => `<button title="${esc(c.label)}" onmousedown="event.preventDefault();Notes.highlight('${c.key}')">${['🟡','🟢','🔵','🔴','🟣','🟠'][colors.indexOf(c)] || '●'}</button>`).join('')
      + `<button onmousedown="event.preventDefault();Notes.annotate('${noteId}')">💬 Note</button>`;
    document.body.appendChild(bar);
  },
  highlight(colorKey) {
    const sel = window.getSelection(); if (!sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    const mark = document.createElement('mark'); mark.className = colorKey;
    try { range.surroundContents(mark); } catch (e) { mark.appendChild(range.extractContents()); range.insertNode(mark); }
    sel.removeAllRanges();
    document.getElementById('selToolbar')?.remove();
    const id = UI.params.id; Notes.onEdit(id);
  },
  async annotate(noteId) {
    const sel = window.getSelection();
    const text = sel.toString();
    document.getElementById('selToolbar')?.remove();
    const comment = prompt('Annotation (comment / doubt / exam tip):');
    if (!comment) return;
    await saveItem('annotations', { id: uid(), targetType: 'note', targetId: noteId, type: 'comment', text: text.slice(0, 80), comment, createdAt: nowISO() });
    // mark the flag inline
    const range = sel.rangeCount ? sel.getRangeAt(0) : null;
    if (range) {
      const span = document.createElement('span'); span.className = 'annot-flag'; span.title = comment; span.textContent = '💬';
      try { range.collapse(false); range.insertNode(span); } catch (e) { }
    }
    Notes.onEdit(noteId);
    Router.render();
  },
  async deleteAnnotation(annotId, noteId) {
    await DB.del('annotations', annotId);
    Cache.annotations = Cache.annotations.filter(a => a.id !== annotId);
    Router.render();
  },
  async remove(id) { if (!confirm('Move this note to Trash?')) return; await trashItem('notes', id); UI.nav('dashboard'); toast('Note moved to Trash'); },
  editMeta(id) {
    const n = Cache.notes.find(x => x.id === id);
    Modal.open('Edit note details', `
      <label>Importance (1-5)</label><input type="number" id="mImp" min="1" max="5" value="${n.importance}" title="Importance, 1 (low) to 5 (high)">
      <label>Exam frequency</label><select id="mFreq" title="How often this comes up in exams"><option ${n.examFrequency === 'low' ? 'selected' : ''}>low</option><option ${n.examFrequency === 'medium' ? 'selected' : ''}>medium</option><option ${n.examFrequency === 'high' ? 'selected' : ''}>high</option></select>
      <label>Status</label><select id="mStatus" title="Your current study status for this note">
        <option ${n.status === 'learning' ? 'selected' : ''} title="First time studying this">learning</option>
        <option ${n.status === 'familiar' ? 'selected' : ''} title="Completed it once — needs revision to solidify">familiar</option>
        <option ${n.status === 'moderate' ? 'selected' : ''} title="Not too hard — needs a little more attention and revision">moderate</option>
        <option ${n.status === 'difficult' ? 'selected' : ''} title="Needs more practice, more time, more revision">difficult</option>
        <option ${n.status === 'mastered' ? 'selected' : ''} title="Understood well, practiced enough — just last-minute revision needed">mastered</option>
      </select>
      <label>Tags (comma separated)</label><input type="text" id="mTags" value="${(n.tags || []).join(', ')}" title="Comma-separated tags">
      <div class="modal-actions"><button class="btn secondary" onclick="Modal.close()" title="Discard and close this dialog">Cancel</button><button class="btn" onclick="Notes.saveMeta('${id}')" title="Save these details">Save</button></div>`);
  },
  async saveMeta(id) {
    const n = Cache.notes.find(x => x.id === id);
    n.importance = parseInt(document.getElementById('mImp').value) || 3;
    n.examFrequency = document.getElementById('mFreq').value;
    n.status = document.getElementById('mStatus').value;
    n.tags = document.getElementById('mTags').value.split(',').map(t => t.trim()).filter(Boolean);
    await saveItem('notes', n); Modal.close(); Router.render();
  }
};

/* ============================== MNEMONICS ============================== */
const Mnemonics = {
  promptNew(topicId) {
    Modal.open('New Mnemonic', `
      <label>Title</label><input type="text" id="mTitle" placeholder="e.g. ITC Conditions" title="Mnemonic title">
      <label>Mnemonic</label><input type="text" id="mCode" placeholder="e.g. RITE" title="The memory code itself">
      <label>Meaning (one line per letter)</label><textarea id="mMeaning" rows="4" placeholder="R = Registered person&#10;I = Invoice&#10;T = Tax paid&#10;E = Eligible use"></textarea>
      <label>Topic</label><select id="mTopic" title="Which topic this mnemonic belongs to">${topicOptions(topicId)}</select>
      <div class="modal-actions"><button class="btn secondary" onclick="Modal.close()" title="Discard and close this dialog">Cancel</button><button class="btn" onclick="Mnemonics.create()" title="Save this mnemonic">Save</button></div>`);
  },
  async create() {
    const title = document.getElementById('mTitle').value.trim(); if (!title) return;
    const m = await saveItem('mnemonics', {
      id: uid(), title, mnemonicText: document.getElementById('mCode').value.trim(),
      meaning: document.getElementById('mMeaning').value.trim(), topicId: document.getElementById('mTopic').value,
      tags: [], favorite: false, createdAt: nowISO()
    });
    await Flashcards.generateForMnemonic(m);
    Modal.close(); toast('Mnemonic saved · flashcard created'); Router.render();
  },
  async toggleFav(id) {
    const m = Cache.mnemonics.find(x => x.id === id); m.favorite = !m.favorite; await saveItem('mnemonics', m); Router.render();
  },
  async remove(id) {
    if (!confirm('Delete this mnemonic? Its flashcard will be removed too.')) return;
    await Flashcards.removeForSource('mnemonic', id);
    await trashItem('mnemonics', id); Router.render();
  },
  render() {
    const items = Cache.mnemonics || [];
    if (!items.length) return emptyState('🧠', 'Build your memory bank.', 'Create Mnemonic', "Mnemonics.promptNew()");
    return `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
      <h2 style="margin:0;">Mnemonics</h2><button class="btn" onclick="Mnemonics.promptNew()" title="Create a new memory aid">+ New Mnemonic</button></div>
      <div class="grid cols-3">${items.map(m => { const fc = Flashcards.findFor('mnemonic', m.id); return `
      <div class="card">
        <div style="display:flex;justify-content:space-between;"><b>${esc(m.title)}</b>
        <span style="cursor:pointer;" onclick="Mnemonics.toggleFav('${m.id}')" title="Toggle favorite — favorites surface in Last-Minute Revision">${m.favorite ? '★' : '☆'}</span></div>
        <div class="pill" style="margin:6px 0;">${esc(m.mnemonicText)}</div>
        <div class="subtle" style="white-space:pre-line;">${esc(m.meaning)}</div>
        <div class="subtle" style="margin-top:8px;">Topic: ${topicName(m.topicId)}</div>
        <div class="subtle">🃏 ${fc && fc.nextDate ? 'Next revision: ' + fmtDateShort(fc.nextDate) : 'Flashcard not yet reviewed'}</div>
        <div style="text-align:right;margin-top:8px;"><button class="btn sm secondary" onclick="Mnemonics.remove('${m.id}')" title="Delete this mnemonic">Delete</button></div>
      </div>`; }).join('')}</div>`;
  }
};

/* ============================== JARGONS ============================== */
const Jargons = {
  promptNew() {
    Modal.open('New Jargon / Term', `
      <label>Term</label><input type="text" id="jTerm" placeholder="e.g. Material Misstatement" title="The term or keyword">
      <label>Meaning</label><textarea id="jMeaning" rows="3"></textarea>
      <label>Memory trick (optional)</label><input type="text" id="jTrick" title="An optional trick to help you remember it">
      <label>Subject</label><select id="jSubject" title="Which subject this term belongs to">${subjectOptions()}</select>
      <label>Importance</label><select id="jImp" title="How important this term is to memorize"><option>Normal</option><option>Important</option><option>Must Memorize</option></select>
      <div class="modal-actions"><button class="btn secondary" onclick="Modal.close()" title="Discard and close this dialog">Cancel</button><button class="btn" onclick="Jargons.create()" title="Save this term">Save</button></div>`);
  },
  async create() {
    const term = document.getElementById('jTerm').value.trim(); if (!term) return;
    await saveItem('jargons', {
      id: uid(), term, meaning: document.getElementById('jMeaning').value.trim(),
      memoryTrick: document.getElementById('jTrick').value.trim(), subjectId: document.getElementById('jSubject').value,
      importance: document.getElementById('jImp').value, tags: [], createdAt: nowISO()
    });
    Modal.close(); toast('Jargon saved'); Router.render();
  },
  async remove(id) { if (!confirm('Delete this term?')) return; await trashItem('jargons', id); Router.render(); },
  render() {
    const items = Cache.jargons || [];
    if (!items.length) return emptyState('🔤', 'Track tricky terms, keywords and abbreviations.', 'Add Jargon', "Jargons.promptNew()");
    return `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
      <h2 style="margin:0;">Jargons & Keywords</h2><button class="btn" onclick="Jargons.promptNew()" title="Add a term, keyword or abbreviation">+ New Term</button></div>
      ${items.map(j => `<div class="card" style="margin-bottom:10px;">
        <div style="display:flex;justify-content:space-between;"><b>${esc(j.term)}</b><span class="pill ${j.importance === 'Must Memorize' ? 'warn' : ''}">${esc(j.importance)}</span></div>
        <div style="margin:6px 0;">${esc(j.meaning)}</div>
        ${j.memoryTrick ? `<div class="subtle">💡 ${esc(j.memoryTrick)}</div>` : ''}
        <div class="subtle" style="margin-top:4px;">${subjectName(j.subjectId)}</div>
        <div style="text-align:right;"><button class="btn sm secondary" onclick="Jargons.remove('${j.id}')" title="Delete this term">Delete</button></div>
      </div>`).join('')}`;
  }
};

/* ============================== QUESTIONS ============================== */
const Questions = {
  promptNew(topicId) {
    Modal.open('New Question', `
      <label>Question</label><textarea id="qText" rows="3"></textarea>
      <label>Type</label><select id="qType" onchange="Questions.onTypeChange()" title="Question type — changes the fields below">
        <option>Theory</option><option>Practical</option><option>MCQ</option><option>True/False</option><option>Fill in the Blank</option><option>Case Study</option><option>Numerical</option>
      </select>
      <div id="qTypeFields"></div>
      <label>Marks</label><input type="number" id="qMarks" value="5" title="How many marks this question is worth">
      <label>Difficulty</label><select id="qDiff" title="How hard this question is"><option>Easy</option><option selected>Medium</option><option>Hard</option></select>
      <label>Model answer / explanation (optional)</label><textarea id="qAnswer" rows="3"></textarea>
      <label>Topic</label><select id="qTopic" title="Which topic this question belongs to">${topicOptions(topicId)}</select>
      <div class="modal-actions"><button class="btn secondary" onclick="Modal.close()" title="Discard and close this dialog">Cancel</button><button class="btn" onclick="Questions.create()" title="Save this question">Save</button></div>`);
    setTimeout(() => Questions.onTypeChange(), 30);
  },
  onTypeChange() {
    const type = document.getElementById('qType')?.value;
    const el = document.getElementById('qTypeFields'); if (!el) return;
    if (type === 'MCQ') {
      el.innerHTML = `<label>Options (select the correct one)</label>
        ${[0, 1, 2, 3].map(i => `<div style="display:flex;gap:6px;align-items:center;margin-bottom:4px;">
          <input type="radio" name="qCorrectOpt" value="${i}" ${i === 0 ? 'checked' : ''}>
          <input type="text" id="qOpt${i}" placeholder="Option ${i + 1}" style="flex:1;" title="Answer option ${i + 1}">
        </div>`).join('')}`;
    } else if (type === 'True/False') {
      el.innerHTML = `<label>Correct answer</label><select id="qTFAnswer" title="The correct answer for this question"><option value="True">True</option><option value="False">False</option></select>`;
    } else if (type === 'Fill in the Blank') {
      el.innerHTML = `<label>Correct answer text</label><input type="text" id="qFIBAnswer" placeholder="Exact expected answer" title="The exact text that counts as correct (matched case-insensitively)">`;
    } else {
      el.innerHTML = '';
    }
  },
  async create() {
    const questionText = document.getElementById('qText').value.trim(); if (!questionText) return;
    const type = document.getElementById('qType').value;
    const topicId = document.getElementById('qTopic').value;
    const topic = (Cache.topics || []).find(t => t.id === topicId);
    const chapter = topic ? (Cache.chapters || []).find(c => c.id === topic.chapterId) : null;
    let extra = {};
    if (type === 'MCQ') {
      const options = [0, 1, 2, 3].map(i => document.getElementById('qOpt' + i)?.value.trim()).filter(Boolean);
      const correctOptionIndex = parseInt(document.querySelector('input[name="qCorrectOpt"]:checked')?.value ?? '0');
      extra = { options, correctOptionIndex };
    } else if (type === 'True/False') {
      extra = { correctAnswerText: document.getElementById('qTFAnswer').value };
    } else if (type === 'Fill in the Blank') {
      extra = { correctAnswerText: document.getElementById('qFIBAnswer').value.trim() };
    }
    const q = await saveItem('questions', {
      id: uid(), questionText, type, marks: parseInt(document.getElementById('qMarks').value) || 0,
      difficulty: document.getElementById('qDiff').value, modelAnswer: document.getElementById('qAnswer').value.trim(),
      topicId, chapterId: chapter?.id, subjectId: chapter?.subjectId, status: 'not-attempted', personalAnswer: '',
      createdAt: nowISO(), ...extra
    });
    await Flashcards.generateForQuestion(q);
    Modal.close(); toast('Question saved · flashcard created'); Router.render();
  },
  async setStatus(id, status) {
    const q = Cache.questions.find(x => x.id === id); q.status = status;
    await saveItem('questions', q); Router.render();
  },
  async remove(id) {
    if (!confirm('Delete this question? Its flashcard will be removed too.')) return;
    await Flashcards.removeForSource('question', id);
    await trashItem('questions', id); Router.render();
  },
  render() {
    const items = Cache.questions || [];
    if (!items.length) return emptyState('❓', 'Build your question bank from past papers and practice.', 'Add Question', "Questions.promptNew()");
    return `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
      <h2 style="margin:0;">Questions (${items.length})</h2><button class="btn" onclick="Questions.promptNew()" title="Add a question to your question bank">+ New Question</button></div>
      ${items.map(q => { const fc = Flashcards.findFor('question', q.id); return `<div class="card" style="margin-bottom:10px;">
        <div style="display:flex;justify-content:space-between;gap:10px;">
          <div>${esc(q.questionText)}</div>
          <span class="pill">${q.marks} marks</span>
        </div>
        <div class="note-meta-row" style="margin-top:8px;">
          <span class="pill">${esc(q.type)}</span><span class="pill">${esc(q.difficulty)}</span>
          <span class="pill ${q.status === 'not-attempted' ? '' : 'warn'}">${esc(q.status)}</span>
          <span class="subtle">${subjectName(q.subjectId)}</span>
        </div>
        <div class="subtle" style="margin-top:4px;">🃏 ${fc && fc.nextDate ? 'Next revision: ' + fmtDateShort(fc.nextDate) : 'Flashcard not yet reviewed'}</div>
        ${Questions.answerAreaHTML(q)}
        <div id="ans-${q.id}" style="display:none;margin-top:8px;padding:8px;background:var(--bg);border-radius:8px;">${esc(q.modelAnswer) || '<span class="subtle">No model answer recorded.</span>'}</div>
      </div>`; }).join('')}`;
  },
  answerAreaHTML(q) {
    if (q.type === 'MCQ' && q.options && q.options.length) {
      return `<div style="margin-top:8px;">
        ${q.options.map((opt, i) => `<label style="display:flex;gap:6px;align-items:center;margin-bottom:4px;">
          <input type="radio" name="mcq-${q.id}" value="${i}"> ${esc(opt)}</label>`).join('')}
        <button class="btn sm secondary" onclick="Questions.checkMCQ('${q.id}')" title="Grade your selected answer">Check answer</button>
        <button class="btn sm secondary" onclick="Questions.remove('${q.id}')" title="Delete this question">Delete</button>
      </div>`;
    }
    if (q.type === 'True/False') {
      return `<div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;">
        <button class="btn sm secondary" onclick="Questions.checkTF('${q.id}','True')" title="Answer True">True</button>
        <button class="btn sm secondary" onclick="Questions.checkTF('${q.id}','False')" title="Answer False">False</button>
        <button class="btn sm secondary" onclick="Questions.remove('${q.id}')" title="Delete this question">Delete</button>
      </div>`;
    }
    if (q.type === 'Fill in the Blank') {
      return `<div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;">
        <input type="text" id="fib-${q.id}" placeholder="Your answer" style="flex:1;min-width:140px;" title="Type your answer, then click Check">
        <button class="btn sm secondary" onclick="Questions.checkFIB('${q.id}')" title="Grade your typed answer">Check</button>
        <button class="btn sm secondary" onclick="Questions.remove('${q.id}')" title="Delete this question">Delete</button>
      </div>`;
    }
    return `<div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;">
      <button class="btn sm secondary" onclick="Questions.toggleAnswer('${q.id}')" title="Show the model answer">Reveal answer</button>
      <button class="btn sm secondary" onclick="Questions.setStatus('${q.id}','correct')" title="Mark your attempt correct">Mark correct</button>
      <button class="btn sm secondary" onclick="Questions.setStatus('${q.id}','incorrect')" title="Mark your attempt incorrect">Mark incorrect</button>
      <button class="btn sm secondary" onclick="Questions.remove('${q.id}')" title="Delete this question">Delete</button>
    </div>`;
  },
  checkMCQ(id) {
    const q = Cache.questions.find(x => x.id === id);
    const sel = document.querySelector(`input[name="mcq-${id}"]:checked`);
    if (!sel) { toast('Pick an option first'); return; }
    const correct = parseInt(sel.value) === q.correctOptionIndex;
    Questions.setStatus(id, correct ? 'correct' : 'incorrect');
    toast(correct ? '✅ Correct!' : `❌ Correct answer: ${q.options[q.correctOptionIndex]}`);
  },
  checkTF(id, ans) {
    const q = Cache.questions.find(x => x.id === id);
    const correct = ans === q.correctAnswerText;
    Questions.setStatus(id, correct ? 'correct' : 'incorrect');
    toast(correct ? '✅ Correct!' : `❌ Correct answer: ${q.correctAnswerText}`);
  },
  checkFIB(id) {
    const q = Cache.questions.find(x => x.id === id);
    const val = (document.getElementById('fib-' + id).value || '').trim().toLowerCase();
    const correct = val === (q.correctAnswerText || '').trim().toLowerCase();
    Questions.setStatus(id, correct ? 'correct' : 'incorrect');
    toast(correct ? '✅ Correct!' : `❌ Correct answer: ${q.correctAnswerText}`);
  },
  toggleAnswer(id) { const el = document.getElementById('ans-' + id); el.style.display = el.style.display === 'none' ? 'block' : 'none'; }
};

/* ============================== BOOKMARKS ============================== */
const Bookmarks = {
  async add(targetType, targetId, label) {
    await saveItem('bookmarks', { id: uid(), targetType, targetId, label, createdAt: nowISO() });
    toast('Bookmarked');
  },
  async remove(id) { await DB.del('bookmarks', id); Cache.bookmarks = Cache.bookmarks.filter(b => b.id !== id); Router.render(); },
  render() {
    const items = Cache.bookmarks || [];
    if (!items.length) return emptyState('🔖', 'Bookmark notes, PDF pages and questions to find them fast.', null, null);
    return `<h2>Bookmarks</h2>${items.map(b => `
      <div class="list-row" onclick="Bookmarks.open('${b.targetType}','${b.targetId}')" title="Open this bookmark">
        <span>🔖</span><div style="flex:1;">${esc(b.label)}<div class="subtle">${b.targetType} · ${fmtDate(b.createdAt)}</div></div>
        <button class="btn sm secondary" onclick="event.stopPropagation();Bookmarks.remove('${b.id}')" title="Remove this bookmark">✕</button>
      </div>`).join('')}`;
  },
  open(type, id) {
    if (type === 'note') UI.nav('note', { id });
    else if (type === 'pdf') UI.nav('pdf', { id });
  }
};

/* ============================== PDF LIBRARY ============================== */
let pdfDocCache = null, pdfCurrentPage = 1, pdfScale = 1.2, pdfPageObj = null, pdfStickyMode = false, pdfSplitMode = false, pdfSplitNoteId = null;
let pdfDrawMode = false, pdfDrawTool = 'pen', pdfDrawColor = '#202A22', pdfDrawing = false, pdfDrawStart = null, pdfCurrentStroke = [];
let pdfUndoStack = [], pdfRedoStack = []; // unified undo/redo across highlights, underlines, sticky notes and drawings for the current PDF

/* Minimal selectable text layer, built the same way pdf.js's own viewer does:
   one absolutely-positioned, transparent span per text item, sized/rotated
   from its render matrix, so the browser's native text selection works. */
async function renderTextLayer(page, viewport, container) {
  container.innerHTML = '';
  container.style.width = viewport.width + 'px';
  container.style.height = viewport.height + 'px';
  let textContent;
  try { textContent = await page.getTextContent(); } catch (e) { return; }
  const frag = document.createDocumentFragment();
  textContent.items.forEach(item => {
    if (!item.str) return;
    const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
    const angle = Math.atan2(tx[1], tx[0]);
    const fontHeight = Math.hypot(tx[2], tx[3]) || 1;
    const span = document.createElement('span');
    span.textContent = item.str;
    span.style.left = tx[4] + 'px';
    span.style.top = (tx[5] - fontHeight) + 'px';
    span.style.fontSize = fontHeight + 'px';
    span.style.fontFamily = 'sans-serif';
    if (angle !== 0) span.style.transform = `rotate(${angle}rad)`;
    frag.appendChild(span);
  });
  container.appendChild(frag);
}
const Pdfs = {
  upload() { document.getElementById('pdfFileInput').click(); },
  async handleFile(input) {
    const file = input.files[0]; if (!file) return;
    if (file.type !== 'application/pdf') { toast('Please choose a PDF file'); return; }
    const buf = await file.arrayBuffer();
    let pageCount = 0;
    try { const doc = await pdfjsLib.getDocument({ data: buf.slice(0) }).promise; pageCount = doc.numPages; }
    catch (e) { console.warn('pdf parse warning', e); }
    input.value = '';
    Pdfs._pendingUpload = { filename: file.name, buf, pageCount };
    Modal.open('Import PDF', `
      <label>Title</label><input type="text" id="mPdfTitle" value="${esc(file.name.replace(/\.pdf$/i, ''))}" title="Title for this PDF in your library">
      <label>Subject (optional — powers related-content links)</label>
      <select id="mPdfSubject" title="Tag this PDF with a subject to power related-content links"><option value="">— None —</option>${subjectOptions()}</select>
      <div class="modal-actions"><button class="btn secondary" onclick="Modal.close()" title="Discard and close this dialog">Cancel</button>
      <button class="btn" onclick="Pdfs.finishUpload()" title="Save this PDF to your library">Import</button></div>`);
  },
  async finishUpload() {
    const p = Pdfs._pendingUpload; if (!p) return;
    const title = document.getElementById('mPdfTitle').value.trim() || p.filename;
    const subjectId = document.getElementById('mPdfSubject').value;
    await saveItem('pdfs', { id: uid(), filename: p.filename, title, subjectId, pageCount: p.pageCount, blob: p.buf, createdAt: nowISO() });
    Pdfs._pendingUpload = null;
    Modal.close(); toast('PDF imported'); Router.render();
  },
  async remove(id) { if (!confirm('Move this PDF to Trash?')) return; await trashItem('pdfs', id); Router.render(); },
  renderLibrary() {
    const items = Cache.pdfs || [];
    return `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
      <h2 style="margin:0;">PDF Library</h2>
      <div><input type="file" id="pdfFileInput" accept="application/pdf" style="display:none" onchange="Pdfs.handleFile(this)">
      <button class="btn" onclick="Pdfs.upload()" title="Choose a PDF file to upload">+ Import PDF</button></div></div>
      ${items.length ? `<div class="grid cols-3">${items.map(p => `
      <div class="card" style="cursor:pointer;" onclick="UI.nav('pdf',{id:'${p.id}'})" title="Open this PDF">
        <div style="font-size:32px;">📄</div><b>${esc(p.title)}</b>
        <div class="subtle">${p.pageCount || '?'} pages</div>
        <div style="text-align:right;margin-top:8px;"><button class="btn sm secondary" onclick="event.stopPropagation();Pdfs.remove('${p.id}')" title="Move this PDF to Trash">Delete</button></div>
      </div>`).join('')}</div>` : emptyState('📄', 'No PDFs yet.', 'Import PDF', 'Pdfs.upload()')}`;
  },
  async renderViewer(id) {
    const rec = Cache.pdfs.find(p => p.id === id);
    if (!rec) return `<div class="empty-state"><h3>PDF not found</h3></div>`;
    setTimeout(() => Pdfs.load(rec), 30);
    pdfSplitMode = false; pdfSplitNoteId = null; pdfDrawMode = false; pdfDrawTool = 'pen'; pdfDrawColor = '#202A22';
    pdfUndoStack = []; pdfRedoStack = [];
    const drawColors = ['#202A22', '#A23B2E', '#A9822E', '#2f6fc9', '#3f8a53'];
    return `
    <div class="pdf-shell">
      <div class="pdf-toolbar">
        <b>${esc(rec.title)}</b>
        <div class="spacer"></div>
        <button class="icon-btn" onclick="Pdfs.prevPage()" title="Previous page">‹ Prev</button>
        <span id="pdfPageLabel" class="subtle">Page 1 / ${rec.pageCount || '?'}</span>
        <button class="icon-btn" onclick="Pdfs.nextPage()" title="Next page">Next ›</button>
        <button class="icon-btn" onclick="Pdfs.zoom(-0.15)" title="Zoom out" aria-label="Zoom out">−</button>
        <button class="icon-btn" onclick="Pdfs.zoom(0.15)" title="Zoom in" aria-label="Zoom in">+</button>
        <button class="icon-btn" id="pdfUndoBtn" onclick="Pdfs.undo()" title="Undo the last highlight, underline, sticky note or drawing" disabled>↶ Undo</button>
        <button class="icon-btn" id="pdfRedoBtn" onclick="Pdfs.redo()" title="Redo" disabled>↷ Redo</button>
        <button class="icon-btn" onclick="Pdfs.bookmarkPage('${id}')" title="Bookmark this page for quick return">🔖 Bookmark page</button>
        <button class="icon-btn" id="stickyBtn" onclick="Pdfs.toggleStickyMode()" title="Click a spot on the page to drop a sticky note there">📌 Sticky note</button>
        <button class="icon-btn" id="drawBtn" onclick="Pdfs.toggleDrawMode()" title="Draw freehand ink, an arrow, or a rectangle on this page">✏ Draw</button>
        <button class="icon-btn" id="splitBtn" onclick="Pdfs.toggleSplit()" title="Dock a note editor beside the PDF, for taking notes while you read">📝 Split with Notes</button>
        <button class="icon-btn" onclick="Pdfs.exportAnnotatedPdf()" title="Download a copy of this PDF with all highlights, underlines and drawings permanently burned in — the original stays untouched">⬇ Export PDF</button>
        <span class="subtle" style="font-size:11.5px;">Select text to highlight/underline</span>
      </div>
      <div class="pdf-draw-toolbar" id="pdfDrawToolbar" style="display:none;">
        <button data-tool="pen" class="active-tool" onclick="Pdfs.setDrawTool('pen')" title="Freehand pen">✏ Pen</button>
        <button data-tool="arrow" onclick="Pdfs.setDrawTool('arrow')" title="Drag to draw an arrow">↗ Arrow</button>
        <button data-tool="rect" onclick="Pdfs.setDrawTool('rect')" title="Drag to draw a rectangle">▭ Rect</button>
        <div class="sep"></div>
        ${drawColors.map((c, i) => `<span class="draw-color-dot ${i === 0 ? 'selected' : ''}" data-color="${c}" style="background:${c};" onclick="Pdfs.setDrawColor('${c}')" title="Use this color"></span>`).join('')}
        <div class="sep"></div>
        <button onclick="Pdfs.clearPageDrawings()" title="Remove all drawings on this page">🗑 Clear page</button>
        <button class="btn sm" onclick="Pdfs.toggleDrawMode()" title="Exit drawing mode">Done</button>
      </div>
      <div class="pdf-body-row">
        <div class="pdf-canvas-wrap" id="pdfCanvasWrap">
          <div class="pdf-page-wrap" id="pdfPageWrap" onclick="Pdfs.handlePageClick(event)" title="Select text to highlight/underline, or click to place a sticky note when Sticky Note mode is on">
            <canvas id="pdfCanvas"></canvas>
            <div class="pdf-textlayer" id="pdfTextLayer" onmouseup="Pdfs.onTextSelect(event)"></div>
            <div class="pdf-hl-overlay" id="pdfHlOverlay"></div>
            <canvas class="pdf-ink-canvas" id="pdfInkCanvas"
              onpointerdown="Pdfs.inkPointerDown(event)" onpointermove="Pdfs.inkPointerMove(event)"
              onpointerup="Pdfs.inkPointerUp(event)" onpointerleave="Pdfs.inkPointerUp(event)"></canvas>
          </div>
        </div>
        <div class="pdf-right-panel" id="pdfRightPanel">
          ${Pdfs.sidePanelHTML(id)}
        </div>
      </div>
    </div>`;
  },
  async load(rec) {
    try {
      pdfDocCache = await pdfjsLib.getDocument({ data: rec.blob.slice(0) }).promise;
      pdfCurrentPage = 1; pdfScale = 1.2; pdfStickyMode = false;
      Pdfs.renderPage();
    } catch (e) { toast('Could not render PDF'); console.error(e); }
  },
  async renderPage() {
    if (!pdfDocCache) return;
    const page = await pdfDocCache.getPage(pdfCurrentPage);
    pdfPageObj = page;
    const viewport = page.getViewport({ scale: pdfScale });
    const canvas = document.getElementById('pdfCanvas'); if (!canvas) return;
    canvas.width = viewport.width; canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    const label = document.getElementById('pdfPageLabel');
    if (label) label.textContent = `Page ${pdfCurrentPage} / ${pdfDocCache.numPages}`;
    const wrap = document.getElementById('pdfPageWrap');
    if (wrap) { wrap.style.width = viewport.width + 'px'; wrap.style.height = viewport.height + 'px'; }
    const textLayer = document.getElementById('pdfTextLayer');
    if (textLayer) await renderTextLayer(page, viewport, textLayer);
    Pdfs.renderOverlay(viewport);
    const inkCanvas = document.getElementById('pdfInkCanvas');
    if (inkCanvas) { inkCanvas.width = viewport.width; inkCanvas.height = viewport.height; Pdfs.redrawInkCanvas(); }
    Pdfs.refreshSidePanel();
  },
  prevPage() { if (pdfCurrentPage > 1) { pdfCurrentPage--; Pdfs.renderPage(); } },
  nextPage() { if (pdfDocCache && pdfCurrentPage < pdfDocCache.numPages) { pdfCurrentPage++; Pdfs.renderPage(); } },
  goToPage(n) { pdfCurrentPage = n; Pdfs.renderPage(); },
  zoom(delta) { pdfScale = Math.max(0.4, Math.min(3, pdfScale + delta)); Pdfs.renderPage(); },
  async bookmarkPage(pdfId) {
    const label = prompt('Label for this bookmark (optional):') || '';
    await saveItem('pdfBookmarks', { id: uid(), pdfId, page: pdfCurrentPage, label, createdAt: nowISO() });
    Pdfs.refreshSidePanel();
  },

  /* ---- highlight / underline (selection-driven) ---- */
  onTextSelect(e) {
    document.getElementById('pdfSelToolbar')?.remove();
    if (pdfStickyMode) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.toString().trim()) return;
    const layer = document.getElementById('pdfTextLayer');
    if (!layer || !layer.contains(sel.anchorNode)) return;
    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    const colors = Settings.get('highlightColors');
    const bar = document.createElement('div');
    bar.id = 'pdfSelToolbar'; bar.className = 'sel-toolbar';
    bar.style.top = (rect.top + window.scrollY - 40) + 'px';
    bar.style.left = (rect.left + window.scrollX) + 'px';
    bar.innerHTML = colors.map((c, i) => `<button title="${esc(c.label)}" onmousedown="event.preventDefault();Pdfs.saveHighlight('${c.color}','${c.key}')">${['🟡', '🟢', '🔵', '🔴', '🟣', '🟠'][i] || '●'}</button>`).join('')
      + `<button title="Underline" onmousedown="event.preventDefault();Pdfs.saveHighlight('','underline')">U̲</button>`;
    document.body.appendChild(bar);
  },
  async saveHighlight(color, kind) {
    const sel = window.getSelection();
    if (!sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    const text = sel.toString();
    const wrap = document.getElementById('pdfPageWrap');
    const wrapRect = wrap.getBoundingClientRect();
    const merged = mergeLineRectsDOM(range.getClientRects());
    const rects = merged.map(r => ({
      x: (r.left - wrapRect.left) / pdfScale, y: (r.top - wrapRect.top) / pdfScale,
      w: r.width / pdfScale, h: r.height / pdfScale
    }));
    sel.removeAllRanges();
    document.getElementById('pdfSelToolbar')?.remove();
    if (!rects.length) return;
    const saved = await saveItem('annotations', {
      id: uid(), targetType: 'pdf', pdfId: UI.params.id, page: pdfCurrentPage,
      kind: kind === 'underline' ? 'underline' : 'highlight', color: kind === 'underline' ? '' : color,
      rects, text: text.slice(0, 140), comment: '', createdAt: nowISO()
    });
    Pdfs.pushUndo({ type: 'create', data: saved });
    Pdfs.refreshOverlayAndPanel();
    toast(kind === 'underline' ? 'Underlined' : 'Highlighted');
  },

  /* ---- sticky notes ---- */
  toggleStickyMode() {
    pdfStickyMode = !pdfStickyMode;
    document.getElementById('stickyBtn')?.classList.toggle('active-toggle', pdfStickyMode);
    if (pdfStickyMode && pdfDrawMode) Pdfs.toggleDrawMode();
    if (pdfStickyMode) toast('Click anywhere on the page to place a sticky note');
  },
  handlePageClick(e) {
    if (!pdfStickyMode) return;
    if (window.getSelection().toString().trim()) return; // was a text selection, not a placement click
    const wrap = document.getElementById('pdfPageWrap');
    const r = wrap.getBoundingClientRect();
    const x = (e.clientX - r.left) / pdfScale, y = (e.clientY - r.top) / pdfScale;
    pdfStickyMode = false;
    document.getElementById('stickyBtn')?.classList.remove('active-toggle');
    const text = prompt('Sticky note text:');
    if (!text) return;
    saveItem('annotations', { id: uid(), targetType: 'pdf', pdfId: UI.params.id, page: pdfCurrentPage, kind: 'sticky', x, y, comment: text, text: '', createdAt: nowISO() })
      .then((saved) => { Pdfs.pushUndo({ type: 'create', data: saved }); Pdfs.refreshOverlayAndPanel(); });
  },

  /* ---- freehand drawing: pen, arrow, rectangle ---- */
  toggleDrawMode() {
    pdfDrawMode = !pdfDrawMode;
    document.getElementById('drawBtn')?.classList.toggle('active-toggle', pdfDrawMode);
    const canvas = document.getElementById('pdfInkCanvas');
    const toolbar = document.getElementById('pdfDrawToolbar');
    if (canvas) canvas.classList.toggle('drawing', pdfDrawMode);
    if (toolbar) toolbar.style.display = pdfDrawMode ? 'flex' : 'none';
    if (pdfDrawMode && pdfStickyMode) { pdfStickyMode = false; document.getElementById('stickyBtn')?.classList.remove('active-toggle'); }
  },
  setDrawTool(tool) {
    pdfDrawTool = tool;
    document.querySelectorAll('.pdf-draw-toolbar [data-tool]').forEach(b => b.classList.toggle('active-tool', b.dataset.tool === tool));
  },
  setDrawColor(color) {
    pdfDrawColor = color;
    document.querySelectorAll('.draw-color-dot').forEach(d => d.classList.toggle('selected', d.dataset.color === color));
  },
  inkPointerDown(e) {
    if (!pdfDrawMode) return;
    e.preventDefault();
    const canvas = document.getElementById('pdfInkCanvas');
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    pdfDrawing = true;
    pdfDrawStart = { x, y };
    pdfCurrentStroke = [{ x, y }];
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { }
  },
  inkPointerMove(e) {
    if (!pdfDrawing) return;
    e.preventDefault();
    const canvas = document.getElementById('pdfInkCanvas');
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    if (pdfDrawTool === 'pen') {
      pdfCurrentStroke.push({ x, y });
      Pdfs.redrawInkCanvas();
    } else {
      pdfCurrentStroke = [pdfDrawStart, { x, y }];
      Pdfs.redrawInkCanvas();
      const ctx = canvas.getContext('2d');
      if (pdfDrawTool === 'rect') {
        ctx.strokeStyle = pdfDrawColor; ctx.lineWidth = 2.5; ctx.lineJoin = 'round';
        ctx.strokeRect(Math.min(pdfDrawStart.x, x), Math.min(pdfDrawStart.y, y), Math.abs(x - pdfDrawStart.x), Math.abs(y - pdfDrawStart.y));
      } else if (pdfDrawTool === 'arrow') {
        Pdfs.drawArrow(ctx, pdfDrawStart.x, pdfDrawStart.y, x, y, pdfDrawColor);
      }
    }
  },
  async inkPointerUp(e) {
    if (!pdfDrawing) return;
    pdfDrawing = false;
    if (pdfCurrentStroke.length < 2) { pdfCurrentStroke = []; Pdfs.redrawInkCanvas(); return; }
    const dist = Math.hypot(pdfCurrentStroke[pdfCurrentStroke.length - 1].x - pdfCurrentStroke[0].x, pdfCurrentStroke[pdfCurrentStroke.length - 1].y - pdfCurrentStroke[0].y);
    if (pdfDrawTool !== 'pen' && dist < 4) { pdfCurrentStroke = []; Pdfs.redrawInkCanvas(); return; } // ignore accidental taps
    const pts = pdfCurrentStroke.map(p => ({ x: p.x / pdfScale, y: p.y / pdfScale }));
    const kind = pdfDrawTool === 'pen' ? 'ink' : pdfDrawTool; // 'ink' | 'arrow' | 'rect'
    const saved = await saveItem('annotations', {
      id: uid(), targetType: 'pdf', pdfId: UI.params.id, page: pdfCurrentPage,
      kind, points: pts, color: pdfDrawColor, createdAt: nowISO()
    });
    Pdfs.pushUndo({ type: 'create', data: saved });
    pdfCurrentStroke = [];
    Pdfs.redrawInkCanvas();
    Pdfs.refreshSidePanel();
  },
  drawArrow(ctx, x1, y1, x2, y2, color) {
    const headLen = 10;
    const angle = Math.atan2(y2 - y1, x2 - x1);
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - headLen * Math.cos(angle - Math.PI / 6), y2 - headLen * Math.sin(angle - Math.PI / 6));
    ctx.lineTo(x2 - headLen * Math.cos(angle + Math.PI / 6), y2 - headLen * Math.sin(angle + Math.PI / 6));
    ctx.closePath(); ctx.fill();
  },
  redrawInkCanvas() {
    const canvas = document.getElementById('pdfInkCanvas'); if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const items = (Cache.annotations || []).filter(a => a.targetType === 'pdf' && a.pdfId === UI.params.id && a.page === pdfCurrentPage && ['ink', 'arrow', 'rect'].includes(a.kind));
    items.forEach(a => Pdfs.drawStoredStroke(ctx, a));
    if (pdfDrawing && pdfDrawTool === 'pen' && pdfCurrentStroke.length > 1) {
      ctx.strokeStyle = pdfDrawColor; ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath();
      pdfCurrentStroke.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
      ctx.stroke();
    }
  },
  drawStoredStroke(ctx, a) {
    const pts = (a.points || []).map(p => ({ x: p.x * pdfScale, y: p.y * pdfScale }));
    if (pts.length < 2) return;
    if (a.kind === 'ink') {
      ctx.strokeStyle = a.color; ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath();
      pts.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
      ctx.stroke();
    } else if (a.kind === 'rect') {
      const [p1, p2] = pts;
      ctx.strokeStyle = a.color; ctx.lineWidth = 2.5; ctx.lineJoin = 'round';
      ctx.strokeRect(Math.min(p1.x, p2.x), Math.min(p1.y, p2.y), Math.abs(p2.x - p1.x), Math.abs(p2.y - p1.y));
    } else if (a.kind === 'arrow') {
      const [p1, p2] = pts;
      Pdfs.drawArrow(ctx, p1.x, p1.y, p2.x, p2.y, a.color);
    }
  },
  async clearPageDrawings() {
    const items = (Cache.annotations || []).filter(a => a.targetType === 'pdf' && a.pdfId === UI.params.id && a.page === pdfCurrentPage && ['ink', 'arrow', 'rect'].includes(a.kind));
    if (!items.length) { toast('No drawings on this page'); return; }
    if (!confirm(`Remove all ${items.length} drawing(s) on this page?`)) return;
    for (const a of items) { await DB.del('annotations', a.id); Pdfs.pushUndo({ type: 'delete', data: a }); }
    const ids = new Set(items.map(a => a.id));
    Cache.annotations = Cache.annotations.filter(a => !ids.has(a.id));
    Pdfs.redrawInkCanvas();
    Pdfs.refreshSidePanel();
  },
  async deleteDrawing(id) {
    if (!confirm('Delete this drawing?')) return;
    const a = Cache.annotations.find(x => x.id === id);
    await DB.del('annotations', id);
    Cache.annotations = Cache.annotations.filter(x => x.id !== id);
    if (a) Pdfs.pushUndo({ type: 'delete', data: a });
    Pdfs.redrawInkCanvas();
    Pdfs.refreshSidePanel();
  },

  /* ---- unified undo/redo across highlights, underlines, sticky notes and drawings ---- */
  pushUndo(action) {
    pdfUndoStack.push(action);
    pdfRedoStack = [];
    Pdfs.updateUndoRedoButtons();
  },
  updateUndoRedoButtons() {
    const u = document.getElementById('pdfUndoBtn'), r = document.getElementById('pdfRedoBtn');
    if (u) u.disabled = pdfUndoStack.length === 0;
    if (r) r.disabled = pdfRedoStack.length === 0;
  },
  async applyUndoRedoAction(action, direction) {
    // direction: 'undo' reverses the action; 'redo' re-applies it
    const isCreate = action.type === 'create';
    const shouldExist = direction === 'undo' ? !isCreate : isCreate;
    if (shouldExist) {
      await DB.put('annotations', action.data);
      if (!Cache.annotations.some(a => a.id === action.data.id)) Cache.annotations.push(action.data);
    } else {
      await DB.del('annotations', action.data.id);
      Cache.annotations = Cache.annotations.filter(a => a.id !== action.data.id);
    }
  },
  async undo() {
    const action = pdfUndoStack.pop();
    if (!action) { toast('Nothing to undo'); return; }
    await Pdfs.applyUndoRedoAction(action, 'undo');
    pdfRedoStack.push(action);
    Pdfs.refreshOverlayAndPanel();
    Pdfs.redrawInkCanvas();
    Pdfs.updateUndoRedoButtons();
    toast('Undone');
  },
  async redo() {
    const action = pdfRedoStack.pop();
    if (!action) { toast('Nothing to redo'); return; }
    await Pdfs.applyUndoRedoAction(action, 'redo');
    pdfUndoStack.push(action);
    Pdfs.refreshOverlayAndPanel();
    Pdfs.redrawInkCanvas();
    Pdfs.updateUndoRedoButtons();
    toast('Redone');
  },

  /* ---- burned-in annotated PDF export ----
     Draws every highlight/underline/drawing/sticky as real vector content
     directly onto a copy of the original PDF's pages via pdf-lib, running
     entirely in the browser. The original file in your library is never
     touched, and the source PDF's own text stays selectable/searchable —
     this isn't a rasterized screenshot of the page. */
  async exportAnnotatedPdf() {
    const pdfId = UI.params.id;
    const rec = Cache.pdfs.find(p => p.id === pdfId);
    if (!rec) return;
    if (typeof PDFLib === 'undefined') { toast('The PDF export library failed to load — check your connection and try again'); return; }
    const allAnnots = (Cache.annotations || []).filter(a => a.targetType === 'pdf' && a.pdfId === pdfId);
    if (!allAnnots.length) { toast('No highlights, drawings or notes on this PDF yet — nothing to burn in'); return; }
    toast('Preparing annotated PDF…');
    try {
      const { PDFDocument, rgb, StandardFonts } = PDFLib;
      const srcDoc = await PDFDocument.load(rec.blob.slice(0));
      const font = await srcDoc.embedFont(StandardFonts.Helvetica);
      const pages = srcDoc.getPages();
      for (let i = 0; i < pages.length; i++) {
        const pageNum = i + 1;
        const pageAnnots = allAnnots.filter(a => a.page === pageNum);
        if (!pageAnnots.length) continue;
        const page = pages[i];
        const { height: pageHeight } = page.getSize();
        for (const a of pageAnnots) {
          const col = hexToRgbFloat(a.color || '#202A22');
          const pdfColor = rgb(col.r, col.g, col.b);
          if (a.kind === 'highlight') {
            mergeLineRectsXYWH(a.rects).forEach(r => {
              page.drawRectangle({ x: r.x, y: pageHeight - r.y - r.h, width: r.w, height: r.h, color: pdfColor, opacity: 0.45 });
            });
          } else if (a.kind === 'underline') {
            mergeLineRectsXYWH(a.rects).forEach(r => {
              const y = pageHeight - r.y - r.h;
              page.drawLine({ start: { x: r.x, y }, end: { x: r.x + r.w, y }, thickness: 1.6, color: pdfColor });
            });
          } else if (a.kind === 'ink') {
            const pts = a.points || [];
            for (let j = 0; j < pts.length - 1; j++) {
              page.drawLine({ start: { x: pts[j].x, y: pageHeight - pts[j].y }, end: { x: pts[j + 1].x, y: pageHeight - pts[j + 1].y }, thickness: 1.8, color: pdfColor });
            }
          } else if (a.kind === 'rect') {
            const pts = a.points || [];
            if (pts.length >= 2) {
              const [p1, p2] = pts;
              const x = Math.min(p1.x, p2.x), w = Math.abs(p2.x - p1.x), h = Math.abs(p2.y - p1.y);
              const y = pageHeight - Math.max(p1.y, p2.y);
              page.drawRectangle({ x, y, width: w, height: h, borderColor: pdfColor, borderWidth: 1.6, opacity: 0 });
            }
          } else if (a.kind === 'arrow') {
            const pts = a.points || [];
            if (pts.length >= 2) {
              const [p1, p2] = pts;
              const x1 = p1.x, y1 = pageHeight - p1.y, x2 = p2.x, y2 = pageHeight - p2.y;
              page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: 1.8, color: pdfColor });
              const angle = Math.atan2(y2 - y1, x2 - x1);
              const headLen = 8;
              [angle + Math.PI * 5 / 6, angle - Math.PI * 5 / 6].forEach(a2 => {
                page.drawLine({ start: { x: x2, y: y2 }, end: { x: x2 + headLen * Math.cos(a2), y: y2 + headLen * Math.sin(a2) }, thickness: 1.8, color: pdfColor });
              });
            }
          } else if (a.kind === 'sticky') {
            const x = a.x, y = pageHeight - a.y;
            page.drawCircle({ x, y, size: 5, color: pdfColor });
            if (a.comment) {
              const text = a.comment.length > 60 ? a.comment.slice(0, 57) + '...' : a.comment;
              try { page.drawText(text, { x: x + 8, y: y - 3, size: 7, font, color: rgb(0.15, 0.15, 0.15) }); } catch (e) { /* skip if font can't encode a character */ }
            }
          }
        }
      }
      const bytes = await srcDoc.save();
      const blob = new Blob([bytes], { type: 'application/pdf' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${slugify(rec.title)}-annotated.pdf`;
      a.click();
      toast('Annotated PDF downloaded');
    } catch (e) {
      console.warn('Annotated PDF export failed', e);
      toast('Export failed — ' + e.message);
    }
  },

  openHighlight(id) {
    const a = Cache.annotations.find(x => x.id === id); if (!a) return;
    Modal.open(a.kind === 'underline' ? 'Underline' : 'Highlight', `
      <div class="subtle">"${esc(a.text)}"</div>
      <label>Note (optional)</label><textarea id="pdfAnnotComment" rows="3">${esc(a.comment || '')}</textarea>
      <div class="modal-actions">
        <button class="btn danger sm" onclick="Pdfs.deleteAnnotation('${id}')" title="Delete this permanently">Delete</button>
        <button class="btn sm" onclick="Pdfs.saveAnnotComment('${id}')" title="Save this note">Save</button>
      </div>`);
  },
  openSticky(id) {
    const a = Cache.annotations.find(x => x.id === id); if (!a) return;
    Modal.open('Sticky note', `
      <textarea id="pdfAnnotComment" rows="4">${esc(a.comment || '')}</textarea>
      <div class="modal-actions">
        <button class="btn danger sm" onclick="Pdfs.deleteAnnotation('${id}')" title="Delete this permanently">Delete</button>
        <button class="btn sm" onclick="Pdfs.saveAnnotComment('${id}')" title="Save this note">Save</button>
      </div>`);
  },
  async saveAnnotComment(id) {
    const a = Cache.annotations.find(x => x.id === id); if (!a) return;
    a.comment = document.getElementById('pdfAnnotComment').value;
    await saveItem('annotations', a);
    Modal.close();
    Pdfs.refreshOverlayAndPanel();
  },
  async deleteAnnotation(id) {
    const a = Cache.annotations.find(x => x.id === id);
    await DB.del('annotations', id);
    Cache.annotations = Cache.annotations.filter(x => x.id !== id);
    if (a) Pdfs.pushUndo({ type: 'delete', data: a });
    Modal.close();
    Pdfs.refreshOverlayAndPanel();
  },

  /* ---- overlay + side panel rendering ---- */
  refreshOverlayAndPanel() {
    if (!pdfPageObj) return;
    Pdfs.renderOverlay(pdfPageObj.getViewport({ scale: pdfScale }));
    Pdfs.refreshSidePanel();
  },
  renderOverlay(viewport) {
    const overlay = document.getElementById('pdfHlOverlay');
    if (!overlay) return;
    overlay.style.width = viewport.width + 'px';
    overlay.style.height = viewport.height + 'px';
    overlay.innerHTML = '';
    const pdfId = UI.params.id;
    const items = (Cache.annotations || []).filter(a => a.targetType === 'pdf' && a.pdfId === pdfId && a.page === pdfCurrentPage);
    items.forEach(a => {
      if (a.kind === 'sticky') {
        const icon = document.createElement('div');
        icon.className = 'pdf-sticky-icon';
        icon.style.left = (a.x * pdfScale) + 'px'; icon.style.top = (a.y * pdfScale) + 'px';
        icon.textContent = '📝'; icon.title = a.comment;
        icon.onclick = (ev) => { ev.stopPropagation(); Pdfs.openSticky(a.id); };
        overlay.appendChild(icon);
      } else {
        mergeLineRectsXYWH(a.rects).forEach(r => {
          const div = document.createElement('div');
          div.className = 'pdf-hl-rect' + (a.kind === 'underline' ? ' underline' : '');
          div.style.left = (r.x * pdfScale) + 'px'; div.style.top = (r.y * pdfScale) + 'px';
          div.style.width = (r.w * pdfScale) + 'px'; div.style.height = (r.h * pdfScale) + 'px';
          if (a.kind !== 'underline') div.style.background = a.color;
          div.title = a.comment || a.text || '';
          div.onclick = (ev) => { ev.stopPropagation(); Pdfs.openHighlight(a.id); };
          overlay.appendChild(div);
        });
      }
    });
  },
  refreshSidePanel() {
    if (pdfSplitMode) return; // notes panel is independent of per-page data; leave it alone
    const el = document.getElementById('pdfRightPanel');
    if (el) el.innerHTML = Pdfs.sidePanelHTML(UI.params.id);
  },
  sidePanelHTML(pdfId) {
    const bookmarks = (Cache.pdfBookmarks || []).filter(b => b.pdfId === pdfId);
    const pageAnnots = (Cache.annotations || []).filter(a => a.targetType === 'pdf' && a.pdfId === pdfId && a.page === pdfCurrentPage);
    const legendColors = Settings.get('highlightColors');
    return `
      <h4 style="font-size:12px;text-transform:uppercase;color:var(--text-dim);margin-top:0;">Highlight legend</h4>
      <div style="margin-bottom:14px;">
        ${legendColors.map(c => `<span class="tag" style="border-color:${c.color}"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${c.color};margin-right:4px;"></span>${esc(c.label)}</span>`).join('')}
      </div>
      <h4 style="font-size:12px;text-transform:uppercase;color:var(--text-dim);">This page</h4>
      ${pageAnnots.length ? pageAnnots.map(a => {
      const isDrawing = ['ink', 'arrow', 'rect'].includes(a.kind);
      const icon = a.kind === 'sticky' ? '📝' : a.kind === 'underline' ? '‾' : a.kind === 'ink' ? '✏' : a.kind === 'arrow' ? '↗' : a.kind === 'rect' ? '▭' : '🖍';
      const label = isDrawing ? (a.kind.charAt(0).toUpperCase() + a.kind.slice(1) + ' drawing') : (a.comment || a.text || '');
      const handler = a.kind === 'sticky' ? `Pdfs.openSticky('${a.id}')` : isDrawing ? `Pdfs.deleteDrawing('${a.id}')` : `Pdfs.openHighlight('${a.id}')`;
      return `<div class="subtle" style="cursor:pointer;padding:4px 0;" title="${isDrawing ? 'Click to delete' : 'Click to view, edit or delete'}" onclick="${handler}">${icon} ${esc(label.slice(0, 42))}</div>`;
    }).join('') : '<div class="subtle">None on this page yet.</div>'}
      <h4 style="font-size:12px;text-transform:uppercase;color:var(--text-dim);margin-top:14px;">Bookmarked pages</h4>
      ${bookmarks.length ? bookmarks.map(b => `<div class="subtle" style="cursor:pointer;padding:4px 0;" onclick="Pdfs.goToPage(${b.page})" title="Jump to this page">📍 Page ${b.page} ${b.label ? '— ' + esc(b.label) : ''}</div>`).join('') : '<div class="subtle">None yet.</div>'}
    `;
  },

  /* ---- split view: take notes alongside the PDF without losing your page/zoom state ---- */
  toggleSplit() {
    pdfSplitMode = !pdfSplitMode;
    document.getElementById('splitBtn')?.classList.toggle('active-toggle', pdfSplitMode);
    const panel = document.getElementById('pdfRightPanel'); if (!panel) return;
    if (!isMobileLayout()) panel.style.width = pdfSplitMode ? '380px' : '220px';
    panel.innerHTML = pdfSplitMode ? Pdfs.splitNotesHTML() : Pdfs.sidePanelHTML(UI.params.id);
  },
  splitNotesHTML() {
    const pdfId = UI.params.id;
    const pdf = Cache.pdfs.find(p => p.id === pdfId);
    const relatedNotes = (Cache.notes || []).filter(n => pdf && pdf.subjectId && n.subjectId === pdf.subjectId);
    if (!pdfSplitNoteId) {
      return `<h4 style="margin-top:0;font-size:12px;text-transform:uppercase;color:var(--text-dim);">Notes while reading</h4>
        <label>Pick a note for this subject</label>
        <select onchange="Pdfs.pickSplitNote(this.value)" title="Pick which note to edit alongside this PDF">
          <option value="">— Choose a note —</option>
          ${relatedNotes.map(n => `<option value="${n.id}">${esc(n.title)}</option>`).join('')}
        </select>
        <button class="btn sm" style="margin-top:8px;" onclick="Pdfs.createSplitNote()" title="Create a new note for this PDF's subject">+ New note</button>
        ${!pdf?.subjectId ? '<div class="subtle" style="margin-top:8px;">Tip: assign this PDF a subject (re-import, or edit later) so its notes list here automatically.</div>' : ''}`;
    }
    const n = Cache.notes.find(x => x.id === pdfSplitNoteId);
    if (!n) { pdfSplitNoteId = null; return Pdfs.splitNotesHTML(); }
    return `<div style="display:flex;justify-content:space-between;align-items:center;">
        <b style="font-size:13px;">${esc(n.title)}</b>
        <button class="icon-btn" onclick="Pdfs.pickSplitNote('')" title="Change note" aria-label="Change note">↺</button>
      </div>
      <div class="editor-toolbar" style="position:static;margin:8px 0 4px;">
        <button onmousedown="event.preventDefault();document.execCommand('bold')" title="Bold"><b>B</b></button>
        <button onmousedown="event.preventDefault();document.execCommand('italic')" title="Italic"><i>I</i></button>
        <button onmousedown="event.preventDefault();document.execCommand('underline')" title="Underline"><u>U</u></button>
        <div class="sep"></div>
        ${richTextExtrasHTML()}
      </div>
      <div class="editor-body" id="splitEditorBody" contenteditable="true" aria-label="Split note content"
        style="min-height:calc(100vh - 300px);font-size:14px;" oninput="Pdfs.onSplitEdit()">${n.content}</div>
      <div class="save-status" id="splitSaveStatus" style="margin-top:4px;">Saved</div>`;
  },
  pickSplitNote(id) { pdfSplitNoteId = id || null; const panel = document.getElementById('pdfRightPanel'); if (panel) panel.innerHTML = Pdfs.splitNotesHTML(); },
  async createSplitNote() {
    const pdf = Cache.pdfs.find(p => p.id === UI.params.id);
    const title = prompt('Note title?', pdf ? pdf.title + ' — notes' : 'PDF notes'); if (!title) return;
    const note = await saveItem('notes', {
      id: uid(), title, topicId: '', chapterId: '', subjectId: pdf?.subjectId || '', content: '<p></p>',
      tags: [], importance: 3, examFrequency: 'medium', status: 'learning', createdAt: nowISO(), revision: { stage: -1, nextDate: null }
    });
    pdfSplitNoteId = note.id;
    const panel = document.getElementById('pdfRightPanel'); if (panel) panel.innerHTML = Pdfs.splitNotesHTML();
  },
  onSplitEdit: debounce(async function () {
    const st = document.getElementById('splitSaveStatus'); if (st) st.textContent = 'Saving…';
    const n = Cache.notes.find(x => x.id === pdfSplitNoteId); if (!n) return;
    n.content = document.getElementById('splitEditorBody').innerHTML;
    await saveItem('notes', n);
    if (st) st.textContent = 'Saved';
  }, 600)
};

/* ============================== SEARCH / COMMAND PALETTE ============================== */
/* Static command list for the palette — actions, not content. Dynamic
   "Go to subject" commands are appended at search time from Cache.subjects. */
const Commands = [
  { label: 'New Note', icon: '📝', kind: 'Create', run: () => { CmdK.close(); Notes.promptNew(); } },
  { label: 'New Course', icon: '📚', kind: 'Create', run: () => { CmdK.close(); Courses.promptNew(); } },
  { label: 'Import PDF', icon: '📄', kind: 'Create', run: () => { CmdK.close(); UI.nav('pdfs'); setTimeout(() => Pdfs.upload(), 250); } },
  { label: 'Add Mnemonic', icon: '🧠', kind: 'Create', run: () => { CmdK.close(); Mnemonics.promptNew(); } },
  { label: 'Add Jargon', icon: '🔤', kind: 'Create', run: () => { CmdK.close(); Jargons.promptNew(); } },
  { label: 'Add Question', icon: '❓', kind: 'Create', run: () => { CmdK.close(); Questions.promptNew(); } },
  { label: 'Start Revision', icon: '🔁', kind: 'Go to', run: () => { CmdK.close(); UI.nav('revision'); } },
  { label: 'Exam Mode', icon: '🎓', kind: 'Go to', run: () => { CmdK.close(); UI.nav('exam'); } },
  { label: 'Last-Minute Revision', icon: '⚡', kind: 'Go to', run: () => { CmdK.close(); UI.nav('lmr'); } },
  { label: 'Focus Mode / Study Timer', icon: '⏱', kind: 'Go to', run: () => { CmdK.close(); UI.nav('focus'); } },
  { label: 'Open Dashboard', icon: '🏠', kind: 'Go to', run: () => { CmdK.close(); UI.nav('dashboard'); } },
  { label: 'Open Search & Filters', icon: '🔍', kind: 'Go to', run: () => { CmdK.close(); UI.nav('search'); } },
  { label: 'Open Analytics', icon: '📊', kind: 'Go to', run: () => { CmdK.close(); UI.nav('analytics'); } },
  { label: 'Open Subjects', icon: '📚', kind: 'Go to', run: () => { CmdK.close(); UI.nav('subjects'); } },
  { label: 'Open PDF Library', icon: '📄', kind: 'Go to', run: () => { CmdK.close(); UI.nav('pdfs'); } },
  { label: 'Open Questions', icon: '❓', kind: 'Go to', run: () => { CmdK.close(); UI.nav('questions'); } },
  { label: 'Open Mnemonics', icon: '🧠', kind: 'Go to', run: () => { CmdK.close(); UI.nav('mnemonics'); } },
  { label: 'Open Jargons', icon: '🔤', kind: 'Go to', run: () => { CmdK.close(); UI.nav('jargons'); } },
  { label: 'Open Bookmarks', icon: '🔖', kind: 'Go to', run: () => { CmdK.close(); UI.nav('bookmarks'); } },
  { label: 'Open Trash', icon: '🗑', kind: 'Go to', run: () => { CmdK.close(); UI.nav('trash'); } },
  { label: 'Open Settings', icon: '⚙️', kind: 'Go to', run: () => { CmdK.close(); UI.nav('settings'); } },
  { label: 'Export Backup', icon: '⬇', kind: 'Action', run: () => { CmdK.close(); UI.nav('settings'); setTimeout(() => BackupService.exportJSON(), 250); } },
  { label: 'Toggle Dark Mode', icon: '🌓', kind: 'Action', run: () => { CmdK.close(); Theme.toggle(); } },
];

const CmdK = {
  _results: [],
  open() {
    const backdrop = document.createElement('div');
    backdrop.className = 'cmdk-backdrop'; backdrop.id = 'cmdkBackdrop';
    backdrop.onclick = (e) => { if (e.target === backdrop) CmdK.close(); };
    backdrop.innerHTML = `<div class="cmdk">
      <input id="cmdkInput" placeholder="Search everything, or type a command (New Note, Toggle Dark Mode…)" oninput="CmdK.search(this.value)" title="Search or type a command">
      <div class="cmdk-results" id="cmdkResults"></div>
    </div>`;
    document.body.appendChild(backdrop);
    setTimeout(() => document.getElementById('cmdkInput').focus(), 30);
    CmdK.search('');
  },
  close() { const b = document.getElementById('cmdkBackdrop'); if (b) b.remove(); },
  allCommands() {
    const dynamic = (Cache.subjects || []).map(s => ({
      label: 'Go to subject: ' + s.name, icon: '📘', kind: 'Go to',
      run: () => {
        CmdK.close();
        SubjectsHub.view = 'subject'; SubjectsHub.subjectId = s.id; SubjectsHub.chapterId = null;
        UI.nav('subjects');
      }
    }));
    return Commands.concat(dynamic);
  },
  search(q) {
    const query = (q || '').trim();
    let results;
    if (!query) {
      results = this.allCommands().slice(0, 10).map(c => ({ ...c, isCommand: true }));
    } else {
      const matchedCommands = this.allCommands().filter(c => c.label.toLowerCase().includes(query.toLowerCase())).map(c => ({ ...c, isCommand: true }));
      const contentResults = Search.run(query).slice(0, 20);
      results = [...matchedCommands, ...contentResults];
    }
    this._results = results;
    const el = document.getElementById('cmdkResults'); if (!el) return;
    const more = query && Search.run(query).length > 20
      ? `<div class="cmdk-item" onclick="CmdK.close();UI.nav('search',{q:'${esc(query).replace(/'/g, "\\'")}'});" title="See every match with filters and sorting"><span>🔎 Open full Search page for "${esc(query)}"</span><small>Filters & sort</small></div>` : '';
    el.innerHTML = (results.length ? results.map((r, i) => r.isCommand
      ? `<div class="cmdk-item" onclick="CmdK.runCommand(${i})" title="Run this command"><span>${r.icon} ${esc(r.label)}</span><small>${esc(r.kind)}</small></div>`
      : `<div class="cmdk-item" onclick="CmdK.go('${r.route}','${r.id}')" title="Open this result"><span>${r.icon} ${esc(r.title)}</span><small>${r.type}</small></div>`
    ).join('') : `<div class="cmdk-item subtle">No matches</div>`) + more;
  },
  runCommand(i) { const r = this._results[i]; if (r && r.run) r.run(); },
  go(route, id) { CmdK.close(); UI.nav(route, { id }); }
};
const Search = {
  run(q) {
    q = (q || '').toLowerCase().trim();
    const out = [];
    (Cache.notes || []).forEach(n => { if (!q || (n.title + n.content).toLowerCase().includes(q)) out.push({ icon: '📝', title: n.title, type: 'Note', route: 'note', id: n.id }); });
    (Cache.pdfs || []).forEach(p => { if (!q || p.title.toLowerCase().includes(q)) out.push({ icon: '📄', title: p.title, type: 'PDF', route: 'pdf', id: p.id }); });
    (Cache.mnemonics || []).forEach(m => { if (!q || (m.title + m.mnemonicText + m.meaning).toLowerCase().includes(q)) out.push({ icon: '🧠', title: m.title, type: 'Mnemonic', route: 'mnemonics', id: m.id }); });
    (Cache.jargons || []).forEach(j => { if (!q || (j.term + j.meaning).toLowerCase().includes(q)) out.push({ icon: '🔤', title: j.term, type: 'Jargon', route: 'jargons', id: j.id }); });
    (Cache.questions || []).forEach(qq => { if (!q || qq.questionText.toLowerCase().includes(q)) out.push({ icon: '❓', title: qq.questionText.slice(0, 60), type: 'Question', route: 'questions', id: qq.id }); });
    return out;
  }
};

/* Full search page — filters (type, subject) and sorting, vs. the CmdK popup
   which is optimized for speed over one or two keystrokes. */
const SearchView = {
  query: '', typeFilter: '', subjectFilter: '', sortBy: 'relevance',
  render(q) {
    if (typeof q === 'string') this.query = q;
    return `<h2>Search</h2>
      <div class="card" style="margin-bottom:16px;max-width:640px;">
        <label>Query</label><input type="text" id="searchQ" value="${esc(this.query)}" oninput="SearchView.onInput(this.value)" placeholder="Search notes, PDFs, mnemonics, jargons, questions…" title="Search query">
        <div class="note-meta-row" style="margin-top:10px;">
          <select onchange="SearchView.typeFilter=this.value;SearchView.refresh()" title="Filter results by content type">
            <option value="">All types</option>
            ${['Note', 'PDF', 'Mnemonic', 'Jargon', 'Question'].map(t => `<option value="${t}" ${this.typeFilter === t ? 'selected' : ''}>${t}</option>`).join('')}
          </select>
          <select onchange="SearchView.subjectFilter=this.value;SearchView.refresh()" title="Filter results by subject">
            <option value="">All subjects</option>${subjectOptions(this.subjectFilter)}
          </select>
          <select onchange="SearchView.sortBy=this.value;SearchView.refresh()" title="Change the sort order">
            <option value="relevance" ${this.sortBy === 'relevance' ? 'selected' : ''}>Sort: Relevance</option>
            <option value="newest" ${this.sortBy === 'newest' ? 'selected' : ''}>Sort: Newest</option>
            <option value="alpha" ${this.sortBy === 'alpha' ? 'selected' : ''}>Sort: Alphabetical</option>
          </select>
        </div>
      </div>
      <div id="searchResultsWrap">${this.resultsHTML()}</div>`;
  },
  onInput: debounce(function (v) { SearchView.query = v; SearchView.refresh(); }, 200),
  refresh() { const el = document.getElementById('searchResultsWrap'); if (el) el.innerHTML = this.resultsHTML(); },
  itemSubjectId(r) {
    if (r.type === 'Note') return Cache.notes.find(x => x.id === r.id)?.subjectId;
    if (r.type === 'PDF') return Cache.pdfs.find(x => x.id === r.id)?.subjectId;
    if (r.type === 'Jargon') return Cache.jargons.find(x => x.id === r.id)?.subjectId;
    if (r.type === 'Question') return Cache.questions.find(x => x.id === r.id)?.subjectId;
    if (r.type === 'Mnemonic') { const m = Cache.mnemonics.find(x => x.id === r.id); return m ? topicSubjectId(m.topicId) : ''; }
    return '';
  },
  itemDate(r) {
    const stores = { Note: 'notes', PDF: 'pdfs', Jargon: 'jargons', Question: 'questions', Mnemonic: 'mnemonics' };
    const obj = (Cache[stores[r.type]] || []).find(x => x.id === r.id);
    return obj ? (obj.updatedAt || obj.createdAt) : null;
  },
  resultsHTML() {
    let results = Search.run(this.query);
    if (this.typeFilter) results = results.filter(r => r.type === this.typeFilter);
    if (this.subjectFilter) results = results.filter(r => this.itemSubjectId(r) === this.subjectFilter);
    if (this.sortBy === 'alpha') results = [...results].sort((a, b) => (a.title || '').localeCompare(b.title || ''));
    else if (this.sortBy === 'newest') results = [...results].sort((a, b) => new Date(this.itemDate(b) || 0) - new Date(this.itemDate(a) || 0));
    return `<div class="subtle" style="margin-bottom:8px;">${results.length} result${results.length === 1 ? '' : 's'}</div>
      ${results.length ? results.map(r => `<div class="list-row" onclick="UI.nav('${r.route}',{id:'${r.id}'})" title="Open this ${r.type}"><span>${r.icon}</span><div style="flex:1;">${esc(r.title)}</div><span class="pill">${r.type}</span></div>`).join('') : `<div class="subtle">No results.</div>`}`;
  }
};

/* ============================== REVISION / FLASHCARDS VIEW ============================== */
const RevisionView = {
  mode: 'list',
  cardIndex: 0,
  showAnswer: false,
  render() {
    const due = Revision.dueItems();
    const kindLabel = (d) => d.type === 'note' ? 'Note' : d.obj.sourceType === 'question' ? 'Question' : 'Mnemonic';
    const kindIcon = (d) => d.type === 'note' ? '📝' : d.obj.sourceType === 'question' ? '❓' : '🧠';
    if (this.mode === 'list' || !due.length) {
      if (!due.length) return emptyState('🎉', 'Nothing due for revision right now.', null, null);
      return `<h2>Revision due today (${due.length})</h2>
      <button class="btn" style="margin-bottom:14px;" onclick="RevisionView.mode='cards';RevisionView.cardIndex=0;Router.render();" title="Begin reviewing everything due today, one card at a time">▶ Start Revision Session</button>
      ${due.map(d => `<div class="list-row"><span>${kindIcon(d)}</span>
        <div style="flex:1;">${esc(d.type === 'note' ? d.obj.title : d.obj.front)}</div>
        <span class="pill">${kindLabel(d)}</span></div>`).join('')}`;
    }
    // card mode
    if (this.cardIndex >= due.length) { this.mode = 'list'; toast('Revision session complete 🎉'); return this.render(); }
    const d = due[this.cardIndex];
    const front = d.type === 'note' ? d.obj.title : d.obj.front;
    const back = d.type === 'note' ? '(open the note to review in full)' : d.obj.back;
    return `<div class="subtle" style="margin-bottom:10px;">Card ${this.cardIndex + 1} of ${due.length} · ${kindLabel(d)}</div>
      <div class="flash-card" onclick="RevisionView.showAnswer=!RevisionView.showAnswer;Router.render();" title="Click to flip the card">
        ${this.showAnswer ? esc(back) : esc(front)}
      </div>
      <div class="subtle" style="text-align:center;margin-top:8px;">Tap card to flip</div>
      <div class="rate-row">
        <button class="again" onclick="RevisionView.rate('${d.type}','${d.obj.id}','again')" title="Forgot it — review again soon">Again</button>
        <button class="hard" onclick="RevisionView.rate('${d.type}','${d.obj.id}','hard')" title="Struggled — review sooner than usual">Hard</button>
        <button class="good" onclick="RevisionView.rate('${d.type}','${d.obj.id}','good')" title="Got it — review on the normal schedule">Good</button>
        <button class="easy" onclick="RevisionView.rate('${d.type}','${d.obj.id}','easy')" title="Knew it well — review much later">Easy</button>
      </div>
      <div style="text-align:center;margin-top:16px;"><button class="btn secondary sm" onclick="RevisionView.mode='list';Router.render();" title="Stop this revision session">Exit session</button></div>`;
  },
  async rate(type, id, rating) {
    await Revision.rate(type, id, rating);
    this.cardIndex++; this.showAnswer = false; Router.render();
  }
};

/* ============================== EXAM MODE ============================== */
const ExamMode = {
  state: 'setup', // setup | question | summary
  queue: [], index: 0, answer: '', graded: false, timerSeconds: 0, timerInterval: null, results: [], minPerMark: 1.5,
  render() {
    if (this.state === 'summary') return this.renderSummary();
    if (this.state === 'question') return this.renderQuestion();
    return this.renderSetup();
  },
  renderSetup() {
    return `<h2>Exam Mode</h2>
      <p class="subtle">Attempt questions one at a time under a timer, then self-grade against the model answer.</p>
      <div class="card" style="max-width:420px;">
        <label>Subject</label>
        <select id="examSubject" title="Limit the exam to one subject"><option value="">All subjects</option>${subjectOptions()}</select>
        <label>Difficulty</label>
        <select id="examDiff" title="Limit the exam to one difficulty"><option value="">Any</option><option>Easy</option><option>Medium</option><option>Hard</option></select>
        <label>Minutes per mark</label>
        <input type="number" id="examMinPerMark" value="1.5" step="0.5" min="0.5" title="How many minutes per mark to allow for each question">
        <button class="btn" style="margin-top:12px;" onclick="ExamMode.start()" title="Begin the timed exam with these filters">Start Exam</button>
      </div>`;
  },
  start() {
    const subj = document.getElementById('examSubject').value;
    const diff = document.getElementById('examDiff').value;
    this.minPerMark = parseFloat(document.getElementById('examMinPerMark').value) || 1.5;
    this.queue = (Cache.questions || []).filter(q => (!subj || q.subjectId === subj) && (!diff || q.difficulty === diff));
    if (!this.queue.length) { toast('No questions match those filters — add some in the Questions section first.'); return; }
    this.queue = [...this.queue].sort(() => Math.random() - 0.5);
    this.index = 0; this.results = []; this.state = 'question';
    this.beginTimerForCurrent();
    Router.render();
  },
  beginTimerForCurrent() {
    clearInterval(this.timerInterval);
    const q = this.queue[this.index];
    this.timerSeconds = Math.max(30, Math.round((q.marks || 5) * this.minPerMark * 60));
    this.graded = false; this.answer = ''; this.autoVerdict = null;
    this.timerInterval = setInterval(() => {
      this.timerSeconds--;
      const d = document.getElementById('examTimerDisplay');
      if (d) d.textContent = ExamMode.fmtTime();
      if (this.timerSeconds <= 0) { clearInterval(this.timerInterval); ExamMode.submit(); }
    }, 1000);
  },
  fmtTime() {
    const s = Math.max(0, this.timerSeconds);
    return `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;
  },
  renderQuestion() {
    const q = this.queue[this.index];
    if (!q) { this.state = 'summary'; return this.renderSummary(); }
    if (!this.graded) {
      return `<div class="subtle">Question ${this.index + 1} of ${this.queue.length} · ${subjectName(q.subjectId)}</div>
        <div class="timer-display" id="examTimerDisplay" style="font-size:40px;margin:10px 0;">${this.fmtTime()}</div>
        <div class="card" style="max-width:640px;">
          <div style="display:flex;justify-content:space-between;gap:10px;"><b>${esc(q.questionText)}</b><span class="pill">${q.marks} marks</span></div>
          ${this.answerInputHTML(q)}
          <button class="btn" style="margin-top:10px;" onclick="ExamMode.submit()" title="Lock in your answer for this question">Submit</button>
        </div>`;
    }
    return this.gradedViewHTML(q);
  },
  answerInputHTML(q) {
    if (q.type === 'MCQ' && q.options?.length) {
      return q.options.map((opt, i) => `<label style="display:flex;gap:6px;align-items:center;margin:6px 0;">
        <input type="radio" name="examMcq" value="${i}"> ${esc(opt)}</label>`).join('');
    }
    if (q.type === 'True/False') {
      return `<div style="display:flex;gap:14px;margin-top:8px;">
        <label><input type="radio" name="examTF" value="True"> True</label>
        <label><input type="radio" name="examTF" value="False"> False</label></div>`;
    }
    if (q.type === 'Fill in the Blank') {
      return `<label>Your answer</label><input type="text" id="examFIB" title="Type your answer">`;
    }
    return `<label>Your answer</label><textarea id="examAnswerBox" rows="6" oninput="ExamMode.answer=this.value">${esc(this.answer)}</textarea>`;
  },
  gradedViewHTML(q) {
    if (this.autoVerdict) {
      const correctText = q.type === 'MCQ' ? q.options[q.correctOptionIndex] : q.correctAnswerText;
      return `<div class="subtle">Question ${this.index + 1} of ${this.queue.length}</div>
        <div class="card" style="max-width:640px;">
          <b>${esc(q.questionText)}</b>
          <hr class="sep">
          <div class="pill ${this.autoVerdict === 'correct' ? '' : 'warn'}">${this.autoVerdict === 'correct' ? '✅ Correct' : '❌ Incorrect'}</div>
          <div class="subtle" style="margin-top:8px;">Your answer: ${esc(this.answer) || '(none)'}<br>Correct answer: ${esc(correctText || '')}</div>
          <button class="btn" style="margin-top:14px;" onclick="ExamMode.grade('${this.autoVerdict}')" title="Move to the next question">Continue</button>
        </div>`;
    }
    return `<div class="subtle">Question ${this.index + 1} of ${this.queue.length}</div>
      <div class="card" style="max-width:640px;">
        <b>${esc(q.questionText)}</b>
        <hr class="sep">
        <label>Your answer</label>
        <div class="subtle" style="white-space:pre-wrap;padding:8px;background:var(--bg);border-radius:8px;">${esc(this.answer) || '(No answer given — time ran out or nothing was typed)'}</div>
        <label style="margin-top:12px;">Model answer</label>
        <div class="subtle" style="white-space:pre-wrap;padding:8px;background:var(--bg);border-radius:8px;">${esc(q.modelAnswer) || '(No model answer recorded)'}</div>
        <div class="rate-row" style="margin-top:14px;">
          <button class="good" onclick="ExamMode.grade('correct')" title="Mark this attempt correct">Correct</button>
          <button class="hard" onclick="ExamMode.grade('partial')" title="Mark this attempt partially correct">Partially correct</button>
          <button class="again" onclick="ExamMode.grade('incorrect')" title="Mark this attempt incorrect">Incorrect</button>
        </div>
        <div class="subtle" style="text-align:center;margin-top:8px;font-size:11.5px;">Grading also updates this question's flashcard revision schedule.</div>
      </div>`;
  },
  submit() {
    clearInterval(this.timerInterval);
    const q = this.queue[this.index];
    if (q.type === 'MCQ') {
      const sel = document.querySelector('input[name="examMcq"]:checked');
      this.answer = sel ? q.options[parseInt(sel.value)] : '';
      this.autoVerdict = sel && parseInt(sel.value) === q.correctOptionIndex ? 'correct' : 'incorrect';
    } else if (q.type === 'True/False') {
      const sel = document.querySelector('input[name="examTF"]:checked');
      this.answer = sel ? sel.value : '';
      this.autoVerdict = sel && sel.value === q.correctAnswerText ? 'correct' : 'incorrect';
    } else if (q.type === 'Fill in the Blank') {
      this.answer = document.getElementById('examFIB')?.value || '';
      this.autoVerdict = this.answer.trim().toLowerCase() === (q.correctAnswerText || '').trim().toLowerCase() ? 'correct' : 'incorrect';
    } else {
      this.autoVerdict = null;
    }
    this.graded = true;
    Router.render();
  },
  grade(verdict) {
    const q = this.queue[this.index];
    q.status = verdict === 'correct' ? 'correct' : 'incorrect';
    saveItem('questions', q);
    const fc = Flashcards.findFor('question', q.id);
    if (fc) Revision.rate('flashcard', fc.id, verdict === 'correct' ? 'good' : verdict === 'partial' ? 'hard' : 'again');
    this.results.push({ questionText: q.questionText, verdict, marks: q.marks });
    this.index++;
    if (this.index >= this.queue.length) { this.state = 'summary'; Router.render(); return; }
    this.beginTimerForCurrent();
    Router.render();
  },
  renderSummary() {
    clearInterval(this.timerInterval);
    const total = this.results.length;
    const correct = this.results.filter(r => r.verdict === 'correct').length;
    const needsWork = total - correct;
    return `<h2>Exam Summary</h2>
      <div class="grid cols-3" style="margin-bottom:18px;">
        <div class="card"><div class="subtle">Attempted</div><h2 style="margin:6px 0;">${total}</h2></div>
        <div class="card"><div class="subtle">Correct</div><h2 style="margin:6px 0;">${correct}</h2></div>
        <div class="card"><div class="subtle">Needs work</div><h2 style="margin:6px 0;">${needsWork}</h2></div>
      </div>
      ${this.results.map(r => `<div class="list-row"><span>${r.verdict === 'correct' ? '✅' : r.verdict === 'partial' ? '🟡' : '🔴'}</span><div style="flex:1;">${esc(r.questionText)}</div><span class="pill">${r.marks} marks</span></div>`).join('')}
      <button class="btn" style="margin-top:16px;" onclick="ExamMode.reset()" title="Return to the exam setup screen">Start another exam</button>`;
  },
  reset() { this.state = 'setup'; this.queue = []; this.index = 0; this.results = []; Router.render(); }
};

/* ============================== LAST-MINUTE REVISION MODE ============================== */
const LMR = {
  mode: 'setup', index: 0, items: [],
  gather(subjectId) {
    const items = [];
    (Cache.notes || []).forEach(n => {
      if (subjectId && n.subjectId !== subjectId) return;
      if (n.importance >= 4 || n.examFrequency === 'high' || n.status === 'difficult') {
        items.push({ type: 'Note', icon: '📝', title: n.title, body: stripHtml(n.content).slice(0, 500), tag: n.examFrequency === 'high' ? 'Exam Important' : (n.status === 'difficult' ? 'Difficult' : `★${n.importance}`) });
      }
    });
    (Cache.jargons || []).forEach(j => {
      if (subjectId && j.subjectId !== subjectId) return;
      if (j.importance && j.importance !== 'Normal') {
        items.push({ type: 'Jargon', icon: '🔤', title: j.term, body: j.meaning + (j.memoryTrick ? `\n💡 ${j.memoryTrick}` : ''), tag: j.importance });
      }
    });
    (Cache.questions || []).forEach(q => {
      if (subjectId && q.subjectId !== subjectId) return;
      if (q.difficulty === 'Hard') {
        items.push({ type: 'Question', icon: '❓', title: q.questionText, body: q.modelAnswer || '(No model answer recorded)', tag: 'Hard' });
      }
    });
    (Cache.mnemonics || []).forEach(m => {
      if (subjectId && topicSubjectId(m.topicId) !== subjectId) return;
      if (m.favorite) {
        items.push({ type: 'Mnemonic', icon: '🧠', title: m.title, body: `${m.mnemonicText}\n${m.meaning}`, tag: 'Favorite' });
      }
    });
    return items;
  },
  render() { return this.mode === 'setup' ? this.renderSetup() : this.renderStream(); },
  renderSetup() {
    return `<h2>Last-Minute Revision</h2>
      <p class="subtle">Rapid-fire through only your highest-priority content: ★4–5 notes, exam-important notes, difficult topics, must-memorize jargons, hard questions, and favorited mnemonics.</p>
      <div class="card" style="max-width:420px;">
        <label>Subject</label>
        <select id="lmrSubject" title="Limit the review stream to one subject"><option value="">All subjects</option>${subjectOptions()}</select>
        <button class="btn" style="margin-top:12px;" onclick="LMR.start()" title="Begin the rapid-review stream">Start</button>
      </div>`;
  },
  start() {
    const subj = document.getElementById('lmrSubject').value;
    this.items = this.gather(subj);
    if (!this.items.length) { toast('Nothing marked high-importance / exam-critical yet for this selection.'); return; }
    this.index = 0; this.mode = 'stream'; Router.render();
  },
  renderStream() {
    if (this.index >= this.items.length) {
      return `<div class="empty-state"><div style="font-size:38px;">🎉</div><h3>That's everything marked important.</h3>
      <button class="btn" onclick="LMR.reset()" title="Choose a different subject">Back to setup</button></div>`;
    }
    const it = this.items[this.index];
    return `<div class="subtle" style="margin-bottom:10px;">${this.index + 1} of ${this.items.length} · ${it.type}</div>
      <div class="card" style="max-width:640px;">
        <div style="display:flex;justify-content:space-between;gap:10px;"><b>${it.icon} ${esc(it.title)}</b><span class="pill warn">${esc(it.tag)}</span></div>
        <div class="subtle" style="white-space:pre-wrap;margin-top:10px;">${esc(it.body)}</div>
      </div>
      <div style="display:flex;gap:8px;justify-content:center;margin-top:16px;">
        <button class="btn secondary" ${this.index === 0 ? 'disabled' : ''} onclick="LMR.index--;Router.render();" title="Previous item">‹ Prev</button>
        <button class="btn" onclick="LMR.index++;Router.render();" title="Next item">Next ›</button>
      </div>
      <div style="text-align:center;margin-top:10px;"><button class="btn secondary sm" onclick="LMR.reset()" title="Stop this review stream">Exit</button></div>`;
  },
  reset() { this.mode = 'setup'; this.items = []; this.index = 0; Router.render(); }
};

/* ============================== STUDY TIMER / FOCUS MODE ============================== */
const Timer = {
  seconds: 25 * 60, running: false, interval: null, mode: '25/5',
  render() {
    return `<h2>Study Timer</h2>
    <div class="card" style="max-width:420px;">
      <div style="display:flex;gap:8px;">
        <button class="btn sm ${this.mode === '25/5' ? '' : 'secondary'}" onclick="Timer.setMode('25/5')" title="25 minutes work, 5 minutes break">25 / 5</button>
        <button class="btn sm ${this.mode === '50/10' ? '' : 'secondary'}" onclick="Timer.setMode('50/10')" title="50 minutes work, 10 minutes break">50 / 10</button>
        <button class="btn sm ${this.mode === 'custom' ? '' : 'secondary'}" onclick="Timer.setMode('custom')" title="Set your own duration">Custom</button>
      </div>
      <div class="timer-display" id="timerDisplay">${Timer.fmt()}</div>
      <div style="display:flex;gap:8px;justify-content:center;">
        <button class="btn" onclick="Timer.start()" title="${this.running ? 'Pause the timer' : 'Start the timer'}">${this.running ? 'Pause' : 'Start'}</button>
        <button class="btn secondary" onclick="Timer.reset()" title="Reset the timer to the start">Reset</button>
      </div>
    </div>
    <hr class="sep">
    <h3>This week</h3>
    <div class="subtle">${(Cache.studySessions || []).filter(s => new Date(s.date) > new Date(Date.now() - 7 * 864e5)).reduce((a, b) => a + b.duration, 0)} min studied</div>`;
  },
  fmt() { const m = Math.floor(this.seconds / 60).toString().padStart(2, '0'); const s = (this.seconds % 60).toString().padStart(2, '0'); return `${m}:${s}`; },
  setMode(m) { this.mode = m; this.seconds = m === '25/5' ? 1500 : m === '50/10' ? 3000 : 1500; this.running = false; clearInterval(this.interval); Router.render(); },
  start() {
    if (this.running) { this.running = false; clearInterval(this.interval); Router.render(); return; }
    this.running = true;
    this.interval = setInterval(() => {
      this.seconds--;
      const d = document.getElementById('timerDisplay'); if (d) d.textContent = this.fmt();
      if (this.seconds <= 0) { clearInterval(this.interval); this.running = false; toast('Session complete!'); saveItem('studySessions', { id: uid(), duration: (this.mode === '25/5' ? 25 : 50), date: nowISO() }); Router.render(); }
    }, 1000);
    Router.render();
  },
  reset() { clearInterval(this.interval); this.running = false; this.setMode(this.mode); }
};

/* ============================== TRASH ============================== */
const TrashView = {
  render() {
    const items = Cache.trash || [];
    if (!items.length) return emptyState('🗑', 'Trash is empty.', null, null);
    return `<h2>Trash</h2>${items.map(t => `<div class="list-row">
      <span>🗑</span><div style="flex:1;">${esc(t.data.title || t.data.term || t.data.questionText || t.data.name || 'Item')}<div class="subtle">${t.type} · deleted ${fmtDate(t.deletedAt)}</div></div>
      <button class="btn sm secondary" onclick="restoreTrash('${t.id}');Router.render();" title="Restore this item to where it was">Restore</button>
      <button class="btn sm danger" onclick="TrashView.purge('${t.id}')" title="Permanently delete — this cannot be undone">Delete forever</button>
    </div>`).join('')}
    ${items.length ? `<button class="btn danger sm" style="margin-top:12px;" onclick="TrashView.empty()" title="Permanently delete everything in Trash">Empty Trash</button>` : ''}`;
  },
  async purge(id) { if (!confirm('Permanently delete?')) return; await DB.del('trash', id); Cache.trash = Cache.trash.filter(t => t.id !== id); Router.render(); },
  async empty() { if (!confirm('Empty trash permanently?')) return; await DB.clearStore('trash'); Cache.trash = []; Router.render(); }
};

/* ============================== SETTINGS VIEW ============================== */
const SettingsView = {
  render() {
    return `<h2>Settings</h2>
    <div class="card" style="max-width:520px;margin-bottom:14px;">
      <h4 style="margin-top:0;">Appearance</h4>
      <label>Theme</label>
      <select onchange="Settings.set('theme',this.value).then(()=>Theme.apply())" title="Switch between light and dark mode">
        <option value="light" ${Settings.get('theme') === 'light' ? 'selected' : ''}>Light</option>
        <option value="dark" ${Settings.get('theme') === 'dark' ? 'selected' : ''}>Dark</option>
      </select>
    </div>
    <div class="card" style="max-width:520px;margin-bottom:14px;">
      <h4 style="margin-top:0;">Revision intervals (days)</h4>
      <input type="text" id="intervalsInput" value="${Settings.get('revisionIntervals').join(', ')}" title="Comma-separated days between reviews, e.g. 1, 3, 7, 14, 30">
      <button class="btn sm" style="margin-top:8px;" onclick="SettingsView.saveIntervals()" title="Save these revision day-gaps">Save intervals</button>
    </div>
    <div class="card" style="max-width:520px;margin-bottom:14px;">
      <h4 style="margin-top:0;">Backup & Restore</h4>
      <p class="subtle">Export everything (notes, subjects, questions, mnemonics, jargons, revision data, settings, annotations, bookmarks) to a JSON file. PDFs are excluded from JSON backup — export them separately below.</p>
      <button class="btn sm" onclick="BackupService.exportJSON()" title="Download all your data as a JSON file">⬇ Export backup (.json)</button>
      <input type="file" id="restoreInput" accept="application/json" style="display:none" onchange="BackupService.importJSON(this)">
      <button class="btn sm secondary" onclick="document.getElementById('restoreInput').click()" title="Choose a previously exported backup file">⬆ Restore from backup</button>
    </div>
    <div class="card" style="max-width:520px;margin-bottom:14px;">
      <h4 style="margin-top:0;">Readable Exports</h4>
      <p class="subtle">Unlike the JSON backup above (meant for restoring into this app), these are plain-text Markdown files meant for reading, printing, or sharing outside the app — organized and human-readable.</p>
      <button class="btn sm secondary" onclick="BackupService.exportAllNotesMarkdown()" title="One Markdown file with every note, organized by subject and chapter">⬇ All notes (Markdown)</button>
      <button class="btn sm secondary" style="margin-top:6px;" onclick="BackupService.exportHighlightsMarkdown()" title="One Markdown file with every highlight, annotation and sticky note across your notes and PDFs">⬇ All highlights &amp; annotations (Markdown)</button>
    </div>
    <div class="card" style="max-width:520px;margin-bottom:14px;">
      <h4 style="margin-top:0;">Google Drive Sync</h4>
      <p class="subtle">Keeps your data (the same content as the JSON backup above — not the app's own files) automatically saved to a file in <i>your</i> Google Drive, inside a "CA Study" folder this app creates. Uses a drive.file-scoped connection, so it can only ever see files it made itself — never the rest of your Drive. A Client ID is already configured, so just click Connect below (needs the app to be hosted over https — Google sign-in doesn't work when it's just opened as a local file).</p>
      ${SettingsView.driveSectionHTML()}
    </div>
    <div class="card" style="max-width:520px;">
      <h4 style="margin-top:0;">About</h4>
      <p class="subtle">CA Study — a local-first revision workspace. All data is stored in this browser's IndexedDB; nothing leaves your device unless you export it or turn on Google Drive Sync above.</p>
    </div>`;
  },
  driveSectionHTML() {
    const clientId = Settings.get('googleClientId') || '';
    const lastSynced = Settings.get('googleLastSynced');
    let html = `<label>Google OAuth Client ID</label>
      <input type="text" id="gClientId" value="${esc(clientId)}" placeholder="xxxxxxxxxx.apps.googleusercontent.com" title="From Google Cloud Console — see instructions below">
      <button class="btn sm" style="margin-top:8px;" onclick="SettingsView.saveClientId()" title="Save this Client ID">Save Client ID</button>`;
    if (clientId) {
      if (DriveSync.connected) {
        html += `<div class="pill" style="margin-top:12px;">✅ Connected</div>
          <div class="subtle" style="margin-top:4px;">Last synced: ${lastSynced ? fmtDate(lastSynced) + ' · ' + new Date(lastSynced).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'not yet'}</div>
          <div class="note-meta-row" style="margin-top:10px;">
            <button class="btn sm secondary" onclick="DriveSync.syncNow()" title="Push your latest data to Drive right now">Sync now</button>
            <button class="btn sm secondary" onclick="DriveSync.restoreFromDrive()" title="Pull data from Drive and merge it into this device">Restore from Drive</button>
            <button class="btn sm danger" onclick="DriveSync.disconnect()" title="Disconnect this device from Drive sync">Disconnect</button>
          </div>`;
      } else {
        html += `<div style="margin-top:12px;"><button class="btn sm" onclick="DriveSync.connect()" title="Sign in with Google and authorize this app to sync your data">Connect Google Drive</button></div>`;
      }
    }
    html += `<details style="margin-top:14px;">
      <summary style="cursor:pointer;font-size:13px;color:var(--text-dim);">Using a different Client ID (e.g. you host this at your own URL)</summary>
      <p class="subtle" style="margin-top:8px;">The default Client ID above is locked to a specific set of authorized URLs in Google Cloud Console. If you deploy this app somewhere else and Connect fails, set up your own:</p>
      <ol class="subtle" style="padding-left:18px;margin-top:8px;">
        <li>Go to <a href="https://console.cloud.google.com/" target="_blank" rel="noopener">console.cloud.google.com</a> and create (or pick) a project.</li>
        <li>APIs &amp; Services → Library → search "Google Drive API" → Enable.</li>
        <li>APIs &amp; Services → OAuth consent screen → External → fill in the basics, add your own email as a test user (no need to publish or verify it for personal use).</li>
        <li>APIs &amp; Services → Credentials → Create Credentials → OAuth client ID → Application type: Web application.</li>
        <li>Under "Authorized JavaScript origins," add the exact URL you open this app from (e.g. https://yourname.github.io) — no path, no trailing slash. Add http://localhost:PORT too if you test locally.</li>
        <li>Copy the Client ID (ends in <code>.apps.googleusercontent.com</code> — no Client Secret needed) and paste it above.</li>
      </ol>
    </details>`;
    return html;
  },
  async saveClientId() {
    const id = document.getElementById('gClientId').value.trim();
    await Settings.set('googleClientId', id);
    toast(id ? 'Client ID saved' : 'Client ID cleared');
    DriveSync.init();
    Router.render();
  },
  async saveIntervals() {
    const arr = document.getElementById('intervalsInput').value.split(',').map(x => parseInt(x.trim())).filter(n => !isNaN(n));
    if (!arr.length) return;
    await Settings.set('revisionIntervals', arr); toast('Intervals updated');
  }
};

const BackupService = {
  /* Shared by local export/import and Google Drive sync below, so both use
     exactly the same rules for what's included. PDFs (binary, large) and
     noteVersions (derived history, reconstructable) are left out — export
     a PDF individually if you need one outside the browser. */
  buildBackupObject() {
    const data = {};
    for (const s of STORES) { if (s === 'pdfs' || s === 'noteVersions') continue; data[s] = Cache[s]; }
    data.pdfsMeta = (Cache.pdfs || []).map(p => ({ id: p.id, filename: p.filename, title: p.title, pageCount: p.pageCount }));
    data._exportedAt = nowISO();
    return data;
  },
  async mergeBackupObject(data) {
    for (const s of STORES) {
      if (s === 'pdfs' || s === 'noteVersions' || !data[s]) continue;
      for (const obj of data[s]) await DB.put(s, obj);
    }
    await loadAllToCache();
    Tree.render(); Router.render();
  },
  async exportJSON() {
    const data = this.buildBackupObject();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `castudy-backup-${new Date().toISOString().slice(0, 10)}.json`; a.click();
  },
  importJSON(input) {
    const file = input.files[0]; if (!file) return;
    if (!confirm('Restoring will merge this backup into your existing data. Continue?')) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const data = JSON.parse(reader.result);
        await this.mergeBackupObject(data);
        toast('Backup restored');
      } catch (e) { toast('Invalid backup file'); }
    };
    reader.readAsText(file);
  },

  /* ---- readable bulk exports (plain Markdown, meant for reading/printing/sharing — not for restoring into the app) ---- */
  exportAllNotesMarkdown() {
    const notes = Cache.notes || [];
    if (!notes.length) { toast('No notes to export yet'); return; }
    let md = `# CA Study — All Notes\n\nExported ${fmtDate(nowISO())}\n`;
    const bySubject = {};
    notes.forEach(n => { (bySubject[n.subjectId || '_none'] = bySubject[n.subjectId || '_none'] || []).push(n); });
    // Sort subjects by name for a predictable, readable order
    const subjectIds = Object.keys(bySubject).sort((a, b) => (a === '_none' ? 1 : b === '_none' ? -1 : subjectName(a).localeCompare(subjectName(b))));
    subjectIds.forEach(sId => {
      md += `\n## ${sId === '_none' ? 'Unfiled' : subjectName(sId)}\n`;
      const byChapter = {};
      bySubject[sId].forEach(n => { (byChapter[n.chapterId || '_none'] = byChapter[n.chapterId || '_none'] || []).push(n); });
      const chapterIds = Object.keys(byChapter).sort((a, b) => (a === '_none' ? 1 : b === '_none' ? -1 : chapterName(a).localeCompare(chapterName(b))));
      chapterIds.forEach(cId => {
        if (cId !== '_none') md += `\n### ${chapterName(cId)}\n`;
        byChapter[cId].forEach(n => {
          md += `\n#### ${n.title}\n\n${htmlToMarkdown(n.content)}\n`;
        });
      });
    });
    downloadText(`castudy-all-notes-${new Date().toISOString().slice(0, 10)}.md`, md, 'text/markdown');
  },
  exportHighlightsMarkdown() {
    const colorLabel = (cls) => (Settings.get('highlightColors').find(c => c.key === cls) || {}).label || cls;
    let md = `# CA Study — Highlights & Annotations\n\nExported ${fmtDate(nowISO())}\n`;
    let any = false;

    const notesWithMarks = (Cache.notes || []).map(n => {
      const div = document.createElement('div'); div.innerHTML = n.content;
      const marks = Array.from(div.querySelectorAll('mark'));
      return { note: n, marks };
    }).filter(x => x.marks.length);
    if (notesWithMarks.length) {
      any = true;
      md += `\n## Note highlights\n`;
      notesWithMarks.forEach(({ note, marks }) => {
        md += `\n### ${note.title}\n`;
        marks.forEach(m => { md += `- **[${colorLabel(Array.from(m.classList)[0] || '')}]** ${m.textContent.trim()}\n`; });
      });
    }

    const noteAnnots = (Cache.annotations || []).filter(a => a.targetType === 'note');
    if (noteAnnots.length) {
      any = true;
      md += `\n## Note annotations\n`;
      noteAnnots.forEach(a => {
        const note = (Cache.notes || []).find(n => n.id === a.targetId);
        md += `- **${note ? note.title : 'Note'}** — "${a.text}": ${a.comment}\n`;
      });
    }

    const pdfMarks = (Cache.annotations || []).filter(a => a.targetType === 'pdf' && (a.kind === 'highlight' || a.kind === 'underline'));
    if (pdfMarks.length) {
      any = true;
      md += `\n## PDF highlights & underlines\n`;
      pdfMarks.forEach(a => {
        const pdf = (Cache.pdfs || []).find(p => p.id === a.pdfId);
        md += `- **${pdf ? pdf.title : 'PDF'}** (p.${a.page}, ${a.kind}) — ${a.text || ''}\n`;
      });
    }

    const stickies = (Cache.annotations || []).filter(a => a.targetType === 'pdf' && a.kind === 'sticky');
    if (stickies.length) {
      any = true;
      md += `\n## PDF sticky notes\n`;
      stickies.forEach(a => {
        const pdf = (Cache.pdfs || []).find(p => p.id === a.pdfId);
        md += `- **${pdf ? pdf.title : 'PDF'}** (p.${a.page}) — ${a.comment}\n`;
      });
    }

    const drawings = (Cache.annotations || []).filter(a => a.targetType === 'pdf' && ['ink', 'arrow', 'rect'].includes(a.kind));
    if (drawings.length) {
      any = true;
      const byPdf = {};
      drawings.forEach(a => { const pdf = (Cache.pdfs || []).find(p => p.id === a.pdfId); const key = pdf ? pdf.title : 'PDF'; byPdf[key] = (byPdf[key] || 0) + 1; });
      md += `\n## PDF drawings\n\n(Freehand drawings don't have text content — counted here; open the PDF to view them, or use "⬇ Export PDF" on that PDF to get them burned into a downloadable copy.)\n\n`;
      Object.entries(byPdf).forEach(([title, count]) => { md += `- **${title}** — ${count} drawing(s)\n`; });
    }

    if (!any) { toast('Nothing highlighted or annotated yet'); return; }
    downloadText(`castudy-highlights-${new Date().toISOString().slice(0, 10)}.md`, md, 'text/markdown');
  }
};

/* ============================== GOOGLE DRIVE SYNC ==============================
   Saves your data (not the app files — the actual notes/questions/etc, the same
   content as a JSON backup) to a file in your own Google Drive, using a
   drive.file-scoped OAuth token. drive.file means this app can only ever see or
   touch files it created itself — never the rest of your Drive.
   Requires a Google Cloud OAuth Client ID that you create yourself (see Settings
   for instructions) — Google requires the app be served over http(s), not
   opened as a local file, for sign-in to work at all. */
const DriveSync = {
  tokenClient: null, accessToken: null, tokenExpiresAt: 0, connected: false, syncing: false, dirty: false, lastSyncError: null,
  DRIVE_FOLDER_NAME: 'CA Study', DRIVE_FILE_NAME: 'castudy-backup.json',

  updateStatusBadge() {
    const el = document.getElementById('driveStatusBadge');
    if (!el) return;
    if (!Settings.get('googleClientId')) { el.style.display = 'none'; return; }
    el.style.display = 'inline-block';
    if (this.syncing) {
      el.textContent = '☁ Syncing…'; el.className = 'pill'; el.title = 'Sync with Google Drive in progress';
    } else if (!this.connected) {
      el.textContent = '☁ Drive: not connected'; el.className = 'pill'; el.title = 'Click to connect Google Drive sync in Settings';
    } else if (this.lastSyncError) {
      el.textContent = '⚠ Drive sync failed'; el.className = 'pill warn'; el.title = this.lastSyncError + ' — click to open Settings';
    } else {
      const last = Settings.get('googleLastSynced');
      el.textContent = '☁ Synced ' + (last ? relTime(last) : '(pending)');
      el.className = 'pill';
      el.title = last ? `Last synced ${fmtDate(last)} · ${new Date(last).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} — click to open Settings` : 'Connected to Google Drive — click to open Settings';
    }
  },

  init() {
    const clientId = Settings.get('googleClientId');
    this.updateStatusBadge();
    if (!clientId || typeof google === 'undefined' || !google.accounts) return;
    try {
      this.tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: 'https://www.googleapis.com/auth/drive.file',
        callback: (resp) => this.onToken(resp),
      });
    } catch (e) { console.warn('Drive init failed', e); }
    // If previously connected, try a silent (no popup) reconnect so sync
    // resumes automatically without asking you to click Connect every visit.
    if (this.tokenClient && Settings.get('googleWasConnected')) {
      this.tokenClient.requestAccessToken({ prompt: '' });
    }
    // Safety-net flush every 60s in case a burst of changes never triggers
    // the trailing sync below (e.g. tab loses focus mid-throttle-window) —
    // also doubles as the badge's "Xm ago" text refresh tick.
    if (!this._flushInterval) {
      this._flushInterval = setInterval(() => {
        if (this.connected && this.dirty && navigator.onLine && !this.syncing) this.syncNow(true);
        this.updateStatusBadge();
      }, 60 * 1000);
    }
  },
  // Near-real-time sync: the first change in a burst syncs almost immediately;
  // rapid subsequent changes within the throttle window don't spam the Drive
  // API, but a trailing sync a few seconds after the last change guarantees
  // the final state still gets pushed even if you keep typing continuously.
  _lastSyncAttempt: 0, _trailingTimer: null,
  markDirty() {
    this.dirty = true;
    if (!this.connected || !navigator.onLine) return;
    const now = Date.now();
    clearTimeout(this._trailingTimer);
    if (now - this._lastSyncAttempt > 10000) {
      this._lastSyncAttempt = now;
      this.syncNow(true);
    } else {
      this._trailingTimer = setTimeout(() => { if (this.dirty) this.syncNow(true); }, 4000);
    }
  },
  onToken(resp) {
    if (resp.error) {
      if (resp.error !== 'immediate_failed' && resp.error !== 'popup_closed') toast('Google sign-in failed: ' + resp.error);
      this.updateStatusBadge();
      return;
    }
    this.accessToken = resp.access_token;
    this.tokenExpiresAt = Date.now() + (resp.expires_in || 3500) * 1000;
    this.connected = true;
    this.lastSyncError = null;
    Settings.set('googleWasConnected', true);
    this.updateStatusBadge();
    this.ensureFileId().then(() => this.syncNow(true)).then(() => Router.render());
  },
  async ensureValidToken() {
    if (this.accessToken && Date.now() < this.tokenExpiresAt - 60000) return true;
    if (!this.tokenClient) return false;
    return new Promise((resolve) => {
      const prevCallback = this.tokenClient.callback;
      this.tokenClient.callback = (resp) => { this.onToken(resp); resolve(!resp.error); this.tokenClient.callback = prevCallback; };
      this.tokenClient.requestAccessToken({ prompt: '' }); // silent refresh if still consented this session
    });
  },
  connect() {
    const clientId = Settings.get('googleClientId');
    if (!clientId) { toast('Add your Google Client ID below first'); return; }
    if (typeof google === 'undefined' || !google.accounts) { toast('Google sign-in script hasn\'t loaded — check your connection and try again'); return; }
    if (!this.tokenClient) this.init();
    if (!this.tokenClient) { toast('Could not start Google sign-in'); return; }
    this.tokenClient.requestAccessToken({ prompt: 'consent' });
  },
  disconnect() {
    if (this.accessToken && typeof google !== 'undefined' && google.accounts) {
      google.accounts.oauth2.revoke(this.accessToken, () => {});
    }
    this.accessToken = null; this.tokenExpiresAt = 0; this.connected = false; this.lastSyncError = null;
    Settings.set('googleWasConnected', false);
    Settings.set('googleFolderId', '').then(() => Settings.set('googleFileId', ''));
    toast('Disconnected from Google Drive');
    this.updateStatusBadge();
    Router.render();
  },
  async driveFetch(url, options = {}) {
    const ok = await this.ensureValidToken();
    if (!ok) throw new Error('Not signed in');
    const res = await fetch(url, { ...options, headers: { ...(options.headers || {}), Authorization: 'Bearer ' + this.accessToken } });
    if (!res.ok) {
      const raw = await res.text().catch(() => '');
      let reason = '', message = '';
      try { const j = JSON.parse(raw); message = j.error?.message || ''; reason = j.error?.errors?.[0]?.reason || j.error?.status || ''; } catch (e) { /* not JSON */ }
      console.warn('Drive API error', res.status, reason, message, raw.slice(0, 500));
      if (res.status === 403 && (/has not been used|disabled|accessNotConfigured|SERVICE_DISABLED/i.test(raw))) {
        throw new Error('The Google Drive API isn\'t enabled for this Google Cloud project yet. Go to console.cloud.google.com → APIs & Services → Library → search "Google Drive API" → Enable, then try again.');
      }
      if (res.status === 403) {
        throw new Error(`Google Drive refused this (403${reason ? ': ' + reason : ''}). ${message || 'Check that the Drive API is enabled and the OAuth consent screen includes your account as a test user.'}`);
      }
      if (res.status === 401) { this.accessToken = null; throw new Error('Google sign-in expired — click Sync now again to reconnect.'); }
      throw new Error(`Drive API ${res.status}${message ? ': ' + message : ''}`);
    }
    return res;
  },
  async ensureFileId() {
    let folderId = Settings.get('googleFolderId');
    if (!folderId) {
      const q = encodeURIComponent(`name='${this.DRIVE_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
      const res = await this.driveFetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`);
      const found = (await res.json()).files || [];
      if (found.length) folderId = found[0].id;
      else {
        const created = await this.driveFetch('https://www.googleapis.com/drive/v3/files', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: this.DRIVE_FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' })
        });
        folderId = (await created.json()).id;
      }
      await Settings.set('googleFolderId', folderId);
    }
    let fileId = Settings.get('googleFileId');
    if (!fileId) {
      const q = encodeURIComponent(`name='${this.DRIVE_FILE_NAME}' and '${folderId}' in parents and trashed=false`);
      const res = await this.driveFetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`);
      const found = (await res.json()).files || [];
      if (found.length) fileId = found[0].id;
      else {
        const created = await this.driveFetch('https://www.googleapis.com/drive/v3/files', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: this.DRIVE_FILE_NAME, parents: [folderId], mimeType: 'application/json' })
        });
        fileId = (await created.json()).id;
      }
      await Settings.set('googleFileId', fileId);
    }
    return fileId;
  },
  async syncNow(silent) {
    if (this.syncing) return;
    if (!this.connected) { if (!silent) toast('Connect Google Drive first'); return; }
    this.syncing = true; this.updateStatusBadge();
    try {
      const fileId = await this.ensureFileId();
      const data = BackupService.buildBackupObject();
      await this.driveFetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data)
      });
      this.dirty = false;
      this.lastSyncError = null;
      await Settings.set('googleLastSynced', nowISO());
      if (!silent) toast('Synced to Google Drive');
      if (UI.route === 'settings') Router.render();
    } catch (e) {
      console.warn('Drive sync failed', e);
      this.lastSyncError = e.message;
      if (!silent) toast('Sync failed — ' + e.message);
    } finally { this.syncing = false; this.updateStatusBadge(); }
  },
  async restoreFromDrive() {
    if (!this.connected) { toast('Connect Google Drive first'); return; }
    if (!confirm('Pull your data from Google Drive and merge it into what\'s on this device? Nothing here is deleted, but Drive\'s version of any matching item will win.')) return;
    try {
      const fileId = await this.ensureFileId();
      const res = await this.driveFetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`);
      const data = await res.json();
      await BackupService.mergeBackupObject(data);
      toast('Restored from Google Drive');
    } catch (e) {
      console.warn('Drive restore failed', e);
      toast('Restore failed — ' + e.message);
    }
  }
};

/* ============================== ANALYTICS ============================== */
const Analytics = {
  // Every distinct calendar day with any recorded activity — a study-timer
  // session, or a note/flashcard revision rating. Used for streaks.
  activeDaySet() {
    const days = new Set();
    (Cache.studySessions || []).forEach(s => days.add(new Date(s.date).toDateString()));
    (Cache.notes || []).forEach(n => (n.revision?.history || []).forEach(h => days.add(new Date(h.date).toDateString())));
    (Cache.flashcards || []).forEach(f => (f.history || []).forEach(h => days.add(new Date(h.date).toDateString())));
    return days;
  },
  streaks() {
    const days = this.activeDaySet();
    let current = 0;
    let cursor = new Date();
    if (!days.has(cursor.toDateString())) cursor.setDate(cursor.getDate() - 1); // today not logged yet isn't a broken streak
    while (days.has(cursor.toDateString())) { current++; cursor.setDate(cursor.getDate() - 1); }
    const sorted = Array.from(days).map(d => new Date(d)).sort((a, b) => a - b);
    let longest = 0, run = 0, prev = null;
    sorted.forEach(d => {
      run = (prev && (d - prev) === 86400000) ? run + 1 : 1;
      longest = Math.max(longest, run);
      prev = d;
    });
    return { current, longest, totalActiveDays: days.size };
  },
  last30Days() {
    const days = this.activeDaySet();
    const arr = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      arr.push({ date: d, active: days.has(d.toDateString()) });
    }
    return arr;
  },
  // Per-topic "weak" (difficult notes + incorrect questions) and "strong"
  // (mastered notes + correct questions) signal counts — the closest thing
  // to a mastery score without a dedicated topic-importance field.
  topicStats() {
    return (Cache.topics || []).map(t => {
      const chapter = (Cache.chapters || []).find(c => c.id === t.chapterId);
      const notes = (Cache.notes || []).filter(n => n.topicId === t.id);
      const questions = (Cache.questions || []).filter(q => q.topicId === t.id);
      const notesDifficult = notes.filter(n => n.status === 'difficult').length;
      const notesMastered = notes.filter(n => n.status === 'mastered').length;
      const qCorrect = questions.filter(q => q.status === 'correct').length;
      const qIncorrect = questions.filter(q => q.status === 'incorrect').length;
      return {
        topic: t, chapter, subjectId: chapter?.subjectId,
        notesDifficult, notesMastered, qCorrect, qIncorrect,
        weakScore: notesDifficult + qIncorrect, strongScore: notesMastered + qCorrect
      };
    });
  },
  weakTopics(limit = 6) { return this.topicStats().filter(t => t.weakScore > 0).sort((a, b) => b.weakScore - a.weakScore).slice(0, limit); },
  strongTopics(limit = 6) { return this.topicStats().filter(t => t.strongScore > 0).sort((a, b) => b.strongScore - a.strongScore).slice(0, limit); },
  subjectBreakdown() {
    return (Cache.subjects || []).map(s => {
      const notes = (Cache.notes || []).filter(n => n.subjectId === s.id);
      const questions = (Cache.questions || []).filter(q => q.subjectId === s.id);
      const mastered = notes.filter(n => n.status === 'mastered').length;
      const qCorrect = questions.filter(q => q.status === 'correct').length;
      const qAttempted = questions.filter(q => q.status !== 'not-attempted').length;
      return {
        subject: s, notesTotal: notes.length,
        notesMasteredPct: notes.length ? Math.round(mastered / notes.length * 100) : 0,
        questionsTotal: questions.length,
        questionsAccuracyPct: qAttempted ? Math.round(qCorrect / qAttempted * 100) : null
      };
    });
  }
};
const AnalyticsView = {
  render() {
    const streaks = Analytics.streaks();
    const last30 = Analytics.last30Days();
    const weak = Analytics.weakTopics();
    const strong = Analytics.strongTopics();
    const subjects = Analytics.subjectBreakdown();
    const totalHours = Math.round(((Cache.studySessions || []).reduce((a, b) => a + b.duration, 0) / 60) * 10) / 10;
    return `<h2>Analytics</h2>
    <p class="subtle">Built from your notes' status, question results, and revision history — not a separate thing you have to maintain.</p>
    <div class="grid cols-3" style="margin:18px 0;">
      <div class="card"><div class="subtle">Current streak</div><h2 style="margin:6px 0;font-family:var(--mono);">${streaks.current} day${streaks.current === 1 ? '' : 's'}</h2></div>
      <div class="card"><div class="subtle">Longest streak</div><h2 style="margin:6px 0;font-family:var(--mono);">${streaks.longest} day${streaks.longest === 1 ? '' : 's'}</h2></div>
      <div class="card"><div class="subtle">Total study time logged</div><h2 style="margin:6px 0;font-family:var(--mono);">${totalHours}h</h2></div>
    </div>
    <h3>Last 30 days</h3>
    <div style="display:flex;gap:3px;flex-wrap:wrap;margin-bottom:22px;" title="Each square is one day — filled means something was studied or revised that day">
      ${last30.map(d => `<div title="${d.date.toDateString()}${d.active ? ' — active' : ' — no activity'}" style="width:16px;height:16px;border-radius:3px;background:${d.active ? 'var(--accent)' : 'var(--accent-soft)'};"></div>`).join('')}
    </div>
    <div class="grid cols-2" style="margin-bottom:22px;">
      <div>
        <h3>Weak topics <span class="subtle" style="font-weight:normal;font-size:12px;">need more work</span></h3>
        ${weak.length ? weak.map(t => `<div class="card" style="margin-bottom:8px;cursor:pointer;" onclick="UI.nav('topic',{id:'${t.topic.id}'})" title="Open this topic">
          <div style="display:flex;justify-content:space-between;gap:8px;"><b>${esc(t.topic.name)}</b><span class="pill warn">${t.weakScore} signal${t.weakScore === 1 ? '' : 's'}</span></div>
          <div class="subtle">${subjectName(t.subjectId)} › ${esc(t.chapter?.name || '')}</div>
          <div class="subtle" style="margin-top:4px;">${[t.notesDifficult ? `${t.notesDifficult} difficult note${t.notesDifficult === 1 ? '' : 's'}` : '', t.qIncorrect ? `${t.qIncorrect} incorrect question${t.qIncorrect === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ')}</div>
        </div>`).join('') : `<div class="subtle">Nothing flagged as difficult or incorrect yet.</div>`}
      </div>
      <div>
        <h3>Strong topics <span class="subtle" style="font-weight:normal;font-size:12px;">solid ground</span></h3>
        ${strong.length ? strong.map(t => `<div class="card" style="margin-bottom:8px;cursor:pointer;" onclick="UI.nav('topic',{id:'${t.topic.id}'})" title="Open this topic">
          <div style="display:flex;justify-content:space-between;gap:8px;"><b>${esc(t.topic.name)}</b><span class="pill">${t.strongScore} signal${t.strongScore === 1 ? '' : 's'}</span></div>
          <div class="subtle">${subjectName(t.subjectId)} › ${esc(t.chapter?.name || '')}</div>
          <div class="subtle" style="margin-top:4px;">${[t.notesMastered ? `${t.notesMastered} mastered note${t.notesMastered === 1 ? '' : 's'}` : '', t.qCorrect ? `${t.qCorrect} correct question${t.qCorrect === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ')}</div>
        </div>`).join('') : `<div class="subtle">Nothing mastered yet — mark notes "mastered" as you get confident, or answer some questions.</div>`}
      </div>
    </div>
    <h3>Subject breakdown</h3>
    ${subjects.length ? subjects.map(s => `<div class="card" style="margin-bottom:8px;">
      <b>${esc(s.subject.name)}</b>
      <div class="note-meta-row" style="margin-top:6px;">
        <span class="pill">${s.notesTotal} note${s.notesTotal === 1 ? '' : 's'} · ${s.notesMasteredPct}% mastered</span>
        <span class="pill">${s.questionsTotal} question${s.questionsTotal === 1 ? '' : 's'}${s.questionsAccuracyPct !== null ? ` · ${s.questionsAccuracyPct}% correct` : ''}</span>
      </div>
    </div>`).join('') : `<div class="subtle">Add subjects to see a breakdown.</div>`}
    `;
  }
};

/* ============================== DASHBOARD ============================== */
function subjectProgress() {
  return (Cache.subjects || []).map(s => {
    const chapters = (Cache.chapters || []).filter(c => c.subjectId === s.id);
    const topics = chapters.flatMap(c => (Cache.topics || []).filter(t => t.chapterId === c.id));
    const notes = (Cache.notes || []).filter(n => n.subjectId === s.id);
    const mastered = notes.filter(n => n.status === 'mastered').length;
    const pct = notes.length ? Math.round((mastered / notes.length) * 100) : (topics.length ? 5 : 0);
    return { subject: s, pct, notesCount: notes.length, topicsCount: topics.length };
  });
}
function emptyState(icon, msg, btnLabel, btnAction) {
  return `<div class="empty-state"><div style="font-size:38px;">${icon}</div><h3>${esc(msg)}</h3>
    ${btnLabel ? `<button class="btn" onclick="${btnAction}" title="${esc(btnLabel)}">${esc(btnLabel)}</button>` : ''}</div>`;
}
const Dashboard = {
  render() {
    const notes = Cache.notes || [];
    const recentNotes = [...notes].sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt)).slice(0, 5);
    const due = Revision.dueItems();
    const todayMins = (Cache.studySessions || []).filter(s => new Date(s.date).toDateString() === new Date().toDateString()).reduce((a, b) => a + b.duration, 0);
    const hour = new Date().getHours();
    const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    const progress = subjectProgress();
    if (!Cache.courses.length) {
      return emptyState('📘', 'Create your first course to start building your CA study workspace.', 'Create Course', 'Courses.promptNew()');
    }
    const dateStr = new Date().toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const masteredCount = notes.filter(n => n.status === 'mastered').length;
    const masteryPct = notes.length ? Math.round((masteredCount / notes.length) * 100) : 0;
    const r = 52, circumference = 2 * Math.PI * r;
    const dashOffset = circumference * (1 - masteryPct / 100);
    const streak = (typeof Analytics !== 'undefined' ? Analytics.streaks() : { current: 0 }).current;
    return `
    <div class="focus-hero">
      <div>
        <p class="focus-date">${dateStr}</p>
        <h2 class="focus-greeting">${greeting}. Ready to sharpen your edge?</h2>
        <div class="focus-stats-row">
          <div title="Total minutes logged via the Study Timer today"><span class="focus-stat-value">${todayMins}</span><span class="focus-stat-label">min today</span></div>
          <div title="Consecutive days with study activity — see Analytics for details"><span class="focus-stat-value">${streak}🔥</span><span class="focus-stat-label">day streak</span></div>
          <div title="Notes and flashcards scheduled for review today"><span class="focus-stat-value ${due.length ? 'flag' : ''}">${due.length}</span><span class="focus-stat-label">due today</span></div>
        </div>
        ${due.length ? `<button class="btn sm" onclick="UI.nav('revision')" title="Go to the revision queue">Start Revision</button>` : `<button class="btn sm secondary" onclick="UI.nav('analytics')" title="See streaks, weak/strong topics and more">View Analytics</button>`}
      </div>
      <div class="focus-hero-ring" title="Share of your notes marked as mastered">
        <svg viewBox="0 0 120 120" width="108" height="108">
          <circle cx="60" cy="60" r="${r}" fill="none" stroke="var(--border)" stroke-width="10"/>
          <circle cx="60" cy="60" r="${r}" fill="none" stroke="url(#focusRingGrad)" stroke-width="10" stroke-linecap="round"
            stroke-dasharray="${circumference}" stroke-dashoffset="${dashOffset}" transform="rotate(-90 60 60)"/>
          <defs><linearGradient id="focusRingGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="var(--accent-2)"/><stop offset="100%" stop-color="var(--accent)"/>
          </linearGradient></defs>
        </svg>
        <div class="focus-ring-label"><b>${masteryPct}%</b><span>mastered</span></div>
      </div>
    </div>
    <h3>Continue studying</h3>
    ${recentNotes.length ? recentNotes.map(n => `<div class="list-row" onclick="UI.nav('note',{id:'${n.id}'})" title="Open this note">
      <span>📝</span><div style="flex:1;">${esc(n.title)}<div class="subtle">${subjectName(n.subjectId)} · updated ${fmtDateShort(n.updatedAt || n.createdAt)}</div></div>
    </div>`).join('') : `<div class="subtle">No notes yet — create your first one.</div>`}
    <h3 style="margin-top:22px;">Subject progress</h3>
    ${progress.length ? progress.map(p => `<div style="margin-bottom:10px;" title="Share of this subject's notes marked as mastered">
      <div style="display:flex;justify-content:space-between;font-size:13.5px;"><span>${esc(p.subject.name)}</span><span class="subtle" style="font-family:var(--mono);">${p.pct}%</span></div>
      <div class="progress-bar"><div style="width:${p.pct}%"></div></div>
    </div>`).join('') : `<div class="subtle">Add subjects to a course to see progress.</div>`}
    <h3 style="margin-top:22px;">Quick actions</h3>
    <div class="note-meta-row">
      <button class="btn secondary sm" onclick="Notes.promptNew()" title="Create a new note">+ New Note</button>
      <button class="btn secondary sm" onclick="UI.nav('pdfs')" title="Go to the PDF library to upload one">+ Import PDF</button>
      <button class="btn secondary sm" onclick="Mnemonics.promptNew()" title="Create a new memory aid">+ Add Mnemonic</button>
      <button class="btn secondary sm" onclick="Questions.promptNew()" title="Add a question to your question bank">+ Add Question</button>
    </div>`;
  }
};

/* ============================== TOPIC VIEW ============================== */
function TopicView(id) {
  const topic = (Cache.topics || []).find(t => t.id === id);
  if (!topic) return `<div class="empty-state"><h3>Topic not found</h3></div>`;
  const chapter = (Cache.chapters || []).find(c => c.id === topic.chapterId);
  const notes = (Cache.notes || []).filter(n => n.topicId === id).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const mnemonics = (Cache.mnemonics || []).filter(m => m.topicId === id);
  const questions = (Cache.questions || []).filter(q => q.topicId === id);
  const relatedJargons = (Cache.jargons || []).filter(j => chapter && j.subjectId === chapter.subjectId);
  const relatedPdfs = (Cache.pdfs || []).filter(p => chapter && p.subjectId === chapter.subjectId);
  return `
  <div class="subtle hub-crumb" style="margin-bottom:2px;">
    <span class="hub-crumb-item" onclick="SubjectsHub.view='overview';SubjectsHub.subjectId=null;UI.nav('subjects');" title="Back to Subjects">Subjects</span>
    <span class="hub-crumb-sep">›</span>
    <span class="hub-crumb-item" onclick="SubjectsHub.view='subject';SubjectsHub.subjectId='${chapter?.subjectId || ''}';UI.nav('subjects');" title="Back to ${esc(subjectName(chapter?.subjectId))}">${esc(subjectName(chapter?.subjectId))}</span>
    <span class="hub-crumb-sep">›</span>
    <span class="hub-crumb-item" onclick="SubjectsHub.view='chapter';SubjectsHub.chapterId='${chapter?.id || ''}';UI.nav('subjects');" title="Back to ${esc(chapter?.name || '')}">${esc(chapter?.name || '')}</span>
  </div>
  <div style="display:flex;justify-content:space-between;align-items:baseline;">
    <h2 style="margin-top:2px;">${esc(topic.name)}</h2>
    <button class="btn sm danger" onclick="Courses.deleteTopic('${id}')" title="Delete this topic and everything inside it">Delete topic</button>
  </div>
  <div class="note-meta-row" style="margin-bottom:16px;">
    <button class="btn sm" onclick="Notes.promptNew('${id}')" title="Create a note in this topic">+ Note</button>
    <button class="btn sm secondary" onclick="Mnemonics.promptNew('${id}')" title="Create a mnemonic linked to this topic">+ Mnemonic</button>
    <button class="btn sm secondary" onclick="Questions.promptNew('${id}')" title="Add a question linked to this topic">+ Question</button>
  </div>
  <h3>Notes <span class="subtle" style="font-weight:normal;font-size:12px;">(drag to reorder)</span></h3>
  ${notes.length ? notes.map(n => `<div class="list-row" draggable="true"
      ondragstart="Tree.dragStart(event,'note','${n.id}')" ondragover="Tree.allowDrop(event)"
      ondrop="Tree.onDrop(event,'note','notes','topicId','${id}','${n.id}')"
      onclick="UI.nav('note',{id:'${n.id}'})" title="Open this note"><span>📝</span><div style="flex:1;">${esc(n.title)}</div></div>`).join('') : `<div class="subtle">No notes yet.</div>`}
  <h3 style="margin-top:18px;">Mnemonics</h3>
  ${mnemonics.length ? mnemonics.map(m => `<div class="card" style="margin-bottom:8px;"><b>${esc(m.title)}</b> — <span class="pill">${esc(m.mnemonicText)}</span></div>`).join('') : `<div class="subtle">None yet.</div>`}
  <h3 style="margin-top:18px;">Questions</h3>
  ${questions.length ? questions.map(q => `<div class="subtle" style="margin-bottom:6px;">❓ ${esc(q.questionText)}</div>`).join('') : `<div class="subtle">None yet.</div>`}
  ${(relatedJargons.length || relatedPdfs.length) ? `<h3 style="margin-top:18px;">Related (same subject)</h3>
  ${relatedJargons.map(j => `<div class="subtle" style="cursor:pointer;" onclick="UI.nav('jargons')" title="Open Jargons">🔤 ${esc(j.term)}</div>`).join('')}
  ${relatedPdfs.map(p => `<div class="subtle" style="cursor:pointer;" onclick="UI.nav('pdf',{id:'${p.id}'})" title="Open this PDF">📄 ${esc(p.title)}</div>`).join('')}` : ''}
  `;
}

/* ============================== ROUTER ============================== */
const Router = {
  render() {
    const el = document.getElementById('content');
    let html = '';
    switch (UI.route) {
      case 'dashboard': html = Dashboard.render(); break;
      case 'analytics': html = AnalyticsView.render(); break;
      case 'subjects': html = SubjectsHub.render(); break;
      case 'search': html = SearchView.render(UI.params.q || ''); break;
      case 'topic': html = TopicView(UI.params.id); break;
      case 'note': html = Notes.render(UI.params.id); break;
      case 'pdfs': html = Pdfs.renderLibrary(); break;
      case 'pdf': el.className = 'content'; el.innerHTML = ''; Pdfs.renderViewer(UI.params.id).then(h => { el.innerHTML = h; }); return;
      case 'mnemonics': html = Mnemonics.render(); break;
      case 'jargons': html = Jargons.render(); break;
      case 'questions': html = Questions.render(); break;
      case 'revision': html = RevisionView.render(); break;
      case 'exam': html = ExamMode.render(); break;
      case 'lmr': html = LMR.render(); break;
      case 'bookmarks': html = Bookmarks.render(); break;
      case 'focus': html = Timer.render(); break;
      case 'trash': html = TrashView.render(); break;
      case 'settings': html = SettingsView.render(); break;
      default: html = Dashboard.render();
    }
    el.className = 'content' + (['note', 'subjects'].includes(UI.route) ? '' : ' narrow');
    el.innerHTML = html;
    updateRevBadge();
  }
};

/* ============================== SEED DEMO DATA ============================== */
async function seedIfEmpty() {
  if (Cache.courses.length) return;
  const courseId = uid();
  await saveItem('courses', { id: courseId, name: 'CA Intermediate', createdAt: nowISO() });
  const subj = { id: uid(), courseId, name: 'GST', color: '#6b5b3e', createdAt: nowISO() };
  await saveItem('subjects', subj);
  const chap = { id: uid(), subjectId: subj.id, name: 'Input Tax Credit', createdAt: nowISO() };
  await saveItem('chapters', chap);
  const topic = { id: uid(), chapterId: chap.id, name: 'Section 16 — Eligibility', createdAt: nowISO() };
  await saveItem('topics', topic);
  const note = {
    id: uid(), title: 'Conditions for claiming ITC', topicId: topic.id, chapterId: chap.id, subjectId: subj.id,
    content: `<h2>Conditions for ITC</h2><p>A registered person can claim <mark class="y">Input Tax Credit</mark> only if all of the following conditions are satisfied:</p>
    <p>1. Possession of a valid <mark class="g">tax invoice</mark></p><p>2. Goods or services have actually been received</p>
    <p>3. Tax on the supply has actually been paid to the government</p><p>4. Return has been filed</p>
    <blockquote>This is a fictional educational example, not reproduced ICAI material.</blockquote>`,
    tags: ['ITC', 'GST'], importance: 5, examFrequency: 'high', status: 'learning', createdAt: nowISO(),
    revision: Revision.schedule(0)
  };
  await saveItem('notes', note);
  const mnem = await saveItem('mnemonics', { id: uid(), title: 'ITC Conditions', mnemonicText: 'RITE', meaning: 'R = Registered person\nI = Invoice\nT = Tax paid\nE = Eligible use', topicId: topic.id, tags: [], favorite: true, createdAt: nowISO() });
  await saveItem('jargons', { id: uid(), term: 'Input Tax Credit', meaning: 'Credit for tax paid on inward supplies, available for set-off against output tax liability.', memoryTrick: 'Think: tax you paid IN, credited back.', subjectId: subj.id, importance: 'Important', tags: [], createdAt: nowISO() });
  const q = await saveItem('questions', { id: uid(), questionText: 'Explain the conditions for claiming Input Tax Credit under GST.', type: 'Theory', marks: 5, difficulty: 'Medium', modelAnswer: 'A registered person must hold a valid tax invoice, have received the goods/services, the supplier must have paid the tax, and the return must be filed. (Illustrative answer.)', topicId: topic.id, chapterId: chap.id, subjectId: subj.id, status: 'not-attempted', personalAnswer: '', createdAt: nowISO() });
  await Flashcards.generateForMnemonic(mnem);
  await Flashcards.generateForQuestion(q);
  await loadAllToCache();
}

/* ============================== FOCUS MODE (DARK ROOM) ============================== */
const Focus = {
  active: false,
  enter() {
    this.active = true;
    document.body.classList.add('focus-mode');
    if (!document.getElementById('focusExitBtn')) {
      const btn = document.createElement('button');
      btn.id = 'focusExitBtn'; btn.className = 'btn secondary focus-exit-btn';
      btn.textContent = '✕ Exit Focus (Esc)';
      btn.onclick = () => Focus.exit();
      document.body.appendChild(btn);
    }
  },
  exit() {
    this.active = false;
    document.body.classList.remove('focus-mode');
    document.getElementById('focusExitBtn')?.remove();
  }
};

/* ============================== KEYBOARD SHORTCUTS ============================== */
document.addEventListener('keydown', (e) => {
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); CmdK.open(); }
  else if (mod && e.key.toLowerCase() === 'n') { e.preventDefault(); Notes.promptNew(); }
  else if (e.key === 'Escape') { CmdK.close(); Modal.close(); if (Focus.active) Focus.exit(); }
});

/* ============================== BOOT ============================== */
async function boot() {
  await DB.open();
  await loadAllToCache();
  STORES.forEach(s => Cache[s] = Cache[s] || []);
  await seedIfEmpty();
  Theme.apply();
  Tree.render();
  UI.nav('dashboard');
  const syncMenuBtn = () => { document.getElementById('menuBtn').style.display = isMobileLayout() ? 'inline-flex' : 'none'; };
  syncMenuBtn();
  window.addEventListener('resize', syncMenuBtn);
  window.addEventListener('orientationchange', () => setTimeout(syncMenuBtn, 50));
  if ('serviceWorker' in navigator) {
    // When a newly-deployed version's service worker takes over (it skips
    // waiting and claims control automatically — see sw.js), reload once so
    // the already-open window actually picks up the new HTML/JS instead of
    // continuing to run the old code with a newer cache sitting unused.
    let swRefreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (swRefreshing) return;
      swRefreshing = true;
      window.location.reload();
    });
    navigator.serviceWorker.register('sw.js').then((reg) => {
      reg.update().catch(() => {}); // proactively check for a newer version right away
    }).catch(() => { /* fine if not hosted */ });
  }
  // Google's gsi/client script loads async — try now, and retry shortly if it
  // isn't ready yet (only matters if a Client ID has already been saved).
  DriveSync.init();
  if (!DriveSync.tokenClient && Settings.get('googleClientId')) {
    setTimeout(() => DriveSync.init(), 1500);
  }
}
boot();
