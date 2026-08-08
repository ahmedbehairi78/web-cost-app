/** Excel-like keyboard navigation for editable grid cells. */

import type { KeyboardEvent } from 'react';

export type SpreadsheetCell = { row: number; col: number };

export type SpreadsheetGridDims = { rows: number; cols: number };

export function selectInputContents(el: HTMLInputElement | null | undefined): void {
  if (!el) return;
  requestAnimationFrame(() => {
    el.focus();
    el.select();
  });
}

export function focusSpreadsheetCell(
  refs: (HTMLInputElement | null)[][],
  row: number,
  col: number,
): void {
  selectInputContents(refs[row]?.[col] ?? null);
}

/**
 * Returns the next cell to focus, or null when Tab should leave the grid.
 * Arrow keys wrap at grid edges; Enter moves down (Excel-style).
 */
export function resolveSpreadsheetMove(
  key: string,
  current: SpreadsheetCell,
  dims: SpreadsheetGridDims,
  shiftKey = false,
): SpreadsheetCell | null {
  const { row, col } = current;
  const { rows, cols } = dims;
  if (rows <= 0 || cols <= 0) return null;

  if (key === 'Tab') {
    if (shiftKey) {
      if (col > 0) return { row, col: col - 1 };
      if (row > 0) return { row: row - 1, col: cols - 1 };
      return null;
    }
    if (col < cols - 1) return { row, col: col + 1 };
    if (row < rows - 1) return { row: row + 1, col: 0 };
    return null;
  }

  switch (key) {
    case 'ArrowRight':
      if (col < cols - 1) return { row, col: col + 1 };
      if (row < rows - 1) return { row: row + 1, col: 0 };
      return { row, col };
    case 'ArrowLeft':
      if (col > 0) return { row, col: col - 1 };
      if (row > 0) return { row: row - 1, col: cols - 1 };
      return { row, col };
    case 'ArrowDown':
    case 'Enter':
      if (row < rows - 1) return { row: row + 1, col };
      return { row, col };
    case 'ArrowUp':
      if (row > 0) return { row: row - 1, col };
      return { row, col };
    default:
      return null;
  }
}

export function handleSpreadsheetCellKeyDown(
  e: KeyboardEvent<HTMLInputElement>,
  current: SpreadsheetCell,
  dims: SpreadsheetGridDims,
  refs: (HTMLInputElement | null)[][],
): void {
  const navKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab', 'Enter'];
  if (!navKeys.includes(e.key)) return;

  const next = resolveSpreadsheetMove(e.key, current, dims, e.shiftKey);
  if (!next) return;

  const moved = next.row !== current.row || next.col !== current.col;
  e.preventDefault();
  if (moved) {
    focusSpreadsheetCell(refs, next.row, next.col);
  }
}
