---
title: team()
description: 노드로 쓰이는 에이전트들, 공유 트랜스크립트, 핸드오프 슈거 — 멀티 에이전트 원시 타입이에요. 라우터가 매 턴 다음 에이전트 하나를 골라요.
---

`team()`은 [`workflow()`](/ko/reference/workflow/)와 같은 그래프 메커니즘 위에 얹힌, 가볍고 견해가 뚜렷한 프리셋이에요. 에이전트가 노드가 되고, 공유 `transcript` 채널과 `nextAgent` 제어 채널이 자동으로 주입되며, 에이전트는 명시적인 `.router(...)`에 더해(또는 그 대신) `passTo`로 자기 자신의 핸드오프를 요청할 수 있어요.

## 시그니처

```ts
export interface Team<Name extends string, Agents, State, Result> {
  readonly "~kind": "team";
  readonly name: Name;
  readonly entry: AgentNames<Agents>;
  readonly agents: Agents;
  readonly state: TeamFullState<State, AgentNames<Agents>>;
  readonly maxTurns?: number;
  readonly input: IO<TeamInputOf<State>>;
  readonly output: IO<Result>;
  readonly "~deps"?: TeamDeps<Agents>;
}

export function team<
  const Name extends string,
  const Agents extends Record<string, AnyAgent>,
  State extends Record<string, Channel<any, any>>,
>(def: {
  name: Name;
  entry: AgentNames<Agents>;
  state: State;
  agents: Agents & GuardAgents<Agents>;
  maxTurns?: number;
}): TeamBuilder<Name, Agents, State>;

interface TeamBuilder<Name, Agents, State> {
  writes<const M extends Partial<Record<AgentNames<Agents>, keyof State>>>(
    map: M & WritesOutputCheck<Agents, State, M>,
  ): TeamRouted<Name, Agents, State, M>;
  router(
    fn: (s: StateOf<TeamFullState<State, AgentNames<Agents>>>) => TeamRouterReturn<Agents>,
  ): Team<Name, Agents, State, unknown>;
}
```

`team({...})`는 빌더를 반환해요 — `.writes(...)`는 선택이고, `.router(...)`가 이를 `Team`으로 최종 확정해요. 라우터가 읽는 채널에 어떤 에이전트의 출력도 담을 필요가 없다면 `.writes(...)`는 아예 생략해도 돼요.

## 필드

- **`entry`** — 어떤 에이전트가 먼저 시작할지예요. `agents`의 키 중 하나여야 해요.
- **`state`** — 여러분의 도메인 채널이에요([채널 & 상태](/ko/core-concepts/channels-and-state/) 참고). 실행에 초깃값을 넣어주기 위해 보통 [`inputChannel()`](/ko/reference/channels/#inputchannel)을 최소 하나 둬요.
- **`agents`** — `agent()`들의 레코드예요. 여기 있는 어떤 에이전트가 선언한 `passTo` 대상이든 전부 이 레코드의 키여야 해요 — 아래 가드를 보세요.
- **`maxTurns`** — 실행이 멈춘 것으로 간주되기 전까지 에이전트 턴을 몇 번 허용할지 정하는 안전장치예요(부분 결과를 조용히 반환하는 대신 에러를 던져요).

## 자동 주입되는 상태

모든 팀은 여러분이 직접 선언하지 않아도 채널 두 개를 자동으로 받아요.

```ts
export interface Msg {
  readonly role: "user" | "assistant" | "tool";
  readonly agent?: string;
  readonly content: string;
}
export type TeamAutoState<Names extends string> = {
  readonly transcript: Channel<readonly Msg[], Msg | readonly Msg[]>;
  readonly nextAgent: Channel<Names | null, Names | null>;
};
```

- **`transcript`** — 지금까지 어떤 에이전트든 만들어낸 모든 메시지예요. 그래서 나중에 합류하는 에이전트도 전체 맥락을 가질 수 있어요.
- **`nextAgent`** — 슬롯 하나짜리 "핸드오프 메모"예요. 에이전트의 `passTo`가 자신이 허용된 이름 중 하나를 대상으로 지정하면, 그 이름이 여기에 담겨요. 여러분의 `.router(...)`가 이걸 읽고 다음에 누가 갈지 결정해요.

## `passTo` 대 `.router()`

둘 다 "다음은 누구인가?"에 답해요 — 차이는 **누가 결정하느냐**예요.

- **`passTo`**([`agent()`](/ko/reference/agent/#필드)에 선언해요) — *모델*이 결정해요. 결정을 내리려면 실제로 입력을 읽어야 하기 때문이에요(예: "이게 버그 요청인가요, 문서 요청인가요?"). 에이전트가 대상을 고르면 그게 `nextAgent`에 담겨요.
- **`.router(fn)`** — *여러분의 코드*가 결정해요. 규칙이 고정돼 있기 때문이에요(예: "리뷰가 승인됐으면 멈춘다"). `fn`은 `nextAgent`를 포함한 전체 상태 스냅샷을 받아서 다음 에이전트 이름이나 [`END`](/ko/reference/channels/#end)를 반환해요.

이 둘은 조합돼요 — 라우터는 보통 `nextAgent`를 먼저 확인하고, 그다음 자신의 규칙으로 넘어가요.

```ts
// examples/team.ts
.router((s) => {
  if (s.nextAgent) return s.nextAgent;   // 핸드오프 요청을 먼저 따라가요
  if (s.review?.approved) return END;    // 고정 규칙: 승인됐으면 → 멈춰요
  if (s.review) return s.review.assignee; // 고정 규칙: 반려됐으면 → 지정된 사람에게 돌아가요
  return END;
})
```

## `passTo` 멤버십 가드

`agents: Agents & GuardAgents<Agents>`는 에이전트마다, `passTo`에 담긴 모든 이름이 실제로 `agents` 레코드의 키인지 검사해요. 엉뚱한 대상이 있어도 호출 전체가 실패하지는 않아요 — *그 에이전트의 슬롯만* 이름 붙은 에러로 표시돼요.

```ts
export type GuardAgents<Agents> = {
  [K in keyof Agents]:
    [Exclude<PassToOf<Agents[K]>, Extract<keyof Agents, string>>] extends [never]
      ? Agents[K]
      : { readonly "~passToTargetNotInTeam": Exclude<PassToOf<Agents[K]>, Extract<keyof Agents, string>> };
};
```

`passTo`가 아예 없는 에이전트(예: 오직 `.router`로만 종료되는 리뷰어)는 이 검사를 그냥 통과해요.

## `.writes()` — output ⊑ channel, 검사돼요

`.writes({ agentName: "channelKey" })`는 "이 에이전트의 출력을 이 채널에 써라"라는 뜻이에요. 각 매핑은 컴파일 타임에 검사돼요. 에이전트의 출력 타입이 채널의 값 타입에 대입 가능해야 하고, 아니면 그 슬롯만 이름 붙은 불일치 에러(`WritesOutputCheck`)로 표시돼요 — 호출 전체를 가리키는 뭉뚱그린 타입 에러가 아니에요.

```ts
// examples/team.ts
.writes({ reviewer: "review" })
```

이 맵의 **개수**는 `WritesResult`를 통해 `rt.run(...)`이 무엇을 반환할지도 결정해요.

| `.writes({...})` | `rt.run(...)`이 반환하는 것 |
|---|---|
| 매핑 정확히 하나 | 그 채널의 값 타입 |
| 매핑 0개, 또는 2개 이상 | 전체 `StateOf<...>` 스냅샷 |

이건 의도된 설계예요. 매핑 하나가 흔한 경우고("리뷰어의 판정을 줘"), 그 외에는 여러분이 어떤 채널을 의도했는지 조용히 추측하는 대신 전체 상태로 폴백해요.

## 전체 예제 — PR 트리아지

```ts
// examples/team.ts
export const triageState = {
  issue:  inputChannel<Issue>(),
  review: lastChannel<ReviewResult | null>(null),
};

export const prTriage = team({
  name: "prTriage",
  entry: "triage",
  state: triageState,
  agents: { triage, bugFixer, docsWriter, reviewer },
  maxTurns: 20,
})
  .writes({ reviewer: "review" })
  .router((s) => {
    if (s.nextAgent) return s.nextAgent;
    if (s.review?.approved) return END;
    if (s.review) return s.review.assignee;
    return END;
  });
```

`triage`/`bugFixer`/`docsWriter`/`reviewer`의 정의와 턴별 트레이스까지 포함한 전체 설명은 [팀 모델 깊이 보기](/ko/team-model/)를 보세요.

## 팀 등록

```ts
// examples/team.ts — bugFixer는 deps: ["repo"]를 선언해요. passTo 합성은 의존성을 전혀 기여하지 않아요.
export const teamRt = defineLoopy({
  agents: {},
  workflows: {},
  teams: { prTriage },
  deps: { repo },
});

const out: ReviewResult | null = await teamRt.run("prTriage", { issue: { id: 7, body: "…" } });
```

`defineLoopy`의 `teams` 필드는 각 팀의 `TeamDeps<Agents>`를 `agents`/`workflows`와 같은 `RequiredDeps` 유니온으로 모아요 — [레지스트리](/ko/reference/registry/)를 보세요.

## 팀 안에서의 휴먼 인 더 루프

`agent()`는 임의의 본문을 가질 수 없어서(그 "본문"이 곧 모델 루프예요), 사람의 승인 단계가 필요한 팀은 대신 툴을 통해 그걸 라우팅해요 — `ToolCtx`가 `interrupt`를 갖고 있는 이유가 바로 이거예요.

```ts
export const requestApproval = tool({
  name: "requestApproval",
  description: "Pause for human approval.",
  input: io<{ summary: string }>(),
  output: io<{ approved: boolean }>(),
  run: async (i, ctx) => ctx.interrupt<{ approved: boolean }>({ ask: i.summary }),
});
```

전체 패턴은 [휴먼 인 더 루프](/ko/guides/human-in-the-loop/)를 보세요.

## 다음 단계

- [팀 모델 깊이 보기](/ko/team-model/) — 턴별로 안내하는 전체 설명이에요.
- [가이드 → 멀티 에이전트 팀](/ko/guides/multi-agent-team/)
- [현황과 로드맵](/ko/status-roadmap/) — 아직 스텁으로 돌아가는 부분이에요.
