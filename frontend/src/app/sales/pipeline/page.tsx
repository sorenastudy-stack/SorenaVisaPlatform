import { Card, CardContent } from '@/components/ui/Card';
import { GitBranch } from 'lucide-react';

// Sales pipeline. The lead data lives behind GET /leads, but that endpoint is
// currently unscoped (no role gate) — surfacing it here would show a sales rep
// the entire funnel regardless of ownership, so we hold off until it's scoped
// server-side. Honest empty state until then (see PHASE_G doc — flagged for a
// product/security decision on the legacy /sales portal).
export default function SalesPipelinePage() {
  return (
    <div>
      <h1 className="text-2xl font-bold text-[#1e3a5f] mb-1">Pipeline</h1>
      <p className="text-sm text-[#4A4A4A]/70 mb-8">
        Leads moving through qualification stages.
      </p>
      <Card>
        <CardContent className="py-16 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#c9a961]/15">
            <GitBranch size={26} className="text-[#b8941f]" />
          </div>
          <p className="text-lg font-bold text-[#1e3a5f]">No pipeline to show yet</p>
          <p className="mx-auto mt-2 max-w-sm text-sm text-[#4A4A4A]/60">
            Your leads will appear here as they come in and move through qualification.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
