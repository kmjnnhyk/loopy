import { expect, test } from "bun:test";
import { anthropic } from "../../src/runtime/model-anthropic";

test("request/response mapping against a fake SDK client", async () => {
  let captured: Record<string, unknown> = {};
  const fake = {
    messages: {
      create: async (p: Record<string, unknown>) => {
        captured = p;
        return {
          content: [
            { type: "text", text: "using tool" },
            { type: "tool_use", id: "tu1", name: "echo", input: { x: 1 } },
          ],
          stop_reason: "tool_use",
          usage: { input_tokens: 11, output_tokens: 7 },
        };
      },
    },
  };
  const client = anthropic("claude-sonnet-5", { client: fake });
  const res = await client.complete({
    model: "sonnet",
    system: "be brief",
    messages: [
      { role: "user", content: "q" },
      { role: "assistant", content: "calling", toolCalls: [{ id: "tu0", name: "echo", args: { x: 0 } }] },
      { role: "tool", toolCallId: "tu0", content: '{"x":0}' },
    ],
    tools: [{ name: "echo", description: "echo tool" }],
  });
  expect(captured.model).toBe("claude-sonnet-5");
  expect(captured.system).toBe("be brief");
  const msgs = captured.messages as Array<{ role: string; content: unknown }>;
  expect(msgs[0]).toEqual({ role: "user", content: "q" });
  expect((msgs[1]!.content as Array<{ type: string }>).map((b) => b.type)).toEqual(["text", "tool_use"]);
  expect((msgs[2]!.content as Array<{ type: string }>)[0]!.type).toBe("tool_result");
  expect((captured.tools as Array<{ name: string }>)[0]!.name).toBe("echo");
  expect(res.text).toBe("using tool");
  expect(res.toolCalls).toEqual([{ id: "tu1", name: "echo", args: { x: 1 } }]);
  expect(res.stopReason).toBe("tool_use");
  expect(res.usage).toEqual({ inputTokens: 11, outputTokens: 7 });
});
