import { expect, test } from "bun:test";

test("완료 기준: 프로세스 재시작을 넘는 suspend → resume (실제 서브프로세스 2개)", async () => {
  const db = `/tmp/loopy-restart-${Math.random().toString(36).slice(2)}.db`;
  const p1 = Bun.spawnSync(["bun", "tests/anchors/restart/phase1.ts", db]);
  expect(p1.exitCode).toBe(0);
  expect(p1.stdout.toString()).toContain('SUSPENDED:{"kind":"clarify"}');

  const p2 = Bun.spawnSync(["bun", "tests/anchors/restart/phase2.ts", db]);
  expect(p2.exitCode).toBe(0);
  const out = p2.stdout.toString();
  expect(out).toContain('DONE:{"prUrl":"https://example/pull/1"}');
  expect(out).toContain("LLM=0"); // 재시작 후 resume — 모델 재호출 0
});
