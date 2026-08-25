import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { discardWarning } from './task-panel';

/**
 * Which task-row actions stop to ask, and how. Merge fires on the click; Archive
 * raises the overlay's modal dialog, which the panel owns because a dialog
 * mounted inside the drawer is clipped by its backdrop-filter.
 *
 * The wiring is asserted against the source text rather than a rendered tree —
 * the overlay has no DOM harness, and the regression these guard against (a
 * confirmation creeping back onto the row, or the dialog being mounted from two
 * places) is visible in the source.
 */
const read = (name: string) => readFileSync(join(import.meta.dir, name), 'utf8');

describe('discardWarning', () => {
  test('names the worktree and what goes with it', () => {
    const body = discardWarning('fix-login-9f2a');
    expect(body).toContain("fix-login-9f2a's dev server");
    expect(body).toContain('deletes the worktree directory');
    expect(body).toContain('branch lives inside that directory');
    expect(body).toContain('lost');
  });
});

describe('task row confirmations', () => {
  const row = read('task-row.tsx');

  test('Merge locally fires straight through, with nothing to arm', () => {
    expect(row).toContain('onClick={wt.onShip}');
    expect(row).not.toContain('Are you sure');
    expect(row).not.toContain('setConfirming');
  });

  test('Archive with a worktree raises the panel dialog rather than a question in the row', () => {
    expect(row).toContain('onClick={wt.onDiscard}');
  });

  test('a row with no worktree still archives on the click', () => {
    expect(row).toContain('onClick={onArchive}');
  });
});

describe('task panel dialogs', () => {
  const panel = read('task-panel.tsx');

  test('one state slot, so Clear and Archive can never both be up', () => {
    expect(panel).toContain("dialog?.kind === 'clear'");
    expect(panel).toContain("dialog?.kind === 'discard'");
    // Two open dialogs would need two things to set: every mount reads `dialog`.
    expect(panel.match(/<ConfirmDialog/g)?.length).toBe(2);
    expect(panel.match(/useState<PanelDialog \| null>/g)?.length).toBe(1);
  });

  test('the discard only runs once the dialog is answered', () => {
    expect(panel).toContain("onDiscard: () => setDialog({ kind: 'discard'");
    expect(panel).toContain('discardWorktree(dialog.taskId, dialog.slug)');
  });
});
