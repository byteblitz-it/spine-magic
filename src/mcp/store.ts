import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { ZodError } from "zod";
import { parseEffect, type Effect } from "../core/schema.js";

/** Effects persisted as JSON files, one per id, so humans and other tools can open them. */
export class EffectStore {
  readonly dir: string;
  constructor(dir: string) {
    this.dir = resolve(dir);
    mkdirSync(this.dir, { recursive: true });
  }

  private path(id: string) {
    if (!/^[\w-]+$/.test(id)) throw new Error(`invalid effect id "${id}" (letters, digits, _ and - only)`);
    return join(this.dir, `${id}.json`);
  }

  list(): { id: string; name: string; emitters: number }[] {
    return readdirSync(this.dir).filter((f) => f.endsWith(".json")).map((f) => {
      const id = f.slice(0, -5);
      try {
        const e = this.get(id);
        return { id, name: e.name, emitters: e.emitters.length };
      } catch {
        return { id, name: "(invalid file)", emitters: 0 };
      }
    });
  }

  has(id: string) { return existsSync(this.path(id)); }

  get(id: string): Effect {
    const p = this.path(id);
    if (!existsSync(p)) throw new Error(`effect "${id}" not found; call list_effects`);
    return parseEffect(JSON.parse(readFileSync(p, "utf8")));
  }

  /** Validates, then saves. Returns the fully-defaulted effect. */
  save(id: string, input: unknown): Effect {
    const effect = parseEffect(input);
    writeFileSync(this.path(id), JSON.stringify(effect, null, 2));
    return effect;
  }

  remove(id: string) { unlinkSync(this.path(id)); }

  uniqueId(base: string): string {
    const slug = base.toLowerCase().replace(/[^\w-]+/g, "_").replace(/^_+|_+$/g, "") || "effect";
    let id = slug, n = 2;
    while (this.has(id)) id = `${slug}_${n++}`;
    return id;
  }
}

export { deepMerge } from "../core/merge.js";

export function formatError(e: unknown): string {
  if (e instanceof ZodError) return "Invalid effect:\n" + e.issues.map((i) => `- ${i.path.join(".") || "(root)"}: ${i.message}`).join("\n");
  return e instanceof Error ? e.message : String(e);
}
