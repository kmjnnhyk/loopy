---
title: 현황과 로드맵
description: 오늘 실제로 구현된 것, 설계는 됐지만 아직 안 만들어진 것, 아직 설계조차 안 된 것을 있는 그대로 정리했어요.
---

loopy는 **타입 표면 우선**으로 만들어졌어요: 런타임 코드를 한 줄도 쓰기 전에 컴파일 타임 계약부터 확정하고 증명했어요. 그 계약 위에서 런타임, 테스트 하네스, DevTools가 그 뒤로 실제로 나왔고요. 이 페이지는 그 경계를 정확히 그어서, 이 사이트의 어떤 페이지도 지금 실제로 할 수 있는 것보다 과장해서 말하지 않도록 해요.

## 오늘 작동하는 것

**타입 표면** — `tool()`, `agent()`, `workflow()`, `team()`, 채널(`lastChannel`, `listChannel`, `inputChannel`), 레지스트리(`defineLoopy`, `loopy().provide(...)`)는 전부 실제로 동작하고 익스포트되며 타입 검증까지 마친 팩토리이고, npm에 배포돼 있어요. [핵심 개념](/ko/core-concepts/step/)과 [API 레퍼런스](/ko/reference/) 페이지의 모든 주장은 다음으로 증명돼요:

- **컴파일 어서션** (`examples/consumer.ts`, `examples/team-consumer.ts`) — `Expect<Equal<...>>`로 특정 추론 타입이 정확히 맞는지 검사해요 (예: 의존성 유니온이 `"repo"`로 유지되고 앱의 모든 의존성으로 넓어지지 않는지, 또는 `team()`의 `passTo` 멤버십 가드가 엉뚱한 핸드오프 대상을 실제로 거부하는지).
- **실패해야 하는 픽스처** (`examples/_negative.ts`) — 빌드를 *반드시* 실패시켜야 하는 실수들을 별도로 컴파일해서, 정확한 진단(`TS2820`, `TS2741`, ...)까지 고정해둬요. `team()` 부분만 해도 이런 픽스처가 다섯 개예요.
- **직접 읽어본 `.d.ts` 출력** (`isolatedDeclarations: true` 상태) — 소스코드뿐 아니라 패키지 경계 자체를 직접 검사했어요.

`team()`은 특히 자체 완료 게이트를 통과했어요. 긍정 케이스 7개, 부정 케이스 5개짜리 컴파일 어서션과 10-에이전트 스케일 체크까지 다 거친 뒤에야 머지됐죠.

**런타임은 실제로 동작해요, 스텁이 아니에요.** `defineLoopy(...)`가 만든 런타임의 `run(name, input)`은 `workflow()`나 `team()` 그래프를 턴 단위로 실제로 실행하면서, 모델을 호출하고, 툴을 실행하고, 모든 걸 추가 전용 이벤트 로그(`state = fold(reducer, log)`)에 영속화해요. 구체적으로, 테스트 스위트로 검증되고 실제로 나온 것들이에요:

- 새 실행, 리플레이, 재개가 모두 하나의 코드 경로를 거치는 커널 + 에이전트 / 워크플로우 / 팀 드라이버.
- 추가 전용 이벤트 로그, 체크포인터, 리플레이 엔진(`verifyReplay`) — 기록된 스레드를 리플레이하면 **LLM 호출이 0번** 일어나요. 이펙트는 로그에서 그대로 메모이즈돼요.
- `ctx.interrupt(...)` / `runtime.resume(threadId, value)`가 실제로 실행을 서스펜드하고 재개해요 — [휴먼 인 더 루프](/ko/guides/human-in-the-loop/) 참고.
- 인메모리 스토어와 SQLite 스토어(`@loopyjs/core/sqlite`).
- 모델 클라이언트 — 내장 스텁과 실제 Anthropic 어댑터(`@loopyjs/anthropic`).
- 구조화 출력을 위한 Schema-Aligned Parsing — 에이전트 드라이버가 모델의 원본 텍스트(코드 펜스, 잡다한 서술)에서 JSON을 강건하게 추출한 뒤에야 스키마의 `validate`로 넘겨요.

## 나온 것: 테스트와 DevTools

- **기록→재생 테스트** (`@loopyjs/test`) — `defineLoopyTest(runtime, { dir })`가 `t.replay(name, input)`을 줘요. 첫 실행은 골든 로그를 기록하고, 이후 모든 실행은 모델 호출 없이 그걸 리플레이하면서 첫 번째로 어긋난 지점을 알려줘요. CLI: `loopy test`(리플레이), `loopy test -u`(다시 기록).
- **`loopy dev`** — 로컬·오프라인·읽기 전용 DevTools 웹 UI(`@loopyjs/devtools` + CLI)예요. 앱을 같은 프로세스에서 로드해서 런타임의 이벤트 스트림을 구독하고, 타임라인 / 그래프 / 스텝 상세 뷰를 스크럽 슬라이더로 시간 여행하며 볼 수 있게 서빙해요. 자세한 내용은 [DevTools (loopy dev)](/ko/guides/devtools/)를 참고하세요.

## npm에 배포됨

모든 패키지가 `next` dist-tag(동시에 `latest`)로 `0.1.0`에 배포돼 있어요: `@loopyjs/core`, `@loopyjs/anthropic`, `@loopyjs/test`, `@loopyjs/cli`, `@loopyjs/devtools`. 설치 방법은 [빠른 시작](/ko/getting-started/)을 참고하세요. API는 아직 1.0 이전이라 `1.0.0` 릴리스 전에 더 바뀔 수 있어요.

## 아직 설계조차 안 된 것

- 병렬 / 동시 실행 에이전트 (지금은 팀 턴마다 정확히 에이전트 하나만 실행돼요).
- 중첩 팀 (다른 team이나 workflow 안의 노드로 쓰이는 team).
- 타입이 지정된 에러 채널 (예외를 던지는 방식과는 별개로, 실패만을 위한 전용 타입 경로).
- 크로스커팅 미들웨어/옵저버빌리티 — 모든 `Step`을 공통 관심사로 감싸는 방법 — 은 아직 설계조차 시작하지 않았어요.
- DevTools v2 — UI에서 리플레이/재개, 전체 채널 diff, 엣지 클릭 페이로드, 프로덕션 관찰까지. 오늘의 DevTools(v1)는 로컬·오프라인·읽기 전용 관찰만 지원해요.

## 한눈에 보기

| 레이어 | 상태 |
|---|---|
| `tool` / `agent` / `workflow` / `team` / registry 타입 표면 | ✅ 나옴 |
| 런타임 — 커널, 이벤트 로그, 리플레이, 재개, 모델 드라이버 | ✅ 나옴 |
| 기록→재생 테스트 (`@loopyjs/test`, `loopy test`) | ✅ 나옴 |
| DevTools (`loopy dev`) — 타임라인 / 그래프 / 상세, v1 읽기 전용 | ✅ 나옴 |
| 배포된 npm 패키지 (`@loopyjs/*@next`) | ✅ 나옴 — [빠른 시작](/ko/getting-started/) 참고 |
| 병렬 에이전트, 중첩 팀, 타입이 지정된 에러 채널 | 🔭 아직 설계 전 |
| 크로스커팅 미들웨어/옵저버빌리티 | 🔭 아직 설계 전 |
| DevTools v2 (UI 리플레이/재개, 프로덕션 관찰) | 🔭 아직 미구현 |

## 직접 타입 표면 검증해보기

```bash
tsc -p tsconfig.json          # 메인테이너 게이트: src만, isolatedDeclarations ON
tsc -p tsconfig.examples.json # 소비자 빌드: 추론된 .d.ts를 dist-examples/로 출력
tsc -p tsconfig.negative.json # 실패해야 하는 픽스처: 기대하는 진단을 캡처
```

각 명령이 정확히 무엇을 검사하는지는 [빠른 시작](/ko/getting-started/)에서 확인하세요.
