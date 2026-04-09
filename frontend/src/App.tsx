import { useState } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { useAuthStore } from "./store/authStore";
import { BottomNav } from "./components/ui/BottomNav";
import { ToastContainer } from "./components/ui/Toast";
import { Login } from "./pages/Login";
import { Onboarding } from "./pages/Onboarding";
import { Portfolio } from "./pages/Portfolio";
import { Alerts } from "./pages/Alerts";
import { Reports } from "./pages/Reports";
import { Strategies } from "./pages/Strategies";
import { Controls } from "./pages/Controls";
import { Settings } from "./pages/Settings";
import { Admin } from "./pages/Admin";
import { fetchOnboardStatus } from "./api/onboarding";
import { Spinner } from "./components/ui/Spinner";

const queryClient = new QueryClient({
 defaultOptions: {
 queries: {
 retry: 1,
 staleTime: 30_000,
 refetchOnWindowFocus: false,
 },
 },
});

function ProtectedRoute({ children }: { children: React.ReactNode }) {
 const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

 const { data: onboardStatus, isLoading, error } = useQuery({
   queryKey: ["onboard-status"],
   queryFn: fetchOnboardStatus,
   enabled: isAuthenticated,
   staleTime: 60_000,
 });

 if (!isAuthenticated) return <Navigate to="/login" replace />;

 // Still loading — show spinner, don't flash a redirect
 if (isLoading) {
   return (
     <div className="flex items-center justify-center min-h-screen bg-[var(--color-bg-base)]">
       <Spinner size="lg" />
     </div>
   );
 }

 // Error fetching status — fail open, let them through
 if (error || !onboardStatus) return <>{children}</>;

 // Portfolio not loaded — redirect to onboarding
 if (!onboardStatus.portfolioLoaded) {
   return <Navigate to="/onboarding" replace />;
 }

 const [bannerDismissed, setBannerDismissed] = useState(false);
 const showBanner = !bannerDismissed && onboardStatus?.agentHealthy === false;

 return (
   <>
     {showBanner && (
       <div
         className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between gap-2 px-4 py-2 text-sm font-medium"
         style={{
           background: "rgba(239,68,68,0.12)",
           borderBottom: "1px solid rgba(239,68,68,0.3)",
           color: "var(--color-accent-red)",
         }}
       >
         <span>Your AI advisor is experiencing issues. Reports may be delayed — please contact support.</span>
         <button
           onClick={() => setBannerDismissed(true)}
           className="ml-4 shrink-0 text-base leading-none opacity-70 hover:opacity-100"
         >
           ×
         </button>
       </div>
     )}
     <div style={showBanner ? { paddingTop: "36px" } : undefined}>
       {children}
     </div>
   </>
 );
}

// Separate route guard for onboarding - prevents returning to completed onboarding
function OnboardingRoute() {
 const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

 const { data: onboardStatus, isLoading } = useQuery({
   queryKey: ["onboard-status"],
   queryFn: fetchOnboardStatus,
   enabled: isAuthenticated,
   staleTime: 60_000,
 });

 if (!isAuthenticated) return <Navigate to="/login" replace />;

 if (isLoading) {
   return (
     <div className="flex items-center justify-center min-h-screen bg-[var(--color-bg-base)]">
       <Spinner size="lg" />
     </div>
   );
 }

 // If portfolio already loaded, send them to portfolio - no going back
 if (onboardStatus?.portfolioLoaded) {
   return <Navigate to="/portfolio" replace />;
 }

 return <Onboarding />;
}

function AppLayout({ children }: { children: React.ReactNode }) {
 return (
 <div className="bg-[var(--color-bg-base)] min-h-screen">
 <div className="page-content">{children}</div>
 <BottomNav />
 </div>
 );
}

export default function App() {
 const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

 return (
 <QueryClientProvider client={queryClient}>
 <BrowserRouter>
 <Routes>
 <Route path="/login" element={<Login />} />
 <Route path="/onboarding" element={<OnboardingRoute />} />
 <Route path="/" element={
 isAuthenticated
 ? <Navigate to="/portfolio" replace />
 : <Navigate to="/login" replace />
 } />
 <Route path="/portfolio" element={
 <ProtectedRoute>
 <AppLayout><Portfolio /></AppLayout>
 </ProtectedRoute>
 } />
 <Route path="/alerts" element={
 <ProtectedRoute>
 <AppLayout><Alerts /></AppLayout>
 </ProtectedRoute>
 } />
 <Route path="/reports" element={
 <ProtectedRoute>
 <AppLayout><Reports /></AppLayout>
 </ProtectedRoute>
 } />
 <Route path="/strategies" element={
 <ProtectedRoute>
 <AppLayout><Strategies /></AppLayout>
 </ProtectedRoute>
 } />
 <Route path="/settings" element={
 <ProtectedRoute>
 <AppLayout><Settings /></AppLayout>
 </ProtectedRoute>
 } />
 <Route path="/controls" element={
 <ProtectedRoute>
 <AppLayout><Controls /></AppLayout>
 </ProtectedRoute>
 } />
 <Route path="/admin" element={<Admin />} />
 </Routes>
 <ToastContainer />
 </BrowserRouter>
 </QueryClientProvider>
 );
}
