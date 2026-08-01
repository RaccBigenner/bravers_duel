import { describe, expect, it, vi } from 'vitest';
import {
  GuestAdminError,
  deleteGuestAuthUser,
} from '../src/auth/supabaseGuestAdmin';
import type { SessionStoreCredential } from '../src/auth/supabaseSessionStore';

const ACCOUNT_ID = '11111111-2222-4333-8444-555555555555';
const SECRET = 'sb_secret_admin-sentinel';
const credential: SessionStoreCredential = {
  environment: 'local',
  supabaseUrl: 'http://127.0.0.1:54321',
  secretKey: SECRET,
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('OLG-113 guest Auth compensation admin', () => {
  it('DB claimで指定された1 accountだけをserver secretでhard deleteする', async () => {
    const fetchMock = vi.fn(async () => json({ user: { id: ACCOUNT_ID } }));

    await expect(
      deleteGuestAuthUser(credential, ACCOUNT_ID, { fetch: fetchMock }),
    ).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      `http://127.0.0.1:54321/auth/v1/admin/users/${ACCOUNT_ID}`,
    );
    expect(init.method).toBe('DELETE');
    const headers = new Headers(init.headers);
    expect(headers.get('apikey')).toBe(SECRET);
    expect(headers.get('Authorization')).toBe(`Bearer ${SECRET}`);
  });

  it('不正account IDとabort済みrequestは外部I/O前に拒否する', async () => {
    const fetchMock = vi.fn(async () => json({}));
    await expect(
      deleteGuestAuthUser(credential, 'not-an-account', { fetch: fetchMock }),
    ).rejects.toMatchObject({ code: 'GUEST_ADMIN_CONFIG_INVALID' });
    const controller = new AbortController();
    controller.abort();
    await expect(
      deleteGuestAuthUser(credential, ACCOUNT_ID, {
        fetch: fetchMock,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: 'GUEST_ADMIN_UNAVAILABLE' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('upstream errorのraw bodyやsecretをstable errorへ出さない', async () => {
    let failure: unknown;
    try {
      await deleteGuestAuthUser(credential, ACCOUNT_ID, {
        fetch: async () => json({ message: `raw ${SECRET}` }, 503),
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(GuestAdminError);
    expect(failure).toMatchObject({ code: 'GUEST_ADMIN_UNAVAILABLE' });
    expect(String(failure)).not.toContain(SECRET);
  });
});
