import { cleanTitle } from "./doctor.js";
import { fieldsInTitle, stripTitleFields } from "./vault.js";

/**
 * Rejects titles carrying CLI output (`[area:Work]`), a flag that didn't parse (`--project`), or
 * a Tasks emoji field (`➕ 2026-10-12`), which would sit in the title instead of acting as a field.
 */
export function requireCleanTitle(title: string): string {
  const cleaned = cleanTitle(title);
  if (cleaned !== title.trim()) {
    throw new Error(
      `Title "${title}" contains CLI output or a task-app flag. Did you mean "${cleaned}" with the flag passed separately?`,
    );
  }
  const fields = fieldsInTitle(cleaned);
  if (fields.length) {
    throw new Error(
      `Title "${title}" contains a Tasks field (${fields.join(", ")}). Did you mean "${stripTitleFields(cleaned)}" with the date or value passed as a flag?`,
    );
  }
  return cleaned;
}
