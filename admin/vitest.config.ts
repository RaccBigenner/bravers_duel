import { defineConfig } from 'vitest/config';

// 管理画面のunit testは純粋関数だけを対象とし、production用の大きなVite設定を読み込まない。
// これによりVitest内蔵Viteと実buildのViteを同じ処理系として誤認しない。
export default defineConfig({
  test: {
    environment: 'node',
  },
});
