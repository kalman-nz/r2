// Limits for numbers typed into forms, and what's wrong with one (shown by
// components/NumberInput.tsx and checked by the forms before they save).

export interface NumberLimits {
  min?: number;
  max?: number;
  // Whole numbers only.
  integer?: boolean;
}

// Common limits: money and measurements, and counts.
export const AMOUNT: NumberLimits = { min: 0 };
export const COUNT: NumberLimits = { min: 0, integer: true };

// What's wrong with a number for these limits, in a few words, or null if
// it's fine. Forms use it to hold back Save, so the form and the field
// agree on what's wrong.
export function numberProblem(value: number, { min, max, integer }: NumberLimits): string | null {
  if (!Number.isFinite(value)) return "Enter a number";
  if (min !== undefined && value < min) return min === 0 ? "Can't be negative" : `Has to be ${min} or more`;
  if (max !== undefined && value > max) return `Has to be ${max} or less`;
  if (integer && !Number.isInteger(value)) return "Whole numbers only";
  return null;
}
