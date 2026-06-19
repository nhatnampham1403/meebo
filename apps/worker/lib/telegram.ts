import { withRetry } from '@shared';

export interface InlineButton {
  text: string;
  callback_data?: string;
  url?: string;
}

export interface TelegramMessage {
  message_id: number;
  chat: { id: number };
  text?: string;
}

export interface TelegramUser {
  id: number;
  username?: string;
  first_name: string;
  is_bot: boolean;
}

interface TelegramApiResponse<T> {
  ok: boolean;
  result: T;
  description?: string;
}

interface TelegramFile {
  file_id: string;
  file_unique_id: string;
  file_size?: number;
  file_path?: string;
}

export interface TelegramDocument {
  file_id: string;
  file_unique_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

export class TelegramBot {
  private readonly base: string;

  constructor(private readonly token: string) {
    this.base = `https://api.telegram.org/bot${token}`;
  }

  private async call<T>(method: string, body?: Record<string, unknown>): Promise<T> {
    const res = await fetch(`${this.base}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });

    const json = (await res.json()) as TelegramApiResponse<T>;

    if (!json.ok) {
      throw new Error(`Telegram ${method} failed: ${json.description ?? 'unknown error'}`);
    }

    return json.result;
  }

  async getMe(): Promise<TelegramUser> {
    return withRetry(() => this.call<TelegramUser>('getMe'));
  }

  async getFile(fileId: string): Promise<TelegramFile> {
    return withRetry(() => this.call<TelegramFile>('getFile', { file_id: fileId }));
  }

  async downloadFile(filePath: string): Promise<Buffer> {
    return withRetry(async () => {
      const url = `https://api.telegram.org/file/bot${this.token}/${filePath}`;
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`Telegram file download failed: ${res.status}`);
      }
      const arrayBuffer = await res.arrayBuffer();
      return Buffer.from(arrayBuffer);
    });
  }

  async sendMessage(
    chatId: number | string,
    text: string,
    parseMode: 'HTML' | 'Markdown' = 'HTML',
    options?: { forceReply?: boolean },
  ): Promise<TelegramMessage> {
    return withRetry(() =>
      this.call<TelegramMessage>('sendMessage', {
        chat_id: chatId,
        text,
        parse_mode: parseMode,
        disable_web_page_preview: true,
        ...(options?.forceReply
          ? { reply_markup: { force_reply: true, selective: true } }
          : {}),
      }),
    );
  }

  async sendInlineKeyboard(
    chatId: number | string,
    text: string,
    buttons: InlineButton[][],
    parseMode: 'HTML' | 'Markdown' = 'HTML',
  ): Promise<TelegramMessage> {
    return withRetry(() =>
      this.call<TelegramMessage>('sendMessage', {
        chat_id: chatId,
        text,
        parse_mode: parseMode,
        reply_markup: { inline_keyboard: buttons },
        disable_web_page_preview: true,
      }),
    );
  }

  async answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
    await withRetry(() =>
      this.call<boolean>('answerCallbackQuery', {
        callback_query_id: callbackQueryId,
        ...(text ? { text } : {}),
      }),
    );
  }

  async editMessageText(
    chatId: number | string,
    messageId: number,
    text: string,
    parseMode: 'HTML' | 'Markdown' = 'HTML',
    options?: { clearKeyboard?: boolean },
  ): Promise<void> {
    await withRetry(() =>
      this.call<TelegramMessage>('editMessageText', {
        chat_id: chatId,
        message_id: messageId,
        text,
        parse_mode: parseMode,
        disable_web_page_preview: true,
        ...(options?.clearKeyboard ? { reply_markup: { inline_keyboard: [] } } : {}),
      }),
    );
  }

  async registerWebhook(url: string, secret: string): Promise<void> {
    await withRetry(() =>
      this.call<boolean>('setWebhook', {
        url,
        secret_token: secret || undefined,
        allowed_updates: ['message', 'callback_query'],
      }),
    );
    console.log(`[telegram] Webhook registered → ${url}`);
  }

  async deleteWebhook(): Promise<void> {
    await withRetry(() => this.call<boolean>('deleteWebhook'));
    console.log('[telegram] Webhook deleted');
  }
}

export function createBot(): TelegramBot {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN not set');
  return new TelegramBot(token);
}

export function requireGroupChatId(): string {
  const id = process.env.TELEGRAM_GROUP_CHAT_ID;
  if (!id) throw new Error('TELEGRAM_GROUP_CHAT_ID not set — add it to apps/worker/.env');
  return id;
}
