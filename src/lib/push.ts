import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getMessaging, type Messaging } from "firebase-admin/messaging";

const FCM_BATCH_SIZE = 500;
const STALE_TOKEN_ERRORS = new Set([
    "messaging/registration-token-not-registered",
    "messaging/invalid-registration-token",
]);

export interface PushMessage {
    title: string;
    message: string;
    channelId: string;
    categoryId?: string;
    tag?: string;
    body?: Record<string, unknown>;
}

let messaging: Messaging | null | undefined;

function getMessagingClient(): Messaging | null {
    if (messaging !== undefined) return messaging;

    const encoded = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!encoded) {
        console.warn("FIREBASE_SERVICE_ACCOUNT is not set; push notifications are disabled");
        messaging = null;
        return messaging;
    }

    try {
        const serviceAccount = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
        const app = getApps()[0] ?? initializeApp({ credential: cert(serviceAccount) });
        messaging = getMessaging(app);
    } catch (error) {
        console.error("Failed to initialise Firebase messaging:", error);
        messaging = null;
    }
    return messaging;
}

export async function sendPush(tokens: string[], push: PushMessage): Promise<string[]> {
    const client = getMessagingClient();
    if (!client || tokens.length === 0) return [];

    const data: Record<string, string> = {
        title: push.title,
        message: push.message,
        channelId: push.channelId,
        body: JSON.stringify(push.body ?? {}),
    };
    if (push.categoryId) data.categoryId = push.categoryId;
    if (push.tag) data.tag = push.tag;

    const staleTokens: string[] = [];

    for (let i = 0; i < tokens.length; i += FCM_BATCH_SIZE) {
        const batch = tokens.slice(i, i + FCM_BATCH_SIZE);
        const response = await client.sendEachForMulticast({
            tokens: batch,
            data,
            android: { priority: "high" },
        });
        response.responses.forEach((result, index) => {
            const code = result.error?.code;
            if (code && STALE_TOKEN_ERRORS.has(code)) {
                staleTokens.push(batch[index]!);
            }
        });
    }

    return staleTokens;
}
