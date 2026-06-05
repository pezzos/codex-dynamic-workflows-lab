export const routeProfiles = Object.freeze({
    scout: {
        id: "scout",
        reasoningEffort: "low",
        description: "Cheap read-only map or inventory worker.",
    },
    reviewer: {
        id: "reviewer",
        reasoningEffort: "medium",
        description: "Focused bounded review worker.",
    },
    security: {
        id: "security",
        reasoningEffort: "high",
        description: "Higher-risk security or correctness worker.",
    },
    synthesizer: {
        id: "synthesizer",
        reasoningEffort: "high",
        description: "Final synthesis worker.",
    },
});
export function routeProfileIds() {
    return Object.keys(routeProfiles);
}
export function resolveAgentProfile(options, policy) {
    if (!options.profile)
        return options;
    const profile = routeProfiles[options.profile];
    if (!profile)
        throw new Error(`unsupported route profile: ${options.profile}`);
    if (policy.allowedRouteProfiles.length > 0 && !policy.allowedRouteProfiles.includes(options.profile)) {
        throw new Error(`route profile not allowed by policy: ${options.profile}`);
    }
    return {
        ...options,
        reasoningEffort: options.reasoningEffort ?? profile.reasoningEffort,
    };
}
