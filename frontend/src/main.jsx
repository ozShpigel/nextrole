import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import './styles/global.css';
import App from './App';
import { ErrorBoundary } from './components/Error';
import LandingPage from './pages/LandingPage';
import DiscoveryPage from './pages/DiscoveryPage';
import RunDetailPage from './pages/RunDetailPage';
import TrackerPage from './pages/TrackerPage';
import ApplicationDetailPage from './pages/ApplicationDetailPage';
import SettingsPage from './pages/SettingsPage';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <ErrorBoundary>
        <Routes>
          <Route element={<App />}>
            <Route path="/" element={<LandingPage />} />
            <Route path="/discovery" element={<DiscoveryPage />} />
            <Route path="/discovery/:runId" element={<RunDetailPage />} />
            <Route path="/tracker" element={<TrackerPage />} />
            <Route path="/tracker/:id" element={<ApplicationDetailPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Route>
        </Routes>
      </ErrorBoundary>
    </BrowserRouter>
  </React.StrictMode>
);
