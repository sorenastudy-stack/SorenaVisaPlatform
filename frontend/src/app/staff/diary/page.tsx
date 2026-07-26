import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { DiaryClient } from '@/components/staff/diary/DiaryClient';

// PR-DIARY — "My day": the caller's agenda of nurture call tasks + consultation
// meetings (today + missed). Same gate as the backend controller.
const ALLOWED = new Set(['OWNER', 'SUPER_ADMIN', 'ADMIN', 'LIA', 'CONSULTANT', 'CLIENT_CONSULTANT']);

export default async function StaffDiaryPage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/staff/diary');
  if (!ALLOWED.has(session.role)) redirect('/staff');
  return <DiaryClient />;
}
