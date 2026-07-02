---
title: 채널과 상태
description: loopy에서 상태는 타입이 지정된 채널들의 레코드예요. 채널마다 리듀서가 선언되어 있고, 워크플로우와 팀은 업데이트를 채널에 접어 넣어요. 라우터는 이 타입이 지정된 스냅샷을 보고 갈래를 나눠요.
---

## 상태는 변수가 아니라 채널이에요

워크플로우에는 "변수"가 없어요. 같은 메커니즘 위에 지어진 팀도 마찬가지예요. 대신 **채널**이 있어요. 채널은 값 타입과 업데이트 타입, 그리고 들어온 업데이트를 현재 값에 접어 넣는 리듀서를 가진, 이름이 붙은 슬롯이에요:

```ts
export interface Channel<V, U = V> {
  readonly "~value": V;
  readonly "~update": U;
  readonly reduce: (current: V, update: U) => V;
  readonly initial: () => V;
}
```

`V`와 `U`는 서로 다를 수 있어요. 예를 들어 `listChannel`의 값 타입은 `readonly T[]`지만, 업데이트로는 새 아이템 하나를 건네도 되고 배치를 통째로 건네도 돼요. 노드는 상태를 직접 바꾸지 않고 업데이트만 반환하며, 런타임이 그 업데이트를 해당 채널의 `reduce`로 접어 넣어요. 그래서 이 엔진 전체는 **`state = fold(reduce, log, initial)`**이라는 불변식 하나로 설명돼요. 라우터가 읽는 실시간 상태는 이 fold의 결과를 캐시해 둔 것일 뿐이고, 그 밑에 깔린 추가 전용 이벤트 로그가 유일하게 진짜인 권위예요. 이 불변식 덕분에 런타임이 생긴 뒤에는 [이벤트 소싱 리플레이](/ko/core-concepts/event-sourcing/)도 가능해져요. 로그를 리플레이한다는 건 결국 같은 fold를 다시 실행하는 것뿐이니까요.

## 세 가지 채널 생성자

```ts
export function lastChannel<T>(init: T): Channel<T, T> {
  return { /* ... */ reduce: (_c, u) => u, initial: () => init };
}

export function listChannel<T>(): Channel<readonly T[], T | readonly T[]> {
  return {
    /* ... */
    reduce: (c, u) => (Array.isArray(u) ? [...c, ...u] : [...c, u as T]),
    initial: () => [],
  };
}
```

| 생성자 | 리듀서 | 쓰임새 |
|---|---|---|
| `lastChannel(init)` | 덮어쓰기 — 가장 최근 업데이트가 이겨요 | 매번 교체되는 결과, 예: 가장 최신 리뷰 판정 |
| `listChannel()` | 추가 — 아이템 하나씩 또는 배치로 계속 쌓여요 | 계속 쌓이는 로그, 예: 대화 트랜스크립트 |
| `inputChannel<T>()` | 덮어쓰기지만 **정적 초기값이 없어요** — 실행의 실제 입력 인자로 채워져요 | 실행 자체의 입력, 예: 팀이 트리아지하는 이슈 |

`inputChannel`은 [`team()`](/ko/reference/team/)에서 써요. 값과 업데이트 레벨에서는 `lastChannel`과 형태가 같지만, *브랜드*가 붙어 있어요(`readonly "~input": true`). 이 브랜드 덕분에 타입 시스템이 팀의 일반 도메인 채널과 실행 입력을 구성하는 채널을 정확히 구분해서 골라낼 수 있어요:

```ts
export interface InputChannel<T> extends Channel<T, T> {
  readonly "~input": true;
}
export function inputChannel<T>(): InputChannel<T> { /* ... */ }

export type TeamInputOf<State> = {
  readonly [K in keyof State as State[K] extends InputChannel<any> ? K : never]:
    State[K] extends InputChannel<infer T> ? T : never;
};
```

## 상태 읽기: `StateOf`

채널들의 레코드가 주어지면, `StateOf`는 라우터가 실제로 보게 되는 평범한 객체 형태를 알려줘요. 채널 래퍼가 아니라 각 채널의 *값* 타입만 남긴 형태로요:

```ts
export type StateOf<C> = { readonly [K in keyof C]: C[K] extends Channel<infer V, any> ? V : never };
```

```ts
const state = {
  figma: lastChannel<FigmaData | null>(null),
  build: lastChannel<{ ok: boolean } | null>(null),
};
// StateOf<typeof state> = { readonly figma: FigmaData | null; readonly build: { ok: boolean } | null }
```

[`workflow()`](/ko/reference/workflow/) 라우터의 매개변수는 정확히 선언된 상태의 `StateOf<...>`예요. 그래서 `s.build?.ok`는 진짜로 좁혀지고 오타까지 검사되는 프로퍼티 접근이지, 범용 가방을 문자열로 뒤지는 게 아니에요.

## 다음 단계

- [이벤트 소싱과 리플레이](/ko/core-concepts/event-sourcing/)
- [API 레퍼런스 → Channels](/ko/reference/channels/)
- [가이드 → 결정적 워크플로우](/ko/guides/workflows/)
