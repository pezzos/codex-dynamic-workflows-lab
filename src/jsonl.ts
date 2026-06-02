export interface ParsedJsonl {
  events: unknown[];
  warnings: string[];
}

export function parseNoisyJsonl(input: string): ParsedJsonl {
  const events: unknown[] = [];
  const warnings: string[] = [];
  const lines = input.split(/\r?\n/);

  for (const [index, raw] of lines.entries()) {
    const line = raw.trim();
    if (!line) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      warnings.push(`line ${index + 1}: non-json output ignored`);
    }
  }

  return { events, warnings };
}
