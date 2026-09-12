/**
 * Proxy Checker - فحص الـ proxies بشكل حقيقي
 * Version 3: raw TCP implementation using net.Socket
 * No external agent dependencies -> runs on Node 18 (Railway) without ESM require issues
 */

import * as net from "net";

interface ProxyCheckResult {
  isValid: boolean;
  latency?: number;
  error?: string;
  type?: string;
  details?: string;
  ip1?: string;
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
    const parts = proxyStr.split(":");

    if (parts.length < 2) {
      return {
        host: "",
        port: 0,
        error: "Invalid format. Expected IP:PORT or IP:PORT:username:password",
      };
    }

    const host = parts[0].trim();
    const portStr = parts[1].trim();
    const port = parseInt(portStr, 10);

    if (!host || isNaN(port) || port < 1 || port > 65535) {
      return {
        host: "",
        port: 0,
        error: `Invalid IP or port. Host="${host}", Port=${port}`,
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
      host: "",
      port: 0,
      error: `Parse error: ${error.message}`,
    };
  }
}

/**
 * فحص الـ proxy بإرسال طلب HTTP عبره (طريقة proxy request بصيغة absolute-URI)
 */
export async function checkProxyValidity(
  proxyStr: string,
  timeout: number = 10000,
): Promise<ProxyCheckResult> {
  console.log(`[PROXY] Testing: ${proxyStr}`);

  try {
    const parsed = parseProxyString(proxyStr);

    if (parsed.error) {
      console.log(`[PROXY] ❌ Parse error: ${parsed.error}`);
      return {
        isValid: false,
        error: parsed.error,
        type: "unknown",
      };
    }

    const { host, port, username, password } = parsed;
    const start = Date.now();

    return new Promise((resolve) => {
      const socket = new net.Socket();
      let settled = false;
      let buffer = "";

      const finish = (result: ProxyCheckResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        socket.destroy();
        resolve(result);
      };

      const timeoutId = setTimeout(() => {
        console.log(`[PROXY] ❌ Timeout after ${timeout}ms`);
        finish({
          isValid: false,
          error: "Timeout",
          type: "http",
        });
      }, timeout);

      socket.setTimeout(Math.max(timeout - 1000, 5000));

      socket.on("connect", () => {
        const authHeader =
          username && password
            ? `Proxy-Authorization: Basic ${Buffer.from(
                `${username}:${password}`,
              ).toString("base64")}\r\n`
            : "";
        socket.write(
          `GET http://httpbin.org/ip HTTP/1.1\r\n` +
            `Host: httpbin.org\r\n` +
            authHeader +
            `Connection: close\r\n\r\n`,
        );
      });

      socket.on("data", (chunk) => {
        buffer += chunk.toString("utf8");
      });

      socket.on("close", () => {
        if (settled) return;
        const latency = Date.now() - start;
        const match = buffer.match(/^HTTP\/1\.[01] (\d{3})/);
        const status = match ? parseInt(match[1], 10) : 0;

        if (status === 200) {
          let ip1: string | undefined;
          try {
            const idx = buffer.indexOf("\r\n\r\n");
            const body = idx >= 0 ? buffer.slice(idx + 4) : buffer;
            ip1 = JSON.parse(body.trim()).origin;
          } catch (e) {
            // ignore body parse errors
          }
          console.log(`[PROXY] ✅ Valid: ${proxyStr} (${latency}ms) ip=${ip1}`);
          finish({ isValid: true, latency, type: "http", ip1 });
        } else if (buffer) {
          console.log(`[PROXY] ❌ Invalid HTTP response ${status}`);
          finish({
            isValid: false,
            error: `HTTP ${status || "bad response"}`,
            type: "http",
          });
        } else {
          console.log(`[PROXY] ❌ Connection closed without response (${latency}ms)`);
          finish({ isValid: false, error: "Connection closed", type: "http" });
        }
      });

      socket.on("timeout", () => {
        console.log(`[PROXY] ❌ Socket timeout`);
        finish({ isValid: false, error: "Request timeout", type: "http" });
      });

      socket.on("error", (error: any) => {
        console.log(`[PROXY] ❌ Error: ${error.code} - ${error.message}`);
        finish({
          isValid: false,
          error: error.message || "Connection error",
          type: "http",
        });
      });

      socket.connect(port, host);
    });
  } catch (error: any) {
    console.error(`[PROXY] ❌ Unexpected error: ${error.message}`);
    return {
      isValid: false,
      error: error.message,
      type: "unknown",
    };
  }
}

/**
 * فحص عدة proxies بالتوازي
 */
export async function checkMultipleProxies(proxies: string[]): Promise<Map<string, ProxyCheckResult>> {
  const results = new Map<string, ProxyCheckResult>();

  const checks = proxies.map((proxy) =>
    checkProxyValidity(proxy)
      .then((result) => results.set(proxy, result))
      .catch((error) =>
        results.set(proxy, {
          isValid: false,
          error: error.message,
          type: "unknown",
        }),
      ),
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