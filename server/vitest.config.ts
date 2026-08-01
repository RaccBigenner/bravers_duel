import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

const testSecretBindings = {
  SUPABASE_AUTH_KEY: 'sb_publishable_test-only',
  SUPABASE_SECRET_KEY: 'sb_secret_test-only',
  SESSION_HMAC_KEYS: JSON.stringify({
    activeVersion: 1,
    keys: [
      {
        keyVersion: 1,
        material: 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE',
      },
    ],
  }),
  SESSION_ENCRYPTION_KEYS: JSON.stringify({
    activeVersion: 1,
    keys: [
      {
        keyVersion: 1,
        material: 'AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI',
      },
    ],
  }),
};

const expectedDurableObjectResetReasons = new Set([
  'MATCH_BATTLE_PERSISTENCE_INVALID',
  'MATCH_BATTLE_POST_ACTIVATION_COMMIT_FAILED',
  'MATCH_COMMAND_POST_COMMIT_FAILED',
  'MATCH_COMMAND_POST_INSTALL_FAILED',
]);

function isExpectedDurableObjectReset(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { message?: unknown; durableObjectReset?: unknown };
  return candidate.durableObjectReset === true &&
    typeof candidate.message === 'string' &&
    expectedDurableObjectResetReasons.has(candidate.message);
}

// Wranglerのrequired-secret検査にも、実credentialではないtest-only値を渡す。
Object.assign(process.env, testSecretBindings);

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        bindings: testSecretBindings,
      },
    }),
  ],
  test: {
    // workerdのctx.abort()は意図どおりRPCをrejectした後にも同じreset errorを報告する。
    // OLG-125の明示したcutpoint理由と改変検知だけを除外し、他は通常どおり失敗させる。
    onUnhandledError(error) {
      if (isExpectedDurableObjectReset(error)) return false;
    },
  },
});
