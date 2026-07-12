import { createStart, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";

const ensureSupabaseServerEnv = createMiddleware({ type: "function" }).server(
  async ({ next }) => {
    process.env.SUPABASE_URL ||= "https://xyxanewatmrekdqowqao.supabase.co";
    process.env.SUPABASE_PUBLISHABLE_KEY ||= "sb_publishable_uBdGKhTkSyYWE3SJQXa-PA_wAxapy9_";
    return next();
  },
);

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

export const startInstance = createStart(() => ({
  functionMiddleware: [ensureSupabaseServerEnv, attachSupabaseAuth],
  requestMiddleware: [errorMiddleware],
}));
