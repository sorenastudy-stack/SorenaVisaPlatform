'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, Check, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';

// PR-HANDOFF — in-app notifications.
//
// Polling, not SSE or websockets: nothing in this stack carries a live
// connection today, and a handoff is not a message that needs to arrive within
// a second. Sixty seconds of latency on "a case was passed to you" costs
// nothing; a websocket layer would have to be built, deployed and kept alive.
//
// Only the COUNT is polled. The list is fetched when the panel opens, so the
// steady-state cost is one small query a minute per signed-in staff member.

const POLL_MS = 60_000;

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  read: boolean;
  createdAt: string;
}

function ago(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function NotificationBell() {
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[] | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  const refreshCount = useCallback(async () => {
    try {
      const { unread } = await api.get<{ unread: number }>('/api/staff/notifications/unread-count');
      setUnread(unread);
    } catch {
      // A failed poll is not worth surfacing — the next one is a minute away.
    }
  }, []);

  useEffect(() => {
    refreshCount();
    const t = setInterval(refreshCount, POLL_MS);
    return () => clearInterval(t);
  }, [refreshCount]);

  // Close on an outside click, the way every other menu on the page behaves.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next) {
      setItems(null);
      try {
        const data = await api.get<{ items: Notification[]; unread: number }>('/api/staff/notifications');
        setItems(data.items);
        setUnread(data.unread);
      } catch {
        setItems([]);
      }
    }
  }

  async function openItem(n: Notification) {
    // Marked read on the way out, not on render: opening the panel is not the
    // same as having dealt with the thing.
    if (!n.read) {
      setUnread((u) => Math.max(0, u - 1));
      setItems((prev) => prev?.map((x) => (x.id === n.id ? { ...x, read: true } : x)) ?? prev);
      api.post(`/api/staff/notifications/${n.id}/read`, {}).catch(() => refreshCount());
    }
    setOpen(false);
    if (n.link) router.push(n.link);
  }

  async function markAll() {
    setUnread(0);
    setItems((prev) => prev?.map((x) => ({ ...x, read: true })) ?? prev);
    api.post('/api/staff/notifications/read-all', {}).catch(() => refreshCount());
  }

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        onClick={toggle}
        aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
        className="relative rounded-lg p-2 text-sorena-navy/70 hover:bg-gray-100 hover:text-sorena-navy"
      >
        <Bell size={18} />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold tabular-nums text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-80 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-lg">
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-2.5">
            <span className="text-sm font-bold text-sorena-navy">Notifications</span>
            {!!unread && (
              <button type="button" onClick={markAll} className="inline-flex items-center gap-1 text-xs font-semibold text-sorena-navy hover:underline">
                <Check size={12} /> Mark all read
              </button>
            )}
          </div>

          {items === null && (
            <div className="flex items-center gap-2 px-4 py-6 text-sm text-sorena-text/60">
              <Loader2 size={15} className="animate-spin" /> Loading…
            </div>
          )}
          {items?.length === 0 && (
            <p className="px-4 py-6 text-center text-sm text-sorena-text/60">Nothing yet.</p>
          )}
          {!!items?.length && (
            <ul className="max-h-96 divide-y divide-gray-100 overflow-y-auto">
              {items.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => openItem(n)}
                    className={`flex w-full gap-2 px-4 py-3 text-left hover:bg-gray-50 ${n.read ? '' : 'bg-blue-50/40'}`}
                  >
                    {!n.read && <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-600" />}
                    <span className={`min-w-0 flex-1 ${n.read ? 'pl-3.5' : ''}`}>
                      <span className="block text-sm font-semibold text-sorena-navy">{n.title}</span>
                      {n.body && <span className="mt-0.5 block text-xs text-sorena-text/70">{n.body}</span>}
                      <span className="mt-1 block text-[11px] text-sorena-text/45">{ago(n.createdAt)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
