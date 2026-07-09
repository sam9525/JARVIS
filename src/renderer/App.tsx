import React, { useEffect, useMemo, useRef, useState } from "react";
import Graph from "./Graph";
import Graph3D from "./Graph3D";
import Preview from "./Preview";
import GraphSettingsPanel from "./GraphSettingsPanel";
import { applyEvent, emptyState } from "./highlight-store";
import { filterGraph } from "./graph-filter";
import { domainsOf } from "./domain-colors";
import { defaultSettings } from "../shared/types";
import type { Settings, VaultGraph } from "../shared/types";

export default function App() {
  const [graph, setGraph] = useState<VaultGraph>({ nodes: [], edges: [] });
  const [previewNode, setPreviewNode] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings>(defaultSettings());
  const [search, setSearch] = useState(""); // transient — cleared on restart
  const [showSettings, setShowSettings] = useState(false);
  const stateRef = useRef(emptyState());

  useEffect(() => {
    window.jarvis.getGraph().then(setGraph); // initial pull (Task 1b — no startup race)
    window.jarvis.getSettings().then(setSettings);
    window.jarvis.onGraph(setGraph); // watcher updates
    window.jarvis.onToolEvent((e) => {
      applyEvent(stateRef.current, e, performance.now());
      if (e.tool === "Read" && e.phase === "pre" && e.nodeIds[0]) {
        setPreviewNode(e.nodeIds[0]);
      }
    });
  }, []);

  const updateSettings = (s: Settings) => {
    setSettings(s); // renderer owns live state; main just persists
    window.jarvis.setSettings(s).catch(console.error);
  };

  const domains = useMemo(() => domainsOf(graph), [graph]);
  const visible = useMemo(
    () =>
      filterGraph(graph, {
        sectionFilter: settings.sectionFilter,
        search,
        showTags: settings.showTags,
        showOrphans: settings.showOrphans,
      }),
    [graph, settings, search],
  );

  const view = settings.views[settings.dimensions];

  return (
    <>
      {settings.dimensions === "3d" ? (
        <Graph3D
          graph={visible}
          domains={domains}
          groups={settings.groups}
          display={view.display}
          forces={view.forces}
          stateRef={stateRef}
          onNodeClick={setPreviewNode}
        />
      ) : (
        <Graph
          graph={visible}
          domains={domains}
          groups={settings.groups}
          display={view.display}
          forces={view.forces}
          stateRef={stateRef}
          onNodeClick={setPreviewNode}
        />
      )}
      <div className="hud">
        <button
          className="gear"
          title="Graph settings"
          onClick={() => setShowSettings((v) => !v)}
        >
          ⚙
        </button>
      </div>
      {showSettings && (
        <GraphSettingsPanel
          settings={settings}
          search={search}
          onSearchChange={setSearch}
          onSettingsChange={updateSettings}
          onClose={() => setShowSettings(false)}
        />
      )}
      {previewNode && (
        <Preview nodeId={previewNode} onClose={() => setPreviewNode(null)} />
      )}
    </>
  );
}
