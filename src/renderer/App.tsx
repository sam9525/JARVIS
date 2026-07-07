import React, { useEffect, useState } from "react";
import type { ToolEvent, VaultGraph } from "../shared/types";

export default function App() {
  const [graph, setGraph] = useState<VaultGraph>({ nodes: [], edges: [] });
  const [lastEvent, setLastEvent] = useState<ToolEvent | null>(null);

  useEffect(() => {
    window.jarvis.getGraph().then(setGraph);
    window.jarvis.onGraph(setGraph);
    window.jarvis.onToolEvent(setLastEvent);
  }, []);

  return (
    <pre style={{ color: "#d7dce6", padding: 16 }}>
      nodes: {graph.nodes.length} edges: {graph.edges.length}
      {"\n"}last event: {JSON.stringify(lastEvent)}
    </pre>
  );
}