---
title: agent()
description: 모델을 소유하는 think→act→observe 루프예요. 툴(서브 에이전트 포함)과 선언된 의존성 조각을 지녀요.
---

`agent()`는 모델 루프를 소유하는 [`Step`](/ko/core-concepts/step/)을 만들어요 — [`tool()`](/ko/reference/tool/)과 달리 `model`과 `instructions`를 갖고, 입력에서 출력까지 *어떻게* 도달할지를 스스로 결정하며, 그 과정에서 자신의 `tools`를 호출해요.

## 시그니처

```ts
export interface Agent<Name, In, Out, Deps, Tools, Pass extends string = never> extends Step<Name, In, Out, Deps> {
  readonly "~kind": "agent";
  readonly model: string;
  /** the concrete tool tuple is PRESERVED (not widened to AnyStep[]) so a
   *  consumer's `ToolDepKeys<typeof agent.tools>` stays precise across .d.ts. */
  readonly tools: Tools;
  /** phantom: union of declared passTo target NAMES — see team(). */
  readonly "~passTo"?: Pass;
  readonly run: (input: InferOut<In>, ctx: AgentCtx<Deps>) => Promise<InferOut<Out>>;
}

export function agent<
  const Name extends string,
  In extends IO<any, any>,
  Out extends IO<any, any>,
  const Tools extends readonly AnyStep[] = [],
  const D extends readonly (keyof LoopyDeps)[] = [],
  const Pass extends readonly string[] = [],
>(def: {
  name: Name;
  model: string;
  instructions: string;
  input: In;
  output: Out;
  tools?: Tools & NoDuplicateTools<Tools>;
  deps?: D;
  passTo?: Pass;
}): Agent<Name, In, Out, D[number] | ToolDepKeys<Tools>, Tools, Pass[number]>;
```

## 필드

- **`model`** — 모델을 식별하는 평범한 문자열이에요, 예를 들면 `"claude-opus"`, `"haiku"`. loopy는 아직 이 값을 검증하지 않아요 — 있는 그대로 전달될 뿐이에요.
- **`instructions`** — 에이전트의 시스템 프롬프트 / 역할 설명이에요.
- **`input` / `output`** — `tool()`과 같은 [`IO<...>`](/ko/core-concepts/schemas/) 스키마예요.
- **`tools`** — `Tool`과 다른 `Agent`로 이루어진 배열이에요(에이전트가 여기 들어갈 수 있는 이유는 [Step 구조](/ko/core-concepts/step/)를 보세요). 기본값은 `[]`예요. 중복된 툴 이름은 `NoDuplicateTools`로 컴파일 에러가 나요 — `tools: [editFile, editFile]`은 타입 검사를 통과하지 못해요.
- **`deps`** — 에이전트가 *직접* 필요로 하는 의존성이에요(자신의 툴들이 이미 선언한 것과는 별개로요). 에이전트의 실제 의존성 유니온은 `deps[number] | ToolDepKeys<Tools>`예요 — [의존성 주입](/ko/core-concepts/dependency-injection/)을 보세요.
- **`passTo`** — [`team()`](/ko/reference/team/)에서만 쓰여요. 평범한 단독 에이전트라면 필요 없어요. *같은 팀 안에서* 이 에이전트가 핸드오프할 수 있는 다른 에이전트들의 이름을 선언해요. 컴파일 타임에 모든 이름이 실제 팀 멤버십과 대조 검사돼요 (자세한 건 [team() → passTo 멤버십 가드](/ko/reference/team/#passto-멤버십-가드)를 보세요).

## 예제

```ts
// examples/agents.ts
export const codeGen = agent({
  name: "codeGen",
  model: "sonnet",
  instructions: "Generate code changes in a think→act→observe loop.",
  input: io<{ task: string }>(),
  output: io<{ applied: readonly string[]; failed: readonly string[] }>(),
  // edit/create/read 툴 + 툴 자리에 넘겨진 서브 에이전트 하나.
  tools: [editFile, createFile, readFile, fileAnalyzer],
  deps: ["repo"],
});
```

## `passTo`가 있는 예제

```ts
// examples/team.ts
export const triage = agent({
  name: "triage", model: "opus",
  instructions: "Read the issue; hand to bugFixer or docsWriter.",
  input: io<{ issue: Issue }>(), output: io<{ kind: string }>(),
  passTo: ["bugFixer", "docsWriter"],
});
```

## 다음 단계

- [workflow()](/ko/reference/workflow/) — 명시적 그래프의 노드 하나로 에이전트를 써보세요.
- [team()](/ko/reference/team/) — 멀티 에이전트 루프의 노드로 에이전트들을 써보세요.
- [가이드 → 툴을 가진 에이전트](/ko/guides/agent-with-tools/)
