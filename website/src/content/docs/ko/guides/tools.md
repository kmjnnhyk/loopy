---
title: 툴 만들기
description: 툴을 단계별로 만들어요. 의존성을 선언하고 본문을 작성한 다음, 멱등성 계약까지 이해해요.
---

이 가이드는 `examples/tools.ts`의 실제 툴 하나인 `editFile`을 만드는 과정을 다뤄요.

## 1. 의존성을 한 번만 선언하기

툴을 작성하기 전에, 먼저 앱에서 `LoopyDeps`를 확장해서 의존성을 선언해요:

```ts
// deps.ts
export interface GitRepo {
  read(path: string): Promise<string>;
  write(path: string, content: string): Promise<void>;
  find(query: string): Promise<readonly string[]>;
}

declare module "@loopyjs/core" {
  interface LoopyDeps {
    repo: GitRepo;
  }
}
```

이건 의존성마다 한 번만 하면 되는 작업이에요. loopy가 왜 이걸 추론이 아니라 명시적으로 요구하는지는 [의존성 주입](/ko/core-concepts/dependency-injection/)에서 확인하세요.

## 2. 입력과 출력의 형태 잡기

툴의 `input`/`output`은 [`IO<...>`](/ko/core-concepts/schemas/) 스키마예요. 내장 `io<T>()`는 정적 타입을 그대로 주면서 검증기 자리엔 항등 함수를 채워 넣어요. 실제 런타임 강제 변환이 필요하면 Zod, Valibot, ArkType으로 바꿔 끼우면 돼요:

```ts
import { io } from "@loopyjs/core";

const input = io<{ path: string; find: string; replace: string }>();
const output = io<{ applied: boolean }>();
```

## 3. 툴 작성하기

```ts
import { tool, io } from "@loopyjs/core";

export const editFile = tool({
  name: "editFile",
  description: "Apply a find/replace edit to a file.",
  input: io<{ path: string; find: string; replace: string }>(),
  output: io<{ applied: boolean }>(),
  deps: ["repo"],
  run: async (i, { deps }) => {
    const cur = await deps.repo.read(i.path);
    await deps.repo.write(i.path, cur.replace(i.find, i.replace));
    return { applied: true };
  },
});
```

`deps: ["repo"]`가 있어야 `run` 안에서 `deps.repo`를 쓸 수 있어요. 여기서 `deps.figma`(이 툴이 선언한 적 없는 의존성)를 써 보면, TypeScript가 아무것도 실행되기 전에 호출 지점에서 바로 `TS2339`로 거부해요.

## 4. 멱등하지 않은 효과에는 `idempotencyKey` 추가하기

loopy의 내구성 모델은 at-least-once예요. 실행 도중 크래시가 난 툴 호출은 복구 시 다시 발급돼요. `editFile`의 제자리 치환은 원래 두 번 실행해도 안전해요. 흔한 경우엔 이미 수정된 내용에 같은 find/replace를 다시 적용하면 두 번째는 아무 일도 안 일어나요. 하지만 `createFile` 같은 툴은 그렇지 않아요: 두 번 실행하면 중복 생성되거나 기존 파일을 덮어쓸 수 있어요. 런타임이 중복 제거를 구현했을 때 재발급된 호출을 알아볼 수 있도록 `idempotencyKey`를 선언하세요:

```ts
export const editFile = tool({
  // ...
  idempotencyKey: (i) => `edit:${i.path}:${i.find}`,
  // ...
});
```

이 키를 "다시 발생해도 이게 *같은* 호출이라는 걸 알려주는 값"이라고 생각하세요. 보통 입력 전체가 아니라, 의미상 식별에 필요한 필드들만 안정적으로 해시한 값이에요.

## 결과

`editFile`은 빈틈없이 타입이 지정된 [`Step`](/ko/core-concepts/step/)이에요. `name`은 리터럴 `"editFile"`로 보존되고, 의존성 요구사항은 정확히 `"repo"`이며, `run` 시그니처는 `(input: { path: string; find: string; replace: string }, ctx: ToolCtx<"repo">) => Promise<{ applied: boolean }>`예요. 이제 [`agent()`](/ko/reference/agent/)의 `tools` 배열에 넣거나 [`workflow()`](/ko/reference/workflow/)의 노드로 바로 쓸 수 있어요.

## 다음 단계

- [툴을 쓰는 에이전트](/ko/guides/agent-with-tools/) — `editFile`을 모델 루프 안에서 동작시켜 보세요.
- [API 레퍼런스 → tool()](/ko/reference/tool/)
