---
title: 의존성 주입
description: loopy는 함수형 의존성 주입을 사용해요 — 데코레이터도 전역 상태도 없어요. 각 유닛은 자신에게 필요한 의존성 조각만 정확히 선언해요.
---

## 레지스트리: 확장 가능한 인터페이스 하나

loopy에는 DI 컨테이너도, 데코레이터도, `reflect-metadata`도 없어요. 대신 모든 소비자가 TypeScript의 [선언 병합](https://www.typescriptlang.org/docs/handbook/declaration-merging.html)으로 확장하는 인터페이스 하나가 있어요:

```ts
// loopy 자체 안에서:
export interface LoopyDeps {}
```

```ts
// examples/deps.ts — 여러분 앱에서, 의존성을 정의하는 경계 지점에 딱 한 번:
export interface GitRepo {
  read(path: string): Promise<string>;
  write(path: string, content: string): Promise<void>;
  find(query: string): Promise<readonly string[]>;
}
// ...

declare module "loopy" {
  interface LoopyDeps {
    repo: GitRepo;
    figma: FigmaApi;
    jira: JiraApi;
    vercel: VercelApi;
    git: GitCli;
    gh: GitHubCli;
    shell: Shell;
  }
}
```

이렇게 확장하고 나면 `keyof LoopyDeps`는 여러분의 앱이 선언한 모든 의존성 이름의 리터럴 유니온이 돼요. loopy 어디에 있는 `deps: [...]` 배열이든 이 유니온을 기준으로 검사되고, 자동완성도 붙어요.

## deps는 왜 *추론*이 아니라 *선언*일까요

loopy가 툴의 `run` 본문을 들여다보고 `deps.repo.read(...)`를 발견해서 이 툴에 `"repo"`가 필요하다고 추론해 주면 좋겠지만, TypeScript는 그렇게 할 수 없어요. 타입 추론은 선언된 매개변수 타입에서 함수 본문 *안으로* 흘러 들어갈 뿐이고, 본문 안의 사용처에서 *바깥으로* 흘러나오지는 않거든요. 그래서 loopy는 정직한 방식을 택해요. **유닛에 필요한 의존성 조각을 `LoopyDeps`의 문자열 리터럴 키 배열로 직접 선언해요.** `ctx.deps`, 에이전트가 누적한 의존성 유니온, 레지스트리가 요구하는 의존성 집합까지, 그 아래 모든 것이 이 선언 하나에서 `Pick`, `|`, `Exclude`로 유도돼요. 런타임 리플렉션은 어디에도 없어요.

```ts
// examples/tools.ts
export const editFile = tool({
  name: "editFile",
  description: "Apply a find/replace edit to a file.",
  input: io<{ path: string; find: string; replace: string }>(),
  output: io<{ applied: boolean }>(),
  deps: ["repo"],
  run: async (i, { deps }) => {
    // deps : Pick<LoopyDeps, "repo">. deps.figma를 쓰면 TS2339 에러가 나요
    const cur = await deps.repo.read(i.path);
    await deps.repo.write(i.path, cur.replace(i.find, i.replace));
    return { applied: true };
  },
});
```

`run` 안의 `ctx.deps`는 `Pick<LoopyDeps, D>` 타입을 가져요. 여기서 `D`는 `LoopyDeps` 전체가 아니라, 여러분이 작성한 `deps` 배열 그대로예요. 선언하지 않은 의존성에 손을 뻗으면 아무것도 실행되기 전에 TypeScript가 바로 거부해요:

```ts
export interface ToolCtx<D extends keyof LoopyDeps> {
  readonly deps: Pick<LoopyDeps, D>;
}
```

## 의존성은 체인을 타고 위로 쌓여요

에이전트의 의존성 요구사항은 자신이 선언한 `deps`와, 툴들(툴로 쓰이는 서브 에이전트 포함)이 선언한 모든 의존성을 합친 유니온이에요:

```ts
export type ToolDepKeys<T extends readonly AnyStep[]> = NonNullable<T[number]["~deps"]>;
```

```ts
// examples/agents.ts
export const codeGen = agent({
  name: "codeGen",
  // ...
  tools: [editFile, createFile, readFile, fileAnalyzer], // fileAnalyzer도 "repo"를 선언해요
  deps: ["repo"],
});
// codeGen의 전체 의존성 유니온은 정확히 "repo"예요. 넓어지지도, 빠지지도 않아요.
```

이 유니온은 [레지스트리](/ko/reference/registry/)까지 계속 타고 올라가요. 레지스트리는 등록된 모든 것이 요구하는 의존성이 실제로 다 채워지기 전까지는 `run`에 타입을 붙여주지 않아요.

## 다음 단계

- [채널과 상태](/ko/core-concepts/channels-and-state/)
- [API 레퍼런스 → Registry](/ko/reference/registry/)
