import { redis } from "./redis.js";
import type { NotificationType } from "../../generated/prisma/index.js";

export const NOTIFICATION_STREAM = "notifications";
export const REALTIME_CHANNEL = "realtime:events";
const STREAM_MAX_LENGTH = 10000;

export type NotificationChannel = "default" | "invites" | "playlist-updates" | "jam";

export interface NotificationJob {
    userIds: string[];
    type: NotificationType;
    title: string;
    message: string;
    channelId: NotificationChannel;
    image?: string;
    appActionUrl?: string;
    webActionUrl?: string;
    categoryId?: string;
    tag?: string;
    data?: Record<string, string>;
    persist?: boolean;
}

export async function publishNotification(job: NotificationJob): Promise<void> {
    if (job.userIds.length === 0) return;
    await redis.xAdd(
        NOTIFICATION_STREAM,
        "*",
        { payload: JSON.stringify(job) },
        { TRIM: { strategy: "MAXLEN", strategyModifier: "~", threshold: STREAM_MAX_LENGTH } }
    );
}

export async function publishRealtimeEvent(room: string, event: string, payload: Record<string, unknown> = {}): Promise<void> {
    await redis.publish(REALTIME_CHANNEL, JSON.stringify({ room, event, payload }));
}
