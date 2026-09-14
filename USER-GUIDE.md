# CA Study — User Guide

Everything below describes how to actually *use* the app day to day. (For architecture, tech stack and known limitations, see `README.md` instead — this file is the "how do I..." companion to that one.)

---

## 1. Opening the app & how saving works

Open `index.html` in a browser (double-click it, or host the folder on a static server — see README). No login, no account, no internet required after the first load.

**Everything autosaves.** There is no "Save" button anywhere in the app, because you don't need one:

- **Notes** save automatically ~600ms after you stop typing. Look at the bottom of the editor — it says "Saving…" then "Saved · [time]" once it's done.
- **Every other thing you create** (a mnemonic, a question, a highlight, a bookmark, a timer session) saves the instant you confirm it — there's no separate save step.
- All of this is written to **IndexedDB**, a real database built into your browser, not just memory. Close the tab, restart your computer, come back next week — it's all still there.
- The only thing that *doesn't* survive is if you clear your browser's site data for this page, or open it in a private/incognito window and then close it. For anything you can't afford to lose, use **Settings → Export backup** regularly (see §14).

---

## 2. Building your course structure — the Subjects hub

Everything else in the app (notes, questions, mnemonics) hangs off this structure:

```
Course  →  Subject  →  Chapter  →  Topic  →  (your notes, questions, mnemonics live here)
```

Example: `CA Intermediate → GST → Input Tax Credit → Section 16 — Eligibility`

**This is the heart of the app**, so it gets its own dedicated page — **sidebar → 📚 Subjects** (also reachable via the "Browse" button on mobile). It's a visual drill-down, not a nested list:

1. **Overview**: your courses, each showing its subjects as a card grid. Click **"+ Course"** (top right) to add a course; click **"+ Subject"** under a course to add one. Every subject gets an in-app modal to name it and — new — **pick a color** from an 8-swatch palette. That color follows the subject everywhere: its card border, its progress ring, its detail page.
2. Each subject card shows a live **progress ring** (% of its notes marked "mastered") plus quick counts (chapters, topics, notes). **Click a card** to open that subject.
3. **Subject page**: a bigger version of the same ring, full stats, and its list of chapters. **"+ Chapter"** adds one; **"🎨 Color"** lets you change the subject's color anytime.
4. **Click a chapter** to see its topics (note/mnemonic/question counts per topic). **"+ Topic"** adds one.
5. **Click a topic** to open it — that's where you'll add notes, mnemonics and questions for it (§9 below). Its breadcrumb at the top is clickable, so you can jump straight back to the subject or chapter without retracing your steps.

**Reordering**: click and drag any subject card, chapter row, topic row, or note (within its topic) to reorder it. It remembers the order permanently.

**Deleting**: a small **✕** sits on every card and row. Deleting a subject/chapter/topic asks you to confirm first, and tells you exactly how much is inside it. Anything with real content (notes, mnemonics, questions, jargons) is moved to **Trash**, not destroyed — you can restore it later. See §14.

---

## 3. Adding & writing a note

Three ways to start a new note:
- From a **topic page**: click **"+ Note"**.
- From anywhere: click the **＋** icon in the top bar (Quick Add) → "New Note".
- Press **Ctrl/Cmd+N** anywhere in the app.

You'll be asked for a title and which topic it belongs to, then dropped straight into the editor.

**The toolbar** (hover any button to see exactly what it does):
`B` `I` `U` `S` — bold, italic, underline, strikethrough
`x²` — superscript, for numbering points, footnote markers, or exponents (e.g. "point 1️⃣", "x²")
**5 colored dots + a custom color swatch + "Aa"** — select text, then click a color to change its font color; the custom swatch opens your system's color picker for anything else; "Aa" resets the selection back to the default text color
`↶ Undo` `↷ Redo` — in addition to the standard Ctrl/Cmd+Z keyboard shortcut, these are explicit buttons so undo/redo is always one click away, no keyboard required
`H2` `H3` `¶` — heading, sub-heading, plain paragraph
`• List` `1. List` `❝ Quote` `―` — bullet list, numbered list, quote block, horizontal divider
`▦ Table` `🔗 Link` — insert a table, turn selected text into a link
`🕶 Focus` — hide the sidebar, top bar, *and* the note's own inspector panel, so the writing area expands to fill the space (press **Esc** to exit)

The same color/superscript/undo/redo toolbar is also available in the PDF "Split with Notes" editor (§10) — it's a real rich-text editor too, not just a plain text box. It's **not** available on PDF sticky notes or text annotations, which are simple one-line text prompts by design.

**Note metadata**: just below the title, click the row of pills (Importance, Exam freq, status, tags) — it's clickable (look for the "✎ edit" tag) and opens a form to set:
- **Importance** (1–5 stars)
- **Exam frequency** (low / medium / high)
- **Status** — five stages, from first study to exam-ready:
  - **learning** — first time studying this (the default for a new note)
  - **familiar** — you've been through it once, but it needs revision to solidify
  - **moderate** — not too hard, just needs a little more attention and revision
  - **difficult** — needs real practice — more time to understand, more revision
  - **mastered** — understood well, practiced enough — just last-minute revision needed
- **Tags** (comma-separated)

These aren't cosmetic — Last-Minute Revision Mode (§9) and the Dashboard use them to decide what's worth showing you.

---

## 4. Highlighting and annotating a note

Select any text inside a note. A small floating toolbar appears above your selection:
- **Six colored dots** = highlight in that color (Important/yellow, Definition/green, Concept/blue, Exam Alert/red, Mnemonic/purple, Exception/orange — shown in the "Highlight legend" on the right)
- **💬 Note** = attach a comment/doubt/exam-tip to that exact selected text. It leaves a small 💬 flag right after the text; click the flag's entry under "Annotations" in the right panel to see or delete it.

Highlights and annotations are part of the note's content — they're included when you export the note, and they show up if you restore an old version (§6).

---

## 5. Mnemonics, Jargons, and Questions

These live in their own sections (sidebar) but can also be added directly from a topic page or the note inspector.

**Mnemonics** (sidebar → Mnemonics, or "+ Add mnemonic" from a note/topic): give it a title, the memory code (e.g. "RITE"), and what each letter means. Star (★) any mnemonic to favorite it — favorites show up in Last-Minute Revision Mode.

**Jargons** (sidebar → Jargons): term, meaning, an optional memory trick, and an importance level (Normal / Important / Must Memorize). "Must Memorize" jargons also surface in Last-Minute Revision Mode.

**Questions** (sidebar → Questions, or "+ Add question" from a topic): pick a **type** when creating one — the form changes depending on what you pick:
- **Theory / Practical / Case Study / Numerical** → free-text; you'll self-grade later by comparing to a model answer you write.
- **MCQ** → type up to 4 options and mark the correct one with the radio button.
- **True/False** → pick the correct answer from a dropdown.
- **Fill in the Blank** → type the exact expected answer (checked case-insensitively).

In the Questions list, MCQ/True-False/Fill-in-the-Blank are answered directly and **auto-graded** the moment you click "Check"/select an option. Free-text questions have a "Reveal answer" button plus manual "Mark correct/incorrect".

**Every Mnemonic and Question you create automatically gets a linked flashcard** — you don't do anything extra for this; it's how they get pulled into spaced-repetition revision (§8).

---

## 6. Note version history

The app quietly snapshots a note roughly every 3 minutes while you're actively editing it. To use this:
1. Open a note → in the right panel, under "Export & history", click **"🕘 Version history"**.
2. You'll see a list of past versions with a timestamp. **Preview** shows you that version's content without touching your current note. **Restore** replaces your current content with that version — but first it automatically snapshots what you currently have, so nothing is ever lost even if you restore by mistake.

---

## 7. Importing and exporting notes

**Import a file as a note**: click the **＋** Quick Add icon → "Import file as Note" → choose a `.txt`, `.md`, or `.html` file. You'll be asked for a title and topic, then it's converted into a normal editable note (Markdown headings/bold/lists/quotes are converted properly; plain text is wrapped into paragraphs).

**Export a single note**: open it → right panel → "Export & history" → **⬇ Markdown** or **⬇ HTML** downloads that note as a standalone file.

**Export everything**: see §14 (Settings → Backup).

---

## 8. Revision (spaced repetition)

The **Revision** section (sidebar, with a badge showing how many are due) is where notes and flashcards you've studied before come back to you on a schedule.

- **Notes**: rate yourself Again/Good/Easy from inside the note (right panel → "Revision"). This is the *only* way a note enters the revision queue — a brand-new note won't nag you until you've rated it once.
- **Flashcards** (from Questions and Mnemonics): these *do* show up immediately the first time, since there's no separate "note page" to rate them from first.
- Click **"▶ Start Revision Session"** on the Revision page to go through everything due, one card at a time, front-then-flip-to-answer, rating each Again/Hard/Good/Easy.
- The interval schedule (how many days until the next review) is configurable in **Settings** — defaults to 1, 3, 7, 14, 30 days, getting easier or harder based on how you rate each card.

---

## 9. Exam Mode & Last-Minute Revision Mode

**Exam Mode** (sidebar): pick a subject and/or difficulty, set minutes-per-mark (how much time per question), and start. Each question gets its own countdown timer. MCQ/True-False/Fill-in-the-Blank are answered with the real input and graded automatically the instant you submit; free-text questions show your answer next to the model answer and you self-grade. Ends with a summary of everything attempted.

**Last-Minute Revision Mode** (sidebar): pick a subject (or "All"), and it streams through *only* your highest-priority material, one item at a time — ★4–5 notes, exam-important notes, anything marked "difficult," must-memorize jargons, hard questions, and favorited mnemonics. Use **Next/Prev** to move through it. This is meant for the night before an exam, not day-to-day study.

---

## 10. The PDF Library

**Upload a PDF**: sidebar → PDF Library → **"+ Import PDF"**. You'll be asked for a title and — optionally — a **subject**. Tagging it with a subject is worth doing: it's what powers "related content" links from your notes, and lets you use the "Split with Notes" feature (below) with a sensible note picker.

**Reading**: click any PDF to open the viewer. Prev/Next page, zoom in/out (−/+), and the page counter are in the toolbar.

**Highlighting text on a PDF**: select text on the page exactly like you would in a note — a floating toolbar appears with the 6 highlight colors plus an underline option. These are stored as a separate layer keyed to the page, so **your original PDF file is never modified**, and the highlight re-scales correctly no matter what zoom level you're at. A **highlight legend** at the top of the right-hand panel always shows what each color means — the same legend used in notes.

**Sticky notes on a PDF**: click **"📌 Sticky note"** in the toolbar (it highlights to show it's armed), then click anywhere on the page — you'll be prompted for the note text, and a small icon appears at that spot. Click the icon any time to read, edit, or delete it.

**Drawing on a PDF**: click **"✏ Draw"** in the toolbar to open the drawing tools — **Pen** (freehand), **Arrow**, or **Rect** (rectangle), plus 5 color dots to pick from. Draw with your mouse or finger directly on the page. **🗑 Clear page** removes everything you've drawn on the current page (asks to confirm). Every drawing is listed in the "This page" panel too — click one there to delete it. Like highlights, drawings are stored separately from the PDF itself and re-scale correctly no matter what zoom level you're at. Click **Done** (or the Draw button again) to exit drawing mode and go back to normal text selection/highlighting.

**Undo / Redo for anything on the PDF**: the **↶ Undo** / **↷ Redo** buttons in the main PDF toolbar (not just the drawing tools) cover every kind of mark you can make on a page — highlights, underlines, sticky notes, and drawings. Undo steps back through your last actions one at a time (including deletions — deleting a highlight, then hitting Undo, brings it back); Redo re-applies whatever you just undid. Both are disabled (grayed out) when there's nothing to undo or redo.

**Exporting an annotated copy**: click **"⬇ Export PDF"** in the toolbar to download a copy of the PDF with every highlight, underline, and drawing permanently burned into the pages — a real PDF you can open in any reader, print, or share, with your original text still selectable (it's not a flattened screenshot). Your PDF in the library is never modified — this only produces a separate downloaded copy. If there's nothing marked on the PDF yet, it'll tell you there's nothing to export rather than downloading an unmarked copy.

**Page bookmarks**: click **"🔖 Bookmark page"** to save your current page for quick return. All of a PDF's highlights, sticky notes, and bookmarks for the *current page* are listed in the right-hand panel; click any entry to jump to it or manage it.

**"Split with Notes"**: click this toolbar button to dock a note editor right beside the PDF, so you can take notes while reading without losing your page or zoom level. Pick an existing note (filtered to the PDF's subject) or create a new one on the spot. Toggle it off to get the bookmarks/highlights panel back.

*Not yet supported*: freehand drawing/shapes on a PDF page. Highlighting, underlining, and sticky notes are real; drawing arbitrary ink is a separate feature that isn't built.

---

## 11. Bookmarks

Any note or PDF can be bookmarked (look for the "🔖 Bookmark" button on the note page, or bookmark a PDF page as above). All your bookmarks live under **sidebar → Bookmarks**, click any to jump straight there.

---

## 12. Search & the Command Palette

Press **Ctrl/Cmd+K** anywhere, or click the search bar in the top bar. This one box does two things:

- **Type a command** — "New Note", "Toggle Dark Mode", "Exam Mode", "Export Backup", or a dynamic **"Go to subject: [name]"** for each subject you've created — and press Enter/click it to run it immediately.
- **Type anything else** and it searches notes, PDFs, mnemonics, jargons, and questions live as you type.

For more control — filtering by content type or subject, sorting by newest/alphabetical — use **sidebar → Search & Filters** instead, which is a full page rather than a quick popup.

---

## 13. Analytics

Sidebar → Analytics. This doesn't need any separate setup — it's entirely built from things you're already doing:

- **Streaks**: current and longest consecutive-day streaks, based on any day you either logged a Study Timer session or rated a note/flashcard during revision. A **30-day heatmap** shows which of the last 30 days had activity (filled square) or didn't.
- **Weak topics**: topics ranked by how many notes you've marked "difficult" plus how many questions in that topic you got wrong — the more of both, the higher it ranks. Click any topic card to jump straight to it.
- **Strong topics**: the mirror image — ranked by mastered notes plus correctly-answered questions.
- **Subject breakdown**: for each subject, what % of its notes are "mastered" and what % of attempted questions you got correct.

Since this relies on your Note status (learning/familiar/moderate/difficult/mastered) and Question status (correct/incorrect), the more consistently you keep those updated as you actually study, the more useful this page gets.

---

## 14. Trash

Sidebar → Trash. Anything deleted (a note, mnemonic, jargon, question, or PDF, including everything swept up by a subject/chapter/topic cascade-delete) lands here first. **Restore** brings it back exactly as it was; **Delete forever** removes it permanently; **Empty Trash** clears everything at once. Nothing is ever silently destroyed without passing through here first (except the course/subject/chapter/topic structural records themselves, which are organizational, not content).

---

## 15. Settings — theme, revision intervals, backup

Sidebar → Settings:

- **Theme**: dark (the default) or light — also toggleable instantly from the 🌓 icon in the top bar.
- **Revision intervals**: the spaced-repetition day-gaps (default `1, 3, 7, 14, 30`) — edit as a comma-separated list.
- **Backup & Restore**:
  - **⬇ Export backup (.json)** downloads everything — notes, subjects, questions, mnemonics, jargons, revision data, settings, annotations, bookmarks. Do this regularly; it's your safety net.
  - **⬆ Restore from backup** merges a previously exported JSON file back in.
  - Note: PDFs themselves aren't included in the JSON (they're large binary files) — export a PDF individually if you need a copy of it outside the browser.
- **Readable Exports**: unlike the JSON backup (meant for restoring back into this app), these are plain Markdown files meant for reading, printing, or sharing:
  - **⬇ All notes (Markdown)** — every note in one file, organized by subject then chapter.
  - **⬇ All highlights & annotations (Markdown)** — every note highlight and comment, every PDF highlight/underline/sticky note, and a count of drawings per PDF, grouped by type in one file.
- **Google Drive Sync**: an alternative (or addition) to manual export/import — keeps your data automatically backed up to your own Google Drive. A Client ID is already built in, so just click **Connect Google Drive** and approve the one-time consent screen (that single click is unavoidable — Google requires it). After that, it stays connected automatically on every future visit and syncs near-real-time: any change pushes within seconds, with light throttling during rapid typing so it's not hammering the API on every keystroke. A small status pill in the top bar — visible on every page — always shows the current state ("Synced 2m ago," "Syncing…," "not connected," or a failure warning you can hover for details); click it to jump to Settings. Manual **Sync now** and **Restore from Drive** buttons are also there for immediate control or pulling your data onto a different device. It only ever touches a file it creates itself, inside a "CA Study" folder — never the rest of your Drive. Note: this needs the app to be hosted (http/https), not just opened as a local file — Google's sign-in won't work otherwise.

---

## 16. Study Timer & Focus Mode

**Study Timer** (sidebar): Pomodoro-style — 25/5, 50/10, or a custom duration. Start/Reset. Completed sessions are logged and feed into the Dashboard's "study time today" figure.

**Focus Mode**: from inside a note, click **"🕶 Focus"** in the editor toolbar. This hides the sidebar, top bar, and the note's own right-hand inspector panel — the writing area expands to use the freed-up space, rather than just floating in a narrower page. Press **Esc** or click the floating "✕ Exit Focus" button to come back.

---

## 17. Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl/Cmd + K` | Open search / command palette |
| `Ctrl/Cmd + N` | New note |
| `Esc` | Close any open modal or search popup, or exit Focus Mode |

(Formatting shortcuts like Ctrl/Cmd+B for bold work naturally inside the note editor via the browser's own text-editing behavior.)

---

## 18. Installing it as an app (PWA)

Opened as a plain file, it works, but a couple of things (installing to your home screen, full offline caching) need it to be **hosted**, not just opened locally. Upload the four files (`index.html`, `app.js`, `manifest.json`, `sw.js`) together to any static host — GitHub Pages, Netlify, Vercel — and once you visit it over HTTPS, your browser will offer "Install" or "Add to Home Screen".

---

## A typical day, end to end

1. Open the app → Dashboard shows today's entry (study time, notes in the ledger, revision due).
2. Click "Start Revision" if anything's due, or go straight to a topic.
3. Open a PDF of your study material, tag it with the right subject on upload.
4. Highlight key lines as you read; drop a sticky note on anything you want to come back to.
5. Toggle "Split with Notes" and write your own structured note alongside it — or switch to the note editor directly and type it up, highlighting important lines and attaching a mnemonic for anything memory-heavy.
6. Add a question or two based on what you just read (mark it MCQ if it's objective, Theory if it needs a written answer) — its flashcard is created automatically.
7. Before an exam: switch to Last-Minute Revision for that subject, or run a full Exam Mode session under a timer.
8. Periodically: Settings → Export backup.
