import { db } from "./db.js";
import { redis } from "./redis.js";
import { publishNotification, publishRealtimeEvent, type NotificationJob } from "./notifications.js";
import { getPlaylistAudience } from "./playlist-access.js";
import type { PlayList, PlaylistActivityType } from "../../generated/prisma/index.js";

const COALESCE_WINDOW_SECONDS = 120;

export const playlistRoom = (playlistId: string) => `playlist:${playlistId}`;
export const playlistAppUrl = (playlistId: string) => `/playlist-songs/${playlistId}`;

export async function getUserName(userId: string): Promise<string> {
    const user = await db.user.findUnique({ where: { id: userId }, select: { name: true, email: true } });
    return user?.name || user?.email?.split("@")[0] || "Someone";
}

async function coalescedCount(key: string): Promise<number> {
    if (!redis.isReady) return 1;
    const count = await redis.incr(key);
    if (count === 1) {
        await redis.expire(key, COALESCE_WINDOW_SECONDS);
    }
    return count;
}

function describeChange(type: PlaylistActivityType, count: number, playlistName: string): string | null {
    switch (type) {
        case "SONG_ADDED":
            return count === 1 ? `added a song to ${playlistName}` : `added ${count} songs to ${playlistName}`;
        case "SONG_REMOVED":
            return count === 1 ? `removed a song from ${playlistName}` : `removed ${count} songs from ${playlistName}`;
        case "DETAILS_UPDATED":
            return `updated ${playlistName}`;
        case "MEMBER_JOINED":
            return `joined ${playlistName}`;
        case "MEMBER_LEFT":
            return `left ${playlistName}`;
        default:
            return null;
    }
}

interface PlaylistChange {
    playlist: PlayList;
    actorId: string;
    type: PlaylistActivityType;
    payload?: Record<string, string | number | boolean | null>;
    songCount?: number;
    notifyMembers?: boolean;
}

export async function recordPlaylistChange(change: PlaylistChange): Promise<void> {
    const { playlist, actorId, type } = change;

    try {
        await db.playlistActivity.create({
            data: {
                playlistId: playlist.id,
                actorId,
                type,
                ...(change.payload ? { payload: change.payload } : {}),
            },
        });
    } catch (error) {
        console.error("Failed to record playlist activity", error);
    }

    try {
        await publishRealtimeEvent(playlistRoom(playlist.id), "playlist.updated", {
            playlistId: playlist.id,
            type,
            actorId,
        });
    } catch (error) {
        console.error("Failed to publish playlist update", error);
    }

    if (change.notifyMembers === false) return;

    try {
        const recipients = (await getPlaylistAudience(playlist.id, playlist.userId)).filter((id) => id !== actorId);
        if (recipients.length === 0) return;

        const isSongChange = type === "SONG_ADDED" || type === "SONG_REMOVED";
        const increment = Math.max(1, change.songCount ?? 1);
        let count = increment;
        if (isSongChange) {
            const key = `playlist-notify:${playlist.id}:${actorId}:${type}`;
            count = await coalescedCount(key);
            if (increment > 1 && redis.isReady) {
                count = await redis.incrBy(key, increment - 1);
            }
        }

        const description = describeChange(type, count, playlist.name);
        if (!description) return;

        const actorName = await getUserName(actorId);
        const job: NotificationJob = {
            userIds: recipients,
            type: "PLAYLIST_UPDATE",
            title: playlist.name,
            message: `${actorName} ${description}`,
            channelId: "playlist-updates",
            appActionUrl: playlistAppUrl(playlist.id),
            tag: `playlist:${playlist.id}:${actorId}:${type}`,
            persist: !isSongChange || count === increment,
            data: { playlistId: playlist.id, activity: type },
            ...(playlist.image ? { image: playlist.image } : {}),
        };
        await publishNotification(job);
    } catch (error) {
        console.error("Failed to notify playlist members", error);
    }
}
