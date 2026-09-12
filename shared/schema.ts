import { z } from "zod";

// === TYPES ===

export interface User {
  id: number;
  telegramId: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  photoUrl?: string;
  credits: number;
  totalCharged: number;
  totalRejected: number;
  isAdmin: boolean;
  hasSeenTutorial: boolean;
  referralCode?: string;
  referredBy?: number;
  createdAt: Date;
  lastActiveAt: Date;
}

export interface Site {
  id: number;
  userId: number;
  name: string;
  url: string;
  productPrice?: string;
  isActive: boolean;
  isGlobal: boolean;
  createdAt: Date;
}

export interface Proxy {
  id: number;
  userId: number;
  proxy: string;
  isValid: boolean;
  lastChecked?: Date;
  createdAt: Date;
}

export interface Settings {
  id: number;
  targetUrl: string;
  proxyList: string;
  proxyEnabled: boolean;
  updatedAt: Date;
}

export interface CheckResult {
  id: number;
  userId?: number;
  sessionId?: string;
  card: string;
  status: string;
  message?: string;
  createdAt: Date;
}

export interface CheckSession {
  id: number;
  sessionId: string;
  userId: number;
  siteId?: number;
  totalCards: number;
  processedCards: number;
  chargedCards: number;
  rejectedCards: number;
  status: string;
  createdAt: Date;
  completedAt?: Date;
}

export interface CreditTransaction {
  id: number;
  userId: number;
  amount: number;
  type: string;
  description?: string;
  adminId?: string;
  createdAt: Date;
}

export interface Referral {
  id: number;
  referrerId: number;
  referredId: number;
  referralCode: string;
  creditsAwarded: number;
  createdAt: Date;
}

export interface DailySpin {
  id: number;
  userId: number;
  creditsWon: number;
  spinDate: Date;
}

export interface DailyStreak {
  id: number;
  userId: number;
  currentStreak: number;
  longestStreak: number;
  lastClaimDate?: Date;
  totalClaimed: number;
}

export interface NotificationSettings {
  id: number;
  userId: number;
  approvedAlerts: boolean;
  dailySummary: boolean;
  streakReminder: boolean;
  updatedAt: Date;
}

// === INSERT SCHEMAS ===

export const insertUserSchema = z.object({
  telegramId: z.string(),
  username: z.string().optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  photoUrl: z.string().optional(),
  credits: z.number().optional(),
  totalCharged: z.number().optional(),
  totalRejected: z.number().optional(),
  isAdmin: z.boolean().optional(),
  hasSeenTutorial: z.boolean().optional(),
  referralCode: z.string().optional(),
  referredBy: z.number().optional(),
});

export const insertSiteSchema = z.object({
  userId: z.number(),
  name: z.string(),
  url: z.string(),
  productPrice: z.string().optional(),
  isActive: z.boolean().optional(),
  isGlobal: z.boolean().optional(),
});

export const insertProxySchema = z.object({
  userId: z.number(),
  proxy: z.string(),
  isValid: z.boolean().optional(),
  lastChecked: z.date().optional(),
});

export const insertSettingsSchema = z.object({
  targetUrl: z.string().optional(),
  proxyList: z.string().optional(),
  proxyEnabled: z.boolean().optional(),
});

export const insertResultSchema = z.object({
  userId: z.number().optional(),
  sessionId: z.string().optional(),
  card: z.string(),
  status: z.string(),
  message: z.string().optional(),
});

export const insertCheckSessionSchema = z.object({
  sessionId: z.string(),
  userId: z.number(),
  siteId: z.number().optional(),
  totalCards: z.number().optional(),
  processedCards: z.number().optional(),
  chargedCards: z.number().optional(),
  rejectedCards: z.number().optional(),
  status: z.string().optional(),
});

export const insertCreditTransactionSchema = z.object({
  userId: z.number(),
  amount: z.number(),
  type: z.string(),
  description: z.string().optional(),
  adminId: z.string().optional(),
});

export const insertReferralSchema = z.object({
  referrerId: z.number(),
  referredId: z.number(),
  referralCode: z.string(),
  creditsAwarded: z.number().optional(),
});

export const insertDailySpinSchema = z.object({
  userId: z.number(),
  creditsWon: z.number(),
});

export const insertDailyStreakSchema = z.object({
  userId: z.number(),
  currentStreak: z.number().optional(),
  longestStreak: z.number().optional(),
  lastClaimDate: z.date().optional(),
  totalClaimed: z.number().optional(),
});

export const insertNotificationSettingsSchema = z.object({
  userId: z.number(),
  approvedAlerts: z.boolean().optional(),
  dailySummary: z.boolean().optional(),
  streakReminder: z.boolean().optional(),
});

// === TYPES ===
export type InsertUser = z.infer<typeof insertUserSchema>;
export type InsertSite = z.infer<typeof insertSiteSchema>;
export type InsertProxy = z.infer<typeof insertProxySchema>;
export type InsertSettings = z.infer<typeof insertSettingsSchema>;
export type InsertResult = z.infer<typeof insertResultSchema>;
export type InsertCheckSession = z.infer<typeof insertCheckSessionSchema>;
export type InsertReferral = z.infer<typeof insertReferralSchema>;
export type InsertDailySpin = z.infer<typeof insertDailySpinSchema>;
export type InsertDailyStreak = z.infer<typeof insertDailyStreakSchema>;
export type InsertNotificationSettings = z.infer<typeof insertNotificationSettingsSchema>;

// Admin ID constant
export const ADMIN_TELEGRAM_ID = "5197976453";

// WebSocket Message Types
export const WS_EVENTS = {
  STATUS_UPDATE: 'status_update',
  RESULT: 'result',
  LOG: 'log',
  CREDITS_UPDATE: 'credits_update',
  SESSION_UPDATE: 'session_update',
} as const;

export interface CheckJobRequest {
  cards: string[];
  siteId?: number;
  userId?: number;
  sessionId?: string;
}

export interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
}
