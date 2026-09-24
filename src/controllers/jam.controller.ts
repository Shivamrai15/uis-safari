import type { Request, Response } from "express";
import * as z from "zod";
import { db } from "../lib/db.js";
import { redis } from "../lib/redis.js";
import { publishNotification } from "../lib/notifications.js";
import { getUserName } from "../lib/playlist-events.js";

const JamInviteSchema = z.object({
  email: z.email(),
  code: z.string().min(4).max(12),
});

const fail = (res: Response, status: number, message: string) =>
  res.status(status).json({ status: false, message, data: {} });

export async function inviteToJam(req: Request, res: Response) {
  try {
    const user = req.user;
    if (!user) return fail(res, 401, "Unauthorized access");

    const validatedData = await JamInviteSchema.safeParseAsync(req.body);
    if (!validatedData.success) return fail(res, 400, "Enter a valid email address");
    if (!redis.isReady) return fail(res, 503, "Jam invites are unavailable right now");

    const code = validatedData.data.code.trim().toUpperCase();
    const jamId = await redis.get(`jam-code:${code}`);
    const rawState = jamId ? await redis.get(`jam:${jamId}`) : null;
    if (!rawState) return fail(res, 404, "This Jam has ended");

    const state = JSON.parse(rawState) as { members?: { userId: string }[] };
    if (!state.members?.some((member) => member.userId === user.userId)) {
      return fail(res, 403, "You're not in this Jam");
    }

    const invitee = await db.user.findFirst({
      where: { email: { equals: validatedData.data.email, mode: "insensitive" } },
      select: { id: true },
    });
    if (!invitee) return fail(res, 404, "No Safari account uses this email");
    if (state.members.some((member) => member.userId === invitee.id)) {
      return fail(res, 409, "They're already in the Jam");
    }

    const inviterName = await getUserName(user.userId);
    await publishNotification({
      userIds: [invitee.id],
      type: "JAM_INVITE",
      title: "Join my Jam",
      message: `${inviterName} invited you to listen together`,
      channelId: "jam",
      categoryId: "jam-invite",
      appActionUrl: `/jam?code=${code}`,
      tag: `jam-invite:${code}`,
      persist: false,
      data: { jamCode: code },
    });

    return res.json({ status: true, message: "Invite sent", data: {} });
  } catch (error) {
    console.error("JAM INVITE ERROR", error);
    return fail(res, 500, "Internal Server Error");
  }
}
