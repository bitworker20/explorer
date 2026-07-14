<script lang="ts" setup>
import { computed, onMounted, ref } from 'vue';
import { useBaseStore, useBlockchain, useFormatter } from '@/stores';
import {
  fetchRelays,
  probeRelay,
  probeDisagreement,
  relayStatusColor,
  shortRelayStatus,
  type ProbeResult,
  type Relay,
} from './relay';

const props = defineProps(['chain']);

const chainStore = useBlockchain();
const baseStore = useBaseStore();
const format = useFormatter();

const relays = ref([] as Relay[]);
const probes = ref({} as Record<string, ProbeResult>);
const error = ref('');
const loading = ref(true);
const probingAll = ref(false);

const bondDenom = computed(() => chainStore.current?.assets?.[0]?.base || 'uchip');
const latestHeight = computed(() => Number(baseStore.latest?.block?.header?.height || 0));

const stats = computed(() => {
  const count = (...names: string[]) =>
    relays.value.filter((r) => names.includes(shortRelayStatus(r.status))).length;
  const bond = relays.value.reduce((sum, r) => sum + Number(r.bond_amount || 0), 0);
  return {
    total: relays.value.length,
    active: count('ACTIVE'),
    degraded: count('DRAINING', 'OFFLINE', 'STALE', 'UNBONDING'),
    jailed: count('JAILED'),
    bond: format.formatToken({ amount: String(bond), denom: bondDenom.value }),
  };
});

async function load() {
  loading.value = true;
  error.value = '';
  try {
    relays.value = await fetchRelays(chainStore.endpoint.address);
  } catch (e: any) {
    error.value = e?.message || 'failed to load relays';
  } finally {
    loading.value = false;
  }
}

async function probe(relay: Relay) {
  probes.value = { ...probes.value, [relay.relay_id]: { state: 'probing' } };
  const result = await probeRelay(relay);
  probes.value = { ...probes.value, [relay.relay_id]: result };
}

async function probeAll() {
  probingAll.value = true;
  try {
    await Promise.all(relays.value.map((r) => probe(r)));
  } finally {
    probingAll.value = false;
  }
}

function heartbeatAge(relay: Relay): string {
  const height = Number(relay.last_heartbeat_height || 0);
  if (!height) return 'never';
  if (!latestHeight.value || latestHeight.value < height) return `${height}`;
  return `${height} (-${latestHeight.value - height})`;
}

onMounted(async () => {
  await load();
  if (relays.value.length) await probeAll();
});
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
        <div class="text-xs text-gray-500 uppercase">Jailed</div>
        <div class="text-2xl font-semibold" :class="stats.jailed ? 'text-error' : ''">{{ stats.jailed }}</div>
      </div>
      <div class="bg-base-100 rounded shadow p-4">
        <div class="text-xs text-gray-500 uppercase">Total Bond</div>
        <div class="text-2xl font-semibold">{{ stats.bond }}</div>
      </div>
    </div>

    <div class="bg-base-100 rounded shadow">
      <div class="flex items-center justify-between px-4 pt-4">
        <h2 class="text-lg font-semibold">Relays</h2>
        <div class="flex gap-2">
          <button class="btn btn-sm" :disabled="loading" @click="load">Reload</button>
          <button class="btn btn-sm btn-primary" :disabled="probingAll || !relays.length" @click="probeAll">
            <span v-if="probingAll" class="loading loading-spinner loading-xs mr-1"></span>
            Probe all
          </button>
        </div>
      </div>

      <div v-if="error" class="alert alert-error m-4">{{ error }}</div>

      <div class="overflow-x-auto p-4">
        <table class="table table-compact w-full">
          <thead>
            <tr>
              <th>Relay ID</th>
              <th>Endpoint</th>
              <th>Registered</th>
              <th class="text-right">Capacity</th>
              <th class="text-right">Bond</th>
              <th class="text-right">Last heartbeat</th>
              <th class="text-right">Slashes</th>
              <th>Live probe</th>
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
              <td class="truncate max-w-[18rem]">{{ relay.endpoint }}</td>
              <td>
                <span class="badge badge-sm border-none" :class="relayStatusColor(relay.status)">
                  {{ shortRelayStatus(relay.status) }}
                </span>
              </td>
              <td class="text-right">{{ relay.capacity }}</td>
              <td class="text-right">{{ format.formatToken({ amount: relay.bond_amount, denom: bondDenom }) }}</td>
              <td class="text-right whitespace-nowrap">{{ heartbeatAge(relay) }}</td>
              <td class="text-right" :class="Number(relay.slash_count) ? 'text-error font-semibold' : ''">
                {{ relay.slash_count }}
              </td>
              <td>
                <div class="flex items-center gap-2">
                  <span
                    v-if="!probes[relay.relay_id] || probes[relay.relay_id].state === 'idle'"
                    class="text-gray-400"
                    >—</span
                  >
                  <span v-else-if="probes[relay.relay_id].state === 'probing'" class="loading loading-spinner loading-xs"></span>
                  <span v-else-if="probes[relay.relay_id].state === 'ok'" class="text-success whitespace-nowrap">
                    ✓ {{ probes[relay.relay_id].latencyMs }}ms
                    <span class="text-gray-500">
                      · {{ probes[relay.relay_id].live?.active_sessions }} sessions ·
                      {{ (probes[relay.relay_id].live?.status || '').toLowerCase() }}
                    </span>
                  </span>
                  <span
                    v-else
                    class="text-error whitespace-nowrap tooltip tooltip-left"
                    :data-tip="probes[relay.relay_id].error"
                  >
                    ✗ {{ probes[relay.relay_id].state }}
                  </span>
                  <button class="btn btn-xs" @click="probe(relay)">Probe</button>
                </div>
                <div v-if="probeDisagreement(relay, probes[relay.relay_id])" class="text-xs text-warning mt-1">
                  ⚠ {{ probeDisagreement(relay, probes[relay.relay_id]) }}
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="px-4 pb-4 text-xs text-gray-500">
        Probing runs in your browser against each relay's <code>/status/signed</code> endpoint; nothing is written on
        chain. Two things read as unreachable without the relay being down: a plaintext <code>ws://</code> relay probed
        from an https page (mixed content), and a relay running a daemon build older than cross-origin status support.
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
