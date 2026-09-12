/**
 * API Configuration - Check endpoint
 */

// Default API (single working endpoint)
export const DEFAULT_API = process.env.CHECK_API_URL || 'https://apicleen-production-d7b1.up.railway.app/api/check';

/**
 * Select API for card checks
 * A single reliable endpoint is used for both proxy and non-proxy requests.
 */
export function selectAPI(_hasProxy?: boolean): string {
  return DEFAULT_API;
}

/**
 * Build complete check URL using the exact format expected by the API:
 *   ?cc=4111111111111111|12|26|123&site=https://4dragongames.com&proxy=
 * The proxy parameter is always present (empty when no proxy is used).
 */
export function buildCheckUrl(api: string, card: string, site: string, proxy?: string): string {
  let siteUrl = site;
  if (!siteUrl.startsWith('http://') && !siteUrl.startsWith('https://')) {
    siteUrl = `https://${siteUrl}`;
  }

  const proxyValue = proxy && proxy.trim().length > 0 ? proxy.trim() : '';

  return `${api}?cc=${card}&site=${siteUrl}&proxy=${proxyValue}`;
}