import React, { useCallback } from 'react';
import { cn } from '../../lib/utils';
import { handleSpreadsheetCellKeyDown } from '../../lib/spreadsheetGridNav';

type Props = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'ref'> & {
  row: number;
  col: number;
  rowCount: number;
  colCount: number;
  gridRefs: React.MutableRefObject<(HTMLInputElement | null)[][]>;
  /** When true, uses theme-aware spreadsheet cell styling (rate vs qty columns). */
  variant?: 'rate' | 'qty';
  theme?: string;
  /**
   * When true (default), marks the input so the global table navigator ignores it
   * and this component owns arrow/Tab/Enter movement via `gridRefs`.
   */
  manageNav?: boolean;
};

export function SpreadsheetCellInput({
  row,
  col,
  rowCount,
  colCount,
  gridRefs,
  variant = 'qty',
  theme = 'dark',
  manageNav = true,
  className,
  onFocus,
  onKeyDown,
  ...props
}: Props) {
  const setRef = useCallback(
    (el: HTMLInputElement | null) => {
      if (!gridRefs.current[row]) gridRefs.current[row] = [];
      gridRefs.current[row][col] = el;
    },
    [gridRefs, row, col],
  );

  const cellCls = cn(
    'w-full min-w-[4.5rem] border rounded py-1.5 px-2 text-center outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/40 transition-colors font-mono text-sm',
    variant === 'rate'
      ? theme === 'dark'
        ? 'bg-gray-900 border-gray-700 text-green-400'
        : 'bg-white border-gray-300 text-green-700'
      : theme === 'dark'
        ? 'bg-gray-900 border-gray-700 text-gray-100'
        : 'bg-white border-gray-300 text-gray-900',
    className,
  );

  return (
    <input
      {...props}
      ref={setRef}
      className={cellCls}
      data-excel-nav={manageNav ? 'managed' : props['data-excel-nav']}
      onFocus={(e) => {
        e.target.select();
        onFocus?.(e);
      }}
      onKeyDown={(e) => {
        if (manageNav) {
          handleSpreadsheetCellKeyDown(
            e,
            { row, col },
            { rows: rowCount, cols: colCount },
            gridRefs.current,
          );
        }
        onKeyDown?.(e);
      }}
    />
  );
}
