import { defineConfig } from 'vitest/config';

// Unit testはVite 5のproduction build設定（React plugin）を読み込ませない。
// Cloudflare Workers testが要求するVitest 4と、既存Web buildのVite 5を明示的に分離する。
export default defineConfig({
  test: {
    environment: 'node',
  },
});
