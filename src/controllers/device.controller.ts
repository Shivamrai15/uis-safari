import type { Request, Response } from "express";
import { db } from "../lib/db.js";
import { RegisterDeviceSchema, UnregisterDeviceSchema } from "../schemas/device.schema.js";

export async function registerDevice(req: Request, res: Response) {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({
        status: false,
        message: "Unauthorized access",
        data: {},
      });
    }

    const validatedData = await RegisterDeviceSchema.safeParseAsync(req.body);
    if (!validatedData.success) {
      return res.status(400).json({
        status: false,
        message: "Bad Request",
        data: {},
      });
    }

    const { token, platform } = validatedData.data;

    await db.deviceToken.upsert({
      where: { token },
      create: { token, platform, userId: user.userId },
      update: { platform, userId: user.userId },
    });

    return res.json({
      status: true,
      message: "Device registered",
      data: {},
    });
  } catch (error) {
    console.error("REGISTER DEVICE ERROR", error);
    return res.status(500).json({
      status: false,
      message: "Internal Server Error",
      data: {},
    });
  }
}

export async function unregisterDevice(req: Request, res: Response) {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({
        status: false,
        message: "Unauthorized access",
        data: {},
      });
    }

    const validatedData = await UnregisterDeviceSchema.safeParseAsync(req.body);
    if (!validatedData.success) {
      return res.status(400).json({
        status: false,
        message: "Bad Request",
        data: {},
      });
    }

    await db.deviceToken.deleteMany({
      where: { token: validatedData.data.token, userId: user.userId },
    });

    return res.json({
      status: true,
      message: "Device unregistered",
      data: {},
    });
  } catch (error) {
    console.error("UNREGISTER DEVICE ERROR", error);
    return res.status(500).json({
      status: false,
      message: "Internal Server Error",
      data: {},
    });
  }
}
