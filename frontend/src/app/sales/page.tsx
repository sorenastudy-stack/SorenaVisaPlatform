import Link from 'next/link';
import { getSession } from '@/lib/auth';
import { apiServer } from '@/lib/apiServer';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Users, Flame, Calendar } from 'lucide-react';

interface Lead {
  id: string;
  leadStatus: string;
  scoreBand: string | null;
  createdAt: string;
}

function isToday(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

export default async function SalesDashboard() {
  const session = await getSession();

  let leads: Lead[] = [];
  try {
    leads = await apiServer.get<Lead[]>('/leads');
  } catch {
    leads = [];
  }

  const total = leads.length;
  const newToday = leads.filter((l) => isToday(l.createdAt)).length;
  const hot = leads.filter((l) => l.scoreBand === 'HOT').length;

  return (
    <div>
      <h1 className="text-2xl font-bold text-[#1E3A5F] mb-1">
        Welcome back, {session?.name || 'there'}
      </h1>
      <p className="text-sm text-[#4A4A4A]/70 mb-8">Sales Dashboard</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        <Link href="/sales/leads">
          <Card className="hover:border-[#E8B923] transition-colors cursor-pointer">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-[#1E3A5F]">
                <Users size={18} className="text-[#E8B923]" />
                Total Leads
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold text-[#1E3A5F]">{total}</p>
              <p className="text-xs text-[#4A4A4A]/60 mt-1">
                All leads in pipeline
              </p>
            </CardContent>
          </Card>
        </Link>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-[#1E3A5F]">
              <Calendar size={18} className="text-[#E8B923]" />
              New Today
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-[#1E3A5F]">{newToday}</p>
            <p className="text-xs text-[#4A4A4A]/60 mt-1">
              Captured in last 24h
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-[#1E3A5F]">
              <Flame size={18} className="text-[#E8B923]" />
              Hot Band
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-[#1E3A5F]">{hot}</p>
            <p className="text-xs text-[#4A4A4A]/60 mt-1">
              High-readiness leads
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
