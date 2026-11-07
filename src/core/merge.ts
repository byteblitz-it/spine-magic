/** Objects merge recursively; arrays and primitives replace; `null` deletes (so schema defaults apply). */
export function deepMerge<T>(base: T, patch: unknown): T {
  if (!isObj(base) || !isObj(patch)) return patch === undefined ? base : (patch as T);
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) out[k] = v === null ? undefined : deepMerge(out[k], v);
  return out as T;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
