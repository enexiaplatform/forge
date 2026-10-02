import { useState } from 'react';
import type { AskAct, CommitmentView } from '@forge/kernel';
import { ActionDialog } from './ActionDialog';

/** Lazily-opened dialog state for a page. */
export function useActionDialog() {
  const [state, setState] = useState<{ view: CommitmentView; act: AskAct; subject: string | null } | null>(null);
  const element = state ? <ActionDialog view={state.view} act={state.act} subject={state.subject} onClose={() => setState(null)} /> : null;
  return { open: (view: CommitmentView, act: AskAct, subject: string | null = null) => setState({ view, act, subject }), element };
}

