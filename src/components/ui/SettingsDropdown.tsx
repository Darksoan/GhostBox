import { ChevronDown } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { handleListboxKeyDown, handleListboxTriggerKeyDown } from "../../utils/listboxNavigation";

type SettingsDropdownOption = {
  label: string;
  value?: string;
  choices: Array<{ label: string; value: string; disabled?: boolean }>;
  onChange: (value: string) => void;
  disabled?: boolean;
};

/** Shared by every settings tab so control geometry and interactions stay identical. */
export function SettingsDropdown({ option }: { option: SettingsDropdownOption }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const activeChoice = option.choices.find((choice) => choice.value === option.value) ?? option.choices[0];

  return (
    <div className={`settings-dropdown settings-page-dropdown ${open ? "settings-dropdown--open" : ""}`} ref={rootRef}>
      <button
        type="button"
        className="settings-dropdown__trigger"
        aria-label={option.label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={option.disabled}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => handleListboxTriggerKeyDown(event, setOpen)}
      >
        <span>{activeChoice?.label ?? option.label}</span>
        <ChevronDown size={14} />
      </button>
      {open && !option.disabled && (
        <div
          id={menuId}
          className="settings-dropdown__menu"
          role="listbox"
          aria-label={option.label}
          onKeyDown={(event) => handleListboxKeyDown(event, setOpen)}
        >
          {option.choices.filter((choice) => choice.value !== option.value).map((choice) => (
            <button
              key={choice.value}
              type="button"
              role="option"
              aria-selected={false}
              disabled={choice.disabled}
              className="settings-dropdown__option"
              onClick={() => { option.onChange(choice.value); setOpen(false); }}
            >
              <span>{choice.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
