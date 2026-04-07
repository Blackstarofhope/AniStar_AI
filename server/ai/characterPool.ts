import * as fs from "fs";
import * as path from "path";

export interface CharacterEntry {
  id: string;
  name: string;
  anime: string;
  mal_id: number | null;
  tags: string[];
  represents: string;
}

interface CharacterPoolFile {
  version: number;
  description: string;
  note: string;
  characters: CharacterEntry[];
}

let cached: CharacterEntry[] | null = null;

export function loadCharacterPool(): CharacterEntry[] {
  if (cached !== null) return cached;
  const poolPath = path.resolve(process.cwd(), "character-pool.json");

  if (!fs.existsSync(poolPath)) {
    const msg =
      `[CharacterPool] FATAL: character-pool.json not found at ${poolPath}. ` +
      `Make sure the file exists in the project root.`;
    console.error(msg);
    throw new Error(msg);
  }

  let raw: string;
  try {
    raw = fs.readFileSync(poolPath, "utf-8");
  } catch (e) {
    const msg = `[CharacterPool] Failed to read character-pool.json: ${e instanceof Error ? e.message : String(e)}`;
    console.error(msg);
    throw new Error(msg);
  }

  let parsed: CharacterPoolFile;
  try {
    parsed = JSON.parse(raw) as CharacterPoolFile;
  } catch (e) {
    const msg = `[CharacterPool] character-pool.json is not valid JSON: ${e instanceof Error ? e.message : String(e)}`;
    console.error(msg);
    throw new Error(msg);
  }

  if (!Array.isArray(parsed?.characters) || parsed.characters.length === 0) {
    const msg = "[CharacterPool] character-pool.json has no characters array or it is empty.";
    console.error(msg);
    throw new Error(msg);
  }

  cached = parsed.characters;
  console.log(`[CharacterPool] Loaded ${cached.length} characters from ${poolPath}.`);
  return cached;
}

export function getCharacterById(id: string): CharacterEntry | null {
  const pool = loadCharacterPool();
  return pool.find((c) => c.id === id) ?? null;
}
