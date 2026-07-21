import {
  ShieldCheck, Scale, Handshake, LifeBuoy, Wallet, Cog, LayoutDashboard,
  type LucideIcon,
} from 'lucide-react';

// PR-PORTAL-BRANDING — single source for the per-role portal name + icon shown
// top-left in the staff shell. Keeps the "Sorena Visa" brand line; the
// sub-label + icon are driven off the signed-in role from HERE (one place), so
// an LIA sees "Legal Portal", finance sees "Finance Portal", etc.
//
// This is presentation only — it maps a role to a display name/icon and touches
// no access logic.

export interface PortalBrand {
  label: string;
  Icon: LucideIcon;
}

export function portalBrand(role: string | null | undefined): PortalBrand {
  switch (role) {
    case 'OWNER':
    case 'SUPER_ADMIN':
    case 'ADMIN':
      return { label: 'Admin Portal', Icon: ShieldCheck };
    case 'LIA':
      return { label: 'Legal Portal', Icon: Scale };
    case 'CONSULTANT':
      return { label: 'Admission Officer Portal', Icon: Handshake };
    case 'CLIENT_CONSULTANT':
      return { label: 'Client Officer Portal', Icon: Handshake };
    case 'SUPPORT':
      return { label: 'Support Portal', Icon: LifeBuoy };
    case 'FINANCE':
      return { label: 'Finance Portal', Icon: Wallet };
    case 'OPERATIONS':
      return { label: 'Operations Portal', Icon: Cog };
    default:
      return { label: 'Staff Portal', Icon: LayoutDashboard };
  }
}
