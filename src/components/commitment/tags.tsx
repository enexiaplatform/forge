import { type CaptureMode, type CommitmentView, describeProtection, type Epistemic, type Protection, type RequirementStatus, type Severity } from '@forge/kernel';
import type { FieldState } from '@forge/fabric';
import { Tag, type Tone } from '../ui/primitives';
import { humanize } from '../../lib/format';

const epistemicTone: Record<Epistemic, Tone> = {
  FACT: 'neutral',
  INFERENCE: 'violet',
  ASSUMPTION: 'amber',
  PREDICTION: 'sky',
  RECOMMENDATION: 'sky',
  DECISION: 'accent',
};

const epistemicTitle: Record<Epistemic, string> = {
  FACT: 'What a system recorded or a person confirmed',
  INFERENCE: 'Concluded from facts — not enterprise truth until a person confirms it',
  ASSUMPTION: 'What the plan rests on without proof',
  PREDICTION: 'A claim about the future',
  RECOMMENDATION: 'A suggestion, attributed to whoever made it',
  DECISION: 'A choice a person made',
};

/** Statement class, never dropped on the way to the screen (§20). */
export const EpistemicTag = ({ value }: { value: Epistemic }) => (
  <Tag tone={epistemicTone[value]} title={epistemicTitle[value]}>
    {value.toLowerCase()}
  </Tag>
);

const captureTone: Record<FieldState, Tone> = {
  INHERITED: 'emerald',
  SYSTEM_EVENT: 'emerald',
  EXTRACTED: 'sky',
  INFERRED: 'violet',
  CONFIRMED: 'neutral',
  MANUAL: 'amber',
  MISSING: 'red',
};

const captureText: Record<FieldState, string> = {
  INHERITED: 'inherited',
  SYSTEM_EVENT: 'from a system',
  EXTRACTED: 'extracted',
  INFERRED: 'inferred',
  CONFIRMED: 'confirmed',
  MANUAL: 'typed',
  MISSING: 'missing',
};

const captureTitle: Record<FieldState, string> = {
  INHERITED: 'Already known elsewhere in the ecosystem — nobody typed it',
  SYSTEM_EVENT: 'Recorded by a system event',
  EXTRACTED: 'Extracted from a document or message',
  INFERRED: 'Forge’s inference — the owner confirms or changes it on accepting',
  CONFIRMED: 'An inference the owner confirmed',
  MANUAL: 'Typed by a person',
  MISSING: 'Nothing knows this yet — a person must supply it',
};

/** How a piece of information reached Forge (§9). */
export const CaptureTag = ({ value }: { value: CaptureMode | FieldState }) => (
  <Tag tone={captureTone[value]} title={captureTitle[value]}>
    {captureText[value]}
  </Tag>
);

const requirementTone: Record<RequirementStatus, Tone> = {
  OPEN: 'outline',
  INFERRED: 'violet',
  EVIDENCED: 'emerald',
  CONTRADICTED: 'red',
  CONFLICTED: 'red',
};

export const RequirementTag = ({ value }: { value: RequirementStatus }) => <Tag tone={requirementTone[value]}>{value.toLowerCase()}</Tag>;

/** Phases and endings are facts, set in ink: Forge does not grade an outcome by colouring it. */
export function PhaseTag({ view }: { view: CommitmentView }) {
  if (view.phase === 'CLOSED' && view.resolution) return <Tag tone="outline">{humanize(view.resolution.resolution)}</Tag>;
  if (view.phase === 'DECLINED') return <Tag tone="red">Declined</Tag>;
  if (view.phase === 'PROPOSED') return <Tag tone="amber">Awaiting acceptance</Tag>;
  return <Tag tone="neutral">Active</Tag>;
}

export function SeverityLabel({ value }: { value: Severity }) {
  if (value === 'CANNOT_WAIT') return <span className="font-sans text-label font-semibold uppercase text-red-700">Cannot wait</span>;
  if (value === 'THIS_WEEK') return <span className="font-sans text-label font-medium uppercase text-amber-800">This week</span>;
  return <span className="font-sans text-label font-medium uppercase text-ink-500">Noted</span>;
}

/** A value this reader is not cleared for (ADR-0017): said, never shown as missing. */
export const WithheldValue = ({ protection }: { protection: Protection }) => (
  <span title={`Withheld — ${describeProtection(protection)}. Shown only to people Helm has cleared.`} className="italic text-ink-500">
    withheld
  </span>
);
