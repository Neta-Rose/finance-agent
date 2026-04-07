import { TopBar } from "../components/ui/TopBar";
import { EmptyState } from "../components/ui/EmptyState";

export function Strategies() {
 return (
 <>
 <TopBar title="Strategies" />
 <EmptyState message="No strategies yet" icon="🎯" />
 </>
 );
}
