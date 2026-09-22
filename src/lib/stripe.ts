import Stripe from 'stripe';

export const STRIPE_API_VERSION = "2026-01-28.clover";

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
    apiVersion : STRIPE_API_VERSION,
    typescript : true,
    appInfo : {
        name : "Safari",
        version : "1.0",
    }
});
