import crypto from 'crypto';
import { storage } from '../storage';
import { ADMIN_TELEGRAM_ID, type TelegramUser } from '@shared/schema';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const ADMIN_ID = process.env.TELEGRAM_ADMIN_ID || ADMIN_TELEGRAM_ID;

export class TelegramService {
  private botToken: string;

  constructor() {
    this.botToken = BOT_TOKEN;
  }

  validateInitData(initData: string): TelegramUser | null {
    try {
      const urlParams = new URLSearchParams(initData);
      const hash = urlParams.get('hash');
      if (!hash) return null;

      urlParams.delete('hash');
      const params = Array.from(urlParams.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => `${key}=${value}`)
        .join('\n');

      const secretKey = crypto
        .createHmac('sha256', 'WebAppData')
        .update(this.botToken)
        .digest();

      const computedHash = crypto
        .createHmac('sha256', secretKey)
        .update(params)
        .digest('hex');

      if (computedHash !== hash) {
        console.log('Hash mismatch');
        return null;
      }

      const userStr = urlParams.get('user');
      if (!userStr) return null;

      const user = JSON.parse(userStr);
      return {
        id: user.id,
        first_name: user.first_name,
        last_name: user.last_name,
        username: user.username,
        photo_url: user.photo_url,
        auth_date: parseInt(urlParams.get('auth_date') || '0'),
        hash: hash,
      };
    } catch (error) {
      console.error('Error validating init data:', error);
      return null;
    }
  }

  async authenticateUser(initData: string) {
    const telegramUser = this.validateInitData(initData);
    if (!telegramUser) {
      return { success: false, error: 'Invalid Telegram data' };
    }

    const telegramId = telegramUser.id.toString();
    
    // Use getOrCreateUser for idempotent user creation (prevents duplicates)
    // New users get 80 free credits on first registration
    let user = await storage.getOrCreateUser({
      telegramId,
      username: telegramUser.username || undefined,
      firstName: telegramUser.first_name,
      lastName: telegramUser.last_name || undefined,
      photoUrl: telegramUser.photo_url || undefined,
      credits: telegramId === ADMIN_ID ? 999999 : 80,
      totalCharged: 0,
      totalRejected: 0,
      isAdmin: telegramId === ADMIN_ID,
    });
    
    // Update user info if it changed
    const updatedUser = await storage.updateUser(telegramId, {
      username: telegramUser.username || user.username,
      firstName: telegramUser.first_name || user.firstName,
      lastName: telegramUser.last_name || user.lastName,
      photoUrl: telegramUser.photo_url || user.photoUrl,
    });
    
    if (updatedUser) {
      user = updatedUser;
    }

    return { success: true, user };
  }

  async addCredits(adminTelegramId: string, targetTelegramId: string, amount: number) {
    if (adminTelegramId !== ADMIN_ID) {
      return { success: false, error: 'Unauthorized' };
    }

    // Use getOrCreateUser for idempotent user creation
    const targetUser = await storage.getOrCreateUser({
      telegramId: targetTelegramId,
      username: undefined,
      firstName: 'User',
      lastName: undefined,
      credits: 0,
      totalCharged: 0,
      totalRejected: 0,
      isAdmin: false,
    });

    const updatedUser = await storage.updateUserCredits(targetTelegramId, amount);
    if (!updatedUser) {
      return { success: false, error: 'Failed to update credits' };
    }

    await storage.addCreditTransaction(
      targetUser.id,
      amount,
      'admin_add',
      `Added by admin`,
      adminTelegramId
    );

    return { success: true, user: updatedUser, newBalance: updatedUser.credits };
  }

  async deductCredit(telegramId: string, count: number = 1): Promise<boolean> {
    const user = await storage.getUserByTelegramId(telegramId);
    if (!user || user.credits < count) {
      return false;
    }

    await storage.updateUserCredits(telegramId, -count);
    await storage.addCreditTransaction(
      user.id,
      -count,
      'card_check',
      `Used for card checking`
    );

    return true;
  }

  async getUserCredits(telegramId: string): Promise<number> {
    const user = await storage.getUserByTelegramId(telegramId);
    return user?.credits || 0;
  }

  isAdmin(telegramId: string): boolean {
    return telegramId === ADMIN_ID;
  }

  async sendMessage(chatId: string, text: string) {
    try {
      const response = await fetch(`https://api.telegram.org/bot${this.botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}

export const telegramService = new TelegramService();
