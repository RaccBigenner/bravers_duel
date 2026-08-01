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
});
