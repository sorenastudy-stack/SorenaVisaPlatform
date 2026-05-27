'use client';

import Link from 'next/link';
import { ArrowLeft, Settings, Zap, Key, Network, CheckCircle2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';

// PR-SCORECARD-4 — Wix Automations setup guide.
//
// Static documentation. Linked from /staff/platform-settings.
// No data fetching — copy-pasteable instructions only.

export default function WixSetupPage() {
  const webhookEndpoint = (() => {
    const base =
      process.env.NEXT_PUBLIC_BACKEND_URL ||
      process.env.NEXT_PUBLIC_API_URL ||
      'http://localhost:3001';
    return `${base}/webhooks/wix/payment`;
  })();

  return (
    <div className="max-w-3xl">
      <Link
        href="/staff/platform-settings"
        className="inline-flex items-center gap-1 text-sm text-[#1E3A5F] hover:text-[#E8B923] font-medium mb-4"
      >
        <ArrowLeft size={14} /> Back to platform settings
      </Link>

      <h1 className="text-2xl font-bold text-[#1E3A5F] flex items-center gap-2 mb-1">
        <Settings size={22} className="text-[#E8B923]" />
        Connect Wix Automations
      </h1>
      <p className="text-sm text-[#4A4A4A]/70 mb-6">
        Five-step setup. Once finished, every Wix payment and booking will appear in
        <Link href="/staff/wix-payments" className="text-[#1E3A5F] underline ml-1">/staff/wix-payments</Link>.
      </p>

      <Card className="mb-4">
        <CardContent>
          <h2 className="text-base font-bold text-[#1E3A5F] flex items-center gap-2 mb-3">
            <Zap size={18} className="text-[#E8B923]" /> 1. Create the Wix Automation
          </h2>
          <ol className="list-decimal list-inside space-y-2 text-sm text-[#4A4A4A] leading-relaxed">
            <li>Open the Wix Dashboard and go to <strong>Automations → Create automation</strong>.</li>
            <li>Choose a trigger: <em>When a payment is received</em> (for paid sessions) or <em>When a booking is confirmed</em> (for the free 15-minute session).</li>
            <li>For each booking page that should sync to Sorena, create one Automation. We recommend three (free 15-min, NZD 30 Gap-Closing, NZD 150 LIA).</li>
          </ol>
        </CardContent>
      </Card>

      <Card className="mb-4">
        <CardContent>
          <h2 className="text-base font-bold text-[#1E3A5F] flex items-center gap-2 mb-3">
            <Network size={18} className="text-[#E8B923]" /> 2. Action: send HTTP POST
          </h2>
          <ol className="list-decimal list-inside space-y-2 text-sm text-[#4A4A4A] leading-relaxed">
            <li>Action type: <strong>Send HTTP request</strong> (or <em>Webhook</em> depending on your Wix plan).</li>
            <li>Method: <strong>POST</strong></li>
            <li>URL:
              <div className="mt-1.5 font-mono text-xs bg-gray-50 rounded p-2 break-all text-[#1E3A5F]">
                {webhookEndpoint}
              </div>
            </li>
            <li>Content-Type: <code className="text-xs bg-gray-100 rounded px-1.5 py-0.5">application/json</code></li>
          </ol>
        </CardContent>
      </Card>

      <Card className="mb-4">
        <CardContent>
          <h2 className="text-base font-bold text-[#1E3A5F] flex items-center gap-2 mb-3">
            <Key size={18} className="text-[#E8B923]" /> 3. Add the shared-secret header
          </h2>
          <ol className="list-decimal list-inside space-y-2 text-sm text-[#4A4A4A] leading-relaxed">
            <li>Under <strong>Headers</strong>, add a new header:
              <div className="mt-1.5 font-mono text-xs bg-gray-50 rounded p-2 text-[#1E3A5F]">
                X-Sorena-Webhook-Secret: <span className="text-[#4A4A4A]/70">&lt;paste the secret from /staff/platform-settings&gt;</span>
              </div>
            </li>
            <li>The secret is visible in
              <Link href="/staff/platform-settings" className="text-[#1E3A5F] underline mx-1">platform settings</Link>
              immediately after you regenerate it. Copy it then.</li>
            <li>If you regenerate the secret later, you must update the Wix Automation header — otherwise webhook calls start being rejected.</li>
          </ol>
        </CardContent>
      </Card>

      <Card className="mb-4">
        <CardContent>
          <h2 className="text-base font-bold text-[#1E3A5F] flex items-center gap-2 mb-3">
            4. JSON body fields
          </h2>
          <p className="text-sm text-[#4A4A4A] leading-relaxed mb-2">
            Sorena reads these fields. Other fields are accepted and stored in the raw payload
            for forensic value, but only these are mapped to columns:
          </p>
          <pre className="bg-gray-50 rounded p-3 text-xs font-mono text-[#1E3A5F] overflow-x-auto leading-relaxed">{`{
  "paymentId":     "<unique-wix-payment-id>",
  "amount":        30,
  "currency":      "NZD",
  "productName":   "Gap-Closing Roadmap Session",
  "customer": {
    "email": "<customer email>",
    "name":  "<customer name>",
    "phone": "<customer phone, optional>"
  },
  "bookingId":      "<wix booking id, optional>",
  "bookingStart":   "<ISO datetime, optional>",
  "bookingEnd":     "<ISO datetime, optional>",
  "bookingLocation": "<location string, optional>"
}`}</pre>
          <p className="text-xs text-[#4A4A4A]/60 mt-2">
            Payment type is inferred from <code>amount + currency</code> (30 NZD → Gap-Closing,
            150 NZD → LIA, 0 or &quot;free&quot; → Free 15-min). Override by setting
            <code className="ml-1">productName</code> explicitly.
          </p>
        </CardContent>
      </Card>

      <Card className="mb-4">
        <CardContent>
          <h2 className="text-base font-bold text-[#1E3A5F] flex items-center gap-2 mb-3">
            <CheckCircle2 size={18} className="text-emerald-600" /> 5. Test
          </h2>
          <ol className="list-decimal list-inside space-y-2 text-sm text-[#4A4A4A] leading-relaxed">
            <li>Click <strong>Test automation</strong> in Wix. Verify Wix shows a successful 200 response.</li>
            <li>Open
              <Link href="/staff/wix-payments" className="text-[#1E3A5F] underline mx-1">/staff/wix-payments</Link>
              and confirm a new row appears with the test payment.</li>
            <li>If Wix shows a 401, double-check the header value matches the secret in
              <Link href="/staff/platform-settings" className="text-[#1E3A5F] underline ml-1">platform settings</Link>.</li>
            <li>If Wix shows a 500, Sorena&apos;s logs will have the raw payload — share the timestamp with
              whoever&apos;s on backend to diagnose.</li>
          </ol>
        </CardContent>
      </Card>

      <div className="text-xs text-[#4A4A4A]/60 italic">
        Webhook calls are rate-limited to 60 requests per minute per source IP. Wix will retry on 5xx
        but not on 4xx — by design, since 401 means &quot;wrong secret&quot; and retrying won&apos;t help.
      </div>
    </div>
  );
}
