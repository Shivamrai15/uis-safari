import * as z from "zod";

export const RegisterDeviceSchema = z.object({
    token: z.string().min(1).max(4096),
    platform: z.enum(["android"]),
});

export const UnregisterDeviceSchema = z.object({
    token: z.string().min(1).max(4096),
});
