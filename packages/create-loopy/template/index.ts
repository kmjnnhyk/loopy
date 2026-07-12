import { defineLoopy, workflow, step, node, io, lastChannel, END } from "@loopyjs/core";

const greet = step({
  name: "greet",
  input: io<{ name: string }>(),
  output: io<{ message: string }>(),
  run: async (i) => ({ message: `Hello, ${i.name}!` }),
});

export const hello = workflow({
  name: "hello",
  state: { greeting: lastChannel<{ message: string } | null>(null) },
  input: io<{ name: string }>(),
  output: io<{ message: string }>(),
})
  .nodes({
    greet: node(greet, { reads: (s) => ({ name: s.input.name }), writes: "greeting" }),
  })
  .flow((b) => b.start("greet").edge("greet", END))
  .returns((s) => ({ message: s.greeting?.message ?? "" }));

export const runtime = defineLoopy({
  agents: {},
  workflows: { hello },
  deps: {},
});

const out = await runtime.run("hello", { name: "world" });
console.log(out); // { message: "Hello, world!" }
