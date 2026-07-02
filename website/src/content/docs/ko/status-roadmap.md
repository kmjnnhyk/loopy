---
title: 현황과 로드맵
description: 오늘 실제로 구현된 것, 설계는 됐지만 아직 안 만들어진 것, 아직 설계조차 안 된 것을 있는 그대로 정리했어요.
---

loopy는 **타입 표면 우선**으로 만들어지고 있어요: 런타임 코드를 한 줄도 쓰기 전에 컴파일 타임 계약부터 확정하고 증명해요. 이 페이지는 그 경계를 정확히 그어서, 이 사이트의 어떤 페이지도 지금 실제로 할 수 있는 것보다 과장해서 말하지 않도록 해요.

## 오늘 작동하는 것

**타입 표면** — `tool()`, `agent()`, `workflow()`, `team()`, 채널(`lastChannel`, `listChannel`, `inputChannel`), 레지스트리(`defineLoopy`, `loopy().provide(...)`)는 전부 `master`에 존재하는 실제, export된, 타입 검증된 팩토리예요. [핵심 개념](/ko/core-concepts/step/)과 [API 레퍼런스](/ko/reference/) 페이지의 모든 주장은 다음으로 증명돼요:

- **컴파일 어서션** (`examples/consumer.ts`, `examples/team-consumer.ts`) — `Expect<Equal<...>>`로 특정 추론 타입이 정확히 맞는지 검사해요 (예: 의존성 유니온이 `"repo"`로 유지되고 앱의 모든 의존성으로 넓어지지 않는지, 또는 `team()`의 `passTo` 멤버십 가드가 엉뚱한 핸드오프 대상을 실제로 거부하는지).
- **실패해야 하는 픽스처** (`examples/_negative.ts`) — 빌드를 *반드시* 실패시켜야 하는 실수들을 별도로 컴파일해서, 정확한 진단(`TS2820`, `TS2741`, ...)까지 고정해둬요. `team()` 부분만 해도 이런 픽스처가 다섯 개예요.
- **직접 읽어본 `.d.ts` 출력** (`isolatedDeclarations: true` 상태) — 소스코드뿐 아니라 패키지 경계 자체를 직접 검사했어요.

`team()`은 특히 자체 완료 게이트를 통과했어요 — 긍정 케이스 7개, 부정 케이스 5개의 컴파일 어서션과 10-에이전트 스케일 체크까지 거친 뒤에야 `master`에 머지됐어요. 기준 시나리오는 `examples/team.ts`를 참고하세요 ([팀 모델 깊이 보기](/ko/team-model/)에서 다룬 것과 같은 PR 트리아지 예제예요).

**위의 것들 중 아직 실제로 동작하지 않는 부분:** `run` 본문은 스텁이에요. `tool()`의 `run`은 스크립트에서 직접 호출하면 작성한 그대로 실행되지만, loopy의 그 무엇도 아직 실제 모델 루프를 돌리거나, workflow나 team 그래프를 턴 단위로 실행하거나, 무언가를 영속화하지 않아요. 자세한 내용은 다음 섹션을 참고하세요. `team()`도 마찬가지예요: 타입 표면(누가 누구에게 핸드오프할 수 있는지, 라우터가 무엇을 반환할 수 있는지, 출력이 채널에 어떻게 들어가는지)은 완전히 검증됐지만, 아직 트리아지 루프를 실제로 실행하는 건 없어요.

## 설계는 됐지만 아직 안 만들어진 것 (런타임)

컨트롤 루프, 이벤트 소싱 리플레이, `passTo` 처리, 휴먼 인 더 루프 *실행*은 상세히 설계돼 있어요 — [이벤트 소싱과 리플레이](/ko/core-concepts/event-sourcing/) 참고 — 하지만 아직 구현되지 않았어요. 구체적으로 아직 안 만들어진 것들이에요:

- `workflow()`나 `team()` 그래프를 턴 단위로 실제로 실행하는 스케줄러.
- append-only 이벤트 로그, 체크포인터, `fold(reduce, log)` 리플레이 엔진.
- 기록되는 이펙트로서의 `ctx.callModel` / `ctx.callTool` (지금은 아무것도 I/O를 가로채지 않아요 — `run` 본문은 그냥 평범한 async 함수예요).
- 실행을 실제로 일시 중단하고 재개하는 `ctx.interrupt(...)` / `runtime.resume(...)`.
- Schema-Aligned Parsing — `io()`의 `validate`는 지금은 항등 캐스트일 뿐, LLM 출력을 실제로 강제 변환하지 않아요.

## 아직 설계조차 안 된 것

- 병렬 / 동시 실행 에이전트 (지금은 팀 턴마다 정확히 에이전트 하나만 실행돼요).
- 중첩 팀 (다른 team이나 workflow 안의 노드로 쓰이는 team).
- 타입이 붙은 에러 채널 (예외 throw와는 별개로, 전용의 타입이 붙은 실패 경로).
- `loopy dev`(로컬 개발/디버깅용 웹 UI)와 recorded-replay 테스트 방식 둘 다 내부 설계 스펙은 있지만 구현 계획은 아직 없어요.
- 크로스커팅 미들웨어/옵저버빌리티(모든 `Step`을 공통 관심사로 감싸는 방법)와, 향후 배포를 위한 패키지/모노레포 구조는 아예 설계조차 시작하지 않았어요.

## 한눈에 보기

| 레이어 | 상태 |
|---|---|
| `tool` / `agent` / `workflow` / `team` / registry 타입 표면 | ✅ 완료, `master`에 있음 |
| 컨트롤 루프 / 이벤트 로그 / 리플레이 / 재개 | 🚧 설계 완료, 미구현 |
| Schema-Aligned Parsing (실제 검증) | 🚧 설계 완료, 미구현 |
| 병렬 에이전트, 중첩 팀, 타입이 붙은 에러 채널 | 🔭 아직 설계 전 |
| `loopy dev` (옵저버빌리티 UI), recorded-replay 테스트 | 🔭 스펙 작성 완료, 구현 계획 없음 |
| 배포된 npm 패키지 | ❌ 미배포 — 레포를 클론하세요 ([빠른 시작](/ko/getting-started/) 참고) |

## 직접 타입 표면 검증해보기

```bash
tsc -p tsconfig.json          # 메인테이너 게이트: src/만, isolatedDeclarations ON
tsc -p tsconfig.examples.json # 소비자 빌드: 추론된 .d.ts를 dist-examples/로 출력
tsc -p tsconfig.negative.json # 실패해야 하는 픽스처: 기대하는 진단을 캡처
```

각 명령이 정확히 무엇을 검사하는지는 [빠른 시작](/ko/getting-started/)에서 확인하세요.
