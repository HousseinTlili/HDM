import type { ReactNode } from "react";

export function SettingsCard({
  title,
  children,
}: {
  title?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      {title && (
        <span className="font-label text-label-sm uppercase tracking-wider text-on-surface-variant">
          {title}
        </span>
      )}
      <section className="rounded-md bg-surface-container border border-outline divide-y divide-outline-subtle">
        {children}
      </section>
    </div>
  );
}

export function SettingRow({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="p-4 flex items-center justify-between gap-4">
      <div className="min-w-0 flex flex-col gap-0.5">
        <span className="font-title text-title-sm text-on-surface">{title}</span>
        {description && (
          <span className="font-body text-body-sm text-on-surface-variant">
            {description}
          </span>
        )}
      </div>
      <div className="shrink-0 flex items-center gap-2">{children}</div>
    </div>
  );
}

export function ToggleSwitch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`w-9 h-5 rounded-full border p-0.5 flex items-center transition-colors duration-state-change ease-state-change ${
        checked
          ? "bg-primary border-primary justify-end"
          : "bg-surface border-outline justify-start"
      }`}
    >
      <span className="w-3.5 h-3.5 rounded-full bg-on-primary block" />
    </button>
  );
}
