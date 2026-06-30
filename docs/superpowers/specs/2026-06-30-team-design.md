# loopy.js — `team` (멀티에이전트 v1) 설계 spec

- **status**: design-approved + **verification-hardened (v2)** — 7-agent 적대 검증(잠긴 결정·타입 타당성·완전성·스코프·회의론) + 실제 `tsc 6.0.3` emit 증거 통합. writing-plans 대기.
- **date**: 2026-06-30 (v2 개정: 검증 워크플로우 `wf_14fddbe1-59f` 반영)
- **supersedes**: `network` → **`team`**, `handoff` → **`passTo`** (사용자 본인 개명).
- **앵커 산출물**: `docs/design/HANDOFF.md`, `docs/design/core-state-and-types.md`(③④ spec, seam), `docs/design/research-design-space.md`, `docs/design/bell-agent-to-loopy.md`(§6 표면), `src/index.ts`(잠긴 프로토타입 API).
- **자매 spec**: `2026-06-30-devtools-design.md`, `2026-06-30-testing-design.md`.

> **v2 변경 요약 (검증이 강제):** ① **passTo = 이름(문자열) 캡처** + per-slot 브랜드 가드(후보 ii, `tsc`로 증명) — 값-import의 forward-ref/TDZ/순환-불가 제거. ② **`nextAgent`·routing은 매 턴 소비(consume-on-read)** — 안 그러면 기본 router 무한 루프(blocker). ③ 명시 router는 **nextAgent를 verdict보다 먼저** 검사 — 반려 루프가 reviewer로 재진입. ④ 채널 표기 = 잠긴 `lastChannel`/`listChannel`. ⑤ 공유 대화 채널명 `messages`→**`transcript`**(에이전트 prewired `messages`와 충돌 회피). ⑥ 반환 투영 = `Verdict | null`(정직). ⑦ VerdictSchema = discriminated union. ⑧ maxTurns = **런타임 throw + 로그 종료 이벤트**(Step에 Err 파라미터 없음 — "타입드 Err 채널" 격하). ⑨ team-에이전트 API: `agent()` 에 `passTo?` 추가 + team-노드일 때 `input` 옵셔널·ctx에 `interrupt` 노출. ⑩ Appendix B(컴파일 증거) + 강화 §10/§11 추가.

---

## 0. 한 줄 + 정체성 앵커

**`team`** = LLM 에이전트들이 **하나의 공유 State를 두고 협업**하는 멀티에이전트 프리미티브. 매 턴 router가 **다음 단일 에이전트 하나**를 골라 실행하고, 다른 모든 것처럼 이벤트 로그 위에 fold된다.

**스펙트럼 위치 (정체성 핵심):** loopy는 workflow(결정론) ↔ agent(autonomous) 스펙트럼을 하나의 타입드 모델로 1급화한다. `team`은 **그 하이브리드 = lead/sub-agent 루프**다. 제어를 *코드 규칙으로 고정*(`.router()`)할지 *모델 판단에 맡길*(`passTo`)지를 매 분기마다 **컴파일 체크되는 로컬 API 선택**으로 만든다. (전체 포지셔닝은 HANDOFF "정체성 / 포지셔닝".)

**스파인 환원 + 정직한 위상:** `team → workflow(agents-as-nodes, 공유 transcript 채널) → Step`. **team은 workflow의 검증된 router/State 기계장치를 재사용하는 "얇은 의견적 프리셋"이다** (Next.js가 React의 프리셋인 것과 같은 의미 — 약점 아닌 정체성). 단 한 가지 **신규** 타입 표면만 추가한다: passTo↔멤버십 가드(§6, Appendix B에서 `tsc`로 닫음). 그 외 런타임 durability·State·router 위험은 신규 0(③ 상속).

---

## 1. 동기 / 앵커 시나리오

bell-agent(페인 출처)에는 멀티에이전트 실사용이 **아직 없다**(research:287 "premature?"). 따라서 v1은 YAGNI를 엄격 적용(§8)하되, 타입 ergonomics를 *실제로* 검증할 합성-실측 표면이 필요하다. seam을 §6 실제 표면에 박아 버그를 잡았듯, `team`도 구체 시나리오에 앵커링한다.

**앵커 — PR/이슈 트리아지 팀:**

```
이슈 → triage(분류) → bugFixer | docsWriter(처리) → reviewer(검토)
                                                       ├ 승인 → END
                                                       └ 반려 → 담당자 재진입(rework→재검토)
```

검증 표면: **passTo(LLM 판단 라우팅) + 명시 router(규칙 종료) + 핸드오프 순환(반려 루프) + HITL(reviewer→사람 승인) + 종료(END/maxTurns) + 공유 대화**. 기존 §6 코드에이전트 도메인과 정합.

---

## 2. 개념 모델 + 경계

| | 정체 | 노드 | router |
|---|---|---|---|
| `agent` | messages 채널 + phase의 고정 사이클 그래프(think→act→observe). 단일. | 내부 고정 | 내부 고정 |
| `workflow` | 임의 Step 노드 + 데이터-타입 router. 범용 그래프. | 임의 Step | `State → nodeValue` |
| `team` | **agent를 노드로 하는 workflow + 공유 대화 + passTo 설탕** | **agent** (각자 Step) | `State → agentKey \| END` (재사용) |

team이 workflow에 더하는 4개 (정직하게: 1~3은 한 줄짜리 프리셋, 4만 비자명):
1. 노드가 전부 **agent** (제약이지 능력 아님 — agent은 이미 Step).
2. 자동 **`transcript` 공유 채널** (`listChannel<Msg>()` 한 줄).
3. 예약 **`nextAgent` 제어 채널** + 기본 router (각 한 줄).
4. **passTo 이름-캡처 + 합성 툴 + 멤버십 가드** (비자명 — §6, Appendix B).

> **정직한 위상 (회의론 렌즈 반영):** team은 `agent`처럼 큰 기계장치(think→act→observe 루프·히스토리·리트라이·파싱)를 캡슐화하지 않는다. team의 정당성은 *능력*이 아니라 **(a) 스펙트럼의 세 번째 극 = 정체성/포지셔닝, (b) ergonomic 번들(공유 transcript+제어+passTo 합성을 한 팩토리로), (c) DevTools/레지스트리 1급 통합**이다. 이를 인정하되 별도 팩토리로 유지하는 것이 사용자 LOCKED 결정(§12).

---

## 3. 공개 API 표면

에이전트는 `team({ agents })`에 선언적으로 주어지므로 멤버십 축엔 forward-ref 없음. **passTo는 타깃을 *이름 문자열*로 캡처**(값 아님) — 이로써 passTo 축의 forward-ref/TDZ/순환-불가를 제거(Appendix B에서 `tsc`로 증명, 후보 ii).

```ts
// ── VerdictSchema = discriminated union (assignee 누락 방지) ─────
type Verdict =
  | { approved: true;  notes: string }
  | { approved: false; assignee: "bugFixer" | "docsWriter"; notes: string };

// ── 에이전트 (passTo = 이름 문자열) ────────────────────────────
const triage = agent({
  name: "triage", model: "claude-opus",
  instructions: "이슈를 읽고 버그면 bugFixer, 문서면 docsWriter에게 pass_to.",
  passTo: ["bugFixer", "docsWriter"],     // 이름 문자열 → pass_to_bugFixer/pass_to_docsWriter 합성
});                                         // 선언 순서 무관, 순환 가능 (값 참조 아님)

const bugFixer  = agent({ name: "bugFixer",  model: "claude-opus", instructions: "...", tools: [editFile, runTests], passTo: ["reviewer"] });
const docsWriter= agent({ name: "docsWriter",model: "claude-opus", instructions: "...", tools: [editFile],           passTo: ["reviewer"] });

const reviewer = agent({
  name: "reviewer", model: "claude-opus",
  instructions: "검토 후 승인/반려. 반려면 담당자(assignee) 지정. 사람 승인이 필요하면 requestApproval 툴 호출.",
  tools: [requestApproval],               // ← HITL: ctx.interrupt 를 부르는 툴 (output-only는 interrupt 자리 없음)
  output: VerdictSchema,                   // .writes 로 verdict 채널 기록
  // passTo 없음 — 종료/되돌림은 명시 router 가 verdict 보고 결정
});

// ── team 조립 (채널 = 잠긴 lastChannel/listChannel) ────────────
const prTriage = team({
  name: "prTriage",
  entry: "triage",                         // 첫 차례 (필수)
  state: {
    issue:   lastChannel<Issue>(),                  // 입력 seed, overwrite
    verdict: lastChannel<Verdict | null>(null),     // overwrite, init null
    // transcript(공유 대화, listChannel<Msg>()) + nextAgent(제어, lastChannel<AgentName|null>(null), 매 턴 소비)
    //   = team 자동 주입. author 선언 불필요.
  },
  agents: { triage, bugFixer, docsWriter, reviewer },   // 멤버십 가드: 각 agent.passTo ⊆ keyof agents (per-slot 브랜드)
  maxTurns: 20,                            // 안전장치 (런타임 throw + 로그 종료 이벤트)
})
  .writes({ reviewer: "verdict" })         // output→채널 매핑 (선택)
  .router((s) => {                         // 명시 router (선택). nextAgent 를 verdict 보다 먼저 검사
    if (s.nextAgent) return s.nextAgent;            // 새 핸드오프 요청 우선 (반려 후 rework→reviewer 재진입)
    if (s.verdict?.approved) return END;            // 승인 → 종료
    if (s.verdict) return s.verdict.assignee;       // 반려 → 담당자 (discriminated → assignee 보장, `!` 불필요)
    return END;                                     // 넘길 곳도 verdict 도 없음 → 종료
  });

const rt = defineLoopy({ teams: { prTriage } }).provide(/* deps */);
const out: Verdict | null = await rt.run("prTriage", { issue }, { threadId: "t-7" });
//    Verdict | null — verdict 채널 투영 (maxTurns/미승인 종료 시 null 가능, §4)
```

**최소 형태 (passTo만, router/writes 생략):**
```ts
const simple = team({ name: "s", entry: "a", state: {}, agents: { a, b } });
// a.passTo=["b"], b.passTo=[] → 기본 router: a→(pass_to_b)→b→(passTo 없음=nextAgent 소비 후 null)→END
```

---

## 4. 공유 상태 & 채널 & 턴 라이프사이클

**채널 (잠긴 `channel(reduce).initial()` + sugar `lastChannel`/`listChannel`, `src/index.ts:219-230`):**
- **자동 주입**: `transcript: listChannel<Msg>()` — 모든 에이전트가 보는·append하는 공유 대화. **(이름이 `transcript`인 이유: 잠긴 `agent()`는 자기 내부에 namespaced `messages` 채널을 prewire하므로(core §1.1), team-레벨 공유 채널은 충돌 회피 위해 별도 이름.)** `nextAgent: lastChannel<AgentName | null>(null)` — 제어 채널, **매 턴 router가 읽은 직후 null로 소비/리셋**(아래).
- **author 선언**: 도메인 채널(`issue`, `verdict`)만.

**⚠️ nextAgent 소비 의미론 (blocker 수정):** core §1.1 "absent keys are untouched (not reset)" 규칙상, 에이전트가 passTo로 `nextAgent`를 쓰면 다음 에이전트가 passTo를 안 해도 값이 *유지*된다 → 기본 router `s.nextAgent ?? END`가 같은 에이전트를 maxTurns까지 무한 반복. **수정: 런타임이 매 턴 router 호출 직후 `nextAgent`를 null로 fold한다(consume-on-read).** 그래야 "이번 턴 passTo 안 함 = null = END"가 성립하고 자기-반복이 방지된다. 같은 이유로 명시 router는 `nextAgent`(소비됨, 1회성)를 *낡은* 도메인 채널(verdict)보다 **먼저** 검사해야 반려 루프가 reviewer로 재진입한다(§3 router).

**한 턴이 state를 바꾸는 법 (= workflow 노드 루프):**
1. `router(state)` → 다음 에이전트 `A` (또는 END). 직후 `nextAgent`를 null로 소비.
2. `A` 실행 — **입력 = 렌더된 read-only state 뷰(공유 transcript + 도메인 채널들의 현재값) + 자기 instructions.** `A`는 내부 think→act→observe 루프를 돌며 자기 툴(+합성 pass_to_* 툴)을 호출.
3. `A` 턴 결과 = 채널 업데이트(이벤트 기록): 항상 자기 대화를 `transcript`에 append; `pass_to_B()` 호출 시 `nextAgent="B"`; `output` 스키마 + `.writes({A: ch})` 매핑 시 `A.output`→`ch`.
4. fold → 1번 (router가 END 또는 maxTurns까지).

**에이전트의 typed-state 접근 (회의론 렌즈 — "untyped ctx bag" 우려 해소):** 에이전트는 LLM이라 *본문*이 없고, state를 **렌더된 텍스트 뷰**로 받아 추론한다. **타입 안전은 가변 bag이 아니라 (a) reducer 선언 채널, (b) router가 *타입드* state로 분기, (c) `.writes` 가 `output ⊑ 채널타입` 컴파일 체크** 하는 경계에 있다. 즉 bell-agent의 "stringly-typed 가변 ctx" 와 달리, 상태는 타입드 채널이고 에이전트는 그 읽기-전용 투영을 볼 뿐 변형하지 않는다.

**도메인 채널 쓰기 (A안):** 에이전트 `output` → `.writes({ agent: channel })` 매핑(선언적). `A.output ⊑ 채널 타입` 컴파일 체크. (v2 탈출구 B "툴이 채널에 직접 쓰기"는 §8 OUT.)

**최종 출력 투영:** `rt.run(...)` 반환 = **`.writes` 단일 매핑 채널의 값 타입** (트리아지 → `verdict` 채널 = `Verdict | null`). **`Verdict`로 좁히지 않음** — verdict 채널은 nullable이고 §9의 미승인/maxTurns 종료에서 null로 끝날 수 있다(정직). 매핑 0개 → 전체 state 스냅샷; 다수 → 전체 state 스냅샷(임의 단일 채널로 조용히 안 좁힘). non-null 보장이 필요하면 `verdict: lastChannel<Verdict>()`(init non-null 강제) 선언 + 런타임 불변식 문서화.

---

## 5. 제어 모델

**한 규칙:** *router가 다음 차례를 정한다. `passTo`는 에이전트가 다음 차례를 **요청**하는 타입드 방법일 뿐.* router가 유일 메커니즘, passTo가 먹인다.

- **passTo 디슈가링**: `agent({ passTo: ["bugFixer"] })` → 그 에이전트 한정 `pass_to_bugFixer()` 툴 합성. 호출 = `nextAgent="bugFixer"` 쓰는 effect(기록). 타깃 이름은 team `agents` 집합에 대해 컴파일 체크(§6, per-slot 브랜드).
- **기본 router** (`.router()` 생략): `(s) => s.nextAgent ?? END`. nextAgent가 **매 턴 소비**되므로 "passTo 요청 있으면 거기로, 없으면 END". passTo만으로 도는 팀은 router 불필요.
- **명시 router**: author 규칙. **`nextAgent`(1회성 핸드오프)를 도메인 채널보다 먼저** 검사하는 것이 권장 패턴(반려 루프 재진입). 트리아지의 verdict→END/되돌림이 여기.
  - **⚠️ silent-drop 주의:** 명시 router가 `nextAgent`를 무시하면 LLM의 `pass_to_X()` 가 no-op이 된다. **v1 규칙: 명시 router는 nextAgent를 반드시 한 번 검사(권장 패턴)하거나, 무시할 거면 그 의도를 주석으로 명시.** (silent ignore footgun 회피 — 회의론 렌즈.)

**시작:** `team({ entry })` 필수. **종료:** router가 `END` 반환(`END`는 리터럴 `"~end"`, `src/index.ts:232` — "브랜드 sentinel" 아님). 안전장치 `maxTurns` 초과 → **런타임 throw `TeamMaxTurnsError` + 로그 종료 이벤트**(부분 state 보존, resume/디버그 가능). **`Step<Name,In,Out,Deps>`에 Err 파라미터가 없으므로**(`src/index.ts:78-94`) 이는 *타입드 Err 채널*이 아니라 런타임 종료다 — v1은 이 범위, "타입드 에러 채널"은 v2(Step에 5번째 파라미터 추가 = ④ seam 등급 신규 위험이라 §8 "신규 타입 위험 0"과 충돌).

---

## 6. 타입 기계장치

대부분 검증된 기계장치 재사용. 신규 위험 1개(passTo 멤버십)는 **Appendix B에서 실제 `tsc 6.0.3` emit으로 닫음**.

- **router 반환** = `keyof Agents | END` → workflow `.branch` 그대로(core §2.6). 오타 → **TS2820 "Did you mean 'bugFixer'?"**. **이 검사는 passTo 가드와 독립**(inherited 기계장치).
- **Deps 수렴** = team deps = 에이전트 deps 합집합 → core §2.7 `NonNullable<K> & keyof LoopyDeps` 재사용. passTo 합성 툴 = deps 0(absorb).
- **에이전트=노드 In/Out**: 입력 = 렌더된 state 뷰(team이 바인딩); 출력 = 채널 업데이트. `A.output ⊑ .writes 매핑 채널 타입` 컴파일 체크.
- **이름 보존**: `AgentName` 리터럴이 합성 `pass_to_*` 툴 이름·`nextAgent` 값·router 반환을 통과해도 보존(seam pos① `"repo"` 보존 동형).
- **레지스트리 충돌 가드**: `agents`는 *객체 맵*이라 키 중복은 native TS1117(§2.4 tuple `DuplicateNameCheck` 아님 — 그건 tuple 전용). `defineLoopy`는 §2.8 `keyof A & keyof W extends never` 가드를 **새 `teams` 범주까지** 확장(`keyof A & keyof W & keyof T`).

**✅ #1 위험 = CLOSED (Appendix B, 실측):** passTo 멤버십 가드. **결정: 후보 (ii) — 이름-캡처 + per-slot 브랜드 가드.** 세 후보를 실제 컴파일해 비교한 결과:
- **(ii) 채택** — passTo가 타깃 *이름*을 phantom 유니온 `Pass`로 캡처(`~deps` 가 dep 유니온 나르는 것과 동형), team()에서 per-slot 브랜드로 `[Exclude<PassToOf<A>, keyof Agents>] extends [never]` 검사. **유일하게 순환 살아남고**(이름이라 값 순환 없음), passTo를 **에이전트에 유지**(정체성), 각 에이전트 타깃을 타입에 보존(pos①/③ 실현), **양쪽 빌드 .d.ts 깨끗**(TS2742 없음). 진단 = TS2322 브랜드(위반 에이전트+낯선 타깃 지목; "Did you mean"은 아님 — 멤버십 집합이 team()까지 없으므로 본질적 cross-time 세금).
  - **두 §2.x 규율 필수**(둘 다 여기서 재현 확인됨): ① 추출기는 `NonNullable<P>`(constrained `infer ... extends string` 쓰면 passTo-없는 reviewer가 `string`으로 fallback → 유효 팀 오탐 = §2.7 DepsOf 버그 재현). ② 게이트는 `[Exclude<…>] extends [never]` tuple-wrap(naked `extends never`는 never 분배 오작동 = §2.7 `[Missing]` 교훈).
- **(i) 거부** — team-레벨 `edges`. 진단은 최고(TS2820)지만 passTo가 에이전트에서 사라져 **pos① 불가**(에이전트 타입이 타깃 정보 무보유) + 헤드라인 ergonomic 삭제.
- **(iii) 거부(치명)** — 값-import. **순환 핸드오프에서 컴파일 불가**(TS7022/2448/2454) — 앵커의 reviewer⇄담당자 루프를 못 표현.

**비용(수용):** 이름 문자열은 agent() 시점엔 미검증(team()에서 잡힘), IDE rename-symbol 미전파. v1 수용, rename 코드젠/lint는 v2.

---

## 7. 이벤트소싱 / replay / HITL

**전부 잠긴 ③ 런타임 상속 — 신규 durability 0.**
- 모든 턴·툴콜(passTo 포함)·채널 변화 = 기록 이벤트 → **replay = fold, LLM 0**.
- **HITL**: 에이전트가 `ctx.interrupt(payload)` 호출 → 중단+checkpoint, `runtime.resume(threadId, value)` → 사람 답 주입, 멈춘 자리에서 계속.
  - **⚠️ ctx 위치 (수정):** 잠긴 `AgentCtx<D> = { deps }` 엔 interrupt가 없고 `interrupt`는 `NodeCtx`에 있다(`src/index.ts:24-33`). **team이 에이전트를 노드로 환원하면 그 run-ctx는 `NodeCtx` 형태여야** reviewer가 HITL 가능. 또한 **output-only 에이전트(본문 없음)는 interrupt를 부를 자리가 없으므로**, reviewer는 interrupt를 호출하는 **툴**(`requestApproval`)을 가진다(§3). emit은 pos⑤로 "team 안 reviewer ctx가 `interrupt<T>` 노출"을 검증.
- **passTo가 effect(기록)인 게 결정적 값**: prose 파싱이었으면 replay 비결정. 버튼이라 cache-hit 0-I/O 재생(core §1 effectId 동기 할당 정합).
- **DevTools 데이터소스**: team의 turn/passTo/channel-diff 이벤트가 그대로 타임라인·그래프에 흐름 — team이 dev 웹 north-star 위해 추가로 할 일 0.

---

## 8. v1 스코프 (YAGNI)

**IN**: `team({ name, state, agents, entry, maxTurns? })` + 선택 `.router()`/`.writes()`. passTo 이름-캡처 sugar(합성 툴 + 기본 router + 멤버십 가드). 자동 `transcript`·`nextAgent`(소비형) + author 도메인 채널. output→채널 매핑(A안). replay·resume·interrupt(③ 상속). 전체 타입 체크(router TS2820, passTo per-slot 브랜드, deps 수렴, output⊑채널).

**OUT (명시적 컷)**:
- ❌ 병렬/동시 에이전트(fan-out) → v2. v1 = 턴당 활성 1명.
- ❌ 중첩 team → v2.
- ❌ 런타임 동적 에이전트 생성 → 비범위.
- ❌ 에이전트 간 사설 직접 메시지 → 비범위(전부 transcript 경유).
- ❌ `passTo` 구조화 인자(handoff payload) → v2. v1 = 인자 없는 제어 이양.
- ❌ 에이전트별 사설 scratchpad 채널 → v2.
- ❌ 툴이 team 채널 직접 쓰기(§4 B안) → v2.
- ❌ **타입드 Err 채널**(maxTurns 등) → v2 (Step에 Err 파라미터 추가 필요 = 신규 타입 위험).
- ❌ passTo 이름 IDE rename 전파 / `loopy/passto-names` lint → v2.

---

## 9. 에러 & 엣지

- **router 잘못된 키** → 컴파일 TS2820(런타임 도달 불가).
- **passTo 비멤버 타깃** → 컴파일 TS2322 per-slot 브랜드(§6).
- **maxTurns 초과** → 런타임 throw `TeamMaxTurnsError` + 로그 종료 이벤트, 부분 state 보존.
- **에이전트 턴 throw** → team 호출자로 전파(런타임). 부분 state 보존.
- **무진전 교착**: nextAgent 소비형이라 기본 router는 안전 END. 명시 router가 *방금 끝낸 에이전트*를 다시 반환하면 무한 가능 → **maxTurns backstop**(검증 렌즈가 maxTurns를 load-bearing으로 확정 — 컷 금지).
- **반려인데 assignee 미산출**: VerdictSchema discriminated union이므로 `approved:false`면 `assignee` 필수 → 스키마가 누락 차단. (구 `assignee?` + `!` undefined-반환 버그 제거.)
- **`.writes` 0/다수**: 전체 state 스냅샷 투영(단일 채널 silent-pick 금지).
- **entry 미지정** → 컴파일 TS2741.
- **reviewer가 verdict 없이 종료**: nextAgent 소비 후 null + verdict null → router 마지막 `return END`. (명시 router가 다루도록 작성; maxTurns backstop.)

---

## 10. 미검증 리스크 & 프로토타입 검증 계획 (seam-style) — HARDENED

> 구현 전 메인(Opus)이 `.d.ts`/hover 직접 판독(subagent 클레임 불신 — MEMORY "Subagent claim은 evidence 아님"). ④ seam 프로토콜: `team-consumer.ts` 컴파일단언 + `dist-examples/**.d.ts` 손-판독 + `_negative.ts`@`tsconfig.negative.json` 진단.

### Gate #0 — 단언 작성 전 닫을 두 API 결정 (BLOCKER)
1. **team-에이전트 shape**: 잠긴 `agent(def)`는 `input`/`output` 필수 + `passTo` 없음(`src/index.ts:180-194`). → **결정: `agent()` 확장** — `passTo?: readonly string[]` 추가, team-노드 사용 시 `input` 옵셔널(team이 state 뷰로 바인딩). (대안: 별도 `teamAgent()` — 정체성상 비채택.) 이 선택이 모든 fixture 형태를 정함.
2. **team 노드 ctx에 `interrupt` 노출**: 에이전트의 run-ctx가 `NodeCtx` 형태여야 HITL 가능(§7). pos⑤로 검증.
3. **채널 표기**: fixture는 잠긴 `lastChannel`/`listChannel`로 작성(자동 `transcript = listChannel<Msg>()`, `nextAgent = lastChannel<AgentName|null>(null)`).

### 10.1 Positive (P1–P7) — `examples/team.ts` + `examples/team-consumer.ts` + 손-판독 `.d.ts`
헬퍼는 잠긴 seam과 동일 (`Expect<Equal<>>`).

- **P1 passTo 합성 툴 named 생존**: `keyof PassToolNames<PassToOf<typeof triage>> ≡ "pass_to_bugFixer" | "pass_to_docsWriter"`. 잘못된 타깃은 툴 부재. (.d.ts에 리터럴 박힘, anonymous blob 금지 — seam pos① 동형.)
- **P2 router 반환 유니온 완전 전개 (교정: `"triage"` 포함)**: `TeamRouterReturn<typeof prTriage> ≡ "triage"|"bugFixer"|"docsWriter"|"reviewer"|"~end"`. (구 pos② 가 entry `"triage"` 누락 → 교정. `END`=리터럴 `"~end"`.) **passTo 가드와 독립인 inherited `.branch` 검사.**
- **P3 자동 채널 named 생존**: `S["nextAgent"] ≡ AgentName|null`; `S["transcript"] ≡ readonly Msg[]`; `S["verdict"] ≡ Verdict|null`(author 채널도 seam④ 동형).
- **P4 `rt.run` 입출력 좁힘**: `demoTriage(): Promise<Verdict | null>` (단일 `.writes` 투영 — `| null` 정직); 입력 `InputOf<...["prTriage"]> ≡ { issue: Issue }`.
- **P5 team 안 ctx `interrupt<T>` 노출 + resume 타입 라운드트립** (결함 2 닫음): reviewer run-ctx가 `NodeCtx`라 `interrupt: <T>(payload)=>Promise<T>`; resume value 타입 `Approval` named 생존(seam④ 동형).
- **P6 `.writes` 0/다수 → state 스냅샷** (§9, 구 §10 미커버): 반환이 임의 단일 채널로 조용히 안 좁혀짐.
- **P7 deps 수렴 + passTo 합성 툴 absorb**: `RequiredDeps<{prTriage}> ≡ "repo"`; passTo 추가가 유니온 안 넓힘.

### 10.2 Must-error (N1–N5) — `_negative.ts` 확장, `tsconfig.negative.json`
- **N1 router 비멤버 키 → TS2820** "Did you mean 'bugFixer'?". (inherited `.branch`, seam neg① 동형.)
- **N2 passTo 비멤버 타깃 → TS2322 per-slot 브랜드** — 위반 에이전트 슬롯에 `"~passToTargetNotInTeam": "bugFxr"` 누락 에러. (후보 (ii) 측정 확정 — Appendix B. map-level 브랜드는 전체 객체 덤프라 비채택.)
- **N3 agent `output` ⊄ `.writes` 채널 타입 → TS2322** 비할당. (reviewer.output 을 불완전 스키마로 두고 `.writes({reviewer:"verdict"})`.)
- **N4 `entry` 미지정 → TS2741** 필수 필드 누락.
- **N5 `.writes` 비존재 채널 키 → TS2820** "Did you mean 'verdict'?". (채널 키 오타도 회귀 표면.)

### 10.3 완료 게이트
Gate #0 해소 후 **P1–P7 + N1–N5(또는 측정 동등)** 전부 메인 직접 판독 통과해야 구현 착수. **잔여 미검증(§2.9 류)**: `PassToolNames ∘ PassToOf` 가 *10-에이전트* team .d.ts에서 hover-clean한지 — 4-에이전트 emit은 깨끗(Appendix B 실측), full-size emit만 최종 확인. + **isolatedDeclarations ON(메인터 빌드)에서 `team()` 반환이 TS9010/TS2742 없이 emit**(소비자 OFF 판독과 별개 게이트).

---

## 11. 테스팅 전략 (team 특이) — HARDENED

자매 spec `2026-06-30-testing-design.md`의 녹화→재생(골든 로그) 재사용. team이 엔진에 가하는 **단 하나의 신규 요구**: 재배정 재진입(같은 에이전트가 다른 턴에 활성).

**team이 record→replay에 더하는 것:** passTo=합성 `pass_to_B()` 툴콜=effect → memo 대상(핸드오프 경로 LLM 0회 결정적 재생). router·`.writes`·`nextAgent ?? entry`·maxTurns 카운팅=사용자/오케스트레이션 코드 → 매 재생 재실행(회귀 표면). content-address 키 `node`=그 턴 활성 에이전트 키.

> ⚠️ **엔진 요구:** 재배정 루프(reviewer→reject→bugFixer **2회차**)에서 같은 에이전트가 다른 턴에 활성 → 키 `node`만으론 bugFixer@턴1·턴4 effect가 memo 충돌. testing-design `stepEpoch`가 **에이전트 재진입마다 증가**해야 구분. team이 이 불변식을 testing 엔진에 강제하는 첫 프리미티브.

**골든-로그 회귀 매트릭스 (요약):**
- **T1 핸드오프 결정성**: `triage→bugFixer→reviewer→END` 경로 + memo hit==effect count(LLM 0). 회귀: triage instructions 변경 → turn0 model effect divergence.
- **T2 approve→END**: reviewer `{approved:true}` → router END. 회귀: approve 분기 삭제 → 없는 턴 진입 → memo miss.
- **T3 reject→reassign 재진입** (적대 케이스): bugFixer **두 stepEpoch** 각각 memo hit. 회귀: assignee mutate → 다른 담당자 진입; + stepEpoch 미증가 메타테스트(2회차가 1회차 결과 오hit).
- **T4 fallthrough→passTo**: nextAgent 비-null → router 추종. 별도 골든(nextAgent=null)으로 fallback 분기 고정.
- **T5 HITL interrupt/resume**: prefix effects + `Interrupted` + `Resumed(value)` + suffix. 재생 시 사람 프롬프트 0회, suffix 재실행. resume value 타입 `Approval` named.
- **T6 maxTurns backstop**: reject만 반복 → 20턴 → `TeamMaxTurnsError` 종료 이벤트 + 부분 state. (타입 단언 아님 — 런타임 종료 이벤트 단언. §5 결함 참조.)
- **T7 무진전 클린 종료(기본 router)**: nextAgent null → END. 회귀: 명시 router가 방금 끝낸 에이전트 반환 → maxTurns 종료(§9 위험 박제).

**작성자 표면 (testing-design ① 재사용, 신규 0):**
```ts
test("prTriage: bug → fix → approve", async (t) => {
  const r = await t.replay("prTriage", { issue });
  expect(r.output).toEqual({ approved: true, notes: expect.any(String) });
  expect(r.path).toEqual(["triage", "bugFixer", "reviewer"]);  // team 전용 투영
  expect(r.llmCalls).toBe(0);
});
```
- `r.path`(턴별 활성 에이전트열)·`r.turns`·`r.terminal`(END | TeamMaxTurnsError) = team이 replay 결과에 더하는 유일 신규 투영(전부 기존 이벤트 로그 fold).
- **argsDigest 정규화 (testing-design 열린 질문의 team 답)**: `transcript`가 append-only라 모델콜 argsDigest가 전체 대화 해싱하면 앞 턴 변경이 뒷 턴 전부를 divergence로 폭발 → **그 턴 새 suffix만 해싱**(또는 누적 해시 증분)으로 첫 지점 국소화.

---

## 12. LOCKED 결정 정합성 체크

- ✅ "하나의 척추: 모든 것은 Step" — team → workflow → Step.
- ✅ "router-over-shared-state 1급, passTo sugar" — §5.
- ✅ "이벤트소싱 + HITL v1 1급" — §7, ③ 상속, 신규 durability 0.
- ✅ "State = 타입드 채널 집합, reducer 선언" — §4 (잠긴 `lastChannel`/`listChannel`).
- ✅ "함수형 DI, 데코레이터 금지" — §6 deps 수렴.
- ✅ "isolatedDeclarations = 메인터 게이트" — §10.3이 ON(메인터)·OFF(소비자) 분리 검증.
- 🔁 **개명**: `network`→`team`, `handoff`→`passTo`.
- ⚠️ **잠긴 `agent()` 시그니처 확장 (사용자 인지 필요)**: team-에이전트 위해 `agent()`에 `passTo?` 추가 + team-노드 시 `input` 옵셔널 + ctx `interrupt` 노출(Gate #0). 추가적·최소 변경이나 잠긴 프리미티브를 건드리므로 §12에 명시.

---

## Appendix A: 용어

- **`team`**(구 network) — 멀티에이전트 프리미티브.
- **`passTo`**(구 handoff) — 에이전트가 다음 차례를 요청하는 선언, **타깃 이름 문자열**. `passTo:["b"]` → `pass_to_b()` 툴 합성.
- **`nextAgent`** — passTo 툴이 쓰는 예약 제어 채널, **매 턴 router 읽은 직후 소비(null)**.
- **`transcript`** — 공유 대화 채널(`listChannel<Msg>()`). (에이전트 내부 prewired `messages`와 구분.)
- **`entry`** — 첫 차례 에이전트(필수). **`END`** — 종료 리터럴 `"~end"`.
- **`maxTurns`** — 무한 루프 안전장치(런타임 throw + 로그 이벤트, 타입드 Err 아님).
- **`.writes({ agent: channel })`** — output→도메인 채널 매핑(선택).
- **기본 router** = `(s) => s.nextAgent ?? END`. **명시 router** = author 규칙(nextAgent 우선 검사 권장).

## Appendix B: passTo 멤버십 가드 — 타입 실현가능성 (실측 `tsc 6.0.3`)

> 검증 워크플로우가 실제 패키지 shape에 `tsc --strict` + `--isolatedDeclarations`(메인터)/비-isolatedDeclarations(소비자)로 컴파일해 확인. 모든 판정은 실행된 `tsc` 출력.

**B.0 긴장:** passTo 타깃은 `agent()` 시점에 쓰이고, 멤버십 `keyof Agents`는 `team()` 시점에만 존재. 결정적 하위질문 = passTo가 *이름*(문자열)을 캡처하나 *값*(`Agent` 참조)을 캡처하나. **이 선택이 가드 대수가 아니라 feature 성패를 가른다.**

**B.1 후보 (i) team-레벨 `edges`**: `edges?: Partial<Record<keyof Agents, readonly (keyof Agents)[]>>`. 컴파일/emit 깨끗, 진단 최고(**TS2820/2561 "Did you mean"**), 가드 pitfall 없음. **그러나 거부** — passTo가 에이전트에서 사라져 **pos① 불가**(에이전트 타입 타깃 정보 무보유; `edges`는 파라미터라 `Team<>`에서 타입-소거), 헤드라인 ergonomic 삭제.

**B.2 후보 (ii) 이름-캡처 + per-slot 브랜드 ✅ 채택:**
```ts
interface Agent<Name, In, Out, Deps, Pass extends string = never> { readonly "~passTo"?: Pass; /*…*/ }
function agent<…, const Pass extends readonly string[] = []>(def: { …; passTo?: Pass }): Agent<…, Pass[number]>
type PassToOf<A> = A extends { readonly "~passTo"?: infer P } ? NonNullable<P> : never;   // NonNullable 필수
type GuardAgents<Agents> = { [K in keyof Agents]:
  [Exclude<PassToOf<Agents[K]>, Extract<keyof Agents, string>>] extends [never]            // tuple-wrap 필수
    ? Agents[K] : { readonly "~passToTargetNotInTeam": Exclude<PassToOf<Agents[K]>, Extract<keyof Agents, string>> } };
function team<const Name, const Agents extends Record<string, AnyAgent>>(def: { …; agents: Agents & GuardAgents<Agents> }): Team<Name, Agents>
```
- 컴파일 ✅ (passTo-없는 reviewer는 `never`로 흡수 — 오탐 없음). isolatedDeclarations ✅. 소비자 .d.ts ✅ **(i)보다 정보 많음** — 각 에이전트가 타깃을 타입에 보존 → **pos①/③ 실현**. `pass_to_${N}` 템플릿 리터럴 mapped 타입 nameable emit.
- 진단 = **TS2322 브랜드**(위반 에이전트 슬롯 + 낯선 타깃 지목). per-slot이라 10-에이전트도 안 터짐(map-level은 전체 덤프 → 비채택). "Did you mean"은 없음(멤버십 집합이 team()까지 없는 본질적 cross-time 세금).
- **두 §2.x 규율 재현 확인**: ① `NonNullable` 추출(constrained infer면 zero-passTo가 `string` fallback → 오탐, §2.7 DepsOf 버그). ② `[Exclude<…>] extends [never]` tuple-wrap(naked는 never 분배 오작동, §2.7 `[Missing]`).

**B.3 후보 (iii) 값-import + 게이트 (치명, 거부):** **(a)** 값 캡처는 핸드오프 순환에서 컴파일 불가 — `reviewer⇄specialist` 모델링 시 `TS7022`(자기참조 any)/`TS2448`/`TS2454`. 앵커가 *순환을 가지므로* 값-passTo는 앵커 제어 그래프를 못 표현. **(b)** 게이트-on-return은 진단을 소비처로 지연(`TS2345` 구조 불일치, 위반 에이전트도 team도 안 가리킴).

**B.4 결정**: **(ii)** — 유일하게 passTo를 에이전트에 유지 + 순환 생존 + pos①/③ 실현 + 양쪽 .d.ts 깨끗. 비용은 진단 한 등급(TS2322 브랜드)·이름 미검증@agent() — 수용. §2.x 두 규율 그대로.
