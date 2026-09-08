import "./Switch.css";

interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  label: string;
}

export function Switch({ checked, onChange, disabled, label }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      className="wemd-switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className="wemd-switch-thumb" />
    </button>
  );
}
