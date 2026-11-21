import { useId } from "react";
import { EXPOSURE_STEPS, SECTOR_GROUPS, type SectorGroupId } from "../lib/filters.ts";
import { SECTOR_SHORT } from "../lib/format.ts";
import { CheckOption, Dropdown, dropdownLabel } from "./Dropdown.tsx";

export function SectorFilter({ value, minExposure, counts, onChange, onMinExposure, disabled }: {
  value: SectorGroupId[];
  minExposure: number;
  counts: Record<SectorGroupId, number>;
  onChange: (next: SectorGroupId[]) => void;
  onMinExposure: (level: number) => void;
  disabled?: boolean;
}) {
  const levelName = useId();
  const toggle = (id: SectorGroupId, on: boolean) =>
    onChange(SECTOR_GROUPS.map(g => g.id).filter(x => (x === id ? on : value.includes(x))));

  return (
    <Dropdown
      label={dropdownLabel("Sector exposure", value.map(id => SECTOR_SHORT[id]))}
      active={value.length > 0}
      disabled={disabled}
    >
      <fieldset className="dropdown__fieldset">
        <legend className="dropdown__legend">Share of stock holdings</legend>
        {SECTOR_GROUPS.map(g => (
          <CheckOption
            key={g.id}
            label={g.label}
            hint={g.sources.join(" + ")}
            count={counts[g.id]}
            checked={value.includes(g.id)}
            onChange={on => toggle(g.id, on)}
          />
        ))}
      </fieldset>
      <fieldset className="dropdown__fieldset dropdown__level">
        <legend className="dropdown__level-legend">Exposure at least</legend>
        <div className="segmented">
          {EXPOSURE_STEPS.map(step => (
            <label key={step} className="segmented__option">
              <input
                type="radio"
                name={levelName}
                checked={Math.abs(step - minExposure) < 1e-9}
                onChange={() => onMinExposure(step)}
              />
              <span>{Math.round(step * 100)}%</span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="dropdown__footer">
        <button type="button" className="link-button" onClick={() => onChange([])} disabled={value.length === 0}>
          Clear
        </button>
      </div>
    </Dropdown>
  );
}
