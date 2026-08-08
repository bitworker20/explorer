import { get } from '@/libs';

// On-chain game-session registry (pokerchain.pokerchain.v1). Same LCD JSON
// conventions as the relay module: uint64/int64 come back as strings, enums as
// their fully qualified names, nullable sub-messages (results, adjudication) are
// absent or null until the session reaches that stage.

export interface RelayAssignment {
  primary_relay: string;
  backup_relays: string[];
}

export interface SessionResult {
  submitter: string;
  winner: string;
  loser: string;
  final_stake: string;
  transcript_hash: string;
  result_signature: string;
  split_pot: boolean;
  // Final chip stacks per seat; both players must submit identical amounts or
  // the session goes to DISPUTED.
  player_a_amount: string;
  player_b_amount: string;
}

export interface SessionAdjudication {
  verdict: string;
  fault: string;
  code: number;
  // Pot distribution awarded to each seat (player_a == engine first seat).
  player_a_amount: string;
  player_b_amount: string;
  engine_version: string;
  dispute_fee: string;
  dispute_fee_collected: boolean;
  adjudicated_height: string;
}

export interface RelayRewardShare {
  relay_id: string;
  amount: string;
  claimed: boolean;
}

export interface GameSession {
  session_id: string;
  player_a_intent_id: string;
  player_b_intent_id: string;
  player_a: string;
  player_b: string;
  game_type: string;
  stake: string;
  relay_assignment: RelayAssignment;
  status: string;
  player_a_result?: SessionResult | null;
  player_b_result?: SessionResult | null;
  result_deadline_height: string;
  hand_id: number;
  button_seat: number;
  player_a_chips: string;
  player_b_chips: string;
  adjudication?: SessionAdjudication | null;
  dispute_deadline_height: string;
  relay_reward: string;
  relay_reward_claimed: boolean;
  relay_fee_snapshot: string;
  relay_reward_shares: RelayRewardShare[];
  relay_fee_bps_snapshot: string;
  relay_fee_cap_snapshot: string;
  relay_backup_fee_bps_snapshot: string;
}

export interface SessionEvidence {
  session_id: string;
  submitter: string;
  evidence_hash: string;
  evidence_payload: string;
  evidence_signature: string;
  reason: string;
}

function restBase(endpoint: string): string {
  return endpoint.replace(/\/+$/, '');
}

// grpc-gateway maps an enum query param through strconv.ParseInt, so the status
// filter must be sent as the GameSessionStatus *integer*, not its name — passing
// "GAME_SESSION_STATUS_SETTLED" returns a parse error. The short UI form maps to
// its enum value here.
const SESSION_STATUS_VALUE: Record<string, number> = {
  UNSPECIFIED: 0,
  ACTIVE: 1,
  RESULT_PENDING: 2,
  SETTLED: 3,
  DISPUTED: 4,
  CANCELLED: 5,
};

export function sessionStatusValue(short: string): number | undefined {
  return SESSION_STATUS_VALUE[short];
}

export async function fetchSessions(
  endpoint: string,
  opts: { player?: string; status?: string } = {}
): Promise<GameSession[]> {
  const params = new URLSearchParams();
  if (opts.player) params.set('player', opts.player);
  // opts.status is the short form (e.g. "SETTLED"); send its enum integer.
  const statusValue = opts.status ? sessionStatusValue(opts.status) : undefined;
  if (statusValue) params.set('status', String(statusValue));
  const query = params.toString() ? `?${params.toString()}` : '';
  const data = await get(`${restBase(endpoint)}/pokerchain/pokerchain/v1/sessions${query}`);
  return data?.sessions || [];
}

export async function fetchSession(endpoint: string, sessionId: string): Promise<GameSession> {
  const data = await get(`${restBase(endpoint)}/pokerchain/pokerchain/v1/sessions/${sessionId}`);
  return data?.session;
}

export async function fetchSessionEvidence(
  endpoint: string,
  sessionId: string
): Promise<SessionEvidence[]> {
  const data = await get(
    `${restBase(endpoint)}/pokerchain/pokerchain/v1/sessions/${sessionId}/evidence`
  );
  return data?.evidence || [];
}

export function shortSessionStatus(status: string): string {
  return (status || '').replace('GAME_SESSION_STATUS_', '');
}

export function shortGameType(gameType: string): string {
  return (gameType || '').replace('GAME_TYPE_', '');
}

// CC / ZJH / TH → a name a human recognises.
export function gameTypeName(gameType: string): string {
  switch (shortGameType(gameType)) {
    case 'CC':
      return 'Card Compare';
    case 'ZJH':
      return 'Zhajinhua';
    case 'TH':
      return "Texas Hold'em";
    default:
      return shortGameType(gameType) || 'Unknown';
  }
}

export function sessionStatusColor(status: string): string {
  switch (shortSessionStatus(status)) {
    case 'SETTLED':
      return 'bg-success text-white';
    case 'ACTIVE':
      return 'bg-info text-white';
    case 'RESULT_PENDING':
      return 'bg-warning text-white';
    case 'DISPUTED':
      return 'bg-error text-white';
    case 'CANCELLED':
      return 'bg-base-300';
    default:
      return 'bg-base-300';
  }
}

// A session carries an on-chain adjudication verdict once a dispute is resolved.
export function hasAdjudication(session?: GameSession): boolean {
  return !!session?.adjudication && !!session.adjudication.verdict;
}

// Verdict/fault come back as fully-qualified enum names (e.g.
// "DISPUTE_VERDICT_REFUND", "DISPUTE_FAULT_NONE").
export function shortVerdict(verdict: string): string {
  return (verdict || '').replace('DISPUTE_VERDICT_', '');
}

export function shortFault(fault: string): string {
  return (fault || '').replace('DISPUTE_FAULT_', '');
}

// A NONE fault is the no-fault outcome; not worth surfacing as a red row.
export function hasFault(fault: string): boolean {
  return !!fault && shortFault(fault) !== 'NONE';
}
