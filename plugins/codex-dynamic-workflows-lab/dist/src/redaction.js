const textRedactions = [
    [/\brt_[A-Za-z0-9._-]{8,}\b/g, "rt_[REDACTED]"],
    [/\bsk-[A-Za-z0-9._-]{12,}\b/g, "sk-[REDACTED]"],
    [/\b(Bearer\s+)[A-Za-z0-9._~+/=-]{12,}\b/gi, "$1[REDACTED]"],
];
export function redactText(value) {
    return textRedactions.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), value);
}
export function redactValue(value) {
    if (typeof value === "string")
        return redactText(value);
    if (Array.isArray(value))
        return value.map((item) => redactValue(item));
    if (!value || typeof value !== "object")
        return value;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactValue(item)]));
}
