import { PrismaClient } from "@erp/db";
import { newId } from "@erp/shared";
import { Queue } from "bullmq";
import type IORedis from "ioredis";
import { relayOutboxOnce, type OutboxJobData } from "./outbox-relay.js";
import { createRedisConnection } from "./redis-connection.js";

// docs/06-COMPLIANCE-PACK-RULES.md §4: "a crash between commit and submission still
// results in submission." This proves the relay side of that guarantee against a
// real Postgres and a real Redis (docs/10-TESTING-RULES.md §1) — never mocked, since
// the whole point is the atomic claim (FOR UPDATE SKIP LOCKED) and the actual BullMQ
// enqueue really happening.
const hasRealDatabase = Boolean(process.env.DATABASE_URL);
const hasRealRedis = Boolean(process.env.REDIS_URL);
const describeIfInfra = hasRealDatabase && hasRealRedis ? describe : describe.skip;

describeIfInfra("outbox relay", () => {
  const prisma = new PrismaClient();
  // Created in beforeAll, not here: describe.skip still executes this describe
  // body at collection time (only its hooks/its are skipped), so a throwing call
  // at this level would crash collection even when the guard above says "skip".
  let connection: IORedis;
  let companyId: string;
  const topic = `test.outbox.${newId()}`;

  beforeAll(async () => {
    connection = createRedisConnection();
    companyId = newId();
    await prisma.company.create({ data: { id: companyId, name: `Outbox Test ${companyId}` } });
  });

  afterAll(async () => {
    const queue = new Queue<OutboxJobData>(topic, { connection });
    await queue.obliterate({ force: true });
    await queue.close();
    await connection.quit();
    await prisma.$disconnect();
  });

  it("relays a committed outbox row that no request process is still around to dispatch", async () => {
    // Simulates exactly the guarantee this exists for: the row is already committed
    // (as if the original request's transaction finished and the process then
    // vanished) — the relay is the only thing that ever sees it after that.
    const message = await prisma.outboxMessage.create({
      data: {
        id: newId(),
        companyId,
        topic,
        payload: { hello: "world" },
        correlationId: newId(),
      },
    });

    const dispatchedCount = await relayOutboxOnce(prisma, connection);
    expect(dispatchedCount).toBeGreaterThanOrEqual(1);

    const reloaded = await prisma.outboxMessage.findUniqueOrThrow({ where: { id: message.id } });
    expect(reloaded.dispatchedAt).not.toBeNull();

    const queue = new Queue<OutboxJobData>(topic, { connection });
    const jobs = await queue.getJobs(["waiting", "active", "completed", "delayed"]);
    const matching = jobs.find((job) => job.data.outboxMessageId === message.id);
    expect(matching).toBeDefined();
    expect(matching?.data.companyId).toBe(companyId);
    expect(matching?.data.payload).toEqual({ hello: "world" });
    await queue.close();
  });

  it("never dispatches the same row twice across two relay runs", async () => {
    const message = await prisma.outboxMessage.create({
      data: { id: newId(), companyId, topic, payload: { n: 1 }, correlationId: newId() },
    });

    await relayOutboxOnce(prisma, connection);
    const secondRunCount = await relayOutboxOnce(prisma, connection);

    const queue = new Queue<OutboxJobData>(topic, { connection });
    const jobs = await queue.getJobs(["waiting", "active", "completed", "delayed"]);
    const matches = jobs.filter((job) => job.data.outboxMessageId === message.id);
    expect(matches).toHaveLength(1);
    // The second run may pick up leftover rows from other tests in this file, but
    // it must not re-claim the already-dispatched row from this test.
    expect(matches[0]?.data.outboxMessageId).toBe(message.id);
    void secondRunCount;
    await queue.close();
  });
});
