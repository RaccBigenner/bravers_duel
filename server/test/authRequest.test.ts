import { describe, expect, it } from 'vitest';
import {
  AUTH_CLIENT_HEADER,
  AUTH_CLIENT_HEADER_VALUE,
  AuthRequestError,
  MAX_AUTH_BODY_BYTES,
  hasOnlyObjectKeys,
  readAuthJsonObject,
  validateSafeAuthRequest,
  validateUnsafeAuthRequest,
} from '../src/http/authRequest';

const ORIGIN = 'https://play.racc.games';

function unsafeRequest(overrides: {
  url?: string;
  method?: string;
  origin?: string | null;
  fetchSite?: string | null;
  client?: string | null;
  contentType?: string | null;
  body?: BodyInit | null;
} = {}): Request {
  const headers = new Headers();
  if (overrides.origin !== null) headers.set('Origin', overrides.origin ?? ORIGIN);
  if (overrides.fetchSite !== null) {
    headers.set('Sec-Fetch-Site', overrides.fetchSite ?? 'same-origin');
  }
  if (overrides.client !== null) {
    headers.set(AUTH_CLIENT_HEADER, overrides.client ?? AUTH_CLIENT_HEADER_VALUE);
  }
  if (overrides.contentType !== null) {
    headers.set('Content-Type', overrides.contentType ?? 'application/json');
  }
  return new Request(overrides.url ?? `${ORIGIN}/auth/guest`, {
    method: overrides.method ?? 'POST',
    headers,
    body: overrides.body === undefined ? '{}' : overrides.body,
  });
}

describe('OLG-113 auth request guard', () => {
  it('same-origin POST + Fetch Metadata + 固定header + exact JSONだけを通す', async () => {
    const request = unsafeRequest({ body: '{"captchaToken":"token"}' });
    expect(() => validateUnsafeAuthRequest(request, ORIGIN)).not.toThrow();
    await expect(readAuthJsonObject(request)).resolves.toEqual({ captchaToken: 'token' });
  });

  it.each([
    { url: 'https://evil.example/auth/guest' },
    { url: `${ORIGIN}/auth/guest?retry=1` },
    { method: 'PUT' },
    { origin: null },
    { origin: 'https://evil.example' },
    { fetchSite: null },
    { fetchSite: 'cross-site' },
    { client: null },
    { client: 'web-v2' },
    { contentType: null },
    { contentType: 'application/json; charset=utf-8' },
  ])('先行security guardで拒否する: %j', (override) => {
    expect(() => validateUnsafeAuthRequest(unsafeRequest(override), ORIGIN)).toThrowError(
      AuthRequestError,
    );
    try {
      validateUnsafeAuthRequest(unsafeRequest(override), ORIGIN);
    } catch (error) {
      expect(error).toMatchObject({ code: 'AUTH_REQUEST_REJECTED', status: 403 });
    }
  });

  it('GETはOriginを要求せずsame-origin metadataと固定headerを要求する', () => {
    const valid = unsafeRequest({
      method: 'GET',
      origin: null,
      contentType: null,
      body: null,
      url: `${ORIGIN}/auth/session`,
    });
    expect(() => validateSafeAuthRequest(valid, ORIGIN)).not.toThrow();
    expect(() =>
      validateSafeAuthRequest(
        unsafeRequest({
          method: 'GET',
          origin: null,
          contentType: null,
          fetchSite: 'cross-site',
          body: null,
          url: `${ORIGIN}/auth/session`,
        }),
        ORIGIN,
      ),
    ).toThrowError(AuthRequestError);
  });

  it('stream bodyを4096 bytesまでに制限し、超過と壊れたUTF-8をstable errorにする', async () => {
    const atLimit = `{"value":"${'a'.repeat(MAX_AUTH_BODY_BYTES - 12)}"}`;
    expect(new TextEncoder().encode(atLimit)).toHaveLength(MAX_AUTH_BODY_BYTES);
    await expect(readAuthJsonObject(unsafeRequest({ body: atLimit }))).resolves.toHaveProperty(
      'value',
    );

    await expect(
      readAuthJsonObject(unsafeRequest({ body: `${atLimit} ` })),
    ).rejects.toMatchObject({ code: 'AUTH_BODY_TOO_LARGE', status: 413 });
    await expect(
      readAuthJsonObject(unsafeRequest({ body: new Uint8Array([0xff]) })),
    ).rejects.toMatchObject({ code: 'AUTH_BODY_INVALID', status: 400 });
  });

  it('JSON object以外と未知fieldを受理しないための境界を提供する', async () => {
    await expect(readAuthJsonObject(unsafeRequest({ body: '[]' }))).rejects.toMatchObject({
      code: 'AUTH_BODY_INVALID',
      status: 400,
    });
    expect(hasOnlyObjectKeys({ captchaToken: 'ok' }, ['captchaToken'])).toBe(true);
    expect(hasOnlyObjectKeys({ captchaToken: 'ok', admin: true }, ['captchaToken'])).toBe(false);
  });
});
