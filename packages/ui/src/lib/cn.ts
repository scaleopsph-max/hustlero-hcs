import clsx, { type ClassValue } from 'clsx'

/** Join class names. Conditional classes go through here, never string concatenation. */
export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs)
}
