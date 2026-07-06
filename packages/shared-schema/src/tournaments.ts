import { z } from "zod";

import {
  tournamentMembershipSchema,
  tournamentSettingsSchema,
} from "./roles.ts";

export const gameKeySchema = z.string().min(1);

export const tournamentContextSchema = z.object({
  tournamentId: z.string().min(1),
  roundId: z.string().min(1),
  tableId: z.string().min(1),
  matchId: z.string().min(1),
  gameKey: gameKeySchema,
});

export const tournamentProjectionContextSchema = tournamentContextSchema.extend({
  streamId: z.string().min(1),
});

export const tournamentDefinitionSchema = z.object({
  tournamentId: z.string().min(1),
  name: z.string().min(1).optional(),
  settings: tournamentSettingsSchema.default({ findingVisibilityMode: "players" }),
  memberships: z.array(tournamentMembershipSchema).default([]),
});

export type GameKey = z.infer<typeof gameKeySchema>;
export type TournamentContext = z.infer<typeof tournamentContextSchema>;
export type TournamentProjectionContext = z.infer<typeof tournamentProjectionContextSchema>;
export type TournamentDefinition = z.infer<typeof tournamentDefinitionSchema>;
