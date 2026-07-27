/**
 * KanbanBoard — generic work-card state machine.
 *
 * Manages the five-lane Kanban board (queue → active → waiting → review → done)
 * that drives the agent's autonomous work loop.
 *
 * Implements the CorpGen "Kanban" / task management primitive.
 * Generalised from Morgan's AutonomousKanbanBoard and related types.
 */

import type { WorkCard, WorkCardLane, KanbanBoard } from '../types';
import type { StorageProvider } from '../adapters/StorageProvider';

const NAMESPACE = 'kanban';
const CARDS_KEY = 'cards';

const LANE_ORDER: WorkCardLane[] = ['queue', 'active', 'waiting', 'review', 'done'];

export interface KanbanBoardOptions {
  storage: StorageProvider;
}

export class KanbanBoardManager {
  private readonly storage: StorageProvider;
  /** Simple mutex to serialize board mutations within a single process. */
  private mutationLock: Promise<void> = Promise.resolve();

  constructor(options: KanbanBoardOptions) {
    this.storage = options.storage;
  }

  private async loadCards(): Promise<WorkCard[]> {
    return (await this.storage.get<WorkCard[]>(NAMESPACE, CARDS_KEY)) ?? [];
  }

  private async saveCards(cards: WorkCard[]): Promise<void> {
    await this.storage.set(NAMESPACE, CARDS_KEY, cards);
  }

  /** Acquire a serial mutation lock to prevent concurrent load-modify-save races. */
  private async withLock<T>(fn: () => Promise<T>): Promise<T> {
    let release!: () => void;
    const acquired = new Promise<void>((resolve) => { release = resolve; });
    const prior = this.mutationLock;
    this.mutationLock = prior.then(() => acquired);
    await prior;
    try {
      return await fn();
    } finally {
      release();
    }
  }

  async addCard(card: Omit<WorkCard, 'lane' | 'updatedAt'>): Promise<WorkCard> {
    return this.withLock(async () => {
      const cards = await this.loadCards();
      const newCard: WorkCard = {
        ...card,
        lane: 'queue',
        updatedAt: new Date().toISOString(),
      };
      cards.push(newCard);
      await this.saveCards(cards);
      return newCard;
    });
  }

  async advance(id: string, evidence?: string[]): Promise<WorkCard | undefined> {
    return this.withLock(async () => {
      const cards = await this.loadCards();
      const index = cards.findIndex((c) => c.id === id);
      if (index < 0) return undefined;
      const card = cards[index];
      const currentIndex = LANE_ORDER.indexOf(card.lane);
      if (currentIndex < 0 || card.lane === 'done') return undefined;
      const nextLane = LANE_ORDER[Math.min(currentIndex + 1, LANE_ORDER.length - 1)];
      cards[index] = {
        ...card,
        lane: nextLane,
        evidence: evidence ?? card.evidence,
        updatedAt: new Date().toISOString(),
      };
      await this.saveCards(cards);
      return cards[index];
    });
  }

  async block(id: string, reason: string): Promise<WorkCard | undefined> {
    return this.withLock(async () => {
      const cards = await this.loadCards();
      const index = cards.findIndex((c) => c.id === id);
      if (index < 0) return undefined;
      cards[index] = { ...cards[index], lane: 'waiting', status: 'blocked', summary: reason, updatedAt: new Date().toISOString() };
      await this.saveCards(cards);
      return cards[index];
    });
  }

  async complete(id: string, evidence: string[]): Promise<WorkCard | undefined> {
    return this.withLock(async () => {
      const cards = await this.loadCards();
      const index = cards.findIndex((c) => c.id === id);
      if (index < 0) return undefined;
      cards[index] = { ...cards[index], lane: 'done', status: 'completed', evidence, updatedAt: new Date().toISOString() };
      await this.saveCards(cards);
      return cards[index];
    });
  }

  async getSnapshot(): Promise<KanbanBoard> {
    const cards = await this.loadCards();
    const byLane = (lane: WorkCardLane) => cards.filter((c) => c.lane === lane);
    const columns = LANE_ORDER.map((lane) => ({
      id: lane,
      title: lane.charAt(0).toUpperCase() + lane.slice(1),
      intent: laneIntent(lane),
      cards: byLane(lane),
    }));
    const active = byLane('active');
    const nextBestAction = active.length
      ? `Advance card: ${active[0].title}`
      : cards.filter((c) => c.lane === 'queue').length
        ? `Pull next card from queue`
        : 'All work complete.';

    return {
      generatedAt: new Date().toISOString(),
      nextBestAction,
      metrics: {
        queued: byLane('queue').length,
        active: active.length,
        waiting: byLane('waiting').length,
        review: byLane('review').length,
        done: byLane('done').length,
        total: cards.length,
      },
      columns,
    };
  }

  async getMovable(): Promise<WorkCard[]> {
    const cards = await this.loadCards();
    return cards.filter((c) => c.lane !== 'done' && c.lane !== 'waiting');
  }
}

function laneIntent(lane: WorkCardLane): string {
  switch (lane) {
    case 'queue': return 'Work queued and ready to start.';
    case 'active': return 'Work currently in flight.';
    case 'waiting': return 'Blocked on human action or external dependency.';
    case 'review': return 'Work complete; awaiting review or delivery.';
    case 'done': return 'Work completed and evidenced.';
  }
}
