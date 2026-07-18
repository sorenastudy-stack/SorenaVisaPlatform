import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { BookOpen } from 'lucide-react';

// Finance portal — Training & News. FINANCE + OWNER only. There is genuinely
// no training/news CMS or model behind this (confirmed in the PHASE_G scan),
// so this is an honest empty state, not a placeholder — no backend invented.
const ALLOWED = new Set(['OWNER', 'FINANCE']);

export default async function FinanceTrainingPage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/staff/finance/training');
  if (!ALLOWED.has(session.role)) redirect('/staff');

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 md:px-6 md:py-8">
      <div className="mb-2 flex items-center gap-2">
        <BookOpen size={20} className="text-sorena-navy" />
        <h1 className="text-2xl font-bold text-sorena-navy">Training &amp; News</h1>
      </div>
      <div className="mt-6 rounded-2xl border border-dashed border-sorena-gold/40 bg-[#faf8f3] py-16 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-sorena-gold/15">
          <BookOpen size={26} className="text-[#b8941f]" />
        </div>
        <p className="text-lg font-bold text-sorena-navy">Nothing here yet</p>
        <p className="mx-auto mt-2 max-w-sm text-sm text-sorena-text/60">
          Finance training guides and company news will appear here once they're published. Nothing to do for now.
        </p>
      </div>
    </div>
  );
}
