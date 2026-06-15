import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import './index.css';
import App from './App';
import { queryClient } from './lib/queryClient';
import { ThemeProvider } from './lib/theme';
import { ErrorBoundary } from './components/Error';
import LandingPage from './pages/LandingPage';
import DiscoveryPage from './pages/DiscoveryPage';
import RunDetailPage from './pages/RunDetailPage';
import TrackerPage from './pages/TrackerPage';
import ApplicationDetailPage from './pages/ApplicationDetailPage';
import SettingsPage from './pages/SettingsPage';
import InterviewPrepPage from './pages/InterviewPrepPage';
import MockInterviewPage from './pages/MockInterviewPage';
import NotFoundPage from './pages/NotFoundPage';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
    <BrowserRouter>
      <ThemeProvider>
      <ErrorBoundary>
        <Routes>
          <Route element={<App />}>
            <Route path="/" element={<LandingPage />} />
            <Route path="/discovery" element={<DiscoveryPage />} />
            <Route path="/discovery/:runId" element={<RunDetailPage />} />
            <Route path="/tracker" element={<TrackerPage />} />
            <Route path="/tracker/:id" element={<ApplicationDetailPage />} />
            <Route path="/interview-prep" element={<InterviewPrepPage />} />
            <Route path="/practice-interview" element={<MockInterviewPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </ErrorBoundary>
      </ThemeProvider>
    </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>
);
