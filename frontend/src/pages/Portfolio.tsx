import { TopBar } from "../components/ui/TopBar";
import { Spinner } from "../components/ui/Spinner";

export function Portfolio() {
 return (
 <>
 <TopBar title="Portfolio" />
 <div className="flex items-center justify-center h-48">
 <Spinner />
 </div>
 </>
 );
}
