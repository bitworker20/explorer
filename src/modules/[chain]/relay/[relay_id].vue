<script lang="ts" setup>
import { computed, onMounted, ref } from 'vue';
import { useBaseStore, useBlockchain, useFormatter } from '@/stores';
import {
  derivedRelayId,
  fetchRelay,
  fetchRelayChallenges,
  probeRelay,
  probeDisagreement,
  relayStatusBase,
  relayStatusColor,
  shortChallengeStatus,
  shortRelayStatus,
  type ProbeResult,
  type Relay,
  type RelayChallenge,
} from './relay';

const props = defineProps(['relay_id', 'chain']);

const chainStore = useBlockchain();
const baseStore = useBaseStore();
const format = useFormatter();

const relay = ref(undefined as Relay | undefined);
const challenges = ref([] as RelayChallenge[]);
const probe = ref(undefined as ProbeResult | undefined);
const error = ref('');

const bondDenom = computed(() => chainStore.current?.assets?.[0]?.base || 'uchip');
const latestHeight = computed(() => Number(baseStore.latest?.block?.header?.height || 0));
const statusBase = computed(() => (relay.value ? relayStatusBase(relay.value.endpoint) : null));
const selfCertifying = computed(() => {
  if (!relay.value) return undefined;
  const derived = derivedRelayId(relay.value.pubkey);
  return derived ? derived === relay.value.relay_id : undefined;
});
const disagreement = computed(() => (relay.value ? probeDisagreement(relay.value, probe.value) : null));

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
  } catch (e: any) {
    error.value = e?.message || 'failed to load relay';
  }
}

async function runProbe() {
  if (!relay.value) return;
  probe.value = { state: 'probing' };
  probe.value = await probeRelay(relay.value);
}

onMounted(async () => {
  await load();
  if (relay.value) await runProbe();
});
</script>

<template>
  <div>
    <div v-if="error" class="alert alert-error mb-4">{{ error }}</div>

    <div v-if="relay">
      <div class="flex items-center gap-3 mb-4">
        <h1 class="text-xl font-semibold truncate">{{ relay.relay_id }}</h1>
        <span class="badge border-none" :class="relayStatusColor(relay.status)">{{ shortRelayStatus(relay.status) }}</span>
      </div>

      <div v-if="disagreement" class="alert alert-warning mb-4">
        <span>⚠ Registry and relay disagree: {{ disagreement }}</span>
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
                <td class="text-gray-500">Endpoint</td>
                <td class="text-right break-all">{{ relay.endpoint }}</td>
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
                <td class="text-gray-500">Bond</td>
                <td class="text-right">{{ format.formatToken({ amount: relay.bond_amount, denom: bondDenom }) }}</td>
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
          <div class="flex items-center justify-between mb-3">
            <h2 class="text-lg font-semibold">Live status</h2>
            <button class="btn btn-sm btn-primary" :disabled="probe?.state === 'probing'" @click="runProbe">
              <span v-if="probe?.state === 'probing'" class="loading loading-spinner loading-xs mr-1"></span>
              Probe
            </button>
          </div>

          <div v-if="!probe || probe.state === 'probing'" class="text-gray-400">Probing {{ statusBase }}/status/signed…</div>

          <div v-else-if="probe.state !== 'ok'" class="alert alert-error">
            <span>{{ probe.state }}: {{ probe.error }}</span>
          </div>

          <table v-else class="table table-compact w-full">
            <tbody>
              <tr>
                <td class="text-gray-500">Reachable</td>
                <td class="text-right text-success">✓ {{ probe.latencyMs }} ms</td>
              </tr>
              <tr>
                <td class="text-gray-500">Reports status</td>
                <td class="text-right">{{ probe.live?.status }}</td>
              </tr>
              <tr>
                <td class="text-gray-500">Reports relay id</td>
                <td class="text-right break-all">{{ probe.live?.relay_id }}</td>
              </tr>
              <tr>
                <td class="text-gray-500">Active sessions</td>
                <td class="text-right">{{ probe.live?.active_sessions }}</td>
              </tr>
              <tr>
                <td class="text-gray-500">Active connections</td>
                <td class="text-right">{{ probe.live?.active_connections }}</td>
              </tr>
              <tr v-if="probe.signed">
                <td class="text-gray-500">Signing key</td>
                <td class="text-right">
                  <span v-if="probe.pubkeyMatches" class="text-success">✓ registered pubkey</span>
                  <span v-else class="text-error">✗ differs from registered pubkey</span>
                </td>
              </tr>
              <tr v-if="probe.signed">
                <td class="text-gray-500">Status signature</td>
                <td class="text-right">
                  <span v-if="probe.signatureValid === true" class="text-success">✓ verified</span>
                  <span v-else-if="probe.signatureValid === false" class="text-error">✗ invalid</span>
                  <span v-else class="text-gray-400">not verified</span>
                  <span v-if="probe.signatureNote" class="text-xs text-gray-500 block">{{ probe.signatureNote }}</span>
                </td>
              </tr>
              <tr v-else>
                <td class="text-gray-500">Status signature</td>
                <td class="text-right text-gray-400">{{ probe.signatureNote || 'unsigned status' }}</td>
              </tr>
              <tr v-if="probe.clockSkewMs !== undefined">
                <td class="text-gray-500">Clock skew</td>
                <td class="text-right">{{ probe.clockSkewMs }} ms</td>
              </tr>
            </tbody>
          </table>
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
