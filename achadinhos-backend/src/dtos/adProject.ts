import { z } from 'zod'

export const AdColorPresetSchema = z.enum(['natural', 'vibrant', 'warm', 'cool', 'none'])

export const AdTextStyleSchema = z
  .object({
    fontSize: z.number().int().min(36).max(140).default(72),
    positionY: z.number().int().min(15).max(85).default(52),
    fontColor: z.string().regex(/^#[0-9a-f]{6}$/i).default('#FFFFFF'),
    borderColor: z.string().regex(/^#[0-9a-f]{6}$/i).default('#000000'),
    borderWidth: z.number().int().min(0).max(12).default(6),
  })
  .default({})

export const PreviewAdCaptionsSchema = z.object({
  texts: z.array(z.string().min(1).max(280)).min(1).max(30),
  output: z.object({
    width: z.number().int().min(360).max(2160),
    height: z.number().int().min(640).max(3840),
  }),
  textStyle: AdTextStyleSchema,
})

export const AdClipEditSchema = z.object({
  trimStart: z.number().min(0).max(3600).default(0),
  trimEnd: z.number().min(0).max(3600).nullable().default(null),
  speed: z.union([
    z.literal(0.5),
    z.literal(0.75),
    z.literal(1),
    z.literal(1.25),
    z.literal(1.5),
    z.literal(2),
  ]).default(1),
  framingOverride: z.boolean().default(false),
  focusX: z.number().int().min(0).max(100).default(50),
  focusY: z.number().int().min(0).max(100).default(50),
  zoom: z.number().min(1).max(3).default(1),
})

export const AdTransitionSchema = z
  .object({
    preset: z
      .enum(['cut', 'fade', 'dissolve', 'slide-left', 'slide-up', 'zoom'])
      .default('cut'),
    durationSeconds: z.number().min(0.1).max(1.5).default(0.35),
    sfx: z.enum(['none', 'whoosh', 'pop', 'click']).default('none'),
    sfxVolume: z.number().min(0).max(0.5).default(0.18),
  })
  .default({})

const visualPresetValues = {
  natural: { brightness: 0, contrast: 1, saturation: 1, sharpness: 0, temperature: 0, vignette: 0, grain: 0, glow: 0 },
  'clean-product': { brightness: 0.03, contrast: 1.07, saturation: 1.08, sharpness: 0.65, temperature: -0.03, vignette: 0.03, grain: 0, glow: 0.08 },
  'warm-ugc': { brightness: 0.02, contrast: 1.04, saturation: 1.1, sharpness: 0.3, temperature: 0.25, vignette: 0.05, grain: 0.03, glow: 0.06 },
  vivid: { brightness: 0.02, contrast: 1.1, saturation: 1.28, sharpness: 0.55, temperature: 0.03, vignette: 0.06, grain: 0.02, glow: 0.08 },
  cinematic: { brightness: -0.02, contrast: 1.14, saturation: 0.9, sharpness: 0.35, temperature: -0.12, vignette: 0.25, grain: 0.04, glow: 0.06 },
  custom: { brightness: 0, contrast: 1, saturation: 1, sharpness: 0, temperature: 0, vignette: 0, grain: 0, glow: 0 },
} as const

export const AdVisualEffectsSchema = z
  .object({
    preset: z
      .enum(['natural', 'clean-product', 'warm-ugc', 'vivid', 'cinematic', 'custom'])
      .default('natural'),
    brightness: z.number().min(-1).max(1).optional(),
    contrast: z.number().min(0.5).max(2).optional(),
    saturation: z.number().min(0).max(3).optional(),
    sharpness: z.number().min(0).max(2).optional(),
    temperature: z.number().min(-1).max(1).optional(),
    vignette: z.number().min(0).max(1).optional(),
    grain: z.number().min(0).max(1).optional(),
    glow: z.number().min(0).max(1).optional(),
  })
  .default({})
  .transform((effects) => ({ ...visualPresetValues[effects.preset], ...effects }))

export const AdHookSchema = z
  .object({
    enabled: z.boolean().default(false),
    clipAssetId: z.number().int().positive().nullable().default(null),
    durationSeconds: z.number().min(0.5).max(5).default(1.5),
    text: z.string().trim().max(120).default(''),
  })
  .default({})

export const AdMusicTrackSchema = z
  .object({
    assetId: z.number().int().positive(),
    volume: z.number().min(0).max(1).default(0.8),
    startSeconds: z.number().min(0).max(60).default(0),
    endSeconds: z.number().min(0).max(60).nullable().default(null),
    sourceStartSeconds: z.number().min(0).max(3600).default(0),
    fadeInSeconds: z.number().min(0).max(5).default(0),
    fadeOutSeconds: z.number().min(0).max(5).default(0.8),
  })
  .superRefine((track, context) => {
    if (track.endSeconds !== null && track.endSeconds <= track.startSeconds) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endSeconds'],
        message: 'endSeconds deve ser maior que startSeconds',
      })
    }
  })

export const AdProjectConfigSchema = z.object({
  variationCount: z.number().int().min(1).max(20).default(5),
  texts: z.array(z.string().trim().min(1).max(280)).min(1).max(20),
  selectedClipIds: z.array(z.number().int().positive()).max(50).default([]),
  clipEdits: z
    .record(z.string().regex(/^[1-9]\d*$/), AdClipEditSchema)
    .default({}),
  musicAssetId: z.number().int().positive().nullable().default(null),
  musicVolume: z.number().min(0).max(1).default(0.8),
  musicTracks: z.array(AdMusicTrackSchema).max(8).default([]),
  timing: z.discriminatedUnion('mode', [
    z.object({ mode: z.literal('fixed'), seconds: z.number().min(0.5).max(15).default(2.5) }),
    z.object({ mode: z.literal('beat') }),
  ]),
  output: z
    .object({
      width: z.number().int().min(360).max(2160).default(1080),
      height: z.number().int().min(640).max(3840).default(1920),
      durationSeconds: z.number().min(3).max(60).default(15),
      fps: z.union([z.literal(24), z.literal(25), z.literal(30)]).default(30),
    })
    .default({}),
  framing: z.object({
    mode: z.enum(['cover', 'contain-blur', 'contain-solid']).default('cover'),
    focusX: z.number().int().min(0).max(100).default(50),
    focusY: z.number().int().min(0).max(100).default(50),
    backgroundColor: z.string().regex(/^#[0-9a-f]{6}$/i).default('#101018'),
  }).default({}),
  colorPreset: AdColorPresetSchema.default('natural'),
  transition: AdTransitionSchema,
  visualEffects: AdVisualEffectsSchema,
  hook: AdHookSchema,
  textStyle: AdTextStyleSchema,
})

export const CreateAdProjectSchema = z.object({
  name: z.string().trim().min(1).max(120),
  config: AdProjectConfigSchema,
})

export const UpdateAdProjectSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  config: AdProjectConfigSchema.optional(),
})

export const PreviewAdTimingSchema = z.object({
  config: AdProjectConfigSchema,
})

export const AdAssetKindSchema = z.enum(['clip', 'music'])

export const ImportAdMusicSchema = z.object({
  url: z.string().trim().url().max(2048),
  confirmRights: z.literal(true),
})

export type AdProjectConfig = z.infer<typeof AdProjectConfigSchema>
export type CreateAdProjectInput = z.infer<typeof CreateAdProjectSchema>
export type UpdateAdProjectInput = z.infer<typeof UpdateAdProjectSchema>
export type ImportAdMusicInput = z.infer<typeof ImportAdMusicSchema>
export type AdAssetKind = z.infer<typeof AdAssetKindSchema>
export type PreviewAdCaptionsInput = z.infer<typeof PreviewAdCaptionsSchema>
