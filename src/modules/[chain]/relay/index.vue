<script lang="ts" setup>
import { computed, onMounted, ref } from 'vue';
import { useBaseStore, useBlockchain, useFormatter } from '@/stores';
import {
  coveredSessions,
  fetchPokerchainParams,
  fetchRelays,
  quoteFraction,
  relayIsFree,
  relayStatusColor,
  shortRelayStatus,
  type PokerchainParams,
  type Relay,
} from './relay';

const props = defineProps(['chain']);

const chainStore = useBlockchain();
const baseStore = useBaseStore();
const format = useFormatter();

const relays = ref([] as Relay[]);
const params = ref(null as PokerchainParams | null);
const error = ref('');
const loading = ref(true);

const bondDenom = computed(() => chainStore.current?.assets?.[0]?.base || 'uchip');
const latestHeight = computed(() => Number(baseStore.latest?.block?.header?.height || 0));

const stats = computed(() => {
  const count = (...names: string[]) =>
    relays.value.filter((r) => names.includes(shortRelayStatus(r.status))).length;
  const bond = relays.value.reduce((sum, r) => sum + Number(r.bond_amount || 0), 0);
  const serving = relays.value.reduce((sum, r) => sum + Number(r.active_session_count || 0), 0);
  return {
    total: relays.value.length,
    active: count('ACTIVE'),
    degraded: count('DRAINING', 'OFFLINE', 'STALE', 'UNBONDING'),
    serving,
    bond: format.formatToken({ amount: String(bond), denom: bondDenom.value }),
  };
});

async function load() {
  loading.value = true;
  error.value = '';
  try {
    relays.value = await fetchRelays(chainStore.endpoint.address);
    // Params decide how a relay reads: what its bond covers, and where its
    // quote sits against the ceilings. A params failure must not hide the
    // registry itself.
    try {
      params.value = await fetchPokerchainParams(chainStore.endpoint.address);
    } catch {
      params.value = null;
    }
  } catch (e: any) {
    error.value = e?.message || 'failed to load relays';
  } finally {
    loading.value = false;
  }
}

function covers(relay: Relay): string {
  const n = coveredSessions(relay, params.value);
  return n === null ? '∞' : String(n);
}

function priceLabel(relay: Relay): string {
  if (relayIsFree(relay)) return 'free';
  const parts = [];
  if (Number(relay.fee_flat || 0)) parts.push(format.formatToken({ amount: relay.fee_flat, denom: bondDenom.value }));
  if (Number(relay.fee_bps || 0)) parts.push(`${Number(relay.fee_bps) / 100}% of pot`);
  return parts.join(' + ');
}

// Cheap relays win more assignments, so colour the quote by where it sits
// between free and the ceiling rather than by its absolute size.
function priceClass(relay: Relay): string {
  const fraction = quoteFraction(relay, params.value);
  if (fraction === null) return '';
  if (fraction === 0) return 'text-success';
  return fraction >= 0.75 ? 'text-warning' : '';
}

function heartbeatAge(relay: Relay): string {
  const height = Number(relay.last_heartbeat_height || 0);
  if (!height) return 'never';
  if (!latestHeight.value || latestHeight.value < height) return `${height}`;
  return `${height} (-${latestHeight.value - height})`;
}

onMounted(load);
</script>

<template>
  <div>
    <div class="grid grid-cols-2 md:!grid-cols-5 gap-3 mb-4">
      <div class="bg-base-100 rounded shadow p-4">
        <div class="text-xs text-gray-500 uppercase">Registered</div>
        <div class="text-2xl font-semibold">{{ stats.total }}</div>
      </div>
      <div class="bg-base-100 rounded shadow p-4">
        <div class="text-xs text-gray-500 uppercase">Active</div>
        <div class="text-2xl font-semibold text-success">{{ stats.active }}</div>
      </div>
      <div class="bg-base-100 rounded shadow p-4">
        <div class="text-xs text-gray-500 uppercase">Draining / Offline</div>
        <div class="text-2xl font-semibold text-warning">{{ stats.degraded }}</div>
      </div>
      <div class="bg-base-100 rounded shadow p-4">
        <div class="text-xs text-gray-500 uppercase">Sessions in flight</div>
        <div class="text-2xl font-semibold">{{ stats.serving }}</div>
      </div>
      <div class="bg-base-100 rounded shadow p-4">
        <div class="text-xs text-gray-500 uppercase">Total Bond</div>
        <div class="text-2xl font-semibold">{{ stats.bond }}</div>
      </div>
    </div>

    <div class="bg-base-100 rounded shadow">
      <div class="flex items-center justify-between px-4 pt-4">
        <h2 class="text-lg font-semibold">Relays</h2>
        <button class="btn btn-sm" :disabled="loading" @click="load">Reload</button>
      </div>

      <div v-if="error" class="alert alert-error m-4">{{ error }}</div>

      <div class="overflow-x-auto p-4">
        <table class="table table-compact w-full">
          <thead>
            <tr>
              <th>Relay ID</th>
              <th>Registered</th>
              <th class="text-right">Bond</th>
              <th class="text-right">Serving</th>
              <th>Price</th>
              <th class="text-right">Missed windows</th>
              <th class="text-right">Slashes</th>
              <th class="text-right">Last heartbeat</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="loading">
              <td colspan="8" class="text-center text-gray-400">Loading…</td>
            </tr>
            <tr v-else-if="!relays.length">
              <td colspan="8" class="text-center text-gray-400">No relay is registered on this chain.</td>
            </tr>
            <tr v-for="relay in relays" :key="relay.relay_id">
              <td>
                <RouterLink class="text-primary truncate block max-w-[16rem]" :to="`/${chain}/relay/${relay.relay_id}`">
                  {{ relay.relay_id }}
                </RouterLink>
                <div class="text-xs text-gray-500 truncate max-w-[16rem]">{{ relay.owner }}</div>
              </td>
              <td>
                <span class="badge badge-sm border-none" :class="relayStatusColor(relay.status)">
                  {{ shortRelayStatus(relay.status) }}
                </span>
              </td>
              <td class="text-right whitespace-nowrap">
                {{ format.formatToken({ amount: relay.bond_amount, denom: bondDenom }) }}
                <div v-if="Number(relay.unbonding_amount)" class="text-xs text-warning">
                  +{{ format.formatToken({ amount: relay.unbonding_amount, denom: bondDenom }) }} unbonding
                </div>
              </td>
              <td class="text-right whitespace-nowrap">
                {{ relay.active_session_count }} / {{ covers(relay) }}
              </td>
              <td class="whitespace-nowrap" :class="priceClass(relay)">{{ priceLabel(relay) }}</td>
              <td
                class="text-right"
                :class="Number(relay.assignment_miss_count) ? 'text-warning font-semibold' : ''"
              >
                {{ relay.assignment_miss_count }}
              </td>
              <td class="text-right" :class="Number(relay.slash_count) ? 'text-error font-semibold' : ''">
                {{ relay.slash_count }}
              </td>
              <td class="text-right whitespace-nowrap">{{ heartbeatAge(relay) }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="px-4 pb-4 text-xs text-gray-500 space-y-1">
        <p>
          Relays no longer publish an endpoint (ADR-007): the chain records who a relay is, not where it is, and the
          address reaches only the two players of a session, encrypted. There is therefore nothing here to probe — and
          nothing for anyone else to scan.
        </p>
        <p>
          <strong>Missed windows</strong> is what replaced probing, and it is stronger evidence: it counts the times a
          relay was assigned a session and let its claim window expire, so it measures work refused rather than a
          synthetic ping. Both counters decay back toward zero over
          <code>relay_slash_decay_blocks</code>{{ params?.relay_slash_decay_blocks ? ` (${params.relay_slash_decay_blocks} blocks)` : '' }}.
        </p>
        <p>
          <strong>Serving</strong> is sessions in flight against what the bond covers, and <strong>Price</strong> is the
          relay's own quote — capped by governance, and cheaper quotes win more assignments.
        </p>
      </div>
    </div>
  </div>
</template>

<route>
  {
    meta: {
      i18n: 'relay',
      order: 6
    }
  }
</route>
