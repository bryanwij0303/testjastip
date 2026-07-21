import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
  server: {
    AUTH_TOKEN: z.string().optional(),

    RESEND_API_KEY: z.string().optional(),

    UPSTASH_REDIS_REST_URL: z.string().optional(),
    UPSTASH_REDIS_REST_TOKEN: z.string().optional(),

    TELEGRAM_BOT_TOKEN: z.string().optional(),
    TELEGRAM_CHAT_ID: z.string().optional(),

    SELLER_NAME: z.string().optional(),
    SELLER_ADDRESS: z.string().optional(),
    SELLER_VAT_NO: z.string().optional(),
    SELLER_EMAIL: z.string().email().optional(),
    SELLER_ACCOUNT_NUMBER: z.string().optional(),
    SELLER_SWIFT_BIC: z.string().optional(),

    BUYER_NAME: z.string().optional(),
    BUYER_ADDRESS: z.string().optional(),
    BUYER_VAT_NO: z.string().optional(),
    BUYER_EMAIL: z.string().email().optional(),

    INVOICE_NET_PRICE: z.string().optional(),
    INVOICE_EMAIL_RECIPIENT: z.string().email().optional(),
    INVOICE_EMAIL_COMPANY_TO: z.string().email().optional(),

    GOOGLE_DRIVE_PARENT_FOLDER_ID: z.string().optional(),
    GOOGLE_DRIVE_CLIENT_EMAIL: z.string().email().optional(),
    GOOGLE_DRIVE_PRIVATE_KEY: z.string().optional(),

    GITHUB_TOKEN: z.string().optional(),
  },
  client: {
    NEXT_PUBLIC_SENTRY_DSN: z.string().optional(),
  },
  runtimeEnv: {
    NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,

    AUTH_TOKEN: process.env.AUTH_TOKEN,

    RESEND_API_KEY: process.env.RESEND_API_KEY,

    UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL,
    UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN,

    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
    TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID,

    SELLER_NAME: process.env.SELLER_NAME,
    SELLER_ADDRESS: process.env.SELLER_ADDRESS,
    SELLER_VAT_NO: process.env.SELLER_VAT_NO,
    SELLER_EMAIL: process.env.SELLER_EMAIL,
    SELLER_ACCOUNT_NUMBER: process.env.SELLER_ACCOUNT_NUMBER,
    SELLER_SWIFT_BIC: process.env.SELLER_SWIFT_BIC,

    BUYER_NAME: process.env.BUYER_NAME,
    BUYER_ADDRESS: process.env.BUYER_ADDRESS,
    BUYER_VAT_NO: process.env.BUYER_VAT_NO,
    BUYER_EMAIL: process.env.BUYER_EMAIL,

    INVOICE_NET_PRICE: process.env.INVOICE_NET_PRICE,
    INVOICE_EMAIL_RECIPIENT: process.env.INVOICE_EMAIL_RECIPIENT,
    INVOICE_EMAIL_COMPANY_TO: process.env.INVOICE_EMAIL_COMPANY_TO,

    GOOGLE_DRIVE_PARENT_FOLDER_ID: process.env.GOOGLE_DRIVE_PARENT_FOLDER_ID,
    GOOGLE_DRIVE_CLIENT_EMAIL: process.env.GOOGLE_DRIVE_CLIENT_EMAIL,
    GOOGLE_DRIVE_PRIVATE_KEY: process.env.GOOGLE_DRIVE_PRIVATE_KEY,

    GITHUB_TOKEN: process.env.GITHUB_TOKEN,
  },
  // emptyStringAsUndefined: true,
});
