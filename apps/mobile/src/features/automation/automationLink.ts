/**
 * Kuca micro-patch: host-driven automation for real-device acceptance.
 *
 * The host opens `t3code://automation/<action>?…` with
 * `xcrun devicectl device process launch --payload-url`, the App performs the
 * action through the same state commands the UI uses, and appends one JSON
 * report per action to `Documents/automation/`. The host pulls those files
 * with `xcrun devicectl device copy from --domain-type appDataContainer`.
 * No screenshots, no accessibility driver: control and feedback are both
 * structured data.
 *
 * Only armed in dev-signed builds (bundle id ends with `.dev`); production
 * bundles ignore these links entirely.
 */
import Constants from "expo-constants";
import * as Linking from "expo-linking";
import { createNavigationContainerRef } from "@react-navigation/native";
import type { EnvironmentId, ModelSelection, ThreadId } from "@t3tools/contracts";
import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  MessageId,
} from "@t3tools/contracts";
import { buildTemporaryWorktreeBranchName } from "@t3tools/shared/git";
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";

import { markInboundLaunchTarget } from "../home/firstScreenLaunch";
import {
  AUTOMATION_DIRECTORY,
  type AutomationRequest,
  isAutomationUrl,
  parseAutomationUrl,
} from "./automationUrl";

import { makeQueuedMessageMetadata, makeTurnCommandMetadata } from "../../lib/commandMetadata";
import { buildModelOptions, resolveSelectableModelSelection } from "../../lib/modelOptions";
import { buildProjectThreadStartTurnInput } from "../../lib/projectThreadStartTurn";
import { randomHex } from "../../lib/uuid";
import { appAtomRegistry } from "../../state/atom-registry";
import { environmentCatalog } from "../../connection/catalog";
import { environmentPresentations } from "../../state/presentation";
import { environmentProjects } from "../../state/projects";
import { serverEnvironment } from "../../state/server";
import { enqueueThreadOutboxMessage } from "../../state/thread-outbox";
import { environmentThreadShells, threadEnvironment } from "../../state/threads";
import { pendingConnectionErrorAtom } from "../../state/use-remote-environment-registry";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const automationNavigationRef = createNavigationContainerRef<any>();

let armed: boolean | null = null;

/**
 * Armed only when the host has placed `Documents/automation/ARMED` in the App
 * data container (possible only from the paired Mac, on a developer-installed
 * build, via `devicectl device copy to`) or the embedded config says `.dev`.
 * The embedded expo config of a personal-team build still carries the
 * upstream production bundle id, so the file marker is the reliable switch.
 */
export function isAutomationArmed(): boolean {
  if (armed !== null) return armed;
  const bundleId = Constants.expoConfig?.ios?.bundleIdentifier ?? "";
  if (bundleId.endsWith(".dev")) return (armed = true);
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { File, Paths } = require("expo-file-system") as typeof import("expo-file-system");
    armed = new File(Paths.document, AUTOMATION_DIRECTORY, "ARMED").exists;
  } catch {
    armed = false;
  }
  return armed;
}

async function writeReport(request: AutomationRequest, body: Record<string, unknown>) {
  const { Directory, File, Paths } = await import("expo-file-system");
  const directory = new Directory(Paths.document, AUTOMATION_DIRECTORY);
  directory.create({ idempotent: true, intermediates: true });
  const file = new File(directory, `${request.runId}-${request.action}.json`);
  file.create({ intermediates: true, overwrite: true });
  file.write(
    JSON.stringify(
      {
        runId: request.runId,
        action: request.action,
        params: request.params,
        at: new Date().toISOString(),
        ...body,
      },
      null,
      2,
    ),
  );
}

/** Side-channel for screens (Web page load result, connection toasts). */
export function automationNote(kind: string, body: Record<string, unknown>): void {
  if (!isAutomationArmed()) return;
  void writeReport({ action: "report", runId: `note-${Date.now()}`, params: { kind } }, body).catch(
    () => {},
  );
}

function snapshotState() {
  const presentations = appAtomRegistry.get(environmentPresentations.presentationsAtom);
  const catalog = appAtomRegistry.get(environmentCatalog.catalogValueAtom);
  const threads = appAtomRegistry.get(environmentThreadShells.threadShellsAtom);
  const route = automationNavigationRef.isReady()
    ? automationNavigationRef.getCurrentRoute()
    : null;
  return {
    catalogReady: catalog.isReady,
    pendingConnectionError: appAtomRegistry.get(pendingConnectionErrorAtom),
    environments: [...presentations.entries()].map(([environmentId, presentation]) => ({
      environmentId,
      phase: presentation.connection.phase,
      error: presentation.connection.error,
      traceId: presentation.connection.traceId,
    })),
    threadCount: threads.length,
    threads: threads.slice(0, 40).map((thread) => ({
      environmentId: thread.environmentId,
      id: thread.id,
      title: (thread as { title?: string }).title ?? null,
      sessionStatus: (thread as { session?: { status?: string } }).session?.status ?? null,
      latestTurn: (thread as { latestTurn?: unknown }).latestTurn ?? null,
    })),
    route: route ? { name: route.name, params: route.params ?? null } : null,
  };
}

async function waitForNavigation(timeoutMs = 8_000): Promise<boolean> {
  const started = Date.now();
  while (!automationNavigationRef.isReady()) {
    if (Date.now() - started > timeoutMs) return false;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return true;
}

export async function performAutomation(request: AutomationRequest): Promise<void> {
  const { params } = request;
  const environmentId = params.environmentId as EnvironmentId | undefined;
  const threadId = params.threadId as ThreadId | undefined;
  // Extra fields the action wants in its report (e.g. the thread it created).
  const extra: Record<string, unknown> = {};
  try {
    switch (request.action) {
      case "report":
        break;
      case "open-thread": {
        if (!environmentId || !threadId) throw new Error("environmentId and threadId are required");
        if (!(await waitForNavigation())) throw new Error("navigation not ready");
        markInboundLaunchTarget();
        automationNavigationRef.navigate("Thread", { environmentId, threadId });
        break;
      }
      case "open-web": {
        if (!(await waitForNavigation())) throw new Error("navigation not ready");
        markInboundLaunchTarget();
        automationNavigationRef.navigate("Web", { path: params.path ?? "/" });
        break;
      }
      case "send": {
        if (!environmentId || !threadId) throw new Error("environmentId and threadId are required");
        const text = params.text ?? "";
        if (text.length === 0) throw new Error("text is required");
        const metadata = makeQueuedMessageMetadata();
        await enqueueThreadOutboxMessage({
          environmentId,
          threadId,
          messageId: MessageId.make(metadata.messageId),
          commandId: CommandId.make(metadata.commandId),
          text,
          attachments: [],
          createdAt: metadata.createdAt,
        });
        break;
      }
      case "new-thread": {
        // Same path as NewTaskDraftScreen.handleStart when the environment is
        // connected: one thread.turn.start with a createThread bootstrap.
        // Project: `projectId` or the first project of the environment.
        // Model: `model` slug among selectable options, else the project
        // default, else the server default, else the first selectable model.
        if (!environmentId) throw new Error("environmentId is required");
        const text = params.text ?? "";
        if (text.length === 0) throw new Error("text is required");
        const projects = appAtomRegistry
          .get(environmentProjects.projectsAtom)
          .filter((project) => String(project.environmentId) === String(environmentId));
        const project = params.projectId
          ? projects.find((candidate) => String(candidate.id) === params.projectId)
          : projects[0];
        if (!project)
          throw new Error(
            `project not found (${projects.length} project(s) in environment; ids: ${projects
              .map((candidate) => String(candidate.id))
              .join(",")})`,
          );
        const config = appAtomRegistry.get(serverEnvironment.configValueAtom(environmentId));
        const projectDefault = resolveSelectableModelSelection(
          config,
          project.defaultModelSelection ?? null,
        );
        const modelOptions = buildModelOptions(config, projectDefault);
        const requested = params.model
          ? modelOptions.find((option) => option.selection.model === params.model)?.selection
          : undefined;
        const modelSelection: ModelSelection | null =
          requested ??
          projectDefault ??
          modelOptions.find((option) => option.isDefault)?.selection ??
          modelOptions[0]?.selection ??
          null;
        if (!modelSelection)
          throw new Error(
            `no selectable model (config ${config ? "present" : "absent"}, ${modelOptions.length} option(s))`,
          );
        const metadata = makeTurnCommandMetadata();
        extra.threadId = metadata.threadId;
        extra.projectId = String(project.id);
        extra.modelSelection = modelSelection;
        const result = await runAtomCommand(
          appAtomRegistry,
          threadEnvironment.startTurn,
          {
            environmentId,
            input: buildProjectThreadStartTurnInput({
              projectId: project.id,
              projectCwd: project.workspaceRoot,
              threadId: metadata.threadId,
              commandId: metadata.commandId,
              messageId: metadata.messageId,
              createdAt: metadata.createdAt,
              text,
              attachments: [],
              modelSelection,
              runtimeMode: DEFAULT_RUNTIME_MODE,
              interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
              workspaceMode: "local",
              branch: null,
              worktreePath: null,
              startFromOrigin: false,
              worktreeBranchName: buildTemporaryWorktreeBranchName(randomHex),
            }),
          },
          { reportFailure: false },
        );
        if (result._tag !== "Success")
          throw new Error(`new-thread failed: ${JSON.stringify(result)}`);
        if (await waitForNavigation()) {
          markInboundLaunchTarget();
          automationNavigationRef.navigate("Thread", {
            environmentId: String(environmentId),
            threadId: metadata.threadId,
          });
        }
        break;
      }
      case "interrupt": {
        if (!environmentId || !threadId) throw new Error("environmentId and threadId are required");
        const result = await runAtomCommand(
          appAtomRegistry,
          threadEnvironment.interruptTurn,
          { environmentId, input: { threadId } },
          { reportFailure: false },
        );
        if (result._tag !== "Success")
          throw new Error(`interrupt failed: ${JSON.stringify(result)}`);
        break;
      }
    }
    // Let navigation / outbox settle before the snapshot.
    await new Promise((resolve) => setTimeout(resolve, 600));
    await writeReport(request, { ok: true, ...extra, state: snapshotState() });
  } catch (error) {
    await writeReport(request, {
      ok: false,
      ...extra,
      error: error instanceof Error ? error.message : String(error),
      state: snapshotState(),
    });
  }
}

let installed = false;

/** Subscribe once; safe to call from an effect on every mount. */
export { isAutomationUrl, parseAutomationUrl } from "./automationUrl";

export function installAutomationLink(): () => void {
  if (!isAutomationArmed() || installed) return () => {};
  installed = true;
  const handle = (url: string | null) => {
    if (!url || !isAutomationUrl(url)) return;
    const request = parseAutomationUrl(url);
    if (request) void performAutomation(request);
    else
      void writeReport(
        { action: "report", runId: `bad-${Date.now()}`, params: { url } },
        { ok: false, error: "unparseable automation url" },
      );
  };
  const subscription = Linking.addEventListener("url", (event) => handle(event.url));
  void Linking.getInitialURL().then(
    (initial) => {
      // Boot record: proves the hook installed and shows what the cold start saw.
      void writeReport(
        { action: "report", runId: `boot-${Date.now()}`, params: { initialUrl: initial ?? "" } },
        { ok: true },
      ).catch(() => {});
      handle(initial);
    },
    (error: unknown) => {
      void writeReport(
        { action: "report", runId: `boot-${Date.now()}`, params: {} },
        { ok: false, error: String(error) },
      ).catch(() => {});
    },
  );
  return () => {
    subscription.remove();
    installed = false;
  };
}
