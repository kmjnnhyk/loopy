import { useEffect, useState } from "react";
import { fold } from "../src/fold.ts";
import type { DevClient } from "./client.ts";
import { Timeline } from "./panes/Timeline.tsx";
import { Detail } from "./panes/Detail.tsx";
import { GraphPane } from "./panes/Graph.tsx";

export function App({ client }: { client: DevClient }) {
  const [, tick] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [scrub, setScrub] = useState<number | undefined>(undefined);
  useEffect(() => { client.onChange(() => tick((n) => n + 1)); }, [client]);

  const vm = fold(client.events(), scrub);
  const maxSeq = client.events().length ? client.events()[client.events().length - 1]!.seq : 0;

  return (
    <>
      <div style={{ gridRow: "1 / 3", overflow: "auto", borderRight: "1px solid var(--color-border)" }}>
        <input type="range" min={0} max={maxSeq} value={scrub ?? maxSeq}
          onChange={(e) => setScrub(Number(e.target.value) === maxSeq ? undefined : Number(e.target.value))} />
        <Timeline vm={vm} selected={selected} onSelect={setSelected} />
      </div>
      <GraphPane vm={vm} client={client} selected={selected} onSelect={setSelected} scrub={scrub} />
      <Detail detail={selected ? vm.details[selected] ?? null : null} />
    </>
  );
}
