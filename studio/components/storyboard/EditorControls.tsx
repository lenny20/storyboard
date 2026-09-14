import { cloneElement, useId, type ReactElement, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';

export function Field({
  label,
  hint,
  children,
  className = '',
}: {
  label: string;
  hint?: string;
  children: ReactElement<{ id?: string; 'aria-describedby'?: string }>;
  className?: string;
}) {
  const generatedId = useId();
  const id = children.props.id ?? generatedId;
  const hintId = `${id}-hint`;
  const describedBy =
    [children.props['aria-describedby'], hint ? hintId : undefined]
      .filter(Boolean)
      .join(' ') || undefined;
  return (
    <div className={`sb-field ${className}`}>
      <label className="sb-field-label" htmlFor={id}>
        {label}
      </label>
      {cloneElement(children, { id, 'aria-describedby': describedBy })}
      {hint && (
        <span className="sb-hint" id={hintId}>
          {hint}
        </span>
      )}
    </div>
  );
}

export function IconButton({
  label,
  children,
  onClick,
  disabled,
  danger = false,
}: {
  label: string;
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className={danger ? 'sb-icon sb-danger' : 'sb-icon'}
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </Button>
  );
}
