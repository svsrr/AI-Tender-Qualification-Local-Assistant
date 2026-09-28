import React, { useState, useRef, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import {
  Cloud,
  RefreshCw,
  UploadCloud,
  DownloadCloud,
  LogIn,
  LogOut,
  User as UserIcon,
  CheckCircle2,
  AlertTriangle,
  Database,
  FileSpreadsheet,
  FileText,
  HelpCircle,
  X,
  ExternalLink,
} from 'lucide-react';

export const CloudSyncIndicator: React.FC = () => {
  const {
    firebaseUser,
    cloudSyncStatus,
    lastCloudSync,
    cloudSyncError,
    saveToCloud,
    restoreFromCloud,
    signInWithGoogleUser,
    signOutUser,
    ioclBidders,
    documents,
    technicalQueries,
  } = useApp();

  const [isOpen, setIsOpen] = useState(false);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleManualSave = async () => {
    setIsBusy(true);
    setActionSuccess(null);
    const success = await saveToCloud();
    setIsBusy(false);
    if (success) {
      setActionSuccess('Extracted data successfully saved to Firebase Firestore!');
      setTimeout(() => setActionSuccess(null), 4000);
    }
  };

  const handleManualRestore = async () => {
    if (!window.confirm('Restore saved data from cloud? This will refresh your current evaluation.')) {
      return;
    }
    setIsBusy(true);
    setActionSuccess(null);
    const success = await restoreFromCloud();
    setIsBusy(false);
    if (success) {
      setActionSuccess('Data successfully restored from Firebase Cloud!');
      setTimeout(() => setActionSuccess(null), 4000);
    }
  };

  const handleGoogleSignIn = async () => {
    setIsBusy(true);
    setActionSuccess(null);
    try {
      await signInWithGoogleUser();
      setActionSuccess('Signed in with Google successfully!');
      setTimeout(() => setActionSuccess(null), 4000);
    } catch (e: any) {
      // Handled in context
    } finally {
      setIsBusy(false);
    }
  };

  const getStatusBadge = () => {
    if (isBusy || cloudSyncStatus === 'saving' || cloudSyncStatus === 'syncing') {
      return (
        <span className="flex items-center gap-1.5 text-[11px] font-medium text-amber-300 bg-amber-950/60 border border-amber-500/30 px-2.5 py-1 rounded-full animate-pulse shadow-2xs">
          <RefreshCw className="w-3 h-3 animate-spin text-amber-300" />
          <span>{cloudSyncStatus === 'saving' ? 'Saving...' : 'Syncing...'}</span>
        </span>
      );
    }

    if (cloudSyncStatus === 'error') {
      return (
        <span className="flex items-center gap-1.5 text-[11px] font-medium text-rose-300 bg-rose-950/60 border border-rose-500/30 px-2.5 py-1 rounded-full shadow-2xs">
          <AlertTriangle className="w-3 h-3 text-rose-400" />
          <span>Sync Issue</span>
        </span>
      );
    }

    if (firebaseUser) {
      return (
        <span className="flex items-center gap-1.5 text-[11px] font-medium text-emerald-400 bg-emerald-950/60 border border-emerald-500/30 px-2.5 py-1 rounded-full shadow-2xs">
          <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
          <span>{firebaseUser.isAnonymous ? 'Guest Cloud' : 'Google Synced'}</span>
        </span>
      );
    }

    return (
      <span className="flex items-center gap-1.5 text-[11px] font-medium text-slate-300 bg-slate-800 border border-slate-700 px-2.5 py-1 rounded-full">
        <Cloud className="w-3 h-3 text-slate-400" />
        <span>Local / Cloud</span>
      </span>
    );
  };

  const isGoogleAuthenticated = Boolean(firebaseUser && !firebaseUser.isAnonymous && firebaseUser.email);

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Trigger Button in Header */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center space-x-2 bg-slate-800 hover:bg-slate-750 border border-slate-700/80 hover:border-slate-600 px-2.5 py-1.5 rounded-lg text-xs transition shadow-2xs"
        title="Cloud Sync"
      >
        <Cloud className="w-3.5 h-3.5 text-blue-400" />
        <span className="hidden sm:inline text-slate-200 font-semibold">Firestore</span>
        {getStatusBadge()}
      </button>

      {/* Popover Card */}
      {isOpen && (
        <div className="absolute right-0 mt-2 w-84 sm:w-96 bg-slate-900 border border-slate-700/90 rounded-xl shadow-2xl z-50 p-4 text-white text-xs space-y-3.5 animate-in fade-in slide-in-from-top-2 duration-150">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-400">
                <Database className="w-4 h-4" />
              </div>
              <div>
                <h4 className="font-bold text-slate-100 text-sm">Cloud Storage</h4>
                <p className="text-[10px] text-slate-400">Your data, synced securely</p>
              </div>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="text-slate-400 hover:text-white p-1 rounded hover:bg-slate-800"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* User Account Info */}
          <div className="bg-slate-950/70 p-3 rounded-lg border border-slate-800 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-slate-400 flex items-center gap-1.5">
                <UserIcon className="w-3.5 h-3.5 text-blue-400" />
                <span>Account Status:</span>
              </span>
              <span
                className={`text-[10px] uppercase font-mono px-2 py-0.5 rounded font-bold border ${
                  isGoogleAuthenticated
                    ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                    : firebaseUser
                    ? 'bg-blue-500/10 text-blue-300 border-blue-400/20'
                    : 'bg-slate-800 text-slate-300 border-slate-700'
                }`}
              >
                {isGoogleAuthenticated
                  ? 'Signed In'
                  : firebaseUser
                  ? 'Guest'
                  : 'Ready'}
              </span>
            </div>

            <div className="text-[11px] font-mono text-slate-300 truncate">
              {isGoogleAuthenticated ? (
                <span className="text-emerald-300 font-semibold">{firebaseUser?.email}</span>
              ) : firebaseUser?.uid ? (
                <span className="text-slate-400">UID: {firebaseUser.uid.slice(0, 16)}...</span>
              ) : (
                <span className="text-slate-400">Sign in to sync</span>
              )}
            </div>

            {lastCloudSync && (
              <div className="text-[10px] text-slate-400 flex items-center justify-between pt-1 border-t border-slate-850">
                <span>Last Cloud Sync:</span>
                <span className="font-mono text-slate-300">{new Date(lastCloudSync).toLocaleTimeString()}</span>
              </div>
            )}
          </div>

          {/* Extracted Data Stats */}
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="bg-slate-800/60 p-2 rounded-lg border border-slate-700/60">
              <div className="flex items-center justify-center text-blue-400 mb-1">
                <FileSpreadsheet className="w-3.5 h-3.5" />
              </div>
              <div className="font-bold text-sm text-slate-100">{ioclBidders.length}</div>
              <div className="text-[10px] text-slate-400">Bidders</div>
            </div>

            <div className="bg-slate-800/60 p-2 rounded-lg border border-slate-700/60">
              <div className="flex items-center justify-center text-emerald-400 mb-1">
                <FileText className="w-3.5 h-3.5" />
              </div>
              <div className="font-bold text-sm text-slate-100">{documents.length}</div>
              <div className="text-[10px] text-slate-400">Documents</div>
            </div>

            <div className="bg-slate-800/60 p-2 rounded-lg border border-slate-700/60">
              <div className="flex items-center justify-center text-amber-400 mb-1">
                <HelpCircle className="w-3.5 h-3.5" />
              </div>
              <div className="font-bold text-sm text-slate-100">{technicalQueries.length}</div>
              <div className="text-[10px] text-slate-400">Queries</div>
            </div>
          </div>

          {/* Notification Messages */}
          {actionSuccess && (
            <div className="p-2.5 bg-emerald-950/80 border border-emerald-500/40 rounded-lg text-[11px] text-emerald-200 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>{actionSuccess}</span>
            </div>
          )}

          {cloudSyncError && (
            <div className="p-2.5 bg-rose-950/80 border border-rose-500/40 rounded-lg text-[11px] text-rose-200 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
              <span className="leading-tight">{cloudSyncError}</span>
            </div>
          )}

          {/* Action Buttons */}
          <div className="space-y-2 pt-1">
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={handleManualSave}
                disabled={isBusy}
                className="w-full px-3 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 text-white rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition shadow-sm"
              >
                <UploadCloud className="w-3.5 h-3.5" />
                <span>Save to Cloud</span>
              </button>

              <button
                onClick={handleManualRestore}
                disabled={isBusy}
                className="w-full px-3 py-2 bg-slate-800 hover:bg-slate-750 disabled:bg-slate-850 text-slate-200 border border-slate-700 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition"
              >
                <DownloadCloud className="w-3.5 h-3.5" />
                <span>Restore Data</span>
              </button>
            </div>

            {/* Auth Action */}
            {!isGoogleAuthenticated ? (
              <div className="space-y-1.5">
                <button
                  onClick={handleGoogleSignIn}
                  disabled={isBusy}
                  className="w-full px-3 py-2 bg-white hover:bg-slate-100 text-slate-900 rounded-lg text-xs font-bold flex items-center justify-center gap-2 transition shadow-md"
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24">
                    <path
                      fill="#4285F4"
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    />
                    <path
                      fill="#34A853"
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                    />
                    <path
                      fill="#EA4335"
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                    />
                  </svg>
                  <span>Login with Google</span>
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-between pt-1">
                <span className="text-[11px] text-emerald-400 font-medium truncate max-w-[170px]">
                  {firebaseUser?.displayName || firebaseUser?.email || 'Guest Session'}
                </span>
                <button
                  onClick={signOutUser}
                  className="px-2.5 py-1 bg-slate-800 hover:bg-slate-750 text-slate-300 hover:text-white border border-slate-700 rounded text-xs flex items-center gap-1 transition"
                >
                  <LogOut className="w-3 h-3 text-slate-400" />
                  <span>Sign Out</span>
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
