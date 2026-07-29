import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowPath = resolve(
  process.cwd(),
  '../ops/bravers_duel_wip/.github/workflows/publish-set.yml',
);
const decoderPath = resolve(
  process.cwd(),
  '../ops/bravers_duel_wip/.github/scripts/decode-webp-sandbox.sh',
);
const workflow = readFileSync(workflowPath, 'utf8');

describe('非公開publish workflowテンプレート', () => {
  it('外部Actionsとvalidation Node baseをimmutable参照へ固定する', () => {
    expect(workflow).toContain(
      'actions/checkout@11d5960a326750d5838078e36cf38b85af677262',
    );
    expect(workflow).toContain(
      'actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020',
    );
    expect(workflow).not.toMatch(/uses:\s+actions\/(?:checkout|setup-node)@v\d/);
    expect(workflow).toMatch(
      /VALIDATION_NODE_IMAGE:\s+node@sha256:[0-9a-f]{64}/,
    );
  });

  it('全外部取得をprivate WIP checkoutより前に終える', () => {
    const runtime = workflow.indexOf('name: Prepare isolated validation runtime');
    const privateCheckout = workflow.indexOf('name: Check out private WIP repository');
    const candidate = workflow.indexOf('name: Validate snapshot and build public candidate');
    expect(runtime).toBeGreaterThan(0);
    expect(runtime).toBeLessThan(privateCheckout);
    expect(privateCheckout).toBeLessThan(candidate);
    expect(workflow.slice(privateCheckout)).not.toMatch(
      /\b(?:npm ci|docker pull|apt-get update)\b/,
    );
  });

  it('公開候補とWebP decoderをnetworkなし・最小mountで実行する', () => {
    expect(workflow.match(/--network none/g)).toHaveLength(1);
    const decoder = readFileSync(decoderPath, 'utf8');
    expect(decoder).toContain('--network none');
    expect(decoder).toContain('--read-only');
    expect(decoder).toContain('--cap-drop ALL');
    expect(decoder).toContain('--memory 256m');
    expect(decoder).toContain('--memory-swap 256m');
    expect(decoder).toContain('--cpus 1');
    expect(decoder).toContain('timeout --kill-after=2s 10s');
    expect(decoder).toContain('docker rm --force');
    expect(decoder).toContain('$image_path:/input.webp:ro');
    expect(statSync(decoderPath).mode & 0o111).not.toBe(0);
  });

  it('public write secretはpush stepより前へ渡さない', () => {
    const pushStep = workflow.indexOf('name: Commit and push public set');
    const secret = workflow.indexOf('secrets.PUBLIC_PUBLISH_TOKEN');
    expect(pushStep).toBeGreaterThan(0);
    expect(secret).toBeGreaterThan(pushStep);
    expect(workflow.slice(0, pushStep)).not.toContain('PUBLIC_PUBLISH_TOKEN');
  });

  it('効果moduleと弾固有testを公開・検証・cleanup対象に含める', () => {
    expect(workflow).toContain('engine/src/effects');
    expect(workflow).toContain('engine/test/effects');
    expect(workflow).toContain('"effects/vol${PUBLISH_VOL}.ts"');
    expect(workflow).toContain('"effects/vol${PUBLISH_VOL}.test.ts"');
  });
});
