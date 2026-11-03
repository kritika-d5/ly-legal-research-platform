import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import App from './App.tsx';
import './index.css';
import CasePage from './pages/CasePage.tsx';
import CounterPage from './pages/CounterPage.tsx';
import ExplorerPage from './pages/ExplorerPage.tsx';
import SearchPage from './pages/SearchPage.tsx';
import FirHomePage from './pages/fir/FirHomePage.tsx';
import FirConversationPage from './pages/fir/FirConversationPage.tsx';
import FirReviewPage from './pages/fir/FirReviewPage.tsx';
import FirConfirmPage from './pages/fir/FirConfirmPage.tsx';
import FirOutputPage from './pages/fir/FirOutputPage.tsx';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { refetchOnWindowFocus: false, staleTime: 5 * 60 * 1000, retry: 1 },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route element={<App />}>
            <Route path="/" element={<SearchPage />} />
            <Route path="/case/:tid" element={<CasePage />} />
            <Route path="/explore" element={<ExplorerPage />} />
            <Route path="/fir" element={<FirHomePage />} />
            <Route path="/fir/case/:caseId" element={<FirConversationPage />} />
            <Route path="/fir/case/:caseId/review" element={<FirReviewPage />} />
            <Route path="/fir/case/:caseId/confirm" element={<FirConfirmPage />} />
            <Route path="/fir/case/:caseId/output" element={<FirOutputPage />} />
            <Route path="/counter" element={<CounterPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
