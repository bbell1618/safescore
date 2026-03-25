import Stripe from "stripe";

// Provide a placeholder key during build time when env var is not set.
// Actual API calls will only occur at runtime in Vercel where STRIPE_SECRET_KEY is present.
const apiKey = process.env.STRIPE_SECRET_KEY ?? "sk_placeholder_build_only";

export const stripe = new Stripe(apiKey, {
  apiVersion: "2026-02-25.clover",
});
