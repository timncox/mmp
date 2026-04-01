// Shared navigation types and function — extracted to break circular dependency
// between inbox-app.ts and view files.

export type ViewName =
  | "onboarding"
  | "threads"
  | "thread"
  | "compose"
  | "contacts"
  | "settings";

export interface ViewParams {
  threadId?: string;
  recipientHandle?: string;
}

let navigationCallback: ((view: ViewName, params?: ViewParams) => void) | null = null;

export function setNavigationCallback(cb: (view: ViewName, params?: ViewParams) => void): void {
  navigationCallback = cb;
}

export function navigateTo(view: ViewName, params?: ViewParams): void {
  if (navigationCallback) {
    navigationCallback(view, params);
  }
}
