import { Card, CardContent } from '@/components/ui/Card';
import { DollarSign } from 'lucide-react';

// Sales commissions. GET /commissions exists but is unscoped — it returns every
// user's commissions with no per-user filter, so surfacing it to a sales rep
// would leak the whole team's payouts. Held as an honest empty state until a
// scoped `my commissions` endpoint exists (flagged in the PHASE_G doc).
export default function SalesCommissionsPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold text-[#1e3a5f] mb-1">Commissions</h1>
      <p className="text-sm text-[#4A4A4A]/70 mb-8">
        Your commission ledger and payout status.
      </p>
      <Card>
        <CardContent className="py-16 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#c9a961]/15">
            <DollarSign size={26} className="text-[#b8941f]" />
          </div>
          <p className="text-lg font-bold text-[#1e3a5f]">No commissions yet</p>
          <p className="mx-auto mt-2 max-w-sm text-sm text-[#4A4A4A]/60">
            Your commission ledger will appear here as deals close and payouts are recorded.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
