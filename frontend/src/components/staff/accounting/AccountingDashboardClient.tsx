'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Bar, BarChart, CartesianGrid, Cell, Line, LineChart,
  Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { api } from '@/lib/api';
import './accounting-dashboard.css';

// PR-ACCOUNTING-DASHBOARD — the front page the accountant opens each morning.
//
// PASS TWO: wired to what the platform actually records.
//
// Only some of this dashboard has data behind it. Payments, invoices, the
// exchange rate and students per month are real. Revenue by month, service mix,
// GST breakdown and provider commission have no aggregation built yet; agent
// payables have no data model at all — AffiliateAgent carries no money fields.
//
// Those cards show an empty state rather than a zero. The distinction matters:
// a chart drawn at zero says "nothing happened this month", which is a claim
// about the business. "Not tracked yet" is a claim about the software. Only one
// of them is true, and printing the wrong one in a finance tool is the kind of
// thing that gets believed.

/* ── Palette ────────────────────────────────────────────────────────────────
   Mirrors the CSS custom properties. Recharts writes colours into SVG
   attributes, so it needs real values rather than var() references — this map
   is the single place the two representations meet. */
const C = {
  sun:   '#FFC53D',
  coral: '#FF7A5A',
  teal:  '#00B39F',
  sky:   '#5B8DEF',
  grape: '#A56BF0',
  lime:  '#6FD44E',
  pink:  '#FF6FA5',
  ink:   '#2B2440',
  ink2:  '#6E6689',
  grid:  '#F0ECF9',
} as const;

/** Spec data carries tokens like "--teal"; charts need the hex. */
const hex = (token: string) => (token.startsWith('--') ? (C as any)[token.slice(2)] ?? token : token);

/* ── Types (the contract the endpoints must meet in pass two) ─────────────── */
type Monthly = { m: string; revenue: number; out: number; students: number };
type Slice   = { name: string; value: number; color: string };
type FxPoint = { m: string; rate: number };
type Agent   = { name: string; city: string; owed: number; paid: number; intro: number; color: string };
type GstRow  = { name: string; ex: number; gst: number };

/* No sample data lives in this file.
 *
 * Pass one used the spec’s example figures to prove the layout. They are gone
 * now rather than parked behind a flag: an invented revenue number sitting in a
 * finance component is one careless edit away from being rendered, and a made-up
 * figure on this page would be believed.
 */
/* ── Money formatting ───────────────────────────────────────────────────────
   nz2 wherever a person reconciles the figure against a bank line — agent
   payables, individual payments. nz for aggregates and axes. */
const nz  = (n: number) => 'NZ$' + Math.round(n).toLocaleString('en-NZ');
const nz2 = (n: number) =>
  'NZ$' + n.toLocaleString('en-NZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const k = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`);

/* ── Shared chart pieces ───────────────────────────────────────────────────── */
const AXIS = { fontSize: 12, fill: C.ink2, fontFamily: 'Inter, sans-serif' } as const;
const axisProps = { tickLine: false, axisLine: false, tick: AXIS } as const;

function Tip({ active, payload, label, money = true, suffix = '' }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="ad-tip">
      <div className="ad-tip-h">{label}</div>
      {payload.map((p: any) => (
        <div className="ad-tip-r" key={p.dataKey ?? p.name}>
          <span style={{ color: p.color ?? p.fill }}>{p.name}</span>
          <b>{money ? nz(p.value) : `${p.value}${suffix}`}</b>
        </div>
      ))}
    </div>
  );
}

/** A chart box with a reserved height, so nothing shifts when data resolves. */
function Chart({ h, label, pullLeft, children }: {
  h: number; label: string; pullLeft?: boolean; children: React.ReactElement;
}) {
  return (
    <div
      className={`ad-ch${pullLeft ? ' ad-ch-y' : ''}`}
      style={{ height: h }}
      role="img"
      aria-label={label}
    >
      <ResponsiveContainer width="100%" height="100%">{children}</ResponsiveContainer>
    </div>
  );
}

/** Colour is never the only signal — every donut and status chart gets this. */
function Legend({ items, format }: { items: Slice[]; format: (n: number) => string }) {
  return (
    <div className="ad-legend">
      {items.map((s) => (
        <span className="ad-leg" key={s.name}>
          <i style={{ background: hex(s.color) }} />
          {s.name} <b>{format(s.value)}</b>
        </span>
      ))}
    </div>
  );
}

function Donut({ data, label }: { data: Slice[]; label: string }) {
  return (
    <Chart h={200} label={label}>
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" innerRadius={48} outerRadius={80} paddingAngle={4} stroke="none">
          {data.map((s) => <Cell key={s.name} fill={hex(s.color)} />)}
        </Pie>
        <Tooltip content={<Tip money={false} />} />
      </PieChart>
    </Chart>
  );
}




/* ── Empty states ───────────────────────────────────────────────────────────
   Two kinds, and they are not interchangeable:

   `waiting`  — the feature works, nothing has happened yet. It will fill in.
   `unbuilt`  — the platform does not record this. It will not fill in until
                someone builds it, and saying "no data" would imply otherwise. */
function Empty({ kind, children }: { kind: 'waiting' | 'unbuilt'; children: React.ReactNode }) {
  return (
    <div className={`ad-empty ad-empty-${kind}`}>
      <span className="ad-empty-tag">{kind === 'waiting' ? 'Nothing yet' : 'Not tracked yet'}</span>
      <p>{children}</p>
    </div>
  );
}

/* ── Live data ─────────────────────────────────────────────────────────────── */
interface Overview {
  invoicesByStatus: Record<string, number>;
  paymentsByStatus: Record<string, number>;
  paymentsByType: Record<string, number>;
  studentsByMonth: Array<{ month: string; count: number }>;
  pendingPaymentCount: number;
  invoicesWithLockedRate: number;
  totalInvoices: number;
  revenueByMonth: Array<{
    month: string;
    invoicedByCurrency: Record<string, number>;
    receivedByCurrency: Record<string, number>;
  }>;
  gstByPeriod: {
    periodStart: string;
    periodEnd: string;
    invoiceCount: number;
    gstByCurrency: Record<string, number>;
    exGstByCurrency: Record<string, number>;
    unassignedCount: number;
  };
  providerCommission: {
    earned: { count: number; byCurrency: Record<string, number> };
    invoiced: { count: number; byCurrency: Record<string, number> };
    received: { count: number; byCurrency: Record<string, number> };
    ageing: Array<{ bucket: string; count: number; byCurrency: Record<string, number> }>;
    unpricedCount: number;
  };
}

/** One agent's balance in one currency — see the service on why currency is
 *  part of the key rather than blended away. */
interface AgentSummaryRow {
  agentId: string;
  agentName: string | null;
  currency: string;
  owedMinorUnits: number;
  paidMinorUnits: number;
  count: number;
}
interface RateEntry { id: string; rate: number; rateDate: string; source: string; enteredByName: string | null }
interface FxView { base: string; quote: string; current: RateEntry | null; history: RateEntry[] }

/** Greeting by the reader's own clock. The spec said "Good morning" outright,
 *  which is wrong for most of a working day.
 *
 *  Read after mount, never during render: the server runs in UTC and the reader
 *  does not, so computing this on both sides would produce different HTML and a
 *  hydration mismatch. "Hello" is what both sides agree on until then. */
function greetingNow(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

/** Money arrives in minor units from the API — one unit for every currency. */
const money = (currency: string, minorUnits: number) =>
  `${currency} ${(minorUnits / 100).toLocaleString('en-NZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Currencies present anywhere in a month series, so a chart can plot each. */
function currenciesIn(rows: Array<Record<string, any>>, key: string): string[] {
  const set = new Set<string>();
  for (const r of rows) for (const c of Object.keys(r[key] ?? {})) set.add(c);
  return [...set].sort();
}

/** Below this many points a line implies a trend that isn't there yet. */
const FX_MIN_POINTS = 3;

const MONTH_SHORT = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const shortMonth = (iso: string) => MONTH_SHORT[Number(iso.slice(5, 7))] ?? iso;
const dayMonth = (iso: string) =>
  new Intl.DateTimeFormat('en-NZ', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso));

/** Invoice buckets. CANCELLED is grey — an invoice withdrawn on purpose is not
    a problem, and coral is reserved for things that are. */
const INVOICE_BUCKETS: Array<[string, string, string]> = [
  ['DRAFT',     'Draft',     '#C9C1E4'],
  ['SENT',      'Sent',      C.sky],
  ['PAID',      'Paid',      C.teal],
  ['OVERDUE',   'Overdue',   C.coral],
  ['CANCELLED', 'Cancelled', '#B9B2CE'],
];

const PAYMENT_BUCKETS: Array<[string, string, string]> = [
  ['CONFIRMED', 'Confirmed', C.teal],
  ['PENDING',   'Pending',   C.sun],
  ['REJECTED',  'Rejected',  C.coral],
];

const TYPE_COLOURS = [C.sky, C.teal, C.sun, C.grape, C.pink];
const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ').toLowerCase();

const SECTIONS = [
  ['everything', 'Everything'],
  ['money',      'Money in & out'],
  ['clients',    'Clients & invoices'],
  ['provider',   'Provider commission'],
  ['agents',     'Agents'],
  ['fx',         'Exchange rate'],
  ['gst',        'GST'],
] as const;

export function AccountingDashboardClient({ firstName }: { firstName?: string }) {
  const [ov, setOv] = useState<Overview | null>(null);
  const [fx, setFx] = useState<FxView | null>(null);
  const [agents, setAgents] = useState<AgentSummaryRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [hello, setHello] = useState('Hello');

  useEffect(() => { setHello(greetingNow()); }, []);

  useEffect(() => {
    Promise.all([
      api.get<Overview>('/staff/finance/accounting-overview'),
      api.get<FxView>('/staff/finance/exchange-rate'),
    ])
      .then(([o, f]) => { setOv(o); setFx(f); })
      .catch(() => setFailed(true));
    // Its own ledger, its own request — a slow or failing payables query must
    // not take the rest of the page down with it.
    api.get<AgentSummaryRow[]>('/staff/agent-payables/summary')
      .then(setAgents)
      .catch(() => setAgents([]));
  }, []);

  const jump = useCallback((id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  // Only buckets that actually occur — an invoice status with no invoices in it
  // is noise on a five-bar chart, and the legend still lists what is there.
  const invoiceFlow: Slice[] = INVOICE_BUCKETS
    .filter(([key]) => (ov?.invoicesByStatus[key] ?? 0) > 0)
    .map(([key, name, color]) => ({ name, value: ov!.invoicesByStatus[key], color }));

  const payStatus: Slice[] = PAYMENT_BUCKETS
    .filter(([key]) => (ov?.paymentsByStatus[key] ?? 0) > 0)
    .map(([key, name, color]) => ({ name, value: ov!.paymentsByStatus[key], color }));

  const payType: Slice[] = Object.entries(ov?.paymentsByType ?? {})
    .sort((a, b) => b[1] - a[1])
    .map(([name, value], i) => ({ name: titleCase(name), value, color: TYPE_COLOURS[i % TYPE_COLOURS.length] }));

  const students = (ov?.studentsByMonth ?? []).map((r) => ({ m: shortMonth(r.month), students: r.count }));
  const studentTotal = students.reduce((n, r) => n + r.students, 0);

  // Two currencies stay two series. Blending them would need each invoice's
  // locked rate, which is null on everything raised before that stamping — so a
  // single figure could only be produced by re-rating history at today's number.
  const revenue = (ov?.revenueByMonth ?? []).map((r) => ({
    m: shortMonth(r.month),
    ...Object.fromEntries(Object.entries(r.invoicedByCurrency).map(([c, v]) => [`inv_${c}`, v / 100])),
    ...Object.fromEntries(Object.entries(r.receivedByCurrency).map(([c, v]) => [`rec_${c}`, v / 100])),
  }));
  const invoicedCurrencies = currenciesIn(ov?.revenueByMonth ?? [], 'invoicedByCurrency');
  const receivedCurrencies = currenciesIn(ov?.revenueByMonth ?? [], 'receivedByCurrency');
  const anyRevenue = invoicedCurrencies.length > 0 || receivedCurrencies.length > 0;

  // Pipeline as three nested stages, in the commission's own currency. A single
  // bar per stage per currency — never summed across currencies.
  const pc = ov?.providerCommission ?? null;
  const pcCurrencies = pc
    ? [...new Set([
        ...Object.keys(pc.earned.byCurrency),
        ...Object.keys(pc.invoiced.byCurrency),
        ...Object.keys(pc.received.byCurrency),
      ])].sort()
    : [];
  const pipeline = pc && pcCurrencies.length
    ? [
        { name: 'Earned', ...Object.fromEntries(pcCurrencies.map((c) => [c, (pc.earned.byCurrency[c] ?? 0) / 100])) },
        { name: 'Invoiced', ...Object.fromEntries(pcCurrencies.map((c) => [c, (pc.invoiced.byCurrency[c] ?? 0) / 100])) },
        { name: 'Received', ...Object.fromEntries(pcCurrencies.map((c) => [c, (pc.received.byCurrency[c] ?? 0) / 100])) },
      ]
    : [];
  const ageingRows = (pc?.ageing ?? []).map((b) => ({
    name: b.bucket,
    ...Object.fromEntries(Object.keys(b.byCurrency).map((c) => [c, b.byCurrency[c] / 100])),
    count: b.count,
  }));
  const anyAgeing = (pc?.ageing ?? []).some((b) => b.count > 0);

  // Colour by age, not by series: the oldest bucket is the problem and keeps
  // coral, per the rule that problems never lose their colour.
  const AGE_COLOUR: Record<string, string> = {
    '0-30 days': C.teal, '31-45 days': C.lime, '46-60 days': C.sun, '60+ days': C.coral,
  };

  const agentRows = agents ?? [];
  const anyAgentBalance = agentRows.length > 0;

  // Company-wide agent balances, per currency. Summing across currencies would
  // need a rate nobody locked, so the KPI shows each on its own line.
  const owedByCurrency = new Map<string, number>();
  const paidByCurrency = new Map<string, number>();
  for (const r of agentRows) {
    owedByCurrency.set(r.currency, (owedByCurrency.get(r.currency) ?? 0) + r.owedMinorUnits);
    paidByCurrency.set(r.currency, (paidByCurrency.get(r.currency) ?? 0) + r.paidMinorUnits);
  }
  const owedTotals = [...owedByCurrency.entries()].filter(([, v]) => v > 0).sort();
  const paidTotals = [...paidByCurrency.entries()].filter(([, v]) => v > 0).sort();

  const gst = ov?.gstByPeriod ?? null;
  const gstCurrencies = gst ? currenciesIn([gst], 'exGstByCurrency') : [];

  const SERIES = [C.sky, C.teal, C.sun, C.grape, C.pink];

  const fxHistory = [...(fx?.history ?? [])].reverse();
  const fxPoints = fxHistory.map((r) => ({ m: shortMonth(r.rateDate), rate: r.rate }));
  const fxCurrent = fx?.current ?? null;
  const showFxLine = fxPoints.length >= FX_MIN_POINTS;

  if (failed) {
    return (
      <div className="ad-root"><div className="ad-wrap">
        <h1 className="ad-h1">Accounting</h1>
        <p style={{ color: '#6E6689' }}>
          Couldn&rsquo;t load the figures. Refresh the page — if it keeps happening, the
          finance service is down and the numbers here would be out of date anyway.
        </p>
      </div></div>
    );
  }

  return (
    <div className="ad-root">
      <div className="ad-wrap" id="everything">

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <header className="ad-head">
          <div>
            <h1 className="ad-h1">{hello}{firstName ? `, ${firstName}` : ''} 🌱</h1>
            {/* The status line names what is actually waiting. When nothing is,
                it says so — that is the point of it. */}
            <p>
              {ov === null
                ? 'Loading today’s figures…'
                : ov.pendingPaymentCount > 0
                  ? `${ov.pendingPaymentCount} payment${ov.pendingPaymentCount === 1 ? '' : 's'} ${ov.pendingPaymentCount === 1 ? 'is' : 'are'} waiting for you to confirm.`
                  : 'Nothing is waiting on you today.'}
            </p>
          </div>
          {fxCurrent && (
            <div className="ad-chip">
              <span className="ad-chip-l">{fx?.base} → {fx?.quote}</span>
              <span className="ad-chip-v">{fxCurrent.rate.toFixed(4)}</span>
            </div>
          )}
        </header>

        <nav className="ad-nav" aria-label="Jump to section">
          {SECTIONS.map(([id, text]) => (
            <button key={id} type="button" onClick={() => jump(id)}>{text}</button>
          ))}
        </nav>

        {/* ── Hero + goal ────────────────────────────────────────────────── */}
        <div className="ad-grid ad-g-hero">
          <section className="ad-hero ad-fade">
            <span className="ad-eyebrow">Invoiced and received</span>
            {!anyRevenue ? (
              <Empty kind="waiting">
                Nothing invoiced or received in the last six months. Both lines appear here
                as soon as money starts moving.
              </Empty>
            ) : (
              <>
                <div className="ad-hero-fig" style={{ fontSize: 30 }}>
                  {invoicedCurrencies.length
                    ? invoicedCurrencies
                        .map((c) => money(c, ov!.revenueByMonth[ov!.revenueByMonth.length - 1].invoicedByCurrency[c] ?? 0))
                        .join('  ·  ')
                    : 'Nothing invoiced this month'}
                </div>
                <div className="ad-hero-chart">
                  <Chart h={170} label="Invoiced and received by month and currency">
                    <BarChart data={revenue} barGap={4} margin={{ top: 14, right: 10, bottom: 0, left: 0 }}>
                      <CartesianGrid vertical={false} stroke={C.grid} />
                      <XAxis dataKey="m" interval={0} {...axisProps} />
                      <YAxis {...axisProps} width={46} domain={[0, 'auto']} />
                      <Tooltip content={<Tip money={false} />} cursor={{ fill: 'rgba(43,36,64,.04)' }} />
                      {invoicedCurrencies.map((c, i) => (
                        <Bar key={`inv_${c}`} dataKey={`inv_${c}`} name={`Invoiced ${c}`}
                             fill={SERIES[i % SERIES.length]} maxBarSize={22} radius={[8, 8, 0, 0]} />
                      ))}
                      {receivedCurrencies.map((c, i) => (
                        <Bar key={`rec_${c}`} dataKey={`rec_${c}`} name={`Received ${c}`}
                             fill={C.teal} maxBarSize={22} radius={[8, 8, 0, 0]} />
                      ))}
                    </BarChart>
                  </Chart>
                </div>
                <p style={{ fontSize: 12, color: C.ink2, margin: '4px 0 0' }}>
                  Currencies are shown separately — invoices in USD and payments in NZD can’t be
                  added together without re-rating history.
                </p>
              </>
            )}
          </section>

          <section className="ad-card ad-fade">
            <h3 className="ad-h3">Students enrolled</h3>
            <p className="ad-cap">New cases opened, month by month.</p>
            {studentTotal === 0 ? (
              <Empty kind="waiting">No cases opened in the last six months. Each new client shows up here.</Empty>
            ) : (
              <Chart h={132} label="Students enrolled per month over the last six months">
                <BarChart data={students} margin={{ top: 12, right: 4, bottom: 0, left: 4 }}>
                  <XAxis dataKey="m" interval={0} {...axisProps} />
                  <Tooltip content={<Tip money={false} />} />
                  <Bar dataKey="students" name="Students" fill={C.grape} maxBarSize={22} radius={[6, 6, 6, 6]} />
                </BarChart>
              </Chart>
            )}
            <div className="ad-goal-stats">
              <div className="ad-goal-stat">
                <b>{studentTotal} {studentTotal === 1 ? 'student' : 'students'}</b>
                <span>in the last six months</span>
              </div>
              <div className="ad-goal-stat">
                <b>{ov?.totalInvoices ?? '—'} {ov?.totalInvoices === 1 ? 'invoice' : 'invoices'}</b>
                <span>issued in total</span>
              </div>
            </div>
          </section>
        </div>

        {/* ── KPIs ───────────────────────────────────────────────────────── */}
        <div className="ad-grid ad-g-kpi" style={{ marginTop: 16 }}>
          <div className="ad-kpi ad-fade">
            <div className="ad-kpi-top"><i className="ad-dot" style={{ background: C.sun }} /><span className="ad-label">Invoiced</span></div>
            <p className="ad-kpi-none">Not totalled by month yet.</p>
          </div>
          <div className="ad-kpi ad-fade">
            <div className="ad-kpi-top"><i className="ad-dot" style={{ background: C.sky }} /><span className="ad-label">Commission receivable</span></div>
            <p className="ad-kpi-none">No commissions recorded yet.</p>
          </div>
          <div className="ad-kpi ad-fade">
            <div className="ad-kpi-top"><i className="ad-dot" style={{ background: C.pink }} /><span className="ad-label">Commission payable</span></div>
            {owedTotals.length === 0 ? (
              <p className="ad-kpi-none">No agent has earned a share yet.</p>
            ) : (
              <>
                <div className="ad-kpi-fig" style={{ color: C.pink, fontSize: owedTotals.length > 1 ? 20 : undefined }}>
                  {owedTotals.map(([c, v]) => money(c, v)).join('  ·  ')}
                </div>
                <div className="ad-kpi-sub">owed to agents, not yet paid</div>
              </>
            )}
          </div>
          <div className="ad-kpi ad-fade">
            <div className="ad-kpi-top"><i className="ad-dot" style={{ background: C.coral }} /><span className="ad-label">Waiting on you</span></div>
            <div className="ad-kpi-fig" style={{ color: C.coral }}>{ov?.pendingPaymentCount ?? '—'}</div>
            <div className="ad-kpi-sub">payments to confirm today</div>
          </div>
        </div>

        {/* ── Money in and money out ─────────────────────────────────────── */}
        <div className="ad-sec" id="money">
          <h2 className="ad-h2">Money in and money out</h2>
          <span>Where revenue comes from, and what leaves again</span>
        </div>
        <div className="ad-grid ad-g-2a">
          <section className="ad-card ad-fade">
            <h3 className="ad-h3">Money received</h3>
            <p className="ad-cap">Payments that have actually landed, month by month.</p>
            {receivedCurrencies.length === 0 ? (
              <Empty kind="waiting">No payments received in the last six months.</Empty>
            ) : (
              <>
                <Chart h={268} pullLeft label="Payments received by month and currency">
                  <BarChart data={revenue} barGap={5} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
                    <CartesianGrid vertical={false} stroke={C.grid} />
                    <XAxis dataKey="m" interval={0} {...axisProps} />
                    <YAxis {...axisProps} width={46} domain={[0, 'auto']} />
                    <Tooltip content={<Tip money={false} />} cursor={{ fill: 'rgba(43,36,64,.04)' }} />
                    {receivedCurrencies.map((c, i) => (
                      <Bar key={c} dataKey={`rec_${c}`} name={c} fill={SERIES[i % SERIES.length]}
                           maxBarSize={26} radius={[8, 8, 0, 0]} />
                    ))}
                  </BarChart>
                </Chart>
                <div className="ad-note" style={{ marginTop: 12 }}>
                  {paidTotals.length === 0 ? (
                    <>
                      <b>Money out isn’t here yet.</b> Agent payouts are the other half of
                      this picture. What is owed is now tracked — see the agents section
                      below — but nothing has been paid out, so there is nothing to plot.
                    </>
                  ) : (
                    <>
                      <b>Paid out to agents: {paidTotals.map(([c, v]) => money(c, v)).join('  ·  ')}.</b>{' '}
                      Not plotted alongside money in — a payout is dated when it was
                      released, and this chart is dated by when payments landed.
                    </>
                  )}
                </div>
              </>
            )}
          </section>
          <section className="ad-card ad-fade">
            <h3 className="ad-h3">What earns the money</h3>
            <p className="ad-cap">Revenue mix across the last six months.</p>
            <Empty kind="unbuilt">
              Revenue isn’t split by service yet. This fills in once each payment carries
              the fee type it was charged under.
            </Empty>
          </section>
        </div>

        {/* ── Clients and invoices ───────────────────────────────────────── */}
        <div className="ad-sec" id="clients">
          <h2 className="ad-h2">Clients and invoices</h2>
          <span>What’s been billed, and what’s actually landed</span>
        </div>
        <div className="ad-grid ad-g-3">
          <section className="ad-card ad-fade">
            <h3 className="ad-h3">Invoice status</h3>
            <p className="ad-cap">Every invoice issued this period.</p>
            {invoiceFlow.length === 0 ? (
              <Empty kind="waiting">No invoices issued yet. Each one appears here as it’s raised.</Empty>
            ) : (
              <>
                <Chart h={200} label="Invoices by status">
                  <BarChart data={invoiceFlow} layout="vertical" margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
                    <CartesianGrid horizontal={false} stroke={C.grid} />
                    <XAxis type="number" hide domain={[0, 'auto']} allowDecimals={false} />
                    <YAxis type="category" dataKey="name" width={72} {...axisProps} />
                    <Tooltip content={<Tip money={false} />} cursor={{ fill: 'rgba(43,36,64,.04)' }} />
                    <Bar dataKey="value" name="Invoices" maxBarSize={26} radius={[0, 8, 8, 0]}>
                      {invoiceFlow.map((s) => <Cell key={s.name} fill={hex(s.color)} />)}
                    </Bar>
                  </BarChart>
                </Chart>
                <Legend items={invoiceFlow} format={(n) => String(n)} />
              </>
            )}
          </section>

          <section className="ad-card ad-fade">
            <h3 className="ad-h3">Payments</h3>
            <p className="ad-cap">Confirmed, waiting, or sent back.</p>
            {payStatus.length === 0 ? (
              <Empty kind="waiting">No payments recorded yet.</Empty>
            ) : (
              <>
                <Donut data={payStatus} label="Payments by status" />
                <Legend items={payStatus} format={(n) => String(n)} />
              </>
            )}
          </section>

          <section className="ad-card ad-fade">
            <h3 className="ad-h3">How clients pay</h3>
            <p className="ad-cap">Manual transfers are the ones that need a receipt checked.</p>
            {payType.length === 0 ? (
              <Empty kind="waiting">No payments recorded yet.</Empty>
            ) : (
              <>
                <Donut data={payType} label="Payments by type" />
                <Legend items={payType} format={(n) => String(n)} />
              </>
            )}
          </section>
        </div>

        {/* ── Provider commission ────────────────────────────────────────── */}
        <div className="ad-sec" id="provider">
          <h2 className="ad-h2">Commission from education providers</h2>
          <span>Money the schools owe us</span>
        </div>
        <div className="ad-grid ad-g-2">
          <section className="ad-card ad-fade">
            <h3 className="ad-h3">Pipeline</h3>
            <p className="ad-cap">Earned, then invoiced, then in the bank.</p>
            {pipeline.length === 0 ? (
              <Empty kind="waiting">
                No commissions recorded yet. The first one appears here when Finance approves
                a commission claim.
              </Empty>
            ) : (
              <>
                <Chart h={226} pullLeft label="Provider commission pipeline">
                  <BarChart data={pipeline} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
                    <CartesianGrid vertical={false} stroke={C.grid} />
                    <XAxis dataKey="name" {...axisProps} />
                    <YAxis {...axisProps} width={46} domain={[0, 'auto']} />
                    <Tooltip content={<Tip money={false} />} cursor={{ fill: 'rgba(43,36,64,.04)' }} />
                    {/* Coloured by STAGE, not by series — earned, invoiced, received
                        each keep their own meaning from the palette, which is what
                        makes the three bars read as one pipeline. */}
                    {pcCurrencies.map((c) => (
                      <Bar key={c} dataKey={c} name={c} maxBarSize={62} radius={[10, 10, 0, 0]}>
                        {pipeline.map((row, i) => (
                          <Cell key={row.name} fill={[C.sun, C.sky, C.teal][i] ?? C.sun} />
                        ))}
                      </Bar>
                    ))}
                  </BarChart>
                </Chart>
                <p style={{ fontSize: 12, color: C.ink2, marginTop: 8 }}>
                  {pc!.earned.count} earned · {pc!.invoiced.count} invoiced · {pc!.received.count} received
                  {pc!.unpricedCount > 0 && ` · ${pc!.unpricedCount} not yet priced`}
                </p>
              </>
            )}
          </section>
          <section className="ad-card ad-fade">
            <h3 className="ad-h3">How long they take to pay</h3>
            <p className="ad-cap">Invoiced but not yet received, by age.</p>
            {!anyAgeing ? (
              <Empty kind="waiting">
                {pc && pc.invoiced.count === 0
                  ? 'Nothing is outstanding, because nothing has been invoiced to a provider yet.'
                  : 'Nothing is outstanding — every invoiced commission has been received.'}
              </Empty>
            ) : (
              <>
                <Chart h={226} pullLeft label="Provider commission ageing by bucket">
                  <BarChart data={ageingRows} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
                    <CartesianGrid vertical={false} stroke={C.grid} />
                    <XAxis dataKey="name" {...axisProps} />
                    <YAxis {...axisProps} width={46} domain={[0, 'auto']} />
                    <Tooltip content={<Tip money={false} />} cursor={{ fill: 'rgba(43,36,64,.04)' }} />
                    {pcCurrencies.map((c) => (
                      <Bar key={c} dataKey={c} name={c} maxBarSize={48} radius={[10, 10, 0, 0]}>
                        {ageingRows.map((r) => <Cell key={r.name} fill={AGE_COLOUR[r.name] ?? C.sun} />)}
                      </Bar>
                    ))}
                  </BarChart>
                </Chart>
                <div className="ad-legend">
                  {(pc?.ageing ?? []).map((b) => (
                    <span className="ad-leg" key={b.bucket}>
                      <i style={{ background: AGE_COLOUR[b.bucket] ?? C.sun }} />
                      {b.bucket} <b>{b.count}</b>
                    </span>
                  ))}
                </div>
              </>
            )}
          </section>
        </div>

        {/* ── Agents ─────────────────────────────────────────────────────── */}
        <div className="ad-sec" id="agents">
          <h2 className="ad-h2">Agents who introduce clients</h2>
          <span>What they’ve earned, and what’s still owed</span>
        </div>
        <div className="ad-grid ad-g-2a">
          <section className="ad-card ad-fade">
            <h3 className="ad-h3">Earned by agent</h3>
            <p className="ad-cap">Paid so far against what’s still waiting to be released.</p>
            {!anyAgentBalance ? (
              <Empty kind="waiting">
                No agent has earned anything yet. A balance appears here when a commission
                Sorena earns traces back to a client an agent introduced.
              </Empty>
            ) : (
              <>
                <Chart h={236} pullLeft label="Agent commission paid against owed">
                  <BarChart
                    data={agentRows.map((r) => ({
                      name: r.agentName ?? 'Agent',
                      paid: r.paidMinorUnits / 100,
                      owed: r.owedMinorUnits / 100,
                    }))}
                    barGap={5} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}
                  >
                    <CartesianGrid vertical={false} stroke={C.grid} />
                    <XAxis dataKey="name" interval={0} {...axisProps} tick={{ ...AXIS, fontSize: 11 }} />
                    <YAxis {...axisProps} width={46} domain={[0, 'auto']} />
                    <Tooltip content={<Tip money={false} />} cursor={{ fill: 'rgba(43,36,64,.04)' }} />
                    <Bar dataKey="paid" name="Paid" fill={C.teal} maxBarSize={30} radius={[8, 8, 0, 0]} />
                    <Bar dataKey="owed" name="Owed" fill={C.pink} maxBarSize={30} radius={[8, 8, 0, 0]} />
                  </BarChart>
                </Chart>
                <div className="ad-legend">
                  <span className="ad-leg"><i style={{ background: C.teal, borderRadius: 999 }} />Paid</span>
                  <span className="ad-leg"><i style={{ background: C.pink, borderRadius: 999 }} />Owed</span>
                </div>
              </>
            )}
          </section>
          <section className="ad-card ad-fade">
            <h3 className="ad-h3">Who’s waiting</h3>
            <p className="ad-cap">What each agent is owed, against what has already gone out.</p>
            {!anyAgentBalance ? (
              <Empty kind="waiting">
                Nobody is waiting on a payout yet.
              </Empty>
            ) : (
              <>
                {agentRows.map((r) => {
                  const total = r.owedMinorUnits + r.paidMinorUnits;
                  const pct = total > 0 ? r.paidMinorUnits / total : 0;
                  return (
                    <div className="ad-row" key={`${r.agentId}-${r.currency}`}>
                      <span className="ad-av" style={{ background: C.pink }}>
                        {(r.agentName ?? 'A').split(' ').map((w) => w[0]).slice(0, 2).join('')}
                      </span>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div className="ad-row-name">{r.agentName ?? 'Agent'}</div>
                        <div className="ad-row-sub">
                          {r.count} commission{r.count === 1 ? '' : 's'} · {money(r.currency, r.paidMinorUnits)} paid
                        </div>
                        <div className="ad-bar"><i style={{ width: `${pct * 100}%`, background: C.pink }} /></div>
                      </div>
                      <span className="ad-row-amt" style={{ color: C.pink }}>
                        {money(r.currency, r.owedMinorUnits)}
                      </span>
                    </div>
                  );
                })}
                <p style={{ fontSize: 12, color: C.ink2, marginTop: 10 }}>
                  Amounts owed are a share of commissions Sorena has earned. Approving and
                  releasing them arrives in the next pass.
                </p>
              </>
            )}
          </section>
        </div>

        {/* ── Exchange rate ──────────────────────────────────────────────── */}
        <div className="ad-sec" id="fx">
          <h2 className="ad-h2">Exchange rate</h2>
          <span>You set it, and every invoice keeps the rate it was issued at</span>
        </div>
        <div className="ad-grid ad-g-2a">
          <section className="ad-card ad-fade">
            <h3 className="ad-h3">USD → NZD over time</h3>
            <p className="ad-cap">Each point is a rate you set. Invoices issued under it never re-rate.</p>
            {showFxLine ? (
              <Chart h={220} pullLeft label="United States dollar to New Zealand dollar rate over time">
                <LineChart data={fxPoints} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                  <CartesianGrid vertical={false} stroke={C.grid} />
                  <XAxis dataKey="m" {...axisProps} />
                  {/* Auto-scaled to the real numbers — a fixed window was written
                      for imagined data and would push today's rate off the chart. */}
                  <YAxis {...axisProps} width={52} domain={['auto', 'auto']} tickFormatter={(v: number) => v.toFixed(3)} />
                  <Tooltip
                    content={({ active, payload, label }: any) =>
                      active && payload?.length ? (
                        <div className="ad-tip">
                          <div className="ad-tip-h">{label}</div>
                          <div className="ad-tip-r">
                            <span style={{ color: C.grape }}>1 USD =</span>
                            <b>{Number(payload[0].value).toFixed(4)} NZD</b>
                          </div>
                        </div>
                      ) : null
                    }
                  />
                  <Line
                    type="monotone" dataKey="rate" name="Rate" stroke={C.grape} strokeWidth={3.4}
                    dot={{ r: 5, fill: '#fff', stroke: C.grape, strokeWidth: 3 }} activeDot={{ r: 7 }}
                  />
                </LineChart>
              </Chart>
            ) : fxCurrent ? (
              <>
                <div className="ad-fx-fig" style={{
                  fontFamily: 'Nunito, sans-serif', fontSize: 44, fontWeight: 800,
                  letterSpacing: '-.03em', color: C.grape, margin: '6px 0 4px',
                }}>
                  {fxCurrent.rate.toFixed(4)}
                </div>
                <p className="ad-fx-meta">
                  Set by {fxCurrent.enteredByName ?? fxCurrent.source} on {dayMonth(fxCurrent.rateDate)}.
                </p>
                <Empty kind="waiting">
                  {fxPoints.length === 1
                    ? 'One rate on record. A line appears here once a few more have been set.'
                    : `${fxPoints.length} rates on record. A line appears here once there are ${FX_MIN_POINTS}.`}
                </Empty>
              </>
            ) : (
              <Empty kind="waiting">
                No rate set yet. Invoices can’t be issued in USD until one is — set it from
                the Finance dashboard.
              </Empty>
            )}
          </section>

          <section className="ad-card ad-fade">
            <h3 className="ad-h3">Rate in force</h3>
            {fxCurrent ? (
              <>
                <p className="ad-cap">Set {dayMonth(fxCurrent.rateDate)} by {fxCurrent.enteredByName ?? fxCurrent.source}.</p>
                <div className="ad-fx-fig" style={{
                  fontFamily: 'Nunito, sans-serif', fontSize: 44, fontWeight: 800,
                  letterSpacing: '-.03em', color: C.grape, margin: '4px 0 14px',
                }}>
                  {fxCurrent.rate.toFixed(4)}
                </div>
                <div className="ad-note">
                  {ov && ov.invoicesWithLockedRate > 0 ? (
                    <>
                      <b>{ov.invoicesWithLockedRate} invoice{ov.invoicesWithLockedRate === 1 ? '' : 's'}</b>{' '}
                      {ov.invoicesWithLockedRate === 1 ? 'is' : 'are'} locked to the rate {ov.invoicesWithLockedRate === 1 ? 'it was' : 'they were'} issued at.
                      Changing the rate today won’t move a single number in the reports you’ve already filed.
                    </>
                  ) : (
                    <>
                      <b>No invoice is locked to an older rate yet.</b> Every invoice from here
                      keeps the rate it was issued at, so changing this one only affects what
                      comes next.
                    </>
                  )}
                </div>
              </>
            ) : (
              <Empty kind="waiting">No rate has been set yet.</Empty>
            )}
          </section>
        </div>

        {/* ── GST ────────────────────────────────────────────────────────── */}
        <div className="ad-sec" id="gst">
          <h2 className="ad-h2">GST</h2>
          <span>Ready to reconcile against the bank</span>
        </div>
        <div className="ad-grid ad-g-2">
          <section className="ad-card ad-fade">
            <h3 className="ad-h3">GST collected</h3>
            <p className="ad-cap">
              {gst ? `Two-monthly period, ${gst.periodStart} to ${gst.periodEnd}.` : 'Current return period.'}
            </p>
            {!gst || gst.invoiceCount === 0 ? (
              <Empty kind="waiting">
                No invoices issued in this period yet
                {gst && gst.unassignedCount > 0
                  ? `. ${gst.unassignedCount} older invoice${gst.unassignedCount === 1 ? '' : 's'} ${gst.unassignedCount === 1 ? 'carries' : 'carry'} no issue date, so ${gst.unassignedCount === 1 ? 'it belongs' : 'they belong'} to no period and ${gst.unassignedCount === 1 ? 'isn’t' : 'aren’t'} counted here.`
                  : '. Each one appears here as it’s issued.'}
              </Empty>
            ) : (
              <>
                {gstCurrencies.map((c) => (
                  <div className="ad-row" key={c}>
                    <div>
                      <div className="ad-row-name">{c}</div>
                      <div className="ad-row-sub">{money(c, gst.exGstByCurrency[c] ?? 0)} excluding GST</div>
                    </div>
                    <span className="ad-row-amt" style={{ color: C.sun }}>
                      {money(c, gst.gstByCurrency[c] ?? 0)}
                    </span>
                  </div>
                ))}
                <p style={{ fontSize: 12, color: C.ink2, marginTop: 10 }}>
                  {gst.invoiceCount} invoice{gst.invoiceCount === 1 ? '' : 's'} issued in this period.
                </p>
              </>
            )}
          </section>
          <section className="ad-card ad-fade">
            <h3 className="ad-h3">This return at a glance</h3>
            <p className="ad-cap">
              {gst ? `${gst.periodStart} to ${gst.periodEnd}, so far.` : 'Current period.'}
            </p>
            {gst && (
              <>
                <div className="ad-row">
                  <div>
                    <div className="ad-row-name">Invoices issued</div>
                    <div className="ad-row-sub">in this period</div>
                  </div>
                  <span className="ad-row-amt">{gst.invoiceCount}</span>
                </div>
                {gstCurrencies.map((c) => (
                  <div className="ad-row" key={c}>
                    <div>
                      <div className="ad-row-name">GST collected · {c}</div>
                      <div className="ad-row-sub">on {money(c, gst.exGstByCurrency[c] ?? 0)} excluding GST</div>
                    </div>
                    <span className="ad-row-amt" style={{ color: C.sun }}>{money(c, gst.gstByCurrency[c] ?? 0)}</span>
                  </div>
                ))}
                {gst.unassignedCount > 0 && (
                  <div className="ad-note" style={{ marginTop: 14 }}>
                    <b>{gst.unassignedCount} invoice{gst.unassignedCount === 1 ? '' : 's'} with no issue date.</b>{' '}
                    {gst.unassignedCount === 1 ? 'It predates' : 'They predate'} the issue date being recorded,
                    so {gst.unassignedCount === 1 ? 'it belongs' : 'they belong'} to no return period.
                    Nothing has been guessed — {gst.unassignedCount === 1 ? 'it is' : 'they are'} counted
                    here instead of being folded into a period {gst.unassignedCount === 1 ? 'it was' : 'they were'} never assessed in.
                  </div>
                )}
              </>
            )}
          </section>
        </div>

        {/* ── Worth celebrating ──────────────────────────────────────────── */}
        <div className="ad-sec">
          <h2 className="ad-h2">Worth celebrating</h2>
          <span>The numbers behind a good month</span>
        </div>
        {/* A card celebrating zero is not a celebration — it reads as a rebuke.
            Each one appears only once there is something to show. */}
        {studentTotal > 0 || fxPoints.length > 0 ? (
          <div className="ad-grid ad-g-2">
            {studentTotal > 0 && (
              <div className="ad-win ad-fade" style={{ background: 'linear-gradient(135deg,#22C7B0,#00A896)' }}>
                <div className="ad-win-emoji">🎓</div>
                <div className="ad-win-fig">{studentTotal} {studentTotal === 1 ? 'student' : 'students'}</div>
                <p>Cases opened in the last six months.</p>
              </div>
            )}
            {fxPoints.length > 0 && (
              <div className="ad-win ad-fade" style={{ background: 'linear-gradient(135deg,#C08BFF,#A56BF0)' }}>
                <div className="ad-win-emoji">🔒</div>
                <div className="ad-win-fig">{fxPoints.length} {fxPoints.length === 1 ? 'rate' : 'rates'}</div>
                <p>Exchange rates on record, each one traceable to whoever set it.</p>
              </div>
            )}
          </div>
        ) : null}
        <div className="ad-note" style={{ marginTop: 14 }}>
          <b>Two more cards belong here.</b> Revenue growth and payment turnaround need
          figures the platform doesn’t total yet — they’ll join these once it does.
        </div>

      </div>
    </div>
  );
}
