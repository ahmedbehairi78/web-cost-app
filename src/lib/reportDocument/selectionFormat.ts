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
};

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

  const span = doc.createElement('span');
  span.setAttribute('data-sel-fmt', '1');
  for (const [k, v] of Object.entries(styles)) {
    if (v) (span.style as unknown as Record<string, string>)[k] = v;
  }

  try {
    range.surroundContents(span);
  } catch {
    // Cross-element selection: extract and wrap.
    const frag = range.extractContents();
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
  const ok = runCommand(doc, 'fontName', FONT_NAME[family]);
  if (!ok) {
    wrapSelection(doc, { fontFamily: FONT_NAME[family] });
  }
  return true;
}

export function applySelectionFontSize(doc: Document, pt: number): boolean {
  if (!hasNonEmptySelection(doc) || pt <= 0) return false;
  pushSelectionUndo(doc);
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
    runCommand(doc, 'underline'); // toggle off if on — imperfect
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
    // Also align nested num wrappers so LTR amounts follow the cell.
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
  if (hexOrEmpty === '') {
    if (cell) cell.style.background = '';
    wrapSelection(doc, { backgroundColor: 'transparent' });
    return true;
  }
  if (!/^#[0-9a-fA-F]{6}$/.test(hexOrEmpty)) return false;
  // Text highlight for the selected characters.
  const ok = runCommand(doc, 'hiliteColor', hexOrEmpty) || runCommand(doc, 'backColor', hexOrEmpty);
  if (!ok) wrapSelection(doc, { backgroundColor: hexOrEmpty });
  // If the selection spans most of a cell, also tint the cell.
  if (cell) {
    const cellText = (cell.textContent || '').replace(/\s+/g, ' ').trim();
    const selText = (sel?.toString() || '').replace(/\s+/g, ' ').trim();
    if (selText && cellText && (selText === cellText || cellText.includes(selText))) {
      cell.style.background = hexOrEmpty;
    }
  }
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

  const bg = cs.backgroundColor;
  if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
    state.shade = rgbToHex(bg);
  }
  return state;
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
