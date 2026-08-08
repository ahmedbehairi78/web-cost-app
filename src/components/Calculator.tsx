import React, {
  useState, useCallback, useEffect, useRef,
  useContext, createContext,
} from 'react';
import { Copy, Check, Trash2, History, X, MoreVertical } from 'lucide-react';
import { cn } from '../lib/utils';
import { shellInteractiveFocus } from '../lib/shellTheme';
import { useLanguage } from '../context/LanguageContext';
import { ManualHelpButton } from './help/ManualHelpButton';

interface HistoryEntry {
  id: number;
  expression: string;
  result: string;
}

type Operator = '+' | '-' | '×' | '÷' | null;

// ── helpers ───────────────────────────────────────────────────────────────────

function formatNumber(value: string): string {
  const num = parseFloat(value);
  if (isNaN(num)) return value;
  return parseFloat(num.toPrecision(12)).toString();
}

function safeEval(a: number, op: Operator, b: number): number | 'ERR' {
  switch (op) {
    case '+': return a + b;
    case '-': return a - b;
    case '×': return a * b;
    case '÷': return b === 0 ? 'ERR' : a / b;
    default:  return b;
  }
}

// ── Shared context (Calculator content ↔ title-bar extras) ────────────────────

interface CalcContextValue {
  showHistory: boolean;
  setShowHistory: React.Dispatch<React.SetStateAction<boolean>>;
  history: HistoryEntry[];
  setHistory: React.Dispatch<React.SetStateAction<HistoryEntry[]>>;
}

const CalcContext = createContext<CalcContextValue | null>(null);

export function CalcProvider({ children }: { children: React.ReactNode }) {
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory]         = useState<HistoryEntry[]>([]);
  return (
    <CalcContext.Provider value={{ showHistory, setShowHistory, history, setHistory }}>
      {children}
    </CalcContext.Provider>
  );
}

// ── Title-bar extras — rendered inside WindowFrame's title bar ─────────────────

export function CalcTitleBarExtras() {
  const ctx = useContext(CalcContext);
  const { language, theme } = useLanguage();
  const isAr = language === 'ar';
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showMenu) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showMenu]);

  if (!ctx) return null;
  const { showHistory, setShowHistory, history, setHistory } = ctx;

  const dropdownCls = cn(
    'absolute top-full mt-1 rounded-lg border shadow-xl py-1 z-[9999] min-w-[160px]',
    'right-0',
    theme === 'dark'
      ? 'bg-gray-800 border-gray-600 text-gray-200'
      : theme === 'soft'
        ? 'bg-stone-50 border-stone-300 text-gray-700'
        : 'bg-white border-gray-200 text-gray-700'
  );

  const itemCls = (active?: boolean) => cn(
    'w-full flex items-center gap-2 px-3 py-2 text-xs font-medium transition-colors',
    isAr ? 'flex-row-reverse' : '',
    active
      ? 'text-blue-400'
      : theme === 'dark' ? 'hover:bg-gray-700' : 'hover:bg-gray-100'
  );

  return (
    <div ref={menuRef} className="relative flex-shrink-0">
      <button
        type="button"
        onClick={() => setShowMenu(v => !v)}
        title={isAr ? 'السجل والخيارات' : 'History & options'}
        className={cn(
          'w-5 h-5 flex items-center justify-center transition-colors rounded',
          showMenu ? 'text-blue-400' : 'text-gray-400 hover:text-blue-400',
          shellInteractiveFocus,
        )}
      >
        <MoreVertical size={13} />
      </button>

      {showMenu && (
        <div className={dropdownCls} style={{ direction: isAr ? 'rtl' : 'ltr' }}>
          {/* Toggle history panel */}
          <button
            type="button"
            onClick={() => { setShowHistory(v => !v); setShowMenu(false); }}
            className={itemCls(showHistory)}
          >
            <History size={13} className="flex-shrink-0" />
            <span className="flex-1">{isAr ? 'السجل' : 'History'}</span>
            {history.length > 0 && (
              <span className={cn(
                'text-[10px] px-1.5 py-0.5 rounded-full font-mono tabular-nums',
                showHistory
                  ? 'bg-blue-500/20 text-blue-400'
                  : theme === 'dark' ? 'bg-gray-600 text-gray-300' : 'bg-gray-200 text-gray-500'
              )}>
                {history.length}
              </span>
            )}
          </button>

          {/* Clear history */}
          {history.length > 0 && (
            <>
              <div className={cn(
                'mx-2 my-1 border-t',
                theme === 'dark' ? 'border-gray-600' : 'border-gray-200'
              )} />
              <button
                type="button"
                onClick={() => { setHistory([]); setShowHistory(false); setShowMenu(false); }}
                className={cn(itemCls(), 'text-red-400')}
              >
                <Trash2 size={13} className="flex-shrink-0" />
                {isAr ? 'مسح السجل' : 'Clear history'}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Calculator component ───────────────────────────────────────────────────────

export function Calculator() {
  const ctx = useContext(CalcContext)!;
  const { showHistory, setShowHistory, history, setHistory } = ctx;

  const { language, theme, dir } = useLanguage();
  const isAr = language === 'ar';

  // ── local calc state ──
  const [display, setDisplay]       = useState('0');
  const [expression, setExpression] = useState('');
  const [operand, setOperand]       = useState<number | null>(null);
  const [operator, setOperator]     = useState<Operator>(null);
  const [waitNext, setWaitNext]     = useState(false);
  const [copied, setCopied]         = useState<number | 'result' | null>(null);

  const historyEndRef = useRef<HTMLDivElement>(null);
  const idCounter     = useRef(0);

  // scroll to latest history entry
  useEffect(() => {
    if (showHistory) historyEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [history.length, showHistory]);

  // ── keyboard ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT' ||
          (e.target as HTMLElement).tagName === 'TEXTAREA') return;

      if (e.ctrlKey && e.key === 'c') {
        if (!window.getSelection()?.toString()) copyText(display, 'result');
        return;
      }
      if (e.ctrlKey && e.key === 'v') { void handlePaste(); return; }
      if (e.ctrlKey || e.altKey || e.metaKey) return;

      if (e.key >= '0' && e.key <= '9') { handleDigit(e.key); return; }
      if (e.key === '.')       { handleDot(); return; }
      if (e.key === '+')       { handleOperator('+'); return; }
      if (e.key === '-')       { handleOperator('-'); return; }
      if (e.key === '*')       { handleOperator('×'); return; }
      if (e.key === '/') { e.preventDefault(); handleOperator('÷'); return; }
      if (e.key === '%')       { handlePercent(); return; }
      if (e.key === 'Enter' || e.key === '=') { handleEquals(); return; }
      if (e.key === 'Escape')  { handleClear(); return; }
      if (e.key === 'Backspace') { handleBackspace(); return; }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }); // re-bind every render so closures stay fresh

  // ── clipboard helpers ─────────────────────────────────────────────────────
  const handlePaste = useCallback(async () => {
    try {
      const text    = await navigator.clipboard.readText();
      const cleaned = text.replace(/[^0-9.\-]/g, '');
      const num     = parseFloat(cleaned);
      if (!isNaN(num)) { setDisplay(formatNumber(num.toString())); setWaitNext(false); }
    } catch { /* permission denied */ }
  }, []);

  const copyText = useCallback((text: string, key: number | 'result') => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(null), 1500);
    });
  }, []);

  // ── calc logic ────────────────────────────────────────────────────────────
  const handleDigit = useCallback((d: string) => {
    setDisplay(prev => {
      if (waitNext || prev === '0') return d;
      if (prev.length >= 15) return prev;
      return prev + d;
    });
    setWaitNext(false);
  }, [waitNext]);

  const handleDot = useCallback(() => {
    setDisplay(prev => {
      if (waitNext) { setWaitNext(false); return '0.'; }
      return prev.includes('.') ? prev : prev + '.';
    });
  }, [waitNext]);

  const handleBackspace = useCallback(() => {
    if (waitNext) return;
    setDisplay(prev => prev.length > 1 ? prev.slice(0, -1) : '0');
  }, [waitNext]);

  const handleClear = useCallback(() => {
    setDisplay('0'); setExpression('');
    setOperand(null); setOperator(null); setWaitNext(false);
  }, []);

  const handleClearEntry = useCallback(() => { setDisplay('0'); }, []);

  const handleToggleSign = useCallback(() => {
    setDisplay(prev => {
      const n = parseFloat(prev);
      return isNaN(n) ? prev : formatNumber((-n).toString());
    });
  }, []);

  const handlePercent = useCallback(() => {
    setDisplay(prev => {
      const n = parseFloat(prev);
      if (isNaN(n)) return prev;
      const pct = operand != null ? (operand * n) / 100 : n / 100;
      return formatNumber(pct.toString());
    });
  }, [operand]);

  const handleOperator = useCallback((op: Operator) => {
    const current = parseFloat(display);
    if (operand != null && operator != null && !waitNext) {
      const result = safeEval(operand, operator, current);
      if (result === 'ERR') {
        setDisplay('خطأ'); setExpression('');
        setOperand(null); setOperator(null); setWaitNext(true);
        return;
      }
      const fmt = formatNumber(result.toString());
      setDisplay(fmt); setExpression(`${fmt} ${op ?? ''}`); setOperand(result);
    } else {
      setExpression(`${display} ${op ?? ''}`); setOperand(current);
    }
    setOperator(op); setWaitNext(true);
  }, [display, operand, operator, waitNext]);

  const handleEquals = useCallback(() => {
    if (operand == null || operator == null) return;
    const current   = parseFloat(display);
    const result    = safeEval(operand, operator, current);
    const expr      = `${expression} ${display} =`;
    const resultStr = result === 'ERR'
      ? (isAr ? 'خطأ' : 'Error')
      : formatNumber(result.toString());

    idCounter.current += 1;
    setHistory(prev => [...prev, { id: idCounter.current, expression: expr, result: resultStr }]);
    setDisplay(resultStr); setExpression(expr);
    setOperand(null); setOperator(null); setWaitNext(true);
  }, [display, expression, operand, operator, isAr, setHistory]);

  // ── theming ───────────────────────────────────────────────────────────────
  const surface = theme === 'dark'
    ? 'bg-gray-900 text-white'
    : theme === 'soft' ? 'bg-stone-100 text-gray-900' : 'bg-gray-50 text-gray-900';

  const panelBg = theme === 'dark'
    ? 'bg-gray-800 border-gray-700'
    : theme === 'soft' ? 'bg-stone-200 border-stone-300' : 'bg-white border-gray-200';

  const displayBg = theme === 'dark'
    ? 'bg-gray-950 border-gray-700'
    : theme === 'soft' ? 'bg-stone-900 border-stone-700' : 'bg-gray-900 border-gray-700';

  type BtnVariant = 'default' | 'operator' | 'equals' | 'action';
  const btnBase = 'flex items-center justify-center rounded-lg font-medium text-base select-none transition-all duration-100 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500';
  const btnCls = (v: BtnVariant) => cn(btnBase, {
    default: theme === 'dark'
      ? 'bg-gray-700 hover:bg-gray-600 text-white'
      : theme === 'soft' ? 'bg-stone-300 hover:bg-stone-400 text-gray-900' : 'bg-gray-200 hover:bg-gray-300 text-gray-900',
    operator: 'bg-blue-600 hover:bg-blue-500 text-white',
    equals:   'bg-blue-700 hover:bg-blue-600 text-white',
    action: theme === 'dark'
      ? 'bg-gray-600 hover:bg-gray-500 text-white'
      : theme === 'soft' ? 'bg-stone-400 hover:bg-stone-500 text-gray-900' : 'bg-gray-300 hover:bg-gray-400 text-gray-900',
  }[v]);

  // ── button grid ───────────────────────────────────────────────────────────
  const buttons: { label: string; action: () => void; variant: BtnVariant; wide?: boolean }[] = [
    { label: 'AC', action: handleClear,            variant: 'action' },
    { label: 'CE', action: handleClearEntry,        variant: 'action' },
    { label: '±',  action: handleToggleSign,        variant: 'action' },
    { label: '÷',  action: () => handleOperator('÷'), variant: 'operator' },
    { label: '7',  action: () => handleDigit('7'),  variant: 'default' },
    { label: '8',  action: () => handleDigit('8'),  variant: 'default' },
    { label: '9',  action: () => handleDigit('9'),  variant: 'default' },
    { label: '×',  action: () => handleOperator('×'), variant: 'operator' },
    { label: '4',  action: () => handleDigit('4'),  variant: 'default' },
    { label: '5',  action: () => handleDigit('5'),  variant: 'default' },
    { label: '6',  action: () => handleDigit('6'),  variant: 'default' },
    { label: '-',  action: () => handleOperator('-'), variant: 'operator' },
    { label: '1',  action: () => handleDigit('1'),  variant: 'default' },
    { label: '2',  action: () => handleDigit('2'),  variant: 'default' },
    { label: '3',  action: () => handleDigit('3'),  variant: 'default' },
    { label: '+',  action: () => handleOperator('+'), variant: 'operator' },
    { label: '%',  action: handlePercent,            variant: 'action' },
    { label: '0',  action: () => handleDigit('0'),  variant: 'default' },
    { label: '.',  action: handleDot,               variant: 'default' },
    { label: '=',  action: handleEquals,            variant: 'equals' },
  ];

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <div className={cn('relative flex h-full overflow-hidden', surface)} dir={dir}>

      {/* ── Calculator panel — always visible, always same size ── */}
      <div className="flex flex-col w-full p-3 gap-2">
        <div className={cn('absolute top-1 z-10', isAr ? 'left-1' : 'right-1')}>
          <ManualHelpButton topicId="tools.calculator.use" size={12} />
        </div>

        {/* Display */}
        <div className={cn('rounded-xl border flex flex-col', displayBg)}>
          <div
            className="text-right text-[10px] text-gray-400 truncate min-h-[0.875rem] font-mono px-3 pt-2.5"
            dir="ltr" title={expression}
          >
            {expression || ' '}
          </div>
          <div
            className="text-right text-2xl font-bold text-white tracking-tight truncate font-mono select-text cursor-text px-3 pb-2.5 pt-0.5"
            dir="ltr" title={display}
          >
            {display}
          </div>
          {copied === 'result' && (
            <div className="flex items-center justify-end gap-1 text-[10px] text-green-400 px-3 pb-2 -mt-1">
              <Check size={10} />
              {isAr ? 'تم النسخ' : 'Copied'}
            </div>
          )}
        </div>

        {/* Button grid */}
        <div className="grid grid-cols-4 gap-1.5">
          {buttons.map((btn, i) => (
            <button
              key={i}
              type="button"
              onClick={btn.action}
              className={cn(btnCls(btn.variant), 'h-10', btn.wide && 'col-span-2')}
            >
              {btn.label}
            </button>
          ))}
        </div>

      </div>

      {/* ── History overlay — covers the calculator in place, no resize needed ── */}
      {showHistory && (
        <div
          className={cn(
            'absolute inset-0 flex flex-col z-20',
            panelBg.split(' ')[0], // background only
            theme === 'dark' ? 'bg-gray-800' : theme === 'soft' ? 'bg-stone-100' : 'bg-white'
          )}
          dir={dir}
        >
          {/* Header */}
          <div className={cn(
            'flex items-center justify-between px-3 py-2 border-b text-xs font-semibold flex-shrink-0',
            isAr ? 'flex-row-reverse' : '',
            theme === 'dark' ? 'border-gray-700 text-gray-200' : 'border-gray-200 text-gray-700'
          )}>
            <div className={cn('flex items-center gap-2', isAr ? 'flex-row-reverse' : '')}>
              <History size={13} />
              <span>{isAr ? 'سجل العمليات' : 'Calculation History'}</span>
              {history.length > 0 && (
                <span className={cn(
                  'text-[10px] px-1.5 py-0.5 rounded-full font-mono tabular-nums',
                  theme === 'dark' ? 'bg-gray-600 text-gray-300' : 'bg-gray-200 text-gray-500'
                )}>
                  {history.length}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => setShowHistory(false)}
              title={isAr ? 'إغلاق السجل' : 'Close history'}
              className={cn(
                'p-1 rounded-lg transition-colors',
                theme === 'dark' ? 'hover:bg-gray-700 text-gray-400 hover:text-white' : 'hover:bg-gray-100 text-gray-500'
              )}
            >
              <X size={14} />
            </button>
          </div>

          {/* Entries */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {history.length === 0 ? (
              <div className={cn(
                'flex flex-col items-center justify-center h-32 gap-2 text-sm',
                theme === 'dark' ? 'text-gray-500' : 'text-gray-400'
              )}>
                <History size={24} className="opacity-30" />
                {isAr ? 'لا توجد عمليات بعد' : 'No calculations yet'}
              </div>
            ) : (
              history.map((entry) => (
                <div
                  key={entry.id}
                  className={cn(
                    'rounded-lg border p-2.5 group transition-colors',
                    theme === 'dark'
                      ? 'bg-gray-900/60 border-gray-700 hover:border-gray-500'
                      : theme === 'soft'
                        ? 'bg-stone-50 border-stone-300 hover:border-stone-400'
                        : 'bg-gray-50 border-gray-200 hover:border-gray-300'
                  )}
                >
                  {/* Expression */}
                  <div
                    className={cn(
                      'text-[10px] font-mono truncate mb-1',
                      theme === 'dark' ? 'text-gray-400' : 'text-gray-500'
                    )}
                    dir="ltr" title={entry.expression}
                  >
                    {entry.expression}
                  </div>
                  {/* Result row */}
                  <div className={cn(
                    'flex items-center justify-between gap-1',
                    isAr ? 'flex-row-reverse' : ''
                  )}>
                    <span
                      className={cn(
                        'font-bold font-mono text-sm truncate',
                        theme === 'dark' ? 'text-white' : 'text-gray-900'
                      )}
                      dir="ltr"
                    >
                      {entry.result}
                    </span>
                    <div className={cn(
                      'flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0',
                      isAr ? 'flex-row-reverse' : ''
                    )}>
                      <button
                        type="button"
                        onClick={() => copyText(entry.result, entry.id)}
                        className={cn(
                          'flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded transition-colors',
                          theme === 'dark'
                            ? 'text-gray-400 hover:text-white hover:bg-white/10'
                            : 'text-gray-500 hover:text-gray-900 hover:bg-gray-200'
                        )}
                        title={isAr ? 'نسخ' : 'Copy'}
                      >
                        {copied === entry.id
                          ? <Check size={10} className="text-green-500" />
                          : <Copy size={10} />}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setDisplay(entry.result);
                          setWaitNext(false);
                          setOperand(null); setOperator(null); setExpression('');
                          setShowHistory(false);
                        }}
                        className={cn(
                          'text-[10px] px-1.5 py-0.5 rounded transition-colors',
                          theme === 'dark'
                            ? 'text-blue-400 hover:text-white hover:bg-blue-600/30'
                            : 'text-blue-600 hover:text-white hover:bg-blue-600'
                        )}
                        title={isAr ? 'استخدام' : 'Use'}
                      >
                        {isAr ? 'استخدام' : 'Use'}
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
            <div ref={historyEndRef} />
          </div>
        </div>
      )}

    </div>
  );
}
