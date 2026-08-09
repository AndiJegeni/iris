export { start, VERSION } from './server';
export type { StartOptions, Orchestrator } from './server';
export { resolveAuth } from './auth';
export type { AuthState, AuthSource } from './auth';
export { WorktreeManager } from './worktrees';
export {
  detectPackageManager,
  defaultDevCmd,
  addDevDepCmd,
  isGitRepo,
  resolveRemoteName,
} from './project';
export type { PackageManager } from './project';
export { resolveClaudeBinary, describeClaudeBinary } from './claude-binary';
export type { ClaudeBinary } from './claude-binary';
