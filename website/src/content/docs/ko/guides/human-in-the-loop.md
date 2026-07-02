---
title: "가이드: 휴먼 인 더 루프"
description: ctx.interrupt로 실행을 멈추고 사람의 결정을 기다려요 — resume이 멈췄던 지점에서 정확히 이어지는 원리를 이해해요.
---

loopy에서 휴먼 인 더 루프는 원시 타입 하나 — `ctx.interrupt<T>(payload)` — 로 이루어져요. 워크플로우의 `step()`에서 쓰거나, [`team()`](/ko/reference/team/) 안에서는 `tool()`에서 써요. 왜 이게 멈춘 함수가 아니라 그래프 *위치*를 서스펜드하는 방식으로 설계됐는지는 [이벤트 소싱과 리플레이](/ko/core-concepts/event-sourcing/)에서 확인하세요.

:::caution
`interrupt`의 타입 시그니처는 지금 존재하지만, 그 뒤에 있는 서스펜드/재개 런타임은 아직 없어요. 이 가이드는 의도된 사용 형태를 설명해요.
:::

## 워크플로우 안에서: `NodeCtx.interrupt`

워크플로우 `step()`의 실행 컨텍스트는 평범한 툴 컨텍스트에 `interrupt`를 더 얹은 거예요:

```ts
export interface NodeCtx<D extends keyof LoopyDeps> {
  readonly deps: Pick<LoopyDeps, D>;
  /** 실행을 서스펜드해요. 재개 값(타입이 붙은 페이로드 채널)으로 resolve돼요. */
  interrupt<T>(payload: unknown): Promise<T>;
}
```

`examples/workflows.ts`의 `jiraFlow`는 이걸 두 번 써요 — 한 번은 불명확한 이슈를 사람에게 명확히 해달라고 물을 때, 한 번은 어떤 베이스 브랜치를 대상으로 할지 물을 때예요:

```ts
export interface UserClarification {
  readonly answers: readonly string[];
  readonly by: string;
}

const needsInput = step({
  name: "needsInput",
  input: io<{ missing: readonly string[] }>(),
  output: io<{ clarified: UserClarification }>(),
  run: async (_i, ctx) => {
    const clarified = await ctx.interrupt<UserClarification>({ kind: "clarify" });
    return { clarified };
  },
});
```

`ctx.interrupt<UserClarification>({ kind: "clarify" })`는 실행을 서스펜드해요. `UserClarification`에 맞는 값으로 재개되면 그 값을 반환하고 `needsInput`이 정상적으로 끝나도록 해요. `{ kind: "clarify" }` 페이로드는 승인 UI(대시보드, Slack 메시지, CLI 프롬프트 등)를 보여주는 쪽에 넘기고 싶은 컨텍스트라면 뭐든 될 수 있어요 — loopy 입장에서는 불투명한 값이에요.

이 값이 흘러들어가는 채널은 워크플로우 전체에서 `unknown`이 아니라 이름이 붙은 타입이에요 — `jiraFlow.state.clarification`은 `Channel<UserClarification | null, ...>`이에요. 이건 `examples/consumer.ts`에서 실제 컴파일 어서션으로 검사돼요: `StateOf<typeof jiraFlow.state>["clarification"]`은 `.d.ts` 패키지 경계를 넘어서도 정말로 `UserClarification | null`과 같아요.

## 팀 안에서: 툴을 통해 라우팅하기

`agent()`에는 작성자가 직접 쓴 본문이 없어요 — 그 "본문"은 곧 모델 루프예요 — 그래서 `step()`처럼 `ctx.interrupt`를 직접 호출할 수 없어요. 대신 사람의 승인이 필요한 팀은 `run`에서 `interrupt`를 호출하는 툴을 에이전트에게 줘요. `ToolCtx`가 `interrupt`를 갖고 있는 이유가 바로 이거예요:

```ts
export const requestApproval = tool({
  name: "requestApproval",
  description: "Pause for human approval.",
  input: io<{ summary: string }>(),
  output: io<{ approved: boolean }>(),
  run: async (i, ctx) => ctx.interrupt<{ approved: boolean }>({ ask: i.summary }),
});

export const reviewer = agent({
  name: "reviewer", model: "opus", instructions: "Review; approve or reassign.",
  input: io<{ issue: Issue }>(), output: io<ReviewResult>(),
  tools: [requestApproval],
});
```

`reviewer`가 `requestApproval`을 호출하기로 결정하면, 팀 실행 전체가 바로 그 지점에서 서스펜드돼요. "승인을 요청해야겠다"는 판단까지 포함한 모델 자신의 추론 과정이 이벤트 로그에 그대로 보존되기 때문에, 재개할 때 모델을 다시 실행하지 않고 interrupt 이후만 이어서 진행해요.

## 재개는 어떤 모습일까 (설계 의도)

```ts
// runtime.resume(threadId, value) — 며칠 뒤, 다른 프로세스에서 호출해도 괜찮아요
await runtime.resume("th_1", { approved: true });
```

interrupt 이전의 모든 건 캐시 히트로 리플레이돼요(LLM 호출도, 다시 실행되는 툴도 없어요) — 실제 작업은 interrupt 이후부터만 일어나요. 전체 예시는 [이벤트 소싱과 리플레이](/ko/core-concepts/event-sourcing/)에서 확인하세요.

## 다음 단계

- [team()](/ko/reference/team/#팀-안에서의-휴먼-인-더-루프)
- [이벤트 소싱과 리플레이](/ko/core-concepts/event-sourcing/)
