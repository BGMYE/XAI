import { useId, type ButtonHTMLAttributes, type ReactNode } from "react";

export function StudioButton({ children, className = "", primary, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { primary?: boolean }) {
  return <button type="button" {...props} className={`studio-button${primary ? " primary" : ""} ${className}`}>{children}</button>;
}

export function IconButton({ label, children, className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return <button type="button" title={label} aria-label={label} {...props} className={`studio-icon-button ${className}`}>{children}</button>;
}

export function SegmentedControl<T extends string>({ label, value, options, onChange }: {
  label: string;
  value: T;
  options: readonly { value: T; label: string; icon?: ReactNode }[];
  onChange: (value: T) => void;
}) {
  const id = useId();
  return <div className="studio-segmented" role="radiogroup" aria-label={label}>
    {options.map((option) => <label key={option.value} className={option.value === value ? "selected" : ""}>
      <input type="radio" name={id} value={option.value} checked={option.value === value} onChange={() => onChange(option.value)} />
      {option.icon}<span>{option.label}</span>
    </label>)}
  </div>;
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return <div className="studio-empty"><h2>{title}</h2>{children && <p>{children}</p>}{action}</div>;
}
