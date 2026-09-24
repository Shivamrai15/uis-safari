import { PrismaClient } from "../../generated/prisma/index.js";

export const db = new PrismaClient();

export async function connectDB(): Promise<void> {
    try {
        await db.$connect();
        console.log("Database connected successfully");
    } catch (error) {
        console.error("Failed to connect to database:", error);
        process.exit(1);
    }
}

export async function ensureIndexes(): Promise<void> {
    try {
        await db.$runCommandRaw({
            createIndexes: "View",
            indexes: [{ key: { userId: 1 }, name: "View_userId_idx" }],
        });
        await db.$runCommandRaw({
            createIndexes: "DeviceToken",
            indexes: [
                { key: { token: 1 }, name: "DeviceToken_token_key", unique: true },
                { key: { userId: 1 }, name: "DeviceToken_userId_idx" },
            ],
        });
        await db.$runCommandRaw({
            createIndexes: "PlaylistMember",
            indexes: [
                { key: { playlistId: 1, userId: 1 }, name: "PlaylistMember_playlistId_userId_key", unique: true },
                { key: { userId: 1, status: 1 }, name: "PlaylistMember_userId_status_idx" },
            ],
        });
        await db.$runCommandRaw({
            createIndexes: "PlaylistActivity",
            indexes: [{ key: { playlistId: 1, createdAt: 1 }, name: "PlaylistActivity_playlistId_createdAt_idx" }],
        });
    } catch (error) {
        console.error("Failed to ensure database indexes:", error);
    }
}

export async function disconnectDB(): Promise<void> {
    try {
        await db.$disconnect();
        console.log("Database disconnected successfully");
    } catch (error) {
        console.error("Failed to disconnect from database:", error);
    }
}