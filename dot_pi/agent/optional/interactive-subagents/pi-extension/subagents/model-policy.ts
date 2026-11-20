type Model = { provider: string; id: string; baseUrl?: string };

export type SubagentModelContext = {
  model?: Model;
  modelRegistry?: { getAll(): readonly Model[] };
};

function localModel(model: Pick<Model, "provider" | "baseUrl">): boolean {
  if (["llama.cpp", "ollama", "lmstudio", "vllm"].includes(model.provider.toLowerCase())) return true;
  if (!model.baseUrl) return false;
  try {
    const host = new URL(model.baseUrl).hostname.toLowerCase().replace(/\.$/, "");
    return host === "localhost" || host.endsWith(".localhost") || host.startsWith("127.") ||
      host === "[::1]" || host === "0.0.0.0" || host === "[::]";
  } catch {
    return false;
  }
}

export function resolveSubagentModel(
  ctx: SubagentModelContext, override: string | undefined, profile: string | undefined, usingHerdr: boolean,
): string | undefined {
  const configured = usingHerdr ? process.env.PI_SUBAGENT_MODEL?.trim() || undefined : undefined;
  return override ?? profile ?? configured ?? (ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined);
}

export function assertSubagentModel(ctx: SubagentModelContext, model: string | undefined): void {
  const selector = model?.replace(/:(off|minimal|low|medium|high|xhigh)$/, "");
  const matched = ctx.modelRegistry?.getAll().filter(candidate =>
    selector === `${candidate.provider}/${candidate.id}` || selector === candidate.id,
  ) ?? [];
  const parentIsLocal = ctx.model && localModel(ctx.model);
  const selectedProvider = selector?.split("/")[0];
  const selectedIsLocal = (selectedProvider && localModel({ provider: selectedProvider })) ||
    matched.some(localModel);
  if (selectedIsLocal || (parentIsLocal && (matched.length !== 1 || !selector?.includes("/")))) {
    throw new Error("Herdr subagents require a hosted model when using a local provider. Use /subagents:spawn <agent> --model <provider/model> <task> or set PI_SUBAGENT_MODEL.");
  }
}
