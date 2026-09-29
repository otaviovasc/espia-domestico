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

export const AdProjectConfigSchema = z.object({
  variationCount: z.number().int().min(1).max(20).default(5),
  texts: z.array(z.string().trim().min(1).max(280)).min(1).max(20),
  selectedClipIds: z.array(z.number().int().positive()).max(50).default([]),
  musicAssetId: z.number().int().positive().nullable().default(null),
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

export const AdAssetKindSchema = z.enum(['clip', 'music'])

export type AdProjectConfig = z.infer<typeof AdProjectConfigSchema>
export type CreateAdProjectInput = z.infer<typeof CreateAdProjectSchema>
export type UpdateAdProjectInput = z.infer<typeof UpdateAdProjectSchema>
export type AdAssetKind = z.infer<typeof AdAssetKindSchema>
