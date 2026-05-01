import { Card, CardContent } from '@/components/ui/Card';
import { Briefcase } from 'lucide-react';
import { apiServer } from '@/lib/apiServer';
import { StudentHeader } from '@/components/student/StudentHeader';

interface MeResponse {
  fullName: string;
  photoUrl: string | null;
}

export default async function StudentCasePage() {
  let me: MeResponse = { fullName: 'Your Account', photoUrl: null };
  try {
    me = await apiServer.get<MeResponse>('/students/me');
  } catch {
    /* keep fallback */
  }

  return (
    <div>
      <StudentHeader
        name={me.fullName}
        photoUrl={me.photoUrl}
        subtitle="Your application status, milestones, and timeline."
        showBack
      />
      <Card>
        <CardContent className="py-16 text-center">
          <Briefcase size={32} className="mx-auto text-[#1E3A5F]/30 mb-3" />
          <p className="text-[#4A4A4A] font-medium">Coming soon</p>
          <p className="text-sm text-[#4A4A4A]/60 mt-1">
            This section is under construction.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
