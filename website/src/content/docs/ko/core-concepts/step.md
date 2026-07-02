---
title: Step 구조
description: loopy의 툴, 에이전트, 워크플로우 노드, 팀 멤버는 모두 Step이라는 하나의 형태를 공유해요.
---

## 모든 것은 Step이에요

loopy에서 이름을 가진 유닛은 툴이든, 에이전트든, 워크플로우 안의 노드든, 팀 안의 에이전트든 구조적으로 전부 같아요:

```ts
interface Step<
  Name extends string,
  In extends IO<any, any>,
  Out extends IO<any, any>,
  Deps extends keyof LoopyDeps,
> {
  readonly name: Name;
  readonly input: In;
  readonly output: Out;
  readonly run: (input: InferOut<In>, ctx: any) => Promise<InferOut<Out>>;
}
```

`Step`은 이름, 타입이 지정된 입력과 출력, 그리고 `run` 함수만 가져요. 그게 전부예요. `tool()`, `agent()`, 워크플로우의 `step()` 노드는 모두 `Step`을 만족하는 값을 반환해요. 그래서 별도 작업 없이도 서로 조합돼요:

| 종류 | 설명 | 제어 주체 |
|---|---|---|
| [`tool()`](/ko/reference/tool/) | 모델 없이 동작하는 Step이에요. 의존성을 선언하고 본문을 실행해요. | 내 코드 |
| [`agent()`](/ko/reference/agent/) | 모델이 직접 도는 루프예요. 툴(서브 에이전트 포함)과 핸드오프 대상 이름을 가져요. | 모델 |
| [`workflow()`](/ko/reference/workflow/) | 임의의 Step 노드와 타입이 지정된 데이터 기반 라우터예요. | 내 코드 |
| [`team()`](/ko/reference/team/) | 노드가 곧 에이전트고, 공유 트랜스크립트와 핸드오프 슈거가 있어요. | 하이브리드 |

## 에이전트가 툴 자리를 대신할 수 있는 이유

`Agent`도 `Tool`과 똑같은 방식으로 `Step`을 확장해요. 그래서 툴이 필요한 자리 어디에나 에이전트를 넘길 수 있어요. 별도 어댑터 없이 "툴로 쓰는 서브 에이전트"가 만들어져요:

```ts
// examples/agents.ts
export const codeGen = agent({
  name: "codeGen",
  model: "sonnet",
  instructions: "Generate code changes in a think→act→observe loop.",
  input: io<{ task: string }>(),
  output: io<{ applied: readonly string[]; failed: readonly string[] }>(),
  // edit/create/read 툴 + 툴 자리에 넘긴 서브 에이전트예요.
  tools: [editFile, createFile, readFile, fileAnalyzer],
  deps: ["repo"],
});
```

위의 `fileAnalyzer`는 `tool()`이 아니라 그 자체로 `agent()`예요. 그런데도 별도 래퍼 없이 진짜 툴들 옆 `tools: [...]`에 그대로 들어가요. `ToolDepKeys`는 각 툴이 선언한 의존성을 에이전트 자신의 의존성 유니온으로 접어 넣는 타입이에요. 항목이 `Tool`이든 `Agent`이든 상관없이 튜플 전체에 고르게 분배되기 때문에, `codeGen`의 추론된 의존성 요구사항(`"repo"`)은 "툴" 중 하나가 사실 완전히 다른 에이전트여도 정확해요.

## `AnyStep` 상한 타입

`tools: readonly AnyStep[]`처럼 여러 Step을 한데 담는 컬렉션에는, 입출력 스키마가 무엇이든 모든 `Tool<Name, In, Out, Deps>`와 `Agent<Name, In, Out, Deps, Tools>`를 받아들일 만큼 느슨한 상한 타입이 필요해요:

```ts
export type AnyStep = Step<string, IO<any, any>, IO<any, any>, keyof LoopyDeps>;
```

스키마 자리가 구체적인 Standard Schema 타입 대신 `IO<any, any>`로 넓혀진 것도 이 때문이에요. 타입 안전성을 포기한 것처럼 보이지만 사실은 정반대예요. TypeScript는 함수 *매개변수*를 반공변으로 검사해요. 그래서 상한을 구체적인 스키마 타입으로 만들면, 모든 실제 툴의 `run`이 `(input: unknown, ...) => ...`로 뭉개지면서 거부당해요. 즉 그 상한은 어떤 실제 툴도 담을 수 없을 만큼 오히려 *너무 좁아져요*. `any`는 양방향으로 호환되기 때문에 이 가변성 문제를 피해가요. 여기서 느슨해지는 건 이질적인 목록을 담기 위한 구조적 상한뿐이고, `tool()` / `agent()`가 실제로 반환하는 `Tool<...>` / `Agent<...>` 타입 자체는 여전히 완전히 정밀해요.

## 다음 단계

- [스키마 (IO)](/ko/core-concepts/schemas/) — `io<Out, In>()`이 런타임 라이브러리에 종속되지 않는 검증기를 통해 정적 타입을 전달하는 방법이에요.
- [의존성 주입](/ko/core-concepts/dependency-injection/) — `deps`가 추론이 아니라 선언되는 이유예요.
- [API 레퍼런스 → tool()](/ko/reference/tool/)
