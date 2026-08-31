/**
 * App-wide Excel-like input behaviour:
 * - focus → select all (typing replaces existing value)
 * - arrow keys never spin `<input type="number">` values
 * - arrow / Enter / Tab navigate between fields (table grid, else spatial nearest)
 *
 * Opt out: `data-excel-nav="off"` · `data-excel-select="off"` · scope: `data-excel-nav-scope`
 */

const SELECTABLE_INPUT_TYPES = new Set([
  'text',
  'search',
  'tel',
  'url',
  'password',
  'email',
  'number',
  '', // missing type defaults to text
]);

const ARROW_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
const NAV_KEYS = new Set([...ARROW_KEYS, 'Tab', 'Enter']);

/** Query for fields that participate in Excel-like grid navigation. */
export const EXCEL_NAV_FIELD_SELECTOR = [
  'input:not([type=hidden]):not([type=file]):not([type=checkbox]):not([type=radio])',
  ':not([type=button]):not([type=submit]):not([type=reset]):not([type=image])',
  ':not([type=range]):not([type=color]):not([type=date]):not([type=datetime-local])',
  ':not([type=month]):not([type=week]):not([type=time])',
  ':not([disabled]):not([readonly]):not([data-excel-nav=off]):not([data-excel-nav=managed])',
  ', textarea:not([disabled]):not([readonly]):not([data-excel-nav=off]):not([data-excel-nav=managed])',
  ', select:not([disabled]):not([data-excel-nav=off]):not([data-excel-nav=managed])',
].join('');

export type ExcelNavField = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

export type RectLike = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

export function isExcelNavField(el: EventTarget | null): el is ExcelNavField {
  if (el == null || typeof el !== 'object') return false;
  const node = el as Partial<ExcelNavField> & {
    tagName?: string;
    disabled?: boolean;
    readOnly?: boolean;
    dataset?: DOMStringMap;
    getAttribute?: (name: string) => string | null;
  };
  const tag = String(node.tagName || '').toUpperCase();
  const isInput = tag === 'INPUT'
    || (typeof HTMLInputElement !== 'undefined' && el instanceof HTMLInputElement);
  const isTextarea = tag === 'TEXTAREA'
    || (typeof HTMLTextAreaElement !== 'undefined' && el instanceof HTMLTextAreaElement);
  const isSelect = tag === 'SELECT'
    || (typeof HTMLSelectElement !== 'undefined' && el instanceof HTMLSelectElement);
  if (!isInput && !isTextarea && !isSelect) return false;
  if (node.disabled) return false;
  if ((isInput || isTextarea) && node.readOnly) return false;
  if (node.dataset?.excelNav === 'off' || node.dataset?.excelNav === 'managed') return false;
  if (isSelect || isTextarea) return true;
  const type = (node.getAttribute?.('type') || (node as HTMLInputElement).type || 'text').toLowerCase();
  return SELECTABLE_INPUT_TYPES.has(type);
}

export function isExcelSelectableField(el: EventTarget | null): el is ExcelNavField {
  if (!isExcelNavField(el)) return false;
  if (el instanceof HTMLSelectElement) return false; // selects don't use select-all
  if (el.dataset.excelSelect === 'off') return false;
  return true;
}

export function isNumberInput(el: ExcelNavField): boolean {
  // Duck-type: vitest/node mocks are not always real HTMLInputElement instances
  if (typeof HTMLInputElement !== 'undefined' && el instanceof HTMLInputElement) {
    const typed = el;
    if (typeof typed.type === 'string' && typed.type.length > 0) {
      return typed.type.toLowerCase() === 'number';
    }
  }
  if (typeof el.getAttribute === 'function') {
    return (el.getAttribute('type') || '').toLowerCase() === 'number';
  }
  const maybeType = (el as { type?: string }).type;
  return typeof maybeType === 'string' && maybeType.toLowerCase() === 'number';
}

export function fieldHasFullSelection(el: ExcelNavField): boolean {
  if (typeof HTMLSelectElement !== 'undefined' && el instanceof HTMLSelectElement) return true;
  if (typeof (el as HTMLSelectElement).selectedIndex === 'number' && !('selectionStart' in el)) {
    return true;
  }
  const len = el.value?.length ?? 0;
  if (typeof el.selectionStart !== 'number' || typeof el.selectionEnd !== 'number') {
    // number inputs in some browsers report null selection — treat as fully selected
    return true;
  }
  return el.selectionStart === 0 && el.selectionEnd === len;
}

/**
 * When the value is fully selected (Excel "ready" mode), horizontal arrows leave the cell.
 * Mid-edit caret stays in the field (text only — number inputs always navigate).
 */
export function shouldNavigateHorizontally(el: ExcelNavField, key: string): boolean {
  if (key !== 'ArrowLeft' && key !== 'ArrowRight') return true;
  if (isNumberInput(el)) return true;
  const len = el.value?.length ?? 0;
  if (len === 0) return true;
  if (fieldHasFullSelection(el)) return true;

  const start = el.selectionStart ?? 0;
  const end = el.selectionEnd ?? 0;
  if (key === 'ArrowLeft') return start === 0 && end === 0;
  return start === len && end === len;
}

export type TableGridCell = { row: number; col: number; el: ExcelNavField };

export function listTableNavRows(fromEl: Element): HTMLTableRowElement[] {
  const table = fromEl.closest('table');
  if (!table) return [];
  const section = fromEl.closest('tbody, thead, tfoot') ?? table;
  return [...section.querySelectorAll(':scope > tr')].filter((tr) =>
    tr.querySelector(EXCEL_NAV_FIELD_SELECTOR),
  ) as HTMLTableRowElement[];
}

export function listRowNavFields(tr: HTMLTableRowElement): ExcelNavField[] {
  return [...tr.querySelectorAll(EXCEL_NAV_FIELD_SELECTOR)].filter(isExcelNavField);
}

export function locateTableGridCell(el: ExcelNavField): TableGridCell | null {
  const tr = el.closest('tr');
  if (!tr || !(tr instanceof HTMLTableRowElement)) return null;
  if (!el.closest('table')) return null;
  const rows = listTableNavRows(el);
  const row = rows.indexOf(tr);
  if (row < 0) return null;
  const fields = listRowNavFields(tr);
  const col = fields.indexOf(el);
  if (col < 0) return null;
  return { row, col, el };
}

export function resolveTableGridMove(
  key: string,
  current: { row: number; col: number },
  rowFields: ExcelNavField[][],
  shiftKey = false,
): { row: number; col: number } | null {
  const rows = rowFields.length;
  if (rows <= 0) return null;
  const colsIn = (r: number) => rowFields[r]?.length ?? 0;

  const { row, col } = current;
  if (row < 0 || row >= rows || col < 0 || col >= colsIn(row)) return null;

  if (key === 'Tab') {
    if (shiftKey) {
      if (col > 0) return { row, col: col - 1 };
      if (row > 0) {
        const prevCols = colsIn(row - 1);
        return prevCols > 0 ? { row: row - 1, col: prevCols - 1 } : null;
      }
      return null;
    }
    if (col < colsIn(row) - 1) return { row, col: col + 1 };
    if (row < rows - 1 && colsIn(row + 1) > 0) return { row: row + 1, col: 0 };
    return null;
  }

  switch (key) {
    case 'ArrowRight': {
      if (col < colsIn(row) - 1) return { row, col: col + 1 };
      if (row < rows - 1 && colsIn(row + 1) > 0) return { row: row + 1, col: 0 };
      return { row, col };
    }
    case 'ArrowLeft': {
      if (col > 0) return { row, col: col - 1 };
      if (row > 0) {
        const prevCols = colsIn(row - 1);
        return prevCols > 0 ? { row: row - 1, col: prevCols - 1 } : { row, col };
      }
      return { row, col };
    }
    case 'ArrowDown':
    case 'Enter': {
      if (row >= rows - 1) return { row, col };
      const nextCols = colsIn(row + 1);
      if (nextCols <= 0) return { row, col };
      return { row: row + 1, col: Math.min(col, nextCols - 1) };
    }
    case 'ArrowUp': {
      if (row <= 0) return { row, col };
      const prevCols = colsIn(row - 1);
      if (prevCols <= 0) return { row, col };
      return { row: row - 1, col: Math.min(col, prevCols - 1) };
    }
    default:
      return null;
  }
}

function rectCenter(r: RectLike): { x: number; y: number } {
  return { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 };
}

/**
 * Pick the nearest field in the arrow direction by screen position.
 * Prefers alignment on the orthogonal axis (same column when moving vertically, etc.).
 */
export function resolveSpatialNeighbor<T>(
  key: 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight',
  currentRect: RectLike,
  candidates: Array<{ id: T; rect: RectLike }>,
): T | null {
  const cur = rectCenter(currentRect);
  const AXIS_WEIGHT = 3;
  const THRESH = 2;

  let best: { id: T; score: number } | null = null;

  for (const c of candidates) {
    const o = rectCenter(c.rect);
    const dx = o.x - cur.x;
    const dy = o.y - cur.y;
    let score = Number.POSITIVE_INFINITY;

    switch (key) {
      case 'ArrowDown':
        if (dy <= THRESH) continue;
        score = dy + Math.abs(dx) * AXIS_WEIGHT;
        break;
      case 'ArrowUp':
        if (dy >= -THRESH) continue;
        score = -dy + Math.abs(dx) * AXIS_WEIGHT;
        break;
      case 'ArrowRight':
        if (dx <= THRESH) continue;
        score = dx + Math.abs(dy) * AXIS_WEIGHT;
        break;
      case 'ArrowLeft':
        if (dx >= -THRESH) continue;
        score = -dx + Math.abs(dy) * AXIS_WEIGHT;
        break;
      default:
        continue;
    }

    if (!best || score < best.score) best = { id: c.id, score };
  }

  return best?.id ?? null;
}

/** Prefer a fixed/fullscreen overlay (typical app modal) over scanning `#root`. */
export function closestFixedOverlay(el: Element): Element | null {
  let node: HTMLElement | null = el instanceof HTMLElement ? el : el.parentElement;
  while (node && node !== document.body && node !== document.documentElement) {
    const cls = node.classList;
    if (cls?.contains('fixed') && (cls.contains('inset-0') || cls.contains('inset-x-0'))) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

/**
 * Narrow navigation scope. Returns `null` when only the full app root is available —
 * callers must skip expensive spatial scans (was a major input lag source).
 */
export function resolveNavScope(el: Element): Element | null {
  return (
    el.closest('[data-excel-nav-scope]') ||
    el.closest('[role="dialog"]') ||
    el.closest('[aria-modal="true"]') ||
    closestFixedOverlay(el) ||
    el.closest('form') ||
    el.closest('[data-radix-portal]') ||
    el.closest('table') ||
    el.closest('section') ||
    null
  );
}

function isFieldVisible(el: ExcelNavField): boolean {
  if (typeof el.checkVisibility === 'function') {
    try {
      return el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
    } catch {
      /* older engines */
    }
  }
  return el.getClientRects().length > 0;
}

/** Soft cap — beyond this, spatial nav would jank on large screens. */
export const EXCEL_SPATIAL_MAX_CANDIDATES = 80;

function listScopeNavFields(scope: Element, except: ExcelNavField): ExcelNavField[] {
  const found: ExcelNavField[] = [];
  for (const node of scope.querySelectorAll(EXCEL_NAV_FIELD_SELECTOR)) {
    if (!isExcelNavField(node) || node === except || !isFieldVisible(node)) continue;
    found.push(node);
    if (found.length >= EXCEL_SPATIAL_MAX_CANDIDATES) break;
  }
  return found;
}

function focusAndSelect(el: ExcelNavField): void {
  requestAnimationFrame(() => {
    el.focus();
    if (el instanceof HTMLSelectElement) return;
    try {
      el.select();
    } catch {
      /* some input types reject select() */
    }
  });
}

function buildRowFieldsMatrix(fromEl: ExcelNavField): ExcelNavField[][] {
  return listTableNavRows(fromEl).map((tr) => listRowNavFields(tr));
}

function tryTableNavigation(e: KeyboardEvent, el: ExcelNavField): boolean {
  if (!el.closest('table')) return false;
  const located = locateTableGridCell(el);
  if (!located) return false;

  const matrix = buildRowFieldsMatrix(el);
  const next = resolveTableGridMove(e.key, located, matrix, e.shiftKey);
  // Tab past the last/first cell — let the browser leave the grid
  if (!next) return false;

  const moved = next.row !== located.row || next.col !== located.col;
  e.preventDefault();
  e.stopPropagation();
  if (moved) {
    const target = matrix[next.row]?.[next.col];
    if (target) focusAndSelect(target);
  }
  return true;
}

function trySpatialNavigation(e: KeyboardEvent, el: ExcelNavField): boolean {
  if (!ARROW_KEYS.has(e.key)) return false;
  const key = e.key as 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight';
  const scope = resolveNavScope(el);
  // No narrow scope → skip (avoids scanning the entire SPA on every arrow key)
  if (!scope) return false;
  const others = listScopeNavFields(scope, el);
  if (others.length === 0) return false;

  const currentRect = el.getBoundingClientRect();
  const target = resolveSpatialNeighbor(
    key,
    currentRect,
    others.map((f) => ({ id: f, rect: f.getBoundingClientRect() })),
  );
  if (!target) return false;

  e.preventDefault();
  e.stopPropagation();
  focusAndSelect(target);
  return true;
}

function handleNavKeyDown(e: KeyboardEvent): void {
  if (!NAV_KEYS.has(e.key)) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (!isExcelNavField(e.target)) return;

  const el = e.target;

  // Always block native number spin (↑/↓ change value) — even when no neighbor exists
  if (isNumberInput(el) && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
    e.preventDefault();
  }

  // Explicitly managed grids (SpreadsheetCellInput) own their arrow keys
  if (el.dataset.excelNav === 'managed') return;

  // In tables, arrow keys move between cells (Excel) — do not cycle <select> options
  if (el instanceof HTMLSelectElement && el.closest('table') && ARROW_KEYS.has(e.key)) {
    if (tryTableNavigation(e, el)) return;
    e.preventDefault();
    return;
  }

  if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !shouldNavigateHorizontally(el, e.key)) {
    return;
  }

  // Vertical arrows on any field: never leave browser to mutate number values
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    if (tryTableNavigation(e, el)) return;
    if (trySpatialNavigation(e, el)) return;
    // number already preventDefault'd above; text vertical with no neighbor — no-op
    return;
  }

  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    if (tryTableNavigation(e, el)) return;
    if (trySpatialNavigation(e, el)) return;
    return;
  }

  // Tab / Enter: table grids only (Enter in loose forms should still submit when appropriate)
  if (el.closest('table')) {
    tryTableNavigation(e, el);
  }
}

function handleFocusIn(e: FocusEvent): void {
  if (!isExcelSelectableField(e.target)) return;
  const el = e.target;
  requestAnimationFrame(() => {
    if (document.activeElement !== el) return;
    try {
      el.select();
    } catch {
      /* ignore */
    }
  });
}

/**
 * Install document-level listeners. Call once at app boot; returns cleanup.
 */
export function installExcelLikeInputBehavior(root: Document | HTMLElement = document): () => void {
  const focusTarget: Document | HTMLElement = root;
  const keyTarget: Document | HTMLElement = root;

  focusTarget.addEventListener('focusin', handleFocusIn);
  keyTarget.addEventListener('keydown', handleNavKeyDown, true);

  return () => {
    focusTarget.removeEventListener('focusin', handleFocusIn);
    keyTarget.removeEventListener('keydown', handleNavKeyDown, true);
  };
}
