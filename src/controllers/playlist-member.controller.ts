import type { Request, Response } from "express";
import { db } from "../lib/db.js";
import { authorizePlaylist, canPerform, getPlaylistManagers, getPlaylistRole } from "../lib/playlist-access.js";
import { getUserName, playlistAppUrl, playlistRoom, recordPlaylistChange } from "../lib/playlist-events.js";
import { createPlaylistShareToken, playlistShareLink, readPlaylistShareToken } from "../lib/playlist-share.js";
import { publishNotification, publishRealtimeEvent } from "../lib/notifications.js";
import { InviteMemberSchema, JoinRequestSchema, UpdateMemberRoleSchema } from "../schemas/playlist-member.schema.js";
import type { PlayList, PlaylistMember } from "../../generated/prisma/index.js";

const ACTIVITY_BATCH = 20;
const OBJECT_ID = /^[a-f\d]{24}$/i;
const USER_SUMMARY = { id: true, name: true, image: true } as const;

const fail = (res: Response, status: number, message: string) =>
  res.status(status).json({ status: false, message, data: {} });

async function safely(task: () => Promise<unknown>) {
  try {
    await task();
  } catch (error) {
    console.error("Playlist member side effect failed", error);
  }
}

async function notifyMembershipChanged(playlistId: string, userId: string) {
  await safely(() => publishRealtimeEvent(`user:${userId}`, "playlists.updated", { playlistId }));
  await safely(() => publishRealtimeEvent(playlistRoom(playlistId), "playlist.members.updated", { playlistId }));
}

async function evictFromPlaylistRoom(playlistId: string, userId: string) {
  await safely(() => publishRealtimeEvent(`user:${userId}`, "room:evict", { room: playlistRoom(playlistId) }));
  await safely(() => publishRealtimeEvent(`user:${userId}`, "playlist.access-revoked", { playlistId }));
}

async function markCollaborative(playlist: PlayList) {
  if (!playlist.isCollaborative) {
    await db.playList.update({ where: { id: playlist.id }, data: { isCollaborative: true } });
  }
}

async function acceptMembership(member: PlaylistMember, playlist: PlayList) {
  const accepted = await db.playlistMember.update({
    where: { id: member.id },
    data: { status: "ACCEPTED", respondedAt: new Date() },
  });
  void recordPlaylistChange({
    playlist,
    actorId: member.userId,
    type: "MEMBER_JOINED",
    payload: { memberId: member.id },
  });
  await notifyMembershipChanged(playlist.id, member.userId);
  return accepted;
}

async function sendInviteNotification(member: PlaylistMember, playlist: PlayList, inviterId: string) {
  const inviterName = await getUserName(inviterId);
  await safely(() => publishNotification({
    userIds: [member.userId],
    type: "PLAYLIST_INVITE",
    title: "Playlist invite",
    message: `${inviterName} invited you to collaborate on ${playlist.name}`,
    channelId: "invites",
    categoryId: "playlist-invite",
    appActionUrl: "/notification",
    tag: `playlist-invite:${member.id}`,
    data: { playlistId: playlist.id, memberId: member.id },
    ...(playlist.image ? { image: playlist.image } : {}),
  }));
}

async function sendRequestNotification(member: PlaylistMember, playlist: PlayList) {
  const requesterName = await getUserName(member.userId);
  const managers = await getPlaylistManagers(playlist.id, playlist.userId);
  await safely(() => publishNotification({
    userIds: managers,
    type: "PLAYLIST_REQUEST",
    title: "Collaboration request",
    message: `${requesterName} wants to collaborate on ${playlist.name}`,
    channelId: "invites",
    categoryId: "playlist-request",
    appActionUrl: "/notification",
    tag: `playlist-request:${member.id}`,
    data: { playlistId: playlist.id, memberId: member.id },
    ...(playlist.image ? { image: playlist.image } : {}),
  }));
}

async function notifyUser(userId: string, playlist: PlayList, message: string, openPlaylist: boolean) {
  await safely(() => publishNotification({
    userIds: [userId],
    type: "PLAYLIST_UPDATE",
    title: playlist.name,
    message,
    channelId: "playlist-updates",
    ...(openPlaylist ? { appActionUrl: playlistAppUrl(playlist.id) } : {}),
    data: { playlistId: playlist.id },
    ...(playlist.image ? { image: playlist.image } : {}),
  }));
}

export async function getPlaylistMembers(req: Request, res: Response) {
  try {
    const user = req.user;
    if (!user) return fail(res, 401, "Unauthorized access");

    const playlistId = req.params.id;
    if (!playlistId) return fail(res, 400, "Bad Request");

    const access = await authorizePlaylist(user.userId, playlistId, "view");
    if (!access.ok) return fail(res, access.status, access.message);

    const canManage = canPerform(access.role, "manageMembers");

    const [owner, members] = await Promise.all([
      db.user.findUnique({ where: { id: access.playlist.userId }, select: USER_SUMMARY }),
      db.playlistMember.findMany({
        where: {
          playlistId,
          status: canManage ? { in: ["ACCEPTED", "PENDING"] } : "ACCEPTED",
        },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          userId: true,
          role: true,
          status: true,
          direction: true,
          createdAt: true,
          user: { select: USER_SUMMARY },
        },
      }),
    ]);

    return res.json({
      status: true,
      message: "Success",
      data: { owner, members, myRole: access.role },
    });
  } catch (error) {
    console.error("GET PLAYLIST MEMBERS ERROR", error);
    return fail(res, 500, "Internal Server Error");
  }
}

export async function inviteMember(req: Request, res: Response) {
  try {
    const user = req.user;
    if (!user) return fail(res, 401, "Unauthorized access");

    const playlistId = req.params.id;
    if (!playlistId) return fail(res, 400, "Bad Request");

    const validatedData = await InviteMemberSchema.safeParseAsync(req.body);
    if (!validatedData.success) return fail(res, 400, "Enter a valid email address");

    const access = await authorizePlaylist(user.userId, playlistId, "manageMembers");
    if (!access.ok) return fail(res, access.status, access.message);

    const role = validatedData.data.role ?? "COLLABORATOR";
    if (role === "ADMIN" && !canPerform(access.role, "manageRoles")) {
      return fail(res, 403, "Only the owner can invite admins");
    }

    const invitee = await db.user.findFirst({
      where: { email: { equals: validatedData.data.email, mode: "insensitive" } },
      select: { id: true },
    });
    if (!invitee) return fail(res, 404, "No Safari account uses this email");
    if (invitee.id === access.playlist.userId || invitee.id === user.userId) {
      return fail(res, 409, "This person already owns or manages this playlist");
    }

    const existing = await db.playlistMember.findUnique({
      where: { playlistId_userId: { playlistId, userId: invitee.id } },
    });

    if (existing?.status === "ACCEPTED") {
      return fail(res, 409, "This person is already a collaborator");
    }

    await markCollaborative(access.playlist);

    if (existing?.status === "PENDING" && existing.direction === "REQUEST") {
      const accepted = await acceptMembership(existing, access.playlist);
      await notifyUser(invitee.id, access.playlist, `Your request to join ${access.playlist.name} was accepted`, true);
      return res.json({ status: true, message: "Request accepted", data: accepted });
    }

    const member = await db.playlistMember.upsert({
      where: { playlistId_userId: { playlistId, userId: invitee.id } },
      create: {
        playlistId,
        userId: invitee.id,
        role,
        status: "PENDING",
        direction: "INVITE",
        invitedById: user.userId,
      },
      update: {
        role,
        status: "PENDING",
        direction: "INVITE",
        invitedById: user.userId,
        respondedAt: null,
      },
    });

    void recordPlaylistChange({
      playlist: access.playlist,
      actorId: user.userId,
      type: "MEMBER_INVITED",
      payload: { memberId: member.id, userId: invitee.id },
      notifyMembers: false,
    });
    await sendInviteNotification(member, access.playlist, user.userId);
    await notifyMembershipChanged(playlistId, invitee.id);

    return res.status(201).json({ status: true, message: "Invite sent", data: member });
  } catch (error) {
    console.error("INVITE PLAYLIST MEMBER ERROR", error);
    return fail(res, 500, "Internal Server Error");
  }
}

export async function createShareLink(req: Request, res: Response) {
  try {
    const user = req.user;
    if (!user) return fail(res, 401, "Unauthorized access");

    const playlistId = req.params.id;
    if (!playlistId) return fail(res, 400, "Bad Request");

    const access = await authorizePlaylist(user.userId, playlistId, "manageMembers");
    if (!access.ok) return fail(res, access.status, access.message);

    await markCollaborative(access.playlist);
    const token = createPlaylistShareToken(playlistId);

    return res.json({
      status: true,
      message: "Success",
      data: { token, link: playlistShareLink(token) },
    });
  } catch (error) {
    console.error("CREATE PLAYLIST SHARE LINK ERROR", error);
    return fail(res, 500, "Internal Server Error");
  }
}

export async function previewShareLink(req: Request, res: Response) {
  try {
    const user = req.user;
    if (!user) return fail(res, 401, "Unauthorized access");

    const playlistId = readPlaylistShareToken(String(req.params.token ?? ""));
    if (!playlistId) return fail(res, 410, "This invite link is invalid or has expired");

    const playlist = await db.playList.findUnique({
      where: { id: playlistId },
      select: { id: true, name: true, image: true, color: true, isArchived: true, userId: true },
    });
    if (!playlist || playlist.isArchived) return fail(res, 404, "Playlist not found");

    const [owner, songCount, membership] = await Promise.all([
      db.user.findUnique({ where: { id: playlist.userId }, select: USER_SUMMARY }),
      db.playlistSong.count({ where: { playlistId } }),
      db.playlistMember.findUnique({
        where: { playlistId_userId: { playlistId, userId: user.userId } },
        select: { id: true, status: true, direction: true },
      }),
    ]);

    return res.json({
      status: true,
      message: "Success",
      data: {
        playlist: { id: playlist.id, name: playlist.name, image: playlist.image, color: playlist.color },
        owner,
        songCount,
        isOwner: playlist.userId === user.userId,
        membership,
      },
    });
  } catch (error) {
    console.error("PREVIEW PLAYLIST SHARE LINK ERROR", error);
    return fail(res, 500, "Internal Server Error");
  }
}

export async function requestToJoin(req: Request, res: Response) {
  try {
    const user = req.user;
    if (!user) return fail(res, 401, "Unauthorized access");

    const playlistId = req.params.id;
    if (!playlistId) return fail(res, 400, "Bad Request");

    const validatedData = await JoinRequestSchema.safeParseAsync(req.body);
    if (!validatedData.success) return fail(res, 400, "Bad Request");

    if (readPlaylistShareToken(validatedData.data.token) !== playlistId) {
      return fail(res, 410, "This invite link is invalid or has expired");
    }

    const playlist = await db.playList.findUnique({ where: { id: playlistId } });
    if (!playlist || playlist.isArchived) return fail(res, 404, "Playlist not found");
    if (playlist.userId === user.userId) return fail(res, 409, "You own this playlist");

    const existing = await db.playlistMember.findUnique({
      where: { playlistId_userId: { playlistId, userId: user.userId } },
    });

    if (existing?.status === "ACCEPTED") {
      return fail(res, 409, "You're already a collaborator");
    }

    if (existing?.status === "PENDING" && existing.direction === "INVITE") {
      const accepted = await acceptMembership(existing, playlist);
      return res.json({ status: true, message: "You joined the playlist", data: accepted });
    }

    if (existing?.status === "PENDING" && existing.direction === "REQUEST") {
      return res.json({ status: true, message: "Request already sent", data: existing });
    }

    const member = await db.playlistMember.upsert({
      where: { playlistId_userId: { playlistId, userId: user.userId } },
      create: {
        playlistId,
        userId: user.userId,
        role: "COLLABORATOR",
        status: "PENDING",
        direction: "REQUEST",
      },
      update: {
        role: "COLLABORATOR",
        status: "PENDING",
        direction: "REQUEST",
        invitedById: null,
        respondedAt: null,
      },
    });

    void recordPlaylistChange({
      playlist,
      actorId: user.userId,
      type: "MEMBER_REQUESTED",
      payload: { memberId: member.id },
      notifyMembers: false,
    });
    await sendRequestNotification(member, playlist);
    await notifyMembershipChanged(playlistId, user.userId);

    return res.status(201).json({ status: true, message: "Request sent", data: member });
  } catch (error) {
    console.error("REQUEST TO JOIN PLAYLIST ERROR", error);
    return fail(res, 500, "Internal Server Error");
  }
}

async function loadPendingMember(res: Response, playlistId: string, memberId: string) {
  if (!OBJECT_ID.test(memberId)) {
    fail(res, 404, "Request not found");
    return null;
  }
  const member = await db.playlistMember.findUnique({ where: { id: memberId } });
  if (!member || member.playlistId !== playlistId) {
    fail(res, 404, "Request not found");
    return null;
  }
  if (member.status !== "PENDING") {
    res.status(409).json({
      status: false,
      message: member.status === "ACCEPTED" ? "Already accepted" : "Already declined",
      data: { status: member.status },
    });
    return null;
  }
  return member;
}

async function canRespond(userId: string, member: PlaylistMember) {
  if (member.direction === "INVITE") {
    return member.userId === userId;
  }
  const access = await getPlaylistRole(userId, member.playlistId);
  return canPerform(access?.role ?? null, "manageMembers");
}

export async function acceptMember(req: Request, res: Response) {
  try {
    const user = req.user;
    if (!user) return fail(res, 401, "Unauthorized access");

    const { id: playlistId, memberId } = req.params;
    if (!playlistId || !memberId) return fail(res, 400, "Bad Request");

    const member = await loadPendingMember(res, playlistId, memberId);
    if (!member) return;
    if (!(await canRespond(user.userId, member))) return fail(res, 403, "You can't respond to this request");

    const playlist = await db.playList.findUnique({ where: { id: playlistId } });
    if (!playlist || playlist.isArchived) return fail(res, 404, "Playlist not found");

    const accepted = await acceptMembership(member, playlist);
    if (member.direction === "REQUEST") {
      await notifyUser(member.userId, playlist, `Your request to join ${playlist.name} was accepted`, true);
    }

    return res.json({ status: true, message: "Accepted", data: accepted });
  } catch (error) {
    console.error("ACCEPT PLAYLIST MEMBER ERROR", error);
    return fail(res, 500, "Internal Server Error");
  }
}

export async function declineMember(req: Request, res: Response) {
  try {
    const user = req.user;
    if (!user) return fail(res, 401, "Unauthorized access");

    const { id: playlistId, memberId } = req.params;
    if (!playlistId || !memberId) return fail(res, 400, "Bad Request");

    const member = await loadPendingMember(res, playlistId, memberId);
    if (!member) return;
    if (!(await canRespond(user.userId, member))) return fail(res, 403, "You can't respond to this request");

    const playlist = await db.playList.findUnique({ where: { id: playlistId } });
    if (!playlist) return fail(res, 404, "Playlist not found");

    const declined = await db.playlistMember.update({
      where: { id: member.id },
      data: { status: "DECLINED", respondedAt: new Date() },
    });

    void recordPlaylistChange({
      playlist,
      actorId: user.userId,
      type: "MEMBER_DECLINED",
      payload: { memberId: member.id },
      notifyMembers: false,
    });

    if (member.direction === "REQUEST") {
      await notifyUser(member.userId, playlist, `Your request to join ${playlist.name} was declined`, false);
    } else if (member.invitedById) {
      const name = await getUserName(member.userId);
      await notifyUser(member.invitedById, playlist, `${name} declined your invite to ${playlist.name}`, true);
    }
    await notifyMembershipChanged(playlistId, member.userId);

    return res.json({ status: true, message: "Declined", data: declined });
  } catch (error) {
    console.error("DECLINE PLAYLIST MEMBER ERROR", error);
    return fail(res, 500, "Internal Server Error");
  }
}

export async function updateMemberRole(req: Request, res: Response) {
  try {
    const user = req.user;
    if (!user) return fail(res, 401, "Unauthorized access");

    const { id: playlistId, memberId } = req.params;
    if (!playlistId || !memberId || !OBJECT_ID.test(memberId)) return fail(res, 400, "Bad Request");

    const validatedData = await UpdateMemberRoleSchema.safeParseAsync(req.body);
    if (!validatedData.success) return fail(res, 400, "Bad Request");

    const access = await authorizePlaylist(user.userId, playlistId, "manageRoles");
    if (!access.ok) return fail(res, access.status, access.message);

    const member = await db.playlistMember.findUnique({ where: { id: memberId } });
    if (!member || member.playlistId !== playlistId || member.status !== "ACCEPTED") {
      return fail(res, 404, "Collaborator not found");
    }

    const updated = await db.playlistMember.update({
      where: { id: member.id },
      data: { role: validatedData.data.role },
    });

    void recordPlaylistChange({
      playlist: access.playlist,
      actorId: user.userId,
      type: "ROLE_CHANGED",
      payload: { memberId: member.id, role: validatedData.data.role },
      notifyMembers: false,
    });
    await notifyUser(
      member.userId,
      access.playlist,
      validatedData.data.role === "ADMIN"
        ? `You're now an admin of ${access.playlist.name}`
        : `You're now a collaborator on ${access.playlist.name}`,
      true
    );
    await notifyMembershipChanged(playlistId, member.userId);

    return res.json({ status: true, message: "Role updated", data: updated });
  } catch (error) {
    console.error("UPDATE PLAYLIST MEMBER ROLE ERROR", error);
    return fail(res, 500, "Internal Server Error");
  }
}

export async function removeMember(req: Request, res: Response) {
  try {
    const user = req.user;
    if (!user) return fail(res, 401, "Unauthorized access");

    const { id: playlistId, memberId } = req.params;
    if (!playlistId || !memberId || !OBJECT_ID.test(memberId)) return fail(res, 400, "Bad Request");

    const member = await db.playlistMember.findUnique({ where: { id: memberId } });
    if (!member || member.playlistId !== playlistId) return fail(res, 404, "Collaborator not found");

    const playlist = await db.playList.findUnique({ where: { id: playlistId } });
    if (!playlist) return fail(res, 404, "Playlist not found");

    const isLeaving = member.userId === user.userId;

    if (!isLeaving) {
      const access = await getPlaylistRole(user.userId, playlistId);
      if (!canPerform(access?.role ?? null, "manageMembers")) {
        return fail(res, 403, "You don't have permission to do this");
      }
      if (member.role === "ADMIN" && access?.role !== "OWNER") {
        return fail(res, 403, "Only the owner can remove admins");
      }
    }

    await db.playlistMember.delete({ where: { id: member.id } });

    if (member.status === "ACCEPTED") {
      void recordPlaylistChange({
        playlist,
        actorId: isLeaving ? member.userId : user.userId,
        type: isLeaving ? "MEMBER_LEFT" : "MEMBER_REMOVED",
        payload: { memberId: member.id, userId: member.userId },
        notifyMembers: isLeaving,
      });
    }

    await evictFromPlaylistRoom(playlistId, member.userId);
    await notifyMembershipChanged(playlistId, member.userId);

    return res.json({ status: true, message: isLeaving ? "You left the playlist" : "Collaborator removed", data: {} });
  } catch (error) {
    console.error("REMOVE PLAYLIST MEMBER ERROR", error);
    return fail(res, 500, "Internal Server Error");
  }
}

export async function getPlaylistActivity(req: Request, res: Response) {
  try {
    const user = req.user;
    if (!user) return fail(res, 401, "Unauthorized access");

    const playlistId = req.params.id;
    if (!playlistId) return fail(res, 400, "Bad Request");

    const access = await authorizePlaylist(user.userId, playlistId, "view");
    if (!access.ok) return fail(res, access.status, access.message);

    const cursor = typeof req.query.cursor === "string" && OBJECT_ID.test(req.query.cursor) ? req.query.cursor : null;

    const items = await db.playlistActivity.findMany({
      where: { playlistId },
      orderBy: { createdAt: "desc" },
      take: ACTIVITY_BATCH,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      include: { actor: { select: USER_SUMMARY } },
    });

    return res.json({
      items,
      nextCursor: items.length === ACTIVITY_BATCH ? items[ACTIVITY_BATCH - 1]?.id ?? null : null,
    });
  } catch (error) {
    console.error("GET PLAYLIST ACTIVITY ERROR", error);
    return fail(res, 500, "Internal Server Error");
  }
}
