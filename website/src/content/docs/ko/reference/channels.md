---
title: 채널
description: lastChannel, listChannel, inputChannel — 워크플로우와 팀이 업데이트를 접어 넣는, 타입이 붙은 상태 슬롯이에요.
---

상태가 왜 이런 방식으로 모델링되는지에 대한 전체 설명은 [핵심 개념 → 채널 & 상태](/ko/core-concepts/channels-and-state/)를 보세요. 이 페이지는 간결한 시그니처 레퍼런스예요.

## `Channel<V, U>`

```ts
export interface Channel<V, U = V> {
  readonly "~value": V;
  readonly "~update": U;
  readonly reduce: (current: V, update: U) => V;
  readonly initial: () => V;
}

export type StateOf<C> = { readonly [K in keyof C]: C[K] extends Channel<infer V, any> ? V : never };
```

## `lastChannel(init)`

```ts
export function lastChannel<T>(init: T): Channel<T, T>;
```

덮어쓰기 시맨틱이에요 — 업데이트마다 현재 값을 대체해요.

```ts
const review = lastChannel<ReviewResult | null>(null);
```

## `listChannel()`

```ts
export function listChannel<T>(): Channel<readonly T[], T | readonly T[]>;
```

추가 시맨틱이에요 — 단일 항목이든 배열이든 받아서 뒤에 붙여요. `[]`에서 시작해요.

```ts
const transcript = listChannel<Msg>();
```

## `inputChannel()`

```ts
export interface InputChannel<T> extends Channel<T, T> {
  readonly "~input": true;
}
export function inputChannel<T>(): InputChannel<T>;
```

`lastChannel`과 같은 덮어쓰기 시맨틱이지만, 정적인 `init` 값이 없어요 — 대신 [`team()`](/ko/reference/team/) 실행이 실제로 호출될 때 받은 입력으로 초깃값이 채워져요. `"~input": true`로 브랜딩돼 있어서, `TeamInputOf<State>`가 팀의 `state` 레코드에서 이 채널들만 골라내 실행의 입력 형태를 유도할 수 있어요.

```ts
export type TeamInputOf<State> = {
  readonly [K in keyof State as State[K] extends InputChannel<any> ? K : never]:
    State[K] extends InputChannel<infer T> ? T : never;
};
```

```ts
const issue = inputChannel<Issue>();
```

## `END`

```ts
export const END: "~end" = "~end";
export type END = typeof END;
```

[`workflow()`](/ko/reference/workflow/)의 `.branch`/`.edge` 대상이나 [`team()`](/ko/reference/team/)의 `.router`가 실행을 끝내기 위해 반환하는 센티널이에요.

## 다음 단계

- [핵심 개념 → 채널 & 상태](/ko/core-concepts/channels-and-state/)
- [workflow()](/ko/reference/workflow/) · [team()](/ko/reference/team/)
