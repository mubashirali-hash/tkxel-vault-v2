import React, { Component, ErrorInfo, ReactNode } from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App.js';
import './styles/index.css';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

class ErrorBoundary extends Component<Props, State> {
  public state: State = { hasError: false };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error in tkxel Vault UI:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            display: 'flex',
            height: '100vh',
            width: '100vw',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '24px',
            backgroundColor: '#F8FAFC',
            fontFamily: 'var(--font-sans)',
            color: '#0F172A',
            textAlign: 'center',
          }}
        >
          <div
            style={{
              maxWidth: '520px',
              width: '100%',
              backgroundColor: '#FFFFFF',
              padding: '36px',
              borderRadius: '12px',
              border: '1px solid #E2E8F0',
              boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.1)',
            }}
          >
            <div
              style={{
                width: '42px',
                height: '42px',
                borderRadius: '8px',
                backgroundColor: '#FEE2E2',
                color: '#DC2626',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 16px',
                fontWeight: 800,
                fontSize: '1.2rem',
              }}
            >
              !
            </div>
            <h2 style={{ fontSize: '1.3rem', fontWeight: 800, color: '#0F172A', margin: '0 0 8px' }}>
              Application Render Recovery
            </h2>
            <p style={{ fontSize: '0.86rem', color: '#475569', margin: '0 0 20px', lineHeight: 1.5 }}>
              {this.state.error?.message || 'An unexpected error occurred during rendering.'}
            </p>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
              <button
                onClick={() => window.location.reload()}
                style={{
                  padding: '9px 18px',
                  backgroundColor: '#0755E9',
                  color: '#FFFFFF',
                  border: 'none',
                  borderRadius: '6px',
                  fontWeight: 600,
                  fontSize: '0.82rem',
                  cursor: 'pointer',
                }}
              >
                Reload Application
              </button>
              <button
                onClick={() => {
                  localStorage.clear();
                  window.location.reload();
                }}
                style={{
                  padding: '9px 18px',
                  backgroundColor: '#F1F5F9',
                  color: '#475569',
                  border: '1px solid #E2E8F0',
                  borderRadius: '6px',
                  fontWeight: 600,
                  fontSize: '0.82rem',
                  cursor: 'pointer',
                }}
              >
                Clear Local Storage & Reload
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
