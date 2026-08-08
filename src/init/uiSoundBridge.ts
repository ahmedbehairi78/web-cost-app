import toast from 'react-hot-toast';
import {
  unlockAudio,
  playToastSuccess,
  playToastError,
  playWarning,
  playModalOpen,
  playModalClose,
} from '../lib/uiSound';

/**
 * Ref-counted modal sounds — call from portals/dialogs instead of a document-wide
 * MutationObserver (subtree observers were a major Electron/main-thread lag source).
 */
let modalOpenDepth = 0;

export function notifyUiModalOpen(): void {
  modalOpenDepth += 1;
  if (modalOpenDepth === 1) playModalOpen();
}

export function notifyUiModalClose(): void {
  if (modalOpenDepth <= 0) return;
  modalOpenDepth -= 1;
  if (modalOpenDepth === 0) playModalClose();
}

/** Test / HMR helper — do not use in product UI. */
export function resetUiModalSoundDepth(): void {
  modalOpenDepth = 0;
}

function patchToast(): void {
  const origSuccess = toast.success.bind(toast);
  const origError = toast.error.bind(toast);

  toast.success = ((message, options) => {
    playToastSuccess();
    return origSuccess(message, options);
  }) as typeof toast.success;

  toast.error = ((message, options) => {
    playToastError();
    return origError(message, options);
  }) as typeof toast.error;
}

function patchDialogs(): void {
  const c = window.confirm.bind(window);
  const a = window.alert.bind(window);
  window.confirm = (message?: string) => {
    playWarning();
    return c(message);
  };
  window.alert = (message?: string) => {
    playToastError();
    return a(message);
  };
}

if (typeof window !== 'undefined') {
  unlockAudio();
  patchToast();
  patchDialogs();
}
