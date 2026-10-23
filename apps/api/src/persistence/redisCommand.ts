import { RedisClient } from "bun";

type Client = Pick<RedisClient, "connect" | "send" | "close">;

// Snapshot writes are infrequent. A short-lived connection avoids retaining a
// terminally failed producer after startup/network failures or long idle periods.
// Do not retry writes here: a lost reply does not prove Redis rejected the write.
export async function redisCommand(
  url: string,
  command: string,
  args: string[],
  create: (url: string) => Client = (url) => new RedisClient(url),
) {
  const client = create(url);
  try {
    await client.connect();
    return await client.send(command, args);
  } finally {
    client.close();
  }
}
