import { sha256 } from '@cosmjs/crypto';
import { fromHex, toBech32 } from '@cosmjs/encoding';
import { get } from '@/libs';

// On-chain relay registry (pokerchain.pokerchain.v1). uint64/int64 come back
// from the LCD as strings, enums as their fully qualified names.
export interface Relay {
  relay_id: string;
  owner: string;
  // NOTE: there is deliberately no `endpoint`. Under ADR-007 the chain
  // publishes a relay's identity, not its location: the endpoint reaches the
  // two players of a session inside an encrypted per-session answer and is
  // never stored on chain. Nothing here — and no third party — can learn it.
  pubkey: string;
  capacity: string;
  status: string;
  metadata: string;
  bond_amount: string;
  bonded_height: string;
  // Slice queued by a partial unbonding: out of bond_amount already, but still
  // slashable until withdrawn (ADR-007 §3.3).
  unbonding_amount: string;
  unbonding_end_height: string;
  last_heartbeat_height: string;
  slash_count: string;
  last_slashed_height: string;
  // Claim windows this relay let expire while assigned — real-work liveness
  // evidence that replaced synthetic probing (ADR-007 §3.1).
  assignment_miss_count: string;
  last_miss_height: string;
  // Sessions it has answered that have not reached a terminal status.
  active_session_count: string;
  // The relay's own price, bounded by the governance ceilings (§3.4).
  fee_flat: string;
  fee_bps: string;
}

// The subset of x/pokerchain params the relay pages need to interpret a relay:
// what its bond covers, and where its quote sits against the ceilings.
export interface PokerchainParams {
  relay_min_bond: string;
  relay_per_session_collateral: string;
  relay_fee_flat: string;
  relay_fee_bps: string;
  relay_slash_decay_blocks: string;
  relay_claim_window_blocks: string;
  relay_answer_timeout_blocks: string;
}

export interface RelayChallenge {
  challenge_id: string;
  relay_id: string;
  challenger: string;
  evidence: string;
  deposit: string;
  challenged_height: string;
  response_deadline_height: string;
  status: string;
  response: string;
  responded_height: string;
  resolved_height: string;
  slash_amount: string;
  bounty_amount: string;
}

const RELAY_ID_HRP = 'relay';
const ED25519_PUBKEY_BYTES = 32;

export function relayRestBase(endpoint: string): string {
  return endpoint.replace(/\/+$/, '');
}

export async function fetchRelays(restBase: string, status?: string): Promise<Relay[]> {
  const query = status ? `?status=${status}` : '';
  const data = await get(`${relayRestBase(restBase)}/pokerchain/pokerchain/v1/relays${query}`);
  return data?.relays || [];
}

export async function fetchRelay(restBase: string, relayId: string): Promise<Relay> {
  const data = await get(`${relayRestBase(restBase)}/pokerchain/pokerchain/v1/relays/${relayId}`);
  return data?.relay;
}

export async function fetchRelayChallenges(restBase: string, relayId: string): Promise<RelayChallenge[]> {
  const data = await get(
    `${relayRestBase(restBase)}/pokerchain/pokerchain/v1/relay-challenges?relay_id=${relayId}`
  );
  return data?.challenges || [];
}

// relay_id = bech32("relay", sha256(ed25519_pubkey)[:20]) — ADR-006 §2.2. The
// chain enforces this at registration; recomputing it here lets the page show
// that the advertised identity is self-certifying rather than just asserted.
export function derivedRelayId(pubkeyHex: string): string | null {
  try {
    const pubkey = fromHex((pubkeyHex || '').trim().toLowerCase());
    if (pubkey.length !== ED25519_PUBKEY_BYTES) return null;
    return toBech32(RELAY_ID_HRP, sha256(pubkey).slice(0, 20));
  } catch {
    return null;
  }
}

export function shortRelayStatus(status: string): string {
  return (status || '').replace('RELAY_STATUS_', '');
}

export function shortChallengeStatus(status: string): string {
  return (status || '').replace('RELAY_CHALLENGE_STATUS_', '');
}

export function relayStatusColor(status: string): string {
  switch (shortRelayStatus(status)) {
    case 'ACTIVE':
      return 'bg-success text-white';
    case 'DRAINING':
    case 'UNBONDING':
      return 'bg-warning text-white';
    case 'JAILED':
      return 'bg-error text-white';
    case 'OFFLINE':
    case 'STALE':
      return 'bg-error/70 text-white';
    default:
      return 'bg-base-300';
  }
}

export async function fetchPokerchainParams(restBase: string): Promise<PokerchainParams | null> {
  const data = await get(`${relayRestBase(restBase)}/pokerchain/pokerchain/v1/params`);
  return data?.params || null;
}

// How many sessions this bond covers at once. Returns null when the chain does
// not price concurrency (relay_per_session_collateral = 0), where the honest
// answer is "unbounded", not "zero".
export function coveredSessions(relay: Relay, params?: PokerchainParams | null): number | null {
  const collateral = Number(params?.relay_per_session_collateral || 0);
  if (!collateral) return null;
  return Math.floor(Number(relay.bond_amount || 0) / collateral);
}

// A relay's quote for a pot, in the escrow denom. Mirrors quotedRake in the
// keeper; the pot is 2x the stake.
export function quotedRake(relay: Relay, pot: number): number {
  return Number(relay.fee_flat || 0) + Math.floor((pot * Number(relay.fee_bps || 0)) / 10000);
}

// Where a quote sits between free and the governance ceiling, 0..1. Undercutting
// buys assignment weight, so this is the number that predicts volume — not the
// raw fee. null when governance allows no fee at all (nothing to compare to).
export function quoteFraction(relay: Relay, params?: PokerchainParams | null): number | null {
  const ceilFlat = Number(params?.relay_fee_flat || 0);
  const ceilBps = Number(params?.relay_fee_bps || 0);
  if (!ceilFlat && !ceilBps) return null;
  const flat = Number(relay.fee_flat || 0);
  const bps = Number(relay.fee_bps || 0);
  const ceilingScore = ceilFlat + ceilBps;
  if (!ceilingScore) return null;
  return Math.min(1, (flat + bps) / ceilingScore);
}

export function relayIsFree(relay: Relay): boolean {
  return !Number(relay.fee_flat || 0) && !Number(relay.fee_bps || 0);
}
