import { z } from "zod";

/**
 * Tournament roles, memberships, and settings (plan 2026-07-06-001,
 * unit W0.1). Roles are scoped per tournament; local single-player use
 * never requires an account or role.
 */

export const tournamentRoleSchema = z.enum([
  "organizer",
  "referee",
  "player",
  "spectator",
]);

export const tournamentMembershipSchema = z.object({
  tournamentId: z.string().min(1),
  userId: z.string().min(1),
  role: tournamentRoleSchema,
});

export const findingVisibilityModeSchema = z.enum([
  "players",
  "referee-only",
]);

export const tournamentSettingsSchema = z.object({
  findingVisibilityMode: findingVisibilityModeSchema.default("players"),
});

export type TournamentRole = z.infer<typeof tournamentRoleSchema>;
export type TournamentMembership = z.infer<typeof tournamentMembershipSchema>;
export type FindingVisibilityMode = z.infer<typeof findingVisibilityModeSchema>;
export type TournamentSettings = z.infer<typeof tournamentSettingsSchema>;
