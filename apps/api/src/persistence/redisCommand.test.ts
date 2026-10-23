import { expect, test } from "bun:test";
import { redisCommand } from "./redisCommand";

test("a failed connection is closed and the next command uses a fresh client", async () => {
  const events: string[] = [];
  let attempts = 0;
  const create = () => {
    const attempt = ++attempts;
    return {
      connect: async () => {
        events.push(`connect ${attempt}`);
        if (attempt === 1) throw new Error("Connection has failed");
      },
      send: async () => { events.push(`send ${attempt}`); return "123-0"; },
      close: () => { events.push(`close ${attempt}`); },
    };
  };
  await expect(redisCommand("redis://test", "XADD", [], create)).rejects.toThrow("Connection has failed");
  expect(await redisCommand("redis://test", "XADD", [], create)).toBe("123-0");
  expect(events).toEqual(["connect 1", "close 1", "connect 2", "send 2", "close 2"]);
});

test("a failed write closes the client without retrying an ambiguous write", async () => {
  let sends = 0;
  let closed = false;
  await expect(redisCommand("redis://test", "XADD", [], () => ({
    connect: async () => {},
    send: async () => { sends++; throw new Error("reply lost"); },
    close: () => { closed = true; },
  }))).rejects.toThrow("reply lost");
  expect(sends).toBe(1);
  expect(closed).toBe(true);
});
