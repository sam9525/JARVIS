import React, { useEffect, useRef, useState } from "react";
import Graph from "./Graph";
import Preview from "./Preview";
import { applyEvent, emptyState } from "./highlight-store";
import type { VaultGraph } from "../shared/types";
import { domainsOf } from "./domain-colors";

export default function App() {
  const [graph, setGraph] = useState<VaultGraph>({ nodes: [], edges: [] });
  const [previewNode, setPreviewNode] = useState<string | null>(null);
  const stateRef = useRef(emptyState());

  useEffect(() => {
    window.jarvis.getGraph().then(setGraph); // initial pull (Task 1b — no startup race)
    window.jarvis.onGraph(setGraph); // watcher updates
    window.jarvis.onToolEvent((e) => {
      applyEvent(stateRef.current, e, performance.now());
      if (e.tool === "Read" && e.phase === "pre" && e.nodeIds[0]) {
        setPreviewNode(e.nodeIds[0]);
      }
    });
  }, []);

  return (
    <>
      <Graph
        graph={graph}
        domains={domainsOf(graph)}
        domainColors={{}}
        stateRef={stateRef}
        onNodeClick={setPreviewNode}
      />
      {previewNode && (
        <Preview nodeId={previewNode} onClose={() => setPreviewNode(null)} />
      )}
    </>
  );
}