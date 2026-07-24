/**
 * shared/contract.ts — TypeScript types inferred from the zod schemas.
 * Import types from here; import schemas from ./schemas for runtime validation.
 * The two can never drift: every type is z.infer of its schema.
 */
import { z } from 'zod';
import {
  AnalyzeResponseSchema,
  AnalyzerOutputSchema,
  ApiErrorSchema,
  BeatGenerationSchema,
  BeatSchema,
  CameraDynamicsSchema,
  CameraSetupKindSchema,
  CameraSetupSchema,
  ContentRatingSchema,
  EditPlanSchema,
  FormatDnaSchema,
  FormatSummarySchema,
  FormatTypeSchema,
  LipSyncPlanSchema,
  FrameSpecSchema,
  GenerationRunSchema,
  GenerationStatusSchema,
  HookSchema,
  IdeationSchema,
  JobSchema,
  ModelProfileSchema,
  PlatformSchema,
  SdFrameTypeSchema,
  SourceMetaSchema,
  VariationStrengthSchema,
  VideoFormatSchema,
  VideoModelChoiceSchema,
  ViralityForecastSchema,
  ViralityScorecardSchema,
} from './schemas';

export type Platform = z.infer<typeof PlatformSchema>;
export type ContentRating = z.infer<typeof ContentRatingSchema>;
export type VideoModelChoice = z.infer<typeof VideoModelChoiceSchema>;
export type VideoFormat = z.infer<typeof VideoFormatSchema>;
export type VariationStrength = z.infer<typeof VariationStrengthSchema>;
export type GenerationStatus = z.infer<typeof GenerationStatusSchema>;
export type SdFrameType = z.infer<typeof SdFrameTypeSchema>;
export type CameraSetupKind = z.infer<typeof CameraSetupKindSchema>;

export type FormatType = z.infer<typeof FormatTypeSchema>;
export type CameraDynamics = z.infer<typeof CameraDynamicsSchema>;
export type ViralityScorecard = z.infer<typeof ViralityScorecardSchema>;
export type ViralityForecast = z.infer<typeof ViralityForecastSchema>;

export type SourceMeta = z.infer<typeof SourceMetaSchema>;
export type CameraSetup = z.infer<typeof CameraSetupSchema>;
export type Hook = z.infer<typeof HookSchema>;
export type Beat = z.infer<typeof BeatSchema>;
export type FrameSpec = z.infer<typeof FrameSpecSchema>;

export type FormatDna = z.infer<typeof FormatDnaSchema>;
export type AnalyzerOutput = z.infer<typeof AnalyzerOutputSchema>;
export type ModelProfile = z.infer<typeof ModelProfileSchema>;

export type BeatGeneration = z.infer<typeof BeatGenerationSchema>;
export type EditPlan = z.infer<typeof EditPlanSchema>;
export type LipSyncPlan = z.infer<typeof LipSyncPlanSchema>;
export type Ideation = z.infer<typeof IdeationSchema>;
export type GenerationRun = z.infer<typeof GenerationRunSchema>;

export type Job = z.infer<typeof JobSchema>;
export type ApiError = z.infer<typeof ApiErrorSchema>;
export type AnalyzeResponse = z.infer<typeof AnalyzeResponseSchema>;
export type FormatSummary = z.infer<typeof FormatSummarySchema>;

/** Marker stored in D1 schema_version column for pre-rebuild KV entries. */
export const LEGACY_SCHEMA_VERSION = '0-legacy';
export const CURRENT_SCHEMA_VERSION = '1';
