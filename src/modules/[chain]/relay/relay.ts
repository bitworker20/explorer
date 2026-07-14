import { Ed25519, sha256 } from '@cosmjs/crypto';
import { fromHex, toBech32 } from '@cosmjs/encoding';
import { get } from '@/libs';

// On-chain relay registry (pokerchain.pokerchain.v1). uint64/int64 come back
// from the LCD as strings, enums as their fully qualified names.
export interface Relay {
  relay_id: string;
  owner: string;
  endpoint: string;
  pubkey: string;
  capacity: string;
  status: string;
  metadata: string;
  bond_amount: string;
  bonded_height: string;
  unbonding_end_height: string;
  last_heartbeat_height: string;
  slash_count: string;
  last_slashed_height: string;
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

// The relay daemon's /status payload (x/pokerchain/relay/types.go).
export interface RelayLiveStatus {
  relay_id: string;
  status: string;
  active_sessions: number;
  active_connections: number;
}

export interface RelaySignedStatus {
  chain_id: string;
  timestamp_unix_millis: number;
  status: RelayLiveStatus;
  pubkey: string;
  signature: string;
}

export type ProbeState = 'idle' | 'probing' | 'ok' | 'unreachable' | 'blocked' | 'invalid';

export interface ProbeResult {
  state: ProbeState;
  latencyMs?: number;
  live?: RelayLiveStatus;
  // Only set when the relay answered /status/signed.
  signed?: boolean;
  pubkeyMatches?: boolean;
  signatureValid?: boolean;
  signatureNote?: string;
  clockSkewMs?: number;
  error?: string;
}

const PROBE_TIMEOUT_MS = 4000;
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

// The registry stores a WebSocket endpoint (ws://host:9080/relay). Its status
// surface is the same host over plain HTTP, so map the scheme and drop the path.
export function relayStatusBase(endpoint: string): string | null {
  const scheme: Record<string, string> = {
    'ws:': 'http:',
    'wss:': 'https:',
    'http:': 'http:',
    'https:': 'https:',
  };
  try {
    const url = new URL(endpoint.trim());
    const mapped = scheme[url.protocol];
    if (!mapped) return null;
    url.protocol = mapped;
    url.pathname = '';
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/+$/, '');
  } catch {
    return null;
  }
}

// A page served over https cannot reach a plaintext relay: the browser blocks
// the request before it leaves, which would otherwise read as "relay is down".
function blockedByMixedContent(statusBase: string): boolean {
  return (
    typeof window !== 'undefined' &&
    window.location.protocol === 'https:' &&
    statusBase.startsWith('http:')
  );
}

async function getJSON(url: string): Promise<{ ok: boolean; httpStatus: number; body?: any }> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), PROBE_TIMEOUT_MS);
  try {
    const resp = await fetch(url, { signal: abort.signal, mode: 'cors' });
    if (!resp.ok) return { ok: false, httpStatus: resp.status };
    return { ok: true, httpStatus: resp.status, body: await resp.json() };
  } finally {
    clearTimeout(timer);
  }
}

// Rebuilds the bytes the relay signed, per SignedStatusSignBytes in
// x/pokerchain/relay/server.go. Any drift here shows up as an invalid signature.
function signedStatusSignBytes(signed: RelaySignedStatus): Uint8Array {
  const text =
    'bitpoker-relay-status-v1\n' +
    signed.chain_id +
    '\n' +
    signed.status.relay_id +
    '\n' +
    signed.status.status +
    '\n' +
    signed.status.active_sessions +
    '\n' +
    signed.status.active_connections +
    '\n' +
    signed.timestamp_unix_millis;
  return new TextEncoder().encode(text);
}

async function verifySignedStatus(
  signed: RelaySignedStatus,
  result: ProbeResult,
  onChainPubkey: string
): Promise<void> {
  const reported = (signed.pubkey || '').toLowerCase();
  result.pubkeyMatches = reported.length > 0 && reported === (onChainPubkey || '').trim().toLowerCase();

  let pubkey: Uint8Array;
  let signature: Uint8Array;
  try {
    pubkey = fromHex(reported);
    signature = fromHex(signed.signature || '');
  } catch {
    result.signatureValid = false;
    result.signatureNote = 'pubkey or signature is not valid hex';
    return;
  }

  // ADR-006 unified the relay node key on ed25519; a relay still running the
  // legacy secp256k1 status key can be reported but not verified here.
  if (pubkey.length !== ED25519_PUBKEY_BYTES) {
    result.signatureNote = `not an ed25519 pubkey (${pubkey.length} bytes)`;
    return;
  }

  try {
    result.signatureValid = await Ed25519.verifySignature(signature, signedStatusSignBytes(signed), pubkey);
  } catch (e: any) {
    result.signatureValid = false;
    result.signatureNote = e?.message || 'signature verification failed';
  }
}

export async function probeRelay(relay: Relay): Promise<ProbeResult> {
  const base = relayStatusBase(relay.endpoint);
  if (!base) {
    return { state: 'invalid', error: 'endpoint is not a ws/wss/http/https URL' };
  }
  if (blockedByMixedContent(base)) {
    return {
      state: 'blocked',
      error: 'the browser blocks a plaintext relay from an https page (mixed content)',
    };
  }

  const started = performance.now();
  try {
    const signedResp = await getJSON(`${base}/status/signed`);
    if (signedResp.ok) {
      const signed = signedResp.body as RelaySignedStatus;
      const result: ProbeResult = {
        state: 'ok',
        latencyMs: Math.round(performance.now() - started),
        live: signed.status,
        signed: true,
        clockSkewMs: Date.now() - Number(signed.timestamp_unix_millis),
      };
      await verifySignedStatus(signed, result, relay.pubkey);
      return result;
    }

    // 503 means the relay serves status but has no signing key configured.
    const plainResp = await getJSON(`${base}/status`);
    if (plainResp.ok) {
      return {
        state: 'ok',
        latencyMs: Math.round(performance.now() - started),
        live: plainResp.body as RelayLiveStatus,
        signed: false,
        signatureNote: 'relay does not serve /status/signed',
      };
    }
    return { state: 'unreachable', error: `HTTP ${plainResp.httpStatus}` };
  } catch (e: any) {
    const reason = e?.name === 'AbortError' ? `timeout after ${PROBE_TIMEOUT_MS}ms` : e?.message || 'request failed';
    return { state: 'unreachable', error: reason };
  }
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

// The disagreements worth surfacing: the registry says one thing, the relay
// itself says another. This is the raw material of a relay challenge.
export function probeDisagreement(relay: Relay, probe?: ProbeResult): string | null {
  if (!probe || probe.state === 'idle' || probe.state === 'probing') return null;
  const onChain = shortRelayStatus(relay.status);

  if (probe.state === 'unreachable' && onChain === 'ACTIVE') {
    return 'registered ACTIVE but does not answer';
  }
  if (probe.state !== 'ok' || !probe.live) return null;

  const live = (probe.live.status || '').toUpperCase();
  if (onChain === 'ACTIVE' && live !== 'ACTIVE') {
    return `registered ACTIVE but reports ${live}`;
  }
  if (probe.signed && probe.pubkeyMatches === false) {
    return 'signs status with a key that is not the registered pubkey';
  }
  if (probe.signed && probe.signatureValid === false) {
    return 'signed status fails verification';
  }
  if (probe.live.relay_id && probe.live.relay_id !== relay.relay_id) {
    return `answers as ${probe.live.relay_id}`;
  }
  return null;
}
