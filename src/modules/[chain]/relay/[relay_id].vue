<script lang="ts" setup>
import { computed, onMounted, ref } from 'vue';
import { useBaseStore, useBlockchain, useFormatter } from '@/stores';
import {
  coveredSessions,
  derivedRelayId,
  fetchPokerchainParams,
  fetchRelay,
  fetchRelayChallenges,
  relayIsFree,
  relayStatusColor,
  shortChallengeStatus,
  shortRelayStatus,
  type PokerchainParams,
  type Relay,
  type RelayChallenge,
} from './relay';

const props = defineProps(['relay_id', 'chain']);

const chainStore = useBlockchain();
const baseStore = useBaseStore();
const format = useFormatter();

const relay = ref(undefined as Relay | undefined);
const challenges = ref([] as RelayChallenge[]);
const params = ref(null as PokerchainParams | null);
const error = ref('');

const bondDenom = computed(() => chainStore.current?.assets?.[0]?.base || 'uchip');
const latestHeight = computed(() => Number(baseStore.latest?.block?.header?.height || 0));
const covers = computed(() => (relay.value ? coveredSessions(relay.value, params.value) : null));
const selfCertifying = computed(() => {
  if (!relay.value) return undefined;
  const derived = derivedRelayId(relay.value.pubkey);
  return derived ? derived === relay.value.relay_id : undefined;
});
// The original banner compared the registry against a live probe. That
// comparison is gone with the endpoint, but the on-chain evidence still shows
// the same class of contradiction: a relay that claims to be serving while
// dropping the sessions it is handed, or one whose bond is fully committed.
const serviceWarning = computed(() => {
  const r = relay.value;
  if (!r) return null;
  if (shortRelayStatus(r.status) === 'ACTIVE' && Number(r.assignment_miss_count || 0) > 0) {
    return `registered ACTIVE but has let ${r.assignment_miss_count} assigned claim window(s) lapse` +
      (Number(r.last_miss_height) ? ` (last at block ${r.last_miss_height})` : '');
  }
  if (covers.value !== null && Number(r.active_session_count || 0) >= covers.value) {
    return 'bond is fully committed — this relay will not be assigned further sessions until one settles';
  }
  return null;
});

const price = computed(() => {
  if (!relay.value) return '';
  if (relayIsFree(relay.value)) return 'free';
  const parts = [];
  if (Number(relay.value.fee_flat || 0)) {
    parts.push(format.formatToken({ amount: relay.value.fee_flat, denom: bondDenom.value }));
  }
  if (Number(relay.value.fee_bps || 0)) parts.push(`${Number(relay.value.fee_bps) / 100}% of pot`);
  return parts.join(' + ');
});

function height(value?: string): string {
  const h = Number(value || 0);
  if (!h) return '—';
  if (!latestHeight.value || latestHeight.value < h) return String(h);
  return `${h} (-${latestHeight.value - h})`;
}

async function load() {
  error.value = '';
  try {
    relay.value = await fetchRelay(chainStore.endpoint.address, props.relay_id);
    challenges.value = await fetchRelayChallenges(chainStore.endpoint.address, props.relay_id);
    try {
      params.value = await fetchPokerchainParams(chainStore.endpoint.address);
    } catch {
      params.value = null;
    }
  } catch (e: any) {
    error.value = e?.message || 'failed to load relay';
  }
}

onMounted(load);
</script>

<template>
  <div>
    <div v-if="error" class="alert alert-error mb-4">{{ error }}</div>

    <div v-if="relay">
      <div class="flex items-center gap-3 mb-4">
        <h1 class="text-xl font-semibold truncate">{{ relay.relay_id }}</h1>
        <span class="badge border-none" :class="relayStatusColor(relay.status)">{{ shortRelayStatus(relay.status) }}</span>
      </div>

      <div v-if="serviceWarning" class="alert alert-warning mb-4">
        <span>⚠ {{ serviceWarning }}</span>
      </div>

      <div class="grid md:!grid-cols-2 gap-4">
        <div class="bg-base-100 rounded shadow p-4">
          <h2 class="text-lg font-semibold mb-3">On-chain registration</h2>
          <table class="table table-compact w-full">
            <tbody>
              <tr>
                <td class="text-gray-500">Owner</td>
                <td class="text-right">
                  <RouterLink class="text-primary break-all" :to="`/${chain}/account/${relay.owner}`">
                    {{ relay.owner }}
                  </RouterLink>
                </td>
              </tr>
              <tr>
                <td class="text-gray-500">Pubkey (ed25519)</td>
                <td class="text-right break-all text-xs">{{ relay.pubkey }}</td>
              </tr>
              <tr>
                <td class="text-gray-500">Relay ID derived from pubkey</td>
                <td class="text-right">
                  <span v-if="selfCertifying === true" class="text-success">✓ matches</span>
                  <span v-else-if="selfCertifying === false" class="text-error">✗ does not match</span>
                  <span v-else class="text-gray-400">not an ed25519 pubkey</span>
                </td>
              </tr>
              <tr>
                <td class="text-gray-500">Capacity</td>
                <td class="text-right">{{ relay.capacity }}</td>
              </tr>
              <tr>
                <td class="text-gray-500">Price</td>
                <td class="text-right">{{ price }}</td>
              </tr>
              <tr>
                <td class="text-gray-500">Bond</td>
                <td class="text-right">
                  {{ format.formatToken({ amount: relay.bond_amount, denom: bondDenom }) }}
                  <span v-if="covers !== null" class="text-xs text-gray-500 block">
                    covers {{ covers }} concurrent session(s)
                  </span>
                </td>
              </tr>
              <tr v-if="Number(relay.unbonding_amount)">
                <td class="text-gray-500">Unbonding</td>
                <td class="text-right text-warning">
                  {{ format.formatToken({ amount: relay.unbonding_amount, denom: bondDenom }) }}
                  <span class="text-xs text-gray-500 block">still slashable until withdrawn</span>
                </td>
              </tr>
              <tr>
                <td class="text-gray-500">Bonded height</td>
                <td class="text-right">{{ height(relay.bonded_height) }}</td>
              </tr>
              <tr>
                <td class="text-gray-500">Unbonding ends</td>
                <td class="text-right">{{ height(relay.unbonding_end_height) }}</td>
              </tr>
              <tr>
                <td class="text-gray-500">Last heartbeat</td>
                <td class="text-right">{{ height(relay.last_heartbeat_height) }}</td>
              </tr>
              <tr>
                <td class="text-gray-500">Slashes</td>
                <td class="text-right" :class="Number(relay.slash_count) ? 'text-error font-semibold' : ''">
                  {{ relay.slash_count }}
                  <span v-if="Number(relay.last_slashed_height)" class="text-gray-500 text-xs">
                    (last at {{ relay.last_slashed_height }})
                  </span>
                </td>
              </tr>
              <tr v-if="relay.metadata">
                <td class="text-gray-500">Metadata</td>
                <td class="text-right break-all">{{ relay.metadata }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="bg-base-100 rounded shadow p-4">
          <h2 class="text-lg font-semibold mb-3">Service and reputation</h2>

          <table class="table table-compact w-full">
            <tbody>
              <tr>
                <td class="text-gray-500">Sessions in flight</td>
                <td class="text-right">
                  {{ relay.active_session_count }}
                  <span v-if="covers !== null" class="text-gray-500">/ {{ covers }} covered by the bond</span>
                </td>
              </tr>
              <tr>
                <td class="text-gray-500">Missed claim windows</td>
                <td class="text-right" :class="Number(relay.assignment_miss_count) ? 'text-warning font-semibold' : ''">
                  {{ relay.assignment_miss_count }}
                  <span v-if="Number(relay.last_miss_height)" class="text-gray-500 text-xs">
                    (last at {{ relay.last_miss_height }})
                  </span>
                </td>
              </tr>
              <tr>
                <td class="text-gray-500">Advertised capacity</td>
                <td class="text-right">{{ relay.capacity }}</td>
              </tr>
              <tr v-if="params?.relay_slash_decay_blocks && params.relay_slash_decay_blocks !== '0'">
                <td class="text-gray-500">Penalty decay</td>
                <td class="text-right">one unit per {{ params.relay_slash_decay_blocks }} blocks</td>
              </tr>
            </tbody>
          </table>

          <div class="text-xs text-gray-500 mt-3 space-y-1">
            <p>
              This relay's address is not on chain and cannot be probed from here (ADR-007). It reaches the two players
              of each session it answers, encrypted to each of them, and nobody else.
            </p>
            <p>
              A <strong>missed claim window</strong> is the on-chain replacement for a liveness probe, and a stricter
              one: it records that this relay was assigned a session and let its window lapse, so a backup had to step
              in. It measures work refused, not a ping answered — and unlike a probe it cannot be faked by a relay that
              answers status checks while dropping real sessions.
            </p>
          </div>
        </div>
      </div>

      <div class="bg-base-100 rounded shadow p-4 mt-4">
        <h2 class="text-lg font-semibold mb-3">Challenges</h2>
        <div class="overflow-x-auto">
          <table class="table table-compact w-full">
            <thead>
              <tr>
                <th>ID</th>
                <th>Challenger</th>
                <th>Evidence</th>
                <th>Status</th>
                <th class="text-right">Deposit</th>
                <th class="text-right">Slashed</th>
                <th class="text-right">Bounty</th>
                <th class="text-right">Deadline</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="!challenges.length">
                <td colspan="8" class="text-center text-gray-400">No challenge has been filed against this relay.</td>
              </tr>
              <tr v-for="c in challenges" :key="c.challenge_id">
                <td>{{ c.challenge_id }}</td>
                <td class="truncate max-w-[12rem]">
                  <RouterLink class="text-primary" :to="`/${chain}/account/${c.challenger}`">{{ c.challenger }}</RouterLink>
                </td>
                <td class="truncate max-w-[16rem]">{{ c.evidence }}</td>
                <td>{{ shortChallengeStatus(c.status) }}</td>
                <td class="text-right">{{ format.formatToken({ amount: c.deposit, denom: bondDenom }) }}</td>
                <td class="text-right">{{ format.formatToken({ amount: c.slash_amount, denom: bondDenom }) }}</td>
                <td class="text-right">{{ format.formatToken({ amount: c.bounty_amount, denom: bondDenom }) }}</td>
                <td class="text-right">{{ height(c.response_deadline_height) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
</template>
