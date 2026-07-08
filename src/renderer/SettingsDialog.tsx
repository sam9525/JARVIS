import React from "react";
import { colorFor } from "./domain-colors";

type Props = {
  domains: string[];
  colors: Record<string, string>;
  // color === null resets the domain to its palette default
  onColorChange: (domain: string, color: string | null) => void;
  onClose: () => void;
};

export default function SettingsDialog({
  domains,
  colors,
  onColorChange,
  onClose,
}: Props) {
  return (
    <div className="preview-backdrop" onClick={onClose}>
      <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
        <div className="preview-title">Domain colors</div>
        {domains.length === 0 && (
          <div className="settings-empty">No domains found in this vault.</div>
        )}
        {domains.map((d) => (
          <div key={d} className="settings-row">
            <input
              type="color"
              value={colors[d] ?? colorFor(d, domains, {})}
              onChange={(e) => onColorChange(d, e.target.value)}
            />
            <span className="settings-domain">{d}</span>
            {colors[d] && (
              <button onClick={() => onColorChange(d, null)}>reset</button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}