'use client';

import { useState } from 'react';
import { HeartHandshake, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/Card';

// PR-NURTURE — "Mark not ready" control on the lead detail page. Starts the
// post-FREE_15 nurture sequence (4 emails + 3 call tasks / 21 days → monthly
// newsletter). Action-only: the backend enforces the preconditions (a completed
// FREE_15, not already enrolled, not unsubscribed) and returns a clear message.
export function NurtureControl({ leadId }: { leadId: string }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<null | 'enroll' | 'stop'>(null);

  const enroll = async () => {
    setBusy('enroll');
    try {
      await api.post('/staff/nurture/enroll', { leadId, reason: reason || undefined });
      toast.success('Nurture sequence started — Day 1 email + call tasks will follow the 21-day schedule.');
      setReason('');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not start nurture');
    } finally { setBusy(null); }
  };

  const stop = async () => {
    setBusy('stop');
    try {
      await api.post('/staff/nurture/stop', { leadId });
      toast.success('Nurture stopped — any open call tasks are closed.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not stop nurture');
    } finally { setBusy(null); }
  };

  return (
    <Card>
      <CardContent>
        <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500 flex items-center gap-1.5 mb-1">
          <HeartHandshake size={16} className="text-[#b8941f]" /> Nurture
        </h2>
        <p className="text-xs text-gray-400 mb-3">
          Not ready after their free consultation? Start the 21-day nurture sequence (emails + call tasks),
          then an ongoing monthly newsletter.
        </p>
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason (optional) — e.g. wants to think about cost"
          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm mb-2"
        />
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={enroll} disabled={busy !== null}
            className="inline-flex items-center gap-1.5 rounded-xl bg-[#1e3a5f] px-4 py-2 text-xs font-semibold text-white hover:bg-[#162d4a] disabled:opacity-50">
            {busy === 'enroll' ? <Loader2 size={13} className="animate-spin" /> : <HeartHandshake size={13} />}
            Mark not ready — start nurture
          </button>
          <button type="button" onClick={stop} disabled={busy !== null}
            className="rounded-xl border border-rose-200 px-4 py-2 text-xs font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-50">
            Stop nurture
          </button>
        </div>
      </CardContent>
    </Card>
  );
}
