import React, { useEffect, useMemo, useRef, useState } from "react";
import Graph from "./Graph";
import Preview from "./Preview";
import SectionToggle from "./SectionToggle";
import SettingsDialog from "./SettingsDialog";
import { applyEvent, emptyState } from "./highlight-store";
import { filterGraph } from "./graph-filter";
import { domainsOf } from "./domain-colors";
import { defaultSettings } from "../shared/types";
import type { Settings, VaultGraph } from "../shared/types";

export default function App() {
  const [graph, setGraph] = useState<VaultGraph>({ nodes: [], edges: [] });
  const [previewNode, setPreviewNode] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings>(defaultSettings());
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
        search: "",
        showTags: settings.showTags,
        showOrphans: settings.showOrphans,
      }),
    [graph, settings],
  );

  return (
    <>
      <Graph
        graph={visible}
        domains={domains}
        domainColors={settings.domainColors}
        stateRef={stateRef}
        onNodeClick={setPreviewNode}
      />
      <div className="hud">
        <SectionToggle
          value={settings.sectionFilter}
          onChange={(f) => updateSettings({ ...settings, sectionFilter: f })}
        />
        <button
          className="gear"
          title="Domain colors"
          onClick={() => setShowSettings(true)}
        >
          ⚙
        </button>
      </div>
      {showSettings && (
        <SettingsDialog
          domains={domains}
          colors={settings.domainColors}
          onColorChange={(d, c) => {
            const domainColors = { ...settings.domainColors };
            if (c === null) delete domainColors[d];
            else domainColors[d] = c;
            updateSettings({ ...settings, domainColors });
          }}
          onClose={() => setShowSettings(false)}
        />
      )}
      {previewNode && (
        <Preview nodeId={previewNode} onClose={() => setPreviewNode(null)} />
      )}
    </>
  );
}
