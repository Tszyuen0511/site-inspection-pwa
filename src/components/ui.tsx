import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cva, type VariantProps } from "class-variance-authority";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { X } from "lucide-react";
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
const buttonVariants = cva("btn", {
  variants: {
    variant: {
      default: "btn-primary",
      outline: "btn-outline",
      ghost: "btn-ghost",
      destructive: "btn-danger",
    },
    size: { default: "", sm: "btn-sm", icon: "btn-icon" },
  },
  defaultVariants: { variant: "default", size: "default" },
});
export function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  wide = false,
  className,
  closeLabel = "Close dialog",
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  wide?: boolean;
  className?: string;
  closeLabel?: string;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="dialog-overlay" />
        <DialogPrimitive.Content
          className={cn("dialog-content", wide && "dialog-wide", className)}
        >
          <DialogPrimitive.Title className="dialog-title">
            {title}
          </DialogPrimitive.Title>
          <DialogPrimitive.Description
            className={description ? "dialog-description" : "sr-only"}
          >
            {description || title}
          </DialogPrimitive.Description>
          {children}
          <DialogPrimitive.Close
            className="dialog-close"
            aria-label={closeLabel}
          >
            <X size={20} />
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
export function Badge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: string;
}) {
  return (
    <span className={`badge badge-${tone}`}>
      <span className="badge-dot" />
      {children}
    </span>
  );
}
export function StatusBadge({ status }: { status: string }) {
  return (
    <Badge
      tone={
        status === "Completed"
          ? "green"
          : status === "Exported"
            ? "blue"
            : status === "Draft"
              ? "amber"
              : status === "Fail"
                ? "red"
                : "neutral"
      }
    >
      {status}
    </Badge>
  );
}
export function Field({
  label,
  children,
  error,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  error?: string;
  hint?: string;
}) {
  const fieldId = React.useId();
  const labelId = fieldId + "-label",
    errorId = fieldId + "-error",
    hintId = fieldId + "-hint";
  const describe = (child: React.ReactNode): React.ReactNode => {
    if (!React.isValidElement(child)) return child;
    const element = child as React.ReactElement<Record<string, unknown>>;
    if (
      typeof element.type === "string" &&
      ["input", "select", "textarea"].includes(element.type)
    ) {
      return React.cloneElement(element, {
        "aria-labelledby": element.props["aria-label"]
          ? undefined
          : element.props["aria-labelledby"] || labelId,
        "aria-invalid": error ? true : element.props["aria-invalid"],
        "aria-required": label.includes("*")
          ? true
          : element.props["aria-required"],
        "aria-describedby":
          [
            element.props["aria-describedby"],
            error ? errorId : "",
            hint ? hintId : "",
          ]
            .filter(Boolean)
            .join(" ") || undefined,
      });
    }
    return element.props.children
      ? React.cloneElement(element, {
          children: React.Children.map(
            element.props.children as React.ReactNode,
            describe,
          ),
        })
      : element;
  };
  return (
    <label className="field">
      <span id={labelId}>{label}</span>
      {React.Children.map(children, describe)}
      {error && (
        <small className="field-error" role="alert" id={errorId}>
          {error}
        </small>
      )}
      {hint && (
        <small className="muted" id={hintId}>
          {hint}
        </small>
      )}
    </label>
  );
}
