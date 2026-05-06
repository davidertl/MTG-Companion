export interface SetupStateInput {
  hasDetailedLogs: boolean;
  logPath?: string;
}

export type DesktopHostPlatform = "windows" | "macos" | "linux" | "other";

export interface SetupChecklistItem {
  id: string;
  label: string;
  complete: boolean;
}

export interface OfflineImportMethod {
  id: "drag-and-drop" | "folder-import";
  label: string;
  description: string;
  accepts: string[];
  platformTag: "ios";
}

export interface IosOfflineImportGuidance {
  platformTag: "ios";
  noItunesRequired: boolean;
  methods: OfflineImportMethod[];
  primaryGuidance: string;
  steps: string[];
  fallbackNote: string;
  nonGoals: string[];
  futureIosAppNote: string;
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

export function getIosOfflineImportMethods(): OfflineImportMethod[] {
  return [
    {
      id: "drag-and-drop",
      label: "Drag & Drop von .log-Dateien",
      description: "Exportierte MTG Arena iOS Logs direkt in den Desktop-Companion ziehen.",
      accepts: [".log"],
      platformTag: "ios",
    },
    {
      id: "folder-import",
      label: "Ordnerimport",
      description: "Einen exportierten Log-Ordner rekursiv importieren und doppelte Logs ueberspringen.",
      accepts: [".log"],
      platformTag: "ios",
    },
  ];
}

export function getIosOfflineImportGuidance(
  hostPlatform: DesktopHostPlatform,
): IosOfflineImportGuidance {
  const primaryGuidance =
    hostPlatform === "windows"
      ? "Exportiere die MTG Arena Logdateien nach Moeglichkeit ueber Apple Devices auf Windows."
      : hostPlatform === "macos"
        ? "Exportiere die MTG Arena Logdateien nach Moeglichkeit ueber Finder auf macOS."
        : "Exportiere die MTG Arena Logdateien zuerst auf deinen Desktop und importiere sie dann lokal.";

  const platformSpecificStep =
    hostPlatform === "windows"
      ? "Oeffne Apple Devices auf Windows, waehle dein iPhone/iPad und exportiere die MTG Arena Dateien, falls die App dort sichtbar ist."
      : hostPlatform === "macos"
        ? "Oeffne Finder auf macOS, waehle dein iPhone/iPad und exportiere die MTG Arena Dateien, falls die App dort sichtbar ist."
        : "Nutze den verfuegbaren Dateiexport auf deinem Rechner, um die MTG Arena Dateien lokal abzulegen.";

  return {
    platformTag: "ios",
    noItunesRequired: true,
    methods: getIosOfflineImportMethods(),
    primaryGuidance,
    steps: [
      platformSpecificStep,
      "Ziehe exportierte .log-Dateien per Drag & Drop in die App oder importiere einen Ordner mit exportierten Logs.",
      "Wiederholte Importe derselben Logs werden dedupliziert und als Plattform \"ios\" getaggt.",
    ],
    fallbackNote:
      "Falls MTG Arena in Apple Devices oder Finder nicht sichtbar ist, koennen Drittanbieter-Tools fuer iOS-Dateiuebertragung als Fallback genutzt werden, solange sie nur den exportierten Dateizugriff ermoeglichen.",
    nonGoals: [
      "Kein Live-Tracking auf iPad/iPhone",
      "Kein Overlay auf iOS/iPadOS",
      "Kein Packet Capture, Jailbreak-Zugriff, Memory Inspection oder direkter Sandbox-Zugriff zwischen Apps",
    ],
    futureIosAppNote:
      "Eine spaetere iOS-App wird nur als Viewer-, Sync- oder Import-Helper betrachtet, nicht als vollwertiger Tracker mit Live-Erfassung.",
  };
}
