import toast from 'react-hot-toast';
import {
  unlockAudio,
  playToastSuccess,
  playToastError,
  playWarning,
  playModalOpen,
  playModalClose,
} from '../lib/uiSound';

function looksLikeModalOverlay(el: Element): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const c = el.className;
  if (typeof c !== 'string') return false;
  return (
    c.includes('fixed') &&
    c.includes('inset-0') &&
    (c.includes('z-50') || c.includes('z-[60') || c.includes('z-[100') || c.includes('z-[70'))
  );
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

function setupModalObserver(): void {
  let overlayCount = 0;

  const bumpAdd = (node: Node) => {
    if (node instanceof HTMLElement && looksLikeModalOverlay(node)) {
      overlayCount += 1;
      if (overlayCount === 1) playModalOpen();
    }
  };

  const bumpRemove = (node: Node) => {
    if (node instanceof HTMLElement && looksLikeModalOverlay(node)) {
      overlayCount = Math.max(0, overlayCount - 1);
      if (overlayCount === 0) playModalClose();
    }
  };

  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      m.addedNodes.forEach(bumpAdd);
      m.removedNodes.forEach(bumpRemove);
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

if (typeof window !== 'undefined') {
  unlockAudio();
  patchToast();
  patchDialogs();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setupModalObserver(), { once: true });
  } else {
    setupModalObserver();
  }
}
