export interface MutationRequestMetadata {
  contentType: string | null | undefined;
  origin: string | null | undefined;
  fetchSite: string | null | undefined;
  /** Cloudflareでは公開URLのoriginをそのまま指定する。 */
  expectedOrigin?: string;
  /** ローカル/tunnelではproxy前後のscheme差を許し、Hostだけを固定する。 */
  expectedHost?: string;
}

export interface MutationRequestProblem {
  status: 403 | 415;
  message: string;
}

/**
 * Cookie認証されたmutationをsame-origin JSON fetchに限定する。
 * application/jsonはcross-originのsimple requestにならず、Originも二重に照合する。
 */
export function mutationRequestProblem(
  metadata: MutationRequestMetadata,
): MutationRequestProblem | null {
  const mediaType = metadata.contentType?.split(';', 1)[0]?.trim().toLowerCase();
  if (mediaType !== 'application/json') {
    return {
      status: 415,
      message: 'Content-Type は application/json が必要です',
    };
  }
  if (!metadata.origin) {
    return { status: 403, message: 'Origin ヘッダが必要です' };
  }

  let origin: URL;
  try {
    origin = new URL(metadata.origin);
  } catch {
    return { status: 403, message: 'Origin が不正です' };
  }
  if (
    (metadata.expectedOrigin && origin.origin !== metadata.expectedOrigin) ||
    (metadata.expectedHost && origin.host !== metadata.expectedHost)
  ) {
    return { status: 403, message: '別originからの操作は許可されていません' };
  }
  if (
    metadata.fetchSite &&
    metadata.fetchSite.toLowerCase() !== 'same-origin'
  ) {
    return { status: 403, message: 'cross-siteの操作は許可されていません' };
  }
  return null;
}
