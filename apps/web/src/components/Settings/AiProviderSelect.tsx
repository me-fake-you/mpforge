import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, SlidersHorizontal } from "lucide-react";

import { PROVIDER_LOGOS } from "./providerLogos";
import {
  AI_PROVIDER_PRESETS,
  getProviderPreset,
  type AiProviderId,
  type AiProviderPreset,
} from "../../services/ai/aiConfig";

interface AiProviderSelectProps {
  value: AiProviderId;
  onChange: (provider: AiProviderId) => void;
  labelId: string;
}

function ProviderMark({ preset }: { preset: AiProviderPreset }) {
  const logo = PROVIDER_LOGOS[preset.id];
  return (
    <span className="ai-provider-mark" aria-hidden="true">
      {logo ? (
        <img className="ai-provider-logo" src={logo} alt="" loading="lazy" />
      ) : (
        (preset.mark ?? <SlidersHorizontal size={12} />)
      )}
    </span>
  );
}

export function AiProviderSelect({
  value,
  onChange,
  labelId,
}: AiProviderSelectProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = getProviderPreset(value);

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [open]);

  return (
    <div className="ai-provider-select" ref={rootRef}>
      <button
        type="button"
        className="ai-provider-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby={labelId}
        onClick={() => setOpen((prev) => !prev)}
      >
        <ProviderMark preset={selected} />
        <span className="ai-provider-name">{selected.label}</span>
        <ChevronDown size={14} className={open ? "is-open" : undefined} />
      </button>

      {open && (
        <ul
          className="ai-provider-list"
          role="listbox"
          aria-labelledby={labelId}
        >
          {AI_PROVIDER_PRESETS.map((preset) => (
            <li key={preset.id}>
              <button
                type="button"
                role="option"
                aria-selected={preset.id === value}
                className="ai-provider-option"
                onClick={() => {
                  onChange(preset.id);
                  setOpen(false);
                }}
              >
                <ProviderMark preset={preset} />
                <span className="ai-provider-name">{preset.label}</span>
                {preset.id === value && <Check size={14} />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
