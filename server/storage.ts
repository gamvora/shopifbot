import fs from "fs";
import path from "path";
import { Pool } from "pg";
import {
  type Settings,
  type InsertSettings,
  type CheckResult,
  type User,
  type InsertUser,
  type Site,
  type InsertSite,
  type Proxy,
  type InsertProxy,
  type CheckSession,
  type InsertCheckSession,
  type CreditTransaction,
  type Referral,
  type DailySpin,
  type DailyStreak,
  type NotificationSettings,
  type InsertNotificationSettings,
  type RedeemCode,
  ADMIN_TELEGRAM_ID,
} from "@shared/schema";

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function getFilePath(filename: string): string {
  return path.join(DATA_DIR, `${filename}.json`);
}

function readJSON<T>(filename: string): T[] {
  const filePath = getFilePath(filename);
  if (!fs.existsSync(filePath)) {
    return [];
  }
  const data = fs.readFileSync(filePath, "utf-8");
  return JSON.parse(data);
}

function writeJSON<T>(filename: string, data: T[]): void {
  const filePath = getFilePath(filename);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

function generateId(items: { id: number }[]): number {
  if (items.length === 0) return 1;
  return Math.max(...items.map((item) => item.id)) + 1;
}

function generateRedeemCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

export interface IStorage {
  // Users
  getUserByTelegramId(telegramId: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  getOrCreateUser(user: InsertUser): Promise<User>;
  updateUser(telegramId: string, data: Partial<InsertUser>): Promise<User | undefined>;
  updateUserCredits(telegramId: string, amount: number): Promise<User | undefined>;
  updateUserStats(telegramId: string, charged: number, rejected: number): Promise<void>;
  markTutorialSeen(telegramId: string): Promise<User | undefined>;

  // Sites
  getUserSites(userId: number): Promise<Site[]>;
  getActiveSite(userId: number): Promise<Site | undefined>;
  getSiteById(id: number): Promise<Site | undefined>;
  addSite(site: InsertSite): Promise<Site>;
  updateSite(id: number, data: Partial<InsertSite>): Promise<Site | undefined>;
  deleteSite(id: number): Promise<void>;
  setActiveSite(userId: number, siteId: number): Promise<void>;
  updateSitePrice(siteId: number, price: string): Promise<void>;

  // Proxies
  getUserProxies(userId: number): Promise<Proxy[]>;
  addProxy(proxy: InsertProxy): Promise<Proxy>;
  updateProxy(id: number, data: Partial<InsertProxy>): Promise<void>;
  deleteProxy(id: number): Promise<void>;
  deleteAllUserProxies(userId: number): Promise<void>;

  // Settings (global fallback)
  getSettings(): Promise<Settings | undefined>;
  updateSettings(newSettings: InsertSettings): Promise<Settings>;

  // Results
  addResult(result: { card: string; status: string; message?: string; userId?: number; sessionId?: string }): Promise<CheckResult>;
  getResults(limit?: number, userId?: number): Promise<CheckResult[]>;
  clearResults(userId?: number): Promise<void>;

  // Check Sessions
  createCheckSession(session: InsertCheckSession): Promise<CheckSession>;
  updateCheckSession(sessionId: string, data: Partial<InsertCheckSession>): Promise<void>;
  getCheckSession(sessionId: string): Promise<CheckSession | undefined>;

  // Credit Transactions
  addCreditTransaction(userId: number, amount: number, type: string, description?: string, adminId?: string): Promise<CreditTransaction>;
  getCreditTransactions(userId: number, limit?: number): Promise<CreditTransaction[]>;

  // Redeem Codes
  createRedeemCode(credits: number, createdBy: string): Promise<RedeemCode>;
  getRedeemCode(code: string): Promise<RedeemCode | undefined>;
  redeemCode(code: string, userId: number, telegramId: string): Promise<{ status: 'success'; code: RedeemCode; user: User } | { status: 'invalid' } | { status: 'used' }>;

  // Global Stats & Leaderboard
  getGlobalStats(): Promise<{ totalCards: number; totalLive: number; totalDead: number; hitRate: number }>;
  getLeaderboard(limit?: number): Promise<Array<{ userId: number; username: string | null; firstName: string | null; lastName: string | null; photoUrl: string | null; totalCharged: number; rank: number }>>;

  // Referrals
  getUserByReferralCode(code: string): Promise<User | undefined>;
  createReferral(referrerId: number, referredId: number, code: string): Promise<Referral>;
  getReferralsByUser(userId: number): Promise<Referral[]>;
  getReferralCount(userId: number): Promise<number>;
  generateReferralCode(userId: number): Promise<string>;

  // Daily Spin
  getLastSpin(userId: number): Promise<DailySpin | undefined>;
  canSpinToday(userId: number): Promise<boolean>;
  recordSpin(userId: number, creditsWon: number): Promise<DailySpin>;

  // Daily Streak
  getStreak(userId: number): Promise<DailyStreak | undefined>;
  claimStreak(userId: number): Promise<{ streak: DailyStreak; reward: number; canClaim: boolean }>;

  // Notification Settings
  getNotificationSettings(userId: number): Promise<NotificationSettings | undefined>;
  updateNotificationSettings(userId: number, settings: Partial<NotificationSettings>): Promise<NotificationSettings>;
}

export class FileStorage implements IStorage {
  // Users
  async getUserByTelegramId(telegramId: string): Promise<User | undefined> {
    const users = readJSON<User>("users");
    return users.find((u) => u.telegramId === telegramId);
  }

  async createUser(user: InsertUser): Promise<User> {
    const users = readJSON<User>("users");
    const isAdmin = user.telegramId === ADMIN_TELEGRAM_ID;
    const newUser: User = {
      id: generateId(users),
      telegramId: user.telegramId,
      username: user.username,
      firstName: user.firstName,
      lastName: user.lastName,
      photoUrl: user.photoUrl,
      credits: isAdmin ? 999999 : (user.credits || 0),
      totalCharged: user.totalCharged || 0,
      totalRejected: user.totalRejected || 0,
      isAdmin,
      hasSeenTutorial: user.hasSeenTutorial || false,
      referralCode: user.referralCode,
      referredBy: user.referredBy,
      createdAt: new Date(),
      lastActiveAt: new Date(),
    };
    users.push(newUser);
    writeJSON("users", users);
    return newUser;
  }

  async getOrCreateUser(user: InsertUser): Promise<User> {
    const existing = await this.getUserByTelegramId(user.telegramId);
    if (existing) {
      return existing;
    }
    return this.createUser(user);
  }

  async updateUser(telegramId: string, data: Partial<InsertUser>): Promise<User | undefined> {
    const users = readJSON<User>("users");
    const index = users.findIndex((u) => u.telegramId === telegramId);
    if (index === -1) return undefined;

    users[index] = {
      ...users[index],
      ...data,
      lastActiveAt: new Date(),
    };
    writeJSON("users", users);
    return users[index];
  }

  async updateUserCredits(telegramId: string, amount: number): Promise<User | undefined> {
    const user = await this.getUserByTelegramId(telegramId);
    if (!user) return undefined;

    const newCredits = Math.max(0, user.credits + amount);
    const users = readJSON<User>("users");
    const index = users.findIndex((u) => u.telegramId === telegramId);
    if (index === -1) return undefined;

    users[index] = {
      ...users[index],
      credits: newCredits,
      lastActiveAt: new Date(),
    };
    writeJSON("users", users);
    return users[index];
  }

  async updateUserStats(telegramId: string, charged: number, rejected: number): Promise<void> {
    const user = await this.getUserByTelegramId(telegramId);
    if (!user) return;

    const users = readJSON<User>("users");
    const index = users.findIndex((u) => u.telegramId === telegramId);
    if (index === -1) return;

    users[index] = {
      ...users[index],
      totalCharged: user.totalCharged + charged,
      totalRejected: user.totalRejected + rejected,
      lastActiveAt: new Date(),
    };
    writeJSON("users", users);
  }

  async markTutorialSeen(telegramId: string): Promise<User | undefined> {
    const users = readJSON<User>("users");
    const index = users.findIndex((u) => u.telegramId === telegramId);
    if (index === -1) return undefined;

    users[index] = {
      ...users[index],
      hasSeenTutorial: true,
      lastActiveAt: new Date(),
    };
    writeJSON("users", users);
    return users[index];
  }

  // Sites
  async getUserSites(userId: number): Promise<Site[]> {
    const sites = readJSON<Site>("sites");
    return sites
      .filter((s) => s.userId === userId || s.isGlobal)
      .sort((a, b) => {
        const globalDiff = (b.isGlobal ? 1 : 0) - (a.isGlobal ? 1 : 0);
        if (globalDiff !== 0) return globalDiff;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });
  }

  async getActiveSite(userId: number): Promise<Site | undefined> {
    const sites = readJSON<Site>("sites");
    const personal = sites.find((s) => s.userId === userId && s.isActive);
    if (personal) return personal;
    return sites
      .filter((s) => s.isGlobal)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
  }

  async getSiteById(id: number): Promise<Site | undefined> {
    const sites = readJSON<Site>("sites");
    return sites.find((s) => s.id === id);
  }

  async addSite(site: InsertSite): Promise<Site> {
    const sites = readJSON<Site>("sites");
    const newSite: Site = {
      id: generateId(sites),
      userId: site.userId,
      name: site.name,
      url: site.url,
      productPrice: site.productPrice,
      isActive: site.isActive || false,
      isGlobal: site.isGlobal || false,
      createdAt: new Date(),
    };
    sites.push(newSite);
    writeJSON("sites", sites);
    return newSite;
  }

  async updateSite(id: number, data: Partial<InsertSite>): Promise<Site | undefined> {
    const sites = readJSON<Site>("sites");
    const index = sites.findIndex((s) => s.id === id);
    if (index === -1) return undefined;

    sites[index] = {
      ...sites[index],
      ...data,
    };
    writeJSON("sites", sites);
    return sites[index];
  }

  async deleteSite(id: number): Promise<void> {
    const sites = readJSON<Site>("sites");
    const filtered = sites.filter((s) => s.id !== id);
    writeJSON("sites", filtered);
  }

  async setActiveSite(userId: number, siteId: number): Promise<void> {
    const sites = readJSON<Site>("sites");
    const updated = sites.map((s) => {
      if (s.userId === userId) {
        return { ...s, isActive: s.id === siteId };
      }
      return s;
    });
    writeJSON("sites", updated);
  }

  async updateSitePrice(siteId: number, price: string): Promise<void> {
    const sites = readJSON<Site>("sites");
    const index = sites.findIndex((s) => s.id === siteId);
    if (index !== -1) {
      sites[index].productPrice = price;
      writeJSON("sites", sites);
    }
  }

  // Proxies
  async getUserProxies(userId: number): Promise<Proxy[]> {
    const proxies = readJSON<Proxy>("proxies");
    return proxies
      .filter((p) => p.userId === userId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  async addProxy(proxy: InsertProxy): Promise<Proxy> {
    const proxies = readJSON<Proxy>("proxies");
    const newProxy: Proxy = {
      id: generateId(proxies),
      userId: proxy.userId,
      proxy: proxy.proxy,
      isValid: proxy.isValid ?? true,
      lastChecked: proxy.lastChecked,
      createdAt: new Date(),
    };
    proxies.push(newProxy);
    writeJSON("proxies", proxies);
    return newProxy;
  }

  async updateProxy(id: number, data: Partial<InsertProxy>): Promise<void> {
    const proxies = readJSON<Proxy>("proxies");
    const index = proxies.findIndex((p) => p.id === id);
    if (index !== -1) {
      proxies[index] = { ...proxies[index], ...data };
      writeJSON("proxies", proxies);
    }
  }

  async deleteProxy(id: number): Promise<void> {
    const proxies = readJSON<Proxy>("proxies");
    const filtered = proxies.filter((p) => p.id !== id);
    writeJSON("proxies", filtered);
  }

  async deleteAllUserProxies(userId: number): Promise<void> {
    const proxies = readJSON<Proxy>("proxies");
    const filtered = proxies.filter((p) => p.userId !== userId);
    writeJSON("proxies", filtered);
  }

  // Settings (global fallback)
  async getSettings(): Promise<Settings | undefined> {
    const settingsList = readJSON<Settings>("settings");
    return settingsList[0];
  }

  async updateSettings(newSettings: InsertSettings): Promise<Settings> {
    const settingsList = readJSON<Settings>("settings");
    if (settingsList.length > 0) {
      settingsList[0] = {
        ...settingsList[0],
        ...newSettings,
        updatedAt: new Date(),
      };
      writeJSON("settings", settingsList);
      return settingsList[0];
    } else {
      const newSetting: Settings = {
        id: 1,
        targetUrl: newSettings.targetUrl || "",
        proxyList: newSettings.proxyList || "",
        proxyEnabled: newSettings.proxyEnabled ?? true,
        updatedAt: new Date(),
      };
      settingsList.push(newSetting);
      writeJSON("settings", settingsList);
      return newSetting;
    }
  }

  // Results
  async addResult(result: { card: string; status: string; message?: string; userId?: number; sessionId?: string }): Promise<CheckResult> {
    const results = readJSON<CheckResult>("results");
    const newResult: CheckResult = {
      id: generateId(results),
      card: result.card,
      status: result.status,
      message: result.message || "",
      userId: result.userId,
      sessionId: result.sessionId,
      createdAt: new Date(),
    };
    results.push(newResult);
    writeJSON("results", results);
    return newResult;
  }

  async getResults(limit = 100, userId?: number): Promise<CheckResult[]> {
    const results = readJSON<CheckResult>("results");
    let filtered = results;
    if (userId) {
      filtered = results.filter((r) => r.userId === userId);
    }
    return filtered
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, limit);
  }

  async clearResults(userId?: number): Promise<void> {
    const results = readJSON<CheckResult>("results");
    if (userId) {
      const filtered = results.filter((r) => r.userId !== userId);
      writeJSON("results", filtered);
    } else {
      writeJSON("results", []);
    }
  }

  // Check Sessions
  async createCheckSession(session: InsertCheckSession): Promise<CheckSession> {
    const sessions = readJSON<CheckSession>("checkSessions");
    const newSession: CheckSession = {
      id: generateId(sessions),
      sessionId: session.sessionId,
      userId: session.userId,
      siteId: session.siteId,
      totalCards: session.totalCards || 0,
      processedCards: session.processedCards || 0,
      chargedCards: session.chargedCards || 0,
      rejectedCards: session.rejectedCards || 0,
      status: session.status || "pending",
      createdAt: new Date(),
    };
    sessions.push(newSession);
    writeJSON("checkSessions", sessions);
    return newSession;
  }

  async updateCheckSession(sessionId: string, data: Partial<InsertCheckSession>): Promise<void> {
    const sessions = readJSON<CheckSession>("checkSessions");
    const index = sessions.findIndex((s) => s.sessionId === sessionId);
    if (index !== -1) {
      sessions[index] = { ...sessions[index], ...data };
      writeJSON("checkSessions", sessions);
    }
  }

  async getCheckSession(sessionId: string): Promise<CheckSession | undefined> {
    const sessions = readJSON<CheckSession>("checkSessions");
    return sessions.find((s) => s.sessionId === sessionId);
  }

  // Credit Transactions
  async addCreditTransaction(userId: number, amount: number, type: string, description?: string, adminId?: string): Promise<CreditTransaction> {
    const transactions = readJSON<CreditTransaction>("creditTransactions");
    const newTransaction: CreditTransaction = {
      id: generateId(transactions),
      userId,
      amount,
      type,
      description,
      adminId,
      createdAt: new Date(),
    };
    transactions.push(newTransaction);
    writeJSON("creditTransactions", transactions);
    return newTransaction;
  }

  async getCreditTransactions(userId: number, limit = 50): Promise<CreditTransaction[]> {
    const transactions = readJSON<CreditTransaction>("creditTransactions");
    return transactions
      .filter((t) => t.userId === userId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, limit);
  }

  // Redeem Codes
  async createRedeemCode(credits: number, createdBy: string): Promise<RedeemCode> {
    const codes = readJSON<RedeemCode>("redeemCodes");
    let candidate = generateRedeemCode();
    while (codes.some((c) => c.code === candidate)) {
      candidate = generateRedeemCode();
    }
    const newCode: RedeemCode = {
      id: generateId(codes),
      code: candidate,
      credits,
      createdBy,
      createdAt: new Date(),
    };
    codes.push(newCode);
    writeJSON("redeemCodes", codes);
    return newCode;
  }

  async getRedeemCode(code: string): Promise<RedeemCode | undefined> {
    const codes = readJSON<RedeemCode>("redeemCodes");
    return codes.find((c) => c.code === code.toUpperCase());
  }

  async redeemCode(code: string, userId: number, telegramId: string): Promise<{ status: 'success'; code: RedeemCode; user: User } | { status: 'invalid' } | { status: 'used' }> {
    const codes = readJSON<RedeemCode>("redeemCodes");
    const index = codes.findIndex((c) => c.code === code.toUpperCase());
    if (index === -1) {
      return { status: "invalid" };
    }
    if (codes[index].userId) {
      return { status: "used" };
    }
    codes[index] = { ...codes[index], userId, usedAt: new Date() };
    writeJSON("redeemCodes", codes);
    const credits = codes[index].credits;
    const updatedUser = await this.updateUserCredits(telegramId, credits);
    await this.addCreditTransaction(userId, credits, "redeem", `Redeemed code ${codes[index].code}`, undefined);
    return { status: "success", code: codes[index], user: updatedUser! };
  }

  async getGlobalStats(): Promise<{ totalCards: number; totalLive: number; totalDead: number; hitRate: number }> {
    const users = readJSON<User>("users");
    const totalLive = users.reduce((sum, u) => sum + u.totalCharged, 0);
    const totalDead = users.reduce((sum, u) => sum + u.totalRejected, 0);
    const totalCards = totalLive + totalDead;
    const hitRate = totalCards > 0 ? (totalLive / totalCards) * 100 : 0;
    return { totalCards, totalLive, totalDead, hitRate };
  }

  async getLeaderboard(limit = 10): Promise<Array<{ userId: number; username: string | null; firstName: string | null; lastName: string | null; photoUrl: string | null; totalCharged: number; rank: number }>> {
    const users = readJSON<User>("users");
    const sorted = users
      .sort((a, b) => b.totalCharged - a.totalCharged)
      .slice(0, limit);
    return sorted.map((user, index) => ({
      userId: user.id,
      username: user.username || null,
      firstName: user.firstName || null,
      lastName: user.lastName || null,
      photoUrl: user.photoUrl || null,
      totalCharged: user.totalCharged,
      rank: index + 1,
    }));
  }

  // Referrals
  async getUserByReferralCode(code: string): Promise<User | undefined> {
    const users = readJSON<User>("users");
    return users.find((u) => u.referralCode === code);
  }

  async createReferral(referrerId: number, referredId: number, code: string): Promise<Referral> {
    const referrals = readJSON<Referral>("referrals");
    const newReferral: Referral = {
      id: generateId(referrals),
      referrerId,
      referredId,
      referralCode: code,
      creditsAwarded: 100,
      createdAt: new Date(),
    };
    referrals.push(newReferral);
    writeJSON("referrals", referrals);
    return newReferral;
  }

  async getReferralsByUser(userId: number): Promise<Referral[]> {
    const referrals = readJSON<Referral>("referrals");
    return referrals
      .filter((r) => r.referrerId === userId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  async getReferralCount(userId: number): Promise<number> {
    const referrals = readJSON<Referral>("referrals");
    return referrals.filter((r) => r.referrerId === userId).length;
  }

  async generateReferralCode(userId: number): Promise<string> {
    const users = readJSON<User>("users");
    const user = users.find((u) => u.id === userId);
    if (user?.referralCode) {
      return user.referralCode;
    }
    const code = "NX" + Math.random().toString(36).substring(2, 8).toUpperCase();
    const index = users.findIndex((u) => u.id === userId);
    if (index !== -1) {
      users[index].referralCode = code;
      writeJSON("users", users);
    }
    return code;
  }

  // Daily Spin
  async getLastSpin(userId: number): Promise<DailySpin | undefined> {
    const spins = readJSON<DailySpin>("dailySpins");
    const userSpins = spins
      .filter((s) => s.userId === userId)
      .sort((a, b) => new Date(b.spinDate).getTime() - new Date(a.spinDate).getTime());
    return userSpins[0];
  }

  async canSpinToday(userId: number): Promise<boolean> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const spins = readJSON<DailySpin>("dailySpins");
    const hasSpunToday = spins.some(
      (s) => s.userId === userId && new Date(s.spinDate) >= today
    );
    return !hasSpunToday;
  }

  async recordSpin(userId: number, creditsWon: number): Promise<DailySpin> {
    const spins = readJSON<DailySpin>("dailySpins");
    const newSpin: DailySpin = {
      id: generateId(spins),
      userId,
      creditsWon,
      spinDate: new Date(),
    };
    spins.push(newSpin);
    writeJSON("dailySpins", spins);
    return newSpin;
  }

  // Daily Streak
  async getStreak(userId: number): Promise<DailyStreak | undefined> {
    const streaks = readJSON<DailyStreak>("dailyStreaks");
    return streaks.find((s) => s.userId === userId);
  }

  async claimStreak(userId: number): Promise<{ streak: DailyStreak; reward: number; canClaim: boolean }> {
    const streaks = readJSON<DailyStreak>("dailyStreaks");
    const existingIndex = streaks.findIndex((s) => s.userId === userId);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const streakRewards: { [key: number]: number } = {
      1: 30, 2: 30, 3: 45, 4: 45, 5: 45, 6: 45, 7: 70,
      8: 70, 9: 70, 10: 70, 11: 70, 12: 70, 13: 70, 14: 110,
      15: 110, 16: 110, 17: 110, 18: 110, 19: 110, 20: 110,
      21: 110, 22: 110, 23: 110, 24: 110, 25: 110, 26: 110,
      27: 110, 28: 110, 29: 110, 30: 210,
    };

    if (existingIndex === -1) {
      const newStreak: DailyStreak = {
        id: generateId(streaks),
        userId,
        currentStreak: 1,
        longestStreak: 1,
        lastClaimDate: now,
        totalClaimed: 1,
      };
      streaks.push(newStreak);
      writeJSON("dailyStreaks", streaks);
      const reward = streakRewards[1] || 30;
      return { streak: newStreak, reward, canClaim: true };
    }

    const streak = streaks[existingIndex];
    const lastClaim = streak.lastClaimDate ? new Date(streak.lastClaimDate) : null;
    const lastClaimDate = lastClaim ? new Date(lastClaim.getFullYear(), lastClaim.getMonth(), lastClaim.getDate()) : null;

    if (lastClaimDate && lastClaimDate.getTime() === today.getTime()) {
      return { streak, reward: 0, canClaim: false };
    }

    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    let newStreakValue = 1;
    if (lastClaimDate && lastClaimDate.getTime() === yesterday.getTime()) {
      newStreakValue = Math.min(streak.currentStreak + 1, 30);
    }

    const reward = streakRewards[newStreakValue] || 30;
    const longestStreak = Math.max(streak.longestStreak, newStreakValue);

    const updatedStreak: DailyStreak = {
      ...streak,
      currentStreak: newStreakValue,
      longestStreak,
      lastClaimDate: now,
      totalClaimed: streak.totalClaimed + 1,
    };

    streaks[existingIndex] = updatedStreak;
    writeJSON("dailyStreaks", streaks);

    return { streak: updatedStreak, reward, canClaim: true };
  }

  // Notification Settings
  async getNotificationSettings(userId: number): Promise<NotificationSettings | undefined> {
    const settings = readJSON<NotificationSettings>("notificationSettings");
    return settings.find((s) => s.userId === userId);
  }

  async updateNotificationSettings(userId: number, newSettings: Partial<NotificationSettings>): Promise<NotificationSettings> {
    const settings = readJSON<NotificationSettings>("notificationSettings");
    const existingIndex = settings.findIndex((s) => s.userId === userId);

    if (existingIndex !== -1) {
      settings[existingIndex] = {
        ...settings[existingIndex],
        ...newSettings,
        updatedAt: new Date(),
      };
      writeJSON("notificationSettings", settings);
      return settings[existingIndex];
    }

    const created: NotificationSettings = {
      id: generateId(settings),
      userId,
      approvedAlerts: newSettings.approvedAlerts ?? true,
      dailySummary: newSettings.dailySummary ?? false,
      streakReminder: newSettings.streakReminder ?? true,
      updatedAt: new Date(),
    };
    settings.push(created);
    writeJSON("notificationSettings", settings);
    return created;
  }
}

// === PostgreSQL Storage ===

function toUser(r: any): User {
  return {
    id: r.id,
    telegramId: r.telegram_id,
    username: r.username ?? undefined,
    firstName: r.first_name ?? undefined,
    lastName: r.last_name ?? undefined,
    photoUrl: r.photo_url ?? undefined,
    credits: r.credits,
    totalCharged: r.total_charged,
    totalRejected: r.total_rejected,
    isAdmin: r.is_admin,
    hasSeenTutorial: r.has_seen_tutorial,
    referralCode: r.referral_code ?? undefined,
    referredBy: r.referred_by ?? undefined,
    createdAt: r.created_at,
    lastActiveAt: r.last_active_at,
  };
}

function toSite(r: any): Site {
  return {
    id: r.id,
    userId: r.user_id,
    name: r.name,
    url: r.url,
    productPrice: r.product_price ?? undefined,
    isActive: r.is_active,
    isGlobal: !!r.is_global,
    createdAt: r.created_at,
  };
}

function toProxy(r: any): Proxy {
  return {
    id: r.id,
    userId: r.user_id,
    proxy: r.proxy,
    isValid: r.is_valid,
    lastChecked: r.last_checked ?? undefined,
    createdAt: r.created_at,
  };
}

function toSettings(r: any): Settings {
  return {
    id: r.id,
    targetUrl: r.target_url,
    proxyList: r.proxy_list,
    proxyEnabled: r.proxy_enabled,
    updatedAt: r.updated_at,
  };
}

function toResult(r: any): CheckResult {
  return {
    id: r.id,
    userId: r.user_id ?? undefined,
    sessionId: r.session_id ?? undefined,
    card: r.card,
    status: r.status,
    message: r.message ?? undefined,
    createdAt: r.created_at,
  };
}

function toCheckSession(r: any): CheckSession {
  return {
    id: r.id,
    sessionId: r.session_id,
    userId: r.user_id,
    siteId: r.site_id ?? undefined,
    totalCards: r.total_cards,
    processedCards: r.processed_cards,
    chargedCards: r.charged_cards,
    rejectedCards: r.rejected_cards,
    status: r.status,
    createdAt: r.created_at,
    completedAt: r.completed_at ?? undefined,
  };
}

function toCreditTransaction(r: any): CreditTransaction {
  return {
    id: r.id,
    userId: r.user_id,
    amount: r.amount,
    type: r.type,
    description: r.description ?? undefined,
    adminId: r.admin_id ?? undefined,
    createdAt: r.created_at,
  };
}

function toRedeemCode(r: any): RedeemCode {
  return {
    id: r.id,
    code: r.code,
    credits: r.credits,
    userId: r.user_id ?? undefined,
    usedAt: r.used_at ?? undefined,
    createdBy: r.created_by,
    createdAt: r.created_at,
  };
}

function toReferral(r: any): Referral {
  return {
    id: r.id,
    referrerId: r.referrer_id,
    referredId: r.referred_id,
    referralCode: r.referral_code,
    creditsAwarded: r.credits_awarded,
    createdAt: r.created_at,
  };
}

function toDailySpin(r: any): DailySpin {
  return {
    id: r.id,
    userId: r.user_id,
    creditsWon: r.credits_won,
    spinDate: r.spin_date,
  };
}

function toDailyStreak(r: any): DailyStreak {
  return {
    id: r.id,
    userId: r.user_id,
    currentStreak: r.current_streak,
    longestStreak: r.longest_streak,
    lastClaimDate: r.last_claim_date ?? undefined,
    totalClaimed: r.total_claimed,
  };
}

function toNotificationSettings(r: any): NotificationSettings {
  return {
    id: r.id,
    userId: r.user_id,
    approvedAlerts: r.approved_alerts,
    dailySummary: r.daily_summary,
    streakReminder: r.streak_reminder,
    updatedAt: r.updated_at,
  };
}

export class PostgresStorage implements IStorage {
  private pool: Pool;

  constructor(databaseUrl: string) {
    this.pool = new Pool({
      connectionString: databaseUrl,
      // Railway internal Postgres is plain TCP; only use SSL when explicitly requested
      ssl: databaseUrl.includes("railway.internal") ? false : undefined,
    });
    this.init().catch((err) => {
      console.error("[PG] ⚠️ Failed to initialize schema:", err);
    });
  }

  private async init(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        telegram_id TEXT UNIQUE NOT NULL,
        username TEXT,
        first_name TEXT,
        last_name TEXT,
        photo_url TEXT,
        credits INTEGER NOT NULL DEFAULT 0,
        total_charged INTEGER NOT NULL DEFAULT 0,
        total_rejected INTEGER NOT NULL DEFAULT 0,
        is_admin BOOLEAN NOT NULL DEFAULT false,
        has_seen_tutorial BOOLEAN NOT NULL DEFAULT false,
        referral_code TEXT,
        referred_by INTEGER,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS sites (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        url TEXT NOT NULL,
        product_price TEXT,
        is_active BOOLEAN NOT NULL DEFAULT false,
        is_global BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      ALTER TABLE sites ADD COLUMN IF NOT EXISTS is_global BOOLEAN NOT NULL DEFAULT false;
      CREATE TABLE IF NOT EXISTS proxies (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        proxy TEXT NOT NULL,
        is_valid BOOLEAN NOT NULL DEFAULT true,
        last_checked TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS settings (
        id SERIAL PRIMARY KEY,
        target_url TEXT NOT NULL DEFAULT '',
        proxy_list TEXT NOT NULL DEFAULT '',
        proxy_enabled BOOLEAN NOT NULL DEFAULT true,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS results (
        id SERIAL PRIMARY KEY,
        user_id INTEGER,
        session_id TEXT,
        card TEXT NOT NULL,
        status TEXT NOT NULL,
        message TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS check_sessions (
        id SERIAL PRIMARY KEY,
        session_id TEXT NOT NULL,
        user_id INTEGER NOT NULL,
        site_id INTEGER,
        total_cards INTEGER NOT NULL DEFAULT 0,
        processed_cards INTEGER NOT NULL DEFAULT 0,
        charged_cards INTEGER NOT NULL DEFAULT 0,
        rejected_cards INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        completed_at TIMESTAMPTZ
      );
      CREATE TABLE IF NOT EXISTS credit_transactions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        amount INTEGER NOT NULL,
        type TEXT NOT NULL,
        description TEXT,
        admin_id TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS referrals (
        id SERIAL PRIMARY KEY,
        referrer_id INTEGER NOT NULL,
        referred_id INTEGER NOT NULL,
        referral_code TEXT NOT NULL,
        credits_awarded INTEGER NOT NULL DEFAULT 100,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS daily_spins (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        credits_won INTEGER NOT NULL,
        spin_date TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS daily_streaks (
        id SERIAL PRIMARY KEY,
        user_id INTEGER UNIQUE NOT NULL,
        current_streak INTEGER NOT NULL DEFAULT 1,
        longest_streak INTEGER NOT NULL DEFAULT 1,
        last_claim_date TIMESTAMPTZ,
        total_claimed INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS notification_settings (
        id SERIAL PRIMARY KEY,
        user_id INTEGER UNIQUE NOT NULL,
        approved_alerts BOOLEAN NOT NULL DEFAULT true,
        daily_summary BOOLEAN NOT NULL DEFAULT false,
        streak_reminder BOOLEAN NOT NULL DEFAULT true,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS redeem_codes (
        id SERIAL PRIMARY KEY,
        code TEXT UNIQUE NOT NULL,
        credits INTEGER NOT NULL,
        user_id INTEGER,
        used_at TIMESTAMPTZ,
        created_by TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    console.log("[PG] ✅ Schema ready");
  }

  // Users
  async getUserByTelegramId(telegramId: string): Promise<User | undefined> {
    const res = await this.pool.query("SELECT * FROM users WHERE telegram_id = $1", [telegramId]);
    return res.rows[0] ? toUser(res.rows[0]) : undefined;
  }

  async createUser(user: InsertUser): Promise<User> {
    const isAdmin = user.telegramId === ADMIN_TELEGRAM_ID;
    const res = await this.pool.query(
      `INSERT INTO users
        (telegram_id, username, first_name, last_name, photo_url, credits, total_charged, total_rejected, is_admin, has_seen_tutorial, referral_code, referred_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING *`,
      [
        user.telegramId,
        user.username ?? null,
        user.firstName ?? null,
        user.lastName ?? null,
        user.photoUrl ?? null,
        isAdmin ? 999999 : (user.credits || 0),
        user.totalCharged || 0,
        user.totalRejected || 0,
        isAdmin,
        user.hasSeenTutorial || false,
        user.referralCode ?? null,
        user.referredBy ?? null,
      ],
    );
    return toUser(res.rows[0]);
  }

  async getOrCreateUser(user: InsertUser): Promise<User> {
    const existing = await this.getUserByTelegramId(user.telegramId);
    if (existing) return existing;
    return this.createUser(user);
  }

  async updateUser(telegramId: string, data: Partial<InsertUser>): Promise<User | undefined> {
    const sets: string[] = [];
    const values: any[] = [];
    const map: Record<string, string> = {
      username: "username",
      firstName: "first_name",
      lastName: "last_name",
      photoUrl: "photo_url",
      credits: "credits",
      totalCharged: "total_charged",
      totalRejected: "total_rejected",
      isAdmin: "is_admin",
      hasSeenTutorial: "has_seen_tutorial",
      referralCode: "referral_code",
      referredBy: "referred_by",
    };
    for (const key of Object.keys(data)) {
      const col = map[key];
      if (!col) continue;
      values.push((data as any)[key]);
      sets.push(`${col} = $${values.length}`);
    }
    if (sets.length === 0) return undefined;
    values.push(telegramId);
    sets.push(`last_active_at = NOW()`);
    const res = await this.pool.query(
      `UPDATE users SET ${sets.join(", ")} WHERE telegram_id = $${values.length} RETURNING *`,
      values,
    );
    return res.rows[0] ? toUser(res.rows[0]) : undefined;
  }

  async updateUserCredits(telegramId: string, amount: number): Promise<User | undefined> {
    const res = await this.pool.query(
      `UPDATE users SET credits = GREATEST(0, credits + $1), last_active_at = NOW()
       WHERE telegram_id = $2 RETURNING *`,
      [amount, telegramId],
    );
    return res.rows[0] ? toUser(res.rows[0]) : undefined;
  }

  async updateUserStats(telegramId: string, charged: number, rejected: number): Promise<void> {
    await this.pool.query(
      `UPDATE users SET total_charged = total_charged + $1, total_rejected = total_rejected + $2, last_active_at = NOW()
       WHERE telegram_id = $3`,
      [charged, rejected, telegramId],
    );
  }

  async markTutorialSeen(telegramId: string): Promise<User | undefined> {
    const res = await this.pool.query(
      `UPDATE users SET has_seen_tutorial = true, last_active_at = NOW() WHERE telegram_id = $1 RETURNING *`,
      [telegramId],
    );
    return res.rows[0] ? toUser(res.rows[0]) : undefined;
  }

  // Sites
  async getUserSites(userId: number): Promise<Site[]> {
    const res = await this.pool.query(
      "SELECT * FROM sites WHERE user_id = $1 OR is_global = true ORDER BY is_global DESC, created_at DESC",
      [userId],
    );
    return res.rows.map(toSite);
  }

  async getActiveSite(userId: number): Promise<Site | undefined> {
    const personal = await this.pool.query(
      "SELECT * FROM sites WHERE user_id = $1 AND is_active = true LIMIT 1",
      [userId],
    );
    if (personal.rows[0]) {
      return toSite(personal.rows[0]);
    }
    const global = await this.pool.query(
      "SELECT * FROM sites WHERE is_global = true ORDER BY created_at DESC LIMIT 1",
    );
    return global.rows[0] ? toSite(global.rows[0]) : undefined;
  }

  async getSiteById(id: number): Promise<Site | undefined> {
    const res = await this.pool.query("SELECT * FROM sites WHERE id = $1", [id]);
    return res.rows[0] ? toSite(res.rows[0]) : undefined;
  }

  async addSite(site: InsertSite): Promise<Site> {
    const res = await this.pool.query(
      `INSERT INTO sites (user_id, name, url, product_price, is_active, is_global)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [site.userId, site.name, site.url, site.productPrice ?? null, site.isActive || false, site.isGlobal || false],
    );
    return toSite(res.rows[0]);
  }

  async updateSite(id: number, data: Partial<InsertSite>): Promise<Site | undefined> {
    const sets: string[] = [];
    const values: any[] = [];
    const map: Record<string, string> = {
      name: "name",
      url: "url",
      productPrice: "product_price",
      isActive: "is_active",
      isGlobal: "is_global",
    };
    for (const key of Object.keys(data)) {
      const col = map[key];
      if (!col) continue;
      values.push((data as any)[key]);
      sets.push(`${col} = $${values.length}`);
    }
    if (sets.length === 0) return undefined;
    values.push(id);
    const res = await this.pool.query(
      `UPDATE sites SET ${sets.join(", ")} WHERE id = $${values.length} RETURNING *`,
      values,
    );
    return res.rows[0] ? toSite(res.rows[0]) : undefined;
  }

  async deleteSite(id: number): Promise<void> {
    await this.pool.query("DELETE FROM sites WHERE id = $1", [id]);
  }

  async setActiveSite(userId: number, siteId: number): Promise<void> {
    await this.pool.query("UPDATE sites SET is_active = false WHERE user_id = $1", [userId]);
    await this.pool.query("UPDATE sites SET is_active = true WHERE id = $1 AND user_id = $2", [siteId, userId]);
  }

  async updateSitePrice(siteId: number, price: string): Promise<void> {
    await this.pool.query("UPDATE sites SET product_price = $1 WHERE id = $2", [price, siteId]);
  }

  // Proxies
  async getUserProxies(userId: number): Promise<Proxy[]> {
    const res = await this.pool.query(
      "SELECT * FROM proxies WHERE user_id = $1 ORDER BY created_at DESC",
      [userId],
    );
    return res.rows.map(toProxy);
  }

  async addProxy(proxy: InsertProxy): Promise<Proxy> {
    const res = await this.pool.query(
      `INSERT INTO proxies (user_id, proxy, is_valid, last_checked)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [proxy.userId, proxy.proxy, proxy.isValid ?? true, proxy.lastChecked ?? null],
    );
    return toProxy(res.rows[0]);
  }

  async updateProxy(id: number, data: Partial<InsertProxy>): Promise<void> {
    const sets: string[] = [];
    const values: any[] = [];
    const map: Record<string, string> = {
      isValid: "is_valid",
      lastChecked: "last_checked",
    };
    for (const key of Object.keys(data)) {
      const col = map[key];
      if (!col) continue;
      values.push((data as any)[key]);
      sets.push(`${col} = $${values.length}`);
    }
    if (sets.length === 0) return;
    values.push(id);
    await this.pool.query(`UPDATE proxies SET ${sets.join(", ")} WHERE id = $${values.length}`, values);
  }

  async deleteProxy(id: number): Promise<void> {
    await this.pool.query("DELETE FROM proxies WHERE id = $1", [id]);
  }

  async deleteAllUserProxies(userId: number): Promise<void> {
    await this.pool.query("DELETE FROM proxies WHERE user_id = $1", [userId]);
  }

  // Settings (global fallback)
  async getSettings(): Promise<Settings | undefined> {
    const res = await this.pool.query("SELECT * FROM settings ORDER BY id LIMIT 1");
    return res.rows[0] ? toSettings(res.rows[0]) : undefined;
  }

  async updateSettings(newSettings: InsertSettings): Promise<Settings> {
    const existing = await this.getSettings();
    if (existing) {
      const res = await this.pool.query(
        `UPDATE settings SET
          target_url = $1, proxy_list = $2, proxy_enabled = $3, updated_at = NOW()
         WHERE id = $4 RETURNING *`,
        [
          newSettings.targetUrl ?? existing.targetUrl,
          newSettings.proxyList ?? existing.proxyList,
          newSettings.proxyEnabled ?? existing.proxyEnabled,
          existing.id,
        ],
      );
      return toSettings(res.rows[0]);
    }
    const res = await this.pool.query(
      `INSERT INTO settings (target_url, proxy_list, proxy_enabled)
       VALUES ($1,$2,$3) RETURNING *`,
      [newSettings.targetUrl || "", newSettings.proxyList || "", newSettings.proxyEnabled ?? true],
    );
    return toSettings(res.rows[0]);
  }

  // Results
  async addResult(result: { card: string; status: string; message?: string; userId?: number; sessionId?: string }): Promise<CheckResult> {
    const res = await this.pool.query(
      `INSERT INTO results (user_id, session_id, card, status, message)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [result.userId ?? null, result.sessionId ?? null, result.card, result.status, result.message ?? null],
    );
    return toResult(res.rows[0]);
  }

  async getResults(limit = 100, userId?: number): Promise<CheckResult[]> {
    const params: any[] = [];
    let where = "";
    if (userId) {
      params.push(userId);
      where = "WHERE user_id = $1 ";
    }
    params.push(limit);
    const res = await this.pool.query(
      `SELECT * FROM results ${where}ORDER BY created_at DESC LIMIT $${params.length}`,
      params,
    );
    return res.rows.map(toResult);
  }

  async clearResults(userId?: number): Promise<void> {
    if (userId) {
      await this.pool.query("DELETE FROM results WHERE user_id = $1", [userId]);
    } else {
      await this.pool.query("DELETE FROM results");
    }
  }

  // Check Sessions
  async createCheckSession(session: InsertCheckSession): Promise<CheckSession> {
    const res = await this.pool.query(
      `INSERT INTO check_sessions
        (session_id, user_id, site_id, total_cards, processed_cards, charged_cards, rejected_cards, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        session.sessionId,
        session.userId,
        session.siteId ?? null,
        session.totalCards || 0,
        session.processedCards || 0,
        session.chargedCards || 0,
        session.rejectedCards || 0,
        session.status || "pending",
      ],
    );
    return toCheckSession(res.rows[0]);
  }

  async updateCheckSession(sessionId: string, data: Partial<InsertCheckSession>): Promise<void> {
    const sets: string[] = [];
    const values: any[] = [];
    const map: Record<string, string> = {
      siteId: "site_id",
      totalCards: "total_cards",
      processedCards: "processed_cards",
      chargedCards: "charged_cards",
      rejectedCards: "rejected_cards",
      status: "status",
      completedAt: "completed_at",
    };
    for (const key of Object.keys(data)) {
      const col = map[key];
      if (!col) continue;
      values.push((data as any)[key]);
      sets.push(`${col} = $${values.length}`);
    }
    if (sets.length === 0) return;
    values.push(sessionId);
    await this.pool.query(
      `UPDATE check_sessions SET ${sets.join(", ")} WHERE session_id = $${values.length}`,
      values,
    );
  }

  async getCheckSession(sessionId: string): Promise<CheckSession | undefined> {
    const res = await this.pool.query("SELECT * FROM check_sessions WHERE session_id = $1", [sessionId]);
    return res.rows[0] ? toCheckSession(res.rows[0]) : undefined;
  }

  // Credit Transactions
  async addCreditTransaction(userId: number, amount: number, type: string, description?: string, adminId?: string): Promise<CreditTransaction> {
    const res = await this.pool.query(
      `INSERT INTO credit_transactions (user_id, amount, type, description, admin_id)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [userId, amount, type, description ?? null, adminId ?? null],
    );
    return toCreditTransaction(res.rows[0]);
  }

  async getCreditTransactions(userId: number, limit = 50): Promise<CreditTransaction[]> {
    const res = await this.pool.query(
      "SELECT * FROM credit_transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2",
      [userId, limit],
    );
    return res.rows.map(toCreditTransaction);
  }

  // Redeem Codes
  async createRedeemCode(credits: number, createdBy: string): Promise<RedeemCode> {
    let candidate = generateRedeemCode();
    for (;;) {
      try {
        const res = await this.pool.query(
          `INSERT INTO redeem_codes (code, credits, created_by) VALUES ($1,$2,$3) RETURNING *`,
          [candidate, credits, createdBy],
        );
        return toRedeemCode(res.rows[0]);
      } catch (err: any) {
        if (err.code === "23505" && err.constraint?.includes("code")) {
          candidate = generateRedeemCode();
          continue;
        }
        throw err;
      }
    }
  }

  async getRedeemCode(code: string): Promise<RedeemCode | undefined> {
    const res = await this.pool.query("SELECT * FROM redeem_codes WHERE code = $1", [code.toUpperCase()]);
    return res.rows[0] ? toRedeemCode(res.rows[0]) : undefined;
  }

  async redeemCode(code: string, userId: number, telegramId: string): Promise<{ status: 'success'; code: RedeemCode; user: User } | { status: 'invalid' } | { status: 'used' }> {
    const res = await this.pool.query(
      `UPDATE redeem_codes SET user_id = $1, used_at = NOW()
       WHERE code = $2 AND user_id IS NULL RETURNING *`,
      [userId, code.toUpperCase()],
    );
    if (!res.rows[0]) {
      const existing = await this.getRedeemCode(code);
      return existing ? { status: "used" } : { status: "invalid" };
    }
    const redeemed = toRedeemCode(res.rows[0]);
    const updatedUser = await this.updateUserCredits(telegramId, redeemed.credits);
    await this.addCreditTransaction(userId, redeemed.credits, "redeem", `Redeemed code ${redeemed.code}`, undefined);
    return { status: "success", code: redeemed, user: updatedUser! };
  }

  // Global Stats & Leaderboard
  async getGlobalStats(): Promise<{ totalCards: number; totalLive: number; totalDead: number; hitRate: number }> {
    const res = await this.pool.query(
      `SELECT COALESCE(SUM(total_charged),0) AS total_live, COALESCE(SUM(total_rejected),0) AS total_dead FROM users`,
    );
    const totalLive = Number(res.rows[0].total_live);
    const totalDead = Number(res.rows[0].total_dead);
    const totalCards = totalLive + totalDead;
    const hitRate = totalCards > 0 ? (totalLive / totalCards) * 100 : 0;
    return { totalCards, totalLive, totalDead, hitRate };
  }

  async getLeaderboard(limit = 10): Promise<Array<{ userId: number; username: string | null; firstName: string | null; lastName: string | null; photoUrl: string | null; totalCharged: number; rank: number }>> {
    const res = await this.pool.query(
      `SELECT id, username, first_name, last_name, photo_url, total_charged,
              ROW_NUMBER() OVER (ORDER BY total_charged DESC) AS rank
       FROM users ORDER BY total_charged DESC LIMIT $1`,
      [limit],
    );
    return res.rows.map((r: any) => ({
      userId: r.id,
      username: r.username ?? null,
      firstName: r.first_name ?? null,
      lastName: r.last_name ?? null,
      photoUrl: r.photo_url ?? null,
      totalCharged: r.total_charged,
      rank: Number(r.rank),
    }));
  }

  // Referrals
  async getUserByReferralCode(code: string): Promise<User | undefined> {
    const res = await this.pool.query("SELECT * FROM users WHERE referral_code = $1", [code]);
    return res.rows[0] ? toUser(res.rows[0]) : undefined;
  }

  async createReferral(referrerId: number, referredId: number, code: string): Promise<Referral> {
    const res = await this.pool.query(
      `INSERT INTO referrals (referrer_id, referred_id, referral_code, credits_awarded)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [referrerId, referredId, code, 100],
    );
    return toReferral(res.rows[0]);
  }

  async getReferralsByUser(userId: number): Promise<Referral[]> {
    const res = await this.pool.query(
      "SELECT * FROM referrals WHERE referrer_id = $1 ORDER BY created_at DESC",
      [userId],
    );
    return res.rows.map(toReferral);
  }

  async getReferralCount(userId: number): Promise<number> {
    const res = await this.pool.query("SELECT COUNT(*) AS count FROM referrals WHERE referrer_id = $1", [userId]);
    return Number(res.rows[0].count);
  }

  async generateReferralCode(userId: number): Promise<string> {
    const check = await this.pool.query("SELECT referral_code FROM users WHERE id = $1", [userId]);
    if (check.rows[0]?.referral_code) return check.rows[0].referral_code;
    const code = "NX" + Math.random().toString(36).substring(2, 8).toUpperCase();
    await this.pool.query("UPDATE users SET referral_code = $1 WHERE id = $2", [code, userId]);
    return code;
  }

  // Daily Spin
  async getLastSpin(userId: number): Promise<DailySpin | undefined> {
    const res = await this.pool.query(
      "SELECT * FROM daily_spins WHERE user_id = $1 ORDER BY spin_date DESC LIMIT 1",
      [userId],
    );
    return res.rows[0] ? toDailySpin(res.rows[0]) : undefined;
  }

  async canSpinToday(userId: number): Promise<boolean> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const res = await this.pool.query(
      "SELECT EXISTS(SELECT 1 FROM daily_spins WHERE user_id = $1 AND spin_date >= $2) AS spun",
      [userId, today],
    );
    return !res.rows[0].spun;
  }

  async recordSpin(userId: number, creditsWon: number): Promise<DailySpin> {
    const res = await this.pool.query(
      "INSERT INTO daily_spins (user_id, credits_won) VALUES ($1,$2) RETURNING *",
      [userId, creditsWon],
    );
    return toDailySpin(res.rows[0]);
  }

  // Daily Streak
  async getStreak(userId: number): Promise<DailyStreak | undefined> {
    const res = await this.pool.query("SELECT * FROM daily_streaks WHERE user_id = $1", [userId]);
    return res.rows[0] ? toDailyStreak(res.rows[0]) : undefined;
  }

  async claimStreak(userId: number): Promise<{ streak: DailyStreak; reward: number; canClaim: boolean }> {
    const streakRewards: { [key: number]: number } = {
      1: 30, 2: 30, 3: 45, 4: 45, 5: 45, 6: 45, 7: 70,
      8: 70, 9: 70, 10: 70, 11: 70, 12: 70, 13: 70, 14: 110,
      15: 110, 16: 110, 17: 110, 18: 110, 19: 110, 20: 110,
      21: 110, 22: 110, 23: 110, 24: 110, 25: 110, 26: 110,
      27: 110, 28: 110, 29: 110, 30: 210,
    };
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const existing = await this.getStreak(userId);

    if (!existing) {
      const res = await this.pool.query(
        `INSERT INTO daily_streaks (user_id, current_streak, longest_streak, last_claim_date, total_claimed)
         VALUES ($1, 1, 1, $2, 1) RETURNING *`,
        [userId, now],
      );
      const streak = toDailyStreak(res.rows[0]);
      return { streak, reward: streakRewards[1] || 30, canClaim: true };
    }

    const lastClaim = existing.lastClaimDate ? new Date(existing.lastClaimDate) : null;
    const lastClaimDate = lastClaim ? new Date(lastClaim.getFullYear(), lastClaim.getMonth(), lastClaim.getDate()) : null;

    if (lastClaimDate && lastClaimDate.getTime() === today.getTime()) {
      return { streak: existing, reward: 0, canClaim: false };
    }

    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    let newStreakValue = 1;
    if (lastClaimDate && lastClaimDate.getTime() === yesterday.getTime()) {
      newStreakValue = Math.min(existing.currentStreak + 1, 30);
    }

    const reward = streakRewards[newStreakValue] || 30;
    const longestStreak = Math.max(existing.longestStreak, newStreakValue);

    const res = await this.pool.query(
      `UPDATE daily_streaks SET current_streak = $1, longest_streak = $2, last_claim_date = $3, total_claimed = total_claimed + 1
       WHERE user_id = $4 RETURNING *`,
      [newStreakValue, longestStreak, now, userId],
    );
    const streak = toDailyStreak(res.rows[0]);
    return { streak, reward, canClaim: true };
  }

  // Notification Settings
  async getNotificationSettings(userId: number): Promise<NotificationSettings | undefined> {
    const res = await this.pool.query("SELECT * FROM notification_settings WHERE user_id = $1", [userId]);
    return res.rows[0] ? toNotificationSettings(res.rows[0]) : undefined;
  }

  async updateNotificationSettings(userId: number, newSettings: Partial<NotificationSettings>): Promise<NotificationSettings> {
    const existing = await this.getNotificationSettings(userId);
    if (existing) {
      const res = await this.pool.query(
        `UPDATE notification_settings SET
          approved_alerts = $1, daily_summary = $2, streak_reminder = $3, updated_at = NOW()
         WHERE user_id = $4 RETURNING *`,
        [
          newSettings.approvedAlerts ?? existing.approvedAlerts,
          newSettings.dailySummary ?? existing.dailySummary,
          newSettings.streakReminder ?? existing.streakReminder,
          userId,
        ],
      );
      return toNotificationSettings(res.rows[0]);
    }
    const res = await this.pool.query(
      `INSERT INTO notification_settings (user_id, approved_alerts, daily_summary, streak_reminder)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [userId, newSettings.approvedAlerts ?? true, newSettings.dailySummary ?? false, newSettings.streakReminder ?? true],
    );
    return toNotificationSettings(res.rows[0]);
  }
}

export const storage: IStorage = process.env.DATABASE_URL
  ? new PostgresStorage(process.env.DATABASE_URL)
  : new FileStorage();
