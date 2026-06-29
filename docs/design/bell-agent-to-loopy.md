# bell-agent → loopy.js 매핑 (refactor 브랜치 실측 기준)

> 대상: `~/DEV/bell-agent__worktrees/feat/agents-tools-refactor` (가장 정제된 리팩토링 브랜치).
> 목적: **추상적 loopy 설계를 실제 코드에 대고 검증**하고, 프로토타입 seam 테스트에 쓸 **현실적 표면**(10 tool + 5 agent + 2 workflow + registry)을 길어 올리는 것.
> ⚠️ 이건 *리팩토링 플랜이 아니라 매핑 스케치*다. bell-agent를 실제로 바꾸자는 게 아니라, "이 코드를 loopy로 짰다면 어떤 모양인가"를 통해 API 표면을 압박 테스트한다. ③ 런타임 엔진은 이미 LOCKED.

---

## 0. 한 장 요약

bell-agent의 모든 페인이 **하나의 뿌리**에서 나온다: **추상이 없어서 모든 구조가 코드의 부수효과로만 존재한다.** "tool"이 뭔지, "agent"가 뭔지, 데이터가 어떻게 흐르는지, 언제 멈추고 재개하는지가 전부 *함수 호출 순서·가변 객체·문자열·DB 컬럼*에 암묵적으로 인코딩돼 있다. loopy는 이걸 전부 **타입드 1급 구문**으로 끌어올린다.

| bell-agent 페인 | 실측 위치 | loopy 구문 |
|---|---|---|
| "tool"이 3가지 의미로 충돌 | `code-generator.js:13` vs `src/tools/` vs `classifier.js` | **`tool`(model 없음) vs `agent`(model 있음)** 2개 원자 |
| 손코딩 think→act→observe 루프 + 호출 간 history 유실 | `code-generator.js:157` | **`agent()`가 루프·history·tool_result·리트라이 소유** |
| "LLM이 코드 수정"이 2개 메커니즘(SDK 루프 vs `spawn(claude)`) | `code-generator.js:197` / `worker.js:56` | **둘 다 `Step`** — 합성 가능 |
| fail-open 파싱(`"partial"`/`{passed:true}`/`"code"`로 silent 진행) | `sufficiency.js:35`, `classifier.js:204` | **SAP + 타입드 `ParseError`, silent fallback 금지** |
| LLM이 만든 step 문자열 배열 → `stepHandlers[step]()`, 순서 미검증 | `web-handler.js:563` | **`workflow().nodes().flow()` 컴파일 체크 그래프** |
| 가변 untyped `ctx` bag (`ctx.figmaData`…) | `web-handler.js:310` | **타입드 reducer 채널** |
| 라이프사이클 = DB status 문자열 + 수동 재호출 | `jira_jobs.status`, `worker.js:213` | **이벤트소싱 + `ctx.interrupt`/`resume`** |
| 모듈 싱글톤 + inline `require()` (순환 회피) | `claude.js:7`, `worker.js:164` | **`defineLoopy` 타입드 deps (함수형 DI)** |
| progress 2개 메커니즘(ProgressTracker vs emit 클로저) | `handler.js:310` / `web-handler.js:303` | **모든 Step이 step 이벤트 자동 방출** |
| API mismatch가 런타임까지 가서 `git reset`로 폭발 | `handler.js:447` ↔ `code-generator.js:267` | **end-to-end 추론 → 컴파일 에러** |

---

## 1. 현재 구조 한눈에

```
apps/api/src/
├── core/      claude.js · db.js · crypto.js · config.js · queue.js   ← substrate, 크레덴셜 0
├── tools/     figma · jira-client · vercel · secret · git            ← capability (의미 B)
└── agents/
    ├── design/  classifier · file-analyzer · code-generator · builder · docs-reader · handler · web-handler
    └── jira/    gate · preprocess · sufficiency · worker · store · trigger
```

경계 스크립트(`scripts/check-boundaries.mjs`)가 강제하는 6규칙의 핵심 3개:
`core ↛ {agents, tools}` · `tools ↛ agents` · `design ⊥ jira`. (→ §4에서 loopy가 이걸 어떻게 바꾸는지)

### "tool"의 3가지 의미 — 이게 가장 중요한 발견

| 의미 | 정의 | 실물 | 스키마? | model? |
|---|---|---|---|---|
| **A. LLM-callable tool** | Anthropic `{name, description, input_schema}` — 모델이 루프 중 *고름* | `edit_file`·`create_file`·`read_file` (`code-generator.js:13` 하드코딩 배열, 단 3개) | input만 | ❌ |
| **B. 통합 모듈** | `src/tools/`의 평범한 API/DB 클라이언트 함수 | `figma.fetchFigmaData`·`jira.getIssue`·`vercel.waitForVercelDeployment` | ❌ | ❌ |
| **C. agent 내부 "헬퍼"** | `agents/*/` 안의 함수인데 **Haiku를 직접 호출** | `classifyMessage`·`judgeSufficiency`·`identifyRelevantFiles`·`verifyChanges`·`runBuild` | ❌ | ✅ (숨겨진) |

**의미 B와 C는 구조적으로 구분 불가** — 둘 다 외부 시스템 부르는 평범한 JS 함수, 차이는 *파일 위치뿐*. 그리고 **의미 C는 사실 sub-agent다** (model을 쓰니까). bell-agent는 "model을 쓰는 단위"와 "안 쓰는 단위"를 같은 평면에 뭉개놨고, 그래서 루프·파싱·리트라이가 단위마다 재발명된다.

---

## 2. 핵심 통찰: loopy는 3가지 의미를 정직한 2개 원자로 접는다

LOCKED 결정 그대로:
- **`tool` = model 없는 LLM-callable 함수.** input/output 스키마 필수. deps 선언. (의미 A + 의미 B의 "순수 I/O" 부분)
- **`agent` = model 있는, 루프를 소유한 단위.** (의미 C 전부 + 의미 A의 루프 소유자였던 `generateCodeChanges`)
- 둘 다 **`Step`** → 합성 가능. "model 쓰는 tool"이 필요하면 그건 sub-agent이고, `Step` 슈퍼타입(비준 완료) 덕에 `tools:[...]`에 그냥 넣는다.

### bell-agent 함수 → loopy 단위 매핑

| bell-agent | → | loopy 단위 | deps | model |
|---|---|---|---|---|
| `edit_file` / `create_file` / `read_file` | → | **`tool`** ×3 | `repo` | — |
| `figma.fetchFigmaData` | → | **`tool`** | `figma` | — |
| `jira.getIssue` / `addComment` / `transitionTo` | → | **`tool`** ×3 | `jira` | — |
| `vercel.waitForVercelDeployment` | → | **`tool`** | `vercel` | — |
| `git.ensureRepoAt` | → | **`tool`** | `git` | — |
| `gh pr create` (worker runPhaseB) | → | **`tool`** `openPR` | `gh` | — |
| `eas.publishPreview` | → | **`tool`** | `eas` | — |
| `classifyMessage` | → | **`agent`** `classifier` | — | haiku |
| `judgeSufficiency` | → | **`agent`** `sufficiency` | — | haiku |
| `identifyRelevantFiles` | → | **`agent`** `fileAnalyzer` | `repo` | haiku |
| `verifyChanges` | → | **`agent`** `verifier` | `repo` | haiku |
| `generateCodeChanges` (루프!) | → | **`agent`** `codeGen` (tools: edit/create/read) | `repo` | sonnet |
| design 파이프라인 (stepHandlers) | → | **`workflow`** `designFlow` | — | — |
| jira 파이프라인 (trigger.js) | → | **`workflow`** `jiraFlow` (interrupt ×2) | — | — |

→ **tool 10개 + agent 5개 + workflow 2개 + `defineLoopy` 레지스트리.** 이게 그대로 프로토타입 seam 테스트 표면이 된다(§6).

---

## 3. 페인 → loopy 구문 (before/after)

### 3.1 손코딩 루프 + 호출 간 history 유실 → `agent()`가 루프를 소유

**Before** — `code-generator.js:157` 손코딩 think→act→observe:

```js
// generateCodeChanges 내부
let messages = [{ role: "user", content: firstMessageContent }]; // :191  매 호출 재초기화
let iterations = 0;
while (iterations <= MAX_READBACKS) {                            // :195  MAX_READBACKS=10
  const response = await callSonnet(WIZKEY_SYSTEM_PROMPT, messages, TOOLS); // :197
  const { changes, readRequests } = parseToolCalls(response);   // :113  block.name 수동 분기
  if (!hasToolUse) break;
  messages.push({ role: "assistant", content: response.content });        // :213
  // ... edit_file/create_file/read_file 각각 applyChanges 후 tool_result 조립
  messages.push({ role: "user", content: toolResults });                  // :262
  iterations++;
}
```

**버그(spec #2 실물):** `handler.js`는 `generateCodeChanges`를 한 요청에 **여러 번**(`:447`, `:499`, `:557`, `fixBuildError:587`) 부른다. 매 호출이 `messages`를 단일 user 메시지로 재초기화(`:191`) → **이전 호출에서 뭘 적용했는지 모델이 모름** → 충돌·중복 편집. 호출 간 컨텍스트는 500자로 잘린 텍스트 요약(`handler.js:644`)뿐.

**After** — loopy: 루프는 `agent()` 소유, history는 **append reducer 채널**로 런타임이 누적:

```ts
export const codeGen = agent({
  name: "code-gen",
  model: "sonnet",                         // model은 agent 전용 (tool엔 없음)
  instructions: WIZKEY_SYSTEM_PROMPT,
  tools: [editFile, createFile, readFile], // 값-import, 곧 LLM 매니페스트
  output: z.object({ applied: z.array(Change), failed: z.array(Failure) }),
  deps: ["repo"],
  stopWhen: stepCountIs(10),               // MAX_READBACKS가 값이 됨
});
// agent는 messages/phase/steps/pendingToolCalls/lastError 채널을 prewire —
// 작성자가 절대 손대지 않는다. think→act→observe가 채널 위 노드 전이라
// "호출 간 history 유실" 버그가 구조적으로 불가능.
```

호출 간 연속성이 필요하면 같은 `threadId`로 재진입 → 런타임이 로그에서 messages를 fold해 복원. 손으로 messages 배열을 들고 다니지 않는다.

---

### 3.2 "LLM이 코드 수정"이 2개 메커니즘 → 둘 다 그냥 `Step`

**Before** — 같은 일("LLM이 파일 편집")이 **두 가지 완전히 다른 방식**:

```js
// design: raw SDK tool-use 루프  (code-generator.js:197)
const response = await callSonnet(system, messages, TOOLS);
// → parseToolCalls → applyChanges 직접

// jira: claude CLI 서브프로세스  (worker.js:56)
const child = spawn("claude",
  ["-p", "--permission-mode", "bypassPermissions", "--append-system-prompt", sys],
  { cwd, env: { ANTHROPIC_API_KEY, GITHUB_TOKEN } });
child.stdin.end(prompt);   // 단발, 루프 없음, history 없음, 커밋 유무로 성공 판정
```

**After** — loopy에선 둘 다 `Step<In, Out>`. 하나는 in-process agent, 다른 하나는 외부 프로세스를 부르는 tool로 감싸도 **같은 자리에 합성**된다:

```ts
const claudeCli = tool({                   // 서브프로세스도 그냥 tool
  name: "claude-cli-implement",
  input: z.object({ repoPath: z.string(), prompt: z.string() }),
  //   예: { repoPath: "/tmp/repos/sleepthera",
  //         prompt: "PROJ-142 구현: 온보딩 3번째 화면에 '건너뛰기' 버튼 추가\n수용조건: ..." }
  //   → run의 첫 인자가 이 타입으로 추론됨 ({ repoPath: string; prompt: string })
  output: z.object({ committed: z.boolean(), sha: z.string().nullable() }),
  //   예 성공: { committed: true,  sha: "a1b2c3d" }
  //   예 실패: { committed: false, sha: null }   ← 커밋 없음=구현 실패. silent "success" 아니라 타입드 결과
  //   → workflow 라우터가 s.committed 로 명시 분기 (fail-open 불가)
  deps: ["shell"],
  // idempotencyKey: 크래시 시 재실행 대비 (멱등성 계약)
  run: async ({ repoPath, prompt }, { deps }) => deps.shell.claude(repoPath, prompt),
});

// 이제 design은 codeGen agent를, jira는 claudeCli tool을 쓰지만
// 둘 다 workflow 노드 자리에 동일하게 들어간다. "두 가지 방식"이 아니라
// "같은 Step 인터페이스의 두 구현"이 된다.
```

---

### 3.3 fail-open 파싱 → SAP + 타입드 `ParseError`, silent fallback 금지

**Before** — `sufficiency.js:35` 정전(canonical) 사례:

```js
function failOpenVerdict() {
  return { verdict: "partial", missing: [], assumptions: ["충분성 판정 실패 — best-effort 진행"], comment: "" };
}
function parseVerdict(raw) {
  try {
    const jsonText = raw.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(jsonText.slice(jsonText.indexOf("{"), jsonText.lastIndexOf("}") + 1));
    if (!["sufficient","partial","insufficient"].includes(parsed.verdict)) throw new Error();
    return parsed;
  } catch { return failOpenVerdict(); }   // ← 모든 파싱 에러를 "partial"로 삼킴 → 코드작업 진행
}
```

`verifyChanges`(`classifier.js:204`)는 catch→`{passed:true}` (검증 실패=통과), `classifyMessage`(`:59`)는 catch→`"code"` (가장 공격적 폴백). **실패가 결과로 위장한다.**

**After** — loopy: 자체 Schema-Aligned Parsing이 마크다운/trailing-comma를 교정하되 **정적 타입은 정직**하게, 실패는 **타입드 `ParseError`로 표면화**:

```ts
export const sufficiency = agent({
  name: "sufficiency",
  model: "haiku",
  instructions: SUFFICIENCY_PROMPT,
  output: z.object({
    verdict: z.enum(["sufficient", "partial", "insufficient"]),  // 문자열이 enum 타입이 됨
    missing: z.array(z.string()),
    assumptions: z.array(z.string()),
    comment: z.string(),
  }),
});
// agent의 구조화 출력은 SAP를 통과한다. 파싱 실패는 silent "partial"이 아니라
// 타입드 ParseError 이벤트로 로그에 남고, 워크플로 라우터가 명시적으로 처리한다:

jiraFlow.flow(b => b
  .branch("sufficiency", s =>
    s.verdict === "insufficient" ? "needsInput" :   // fail-open 아님 — 명시 분기
    s.verdict === "partial"      ? "implement"  :
                                   "implement"));
// 파싱 자체가 실패하면? 그건 verdict 채널이 안 채워지는 것 → 라우터가 결정하지 못해
// 런타임이 ParseError로 멈춘다. "성공으로 위장"이 타입·런타임 양쪽에서 불가능.
```

---

### 3.4 stringly-typed step 디스패치 + 가변 ctx bag → 타입드 그래프 + 채널

**Before** — `web-handler.js`: Haiku가 step **문자열 배열**을 만들고, `stepHandlers` 맵으로 디스패치, 데이터는 **가변 untyped `ctx`**:

```js
// plan.steps = ["analyze_files","generate_code","build","verify","push","deploy"]  (:60, Haiku 생성)
const ctx = { /* 빈 객체 리터럴, 타입 없음 */ };                      // :310
const stepHandlers = {                                              // :362
  fetch_figma:   async () => { ctx.figmaData = await fetchFigmaData(msg); },     // :370 쓰기
  analyze_files: async () => { ctx.relevantPaths = ...(ctx.figmaData); },        // :379 읽기
  generate_code: async () => { ctx.appliedChanges = ...(ctx.fileContents); },    // :418
  push:          async () => { ctx.pushTimestamp = Date.now(); },                // :543
  deploy:        async () => { await waitForVercel(ctx.pushTimestamp); },        // :555 읽기
};
for (let i = 0; i < totalSteps; i++) {                              // :563
  const handler = stepHandlers[plan.steps[i]];
  if (!handler) { console.warn(`알 수 없는 단계: ${step}, 스킵`); continue; } // 미지 step 조용히 skip
  await handler();                                                  // 순서 미검증
}
```

문제: ① step 이름 오타는 런타임 skip(컴파일 무력) ② `ctx.figmaData`가 채워지기 전에 `analyze_files`가 읽어도 타입이 안 막음 ③ 누가 어떤 채널을 덮어썼는지 추적 불가.

**After** — loopy: **노드는 값**, 엣지/라우터는 컴파일 체크, 데이터는 **reducer 선언된 타입드 채널**:

```ts
const designFlow = workflow({
  name: "design-flow",
  state: {
    figma:    lastChannel<FigmaData | null>(null),
    files:    lastChannel<FileContents | null>(null),
    changes:  channel(reducers.append<Change>()).initial(() => []),
    pushedAt: lastChannel<number | null>(null),
    build:    lastChannel<BuildResult | null>(null),
  },
})
  .nodes({ fetchFigma, fileAnalyzer, codeGen, build, verify, push, deploy }) // 키 전부 미리 알려짐
  .flow(b => b                                  // ← 2단계 (비준 완료): forward-ref 누수 없음
    .start("fetchFigma")
    .edge("fetchFigma", "fileAnalyzer")
    .edge("fileAnalyzer", "codeGen")
    .edge("codeGen", "build")
    .branch("build", s => s.build?.ok ? "verify" : "codeGen") // 빌드 실패 → 코드젠 사이클(타입드)
    .branch("verify", s => s.verified ? "push" : "codeGen")
    .edge("push", "deploy")
    .edge("deploy", END));
// 오타 .edge("codeGen","buidl") → TS2820 "Did you mean 'build'?"
// figma 채널은 fetchFigma가 채우기 전엔 null 타입 — 읽는 쪽이 null 처리를 강제당함.
```

`stepHandlers` 맵 + `for` 루프 + 가변 `ctx`가 통째로 **선언적 그래프 + 타입드 채널**로 치환된다. 순서·존재·타입이 전부 컴파일 시점에 산다.

---

### 3.5 라이프사이클 = DB status 문자열 → 이벤트소싱 + `interrupt`/`resume`

**Before** — jira: 상태가 `jira_jobs.status` 문자열로 살고, HITL는 사람이 별도 HTTP를 쳐야 이어짐:

```js
// 상태 진행: queued → running → needs_input | awaiting_base → pr_created | failed
await store.updateJob(jobId, { status: "running" });        // worker.js:177
// ... Phase A: 클론·claude·push·Jira transition ...
await store.updateJob(jobId, { status: "awaiting_base" });  // worker.js:213  ← 여기서 멈춤
// 사람이 대시보드에서 base 브랜치 고르고 POST /api/jobs/:id/create-pr  (routes.js:56)
async function runPhaseB(jobId, baseBranch) {               // worker.js:274  ← 완전히 별개 진입점
  // gh pr create --draft → status "pr_created"
}
```

문제: ① Phase A→B 사이를 잇는 자동화가 없다(사람이 수동 재호출) ② "awaiting_base에서 멈춤"이 status 문자열 + JSONB `context`에 손으로 인코딩됨 ③ 재시작·replay·audit 없음 ④ design 경로는 `/tmp/...json` flat-file이라 크래시 복구 0.

**After** — loopy: 일시정지는 **위치+채널+pending effect의 데이터**, 재개는 같은 그래프 재진입:

```ts
const jiraFlow = workflow({ name: "jira-flow", state: { /* verdict, branch, baseBranch, prUrl ... */ } })
  .nodes({ gate, preprocess, sufficiency, needsInput, implement, awaitBase, openPR })
  .flow(b => b
    .start("gate")
    .edge("gate", "preprocess")
    .edge("preprocess", "sufficiency")
    .branch("sufficiency", s => s.verdict === "insufficient" ? "needsInput" : "implement")
    .edge("implement", "awaitBase")
    .branch("awaitBase", s => "openPR")   // resume 후 진행
    .edge("openPR", END));

// awaitBase 노드 본문 — 사람 입력을 1급 구문으로:
const awaitBase = step(async (s, ctx) => {
  const { baseBranch } = await ctx.interrupt<{ baseBranch: string }>({
    kind: "pick-base-branch", branch: s.branch,
  });   // ← InterruptRaised 로그 기록 후 run()이 반환, 프로세스 종료 가능
  return { baseBranch };
});
// 사람이 고르면 (며칠 뒤, 새 프로세스라도):
runtime.resume(threadId, { baseBranch: "release/1.4" });
// load+fold (LLM 0회 재호출) → awaitBase 재진입 → interrupt가 이번엔 값 반환 → openPR로 진행
```

`status` 문자열 머신, 수동 `/create-pr` 재호출, `/tmp` flat-file, 크래시 복구 부재가 **하나의 이벤트소싱 + interrupt/resume**으로 통합된다. 게다가 커밋된 로그가 *사람 승인까지 포함한 결정적 회귀 테스트*가 된다.

---

### 3.6 모듈 싱글톤 + inline require → `defineLoopy` 타입드 deps

**Before** — 모든 외부 클라이언트가 모듈 레벨 싱글톤, 순환 회피용 inline `require()`:

```js
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }); // claude.js:7  싱글톤
const slackClient = new WebClient(token);   // handler.js:31  (progress.js:4에 또 하나)
function runPhaseA() { const store = require("./store"); /* ... */ }      // worker.js:164  inline require
```

문제: 테스트에서 stub 주입 불가, 크레덴셜이 부팅 시 전역에서 읽힘, 순환 의존을 inline require로 회피(코드 냄새).

**After** — loopy: deps는 **레지스트리 키로 선언**, 런타임이 타입드로 주입(함수형 DI, 데코레이터/reflect-metadata 금지):

```ts
declare module "loopy" {
  interface LoopyDeps {
    repo: GitRepo; figma: FigmaApi; jira: JiraApi; vercel: VercelApi;
    gh: GitHubCli; eas: EasCli; shell: Shell;
  }
}

export const runtime = defineLoopy({
  models: { haiku: claude("haiku"), sonnet: claude("sonnet") },
  deps: {                                    // 한 곳에서 타입드로 조립 — 빠뜨리면 컴파일 에러
    repo: new GitRepo(), figma: new FigmaApi(secret("FIGMA_TOKEN")),
    jira: new JiraApi(...), vercel: new VercelApi(...), gh: new GitHubCli(),
    eas: new EasCli(), shell: new Shell(),
  },
  store: sqliteStore(),                       // 이벤트소싱 체크포인터
  agents: { classifier, sufficiency, fileAnalyzer, verifier, codeGen },
  workflows: { designFlow, jiraFlow },
});

await runtime.run("designFlow", { message: "..." });  // 타입드 진입
```

테스트 프로파일은 `deps`만 stub으로 갈아끼우면 끝(`stubLLM`, in-mem store). inline require·순환 회피가 사라진다.

---

### 3.7 progress 2개 메커니즘 → 모든 Step이 step 이벤트 자동 방출

**Before** — Slack는 `ProgressTracker`(`handler.js:310`, 클로저로 들고 다님), Web는 `emit` 클로저를 손으로 스레딩(`web-handler.js:303`) + WS hub 재시도. 두 메커니즘이 따로 논다.

**After** — 모든 `Step`이 실행 시 step 이벤트를 자동 방출, sink는 플러그형:

```ts
defineLoopy({ /* ... */, sinks: [slackSink(channel), wsSink(requestId)] });
// 작성자는 emit()을 스레딩하지 않는다. 같은 이벤트 스트림이 Slack·WS·로그·미래 DevTools로 동시에 흐른다.
```

(이건 이벤트소싱의 부산물 — 모든 전이가 이미 로그에 남으므로 progress는 그 로그의 view.)

---

## 4. 경계(`check-boundaries.mjs`)는 loopy에서 어떻게 되나

질문이 명시적이었으니 정직하게 답한다. 현재 6규칙 중 핵심 3개를 loopy가 각각 어떻게 바꾸는가:

| 현재 규칙 | loopy에서 | 강제 방식 |
|---|---|---|
| **`tools ↛ agents`** | **대부분 구조적으로 해소** | tool의 `run`은 `(input, ctx)`만 받고 `ctx.deps`는 `Pick<LoopyDeps, 선언키>`뿐 — agent를 *참조할 통로 자체가 없다*. 의존 화살표는 항상 agent→tool(agent가 tool을 값-import). "tool이 agent를 import"는 금지가 아니라 *불필요*. |
| **`core ↛ {agents, tools}`** | **대체로 소멸** | 사용자가 짜는 "core"가 없다 — substrate는 loopy 라이브러리 자체. bell-agent의 `core`(claude·db·crypto)는 loopy 빌트인(model 클라이언트·store) 또는 dep(db)로 흡수. 경계가 *loopy 패키지 경계*로 이동. |
| **`design ⊥ jira`** | **여전히 정책(policy), 타입 사실 아님** — 단, 위반이 *명시적·greppable*해짐 | loopy는 오히려 cross-agent 합성을 *장려*한다(sub-agent-as-tool). design이 jira agent를 쓰면 `tools: [jiraAgent]`로 **정의에 드러난다**. bell-agent에선 가변 ctx·뒤엉킨 import로 *암묵적*이던 결합이, loopy에선 *타입드·명시적*이 된다. |

**결론:** `tools↛agents`와 `core 순수성`은 loopy가 **타입 + 값-import 방향**으로 대부분 구조화한다. **`design⊥jira`(cross-agent 격리)만 정책으로 남는다** — 그러나 그 정책을 위반하면 이제 *레지스트리의 명시적 value-import*로 나타나므로, 경계 린터는 "모든 import 스캔"에서 "레지스트리 수준 정책 단언"으로 **축소**된다. bell-agent가 이 스크립트를 *필요로 했던 이유*(가변 ctx·문자열 디스패치로 결합이 숨음)가 loopy에선 사라지기 때문에, 린터의 *부담*이 근본적으로 낮아진다.

> 즉 loopy는 `check-boundaries.mjs`를 완전히 없애진 않지만(cross-agent 정책은 제품 결정이라 타입이 대신 못 함), 그 스크립트가 막으려던 *대부분의 결합*을 타입 시스템과 합성 모델로 **선제적으로 불가능하게** 만든다.

---

## 5. 타입세이프티가 막았을 실제 버그 (보너스)

탐색 중 발견한 실물 버그 — loopy의 존재 이유를 그대로 증명한다:

`code-generator.js`가 리팩토링되며 `generateCodeChanges`가 이제 변경을 *내부에서 디스크에 적용*하고 `{ appliedChanges, failedChanges }` **객체**를 반환(`:267`). `web-handler.js`는 `codeResult.appliedChanges`로 업데이트됨(`:419`). **그런데 `handler.js`(Slack 경로)는 옛 배열 API 그대로**:

```js
changes = await generateCodeChanges(...);       // handler.js:447  이제 {appliedChanges, failedChanges} 받음
if (changes.length === 0) { /* ... */ }          // :465  undefined === 0 → false, 조기반환 안 됨
await applyChanges(changes, repoPath);           // :477  객체를 builder의 for...of에 → TypeError 못 iterate
// → outer catch(:697) → git reset --hard HEAD → 방금 올바로 적용된 변경을 되돌림
```

**Slack 경로가 리팩토링 갭으로 조용히 깨졌다.** loopy에선 `agent()`의 `output` 스키마가 반환 타입을 고정하므로, 호출부가 배열로 다루면 **컴파일 에러**(TS2339: `Change[]`에 `.length` 다음에 객체 필드 접근 불가, 혹은 `applyChanges` 인자 불일치). end-to-end 추론이 이 클래스의 "API가 바뀌었는데 호출부 하나를 놓침" 버그를 *런타임 git reset이 아니라 빌드에서* 잡는다.

---

## 6. 이 매핑이 프로토타입에 주는 것 (seam 테스트 표면)

§2 매핑이 곧 프로토타입 입력이다 — HANDOFF의 "8~12 tool + 5노드 2단계 workflow + registry"를 *현실 코드에서* 길어 온 것:

- **tools (10):** `editFile`, `createFile`, `readFile` (deps:`repo`) · `fetchFigma` (`figma`) · `getIssue`, `addComment`, `transitionTo` (`jira`) · `waitForDeploy` (`vercel`) · `ensureRepo` (`git`) · `openPR` (`gh`)
- **agents (5):** `classifier` (haiku, output enum) · `sufficiency` (haiku, output union) · `fileAnalyzer` (haiku, deps:`repo`) · `verifier` (haiku) · `codeGen` (sonnet, **tools: edit/create/read**, deps:`repo`) ← sub-agent-as-tool도 1개 끼워 Step 슈퍼타입 emit 검증
- **workflows (2):** `designFlow` (7노드, build↔codeGen·verify↔codeGen 사이클 = 라우터 타입 검증) · `jiraFlow` (interrupt ×2 = HITL 채널 emit 검증)
- **`defineLoopy`:** deps 7개, agents 5, workflows 2 → `rt.run("designFlow", ...)` 타입드

이 표면을 `tsc --emitDeclarationOnly --isolatedDeclarations`로 emit해서 확인할 것(= #1 리스크 "seam"):
1. `ToolDepKeys<codeGen.tools>` = `"repo"`가 `.d.ts`에서 **이름 보존**되는가 (anonymous blob 아님)
2. `defineLoopy`의 `RequiredDeps` 합성이 7-dep 위에서 `TS2742` 없이 나오는가
3. `codeGen`(sub-agent를 tool로 든 agent) hover가 청결한가
4. `jiraFlow`의 interrupt 채널 타입이 경계 넘어 살아남는가

---

## 7. 스코프 정직성

- 이건 **API 표면 검증용 스케치**다. 매핑이 어색하면 bell-agent가 아니라 *loopy API*를 고친다.
- ③ 런타임(이벤트소싱 fold·effects-as-data·interrupt/resume)은 LOCKED, 위 코드의 런타임 의미는 이미 컴파일 증명됨.
- 위 loopy 코드는 *지향 표면*이다 — 프로토타입에서 3개 컴파일 강제 수정(`AnyTool=IO<any,any>`·`Step` 슈퍼타입·`DepsOf NonNullable`)을 적용한 실제 팩토리로 구현해 emit까지 돌릴 때 최종 확정된다.
