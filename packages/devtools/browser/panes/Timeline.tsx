import type { ViewModel } from "../../src/types.ts";

const icon = (s: string) => (s === "done" ? "✓" : s === "running" ? "⟳" : s === "errored" ? "✗" : s === "suspended" ? "⏸" : "·");

export function Timeline({ vm, selected, onSelect }: { vm: ViewModel; selected: string | null; onSelect: (n: string) => void }) {
  return (
    <ul style={{ listStyle: "none", margin: 0, padding: 8 }}>
      {vm.timeline.map((r) => (
        <li key={r.node} onClick={() => onSelect(r.node)}
          style={{ padding: "4px 8px", paddingLeft: 8 + r.depth * 12, cursor: "pointer",
            background: r.node === selected ? "var(--color-overlay-hover)" : undefined }}>
          {icon(r.status)} {r.name}{r.epoch > 1 ? ` #${r.epoch}` : ""}
        </li>
      ))}
    </ul>
  );
}
