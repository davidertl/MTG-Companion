export interface SetupStateInput {
  hasDetailedLogs: boolean;
  logPath?: string;
}

export interface SetupChecklistItem {
  id: string;
  label: string;
  complete: boolean;
}

export function getSetupChecklist(input: SetupStateInput): SetupChecklistItem[] {
  return [
    {
      id: "detailed-logs",
      label: "Detailed Logs im MTG-Arena-Client aktivieren",
      complete: input.hasDetailedLogs,
    },
    {
      id: "log-path",
      label: "Log-Pfad bestaetigen",
      complete: Boolean(input.logPath),
    },
  ];
}

export function getSetupBanner(input: SetupStateInput): string {
  if (!input.hasDetailedLogs) {
    return "Detailed Logs sind noch nicht aktiviert. Bitte im Arena-Client unter View Account einschalten und danach den Client neu starten.";
  }

  if (!input.logPath) {
    return "Bitte den gefundenen Log-Pfad bestaetigen, damit der Companion lokal lesen kann.";
  }

  return "Der lokale Companion ist bereit und kann ohne Konto starten.";
}
