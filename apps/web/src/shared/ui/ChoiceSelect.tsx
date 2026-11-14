import { Dropdown } from "primereact/dropdown";
import "./choice-select.css";

interface Choice<T extends string> {
  label: string;
  value: T;
}

/** A themed popup, including keyboard navigation, focus management and selection state. */
export function ChoiceSelect<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
}: {
  label: string;
  value: T;
  options: Choice<T>[];
  onChange: (value: T) => void;
  className?: string;
}): React.JSX.Element {
  return (
    <Dropdown
      aria-label={label}
      value={value}
      options={options}
      optionLabel="label"
      optionValue="value"
      className={className}
      panelClassName="mk-choice-panel"
      checkmark
      onChange={(event) => {
        const choice = options.find((option) => option.value === event.value);
        if (choice) onChange(choice.value);
      }}
    />
  );
}
