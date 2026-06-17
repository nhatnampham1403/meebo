import { Router, type Request, type Response } from 'express';
import { createBot } from '../lib/telegram';
import { handleCommand } from './commands';
import { handleCheckinCallback } from './checkin';
import { handleCaptureTranscript, isAwaitingCapture } from './capture';

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
        const spaceIdx = text.indexOf(' ');
        const rawCommand = spaceIdx === -1 ? text : text.slice(0, spaceIdx);
        const args = spaceIdx === -1 ? '' : text.slice(spaceIdx + 1).trim();
        const command = rawCommand.replace(/^\//, '').split('@')[0].toLowerCase();
        await handleCommand(bot, chat.id, command, from, args);
        return;
      }

      if (isAwaitingCapture(chat.id)) {
        await handleCaptureTranscript(bot, chat.id, from.id, from.first_name, text);
      }
    }

    if (update.callback_query) {
      const { id: queryId, data } = update.callback_query;
      const chatId = update.callback_query.message?.chat.id;

      if (!chatId || !data) {
        await bot.answerCallbackQuery(queryId);
        return;
      }

      // Route checkin button taps
      if (data.startsWith('checkin:')) {
        await handleCheckinCallback(bot, queryId, data);
        return;
      }

      // Unknown callback — acknowledge silently
      await bot.answerCallbackQuery(queryId);
    }
  } catch (err) {
    console.error('[webhook] Error processing update:', err);
  }
});
