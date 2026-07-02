---
title: "가이드: 툴을 쓰는 에이전트"
description: 툴을 호출하는 에이전트를 만들어요 — 서브 에이전트를 `tools` 배열에 넣어서 컴포지션이 공짜로 따라오는 걸 확인해요.
---

이 가이드는 `examples/agents.ts`의 `codeGen` 에이전트를 만들어요. 작은 툴셋 위에서 think→act→observe 루프를 직접 소유하는 에이전트인데, 그 툴셋에는 툴로 쓰이는 또 다른 에이전트도 포함돼요.

## 1. 필요한 툴부터 준비하기

`editFile`, `createFile`, `readFile`이 이미 있다고 가정할게요([가이드: 툴 만들기](/ko/guides/tools/) 참고) — 셋 다 `deps: ["repo"]`를 선언하는 평범한 `tool()`이에요.

## 2. 먼저 평범한 에이전트 정의하기

```ts
import { agent, io } from "loopy";

export const fileAnalyzer = agent({
  name: "fileAnalyzer",
  model: "haiku",
  instructions: "Identify the files relevant to a goal.",
  input: io<{ goal: string }>(),
  output: io<{ paths: readonly string[] }>(),
  deps: ["repo"],
});
```

`fileAnalyzer`는 자체 `tools`가 없어요 — "목표가 주어지면 어떤 파일이 중요한지 판단한다"는 게 이 작은 전용 에이전트의 일이에요. 그래도 `deps: ["repo"]`는 선언하는데, instructions가 리포지토리를 들여다보라고 지시할 걸로 보이기 때문이에요. 이 타입 시그니처에는 명시적인 툴 호출이 보이지 않지만, 실제로 그 조회를 수행하는 건 나중에 구현될 모델 루프예요.

## 3. 그걸 툴로 쓰는 에이전트 만들기

```ts
export const codeGen = agent({
  name: "codeGen",
  model: "sonnet",
  instructions: "Generate code changes in a think→act→observe loop.",
  input: io<{ task: string }>(),
  output: io<{ applied: readonly string[]; failed: readonly string[] }>(),
  // edit/create/read tools + a sub-agent passed where a tool is expected.
  tools: [editFile, createFile, readFile, fileAnalyzer],
  deps: ["repo"],
});
```

`fileAnalyzer`는 래퍼나 어댑터 없이 진짜 툴들 바로 옆, `tools` 배열 안에 그대로 들어가요. `Agent`와 `Tool`이 구조적으로 둘 다 [`Step`](/ko/core-concepts/step/)이기 때문에 가능한 일이에요 — 타입 시스템이 정확히 왜 이걸 허용하는지는 [Step 구조](/ko/core-concepts/step/)에서 볼 수 있어요. 개념적으로 `codeGen`은 다른 툴을 호출하듯 "어떤 파일이 관련 있는가?"를 `fileAnalyzer`에 위임할 수 있고, 그러면 `fileAnalyzer` 자신의 모델 루프가 돌면서 답을 내요.

## 4. 추론된 타입 확인하기

```ts
import type { ToolDepKeys } from "loopy";

type CodeGenToolDeps = ToolDepKeys<typeof codeGen.tools>;
// = "repo" — editFile, createFile, readFile, fileAnalyzer로부터 누적됐어요.
//   fileAnalyzer가 Tool이 아니라 Agent인데도 마찬가지예요.
```

이건 `examples/consumer.ts`에서 실제 컴파일 어서션으로 검사돼요 — `ToolDepKeys<typeof codeGen.tools>`는 정말로 정확히 `"repo"`로 해석되고, `unknown`도 아니고 앱에 있는 모든 의존성의 유니온도 아니에요.

## 5. 호출 지점에서 걸러지는 중복 이름

```ts
agent({
  name: "codeGen",
  // ...
  tools: [editFile, editFile], // ❌ compile error — NoDuplicateTools brands this call
  // ...
});
```

이름이 같은 툴 두 개는 원래대로라면 에이전트 내부의 툴 맵 안에서 조용히 충돌해요. `NoDuplicateTools`가 이걸 컴파일 타임 거부로 바꿔줘요.

## 다음 단계

- [결정적 워크플로우](/ko/guides/workflows/) — `codeGen`을 재시도 사이클이 있는 명시적 그래프의 노드 하나로 써 보세요.
- [API 레퍼런스 → agent()](/ko/reference/agent/)
