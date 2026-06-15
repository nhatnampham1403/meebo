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

export class TrelloWriteClient extends TrelloWorkerClient {
  async getCard(cardId: string): Promise<TrelloCard> {
    return this.get<TrelloCard>(
      `/cards/${cardId}?fields=id,name,desc,idList,idMembers,due,dueComplete,dateLastActivity,labels,shortUrl`,
    );
  }

  async addComment(cardId: string, text: string): Promise<void> {
    await withRetry(async () => {
      const res = await fetch(
        `${BASE}/cards/${cardId}/actions/comments?key=${process.env.TRELLO_KEY}&token=${process.env.TRELLO_TOKEN}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
        },
      );
      if (!res.ok) throw new Error(`Trello addComment → ${res.status}`);
    });
  }
}

export function createTrelloWriteClient(): TrelloWriteClient {
  return new TrelloWriteClient();
}
