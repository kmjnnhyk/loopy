---
title: 빠른 시작
description: loopy를 클론하고 타입 표면을 탐험해 보세요 — 아직 npm 패키지는 없어요.
banner:
  content: |
    loopy는 프로토타입이에요 — 타입 표면은 완성되어 컴파일 검증까지 마쳤지만, 런타임은 아직 구현 전이에요. <a href="/ko/status-roadmap/">현황과 로드맵</a>을 확인하세요.
---

## 지금의 loopy

loopy는 **설계 / 프로토타입 단계**예요. 레포지토리는 완전히 타입 검증된 **타입 표면**이에요. `src/index.ts`가 실제로 타입 검사되는 팩토리들(`tool`, `agent`, `workflow`, `defineLoopy`, `loopy`, 채널 생성자)을 내보내지만, 런타임 본문은 전부 의도적인 스텁이에요. 컨트롤 루프도, 이벤트 소싱 리플레이도, 휴먼 인 더 루프 실행도 아직 없어요 — **오늘은 loopy 프로그램을 실행할 수 없어요.**

대신 *할 수 있는 것*이 있어요. 실제로 타입 검사되는 에이전트·툴·워크플로우 정의를 작성하고, TypeScript가 건네주는 API의 정확한 형태를 미리 볼 수 있어요 — 이를 실행할 런타임보다 먼저요.

이건 의도된 순서예요. 설계를 순수한 타입 레벨 계약으로 먼저 검증했어요 — 컴파일 어서션, 직접 읽어본 `.d.ts` 출력, 실패해야만 하는 픽스처들로요. 런타임 코드는 그다음이에요. 무엇이 끝났고 무엇이 남았는지는 [현황과 로드맵](/ko/status-roadmap/)에서 확인하세요.

## 레포지토리 클론하기

loopy는 아직 npm에 배포되지 않아서 `npm install loopy`가 없어요. 직접 클론하세요.

```bash
git clone https://github.com/kmjnnhyk/loopy.git
cd loopy
npm install    # 또는 bun install — 레포에 bun.lock이 들어 있어요
```

## 타입 표면 탐험하기

테스트 러너는 없어요. "테스트"는 TypeScript 컴파일 검사이고, 각각 계약의 다른 조각을 증명하는 세 개의 `tsconfig` 파일로 나뉘어 있어요.

```bash
tsc -p tsconfig.json          # 메인테이너 게이트: src/만, isolatedDeclarations ON
tsc -p tsconfig.examples.json # 소비자 빌드: 추론된 .d.ts를 dist-examples/로 출력
tsc -p tsconfig.negative.json # 실패해야 하는 픽스처: 기대하는 진단을 캡처
```

- **`tsconfig.json`** 은 [`isolatedDeclarations`](https://www.typescriptlang.org/tsconfig/#isolatedDeclarations)를 켠 채 `src/index.ts`만 컴파일해요. 내보내는 모든 팩토리가 명시적 반환 타입을 가져야 해서, 출력되는 `.d.ts`가 패키지 경계를 넘어도 이름이 유지되고 호버가 깔끔해요.
- **`tsconfig.examples.json`** 은 `examples/*.ts` — 현실적인 소비자 표면(툴 10개, 에이전트 5개, 워크플로우 2개, 의존성 7개짜리 레지스트리) — 을 실제 앱이 빌드하는 방식으로 컴파일해요. 소비자가 실제로 돌려받는 *추론된* 타입을 여기서 볼 수 있어요.
- **`tsconfig.negative.json`** 은 *실패해야만 하는* 픽스처인 `examples/_negative.ts`를 컴파일해요. 오타 난 엣지 이름, 빠진 의존성 같은 것들이요. 각 실패는 구체적으로 이름 붙은 진단(`TS2820`, `TS2741`, ...)이에요 — 타입 기계가 실수를 `any`가 아니라 실행 가능한 메시지로 잡아낸다는 증거예요.

[`examples/tools.ts`](https://github.com/kmjnnhyk/loopy/blob/master/examples/tools.ts), [`examples/agents.ts`](https://github.com/kmjnnhyk/loopy/blob/master/examples/agents.ts), [`examples/workflows.ts`](https://github.com/kmjnnhyk/loopy/blob/master/examples/workflows.ts)부터 읽어 보세요 — 이 사이트를 포함한 어떤 산문보다 정확한, 레포에서 가장 최신의 사용 레퍼런스예요.

## 다음 단계

- API가 처음이라면 [핵심 개념 → Step 구조](/ko/core-concepts/step/)부터 시작하세요 — 모든 원시 타입이 하나의 형태로 환원돼요.
- 실전 경로를 원한다면 [가이드](/ko/guides/tools/)로 건너뛰어 툴 → 에이전트 → 워크플로우 → 팀 순서로 따라가 보세요.
- "타입 표면만 있다"는 게 실제로 무슨 뜻인지 궁금하다면 [현황과 로드맵](/ko/status-roadmap/)이 그 경계를 정확히 그어줘요.
