import { getSession } from '@/lib/auth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Users } from 'lucide-react';

export default async function SalesDashboard() {
  const session = await getSession();

  return (
    <div>
      <h1 className="text-2xl font-bold text-sorena-navy mb-1">
        Welcome back, {session?.name || 'there'}
      </h1>
      <p className="text-sm text-gray-400 mb-8">Sales Dashboard</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users size={18} className="text-sorena-gold" />
              My Leads
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-sorena-navy">—</p>
            <p className="text-xs text-gray-400 mt-1">Coming soon</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
