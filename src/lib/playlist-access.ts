import { db } from "./db.js";
import type { PlayList } from "../../generated/prisma/index.js";

export type PlaylistRoleName = "OWNER" | "ADMIN" | "COLLABORATOR";

export type PlaylistAction =
    | "view"
    | "editSongs"
    | "editDetails"
    | "manageMembers"
    | "manageRoles"
    | "delete";

const PERMISSIONS: Record<PlaylistAction, PlaylistRoleName[]> = {
    view: ["OWNER", "ADMIN", "COLLABORATOR"],
    editSongs: ["OWNER", "ADMIN", "COLLABORATOR"],
    editDetails: ["OWNER", "ADMIN"],
    manageMembers: ["OWNER", "ADMIN"],
    manageRoles: ["OWNER"],
    delete: ["OWNER"],
};

export const canPerform = (role: PlaylistRoleName | null, action: PlaylistAction) =>
    role !== null && PERMISSIONS[action].includes(role);

export async function getPlaylistRole(userId: string, playlistId: string): Promise<{ playlist: PlayList; role: PlaylistRoleName | null } | null> {
    if (!/^[a-f\d]{24}$/i.test(playlistId)) return null;

    const playlist = await db.playList.findUnique({ where: { id: playlistId } });
    if (!playlist) return null;

    if (playlist.userId === userId) {
        return { playlist, role: "OWNER" };
    }

    const membership = await db.playlistMember.findUnique({
        where: { playlistId_userId: { playlistId, userId } },
        select: { role: true, status: true },
    });

    if (membership?.status !== "ACCEPTED") {
        return { playlist, role: null };
    }

    return { playlist, role: membership.role };
}

export type PlaylistAccess =
    | { ok: true; playlist: PlayList; role: PlaylistRoleName }
    | { ok: false; status: 403 | 404; message: string };

export async function authorizePlaylist(
    userId: string,
    playlistId: string,
    action: PlaylistAction,
    options: { archived?: boolean } = {}
): Promise<PlaylistAccess> {
    const result = await getPlaylistRole(userId, playlistId);
    const wantsArchived = options.archived ?? false;

    if (!result || !result.role || result.playlist.isArchived !== wantsArchived) {
        return { ok: false, status: 404, message: "Playlist not found" };
    }

    if (!canPerform(result.role, action)) {
        return { ok: false, status: 403, message: "You don't have permission to do this" };
    }

    return { ok: true, playlist: result.playlist, role: result.role };
}

export async function getPlaylistAudience(playlistId: string, ownerId: string): Promise<string[]> {
    const members = await db.playlistMember.findMany({
        where: { playlistId, status: "ACCEPTED" },
        select: { userId: true },
    });
    return Array.from(new Set([ownerId, ...members.map((member) => member.userId)]));
}

export async function getPlaylistManagers(playlistId: string, ownerId: string): Promise<string[]> {
    const admins = await db.playlistMember.findMany({
        where: { playlistId, status: "ACCEPTED", role: "ADMIN" },
        select: { userId: true },
    });
    return Array.from(new Set([ownerId, ...admins.map((admin) => admin.userId)]));
}
