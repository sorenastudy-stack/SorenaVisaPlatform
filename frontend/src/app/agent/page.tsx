import { AgentLeadsClient } from '@/components/agent/AgentLeadsClient';

// PR-AGENT-PORTAL phase 1 — the agent's landing page. The shell decides
// whether this renders at all; the API refuses it regardless if the gate is
// not satisfied.
export default function AgentHomePage() {
  return <AgentLeadsClient />;
}
