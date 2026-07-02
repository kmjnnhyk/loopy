---
title: "가이드: 결정적 워크플로우"
description: 상태 채널과 타입이 붙은 라우터를 사용해서, 재시도 사이클과 분기가 있는 2단계 워크플로우를 만들어요.
---

이 가이드는 `examples/workflows.ts`의 `designFlow`를 만들어요 — Figma 디자인을 가져오고, 코드를 생성하고, 빌드하고, 실패하면 재시도하는 워크플로우예요. 이 모든 결정은 모델이 아니라 *당신의* 코드가 내려요.

## 1. 상태 선언하기

상태는 [채널](/ko/core-concepts/channels-and-state/)의 레코드예요. 워크플로우의 라우터가 봐야 하는 것마다 채널이 하나씩 있어요:

```ts
import { workflow, lastChannel, io, END } from "loopy";

const state = {
  figma: lastChannel<FigmaData | null>(null),
  build: lastChannel<{ ok: boolean } | null>(null),
  deploy: lastChannel<DeployResult | null>(null),
};
```

이 각각은 "마지막에 쓴 값이 이긴다"는 슬롯이에요 — 라우터는 매 시도의 이력이 아니라, 가장 최근 빌드 결과만 신경 써요.

## 2. `.nodes(...)`로 모든 노드 미리 선언하기

```ts
const flow = workflow({
  name: "designFlow",
  state,
  input: io<{ message: string }>(),
  output: io<{ prUrl: string }>(),
}).nodes({ fetchFigma, fileAnalyzer, codeGen, build, verify: verifier, push, deploy: waitForDeploy });
```

노드는 `tool()`, `agent()`(`verify: verifier`는 `verifier` 에이전트를 `"verify"`라는 노드 이름으로 바꿔줘요), 또는 인라인 `step()`(`build`, `push` — 아래 참고) 중 하나일 수 있어요. 엣지를 연결하기 전에 노드 전체를 먼저 선언해두면, 다음 단계에서 체인상 "뒤에" 오는 노드를 포함해 *어떤* 노드든 어떤 순서로든 참조할 수 있어요 — 전방 참조 에러가 나지 않아요.

## 3. 재시도 사이클을 포함해 그래프 연결하기

```ts
const designFlow = flow.flow((b) =>
  b
    .start("fetchFigma")
    .edge("fetchFigma", "fileAnalyzer")
    .edge("fileAnalyzer", "codeGen")
    .edge("codeGen", "build")
    .branch("build", (s) => (s.build?.ok ? "verify" : "codeGen")) // build↔codeGen 사이클
    .branch("verify", (s) => (s.figma ? "push" : "codeGen")) // verify↔codeGen 사이클
    .edge("push", "deploy")
    .edge("deploy", END),
);
```

재시도 루프는 `.branch("build", (s) => ...)` 안에 있어요: 빌드가 실패하면 `codeGen`으로 돌아가서 다시 시도해요. loopy는 사이클을 다른 엣지와 구분하지 않아요 — 그냥 우연히 뒤쪽을 가리키는 이름을 반환하는 라우터일 뿐이에요. 여기서 `s`는 `StateOf<typeof state>`라서, `s.build?.ok`는 실제로 좁혀지는 프로퍼티 접근이에요.

오타를 내보세요 — `.branch("build", (s) => (s.build?.ok ? "verfy" : "codeGen"))` — 그러면 `TS2820`이 뜨고 "verify'를 의도하신 건가요?" 같은 제안까지 나와요. 라우터의 반환 타입이 노드 이름들의 정확한 리터럴 유니온이기 때문이에요.

## 4. 단순 로직을 위한 인라인 step

모든 노드가 툴이나 에이전트일 필요는 없어요. 여기서 `build`와 `push`는 인라인 `step()`이에요 — 의존성이 선언된 평범한 함수로, 툴과 형태는 같지만 쓰이는 자리에 바로 정의돼요:

```ts
import { step } from "loopy";

const build = step({
  name: "build",
  input: io<{ paths: readonly string[] }>(),
  output: io<{ ok: boolean; log: string }>(),
  deps: ["repo"],
  run: async (_i, { deps }) => {
    void deps;
    return { ok: true, log: "OK" };
  },
});
```

## 결과

`designFlow`가 요구하는 의존성은 정확히 노드들이 선언한 의존성의 유니온이에요(`build`의 `"repo"`에 `fetchFigma`, `push`, `deploy`가 필요로 하는 것까지 더한 값). 이건 `NodeDepKeys`가 계산해요 — 자세한 내용은 [의존성 주입](/ko/core-concepts/dependency-injection/)에서 확인하세요. 에이전트와 함께 [`defineLoopy`](/ko/reference/registry/)에 등록하세요.

## 다음 단계

- [휴먼 인 더 루프](/ko/guides/human-in-the-loop/) — 같은 `step()`/`.nodes().flow()` 형태지만, 사람을 위해 멈추는 노드가 있어요.
- [API 레퍼런스 → workflow()](/ko/reference/workflow/)
