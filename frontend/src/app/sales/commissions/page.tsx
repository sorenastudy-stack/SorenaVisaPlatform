import { Card, CardContent } from '@/components/ui/Card';
import { DollarSign } from 'lucide-react';

export default function SalesCommissionsPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold text-[#1E3A5F] mb-1">Commissions</h1>
      <p className="text-sm text-[#4A4A4A]/70 mb-8">
        Your commission ledger and payout status.
      </p>
      <Card>
        <CardContent className="py-16 text-center">
          <DollarSign size={32} className="mx-auto text-[#1E3A5F]/30 mb-3" />
          <p className="text-[#4A4A4A] font-medium">Coming soon</p>
          <p className="text-sm text-[#4A4A4A]/60 mt-1">
            Commission tracking is under construction.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
