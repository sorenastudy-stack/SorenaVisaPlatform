import { getSession } from '@/lib/auth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Briefcase } from 'lucide-react';

export default async function StudentDashboard() {
  const session = await getSession();

  return (
    <div>
      <h1 className="text-2xl font-bold text-sorena-navy mb-1">
        Welcome, {session?.name || 'there'}
      </h1>
      <p className="text-sm text-gray-400 mb-8">
        We&apos;re here to support every step of your journey.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Briefcase size={18} className="text-sorena-gold" />
              My Application
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-gray-500 leading-relaxed">
              We&apos;re reviewing your case. We&apos;ll be in touch soon with next steps.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
