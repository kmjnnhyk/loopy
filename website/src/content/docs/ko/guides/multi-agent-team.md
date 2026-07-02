---
title: 멀티 에이전트 팀
description: PR 트리아지 팀을 단계별로 만들어요. 접수 에이전트가 전문 에이전트에게 핸드오프하면, 리뷰어가 승인하거나 다시 돌려보내요.
---

이 가이드는 `prTriage`를 만들어요. 이슈가 들어오면 트리아지 에이전트가 버그인지 문서 요청인지 판단해서 알맞은 전문 에이전트에게 넘겨요. 전문 에이전트는 그걸 리뷰어에게 넘기고, 리뷰어는 승인하거나 다시 돌려보내요. 채널이 뭔지, `passTo`와 `.router()`가 왜 둘 다 필요한지 같은 개념적인 이야기는 [팀 모델 깊이 보기](/ko/team-model/)에서 다뤄요. 이 가이드는 처음부터 끝까지 "어떻게 만드는가"에 집중해요.

## 1. 도메인 타입과 상태 설계하기

```ts
import { agent, tool, io, inputChannel, lastChannel, team, END, defineLoopy } from "loopy";

export interface Issue { readonly id: number; readonly body: string }

export type ReviewResult =
  | { readonly approved: true;  readonly notes: string }
  | { readonly approved: false; readonly assignee: "bugFixer" | "docsWriter"; readonly notes: string };

export const triageState = {
  issue:  inputChannel<Issue>(),                  // rt.run의 입력으로 채워져요
  review: lastChannel<ReviewResult | null>(null),  // 리뷰어의 최신 판정
};
```

`ReviewResult`는 판별 유니온이에요. loopy의 개념이 아니라 이 예제만의 도메인 데이터예요. `approved: true`(담당자 불필요)와 `approved: false`(담당자 *필수*)로 나누면, "반려됐는데 아무도 배정 안 됨"이라는 상태가 런타임 버그가 아니라 호출 지점의 타입 에러가 돼요.

## 2. 에이전트 정의하기: 모델이 결정하는 곳엔 `passTo`

```ts
export const triage = agent({
  name: "triage", model: "opus",
  instructions: "Read the issue; hand to bugFixer or docsWriter.",
  input: io<{ issue: Issue }>(), output: io<{ kind: string }>(),
  passTo: ["bugFixer", "docsWriter"],
});
export const bugFixer = agent({
  name: "bugFixer", model: "opus", instructions: "Fix the bug.",
  input: io<{ issue: Issue }>(), output: io<{ done: boolean }>(),
  deps: ["repo"], passTo: ["reviewer"],
});
export const docsWriter = agent({
  name: "docsWriter", model: "opus", instructions: "Write docs.",
  input: io<{ issue: Issue }>(), output: io<{ done: boolean }>(),
  passTo: ["reviewer"],
});
```

`triage`는 두 전문 에이전트 중 어느 쪽으로든 핸드오프할 수 있어요. 실제로 이슈를 읽어본 뒤 모델이 맞다고 판단하는 쪽으로요. `bugFixer`와 `docsWriter`는 항상 `reviewer`에게만 핸드오프해요. 이건 판단이 필요한 문제가 아니라 고정된 다음 단계예요. 그런데도 여전히 `passTo`로 표현하는 이유는, 자기 작업이 다음에 어디로 가는지 알리는 주체가 여전히 *바로 이 에이전트*이기 때문이에요.

## 3. 사람에게 물어볼 방법을 리뷰어에게 주고, `passTo`는 빼기

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
  // passTo 없음 — 종료는 모델이 아니라 .router()가 처리하는 고정 규칙이에요
});
```

`reviewer`에는 `passTo`가 없어요. 실행이 끝날지 전문 에이전트로 돌아갈지는 *규칙*("승인 → 완료, 반려 → 담당자에게 복귀")이라서, 모델이 아니라 `.router()`가 담당해요. `requestApproval`의 `ctx.interrupt`가 뭘 하는지는 [휴먼 인 더 루프](/ko/guides/human-in-the-loop/)에서 확인하세요.

## 4. 팀 조립하기

```ts
export const prTriage = team({
  name: "prTriage",
  entry: "triage",
  state: triageState,
  agents: { triage, bugFixer, docsWriter, reviewer },
  maxTurns: 20,
})
  .writes({ reviewer: "review" })
  .router((s) => {
    if (s.nextAgent) return s.nextAgent;    // ① 핸드오프 요청이 최우선이에요
    if (s.review?.approved) return END;     // ② 승인 → 완료
    if (s.review) return s.review.assignee; // ③ 반려 → 지정된 담당자에게 복귀
    return END;                             // ④ 할 일 없음 → 완료
  });
```

`entry: "triage"`는 0번째 턴의 `nextAgent`도 채워줘서, 라우터에 특별한 처리 없이도 `triage`가 먼저 실행돼요. `.writes({ reviewer: "review" })`가 있어야 라우터 안의 `s.review`가 채워져요. 이게 없으면 리뷰어의 출력은 라우터가 볼 수 있는 어디에도 도달하지 못해요.

**왜 `review`보다 `nextAgent`를 먼저 확인할까요 (①번 줄, ②/③보다 먼저):** 반려된 이슈가 이를테면 `bugFixer`로 돌아가고, `bugFixer`가 작업을 마치고 다시 `reviewer`에게 핸드오프한다고 해봐요. 이때 새로 들어온 핸드오프가, 이전 라운드부터 채널에 남아 있는 *오래된* `review` 값보다 우선해야 해요. 안 그러면 라우터는 계속 옛날 "반려" 판정을 읽어서 `reviewer`에게 새로 보내는 대신 `bugFixer`를 영원히 반복시켜요.

## 5. 등록하고 실행하기

```ts
const repo: GitRepo = { read: async () => "", write: async () => {}, find: async () => [] };
export const teamRt = defineLoopy({
  agents: {},
  workflows: {},
  teams: { prTriage },
  deps: { repo }, // "repo" 하나뿐이에요 — bugFixer에서 온 것이고, passTo는 추가 의존성을 만들지 않아요
});

const out: ReviewResult | null = await teamRt.run("prTriage", { issue: { id: 7, body: "…" } });
```

`{ issue: { id: 7, body: "…" } }`는 `state`의 하나뿐인 `inputChannel`로부터 `TeamInputOf<typeof triageState>`가 유도하는 형태와 정확히 같아요. `review`는 실행 입력에 포함되지 않는데, `lastChannel`은 입력으로 표시되지 않기 때문이에요.

## 실행 한 번 추적해 보기

| 턴 | 활성 에이전트 | 일어나는 일 | 라우터 결정 |
|---|---|---|---|
| 0 | `triage` | 이슈를 읽고 "버그"라고 판단 | → `bugFixer` |
| 1 | `bugFixer` | 수정하고 핸드오프 | → `reviewer` |
| 2 | `reviewer` | 반려하고 `bugFixer`에게 재배정 | → `bugFixer` |
| 3 | `bugFixer` | 다시 수정하고 핸드오프 | → `reviewer` |
| 4 | `reviewer` | 승인 | → `END` |

최종 반환값: 승인된 `ReviewResult`예요. 같은 추적을 턴별로 하나씩 풀어서, 각 단계에서 `nextAgent`/`review`에 정확히 뭐가 들어있는지까지 설명하는 내용은 [팀 모델 깊이 보기](/ko/team-model/)에서 볼 수 있어요.

## 다음 단계

- [팀 모델 깊이 보기](/ko/team-model/) — 이 가이드에서 내린 모든 결정 뒤에 있는 개념을 깊이 파고들어요.
- [API 레퍼런스 → team()](/ko/reference/team/)
