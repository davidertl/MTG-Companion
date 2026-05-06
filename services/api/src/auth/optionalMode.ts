export type SessionMode = "anonymous" | "authenticated";

export interface SessionContext {
  mode: SessionMode;
  token: string | null;
}

export function resolveSession(token?: string | null): SessionContext {
  if (!token) {
    return { mode: "anonymous", token: null };
  }

  return {
    mode: "authenticated",
    token,
  };
}

export function resolveSessionMode(token?: string | null): SessionMode {
  return resolveSession(token).mode;
}
