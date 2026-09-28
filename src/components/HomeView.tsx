import React from 'react';
import { useApp } from '../context/AppContext';
import {
  Building2,
  Plus,
  Clock,
  FileText,
  ArrowRight,
  Trash2,
  Table,
  HelpCircle,
  FolderPlus,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  Users,
} from 'lucide-react';

// Set to true to bring back the delete button on the tender cards.
const ALLOW_TENDER_DELETE = false;

export const HomeView: React.FC = () => {
  const {
    savedTenders,
    setActiveTenderId,
    activeTenderId,
    clearAllDataAndStartFresh,
    deleteTender,
    ioclMetadata,
    ioclBidders,
    criteria,
    technicalQueries,
    setActiveTab,
  } = useApp();

  const handleStartNew = () => {
    if (
      ioclBidders.length > 0 &&
      !window.confirm('Start a new tender evaluation? The current tender stays saved and can be reopened from Home.')
    ) {
      return;
    }
    clearAllDataAndStartFresh();
    setActiveTab('onboarding');
  };

  // The open tender, shown even before its first cloud save puts it in savedTenders. Only a
  // real tender id counts: a card built from the ref alone looked like the shared tender
  // with that ref while being a different workspace.
  const activeTenderObj = activeTenderId
    ? {
        id: activeTenderId,
        ref: ioclMetadata?.tenderNo || criteria?.tenderRef || activeTenderId,
        title:
          ioclMetadata?.jobName ||
          criteria?.tenderTitle ||
          'Insulation Jobs for M&I Shutdown at Paradip Refinery',
        clientOrg: ioclMetadata?.refineryUnit || criteria?.clientOrg || 'Indian Oil Corporation Limited',
        lastModified: new Date().toISOString(),
        biddersCount: ioclBidders.length,
        openQueriesCount: technicalQueries.filter((q) => q.status !== 'Closed / Accepted').length,
        estimatedCostCr: criteria?.estimatedCostCr || 0,
        isConfigured: criteria?.isConfigured ?? true,
      }
    : null;

  // Combine savedTenders with current active tender, avoiding duplicates
  const allTenders = [...savedTenders];
  if (activeTenderObj && !allTenders.some((t) => t.id === activeTenderObj.id)) {
    allTenders.unshift(activeTenderObj);
  }

  return (
    <div className="flex-1 overflow-y-auto p-6 bg-slate-50 min-h-full">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Top Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
              <Building2 className="w-6 h-6 text-blue-600" />
              <span>Tender Workspaces</span>
            </h1>
            <p className="text-slate-500 text-xs mt-1">
              Manage and switch between your active technical evaluations.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleStartNew}
              className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-xs shadow-md transition"
            >
              <Plus className="w-4 h-4" />
              <span>+ New Evaluation</span>
            </button>
          </div>
        </div>

        {/* Active Tender Spotlight Banner (if active evaluation is present) */}
        {activeTenderObj && (
          <div className="bg-slate-900 rounded-2xl p-6 text-white shadow-lg border border-slate-800 relative overflow-hidden">
            <div className="relative z-10 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    Active Workspace
                  </span>
                  <span className="px-2.5 py-0.5 rounded-md text-[10px] font-bold bg-blue-500/15 text-blue-300 border border-blue-400/25 font-mono">
                    Ref: {activeTenderObj.ref}
                  </span>
                </div>

                <div className="text-xs text-slate-300 font-mono tabular-nums">
                  {ioclBidders.length} Bidders • {activeTenderObj.openQueriesCount} Technical Queries
                </div>
              </div>

              <div>
                <h2 className="text-lg md:text-xl font-bold text-white tracking-tight">
                  {activeTenderObj.title}
                </h2>
                <p className="text-xs text-slate-300 mt-1 flex items-center gap-2">
                  <span className="font-medium text-slate-200">{activeTenderObj.clientOrg}</span>
                  <span className="text-slate-500">•</span>
                  <span className="text-slate-400">Technical Evaluation in Progress</span>
                </p>
              </div>

              {/* Quick Actions Row */}
              <div className="pt-2 flex flex-wrap items-center gap-2.5">
                <button
                  onClick={() => setActiveTab('evaluation-sheet')}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 active:scale-[0.98] text-white rounded-xl text-xs font-bold shadow-sm transition-all flex items-center gap-2 focus-visible:ring-2 focus-visible:ring-blue-400"
                >
                  <Table className="w-4 h-4" />
                  <span>Open TBA Sheet</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>

                <button
                  onClick={() => setActiveTab('onboarding')}
                  className="px-3.5 py-2 bg-slate-800 hover:bg-slate-750 text-slate-200 border border-slate-700/80 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 focus-visible:ring-2 focus-visible:ring-slate-400"
                >
                  <FolderPlus className="w-4 h-4 text-blue-400" />
                  <span>Tender Setup</span>
                </button>

                <button
                  onClick={() => setActiveTab('technical-queries')}
                  className="px-3.5 py-2 bg-slate-800 hover:bg-slate-750 text-amber-300 border border-slate-700/80 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 focus-visible:ring-2 focus-visible:ring-amber-400"
                >
                  <HelpCircle className="w-4 h-4 text-amber-400" />
                  <span>Technical Queries ({activeTenderObj.openQueriesCount})</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Workspace Cards Grid */}
        <div className="space-y-3">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
            Your Evaluations ({allTenders.length})
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {allTenders.length === 0 && (
              <div className="col-span-full py-12 text-center bg-white rounded-2xl border border-slate-200 border-dashed p-8">
                <FileText className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                <h3 className="text-base font-bold text-slate-800">No active tenders</h3>
                <p className="text-slate-500 text-xs mb-4">
                  Start a new evaluation to begin processing NITs and analyzing bids.
                </p>
                <button
                  onClick={handleStartNew}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg text-xs transition shadow-sm"
                >
                  <Plus className="w-4 h-4" />
                  <span>Start New Evaluation</span>
                </button>
              </div>
            )}

            {allTenders.map((tender) => {
              // Matched by id only: two tenders can share a ref, and only one of them is open.
              const isActive = !!activeTenderId && tender.id === activeTenderId;
              const bidderCount = isActive ? ioclBidders.length : (tender.biddersCount ?? 0);

              return (
                <div
                  key={tender.id}
                  className={`relative group p-5 rounded-2xl border transition-all duration-200 flex flex-col justify-between ${
                    isActive
                      ? 'bg-blue-50/70 border-blue-300 shadow-sm ring-1 ring-blue-300/50'
                      : 'bg-white border-slate-200/90 shadow-2xs hover:shadow-md hover:border-slate-300'
                  }`}
                >
                  {isActive && (
                    <span className="absolute -top-2.5 right-4 bg-emerald-600 text-white text-[10px] font-bold px-2.5 py-0.5 rounded-full shadow-xs tracking-wider uppercase">
                      ACTIVE
                    </span>
                  )}

                  <div className="space-y-3">
                    <div className="flex justify-between items-start">
                      <div className="p-2.5 bg-blue-100/70 text-blue-800 rounded-xl">
                        <Building2 className="w-5 h-5" />
                      </div>
                      {/* Deleting tenders is switched off for now: every tender is shared by the team. */}
                      {ALLOW_TENDER_DELETE && !isActive && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (window.confirm('Delete this tender workspace record?')) {
                              deleteTender(tender.id);
                            }
                          }}
                          className="text-slate-400 hover:text-rose-600 p-1 rounded-lg transition opacity-0 group-hover:opacity-100"
                          title="Delete Workspace Record"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>

                    <div className="space-y-1">
                      <div className="font-mono text-[11px] font-bold text-blue-900">
                        Ref: {tender.ref || tender.id}
                      </div>
                      <h3 className="font-bold text-slate-900 text-sm leading-snug line-clamp-2" title={tender.title}>
                        {tender.title}
                      </h3>
                      <div className="text-xs text-slate-500 truncate">{tender.clientOrg}</div>
                    </div>

                    <div className="flex items-center gap-2 pt-1">
                      <span className="px-2 py-0.5 bg-slate-100 text-slate-700 text-[10px] font-bold rounded-md tabular-nums">
                        {bidderCount} Bidder{bidderCount !== 1 ? 's' : ''}
                      </span>
                      {isActive && (
                        <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 text-[10px] font-bold rounded-md">
                          In Progress
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-4 mt-4 border-t border-slate-100 text-xs">
                    <div className="flex items-center text-[10px] text-slate-400 tabular-nums">
                      <Clock className="w-3 h-3 mr-1" />
                      {new Date(tender.lastModified).toLocaleDateString()}
                    </div>

                    {isActive ? (
                      <button
                        onClick={() => setActiveTab('evaluation-sheet')}
                        className="flex items-center gap-1 font-bold text-blue-600 hover:text-blue-800 transition-colors focus-visible:ring-1 focus-visible:ring-blue-500 rounded"
                      >
                        <span>View Evaluation</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    ) : (
                      <button
                        onClick={() => {
                          setActiveTenderId(tender.id as any);
                          setActiveTab('evaluation-sheet');
                        }}
                        className="flex items-center gap-1 font-bold text-slate-700 hover:text-blue-600 transition-colors focus-visible:ring-1 focus-visible:ring-blue-500 rounded"
                      >
                        <span>Open Workspace</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
