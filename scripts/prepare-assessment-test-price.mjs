// Explicit operator-only TEST setup. Never pays, supplies a card, or sends email.
import nextEnv from '@next/env';
import Stripe from 'stripe';
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
nextEnv.loadEnvConfig(process.cwd());
const key = process.env.STRIPE_SECRET_KEY?.trim();
if (!key?.startsWith('sk_test_')) throw new Error('Refusing setup without a Stripe TEST secret key');
const stripe = new Stripe(key);
const lookup = 'safescore_assessment_test_299_usd';
const existing = await stripe.prices.list({ lookup_keys: [lookup], limit: 2 });
if (existing.data.length > 1) throw new Error('Ambiguous Assessment test price');
const price = existing.data[0] ?? await stripe.prices.create({
  currency: 'usd', unit_amount: 29900, lookup_key: lookup,
  product_data: { name: 'SafeScore Assessment — TEST', metadata: { purpose: 'goal_loop_test' } },
}, { idempotencyKey: 'safescore-goal-assessment-test-price-20260923' });
if (price.livemode || !price.active || price.type !== 'one_time' || price.currency !== 'usd' || price.unit_amount !== 29900) throw new Error('Price does not match TEST one-time $299 USD contract');
const session = await stripe.checkout.sessions.create({
  mode: 'payment', line_items: [{ price: price.id, quantity: 1 }],
  success_url: 'https://safescore.vercel.app/onboarding',
  cancel_url: 'https://safescore.vercel.app/onboarding',
  metadata: { purpose: 'unpaid_goal_loop_verification' },
}, { idempotencyKey: 'safescore-goal-assessment-unpaid-20260923' });
if (session.livemode || session.payment_status !== 'unpaid' || !session.url || session.amount_total !== 29900) throw new Error('Unexpected TEST checkout result');
const proof = { priceId: price.id, livemode: session.livemode, mode: session.mode, paymentStatus: session.payment_status, amountTotal: session.amount_total, currency: session.currency, urlCreated: Boolean(session.url), sessionIdHash: createHash('sha256').update(session.id).digest('hex'), paid: false };
writeFileSync('../scratch/goal-assessment-stripe-private.json', JSON.stringify({ checkoutUrl: session.url, sessionId: session.id }, null, 2));
writeFileSync('../scratch/goal-assessment-stripe-proof.json', JSON.stringify(proof, null, 2));
console.log(JSON.stringify(proof, null, 2));
