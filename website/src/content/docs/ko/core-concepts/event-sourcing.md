---
title: 이벤트 소싱과 리플레이
description: loopy의 상태 모델은 state = fold(reducer, log)라는 불변식 하나를 중심으로 설계됐어요. 이 페이지는 그 런타임 설계를 설명하는 것으로, 엔진 자체는 아직 구현되지 않았어요.
---

:::caution
이 페이지의 모든 내용은 **런타임 설계**를 설명해요. 오늘 당장 실행할 수 있는 건 아니에요. `src/index.ts`는 [채널](/ko/core-concepts/channels-and-state/)과 [Step](/ko/core-concepts/step/)의 *타입* 메커니즘만 구현하고 있어요. 아래에서 설명하는 컨트롤 루프, 이벤트 로그, 리플레이 엔진은 다음 마일스톤이에요. 자세한 건 [현황과 로드맵](/ko/status-roadmap/)을 참고하세요.
:::

## 불변식 하나

이 설계는 규칙 하나에 전부를 걸어요: **`state = fold(reduce, log, initial)`**. 이벤트 로그, 즉 실행 중 일어난 모든 일을 담은 추가 전용 기록이 유일한 진실의 원천이에요. 실행 중인 프로세스가 들고 있는 "실시간" 상태가 무엇이든, 그건 이 로그를 각 채널의 리듀서로 접어 넣은 결과를 캐시해 둔 것일 뿐이에요. 체크포인트 스냅샷은 로그보다 뒤처질 수는 있지만 로그와 절대 *어긋날* 수 없는 가속 구조예요. 언제든 다시 접어서(re-fold) 복구할 수 있으니까요.

이 규칙 하나만 있으면, 보통은 서로 다른 기능으로 취급하는 것들이 사실은 같은 연산을 다른 경계 조건에서 실행한 것뿐이라는 사실이 드러나요:

- **리플레이** — 로그 전체를 처음부터 접어요. LLM 호출은 전혀 없어요(모든 모델/툴 호출이 이미 기록돼 있어서, 모든 단계가 캐시 히트예요).
- **재개(Resume)** — 마지막 체크포인트까지 로그를 접은 뒤, 거기서부터 실시간으로 이어가요.
- **타임 트래블 디버깅** — 임의의 이전 시점까지 로그를 접어서 그 시점의 상태를 들여다봐요.
- **결정적 회귀 테스트** — 로그를 테스트 스위트에 커밋해요. 나중에 그걸 리플레이하는 것 자체가 테스트예요 — 목(mock)도 실제 LLM 호출도 전혀 없이요.

## 이펙트는 즉시 실행되지 않고, 요청돼요

fold가 순수하고 리플레이 가능한 상태로 남으려면, 전이(transition)가 `fetch`나 SDK, `Date.now()`, `Math.random()`을 직접 호출하면 안 돼요. 이 중 무엇이든 호출하는 순간 리플레이가 결정적이지 않게 돼요. 그래서 이펙트는 항상 실행 컨텍스트(`ctx`)를 거쳐요. `ctx.callModel(...)`, `ctx.callTool(...)`, `ctx.interrupt(...)`처럼요. 모든 이펙트는 짝을 이루는 이벤트 쌍으로 기록돼요. I/O가 일어나기 *전에* 쓰이는 `*Requested` 이벤트와, 일어난 *후에* 쓰이는 `*Returned` 이벤트예요. 그 덕분에 이펙트 도중 크래시가 나도 복구할 수 있어요. 재시작했을 때 짝이 없는 `*Requested`가 있다면 "이건 끝나지 않았다"는 뜻이니, 그 이펙트를 안전하게 다시 실행하면 돼요. 툴의 [`idempotencyKey`](/ko/reference/tool/) 계약이 나온 것도 이 때문이에요. 다시 실행된 이펙트는 두 번 실행해도 안전해야 하거든요.

## 클로저가 아니라 *위치*를 정지시켜요

JavaScript는 일시 정지된 `async` 함수의 continuation을 직렬화할 수 없어요. 그래서 loopy는 그걸 아예 시도하지 않아요. 함수를 저장하는 대신 순수한 데이터 세 가지, **어느 노드에 있는지, 현재 채널 값들, 대기 중인 이펙트**를 저장해요. 재개한다는 건 그 상태를 들고 그 노드에서 그래프에 다시 들어간다는 뜻이지, 얼어붙은 콜 스택을 "깨우는" 게 아니에요. 이걸 가능하게 하는 원시 동작이 `ctx.interrupt(payload)`예요. 호출하면 실행이 정지돼요. 나중에, 완전히 다른 프로세스에서 며칠 뒤일 수도 있는 시점에 `runtime.resume(threadId, value)`를 호출하면 로그를 다시 접어서(이미 끝난 앞부분은 LLM 호출 없이) interrupt가 일어났던 바로 그 지점부터 이어가요. [휴먼 인 더 루프](/ko/guides/human-in-the-loop/)는 전부 이 원시 동작 하나 위에 지어졌어요.

## 예시로 보기 (설계 스케치)

빌드에 한 번 실패하고 재시도에서 성공한 뒤, 사람의 승인을 기다리며 멈췄다가 며칠 뒤 재개되는 실행이에요. 설계 문서에 있는 예시 이벤트 로그를 압축해 옮겼어요:

```jsonc
{seq:2, t:"ToolCalled", tool:"runBuild"}   {seq:3, t:"ToolReturned", ok:false, value:{log:"TS2322…"}}
{seq:7, t:"ToolCalled", tool:"runBuild"}   {seq:8, t:"ToolReturned", ok:true,  value:{log:"OK"}}
{seq:10, t:"InterruptRaised", payload:{diff:"…"}, resumeKey:"th_1:10"}
// ── process exits; nothing held in memory ──
// days later: runtime.resume("th_1", {approved:true})
{seq:11, t:"Resumed", value:{approved:true}}
{seq:14, t:"ToolCalled", tool:"openPR"}    {seq:15, t:"ToolReturned", value:"…/pull/42"}
{seq:16, t:"RunEnded", output:{pr:"…/pull/42"}}
```

재개할 때 시퀀스 0~10은 캐시 히트로만 리플레이돼요. `runBuild`는 세 번째로 호출되지 않아요. 아직 일어나지 않았던 `openPR`만 실제 I/O를 수행해요. 커밋된 이 로그는 사람의 승인까지 포함해서 전체 실행을 검증하는 결정적 회귀 테스트 역할도 겸해요.

## 다음 단계

- [휴먼 인 더 루프](/ko/guides/human-in-the-loop/) — 이 설계가 떠받치기 위해 존재하는 단 하나의 원시 동작, `ctx.interrupt`예요.
- [현황과 로드맵](/ko/status-roadmap/) — 오늘 구현된 것과 나중을 위해 설계된 것을 구분해서 보여줘요.
