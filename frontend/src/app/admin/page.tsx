'use client';
import { useState, useEffect, useCallback } from 'react';

const API = process.env.NEXT_PUBLIC_API_URL || 'https://sorenavisaplatform-production.up.railway.app';

interface StaffUser { id: string; email: string; name: string; role: string; }
interface Contact { fullName: string; email?: string; phone?: string; nationality?: string; }
interface Lead {
  id: string;
  leadStatus: string;
  scoreBand?: string | null;
  riskLevel?: string | null;
  recommendedRoute?: string | null;
  readinessScore?: number | null;
  hardStopFlag: boolean;
  hardStopReason?: string | null;
  aiSummary?: string | null;
  managerNotes?: string | null;
  createdAt: string;
  contact: Contact;
}

const ROUTE_LABELS: Record<string, string> = {
  ADMISSION_CONSULTATION: 'Admission Consultation',
  CONTENT_NURTURE: 'Free Resources & Guidance',
  WEBINAR: 'Attend Our Webinar',
  ROADMAP: 'Personalised Roadmap',
  SPECIALIST_CONSULTATION: 'Specialist Consultation',
  LIA_CONSULTATION: 'LIA Consultation',
  EXECUTION_QUEUE: 'Ready to Apply',
};

const BAND_STYLE: Record<string, { bg: string; color: string }> = {
  HIGH:   { bg: '#d1fae5', color: '#065f46' },
  MID:    { bg: '#dbeafe', color: '#1e3a5f' },
  LOW:    { bg: '#fef3c7', color: '#92400e' },
};

const BAND_LABELS: Record<string, string> = {
  HIGH: 'Band 5-6',
  MID:  'Band 3-4',
  LOW:  'Band 1-2',
};

const RISK_STYLE: Record<string, { bg: string; color: string }> = {
  LOW:     { bg: '#d1fae5', color: '#065f46' },
  MEDIUM:  { bg: '#fef3c7', color: '#92400e' },
  HIGH:    { bg: '#fee2e2', color: '#991b1b' },
  BLOCKED: { bg: '#fce7f3', color: '#9d174d' },
};

const RISK_LABELS: Record<string, string> = {
  LOW:     'Low Risk',
  MEDIUM:  'Medium Risk',
  HIGH:    'High Risk',
  BLOCKED: 'Hard Stop',
};

function Badge({ label, style }: { label: string; style?: { bg: string; color: string } }) {
  const s = style || { bg: '#f3f4f6', color: '#374151' };
  return (
    <span style={{ background: s.bg, color: s.color, padding: '2px 10px', borderRadius: 12, fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' }}>
      {label}
    </span>
  );
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ── LOGIN ──────────────────────────────────────────────────────────────────────

function LoginView({ onLogin }: { onLogin: (token: string, user: StaffUser) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Login failed');
      onLogin(data.token, { id: data.id, email: data.email, name: data.name, role: data.role });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg,#0a2342 0%,#0d4f6e 60%,#0a7a6e 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ background: '#fff', borderRadius: 16, padding: '48px 40px', width: '100%', maxWidth: 420, boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>🏢</div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 800, color: '#0a2342', margin: '0 0 4px' }}>Sorena Staff Portal</h1>
          <p style={{ color: '#6b7280', fontSize: 14, margin: 0 }}>Sign in to your account</p>
        </div>
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>Email</label>
            <input
              type="email" value={email} onChange={e => setEmail(e.target.value)} required
              placeholder="you@sorenavisa.com" autoComplete="email"
              style={{ width: '100%', padding: '11px 14px', border: '1.5px solid #e2e8f0', borderRadius: 8, fontSize: 15, color: '#111', boxSizing: 'border-box', outline: 'none' }}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>Password</label>
            <input
              type="password" value={password} onChange={e => setPassword(e.target.value)} required
              placeholder="••••••••" autoComplete="current-password"
              style={{ width: '100%', padding: '11px 14px', border: '1.5px solid #e2e8f0', borderRadius: 8, fontSize: 15, color: '#111', boxSizing: 'border-box', outline: 'none' }}
            />
          </div>
          {error && (
            <div style={{ background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: 8, padding: '10px 14px', color: '#991b1b', fontSize: 14 }}>{error}</div>
          )}
          <button type="submit" disabled={loading}
            style={{ background: loading ? '#0d7a6e99' : '#0d7a6e', color: '#fff', border: 'none', padding: '13px', borderRadius: 8, fontWeight: 700, fontSize: 15, cursor: loading ? 'not-allowed' : 'pointer', marginTop: 4 }}>
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}

// ── LEAD DETAIL MODAL ─────────────────────────────────────────────────────────

function LeadModal({ lead, onClose }: { lead: Lead; onClose: () => void }) {
  const band = lead.scoreBand ? BAND_STYLE[lead.scoreBand] : undefined;
  const risk = lead.riskLevel ? RISK_STYLE[lead.riskLevel] : undefined;

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end', padding: 0 }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ background: '#fff', width: '100%', maxWidth: 480, height: '100vh', overflowY: 'auto', boxShadow: '-8px 0 40px rgba(0,0,0,0.18)', display: 'flex', flexDirection: 'column' }}
      >
        {/* Header */}
        <div style={{ background: '#0a2342', padding: '20px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12, margin: '0 0 2px', textTransform: 'uppercase', letterSpacing: 1 }}>Lead Detail</p>
            <h2 style={{ color: '#fff', fontSize: '1.1rem', fontWeight: 700, margin: 0 }}>{lead.contact.fullName}</h2>
          </div>
          <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.1)', border: 'none', color: '#fff', fontSize: 20, width: 36, height: 36, borderRadius: 8, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
        </div>

        {/* Body */}
        <div style={{ padding: 24, flex: 1 }}>
          {lead.hardStopFlag && (
            <div style={{ background: '#fef2f2', border: '1.5px solid #fca5a5', borderRadius: 8, padding: '12px 16px', marginBottom: 20 }}>
              <p style={{ color: '#991b1b', fontWeight: 600, fontSize: 13, margin: 0 }}>⚠️ Hard Stop: {lead.hardStopReason || 'Manual review required'}</p>
            </div>
          )}

          <Section title="Contact">
            <Row label="Full Name" value={lead.contact.fullName} />
            <Row label="Email" value={lead.contact.email || '—'} />
            <Row label="Phone" value={lead.contact.phone || '—'} />
            <Row label="Nationality" value={lead.contact.nationality || '—'} />
          </Section>

          <Section title="Scoring">
            <Row label="Status" value={lead.leadStatus.replace(/_/g, ' ')} />
            <Row label="Readiness Band" value={
              lead.scoreBand
                ? <Badge label={BAND_LABELS[lead.scoreBand] ?? lead.scoreBand} style={band} />
                : '—'
            } />
            <Row label="Readiness Score" value={lead.readinessScore != null ? `${lead.readinessScore}/100` : '—'} />
            <Row label="Risk Level" value={
              lead.riskLevel
                ? <Badge label={RISK_LABELS[lead.riskLevel] ?? lead.riskLevel} style={risk} />
                : '—'
            } />
            <Row label="Recommended Route" value={
              lead.recommendedRoute
                ? (ROUTE_LABELS[lead.recommendedRoute] || lead.recommendedRoute)
                : '—'
            } />
          </Section>

          <Section title="Timeline">
            <Row label="Submitted" value={fmtDate(lead.createdAt)} />
          </Section>

          {lead.aiSummary && (
            <Section title="AI Summary">
              <p style={{ fontSize: 14, color: '#374151', lineHeight: 1.7, margin: 0 }}>{lead.aiSummary}</p>
            </Section>
          )}

          {lead.managerNotes && (
            <Section title="Manager Notes">
              <p style={{ fontSize: 14, color: '#374151', lineHeight: 1.7, margin: 0 }}>{lead.managerNotes}</p>
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <p style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 12 }}>{title}</p>
      <div style={{ background: '#f9fafb', borderRadius: 8, overflow: 'hidden' }}>{children}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid #f3f4f6', gap: 12 }}>
      <span style={{ fontSize: 13, color: '#6b7280', flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 600, color: '#111', textAlign: 'right' }}>{value}</span>
    </div>
  );
}

// ── DASHBOARD ─────────────────────────────────────────────────────────────────

function Dashboard({ token, user, onLogout }: { token: string; user: StaffUser; onLogout: () => void }) {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [search, setSearch] = useState('');
  const [bandFilter, setBandFilter] = useState('');

  const fetchLeads = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API}/leads`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401) { onLogout(); return; }
      if (!res.ok) throw new Error('Failed to load leads');
      setLeads(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load leads');
    } finally {
      setLoading(false);
    }
  }, [token, onLogout]);

  useEffect(() => { fetchLeads(); }, [fetchLeads]);

  const filtered = leads.filter(l => {
    const q = search.toLowerCase();
    const matchSearch = !q ||
      l.contact.fullName.toLowerCase().includes(q) ||
      (l.contact.email || '').toLowerCase().includes(q);
    const matchBand = !bandFilter || l.scoreBand === bandFilter;
    return matchSearch && matchBand;
  });

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc' }}>
      {/* Nav */}
      <div style={{ background: '#0a2342', padding: '0 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 60, position: 'sticky', top: 0, zIndex: 100 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ color: '#fff', fontWeight: 800, fontSize: '1.05rem', letterSpacing: -0.5 }}>Sorena</span>
          <span style={{ background: '#0d7a6e', color: '#fff', fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 6 }}>STAFF</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <span style={{ color: 'rgba(255,255,255,0.7)', fontSize: 13, display: 'none' }} className="hide-mobile">{user.name} · {user.role}</span>
          <button onClick={onLogout}
            style={{ background: 'rgba(255,255,255,0.1)', color: '#fff', border: '1px solid rgba(255,255,255,0.2)', padding: '6px 14px', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
            Logout
          </button>
        </div>
      </div>

      {/* Main */}
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '28px 20px' }}>
        {/* Stats bar */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 24 }}>
          {[
            { label: 'Total Leads', value: leads.length, color: '#0a2342' },
            { label: 'Strong (5-6)', value: leads.filter(l => l.scoreBand === 'HIGH').length, color: '#065f46' },
            { label: 'Developing (3-4)', value: leads.filter(l => l.scoreBand === 'MID').length, color: '#1e3a5f' },
            { label: 'Early (1-2)', value: leads.filter(l => l.scoreBand === 'LOW').length, color: '#92400e' },
            { label: 'Hard Stops ⚠️', value: leads.filter(l => l.hardStopFlag).length, color: '#991b1b' },
          ].map(s => (
            <div key={s.label} style={{ background: '#fff', borderRadius: 10, padding: '16px 18px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
              <p style={{ fontSize: 11, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 1, margin: '0 0 6px' }}>{s.label}</p>
              <p style={{ fontSize: 26, fontWeight: 800, color: s.color, margin: 0 }}>{s.value}</p>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search by name or email…"
            style={{ flex: 1, minWidth: 200, padding: '9px 14px', border: '1.5px solid #e2e8f0', borderRadius: 8, fontSize: 14, outline: 'none' }}
          />
          <select value={bandFilter} onChange={e => setBandFilter(e.target.value)}
            style={{ padding: '9px 14px', border: '1.5px solid #e2e8f0', borderRadius: 8, fontSize: 14, outline: 'none', background: '#fff' }}>
            <option value="">All Bands</option>
            <option value="HIGH">HIGH</option>
            <option value="MID">MID</option>
            <option value="LOW">LOW</option>
          </select>
          <button onClick={fetchLeads}
            style={{ padding: '9px 18px', background: '#0d7a6e', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
            Refresh
          </button>
        </div>

        {/* Table */}
        <div style={{ background: '#fff', borderRadius: 12, boxShadow: '0 1px 4px rgba(0,0,0,0.06)', overflow: 'hidden' }}>
          {loading ? (
            <div style={{ padding: 48, textAlign: 'center', color: '#9ca3af', fontSize: 15 }}>Loading leads…</div>
          ) : error ? (
            <div style={{ padding: 48, textAlign: 'center', color: '#991b1b', fontSize: 15 }}>{error}</div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: 48, textAlign: 'center', color: '#9ca3af', fontSize: 15 }}>No leads found.</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                    {['Name', 'Email', 'Readiness Band', 'Route', 'Risk Level', 'Date'].map(h => (
                      <th key={h} style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 700, color: '#374151', fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.6, whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((lead, i) => (
                    <tr
                      key={lead.id}
                      onClick={() => setSelectedLead(lead)}
                      style={{ borderBottom: '1px solid #f3f4f6', cursor: 'pointer', background: i % 2 === 0 ? '#fff' : '#fafafa', transition: 'background 0.15s' }}
                      onMouseEnter={e => (e.currentTarget.style.background = '#f0fdf4')}
                      onMouseLeave={e => (e.currentTarget.style.background = i % 2 === 0 ? '#fff' : '#fafafa')}
                    >
                      <td style={{ padding: '13px 16px', fontWeight: 600, color: '#0a2342', whiteSpace: 'nowrap' }}>
                        {lead.hardStopFlag && <span style={{ marginRight: 6 }} title="Hard Stop">⚠️</span>}
                        {lead.contact.fullName}
                      </td>
                      <td style={{ padding: '13px 16px', color: '#6b7280' }}>{lead.contact.email || '—'}</td>
                      <td style={{ padding: '13px 16px' }}>
                        {lead.scoreBand
                          ? <Badge label={BAND_LABELS[lead.scoreBand] ?? lead.scoreBand} style={BAND_STYLE[lead.scoreBand]} />
                          : <span style={{ color: '#9ca3af' }}>—</span>}
                      </td>
                      <td style={{ padding: '13px 16px', color: '#374151', maxWidth: 200 }}>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>
                          {lead.recommendedRoute ? (ROUTE_LABELS[lead.recommendedRoute] || lead.recommendedRoute) : '—'}
                        </span>
                      </td>
                      <td style={{ padding: '13px 16px' }}>
                        {lead.riskLevel
                          ? <Badge label={RISK_LABELS[lead.riskLevel] ?? lead.riskLevel} style={RISK_STYLE[lead.riskLevel]} />
                          : <span style={{ color: '#9ca3af' }}>—</span>}
                      </td>
                      <td style={{ padding: '13px 16px', color: '#9ca3af', whiteSpace: 'nowrap' }}>{fmtDate(lead.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <p style={{ color: '#9ca3af', fontSize: 12, marginTop: 10, textAlign: 'right' }}>
          Showing {filtered.length} of {leads.length} leads
        </p>
      </div>

      {selectedLead && <LeadModal lead={selectedLead} onClose={() => setSelectedLead(null)} />}
    </div>
  );
}

// ── ROOT ──────────────────────────────────────────────────────────────────────

export default function AdminPage() {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<StaffUser | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const t = localStorage.getItem('sorena_admin_token');
    const u = localStorage.getItem('sorena_admin_user');
    if (t && u) { setToken(t); setUser(JSON.parse(u)); }
    setHydrated(true);
  }, []);

  const handleLogin = (t: string, u: StaffUser) => {
    localStorage.setItem('sorena_admin_token', t);
    localStorage.setItem('sorena_admin_user', JSON.stringify(u));
    setToken(t); setUser(u);
  };

  const handleLogout = () => {
    localStorage.removeItem('sorena_admin_token');
    localStorage.removeItem('sorena_admin_user');
    setToken(null); setUser(null);
  };

  if (!hydrated) return null;
  if (!token || !user) return <LoginView onLogin={handleLogin} />;
  return <Dashboard token={token} user={user} onLogout={handleLogout} />;
}
