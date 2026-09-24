import type { Request, Response } from "express";
import { db } from "../lib/db.js";
import type { Notification } from "../../generated/prisma/index.js";

const LIMIT = 20;
const ACTIONABLE_TYPES = new Set(["PLAYLIST_INVITE", "PLAYLIST_REQUEST"]);

const memberIdOf = (notification: Notification) => {
    const data = notification.data as Record<string, unknown> | null;
    return typeof data?.memberId === "string" && /^[a-f\d]{24}$/i.test(data.memberId) ? data.memberId : null;
};

async function withRequestStatus(notifications: Notification[]) {
    const memberIds = notifications
        .filter((notification) => ACTIONABLE_TYPES.has(notification.type))
        .map(memberIdOf)
        .filter((id): id is string => id !== null);

    if (memberIds.length === 0) return notifications;

    const members = await db.playlistMember.findMany({
        where: { id: { in: memberIds } },
        select: { id: true, status: true },
    });
    const statusById = new Map(members.map((member) => [member.id, member.status]));

    return notifications.map((notification) => {
        const memberId = memberIdOf(notification);
        if (!memberId || !ACTIONABLE_TYPES.has(notification.type)) return notification;
        return {
            ...notification,
            data: {
                ...(notification.data as Record<string, unknown>),
                status: statusById.get(memberId) ?? "CANCELLED",
            },
        };
    });
}

export async function getNotifications(req: Request, res: Response) {
    try {
        
        const user = req.user;
        if (!user) {
            return res.status(401).json({
                status: false,
                message: "Unauthorized access",
                data: {},
            });
        }

        const { cursor } : { cursor?: string } = req.query;

        let notifications : Notification[] = [];

        if (typeof cursor === "string" && /^[a-f\d]{24}$/i.test(cursor)) {
            notifications = await db.notification.findMany({
                where: { userId: user.userId },
                orderBy: { createdAt: "desc" },
                take: LIMIT,
                skip: 1,
                cursor: { id: cursor },
            });
        } else {
            notifications = await db.notification.findMany({
                where: { userId: user.userId },
                orderBy: { createdAt: "desc" },
                take: LIMIT,
            });
        }

        let nextCursor = null;

        if (notifications.length === LIMIT) {
        nextCursor = notifications[LIMIT - 1]?.id;
        }

        return res.json({
            items: await withRequestStatus(notifications),
            nextCursor,
        });

    } catch (error) {
        console.error("GET NOTIFICATIONS ERROR", error);
        return res.status(500).json({
            success: false,
            message: "Internal Server Error",
            data: {}
        })
    }
}

export async function seenNotifications(req: Request, res: Response) {
    try {
        
        const user = req.user;
        if (!user) {
            return res.status(401).json({
                status: false,
                message: "Unauthorized access",
                data: {},
            });
        }

        await db.notification.updateMany({
            where : {
                userId: user.userId,
                read : false
            },
            data : {
                read : true
            }
        });

        return res.json({
            success: true,
            message: "All notifications marked as seen",
            data: {}
        });
        
    } catch (error) {
        console.error("PATCH SEEN NOTIFICATIONS ERROR", error);
        return res.status(500).json({
            success: false,
            message: "Internal Server Error",
            data: {}
        })
    }
}

export async function countUnreadNotifications(req: Request, res: Response) {
    try {
        
        const user = req.user;
        if (!user) {
            return res.status(401).json({
                status: false,
                message: "Unauthorized access",
                data: {},
            });
        }
        const count = await db.notification.count({
            where : {
                userId : user.userId,
                read : false
            }
        });

        return res.json({
            success: true,
            message: "Unread notifications count retrieved successfully",
            data: { notificationCount: count }
        });

    } catch (error) {
        console.error("GET COUNT UNREAD NOTIFICATIONS ERROR", error);
        return res.status(500).json({
            success: false,
            message: "Internal Server Error",
            data: {}
        });
    }
}