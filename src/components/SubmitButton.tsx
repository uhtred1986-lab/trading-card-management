"use client";

import { useFormStatus } from "react-dom";

/**
 * The submit button for a plain `<form action={serverAction}>` in a Server
 * Component. `useFormStatus` only sees the form it renders inside, so this
 * has to be its own client component rather than a prop on the form itself.
 */
export function SubmitButton({
  children,
  pendingLabel,
  className = "",
  disabled = false,
}: {
  children: React.ReactNode;
  /** Shown instead of `children` while the form is submitting. Defaults to `children` unchanged. */
  pendingLabel?: React.ReactNode;
  className?: string;
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={disabled || pending} aria-busy={pending} className={`disabled:cursor-not-allowed disabled:opacity-50 ${className}`}>
      {pending ? (pendingLabel ?? children) : children}
    </button>
  );
}
