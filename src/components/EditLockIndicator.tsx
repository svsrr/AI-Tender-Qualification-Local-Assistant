import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { Pencil, Eye, Lock, Unlock, Loader2 } from 'lucide-react';

export const EditLockIndicator: React.FC = () => {
  const { firebaseUser, activeTenderId, editLock, canEditActiveTender, claimTenderEditLock, releaseTenderEditLock } = useApp();
  const [isBusy, setIsBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!firebaseUser || !activeTenderId) return null;

  const isHeldByMe = !!editLock && editLock.uid === firebaseUser.uid;

  const handleClaim = async () => {
    setIsBusy(true);
    setErrorMsg(null);
    const result = await claimTenderEditLock();
    if (!result.success) {
      setErrorMsg(result.heldByName ? `Currently being edited by ${result.heldByName}` : 'Could not claim edit mode');
      setTimeout(() => setErrorMsg(null), 4000);
    }
    setIsBusy(false);
  };

  const handleRelease = async () => {
    setIsBusy(true);
    await releaseTenderEditLock();
    setIsBusy(false);
  };

  if (isHeldByMe) {
    return (
      <button
        onClick={handleRelease}
        disabled={isBusy}
        title="You're editing this tender — click to release edit mode for others"
        className="flex items-center gap-1.5 bg-emerald-950/60 hover:bg-emerald-900/60 border border-emerald-500/30 px-2.5 py-1.5 rounded-lg text-xs transition shadow-2xs"
      >
        {isBusy ? <Loader2 className="w-3.5 h-3.5 text-emerald-400 animate-spin" /> : <Pencil className="w-3.5 h-3.5 text-emerald-400" />}
        <span className="hidden sm:inline text-emerald-300 font-semibold">Editing (You)</span>
      </button>
    );
  }

  if (!canEditActiveTender && editLock) {
    return (
      <div
        title={`${editLock.name} is currently editing this tender — you have view-only access`}
        className="flex items-center gap-1.5 bg-amber-950/60 border border-amber-500/30 px-2.5 py-1.5 rounded-lg text-xs shadow-2xs"
      >
        <Eye className="w-3.5 h-3.5 text-amber-400" />
        <span className="hidden sm:inline text-amber-300 font-semibold truncate max-w-[120px]">View Only ({editLock.name})</span>
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        onClick={handleClaim}
        disabled={isBusy}
        title="Claim edit mode for this tender — others will be view-only until you release it"
        className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-750 border border-slate-700/80 hover:border-blue-500/40 px-2.5 py-1.5 rounded-lg text-xs transition shadow-2xs"
      >
        {isBusy ? <Loader2 className="w-3.5 h-3.5 text-slate-400 animate-spin" /> : <Unlock className="w-3.5 h-3.5 text-blue-400" />}
        <span className="hidden sm:inline text-slate-200 font-semibold">Claim Edit Mode</span>
      </button>
      {errorMsg && (
        <div className="absolute right-0 mt-1.5 w-56 bg-rose-950/95 border border-rose-500/40 rounded-lg p-2 text-[11px] text-rose-200 shadow-xl z-50 flex items-center gap-1.5">
          <Lock className="w-3.5 h-3.5 text-rose-400 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}
    </div>
  );
};
