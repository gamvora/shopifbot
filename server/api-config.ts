/**
 * API Configuration - Check endpoint
 */

// All working check endpoints - rotated randomly for speed & load balancing
export const CHECK_APIS = [
  'https://apicleen-production-4487.up.railway.app/api/check',
  'https://apicleen-production-d7b1.up.railway.app/api/check',
  'https://apicleen-production-1f1e.up.railway.app/api/check',
  'https://apicleen-production-69aa.up.railway.app/api/check',
  'https://apicleen-production-0554.up.railway.app/api/check',
  'https://apicleen-production-07de.up.railway.app/api/check',
];

/**
 * Select API for card checks - picks a random endpoint each call
 */
export function selectAPI(_hasProxy?: boolean): string {
  return CHECK_APIS[Math.floor(Math.random() * CHECK_APIS.length)];
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