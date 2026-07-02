---
title: "레지스트리: defineLoopy / loopy"
description: 레지스트리는 등록된 모든 것의 의존성 요구사항을 하나로 모은 뒤 run()에 타입을 붙여요 — 그래서 모든 의존성이 채워져야만 컴파일돼요.
---

## `defineLoopy(def)` — 의존성을 미리 공급하는 방식

```ts
export type RunFn<Reg> = <Name extends keyof Reg>(
  name: Name,
  input: InputOf<Reg[Name]>,
) => Promise<OutputOf<Reg[Name]>>;

export interface Runtime<Reg> {
  readonly run: RunFn<Reg>;
}

export function defineLoopy<
  const A extends Record<string, AnyEntry>,
  const W extends Record<string, AnyEntry>,
  const T extends Record<string, AnyEntry> = {},
>(def: {
  agents: A;
  workflows: W & NoKeyCollision<A, W>;
  teams?: T & NoKeyCollision<A & W, T>;
  deps: Pick<LoopyDeps, RequiredDeps<A & W & T>>;
}): Runtime<A & W & T>;
```

`defineLoopy`는 실행하고 싶은 모든 에이전트, 워크플로우, [팀](/ko/reference/team/)과, 이들이 다 함께 필요로 하는 구체적인 의존성 인스턴스를 받아요. `teams`는 선택 사항이에요 — 아래 예제들은 쓰지 않는데, `examples/agents.ts`/`examples/workflows.ts` 어디에도 팀이 없기 때문이에요. 팀을 쓰는 레지스트리는 [team() → 팀 등록](/ko/reference/team/#팀-등록)을 보세요. `RequiredDeps<A & W & T>`는 등록된 모든 것이 (직접, 또는 자신의 툴을 통해) 선언한 모든 의존성의 유니온이에요 — `deps`는 정확히 그 `Pick`을 만족해야 해요. 더도 덜도 말고요. 하나라도 빠뜨리면 에러가 이름을 짚어줘요.

```ts
// examples/_negative.ts — TS2741을 기대해요
export const badRuntime = defineLoopy({
  agents: { classifier, sufficiency, fileAnalyzer, verifier, codeGen },
  workflows: { designFlow, jiraFlow },
  deps: { repo, figma, jira, vercel, git, gh }, // "shell"이 빠졌어요
});
// → TS2741: Property 'shell' is missing in type '{...}' but required in type 'Pick<LoopyDeps, ...>'.
```

`agents`와 `workflows`는 키를 공유할 수 없어요 — `NoKeyCollision<A, W>`가 충돌한 이름을 짚은 컴파일 에러로 `workflows` 파라미터에 표시해요. 그렇지 않으면 `InputOf<Agent & Workflow>`가 조용히 한쪽만 골라 해석해버리거든요. `teams`도 `agents & workflows`를 합친 것에 대해 같은 방식으로 검사돼요.

### `run` 호출하기

```ts
export const runtime = defineLoopy({
  agents: { classifier, sufficiency, fileAnalyzer, verifier, codeGen },
  workflows: { designFlow, jiraFlow },
  deps: { repo, figma, jira, vercel, git, gh, shell },
});

await runtime.run("designFlow", { message: "add /healthz" }); // : Promise<{ prUrl: string }>
await runtime.run("typo", {});                                 // TS2322 — 실제 이름들을 자동완성해줘요
```

`run`의 `name` 파라미터는 `keyof Reg`예요. `input`/반환 타입은 `InputOf`/`OutputOf`를 통해 항목마다 조회돼요. 오타 난 레지스트리 이름은 런타임의 "찾을 수 없음"이 아니라, 자동완성이 붙은 컴파일 에러예요.

## 점진적 주입: `loopy(def).provide(...)`

```ts
export type RunBlocked<Missing extends keyof LoopyDeps> = {
  readonly "~missingDeps": Missing;
};

export interface Loopy<Reg, Missing extends keyof LoopyDeps> {
  provide<P extends Partial<Pick<LoopyDeps, Missing>>>(
    deps: P,
  ): Loopy<Reg, Exclude<Missing, keyof P>>;
  readonly run: [Missing] extends [never] ? RunFn<Reg> : RunBlocked<Missing>;
}

export function loopy<A, W>(def: { agents: A; workflows: W & NoKeyCollision<A, W> }): Loopy<A & W, RequiredDeps<A & W>>;
```

`loopy({...})`는 의존성 주입을 뒤로 미뤄요. `Missing` 타입 파라미터가 *필요한 모든* 의존성으로 시작해서 `.provide(...)`를 호출할 때마다 줄어드는 빌더를 반환해요. `run`은 `Missing`이 `never`로 다 줄어들었을 때만 호출할 수 있어요 — 그 전까지는 타입이 `RunBlocked` 에러 형태이고, 다 줄면 진짜 `RunFn`으로 바뀌어요. 덕분에 의존성 연결을 여러 `.provide(...)` 호출로 나눠서 할 수 있어요(예: 하나는 앱 부팅 시점에, 하나는 요청마다).

```ts
// examples/loopy.ts
export const deferred = loopy({
  agents: { classifier, sufficiency, fileAnalyzer, verifier, codeGen },
  workflows: { designFlow, jiraFlow },
})
  .provide({ repo, figma, jira, vercel })
  .provide({ git, gh, shell });

await deferred.run("designFlow", { message: "x" }); // 두 .provide 호출이 모두 끝나야 컴파일돼요
```

## 다음 단계

- [의존성 주입](/ko/core-concepts/dependency-injection/) — `RequiredDeps`가 어떻게 유도되는지 설명해요.
- [team()](/ko/reference/team/)
