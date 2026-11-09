import "server-only";
import { prisma } from "@/lib/db";
import { createClaudeFactGenerator } from "./claude-generator";
import { createOpenAIFactGenerator } from "./openai-generator";
import { createPrismaFactRepository } from "./prisma-repository";
import { createFactService, type FactService } from "./service";

let service: FactService | undefined;

/**
 * Production wiring: Postgres repository + an LLM fact generator.
 * Claude is used when ANTHROPIC_API_KEY is set, otherwise OpenAI. Both sit
 * behind the same FactGenerator interface, so caching, locking and fallback
 * logic don't depend on the provider.
 */
export function getFactService(): FactService {
  service ??= createFactService({
    repo: createPrismaFactRepository(prisma),
    generator: process.env.ANTHROPIC_API_KEY ? createClaudeFactGenerator() : createOpenAIFactGenerator(),
  });
  return service;
}
