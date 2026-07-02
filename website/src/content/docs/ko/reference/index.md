---
title: 개요
description: loopy가 제공하는 기본 단위마다 한 페이지씩 정리했어요. 시그니처, 옵션, 그리고 src/index.ts에서 그대로 가져온 최소 예제까지 담았어요.
---

이 섹션의 각 페이지는 loopy가 내보내는 기본 단위를 하나씩 다뤄요. 실제 시그니처와 함께, `src/index.ts`와 `examples/*.ts`에서 가져온 최소 동작 예제를 담았어요. 여기 나열된 것들은 `team()`을 포함해 전부 오늘 기준 `master`에 있어요. 무엇이 타입 검사를 마쳤고 무엇이 아직 런타임 스텁인지는 [현황과 로드맵](/ko/status-roadmap/)에서 확인하세요.

## 기본 단위

| Export | 설명 |
|---|---|
| [`tool(def)`](/ko/reference/tool/) | 모델 없이 동작하는 `Step`이에요. 의존성을 선언한 능력 하나를 나타내요. |
| [`agent(def)`](/ko/reference/agent/) | 모델을 소유하는 `Step`이에요. 툴과, 선택적으로 핸드오프 대상을 갖는 think→act→observe 루프예요. |
| [`workflow(def).nodes(...).flow(...)`](/ko/reference/workflow/) | 타입이 지정된 데이터 기반 라우터를 가진, `Step` 노드들의 명시적 그래프예요. |
| [`team(def).writes(...).router(...)`](/ko/reference/team/) | 노드로 쓰이는 에이전트들, 공유 트랜스크립트, 핸드오프 슈거를 갖춘 멀티 에이전트를 위한 기본 단위예요. |

## 채널 & 스키마

| Export | 설명 |
|---|---|
| [`io<Out, In>()`](/ko/core-concepts/schemas/) | 정적 입력/출력 타입을 담는, Standard Schema 형태의 캐리어예요. |
| [`lastChannel(init)` / `listChannel()` / `inputChannel()`](/ko/reference/channels/) | 리듀서를 선언한, 타입이 지정된 상태 슬롯이에요. |
| `END` | 라우터(또는 `passTo`가 없는 에이전트)가 실행을 끝내기 위해 반환하는 센티널이에요. |

## 레지스트리

| Export | 설명 |
|---|---|
| [`defineLoopy(def)`](/ko/reference/registry/) | 레지스트리예요. 모든 의존성 요구사항을 하나로 모은 뒤 `run`에 타입을 붙여요. |
| [`loopy(def).provide(...)`](/ko/reference/registry/#점진적-주입-loopydefprovide) | 레지스트리의 점진적 주입 버전이에요. |
</content>
