import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import './styles/global.css';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import Landing from './pages/Landing';
import MatchPage from './pages/match/MatchPage';
import TrackerPage from './pages/tracker/TrackerPage';
import ApplicationDetail from './pages/tracker/ApplicationDetail';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <ErrorBoundary>
        <Routes>
          <Route element={<App />}>
            <Route path="/" element={<Landing />} />
            <Route path="/match" element={<MatchPage />} />
            <Route path="/tracker" element={<TrackerPage />} />
            <Route path="/tracker/:id" element={<ApplicationDetail />} />
          </Route>
        </Routes>
      </ErrorBoundary>
    </BrowserRouter>
  </React.StrictMode>
);
