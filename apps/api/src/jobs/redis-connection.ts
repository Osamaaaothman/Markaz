import IORedis from "ioredis";

// BullMQ's own requirement for any connection it drives: a blocking client must
// never give up on a command after a fixed number of retries, or a long-running
// blocking read (its core polling mechanism) fails outright instead of waiting.
// See https://docs.bullmq.io — "Connections" — maxRetriesPerRequest must be null.
export function createRedisConnection(): IORedis {
  const url = process.env.REDIS_URL;
  if (url === undefined || url.length === 0) {
    throw new Error("REDIS_URL is not set");
  }
  return new IORedis(url, { maxRetriesPerRequest: null });
}
