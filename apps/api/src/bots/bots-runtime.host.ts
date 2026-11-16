import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import type { Queue } from "bullmq";
import type IORedis from "ioredis";
import type { InboundEvent } from "@erp/bots";
import { AdapterError } from "@erp/bots";
import { newId } from "@erp/shared";
import { createMonitoredWorker, createQueue, type MonitoredWorker } from "../jobs/create-monitored-worker.js";
import { DEFAULT_JOB_OPTIONS, type JobData } from "../jobs/job-conventions.js";
import { createRedisConnection } from "../jobs/redis-connection.js";
import { workerLogger } from "../jobs/worker-logger.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { BOTS_CONFIG } from "./bots.tokens.js";
import type { BotsConfig } from "./bots.config.js";
import { BotRuntime } from "./application/bot-runtime.js";
import { BotScheduler, type DeliveryJob, type DeliveryQueue } from "./application/bot-scheduler.js";

// docs/BOTS-INTEGRATION-PLAN.md §10. The bot workers run inside the API process (not worker.ts)
// because answering a chat request uses the same Nest-wired services as the HTTP endpoints — the
// invoice PDF above all. They are still BullMQ jobs: retried with backoff, dead-lettered, and safe
// with several API replicas (each job is processed once; polling holds a Redis lock).
// REVIEW: this is a deliberate exception to "the worker is a separate process" (docs/02 §6);
// BOTS_RUNTIME=off turns the workers off on replicas that should only serve HTTP.

export const BOT_INBOUND_QUEUE = "bot-inbound";
export const BOT_DELIVERY_QUEUE = "bot-delivery";
const BOT_TICK_QUEUE = "bot-tick";
const TICK_EVERY_MS = 60_000;
const HEALTH_EVERY_MS = 15 * 60_000;
const CLEANUP_EVERY_MS = 60 * 60_000;
const POLL_TIMEOUT_SECONDS = 25;
const POLL_LOCK_MS = 60_000;
const POLLER_REFRESH_MS = 30_000;

interface InboundJobData extends JobData {
  readonly connectionId: string;
  readonly event: InboundEvent;
}

interface DeliveryJobData extends JobData {
  readonly job: DeliveryJob;
}

interface TickJobData extends JobData {
  readonly task: "tick" | "health" | "cleanup";
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

// Lets the scheduler enqueue deliveries without depending on the host that owns the queue.
@Injectable()
export class BotDeliveryQueueProxy implements DeliveryQueue {
  target: ((job: DeliveryJob, delayMs: number, jobId: string) => Promise<void>) | null = null;

  async enqueue(job: DeliveryJob, delayMs: number, jobId: string): Promise<void> {
    if (this.target) await this.target(job, delayMs, jobId);
  }
}

// Shared by the webhook controller and the pollers. Created lazily so a deployment without bots
// opens no extra Redis connection until a webhook actually arrives.
@Injectable()
export class BotInboundQueue implements OnModuleDestroy {
  private connection: IORedis | null = null;
  private queue: Queue<InboundJobData> | null = null;

  private get(): Queue<InboundJobData> {
    if (!this.queue) {
      this.connection = createRedisConnection();
      this.queue = createQueue<InboundJobData>(BOT_INBOUND_QUEUE, this.connection);
    }
    return this.queue;
  }

  async add(connectionId: string, event: InboundEvent, correlationId: string): Promise<void> {
    // Chat taps are not business records: a few quick retries, never a long backoff the user waits on.
    await this.get().add("inbound", { connectionId, event, correlationId }, { attempts: 3, backoff: { type: "fixed", delay: 1_000 }, removeOnComplete: 1_000, removeOnFail: 5_000 });
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue?.close();
    await this.connection?.quit();
  }
}

@Injectable()
export class BotsRuntimeHost implements OnModuleInit, OnModuleDestroy {
  private connection: IORedis | null = null;
  private readonly workers: MonitoredWorker[] = [];
  private deliveryQueue: Queue<DeliveryJobData> | null = null;
  private tickQueue: Queue<TickJobData> | null = null;
  private readonly pollers = new Map<string, AbortController>();
  private pollerTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly runtime: BotRuntime,
    private readonly scheduler: BotScheduler,
    private readonly inbound: BotInboundQueue,
    private readonly deliveryProxy: BotDeliveryQueueProxy,
    @Inject(BOTS_CONFIG) private readonly config: BotsConfig,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.config.runtimeEnabled || process.env["NODE_ENV"] === "test") return;
    const connection = createRedisConnection();
    this.connection = connection;
    this.deliveryQueue = createQueue<DeliveryJobData>(BOT_DELIVERY_QUEUE, connection);
    this.tickQueue = createQueue<TickJobData>(BOT_TICK_QUEUE, connection);
    this.deliveryProxy.target = (job, delayMs, jobId) => this.enqueueDelivery(job, delayMs, jobId);

    this.workers.push(
      createMonitoredWorker<InboundJobData>(BOT_INBOUND_QUEUE, connection, async (job) => {
        await this.runtime.handleInbound(job.data.connectionId, job.data.event, job.data.correlationId);
      }, { concurrency: 8 }),
      createMonitoredWorker<DeliveryJobData>(BOT_DELIVERY_QUEUE, connection, async (job) => {
        try {
          await this.scheduler.deliver(job.data.job);
        } catch (error) {
          // Honour the platform's own retry-after on rate limits.
          if (error instanceof AdapterError && error.code === "RATE_LIMITED" && error.retryAfterMs) await new Promise((r) => setTimeout(r, Math.min(error.retryAfterMs ?? 0, 30_000)));
          throw error;
        }
      }, { concurrency: 4 }),
      createMonitoredWorker<TickJobData>(BOT_TICK_QUEUE, connection, async (job) => {
        if (job.data.task === "tick") await this.scheduler.tick();
        else if (job.data.task === "health") await this.scheduler.healthCheck();
        else await this.scheduler.cleanup();
      }, { concurrency: 1 }),
    );

    const schedule = async (id: string, every: number, task: TickJobData["task"]) =>
      this.tickQueue?.upsertJobScheduler(id, { every }, { name: task, data: { correlationId: `bot-${task}:scheduled`, task }, opts: { ...DEFAULT_JOB_OPTIONS, attempts: 1 } });
    await schedule("bot-tick", TICK_EVERY_MS, "tick");
    await schedule("bot-health", HEALTH_EVERY_MS, "health");
    await schedule("bot-cleanup", CLEANUP_EVERY_MS, "cleanup");

    void this.refreshPollers();
    this.pollerTimer = setInterval(() => void this.refreshPollers(), POLLER_REFRESH_MS);
    workerLogger.info({ queues: [BOT_INBOUND_QUEUE, BOT_DELIVERY_QUEUE, BOT_TICK_QUEUE] }, "bots.runtime_started");
  }

  // The scheduler's queue: delayed jobs carry quiet hours; the job id makes a duplicate a no-op.
  async enqueueDelivery(job: DeliveryJob, delayMs: number, jobId: string): Promise<void> {
    if (!this.deliveryQueue) return;
    await this.deliveryQueue.add("deliver", { job, correlationId: `bot:${newId()}`, ...("companyId" in job ? { companyId: job.companyId } : {}) }, { delay: delayMs, jobId: jobId.replace(/:/g, "_") });
  }

  // ── Telegram long polling (deployments with no public HTTPS address) ─────────────────────

  private async refreshPollers(): Promise<void> {
    try {
      const rows = await this.prisma.botConnection.findMany({ where: { status: "ACTIVE", transport: "polling" }, select: { id: true } });
      const wanted = new Set(rows.map((r) => r.id));
      for (const [id, controller] of this.pollers) {
        if (!wanted.has(id)) {
          controller.abort();
          this.pollers.delete(id);
        }
      }
      for (const id of wanted) {
        if (this.pollers.has(id)) continue;
        const controller = new AbortController();
        this.pollers.set(id, controller);
        void this.pollLoop(id, controller.signal);
      }
    } catch (error) {
      workerLogger.error({ err: error instanceof Error ? error.message : String(error) }, "bots.poller_refresh_failed");
    }
  }

  private async holdLock(key: string, owner: string): Promise<boolean> {
    const connection = this.connection;
    if (!connection) return false;
    const set = await connection.set(key, owner, "PX", POLL_LOCK_MS, "NX");
    if (set === "OK") return true;
    if ((await connection.get(key)) === owner) {
      await connection.pexpire(key, POLL_LOCK_MS);
      return true;
    }
    return false;
  }

  private async pollLoop(connectionId: string, signal: AbortSignal): Promise<void> {
    const owner = newId();
    const lockKey = `bots:poll-lock:${connectionId}`;
    while (!signal.aborted) {
      try {
        if (!(await this.holdLock(lockKey, owner))) {
          await sleep(15_000, signal); // another replica polls this bot
          continue;
        }
        const loaded = await this.runtime.loadConnection(connectionId);
        const row = await this.prisma.botConnection.findUnique({ where: { id: connectionId }, select: { pollOffset: true, status: true } });
        if (!loaded || !row || row.status !== "ACTIVE" || !loaded.adapter.poll) return;
        const result = await loaded.adapter.poll(loaded.secrets, row.pollOffset, POLL_TIMEOUT_SECONDS);
        for (const event of result.events) await this.inbound.add(connectionId, event, `bot:${newId()}`);
        if (result.nextOffset !== row.pollOffset) await this.prisma.botConnection.update({ where: { id: connectionId }, data: { pollOffset: result.nextOffset } });
      } catch (error) {
        const code = error instanceof AdapterError ? error.code : "INTERNAL";
        workerLogger.warn({ connectionId, code }, "bots.poll_failed");
        await sleep(code === "RATE_LIMITED" ? 5_000 : 30_000, signal);
      }
    }
    // Release the lock only if it is still ours.
    if (this.connection && (await this.connection.get(lockKey).catch(() => null)) === owner) await this.connection.del(lockKey).catch(() => undefined);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.pollerTimer) clearInterval(this.pollerTimer);
    for (const controller of this.pollers.values()) controller.abort();
    this.pollers.clear();
    await Promise.all(this.workers.map((w) => w.close()));
    await this.deliveryQueue?.close();
    await this.tickQueue?.close();
    await this.connection?.quit();
  }
}
