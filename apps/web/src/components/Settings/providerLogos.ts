import type { AiProviderId } from "../../services/ai/aiConfig";

// Neutral text marks replace unregistered third-party logo binaries.
export const PROVIDER_LOGOS: Partial<Record<AiProviderId, string>> = {};
