import { homedir } from "node:os";
import { resolve, sep } from "node:path";
import { AppError } from "./errors.js";

/**
 * Extra roots allowed in addition to $HOME and the current working directory.
 * Colon-separated, e.g. VERDI_ALLOWED_ROOTS=/work:/proj.
 */
export function extraRootsFromEnv(): string[] {
  return (process.env.VERDI_ALLOWED_ROOTS ?? "")
    .split(":")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function assertAllowedPath(path: string, extraRoots: Array<string | undefined> = []): string {
  const abs = resolve(path);
  const roots = [homedir(), process.cwd(), ...extraRootsFromEnv(), ...extraRoots]
    .filter((root): root is string => Boolean(root))
    .map((root) => resolve(root));
  const allowed = roots.some((root) => abs === root || abs.startsWith(root + sep));
  if (!allowed) {
    throw new AppError("invalid_argument", "path is outside the allowed project roots", {
      path: abs,
      roots,
      hint: "add the directory to VERDI_ALLOWED_ROOTS to allow it",
    });
  }
  return abs;
}
