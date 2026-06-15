import { withRetry } from '@trello-optimization/shared';

export interface TrelloList {
  id: string;
  name: string;
}

export interface TrelloMember {
  id: string;
  fullName: string;
  username: string;
}

export interface TrelloCard {
  id: string;
  name: string;
  idList: string;
  idMembers: string[];
  due: string | null;
}

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

export class TrelloClient {
  private readonly baseUrl = 'https://api.trello.com/1';
  private readonly key: string;
  private readonly token: string;
  private readonly _boardId: string;

  constructor() {
    const key = process.env.TRELLO_KEY;
    const token = process.env.TRELLO_TOKEN;
    const boardId = process.env.TRELLO_BOARD_ID;
    if (!key || !token || !boardId) {
      throw new Error('Missing TRELLO_KEY, TRELLO_TOKEN, or TRELLO_BOARD_ID');
    }
    this.key = key;
    this.token = token;
    this._boardId = boardId;
  }

  private auth(sep = '?'): string {
    return `${sep}key=${this.key}&token=${this.token}`;
  }

  private async request<T>(path: string, options?: RequestInit): Promise<T> {
    const sep = path.includes('?') ? '&' : '?';
    const url = `${this.baseUrl}${path}${sep}key=${this.key}&token=${this.token}`;
    const res = await fetch(url, options);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Trello ${options?.method ?? 'GET'} ${path} → ${res.status}: ${text}`);
    }
    return res.json() as Promise<T>;
  }

  getLists(): Promise<TrelloList[]> {
    return withRetry(() =>
      this.request<TrelloList[]>(`/boards/${this._boardId}/lists?filter=open`),
    );
  }

  createList(name: string): Promise<TrelloList> {
    return withRetry(() =>
      this.request<TrelloList>(`/boards/${this._boardId}/lists`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      }),
    );
  }

  async resolveOrCreateList(projectName: string): Promise<string> {
    const lists = await this.getLists();
    const match = lists.find(
      (l) => l.name.trim().toLowerCase() === projectName.trim().toLowerCase(),
    );
    if (match) return match.id;
    const created = await this.createList(projectName);
    return created.id;
  }

  getMembers(): Promise<TrelloMember[]> {
    return withRetry(() =>
      this.request<TrelloMember[]>(`/boards/${this._boardId}/members`),
    );
  }

  createCard(payload: TrelloCardPayload): Promise<CreatedCard> {
    return withRetry(() =>
      this.request<CreatedCard>('/cards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }),
    );
  }

  async addChecklist(
    cardId: string,
    name: string,
    items: string[],
  ): Promise<void> {
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

  addComment(cardId: string, text: string): Promise<void> {
    return withRetry(() =>
      this.request(`/cards/${cardId}/actions/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      }),
    );
  }

  getCardsOnBoard(): Promise<TrelloCard[]> {
    return withRetry(() =>
      this.request<TrelloCard[]>(`/boards/${this._boardId}/cards?filter=open`),
    );
  }

  async getOpenCardCountByMember(): Promise<Record<string, number>> {
    const cards = await this.getCardsOnBoard();
    const counts: Record<string, number> = {};
    for (const card of cards) {
      for (const memberId of card.idMembers) {
        counts[memberId] = (counts[memberId] ?? 0) + 1;
      }
    }
    return counts;
  }

  archiveCard(cardId: string): Promise<void> {
    return withRetry(() =>
      this.request(`/cards/${cardId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ closed: true }),
      }),
    );
  }
}
