import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AttachedImage } from '@iris/shared';

const EXT: Record<AttachedImage['mediaType'], string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

/**
 * Write an annotation's attached images out as real files, returning their
 * absolute paths. The backends can't take base64 over their wire — the Claude
 * worker gets a plain prompt string and codex a CLI invocation — but both can
 * take a file: Claude's Read tool renders images, and `codex exec -i` attaches
 * them. Staged under the OS temp dir (never the worktree, where they'd show up
 * as untracked files in the very diff the agent is producing).
 */
export async function stageImages(images: AttachedImage[]): Promise<string[]> {
  const dir = await mkdtemp(join(tmpdir(), 'iris-images-'));
  return Promise.all(
    images.map(async (img, i) => {
      const ext = EXT[img.mediaType];
      // The original filename helps the agent ("before.png" vs "after.png"),
      // sanitized down to something path-safe; the index keeps duplicates apart.
      const safe = (img.name ?? '')
        .replace(/[^\w.-]+/g, '_')
        .replace(/^[_.]+/, '')
        .slice(0, 60);
      const base = safe || `image.${ext}`;
      const name = /\.(png|jpe?g|gif|webp)$/i.test(base) ? base : `${base}.${ext}`;
      const path = join(dir, `${i + 1}-${name}`);
      await writeFile(path, Buffer.from(img.dataBase64, 'base64'));
      return path;
    }),
  );
}

/** Prompt appendix pointing an agent with a Read tool at the staged files. */
export function imagesAppendix(paths: string[]): string {
  return [
    '',
    '',
    `The user attached ${paths.length} image(s) with this request, saved at:`,
    ...paths.map((p) => `  ${p}`),
    'View them with the Read tool before starting — they show what the user is referring to.',
  ].join('\n');
}
