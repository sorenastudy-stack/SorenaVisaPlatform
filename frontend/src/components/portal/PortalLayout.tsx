'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard, Users, Briefcase, School, FileText, Settings,
  ArrowRightLeft, Shield, FileSearch, CheckSquare, BarChart2,
  Calendar, DollarSign, MessageSquare, CreditCard, Menu, X, LogOut, Globe,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { useLocaleStore } from '@/lib/stores/localeStore';
import type { Session } from '@/lib/auth';

type Portal = 'admin' | 'ops' | 'sales' | 'lia' | 'student';

interface NavItem {
  label: string;
  href: string;
  icon: React.ReactNode;
}

const NAV_CONFIG: Record<Portal, NavItem[]> = {
  admin: [
    { label: 'Dashboard',  href: '/admin',       icon: <LayoutDashboard size={18} /> },
    { label: 'Users',      href: '/admin/users',  icon: <Users size={18} /> },
    { label: 'Cases',      href: '/admin/cases',  icon: <Briefcase size={18} /> },
    { label: 'Providers',  href: '/admin/providers', icon: <School size={18} /> },
    { label: 'Audit Log',  href: '/admin/audit',  icon: <FileText size={18} /> },
    { label: 'Settings',   href: '/admin/settings', icon: <Settings size={18} /> },
  ],
  ops: [
    { label: 'Dashboard',   href: '/ops',              icon: <LayoutDashboard size={18} /> },
    { label: 'Cases',       href: '/ops/cases',        icon: <Briefcase size={18} /> },
    { label: 'Documents',   href: '/ops/documents',    icon: <FileText size={18} /> },
    { label: 'Compliance',  href: '/ops/compliance',   icon: <Shield size={18} /> },
    { label: 'Handoffs',    href: '/ops/handoffs',     icon: <ArrowRightLeft size={18} /> },
  ],
  sales: [
    { label: 'Dashboard',      href: '/sales',               icon: <LayoutDashboard size={18} /> },
    { label: 'Leads',          href: '/sales/leads',         icon: <Users size={18} /> },
    { label: 'Pipeline',       href: '/sales/pipeline',      icon: <BarChart2 size={18} /> },
    { label: 'Consultations',  href: '/sales/consultations', icon: <Calendar size={18} /> },
    { label: 'Commissions',    href: '/sales/commissions',   icon: <DollarSign size={18} /> },
  ],
  lia: [
    { label: 'Dashboard',        href: '/lia',                icon: <LayoutDashboard size={18} /> },
    { label: 'Cases',            href: '/lia/cases',          icon: <Briefcase size={18} /> },
    { label: 'Document Review',  href: '/lia/documents',      icon: <FileSearch size={18} /> },
    { label: 'Decisions',        href: '/lia/decisions',      icon: <CheckSquare size={18} /> },
  ],
  student: [
    { label: 'Dashboard',  href: '/student',           icon: <LayoutDashboard size={18} /> },
    { label: 'My Case',    href: '/student/case',      icon: <Briefcase size={18} /> },
    { label: 'Documents',  href: '/student/documents', icon: <FileText size={18} /> },
    { label: 'Messages',   href: '/student/messages',  icon: <MessageSquare size={18} /> },
    { label: 'Payments',   href: '/student/payments',  icon: <CreditCard size={18} /> },
  ],
};

const PORTAL_TITLES: Record<Portal, string> = {
  admin:   'Admin Portal',
  ops:     'Operations',
  sales:   'Sales',
  lia:     'LIA Portal',
  student: 'My Portal',
};

interface PortalLayoutProps {
  children: React.ReactNode;
  portal: Portal;
  session: Session;
}

export function PortalLayout({ children, portal, session }: PortalLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const { locale, toggleLocale } = useLocaleStore();
  const navItems = NAV_CONFIG[portal];

  const handleSignOut = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
  };

  const SidebarContent = () => (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="px-6 py-5 border-b border-white/10 flex items-center gap-3">
        <img
          src="/brand/logo-mark-white.jpg"
          alt="Sorena"
          className="h-8 w-8 flex-shrink-0"
        />
        <div className="flex flex-col leading-tight">
          <span className="text-white font-extrabold text-sm tracking-tight">Sorena Visa</span>
          <span className="text-sorena-gold text-[10px] font-bold uppercase tracking-wider">
            {PORTAL_TITLES[portal]}
          </span>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {navItems.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setSidebarOpen(false)}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors',
                active
                  ? 'bg-white/15 text-white'
                  : 'text-white/70 hover:bg-white/10 hover:text-white',
              )}
            >
              {item.icon}
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Sign out */}
      <div className="px-3 py-4 border-t border-white/10">
        <button
          onClick={handleSignOut}
          className="flex items-center gap-3 w-full px-3 py-2.5 rounded-xl text-sm font-medium text-white/60 hover:bg-white/10 hover:text-white transition-colors"
        >
          <LogOut size={18} />
          Sign out
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex w-64 flex-col flex-shrink-0 bg-sorena-navy">
        <SidebarContent />
      </aside>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setSidebarOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 w-64 flex flex-col bg-sorena-navy z-50">
            <button
              onClick={() => setSidebarOpen(false)}
              className="absolute top-4 right-4 text-white/70 hover:text-white"
            >
              <X size={20} />
            </button>
            <SidebarContent />
          </aside>
        </div>
      )}

      {/* Main */}
      <div className="flex flex-col flex-1 min-w-0">
        {/* Top bar */}
        <header className="flex items-center justify-between h-14 px-4 bg-white border-b border-gray-100 flex-shrink-0">
          <div className="flex items-center gap-3">
            <button
              className="lg:hidden p-1.5 rounded-lg text-gray-500 hover:bg-gray-100"
              onClick={() => setSidebarOpen(true)}
            >
              <Menu size={20} />
            </button>
            <span className="text-sm font-semibold text-sorena-navy hidden sm:block">
              {PORTAL_TITLES[portal]}
            </span>
          </div>

          <div className="flex items-center gap-3">
            {/* Language switcher */}
            <button
              onClick={toggleLocale}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-gray-500 hover:bg-gray-100 transition-colors"
              title={locale === 'en' ? 'Switch to Persian' : 'Switch to English'}
            >
              <Globe size={14} />
              {locale === 'en' ? 'فا' : 'EN'}
            </button>

            {/* User */}
            <div className="flex items-center gap-2 pl-3 border-l border-gray-100">
              <div className="w-7 h-7 rounded-full bg-sorena-navy flex items-center justify-center text-white text-xs font-bold">
                {(session.name || session.email)?.[0]?.toUpperCase()}
              </div>
              <span className="text-sm text-gray-700 hidden sm:block max-w-[140px] truncate">
                {session.name || session.email}
              </span>
            </div>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
