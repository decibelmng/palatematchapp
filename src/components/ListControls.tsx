import { SORT_OPTIONS, PRICE_BAND_OPTIONS, type Controls } from "@/lib/list-controls";

type Props = {
  value: Controls;
  onChange: (next: Controls) => void;
  idPrefix: string;
};

export function ListControls({ value, onChange, idPrefix }: Props) {
  return (
    <div className="mt-3 rounded-lg border border-border bg-card/50 p-3 flex flex-wrap gap-x-4 gap-y-2 items-center text-xs">
      <label className="flex items-center gap-2">
        <span className="text-muted-foreground">Sort</span>
        <select
          id={`${idPrefix}-sort`}
          value={value.sort}
          onChange={(e) => onChange({ ...value, sort: e.target.value as Controls["sort"] })}
          className="rounded-md border border-border bg-background px-2 py-1 text-xs font-medium focus:border-primary focus:outline-none"
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </label>

      <label className="flex items-center gap-2">
        <span className="text-muted-foreground">Price</span>
        <select
          id={`${idPrefix}-price`}
          value={value.price}
          onChange={(e) => onChange({ ...value, price: e.target.value as Controls["price"] })}
          className="rounded-md border border-border bg-background px-2 py-1 text-xs font-medium focus:border-primary focus:outline-none"
        >
          {PRICE_BAND_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </label>

      <label className="flex items-center gap-1.5 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={value.catalogOnly}
          onChange={(e) => onChange({ ...value, catalogOnly: e.target.checked })}
          className="h-3.5 w-3.5 accent-primary"
        />
        <span className="text-muted-foreground">Catalog matches only</span>
      </label>
    </div>
  );
}
