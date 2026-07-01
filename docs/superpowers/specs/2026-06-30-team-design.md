# loopy.js — `team` (멀티에이전트 v1) 설계 spec

- **status**: design-approved + **검증-하드닝 (v3)** — 2라운드 적대 검증(7-에이전트 sweep `wf_14fddbe1-59f` + 4-에이전트 재검증 `wf_766d2e54-c09`) + 실제 `tsc 6.0.3` emit 증거 통합. writing-plans 대기.
- **date**: 2026-06-30
- **supersedes**: `network` → **`team`**, `handoff` → **`passTo`** (사용자 본인 개명).
- **앵커 산출물**: `docs/design/HANDOFF.md`, `docs/design/core-state-and-types.md`(③④ spec, seam), `docs/design/research-design-space.md`, `docs/design/bell-agent-to-loopy.md`(§6 표면), `src/index.ts`(잠긴 프로토타입 API).
- **자매 spec**: `2026-06-30-devtools-design.md`, `2026-06-30-testing-design.md`.

> **검증 라운드 요약:**
> **v2 (라운드1, 17 majors+1 blocker):** passTo=**이름 캡처**(값-import은 순환에서 TS7022 치명) + per-slot 브랜드(후보 ii, `tsc` 증명). nextAgent 소비형. router가 nextAgent를 review보다 먼저. 채널=`lastChannel`/`listChannel`. `messages`→`transcript`. 반환 `ReviewResult|null`. ReviewResult discriminated. maxTurns 런타임화. agent() 확장.
> **v3 (라운드2, 1 blocker+5 majors):** ① **entry 부트스트랩**: `nextAgent`를 null이 아니라 **`entry`로 init** — turn-0 router가 entry 디스패치, 매 턴 소비 후 steady-state `?? END`(특수처리 0). `?? entry` 모순 제거. ② **maxTurns는 throw**라 null 반환 근거에서 제외(null은 review-없는-END 경로로만). ③ **`inputChannel<T>()`** 도입(잠긴 `lastChannel<T>(init)`는 init 필수 → 입력 seed `issue`는 no-init 신규 생성자, 작은 신규 표면 명시). ④ **HITL는 툴 ctx 경유**: team 툴 ctx에 `interrupt` 노출(`ToolCtx`엔 없었음), P5가 툴 ctx 검증. ⑤ F17 phantom 참조 + key===name 불변식 정리.
> **타입 기계장치 핵심 3개는 컴파일로 건전성 확인됨(라운드2):** GuardAgents가 passTo-없는 reviewer를 `never`로 흡수(오탐 0), router가 discriminated narrowing으로 `!` 없이 `.assignee` 접근, `Promise<ReviewResult|null>` 투영 성립.

---

## 0. 한 줄 + 정체성 앵커

**`team`** = LLM 에이전트들이 **하나의 공유 State를 두고 협업**하는 멀티에이전트 프리미티브. 매 턴 router가 **다음 단일 에이전트 하나**를 골라 실행하고, 다른 모든 것처럼 이벤트 로그 위에 fold된다.

**스펙트럼 위치 (정체성 핵심):** loopy는 workflow(결정론) ↔ agent(autonomous) 스펙트럼을 하나의 타입드 모델로 1급화한다. `team`은 **그 하이브리드 = lead/sub-agent 루프**다. 제어를 *코드 규칙으로 고정*(`.router()`)할지 *모델 판단에 맡길*(`passTo`)지를 매 분기마다 **컴파일 체크되는 로컬 API 선택**으로 만든다.

**스파인 환원 + 정직한 위상:** `team → workflow(agents-as-nodes, 공유 transcript) → Step`. **team은 workflow의 검증된 router/State 기계장치를 재사용하는 "얇은 의견적 프리셋"**(Next.js가 React의 프리셋인 것과 같은 의미 — 약점 아닌 정체성). 추가하는 **신규 타입 표면은 3개로 한정·전부 작음**: ① passTo↔멤버십 가드(§6, Appendix B에서 `tsc`로 닫음), ② `inputChannel<T>()`(no-init seed, §4), ③ 툴 ctx의 `interrupt` 노출(§7). 그 외 런타임 durability·State·router 위험은 신규 0(③ 상속).

---

## 1. 동기 / 앵커 시나리오

bell-agent에는 멀티에이전트 실사용이 **아직 없다**(research:287 "premature?"). 따라서 v1은 YAGNI 엄격 적용(§8)하되, 타입 ergonomics를 *실제로* 검증할 합성-실측 표면이 필요하다. seam처럼 `team`도 구체 시나리오에 앵커링한다.

**앵커 — PR/이슈 트리아지 팀:**
```
이슈 → triage(분류) → bugFixer | docsWriter(처리) → reviewer(검토)
                                                       ├ 승인 → END
                                                       └ 반려 → 담당자 재진입(rework→재검토)
```
검증 표면: passTo(LLM 판단) + 명시 router(규칙 종료) + 핸드오프 순환(반려 루프) + HITL(reviewer→사람) + 종료(END/maxTurns) + 공유 대화.

---

## 2. 개념 모델 + 경계

| | 정체 | 노드 | router |
|---|---|---|---|
| `agent` | messages 채널 + phase의 고정 사이클 그래프. 단일. | 내부 고정 | 내부 고정 |
| `workflow` | 임의 Step 노드 + 데이터-타입 router. | 임의 Step | `State → nodeValue` |
| `team` | **agent를 노드로 한 workflow + 공유 대화 + passTo 설탕** | **agent** | `State → agentKey \| END` (재사용) |

team이 workflow에 더하는 4개(1~3은 한 줄 프리셋, 4만 비자명): ① 노드가 전부 agent(제약), ② 자동 `transcript`(`listChannel<Msg>()`), ③ `nextAgent` 채널 + 기본 router, ④ **passTo 이름-캡처 + 합성 툴 + 멤버십 가드**(§6).

> **정직한 위상 (회의론 렌즈):** team은 `agent`처럼 큰 기계장치(think→act→observe·히스토리·리트라이)를 캡슐화하지 않는다. 정당성은 *능력*이 아니라 **(a) 스펙트럼 세 번째 극 = 정체성, (b) ergonomic 번들, (c) DevTools/레지스트리 1급 통합**. 이를 인정하되 별도 팩토리로 유지(사용자 LOCKED, §12).

---

## 3. 공개 API 표면

**passTo는 타깃을 *이름 문자열*로 캡처**(값 아님) — passTo 축 forward-ref/TDZ/순환-불가 제거(Appendix B, 후보 ii). 에이전트의 **team 정체성 = `agents` 맵의 키이며 그 키는 `agent.name`과 같아야 한다**(멤버십·`pass_to_*` 합성이 둘을 동일시; §6).

```ts
type ReviewResult =
  | { approved: true;  notes: string }
  | { approved: false; assignee: "bugFixer" | "docsWriter"; notes: string };   // discriminated

const triage = agent({
  name: "triage", model: "claude-opus",
  instructions: "이슈를 읽고 버그면 bugFixer, 문서면 docsWriter에게 pass_to.",
  passTo: ["bugFixer", "docsWriter"],     // 이름 문자열 → pass_to_bugFixer/pass_to_docsWriter 합성 (선언 순서 무관·순환 가능)
});
const bugFixer  = agent({ name: "bugFixer",  model: "claude-opus", instructions: "...", tools: [editFile, runTests], passTo: ["reviewer"] });
const docsWriter= agent({ name: "docsWriter",model: "claude-opus", instructions: "...", tools: [editFile],           passTo: ["reviewer"] });
const reviewer  = agent({
  name: "reviewer", model: "claude-opus",
  instructions: "검토 후 승인/반려. 반려면 assignee 지정. 사람 승인이 필요하면 requestApproval 툴 호출.",
  tools: [requestApproval],               // HITL: ctx.interrupt 를 부르는 툴 (team 툴 ctx가 interrupt 노출, §7)
  output: ReviewResult,                         // .writes 로 review 채널 기록
});

const prTriage = team({
  name: "prTriage",
  entry: "triage",                         // 첫 차례 (필수). team이 nextAgent를 이 값으로 seed (§4).
  state: {
    issue:   inputChannel<Issue>(),                 // 입력 seed (no-init, 런타임 제공) — §4
    review: lastChannel<ReviewResult | null>(null),     // overwrite, init null
    // transcript(listChannel<Msg>()) + nextAgent(lastChannel<AgentName|null>, init=entry, 매 턴 소비) = team 자동 주입
  },
  agents: { triage, bugFixer, docsWriter, reviewer },   // 멤버십 가드: 각 agent.passTo ⊆ keyof agents (per-slot 브랜드)
  maxTurns: 20,                            // 안전장치 (초과 시 런타임 throw + 로그 종료 이벤트)
})
  .writes({ reviewer: "review" })         // output→채널 매핑 (선택)
  .router((s) => {                         // 명시 router (선택). nextAgent 를 review 보다 먼저 검사
    if (s.nextAgent) return s.nextAgent;            // 새 핸드오프 요청 우선 (반려 후 rework→reviewer 재진입). turn-0엔 entry.
    if (s.review?.approved) return END;            // 승인 → 종료
    if (s.review) return s.review.assignee;       // 반려 → 담당자 (discriminated → assignee 보장, `!` 불필요)
    return END;                                     // 넘길 곳도 review 도 없음 → 종료
  });

const rt = defineLoopy({ teams: { prTriage } }).provide(/* deps */);
const out: ReviewResult | null = await rt.run("prTriage", { issue }, { threadId: "t-7" });
//    ReviewResult | null — review 채널 투영. null은 review 미산출 종료 경로에서만 (maxTurns는 throw, §4).
```

**최소 형태 (passTo만, router/writes 생략):**
```ts
const simple = team({ name: "s", entry: "a", state: {}, agents: { a, b } });
// nextAgent init=a → turn0 router→a(소비) → a pass_to_b(nextAgent=b) → router→b(소비) → b passTo 없음(nextAgent=null) → router→END
```

---

## 4. 공유 상태 & 채널 & 턴 라이프사이클

**채널 (잠긴 `channel(reduce).initial()` + sugar `lastChannel`/`listChannel`, `src/index.ts:219-230`; + 신규 `inputChannel`):**
- **자동 주입**:
  - `transcript: listChannel<Msg>()` — 공유 대화. (이름이 `transcript`인 이유: 잠긴 `agent()`가 내부에 namespaced `messages`를 prewire하므로(core §1.1) 충돌 회피.)
  - `nextAgent: lastChannel<AgentName | null>(entry)` — 제어 채널, **init = `entry`**(아래 부트스트랩), **매 턴 router가 읽은 직후 null로 소비**.
- **author 선언**: 도메인 채널. 입력 seed는 **`inputChannel<T>()`**(신규, no-init — 런타임 제공), 그 외는 `lastChannel`/`listChannel`.

> **신규 `inputChannel<T>()` (라운드2 결함 + 라운드3 타입 수정):** 잠긴 `lastChannel<T>(init: T)`는 init이 **필수**(`src/index.ts:219`)라 `issue: lastChannel<Issue>()`는 TS2554. 그러나 `issue`는 순수 *입력*이라 자연스러운 init이 없다. → `inputChannel<T>()` 도입(no-init, 런타임 run 입력으로 seed 필수). **⚠️ 단순 `(): Channel<T,T>`로는 안 된다** — 잠긴 `lastChannel<T>(init): Channel<T,T>`와 *타입이 동일*(`Channel<V,U=V>`엔 init 슬롯 없음)이라 `InputOf`가 둘을 못 가른다. **반드시 타입-레벨 브랜드**를 달아야 한다(`~deps`/`~passTo` phantom과 동일 패턴):
> ```ts
> interface InputChannel<T> extends Channel<T, T> { readonly "~input": true }
> function inputChannel<T>(): InputChannel<T>;
> type InputOf<Team> = { [K in keyof S as S[K] extends InputChannel<any> ? K : never]:
>                          S[K] extends InputChannel<infer T> ? T : never };   // 브랜드로 선택 (V===U 비교 아님)
> ```
> → `InputOf<typeof prTriage> ≡ { issue: Issue }`(브랜드 `~input` 가진 `issue`만; `lastChannel`/`listChannel`은 브랜드 없어 제외). 작은 신규 타입 표면 — §0의 "신규 표면 3개"에 포함(§8 추적).

**⚠️ nextAgent 소비 + entry 부트스트랩 (라운드1 blocker + 라운드2 blocker):**
- core §1.1 "absent keys are untouched" 규칙상 nextAgent를 안 비우면 같은 에이전트가 maxTurns까지 무한 반복. **수정: 런타임이 매 턴 router 호출 직후 nextAgent를 null로 fold(consume-on-read).**
- **entry 부트스트랩**: nextAgent를 null로 init하면 turn-0 router `s.nextAgent ?? END`가 즉시 END → entry가 안 돈다. **수정: team이 nextAgent를 `entry`로 init.** 그러면 turn-0에 router가 entry를 디스패치(특수처리 불필요), 소비 후 steady-state는 `?? END`. 최소 예제·반려루프 모두 entry부터 시작해 정상 종료.
- 명시 router는 `nextAgent`(1회성)를 *낡은* 도메인 채널(review)보다 **먼저** 검사 → 반려 루프 reviewer 재진입(§3).

**한 턴이 state를 바꾸는 법 (= workflow 노드 루프):**
1. `router(state)` → 다음 에이전트 `A`(또는 END). **turn-0엔 nextAgent=entry라 A=entry.** 직후 nextAgent를 null로 소비.
2. `A` 실행 — 입력 = 렌더된 read-only state 뷰(공유 transcript + 도메인 채널 현재값) + 자기 instructions. `A`는 내부 think→act→observe로 자기 툴(+합성 pass_to_* 툴)을 호출.
3. `A` 턴 결과 = 채널 업데이트(이벤트 기록): 자기 대화를 `transcript`에 append; `pass_to_B()` 호출 시 `nextAgent="B"`; `output` + `.writes({A:ch})` 매핑 시 `A.output`→`ch`.
4. fold → 1번 (router가 END 또는 maxTurns까지).

**에이전트의 typed-state 접근 (회의론 "untyped ctx bag" 우려 해소):** 에이전트는 LLM이라 본문이 없고 state를 **렌더된 텍스트 뷰**로 받아 추론. 타입 안전은 가변 bag이 아니라 (a) reducer 선언 채널, (b) router가 타입드 state로 분기, (c) `.writes`가 `output ⊑ 채널타입` 컴파일 체크 하는 경계에 있다.

**도메인 채널 쓰기 (A안):** 에이전트 `output` → `.writes({ agent: channel })`(선언적, `output ⊑ 채널 타입` 컴파일 체크). (툴이 채널 직접 쓰기 = §8 OUT.)

**최종 출력 투영:** `rt.run(...)` 반환 = `.writes` 단일 매핑 채널의 값 타입(트리아지 → `review` = `ReviewResult | null`). **`ReviewResult`로 좁히지 않음** — review 채널이 nullable이고 **§9의 review-없는-END 경로**(reviewer가 review 미산출하고 종료)에서 null로 끝날 수 있다(정직). **maxTurns는 throw라 null 반환 원천 아님**(아래 §5/§9). 매핑 0/다수 → 전체 state 스냅샷(단일 채널 silent-pick 금지). non-null 보장 원하면 `review: lastChannel<ReviewResult>(...)` + 런타임 불변식.

---

## 5. 제어 모델

**한 규칙:** *router가 다음 차례를 정한다. `passTo`는 에이전트가 다음 차례를 **요청**하는 타입드 방법.*

- **passTo 디슈가링**: `agent({ passTo: ["bugFixer"] })` → `pass_to_bugFixer()` 툴 합성. 호출 = `nextAgent="bugFixer"` effect(기록). 타깃 이름 ⊆ team `agents` 키 컴파일 체크(§6).
- **기본 router** (`.router()` 생략): `(s) => s.nextAgent ?? END`. **nextAgent가 `entry`로 init되고 매 턴 소비**되므로 turn-0=entry, 이후 "passTo 요청 있으면 거기로, 없으면 END". passTo만으로 도는 팀은 router 불필요.
- **명시 router**: author 규칙. **`nextAgent`(1회성 핸드오프)를 도메인 채널보다 먼저 검사**(반려 루프 재진입; turn-0엔 entry 디스패치). review→END/되돌림이 여기.
  - **⚠️ silent-drop 주의:** 명시 router가 `nextAgent`를 무시하면 LLM의 `pass_to_X()` 가 no-op. **v1 규칙: 명시 router는 nextAgent를 반드시 한 번 검사(권장)하거나, 무시할 의도를 주석으로 명시.**

**시작:** `team({ entry })` 필수 — 런타임이 nextAgent를 entry로 seed해 turn-0에 entry 실행. **종료:** router가 `END`(리터럴 `"~end"`, `src/index.ts:232` — "브랜드 sentinel" 아님). 안전장치 `maxTurns` 초과 → **런타임 throw `TeamMaxTurnsError` + 로그 종료 이벤트**(부분 state 보존). **`Step<Name,In,Out,Deps>`에 Err 파라미터 없음**(`src/index.ts:78-94`)이라 *타입드 Err 채널*이 아닌 런타임 종료 — v1 범위. **`maxTurns`는 throw하므로 `rt.run` 의 정상 반환값(`ReviewResult|null`)을 만들지 않는다**(거부됨). "타입드 에러 채널"은 v2(Step에 Err 파라미터 추가 = ④ seam 등급 신규 위험이라 §8 YAGNI 컷과 충돌).

---

## 6. 타입 기계장치

대부분 검증 기계장치 재사용. 신규 위험 1개(passTo 멤버십)는 **Appendix B에서 `tsc 6.0.3` emit으로 닫음**.

- **router 반환** = `keyof Agents | END` → workflow `.branch` 그대로 → 오타 **TS2820**. **passTo 가드와 독립.**
- **Deps 수렴** = 에이전트 deps 합집합 → core §2.7 `NonNullable<K> & keyof LoopyDeps`. passTo 합성 툴 deps 0.
- **에이전트=노드 In/Out**: 입력 = 렌더된 state 뷰(team 바인딩); 출력 = 채널 업데이트. `A.output ⊑ .writes 채널 타입` 컴파일 체크.
- **이름 보존 + key===name 불변식**: 멤버십 집합 = `agents` 맵 *키*. **각 키는 그 에이전트의 `name`과 같아야** 하며(`pass_to_*` 합성·멤버십이 둘을 동일시), `agents: { triage, ... }` 단축 표기에선 자동 성립. AgentName 리터럴이 합성 툴 이름·`nextAgent` 값·router 반환을 통과해도 보존(seam pos① 동형).
- **레지스트리 충돌 가드**: `agents`는 객체 맵이라 키 중복은 native TS1117(라운드2 `tsc` 확인). `defineLoopy`는 §2.8 `keyof A & keyof W extends never` 가드를 새 `teams` 범주까지 확장(`keyof A & keyof W & keyof T`).

**✅ #1 위험 = CLOSED (Appendix B, 실측 + 라운드2 재확인). 후보 (ii) 이름-캡처 + per-slot 브랜드 가드.**
- 두 §2.x 규율 필수(라운드2 컴파일 재확인): ① 추출기 `NonNullable<P>`(constrained infer면 passTo-없는 reviewer가 `string` fallback → 유효 팀 오탐 = §2.7 DepsOf 버그). ② 게이트 `[Exclude<…>] extends [never]` tuple-wrap(naked는 never 분배 오작동 = §2.7 `[Missing]`). **재확인: GuardAgents가 reviewer(passTo 없음)를 `never`로 흡수해 오탐 0; 유효 팀 + N2 브랜드 둘 다 성립.**
- (i) edges 거부(passTo가 에이전트에서 사라져 pos① 불가), (iii) 값-import 거부(순환 TS7022 치명). 상세 Appendix B.

---

## 7. 이벤트소싱 / replay / HITL

**전부 잠긴 ③ 런타임 상속 — 신규 durability 0.**
- 모든 턴·툴콜(passTo 포함)·채널 변화 = 기록 이벤트 → replay = fold, LLM 0.
- **HITL (라운드2 수정 — 툴 ctx 경유):** 잠긴 에이전트는 *선언형(본문 없음)*이라 interrupt를 직접 부를 자리가 없고, 잠긴 `ToolCtx<D> = { deps }`엔 interrupt가 없다(`interrupt`는 `NodeCtx`만, `src/index.ts:24-33`). **수정: team 안에서 실행되는 툴의 ctx에 `interrupt<T>(payload)`를 노출**(team 툴 ctx 확장, §12 flag). reviewer는 `requestApproval` 툴로 `ctx.interrupt({kind:"approve?"})` 호출 → 중단+checkpoint, `runtime.resume(threadId, value)` → 사람 답 주입, 멈춘 자리에서 계속. emit은 **P5로 "requestApproval 툴 ctx가 `interrupt<T>` 노출"**을 검증(에이전트 ctx 아님).
- **passTo가 effect(기록)인 게 결정적 값**: prose 파싱이었으면 replay 비결정. 버튼이라 cache-hit 0-I/O 재생.
- **DevTools 데이터소스**: team의 turn/passTo/channel-diff 이벤트가 그대로 흐름 — team이 dev 웹 north-star 위해 추가로 할 일 0.

---

## 8. v1 스코프 (YAGNI)

**IN**: `team({ name, state, agents, entry, maxTurns? })` + 선택 `.router()`/`.writes()`. passTo 이름-캡처 sugar(합성 툴 + 기본 router + 멤버십 가드). 자동 `transcript`·`nextAgent`(init=entry, 소비형) + author 채널(입력은 `inputChannel`). output→채널 매핑. replay·resume·interrupt(③ 상속, 툴 ctx interrupt 노출). 전체 타입 체크.

**신규 타입 표면 (작음, 3개 — §0)**: ① passTo per-slot 멤버십 가드, ② `inputChannel<T>()` + `InputOf` 선택, ③ 툴 ctx `interrupt` 노출. 전부 §10 emit 게이트로 닫음.

**OUT (명시적 컷)**:
- ❌ 병렬/동시 에이전트(fan-out) → v2. v1 = 턴당 활성 1명.
- ❌ 중첩 team → v2. ❌ 런타임 동적 에이전트 생성 → 비범위. ❌ 에이전트 간 사설 직접 메시지 → 비범위.
- ❌ `passTo` 구조화 인자 → v2. ❌ 에이전트별 사설 scratchpad → v2. ❌ 툴이 team 채널 직접 쓰기 → v2.
- ❌ **타입드 Err 채널**(maxTurns 등) → v2 (Step Err 파라미터 = 신규 타입 위험). ❌ passTo 이름 IDE rename 전파/lint → v2.

---

## 9. 에러 & 엣지

- **router 잘못된 키** → 컴파일 TS2820(런타임 도달 불가).
- **passTo 비멤버 타깃** → 컴파일 TS2322 per-slot 브랜드(§6).
- **maxTurns 초과** → 런타임 throw `TeamMaxTurnsError` + 로그 종료 이벤트, 부분 state 보존. (정상 반환 아님 — `await rt.run` reject.)
- **에이전트 턴 throw** → 호출자 전파(런타임). 부분 state 보존.
- **무진전 교착**: nextAgent 소비형이라 기본 router는 안전 END. 명시 router가 방금 끝낸 에이전트 재반환 시 무한 가능 → **maxTurns backstop**(검증이 load-bearing 확정 — 컷 금지).
- **반려인데 assignee 미산출**: ReviewResult discriminated라 `approved:false`면 `assignee` 필수 → 스키마가 차단.
- **`.writes` 0/다수**: 전체 state 스냅샷(silent-pick 금지).
- **entry 미지정** → 컴파일 TS2741.
- **review-없는-END**: reviewer가 review 미산출 + nextAgent null → router 마지막 `return END` → `rt.run` 반환 = `null`(이 경로가 `| null`의 유일 원천).

---

## 10. 미검증 리스크 & 프로토타입 검증 계획 (seam-style) — HARDENED

> 구현 전 메인(Opus)이 `.d.ts`/hover 직접 판독(subagent 클레임 불신 — MEMORY "Subagent claim은 evidence 아님"). ④ seam 프로토콜: `team-consumer.ts` 컴파일단언 + `dist-examples/**.d.ts` 손-판독 + `_negative.ts`@`tsconfig.negative.json` 진단.

### Gate #0 — 단언 작성 전 닫을 API 결정 (BLOCKER)
1. **team-에이전트 shape**: `agent()` 확장 — `passTo?: readonly string[]` 추가, team-노드 시 `input` 옵셔널(team이 state 뷰 바인딩). (대안 `teamAgent()` — 정체성상 비채택.)
2. **`inputChannel<T>(): InputChannel<T>`** 신규 생성자(타입-레벨 `~input` 브랜드 필수 — `Channel<T,T>`만으론 lastChannel과 동형이라 구분 불가) + `InputOf<Team>`가 브랜드로 골라 run 입력 타입 도출(§4). emit P4로 검증.
3. **team 툴 ctx에 `interrupt<T>` 노출**: reviewer의 `requestApproval` 툴 ctx가 NodeCtx-급 interrupt 보유(§7). emit P5로 검증(툴 ctx 대상).
4. **채널 표기**: 자동 `transcript=listChannel<Msg>()`, `nextAgent=lastChannel<AgentName|null>(entry)`.

### 10.1 Positive (P1–P7) — `examples/team.ts` + `examples/team-consumer.ts` + 손-판독 `.d.ts`
- **P1 passTo 합성 툴 named**: `keyof PassToolNames<PassToOf<typeof triage>> ≡ "pass_to_bugFixer" | "pass_to_docsWriter"`. (seam pos① 동형, anonymous blob 금지.)
- **P2 router 반환 유니온 (entry `"triage"` 포함)**: `TeamRouterReturn<typeof prTriage> ≡ "triage"|"bugFixer"|"docsWriter"|"reviewer"|"~end"`. (inherited `.branch`, passTo 가드와 독립.)
- **P3 자동 채널 named**: `S["nextAgent"] ≡ AgentName|null`; `S["transcript"] ≡ readonly Msg[]`; `S["review"] ≡ ReviewResult|null`.
- **P4 `rt.run` 입출력 (inputChannel 브랜드 기반)**: `demoTriage(): Promise<ReviewResult | null>`(단일 `.writes` 투영, `| null` 정직); `InputOf<...["prTriage"]> ≡ { issue: Issue }`(**`~input` 브랜드 가진 `issue`만** 선택 — `lastChannel`/`listChannel`은 브랜드 없어 제외; V===U 비교 아님 — §4 브랜드 정의).
- **P5 team 툴 ctx `interrupt<T>` 노출 + resume 라운드트립**: `requestApproval` 툴의 run-ctx가 `interrupt: <T>(payload)=>Promise<T>` 노출(에이전트 ctx 아님); resume value 타입 `Approval` named 생존(seam④ 동형).
- **P6 `.writes` 0/다수 → state 스냅샷**: 임의 단일 채널로 silent 안 좁힘.
- **P7 deps 수렴 + passTo absorb**: `RequiredDeps<{prTriage}> ≡ "repo"`; passTo 추가가 유니온 안 넓힘.

### 10.2 Must-error (N1–N5) — `_negative.ts`, `tsconfig.negative.json`
- **N1 router 비멤버 키 → TS2820** "Did you mean 'bugFixer'?".
- **N2 passTo 비멤버 타깃 → TS2322 per-slot 브랜드** — 위반 에이전트 슬롯 `"~passToTargetNotInTeam": "bugFxr"`. (후보 (ii) 측정, Appendix B.)
- **N3 agent `output` ⊄ `.writes` 채널 타입 → TS2322** 비할당.
- **N4 `entry` 미지정 → TS2741**.
- **N5 `.writes` 비존재 채널 키 → TS2820** "Did you mean 'review'?".

### 10.3 완료 게이트
Gate #0 해소 후 **P1–P7 + N1–N5** 전부 메인 직접 판독 통과해야 구현 착수. **잔여 미검증(§2.9 류)**: `PassToolNames ∘ PassToOf` 가 *10-에이전트* team .d.ts에서 hover-clean한지(4-에이전트 emit은 깨끗 — Appendix B). + **isolatedDeclarations ON(메인터 빌드)에서 `team()` 반환·`inputChannel`·툴 ctx 확장이 TS9010/TS2742 없이 emit**(소비자 OFF 판독과 별개 게이트).

---

## 11. 테스팅 전략 (team 특이) — HARDENED

자매 spec `2026-06-30-testing-design.md` 녹화→재생(골든 로그) 재사용. team이 엔진에 가하는 **단 하나의 신규 요구**: 재배정 재진입(같은 에이전트가 다른 턴 활성).

**team이 record→replay에 더하는 것:** passTo=합성 `pass_to_B()` 툴콜=effect → memo(핸드오프 LLM 0회 결정적 재생). router·`.writes`·**기본 router `nextAgent ?? END`**·maxTurns 카운팅 = 사용자/오케스트레이션 코드(매 재생 재실행=회귀 표면). content-address 키 `node`=그 턴 활성 에이전트 키.

> ⚠️ **엔진 요구:** 재배정 루프(reviewer→reject→bugFixer 2회차)에서 같은 에이전트가 다른 턴 활성 → 키 `node`만으론 bugFixer@턴1·턴4 effect가 memo 충돌. testing-design `stepEpoch`가 **에이전트 재진입마다 증가**해야 구분.

**골든-로그 회귀 매트릭스 (요약):** (제어 의미론 = §3 router + §4 entry-seed/consume + §5 — 라운드2 종료 추적이 4경로 종료 확인)
- **T1 핸드오프 결정성**: `triage→bugFixer→reviewer→END` 경로 + memo hit==effect count(LLM 0). 회귀: triage instructions 변경 → turn0 model effect divergence.
- **T2 approve→END**: reviewer `{approved:true}` → router END. 회귀: approve 분기 삭제 → 없는 턴 진입.
- **T3 reject→reassign 재진입** (적대): bugFixer 두 stepEpoch 각각 memo hit; stepEpoch 미증가 메타테스트.
- **T4 fallthrough→passTo**: nextAgent 비-null → 추종. 별도 골든(nextAgent=null)으로 fallback 고정.
- **T5 HITL interrupt/resume**: prefix + `Interrupted` + `Resumed(value)` + suffix. 재생 시 사람 0회. resume 타입 `Approval`.
- **T6 maxTurns backstop**: reject 반복 → 20턴 → `TeamMaxTurnsError` 종료 이벤트 + 부분 state(런타임 이벤트 단언, 타입 아님).
- **T7 무진전 클린 종료(기본 router)**: nextAgent null → END. 회귀: 명시 router가 방금 끝낸 에이전트 반환 → maxTurns 종료.

**작성자 표면 (testing-design ① 재사용, 신규 0):**
```ts
test("prTriage: bug → fix → approve", async (t) => {
  const r = await t.replay("prTriage", { issue });
  expect(r.output).toEqual({ approved: true, notes: expect.any(String) });
  expect(r.path).toEqual(["triage", "bugFixer", "reviewer"]);   // team 전용 투영
  expect(r.llmCalls).toBe(0);
});
```
- `r.path`(턴별 활성 에이전트열)·`r.turns`·`r.terminal`(END | TeamMaxTurnsError) = team이 replay 결과에 더하는 유일 신규 투영(전부 기존 이벤트 로그 fold).
- **argsDigest 정규화 (testing-design 열린 질문의 team 답)**: `transcript` append-only라 모델콜 argsDigest가 전체 대화 해싱 시 앞 턴 변경이 뒷 턴 전부를 divergence로 폭발 → **그 턴 새 suffix만 해싱**으로 첫 지점 국소화.

---

## 12. LOCKED 결정 정합성 체크

- ✅ "하나의 척추: 모든 것은 Step" — team → workflow → Step.
- ✅ "router-over-shared-state 1급, passTo sugar" — §5.
- ✅ "이벤트소싱 + HITL v1 1급" — §7, ③ 상속, 신규 durability 0.
- ✅ "State = 타입드 채널 집합, reducer 선언" — §4 (`lastChannel`/`listChannel`/`inputChannel`).
- ✅ "함수형 DI, 데코레이터 금지" — §6 deps 수렴.
- ✅ "isolatedDeclarations = 메인터 게이트" — §10.3이 ON(메인터)·OFF(소비자) 분리 검증.
- 🔁 **개명**: `network`→`team`, `handoff`→`passTo`.
- ⚠️ **잠긴 표면 확장 3건 (사용자 인지 필요)**: (a) `agent()`에 `passTo?` 추가 + team-노드 시 `input` 옵셔널, (b) `inputChannel<T>()` 신규 채널 생성자 + `InputOf` 선택, (c) **team 툴 ctx에 `interrupt` 노출**(`ToolCtx` 확장). 전부 추가적·최소이나 잠긴 프리미티브를 건드리므로 명시.

---

## Appendix A: 용어

- **`team`**(구 network) / **`passTo`**(구 handoff, 타깃 이름 문자열, `passTo:["b"]` → `pass_to_b()`).
- **`nextAgent`** — 제어 채널, **init=`entry`**, 매 턴 router 읽은 직후 소비(null).
- **`transcript`** — 공유 대화(`listChannel<Msg>()`). **`inputChannel<T>(): InputChannel<T>`** — no-init 입력 seed 채널, 타입-레벨 `~input` 브랜드 보유(`InputOf`가 브랜드로 선택; `lastChannel`과 타입 동형이라 브랜드 필수).
- **`entry`**(첫 차례, nextAgent seed) / **`END`**(리터럴 `"~end"`) / **`maxTurns`**(런타임 throw + 로그, 타입드 Err 아님).
- **`.writes({ agent: channel })`** — output→채널 매핑. **기본 router** = `(s) => s.nextAgent ?? END`(nextAgent init=entry). **명시 router** = author 규칙(nextAgent 우선 검사).

## Appendix B: passTo 멤버십 가드 — 타입 실현가능성 (실측 `tsc 6.0.3`)

**B.0 긴장:** passTo 타깃은 `agent()` 시점에 쓰이고 멤버십 `keyof Agents`는 `team()` 시점에만 존재. 결정적 하위질문 = passTo가 *이름*인가 *값*인가 — 이게 feature 성패를 가른다.

**B.1 (i) team-레벨 `edges`**: 진단 최고(TS2820 "Did you mean")·가드 pitfall 0·emit 깨끗. **그러나 거부** — passTo가 에이전트에서 사라져 **pos① 불가**(에이전트 타입 타깃 정보 무보유), 헤드라인 ergonomic 삭제.

**B.2 (ii) 이름-캡처 + per-slot 브랜드 ✅ 채택:**
```ts
interface Agent<Name, …, Pass extends string = never> { readonly "~passTo"?: Pass; }
function agent<…, const Pass extends readonly string[] = []>(def: { …; passTo?: Pass }): Agent<…, Pass[number]>
type PassToOf<A> = A extends { readonly "~passTo"?: infer P } ? NonNullable<P> : never;   // NonNullable 필수
type GuardAgents<Agents> = { [K in keyof Agents]:
  [Exclude<PassToOf<Agents[K]>, Extract<keyof Agents, string>>] extends [never]            // tuple-wrap 필수
    ? Agents[K] : { readonly "~passToTargetNotInTeam": Exclude<PassToOf<Agents[K]>, Extract<keyof Agents, string>> } };
function team<…, const Agents extends Record<string, AnyAgent>>(def: { …; agents: Agents & GuardAgents<Agents> }): Team<…>
```
- 컴파일 ✅ (passTo-없는 reviewer는 `never` 흡수 — 오탐 0, **라운드2 재확인**). isolatedDeclarations ✅. 소비자 .d.ts ✅ **(i)보다 정보 많음**(각 에이전트가 타깃 보존 → pos①/③ 실현). `pass_to_${N}` 템플릿 리터럴 mapped 타입 nameable emit.
- 진단 = **TS2322 브랜드**(위반 에이전트 슬롯 + 낯선 타깃 지목; per-slot이라 10-에이전트도 안 터짐). "Did you mean"은 없음(멤버십 집합이 team()까지 없는 본질적 cross-time 세금).
- **두 §2.x 규율 필수(재확인)**: ① `NonNullable` 추출(constrained infer면 zero-passTo `string` fallback). ② `[Exclude<…>] extends [never]` tuple-wrap.

**B.3 (iii) 값-import (치명, 거부):** **(a)** 순환 핸드오프에서 컴파일 불가 — `reviewer⇄specialist` 모델링 시 `TS7022`/`TS2448`/`TS2454`. 앵커가 순환을 가지므로 값-passTo는 앵커 그래프를 못 표현. **(b)** 게이트-on-return은 진단을 소비처로 지연(`TS2345`, 위반 에이전트도 team도 안 가리킴).

**B.4 결정**: **(ii)** — 유일하게 passTo 에이전트 유지 + 순환 생존 + pos①/③ 실현 + 양쪽 .d.ts 깨끗. 비용은 진단 한 등급(TS2322 브랜드)·이름 미검증@agent() — 수용.
