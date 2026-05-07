export interface ImportDiagnosticView {
  sessionId: string;
  sourcePath: string;
  diagnosticKind: string;
  message: string;
}

export interface DiagnosticsRouteState {
  title: string;
  empty: boolean;
  unknownEventCount: number;
  warningCount: number;
  diagnostics: ImportDiagnosticView[];
}

export function buildDiagnosticsRouteState(
  diagnostics: ImportDiagnosticView[],
  unknownEvents: string[],
): DiagnosticsRouteState {
  return {
    title: "Diagnostics",
    empty: diagnostics.length === 0 && unknownEvents.length === 0,
    unknownEventCount: unknownEvents.length,
    warningCount: diagnostics.length,
    diagnostics,
  };
}
