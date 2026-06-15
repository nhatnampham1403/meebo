import { Router, type Request, type Response } from 'express';
import { createBot } from '../lib/telegram';
import { handleCommand } from './commands';

export interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from: { id: number; username?: string; first_name: string };
    chat: { id: number; type: string; title?: string };
    text?: string;
    date: number;
  };
  callback_query?: {
    id: string;
    from: { id: number; username?: string; first_name: string };
    message?: { message_id: number; chat: { id: number } };
    data?: string;
  };
}

export const webhookRouter = Router();

webhookRouter.post('/telegram', async (req: Request, res: Response) => {
  // Validate Telegram secret header (skip if secret not configured — dev mode)
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (secret) {
    const header = req.headers['x-telegram-bot-api-secret-token'];
    if (header !== secret) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
  } else {
    console.warn('[webhook] TELEGRAM_WEBHOOK_SECRET not set — skipping header validation');
  }

  // Acknowledge immediately (Telegram requires <5 s)
  res.status(200).json({ ok: true });

  const update = req.body as TelegramUpdate;

  try {
    const bot = createBot();

    if (update.message) {
      const { text, chat, from } = update.message;

      if (!text) return;

      if (text.startsWith('/')) {
        // Strip @BotName suffix: /command@meebo_bot → command
        const raw = text.split(' ')[0] ?? '';
        const command = raw.replace(/^\//, '').split('@')[0].toLowerCase();
        await handleCommand(bot, chat.id, command, from.first_name);
      }
    }

    if (update.callback_query) {
      const { id: queryId, data } = update.callback_query;
      const chatId = update.callback_query.message?.chat.id;

      if (!chatId || !data) {
        await bot.answerCallbackQuery(queryId);
        return;
      }

      // Placeholder for future callback routing
      await bot.answerCallbackQuery(queryId, 'Action received');
    }
  } catch (err) {
    console.error('[webhook] Error processing update:', err);
  }
});
