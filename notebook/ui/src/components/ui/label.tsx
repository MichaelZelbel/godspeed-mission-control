import * as React from "react";
import * as LabelPrimitive from "@radix-ui/react-label";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const labelVariants = cva("text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70");

const Label = React.forwardRef<
  React.ElementRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root> & VariantProps<typeof labelVariants>
>(({ className, ...props }, ref) => (
  <LabelPrimitive.Root ref={ref} className={cn(labelVariants(), className)} {...props} />
));
Label.displayName = LabelPrimitive.Root.displayName;

export { Label };

/**
 * Text shown beside a label but kept out of the field's name: the required star,
 * or a slider's live value (which the slider itself exposes as aria-valuetext).
 * Put it next to the <Label>, not inside it, so the field is found by its plain label text.
 */
const LabelAside = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <span aria-hidden="true" className={cn(labelVariants(), className)}>{children}</span>
);

/** The required star beside a label; the field itself carries required / aria-required. */
const RequiredMark = () => <LabelAside>*</LabelAside>;

export { LabelAside, RequiredMark };
