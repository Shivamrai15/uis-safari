import type { Request, Response } from "express";
import { db } from "../lib/db.js";
import { stripe, STRIPE_API_VERSION } from "../lib/stripe.js";
import { createOrRetrieveCustomer } from "../lib/customer.js";
import { PaymentSheetSchema } from "../schemas/payment.schema.js";

export async function createPaymentSheet(req: Request, res: Response) {
    try {

        const user = req.user;
        if (!user) {
            return res.status(401).json({
                status: false,
                message: "Unauthorized access",
                data: {},
            });
        }

        const validatedData = await PaymentSheetSchema.safeParseAsync(req.body);
        if (!validatedData.success) {
            return res.status(400).json({
                status: false,
                message: "Invalid price",
                data: validatedData.error,
            });
        }

        const activeSubscription = await db.subscription.findFirst({
            where: {
                userId: user.userId,
                stripeCurrentPeriodEnd: { gt: new Date() },
            },
            select: { id: true },
        });

        if (activeSubscription) {
            return res.status(409).json({
                status: false,
                message: "You already have an active subscription",
                data: {},
            });
        }

        const price = await stripe.prices.retrieve(validatedData.data.priceId);
        if (!price.active || !price.recurring) {
            return res.status(400).json({
                status: false,
                message: "This plan is not available",
                data: {},
            });
        }

        const customer = await createOrRetrieveCustomer({
            userId: user.userId,
            email: user.email,
        });

        const ephemeralKey = await stripe.ephemeralKeys.create(
            { customer },
            { apiVersion: STRIPE_API_VERSION }
        );

        const subscription = await stripe.subscriptions.create({
            customer,
            items: [{ price: price.id }],
            payment_behavior: "default_incomplete",
            payment_settings: {
                payment_method_types: ["card"],
                save_default_payment_method: "on_subscription",
            },
            metadata: { userId: user.userId, source: "app" },
            expand: ["latest_invoice.confirmation_secret"],
        });

        const invoice = subscription.latest_invoice;
        const clientSecret =
            invoice && typeof invoice !== "string"
                ? invoice.confirmation_secret?.client_secret
                : undefined;

        if (!clientSecret) {
            await stripe.subscriptions.cancel(subscription.id);
            throw new Error("Subscription invoice has no confirmation secret");
        }

        return res.status(200).json({
            status: true,
            message: "Payment sheet created successfully",
            data: {
                subscriptionId: subscription.id,
                clientSecret,
                customer,
                ephemeralKey: ephemeralKey.secret,
            },
        });

    } catch (error) {
        console.error("CREATE PAYMENT SHEET ERROR:", error);
        return res.status(500).json({
            status: false,
            message: "Internal server error",
            data: {},
        });
    }
}
