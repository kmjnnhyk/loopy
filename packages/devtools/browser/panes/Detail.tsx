import type { StepDetail } from "../../src/types.ts";

const Json = ({ v }: { v: unknown }) => <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{JSON.stringify(v, null, 2)}</pre>;

export function Detail({ detail }: { detail: StepDetail | null }) {
  if (!detail) return <div style={{ padding: 16, opacity: 0.6 }}>Select a step</div>;
  return (
    <div style={{ padding: 16, overflow: "auto" }}>
      <h3>{detail.node}</h3>
      {detail.model && (<details open><summary>model</summary><Json v={detail.model.request} /><Json v={detail.model.response} /></details>)}
      {detail.tools.map((t, i) => (<details key={i} open><summary>tool · {t.tool}</summary><Json v={t.args} /><Json v={t.value} /></details>))}
      {detail.patchedChannels.length > 0 && <div>patched channels: {detail.patchedChannels.join(", ")}</div>}
      {detail.interrupt && <div>⏸ interrupt payload: <Json v={detail.interrupt.payload} /></div>}
    </div>
  );
}
