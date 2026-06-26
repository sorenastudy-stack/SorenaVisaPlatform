import Link from 'next/link';
import { Megaphone, Users, Link2, ArrowRight } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';

// PR-SCORECARD-2 — Marketing portal index page.
//
// Role-gated by the parent /staff/layout (which checks OWNER / ADMIN /
// SUPER_ADMIN at the StaffContext layer). Backend also enforces the
// same role gate on /staff/marketing/* — defence in depth.

export default function StaffMarketingPage() {
  return (
    <div className="max-w-5xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#1E3A5F] flex items-center gap-2">
          <Megaphone size={22} className="text-[#b8941f]" />
          Marketing
        </h1>
        <p className="text-sm text-[#4A4A4A]/70 mt-1">
          Affiliate agents, tracking links, and lead-source attribution.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Link href="/staff/marketing/agents" className="block">
          <Card className="hover:shadow-md transition-shadow">
            <CardContent>
              <div className="flex items-start gap-3">
                <Users size={20} className="text-[#b8941f] mt-1" />
                <div className="flex-1">
                  <div className="font-bold text-[#1E3A5F] mb-1">Affiliate agents</div>
                  <p className="text-sm text-[#4A4A4A]/70">
                    Manage referrer profiles. Each agent can own multiple tracking links.
                  </p>
                  <div className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-[#1E3A5F]">
                    Open agents <ArrowRight size={12} />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </Link>

        <Link href="/staff/marketing/links" className="block">
          <Card className="hover:shadow-md transition-shadow">
            <CardContent>
              <div className="flex items-start gap-3">
                <Link2 size={20} className="text-[#b8941f] mt-1" />
                <div className="flex-1">
                  <div className="font-bold text-[#1E3A5F] mb-1">Tracking links</div>
                  <p className="text-sm text-[#4A4A4A]/70">
                    Create per-channel short URLs and view click → submission conversion.
                  </p>
                  <div className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-[#1E3A5F]">
                    Open links <ArrowRight size={12} />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </Link>
      </div>
    </div>
  );
}
