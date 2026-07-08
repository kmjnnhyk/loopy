---
title: 빠른 시작
description: loopy를 설치하고 몇 분 안에 첫 프로그램을 실행해 보세요.
---

## 지금 loopy로 할 수 있는 것

loopy는 **타입 세이프한 TypeScript DSL이면서 실제로 동작하는 런타임**이에요. `next` dist-tag로 `@loopyjs/core`(그리고 관련 패키지들)라는 이름으로 npm에 배포돼 있어요. `tool`, `agent`, `workflow`, `team` 같은 모든 기본 단위는 완전히 타입 검증되는 동시에 *실제로 실행*돼요. `defineLoopy(...)`가 런타임을 만들고, `runtime.run(name, input)`이 이벤트 소싱 커널을 구동해서 실제로 모델을 호출하고, 툴을 실행하고, 리플레이 가능한 로그를 남겨요.

구체적으로 이런 걸 쓸 수 있어요: 추가 전용 이벤트 로그(`state = fold(reducer, log)`), 에이전트/워크플로우/팀 드라이버, 휴먼 인 더 루프 서스펜드 & 재개(`ctx.interrupt()` + `runtime.resume(...)`), 인메모리 스토어와 SQLite 스토어, 모델 클라이언트(내장 스텁과 `@loopyjs/anthropic`), 구조화 출력을 위한 Schema-Aligned Parsing, 기록→재생 테스트 하네스(`@loopyjs/test`), 로컬 DevTools UI(`loopy dev`).

API는 아직 1.0 이전이라 `1.0.0` 릴리스 전에 바뀔 수 있어요. 정확히 무엇이 안정적이고 무엇이 아직 움직이는지는 [현황과 로드맵](/ko/status-roadmap/)에서 확인하세요.

## 설치

```bash
bun add @loopyjs/core@next
```

필요한 만큼 패키지를 core 위에 얹으세요:

```bash
bun add @loopyjs/anthropic@next              # 실제 모델 호출 (Anthropic)
bun add -d @loopyjs/cli@next @loopyjs/devtools@next @loopyjs/test@next   # loopy dev / loopy test
```

Bun이 주 런타임이에요. 패키지의 `bun` export 조건을 통해 TypeScript 소스를 직접 실행해요. Node도 빌드된 `dist` 출력을 통해 잘 동작하고, npm / pnpm도 패키지 매니저로 문제없이 써요.

## 최소로 실행 가능한 예제

이건 완전히 동작하는 loopy 프로그램이에요. `step()` 하나를 노드 하나짜리 `workflow()`로 감싸고, `defineLoopy`로 런타임에 연결한 다음 실행해요.

```ts
import { defineLoopy, workflow, step, node, io, lastChannel, END } from "@loopyjs/core";

const greet = step({
  name: "greet",
  input: io<{ name: string }>(),
  output: io<{ message: string }>(),
  run: async (i) => ({ message: `Hello, ${i.name}!` }),
});

export const hello = workflow({
  name: "hello",
  state: { greeting: lastChannel<{ message: string } | null>(null) },
  input: io<{ name: string }>(),
  output: io<{ message: string }>(),
})
  .nodes({
    greet: node(greet, { reads: (s) => ({ name: s.input.name }), writes: "greeting" }),
  })
  .flow((b) => b.start("greet").edge("greet", END))
  .returns((s) => ({ message: s.greeting?.message ?? "" }));

export const runtime = defineLoopy({
  agents: {},
  workflows: { hello },
  deps: {},
});

const out = await runtime.run("hello", { name: "world" });
console.log(out); // { message: "Hello, world!" }
```

여기선 모델을 하나도 호출하지 않아요. 첫 예제를 의존성 없이 깔끔하게 보여주려는 의도예요. 실제 의존성이 있는 툴은 [가이드: 툴 만들기](/ko/guides/tools/)를, 모델이 판단하는 에이전트는 [가이드: 툴을 쓰는 에이전트](/ko/guides/agent-with-tools/)를 참고하세요.

## 실행 과정 지켜보기: `loopy dev`

모듈에서 `runtime`을 내보내고 (위처럼) DevTools CLI로 그걸 가리키세요:

```bash
loopy dev ./loopy.config.ts --port 5173
```

`http://localhost:5173`에 로컬·오프라인·읽기 전용 웹 UI가 열려요. 스텝 타임라인, 실행 경로가 오버레이된 워크플로우 그래프, 각 스텝의 모델/툴 입출력을 보여주는 상세 패널로 구성돼요. 자세한 내용은 [DevTools (loopy dev)](/ko/guides/devtools/)를 확인하세요.

## 모델을 두 번 호출하지 않고 테스트하기: `loopy test`

`@loopyjs/test`는 한 번 실행한 결과를 골든 로그로 기록한 다음, 이후로는 LLM 호출 없이 그걸 리플레이해요. 모델에 비용을 내고 기다리는 대신, 오케스트레이션 회귀만 정확히 잡아내요:

```bash
loopy test        # 골든 로그와 대조하며 리플레이
loopy test -u     # 의도한 변경 후 다시 기록
```

## 다음 단계

- API가 처음이라면 [핵심 개념 → Step 구조](/ko/core-concepts/step/)부터 시작하세요. 모든 것이 `Step` 하나로 통해요.
- 손으로 익히는 쪽이 좋다면 [가이드](/ko/guides/tools/)에서 툴 → 에이전트 → 워크플로우 → 팀 순서로 따라와 보세요.
- 무엇이 이미 나왔고 무엇이 아직 움직이는지 궁금하다면 [현황과 로드맵](/ko/status-roadmap/)에 경계가 정확히 그어져 있어요.
