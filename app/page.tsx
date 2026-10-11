"use client";

import { useEffect, useRef, useState } from "react";
import {
  ChevronRight,
  ClipboardList,
  Crown,
  Gamepad2,
  History,
  Medal,
  Pencil,
  Plus,
  Power,
  Settings2,
  SlidersHorizontal,
  Trophy,
  UserPlus,
  Users,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getSupabase } from "@/lib/supabase";

type Rule = {
  id: string;
  name: string;
  delta: number;
  icon: "bronze" | "silver" | "gold" | "mvp";
  enabled: boolean;
};

type Player = {
  id: string;
  name: string;
  active: boolean;
  points: number;
  resultCount: number;
  positiveCount: number;
  negativeCount: number;
  averageDelta: number;
  weeklyPoints: number;
  todayCount: number;
  lastResultAt?: string;
};

type PointHistory = {
  id: string;
  playerId: string;
  delta: number;
  time: string;
};

type Tab = "Pemain" | "Riwayat" | "Aturan";

type RuleRow = {
  id: string;
  name: string;
  delta: number | string;
  icon: Rule["icon"];
  enabled: boolean;
};

type PlayerRow = {
  id: string;
  name: string;
  active: boolean;
  points: number | string;
  result_count: number | string;
  positive_count: number | string;
  negative_count: number | string;
  average_delta: number | string | null;
  weekly_points: number | string;
  today_count: number | string;
  last_result_at: string | null;
};

type PointHistoryRow = {
  player_id: string;
  entry_id: string;
  point_delta: number | string;
  recorded_at: string;
};

const mapRule = (row: RuleRow): Rule => ({
  id: row.id,
  name: row.name,
  delta: Number(row.delta),
  icon: row.icon,
  enabled: row.enabled,
});

const mapPlayer = (row: PlayerRow): Player => ({
  id: row.id,
  name: row.name,
  active: row.active,
  points: Number(row.points),
  resultCount: Number(row.result_count),
  positiveCount: Number(row.positive_count),
  negativeCount: Number(row.negative_count),
  averageDelta: Number(row.average_delta ?? 0),
  weeklyPoints: Number(row.weekly_points),
  todayCount: Number(row.today_count),
  lastResultAt: row.last_result_at ?? undefined,
});

const mapPointHistory = (row: PointHistoryRow): PointHistory => ({
  id: row.entry_id,
  playerId: row.player_id,
  delta: Number(row.point_delta),
  time: row.recorded_at,
});

const errorMessage = (error: unknown, fallback: string) =>
  error instanceof Error
    ? error.message
    : typeof error === "object" &&
        error !== null &&
        "message" in error &&
        typeof error.message === "string"
      ? error.message
      : fallback;

const point = (value: number) => {
  const amount = Math.abs(value).toLocaleString("id-ID", {
    maximumFractionDigits: 2,
  });
  return value > 0 ? `+${amount}` : value < 0 ? `-${amount}` : "0";
};

function Glyph({ rule, small = false }: { rule: Rule; small?: boolean }) {
  const className = small ? "size-4" : "size-5";
  if (rule.icon === "mvp") return <Crown className={className} strokeWidth={2.1} />;
  if (rule.icon === "gold") return <Trophy className={className} strokeWidth={2.1} />;
  return <Medal className={className} strokeWidth={2.1} />;
}

export default function Home() {
  const [players, setPlayers] = useState<Player[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [entries, setEntries] = useState<PointHistory[]>([]);
  const [tab, setTab] = useState<Tab>("Pemain");
  const [showInactive, setShowInactive] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [detailPlayerId, setDetailPlayerId] = useState<string | null>(null);
  const [recordingPlayerId, setRecordingPlayerId] = useState<string | null>(null);
  const [editingPlayer, setEditingPlayer] = useState<Player | null>(null);
  const [newPlayer, setNewPlayer] = useState(false);
  const [statusPlayer, setStatusPlayer] = useState<Player | null>(null);
  const [editingRule, setEditingRule] = useState<Rule | null>(null);
  const [newRule, setNewRule] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [undoEntryId, setUndoEntryId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const playersRef = useRef(players);
  const rulesRef = useRef(rules);
  const pendingRef = useRef<string | null>(null);
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshAllRef = useRef<() => Promise<void>>(async () => undefined);

  useEffect(() => {
    playersRef.current = players;
    rulesRef.current = rules;
  }, [players, rules]);

  useEffect(() => {
    let active = true;
    let playerVersion = 0;
    let ruleVersion = 0;
    let historyVersion = 0;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    let channel: ReturnType<ReturnType<typeof getSupabase>["channel"]> | undefined;

    const initialize = async () => {
      try {
        const supabase = getSupabase();

        const refreshPlayers = async () => {
          const version = ++playerVersion;
          const rows: PlayerRow[] = [];
          for (let from = 0; ; from += 1000) {
            const { data, error } = await supabase
              .from("player_standings")
              .select("id,name,active,points,result_count,positive_count,negative_count,average_delta,weekly_points,today_count,last_result_at")
              .order("active", { ascending: false })
              .order("name")
              .order("id")
              .range(from, from + 999);
            if (error) throw error;
            rows.push(...(data as PlayerRow[]));
            if (data.length < 1000) break;
          }
          if (active && version === playerVersion) {
            setPlayers(rows.map(mapPlayer));
          }
        };

        const refreshRules = async () => {
          const version = ++ruleVersion;
          const rows: RuleRow[] = [];
          for (let from = 0; ; from += 1000) {
            const { data, error } = await supabase
              .from("point_rules")
              .select("id,name,delta,icon,enabled")
              .order("sort_order")
              .order("created_at")
              .order("id")
              .range(from, from + 999);
            if (error) throw error;
            rows.push(...(data as RuleRow[]));
            if (data.length < 1000) break;
          }
          if (active && version === ruleVersion) {
            setRules(rows.map(mapRule));
          }
        };

        const refreshHistory = async () => {
          const version = ++historyVersion;
          if (active) setHistoryLoading(true);
          try {
            const { data, error } = await supabase.rpc("get_player_point_history", {
              p_limit: 20,
            });
            if (error) throw error;
            if (active && version === historyVersion) {
              setEntries((data as PointHistoryRow[]).map(mapPointHistory));
            }
          } finally {
            if (active && version === historyVersion) setHistoryLoading(false);
          }
        };

        const refreshAll = async () => {
          await Promise.all([refreshPlayers(), refreshRules(), refreshHistory()]);
          if (active) setLoadError(null);
        };

        refreshAllRef.current = refreshAll;
        localStorage.removeItem("rankpoint-data-v1");

        await refreshAll();

        const scheduleRefresh = () => {
          if (refreshTimer) clearTimeout(refreshTimer);
          refreshTimer = setTimeout(() => {
            void refreshAll().catch((error) => {
              if (active) {
                setLoadError(errorMessage(error, "Sinkronisasi Supabase gagal."));
              }
            });
          }, 120);
        };

        channel = supabase
          .channel("rankpoint-public-multiplayer")
          .on("postgres_changes", { event: "*", schema: "public", table: "players" }, scheduleRefresh)
          .on("postgres_changes", { event: "*", schema: "public", table: "point_rules" }, scheduleRefresh)
          .on("postgres_changes", { event: "*", schema: "public", table: "match_entries" }, scheduleRefresh)
          .subscribe((status) => {
            if (status === "SUBSCRIBED") scheduleRefresh();
          });
      } catch (error) {
        if (active) {
          setLoadError(errorMessage(error, "Gagal memuat data Supabase."));
        }
      } finally {
        if (active) setLoaded(true);
      }
    };

    void initialize();
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }

    return () => {
      active = false;
      if (refreshTimer) clearTimeout(refreshTimer);
      if (channel) void getSupabase().removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    const context = (document as Document & {
      modelContext?: {
        registerTool: (
          tool: {
            name: string;
            title: string;
            description: string;
            inputSchema: object;
            annotations: object;
            execute: (input: unknown) => unknown;
          },
          options: { signal: AbortSignal },
        ) => void | Promise<void>;
      };
    }).modelContext;
    if (!context?.registerTool) return;

    const lifecycle = new AbortController();
    try {
      void Promise.resolve(
        context.registerTool(
          {
            name: "get_rankpoint_summary",
            title: "Lihat daftar RankPoint",
            description: "Membaca pemain aktif, poin, jumlah pertandingan, dan aturan aktif.",
            inputSchema: { type: "object", properties: {}, additionalProperties: false },
            annotations: { readOnlyHint: true, untrustedContentHint: false },
            execute: () => ({
              players: playersRef.current
                .filter((player) => player.active)
                .map(({ id, name, points, resultCount }) => ({ id, name, points, resultCount })),
              activeRules: rulesRef.current
                .filter((rule) => rule.enabled)
                .map(({ id, name, delta }) => ({ id, name, delta })),
            }),
          },
          { signal: lifecycle.signal },
        ),
      ).catch(() => undefined);

      void Promise.resolve(
        context.registerTool(
          {
            name: "log_rankpoint_match",
            title: "Catat hasil pemain",
            description: "Mencatat satu hasil pertandingan untuk satu pemain aktif.",
            inputSchema: {
              type: "object",
              properties: {
                playerId: { type: "string" },
                ruleId: { type: "string" },
                note: { type: "string" },
              },
              required: ["playerId", "ruleId"],
              additionalProperties: false,
            },
            annotations: { readOnlyHint: false, untrustedContentHint: false },
            execute: async (input) => {
              const value = input as {
                playerId?: unknown;
                ruleId?: unknown;
                note?: unknown;
              };
              if (typeof value.playerId !== "string" || typeof value.ruleId !== "string") {
                throw new Error("playerId dan ruleId harus berupa teks.");
              }
              const player = playersRef.current.find(
                (item) => item.id === value.playerId && item.active,
              );
              const rule = rulesRef.current.find(
                (item) => item.id === value.ruleId && item.enabled,
              );
              if (!player) throw new Error("Pemain aktif tidak ditemukan.");
              if (!rule) throw new Error("Aturan aktif tidak ditemukan.");

              const supabase = getSupabase();
              const { error } = await supabase.rpc("record_result", {
                p_entry_id: crypto.randomUUID(),
                p_player_id: player.id,
                p_rule_id: rule.id,
                p_note: typeof value.note === "string" ? value.note.slice(0, 120) : null,
                p_source: "webmcp",
              });
              if (error) throw error;
              await refreshAllRef.current();
              const { data, error: summaryError } = await supabase
                .from("player_standings")
                .select("points,result_count")
                .eq("id", player.id)
                .single();
              if (summaryError) throw summaryError;
              return {
                recorded: true,
                playerId: player.id,
                playerName: player.name,
                result: rule.name,
                delta: rule.delta,
                points: Number(data.points),
                resultCount: Number(data.result_count),
              };
            },
          },
          { signal: lifecycle.signal },
        ),
      ).catch(() => undefined);
    } catch {
      // Browser without WebMCP still has the complete UI.
    }
    return () => lifecycle.abort();
  }, []);

  const showNotice = (
    message: string,
    duration = 4000,
    undoId: string | null = null,
  ) => {
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    setNotice(message);
    setUndoEntryId(undoId);
    noticeTimerRef.current = setTimeout(() => {
      setNotice(null);
      setUndoEntryId(null);
    }, duration);
  };

  const runMutation = async (key: string, work: () => Promise<void>) => {
    if (pendingRef.current) return;
    pendingRef.current = key;
    setPending(key);
    try {
      await work();
    } catch (error) {
      showNotice(errorMessage(error, "Operasi gagal. Coba lagi."));
    } finally {
      pendingRef.current = null;
      setPending(null);
    }
  };

  const savePlayer = async (name: string) => {
    await runMutation("player-save", async () => {
      const request = editingPlayer
        ? getSupabase().rpc("update_player", { p_id: editingPlayer.id, p_name: name })
        : getSupabase().rpc("create_player", { p_name: name });
      const { error } = await request;
      if (error) throw error;
      await refreshAllRef.current();
      setEditingPlayer(null);
      setNewPlayer(false);
      showNotice(editingPlayer ? "Nama pemain diperbarui." : "Pemain baru ditambahkan.");
    });
  };

  const changePlayerStatus = async () => {
    if (!statusPlayer) return;
    const player = statusPlayer;
    await runMutation("player-status", async () => {
      const { error } = await getSupabase().rpc("set_player_active", {
        p_id: player.id,
        p_active: !player.active,
      });
      if (error) throw error;
      await refreshAllRef.current();
      setStatusPlayer(null);
      showNotice(player.active ? "Pemain dinonaktifkan." : "Pemain diaktifkan kembali.");
    });
  };

  const saveResult = async (player: Player, ruleId: string, note: string) => {
    const entryId = crypto.randomUUID();
    await runMutation("result-save", async () => {
      const rule = rules.find((item) => item.id === ruleId && item.enabled);
      if (!rule) throw new Error("Aturan aktif tidak ditemukan.");
      const { error } = await getSupabase().rpc("record_result", {
        p_entry_id: entryId,
        p_player_id: player.id,
        p_rule_id: rule.id,
        p_note: note.trim() || null,
        p_source: "ui",
      });
      if (error) throw error;
      await refreshAllRef.current();
      setRecordingPlayerId(null);
      showNotice(`${rule.name} untuk ${player.name} tersimpan (${point(rule.delta)}).`, 4500, entryId);
    });
  };

  const deleteResult = async (id: string, undo = false) => {
    await runMutation(undo ? "result-undo" : `result-delete-${id}`, async () => {
      const { data, error } = await getSupabase().rpc("delete_result", { p_id: id });
      if (error) throw error;
      if (!data) throw new Error("Hasil tersebut sudah dihapus.");
      await refreshAllRef.current();
      showNotice(undo ? "Input terakhir dibatalkan." : "Riwayat dihapus.", 2600);
    });
  };

  const saveRule = async (rule: Rule) => {
    await runMutation("rule-save", async () => {
      const request = editingRule
        ? getSupabase().rpc("update_point_rule", {
            p_id: editingRule.id,
            p_name: rule.name,
            p_delta: rule.delta,
          })
        : getSupabase().rpc("create_point_rule", {
            p_name: rule.name,
            p_delta: rule.delta,
            p_icon: rule.icon,
          });
      const { error } = await request;
      if (error) throw error;
      await refreshAllRef.current();
      setEditingRule(null);
      setNewRule(false);
      showNotice(editingRule ? "Aturan diperbarui." : "Aturan baru ditambahkan.");
    });
  };

  const setRuleEnabled = async (rule: Rule) => {
    await runMutation(`rule-status-${rule.id}`, async () => {
      const { error } = await getSupabase().rpc("set_point_rule_enabled", {
        p_id: rule.id,
        p_enabled: !rule.enabled,
      });
      if (error) throw error;
      await refreshAllRef.current();
    });
  };

  const detailPlayer = players.find((player) => player.id === detailPlayerId) ?? null;
  const recordingPlayer = players.find((player) => player.id === recordingPlayerId) ?? null;

  if (!loaded) {
    return (
      <main className="grid min-h-dvh place-items-center bg-[#f5f5f7] px-6 text-sm font-semibold text-black/55 dark:bg-black dark:text-white/60">
        Memuat RankPoint...
      </main>
    );
  }

  if (loadError && rules.length === 0) {
    return (
      <main className="grid min-h-dvh place-items-center bg-[#f5f5f7] px-6 dark:bg-black">
        <div className="max-w-md rounded-3xl border border-red-500/20 bg-white p-6 text-center dark:bg-[#151515]">
          <p className="font-bold text-red-600 dark:text-red-400">Supabase belum siap</p>
          <p className="mt-2 break-words text-sm text-black/55 dark:text-white/55">{loadError}</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-dvh overflow-x-hidden bg-[#f5f5f7] text-[#111113] selection:bg-black selection:text-white dark:bg-black dark:text-white">
      <div className="mx-auto min-h-dvh max-w-6xl px-4 pb-[calc(7rem+env(safe-area-inset-bottom))] pt-[max(1.25rem,env(safe-area-inset-top))] sm:px-6 sm:pt-7">
        <header className="mb-7 flex items-center justify-between gap-3">
          <button className="flex min-w-0 items-center gap-3 text-left" onClick={() => setTab("Pemain")}>
            <span className="grid size-11 shrink-0 place-items-center rounded-[16px] bg-black text-white shadow-[0_8px_20px_rgba(0,0,0,.18)] dark:bg-white dark:text-black">
              <Gamepad2 className="size-5" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-lg font-bold tracking-[-.04em]">RankPoint</span>
              <span className="block truncate text-xs text-black/45 dark:text-white/45">Poin pertandingan bersama</span>
            </span>
          </button>
          <button
            aria-label="Pengaturan aturan poin"
            onClick={() => setTab("Aturan")}
            className="grid size-11 shrink-0 place-items-center rounded-full border border-black/8 bg-white dark:border-white/10 dark:bg-[#171717]"
          >
            <Settings2 className="size-[18px]" />
          </button>
        </header>

        {loadError && (
          <div className="mb-5 break-words rounded-2xl border border-red-500/20 bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300">
            {loadError}
          </div>
        )}

        {tab === "Pemain" && (
          <PlayersPage
            players={players}
            showInactive={showInactive}
            pending={pending}
            onToggleInactive={() => setShowInactive((value) => !value)}
            onAdd={() => setNewPlayer(true)}
            onDetail={(player) => setDetailPlayerId(player.id)}
            onRecord={(player) => setRecordingPlayerId(player.id)}
            onEdit={setEditingPlayer}
            onStatus={setStatusPlayer}
          />
        )}

        {tab === "Riwayat" && (
          <HistoryPage
            entries={entries}
            players={players}
            loading={historyLoading}
          />
        )}

        {tab === "Aturan" && (
          <RulesPage
            rules={rules}
            pending={pending}
            onAdd={() => setNewRule(true)}
            onEdit={setEditingRule}
            onStatus={(rule) => void setRuleEnabled(rule)}
          />
        )}
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-20 mx-auto flex max-w-[540px] justify-around border-t border-black/8 bg-white/90 px-2 pb-[max(.75rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur-xl dark:border-white/10 dark:bg-black/85">
        {([
          ["Pemain", Users],
          ["Riwayat", History],
          ["Aturan", SlidersHorizontal],
        ] as const).map(([label, Icon]) => (
          <button
            key={label}
            onClick={() => setTab(label)}
            aria-current={tab === label ? "page" : undefined}
            className={`flex min-h-12 min-w-20 flex-col items-center justify-center gap-1 rounded-xl px-3 text-[11px] font-semibold ${tab === label ? "text-black dark:text-white" : "text-black/38 dark:text-white/38"}`}
          >
            <Icon className={`size-[19px] ${tab === label ? "stroke-[2.4]" : ""}`} />
            <span>{label}</span>
          </button>
        ))}
      </nav>

      {(editingPlayer || newPlayer) && (
        <PlayerEditor
          key={editingPlayer?.id ?? "new-player"}
          open
          player={editingPlayer}
          pending={pending === "player-save"}
          onClose={() => {
            setEditingPlayer(null);
            setNewPlayer(false);
          }}
          onSave={(name) => void savePlayer(name)}
        />
      )}

      {recordingPlayer && (
        <ResultDialog
          key={recordingPlayer.id}
          player={recordingPlayer}
          rules={rules.filter((rule) => rule.enabled)}
          pending={pending === "result-save"}
          onClose={() => setRecordingPlayerId(null)}
          onSave={(ruleId, note) => void saveResult(recordingPlayer, ruleId, note)}
        />
      )}

      {detailPlayer && (
        <PlayerDetail
          player={detailPlayer}
          onClose={() => setDetailPlayerId(null)}
          onRecord={() => {
            setDetailPlayerId(null);
            setRecordingPlayerId(detailPlayer.id);
          }}
          onHistory={() => {
            setDetailPlayerId(null);
            setTab("Riwayat");
          }}
        />
      )}

      {statusPlayer && (
        <PlayerStatusDialog
          player={statusPlayer}
          pending={pending === "player-status"}
          onClose={() => setStatusPlayer(null)}
          onConfirm={() => void changePlayerStatus()}
        />
      )}

      {(editingRule || newRule) && (
        <RuleEditor
          key={editingRule?.id ?? "new-rule"}
          open
          rule={editingRule}
          pending={pending === "rule-save"}
          onClose={() => {
            setEditingRule(null);
            setNewRule(false);
          }}
          onSave={(rule) => void saveRule(rule)}
        />
      )}

      {notice && (
        <div role="status" aria-live="polite" className="fixed inset-x-4 top-[calc(.75rem+env(safe-area-inset-top))] z-40 mx-auto flex max-w-md items-center justify-between gap-3 rounded-2xl bg-black px-4 py-3 text-sm text-white shadow-xl dark:bg-white dark:text-black">
          <span className="min-w-0 break-words">{notice}</span>
          {undoEntryId && (
            <button
              onClick={() => void deleteResult(undoEntryId, true)}
              className="min-h-11 shrink-0 font-bold underline underline-offset-4"
            >
              Batalkan
            </button>
          )}
        </div>
      )}
    </main>
  );
}

function PlayersPage({
  players,
  showInactive,
  pending,
  onToggleInactive,
  onAdd,
  onDetail,
  onRecord,
  onEdit,
  onStatus,
}: {
  players: Player[];
  showInactive: boolean;
  pending: string | null;
  onToggleInactive: () => void;
  onAdd: () => void;
  onDetail: (player: Player) => void;
  onRecord: (player: Player) => void;
  onEdit: (player: Player) => void;
  onStatus: (player: Player) => void;
}) {
  const activeCount = players.filter((player) => player.active).length;
  const inactiveCount = players.length - activeCount;
  const visiblePlayers = showInactive ? players : players.filter((player) => player.active);

  return (
    <section>
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-[-.055em]">Daftar pemain</h1>
          <p className="mt-1 text-sm text-black/45 dark:text-white/45">{activeCount} pemain aktif</p>
        </div>
        <button
          onClick={onAdd}
          className="flex min-h-11 shrink-0 items-center gap-2 rounded-full bg-black px-4 text-sm font-bold text-white dark:bg-white dark:text-black"
        >
          <UserPlus className="size-4" />
          <span className="hidden sm:inline">Tambah pemain</span>
          <span className="sm:hidden">Tambah</span>
        </button>
      </div>

      {visiblePlayers.length ? (
        <div className="grid gap-3 lg:grid-cols-2">
          {visiblePlayers.map((player) => (
            <article
              key={player.id}
              className={`rounded-[24px] border bg-white p-4 shadow-[0_3px_12px_rgba(0,0,0,.025)] dark:bg-[#151515] ${player.active ? "border-black/8 dark:border-white/10" : "border-black/5 opacity-60 dark:border-white/5"}`}
            >
              <div className="flex items-start gap-3">
                <button
                  onClick={() => onDetail(player)}
                  className="flex min-h-12 min-w-0 flex-1 items-center gap-3 text-left"
                >
                  <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-black/[.055] text-sm font-black dark:bg-white/10">
                    {player.name.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-2 block text-sm font-bold leading-snug">{player.name}</span>
                    <span className="mt-1 block text-[11px] text-black/40 dark:text-white/40">
                      {player.resultCount} pertandingan · #{player.id.slice(0, 6)}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block text-xl font-black tracking-[-.04em]">{player.points.toLocaleString("id-ID", { maximumFractionDigits: 2 })}</span>
                    <span className="text-[10px] text-black/40 dark:text-white/40">poin</span>
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-black/25 dark:text-white/25" />
                </button>
              </div>

              <div className="mt-3 flex items-center gap-2 border-t border-black/7 pt-3 dark:border-white/10">
                {player.active ? (
                  <button
                    disabled={!!pending}
                    onClick={() => onRecord(player)}
                    className="min-h-11 flex-1 rounded-2xl bg-black px-4 text-sm font-bold text-white disabled:opacity-45 dark:bg-white dark:text-black"
                  >
                    Catat hasil
                  </button>
                ) : (
                  <span className="flex min-h-11 flex-1 items-center px-2 text-xs font-bold text-black/40 dark:text-white/40">Pemain nonaktif</span>
                )}
                <button
                  aria-label={`Ubah ${player.name}`}
                  onClick={() => onEdit(player)}
                  className="grid size-11 place-items-center rounded-2xl border border-black/8 dark:border-white/10"
                >
                  <Pencil className="size-4" />
                </button>
                <button
                  aria-label={player.active ? `Nonaktifkan ${player.name}` : `Aktifkan ${player.name}`}
                  onClick={() => onStatus(player)}
                  className="grid size-11 place-items-center rounded-2xl border border-black/8 dark:border-white/10"
                >
                  <Power className="size-4" />
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="rounded-[28px] border border-dashed border-black/12 bg-white px-6 py-16 text-center dark:border-white/15 dark:bg-[#151515]">
          <Users className="mx-auto size-8 text-black/25 dark:text-white/25" />
          <p className="mt-4 font-bold">{players.length ? "Tidak ada pemain aktif" : "Belum ada pemain"}</p>
          <p className="mx-auto mt-1 max-w-xs text-sm text-black/45 dark:text-white/45">
            {players.length ? "Tampilkan pemain nonaktif atau aktifkan kembali pemain." : "Tambahkan pemain pertama untuk mulai mencatat poin."}
          </p>
        </div>
      )}

      {inactiveCount > 0 && (
        <button
          onClick={onToggleInactive}
          className="mx-auto mt-5 flex min-h-11 items-center px-4 text-xs font-bold text-black/50 dark:text-white/50"
        >
          {showInactive ? "Sembunyikan pemain nonaktif" : `Tampilkan ${inactiveCount} pemain nonaktif`}
        </button>
      )}
    </section>
  );
}

function HistoryPage({
  entries,
  players,
  loading,
}: {
  entries: PointHistory[];
  players: Player[];
  loading: boolean;
}) {
  const entriesByPlayer = new Map<string, PointHistory[]>();
  for (const entry of entries) {
    const playerEntries = entriesByPlayer.get(entry.playerId) ?? [];
    playerEntries.push(entry);
    entriesByPlayer.set(entry.playerId, playerEntries);
  }

  return (
    <section>
      <div className="mb-5">
        <h1 className="text-3xl font-bold tracking-[-.055em]">Riwayat</h1>
        <p className="mt-1 text-sm text-black/45 dark:text-white/45">Semua hasil pertandingan pemain</p>
      </div>

      {players.length ? (
        <div className="-mx-4 overflow-x-auto px-4 pb-4 [scrollbar-width:thin] sm:mx-0 sm:px-0">
          <div className={`flex min-w-max snap-x snap-mandatory items-start gap-3 transition-opacity ${loading ? "opacity-55" : "opacity-100"}`}>
            {players.map((player) => {
              const playerEntries = entriesByPlayer.get(player.id) ?? [];
              return (
                <article
                  key={player.id}
                  className={`w-15 shrink-0 snap-start overflow-hidden rounded-[18px] border bg-white sm:w-24 dark:bg-[#151515] ${player.active ? "border-black/8 dark:border-white/10" : "border-black/5 opacity-65 dark:border-white/5"}`}
                >
                  <header className="min-h-12 border-b border-black/7 px-1.5 py-2 text-center dark:border-white/10">
                    <p className="line-clamp-2 text-xs font-black leading-snug sm:text-sm">{player.name}</p>
                    <p className="mt-0.5 text-[9px] text-black/35 dark:text-white/35">#{player.id.slice(0, 6)}</p>
                  </header>
                  <div className="space-y-0.5 px-2 py-2">
                    {playerEntries.length ? (
                      playerEntries.map((entry) => (
                        <div
                          key={entry.id}
                          aria-label={`${player.name}, perubahan poin ${point(entry.delta)}`}
                          className={`grid min-h-7 place-items-center text-sm font-black tabular-nums ${entry.delta > 0 ? "text-emerald-700 dark:text-emerald-400" : entry.delta < 0 ? "text-red-700 dark:text-red-400" : "text-black/55 dark:text-white/55"}`}
                        >
                          {point(entry.delta)}
                        </div>
                      ))
                    ) : (
                      <div className="grid min-h-7 place-items-center text-sm font-bold text-black/25 dark:text-white/25">-</div>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="rounded-[26px] border border-dashed border-black/12 bg-white py-14 text-center dark:border-white/15 dark:bg-[#151515]">
          <ClipboardList className="mx-auto size-7 text-black/30 dark:text-white/30" />
          <p className="mt-3 text-sm font-semibold">Belum ada pemain</p>
        </div>
      )}
    </section>
  );
}

function RulesPage({
  rules,
  pending,
  onAdd,
  onEdit,
  onStatus,
}: {
  rules: Rule[];
  pending: string | null;
  onAdd: () => void;
  onEdit: (rule: Rule) => void;
  onStatus: (rule: Rule) => void;
}) {
  return (
    <section>
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-[-.055em]">Aturan poin</h1>
          <p className="mt-1 text-sm text-black/45 dark:text-white/45">Berlaku untuk semua pemain</p>
        </div>
        <button
          onClick={onAdd}
          aria-label="Tambah aturan"
          className="grid size-11 shrink-0 place-items-center rounded-full bg-black text-white dark:bg-white dark:text-black"
        >
          <Plus className="size-5" />
        </button>
      </div>

      <div className="overflow-hidden rounded-[26px] border border-black/8 bg-white dark:border-white/10 dark:bg-[#151515]">
        {rules.map((rule) => (
          <div key={rule.id} className="flex items-center gap-3 border-b border-black/7 p-4 last:border-0 dark:border-white/10">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-black/[.055] dark:bg-white/10">
              <Glyph rule={rule} small />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold">{rule.name}</p>
              <p className="mt-0.5 text-xs text-black/45 dark:text-white/45">{point(rule.delta)} poin</p>
            </div>
            <button
              disabled={!!pending}
              onClick={() => onStatus(rule)}
              aria-pressed={rule.enabled}
              aria-label={rule.enabled ? `Nonaktifkan ${rule.name}` : `Aktifkan ${rule.name}`}
              className={`h-7 w-12 shrink-0 rounded-full p-1 disabled:opacity-45 ${rule.enabled ? "bg-black dark:bg-white" : "bg-black/13 dark:bg-white/15"}`}
            >
              <span className={`block size-5 rounded-full bg-white shadow-sm transition ${rule.enabled ? "translate-x-5 dark:bg-black" : "translate-x-0"}`} />
            </button>
            <button
              onClick={() => onEdit(rule)}
              aria-label={`Ubah ${rule.name}`}
              className="grid size-11 place-items-center rounded-xl text-black/45 dark:text-white/45"
            >
              <Pencil className="size-4" />
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

function PlayerEditor({
  open,
  player,
  pending,
  onClose,
  onSave,
}: {
  open: boolean;
  player: Player | null;
  pending: boolean;
  onClose: () => void;
  onSave: (name: string) => void;
}) {
  const [name, setName] = useState(player?.name ?? "");
  const valid = name.trim().length > 0;
  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent mobileSheet className="rounded-[28px] border-black/10 dark:border-white/10 sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{player ? "Ubah pemain" : "Tambah pemain"}</DialogTitle>
          <DialogDescription>Nama boleh sama dengan pemain lain. Setiap pemain baru mulai dari 0 poin.</DialogDescription>
        </DialogHeader>
        <label className="block text-sm font-semibold">
          Nama pemain
          <input
            autoFocus
            value={name}
            maxLength={80}
            onChange={(event) => setName(event.target.value)}
            placeholder="Contoh: Andi"
            className="mt-2 h-12 w-full rounded-2xl border border-black/10 bg-black/[.025] px-4 text-base outline-none focus:ring-2 focus:ring-black/20 sm:text-sm dark:border-white/10 dark:bg-white/[.05] dark:focus:ring-white/20"
          />
        </label>
        <DialogFooter>
          <button onClick={onClose} className="min-h-12 rounded-2xl border border-black/10 px-5 text-sm font-bold dark:border-white/10">Batal</button>
          <button
            disabled={!valid || pending}
            onClick={() => onSave(name.trim())}
            className="min-h-12 flex-1 rounded-2xl bg-black px-5 text-sm font-bold text-white disabled:opacity-45 dark:bg-white dark:text-black"
          >
            {pending ? "Menyimpan..." : "Simpan pemain"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ResultDialog({
  player,
  rules,
  pending,
  onClose,
  onSave,
}: {
  player: Player;
  rules: Rule[];
  pending: boolean;
  onClose: () => void;
  onSave: (ruleId: string, note: string) => void;
}) {
  const [ruleId, setRuleId] = useState("");
  const [note, setNote] = useState("");
  return (
    <Dialog open onOpenChange={(value) => !value && onClose()}>
      <DialogContent mobileSheet className="rounded-[28px] border-black/10 dark:border-white/10 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="pr-8 text-xl">Catat hasil untuk {player.name}</DialogTitle>
          <DialogDescription>Poin saat ini {player.points.toLocaleString("id-ID", { maximumFractionDigits: 2 })}. Pilih satu hasil pertandingan.</DialogDescription>
        </DialogHeader>

        {rules.length ? (
          <div className="grid grid-cols-2 gap-2.5">
            {rules.map((rule) => (
              <button
                key={rule.id}
                onClick={() => setRuleId(rule.id)}
                aria-pressed={ruleId === rule.id}
                className={`min-h-24 rounded-[20px] border p-3 text-left transition ${ruleId === rule.id ? "border-black bg-black text-white dark:border-white dark:bg-white dark:text-black" : "border-black/8 bg-black/[.025] dark:border-white/10 dark:bg-white/[.05]"}`}
              >
                <span className="flex items-start justify-between gap-2">
                  <span className="grid size-8 place-items-center rounded-xl bg-current/10"><Glyph rule={rule} small /></span>
                  <span className="text-sm font-black">{point(rule.delta)}</span>
                </span>
                <span className="mt-3 line-clamp-2 block text-sm font-bold">{rule.name}</span>
              </button>
            ))}
          </div>
        ) : (
          <p className="rounded-2xl bg-black/[.04] p-4 text-sm text-black/50 dark:bg-white/[.06] dark:text-white/50">Tidak ada aturan aktif.</p>
        )}

        <label className="block text-sm font-semibold">
          Catatan <span className="font-normal text-black/40 dark:text-white/40">opsional</span>
          <input
            value={note}
            maxLength={120}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Contoh: main bareng squad"
            className="mt-2 h-12 w-full rounded-2xl border border-black/10 bg-black/[.025] px-4 text-base outline-none focus:ring-2 focus:ring-black/20 sm:text-sm dark:border-white/10 dark:bg-white/[.05] dark:focus:ring-white/20"
          />
        </label>

        <DialogFooter>
          <button onClick={onClose} className="min-h-12 rounded-2xl border border-black/10 px-5 text-sm font-bold dark:border-white/10">Batal</button>
          <button
            disabled={!ruleId || pending}
            onClick={() => onSave(ruleId, note)}
            className="min-h-12 flex-1 rounded-2xl bg-black px-5 text-sm font-bold text-white disabled:opacity-45 dark:bg-white dark:text-black"
          >
            {pending ? "Menyimpan..." : "Simpan hasil"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PlayerDetail({
  player,
  onClose,
  onRecord,
  onHistory,
}: {
  player: Player;
  onClose: () => void;
  onRecord: () => void;
  onHistory: () => void;
}) {
  return (
    <Dialog open onOpenChange={(value) => !value && onClose()}>
      <DialogContent mobileSheet className="rounded-[28px] border-black/10 dark:border-white/10 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="pr-8 text-2xl tracking-[-.04em]">{player.name}</DialogTitle>
          <DialogDescription>#{player.id.slice(0, 6)} · {player.active ? "Pemain aktif" : "Pemain nonaktif"}</DialogDescription>
        </DialogHeader>
        <div className="rounded-[24px] bg-black p-5 text-white dark:bg-white dark:text-black">
          <p className="text-xs font-semibold opacity-55">Total poin</p>
          <p className="mt-1 text-5xl font-black tracking-[-.07em]">{player.points.toLocaleString("id-ID", { maximumFractionDigits: 2 })}</p>
          <p className="mt-4 text-xs opacity-55">{point(player.weeklyPoints)} dalam 7 hari · {player.todayCount} pertandingan hari ini</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Metric label="Pertandingan" value={String(player.resultCount)} />
          <Metric label="Rata-rata" value={point(player.averageDelta)} />
          <Metric label="Hasil positif" value={String(player.positiveCount)} />
          <Metric label="Hasil negatif" value={String(player.negativeCount)} />
        </div>
        <DialogFooter>
          <button onClick={onHistory} className="min-h-12 rounded-2xl border border-black/10 px-5 text-sm font-bold dark:border-white/10">Lihat riwayat</button>
          {player.active && (
            <button onClick={onRecord} className="min-h-12 flex-1 rounded-2xl bg-black px-5 text-sm font-bold text-white dark:bg-white dark:text-black">Catat hasil</button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PlayerStatusDialog({
  player,
  pending,
  onClose,
  onConfirm,
}: {
  player: Player;
  pending: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open onOpenChange={(value) => !value && onClose()}>
      <DialogContent mobileSheet className="rounded-[28px] border-black/10 dark:border-white/10 sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{player.active ? "Nonaktifkan pemain?" : "Aktifkan pemain?"}</DialogTitle>
          <DialogDescription>
            {player.active
              ? `${player.name} tidak dapat menerima hasil baru. Riwayat dan poin tetap tersimpan.`
              : `${player.name} akan dapat menerima hasil pertandingan kembali.`}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <button onClick={onClose} className="min-h-12 rounded-2xl border border-black/10 px-5 text-sm font-bold dark:border-white/10">Batal</button>
          <button
            disabled={pending}
            onClick={onConfirm}
            className="min-h-12 flex-1 rounded-2xl bg-black px-5 text-sm font-bold text-white disabled:opacity-45 dark:bg-white dark:text-black"
          >
            {pending ? "Memproses..." : player.active ? "Nonaktifkan" : "Aktifkan"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[20px] border border-black/8 bg-black/[.025] p-4 dark:border-white/10 dark:bg-white/[.05]">
      <p className="text-[11px] font-semibold text-black/45 dark:text-white/45">{label}</p>
      <p className="mt-2 text-xl font-black tracking-[-.04em]">{value}</p>
    </div>
  );
}

function RuleEditor({
  open,
  rule,
  pending,
  onClose,
  onSave,
}: {
  open: boolean;
  rule: Rule | null;
  pending: boolean;
  onClose: () => void;
  onSave: (rule: Rule) => void;
}) {
  const [name, setName] = useState(rule?.name ?? "");
  const [delta, setDelta] = useState(String(rule?.delta ?? 0));
  const numericDelta = Number(delta.replace(",", "."));
  const valid = name.trim().length > 0 && Number.isFinite(numericDelta);

  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent mobileSheet className="rounded-[28px] border-black/10 dark:border-white/10 sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{rule ? "Ubah aturan" : "Aturan baru"}</DialogTitle>
          <DialogDescription>Aturan ini berlaku untuk input seluruh pemain berikutnya.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <label className="block text-sm font-semibold">
            Nama aturan
            <input
              autoFocus
              value={name}
              maxLength={80}
              onChange={(event) => setName(event.target.value)}
              placeholder="Contoh: Top 3"
              className="mt-2 h-12 w-full rounded-2xl border border-black/10 bg-black/[.025] px-4 text-base outline-none focus:ring-2 focus:ring-black/20 sm:text-sm dark:border-white/10 dark:bg-white/[.05] dark:focus:ring-white/20"
            />
          </label>
          <label className="block text-sm font-semibold">
            Perubahan poin
            <input
              value={delta}
              inputMode="decimal"
              onChange={(event) => setDelta(event.target.value)}
              placeholder="Contoh: 1 atau -2,5"
              className="mt-2 h-12 w-full rounded-2xl border border-black/10 bg-black/[.025] px-4 text-base outline-none focus:ring-2 focus:ring-black/20 sm:text-sm dark:border-white/10 dark:bg-white/[.05] dark:focus:ring-white/20"
            />
          </label>
        </div>
        <DialogFooter>
          <button onClick={onClose} className="min-h-12 rounded-2xl border border-black/10 px-5 text-sm font-bold dark:border-white/10">Batal</button>
          <button
            disabled={!valid || pending}
            onClick={() => onSave({
              id: rule?.id ?? "",
              name: name.trim(),
              delta: numericDelta,
              icon: rule?.icon ?? "mvp",
              enabled: rule?.enabled ?? true,
            })}
            className="min-h-12 flex-1 rounded-2xl bg-black px-5 text-sm font-bold text-white disabled:opacity-45 dark:bg-white dark:text-black"
          >
            {pending ? "Menyimpan..." : "Simpan aturan"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
