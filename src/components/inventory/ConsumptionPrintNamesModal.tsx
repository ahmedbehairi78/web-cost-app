import React, { useState } from 'react';
import { Printer } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useLanguage } from '../../context/LanguageContext';
import {
  btnGhost,
  inputCls,
  modalCard,
  modalOverlay,
  splitLabelCls,
} from './inventoryUiShared';

export type ConsumptionPrintNames = {
  requester: string;
  receiver: string;
  storekeeper: string;
};

export function ConsumptionPrintNamesModal({
  orderNumber,
  onClose,
  onConfirm,
}: {
  orderNumber: string;
  onClose: () => void;
  onConfirm: (names: ConsumptionPrintNames) => void;
}) {
  const { theme, t, dir } = useLanguage();
  const [printNames, setPrintNames] = useState<ConsumptionPrintNames>({
    requester: '',
    receiver: '',
    storekeeper: '',
  });

  return (
    <div className={modalOverlay()} onClick={onClose}>
      <div
        className={cn(modalCard(theme), 'max-w-md w-full')}
        onClick={(e) => e.stopPropagation()}
        dir={dir}
      >
        <h3 className="font-bold text-base mb-1">{t('consume_order_print')}</h3>
        <p className={cn('text-xs mb-4', theme === 'dark' ? 'text-gray-400' : 'text-gray-600')}>
          {t('consume_order_print_names_hint')}
        </p>
        <p className={cn('text-sm font-mono mb-3', theme === 'dark' ? 'text-gray-300' : 'text-gray-700')}>
          {orderNumber}
        </p>
        <div className="space-y-3 mb-5">
          <div>
            <label className={splitLabelCls(theme)}>{t('consume_order_sign_requester')}</label>
            <input
              type="text"
              value={printNames.requester}
              onChange={(e) => setPrintNames((p) => ({ ...p, requester: e.target.value }))}
              className={inputCls(theme)}
              placeholder={t('consume_order_sign_name_ph')}
            />
          </div>
          <div>
            <label className={splitLabelCls(theme)}>{t('consume_order_sign_receiver')}</label>
            <input
              type="text"
              value={printNames.receiver}
              onChange={(e) => setPrintNames((p) => ({ ...p, receiver: e.target.value }))}
              className={inputCls(theme)}
              placeholder={t('consume_order_sign_name_ph')}
            />
          </div>
          <div>
            <label className={splitLabelCls(theme)}>{t('consume_order_sign_storekeeper')}</label>
            <input
              type="text"
              value={printNames.storekeeper}
              onChange={(e) => setPrintNames((p) => ({ ...p, storekeeper: e.target.value }))}
              className={inputCls(theme)}
              placeholder={t('consume_order_sign_name_ph')}
            />
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={btnGhost(theme)}>
            {t('cancel')}
          </button>
          <button
            type="button"
            onClick={() => onConfirm(printNames)}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-amber-600 hover:bg-amber-700 text-white inline-flex items-center gap-2"
          >
            <Printer className="w-4 h-4" />
            {t('consume_order_print_preview')}
          </button>
        </div>
      </div>
    </div>
  );
}
