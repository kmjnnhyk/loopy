---
title: 빠른 시작
description: loopy를 클론하고 타입 설계를 직접 확인해 보세요. 아직 npm 패키지는 없어요.
banner:
  content: |
    loopy는 아직 프로토타입이에요. 타입 설계는 완성되어 컴파일로 검증을 마쳤지만, 런타임은 구현 전이에요. <a href="/ko/status-roadmap/">현황과 로드맵</a>에서 자세히 확인할 수 있어요.
---

## 지금 loopy로 할 수 있는 것

loopy는 **설계·프로토타입 단계**예요. 레포지토리에는 완전히 타입 검증을 마친 API 설계, 즉 타입 표면(type surface)이 들어 있어요. `src/index.ts`가 `tool`, `agent`, `workflow`, `defineLoopy`, `loopy`, 채널 생성자 같은 팩토리를 실제로 내보내지만, 런타임 구현부는 전부 의도적으로 비워 뒀어요. 컨트롤 루프도, 이벤트 리플레이도, 휴먼 인 더 루프 실행도 아직 없어요. 그러니까 **loopy 프로그램을 실행하는 건 아직 불가능해요.**

대신 할 수 있는 게 있어요. 타입 검사가 실제로 동작하는 에이전트·툴·워크플로우 정의를 작성해 보고, TypeScript가 어떤 타입을 추론해 주는지 미리 확인할 수 있어요. 런타임보다 API의 모양을 먼저 확정하고 검증하는 게 loopy의 개발 순서예요. 컴파일 검증, 직접 확인한 `.d.ts` 출력, 그리고 반드시 실패해야 하는 테스트 케이스로 설계를 먼저 굳힌 다음에 런타임을 만들어요. 어디까지 완성됐는지는 [현황과 로드맵](/ko/status-roadmap/)에서 확인하세요.

## 레포지토리 클론하기

loopy는 아직 npm에 배포되지 않았어요. `npm install loopy`는 동작하지 않으니, 레포를 직접 클론하세요.

```bash
git clone https://github.com/kmjnnhyk/loopy.git
cd loopy
npm install    # 또는 bun install — 레포에 bun.lock이 있어요
```

## 타입 설계 확인하기

테스트 러너는 따로 없어요. 이 프로젝트의 "테스트"는 TypeScript 컴파일 검사예요. 세 개의 `tsconfig`가 각각 다른 것을 증명해요.

```bash
tsc -p tsconfig.json          # 메인테이너 게이트: src/만, isolatedDeclarations 켜짐
tsc -p tsconfig.examples.json # 소비자 빌드: 추론된 .d.ts를 dist-examples/로 출력
tsc -p tsconfig.negative.json # 반드시 실패해야 하는 케이스: 기대하는 에러를 고정
```

- **`tsconfig.json`** — [`isolatedDeclarations`](https://www.typescriptlang.org/tsconfig/#isolatedDeclarations)를 켠 채 `src/index.ts`만 컴파일해요. 내보내는 모든 팩토리에 명시적 반환 타입을 강제해서, 패키지 밖에서도 `.d.ts`의 타입 이름이 유지되고 에디터 호버가 깔끔하게 나오도록 지켜요.
- **`tsconfig.examples.json`** — 실제 앱이 빌드하는 방식 그대로 `examples/*.ts`를 컴파일해요. 예제는 현실적인 규모예요: 툴 10개, 에이전트 5개, 워크플로우 2개, 의존성 7개짜리 레지스트리. 사용자가 실제로 받게 되는 추론 타입을 여기서 볼 수 있어요.
- **`tsconfig.negative.json`** — 일부러 틀리게 만든 코드(`examples/_negative.ts`)를 컴파일해요. 엣지 이름 오타, 빠진 의존성 같은 실수가 각각 정확히 어떤 에러(`TS2820`, `TS2741`, ...)로 잡히는지 고정해 둬요. 실수가 `any`로 뭉개지지 않고 의미 있는 메시지로 잡힌다는 증거예요.

코드를 읽기 시작한다면 [`examples/tools.ts`](https://github.com/kmjnnhyk/loopy/blob/master/examples/tools.ts), [`examples/agents.ts`](https://github.com/kmjnnhyk/loopy/blob/master/examples/agents.ts), [`examples/workflows.ts`](https://github.com/kmjnnhyk/loopy/blob/master/examples/workflows.ts)부터 보세요. 이 문서 사이트를 포함해 어떤 설명보다도 정확한, 살아 있는 사용 예제예요.

## 다음 단계

- API가 처음이라면 [핵심 개념 → Step 구조](/ko/core-concepts/step/)부터 시작하세요. 모든 것이 `Step` 하나로 통해요.
- 손으로 익히는 쪽이 좋다면 [가이드](/ko/guides/tools/)에서 툴 → 에이전트 → 워크플로우 → 팀 순서로 따라와 보세요.
- "타입 설계만 있다"는 게 어떤 상태인지 궁금하다면 [현황과 로드맵](/ko/status-roadmap/)에 경계가 정확히 그어져 있어요.
