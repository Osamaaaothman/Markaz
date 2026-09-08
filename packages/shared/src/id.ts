import { uuidv7 } from "uuidv7";

// UUID v7 per docs/04-DATA-MODEL-RULES.md §1: sortable, non-guessable, safe in URLs.
// Generated explicitly at the application layer (not a DB-level default) so the same
// id generation is used consistently regardless of which database eventually stores
// the row — boring and explicit beats a framework-specific default.
export function newId(): string {
  return uuidv7();
}
