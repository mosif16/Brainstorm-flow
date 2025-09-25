import { EventEmitter } from 'events';
import type { Response } from 'express';
import { RunEvent } from '../pipeline/runPipeline';

interface Subscription {
  res: Response;
  heartbeat?: NodeJS.Timeout;
}

export class RunEventHub {
  private emitters = new Map<string, EventEmitter>();
  private subscribers = new Map<string, Set<Subscription>>();

  create(runId: string): EventEmitter {
    const emitter = new EventEmitter();
    this.emitters.set(runId, emitter);
    emitter.on('event', (event: RunEvent) => {
      this.broadcast(runId, event);
      if (event.type === 'run-status' && (event.status === 'completed' || event.status === 'failed')) {
        this.scheduleCleanup(runId);
      }
    });
    return emitter;
  }

  get(runId: string): EventEmitter | undefined {
    return this.emitters.get(runId);
  }

  subscribe(runId: string, res: Response): void {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const subscription: Subscription = { res };
    const active = this.subscribers.get(runId) || new Set<Subscription>();
    active.add(subscription);
    this.subscribers.set(runId, active);

    const heartbeat = setInterval(() => {
      try {
        res.write(':heartbeat\n\n');
      } catch (err) {
        clearInterval(heartbeat);
        this.unsubscribe(runId, subscription);
      }
    }, 25_000);
    subscription.heartbeat = heartbeat;

    res.on('close', () => {
      clearInterval(heartbeat);
      this.unsubscribe(runId, subscription);
    });
  }

  private broadcast(runId: string, event: RunEvent): void {
    const listeners = this.subscribers.get(runId);
    if (!listeners || listeners.size === 0) return;
    const payload = `data: ${JSON.stringify(event)}\n\n`;
    for (const { res } of listeners) {
      try {
        res.write(payload);
      } catch (err) {
        this.unsubscribe(runId, { res });
      }
    }
  }

  private unsubscribe(runId: string, subscription: Subscription): void {
    const listeners = this.subscribers.get(runId);
    if (!listeners) return;
    listeners.delete(subscription);
    if (listeners.size === 0) {
      this.subscribers.delete(runId);
    }
  }

  private scheduleCleanup(runId: string): void {
    setTimeout(() => {
      const emitter = this.emitters.get(runId);
      if (emitter) {
        emitter.removeAllListeners();
        this.emitters.delete(runId);
      }
    }, 60_000);
  }
}

export const runEventHub = new RunEventHub();
