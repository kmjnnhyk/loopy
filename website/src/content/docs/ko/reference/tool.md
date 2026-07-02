---
title: tool()
description: 모델 없이 동작하는 능력이에요. 의존성 조각을 선언하고, 본문을 실행한 뒤, 타입이 지정된 출력을 반환해요.
---

`tool()`은 모델 없이 동작하는 [`Step`](/ko/core-concepts/step/)을 만들어요. [`agent()`](/ko/reference/agent/)가 호출하는 평범하고 결정적인 능력일 수도 있고, [`workflow()`](/ko/reference/workflow/)의 노드로 단독으로 쓰일 수도 있어요.

## 시그니처

```ts
export interface Tool<Name, In, Out, Deps> extends Step<Name, In, Out, Deps> {
  readonly "~kind": "tool";
  readonly description: string;
  readonly run: (input: InferOut<In>, ctx: ToolCtx<Deps>) => Promise<InferOut<Out>>;
  /** 최소 1회(at-least-once) 지속성 계약: 툴 실행 도중 크래시가 나면 재실행되므로 멱등성이 필요해요. */
  readonly idempotencyKey?: (input: InferOut<In>) => string;
}

export function tool<
  const Name extends string,
  In extends IO<any, any>,
  Out extends IO<any, any>,
  const D extends readonly (keyof LoopyDeps)[] = [],
>(def: {
  name: Name;
  description: string;
  input: In;
  output: Out;
  deps?: D;
  idempotencyKey?: (input: InferOut<In>) => string;
  run: (input: InferOut<In>, ctx: ToolCtx<D[number]>) => Promise<InferOut<Out>>;
}): Tool<Name, In, Out, D[number]>;
```

## 필드

- **`name`** — 문자열 리터럴이에요. 타입에 그대로 보존돼서(`string`으로 넓혀지지 않아요) 툴이 쓰이는 모든 곳에 이 이름 그대로 나타나요. 예를 들면 [`agent()`](/ko/reference/agent/)의 `ToolMap`에서 키로 쓰여요.
- **`description`** — 툴이 하는 일을 평범한 말로 설명한 거예요. 여러분이 아니라 모델이 읽는 텍스트예요.
- **`input` / `output`** — `io<...>()`(또는 Standard Schema 형태의 검증기라면 무엇이든)로 만든 [`IO<...>`](/ko/core-concepts/schemas/) 스키마예요.
- **`deps`** — [`LoopyDeps`](/ko/core-concepts/dependency-injection/)의 키를 문자열 리터럴로 나열한 배열이에요. 기본값은 `[]`이고, `run` 안에서 `ctx.deps`가 정확히 무엇을 노출할지 결정해요.
- **`idempotencyKey`** — 선택 사항이에요. loopy의 지속성 모델은 최소 1회(at-least-once) 실행을 보장해요. 프로세스가 툴 호출 도중 크래시 나면 런타임이 복구 시점에 호출을 다시 내보내요. 효과가 자연히 멱등적이지 않은 툴(예: "파일 생성", "PR 열기")이라면 `idempotencyKey`를 제공하세요. 런타임이 이를 구현하고 나면, 재실행된 호출을 인식해서 중복을 제거할 수 있어요.
- **`run`** — 툴의 본문이에요. 검증된 입력과 [`ToolCtx<Deps>`](/ko/core-concepts/dependency-injection/)를 받아요. 평범한 툴이라면 그냥 `{ deps }`예요 — [`team()`](/ko/reference/team/)이 쓰는 `interrupt` 확장은 [휴먼 인 더 루프](/ko/guides/human-in-the-loop/)를 보세요.

## 예제

```ts
import { tool, io } from "loopy";
import type { GitRepo } from "./deps";

export const editFile = tool({
  name: "editFile",
  description: "Apply a find/replace edit to a file.",
  input: io<{ path: string; find: string; replace: string }>(),
  output: io<{ applied: boolean }>(),
  deps: ["repo"],
  idempotencyKey: (i) => `edit:${i.path}:${i.find}`,
  run: async (i, { deps }) => {
    const cur = await deps.repo.read(i.path);
    await deps.repo.write(i.path, cur.replace(i.find, i.replace));
    return { applied: true };
  },
});
```

*(`examples/tools.ts`에서 가져왔어요)*

## 다음 단계

- [agent()](/ko/reference/agent/) — 에이전트의 `tools` 배열에 이 툴을 넘겨보세요.
- [가이드 → 툴 작성하기](/ko/guides/tools/)
</content>
