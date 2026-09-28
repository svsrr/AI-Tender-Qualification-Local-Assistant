import React from 'react';
import { useApp } from '../context/AppContext';
import { CloudSyncIndicator } from './CloudSyncIndicator';
import { EditLockIndicator } from './EditLockIndicator';
import {
  Building2,
  FileCheck2,
  FolderPlus,
} from 'lucide-react';

export const Header: React.FC = () => {
  const { criteria, setActiveTab, clearAllDataAndStartFresh } = useApp();

  const handleNewEvaluation = () => {
    if (window.confirm('Start a new tender evaluation? The current tender stays saved and can be reopened from Home.')) {
      clearAllDataAndStartFresh();
      setActiveTab('onboarding');
    }
  };

  return (
    <header className="sticky top-0 z-30 bg-slate-900 border-b border-slate-800 text-white shadow-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Brand & System Title */}
          <div
            onClick={() => setActiveTab('home')}
            className="flex items-center space-x-3 cursor-pointer group"
            title="Go to Home / Workspaces"
          >
            <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center shadow-md shadow-blue-600/30 text-white border border-blue-400/30 group-hover:scale-105 transition-transform duration-150">
              <FileCheck2 className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="font-bold text-base md:text-lg tracking-tight text-white group-hover:text-blue-200 transition-colors">
                  Indian Oil Corporation Limited
                </span>
                <span className="hidden sm:inline-block text-[10px] uppercase font-bold tracking-wider bg-blue-500/15 text-blue-300 border border-blue-400/25 px-2 py-0.5 rounded-md">
                  Paradip Refinery
                </span>
              </div>
              <p className="text-xs text-slate-400 flex items-center gap-1.5">
                <span>AI Tender Qualification Assistant</span>
              </p>
            </div>
          </div>

          {/* Center Active Tender Context & New Evaluation Button */}
          <div className="hidden lg:flex items-center gap-2.5">
            <div className="flex items-center bg-slate-800/90 px-3 py-1.5 rounded-lg border border-slate-700/80 text-xs shadow-inner">
              <Building2 className="w-4 h-4 text-blue-400 mr-2 shrink-0" />
              <div className="truncate max-w-xs text-left">
                <div className="font-mono font-semibold text-slate-200 truncate">{criteria.tenderRef || 'No Active Tender'}</div>
                <div className="text-[11px] text-slate-400 truncate">{criteria.clientOrg || 'Select or create a tender'}</div>
              </div>
            </div>

            <button
              onClick={handleNewEvaluation}
              className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-500 active:scale-[0.98] text-white font-bold text-xs rounded-lg shadow-sm transition-all shrink-0 focus-visible:ring-2 focus-visible:ring-blue-400"
              title="Start a new evaluation"
            >
              <FolderPlus className="w-3.5 h-3.5 text-white" />
              <span>+ New Evaluation</span>
            </button>
          </div>

          {/* Right Controls: Edit Lock & Cloud Sync */}
          <div className="flex items-center space-x-3">
            {/* Per-Tender Edit Lock */}
            <EditLockIndicator />

            {/* Cloud Sync Status & Account */}
            <CloudSyncIndicator />

          </div>
        </div>
      </div>
    </header>
  );
};

