import { Dropdown } from "primereact/dropdown";
import type { ColumnFilterElementTemplateOptions } from "primereact/column";

export interface FilterChoice {
  readonly label: string;
  readonly value: string;
}

// A column filter that picks one of a few fixed values (a status, a document type) instead of typing text. The
// choices carry translated labels while the column's `field` holds the raw code, so the filter matches the code.
// Use with <Column filter field="status" filterMatchMode="equals" filterElement={selectFilter(...)} />.
export function selectFilter(choices: readonly FilterChoice[], placeholder: string): (options: ColumnFilterElementTemplateOptions) => React.JSX.Element {
  return function SelectFilter(options) {
    return (
      <Dropdown
        value={(options.value as string | null | undefined) ?? null}
        options={[...choices]}
        onChange={(e) => options.filterCallback((e.value as string | null | undefined) ?? null)}
        placeholder={placeholder}
        showClear
        className="mk-column-filter"
      />
    );
  };
}
