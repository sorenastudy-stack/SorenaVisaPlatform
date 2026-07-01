import { WalletClient } from '@/components/portal/WalletClient';

// PR-WALLET slice 1 — client wallet page (balance + ledger). The /portal
// layout enforces LEAD/STUDENT access; the wallet is scoped server-side to
// the signed-in client.
export default function PortalWalletPage() {
  return <WalletClient />;
}
