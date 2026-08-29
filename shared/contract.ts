/**
 * shared/contract.ts — TypeScript types inferred from the zod schemas.
 * Import types from here; import schemas from ./schemas for runtime validation.
 * The two can never drift: every type is z.infer of its schema.
 */
import { z } from 'zod';
import {
  AnalyzeResponseSchema,
  AnalyzerBeatSchema,
  AnalyzerOutputSchema,
  ApiErrorSchema,
  AudioBeatMapEntrySchema,
  BeatGenerationSchema,
  BeatSchema,
  BoundaryMapSchema,
  CameraAngleSchema,
  ContinuityLockSchema,
  CutTransitionSchema,
  FidelityModeSchema,
  FirstFrameSourceSchema,
  LoopSchema,
  MotionCadenceSchema,
  MotionWindowDetailSchema,
  PacingSchema,
  PerceptionOutputSchema,
  QaVerdictSchema,
  PostProcessingSchema,
  ProductionRouteStepSchema,
  RealismTellSchema,
  SecondaryMotionSchema,
  ShotSizeSchema,
  TrimSpecSchema,
  CameraDynamicsSchema,
  CameraSetupKindSchema,
  CameraSetupSchema,
  ContentRatingSchema,
  EditPlanSchema,
  FootageAestheticSchema,
  FootageStyleSchema,
  FormatDnaSchema,
  FormatSummarySchema,
  FormatTypeSchema,
  LipSyncPlanSchema,
  FrameSpecSchema,
  AttentionPlanSchema,
  TransplantPlanSchema,
  ViralMechanicsSchema,
  HookChannelsSchema,
  GenerationRunSchema,
  GenerationStatusSchema,
  GenerationVerdictSchema,
  GenerationVerdictPatchSchema,
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
export type AttentionPlan = z.infer<typeof AttentionPlanSchema>;
export type TransplantPlan = z.infer<typeof TransplantPlanSchema>;
export type ViralMechanics = z.infer<typeof ViralMechanicsSchema>;
export type HookChannels = z.infer<typeof HookChannelsSchema>;
export type GenerationVerdict = z.infer<typeof GenerationVerdictSchema>;
export type GenerationVerdictPatch = z.infer<typeof GenerationVerdictPatchSchema>;
export type SdFrameType = z.infer<typeof SdFrameTypeSchema>;
export type CameraSetupKind = z.infer<typeof CameraSetupKindSchema>;

export type FormatType = z.infer<typeof FormatTypeSchema>;
export type FootageStyle = z.infer<typeof FootageStyleSchema>;
export type FootageAesthetic = z.infer<typeof FootageAestheticSchema>;
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

// ── v3 filming-fidelity types ──
export type ShotSize = z.infer<typeof ShotSizeSchema>;
export type CameraAngle = z.infer<typeof CameraAngleSchema>;
export type CutTransition = z.infer<typeof CutTransitionSchema>;
export type FidelityMode = z.infer<typeof FidelityModeSchema>;
export type FirstFrameSource = z.infer<typeof FirstFrameSourceSchema>;
export type RealismTell = z.infer<typeof RealismTellSchema>;
export type SecondaryMotion = z.infer<typeof SecondaryMotionSchema>;
export type Pacing = z.infer<typeof PacingSchema>;
export type AudioBeatMapEntry = z.infer<typeof AudioBeatMapEntrySchema>;
export type Loop = z.infer<typeof LoopSchema>;
export type MotionCadence = z.infer<typeof MotionCadenceSchema>;
export type AnalyzerBeat = z.infer<typeof AnalyzerBeatSchema>;
export type PerceptionOutput = z.infer<typeof PerceptionOutputSchema>;
export type BoundaryMap = z.infer<typeof BoundaryMapSchema>;
export type MotionWindowDetail = z.infer<typeof MotionWindowDetailSchema>;
export type ContinuityLock = z.infer<typeof ContinuityLockSchema>;
export type TrimSpec = z.infer<typeof TrimSpecSchema>;
export type PostProcessing = z.infer<typeof PostProcessingSchema>;
export type ProductionRouteStep = z.infer<typeof ProductionRouteStepSchema>;
export type QaVerdict = z.infer<typeof QaVerdictSchema>;

export type Job = z.infer<typeof JobSchema>;
export type ApiError = z.infer<typeof ApiErrorSchema>;
export type AnalyzeResponse = z.infer<typeof AnalyzeResponseSchema>;
export type FormatSummary = z.infer<typeof FormatSummarySchema>;

/** Marker stored in D1 schema_version column for pre-rebuild KV entries. */
export const LEGACY_SCHEMA_VERSION = '0-legacy';
export const CURRENT_SCHEMA_VERSION = '1';
