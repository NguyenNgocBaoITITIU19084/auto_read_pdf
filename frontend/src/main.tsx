import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { AppProvider } from './context/AppContext';
import { ToastProvider } from './context/ToastContext';
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
          <ConfirmProvider>
            <App />
          </ConfirmProvider>
        </AppProvider>
      </ToastProvider>
    </ErrorBoundary>
  </React.StrictMode>
);
