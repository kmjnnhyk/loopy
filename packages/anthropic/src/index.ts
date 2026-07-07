import Anthropic from "@anthropic-ai/sdk";
import type { ModelClient, ModelMsg, ModelRequest, ModelResponse, ToolCallReq } from "@loopyjs/core";

export interface AnthropicLike {
  messages: { create(params: Record<string, unknown>): Promise<unknown> };
}

type Block =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string };

function toAnthropicMessages(msgs: readonly ModelMsg[]): Array<{ role: "user" | "assistant"; content: unknown }> {
  const out: Array<{ role: "user" | "assistant"; content: unknown }> = [];
  for (const m of msgs) {
    if (m.role === "user") out.push({ role: "user", content: m.content });
    else if (m.role === "assistant") {
      if (m.toolCalls && m.toolCalls.length > 0) {
        const blocks: Block[] = m.content ? [{ type: "text", text: m.content }] : [];
        for (const c of m.toolCalls) blocks.push({ type: "tool_use", id: c.id, name: c.name, input: c.args });
        out.push({ role: "assistant", content: blocks });
      } else out.push({ role: "assistant", content: m.content });
    } else {
      out.push({ role: "user", content: [{ type: "tool_result", tool_use_id: m.toolCallId ?? "", content: m.content }] });
    }
  }
  return out;
}

export function anthropic(
  modelId: string,
  opts: { apiKey?: string; maxTokens?: number; client?: AnthropicLike } = {},
): ModelClient {
  // The real SDK's `messages.create` has overloaded, strictly-typed params (MessageCreateParamsNonStreaming
  // et al.) that don't structurally match AnthropicLike's permissive `Record<string, unknown>` signature —
  // that's intentional: AnthropicLike is the narrow test-injection surface, not a mirror of the SDK's types.
  // Cast the real client at construction; call sites still only see AnthropicLike.
  const client: AnthropicLike = opts.client ?? (new Anthropic({ apiKey: opts.apiKey }) as unknown as AnthropicLike);
  return {
    async complete(req: ModelRequest): Promise<ModelResponse> {
      const raw = (await client.messages.create({
        model: modelId,
        max_tokens: req.maxTokens ?? opts.maxTokens ?? 4096,
        ...(req.system ? { system: req.system } : {}),
        messages: toAnthropicMessages(req.messages),
        ...(req.tools && req.tools.length > 0
          ? { tools: req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: { type: "object" } })) }
          : {}),
      })) as {
        content: Block[];
        stop_reason: string | null;
        usage?: { input_tokens: number; output_tokens: number };
      };
      const text = raw.content.filter((b): b is Extract<Block, { type: "text" }> => b.type === "text").map((b) => b.text).join("");
      const toolCalls: ToolCallReq[] = raw.content
        .filter((b): b is Extract<Block, { type: "tool_use" }> => b.type === "tool_use")
        .map((b) => ({ id: b.id, name: b.name, args: b.input }));
      return {
        text: text || undefined,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        stopReason: raw.stop_reason ?? "unknown",
        usage: raw.usage ? { inputTokens: raw.usage.input_tokens, outputTokens: raw.usage.output_tokens } : undefined,
      };
    },
  };
}
