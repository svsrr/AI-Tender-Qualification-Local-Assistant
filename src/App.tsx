import React from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { TechnicalQueriesView } from './components/TechnicalQueriesView';
import { TechnicalEvaluationSheet } from './components/TechnicalEvaluationSheet';
import { TenderOnboardingWizard } from './components/TenderOnboardingWizard';
import { EmployeeIdModal } from './components/EmployeeIdModal';
import { HomeView } from './components/HomeView';
import { DemoModeBanner } from './components/DemoModeBanner';

const AppContent: React.FC = () => {
  const { activeTab, firebaseUser, authReady, signInWithGoogleUser, signInAsDemoGuest, employeeId, cloudSyncError } = useApp();
  const [googleSigningIn, setGoogleSigningIn] = React.useState(false);

  const startGoogleSignIn = async () => {
    setGoogleSigningIn(true);
    await signInWithGoogleUser();
    setGoogleSigningIn(false);
  };
  const [demoStarting, setDemoStarting] = React.useState(false);
  const [demoError, setDemoError] = React.useState<string | null>(null);

  const startDemo = async () => {
    setDemoStarting(true);
    setDemoError(null);
    const error = await signInAsDemoGuest();
    setDemoError(error);
    setDemoStarting(false);
  };

  const renderActiveView = () => {
    switch (activeTab) {
      case 'onboarding':
        return <TenderOnboardingWizard />;
      case 'evaluation-sheet':
        return <TechnicalEvaluationSheet />;
      case 'technical-queries':
        return <TechnicalQueriesView />;
      default:
        return <HomeView />;
    }
  };

  // Until Firebase reports whether a saved sign-in exists, show nothing: rendering the app
  // here would display whatever tender this browser cached, to whoever is at the screen.
  if (!authReady) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-950 text-xs font-medium text-slate-400">
        Checking sign-in…
      </div>
    );
  }

  // Signed out: only the sign-in card. The app (and any cached tender) is not rendered behind it.
  if (!firebaseUser) {
    return (
        <div className="h-screen bg-slate-950 flex items-center justify-center p-4 font-sans text-slate-900">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-md w-full p-8 text-center space-y-6">
            <div className="w-16 h-16 bg-blue-600 rounded-2xl mx-auto flex items-center justify-center text-white shadow-lg shadow-blue-500/30">
              <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
            </div>
            <div className="space-y-2">
              <h2 className="text-xl font-bold text-slate-900 tracking-tight">AI Tender Qualification Assistant</h2>
              <p className="text-xs text-slate-500 leading-relaxed">
                Sign in with your Google account to get started.
              </p>
            </div>
            <button
              onClick={startGoogleSignIn}
              disabled={googleSigningIn}
              className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-bold text-xs rounded-xl shadow-md transition flex items-center justify-center gap-3"
            >
              <svg className="w-4 h-4 bg-white rounded-full p-0.5" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.66-5.17 3.66-9.17z"/>
                <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.19v3.15C3.17 21.36 7.23 24 12 24z"/>
                <path fill="#FBBC05" d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.19C.43 8.12 0 9.87 0 12s.43 3.88 1.19 5.42l4.09-3.15z"/>
                <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.23 0 3.17 2.64 1.19 6.58l4.09 3.15c.95-2.83 3.6-4.98 6.72-4.98z"/>
              </svg>
              <span>{googleSigningIn ? 'Waiting for Google sign-in…' : 'Sign In with Google'}</span>
            </button>
            {cloudSyncError && <p className="text-[11px] text-red-600 font-medium">{cloudSyncError}</p>}

            <div className="flex items-center gap-3 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              <span className="h-px flex-1 bg-slate-200" />
              or
              <span className="h-px flex-1 bg-slate-200" />
            </div>

            <div className="space-y-2">
              <button
                onClick={startDemo}
                disabled={demoStarting}
                className="w-full py-3 bg-white hover:bg-slate-50 disabled:opacity-60 border border-slate-300 text-slate-800 font-bold text-xs rounded-xl transition"
              >
                {demoStarting ? 'Starting demo…' : 'Try the demo without an account'}
              </button>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                The demo opens a sample tender evaluation and allows 3 PDF extractions per day. Please sign in with a real
                Google account to test more PDFs, share tenders with your team, claim edit locks, and confirm TBA rows
                under your own name.
              </p>
              {demoError && <p className="text-[11px] text-red-600 font-medium">{demoError}</p>}
            </div>
            <div className="text-[10px] text-slate-400">
              Powered by Firebase & Gemini AI
            </div>
          </div>
        </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-slate-50 text-slate-900 overflow-hidden font-sans relative">
      {/* Employee ID Prompt */}
      {firebaseUser && !employeeId && <EmployeeIdModal />}

      {/* Top Application Header */}
      <Header />
      <DemoModeBanner />

      {/* Main Container: Sidebar + Content View */}
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />

        <main className="flex-1 overflow-y-auto relative bg-slate-50 print:overflow-visible">
          {renderActiveView()}
        </main>
      </div>

    </div>
  );
};

import { ErrorBoundary } from './components/ErrorBoundary';

export default function App() {
  return (
    <ErrorBoundary>
      <AppProvider>
        <AppContent />
      </AppProvider>
    </ErrorBoundary>
  );
}
