import { withRetry } from '@shared';

const BASE = 'https://api.trello.com/1';

export interface TrelloList {
  id: string;
  name: string;
  closed: boolean;
}

export interface TrelloLabel {
  id: string;
  name: string;
  color: string;
}

export interface TrelloCard {
  id: string;
  name: string;
  desc: string;
  idList: string;
  idMembers: string[];
  due: string | null;
  dueComplete: boolean;
  dateLastActivity: string;
  labels: TrelloLabel[];
  shortUrl: string;
}

export interface CardContext {
  card: TrelloCard;
  listName: string;
  ownerNames: string[];
}

export class TrelloWorkerClient {
  private readonly key: string;
  private readonly token: string;
  private readonly boardId: string;

  constructor() {
    this.key = process.env.TRELLO_KEY ?? '';
    this.token = process.env.TRELLO_TOKEN ?? '';
    this.boardId = process.env.TRELLO_BOARD_ID ?? '';

    if (!this.key || !this.token || !this.boardId) {
      throw new Error('Missing TRELLO_KEY / TRELLO_TOKEN / TRELLO_BOARD_ID');
    }
  }

  private auth(): string {
    return `key=${this.key}&token=${this.token}`;
  }

  protected async get<T>(path: string): Promise<T> {
    return withRetry(async () => {
      const res = await fetch(`${BASE}${path}&${this.auth()}`);
      if (!res.ok) throw new Error(`Trello GET ${path} → ${res.status}`);
      return res.json() as Promise<T>;
    });
  }

  async getLists(): Promise<TrelloList[]> {
    return this.get<TrelloList[]>(`/boards/${this.boardId}/lists?fields=id,name,closed`);
  }

  async getCardsOnBoard(): Promise<TrelloCard[]> {
    return this.get<TrelloCard[]>(
      `/boards/${this.boardId}/cards?fields=id,name,desc,idList,idMembers,due,dueComplete,dateLastActivity,labels,shortUrl`,
    );
  }

  async buildContext(memberMap: Map<string, string>): Promise<CardContext[]> {
    const [cards, lists] = await Promise.all([this.getCardsOnBoard(), this.getLists()]);
    const listMap = new Map(lists.map((l) => [l.id, l.name]));

    return cards.map((card) => ({
      card,
      listName: listMap.get(card.idList) ?? 'Unknown',
      ownerNames: card.idMembers
        .map((id) => memberMap.get(id) ?? id.slice(0, 8))
        .filter(Boolean),
    }));
  }
}

export function createTrelloClient(): TrelloWorkerClient {
  return new TrelloWorkerClient();
}

// ─── Date helpers ────────────────────────────────────────────────────────────

export function daysFromNow(isoDate: string): number {
  const ms = new Date(isoDate).getTime() - Date.now();
  return ms / (1000 * 60 * 60 * 24);
}

export function daysAgo(isoDate: string): number {
  return -daysFromNow(isoDate);
}

export function formatDate(isoDate: string): string {
  return new Date(isoDate).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
  });
}

export function hasLabel(card: TrelloCard, ...names: string[]): boolean {
  const lower = names.map((n) => n.toLowerCase());
  return card.labels.some((l) => lower.includes(l.name.toLowerCase()));
}

// ─── Write methods ────────────────────────────────────────────────────────────

export interface TrelloCardPayload {
  name: string;
  desc: string;
  idList: string;
  idMembers: string[];
  due?: string | null;
}

export interface CreatedCard {
  id: string;
  url: string;
  shortUrl: string;
}

export class TrelloWriteClient extends TrelloWorkerClient {
  private trelloKey(): string {
    return process.env.TRELLO_KEY ?? '';
  }

  private trelloToken(): string {
    return process.env.TRELLO_TOKEN ?? '';
  }

  private trelloBoardId(): string {
    return process.env.TRELLO_BOARD_ID ?? '';
  }

  private async request<T>(path: string, options?: RequestInit): Promise<T> {
    const sep = path.includes('?') ? '&' : '?';
    const url = `${BASE}${path}${sep}key=${this.trelloKey()}&token=${this.trelloToken()}`;
    const res = await fetch(url, options);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Trello ${options?.method ?? 'GET'} ${path} → ${res.status}: ${text}`);
    }
    return res.json() as Promise<T>;
  }

  async getCard(cardId: string): Promise<TrelloCard> {
    return this.get<TrelloCard>(
      `/cards/${cardId}?fields=id,name,desc,idList,idMembers,due,dueComplete,dateLastActivity,labels,shortUrl`,
    );
  }

  async createList(name: string): Promise<TrelloList> {
    return withRetry(() =>
      this.request<TrelloList>(`/boards/${this.trelloBoardId()}/lists`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      }),
    );
  }

  async resolveOrCreateList(projectName: string): Promise<string> {
    const lists = await this.getLists();
    const open = lists.filter((l) => !l.closed);
    const match = open.find(
      (l) => l.name.trim().toLowerCase() === projectName.trim().toLowerCase(),
    );
    if (match) return match.id;
    const created = await this.createList(projectName);
    return created.id;
  }

  async createCard(payload: TrelloCardPayload): Promise<CreatedCard> {
    return withRetry(() =>
      this.request<CreatedCard>('/cards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }),
    );
  }

  async addChecklist(cardId: string, name: string, items: string[]): Promise<void> {
    await withRetry(async () => {
      const checklist = await this.request<{ id: string }>('/checklists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idCard: cardId, name }),
      });
      for (const item of items) {
        await this.request(`/checklists/${checklist.id}/checkItems`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: item }),
        });
      }
    });
  }

  async archiveCard(cardId: string): Promise<void> {
    await withRetry(() =>
      this.request(`/cards/${cardId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ closed: true }),
      }),
    );
  }

  async addComment(cardId: string, text: string): Promise<void> {
    await withRetry(() =>
      this.request(`/cards/${cardId}/actions/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      }),
    );
  }
}

export function createTrelloWriteClient(): TrelloWriteClient {
  return new TrelloWriteClient();
}
