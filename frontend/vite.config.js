import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api/match': 'http://localhost:5136',
      '/api/applications': 'http://localhost:5002',
      '/api/stats': 'http://localhost:5002',
      '/api/interviews': 'http://localhost:5002',
      '/api/notes': 'http://localhost:5002',
    },
  },
});
