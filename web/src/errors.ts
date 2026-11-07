import { ZodError } from "zod";

export function formatZodError(e: unknown): string {
  if (e instanceof ZodError) return e.issues.map((i) => `${i.path.join(".") || "effect"}: ${i.message}`).join("\n");
  return e instanceof Error ? e.message : String(e);
}
