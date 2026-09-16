import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { AppProvider } from './context/AppContext';
import { ToastProvider } from './context/ToastContext';
import { MobileBridgeProvider } from './context/MobileBridgeContext';
import { ConfirmProvider } from './hooks/useConfirm';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { installGlobalErrorLogging } from './services/clientLogger';
import './index.css';

installGlobalErrorLogging();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <ToastProvider>
        <AppProvider>
          <MobileBridgeProvider>
            <ConfirmProvider>
              <App />
            </ConfirmProvider>
          </MobileBridgeProvider>
        </AppProvider>
      </ToastProvider>
    </ErrorBoundary>
  </React.StrictMode>
);
