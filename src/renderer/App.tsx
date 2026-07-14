import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Graph from "./Graph";
import Graph3D from "./Graph3D";
import Preview from "./Preview";
import GraphSettingsPanel from "./GraphSettingsPanel";
import { applyEvent, emptyState } from "./highlight-store";
import { filterGraph } from "./graph-filter";
import { domainsOf } from "./domain-colors";
import { defaultSettings } from "../shared/types";
import { createPreviewOpener } from "./preview-opener";
import type { Settings, VaultGraph } from "../shared/types";

export default function App() {
  const [graph, setGraph] = useState<VaultGraph>({ nodes: [], edges: [] });
  const [previewNode, setPreviewNode] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings>(defaultSettings());
  const [search, setSearch] = useState(""); // transient — cleared on restart
  const [showSettings, setShowSettings] = useState(false);
  const [layoutEpoch, setLayoutEpoch] = useState(0);
  const stateRef = useRef(emptyState());

  // debounced auto-open: last-read file after reads go quiet
  const onPreviewEvent = useMemo(() => createPreviewOpener(setPreviewNode), []);

  useEffect(() => {
    window.jarvis.getGraph().then(setGraph); // initial pull (Task 1b — no startup race)
    window.jarvis.getSettings().then(setSettings);
    window.jarvis.onGraph(setGraph); // watcher updates
    window.jarvis.onToolEvent((e) => {
      applyEvent(stateRef.current, e, performance.now());
      onPreviewEvent(e);
    });
  }, [onPreviewEvent]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F5") {
        e.preventDefault();
        refreshGraph();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [refreshGraph]);

  const updateSettings = (s: Settings) => {
    setSettings(s); // renderer owns live state; main just persists
    window.jarvis.setSettings(s).catch(console.error);
  };

  // re-scan the vault and re-settle the layout; settings and highlights
  // are deliberately untouched
  const refreshGraph = useCallback(async () => {
    const g = await window.jarvis.rescan();
    setGraph(g);
    setLayoutEpoch((n) => n + 1);
  }, []);

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
          focusNode={previewNode}
          layoutEpoch={layoutEpoch}
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
          focusNode={previewNode}
          layoutEpoch={layoutEpoch}
        />
      )}
      <div className="hud">
        <button
          className="gear"
          title="Refresh graph (F5)"
          onClick={refreshGraph}
        >
          ↻
        </button>
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
