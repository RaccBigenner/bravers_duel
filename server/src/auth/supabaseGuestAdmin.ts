import { createClient } from '@supabase/supabase-js';
import { createDeadlineFetch } from '../http/deadlineFetch';
import {
  assertSessionStoreCredential,
  type SessionStoreCredential,
} from './supabaseSessionStore';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export class GuestAdminError extends Error {
  constructor(public readonly code: 'GUEST_ADMIN_CONFIG_INVALID' | 'GUEST_ADMIN_UNAVAILABLE') {
    super(code);
    this.name = 'GuestAdminError';
  }
}

interface GuestAdminDependencies {
  fetch?: typeof fetch;
  timeoutMs?: number;
  signal?: AbortSignal;
}

/**
 * 補償対象としてDB claimが返した1 accountだけをhard deleteする。
 * 呼出側は成功/失敗にかかわらずDBのabsence確認RPCを正本にする。
 */
export async function deleteGuestAuthUser(
  credential: SessionStoreCredential,
  accountId: string,
  dependencies: GuestAdminDependencies = {},
): Promise<void> {
  try {
    assertSessionStoreCredential(credential);
    if (!UUID_PATTERN.test(accountId)) throw new GuestAdminError('GUEST_ADMIN_CONFIG_INVALID');
    const timeoutMs = dependencies.timeoutMs ?? 10_000;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
      throw new GuestAdminError('GUEST_ADMIN_CONFIG_INVALID');
    }
    if (dependencies.signal?.aborted) throw new GuestAdminError('GUEST_ADMIN_UNAVAILABLE');

    const client = createClient(credential.supabaseUrl, credential.secretKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
        skipAutoInitialize: true,
      },
      global: {
        fetch: createDeadlineFetch(dependencies.fetch ?? fetch, {
          timeoutMs,
          signal: dependencies.signal,
        }),
      },
    });
    const { error } = await client.auth.admin.deleteUser(accountId, false);
    if (error) throw new GuestAdminError('GUEST_ADMIN_UNAVAILABLE');
  } catch (error) {
    if (error instanceof GuestAdminError) throw error;
    throw new GuestAdminError('GUEST_ADMIN_UNAVAILABLE');
  }
}
