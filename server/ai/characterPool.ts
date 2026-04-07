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
  const raw = fs.readFileSync(poolPath, "utf-8");
  const parsed = JSON.parse(raw) as CharacterPoolFile;
  cached = parsed.characters;
  console.log(`[CharacterPool] Loaded ${cached.length} characters.`);
  return cached;
}

export function getCharacterById(id: string): CharacterEntry | null {
  const pool = loadCharacterPool();
  return pool.find((c) => c.id === id) ?? null;
}
