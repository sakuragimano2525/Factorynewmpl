'use strict';
/* =========================================================
   Pokedrock Battle Factory - UI / Game Flow
   ========================================================= */

const TYPE_CLASS = (t) => 't-' + (t || 'normal');

const TYPE_ID = {
  bug: 1, dark: 2, dragon: 3, electric: 4, fairy: 5, fighting: 6, fire: 7,
  flying: 8, ghost: 9, grass: 10, ground: 11, ice: 12, normal: 13, poison: 14,
  psychic: 15, rock: 16, steel: 17, water: 18, sound: 19, shine: 20,
};
function typeIconHtml(type) {
  const id = TYPE_ID[type];
  if (id === undefined) return '';
  return `<img src="./type${id}.png" alt="" class="move-row-type-icon" onerror="this.style.display='none'">`;
}

// ---- 技の効果説明を、技データ（selfRank/oppRank/selfStatus/oppStatus/flinchChance等）から
//      自動生成する。手打ちの説明文（旧: attack_info.js の ATTACK_INFO_RAW）はもう使わない。
const TR_RANK_STAT_NAME = { atk: '攻撃', def: '防御', spa: '特攻', spd: '特防', spe: '素早さ', acc: '命中率', eva: '回避率' };
const TR_RANK_KEYS = ['atk', 'def', 'spa', 'spd', 'spe', 'acc', 'eva'];

// [確率, atk, def, spa, spd, spe, acc, eva] → "◯%で【対象】の攻撃と素早さが2段階上がる" のような文の配列
// （変化幅が違う能力ごとに文を分ける。例：攻撃が1段階、素早さが2段階なら2文になる）
function describeRankChange(rankData, targetLabel) {
  if (!rankData) return [];
  const chance = rankData[0] ?? 100;
  const chancePrefix = chance >= 100 ? '' : `${chance}%で`;
  // 変化幅ごとにステータス名をまとめる（同じ幅なら「攻撃と素早さが2段階上がる」のように連結）
  const groups = new Map(); // delta -> [statName, ...]
  TR_RANK_KEYS.forEach((k, idx) => {
    const delta = rankData[idx + 1];
    if (!delta) return;
    if (!groups.has(delta)) groups.set(delta, []);
    groups.get(delta).push(TR_RANK_STAT_NAME[k]);
  });
  const sentences = [];
  groups.forEach((names, delta) => {
    const dir = delta > 0 ? '上がる' : '下がる';
    const stage = Math.abs(delta);
    const namesText = names.join('と');
    sentences.push(`${chancePrefix}${targetLabel}の${namesText}が${stage}段階${dir}`);
  });
  return sentences;
}

// [確率, statusId] → "相手をどくにする" / "20%で自分がやけどになる" のような1文（無ければnull）
function describeStatus(statusData, targetLabel) {
  if (!statusData) return null;
  const chance = statusData[0] ?? 100;
  const statusId = statusData[1];
  const statusName = STATUS_JP[statusId];
  if (!statusName) return null;
  const chancePrefix = chance >= 100 ? '' : `${chance}%で`;
  return `${chancePrefix}${targetLabel}を${statusName}にする`;
}

// 技オブジェクト（buildMoveObjectの戻り値。selfRank/oppRank等を持つ）から、
// 効果説明の文を自動生成して改行区切りで返す。何も無ければ「追加効果はない」。
function describeMoveEffect(m) {
  if (!m) return '';
  const lines = [];

  if (m.flinchChance > 0) lines.push(`${m.flinchChance}%で怯ませる`);

  describeRankChange(m.selfRank, '自分').forEach((s) => lines.push(s));
  describeRankChange(m.oppRank, '相手').forEach((s) => lines.push(s));

  const selfStatusLine = describeStatus(m.selfStatus, '自分');
  if (selfStatusLine) lines.push(selfStatusLine);
  const oppStatusLine = describeStatus(m.oppStatus, '相手');
  if (oppStatusLine) lines.push(oppStatusLine);

  if (m.drainRatio) lines.push(`与えたダメージの${Math.round(m.drainRatio * 100)}%を吸収する`);
  if (m.recoilRatio) lines.push(`与えたダメージの${Math.round(m.recoilRatio * 100)}%の反動を受ける`);
  if (m.selfDestruct) lines.push('自分はひんしになる');
  if (m.chargeTurn) lines.push('1ターン目に溜め、2ターン目に繰り出す');
  if (m.callRandomMove) lines.push('自分の技の中からランダムに1つが繰り出される');

  if (lines.length === 0) return '追加効果はない';
  return lines.join('\n');
}

// 技分類アイコン（物理／特殊／変化）。戦闘中の技メニューと同じ MOVE_CATEGORY_JP を使う。
const TR_MOVE_CATEGORY_ICON = {
  physical: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 2 3 7v10l9 5 9-5V7z" opacity="0.9"/></svg>',
  special: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2.4"/><circle cx="12" cy="12" r="3" fill="currentColor"/></svg>',
  status: '<svg viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="2.2"><path d="M4 12c2-4 6-4 8 0s6 4 8 0"/><path d="M4 17c2-4 6-4 8 0s6 4 8 0"/></g></svg>',
};
function trMoveCategoryIconHtml(category) {
  return TR_MOVE_CATEGORY_ICON[category] || TR_MOVE_CATEGORY_ICON.status;
}

// タイプ名バッジ（アイコン付き）。ポケモンのタイプ表示（ヘッダー・選出/交換カード等）で共通使用する。
function typeChipHtml(type) {
  const id = TYPE_ID[type];
  const iconHtml = id !== undefined
    ? `<img src="./type${id}.png" alt="" class="type-chip-icon" onerror="this.style.display='none'">`
    : '';
  return `<span class="type-chip ${TYPE_CLASS(type)}">${iconHtml}${typeJp(type)}</span>`;
}

// 状態異常（まひ・やけど等）とこんらんを、両方かかっていれば両方まとめて返す。
// 例: [{key:'status1', label:'まひ'}, {key:'confuse', label:'こんらん'}]
function activeStatusBadges(poke) {
  const badges = [];
  if (poke && poke.status && poke.status !== 0) {
    badges.push({ key: 'status' + poke.status, label: STATUS_JP[poke.status] || '' });
  }
  if (poke && poke.confuseTurns > 0) {
    badges.push({ key: 'confuse', label: 'こんらん' });
  }
  return badges;
}

// 10連勝ごと（10戦目・20戦目・30戦目…）に登場するボスの固定ポケモンID
// メガシンカ「なし」の場合はBOSS_SPECIES_ID（1011）、
// メガシンカ「あり」の場合はBOSS_SPECIES_ID_MEGA（1014）が登場する。
const BOSS_SPECIES_ID = 1011;
const BOSS_SPECIES_ID_MEGA = 1014;
// チーム戦（🏆記録が「チーム」に分類されるモード）の10連勝ごとのボス専用ID。
// チーム戦は常にメガありなので、上のBOSS_SPECIES_ID_MEGAの代わりにこちらが使われる。
const BOSS_SPECIES_ID_TEAM = 1031;

/* =========================================================
   プレイヤープロフィール（自分の表示名）
   ホーム画面の名前変更ボタンで設定し、localStorageに永続化する。
   未設定時はデフォルト名「トレーナー(ランダム4桁)」を自動生成して保存する。
   ========================================================= */
const PLAYER_NAME_STORAGE_KEY = 'pokeriere_player_name_v1';
const PLAYER_NAME_MAX_LEN = 10;

function generateAutoPlayerName() {
  const n = 1000 + Math.floor(Math.random() * 9000);
  return `トレーナー${n}`;
}

const PlayerProfile = (() => {
  let name = '';

  function load() {
    try {
      const raw = localStorage.getItem(PLAYER_NAME_STORAGE_KEY);
      if (raw && raw.trim()) { name = raw.trim(); return; }
    } catch (e) {}
    // 未設定 or 読み込み失敗時はデフォルト名を生成して保存しておく
    name = generateAutoPlayerName();
    save();
  }

  function save() {
    try { localStorage.setItem(PLAYER_NAME_STORAGE_KEY, name); } catch (e) {}
  }

  function get() { return name; }

  function set(newName) {
    const trimmed = (newName || '').trim().slice(0, PLAYER_NAME_MAX_LEN);
    name = trimmed || generateAutoPlayerName();
    save();
    return name;
  }

  load();
  return { get, set };
})();

/* =========================================================
   NPC大戦・最大連勝数（メガあり／メガなし／チームを別々に記録）
   NPC戦（対人戦は含まない）で記録した過去最高の連勝数を
   localStorageに永続化する。ホーム画面の記録ボタンから確認できる。
   旧キー（メガ区別なし時代のデータ）は「メガなし」記録として引き継ぐ。
   ========================================================= */
const MAX_WIN_STREAK_STORAGE_KEY_LEGACY = 'pokeriere_max_win_streak_v1';
const MAX_WIN_STREAK_STORAGE_KEY_MEGA_OFF = 'pokeriere_max_win_streak_mega_off_v1';
const MAX_WIN_STREAK_STORAGE_KEY_MEGA_ON = 'pokeriere_max_win_streak_mega_on_v1';
const MAX_WIN_STREAK_STORAGE_KEY_TEAM = 'pokeriere_max_win_streak_team_v1';

const MaxWinStreak = (() => {
  let bestOff = 0;
  let bestOn = 0;
  let bestTeam = 0;

  function load() {
    try {
      const rawOff = localStorage.getItem(MAX_WIN_STREAK_STORAGE_KEY_MEGA_OFF);
      const nOff = Number(rawOff);
      if (Number.isFinite(nOff) && nOff > 0) bestOff = nOff;
      else {
        // メガなし専用キーがまだ無い場合は、旧キー（区別導入前のデータ）を引き継ぐ
        const legacyRaw = localStorage.getItem(MAX_WIN_STREAK_STORAGE_KEY_LEGACY);
        const legacyN = Number(legacyRaw);
        if (Number.isFinite(legacyN) && legacyN > 0) bestOff = legacyN;
      }
      const rawOn = localStorage.getItem(MAX_WIN_STREAK_STORAGE_KEY_MEGA_ON);
      const nOn = Number(rawOn);
      if (Number.isFinite(nOn) && nOn > 0) bestOn = nOn;
      const rawTeam = localStorage.getItem(MAX_WIN_STREAK_STORAGE_KEY_TEAM);
      const nTeam = Number(rawTeam);
      if (Number.isFinite(nTeam) && nTeam > 0) bestTeam = nTeam;
    } catch (e) {}
  }

  // mode: 'on'（メガあり）/ 'off'（メガなし）/ 'team'（チーム）
  function keyForMode(mode) {
    if (mode === 'on') return MAX_WIN_STREAK_STORAGE_KEY_MEGA_ON;
    if (mode === 'team') return MAX_WIN_STREAK_STORAGE_KEY_TEAM;
    return MAX_WIN_STREAK_STORAGE_KEY_MEGA_OFF;
  }

  function save(mode) {
    try {
      const val = mode === 'on' ? bestOn : (mode === 'team' ? bestTeam : bestOff);
      localStorage.setItem(keyForMode(mode), String(val));
    } catch (e) {}
  }

  // megaEnabled省略時は「メガなし」の記録を返す（既存呼び出し互換用）
  function get(megaEnabled) { return megaEnabled ? bestOn : bestOff; }
  function getOff() { return bestOff; }
  function getOn() { return bestOn; }
  function getTeam() { return bestTeam; }

  // 現在の連勝数が過去最高を上回っていれば、該当するモードの記録を更新する。
  // 呼び出し互換のため、第2引数は真偽値（true=メガあり／false=メガなし）か
  // 文字列モード（'on'|'off'|'team'）のどちらでも受け付ける。
  function reportStreak(streak, modeOrMegaEnabled) {
    const mode = (modeOrMegaEnabled === 'team') ? 'team' : (modeOrMegaEnabled ? 'on' : 'off');
    if (mode === 'on') {
      if (streak > bestOn) { bestOn = streak; save('on'); }
    } else if (mode === 'team') {
      if (streak > bestTeam) { bestTeam = streak; save('team'); }
    } else {
      if (streak > bestOff) { bestOff = streak; save('off'); }
    }
  }

  load();
  return { get, getOff, getOn, getTeam, reportStreak };
})();

/* ---- 🏆記録ボタンのランク枠 ----
   メガなし／メガあり／チームNPC戦の最大連勝数（各々の最高記録）を見て、
   どれか1つでも条件を満たせば銅、全て条件を満たせば銀/金/虹、
   という段階でボタンの枠色を変える。
   条件（全て満たす＝3つの記録が全てそのしきい値以上）：
     銅  : どれか1つが5連勝以上
     銀  : 3つとも5連勝以上
     金  : 3つとも10連勝以上
     虹  : 3つとも15連勝以上
*/
function computeRecordBtnRank() {
  const off = MaxWinStreak.getOff();
  const on = MaxWinStreak.getOn();
  const team = MaxWinStreak.getTeam();
  const allAtLeast = (n) => off >= n && on >= n && team >= n;
  const anyAtLeast = (n) => off >= n || on >= n || team >= n;
  if (allAtLeast(15)) return 'rainbow';
  if (allAtLeast(10)) return 'gold';
  if (allAtLeast(5)) return 'silver';
  if (anyAtLeast(5)) return 'bronze';
  return null;
}

function updateRecordBtnRank() {
  const btn = $('btn-title-record');
  if (!btn) return;
  btn.classList.remove('rank-bronze', 'rank-silver', 'rank-gold', 'rank-rainbow');
  const rank = computeRecordBtnRank();
  if (rank) btn.classList.add(`rank-${rank}`);
}

/* =========================================================
   戦績履歴（直近30戦）
   NPC戦・対人戦どちらの結果も記録する。localStorageに永続化。
   1番上（配列の先頭）が最新の試合になるよう unshift で追加する。
   ========================================================= */
const BATTLE_HISTORY_STORAGE_KEY = 'pokeriere_battle_history_v1';
const BATTLE_HISTORY_MAX_ENTRIES = 30;

const BattleHistory = (() => {
  let entries = [];

  function load() {
    try {
      const raw = localStorage.getItem(BATTLE_HISTORY_STORAGE_KEY);
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) entries = parsed;
    } catch (e) {}
  }

  function save() {
    try { localStorage.setItem(BATTLE_HISTORY_STORAGE_KEY, JSON.stringify(entries)); } catch (e) {}
  }

  function get() { return entries; }

  // entry: { mode: 'npc'|'pvp', mega: boolean, win: boolean,
  //          playerTeam: [{speciesId, name}], oppTeam: [{speciesId, name}] }
  function add(entry) {
    entries.unshift(entry);
    if (entries.length > BATTLE_HISTORY_MAX_ENTRIES) {
      entries.length = BATTLE_HISTORY_MAX_ENTRIES;
    }
    save();
  }

  load();
  return { get, add };
})();

// バトル終了時のチーム構成をスナップショットとして戦績履歴用に整形するヘルパー
function snapshotTeamForHistory(team) {
  return (team || []).map((p) => ({
    speciesId: p.speciesId,
    name: p.species ? p.species.name : '???',
    shiny: !!p.shiny,
    isMega: !!p.isMega,
    megaForm: p.megaForm || null,
    formState: p.formState || null,
    // ---- 詳細ステータス表示用（軽量化のため数値ID中心で保存し、名前や説明文は表示時に引き直す） ----
    level: p.level,
    abilityId: (p.ability && typeof p.ability === 'object') ? p.ability.id : (p.ability != null ? p.ability : (p.abilityId != null ? p.abilityId : null)),
    stats: p.stats ? { hp: p.stats.hp, atk: p.stats.atk, def: p.stats.def, spa: p.stats.spa, spd: p.stats.spd, spe: p.stats.spe } : null,
    evs: Array.isArray(p.evs)
      ? { hp: p.evs[0], atk: p.evs[1], def: p.evs[2], spa: p.evs[3], spd: p.evs[4], spe: p.evs[5] }
      : (p.evs || null),
    moves: (p.moves || []).map((m) => ({ id: m.id, pp: m.pp, maxPp: m.maxPp, locked: !!m.locked })),
    hengenjizaiType: p.hengenjizaiType || null,
    changedType: p.changedType || null,
    removedTypes: (p.removedTypes && p.removedTypes.length) ? p.removedTypes.slice() : [],
  }));
}

const state = {
  playerTeam: [],
  cpuTeam: [],
  playerActive: null,
  cpuActive: null,
  winStreak: 0,
  isBossBattle: false,
  battleBusy: false,
  screen: 'title',
  // ---- マルチプレイ用 ----
  playerName: PlayerProfile.get(),
  opponentName: '',
  roomId: null,
  isHost: false,
  multiplayer: false,
  mpHostEvents: [],
  turnNumber: 1,
  // ---- 対人戦：対戦方式（'random'|'team'）とチーム戦選択中のチーム ----
  mpBattleFormat: 'random',
  mpChosenTeamIdx: -1,
  // ---- メガシンカ（テスト機能） ----
  megaEvolutionEnabled: false, // このバトルでメガシンカ機能が有効かどうか
  // ---- 乱入（メガありNPC戦のみ） ----
  runBattleCount: 0,           // 今のランで「これから戦う」戦の番号（1始まり）。NPC戦の勝利ごとに進む
  intrusionBattleNo: 0,        // 今のランで乱入が起きる戦の番号（3〜5のいずれか）。0＝未決定/なし
  intrusionDone: false,        // 今のランで乱入戦を既に実施済みか（ランごとに1回だけ）
  pendingIntrusionId: null,    // 次の戦いで3匹目として出てくる乱入ボスの種族ID（決まっていればセット）
  isIntrusionBattle: false,    // いま戦っているのが乱入戦かどうか
};

/* =========================================================
   図鑑（ポケデックス）
   NPC戦・対人戦を問わず、手持ちに入って戦った（勝敗は問わない）
   ポケモンの種族IDを記録する。localStorageに永続化する。
   ========================================================= */
const POKEDEX_STORAGE_KEY = 'pokeriere_pokedex_v1';

const Pokedex = (() => {
  let seen = new Set();
  let seenShiny = new Set(); // 色違いを連れて行ったことがある種族ID
  let seenMega = new Set(); // 対戦中に実際にメガシンカさせたことがある種族ID（フォーム違いは "id-X"/"id-Y" のキーで管理）
  let viewShiny = new Set(); // 図鑑で「色違い表示」に切り替えている種族ID（表示状態の記憶）
  // お気に入り登録（最大1つ）。対人戦のルーム画面で、名前の左に表示するアイコンに使う。
  // { speciesId, shiny, mega, megaForm } または null。shiny/mega/megaForm は登録時点の表示状態。
  let favorite = null;

  // メガのキー：X/Yフォームを持つ種族は "id-X"/"id-Y"、単一フォームは "id" のまま。
  function megaKey(speciesId, formKey) {
    return formKey ? `${speciesId}-${formKey}` : `${speciesId}`;
  }

  function load() {
    try {
      const raw = localStorage.getItem(POKEDEX_STORAGE_KEY);
      if (raw) {
        const data = JSON.parse(raw);
        if (Array.isArray(data)) {
          // 旧フォーマット（IDの配列のみ）との後方互換
          seen = new Set(data.map((n) => Number(n)));
          seenShiny = new Set();
          seenMega = new Set();
          viewShiny = new Set();
          favorite = null;
        } else if (data && typeof data === 'object') {
          seen = new Set((data.seen || []).map((n) => Number(n)));
          seenShiny = new Set((data.seenShiny || []).map((n) => Number(n)));
          // 旧フォーマット（種族IDの数値のみ）との後方互換：数値のまま文字列キー化して引き継ぐ
          seenMega = new Set((data.seenMega || []).map((k) => String(k)));
          viewShiny = new Set((data.viewShiny || []).map((n) => Number(n)));
          favorite = (data.favorite && data.favorite.speciesId !== undefined && data.favorite.speciesId !== null)
            ? { speciesId: Number(data.favorite.speciesId), shiny: !!data.favorite.shiny, mega: !!data.favorite.mega, megaForm: data.favorite.megaForm || null }
            : null;
        }
      }
    } catch (e) { seen = new Set(); seenShiny = new Set(); seenMega = new Set(); viewShiny = new Set(); favorite = null; }
  }

  function save() {
    try {
      localStorage.setItem(POKEDEX_STORAGE_KEY, JSON.stringify({
        seen: [...seen], seenShiny: [...seenShiny], seenMega: [...seenMega],
        viewShiny: [...viewShiny], favorite,
      }));
    } catch (e) {}
  }

  // team: state.playerTeam のようなポケモン配列（各要素が speciesId と shiny を持つ）
  function registerTeam(team) {
    if (!Array.isArray(team)) return;
    let changed = false;
    for (const p of team) {
      if (!p || p.speciesId === undefined || p.speciesId === null) continue;
      if (!seen.has(p.speciesId)) { seen.add(p.speciesId); changed = true; }
      if (p.shiny && !seenShiny.has(p.speciesId)) { seenShiny.add(p.speciesId); changed = true; }
    }
    if (changed) save();
  }

  // 対戦中に実際にメガシンカしたポケモンの「メガ形態」を捕獲済みとして記録する。
  // speciesId はメガシンカ前の（＝図鑑での本来の）種族ID、formKey は 'X'/'Y'（フォーム違いが無ければ省略可）。
  function registerMega(speciesId, formKey) {
    if (speciesId === undefined || speciesId === null) return;
    const key = megaKey(speciesId, formKey);
    if (!seenMega.has(key)) {
      seenMega.add(key);
      // メガシンカできた＝そのポケモン自体は既に見ているはずだが、念のため通常捕獲も保証する
      if (!seen.has(speciesId)) seen.add(speciesId);
      save();
    }
  }

  function has(speciesId) { return seen.has(speciesId); }
  function hasShiny(speciesId) { return seenShiny.has(speciesId); }
  // formKey省略時：単一フォーム種族の捕獲判定、またはX/Y種族で「どちらか一方でも」捕獲済みかの判定に使う。
  function hasMega(speciesId, formKey) {
    if (formKey) return seenMega.has(megaKey(speciesId, formKey));
    if (seenMega.has(`${speciesId}`)) return true;
    return seenMega.has(`${speciesId}-X`) || seenMega.has(`${speciesId}-Y`);
  }
  function count() { return seen.size; }

  // 図鑑での表示フォーム（通常/色違い）を切り替える。色違いを連れて行ったことがない
  // 種族には切り替えボタン自体を出さないため、呼び出し側で hasShiny を確認する想定。
  function isViewingShiny(speciesId) { return viewShiny.has(speciesId); }
  function toggleView(speciesId) {
    if (!hasShiny(speciesId)) return isViewingShiny(speciesId);
    if (viewShiny.has(speciesId)) viewShiny.delete(speciesId);
    else viewShiny.add(speciesId);
    save();
    return viewShiny.has(speciesId);
  }

  function getFavorite() { return favorite; }
  function isFavorite(speciesId) { return !!favorite && favorite.speciesId === speciesId; }
  // 登録済みポケモンのみお気に入りにできる（見つけていない種族は不可）。
  // 別のポケモンをお気に入りにすると、前のお気に入りは自動的に消える（最大1つ）。
  // 同じポケモンを再度押した場合は解除する。
  function toggleFavorite(speciesId, shiny, mega, megaForm) {
    if (!has(speciesId)) return favorite;
    if (favorite && favorite.speciesId === speciesId) {
      favorite = null;
    } else {
      favorite = { speciesId, shiny: !!shiny, mega: !!mega, megaForm: megaForm || null };
    }
    save();
    return favorite;
  }

  load();
  return {
    registerTeam, registerMega, has, hasShiny, hasMega, count,
    isViewingShiny, toggleView,
    getFavorite, isFavorite, toggleFavorite,
  };
})();

// 選出/交換カードに載せる「図鑑未登録」マーク。既存の !ボタン（右上）や
// 選出順バッジ（左上）と重ならないよう、右下に小さく表示する。
function pokedexNewBadgeHtml(speciesId) {
  if (Pokedex.has(speciesId)) return '';
  return `<span class="tpc-new-badge">NEW</span>`;
}

/* =========================================================
   アセットプリロード（画像・効果音・BGM）
   ========================================================= */
const AssetPreloader = (() => {
  const imageCache = new Map(); // key: path, value: HTMLImageElement
  const audioBuffers = new Map(); // key: path, value: HTMLAudioElement (decoded/ready)

  function preloadImage(path) {
    if (imageCache.has(path)) return imageCache.get(path);
    const img = new Image();
    img.src = path;
    imageCache.set(path, img);
    return img;
  }

  function preloadAudio(path) {
    if (audioBuffers.has(path)) return audioBuffers.get(path);
    const a = new Audio();
    a.preload = 'auto';
    a.src = path;
    try { a.load(); } catch (e) {}
    audioBuffers.set(path, a);
    return a;
  }

  // 全ポケモン種族の通常/色違い画像を事前ロード
  function preloadAllSpeciesSprites() {
    try {
      const ids = Object.keys(GAME_DATA.species || {});
      ids.forEach((id) => {
        preloadImage(`./${id}.png`);
        preloadImage(`./${id}s.png`);
      });
    } catch (e) {}
    // メガシンカ画像（m{id}.png / m{id}s.png）も、対応する種族のぶんだけ事前ロードしておく。
    // X/Yのように複数フォームを持つ種族は、m{id}x.png / m{id}y.png（各色違い版も）をロードする。
    try {
      const megaData = (typeof MEGA_EVOLUTION_DATA !== 'undefined' && MEGA_EVOLUTION_DATA) || {};
      Object.keys(megaData).forEach((id) => {
        const entry = megaData[id];
        if (entry && entry.forms) {
          ['x', 'y'].forEach((suffix) => {
            preloadImage(`./m${id}${suffix}.png`);
            preloadImage(`./m${id}${suffix}s.png`);
          });
        } else {
          preloadImage(`./m${id}.png`);
          preloadImage(`./m${id}s.png`);
        }
      });
    } catch (e) {}
  }

  // タイプアイコン画像の事前ロード
  function preloadTypeIcons() {
    for (let i = 1; i <= 20; i++) preloadImage(`./type${i}.png`);
  }

  // BGM候補の事前ロード
  // ※ iOS Safari/WebKitには、同時に保持できる<audio>要素（デコーダー）の数に上限があり、
  //   これを超えると既存のAudio要素が予告なく無効化される。
  //   バトルBGM候補は30曲もあり、全曲を毎回事前ロードするとこの上限を超えやすく、
  //   「バトル中、ポケモンの交代あたりで再生中のBGMが突然消える」不具合の主因になっていた
  //   （交代演出やSEの再生でAudio要素の同時使用数がさらに増え、上限を超えてしまうため）。
  //   そのため、軽量なメニュー曲だけを事前ロードし、バトルBGM本編は
  //   実際に再生する1曲だけをその都度ロードする方式に変更する（BattleBgm.start参照）。
  function preloadAudioAssets() {
    preloadAudio('./menu.mp3');
    preloadAudio('./mepa.mp3');
  }

  // マップ背景画像（map1〜map30.png）の事前ロード
  function preloadMapBackgrounds() {
    for (let i = 1; i <= 30; i++) preloadImage(`./map${i}.png`);
  }

  function preloadAll() {
    preloadTypeIcons();
    preloadAudioAssets();
    preloadMapBackgrounds();
    // 種族画像は数が多いので、他の初期化を邪魔しないよう少し遅延して開始
    setTimeout(() => preloadAllSpeciesSprites(), 0);
  }

  return { preloadImage, preloadAudio, preloadAll, audioBuffers };
})();

// バトル開始のたびに、map1〜map30.png からランダムで1枚を背景に設定する
// （NPC戦・対人戦どちらでも共通。画像は事前ロード済みなのですぐ表示される）
function setRandomBattleBackground() {
  const n = 1 + Math.floor(Math.random() * 30);
  const el = $('battle-field-bg');
  if (el) el.style.backgroundImage = `url("./map${n}.png")`;
}

/* ---------------- UIクリック効果音 ---------------- */
// 連打しても遅延なく鳴らせるよう、複数のAudioインスタンスをプールして使い回す
// ※ iOS Safariは<audio>要素の同時保持数の上限が特に厳しいため、プールは必要最小限に抑える
const CLICK_SOUND_POOL_SIZE = 3;
const clickSoundPool = [];
let clickSoundIdx = 0;
function initClickSoundPool() {
  for (let i = 0; i < CLICK_SOUND_POOL_SIZE; i++) {
    const a = new Audio('./click.mp3');
    a.preload = 'auto';
    a.volume = 0.5;
    try { a.load(); } catch (e) {}
    clickSoundPool.push(a);
  }
}
initClickSoundPool();

function playClickSound() {
  const a = clickSoundPool[clickSoundIdx];
  clickSoundIdx = (clickSoundIdx + 1) % clickSoundPool.length;
  a._iosUnlockToken = null; // iOSアンロック処理が後からこのインスタンスを止めないようにする
  try {
    a.currentTime = 0;
    const p = a.play();
    if (p && p.catch) p.catch(() => {});
  } catch (err) {}
}

// クリックが成立した瞬間（＝ボタンをちゃんと押して離した時）だけ鳴らす。
// pointerdown/touchstartだと触れただけで発火してしまうため使わない。
// Audioはプリロード済みのプールから取るので、click発火から再生開始までの遅延はほぼない。
function handleClickSoundTrigger(e) {
  if (!e.target.closest('button')) return;
  playClickSound();
}
document.addEventListener('click', handleClickSoundTrigger, true);

/* ---------------- バトル効果音（タイプ相性／ランク変化） ---------------- */
// click.mp3と同じ「プール方式」で、連続再生してもラグなく鳴らせるようにする。
// ※ iOS Safariは<audio>要素の同時保持数の上限が特に厳しいため、プールは必要最小限に抑える
const BATTLE_SFX_POOL_SIZE = 2;
const battleSfxPools = {};
function getBattleSfxPool(path) {
  if (!battleSfxPools[path]) {
    const pool = [];
    for (let i = 0; i < BATTLE_SFX_POOL_SIZE; i++) {
      const a = new Audio(path);
      a.preload = 'auto';
      a.volume = 0.6;
      try { a.load(); } catch (e) {}
      pool.push(a);
    }
    battleSfxPools[path] = { pool, idx: 0 };
  }
  return battleSfxPools[path];
}
function playBattleSfx(path) {
  const entry = getBattleSfxPool(path);
  const a = entry.pool[entry.idx];
  entry.idx = (entry.idx + 1) % entry.pool.length;
  a._iosUnlockToken = null; // iOSアンロック処理が後からこのインスタンスを止めないようにする
  try {
    a.currentTime = 0;
    const p = a.play();
    if (p && p.catch) p.catch(() => {});
  } catch (err) {}
}
// タイプ相性倍率に応じた効果音（等倍=hit、効果抜群系=supeff、効果今ひとつ系=noteff。4倍・4分の1も同じ扱い）
function playTypeEffectSound(typeMult) {
  if (typeMult > 1) playBattleSfx('./supeff.mp3');
  else if (typeMult > 0 && typeMult < 1) playBattleSfx('./noteff.mp3');
  else if (typeMult === 1) playBattleSfx('./hit.mp3');
  // typeMult === 0（無効）の場合は音を鳴らさない
}
function playRankUpSound() { playBattleSfx('./sup.mp3'); }
function playRankDownSound() { playBattleSfx('./fall.mp3'); }
// click.mp3同様、あらかじめプールを生成しておき初回再生の遅延を防ぐ
['./supeff.mp3', './noteff.mp3', './hit.mp3', './sup.mp3', './fall.mp3'].forEach(getBattleSfxPool);

/* ---------------- バトルBGM ---------------- */
// 曲名リスト（1〜20）。ここに好きな曲名を入れてください。
const BATTLE_BGM_NAMES = {
  1: 'パズドラZ-天地鳴動',
  2: 'ポケリエ-さすらいクロネコ戦',
  3: 'パズドラX-ボスバトル',
  4: '妖怪ウォッチ2-和風な妖怪',
  5: 'ぷよぷよフィーバー-へっぽこ魔王最強伝説',
  6: '大乱闘スマッシュブラザーズX-メタナイトの逆襲(アレンジ)',
  7: '妖怪ウォッチバスターズ-ぬらりひょん',
  8: '妖怪ウォッチバスターズ-大妖魔ぬらねいら',
  9: 'ポケリエ-ののあ戦',
  10: 'ポケリエ-リュウガン戦',
  11: 'ポケモン-決勝！WCS',
  12: 'ポケモン-戦闘！グラジオ(アレンジ)',
  13: 'メタルギア-Encounter(アレンジ)',
  14: 'モンスターハンター-ディノバルド',
  15: 'ポケモン-バトルタワー(剣盾)',
  16: 'ブルーアーカイブ-Cherry Merry Berry',
  17: 'ポケモン-戦闘！ソルガレオ・ルナアーラ(アレンジ)',
  18: 'メタルギアシリーズより',
  19: 'ポケモン-戦闘！パルデア四天王！(アレンジ)',
  20: 'みらくらぱーく！-ド！ド！ド！',
  21: 'Blue Archive-Youre My Princess',
  22: 'モンスターハンター-バルファルク',
  23: 'バイオハザードリベレーションズ-Ride On The Sea',
  24: 'ポケモンZA-カラスバ戦',
  25: 'ポケリエ-「???戦」',
  26: 'ポケモンZA-暴走メガシンカ',
  27: 'カードバトルPVP-ポケフリーナBGM',
  28: '?????',
  29: '妖怪ウォッチ-「VS 赤魔寝鬼・白古魔」',
  30: 'ポケリエ-平和と恐怖',
};
function battleBgmLogLabel(n) {
  if (n === 'BOSS') return 'ポケリエバトルファクトリー - 決闘!!';
  if (n === 'BOSS2') return 'ポケリエ-「亜空の侵略者」';
  const num = String(n).padStart(2, '0');
  const name = BATTLE_BGM_NAMES[n] || '';
  return `BGM${num}「${name}」`;
}

const BattleBgm = (() => {
  let currentAudio = null;
  let currentTrackNum = null;

  function pickTrackPath() {
    const n = rand(1, 30);
    currentTrackNum = n;
    return `./${n}.mp3`;
  }

  // isBoss=true（またはランダム戦ボス）の場合はボス専用BGM（BOSS.mp3）を固定で流す。
  // isBoss==='team' の場合はチーム戦ボス専用BGM（BOSS2.mp3）を流す。
  function start(isBoss) {
    MenuBgm.stop();
    stop();
    const isTeamBoss = isBoss === 'team';
    const path = isTeamBoss ? './BOSS2.mp3' : (isBoss ? './BOSS.mp3' : pickTrackPath());
    if (isTeamBoss) currentTrackNum = 'BOSS2';
    else if (isBoss) currentTrackNum = 'BOSS';
    // BGM候補30曲は事前プリロードしていない（iOSのAudio要素数上限対策のため）。
    // 実際に再生する1曲だけをここでロードする。
    const audio = new Audio(path);
    audio.preload = 'auto';
    audio.loop = true;
    audio.volume = 0.4;
    audio._iosUnlockToken = null; // iOSアンロック処理が後からこのインスタンスを止めないようにする
    currentAudio = audio;
    const p = audio.play();
    if (p && p.catch) {
      p.catch(() => {
        // iOSでブロックされて再生開始に失敗した場合、次にユーザーが画面のどこかを
        // タップした瞬間に自動で再試行する（無音のまま気づかれないのを防ぐ）。
        const retry = () => {
          if (currentAudio !== audio) return; // その間に曲が切り替わっていたら何もしない
          const p2 = audio.play();
          if (p2 && p2.catch) p2.catch(() => {});
        };
        document.addEventListener('pointerdown', retry, { once: true, capture: true });
      });
    }
    return currentTrackNum;
  }

  function stop() {
    if (currentAudio) {
      try {
        currentAudio.pause();
        currentAudio.currentTime = 0;
        // src を空にしてブラウザにデコーダーリソースの解放を促す
        // （iOSはAudio要素の同時保持数に上限があり、明示的な解放が安定動作の助けになる）
        currentAudio.removeAttribute('src');
        currentAudio.load();
      } catch (e) {}
      currentAudio = null;
    }
    currentTrackNum = null;
  }

  // 乱入ボスがメガシンカし始めた時、今流れている戦闘BGMを止めて intrusion.mp3 に切り替える。
  // BGM名の表示（ログ行）は出さない。すでに乱入BGMが鳴っていれば何もしない。
  function switchToIntrusion() {
    if (currentTrackNum === 'INTRUSION' && currentAudio) return;
    stop();
    const audio = new Audio('./intrusion.mp3');
    audio.preload = 'auto';
    audio.loop = true;
    audio.volume = 0.4;
    audio._iosUnlockToken = null;
    currentAudio = audio;
    currentTrackNum = 'INTRUSION';
    const p = audio.play();
    if (p && p.catch) {
      p.catch(() => {
        const retry = () => {
          if (currentAudio !== audio) return;
          const p2 = audio.play();
          if (p2 && p2.catch) p2.catch(() => {});
        };
        document.addEventListener('pointerdown', retry, { once: true, capture: true });
      });
    }
  }

  function getCurrentTrackNum() { return currentTrackNum; }
  function getCurrentAudioIfAny() { return currentAudio; }

  return { start, stop, switchToIntrusion, getCurrentTrackNum, getCurrentAudioIfAny };
})();

/* ---------------- ホーム/選出/ルーム待機中のBGM ---------------- */
// バトル本編（トレーナー戦・対人戦）に入っている間以外、基本的にこれを鳴らし続ける。
// すでに再生中なら再度呼ばれても再生し直さない（画面遷移のたびに音が途切れないように）。
const MenuBgm = (() => {
  let audio = null;
  let playing = false;

  function getAudio() {
    if (audio) return audio;
    const preloaded = AssetPreloader.audioBuffers.get('./menu.mp3');
    audio = preloaded ? preloaded : new Audio('./menu.mp3');
    audio.loop = true;
    audio.volume = 0.4;
    return audio;
  }

  function start() {
    if (playing) return;
    playing = true;
    const a = getAudio();
    a._iosUnlockToken = null; // iOSアンロック処理が後からこのインスタンスを止めないようにする
    const p = a.play();
    if (p && p.catch) {
      p.catch(() => {
        // 再生開始に失敗した場合、次のタップで自動的に再試行する
        const retry = () => {
          if (!playing) return;
          const p2 = a.play();
          if (p2 && p2.catch) p2.catch(() => {});
        };
        document.addEventListener('pointerdown', retry, { once: true, capture: true });
      });
    }
  }

  function stop() {
    playing = false;
    if (audio) {
      try {
        audio.pause();
        audio.currentTime = 0;
      } catch (e) {}
    }
  }

  // バックグラウンド復帰時などに、「鳴っているはずなのに止まっている」状態を検知して再開する
  function resumeIfNeeded() {
    if (!playing || !audio) return;
    if (!audio.paused) return;
    const p = audio.play();
    if (p && p.catch) p.catch(() => {});
  }

  return { start, stop, resumeIfNeeded };
})();

/* ---------------- ショップBGM ---------------- */
// ショップ画面にいる間だけ shop.mp3 に切り替え、閉じたら menu.mp3 に戻す。
const ShopBgm = (() => {
  let audio = null;
  let playing = false;

  function getAudio() {
    if (audio) return audio;
    audio = new Audio('./shop.mp3');
    audio.loop = true;
    audio.volume = 0.4;
    return audio;
  }

  function start() {
    if (playing) return;
    playing = true;
    const a = getAudio();
    const p = a.play();
    if (p && p.catch) p.catch(() => {});
  }

  function stop() {
    playing = false;
    if (audio) {
      try {
        audio.pause();
        audio.currentTime = 0;
      } catch (e) {}
    }
  }

  return { start, stop };
})();

function $(id) { return document.getElementById(id); }

/* ---------------- Fullscreen & orientation ---------------- */
const PC_MIN_WIDTH = 900;
function isPcDevice() {
  const hasTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
  const hasFinePointer = window.matchMedia && window.matchMedia('(pointer: fine)').matches;
  const pointerSaysPc = !hasTouch && hasFinePointer;
  const wideEnough = Math.max(window.innerWidth, window.innerHeight) >= PC_MIN_WIDTH;
  return pointerSaysPc || wideEnough;
}

function isFullscreenActive() {
  return !!(document.fullscreenElement || document.webkitFullscreenElement ||
    document.mozFullScreenElement || document.msFullscreenElement);
}

function requestFullscreenAndLandscape() {
  const el = document.documentElement;
  const reqFs = el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen || el.msRequestFullscreen;
  try {
    if (reqFs) {
      const p = reqFs.call(el);
      if (p && p.then) p.catch(() => {});
    }
  } catch (e) {}
  try {
    if (screen.orientation && screen.orientation.lock) {
      screen.orientation.lock('landscape').catch(() => {});
    }
  } catch (e) {}
}

function checkOrientation() {
  if (isPcDevice()) { $('rotate-hint').classList.remove('show'); return; }
  if (state.screen === 'title') { $('rotate-hint').classList.remove('show'); return; }
  const isPortrait = window.innerHeight > window.innerWidth;
  $('rotate-hint').classList.toggle('show', isPortrait);
}

// ミニゲームの表示/フルスクリーンの切り替えなどの後、ホーム画面(#app)が
// 実際のビューポートより小さいサイズのまま取り残されて白い余白ができることがあるため、
// resize / orientationchange / fullscreenchange のたびに #app のサイズを
// window.innerWidth/innerHeight から強制的に再適用して常に全画面にする。
function getViewportSize() {
  const vv = window.visualViewport;
  const w = (vv && vv.width) || document.documentElement.clientWidth || window.innerWidth;
  const h = (vv && vv.height) || document.documentElement.clientHeight || window.innerHeight;
  return { w, h };
}

// #app のサイズは CSS 側 (position:fixed; inset:0) だけで完全に画面を覆うようにする。
// 以前はここで window.innerWidth/innerHeight を使って #app の width/height を
// px指定で強制していたが、その値が実際の描画領域とズレるブラウザ（Brave等）があり、
// ズレた分だけ html/body の背景色が外周の「白い枠」のように見えてしまう不具合の
// 原因になっていた。inset:0 に完全に委ねることでこの余白を無くす。
function forceAppFullSize() {
  const app = $('app');
  if (!app) return;
  app.style.width = '';
  app.style.height = '';
}

window.addEventListener('resize', checkOrientation);
window.addEventListener('orientationchange', checkOrientation);
window.addEventListener('resize', forceAppFullSize);
window.addEventListener('orientationchange', forceAppFullSize);
document.addEventListener('fullscreenchange', forceAppFullSize);
document.addEventListener('webkitfullscreenchange', forceAppFullSize);
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', forceAppFullSize);
}
forceAppFullSize();

// スマホでOS側の戻る操作や手動操作でフルスクリーンが解除されてしまった場合でも、
// タイトル画面に戻らないと再度全画面にできない問題への対応。
// フルスクリーンが解除された状態で画面のどこをタップしても、
// （PCでは何もせず）そのタップをきっかけに再度フルスクリーン＆横向きロックを試みる。
document.addEventListener('click', () => {
  if (isPcDevice()) return;
  if (isFullscreenActive()) return;
  requestFullscreenAndLandscape();
}, true);

/* ---------------- Screen switch ---------------- */
function showScreen(name) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
  $('screen-' + name).classList.add('active');
  state.screen = name;
  checkOrientation();
  if (name === 'title') { refreshTitleNameLabel(); setMegaLockActive(true); npcTeamEndRun(); state.mpChosenTeamIdx = -1; } // タイトルに戻ったらロック有効に戻す／チーム戦のランも終了
}

/* ---------------- Sprite helpers ---------------- */
// 色違いなら "3s.png" のように末尾にsを付けたファイル名を返す
// ヨワシ（ID1012）が「むれたすがた」の場合は、フォルム違いの画像 "A1012.png"（色違いなら"A1012s.png"）を使う。
// メガシンカ中は先頭に"m"を付けた画像を使う（例：ID9がメガシンカ→"m9.png"、色違いは"m9s.png"）。
// メガリザードンX/Yのように2フォームあるポケモンは、確定したmegaForm（'X'|'Y'）に応じて
// 末尾に小文字のx/yを付ける（例：ID6がメガシンカX→"m6x.png"、Yなら"m6y.png"、色違いは"m6xs.png"）。
function spritePath(poke) {
  if (!poke) return '';
  const isYowashiSchool = poke.speciesId === 1012 && poke.formState === 'school';
  const isAineechuAwakened = poke.speciesId === 1990 && poke.formState === 'awakened';
  const idPart = (isYowashiSchool || isAineechuAwakened) ? `A${poke.speciesId}` : `${poke.speciesId}`;
  const megaFormSuffix = poke.isMega && poke.megaForm ? poke.megaForm.toLowerCase() : '';
  const megaPart = poke.isMega ? `m${idPart}${megaFormSuffix}` : idPart;
  return `./${megaPart}${poke.shiny ? 's' : ''}.png`;
}
function spriteImgTag(poke, cls) {
  const speciesId = poke.speciesId;
  return `<img src="${spritePath(poke)}" class="${cls}" onerror="this.replaceWith(makeFallback(${speciesId}, this.className))">`;
}
function fallbackColor(speciesId) {
  const hue = (speciesId * 47) % 360;
  return `hsl(${hue},55%,58%)`;
}
window.makeFallback = function (speciesId, originalClass) {
  const div = document.createElement('div');
  div.className = 'sprite-fallback ' + originalClass;
  const isOpp = originalClass.includes('sprite-opp');
  const isShop = originalClass.includes('shop-cell-sprite');
  if (isShop) {
    // ショップのカード枠（.shop-cell-imgwrap）にぴったり収まるよう、親要素いっぱいに広げる。
    div.style.width = '100%';
    div.style.height = '100%';
    div.style.display = 'flex';
    div.style.alignItems = 'center';
    div.style.justifyContent = 'center';
    div.style.borderRadius = 'inherit';
    div.style.fontSize = '11px';
  } else {
    div.style.width = isOpp ? '90px' : '116px';
    div.style.height = isOpp ? '90px' : '116px';
    div.style.fontSize = isOpp ? '30px' : '38px';
  }
  div.style.background = fallbackColor(speciesId);
  div.style.fontWeight = '800';
  div.style.color = '#fff';
  div.textContent = '#' + speciesId;
  return div;
};

// 選出/交換カードの名前表示用：メガシンカ可能なポケモンなら名前の先頭に mega.png を付ける。
// MEGA_EVOLUTION_DATA に新しいポケモンを追加するだけで自動的に反映される。
// ただし「メガなし」が選ばれている場合（state.megaEvolutionEnabled === false）は
// このバトルでメガシンカ自体が発生しないため、mega.pngアイコンもX/Y表記も一切出さない。
function tpcNameHtml(poke) {
  const megaAllowed = state.megaEvolutionEnabled;
  const megaIcon = (megaAllowed && canMegaEvolve(poke)) ? `<img src="./mega.png" alt="メガ" class="mega-name-icon" onerror="this.style.display='none'">` : '';
  // X/Yのようにフォームが複数あるポケモンは、選出時点で既に確定しているmegaFormの文字を
  // アイコンの直後・種族名の直前に付ける（例：mega.png + "X" + "リザードン"）。
  const megaFormLabel = (megaAllowed && canMegaEvolve(poke) && poke.megaForm) ? poke.megaForm : '';
  return megaIcon + megaFormLabel + poke.species.name;
}

function renderTeamCard(poke, idx) {
  const t1 = poke.species.type1, t2 = poke.species.type2;
  return `
    <div class="trade-poke-card" data-idx="${idx}">
      <button class="tpc-info-btn" data-info-idx="${idx}" type="button"><span>!</span></button>
      <img src="${spritePath(poke)}" alt="${poke.species.name}" class="tpc-sprite"
           onerror="this.replaceWith(makeTeamCardFallback(${poke.speciesId}))">
      <div class="tpc-name">${tpcNameHtml(poke)}</div>
      <div class="tpc-types">
        ${typeChipHtml(t1)}
        ${t2 ? typeChipHtml(t2) : ''}
      </div>
    </div>
  `;
}
window.makeTeamCardFallback = function (speciesId) {
  const div = document.createElement('div');
  div.className = 'tpc-noimg';
  div.textContent = '#' + speciesId;
  return div;
};

/* ---------------- Message queue ---------------- */
let msgQueue = [];
let msgResolve = null;
const MSG_AUTO_MS = 750;
const LOG_STACK_MAX = 6;
let logLines = [];

// 「ログを見る」オーバーレイ用の履歴（最大30件、古い→新しいの時系列順に描画する）。
const BATTLE_LOG_HISTORY_MAX = 30;
let battleLogHistory = [];
function pushBattleLogHistory(entry) {
  battleLogHistory.push(entry);
  while (battleLogHistory.length > BATTLE_LOG_HISTORY_MAX) battleLogHistory.shift();
}

// ランダムアクトの技変化ログのうち、持ち主がゲスト（対人戦の相手）でメガシンカ済みの場合に、
// ホスト画面には出さず、ゲストの画面にだけ届ける。ゲスト側は通常の msg イベントとして受信して
// 表示・ログ履歴への記録まで行うので、受信側の特別な処理は不要。
function sendPrivateLogToGuestOnly(text) {
  if (!(state.multiplayer && state.isHost)) return;
  Net.pushEvent({
    k: 'msg', t: text,
    h: null, hp: null, f: null, mu: null, sid: null, sh: false, tm: null, rc: null, rs: null,
    mt: null, mi: null, turn: null, wfx: null, mp: null, yf: null, ys: null, yfx: false,
    ac: false, as: null,
    mev: false, mrg: false, msd: null, mt1: null, mt2: null, mab: null, mfm: null,
    pSnap: null, cSnap: null,
  }).catch((e) => { console.warn('[Net.pushEvent] 非公開ログ送信失敗', e); });
}

function queueMessage(text, after, netMeta) {
  msgQueue.push({ text, after });
  // ホスト → ゲストへイベントを即時送信（ホストの演出テンポとゲストの受信をリアルタイム同期させる）。
  // hideFromGuest：ホスト側の持ち主だけに見せる非公開ログ（ランダムアクトの技変化）はゲストへ送らない。
  if (state.multiplayer && state.isHost && !(netMeta && netMeta.hideFromGuest)) {
    const pa = state.playerActive;
    const ca = state.cpuActive;
    // ★undefined混入でFirebaseが例外を投げるとイベント自体が送信されないため、
    // 各フィールドは明示的にnullフォールバックで送る。
    const _n = (v) => (v === undefined ? null : v);
    Net.pushEvent({
      k: 'msg', t: text,
      h: netMeta && netMeta.hit ? netMeta.hit : null,
      hp: netMeta && netMeta.hp !== undefined ? netMeta.hp : null,
      f: netMeta && netMeta.faint ? netMeta.faint : null,
      mu: netMeta && netMeta.moveUse ? netMeta.moveUse : null,
      sid: netMeta && netMeta.speciesId !== undefined ? netMeta.speciesId : null,
      sh: netMeta && netMeta.shiny ? netMeta.shiny : false,
      tm: netMeta && netMeta.typeMult !== undefined ? netMeta.typeMult : null,
      rc: netMeta && netMeta.rankChange ? netMeta.rankChange : null,
      rs: netMeta && netMeta.rankSide ? netMeta.rankSide : null,
      mt: netMeta && netMeta.moveType ? netMeta.moveType : null,
      mi: netMeta && netMeta.moveId !== undefined ? netMeta.moveId : null,
      turn: netMeta && netMeta.turn ? netMeta.turn : null,
      wfx: netMeta && netMeta.weatherFx ? netMeta.weatherFx : null,
      mp: netMeta && netMeta.movePower !== undefined ? netMeta.movePower : null,
      yf: netMeta && netMeta.yowashiForm ? netMeta.yowashiForm : null,
      ys: netMeta && netMeta.yowashiSide ? netMeta.yowashiSide : null,
      yfx: netMeta && netMeta.yowashiFx ? true : false,
      ac: netMeta && netMeta.aineechuForm ? true : false,
      as: netMeta && netMeta.aineechuSide ? netMeta.aineechuSide : null,
      mev: netMeta && netMeta.megaEvolve ? true : false,
      mrg: netMeta && netMeta.megaRing ? true : false,
      msd: netMeta && netMeta.megaSide ? netMeta.megaSide : null,
      // メガシンカで書き換わったタイプ・特性・フォームを、演出再生前にゲスト側の
      // ポケモンオブジェクトへ反映できるよう同梱する（isMega自体はturn-endまで
      // 同期されないため、これが無いと演出中のスプライト差し替えが通常画像のままになる）。
      mt1: netMeta && netMeta.megaEvolve ? _n(netMeta.megaSide === 'player' ? (pa && pa.species.type1) : (ca && ca.species.type1)) : null,
mt2: netMeta && netMeta.megaEvolve ? _n(netMeta.megaSide === 'player' ? (pa && pa.species.type2) : (ca && ca.species.type2)) : null,
mab: netMeta && netMeta.megaEvolve ? _n(netMeta.megaSide === 'player' ? (pa && pa.ability) : (ca && ca.ability)) : null,
mfm: netMeta && netMeta.megaEvolve ? _n(netMeta.megaSide === 'player' ? (pa && pa.megaForm) : (ca && ca.megaForm)) : null,
      pSnap: pa ? { sid: pa.speciesId, hp: pa.currentHp, mhp: pa.maxHp, st: pa.status || 0, cf: pa.confuseTurns || 0, fainted: !!pa.fainted, form: pa.formState || null } : null,
      cSnap: ca ? { sid: ca.speciesId, hp: ca.currentHp, mhp: ca.maxHp, st: ca.status || 0, cf: ca.confuseTurns || 0, fainted: !!ca.fainted, form: ca.formState || null } : null,
    }).catch((e) => { console.warn('[Net.pushEvent] msg送信失敗', e); });
  }
}

// ターン区切り（--ターンN--）の直前に表示する、天候・フィールドの残りターン数メッセージ。
// battleFieldの天候/フィールドが有効な間、毎ターンの区切り前に「あと〇ターン」を知らせる。
// 天候の継続メッセージには weatherFx を添えて、表示のたびに背景演出も再生させる。
function getFieldContinueMessages() {
  const msgs = [];
  if (battleField.weather && battleField.weather !== 'none' && battleField.weatherTurns > 0) {
    const name = WEATHER_JP[battleField.weather] || battleField.weather;
    msgs.push({ text: `${name}が　あと${battleField.weatherTurns}ターン　つづいている！`, weatherFx: battleField.weather });
  }
  if (battleField.terrain && battleField.terrain !== 'none' && battleField.terrainTurns > 0) {
    const name = TERRAIN_JP[battleField.terrain] || battleField.terrain;
    // 天候の継続演出と同様、フィールドも毎ターンの区切り前に背景演出を再生する。
    msgs.push({ text: `${name}が　あと${battleField.terrainTurns}ターン　つづいている！`, weatherFx: battleField.terrain });
  }
  return msgs;
}

// ターン区切り（--ターンN--）をメッセージキューとログ履歴の両方に積む。
// その直前に、天候・フィールドがあと何ターン続きそうかのメッセージも積む。
// netMeta.turn / netMeta.weatherFx を立てて送ることで、ゲスト側でも同じ区切り・演出を再現する。
function queueTurnDivider(turnNumber) {
  getFieldContinueMessages().forEach(({ text: msg, weatherFx }) => {
    queueMessage(
      msg,
      weatherFx ? () => playWeatherEffect(weatherFx) : null,
      weatherFx ? { weatherFx } : null
    );
    pushBattleLogHistory({ text: msg, side: null, kind: 'plain', speciesId: null, shiny: false });
  });
  const text = `--ターン${turnNumber}--`;
  queueMessage(text, null, { turn: true });
  pushBattleLogHistory({ text, side: null, kind: 'turn', speciesId: null, shiny: false });
}

function hideMessageToast() {}
function pushLogLine(text) {
  const stack = $('battle-log-stack');
  const el = document.createElement('div');
  el.className = 'battle-log-line';
  el.innerHTML = text;
  stack.appendChild(el);
  logLines.push(el);
  while (logLines.length > LOG_STACK_MAX) {
    const old = logLines.shift();
    old.classList.add('leaving');
    old.addEventListener('animationend', () => old.remove(), { once: true });
    setTimeout(() => old.remove(), 200);
  }
}
// エフェクト用コールバック（rankFlash/playWeatherEffect等）が万一解決しなかった場合に
// バトル進行自体が完全に止まってしまわないよう、一定時間で強制的に切り上げる安全装置。
function withTimeout(promise, ms) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    Promise.resolve(promise).then(finish, finish);
    setTimeout(finish, ms);
  });
}

function drainMessages() {
  return new Promise((resolve) => {
    async function showNext() {
      if (msgQueue.length === 0) { resolve(); return; }
      const item = msgQueue.shift();
      pushLogLine(item.text);
      if (item.after) { try { await withTimeout(item.after(), 4000); } catch (e) {} }
      let done = false;
      const advance = () => {
        if (done) return;
        done = true;
        msgResolve = null;
        clearTimeout(timer);
        showNext();
      };
      const timer = setTimeout(advance, MSG_AUTO_MS);
      msgResolve = advance;
    }
    showNext();
  });
}
$('battle-log-stack').addEventListener('click', () => { if (msgResolve) msgResolve(); });


/* ---------------- HUD update ---------------- */
function hpBarColor(ratio) {
  if (ratio > 0.5) return getComputedStyle(document.documentElement).getPropertyValue('--accent-hp');
  if (ratio > 0.2) return getComputedStyle(document.documentElement).getPropertyValue('--accent-hp-mid');
  return getComputedStyle(document.documentElement).getPropertyValue('--accent-hp-low');
}

// hpOverride / statusOverride を渡すと、poke自体の最新値ではなくその値でHUDを描画する。
// （ダメージ計算やステータス異常付与が同期的に先に確定してしまう都合上、メガシンカ演出のように
// 「本当はまだこのタイミングでは反映されていないはず」の見た目を保つために使う）
// statusOverride: { status, confuseTurns } の形。省略時はpoke自身の現在値を使う。
function updateHud(poke, prefix, hpOverride, statusOverride) {
  // メガシンカ発動前：canMegaEvolveなら「Xリザードン」のようにX/Yが分かる表記にする
  //   （megaFormは選出時点で既に確定しているので、対戦中もそのまま使える）。
  // メガシンカ発動後（isMega）：mega.pngアイコンのみ表示し、X/Yの文字は出さない。
  let megaIcon = '';
  let megaFormLabel = '';
  if (poke.isMega) {
    // メガシンカ発動後：mega.pngアイコンのみ（X/Y文字は出さない）
    megaIcon = `<img src="./mega.png" alt="メガ" class="mega-name-icon" onerror="this.style.display='none'">`;
  } else if (state.megaEvolutionEnabled && canMegaEvolve(poke) && poke.megaForm) {
    // メガシンカ発動前：アイコンは出さず、X/Yの文字だけ名前に付ける
    // （「メガなし」のバトルではメガシンカ自体が起きないので、この予告表示も出さない）
    megaFormLabel = poke.megaForm;
  }
  $(prefix + '-name').innerHTML = megaIcon + megaFormLabel + poke.species.name;
  $(prefix + '-lv').textContent = levelText(poke, 'Lv');
  const hp = hpOverride === undefined ? poke.currentHp : hpOverride;
  const ratio = Math.max(0, hp / poke.maxHp);
  const bar = $(prefix + '-hpbar');
  const committedWidth = getComputedStyle(bar).width;
  bar.style.width = committedWidth;
  void bar.offsetWidth;
  bar.style.width = (ratio * 100) + '%';
  bar.style.background = hpBarColor(ratio);
  const statusEl = $(prefix + '-status');
  const statusSource = statusOverride
    ? { status: statusOverride.status, confuseTurns: statusOverride.confuseTurns }
    : poke;
  const statusBadges = activeStatusBadges(statusSource);
  statusEl.innerHTML = statusBadges.map((b) =>
    `<span class="hud-status-chip ${b.key === 'confuse' ? 'status-confuse' : 'status-' + statusSource.status}">${b.label}</span>`
  ).join('');
  if (prefix === 'self') {
    $('self-hp-text').textContent = `${hp}/${poke.maxHp}`;
  } else {
    $('opp-hp-percent').textContent = `${Math.ceil(ratio * 100)}%`;
  }
}

function setSprite(poke, side) {
  const wrap = $(side === 'opp' ? 'sprite-opp-wrap' : 'sprite-self-wrap');
  const cls = side === 'opp' ? 'sprite sprite-opp enter-opp' : 'sprite sprite-self enter-self';
  wrap.innerHTML = spriteImgTag(poke, cls);
  if (state.multiplayer && state.isHost) {
    const hostSide = side === 'opp' ? 'cpu' : 'player';
    const team = hostSide === 'player' ? state.playerTeam : state.cpuTeam;
    const idx = team.indexOf(poke);
    Net.pushEvent({
      k: 'sprite', s: hostSide, idx,
      sid: poke.speciesId, n: poke.species.name, lv: poke.level,
      hp: poke.currentHp, mhp: poke.maxHp, st: poke.status || 0, cf: poke.confuseTurns || 0,
    });
  }
}

function flashHit(side) {
  const wrap = $(side === 'opp' ? 'sprite-opp-wrap' : 'sprite-self-wrap');
  const img = wrap.querySelector('img, .sprite-fallback');
  if (!img) return Promise.resolve();
  img.classList.add('hit');
  return new Promise((res) => setTimeout(() => { img.classList.remove('hit'); res(); }, 160));
}

// 能力ランク変化エフェクト（ダイヤモンド・パール風：上昇=赤フラッシュ／下降=青フラッシュ）。
// スプライトと同じ画像をマスクに使い、ポケモンのドット絵の輪郭に沿って光らせる。
// CSSでの中央寄せ（absolute+margin:auto）はスプライトのflex中央配置とズレることがあるため、
// img要素の実際の描画位置・サイズを getBoundingClientRect で取得し、そこに正確に重ねる。
// direction: 'up' | 'down'
const RANK_FX_DURATION_MS = 500;
function rankFlash(side, direction) {
  const wrap = $(side === 'opp' ? 'sprite-opp-wrap' : 'sprite-self-wrap');
  if (!wrap) return Promise.resolve();
  const img = wrap.querySelector('img, .sprite-fallback');
  if (!img) return Promise.resolve();

  const wrapRect = wrap.getBoundingClientRect();
  const imgRect = img.getBoundingClientRect();

  const overlay = document.createElement('div');
  overlay.className = `rank-fx-overlay ${direction === 'up' ? 'rank-fx-up' : 'rank-fx-down'}`;
  // wrap（position:relative の基準）から見た img の相対位置・サイズに正確に合わせる。
  overlay.style.position = 'absolute';
  overlay.style.left = (imgRect.left - wrapRect.left) + 'px';
  overlay.style.top = (imgRect.top - wrapRect.top) + 'px';
  overlay.style.width = imgRect.width + 'px';
  overlay.style.height = imgRect.height + 'px';
  if (img.tagName === 'IMG' && img.src) {
    overlay.style.webkitMaskImage = `url(${img.src})`;
    overlay.style.maskImage = `url(${img.src})`;
  }
  // self側のスプライトは左右反転表示されているため、オーバーレイのマスクも合わせて反転する。
  if (side === 'self') {
    overlay.style.transform = 'scaleX(-1)';
  }
  wrap.appendChild(overlay);

  if (direction === 'up') playRankUpSound();
  else playRankDownSound();

  return new Promise((res) => {
    setTimeout(() => {
      overlay.remove();
      res();
    }, RANK_FX_DURATION_MS);
  });
}
function playFaint(side) {
  const wrap = $(side === 'opp' ? 'sprite-opp-wrap' : 'sprite-self-wrap');
  const img = wrap.querySelector('img, .sprite-fallback');
  if (!img) return Promise.resolve();
  img.classList.add('faint');
  return new Promise((res) => setTimeout(res, 350));
}

/* ---------------- メガシンカ演出 ---------------- */
// 演出タイムライン（合計 3.9秒。呼び出し元のメッセージ処理タイムアウトが4.0秒固定のため、
// 確実にその内側で完了するよう少し余裕を持たせている）：
//   0.00s  前兆フラッシュ＋オーラ立ち上がり、リング/光条/繭が発生。ポケモンの絵は即座に隠す。
//   0.00-3.40s  リング拡散・光条回転・オーラの脈動が繰り返され、繭がじわじわ膨張／収縮。
//   3.40-3.50s  クライマックスの閃光弾け（burst）。
//   3.50s  メガシンカ後の画像に差し替え、姿が光の中から現れる（reveal）。
//   3.50-3.90s  余韻（afterglow）がフェードして演出終了、バトル進行を再開。
const MEGA_FX_TOTAL_MS = 3900;
const MEGA_FX_REVEAL_AT_MS = 3500;
const MEGA_FX_BURST_AT_MS = 3400;
const MEGA_FX_RAY_COUNT = 10;

function playMegaEvolveEffect(side, poke, snapshot) {
  const layer = $('mega-evo-fx-layer');
  const wrap = $(side === 'opp' ? 'sprite-opp-wrap' : 'sprite-self-wrap');
  if (!layer || !wrap || !poke) {
    // レイヤーが無い等の想定外時は、演出を諦めて画像だけ確実に差し替える。
    if (wrap) {
      const img = wrap.querySelector('img, .sprite-fallback');
      if (img && img.tagName === 'IMG') img.src = spritePath(poke);
    }
    return Promise.resolve();
  }
  // メガシンカが実際に起きた瞬間のHP・状態異常のスナップショット。
  // このターンの技実行はrunTurn内で既に同期的に全て終わっているため、poke自身の
  // 現在値を見ると「この演出が始まった後に起きたはずの出来事」まで反映されてしまう。
  // 3.5秒の変身完了時点でも、まだこのターンの結果を見せるべきではないため、
  // 演出中は一貫してこのスナップショットの値でHUDを描画する。
  const hpSnap = snapshot && snapshot.hp !== undefined ? snapshot.hp : poke.currentHp;
  const statusSnap = snapshot ? { status: snapshot.status || 0, confuseTurns: snapshot.confuseTurns || 0 } : null;

  const img = wrap.querySelector('img, .sprite-fallback');
  const layerRect = layer.getBoundingClientRect();
  const targetRect = (img || wrap).getBoundingClientRect();

  // メガシンカ演出中心座標（レイヤー基準の%）。ポケモンのスプライト中心に合わせる。
  const cx = layerRect.width > 0 ? ((targetRect.left + targetRect.width / 2 - layerRect.left) / layerRect.width) * 100 : 50;
  const cy = layerRect.height > 0 ? ((targetRect.top + targetRect.height / 2 - layerRect.top) / layerRect.height) * 100 : 50;
  const ringSize = Math.max(targetRect.width, targetRect.height) * 0.55;
  const rayLen = Math.max(layerRect.width, layerRect.height) * 0.55;
  const burstSize = Math.max(targetRect.width, targetRect.height) * 1.6;

  layer.innerHTML = '';
  layer.style.setProperty('--fx-cx', cx.toFixed(2) + '%');
  layer.style.setProperty('--fx-cy', cy.toFixed(2) + '%');
  layer.classList.add('mega-fx-active');

  // 前兆フラッシュ
  const prelude = document.createElement('div');
  prelude.className = 'mega-fx-prelude-flash';
  layer.appendChild(prelude);

  // 背景オーラ
  const auraBg = document.createElement('div');
  auraBg.className = 'mega-fx-aura-bg';
  layer.appendChild(auraBg);

  // 多重リング（発生タイミングをずらして複数出す）
  const RING_COUNT = 5;
  for (let i = 0; i < RING_COUNT; i++) {
    const ring = document.createElement('div');
    ring.className = 'mega-fx-ring';
    ring.style.setProperty('--fx-ring-size', ringSize.toFixed(0) + 'px');
    ring.style.setProperty('--fx-delay', (i * 0.32).toFixed(2) + 's');
    layer.appendChild(ring);
  }

  // 回転する光条
  const raysWrap = document.createElement('div');
  raysWrap.className = 'mega-fx-rays';
  raysWrap.style.left = cx.toFixed(2) + '%';
  raysWrap.style.top = cy.toFixed(2) + '%';
  for (let i = 0; i < MEGA_FX_RAY_COUNT; i++) {
    const ray = document.createElement('div');
    ray.className = 'mega-fx-ray';
    ray.style.setProperty('--fx-ray-angle', ((360 / MEGA_FX_RAY_COUNT) * i).toFixed(1) + 'deg');
    ray.style.setProperty('--fx-ray-len', rayLen.toFixed(0) + 'px');
    ray.style.animationDelay = (Math.random() * 0.15).toFixed(2) + 's';
    raysWrap.appendChild(ray);
  }
  layer.appendChild(raysWrap);

  // ポケモンの姿を覆い隠す発光の繭（スプライトとほぼ同じ位置・サイズに重ねる）
  const cocoonWrap = document.createElement('div');
  cocoonWrap.className = 'mega-fx-cocoon-wrap';
  cocoonWrap.style.left = (targetRect.left - layerRect.left) + 'px';
  cocoonWrap.style.top = (targetRect.top - layerRect.top) + 'px';
  cocoonWrap.style.width = targetRect.width + 'px';
  cocoonWrap.style.height = targetRect.height + 'px';
  const cocoon = document.createElement('div');
  cocoon.className = 'mega-fx-cocoon';
  cocoonWrap.appendChild(cocoon);
  layer.appendChild(cocoonWrap);

  // 効果音：mepa.mp3（演出頭で1回再生）
  playMegaSfx();

  // ポケモン本体のスプライトは繭の裏に完全に隠す
  if (img) img.classList.add('mega-fx-hidden');

  return new Promise((resolve) => {
    // クライマックスの閃光弾け
    setTimeout(() => {
      const burst = document.createElement('div');
      burst.className = 'mega-fx-burst';
      burst.style.setProperty('--fx-burst-size', burstSize.toFixed(0) + 'px');
      layer.appendChild(burst);
    }, MEGA_FX_BURST_AT_MS);

    // 3.5秒でメガシンカ後の画像に切り替え、姿を現す
    setTimeout(() => {
      if (img && img.tagName === 'IMG') {
        img.src = spritePath(poke);
        img.classList.remove('mega-fx-hidden');
        img.style.setProperty('--mega-reveal-flip', side === 'self' ? 'scaleX(-1)' : 'none');
        img.classList.add('mega-fx-reveal');
        setTimeout(() => img.classList.remove('mega-fx-reveal'), 600);
      } else {
        // フォールバック表示中だった場合も含め、最新のspriteImgTagで再構築する。
        const cls = side === 'opp' ? 'sprite sprite-opp' : 'sprite sprite-self';
        wrap.innerHTML = spriteImgTag(poke, cls);
      }
      updateHud(poke, side, hpSnap, statusSnap);

      // 余韻の光を残しつつ、そのままフェードさせる
      const afterglow = document.createElement('div');
      afterglow.className = 'mega-fx-afterglow';
      layer.appendChild(afterglow);
    }, MEGA_FX_REVEAL_AT_MS);

    // 演出終了：レイヤーを片付けてバトル進行を再開
    setTimeout(() => {
      layer.classList.remove('mega-fx-active');
      layer.innerHTML = '';
      resolve();
    }, MEGA_FX_TOTAL_MS);
  });
}

// メガシンカ効果音（mepa.mp3）。他のバトルSFXと同じプール方式で連打耐性を持たせる。
function playMegaSfx() { playBattleSfx('./mepa.mp3'); }
getBattleSfxPool('./mepa.mp3');


// 本家のように、school化（むれたすがた）は小さな魚が四方から中心に集まって群れになり、
// solo化（たんどくのすがた）は群れが散って一匹に戻る、という見た目の演出。
// withFx=false の場合は演出をスキップし、画像だけを即座に差し替える
//（登場直後など、直前のsetSpriteで既に正しい絵が出ているケースの保険）。
const YOWASHI_FX_FISH_COUNT = 9;
const YOWASHI_FX_GATHER_MS = 850; // school化：collect（CSS animation-durationと合わせる）
const YOWASHI_FX_SCATTER_MS = 700; // solo化：scatter
function playYowashiFormChangeEffect(side, poke, nextForm, withFx) {
  const wrap = $(side === 'opp' ? 'sprite-opp-wrap' : 'sprite-self-wrap');
  if (!wrap || !poke) return Promise.resolve();

  const applySpriteSwap = () => {
    const img = wrap.querySelector('img, .sprite-fallback');
    if (img && img.tagName === 'IMG') {
      img.src = spritePath(poke);
    } else {
      // フォールバック表示中だった場合も含め、確実に最新のspriteImgTagで再構築する。
      const cls = side === 'opp' ? 'sprite sprite-opp' : 'sprite sprite-self';
      wrap.innerHTML = spriteImgTag(poke, cls);
    }
  };

  if (!withFx) {
    applySpriteSwap();
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const fxLayer = document.createElement('div');
    fxLayer.className = 'yowashi-fx-layer';

    const isGather = nextForm === 'school'; // 集まる（むれたすがたへ）/ 散る（たんどくのすがたへ）
    const radius = side === 'opp' ? 70 : 100;
    for (let i = 0; i < YOWASHI_FX_FISH_COUNT; i++) {
      const fish = document.createElement('span');
      fish.className = 'yowashi-fx-fish ' + (isGather ? 'fx-gather' : 'fx-scatter');
      fish.textContent = '🐟';
      const angle = (Math.PI * 2 * i) / YOWASHI_FX_FISH_COUNT + Math.random() * 0.4;
      const dist = radius * (0.75 + Math.random() * 0.5);
      const dx = Math.cos(angle) * dist;
      const dy = Math.sin(angle) * dist;
      fish.style.setProperty('--fx-dx', dx.toFixed(1) + 'px');
      fish.style.setProperty('--fx-dy', dy.toFixed(1) + 'px');
      fish.style.setProperty('--fx-delay', (Math.random() * 0.15).toFixed(2) + 's');
      fxLayer.appendChild(fish);
    }
    wrap.appendChild(fxLayer);

    const swapDelayMs = isGather ? YOWASHI_FX_GATHER_MS * 0.75 : YOWASHI_FX_SCATTER_MS * 0.2;
    const totalMs = isGather ? YOWASHI_FX_GATHER_MS : YOWASHI_FX_SCATTER_MS;

    // 魚が中心に集まりきった（or 散り始めた）タイミングで、実際のスプライト画像を差し替え、
    // 光のフラッシュ演出を重ねる。
    setTimeout(() => {
      applySpriteSwap();
      const img = wrap.querySelector('img, .sprite-fallback');
      if (img) {
        img.classList.add('yowashi-form-flash');
        if (isGather) img.classList.add('yowashi-form-grow');
        setTimeout(() => {
          img.classList.remove('yowashi-form-flash');
          img.classList.remove('yowashi-form-grow');
        }, 550);
      }
    }, swapDelayMs);

    setTimeout(() => {
      fxLayer.remove();
      resolve();
    }, totalMs + 80);
  });
}

/* ---------------- アイニーチュのフォルムチェンジ（めざめすがた化）演出 ---------------- */
// 演出仕様：画面の様々な方向から不気味なほど大量のID1990（アイニーチュ）の分身が
// 中心に群がり寄ってきて、やがて真っ黒なヘドロの塊へと変わり果て、
// そのヘドロが弾けるようにしてA1990.png（めざめすがた）へ変貌する、という
// おぞましい雰囲気の一連の演出。CSSは初回呼び出し時に動的注入するため、
// 既存のスタイルシートを編集しなくてもこの関数単体で完結する。
const AINEECHU_FX_CLONE_COUNT = 14;
const AINEECHU_FX_GATHER_MS = 1400;   // 分身が群がってくる時間
const AINEECHU_FX_SLUDGE_MS = 900;    // ヘドロ化して蠢く時間
const AINEECHU_FX_REVEAL_MS = 650;    // ヘドロが弾けてめざめすがたが現れる時間
const AINEECHU_FX_TOTAL_MS = AINEECHU_FX_GATHER_MS + AINEECHU_FX_SLUDGE_MS + AINEECHU_FX_REVEAL_MS + 150;

let _aineechuFxStyleInjected = false;
function ensureAineechuFxStyle() {
  if (_aineechuFxStyleInjected) return;
  _aineechuFxStyleInjected = true;
  const style = document.createElement('style');
  style.id = 'aineechu-fx-style';
  style.textContent = `
.aineechu-fx-layer {
  position: absolute;
  inset: -60px;
  pointer-events: none;
  z-index: 60;
  overflow: visible;
}
.aineechu-fx-clone {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 46px;
  height: 46px;
  margin: -23px 0 0 -23px;
  background-size: contain;
  background-repeat: no-repeat;
  background-position: center;
  filter: saturate(1.4) brightness(0.85) drop-shadow(0 0 6px rgba(80,0,90,0.7));
  opacity: 0;
  transform: translate(var(--fx-sx), var(--fx-sy)) scale(0.6) rotate(var(--fx-srot));
  animation: aineechu-fx-gather-anim ${AINEECHU_FX_GATHER_MS}ms cubic-bezier(.55,0,.85,.35) forwards;
  animation-delay: var(--fx-delay, 0s);
}
@keyframes aineechu-fx-gather-anim {
  0% {
    opacity: 0;
    transform: translate(var(--fx-sx), var(--fx-sy)) scale(0.55) rotate(var(--fx-srot));
  }
  12% { opacity: 0.95; }
  60% {
    opacity: 1;
    transform: translate(calc(var(--fx-sx) * 0.28), calc(var(--fx-sy) * 0.28)) scale(0.85) rotate(calc(var(--fx-srot) * 0.4));
  }
  100% {
    opacity: 0.9;
    transform: translate(0, 0) scale(0.32) rotate(0deg);
  }
}
.aineechu-fx-sludge-pool {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 10px;
  height: 10px;
  margin: -5px 0 0 -5px;
  border-radius: 46% 54% 61% 39% / 55% 42% 58% 45%;
  background: radial-gradient(circle at 35% 30%, #3a1f3d 0%, #1c0e1f 38%, #060305 72%, #000 100%);
  box-shadow: 0 0 18px 6px rgba(20, 0, 25, 0.85), inset 0 0 14px rgba(120, 0, 130, 0.4);
  opacity: 0;
  animation: aineechu-fx-sludge-grow ${AINEECHU_FX_SLUDGE_MS}ms ease-in-out forwards;
  animation-delay: ${AINEECHU_FX_GATHER_MS}ms;
}
@keyframes aineechu-fx-sludge-grow {
  0% { opacity: 0; width: 10px; height: 10px; margin: -5px 0 0 -5px; border-radius: 46% 54% 61% 39% / 55% 42% 58% 45%; }
  15% { opacity: 1; }
  40% {
    width: 96px; height: 78px; margin: -39px 0 0 -48px;
    border-radius: 58% 42% 39% 61% / 48% 55% 45% 52%;
  }
  70% {
    width: 108px; height: 88px; margin: -44px 0 0 -54px;
    border-radius: 41% 59% 55% 45% / 60% 38% 62% 40%;
  }
  100% {
    width: 100px; height: 84px; margin: -42px 0 0 -50px;
    border-radius: 50% 50% 48% 52% / 52% 48% 55% 45%;
    opacity: 1;
  }
}
.aineechu-fx-sludge-pool::before, .aineechu-fx-sludge-pool::after {
  content: '';
  position: absolute;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(90,10,100,0.55) 0%, rgba(0,0,0,0) 70%);
  animation: aineechu-fx-bubble 1.1s ease-in-out infinite;
}
.aineechu-fx-sludge-pool::before { width: 22px; height: 22px; left: 15%; top: 20%; animation-delay: 0.1s; }
.aineechu-fx-sludge-pool::after { width: 16px; height: 16px; right: 18%; bottom: 15%; animation-delay: 0.5s; }
@keyframes aineechu-fx-bubble {
  0%, 100% { transform: scale(0.7); opacity: 0.5; }
  50% { transform: scale(1.25); opacity: 0.95; }
}
.aineechu-fx-drip {
  position: absolute;
  bottom: -6px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #0c0510;
  box-shadow: 0 0 6px 2px rgba(60,0,70,0.7);
  opacity: 0;
  animation: aineechu-fx-drip-fall 1.3s ease-in forwards;
}
@keyframes aineechu-fx-drip-fall {
  0% { opacity: 0; transform: translateY(0) scaleY(0.6); }
  20% { opacity: 0.9; }
  100% { opacity: 0; transform: translateY(28px) scaleY(1.4); }
}
.aineechu-fx-burst-particle {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 8px;
  height: 8px;
  margin: -4px 0 0 -4px;
  border-radius: 50%;
  background: radial-gradient(circle, #7a0a86 0%, #1c0620 70%, transparent 100%);
  opacity: 0.95;
  animation: aineechu-fx-burst-fly 550ms ease-out forwards;
}
@keyframes aineechu-fx-burst-fly {
  0% { opacity: 0.95; transform: translate(0,0) scale(1); }
  100% { opacity: 0; transform: translate(var(--fx-bx), var(--fx-by)) scale(0.2); }
}
.aineechu-fx-flash {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(180,0,200,0.55) 0%, rgba(30,0,35,0.15) 55%, transparent 75%);
  opacity: 0;
  animation: aineechu-fx-flash-anim 550ms ease-out forwards;
}
@keyframes aineechu-fx-flash-anim {
  0% { opacity: 0; transform: scale(0.3); }
  30% { opacity: 1; transform: scale(1.1); }
  100% { opacity: 0; transform: scale(1.6); }
}
.aineechu-form-reveal-flash {
  animation: aineechu-fx-reveal-pop 500ms ease-out;
}
@keyframes aineechu-fx-reveal-pop {
  0% { filter: brightness(0.2) saturate(1.6) drop-shadow(0 0 10px rgba(160,0,180,0.9)); transform: scale(0.85); }
  55% { filter: brightness(1.6) saturate(1.2) drop-shadow(0 0 16px rgba(200,60,220,0.9)); transform: scale(1.08); }
  100% { filter: none; transform: scale(1); }
}
`;
  document.head.appendChild(style);
}

// アイニーチュ(ID1990)専用フォルムチェンジ演出：
// 1) 画面の様々な方向から不気味な分身（弱っていく前の自分自身の姿=素の1990.png）が
//    中心のスプライトめがけて群がり寄ってくる
// 2) 群がった分身たちが溶け合い、蠢く黒いヘドロの塊に成り果てる
// 3) ヘドロが弾け、その中からA1990.png（めざめすがた）が姿を現す
// withFx=false の場合は演出をスキップし、画像だけ即座に差し替える。
function playAineechuFormChangeEffect(side, poke, withFx) {
  const wrap = $(side === 'opp' ? 'sprite-opp-wrap' : 'sprite-self-wrap');
  if (!wrap || !poke) return Promise.resolve();

  const applySpriteSwap = () => {
    const img = wrap.querySelector('img, .sprite-fallback');
    if (img && img.tagName === 'IMG') {
      img.src = spritePath(poke);
    } else {
      const cls = side === 'opp' ? 'sprite sprite-opp' : 'sprite sprite-self';
      wrap.innerHTML = spriteImgTag(poke, cls);
    }
  };

  if (!withFx) {
    applySpriteSwap();
    return Promise.resolve();
  }

  ensureAineechuFxStyle();

  // 分身の背景画像には、フォルムチェンジ前の素の姿（色違いなら色違い）を使う。
  const beforeUrl = `./${poke.speciesId}${poke.shiny ? 's' : ''}.png`;

  return new Promise((resolve) => {
    const fxLayer = document.createElement('div');
    fxLayer.className = 'aineechu-fx-layer';

    // 1) 画面の様々な方向（360度・ばらばらな距離）から分身が群がってくる
    const radius = side === 'opp' ? 130 : 170;
    for (let i = 0; i < AINEECHU_FX_CLONE_COUNT; i++) {
      const clone = document.createElement('div');
      clone.className = 'aineechu-fx-clone';
      clone.style.backgroundImage = `url("${beforeUrl}")`;
      const angle = (Math.PI * 2 * i) / AINEECHU_FX_CLONE_COUNT + (Math.random() - 0.5) * 0.6;
      const dist = radius * (0.7 + Math.random() * 0.6);
      const sx = Math.cos(angle) * dist;
      const sy = Math.sin(angle) * dist;
      clone.style.setProperty('--fx-sx', sx.toFixed(1) + 'px');
      clone.style.setProperty('--fx-sy', sy.toFixed(1) + 'px');
      clone.style.setProperty('--fx-srot', ((Math.random() - 0.5) * 260).toFixed(0) + 'deg');
      clone.style.setProperty('--fx-delay', (Math.random() * 0.35).toFixed(2) + 's');
      fxLayer.appendChild(clone);
    }
    wrap.appendChild(fxLayer);

    // 2) 分身が群がりきったタイミングで、本体スプライトを隠し、
    //    代わりに蠢く黒いヘドロの塊を出現させる。
    setTimeout(() => {
      const img = wrap.querySelector('img, .sprite-fallback');
      if (img) img.classList.add('mega-fx-hidden'); // 既存の非表示用クラスを流用
      // 集まった分身の残骸は消し、ヘドロに置き換える
      fxLayer.querySelectorAll('.aineechu-fx-clone').forEach((c) => c.remove());
      const pool = document.createElement('div');
      pool.className = 'aineechu-fx-sludge-pool';
      fxLayer.appendChild(pool);
      // 不気味に滴るヘドロの雫
      const dripCount = 4;
      for (let i = 0; i < dripCount; i++) {
        const drip = document.createElement('div');
        drip.className = 'aineechu-fx-drip';
        drip.style.left = (38 + Math.random() * 24) + '%';
        drip.style.animationDelay = (Math.random() * 0.6).toFixed(2) + 's';
        fxLayer.appendChild(drip);
      }
    }, AINEECHU_FX_GATHER_MS);

    // 3) ヘドロが弾けて、めざめすがた(A1990.png)が姿を現す
    setTimeout(() => {
      fxLayer.querySelectorAll('.aineechu-fx-sludge-pool, .aineechu-fx-drip').forEach((el) => el.remove());

      // 弾け散る黒紫の粒子
      const burstCount = 16;
      for (let i = 0; i < burstCount; i++) {
        const p = document.createElement('div');
        p.className = 'aineechu-fx-burst-particle';
        const angle = Math.random() * Math.PI * 2;
        const dist = 40 + Math.random() * 60;
        p.style.setProperty('--fx-bx', (Math.cos(angle) * dist).toFixed(1) + 'px');
        p.style.setProperty('--fx-by', (Math.sin(angle) * dist).toFixed(1) + 'px');
        fxLayer.appendChild(p);
      }
      const flash = document.createElement('div');
      flash.className = 'aineechu-fx-flash';
      fxLayer.appendChild(flash);

      applySpriteSwap();
      const img = wrap.querySelector('img, .sprite-fallback');
      if (img) {
        img.classList.remove('mega-fx-hidden');
        img.classList.add('aineechu-form-reveal-flash');
        setTimeout(() => img.classList.remove('aineechu-form-reveal-flash'), 550);
      }
    }, AINEECHU_FX_GATHER_MS + AINEECHU_FX_SLUDGE_MS);

    setTimeout(() => {
      fxLayer.remove();
      resolve();
    }, AINEECHU_FX_TOTAL_MS);
  });
}

/* ---------------- 天候発動エフェクト ---------------- */
// ダイヤモンド・パール・プラチナ風に、天候が発動した瞬間に背景演出を出してから
// 次のメッセージ（--ターンN--等）に進む。はれ（sun）は原作同様に演出なし。
const WEATHER_FX_DURATION_MS = 1300;

function clearWeatherFxLayer() {
  const layer = $('weather-fx-layer');
  if (!layer) return;
  layer.className = 'weather-fx-layer';
  layer.innerHTML = '';
}

// DocumentFragmentにまとめて追加してから一度だけDOMへ挿入することで、
// パーティクルを多数生成してもレイアウト再計算が1回で済むようにする。
function buildRainFx(layer) {
  const frag = document.createDocumentFragment();
  const count = 18;
  for (let i = 0; i < count; i++) {
    const drop = document.createElement('div');
    drop.className = 'wfx-rain-drop';
    drop.style.left = Math.round(Math.random() * 100) + '%';
    drop.style.animationDuration = (0.6 + Math.random() * 0.4).toFixed(2) + 's';
    drop.style.animationDelay = (Math.random() * -1).toFixed(2) + 's';
    frag.appendChild(drop);
  }
  layer.appendChild(frag);
}

function buildSandFx(layer) {
  const frag = document.createDocumentFragment();
  const count = 7;
  for (let i = 0; i < count; i++) {
    const band = document.createElement('div');
    band.className = 'wfx-sand-band';
    band.style.top = Math.round(Math.random() * 100) + '%';
    band.style.animationDuration = (0.8 + Math.random() * 0.5).toFixed(2) + 's';
    band.style.animationDelay = (Math.random() * -0.8).toFixed(2) + 's';
    frag.appendChild(band);
  }
  layer.appendChild(frag);
}

function buildSnowFx(layer) {
  const frag = document.createDocumentFragment();
  const count = 14;
  for (let i = 0; i < count; i++) {
    const flake = document.createElement('div');
    flake.className = 'wfx-snow-flake';
    const size = 3 + Math.random() * 3;
    flake.style.width = size.toFixed(1) + 'px';
    flake.style.height = size.toFixed(1) + 'px';
    flake.style.left = Math.round(Math.random() * 100) + '%';
    flake.style.animationDuration = (2.4 + Math.random() * 1.2).toFixed(2) + 's';
    flake.style.animationDelay = (Math.random() * -2).toFixed(2) + 's';
    frag.appendChild(flake);
  }
  layer.appendChild(frag);
}

function buildSunFx(layer) {
  const frag = document.createDocumentFragment();
  const glow = document.createElement('div');
  glow.className = 'wfx-sun-glow';
  frag.appendChild(glow);
  const count = 8;
  for (let i = 0; i < count; i++) {
    const ray = document.createElement('div');
    ray.className = 'wfx-sun-ray';
    ray.style.transform = `rotate(${(i * (360 / count)) + Math.random() * 10}deg)`;
    ray.style.animationDuration = (0.9 + Math.random() * 0.6).toFixed(2) + 's';
    ray.style.animationDelay = (Math.random() * -1).toFixed(2) + 's';
    frag.appendChild(ray);
  }
  layer.appendChild(frag);
}

function buildStarrySkyFx(layer) {
  const frag = document.createDocumentFragment();
  const count = 14;
  for (let i = 0; i < count; i++) {
    const star = document.createElement('div');
    star.className = 'wfx-star';
    const size = 1.5 + Math.random() * 2;
    star.style.width = size.toFixed(1) + 'px';
    star.style.height = size.toFixed(1) + 'px';
    star.style.left = Math.round(Math.random() * 100) + '%';
    star.style.top = Math.round(Math.random() * 65) + '%';
    star.style.animationDuration = (1.2 + Math.random() * 1.2).toFixed(2) + 's';
    star.style.animationDelay = (Math.random() * -1.5).toFixed(2) + 's';
    frag.appendChild(star);
  }
  layer.appendChild(frag);
}

/* ---------------- フィールド（テラス）発動エフェクト ---------------- */
// 天候と同じ weather-fx-layer を使い、足元から沸き立つような演出にする。
function buildGrassyFx(layer) {
  const frag = document.createDocumentFragment();
  const leaves = ['🌿', '🍃'];
  const count = 12;
  for (let i = 0; i < count; i++) {
    const leaf = document.createElement('div');
    leaf.className = 'wfx-grassy-leaf';
    leaf.textContent = leaves[i % leaves.length];
    leaf.style.left = Math.round(Math.random() * 100) + '%';
    leaf.style.animationDuration = (2.2 + Math.random() * 1.4).toFixed(2) + 's';
    leaf.style.animationDelay = (Math.random() * -2).toFixed(2) + 's';
    frag.appendChild(leaf);
  }
  layer.appendChild(frag);
}

function buildElectricFx(layer) {
  const frag = document.createDocumentFragment();
  const count = 16;
  for (let i = 0; i < count; i++) {
    const spark = document.createElement('div');
    spark.className = 'wfx-electric-spark';
    spark.style.left = Math.round(Math.random() * 100) + '%';
    spark.style.animationDuration = (0.5 + Math.random() * 0.5).toFixed(2) + 's';
    spark.style.animationDelay = (Math.random() * -1).toFixed(2) + 's';
    frag.appendChild(spark);
  }
  layer.appendChild(frag);
}

function buildPsychicFx(layer) {
  const frag = document.createDocumentFragment();
  const count = 5;
  for (let i = 0; i < count; i++) {
    const ripple = document.createElement('div');
    ripple.className = 'wfx-psychic-ripple';
    ripple.style.animationDuration = (1.6 + Math.random() * 0.6).toFixed(2) + 's';
    ripple.style.animationDelay = (i * -0.35).toFixed(2) + 's';
    frag.appendChild(ripple);
  }
  layer.appendChild(frag);
}

function buildMistyFx(layer) {
  const frag = document.createDocumentFragment();
  const count = 8;
  for (let i = 0; i < count; i++) {
    const cloud = document.createElement('div');
    cloud.className = 'wfx-misty-cloud';
    const size = 40 + Math.random() * 50;
    cloud.style.width = size.toFixed(0) + 'px';
    cloud.style.height = (size * 0.5).toFixed(0) + 'px';
    cloud.style.left = Math.round(Math.random() * 100) + '%';
    cloud.style.animationDuration = (2.6 + Math.random() * 1.4).toFixed(2) + 's';
    cloud.style.animationDelay = (Math.random() * -2.4).toFixed(2) + 's';
    frag.appendChild(cloud);
  }
  layer.appendChild(frag);
}

function buildMelodyFx(layer) {
  const frag = document.createDocumentFragment();
  const notes = ['🎵', '🎶'];
  const count = 12;
  for (let i = 0; i < count; i++) {
    const note = document.createElement('div');
    note.className = 'wfx-melody-note';
    note.textContent = notes[i % notes.length];
    note.style.left = Math.round(Math.random() * 100) + '%';
    note.style.animationDuration = (2.4 + Math.random() * 1.4).toFixed(2) + 's';
    note.style.animationDelay = (Math.random() * -2.2).toFixed(2) + 's';
    frag.appendChild(note);
  }
  layer.appendChild(frag);
}

// key: 'sun' | 'rain' | 'sand' | 'snow' | 'starrysky'
// 万一DOM操作やタイマーで想定外のことが起きても、呼び出し元(drainMessages等)は
// withTimeout()で保護されているため、ここで例外が出てもバトル進行自体は止まらない。
function playWeatherEffect(key) {
  if (!key) return Promise.resolve();

  try {
    const layer = $('weather-fx-layer');
    if (!layer) return Promise.resolve();

    clearWeatherFxLayer();

    const builders = {
      sun: () => { layer.classList.add('wfx-bg-sun'); buildSunFx(layer); },
      rain: () => { layer.classList.add('wfx-bg-rain'); buildRainFx(layer); },
      sand: () => { layer.classList.add('wfx-bg-sand'); buildSandFx(layer); },
      snow: () => { layer.classList.add('wfx-bg-snow'); buildSnowFx(layer); },
      starrysky: () => { layer.classList.add('wfx-bg-starrysky'); buildStarrySkyFx(layer); },
      grassy: () => { layer.classList.add('wfx-bg-grassy'); buildGrassyFx(layer); },
      electric: () => { layer.classList.add('wfx-bg-electric'); buildElectricFx(layer); },
      psychic: () => { layer.classList.add('wfx-bg-psychic'); buildPsychicFx(layer); },
      misty: () => { layer.classList.add('wfx-bg-misty'); buildMistyFx(layer); },
      melody: () => { layer.classList.add('wfx-bg-melody'); buildMelodyFx(layer); },
    };
    const build = builders[key];
    if (!build) return Promise.resolve();
    build();

    // フェードイン（次フレームでクラス付与してtransitionを効かせる）
    requestAnimationFrame(() => { layer.classList.add('show'); });

    return new Promise((res) => {
      setTimeout(() => {
        try {
          layer.classList.remove('show');
          setTimeout(() => { try { clearWeatherFxLayer(); } catch (e) {} }, 400);
        } catch (e) {}
        res();
      }, WEATHER_FX_DURATION_MS);
    });
  } catch (e) {
    return Promise.resolve();
  }
}

// タイプ技の簡易エフェクト（1:むし〜12:じめん、+こおり）。
// sprite-slot（position:relative）の中に一時的なオーバーレイを差し込み、
// アニメーション終了後に自動で取り除く。
const TYPE_EFFECT_CONFIG = {
  bug:      { emoji: '🍃', cls: 'tfx-bug' },
  dark:     { emoji: '🌑', cls: 'tfx-dark' },
  dragon:   { emoji: '🌀', cls: 'tfx-dragon' },
  electric: { emoji: '⚡', cls: 'tfx-electric' },
  fairy:    { emoji: '✨', cls: 'tfx-fairy' },
  fighting: { emoji: '💥', cls: 'tfx-fighting' },
  fire:     { emoji: '🔥', cls: 'tfx-fire' },
  flying:   { emoji: '🌪️', cls: 'tfx-flying' },
  ghost:    { emoji: '👻', cls: 'tfx-ghost' },
  grass:    { emoji: '🌿', cls: 'tfx-grass' },
  ground:   { emoji: '🪨', cls: 'tfx-ground' },
  ice:      { emoji: '❄️', cls: 'tfx-ice' },
  normal:   { emoji: '⭐', cls: 'tfx-normal' },
  poison:   { emoji: '☠️', cls: 'tfx-poison' },
  psychic:  { emoji: '🔮', cls: 'tfx-psychic' },
  rock:     { emoji: '⛰️', cls: 'tfx-rock' },
  steel:    { emoji: '⚙️', cls: 'tfx-steel' },
  water:    { emoji: '💧', cls: 'tfx-water' },
  sound:    { emoji: '🎵', cls: 'tfx-sound' },
  shine:    { emoji: '🌟', cls: 'tfx-shine' },
};
const TYPE_EFFECT_DURATION_MS = 420;
// 威力がこの値を超える技は、より豪華・派手な演出（big版）で再生する。
const BIG_MOVE_POWER_THRESHOLD = 90;
function playTypeEffect(side, moveType, big) {
  const wrap = $(side === 'opp' ? 'sprite-opp-wrap' : 'sprite-self-wrap');
  if (!wrap) return Promise.resolve();
  // むし〜じめん（+こおり）は本格的なCanvasパーティクル演出。
  // 未対応タイプ（sound/shineなど演出専用の疑似タイプ）は
  // 従来の絵文字オーバーレイにフォールバックする。
  if (window.TypeFX && window.TypeFX.SUPPORTED_TYPES.indexOf(moveType) !== -1) {
    const p = window.TypeFX.play(wrap, moveType, !!big);
    if (p) return p;
  }
  const config = TYPE_EFFECT_CONFIG[moveType];
  if (!config) return Promise.resolve();
  const fx = document.createElement('div');
  fx.className = `type-fx ${config.cls}`;
  fx.textContent = config.emoji;
  wrap.appendChild(fx);
  return new Promise((res) => {
    setTimeout(() => {
      fx.remove();
      res();
    }, TYPE_EFFECT_DURATION_MS);
  });
}

// インフェルノ(480)／メイルストローム(483)／イルミンスール(484)
// ／りゅうせいぐん(53)／かみなり(73)・ルクスノヴァ(79)／ふぶき(235)・ブリザード(236)・ヘイルストーム(237)
// 専用のフルスクリーン演出。スプライト枠に縛られず戦闘画面全体（battle-field）を使う。
// パワージェム(312)・ジェムレーザー(315)・グラベルブレス(317)・ステルスロック(318)は全画面ではなく「自分→相手」へ飛翔する演出のため、被弾側(defSide)を渡して
// 攻撃側スプライト→防御側スプライトの座標をTypeFX側で実測する。
const SPECIAL_MOVE_FX_IDS = [292,300,113,103,218,227,7,24,25,28,284,348,203,222,61,124,32,33,37,173,112,75,76,72,138,123,63,66,153,156,157,353,355,354,253,254,273,277,374,93,480, 483, 132,13,18,233,332,484, 53, 73, 79, 117,172,235, 236, 237, 312, 315, 317, 318];
function playSpecialMoveEffect(moveId, defSide) {
  const wrap = $('special-fx-layer');
  if (!wrap || !window.TypeFX || !window.TypeFX.playSpecial) return Promise.resolve();
  const p = window.TypeFX.playSpecial(wrap, moveId, defSide);
  return p || Promise.resolve();
}

/* ---------------- Command panel rendering ---------------- */
// cmd-panel を空にする前に、必ず act-log / act-watch を cmd-dock 直下へ退避させる共通ヘルパー。
// renderMoveMenu 実行中はこの2つのボタンが panel の子要素になっているため、
// 何も考えずに panel.innerHTML = '' すると、その要素自体が破棄されて
// 以後 $('act-log') / $('act-watch') が二度と取得できなくなる（＝反応しなくなる）。
// panel を空にする箇所は必ずこの関数を経由させること。
function clearCmdPanel() {
  const dock = $('cmd-dock');
  const panel = $('cmd-panel');
  const logBtn = $('act-log');
  const watchBtn = $('act-watch');
  if (dock && panel) {
    if (logBtn && logBtn.parentElement === panel) dock.insertBefore(logBtn, panel);
    if (watchBtn && watchBtn.parentElement === panel) dock.insertBefore(watchBtn, panel);
  }
  if (panel) panel.innerHTML = '';
  const megaDock = $('mega-evo-dock');
  if (megaDock) {
    // わざ・もどるが即座に消えるのと同時に、メガシンカボタンもアニメーションなしで
    // 即座に消す（transitionを一時的に止めてからshowを外す）。
    megaDock.classList.add('instant-hide');
    megaDock.classList.remove('show');
    void megaDock.offsetWidth; // 強制リフロー：instant-hideを確実に反映させる
    megaDock.classList.remove('instant-hide');
  }
}

function renderActionMenu() {
  closeWatchOverlay();
  closeLogOverlay();
  const dock = $('cmd-dock');
  dock.classList.remove('dock-wide');
  const panel = $('cmd-panel');

  // panel を空にする前に act-log / act-watch を安全に退避（詳細はclearCmdPanel参照）。
  clearCmdPanel();

  panel.style.cssText = '';
  panel.className = 'cmd-panel action-menu';
  panel.innerHTML = `
    <button class="neu-btn cmd-btn" id="act-fight">たたかう</button>
    <button class="neu-btn cmd-btn" id="act-switch">ポケモン</button>
  `;
  // cmd-dock 直下での並び順を「降参する→ログを見る→様子を見る→panel」に揃える。
  const logBtn = $('act-log');
  const watchBtn = $('act-watch');
  const surrenderBtn = $('act-surrender');
  if (logBtn && surrenderBtn && logBtn.previousElementSibling !== surrenderBtn) {
    dock.insertBefore(logBtn, panel);
  }
  if (watchBtn && logBtn && watchBtn.previousElementSibling !== logBtn) {
    dock.insertBefore(watchBtn, panel);
  }
  if (surrenderBtn) surrenderBtn.disabled = false;
  setWatchLogButtonsActive(true);
  $('act-watch').onclick = () => openWatchOverlay();
  $('act-fight').addEventListener('click', () => renderMoveMenu());
  $('act-switch').addEventListener('click', () => {
    if (state.playerActive.bindTurns > 0) {
      queueMessage(`${state.playerActive.species.name}はバインドされていて交代できない！`);
      drainMessages().then(() => {});
      return;
    }
    if (isTrappedByShadowStitch(state.playerActive)) {
      queueMessage(`${state.playerActive.species.name}は影を縫い付けられていて交代できない！`);
      drainMessages().then(() => {});
      return;
    }
    if (isTrappedByKagefumi(state.playerActive, state.cpuActive)) {
      queueMessage(`${state.cpuActive.species.name}のかげふみで交代できない！`);
      drainMessages().then(() => {});
      return;
    }
    renderSwitchMenu();
  });
}

// かげぬい：縫い付けた相手（shadowTrappedBy）が場にいる限り、自発的な交代（にげる操作）ができない。
// CPU戦・対人戦の両方で有効（とんぼがえり等の強制交代や瀕死による交代は対象外）。
// 実体は engine.js 側の isTrappedFromSwitching() を正として利用する。
function isTrappedByShadowStitch(self) {
  if (typeof isTrappedFromSwitching !== 'function') return false;
  if (!self || self.fainted) return false;
  // バインドは別途 bindTurns で表示済みなので、ここでは縫い付け由来のみを見る。
  if (self.shadowTrappedBy && !self.shadowTrappedBy.fainted) return true;
  return false;
}

// かげふみ：対人戦のみ、相手が交代できなくなる（とんぼがえり等の強制交代・瀕死時は対象外）
function isTrappedByKagefumi(self, opponent) {
  if (!state.multiplayer) return false;
  if (!opponent || opponent.fainted) return false;
  if (!self || self.fainted) return false;
  return opponent.ability === 121; // かげふみ
}

function isDeaigashiraLockedFor(poke, m) {
  // であいがしらは場に出たそのターンのみ使用可能。1度でも行動すると
  // （であいがしらを使った場合はもちろん、他の技を使った場合も）以降ロックされ、
  // 交代して再度場に出るまで使用できなくなる（本家仕様）。
  // 実際のロック状態は engine.js 側の executeMove/交代処理で管理している
  // poke.deaigashiraLocked を正とする（CPU側のAI選択でも同じ値を参照している）。
  return m.id === 4 && !!poke.deaigashiraLocked;
}

const MOVE_CATEGORY_JP = { physical: '物理', special: '特殊', status: '変化' };
// 技メニュー用：相手（場に出ているポケモン）に対する効果を「◎〇△✕」で返す。
//   ◎ こうかばつぐん(2倍以上) / 〇 こうかあり(等倍) / △ いまひとつ(1倍未満) / ✕ こうかなし(0倍)
// ・対人戦でも相手の特性は見えないため、特性による無効化（ふゆう・ちくでん等）は考慮せず、
//   純粋なタイプ相性のみで判定する。
// ・変化技・威力なしの技は相性の概念がないため null を返す（表示しない）。
// ・スキン系特性/ウェザーボール等による実際に繰り出すタイプ、弓張月等の特殊相性は反映する。
function moveEffectivenessInfo(m, attacker, defender) {
  if (!m || !defender || m.category === 'status') return null;
  if (!(m.power > 0)) return null;
  if (typeof getEffectiveTypes !== 'function' || typeof getTypeEffectiveness !== 'function') return null;
  const defTypes = getEffectiveTypes(defender);
  if (!defTypes || defTypes.length === 0) return null;
  const effType = displayMoveType(attacker, m);
  const mult = getTypeEffectiveness(effType, defTypes[0], defTypes[1], m.id);
  if (mult === 0) return { cls: 'eff-none', mark: '✕', label: 'こうかなし' };
  if (mult >= 2) return { cls: 'eff-super', mark: '◎', label: 'こうかばつぐん' };
  if (mult < 1) return { cls: 'eff-weak', mark: '△', label: 'いまひとつ' };
  return { cls: 'eff-normal', mark: '〇', label: 'こうかあり' };
}

function moveDetailLineHtml(m, attacker, defender) {
  const power = (m.power === null || m.power === undefined) ? '-' : m.power;
  const acc = (m.accuracy === null || m.accuracy === undefined || m.accuracy >= 999) ? '-' : m.accuracy;
  const cat = MOVE_CATEGORY_JP[m.category] || m.category;
  const eff = moveEffectivenessInfo(m, attacker, defender);
  const effHtml = eff ? `<span class="move-eff ${eff.cls}">${eff.mark}${eff.label}</span>` : '';
  // 左：威力/命中/分類（長い時は省略）、右：相性（PPの真下＝右端に寄せる）
  return `<span class="move-row-detail"><span class="move-row-detail-main">威力:${power}　命中:${acc}　分類:${cat}</span>${effHtml}</span>`;
}

/* ---- 対戦中：わざ選択画面の「詳細」ボタンで開く技詳細パネル（画面左に表示） ----
   トレーニング画面の技詳細（tr-msdt-*）と同じ内容（分類・威力・命中・優先度・効果説明）に加え、
   対戦中ならではの情報として、今の相手に対する相性（こうかばつぐん等）も表示する。 */
function battleMoveInfoHtml(m) {
  if (!m) return '';
  const power = (m.power === null || m.power === undefined) ? '-' : m.power;
  const acc = (m.accuracy === null || m.accuracy === undefined || m.accuracy >= 999) ? '-' : m.accuracy;
  const catIcon = trMoveCategoryIconHtml(m.category);
  const catLabel = MOVE_CATEGORY_JP[m.category] || m.category;
  const priority = m.priority || 0;
  const priorityText = priority > 0 ? `優先度+${priority}` : (priority < 0 ? `優先度${priority}` : '優先度+0');
  const desc = describeMoveEffect(m).replace(/\n/g, '<br>');
  const eff = moveEffectivenessInfo(m, state.playerActive, state.cpuActive);
  const effRow = eff
    ? `<div class="bmi-range"><span class="k">相性</span><span class="v move-eff ${eff.cls}">${eff.mark}${eff.label}</span></div>`
    : '';
  return `
    <div class="bmi-name"><span>${m.name}</span></div>
    <div class="bmi-grid">
      <div class="bmi-cell"><span class="k">技分類</span><span class="v">${catIcon}</span><span class="sub">${catLabel}</span></div>
      <div class="bmi-cell"><span class="k">威力</span><span class="v">${power}</span></div>
      <div class="bmi-cell"><span class="k">命中</span><span class="v">${acc}</span></div>
    </div>
    <div class="bmi-range"><span class="k">優先度</span><span class="v">${priorityText}</span></div>
    ${effRow}
    <div class="bmi-desc">${desc}</div>
    <button class="neu-btn party-close-btn bmi-close-btn" id="battle-move-info-close">とじる</button>
  `;
}

function openBattleMoveInfo(m) {
  $('battle-move-info-panel').innerHTML = battleMoveInfoHtml(m);
  $('battle-move-info-overlay').classList.add('show');
  const closeBtn = document.getElementById('battle-move-info-close');
  if (closeBtn) closeBtn.addEventListener('click', () => closeBattleMoveInfo());
}
function closeBattleMoveInfo() {
  $('battle-move-info-overlay').classList.remove('show');
}
// オーバーレイの余白（パネル外）をタップしても閉じられるようにする
$('battle-move-info-overlay').addEventListener('click', (e) => {
  if (e.target.id === 'battle-move-info-overlay') closeBattleMoveInfo();
});

// スキン系特性（スカイスキン等）を持つポケモンは、場に出ている間ノーマル技を
// 常にそのタイプの技として繰り出す。技メニューや詳細画面でのアイコン・タイプ枠の
// 色を、実際に繰り出した時のタイプに合わせてプレビュー表示するための共通ヘルパー。
// 技データ自体（m.type）は書き換えず、表示用のタイプだけをこの関数経由で求める。
function displayMoveType(poke, m) {
  const skinType = (typeof SKIN_TYPE_MAP !== 'undefined') ? SKIN_TYPE_MAP[poke.ability] : null;
  // メガソーラー持ちのウェザーボールは、実際の天候に関わらずほのお（ひでり扱い）で繰り出すため、
  // 技メニューのアイコン・タイプ枠もほのお表示にする。
  if (m.id === 503 && typeof resolveEffectiveMoveType === 'function' && typeof battleField !== 'undefined') {
    return resolveEffectiveMoveType(m, battleField, poke);
  }
  return (skinType && m.type === 'normal') ? skinType : m.type;
}

function renderMoveMenu() {
  const dock = $('cmd-dock');
  dock.classList.add('dock-wide');
  const panel = $('cmd-panel');
  panel.style.cssText = '';
  panel.className = 'cmd-panel move-list with-side-buttons';
  closeBattleMoveInfo(); // 技メニューを開き直す時は、前に開いていたかもしれない詳細パネルを必ず閉じておく
  const poke = state.playerActive;
  // スキン系特性（スカイスキン等）は、自分が場に出ている間ノーマル技を常にその
  // タイプの技として繰り出す特性。技メニューの時点でもアイコンやタイプ枠の色を
  // 実際に繰り出した時のタイプに合わせて表示する（例：スカイスキンならノーマル
  // 技はひこうタイプのアイコン・色で表示する）。
  const displayTypeOf = (m) => displayMoveType(poke, m);
  // げきりん強制中は、その技のみ選択可能（自動選択でもよいが、UIとしては強制技のみ表示）
  const gekirinForced = poke.gekirinTurns > 0 && poke.gekirinMoveId !== null
    ? poke.moves.find(m => m.id === poke.gekirinMoveId)
    : null;
  const moveButtons = poke.moves.map((m, idx) => {
    const deaiLocked = isDeaigashiraLockedFor(poke, m);
    const gekirinLocked = gekirinForced && m.id !== gekirinForced.id;
    const typeLocked = poke.typeLockTurns > 0 && poke.typeLockType === m.type;
    const disabled = m.pp <= 0 || m.locked || deaiLocked || gekirinLocked || typeLocked;
    const dispType = displayTypeOf(m);
    return `
    <div class="neu-btn cmd-btn move-row ${TYPE_CLASS(dispType)}-edge ${disabled ? 'move-row-disabled' : ''}" data-idx="${idx}" role="button" tabindex="0">
      <div class="move-row-top">
        ${typeIconHtml(dispType)}
        <span class="move-row-name">${m.name}</span>
        <button class="move-row-info-btn" type="button" data-info-idx="${idx}" aria-label="わざの詳細">i</button>
        <span class="move-row-pp">PP ${m.pp}/${m.maxPp}</span>
        ${(m.locked || deaiLocked || typeLocked) ? '<span style="color:#ff5d5d;font-size:10px;font-weight:900;">🔒</span>' : ''}
      </div>
      ${moveDetailLineHtml(m, poke, state.cpuActive)}
    </div>
  `;
  }).join('');
  panel.innerHTML = moveButtons + `
    <button class="neu-btn cmd-btn move-row-back" id="act-move-back">もどる</button>
  `;
  panel.querySelectorAll('.move-row[data-idx]').forEach((btn) => {
    if (btn.classList.contains('move-row-disabled')) return;
    btn.addEventListener('click', (e) => {
      if (e.target.closest('.move-row-info-btn')) return; // 詳細ボタンはここでは技を選ばせない
      const idx = parseInt(btn.dataset.idx, 10);
      playerChooseMove(poke.moves[idx]);
    });
  });
  panel.querySelectorAll('.move-row-info-btn[data-info-idx]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.infoIdx, 10);
      openBattleMoveInfo(poke.moves[idx]);
    });
  });
  $('act-move-back').addEventListener('click', () => renderActionMenu());
  // ---- メガシンカ ----
  // このバトルでメガシンカ機能が有効、かつ自分のポケモンがメガシンカ可能な種族で
  // まだメガシンカしていない場合のみ、技パネルとは別枠のボタンを表示する。
  // 本家と同様、ここではまだ実際にメガシンカさせない。ボタンは「予約」のON/OFFを
  // 切り替えるだけで、実際のメガシンカは技を選んでお互いの行動が出そろった後、
  // 素早さ順の直前（runTurn側）で行われる。
  const megaDock = $('mega-evo-dock');
  const showMegaBtn = state.megaEvolutionEnabled && canMegaEvolveNow(poke);
  megaDock.classList.toggle('show', showMegaBtn);
  if (showMegaBtn) {
    const btn = $('act-mega-evolve');
    btn.classList.toggle('selected', !!poke.wantsMegaEvolve);
    btn.onclick = () => {
      poke.wantsMegaEvolve = !poke.wantsMegaEvolve;
      btn.classList.toggle('selected', !!poke.wantsMegaEvolve);
    };
  }
  // 技メニュー表示中は「ログを見る」「様子を見る」を非表示にする（CSS側の
  // .cmd-dock.dock-wide .dock-log-btn / .dock-watch-btn で display:none）。
  setWatchLogButtonsActive(false);
}

/* ---------------- Watch overlay ---------------- */
const RANK_JP = { atk: '攻撃', def: '防御', spa: '特攻', spd: '特防', spe: '素早さ', acc: '命中', eva: '回避' };
const RANK_ORDER = ['atk', 'def', 'spa', 'spd', 'spe', 'acc', 'eva'];
let watchSelectedSide = 'self';

function rankArrowsHtml(v) {
  const MAX = 6;
  const mag = Math.min(MAX, Math.abs(v || 0));
  if (v > 0) {
    const filled = '▲'.repeat(mag);
    const empty = '<span class="dim">' + '△'.repeat(MAX - mag) + '</span>';
    return `<span class="watch-rank-arrows up">${filled}${empty}</span>`;
  }
  if (v < 0) {
    const filled = '▼'.repeat(mag);
    const empty = '<span class="dim">' + '▽'.repeat(MAX - mag) + '</span>';
    return `<span class="watch-rank-arrows down">${filled}${empty}</span>`;
  }
  return `<span class="watch-rank-arrows"><span class="dim">${'△'.repeat(MAX)}</span></span>`;
}

function getEffectiveTypesForDisplay(poke) {
  if (!poke || !poke.species) return [];
  const t1 = poke.species.type1;
  const t2 = poke.species.type2;
  let types = [];
  // へんげんじざい（技を出すと自分がその技のタイプに変化する特性）は、
  // ナナイロレーザー等でセットされるchangedTypeより優先して表示する。
  // engine.js側のgetEffectiveTypes（実際のダメージ計算用）と同じ優先順位に揃える。
  if (poke.hengenjizaiType) {
    types = [poke.hengenjizaiType];
  } else if (poke.changedType) {
    types = [poke.changedType];
  } else {
    if (t1 && !poke.removedTypes.includes(t1)) types.push(t1);
    if (t2 && !poke.removedTypes.includes(t2)) types.push(t2);
  }
  return [...new Set(types)];
}

function typesHtml(poke) {
  if (!poke || !poke.species) return '';
  const types = getEffectiveTypesForDisplay(poke);
  return types.map((t) => `
    <span class="watch-type-chip">
      ${typeIconHtml(t)}
      <span class="watch-type-name">${GAME_DATA.typeKeyToJp[t] || t}</span>
    </span>
  `).join('');
}

function ranksHtml(poke) {
  const ranks = poke && poke.ranks;
  if (!ranks) return `<div class="watch-empty">変化なし</div>`;
  const rows = RANK_ORDER.map((k) => {
    const v = ranks[k] || 0;
    return `<div class="watch-rank-row"><span class="watch-rank-name">${RANK_JP[k]}</span>${rankArrowsHtml(v)}</div>`;
  });
  return rows.join('');
}

function statusBadgeLabel(poke) {
  const badges = activeStatusBadges(poke);
  if (badges.length === 0) return null;
  return badges.map((b) => b.label).join(' ');
}

function typeChangeLabel(poke) {
  if (!poke) return null;
  const parts = [];
  if (poke.hengenjizaiType) {
    parts.push(`タイプ: ${typeJp(poke.hengenjizaiType)}（へんげんじざい）`);
  } else if (poke.changedType) {
    parts.push(`タイプ: ${typeJp(poke.changedType)}（変化）`);
  }
  if (poke.removedTypes && poke.removedTypes.length > 0) {
    parts.push(`タイプ消失: ${poke.removedTypes.map(t => typeJp(t)).join('、')}`);
  }
  if (poke.typeLockTurns > 0 && poke.typeLockType) {
    parts.push(`タイプロック: ${typeJp(poke.typeLockType)} ${poke.typeLockTurns}ターン`);
  }
  return parts.length > 0 ? parts.join('、') : null;
}

function watchSideItemHtml(poke, side, isSelected) {
  const label = side === 'self' ? 'じぶん' : 'あいて';
  const ratio = poke ? Math.max(0, poke.currentHp / poke.maxHp) : 0;
  const iconHtml = poke
    ? `<img src="${spritePath(poke)}" alt="" class="wsi-icon" onerror="this.replaceWith(makeTeamCardFallback(${poke.speciesId}))">`
    : `<div class="wsi-icon">-</div>`;
  const typeLabel = poke ? getEffectiveTypesForDisplay(poke).map(t => typeJp(t)).join('/') : '-';
  return `
    <button class="watch-side-item ${isSelected ? 'active' : ''}" data-side="${side}">
      ${iconHtml}
      <div class="wsi-info">
        <div class="wsi-tag">${label}</div>
        <div class="wsi-name">${poke ? poke.species.name : '-'} <span style="font-size:10px;color:var(--ink-soft);">${typeLabel}</span></div>
        <div class="wsi-hpbar-outer"><div class="wsi-hpbar-inner" style="width:${ratio * 100}%; background:${hpBarColor(ratio)}"></div></div>
      </div>
    </button>
  `;
}

function renderWatchSideList() {
  const self = state.playerActive;
  const opp = state.cpuActive;
  $('watch-side-list').innerHTML = [
    watchSideItemHtml(self, 'self', watchSelectedSide === 'self'),
    watchSideItemHtml(opp, 'opp', watchSelectedSide === 'opp'),
  ].join('');
  $('watch-side-list').querySelectorAll('.watch-side-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      watchSelectedSide = btn.dataset.side;
      renderWatchOverlay();
    });
  });
}

function renderWatchDetail() {
  const poke = watchSelectedSide === 'self' ? state.playerActive : state.cpuActive;
  $('watch-detail-name').textContent = poke ? poke.species.name : '-';
  $('watch-detail-lv').textContent = levelText(poke, 'Lv');
  const ratio = poke ? Math.max(0, poke.currentHp / poke.maxHp) : 0;
  $('watch-detail-hpbar').style.width = `${ratio * 100}%`;
  $('watch-detail-hpbar').style.background = hpBarColor(ratio);
  if (!poke) {
    $('watch-detail-hp-text').textContent = '0/0';
  } else if (watchSelectedSide === 'self') {
    $('watch-detail-hp-text').textContent = `${poke.currentHp}/${poke.maxHp}`;
  } else {
    $('watch-detail-hp-text').textContent = `HP ${Math.ceil(ratio * 100)}%`;
  }
  $('watch-detail-types').innerHTML = poke ? typesHtml(poke) : '';
  $('watch-detail-ranks').innerHTML = ranksHtml(poke);

  const badgeEl = $('watch-detail-status-badge');
  const badgeLabel = statusBadgeLabel(poke);
  if (badgeLabel) {
    badgeEl.textContent = badgeLabel;
    badgeEl.style.display = '';
  } else {
    badgeEl.textContent = '';
    badgeEl.style.display = 'none';
  }

  const typeChangeLabelEl = document.getElementById('watch-detail-type-change');
  if (!typeChangeLabelEl) {
    const el = document.createElement('div');
    el.id = 'watch-detail-type-change';
    el.style.cssText = 'font-size:11px;font-weight:700;color:var(--accent-b);margin-top:4px;';
    $('watch-detail-hp-text').after(el);
  }
  const label = typeChangeLabel(poke);
  document.getElementById('watch-detail-type-change').textContent = label || '';
}

function renderWatchField() {
  const poke = watchSelectedSide === 'self' ? state.playerActive : state.cpuActive;
  const chips = [];

  if (battleField.weather && battleField.weather !== 'none') {
    chips.push(`${WEATHER_JP[battleField.weather] || battleField.weather} ${battleField.weatherTurns}ターン`);
  }
  if (battleField.terrain && battleField.terrain !== 'none') {
    chips.push(`${TERRAIN_JP[battleField.terrain] || battleField.terrain} ${battleField.terrainTurns}ターン`);
  }

  if (battleField.tailwindPlayer > 0 && watchSelectedSide === 'self') {
    chips.push(`おいかぜ ${battleField.tailwindPlayer}ターン`);
  } else if (battleField.tailwindCpu > 0 && watchSelectedSide === 'opp') {
    chips.push(`おいかぜ ${battleField.tailwindCpu}ターン`);
  }

  if (battleField.trickRoom) {
    chips.push(`トリックルーム ${battleField.trickRoomTurns}ターン`);
  }

  const tauntTurns = poke ? poke.tauntTurns || 0 : 0;
  if (tauntTurns > 0) chips.push(`ちょうはつ ${tauntTurns}ターン`);

  if (poke && poke.critRank > 0) chips.push(`きあいだめ`);

  const reflectTurns = watchSelectedSide === 'self' ? battleField.playerReflect : battleField.cpuReflect;
  const lightScreenTurns = watchSelectedSide === 'self' ? battleField.playerLightScreen : battleField.cpuLightScreen;
  if (reflectTurns > 0) chips.push(`リフレクター ${reflectTurns}ターン`);
  if (lightScreenTurns > 0) chips.push(`ひかりのかべ ${lightScreenTurns}ターン`);

  if (poke && poke.shadowTrappedBy && !poke.shadowTrappedBy.fainted) {
    chips.push(`にげられない`);
  }

  if (poke && poke.bindTurns > 0) {
    chips.push(`バインド ${poke.bindTurns}ターン`);
  }

  if (poke && poke.mustRechargeTurns > 0) {
    chips.push(`はんどう：動けない`);
  }

  if (poke && poke.utsusemiTurns > 0) {
    chips.push(`うつせみ ${poke.utsusemiTurns}ターン後に発動`);
  }

  if (poke && poke.izanaiTurns > 0) {
    chips.push(`いざない ${poke.izanaiTurns}ターン後にねむり`);
  }

  if (poke && poke.encoreTurns > 0 && poke.encoreMoveId !== null) {
    const move = poke.moves.find(m => m.id === poke.encoreMoveId);
    chips.push(`アンコール ${move ? move.name : ''} ${poke.encoreTurns}ターン`);
  }

  if (poke && poke.typeLockTurns > 0 && poke.typeLockType) {
    chips.push(`タイプロック: ${typeJp(poke.typeLockType)} ${poke.typeLockTurns}ターン`);
  }

  if (poke && poke.removedTypes && poke.removedTypes.length > 0) {
    chips.push(`タイプ消失: ${poke.removedTypes.map(t => typeJp(t)).join('、')}`);
  }

  if (poke && poke.hengenjizaiType) {
    chips.push(`タイプ変化(へんげんじざい): ${typeJp(poke.hengenjizaiType)}`);
  } else if (poke && poke.changedType) {
    chips.push(`タイプ変化: ${typeJp(poke.changedType)}`);
  }

  const hazardSideKey = watchSelectedSide === 'self' ? 'player' : 'cpu';
  const hz = (typeof hazardState !== 'undefined') ? hazardState[hazardSideKey] : null;
  if (hz && hz.stealthRock) chips.push('ステルスロック');
  if (hz && hz.replugTrap) chips.push('リプループラグ');

  const row = $('watch-status-row');
  row.innerHTML = chips.length
    ? chips.map((c) => `<span class="watch-status-chip">${c}</span>`).join('')
    : `<span class="watch-empty">なし</span>`;
}

function renderWatchOverlay() {
  renderWatchSideList();
  renderWatchDetail();
  renderWatchField();
}

function setWatchLogButtonsActive(active) {
  const watchBtn = $('act-watch');
  const logBtn = $('act-log');
  const surrenderBtn = $('act-surrender');
  watchBtn.disabled = !active;
  if (active) {
    watchBtn.classList.remove('hide-when-acting');
    logBtn.classList.remove('hide-when-acting');
    if (surrenderBtn) surrenderBtn.classList.remove('hide-when-acting');
  } else {
    watchBtn.classList.add('hide-when-acting');
    logBtn.classList.add('hide-when-acting');
    if (surrenderBtn) surrenderBtn.classList.add('hide-when-acting');
  }
}

function openWatchOverlay() {
  watchSelectedSide = 'self';
  renderWatchOverlay();
  $('watch-overlay').classList.add('show');
}
function closeWatchOverlay() {
  $('watch-overlay').classList.remove('show');
}
$('watch-close').addEventListener('click', () => closeWatchOverlay());

/* ---------------- Battle log overlay（ログを見る） ---------------- */
function logEntryHtml(entry) {
  if (entry.kind === 'turn') {
    return `<div class="log-turn-divider">${entry.text}</div>`;
  }
  const sideClass = entry.side ? `side-${entry.side === 'player' ? 'player' : 'cpu'}` : '';
  const kindClass = `kind-${entry.kind}`;
  const tag = entry.kind === 'move' ? 'わざ' : (entry.kind === 'damage' ? 'HP減少' : '');
  let iconHtml = '';
  if (entry.speciesId) {
    const src = `./${entry.speciesId}${entry.shiny ? 's' : ''}.png`;
    iconHtml = `<img src="${src}" class="log-entry-icon" onerror="this.style.visibility='hidden'">`;
  }
  return `
    <div class="log-entry ${sideClass} ${kindClass}">
      ${iconHtml}
      <span class="log-entry-text">${tag ? `<span class="log-entry-tag">${tag}</span>` : ''}${entry.text}</span>
    </div>
  `;
}
function renderLogOverlay() {
  const list = $('log-panel-list');
  if (battleLogHistory.length === 0) {
    list.innerHTML = `<div class="log-panel-empty">まだログがありません</div>`;
    return;
  }
  // 上が古い、下が最新の時系列順で描画する。
  list.innerHTML = battleLogHistory.map((e) => logEntryHtml(e)).join('');
  // 開いた直後は一番下（＝最新）が見えるようにスクロールしておく。
  list.scrollTop = list.scrollHeight;
}
function openLogOverlay() {
  renderLogOverlay();
  $('log-overlay').classList.add('show');
}
function closeLogOverlay() {
  $('log-overlay').classList.remove('show');
}
$('log-close').addEventListener('click', () => closeLogOverlay());
$('act-log').addEventListener('click', () => openLogOverlay());

/* ---------------- Surrender ---------------- */
function openSurrenderOverlay() {
  $('surrender-overlay').classList.add('show');
}
function closeSurrenderOverlay() {
  $('surrender-overlay').classList.remove('show');
}
$('surrender-cancel').addEventListener('click', () => closeSurrenderOverlay());
$('act-surrender').addEventListener('click', () => openSurrenderOverlay());
$('surrender-confirm').addEventListener('click', async () => {
  closeSurrenderOverlay();
  // 二重発火防止：確認後は降参ボタン自体もすぐ隠す
  $('act-surrender').disabled = true;
  if (!state.multiplayer) {
    // CPU戦：即座に敗北判定。技メニュー表示中に降参した場合でも、
    // 残ったコマンドパネルが裏でタップされないよう先に片付ける。
    clearCmdPanel();
    clearTurnTimer();
    $('cmd-dock').classList.remove('dock-wide');
    await endBattle(false);
    return;
  }
  if (Net.isHost) {
    // ホストが降参：自分の敗北として即座に試合を終了する。
    // ゲスト側の降参処理と同様に、技メニュー等がまだ開いたままの場合に
    // 備えてここでコマンドパネルをロックしておく（二重操作や、後ろに
    // 残ったボタンが後からタップされてしまう不具合を防ぐ）。
    clearCmdPanel();
    clearTurnTimer();
    $('cmd-dock').classList.remove('dock-wide');
    setWatchLogButtonsActive(false);
    await endMultiplayerBattleHost(false, true);
  } else {
    // ゲストが降参：ホストへ通知する。ホスト側が試合を終了させると通常の
    // k:'end' イベントが飛んでくるので、以降の自分の敗北UI表示はそちらに任せる。
    // まだ技選択中などでコマンドパネルが残っている場合は、ここでロックして
    // 二重操作や宙に浮いた入力待ちを防ぐ。
    clearCmdPanel();
    clearTurnTimer();
    $('cmd-dock').classList.remove('dock-wide');
    setWatchLogButtonsActive(false);
    await Net.sendSurrender();
  }
});

function renderSwitchMenu() {
  openPartyOverlay('switch');
}

/* ---------------- Party (Pokémon select) overlay ---------------- */
const JA_STAT_NAME = { hp: 'HP', atk: '攻撃', def: '防御', spa: '特攻', spd: '特防', spe: '素早さ' };

function abilityNameById(id) {
  if (id == null) return null;
  const names = (typeof GAME_DATA !== 'undefined' && GAME_DATA.abilityNames) || {};
  return names[id] != null ? names[id] : null;
}
const ABILITY_DESC_BY_ID = {
3: '毎ターン すばやさが あがる',
16: '登場時に相手の攻撃を1段階下げる',
32: '相手のPPを余計に消費させる',
33: 'ほのお・こおりタイプのダメージを半減する',
36: '連続行動できなくなる',
51: '技の命中率が1.3倍になる',
53: '威力60以下の技の威力が1.5倍になる',
56: '技の追加効果が出やすくなる（確率2倍）',
62: 'ノーマルの技がフェアリーになる（威力1.2倍）',
64: 'HP満タン時に受けるダメージが半減する',
65: '能力ランクの変化が逆転する',
66: '技の威力が1.3倍になるが追加効果がなくなる',
67: '相手から能力を下げられない',
68: '自分と同じタイプの技の威力が1.5倍になる',
69: 'お互いの技が必中する',
70: '接触する技（物理技）の威力が1.3倍になる',
71: '変化技を優先的に出せる（優先度+1）',
74: '急所に当たりやすくなる',
75: '相手の特性の効果を無視する',
76: '登場時に相手の特性をコピーする',
77: '効果抜群のダメージを0.75倍に軽減する',
78: '急所ダメージが2.5倍になる',
79: '攻撃が1.5倍になるが命中率が0.8倍になる',
84: 'HP満タン時、飛行技の優先度が+1される',
90: 'ひるみ状態にならない',
91: 'すべての状態異常にならない',
92: '命中ランクが下がらない',
93: '砂嵐時、岩・地面・鋼技の威力が1.3倍になる',
94: '草技を無効化し攻撃が1段階上がる',
95: '毎ターン、ランダムな能力+2、別の能力-1',
97: '技の追加効果を受けない',
98: '能力が下がると攻撃が+2される',
99: '能力が下がると特攻が+2される',
102: '攻撃を受けると防御が+1される',
103: 'ダメージを受けると防御-1、素早さ+2',
104: '瀕死時に相手に最大HPの1/4ダメージ',
19: 'じめんタイプのわざをうけない',
72: 'サウンドタイプの技の威力が1.2倍になる',
73: 'シャインタイプの技の威力が1.2倍になる',
80: 'ノーマルの技がこおりになる（威力1.2倍）',
81: 'ノーマルの技がでんきになる（威力1.2倍）',
82: 'ノーマルの技がドラゴンになる（威力1.2倍）',
83: 'ノーマルの技がエスパーになる（威力1.2倍）',
112: '相手を倒すたびに攻撃が上がる',
113: '相手を倒すたびに特攻が上がる',
133: 'HPが減るとACSが+1、BDが-1',
86: 'きるタイプの技の威力が1.5倍になる',
87: 'かむタイプの技の威力が1.5倍になる',
88: 'はどうタイプの技の威力が1.5倍になる',
89: 'こぶしタイプの技の威力が1.5倍になる',
105: '物理技を受けると30%で相手の技を1つ封じる',
106: '場に出ている間、全員の特性が無効になる',
107: '控えに戻るとHPが最大の1/3回復する',
108: '相手の能力上昇をトレース',
109: 'HP半分で特攻+1',
110: '相手の特性がわかる',
111: '相手のランダムな技を2つログ表示',
126: '相手の優先度+1以上の技を無効化',
127: '物理技のダメージが半減する',
128: '特殊技のダメージが半減する',
129: '初ターンの技威力が1.5倍になる',
132: '自分にかかる能力変化が2倍になる',
134: '毎ターン、エナジースタックを1つ獲得する',
135: '電気技を使う時、全スタック消費して威力上昇（×30）',
136: 'スタック2で素早さ+1、3で防御・特防+2',
137: 'スタック数×0.2倍、技威力が上昇する',
115: '連続技が必ず最大回数当たる',
122: '相手の技をランダム2つログ表示',
123: '相手の壁（リフレクター・ひかりのかべ）を貫通する',
125: '変化技を跳ね返す',
85: '自分の命中率ランクが下がらない',
121: '（対人戦）相手を交代できなくする',
124: '自分がアンコール・ちょうはつ中、攻撃技の威力が1.5倍になる',
  41: 'ピンチに くさのいりょくが あがる',
  42: 'ピンチに ほのおのいりょくが あがる',
  43: 'ピンチに みずのいりょくが あがる',
  44: 'ピンチに むしのいりょくが あがる',
  5: 'HPが 満タンのとき 技を 受けても 一撃で 倒されることが ない',
  45: 'わざの はんどうダメージ をうけない',
  9: 'でんきを うけない',
  10: 'みずを うけない',
  14: 'ほのおを うけない',
  101: 'むしを うけない',
  4: 'わざを きゅうしょに うけない',
  17: 'さわった あいてを キズつける',
  25: 'こうげきが 2ばいになる',
  46: 'とうじょう したときに 5ターンのあいだ てんきを ひでりに する',
  31: 'とうじょう したときに 5ターンのあいだ てんきを すなあらしに する',
  2: 'とうじょう したときに 5ターンのあいだ てんきを あめに する',
  57: 'とうじょう したときに 5ターンのあいだ てんきを ゆきに する',
  138: 'とうじょう したときに 5ターンのあいだ てんきを ほしぞらに する',
  116: 'とうじょう したときに 5ターンのあいだ フィールドを グラスフィールドにする',
  117: 'とうじょう したときに 5ターンのあいだ フィールドを エレキフィールドにする',
  118: 'とうじょう したときに 5ターンのあいだ フィールドを サイコフィールドにする',
  119: 'とうじょう したときに 5ターンのあいだ フィールドを ミストフィールドにする',
  120: 'とうじょう したときに 5ターンのあいだ フィールドを メロディフィールドにする',
  23: 'あめの とき すばやさが 2ばいになる',
  24: 'ひでりの とき すばやさが 2ばいになる',
  59: 'ゆきの とき すばやさが 2ばいになる',
  60: 'すなあらしの とき すばやさが 2ばいになる',
  30: 'あめの とき ターン終了時に すこしずつ HPが かいふくする',
143: 'ドレインわざの かいふくりょうが 1.25倍',
144: 'おたがい きゅうしょ かくりつが 4倍',
145: 'みかたが ひんしになるほど ちからが あがる',
146: 'ひんしになったとき おいかぜを ふかす',
147: 'あいての のうりょくへんかを むしする',
148: 'あいてをたおすたび はやくなる',
149: 'あいての ひかえポケモンが わかる',
139: 'おやこのあいってええなあ',
140: 'こうげきわざをうけると あいてを やけどに させる',
150: 'ターン終了時、自分の技がランダムに変わる',
151: '攻撃を受けると 相手の ねむけをさそう',
152: 'こうげきする ときだけ ひでりと おなじ こうかを うける',
141: 'ノーマルわざを ひこうにし 威力1.2倍',
142: '最初に使用したタイプになる',
  100: 'ゆきの とき こうげき と とくこうが 1.5ばいに あがるが、こうげき したあと じぶんも ダメージを うける',
  96: 'ひでりの とき とくこうが 1.5ばいに あがるが、こうげき したあと じぶんも ダメージを うける',
  6: 'まひ状態に ならない',
  8: 'さわった あいてを 30%の かくりつで まひ状態に する',
  11: 'ねむり状態に ならない',
  39: 'やけど状態の とき こうげきが 1.5ばいに あがる',
  40: 'じょうたいいじょうの とき ぼうぎょが 1.5ばいに あがる',
  54: 'はがねタイプや どくタイプの あいてにも どく状態の わざを あてられる',
  63: 'じょうたいいじょうの とき すばやさが 1.5ばいに あがる',
  131: 'さわった あいてを 50%の かくりつで もうどく状態に する',
  34: 'さわった あいてを 30%の かくりつで やけど状態に する',
};
function abilityDescById(id) {
  if (id == null) return '';
  return ABILITY_DESC_BY_ID[id] || '';
}
function getAbilityInfo(poke) {
  const a = poke.ability;
  if (a && typeof a === 'object') {
    const id = a.id;
    return { name: a.name || abilityNameById(id) || '', desc: a.desc || a.description || abilityDescById(id) };
  }
  if (a != null) {
    const nm = abilityNameById(a);
    if (nm) return { name: nm, desc: abilityDescById(a) };
  }
  if (poke.abilityId != null) {
    const nm = abilityNameById(poke.abilityId);
    if (nm) return { name: nm, desc: abilityDescById(poke.abilityId) };
  }
  const speciesAbilities = poke.species && poke.species.abilities;
  if (Array.isArray(speciesAbilities) && speciesAbilities.length > 0) {
    const nm = abilityNameById(speciesAbilities[0]);
    if (nm) return { name: nm, desc: abilityDescById(speciesAbilities[0]) };
  }
  return null;
}
// ステータス名の左に付けるアイコン（トレーニング画面・ボックス画面と共通のSVG）。
// cls: アイコンを包む span のクラス名（画面ごとにサイズ・色をCSSで変える）
function statIconHtml(key, cls) {
  const svg = (typeof TR_STAT_ICON !== 'undefined' && TR_STAT_ICON[key]) ? TR_STAT_ICON[key] : '';
  return svg ? `<span class="${cls}" aria-hidden="true">${svg}</span>` : '';
}
function getStatBlock(poke, order) {
  const stats = poke.stats || (poke.species && poke.species.baseStats);
  const statOrder = order || ['hp', 'spe', 'atk', 'def', 'spa', 'spd'];
  // 努力値の元データ：
  //  ・本格バトルの編成（チーム戦）のポケモンは「能力ポイント」evPoints（各0〜32・合計66）で振っており、
  //    旧方式の evs は常に0のまま。そのため evPoints を持っている場合はそちらを表示する
  //    （そうしないと、ポイントを振っていても全部「0」と表示されてしまう）。
  //  ・ランダム戦のポケモンは従来どおり evs（配列）を表示する。
  const evsRaw = poke.evPoints || poke.evs || {};
  const evs = Array.isArray(evsRaw)
    ? { hp: evsRaw[0], atk: evsRaw[1], def: evsRaw[2], spa: evsRaw[3], spd: evsRaw[4], spe: evsRaw[5] }
    : evsRaw;
  return statOrder.map((key) => ({
    key,
    label: JA_STAT_NAME[key],
    value: stats && stats[key] != null ? stats[key] : null,
    ev: evs && evs[key] != null ? evs[key] : null,
  }));
}

function partyListItemHtml(p, idx) {
  const isActive = p === state.playerActive;
  const ratio = Math.max(0, p.currentHp / p.maxHp);
  const statusTag = activeStatusBadges(p).map((b) =>
    `<span class="pli-status-tag ${b.key === 'confuse' ? 'status-confuse' : 'status-' + p.status}">${b.label}</span>`
  ).join('');
  let typeChangeText = '';
  if (p.hengenjizaiType) {
    typeChangeText = `→${typeJp(p.hengenjizaiType)}`;
  } else if (p.changedType) {
    typeChangeText = `→${typeJp(p.changedType)}`;
  } else if (p.removedTypes && p.removedTypes.length > 0) {
    typeChangeText = `(${p.removedTypes.map(t => typeJp(t)).join('')}消失)`;
  }
  return `
    <button class="party-list-item ${isActive ? 'active' : ''} ${p.fainted ? 'fainted' : ''}" data-idx="${idx}" ${p.fainted ? 'disabled' : ''}>
      <img src="${spritePath(p)}" alt="" class="pli-icon" onerror="this.replaceWith(makeTeamCardFallback(${p.speciesId}))">
      <div class="pli-info">
        <div class="pli-name">${p.species.name} <span style="font-size:10px;color:var(--accent-b);">${typeChangeText}</span></div>
        <div class="pli-hpbar-outer"><div class="pli-hpbar-inner" style="width:${ratio * 100}%; background:${hpBarColor(ratio)};"></div></div>
        <div class="pli-hp-text">${p.currentHp}/${p.maxHp}</div>
        ${isActive ? '<div class="pli-active-tag">たたかっている</div>' : statusTag}
        <div class="pli-hp-text" style="font-size:8.5px;color:var(--accent-b);"><img src="./energy.png" class="inline-stat-icon" onerror="this.style.visibility='hidden'">: ${p.energyStacks || 0}</div>
      </div>
    </button>
  `;
}

// showMegaPreview: trueの場合、メガシンカ可能なポケモンならタイプ・特性・実数値を
// メガシンカ後のものに差し替えて表示する（poke本体は変更しない、表示専用のプレビュー）。
function partyDetailHtml(p, showMegaPreview) {
  const megaPreview = (showMegaPreview && !p.isMega) ? getMegaPreviewInfo(p) : null;
  const effectiveTypes = megaPreview
    ? [megaPreview.type1, megaPreview.type2].filter((t, i, arr) => t && arr.indexOf(t) === i)
    : getEffectiveTypesForDisplay(p);
  const typeDisplay = effectiveTypes.map(t => typeChipHtml(t)).join('');
  const movesHtml = p.moves.map((m) => {
    const dispType = displayMoveType(p, m);
    return `
    <div class="pd-move-row ${TYPE_CLASS(dispType)}-edge ${m.locked ? 'pd-move-locked' : ''}" style="${m.locked ? 'opacity:0.4;border-left-color:#ff5d5d;' : ''}">
      ${typeIconHtml(dispType)}
      <span class="pd-move-name">${m.name}${m.locked ? ' 🔒' : ''}</span>
      <span class="pd-move-pp">PP ${m.pp}/${m.maxPp}</span>
    </div>
  `;
  }).join('');
  const ability = megaPreview
    ? { name: abilityNameById(megaPreview.ability) || '', desc: abilityDescById(megaPreview.ability) }
    : getAbilityInfo(p);
  const statBlock = megaPreview
    ? ['hp', 'atk', 'def', 'spa', 'spd', 'spe'].map((key) => ({
        key, label: JA_STAT_NAME[key], value: megaPreview.stats[key], ev: null,
      }))
    : getStatBlock(p, ['hp', 'atk', 'def', 'spa', 'spd', 'spe']);
  const statsHtml = statBlock.map((s) => `
    <div class="pd-stat-row ${s.key === 'spe' ? 'pd-stat-spe' : ''}">
      <span class="pd-stat-name">${statIconHtml(s.key, 'pd-stat-ico')}${s.label}</span>
      <span class="pd-stat-values">
        <span class="pd-stat-value">${s.value != null ? s.value : '—'}</span>${s.ev != null ? `<span class="pd-stat-ev">${s.ev}</span>` : ''}
      </span>
    </div>
  `).join('');

  let typeChangeInfo = '';
  if (megaPreview) {
    typeChangeInfo = `<div style="font-size:11px;font-weight:700;color:var(--accent-b);">メガシンカ後のすがたです</div>`;
  } else if (p.hengenjizaiType) {
    typeChangeInfo = `<div style="font-size:11px;font-weight:700;color:var(--accent-b);">タイプ: ${typeJp(p.hengenjizaiType)}（へんげんじざい）</div>`;
  } else if (p.changedType) {
    typeChangeInfo = `<div style="font-size:11px;font-weight:700;color:var(--accent-b);">タイプ: ${typeJp(p.changedType)}（変化）</div>`;
  }
  if (!megaPreview && p.removedTypes && p.removedTypes.length > 0) {
    typeChangeInfo += `<div style="font-size:11px;font-weight:700;color:#ff5d5d;">タイプ消失: ${p.removedTypes.map(t => typeJp(t)).join('、')}</div>`;
  }

  const megaToggleBtn = (!p.isMega && canMegaEvolve(p))
    ? `<button class="pd-mega-toggle ${showMegaPreview ? 'selected' : ''}" id="pd-mega-toggle-btn" type="button" title="メガシンカ後を見る">
        <img src="./mega.png" alt="メガ" onerror="this.style.visibility='hidden'">
      </button>`
    : '';

  return `
    <div class="pd-header">
      <span class="pd-name">${p.species.name}</span>
      ${shouldShowLevel() ? `<span class="pd-lv">Lv${p.level}</span>` : ''}
      ${megaToggleBtn}
      <div class="pd-types">
        ${typeDisplay}
      </div>
    </div>
    ${typeChangeInfo}
    <div class="pd-ability-box">
      <span class="pd-ability-label">特性</span>
      <span class="pd-ability-name">${ability ? ability.name : '—'}</span>
      ${ability && ability.desc ? `<div class="pd-ability-desc">${ability.desc}</div>` : ''}
    </div>
    <div class="pd-body">
      <div class="pd-moves-col">
        <div class="pd-section-title">わざ</div>
        <div class="pd-moves">${movesHtml}</div>
      </div>
      <div class="pd-stats">${statsHtml}</div>
    </div>
  `;
}

// 選出/交換時の「詳細を見る」用：特性を横幅いっぱいに、わざを2列、
// ステータスをわざの隣に配置することで、特性の説明が長くてもスクロールなしで収まるレイアウト。
// showMegaPreview: trueの場合、メガシンカ可能なポケモンならタイプ・特性・実数値を
// メガシンカ後のものに差し替えて表示する（poke本体は変更しない、表示専用のプレビュー）。
function partyDetailHtmlWide(p, showMegaPreview) {
  const megaPreview = (showMegaPreview && !p.isMega) ? getMegaPreviewInfo(p) : null;
  const effectiveTypes = megaPreview
    ? [megaPreview.type1, megaPreview.type2].filter((t, i, arr) => t && arr.indexOf(t) === i)
    : getEffectiveTypesForDisplay(p);
  const typeDisplay = effectiveTypes.map(t => typeChipHtml(t)).join('');
  const movesHtml = p.moves.map((m) => {
    const dispType = displayMoveType(p, m);
    return `
    <div class="pdw-move-row ${TYPE_CLASS(dispType)}-edge ${m.locked ? 'pd-move-locked' : ''}" style="${m.locked ? 'opacity:0.4;border-left-color:#ff5d5d;' : ''}">
      ${typeIconHtml(dispType)}
      <span class="pdw-move-name">${m.name}${m.locked ? ' 🔒' : ''}</span>
      <span class="pdw-move-pp">PP ${m.pp}/${m.maxPp}</span>
    </div>
  `;
  }).join('');
  const ability = megaPreview
    ? { name: abilityNameById(megaPreview.ability) || '', desc: abilityDescById(megaPreview.ability) }
    : getAbilityInfo(p);
  const statBlock = megaPreview
    ? ['hp', 'atk', 'def', 'spa', 'spd', 'spe'].map((key) => ({
        key, label: JA_STAT_NAME[key], value: megaPreview.stats[key], ev: null,
      }))
    : getStatBlock(p, ['hp', 'atk', 'def', 'spa', 'spd', 'spe']);
  const statsHtml = statBlock.map((s) => `
    <div class="pdw-stat-row">
      <span class="pdw-stat-name">${statIconHtml(s.key, 'pdw-stat-ico')}${s.label}</span>
      <span class="pdw-stat-values">
        <span class="pdw-stat-value">${s.value != null ? s.value : '—'}</span>${s.ev != null ? `<span class="pdw-stat-ev">${s.ev}</span>` : ''}
      </span>
    </div>
  `).join('');

  let typeChangeInfo = '';
  if (megaPreview) {
    typeChangeInfo = `<div style="font-size:11px;font-weight:700;color:var(--accent-b);">メガシンカ後のすがたです</div>`;
  } else if (p.hengenjizaiType) {
    typeChangeInfo = `<div style="font-size:11px;font-weight:700;color:var(--accent-b);">タイプ: ${typeJp(p.hengenjizaiType)}（へんげんじざい）</div>`;
  } else if (p.changedType) {
    typeChangeInfo = `<div style="font-size:11px;font-weight:700;color:var(--accent-b);">タイプ: ${typeJp(p.changedType)}（変化）</div>`;
  }
  if (!megaPreview && p.removedTypes && p.removedTypes.length > 0) {
    typeChangeInfo += `<div style="font-size:11px;font-weight:700;color:#ff5d5d;">タイプ消失: ${p.removedTypes.map(t => typeJp(t)).join('、')}</div>`;
  }

  const megaToggleBtn = (!p.isMega && canMegaEvolve(p))
    ? `<button class="pd-mega-toggle ${showMegaPreview ? 'selected' : ''}" id="pdw-mega-toggle-btn" type="button" title="メガシンカ後を見る">
        <img src="./mega.png" alt="メガ" onerror="this.style.visibility='hidden'">
      </button>`
    : '';

  return `
    <div class="pdw-header">
      <span class="pdw-name">${p.species.name}</span>
      ${shouldShowLevel() ? `<span class="pdw-lv">Lv${p.level}</span>` : ''}
      ${megaToggleBtn}
      <div class="pdw-types">
        ${typeDisplay}
      </div>
    </div>
    ${typeChangeInfo}
    <div class="pdw-ability-box">
      <span class="pdw-ability-label">特性</span>
      <span class="pdw-ability-name">${ability ? ability.name : '—'}</span>
      ${ability && ability.desc ? `<div class="pdw-ability-desc">${ability.desc}</div>` : ''}
    </div>
    <div class="pdw-body">
      <div class="pdw-moves">${movesHtml}</div>
      <div class="pdw-stats">${statsHtml}</div>
    </div>
  `;
}

let partySelectedIdx = null;
let partyArmedIdx = null;
let partyMode = 'switch';
let forcedSwitchResolve = null;
let partyDetailShowMega = false; // 「メガシンカ後を見る」トグルの状態（表示専用、poke本体には影響しない）

// 対人チーム戦（お互い6匹から選出した固定パーティーで戦う形式）かどうか。
// この形式の時だけ、交代画面に相手の選出パーティー一覧を並べた拡張UIを出す。
function isTeamBattleMode() {
  return !!state.multiplayer && state.mpBattleFormat === 'team';
}

function openPartyOverlay(mode) {
  partyMode = mode || 'switch';
  partyArmedIdx = null;
  partyDetailShowMega = false;
  if (partyMode === 'forced') {
    const firstAlive = state.playerTeam.findIndex((p) => !p.fainted);
    partySelectedIdx = firstAlive >= 0 ? firstAlive : 0;
  } else {
    partySelectedIdx = state.playerTeam.indexOf(state.playerActive);
  }
  renderPartyOverlay();
  $('party-overlay').classList.add('show');
  $('party-close').style.display = partyMode === 'forced' ? 'none' : '';
}
function closePartyOverlay() {
  $('party-overlay').classList.remove('show');
}

function renderPartyOverlay() {
  const list = $('party-list');
  list.innerHTML = state.playerTeam.map((p, idx) => partyListItemHtml(p, idx)).join('');
  renderPartyDetail();
  renderTeamBattleOppoList();
}

function renderPartyDetail() {
  const idx = partySelectedIdx != null ? partySelectedIdx : 0;
  const p = state.playerTeam[idx];
  $('party-detail').innerHTML = partyDetailHtml(p, partyDetailShowMega);
  const megaBtn = document.getElementById('pd-mega-toggle-btn');
  if (megaBtn) {
    megaBtn.addEventListener('click', () => {
      partyDetailShowMega = !partyDetailShowMega;
      renderPartyDetail();
    });
  }
}

// ---- 対人チーム戦：右側「相手の選出パーティー」一覧 ----
// 選出画面で見えていた6匹プール全員を常に表示する（3匹だけ出すと選出の駆け引きが
// バトル開始時点でバレてしまうため）。実際に選出され、かつ一度でも場に出した個体だけを
// cpuTeam側の生きたデータ（HP・状態異常など）と紐づけて明るく表示し、それ以外
// （選出されなかった3匹／選出されたがまだ出していない個体）はすべて「未参戦」として暗く表示する。
function buildTeamBattleOppoEntries() {
  const pool = mpOpponentFullPool || [];
  const cpuTeam = state.cpuTeam || [];
  const usedCpuIdx = new Set();
  return pool.map((poolMon) => {
    // 同じ種族が複数いても取り違えないよう、未使用のcpuTeam要素から1つだけ対応づける
    let matched = null;
    for (let i = 0; i < cpuTeam.length; i++) {
      if (usedCpuIdx.has(i)) continue;
      if (cpuTeam[i].speciesId === poolMon.speciesId) {
        matched = cpuTeam[i];
        usedCpuIdx.add(i);
        break;
      }
    }
    const seen = !!(matched && matched.seenInBattle);
    return { display: matched || poolMon, seen, isPicked: !!matched };
  });
}

function ttOppoItemHtml(entry) {
  const p = entry.display;
  const seen = entry.seen;
  const isActive = entry.isPicked && p === state.cpuActive;
  const ratio = seen ? Math.max(0, p.currentHp / p.maxHp) : 1;
  return `
    <div class="tt-oppo-item ${seen ? '' : 'tt-unseen'} ${isActive ? 'tt-active' : ''} ${seen && p.fainted ? 'tt-fainted' : ''}">
      <img src="${spritePath(p)}" alt="" class="tt-oi-icon" onerror="this.replaceWith(makeTeamCardFallback(${p.speciesId}))">
      <div class="tt-oi-info">
        <div class="tt-oi-name">${p.species.name}${seen && p.fainted ? '<span class="tt-oi-fainted-tag">きぜつ</span>' : ''}</div>
        <div class="tt-oi-hpbar-outer"><div class="tt-oi-hpbar-inner" style="width:${seen ? ratio * 100 : 100}%; background:${seen && p.fainted ? '#ff4d4d' : hpBarColor(ratio)};"></div></div>
        <div class="tt-oi-hp-text">${seen ? `HP ${Math.ceil(ratio * 100)}%` : '未参戦'}</div>
      </div>
    </div>
  `;
}

function renderTeamBattleOppoList() {
  const panel = document.getElementById('party-panel');
  const oppoList = $('tt-oppo-list');
  if (!isTeamBattleMode() || !mpOpponentFullPool || mpOpponentFullPool.length === 0) {
    panel.classList.remove('tt-mode');
    oppoList.style.display = 'none';
    return;
  }
  panel.classList.add('tt-mode');
  oppoList.style.display = '';
  const entries = buildTeamBattleOppoEntries();
  oppoList.innerHTML = `<div class="tt-oppo-title">あいてのパーティー</div>` +
    entries.map((e) => ttOppoItemHtml(e)).join('');
}

$('party-close').addEventListener('click', () => closePartyOverlay());

/* ---- Switch confirmation dialog ---- */
function askConfirm(text) {
  return new Promise((resolve) => {
    $('confirm-text').textContent = text;
    $('confirm-overlay').classList.add('show');
    const yesBtn = $('confirm-yes');
    const noBtn = $('confirm-no');
    const cleanup = () => {
      $('confirm-overlay').classList.remove('show');
      yesBtn.onclick = null;
      noBtn.onclick = null;
    };
    yesBtn.onclick = () => { cleanup(); resolve(true); };
    noBtn.onclick = () => { cleanup(); resolve(false); };
  });
}

function attachPartySwitchHandler() {
  $('party-list').addEventListener('click', async (e) => {
    const btn = e.target.closest('.party-list-item');
    if (!btn || btn.disabled) return;
    const idx = parseInt(btn.dataset.idx, 10);

    if (partyMode !== 'switch' && partyMode !== 'forced') {
      partySelectedIdx = idx;
      partyDetailShowMega = false;
      renderPartyDetail();
      return;
    }

    if (partyMode === 'switch' && state.playerTeam[idx] === state.playerActive) {
      partySelectedIdx = idx;
      partyArmedIdx = null;
      partyDetailShowMega = false;
      renderPartyDetail();
      return;
    }

    const alreadyArmed = partyArmedIdx === idx;
    partySelectedIdx = idx;
    partyDetailShowMega = false;
    renderPartyDetail();

    if (!alreadyArmed) {
      partyArmedIdx = idx;
      return;
    }

    const target = state.playerTeam[idx];
    const ok = await askConfirm(`${target.species.name}と交代しますか？`);
    if (ok) {
      closePartyOverlay();
      if (partyMode === 'forced') {
        if (forcedSwitchResolve) { const r = forcedSwitchResolve; forcedSwitchResolve = null; r(idx); }
      } else {
        playerChooseSwitch(idx);
      }
    }
  });
}
attachPartySwitchHandler();

/* ---------------- Battle flow ---------------- */
let turnResolve = null;
let currentSurrenderUnsub = null; // ホスト側：ゲスト降参監視リスナーの解除関数（対戦をまたいで参照するためモジュールスコープに保持）

/* ---- 対人戦：1ターンの持ち時間（60秒）---- */
const TURN_TIME_LIMIT = 60;
let turnTimerInterval = null;
function clearTurnTimer() {
  if (turnTimerInterval) { clearInterval(turnTimerInterval); turnTimerInterval = null; }
  const badge = $('turn-timer-badge');
  if (badge) { badge.style.display = 'none'; badge.classList.remove('warn'); }
}
function startTurnTimer(onTimeout) {
  clearTurnTimer();
  if (!state.multiplayer) return;
  const badge = $('turn-timer-badge');
  const num = $('turn-timer-num');
  if (!badge || !num) return;
  let remaining = TURN_TIME_LIMIT;
  badge.style.display = 'flex';
  badge.classList.remove('warn');
  num.textContent = String(remaining);
  turnTimerInterval = setInterval(() => {
    remaining -= 1;
    num.textContent = String(Math.max(0, remaining));
    if (remaining <= 10) badge.classList.add('warn');
    if (remaining <= 0) {
      clearTurnTimer();
      onTimeout();
    }
  }, 1000);
}

/* ---- 対人戦：「相手の選択を待っています…」表示 ---- */
function showOpponentWaitingBadge() {
  if (!state.multiplayer) return;
  const badge = $('opponent-waiting-badge');
  if (badge) badge.style.display = 'block';
}
function hideOpponentWaitingBadge() {
  const badge = $('opponent-waiting-badge');
  if (badge) badge.style.display = 'none';
}

function playerChooseMove(move) {
  // 対人戦でメガシンカを予約している場合、その予約状態をアクションに含めてホストへ
  // 送信できるようにする（ローカルのpoke.wantsMegaEvolveだけではゲスト→ホストに伝わらないため）。
  const action = { type: 'move', move, mega: !!(state.playerActive && state.playerActive.wantsMegaEvolve) };
  clearTurnTimer();
  clearCmdPanel();
  closeBattleMoveInfo();
  $('cmd-dock').classList.remove('dock-wide');
  setWatchLogButtonsActive(false);
  if (turnResolve) { const r = turnResolve; turnResolve = null; r(action); }
}
function playerChooseSwitch(idx) {
  const action = { type: 'switch', idx };
  clearTurnTimer();
  clearCmdPanel();
  $('cmd-dock').classList.remove('dock-wide');
  setWatchLogButtonsActive(false);
  // 技を出さずに交代した場合、メガシンカの予約は取り消す（本家仕様：メガシンカは
  // 技を繰り出すターンにのみ発生する）。
  if (state.playerActive) state.playerActive.wantsMegaEvolve = false;
  if (turnResolve) { const r = turnResolve; turnResolve = null; r(action); }
}

function waitForPlayerAction() {
  const poke = state.playerActive;
  // はかいこうせん等の反動：次のターンは行動選択自体をさせず、自動で「動けない」ターンにする。
  // （本家同様、交代を含めどんな行動も選べない。実際に動けなくする処理は
  //   engine.js の checkCanMove 側で行われるため、ここではダミーの技アクションを
  //   返して runTurn 側の通常フローに乗せるだけでよい）
  if (poke && poke.mustRechargeTurns > 0) {
    clearCmdPanel();
    $('cmd-dock').classList.remove('dock-wide');
    setWatchLogButtonsActive(false);
    return Promise.resolve({ type: 'move', move: poke.moves.find(m => m.id === poke.lastUsedMoveId) || poke.moves[0] });
  }
  // げきりん強制中は、コマンド選択そのものを行わせず自動でその技を選択する。
  // （本家のように「げきりんしか選べない」表示にするのではなく、選択操作自体を
  //   スキップしてそのまま技が繰り出される形にする）
  if (poke && poke.gekirinTurns > 0 && poke.gekirinMoveId !== null) {
    const forcedMove = poke.moves.find(m => m.id === poke.gekirinMoveId);
    if (forcedMove) {
      clearCmdPanel();
      $('cmd-dock').classList.remove('dock-wide');
      setWatchLogButtonsActive(false);
      queueMessage(`${poke.species.name}は げきりんの ちからを おさえきれない！`);
      return Promise.resolve({ type: 'move', move: forcedMove });
    }
  }
  renderActionMenu();
  return new Promise((resolve) => {
    turnResolve = resolve;
    if (state.multiplayer) {
      startTurnTimer(() => {
        // 持ち時間切れ：場に出ているポケモンの4番目の技を自動選択する。
        // 4番目が使用不可（PP切れ・ロック等）の場合は、使用可能な技の中から
        // 先頭のものにフォールバックする（技が1つも出せない状況は通常発生しない）。
        const active = state.playerActive;
        let forced = active && active.moves ? active.moves[3] : null;
        const isUsable = (m) => m && m.pp > 0 && !m.locked
          && !isDeaigashiraLockedFor(active, m)
          && !(active.typeLockTurns > 0 && active.typeLockType === m.type);
        if (!isUsable(forced)) {
          forced = (active && active.moves ? active.moves : []).find(isUsable) || forced;
        }
        clearCmdPanel();
        $('cmd-dock').classList.remove('dock-wide');
        setWatchLogButtonsActive(false);
        if (turnResolve) {
          const r = turnResolve; turnResolve = null;
          if (forced) {
            r({ type: 'move', move: forced });
          } else {
            r({ type: 'none' });
          }
        }
      });
    }
  });
}

function updateFieldDisplay() {
  state.weather = battleField.weather !== 'none'
    ? { label: `${WEATHER_JP[battleField.weather]}（残り${battleField.weatherTurns}ターン）` }
    : null;
  state.terrain = battleField.terrain !== 'none'
    ? { label: `${TERRAIN_JP[battleField.terrain]}（残り${battleField.terrainTurns}ターン）` }
    : null;
}

// ランダムアクトの技変化ログ（非公開ログ）は、「ログの持ち主のプレイヤー」が、そのバトルで
// メガシンカを使っている場合に限り、その持ち主の画面にだけ表示する。相手の画面には出さない
// （何の技に変わったかが漏れないようにするため）。
//   ・持ち主：meta.randomActSide（ホスト視点の 'player' | 'cpu'）
//   ・見られる人：持ち主本人だけ。ホスト画面の「自分」は 'player'、ゲスト画面の「自分」は 'cpu'。
// 戻り値：{ host: ホスト画面に出すか, guest: ゲストへ送るか }
function privateRandomActVisibility(meta) {
  if (!meta || !meta.randomActPrivate) return { host: true, guest: true }; // 通常ログは全員に見せる
  const owner = meta.randomActSide; // 'player'（ホスト側）か 'cpu'（ゲスト側／CPU）
  const ownerUsedMega = hasUsedMegaEvolution(owner);
  return {
    host: owner === 'player' && ownerUsedMega,
    guest: owner === 'cpu' && ownerUsedMega && !!(state.multiplayer && state.isHost),
  };
}

function makeLogFn() {
  return (text, meta) => {
    // ランダムアクトの技変化ログ：持ち主がメガシンカを使っている場合だけ、持ち主の画面に出す。
    // ホスト画面に出さない場合でも、ゲスト（持ち主）には送る必要があるので、その分だけ先に処理する。
    let hideFromGuest = false;
    if (meta && meta.randomActPrivate) {
      const vis = privateRandomActVisibility(meta);
      if (!vis.host) {
        if (vis.guest) sendPrivateLogToGuestOnly(text);
        return; // ホスト画面にも履歴にも出さない
      }
      hideFromGuest = true; // ホストの持ち主本人には見せるが、ゲスト（相手）には送らない
    }
    let uiSide = null;
    let hpSnapshot = null;
    let statusSnapshotForHit = null;
    if (meta && meta.hit) {
      uiSide = meta.hit === 'player' ? 'self' : 'opp';
      const poke = meta.hit === 'player' ? state.playerActive : state.cpuActive;
      hpSnapshot = poke ? poke.currentHp : 0;
      // HPだけでなく状態異常も「このメッセージが発行された瞬間」の値をスナップショットする。
      // 技実行はengine.js側で同期的に一括処理されるため、poke自身の最新値をそのまま見ると、
      // 例えば「Aの攻撃で77ダメージ！」の表示中に、実際にはまだ起きていない
      // 「（同じターンの後の行動で付与される）こおり状態」まで先にHUDへ出てしまうことがある。
      // これを防ぎ、ダメージ表示のたびに“その時点で本当に確定している”状態異常だけを見せる。
      statusSnapshotForHit = poke ? { status: poke.status || 0, confuseTurns: poke.confuseTurns || 0 } : null;
    }

    // 能力ランク変化がどちら側のポケモンに起きたか（'player'|'cpu'→'self'|'opp'）
    let rankUiSide = null;
    if (meta && meta.rankChange && meta.rankSide) {
      rankUiSide = meta.rankSide === 'player' ? 'self' : 'opp';
    }

    // ヨワシのフォルムチェンジ（むれたすがた⇔たんどくのすがた）がどちら側に起きたか。
    let yowashiUiSide = null;
    if (meta && meta.yowashiForm && meta.side) {
      yowashiUiSide = meta.side === 'player' ? 'self' : 'opp';
    }

    // アイニーチュのフォルムチェンジ（HP半減で片道変化）がどちら側に起きたか。
    let aineechuUiSide = null;
    if (meta && meta.aineechuForm && meta.side) {
      aineechuUiSide = meta.side === 'player' ? 'self' : 'opp';
    }

    // 状態異常・こんらんの新規付与：ダメージを伴わない単独の付与メッセージ
    // （例：ブリザードでこおり、あくまのキッスでねむり等）が表示されるタイミングで、
    // 演出なしでHUDだけを更新する。この時点でのstatus/confuseTurnsをスナップショットして
    // 使うことで、「まだこのメッセージが表示されていないのに次の行動の状態まで
    // 先に見えてしまう／逆に既に付与された状態がしばらく表示されない」という
    // ズレを防ぐ（メガシンカ演出やダメージ表示のHUD更新と同じ考え方）。
    let statusApplyUiSide = null;
    if (meta && meta.statusApply) {
      statusApplyUiSide = meta.statusApply === 'player' ? 'self' : 'opp';
    }

    // メガシンカ：①メガリング反応（メッセージのみ・軽い予兆音）②実際の変身（本演出）
    let megaRingUiSide = null;
    if (meta && meta.megaRing && meta.side) {
      megaRingUiSide = meta.side === 'player' ? 'self' : 'opp';
    }
    let megaUiSide = null;
    if (meta && meta.megaEvolve && meta.side) {
      megaUiSide = meta.side === 'player' ? 'self' : 'opp';
    }
    // 「〇〇の メガリングが 反応した！」の〇〇は、プレイヤー側なら設定中のプレイヤー名、
    // 相手（CPU）側は「あいての◯◯」（トレーナー名を持たないCPU戦のため種族名で代用）。
    if (megaRingUiSide) {
      const trainerName = meta.side === 'player'
        ? (state.playerName || PlayerProfile.get() || 'あなた')
        : (state.opponentName || 'あいて');
      text = `${trainerName}の　メガリングが　反応した！`;
    }

    // ログ履歴（「ログを見る」オーバーレイ用）に記録。
    let logSide = null, logKind = 'plain', logSpeciesId = null, logShiny = false;
    if (meta && meta.moveUse) {
      const poke = meta.moveUse === 'player' ? state.playerActive : state.cpuActive;
      logSide = meta.moveUse; logKind = 'move';
      logSpeciesId = poke ? poke.speciesId : null; logShiny = poke ? poke.shiny : false;
    } else if (meta && meta.hit) {
      const poke = meta.hit === 'player' ? state.playerActive : state.cpuActive;
      logSide = meta.hit; logKind = 'damage';
      logSpeciesId = poke ? poke.speciesId : null; logShiny = poke ? poke.shiny : false;
    }
    pushBattleLogHistory({ text, side: logSide, kind: logKind, speciesId: logSpeciesId, shiny: logShiny });

    const moveType = meta && meta.moveType ? meta.moveType : null;
    const moveId = meta && meta.moveId !== undefined ? meta.moveId : null;
    const weatherFx = meta && meta.weatherFx ? meta.weatherFx : null;
    // 威力90超の技は、より豪華・派手な演出（big版）で再生する。
    const isBigMove = !!(meta && meta.movePower !== undefined && meta.movePower !== null && meta.movePower > BIG_MOVE_POWER_THRESHOLD);
    // インフェルノ／メイルストローム／イルミンスールは通常のbig版よりさらに特別な専用演出を使う。
    const isSpecialMove = SPECIAL_MOVE_FX_IDS.indexOf(moveId) !== -1;

const isStatusSpecialMove = isSpecialMove
  && meta && meta.moveUse
  && meta.moveCategory === 'status';

    queueMessage(text, async () => {
    	if (isStatusSpecialMove) {
    // 変化技でも「攻撃側→相手」の飛翔演出が要る技（ステルスロック等）のため、
    // 技を使った側(meta.moveUse)の反対側＝相手側 を被弾側として渡す。
    // 他の変化技（ミキシング等）は第2引数を使わないので影響しない。
    const statusDefSide = meta.moveUse === 'player' ? 'opp' : 'self';
    await playSpecialMoveEffect(moveId, statusDefSide);
  }
      if (uiSide) {
        const poke = meta.hit === 'player' ? state.playerActive : state.cpuActive;
        if (isSpecialMove) {
          // 専用の全画面エフェクト：スプライト枠に縛られない派手な演出。
          // uiSide（被弾側）を渡す＝パワージェム等、攻撃側→防御側への飛翔演出で使う。
          await playSpecialMoveEffect(moveId, uiSide);
          if (meta && meta.typeMult !== undefined) {
            playTypeEffectSound(meta.typeMult);
          }
          await flashHit(uiSide);
          updateHud(poke, uiSide, hpSnapshot, statusSnapshotForHit);
        } else if (isBigMove && moveType) {
          // 豪華演出：ちょっと長い派手なエフェクトを最後まで見せてから、
          // 効果音とダメージ反映（ヒット演出＋HP更新）を同時に出す。
          await playTypeEffect(uiSide, moveType, true);
          if (meta && meta.typeMult !== undefined) {
            playTypeEffectSound(meta.typeMult);
          }
          await flashHit(uiSide);
          updateHud(poke, uiSide, hpSnapshot, statusSnapshotForHit);
        } else {
          // 通常演出：タイプ別の簡易エフェクト → 効果音 → ヒット演出 → HP反映、の順で見せる
          if (moveType) {
            await playTypeEffect(uiSide, moveType, false);
          }
          if (meta && meta.typeMult !== undefined) {
            playTypeEffectSound(meta.typeMult);
          }
          await flashHit(uiSide);
          updateHud(poke, uiSide, hpSnapshot, statusSnapshotForHit);
        }
      }
      // 能力ランク変化：このログ行が画面に表示されるタイミングでエフェクト＋効果音を同時再生し、
      // エフェクトが終わるまでバトル進行（次のメッセージ）を待たせる。
      if (rankUiSide) {
        await rankFlash(rankUiSide, meta.rankChange);
      }
      // ヨワシのフォルムチェンジ：ログ行が表示されるタイミングで演出（fx指定時のみ「魚が集まる／散る」）
      // →スプライト画像の実際の切り替え、を行う。エフェクトが終わるまで次のメッセージへ進ませない。
      if (yowashiUiSide) {
        const poke = meta.side === 'player' ? state.playerActive : state.cpuActive;
        await playYowashiFormChangeEffect(yowashiUiSide, poke, meta.yowashiForm, !!meta.fx);
      }
      // アイニーチュのフォルムチェンジ：画面の様々な方向から不気味な分身が群がり寄って
      // 黒いヘドロの塊となり、それが弾けてA1990.png（めざめすがた）へ変貌するという
      // おぞましい専用演出を再生してから、HP増加・状態異常解除後の値でHUDを更新する。
      if (aineechuUiSide) {
        const poke = meta.side === 'player' ? state.playerActive : state.cpuActive;
        await playAineechuFormChangeEffect(aineechuUiSide, poke, true);
        if (poke) {
          const snap = { status: meta.statusSnapshot, confuseTurns: meta.confuseSnapshot };
          updateHud(poke, aineechuUiSide, meta.hpSnapshot, snap);
        }
      }
      // 状態異常・こんらんの新規付与：ダメージを伴わない単独メッセージが表示されたタイミングで、
      // 演出なしでHUDだけ更新する（このメッセージが発行された瞬間のスナップショットを使う）。
      if (statusApplyUiSide) {
        const poke = meta.statusApply === 'player' ? state.playerActive : state.cpuActive;
        if (poke) {
          const snap = { status: meta.statusSnapshot, confuseTurns: meta.confuseSnapshot };
          updateHud(poke, statusApplyUiSide, meta.hpSnapshot, snap);
        }
      }
      // メガリングが反応した：ここでは効果音は鳴らさず、次のメッセージ（実際の変身）で
      // mepa.mp3と全画面エフェクトをまとめて再生する（指定通りの2段階演出）。
      // メガシンカ本演出：効果音(mepa.mp3)と共に約4秒のド派手な全画面エフェクトを再生し、
      // その最中はポケモンの絵を隠す。3.5秒のタイミングでメガシンカ後の画像に差し替え、
      // エフェクトが晴れて素の姿が見える。エフェクトが終わるまで次のメッセージへ進ませない。
      // なお、このターンの技実行はengine.js側で既に同期的に全て完了済みのため、
      // poke.currentHp等の「今の値」をそのまま使うと、まだ表示していないはずの
      // このターンのダメージ・状態異常までHUDに反映されてしまう。そのため、
      // メガシンカが実際に起きた瞬間のスナップショット（meta側で保持）を使う。
      if (megaUiSide) {
        const poke = meta.side === 'player' ? state.playerActive : state.cpuActive;
        // 乱入ボスがメガシンカし始めた瞬間：戦闘BGMを止めて intrusion.mp3 に切り替える（BGM名表示なし）。
        if (meta.side === 'cpu' && poke && poke.isIntruder && state.isIntrusionBattle) {
          BattleBgm.switchToIntrusion();
        }
        // プレイヤー側が実際にメガシンカした実績を図鑑に記録する（メガ形態を「捕獲済み」にする）。
        if (meta.side === 'player' && poke && poke.speciesId !== undefined) {
          Pokedex.registerMega(poke.speciesId, poke.megaForm || null);
        }
        const snapshot = {
          hp: meta.hpSnapshot !== undefined ? meta.hpSnapshot : undefined,
          status: meta.statusSnapshot,
          confuseTurns: meta.confuseSnapshot,
        };
        await playMegaEvolveEffect(megaUiSide, poke, snapshot);
      }
      // 天候発動：このログ行が画面に表示されるタイミングで背景エフェクトを見せ、
      // エフェクトが終わるまで次のメッセージ（--ターンN--等）に進ませない。
      if (weatherFx) {
        await playWeatherEffect(weatherFx);
      }
    }, {
      hit: meta && meta.hit ? meta.hit : null,
      hp: hpSnapshot,
      faint: meta && meta.faint ? meta.faint : null,
      moveUse: meta && meta.moveUse ? meta.moveUse : null,
      speciesId: logSpeciesId,
      shiny: logShiny,
      typeMult: meta && meta.typeMult !== undefined ? meta.typeMult : null,
      rankChange: meta && meta.rankChange ? meta.rankChange : null,
      rankSide: meta && meta.rankSide ? meta.rankSide : null,
      moveType: moveType,
      moveId: moveId,
      weatherFx: weatherFx,
      movePower: meta && meta.movePower !== undefined ? meta.movePower : null,
      yowashiForm: meta && meta.yowashiForm ? meta.yowashiForm : null,
      yowashiSide: meta && meta.side ? meta.side : null,
      yowashiFx: meta && meta.fx ? true : false,
      aineechuForm: meta && meta.aineechuForm ? true : false,
      aineechuSide: meta && meta.aineechuForm && meta.side ? meta.side : null,
      aineechuHp: meta && meta.aineechuForm ? meta.hpSnapshot : null,
      aineechuMaxHp: meta && meta.aineechuForm ? meta.maxHpSnapshot : null,
      megaEvolve: meta && meta.megaEvolve ? true : false,
      megaSide: meta && (meta.megaEvolve || meta.megaRing) && meta.side ? meta.side : null,
      megaRing: meta && meta.megaRing ? true : false,
      statusApply: meta && meta.statusApply ? meta.statusApply : null,
      statusApplySnapshot: meta && meta.statusApply
        ? { hp: meta.hpSnapshot, status: meta.statusSnapshot, confuseTurns: meta.confuseSnapshot }
        : null,
      hideFromGuest: hideFromGuest,
    });
  };
}

async function doSwitch(newActive, side) {
  // 場を離れる側のポケモンも、本家仕様どおり交代でランク変化・技封じ・
  // タイプロック（インフェルノ／メイルストローム／イルミンスール由来）等が解除される。
  const outgoing = side === 'player' ? state.playerActive : state.cpuActive;
  if (outgoing && outgoing !== newActive) {
    // かげぬい：縫い付けた本人（outgoing）が交代で場を離れる場合、相手にかかっている
    // 「逃げられない」を解除する（とんぼがえり等の強制交代パスは runTurn 側で別途処理済みだが、
    //  通常の自発交代・瀕死交代はすべてこの doSwitch を通るのでここで一括して解除する）。
    if (typeof clearShadowTrapsBy === 'function') {
      const oppActive = side === 'player' ? state.cpuActive : state.playerActive;
      clearShadowTrapsBy(outgoing, oppActive);
    }
    outgoing.typeLockTurns = 0;
    outgoing.typeLockType = null;
    // 場を離れる時点でメガシンカの予約が残っていても意味がないのでクリアする
    // （交代前にメガシンカが起きることはなく、控えに戻ったポケモンの予約はバグの元）。
    outgoing.wantsMegaEvolve = false;
    // かがくへんかガス：場に出ている間だけ発動する特性なので、
    // 持ち主が場を離れたら必ず無効化する（手持ちに戻っても効果が残るのはバグ）。
    if (outgoing.ability === ABILITY.KAGAKUHENKAGASU) {
      battleField.chemicalGasActive = false;
    }
    // さいせいりょく：交代で場を離れた瞬間、最大HPの1/3を回復する（瀕死での退場では発動しない）
    if (!outgoing.fainted && outgoing.ability === ABILITY.SAISEIRYOKU) {
      const healAmt = Math.max(1, Math.floor(outgoing.maxHp / 3));
      outgoing.currentHp = Math.min(outgoing.maxHp, outgoing.currentHp + healAmt);
      queueMessage(`${outgoing.species.name}は交代した！`);
      await drainMessages();
      updateHud(outgoing, side === 'player' ? 'self' : 'opp');
    }
  }
  newActive.side = side;
  newActive.deaigashiraLocked = false; // 場に出た最初のターンはであいがしら使用可能
  newActive.turnsOnField = 0; // 場に出てからのターン数をリセット（であいがしら等の初手限定判定用）
  newActive.gekirinTurns = 0; // 交代でげきりんの強制状態は解除
  newActive.gekirinMoveId = null;
  newActive.protecting = false; // 交代でまもる状態は解除
  newActive.protectStreak = 0;  // 交代でまもる連続使用カウントもリセット
  newActive.enduring = false;   // 交代でこらえる状態は解除
  newActive.endureStreak = 0;   // 交代でこらえる連続使用カウントもリセット
  // 本家仕様：交代するとアンコール（技固定）と混乱は解除される。
  newActive.encoreTurns = 0;
  newActive.encoreMoveId = null;
  newActive.confuseTurns = 0;
  // 本家仕様：交代すると能力ランク変化は元に戻り、テラーバインド等の技封じも解除される
  newActive.ranks = { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, acc: 0, eva: 0 };
  if (newActive.moves) newActive.moves.forEach((m) => { if (m) m.locked = false; });
  newActive.seenInBattle = true; // 対人チーム戦：場に出た瞬間に相手からも視認済みとして記録
  if (side === 'player') {
    state.playerActive = newActive;
    setSprite(newActive, 'self');
    updateHud(newActive, 'self');
  } else {
    state.cpuActive = newActive;
    setSprite(newActive, 'opp');
    updateHud(newActive, 'opp');
  }
  applyHazardsOnSwitchIn(newActive, side, makeLogFn());
  await drainMessages();
  const opponent = side === 'player' ? state.cpuActive : state.playerActive;
  applyWeatherTerrainAbilityOnSwitchIn(newActive, makeLogFn(), opponent);
  await drainMessages();
  updateHud(newActive, side === 'player' ? 'self' : 'opp');
  updateFieldDisplay();
}

async function pickNextAlive(team) {
  return team.find((p) => !p.fainted) || null;
}

function hasAliveBackup(team, active) {
  return team.some((p) => p !== active && !p.fainted);
}

async function resolvePendingSwitchOuts() {
  if (state.cpuActive.pendingSwitchOut && !state.cpuActive.fainted) {
    state.cpuActive.pendingSwitchOut = false;
    if (state.cpuActive.bindTurns > 0) {
      queueMessage(`${state.cpuActive.species.name}はバインドされていて交代できない！`);
      await drainMessages();
    } else if (hasAliveBackup(state.cpuTeam, state.cpuActive)) {
      const outgoing = state.cpuActive;
      const next = state.cpuTeam.find((p) => p !== outgoing && !p.fainted);
      if (next) {
        queueMessage(`相手は${outgoing.species.name}をひっこめた！`);
        await drainMessages();
        queueMessage(`相手は${next.species.name}をくり出した！`);
        await drainMessages();
        await doSwitch(next, 'cpu');
        // doSwitch内でランク・混乱状態がリセットされるため、バトンタッチの引き継ぎは
        // doSwitchの「後」に適用する（先に適用するとdoSwitchのリセットで消えてしまうバグを修正）。
        applyBatonPass(outgoing, next);
      }
    }
  }
  if (state.playerActive.pendingSwitchOut && !state.playerActive.fainted) {
    state.playerActive.pendingSwitchOut = false;
    if (state.playerActive.bindTurns > 0) {
      queueMessage(`${state.playerActive.species.name}はバインドされていて交代できない！`);
      await drainMessages();
    } else if (hasAliveBackup(state.playerTeam, state.playerActive)) {
      const outgoing = state.playerActive;
      queueMessage(`${outgoing.species.name}、もどれ！`);
      await drainMessages();
      const idx = await waitForForcedSwitch();
      const next = state.playerTeam[idx];
      await doSwitch(next, 'player');
      // doSwitch内でランク・混乱状態がリセットされるため、バトンタッチの引き継ぎは
      // doSwitchの「後」に適用する（先に適用するとdoSwitchのリセットで消えてしまうバグを修正）。
      applyBatonPass(outgoing, next);
      queueMessage(`ゆけっ！${next.species.name}！`);
      await drainMessages();
    }
  }
}

function applyBatonPass(outgoing, incoming) {
  if (!outgoing.batonPass) return;
  incoming.ranks = { ...outgoing.batonPass.ranks };
  incoming.confuseTurns = outgoing.batonPass.confuseTurns || 0;
  outgoing.batonPass = null;
}

async function resolveImmediateSwitch(side) {
  if (side === 'cpu') {
    const outgoing = state.cpuActive;
    if (outgoing.bindTurns > 0) {
      queueMessage(`${outgoing.species.name}はバインドされていて交代できない！`);
      await drainMessages();
      return null;
    }
    if (!hasAliveBackup(state.cpuTeam, outgoing)) return null;
    const next = state.cpuTeam.find((p) => p !== outgoing && !p.fainted);
    if (!next) return null;
    queueMessage(`相手は${outgoing.species.name}をひっこめた！`);
    await drainMessages();
    queueMessage(`相手は${next.species.name}をくり出した！`);
    await drainMessages();
    await doSwitch(next, 'cpu');
    // doSwitch内でランク・混乱状態がリセットされるため、バトンタッチの引き継ぎは
    // doSwitchの「後」に適用する（先に適用するとdoSwitchのリセットで消えてしまうバグを修正）。
    applyBatonPass(outgoing, next);
    return next;
  } else {
    const outgoing = state.playerActive;
    if (outgoing.bindTurns > 0) {
      queueMessage(`${outgoing.species.name}はバインドされていて交代できない！`);
      await drainMessages();
      return null;
    }
    if (!hasAliveBackup(state.playerTeam, outgoing)) return null;
    queueMessage(`${outgoing.species.name}、もどれ！`);
    await drainMessages();
    const idx = await waitForForcedSwitch();
    const next = state.playerTeam[idx];
    await doSwitch(next, 'player');
    // doSwitch内でランク・混乱状態がリセットされるため、バトンタッチの引き継ぎは
    // doSwitchの「後」に適用する（先に適用するとdoSwitchのリセットで消えてしまうバグを修正）。
    applyBatonPass(outgoing, next);
    queueMessage(`ゆけっ！${next.species.name}！`);
    await drainMessages();
    return next;
  }
}

async function runBattleLoop() {
  state.battleBusy = true;
  battleLogHistory = [];
  clearWeatherFxLayer();
  const bgmNum = BattleBgm.start(state.isBossBattle && npcTeamState.active ? 'team' : state.isBossBattle);
  pushLogLine(battleBgmLogLabel(bgmNum));
  state.playerActive.side = 'player';
  state.cpuActive.side = 'cpu';
  updateHud(state.playerActive, 'self');
  updateHud(state.cpuActive, 'opp');
  setSprite(state.cpuActive, 'opp');
  setSprite(state.playerActive, 'self');

  queueMessage(`${state.cpuActive.species.name}が現れた！`);
  queueMessage(`ゆけっ！${state.playerActive.species.name}！`);
  await drainMessages();
  resetHazards();
  resetField(state.playerTeam, state.cpuTeam);
  updateFieldDisplay();
  applyWeatherTerrainAbilityOnSwitchIn(state.cpuActive, makeLogFn(), state.playerActive);
  await drainMessages();
  applyWeatherTerrainAbilityOnSwitchIn(state.playerActive, makeLogFn(), state.cpuActive);
  await drainMessages();
  updateFieldDisplay();

  state.turnNumber = 1;

  while (true) {
    if (state.playerTeam.every((p) => p.fainted)) { await endBattle(false); return; }
    if (state.cpuTeam.every((p) => p.fainted)) { await endBattle(true); return; }

    queueTurnDivider(state.turnNumber);
    await drainMessages();

    const playerAction = await waitForPlayerAction();

    if (playerAction.type === 'switch') {
      // プレイヤーが自分から交代した場合、CPUは「交代前のポケモンに対して選んでいたはずの技」を
      // そのまま使う（交代後のポケモンを見てから技を選び直す＝後出しで一番刺さる技を撃たれる、
      // という不自然な後出し行動を防ぐため）。交代前の時点で先に技を決めておく。
      const preSwitchCpuAction = (!state.cpuActive.fainted)
        ? chooseCpuAction(state.cpuActive, state.playerActive, state.cpuTeam, state.megaEvolutionEnabled, playerAction)
        : null;

      const newP = state.playerTeam[playerAction.idx];
      queueMessage(`${state.playerActive.species.name}、もどれ！`);
      await drainMessages();
      await doSwitch(newP, 'player');
      queueMessage(`ゆけっ！${newP.species.name}！`);
      await drainMessages();
      if (!state.playerActive.fainted) {
        // 交代前に決めた行動が「技」ならそれをそのまま維持する（要件1）。
        // 交代前に決めた行動が「弱点をつく控えへの交代」だった場合は、プレイヤーの
        // 交代後のポケモンを基準に判定をし直す（元のポケモン基準の交代判断を、
        // 別のポケモンが出てきた状況にそのまま適用するのは不自然なため）。
        const cpuAction = (preSwitchCpuAction && preSwitchCpuAction.type === 'move')
          ? preSwitchCpuAction
          : chooseCpuAction(state.cpuActive, state.playerActive, state.cpuTeam, state.megaEvolutionEnabled, playerAction);
        await runCpuAction(cpuAction, { type: 'none' });
        await drainMessages();
      }
      await postTurnCleanupAndRender();
      state.turnNumber++;
      continue;
    }

    const cpuAction = chooseCpuAction(state.cpuActive, state.playerActive, state.cpuTeam, state.megaEvolutionEnabled, playerAction);
    await runCpuAction(cpuAction, playerAction);
    await drainMessages();
    await postTurnCleanupAndRender();
    state.turnNumber++;
  }
}

// CPUの行動（技 or 弱点をつく自発交代）を実行する共通ヘルパー。
// CPUが「交代」を選んだ場合は、まずポケモンを交代させてからそのターンの残りの
// プレイヤー行動（あれば）を処理する。原作同様、CPU側の交代を選んだターンは
// 交代してきたポケモンが技を出すことはない（交代のみでターン消費）。
async function runCpuAction(cpuAction, playerAction) {
  if (cpuAction.type === 'switch') {
    const outgoing = state.cpuActive;
    const newC = state.cpuTeam[cpuAction.idx];
    if (newC && newC !== outgoing && !newC.fainted) {
      queueMessage(`相手は${outgoing.species.name}をひっこめた！`);
      await drainMessages();
      await doSwitch(newC, 'cpu');
      queueMessage(`相手は${newC.species.name}をくり出した！`);
      await drainMessages();
    }
    // CPUは交代のみでこのターンを終えるが、プレイヤー側の行動（技）は通常通り処理する。
    if (playerAction && playerAction.type === 'move' && !state.playerActive.fainted && !state.cpuActive.fainted) {
      await runTurn(playerAction, { type: 'none' }, state.playerActive, state.cpuActive, makeLogFn(), resolveImmediateSwitch);
    }
    return;
  }
  await runTurn(playerAction || { type: 'none' }, cpuAction, state.playerActive, state.cpuActive, makeLogFn(), resolveImmediateSwitch);
}

async function postTurnCleanupAndRender() {
  await resolvePendingSwitchOuts();

  while (state.cpuActive.fainted) {
    await playFaint('opp');
    if (state.cpuTeam.every((p) => p.fainted)) break;
    const next = await pickNextAlive(state.cpuTeam);
    if (!next) break;
    queueMessage(`相手は${next.species.name}をくり出した！`);
    await drainMessages();
    await doSwitch(next, 'cpu');
  }
  while (state.playerActive.fainted) {
    await playFaint('self');
    const alive = state.playerTeam.filter((p) => !p.fainted);
    if (alive.length === 0) break;
    queueMessage(`つぎのポケモンをえらんでください`);
    await drainMessages();
    const idx = await waitForForcedSwitch();
    await doSwitch(state.playerTeam[idx], 'player');
  }
  updateHud(state.playerActive, 'self');
  updateHud(state.cpuActive, 'opp');
  updateFieldDisplay();
}

function waitForForcedSwitch() {
  $('cmd-dock').classList.remove('dock-wide');
  setWatchLogButtonsActive(false);
  clearCmdPanel();
  return new Promise((resolve) => {
    forcedSwitchResolve = resolve;
    openPartyOverlay('forced');
  });
}

// 隠しポケモン（種族名は伏せたまま）の解放を、勝利直後にトーストで知らせる。
// 種族名はネタバレになるため出さず、「？？？」のまま解放を伝える。
// 既にボックスが構築済みのセッションでも即座に反映されるよう、ここで直接ボックスへ追加する。
function announceHiddenSpeciesUnlock(speciesId) {
  if (typeof sbEnsureSpeciesInBox === 'function') sbEnsureSpeciesInBox(speciesId);
  showPokedexToast('？？？？？ が解放された！ 図鑑を確認しよう');
}

async function endBattle(playerWon) {
  state.battleBusy = false;
  BattleBgm.stop();
  // 結果オーバーレイの裏に技メニュー等が残ったままタップできてしまわないよう、
  // ここで確実にコマンドパネルを空にしておく。
  clearCmdPanel();
  clearTurnTimer();
  $('cmd-dock').classList.remove('dock-wide');
  let earnedDisc = 0;
  if (playerWon && !state.multiplayer) {
    state.winStreak++;
    MaxWinStreak.reportStreak(state.winStreak, npcTeamState.active ? 'team' : state.megaEvolutionEnabled);
    updateRecordBtnRank();
    // ディスク報酬：メガあり/なしNPC戦・チームバトルいずれも、その戦い（winStreak）が
    // 何戦目にあたるかでディスクを加算する（1〜5戦目+10、6〜9戦目+20、10戦目ごとのボス+50、
    // それ以外の11戦目以降+25）。
    earnedDisc = calcNpcDiscReward(state.winStreak);
    if (earnedDisc > 0) Shop.addDisc(earnedDisc);
    // 乱入戦に勝った＝乱入ボスを倒した → 実績で記録（以後そのポケモンは乱入ボスに出てこない）
    if (state.isIntrusionBattle && state.pendingIntrusionId != null && window.Achievements) {
      window.Achievements.unlock(intrusionAchievementId(state.pendingIntrusionId));
    }
    // チーム戦の10連勝目ボス（ID1031）を倒した → 実績を解除し、隠しポケモンの解放を知らせる
    if (state.isBossBattle && npcTeamState.active && window.Achievements) {
      const newlyUnlocked = window.Achievements.unlock('win_streak_team_10');
      if (newlyUnlocked) announceHiddenSpeciesUnlock(2000);
    }
  }
  // タイプ縛り連勝の判定（NPCチームバトルのみ対象。対人戦・通常NPC戦は対象外で、
  // チーム戦で負けた場合や縛りが崩れた場合はそのタイプの連勝が0にリセットされる）。
  // 判定は「組んだ手持ち6匹」(npcTeamState.source)で行う。state.playerTeamは
  // そこから実際にバトルへ選出した3匹(NPC_PICK_COUNT)しか入っておらず、
  // isPartyOfTypeがteam.length<6で弾いてしまうため常にfalseになっていた。
  if (!state.multiplayer && typeof TypeStreak !== 'undefined') {
    const typeStreakTeam = (npcTeamState.active && npcTeamState.source) ? npcTeamState.source : state.playerTeam;
    TypeStreak.reportResult(!!npcTeamState.active, playerWon, typeStreakTeam);
  }
  // 乱入戦が終わったら、勝敗にかかわらず乱入状態は解除（負けた場合は連勝ごとリセットされる）
  if (state.isIntrusionBattle) {
    state.isIntrusionBattle = false;
    state.pendingIntrusionId = null;
  }
  if (playerWon && !state.multiplayer) state.runBattleCount++;
  BattleHistory.add({
    mode: state.multiplayer ? 'pvp' : 'npc',
    mega: !!state.megaEvolutionEnabled,
    isTeam: !!(npcTeamState.active),
    win: playerWon,
    streak: state.multiplayer ? null : state.winStreak,
    playerTeam: snapshotTeamForHistory(state.playerTeam),
    oppTeam: snapshotTeamForHistory(state.cpuTeam),
  });
  const overlay = $('result-overlay');
  $('result-title').textContent = playerWon ? 'WIN' : 'LOSE';
  $('result-title').className = 'result-title ' + (playerWon ? 'win' : 'lose');
  $('result-desc').textContent = playerWon
    ? (state.multiplayer
        ? '勝利！'
        : `${state.winStreak}連勝中！ディスク+${earnedDisc}　つぎの相手が待っている。`)
    : `連勝は${state.winStreak}でストップ。またチャレンジしよう！`;
  overlay.classList.add('show');

  $('btn-result-next').onclick = async () => {
    overlay.classList.remove('show');
    if (playerWon) {
      MenuBgm.start();
      // 次の戦いが乱入戦なら、ここ（つぎへを押した直後）で警告を出して乱入ボスを確定させる
      await maybeAnnounceIntrusion();
      if (npcTeamState.active) {
        // チーム戦：相手からポケモンをもらう画面は飛ばして、選出画面へ（いまの選出順は維持）
        openNpcPick();
      } else {
        await runTradeSequence();
        renderReorderScreen();
      }
    } else {
      state.winStreak = 0;
      MenuBgm.start();
      showScreen('title');
    }
  };
}

/* ---------------- Post-win trade sequence ---------------- */
function tradeCardHtml(p, idx, disabled) {
  const effectiveTypes = getEffectiveTypesForDisplay(p);
  const typeDisplay = effectiveTypes.map(t => typeChipHtml(t)).join('');
  return `
    <div class="trade-poke-card ${disabled ? 'disabled' : ''}" data-idx="${idx}">
      <button class="tpc-info-btn" data-info-idx="${idx}" type="button"><span>!</span></button>
      ${pokedexNewBadgeHtml(p.speciesId)}
      <img src="${spritePath(p)}" alt="${p.species.name}" class="tpc-sprite"
           onerror="this.replaceWith(makeTeamCardFallback(${p.speciesId}))">
      <div class="tpc-name">${tpcNameHtml(p)}</div>
      <div class="tpc-types">
        ${typeDisplay}
      </div>
      <div class="tpc-hp">HP ${p.currentHp}/${p.maxHp}</div>
    </div>
  `;
}

let tradeDetailShowMega = false; // 「メガシンカ後を見る」トグルの状態（表示専用、poke本体には影響しない）
function showTradeDetail(poke) {
  tradeDetailShowMega = false;
  renderTradeDetail(poke);
  $('trade-detail-overlay').classList.add('show');
}
function renderTradeDetail(poke) {
  $('trade-detail-card').innerHTML = partyDetailHtmlWide(poke, tradeDetailShowMega);
  const megaBtn = document.getElementById('pdw-mega-toggle-btn');
  if (megaBtn) {
    megaBtn.addEventListener('click', () => {
      tradeDetailShowMega = !tradeDetailShowMega;
      renderTradeDetail(poke);
    });
  }
}
$('trade-detail-close').addEventListener('click', () => {
  $('trade-detail-overlay').classList.remove('show');
});

// NPC戦で相手がバトル中にメガシンカしていた場合、そのポケモンをもらう時の候補一覧・詳細表示は
// メガシンカ前の姿（タイプ・特性・実数値・見た目）に戻して見せる。実際に手持ちに加わった後の
// ステータスは元々resetPokeForBattleでメガ前に戻っていたが、もらう時点の「表示」がメガ後の
// ままだったため、その見た目だけをここで先に元へ戻したコピーを作って一覧に渡す。
function demegaForOffer(p) {
  // ランダムアクトで技が入れ替わったまま戦闘が終わったポケモンは、もらう時の表示でも
  // 元の技構成で見せる（元の技IDが保存されていれば、そこから作り直した技リストを使う）。
  if (p.originalMoveIds) {
    const restoredCopy = Object.assign({}, p);
    restoredCopy.moves = p.originalMoveIds.map((id) => (id ? buildMoveObject(id) : null)).filter(Boolean);
    restoredCopy.originalMoveIds = null;
    p = restoredCopy;
  }
  if (!p.isMega || !p.megaOriginalSpecies) return p;
  const copy = Object.assign({}, p);
  copy.moves = p.moves.map((m) => Object.assign({}, m));
  copy.stats = Object.assign({}, p.stats);
  copy.species = p.megaOriginalSpecies;
  copy.ability = p.megaOriginalAbility;
  recalcMegaStats(copy, copy.species.baseStats);
  copy.isMega = false;
  copy.megaOriginalSpecies = null;
  copy.megaOriginalAbility = null;
  return copy;
}

function runTradeSequence() {
  return new Promise((resolve) => {
    const offerOverlay = $('trade-overlay');
    const offerRow = $('trade-offer-row');
    // ボス戦の場合、ボス専用ポケモン（メガなし:BOSS_SPECIES_ID / メガあり:BOSS_SPECIES_ID_MEGA / チーム:BOSS_SPECIES_ID_TEAM）はもらえないようにする
    const offerable = (state.isBossBattle
      ? state.cpuTeam.filter((p) => p.speciesId !== BOSS_SPECIES_ID && p.speciesId !== BOSS_SPECIES_ID_MEGA && p.speciesId !== BOSS_SPECIES_ID_TEAM)
      : state.cpuTeam
    ).map(demegaForOffer);
    offerRow.innerHTML = offerable.map((p, idx) => tradeCardHtml(p, idx, false)).join('');
    offerOverlay.classList.add('show');

    const onOfferClick = async (e) => {
      const infoBtn = e.target.closest('.tpc-info-btn');
      if (infoBtn) {
        const idx = parseInt(infoBtn.dataset.infoIdx, 10);
        showTradeDetail(offerable[idx]);
        return;
      }
      const card = e.target.closest('.trade-poke-card');
      if (!card) return;
      const offerIdx = parseInt(card.dataset.idx, 10);
      const chosen = offerable[offerIdx];
      const ok = await askConfirm(`${chosen.species.name}をもらいますか？`);
      if (!ok) return;
      offerRow.removeEventListener('click', onOfferClick);
      offerOverlay.classList.remove('show');
      runReplaceStep(chosen, resolve);
    };
    offerRow.addEventListener('click', onOfferClick);
  });
}

function runReplaceStep(incoming, doneResolve) {
  const replaceOverlay = $('trade-replace-overlay');
  const replaceRow = $('trade-replace-row');
  $('trade-replace-title').textContent = `${incoming.species.name}と交換するポケモンをえらんでください`;
  replaceRow.innerHTML = state.playerTeam.map((p, idx) => tradeCardHtml(p, idx, false)).join('');
  replaceOverlay.classList.add('show');

  const onReplaceClick = async (e) => {
    const infoBtn = e.target.closest('.tpc-info-btn');
    if (infoBtn) {
      const idx = parseInt(infoBtn.dataset.infoIdx, 10);
      showTradeDetail(state.playerTeam[idx]);
      return;
    }
    const card = e.target.closest('.trade-poke-card');
    if (!card) return;
    const replaceIdx = parseInt(card.dataset.idx, 10);
    const outgoing = state.playerTeam[replaceIdx];
    const ok = await askConfirm(`${outgoing.species.name}と${incoming.species.name}を交換しますか？`);
    if (!ok) return;
    replaceRow.removeEventListener('click', onReplaceClick);
    replaceOverlay.classList.remove('show');

    const incomingCopy = Object.assign({}, incoming);
    incomingCopy.moves = incoming.moves.map((m) => Object.assign({}, m));
    resetPokeForBattle(incomingCopy);
    state.playerTeam[replaceIdx] = incomingCopy;

    doneResolve();
  };
  replaceRow.addEventListener('click', onReplaceClick);
}

/* ---------------- Battle setup ---------------- */
function resetPokeForBattle(poke) {
  poke.currentHp = poke.maxHp;
  poke.status = 0;
  poke.seenInBattle = false; // 対人チーム戦：このバトルで一度でも場に出したかどうか（毎戦リセット）
  poke.badlyPoisonCounter = 0;
  poke.confuseTurns = 0;
  poke.sleepTurns = 0;
  poke.flinch = false;
  poke.fainted = false;
  poke.ranks = { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, acc: 0, eva: 0 };
  // ランダムアクトで入れ替わった技を元に戻す（バトルごとに元の技構成でスタートさせる）
  restoreOriginalMoves(poke);
  poke.moves.forEach((m) => { m.pp = m.maxPp; m.locked = false; });
  poke.energyStacks = 0;
  poke.fundoTriggered = false;
  poke.moraibiActive = false;
  poke.lazyTurns = false;
  poke.firstTurn = true;
  poke.gyakujouTriggered = false;
  poke.tauntTurns = 0;
  poke.bindTurns = 0;
  poke.removedTypes = [];
  poke.changedType = null;
  poke.hengenjizaiType = null;
  poke.hengenjizaiUsed = false;
  poke.typeLockTurns = 0;
  poke.typeLockType = null;
  poke.lastUsedMoveId = null;
  poke.encoreMoveId = null;
  poke.encoreTurns = 0;
  poke.utsusemiTurns = 0;
  poke.izanaiTurns = 0;
  poke.infernoUsed = false;
  poke.deaigashiraLocked = false;
  poke.turnsOnField = 0;
  poke.gekirinTurns = 0;
  poke.gekirinMoveId = null;
  poke.mustRechargeTurns = 0;
  poke.critRank = 0;
  // ---- メガシンカ（テスト機能） ----
  // バトルが始まるたびにメガシンカ状態をリセットする（毎戦、改めてメガシンカボタンを押す必要がある）。
  if (poke.isMega && poke.megaOriginalSpecies) {
    poke.species = poke.megaOriginalSpecies;
    poke.ability = poke.megaOriginalAbility;
    recalcMegaStats(poke, poke.species.baseStats);
  }
  poke.isMega = false;
  poke.megaOriginalSpecies = null;
  poke.megaOriginalAbility = null;
  // megaFormはリセットしない：createRandomPokemon生成時（＝選出/トレードでプールに並んだ時点）で
  // 既にX/Y抽選が確定しており、その表記を選出画面等で見せ続ける必要があるため。
  poke.wantsMegaEvolve = false;
}

// 次のバトルが「10連勝目」にあたるボス戦かどうかを判定する。
// 例：9連勝中に次で勝てば10連勝目＝ボス戦。9連勝中に負けて連勝が0に戻った場合は
// 次の1勝目はボス戦にはならない（あくまで「連勝数」で判定するため）。
function isNextBattleBoss() {
  return state.winStreak > 0 && state.winStreak % 10 === 0;
}

/* ---------------- 乱入（メガありNPC戦の3〜5戦目のどれか1戦） ---------------- */
// ランの開始時に呼ぶ。乱入の状態をすべて初期化する。
function resetIntrusionRun() {
  state.runBattleCount = 1;
  state.intrusionBattleNo = 0;
  state.intrusionDone = false;
  state.pendingIntrusionId = null;
  state.isIntrusionBattle = false;
}

// 今のランで乱入が起きる戦の番号（3〜5）を、まだ決まっていなければここで抽選する。
function ensureIntrusionBattleNo() {
  if (!state.intrusionBattleNo) state.intrusionBattleNo = rand(3, 5);
  return state.intrusionBattleNo;
}

// 「つぎへ」を押した時に呼ぶ。次の戦いが乱入戦なら、警告を表示して乱入ボスを確定させる。
// 条件：NPC戦／メガあり／次がボス戦(10の倍数連勝)ではない／今のランで未実施／
//       次の戦の番号が抽選済みの3〜5と一致／まだ倒していない乱入ボスが残っている。
async function maybeAnnounceIntrusion() {
  state.pendingIntrusionId = null;
  if (state.multiplayer || !state.megaEvolutionEnabled) return;
  if (state.intrusionDone) return;
  if (isNextBattleBoss()) return; // ボス戦とは重ねない
  if (state.runBattleCount !== ensureIntrusionBattleNo()) return;
  const remaining = getRemainingIntrusionBossIds();
  if (remaining.length === 0) return; // 全員撃破済みなら乱入は起きない
  state.pendingIntrusionId = remaining[Math.floor(Math.random() * remaining.length)];
  state.intrusionDone = true;
  await showIntrusionWarning();
}

// 画面いっぱいの「乱入！」警告を出し、数秒（またはタップ）で閉じる。
function showIntrusionWarning() {
  return new Promise((resolve) => {
    const el = $('intrusion-warning-overlay');
    if (!el) { resolve(); return; }
    el.classList.add('show');
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      el.classList.remove('show');
      el.onclick = null;
      setTimeout(resolve, 250);
    };
    el.onclick = close;
    setTimeout(close, 2600);
  });
}

// チーム戦では自分も相手も全員Lv50固定で、レベルを見せる意味がないため、Lv表示は出さない。
// （ランダム戦・対人戦は従来どおり表示する）
function shouldShowLevel() {
  return !(npcTeamState && npcTeamState.active);
}
// 表示用のレベル文字列。出さない時は空文字。prefix は 'Lv' か 'Lv.' など。
function levelText(poke, prefix) {
  return shouldShowLevel() && poke ? `${prefix || 'Lv'}${poke.level}` : '';
}

// NPC戦の相手ポケモンのレベル。チーム戦（自分の手持ちがLv50）は相手もLv50、ランダム戦は従来どおりLv100。
const NPC_TEAM_OPP_LEVEL = 50;
const NPC_RANDOM_OPP_LEVEL = 100;
// 乱入ボスだけはチーム戦でもLv60（通常の相手のLv50より少し強い）。ランダム戦は従来どおりLv100。
const NPC_TEAM_INTRUDER_LEVEL = 60;
function npcOpponentLevel() {
  return (npcTeamState && npcTeamState.active) ? NPC_TEAM_OPP_LEVEL : NPC_RANDOM_OPP_LEVEL;
}
function npcIntruderLevel() {
  return (npcTeamState && npcTeamState.active) ? NPC_TEAM_INTRUDER_LEVEL : NPC_RANDOM_OPP_LEVEL;
}

function startNextCpuBattle() {
  const bossBattle = isNextBattleBoss();
  state.isBossBattle = bossBattle;
  state.isIntrusionBattle = false;
  const oppLv = npcOpponentLevel();   // この戦いの相手全員（通常・メガ枠・ボス・乱入ボス）のレベル
  const intrusionId = (!bossBattle && !state.multiplayer && state.megaEvolutionEnabled)
    ? state.pendingIntrusionId : null;
  if (intrusionId != null) {
    // 乱入戦：1・2匹目は通常のランダム（メガシンカしない）、3匹目は乱入ボス（確定メガシンカ）。
    // 「3匹目のみメガシンカ」にするため、前の2匹には noMega を立ててメガ枠を使わせない。
    // 乱入ボスと同じ種族が前の2匹に混ざらないよう、重複したら引き直す
    let front = drawRandomTeam(2, oppLv);
    for (let t = 0; t < 20 && front.some((p) => p.speciesId === intrusionId); t++) front = drawRandomTeam(2, oppLv);
    front = front.filter((p) => p.speciesId !== intrusionId);
    while (front.length < 2) {
      const extra = drawRandomTeam(1, oppLv)[0];
      if (extra && extra.speciesId !== intrusionId) front.push(extra);
    }
    front.forEach((p) => { p.noMega = true; });
    const intruder = createRandomPokemon(intrusionId, npcIntruderLevel());
    intruder.noMega = false;
    intruder.isIntruder = true;
    state.cpuTeam = [...front, intruder];
    state.isIntrusionBattle = true;
  } else if (bossBattle) {
    if (npcTeamState.active) {
      // チーム戦ボス：1匹目は解放済みメガシンカ確定ポケモン、2匹目はランダム、
      // ラストにチーム戦専用ボス（ID1031）。
      const megaPoke = drawRandomMegaCapablePokemon(oppLv);
      const randomOne = drawRandomTeam(1, oppLv);
      const bossPoke = createRandomPokemon(BOSS_SPECIES_ID_TEAM, oppLv);
      state.cpuTeam = [megaPoke, ...randomOne, bossPoke].filter(Boolean);
    } else if (state.megaEvolutionEnabled) {
      // メガシンカあり：1匹目はメガシンカ確定ポケモン、2匹目はランダム、
      // ラストにメガあり専用ボス（ID1014）。
      const megaPoke = drawRandomMegaCapablePokemon(oppLv);
      const randomOne = drawRandomTeam(1, oppLv);
      const bossPoke = createRandomPokemon(BOSS_SPECIES_ID_MEGA, oppLv);
      state.cpuTeam = [megaPoke, ...randomOne, bossPoke].filter(Boolean);
    } else {
      const randomTwo = drawRandomTeam(2, oppLv);
      const bossPoke = createRandomPokemon(BOSS_SPECIES_ID, oppLv);
      state.cpuTeam = [...randomTwo, bossPoke];
    }
  } else {
    if (state.megaEvolutionEnabled) {
      // メガシンカあり：通常のNPC戦でも1匹は必ずメガシンカ可能な種族にする。
      // （残り2匹は通常通りランダム。3匹の並び順もシャッフルする）
      const megaPoke = drawRandomMegaCapablePokemon(oppLv);
      const randomTwo = drawRandomTeam(2, oppLv);
      state.cpuTeam = [megaPoke, ...randomTwo].filter(Boolean)
        .sort(() => Math.random() - 0.5);
    } else {
      state.cpuTeam = drawRandomTeam(3, oppLv);
    }
  }
  state.cpuTeam.forEach(resetPokeForBattle);
  state.playerTeam.forEach(resetPokeForBattle);
  state.playerActive = state.playerTeam.find((p) => !p.fainted) || state.playerTeam[0];
  state.cpuActive = state.cpuTeam[0];
  if (state.playerActive) state.playerActive.seenInBattle = true;
  if (state.cpuActive) state.cpuActive.seenInBattle = true;
  Pokedex.registerTeam(state.playerTeam);
  if (bossBattle) {
    const el = $('battle-field-bg');
    const bossBg = npcTeamState.active ? './mapboss2.png' : './mapboss.png';
    if (el) el.style.backgroundImage = `url("${bossBg}")`;
  } else {
    setRandomBattleBackground();
  }
  showScreen('battle');
  msgQueue = [];
  runBattleLoop();
}

/* ---------------- Initial pick ---------------- */
let pickPool = [];
let pickedIds = [];
let pickTimerInterval = null;
const PICK_TIME_LIMIT = 30;

function clearPickTimer() {
  if (pickTimerInterval) { clearInterval(pickTimerInterval); pickTimerInterval = null; }
  $('pick-timer-badge').style.display = 'none';
  $('pick-timer-badge').classList.remove('warn');
}

function startPickTimer(onTimeout) {
  clearPickTimer();
  let remaining = PICK_TIME_LIMIT;
  const badge = $('pick-timer-badge');
  const num = $('pick-timer-num');
  badge.style.display = 'flex';
  badge.classList.remove('warn');
  num.textContent = String(remaining);
  pickTimerInterval = setInterval(() => {
    remaining -= 1;
    num.textContent = String(Math.max(0, remaining));
    if (remaining <= 10) badge.classList.add('warn');
    if (remaining <= 0) {
      clearPickTimer();
      onTimeout();
    }
  }, 1000);
}

function pickCardHtml(poke, idx) {
  const t1 = poke.species.type1, t2 = poke.species.type2;
  const orderPos = pickedIds.indexOf(idx);
  const orderLabel = orderPos >= 0 ? `${orderPos + 1}` : '';
  return `
    <div class="trade-poke-card ${orderPos >= 0 ? 'selected' : ''}" data-idx="${idx}">
      <button class="tpc-info-btn" data-info-idx="${idx}" type="button"><span>!</span></button>
      ${orderPos >= 0 ? `<span class="pick-order-badge">${orderLabel}</span>` : ''}
      ${pokedexNewBadgeHtml(poke.speciesId)}
      <img src="${spritePath(poke)}" alt="${poke.species.name}" class="tpc-sprite"
           onerror="this.replaceWith(makeTeamCardFallback(${poke.speciesId}))">
      <div class="tpc-name">${tpcNameHtml(poke)}</div>
      <div class="tpc-types">
        ${typeChipHtml(t1)}
        ${t2 ? typeChipHtml(t2) : ''}
      </div>
    </div>
  `;
}

function renderPickRow() {
  $('pick-row').innerHTML = pickPool.map((p, idx) => pickCardHtml(p, idx)).join('');
  $('pick-count').textContent = `${pickedIds.length} / 3 選択中`;
  $('btn-pick-confirm').disabled = pickedIds.length !== 3;
}

function showInitialPickOverlay() {
  clearPickTimer();
  pickConfirmed = false;
  const ids = buildPickPoolIds();
  pickPool = ids.map((id) => createRandomPokemon(id, 100));
  pickedIds = [];
  renderPickRow();
  $('pick-overlay').classList.add('show');
}

$('pick-row').addEventListener('click', (e) => {
  const infoBtn = e.target.closest('.tpc-info-btn');
  if (infoBtn) {
    const idx = parseInt(infoBtn.dataset.infoIdx, 10);
    showTradeDetail(pickPool[idx]);
    return;
  }
  const card = e.target.closest('.trade-poke-card');
  if (!card) return;
  const idx = parseInt(card.dataset.idx, 10);
  const already = pickedIds.indexOf(idx);
  if (already >= 0) {
    pickedIds.splice(already, 1);
  } else if (pickedIds.length < 3) {
    pickedIds.push(idx);
  }
  renderPickRow();
});

let pickConfirmed = false;
function confirmPick() {
  if (pickConfirmed) return; // ボタン連打やタイマー競合による多重実行を防止
  pickConfirmed = true;
  clearPickTimer();
  // 未選択が残っている場合は左（先頭）から自動補完
  if (pickedIds.length < 3) {
    for (let i = 0; i < pickPool.length && pickedIds.length < 3; i++) {
      if (!pickedIds.includes(i)) pickedIds.push(i);
    }
  }
  state.playerTeam = pickedIds.slice(0, 3).map((idx) => pickPool[idx]);
  $('pick-overlay').classList.remove('show');
  if (state.multiplayer) {
    onMultiplayerPickConfirm();
  } else {
    renderReorderScreen();
  }
}

$('btn-pick-confirm').addEventListener('click', () => {
  if (pickedIds.length !== 3) return;
  confirmPick();
});

/* ---------------- Team reorder screen ---------------- */
let reorderMode = false;
let reorderArmedIdx = null;

function renderReorderScreen() {
  MenuBgm.start();
  reorderMode = false;
  reorderArmedIdx = null;
  $('btn-reorder-toggle').textContent = '並び替えをする';
  $('team-cards').classList.remove('reorder-mode');
  renderReorderCards();
  showScreen('team');
}

function renderReorderCards() {
  const cardsHtml = state.playerTeam.map((poke, idx) => {
    const armed = reorderMode && reorderArmedIdx === idx;
    const base = renderTeamCard(poke, idx);
    return base.replace(
      'class="trade-poke-card"',
      `class="trade-poke-card reorder-poke-card ${armed ? 'swap-armed' : ''}"`
    );
  }).join('');
  $('team-cards').innerHTML = cardsHtml;
}

$('btn-reorder-toggle').addEventListener('click', () => {
  reorderMode = !reorderMode;
  reorderArmedIdx = null;
  $('btn-reorder-toggle').textContent = reorderMode ? '並び替えをやめる' : '並び替えをする';
  $('team-cards').classList.toggle('reorder-mode', reorderMode);
  renderReorderCards();
});

$('team-cards').addEventListener('click', (e) => {
  const infoBtn = e.target.closest('.tpc-info-btn');
  if (infoBtn) {
    const idx = parseInt(infoBtn.dataset.infoIdx, 10);
    showTradeDetail(state.playerTeam[idx]);
    return;
  }
  if (!reorderMode) return;
  const card = e.target.closest('.reorder-poke-card');
  if (!card) return;
  const idx = parseInt(card.dataset.idx, 10);
  if (reorderArmedIdx === null) {
    reorderArmedIdx = idx;
  } else if (reorderArmedIdx === idx) {
    reorderArmedIdx = null;
  } else {
    const tmp = state.playerTeam[reorderArmedIdx];
    state.playerTeam[reorderArmedIdx] = state.playerTeam[idx];
    state.playerTeam[idx] = tmp;
    reorderArmedIdx = null;
  }
  renderReorderCards();
});

// 確認用（デバッグ）：「sayakadaisuki2」入力で立つ。ポケモンを選んだあと、最初の戦いが
// 「3戦目」扱いで乱入確定になる。乱入が起きるのは「メガあり」を選んだ時だけなので、
// 「メガなし」を選んだ場合はこのフラグは使われず破棄される。
let debugIntrusionTestPending = false;

function startNewRun(initialWinStreak, debugIntrusion) {
  MenuBgm.start();
  npcTeamEndRun();   // ランダム戦は「相手からもらう」を挟む通常フロー。チーム戦の状態は残さない
  state.multiplayer = false;
  setMegaLockActive(true); // NPC戦：乱入ボスのメガシンカは解放するまでロック
  state.winStreak = initialWinStreak || 0;
  resetIntrusionRun();
  debugIntrusionTestPending = !!debugIntrusion;
  showMegaChoiceOverlay();
}

// 確認用：最初の戦いを「3戦目・乱入確定」にして、乱入ボスを抽選する。
// 警告演出も出す（本番と同じ見た目で確認できるように）。
async function applyDebugIntrusionStart() {
  if (!debugIntrusionTestPending) return;
  debugIntrusionTestPending = false;
  if (state.multiplayer || !state.megaEvolutionEnabled) return; // メガなしでは乱入は起きない
  const remaining = getRemainingIntrusionBossIds();
  // 全員撃破済みなら、確認用として11体全員から選ぶ（実績はこの後の撃破でも重複解除しないだけ）
  const candidates = remaining.length > 0 ? remaining : INTRUSION_BOSS_IDS.filter((id) => GAME_DATA.species[id]);
  if (candidates.length === 0) return;
  state.runBattleCount = 3;
  state.intrusionBattleNo = 3;
  state.intrusionDone = true;
  state.pendingIntrusionId = candidates[Math.floor(Math.random() * candidates.length)];
  await showIntrusionWarning();
}

/* ---------------- メガシンカ有無選択（NPC対戦：選出の前に表示） ---------------- */
// 「メガあり」を選んだ場合のみ state.megaEvolutionEnabled を true にする。
// 「メガなし」を選んだ場合は必ず false にし、以降のバトルでお互いメガシンカできない。
function showMegaChoiceOverlay() {
  $('mega-choice-overlay').classList.add('show');
}

function hideMegaChoiceOverlay() {
  $('mega-choice-overlay').classList.remove('show');
}

function onMegaChoiceSelected(enabled) {
  hideMegaChoiceOverlay();
  // デバッグ用の「megatest」保留フラグが残っていても、ここで明示的に選んだ結果を
  // 必ず優先する。「メガなし」を選んだ場合は絶対にメガシンカを発生させない。
  state.megaEvolutionEnabled = !!enabled;
  if (!enabled) {
    debugMegaTestPending = false;
    debugIntrusionTestPending = false; // メガなしでは乱入が起きないので確認用設定は破棄
  }
  showInitialPickOverlay();
}

$('btn-mega-choice-on').addEventListener('click', () => onMegaChoiceSelected(true));
$('btn-mega-choice-off').addEventListener('click', () => onMegaChoiceSelected(false));

/* =========================================================
   マルチプレイ用UI
   ========================================================= */

function generateRoomId() {
  return String(Math.floor(Math.random() * 9000) + 1000);
}

function showMultiplayerMenu() {
  MenuBgm.start();
  showScreen('multiplayer');
}

function updateNameCharCount() {
  const codeLen = ($('input-room-code').value || '').length;
  $('code-char-count').textContent = codeLen;
}

function openNameModal() {
  // 「あいことばで入室」専用モーダル（ルーム作成は名前入力なしで即実行するため呼ばれない）
  MenuBgm.start(); // 既に再生中なら何もしない（MenuBgm.start内部でガード済み）
  $('name-modal-title').textContent = 'あいことばで入室';
  $('input-room-code').value = '';
  updateNameCharCount();
  $('name-modal').classList.add('show');
  setTimeout(() => {
    try { $('input-room-code').focus(); } catch (e) {}
  }, 60);
}

function closeNameModal() {
  $('name-modal').classList.remove('show');
}

function onNameModalConfirm() {
  const code = ($('input-room-code').value || '').trim();
  if (!/^\d{4}$/.test(code)) { $('input-room-code').focus(); return; }
  if (!state.playerName) state.playerName = PlayerProfile.get();
  closeNameModal();
  joinRoom(code);
}

/* ---- 相手が離脱した時の共通処理 ---- */
let roomClosedHandled = false;
function forceLeaveOnRoomClosed() {
  if (roomClosedHandled) return;
  roomClosedHandled = true;
  state.multiplayer = false;
  state.battleBusy = false;
  readyListenersWired = false;
  BattleBgm.stop();
  try { $('pick-overlay').classList.remove('show'); } catch (e) {}
  try { $('negotiate-overlay').classList.remove('show'); } catch (e) {}
  try { $('nego-wait-overlay').classList.remove('show'); } catch (e) {}
  try { $('result-overlay').classList.remove('show'); } catch (e) {}
  try { $('rematch-wait-overlay').classList.remove('show'); } catch (e) {}
  clearNegoTimer();
  clearPickTimer();
  Net.reset();
  MenuBgm.start();
  showScreen('title');
  showOpponentLeftNotice();
}

// ネイティブのalert()はOS側のダイアログとして扱われ、スマホで画面が強制的に縦回転する
// 不具合の原因になっていたため、ゲーム内の全画面オーバーレイに置き換えている。
// 「はい」を押すとタイトル画面に戻る（forceLeaveOnRoomClosed側ですでに戻っているので、
// ここではオーバーレイを閉じるだけでよい）。
function showOpponentLeftNotice() {
  const el = $('opponent-left-overlay');
  if (el) el.classList.add('show');
}
function closeOpponentLeftNotice() {
  const el = $('opponent-left-overlay');
  if (el) el.classList.remove('show');
}
$('btn-opponent-left-ok').addEventListener('click', () => {
  closeOpponentLeftNotice();
  showScreen('title');
});

/* ---- 準備完了ルーム（ソシャゲ風の1番/2番待機部屋） ---- */
let readyRoomState = { mine: false, opponent: false };
let readyBattleStarting = false;
let readyListenersWired = false;

// スロットの名前左に表示するお気に入りポケモンアイコンを更新する。
// favorite: { speciesId, shiny } または null/undefined。
function updateReadySlotFavicon(slotNum, favorite) {
  const wrap = $(`ready-slot-${slotNum}-favicon`);
  const fallback = $(`ready-slot-${slotNum}-fallback`);
  if (!wrap) return;
  const img = wrap.querySelector('img');
  if (favorite && favorite.speciesId !== undefined && favorite.speciesId !== null) {
    img.src = `./${favorite.speciesId}${favorite.shiny ? 's' : ''}.png`;
    wrap.classList.remove('is-hidden');
    if (fallback) fallback.classList.add('is-hidden');
  } else {
    img.src = '';
    wrap.classList.add('is-hidden');
    if (fallback) fallback.classList.remove('is-hidden');
  }
}

// 自分が現在ルーム内にいる時、図鑑でお気に入りを変更したら
// 表示中のスロット画像とサーバー上のmetaの両方を更新する。
function syncMyFavoriteToRoom() {
  if (!state.roomId) return;
  const fav = Pokedex.getFavorite();
  const mySlotNum = state.isHost ? 1 : 2;
  updateReadySlotFavicon(mySlotNum, fav);
  Net.updateMyFavorite(fav);
}

function renderReadyRoom() {
  const meName = state.playerName || '';
  const oppName = state.opponentName || Net.opponentName || '';
  const myFavorite = Pokedex.getFavorite();
  const oppFavorite = Net.opponentFavorite || null;

  const slot1Name = state.isHost ? meName : oppName;
  const slot2Name = state.isHost ? oppName : meName;
  const slot1Favorite = state.isHost ? myFavorite : oppFavorite;
  const slot2Favorite = state.isHost ? oppFavorite : myFavorite;
  const slot1Ready = state.isHost ? readyRoomState.mine : readyRoomState.opponent;
  const slot2Ready = state.isHost ? readyRoomState.opponent : readyRoomState.mine;

  const nameEl1 = $('ready-slot-1-name');
  const nameEl2 = $('ready-slot-2-name');
  nameEl1.textContent = slot1Name || '-';
  nameEl1.classList.toggle('is-empty', !slot1Name);
  nameEl2.textContent = slot2Name || '相手を待っています…';
  nameEl2.classList.toggle('is-empty', !slot2Name);

  updateReadySlotFavicon(1, slot1Name ? slot1Favorite : null);
  updateReadySlotFavicon(2, slot2Name ? slot2Favorite : null);

  $('ready-slot-1').classList.toggle('is-ready', !!slot1Ready);
  $('ready-slot-2').classList.toggle('is-ready', !!slot2Ready);
  $('ready-slot-1-badge').textContent = slot1Ready ? '準備完了' : '未準備';
  $('ready-slot-2-badge').textContent = slot2Ready ? '準備完了' : '未準備';

  const isTeamFormat = Net.battleFormat === 'team';
  // チーム戦は6匹あるチームを1つ選ぶまで「準備完了」を押せないようにする
  // （選んでいなければ chosen team を無効化して押させない）。
  const teamChosen = !isTeamFormat || state.mpChosenTeamIdx >= 0;

  const btn = $('btn-ready-toggle');
  const opponentPresent = !!oppName;
  btn.disabled = !opponentPresent || !teamChosen;
  btn.textContent = readyRoomState.mine ? '取り消す' : '準備完了';
  btn.classList.toggle('primary', !readyRoomState.mine);

  const chooseBtn = $('btn-choose-mp-team');
  chooseBtn.style.display = isTeamFormat ? '' : 'none';
  chooseBtn.textContent = state.mpChosenTeamIdx >= 0
    ? `チーム変更（${sbState.parties[state.mpChosenTeamIdx] ? sbState.parties[state.mpChosenTeamIdx].name : ''}）`
    : 'チームを選ぶ';
  chooseBtn.disabled = readyRoomState.mine;

  $('host-wait-hint').textContent = !opponentPresent
    ? '友達にこの4ケタの番号を伝えてください'
    : (readyRoomState.mine ? '相手の準備を待っています…' : (
        isTeamFormat && state.mpChosenTeamIdx < 0
          ? 'まずチームを選んでください'
          : 'じゅんびができたら「準備完了」を押してください'
      ));

  renderMegaSettingRow();
  renderFormatSettingRow();
}

// メガシンカ設定の表示更新。
// ホスト：タップして切り替えられる（見た目もボタンらしく）。
// ゲスト：ホストが決めた設定を見るだけ（タップ不可）。
// チーム戦は常にメガありで固定（NPCのチーム戦と同じ仕様）のため、タップ不可にする。
function renderMegaSettingRow() {
  const row = $('mega-setting-row');
  const switchEl = $('mega-setting-switch');
  const offBtn = $('btn-mega-setting-off');
  const onBtn = $('btn-mega-setting-toggle');
  const isTeamFormat = Net.battleFormat === 'team';
  const enabled = isTeamFormat ? true : !!Net.megaEnabled;
  switchEl.classList.toggle('is-on', enabled);
  const editable = state.isHost && !isTeamFormat;
  row.classList.toggle('readonly', !editable);
  offBtn.disabled = !editable;
  onBtn.disabled = !editable;
}

// 対戦方式（ランダム／チーム）トグルの表示更新。
// ホスト：タップして切り替えられる。ゲスト：見るだけ。
function renderFormatSettingRow() {
  const row = $('format-setting-row');
  const switchEl = $('format-setting-switch');
  const randomBtn = $('btn-format-setting-random');
  const teamBtn = $('btn-format-setting-team');
  const isTeamFormat = Net.battleFormat === 'team';
  switchEl.classList.toggle('is-on', isTeamFormat);
  row.classList.toggle('readonly', !state.isHost);
  randomBtn.disabled = !state.isHost;
  teamBtn.disabled = !state.isHost;
}

function wireReadyRoomListeners() {
  if (readyListenersWired) return;
  readyListenersWired = true;
  Net.onRoomClosed(() => forceLeaveOnRoomClosed());

  Net.onReadyChange(({ mine, opponent }) => {
    readyRoomState.mine = mine;
    readyRoomState.opponent = opponent;
    renderReadyRoom();
    if (mine && opponent && !readyBattleStarting) {
      readyBattleStarting = true;
      setTimeout(() => { startMultiplayerPick(); }, 500);
    }
  });

  Net.onOpponentFavoriteChange(() => {
    renderReadyRoom();
  });

  Net.onMegaEnabledChange(() => {
    renderMegaSettingRow();
  });

  Net.onBattleFormatChange(() => {
    // 対戦方式が変わったら、選んでいたチームの選択は無効化する（ランダム⇔チーム切替時の事故防止）
    state.mpChosenTeamIdx = -1;
    renderReadyRoom();
  });
}

async function startHostRoom() {
  roomClosedHandled = false;
  readyBattleStarting = false;
  readyListenersWired = false;
  readyRoomState = { mine: false, opponent: false };
  state.isHost = true;
  state.mpChosenTeamIdx = -1;
  let code = null;
  const myFavorite = Pokedex.getFavorite();
  Net.megaEnabled = false; // ルームごとにデフォルトは「メガなし」。ホストが待機部屋で切り替え可能。
  Net.battleFormat = 'random'; // ルームごとにデフォルトは「ランダム」。ホストが待機部屋で切り替え可能。
  for (let i = 0; i < 8; i++) {
    const candidate = generateRoomId();
    const r = await Net.createRoom(candidate, state.playerName, myFavorite, Net.megaEnabled, Net.battleFormat);
    if (r === 'ok') { code = candidate; break; }
  }
  if (!code) {
    alert('ルーム作成に失敗しました。firebase-config.js と通信環境を確認してください。');
    showMultiplayerMenu();
    return;
  }
  state.roomId = code;
  state.opponentName = '';
  $('host-room-id').textContent = code;
  renderReadyRoom();
  showScreen('host-waiting');
  MenuBgm.start();

  wireReadyRoomListeners();

  Net.onGuestJoined((guestName) => {
    state.opponentName = guestName;
    renderReadyRoom();
  });
}

async function joinRoom(code) {
  roomClosedHandled = false;
  readyBattleStarting = false;
  readyListenersWired = false;
  readyRoomState = { mine: false, opponent: false };
  state.isHost = false;
  state.mpChosenTeamIdx = -1;
  const r = await Net.joinRoom(code, state.playerName, Pokedex.getFavorite());
  if (r === 'not-found') { alert('そのルームは見つかりませんでした。'); return; }
  if (r === 'full') { alert('そのルームは満員、またはすでに対戦中です。'); return; }
  if (r === 'error') { alert('接続に失敗しました。'); return; }
  state.roomId = code;
  state.opponentName = Net.opponentName || '';
  $('host-room-id').textContent = code;
  renderReadyRoom();
  showScreen('host-waiting');
  MenuBgm.start();

  wireReadyRoomListeners();
}

function cancelHostRoom() {
  Net.leave();
  state.roomId = null;
  state.isHost = false;
  state.mpChosenTeamIdx = -1;
  readyRoomState = { mine: false, opponent: false };
  readyListenersWired = false;
  showMultiplayerMenu();
}

function toggleReady() {
  // チーム戦なのにチームが未選択の場合は準備完了させない（ボタン自体もdisabledだが念のため二重ガード）
  if (Net.battleFormat === 'team' && state.mpChosenTeamIdx < 0) return;
  const next = !readyRoomState.mine;
  readyRoomState.mine = next;
  renderReadyRoom();
  Net.setReady(next);
}

/* ---- 対戦方式トグル（ホストのみ操作可） ---- */
$('btn-format-setting-random').addEventListener('click', () => {
  if (!state.isHost) return;
  if (readyRoomState.mine) return; // 準備完了中は変更不可
  Net.setBattleFormat('random');
  state.mpChosenTeamIdx = -1;
  renderReadyRoom();
});
$('btn-format-setting-team').addEventListener('click', () => {
  if (!state.isHost) return;
  if (readyRoomState.mine) return;
  Net.setBattleFormat('team');
  state.mpChosenTeamIdx = -1;
  renderReadyRoom();
});

/* ---- 対人戦チーム戦：使うチームを選ぶ ---- */
$('btn-choose-mp-team').addEventListener('click', () => {
  openMpTeamSelect();
});
$('mp-team-btn-back').addEventListener('click', () => {
  showScreen('host-waiting');
  renderReadyRoom();
});

function mpTeamRender() {
  const el = $('mp-team-scroller');
  el.innerHTML = sbState.parties.map(sbPartyColHtml).join('');
  el.querySelectorAll('.ps-col.current').forEach((c) => c.classList.remove('current'));
  if (state.mpChosenTeamIdx >= 0) {
    const chosen = el.querySelector(`[data-ps-idx="${state.mpChosenTeamIdx}"]`);
    if (chosen) chosen.classList.add('current');
  }
}

function openMpTeamSelect() {
  // sbState.parties は本格バトル画面を開くまで復元されないため、必ずここで用意する
  sbBuildBox();
  mpTeamRender();
  showScreen('mp-team');
  $('mp-team-scroller').scrollLeft = 0;
}

let mpTeamToastTimer = null;
function mpTeamToast(text) {
  let el = $('mp-team-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'mp-team-toast';
    el.className = 'pokedex-toast';
    document.getElementById('app').appendChild(el);
  }
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(mpTeamToastTimer);
  mpTeamToastTimer = setTimeout(() => el.classList.remove('show'), 1800);
}

$('mp-team-scroller').addEventListener('click', async (e) => {
  const col = e.target.closest('[data-ps-idx]');
  if (!col) return;
  const i = parseInt(col.dataset.psIdx, 10);
  if (!(i >= 0 && i < SB_PARTY_COUNT)) return;
  const pt = sbState.parties[i];
  const members = Array.isArray(pt.snapshot) ? pt.snapshot : [];
  // 選出は「6匹の中から3匹」なので、6匹そろっていないパーティーは使えない
  if (members.length < 6) {
    mpTeamToast(members.length === 0 ? `${pt.name}は 保存されていません` : `${pt.name}は ${members.length}匹しかいません（6匹必要です）`);
    return;
  }
  const ok = await askConfirm(`${pt.name}を つかいますか？`);
  if (!ok) return;
  state.mpChosenTeamIdx = i;
  showScreen('host-waiting');
  renderReadyRoom();
});

/* ---- 対人戦：未解放メガシンカの制限 ----
   乱入ボス11体のメガシンカは、各プレイヤーの端末（localStorage）で「解放」しないと使えない。
   対人戦は setMegaLockActive(false) でロック判定自体は無効にしているため（相手の解放状況は
   こちらからは分からない）、代わりに「持ち主の解放状況」を各ポケモンの noMega フラグに焼き込み、
   その値を通信で相手にも伝える（net.js の nm）。バトル本体（ホスト権威）は canMegaEvolve が
   poke.noMega を最優先で見るので、ホスト側・ゲスト側どちらのポケモンでも、
   持ち主が未解放のメガシンカは発動しなくなる。 */
function applyMegaOwnerLock(team) {
  (team || []).forEach((p) => {
    if (!p) return;
    // 乱入ボス以外は常に解放済み扱い（isMegaUnlocked が true を返す）ので noMega は立たない。
    // 「自分の端末で解放済みか」だけで決める。交換で他人から受け取った個体も、
    // 今の持ち主（自分）の解放状況で判定し直す。
    p.noMega = !isMegaUnlocked(p.speciesId);
  });
}

/* ---- 選出 ---- */
function startMultiplayerPick() {
  MenuBgm.start();
  state.multiplayer = true;
  state.mpBattleFormat = Net.battleFormat === 'team' ? 'team' : 'random';
  setMegaLockActive(false); // 対人戦：ロックなし（従来どおり）
  state.winStreak = 0;
  state.opponentName = Net.opponentName || '';
  readyBattleStarting = false;
  readyRoomState = { mine: false, opponent: false };
  pickConfirmed = false;

  if (state.mpBattleFormat === 'team') {
    startMpTeamPick();
    return;
  }

  // ホストが待機部屋で決めたメガシンカ設定を、この対戦の状態に反映する。
  // ホスト・ゲストどちらも Net.megaEnabled を見て同じ値になる（あり/なしはお互い共通）。
  state.megaEvolutionEnabled = !!Net.megaEnabled;
  const ids = buildPickPoolIds();
  pickPool = ids.map((id) => createRandomPokemon(id, 100));
  pickedIds = [];
  renderPickRow();
  $('pick-overlay').classList.add('show');
  startPickTimer(() => { confirmPick(); });
}

/* =========================================================
   対人戦チーム戦：選出画面（公式対戦の選出画面を再現）
   左＝自分（6匹から3匹、タップした順に選出）／右＝相手（表示のみ）
   選出プールそのもの（6匹の顔ぶれ）はお互いに見えるが、
   相手が実際に何番目にどれを選んだかは見えない。
   ========================================================= */
const MP_PICK_COUNT = 3;
const MP_PICK_TIME_LIMIT = 60;
let mpPickTimerInterval = null;
let mpPickedIds = [];
let mpPickConfirmed = false;
let mpOpponentPoolReceived = false;
// 対人チーム戦：選出フェーズで見えた相手の6匹プール全体。実際の選出（cpuTeam＝3匹）とは別に
// バトル終了まで保持しておき、交代画面の「あいてのパーティー」に常に6匹全員を出すのに使う。
let mpOpponentFullPool = [];

function clearMpPickTimer() {
  if (mpPickTimerInterval) { clearInterval(mpPickTimerInterval); mpPickTimerInterval = null; }
}

function startMpPickTimer(onTimeout) {
  clearMpPickTimer();
  let remaining = MP_PICK_TIME_LIMIT;
  const num = $('mp-pick-timer-num');
  num.textContent = String(remaining);
  mpPickTimerInterval = setInterval(() => {
    remaining -= 1;
    num.textContent = String(Math.max(0, remaining));
    if (remaining <= 0) {
      clearMpPickTimer();
      onTimeout();
    }
  }, 1000);
}

function startMpTeamPick() {
  state.megaEvolutionEnabled = true; // チーム戦は常にメガあり
  mpPickConfirmed = false;
  mpOpponentPoolReceived = false;
  mpOpponentFullPool = []; // 新しい選出フェーズの開始時に前回対戦分の古いプールを必ず捨てる

  // 待機部屋で選んだ自分のチーム（6匹）を選出プールにする
  const pt = sbState.parties[state.mpChosenTeamIdx];
  const members = (pt && Array.isArray(pt.snapshot)) ? pt.snapshot.slice(0, 6) : [];
  pickPool = members.map((d) => sbRestorePoke(sbSerializePoke(d))).filter(Boolean);
  if (pickPool.length < 6) {
    // 万一チームが壊れていた場合の保険：ランダムで埋める
    const ids = buildPickPoolIds();
    while (pickPool.length < 6) pickPool.push(createRandomPokemon(ids[pickPool.length % ids.length], 100));
  }
  // 未解放のメガシンカは「使えない」印を、最初の描画（mega.pngの表示判定）より前に付ける。
  // 描画の後に付けると、最初の1回だけ未解放のメガアイコンが見えてしまう。
  // この印は下の sendPickPool で相手にも伝わる。
  applyMegaOwnerLock(pickPool);
  mpPickedIds = [];

  $('mp-pick-self-name').textContent = state.playerName || '';
  $('mp-pick-opp-name').textContent = state.opponentName || Net.opponentName || '';

  renderMpPickSelfList();
  renderMpPickOppList(null); // まだ相手のプールは届いていない
  showScreen('mp-pick');
  startMpPickTimer(() => { confirmMpPick(); });

  // 選出中にお互いの持ち込んだ6匹（プール全体）を見られるようにする
  Net.sendPickPool(pickPool).catch(() => {});
  Net.onOpponentPickPool((oppPool) => {
    mpOpponentPoolReceived = true;
    mpOpponentFullPool = oppPool;
    renderMpPickOppList(oppPool);
  });
}

// ♂♀は表示せず、メガシンカ可能なら名前の右に mega.png（このバトルは常にメガあり）
function mpPickMegaHtml(p) {
  if (!canMegaEvolve(p)) return '';
  return '<img class="mp-pick-card-mega" src="./mega.png" alt="メガ" onerror="this.style.display=\'none\'">';
}

function mpPickSpriteHtml(p) {
  const id = p.speciesId;
  return `<img class="mp-pick-card-sprite" src="${spritePath(p)}" alt="" onerror="this.outerHTML='<span class=&quot;mp-pick-card-sprite-fb&quot;>#${id}</span>'">`;
}

function mpPickSelfCardHtml(p, idx) {
  const order = mpPickedIds.indexOf(idx);
  const picked = order >= 0;
  return `<div class="mp-pick-card${picked ? ' picked' : ''}" data-mp-idx="${idx}" role="button">
    ${mpPickSpriteHtml(p)}
    <div class="mp-pick-card-info">
      <span class="mp-pick-card-name">${p.species.name}</span>
      ${mpPickMegaHtml(p)}
    </div>
    ${picked ? `<span class="mp-pick-order">${order + 1}</span>` : ''}
    <button class="mp-pick-card-info-btn" data-mp-info="${idx}" type="button" aria-label="くわしく見る"><span>!</span></button>
  </div>`;
}

// 相手のポケモンは「見た目（種族・メガシンカ可否）」だけが分かればよく、
// 努力値・実数値・特性・技構成といった本来対戦相手には分からない情報を
// showTradeDetail（自分用の詳細パネル）で見せてしまわないよう、詳細ボタン自体を設けない。
function mpPickOppCardHtml(p, idx) {
  return `<div class="mp-pick-card" data-mp-opp-idx="${idx}" role="button">
    ${mpPickSpriteHtml(p)}
    <div class="mp-pick-card-info">
      <span class="mp-pick-card-name">${p.species.name}</span>
      ${mpPickMegaHtml(p)}
    </div>
  </div>`;
}

function renderMpPickSelfList() {
  $('mp-pick-self-list').innerHTML = pickPool.map(mpPickSelfCardHtml).join('');
  const n = mpPickedIds.length;
  $('mp-pick-count').textContent = `${n}/${MP_PICK_COUNT}`;
  $('mp-pick-btn-ok').classList.toggle('ready', n === MP_PICK_COUNT);
}

function renderMpPickOppList(oppPool) {
  const list = $('mp-pick-opp-list');
  if (oppPool && oppPool.length) {
    list.innerHTML = oppPool.map(mpPickOppCardHtml).join('');
  } else {
    list.innerHTML = '<div class="mp-pick-waiting-row">相手の手持ちを読み込んでいます…</div>';
  }
}

$('mp-pick-self-list').addEventListener('click', (e) => {
  const info = e.target.closest('[data-mp-info]');
  if (info) {
    const idx = parseInt(info.dataset.mpInfo, 10);
    if (pickPool[idx]) showTradeDetail(pickPool[idx]);
    return;
  }
  const card = e.target.closest('[data-mp-idx]');
  if (!card) return;
  const idx = parseInt(card.dataset.mpIdx, 10);
  const at = mpPickedIds.indexOf(idx);
  if (at >= 0) {
    mpPickedIds.splice(at, 1); // もう一度タップで外す（後ろの番号は繰り上がる）
  } else if (mpPickedIds.length < MP_PICK_COUNT) {
    mpPickedIds.push(idx); // タップした順が1番目・2番目・3番目
  }
  renderMpPickSelfList();
});

// 相手側リストは表示専用（詳細ボタンなし）のため、クリックイベントは登録しない。

function confirmMpPick() {
  if (mpPickConfirmed) return; // ボタン連打やタイマー競合による多重実行を防止
  mpPickConfirmed = true;
  clearMpPickTimer();
  // 未選択が残っている場合は左（先頭）から自動補完
  if (mpPickedIds.length < MP_PICK_COUNT) {
    for (let i = 0; i < pickPool.length && mpPickedIds.length < MP_PICK_COUNT; i++) {
      if (!mpPickedIds.includes(i)) mpPickedIds.push(i);
    }
  }
  state.playerTeam = mpPickedIds.slice(0, MP_PICK_COUNT).map((idx) => pickPool[idx]);
  onMultiplayerPickConfirm();
}

$('mp-pick-btn-ok').addEventListener('click', () => {
  if (mpPickedIds.length !== MP_PICK_COUNT) return;
  confirmMpPick();
});

/* =========================================================
   選出後の交換フェーズ（対人戦のみ）
   手持ち1/2/3 → 決定 / 入れ替える / 手持ちを変える（最大5回）
   ========================================================= */
const NEGO_TIME_LIMIT = 30;
const NEGO_SWAP_MAX = 5;
let negoTimerInterval = null;
let negoSwapsLeft = NEGO_SWAP_MAX;
let negoArmedIdx = null;

function clearNegoTimer() {
  if (negoTimerInterval) { clearInterval(negoTimerInterval); negoTimerInterval = null; }
}

function startNegoTimer(onTimeout) {
  clearNegoTimer();
  let remaining = NEGO_TIME_LIMIT;
  const badge = $('nego-timer-badge');
  const num = $('nego-timer-num');
  badge.classList.remove('warn');
  num.textContent = String(remaining);
  negoTimerInterval = setInterval(() => {
    remaining -= 1;
    num.textContent = String(Math.max(0, remaining));
    if (remaining <= 10) badge.classList.add('warn');
    if (remaining <= 0) {
      clearNegoTimer();
      onTimeout();
    }
  }, 1000);
}

function startNegoTimer(onTimeout) {
  clearNegoTimer();
  let remaining = NEGO_TIME_LIMIT;
  const badge = $('nego-timer-badge');
  const num = $('nego-timer-num');
  badge.classList.remove('warn');
  num.textContent = String(remaining);
  negoTimerInterval = setInterval(() => {
    remaining -= 1;
    num.textContent = String(Math.max(0, remaining));
    if (remaining <= 10) badge.classList.add('warn');
    if (remaining <= 0) {
      clearNegoTimer();
      onTimeout();
    }
  }, 1000);
}

/* ---- 「手持ちを変える」中（ランダム提示〜交換相手選び）専用のタイマー ----
   negotiate-overlay用のタイマーとは独立しており、この間はnegotiate側の
   タイマーを止めておく。時間切れの場合は選択をキャンセルして
   negotiate-overlay に戻り、そこで通常タイマーを仕切り直す。 */
let negoSwapTimerInterval = null;
function clearNegoSwapTimer() {
  if (negoSwapTimerInterval) { clearInterval(negoSwapTimerInterval); negoSwapTimerInterval = null; }
}
function startNegoSwapTimer(onTimeout) {
  clearNegoSwapTimer();
  let remaining = NEGO_TIME_LIMIT;
  const badges = [$('nego-swap-timer-badge'), $('nego-swap-timer-badge-2')];
  const nums = [$('nego-swap-timer-num'), $('nego-swap-timer-num-2')];
  badges.forEach((b) => b && b.classList.remove('warn'));
  nums.forEach((n) => { if (n) n.textContent = String(remaining); });
  negoSwapTimerInterval = setInterval(() => {
    remaining -= 1;
    nums.forEach((n) => { if (n) n.textContent = String(Math.max(0, remaining)); });
    if (remaining <= 10) badges.forEach((b) => b && b.classList.add('warn'));
    if (remaining <= 0) {
      clearNegoSwapTimer();
      onTimeout();
    }
  }, 1000);
}

function negoCardHtml(p, idx) {
  const effectiveTypes = getEffectiveTypesForDisplay(p);
  const typeDisplay = effectiveTypes.map(t => typeChipHtml(t)).join('');
  return `
    <div class="trade-poke-card" data-idx="${idx}">
      <button class="tpc-info-btn" data-info-idx="${idx}" type="button"><span>!</span></button>
      ${pokedexNewBadgeHtml(p.speciesId)}
      <img src="${spritePath(p)}" alt="${p.species.name}" class="tpc-sprite"
           onerror="this.replaceWith(makeTeamCardFallback(${p.speciesId}))">
      <div class="tpc-name">${tpcNameHtml(p)}</div>
      <div class="tpc-types">${typeDisplay}</div>
    </div>
  `;
}

function renderNegoCards() {
  $('nego-cards').innerHTML = state.playerTeam.map((p, idx) => negoCardHtml(p, idx)).join('');
  $('nego-swap-count').textContent = `交換のこり ${negoSwapsLeft}回`;
  $('btn-nego-swap').disabled = negoSwapsLeft <= 0;
}

$('nego-cards').addEventListener('click', (e) => {
  const infoBtn = e.target.closest('.tpc-info-btn');
  if (infoBtn) {
    const idx = parseInt(infoBtn.dataset.infoIdx, 10);
    showTradeDetail(state.playerTeam[idx]);
  }
});

function runNegotiatePhase() {
  return new Promise((resolve) => {
    negoSwapsLeft = NEGO_SWAP_MAX;
    negoArmedIdx = null;
    renderNegoCards();
    $('nego-hint').textContent = '';
    $('negotiate-overlay').classList.add('show');

    let finished = false;
const finishMine = async () => {
  if (finished) return;
  finished = true;
  clearNegoTimer();
  $('negotiate-overlay').classList.remove('show');
  $('nego-wait-overlay').classList.add('show');

  // ★修正の核心★
  // 先に相手の完了を「購読」してから、自分の done を立てる。
  // 逆順だと、相手が先に完了→clearNego() した瞬間に nego ノード全体が消え、
  // まだ購読していない側は null を掴んだまま永久に解決できなくなる
  // （＝「相手の選出を待っています…」フリーズ）。
  const waitOpponent = new Promise((res) => {
    let settled = false;
    const unsub = Net.onOpponentNegoDone((done) => {
      if (settled) return;
      if (done) {
        settled = true;
        if (unsub) unsub();
        res();
      }
    });
    // 安全弁：5秒待っても相手の done が見えない場合はタイムアウトで先に進む。
    setTimeout(() => {
      if (settled) return;
      settled = true;
      if (unsub) unsub();
      console.warn('[nego] 相手の done を待てずタイムアウトしました。続行します。');
      res();
    }, 5000);
  });

  // 購読を張ったあとに自分の done を立てる
  await Net.setNegoDone(true);

  // 相手の完了（またはタイムアウト）を待つ
  await waitOpponent;

  $('nego-wait-overlay').classList.remove('show');
  // nego データの削除は片方（ホスト）だけが行う。
  // 両者が同時に削除を行うと、片方の削除が相手の「相手完了」読み取りより先に
  // Firebase上で反映されてしまい、相手が hostDone/guestDone を一生観測できず
  // 永久に待機し続けるバグ（対戦が始まらない）につながるため。
  if (state.isHost) {
    await Net.clearNego();
  }
  resolve();
};

    const onConfirmClick = () => {
      $('btn-nego-confirm').removeEventListener('click', onConfirmClick);
      $('btn-nego-reorder').removeEventListener('click', onReorderClick);
      $('btn-nego-swap').removeEventListener('click', onSwapClick);
      finishMine();
    };
    const onReorderClick = () => {
      openNegoReorderOverlay();
    };
    const onSwapClick = () => {
      if (negoSwapsLeft <= 0) return;
      // スワップ選択中はnegotiate-overlay用タイマーを止め、専用タイマーに切り替える。
      clearNegoTimer();
      const backToNegotiate = () => {
        renderNegoCards();
        $('negotiate-overlay').classList.add('show');
        startNegoTimer(() => {
          $('btn-nego-confirm').removeEventListener('click', onConfirmClick);
          $('btn-nego-reorder').removeEventListener('click', onReorderClick);
          $('btn-nego-swap').removeEventListener('click', onSwapClick);
          finishMine();
        });
      };
      openNegoSwapOverlay(
        () => {
          // 交換完了
          negoSwapsLeft -= 1;
          backToNegotiate();
        },
        () => {
          // 時間切れによるキャンセル：何も交換せずに選出画面へ戻る
          backToNegotiate();
        }
      );
    };

    $('btn-nego-confirm').addEventListener('click', onConfirmClick);
    $('btn-nego-reorder').addEventListener('click', onReorderClick);
    $('btn-nego-swap').addEventListener('click', onSwapClick);

    startNegoTimer(() => {
      $('btn-nego-confirm').removeEventListener('click', onConfirmClick);
      $('btn-nego-reorder').removeEventListener('click', onReorderClick);
      $('btn-nego-swap').removeEventListener('click', onSwapClick);
      finishMine();
    });
  });
}

/* ---- 入れ替える ---- */
function openNegoReorderOverlay() {
  negoArmedIdx = null;
  renderNegoReorderCards();
  $('negotiate-overlay').classList.remove('show');
  $('nego-reorder-overlay').classList.add('show');
}

function renderNegoReorderCards() {
  const cardsHtml = state.playerTeam.map((poke, idx) => {
    const armed = negoArmedIdx === idx;
    const base = negoCardHtml(poke, idx);
    return base.replace(
      'class="trade-poke-card"',
      `class="trade-poke-card ${armed ? 'swap-armed' : ''}"`
    );
  }).join('');
  $('nego-reorder-cards').innerHTML = cardsHtml;
}

$('nego-reorder-cards').addEventListener('click', (e) => {
  const infoBtn = e.target.closest('.tpc-info-btn');
  if (infoBtn) {
    const idx = parseInt(infoBtn.dataset.infoIdx, 10);
    showTradeDetail(state.playerTeam[idx]);
    return;
  }
  const card = e.target.closest('.trade-poke-card');
  if (!card) return;
  const idx = parseInt(card.dataset.idx, 10);
  if (negoArmedIdx === null) {
    negoArmedIdx = idx;
  } else if (negoArmedIdx === idx) {
    negoArmedIdx = null;
  } else {
    const tmp = state.playerTeam[negoArmedIdx];
    state.playerTeam[negoArmedIdx] = state.playerTeam[idx];
    state.playerTeam[idx] = tmp;
    negoArmedIdx = null;
  }
  renderNegoReorderCards();
});

$('btn-nego-reorder-done').addEventListener('click', () => {
  $('nego-reorder-overlay').classList.remove('show');
  renderNegoCards();
  $('negotiate-overlay').classList.add('show');
});

/* ---- 手持ちを変える（ランダム3匹から1匹→手持ちの1匹と交換） ---- */
let negoSwapPool = [];

function openNegoSwapOverlay(onDone, onCancel) {
  const ids = [...getFinalSpeciesIds()].sort(() => Math.random() - 0.5).slice(0, 3);
  negoSwapPool = ids.map((id) => createRandomPokemon(id, 100));
  const offerRow = $('nego-swap-offer-row');
  offerRow.innerHTML = negoSwapPool.map((p, idx) => tradeCardHtml(p, idx, false)).join('');
  $('negotiate-overlay').classList.remove('show');
  $('nego-swap-overlay').classList.add('show');

  // 「やめる」で選び直し（リセマラ）できないよう、一度開いたら必ず1匹選んで交換する仕様。
  // ただし、時間切れの場合は交換自体をキャンセルして選出画面（negotiate-overlay）に戻す。

  let settled = false;
  startNegoSwapTimer(() => {
    if (settled) return;
    settled = true;
    offerRow.removeEventListener('click', onOfferClick);
    $('nego-swap-overlay').classList.remove('show');
    onCancel();
  });

  const onOfferClick = async (e) => {
    const infoBtn = e.target.closest('.tpc-info-btn');
    if (infoBtn) {
      const idx = parseInt(infoBtn.dataset.infoIdx, 10);
      showTradeDetail(negoSwapPool[idx]);
      return;
    }
    const card = e.target.closest('.trade-poke-card');
    if (!card) return;
    const offerIdx = parseInt(card.dataset.idx, 10);
    const chosen = negoSwapPool[offerIdx];
    const ok = await askConfirm(`${chosen.species.name}をもらいますか？`);
    if (!ok) return;
    if (settled) return;
    offerRow.removeEventListener('click', onOfferClick);
    clearNegoSwapTimer();
    $('nego-swap-overlay').classList.remove('show');
    openNegoSwapReplaceOverlay(chosen, onDone, onCancel);
  };

  offerRow.addEventListener('click', onOfferClick);
}

function openNegoSwapReplaceOverlay(incoming, onDone, onCancel) {
  const replaceOverlay = $('nego-swap-replace-overlay');
  const replaceRow = $('nego-swap-replace-row');
  $('nego-swap-replace-title').textContent = `${incoming.species.name}と交換するポケモンをえらんでください`;
  replaceRow.innerHTML = state.playerTeam.map((p, idx) => tradeCardHtml(p, idx, false)).join('');
  replaceOverlay.classList.add('show');

  let settled = false;
  startNegoSwapTimer(() => {
    if (settled) return;
    settled = true;
    replaceRow.removeEventListener('click', onReplaceClick);
    replaceOverlay.classList.remove('show');
    onCancel();
  });

  const onReplaceClick = async (e) => {
    const infoBtn = e.target.closest('.tpc-info-btn');
    if (infoBtn) {
      const idx = parseInt(infoBtn.dataset.infoIdx, 10);
      showTradeDetail(state.playerTeam[idx]);
      return;
    }
    const card = e.target.closest('.trade-poke-card');
    if (!card) return;
    const replaceIdx = parseInt(card.dataset.idx, 10);
    const outgoing = state.playerTeam[replaceIdx];
    const ok = await askConfirm(`${outgoing.species.name}と${incoming.species.name}を交換しますか？`);
    if (!ok) return;
    if (settled) return;
    settled = true;
    clearNegoSwapTimer();
    replaceRow.removeEventListener('click', onReplaceClick);
    replaceOverlay.classList.remove('show');
    $('negotiate-overlay').classList.add('show');

    const incomingCopy = Object.assign({}, incoming);
    incomingCopy.moves = incoming.moves.map((m) => Object.assign({}, m));
    resetPokeForBattle(incomingCopy);
    state.playerTeam[replaceIdx] = incomingCopy;

    onDone();
  };
  replaceRow.addEventListener('click', onReplaceClick);
}

async function onMultiplayerPickConfirm() {
  state.playerTeam.forEach(resetPokeForBattle);

  // ---- 選出後の交換フェーズ ----
  // チーム戦は「お互い自分のチームのまま」戦うため、交換フェーズは行わない。
  if (state.mpBattleFormat !== 'team') {
    await runNegotiatePhase();
  }

  // チーム戦で使った選出プール（6匹）の共有データはもう不要なので片付ける
  if (state.mpBattleFormat === 'team' && state.isHost) {
    Net.clearPickPool().catch(() => {});
  }

  applyMegaOwnerLock(state.playerTeam); // 交換で受け取った個体も含め、自分の解放状況で確定してから送る
  await Net.sendTeam(state.playerTeam);
  Pokedex.registerTeam(state.playerTeam);

  // バトル画面へ移動して待機
  setRandomBattleBackground();
  showScreen('battle');
  $('battle-log-stack').innerHTML = '';
  logLines = [];
  msgQueue = [];
  pushLogLine('相手の選出を待っています…');

  // 通信の瞬断など何らかの理由で相手に自分のチームが届いていない場合に備え、
  // 「相手の選出を待っています…」が一定時間続く間は自分のチームを定期的に再送信する。
  // 既に相手が受信済みなら同じ内容を書き直すだけなので害はなく、
  // これにより「対戦が始まらず固まる」不具合から自動的に復帰できる。
  let opponentTeamReceived = false;
  const resendInterval = setInterval(() => {
    if (opponentTeamReceived) { clearInterval(resendInterval); return; }
    Net.sendTeam(state.playerTeam).catch(() => {});
  }, 4000);

  Net.onOpponentTeam(async (oppTeam) => {
    opponentTeamReceived = true;
    clearInterval(resendInterval);

    state.cpuTeam = oppTeam;
    state.cpuTeam.forEach(resetPokeForBattle);
    state.playerActive = state.playerTeam[0];
    state.cpuActive = state.cpuTeam[0];
    state.playerActive.side = 'player';
    state.cpuActive.side = 'cpu';
    state.playerActive.seenInBattle = true;
    state.cpuActive.seenInBattle = true;

    // 初期描画
    updateHud(state.playerActive, 'self');
    updateHud(state.cpuActive, 'opp');
    setSprite(state.playerActive, 'self');
    setSprite(state.cpuActive, 'opp');

    $('battle-log-stack').innerHTML = '';
    logLines = [];

    state.isBossBattle = false;
    const bgmNum = BattleBgm.start(false);
    pushLogLine(battleBgmLogLabel(bgmNum));

    if (state.isHost) {
      await runMultiplayerBattleHost();
    } else {
      await runMultiplayerBattleGuest();
    }
  });
}

/* =========================================================
   ホスト側バトルループ
   ========================================================= */
// ホスト→ゲストの毎ターン終了時の完全同期ペイロードを作る。
// これまで turnsOnField / typeLockTurns しか同期しておらず、
// 能力ランク変化(ranks)・技のPP(moves[].pp)・特性(ability)・
// であいがしらのロック状態(deaigashiraLocked)がゲスト画面に反映されない不具合が
// あったため、ここでまとめて含めるようにする。
function buildTurnEndPayload() {
  const host = state.playerActive;
  const guest = state.cpuActive;
  return {
    k: 'turn-end',
    hostTurnsOnField: host.turnsOnField || 0,
    guestTurnsOnField: guest.turnsOnField || 0,
    hostTypeLockTurns: host.typeLockTurns || 0,
    hostTypeLockType: host.typeLockType || null,
    guestTypeLockTurns: guest.typeLockTurns || 0,
    guestTypeLockType: guest.typeLockType || null,
    // 能力ランク変化（かげふみ等の特性判定や、能力アップ/ダウンの表示反映に必須）
    hostRanks: host.ranks,
    guestRanks: guest.ranks,
    // きあいだめによる急所ランク（「様子を見る」画面での表示に必須。対人戦では
    // ゲスト側が自分でengine.jsのcritRank更新を行う経路が無いため同期する）。
    hostCritRank: host.critRank || 0,
    guestCritRank: guest.critRank || 0,
    // 特性（かげふみ・ふゆう等、対人戦のみ意味を持つ特性判定に必須）
    hostAbility: host.ability,
    guestAbility: guest.ability,
    // タイプ変化（ナナイロレーザー等のchangedType／へんげんじざいのhengenjizaiType／
    // タイプ消失removedTypes）。ゲスト側は自前でengine.jsのgetEffectiveTypesを
    // 更新する経路が無いため、これが無いと「様子を見る」画面やタイプ相性の見た目上の
    // 表示だけがゲスト側でズレる（ダメージ計算自体はホスト権威なので実害は無いが、
    // 表示が食い違って混乱の元になる）。
    hostChangedType: host.changedType || null,
    guestChangedType: guest.changedType || null,
    hostHengenjizaiType: host.hengenjizaiType || null,
    guestHengenjizaiType: guest.hengenjizaiType || null,
    hostRemovedTypes: host.removedTypes || [],
    guestRemovedTypes: guest.removedTypes || [],
    // メガシンカ状態（種族・タイプ・実数値）。これが無いと、ホスト側でメガシンカしても
    // ゲスト画面の相手ポケモンの見た目上のタイプ・特性・ステータスがメガ進化前のまま
    // 表示され続ける（いかく等の発動メッセージ自体はmegaEvolveイベントで見えるが、
    // その後の「様子を見る」画面には反映されない）。
    hostIsMega: !!host.isMega,
    guestIsMega: !!guest.isMega,
    hostType1: host.species.type1, hostType2: host.species.type2 || null,
    guestType1: guest.species.type1, guestType2: guest.species.type2 || null,
    hostStats: host.stats, guestStats: guest.stats,
    // 技ID（ランダムアクトでターン終了時に技が入れ替わるため、並びと中身をゲストにも同期する。
    // ゲスト側はこの配列をもとに技リストを作り直す。PP同期（下）より先に反映すること）
    hostMoveIds: host.moves.map((m) => (m ? m.id : 0)),
    guestMoveIds: guest.moves.map((m) => (m ? m.id : 0)),
    // いざない：ねむりまでの残りターン（「様子を見る」画面のチップ表示用）
    hostIzanaiTurns: host.izanaiTurns || 0,
    guestIzanaiTurns: guest.izanaiTurns || 0,
    // 技のPP（配列。moves配列の並び順はチーム送信時と不変のためインデックス対応でよい）
    hostPp: host.moves.map((m) => (m ? m.pp : 0)),
    guestPp: guest.moves.map((m) => (m ? m.pp : 0)),
    // であいがしらのロック状態（本家仕様：場に出たターン以外は使用不可）
    hostDeaigashiraLocked: !!host.deaigashiraLocked,
    guestDeaigashiraLocked: !!guest.deaigashiraLocked,
    // げきりんの強制連続使用の状態（コマンド自動選択・混乱付与のタイミングに必須）
    hostGekirinTurns: host.gekirinTurns || 0,
    hostGekirinMoveId: host.gekirinMoveId || null,
    guestGekirinTurns: guest.gekirinTurns || 0,
    guestGekirinMoveId: guest.gekirinMoveId || null,
    // はかいこうせん等の反動で動けない状態（対人戦でも行動選択をスキップさせるために必須）
    hostMustRechargeTurns: host.mustRechargeTurns || 0,
    guestMustRechargeTurns: guest.mustRechargeTurns || 0,
    // 天候・地形（フィールド全体の状態）。ゲスト側は自前でengine.jsのbattleFieldを
    // 更新する経路が無く、天候技（きたかぜたいよう・ゆうだち等）や天候特性を使っても
    // ゲスト画面のbattleFieldが一切更新されない不具合があったため同期する。
    fieldWeather: battleField.weather,
    fieldWeatherTurns: battleField.weatherTurns,
    fieldTerrain: battleField.terrain,
    fieldTerrainTurns: battleField.terrainTurns,
    // リフレクター・ひかりのかべ・おいかぜ・トリックルーム（場全体の状態）。
    // 天候・地形と同様、ゲスト側は自前でengine.jsのbattleFieldを更新する経路が
    // 無いため、これらを同期しないと「様子を見る」画面で残りターンが表示されない
    // 不具合が起きる（ホスト側だけ見えて、ゲスト側からは見えない）。
    fieldPlayerReflect: battleField.playerReflect || 0,
    fieldCpuReflect: battleField.cpuReflect || 0,
    fieldPlayerLightScreen: battleField.playerLightScreen || 0,
    fieldCpuLightScreen: battleField.cpuLightScreen || 0,
    fieldTailwindPlayer: battleField.tailwindPlayer || 0,
    fieldTailwindCpu: battleField.tailwindCpu || 0,
    fieldTrickRoom: !!battleField.trickRoom,
    fieldTrickRoomTurns: battleField.trickRoomTurns || 0,
  };
}

async function runMultiplayerBattleHost() {
  await Net.clearEvents();
  await Net.clearSurrenderFlags();
  state.battleBusy = true;
  clearWeatherFxLayer();

  resetHazards();
  resetField(state.playerTeam, state.cpuTeam);
  updateFieldDisplay();

  // ゲストの降参を常時監視する。ターンの行動待ちとは独立して発火するため、
  // 相手が行動を選んでいる最中でも即座に検知して試合を終了できる。
  // リスナー解除関数はモジュールレベル変数(currentSurrenderUnsub)にも保持し、
  // ホスト自身が降参ボタンから終了した場合でも確実に解除できるようにする。
  let surrenderedByOpponent = false;
  const unsubSurrender = Net.onOpponentSurrender(() => {
    surrenderedByOpponent = true;
  });
  currentSurrenderUnsub = unsubSurrender;

  queueMessage(`${state.cpuActive.species.name}が現れた！`);
  queueMessage(`ゆけっ！${state.playerActive.species.name}！`);
  await drainMessages();

  applyWeatherTerrainAbilityOnSwitchIn(state.cpuActive, makeLogFn(), state.playerActive);
  await drainMessages();
  applyWeatherTerrainAbilityOnSwitchIn(state.playerActive, makeLogFn(), state.cpuActive);
  await drainMessages();

  await Net.pushEvent(buildTurnEndPayload());

  state.turnNumber = 1;

  while (true) {
    if (surrenderedByOpponent) { if (unsubSurrender) unsubSurrender(); await endMultiplayerBattleHost(true, true); return; }
    if (state.playerTeam.every((p) => p.fainted)) { if (unsubSurrender) unsubSurrender(); await endMultiplayerBattleHost(false, false); return; }
    if (state.cpuTeam.every((p) => p.fainted)) { if (unsubSurrender) unsubSurrender(); await endMultiplayerBattleHost(true, false); return; }

    queueTurnDivider(state.turnNumber);
    await drainMessages();

    const myAction = await waitForPlayerAction();
    await Net.sendAction(myAction);
    showOpponentWaitingBadge();

    const guestRaw = await new Promise((resolve) => {
      if (surrenderedByOpponent) { resolve('__surrender__'); return; }
      let settled = false;
      const finish = (v) => { if (settled) return; settled = true; clearInterval(check); resolve(v); };
      Net.waitForOpponentAction(finish);
      const check = setInterval(() => {
        if (surrenderedByOpponent) finish('__surrender__');
      }, 200);
    });
    hideOpponentWaitingBadge();
    if (guestRaw === '__surrender__') {
      if (unsubSurrender) unsubSurrender();
      await endMultiplayerBattleHost(true, true);
      return;
    }
    const guestAction = resolveRemoteAction(guestRaw, state.cpuActive);

    msgQueue = [];

    if (myAction.type === 'switch') {
      const newP = state.playerTeam[myAction.idx];
      queueMessage(`${state.playerActive.species.name}、もどれ！`);
      await drainMessages();
      await doSwitch(newP, 'player');
      queueMessage(`ゆけっ！${newP.species.name}！`);
      await drainMessages();
    }

    if (guestAction.type === 'switch') {
      const newC = state.cpuTeam[guestAction.idx];
      if (newC && newC !== state.cpuActive && !newC.fainted) {
        queueMessage(`相手は${state.cpuActive.species.name}をひっこめた！`);
        await drainMessages();
        await doSwitch(newC, 'cpu');
        queueMessage(`相手は${newC.species.name}をくり出した！`);
        await drainMessages();
      }
    }

    if (state.playerActive && !state.playerActive.fainted &&
        state.cpuActive && !state.cpuActive.fainted) {
      const playerAct = myAction.type === 'switch' ? { type: 'none' } : myAction;
      const cpuAct = guestAction.type === 'switch' ? { type: 'none' } : guestAction;
      await runTurn(playerAct, cpuAct, state.playerActive, state.cpuActive,
                    makeLogFn(), resolveImmediateSwitchMultiplayer);
      await drainMessages();
    }

    await postTurnCleanupMultiplayerHost();
    state.turnNumber++;

    await Net.pushEvent(buildTurnEndPayload());
  }
}

async function resolveImmediateSwitchMultiplayer(side) {
  if (side === 'cpu') {
    const outgoing = state.cpuActive;
    if (outgoing.bindTurns > 0) {
      queueMessage(`${outgoing.species.name}はバインドされていて交代できない！`);
      await drainMessages();
      return null;
    }
    if (!hasAliveBackup(state.cpuTeam, outgoing)) return null;
    Net.pushEvent({ k: 'force-switch', s: 'cpu' });
    showOpponentWaitingBadge();
    const raw = await new Promise((resolve) => {
      Net.waitForOpponentAction(resolve);
    });
    hideOpponentWaitingBadge();
    const idx = raw && typeof raw.idx === 'number' ? raw.idx : 0;
    const next = state.cpuTeam[idx] || state.cpuTeam.find((p) => p !== outgoing && !p.fainted);
    if (!next) return null;
    queueMessage(`相手は${outgoing.species.name}をひっこめた！`);
    await drainMessages();
    queueMessage(`相手は${next.species.name}をくり出した！`);
    await drainMessages();
    await doSwitch(next, 'cpu');
    // doSwitch内でランク・混乱状態がリセットされるため、バトンタッチの引き継ぎは
    // doSwitchの「後」に適用する（先に適用するとdoSwitchのリセットで消えてしまうバグを修正）。
    applyBatonPass(outgoing, next);
    return next;
  } else {
    const outgoing = state.playerActive;
    if (outgoing.bindTurns > 0) {
      queueMessage(`${outgoing.species.name}はバインドされていて交代できない！`);
      await drainMessages();
      return null;
    }
    if (!hasAliveBackup(state.playerTeam, outgoing)) return null;
    queueMessage(`${outgoing.species.name}、もどれ！`);
    await drainMessages();
    const idx = await waitForForcedSwitch();
    const next = state.playerTeam[idx];
    await doSwitch(next, 'player');
    // doSwitch内でランク・混乱状態がリセットされるため、バトンタッチの引き継ぎは
    // doSwitchの「後」に適用する（先に適用するとdoSwitchのリセットで消えてしまうバグを修正）。
    applyBatonPass(outgoing, next);
    queueMessage(`ゆけっ！${next.species.name}！`);
    await drainMessages();
    return next;
  }
}

async function postTurnCleanupMultiplayerHost() {
  while (state.cpuActive.fainted) {
    await playFaint('opp');
    if (state.cpuTeam.every((p) => p.fainted)) break;
    Net.pushEvent({ k: 'force-switch', s: 'cpu' });
    showOpponentWaitingBadge();
    const raw = await new Promise((resolve) => {
      Net.waitForOpponentAction(resolve);
    });
    hideOpponentWaitingBadge();
    const idx = raw && typeof raw.idx === 'number' ? raw.idx : 0;
    const next = state.cpuTeam[idx] || state.cpuTeam.find((p) => !p.fainted);
    if (!next) break;
    queueMessage(`相手は${next.species.name}をくり出した！`);
    await drainMessages();
    await doSwitch(next, 'cpu');
  }
  while (state.playerActive.fainted) {
    await playFaint('self');
    const alive = state.playerTeam.filter((p) => !p.fainted);
    if (alive.length === 0) break;
    queueMessage(`つぎのポケモンをえらんでください`);
    await drainMessages();
    const idx = await waitForForcedSwitch();
    await doSwitch(state.playerTeam[idx], 'player');
  }
  updateHud(state.playerActive, 'self');
  updateHud(state.cpuActive, 'opp');
  updateFieldDisplay();
}

// bySurrender: どちらかが降参ボタンを押して終わった試合かどうか。
// 降参なし（＝両者フェイントでの通常決着）の時だけ、勝敗にかかわらずホスト・ゲスト双方に
// ディスク+10を付与する（対人戦は「降参ボタンを押さずに試合が終わった時のみお互いに+10」）。
async function endMultiplayerBattleHost(hostWon, bySurrender) {
  state.battleBusy = false;
  clearTurnTimer();
  hideOpponentWaitingBadge();
  BattleBgm.stop();
  // 結果オーバーレイの裏に技メニュー等が残ったままタップできてしまわないよう、
  // ここでも念のためコマンドパネルを確実に空にしておく（降参・KO決着どちらでも）。
  clearCmdPanel();
  $('cmd-dock').classList.remove('dock-wide');
  if (currentSurrenderUnsub) { currentSurrenderUnsub(); currentSurrenderUnsub = null; }
  await Net.clearSurrenderFlags();
  const noSurrenderWin = !bySurrender;
  if (noSurrenderWin) Shop.addDisc(PVP_DISC_REWARD);
  const overlay = $('result-overlay');
  $('result-title').textContent = hostWon ? 'WIN' : 'LOSE';
  $('result-title').className = 'result-title ' + (hostWon ? 'win' : 'lose');
  $('result-desc').textContent = hostWon
    ? (noSurrenderWin ? `勝利！ディスク+${PVP_DISC_REWARD}` : '勝利！')
    : (noSurrenderWin ? `敗北…ディスク+${PVP_DISC_REWARD}` : '敗北…');
  overlay.classList.add('show');
  Net.pushEvent({ k: 'end', win: hostWon, bySurrender: !!bySurrender });
  await runMultiplayerRematchFlow();
}

/* =========================================================
   対人戦終了後：自動的にルーム（準備完了待機部屋）へ戻る
   ========================================================= */
const RESULT_DISPLAY_MS = 2200;

async function returnToReadyRoomAfterBattle() {
  const overlay = $('result-overlay');
  const waitOverlay = $('rematch-wait-overlay');

  // 技メニュー・交代メニューなど、戦闘中に残っていたコマンドパネルの中身を
  // ここで確実に空にしておく。降参直後（技メニュー表示中に降参した場合や、
  // ホストが降参ボタンからclearCmdPanelを経由せずendMultiplayerBattleHostへ
  // 進んだ場合）に古いボタンがDOM上に残ったままだと、result-overlayや
  // rematch-wait-overlayが一瞬非表示になる隙間や、opacityトランジション中に
  // その裏の古いボタンをタップできてしまい、技の音が鳴ったり交換が
  // 実行できてしまう不具合の原因になるため。
  clearCmdPanel();
  clearTurnTimer();
  $('cmd-dock').classList.remove('dock-wide');

  // 結果表示をしばらく見せてから待機部屋へ
  await new Promise((r) => setTimeout(r, RESULT_DISPLAY_MS));
  overlay.classList.remove('show');

  waitOverlay.classList.add('show');
  $('rematch-wait-title').textContent = 'ルームにもどっています';
  $('rematch-wait-desc').textContent = 'もう一度「準備完了」を押すと再戦できます';

  // ルームのバトル/選出/交換データをクリアしてから、
  // ホスト・ゲストの両方が確実に同じタイミングで待機部屋に戻れるようにする。
  if (state.isHost) {
    await Net.resetForNextBattle();
  }

  // screen-battle自体をここで確実に非表示（active解除）にしてから
  // wait-overlayを消す。順序を逆にすると、wait-overlayが消えた直後から
  // showScreen('host-waiting')が実行されるまでの間、screen-battleが
  // activeなまま表に出てしまう瞬間ができ、その裏の戦闘UI（技ボタン等）が
  // タップ可能になってしまうため、必ず「screen切り替え→waitOverlayを消す」
  // の順に行う。
  state.multiplayer = false;
  readyBattleStarting = false;
  readyRoomState = { mine: false, opponent: false };
  renderReadyRoom();
  showScreen('host-waiting');
  waitOverlay.classList.remove('show');
  MenuBgm.start();

  wireReadyRoomListeners();
}

async function runMultiplayerRematchFlow() {
  await returnToReadyRoomAfterBattle();
}

/* =========================================================
   ゲスト側バトルループ
   ========================================================= */
let guestEventQueue = [];
let guestProcessing = false;
let guestTurnEndResolve = null;
// バトル開始直後、最初の「--ターン1--」の表示が完了するまでゲストの行動選択を
// 保留するためのゲート。handleGuestEvent内でev.turn付きの最初のmsgイベントの
// 表示が終わった時にこれが一度だけ呼ばれ、runMultiplayerBattleGuestのループが
// 動き出す。ターン2以降は使わない（nullのままでよい）。
let guestInitialTurnDividerResolve = null;
// ホストの clearEvents() とゲストの購読開始のタイミングがずれると、
// 削除前の残存イベントや前回対戦分のイベントを Firebase の child_added が
// 拾ってしまい、同じログが二重に再生されることがある（例: 「〇〇をくりだした！」が2回）。
// イベントごとに一意な push キーで既処理を記録し、同じキーは絶対に二度処理しないことで
// 二重再生を確実に防ぐ。
let guestSeenEventKeys = new Set();

function waitForGuestTurnEnd() {
  return new Promise((resolve) => { guestTurnEndResolve = resolve; });
}

function enqueueGuestEvent(ev, key) {
  if (key !== undefined && key !== null) {
    if (guestSeenEventKeys.has(key)) return; // 二重イベントは無視
    guestSeenEventKeys.add(key);
  }
  // ホストから最初のイベント（技演出等の 'msg' や 'sprite'）が届いた時点で、
  // 「相手の選択を待っています…」バッジを消す。ホスト側は相手の行動を受信した
  // 瞬間にバッジを消しているのに対し、ゲスト側は従来 turn-end（そのターンの
  // 演出が全て終わった後）まで待っていたため、技の演出中もバッジが
  // 消えないままになっていた不具合を修正する。
  if (ev && (ev.k === 'msg' || ev.k === 'sprite' || ev.k === 'turn-end')) {
    hideOpponentWaitingBadge();
  }
  guestEventQueue.push(ev);
  if (!guestProcessing) processGuestEvents();
}

async function processGuestEvents() {
  if (guestEventQueue.length === 0) { guestProcessing = false; return; }
  guestProcessing = true;
  const ev = guestEventQueue.shift();
  await handleGuestEvent(ev);
  processGuestEvents();
}

async function handleGuestEvent(ev) {
  if (!ev) return;

  if (ev.k === 'msg') {
    const uiSide = ev.h === 'player' ? 'opp' : ev.h === 'cpu' ? 'self' : null;
    const poke = ev.h === 'player' ? state.cpuActive : ev.h === 'cpu' ? state.playerActive : null;
    const hpSnapshot = ev.hp;

    // ホストから毎回送られてくる両アクティブの実データスナップショットを実データへ反映する。
    // ホスト視点 player = ゲスト画面の opp、ホスト視点 cpu = ゲスト画面の self。
    if (ev.pSnap && state.cpuActive && state.cpuActive.speciesId === ev.pSnap.sid) {
      state.cpuActive.currentHp = ev.pSnap.hp;
      state.cpuActive.maxHp = ev.pSnap.mhp;
      state.cpuActive.status = ev.pSnap.st;
      state.cpuActive.confuseTurns = ev.pSnap.cf || 0;
      state.cpuActive.fainted = ev.pSnap.fainted;
      if (ev.pSnap.form) state.cpuActive.formState = ev.pSnap.form;
    }
    if (ev.cSnap && state.playerActive && state.playerActive.speciesId === ev.cSnap.sid) {
      state.playerActive.currentHp = ev.cSnap.hp;
      state.playerActive.maxHp = ev.cSnap.mhp;
      state.playerActive.status = ev.cSnap.st;
      state.playerActive.confuseTurns = ev.cSnap.cf || 0;
      state.playerActive.fainted = ev.cSnap.fainted;
      if (ev.cSnap.form) state.playerActive.formState = ev.cSnap.form;
    }

    // 能力ランク変化がどちら側に起きたか（ホスト視点 player/cpu → ゲスト画面の opp/self に変換）
    const rankUiSide = ev.rc && ev.rs ? (ev.rs === 'player' ? 'opp' : 'self') : null;

    // ヨワシのフォルムチェンジがどちら側に起きたか
    const yowashiUiSide = ev.yf && ev.ys ? (ev.ys === 'player' ? 'opp' : 'self') : null;
    const yowashiPoke = ev.ys === 'player' ? state.cpuActive : ev.ys === 'cpu' ? state.playerActive : null;

    // アイニーチュのフォルムチェンジがどちら側に起きたか（pSnap/cSnapのmhp・formは
    // 既に上で反映済みなので、ここではエフェクト再生とHUD再描画だけ行えばよい）
    const aineechuUiSide = ev.ac && ev.as ? (ev.as === 'player' ? 'opp' : 'self') : null;
    const aineechuPoke = ev.as === 'player' ? state.cpuActive : ev.as === 'cpu' ? state.playerActive : null;

    // ---- メガシンカ関連の判定（ゲスト側：自分・相手どちらも対応） ----
    // ev.mev だけに依存すると非X/Y個体で発火しないことがあるため、複数の手がかりで判定する。
    const _megaTextHit = typeof ev.t === 'string' && ev.t.indexOf('メガシンカした') !== -1;
    const _hasMegaPayload = (ev.mev === true)
      || (ev.mt1 != null)
      || (ev.mfm != null)
      || (ev.mab != null)
      || _megaTextHit;
    const _isRingOnly = (ev.mrg === true) && !_hasMegaPayload;
    const _isMegaEvolve = !_isRingOnly && _hasMegaPayload && !!ev.msd;

    const megaUiSide = _isMegaEvolve ? (ev.msd === 'player' ? 'opp' : 'self') : null;
    const megaPoke = ev.msd === 'player'
      ? state.cpuActive
      : ev.msd === 'cpu'
        ? (state.playerActive || (state.playerTeam && state.playerTeam.find((p) => !p.fainted)) || null)
        : null;
    const megaSnap = ev.msd === 'player'
      ? (ev.pSnap ? { hp: ev.pSnap.hp, status: ev.pSnap.st, confuseTurns: ev.pSnap.cf } : null)
      : ev.msd === 'cpu'
        ? (ev.cSnap ? { hp: ev.cSnap.hp, status: ev.cSnap.st, confuseTurns: ev.cSnap.cf } : null)
        : null;

    // メガ後の種族情報を演出開始前に先行反映（spritePath() が正しい画像を返すように）
    if (_isMegaEvolve && megaPoke) {
      megaPoke.isMega = true;
      if (ev.mfm != null) megaPoke.megaForm = ev.mfm;
      if (ev.mab != null) megaPoke.ability = ev.mab;
      if (ev.mt1 != null) {
        megaPoke.species = Object.assign({}, megaPoke.species, {
          type1: ev.mt1,
          type2: ev.mt2 || null,
        });
      }
    }

    // ログ履歴（「ログを見る」オーバーレイ用）。ホスト視点の player/cpu を
    // ゲスト画面上の自分（self）/相手（opp）に対応する player/cpu 表記へ変換する。
    let logSide = null, logKind = 'plain';
    if (ev.turn) {
      logKind = 'turn';
    } else if (ev.mu) {
      logSide = ev.mu === 'cpu' ? 'player' : 'cpu';
      logKind = 'move';
    } else if (ev.h) {
      logSide = ev.h === 'cpu' ? 'player' : 'cpu';
      logKind = 'damage';
    }
    if (logSide) {
      pushBattleLogHistory({ text: ev.t, side: logSide, kind: logKind, speciesId: ev.sid, shiny: ev.sh });
    } else {
      pushBattleLogHistory({ text: ev.t, side: null, kind: logKind, speciesId: null, shiny: false });
    }

    const isBigMove = !!(ev.mp !== null && ev.mp !== undefined && ev.mp > BIG_MOVE_POWER_THRESHOLD);
    const isSpecialMove = SPECIAL_MOVE_FX_IDS.indexOf(ev.mi !== undefined ? ev.mi : null) !== -1;

    // 設置技(ステルスロック=318)：技使用ログ(ev.mu)の時点で演出を再生する（ダメージログではない）。
    const isGuestHazardMove = ev.mi === 318 && !!ev.mu && !ev.h;
    const guestHazardDefSide = ev.mu === 'player' ? 'self' : 'opp';

    msgQueue.push({
      text: ev.t,
      after: async () => {
        if (isGuestHazardMove) {
          await playSpecialMoveEffect(ev.mi, guestHazardDefSide);
        }
        if (uiSide && poke) {
          if (isSpecialMove) {
            await playSpecialMoveEffect(ev.mi, uiSide);
            if (ev.tm !== null && ev.tm !== undefined) {
              playTypeEffectSound(ev.tm);
            }
            await flashHit(uiSide);
            updateHud(poke, uiSide, hpSnapshot);
          } else if (isBigMove && ev.mt) {
            await playTypeEffect(uiSide, ev.mt, true);
            if (ev.tm !== null && ev.tm !== undefined) {
              playTypeEffectSound(ev.tm);
            }
            await flashHit(uiSide);
            updateHud(poke, uiSide, hpSnapshot);
          } else {
            if (ev.mt) {
              await playTypeEffect(uiSide, ev.mt, false);
            }
            if (ev.tm !== null && ev.tm !== undefined) {
              playTypeEffectSound(ev.tm);
            }
            await flashHit(uiSide);
            updateHud(poke, uiSide, hpSnapshot);
          }
        }
        if (rankUiSide) {
          await rankFlash(rankUiSide, ev.rc);
        }
        // ヨワシのフォルムチェンジ
        if (yowashiUiSide && yowashiPoke) {
          await playYowashiFormChangeEffect(yowashiUiSide, yowashiPoke, ev.yf, !!ev.yfx);
        }
        // アイニーチュのフォルムチェンジ（HP・maxHpはpSnap/cSnapで既に反映済み）
        if (aineechuUiSide && aineechuPoke) {
          await playYowashiFormChangeEffect(aineechuUiSide, aineechuPoke, 'school', true);
          updateHud(aineechuPoke, aineechuUiSide, aineechuPoke.currentHp);
        }
        // 天候発動エフェクト
        if (ev.wfx) {
          await playWeatherEffect(ev.wfx);
        }
        // HUDの最新化（状態異常付与メッセージ等の表示漏れ防止）
        if (state.playerActive) updateHud(state.playerActive, 'self');
        if (state.cpuActive) updateHud(state.cpuActive, 'opp');
        if (ev.f) {
          const fUiSide = ev.f === 'player' ? 'opp' : 'self';
          await playFaint(fUiSide);
        }
        // ---- メガシンカ本演出 ----
        // メガリング反応の時点では効果音・全画面エフェクトなし（テキストのみ）で、
        // 実際の変身メッセージで playMegaEvolveEffect を呼ぶ。
        if (megaUiSide && megaPoke) {
          if (ev.msd === 'cpu' && megaPoke.speciesId !== undefined) {
            Pokedex.registerMega(megaPoke.speciesId, ev.mfm || null);
          }
          try {
            await playMegaEvolveEffect(megaUiSide, megaPoke, megaSnap);
          } catch (e) {
            console.warn('[mega-fx] ゲスト側メガ演出で例外', e);
          }
          // 演出後、スプライトとHUDを最新のメガ状態で確実に再描画する
          try {
            const _wrap = megaUiSide === 'opp' ? $('sprite-opp-wrap') : $('sprite-self-wrap');
            if (_wrap && megaPoke) {
              const _cls = megaUiSide === 'opp' ? 'sprite sprite-opp' : 'sprite sprite-self';
              _wrap.innerHTML = spriteImgTag(megaPoke, _cls);
            }
            updateHud(megaPoke, megaUiSide);
          } catch (e) {
            console.warn('[mega-fx] ゲスト側再描画で例外', e);
          }
        }
      },
    });
    await playGuestMessages();
    // 最初の「--ターン1--」メッセージ（ev.turn === true）の表示が完了した
    // タイミングで、保留していたゲストの行動選択を解禁する。
    // ここより前（○○が現れた！・天候特性の発動ログなど）ではまだボタンを
    // 押せないようにするための同期ポイント。2ターン目以降のev.turnイベントでは
    // guestInitialTurnDividerResolveは既にnullになっているため何も起きない。
    if (ev.turn && guestInitialTurnDividerResolve) {
      const r = guestInitialTurnDividerResolve;
      guestInitialTurnDividerResolve = null;
      r();
    }
    return;
  }

  if (ev.k === 'sprite') {
    const uiSide = ev.s === 'player' ? 'opp' : 'self';
    const team = uiSide === 'self' ? state.playerTeam : state.cpuTeam;
    const poke = team.find((p) => p.speciesId === ev.sid && !p.fainted) || team[0];
    if (!poke) return;
    poke.currentHp = ev.hp !== undefined ? ev.hp : poke.currentHp;
    poke.maxHp = ev.mhp !== undefined ? ev.mhp : poke.maxHp;
    poke.status = ev.st !== undefined ? ev.st : poke.status;
    poke.confuseTurns = ev.cf !== undefined ? ev.cf : poke.confuseTurns;
    const isActualSwitch = (uiSide === 'self' ? state.playerActive : state.cpuActive) !== poke;
    if (isActualSwitch) {
      poke.ranks = { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, acc: 0, eva: 0 };
      if (poke.moves) poke.moves.forEach((m) => { if (m) m.locked = false; });
      poke.deaigashiraLocked = false;
      poke.turnsOnField = 0;
      poke.gekirinTurns = 0;
      poke.gekirinMoveId = null;
      poke.protecting = false;
      poke.protectStreak = 0;
      poke.enduring = false;
      poke.endureStreak = 0;
      poke.encoreTurns = 0;
      poke.encoreMoveId = null;
    }
    if (uiSide === 'self') state.playerActive = poke; else state.cpuActive = poke;
    setSprite(poke, uiSide);
    updateHud(poke, uiSide);
    return;
  }

  if (ev.k === 'force-switch') {
    const mySide = ev.s === 'cpu' ? 'self' : 'opp';
    if (mySide === 'self') {
      const idx = await waitGuestForcedSwitch();
      await Net.sendAction({ type: 'switch', idx });
    }
    return;
  }

  if (ev.k === 'turn-end') {
    if (state.playerActive && ev.guestTurnsOnField !== undefined) {
      state.playerActive.turnsOnField = ev.guestTurnsOnField;
    }
    if (state.cpuActive && ev.hostTurnsOnField !== undefined) {
      state.cpuActive.turnsOnField = ev.hostTurnsOnField;
    }
    if (state.playerActive && ev.guestTypeLockTurns !== undefined) {
      state.playerActive.typeLockTurns = ev.guestTypeLockTurns;
      state.playerActive.typeLockType = ev.guestTypeLockType || null;
    }
    if (state.cpuActive && ev.hostTypeLockTurns !== undefined) {
      state.cpuActive.typeLockTurns = ev.hostTypeLockTurns;
      state.cpuActive.typeLockType = ev.hostTypeLockType || null;
    }
    if (state.playerActive && ev.guestRanks) {
      state.playerActive.ranks = ev.guestRanks;
    }
    if (state.cpuActive && ev.hostRanks) {
      state.cpuActive.ranks = ev.hostRanks;
    }
    if (state.playerActive && ev.guestCritRank !== undefined) {
      state.playerActive.critRank = ev.guestCritRank || 0;
    }
    if (state.cpuActive && ev.hostCritRank !== undefined) {
      state.cpuActive.critRank = ev.hostCritRank || 0;
    }
    if (state.playerActive && ev.guestAbility !== undefined) {
      state.playerActive.ability = ev.guestAbility;
    }
    if (state.cpuActive && ev.hostAbility !== undefined) {
      state.cpuActive.ability = ev.hostAbility;
    }
    if (state.playerActive && ev.guestChangedType !== undefined) {
      state.playerActive.changedType = ev.guestChangedType;
    }
    if (state.cpuActive && ev.hostChangedType !== undefined) {
      state.cpuActive.changedType = ev.hostChangedType;
    }
    if (state.playerActive && ev.guestHengenjizaiType !== undefined) {
      state.playerActive.hengenjizaiType = ev.guestHengenjizaiType;
    }
    if (state.cpuActive && ev.hostHengenjizaiType !== undefined) {
      state.cpuActive.hengenjizaiType = ev.hostHengenjizaiType;
    }
    if (state.playerActive && Array.isArray(ev.guestRemovedTypes)) {
      state.playerActive.removedTypes = ev.guestRemovedTypes;
    }
    if (state.cpuActive && Array.isArray(ev.hostRemovedTypes)) {
      state.cpuActive.removedTypes = ev.hostRemovedTypes;
    }
    if (state.playerActive && ev.guestIsMega !== undefined) {
      state.playerActive.isMega = ev.guestIsMega;
      if (ev.guestType1 !== undefined) {
        state.playerActive.species = Object.assign({}, state.playerActive.species, {
          type1: ev.guestType1, type2: ev.guestType2 || null,
        });
      }
      if (ev.guestStats) state.playerActive.stats = ev.guestStats;
    }
    if (state.cpuActive && ev.hostIsMega !== undefined) {
      state.cpuActive.isMega = ev.hostIsMega;
      if (ev.hostType1 !== undefined) {
        state.cpuActive.species = Object.assign({}, state.cpuActive.species, {
          type1: ev.hostType1, type2: ev.hostType2 || null,
        });
      }
      if (ev.hostStats) state.cpuActive.stats = ev.hostStats;
    }
    // ランダムアクト等で技が入れ替わった場合に備え、ホストから届いた技ID配列と現在の技リストが
    // 食い違っていたら技オブジェクトを作り直す（PP反映より前に行う）。
    // ゲスト自身の技メニューが古い技IDを送ってしまうと、ホスト側で行動が無効扱いになってしまう。
    const syncMovesFromIds = (poke, ids) => {
      if (!poke || !Array.isArray(ids)) return;
      const current = (poke.moves || []).map((m) => (m ? m.id : 0));
      if (current.length === ids.length && current.every((id, i) => id === ids[i])) return;
      poke.moves = ids.map((id) => (id ? buildMoveObject(id) : null)).filter(Boolean);
    };
    syncMovesFromIds(state.playerActive, ev.guestMoveIds);
    syncMovesFromIds(state.cpuActive, ev.hostMoveIds);
    if (state.playerActive && ev.guestIzanaiTurns !== undefined) state.playerActive.izanaiTurns = ev.guestIzanaiTurns;
    if (state.cpuActive && ev.hostIzanaiTurns !== undefined) state.cpuActive.izanaiTurns = ev.hostIzanaiTurns;
    if (state.playerActive && Array.isArray(ev.guestPp) && state.playerActive.moves) {
      state.playerActive.moves.forEach((m, i) => {
        if (m && ev.guestPp[i] !== undefined) m.pp = ev.guestPp[i];
      });
    }
    if (state.cpuActive && Array.isArray(ev.hostPp) && state.cpuActive.moves) {
      state.cpuActive.moves.forEach((m, i) => {
        if (m && ev.hostPp[i] !== undefined) m.pp = ev.hostPp[i];
      });
    }
    if (state.playerActive && ev.guestDeaigashiraLocked !== undefined) {
      state.playerActive.deaigashiraLocked = ev.guestDeaigashiraLocked;
    }
    if (state.cpuActive && ev.hostDeaigashiraLocked !== undefined) {
      state.cpuActive.deaigashiraLocked = ev.hostDeaigashiraLocked;
    }
    if (state.playerActive && ev.guestGekirinTurns !== undefined) {
      state.playerActive.gekirinTurns = ev.guestGekirinTurns;
      state.playerActive.gekirinMoveId = ev.guestGekirinMoveId || null;
    }
    if (state.cpuActive && ev.hostGekirinTurns !== undefined) {
      state.cpuActive.gekirinTurns = ev.hostGekirinTurns;
      state.cpuActive.gekirinMoveId = ev.hostGekirinMoveId || null;
    }
    if (state.playerActive && ev.guestMustRechargeTurns !== undefined) {
      state.playerActive.mustRechargeTurns = ev.guestMustRechargeTurns;
    }
    if (state.cpuActive && ev.hostMustRechargeTurns !== undefined) {
      state.cpuActive.mustRechargeTurns = ev.hostMustRechargeTurns;
    }
    if (ev.fieldWeather !== undefined) {
      battleField.weather = ev.fieldWeather;
      battleField.weatherTurns = ev.fieldWeatherTurns || 0;
    }
    if (ev.fieldTerrain !== undefined) {
      battleField.terrain = ev.fieldTerrain;
      battleField.terrainTurns = ev.fieldTerrainTurns || 0;
    }
    if (ev.fieldPlayerReflect !== undefined) {
      battleField.cpuReflect = ev.fieldPlayerReflect || 0;
      battleField.playerReflect = ev.fieldCpuReflect || 0;
    }
    if (ev.fieldPlayerLightScreen !== undefined) {
      battleField.cpuLightScreen = ev.fieldPlayerLightScreen || 0;
      battleField.playerLightScreen = ev.fieldCpuLightScreen || 0;
    }
    if (ev.fieldTailwindPlayer !== undefined) {
      battleField.tailwindCpu = ev.fieldTailwindPlayer || 0;
      battleField.tailwindPlayer = ev.fieldTailwindCpu || 0;
    }
    if (ev.fieldTrickRoom !== undefined) {
      battleField.trickRoom = !!ev.fieldTrickRoom;
      battleField.trickRoomTurns = ev.fieldTrickRoomTurns || 0;
    }
    updateFieldDisplay();
    if (state.playerActive) updateHud(state.playerActive, 'self');
    if (state.cpuActive) updateHud(state.cpuActive, 'opp');
    if (guestTurnEndResolve) {
      const r = guestTurnEndResolve;
      guestTurnEndResolve = null;
      r();
    }
    return;
  }

  if (ev.k === 'end') {
    state.battleBusy = false;
    clearTurnTimer();
    hideOpponentWaitingBadge();
    BattleBgm.stop();
    // 結果オーバーレイの裏に技メニュー等が残ったままタップできてしまわないよう、
    // ゲスト側でも確実にコマンドパネルを空にしておく。
    clearCmdPanel();
    $('cmd-dock').classList.remove('dock-wide');
    const guestWon = !ev.win;
    const noSurrenderWin = !ev.bySurrender;
    if (noSurrenderWin) Shop.addDisc(PVP_DISC_REWARD);
    const overlay = $('result-overlay');
    $('result-title').textContent = guestWon ? 'WIN' : 'LOSE';
    $('result-title').className = 'result-title ' + (guestWon ? 'win' : 'lose');
    $('result-desc').textContent = guestWon
      ? (noSurrenderWin ? `勝利！ディスク+${PVP_DISC_REWARD}` : '勝利！')
      : (noSurrenderWin ? `敗北…ディスク+${PVP_DISC_REWARD}` : '敗北…');
    overlay.classList.add('show');
    await runMultiplayerRematchFlow();
    return;
  }
}

async function playGuestMessages() {
  return new Promise((resolve) => {
    function showNext() {
      if (msgQueue.length === 0) { resolve(); return; }
      const item = msgQueue.shift();
      pushLogLine(item.text);
      const afterPromise = item.after ? withTimeout(item.after(), 4000) : Promise.resolve();
      afterPromise.then(() => {
        setTimeout(() => { showNext(); }, MSG_AUTO_MS);
      });
    }
    showNext();
  });
}

function waitGuestForcedSwitch() {
  $('cmd-dock').classList.remove('dock-wide');
  setWatchLogButtonsActive(false);
  clearCmdPanel();
  return new Promise((resolve) => {
    forcedSwitchResolve = (idx) => {
      forcedSwitchResolve = null;
      closePartyOverlay();
      resolve(idx);
    };
    openPartyOverlay('forced');
  });
}

async function runMultiplayerBattleGuest() {
  state.battleBusy = true;
  clearWeatherFxLayer();
  guestEventQueue = [];
  guestProcessing = false;
  guestTurnEndResolve = null;
  guestInitialTurnDividerResolve = null;
  guestSeenEventKeys = new Set(); // 前回対戦分のキーを引きずらないようリセット

  // バトル開始直後、ホスト側は「○○が現れた！」「ゆけっ！△△！」や、ひでり・
  // すなおこし等「場に出た時に発動する特性」のメッセージ、そして最初の
  // 「--ターン1--」までを順番に送ってくる。これらをまだ受信・表示し終えて
  // いないうちに waitForPlayerAction() を呼んでしまうと、天候などの発動ログが
  // まだ流れている最中にもかかわらず「たたかう」ボタンが先に押せる状態に
  // なってしまう不具合があった。そのため、最初の「--ターン1--」の表示が
  // 完了するまでは行動選択に入らせないようにする。
  // （guestInitialTurnDividerResolveはhandleGuestEvent内でev.turn付きの
  //   最初のmsgイベントを表示し終えたタイミングで一度だけ呼ばれる）
  const waitForInitialTurnDivider = new Promise((resolve) => { guestInitialTurnDividerResolve = resolve; });

  Net.onEvent((ev, key) => enqueueGuestEvent(ev, key));

  // 通信不良等で万一「--ターン1--」イベント自体が届かない場合に備え、
  // 一定時間で強制的にゲートを解除する安全装置。これが無いと通信断時に
  // ゲスト側の行動選択が永久にロックされたままになってしまう。
  await withTimeout(waitForInitialTurnDivider, 12000);

  while (true) {
    if (state.playerTeam.every((p) => p.fainted)) return;
    if (state.cpuTeam.every((p) => p.fainted)) return;

    const myAction = await waitForPlayerAction();
    await Net.sendAction(myAction);
    showOpponentWaitingBadge();
    await waitForGuestTurnEnd();
    hideOpponentWaitingBadge();
  }
}

/* ---- 共通ヘルパー ---- */
function resolveRemoteAction(raw, remotePoke) {
  if (!raw) return { type: 'none' };
  if (raw.type === 'move') {
    const move = remotePoke.moves.find((m) => m.id === raw.moveId);
    // ゲスト側で予約された「メガシンカ」の意思をホスト側のポケモンオブジェクトに反映する。
    // これが無いと、ゲストが技メニューでメガシンカボタンをONにして攻撃しても、
    // 実際にバトルロジック（runTurn）を実行しているホスト側にはその予約が伝わらず、
    // ゲストのポケモンだけメガシンカが発生しない不具合になる。
    remotePoke.wantsMegaEvolve = !!raw.mega;
    if (move) return { type: 'move', move };
    return { type: 'none' };
  }
  if (raw.type === 'switch') return { type: 'switch', idx: raw.idx };
  return { type: 'none' };
}

/* ---------------- Wiring ---------------- */
// 「NPCとバトル」→ まずモード選択（ランダム / チーム）を出す。
// ランダムを選ぶと、これまで通りのメガあり／メガなし選択（startNewRun）へ進む。
$('btn-npc-battle').addEventListener('click', () => { startMenuBgmOnFirstInteraction(); openNpcModeSelect(); });
$('btn-player-battle').addEventListener('click', () => { startMenuBgmOnFirstInteraction(); showMultiplayerMenu(); });
$('btn-to-battle').addEventListener('click', async () => {
  // 確認用「sayakadaisuki2」：最初の戦いだけ、ここで乱入を確定させてから開始する
  if (debugIntrusionTestPending) await applyDebugIntrusionStart();
  startNextCpuBattle();
});

/* ---- ホーム画面：自分の名前変更 ---- */
function refreshTitleNameLabel() {
  const el = $('title-name-label');
  if (el) el.textContent = state.playerName || PlayerProfile.get();
}
refreshTitleNameLabel();

function updateProfileNameCharCount() {
  const len = ($('input-profile-name').value || '').length;
  $('profile-name-char-count').textContent = len;
}

function openProfileNameModal() {
  startMenuBgmOnFirstInteraction();
  $('input-profile-name').value = state.playerName || PlayerProfile.get();
  updateProfileNameCharCount();
  $('profile-name-modal').classList.add('show');
  setTimeout(() => {
    try { $('input-profile-name').focus(); $('input-profile-name').select(); } catch (e) {}
  }, 60);
}

function closeProfileNameModal() {
  $('profile-name-modal').classList.remove('show');
}

function confirmProfileNameModal() {
  const newName = PlayerProfile.set($('input-profile-name').value);
  state.playerName = newName;
  refreshTitleNameLabel();
  closeProfileNameModal();
}

$('btn-title-name').addEventListener('click', openProfileNameModal);
$('profile-name-cancel').addEventListener('click', closeProfileNameModal);
$('profile-name-confirm').addEventListener('click', confirmProfileNameModal);
$('input-profile-name').addEventListener('input', updateProfileNameCharCount);
$('input-profile-name').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') confirmProfileNameModal();
});

/* ---- ホーム画面：NPC大戦の最大連勝数を確認（プレイヤー名の右のボタン） ---- */
function battleHistorySpritesHtml(team, side) {
  return (team || []).map((p, idx) => {
    const src = spritePath(p);
    return `<img src="${src}" class="record-poke-sprite" alt="${p.name}" data-team="${side}" data-idx="${idx}" onerror="this.replaceWith(makeRecordFallback(${p.speciesId}))">`;
  }).join('');
}

// 戦績カード用のスプライト読み込み失敗フォールバック（44px固定の丸バッジ）
window.makeRecordFallback = function (speciesId) {
  const div = document.createElement('div');
  div.className = 'sprite-fallback record-poke-sprite record-poke-fallback';
  div.style.background = fallbackColor(speciesId);
  div.textContent = '#' + speciesId;
  return div;
};

function renderBattleHistoryList() {
  const listEl = $('record-list');
  const entries = BattleHistory.get();
  if (!entries.length) {
    listEl.innerHTML = '<p class="record-empty">まだ戦績がありません</p>';
    return;
  }
  listEl.innerHTML = entries.map((entry) => {
    const modeLabel = entry.mode === 'pvp' ? '対人' : 'NPC';
    const megaLabel = entry.isTeam ? 'チーム' : (entry.mega ? 'メガあり' : 'メガなし');
    const megaTagClass = entry.isTeam ? 'record-tag team' : 'record-tag mega';
    const resultLabel = entry.win ? 'WIN' : 'LOSE';
    const resultClass = entry.win ? 'win' : 'lose';
    const streakHtml = (entry.streak !== null && entry.streak !== undefined)
      ? `<span class="record-streak-badge"><b>${entry.streak}</b>連勝</span>`
      : '';
    return `
      <div class="record-item ${resultClass}">
        <div class="record-side">
          <div class="record-tags">
            <span class="record-tag">${modeLabel}</span>
            <span class="${megaTagClass}">${megaLabel}</span>
          </div>
          <div class="record-team-sprites self">${battleHistorySpritesHtml(entry.playerTeam, 'self')}</div>
        </div>
        <div class="record-vs-col">
          <span class="record-vs-label">VS</span>
          <span class="record-result ${resultClass}">${resultLabel}</span>
        </div>
        <div class="record-side">
          <div class="record-tags">${streakHtml}</div>
          <div class="record-team-sprites opp">${battleHistorySpritesHtml(entry.oppTeam, 'opp')}</div>
        </div>
      </div>
    `;
  }).join('');
}

// 戦績カードのスナップショットから、partyDetailHtmlWide等の既存の詳細表示関数に
// そのまま渡せる「疑似ポケモンオブジェクト」を復元する（表示専用・戦闘には使わない）。
function reconstructPokeFromSnapshot(snap) {
  const species = GAME_DATA.species[snap.speciesId];
  const moves = (snap.moves || []).map((m) => {
    const base = GAME_DATA.moves[m.id];
    if (!base) return null;
    return { id: m.id, name: base.name, type: base.type, pp: m.pp, maxPp: m.maxPp, locked: !!m.locked };
  }).filter(Boolean);
  return {
    speciesId: snap.speciesId,
    species,
    level: snap.level,
    shiny: !!snap.shiny,
    isMega: !!snap.isMega,
    megaForm: snap.megaForm,
    formState: snap.formState,
    ability: snap.abilityId,
    stats: snap.stats,
    evs: snap.evs,
    moves,
    hengenjizaiType: snap.hengenjizaiType,
    changedType: snap.changedType,
    removedTypes: snap.removedTypes || [],
  };
}

function openRecordPokeDetail(team, idx) {
  const snap = team && team[idx];
  if (!snap) return;
  const poke = reconstructPokeFromSnapshot(snap);
  $('record-detail-card').innerHTML = partyDetailHtmlWide(poke);
  $('record-detail-overlay').classList.add('show');
}
function closeRecordPokeDetail() {
  $('record-detail-overlay').classList.remove('show');
}
$('record-detail-close').addEventListener('click', closeRecordPokeDetail);

function openMaxWinStreakModal() {
  startMenuBgmOnFirstInteraction();
  $('record-best-mega-on').textContent = MaxWinStreak.getOn();
  $('record-best-mega-off').textContent = MaxWinStreak.getOff();
  $('record-best-team').textContent = MaxWinStreak.getTeam();
  updateRecordBtnRank();
  renderBattleHistoryList();
  $('max-win-streak-modal').classList.add('show');
}

function closeMaxWinStreakModal() {
  $('max-win-streak-modal').classList.remove('show');
}

$('btn-title-record').addEventListener('click', openMaxWinStreakModal);
$('max-win-streak-close').addEventListener('click', closeMaxWinStreakModal);

// 戦績カード内のポケモン画像タップで詳細ステータスを表示（イベント委譲）
$('record-list').addEventListener('click', (e) => {
  const img = e.target.closest('.record-poke-sprite');
  if (!img) return;
  const side = img.dataset.team;
  const idx = parseInt(img.dataset.idx, 10);
  const entries = BattleHistory.get();
  const card = img.closest('.record-item');
  if (!card) return;
  const cardIdx = Array.prototype.indexOf.call($('record-list').children, card);
  const entry = entries[cardIdx];
  if (!entry) return;
  const team = side === 'opp' ? entry.oppTeam : entry.playerTeam;
  openRecordPokeDetail(team, idx);
});

/* ---- デバッグ用オプション（ホーム画面右上の⚙️） ---- */
// 特定のIDを入力すると、NPC連勝モードをボス戦直前（9連勝中）の状態から
// 開始できるようにする。バグチェック用の裏機能。
// 「ランダム」「チーム」どちらのモードでもボス戦を確認できるよう、
// いったんモード選択画面（npc-mode）を経由させ、選んだ方に9連勝の状態を引き継ぐ。
const DEBUG_BOSS_SKIP_ID = 'sayakadaisuki';
// モード選択（ランダム／チーム）のどちらかで消費される、保留中の初期連勝数。
// 0の間は「デバッグ指定なし」を意味し、通常のランダム/チーム戦の開始には影響しない。
let debugPendingBossSkipWinStreak = 0;
// 「sayakadaisuki2」：確認用。ポケモンを選んだあと、最初の戦いが3戦目扱いで乱入確定になる。
const DEBUG_INTRUSION_TEST_ID = 'sayakadaisuki2';

// 「Function〇〇」（〇〇はポケモンの種族ID）と入力すると、次にNPC戦・対人戦の
// どちらで選出画面を開いても、その種族が必ず6匹の選出プールの中に1匹含まれる
// ようになる（個体値・努力値・性格・技などはランダム。ボス専用IDは対象外）。
// 一度選出プールに反映したら自動的に解除される一回限りの裏機能。
const DEBUG_FORCE_SPECIES_PATTERN = /^Function(\d+)$/i;
let debugForcedSpeciesId = null;
let debugMegaTestPending = false; // megatest入力で立つ、次の選出反映時にメガシンカ機能をオンにするフラグ

// 「megatest」と入力すると、Function9と同じ仕組みで次の選出プールに
// ID9（ラグラージ）が確定で1匹含まれるようになり、同時にそのバトルで
// メガシンカ機能がオンになる（テスト用の裏機能）。
const DEBUG_MEGA_TEST_ID = 'megatest';
const MEGA_TEST_SPECIES_ID = 9; // ラグラージ

// 「実績リセット」と入力すると、実績の達成状況を一旦すべて消したうえで、
// 既存の記録（最高連勝・図鑑の登録数・メガ図鑑・対戦履歴）から達成済みの実績を
// 改めて判定し直して付け直す（例：10連勝の記録があれば10連勝の実績はそのまま付く）。
const DEBUG_ACHIEVEMENT_RESET_ID = '実績リセット';

// 「reset」と入力すると、本格バトル編成（ボックス・パーティー1〜20・保存データ）を
// すべて初期化する（努力値・技などがおかしくなった時の救済用）。次に本格バトル画面を開くと
// ボックスは種族データから作り直され、パーティーはすべて空になる。
const DEBUG_SERIOUS_RESET_ID = 'reset';

$('btn-title-settings').addEventListener('click', () => {
  $('settings-id-input').value = '';
  $('settings-overlay').classList.add('show');
});
$('settings-cancel-btn').addEventListener('click', () => {
  $('settings-overlay').classList.remove('show');
});
$('settings-id-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('settings-confirm-btn').click();
});
$('settings-confirm-btn').addEventListener('click', () => {
  const value = $('settings-id-input').value.trim();
  $('settings-overlay').classList.remove('show');
  if (value.toLowerCase() === DEBUG_SERIOUS_RESET_ID) {
    sbResetAll();
    return;
  }
  if (value === DEBUG_BOSS_SKIP_ID) {
    startMenuBgmOnFirstInteraction();
    // 9連勝中の状態から開始 → 次に勝てば10連勝目でボス戦。
    // 「ランダム」「チーム」どちらで確認したいか選べるよう、モード選択画面を経由させる。
    debugPendingBossSkipWinStreak = 9;
    openNpcModeSelect();
    return;
  }
  if (value === DEBUG_INTRUSION_TEST_ID) {
    startMenuBgmOnFirstInteraction();
    startNewRun(0, true); // 通常どおりメガ選択→選出→最初の戦いが「3戦目・乱入確定」
    return;
  }
  if (value === DEBUG_ACHIEVEMENT_RESET_ID) {
    if (window.Achievements) {
      window.Achievements.resetAll();
      window.Achievements.checkAutoUnlocks();
    }
    return;
  }
  if (value === DEBUG_MEGA_TEST_ID) {
    debugForcedSpeciesId = MEGA_TEST_SPECIES_ID;
    debugMegaTestPending = true;
    return;
  }
  const m = value.match(DEBUG_FORCE_SPECIES_PATTERN);
  if (m) {
    const speciesId = parseInt(m[1], 10);
    if (GAME_DATA.species[speciesId] && speciesId !== BOSS_SPECIES_ID && speciesId !== BOSS_SPECIES_ID_MEGA && speciesId !== BOSS_SPECIES_ID_TEAM) {
      debugForcedSpeciesId = speciesId;
    }
  }
});

// 選出プール（6匹）を生成する共通処理。デバッグ指定があれば1匹を確定で差し込み、
// 残りをランダムで埋める。指定は一度使ったらリセットする。
function buildPickPoolIds() {
  const allIds = getFinalSpeciesIds();
  const pool = [...allIds].sort(() => Math.random() - 0.5).slice(0, 6);

  // ---- メガシンカ（あり設定時のみ）----
  // 「メガあり」で遊ぶ場合、最初に6匹から3匹選ぶプールに
  // メガシンカ可能な種族を必ず1匹以上含める。
  // 乱入ボスのメガシンカは解放するまでロック中なので、「メガ枠」としては数えない。
  const megaData = (typeof MEGA_EVOLUTION_DATA !== 'undefined' && MEGA_EVOLUTION_DATA) || {};
  const isUsableMega = (id) => !!megaData[id] && isMegaUsableInBattle(id);
  if (state.megaEvolutionEnabled && !pool.some(isUsableMega)) {
    const megaCandidates = allIds.filter(isUsableMega);
    if (megaCandidates.length > 0) {
      const pick = megaCandidates[Math.floor(Math.random() * megaCandidates.length)];
      const replaceAt = Math.floor(Math.random() * pool.length);
      pool[replaceAt] = pick;
    }
  }

  if (debugForcedSpeciesId !== null) {
    pool[0] = debugForcedSpeciesId;
    debugForcedSpeciesId = null;
  }
  // ---- メガシンカ（テスト機能） ----
  // 「megatest」入力で立ったフラグを、選出プールに実際に反映したタイミングで
  // state.megaEvolutionEnabled に引き継ぐ（このバトルでメガシンカ機能を有効化）。
  if (debugMegaTestPending) {
    debugMegaTestPending = false;
    state.megaEvolutionEnabled = true;
  }
  return pool;
}

/* ---- 図鑑（📖）：ホーム画面右上の⚙️の左から開く ---- */
// 「ポケモン」タブ：最終進化系のみをID順。「メガシンカ」タブ：メガシンカ可能な種族のみをID順
// （X/Y両フォームを持つ種族はXが先・Yが後の2枠として並べる）。
let pokedexTab = 'normal';

function pokedexEntryIds() {
  // 選出プールと同じ「最終進化系 or 進化しないポケモン」のみをID順で並べる。
  // 隠しポケモンは実績未解除でも枠自体は図鑑に表示するため、専用関数を使う。
  return sortByPokedexOrder(getFinalSpeciesIdsForPokedex());   // 本家の図鑑番号順（並びは engine.js の POKEDEX_CUSTOM_ORDER で編集）
}

// メガシンカタブのエントリ一覧：{ speciesId, formKey } の配列。
// formKeyはX/Yフォームを持つ種族のみ 'X'/'Y'、単一フォームの種族は null。
function pokedexMegaEntries() {
  const ids = Object.keys(MEGA_EVOLUTION_DATA).map((n) => Number(n)).sort((a, b) => a - b);
  const entries = [];
  for (const id of ids) {
    const raw = MEGA_EVOLUTION_DATA[id];
    if (raw && raw.forms) {
      entries.push({ speciesId: id, formKey: 'X' });
      entries.push({ speciesId: id, formKey: 'Y' });
    } else {
      entries.push({ speciesId: id, formKey: null });
    }
  }
  return entries;
}

function pokedexCellHtml(speciesId, displayNo, formKey) {
  const sp = GAME_DATA.species[speciesId];
  const baseName = sp ? sp.name : `？？？(${speciesId})`;
  const found = Pokedex.has(speciesId);
  const shinyCaught = Pokedex.hasShiny(speciesId);
  const isMegaTab = formKey !== undefined;
  const caught = isMegaTab ? (found && Pokedex.hasMega(speciesId, formKey)) : found;
  const showShiny = caught && shinyCaught && Pokedex.isViewingShiny(speciesId);
  const formSuffix = formKey ? formKey.toLowerCase() : '';
  const imgIdPart = isMegaTab ? `m${speciesId}${formSuffix}` : `${speciesId}`;
  const imgSrc = caught ? `./${imgIdPart}${showShiny ? 's' : ''}.png` : './secret.png';
  const formLabel = formKey ? formKey : '';
  const displayName = caught ? (isMegaTab ? `メガ${formLabel}${baseName}` : baseName) : '？？？';
  // 乱入ボスのメガシンカ：実績画面で解放するまで、図鑑では中身を隠して🔒を重ねる。
  const megaLocked = isMegaTab && !isMegaUnlocked(speciesId);
  if (megaLocked) {
    const ready = canUnlockMega(speciesId); // 実績は解除済み＝ロックをタップで解放できる
    return `<div class="pokedex-cell locked mega-locked${ready ? ' unlock-ready' : ''}" data-species-id="${speciesId}" data-display-no="${displayNo}" data-form-key="${formKey || ''}" data-mega-locked="1">
    <div class="pokedex-cell-imgwrap">
      <img src="./secret.png" alt="" onerror="this.style.visibility='hidden'">
      <span class="pokedex-cell-lock">🔒</span>
    </div>
    <div class="pokedex-cell-no">No.${displayNo}</div>
    <div class="pokedex-cell-name">？？？</div>
  </div>`;
  }
  // 隠しポケモン（種族そのものが実績未解除の間は完全に非公開）：
  // 通常タブでのみ発生しうる。対応する実績が解除された瞬間に自動でロックが外れる
  // （メガロックと違い、タップでの手動解放は無い）。
  const hiddenLocked = !isMegaTab && isHiddenSpecies(speciesId) && !isHiddenSpeciesUnlocked(speciesId);
  if (hiddenLocked) {
    return `<div class="pokedex-cell locked hidden-locked" data-species-id="${speciesId}" data-display-no="${displayNo}" data-form-key="${formKey || ''}" data-hidden-locked="1">
    <div class="pokedex-cell-imgwrap">
      <img src="./secret.png" alt="" onerror="this.style.visibility='hidden'">
      <span class="pokedex-cell-lock">🔒</span>
    </div>
    <div class="pokedex-cell-no">No.${displayNo}</div>
    <div class="pokedex-cell-name">？？？？？</div>
  </div>`;
  }
  return `<div class="pokedex-cell${caught ? '' : ' locked'}" data-species-id="${speciesId}" data-display-no="${displayNo}" data-form-key="${formKey || ''}">
    <div class="pokedex-cell-imgwrap">
      <img src="${imgSrc}" alt="" onerror="this.style.visibility='hidden'">
    </div>
    ${shinyCaught ? '<span class="pokedex-cell-shiny-mark">✨</span>' : ''}
    <div class="pokedex-cell-no">No.${displayNo}</div>
    <div class="pokedex-cell-name">${displayName}</div>
  </div>`;
}

function renderPokedex() {
  $('pokedex-tab-normal').classList.toggle('active', pokedexTab === 'normal');
  $('pokedex-tab-mega').classList.toggle('active', pokedexTab === 'mega');
  if (pokedexTab === 'mega') {
    const entries = pokedexMegaEntries();
    const caughtCount = entries.filter((e) => Pokedex.has(e.speciesId) && Pokedex.hasMega(e.speciesId, e.formKey)).length;
    $('pokedex-count').textContent = `見つけたメガシンカの数 ${caughtCount}/${entries.length}`;
    $('pokedex-grid').innerHTML = entries.map((e, i) => pokedexCellHtml(e.speciesId, i + 1, e.formKey)).join('');
  } else {
    const ids = pokedexEntryIds();
    const foundCount = ids.filter((id) => Pokedex.has(id)).length;
    $('pokedex-count').textContent = `見つけたポケモンの数 ${foundCount}/${ids.length}`;
    $('pokedex-grid').innerHTML = ids.map((id, i) => pokedexCellHtml(id, i + 1)).join('');
  }
}

$('btn-title-pokedex').addEventListener('click', () => {
  pokedexTab = 'normal';
  renderPokedex();
  $('pokedex-overlay').classList.add('show');
});
$('pokedex-close-btn').addEventListener('click', () => {
  $('pokedex-overlay').classList.remove('show');
});

// 対人戦（マルチプレイ）：降参ボタンを使わず試合が終わった時のみ、お互いに+10。
const PVP_DISC_REWARD = 10;

/* ---- ディスク報酬（NPC戦：メガあり/なし・チームバトル共通） ----
   winStreak（勝利後の連勝数＝何戦目に勝ったか）に応じて加算量を決める。
   1〜5戦目            : +10
   6〜9戦目            : +20
   10戦目・20戦目…(ボス): +50 （10の倍数）
   11〜19戦目、21〜29戦目…: +25 （10の倍数を除く、11戦目以降）
   このルールは11戦目以降、10戦目区切りで無限に繰り返す
   （31〜39→+25、40(ボス)→+50、…）。 */
function calcNpcDiscReward(battleNo) {
  const n = Math.floor(Number(battleNo) || 0);
  if (n <= 0) return 0;
  if (n <= 5) return 10;
  if (n <= 9) return 20;
  if (n % 10 === 0) return 50; // 10戦目区切りのボス（10, 20, 30, ...）
  return 25; // 11戦目以降のボス以外（11〜19, 21〜29, 31〜39, ...）
}

/* ---- ショップ（購入・所持ディスク管理） ----
   speciesId: 価格(disc) のオブジェクトで、ポケモンごとに個別の値段を設定する。
   所持ディスク数・購入済みポケモンはlocalStorageに永続化する。
   ディスクはNPC戦・対人戦の勝利で加算される（DiscReward参照）。 */
const SHOP_ITEMS = {
	17:100,
	1012: 100,
  410: 50,
  411: 50,
  486: 50,
  489: 50,
  557: 50,
  595: 50,
596: 50,
598: 50,
600: 50,
601: 50,
602: 50,
603: 50,
604: 50,
1000: 50,
1001: 50,
1002: 50,
1003: 50,
1004: 50,
1005: 50,
1006: 50,
1007: 50,
1008: 50,
1009: 50,
1010: 50,
1013: 50,
  1032: 50,
  1042:100,
};

const SHOP_DISC_STORAGE_KEY = 'pokeriere_shop_disc_v1';
const SHOP_OWNED_STORAGE_KEY = 'pokeriere_shop_owned_v1';
const SHOP_DISC_INITIAL = 0;

const Shop = (() => {
  let disc = SHOP_DISC_INITIAL;
  let owned = new Set();

  function load() {
    try {
      const rawDisc = localStorage.getItem(SHOP_DISC_STORAGE_KEY);
      disc = rawDisc !== null ? Math.max(0, Number(rawDisc) || 0) : SHOP_DISC_INITIAL;
    } catch (e) { disc = SHOP_DISC_INITIAL; }
    try {
      const rawOwned = localStorage.getItem(SHOP_OWNED_STORAGE_KEY);
      owned = rawOwned ? new Set(JSON.parse(rawOwned).map((n) => Number(n))) : new Set();
    } catch (e) { owned = new Set(); }
  }

  function saveDisc() {
    try { localStorage.setItem(SHOP_DISC_STORAGE_KEY, String(disc)); } catch (e) {}
  }
  function saveOwned() {
    try { localStorage.setItem(SHOP_OWNED_STORAGE_KEY, JSON.stringify([...owned])); } catch (e) {}
  }

  function getDisc() { return disc; }

  // ディスクを加算する（バトル勝利報酬など）。amountは正の整数を想定。
  function addDisc(amount) {
    const n = Math.floor(Number(amount) || 0);
    if (n <= 0) return disc;
    disc += n;
    saveDisc();
    return disc;
  }

  // ショップに並んでいないポケモンは、そもそもロック対象ではない＝常に所持扱い。
  function isOwned(speciesId) {
    if (!(speciesId in SHOP_ITEMS)) return true;
    return owned.has(speciesId);
  }

  // 購入処理：ディスクが足りなければ何もせず false を返す。
  function buy(speciesId, price) {
    if (isOwned(speciesId)) return false; // 既に持っている
    if (disc < price) return false;
    disc -= price;
    owned.add(speciesId);
    saveDisc();
    saveOwned();
    return true;
  }

  load();
  return { getDisc, addDisc, isOwned, buy };
})();

// ショップカードの縁取り・グローに使う代表タイプ色を1つ返す（第1タイプ優先）。
function shopSpeciesAccentColor(sp) {
  if (!sp) return '#6b7a9e';
  const primaryType = sp.type1 || sp.type2;
  return TR_TYPE_COLOR[primaryType] || '#6b7a9e';
}

// ショップ用の画像パス：通常は"{id}.png"だが、ヨワシ（むれたすがた）のように
// フォーム違いで画像ファイル名が変わる種族はspritePath()と同じ規則に合わせる。
function shopSpritePath(speciesId) {
  const isYowashiSchool = speciesId === 1012; // ショップに並ぶヨワシは「むれたすがた」の見た目で統一
  const idPart = isYowashiSchool ? `A${speciesId}` : `${speciesId}`;
  return `./${idPart}.png`;
}
// 画像が読み込めなかった場合、非表示にせず種族番号入りの色付きプレースホルダーに差し替える。
function shopImgTag(speciesId) {
  return `<img src="${shopSpritePath(speciesId)}" alt="" onerror="this.replaceWith(makeFallback(${speciesId}, 'shop-cell-sprite'))">`;
}

function shopCellHtml(speciesId) {
  const sp = GAME_DATA.species[speciesId];
  const name = sp ? sp.name : `？？？(${speciesId})`;
  const owned = Shop.isOwned(speciesId);
  const price = SHOP_ITEMS[speciesId];
  const accent = shopSpeciesAccentColor(sp);
  return `<div class="shop-cell${owned ? ' owned' : ''}" data-species-id="${speciesId}" style="--cell-type-color:${accent}">
    <div class="shop-cell-imgwrap">
      ${shopImgTag(speciesId)}
    </div>
    <div class="shop-cell-name">${name}</div>
    <div class="shop-cell-price">
      ${owned
        ? '<span class="shop-cell-owned-label">こうにゅうずみ</span>'
        : `<img src="./disc.png" alt="" onerror="this.style.display='none'"><span>${price}</span>`}
    </div>
  </div>`;
}

function renderShop() {
  $('shop-grid').innerHTML = Object.keys(SHOP_ITEMS).map(Number).map(shopCellHtml).join('');
  $('shop-currency-count').textContent = String(Shop.getDisc());
}

function openShopDetail(speciesId) {
  const sp = GAME_DATA.species[speciesId];
  const name = sp ? sp.name : `？？？(${speciesId})`;
  const owned = Shop.isOwned(speciesId);
  const price = SHOP_ITEMS[speciesId];
  const accent = shopSpeciesAccentColor(sp);
  const types = sp ? [sp.type1, sp.type2].filter(Boolean) : [];
  $('shop-detail-card').style.setProperty('--cell-type-color', accent);
  $('shop-detail-card').innerHTML = `
    <div class="shop-detail-imgwrap">
      ${shopImgTag(speciesId)}
    </div>
    <div class="shop-detail-name">${name}</div>
    <div class="shop-detail-types">${types.map((t) => typeChipHtml(t)).join('')}</div>
    <div class="shop-detail-price" id="shop-detail-price">
      ${owned
        ? '<span class="shop-cell-owned-label">こうにゅうずみ</span>'
        : `<img src="./disc.png" alt="" onerror="this.style.display='none'"><span>${price}</span>`}
    </div>
    <div class="shop-detail-btn-row">
      <button class="neu-btn shop-detail-btn" id="shop-detail-cancel" type="button">とじる</button>
      ${owned ? '' : '<button class="shop-detail-btn primary" id="shop-detail-buy" type="button">こうにゅう</button>'}
    </div>
  `;
  $('shop-detail-overlay').classList.add('show');
  $('shop-detail-cancel').addEventListener('click', closeShopDetail);
  const buyBtn = $('shop-detail-buy');
  if (buyBtn) {
    buyBtn.addEventListener('click', () => {
      const ok = Shop.buy(speciesId, price);
      if (ok) {
        // ボックスにポケモンが既に存在していればロック表示だけ解除、
        // まだ無ければ通常のボックス構築時と同じ生成処理で1匹追加する。
        if (typeof sbEnsureSpeciesInBox === 'function') sbEnsureSpeciesInBox(speciesId);
        if (typeof sbRefreshLockState === 'function') sbRefreshLockState();
        renderShop();
        closeShopDetail();
      } else {
        // ディスク不足：金額表示をゆらして知らせつつ、最新の所持ディスク数を反映する
        const priceEl = $('shop-detail-price');
        if (priceEl) {
          priceEl.classList.remove('insufficient');
          void priceEl.offsetWidth;
          priceEl.classList.add('insufficient');
        }
      }
    });
  }
}

function closeShopDetail() {
  $('shop-detail-overlay').classList.remove('show');
}

$('btn-title-shop').addEventListener('click', () => {
  renderShop();
  $('shop-overlay').classList.add('show');
  MenuBgm.stop();
  ShopBgm.start();
});
$('shop-close-btn').addEventListener('click', () => {
  $('shop-overlay').classList.remove('show');
  ShopBgm.stop();
  MenuBgm.start();
});
$('shop-grid').addEventListener('click', (e) => {
  const cell = e.target.closest('.shop-cell');
  if (!cell) return;
  openShopDetail(Number(cell.dataset.speciesId));
});
$('shop-detail-overlay').addEventListener('click', (e) => {
  if (e.target === $('shop-detail-overlay')) closeShopDetail();
});

/* ---- おまけ：夏空のやくそく カードゲーム（ba-cardgame.js） ---- */
if ($('btn-ba-cardgame')) {
  $('btn-ba-cardgame').addEventListener('click', () => {
    if (window.BACardGame && typeof window.BACardGame.open === 'function') {
      window.BACardGame.open();
    } else {
      console.warn('BACardGame が読み込まれていません（ba-cardgame.js の読み込み順・パスを確認してください）');
    }
  });
}
$('pokedex-tab-normal').addEventListener('click', () => {
  if (pokedexTab === 'normal') return;
  pokedexTab = 'normal';
  renderPokedex();
});
$('pokedex-tab-mega').addEventListener('click', () => {
  if (pokedexTab === 'mega') return;
  pokedexTab = 'mega';
  renderPokedex();
});

/* ---- 図鑑：発見済みポケモンの詳細（種族値ランク表示） ---- */
// 種族値 → ランク文字（135以上:S, 110以上:A, 90以上:B, 70以上:C, 45以上:D, それ未満:E）
function baseStatRank(value) {
  if (value >= 135) return 'S';
  if (value >= 110) return 'A';
  if (value >= 90) return 'B';
  if (value >= 70) return 'C';
  if (value >= 45) return 'D';
  return 'E';
}

const POKEDEX_STAT_LABELS = [
  ['hp', 'HP'], ['atk', 'こうげき'], ['def', 'ぼうぎょ'],
  ['spa', 'とくこう'], ['spd', 'とくぼう'], ['spe', 'すばやさ'],
];

function pokedexAbilitiesHtml(species) {
  const ids = (species.abilities || []).filter((id) => id !== undefined && id !== null && id !== 0);
  if (ids.length === 0) return `<div class="pdx-ability-row"><div class="pdx-ability-name">なし</div></div>`;
  // 同じ特性が重複している場合はまとめて表示する
  const uniqueIds = [...new Set(ids)];
  return uniqueIds.map((id) => {
    const desc = abilityDescById(id);
    return `<div class="pdx-ability-row">
      <div class="pdx-ability-name">${abilityJp(id)}</div>
      ${desc ? `<div class="pdx-ability-desc">${desc}</div>` : ''}
    </div>`;
  }).join('');
}

function pokedexStatsHtml(species) {
  const base = species.baseStats;
  return POKEDEX_STAT_LABELS.map(([key, label]) => {
    const value = base[key];
    const rank = baseStatRank(value);
    return `<div class="pdx-stat-row">
      <span class="pdx-stat-label">${statIconHtml(key, 'pdx-stat-ico')}${label}</span>
      <span class="pdx-stat-rank pdx-rank-${rank}">${rank}</span>
    </div>`;
  }).join('');
}

let pdxDetailSpeciesId = null;
// 詳細画面を開いた時点のタブに応じて固定される表示モード。通常タブなら null、
// メガタブなら 'X'/'Y'/true（単一フォーム種族）のいずれか。
let pdxDetailFormKey = null;
let pdxDetailIsMega = false;

function renderPokedexDetailForm(speciesId) {
  const sp = GAME_DATA.species[speciesId];
  if (!sp) return;
  const shinyCaught = Pokedex.hasShiny(speciesId);
  const showShiny = shinyCaught && Pokedex.isViewingShiny(speciesId);
  const showMega = pdxDetailIsMega;
  const megaData = showMega ? getMegaEvolutionDataForSpeciesId(speciesId, pdxDetailFormKey) : null;

  // 画像パス：通常は "{id}.png"（色違いは"{id}s.png"）、
  // メガは "m{id}.png"（色違いは"m{id}s.png"）。X/Yフォームは "m{id}x.png"/"m{id}y.png"。
  const formSuffix = (showMega && pdxDetailFormKey) ? pdxDetailFormKey.toLowerCase() : '';
  const imgIdPart = showMega ? `m${speciesId}${formSuffix}` : `${speciesId}`;
  $('pdx-detail-img').src = `./${imgIdPart}${showShiny ? 's' : ''}.png`;
  const formLabel = (showMega && pdxDetailFormKey) ? pdxDetailFormKey : '';
  $('pdx-detail-name').textContent = showMega ? `メガ${formLabel}${sp.name}` : sp.name;
  const types = megaData
    ? [megaData.type1, megaData.type2].filter(Boolean)
    : [sp.type1, sp.type2].filter(Boolean);
  $('pdx-detail-types').innerHTML = types.map((t) => typeChipHtml(t)).join('');
  const abilitySource = megaData ? { abilities: [megaData.ability] } : sp;
  $('pdx-detail-abilities').innerHTML = pokedexAbilitiesHtml(abilitySource);
  const statsSource = megaData ? { baseStats: megaData.baseStats } : sp;
  $('pdx-detail-stats').innerHTML = pokedexStatsHtml(statsSource);

  const toggleBtn = $('pdx-shiny-toggle-btn');
  if (toggleBtn) {
    toggleBtn.style.display = shinyCaught ? '' : 'none';
    toggleBtn.classList.toggle('active', showShiny);
  }
  const favBtn = $('pdx-favorite-btn');
  if (favBtn) {
    const fav = Pokedex.getFavorite();
    const isThisFavorite = !!fav && fav.speciesId === speciesId;
    favBtn.classList.toggle('active', isThisFavorite);
  }
}

// isMega/formKeyは呼び出し元（一覧のセル）が今どちらのタブに属しているかで決まる。
function showPokedexDetail(speciesId, displayNo, isMega, formKey) {
  const sp = GAME_DATA.species[speciesId];
  if (!sp) return;
  pdxDetailSpeciesId = speciesId;
  pdxDetailIsMega = !!isMega;
  pdxDetailFormKey = formKey || null;
  $('pdx-detail-no').textContent = `No.${displayNo}`;
  renderPokedexDetailForm(speciesId);
  $('pokedex-detail-overlay').classList.add('show');
}

let _pokedexToastTimer = null;
function showPokedexToast(text) {
  let el = document.getElementById('pokedex-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'pokedex-toast';
    el.className = 'pokedex-toast';
    document.body.appendChild(el);
  }
  el.textContent = text;
  requestAnimationFrame(() => el.classList.add('show'));
  clearTimeout(_pokedexToastTimer);
  _pokedexToastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

$('pokedex-grid').addEventListener('click', (e) => {
  const cell = e.target.closest('.pokedex-cell');
  if (!cell) return;
  // メガ図鑑のロック中セル：実績が解除済みならここで解放。未解除ならヒントだけ出す。
  if (cell.dataset.megaLocked === '1') {
    const sid = parseInt(cell.dataset.speciesId, 10);
    if (unlockMega(sid)) {
      const nm = (GAME_DATA.species[sid] && GAME_DATA.species[sid].name) || ('#' + sid);
      showPokedexToast(`✨ ${nm} のメガシンカが解放された！`);
      renderPokedex();
    } else {
      showPokedexToast('乱入してくるボスを倒して実績を解除すると解放できる');
    }
    return;
  }
  if (cell.classList.contains('locked')) return;
  const speciesId = parseInt(cell.dataset.speciesId, 10);
  const displayNo = parseInt(cell.dataset.displayNo, 10);
  const formKey = cell.dataset.formKey || null;
  showPokedexDetail(speciesId, displayNo, pokedexTab === 'mega', formKey);
});
$('pokedex-detail-close').addEventListener('click', () => {
  $('pokedex-detail-overlay').classList.remove('show');
  // 一覧側にも色違い表示の切替結果を反映
  renderPokedex();
});
$('pdx-shiny-toggle-btn').addEventListener('click', () => {
  if (pdxDetailSpeciesId === null) return;
  Pokedex.toggleView(pdxDetailSpeciesId);
  renderPokedexDetailForm(pdxDetailSpeciesId);
});
$('pdx-favorite-btn').addEventListener('click', () => {
  if (pdxDetailSpeciesId === null) return;
  // ✨がオン（色違い表示中）で登録するなら、お気に入りも色違いとして記録する
  // メガタブから開いた詳細で登録するなら、お気に入りもそのメガ形態として記録する
  const shinyNow = Pokedex.hasShiny(pdxDetailSpeciesId) && Pokedex.isViewingShiny(pdxDetailSpeciesId);
  Pokedex.toggleFavorite(pdxDetailSpeciesId, shinyNow, pdxDetailIsMega, pdxDetailFormKey);
  renderPokedexDetailForm(pdxDetailSpeciesId);
  // 対人戦のルーム画面がすでに開いている場合に備えて、自分側の表示も更新しておく
  if (typeof syncMyFavoriteToRoom === 'function') syncMyFavoriteToRoom();
});


$('btn-create-room').addEventListener('click', () => {
  // 名前入力なしで即ルーム作成
  if (!state.playerName) state.playerName = PlayerProfile.get();
  startHostRoom();
});
$('btn-join-room').addEventListener('click', () => openNameModal());
$('multi-back-to-title').addEventListener('click', () => showScreen('title'));

$('name-modal-cancel').addEventListener('click', () => closeNameModal());
$('name-modal-confirm').addEventListener('click', () => onNameModalConfirm());

$('input-room-code').addEventListener('input', (e) => {
  e.target.value = (e.target.value || '').replace(/\D/g, '').slice(0, 4);
  updateNameCharCount();
});

$('input-room-code').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); onNameModalConfirm(); }
});

$('host-wait-cancel').addEventListener('click', () => cancelHostRoom());
$('btn-ready-toggle').addEventListener('click', () => toggleReady());
function setMegaSettingFromHost(next) {
  if (!state.isHost) return; // ゲスト側は閲覧のみ、変更不可
  if (Net.megaEnabled === next) return;
  Net.megaEnabled = next;
  renderMegaSettingRow();
  Net.setMegaEnabled(next);
}
$('btn-mega-setting-toggle').addEventListener('click', () => setMegaSettingFromHost(true));
$('btn-mega-setting-off').addEventListener('click', () => setMegaSettingFromHost(false));

// フルスクリーン化は document 全体の click リスナー（isFullscreenActive 判定つき）に
// 一本化してあるため、タイトル画面限定のリスナーは不要（重複呼び出し防止のため削除）。

/* =========================================================
   本格バトル：パーティ編成画面（UIのみ）
   ・ボックス：対戦の選出に使われる全ポケモン（最終進化・進化しないポケモン。ボス専用は除く）を図鑑番号順に表示。
     メガシンカは変身であって別の種族ではないため、ボックスにはメガ前の通常の姿だけが並ぶ（所持管理は未実装）
   ・パーティ：最大6匹。ボックスのマスをタップで追加/外す、パーティ枠タップで詳細表示
   ・詳細：種族名 / タイプ / 特性 / 実数値＋努力値ポイント（バー・最大32） / 技4つ（タイプアイコン・PP） / トレーニング
   ・メガシンカできるポケモンは、ボックスのマスの右下に mega.png を表示
   ========================================================= */
const SB_PARTY_MAX = 6;
const SB_EV_MAX = 32;   // 努力値ポイント（能力ごと）の最大
const SB_EV_TOTAL = 66;   // 努力値ポイントの合計上限
const SB_LEVEL = 50;      // 編成画面のポケモンのレベル（ここだけ50。3匹選ぶ等の別モードは100のまま）
const SB_STAT_KEYS = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
const SB_STORAGE_KEY = 'pokeriere_serious_party_v1';
const SB_FIXED_NATURE = 25;   // まじめ（NATURE_TABLE に無い＝上昇・下降なし）
const SB_PARTY_NAME_MAX = 10;
// ボックスの並び替え（表示専用）。sbState.box 自体（保存・パーティ復元の基準＝図鑑番号順）は並び替えず、
// 表示する順番だけを変える。選んだ並び方は別キーで保存し、ゲームを閉じても覚えている。
const SB_SORT_STORAGE_KEY = 'pokeriere_serious_box_sort_v1';
const SB_SORT_OPTIONS = [
  ['no',   '番号順'],
  ['type', 'タイプ順'],
  ['hp',   'HP順'],
  ['atk',  '攻撃順'],
  ['def',  '防御順'],
  ['spa',  '特攻順'],
  ['spd',  '特防順'],
  ['spe',  '素早さ順'],
];
function sbLoadSortKey() {
  try {
    const k = localStorage.getItem(SB_SORT_STORAGE_KEY);
    if (SB_SORT_OPTIONS.some(([key]) => key === k)) return k;
  } catch (e) { /* プライベートモード等は無視 */ }
  return 'no';   // 初期値：番号順
}
function sbSaveSortKey(k) {
  try { localStorage.setItem(SB_SORT_STORAGE_KEY, k); } catch (e) { /* 保存できなくても動作は続ける */ }
}
// 並び替えのオプション（チェックボックス2つ）。どちらも「HP〜素早さ順」のときだけ効く（表示専用）。
//   noEv  ：努力値なし ＝ 努力値ポイントを足さない実数値で並べる
//   mega  ：メガを考慮する ＝ 解放済みのメガシンカ持ちは、メガ後の種族値の実数値で並べる
const SB_SORT_OPT_STORAGE_KEY = 'pokeriere_serious_box_sort_opt_v1';
function sbLoadSortOpt() {
  const def = { noEv: false, mega: false };
  try {
    const d = JSON.parse(localStorage.getItem(SB_SORT_OPT_STORAGE_KEY) || 'null');
    if (d && typeof d === 'object') return { noEv: !!d.noEv, mega: !!d.mega };
  } catch (e) { /* プライベートモード等は無視 */ }
  return def;
}
function sbSaveSortOpt(o) {
  try { localStorage.setItem(SB_SORT_OPT_STORAGE_KEY, JSON.stringify({ noEv: !!o.noEv, mega: !!o.mega })); } catch (e) { /* 保存できなくても動作は続ける */ }
}
const SB_PARTY_COUNT = 20;   // 保存できるパーティ数（パーティ1〜20）
const sbDefaultPartyName = (n) => `パーティ${n}`;   // n は 1 始まりの番号
const SB_DEFAULT_PARTY_NAME = sbDefaultPartyName(1);
const SB_WORKING_NAME = 'パーティー';   // どのチームにも属さない作業スペースの初期表示名
const sbState = {
  box: [],          // ボックスのポケモン（createRandomPokemonで生成した個体）。20パーティで共有する
  parties: [],      // 20個分：{ name, snapshot:[保存された個体の控え, 最大6] または null（未保存） }
  current: -1,      // いま「セット」で読み込んだ元のパーティ番号（-1＝どのチームにも属さない）。
                     // 手持ちの中身そのものは常に workingMembers にあり、current はあくまで目印。
  workingMembers: [],   // ボックス画面左の「今の手持ち」（ボックス内の個体への参照。長さは最大6で、途中に null＝空き枠を許す。外しても詰めない）
  workingName: SB_WORKING_NAME,
  selected: null,   // 詳細パネルに表示中の個体
  built: false,
  sortKey: sbLoadSortKey(),   // 【表示専用】ボックスの並び方（no/type/hp/atk/def/spa/spd/spe）。保存される
  sortOpt: sbLoadSortOpt(),   // 【表示専用】並び替えのオプション { noEv: 努力値なし, mega: メガを考慮する }。保存される
  megaView: false,  // 【表示専用】trueならメガシンカ可能なポケモンのステータスをメガ後の種族値で表示する（画像やデータそのものは変えない）
  // 以下は「今の手持ち」への窓口。既存の描画・並び替え・追加/外すの処理はこれまで通り
  // sbState.party / sbState.partyName を読み書きするだけでよい（実体は常に working 側）。
  get party() { return this.workingMembers; },
  set party(v) { this.workingMembers = v; },
  get partyName() { return this.workingName; },
  set partyName(v) { this.workingName = v; },
};
function sbInitParties() {
  // snapshot：そのパーティ番号に「保存」されたチームの技・努力値・特性などの控え（sbSerializePoke形式の配列）。
  // まだ一度も保存していない番号は null（＝空欄と表示する）。
  sbState.parties = Array.from({ length: SB_PARTY_COUNT }, (_, i) => ({ name: sbDefaultPartyName(i + 1), snapshot: null }));
  sbState.current = -1;         // 起動時・リセット時は「どのチームにも入れていない」状態から始める
  sbState.workingMembers = [];
  sbState.workingName = SB_WORKING_NAME;
}
sbInitParties();

/* ---------------------------------------------------------
   本格バトル：編成の保存（localStorage）
   ・保存するのは「再現に必要な最小限」：種族ID／特性／技ID／色違い／努力値ポイント／メガ形態
     ＋ パーティの並び（ボックス番号）＋ パーティ名
   ・実数値やPP等は保存しない。復元時に createRandomPokemon で作った完全な個体へ上書きして再計算するので、
     ゲーム側に項目が増えても壊れない。
   ・性格は保存しない。常に SB_FIXED_NATURE（25=まじめ・補正なし）に固定。
   --------------------------------------------------------- */

function sbSerializePoke(p) {
  return {
    id: p.speciesId,
    ab: p.ability,
    na: p.nature,
    mv: p.moves.map((m) => m.id),
    sh: p.shiny ? 1 : 0,
    ev: SB_STAT_KEYS.map((k) => (p.evPoints && p.evPoints[k]) || 0),
    mf: p.megaForm || null,
  };
}

function sbSave() {
  if (!sbState.built) return;   // まだ何も作っていない状態で空データを上書きしない
  try {
    const data = {
      v: 3,
      current: sbState.current,         // -1＝どのチームにも属さない作業中の手持ち
      box: sbState.box.map(sbSerializePoke),
      // 空き枠は -1 で保存して位置を保つ（「2を外したら2が空白」のまま復元するため）。旧データ（詰めた配列）もそのまま読める。
      workingIdx: sbState.workingMembers.map((p) => (p ? sbState.box.indexOf(p) : -1)),
      workingName: sbState.workingName,
      // 各パーティ：名前と、そこへ「保存」した時点の技・努力値等の控え（チームごとに独立して保持する）
      parties: sbState.parties.map((pt) => ({
        name: pt.name,
        snap: Array.isArray(pt.snapshot) ? pt.snapshot.map(sbSerializePoke) : null,
      })),
    };
    localStorage.setItem(SB_STORAGE_KEY, JSON.stringify(data));
  } catch (e) { /* 容量超過・プライベートモード等は黙って諦める（遊べなくならないように） */ }
}

// 保存データ1体ぶんから個体を復元。壊れている／存在しない種族なら null。
function sbRestorePoke(d) {
  if (!d || !GAME_DATA.species[d.id]) return null;
  const p = sbCreateDefaultPokemon(d.id);      // 完全な個体（性格25固定・EV0）を作る
  const sp = GAME_DATA.species[d.id];
  // 特性：その種族で有効なものだけ採用（種族データ変更への保険）
  if (Array.isArray(sp.abilities) ? sp.abilities.includes(d.ab) : d.ab === p.ability) p.ability = d.ab;
  // 能力補正（性格）：1〜25の有効な範囲のものだけ採用
  const na = parseInt(d.na, 10);
  if (na >= 1 && na <= 25) p.nature = na;
  // 技：存在するIDだけ採用。1つも残らなければランダムのまま
  const moves = (Array.isArray(d.mv) ? d.mv : []).map((id) => buildMoveObject(id)).filter(Boolean).slice(0, 4);
  if (moves.length > 0) p.moves = moves;
  // 色違いは図鑑に登録済みの種族だけ有効（保存データが改ざんされても／図鑑がリセットされても崩れない）
  p.shiny = !!d.sh && Pokedex.hasShiny(d.id);
  if (Array.isArray(d.ev)) {
    SB_STAT_KEYS.forEach((k, i) => {
      p.evPoints[k] = Math.max(0, Math.min(SB_EV_MAX, parseInt(d.ev[i], 10) || 0));
    });
    // 合計が上限を超える保存データ（改ざん等）は、後ろの能力から削って収める
    let over = SB_STAT_KEYS.reduce((s, k) => s + p.evPoints[k], 0) - SB_EV_TOTAL;
    for (let i = SB_STAT_KEYS.length - 1; i >= 0 && over > 0; i--) {
      const k = SB_STAT_KEYS[i]; const cut = Math.min(p.evPoints[k], over); p.evPoints[k] -= cut; over -= cut;
    }
  }
  if (d.mf === 'X' || d.mf === 'Y') { if (p.megaForm) p.megaForm = d.mf; }
  sbRecalcStats(p);
  return p;
}

// 保存データを読み込む。成功したら true。
function sbLoad() {
  let raw;
  try { raw = localStorage.getItem(SB_STORAGE_KEY); } catch (e) { return false; }
  if (!raw) return false;
  try {
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.box)) return false;
    // 保存時のボックス番号(idx の値)で引けるよう、null を含んだまま元の並びを保持しておく
    const restored = data.box.map(sbRestorePoke);
    // ゲーム側で種族が増減しても崩れないよう「今の全種族」と突き合わせる
    const idsNow = sortByPokedexOrder(getFinalSpeciesIds());
    const nowSet = new Set(idsNow);
    const kept = restored.filter((p) => p && nowSet.has(p.speciesId));   // 削除された種族は除外
    const have = new Set(kept.map((p) => p.speciesId));
    const added = idsNow.filter((id) => !have.has(id)).map((id) => sbCreateDefaultPokemon(id)); // 新種族は追加
    sbState.box = sbSortBoxByDexOrder(kept.concat(added));   // 図鑑と同じ並び
    // 保存されたボックス番号の並び → 個体の配列（欠けた個体・重複・6匹超過は除く）
    const toMembers = (idxList) => (Array.isArray(idxList) ? idxList : [])
      .map((i) => restored[i])
      .filter((p) => p && sbState.box.includes(p))
      .filter((p, i, a) => a.indexOf(p) === i)
      .slice(0, SB_PARTY_MAX);
    // 手持ち用：保存位置を保ったまま復元する（-1・壊れた個体・重複は空き枠 null に。末尾の空きは切り詰める）
    const toSlots = (idxList) => {
      const seen = new Set();
      const arr = (Array.isArray(idxList) ? idxList : []).slice(0, SB_PARTY_MAX).map((i) => {
        const p = (i >= 0) ? restored[i] : null;
        if (!p || !sbState.box.includes(p) || seen.has(p)) return null;
        seen.add(p);
        return p;
      });
      while (arr.length && !arr[arr.length - 1]) arr.pop();
      return arr;
    };
    const cleanName = (nm, n) => {
      const t = typeof nm === 'string' ? nm.trim().slice(0, SB_PARTY_NAME_MAX) : '';
      return t || sbDefaultPartyName(n);
    };
    // 保存スナップショット（チームごとの技・努力値等の控え）を個体配列へ復元。壊れたものは除く。
    const toSnapshot = (snap) => {
      if (!Array.isArray(snap)) return null;
      const list = snap.map(sbRestorePoke).filter(Boolean).slice(0, SB_PARTY_MAX);
      return list.length ? list : null;
    };
    sbInitParties();
    if (Array.isArray(data.parties) && data.v >= 3) {
      // v3：チームは「保存されたスナップショット」のみを持つ。手持ちは working 側。
      data.parties.slice(0, SB_PARTY_COUNT).forEach((pt, i) => {
        if (!pt) return;
        sbState.parties[i] = { name: cleanName(pt.name, i + 1), snapshot: toSnapshot(pt.snap) };
      });
      sbState.workingMembers = toSlots(data.workingIdx);
      sbState.workingName = (typeof data.workingName === 'string' && data.workingName.trim().slice(0, SB_PARTY_NAME_MAX)) || SB_WORKING_NAME;
      const cur = parseInt(data.current, 10);
      sbState.current = (cur >= 0 && cur < SB_PARTY_COUNT) ? cur : -1;
    } else if (Array.isArray(data.parties)) {
      // v2（旧：パーティ1〜20がボックス参照のメンバーを直接持っていた形式）
      // → 手持ちはひとまず「未保存の作業スペース」へ、各パーティの当時のメンバー構成は
      //   そのまま初回スナップショットとして引き継ぐ（技・努力値は当時のボックス個体の値のまま）。
      data.parties.slice(0, SB_PARTY_COUNT).forEach((pt, i) => {
        if (!pt) return;
        const members = toMembers(pt.idx);
        sbState.parties[i] = {
          name: cleanName(pt.name, i + 1),
          snapshot: members.length ? members.map((p) => sbRestorePoke(sbSerializePoke(p))).filter(Boolean) : null,
        };
      });
      const cur = parseInt(data.current, 10);
      sbState.workingMembers = (cur >= 0 && cur < SB_PARTY_COUNT) ? toMembers((data.parties[cur] || {}).idx) : [];
      sbState.workingName = SB_WORKING_NAME;
      sbState.current = -1;   // v2以前は「チームに紐付いた手持ち」という概念がないため、未選択から始める
    } else {
      // v1（旧：パーティ1つ）→ 手持ちへそのまま引き継ぐ。これまでの編成は消えない
      sbState.workingMembers = toMembers(data.party);
      sbState.workingName = cleanName(data.partyName, 1);
      sbState.current = -1;
    }
    sbState.selected = null;
    sbState.built = true;
    return true;
  } catch (e) { return false; }   // 壊れたデータなら新規作成へフォールバック
}

// スプライト（画像が無い場合は #番号 の簡易表示に差し替える）
function sbSpriteHtml(poke, cls, lazy) {
  const id = poke.speciesId;
  const lz = lazy ? ' loading="lazy" decoding="async"' : '';
  return `<img class="${cls}" src="${spritePath(poke)}" alt=""${lz} onerror="this.outerHTML='<span class=&quot;${cls}&quot; style=&quot;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:900;color:#7a74a8;&quot;>#${id}</span>'">`;
}

// ボックス／パーティ一覧／トレーニング画面で「メガシンカ関連の表示を出してよいか」の判定。
// メガシンカできる種族で、かつ乱入ボス系なら解放済みのものだけ true。
// canMegaEvolve は対人戦で megaLockActive=false になっている間ロックを無視してしまうため、
// 対戦の種類に左右されず必ず解放状況を見る isMegaUnlocked を直接使う（ネタバレ防止）。
function sbMegaVisible(p) {
  return !!(p && MEGA_EVOLUTION_DATA[p.speciesId] && isMegaUnlocked(p.speciesId));
}

// メガシンカできるポケモンは、マスの右下に mega.png を付ける（未解放のメガはネタバレになるので出さない）。
function sbMegaBadgeHtml(p) {
  if (!sbMegaVisible(p)) return '';
  return '<img class="sb-mega" src="./mega.png" alt="メガ" loading="lazy" onerror="this.style.display=\'none\'">';
}

// ショップ購入制のポケモンかどうか、購入済みかどうか（Shop側の判定をそのまま使う）。
function sbIsLocked(p) {
  return !!(p && typeof Shop !== 'undefined' && !Shop.isOwned(p.speciesId));
}
// ロック中のマスに重ねる鍵アイコン（画像が無ければCSSの疑似要素（🔒）だけで見せる）。
function sbLockOverlayHtml() {
  return '<div class="sb-lock-overlay"><img class="sb-lock-icon" src="./lock.png" alt="" onerror="this.style.display=\'none\';this.parentElement.classList.add(\'no-icon\')"></div>';
}

// ボックスの中身を用意する。5行×N列に収まる数（列数は画面幅に依存するので余裕を持って生成）
// 編成画面用の個体：努力値ポイントは全て0（デフォルト。細かい設定は後で変更できるようにする）。
// 実数値は「努力値0・個体値31・Lv100」で計算し直し、バーと数字が食い違わないようにする。
function sbCreateDefaultPokemon(speciesId) {
  const p = createRandomPokemon(speciesId, SB_LEVEL);   // 技・特性はここでランダムに決まる（編成のポケモンはLv50固定）
  p.nature = SB_FIXED_NATURE;                      // 初期値は25（きまぐれ＝無補正）。トレーニング画面で変更・保存できる
  p.shiny = false;                                 // 色違いは既定で全員「通常」（createRandomPokemonの5%抽選を打ち消す）
  p.evPoints = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
  sbRecalcStats(p);
  return p;
}
function sbRecalcStats(p) {
  // 努力値ポイント：1ポイントにつき、その能力の実数値が+1（性格補正のあとに加算）。
  // 戦闘エンジン側の evs（4で割る旧方式）は使わないため、ここでは常に0にしておく。
  p.level = SB_LEVEL;
  p.evs = [0, 0, 0, 0, 0, 0];
  const base = p.species.baseStats;
  const pts = p.evPoints || {};
  SB_STAT_KEYS.forEach((k) => {
    const nm = k === 'hp' ? 1 : natureMultiplier(p.nature, k);
    const bonus = Math.max(0, Math.min(SB_EV_MAX, pts[k] || 0));
    p.stats[k] = calcStat(base[k], p.iv, 0, p.level, k === 'hp', nm) + bonus;
  });
  p.maxHp = p.stats.hp;
  p.currentHp = p.stats.hp;
}

// ボックスの個体配列を図鑑と同じ順（POKEDEX_CUSTOM_ORDER）に並べ替えた新しい配列を返す。
// 同じ種族IDが複数あっても元の順序を保つ（安定ソート）。
function sbSortBoxByDexOrder(pokes) {
  const order = sortByPokedexOrder(pokes.map((p) => p.speciesId));
  const rank = new Map();
  order.forEach((id, i) => { if (!rank.has(id)) rank.set(id, i); });
  return pokes.map((p, i) => ({ p, i }))
    .sort((a, b) => (rank.get(a.p.speciesId) - rank.get(b.p.speciesId)) || (a.i - b.i))
    .map((o) => o.p);
}

function sbBuildBox() {
  if (sbState.built) return;
  if (sbLoad()) return;   // 前回の編成があればそれを復元（ボックスの技も前回のまま）
  // 選出・図鑑と同じ「普通に選ばれるポケモン」全員（getFinalSpeciesIds：ボス専用は除外済み）。
  // メガ形態は種族データに存在しないため、メガ前の通常の姿だけが入る。
  const ids = sortByPokedexOrder(getFinalSpeciesIds());   // 図鑑と同じ並び（engine.js の POKEDEX_CUSTOM_ORDER）
  sbState.box = ids.map((id) => sbCreateDefaultPokemon(id));
  sbInitParties();
  sbState.selected = null;
  sbState.built = true;
  sbSave();   // 初回の技ランダムを確定させて保存（次回起動でも同じ技）
}

// 隠しポケモンなど、実績解除等で新たに解放された種族をボックスへ即座に追加する。
// sbBuildBox()は「まだ一度もボックスを開いていない」場合にのみ全種族を作り直すため、
// 解放が起きた時点で既にボックス構築済み（sbState.built===true）だと、
// 次に開くだけでは反映されない。そのため解放の瞬間にここで直接1匹だけ差し込む。
function sbEnsureSpeciesInBox(speciesId) {
  if (!sbState.built) return; // 未構築なら次回のsbBuildBoxで自動的に含まれる
  if (sbState.box.some((p) => p && p.speciesId === speciesId)) return; // 既にある
  sbState.box.push(sbCreateDefaultPokemon(speciesId));
  sbState.box = sbSortBoxByDexOrder(sbState.box);   // 図鑑と同じ並び
  sbSave();
}

// 本格バトル編成（ボックス・パーティー1〜20・保存データ）を丸ごと初期化する。
// 過去の壊れたデータ（保存・セットができなくなる等）が残っている時の救済用（設定のID欄「reset」から呼ばれる）。
function sbResetAll() {
  try { localStorage.removeItem(SB_STORAGE_KEY); } catch (e) { /* プライベートモード等は無視 */ }
  sbState.box = [];
  sbState.selected = null;
  sbState.built = false;
  sbInitParties();
  sbBuildBox();   // その場でボックスを種族データから作り直しておく（次に開いた時も迷わないように）
}

// 手持ちの実際の匹数（空き枠 null は数えない）
function sbPartyCount() { return sbState.party.filter(Boolean).length; }
// 手持ちの最初の空き枠の位置（全部埋まっていれば -1）。追加はここへ入れる。
function sbFirstEmptySlot() {
  const arr = sbState.party;
  for (let i = 0; i < SB_PARTY_MAX; i++) { if (!arr[i]) return i; }
  return -1;
}
// 手持ちから外す：詰めずにその枠だけ空きにする（末尾の空きは切り詰めて配列を短く保つ）
function sbRemoveFromParty(idx) {
  if (idx < 0 || idx >= sbState.party.length) return;
  sbState.party[idx] = null;
  while (sbState.party.length && !sbState.party[sbState.party.length - 1]) sbState.party.pop();
}

function sbRenderParty() {
  const el = $('sb-party');
  const slots = [];
  for (let i = 0; i < SB_PARTY_MAX; i++) {
    const p = sbState.party[i];
    if (!p) {
      slots.push(`<div class="sb-slot empty" data-empty-idx="${i}"><span class="sb-slot-no">${i + 1}</span></div>`);
    } else {
      const sel = sbState.selected === p ? ' selected' : '';
      // 名前は左上、画像は右、mega.pngは右下（小さめ）。左上の番号は並び順の目印。
      slots.push(`<div class="sb-slot${sel}" data-party-idx="${i}">
        <span class="sb-slot-idx">${i + 1}</span>
        <span class="sb-slot-name">${p.species.name}</span>
        ${sbSpriteHtml(p, 'sb-slot-img')}
        ${sbMegaBadgeHtml(p)}
      </div>`);
    }
  }
  el.innerHTML = slots.join('');
  // タップ（詳細表示）と長押し並び替えは sbSetupPartyReorder() のイベント委譲で処理する
  $('sb-count').textContent = `${sbPartyCount()}/${SB_PARTY_MAX}`;
  $('sb-party-name-text').textContent = sbState.partyName;
  $('sb-title-text').textContent = sbState.partyName;   // 今の手持ちの名前（どのチームにも属さない作業スペース）
  $('sb-btn-clear').disabled = sbPartyCount() === 0; // 空なら押せない
}

// 現在の並び方での「ボックス番号(sbState.box の添字)」の並び。
// 同じ値のときは番号(図鑑順)の小さい方を先にする＝どの並び方でも結果が毎回同じになる。
// 鍵付き（ショップ未購入）のポケモンは、どの並び方でも一番下にまとめて並べる。
// HP〜素早さは、努力値ポイントを含めた実数値（p.stats）で、値の大きい順。
//   ・「努力値なし」ON：努力値ポイントを足さない実数値（性格・個体値・レベルは反映）で並べる
//   ・「メガを考慮する」ON：解放済みのメガシンカ持ちは、メガ後の種族値で計算した実数値で並べる
//     （未解放のメガはネタバレ防止のため対象外＝メガ前の実数値のまま。X/Yがある種族は選択中のフォーム）
// タイプ順は type1 のID（TYPE_ID：bug=1 … shine=20）の小さい順。
// 【表示専用】p 自体は一切書き換えない。
function sbSortStatValue(p, key) {
  const opt = sbState.sortOpt || {};
  const noEv = !!opt.noEv;
  // 基準にする種族値：メガ考慮ONかつ解放済みメガ持ちならメガ後、それ以外は通常の種族値
  let base = p.species.baseStats[key];
  if (opt.mega && sbMegaVisible(p)) {
    const md = getMegaEvolutionDataForSpeciesId(p.speciesId, p.megaForm);
    if (md && md.baseStats && md.baseStats[key] != null) base = md.baseStats[key];
  }
  if (!noEv) {
    // 努力値あり：通常は p.stats そのまま（計算結果と表示が必ず一致する）。メガ考慮時だけ計算し直す。
    if (base === p.species.baseStats[key]) return (p.stats && p.stats[key]) || 0;
    const pts = p.evPoints || {};
    const nm = key === 'hp' ? 1 : natureMultiplier(p.nature, key);
    const bonus = Math.max(0, Math.min(SB_EV_MAX, pts[key] || 0));
    return calcStat(base, p.iv, 0, p.level, key === 'hp', nm) + bonus;
  }
  // 努力値なし：ポイントを足さない実数値
  const nm = key === 'hp' ? 1 : natureMultiplier(p.nature, key);
  return calcStat(base, p.iv, 0, p.level, key === 'hp', nm);
}
function sbBoxOrder() {
  const box = sbState.box;
  const order = box.map((_, i) => i);
  const key = sbState.sortKey;
  let sorted;
  if (key === 'no') {
    sorted = order;   // 番号順（sbState.box そのものの並び）
  } else {
    const val = (i) => {
      const p = box[i];
      if (key === 'type') {
        const id = TYPE_ID[p.species.type1];
        return id === undefined ? 999 : id;
      }
      return sbSortStatValue(p, key);
    };
    sorted = order.sort((a, b) => {
      const va = val(a), vb = val(b);
      if (va !== vb) return key === 'type' ? va - vb : vb - va;   // タイプ=小さい順／能力=大きい順
      return a - b;
    });
  }
  // 鍵付き（ショップ未購入）は、どの並び方でも一番下へまとめる。
  // ロック同士は、選んだ並び方（番号順なら図鑑順）のまま下に並ぶ。購入すると本来の位置へ戻る。
  const unlocked = [], locked = [];
  sorted.forEach((i) => { (sbIsLocked(box[i]) ? locked : unlocked).push(i); });
  return unlocked.concat(locked);
}

function sbRenderBox() {
  const grid = $('sb-box-grid');
  // マスの生成は最初の1回だけ（300匹を毎タップ作り直さない）
  if (grid.dataset.built !== String(sbState.box.length)) {
    grid.innerHTML = sbState.box.map((p, i) =>
      `<div class="sb-cell${sbIsLocked(p) ? ' locked' : ''}" data-box-idx="${i}">${sbSpriteHtml(p, 'sb-cell-img', true)}${sbMegaBadgeHtml(p)}${sbLockOverlayHtml()}</div>`
    ).join('');
    grid.dataset.built = String(sbState.box.length);
  }
  // 並び方に合わせて、マスの表示順だけを入れ替える（マスは作り直さない）。
  // 並びが前回と同じなら何もしない（努力値を変えた直後などは stats が変わるので、並びの署名で判定する）。
  {
    const order = sbBoxOrder();
    const sig = sbState.sortKey + ':' + (sbState.sortOpt.noEv ? 1 : 0) + (sbState.sortOpt.mega ? 1 : 0) + ':' + order.join(',');
    if (grid.dataset.orderSig !== sig) {
      const byIdx = new Map();
      Array.from(grid.children).forEach((c) => byIdx.set(parseInt(c.dataset.boxIdx, 10), c));
      const frag = document.createDocumentFragment();
      order.forEach((i) => { const c = byIdx.get(i); if (c) frag.appendChild(c); });
      grid.appendChild(frag);
      grid.dataset.orderSig = sig;
      if (grid.dataset.orderSigPrev !== undefined) grid.scrollTop = 0;   // 並び替えたら先頭へ戻す
      grid.dataset.orderSigPrev = '1';
    }
  }
  // 選択中の枠・パーティ入りの✔だけを更新する（マスは data-box-idx で個体を引く。DOM順ではなく番号で対応）
  const cells = grid.children;
  for (let ci = 0; ci < cells.length; ci++) {
    const i = parseInt(cells[ci].dataset.boxIdx, 10);
    const p = sbState.box[i];
    cells[ci].classList.toggle('selected', sbState.selected === p);
    cells[ci].classList.toggle('in-party', sbState.party.includes(p));
    cells[ci].classList.toggle('locked', sbIsLocked(p));
    // 色違いが切り替わったマスだけ画像を差し替える（300匹ぶんを作り直さない）。
    // 画像パスはマスに覚えさせておき、現在の姿と違うときだけ更新する。
    const want = spritePath(p);
    if (cells[ci].dataset.sprite !== want) {
      const img = cells[ci].querySelector('img.sb-cell-img, span.sb-cell-img');
      if (img) {
        if (cells[ci].dataset.sprite !== undefined) {   // 初回生成時は作成済みなので何もしない
          const tmp = document.createElement('div');
          tmp.innerHTML = sbSpriteHtml(p, 'sb-cell-img', true);
          img.replaceWith(tmp.firstElementChild);
        }
      }
      cells[ci].dataset.sprite = want;
    }
  }
  // 「300匹」の表示は廃止。ヘッダーには並び替えセレクトを出す。
  const sel = $('sb-sort-select');
  if (sel && sel.value !== sbState.sortKey) sel.value = sbState.sortKey;
  sbRenderSortOpts();
}
// 並び替えオプション（努力値なし／メガを考慮する）のチェック状態を反映する。
// 番号順・タイプ順では意味がないので、そのときは薄くして押せなくする（チェックの状態自体は保持する）。
function sbRenderSortOpts() {
  const isStat = SB_STAT_KEYS.includes(sbState.sortKey);
  [['sb-sort-noev', 'noEv'], ['sb-sort-mega', 'mega']].forEach(([id, k]) => {
    const cb = $(id);
    if (!cb) return;
    cb.checked = !!sbState.sortOpt[k];
    cb.disabled = !isStat;
    const lb = cb.closest('label');
    if (lb) lb.classList.toggle('disabled', !isStat);
  });
}
// ショップで購入した直後など、ボックスを開き直さなくてもロック表示だけ即座に更新するための関数。
function sbRefreshLockState() {
  const grid = $('sb-box-grid');
  if (!grid || grid.dataset.built === undefined) return; // まだボックス自体が描画されていない
  const cells = grid.children;
  for (let ci = 0; ci < cells.length; ci++) {
    const i = parseInt(cells[ci].dataset.boxIdx, 10);
    const p = sbState.box[i];
    cells[ci].classList.toggle('locked', sbIsLocked(p));
  }
  // 購入でロックが外れたら、鍵付きは一番下という並びも即座に反映する
  // （並びが同じなら sbRenderBox 側で何もしない。スクロール位置は並びが変わった時だけ先頭へ戻る）
  sbRenderBox();
}

// 並び替えセレクト：選択肢を作り、変更されたら並び方を保存して再描画する
(function sbSetupSortSelect() {
  const sel = $('sb-sort-select');
  if (!sel) return;
  sel.innerHTML = SB_SORT_OPTIONS.map(([k, label]) => `<option value="${k}">${label}</option>`).join('');
  sel.value = sbState.sortKey;
  sel.addEventListener('change', () => {
    const k = sel.value;
    if (!SB_SORT_OPTIONS.some(([key]) => key === k)) return;
    sbState.sortKey = k;
    sbSaveSortKey(k);
    sbRenderBox();
  });
  // チェックボックス：努力値なし／メガを考慮する（変えたら保存して並べ直す）
  [['sb-sort-noev', 'noEv'], ['sb-sort-mega', 'mega']].forEach(([id, k]) => {
    const cb = $(id);
    if (!cb) return;
    cb.addEventListener('change', () => {
      sbState.sortOpt[k] = cb.checked;
      sbSaveSortOpt(sbState.sortOpt);
      sbRenderBox();
    });
  });
  sbRenderSortOpts();
})();

// タップはグリッドに1つだけ付ける（イベント委譲）
$('sb-box-grid').addEventListener('click', (e) => {
  const cell = e.target.closest('[data-box-idx]');
  if (!cell) return;
  const p = sbState.box[parseInt(cell.dataset.boxIdx, 10)];
  if (sbIsLocked(p)) return; // 未購入：触れても何も起きない
  sbOnBoxTap(p);
});

// ボックスをタップ：
// ・未選択の個体を1回目にタップ → 選択（詳細表示）のみ。パーティにはまだ入れない。
// ・選択済み（＝直前にタップ済み）の個体をもう一度タップ → パーティに追加。
// ・パーティ内の個体を（選択済みの状態で）タップ → パーティから外す。
function sbOnBoxTap(p) {
  const idx = sbState.party.indexOf(p);
  if (idx >= 0) {
    if (sbState.selected === p) sbRemoveFromParty(idx); // 選択中をもう一度タップで外す（枠は詰めない）
    sbState.selected = p;
  } else if (sbState.selected === p) {
    // 2回目のタップ：パーティに追加
    const empty = sbFirstEmptySlot();   // 空いている最初の枠へ入れる（途中に空きがあればそこ）
    if (empty >= 0) {
      while (sbState.party.length < empty) sbState.party.push(null);   // 穴あき配列にならないよう null で埋める
      sbState.party[empty] = p;
    }
  } else {
    // 1回目のタップ：選択（詳細表示）だけ行い、パーティにはまだ入れない
    sbState.selected = p;
  }
  sbSave();
  sbRenderAll();
}

/* ---------------------------------------------------------
   パーティ枠：長押しで持ち上げて並び替え（ソシャゲでよくある操作）
   ・タップ            → 詳細表示（従来どおり）
   ・約 SB_LP_MS 長押し → 枠が浮き上がる（振動つき）→ 指に追従 → 離した位置に確定
   ・長押し成立前に SB_LP_CANCEL_PX 以上動いたらキャンセル（誤爆防止）
   ・ドラッグ中、他の枠は transform で滑らかに詰める（配列はドロップ時に一度だけ更新）
   --------------------------------------------------------- */
const SB_LP_MS = 380;          // 長押し成立までの時間
const SB_LP_CANCEL_PX = 8;     // 長押し前にこれ以上動いたら中止（タップ/スクロール扱い）
const sbDrag = {
  timer: null,
  pointerId: null,
  fromIdx: -1,        // 持ち上げた枠の元の位置
  overIdx: -1,        // 現在の挿入先
  startX: 0, startY: 0,
  offsetY: 0,         // 枠の中でつかんだ位置（枠上端からのY）
  slotH: 0,           // 1枠ぶんの高さ（gap込み）
  baseTops: [],       // 各枠の元のtop（.sb-party基準）
  active: false,      // 持ち上げ中か
  el: null,           // 持ち上げ中の枠要素
  justDragged: false, // ドラッグ直後のclick抑止
};

function sbDragReset() {
  clearTimeout(sbDrag.timer);
  sbDrag.timer = null;
  sbDrag.pointerId = null;
  sbDrag.active = false;
  sbDrag.el = null;
  sbDrag.fromIdx = -1;
  sbDrag.overIdx = -1;
  const box = $('sb-party');
  box.classList.remove('reordering');
  box.querySelectorAll('.sb-slot').forEach((n) => {
    n.classList.remove('lp-arming', 'lifting');
    n.style.transform = '';
    n.style.transition = '';
    n.style.zIndex = '';
  });
}

// 持ち上げ開始
function sbDragLift(slotEl, clientY) {
  const box = $('sb-party');
  const slots = Array.from(box.querySelectorAll('.sb-slot'));
  const boxRect = box.getBoundingClientRect();
  sbDrag.baseTops = slots.map((n) => n.getBoundingClientRect().top - boxRect.top);
  const r = slotEl.getBoundingClientRect();
  sbDrag.offsetY = clientY - r.top;
  // 1枠ぶんの移動量（枠の高さ＋gap）。次の枠のtop差から求める
  sbDrag.slotH = slots.length > 1 ? (sbDrag.baseTops[1] - sbDrag.baseTops[0]) : r.height;
  sbDrag.active = true;
  sbDrag.overIdx = sbDrag.fromIdx;
  slotEl.classList.remove('lp-arming');
  slotEl.classList.add('lifting');
  box.classList.add('reordering');
  // 触覚フィードバック（対応端末のみ）
  try { if (navigator.vibrate) navigator.vibrate(18); } catch (e) {}
}

// ドラッグ中の見た目更新：持ち上げ枠を指に追従、落とし先の枠と入れ替わる（他の枠は詰めない）
function sbDragMove(clientY) {
  const box = $('sb-party');
  const boxRect = box.getBoundingClientRect();
  const filled = SB_PARTY_MAX;                        // 空き枠にも置ける（詰めない仕様なので6枠すべてが対象）
  const slots = Array.from(box.querySelectorAll('.sb-slot'));
  const lift = sbDrag.el;
  if (!lift) return;

  // 持ち上げ枠：元の位置からの差分で指に追従（範囲は6枠の中に制限）
  const wantTop = clientY - boxRect.top - sbDrag.offsetY;
  const minTop = sbDrag.baseTops[0];
  const maxTop = sbDrag.baseTops[Math.max(0, filled - 1)];
  const clampedTop = Math.max(minTop, Math.min(maxTop, wantTop));
  const dy = clampedTop - sbDrag.baseTops[sbDrag.fromIdx];
  lift.style.transform = `translateY(${dy}px) scale(1.05)`;

  // 挿入先：持ち上げ枠の中心が、どの枠の帯に入っているか
  const centerY = clampedTop + (slots[sbDrag.fromIdx].offsetHeight / 2);
  let over = Math.round((clampedTop - minTop) / sbDrag.slotH);
  over = Math.max(0, Math.min(filled - 1, over));
  sbDrag.overIdx = over;

  // 他の枠：詰めない（入れ替え）仕様なので、落とし先の枠だけが持ち上げ枠の元の位置へ移る
  const from = sbDrag.fromIdx;
  slots.forEach((n, i) => {
    if (i === from || i >= filled) return;
    let shift = 0;
    if (i === over && over !== from) shift = sbDrag.baseTops[from] - sbDrag.baseTops[i];   // 入れ替わる相手（空き枠でも同じ）
    n.style.transform = shift ? `translateY(${shift}px)` : '';
  });
}

// 離した：配列を確定して再描画
function sbDragDrop() {
  const from = sbDrag.fromIdx;
  const to = sbDrag.overIdx;
  const lift = sbDrag.el;
  const box = $('sb-party');
  if (lift && from >= 0 && to >= 0 && from !== to) {
    // 指を離した瞬間、持ち上げ枠を「空いた位置」へスッと収める（アニメ）
    const targetDy = sbDrag.baseTops[to] - sbDrag.baseTops[from];
    lift.style.transition = 'transform .16s cubic-bezier(.2,.8,.3,1), box-shadow .16s ease';
    lift.style.transform = `translateY(${targetDy}px) scale(1)`;
    // 詰めない仕様：ドロップ先と「入れ替え」る（空き枠に落とせばそこへ移動＝元の枠が空きになる）
    while (sbState.party.length < SB_PARTY_MAX) sbState.party.push(null);
    const moved = sbState.party[from];
    sbState.party[from] = sbState.party[to] || null;
    sbState.party[to] = moved;
    while (sbState.party.length && !sbState.party[sbState.party.length - 1]) sbState.party.pop();
    sbDrag.justDragged = true;
    setTimeout(() => { sbDrag.justDragged = false; }, 250);
    sbSave();   // 並び替えを確定した時点で保存
    setTimeout(() => { sbDragReset(); sbRenderAll(); }, 170);
  } else {
    // 位置は変わらず：元の場所に戻す
    if (lift) {
      lift.style.transition = 'transform .16s cubic-bezier(.2,.8,.3,1), box-shadow .16s ease';
      lift.style.transform = '';
    }
    sbDrag.justDragged = sbDrag.active;
    setTimeout(() => { sbDrag.justDragged = false; }, 250);
    setTimeout(() => { sbDragReset(); }, 170);
  }
  box.classList.remove('reordering');
}

function sbSetupPartyReorder() {
  const box = $('sb-party');

  box.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const slotEl = e.target.closest('.sb-slot[data-party-idx]');
    if (!slotEl) return;                    // 空き枠は対象外
    if (sbDrag.pointerId !== null) return;  // 多重タッチ防止
    sbDrag.pointerId = e.pointerId;
    sbDrag.fromIdx = parseInt(slotEl.dataset.partyIdx, 10);
    sbDrag.el = slotEl;
    sbDrag.startX = e.clientX;
    sbDrag.startY = e.clientY;
    sbDrag.active = false;
    slotEl.classList.add('lp-arming');      // 「沈み込み」で長押し成立を予告
    clearTimeout(sbDrag.timer);
    sbDrag.timer = setTimeout(() => {
      if (sbDrag.pointerId === null || !sbDrag.el) return;
      try { box.setPointerCapture(sbDrag.pointerId); } catch (err) {}
      sbDragLift(sbDrag.el, sbDrag.startY);
    }, SB_LP_MS);
  });

  box.addEventListener('pointermove', (e) => {
    if (e.pointerId !== sbDrag.pointerId) return;
    if (!sbDrag.active) {
      // 長押し成立前に動いた＝タップ／スクロール意図なので中止
      if (Math.hypot(e.clientX - sbDrag.startX, e.clientY - sbDrag.startY) > SB_LP_CANCEL_PX) {
        sbDragReset();
      }
      return;
    }
    e.preventDefault();
    sbDragMove(e.clientY);
  });

  const end = (e) => {
    if (e.pointerId !== sbDrag.pointerId) return;
    try { box.releasePointerCapture(e.pointerId); } catch (err) {}
    if (sbDrag.active) {
      sbDragDrop();
    } else {
      sbDragReset();   // 長押し前に離した＝通常タップ（clickは別ハンドラ）
    }
  };
  box.addEventListener('pointerup', end);
  box.addEventListener('pointercancel', (e) => {
    if (e.pointerId !== sbDrag.pointerId) return;
    sbDragReset();
  });

  // 長押しでコンテキストメニュー（画像保存など）が出るのを防ぐ
  box.addEventListener('contextmenu', (e) => e.preventDefault());

  // タップ：1回タップ＝詳細表示／同じ枠を素早く2回タップ＝手持ちから外す（ドラッグ直後のclickは無視）
  // 外しても枠は詰めない（2を外したら2が空白のまま）。
  // ※ 時間で判定する。ボックスから追加した直後は「選択中」になっているため、選択状態だけで判定すると
  //    1回タップで外れてしまう。
  const SB_DBL_TAP_MS = 350;
  let lastTapIdx = -1, lastTapAt = 0;
  box.addEventListener('click', (e) => {
    if (sbDrag.justDragged) { e.preventDefault(); return; }
    const slotEl = e.target.closest('.sb-slot[data-party-idx]');
    if (!slotEl) return;
    const idx = parseInt(slotEl.dataset.partyIdx, 10);
    const p = sbState.party[idx];
    if (!p) return;
    const now = Date.now();
    if (idx === lastTapIdx && now - lastTapAt <= SB_DBL_TAP_MS) {
      // 2回目のタップ → 外す（この枠だけ空きにする）
      lastTapIdx = -1; lastTapAt = 0;
      sbRemoveFromParty(idx);
      if (sbState.selected === p) sbState.selected = null;
      sbSave();
    } else {
      lastTapIdx = idx; lastTapAt = now;
      sbState.selected = p;
    }
    sbRenderAll();
  });
}
sbSetupPartyReorder();

const SB_STAT_ROWS = [
  ['HP', 'hp'], ['こうげき', 'atk'], ['ぼうぎょ', 'def'],
  ['とくこう', 'spa'], ['とくぼう', 'spd'], ['すばやさ', 'spe'],
];
function sbRenderDetail() {
  const el = $('sb-detail');
  const p = sbState.selected;
  if (!p) {
    el.innerHTML = '<div class="sb-detail-empty">ボックスの ポケモンを<br>タップしてください</div>';
    return;
  }
  const sp = p.species;
  // メガビューON かつ このポケモンがメガシンカ可能なら、タイプ・特性・実数値をメガ後基準で表示する
  // （表示専用：p自体・種族データ・画像は一切書き換えない）
  const megaPreview = (sbState.megaView && sbMegaVisible(p))
    ? getMegaPreviewStatsForBoxPokemon(p, p.megaForm)
    : null;
  const viewType1 = megaPreview ? megaPreview.type1 : sp.type1;
  const viewType2 = megaPreview ? megaPreview.type2 : sp.type2;
  const viewAbility = megaPreview ? megaPreview.ability : p.ability;
  const types = [viewType1, viewType2].filter(Boolean).map((t) => typeChipHtml(t)).join('');
  // ステータス行：ラベル｜実数値｜努力値ポイントのバー（最大 SB_EV_MAX）｜努力値ポイント
  const stats = SB_STAT_ROWS.map(([label, key]) => {
    const v = megaPreview ? megaPreview.stats[key] : p.stats[key];
    const ev = Math.max(0, Math.min(SB_EV_MAX, (p.evPoints && p.evPoints[key]) || 0));
    const pct = (ev / SB_EV_MAX) * 100;
    // 性格補正：上がる=赤(nat-up)／下がる=青(nat-down)。HPは性格の影響を受けない。
    const nm = key === 'hp' ? 1 : natureMultiplier(p.nature, key);
    const natCls = nm > 1 ? ' nat-up' : (nm < 1 ? ' nat-down' : '');
    // 左にステータスアイコン（トレーニング画面と共通のSVG）。ラベルとアイコンを .k の中にまとめる
    const ico = (typeof TR_STAT_ICON !== 'undefined' && TR_STAT_ICON[key]) ? `<span class="sico">${TR_STAT_ICON[key]}</span>` : '';
    return `<div class="sb-stat${natCls}"><span class="k">${ico}<span class="kt">${label}</span></span><span class="v">${v}</span><span class="bar"><i style="width:${pct}%"></i></span><span class="ev">${ev}</span></div>`;
  }).join('');
  const moves = p.moves.slice(0, 4).map((m) => `
    <div class="sb-move">
      ${typeIconHtml(m.type).replace('move-row-type-icon', 'mi')}
      <span class="mn">${m.name}</span>
      <span class="pp">PP ${m.maxPp}</span>
    </div>`).join('');
  // X/Y両方のメガシンカを持つポケモンは、選んである方を名前の頭に小さく添える（対戦中の表記と同じ「Xリザードン」形式）
  // メガビュー表示中は必ずX/Yのどちらかを見ているので、複数フォームがあれば常に表示する。
  // Y=赤背景／X=青背景（トレーニング画面のX/Y切替ボタンと同じ色分け）
  const megaFormPrefix = sbMegaVisible(p) && hasMultiMegaForms(p) && (megaPreview || p.megaForm)
    ? `<span class="sb-d-megaform ${p.megaForm === 'Y' ? 'y' : 'x'}">${p.megaForm === 'Y' ? 'Y' : 'X'}</span>` : '';
  // 色違いボタン：図鑑に色違いが登録済みの種族にだけ表示。押すと 通常⇔色違い を切り替える
  const canShiny = Pokedex.hasShiny(p.speciesId);
  const shinyBtn = canShiny
    ? `<button id="sb-btn-shiny" class="sb-shiny-btn${p.shiny ? ' active' : ''}" type="button" aria-label="色違い切替" aria-pressed="${p.shiny ? 'true' : 'false'}">✨</button>`
    : '';
  el.innerHTML = `
    <div class="sb-d-head">
      ${sbSpriteHtml(p, 'sb-d-img')}
      <div class="sb-d-headtext">
        <div class="sb-d-name">${megaFormPrefix}${sp.name}</div>
        <div class="sb-d-types">${types}</div>
      </div>
      ${shinyBtn}
    </div>
    <div class="sb-d-ability"><span class="lb">特性</span><span>${abilityJp(viewAbility)}</span></div>
    <div class="sb-stats">${stats}</div>
    <div class="sb-moves">${moves}</div>
    <div class="sb-d-actions">
      <button id="sb-btn-preset" class="sb-train-btn sb-preset-btn" type="button">保存/ロード</button>
      <button id="sb-btn-train" class="sb-train-btn" type="button">トレーニング</button>
    </div>
  `;
  $('sb-btn-preset').addEventListener('click', openPresetModal);
  $('sb-btn-train').addEventListener('click', openTraining);
  const sb = $('sb-btn-shiny');
  if (sb) {
    sb.addEventListener('click', () => {
      p.shiny = !p.shiny;
      sbSave();          // 色違いの選択は保存される
      sbRenderAll();     // 詳細・パーティ枠・ボックスの画像を一斉に切り替える
    });
  }
}

function sbRenderAll() {
  sbRenderParty();
  sbRenderBox();
  sbRenderDetail();
  sbRenderMegaViewBtn();
}

// 手持ちの右のメガビューボタン：ON/OFF状態を見た目に反映する（表示専用の切替であり、
// このボタン自体はどのポケモンにも常に押せる＝全員分まとめてメガ後表示に切り替える）。
function sbRenderMegaViewBtn() {
  const btn = $('sb-btn-megaview');
  if (!btn) return;
  btn.classList.toggle('active', !!sbState.megaView);
  btn.setAttribute('aria-pressed', sbState.megaView ? 'true' : 'false');
}

function openSeriousBuilder() {
  sbBuildBox();
  showScreen('serious');
  sbRenderAll();
}

$('btn-title-serious').addEventListener('click', openSeriousBuilder);
$('sb-btn-back').addEventListener('click', () => showScreen('title'));
$('sb-btn-megaview').addEventListener('click', () => {
  sbState.megaView = !sbState.megaView;
  sbRenderMegaViewBtn();
  sbRenderDetail();   // 実数値の表示だけ切り替える（並び替え・画像・図鑑データには影響しない）
});
$('sb-btn-clear').addEventListener('click', async () => {
  if (sbPartyCount() === 0) return;
  const ok = await askConfirm('パーティのポケモンを ぜんぶ はずしますか？');
  if (!ok) return;
  sbState.party = [];
  sbState.selected = null;
  sbSave();
  sbRenderAll();
});

/* ---------------------------------------------------------
   パーティ一覧（パーティ1〜20）。上の「パーティー〇」をタップで開く。
   ・縦長のカラムを横に並べ、各カラムに6匹ぶんの名前＋絵＋アイテム欄を出す
   ・カラムをタップ → そのパーティを開いて編成画面へ戻る（番号は保存される）
   ・アイテム欄：メガシンカできるポケモンは mega.png を小さく表示
   --------------------------------------------------------- */
function sbPartyColHtml(pt, i) {
  const rows = [];
  const members = Array.isArray(pt.snapshot) ? pt.snapshot : [];
  for (let k = 0; k < SB_PARTY_MAX; k++) {
    const p = members[k];
    if (!p) { rows.push('<div class="ps-row empty"></div>'); continue; }
    const item = sbMegaVisible(p)
      ? '<img class="ps-item" src="./mega.png" alt="メガ" loading="lazy" onerror="this.style.display=\'none\'">'
      : '';
    rows.push(`<div class="ps-row"><span class="ps-name">${p.species.name}</span>${item}<span class="ps-img-wrap">${sbSpriteHtml(p, 'ps-img', true)}</span></div>`);
  }
  const cur = i === sbState.current ? ' current' : '';
  return `<div class="ps-col${cur}" data-ps-idx="${i}">
    <div class="ps-col-head">${pt.name}</div>
    <div class="ps-col-list">${rows.join('')}</div>
  </div>`;
}

function sbRenderPartySelect() {
  $('ps-scroller').innerHTML = sbState.parties.map(sbPartyColHtml).join('');
}

function sbOpenPartySelect() {
  sbRenderPartySelect();
  showScreen('partysel');
  // 今のパーティが見える位置までスクロール（20個あるので中央寄せ）
  const cur = $('ps-scroller').querySelector('.ps-col.current');
  if (cur) cur.scrollIntoView({ inline: 'center', block: 'nearest' });
}

$('sb-topbar-title').addEventListener('click', sbOpenPartySelect);
$('ps-btn-back').addEventListener('click', () => { showScreen('serious'); sbRenderAll(); });
$('ps-scroller').addEventListener('click', (e) => {
  const col = e.target.closest('[data-ps-idx]');
  if (!col) return;
  const i = parseInt(col.dataset.psIdx, 10);
  if (!(i >= 0 && i < SB_PARTY_COUNT)) return;
  sbOpenPartyActionSheet(i);
});

/* ---------------------------------------------------------
   パーティ一覧でチーム番号をタップした時の「セット/保存」選択シート
   ・セット：タップしたチームに保存済みの技・努力値などを、今の手持ち（左のパーティ欄）へ読み込む
   ・保存　：今の手持ち（メンバー構成＋技・努力値・特性・性格・色違い）を、タップしたチーム番号へ丸ごと上書き保存
   ・どちらも実行前に askConfirm で二重確認する
   --------------------------------------------------------- */
let psActionTargetIdx = null;

function sbOpenPartyActionSheet(i) {
  psActionTargetIdx = i;
  const pt = sbState.parties[i];
  const hasSnapshot = Array.isArray(pt.snapshot) && pt.snapshot.length > 0;
  $('ps-action-title').textContent = pt.name;
  $('ps-action-sub').textContent = hasSnapshot ? `保存済み：${pt.snapshot.length}匹` : '未保存';
  const setBtn = $('ps-action-set');
  setBtn.disabled = !hasSnapshot;
  setBtn.textContent = hasSnapshot ? 'セット' : 'セット（データなし）';
  $('ps-action-overlay').classList.add('show');
}
function sbClosePartyActionSheet() {
  $('ps-action-overlay').classList.remove('show');
  psActionTargetIdx = null;
}
$('ps-action-cancel').addEventListener('click', sbClosePartyActionSheet);

/* =========================================================
   NPCとバトル：モード選択（ランダム / チーム）
   ・ランダム：既存の startNewRun()（→ メガあり／メガなし選択 → 選出）へ
   ・チーム　：本格バトルで作った「チーム1〜20」を一覧表示し、使うチームを選ぶ
              （※いまはUIのみ。チームをタップしても何も起きない）
   ・どちらの画面からも「もどる」で戻れる
   ========================================================= */
function openNpcModeSelect() {
  showScreen('npc-mode');
}

// チーム選択画面：本格バトルのパーティ一覧と同じ見た目（sbPartyColHtml を再利用）。
// ここでは「現在のセット中」の目印（current）は不要なので、描画後に外す。
function npcTeamRender() {
  const el = $('npc-team-scroller');
  el.innerHTML = sbState.parties.map(sbPartyColHtml).join('');
  el.querySelectorAll('.ps-col.current').forEach((c) => c.classList.remove('current'));
}

function openNpcTeamSelect() {
  // sbState.parties は本格バトル画面を開くまで復元されないため、必ずここで用意する
  // （初回起動でも、保存済みのチーム1〜20が空欄なしで正しく表示されるように）
  sbBuildBox();
  npcTeamRender();
  showScreen('npc-team');
  $('npc-team-scroller').scrollLeft = 0;   // 常にチーム1から見せる
}

$('btn-npc-mode-random').addEventListener('click', () => {
  const initial = debugPendingBossSkipWinStreak;
  debugPendingBossSkipWinStreak = 0;
  startNewRun(initial);
});
$('btn-npc-mode-team').addEventListener('click', openNpcTeamSelect);
$('btn-npc-mode-back').addEventListener('click', () => {
  debugPendingBossSkipWinStreak = 0; // モード選択を離れる＝デバッグ指定は破棄
  showScreen('title');
});
$('npc-team-btn-back').addEventListener('click', () => showScreen('npc-mode'));
$('npc-team-scroller').addEventListener('click', async (e) => {
  const col = e.target.closest('[data-ps-idx]');
  if (!col) return;
  const i = parseInt(col.dataset.psIdx, 10);
  if (!(i >= 0 && i < SB_PARTY_COUNT)) return;
  const pt = sbState.parties[i];
  const members = Array.isArray(pt.snapshot) ? pt.snapshot : [];
  // 選出は「6匹の中から3匹」なので、6匹そろっていないパーティーは使えない
  if (members.length < 6) {
    npcTeamToast(members.length === 0 ? `${pt.name}は 保存されていません` : `${pt.name}は ${members.length}匹しかいません（6匹必要です）`);
    return;
  }
  const ok = await askConfirm(`${pt.name}を つかいますか？`);
  if (!ok) return;
  const initial = debugPendingBossSkipWinStreak;
  debugPendingBossSkipWinStreak = 0;
  startNpcTeamRun(i, initial);
});

// 6匹そろっていないパーティーを押した時の小さな通知（既存の pokedex-toast の見た目を流用）
let npcTeamToastTimer = null;
function npcTeamToast(text) {
  let el = $('npc-team-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'npc-team-toast';
    el.className = 'pokedex-toast';
    document.getElementById('app').appendChild(el);
  }
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(npcTeamToastTimer);
  npcTeamToastTimer = setTimeout(() => el.classList.remove('show'), 1800);
}

/* =========================================================
   NPCとバトル（チーム）：選出画面（ソード・シールド風）
   ・パーティー（6匹）を選ぶ → 二重確認 → この画面で「1番目〜3番目」をタップ順に決める
   ・3匹決めたら、一番下に「けってい」が出る → バトル開始（並び替え画面は挟まない）
   ・バトルに勝ったら、相手からポケモンをもらう画面は飛ばして、この画面にもどる
     （そのときは、いま決めている順番のまま。変えたければタップで外して選び直せる）
   ・メガあり／なしの選択は挟まない：チーム戦は常に「メガあり」で戦う
   ========================================================= */
const NPC_PICK_COUNT = 3;
// showScreen('title') は起動直後（この宣言より前）にも呼ばれうる。const だと宣言前の参照が
// ReferenceError（typeofでも防げない）になるため、宣言が巻き上げられて宣言前は undefined になる var にしている。
function npcTeamEndRun() {
  if (!npcTeamState) return;   // 宣言前＝まだ何も始まっていない
  npcTeamState.active = false;
  npcTeamState.picks = [];
}
var npcTeamState = {
  active: false,     // いまチーム戦のランの最中か（勝利後の分岐・画面更新の判定に使う）
  partyIdx: -1,
  source: [],        // 選んだパーティーの6匹（バトル用に復元した個体）
  picks: [],         // 選んだ順の source の添字（最大3）。バトルをまたいで維持する
};

function startNpcTeamRun(partyIdx, initialWinStreak) {
  MenuBgm.start();
  const pt = sbState.parties[partyIdx];
  // 保存データから、バトルで使える完全な個体へ復元する（実数値・努力値・性格・技・特性・色違い）
  npcTeamState.source = pt.snapshot.slice(0, 6).map((d) => sbRestorePoke(sbSerializePoke(d))).filter(Boolean);
  if (npcTeamState.source.length < 6) { npcTeamToast('このパーティーは つかえません'); return; }
  npcTeamState.partyIdx = partyIdx;
  npcTeamState.picks = [];
  npcTeamState.active = true;

  state.multiplayer = false;
  state.megaEvolutionEnabled = true;      // チーム戦は常にメガあり（mega.pngの表示・メガボタンもこれに連動）
  debugMegaTestPending = false;
  debugIntrusionTestPending = false;
  setMegaLockActive(true);
  state.winStreak = initialWinStreak || 0;
  resetIntrusionRun();
  openNpcPick();
}

function npcPickSpriteHtml(p) {
  const id = p.speciesId;
  return `<img class="np-sprite" src="${spritePath(p)}" alt="" onerror="this.outerHTML='<span class=&quot;np-sprite-fb&quot;>#${id}</span>'">`;
}

// ♂♀の位置：メガシンカできるポケモンだけ mega.png（名前の文字サイズに合わせる）
function npcPickMegaHtml(p) {
  if (!canMegaEvolve(p)) return '';
  return '<img class="np-mega" src="./mega.png" alt="メガ" onerror="this.style.display=\'none\'">';
}

function npcPickCardHtml(p, idx) {
  const order = npcTeamState.picks.indexOf(idx);
  const picked = order >= 0;
  return `<div class="np-card${picked ? ' picked' : ''}" data-np-idx="${idx}" role="button">
    ${npcPickSpriteHtml(p)}
    <div class="np-info">
      <div class="np-name-row"><span class="np-name">${p.species.name}</span>${npcPickMegaHtml(p)}</div>
      <div class="np-hp-line"></div>
      <div class="np-hp-row"><span class="np-hp">${p.maxHp}/${p.maxHp}</span></div>
    </div>
    ${picked ? `<span class="np-order">${order + 1}番目</span>` : ''}
    <button class="np-info-btn" data-np-info="${idx}" type="button" aria-label="くわしく見る"><span>!</span></button>
  </div>`;
}

function npcPickRender() {
  $('np-list').innerHTML = npcTeamState.source.map(npcPickCardHtml).join('');
  const n = npcTeamState.picks.length;
  $('np-count').textContent = `${n} / ${NPC_PICK_COUNT}`;
  $('np-btn-ok').classList.toggle('show', n === NPC_PICK_COUNT);
}

function openNpcPick() {
  npcPickRender();
  showScreen('npc-pick');
}

$('np-list').addEventListener('click', (e) => {
  const info = e.target.closest('[data-np-info]');
  if (info) {
    const idx = parseInt(info.dataset.npInfo, 10);
    if (npcTeamState.source[idx]) showTradeDetail(npcTeamState.source[idx]);
    return;
  }
  const card = e.target.closest('[data-np-idx]');
  if (!card) return;
  const idx = parseInt(card.dataset.npIdx, 10);
  const at = npcTeamState.picks.indexOf(idx);
  if (at >= 0) {
    npcTeamState.picks.splice(at, 1);           // もう一度タップで外す（後ろの番号は繰り上がる）
  } else if (npcTeamState.picks.length < NPC_PICK_COUNT) {
    npcTeamState.picks.push(idx);               // タップした順が 1番目・2番目・3番目
  }
  npcPickRender();
});

$('np-btn-ok').addEventListener('click', () => {
  if (npcTeamState.picks.length !== NPC_PICK_COUNT) return;
  // 選んだ順に並べて手持ちにする（並び替え画面は挟まず、そのままバトルへ）
  state.playerTeam = npcTeamState.picks.map((i) => npcTeamState.source[i]);
  startNextCpuBattle();
});

// セット：チーム番号 i の保存データを、今の手持ち（左のパーティ欄＝現在開いているパーティ）に読み込む。
// ボックスは種族ごとに1体しかないため、読み込んだ技・努力値等は「ボックス内の同種族の個体」に反映される。
async function sbApplySnapshotToCurrent(i) {
  const pt = sbState.parties[i];
  if (!Array.isArray(pt.snapshot) || !pt.snapshot.length) return;
  sbClosePartyActionSheet();   // 確認ダイアログが裏に隠れないよう、先にシートを閉じる
  const ok = await askConfirm(`「${pt.name}」をセットしますか？`);
  if (!ok) return;
  const newMembers = [];
  pt.snapshot.forEach((snapPoke) => {
    // ボックス内の同種族の個体を探し、保存されていた技・努力値・特性・性格・色違いを反映する
    const boxPoke = sbState.box.find((b) => b.speciesId === snapPoke.speciesId);
    if (!boxPoke) return;   // 種族がボックスから無くなっている場合はスキップ
    boxPoke.ability = snapPoke.ability;
    boxPoke.nature = snapPoke.nature;
    boxPoke.moves = snapPoke.moves.slice();
    boxPoke.shiny = snapPoke.shiny;
    SB_STAT_KEYS.forEach((k) => { boxPoke.evPoints[k] = snapPoke.evPoints[k] || 0; });
    if (snapPoke.megaForm) boxPoke.megaForm = snapPoke.megaForm;
    sbRecalcStats(boxPoke);
    newMembers.push(boxPoke);
  });
  sbState.party = newMembers;
  sbState.selected = null;
  sbState.current = i;   // 「このチームをセットした」目印（一覧のハイライト用）
  sbSave();
  showScreen('serious');
  sbRenderAll();
}

// 保存：今の手持ち（左のパーティ欄）を、チーム番号 i へ丸ごと上書き保存する（メンバー構成＋技・努力値など）。
async function sbSaveCurrentToSlot(i) {
  const pt = sbState.parties[i];
  const hasSnapshot = Array.isArray(pt.snapshot) && pt.snapshot.length > 0;
  sbClosePartyActionSheet();   // 確認ダイアログが裏に隠れないよう、先にシートを閉じる
  if (sbPartyCount() === 0) {
    const okEmpty = await askConfirm('0匹のまま保存しますか？');
    if (!okEmpty) return;
  }
  const msg = hasSnapshot ? `「${pt.name}」を上書き保存しますか？` : `「${pt.name}」に保存しますか？`;
  const ok = await askConfirm(msg);
  if (!ok) return;
  // 個体を丸ごと複製して保持する（ボックスの個体と参照を共有しない、独立した控え）
  pt.snapshot = sbState.party.filter(Boolean).map((p) => sbRestorePoke(sbSerializePoke(p))).filter(Boolean);   // 空き枠は控えに含めない
  sbState.current = i;   // 「このチームに保存した」目印（一覧のハイライト用）
  sbSave();
  sbRenderPartySelect();
}

$('ps-action-set').addEventListener('click', () => {
  if (psActionTargetIdx == null) return;
  sbApplySnapshotToCurrent(psActionTargetIdx);
});
$('ps-action-write').addEventListener('click', () => {
  if (psActionTargetIdx == null) return;
  sbSaveCurrentToSlot(psActionTargetIdx);
});
$('ps-action-detail').addEventListener('click', () => {
  if (psActionTargetIdx == null) return;
  const idx = psActionTargetIdx;
  sbClosePartyActionSheet();
  sbOpenPartyDetail(idx);
});

/* ---------------------------------------------------------
   パーティ詳細：1画面でパーティ6匹（名前・特性・技4つ）をまとめて見る
   ・「詳細」ボタンから開く。もちもの／性別は表示しない（もちもの欄はメガのみ mega.png を名前の右に添える）
   --------------------------------------------------------- */
function pdtCardHtml(p, no) {
  const noHtml = `<span class="pdt-card-no">${no}</span>`;
  if (!p) return `<div class="pdt-card empty">${noHtml}</div>`;
  const megaIcon = sbMegaVisible(p)
    ? '<img class="pdt-card-mega" src="./mega.png" alt="メガ" loading="lazy" onerror="this.style.display=\'none\'">'
    : '';
  const abilityName = (typeof abilityNameById === 'function') ? (abilityNameById(p.ability) || '') : '';
  // タイプアイコン（種族のタイプ。重複は除く）を名前の右に並べる
  const types = [p.species.type1, p.species.type2].filter((t, i, arr) => t && arr.indexOf(t) === i);
  const typesHtml = types.map((t) => {
    const id = TYPE_ID[t];
    if (id === undefined) return '';
    return `<span class="pdt-type-chip"><img src="./type${id}.png" alt="" onerror="this.style.display='none'"></span>`;
  }).join('');
  const moves = p.moves.slice(0, 4).map((m) => `
      <div class="pdt-move">
        ${typeIconHtml(m.type).replace('move-row-type-icon', 'pdt-move-icon')}
        <span class="pdt-move-name">${m.name}</span>
      </div>`).join('');
  return `<div class="pdt-card">
    ${noHtml}
    <div class="pdt-card-head">
      ${sbSpriteHtml(p, 'pdt-card-img', true)}
      <span class="pdt-card-name">${p.species.name}</span>
      ${megaIcon}
      <span class="pdt-card-types">${typesHtml}</span>
    </div>
    <div class="pdt-card-body">
      <div class="pdt-card-side">
        <p class="pdt-card-ability">${abilityName}</p>
      </div>
      <div class="pdt-card-moves">${moves}
      </div>
    </div>
  </div>`;
}

// ステータスタブ：能力タブと同じヘッダー（画像・名前・タイプ）のまま、本文だけ
// 実数値＋努力値バーの6行（左＝HP/こうげき/ぼうぎょ、右＝とくこう/とくぼう/すばやさ）に差し替える。
function pdtStatCardHtml(p, no) {
  const noHtml = `<span class="pdt-card-no">${no}</span>`;
  if (!p) return `<div class="pdt-card empty">${noHtml}</div>`;
  const megaIcon = sbMegaVisible(p)
    ? '<img class="pdt-card-mega" src="./mega.png" alt="メガ" loading="lazy" onerror="this.style.display=\'none\'">'
    : '';
  const types = [p.species.type1, p.species.type2].filter((t, i, arr) => t && arr.indexOf(t) === i);
  const typesHtml = types.map((t) => {
    const id = TYPE_ID[t];
    if (id === undefined) return '';
    return `<span class="pdt-type-chip"><img src="./type${id}.png" alt="" onerror="this.style.display='none'"></span>`;
  }).join('');
  const rowHtml = ([label, key]) => {
    const v = (p.stats && p.stats[key] !== undefined) ? p.stats[key] : '-';
    const ev = Math.max(0, Math.min(SB_EV_MAX, (p.evPoints && p.evPoints[key]) || 0));
    const pct = (ev / SB_EV_MAX) * 100;
    return `<div class="pdt-stat-half">
      <span class="pdt-stat-label">${label}</span>
      <span class="pdt-stat-val">${v}</span>
      <span class="pdt-stat-bar"><i style="width:${pct}%"></i></span>
      <span class="pdt-stat-ev">${ev}</span>
    </div>`;
  };
  const left = [SB_STAT_ROWS[0], SB_STAT_ROWS[1], SB_STAT_ROWS[2]];
  const right = [SB_STAT_ROWS[3], SB_STAT_ROWS[4], SB_STAT_ROWS[5]];
  const rows = left.map((l, idx) => `<div class="pdt-stat-row">${rowHtml(l)}${rowHtml(right[idx])}</div>`).join('');
  return `<div class="pdt-card">
    ${noHtml}
    <div class="pdt-card-head">
      ${sbSpriteHtml(p, 'pdt-card-img', true)}
      <span class="pdt-card-name">${p.species.name}</span>
      ${megaIcon}
      <span class="pdt-card-types">${typesHtml}</span>
    </div>
    <div class="pdt-card-body pdt-stat-body">${rows}</div>
  </div>`;
}

let pdtActiveTab = 'ability';
function pdtRenderMembers(members) {
  const cards = [];
  const statCards = [];
  for (let k = 0; k < SB_PARTY_MAX; k++) {
    cards.push(pdtCardHtml(members[k], k + 1));
    statCards.push(pdtStatCardHtml(members[k], k + 1));
  }
  $('pdt-grid').innerHTML = cards.join('');
  $('pdt-grid-stats').innerHTML = statCards.join('');
}
function pdtSetTab(tab) {
  pdtActiveTab = tab;
  $('pdt-tab-ability').classList.toggle('active', tab === 'ability');
  $('pdt-tab-stats').classList.toggle('active', tab === 'stats');
  $('pdt-grid').style.display = tab === 'ability' ? '' : 'none';
  $('pdt-grid-stats').style.display = tab === 'stats' ? '' : 'none';
}
$('pdt-tab-ability').addEventListener('click', () => pdtSetTab('ability'));
$('pdt-tab-stats').addEventListener('click', () => pdtSetTab('stats'));

function sbOpenPartyDetail(i) {
  const pt = sbState.parties[i];
  const members = Array.isArray(pt.snapshot) ? pt.snapshot : [];
  $('pdt-topbar-name').textContent = pt.name;
  const fav = (typeof Pokedex !== 'undefined') ? Pokedex.getFavorite() : null;
  const favImg = $('pdt-topbar-fav');
  if (fav && fav.speciesId !== undefined && fav.speciesId !== null) {
    favImg.src = `./${fav.speciesId}${fav.shiny ? 's' : ''}.png`;
    favImg.classList.remove('empty');
  } else {
    favImg.src = '';
    favImg.classList.add('empty');
  }
  $('pdt-topbar-playername').textContent = (typeof PlayerProfile !== 'undefined' ? PlayerProfile.get() : '') || '';
  pdtRenderMembers(members);
  pdtSetTab('ability');
  $('pdt-overlay').classList.add('show');
}
function sbClosePartyDetail() {
  $('pdt-overlay').classList.remove('show');
}
$('pdt-back-btn').addEventListener('click', sbClosePartyDetail);

/* ---- パーティ名の変更 ---- */
function openPartyNameModal() {
  $('input-party-name').value = sbState.partyName;
  $('party-name-char-count').textContent = sbState.partyName.length;
  $('party-name-modal').classList.add('show');
  setTimeout(() => {
    try { $('input-party-name').focus(); $('input-party-name').select(); } catch (e) {}
  }, 60);
}
function closePartyNameModal() { $('party-name-modal').classList.remove('show'); }
function confirmPartyNameModal() {
  const nm = ($('input-party-name').value || '').trim().slice(0, SB_PARTY_NAME_MAX);
  sbState.partyName = nm || SB_WORKING_NAME;   // 空欄なら初期名に戻す
  sbSave();
  sbRenderParty();
  closePartyNameModal();
}
$('sb-party-name').addEventListener('click', openPartyNameModal);
$('party-name-cancel').addEventListener('click', closePartyNameModal);
$('party-name-confirm').addEventListener('click', confirmPartyNameModal);
$('input-party-name').addEventListener('input', () => {
  $('party-name-char-count').textContent = ($('input-party-name').value || '').length;
});
$('input-party-name').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); confirmPartyNameModal(); }
});

checkOrientation();
showScreen('title');

// 🏆記録ボタンのランク枠を、保存済みの最大連勝数に基づいて初期反映
updateRecordBtnRank();

// アセット（画像・効果音・BGM）を事前読み込みしておく
AssetPreloader.preloadAll();

// ブラウザの自動再生制限のため、最初のユーザー操作でホームBGMを開始する
// ---- iOS Safari 対策 ----
// iOSのSafari/WebViewは「その<audio>要素自身に対して、ユーザー操作のコールスタック内で
// 一度 play() を呼んだこと」がある要素しか、以後スクリプトからの再生を許可しない。
// MenuBgm用の1個だけ再生しても、クリック音・バトル効果音・バトルBGM(30曲)用に
// 別途生成してある大量のAudioインスタンスはロックされたままになり、
// 「BGMは鳴るのに効果音や対戦中の曲だけ鳴らない」または「何も鳴らない」という
// iPhoneでの不具合の主な原因になる。そこで最初のユーザー操作のタイミングで、
// 存在する全Audioインスタンスに対して「即再生→即一時停止」を行い、まとめてアンロックする。
// play()は非同期でわずかに遅延することがあり、pause()が間に合わないと
// 一瞬だけ実際に音が聞こえてしまうことがあるため、再生前に音量を0にしておき、
// 元の音量に戻してからアンロック処理を終える。
// なお menu.mp3 はこの直後に MenuBgm.start() が独自に再生を開始するため、
// ここで扱うと pause() のタイミングが競合して再生が止まってしまう恐れがある。
// そのため menu.mp3 はアンロック対象から除外し、MenuBgm.start() 側の
// 通常再生自体にアンロックを任せる。
function unlockAllAudioForIOS() {
  const targets = [];
  clickSoundPool.forEach((a) => targets.push(a));
  Object.values(battleSfxPools).forEach((entry) => entry.pool.forEach((a) => targets.push(a)));
  AssetPreloader.audioBuffers.forEach((a, path) => {
    if (path === './menu.mp3') return;
    targets.push(a);
  });
  targets.forEach((a) => {
    // このAudioインスタンスに対して、アンロック処理が再生を仕込んだ「印」を付けておく。
    // play()のPromise解決後、この印が書き換わっていなければ「その間に誰も
    // このインスタンスを使っていない」と分かるので、そのときだけ安全に止める。
    // バトルBGM開始などが割り込んでいた場合はここで止めてしまうと再生を潰してしまうため触らない。
    const token = {};
    a._iosUnlockToken = token;
    // muted はデコードや出力そのものをブロックするため、volumeより確実に無音化できる。
    // 念のため volume も 0 にしておき、二重に無音対策をしておく
    // （多数のAudio要素をまとめてアンロックする際、片方だけでは
    // 「一瞬で全部の効果音が一気に流れる」ように聞こえる不具合が起きたため）。
    const wasMuted = a.muted;
    const originalVolume = a.volume;
    a.muted = true;
    a.volume = 0;
    const restore = () => {
      if (a._iosUnlockToken !== token) return; // 途中で他の再生に使われていたら何もしない
      try {
        a.pause();
        a.currentTime = 0;
        a.muted = wasMuted;
        a.volume = originalVolume;
      } catch (e) {}
    };
    try {
      const p = a.play();
      if (p && p.then) {
        p.then(restore).catch(restore);
      } else {
        restore();
      }
    } catch (e) {
      restore();
    }
  });
}
function startMenuBgmOnFirstInteraction() {
  unlockAllAudioForIOS();
  MenuBgm.start();
  document.removeEventListener('pointerdown', startMenuBgmOnFirstInteraction, true);
  document.removeEventListener('click', startMenuBgmOnFirstInteraction, true);
}
document.addEventListener('pointerdown', startMenuBgmOnFirstInteraction, true);
document.addEventListener('click', startMenuBgmOnFirstInteraction, true);

// ---- iOS Safari: バックグラウンド復帰時にBGMが鳴らなくなる問題への対策 ----
// Safariでは、ホームボタンを押す・他アプリに切り替える・画面をロックするなどして
// アプリがバックグラウンドに回ると、再生中の<audio>が強制的に一時停止される。
// フォアグラウンドに戻った際に自動で再開してくれるとは限らず、
// 「さっきまで鳴っていたBGMが無音になる」といった症状として現れる。
// document.visibilitychangeでこれを検知し、画面に戻ってきたタイミングで、
// 鳴っているはずのBGMが止まっていれば再生を再開する。
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  const battleAudio = BattleBgm.getCurrentAudioIfAny ? BattleBgm.getCurrentAudioIfAny() : null;
  if (battleAudio && battleAudio.paused) {
    const p = battleAudio.play();
    if (p && p.catch) p.catch(() => {});
    return;
  }
  MenuBgm.resumeIfNeeded();
});

/* ---------------------------------------------------------
   トレーニング画面
   ・編成画面の「トレーニング」ボタンで開く。選択中の個体（sbState.selected）を編集する。
   ・能力ポイント：1能力あたり最大32、合計66。1ポイントで実数値+1。
   ・編集は作業用コピー(trDraft)に対して行い、「けってい」で確定＋保存、「もどる」で破棄。
   ・行をタップ → 操作パネル（−10 / − / スライダー / ＋ / ＋10）が出る。長押しで連続増減。
   --------------------------------------------------------- */
const TR_EV_TOTAL = 66;        // 能力ポイントの合計上限（表示用）
const TR_EV_MAX = SB_EV_MAX;   // 1能力あたりの最大（= 32）

// ステータス行：[ラベル, キー, アイコン(SVG)]
const TR_STAT_ROWS = [
  ['HP',       'hp',  '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 21s-8.5-5.2-8.5-11.1C3.5 6.5 5.9 4.5 8.4 4.5c1.5 0 2.9.8 3.6 2 .7-1.2 2.1-2 3.6-2 2.5 0 4.9 2 4.9 5.400C20.500 15.8 12 21 12 21z"/></svg>'],
  ['こうげき', 'atk', '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 1.500l2.300 5.2 4.7-3-1.1 5.5 5.6.200-4.3 3.8 4.1 3.1-5.5.600 1.5 5.4-4.8-3-2.5 4.9-2.5-4.9-4.8 3 1.5-5.4-5.5-.600 4.1-3.100L1.400 8.400l5.600-.200L5.900 2.700l4.700 3z"/></svg>'],
  ['ぼうぎょ', 'def', '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 2l8.500 3v6.500c0 5-3.5 8.8-8.5 10.5-5-1.7-8.5-5.5-8.5-10.500V5z"/><path fill="#fff" d="M12 6.500l1.500 3.2 3.5.4-2.6 2.4.7 3.5-3.1-1.8-3.1 1.8.7-3.500L7 10.100l3.500-.4z"/></svg>'],
  ['とくこう', 'spa', '<svg viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="2.2"><ellipse cx="12" cy="12" rx="9.5" ry="5.5"/><ellipse cx="12" cy="12" rx="5.5" ry="2.8"/></g><circle cx="12" cy="12" r="1.5" fill="currentColor"/></svg>'],
  ['とくぼう', 'spd', '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 2l8.500 3v6.500c0 5-3.5 8.8-8.5 10.5-5-1.7-8.5-5.5-8.5-10.500V5z"/><g fill="none" stroke="#fff" stroke-width="1.8"><ellipse cx="12" cy="11.5" rx="5.2" ry="3.2"/></g><circle cx="12" cy="11.5" r="1.2" fill="#fff"/></svg>'],
  ['すばやさ', 'spe', '<svg viewBox="0 0 24 24"><g fill="currentColor"><path d="M2 6.500h13.500c2.500 0 4 1.2 4.5 3H9.500z"/><path d="M4 11h13c2.200 0 3.6 1 4 2.600H9z"/><path d="M6.500 15.500h9.500c1.800 0 3 .8 3.4 2.300H11z"/></g></svg>'],
];

// 性格補正の矢印（上昇=赤の二重山形 / 下降=青の二重V）
const TR_ARROW_UP = '<svg viewBox="0 0 16 16"><g fill="none" stroke="#ff5577" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.500L8 3.500l5 5"/><path d="M3 13.500L8 8.500l5 5"/></g></svg>';
const TR_ARROW_DOWN = '<svg viewBox="0 0 16 16"><g fill="none" stroke="#2f7bff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 2.500L8 7.500l5-5"/><path d="M3 7.500L8 12.500l5-5"/></g></svg>';
// 性格選択グリッドの見出し専用：下降側だけ水色にした版（能力ポイント欄の矢印はそのまま青を使う）
const TR_ARROW_DOWN_CYAN = '<svg viewBox="0 0 16 16"><g fill="none" stroke="#22c5e0" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 2.500L8 7.500l5-5"/><path d="M3 7.500L8 12.500l5-5"/></g></svg>';

// タイプ色：戦闘中の技メニュー（.t-*-edge）と同じ色に統一する
const TR_TYPE_COLOR = {
  bug:'#8fbb2e', dark:'#5a5366', dragon:'#7161e0', electric:'#e8c832', fairy:'#ee9bd0', fighting:'#c0432c',
  fire:'#f0812e', flying:'#8fa9ee', ghost:'#5a4a8f', grass:'#5fbf5a', ground:'#c8a24d', ice:'#7fd3e0',
  normal:'#9a9a86', poison:'#a05fc0', psychic:'#e2618c', rock:'#b8a750', steel:'#8f9fb0', water:'#4f9bde',
  sound:'#99FFCC', shine:'#ffd600',
};

// 性格の表示名：固有名（まじめ・いじっぱり…）を返す。
function trNatureText(natureId) {
  return natureName(natureId);
}

function trTypeBadgeHtml(type) {
  const id = TYPE_ID[type];
  const color = TR_TYPE_COLOR[type] || '#8a86c0';
  const img = id !== undefined
    ? `<img src="./type${id}.png" alt="" onerror="this.style.display='none'">`
    : '';
  return `<span class="tr-type-badge" style="background:${color}" title="${typeJp(type)}">${img}</span>`;
}

function trBuildSparkles() {
  const box = $('tr-sparkles');
  if (!box || box.childElementCount) return;
  let html = '';
  for (let n = 0; n < 26; n++) {
    const x = Math.round(Math.random() * 100);
    const y = Math.round(Math.random() * 100);
    const d = (Math.random() * 3.6).toFixed(2);
    const s = (0.7 + Math.random() * 1.1).toFixed(2);
    html += `<i style="left:${x}%;top:${y}%;animation-delay:${d}s;width:${(7 * s).toFixed(1)}px;height:${(7 * s).toFixed(1)}px"></i>`;
  }
  box.innerHTML = html;
}

// ---- 編集状態 ----
let trTarget = null;                 // 編集対象の個体（sbState.selected）
let trDraft = null;                  // 作業用のポイント { hp, atk, ... }
let trSel = null;                    // 操作パネルを開いている能力キー（null=閉じている）
let trNatureDraft = null;            // 作業用の性格ID（「もどる」で破棄するため trTarget.nature とは別に持つ）
let trAbilityDraft = null;           // 作業用の特性ID（同上）
let trMovesDraft = [];               // 作業用の技配列（buildMoveObjectで作った技オブジェクト、最大4）
let trMegaFormDraft = null;          // 作業用のメガ先（'X'|'Y'）。X/Y両方あるポケモンだけ使う（同上）
let trMegaViewActive = false;        // 【表示専用】trueなら能力ポイント欄をメガシンカ後の種族値基準で表示する

const trSum = (d) => SB_STAT_KEYS.reduce((s, k) => s + (d[k] || 0), 0);

// ポイントを反映した実数値（性格補正のあとに +1/ポイント）。性格は編集中のドラフト値を使う。
// メガビューON中は種族値をメガシンカ後（trMegaFormDraftのフォーム）のものに差し替える。
function trStatValue(p, key, pts) {
  let base = p.species.baseStats[key];
  if (trMegaViewActive) {
    const mega = getMegaEvolutionDataForSpeciesId(p.speciesId, trMegaFormDraft);
    if (mega) base = mega.baseStats[key];
  }
  const nm = key === 'hp' ? 1 : natureMultiplier(trNatureDraft, key);
  return calcStat(base, p.iv, 0, p.level, key === 'hp', nm) + pts;
}

function trToast(msg) {
  const t = $('tr-toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(trToast._t);
  trToast._t = setTimeout(() => t.classList.remove('show'), 1400);
}

// ---- 描画 ----
function trRenderHeader(p) {
  const sp = p.species;
  const icon = $('tr-head-icon');
  icon.onerror = () => { icon.style.visibility = 'hidden'; };
  icon.style.visibility = 'visible';
  icon.src = spritePath(p);
  $('tr-head-name').textContent = sp.name;
  // メガビューON中はタイプ表示もメガシンカ後のものにする（画像・図鑑データ自体は変えない）
  let type1 = sp.type1, type2 = sp.type2;
  if (trMegaViewActive) {
    const mega = getMegaEvolutionDataForSpeciesId(p.speciesId, trMegaFormDraft);
    if (mega) { type1 = mega.type1; type2 = mega.type2; }
  }
  $('tr-head-types').innerHTML = [type1, type2].filter(Boolean).map(trTypeBadgeHtml).join('');
  trRenderMegaViewBtn();
}

// タイプ表示の右のメガビューボタン：メガシンカ可能な種族の時だけ表示する
function trRenderMegaViewBtn() {
  const btn = $('tr-btn-megaview');
  if (!btn) return;
  const canMega = sbMegaVisible(trTarget);
  btn.classList.toggle('show', canMega);
  btn.classList.toggle('active', trMegaViewActive);
  btn.setAttribute('aria-pressed', trMegaViewActive ? 'true' : 'false');
}

function trRenderMovesAndTraits(p) {
  const mv = trMovesDraft.slice(0, 4);
  let mvHtml = mv.map((m, slot) => {
    if (!m) return trEmptyMoveSlotHtml(slot);
    const id = TYPE_ID[m.type];
    const color = TR_TYPE_COLOR[m.type] || '#9aa0b8';
    const ic = id !== undefined
      ? `<img src="./type${id}.png" alt="" onerror="this.style.display='none'">`
      : '';
    // 威力・命中は戦闘中の技メニューと同じ書式（威力:xx　命中:xx）。変化技や必中は「-」
    const power = (m.power === null || m.power === undefined) ? '-' : m.power;
    const acc = (m.accuracy === null || m.accuracy === undefined || m.accuracy >= 999) ? '-' : m.accuracy;
    return `<button type="button" class="tr-move" data-slot="${slot}">
      <span class="tico" style="background:${color}">${ic}</span>
      <span class="mbody">
        <span class="mtop"><span class="mn">${m.name}</span><span class="pp">${m.maxPp}</span></span>
        <span class="mdet">威力:${power}\u3000命中:${acc}</span>
      </span>
    </button>`;
  }).join('');
  for (let n = mv.length; n < 4; n++) {
    mvHtml += trEmptyMoveSlotHtml(n);
  }
  $('tr-moves').innerHTML = mvHtml;
  trRenderNaturePill();
  trRenderAbilityPill();
}
function trEmptyMoveSlotHtml(slot) {
  return `<button type="button" class="tr-move" data-slot="${slot}"><span class="tico"></span><span class="mbody"><span class="mtop"><span class="mn"></span><span class="pp"></span></span><span class="mdet"></span></span></button>`;
}

function trRenderNaturePill() {
  $('tr-nature').textContent = trNatureText(trNatureDraft);
}
function trRenderAbilityPill() {
  $('tr-ability').textContent = abilityJp(trAbilityDraft);
}
// メガ先（X/Y）の行：X/Y両方のメガシンカを持つポケモン（リザードン・ライチュウ等）だけ表示する。
// ここで選んだ方に、対戦中このポケモンがメガシンカする時のフォームが固定される。
function trRenderMegaFormRow() {
  const row = $('tr-megaform-row');
  if (!trTarget || !sbMegaVisible(trTarget) || !hasMultiMegaForms(trTarget)) { row.classList.remove('show'); return; }
  row.classList.add('show');
  $('tr-megaform-x').classList.toggle('active', trMegaFormDraft === 'X');
  $('tr-megaform-y').classList.toggle('active', trMegaFormDraft === 'Y');
}

// 能力ポイント6行を作り直す（行の選択状態は trSel に従う）
function trRenderStats() {
  const p = trTarget;
  const rows = TR_STAT_ROWS.map(([label, key, svg]) => {
    const ev = trDraft[key];
    const nm = key === 'hp' ? 1 : natureMultiplier(trNatureDraft, key);
    const natCls = nm > 1 ? ' nat-up' : (nm < 1 ? ' nat-down' : '');
    const arrow = nm > 1 ? TR_ARROW_UP : (nm < 1 ? TR_ARROW_DOWN : '');
    const pct = (ev / TR_EV_MAX) * 100;
    const sel = trSel === key ? ' selected' : '';
    return `<div class="tr-stat${natCls}${sel}" data-key="${key}">
      <span class="ico">${svg}</span>
      <span class="lb">${label}</span>
      <span class="nat">${arrow}</span>
      <span class="val">${trStatValue(p, key, ev)}</span>
      <span class="bar"><i style="width:${pct}%"></i></span>
      <span class="ev">${ev}</span>
    </div>`;
  }).join('');
  $('tr-stats').innerHTML = rows;
  trRenderTotal();
}

function trRenderTotal() {
  const used = trSum(trDraft);
  const el = $('tr-total');
  el.textContent = `${used}/${TR_EV_TOTAL}`;
  el.classList.toggle('full', used >= TR_EV_TOTAL);
}

// 値が変わった行だけを更新（連打・長押し中に行を作り直さない → 指が外れない／ちらつかない）
function trUpdateRow(key, bump) {
  const p = trTarget;
  const row = $('tr-stats').querySelector(`.tr-stat[data-key="${key}"]`);
  if (!row) return;
  const ev = trDraft[key];
  const val = row.querySelector('.val'), evEl = row.querySelector('.ev'), bar = row.querySelector('.bar i');
  val.textContent = trStatValue(p, key, ev);
  evEl.textContent = ev;
  bar.style.width = `${(ev / TR_EV_MAX) * 100}%`;
  if (bump) {
    [val, evEl].forEach((e) => { e.classList.remove('bump'); void e.offsetWidth; e.classList.add('bump'); });
  }
  trRenderTotal();
  if (trSel === key) trRenderAdjust();
}

// ---- 操作パネル ----
function trAdjustMax(key) {
  // その能力に入れられる上限＝min(32, 現在値 + 合計の残り)
  return Math.min(TR_EV_MAX, trDraft[key] + (TR_EV_TOTAL - trSum(trDraft)));
}

function trRenderAdjust() {
  const key = trSel;
  const box = $('tr-adjust');
  if (!key) { box.classList.remove('show'); return; }
  const row = TR_STAT_ROWS.find((r) => r[1] === key);
  const v = trDraft[key];
  $('tr-adj-label').textContent = row[0];
  $('tr-adj-ico').innerHTML = row[2];
  $('tr-adj-val').innerHTML = `${v}<small>/${TR_EV_MAX}</small>`;
  const pct = (v / TR_EV_MAX) * 100;
  $('tr-adj-fill').style.width = `${pct}%`;
  $('tr-adj-knob').style.left = `${pct}%`;
  const maxHere = trAdjustMax(key);
  $('tr-adj-m1').disabled = v <= 0;
  $('tr-adj-m10').disabled = v <= 0;
  $('tr-adj-p1').disabled = v >= maxHere;
  $('tr-adj-p10').disabled = v >= maxHere;
  box.classList.add('show');
}

// 操作パネルは常に能力ポイント一覧のすぐ下（固定位置）に表示する。
// ここでは「今どの能力を指しているか」を示す三角(caret)の横位置だけを、選択行に合わせて動かす。
function trPlaceAdjust() {
  const key = trSel;
  const box = $('tr-adjust');
  if (!key) return;
  const row = $('tr-stats').querySelector(`.tr-stat[data-key="${key}"]`);
  if (!row) return;
  const br = box.getBoundingClientRect();
  const rr = row.getBoundingClientRect();
  const cx = rr.left - br.left + 34;                     // アイコン付近を指す三角
  box.style.setProperty('--tr-caret', `${Math.max(10, cx)}px`);
}

function trSelect(key) {
  trSel = (trSel === key) ? null : key;                  // 同じ行をもう一度タップで閉じる
  $('tr-stats').querySelectorAll('.tr-stat').forEach((r) => r.classList.toggle('selected', r.dataset.key === trSel));
  trRenderAdjust();
  trPlaceAdjust();
}


// ポイントを変更する。範囲外・合計超過は丸めて、止まった理由を表示する。戻り値=実際に変わったか
function trSetPoints(key, want, silent) {
  const cur = trDraft[key];
  const cap = trAdjustMax(key);
  let next = Math.max(0, Math.min(cap, Math.round(want)));
  if (want > cap && next === cur && !silent) {
    trToast(trSum(trDraft) >= TR_EV_TOTAL && cap < TR_EV_MAX
      ? `ごうけい ${TR_EV_TOTAL} まで です`
      : `1つの のうりょくは ${TR_EV_MAX} まで です`);
  }
  if (next === cur) return false;
  trDraft[key] = next;
  trUpdateRow(key, true);
  return true;
}

// ---- 入力：ボタン（タップ／長押しで連続） ----
const trHold = { timer: null, iv: null };
function trHoldStop() { clearTimeout(trHold.timer); clearInterval(trHold.iv); trHold.timer = trHold.iv = null; }

function trBindHold(btnId, delta) {
  const btn = $(btnId);
  const step = () => {
    if (!trSel) return false;
    const changed = trSetPoints(trSel, trDraft[trSel] + delta, false);
    return changed;
  };
  const start = (e) => {
    e.preventDefault();
    trHoldStop();
    if (btn.disabled) return;
    const first = step();
    if (!first) return;
    trHold.timer = setTimeout(() => {                     // 0.4秒押し続けたら連続
      trHold.iv = setInterval(() => { if (!step()) trHoldStop(); }, 70);
    }, 400);
  };
  btn.addEventListener('pointerdown', start);
  ['pointerup', 'pointercancel', 'pointerleave', 'contextmenu'].forEach((ev) => btn.addEventListener(ev, trHoldStop));
}

// ---- 入力：スライダー（ドラッグ／タップで値を直接指定） ----
function trBindSlider() {
  const el = $('tr-adj-slider');
  const track = el.querySelector('.tr-adj-track');
  let dragging = false;
  const setFromX = (clientX) => {
    if (!trSel) return;
    const r = track.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    trSetPoints(trSel, ratio * TR_EV_MAX, false);
  };
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    dragging = true;
    try { el.setPointerCapture(e.pointerId); } catch (_) {}
    setFromX(e.clientX);
  });
  el.addEventListener('pointermove', (e) => { if (dragging) setFromX(e.clientX); });
  const end = () => { dragging = false; };
  ['pointerup', 'pointercancel'].forEach((ev) => el.addEventListener(ev, end));
}

function trBindRows() {
  // 行はタップのたびに作り直さないので、委譲で1回だけ登録
  $('tr-stats').addEventListener('click', (e) => {
    const row = e.target.closest('.tr-stat');
    if (row) trSelect(row.dataset.key);
  });
}

/* ---------------------------------------------------------
   能力補正（性格）選択：5x5グリッド（行=上昇ステータス／列=下降ステータス）
   ・対角は無補正の5性格（まじめ・すなお・てれや・がんばりや・きまぐれ）
   ・タップで即座に trTarget.nature を変更し、実数値・矢印を再計算する
   --------------------------------------------------------- */
function trNatureGridHtml() {
  let html = '<div class="tr-nsel-corner"></div>';
  NATURE_GRID_ORDER.forEach((c) => {
    html += `<div class="tr-nsel-colhead">${TR_ARROW_DOWN_CYAN}<span>${NATURE_GRID_LABEL[c]}</span></div>`;
  });
  NATURE_GRID_ORDER.forEach((r) => {
    html += `<div class="tr-nsel-rowhead">${TR_ARROW_UP}<span>${NATURE_GRID_LABEL[r]}</span></div>`;
    NATURE_GRID_ORDER.forEach((c) => {
      const id = natureIdForGrid(r, c);
      const diag = r === c ? ' diag' : '';
      html += `<button type="button" class="tr-nsel-cell${diag}" data-nature="${id}">${natureName(id)}</button>`;
    });
  });
  return html;
}

function trRenderNatureGrid() {
  $('tr-nsel-grid').innerHTML = trNatureGridHtml();
  trUpdateNatureGridSelection();
}

function trUpdateNatureGridSelection() {
  const cur = trNatureDraft;
  $('tr-nsel-grid').querySelectorAll('.tr-nsel-cell').forEach((el) => {
    el.classList.toggle('selected', parseInt(el.dataset.nature, 10) === cur);
  });
}

function openNatureSelect() {
  if (!trTarget) return;
  trRenderNatureGrid();
  $('tr-nature-overlay').classList.add('show');
}
function closeNatureSelect() {
  $('tr-nature-overlay').classList.remove('show');
}

function trChooseNature(natureId) {
  if (!trTarget || trNatureDraft === natureId) { closeNatureSelect(); return; }
  trNatureDraft = natureId;
  trRenderNaturePill();
  trRenderStats();          // 矢印・実数値を性格補正込みで再計算して表示（確定はまだしない）
  trUpdateNatureGridSelection();
  closeNatureSelect();
}

$('tr-nature').addEventListener('click', openNatureSelect);
$('tr-nsel-close').addEventListener('click', closeNatureSelect);
$('tr-nature-overlay').addEventListener('click', (e) => {
  if (e.target === $('tr-nature-overlay')) closeNatureSelect();
  const cell = e.target.closest('.tr-nsel-cell');
  if (cell) trChooseNature(parseInt(cell.dataset.nature, 10));
});

/* ---------------------------------------------------------
   特性選択：そのポケモンの種族が持ちうる特性（species.abilities）から選ぶ
   --------------------------------------------------------- */
function trAbilityListHtml() {
  const list = (trTarget && Array.isArray(trTarget.species.abilities) && trTarget.species.abilities.length)
    ? trTarget.species.abilities
    : (trTarget ? [trAbilityDraft] : []);
  const normalHtml = list.map((abId) => {
    const desc = (GAME_DATA && GAME_DATA.abilityDesc && GAME_DATA.abilityDesc[abId]) || '';
    return `<button type="button" class="tr-asel-item" data-ability="${abId}">
      <span class="an">${abilityJp(abId)}</span>${desc ? `<span class="ad">${desc}</span>` : ''}
    </button>`;
  }).join('');
  return normalHtml + trMegaAbilitySectionHtml();
}

// 特性選択の下に出す「--メガシンカ後--」セクション。
// ・メガシンカできる種族で、かつ解放済みのものだけ表示する（sbMegaVisible が解放判定を兼ねる。
//   乱入ボス系の未解放メガは、特性名でネタバレしないよう一切出さない）。
// ・X/Y両方のメガを持つ種族（リザードン・ライチュウ）は、トレーニング画面で選んでいる方
//   （trMegaFormDraft）の特性を出す。
// ・これは「見るだけ」の表示。選択できるボタンにはしない（メガ後の特性は変身時に自動で決まり、
//   trAbilityDraft／保存内容には一切影響しない）。
function trMegaAbilitySectionHtml() {
  if (!trTarget || !sbMegaVisible(trTarget)) return '';
  const mega = getMegaEvolutionDataForSpeciesId(trTarget.speciesId, trMegaFormDraft);
  if (!mega || mega.ability == null) return '';
  const desc = (GAME_DATA && GAME_DATA.abilityDesc && GAME_DATA.abilityDesc[mega.ability])
    || abilityDescById(mega.ability) || '';
  // X/Yがある種族は、どちらのフォームの特性か分かるよう見出しに添える
  const formTag = hasMultiMegaForms(trTarget) && trMegaFormDraft
    ? `<span class="tr-asel-megaform ${trMegaFormDraft === 'Y' ? 'y' : 'x'}">${trMegaFormDraft}</span>` : '';
  return `<div class="tr-asel-megahead"><span>メガシンカ後</span>${formTag}</div>
    <div class="tr-asel-item tr-asel-megaitem" aria-label="メガシンカ後の特性（表示のみ）">
      <span class="an">${abilityJp(mega.ability)}</span>${desc ? `<span class="ad">${desc}</span>` : ''}
    </div>`;
}

function trUpdateAbilityListSelection() {
  const cur = trAbilityDraft;
  $('tr-asel-list').querySelectorAll('.tr-asel-item[data-ability]').forEach((el) => {
    el.classList.toggle('selected', parseInt(el.dataset.ability, 10) === cur);
  });
}

function openAbilitySelect() {
  if (!trTarget) return;
  $('tr-asel-list').innerHTML = trAbilityListHtml();
  trUpdateAbilityListSelection();
  $('tr-ability-overlay').classList.add('show');
}
function closeAbilitySelect() {
  $('tr-ability-overlay').classList.remove('show');
}

function trChooseAbility(abilityId) {
  if (!trTarget || trAbilityDraft === abilityId) { closeAbilitySelect(); return; }
  trAbilityDraft = abilityId;
  trRenderAbilityPill();
  trUpdateAbilityListSelection();
  closeAbilitySelect();
}

$('tr-ability').addEventListener('click', openAbilitySelect);
$('tr-megaform-x').addEventListener('click', () => {
  if (trMegaFormDraft === 'X') return;
  trMegaFormDraft = 'X';
  trRenderMegaFormRow();
  if (trMegaViewActive) { trRenderHeader(trTarget); trRenderStats(); }
});
$('tr-megaform-y').addEventListener('click', () => {
  if (trMegaFormDraft === 'Y') return;
  trMegaFormDraft = 'Y';
  trRenderMegaFormRow();
  if (trMegaViewActive) { trRenderHeader(trTarget); trRenderStats(); }
});
$('tr-btn-megaview').addEventListener('click', () => {
  if (!trTarget || !sbMegaVisible(trTarget)) return;
  trMegaViewActive = !trMegaViewActive;
  trRenderHeader(trTarget);   // タイプ表示とボタンの見た目を切り替える
  trRenderStats();            // 能力ポイント欄の実数値をメガ後基準に切り替える（画像・技・特性は変えない）
});
$('tr-asel-close').addEventListener('click', closeAbilitySelect);
$('tr-ability-overlay').addEventListener('click', (e) => {
  if (e.target === $('tr-ability-overlay')) closeAbilitySelect();
  const item = e.target.closest('.tr-asel-item[data-ability]');
  if (item) trChooseAbility(parseInt(item.dataset.ability, 10));
});

/* ---------------------------------------------------------
   技変更：そのポケモンのレベル技（levelMoves）全部から選んで、
   タップしたスロットに教える。並びはタイプID順→タイプ内は名前順。
   --------------------------------------------------------- */
let trMoveSlot = null;     // 今どのスロット（0〜3）を編集中か
let trMovePickId = null;   // 一覧で選択中（まだ「決定」していない）の技ID

// そのポケモンが覚えられる技IDを、タイプID順→名前順で並べた技オブジェクトの配列にする。
// すでに他のスロットで使っている技も一覧には表示する（「わざスロット:N」と出す）。
// 他スロットの技を選んで決定した場合は、2つのスロットの技を入れ替える（重複はしない）。
function trLearnableMoves() {
  const ids = levelUpMoveIds(trTarget.species);
  return ids
    .map((id) => buildMoveObject(id))
    .filter(Boolean)
    .sort((a, b) => {
      const ta = TYPE_ID[a.type] || 99, tb = TYPE_ID[b.type] || 99;
      if (ta !== tb) return ta - tb;
      return a.name.localeCompare(b.name, 'ja');
    });
}

// 技IDが今どのスロットに入っているか（0〜3）。入っていなければ -1
function trSlotOfMove(moveId) {
  return trMovesDraft.findIndex((m) => m && m.id === moveId);
}

function trMoveListItemHtml(m) {
  const id = TYPE_ID[m.type];
  const color = TR_TYPE_COLOR[m.type] || '#9aa0b8';
  const ic = id !== undefined
    ? `<img src="./type${id}.png" alt="" onerror="this.style.display='none'">`
    : '';
  const slot = trSlotOfMove(m.id);
  const isEditing = slot !== -1 && slot === trMoveSlot;   // いま編集中のスロットの技
  const badge = slot !== -1
    ? `<span class="slotbadge${isEditing ? ' editing' : ''}">わざスロット:${slot + 1}</span>`
    : '';
  return `<button type="button" class="tr-msel-item${slot !== -1 ? ' inslot' : ''}${isEditing ? ' current' : ''}" data-move="${m.id}">
    <span class="tico" style="background:${color}">${ic}</span>
    <span class="mnwrap"><span class="mn">${m.name}</span>${badge}</span>
    <span class="pp">${m.pp}</span>
  </button>`;
}

function trMoveDetailHtml(m) {
  if (!m) return '<div class="empty">技を選んでください</div>';
  const power = (m.power === null || m.power === undefined) ? '-' : m.power;
  const acc = (m.accuracy === null || m.accuracy === undefined || m.accuracy >= 999) ? '-' : m.accuracy;
  const catIcon = trMoveCategoryIconHtml(m.category);
  const catLabel = MOVE_CATEGORY_JP[m.category] || m.category;
  const priority = m.priority || 0;
  const priorityText = priority > 0 ? `優先度+${priority}` : (priority < 0 ? `優先度${priority}` : '優先度+0');
  const desc = describeMoveEffect(m).replace(/\n/g, '<br>');
  const slot = trSlotOfMove(m.id);
  const note = slot !== -1
    ? `<span class="slotnote${slot === trMoveSlot ? ' editing' : ''}">わざスロット:${slot + 1}</span>`
    : '';
  return `
    <div class="tr-msdt-name"><span>${m.name}</span>${note}</div>
    <div class="tr-msdt-grid">
      <div class="tr-msdt-cell"><span class="k">技分類</span><span class="v">${catIcon}</span><span class="sub">${catLabel}</span></div>
      <div class="tr-msdt-cell"><span class="k">威力</span><span class="v">${power}</span></div>
      <div class="tr-msdt-cell"><span class="k">命中</span><span class="v">${acc}</span></div>
    </div>
    <div class="tr-msdt-range"><span class="k">優先度</span><span class="v">${priorityText}</span></div>
    <div class="tr-msdt-desc">${desc}</div>
  `;
}

function trRenderMoveList() {
  const list = trLearnableMoves();
  $('tr-msel-list').innerHTML = list.map(trMoveListItemHtml).join('') || '<div class="empty">覚えられる技がありません</div>';
}

function trRenderMoveDetail() {
  const list = trLearnableMoves();
  const picked = list.find((m) => m.id === trMovePickId) || null;
  $('tr-msel-detail').innerHTML = trMoveDetailHtml(picked);
  $('tr-msel-ok').disabled = !picked;
}

function trUpdateMoveListSelection() {
  $('tr-msel-list').querySelectorAll('.tr-msel-item').forEach((el) => {
    el.classList.toggle('selected', parseInt(el.dataset.move, 10) === trMovePickId);
  });
}

function openMoveSelect(slot) {
  if (!trTarget) return;
  trMoveSlot = slot;
  trMovePickId = trMovesDraft[slot] ? trMovesDraft[slot].id : null;
  trRenderMoveList();
  trUpdateMoveListSelection();
  trRenderMoveDetail();
  $('tr-move-overlay').classList.add('show');
}
function closeMoveSelect() {
  $('tr-move-overlay').classList.remove('show');
  trMoveSlot = null;
  trMovePickId = null;
}

function trPickMove(moveId) {
  trMovePickId = moveId;
  trUpdateMoveListSelection();
  trRenderMoveDetail();
}

function trConfirmMove() {
  if (trMoveSlot === null || trMovePickId === null) return;
  const m = buildMoveObject(trMovePickId);
  if (!m) return;
  const from = trSlotOfMove(trMovePickId);
  if (from !== -1 && from !== trMoveSlot) {
    // 他スロットで使用中の技 → 2つのスロットの技を入れ替える
    const tmp = trMovesDraft[trMoveSlot];
    trMovesDraft[trMoveSlot] = trMovesDraft[from];
    trMovesDraft[from] = tmp;
  } else {
    trMovesDraft[trMoveSlot] = m;
  }
  trRenderMovesAndTraits(trTarget);
  closeMoveSelect();
}

// タップ：技の変更画面を開く（長押し並び替えの直後のclickは無視）
$('tr-moves').addEventListener('click', (e) => {
  if (trMoveDrag.justDragged) { e.preventDefault(); return; }
  const btn = e.target.closest('.tr-move');
  if (btn) openMoveSelect(parseInt(btn.dataset.slot, 10));
});

/* ---------------------------------------------------------
   技スロット：長押しで持ち上げて並び替え（左の手持ちと同じ操作）
   ・タップ            → 技の変更画面（従来どおり）
   ・約 TR_LP_MS 長押し → 枠が浮き上がる（振動つき）→ 指に追従 → 離した位置の技と入れ替わる
   ・長押し成立前に TR_LP_CANCEL_PX 以上動いたらキャンセル（誤爆防止）
   ・空のスロットは持ち上げられないが、空きスロットへ落とすことはできる（その位置へ移動）
   ・入れ替えるのは作業用の trMovesDraft だけ。「けってい」を押すまで実個体には反映しない
   --------------------------------------------------------- */
const TR_LP_MS = 380;
const TR_LP_CANCEL_PX = 8;
const TR_MOVE_SLOTS = 4;
const trMoveDrag = {
  timer: null, pointerId: null,
  fromIdx: -1, overIdx: -1,
  startX: 0, startY: 0,
  offsetY: 0,         // 枠の中でつかんだ位置（枠上端からのY）
  slotH: 0,           // 1枠ぶんの移動量（高さ＋gap）
  baseTops: [],       // 各枠の元のtop（#tr-moves基準）
  active: false, el: null,
  justDragged: false, // ドラッグ直後のclick抑止
};

function trMoveDragReset() {
  clearTimeout(trMoveDrag.timer);
  trMoveDrag.timer = null;
  trMoveDrag.pointerId = null;
  trMoveDrag.active = false;
  trMoveDrag.el = null;
  trMoveDrag.fromIdx = -1;
  trMoveDrag.overIdx = -1;
  const box = $('tr-moves');
  box.classList.remove('reordering');
  box.querySelectorAll('.tr-move').forEach((n) => {
    n.classList.remove('lp-arming', 'lifting');
    n.style.transform = '';
    n.style.transition = '';
    n.style.zIndex = '';
  });
}

// 持ち上げ開始
function trMoveDragLift(slotEl, clientY) {
  const box = $('tr-moves');
  const slots = Array.from(box.querySelectorAll('.tr-move'));
  const boxRect = box.getBoundingClientRect();
  trMoveDrag.baseTops = slots.map((n) => n.getBoundingClientRect().top - boxRect.top);
  const r = slotEl.getBoundingClientRect();
  trMoveDrag.offsetY = clientY - r.top;
  // 1枠ぶんの移動量：隣の枠とのtop差（gapを含む）
  trMoveDrag.slotH = slots.length > 1 ? (trMoveDrag.baseTops[1] - trMoveDrag.baseTops[0]) : r.height;
  trMoveDrag.active = true;
  trMoveDrag.overIdx = trMoveDrag.fromIdx;
  slotEl.classList.remove('lp-arming');
  slotEl.classList.add('lifting');
  box.classList.add('reordering');
  try { if (navigator.vibrate) navigator.vibrate(18); } catch (e) {}
}

// ドラッグ中：持ち上げ枠を指に追従、落とし先の枠は持ち上げ枠の元の位置へ動く（入れ替えの予告）
function trMoveDragMove(clientY) {
  const box = $('tr-moves');
  const boxRect = box.getBoundingClientRect();
  const slots = Array.from(box.querySelectorAll('.tr-move'));
  const lift = trMoveDrag.el;
  if (!lift) return;
  const wantTop = clientY - boxRect.top - trMoveDrag.offsetY;
  const minTop = trMoveDrag.baseTops[0];
  const maxTop = trMoveDrag.baseTops[TR_MOVE_SLOTS - 1];
  const clampedTop = Math.max(minTop, Math.min(maxTop, wantTop));
  const dy = clampedTop - trMoveDrag.baseTops[trMoveDrag.fromIdx];
  lift.style.transform = `translateY(${dy}px) scale(1.04)`;

  let over = Math.round((clampedTop - minTop) / trMoveDrag.slotH);
  over = Math.max(0, Math.min(TR_MOVE_SLOTS - 1, over));
  trMoveDrag.overIdx = over;

  const from = trMoveDrag.fromIdx;
  slots.forEach((n, i) => {
    if (i === from) return;
    let shift = 0;
    if (i === over && over !== from) shift = trMoveDrag.baseTops[from] - trMoveDrag.baseTops[i];
    n.style.transform = shift ? `translateY(${shift}px)` : '';
  });
}

// 離した：入れ替えを確定して再描画
function trMoveDragDrop() {
  const from = trMoveDrag.fromIdx;
  const to = trMoveDrag.overIdx;
  const lift = trMoveDrag.el;
  const box = $('tr-moves');
  if (lift && from >= 0 && to >= 0 && from !== to) {
    // 持ち上げ枠を落とし先へスッと収めてから確定
    lift.style.transition = 'transform .16s cubic-bezier(.2,.8,.3,1), box-shadow .16s ease';
    lift.style.transform = `translateY(${trMoveDrag.baseTops[to] - trMoveDrag.baseTops[from]}px) scale(1)`;
    while (trMovesDraft.length < TR_MOVE_SLOTS) trMovesDraft.push(null);   // 空きスロットも対象にするため4枠ぶんそろえる
    const moved = trMovesDraft[from];
    trMovesDraft[from] = trMovesDraft[to] || null;
    trMovesDraft[to] = moved;
    trMoveDrag.justDragged = true;
    setTimeout(() => { trMoveDrag.justDragged = false; }, 250);
    setTimeout(() => { trMoveDragReset(); trRenderMovesAndTraits(trTarget); }, 170);
  } else {
    // 位置は変わらず：元の場所に戻す
    if (lift) {
      lift.style.transition = 'transform .16s cubic-bezier(.2,.8,.3,1), box-shadow .16s ease';
      lift.style.transform = '';
    }
    trMoveDrag.justDragged = trMoveDrag.active;
    setTimeout(() => { trMoveDrag.justDragged = false; }, 250);
    setTimeout(() => { trMoveDragReset(); }, 170);
  }
  box.classList.remove('reordering');
}

function trSetupMoveReorder() {
  const box = $('tr-moves');

  box.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const slotEl = e.target.closest('.tr-move');
    if (!slotEl) return;
    const idx = parseInt(slotEl.dataset.slot, 10);
    if (!trMovesDraft[idx]) return;               // 空のスロットは持ち上げ対象外（タップで技を覚えさせる）
    if (trMoveDrag.pointerId !== null) return;    // 多重タッチ防止
    trMoveDrag.pointerId = e.pointerId;
    trMoveDrag.fromIdx = idx;
    trMoveDrag.el = slotEl;
    trMoveDrag.startX = e.clientX;
    trMoveDrag.startY = e.clientY;
    trMoveDrag.active = false;
    slotEl.classList.add('lp-arming');
    clearTimeout(trMoveDrag.timer);
    trMoveDrag.timer = setTimeout(() => {
      if (trMoveDrag.pointerId === null || !trMoveDrag.el) return;
      try { box.setPointerCapture(trMoveDrag.pointerId); } catch (err) {}
      trMoveDragLift(trMoveDrag.el, trMoveDrag.startY);
    }, TR_LP_MS);
  });

  box.addEventListener('pointermove', (e) => {
    if (e.pointerId !== trMoveDrag.pointerId) return;
    if (!trMoveDrag.active) {
      // 長押し成立前に動いた＝タップ／スクロール意図なので中止
      if (Math.hypot(e.clientX - trMoveDrag.startX, e.clientY - trMoveDrag.startY) > TR_LP_CANCEL_PX) {
        trMoveDragReset();
      }
      return;
    }
    e.preventDefault();
    trMoveDragMove(e.clientY);
  });

  const end = (e) => {
    if (e.pointerId !== trMoveDrag.pointerId) return;
    try { box.releasePointerCapture(e.pointerId); } catch (err) {}
    if (trMoveDrag.active) trMoveDragDrop();
    else trMoveDragReset();   // 長押し前に離した＝通常タップ（clickは別ハンドラ）
  };
  box.addEventListener('pointerup', end);
  box.addEventListener('pointercancel', (e) => {
    if (e.pointerId !== trMoveDrag.pointerId) return;
    trMoveDragReset();
  });

  // 長押しでコンテキストメニューが出るのを防ぐ
  box.addEventListener('contextmenu', (e) => e.preventDefault());
}
trSetupMoveReorder();
$('tr-msel-close').addEventListener('click', closeMoveSelect);
$('tr-msel-ok').addEventListener('click', trConfirmMove);
$('tr-move-overlay').addEventListener('click', (e) => {
  if (e.target === $('tr-move-overlay')) closeMoveSelect();
  const item = e.target.closest('.tr-msel-item');
  if (item) trPickMove(parseInt(item.dataset.move, 10));
});

/* ---------------------------------------------------------
   型の保存／ロード（ボックス画面の「保存/ロード」ボタン）
   ・保存するのは「技構成・特性・性格・努力値」（sbSerializePoke と同じ形の一部）
   ・1種族につき最大 SB_PRESET_MAX(6) 個。種族ごとに別枠なので、別のポケモンの型は混ざらない
   ・localStorage は編成データとは別キー。ロードは押した時点でそのポケモンに反映して保存する
   --------------------------------------------------------- */
const SB_PRESET_KEY = 'pokeriere_serious_presets_v1';
const SB_PRESET_MAX = 6;
let sbPresetCache = null;    // { [speciesId]: [ slot0..slot5 ]（空きは null） }
let presetSpecies = null;    // いま開いているモーダルの対象個体

function sbPresetLoadAll() {
  if (sbPresetCache) return sbPresetCache;
  sbPresetCache = {};
  try {
    const raw = localStorage.getItem(SB_PRESET_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      if (data && typeof data === 'object') sbPresetCache = data;
    }
  } catch (e) { sbPresetCache = {}; }
  return sbPresetCache;
}
function sbPresetSaveAll() {
  try { localStorage.setItem(SB_PRESET_KEY, JSON.stringify(sbPresetCache || {})); }
  catch (e) { /* 容量超過・プライベートモードは黙って諦める */ }
}
// その種族の6スロット（必ず長さ6。壊れた要素は null に）
function sbPresetSlots(speciesId) {
  const all = sbPresetLoadAll();
  const arr = Array.isArray(all[speciesId]) ? all[speciesId] : [];
  const out = [];
  for (let i = 0; i < SB_PRESET_MAX; i++) {
    const d = arr[i];
    out.push(d && Array.isArray(d.mv) && d.mv.length > 0 ? d : null);
  }
  return out;
}
// 個体から型データを作る
function sbPresetFromPoke(p) {
  return {
    mv: p.moves.map((m) => m.id),
    ab: p.ability,
    na: p.nature,
    ev: SB_STAT_KEYS.map((k) => (p.evPoints && p.evPoints[k]) || 0),
  };
}
// 型データを個体へ適用（sbRestorePoke と同じ検証：存在する技・有効な特性・範囲内の性格・合計66以下の努力値）
function sbPresetApply(p, d) {
  const sp = p.species;
  const moves = (Array.isArray(d.mv) ? d.mv : []).map((id) => buildMoveObject(id)).filter(Boolean).slice(0, 4);
  if (moves.length > 0) p.moves = moves;
  if (Array.isArray(sp.abilities) ? sp.abilities.includes(d.ab) : d.ab === p.ability) p.ability = d.ab;
  const na = parseInt(d.na, 10);
  if (na >= 1 && na <= 25) p.nature = na;
  if (Array.isArray(d.ev)) {
    SB_STAT_KEYS.forEach((k, i) => {
      p.evPoints[k] = Math.max(0, Math.min(SB_EV_MAX, parseInt(d.ev[i], 10) || 0));
    });
    let over = SB_STAT_KEYS.reduce((sum, k) => sum + p.evPoints[k], 0) - SB_EV_TOTAL;
    for (let i = SB_STAT_KEYS.length - 1; i >= 0 && over > 0; i--) {
      const k = SB_STAT_KEYS[i]; const cut = Math.min(p.evPoints[k], over); p.evPoints[k] -= cut; over -= cut;
    }
  }
  sbRecalcStats(p);
}

function presetSlotHtml(d, i) {
  const head = `<span class="pn">${i + 1}</span>`;
  if (!d) {
    return `<div class="tr-pre-slot empty" data-i="${i}">
      ${head}
      <div class="pbody"><span class="pempty">（空き）</span></div>
      <div class="pbtns"><button type="button" class="pbtn save" data-act="save" data-i="${i}">保存</button></div>
    </div>`;
  }
  const moves = d.mv.map((id) => buildMoveObject(id)).filter(Boolean);
  const mvHtml = moves.map((m) => `<span class="pmv">${m.name}</span>`).join('');
  const ab = abilityJp(d.ab);
  const nat = trNatureText(parseInt(d.na, 10) || SB_FIXED_NATURE);
  const evText = SB_STAT_ROWS.map(([label, key], idx) => ({ label, v: parseInt((d.ev || [])[idx], 10) || 0 }))
    .filter((x) => x.v > 0).map((x) => `${x.label}${x.v}`).join(' ') || '努力値なし';
  return `<div class="tr-pre-slot" data-i="${i}">
    ${head}
    <div class="pbody">
      <div class="pmoves">${mvHtml}</div>
      <div class="pinfo"><span><b>特性</b>${ab}</span><span><b>性格</b>${nat}</span><span><b>努力値</b>${evText}</span></div>
    </div>
    <div class="pbtns">
      <button type="button" class="pbtn load" data-act="load" data-i="${i}">ロード</button>
      <button type="button" class="pbtn over" data-act="over" data-i="${i}">上書き</button>
      <button type="button" class="pbtn del${presetDelArmed === i ? ' armed' : ''}" data-act="del" data-i="${i}">${presetDelArmed === i ? 'もう一度' : '削除'}</button>
    </div>
  </div>`;
}

function presetRender() {
  if (!presetSpecies) return;
  const slots = sbPresetSlots(presetSpecies.speciesId);
  $('tr-pre-title').textContent = `${presetSpecies.species.name} の型 保存/ロード`;
  $('tr-pre-list').innerHTML = slots.map(presetSlotHtml).join('');
}
function presetToast(msg) {
  const t = $('tr-pre-toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(presetToast._tm);
  presetToast._tm = setTimeout(() => t.classList.remove('show'), 1400);
}

function openPresetModal() {
  const p = sbState.selected;
  if (!p) return;
  presetSpecies = p;
  presetDelArmed = -1;
  presetRender();
  $('tr-pre-overlay').classList.add('show');
}
function closePresetModal() {
  $('tr-pre-overlay').classList.remove('show');
  presetSpecies = null;
}

let presetDelArmed = -1;   // 削除の確認待ちになっているスロット（なければ -1）
function presetAction(act, i) {
  const p = presetSpecies;
  if (!p) return;
  if (act !== 'del') presetDelArmed = -1;
  const all = sbPresetLoadAll();
  const slots = sbPresetSlots(p.speciesId);
  if (act === 'save' || act === 'over') {
    slots[i] = sbPresetFromPoke(p);
    all[p.speciesId] = slots;
    sbPresetSaveAll();
    presetRender();
    presetToast(`スロット${i + 1}に保存しました`);
  } else if (act === 'load') {
    const d = slots[i];
    if (!d) return;
    sbPresetApply(p, d);
    sbSave();          // 編成データにも反映して保存
    sbRenderAll();     // 詳細パネルの技・特性・数値を更新
    presetToast(`スロット${i + 1}をロードしました`);
    closePresetModal();
  } else if (act === 'del') {
    if (presetDelArmed !== i) {
      // 1回目：確認状態にする（ボタンが「もう一度」に変わる）。他の操作をするか時間が経つと解除
      presetDelArmed = i;
      presetRender();
      clearTimeout(presetAction._tm);
      presetAction._tm = setTimeout(() => { presetDelArmed = -1; presetRender(); }, 2500);
      return;
    }
    presetDelArmed = -1;
    clearTimeout(presetAction._tm);
    slots[i] = null;
    all[p.speciesId] = slots;
    sbPresetSaveAll();
    presetRender();
    presetToast(`スロット${i + 1}を削除しました`);
  }
}

$('tr-pre-list').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-act]');
  if (btn) presetAction(btn.dataset.act, parseInt(btn.dataset.i, 10));
});
$('tr-pre-close').addEventListener('click', closePresetModal);
$('tr-pre-overlay').addEventListener('click', (e) => {
  if (e.target === $('tr-pre-overlay')) closePresetModal();
});

// ---- 画面の出入り ----
function trRenderAll() {
  trRenderHeader(trTarget);
  trRenderStats();
  trRenderMovesAndTraits(trTarget);
  trRenderMegaFormRow();
  trRenderAdjust();
}

function openTraining() {
  const p = sbState.selected;
  if (!p) return;                          // 選択中の個体がいなければ何もしない
  trTarget = p;
  trDraft = {};
  SB_STAT_KEYS.forEach((k) => { trDraft[k] = Math.max(0, Math.min(TR_EV_MAX, (p.evPoints && p.evPoints[k]) || 0)); });
  // 保存データが合計超過でも、開いた時点で66に収める（後ろの能力から削る）
  let over = trSum(trDraft) - TR_EV_TOTAL;
  for (let i = SB_STAT_KEYS.length - 1; i >= 0 && over > 0; i--) {
    const k = SB_STAT_KEYS[i]; const cut = Math.min(trDraft[k], over); trDraft[k] -= cut; over -= cut;
  }
  trNatureDraft = p.nature;                // 能力補正（性格）・特性も作業用コピーで編集する
  trAbilityDraft = p.ability;
  trMovesDraft = p.moves.slice(0, 4);      // 技も作業用コピー（確定するまで実個体には反映しない）
  trMegaFormDraft = hasMultiMegaForms(p) ? (p.megaForm === 'Y' ? 'Y' : 'X') : null;
  trMegaViewActive = false;                // 開くたびに通常表示から始める
  trSel = null;
  trBuildSparkles();
  trRenderAll();
  showScreen('training');
}

function closeTraining(commit) {
  trHoldStop();
  if (commit === true && trTarget && trDraft) {
    SB_STAT_KEYS.forEach((k) => { trTarget.evPoints[k] = trDraft[k]; });
    trTarget.nature = trNatureDraft;
    trTarget.ability = trAbilityDraft;
    trTarget.moves = trMovesDraft.filter(Boolean);
    if (trMegaFormDraft) trTarget.megaForm = trMegaFormDraft;
    sbRecalcStats(trTarget);
    sbSave();                              // 努力値・能力補正・特性が保存される
  }
  trSel = null;
  $('tr-adjust').classList.remove('show');
  closeNatureSelect();
  closeAbilitySelect();
  closeMoveSelect();
  trTarget = null; trDraft = null; trNatureDraft = null; trAbilityDraft = null; trMovesDraft = []; trMegaFormDraft = null;
  trMegaViewActive = false;
  showScreen('serious');
  sbRenderAll();
}

$('tr-btn-back').addEventListener('click', () => closeTraining(false));     // もどる = 破棄
$('tr-btn-ok').addEventListener('click', () => closeTraining(true));        // けってい = 確定して保存
$('tr-adj-close').addEventListener('click', () => trSelect(trSel));
trBindHold('tr-adj-m1', -1);
trBindHold('tr-adj-p1', +1);
trBindHold('tr-adj-m10', -10);
trBindHold('tr-adj-p10', +10);
trBindSlider();
trBindRows();
window.addEventListener('resize', () => { if (trSel) trPlaceAdjust(); });

// ボックス画面の詳細パネルなどでも同じアイコンを使えるよう、キー→SVGを引けるようにする
const TR_STAT_ICON = {};
TR_STAT_ROWS.forEach(([label, key, svg]) => { TR_STAT_ICON[key] = svg; });
