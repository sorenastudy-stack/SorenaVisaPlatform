import { Card, CardContent } from '@/components/ui/Card';
import { Calendar } from 'lucide-react';

// Sales consultations. There is no SALES-readable bookings endpoint today
// (/staff/bookings and /api/consultant/meetings both exclude SALES), so this
// stays an honest empty state rather than invent a feature. Flagged in the
// PHASE_G doc for a decision on the legacy /sales portal.
export default function SalesConsultationsPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold text-[#1e3a5f] mb-1">Consultations</h1>
      <p className="text-sm text-[#4A4A4A]/70 mb-8">
        Booked consultations and your availability.
      </p>
      <Card>
        <CardContent className="py-16 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#c9a961]/15">
            <Calendar size={26} className="text-[#b8941f]" />
          </div>
          <p className="text-lg font-bold text-[#1e3a5f]">No consultations booked yet</p>
          <p className="mx-auto mt-2 max-w-sm text-sm text-[#4A4A4A]/60">
            Booked consultations will appear here once clients start scheduling with you.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
