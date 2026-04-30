import React, { useState, useRef, useEffect, useMemo } from 'react';
import { ChevronDown, Search, X } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface SelectOption {
  value: string;
  label: string;
  secondary?: string; // e.g. account code shown in muted colour
}

interface Props {
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  theme: string;
  dir?: string;
  className?: string;
}

export function SearchableSelect({ options, value, onChange, placeholder, theme, dir, className }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const isRtl = dir === 'rtl';
  const defaultPlaceholder = placeholder ?? (isRtl ? '--- اختر ---' : '--- Select ---');
  const searchPlaceholder = isRtl ? 'ابحث بالاسم أو الرقم…' : 'Search by name or code…';
  const noResults = isRtl ? 'لا توجد نتائج' : 'No results';

  const selected = options.find(o => o.value === value);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      o => o.label.toLowerCase().includes(q) || o.secondary?.toLowerCase().includes(q)
    );
  }, [options, query]);

  // close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // focus search input when dropdown opens
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // auto-select when exactly one result remains
  useEffect(() => {
    if (open && query.trim() && filtered.length === 1) {
      handleSelect(filtered[0].value);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered]);

  const handleSelect = (val: string) => {
    onChange(val);
    setOpen(false);
    setQuery('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { setOpen(false); setQuery(''); }
  };

  const triggerCls = cn(
    'w-full flex items-center justify-between px-4 py-2 rounded-lg border transition-all outline-none cursor-pointer',
    open ? 'ring-2 ring-blue-500 border-blue-500' : '',
    theme === 'dark'
      ? 'bg-gray-900 border-gray-800 text-white hover:border-gray-700'
      : 'bg-gray-50 border-gray-200 text-gray-900 hover:border-gray-300'
  );

  const dropdownCls = cn(
    'absolute z-50 mt-1 w-full rounded-xl border shadow-2xl overflow-hidden',
    theme === 'dark' ? 'bg-[#1a1d23] border-gray-700' : 'bg-white border-gray-200'
  );

  const optionCls = (isSelected: boolean) => cn(
    'w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors',
    isRtl ? 'text-right' : 'text-left',
    isSelected
      ? 'bg-blue-600 text-white'
      : theme === 'dark' ? 'text-gray-300 hover:bg-gray-800' : 'text-gray-700 hover:bg-gray-50'
  );

  return (
    <div ref={containerRef} className={cn('relative', className)} dir={dir}>
      {/* Trigger button */}
      <button type="button" className={triggerCls} onClick={() => setOpen(o => !o)}>
        {selected ? (
          <span className="flex items-center gap-2 min-w-0">
            {selected.secondary && (
              <span className="font-mono text-xs text-blue-400 shrink-0">{selected.secondary}</span>
            )}
            <span className="font-medium truncate">{selected.label}</span>
          </span>
        ) : (
          <span className="text-gray-400 text-sm">{defaultPlaceholder}</span>
        )}
        <ChevronDown
          size={16}
          className={cn('transition-transform text-gray-400 shrink-0', open && 'rotate-180')}
        />
      </button>

      {/* Dropdown */}
      {open && (
        <div className={dropdownCls}>
          {/* Search input row */}
          <div
            className={cn(
              'flex items-center gap-2 px-3 py-2 border-b',
              theme === 'dark' ? 'border-gray-700' : 'border-gray-100'
            )}
          >
            <Search size={14} className="text-gray-400 shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={searchPlaceholder}
              className={cn(
                'flex-1 text-sm outline-none bg-transparent',
                theme === 'dark' ? 'text-white placeholder-gray-600' : 'text-gray-900 placeholder-gray-400'
              )}
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label={isRtl ? 'مسح البحث' : 'Clear search'}
                className="text-gray-400 hover:text-gray-200 transition-colors"
              >
                <X size={14} />
              </button>
            )}
          </div>

          {/* Options */}
          <div className="max-h-64 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-gray-500">{noResults}</div>
            ) : (
              filtered.map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => handleSelect(opt.value)}
                  className={optionCls(value === opt.value)}
                >
                  {opt.secondary && (
                    <span
                      className={cn(
                        'font-mono text-xs shrink-0',
                        value === opt.value ? 'text-blue-200' : 'text-blue-400'
                      )}
                    >
                      {opt.secondary}
                    </span>
                  )}
                  <span className="font-medium">{opt.label}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
