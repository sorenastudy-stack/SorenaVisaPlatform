import { redirect } from 'next/navigation';

// Platform configuration lives in the staff portal (/staff/platform-settings),
// a working editor over the PlatformSettings backend. This was a placeholder
// stub duplicating it; forward rather than maintain a duplicate.
export default function AdminSettingsPage() {
  redirect('/staff/platform-settings');
}
