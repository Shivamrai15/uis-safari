import { db } from "../lib/db.js";
import { redis } from "../lib/redis.js";
import { sendPush } from "../lib/push.js";
import { NOTIFICATION_STREAM, publishRealtimeEvent, type NotificationJob } from "../lib/notifications.js";

const GROUP = "notification-dispatch";
const CONSUMER = "user-identity";
const BATCH_SIZE = 10;
const BLOCK_MS = 5000;
const RECLAIM_IDLE_MS = 60 * 1000;
const ERROR_BACKOFF_MS = 5000;

type StreamEntry = { id: string; message: Record<string, string> };

let running = false;
let reader: ReturnType<typeof redis.duplicate> | null = null;

async function ensureGroup(client: NonNullable<typeof reader>) {
    try {
        await client.xGroupCreate(NOTIFICATION_STREAM, GROUP, "0", { MKSTREAM: true });
    } catch (error) {
        if (!(error instanceof Error) || !error.message.includes("BUSYGROUP")) {
            throw error;
        }
    }
}

async function dispatch(job: NotificationJob) {
    const userIds = Array.from(new Set(job.userIds));

    if (job.persist !== false) {
        await db.notification.createMany({
            data: userIds.map((userId) => ({
                userId,
                type: job.type,
                title: job.title,
                message: job.message,
                image: job.image ?? null,
                appActionUrl: job.appActionUrl ?? null,
                webActionUrl: job.webActionUrl ?? null,
                ...(job.data ? { data: job.data } : {}),
            })),
        });
    }

    try {
        await Promise.all(userIds.map((userId) =>
            publishRealtimeEvent(`user:${userId}`, "notification.new", { title: job.title, data: job.data ?? {} })
        ));
        await deliverPush(userIds, job);
    } catch (error) {
        console.error("Notification delivery failed after it was saved:", error);
    }
}

async function deliverPush(userIds: string[], job: NotificationJob) {
    const devices = await db.deviceToken.findMany({
        where: { userId: { in: userIds } },
        select: { token: true },
    });

    const staleTokens = await sendPush(devices.map((device) => device.token), {
        title: job.title,
        message: job.message,
        channelId: job.channelId,
        ...(job.categoryId ? { categoryId: job.categoryId } : {}),
        ...(job.tag ? { tag: job.tag } : {}),
        body: {
            type: job.type,
            appActionUrl: job.appActionUrl ?? null,
            ...(job.data ?? {}),
        },
    });

    if (staleTokens.length > 0) {
        await db.deviceToken.deleteMany({ where: { token: { in: staleTokens } } });
    }
}

async function handle(client: NonNullable<typeof reader>, entries: StreamEntry[]) {
    for (const entry of entries) {
        let job: NotificationJob;
        try {
            job = JSON.parse(entry.message.payload ?? "");
        } catch {
            console.error("Dropping malformed notification job", entry.id);
            await client.xAck(NOTIFICATION_STREAM, GROUP, entry.id);
            continue;
        }

        try {
            await dispatch(job);
            await client.xAck(NOTIFICATION_STREAM, GROUP, entry.id);
        } catch (error) {
            console.error("Failed to dispatch notification job", entry.id, error);
        }
    }
}

async function loop(client: NonNullable<typeof reader>) {
    while (running) {
        try {
            const reclaimed = await client.xAutoClaim(NOTIFICATION_STREAM, GROUP, CONSUMER, RECLAIM_IDLE_MS, "0-0", { COUNT: BATCH_SIZE });
            const reclaimedEntries = reclaimed.messages.filter(Boolean) as unknown as StreamEntry[];
            if (reclaimedEntries.length > 0) {
                await handle(client, reclaimedEntries);
            }

            const response = await client.xReadGroup(
                GROUP,
                CONSUMER,
                { key: NOTIFICATION_STREAM, id: ">" },
                { COUNT: BATCH_SIZE, BLOCK: BLOCK_MS }
            ) as unknown as { name: string; messages: StreamEntry[] }[] | null;

            for (const stream of response ?? []) {
                await handle(client, stream.messages);
            }
        } catch (error) {
            if (!running) break;
            console.error("Notification worker error:", error);
            await new Promise((resolve) => setTimeout(resolve, ERROR_BACKOFF_MS));
        }
    }
}

export async function startNotificationWorker(): Promise<void> {
    if (running) return;
    running = true;
    reader = redis.duplicate();
    reader.on("error", (err) => console.error("Notification worker Redis error", err));
    await reader.connect();
    await ensureGroup(reader);
    console.log("Notification worker started");
    loop(reader);
}

export async function stopNotificationWorker(): Promise<void> {
    running = false;
    try {
        await reader?.quit();
    } catch (error) {
        console.error("Error stopping notification worker:", error);
    }
    reader = null;
}
