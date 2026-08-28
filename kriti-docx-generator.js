const fs = require("fs");
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  WidthType, AlignmentType, BorderStyle, VerticalAlign, UnderlineType, PageOrientation,
  TableLayoutType
} = require("docx");

/* ===================== Tala config (matches the app, Step 1) ===================== */
const TALAS = {
  adi: {
    label: "Adi", rowCells: [4,4,4,4,4,4,4,4],
    dividerType: "pipe", dividerAfter: 3, kalaiAware: true,
  },
  adi_tishra: {
    label: "Adi (Tishra Nadai)", rowCells: [6,6,6,6,6,6,6,6],
    dividerType: "pipe", dividerAfter: 3, kalaiAware: false,
  },
  rupakam: {
    label: "Rupakam", rowCells: [4,4,4,4,4,4],
    dividerType: "avartanam", dividerAfter: 2, kalaiAware: false,
  },
  khanda_chapu: {
    label: "Khanda Chapu", rowCells: [4,6,4,6],
    dividerType: "avartanam", dividerAfter: 1, kalaiAware: false,
  },
  misra_chapu: {
    label: "Misra Chapu", rowCells: [6,4,4,6,4,4],
    dividerType: "avartanam", dividerAfter: 2, kalaiAware: false,
  },
};
function numRowsForLine(cfg, kalai){ return (cfg.kalaiAware && kalai === 2) ? 2 : 1; }

const FONT = "Consolas";
const SZ = 22;      // 11pt -- title, metadata, sahitya, headings
const GRID_SZ = 20; // 10pt -- notation grid cells (widened to Legal-length landscape to fit)
const EDGE = "\u2551";      // ║  avartanam-cycle edge
const AVART_DIV = "\u2551"; // ║  avartanam boundary (Rupakam/Khanda/Misra)
const PIPE_DIV = "|";       // |  half-avartanam divider (Adi only)

/* ===================== Octave + underline-aware formatting ===================== */
function octaveDisplay(text){
  if(!text) return "";
  return text
    .replace(/([A-Za-z])'/g, (m,c)=> c + "\u0307")
    .replace(/([A-Za-z])\./g, (m,c)=> c + "\u0323");
}

/* Old flat spacing engine removed in Step 7 — swara text is now rendered via
   buildAlignedColumns so each syllable lines up under its own swara token. */

/* Tokenizes a cell's swara text into an ordered list of alignment "items",
   each carrying .display and .underline. Outside underline, unchanged: every
   letter/,/; is its own item (1 note = 1 syllable). Inside an underlined
   span (single or double), a space (already silently ignored in the printed
   swara text — 0 spacing inside underline, per the spacing rules) now
   doubles as an explicit sahitya "syllable group" boundary: no space
   anywhere in that span -> legacy, every note its own item; at least one
   space present -> grouping mode for that span, notes with no space between
   them merge into one item (one syllable spans the whole group). Matches
   the html exactly. */
/* Tokenizes a cell's swara text into an ordered list of alignment "items",
   each carrying .display and .underline. Outside underline, unchanged: every
   letter/,/; is its own item (1 note = 1 syllable). Inside an underlined
   span (single or double):
     - No space anywhere in that span -> legacy: every note its own item.
     - At least one space -> grouping mode: notes with no space between them
       merge into one item; a space marks where one group ends and the next
       begins.
   Each group item now also carries .gapBefore — the exact number of literal
   space characters that were typed right before it (only meaningful between
   two groups of the SAME underline span). This lets buildAlignedColumns tell
   "1 space, just marking the group boundary" (0 visible gap, as always)
   apart from "2+ spaces, an explicit visual gap request" (visible gap of
   count-1), per the confirmed rule: 1 space is purely structural, anything
   beyond that is a deliberate formatting choice that should show up in the
   Word file. */
function tokenizeSwaraForAlign(raw){
  if(!raw) return [];
  const markupRe = /\*\*(.+?)\*\*|\*(.+?)\*/g;
  const tokenRe = /[A-Za-z][\'\.]?|,|;/g;
  const items = [];
  // Whether grouping mode is active is decided ONCE for the whole cell, not
  // per span — see the html for the full rationale (a boundary space like
  // "P *GP*" falls outside both spans' own text, so a per-span check misses
  // it and *GP* would wrongly stay ungrouped).
  const cellHasAnyBreak = raw.includes(" ");

  function makeItem(toks, underline, gapBefore){
    return { display: toks.map(t=>t.display).join(""), underline, gapBefore: gapBefore || 0 };
  }
  // Shared grouping logic for BOTH plain (underline=0) and underlined
  // (underline=1/2) spans: if there's no space ANYWHERE in the cell, every
  // token stays its own item — this is what preserves old behavior for a
  // normally-typed compact cell (e.g. "SR" meaning 2 separate notes/
  // syllables, exactly as it always worked). Grouping activates once the
  // user deliberately types at least one space anywhere in the cell: tokens
  // with zero space between them then merge into one group, a space starts
  // a new group, and the exact typed count is kept (gapBefore) so the
  // spacing rules below can tell "just the grouping marker" (1 space) apart
  // from "a deliberate wider gap request" (2+ spaces).
  function pushSpan(text, underline){
    tokenRe.lastIndex = 0;
    const matches = [...text.matchAll(tokenRe)];
    if(!matches.length) return;
    const raw2 = matches.map((tm, idx) => {
      let gapLen = 0;
      if(idx > 0){
        const prevEnd = matches[idx-1].index + matches[idx-1][0].length;
        gapLen = (text.slice(prevEnd, tm.index).match(/ /g) || []).length;
      }
      return { display: octaveDisplay(tm[0]), gapLen };
    });
    if(cellHasAnyBreak){
      let cur = [];
      let curGapBefore = 0; // gap that led INTO the group currently being built
      raw2.forEach(t=>{
        if(t.gapLen > 0 && cur.length){
          items.push(makeItem(cur, underline, curGapBefore));
          cur = [];
          curGapBefore = t.gapLen;
        }
        cur.push(t);
      });
      if(cur.length) items.push(makeItem(cur, underline, curGapBefore));
    } else {
      raw2.forEach(t => items.push(makeItem([t], underline, 0)));
    }
  }
  let last = 0, m;
  while((m = markupRe.exec(raw)) !== null){
    if(m.index > last) pushSpan(raw.slice(last, m.index), 0);
    if(m[1] !== undefined) pushSpan(m[1], 2);
    else pushSpan(m[2], 1);
    last = markupRe.lastIndex;
  }
  if(last < raw.length) pushSpan(raw.slice(last), 0, true);
  return items;
}

/* Column-aligns swara tokens against space-separated sahitya syllables.
   Width is driven ONLY by the swara token + the confirmed spacing rule
   (2 trailing spaces after a plain letter, 1 after a plain , or ;, 0 inside
   an underlined speed-group) — NEVER by syllable length, so spacing stays
   capped exactly as defined and every table's widths stay uniform regardless
   of how long any particular line's sahitya happens to be. An unusually long
   syllable is still shown in full (never truncated) via padEnd's natural
   behavior of leaving a string unchanged once already >= the target width. */
/* Column-aligns swara tokens against space-separated sahitya syllables.
   For every boundary between token i and token i+1, ONE shared "gap" (a
   literal space count) is computed and applied identically to both the
   swara and sahitya lines, so they're always built on the same ruler:
     - no next token (last in the cell)              -> 0
     - both tokens inside a speed-group               -> 0, UNLESS the user
       typed 2+ literal spaces at that exact group boundary, in which case
       the gap is (typed count - 1) — 1 space is just the grouping marker,
       anything beyond that is a deliberate visible-gap request
     - crossing into/out of a speed-group             -> 1 (fixed, overrides
       everything else, same as before)
     - both plain, left is a swara letter              -> 2
     - both plain, left is ',' or ';'                  -> 1
   Neither line is ever truncated: a syllable longer than its token (or vice
   versa) simply occupies more character positions — nothing pads or clips
   it to a fixed column width. Gap size depends only on the swara tokens,
   never on syllable length. */
/* Sahitya wrapped in |...| (e.g. "|Krishna|") is a deliberate single,
   unbreakable syllable for the whole cell — the pipes are stripped from the
   rendered text (never printed) and the content is treated as ONE syllable
   even if it contains internal spaces. */
function buildAlignedColumns(rawSwara, rawLyric){
  const tokens = tokenizeSwaraForAlign(rawSwara);
  const trimmedLyric = (rawLyric||"").trim();
  const isPipeWrapped = trimmedLyric.length >= 2 && trimmedLyric.startsWith("|") && trimmedLyric.endsWith("|");
  let syllables;
  if(isPipeWrapped){
    const inner = trimmedLyric.slice(1, -1).replace(/\|/g, "").trim();
    syllables = inner ? [inner] : [];
  } else {
    syllables = trimmedLyric ? trimmedLyric.split(/\s+/) : [];
  }
  const n = Math.max(tokens.length, syllables.length);
  const swaraCols = [], lyricCols = [];
  for(let i=0;i<n;i++){
    const tok = tokens[i];
    const nextTok = tokens[i+1];
    const tokDisplay = tok ? tok.display : "";
    const syl = syllables[i] || "";
    const underline = tok ? tok.underline : 0;

    let gap;
    if(!tok || !nextTok){
      gap = 0;
    } else if(underline && nextTok.underline){
      const typed = nextTok.gapBefore || 0;
      gap = typed >= 2 ? typed - 1 : 0;
    } else if(!!underline !== !!nextTok.underline){
      gap = 1;
    } else {
      // Both plain (1st speed) — same "typed spaces beyond the baseline add
      // extra visible spaces on top" idea as underlined groups above, but
      // using plain's own baseline (2 between swara-letter groups, 1 around
      // a plain ','/';') instead of underline's baseline of 1. Since
      // grouping now applies to plain text too, nextTok.gapBefore is always
      // >=1 here — a plain boundary only exists because at least 1 space
      // was typed there (zero typed spaces means the tokens merged into one
      // group instead, per the tokenizer above, and never reach this branch).
      const isPunct = tokDisplay === "," || tokDisplay === ";";
      const baseline = isPunct ? 1 : 2;
      const typed = nextTok.gapBefore || 0;
      gap = Math.max(baseline, typed);
    }

    // Pad whichever of {swara-group text, sahitya syllable} is shorter up to
    // match the longer one's length, with purely invisible trailing space,
    // BEFORE the deliberate `gap` spacing is added. This guarantees the next
    // item starts at the same character column on both lines, regardless of
    // which side is longer — fixes "de" landing under "N" instead of "PN"
    // when the syllable (van/de) is longer than its swara group (PG/PN).
    // Never adds a visible gap you didn't type; only ever fills in the
    // length difference that already exists between the two.
    const core = Math.max(tokDisplay.length, syl.length, 1);
    const swaraCore = tok ? tokDisplay.padEnd(core) : tokDisplay;
    const lyricCore = syl.padEnd(core);

    swaraCols.push({ text: swaraCore + " ".repeat(gap), underline });
    lyricCols.push(lyricCore + " ".repeat(gap));
  }
  return { swaraCols, lyricCols };
}

function underlineProp(level){
  if(level === 1) return { type: UnderlineType.SINGLE };
  if(level === 2) return { type: UnderlineType.DOUBLE };
  return undefined;
}

function run(text, opts = {}){
  return new TextRun({
    text, font: FONT, size: opts.size || SZ, bold: !!opts.bold,
    underline: opts.underline ? {} : (opts.underlineLevel ? underlineProp(opts.underlineLevel) : undefined),
    color: "000000",
    characterSpacing: opts.spacing || undefined,
  });
}

/* ===== Point 3: per-cell character spacing, so sparse cells don't look
   congested next to their fixed-width box =====
   Every beat-cell has a FIXED width (cap * CELL_UNIT) regardless of how many
   characters its content actually uses — a tight/underlined cell (e.g. "SNPG",
   0 internal gaps) uses far fewer characters than a plain cell of the same
   capacity, so it looks empty next to one that's naturally packed. Word's
   "Expanded" character spacing (Font > Advanced > Spacing) adds space AFTER
   every glyph without inserting real space characters — it's a pure render
   property, so it can't affect the tokenizer, the spacing rules, or alignment.
   We compute, per cell, just enough expansion to stretch that cell's own
   content out to fill its box, so every cell looks evenly filled rather than
   some cramped and some sparse. Swara and lyric runs in the same cell always
   get the SAME value — their character counts are guaranteed equal after the
   point-2 fix, so stretching both by the same amount keeps them lined up. */
const CONSOLAS_CHAR_WIDTH_TWIPS = 120; // ~0.6em advance width for Consolas at 10pt (10pt * 0.6 * 20 twips/pt) — approximate, tune if the rendered result looks off
const MAX_CHAR_SPACING_TWIPS = 60; // caps the stretch so a near-empty cell (e.g. one sustained note alone in a wide cell) doesn't get an absurdly wide gap
function computeCellSpacing(contentLen, targetWidthTwips){
  if(contentLen <= 0) return 0;
  const naturalWidth = contentLen * CONSOLAS_CHAR_WIDTH_TWIPS;
  const extra = (targetWidthTwips - naturalWidth) / contentLen;
  return Math.max(0, Math.min(MAX_CHAR_SPACING_TWIPS, Math.round(extra)));
}

function plainPara(text, opts = {}){
  return new Paragraph({
    alignment: opts.center ? AlignmentType.CENTER : undefined,
    spacing: { after: opts.after !== undefined ? opts.after : 0 },
    // Always carry a real run, even when text is "" — an empty Paragraph with
    // no children falls back to Word's default line-height instead of the
    // sheet's font/size, so blank spacer rows can render visibly thinner than
    // a real row. An empty-string TextRun still takes up a full line at the
    // given size without printing anything.
    children: [run(text, opts)],
  });
}
/* Half-height blank spacer, used to build a "1.5 row" gap: a full plainPara("")
   row plus one of these gives ~1.5 rows without guessing exact twip values. */
function halfRowSpacer(size){
  return new Paragraph({
    spacing: { after: 0 },
    children: [run("", { size: Math.round((size || SZ) / 2) })],
  });
}
function metaLine(label, value){
  return new Paragraph({
    spacing: { after: 0 },
    children: [run(label + ":", { bold: true }), run(" " + (value || ""))],
  });
}
function sectionHeading(name, withColon){
  return new Paragraph({
    spacing: { after: 0 },
    children: [run(name + (withColon ? ":" : ""), { bold: true, underline: true })],
  });
}

const NOBORDER = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const CELL_BORDERS = { top: NOBORDER, bottom: NOBORDER, left: NOBORDER, right: NOBORDER };
function cell(children, widthDxa){
  return new TableCell({
    width: { size: widthDxa, type: WidthType.DXA },
    verticalAlign: VerticalAlign.CENTER,
    borders: CELL_BORDERS,
    children,
  });
}
function beatPara(children){
  return new Paragraph({ alignment: AlignmentType.LEFT, spacing: { after: 0 }, children });
}

/* ===================== Layout widths ===================== */
const LABEL_W = 567;
const DIV_W = 389;
const CELL_UNIT = 470; // fixed dxa per akshara of cell capacity — content-independent,
                        // so every table for a given tala is the same width throughout.
                        // Scaled up from the original 9pt-tuned values (510/350/423) by
                        // 20/18 to match the grid's move to 10pt; page widened to
                        // Legal-length landscape (14in) to give this room to fit.

function buildLineTable(cfg, line, kalai){
  const numRows = numRowsForLine(cfg, kalai);
  const rowsOut = [];

  for(let ri = 0; ri < numRows; ri++){
    const r = line.rows[ri] || { swara: [], lyric: [] };
    const swaraCells = [];
    const lyricCells = [];
    const cellWidths = [];

    const edgeLeft = ri === 0;
    const edgeRight = ri === numRows - 1;

    swaraCells.push(cell([beatPara(ri===0 && line.label ? [run(line.label, {bold:true, size:GRID_SZ})] : [])], LABEL_W));
    lyricCells.push(cell([beatPara([])], LABEL_W));

    cfg.rowCells.forEach((cap, i)=>{
      const { swaraCols, lyricCols } = buildAlignedColumns(r.swara[i] || "", r.lyric[i] || "");
      const isEdgeL = edgeLeft && i === 0;
      const isEdgeR = edgeRight && i === cfg.rowCells.length - 1;
      const width = cap * CELL_UNIT;
      // Both are equal by construction (point-2 fix pads them to matching
      // lengths), so one spacing value keeps swara and lyric lined up.
      const contentLen = swaraCols.reduce((a,c)=>a + c.text.length, 0);
      const spacing = computeCellSpacing(contentLen, width);

      const children = [];
      // Each token's text already carries its full, correctly-computed
      // trailing gap (baked in by buildAlignedColumns) — direct
      // concatenation, no extra boundary space added here.
      swaraCols.forEach(c=>{
        children.push(run(c.text, { underlineLevel: c.underline, size: GRID_SZ, spacing }));
      });
      if(isEdgeL) children.unshift(run(EDGE + " ", { size: GRID_SZ }));
      if(isEdgeR) children.push(run(EDGE, { size: GRID_SZ }));

      swaraCells.push(cell([beatPara(children)], width));
      // Direct concatenation (not join(" ")) — each lyric column now carries
      // the exact same gap as its corresponding swara column, so an extra
      // separator space here would break that mirroring again.
      let lyricText = lyricCols.join("");
      if(isEdgeL) lyricText = "  " + lyricText;
      if(isEdgeR) lyricText = lyricText + "  ";
      lyricCells.push(cell([beatPara(lyricText.trim() ? [run(lyricText, {size:GRID_SZ, spacing})] : [])], width));
      cellWidths.push(width);

      if(i === cfg.dividerAfter && i !== cfg.rowCells.length - 1){
        const glyph = cfg.dividerType === "pipe" ? PIPE_DIV : AVART_DIV;
        swaraCells.push(cell([beatPara([run(glyph, {size:GRID_SZ})])], DIV_W));
        lyricCells.push(cell([beatPara([])], DIV_W));
        cellWidths.push(DIV_W);
      }
    });

    const colWidths = [LABEL_W, ...cellWidths];

    rowsOut.push(new Table({
      width: { size: colWidths.reduce((a,b)=>a+b,0), type: WidthType.DXA },
      columnWidths: colWidths,
      layout: TableLayoutType.FIXED,
      borders: { top: NOBORDER, bottom: NOBORDER, left: NOBORDER, right: NOBORDER,
                 insideHorizontal: NOBORDER, insideVertical: NOBORDER },
      rows: [ new TableRow({ children: swaraCells }), new TableRow({ children: lyricCells }) ],
    }));

    // Small gap between the two half-avartanam tables of a 2-kalai line — kept
    // noticeably tighter than the full blank row used between different lines,
    // so the two halves still read as one continuous line rather than two
    // separate ones, while no longer sitting flush against each other.
    if(ri < numRows - 1){
      rowsOut.push(halfRowSpacer());
    }
  }
  return rowsOut;
}

/* ===================== Build document ===================== */
function buildDocBody(song){
  const cfg = TALAS[song.tala] || TALAS.adi;
  const kalai = song.kalai || 1;
  const talaLabel = cfg.kalaiAware ? `${cfg.label}${kalai===2?' (2 kalai)':''}` : cfg.label;
  const body = [];

  body.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [run(song.title, {bold:true, underline:true})] }));
  body.push(plainPara(""));
  body.push(halfRowSpacer());
  const ragaText = (song.melakarta && String(song.melakarta).trim())
    ? `${song.raga || ''} (${String(song.melakarta).trim()} Melakarta Janya)`
    : (song.raga || '');
  // Metadata spacing: Raga -> blank -> Arohana/Avarohana (tight) -> blank -> Tala/Composer (tight)
  body.push(metaLine("Raga", ragaText));
  body.push(plainPara(""));
  body.push(metaLine("Arohana", song.arohanam));
  body.push(metaLine("Avarohana", song.avarohanam));
  body.push(plainPara(""));
  body.push(metaLine("Tala", talaLabel));
  body.push(metaLine("Composer", song.composer));
  body.push(plainPara(""));

  // plain lyrics block (heading, no colon)
  song.sections.forEach(sec=>{
    body.push(sectionHeading(sec.name, false));
    (sec.sahitya||"").split("\n").forEach(ln=>body.push(plainPara(ln)));
    body.push(plainPara(""));
  });

  // Pallavi reference note = first 2 words of the Pallavi's opening sahitya line
  const derivedOpening = (()=>{
    const first = song.sections[0];
    if(!first) return "";
    const l = (first.sahitya||"").split("\n").map(s=>s.trim()).find(s=>s.length>0);
    if(!l) return "";
    return l.split(/\s+/).slice(0,2).join(" ");
  })();

  // notation block (heading, with colon, one blank row before the first line)
  song.sections.forEach((sec, si)=>{
    body.push(sectionHeading(sec.name, true));
    body.push(plainPara(""));
    sec.lines.forEach(line=>{
      buildLineTable(cfg, line, kalai).forEach(t=>body.push(t));
      body.push(plainPara(""));
    });
    if(si !== 0 && sec.showPallaviRef){
      const text = sec.pallaviOverride && sec.pallaviOverride.trim() ? sec.pallaviOverride.trim() : derivedOpening;
      if(text){
        body.push(plainPara(`(${text})`, { bold: true }));
        body.push(plainPara(""));
      }
    }
  });

  body.push(plainPara(""));
  body.push(plainPara(""));
  body.push(plainPara("**********", { center: true }));

  return body;
}

// Legal-length landscape (14in x 8.5in) is wide enough for every tala's
// worst-case row EXCEPT Adi (Tishra Nadai) — its 48 aksharas/row (vs Adi's
// 32) need ~17.5in of usable width at the current 10pt grid font, so that
// one tala alone gets a further-widened page. Every other tala's page size
// is completely unchanged.
const PAGE_HEIGHT = 12240;               // 8.5in, same for every tala
const PAGE_WIDTH_STANDARD = 20160;       // 14in — Adi and all other existing talas
const PAGE_WIDTH_WIDE = 25920;           // 18in — Adi (Tishra Nadai) only

function buildDocument(song){
  const pageWidth = song.tala === "adi_tishra" ? PAGE_WIDTH_WIDE : PAGE_WIDTH_STANDARD;
  return new Document({
    sections: [{
      properties: {
        page: {
          size: { width: pageWidth, height: PAGE_HEIGHT },
          margin: { top: 1008, bottom: 720, left: 1008, right: 720 },
        },
      },
      children: buildDocBody(song),
    }],
  });
}

/* ===================== CLI ===================== */
const songPath = process.argv[2] || "song.json";
const outPath = process.argv[3] || "output.docx";
const song = JSON.parse(fs.readFileSync(songPath, "utf-8"));
const doc = buildDocument(song);

Packer.toBuffer(doc).then((buf)=>{
  fs.writeFileSync(outPath, buf);
  console.log("wrote", outPath);
});
