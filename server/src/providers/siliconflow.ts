import { OpenAICompatibleProvider } from "./openaiCompatible.js";

export function createSiliconFlowProvider(env = process.env) {
  return new OpenAICompatibleProvider({
    id: "siliconflow",
    label: "SiliconFlow",
    baseURL: env.SILICONFLOW_BASE_URL || "https://api.siliconflow.cn/v1",
    apiKey: env.SILICONFLOW_API_KEY,
    model: env.SILICONFLOW_MODEL || "deepseek-ai/DeepSeek-V3",
  });
}

export function createOpenAIProvider(env = process.env) {
  return new OpenAICompatibleProvider({
    id: "openai",
    label: "OpenAI-compatible",
    baseURL: env.OPENAI_BASE_URL || "https://api.openai.com/v1",
    apiKey: env.OPENAI_API_KEY,
    model: env.OPENAI_MODEL || "gpt-4o-mini",
  });
}
