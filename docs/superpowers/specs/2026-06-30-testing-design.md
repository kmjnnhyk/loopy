# loopy.js 테스팅 전략 — v1 설계

> 2026-06-30 · brainstorming 산출. 다음 단계 = writing-plans 로 구현 플랜.

## 한 줄 정의

**녹화→재생 회귀 테스트**가 v1 핵심. 실제 실행을 한 번 녹화(골든 로그) → 이후 그 로그의 effect(model·tool)를 memo 하고 **사용자 코드(라우터·transition·채널 로직)만 재실행** → 어긋나는 첫 지점을 content-addressed 로 리포트 + 완주 시 output 일치 확인. **LLM 재호출 0회**. LangChain 이 못 하는 차별화.

## 맥락 / 전제 (이미 LOCKED — 이 설계가 새로 만들지 않음)

LLM 앱 테스팅의 3대 난제 = **비결정성(LLM) · I/O(외부) · 상태/루프**. loopy 는 ③에서 답을 갖고 있고, 테스팅은 그 토대를 *작성자 API* 로 노출할 뿐:

- **이벤트소싱** → 녹화 로그 = 결정적 재생(LLM 0회). `core-state-and-types.md` §1.6 "committed log = deterministic regression test, zero mocks".
- **함수형 DI** (§3.6) → deps stub 주입. **순수 transition** (§1.3) → 로직 단위 테스트.
- **same scheduler runs fresh/replay/resume** (§1.5) → 테스트 재생 = resume 의 특수 케이스, 엔진 재사용.

## 확정 결정 (brainstorming)

| 축 | 결정 | 왜 |
|---|---|---|
| **v1 #1 시나리오** | 녹화→재생 회귀 (골든 로그) | 이벤트소싱의 가장 독특한 차별화; "같은 입력→오케스트레이션 회귀" 감지 |
| **재생 범위** | effect(model·tool) **memo**, 사용자 코드만 재실행 | LLM 비결정성 제거 → 제어 흐름 회귀에 집중 (tool 내부는 단위 테스트 영역) |
| **검증 모델** | divergence 첫 지점(content-addressed) + 완주 시 output 일치 | 어디서 갈렸는지 정확히 국소화 + 결과 회귀 둘 다 |
| **작성자 API** | snapshot 스타일 (`t.replay(...)`, `-u` 갱신) | jest 친숙, 최소 보일러플레이트 |

---

## 설계

### ① 작성자 API (snapshot 스타일)

```ts
import { test } from "loopy/test";

test("designFlow: figma → PR", async (t) => {
  const r = await t.replay("designFlow", { message: "add /healthz" });
  //  첫 실행: 실제 run → 로그를 __loopy__/designFlow-figma-pr.log.json 녹화
  //  이후:    골든 로그의 effect(model·tool) memo + 사용자 코드 재실행 → divergence 체크
  expect(r.output).toEqual({ prUrl: "…/pull/42" });
});
//  코드 의도 변경 시: `loopy test -u` 로 골든 re-record
```

- **첫 실행** = 실제 run(LLM/tool 호출) → 이벤트 로그를 골든 파일로 녹화.
- **이후** = 골든 effect memo + 사용자 코드 재실행 → divergence 감지.
- **의도된 코드 변경** = `loopy test -u` (또는 `UPDATE_GOLDEN=1`)로 re-record.
- output assert 는 일반 `expect` (러너는 jest/vitest/bun:test 호환 목표).

### ② 재생 메커니즘 = ③ 런타임 resume 과 동일 코드 (재사용)

테스트 재생은 "전체 로그를 memo 로 주고 fresh suffix 없이 재생"하는 resume 의 특수 케이스. **재생 엔진을 새로 만들지 않는다.**

- effect memo table = 골든 로그의 `ModelCall*`/`Tool*` 결과.
- content-addressed key (§1.7): `hash(node, stepEpoch, callOrdinal, opType, argsDigest)`.
- 재생 중 사용자 코드가 effect 요청 → memo 조회 → **argsDigest 비교**:
  - **일치** → 녹화된 결과 반환 (LLM 0회).
  - **불일치** → `ReplayDivergence` 던짐: `"node build effect #2: expected runBuild(diff=v2) got v1"`. **첫 지점만** 리포트.
- 완주(모든 effect 일치) → 최종 output 을 골든 output 과 비교.

### ③ divergence 가 국소화하는 것

| 코드 변경 | 재생에서 나타나는 것 |
|---|---|
| 라우터 분기 변경 | 다른 노드로 감 → 그 노드 effect 가 골든에 없음 → divergence |
| transition 로직 변경 | effect args 달라짐 → argsDigest 불일치 |
| 채널 fold 변경 | 상태 달라짐 → 후속 effect args 변화 → divergence |

→ **오케스트레이션 로직의 모든 회귀가 첫 divergence 지점으로 정확히 국소화.** bell-agent §5 의 "API 어긋남이 런타임 `git reset` 으로 폭발"이 "테스트에서 effect #2 divergence"로 바뀜.

⚠️ **경계:** tool/agent 의 *내부* 로직 변경은 effect 가 memo 되므로 회귀에 잡히지 **않는다** — 그건 단위 테스트(⑤)가 잡는 층. 회귀가 보는 건 *오케스트레이션*(노드 간 흐름·분기·채널)이지 effect 내부가 아니다. (단, tool 의 *입력 args* 가 바뀌면 argsDigest 불일치로 잡힌다 — 호출 *계약* 회귀는 회귀 테스트, 구현 회귀는 단위 테스트.)

### ④ 테스트 피라미드 위치

| 층 | 무엇 | 메커니즘 | v1 |
|---|---|---|---|
| 단위 | 개별 tool/agent 로직 | stub deps(함수형 DI §3.6) + stubLLM 고정응답 | 토대만 |
| **회귀** | **워크플로/에이전트 오케스트레이션** | **녹화→재생, divergence+output** | ★ 핵심 |
| self-check | 작성자 impurity 탐지 | 녹화 직후 I/O 끄고 re-fold byte-identical (CI, §1.3) | 토대만 |

회귀가 v1 핵심. 단위(stub)·self-check 는 토대(DI·이벤트소싱)에서 거의 공짜지만 v1 스코프는 회귀에 집중.

### ⑤ 단위 테스트 토대 (명시)

- `defineLoopy` 의 deps 를 stub 으로 교체 (이미 함수형 DI — §3.6, 테스트 프로파일).
- LLM 은 `stubLLM(고정 응답 맵)` 으로 교체 (model 클라이언트 자리).
- 개별 `tool.run` / agent 를 직접 호출해 단위 검증.

---

## v1 스코프 경계

✅ **포함** — 녹화→재생(골든 로그) · divergence 첫 지점 리포트 + output 일치 · `t.replay()` snapshot API · `loopy test -u` 갱신 · `loopy/test` 러너 · stub deps·stubLLM 토대

❌ **제외 → v2** — eval(출력 품질 채점/LLM-judge) · 비용/토큰/지연 프로파일 · flaky 자동 격리 · 부분 재생(특정 노드부터) · 골든 로그 diff 뷰어(DevTools 연동)

## 열린 질문 (구현 플랜에서 결정)

- 러너 통합 형태 — 독립 `loopy test` vs vitest/bun:test 어댑터(둘 다? 우선순위?).
- 골든 로그 파일 포맷·위치 규약 (`__loopy__/*.log.json` vs colocation).
- argsDigest 정규화 — 비결정 필드(타임스탬프·UUID) 마스킹 정책.
- stubLLM 매칭 — 프롬프트 정확일치 vs 패턴/순서 기반.
- `-u` 갱신 시 부분 갱신(divergence 이후만) vs 전체 re-record.
