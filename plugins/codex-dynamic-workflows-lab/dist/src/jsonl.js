export function parseNoisyJsonl(input) {
    const events = [];
    const warnings = [];
    const lines = input.split(/\r?\n/);
    for (const [index, raw] of lines.entries()) {
        const line = raw.trim();
        if (!line)
            continue;
        try {
            events.push(JSON.parse(line));
        }
        catch {
            warnings.push(`line ${index + 1}: non-json output ignored`);
        }
    }
    return { events, warnings };
}
