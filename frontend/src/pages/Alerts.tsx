import { TopBar } from "../components/ui/TopBar";
import { EmptyState } from "../components/ui/EmptyState";

export function Alerts() {
 return (
 <>
 <TopBar title="Alerts" />
 <EmptyState message="No alerts right now" icon="🔔" />
 </>
 );
}
