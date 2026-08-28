import './init/uiSoundBridge';
import { StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { LanguageProvider } from './context/LanguageContext';
import { ConfirmDialogProvider } from './context/ConfirmDialogContext';
import { OperationProgressProvider } from './context/OperationProgressContext';
import { AppPermissionsRoot } from './context/PermissionsContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ThemedToaster } from './components/ThemedToaster';
import { enforceDevLocalhostOrigin } from './lib/devOriginGuard';
import { clearChunkReloadFlag } from './lib/lazyImport';
import { startSpaUpdateWatcher } from './lib/spaBuild';
import { installExcelLikeInputBehavior } from './lib/excelLikeInputs';
import { MobileApprovalApp } from './pages/mobile/MobileApprovalApp';

enforceDevLocalhostOrigin();
clearChunkReloadFlag();
startSpaUpdateWatcher();

const uninstallExcelLikeInputs = installExcelLikeInputBehavior();
if (import.meta.hot) {
  import.meta.hot.dispose(() => uninstallExcelLikeInputs());
}

function RootApp() {
  if (typeof window !== 'undefined' && window.location.pathname.startsWith('/m')) {
    return <MobileApprovalApp />;
  }
  return <App />;
}

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element #root not found');
}

/** Reuse the same React root across Vite HMR re-runs of this module. */
type HotData = { root?: Root };
const hot = import.meta.hot;
const hotData = (hot?.data ?? {}) as HotData;
const root = hotData.root ?? createRoot(container);
if (hot) {
  hot.data.root = root;
}

root.render(
  <StrictMode>
    <ErrorBoundary>
      <LanguageProvider>
        <ConfirmDialogProvider>
          <OperationProgressProvider>
            <AppPermissionsRoot>
              <RootApp />
              <ThemedToaster />
            </AppPermissionsRoot>
          </OperationProgressProvider>
        </ConfirmDialogProvider>
      </LanguageProvider>
    </ErrorBoundary>
  </StrictMode>,
);
