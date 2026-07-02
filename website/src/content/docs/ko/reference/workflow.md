---
title: workflow()
description: 타입이 지정된 데이터 기반 라우터를 가진 Step 노드들의 명시적 그래프예요. 노드 이름이 앞으로 새지 않도록 두 단계로 만들어요.
---

`workflow()`는 *여러분*이 제어 흐름을 결정하는 `Step` 그래프를 만들어요. 다음에 어떤 노드가 실행될지는 모델의 판단이 아니라, 타입이 지정된 상태의 함수로 정해져요.

## 시그니처 — 두 단계

```ts
export function workflow<Name, State, In, Out>(def: {
  name: Name;
  state: State;
  input: In;
  output: Out;
}): WorkflowInit<Name, State, In, Out>;

interface WorkflowInit<Name, State, In, Out> {
  nodes<const Nodes extends Record<string, AnyStep>>(
    nodes: Nodes,
  ): WorkflowNodes<Name, State, In, Out, Extract<keyof Nodes, string>, NodeDepKeys<Nodes>>;
}

interface WorkflowNodes<Name, State, In, Out, NodeName, Deps> {
  flow(
    build: (b: FlowBuilder<StateOf<State>, NodeName>) => FlowBuilder<StateOf<State>, NodeName>,
  ): Workflow<Name, State, In, Out, Deps>;
}

interface FlowBuilder<S, NodeName extends string> {
  start(node: NodeName): FlowBuilder<S, NodeName>;
  edge(from: NodeName, to: NodeName | END): FlowBuilder<S, NodeName>;
  branch(from: NodeName, router: (s: S) => NodeName | END): FlowBuilder<S, NodeName>;
}
```

`workflow(...)`만 호출하면 `.nodes(...)`만 노출하는 빌더가 나와요. `.nodes({...})`를 호출하는 것, 즉 **모든 노드를 미리 담은 레코드**를 넘기는 것이 `.flow(...)`가 순환과 백 엣지를 포함해 어떤 순서로든 노드 이름을 참조할 수 있게 해줘요. "선언 전 사용" 에러를 피할 수 있는 것도 이 덕분이에요. (이전에는 유창하게 이어지는 `.step(...).branch(...)` 형태를 시도했다가 정확히 이 이유로 포기했어요. `.branch`가 같은 체인 안에서 나중에 선언된 노드를 볼 수 없었거든요.)

## `FlowBuilder`

- **`.start(node)`** — 진입 노드예요.
- **`.edge(from, to)`** — 무조건 전이예요. `to`는 다른 노드 이름이거나 [`END`](/ko/reference/registry/)일 수 있어요.
- **`.branch(from, router)`** — 조건부 전이예요. `router`는 현재 [`StateOf<State>`](/ko/core-concepts/channels-and-state/) 스냅샷을 받아서 다음 노드 이름이나 `END`를 반환해요. 오타 난 반환 값은 컴파일 에러예요(`TS2820`이고, 한 노드 이름이 다른 이름과 비슷하면 "혹시 이걸 의도했나요?"라는 제안까지 함께 나와요).

`.edge`와 `.branch` 둘 다 `from`/`to`/라우터 반환 타입을, `.nodes({...})`에 선언된 노드 이름의 정확한 리터럴 유니온으로 제약해요. 문자열로 느슨하게 타입 지정된 부분은 하나도 없어요.

## 예제 — `.branch`로 만드는 순환

```ts
// examples/workflows.ts
export const designFlow = workflow({
  name: "designFlow",
  state: {
    figma: lastChannel<FigmaData | null>(null),
    build: lastChannel<{ ok: boolean } | null>(null),
    deploy: lastChannel<DeployResult | null>(null),
  },
  input: io<{ message: string }>(),
  output: io<{ prUrl: string }>(),
})
  .nodes({ fetchFigma, fileAnalyzer, codeGen, build, verify: verifier, push, deploy: waitForDeploy })
  .flow((b) =>
    b
      .start("fetchFigma")
      .edge("fetchFigma", "fileAnalyzer")
      .edge("fileAnalyzer", "codeGen")
      .edge("codeGen", "build")
      .branch("build", (s) => (s.build?.ok ? "verify" : "codeGen")) // build↔codeGen 순환
      .branch("verify", (s) => (s.figma ? "push" : "codeGen")) // verify↔codeGen 순환
      .edge("push", "deploy")
      .edge("deploy", END),
  );
```

노드는 어떤 [`Step`](/ko/core-concepts/step/)이든 될 수 있어요. `tool()`, `agent()`(위의 `verify: verifier`가 에이전트예요), 또는 인라인 `step()`도 가능해요.

```ts
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

`step()`의 실행 컨텍스트인 `NodeCtx`는 툴의 `ToolCtx`와 같지만, 기능이 하나 더 있어요. 바로 `interrupt`인데, [휴먼 인 더 루프](/ko/guides/human-in-the-loop/)에서 다뤄요.

## 다음 단계

- [채널 & 상태](/ko/core-concepts/channels-and-state/) — 모든 워크플로우 라우터가 읽는 `state` 객체예요.
- [가이드 → 결정적 워크플로우](/ko/guides/workflows/)
- [team()](/ko/reference/team/) — 같은 `.nodes().flow()` 형태의 메커니즘을, 에이전트에 특화한 버전이에요.
</content>
