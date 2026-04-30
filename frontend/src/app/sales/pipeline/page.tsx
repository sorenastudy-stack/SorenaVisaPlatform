import { Card, CardContent } from '@/components/ui/Card';
import { GitBranch } from 'lucide-react';

export default function SalesPipelinePage() {
  return (
    <div>
      <h1 className="text-2xl font-bold text-[#1E3A5F] mb-1">Pipeline</h1>
      <p className="text-sm text-[#4A4A4A]/70 mb-8">
        Visual pipeline of leads moving through qualification stages.
      </p>
      <Card>
        <CardContent className="py-16 text-center">
          <GitBranch size={32} className="mx-auto text-[#1E3A5F]/30 mb-3" />
          <p className="text-[#4A4A4A] font-medium">Coming soon</p>
          <p className="text-sm text-[#4A4A4A]/60 mt-1">
            The pipeline view is under construction.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
