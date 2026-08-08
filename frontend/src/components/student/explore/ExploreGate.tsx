import Link from 'next/link';
import { Lock } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';

// PR-PHASE38 — the engagement-fee gate for Explore.
//
// Shown when the server answers 403 (EngagementPaidGuard). Shaped and worded to
// match the recommendations gate so the two locked surfaces read as one rule,
// not two: same lock mark, same one clear action, no dark patterns and no
// teaser of the content behind it.
//
// Shared by the list and the programme detail view so a deep link cannot get a
// softer gate than the list does.
export function ExploreGate() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-6 md:px-8">
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-[#1e3a5f]">Explore programmes</h1>
      </div>
      <Card className="text-center">
        <CardContent className="p-8">
          <Lock className="mx-auto mb-3 text-[#c9a961]" size={28} />
          <h2 className="text-base font-bold text-[#1e3a5f]">Programmes unlock after payment</h2>
          <p className="mx-auto mt-2 max-w-sm text-sm text-gray-600">
            Once your engagement fee is paid, we’ll show you every programme open to you, with the
            fees and scholarships that apply to your nationality.
          </p>
          <Link
            href="/student/payments"
            className="mt-5 inline-flex items-center gap-2 rounded-xl bg-[#1e3a5f] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#162d4a]"
          >
            Go to payments
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
