import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import App from './App.tsx';
import { AuthProvider, RequireAuth } from './auth.tsx';
import './index.css';
import CasePage from './pages/CasePage.tsx';
import CounterPage from './pages/CounterPage.tsx';
import ExplorerPage from './pages/ExplorerPage.tsx';
import RightsPage from './pages/RightsPage.tsx';
import SectionsPage from './pages/SectionsPage';
import SavedPage from './pages/SavedPage.tsx';
import SearchPage from './pages/SearchPage.tsx';
import FirHomePage from './pages/fir/FirHomePage.tsx';
import FirConversationPage from './pages/fir/FirConversationPage.tsx';
import FirReviewPage from './pages/fir/FirReviewPage.tsx';
import FirConfirmPage from './pages/fir/FirConfirmPage.tsx';
import FirOutputPage from './pages/fir/FirOutputPage.tsx';
import AdminPage from './pages/auth/AdminPage.tsx';
import LoginPage from './pages/auth/LoginPage.tsx';
import ProfilePage from './pages/auth/ProfilePage.tsx';
import SignupPage from './pages/auth/SignupPage.tsx';
import ComparePage from './pages/judge/ComparePage.tsx';
import MemoPage from './pages/judge/MemoPage.tsx';
import TreatmentPage from './pages/judge/TreatmentPage.tsx';
import BriefPage from './pages/lawyer/BriefPage.tsx';
import AnalysisPage from './pages/lawyer/AnalysisPage';
import MattersPage from './pages/lawyer/MattersPage.tsx';
import RequireVerified from './components/RequireVerified.tsx';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 5 * 60 * 1000,
      // Retry once for network blips, but never for a 4xx: "not found" or
      // "please log in" will not change on a second try, it only delays the message.
      retry: (failures, err) => {
        const status = (err as { status?: number })?.status ?? 0;
        return failures < 1 && !(status >= 400 && status < 500);
      },
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route element={<App />}>
              <Route path="/" element={<SearchPage />} />
              <Route path="/case/:tid" element={<CasePage />} />
              <Route path="/explore" element={<ExplorerPage />} />
              <Route path="/rights" element={<RightsPage />} />
              <Route path="/sections" element={<SectionsPage />} />
              <Route
                path="/fir"
                element={
                  <RequireAuth>
                    <FirHomePage />
                  </RequireAuth>
                }
              />
              <Route
                path="/fir/case/:caseId"
                element={
                  <RequireAuth>
                    <FirConversationPage />
                  </RequireAuth>
                }
              />
              <Route
                path="/fir/case/:caseId/review"
                element={
                  <RequireAuth>
                    <FirReviewPage />
                  </RequireAuth>
                }
              />
              <Route
                path="/fir/case/:caseId/confirm"
                element={
                  <RequireAuth>
                    <FirConfirmPage />
                  </RequireAuth>
                }
              />
              <Route
                path="/fir/case/:caseId/output"
                element={
                  <RequireAuth>
                    <FirOutputPage />
                  </RequireAuth>
                }
              />
              <Route
                path="/saved"
                element={
                  <RequireAuth>
                    <SavedPage />
                  </RequireAuth>
                }
              />
              <Route
                path="/judge/compare"
                element={
                  <RequireVerified role="judge">
                    <ComparePage />
                  </RequireVerified>
                }
              />
              <Route
                path="/judge/treatment"
                element={
                  <RequireVerified role="judge">
                    <TreatmentPage />
                  </RequireVerified>
                }
              />
              <Route
                path="/judge/treatment/:tid"
                element={
                  <RequireVerified role="judge">
                    <TreatmentPage />
                  </RequireVerified>
                }
              />
              <Route
                path="/judge/memo"
                element={
                  <RequireVerified role="judge">
                    <MemoPage />
                  </RequireVerified>
                }
              />
              <Route path="/judge" element={<Navigate to="/judge/compare" replace />} />
              <Route
                path="/lawyer/matters"
                element={
                  <RequireVerified role="lawyer">
                    <MattersPage />
                  </RequireVerified>
                }
              />
              <Route
                path="/lawyer/brief"
                element={
                  <RequireVerified role="lawyer">
                    <BriefPage />
                  </RequireVerified>
                }
              />
              <Route
                path="/lawyer/analysis"
                element={
                  <RequireVerified role="lawyer">
                    <AnalysisPage />
                  </RequireVerified>
                }
              />
              <Route path="/lawyer" element={<Navigate to="/lawyer/matters" replace />} />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/signup" element={<SignupPage />} />
              <Route
                path="/profile"
                element={
                  <RequireAuth>
                    <ProfilePage />
                  </RequireAuth>
                }
              />
              <Route
                path="/admin"
                element={
                  <RequireAuth roles={['admin']}>
                    <AdminPage />
                  </RequireAuth>
                }
              />
              <Route path="/counter" element={<CounterPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);
