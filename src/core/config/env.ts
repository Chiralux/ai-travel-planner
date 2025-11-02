import { z } from "zod";

// Validate runtime environment variables required by the app.
const envSchema = z.object({
  NEXT_PUBLIC_APP_NAME: z.string().default("AI Travel Planner"),
  NEXT_PUBLIC_AMAP_WEB_KEY: z.string().optional(),
  NEXT_PUBLIC_AMAP_SECURITY_JS_CODE: z.string().optional(),
  NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: z.string().optional(),
  AMAP_REST_KEY: z.string().optional(),
  GOOGLE_MAPS_API_KEY: z.string().optional(),
  BAIDU_MAP_AK: z.string().optional(),
  MAPS_PROVIDER: z.string().optional(),
  AI_PROVIDER: z.string().optional(),
  ALIYUN_DASHSCOPE_API_KEY: z.string().optional(),
  IFLYTEK_APP_ID: z.string().optional(),
  IFLYTEK_API_KEY: z.string().optional(),
  IFLYTEK_API_SECRET: z.string().optional(),
  IFLYTEK_HOST: z.string().optional(),
  IFLYTEK_PATH: z.string().optional(),
  IFLYTEK_DOMAIN: z.string().optional(),
  SUPABASE_URL: z.string().optional(),
  SUPABASE_ANON_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  NEXT_TELEMETRY_DISABLED: z.string().optional(),
  REDIS_URL: z.string().optional(),
  LOGTAIL_SOURCE_TOKEN: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  GOOGLE_MAPS_PROXY_URL: z.string().optional()
});

export type AppEnv = z.infer<typeof envSchema>;

export function loadEnv(): AppEnv {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[env] Missing or invalid env vars:", parsed.error.flatten().fieldErrors);
    } else {
      /* Production hook: throw in stricter deployments */
      // throw new Error("Invalid environment configuration");
    }

    return envSchema.parse({});
  }

  if (process.env.NODE_ENV !== "production") {
    const missing = Object.entries(parsed.data).filter(([key, value]) =>
      key.startsWith("NEXT_PUBLIC") ? false : !value
    );

    if (missing.length > 0) {
      console.warn(
        "[env] Missing optional env vars:",
        missing.map(([key]) => key)
      );
    }
  }

  return parsed.data;
}
