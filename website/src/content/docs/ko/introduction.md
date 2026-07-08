---
title: 소개
description: loopy는 LLM 에이전트, 툴, 워크플로우, 멀티 에이전트 팀을 위한 타입 세이프 TypeScript DSL이에요.
---

loopy는 LLM 애플리케이션을 만들기 위한 타입 세이프 TypeScript DSL이에요. React가 UI를 컴포넌트 하나로 정리했듯, loopy는 툴, 에이전트, 워크플로우, 멀티 에이전트 팀을 `Step` 하나로 정리해요. 그래서 "React for agents"예요. 모든 단계를 코드가 결정하는 워크플로우부터 모델이 스스로 판단하는 에이전트까지, 전부 하나의 컴파일 검증 모델 안에서 다룰 수 있어요.

## 왜 loopy인가요?

에이전트 루프를 직접 만들어 본 팀이라면 익숙한 문제들이 있어요.

- 툴을 문자열 이름으로 참조해서, 오타가 런타임에야 드러나요. 운이 나쁘면 영영 모르고 지나가요.
- 모델 출력을 정규식과 `JSON.parse`로 파싱하다가, 실패가 조용히 묻혀요.
- 상태가 타입 없는 컨텍스트 객체에 쌓여서, 어떤 필드가 들어 있는지 아무도 확신하지 못해요.
- 실패한 실행을 다시 돌려볼 방법이 없어서, 디버깅할 때마다 LLM 비용을 새로 내요.

loopy는 이 문제들을 전부 컴파일 타임 계약으로 바꿔요. 툴은 이름이 아니라 값으로 가져와요. 스키마는 입력뿐 아니라 출력까지 검증해요. 상태는 타입이 지정된 채널로 관리해요. 그리고 모든 실행이 이벤트 로그로 남아서, 같은 로그를 다시 재생하면 실행이 그대로 재현돼요. 이때 LLM 호출은 한 번도 일어나지 않아요.

## 한눈에 보기

```ts
import { agent, tool, io, team, inputChannel, lastChannel, END, defineLoopy } from "@loopyjs/core";

// 툴은 자기한테 필요한 의존성만 선언해요.
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

// 에이전트는 모델 루프를 가진 Step이에요. passTo에 핸드오프 대상을 적어요.
const bugFixer = agent({
  name: "bugFixer", model: "claude-opus",
  instructions: "Fix the bug, then hand to the reviewer.",
  input: io<{ issue: Issue }>(), output: io<{ done: boolean }>(),
  tools: [editFile], deps: ["repo"], passTo: ["reviewer"],
});

// 팀은 공유 상태 위에서 도는 멀티 에이전트 루프예요. 매 턴 라우터가
// 다음 에이전트를 하나 고르고, passTo 대상은 컴파일 타임에 검사돼요.
const prTriage = team({
  name: "prTriage",
  entry: "triage",
  state: {
    issue:  inputChannel<Issue>(),                     // 실행 시점에 넣는 입력
    review: lastChannel<ReviewResult | null>(null),    // 도메인 채널
    // transcript와 nextAgent는 팀이 알아서 채워줘요
  },
  agents: { triage, bugFixer, docsWriter, reviewer },
  maxTurns: 20,
})
  .writes({ reviewer: "review" })          // 에이전트 출력 → 상태 채널 (타입 호환 검사)
  .router((s) => {                         // 라우팅 규칙 — 없는 키를 쓰면 컴파일 에러
    if (s.nextAgent) return s.nextAgent;   // 핸드오프 요청이 있으면 먼저 따라가요
    if (s.review?.approved) return END;    // 유니온이 좁혀져서 ! 없이 안전해요
    if (s.review) return s.review.assignee;
    return END;
  });

// 레지스트리가 모든 의존성이 채워졌는지 검사한 뒤 rt.run의 타입을 만들어요.
const rt = defineLoopy({ agents: {}, workflows: {}, teams: { prTriage }, deps: { repo } });
const out: ReviewResult | null = await rt.run("prTriage", { issue });
```

*(`triage`, `docsWriter`, `reviewer`, `Issue`, `ReviewResult`는 지면상 생략했어요. 전체 코드는 [팀 모델 깊이 보기](/ko/team-model/)에서 볼 수 있어요.)*

## 특징

- 🧩 **기본 단위는 하나.** 툴, 에이전트, 워크플로우 노드, 팀 멤버가 전부 `Step`이에요. 한 번 배우면 어디서든 조합할 수 있어요.
- 🔒 **끝까지 타입 안전.** 입력, 출력, 의존성, 핸드오프 대상까지 컴파일 타임에 검사해요.
- 🧬 **함수형 의존성 주입.** 데코레이터도 전역 상태도 없어요. 필요한 의존성만 선언하면, 빠진 건 레지스트리가 컴파일 에러로 알려줘요.
- 📼 **이벤트 소싱 코어.** 모든 턴과 툴 호출이 이벤트로 기록돼요. 어떤 실행이든 LLM 호출 없이 그대로 재현할 수 있어요.
- 🤝 **멀티 에이전트 팀.** 타입이 지정된 공유 상태 위에서 라우터가 다음 에이전트를 정해요. 대화 기록(트랜스크립트)은 팀이 알아서 관리해요.
- ⏸️ **휴먼 인 더 루프 내장.** 실행을 멈추고(interrupt) 사람이 확인한 뒤 이어가는(resume) 흐름이 v1 설계에 처음부터 들어 있어요.
- 🧾 **스키마는 자유롭게.** Zod, Valibot, ArkType 등 [Standard Schema](https://standardschema.dev/) 형태라면 무엇이든 그대로 쓸 수 있어요.
- 📦 **컨벤션 레이어.** 정해진 폴더 구조, 값으로 가져오는 툴, 진입점만 등록하는 레지스트리까지. 프로젝트 구조를 고민할 필요가 없어요.

## 다음 단계

- [빠른 시작](/ko/getting-started/) — `@loopyjs/core`를 설치하고 첫 프로그램을 실행해 보세요.
- [Step 구조](/ko/core-concepts/step/) — 모든 것의 기본 단위인 `Step`을 알아보세요.
- [현황과 로드맵](/ko/status-roadmap/) — 무엇이 완성됐고 무엇이 남았는지 정리되어 있어요.
