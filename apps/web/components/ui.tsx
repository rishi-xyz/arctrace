import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }

const buttonStyles = cva('inline-flex items-center justify-center gap-2 rounded-lg text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-moss disabled:pointer-events-none disabled:opacity-50', {
  variants: {
    variant: {
      primary: 'bg-ink text-white hover:bg-[#244239]',
      outline: 'border border-line bg-white text-ink hover:bg-paper',
      ghost: 'text-[#53645c] hover:bg-paper hover:text-ink',
    },
    size: { default: 'h-10 px-4', sm: 'h-8 px-3 text-xs', icon: 'h-9 w-9' },
  },
  defaultVariants: { variant: 'primary', size: 'default' },
});

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonStyles> & { asChild?: boolean };
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, asChild, ...props }, ref) => {
  const Component = asChild ? Slot : 'button';
  return <Component ref={ref} className={cn(buttonStyles({ variant, size }), className)} {...props} />;
});
Button.displayName = 'Button';

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-2xl border border-line bg-white shadow-soft', className)} {...props} />;
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn('h-11 w-full rounded-lg border border-line bg-white px-3 text-sm outline-none transition placeholder:text-[#9aa59e] focus:border-moss focus:ring-2 focus:ring-moss/15', props.className)} />;
}

export function Badge({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'green' | 'amber' }) {
  const styles = { neutral: 'bg-[#f1f3ef] text-[#59665e]', green: 'bg-[#e7f2e8] text-[#42704f]', amber: 'bg-[#fbf1dc] text-[#8a682b]' };
  return <span className={cn('inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium', styles[tone])}>{children}</span>;
}
