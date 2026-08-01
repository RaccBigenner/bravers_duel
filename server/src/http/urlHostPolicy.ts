function normalizedHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/\.$/u, '');
}

/** local HTTPで明示的に許すbrowser/server endpoint。 */
export function isExactLocalHostname(hostname: string): boolean {
  const normalized = normalizedHostname(hostname);
  return normalized === '127.0.0.1' || normalized === 'localhost' || normalized === '[::1]';
}

/** remote secretをloopback相当へ送らないため、127/8とlocalhost配下も含めて判定する。 */
export function isLoopbackHostname(hostname: string): boolean {
  const normalized = normalizedHostname(hostname);
  return (
    isExactLocalHostname(normalized) ||
    normalized.endsWith('.localhost') ||
    /^127(?:\.[0-9]{1,3}){3}$/u.test(normalized)
  );
}
