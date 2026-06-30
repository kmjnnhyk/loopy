# loopy.js DevTools (`loopy dev`) — v1 설계

> 2026-06-30 · brainstorming 산출. 다음 단계 = writing-plans 로 구현 플랜.

## 한 줄 정의

로컬 개발 디버깅용 **웹 UI**. loopy 런타임의 step 이벤트 로그를 **라이브·사후 통합**으로 **타임라인+상세·그래프**로 보여주는 **읽기 전용 관찰 도구**. "이벤트소싱이 공짜로 주는 Redux-DevTools급 타임트래블"의 로컬 OSS 구현 — LangSmith 의 로컬 대응.

## 맥락 / 전제 (이미 LOCKED — 이 설계가 새로 만들지 않음)

- **데이터소스 = append-only 이벤트 로그** (`core-state-and-types.md` §1.2). 모든 Step 이 step 이벤트 자동 방출 → **플러그형 `Sink`**. `state = fold(reduce, log)`, 로그가 유일 권위.
- DevTools 는 데이터 파이프라인을 새로 만들지 않는다 — **이미 방출되는 이벤트의 view** 일 뿐. 이게 LangChain 대비 차별화(관측이 부산물)의 실현.

## 확정 결정 (brainstorming)

| 축 | 결정 | 왜 |
|---|---|---|
| **목적** | 로컬 개발 디버깅 (#1 시나리오) | "내 에이전트가 왜 이렇게 동작?"이 가장 즉각적 가치 |
| **형태** | 웹 UI — Bun 로컬 서버 + 브라우저, WS 라이브 | 그래프·타임라인·상세를 리치하게 시각화; 이벤트소싱 데이터를 시각적으로 펼치는 게 차별화 |
| **데이터** | 이벤트 로그 (라이브=커서가 로그 끝, 사후=과거 — 같은 로그) | 라이브/사후/스크럽이 "같은 로그, 다른 fold 범위" → 단일 코드경로 |
| **v1 뷰** | 스텝 타임라인+상세, 그래프 시각화 (**읽기 전용 관찰**) | replay/resume(쓰기·제어) 제외로 스코프 단순화 |
| **아키텍처** | **A) `loopy dev` = 앱 실행기 (in-proc)** | 로컬 dev 에 가장 즉각적; store 영속을 끼워 과거·크래시복구·replay(v2) 토대를 v1 부터 확보 |

---

## §1 — 아키텍처 + 컴포넌트 + 데이터 흐름

```
$ loopy dev ./loopy.config.ts --port 5173

┌─ loopy dev process (Bun) ───────────────────────────────────────┐
│                                                                 │
│   loopy runtime ──step events──▶ devSink (= Sink 구현)          │
│   (앱을 같은                       ├─ store.append(evt)  ◀─영속 │
│    프로세스에서 로드)               └─ wsHub.broadcast(evt) ◀라이브│
│        ▲                                    │                   │
│        │ run(name,input)                    │ WS push           │
│   ┌────┴─────────┐                  ┌───────▼──────────────────┐ │
│   │ trigger      │ ◀──POST /api/run─│ dev server               │ │
│   └──────────────┘                  │  /ws        (라이브)     │ │
│                                     │  /api/threads/:id (과거) │ │
│                                     │  /  (UI 정적 번들)        │ │
│                                     └───────┬──────────────────┘ │
└─────────────────────────────────────────────│───────────────────┘
                                       WS + HTTP │
                                       ┌─────────▼─────────┐
                                       │ browser           │
                                       │  이벤트 → fold →   │
                                       │  타임라인+상세·그래프│
                                       └───────────────────┘
```

### 컴포넌트 경계 (3 단위 · 각각 한 책임)

| 단위 | 책임 | 인터페이스 | 의존 |
|---|---|---|---|
| **devSink** (loopy 코어) | step 이벤트를 store + WS 로 분배 | 기존 `Sink` (LOCKED 플러그형) | store, wsHub |
| **dev server** (Bun) | WS 브로드캐스트 · 과거 쿼리 · run 트리거 · UI 서빙 | HTTP/WS 엔드포인트 | store, runtime |
| **browser app** | 이벤트 → 뷰모델 fold → 렌더 | WS/REST 클라 | dev server |

### 데이터 흐름

- **run 트리거:** dev server `POST /api/run {name, input}` → **in-proc 런타임** `run(name, input)`. dev UI 폼 / curl / 테스트가 이 엔드포인트를 호출. ⚠️ **관찰 대상 = `loopy dev` 가 in-proc 으로 실행한 run 뿐** — 외부 독립 프로세스 run 은 devSink 가 없어 v1 비대상(→ v2 B안 store-구독 관측). 이것이 A안의 경계.
- **라이브:** 런타임 step 실행 → 이벤트 → devSink → `store.append` + `wsHub.broadcast` → 브라우저 WS onmessage → 로컬 로그 append → fold → UI.
- **과거 로드:** 브라우저 `/api/threads/:id` → `store.readLog` → 전체 로그 → fold → UI.
- **타임라인 스크럽:** 로그를 *seq N 까지만* fold → 그 시점 상태 (읽기 전용 시간여행).

### 핵심 통찰 — 브라우저도 `fold` 를 한다

런타임의 `state = fold(reduce, log)` 와 **동형**: 브라우저가 이벤트 로그를 받아 뷰모델로 fold. 라이브·과거·스크럽이 전부 "같은 로그, 다른 fold 범위"라 **단일 코드경로** → Redux-DevTools급 타임트래블이 이벤트소싱에서 공짜로 나옴. (replay=*재실행*은 v2; 스크럽=*기록된 상태 보기*는 v1 으로 충분.)

**런타임은 devSink 가 뭔지 모른다** — 그냥 `Sink` 인터페이스를 받고, dev 모드에서 `loopy dev` 가 devSink 를 주입. 프로덕션은 같은 자리에 다른 sink(B안 관측). 이 경계 덕에 **v1→v2 확장이 sink 교체로 끝남**.

---

## §2 — 뷰 상세 (타임라인+상세, 그래프)

### 레이아웃 (3-pane)

```
┌─ loopy dev · thread th_abc (designFlow) ───────────── ● live ─┐
├───────────────┬───────────────────────────────────────────────┤
│ TIMELINE      │  GRAPH                                         │
│               │   ┌─────┐  ┌──────────┐  ┌───────┐             │
│ ▸ fetchFigma ✓│   │fetch│─▶│fileAnalyze│─▶│codeGen│◀─┐ cycle    │
│ ▸ fileAnalyze✓│   └─────┘  └──────────┘  └───┬───┘  │          │
│ ▾ codeGen   ◀ │                       ┌──────▼─┐    │          │
│   ├ model     │                       │ build  │────┘          │
│   ├ editFile  │                       └───┬────┘ (running)      │
│   └ readFile  │                       ...                      │
│ ▸ build  ⟳    ├────────────────────────────────────────────────┤
│   (running)   │  DETAIL · codeGen  (seq 12, sonnet, 2.4s)       │
│               │   ▾ rendered prompt   system + messages[]       │
│               │   ▾ response  →  { applied:[2], failed:[] }     │
│               │   ▾ tool calls  editFile→{applied} · readFile…  │
└───────────────┴────────────────────────────────────────────────┘
```

좌측 타임라인 / 우상단 그래프 / 우하단 상세.

### 이벤트 → 뷰 매핑 (브라우저 fold reducer)

| 이벤트 | 타임라인 | 상세 | 그래프 |
|---|---|---|---|
| `StepStarted/Ended` | 행 추가, 상태(✓/⟳/✗)·소요 | — | `node` 하이라이트·방문 표시 |
| `ModelCallRequested/Returned` | 스텝 하위 `model` 노드 | 렌더된 프롬프트 + raw응답 + 파싱 output | — |
| `ToolCalled/Returned` | 스텝 하위 tool 행 | args → value | — |
| `StatePatched` | — | 이 스텝이 쓴 채널 (v1=목록, **diff=v2**) | — |
| `InterruptRaised` | 행에 ⏸ 배지 | payload 표시 (**resume=v2**) | 해당 노드 ⏸ |

### 연동 · 그래프 데이터

- 타임라인 스텝 선택 ↔ 그래프 노드 하이라이트(양방향). 그래프 노드 클릭 → 타임라인을 그 노드 스텝들로 필터.
- 타임라인 상단 **스크럽바** = seq 슬라이더 → "seq N 까지 fold" 로 그 시점 그래프 위치·상세 표시.
- **그래프 = 정적 + 동적 겹침:** 정적 구조는 `workflow.nodes()/flow()` 정의(엣지·branch·사이클)에서, 동적 위치는 이벤트 `node` 필드에서. "정의된 그래프 + 실제 밟은 경로"를 표시 → 사이클 라우터(build↔codeGen)가 몇 번 돌았는지 보임.

---

## §3 — 에러처리 · 테스팅

### 에러 처리 (대부분 이벤트소싱이 거저 해결)

| 상황 | 처리 |
|---|---|
| **WS 끊김** | 자동 재연결 → 마지막 수신 `seq` 부터 REST 로 gap catch-up. seq 단조성 → 정확히 이어붙임(중복=무시, 누락=메움). |
| **앱(런타임) 크래시** | devSink 가 이미 store 영속 → 로그 보존. `RunErrored` 이벤트가 타임라인 ✗. dev server 생존. |
| **dev server 크래시** | store 에 로그 남음 → 재시작 후 `/api/threads/:id` 복원. |
| **큰 페이로드** | 타임라인은 요약, 상세 펼칠 때 lazy 로드. |
| **store append 실패** | fail-loud — 영속이 권위이므로 조용히 넘기지 않음(경고 배너). |

### 테스팅

- **브라우저 fold reducer = 순수함수** → 결정적 테스트 핵심. 커밋된 로그 픽스처(이벤트 배열, §1.6 worked log) → 기대 뷰모델.
- **동형성 회귀:** 같은 로그로 *런타임* `fold` state 와 *브라우저* 뷰모델 정합 검증 — 두 fold 어긋나면 잡힘.
- **devSink 단위:** 이벤트 in → `store.append` + `wsHub.broadcast` 호출 검증(mock).
- **e2e:** `loopy dev` 띄워 샘플 워크플로 run → WS 수신 → UI 렌더 (Playwright).

---

## v1 스코프 경계

✅ **포함** — `loopy dev` 앱 실행기 · in-proc devSink(store+WS) · dev server(WS · REST 과거로드 · run 트리거 · static) · 타임라인+상세 · 그래프 · 읽기전용 스크럽(시간여행) · 라이브+사후 통합 · 양방향 연동

❌ **제외 → v2** — 채널 full diff · replay(재실행)+분기 · interrupt UI resume · 프로덕션 관측(B안 store-구독 분리, *같은 Sink 경계로 확장*) · 멀티 thread 비교 · 비용/토큰 집계 · 고급 검색/필터

## 열린 질문 (구현 플랜에서 결정)

- 브라우저 UI 스택 (React+Vite vs 경량) — 구현 시 선택.
- 그래프 렌더링 (React Flow vs 자체 SVG) — 구현 시.
- dev store 기본값 (sqlite vs in-memory) — `loopy dev` 는 in-memory 기본 + 옵트인 sqlite 가 유력.
- 이벤트 직렬화/페이로드 상한 (큰 프롬프트 truncation 정책).
