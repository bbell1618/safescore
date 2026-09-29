import { AutopilotInbox } from "@/components/console/autopilot-inbox";
import { loadInbox } from "@/lib/autopilot/inbox-server";

export const dynamic = "force-dynamic";

export default async function ConsoleInboxPage() {
  const initial = await loadInbox();
  return <AutopilotInbox initial={initial} />;
}
