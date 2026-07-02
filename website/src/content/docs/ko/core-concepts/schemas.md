---
title: 스키마 (IO)
description: loopy는 IO라는 벤더 중립적인 Standard Schema 형태의 캐리어로 정적 타입을 전달해요.
---

## 문제: 런타임 경계를 넘나드는 정적 타입

툴의 입력과 출력에는 두 가지가 동시에 필요해요. 컴파일러가 검사할 수 있는 **정적 TypeScript 타입**, 그리고 — 언젠가는 — **런타임 검증기**예요. 이 검증기는 LLM이 실제로 돌려주는 것(깨진 JSON, 마크다운 코드 펜스, 트레일링 콤마)을 그 타입으로 강제 변환해야 해요. loopy는 이 문제를 [Standard Schema](https://standardschema.dev/) 스펙 형태의 캐리어 타입 하나, `IO`로 풀어요. 이 스펙을 구현하는 검증기 라이브러리라면 — Zod, Valibot, ArkType, 그 밖의 무엇이든 — loopy가 그 라이브러리에 의존하지 않고도 갈아 끼울 수 있어요.

```ts
export interface IO<In, Out = In> {
  readonly "~standard": {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (
      value: unknown,
    ) => { readonly value: Out } | { readonly issues: readonly { readonly message: string }[] };
    readonly types?: { readonly input: In; readonly output: Out };
  };
}

export type InferIn<S extends IO<any, any>> = NonNullable<S["~standard"]["types"]>["input"];
export type InferOut<S extends IO<any, any>> = NonNullable<S["~standard"]["types"]>["output"];
```

정적 `In`/`Out` 타입은 **팬텀 프로퍼티**(`~standard.types`)에 들어 있어요. 런타임에는 실제로 채워지지 않아요 — `InferIn<S>` / `InferOut<S>`가 인덱스 접근으로 타입을 다시 꺼낼 수 있도록 존재할 뿐이에요. loopy 안에서 "이 스키마가 나타내는 실제 TypeScript 타입"이 필요한 모든 곳 — 툴의 `run` 매개변수, 워크플로우 노드의 반환 타입 — 은 스키마 객체 자체가 아니라 항상 `InferOut<...>`을 거쳐요.

## `io<Out, In>()` — 지금의 임시 생성자

프로토타입은 실제 검증기 의존성을 끌어들이지 않고도 타입 표면을 온전히 검증할 수 있도록 최소한의 생성자를 제공해요:

```ts
export function io<Out, In = Out>(vendor: string = "loopy"): IO<In, Out> {
  return {
    "~standard": {
      version: 1,
      vendor,
      validate: (value: unknown): { readonly value: Out } => ({ value: value as Out }),
    },
  };
}
```

`io<{ path: string; patch: string }>()`는 정적 출력 타입이 `{ path: string; patch: string }`인 스키마를 만들어줘요. 런타임에서 `validate`는 지금은 항등 캐스트일 뿐 실제 검증이 아니에요 — 레포지토리 나머지 부분이 타입 전용 스켈레톤인 것과 일관돼요(자세히는 [현황과 로드맵](/ko/status-roadmap/) 참고). 런타임이 들어오면 이 지점이 LLM 출력을 스키마로 실제 변환하는 이음매가 돼요. 조용히 실패를 넘기는 대신 타입이 붙은 파싱 에러를 내면서요 — `InferOut<S>`나 그 이후 단계는 전혀 바꾸지 않아요.

## 사용하기

```ts
import { io } from "loopy";

const input = io<{ path: string; find: string; replace: string }>();
const output = io<{ applied: boolean }>();
```

모든 [`tool()`](/ko/reference/tool/), [`agent()`](/ko/reference/agent/), 워크플로우 노드는 `io<...>()`로 만든 `input`과 `output` 스키마를 받아요 — 아니면, 실제 검증기가 연결된 뒤에는 같은 `~standard` 형태를 구현하는 Zod/Valibot/ArkType 스키마를요.

## 다음 단계

- [의존성 주입](/ko/core-concepts/dependency-injection/)
- [API 레퍼런스 → tool()](/ko/reference/tool/)
