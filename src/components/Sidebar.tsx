import React from 'react';
import { useApp } from '../context/AppContext';
import {
  HelpCircle,
  Table,
  Home,
  ShieldCheck,
  FolderPlus,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';

export const Sidebar: React.FC = () => {
  const {
    activeTab,
    setActiveTab,
    technicalQueries,
    ioclMetadata,
    ioclBidders,
    criteria,
    isSidebarCollapsed,
    toggleSidebar,
  } = useApp();

  const openQueriesCount = technicalQueries.filter((q) => q.status !== 'Closed / Accepted').length;

  const navItems = [
    {
      id: 'home',
      label: 'Home / Tenders',
      icon: Home,
      badge: null,
    },
    {
      id: 'onboarding',
      label: 'Tender Setup',
      icon: FolderPlus,
      badge: criteria.isConfigured ? 'NIT Ready' : 'Setup',
      badgeColor: criteria.isConfigured
        ? 'bg-emerald-100 text-emerald-800 font-semibold'
        : 'bg-blue-600 text-white font-bold',
    },
    {
      id: 'evaluation-sheet',
      label: 'TBA Sheet',
      icon: Table,
      badge: `${ioclBidders.length > 0 ? `${ioclBidders.length} Bidders` : 'Scrutiny'}`,
      badgeColor: 'bg-emerald-100 text-emerald-800 font-bold',
    },
    {
      id: 'technical-queries',
      label: 'Technical Queries (TQ)',
      icon: HelpCircle,
      badge: openQueriesCount > 0 ? `${openQueriesCount} Open` : 'Nil',
      badgeColor: openQueriesCount > 0 ? 'bg-amber-100 text-amber-900 font-bold' : 'bg-slate-100 text-slate-600',
    },
  ];

  const renderNavGroup = (items: typeof navItems) =>
    items.map((item) => {
      const Icon = item.icon;
      const isActive = activeTab === item.id;

      if (isSidebarCollapsed) {
        return (
          <button
            key={item.id}
            onClick={() => setActiveTab(item.id)}
            title={`${item.label}${item.badge ? ` (${item.badge})` : ''}`}
            className={`w-full flex items-center justify-center p-2.5 rounded-lg text-xs font-semibold transition-all relative group ${
              isActive
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            <Icon className={`w-4 h-4 ${isActive ? 'text-white' : 'text-slate-400 group-hover:text-slate-700'}`} />
            {item.badge && (
              <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-blue-500 ring-2 ring-white" />
            )}
          </button>
        );
      }

      return (
        <button
          key={item.id}
          onClick={() => setActiveTab(item.id)}
          className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-semibold transition-all focus-visible:ring-2 focus-visible:ring-blue-500 ${
            isActive
              ? 'bg-blue-600 text-white shadow-sm'
              : 'text-slate-700 hover:bg-slate-100 hover:text-slate-950'
          }`}
        >
          <div className="flex items-center space-x-2.5 min-w-0">
            <Icon
              className={`w-4 h-4 shrink-0 ${
                isActive ? 'text-white' : 'text-slate-400 group-hover:text-slate-700'
              }`}
            />
            <span className="truncate">{item.label}</span>
          </div>

          {item.badge && (
            <span
              className={`px-2 py-0.5 rounded-md text-[10px] font-bold shrink-0 ${
                isActive ? 'bg-blue-700 text-white' : item.badgeColor
              }`}
            >
              {item.badge}
            </span>
          )}
        </button>
      );
    });

  return (
    <aside
      className={`bg-white border-r border-slate-200 flex flex-col shrink-0 min-h-[calc(100vh-4rem)] transition-all duration-300 ease-in-out ${
        isSidebarCollapsed ? 'w-16' : 'w-64'
      }`}
    >
      {/* Platform Sub-header & Active Tender Context */}
      <div className="p-3 border-b border-slate-100">
        <div className="flex items-center justify-between">
          {!isSidebarCollapsed && (
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
              Active Tender
            </span>
          )}
          <button
            onClick={toggleSidebar}
            className={`p-1.5 rounded-lg text-slate-500 hover:text-blue-700 hover:bg-slate-100 transition-colors shrink-0 ${
              isSidebarCollapsed ? 'mx-auto' : 'ml-auto'
            }`}
            title={isSidebarCollapsed ? 'Expand Sidebar (Wider Menu)' : 'Collapse Sidebar (More Space for TBA Sheet)'}
          >
            {isSidebarCollapsed ? (
              <PanelLeftOpen className="w-5 h-5 text-blue-600" />
            ) : (
              <PanelLeftClose className="w-4 h-4 text-slate-400 group-hover:text-blue-600" />
            )}
          </button>
        </div>

        {!isSidebarCollapsed ? (
          <div className="mt-2 space-y-2">
            <button
              onClick={() => setActiveTab('onboarding')}
              className="w-full text-left p-2.5 rounded-xl border border-blue-200/90 bg-blue-50/70 hover:bg-blue-100/70 transition-colors group text-xs shadow-2xs"
              title="Click to edit Tender Details & PQC Parameters"
            >
              <div className="flex items-center justify-between gap-1">
                <span className="font-mono text-[11px] font-bold text-blue-950 truncate">
                  {criteria.tenderRef || ioclMetadata?.tenderNo || 'NIT Pending'}
                </span>
                <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-blue-200/90 text-blue-900 shrink-0">
                  {criteria.isConfigured ? 'PQC Active' : 'Setup'}
                </span>
              </div>
              <div className="truncate text-[11px] font-medium text-slate-700 mt-1">
                {criteria.tenderTitle || ioclMetadata?.jobName || 'Configure Parameters'}
              </div>
              <div className="text-[10px] text-blue-800/80 truncate mt-0.5 flex items-center gap-1 font-medium">
                <span>{criteria.clientOrg || 'PSU Refinery'}</span>
              </div>
            </button>

            <div className="flex items-center justify-between text-xs text-slate-600 bg-slate-100/80 px-2.5 py-1.5 rounded-lg border border-slate-200/80">
              <span className="font-medium text-slate-600 text-[11px]">Phase:</span>
              <span className="px-2 py-0.5 bg-blue-100 text-blue-800 rounded font-semibold text-[10px]">
                Technical Bid (Env-1)
              </span>
            </div>
          </div>
        ) : (
          <div className="mt-2 text-center">
            <button
              onClick={() => setActiveTab('onboarding')}
              className="p-2 rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors mx-auto block"
              title={`Active Tender: ${criteria.tenderRef || ioclMetadata?.tenderNo || 'NIT Pending'}`}
            >
              <FolderPlus className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {/* Navigation List */}
      <nav className={`flex-1 ${isSidebarCollapsed ? 'px-2 py-3 space-y-3' : 'px-3 py-3 space-y-4'} overflow-y-auto`}>
        <div className="space-y-0.5">{renderNavGroup(navItems)}</div>
      </nav>

      {/* System Status Footer */}
      <div className={`p-3 border-t border-slate-200 bg-slate-50 text-[11px] text-slate-500 ${isSidebarCollapsed ? 'text-center' : ''}`}>
        {isSidebarCollapsed ? (
          <div className="flex justify-center" title="Paradip Refinery">
            <ShieldCheck className="w-5 h-5 text-blue-600" />
          </div>
        ) : (
          <>
            <div className="flex items-center gap-1.5 font-semibold text-slate-700 mb-0.5">
              <ShieldCheck className="w-3.5 h-3.5 text-blue-600" />
              <span>AI Tender Assistant</span>
            </div>
            <p className="leading-tight text-slate-400 text-[10px]">
              Paradip Refinery • AI-Powered Evaluation
            </p>
          </>
        )}
      </div>
    </aside>
  );
};
