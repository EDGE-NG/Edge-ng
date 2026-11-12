import { Module } from '@nestjs/common';

/**
 * The LLM gateway: the only code that talks to AI providers. Prompts, schemas, validator, model routing, cost metering.
 *
 * PRD: Section 5, REQ-LLM-1 to REQ-LLM-14, tables llm_runs / prompt_versions (9.3). AI logic: Daniel. Server wiring: Sheyi.
 * Modules talk to each other through their exported services, never through
 * each other's tables (REQ-ARC-1).
 */
@Module({})
export class LlmModule {}
