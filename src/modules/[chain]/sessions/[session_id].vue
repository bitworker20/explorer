<script lang="ts" setup>
import { computed, onMounted, ref } from 'vue';
import { useBaseStore, useBlockchain, useFormatter } from '@/stores';
import {
  fetchSession,
  fetchSessionEvidence,
  gameTypeName,
  hasAdjudication,
  hasFault,
  sessionStatusColor,
  shortFault,
  shortGameType,
  shortSessionStatus,
  shortVerdict,
  type GameSession,
  type SessionEvidence,
  type SessionResult,
} from './sessions';

const props = defineProps(['session_id', 'chain']);

const chainStore = useBlockchain();
const baseStore = useBaseStore();
const format = useFormatter();

const session = ref(undefined as GameSession | undefined);
const evidence = ref([] as SessionEvidence[]);
const error = ref('');
const loading = ref(true);

const stakeDenom = computed(() => chainStore.current?.assets?.[0]?.base || 'uchip');
const latestHeight = computed(() => Number(baseStore.latest?.block?.header?.height || 0));

// player_a is the engine's first seat; button_seat says who holds the button.
const buttonPlayer = computed(() => {
  if (!session.value) return '';
  return session.value.button_seat === 0 ? session.value.player_a : session.value.player_b;
});

// The two submitted results agree when they exist and carry the same seat stacks.
const resultsAgree = computed(() => {
  const a = session.value?.player_a_result;
  const b = session.value?.player_b_result;
  if (!a || !b) return undefined;
  return a.player_a_amount === b.player_a_amount && a.player_b_amount === b.player_b_amount;
});

function token(amount?: string): string {
  return format.formatToken({ amount: amount || '0', denom: stakeDenom.value });
}

function height(value?: string | number): string {
  const h = Number(value || 0);
  if (!h) return '—';
  if (!latestHeight.value || latestHeight.value < h) return String(h);
  return `${h} (-${latestHeight.value - h})`;
}

function resultLabel(seat: 'a' | 'b'): SessionResult | null | undefined {
  return seat === 'a' ? session.value?.player_a_result : session.value?.player_b_result;
}

async function load() {
  loading.value = true;
  error.value = '';
  try {
    session.value = await fetchSession(chainStore.endpoint.address, props.session_id);
    evidence.value = await fetchSessionEvidence(chainStore.endpoint.address, props.session_id);
  } catch (e: any) {
    error.value = e?.message || 'failed to load session';
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div>
    <div v-if="error" class="alert alert-error mb-4">{{ error }}</div>

    <div v-if="loading" class="bg-base-100 rounded shadow p-8 text-center text-gray-400">
      <span class="loading loading-spinner loading-sm mr-2"></span>Loading session #{{ session_id }}…
    </div>
    <div v-else-if="!session && !error" class="bg-base-100 rounded shadow p-8 text-center text-gray-400">
      No session #{{ session_id }} exists on this chain.
    </div>

    <div v-if="session">
      <div class="flex flex-wrap items-center gap-3 mb-4">
        <h1 class="text-xl font-semibold">Session #{{ session.session_id }}</h1>
        <span class="badge badge-ghost">{{ gameTypeName(session.game_type) }} ({{ shortGameType(session.game_type) }})</span>
        <span class="badge border-none" :class="sessionStatusColor(session.status)">
          {{ shortSessionStatus(session.status) }}
        </span>
      </div>

      <div class="grid md:!grid-cols-2 gap-4">
        <!-- Overview -->
        <div class="bg-base-100 rounded shadow p-4">
          <h2 class="text-lg font-semibold mb-3">Overview</h2>
          <table class="table table-compact w-full">
            <tbody>
              <tr>
                <td class="text-gray-500">Game type</td>
                <td class="text-right">{{ gameTypeName(session.game_type) }}</td>
              </tr>
              <tr>
                <td class="text-gray-500">Stake (per seat)</td>
                <td class="text-right">{{ token(session.stake) }}</td>
              </tr>
              <tr>
                <td class="text-gray-500">Player A</td>
                <td class="text-right">
                  <RouterLink class="text-primary break-all" :to="`/${chain}/account/${session.player_a}`">
                    {{ session.player_a }}
                  </RouterLink>
                  <span v-if="buttonPlayer === session.player_a" class="badge badge-xs ml-1">button</span>
                  <div class="text-xs text-gray-500">
                    intent #{{ session.player_a_intent_id }} · start {{ token(session.player_a_chips) }}
                  </div>
                </td>
              </tr>
              <tr>
                <td class="text-gray-500">Player B</td>
                <td class="text-right">
                  <RouterLink class="text-primary break-all" :to="`/${chain}/account/${session.player_b}`">
                    {{ session.player_b }}
                  </RouterLink>
                  <span v-if="buttonPlayer === session.player_b" class="badge badge-xs ml-1">button</span>
                  <div class="text-xs text-gray-500">
                    intent #{{ session.player_b_intent_id }} · start {{ token(session.player_b_chips) }}
                  </div>
                </td>
              </tr>
              <tr>
                <td class="text-gray-500">Hand id</td>
                <td class="text-right">{{ session.hand_id }}</td>
              </tr>
              <tr>
                <td class="text-gray-500">Result deadline</td>
                <td class="text-right">{{ height(session.result_deadline_height) }}</td>
              </tr>
              <tr v-if="Number(session.dispute_deadline_height)">
                <td class="text-gray-500">Dispute deadline</td>
                <td class="text-right">{{ height(session.dispute_deadline_height) }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Relay & rewards -->
        <div class="bg-base-100 rounded shadow p-4">
          <h2 class="text-lg font-semibold mb-3">Relay &amp; rewards</h2>
          <table class="table table-compact w-full">
            <tbody>
              <tr>
                <td class="text-gray-500">Primary relay</td>
                <td class="text-right break-all">
                  <RouterLink
                    v-if="session.relay_assignment?.primary_relay"
                    class="text-primary"
                    :to="`/${chain}/relay/${session.relay_assignment.primary_relay}`"
                  >
                    {{ session.relay_assignment.primary_relay }}
                  </RouterLink>
                  <span v-else>—</span>
                </td>
              </tr>
              <tr v-if="session.relay_assignment?.backup_relays?.length">
                <td class="text-gray-500">Backup relays</td>
                <td class="text-right break-all">{{ session.relay_assignment.backup_relays.join(', ') }}</td>
              </tr>
              <tr>
                <td class="text-gray-500">Relay reward</td>
                <td class="text-right">
                  {{ token(session.relay_reward) }}
                  <span v-if="session.relay_reward_claimed" class="badge badge-xs badge-success ml-1">claimed</span>
                </td>
              </tr>
              <tr v-if="Number(session.relay_fee_snapshot)">
                <td class="text-gray-500">Relay fee (flat, locked)</td>
                <td class="text-right">{{ token(session.relay_fee_snapshot) }}</td>
              </tr>
            </tbody>
          </table>

          <div v-if="session.relay_reward_shares?.length" class="mt-3">
            <div class="text-xs text-gray-500 uppercase mb-1">Per-relay shares</div>
            <table class="table table-compact w-full">
              <tbody>
                <tr v-for="share in session.relay_reward_shares" :key="share.relay_id">
                  <td class="truncate max-w-[12rem]">{{ share.relay_id }}</td>
                  <td class="text-right">{{ token(share.amount) }}</td>
                  <td class="text-right">
                    <span v-if="share.claimed" class="text-success">claimed</span>
                    <span v-else class="text-gray-400">pending</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- Submitted results -->
      <div class="bg-base-100 rounded shadow p-4 mt-4">
        <div class="flex items-center gap-3 mb-3">
          <h2 class="text-lg font-semibold">Submitted results</h2>
          <span v-if="resultsAgree === true" class="badge badge-sm badge-success border-none">results agree</span>
          <span v-else-if="resultsAgree === false" class="badge badge-sm badge-error border-none">results disagree</span>
        </div>
        <div class="overflow-x-auto">
          <table class="table table-compact w-full">
            <thead>
              <tr>
                <th>Submitter</th>
                <th>Winner</th>
                <th class="text-right">A stack</th>
                <th class="text-right">B stack</th>
                <th class="text-right">Final stake</th>
                <th>Split</th>
                <th class="text-xs">Transcript</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="!resultLabel('a') && !resultLabel('b')">
                <td colspan="7" class="text-center text-gray-400">No result has been submitted yet.</td>
              </tr>
              <template v-for="seat in (['a', 'b'] as const)" :key="seat">
                <tr v-if="resultLabel(seat)">
                  <td class="truncate max-w-[12rem]">
                    <RouterLink class="text-primary" :to="`/${chain}/account/${resultLabel(seat)!.submitter}`">
                      {{ resultLabel(seat)!.submitter }}
                    </RouterLink>
                    <div class="text-xs text-gray-500">seat {{ seat.toUpperCase() }}</div>
                  </td>
                  <td class="truncate max-w-[12rem]">{{ resultLabel(seat)!.winner || '—' }}</td>
                  <td class="text-right">{{ token(resultLabel(seat)!.player_a_amount) }}</td>
                  <td class="text-right">{{ token(resultLabel(seat)!.player_b_amount) }}</td>
                  <td class="text-right">{{ token(resultLabel(seat)!.final_stake) }}</td>
                  <td>{{ resultLabel(seat)!.split_pot ? 'yes' : 'no' }}</td>
                  <td class="text-xs truncate max-w-[10rem]">{{ resultLabel(seat)!.transcript_hash }}</td>
                </tr>
              </template>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Adjudication -->
      <div v-if="hasAdjudication(session)" class="bg-base-100 rounded shadow p-4 mt-4">
        <h2 class="text-lg font-semibold mb-3">Adjudication</h2>
        <table class="table table-compact w-full">
          <tbody>
            <tr>
              <td class="text-gray-500">Verdict</td>
              <td class="text-right font-semibold">{{ shortVerdict(session.adjudication!.verdict) }}</td>
            </tr>
            <tr v-if="hasFault(session.adjudication!.fault)">
              <td class="text-gray-500">Fault</td>
              <td class="text-right text-error break-all">{{ shortFault(session.adjudication!.fault) }}</td>
            </tr>
            <tr>
              <td class="text-gray-500">Payout — player A</td>
              <td class="text-right">{{ token(session.adjudication!.player_a_amount) }}</td>
            </tr>
            <tr>
              <td class="text-gray-500">Payout — player B</td>
              <td class="text-right">{{ token(session.adjudication!.player_b_amount) }}</td>
            </tr>
            <tr v-if="Number(session.adjudication!.dispute_fee)">
              <td class="text-gray-500">Dispute fee</td>
              <td class="text-right">
                {{ token(session.adjudication!.dispute_fee) }}
                <span v-if="session.adjudication!.dispute_fee_collected" class="badge badge-xs badge-error ml-1">collected</span>
              </td>
            </tr>
            <tr>
              <td class="text-gray-500">Engine version</td>
              <td class="text-right">{{ session.adjudication!.engine_version || '—' }}</td>
            </tr>
            <tr>
              <td class="text-gray-500">Adjudicated at</td>
              <td class="text-right">{{ height(session.adjudication!.adjudicated_height) }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Evidence -->
      <div class="bg-base-100 rounded shadow p-4 mt-4">
        <h2 class="text-lg font-semibold mb-3">Dispute evidence</h2>
        <div class="overflow-x-auto">
          <table class="table table-compact w-full">
            <thead>
              <tr>
                <th>Submitter</th>
                <th>Reason</th>
                <th class="text-xs">Evidence hash</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="!evidence.length">
                <td colspan="3" class="text-center text-gray-400">No evidence has been filed for this session.</td>
              </tr>
              <tr v-for="(e, i) in evidence" :key="i">
                <td class="truncate max-w-[12rem]">
                  <RouterLink class="text-primary" :to="`/${chain}/account/${e.submitter}`">{{ e.submitter }}</RouterLink>
                </td>
                <td>{{ e.reason }}</td>
                <td class="text-xs truncate max-w-[16rem]">{{ e.evidence_hash }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
</template>
