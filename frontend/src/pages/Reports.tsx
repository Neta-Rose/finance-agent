import { TopBar } from "../components/ui/TopBar";
import { EmptyState } from "../components/ui/EmptyState";

export function Reports() {
 return (
 <>
 <TopBar title="Reports" />
 <EmptyState message="No reports yet" icon="📄" />
 </>
 );
}
