import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import './index.css';
import App from './App';
import { queryClient } from './lib/queryClient';
import { ErrorBoundary } from './components/Error';
import LandingPage from './pages/LandingPage';
import SearchPage from './pages/SearchPage';
import ManualScorePage from './pages/ManualScorePage';
import ActivePage from './pages/ActivePage';
import TrackerPage from './pages/TrackerPage';
import MessagesPage from './pages/MessagesPage';
import ApplicationDetailPage from './pages/ApplicationDetailPage';
import ResumePackPage from './pages/ResumePackPage';
import SettingsPage from './pages/SettingsPage';
import ProcessingPage from './pages/ProcessingPage';
import InterviewPrepPage from './pages/InterviewPrepPage';
import MockInterviewPage from './pages/MockInterviewPage';
import InterviewInsightsPage from './pages/InterviewInsightsPage';
import NotFoundPage from './pages/NotFoundPage';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
    <BrowserRouter>
      <ErrorBoundary>
        <Routes>
          <Route element={<App />}>
            <Route path="/" element={<LandingPage />} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/score" element={<ManualScorePage />} />
            <Route path="/active" element={<ActivePage />} />
            <Route path="/tracker" element={<TrackerPage />} />
            <Route path="/tracker/:id" element={<ApplicationDetailPage />} />
            <Route path="/tracker/:id/pack" element={<ResumePackPage />} />
            <Route path="/messages" element={<MessagesPage />} />
            <Route path="/interview-prep" element={<InterviewPrepPage />} />
            <Route path="/practice-interview" element={<MockInterviewPage />} />
            <Route path="/interview-insights" element={<InterviewInsightsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/processing" element={<ProcessingPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </ErrorBoundary>
    </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>
);
