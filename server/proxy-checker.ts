/**
 * Proxy Checker - فحص الـ proxies بشكل حقيقي
 * Version 2: Fixed import and working properly
 */

import * as http from 'http';
import { HttpProxyAgent } from 'http-proxy-agent';

interface ProxyCheckResult {
  isValid: boolean;
  latency?: number;
  error?: string;
  type?: string;
  details?: string;
}

/**
 * استخراج معلومات الـ proxy من الـ string
 */
function parseProxyString(proxyStr: string): {
  host: string;
  port: number;
  username?: string;
  password?: string;
  error?: string;
} {
  try {
    const parts = proxyStr.split(':');
    
    if (parts.length < 2) {
      return { 
        host: '', 
        port: 0, 
        error: 'Invalid format. Expected IP:PORT or IP:PORT:username:password' 
      };
    }
    
    const host = parts[0].trim();
    const portStr = parts[1].trim();
    const port = parseInt(portStr, 10);
    
    if (!host || isNaN(port) || port < 1 || port > 65535) {
      return { 
        host: '', 
        port: 0, 
        error: `Invalid IP or port. Host="${host}", Port=${port}` 
      };
    }
    
    let username: string | undefined;
    let password: string | undefined;
    
    if (parts.length >= 4) {
      username = parts[2].trim();
      password = parts[3].trim();
    }
    
    return { host, port, username, password };
  } catch (error: any) {
    return { 
      host: '', 
      port: 0, 
      error: `Parse error: ${error.message}` 
    };
  }
}

/**
 * فحص الـ proxy بإرسال طلب عبره
 */
export async function checkProxyValidity(
  proxyStr: string, 
  timeout: number = 10000
): Promise<ProxyCheckResult> {
  console.log(`[PROXY] Testing: ${proxyStr}`);
  
  try {
    const parsed = parseProxyString(proxyStr);
    
    if (parsed.error) {
      console.log(`[PROXY] ❌ Parse error: ${parsed.error}`);
      return { 
        isValid: false, 
        error: parsed.error,
        type: 'unknown'
      };
    }
    
    const { host, port, username, password } = parsed;
    
    let proxyUrl: string;
    let displayUrl: string;
    
    if (username && password) {
      proxyUrl = `http://${username}:${password}@${host}:${port}`;
      displayUrl = `http://${username}:****@${host}:${port}`;
      console.log(`[PROXY] Using authenticated proxy: ${displayUrl}`);
    } else {
      proxyUrl = `http://${host}:${port}`;
      displayUrl = proxyUrl;
      console.log(`[PROXY] Using basic proxy: ${displayUrl}`);
    }
    
    const start = Date.now();
    
    return new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        console.log(`[PROXY] ❌ Timeout after ${timeout}ms`);
        resolve({ 
          isValid: false, 
          error: 'Timeout',
          type: 'http'
        });
      }, timeout);
      
      try {
        console.log(`[PROXY] Creating agent and sending request...`);
        
        const agent = new HttpProxyAgent(proxyUrl);
        
        const options = {
          hostname: 'httpbin.org',
          path: '/ip',
          method: 'GET',
          agent: agent,
          timeout: Math.max(timeout - 1000, 5000),
          headers: {
            'User-Agent': 'ProxyChecker/1.0'
          }
        };
        
        const req = http.request(options, (res) => {
          clearTimeout(timeoutId);
          
          const latency = Date.now() - start;
          console.log(`[PROXY] Response: ${res.statusCode} (${latency}ms)`);
          
          let data = '';
          res.on('data', chunk => {
            data += chunk;
          });
          
          res.on('end', () => {
            if (res.statusCode === 200) {
              console.log(`[PROXY] ✅ Valid: ${proxyStr} (${latency}ms)`);
              resolve({ 
                isValid: true, 
                latency,
                type: 'http'
              });
            } else {
              console.log(`[PROXY] ❌ Invalid HTTP ${res.statusCode}`);
              resolve({ 
                isValid: false, 
                error: `HTTP ${res.statusCode}`,
                type: 'http'
              });
            }
          });
        });
        
        req.on('error', (error: any) => {
          clearTimeout(timeoutId);
          console.log(`[PROXY] ❌ Error: ${error.code} - ${error.message}`);
          resolve({ 
            isValid: false, 
            error: error.message || 'Connection error',
            type: 'http'
          });
        });
        
        req.on('timeout', () => {
          clearTimeout(timeoutId);
          req.destroy();
          console.log(`[PROXY] ❌ Timeout`);
          resolve({ 
            isValid: false, 
            error: 'Request timeout',
            type: 'http'
          });
        });
        
        req.end();
      } catch (error: any) {
        clearTimeout(timeoutId);
        console.log(`[PROXY] ❌ Exception: ${error.message}`);
        resolve({ 
          isValid: false, 
          error: error.message,
          type: 'unknown'
        });
      }
    });
  } catch (error: any) {
    console.error(`[PROXY] ❌ Unexpected error: ${error.message}`);
    return { 
      isValid: false, 
      error: error.message,
      type: 'unknown'
    };
  }
}

/**
 * فحص عدة proxies بالتوازي
 */
export async function checkMultipleProxies(proxies: string[]): Promise<Map<string, ProxyCheckResult>> {
  const results = new Map<string, ProxyCheckResult>();
  
  const checks = proxies.map(proxy => 
    checkProxyValidity(proxy)
      .then(result => results.set(proxy, result))
      .catch(error => results.set(proxy, { 
        isValid: false, 
        error: error.message,
        type: 'unknown'
      }))
  );
  
  await Promise.all(checks);
  return results;
}

/**
 * استخراج الـ proxies الصحيحة من النتائج
 */
export function getValidProxies(results: Map<string, ProxyCheckResult>): string[] {
  return Array.from(results.entries())
    .filter(([_, result]) => result.isValid)
    .map(([proxy, _]) => proxy);
}
