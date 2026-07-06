import { expect, test } from "bun:test";
import { anthropic } from "@loopyjs/anthropic";

test.skipIf(!process.env.ANTHROPIC_API_KEY)("live smoke: one real completion", async () => {
  const client = anthropic("claude-haiku-4-5-20251001");
  const res = await client.complete({ model: "haiku", messages: [{ role: "user", content: "Reply with exactly: pong" }], maxTokens: 16 });
  expect(res.text?.toLowerCase()).toContain("pong");
});
