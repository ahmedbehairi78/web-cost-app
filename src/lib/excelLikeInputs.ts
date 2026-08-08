/**
 * App-wide Excel-like input behaviour:
 * - focus → select all (typing replaces existing value)
 * - inside editable tables → arrow / Enter / Tab navigate between cells
 *
 * Opt out: `data-excel-nav="off"` on an input, or `data-excel-select="off"` to skip select-only.
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

const NAV_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab', 'Enter']);

/** Query for fields that participate in Excel-like grid navigation. */
export const EXCEL_NAV_FIELD_SELECTOR = [
  'input:not([type=hidden]):not([type=file]):not([type=checkbox]):not([type=radio])',
  ':not([type=button]):not([type=submit]):not([type=reset]):not([type=image])',
  ':not([type=range]):not([type=color]):not([type=date]):not([type=datetime-local])',
  ':not([type=month]):not([type=week]):not([type=time])',
  ':not([disabled]):not([readonly]):not([data-excel-nav=off])',
  ', textarea:not([disabled]):not([readonly]):not([data-excel-nav=off])',
].join('');
export type ExcelNavField = HTMLInputElement | HTMLTextAreaElement;

export function isExcelNavField(el: EventTarget | null): el is ExcelNavField {
  if (!(el instanceof HTMLInputElement) && !(el instanceof HTMLTextAreaElement)) return false;
  if (el.disabled || el.readOnly) return false;
  if (el.dataset.excelNav === 'off') return false;
  if (el instanceof HTMLTextAreaElement) return true;
  const type = (el.getAttribute('type') || 'text').toLowerCase();
  return SELECTABLE_INPUT_TYPES.has(type);
}

export function isExcelSelectableField(el: EventTarget | null): el is ExcelNavField {
  if (!isExcelNavField(el)) return false;
  if (el.dataset.excelSelect === 'off') return false;
  return true;
}

export function fieldHasFullSelection(el: ExcelNavField): boolean {
  const len = el.value?.length ?? 0;
  if (typeof el.selectionStart !== 'number' || typeof el.selectionEnd !== 'number') {
    // number inputs in some browsers report null selection — treat as fully selected
    return true;
  }
  return el.selectionStart === 0 && el.selectionEnd === len;
}

/**
 * When the value is fully selected (Excel "ready" mode), horizontal arrows leave the cell.
 * Mid-edit caret stays in the field.
 */
export function shouldNavigateHorizontally(el: ExcelNavField, key: string): boolean {
  if (key !== 'ArrowLeft' && key !== 'ArrowRight') return true;
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

  let { row, col } = current;
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

function focusAndSelect(el: ExcelNavField): void {
  requestAnimationFrame(() => {
    el.focus();
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

function handleTableNavKeyDown(e: KeyboardEvent): void {
  if (!NAV_KEYS.has(e.key)) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (!isExcelNavField(e.target)) return;

  const el = e.target;
  if (!el.closest('table')) return;
  // Explicitly managed grids (legacy SpreadsheetCellInput) handle their own keys
  if (el.dataset.excelNav === 'managed') return;

  if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !shouldNavigateHorizontally(el, e.key)) {
    return;
  }

  const located = locateTableGridCell(el);
  if (!located) return;

  const matrix = buildRowFieldsMatrix(el);
  const next = resolveTableGridMove(e.key, located, matrix, e.shiftKey);
  // Tab past the last/first cell — let the browser leave the grid
  if (!next) return;

  const moved = next.row !== located.row || next.col !== located.col;
  // Always prevent default for handled nav keys (stops number-input spin on ArrowUp/Down)
  e.preventDefault();
  e.stopPropagation();
  if (moved) {
    const target = matrix[next.row]?.[next.col];
    if (target) focusAndSelect(target);
  }
}

function handleFocusIn(e: FocusEvent): void {
  if (!isExcelSelectableField(e.target)) return;
  const el = e.target;
  // Avoid fighting IME / programmatic focus loops
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
  const doc = root instanceof Document ? root : root.ownerDocument ?? document;
  const focusTarget: Document | HTMLElement = root;
  const keyTarget: Document | HTMLElement = root;

  focusTarget.addEventListener('focusin', handleFocusIn);
  keyTarget.addEventListener('keydown', handleTableNavKeyDown, true);

  return () => {
    focusTarget.removeEventListener('focusin', handleFocusIn);
    keyTarget.removeEventListener('keydown', handleTableNavKeyDown, true);
  };
}
