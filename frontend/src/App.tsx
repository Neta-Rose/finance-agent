import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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
 if (!isAuthenticated) return <Navigate to="/login" replace />;
 return <>{children}</>;
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
 <Route path="/onboarding" element={<Onboarding />} />
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
 <Route path="/controls" element={
 <ProtectedRoute>
 <AppLayout><Controls /></AppLayout>
 </ProtectedRoute>
 } />
 </Routes>
 <ToastContainer />
 </BrowserRouter>
 </QueryClientProvider>
 );
}
