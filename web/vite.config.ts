import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  // GitHub Pages ではサブパス（/bravers_duel/）で配信されるため、環境変数で切り替える
  base: process.env.VITE_BASE ?? '/',
  plugins: [react()],
});
