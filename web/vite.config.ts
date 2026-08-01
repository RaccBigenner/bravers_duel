import react from '@vitejs/plugin-react';
import { defineConfig, type ProxyOptions } from 'vite';

const onlineTarget = process.env.VITE_ONLINE_TARGET ?? 'http://127.0.0.1:8787';

function onlineProxy(webSocket = false): ProxyOptions {
  return {
    target: onlineTarget,
    changeOrigin: true,
    ws: webSocket,
    rewriteWsOrigin: webSocket,
    configure(proxy) {
      // Workerは本番同様exact same-originを要求する。開発proxyの外側だけで
      // browserの5173 originをWorkerの8787 originへ揃える。
      proxy.on('proxyReq', (request) => request.setHeader('Origin', onlineTarget));
      proxy.on('proxyReqWs', (request) => request.setHeader('Origin', onlineTarget));
    },
  };
}

export default defineConfig({
  // GitHub Pages ではサブパス（/bravers_duel/）で配信されるため、環境変数で切り替える
  base: process.env.VITE_BASE ?? '/',
  plugins: [react()],
  server: {
    proxy: {
      '/auth': onlineProxy(),
      '/me': onlineProxy(),
      '/matches': onlineProxy(true),
    },
  },
});
