# loopy.js — 세션 핸드오프 (2026-06-29 기준)

다음 세션에서 이 파일 + 아래 두 설계 문서를 읽으면 맥락 손실 없이 이어갈 수 있다.

## 한 줄 정의
**loopy.js** = LLM **에이전트·툴·워크플로우**를 짜는 **타입세이프 내부 TypeScript DSL/프레임워크** (런타임 Node.js on **Bun**, **GitHub 오픈소스 라이브러리로 배포**). 프레이밍: **"에이전트를 위한 React"** — LangChain/LangGraph와 같은 슬롯이되, LangChain에 빠진 **구조 표준화 + end-to-end 타입 추론**을 메우는 것이 존재 이유.

> 페인의 출처는 `~/DEV/bell-agent/apps/api` (`@bell/api` v5, 순수 CommonJS, raw `@anthropic-ai/sdk`): 손코딩 에이전트 루프(히스토리 누락 버그), regex+JSON.parse + silent fail-open, stringly-typed, 가변 `ctx` bag, DB 상태문자열 라이프사이클.
> **bell-agent는 *의도 참조용*일 뿐 — loopy는 완전히 새 설계. 절대 bell-agent 리팩토링 아님.**

## 정체성 / 포지셔닝 (2026-06-30 확정 — 재논의 X)
loopy는 **LangChain/LangGraph 래퍼가 아니다** (둘 다 import 안 함; raw provider SDK 위 런타임 자체 구현). 차용은 *기법*이지 의존이 아님.
- **vs LangChain**: 다른 슬롯. LangChain의 죄 = 루프를 추상화 뒤로 숨김. loopy는 정반대 — 루프 구조를 *명시적·타입드*로 드러냄. 문서로더/리트리버/RAG 배관은 스코프 밖(LOCKED).
- **vs LangGraph**: 상태머신 멘탈 모델(채널/reducer·checkpointer·interrupt·typed router)은 차용("Steal"). 결정적 차이 = LangGraph(파이썬 우선, TS 포트조차)가 못 주는 **end-to-end TS 타입 추론**(= seam 작업이 증명) + **구조 표준화**(규정 폴더·레지스트리·하나의 Step 스파인 = library 아닌 **framework**).
- **가장 깊은 차별점 — 스펙트럼을 타입드 설계 표면으로**: workflow(결정론, 흐름 고정) ↔ agent(autonomous, 매 턴 모델 결정) ↔ **team(하이브리드 = lead/sub-agent 루프)** 을 하나의 타입드 모델로 1급화하고, 둘 사이 선택을 **로컬 API 선택으로 박제**: `.router()`(고정) vs `passTo`(모델 판단). Anthropic "Building Effective Agents"의 workflow-vs-agent 판단 = loopy에선 *컴파일 체크되는 분기 결정*.
- **"에이전트를 위한 React" 정밀 매핑**: tool/agent/workflow/team = 컴포넌트, `state = fold(reducer, log)` ↔ `UI = f(state)`(동일 패러다임 → 타임트래블 공짜), 이벤트로그 타임트래블 dev 웹 = React/Redux DevTools, 규정 폴더·레지스트리 = 프레임워크 컨벤션.
- **붕괴("그냥 타입드 LangGraph") 방지 2규율**: ① 타입 추론이 *스케일*에서 버틸 것(#1 리스크, 계속), ② 루프를 *가독적*으로 유지 — LangChain처럼 숨기지 말 것(이벤트로그·effects-as-data·보이는 think→act→observe 그래프·OSS·dev 웹 관제가 "읽으며 배우는 하네스"를 만듦).
- **정직한 채택 리스크**: 통합(LangChain)·프로덕션 마일리지(LangGraph)로는 안 이김. **타입세이프 + 구조적 명료성 + 숨기지 않는 루프**를 *충분히* 중시하는 TS-우선 청중에서만 통함. bell-agent에 멀티에이전트 수요가 아직 없던 것과 같은 종류의 정직 — 아무도 안 원하는 폭을 짓지 말 것.

## 읽어야 할 산출물
- `docs/design/research-design-space.md` — 리서치 종합(차용 카탈로그, 3개 후보 아키텍처 A/B/C, 추천). LangChain/LangGraph·Spring·Flux/Redux/XState·TS DSL 기법 차용 분석.
- `docs/design/core-state-and-types.md` — **③ State·이벤트로그·영속성 + ④ 타입 기계장치의 spec-ready 설계**. 실제 TS 컴파일(TS 6.0, --strict)로 적대 검증 완료. ★ 가장 중요.
- `docs/design/bell-agent-to-loopy.md` — **bell-agent refactor 브랜치 실측 → loopy 매핑 스케치**. "tool" 3의미 충돌 발견, 페인별 before/after, 경계 스크립트 분석, **§6 = 프로토타입 seam 테스트의 구체 표면(tool 10 + agent 5 + workflow 2 + defineLoopy)**. ★ 프로토타입 입력.
- `loopy-vs-langchain.html` (repo 루트) — bell-agent의 일을 손코딩 vs LangChain vs loopy 3방식 비교 (사용자 학습용).
- 메모리: `~/.claude/projects/-Users-kmjnnhyk-DEV-loopy/memory/loopy-project.md` (이 프로젝트 디렉토리에서 자동 로드됨).

## LOCKED 결정 (사용자 확정)
- 내부 TS DSL only (외부 `.loopy` 언어 X, 사용자 코드 빌드스텝 X). 공개 라이브러리 → `.d.ts` 경계의 public API/타입이 곧 제품.
- **하나의 척추: 모든 것은 `Step<In, Out, Err, Deps>`**. tool/agent/workflow/network가 전부 Step으로 환원.
  - `tool({ name, description, input, output, deps, run })` — LLM이 부르는 함수. input/output은 Standard Schema. **tool엔 model 없음.** deps는 *선언*(registry 키), run 본문에서 역추론 불가.
  - `agent({ name, model, instructions, tools, output, deps })` — 미리 조립된 think→act→observe 루프(히스토리·tool_result·리트라이·파싱 소유). **model은 agent 전용 속성.** agent도 Step → 합성 가능. "model 쓰는 tool"=sub-agent를 tool 자리에 넘김.
  - `workflow({ name, state })` — 명시적 그래프. 노드=값/타입드키, 라우터=State→nextKey(컴파일 체크), 사이클 허용.
  - `team({ name, state, agents })` *(2026-06-30 개명: network→team — AutoGen "Team"/CrewAI "Crew" 선례, "에이전트 팀" 멘탈모델)* — 멀티에이전트(v1 범위). router-over-shared-state 1급, **`passTo` sugar** *(2026-06-30 개명: handoff→passTo — 완전 제어 이양 의미에 맞는 일상어)*. v1 상세 설계 = 진행 중(별도 spec).
  - `defineLoopy({ models, deps, mcp, store, agents, workflows })` — 런타임+중앙 레지스트리(함수형 DI, **데코레이터/reflect-metadata 금지**). **진입점만 나열**(tool은 agent가 값-import). `run("name", input)` 타입드.
- **컨벤션 층 전부 잠김**: 규정 폴더 `src/tools|agents|workflows|networks|deps/` + `loopy.config.ts`. 파일명 `{name}.ts`(`.tool.ts` 접미사는 colocation 시 옵션). 폴더 grouping 허용(네임스페이스 옵션). **tool은 값-import**(`tools:[editFile]`, 이름 문자열 X). 레지스트리 = **(A) 명시적 `defineLoopy` 기본 + (B) 폴더발견 코드젠 `loopy dev --codegen` 옵션**.
- **영속성+HITL v1 1급**: 이벤트소싱(append-only 로그, `state = fold(reducer, log)`) → replay(LLM 재호출 0)·resume·audit. `store`(checkpointer), `ctx.interrupt(payload)`, `runtime.resume(threadId, value)`.
- **State = 타입드 채널 집합**, 각 채널이 reducer 선언(`channel(reducer).initial(x)`).
- **구조화 출력**: 자체 Schema-Aligned Parsing(마크다운/부분/trailing-comma 교정, 타입드 ParseError, silent fail-open 금지). 프로바이더 JSON-mode 단독 불신.
- 스트리밍: 모든 Step이 step 이벤트 자동 방출(플러그형 sink) → 미래 DevTools의 데이터소스.
- 브랜드 ID(ThreadId/RunId/ToolId), Standard Schema(zod/valibot/arktype), tool 출력도 스키마화.
- **MCP**: 소비(`mcp({transport})`, `...jira.tools`, `loopy mcp sync`로 외부 스키마→타입 코드젠) + 공급(`loopy serve --mcp`). MCP 호출=effect→로그 기록→결정적 replay.

## ④ 검증 결과 — 컴파일이 강제한 3개 내부 수정 (사용자 코드엔 안 보임)
1. `AnyTool`/`AnyStep` 상한: `unknown` 반공변으로 진짜 tool 거부 → 스키마 슬롯 `IO<any,any>`. **(+프로토타입 emit 에서 확인: `Step.run` 의 ctx 슬롯도 `any` 여야 — input 만 `any` 로 하고 ctx 를 `unknown` 두면 같은 반공변 함정 재발.)**
2. "sub-agent를 tool로 = 공짜 재귀" 깨짐 → 공유 `Step` 슈퍼타입 필요(=잠근 "모든 건 Step"과 정합).
3. `DepsOf`가 zero-dep 엔트리로 *모든* dep 요구 → `NonNullable` 패턴.
(상세·근거·기타 risky→fixed는 `core-state-and-types.md` §2~§3 참조.)

## 비준 완료 (2026-06-29) — 모두 사용자 확정, 재논의 X
- **(A) `Step` 슈퍼타입 채택** ✅ (Tool·Agent 공통 슈퍼타입 → sub-agent-as-tool 타입레벨 성립). Agent가 구조적으로 tool 표면(input + wrapping run) 보유.
- **(B) workflow 2단계 `.nodes({...}).flow(b => ...)` 기본** ✅ (forward-ref 누수 제거). 선형엔 `.step().edge()` sugar 유지. ← 사용자 코드에 닿는 유일한 변화.
- **추천 기본값 3종 채택** ✅: `isolatedDeclarations: true` 출판 게이트 / 중복 tool명·키 충돌 = 하드 컴파일 에러(`DuplicateNameCheck` + `keyof A & keyof W` 가드) / **tool 멱등성 계약**(크래시 시 at-least-once 재실행 → 멱등 또는 `idempotencyKey`).

## seam = CLOSED ✅ (2026-06-30) — #1 리스크 닫힘
프로토타입 `~/DEV/loopy` (git init, TS **6.0.3**, Bun 1.2.15) 에 실제 패키지 emit (코어 391줄 + examples 444줄):
- `src/index.ts` — 코어 타입머신+팩토리 (컴파일 강제 3수정 적용). `tsconfig.json` (**isolatedDeclarations:true = 라이브러리 게이트**) 통과.
- `examples/` — `deps`(7-dep augment)·`tools`(10)·`agents`(5)·`workflows`(2)·`loopy`(defineLoopy+provide)·`consumer`(seam 단언). §6 표면 그대로. `tsconfig.examples.json` (**isolatedDeclarations OFF = consumer 빌드**) 로 *추론* `.d.ts` emit → 메인 Opus 가 직접 판독.
- `tsconfig.negative.json` + `examples/_negative.ts` — must-error 픽스처 (positive 빌드는 exclude).

**seam 6/6 통과** (전부 메인이 `.d.ts`/hover 직접 판독, subagent 클레임 無):
- **pos① `ToolDepKeys<codeGen.tools>="repo"` 이름 보존** ✓ — `agents.d.ts` 의 codeGen Deps 파라미터 = `"repo"` (anonymous blob 아님); consumer `_Seam1` Equal 단언 통과.
- **pos② `RequiredDeps` 7-dep 위 TS2742 없음** ✓ — `loopy.d.ts`: `runtime: Runtime<{5 agents}&{2 workflows}>` 완전 전개, designFlow=`"repo"|"figma"|"vercel"|"git"` + jiraFlow=`"jira"|"gh"|"shell"` = 7, `Pick<LoopyDeps,…>` 로 깨끗하게 표면화.
- **pos③ sub-agent-as-tool hover 청결** ✓ — codeGen.tools 튜플에 `fileAnalyzer` 가 `Agent<"fileAnalyzer",…>` named 로 Tool 들과 동평면, TS2742·truncation 없음.
- **pos④ interrupt 채널 named 경계 생존** ✓ — jiraFlow.state `clarification: Channel<UserClarification|null>`, `baseBranch: Channel<BaseBranchChoice|null>` named; consumer `_Seam4a/4b` 통과.
- **neg① edge 오타** ✓ — **router 반환 위치 = TS2820 "Did you mean 'codeGen'?"** (설계 §2.6 north-star 정확 일치); edge 인자 위치 = TS2345 (오타 잡힘, suggestion 無).
- **neg② 미충족 dep** ✓ — TS2741 *"Property 'shell' is missing … required in Pick<LoopyDeps, 7개>"*.

### emit 중 발견된 추가 내부 수정 (설계 문서 미기재 · 사용자 코드 불가시)
- **수정 ① 완전판: `Step.run` 의 ctx 슬롯도 `any` 여야 한다.** `ctx:unknown` 으로 두면 top-type 이 반공변 파라미터 위치에서 구체 `ToolCtx<…>` 에 assignable 안 됨 → Tool/Agent 가 `AnyStep` 에 안 붙고 → `agent()` 의 `const Tools` 추론이 `readonly AnyStep[]` 로 widening → `ToolDepKeys` 가 전체 dep 으로 붕괴 (**seam① 거짓음성**). 수정 ①의 "any 슬롯"은 input 뿐 아니라 **ctx 에도** 적용해야 완전. (TS2322, emit 첫 시도에서 잡힘 → 고침 → 6/6 통과.)

### 잔여 (사용자 코드에 닿는 변화)
1. **isolatedDeclarations = 메인터(loopy lib) 빌드 게이트 전용, consumer 빌드 아님.** `export const editFile = tool({…})` 가 isolatedDeclarations ON 에서 TS9010(명시 반환타입 요구). → loopy 라이브러리는 ON(모든 export 팩토리 명시 반환타입 → 통과), 사용자 *앱* 코드는 OFF(추론 emit 깨끗). 사용자가 자기 에이전트 코드를 *라이브러리로 재배포하며* isolatedDeclarations 를 켤 때만 `export const x: Tool<…> = tool({…})` 명시 타입 필요 — 앱 코드(대다수)엔 무영향.
2. **verbose hover (TS2742 아님):** codeGen(~48줄)·runtime(~123줄) 추론 타입이 큼. 단 전부 named, TS2742 0, 사용처(`rt.run("designFlow", …)` 결과는 `Promise<{prUrl:string}>` 로 깨끗하게 좁혀짐). **alias 래핑 필요 지점 = 없음** (현실 표면 10+5+2+7 에서 §2.9 의 "deep generics → named interface alias" 잔여 미발동).

**결론:** ④ 타입 기계장치의 마지막 미검증 리스크 닫힘. 공개 표면(`tool`/`agent`/`workflow`/`defineLoopy`)은 *사용자 코드 변경 없이* 실제 `.d.ts` emit 에서 nameable·hover-clean·정확한 오류진단(TS2820/TS2741). 다음 = §"아직 안 다룬 설계 섹션" 진행 가능 (크로스커팅 · network/router · DevTools · 패키징 · 테스팅).

## 설계 섹션 진행 상황

**완료 — brainstorming→spec (`docs/superpowers/specs/`):**
- **DevTools (`loopy dev`) v1** — `2026-06-30-devtools-design.md`. 로컬 dev 디버깅 웹 UI(Bun+브라우저, WS). A안 `loopy dev`=앱 실행기(in-proc devSink → store 영속 + WS). v1 뷰=타임라인+상세·그래프(읽기전용). 핵심: 브라우저도 `state=fold(reduce,log)` 동형 → 라이브·과거·스크럽 단일 코드경로(타임트래블 공짜). replay·interrupt resume·채널 diff·프로덕션 관측=v2.
  - **NORTH-STAR (2026-06-30 추가)**: dev 웹을 *키는 것 자체가* 대시보드 — loopy 코드를 물리기만 하면 관측 + 토폴로지 + (HITL 승인 등) 운영이 **zero-config**로 나와 hermes식 사내 대시보드·n8n/Dify식 워크플로우 도구가 불필요해지는 것을 목표. 해자 = 모든 게 이벤트소싱(계측 0) + end-to-end 타입드(설정 0)라 *대시보드를 짓는 게 아니라 코드를 비춤*. **경계**: 거울 + 관제(observe/operate)만 — 시각적 *저작*(드래그-드롭 빌더)은 잠긴 코드-우선과 충돌하므로 스코프 밖. DevTools spec을 이 north-star로 진화시키는 별도 브레인스토밍 예정.
- **테스팅 v1** — `2026-06-30-testing-design.md`. 녹화→재생 회귀(골든 로그). effect(model·tool) memo + 사용자 코드만 재실행 → divergence 첫 지점(content-addressed)+output. 재생 엔진=③ resume 재사용. eval·프로파일·부분재생=v2.
- **team (멀티에이전트) v1** — `2026-06-30-team-design.md` *(v2, 검증-하드닝)*. 구 network. agent를 노드로 한 workflow의 **얇은 의견적 프리셋** + 공유 `transcript` + `passTo` 설탕. 앵커 = PR/이슈 트리아지(triage→bugFixer/docsWriter→reviewer→END/반려루프). 제어 = **C안 하이브리드**(명시 router 1급 + passTo가 LLM-호출 `pass_to_*` 툴·기본 router 합성). **#1 타입 위험 CLOSED**: 7-에이전트 적대 검증 워크플로우(`wf_14fddbe1-59f`)가 실제 `tsc 6.0.3`로 passTo 멤버십 가드를 닫음 — **후보 (ii) 이름-캡처 + per-slot 브랜드 채택**(값-import은 순환에서 TS7022 치명). 동시에 잡은 결함: nextAgent 미소비 무한루프·반려루프 미재진입·채널 표기·maxTurns 타입드Err 오claim 등 17 majors+1 blocker 통합. **잔여(구현 전 emit 게이트)**: P1–P7/N1–N5 메인 직접 판독 + 10-에이전트 full-size .d.ts hover-clean 확인 + agent() 시그니처 확장(passTo?/input?·ctx interrupt).
- 셋 다 다음 단계 = 각자 `writing-plans`→구현 (별도 세션).

**미착수 (다음 브레인스토밍 후보):**
- 크로스커팅 (미들웨어/관측/가드레일 — 모든 Step 감싸는 횡단 관심사)
- 패키징/모노레포 구조 (코어/어댑터/DevTools 패키지 분리, 공개 API 경계, OSS 레이아웃)

## 모델 가이드 (단계별 — 다음 세션은 단계에 맞춰 모델 선택)
- **남은 설계/브레인스토밍 + 위 비준 2건 → Opus.** 아키텍처 결정·트레이드오프 판단. 여기서 모델 아끼면 설계가 얕아짐. 순수 Sonnet 단독 세션은 비추.
- **프로토타입 검증(.d.ts emit 판독) → Opus** (파일작성만 Sonnet 위임 가능하나 `.d.ts`/hover/`TS2742` 판독은 Opus가 직접). 이게 #1 리스크 — 타입 판단이 핵심. 검증 워크플로우도 Opus급 추론이 반공변성·constrained-infer 버그를 잡음.
- **설계 확정 후 실제 라이브러리 구현 → 메인 Opus + Sonnet 델리게이트**(CLAUDE.md 모델 라우팅 정석). 반복 파일작성·테스트·변환은 `Agent` 툴로 `model:"sonnet"` 위임.
- **Sonnet 클레임은 증거 아님**: "컴파일 OK / `.d.ts` 깨끗 / 테스트 통과"는 메인 세션이 직접 `tsc`·테스트 재실행해 확인. 특히 lint --fix/포맷터/codemod 후엔 필수.

## 프로세스
superpowers:brainstorming 플로우 중(메인 Opus, ultracode on). 설계 확정 후 spec을 `docs/superpowers/specs/`에 쓰고 writing-plans로 진행. loopy 디렉토리는 아직 git 레포 아님(`git init` 필요할 수 있음).
