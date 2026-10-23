import { SourceTooLarge, type Source } from "./source";
import { deployName, publicUrl, type VercelClient } from "./vercel";

export type DeployResult = { url: string; commit: string; deploymentId: string };

export type DeploySeams = {
  projectId: string;
  exportSource: () => Promise<Source>;
  client: Pick<VercelClient, "uploadFiles" | "createDeployment" | "waitReady" | "buildLogTail">;
  emit: (event: string, data?: Record<string, unknown>) => void;
  save: (r: DeployResult) => Promise<void>;
};

// One deploy, start to finish, reported as events on the project's live stream:
//   deploy_started → deploy_building → deploy_ready { url } | deploy_failed { message, log? }
// It never throws: the button that started it returned long ago, so the stream is the only
// place an outcome can go.
export async function deployProject(s: DeploySeams): Promise<DeployResult | null> {
  s.emit("deploy_started");
  try {
    const source = await s.exportSource();
    const refs = await s.client.uploadFiles(source.files);
    const created = await s.client.createDeployment(deployName(s.projectId), refs, { orinProjectId: s.projectId, commit: source.commit });
    s.emit("deploy_building", { deploymentId: created.id, files: refs.length });
    const done = await s.client.waitReady(created.id);
    if (done.readyState !== "READY") {
      const log = await s.client.buildLogTail(created.id);
      s.emit("deploy_failed", { deploymentId: created.id, message: done.errorMessage ?? `build ${done.readyState.toLowerCase()}`, log });
      return null;
    }
    const result = { url: publicUrl(done), commit: source.commit, deploymentId: done.id };
    await s.save(result);
    s.emit("deploy_ready", { ...result });
    return result;
  } catch (e) {
    const message = e instanceof SourceTooLarge
      ? "The app's files are over the 25 MB deploy limit. Remove large files (build output, binaries, big assets) or add them to .gitignore."
      : String(e instanceof Error ? e.message : e);
    s.emit("deploy_failed", { message });
    return null;
  }
}
