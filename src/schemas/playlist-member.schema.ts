import * as z from "zod";

export const InviteMemberSchema = z.object({
    email: z.email(),
    role: z.enum(["ADMIN", "COLLABORATOR"]).optional(),
});

export const JoinRequestSchema = z.object({
    token: z.string().min(1),
});

export const UpdateMemberRoleSchema = z.object({
    role: z.enum(["ADMIN", "COLLABORATOR"]),
});
