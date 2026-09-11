import { newId } from "@erp/shared";
import { Queue } from "bullmq";
import {
  createMonitoredWorker,
  createQueue,
  deadLetterQueueName,
  type DeadLetterPayload,
} from "./create-monitored-worker.js";
import { createRedisConnection } from "./redis-connection.js";
import type { JobData } from "./job-conventions.js";

// docs/12-OPS-AND-DEPLOYMENT.md §5: "bounded retries..., then a dead-letter queue
// with an alert. Silent permanent failure is not acceptable." Against a real Redis
// (docs/10-TESTING-RULES.md §1) — this is exactly the behaviour a mock would fake.
const hasRealRedis = Boolean(process.env.REDIS_URL);
const describeIfRedis = hasRealRedis ? describe : describe.skip;

async function waitUntil(check: () => Promise<boolean>, timeoutMs = 10_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("condition not met within timeout");
}

describeIfRedis("createMonitoredWorker — dead-letter on exhausted retries", () => {
  it("retries a failing job, then moves it to the dead-letter queue exactly once", async () => {
    const connection = createRedisConnection();
    const queueName = `test.dlq.${newId()}`;
    const queue = createQueue<JobData>(queueName, connection);

    let attempts = 0;
    const monitored = createMonitoredWorker<JobData>(queueName, connection, () => {
      attempts += 1;
      throw new Error("always fails — proving dead-letter behaviour");
    });

    try {
      await queue.add(
        "run",
        { correlationId: newId() },
        { attempts: 2, backoff: { type: "fixed", delay: 100 } },
      );

      const dlq = new Queue<DeadLetterPayload>(deadLetterQueueName(queueName), { connection });
      await waitUntil(async () => {
        const counts = await dlq.getJobCounts("waiting", "completed");
        return (counts.waiting ?? 0) + (counts.completed ?? 0) > 0;
      });

      expect(attempts).toBe(2);
      const dlqJobs = await dlq.getJobs(["waiting", "completed"]);
      expect(dlqJobs).toHaveLength(1);
      expect(dlqJobs[0]?.data.attemptsMade).toBe(2);
      expect(dlqJobs[0]?.data.originalQueue).toBe(queueName);
      await dlq.obliterate({ force: true });
      await dlq.close();
    } finally {
      await monitored.close();
      await queue.obliterate({ force: true });
      await queue.close();
      await connection.quit();
    }
  }, 20_000);
});
