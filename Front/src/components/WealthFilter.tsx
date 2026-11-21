import { WEALTH_BANDS, type WealthBandId } from "../lib/filters.ts";
import { wealthLabel } from "../lib/format.ts";
import { CheckOption, Dropdown, dropdownLabel } from "./Dropdown.tsx";

export function WealthFilter({ value, counts, onChange, disabled }: {
  value: WealthBandId[];
  counts: Record<WealthBandId, number>;
  onChange: (next: WealthBandId[]) => void;
  disabled?: boolean;
}) {
  const toggle = (id: WealthBandId, on: boolean) =>
    // Keep the menu's band order, whatever order the boxes were ticked in.
    onChange(WEALTH_BANDS.map(b => b.id).filter(x => (x === id ? on : value.includes(x))));

  return (
    <Dropdown label={dropdownLabel("Wealth", value.map(wealthLabel))} active={value.length > 0} disabled={disabled}>
      <fieldset className="dropdown__fieldset">
        <legend className="dropdown__legend">Net worth</legend>
        {WEALTH_BANDS.map(b => (
          <CheckOption
            key={b.id}
            label={b.label}
            count={counts[b.id]}
            checked={value.includes(b.id)}
            onChange={on => toggle(b.id, on)}
          />
        ))}
      </fieldset>
      <div className="dropdown__footer">
        <button type="button" className="link-button" onClick={() => onChange([])} disabled={value.length === 0}>
          Clear
        </button>
      </div>
    </Dropdown>
  );
}
