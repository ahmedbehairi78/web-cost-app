/**
 * Selection-scoped formatting for the print-preview iframe.
 * Applies styles only to the current text selection (or its nearest cell),
 * not the whole ReportPrintProfile.
 */

export type SelectionFontFamily = 'calibri' | 'segoe' | 'tahoma' | 'arial';
export type SelectionAlign = 'start' | 'center' | 'end';
export type SelectionTableBorder = 'none' | 'light' | 'solid' | 'strong';
export type SelectionUnderline = 'none' | 'single' | 'double';

const FONT_NAME: Record<SelectionFontFamily, string> = {
  calibri: 'Calibri',
  segoe: 'Segoe UI',
  tahoma: 'Tahoma',
  arial: 'Arial',
};

const BORDER_CSS: Record<SelectionTableBorder, string> = {
  none: 'none',
  light: '1px solid #e2e8f0',
  solid: '1px solid #94a3b8',
  strong: '1.5px solid #0f172a',
};

export type SelectionFormatState = {
  fontFamily: SelectionFontFamily | null;
  fontSizePt: number | null;
  color: string | null;
  bold: boolean;
  italic: boolean;
  underline: SelectionUnderline;
  align: SelectionAlign | null;
  shade: string | null;
  /** Cell border when selection is inside td/th; null if not in a cell. */
  cellBorder: SelectionTableBorder | null;
};

/** Snapshot copied by the format painter (فرشاة نسخ التنسيق). */
export type FormatPainterClipboard = SelectionFormatState;


const MAX_UNDO = 40;

/** Per-document undo stacks (WeakMap so GC cleans up with the iframe doc). */
const undoStacks = new WeakMap<Document, string[]>();

function getStack(doc: Document): string[] {
  let stack = undoStacks.get(doc);
  if (!stack) {
    stack = [];
    undoStacks.set(doc, stack);
  }
  return stack;
}

export function clearSelectionUndo(doc: Document): void {
  undoStacks.delete(doc);
}

export function pushSelectionUndo(doc: Document): void {
  const stack = getStack(doc);
  stack.push(doc.body.innerHTML);
  if (stack.length > MAX_UNDO) stack.shift();
}

export function canSelectionUndo(doc: Document): boolean {
  return (undoStacks.get(doc)?.length ?? 0) > 0;
}

export function undoSelectionFormat(doc: Document): boolean {
  const stack = undoStacks.get(doc);
  if (!stack?.length) return false;
  const html = stack.pop();
  if (html == null) return false;
  doc.body.innerHTML = html;
  return true;
}

function getSel(doc: Document): Selection | null {
  return doc.getSelection?.() ?? doc.defaultView?.getSelection() ?? null;
}

export function hasNonEmptySelection(doc: Document): boolean {
  const sel = getSel(doc);
  if (!sel || sel.isCollapsed || !sel.rangeCount) return false;
  return sel.toString().replace(/\s+/g, ' ').trim().length > 0;
}

function closestCell(node: Node | null): HTMLElement | null {
  let cur: Node | null = node;
  while (cur && cur.nodeType === Node.TEXT_NODE) cur = cur.parentNode;
  if (!(cur instanceof Element)) return null;
  return cur.closest('td, th') as HTMLElement | null;
}

function applyInlineStyles(el: HTMLElement, styles: Record<string, string>): void {
  for (const [k, v] of Object.entries(styles)) {
    if (!v) continue;
    (el.style as unknown as Record<string, string>)[k] = v;
  }
}

function fragmentHasTableParts(node: Node): boolean {
  if (node.nodeType === Node.ELEMENT_NODE) {
    const el = node as Element;
    const tag = el.tagName;
    if (tag === 'TABLE' || tag === 'TBODY' || tag === 'THEAD' || tag === 'TFOOT' || tag === 'TR' || tag === 'TD' || tag === 'TH') {
      return true;
    }
    if (el.querySelector('table, tbody, thead, tfoot, tr, td, th')) return true;
  }
  for (const child of Array.from(node.childNodes)) {
    if (fragmentHasTableParts(child)) return true;
  }
  return false;
}

/** Unique table cells intersecting the current selection. */
function cellsInSelection(doc: Document): HTMLElement[] {
  const sel = getSel(doc);
  if (!sel?.rangeCount) return [];
  const range = sel.getRangeAt(0);
  const start = closestCell(range.startContainer);
  const end = closestCell(range.endContainer);
  if (start && start === end) return [start];

  const seen = new Set<HTMLElement>();
  const cells: HTMLElement[] = [];
  const add = (c: HTMLElement | null) => {
    if (c && !seen.has(c)) {
      seen.add(c);
      cells.push(c);
    }
  };

  const ancestor = range.commonAncestorContainer;
  const root =
    ancestor.nodeType === Node.ELEMENT_NODE
      ? (ancestor as Element)
      : ancestor.parentElement;
  if (!root) {
    add(start);
    add(end);
    return cells;
  }
  const table =
    (root.closest?.('table') as HTMLElement | null)
    ?? (root.tagName === 'TABLE' ? (root as HTMLElement) : null);
  const search = table || root;
  try {
    search.querySelectorAll('td, th').forEach((node) => {
      if (range.intersectsNode(node)) add(node as HTMLElement);
    });
  } catch {
    add(start);
    add(end);
  }
  if (cells.length === 0) {
    add(start);
    add(end);
  }
  return cells;
}

function applyStylesToTableCells(cells: HTMLElement[], styles: Record<string, string>): void {
  for (const cell of cells) {
    applyInlineStyles(cell, styles);
    cell.querySelectorAll('.num-val').forEach((el) => applyInlineStyles(el as HTMLElement, styles));
    const table = cell.closest('table');
    if (table && styles.fontSize) {
      // Fixed equal columns cannot grow with a larger cell font — numbers overflow.
      table.style.tableLayout = 'auto';
    }
  }
}

function enableEdit(doc: Document): void {
  try {
    if (doc.designMode !== 'on') doc.designMode = 'on';
  } catch {
    /* ignore */
  }
}

/** Block typing in the preview while allowing Ctrl/Cmd+Z undo. */
export function installPreviewEditGuards(doc: Document): () => void {
  enableEdit(doc);
  const onKey = (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      undoSelectionFormat(doc);
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (
      e.key.length === 1 ||
      e.key === 'Backspace' ||
      e.key === 'Delete' ||
      e.key === 'Enter' ||
      e.key === 'Tab'
    ) {
      e.preventDefault();
    }
  };
  doc.addEventListener('keydown', onKey, true);
  return () => doc.removeEventListener('keydown', onKey, true);
}

function wrapSelection(doc: Document, styles: Partial<CSSStyleDeclaration> & Record<string, string>): boolean {
  const sel = getSel(doc);
  if (!sel || sel.isCollapsed || !sel.rangeCount) return false;
  const range = sel.getRangeAt(0);
  if (range.collapsed) return false;

  const styleMap = styles as Record<string, string>;
  const cells = cellsInSelection(doc);
  // Wrapping a span across cells extracts <td>/<tr> and collapses the table.
  if (cells.length > 1) {
    applyStylesToTableCells(cells, styleMap);
    return true;
  }

  const span = doc.createElement('span');
  span.setAttribute('data-sel-fmt', '1');
  for (const [k, v] of Object.entries(styleMap)) {
    if (v) (span.style as unknown as Record<string, string>)[k] = v;
  }

  try {
    range.surroundContents(span);
  } catch {
    if (cells.length === 1) {
      applyStylesToTableCells(cells, styleMap);
      return true;
    }
    const frag = range.extractContents();
    if (fragmentHasTableParts(frag)) {
      range.insertNode(frag);
      if (cells.length) applyStylesToTableCells(cells, styleMap);
      return cells.length > 0;
    }
    span.appendChild(frag);
    range.insertNode(span);
  }
  sel.removeAllRanges();
  const next = doc.createRange();
  next.selectNodeContents(span);
  sel.addRange(next);
  return true;
}

function runCommand(doc: Document, command: string, value?: string): boolean {
  enableEdit(doc);
  try {
    return doc.execCommand(command, false, value);
  } catch {
    return false;
  }
}

export function applySelectionFontFamily(doc: Document, family: SelectionFontFamily): boolean {
  if (!hasNonEmptySelection(doc)) return false;
  pushSelectionUndo(doc);
  const cells = cellsInSelection(doc);
  if (cells.length > 0) {
    applyStylesToTableCells(cells, { fontFamily: FONT_NAME[family] });
    return true;
  }
  const ok = runCommand(doc, 'fontName', FONT_NAME[family]);
  if (!ok) wrapSelection(doc, { fontFamily: FONT_NAME[family] });
  return true;
}

export function applySelectionFontSize(doc: Document, pt: number): boolean {
  if (!hasNonEmptySelection(doc) || pt <= 0) return false;
  pushSelectionUndo(doc);
  const cells = cellsInSelection(doc);
  if (cells.length > 0) {
    applyStylesToTableCells(cells, { fontSize: `${pt}pt` });
    return true;
  }
  wrapSelection(doc, { fontSize: `${pt}pt` });
  return true;
}

export function applySelectionColor(doc: Document, hex: string): boolean {
  if (!hasNonEmptySelection(doc) || !/^#[0-9a-fA-F]{6}$/.test(hex)) return false;
  pushSelectionUndo(doc);
  const ok = runCommand(doc, 'foreColor', hex);
  if (!ok) wrapSelection(doc, { color: hex });
  return true;
}

export function toggleSelectionBold(doc: Document): boolean {
  if (!hasNonEmptySelection(doc)) return false;
  pushSelectionUndo(doc);
  if (runCommand(doc, 'bold')) return true;
  wrapSelection(doc, { fontWeight: '700' });
  return true;
}

export function toggleSelectionItalic(doc: Document): boolean {
  if (!hasNonEmptySelection(doc)) return false;
  pushSelectionUndo(doc);
  if (runCommand(doc, 'italic')) return true;
  wrapSelection(doc, { fontStyle: 'italic' });
  return true;
}

export function applySelectionUnderline(doc: Document, mode: SelectionUnderline): boolean {
  if (!hasNonEmptySelection(doc)) return false;
  pushSelectionUndo(doc);
  if (mode === 'none') {
    wrapSelection(doc, { textDecoration: 'none' });
    return true;
  }
  if (mode === 'single') {
    const ok = runCommand(doc, 'underline');
    if (!ok) wrapSelection(doc, { textDecoration: 'underline' });
    return true;
  }
  wrapSelection(doc, {
    textDecoration: 'underline',
    textDecorationStyle: 'double',
  });
  return true;
}

export function applySelectionAlign(doc: Document, align: SelectionAlign, dir: 'rtl' | 'ltr'): boolean {
  if (!hasNonEmptySelection(doc)) return false;
  pushSelectionUndo(doc);
  const sel = getSel(doc);
  const node = sel?.anchorNode ?? null;
  const cell = closestCell(node);
  const physical =
    align === 'center' ? 'center' : align === 'start' ? (dir === 'rtl' ? 'right' : 'left') : dir === 'rtl' ? 'left' : 'right';

  if (cell) {
    cell.style.textAlign = physical;
    cell.querySelectorAll('.num-val').forEach((el) => {
      (el as HTMLElement).style.textAlign = physical;
    });
  }

  const cmd =
    physical === 'center' ? 'justifyCenter' : physical === 'left' ? 'justifyLeft' : 'justifyRight';
  runCommand(doc, cmd);
  return true;
}

export function applySelectionShade(doc: Document, hexOrEmpty: string): boolean {
  if (!hasNonEmptySelection(doc)) return false;
  pushSelectionUndo(doc);
  const sel = getSel(doc);
  const cell = closestCell(sel?.anchorNode ?? null);

  // Inside a table cell: shade the whole cell (not just the selected characters).
  if (cell) {
    if (hexOrEmpty === '') {
      cell.style.background = '';
      cell.style.backgroundColor = '';
      return true;
    }
    if (!/^#[0-9a-fA-F]{6}$/.test(hexOrEmpty)) return false;
    cell.style.background = hexOrEmpty;
    cell.style.backgroundColor = hexOrEmpty;
    return true;
  }

  // Outside cells (header/footer/title text): highlight the selection only.
  if (hexOrEmpty === '') {
    wrapSelection(doc, { backgroundColor: 'transparent' });
    return true;
  }
  if (!/^#[0-9a-fA-F]{6}$/.test(hexOrEmpty)) return false;
  const ok = runCommand(doc, 'hiliteColor', hexOrEmpty) || runCommand(doc, 'backColor', hexOrEmpty);
  if (!ok) wrapSelection(doc, { backgroundColor: hexOrEmpty });
  return true;
}

export function applySelectionBorder(doc: Document, border: SelectionTableBorder): boolean {
  if (!hasNonEmptySelection(doc)) return false;
  const sel = getSel(doc);
  const cell = closestCell(sel?.anchorNode ?? null);
  if (!cell) return false;
  pushSelectionUndo(doc);
  cell.style.border = BORDER_CSS[border];
  return true;
}

function inferBorderFromCss(border: string): SelectionTableBorder | null {
  const b = border.trim().toLowerCase();
  if (!b || b === 'none' || b.startsWith('0')) return 'none';
  if (b.includes('1.5') || b.includes('2px') || b.includes('3px')) return 'strong';
  if (b.includes('#0f172a') || b.includes('rgb(15, 23, 42)')) return 'strong';
  if (b.includes('#e2e8f0') || b.includes('rgb(226, 232, 240)')) return 'light';
  if (b.includes('solid')) return 'solid';
  return 'light';
}

/** Best-effort read of formatting around the caret/selection for toolbar UI. */
export function readSelectionFormatState(doc: Document): SelectionFormatState {
  const sel = getSel(doc);
  const node = sel?.anchorNode;
  let el: Element | null =
    node?.nodeType === Node.ELEMENT_NODE
      ? (node as Element)
      : node?.parentElement ?? null;

  const state: SelectionFormatState = {
    fontFamily: null,
    fontSizePt: null,
    color: null,
    bold: false,
    italic: false,
    underline: 'none',
    align: null,
    shade: null,
    cellBorder: null,
  };
  if (!el) return state;

  const win = doc.defaultView;
  const cs = win?.getComputedStyle(el);
  if (!cs) return state;

  const ff = cs.fontFamily.toLowerCase();
  if (ff.includes('calibri')) state.fontFamily = 'calibri';
  else if (ff.includes('segoe')) state.fontFamily = 'segoe';
  else if (ff.includes('tahoma')) state.fontFamily = 'tahoma';
  else if (ff.includes('arial')) state.fontFamily = 'arial';

  const size = parseFloat(cs.fontSize);
  if (Number.isFinite(size)) state.fontSizePt = Math.round((size * 72) / 96) || Math.round(size);

  state.color = rgbToHex(cs.color) || null;
  state.bold = (parseInt(cs.fontWeight, 10) || 0) >= 600 || cs.fontWeight === 'bold';
  state.italic = cs.fontStyle === 'italic' || cs.fontStyle === 'oblique';
  if (cs.textDecorationLine.includes('underline')) {
    state.underline = cs.textDecorationStyle === 'double' ? 'double' : 'single';
  }

  const ta = cs.textAlign;
  if (ta === 'center') state.align = 'center';
  else if (ta === 'right' || ta === 'end') state.align = 'end';
  else if (ta === 'left' || ta === 'start') state.align = 'start';

  const cell = closestCell(node);
  if (cell) {
    const cellCs = win?.getComputedStyle(cell);
    if (cellCs) {
      const cellBg = cellCs.backgroundColor;
      if (cellBg && cellBg !== 'rgba(0, 0, 0, 0)' && cellBg !== 'transparent') {
        state.shade = rgbToHex(cellBg);
      }
      state.cellBorder = inferBorderFromCss(cellCs.borderTop || cellCs.border);
      const cta = cellCs.textAlign;
      if (cta === 'center') state.align = 'center';
      else if (cta === 'right' || cta === 'end') state.align = 'end';
      else if (cta === 'left' || cta === 'start') state.align = 'start';
    }
  } else {
    const bg = cs.backgroundColor;
    if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
      state.shade = rgbToHex(bg);
    }
  }
  return state;
}

/**
 * Apply a format-painter clipboard onto the current selection (one undo step).
 * Absolute styles — not toggles.
 */
export function applyFormatPainterClipboard(
  doc: Document,
  clip: FormatPainterClipboard,
  dir: 'rtl' | 'ltr',
): boolean {
  if (!hasNonEmptySelection(doc)) return false;
  pushSelectionUndo(doc);

  const styles: Record<string, string> = {
    fontWeight: clip.bold ? '700' : '400',
    fontStyle: clip.italic ? 'italic' : 'normal',
  };
  if (clip.fontFamily) styles.fontFamily = FONT_NAME[clip.fontFamily];
  if (clip.fontSizePt && clip.fontSizePt > 0) styles.fontSize = `${clip.fontSizePt}pt`;
  if (clip.color && /^#[0-9a-fA-F]{6}$/.test(clip.color)) styles.color = clip.color;
  if (clip.underline === 'none') {
    styles.textDecoration = 'none';
  } else if (clip.underline === 'double') {
    styles.textDecoration = 'underline';
    styles.textDecorationStyle = 'double';
  } else {
    styles.textDecoration = 'underline';
    styles.textDecorationStyle = 'solid';
  }

  const sel = getSel(doc);
  const cell = closestCell(sel?.anchorNode ?? null);

  // Text highlight only outside cells; cells get full-cell shade below.
  if (!cell && clip.shade && /^#[0-9a-fA-F]{6}$/.test(clip.shade)) {
    styles.backgroundColor = clip.shade;
  }

  const cells = cellsInSelection(doc);
  if (cells.length > 0) {
    applyStylesToTableCells(cells, styles);
  } else {
    wrapSelection(doc, styles);
  }

  if (clip.align) {
    const physical =
      clip.align === 'center'
        ? 'center'
        : clip.align === 'start'
          ? dir === 'rtl'
            ? 'right'
            : 'left'
          : dir === 'rtl'
            ? 'left'
            : 'right';
    if (cell) {
      cell.style.textAlign = physical;
      cell.querySelectorAll('.num-val').forEach((el) => {
        (el as HTMLElement).style.textAlign = physical;
      });
    }
    const cmd =
      physical === 'center' ? 'justifyCenter' : physical === 'left' ? 'justifyLeft' : 'justifyRight';
    runCommand(doc, cmd);
  }

  if (cell) {
    if (clip.shade && /^#[0-9a-fA-F]{6}$/.test(clip.shade)) {
      cell.style.background = clip.shade;
      cell.style.backgroundColor = clip.shade;
    }
    if (clip.cellBorder) {
      cell.style.border = BORDER_CSS[clip.cellBorder];
    }
  }

  return true;
}

function rgbToHex(rgb: string): string | null {
  const m = rgb.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (!m) {
    if (/^#[0-9a-fA-F]{6}$/.test(rgb)) return rgb;
    return null;
  }
  const h = (n: number) => n.toString(16).padStart(2, '0');
  return `#${h(+m[1])}${h(+m[2])}${h(+m[3])}`;
}

/** Serialize the live preview document for print / PDF. */
export function serializePreviewDocument(doc: Document): string {
  const doctype = doc.doctype
    ? `<!DOCTYPE ${doc.doctype.name}>`
    : '<!DOCTYPE html>';
  return `${doctype}\n${doc.documentElement.outerHTML}`;
}
