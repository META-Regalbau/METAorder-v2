import { z } from "zod";

export const cpqSeveritySchema = z.enum(["hard", "soft", "default", "trigger"]);
export const cpqClassificationSchema = z.enum(["A", "B", "C"]);
const customerGroupAliasSchema = z.preprocess((raw) => {
  const normalized = String(raw ?? "").trim().toLowerCase();
  if (!normalized) return "b2c";
  if (normalized === "b2b" || normalized === "business") return "b2b_standard";
  if (normalized.includes("industrie") || normalized.includes("industrial")) return "b2b_industrie";
  if (normalized.includes("b2b") || normalized.includes("company")) return "b2b_standard";
  return normalized;
}, z.enum(["b2c", "b2b_standard", "b2b_industrie"]));
export const cpqCustomerGroupSchema = customerGroupAliasSchema;

export const cpqFrameSchema = z.object({
  heightMm: z.number().int().positive(),
  depthMm: z.number().int().positive(),
  widthMm: z.number().int().positive(),
  surface: z.string().optional(),
  maxFeldlastKg: z.number().int().positive().default(2400),
  anchoringIncluded: z.boolean().default(false),
});

export const cpqShelfSchema = z.object({
  material: z.string(),
  maxFachlastKg: z.number().int().positive(),
  depthMm: z.number().int().positive(),
  widthMm: z.number().int().positive(),
  count: z.number().int().positive().default(1),
  position: z.enum(["regular", "abdeckboden"]).default("regular"),
  hasSystemlochung: z.boolean().optional(),
});

export const cpqAccessorySchema = z.object({
  accessoryType: z.string(),
  count: z.number().int().positive().default(1),
  requiresSystemlochung: z.boolean().default(false),
  requiresAnchoring: z.boolean().default(false),
  compatibleWidthsMm: z.array(z.number().int().positive()).optional(),
  compatibleDepthsMm: z.array(z.number().int().positive()).optional(),
});

export const cpqConfigurationSchema = z.object({
  systemVariant: z.string().default("clip"),
  connectionType: z.enum(["clinch", "s3"]).default("clinch"),
  frame: cpqFrameSchema,
  shelves: z.array(cpqShelfSchema).min(1),
  accessories: z.array(cpqAccessorySchema).default([]),
  application: z.string().optional(),
  surface: z.string().optional(),
  ralColor: z.string().nullable().optional(),
  quantity: z.number().int().positive().default(1),
  leadTimeDays: z.number().int().positive().optional(),
  deliveryCountry: z.string().default("DE"),
});

export const cpqConstraintRuleSchema = z.object({
  ruleId: z.string(),
  category: z.string(),
  severity: cpqSeveritySchema,
  expression: z.string().optional(),
  messageDe: z.string(),
  metadata: z.record(z.unknown()).optional(),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
});

export const cpqValidationContextSchema = z.object({
  customerGroup: cpqCustomerGroupSchema.default("b2c"),
  salesChannelId: z.string().min(1).optional(),
  customerId: z.string().min(1).optional(),
});

export const cpqValidateRequestSchema = z.object({
  context: cpqValidationContextSchema,
  configuration: cpqConfigurationSchema,
  rules: z.array(cpqConstraintRuleSchema).optional(),
  systemId: z.string().min(1).optional(),
});

export const cpqEffectiveFachlastEntrySchema = z.object({
  shelfIndex: z.number().int().nonnegative(),
  nominalKg: z.number(),
  effectiveKg: z.number(),
  reducedByFieldLimit: z.boolean(),
  reason: z.string().optional(),
});

export const cpqValidationResultSchema = z.object({
  valid: z.boolean(),
  classification: cpqClassificationSchema,
  errors: z.array(z.string()),
  disclaimers: z.array(z.string()),
  defaultsApplied: z.array(z.string()),
  computed: z.object({
    effectiveFachlasten: z.array(cpqEffectiveFachlastEntrySchema),
  }),
});

export const cpqSubmitRequestSchema = cpqValidateRequestSchema.extend({
  systemId: z.string().min(1),
  name: z.string().min(1).optional(),
  customerId: z.string().min(1).optional(),
});

export const cpqTransferCartItemSchema = z.object({
  product_id: z.string().min(1),
  quantity: z.number().int().positive().default(1),
  product_number: z.string().min(1).optional(),
});

export const cpqAdapterCartTransferSchema = z.object({
  cart_items: z.array(cpqTransferCartItemSchema).min(1).max(50),
  customer_id: z.string().min(1).optional(),
  sales_channel_id: z.string().min(1).optional(),
  create_offer: z.boolean().optional(),
});

export const cpqSubmitTransferRequestSchema = cpqSubmitRequestSchema.extend({
  cartTransfer: cpqAdapterCartTransferSchema.optional(),
});

export type CpqSeverity = z.infer<typeof cpqSeveritySchema>;
export type CpqClassification = z.infer<typeof cpqClassificationSchema>;
export type CpqCustomerGroup = z.infer<typeof cpqCustomerGroupSchema>;
export type CpqFrameInput = z.infer<typeof cpqFrameSchema>;
export type CpqShelfInput = z.infer<typeof cpqShelfSchema>;
export type CpqAccessoryInput = z.infer<typeof cpqAccessorySchema>;
export type CpqConfigurationInput = z.infer<typeof cpqConfigurationSchema>;
export type CpqConstraintRule = z.infer<typeof cpqConstraintRuleSchema>;
export type CpqValidationContext = z.infer<typeof cpqValidationContextSchema>;
export type CpqValidateRequest = z.infer<typeof cpqValidateRequestSchema>;
export type CpqEffectiveFachlastEntry = z.infer<typeof cpqEffectiveFachlastEntrySchema>;
export type CpqValidationResult = z.infer<typeof cpqValidationResultSchema>;
