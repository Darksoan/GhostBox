import { LANGUAGES, LANGUAGE_LABELS, type Language } from "../content";
import "./LanguageToggle.scss";

interface LanguageToggleProps {
  language: Language;
  onChange: (next: Language) => void;
  label: string;
}

export function LanguageToggle({ language, onChange, label }: LanguageToggleProps) {
  return (
    <div className="language-toggle" role="group" aria-label={label}>
      {LANGUAGES.map((option) => (
        <button
          key={option}
          type="button"
          className="language-toggle__option"
          aria-pressed={option === language}
          onClick={() => onChange(option)}
        >
          {LANGUAGE_LABELS[option]}
        </button>
      ))}
    </div>
  );
}
