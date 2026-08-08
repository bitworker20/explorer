<script lang="ts" setup>
import { computed, onMounted, ref } from 'vue';
import { useBlockchain, useFormatter } from '@/stores';
import {
  fetchSessions,
  gameTypeName,
  sessionStatusColor,
  shortGameType,
  shortSessionStatus,
  type GameSession,
} from './sessions';

const props = defineProps(['chain']);

const chainStore = useBlockchain();
const format = useFormatter();

const sessions = ref([] as GameSession[]);
const error = ref('');
const loading = ref(true);

// Client-side filters. The chain filters player/status server-side, but it does
// not paginate (it returns every matching session), so paging happens here.
const playerFilter = ref('');
const statusFilter = ref('');
const page = ref(0);
const pageSize = 20;

const stakeDenom = computed(() => chainStore.current?.assets?.[0]?.base || 'uchip');

const statusOptions = ['ACTIVE', 'RESULT_PENDING', 'SETTLED', 'DISPUTED', 'CANCELLED'];

// A settled session still owing its relay the raked reward. The relay claims it
// with its own tx after settlement, so a lasting backlog here means claims are
// failing (the PC-E2E-013 failure mode) rather than merely being in flight.
function rewardPending(s: GameSession): boolean {
  return (
    shortSessionStatus(s.status) === 'SETTLED' &&
    Number(s.relay_reward) > 0 &&
    !s.relay_reward_claimed
  );
}

const stats = computed(() => {
  const count = (name: string) =>
    sessions.value.filter((s) => shortSessionStatus(s.status) === name).length;
  return {
    total: sessions.value.length,
    active: count('ACTIVE'),
    settling: count('RESULT_PENDING'),
    settled: count('SETTLED'),
    disputed: count('DISPUTED'),
    rewardPending: sessions.value.filter(rewardPending).length,
  };
});

// Newest first — sessions are keyed by an ascending uint64 id.
const sorted = computed(() =>
  [...sessions.value].sort((a, b) => Number(b.session_id) - Number(a.session_id))
);

const pageCount = computed(() => Math.max(1, Math.ceil(sorted.value.length / pageSize)));
const pageRows = computed(() => sorted.value.slice(page.value * pageSize, page.value * pageSize + pageSize));

async function load() {
  loading.value = true;
  error.value = '';
  page.value = 0;
  try {
    sessions.value = await fetchSessions(chainStore.endpoint.address, {
      player: playerFilter.value.trim() || undefined,
      status: statusFilter.value || undefined,
    });
  } catch (e: any) {
    error.value = e?.message || 'failed to load sessions';
  } finally {
    loading.value = false;
  }
}

function potOf(s: GameSession): string {
  // Two seats each stake `stake`; the pot is what's on the felt for the session.
  return format.formatToken({ amount: String(Number(s.stake) * 2), denom: stakeDenom.value });
}

onMounted(load);
</script>

<template>
  <div>
    <div class="grid grid-cols-2 md:!grid-cols-6 gap-3 mb-4">
      <div class="bg-base-100 rounded shadow p-4">
        <div class="text-xs text-gray-500 uppercase">Total</div>
        <div class="text-2xl font-semibold">{{ stats.total }}</div>
      </div>
      <div class="bg-base-100 rounded shadow p-4">
        <div class="text-xs text-gray-500 uppercase">Active</div>
        <div class="text-2xl font-semibold text-info">{{ stats.active }}</div>
      </div>
      <div class="bg-base-100 rounded shadow p-4">
        <div class="text-xs text-gray-500 uppercase">Settling</div>
        <div class="text-2xl font-semibold text-warning">{{ stats.settling }}</div>
      </div>
      <div class="bg-base-100 rounded shadow p-4">
        <div class="text-xs text-gray-500 uppercase">Settled</div>
        <div class="text-2xl font-semibold text-success">{{ stats.settled }}</div>
      </div>
      <div class="bg-base-100 rounded shadow p-4">
        <div class="text-xs text-gray-500 uppercase">Disputed</div>
        <div class="text-2xl font-semibold" :class="stats.disputed ? 'text-error' : ''">{{ stats.disputed }}</div>
      </div>
      <div class="bg-base-100 rounded shadow p-4">
        <div class="text-xs text-gray-500 uppercase">Reward unclaimed</div>
        <div class="text-2xl font-semibold" :class="stats.rewardPending ? 'text-warning' : ''">
          {{ stats.rewardPending }}
        </div>
      </div>
    </div>

    <div class="bg-base-100 rounded shadow">
      <div class="flex flex-wrap items-center gap-2 px-4 pt-4">
        <h2 class="text-lg font-semibold mr-auto">Game Sessions</h2>
        <input
          v-model="playerFilter"
          class="input input-sm input-bordered w-64 max-w-full"
          placeholder="Filter by player address"
          @keyup.enter="load"
        />
        <select v-model="statusFilter" class="select select-sm select-bordered">
          <option value="">All statuses</option>
          <option v-for="s in statusOptions" :key="s" :value="s">{{ s }}</option>
        </select>
        <button class="btn btn-sm btn-primary" :disabled="loading" @click="load">
          <span v-if="loading" class="loading loading-spinner loading-xs mr-1"></span>
          Apply
        </button>
      </div>

      <div v-if="error" class="alert alert-error m-4">{{ error }}</div>

      <div class="overflow-x-auto p-4">
        <table class="table table-compact w-full">
          <thead>
            <tr>
              <th>Session</th>
              <th>Game</th>
              <th>Players</th>
              <th class="text-right">Stake / Pot</th>
              <th>Status</th>
              <th>Relay</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="loading">
              <td colspan="6" class="text-center text-gray-400">Loading…</td>
            </tr>
            <tr v-else-if="!sorted.length">
              <td colspan="6" class="text-center text-gray-400">No game session matches the filter.</td>
            </tr>
            <tr v-for="s in pageRows" :key="s.session_id">
              <td>
                <RouterLink class="text-primary font-semibold" :to="`/${chain}/sessions/${s.session_id}`">
                  #{{ s.session_id }}
                </RouterLink>
              </td>
              <td>
                <span class="badge badge-sm badge-ghost">{{ shortGameType(s.game_type) }}</span>
                <div class="text-xs text-gray-500">{{ gameTypeName(s.game_type) }}</div>
              </td>
              <td>
                <RouterLink class="text-primary text-xs block truncate max-w-[16rem]" :to="`/${chain}/account/${s.player_a}`">
                  {{ s.player_a }}
                </RouterLink>
                <RouterLink class="text-primary text-xs block truncate max-w-[16rem]" :to="`/${chain}/account/${s.player_b}`">
                  {{ s.player_b }}
                </RouterLink>
              </td>
              <td class="text-right whitespace-nowrap">
                {{ format.formatToken({ amount: s.stake, denom: stakeDenom }) }}
                <div class="text-xs text-gray-500">pot {{ potOf(s) }}</div>
              </td>
              <td>
                <span class="badge badge-sm border-none" :class="sessionStatusColor(s.status)">
                  {{ shortSessionStatus(s.status) }}
                </span>
              </td>
              <td class="text-xs">
                <div class="truncate max-w-[12rem]">{{ s.relay_assignment?.primary_relay || '—' }}</div>
                <span v-if="rewardPending(s)" class="badge badge-xs badge-warning border-none">
                  reward unclaimed
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="pageCount > 1" class="flex items-center justify-end gap-2 px-4 pb-4">
        <button class="btn btn-xs" :disabled="page === 0" @click="page--">Prev</button>
        <span class="text-xs text-gray-500">{{ page + 1 }} / {{ pageCount }}</span>
        <button class="btn btn-xs" :disabled="page + 1 >= pageCount" @click="page++">Next</button>
      </div>

      <div class="px-4 pb-4 text-xs text-gray-500">
        Sessions are read live from the chain LCD. The node returns every matching session at once (no server-side
        cursor), so filtering by player or status keeps the list manageable; paging above is done in your browser.
      </div>
    </div>
  </div>
</template>

<route>
  {
    meta: {
      i18n: 'sessions',
      order: 7
    }
  }
</route>
