/**
 * Process-local flag: this launch already has an explicit destination
 * (notification tap, automation open-thread/open-web, launcher shortcut).
 * FirstScreenGate reads it so an automatic last-thread restore — which uses
 * the same `[Home, Thread]` stack shape as a notification push — is not
 * mistaken for that inbound target.
 */

let inboundLaunchTarget = false;

export function markInboundLaunchTarget(): void {
  inboundLaunchTarget = true;
}

export function hasInboundLaunchTarget(): boolean {
  return inboundLaunchTarget;
}

/** Test-only: the flag is process-local and otherwise lives for the app lifetime. */
export function resetInboundLaunchTarget(): void {
  inboundLaunchTarget = false;
}
