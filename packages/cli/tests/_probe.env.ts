import { test } from "bun:test";
test("probe: report UPDATE_GOLDEN", () => {
  console.log(`UPDATE_GOLDEN=${process.env.UPDATE_GOLDEN ?? "<unset>"}`);
});
