import { z } from "zod";

const booleanString = z
  .enum(["true", "false"])
  .default("false")
  .transform((value) => value === "true");

const optionalInteger = z.preprocess(
  (value) => (value === "" || value === undefined ? undefined : value),
  z.coerce.number().int().positive().optional(),
);

const schema = z
  .object({
    AMO_BASE_URL: z.string().url(),
    AMO_ACCESS_TOKEN: z.string().min(1),
    AMO_PIPELINE_ID: z.coerce.number().int().positive(),
    AMO_SOURCE_STATUS_ID: z.coerce.number().int().positive(),
    AMO_SUCCESS_STATUS_ID: optionalInteger,
    AMO_WRITE_MODE: z.enum(["enrich", "new_lead"]).default("enrich"),
    AMO_OUTPUT_PIPELINE_ID: optionalInteger,
    AMO_OUTPUT_STATUS_ID: optionalInteger,
    AMO_COMPANY_WEBSITE_FIELD_ID: optionalInteger,
    AMO_CONTACT_POSITION_FIELD_ID: optionalInteger,
    CONTACT_SEARCH_OPERATION: z.enum(["research", "sync-approved"]).default("research"),
    CONTACT_SEARCH_MODE: z.enum(["dry-run", "apply"]).default("dry-run"),
    MAX_COMPANIES: z.coerce.number().int().min(1).max(250).default(10),
    MAX_CONTACTS_PER_COMPANY: z.coerce.number().int().min(1).max(20).default(5),
    MAX_PAGES_PER_SITE: z.coerce.number().int().min(1).max(30).default(8),
    MIN_CONTACT_SCORE: z.coerce.number().int().min(0).max(100).default(35),
    INCLUDE_GENERIC_EMAILS: booleanString.default("true"),
    CREATE_FOLLOW_UP_TASK: booleanString.default("true"),
    FOLLOW_UP_DAYS: z.coerce.number().int().min(1).max(30).default(2),
    TARGET_ROLES: z
      .string()
      .default(
        "собственник|основатель|генеральный директор|директор по маркетингу|бренд-менеджер|директор по персоналу|обучение и развитие|внутренние коммуникации|охрана труда|промышленная безопасность",
      ),
    TAVILY_API_KEY: z.string().optional(),
    HUNTER_API_KEY: z.string().optional(),
    HUNTER_VERIFY_EMAILS: booleanString,
    OPENAI_API_KEY: z.string().optional(),
    OPENAI_MODEL: z.string().default("gpt-5.6-luna"),
    GEMINI_API_KEY: z.string().optional(),
    GEMINI_MODEL: z.string().default("gemini-3.1-flash-lite"),
    SEARXNG_INSTANCES: z.string().optional(),
    GITHUB_OSINT_TOKEN: z.string().optional(),
    SUPABASE_URL: z.string().url().optional(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
    HTTP_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(15000),
    HTTP_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
    USER_AGENT: z.string().default("AnixContactResearchBot/0.1 (+https://studio.anix-ai.pro)"),
  })
  .superRefine((value, ctx) => {
    if (value.AMO_WRITE_MODE === "new_lead") {
      if (!value.AMO_OUTPUT_PIPELINE_ID) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["AMO_OUTPUT_PIPELINE_ID"], message: "required for new_lead" });
      }
      if (!value.AMO_OUTPUT_STATUS_ID) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["AMO_OUTPUT_STATUS_ID"], message: "required for new_lead" });
      }
    }
    if (Boolean(value.SUPABASE_URL) !== Boolean(value.SUPABASE_SERVICE_ROLE_KEY)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [value.SUPABASE_URL ? "SUPABASE_SERVICE_ROLE_KEY" : "SUPABASE_URL"],
        message: "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be configured together",
      });
    }
    if (value.CONTACT_SEARCH_OPERATION === "sync-approved" && value.CONTACT_SEARCH_MODE !== "apply") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["CONTACT_SEARCH_MODE"], message: "sync-approved requires apply mode" });
    }
  });

export type Config = ReturnType<typeof loadConfig>;

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = schema.parse({
    ...env,
    AMO_BASE_URL: env.AMO_BASE_URL?.replace(/\/$/, ""),
    TAVILY_API_KEY: nonEmpty(env.TAVILY_API_KEY),
    HUNTER_API_KEY: nonEmpty(env.HUNTER_API_KEY),
    OPENAI_API_KEY: nonEmpty(env.OPENAI_API_KEY),
    SUPABASE_URL: nonEmpty(env.SUPABASE_URL)?.replace(/\/$/, ""),
    SUPABASE_SERVICE_ROLE_KEY: nonEmpty(env.SUPABASE_SERVICE_ROLE_KEY),
  });

  return {
    amo: {
      baseUrl: parsed.AMO_BASE_URL,
      accessToken: parsed.AMO_ACCESS_TOKEN,
      pipelineId: parsed.AMO_PIPELINE_ID,
      sourceStatusId: parsed.AMO_SOURCE_STATUS_ID,
      successStatusId: parsed.AMO_SUCCESS_STATUS_ID,
      writeMode: parsed.AMO_WRITE_MODE,
      outputPipelineId: parsed.AMO_OUTPUT_PIPELINE_ID,
      outputStatusId: parsed.AMO_OUTPUT_STATUS_ID,
      companyWebsiteFieldId: parsed.AMO_COMPANY_WEBSITE_FIELD_ID,
      contactPositionFieldId: parsed.AMO_CONTACT_POSITION_FIELD_ID,
    },
    run: {
      operation: parsed.CONTACT_SEARCH_OPERATION,
      mode: parsed.CONTACT_SEARCH_MODE,
      maxCompanies: parsed.MAX_COMPANIES,
      maxContactsPerCompany: parsed.MAX_CONTACTS_PER_COMPANY,
      maxPagesPerSite: parsed.MAX_PAGES_PER_SITE,
      minContactScore: parsed.MIN_CONTACT_SCORE,
      includeGenericEmails: parsed.INCLUDE_GENERIC_EMAILS,
      createFollowUpTask: parsed.CREATE_FOLLOW_UP_TASK,
      followUpDays: parsed.FOLLOW_UP_DAYS,
      targetRoles: parsed.TARGET_ROLES.split("|").map((role) => role.trim()).filter(Boolean),
    },
    providers: {
      tavilyApiKey: parsed.TAVILY_API_KEY,
      hunterApiKey: parsed.HUNTER_API_KEY,
      hunterVerifyEmails: parsed.HUNTER_VERIFY_EMAILS,
      openaiApiKey: parsed.OPENAI_API_KEY,
      openaiModel: parsed.OPENAI_MODEL,
      geminiApiKey: nonEmpty(parsed.GEMINI_API_KEY),
      geminiModel: parsed.GEMINI_MODEL,
      searxngInstances: nonEmpty(parsed.SEARXNG_INSTANCES)?.split(",").map((value) => value.trim()).filter(Boolean),
      githubToken: nonEmpty(parsed.GITHUB_OSINT_TOKEN),
    },
    storage:
      parsed.SUPABASE_URL && parsed.SUPABASE_SERVICE_ROLE_KEY
        ? { url: parsed.SUPABASE_URL, serviceRoleKey: parsed.SUPABASE_SERVICE_ROLE_KEY }
        : null,
    http: {
      timeoutMs: parsed.HTTP_TIMEOUT_MS,
      retries: parsed.HTTP_RETRIES,
      userAgent: parsed.USER_AGENT,
    },
  };
}
