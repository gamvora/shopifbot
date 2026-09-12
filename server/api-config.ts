/**
 * API Configuration - Check APIs for different scenarios
 */

// Default API (without proxy)
export const DEFAULT_API = process.env.CHECK_API_URL || 'https://apicleen-production-d7b1.up.railway.app/api/check';

// Multiple APIs for proxy usage (load balancing)
export const PROXY_APIS = [
  'https://apicleen-production-4487.up.railway.app/api/check',
  'https://apicleen-production-d7b1.up.railway.app/api/check',
  'https://apicleen-production-1f1e.up.railway.app/api/check',
  'https://apicleen-production-69aa.up.railway.app/api/check',
  'https://apicleen-production-0554.up.railway.app/api/check',
  'https://apicleen-production-07de.up.railway.app/api/check',
];

/**
 * Select appropriate API based on proxy usage
 */
export function selectAPI(hasProxy: boolean): string {
  if (!hasProxy) {
    return DEFAULT_API;
  }
  
  // Use random API for proxy requests (load balancing)
  const randomIndex = Math.floor(Math.random() * PROXY_APIS.length);
  return PROXY_APIS[randomIndex];
}

/**
 * Build complete check URL
 */
export function buildCheckUrl(api: string, card: string, site: string, proxy?: string): string {
  // Ensure site has protocol
  let siteUrl = site;
  if (!siteUrl.startsWith('http://') && !siteUrl.startsWith('https://')) {
    siteUrl = `https://${siteUrl}`;
  }
  
  let url = `${api}?cc=${encodeURIComponent(card)}&site=${encodeURIComponent(siteUrl)}`;
  
  if (proxy && proxy.trim().length > 0) {
    url += `&proxy=${encodeURIComponent(proxy.trim())}`;
  }
  
  return url;
}
