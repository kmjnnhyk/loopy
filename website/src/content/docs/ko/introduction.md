---
title: 소개
description: loopy는 LLM 에이전트, 툴, 워크플로우, 멀티 에이전트 팀을 위한 타입 세이프 TypeScript DSL이에요 — React for agents.
banner:
  content: |
    loopy는 프로토타입이에요 — 타입 표면은 완성되어 컴파일 검증까지 마쳤지만, 런타임은 아직 구현 전이에요. <a href="/ko/status-roadmap/">현황과 로드맵</a>을 확인하세요.
---

loopy는 LLM 애플리케이션을 만들기 위한 타입 세이프 TypeScript DSL이에요 — **"React for agents"**. 툴, 에이전트, 결정적 워크플로우, 멀티 에이전트 팀이 전부 하나의 원시 타입 `Step`으로 환원되기 때문에, "내가 모든 단계를 결정"하는 쪽부터 "모델이 결정"하는 쪽까지 전체 스펙트럼이 하나의 컴파일 검증 모델 안에 들어와요.

## 왜 loopy인가요?

손으로 짠 에이전트 루프는 대부분 같은 방식으로 무너져요.

- 툴 이름이 문자열이라 오타가 런타임에야 드러나요 — 혹은 영영 안 드러나요.
- 모델 출력을 정규식 + `JSON.parse`로 파싱하다 실패가 조용히 지나가요.
- 상태가 아무도 타입을 못 붙이는 가변 컨텍스트 가방에 들어 있어요.
- 실패한 실행을 다시 재현할 수 없어서, 디버깅이 곧 LLM 호출 비용이에요.

loopy는 이 각각을 컴파일 타임 계약으로 바꿔요. 툴은 이름이 아니라 값으로 참조해요. 스키마는 입력뿐 아니라 *출력*까지 타입을 붙여요. 상태는 타입이 붙은 채널의 집합이에요. 그리고 모든 실행이 이벤트 로그라서, 리플레이는 순수한 fold — 결정적이고 공짜예요.

## 한눈에 보는 loopy

```ts
import { agent, tool, io, team, inputChannel, lastChannel, END, defineLoopy } from "loopy";

// 툴은 자기가 필요한 의존성 조각만 선언해요.
const editFile = tool({
  name: "editFile",
  description: "Apply an edit to a file.",
  input: io<{ path: string; patch: string }>(),
  output: io<{ applied: boolean }>(),
  deps: ["repo"],
  run: async (i, { deps }) => {
    await deps.repo.write(i.path, i.patch);
    return { applied: true };
  },
});

// 에이전트는 모델 루프를 소유해요. `passTo`가 핸드오프 대상을 이름으로 잡아둬요.
const bugFixer = agent({
  name: "bugFixer", model: "claude-opus",
  instructions: "Fix the bug, then hand to the reviewer.",
  input: io<{ issue: Issue }>(), output: io<{ done: boolean }>(),
  tools: [editFile], deps: ["repo"], passTo: ["reviewer"],
});

// 팀은 공유 상태 위의 멀티 에이전트 루프예요 — 매 턴 라우터가 다음 에이전트
// 하나를 골라요. `passTo` 대상은 컴파일 타임에 멤버십 검사돼요.
const prTriage = team({
  name: "prTriage",
  entry: "triage",
  state: {
    issue:  inputChannel<Issue>(),                     // 실행 입력, run 시점에 제공
    review: lastChannel<ReviewResult | null>(null),    // 도메인 채널
    // `transcript` + `nextAgent`는 팀이 자동으로 주입해요
  },
  agents: { triage, bugFixer, docsWriter, reviewer },
  maxTurns: 20,
})
  .writes({ reviewer: "review" })          // 에이전트 출력 → 상태 채널 (output ⊑ channel, 검사됨)
  .router((s) => {                         // 제어 규칙 — 잘못된 키는 컴파일 에러
    if (s.nextAgent) return s.nextAgent;   // 핸드오프 요청을 먼저 따라가요
    if (s.review?.approved) return END;    // 판별 유니온이 좁혀져요 — `!`가 필요 없어요
    if (s.review) return s.review.assignee;
    return END;
  });

// 레지스트리가 선언된 모든 의존성이 채워졌는지 증명한 뒤 rt.run에 타입을 붙여요.
const rt = defineLoopy({ agents: {}, workflows: {}, teams: { prTriage }, deps: { repo } });
const out: ReviewResult | null = await rt.run("prTriage", { issue });
```

*(`triage`, `docsWriter`, `reviewer`, `Issue`, `ReviewResult`는 지면상 생략했어요 — 전체 버전은 [팀 모델 깊이 보기](/ko/team-model/)에서 볼 수 있어요.)*

## 특징

- 🧩 **하나의 원시 타입.** 툴, 에이전트, 워크플로우 노드, 팀 멤버가 전부 `Step`이에요 — 형태 하나만 배우면 모든 게 조합돼요.
- 🔒 **끝까지 타입 세이프.** 입력, 출력, 의존성, 핸드오프 대상이 전부 컴파일 타임에 추론되고 검사돼요.
- 🧬 **함수형 의존성 주입.** 데코레이터도 전역 상태도 없어요 — 각 유닛이 의존성 조각을 선언하면 레지스트리가 공급을 증명해요.
- 📼 **이벤트 소싱 코어.** 모든 턴과 툴 호출이 이벤트로 기록돼요. 리플레이는 결정적이고 LLM 호출이 필요 없어요.
- 🤝 **멀티 에이전트 팀.** 타입이 붙은 공유 상태 위의 라우터 — 컴파일 검증되는 핸드오프와 자동 관리되는 트랜스크립트까지.
- ⏸️ **휴먼 인 더 루프가 일급.** interrupt와 resume이 v1 설계에 처음부터 들어 있어요. 나중에 덧붙인 게 아니에요.
- 🧾 **벤더 중립 스키마.** Zod, Valibot, ArkType이 [Standard Schema](https://standardschema.dev/) 형태의 캐리어를 그대로 통과해요.
- 📦 **컨벤션 레이어.** 정해진 폴더 구조, 값으로 임포트하는 툴, 진입점만 나열하는 레지스트리 — LangChain이 표준화하지 못한 구조를 제공해요.

## 다음 단계

- [빠른 시작](/ko/getting-started/) — 레포를 클론하고 `tsc`로 타입 표면을 탐험해 보세요.
- [Step 구조](/ko/core-concepts/step/) — 모든 원시 타입이 환원되는 단 하나의 형태예요.
- [현황과 로드맵](/ko/status-roadmap/) — 무엇이 끝났고 무엇이 남았는지 정확히 알 수 있어요.
