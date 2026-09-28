import React, { useCallback, useEffect, useState } from 'react';
import { FlaskConical, LogIn } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { apiFetch, DEMO_USAGE_CHANGED_EVENT } from '../utils/api';

interface DemoUsage {
  limits: { extraction: number; query: number };
  used: { extraction: number; query: number };
  dailyTotalLimit: number;
  dailyTotalUsed: number;
}

// Shown to guest (demo) sessions only: how much of today's AI allowance is left, and a
// nudge to sign in with a real Google account for the full, uncapped experience.
export const DemoModeBanner: React.FC = () => {
  const { isDemoUser, signInWithGoogleUser } = useApp();
  const [usage, setUsage] = useState<DemoUsage | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await apiFetch('/api/demo-usage');
      if (!res.ok) return;
      const data = await res.json();
      if (data?.isDemoGuest) setUsage(data);
    } catch {
      // The banner still works without the counter.
    }
  }, []);

  useEffect(() => {
    if (!isDemoUser) return;
    refresh();
    // Metered calls fire this event as they are sent; refresh again once they have likely finished.
    const onChange = () => {
      refresh();
      setTimeout(refresh, 45_000);
    };
    window.addEventListener(DEMO_USAGE_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(DEMO_USAGE_CHANGED_EVENT, onChange);
  }, [isDemoUser, refresh]);

  if (!isDemoUser) return null;

  const pdfsLeft = usage ? Math.max(0, usage.limits.extraction - usage.used.extraction) : null;
  const sharedExhausted = usage ? usage.dailyTotalUsed >= usage.dailyTotalLimit : false;

  return (
    <div className="bg-gradient-to-r from-amber-50 via-amber-50/80 to-amber-100/60 border-b border-amber-200/80 px-4 py-2.5 flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs text-amber-950 print:hidden shadow-2xs">
      <div className="flex items-start md:items-center gap-2.5">
        <div className="w-7 h-7 rounded-lg bg-amber-500/15 border border-amber-500/25 flex items-center justify-center shrink-0 mt-0.5 md:mt-0 text-amber-700">
          <FlaskConical className="w-4 h-4" />
        </div>
        <p className="leading-relaxed text-amber-900">
          <span className="font-bold text-amber-950 uppercase tracking-wider text-[11px] bg-amber-200/80 px-1.5 py-0.5 rounded border border-amber-300/70 mr-1.5">
            Demo Mode
          </span>
          {pdfsLeft !== null && (
            <span className="font-semibold text-amber-950">
              {sharedExhausted ? "today's shared demo allowance is used up" : `${pdfsLeft} of ${usage!.limits.extraction} PDF extractions left today`}
              {' — '}
            </span>
          )}
          Sign in with a real Google account to test more PDFs, collaborate with your team, claim edit locks, and
          confirm TBA rows under your own name.
        </p>
      </div>
      <button
        // Signing in with Google replaces the guest session; the popup must open straight from the click.
        onClick={() => signInWithGoogleUser()}
        className="self-end md:self-auto shrink-0 flex items-center gap-1.5 px-3.5 py-1.5 bg-blue-600 hover:bg-blue-500 active:scale-[0.98] text-white font-bold rounded-lg transition-all shadow-xs focus-visible:ring-2 focus-visible:ring-blue-500"
      >
        <LogIn className="w-3.5 h-3.5" />
        Sign In with Google
      </button>
    </div>
  );
};
