// Model boundary — the kernel/drivers only ever see ModelClient.
export interface ToolCallReq {
  readonly id: string;
  readonly name: string;
  readonly args: unknown;
}
export interface ModelMsg {
  readonly role: "user" | "assistant" | "tool";
  readonly content: string;
  readonly toolCalls?: readonly ToolCallReq[];
  readonly toolCallId?: string;
}
export interface ToolDecl {
  readonly name: string;
  readonly description: string;
}
export interface ModelRequest {
  readonly model: string;
  readonly system?: string;
  readonly messages: readonly ModelMsg[];
  readonly tools?: readonly ToolDecl[];
  readonly maxTokens?: number;
}
export interface ModelResponse {
  readonly text?: string;
  readonly toolCalls?: readonly ToolCallReq[];
  readonly stopReason: string;
  readonly usage?: { readonly inputTokens: number; readonly outputTokens: number };
}
export interface ModelClient {
  complete(req: ModelRequest): Promise<ModelResponse>;
}

export type StubFixture = ModelResponse | ((req: ModelRequest) => ModelResponse);
export interface StubModel extends ModelClient {
  readonly calls: readonly ModelRequest[];
}

export function stubModel(fixtures: readonly StubFixture[]): StubModel {
  const calls: ModelRequest[] = [];
  let i = 0;
  return {
    calls,
    async complete(req: ModelRequest): Promise<ModelResponse> {
      calls.push(req);
      const f = fixtures[i++];
      if (!f) throw new Error(`stubModel exhausted after ${fixtures.length} fixtures (call #${i})`);
      return typeof f === "function" ? f(req) : f;
    },
  };
}
