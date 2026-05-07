import {
  tournamentContextSchema,
  type TournamentContext,
} from "../../../../packages/shared-schema/src/index";

export function buildTournamentContext(input: TournamentContext): TournamentContext {
  return tournamentContextSchema.parse(input);
}
