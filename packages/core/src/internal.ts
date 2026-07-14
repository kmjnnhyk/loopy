// Internal runtime access for loopy's own white-box tests (drivers/scheduler/
// channels). NOT part of the stable public API — subject to change. Consumers
// should use the "." entry. Exposed as a subpath so tests reach internals
// through an explicit package boundary instead of a filesystem reach-through.
export { workflowDriver } from "./runtime/drivers/workflow.ts";
export { agentNode } from "./runtime/drivers/agent.ts";
export { runThread, type Driver, type RunnableNode } from "./runtime/scheduler.ts";
export { rawChannel } from "./runtime/channels.ts";
export { threadId } from "./runtime/events.ts";

// Task(model B): @loopyjs/claude-code의 delegation driver/브리지가 소비하는 최소 표면.
export { pickDeps, type RuntimeCtx, type ToolLike } from "./runtime/effects.ts";
export { stableStringify } from "./runtime/events.ts";
export { parseStructured, ParseError } from "./runtime/sap.ts";
