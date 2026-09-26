'use strict';
/* =========================================================
   Pokedrock Battle Factory - Battle Engine
   本家ポケモンのバトルルールに準拠したバトルエンジン。
   GAME_DATA (gamedata.js) の種族値・技データ・タイプ相性・特性名を用いる。
   ========================================================= */

const NATURE_TABLE = {
  // id: [増加ステータス, 減少ステータス]  stat keys: atk, def, spa, spd, spe (null=無補正)
  1:  ['spe', 'def'], 2:  ['spd', 'def'], 3:  ['def', 'spd'], 4:  ['spa', 'spe'],
  5:  ['def', 'spe'], 6:  ['spa', 'def'], 7:  ['atk', 'spe'], 8:  [null, null],
  9:  ['spe', 'atk'], 10: [null, null],   11: ['def', 'spa'], 12: ['spd', 'spa'],
  13: ['spd', 'spe'], 14: ['spa', 'atk'], 15: ['spd', 'atk'], 16: ['spe', 'spa'],
  17: [null, null],   18: ['atk', 'def'], 19: ['def', 'atk'], 20: [null, null],
  21: ['spa', 'spd'], 22: ['atk', 'spa'], 23: ['spe', 'spd'], 24: ['atk', 'spd'],
};

// 性格の固有名（本家準拠）。無補正性格(8,10,17,20,25)は「まじめ／すなお／てれや／がんばりや／きまぐれ」。
// 25はNATURE_TABLEに無いID＝無補正扱い（トレーニング画面のグリッドで「対角」に使う）。
const NATURE_NAME = {
  1: 'せっかち', 2: 'おとなしい', 3: 'のうてんき', 4: 'れいせい', 5: 'のんき',
  6: 'おっとり', 7: 'ゆうかん', 8: 'まじめ', 9: 'おくびょう', 10: 'すなお',
  11: 'わんぱく', 12: 'しんちょう', 13: 'なまいき', 14: 'ひかえめ', 15: 'おだやか',
  16: 'ようき', 17: 'てれや', 18: 'さみしがり', 19: 'ずぶとい', 20: 'がんばりや',
  21: 'うっかりや', 22: 'いじっぱり', 23: 'むじゃき', 24: 'やんちゃ', 25: 'きまぐれ',
};
function natureName(natureId) {
  return NATURE_NAME[natureId] || 'まじめ';
}
// 5x5グリッド用：[上昇ステータスキー, 下降ステータスキー] から性格IDを引く。
// 対角（上昇=下降）は無補正の5性格を1つずつ順番に割り当てる。
const NATURE_GRID_ORDER = ['atk', 'def', 'spa', 'spd', 'spe'];
const NATURE_GRID_LABEL = { atk: 'こうげき', def: 'ぼうぎょ', spa: 'とくこう', spd: 'とくぼう', spe: 'すばやさ' };
const NATURE_NEUTRAL_IDS = [8, 10, 17, 20, 25]; // 対角に上から順に割り当てる
function natureIdForGrid(upKey, downKey) {
  if (upKey === downKey) {
    const i = NATURE_GRID_ORDER.indexOf(upKey);
    return NATURE_NEUTRAL_IDS[i] || 25;
  }
  for (const idStr in NATURE_TABLE) {
    const [u, d] = NATURE_TABLE[idStr];
    if (u === upKey && d === downKey) return parseInt(idStr, 10);
  }
  return 25;
}

const STATUS = {
  NONE: 0, PARALYZE: 1, BURN: 2, POISON: 3, BADLY_POISON: 4,
  SLEEP: 5, FREEZE: 7, CONFUSE: 8,
};
const STATUS_JP = {
  1: 'まひ', 2: 'やけど', 3: 'どく', 4: 'もうどく', 5: 'ねむり', 7: 'こおり', 8: 'こんらん',
};

function typeJp(key) {
  if (!key) return '';
  return (GAME_DATA.typeKeyToJp && GAME_DATA.typeKeyToJp[key]) || key;
}

function abilityJp(id) {
  return (GAME_DATA.abilityNames && GAME_DATA.abilityNames[id]) || ('特性' + id);
}

function rand(min, max) { // inclusive
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// ---- 個体生成 (getpokemon方式) ----
// BOSS_ONLY_SPECIES_IDS（ID:1011=メガなしボス「MPLの首領」、ID:1014=メガありボス、
// ID:1031=チーム戦10連勝ごとのボス）は
// ボス専用のポケモンなので、3匹・6匹の手持ち生成や交換候補など、
// 通常のランダム抽選には絶対に含めない。
const BOSS_ONLY_SPECIES_IDS = [1011, 1014, 1031];
const BOSS_ONLY_SPECIES_ID = BOSS_ONLY_SPECIES_IDS[0]; // 後方互換用（メガなしボスID）

// ---- 乱入ボス（メガありNPC戦の3〜5戦目のどれか1戦で、3匹目として乱入してくるポケモン） ----
// 通常の抽選プールにも入りうる種族なので BOSS_ONLY_SPECIES_IDS とは別に管理する。
// 乱入ボスを倒すと、実績「intrusion_<ID>」が解除され（achievements.js）、
// 以後そのポケモンは乱入ボスとして二度と登場しない。
// 1032〜1041は「隠しポケモン」（HIDDEN_SPECIES_ACHIEVEMENT）でもあり、対応する実績を
// 解除するまで通常のボックス・NPC戦・6匹選出には一切出ないが、乱入ボスとしては
// （隠しポケモンの実績が未解除でも）サプライズ的にNPCの3匹目として登場する。
// 乱入で倒された場合は他の乱入ボスと全く同じ扱い＝intrusion_実績解除・メガ解放候補・以後乱入に出ない。
const INTRUSION_BOSS_IDS = [
  171, 32,36, 91, 322, 347, 360, 1009, 1023, 1024, 1025, 1026, 476, 1030,
  1032, 1034, 1037, 1038, 1039,1054,1057,
];
function intrusionAchievementId(speciesId) { return 'intrusion_' + speciesId; }

// ---- 乱入ボスのメガシンカ解放 ----
// 乱入ボスを倒して実績を解除しただけではメガシンカは使えない。
// 実績画面（または図鑑のロック）でタップして初めて「解放」される（localStorageに保存）。
// 解放されるまでは、プレイヤーはメガシンカのアイコン/ボタン/プレビューが出ず、
// NPCも（乱入で3匹目に出てくる場合を除き）そのメガシンカを使わない。
const MEGA_UNLOCK_STORAGE_KEY = 'pokeriere_mega_unlocked_v1';
let _megaUnlockedSet = null;
function _loadMegaUnlocked() {
  if (_megaUnlockedSet) return _megaUnlockedSet;
  _megaUnlockedSet = new Set();
  try {
    const arr = JSON.parse(localStorage.getItem(MEGA_UNLOCK_STORAGE_KEY));
    if (Array.isArray(arr)) arr.forEach((n) => _megaUnlockedSet.add(Number(n)));
  } catch (e) {}
  return _megaUnlockedSet;
}
function _saveMegaUnlocked() {
  try { localStorage.setItem(MEGA_UNLOCK_STORAGE_KEY, JSON.stringify([..._megaUnlockedSet])); } catch (e) {}
}
// この種族のメガシンカが「ロック対象」（＝乱入ボス11体のどれか）かどうか。
function isMegaLockable(speciesId) { return INTRUSION_BOSS_IDS.includes(Number(speciesId)); }
// ロックを適用するか。NPC戦だけに適用し、対人戦では常にロックなし（＝従来どおり）。
// ui.js が対戦の種類に応じて切り替える（NPC戦の開始時に true、対人戦の選出開始時に false）。
let megaLockActive = true;
function setMegaLockActive(active) { megaLockActive = !!active; }
// この種族のメガシンカが解放済みか。ロック対象でない種族は最初から常に解放済み扱い。
// （図鑑・実績の表示用。対人戦フラグの影響は受けない）
function isMegaUnlocked(speciesId) {
  if (!isMegaLockable(speciesId)) return true;
  return _loadMegaUnlocked().has(Number(speciesId));
}
// バトル・選出中の判定用：対人戦ではロックを無視して常に使える。
function isMegaUsableInBattle(speciesId) {
  if (!megaLockActive) return true;
  return isMegaUnlocked(speciesId);
}
// 実績が解除済みで、まだ解放していない（＝タップすれば解放できる）か。
function canUnlockMega(speciesId) {
  return isMegaLockable(speciesId) && !isMegaUnlocked(speciesId) &&
    !!(window.Achievements && window.Achievements.isUnlocked(intrusionAchievementId(speciesId)));
}
// 解放する。実績が未解除なら何もしない。新たに解放できたら true。
function unlockMega(speciesId) {
  if (!canUnlockMega(speciesId)) return false;
  _loadMegaUnlocked().add(Number(speciesId));
  _saveMegaUnlocked();
  return true;
}
// 実績リセット用：解放状態をすべて消す。
function resetMegaUnlocks() {
  _megaUnlockedSet = new Set();
  _saveMegaUnlocked();
}

// ---- 隠しポケモン（種族そのものが実績解除まで完全に隠されている特別枠） ----
// 通常の抽選プール（getFinalSpeciesIds）には、対応する実績が解除されるまで一切含めない。
// 図鑑には枠だけ存在し、中身は「？？？」＋🔒で伏せられる（乱入ボスのメガロックと同じ見た目）。
// 実績が解除された瞬間に自動でロックが外れ、以後はボックス・ランダム戦・NPC戦すべてに登場する。
// 新しい隠しポケモンを増やす場合は、HIDDEN_SPECIES_ACHIEVEMENT にID→実績IDの対応を追記するだけでよい。
//
// 【1032〜1041について】
// この10体は「実績解除まで隠しポケモン」かつ「乱入ボスとしてはサプライズで登場する」特別枠として
// INTRUSION_BOSS_IDS（乱入候補）には既に追加済み。
// 1033のみ pokedex_100 で解放される設定済み。残り9体（1032,1034〜1041）は
// まだここに登録していないため、現状は「隠しポケモンではない」＝通常のボックス・NPC戦・
// 6匹選出プールにも普通に出てしまう状態。1体ずつ隠しポケモン化したい場合は、
// 下の対応表に  1032: '実績id',  のように1行追記するだけでよい（実績idはachievements.js
// のACHIEVEMENTS配列にあるidの文字列と一致させること）。乱入ボスとしての登場・撃破時の
// 実績解除（intrusion_1032など）・メガ解放は INTRUSION_BOSS_IDS に入っているため
// このオブジェクトへの追記状況に関わらず既に有効。
// ---- シークレットコードで解放する隠しポケモン ----
// HIDDEN_SPECIES_ACHIEVEMENT（実績で解放）とは別に、ホーム画面右上⚙️の
// ID入力欄に特定のシークレットコードを入力すると解放される隠しポケモン枠。
// 実績と同じく、解放するまでは通常の抽選プール（getFinalSpeciesIds）に含まれず、
// トレーナー（NPC）も使ってこず、図鑑ボックスにも「？？？」＋🔒でしか表示されない。
// 新しいコード解放ポケモンを増やす場合は、HIDDEN_SPECIES_SECRET_CODE に
// ID→コード文字列の対応を追記するだけでよい（コードは大文字小文字を区別しない）。
const HIDDEN_SPECIES_SECRET_CODE = {
  1057: 'OR1GAM1TUK1',
};
const HIDDEN_SPECIES_SECRET_CODE_STORAGE_KEY = 'pokeriere_secret_code_unlocked_v1';
let _secretCodeUnlockedSet = null;
function _loadSecretCodeUnlocked() {
  if (_secretCodeUnlockedSet) return _secretCodeUnlockedSet;
  _secretCodeUnlockedSet = new Set();
  try {
    const arr = JSON.parse(localStorage.getItem(HIDDEN_SPECIES_SECRET_CODE_STORAGE_KEY));
    if (Array.isArray(arr)) arr.forEach((n) => _secretCodeUnlockedSet.add(Number(n)));
  } catch (e) {}
  return _secretCodeUnlockedSet;
}
function _saveSecretCodeUnlocked() {
  try { localStorage.setItem(HIDDEN_SPECIES_SECRET_CODE_STORAGE_KEY, JSON.stringify([..._secretCodeUnlockedSet])); } catch (e) {}
}
// 入力された文字列が、コード解放対象のいずれかのコードと一致するか判定し、
// 一致すればそのポケモンを解放してtrueを返す（一致しなければfalseを返す）。
// 大文字小文字は区別しない。
function tryUnlockHiddenSpeciesByCode(inputValue) {
  const normalized = String(inputValue || '').trim().toUpperCase();
  if (!normalized) return false;
  for (const idStr of Object.keys(HIDDEN_SPECIES_SECRET_CODE)) {
    const id = Number(idStr);
    const code = String(HIDDEN_SPECIES_SECRET_CODE[idStr]).toUpperCase();
    if (normalized === code) {
      _loadSecretCodeUnlocked().add(id);
      _saveSecretCodeUnlocked();
      return true;
    }
  }
  return false;
}
function isHiddenSpeciesUnlockedBySecretCode(speciesId) {
  return _loadSecretCodeUnlocked().has(Number(speciesId));
}

const HIDDEN_SPECIES_ACHIEVEMENT = {
  2000: 'win_streak_team_11', // アリアスカル：チーム戦10連勝目のボスを倒すと解放
  1032: 'pokedex_150', 
  1033: 'type_streak_fire',
1034: 'type_streak_normal',
1035: 'type_streak_bug',
1030: 'type_streak_dragon',
1051: 'type_streak_electric',
1052: 'type_streak_fairy',
1053: 'type_streak_fighting',
1036: 'type_streak_flying',
1037: 'type_streak_dark',
1038: 'type_streak_psychic',
1039: 'type_streak_grass',
1054: 'type_streak_ground',
1025: 'type_streak_ice',
1055: 'type_streak_water',
1056: 'type_streak_sound',
1040: 'type_streak_rock',
1041: 'type_streak_ghost',
1990: 'type_streak_poison',
1026: 'type_streak_shine',
1024: 'type_streak_steel',
};
const HIDDEN_SPECIES_IDS = Object.keys(HIDDEN_SPECIES_ACHIEVEMENT).map(Number)
  .concat(Object.keys(HIDDEN_SPECIES_SECRET_CODE).map(Number));
function isHiddenSpecies(speciesId) { return HIDDEN_SPECIES_IDS.includes(Number(speciesId)); }
// 対応する実績が解除済み、またはシークレットコードが入力済みなら「解放済み」。
// 隠しポケモンでない種族は常に解放済み扱い。
function isHiddenSpeciesUnlocked(speciesId) {
  if (!isHiddenSpecies(speciesId)) return true;
  const id = Number(speciesId);
  if (Object.prototype.hasOwnProperty.call(HIDDEN_SPECIES_SECRET_CODE, id)) {
    return isHiddenSpeciesUnlockedBySecretCode(id);
  }
  const achvId = HIDDEN_SPECIES_ACHIEVEMENT[id];
  return !!(window.Achievements && window.Achievements.isUnlocked(achvId));
}
// まだ倒していない（＝乱入候補に残っている）乱入ボスのID一覧を返す。
function getRemainingIntrusionBossIds() {
  return INTRUSION_BOSS_IDS.filter((id) => {
    if (!GAME_DATA.species[id]) return false; // データに存在しないIDは候補にしない
    return !(window.Achievements && window.Achievements.isUnlocked(intrusionAchievementId(id)));
  });
}

// ---- タイプ縛り連勝（NPCチームバトルで6匹全員が同じタイプ1本の編成のまま連勝する実績） ----
// タイプごとに現在の連勝数をlocalStorageで保持する。1敗、またはチーム戦以外・縛り崩れで即0にリセット。
// 新しいタイプを対象に加える場合は achievements.js の TYPE_STREAK_TARGET_TYPES に追記するだけでよく、
// こちらのロジック側は変更不要（対象タイプは自動的に実績一覧から拾う）。
const TYPE_STREAK_GOAL = 5;
const TYPE_STREAK_STORAGE_KEY = 'pokeriere_type_streak_v1';
const TypeStreak = (() => {
  let streaks = {}; // { [typeName]: number }

  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(TYPE_STREAK_STORAGE_KEY));
      if (raw && typeof raw === 'object') streaks = raw;
    } catch (e) { streaks = {}; }
  }
  function save() {
    try { localStorage.setItem(TYPE_STREAK_STORAGE_KEY, JSON.stringify(streaks)); } catch (e) {}
  }
  function get(type) { return streaks[type] || 0; }

  // このバトルで実績対象になっているタイプの一覧（achievements.js側の定義から取得）。
  function targetTypes() {
    try {
      if (window.Achievements && typeof window.Achievements.typeStreakTargetTypes === 'function') {
        return window.Achievements.typeStreakTargetTypes();
      }
    } catch (e) {}
    return [];
  }
  // 6匹のパーティが、指定タイプ1本で統一されているか
  // （type1かtype2のどちらかにそのタイプを持てばOK、全員がそのタイプを持っていること）。
  // 判定は必ず「素のフォーム」の種族データ（GAME_DATA.species[speciesId]）で行う。
  // p.species はバトル中にメガシンカが発動すると type1/type2 ごとメガ後の姿へ書き換わるため、
  // そのまま使うと「メガ後にタイプが変わるポケモン（例：じめん→あく）」を編成した時に、
  // 発動したかどうかでこの試合の判定がぶれてしまう。編成時点の素のタイプで固定して統一を判定する。
  function isPartyOfType(team, type) {
    if (!Array.isArray(team) || team.length < 6) return false;
    return team.every((p) => {
      const sp = p && GAME_DATA.species[p.speciesId];
      if (!sp) return false;
      return sp.type1 === type || sp.type2 === type;
    });
  }

  // バトル結果を反映する。isTeamBattle=falseなら全タイプの連勝を0にリセットするだけ。
  // 勝利時は、パーティがそのタイプで統一されていたタイプだけ+1し、それ以外のタイプは0にリセットする。
  // 敗北時はすべて0にリセットする。達成（goal到達）したタイプがあれば実績を解除する。
  function reportResult(isTeamBattle, playerWon, team) {
    load();
    const types = targetTypes();
    if (!isTeamBattle || !playerWon) {
      types.forEach((type) => { streaks[type] = 0; });
      save();
      return;
    }
    types.forEach((type) => {
      if (isPartyOfType(team, type)) {
        streaks[type] = (streaks[type] || 0) + 1;
        if (streaks[type] >= TYPE_STREAK_GOAL && window.Achievements) {
          window.Achievements.unlock('type_streak_' + type);
        }
      } else {
        streaks[type] = 0;
      }
    });
    save();
  }

  load();
  return { get, reportResult };
})();

// ========================================================================
// 図鑑の並び順（自分で好きに並べ替えられるリスト）
// ・ここに書いた「種族ID」の順番が、そのまま図鑑の並び（No.1, No.2, ...）になる。
// ・リストに書いていないIDは、リストの後ろにID順で自動的に並ぶ（消えない）。
// ・並べ替えたいときは、行ごと上下に移動するだけでOK（行末の // は名前のメモ）。
// ========================================================================
const POKEDEX_CUSTOM_ORDER = [
// ▼ 本家(全国図鑑)の番号順。同じ番号の別個体(キュウコン/ストリンダー/ルガルガン)は連続して並ぶ。
  468, // No.003 フシギバナ
  6, // No.006 リザードン
  471, // No.009 カメックス
  222, // No.012 バタフリー
  15, // No.015 スピアー
  18, // No.018 ピジョット
  22, // No.022 オニドリル
  491, // No.024 アーボック
  50, // No.026 ライチュウ
  569, // No.028 サンドパン
  404, // No.034 ニドキング
  204, // No.036 ピクシー
  85, // No.038 キュウコン
  449, // No.038 キュウコン
  110, // No.040 プクリン
  248, // No.045 ラフレシア
  447, // No.047 パラセクト
  230, // No.051 ダグトリオ
  493, // No.055 ゴルダック
  27, // No.059 ウインディ
  339, // No.062 ニョロボン
  100, // No.065 フーディン
  119, // No.068 カイリキー
  151, // No.071 ウツボット
  83, // No.073 ドククラゲ
  137, // No.076 ゴローニャ
  476, // No.078 ギャロップ
  451, // No.080 ヤドラン
  40, // No.083 カモネギ
  478, // No.085 ドードリオ
  177, // No.087 ジュゴン
  571, // No.089 ベトベトン
  87, // No.091 パルシェン
  228, // No.094 ゲンガー
  406, // No.099 キングラー
  495, // No.101 マルマイン
  293, // No.106 サワムラー
  294, // No.107 エビワラー
  188, // No.115 ガルーラ
  153, // No.119 アズマオウ
  73, // No.121 スターミー
  479, // No.122 バリヤード
  352, // No.127 カイロス
  60, // No.130 ギャラドス
  74, // No.131 ラプラス
  104, // No.134 シャワーズ
  105, // No.135 サンダース
  106, // No.136 ブースター
  207, // No.142 プテラ
  216, // No.143 カビゴン
  81, // No.149 カイリュー
  1027, // No.154 メガニウム
  1028, // No.160 オーダイル
  262, // No.162 オオタチ
  11, // No.166 レディアン
  58, // No.168 アリアドス
  142, // No.169 クロバット
  78, // No.171 ランターン
  397, // No.178 ネイティオ
  1015, // No.181 デンリュウ
  249, // No.182 キレイハナ
  277, // No.184 マリルリ
  496, // No.185 ウソッキー
  340, // No.186 ニョロトノ
  30, // No.189 ワタッコ
  377, // No.196 エーフィ
  378, // No.197 ブラッキー
  498, // No.202 ソーナンス
  481, // No.205 フォレトス
  123, // No.208 ハガネール
  174, // No.212 ハッサム
  12, // No.214 ヘラクロス
  54, // No.219 マグカルゴ
  372, // No.224 オクタン
  499, // No.225 デリバード
  76, // No.226 マンタイン
  43, // No.227 エアームド
  56, // No.229 ヘルガー
  25, // No.230 キングドラ
  129, // No.232 ドンファン
  502, // No.241 ミルタンク
  573, // No.242 ハピナス
  97, // No.248 バンギラス
  1016, // No.254 ジュカイン
  1017, // No.257 バシャーモ
  9, // No.260 ラグラージ
  287, // No.264 マッスグマ
  156, // No.272 ルンパッパ
  159, // No.275 ダーテング
  264, // No.277 オオスバメ
  206, // No.279 ぺリッパー
  161, // No.284 アメモース
  163, // No.286 キノガッサ
  260, // No.297 ハリテヤマ
  399, // No.301 エネコロロ
  505, // No.302 ヤミラミ
  291, // No.303 クチート
  239, // No.306 ボスゴドラ
  577, // No.310 ライボルト
  482, // No.311 プラスル
  483, // No.312 マイナン
  186, // No.313 バルビート
  187, // No.314 イルミーゼ
  102, // No.319 サメハダー
  48, // No.323 バクーダ
  42, // No.324 コータス
  1044,
  165, // No.326 ブーピッグ
  390, // No.330 フライゴン
  344, // No.334 チルタリス
  166, // No.337 ルナトーン
  167, // No.338 ソルロック
  376, // No.340 ナマズン
  258, // No.344 ネンドール
  242, // No.354 ジュペッタ
  506, // No.357 トロピウス
  296, // No.358 チリーン
  41, // No.359 アブソル
  363, // No.362 オニゴーリ
  146, // No.369 ジーランス
  317, // No.373 ボーマンダ
  456, // No.376 メタグロス
  215, // No.398 ムクホーク
  32, // No.407 ロズレイド
  331, // No.416 ビークイン
  508, // No.426 フワライド
  366, // No.428 ミミロップ
  575, // No.429 ムウマージ
  148, // No.430 ドンカラス
  510, // No.437 ドータクン
  240, // No.442 ミカルゲ
  329, // No.445 ガブリアス
  303, // No.450 カバルドン
  582, // No.452 ドラピオン
  354, // No.454 ドクロッグ
  511, // No.455 マスキッパ
  579, // ネガチェリム
  580, // ポジチェリム
  408, // No.457 ネオラント
  351, // No.460 ユキノオー
  91, // No.461 マニューラ
  66, // No.463 ベロベルト
  145, // No.464 ドサイドン
  453, // No.466 エレキブル
  46, // No.468 トゲキッス
  1045,
  435, // No.470 リーフィア
  436, // No.471 グレイシア
  139, // No.472 グライオン
  39, // No.473 マンムー
  233, // No.474 ポリゴンZ
  504, // No.476 ダイノーズ
  285, // No.477 ヨノワール
  364, // No.478 ユキメノコ
  181, // Hロトム
  182, // Wロトム
  183, // Fロトム
  184, // Kロトム
  185, // Pロトム
  1029, // No.500 エンブオー
  20, // No.505 ミルホッグ
  584, // No.510 レパルダス
  191, // No.512 ヤナッキー
  193, // No.514 バオッキー
  195, // No.516 ヒヤッキー
  513, // No.530 ドリュウズ
  585, // No.531 タブンネ
  516, // No.534 ローブシン
  367, // No.538 ナゲキ
  368, // No.539 ダゲキ
  325, // No.545 ペンドラー
  298, // No.547 エルフーン
  562, // No.549 ドレディア
  236, // No.553 ワルビアル
  209, // No.558 イワパレス
  1019, // No.560 ズルズキン
  71, // No.561 シンボラー
  485, // No.571 ゾロアーク
  266, // No.573 チラチーノ
  290, // No.584 バイバニラ
  197, // No.589 シュバルゴ
  217, // No.594 ママンボウ
  587, // No.596 デンチュラ
  219, // No.598 ナットレイ
  347, // No.601 ギギギアル
  1018, // No.604 シビルドン
  309, // No.609 シャンデラ
  134, // No.612 オノノクス
  326, // No.615 フリージオ
  199, // No.617 アギルダー
  588, // No.618 マッギョ
  279, // No.620 コジョンド
  441, // No.621 クリムガン
  1020, // No.623 ゴルーグ
  517, // No.626 バッフロン
  120, // No.631 クイタラン
  121, // No.632 アイアント
  245, // No.635 サザンドラ
  108, // No.637 ウルガモス
  381, // No.652 ブリガロン
  384, // No.655 マフォクシー
  387, // No.658 ゲッコウガ
  282, // No.663 ファイアロー
  268, // No.668 カエンジシ
  36, // No.673 ゴーゴート
  401, // No.675 ゴロンダ
  201, // トリミアンJ
  202, // トリミアンR
  270, // No.678 ニャオニクス
  113, // No.681 ギルガルド
  311, // No.683 フレフワン
  313, // No.685 ペロリーム
  356, // No.687 カラマネロ
  358, // No.689 ガメノデス
  89, // No.691 ドラミドロ
  360, // No.693 ブロスター
  272, // No.697 ガチゴラス
  274, // No.699 アマルルガ
  437, // No.700 ニンフィア
  256, // No.701 ルチャブル
  301, // No.706 ヌメルゴン
  361, // No.707 クレッフィ
  336, // No.709 オーロット
  125, // No.713 クレベース
  322, // No.715 オンバーン
  1042,
  1043,
  528, // No.730 アシレーヌ
  1021, // No.740 ケケンカニ
  592, // No.745 ルガルガン
  593, // No.745 ルガルガン
  1012, // No.746 ヨワシ
  549, // No.768 グソクムシャ
  1046,
  458, // No.832 バイウールー
  179, // No.834 カジリガメ
  115, // No.849 ストリンダー
  116, // No.849 ストリンダー
  169, // No.863 ニャイキング
  52, // Gマタドガス
  1047,
  68, // No.869 マホイップ
  189, // No.870 タイレーツ
  590, // No.873 モスノウ
  131, // Hウォーグル
563, // Hドレディア
  175, // バサギリ
  501, // アヤシシ
474, // ラウドボーン
172, // グレンアルマ
171, // ソウブレイズ
62, // スコヴィラン
461, // デカヌチャン
525, // キラキラフロル
523, // カラミンゴ
127, // ハルクジラ
94, // コノヨザル
225, // リキキリン
70, // ノココッチ
212, // ドドゲザン
464, // セグレイブ
522, // ブリジュラス
520, // カミツオロチ
1053,
1055,
1034, // ムラノサヤ
601, // ホンタイアメ
  602, // キャンリング
  1048,
1000, // テンノチシキ
251, // ティアラブカ
  598, // クマフィア
  600, // アルタオーロ
  1049,
1033, // センノガハラ
1001, // フレカリス
1032, // トウリュウガ
1036, // アンロウジ
596, // メイデナー
1007, // ムルルイン
1035, // ゴキブリュレ
1050,
  17, // クシャムシャ
  254, // プラナイト
  255, // プラレイド
  486, // メロフライ
557, // ザーキデザ
595, // ルビカンテ
  3, // オウカドス  
  306, // ミラガラガラ
  320, // プライアス
  333, // ディアドレス
  342, // ミラタウロス
  349, // ウラリオ
  373, // メググース
  374, // ルリネーク
  410, // スノヒメ
  411, // メヒノス
  489, // エクレール
603, // リミナルコア
  604, // ネハンジョウ
  1002, // ゴウエモン
1008, // ウランデス
  1009, // ヴァニクト
  1010, // メルホリデー
  1023, // アレイヤード
1025, // ラプルゴン
1004, // ウィンダール
  1005, // レツタイナ
  1006, // アルトマーレ
1054,
1003, // エンゲイジ
  1024, // モッタイナ
  1030, // セイリュウ
  1026, // アズリエル
1013, // メグルリヒメ
  1037, // ヤムヲエン
  1038, // シカタナシ
  1039, // ウルマイカ
  1040, // マーバラス
  1041, // ジュオン
1051,
1052,
1056,
1057,
  1990, // ウーズメルス
  2000, // アリアスカル
];

// 与えられた種族IDの配列を、POKEDEX_CUSTOM_ORDER の順に並べ替えて返す（元の配列は変更しない）。
// リストに無いIDは末尾にID順で並べる。
function sortByPokedexOrder(ids) {
  const pos = new Map();
  POKEDEX_CUSTOM_ORDER.forEach((id, i) => { if (!pos.has(id)) pos.set(id, i); });
  return ids.slice().sort((a, b) => {
    const pa = pos.has(a) ? pos.get(a) : 1000000 + a;
    const pb = pos.has(b) ? pos.get(b) : 1000000 + b;
    return pa - pb;
  });
}

// 選出・ボックス・ランダム戦などの「実際に登場しうる」プール。
// ボス専用種族に加えて、実績未解除の隠しポケモンもここでは除外する。
function getFinalSpeciesIds() {
  const ids = [];
  for (const key in GAME_DATA.species) {
    const sp = GAME_DATA.species[key];
    if (BOSS_ONLY_SPECIES_IDS.includes(sp.id)) continue;
    if (isHiddenSpecies(sp.id) && !isHiddenSpeciesUnlocked(sp.id)) continue;
    if (!sp.evolutions || sp.evolutions.length === 0) ids.push(sp.id);
  }
  return ids;
}

// 図鑑表示専用：隠しポケモンも実績未解除のままロック枠として一覧に含める
// （中身は伏せるが、存在する枠自体は表示したいため）。
function getFinalSpeciesIdsForPokedex() {
  const ids = [];
  for (const key in GAME_DATA.species) {
    const sp = GAME_DATA.species[key];
    if (BOSS_ONLY_SPECIES_IDS.includes(sp.id)) continue;
    if (!sp.evolutions || sp.evolutions.length === 0) ids.push(sp.id);
  }
  return ids;
}

function randomEvSpread(total, maxPerStat) {
  for (let attempt = 0; attempt < 1000; attempt++) {
    const cuts = [];
    for (let n = 0; n < 5; n++) cuts.push(rand(0, total));
    cuts.sort((a, b) => a - b);
    const bounds = [0, ...cuts, total];
    const evs = [];
    let overLimit = false;
    for (let n = 0; n < 6; n++) {
      const v = bounds[n + 1] - bounds[n];
      if (v > maxPerStat) { overLimit = true; break; }
      evs.push(v);
    }
    if (!overLimit) return evs;
  }
  const fb = [0, 0, 0, 0, 0, 0];
  let remaining = total;
  while (remaining > 0) {
    const idx = rand(0, 5);
    if (fb[idx] < maxPerStat) { fb[idx]++; remaining--; }
  }
  return fb;
}

function levelUpMoveIds(species) {
  const ids = [];
  for (const [lv, moveId] of species.levelMoves) {
    if (moveId !== undefined && !ids.includes(moveId)) ids.push(moveId);
  }
  return ids;
}

// 技IDから、バトル中に使う技オブジェクトを生成する共通ヘルパー。
// createPokemon（初期生成）とランダムアクト（ターン終了時の技総入れ替え）の両方から使う。
// 対人戦のゲスト側（net.js の deserializePokeFromNet）も同じ形のオブジェクトを作るため、
// フィールドを追加する場合は両方をそろえること。
function buildMoveObject(id) {
  const m = GAME_DATA.moves[id];
  if (!m) return null;
  return { id, name: m.name, type: m.type, power: m.power, accuracy: m.accuracy,
    category: m.category, pp: m.pp, maxPp: m.pp, priority: m.priority || 0,
    selfRank: m.selfRank, oppRank: m.oppRank, selfStatus: m.selfStatus, oppStatus: m.oppStatus,
    flinchChance: m.flinchChance || 0,
    drainRatio: m.drainRatio || null, recoilRatio: m.recoilRatio || null,
    selfDestruct: !!m.selfDestruct, chargeTurn: !!m.chargeTurn,
    damageFormula: m.damageFormula || null, callRandomMove: !!m.callRandomMove,
    locked: false };
}

// ランダムアクトで入れ替わった技を、元の技（PP満タン）へ戻す。
// 入れ替わっていなければ何もしない。バトル開始時のリセット（resetPokeForBattle）から呼ぶ。
function restoreOriginalMoves(poke) {
  if (!poke || !poke.originalMoveIds) return;
  const restored = poke.originalMoveIds.map((id) => (id ? buildMoveObject(id) : null)).filter(Boolean);
  if (restored.length > 0) poke.moves = restored;
  poke.originalMoveIds = null;
}

// 威力59以下でも例外的にダメージ技候補として採用するID
const LOW_POWER_EXCEPTION_MOVE_IDS = [1,271,503,504,111,107,155,221,162,295,324,77,341,405,461,472,498,494,48,189,309,367,388,229,109,179,169,128];

function chooseMoves(species) {
  const candidateIds = levelUpMoveIds(species);
  const statusMoves = [], damageMoves = [];
  for (const moveId of candidateIds) {
    const move = GAME_DATA.moves[moveId];
    if (!move) continue;
    if (move.category === 'status') statusMoves.push(moveId);
    else if ((move.power ?? 0) > 50 || LOW_POWER_EXCEPTION_MOVE_IDS.includes(moveId)) damageMoves.push(moveId);
  }
  const chosen = [];
  const poolOf = (arr) => arr.filter((id) => !chosen.includes(id));

  // 変化技の採用確率: 1枠目=75%、2枠目=25%、3枠目以降=変化技なし
  const statusChanceBySlot = [75, 25];

  // きあいだめ(attack414)は最優先技：候補にあれば1枠目を確定できあいだめにする。
  const KIAIDAME_MOVE_ID = 414;
  const hasKiaidame = statusMoves.includes(KIAIDAME_MOVE_ID);
  // こらえる(attack506)も同様に最優先技：候補にあれば必ず習得させる（きあいだめが無い場合は1枠目、
  // きあいだめも候補にある場合はきあいだめを1枠目、こらえるを2枠目に確定する）。
  const KORAERU_MOVE_ID = 506;
  const hasKoraeru = statusMoves.includes(KORAERU_MOVE_ID);

  // ---- 手順1：従来どおり、枠ごとに「変化技 or 攻撃技」を決めて技を選ぶ ----
  // ここでは攻撃技の中身（同タイプかどうか）にはまだこだわらず、攻撃技が何枠になるかを確定させる。
  const slotKinds = []; // 'status' | 'damage'
  for (let slot = 0; slot < 4; slot++) {
    const statusPool = poolOf(statusMoves), damagePool = poolOf(damageMoves);
    if (statusPool.length === 0 && damagePool.length === 0) break;

    if (slot === 0 && hasKiaidame && statusPool.includes(KIAIDAME_MOVE_ID)) {
      chosen.push(KIAIDAME_MOVE_ID);
      slotKinds.push('status');
      continue;
    }
    if (hasKoraeru && statusPool.includes(KORAERU_MOVE_ID) &&
        (slot === 0 || (slot === 1 && chosen[0] === KIAIDAME_MOVE_ID))) {
      chosen.push(KORAERU_MOVE_ID);
      slotKinds.push('status');
      continue;
    }

    const statusChance = statusChanceBySlot[slot] ?? 0;
    const wantStatus = statusChance > 0 && rand(1, 100) <= statusChance;
    let p, kind;
    if (wantStatus && statusPool.length > 0) { p = pick(statusPool); kind = 'status'; }
    else if (damagePool.length > 0) { p = pick(damagePool); kind = 'damage'; }
    else if (statusPool.length > 0) { p = pick(statusPool); kind = 'status'; }
    else break;
    chosen.push(p);
    slotKinds.push(kind);
  }

  // ---- 手順2：攻撃技の中身を「自分と同じタイプ」のルールで組み直す ----
  // ・攻撃技のうち必ず1つは、自分のタイプ（type1 / type2）と同じタイプの攻撃技にする。
  // ・同タイプの攻撃技が2つ重なる確率は20%。3つ以上には絶対にしない。
  // ・そもそも候補に自分と同じタイプの攻撃技が無い、または攻撃技が自タイプの技しか
  //   候補に無い場合は、その分の制御は無効（従来どおりの抽選結果のまま）。
  const ownTypes = [species.type1, species.type2].filter(Boolean);
  const isOwnTypeDamage = (id) => {
    const m = GAME_DATA.moves[id];
    return !!m && m.category !== 'status' && ownTypes.includes(m.type);
  };
  const ownDamageAll = damageMoves.filter(isOwnTypeDamage);   // 自タイプの攻撃技候補（全体）
  const otherDamageAll = damageMoves.filter((id) => !isOwnTypeDamage(id)); // 自タイプ以外の攻撃技候補（全体）
  const damageSlotIdxs = [];
  slotKinds.forEach((k, i) => { if (k === 'damage') damageSlotIdxs.push(i); });

  if (ownDamageAll.length > 0 && damageSlotIdxs.length > 0) {
    // 同タイプ攻撃技の個数を決める：基本は1個。攻撃技が2枠以上あるときだけ20%で2個。
    // （攻撃技が1枠しかないなら、2個になり得ないので1個。）
    const SECOND_OWN_TYPE_CHANCE = 20;
    let wantOwn = 1;
    if (damageSlotIdxs.length >= 2 && ownDamageAll.length >= 2 && rand(1, 100) <= SECOND_OWN_TYPE_CHANCE) wantOwn = 2;

    // 自タイプ以外の攻撃技候補が足りず、自タイプを増やさないと枠が埋まらない場合は、
    // 「自分と同じタイプの技しかない場合は無効」に該当するので、埋まる分だけ自タイプを許容する。
    const needOther = damageSlotIdxs.length - wantOwn;
    const otherAvail = otherDamageAll.length;
    const ownCount = Math.min(damageSlotIdxs.length, Math.max(wantOwn, damageSlotIdxs.length - otherAvail));

    // 攻撃技の枠を作り直す：自タイプを ownCount 個、残りを自タイプ以外から抽選。
    const ownPicks = [];
    const ownPoolLocal = [...ownDamageAll];
    while (ownPicks.length < ownCount && ownPoolLocal.length > 0) {
      ownPicks.push(ownPoolLocal.splice(rand(0, ownPoolLocal.length - 1), 1)[0]);
    }
    const otherPicks = [];
    const otherPoolLocal = [...otherDamageAll];
    while (ownPicks.length + otherPicks.length < damageSlotIdxs.length && otherPoolLocal.length > 0) {
      otherPicks.push(otherPoolLocal.splice(rand(0, otherPoolLocal.length - 1), 1)[0]);
    }
    // それでも枠が余る（=自タイプもその他も足りない）場合は、残りの自タイプ候補で埋める。
    while (ownPicks.length + otherPicks.length < damageSlotIdxs.length && ownPoolLocal.length > 0) {
      ownPicks.push(ownPoolLocal.splice(rand(0, ownPoolLocal.length - 1), 1)[0]);
    }
    const newDamage = [...ownPicks, ...otherPicks];
    // 攻撃技の並びは元の抽選順を保つため、混ぜてから各攻撃技の枠へ順番に配置する。
    for (let i = newDamage.length - 1; i > 0; i--) {
      const j = rand(0, i);
      [newDamage[i], newDamage[j]] = [newDamage[j], newDamage[i]];
    }
    damageSlotIdxs.forEach((slotIdx, n) => { if (newDamage[n] !== undefined) chosen[slotIdx] = newDamage[n]; });
  }

  while (chosen.length < 4) chosen.push(0);

  // 表示上、変化技は後ろの枠に寄せる（見やすさのため）。
  // 1つなら4番目、2つなら3番目と4番目に配置する。攻撃技同士・変化技同士の
  // 内部順序（採用順）は変えず、カテゴリの並び替えのみ行う。
  const damageOnly = chosen.filter((id) => id !== 0 && GAME_DATA.moves[id]?.category !== 'status');
  const statusOnly = chosen.filter((id) => id !== 0 && GAME_DATA.moves[id]?.category === 'status');
  const reordered = [...damageOnly, ...statusOnly];
  while (reordered.length < 4) reordered.push(0);
  return reordered;
}

function rollAbility(species) {
  if (Array.isArray(species.abilities) && species.abilities.length > 0) return pick(species.abilities);
  return 0;
}

function calcStat(base, iv, ev, level, isHp, natureMod) {
  if (isHp) {
    return Math.floor((2 * base + iv + Math.floor(ev / 4)) * level / 100) + level + 10;
  }
  let val = Math.floor((2 * base + iv + Math.floor(ev / 4)) * level / 100) + 5;
  val = Math.floor(val * natureMod);
  return val;
}

function natureMultiplier(natureId, statKey) {
  const entry = NATURE_TABLE[natureId];
  if (!entry) return 1.0;
  if (entry[0] === statKey) return 1.1;
  if (entry[1] === statKey) return 0.9;
  return 1.0;
}

// ---- ヨワシ（ID1012）専用：フォルムチェンジ ----
// gamedata.js の baseStats は「たんどくのすがた」を基準値として登録してあるため、
// 「むれたすがた」用の種族値だけをここに差分データとして持たせる。
// （本家のヨワシ：たんどく H45/A20/B20/C25/D25/S40、むれ H45/A140/B130/C140/D135/S30）
const YOWASHI_SPECIES_ID = 1012;
const YOWASHI_SCHOOL_BASE_STATS = { hp: 45, atk: 140, def: 130, spa: 140, spd: 135, spe: 30 };

// 現在のフォルム(poke.formState)に応じて実数値（atk/def/spa/spd/spe）を再計算する。
// HP（maxHp/currentHp）は本家仕様通りフォルムが変わっても変化しないため対象外。
// ランク補正(poke.ranks)はそのまま維持され、実数値の再計算のみが行われる。
function recalcYowashiStats(poke) {
  const base = (poke.formState === 'school') ? YOWASHI_SCHOOL_BASE_STATS : poke.species.baseStats;
  poke.stats.atk = calcStat(base.atk, poke.iv, poke.evs[1], poke.level, false, natureMultiplier(poke.nature, 'atk'));
  poke.stats.def = calcStat(base.def, poke.iv, poke.evs[2], poke.level, false, natureMultiplier(poke.nature, 'def'));
  poke.stats.spa = calcStat(base.spa, poke.iv, poke.evs[3], poke.level, false, natureMultiplier(poke.nature, 'spa'));
  poke.stats.spd = calcStat(base.spd, poke.iv, poke.evs[4], poke.level, false, natureMultiplier(poke.nature, 'spd'));
  poke.stats.spe = calcStat(base.spe, poke.iv, poke.evs[5], poke.level, false, natureMultiplier(poke.nature, 'spe'));
}

// ヨワシのフォルムを、現在のHP割合に応じて判定・更新する。
// 「残りHPが最大HPの1/4より多い」ならむれたすがた、「1/4以下」ならたんどくのすがたにする。
// 呼び出しタイミング：①場に出た時（登場時）　②ターン終了時
// 変化があった場合のみログを出し、実数値を再計算する。戻り値は変化があったかどうか。
// ログには yowashiForm（'school'|'solo'）と side（'player'|'cpu'）をメタ情報として付与し、
// UI側で戦闘中のスプライト画像を実際に切り替える演出のトリガーに使う。
// withEffect: true の場合のみ、UI側で「魚が集まる／散る」演出を再生させる合図(fx:true)を付与する。
// 登場時（バトル開始・交代直後）は、直後にsetSpriteで画像が出るため演出なし(false)で呼ぶ。
function updateYowashiForm(poke, logFn, withEffect) {
  if (!poke || poke.fainted || poke.speciesId !== YOWASHI_SPECIES_ID) return false;
  const shouldBeSchool = poke.currentHp > poke.maxHp / 4;
  const nextForm = shouldBeSchool ? 'school' : 'solo';
  if (poke.formState === nextForm) return false;
  poke.formState = nextForm;
  recalcYowashiStats(poke);
  if (logFn) {
    const meta = { yowashiForm: nextForm, side: poke.side, fx: !!withEffect };
    if (nextForm === 'school') {
      logFn(`${poke.species.name}は　むれたすがたに　なった！`, meta);
    } else {
      logFn(`${poke.species.name}は　たんどくのすがたに　なった！`, meta);
    }
  }
  return true;
}

// ---- アイニーチュ（ID1990）専用：HP低下によるフォルムチェンジ ----
// ヨワシと違い、①片道の変化（一度発動したら戦闘終了までもとに戻らない）、
// ②HP種族値も変化するため最大HP・残りHPが変動分だけ増える、③状態異常（こんらん含む）が全解除、
// という仕様のため、ヨワシとは別関数として実装する。
// フォルムチェンジ後の種族値（この差分だけ変化する。元の種族値はgamedata.js側で定義される）。
const AINEECHU_SPECIES_ID = 1990;
const AINEECHU_FORM_BASE_STATS = { hp: 196, atk: 113, def: 110, spa: 111, spd: 110, spe: 20 };

// フォルムチェンジ後の実数値（atk/def/spa/spd/spe）を再計算する。
// HPは「増加分」を個別に加算して処理するため、ここでは対象外。
function recalcAineechuStats(poke) {
  const base = AINEECHU_FORM_BASE_STATS;
  poke.stats.atk = calcStat(base.atk, poke.iv, poke.evs[1], poke.level, false, natureMultiplier(poke.nature, 'atk'));
  poke.stats.def = calcStat(base.def, poke.iv, poke.evs[2], poke.level, false, natureMultiplier(poke.nature, 'def'));
  poke.stats.spa = calcStat(base.spa, poke.iv, poke.evs[3], poke.level, false, natureMultiplier(poke.nature, 'spa'));
  poke.stats.spd = calcStat(base.spd, poke.iv, poke.evs[4], poke.level, false, natureMultiplier(poke.nature, 'spd'));
  poke.stats.spe = calcStat(base.spe, poke.iv, poke.evs[5], poke.level, false, natureMultiplier(poke.nature, 'spe'));
}

// ターン終了時（状態異常等の処理が全て済んだ最終的な残りHPが確定した後）に呼ぶ。
// 条件：まだフォルムチェンジしておらず、残りHPが最大HPの1/2以下ならフォルムチェンジする。
// 一度発動したら poke.aineechuFormed = true が立ち、以後は残りHPが半分を超えても交代しても
// 元に戻らない（バトル終了時にポケモンが再生成されるため自然にリセットされる）。
// 戻り値は変化が起きたかどうか。
function updateAineechuForm(poke, logFn) {
  if (!poke || poke.fainted || poke.speciesId !== AINEECHU_SPECIES_ID) return false;
  if (poke.aineechuFormed) return false;
  if (!(poke.currentHp <= poke.maxHp / 2)) return false;

  poke.aineechuFormed = true;
  poke.formState = 'awakened';

  // HP種族値の変動分だけ、最大HP・残りHPを同じ値だけ増加させる。
  // 上昇値 = (HP種族値の変動分) × 2 × レベル / 100 （小数点以下切り捨て）
  const baseHpDiff = AINEECHU_FORM_BASE_STATS.hp - poke.species.baseStats.hp;
  const hpGain = Math.floor(baseHpDiff * 2 * poke.level / 100);
  poke.maxHp += hpGain;
  poke.currentHp += hpGain;

  // 実数値（A/B/C/D/S）を新しい種族値で再計算する（ランク補正はそのまま維持）。
  recalcAineechuStats(poke);

  // 状態異常（どく・やけど・まひ・ねむり・こおり）とこんらんを全て解除する。
  // 特性「いざない」で仕込まれた「Nターン後にねむり」の予約も無効化する。
  const hadStatus = poke.status && poke.status !== STATUS.NONE;
  const hadConfuse = poke.confuseTurns > 0;
  poke.status = STATUS.NONE;
  poke.badlyPoisonCounter = 0;
  poke.confuseTurns = 0;
  poke.izanaiTurns = 0;

  logFn(`${poke.species.name}は　すがたを　かえた！`, {
    aineechuForm: true,
    side: poke.side,
    hpSnapshot: poke.currentHp,
    maxHpSnapshot: poke.maxHp,
    statusSnapshot: poke.status || STATUS.NONE,
    confuseSnapshot: poke.confuseTurns || 0,
  });
  if (hadStatus || hadConfuse) {
    logFn(`${poke.species.name}の　状態異常が　なおった！`, {
      statusApply: poke.side,
      hpSnapshot: poke.currentHp,
      statusSnapshot: poke.status || STATUS.NONE,
      confuseSnapshot: poke.confuseTurns || 0,
    });
  }
  return true;
}

// ---- メガシンカ ----
// メガシンカすると タイプ・特性・種族値（実数値）が変化する。HPは本家仕様通り不変。

// 単一フォームのポケモンはこれまで通り { type1, type2, ability, baseStats } を直書きする。
// メガリザードンX/Yのように2種類のメガフォームを持つポケモンは、
// { forms: { X: {...}, Y: {...} } } の形で2つのフォームデータを持たせる。
// フォームの決定は選出時点（createRandomPokemon）で50/50抽選して確定する。
const MEGA_EVOLUTION_DATA = {
  "6": {
    "forms": {
      "X": {
        "type1": "fire",
        "type2": "dragon",
        "ability": 70,
        "baseStats": {
          "hp": 78,
          "atk": 120,
          "def": 111,
          "spa": 120,
          "spd": 85,
          "spe": 100
        }
      },
      "Y": {
        "type1": "fire",
        "type2": "flying",
        "ability": 46,
        "baseStats": {
          "hp": 78,
          "atk": 94,
          "def": 88,
          "spa": 139,
          "spd": 115,
          "spe": 100
        }
      }
    }
  },
  "9": {
    "type1": "water",
    "type2": "ground",
    "ability": 23,
    "baseStats": {
      "hp": 80,
      "atk": 140,
      "def": 110,
      "spa": 115,
      "spd": 110,
      "spe": 70
    }
  },
  "11": {
    "type1": "bug",
    "type2": "electric",
    "ability": 135,
    "baseStats": {
      "hp": 95,
      "atk": 100,
      "def": 70,
      "spa": 120,
      "spd": 110,
      "spe": 95
    }
  },
  "12": {
    "type1": "bug",
    "type2": "fighting",
    "ability": 115,
    "baseStats": {
      "hp": 80,
      "atk": 175,
      "def": 115,
      "spa": 30,
      "spd": 105,
      "spe": 75
    }
  },
  "15": {
    "type1": "bug",
    "type2": "poison",
    "ability": 68,
    "baseStats": {
      "hp": 97,
      "atk": 175,
      "def": 40,
      "spa": 0,
      "spd": 80,
      "spe": 152
    }
  },
  "18": {
    "type1": "normal",
    "type2": "flying",
    "ability": 69,
    "baseStats": {
      "hp": 80,
      "atk": 70,
      "def": 80,
      "spa": 159,
      "spd": 80,
      "spe": 121
    }
  },
  "32": {
    "type1": "grass",
    "type2": "poison",
    "ability": 53,
    "baseStats": {
      "hp": 80,
      "atk": 70,
      "def": 90,
      "spa": 145,
      "spd": 149,
      "spe": 96
    }
  },
  "34": {
    "type1": "fighting",
    "type2": "psychic",
    "ability": 25,
    "baseStats": {
      "hp": 60,
      "atk": 90,
      "def": 85,
      "spa": 70,
      "spd": 85,
      "spe": 100
    }
  },
  "36": {
    "type1": "grass",
    "type2": "shine",
    "ability": 147,
    "baseStats": {
      "hp": 110,
      "atk": 120,
      "def": 110,
      "spa": 120,
      "spd": 120,
      "spe": 100
    }
  },
  "41": {
    "type1": "dark",
    "type2": "shine",
    "ability": 125,
    "baseStats": {
      "hp": 65,
      "atk": 150,
      "def": 60,
      "spa": 75,
      "spd": 70,
      "spe": 125
    }
  },
  "43": {
    "type1": "steel",
    "type2": "flying",
    "ability": 45,
    "baseStats": {
      "hp": 100,
      "atk": 130,
      "def": 110,
      "spa": 30,
      "spd": 100,
      "spe": 110
    }
  },
  "48": {
    "type1": "fire",
    "type2": "ground",
    "ability": 66,
    "baseStats": {
      "hp": 100,
      "atk": 135,
      "def": 100,
      "spa": 135,
      "spd": 105,
      "spe": 20
    }
  },
  "50": {
    "forms": {
      "X": {
        "type1": "electric",
        "type2": null,
        "ability": 117,
        "baseStats": {
          "hp": 25,
          "atk": 125,
          "def": 95,
          "spa": 80,
          "spd": 95,
          "spe": 110
        }
      },
      "Y": {
        "type1": "electric",
        "type2": null,
        "ability": 69,
        "baseStats": {
          "hp": 70,
          "atk": 90,
          "def": 65,
          "spa": 150,
          "spd": 80,
          "spe": 130
        }
      }
    }
  },
  "56": {
    "type1": "fire",
    "type2": "dark",
    "ability": 96,
    "baseStats": {
      "hp": 100,
      "atk": 75,
      "def": 100,
      "spa": 155,
      "spd": 100,
      "spe": 115
    }
  },
  "60": {
    "type1": "water",
    "type2": "dark",
    "ability": 75,
    "baseStats": {
      "hp": 100,
      "atk": 145,
      "def": 109,
      "spa": 50,
      "spd": 130,
      "spe": 91
    }
  },
  "62": {
    "type1": "grass",
    "type2": "fire",
    "ability": 140,
    "baseStats": {
      "hp": 70,
      "atk": 128,
      "def": 95,
      "spa": 128,
      "spd": 85,
      "spe": 75
    }
  },
  "70": {
    "type1": "normal",
    "type2": "dragon",
    "ability": 56,
    "baseStats": {
      "hp": 120,
      "atk": 135,
      "def": 90,
      "spa": 135,
      "spd": 75,
      "spe": 20
    }
  },
  "73": {
    "type1": "water",
    "type2": "psychic",
    "ability": 25,
    "baseStats": {
      "hp": 70,
      "atk": 100,
      "def": 105,
      "spa": 130,
      "spd": 105,
      "spe": 120
    }
  },
  "78": {
    "type1": "water",
    "type2": "electric",
    "ability": 73,
    "baseStats": {
      "hp": 120,
      "atk": 30,
      "def": 70,
      "spa": 140,
      "spd": 100,
      "spe": 100
    }
  },
  "81": {
    "type1": "dragon",
    "type2": "flying",
    "ability": 64,
    "baseStats": {
      "hp": 91,
      "atk": 134,
      "def": 115,
      "spa": 135,
      "spd": 105,
      "spe": 100
    }
  },
  "89": {
    "type1": "poison",
    "type2": "dragon",
    "ability": 107,
    "baseStats": {
      "hp": 65,
      "atk": 125,
      "def": 105,
      "spa": 125,
      "spd": 163,
      "spe": 24
    }
  },
  "91": {
    "type1": "dark",
    "type2": "ice",
    "ability": 53,
    "baseStats": {
      "hp": 100,
      "atk": 140,
      "def": 85,
      "spa": 30,
      "spd": 125,
      "spe": 135
    }
  },
  "97": {
    "type1": "rock",
    "type2": "dark",
    "ability": 31,
    "baseStats": {
      "hp": 80,
      "atk": 154,
      "def": 140,
      "spa": 85,
      "spd": 80,
      "spe": 71
    }
  },
  "100": {
    "type1": "psychic",
    "type2": null,
    "ability": 76,
    "baseStats": {
      "hp": 55,
      "atk": 40,
      "def": 75,
      "spa": 165,
      "spd": 105,
      "spe": 150
    }
  },
  "102": {
    "type1": "water",
    "type2": "dark",
    "ability": 87,
    "baseStats": {
      "hp": 70,
      "atk": 130,
      "def": 80,
      "spa": 70,
      "spd": 80,
      "spe": 125
    }
  },
  "123": {
    "type1": "steel",
    "type2": "ground",
    "ability": 66,
    "baseStats": {
      "hp": 75,
      "atk": 125,
      "def": 230,
      "spa": 15,
      "spd": 95,
      "spe": 20
    }
  },
  "139": {
    "type1": "ground",
    "type2": "flying",
    "ability": 126,
    "baseStats": {
      "hp": 80,
      "atk": 135,
      "def": 130,
      "spa": 0,
      "spd": 110,
      "spe": 156
    }
  },
  "151": {
    "type1": "grass",
    "type2": "poison",
    "ability": 104,
    "baseStats": {
      "hp": 100,
      "atk": 155,
      "def": 85,
      "spa": 155,
      "spd": 85,
      "spe": 110
    }
  },
  "171": {
    "type1": "fire",
    "type2": "ghost",
    "ability": 143,
    "baseStats": {
      "hp": 75,
      "atk": 145,
      "def": 100,
      "spa": 70,
      "spd": 120,
      "spe": 95
    }
  },
  "174": {
    "type1": "bug",
    "type2": "steel",
    "ability": 53,
    "baseStats": {
      "hp": 80,
      "atk": 130,
      "def": 130,
      "spa": 55,
      "spd": 100,
      "spe": 75
    }
  },
  "177": {
    "type1": "water",
    "type2": "sound",
    "ability": 120,
    "baseStats": {
      "hp": 100,
      "atk": 100,
      "def": 80,
      "spa": 140,
      "spd": 109,
      "spe": 116
    }
  },
  "188": {
    "type1": "normal",
    "type2": null,
    "ability": 139,
    "baseStats": {
      "hp": 105,
      "atk": 165,
      "def": 100,
      "spa": 50,
      "spd": 100,
      "spe": 100
    }
  },
  "189": {
    "type1": "fighting",
    "type2": null,
    "ability": 98,
    "baseStats": {
      "hp": 65,
      "atk": 137,
      "def": 160,
      "spa": 60,
      "spd": 85,
      "spe": 103
    }
  },
  "197": {
    "type1": "bug",
    "type2": "steel",
    "ability": 4,
    "baseStats": {
      "hp": 100,
      "atk": 140,
      "def": 150,
      "spa": 10,
      "spd": 83,
      "spe": 30
    }
  },
  "204": {
    "type1": "fairy",
    "type2": "flying",
    "ability": 125,
    "baseStats": {
      "hp": 95,
      "atk": 70,
      "def": 113,
      "spa": 125,
      "spd": 120,
      "spe": 70
    }
  },
  "207": {
    "type1": "rock",
    "type2": "flying",
    "ability": 70,
    "baseStats": {
      "hp": 80,
      "atk": 125,
      "def": 85,
      "spa": 60,
      "spd": 95,
      "spe": 150
    }
  },
  "215": {
    "type1": "fighting",
    "type2": "flying",
    "ability": 65,
    "baseStats": {
      "hp": 85,
      "atk": 130,
      "def": 100,
      "spa": 50,
      "spd": 90,
      "spe": 110
    }
  },
  "228": {
    "type1": "ghost",
    "type2": "poison",
    "ability": 121,
    "baseStats": {
      "hp": 60,
      "atk": 55,
      "def": 80,
      "spa": 160,
      "spd": 95,
      "spe": 130
    }
  },
  "239": {
    "type1": "steel",
    "type2": null,
    "ability": 77,
    "baseStats": {
      "hp": 100,
      "atk": 130,
      "def": 230,
      "spa": 0,
      "spd": 80,
      "spe": 50
    }
  },
  "242": {
    "type1": "ghost",
    "type2": null,
    "ability": 149,
    "baseStats": {
      "hp": 64,
      "atk": 145,
      "def": 105,
      "spa": 33,
      "spd": 80,
      "spe": 98
    }
  },
  "254": {
    "type1": "dark",
    "type2": "fairy",
    "ability": 127,
    "baseStats": {
      "hp": 145,
      "atk": 30,
      "def": 70,
      "spa": 130,
      "spd": 145,
      "spe": 95
    }
  },
  "255": {
    "type1": "dark",
    "type2": "fighting",
    "ability": 126,
    "baseStats": {
      "hp": 65,
      "atk": 150,
      "def": 40,
      "spa": 150,
      "spd": 40,
      "spe": 115
    }
  },
  "256": {
    "type1": "fighting",
    "type2": "flying",
    "ability": 69,
    "baseStats": {
      "hp": 78,
      "atk": 137,
      "def": 100,
      "spa": 64,
      "spd": 93,
      "spe": 118
    }
  },
  "268": {
    "type1": "fire",
    "type2": "normal",
    "ability": 133,
    "baseStats": {
      "hp": 86,
      "atk": 78,
      "def": 102,
      "spa": 119,
      "spd": 86,
      "spe": 126
    }
  },
  "270": {
    "type1": "psychic",
    "type2": null,
    "ability": 118,
    "baseStats": {
      "hp": 74,
      "atk": 38,
      "def": 76,
      "spa": 143,
      "spd": 101,
      "spe": 124
    }
  },
  "282": {
    "type1": "fire",
    "type2": "flying",
    "ability": 84,
    "baseStats": {
      "hp": 90,
      "atk": 150,
      "def": 100,
      "spa": 150,
      "spd": 90,
      "spe": 120
    }
  },
  "285": {
    "type1": "ghost",
    "type2": null,
    "ability": 105,
    "baseStats": {
      "hp": 60,
      "atk": 100,
      "def": 160,
      "spa": 100,
      "spd": 180,
      "spe": 30
    }
  },
  "291": {
    "type1": "steel",
    "type2": "fairy",
    "ability": 25,
    "baseStats": {
      "hp": 50,
      "atk": 115,
      "def": 125,
      "spa": 45,
      "spd": 95,
      "spe": 50
    }
  },
  "296": {
    "type1": "psychic",
    "type2": "steel",
    "ability": 138,
    "baseStats": {
      "hp": 75,
      "atk": 40,
      "def": 120,
      "spa": 125,
      "spd": 120,
      "spe": 65
    }
  },
  "309": {
    "type1": "ghost",
    "type2": "fire",
    "ability": 123,
    "baseStats": {
      "hp": 60,
      "atk": 65,
      "def": 110,
      "spa": 175,
      "spd": 110,
      "spe": 90
    }
  },
  "317": {
    "type1": "dragon",
    "type2": "flying",
    "ability": 141,
    "baseStats": {
      "hp": 95,
      "atk": 135,
      "def": 130,
      "spa": 110,
      "spd": 90,
      "spe": 99
    }
  },
  "322": {
    "type1": "dragon",
    "type2": "sound",
    "ability": 146,
    "baseStats": {
      "hp": 85,
      "atk": 130,
      "def": 100,
      "spa": 167,
      "spd": 90,
      "spe": 123
    }
  },
  "325": {
    "type1": "bug",
    "type2": "poison",
    "ability": 4,
    "baseStats": {
      "hp": 60,
      "atk": 140,
      "def": 149,
      "spa": 65,
      "spd": 89,
      "spe": 72
    }
  },
  "329": {
    "type1": "dragon",
    "type2": "ground",
    "ability": 93,
    "baseStats": {
      "hp": 108,
      "atk": 160,
      "def": 115,
      "spa": 110,
      "spd": 95,
      "spe": 72
    }
  },
  "344": {
    "type1": "dragon",
    "type2": "fairy",
    "ability": 62,
    "baseStats": {
      "hp": 75,
      "atk": 120,
      "def": 110,
      "spa": 120,
      "spd": 110,
      "spe": 80
    }
  },
  "347": {
    "type1": "steel",
    "type2": "electric",
    "ability": 117,
    "baseStats": {
      "hp": 110,
      "atk": 55,
      "def": 90,
      "spa": 165,
      "spd": 134,
      "spe": 96
    }
  },
  "349": {
    "type1": "dark",
    "type2": "fighting",
    "ability": 88,
    "baseStats": {
      "hp": 100,
      "atk": 55,
      "def": 100,
      "spa": 120,
      "spd": 100,
      "spe": 90
    }
  },
  "351": {
    "type1": "grass",
    "type2": "ice",
    "ability": 57,
    "baseStats": {
      "hp": 90,
      "atk": 122,
      "def": 105,
      "spa": 122,
      "spd": 105,
      "spe": 60
    }
  },
  "352": {
    "type1": "bug",
    "type2": "flying",
    "ability": 141,
    "baseStats": {
      "hp": 65,
      "atk": 145,
      "def": 120,
      "spa": 55,
      "spd": 90,
      "spe": 95
    }
  },
  "356": {
    "type1": "dark",
    "type2": "psychic",
    "ability": 65,
    "baseStats": {
      "hp": 82,
      "atk": 112,
      "def": 88,
      "spa": 110,
      "spd": 120,
      "spe": 98
    }
  },
  "358": {
    "type1": "rock",
    "type2": "fighting",
    "ability": 70,
    "baseStats": {
      "hp": 72,
      "atk": 130,
      "def": 130,
      "spa": 54,
      "spd": 106,
      "spe": 109
    }
  },
  "360": {
    "type1": "water",
    "type2": "dragon",
    "ability": 88,
    "baseStats": {
      "hp": 70,
      "atk": 10,
      "def": 80,
      "spa": 170,
      "spd": 100,
      "spe": 125
    }
  },
  "363": {
    "type1": "ice",
    "type2": null,
    "ability": 80,
    "baseStats": {
      "hp": 80,
      "atk": 110,
      "def": 80,
      "spa": 110,
      "spd": 80,
      "spe": 100
    }
  },
  "364": {
    "type1": "ice",
    "type2": "ghost",
    "ability": 57,
    "baseStats": {
      "hp": 70,
      "atk": 70,
      "def": 70,
      "spa": 130,
      "spd": 100,
      "spe": 120
    }
  },
  "366": {
    "type1": "normal",
    "type2": "fighting",
    "ability": 89,
    "baseStats": {
      "hp": 65,
      "atk": 146,
      "def": 94,
      "spa": 44,
      "spd": 96,
      "spe": 135
    }
  },
  "381": {
    "type1": "grass",
    "type2": "fighting",
    "ability": 116,
    "baseStats": {
      "hp": 88,
      "atk": 127,
      "def": 172,
      "spa": 64,
      "spd": 115,
      "spe": 44
    }
  },
  "384": {
    "type1": "fire",
    "type2": "psychic",
    "ability": 19,
    "baseStats": {
      "hp": 75,
      "atk": 59,
      "def": 72,
      "spa": 149,
      "spd": 125,
      "spe": 134
    }
  },
  "387": {
    "type1": "water",
    "type2": "dark",
    "ability": 142,
    "baseStats": {
      "hp": 72,
      "atk": 115,
      "def": 77,
      "spa": 123,
      "spd": 81,
      "spe": 142
    }
  },
  "441": {
    "type1": "dragon",
    "type2": null,
    "ability": 145,
    "baseStats": {
      "hp": 75,
      "atk": 145,
      "def": 110,
      "spa": 50,
      "spd": 100,
      "spe": 95
    }
  },
  "451": {
    "type1": "water",
    "type2": "psychic",
    "ability": 4,
    "baseStats": {
      "hp": 95,
      "atk": 65,
      "def": 180,
      "spa": 120,
      "spd": 80,
      "spe": 30
    }
  },
  "456": {
    "type1": "steel",
    "type2": "psychic",
    "ability": 70,
    "baseStats": {
      "hp": 80,
      "atk": 95,
      "def": 150,
      "spa": 85,
      "spd": 110,
      "spe": 110
    }
  },
  "464": {
    "type1": "dragon",
    "type2": "ice",
    "ability": 14,
    "baseStats": {
      "hp": 15,
      "atk": 165,
      "def": 117,
      "spa": 95,
      "spd": 101,
      "spe": 67
    }
  },
  "468": {
    "type1": "grass",
    "type2": "poison",
    "ability": 33,
    "baseStats": {
      "hp": 80,
      "atk": 120,
      "def": 123,
      "spa": 122,
      "spd": 120,
      "spe": 80
    }
  },
  "471": {
    "type1": "water",
    "type2": null,
    "ability": 88,
    "baseStats": {
      "hp": 79,
      "atk": 93,
      "def": 120,
      "spa": 135,
      "spd": 115,
      "spe": 78
    }
  },
  "476": {
    "type1": "fire",
    "type2": null,
    "ability": 3,
    "baseStats": {
      "hp": 105,
      "atk": 140,
      "def": 70,
      "spa": 90,
      "spd": 100,
      "spe": 135
    }
  },
  "486": {
    "type1": "bug",
    "type2": "poison",
    "ability": 142,
    "baseStats": {
      "hp": 80,
      "atk": 35,
      "def": 130,
      "spa": 130,
      "spd": 100,
      "spe": 65
    }
  },
  "489": {
    "type1": "steel",
    "type2": "sound",
    "ability": 148,
    "baseStats": {
      "hp": 80,
      "atk": 129,
      "def": 120,
      "spa": 90,
      "spd": 125,
      "spe": 97
    }
  },
  "505": {
    "type1": "dark",
    "type2": "ghost",
    "ability": 125,
    "baseStats": {
      "hp": 100,
      "atk": 75,
      "def": 155,
      "spa": 75,
      "spd": 155,
      "spe": 0
    }
  },
  "508": {
    "type1": "ghost",
    "type2": "flying",
    "ability": 144,
    "baseStats": {
      "hp": 210,
      "atk": 30,
      "def": 50,
      "spa": 190,
      "spd": 50,
      "spe": 110
    }
  },
  "513": {
    "type1": "ground",
    "type2": "steel",
    "ability": 75,
    "baseStats": {
      "hp": 100,
      "atk": 155,
      "def": 100,
      "spa": 0,
      "spd": 65,
      "spe": 103
    }
  },
  "525": {
    "type1": "rock",
    "type2": "poison",
    "ability": 68,
    "baseStats": {
      "hp": 83,
      "atk": 80,
      "def": 125,
      "spa": 110,
      "spd": 116,
      "spe": 101
    }
  },
  "549": {
    "type1": "bug",
    "type2": "steel",
    "ability": 70,
    "baseStats": {
      "hp": 155,
      "atk": 110,
      "def": 145,
      "spa": 30,
      "spd": 90,
      "spe": 30
    }
  },
  "557": {
    "type1": "ground",
    "type2": "rock",
    "ability": 31,
    "baseStats": {
      "hp": 125,
      "atk": 155,
      "def": 125,
      "spa": 45,
      "spd": 55,
      "spe": 45
    }
  },
  "577": {
    "type1": "electric",
    "type2": "shine",
    "ability": 73,
    "baseStats": {
      "hp": 75,
      "atk": 65,
      "def": 110,
      "spa": 155,
      "spd": 110,
      "spe": 135
    }
  },
  "585": {
    "type1": "normal",
    "type2": "fairy",
    "ability": 91,
    "baseStats": {
      "hp": 100,
      "atk": 30,
      "def": 126,
      "spa": 110,
      "spd": 126,
      "spe": 66
    }
  },
  "1003": {
    "type1": "bug",
    "type2": "rock",
    "ability": 32,
    "baseStats": {
      "hp": 60,
      "atk": 140,
      "def": 200,
      "spa": 100,
      "spd": 70,
      "spe": 0
    }
  },
  "1004": {
    "type1": "dark",
    "type2": "psychic",
    "ability": 53,
    "baseStats": {
      "hp": 75,
      "atk": 51,
      "def": 80,
      "spa": 140,
      "spd": 130,
      "spe": 109
    }
  },
  "1005": {
    "type1": "ghost",
    "type2": "ground",
    "ability": 121,
    "baseStats": {
      "hp": 65,
      "atk": 150,
      "def": 110,
      "spa": 50,
      "spd": 100,
      "spe": 75
    }
  },
  "1006": {
    "type1": "shine",
    "type2": "flying",
    "ability": 139,
    "baseStats": {
      "hp": 128,
      "atk": 48,
      "def": 62,
      "spa": 118,
      "spd": 129,
      "spe": 145
    }
  },
  "1009": {
    "type1": "fire",
    "type2": "fairy",
    "ability": 150,
    "baseStats": {
      "hp": 110,
      "atk": 135,
      "def": 100,
      "spa": 30,
      "spd": 98,
      "spe": 107
    }
  },
  "1015": {
    "type1": "electric",
    "type2": "dragon",
    "ability": 75,
    "baseStats": {
      "hp": 90,
      "atk": 85,
      "def": 105,
      "spa": 155,
      "spd": 110,
      "spe": 45
    }
  },
  "1016": {
    "type1": "grass",
    "type2": "dragon",
    "ability": 9,
    "baseStats": {
      "hp": 70,
      "atk": 140,
      "def": 75,
      "spa": 140,
      "spd": 85,
      "spe": 145
    }
  },
  "1017": {
    "type1": "fire",
    "type2": "fighting",
    "ability": 3,
    "baseStats": {
      "hp": 100,
      "atk": 90,
      "def": 100,
      "spa": 90,
      "spd": 100,
      "spe": 100
    }
  },
  "1018": {
    "type1": "electric",
    "type2": null,
    "ability": 135,
    "baseStats": {
      "hp": 100,
      "atk": 125,
      "def": 80,
      "spa": 135,
      "spd": 90,
      "spe": 80
    }
  },
  "1019": {
    "type1": "fighting",
    "type2": "dark",
    "ability": 16,
    "baseStats": {
      "hp": 100,
      "atk": 120,
      "def": 135,
      "spa": 45,
      "spd": 135,
      "spe": 68
    }
  },
  "1020": {
    "type1": "ghost",
    "type2": "ground",
    "ability": 69,
    "baseStats": {
      "hp": 100,
      "atk": 150,
      "def": 104,
      "spa": 40,
      "spd": 115,
      "spe": 65
    }
  },
  "1021": {
    "type1": "ice",
    "type2": "fighting",
    "ability": 89,
    "baseStats": {
      "hp": 100,
      "atk": 147,
      "def": 122,
      "spa": 52,
      "spd": 107,
      "spe": 33
    }
  },
  "1023": {
    "type1": "dark",
    "type2": "flying",
    "ability": 144,
    "baseStats": {
      "hp": 68,
      "atk": 142,
      "def": 58,
      "spa": 78,
      "spd": 109,
      "spe": 145
    }
  },
  "1024": {
    "type1": "fighting",
    "type2": "steel",
    "ability": 68,
    "baseStats": {
      "hp": 70,
      "atk": 50,
      "def": 100,
      "spa": 145,
      "spd": 90,
      "spe": 120
    }
  },
  "1025": {
    "type1": "poison",
    "type2": "dragon",
    "ability": 147,
    "baseStats": {
      "hp": 70,
      "atk": 110,
      "def": 110,
      "spa": 140,
      "spd": 150,
      "spe": 100
    }
  },
  "1026": {
    "type1": "dark",
    "type2": "ghost",
    "ability": 151,
    "baseStats": {
      "hp": 95,
      "atk": 45,
      "def": 145,
      "spa": 135,
      "spd": 55,
      "spe": 120
    }
  },
  "1027": {
    "type1": "grass",
    "type2": "fairy",
    "ability": 152,
    "baseStats": {
      "hp": 80,
      "atk": 42,
      "def": 145,
      "spa": 133,
      "spd": 125,
      "spe": 80
    }
  },
  "1028": {
    "type1": "water",
    "type2": "dragon",
    "ability": 82,
    "baseStats": {
      "hp": 85,
      "atk": 155,
      "def": 120,
      "spa": 69,
      "spd": 93,
      "spe": 88
    }
  },
  "1029": {
    "type1": "fire",
    "type2": "fighting",
    "ability": 75,
    "baseStats": {
      "hp": 130,
      "atk": 148,
      "def": 75,
      "spa": 70,
      "spd": 110,
      "spe": 75
    }
  },
  "1030": {
    "type1": "dragon",
    "type2": "fairy",
    "ability": 138,
    "baseStats": {
      "hp": 80,
      "atk": 130,
      "def": 80,
      "spa": 130,
      "spd": 100,
      "spe": 80
    }
  },
  "1032": {
    "type1": "electric",
    "type2": "fire",
    "ability": 133,
    "baseStats": {
      "hp": 90,
      "atk": 135,
      "def": 102,
      "spa": 135,
      "spd": 88,
      "spe": 85
    }
  },
  "1034": {
    "type1": "dark",
    "type2": null,
    "ability": 102,
    "baseStats": {
      "hp": 80,
      "atk": 130,
      "def": 80,
      "spa": 130,
      "spd": 80,
      "spe": 90
    }
  },
  "1037": {
    "type1": "dark",
    "type2": "sound",
    "ability": 64,
    "baseStats": {
      "hp": 110,
      "atk": 131,
      "def": 92,
      "spa": 49,
      "spd": 70,
      "spe": 138
    }
  },
  "1038": {
    "type1": "ghost",
    "type2": "psychic",
    "ability": 121,
    "baseStats": {
      "hp": 95,
      "atk": 74,
      "def": 95,
      "spa": 80,
      "spd": 100,
      "spe": 116
    }
  },
  "1039": {
    "type1": "dragon",
    "type2": "psychic",
    "ability": 65,
    "baseStats": {
      "hp": 100,
      "atk": 112,
      "def": 115,
      "spa": 118,
      "spd": 95,
      "spe": 100
    }
  },
  "1054": {
    "type1": "bug",
    "type2": "ground",
    "ability": 124,
    "baseStats": {
      "hp": 70,
      "atk": 135,
      "def": 85,
      "spa": 10,
      "spd": 105,
      "spe": 125
    }
  },
  "1057": {
    "type1": "steel",
    "type2": "electric",
    "ability": 155,
    "baseStats": {
      "hp": 80,
      "atk": 20,
      "def": 83,
      "spa": 210,
      "spd": 86,
      "spe": 151
    }
  }
}

// 指定したポケモンのメガ進化データを取得する。
// フォーム違い（forms.X/forms.Y）がある場合、poke.megaForm（既に決まっていればそれ、
// 未決定なら暫定でX）に対応するフォームデータを返す。単一フォームならそのまま返す。
function getMegaEvolutionData(poke) {
  const raw = MEGA_EVOLUTION_DATA[poke && poke.speciesId];
  if (!raw) return null;
  if (raw.forms) {
    const formKey = poke.megaForm === 'Y' ? 'Y' : 'X';
    return raw.forms[formKey];
  }
  return raw;
}

function canMegaEvolve(poke) {
  // poke.noMega === true は「このポケモンは何があってもメガシンカしない」フラグ。
  // 乱入戦で、3匹目の乱入ボス以外の相手をメガシンカさせないために使う。
  if (!poke || poke.isMega || poke.noMega || !MEGA_EVOLUTION_DATA[poke.speciesId]) return false;
  // 乱入ボス11体のメガシンカは、解放するまでロック。
  // ロック中はプレイヤーもNPCも使えない（メガボタン・アイコン・X/Y表記・プレビューも連動して非表示）。
  // 例外：乱入で3匹目として出てくる本人（isIntruder）は、未解放でも確定でメガシンカする。
  if (!poke.isIntruder && !isMegaUsableInBattle(poke.speciesId)) return false;
  return true;
}

// 「今この戦闘で」メガシンカボタンを出してよいか／実際にメガシンカさせてよいか。
// 種族的にメガシンカ可能（canMegaEvolve）であることに加え、本家と同様
// 1回の戦闘で自分（または相手）が既に別の1匹をメガシンカさせていたら、
// このサイドはもう誰もメガシンカできない（本人がメガシンカ済みかは canMegaEvolve 側で判定済み）。
function canMegaEvolveNow(poke) {
  if (!canMegaEvolve(poke)) return false;
  const alreadyUsed = poke.side === 'player' ? battleField.megaUsedPlayer : battleField.megaUsedCpu;
  return !alreadyUsed;
}

// メガリザードンX/Yのように、複数フォームのメガシンカを持つ種族かどうか。
function hasMultiMegaForms(poke) {
  const raw = poke && MEGA_EVOLUTION_DATA[poke.speciesId];
  return !!(raw && raw.forms);
}

// 種族IDだけからメガ進化データを取得する（図鑑表示用。バトル中のpoke.megaFormは参照しない）。
// フォーム違い（X/Y）を持つ種族は、formKeyで明示指定できる（省略時はXを代表として返す）。
function getMegaEvolutionDataForSpeciesId(speciesId, formKey) {
  const raw = MEGA_EVOLUTION_DATA[speciesId];
  if (!raw) return null;
  if (raw.forms) return raw.forms[formKey === 'Y' ? 'Y' : 'X'] || raw.forms.X || raw.forms.Y || null;
  return raw;
}

// 実数値（atk/def/spa/spd/spe）をメガ後の種族値で再計算する。HPは変化させない。
function recalcMegaStats(poke, base) {
  poke.stats.atk = calcStat(base.atk, poke.iv, poke.evs[1], poke.level, false, natureMultiplier(poke.nature, 'atk'));
  poke.stats.def = calcStat(base.def, poke.iv, poke.evs[2], poke.level, false, natureMultiplier(poke.nature, 'def'));
  poke.stats.spa = calcStat(base.spa, poke.iv, poke.evs[3], poke.level, false, natureMultiplier(poke.nature, 'spa'));
  poke.stats.spd = calcStat(base.spd, poke.iv, poke.evs[4], poke.level, false, natureMultiplier(poke.nature, 'spd'));
  poke.stats.spe = calcStat(base.spe, poke.iv, poke.evs[5], poke.level, false, natureMultiplier(poke.nature, 'spe'));
}

// 【表示専用・副作用なし】ボックス/トレーニング画面（編成用ポケモン。努力値は evPoints={hp,atk,...} の
// 「ポイント制」で、実数値は calcStat(base, iv, 0, level, isHp, natureMod) + ポイント で求める）向けに、
// メガシンカ後の種族値で実数値を計算し直したものを返す。poke本体は一切書き換えない。
// メガシンカ不可、またはX/Yのようにフォームがあるのに未指定の場合はXを代表として使う。
function getMegaPreviewStatsForBoxPokemon(p, formKey) {
  const raw = p && MEGA_EVOLUTION_DATA[p.speciesId];
  if (!raw) return null;
  const data = raw.forms ? (raw.forms[formKey === 'Y' ? 'Y' : 'X']) : raw;
  if (!data) return null;
  const pts = p.evPoints || {};
  const stats = {};
  ['hp', 'atk', 'def', 'spa', 'spd', 'spe'].forEach((k) => {
    const base = data.baseStats[k];
    const nm = k === 'hp' ? 1 : natureMultiplier(p.nature, k);
    const bonus = Math.max(0, Math.min(32, pts[k] || 0));
    stats[k] = calcStat(base, p.iv, 0, p.level, k === 'hp', nm) + bonus;
  });
  return { type1: data.type1, type2: data.type2, ability: data.ability, stats };
}

// 【表示専用・副作用なし】メガシンカ後のタイプ・特性・実数値をプレビューするための情報を返す。
// poke本体は一切書き換えない（ステータス画面の「メガ後を見る」ボタン用）。
// メガシンカ不可な種族の場合はnullを返す。X/Yのようにフォームが複数あり、
// まだmegaFormが確定していない場合はXのデータを代表として返す。
function getMegaPreviewInfo(poke) {
  const raw = poke && MEGA_EVOLUTION_DATA[poke.speciesId];
  if (!raw) return null;
  const data = raw.forms ? (raw.forms[poke.megaForm === 'Y' ? 'Y' : 'X']) : raw;
  if (!data) return null;
  const stats = {
    hp: poke.stats.hp,
    atk: calcStat(data.baseStats.atk, poke.iv, poke.evs[1], poke.level, false, natureMultiplier(poke.nature, 'atk')),
    def: calcStat(data.baseStats.def, poke.iv, poke.evs[2], poke.level, false, natureMultiplier(poke.nature, 'def')),
    spa: calcStat(data.baseStats.spa, poke.iv, poke.evs[3], poke.level, false, natureMultiplier(poke.nature, 'spa')),
    spd: calcStat(data.baseStats.spd, poke.iv, poke.evs[4], poke.level, false, natureMultiplier(poke.nature, 'spd')),
    spe: calcStat(data.baseStats.spe, poke.iv, poke.evs[5], poke.level, false, natureMultiplier(poke.nature, 'spe')),
  };
  return {
    type1: data.type1,
    type2: data.type2,
    ability: data.ability,
    stats,
  };
}

// ポケモンをメガシンカさせる。タイプ・特性・種族値（実数値）を書き換え、
// poke.isMega / poke.megaOriginalSpecies に変更前情報を保持する。
// 実際に呼ばれるタイミングは、両者の技が出そろい行動順が決まった直後（runTurn内）。
function megaEvolve(poke) {
  const raw = MEGA_EVOLUTION_DATA[poke.speciesId];
  if (!raw || poke.isMega) return false;
  // X/Yのフォーム抽選は選出時点（createRandomPokemon）で既に確定しているので、ここでは行わない。
  // 万一（バグ等で）未確定のまま渡ってきた場合の保険としてのみ、ここで抽選する。
  if (raw.forms && !poke.megaForm) {
    poke.megaForm = rand(1, 2) === 1 ? 'X' : 'Y';
  }
  const data = getMegaEvolutionData(poke);
  poke.megaOriginalSpecies = poke.species;
  poke.megaOriginalAbility = poke.ability;
  poke.species = Object.assign({}, poke.species, {
    type1: data.type1,
    type2: data.type2,
    baseStats: data.baseStats,
  });
  poke.ability = data.ability;
  recalcMegaStats(poke, data.baseStats);
  poke.isMega = true;
  // 本家ルール：1回の戦闘でこのサイドはもう他のポケモンをメガシンカさせられない。
  if (poke.side === 'player') battleField.megaUsedPlayer = true;
  else battleField.megaUsedCpu = true;
  return true;
}

// せんりがん：相手の控えポケモンの名前をログに出す。
// 通常の「場に出た時」（applyWeatherTerrainAbilityOnSwitchIn）と、メガシンカで特性が
// せんりがんに変わった瞬間（applyMegaEvolveAbilityTrigger）の両方から呼ぶ共通処理。
function applySenriganAbility(poke, opponent, logFn) {
  if (!poke || poke.fainted || poke.ability !== ABILITY.SENRIGAN) return;
  // 相手側の手持ち全体（battleField.playerTeam/cpuTeam）から、現在場に出ているポケモン以外＝控えを抽出する。
  // チーム参照が渡されていない（何らかの理由でresetFieldにチームが渡らなかった）場合は何もしない。
  const opponentSide = poke.side === 'player' ? 'cpu' : 'player';
  const opponentTeam = opponentSide === 'player' ? battleField.playerTeam : battleField.cpuTeam;
  if (Array.isArray(opponentTeam)) {
    const benched = opponentTeam.filter((p) => p !== opponent);
    if (benched.length > 0) {
      const names = benched.map((p) => p.species.name).join('、');
      logFn(`${poke.species.name}のせんりがん！相手の控えは${names}！`);
    }
  }
}

// おりがみつき：自分が場に出た時、相手の「攻撃」と「特攻」の実数値を入れ替える。
// - 相手が既に何らかの理由で入れ替わっている場合でも、必ず「その時点の攻撃・特攻」を入れ替える
//   （＝2回連続で発動すると元に戻る、という単純なswapでよい。一度の登場で1回だけ呼ばれる前提）。
// - 交代してもこのポケモン（おりがみつき側）が場に居続ける限り効果は継続する。
// - おりがみつき自身が引っ込んだり、バトルが終了したりすれば、相手の実数値は
//   （各バトルでポケモンが毎回新規生成されるため）自動的に元の値に戻る。
// - 相手が既にひんし等で存在しない場合は何もしない。
// - 隠し効果：入れ替える前に、攻撃・特攻のうち低い方を半分にしてから入れ替える
//   （同値の場合は両方とも半分にする）。ログには出さない。
function applyOrigamiTsukiAbility(poke, opponent, logFn) {
  if (!poke || poke.fainted || poke.ability !== ABILITY.ORIGAMI_TSUKI) return;
  if (!opponent || opponent.fainted) return;
  let atk = opponent.stats.atk;
  let spa = opponent.stats.spa;
  if (atk === spa) { atk = Math.floor(atk / 2); spa = Math.floor(spa / 2); }
  else if (atk < spa) atk = Math.floor(atk / 2);
  else spa = Math.floor(spa / 2);
  opponent.stats.atk = spa;
  opponent.stats.spa = atk;
  logFn(`${poke.species.name}のおりがみつき！${opponent.species.name}の攻撃と特攻が入れ替わった！`);
}

// メガシンカで特性が変わった「その瞬間」に発動する特性効果。
// 本家仕様：いかく（例：メガライボルト）・天候セット系（例：メガレックウザ相当のひでり等）・
// フィールドセット系（例：メガライチュウX＝エレキメイカー）は、通常の「場に出た時」だけでなく
// メガシンカで特性が変化した瞬間にも発動する。
// せんりがん（例：メガジュペッタ）はオリジナル特性だが、同様にメガシンカの瞬間にも発動させる。
// トレースも同様に「特性が変化した瞬間」を検知する効果のため、メガシンカで相手の特性が
// 変わった瞬間、場にいるトレース持ちのポケモン（メガシンカした側から見て相手＝opponent）
// がそれをコピーする。本家仕様どおり、コピーされる側（メガシンカした本人）がトレースを
// 持っていた場合は変化後の特性がトレースそのものになるため、その場では何もコピーしない。
// 一方、きけんよち・おみとおし・かがくへんかガスなどは「登場時」専用の効果であり、
// メガシンカ時には発動しないため、ここでは含めない（せんりがんのみ上記のとおり例外）。
function applyMegaEvolveAbilityTrigger(poke, logFn, opponent) {
  if (!poke) return;
  if (opponent && !opponent.fainted && opponent.ability === ABILITY.TRACE && poke.ability !== ABILITY.TRACE) {
    opponent.ability = poke.ability;
    logFn(`${opponent.species.name}は${abilityJp(poke.ability)}をコピーした！`);
  }
  if (poke.ability === ABILITY.IKAKU && opponent && !opponent.fainted) {
    const rankData = [100, -1, 0, 0, 0, 0, 0, 0];
    applyRankChange(opponent, rankData, logFn);
    logFn(`${poke.species.name}のいかくが発動！`);
  }
  // おりがみつき：メガシンカで特性がおりがみつきに変わった瞬間にも、いかく等と同様に発動する。
  applyOrigamiTsukiAbility(poke, opponent, logFn);
  // せんりがん（例：メガジュペッタ）：メガシンカで特性がせんりがんに変わった瞬間に、
  // 相手の控えの名前を見せる。
  applySenriganAbility(poke, opponent, logFn);
  const wKey = WEATHER_SET_ABILITY[poke.ability];
  if (wKey && battleField.weather !== wKey) {
    logFn(`${poke.species.name}の${abilityJp(poke.ability)}が発動！`);
    setWeather(wKey, 5, logFn);
  }
  const tKey = TERRAIN_SET_ABILITY[poke.ability];
  if (tKey && battleField.terrain !== tKey) {
    logFn(`${poke.species.name}の${abilityJp(poke.ability)}が発動！`);
    setTerrain(tKey, 5, logFn);
  }
}

// Level 100固定・個体値31固定・努力値510ランダム配分・性格ランダム・特性ランダム・技はレベル技から選出
function createRandomPokemon(speciesId, level = 100) {
  const species = GAME_DATA.species[speciesId];
  const nature = rand(1, 24);
  const ability = rollAbility(species);
  const moveIds = chooseMoves(species);
  const evs = randomEvSpread(510, 252); // [hp,atk,def,spa,spd,spe]
  const iv = 31;

  const base = species.baseStats;
  const stats = {
    hp: calcStat(base.hp, iv, evs[0], level, true, 1),
    atk: calcStat(base.atk, iv, evs[1], level, false, natureMultiplier(nature, 'atk')),
    def: calcStat(base.def, iv, evs[2], level, false, natureMultiplier(nature, 'def')),
    spa: calcStat(base.spa, iv, evs[3], level, false, natureMultiplier(nature, 'spa')),
    spd: calcStat(base.spd, iv, evs[4], level, false, natureMultiplier(nature, 'spd')),
    spe: calcStat(base.spe, iv, evs[5], level, false, natureMultiplier(nature, 'spe')),
  };

  const moves = moveIds.map((id) => (id ? buildMoveObject(id) : null)).filter(Boolean);
  // 技が1つも選べなかった場合の保険（たいあたり系）
  if (moves.length === 0) {
    const fallback = GAME_DATA.moves[241]; // たいあたり
    if (fallback) moves.push({ id: 241, name: fallback.name, type: fallback.type, power: fallback.power,
      accuracy: fallback.accuracy, category: fallback.category, pp: fallback.pp, maxPp: fallback.pp, priority: 0,
      drainRatio: null, recoilRatio: null, selfDestruct: false, chargeTurn: false,
      damageFormula: null, callRandomMove: false, locked: false });
  }

  const shiny = rand(1, 100) <= 5; // 5%の確率で色違い

  return {
    speciesId, species, level, nature, ability, shiny,
    evs, iv, stats, maxHp: stats.hp, currentHp: stats.hp,
    moves,
    status: STATUS.NONE, badlyPoisonCounter: 0, confuseTurns: 0,
    ranks: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, acc: 0, eva: 0 },
    flinch: false,
    fainted: false,
    fundoTriggered: false,
    moraibiActive: false,
    lazyTurns: false,
    firstTurn: true,
    gyakujouTriggered: false,
    energyStacks: 0,
    tauntTurns: 0, // 挑発ターン
    bindTurns: 0,  // バインド状態残りターン
    shadowTrappedBy: null, // かげぬい：縫い付けた相手への参照。その相手が場にいる限り逃げられない（交代不可）
    // ---- 新規追加 ----
    removedTypes: [],       // 消滅したタイプ（'dark', 'grass' など）
    changedType: null,      // ナナイロレーザーで変化したタイプ（'bug' など）
    typeLockTurns: 0,       // 特定タイプロック残りターン（インフェルノ用）
    typeLockType: null,     // ロックされたタイプ
    lastUsedMoveId: null,   // 前ターンに使った技ID（アンコール用）
    encoreMoveId: null,     // アンコールで強制される技ID
    encoreTurns: 0,         // アンコール残りターン
    utsusemiTurns: 0,       // うつせみカウント（相手に付与）
    izanaiTurns: 0,         // いざない：ねむりになるまでの残りターン（相手に付与）
    originalMoveIds: null,  // ランダムアクト：技が入れ替わる前の元の技ID配列（バトル終了時の復元用）
    infernoUsed: false,     // インフェルノを使用したフラグ
    hengenjizaiUsed: false, // へんげんじざい：場に出てから1回使ったら真になる（交代で復活）
    hengenjizaiType: null,  // へんげんじざいで変化した後の実効タイプ（このポケモンが場にいる間のSTAB・被弾タイプ計算用）
    deaigashiraLocked: false, // であいがしら：登場ターン以外はロック（交代で解除）
    gekirinTurns: 0,        // げきりん：強制連続使用の残りターン数
    gekirinMoveId: null,    // げきりん：強制されている技ID
    mustRechargeTurns: 0,   // はかいこうせん等：反動で次のターン動けない残りターン数
    critRank: 0,            // 急所ランク（きあいだめ等で上昇）。0〜3で急所率テーブルを参照する。
    // ---- メガシンカ ----
    isMega: false,             // メガシンカ中かどうか
    megaOriginalSpecies: null, // メガシンカ前のspeciesオブジェクト（参照用）
    megaOriginalAbility: null, // メガシンカ前の特性ID
    // 複数フォームを持つメガシンカ（例：リザードンX/Y）は、選出時点（このポケモンが生成された時点）で
    // 50/50抽選してフォームを確定させる。単一フォームの種族、メガシンカ非対応の種族はnullのまま。
    megaForm: MEGA_EVOLUTION_DATA[speciesId] && MEGA_EVOLUTION_DATA[speciesId].forms
      ? (rand(1, 2) === 1 ? 'X' : 'Y')
      : null,
    wantsMegaEvolve: false,    // 「メガシンカ」ボタンで予約中かどうか（実際の変身は行動順が来た時）
    // ---- ヨワシ専用：フォルム状態 ----
    // 'solo' = たんどくのすがた（初期値）, 'school' = むれたすがた
    // ID1012（ヨワシ）以外では常に 'solo' のまま未使用。
    // ID1990（アイニーチュ）の場合は初期値null → フォルムチェンジ後は'awakened'。
    formState: (speciesId === YOWASHI_SPECIES_ID) ? 'solo' : null,
    // ---- アイニーチュ専用：フォルムチェンジ済みフラグ ----
    // 一度trueになったら戦闘終了までfalseに戻らない（片道のフォルムチェンジ）。
    aineechuFormed: false,
  };
}

function drawRandomTeam(count = 3, level = 100) {
  const pool = getFinalSpeciesIds();
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  const chosenIds = shuffled.slice(0, count);
  return chosenIds.map((id) => createRandomPokemon(id, level));
}

// メガシンカ可能な種族の中からランダムに1匹選んで生成する。
// メガシンカありのボス戦で「メガシンカ確定枠」を1匹用意するために使う。
function drawRandomMegaCapablePokemon(level = 100) {
  const pool = getFinalSpeciesIds().filter((id) => MEGA_EVOLUTION_DATA[id] && isMegaUsableInBattle(id));
  if (pool.length === 0) return null;
  const id = pool[Math.floor(Math.random() * pool.length)];
  return createRandomPokemon(id, level);
}

// ---- タイプ相性 ----
// 特定の技だけ、通常のタイプ相性とは異なる特殊な相性を持つ場合の対応表。
// TYPE_EFFECTIVENESS_OVERRIDE_MOVES[moveId] = { invertOf: 'grass' } または { forced: {タイプ: 倍率} }
//   弓張月(200)・アネモネルージュ(434)：くさタイプとの相性を反転させる特別な技。
//     例：ほのお（本来くさに1/2＝いまひとつ）→ 2倍（効果抜群）、
//         みず（本来くさに2倍＝効果抜群）→ 1/2倍（いまひとつ）
//   アルカナフール(300)：エスパータイプ技だが、本来無効のはずのあくタイプに対して
//     無効ではなく効果抜群(2倍)になる特別な効果を持つ。
const TYPE_EFFECTIVENESS_OVERRIDE_MOVES = {
  200: { invertOf: 'grass' }, // 弓張月
  434: { invertOf: 'grass' }, // アネモネルージュ
  300: { forced: { dark: 2 } }, // アルカナフール
};

// 高確率急所技（技自体の性質による急所ランク+1補正。きあいだめ等の蓄積とは別枠で、
// 使用したそのターンのみ加算される）。
const HIGH_CRIT_MOVES = new Set([23,125,143,152,163,182,183,204,249,406,264,266,281,303,328,387]);

function getTypeEffectiveness(atkType, defType1, defType2, moveId) {
  const override = moveId != null ? TYPE_EFFECTIVENESS_OVERRIDE_MOVES[moveId] : null;
  const types = [];
  if (defType1) types.push(defType1);
  if (defType2) types.push(defType2);

  let mult = 1;

  if (override && override.invertOf) {
    // 「本来のくさタイプとしての相性表」を参照し、その倍率を反転させる
    const baseChart = GAME_DATA.typeChart[override.invertOf];
    for (const t of types) {
      const baseMult = (baseChart && baseChart[t] !== undefined) ? baseChart[t] : 1;
      const inverted = baseMult === 0 ? 1 : (1 / baseMult);
      mult *= inverted;
    }
    return mult;
  }

  const chart = GAME_DATA.typeChart[atkType];
  for (const t of types) {
    let m = (chart && chart[t] !== undefined) ? chart[t] : 1;
    if (override && override.forced && override.forced[t] !== undefined) {
      m = override.forced[t];
    }
    mult *= m;
  }
  return mult;
}

// ---- 実効タイプ（消失・変化を反映） ----
function getEffectiveTypes(poke) {
  const t1 = poke.species.type1;
  const t2 = poke.species.type2;
  let types = [];
  if (poke.hengenjizaiType) {
    types = [poke.hengenjizaiType];
  } else if (poke.changedType) {
    types = [poke.changedType];
  } else {
    if (t1 && !poke.removedTypes.includes(t1)) types.push(t1);
    if (t2 && !poke.removedTypes.includes(t2)) types.push(t2);
  }
  // 重複排除
  return [...new Set(types)];
}

// ---- ランク補正 ----
function rankMultiplier(rank) {
  if (rank >= 0) return (2 + rank) / 2;
  return 2 / (2 - rank);
}
function accEvaMultiplier(rank) {
  if (rank >= 0) return (3 + rank) / 3;
  return 3 / (3 - rank);
}

// ---- 特性ID定数 ----
const ABILITY = {
  SHINRYOKU: 41,
  MOUKA: 42,
  GEKIRYUU: 43,
  MUSHINOSHIRASE: 44,
  GANJOU: 5,
  HANDOUMUKOU: 45,
  CHIKUDEN: 9,
  CHOSUI: 10,
  MORAIBI: 14,
  MUSHIYOKE: 101,
  KABUTO_ARMOR: 4,
  KIZUTSUKEBODY: 17,
  CHIKARAMOCHI: 25,
  HIDERI: 46,
  SUNAOKOSHI: 31,
  AMEFURASHI: 2,
  YUKIFURASHI: 57,
  HOSHINOMADOROMI: 138,
  GRASS_MAKER: 116,
  ELECTRIC_MAKER: 117,
  PSYCHIC_MAKER: 118,
  MIST_MAKER: 119,
  MELODY_MAKER: 120,
  SUISUI: 23,
  YOURYOKUSO: 24,
  YUKIKAKI: 59,
  SUNAKAKI: 60,
  AMEUKEZARA: 30,
  SUN_POWER: 96,
  ICE_BREAK: 100,
  JUUNAN: 6,
  SEIDENKI: 8,
  FUMIN: 11,
  KONJOU: 39,
  FUSHIGINA_UROKO: 40,
  FUSHOKU: 54,
  HAYAASHI: 63,
  FUSHOKU_NO_TOGE: 131,
  HONOO_NO_KARADA: 34,
  FUYU: 19,
  RESONANCE: 72,
  KYOKKOU: 73,
  SKIN_FREEZE: 80,
  SKIN_ELECTRIC: 81,
  SKIN_DRAGON: 82,
  SKIN_PSYCHIC: 83,
  JISHINKAJOU: 112,
  AFURERUCHISHIKI: 113,
  FUNDO: 133,
  KASOKU: 3,
  IKAKU: 16,
  PRESSURE: 32,
  ATSUI_SHIBOU: 33,
  NAMAKE: 36,
  FUKUGAN: 51,
  TECHNICIAN: 53,
  TEN_NO_MEGUMI: 56,
  FAIRY_SKIN: 62,
  MULTISCALE: 64,
  AMANOJAKU: 65,
  CHIKARAZUKU: 66,
  CLEAR_BODY: 67,
  TEKIOURYOKU: 68,
  NO_GUARD: 69,
  KATAI_TSUME: 70,
  ITAZURA_GOKORO: 71,
  KYOUUN: 74,
  KATAYABURI: 75,
  TRACE: 76,
  HARD_ROCK: 77,
  SNIPER: 78,
  HARIKIRI: 79,
  HAYATE_NO_TSUBASA: 84,
  SEISHINRYOKU: 90,
  ARUKOBARENO: 91,
  SURUDOIME: 92,
  SUNA_NO_CHIKARA: 93,
  SOUSHOKU: 94,
  MURAKKE: 95,
  RINPUN: 97,
  MAKENKI: 98,
  KACHIKI: 99,
  JIKYUURYOKU: 102,
  KUDAKERU_YOROI: 103,
  YUUBABU: 104,
  KIREEJI: 86,
  GANJOUAGO: 87,
  MEGALAUNCHER: 88,
  TETSUNOKOBUSHI: 89,
  NOROWARE_BODY: 105,
  KAGAKUHENKAGASU: 106,
  SAISEIRYOKU: 107,
  BINJOU: 108,
  GYAKUJOU: 109,
  OMITOOSHI: 110,
  KIKIKAIHI: 111,   // きけんよち（オリジナル）
  SONIC_GUARD: 126,
  FAIR_COAT: 127,
  KOORI_NO_RINPUN: 128,
  TOUSOUSHIN: 129,
  TANJUN: 132,
  ENERGY_PERMANENT: 134,
  RAIL_GUN: 135,
  ENERGY_ENGINE: 136,
  ENERGY_SOUL: 137,
  SKILL_LINK: 115,
  MAGIC_MIRROR: 125,
  SURINUKE: 123,
  KIKENYOCHI_2: 122,
  KAGEFUMI: 121,
  NERVOUS_RAGE: 124,
  HAKKOU: 85,
  TOBIDASU_HABANERO: 140,
  SKY_SKIN: 141,
  HENGENJIZAI: 142,
  OYAKOAI: 139,
  HANASANAI: 143,   // はなさない！（オリジナル）：ドレインの回復効果が+25%される
  FUANTEI: 144,     // ふあんてい（オリジナル）：お互い急所ランク+2
  FURUERUTOUSHI: 145, // ふるえるとうし（オリジナル）：瀕死の味方の数だけ攻撃・特攻が1.1倍
  ICHIJINNOKAZE: 146, // いちじんのかぜ（オリジナル）：自分が瀕死になると自分の場においかぜ4ターン
  TENNEN: 147,        // てんねん（本家通り）：能力ランク補正を無視する
  MAENOMERI: 148,     // まえのめり（オリジナル）：相手を倒すたび素早さランク+1
  SENRIGAN: 149,      // せんりがん（オリジナル）：場に出た時、相手の控えポケモンの名前が分かる
  RANDOM_ACT: 150,    // ランダムアクト（オリジナル）：物理技の威力1.2倍／ターン終了時に自分の技が全てランダムに変化する
  IZANAI: 151,        // いざない（オリジナル）：相手から攻撃を受けた時、相手は2ターン後にねむりになる
  MEGA_SOLAR: 152,    // メガソーラー（本家メガメガニウム）：自分が攻撃する間だけ「ひでり」と同じ効果を受ける（実際の天候は変わらない）
  HAGANE_TSUKAI: 153, // はがねつかい（オリジナル）：鋼技の威力1.2倍
  UMI_NO_RUNE: 154,   // うみのルーン（オリジナル）：水技の威力1.2倍
  ORIGAMI_TSUKI: 155, // おりがみつき（オリジナル）：自分が場に出るたび、相手の攻撃と特攻の実数値を入れ替える
};

const KIKENYOCHI_ABILITIES = [ABILITY.KIKIKAIHI, ABILITY.KIKENYOCHI_2];

// スキン系特性：ノーマル技をそれぞれのタイプに変える特性のマッピング。
// executeMove（ダメージ計算・実際の技実行）と、ui.js側の技メニュー表示
// （アイコン・タイプ枠のプレビュー表示）の両方から参照する共通定義。
const SKIN_TYPE_MAP = {
  [ABILITY.SKIN_FREEZE]: 'ice',
  [ABILITY.SKIN_ELECTRIC]: 'electric',
  [ABILITY.SKIN_DRAGON]: 'dragon',
  [ABILITY.SKIN_PSYCHIC]: 'psychic',
  [ABILITY.FAIRY_SKIN]: 'fairy',
  [ABILITY.SKY_SKIN]: 'flying',
};

const WEATHER_SET_ABILITY = {
  [ABILITY.HIDERI]: 'sun',
  [ABILITY.SUNAOKOSHI]: 'sand',
  [ABILITY.AMEFURASHI]: 'rain',
  [ABILITY.YUKIFURASHI]: 'snow',
  [ABILITY.HOSHINOMADOROMI]: 'starrysky',
};
const TERRAIN_SET_ABILITY = {
  [ABILITY.GRASS_MAKER]: 'grassy',
  [ABILITY.ELECTRIC_MAKER]: 'electric',
  [ABILITY.PSYCHIC_MAKER]: 'psychic',
  [ABILITY.MIST_MAKER]: 'misty',
  [ABILITY.MELODY_MAKER]: 'melody',
};
const WEATHER_SPEED_BOOST_ABILITY = {
  [ABILITY.SUISUI]: 'rain',
  [ABILITY.YOURYOKUSO]: 'sun',
  [ABILITY.YUKIKAKI]: 'snow',
  [ABILITY.SUNAKAKI]: 'sand',
};

function hasMajorStatus(poke) {
  return poke.status && poke.status !== STATUS.NONE;
}

// 実効素早さ
function effectiveSpeed(poke) {
  let spe = poke.stats.spe * rankMultiplier(poke.ranks.spe);
  const weatherKey = WEATHER_SPEED_BOOST_ABILITY[poke.ability];
  if (weatherKey && battleField.weather === weatherKey) spe *= 2;
  if (poke.ability === ABILITY.HAYAASHI && hasMajorStatus(poke)) spe *= 1.5;
  const tailwindTurns = poke.side === 'player' ? battleField.tailwindPlayer : battleField.tailwindCpu;
  if (tailwindTurns > 0) spe *= 2;
  return spe;
}

const PINCH_BOOST_ABILITY_TYPE = {
  [ABILITY.SHINRYOKU]: 'grass',
  [ABILITY.MOUKA]: 'fire',
  [ABILITY.GEKIRYUU]: 'water',
  [ABILITY.MUSHINOSHIRASE]: 'bug',
};

const TYPE_ABSORB_ABILITY_TYPE = {
  [ABILITY.CHIKUDEN]: 'electric',
  [ABILITY.CHOSUI]: 'water',
  [ABILITY.MORAIBI]: 'fire',
  [ABILITY.MUSHIYOKE]: 'bug',
  [ABILITY.SOUSHOKU]: 'grass',
};

const KIRU_MOVE_IDS = [1,23,45,68,150,152,168,183,187,247,266,281,32,328,387,389,406];
const KAMU_MOVE_IDS = [24,25,28,124,61,261,222,284,206,348];
const HADOU_MOVE_IDS = [504,117,218,334,32,54,112,352,376,394,501];
const KOBUSHI_MOVE_IDS = [461,62,84,102,106,107,117,122,164,223,226,250,324,327];
const ENERGY_CHARGE_MOVE_IDS = [66,77,79,83,97,115,127,157,177,184,218,225,294,315,334];

const MULTI_HIT_MOVES = {
  461: { maxHits: 5, minHits: 2, fixed: false, powerStep: 0, basePower: 25 },
  48:  { maxHits: 5, minHits: 2, fixed: false, powerStep: 0, basePower: 25 },
  229: { maxHits: 3, minHits: 3, fixed: true,  powerStep: 20, basePower: 20 },
  309: { maxHits: 5, minHits: 2, fixed: false, powerStep: 0, basePower: 25 },
  367: { maxHits: 5, minHits: 2, fixed: false, powerStep: 0, basePower: 35 },
  388: { maxHits: 5, minHits: 2, fixed: false, powerStep: 0, basePower: 50 },
  472: { maxHits: 6, minHits: 6, fixed: true,  powerStep: 5, basePower: 10 },
  189: { maxHits: 5, minHits: 2, fixed: false, powerStep: 0, basePower: 25 },
};

// ---- エナジースタック操作 ----
function addEnergyStacks(poke, amount, logFn) {
  if (!poke || poke.fainted) return;
  const before = poke.energyStacks;
  poke.energyStacks += amount;
  if (logFn) logFn(`${poke.species.name}の<img src="./energy.png" class="inline-stat-icon" onerror="this.style.visibility='hidden'">が${amount}増えた！（現在${poke.energyStacks}）`);

  const gasActive = battleField.chemicalGasActive;
  const gasImmune = poke.ability === ABILITY.KAGAKUHENKAGASU;

  if (poke.ability === ABILITY.ENERGY_ENGINE && !(gasActive && !gasImmune)) {
    const speCount = Math.floor(poke.energyStacks / 2) - Math.floor(before / 2);
    const defSpdCount = Math.floor(poke.energyStacks / 3) - Math.floor(before / 3);
    for (let i = 0; i < speCount; i++) {
      applyRankChange(poke, [100, 0, 0, 0, 0, 1, 0, 0], logFn);
    }
    for (let i = 0; i < defSpdCount; i++) {
      applyRankChange(poke, [100, 0, 2, 0, 2, 0, 0, 0], logFn);
    }
    if (speCount > 0 || defSpdCount > 0) {
      logFn(`${poke.species.name}のエナジーエンジンが発動！`);
    }
  }
}

function consumeEnergyStacks(poke, logFn) {
  if (!poke || poke.fainted) return 0;
  const consumed = poke.energyStacks;
  poke.energyStacks = 0;
  return consumed;
}

// ---- ランク変化適用 ----
// opponent: このランク変化を「見ている」targetの対戦相手（びんじょう判定用）。
// 省略された場合はびんじょうの発動チェックを行わない。
function applyRankChange(target, rankData, logFn, attackerAbility, opponent) {
  if (!rankData) return;
  const chance = rankData[0] ?? 100;
  if (rand(1, 100) > chance) return;
  const keys = ['atk', 'def', 'spa', 'spd', 'spe', 'acc', 'eva'];
  let changed = false;
  const statName = { atk: 'こうげき', def: 'ぼうぎょ', spa: 'とくこう', spd: 'とくぼう', spe: 'すばやさ', acc: 'めいちゅう', eva: 'かいひ' };
  // 同じ変化幅（changePhrase）ごとにステータス名をまとめて、まとめてログ出力するためのバッファ。
  // 例：「こうげきとすばやさと命中率が上がった！」「ぼうぎょととくぼうが下がった！」
  const groups = new Map(); // changePhrase -> [statName, ...]
  const pushGroup = (phrase, name) => {
    if (!groups.has(phrase)) groups.set(phrase, []);
    groups.get(phrase).push(name);
  };
  const flushGroups = () => {
    groups.forEach((names, phrase) => {
      const rankMeta = phrase.includes('上がった')
        ? { rankChange: 'up', rankSide: target.side }
        : { rankChange: 'down', rankSide: target.side };
      logFn(`${target.species.name}の${formatStatNameList(names)}が\n${phrase}`, rankMeta);
    });
    groups.clear();
  };

  keys.forEach((k, idx) => {
    let delta = rankData[idx + 1];
    if (!delta) return;

    // かがくへんかガス：無効になるのは「ランク変化に関わる特性の効果」だけで、
    // ランク変化そのものは通常どおり発生する（ガス中の特性判定は abilityActive で行う）。
    const targetAbilityOn = abilityActive(target);
    if (targetAbilityOn && target.ability === ABILITY.CLEAR_BODY && delta < 0) return;
    // はっこう：自分の命中率ランクが下がらない
    if (targetAbilityOn && target.ability === ABILITY.HAKKOU && k === 'acc' && delta < 0) return;
    if (targetAbilityOn && target.ability === ABILITY.TANJUN) delta *= 2;
    if (targetAbilityOn && target.ability === ABILITY.AMANOJAKU) delta = -delta;

    const before = target.ranks[k];
    target.ranks[k] = Math.max(-6, Math.min(6, target.ranks[k] + delta));
    if (target.ranks[k] !== before) {
      changed = true;
      const actualDelta = target.ranks[k] - before;
      let changePhrase;
      if (actualDelta >= 3) changePhrase = 'ぐぐーんと上がった！';
      else if (actualDelta === 2) changePhrase = 'ぐーんと上がった！';
      else if (actualDelta === 1) changePhrase = '上がった！';
      else if (actualDelta === -1) changePhrase = '下がった！';
      else if (actualDelta === -2) changePhrase = 'ガクッと下がった！';
      else changePhrase = 'ガクッと下がった！';
      pushGroup(changePhrase, statName[k]);

      // びんじょう：相手（target）のランクが上がったとき、びんじょうを持つ
      // 自分（opponent）が、上がったのと同じ項目・同じ段階だけランクが上がる。
      // 「上がったポケモン自身が全ステータス上昇する」という誤った効果になっていたため修正。
      // target自身はびんじょうの対象外（自分の上昇に自分で反応しない）。発動者が瀕死なら発動しない。
      if (delta > 0 && opponent && opponent !== target && !opponent.fainted && opponent.ability === ABILITY.BINJOU && abilityActive(opponent)) {
        flushGroups();
        const binjouDelta = keys.map((kk) => (kk === k ? actualDelta : 0));
        const binjouData = [100, ...binjouDelta];
        applyRankChange(opponent, binjouData, logFn, opponent.ability);
        logFn(`${opponent.species.name}のびんじょうが発動！`);
      }

      if (delta < 0) {
        if (k === 'atk' && target.ability === ABILITY.MAKENKI && targetAbilityOn) {
          flushGroups();
          const boostData = [100, 2, 0, 0, 0, 0, 0, 0];
          applyRankChange(target, boostData, logFn);
          logFn(`${target.species.name}のまけんきが発動！`);
        }
        if (k === 'spa' && target.ability === ABILITY.KACHIKI && targetAbilityOn) {
          flushGroups();
          const boostData = [100, 0, 0, 2, 0, 0, 0, 0];
          applyRankChange(target, boostData, logFn);
          logFn(`${target.species.name}のかちきが発動！`);
        }
      }
    }
  });
  flushGroups();
  return changed;
}

// ステータス名の配列を「AとBとC」の形式に整形する（1つなら単体、複数なら「と」で連結）。
function formatStatNameList(names) {
  return names.join('と');
}

function applyStatus(target, statusData, logFn, attackerAbility) {
  if (!statusData) return false;
  let chance = statusData[0] ?? 100;
  const statusId = statusData[1];
  if (!statusId) return false;

  // かがくへんかガス：状態異常そのものは通常どおり入る。無効になるのは特性の効果のみ。
  if (abilityActive(target) && target.ability === ABILITY.ARUKOBARENO) return false;

  if (statusId === STATUS.CONFUSE) {
    if (target.confuseTurns > 0) return false;
  } else if (target.status !== STATUS.NONE) {
    return false;
  }

  if (attackerAbility === ABILITY.TEN_NO_MEGUMI) chance = Math.min(100, chance * 2);

  if (rand(1, 100) > chance) return false;
  const t1 = target.species.type1, t2 = target.species.type2;
  const bypassPoisonImmunity = attackerAbility === ABILITY.FUSHOKU;
  if ((statusId === STATUS.POISON || statusId === STATUS.BADLY_POISON) && !bypassPoisonImmunity) {
    if (t1 === 'poison' || t2 === 'poison' || t1 === 'steel' || t2 === 'steel') return false;
  }
  if (statusId === STATUS.BURN && (t1 === 'fire' || t2 === 'fire')) return false;
  if (statusId === STATUS.FREEZE && (t1 === 'ice' || t2 === 'ice')) return false;
  if (statusId === STATUS.PARALYZE && (t1 === 'electric' || t2 === 'electric')) return false;
  if (statusId === STATUS.PARALYZE && target.ability === ABILITY.JUUNAN && abilityActive(target)) return false;
  if (statusId === STATUS.SLEEP && target.ability === ABILITY.FUMIN && abilityActive(target)) return false;
  if (statusId === STATUS.SLEEP && battleField.terrain === 'electric') return false;
  if (battleField.terrain === 'misty' &&
      [STATUS.PARALYZE, STATUS.BURN, STATUS.POISON, STATUS.BADLY_POISON, STATUS.SLEEP, STATUS.FREEZE].includes(statusId)) {
    return false;
  }
  if (statusId === STATUS.CONFUSE && battleField.terrain === 'psychic') return false;
  if (statusId === STATUS.CONFUSE) {
    target.confuseTurns = rand(1, 4);
    logFn(`${target.species.name}は${STATUS_JP[statusId]}になった！`, {
      statusApply: target.side,
      hpSnapshot: target.currentHp,
      statusSnapshot: target.status || STATUS.NONE,
      confuseSnapshot: target.confuseTurns || 0,
    });
    return true;
  }
  target.status = statusId;
  if (statusId === STATUS.BADLY_POISON) target.badlyPoisonCounter = 1;
  if (statusId === STATUS.SLEEP) target.sleepTurns = rand(1, 3);
  logFn(`${target.species.name}は${STATUS_JP[statusId]}になった！`, {
    statusApply: target.side,
    hpSnapshot: target.currentHp,
    statusSnapshot: target.status || STATUS.NONE,
    confuseSnapshot: target.confuseTurns || 0,
  });
  return true;
}

// ---- 天候・フィールド ----
const WEATHER_JP = {
  none: 'なし', sun: 'ひでり', rain: 'あめ', sand: 'すなあらし', snow: 'ゆき', starrysky: 'ほしぞら',
};
const TERRAIN_JP = {
  none: 'なし', grassy: 'グラスフィールド', electric: 'エレキフィールド',
  psychic: 'サイコフィールド', misty: 'ミストフィールド', melody: 'メロディフィールド',
};
const STARRY_SKY_BOOST_MOVE_IDS = [53, 93, 252, 327, 336, 451, 482];
const GRASSY_HALVED_MOVE_IDS = [201, 203];

const battleField = {
  weather: 'none', weatherTurns: 0,
  terrain: 'none', terrainTurns: 0,
  chemicalGasActive: false,
  playerReflect: 0,
  playerLightScreen: 0,
  cpuReflect: 0,
  cpuLightScreen: 0,
  tailwindPlayer: 0,
  tailwindCpu: 0,
  trickRoom: false,
  trickRoomTurns: 0,
  // 本家と同様、1回の戦闘で各トレーナー（プレイヤー/相手）につき1匹しかメガシンカできない。
  // 誰か1匹がメガシンカした時点で、そのサイドは以降このバトル中ずっとメガシンカ不可になる。
  megaUsedPlayer: false,
  megaUsedCpu: false,
  // ふるえるとうし（味方の瀕死数を参照するため）・いちじんのかぜ（自分の場においかぜ）用に、
  // バトル中の手持ち全体への参照をここに保持する。ui.js側からresetField()呼び出し時に渡される。
  playerTeam: null,
  cpuTeam: null,
};

function resetField(playerTeam, cpuTeam) {
  battleField.weather = 'none';
  battleField.weatherTurns = 0;
  battleField.terrain = 'none';
  battleField.terrainTurns = 0;
  battleField.chemicalGasActive = false;
  battleField.playerReflect = 0;
  battleField.playerLightScreen = 0;
  battleField.cpuReflect = 0;
  battleField.cpuLightScreen = 0;
  battleField.tailwindPlayer = 0;
  battleField.tailwindCpu = 0;
  battleField.trickRoom = false;
  battleField.trickRoomTurns = 0;
  battleField.megaUsedPlayer = false;
  battleField.megaUsedCpu = false;
  battleField.playerTeam = Array.isArray(playerTeam) ? playerTeam : null;
  battleField.cpuTeam = Array.isArray(cpuTeam) ? cpuTeam : null;
}

// ふるえるとうし用：指定したポケモンと同じ側（自分の手持ち）の中で瀕死になっている数を数える。
// battleField.playerTeam/cpuTeamが未設定（チーム参照が渡されていない）の場合は0を返す。
function countFaintedAllies(poke) {
  const team = poke.side === 'player' ? battleField.playerTeam : battleField.cpuTeam;
  if (!Array.isArray(team)) return 0;
  return team.filter((p) => p.fainted).length;
}

function setWeather(key, turns, logFn) {
  battleField.weather = key;
  battleField.weatherTurns = turns;
  const msg = {
    sun: 'ひざしが　つよくなった！',
    rain: 'あめが　ふりはじめた！',
    sand: 'すなあらしが　ふきあれる！',
    snow: 'ゆきが　ふりはじめた！',
    starrysky: 'そらに　ほしが　またたきはじめた！',
  }[key];
  // weatherFx: UI側で天候発動時の画面演出（背景エフェクト）を出すための合図。
  if (msg) logFn(msg, { weatherFx: key });
}

function setTerrain(key, turns, logFn) {
  battleField.terrain = key;
  battleField.terrainTurns = turns;
  const msg = {
    grassy: 'あしもとに　草が　しげった！',
    electric: 'あたりに　でんきが　はしった！',
    psychic: 'あたりが　ふしぎな　かんじに　なった！',
    misty: 'あたりに　きりが　ひろがった！',
    melody: 'すてきな　メロディが　ながれはじめた！',
  }[key];
  // weatherFx: UI側でフィールド発動時の画面演出（背景エフェクト）を出すための合図。
  // 天候（setWeather）と同じ仕組みをそのまま流用する。
  if (msg) logFn(msg, { weatherFx: key });
}

// 交代／登場時処理
function applyWeatherTerrainAbilityOnSwitchIn(poke, logFn, opponent) {
  if (!poke || poke.fainted) return;
  // へんげんじざい：場に出るたびに1回分の効果を復活させる
  poke.hengenjizaiUsed = false;
  poke.hengenjizaiType = null;
  // かげぬい：場に出るたびに縫い止めをリセットする（控えから戻った時に持ち越さない）
  poke.shadowTrappedBy = null;
  // ヨワシ：登場時、残りHPに応じて「むれたすがた」⇔「たんどくのすがた」を判定する。
  // 登場直後は直後のsetSpriteで既に正しい画像が出るため、演出（魚が集まる等）は再生しない。
  updateYowashiForm(poke, logFn, false);
  if (poke.ability === ABILITY.KAGAKUHENKAGASU) {
    battleField.chemicalGasActive = true;
    logFn(`${poke.species.name}の${abilityJp(poke.ability)}が発動！`);
  }
  if (poke.ability === ABILITY.TRACE && opponent && !opponent.fainted) {
    poke.ability = opponent.ability;
    logFn(`${poke.species.name}は${abilityJp(opponent.ability)}をコピーした！`);
  }
  if (poke.ability === ABILITY.IKAKU && opponent && !opponent.fainted) {
    const rankData = [100, -1, 0, 0, 0, 0, 0, 0];
    applyRankChange(opponent, rankData, logFn);
    logFn(`${poke.species.name}のいかくが発動！`);
  }
  applyOrigamiTsukiAbility(poke, opponent, logFn);
  if (KIKENYOCHI_ABILITIES.includes(poke.ability) && opponent && !opponent.fainted) {
    const dangerousMoves = opponent.moves.filter(m => {
      if (!m) return false;
      if (m.category === 'status') return true;
      return (m.power || 0) >= 80;
    });
    const shuffled = [...dangerousMoves].sort(() => Math.random() - 0.5);
    const shown = shuffled.slice(0, 2);
    if (shown.length > 0) {
      const names = shown.map(m => m.name).join('、');
      logFn(`${poke.species.name}のきけんよち！相手の危険な技：${names}`);
    } else {
      logFn(`${poke.species.name}のきけんよち！相手に危険な技はなさそうだ…`);
    }
  }
  if (poke.ability === ABILITY.OMITOOSHI && opponent && !opponent.fainted) {
    logFn(`${poke.species.name}のおみとおし！相手の特性は${abilityJp(opponent.ability)}！`);
  }
  applySenriganAbility(poke, opponent, logFn);

  const wKey = WEATHER_SET_ABILITY[poke.ability];
  if (wKey && battleField.weather !== wKey) {
    logFn(`${poke.species.name}の${abilityJp(poke.ability)}が発動！`);
    setWeather(wKey, 5, logFn);
  }
  const tKey = TERRAIN_SET_ABILITY[poke.ability];
  if (tKey && battleField.terrain !== tKey) {
    logFn(`${poke.species.name}の${abilityJp(poke.ability)}が発動！`);
    setTerrain(tKey, 5, logFn);
  }
}

// ---- メガソーラー：攻撃時の実効天候 ----
// メガソーラー持ちが攻撃する間だけ、その攻撃に関わる天候判定を「ひざしがつよい(ひでり)」として扱う。
// 実際の天候（battleField.weather）は書き換えない。そのため、あめ・すなあらし・ゆき・ほしぞら中でも
//   ・ほのお技はひでりの1.5倍を受け、みず技は半減する（実天候があめでも半減は起きない）
//   ・ウェザーボールはほのお・威力2倍になる
//   ・すなあらしのいわ特防補正／ゆきのこおり防御補正は乗らない（攻撃中は晴れ扱いのため）
// 特性がかがくへんかガスで無効化されている場合は通常どおり実際の天候で判定する。
function isMegaSolarActive(poke) {
  if (!poke || poke.ability !== ABILITY.MEGA_SOLAR) return false;
  return !battleField.chemicalGasActive || poke.ability === ABILITY.KAGAKUHENKAGASU;
}
function getAttackWeather(attacker) {
  return isMegaSolarActive(attacker) ? 'sun' : battleField.weather;
}

// ---- ダメージ計算（壁対応） ----
function calcDamage(attacker, defender, move, logFn) {
  // ふゆう（実効タイプを使用）
  const defTypes = getEffectiveTypes(defender);

  // メガソーラー：この攻撃の間だけ天候を「ひでり」として扱う（実天候はそのまま）
  const effWeather = getAttackWeather(attacker);

  // ウェザーボール(503)・だいちのはどう(504)：
  // 天候／フィールドに対応があれば、そのタイプに変化しダメージ2倍（原作仕様）。
  // 対応がない場合（天候・フィールドなし等）はノーマルタイプ・威力そのまま。
  // メガソーラー持ちが撃つ場合は、実際の天候に関わらずひでり扱い（ほのお・威力100）になる。
  const effMoveType = resolveEffectiveMoveType(move, battleField, attacker);
  const weatherBallBoosted = (move.id === 503 || move.id === 504) && effMoveType !== move.type;
  const effMovePower = weatherBallBoosted ? move.power * 2 : move.power;
  if (weatherBallBoosted && logFn) {
    logFn(`${typeJp(effMoveType)}タイプに変わり、威力が${effMovePower}になった！`);
  }
  move = { ...move, type: effMoveType, power: effMovePower };

  if (defender.ability === ABILITY.FUYU && move.type === 'ground' && attacker.ability !== ABILITY.KATAYABURI) {
    if (!battleField.chemicalGasActive || defender.ability === ABILITY.KAGAKUHENKAGASU) {
      return { damage: 0, typeMult: 0, isCrit: false };
    }
  }

  const level = attacker.level;
  const isPhysical = move.category === 'physical';

  const ignoreWalls = attacker.ability === ABILITY.SURINUKE;

  let atkStat, defStat, atkRank, defRank;
  switch (move.damageFormula) {
    case 'selfDefVsOppDef':
      atkStat = attacker.stats.def; defStat = defender.stats.def;
      atkRank = attacker.ranks.def; defRank = defender.ranks.def;
      break;
    case 'selfSpaVsOppDef':
      atkStat = attacker.stats.spa; defStat = defender.stats.def;
      atkRank = attacker.ranks.spa; defRank = defender.ranks.def;
      break;
    case 'selfAtkVsOppSpd':
      // ふゆのひざし：自分の攻撃 × 相手の特防で計算する物理技
      atkStat = attacker.stats.atk; defStat = defender.stats.spd;
      atkRank = attacker.ranks.atk; defRank = defender.ranks.spd;
      break;
    case 'oppSpaVsOppSpd':
      atkStat = defender.stats.spa; defStat = defender.stats.spd;
      atkRank = defender.ranks.spa; defRank = defender.ranks.spd;
      break;
    case 'oppAtkVsOppDef':
      atkStat = defender.stats.atk; defStat = defender.stats.def;
      atkRank = defender.ranks.atk; defRank = defender.ranks.def;
      break;
    default:
      atkStat = isPhysical ? attacker.stats.atk : attacker.stats.spa;
      defStat = isPhysical ? defender.stats.def : defender.stats.spd;
      atkRank = isPhysical ? attacker.ranks.atk : attacker.ranks.spa;
      defRank = isPhysical ? defender.ranks.def : defender.ranks.spd;
  }

  // てんねん：atkRankは常に「攻撃側の攻撃力に乗る攻撃系ランク」、defRankは常に「防御側の防御力に乗る防御系ランク」
  // という意味で使われる。本家仕様は「攻撃系ランクを無視するかどうかは防御側(defender)のてんねんで決まり、
  // 防御系ランクを無視するかどうかは攻撃側(attacker)のてんねんで決まる」ため、
  // 実際のステータス参照元に関わらず一律にこの条件で判定する。
  // ログは実際に0以外だったランクを無視した（＝効果に意味があった）時だけ出す。
  if (defender.ability === ABILITY.TENNEN && atkRank !== 0) {
    if (logFn) logFn(`${defender.species.name}の${abilityJp(ABILITY.TENNEN)}が発動！能力変化を無視した！`);
    atkRank = 0;
  }
  if (attacker.ability === ABILITY.TENNEN && defRank !== 0) {
    if (logFn) logFn(`${attacker.species.name}の${abilityJp(ABILITY.TENNEN)}が発動！能力変化を無視した！`);
    defRank = 0;
  }

  if (attacker.ability === ABILITY.CHIKARAMOCHI && isPhysical && move.damageFormula !== 'oppAtkVsOppDef') {
    if (!battleField.chemicalGasActive || attacker.ability === ABILITY.KAGAKUHENKAGASU) {
      atkStat *= 2;
      if (logFn) logFn(`${attacker.species.name}の${abilityJp(attacker.ability)}が発動！攻撃が2倍になった！`);
    }
  }

  // ふるえるとうし：瀕死になっている味方の数だけ攻撃・特攻が1.1倍（乗算）される常在特性。
  // 「自分自身のステータス」を参照する計算式（oppAtkVsOppDef以外）にのみ適用する。
  if (attacker.ability === ABILITY.FURUERUTOUSHI && move.damageFormula !== 'oppAtkVsOppDef') {
    if (!battleField.chemicalGasActive || attacker.ability === ABILITY.KAGAKUHENKAGASU) {
      const faintedAllyCount = countFaintedAllies(attacker);
      if (faintedAllyCount > 0) {
        atkStat *= Math.pow(1.1, faintedAllyCount);
        if (logFn) logFn(`${attacker.species.name}の${abilityJp(attacker.ability)}が発動！力がわきあがる！`);
      }
    }
  }

  // ふあんてい：この特性を持つポケモンが場にいると、お互い急所ランク+2になる常在特性。
  // attacker・defenderのどちらが持っていても両者に影響するため、片方でも該当すれば加算する
  // （相手の番になれば今度はattacker/defenderが入れ替わって同じ判定が走るので、結果的に双方に適用される）。
  const fuanteiActive = (attacker.ability === ABILITY.FUANTEI || defender.ability === ABILITY.FUANTEI) &&
    (!battleField.chemicalGasActive ||
      attacker.ability === ABILITY.KAGAKUHENKAGASU || defender.ability === ABILITY.KAGAKUHENKAGASU);
  if (fuanteiActive && logFn) {
    const fuanteiPoke = attacker.ability === ABILITY.FUANTEI ? attacker : defender;
    logFn(`${fuanteiPoke.species.name}の${abilityJp(ABILITY.FUANTEI)}が発動！お互い急所に当たりやすくなっている！`);
  }

  // 急所ランク：きあいだめ等で加算された attacker.critRank、高確率急所技による+1、
  // きょううん特性による補正(+1ランク相当)、ふあんてい特性による+2を合算して急所率を決める。
  // ランク0=1/16, 1=1/8, 2=1/2, 3以上=1/1（このゲームの基準1/16をベースにした簡易テーブル）。
  const effectiveCritRank = (attacker.critRank || 0)
    + (HIGH_CRIT_MOVES.has(move.id) ? 1 : 0)
    + (attacker.ability === ABILITY.KYOUUN ? 1 : 0)
    + (fuanteiActive ? 2 : 0);
  const CRIT_CHANCE_TABLE = [1 / 16, 1 / 8, 1 / 2, 1];
  const critChance = CRIT_CHANCE_TABLE[Math.min(effectiveCritRank, 3)];
  const isCrit = defender.ability === ABILITY.KABUTO_ARMOR ? false : Math.random() < critChance;

  let effAtk = isCrit && atkRank < 0 ? atkStat : atkStat * rankMultiplier(atkRank);
  let effDef = isCrit && defRank > 0 ? defStat : defStat * rankMultiplier(defRank);

  const isAtkStat = atkStat === attacker.stats.atk;
  const isSpaStat = atkStat === attacker.stats.spa;
  const isDefSpd = (defStat === defender.stats.spd);
  const isDefDef = (defStat === defender.stats.def);
  if (effWeather === 'sand' && isDefSpd && defTypes.includes('rock')) effDef *= 1.5;
  if (effWeather === 'snow' && isDefDef && defTypes.includes('ice')) effDef *= 1.5;
  if (attacker.ability === ABILITY.KONJOU && attacker.status === STATUS.BURN && isAtkStat) {
    if (!battleField.chemicalGasActive || attacker.ability === ABILITY.KAGAKUHENKAGASU) {
      effAtk *= 1.5;
      if (logFn) logFn(`${attacker.species.name}の${abilityJp(attacker.ability)}が発動！攻撃が1.5倍になった！`);
    }
  }
  if (attacker.ability === ABILITY.SUN_POWER && effWeather === 'sun' && isSpaStat) {
    if (!battleField.chemicalGasActive || attacker.ability === ABILITY.KAGAKUHENKAGASU) {
      effAtk *= 1.5;
      if (logFn) logFn(`${attacker.species.name}の${abilityJp(attacker.ability)}が発動！特攻が1.5倍になった！`);
    }
  }
  if (attacker.ability === ABILITY.ICE_BREAK && effWeather === 'snow' && (isAtkStat || isSpaStat)) {
    if (!battleField.chemicalGasActive || attacker.ability === ABILITY.KAGAKUHENKAGASU) {
      effAtk *= 1.5;
      if (logFn) logFn(`${attacker.species.name}の${abilityJp(attacker.ability)}が発動！${isAtkStat ? '攻撃' : '特攻'}が1.5倍になった！`);
    }
  }
  if (defender.ability === ABILITY.FUSHIGINA_UROKO && hasMajorStatus(defender) && isDefDef) {
    if (!battleField.chemicalGasActive || defender.ability === ABILITY.KAGAKUHENKAGASU) effDef *= 1.5;
  }
  if (attacker.ability === ABILITY.HARIKIRI && isPhysical) {
    if (!battleField.chemicalGasActive || attacker.ability === ABILITY.KAGAKUHENKAGASU) {
      effAtk *= 1.5;
      if (logFn) logFn(`${attacker.species.name}の${abilityJp(attacker.ability)}が発動！攻撃が1.5倍になった！`);
    }
  }
  // ナーバスレイジ：自分がアンコール・ちょうはつ状態の時、攻撃技（物理・特殊）の威力が1.5倍
  if (attacker.ability === ABILITY.NERVOUS_RAGE && move.category !== 'status'
      && ((attacker.encoreTurns || 0) > 0 || (attacker.tauntTurns || 0) > 0)) {
    if (!battleField.chemicalGasActive || attacker.ability === ABILITY.KAGAKUHENKAGASU) {
      effAtk *= 1.5;
      if (logFn) logFn(`${attacker.species.name}の${abilityJp(attacker.ability)}が発動！${isPhysical ? '攻撃' : '特攻'}が1.5倍になった！`);
    }
  }

  const base = Math.floor(Math.floor((2 * level / 5 + 2) * move.power * effAtk / effDef) / 50) + 2;
  const atkTypes = [attacker.species.type1, attacker.species.type2].filter(Boolean);
  // へんげんじざい：技を出す際に変化した実効タイプもSTAB判定に含める（Protean/Libero仕様）
  const stab = (atkTypes.includes(move.type) || attacker.hengenjizaiType === move.type) ? 1.3 : 1.0;
  // 実効タイプを使用してタイプ相性計算（弓張月・アネモネルージュ・アルカナフール等の特殊相性技を考慮）
  const typeMult = getTypeEffectiveness(move.type, defTypes[0], defTypes[1], move.id);
  const dmgTypeMult = typeMult === 2 ? 1.6 : typeMult === 4 ? 2.56 : typeMult;
  const randomFactor = rand(85, 100) / 100;
  let critMult = isCrit ? 1.5 : 1.0;
  if (isCrit && attacker.ability === ABILITY.SNIPER) critMult = 2.25;

  // こんじょう：やけど時の物理攻撃半減を無効化する（本家仕様。攻撃1.5倍は別途effAtk側で適用済み）
  const burnHalveNegated = attacker.ability === ABILITY.KONJOU &&
    (!battleField.chemicalGasActive || attacker.ability === ABILITY.KAGAKUHENKAGASU);
  const burnMult = (attacker.status === STATUS.BURN && isPhysical && !burnHalveNegated) ? 0.5 : 1.0;

  let pinchMult = 1.0;
  const pinchType = PINCH_BOOST_ABILITY_TYPE[attacker.ability];
  if (pinchType && move.type === pinchType && attacker.currentHp <= Math.floor(attacker.maxHp / 3)) {
    if (!battleField.chemicalGasActive || attacker.ability === ABILITY.KAGAKUHENKAGASU) {
      pinchMult = 1.5;
      if (logFn) logFn(`${attacker.species.name}の${abilityJp(attacker.ability)}が発動！`);
    }
  }
  const moraibiMult = (attacker.moraibiActive && move.type === 'fire') ? 1.5 : 1.0;

  let weatherMult = 1.0;
  if (effWeather === 'sun') {
    if (move.type === 'fire') weatherMult = 1.5;
    else if (move.type === 'water') weatherMult = 0.5;
  } else if (effWeather === 'rain') {
    if (move.type === 'water') weatherMult = 1.5;
    else if (move.type === 'fire') weatherMult = 0.5;
  } else if (effWeather === 'starrysky') {
    if (move.type === 'ghost' || move.type === 'psychic' || move.type === 'steel') weatherMult = 1.3;
    else if (move.type === 'shine') weatherMult = 0.5;
    if (STARRY_SKY_BOOST_MOVE_IDS.includes(move.id)) weatherMult *= 1.2;
  }

  let terrainMult = 1.0;
  if (battleField.terrain === 'grassy') {
    if (move.type === 'grass') terrainMult = 1.3;
    if (GRASSY_HALVED_MOVE_IDS.includes(move.id)) terrainMult *= 0.5;
  } else if (battleField.terrain === 'electric') {
    if (move.type === 'electric') terrainMult = 1.3;
  } else if (battleField.terrain === 'psychic') {
    if (move.type === 'psychic') terrainMult = 1.3;
  } else if (battleField.terrain === 'misty') {
    if (move.type === 'dragon') terrainMult = 0.5;
  } else if (battleField.terrain === 'melody') {
    if (move.type === 'sound') terrainMult = 1.3;
  }

  let dmg = Math.floor(base * stab * dmgTypeMult * randomFactor * critMult * burnMult * pinchMult * moraibiMult * weatherMult * terrainMult);

  const gasActive = battleField.chemicalGasActive;
  const gasImmune = (poke) => poke.ability === ABILITY.KAGAKUHENKAGASU;

  if (move.skinBoost) {
    dmg = Math.floor(dmg * 1.2);
    if (logFn) logFn(`威力が${Math.floor(move.power * 1.2)}相当になった！`);
  }
  if (attacker.ability === ABILITY.RESONANCE && move.type === 'sound') {
    if (!gasActive || gasImmune(attacker)) {
      dmg = Math.floor(dmg * 1.2);
      if (logFn) logFn(`${attacker.species.name}の${abilityJp(attacker.ability)}が発動！威力が${Math.floor(move.power * 1.2)}相当になった！`);
    }
  }
  if (attacker.ability === ABILITY.KYOKKOU && move.type === 'shine') {
    if (!gasActive || gasImmune(attacker)) {
      dmg = Math.floor(dmg * 1.2);
      if (logFn) logFn(`${attacker.species.name}の${abilityJp(attacker.ability)}が発動！威力が${Math.floor(move.power * 1.2)}相当になった！`);
    }
  }
  if (attacker.ability === ABILITY.HAGANE_TSUKAI && move.type === 'steel') {
    if (!gasActive || gasImmune(attacker)) {
      dmg = Math.floor(dmg * 1.2);
      if (logFn) logFn(`${attacker.species.name}の${abilityJp(attacker.ability)}が発動！威力が${Math.floor(move.power * 1.2)}相当になった！`);
    }
  }
  if (attacker.ability === ABILITY.UMI_NO_RUNE && move.type === 'water') {
    if (!gasActive || gasImmune(attacker)) {
      dmg = Math.floor(dmg * 1.2);
      if (logFn) logFn(`${attacker.species.name}の${abilityJp(attacker.ability)}が発動！威力が${Math.floor(move.power * 1.2)}相当になった！`);
    }
  }
  if (attacker.ability === ABILITY.TECHNICIAN && move.power <= 60) {
    if (!gasActive || gasImmune(attacker)) {
      dmg = Math.floor(dmg * 1.5);
      if (logFn) logFn(`${attacker.species.name}の${abilityJp(attacker.ability)}が発動！威力が${Math.floor(move.power * 1.5)}相当になった！`);
    }
  }
  if (attacker.ability === ABILITY.CHIKARAZUKU) {
    if (!gasActive || gasImmune(attacker)) {
      dmg = Math.floor(dmg * 1.3);
      if (logFn) logFn(`${attacker.species.name}の${abilityJp(attacker.ability)}が発動！威力が${Math.floor(move.power * 1.3)}相当になった！`);
    }
  }
  if (attacker.ability === ABILITY.KATAI_TSUME && move.category === 'physical') {
    if (!gasActive || gasImmune(attacker)) {
      dmg = Math.floor(dmg * 1.3);
      if (logFn) logFn(`${attacker.species.name}の${abilityJp(attacker.ability)}が発動！威力が${Math.floor(move.power * 1.3)}相当になった！`);
    }
  }
  if (attacker.ability === ABILITY.RANDOM_ACT && move.category === 'physical') {
    if (!gasActive || gasImmune(attacker)) {
      dmg = Math.floor(dmg * 1.2);
      if (logFn) logFn(`${attacker.species.name}の${abilityJp(attacker.ability)}が発動！威力が${Math.floor(move.power * 1.2)}相当になった！`);
    }
  }
  if (attacker.ability === ABILITY.TEKIOURYOKU && (attacker.species.type1 === move.type || attacker.species.type2 === move.type)) {
    if (!gasActive || gasImmune(attacker)) {
      dmg = Math.floor(dmg * 1.5);
      if (logFn) logFn(`${attacker.species.name}の${abilityJp(attacker.ability)}が発動！威力が${Math.floor(move.power * 1.5)}相当になった！`);
    }
  }
  if (attacker.ability === ABILITY.SUNA_NO_CHIKARA && effWeather === 'sand' && 
      (move.type === 'rock' || move.type === 'ground' || move.type === 'steel')) {
    if (!gasActive || gasImmune(attacker)) {
      dmg = Math.floor(dmg * 1.3);
      if (logFn) logFn(`${attacker.species.name}の${abilityJp(attacker.ability)}が発動！威力が${Math.floor(move.power * 1.3)}相当になった！`);
    }
  }
  if (attacker.ability === ABILITY.KIREEJI && KIRU_MOVE_IDS.includes(move.id)) {
    if (!gasActive || gasImmune(attacker)) {
      dmg = Math.floor(dmg * 1.5);
      if (logFn) logFn(`${attacker.species.name}の${abilityJp(attacker.ability)}が発動！威力が${Math.floor(move.power * 1.5)}相当になった！`);
    }
  }
  if (attacker.ability === ABILITY.GANJOUAGO && KAMU_MOVE_IDS.includes(move.id)) {
    if (!gasActive || gasImmune(attacker)) {
      dmg = Math.floor(dmg * 1.5);
      if (logFn) logFn(`${attacker.species.name}の${abilityJp(attacker.ability)}が発動！威力が${Math.floor(move.power * 1.5)}相当になった！`);
    }
  }
  if (attacker.ability === ABILITY.MEGALAUNCHER && HADOU_MOVE_IDS.includes(move.id)) {
    if (!gasActive || gasImmune(attacker)) {
      dmg = Math.floor(dmg * 1.5);
      if (logFn) logFn(`${attacker.species.name}の${abilityJp(attacker.ability)}が発動！威力が${Math.floor(move.power * 1.5)}相当になった！`);
    }
  }
  if (attacker.ability === ABILITY.TETSUNOKOBUSHI && KOBUSHI_MOVE_IDS.includes(move.id)) {
    if (!gasActive || gasImmune(attacker)) {
      dmg = Math.floor(dmg * 1.5);
      if (logFn) logFn(`${attacker.species.name}の${abilityJp(attacker.ability)}が発動！威力が${Math.floor(move.power * 1.5)}相当になった！`);
    }
  }
  if (attacker.ability === ABILITY.TOUSOUSHIN && attacker.firstTurn && move.category !== 'status') {
    if (!gasActive || gasImmune(attacker)) {
      dmg = Math.floor(dmg * 1.5);
      if (logFn) logFn(`${attacker.species.name}の${abilityJp(attacker.ability)}が発動！威力が${Math.floor(move.power * 1.5)}相当になった！`);
      attacker.firstTurn = false;
    }
  }

  if (attacker.ability === ABILITY.ENERGY_SOUL && attacker.energyStacks > 0) {
    if (!gasActive || gasImmune(attacker)) {
      const soulBoost = 1 + (attacker.energyStacks * 0.2);
      dmg = Math.floor(dmg * soulBoost);
      if (logFn) logFn(`${attacker.species.name}の${abilityJp(attacker.ability)}が発動！威力が${Math.floor(move.power * soulBoost)}相当になった！`);
    }
  }

  if (!ignoreWalls && attacker.ability !== ABILITY.KATAYABURI) {
    const side = defender.side === 'player' ? 'player' : 'cpu';
    const reflectTurns = side === 'player' ? battleField.playerReflect : battleField.cpuReflect;
    const lightScreenTurns = side === 'player' ? battleField.playerLightScreen : battleField.cpuLightScreen;
    if (isPhysical && reflectTurns > 0) {
      dmg = Math.floor(dmg * 0.5);
    }
    if (!isPhysical && lightScreenTurns > 0) {
      dmg = Math.floor(dmg * 0.5);
    }
  }

  if (attacker.ability !== ABILITY.KATAYABURI) {
    if (defender.ability === ABILITY.MULTISCALE && defender.currentHp === defender.maxHp) {
      if (!gasActive || gasImmune(defender)) dmg = Math.floor(dmg * 0.5);
    }
    if (defender.ability === ABILITY.HARD_ROCK && typeMult > 1) {
      if (!gasActive || gasImmune(defender)) dmg = Math.floor(dmg * 0.75);
    }
    if (defender.ability === ABILITY.ATSUI_SHIBOU && (move.type === 'fire' || move.type === 'ice')) {
      if (!gasActive || gasImmune(defender)) dmg = Math.floor(dmg * 0.5);
    }
    if (defender.ability === ABILITY.FAIR_COAT && move.category === 'physical') {
      if (!gasActive || gasImmune(defender)) dmg = Math.floor(dmg * 0.5);
    }
    if (defender.ability === ABILITY.KOORI_NO_RINPUN && move.category === 'special') {
      if (!gasActive || gasImmune(defender)) dmg = Math.floor(dmg * 0.5);
    }
  }

  if (typeMult === 0) dmg = 0;
  if (dmg < 1 && typeMult > 0) dmg = 1;
  return { damage: dmg, typeMult, isCrit };
}

// あめの時に必中となる技ID（かみなり・ルクシオンエア・しはいのかぜ・アクアスワール）
const RAIN_ALWAYS_HIT_MOVES = [73, 78, 156, 357];
// ゆきの時に必中となる技ID（こごえるかぜ・ふぶき・ヘイルストーム）
const SNOW_ALWAYS_HIT_MOVES = [232, 235, 237];

function checkAccuracy(attacker, defender, move, logFn) {
  if (move.accuracy === undefined || move.accuracy === null || move.accuracy >= 999) return true;
  if (attacker.ability === ABILITY.NO_GUARD || defender.ability === ABILITY.NO_GUARD) return true;
  if (battleField.weather === 'rain' && RAIN_ALWAYS_HIT_MOVES.includes(move.id)) return true;
  if (battleField.weather === 'snow' && SNOW_ALWAYS_HIT_MOVES.includes(move.id)) return true;

  // てんねん：自分が技を使う時は相手の回避率ランクを、自分が技を受ける時は相手の命中率ランクを無視する。
  // ログは実際にランクが0以外で意味のある無視が発生した時だけ出す。
  let accRank = attacker.ranks.acc;
  let evaRank = defender.ranks.eva;
  if (defender.ability === ABILITY.TENNEN && accRank !== 0) {
    if (logFn) logFn(`${defender.species.name}の${abilityJp(ABILITY.TENNEN)}が発動！能力変化を無視した！`);
    accRank = 0;
  }
  if (attacker.ability === ABILITY.TENNEN && evaRank !== 0) {
    if (logFn) logFn(`${attacker.species.name}の${abilityJp(ABILITY.TENNEN)}が発動！能力変化を無視した！`);
    evaRank = 0;
  }
  const stage = Math.max(-6, Math.min(6, accRank - evaRank));
  let mult = accEvaMultiplier(stage);
  if (attacker.ability === ABILITY.FUKUGAN) mult *= 1.3;
  if (attacker.ability === ABILITY.HARIKIRI) mult *= 0.8;
  const finalAcc = Math.min(100, move.accuracy * mult);
  return rand(1, 100) <= finalAcc;
}

// ---- 状態異常によるターン開始時の行動不能判定 ----
function checkCanMove(poke, logFn) {
  if (poke.ability === ABILITY.SEISHINRYOKU) poke.flinch = false;

  // ---- はかいこうせん等の反動：次のターンは動けない ----
  if (poke.mustRechargeTurns > 0) {
    poke.mustRechargeTurns--;
    logFn(`${poke.species.name}は反動で動けない！`);
    return false;
  }

  if (poke.flinch) {
    logFn(`${poke.species.name}はひるんで動けなかった！`);
    poke.flinch = false;
    return false;
  }

  if (poke.ability === ABILITY.NAMAKE) {
    if (poke.lazyTurns) {
      logFn(`${poke.species.name}はなまけている…`);
      poke.lazyTurns = false;
      return false;
    } else {
      poke.lazyTurns = true;
    }
  }

  if (poke.status === STATUS.SLEEP) {
    if (poke.sleepTurns > 0) {
      poke.sleepTurns--;
      logFn(`${poke.species.name}は眠っている…`);
      return false;
    } else {
      poke.status = STATUS.NONE;
      logFn(`${poke.species.name}は目を覚ました！`, {
        statusApply: poke.side,
        hpSnapshot: poke.currentHp,
        statusSnapshot: poke.status || STATUS.NONE,
        confuseSnapshot: poke.confuseTurns || 0,
      });
    }
  }
  if (poke.status === STATUS.FREEZE) {
    if (rand(1, 100) <= 20) {
      poke.status = STATUS.NONE;
      logFn(`${poke.species.name}の氷が溶けた！`, {
        statusApply: poke.side,
        hpSnapshot: poke.currentHp,
        statusSnapshot: poke.status || STATUS.NONE,
        confuseSnapshot: poke.confuseTurns || 0,
      });
    } else {
      logFn(`${poke.species.name}は凍っていて動けない…`);
      return false;
    }
  }
  if (poke.status === STATUS.PARALYZE) {
    if (rand(1, 100) <= 25) {
      logFn(`${poke.species.name}はまひして体が動かない！`);
      return false;
    }
  }
  if (poke.confuseTurns > 0) {
    poke.confuseTurns--;
    if (rand(1, 100) <= 33) {
      const selfDmg = Math.max(1, Math.floor(poke.stats.atk / 8));
      poke.currentHp = Math.max(0, poke.currentHp - selfDmg);
      logFn(`${poke.species.name}は混乱して自分を攻撃した！`, { hit: poke.side });
      if (poke.currentHp <= 0) { poke.fainted = true; logFn(`${poke.species.name}は倒れた！`, { faint: poke.side }); }
      return false;
    }
  }
  return true;
}

// ---- 場の設置技 ----
const hazardState = {
  player: { stealthRock: false, replugTrap: false },
  cpu: { stealthRock: false, replugTrap: false },
};

function resetHazards() {
  hazardState.player.stealthRock = false;
  hazardState.player.replugTrap = false;
  hazardState.cpu.stealthRock = false;
  hazardState.cpu.replugTrap = false;
}

function setHazard(moveId, attackerSide, logFn) {
  const targetSide = attackerSide === 'player' ? 'cpu' : 'player';
  if (moveId === 318) {
    if (hazardState[targetSide].stealthRock) {
      logFn('しかし失敗した！');
      return;
    }
    hazardState[targetSide].stealthRock = true;
    logFn(`相手の足元に岩が浮かんだ！`);
  } else if (moveId === 495) {
    if (hazardState[targetSide].replugTrap) {
      logFn('しかし失敗した！');
      return;
    }
    hazardState[targetSide].replugTrap = true;
    logFn(`相手の場にリプループラグが仕掛けられた！`);
  }
}

function applyHazardsOnSwitchIn(poke, side, logFn) {
  if (poke.fainted) return;
  const hz = hazardState[side];
  if (hz.stealthRock) {
    const defTypes = getEffectiveTypes(poke);
    let mult = 1;
    const chart = GAME_DATA.typeChart['rock'];
    if (chart) {
      for (const t of defTypes) {
        if (chart[t] !== undefined) mult *= chart[t];
      }
    }
    if (mult > 0) {
      const dmg = Math.max(1, Math.floor(poke.maxHp * mult / 8));
      poke.currentHp = Math.max(0, poke.currentHp - dmg);
      logFn(`${poke.species.name}にとがった岩が突き刺さった！`, { hit: side });
      if (poke.currentHp <= 0) {
        poke.currentHp = 0;
        poke.fainted = true;
        logFn(`${poke.species.name}は倒れた！`, { faint: side });
      }
      checkAndTriggerFundo(poke, logFn);
      applyDamageTakenEffects(poke, logFn);
    }
  }
  if (hz.replugTrap && !poke.fainted) {
    const defTypes = getEffectiveTypes(poke);
    const isImmune = defTypes.includes('electric') || defTypes.includes('ground');
    if (isImmune) {
      logFn(`${poke.species.name}にはリプループラグが効かなかった！`);
    } else {
      const dmg = Math.max(1, Math.floor(poke.maxHp / 2));
      poke.currentHp = Math.max(0, poke.currentHp - dmg);
      logFn(`${poke.species.name}はリプループラグでダメージを受けた！`, { hit: side });
      if (poke.currentHp <= 0) {
        poke.currentHp = 0;
        poke.fainted = true;
        logFn(`${poke.species.name}は倒れた！`, { faint: side });
      }
      checkAndTriggerFundo(poke, logFn);
      applyDamageTakenEffects(poke, logFn);
    }
    hz.replugTrap = false;
  }
}

function applyEndOfTurnStatus(poke, logFn) {
  if (poke.fainted) return;
  const hpBeforeEot = poke.currentHp;

  // バインドダメージ
  if (poke.bindTurns > 0) {
    const dmg = Math.max(1, Math.floor(poke.maxHp / 16));
    poke.currentHp = Math.max(0, poke.currentHp - dmg);
    logFn(`${poke.species.name}はバインドのダメージを受けている…`, { hit: poke.side });
    poke.bindTurns--;
    if (poke.currentHp <= 0) {
      poke.currentHp = 0;
      poke.fainted = true;
      logFn(`${poke.species.name}は倒れた！`, { faint: poke.side });
    }
    if (poke.bindTurns === 0) {
      logFn(`${poke.species.name}のバインドが解けた！`);
    }
  }

  // うつせみダメージ
  if (poke.utsusemiTurns > 0) {
    poke.utsusemiTurns--;
    if (poke.utsusemiTurns === 0 && !poke.fainted) {
      const dmg = Math.max(1, Math.floor(poke.maxHp / 2));
      poke.currentHp = Math.max(0, poke.currentHp - dmg);
      logFn(`${poke.species.name}はうつせみのダメージを受けた！`, { hit: poke.side });
      if (poke.currentHp <= 0) {
        poke.currentHp = 0;
        poke.fainted = true;
        logFn(`${poke.species.name}は倒れた！`, { faint: poke.side });
      }
    }
  }

  if (poke.status === STATUS.POISON) {
    const dmg = Math.max(1, Math.floor(poke.maxHp / 8));
    poke.currentHp = Math.max(0, poke.currentHp - dmg);
    logFn(`${poke.species.name}は毒のダメージを受けている…`, { hit: poke.side });
  } else if (poke.status === STATUS.BADLY_POISON) {
    const dmg = Math.max(1, Math.floor(poke.maxHp * poke.badlyPoisonCounter / 16));
    poke.currentHp = Math.max(0, poke.currentHp - dmg);
    poke.badlyPoisonCounter++;
    logFn(`${poke.species.name}は猛毒のダメージを受けている…`, { hit: poke.side });
  } else if (poke.status === STATUS.BURN) {
    const dmg = Math.max(1, Math.floor(poke.maxHp / 16));
    poke.currentHp = Math.max(0, poke.currentHp - dmg);
    logFn(`${poke.species.name}はやけどのダメージを受けている…`, { hit: poke.side });
  }
  if (poke.currentHp <= 0) { poke.currentHp = 0; poke.fainted = true; logFn(`${poke.species.name}は倒れた！`, { faint: poke.side }); }
  checkAndTriggerFundo(poke, logFn);
  // じきゅうりょく等「ダメージを受けた時」の特性は、このターン終了処理で
  // 実際にHPが減っていた場合のみ発動させる（バインド／毒／やけど／うつせみ等）。
  // 何もダメージが発生していないのに毎ターン発動してしまうバグの修正。
  if (poke.currentHp < hpBeforeEot) {
    applyDamageTakenEffects(poke, logFn);
  }
  applyMurakke(poke, logFn);
  applyKasoku(poke, logFn);

  if (poke.ability === ABILITY.GYAKUJOU && !poke.gyakujouTriggered && poke.currentHp <= poke.maxHp / 2) {
    poke.gyakujouTriggered = true;
    const rankData = [100, 0, 0, 1, 0, 0, 0, 0];
    applyRankChange(poke, rankData, logFn);
    logFn(`${poke.species.name}のぎゃくじょうが発動！`);
  }

  applyEnergyPermanent(poke, logFn);

  if (poke.tauntTurns > 0) {
    poke.tauntTurns--;
    if (poke.tauntTurns === 0) {
      logFn(`${poke.species.name}の挑発が解けた！`);
    }
  }

  // アンコール
  if (poke.encoreTurns > 0) {
    poke.encoreTurns--;
    if (poke.encoreTurns === 0) {
      logFn(`${poke.species.name}のアンコールが解けた！`);
      poke.encoreMoveId = null;
    }
  }

  // インフェルノのタイプロック解除
  if (poke.typeLockTurns > 0) {
    poke.typeLockTurns--;
    if (poke.typeLockTurns === 0) {
      logFn(`${poke.species.name}のタイプロックが解除された！`);
      poke.typeLockType = null;
    }
  }

  // ヨワシ：ターン終了時、（毒・やけど・バインド等の処理が全て済んだ）最終的な残りHPに応じて
  // 「むれたすがた」⇔「たんどくのすがた」を判定する。ここでの変化は「魚が集まる／散る」演出付き。
  if (!poke.fainted) updateYowashiForm(poke, logFn, true);

  // アイニーチュ：ターン終了時、（毒・やけど・バインド等の処理が全て済んだ）最終的な残りHPが
  // 最大HPの半分以下ならフォルムチェンジする（片道・一度きり）。
  if (!poke.fainted) updateAineechuForm(poke, logFn);
}

// ---- ふんど ----
function checkAndTriggerFundo(poke, logFn) {
  if (!poke || poke.fainted) return;
  if (poke.ability === ABILITY.FUNDO && !poke.fundoTriggered && poke.currentHp <= poke.maxHp / 2) {
    poke.fundoTriggered = true;
    const rankData = [100, 1, -1, 1, -1, 1, 1, 0];
    applyRankChange(poke, rankData, logFn);
    logFn(`${poke.species.name}のふんどが発動した！`);
  }
}

// ---- ランダムアクト ----
// 1〜3つ目：下記プールから重複なしで抽選。4つ目：専用プールから抽選。
const RANDOM_ACT_POOL_MAIN = [3,29,48,66,88,82,103,121,126,142,163,186,207,229,266,285,303,322,347,363,383];
const RANDOM_ACT_POOL_LAST = [259,296,492,485,497,493,477,478,318,475,476,238,239,116];

// ランダムアクトの技変化ログを見られるのは、そのバトルで実際にメガシンカを使っている
// （＝メガシンカ済みの）プレイヤーだけ。side は 'player' | 'cpu'（ホスト視点）。
// 対人戦ではホスト＝'player'、ゲスト＝'cpu' なので、ログの持ち主側（randomActSide）が
// メガシンカ済みなら、その持ち主のプレイヤーにだけ見せる（相手には見せない）。
function hasUsedMegaEvolution(side) {
  return side === 'player' ? !!battleField.megaUsedPlayer : !!battleField.megaUsedCpu;
}

// 特性が発動できる状態か（ちくじ「かがくへんかガス」の影響を考慮）
function abilityActive(poke) {
  return !battleField.chemicalGasActive || poke.ability === ABILITY.KAGAKUHENKAGASU;
}

// applyStatus/applyRankChange に「攻撃側の特性」を渡すときに使う。
// かがくへんかガスで特性が無効になっている場合は null を返し、てんのめぐみ・ふしょく等が
// 発動しないようにする。（状態異常・ランク変化そのものはガスの影響を受けない）
function effectiveAbilityId(poke) {
  return poke && abilityActive(poke) ? poke.ability : null;
}

// ---- かげぬい：「相手は逃げられなくなる」 ----
// ランチャーアーム（id 330）も同じ「相手は逃げられなくなる」効果を持つ。
const KAGENUI_MOVE_ID = 507;
const SHADOW_TRAP_MOVE_IDS = [KAGENUI_MOVE_ID, 330];

// 指定ポケモンが「逃げられない（交代できない）」状態かどうか。
// バインド中と、かげぬいで縫い止められている間は交代不可。
// ui.js側の交代ボタン制御や、CPUの交代判断からはこの関数を参照すること。
//
// かげぬいは「縫い付けた本人（shadowTrappedBy）が場にいる間だけ」有効。
// 縫い付けた本人が倒れた・交代で控えに下がった場合は自動的に解除される。
// （本人が現在の場のポケモンかどうかは、fainted と、その本人自身が縫い付け状態の
//   持ち主にとって「相手」であり続けているかで判断する。交代で下がった時は
//   clearShadowTrapsBy() で明示的に解除する。）
function isTrappedFromSwitching(poke) {
  if (!poke || poke.fainted) return false;
  if ((poke.bindTurns || 0) > 0) return true;
  const by = poke.shadowTrappedBy;
  if (by && !by.fainted) return true;
  return false;
}

// かげぬいで縫い止める。ゴーストタイプには効かない（本家仕様）。
// すでに縫い止められている場合は何もしない。付与できたら true を返す。
function applyShadowTrap(target, logFn, user) {
  if (!target || target.fainted) return false;
  if (getEffectiveTypes(target).includes('ghost')) return false;
  if (target.shadowTrappedBy && !target.shadowTrappedBy.fainted) return false;
  // user が省略された場合でも「縫い止め状態」自体は成立させる（自分自身を目印にする）。
  target.shadowTrappedBy = user || target;
  logFn(`${target.species.name}は影を縫い付けられて逃げられなくなった！`);
  return true;
}

// 縫い止め状態を解除する（縫い止められた本人側から呼ぶ）。
function clearShadowTrap(poke) {
  if (poke) poke.shadowTrappedBy = null;
}

// 縫い付けた本人（user）が場から離れた（交代した）時に呼ぶ。
// 相手側(opponent)にかかっている縫い止めのうち、user によるものだけを解除する。
// ui.js の交代処理から、下がる側のポケモンと、その時の相手を渡して呼び出すこと。
function clearShadowTrapsBy(user, opponent) {
  if (opponent && opponent.shadowTrappedBy === user) opponent.shadowTrappedBy = null;
}

// ターン終了時：自分の技が全てランダムに変化する。
// 新しい技は毎回PP満タン・ロック解除の状態で生成する。
function applyRandomActEndOfTurn(poke, logFn) {
  if (!poke || poke.fainted) return;
  if (poke.ability !== ABILITY.RANDOM_ACT) return;
  if (!abilityActive(poke)) return;

  // 1〜3つ目：メインプールから重複しないように3つ
  const pool = RANDOM_ACT_POOL_MAIN.filter((id) => GAME_DATA.moves[id]);
  const chosen = [];
  while (chosen.length < 3 && pool.length > 0) {
    const idx = rand(0, pool.length - 1);
    chosen.push(pool.splice(idx, 1)[0]);
  }
  // 4つ目：専用プールから1つ（メインプールとは別プールだが、念のため重複を避ける）
  const lastPool = RANDOM_ACT_POOL_LAST.filter((id) => GAME_DATA.moves[id] && !chosen.includes(id));
  if (lastPool.length > 0) chosen.push(lastPool[rand(0, lastPool.length - 1)]);

  const newMoves = chosen.map((id) => buildMoveObject(id)).filter(Boolean);
  if (newMoves.length === 0) return;
  // 最初に入れ替える時だけ、元の技を保存しておく（バトル終了時に resetPokeForBattle が復元する）。
  // 2回目以降は保存済みの元の技を上書きしない。
  if (!poke.originalMoveIds) poke.originalMoveIds = poke.moves.map((m) => m.id);
  poke.moves = newMoves;

  // 技IDに紐づく一時状態は、技が入れ替わって参照先が無くなるので解除する
  poke.encoreMoveId = null;
  poke.encoreTurns = 0;
  poke.gekirinMoveId = null;
  poke.gekirinTurns = 0;
  poke.lastUsedMoveId = null;
  poke.deaigashiraLocked = false;

  // 技が入れ替わったログは、メガシンカを使っているプレイヤー（＝メガシンカ済みの側）にしか
  // 見せない。相手側の画面には「何の技に変わったか」が漏れてしまうため。
  // ここでは「誰のログか（randomActSide）」と「非公開ログである（randomActPrivate）」という
  // メタ情報だけを付け、実際に見せるか・送るかの判定はUI側（makeLogFn / queueMessage）で行う。
  const logMeta = { randomActPrivate: true, randomActSide: poke.side };
  logFn(`${poke.species.name}の${abilityJp(poke.ability)}が発動！技がランダムに変化した！`, logMeta);
  logFn(`新しい技：${newMoves.map((m) => m.name).join('、')}`, logMeta);
}

// ---- いざない ----
// 攻撃を受けた時、相手（攻撃側）に「2ターン後にねむり」を仕込む。
// すでに仕込み済みの場合は上書きせず、最初のカウントを維持する。
function applyIzanaiOnHit(defender, attacker, logFn) {
  if (!defender || !attacker || attacker.fainted) return;
  if (defender.ability !== ABILITY.IZANAI) return;
  if (!abilityActive(defender)) return;
  if (attacker.izanaiTurns > 0) return;
  attacker.izanaiTurns = 2;
  logFn(`${defender.species.name}の${abilityJp(defender.ability)}が発動！${attacker.species.name}は眠気を誘われた！`);
}

// ターン終了時：いざないのカウントを進め、0になったらねむりにする。
function applyIzanaiEndOfTurn(poke, logFn) {
  if (!poke || poke.fainted) return;
  if (!(poke.izanaiTurns > 0)) return;
  poke.izanaiTurns--;
  if (poke.izanaiTurns > 0) return;
  poke.izanaiTurns = 0;
  // ねむりの付与判定はapplyStatusに任せる（ふみん・エレキフィールド・ミストフィールド・
  // すでに他の状態異常にかかっている場合などは通常通り無効になる）
  if (!applyStatus(poke, [100, STATUS.SLEEP], logFn, null)) {
    logFn(`${poke.species.name}は眠気を振り払った！`);
  }
}

// ---- ダメージを受けたときの特性 ----
function applyDamageTakenEffects(poke, logFn) {
  if (!poke || poke.fainted) return;
  if (poke.ability === ABILITY.JIKYUURYOKU) {
    const rankData = [100, 0, 1, 0, 0, 0, 0, 0];
    applyRankChange(poke, rankData, logFn);
    logFn(`${poke.species.name}のじきゅうりょくが発動！`);
  }
  if (poke.ability === ABILITY.KUDAKERU_YOROI) {
    const rankData = [100, 0, -1, 0, 0, 2, 0, 0];
    applyRankChange(poke, rankData, logFn);
    logFn(`${poke.species.name}のくだけるよろいが発動！`);
  }
}

// ---- ムラっけ ----
function applyMurakke(poke, logFn) {
  if (!poke || poke.fainted || poke.ability !== ABILITY.MURAKKE) return;
  // 本家の現行仕様：ムラっけが上げ下げする対象は「こうげき・ぼうぎょ・とくこう・とくぼう・すばやさ」の
  // 5項目のみで、命中率(acc)・回避率(eva)は対象に含まれない。
  const keys = ['atk', 'def', 'spa', 'spd', 'spe'];
  const shuffled = [...keys].sort(() => Math.random() - 0.5);
  const upKey = shuffled[0];
  const downKey = shuffled[1];
  const upData = [100, 0, 0, 0, 0, 0, 0, 0];
  const downData = [100, 0, 0, 0, 0, 0, 0, 0];
  const idxMap = { atk: 1, def: 2, spa: 3, spd: 4, spe: 5, acc: 6, eva: 7 };
  upData[idxMap[upKey]] = 2;
  downData[idxMap[downKey]] = -1;
  applyRankChange(poke, upData, logFn);
  applyRankChange(poke, downData, logFn);
  logFn(`${poke.species.name}のムラっけが発動！`);
}

// ---- かそく ----
function applyKasoku(poke, logFn) {
  if (!poke || poke.fainted || poke.ability !== ABILITY.KASOKU) return;
  const rankData = [100, 0, 0, 0, 0, 1, 0, 0];
  applyRankChange(poke, rankData, logFn);
  logFn(`${poke.species.name}のかそくが発動！`);
}

// ---- えいきゅうきかん ----
function applyEnergyPermanent(poke, logFn) {
  if (!poke || poke.fainted) return;
  if (poke.ability === ABILITY.ENERGY_PERMANENT) {
    const gasActive = battleField.chemicalGasActive;
    const gasImmune = poke.ability === ABILITY.KAGAKUHENKAGASU;
    if (!gasActive || gasImmune) {
      addEnergyStacks(poke, 1, logFn);
      logFn(`${poke.species.name}のえいきゅうきかんが発動！`);
    }
  }
}

// ---- ゆびをふる ----
let _randomMovePool = null;
function pickRandomMove() {
  if (!_randomMovePool) {
    _randomMovePool = Object.values(GAME_DATA.moves).filter((m) => !m.callRandomMove);
  }
  const src = _randomMovePool[rand(0, _randomMovePool.length - 1)];
  return {
    id: src.id, name: src.name, type: src.type, power: src.power, accuracy: src.accuracy,
    category: src.category, pp: 1, maxPp: 1, priority: 0,
    selfRank: src.selfRank, oppRank: src.oppRank, selfStatus: src.selfStatus, oppStatus: src.oppStatus,
    flinchChance: src.flinchChance || 0,
    drainRatio: src.drainRatio || null, recoilRatio: src.recoilRatio || null,
    selfDestruct: !!src.selfDestruct, chargeTurn: !!src.chargeTurn,
    damageFormula: src.damageFormula || null, callRandomMove: false,
  };
}

// ===========================
// 連続技処理（内部関数）
// ===========================
function executeMultiHit(attacker, defender, move, logFn) {
  const config = MULTI_HIT_MOVES[move.id];
  if (!config) return false;

  const isSkillLink = attacker.ability === ABILITY.SKILL_LINK;
  let hitCount;
  if (isSkillLink) {
    hitCount = config.maxHits;
  } else if (config.fixed) {
    hitCount = config.maxHits;
  } else {
    hitCount = rand(config.minHits, config.maxHits);
  }

  let totalDamage = 0;
  let hitIndex = 0;
  let anyHit = false;

  for (let i = 0; i < hitCount; i++) {
    if (attacker.fainted || defender.fainted) break;
    hitIndex = i + 1;

    let accuracySuccess = true;
    if (!isSkillLink) {
      // 連続技の命中判定を checkAccuracy と同じ計算式に統一する。
      // 従来は素の命中率とだけ比較する独自ロジックで、ノーガードは元より
      // 命中ランク・回避ランク・ふくがん等の補正も一切反映されないバグがあった。
      // トリプルアクセルのみ命中率90固定という特殊仕様があるため、一時的な
      // move オブジェクトで accuracy を差し替えてから checkAccuracy に渡す。
      const acc = (move.id === 229) ? 90 : move.accuracy;
      accuracySuccess = checkAccuracy(attacker, defender, { ...move, accuracy: acc }, logFn);
    }
    if (!accuracySuccess) {
      logFn(`${attacker.species.name}の${move.name}は${defender.species.name}に外れた！`);
      break;
    }

    let power = config.basePower;
    if (move.id === 229) {
      power = 20 + (hitIndex - 1) * 20;
    } else if (move.id === 472) {
      power = 10 + (hitIndex - 1) * 5;
    }

    const tempMove = Object.assign({}, move, { power: power });
    const result = calcDamage(attacker, defender, tempMove, logFn);
    const damage = result.damage;
    const typeMult = result.typeMult;
    const isCrit = result.isCrit;

    if (damage === 0 && typeMult === 0) {
      logFn(`${defender.species.name}には効果がないようだ…`);
      break;
    }

    const wasFullHp = defender.currentHp === defender.maxHp;
    let survivedByGanjou = false;
    if (wasFullHp && defender.ability === ABILITY.GANJOU && damage >= defender.currentHp) {
      if (!battleField.chemicalGasActive || defender.ability === ABILITY.KAGAKUHENKAGASU) {
        survivedByGanjou = true;
      }
    }
    // こらえる：がんじょうと異なり満タンHP条件は無い。ひんしになるダメージなら必ずHPが1残る。
    // 連続技の各打でも毎回この判定が通るため、複数回ヒットしてもこらえる中は倒れない。
    let survivedByEndure = false;
    if (!survivedByGanjou && defender.enduring && damage >= defender.currentHp) {
      survivedByEndure = true;
    }

    defender.currentHp = Math.max(0, defender.currentHp - damage);
    if (survivedByGanjou || survivedByEndure) defender.currentHp = 1;
    logFn(`${defender.species.name}に${damage}のダメージ！`, { hit: defender.side, typeMult, moveType: move.type, movePower: power, moveId: move.id });
    if (isCrit) logFn('急所に当たった！');
    if (typeMult > 1) logFn('効果は抜群だ！');
    else if (typeMult < 1) logFn('効果は今ひとつのようだ…');
    if (survivedByGanjou) logFn(`${defender.species.name}はがんじょうで持ちこたえた！`);
    if (survivedByEndure) logFn(`${defender.species.name}はこらえた！`);

    let suppressSecondary = false;
    if (attacker.ability === ABILITY.CHIKARAZUKU && abilityActive(attacker)) suppressSecondary = true;
    if (!suppressSecondary) {
      if (move.flinchChance && rand(1, 100) <= move.flinchChance) {
        defender.flinch = true;
      }
      applyStatus(defender, move.oppStatus, logFn, effectiveAbilityId(attacker));
    }

    if (move.category === 'physical' && !defender.fainted) {
      if (defender.ability === ABILITY.SEIDENKI && attacker.status === STATUS.NONE && rand(1, 100) <= 30) {
        if (!battleField.chemicalGasActive || defender.ability === ABILITY.KAGAKUHENKAGASU) {
          applyStatus(attacker, [100, STATUS.PARALYZE], logFn);
        }
      } else if (defender.ability === ABILITY.FUSHOKU_NO_TOGE && attacker.status === STATUS.NONE && rand(1, 100) <= 50) {
        if (!battleField.chemicalGasActive || defender.ability === ABILITY.KAGAKUHENKAGASU) {
          applyStatus(attacker, [100, STATUS.BADLY_POISON], logFn);
        }
      } else if (defender.ability === ABILITY.HONOO_NO_KARADA && attacker.status === STATUS.NONE && rand(1, 100) <= 30) {
        if (!battleField.chemicalGasActive || defender.ability === ABILITY.KAGAKUHENKAGASU) {
          applyStatus(attacker, [100, STATUS.BURN], logFn);
        }
      }
    }

    if (defender.currentHp <= 0) {
      defender.fainted = true;
      logFn(`${defender.species.name}は倒れた！`, { faint: defender.side });
      anyHit = true;
      break;
    }
    anyHit = true;
  }

  // ランク変化（selfRank/oppRank）は連続ヒットの回数分ではなく、技を出した時に1回だけ適用する。
  // 相手を倒した一撃であっても技自体は命中しているため、selfRank（自分の能力変化）は発動する。
  if (anyHit && !attacker.fainted) {
    const suppressSecondary = attacker.ability === ABILITY.CHIKARAZUKU && abilityActive(attacker);
    if (!suppressSecondary) {
      if (!defender.fainted) applyRankChange(defender, move.oppRank, logFn, null, attacker);
      applyRankChange(attacker, move.selfRank, logFn, null, defender);
    }
  }

  return true;
}

// 技そのものの優先度に、天候による補正（ふゆのひざし/穿星波）だけを加えた値。
// 特性・フィールドによる補正は含まない（AIの簡易判定や表示用）。
function movePriorityWithWeather(move) {
  let p = move.priority || 0;
  if (move.id === 285 && battleField.weather === 'snow') p += 1;
  if (move.id === 57 && battleField.weather === 'starrysky') p += 1;
  return p;
}

// ---- 優先度計算 ----
// 天候などで優先度が+1される技（ふゆのひざし・穿星波）も、サイコフィールドの先制無効や
// ソニックガードの対象になるよう、「補正後の優先度」を基準に判定する。
function effectivePriority(attacker, move, defenderFainted) {
  let p = movePriorityWithWeather(move);

  if (battleField.terrain === 'psychic' && p > 0) return 0;

  if (attacker.ability === ABILITY.SONIC_GUARD && p >= 1) {
    return -999;
  }

  if (move.id === 501 && battleField.terrain === 'electric') {
    p = Math.max(1, p + 1);
  }

  if (attacker.ability === ABILITY.HAYATE_NO_TSUBASA && move.type === 'flying') {
    p = Math.max(1, p + 1);
  }
  if (attacker.ability === ABILITY.ITAZURA_GOKORO && move.category === 'status') {
    p = Math.max(1, p + 1);
  }
  return p;
}

// ---- HPによる威力変動関数 ----
function calcVariablePower(moveId, currentHp, maxHp) {
  const ratio = currentHp / maxHp;
  let power = 0;
  if (moveId === 109) { // きしかいせい
    if (ratio >= 0.7) power = 20;
    else if (ratio >= 0.4) power = 40;
    else if (ratio >= 0.2) power = 80;
    else if (ratio >= 0.1) power = 140;
    else power = 200;
  } else if (moveId === 179) { // 不倶戴天
    if (ratio >= 0.5) power = 10;
    else if (ratio >= 0.3) power = 40;
    else if (ratio >= 0.1) power = 100;
    else if (ratio >= 0.04) power = 150;
    else power = 240;
  }
  return power;
}

// ---- 1ターンの技実行 ----
function executeMove(attacker, defender, move, logFn, turnCtx) {
  // じきゅうりょく等「ダメージを受けた時」の特性を、このexecuteMove内で実際に
  // ダメージを受けた側だけに正しく発動させるため、開始時点のHPを記録しておく。
  const attackerHpAtMoveStart = attacker.currentHp;
  const defenderHpAtMoveStart = defender.currentHp;

  // ---- まもる（成否判定・状態セット） ----
  // 本家仕様：連続で使うほど成功率が下がる（100%→50%→25%→…）。
  // 前のターンにまもるを使っていなかった（成功しなかった）場合は連続カウントをリセットする。
  if (move.id === 2019) {
    // まもるも通常の技と同様にPPを消費する（成功・失敗を問わず1消費）。
    // これが無いとまもるだけPPが一切減らないバグになる。対人戦でも、プレイヤー同士が
    // 参照している同じmoveオブジェクト（moves配列の要素）を直接書き換えているため、
    // 既存のPP同期処理（buildTurnEndPayload等）にそのまま乗って自動的に同期される。
    if (move.pp <= 0) {
      logFn(`${attacker.species.name}は技が出せない！`);
      return;
    }
    move.pp--;
    const streak = attacker.protectStreak || 0;
    const successRate = 100 / Math.pow(2, streak);
    if (rand(1, 100) <= successRate) {
      attacker.protecting = true;
      attacker.protectStreak = streak + 1;
      logFn(`${attacker.species.name}は身を守った！`);
    } else {
      attacker.protecting = false;
      attacker.protectStreak = 0;
      logFn(`しかし失敗した！`);
    }
    return;
  }

  // ---- まもるによる技のブロック ----
  // 相手に向けた技（自分自身をtargetにするものは対象外）はまもるで防がれる。
  // ステルスロック・設置技・リフレクター等の「場」に効果を及ぼす技は本家同様まもるでは防げない。
  if (defender.protecting && attacker !== defender
      && move.id !== 318 && move.id !== 495 && move.id !== 475 && move.id !== 476) {
    logFn(`${defender.species.name}はまもるので技をうけつけない！`);
    return;
  }

  // ---- こらえる（成否判定・状態セット） ----
  // 本家仕様：まもると同じ連続使用成功率（100%→50%→25%→…）。
  // 成功したターンは、攻撃技でひんしになるダメージを受けても必ずHPが1残る（連続技の各打も含む）。
  // 実際のHP1保証はダメージ適用箇所（がんじょうと同様の分岐）で行い、ここでは成否判定と
  // attacker.enduring フラグのセットのみを行う。
  if (move.id === 506) {
    if (move.pp <= 0) {
      logFn(`${attacker.species.name}は技が出せない！`);
      return;
    }
    move.pp--;
    const streak = attacker.endureStreak || 0;
    const successRate = 100 / Math.pow(2, streak);
    if (rand(1, 100) <= successRate) {
      attacker.enduring = true;
      attacker.endureStreak = streak + 1;
      logFn(`${attacker.species.name}はこらえる！`);
    } else {
      attacker.enduring = false;
      attacker.endureStreak = 0;
      logFn(`しかし失敗した！`);
    }
    return;
  }

  // ---- マジックミラー ----
  // マジックミラーは「相手に向けて撃つ変化技」のみを跳ね返す特性。
  // つるぎのまい等、相手に効果を及ぼさない自分強化オンリーの技（oppRank/oppStatusが無く、
  // かつ設置技でもない）まで跳ね返っていたバグを修正。
  const targetsOpponent = move.oppRank || move.oppStatus || move.id === 318 || move.id === 495;
  if (defender.ability === ABILITY.MAGIC_MIRROR && move.category === 'status' && attacker !== defender && targetsOpponent) {
    logFn(`${defender.species.name}のマジックミラーが発動！${attacker.species.name}に跳ね返した！`);
    const tempAttacker = defender;
    const tempDefender = attacker;
    if (move.id === 318 || move.id === 495) {
      setHazard(move.id, tempAttacker.side, logFn);
    } else {
      if (move.selfRank) applyRankChange(tempAttacker, move.selfRank, logFn);
      if (move.oppRank) applyRankChange(tempAttacker, move.oppRank, logFn);
      if (move.selfStatus) applyStatus(tempAttacker, move.selfStatus, logFn);
      if (move.oppStatus) applyStatus(tempAttacker, move.oppStatus, logFn);
    }
    return;
  }

  // ---- アンコール強制チェック ----
  if (attacker.encoreTurns > 0 && attacker.encoreMoveId !== null) {
    const forcedMove = attacker.moves.find(m => m.id === attacker.encoreMoveId);
    if (forcedMove && forcedMove !== move) {
      logFn(`${attacker.species.name}はアンコールで${forcedMove.name}を強制された！`);
      move = forcedMove;
    }
  }

  // ---- げきりん強制連続使用チェック ----
  if (attacker.gekirinTurns > 0 && attacker.gekirinMoveId !== null) {
    const forcedGekirin = attacker.moves.find(m => m.id === attacker.gekirinMoveId);
    if (forcedGekirin && forcedGekirin !== move) {
      move = forcedGekirin;
    }
  }

  // ---- 挑発チェック ----
  if (attacker.tauntTurns > 0 && move.category === 'status') {
    logFn(`${attacker.species.name}は挑発されていて変化技が出せない！`);
    return;
  }

  // ---- タイプロックチェック ----
  if (attacker.typeLockTurns > 0 && attacker.typeLockType === move.type) {
    logFn(`${attacker.species.name}の${typeJp(move.type)}タイプの技はロックされていて出せない！`);
    return;
  }

  // 挑発・タイプロック等でブロックされず、実際に技を使うことが確定した時点で記録する
  // （アンコール・ひややかパンチ用）。個別分岐でreturnする変化技（リフレクター等）も含めて
  // ここで一元的に記録し、途中の各処理で上書きされても同じ値が入るだけなので問題ない。
  attacker.lastUsedMoveId = move.id;

  // ---- のろわれボディ ----
  if (defender.ability === ABILITY.NOROWARE_BODY && move.category === 'physical' && !defender.fainted) {
    if (!battleField.chemicalGasActive || defender.ability === ABILITY.KAGAKUHENKAGASU) {
      if (rand(1, 100) <= 30) {
        const unlockable = attacker.moves.filter(m => m && !m.locked);
        if (unlockable.length > 0) {
          const target = pick(unlockable);
          target.locked = true;
          logFn(`${defender.species.name}ののろわれボディ！${attacker.species.name}の${target.name}が封じられた！`);
        }
      }
    }
  }

  // ---- スキン系 ----
  // move はポケモンの moves 配列に入っている実データへの参照なので、ここで
  // move.type を直接書き換えると技のタイプが次のターン以降も変わったままに
  // なってしまう（本来はそのターンだけの一時的な変化）。以降の処理では
  // move をこのローカルコピーに差し替え、元データ（poke.moves[idx]）は
  // 一切変更しないようにする。PPなど元データへ書き込む処理はこれより前で
  // 完結している（まもる分岐はここに来る前にreturnしている）ため安全。
  if (SKIN_TYPE_MAP[attacker.ability] && move.type === 'normal') {
    const originalMoveType = move.type;
    move = { ...move, type: SKIN_TYPE_MAP[attacker.ability], skinBoost: true, skinOriginalType: originalMoveType };
    logFn(`${attacker.species.name}の${abilityJp(attacker.ability)}が発動！${typeJp(move.type)}タイプに変わった！`);
  }

  // ---- へんげんじざい ----
  // 場に出てから最初に技を使う時のみ、自分がその技のタイプに変化した扱いになる
  // （getEffectiveTypesで単タイプ化＋STAB判定に反映）。
  // 交代して再度場に出るとこの効果は復活する（switchIn時にhengenjizaiUsedをリセット）。
  if (attacker.ability === ABILITY.HENGENJIZAI && !attacker.hengenjizaiUsed && move.type) {
    attacker.hengenjizaiUsed = true;
    attacker.hengenjizaiType = move.type;
    logFn(`${attacker.species.name}の${abilityJp(attacker.ability)}が発動！${typeJp(move.type)}タイプに変わった！`);
  }

  let suppressSecondary = false;
  if (attacker.ability === ABILITY.CHIKARAZUKU && abilityActive(attacker)) suppressSecondary = true;

  // プレッシャー
  if (defender.ability === ABILITY.PRESSURE && move.pp > 0) {
    if (!battleField.chemicalGasActive || defender.ability === ABILITY.KAGAKUHENKAGASU) {
      move.pp = Math.max(0, move.pp - 1);
    }
  }

  if (move.pp <= 0) {
    logFn(`${attacker.species.name}は技が出せない！`);
    return;
  }
  
// 変更後
move.pp--;
logFn(`${attacker.species.name}の${move.name}！`, {
  moveUse: attacker.side,
  moveId: move.id,
  moveCategory: move.category,
});
  // ---- メガソーラー：発動ログ ----
  // 「ひでり扱い」が実際に結果を変える場合だけ、技1回につき1回出す（連続技・おやこあいのループの外側）。
  //  ・ほのお技：ひでりの強化を受ける／みず技：半減する（実際の天候が晴れ以外の時のみ意味がある）
  //  ・ウェザーボール：実際の天候に関わらずほのおタイプ・威力2倍になる
  // 実際の天候が既にひでりなら結果は変わらないのでログは出さない。
  if (isMegaSolarActive(attacker) && move.category !== 'status') {
    const solarMoveType = resolveEffectiveMoveType(move, battleField, attacker);
    const isWeatherBallCase = move.id === 503 && battleField.weather !== 'sun';
    const isFireWaterCase = battleField.weather !== 'sun'
      && (solarMoveType === 'fire' || solarMoveType === 'water');
    if (isWeatherBallCase || isFireWaterCase) {
      logFn(`${attacker.species.name}の${abilityJp(ABILITY.MEGA_SOLAR)}が発動！ひざしが　つよい　ときの　ちからを　うけた！`);
    }
  }

  // ---- ふいうち (29) ----
  // 相手がこのターン攻撃技を選び、まだ行動していない場合のみ成功。
  // 相手が変化技を使う／交代する／既に行動済みの場合は失敗する（原作仕様）。
  // turnCtx が渡されない呼び出し（ゆびをふる等からの再帰呼び出し）では、原作同様に判定せず通常発動させる。
  if (move.id === 29 && turnCtx && !turnCtx.opponentWillAttack) {
    attacker.deaigashiraLocked = true;
    logFn(`しかし　うまく　きまらなかった！`);
    return;
  }

  // ---- であいがしら：場に出たそのターンに何か技を使ったら、以降ロック ----
  // 本家仕様では、であいがしら自身を選んだ場合はもちろん、他の技を選んだ場合でも
  // 「そのターンに行動した」時点でロックがかかり、次に交代して場に出直すまで使えない。
  attacker.deaigashiraLocked = true;

  if (move.callRandomMove) {
    const randomMove = pickRandomMove();
    logFn(`${randomMove.name}が飛び出した！`);
    executeMove(attacker, defender, randomMove, logFn, turnCtx);
    return;
  }

  // ---- げきりん：強制連続使用の管理 ----
  if (move.id === 43) {
    if (attacker.gekirinTurns <= 0) {
      // 新規発動：2〜3ターン継続（本ターンを含む）
      attacker.gekirinTurns = rand(2, 3);
      attacker.gekirinMoveId = 43;
    }
    attacker.gekirinTurns--;
    if (attacker.gekirinTurns <= 0) {
      attacker.gekirinMoveId = null;
      // 強制ターン終了後、自分が混乱する
      applyStatus(attacker, [100, STATUS.CONFUSE], logFn);
    }
  }

  // ---- 変化技の特殊処理 ----
  if (move.id === 160) { // おいかぜ
    const side = attacker.side === 'player' ? 'player' : 'cpu';
    if (side === 'player') battleField.tailwindPlayer = 4;
    else battleField.tailwindCpu = 4;
    logFn(`${attacker.species.name}はおいかぜを吹かせた！`);
    return;
  }
  if (move.id === 478) { // きりばらい
    if (attacker.side === 'player') {
      battleField.cpuReflect = 0;
      battleField.cpuLightScreen = 0;
    } else {
      battleField.playerReflect = 0;
      battleField.playerLightScreen = 0;
    }
    hazardState.player.stealthRock = false;
    hazardState.cpu.stealthRock = false;
    logFn(`${attacker.species.name}はきりばらいで場を払った！`);
    return;
  }
  if (move.id === 474) { // トリックルーム
    if (battleField.trickRoom) {
      battleField.trickRoom = false;
      battleField.trickRoomTurns = 0;
      logFn(`トリックルームが解除された！`);
    } else {
      battleField.trickRoom = true;
      battleField.trickRoomTurns = 5;
      logFn(`トリックルームが発動した！`);
    }
    return;
  }

  // ---- つみほろぼし (481) ----
  if (move.id === 481) {
    if (!attacker.removedTypes.includes('dark')) {
      attacker.removedTypes.push('dark');
      logFn(`${attacker.species.name}のあくタイプが消滅した！`);
    } else {
      logFn(`しかし、既にあくタイプは消滅している！`);
    }
    // 攻撃技なので、この後ダメージ計算に進む
  }

  // ---- こだまのさけび (491) ----
  if (move.id === 491) {
    if (!attacker.removedTypes.includes('grass')) {
      attacker.removedTypes.push('grass');
      logFn(`${attacker.species.name}のくさタイプが消滅した！`);
    } else {
      logFn(`しかし、既にくさタイプは消滅している！`);
    }
    // 攻撃技なので、この後ダメージ計算に進む
  }

  // ---- ナナイロレーザー (482) ----
  if (move.id === 482) {
    const typeKeys = ['bug','dark','dragon','electric','fairy','fighting','fire','flying','ghost','grass','ground','ice','normal','poison','psychic','rock','steel','water','sound','shine'];
    const newType = typeKeys[rand(0, typeKeys.length - 1)];
    attacker.changedType = newType;
    logFn(`${attacker.species.name}のタイプが${typeJp(newType)}に変わった！`);
    // 攻撃技なので、この後ダメージ計算に進む
  }

  // ---- フィールド設置技 ----
  if (move.id === 486) { setTerrain('grassy', 5, logFn); return; }
  if (move.id === 487) { setTerrain('electric', 5, logFn); return; }
  if (move.id === 488) { setTerrain('psychic', 5, logFn); return; }
  if (move.id === 489) { setTerrain('misty', 5, logFn); return; }
  if (move.id === 490) { setTerrain('melody', 5, logFn); return; }

  // ---- うつせみ (493) ----
  if (move.id === 493) {
    if (defender.utsusemiTurns > 0) {
      logFn(`しかし、既にうつせみがかかっている！`);
    } else {
      defender.utsusemiTurns = 4;
      logFn(`${defender.species.name}はうつせみの術にかかった！`);
    }
    return;
  }

  // ---- アンコール (492) ----
  if (move.id === 492) {
    if (defender.lastUsedMoveId !== null) {
      const lastMove = defender.moves.find(m => m.id === defender.lastUsedMoveId);
      if (lastMove && lastMove.pp > 0) {
        defender.encoreMoveId = defender.lastUsedMoveId;
        defender.encoreTurns = 3;
        logFn(`${defender.species.name}は${lastMove.name}をアンコールされた！`);
      } else {
        logFn(`しかし、相手は技を使っていない！`);
      }
    } else {
      logFn(`しかし、相手は技を使っていない！`);
    }
    return;
  }

  // ---- ひややかパンチ (226) ----
  if (move.id === 226) {
    if (defender.lastUsedMoveId !== null) {
      const targetMove = defender.moves.find(m => m.id === defender.lastUsedMoveId);
      if (targetMove && targetMove.pp > 0) {
        const reduce = Math.min(4, targetMove.pp);
        targetMove.pp -= reduce;
        logFn(`${defender.species.name}の${targetMove.name}のPPが${reduce}減った！`);
      } else {
        logFn(`しかし、相手は技を使っていない！`);
      }
    } else {
      logFn(`しかし、相手は技を使っていない！`);
    }
    // ひややかパンチは物理攻撃なので、ダメージ計算に進む
  }

  // ---- インフェルノ (480) / メイルストローム (483) / イルミンスール (484) ----
  // 使用後、次のターンだけそのタイプの技が使えなくなる（交代で解除、2ターン後には自然解除）
  if (move.id === 480) {
    attacker.typeLockTurns = 2;
    attacker.typeLockType = 'fire';
    logFn(`${attacker.species.name}は次のターン、ほのおタイプの技が使えなくなる！`);
    // ダメージ計算は通常通り
  }
  if (move.id === 483) {
    attacker.typeLockTurns = 2;
    attacker.typeLockType = 'water';
    logFn(`${attacker.species.name}は次のターン、みずタイプの技が使えなくなる！`);
    // ダメージ計算は通常通り
  }
  if (move.id === 484) {
    attacker.typeLockTurns = 2;
    attacker.typeLockType = 'grass';
    logFn(`${attacker.species.name}は次のターン、くさタイプの技が使えなくなる！`);
    // ダメージ計算は通常通り
  }

  // ---- 威力変動技 ----
  let modifiedPower = move.power;
  if (move.id === 109 || move.id === 179) {
    modifiedPower = calcVariablePower(move.id, attacker.currentHp, attacker.maxHp);
    logFn(`${move.name}の威力は${modifiedPower}になった！`);
  }
  if ((move.id === 128 || move.id === 169) && attacker.currentHp <= attacker.maxHp / 2) {
    modifiedPower = move.power * 2;
    logFn(`${move.name}の威力は${modifiedPower}になった！`);
  }

  // ---- 天候・地形による威力変更 ----
  if (move.id === 501 && battleField.terrain === 'electric') {
    modifiedPower = 80; // 基本威力はそのまま、命中は後で
  }
  if (move.id === 502 && battleField.weather === 'rain') {
    modifiedPower = move.power * 2;
    logFn(`${move.name}の威力は${modifiedPower}になった！`);
  }
  if (move.id === 150 && battleField.weather === 'rain') {
    modifiedPower = 180;
    logFn(`${move.name}の威力は${modifiedPower}になった！`);
  }
  if (move.id === 496 && battleField.weather === 'rain') {
    modifiedPower = 130;
    logFn(`${move.name}の威力は${modifiedPower}になった！`);
  }
  if (move.id === 498 && battleField.weather === 'sun') {
    modifiedPower = 130;
    logFn(`${move.name}の威力は${modifiedPower}になった！`);
  }
  if (move.id === 499 && battleField.terrain === 'grassy') {
    modifiedPower = 160;
    logFn(`${move.name}の威力は${modifiedPower}になった！`);
  }
  if (move.id === 59 && battleField.terrain !== 'none') {
    // エルダーバースト：フィールドがあれば必中
  }
  if (move.id === 494 && (defender.status === STATUS.POISON || defender.status === STATUS.BADLY_POISON)) {
    modifiedPower = 150;
    logFn(`${move.name}の威力は${modifiedPower}になった！`);
  }
  // 有刺鉄線：相手が状態異常の時、威力2倍
  if (move.id === 500 && hasMajorStatus(defender)) {
    modifiedPower = move.power * 2;
    logFn(`${move.name}の威力は${modifiedPower}になった！`);
  }
  if (move.id === 70 && battleField.terrain === 'electric') {
    modifiedPower = 120;
    logFn(`${move.name}の威力は${modifiedPower}になった！`);
  }

  // ---- エルダーバースト (59) フィールドチェック ----
  if (move.id === 59 && battleField.terrain === 'none') {
    logFn(`${defender.species.name}には効果がないようだ…`);
    return;
  }

  // 命中修正
  let modifiedAccuracy = move.accuracy;
  if ((move.id === 501 && battleField.terrain === 'electric') ||
      (move.id === 496 && battleField.weather === 'rain') ||
      (move.id === 498 && battleField.weather === 'sun') ||
      (move.id === 59 && battleField.terrain !== 'none')) {
    modifiedAccuracy = 999;
  }

  // ========== 連続技チェック ==========
  if (MULTI_HIT_MOVES[move.id]) {
    const attackerHpBeforeMulti = attacker.currentHp;
    const defenderHpBeforeMulti = defender.currentHp;
    const handled = executeMultiHit(attacker, defender, move, logFn);
    if (handled) {
      if (defender.fainted && !attacker.fainted && defender.ability === ABILITY.YUUBABU) {
        if (!battleField.chemicalGasActive || defender.ability === ABILITY.KAGAKUHENKAGASU) {
          const burstDmg = Math.max(1, Math.floor(defender.maxHp / 4));
          attacker.currentHp = Math.max(0, attacker.currentHp - burstDmg);
          logFn(`${defender.species.name}のゆうばくが発動！${attacker.species.name}は${burstDmg}のダメージを受けた！`, { hit: attacker.side });
          if (attacker.currentHp <= 0) {
            attacker.fainted = true;
            logFn(`${attacker.species.name}は倒れた！`, { faint: attacker.side });
          }
        }
      }
      if (defender.fainted && !attacker.fainted) {
        if (attacker.ability === ABILITY.JISHINKAJOU) {
          if (!battleField.chemicalGasActive || attacker.ability === ABILITY.KAGAKUHENKAGASU) {
            applyRankChange(attacker, [100, 1, 0, 0, 0, 0, 0, 0], logFn);
            logFn(`${attacker.species.name}のじしんかじょうが発動！`);
          }
        }
        if (attacker.ability === ABILITY.AFURERUCHISHIKI) {
          if (!battleField.chemicalGasActive || attacker.ability === ABILITY.KAGAKUHENKAGASU) {
            applyRankChange(attacker, [100, 0, 0, 1, 0, 0, 0, 0], logFn);
            logFn(`${attacker.species.name}のあふれるちしきが発動！`);
          }
        }
        if (attacker.ability === ABILITY.MAENOMERI) {
          if (!battleField.chemicalGasActive || attacker.ability === ABILITY.KAGAKUHENKAGASU) {
            applyRankChange(attacker, [100, 0, 0, 0, 0, 1, 0, 0], logFn);
            logFn(`${attacker.species.name}の${abilityJp(attacker.ability)}が発動！`);
          }
        }
      }
      checkAndTriggerFundo(attacker, logFn);
      checkAndTriggerFundo(defender, logFn);
      // じきゅうりょく等は、実際にHPが減った側でのみ発動させる
      // （ゆうばくの反動でattackerが減った場合はattacker側も対象になる）。
      if (attacker.currentHp < attackerHpBeforeMulti) {
        applyDamageTakenEffects(attacker, logFn);
      }
      if (defender.currentHp < defenderHpBeforeMulti) {
        applyDamageTakenEffects(defender, logFn);
      }
      // 技を使った本人（attacker）のlastUsedMoveIdを記録（アンコール・ひややかパンチ用）
      attacker.lastUsedMoveId = move.id;
      return;
    }
  }

  // ========== 通常技（連続技以外） ==========
  const gasActive = battleField.chemicalGasActive;
  const gasImmune = (poke) => poke.ability === ABILITY.KAGAKUHENKAGASU;

  // チャージ
  if (move.id === 505) {
    if (!gasActive || gasImmune(attacker)) {
      addEnergyStacks(attacker, 3, logFn);
    }
  } else if (ENERGY_CHARGE_MOVE_IDS.includes(move.id)) {
    if ((move.id === 218 || move.id === 334) && attacker.energyStacks > 0) {
      // チャージしない
    } else {
      if (!gasActive || gasImmune(attacker)) {
        addEnergyStacks(attacker, 1, logFn);
      }
    }
  }

  // スタック消費技
  let energyConsumed = 0;
  if (move.id === 218 || move.id === 334) {
    if (attacker.energyStacks >= 2) {
      energyConsumed = consumeEnergyStacks(attacker, logFn);
      if (energyConsumed > 0) {
        modifiedPower += energyConsumed * 20;
        logFn(`${attacker.species.name}は <img src="./energy.png" class="inline-stat-icon" onerror="this.style.visibility='hidden'"> ${energyConsumed} を 全て 消費して わざの 威力が上がった！`);
        if (energyConsumed >= 4) {
          const rankData = [100, 0, 0, 2, 0, 0, 0, 0];
          applyRankChange(attacker, rankData, logFn);
          logFn(`${attacker.species.name}の特攻が2段階上がった！`);
        }
      }
    }
  } else if (move.id === 498) {
    if (attacker.energyStacks > 0) {
      energyConsumed = consumeEnergyStacks(attacker, logFn);
      if (energyConsumed > 0) {
        modifiedPower += energyConsumed * 25;
        logFn(`${attacker.species.name}は <img src="./energy.png" class="inline-stat-icon" onerror="this.style.visibility='hidden'"> ${energyConsumed} を 全て 消費して わざの 威力が上がった！`);
      }
    }
  }

  // レールガン（でんきタイプの攻撃技のみ対象。変化技ではスタックを消費しない）
  if (move.type === 'electric' && move.category !== 'status' && attacker.ability === ABILITY.RAIL_GUN && energyConsumed === 0) {
    if (!gasActive || gasImmune(attacker)) {
      if (attacker.energyStacks > 0) {
        const railConsumed = consumeEnergyStacks(attacker, logFn);
        if (railConsumed > 0) {
          modifiedPower += railConsumed * 30;
          logFn(`${attacker.species.name}のレールガン！ <img src="./energy.png" class="inline-stat-icon" onerror="this.style.visibility='hidden'"> ${railConsumed} を 全て 消費して わざの 威力が上がった！`);
        }
      }
    }
  }

  // ----- 変化技（特殊処理以外） -----
  if (move.category === 'status') {
    if (modifiedAccuracy !== undefined && modifiedAccuracy < 999) {
      if (!checkAccuracy(attacker, defender, { ...move, accuracy: modifiedAccuracy }, logFn)) {
        logFn(`しかし当たらなかった！`);
        return;
      }
    } else if (!checkAccuracy(attacker, defender, move, logFn)) {
      logFn(`しかし当たらなかった！`);
      return;
    }
    if (move.id === 318 || move.id === 495) {
      setHazard(move.id, attacker.side, logFn);
      applyRankChange(attacker, move.selfRank, logFn);
      applyStatus(attacker, move.selfStatus, logFn);
      return;
    }
    if (move.id === 477) {
      applyRankChange(attacker, move.selfRank, logFn);
      applyStatus(attacker, move.selfStatus, logFn);
      attacker.pendingSwitchOut = true;
      attacker.batonPass = {
        ranks: { ...attacker.ranks },
        confuseTurns: attacker.confuseTurns || 0,
      };
      return;
    }
    // ほえる(508)／ふきとばし(509)：変化技として必ず命中し、ダメージを与えず
    // 相手を強制的に交代させる。実際の交代処理はドラゴンテール(49)等と同様、
    // pendingForceSwitchをrunTurn側で見て解決する（交代自体のログはそちら側で出る）。
    if (move.id === 508 || move.id === 509) {
      defender.pendingForceSwitch = true;
      return;
    }
    if (move.id === 475) {
      const side = attacker.side === 'player' ? 'player' : 'cpu';
      if (side === 'player') battleField.playerReflect = 5;
      else battleField.cpuReflect = 5;
      logFn(`${attacker.species.name}はリフレクターを張った！`);
      return;
    }
    if (move.id === 476) {
      const side = attacker.side === 'player' ? 'player' : 'cpu';
      if (side === 'player') battleField.playerLightScreen = 5;
      else battleField.cpuLightScreen = 5;
      logFn(`${attacker.species.name}はひかりのかべを張った！`);
      return;
    }
    if (move.id === 485) {
      if (defender.tauntTurns > 0) {
        logFn('しかし失敗した！');
        return;
      }
      defender.tauntTurns = 3;
      logFn(`${defender.species.name}は挑発された！`);
      return;
    }
    if (move.id === 414) {
      // きあいだめ：急所ランク+2（最大3まで）
      if (attacker.critRank >= 3) {
        logFn('しかし失敗した！');
      } else {
        attacker.critRank = Math.min(3, attacker.critRank + 2);
        logFn(`${attacker.species.name}は気合をためた！`);
      }
      return;
    }

    // ---- はねやすめ・じこさいせい等：ダメージを伴わない自己回復技 ----
    // drainRatioは通常「与えたダメージ量に対する回復率」だが、
    // 変化技（威力なし＝ダメージを与えない）の場合は「最大HPに対する回復率」として扱う。
    if (move.drainRatio) {
      if (attacker.currentHp >= attacker.maxHp) {
        logFn(`しかし${attacker.species.name}のHPは満タンだった！`);
      } else {
        const healAmt = Math.max(1, Math.floor(attacker.maxHp * move.drainRatio));
        attacker.currentHp = Math.min(attacker.maxHp, attacker.currentHp + healAmt);
        logFn(`${attacker.species.name}は体力を回復した！`, { hit: attacker.side });
      }
    }

    // ちからずく（suppressSecondary）は「攻撃技の追加効果」を消す代わりに威力を上げる特性であり、
    // マグナライズ・つるぎのまい等の変化技そのものの効果（selfRank/oppRank/selfStatus/oppStatus）を
    // 消してしまうのは誤り。ここは move.category === 'status' 専用ブロックなので常に無視して適用する。
    applyRankChange(attacker, move.selfRank, logFn, null, defender);
    applyRankChange(defender, move.oppRank, logFn, null, attacker);
    applyStatus(attacker, move.selfStatus, logFn);
    applyStatus(defender, move.oppStatus, logFn, effectiveAbilityId(attacker));
    // 技を使った本人（attacker）のlastUsedMoveIdを記録（アンコール・ひややかパンチ用）
    attacker.lastUsedMoveId = move.id;
    return;
  }

  // ----- 攻撃技 -----
  // 命中判定
  const accForCheck = modifiedAccuracy !== undefined ? modifiedAccuracy : move.accuracy;
  if (accForCheck !== undefined && accForCheck !== null && accForCheck < 999) {
    if (!checkAccuracy(attacker, defender, { ...move, accuracy: accForCheck }, logFn)) {
      logFn(`しかし${defender.species.name}には当たらなかった！`);
      return;
    }
  }

  // ウェザーボール等、天候・フィールド・メガソーラーで実際に繰り出すタイプが変わる技の実効タイプ。
  // 吸収特性の判定と、ダメージ時の演出（moveType）／対人ゲストへの同期の両方で同じ値を使う。
  const effectMoveType = resolveEffectiveMoveType(move, battleField, attacker);
  const effectMovePowerScale = ((move.id === 503 || move.id === 504) && effectMoveType !== move.type) ? 2 : 1;

  // タイプ吸収系（実効タイプを使用）
  const absorbType = TYPE_ABSORB_ABILITY_TYPE[defender.ability];
  if (absorbType && effectMoveType === absorbType && attacker.ability !== ABILITY.KATAYABURI) {
    if (!battleField.chemicalGasActive || defender.ability === ABILITY.KAGAKUHENKAGASU) {
      if (defender.ability === ABILITY.CHIKUDEN) {
        logFn(`${defender.species.name}のちくでんが発動！`);
        applyRankChange(defender, [100, 0, 0, 1, 0, 0, 0, 0], logFn);
      } else if (defender.ability === ABILITY.CHOSUI) {
        logFn(`${defender.species.name}のちょすいが発動！`);
        const healAmt = Math.max(1, Math.floor(defender.maxHp / 4));
        defender.currentHp = Math.min(defender.maxHp, defender.currentHp + healAmt);
        logFn(`${defender.species.name}のHPが回復した！`, { hit: defender.side });
      } else if (defender.ability === ABILITY.MORAIBI) {
        if (!defender.moraibiActive) {
          defender.moraibiActive = true;
          logFn(`${defender.species.name}のもらいびが発動！`);
        }
      } else if (defender.ability === ABILITY.MUSHIYOKE) {
        logFn(`${defender.species.name}のむしよけが発動！`);
        applyRankChange(defender, [100, 0, 1, 0, 0, 0, 0, 0], logFn);
      } else if (defender.ability === ABILITY.SOUSHOKU) {
        logFn(`${defender.species.name}のそうしょくが発動！`);
        applyRankChange(defender, [100, 1, 0, 0, 0, 0, 0, 0], logFn);
      }
      return;
    }
  }

  const moveForCalc = { ...move, power: modifiedPower };
  const { damage: firstHitDamage, typeMult, isCrit: firstHitCrit } = calcDamage(attacker, defender, moveForCalc, logFn);
  if (typeMult === 0) {
    logFn(`${defender.species.name}には効果がないようだ…`);
    return;
  }

  // ---- おやこあい ----
  // 攻撃技を出すと2回攻撃になる（2発目の威力は1発目の1/4）。命中判定は1回のみで、
  // 命中すれば2回とも当たる。連続技（MULTI_HIT_MOVES）は専用処理があるため対象外、
  // じばく・だいばくはつ等の自分がひんしになる技も対象外（本家仕様）。
  const isOyakoAi = attacker.ability === ABILITY.OYAKOAI && !MULTI_HIT_MOVES[move.id] && !move.selfDestruct;
  const oyakoAiHitCount = isOyakoAi ? 2 : 1;

  let totalDamageDealt = 0;
  let lastHitDamage = 0;
  let lastHitCrit = false;

  for (let hitNum = 1; hitNum <= oyakoAiHitCount; hitNum++) {
    if (attacker.fainted || defender.fainted) break;

    let damage, isCrit;
    if (hitNum === 1) {
      damage = firstHitDamage;
      isCrit = firstHitCrit;
    } else {
      const secondHitPower = Math.max(1, Math.floor(modifiedPower / 4));
      const moveForCalcSecond = { ...move, power: secondHitPower };
      const secondResult = calcDamage(attacker, defender, moveForCalcSecond, logFn);
      if (secondResult.typeMult === 0) break;
      damage = secondResult.damage;
      isCrit = secondResult.isCrit;
    }

    const wasFullHp = defender.currentHp === defender.maxHp;
    let survivedByGanjou = false;
    if (wasFullHp && defender.ability === ABILITY.GANJOU && damage >= defender.currentHp) {
      if (!battleField.chemicalGasActive || defender.ability === ABILITY.KAGAKUHENKAGASU) {
        survivedByGanjou = true;
      }
    }
    // こらえる：がんじょうと異なり満タンHP条件は無い。ひんしになるダメージなら必ずHPが1残る。
    // おやこあいの2発目でも毎回この判定が通るため、複数回ヒットしてもこらえる中は倒れない。
    let survivedByEndure = false;
    if (!survivedByGanjou && defender.enduring && damage >= defender.currentHp) {
      survivedByEndure = true;
    }

    const hpBeforeDamage = defender.currentHp;
    defender.currentHp = Math.max(0, defender.currentHp - damage);
    if (survivedByGanjou || survivedByEndure) defender.currentHp = 1;
    const actualDamageDealt = hpBeforeDamage - defender.currentHp;
    totalDamageDealt += actualDamageDealt;
    lastHitDamage = damage;
    lastHitCrit = isCrit;
    logFn(`${defender.species.name}に${damage}のダメージ！`, { hit: defender.side, typeMult, moveType: effectMoveType, movePower: (hitNum === 1 ? modifiedPower : Math.max(1, Math.floor(modifiedPower / 4))) * effectMovePowerScale, moveId: move.id });
    if (isCrit) logFn('急所に当たった！');
    if (typeMult > 1 && hitNum === 1) logFn('効果は抜群だ！');
    else if (typeMult < 1 && hitNum === 1) logFn('効果は今ひとつのようだ…');
    if (survivedByEndure) logFn(`${defender.species.name}はこらえた！`);
    if (survivedByGanjou) logFn(`${defender.species.name}はがんじょうで持ちこたえた！`);

    // ---- はかいこうせん：命中して技が成立した場合、相手を倒したかどうかに関わらず
    // 次のターンは反動で動けなくなる（本家仕様）。 ----
    if (move.id === 253) {
      attacker.mustRechargeTurns = 1;
    }

    // いざない：攻撃技を受けると、相手（攻撃側）を2ターン後にねむりにする（各ヒットで判定するが、仕込み済みなら上書きしない）
    if (move.category !== 'status') {
      applyIzanaiOnHit(defender, attacker, logFn);
    }

    // とびだすハバネロ：攻撃技（物理・特殊問わず）を受けると、相手をやけど状態にする（各ヒットごとに判定）
    if (defender.ability === ABILITY.TOBIDASU_HABANERO && move.category !== 'status' && !attacker.fainted) {
      if (!battleField.chemicalGasActive || defender.ability === ABILITY.KAGAKUHENKAGASU) {
        if (applyStatus(attacker, [100, STATUS.BURN], logFn, effectiveAbilityId(defender))) {
          logFn(`${defender.species.name}の${abilityJp(defender.ability)}が発動！`);
        }
      }
    }

    // きずつけボディ（各ヒットごとに判定）
    if (defender.ability === ABILITY.KIZUTSUKEBODY && move.category === 'physical' && !attacker.fainted) {
      if (!battleField.chemicalGasActive || defender.ability === ABILITY.KAGAKUHENKAGASU) {
        const roughDmg = Math.max(1, Math.floor(attacker.maxHp / 8));
        attacker.currentHp = Math.max(0, attacker.currentHp - roughDmg);
        logFn(`${defender.species.name}のきずつけボディ！${attacker.species.name}はダメージを受けた！`, { hit: attacker.side });
        if (attacker.currentHp <= 0) { attacker.fainted = true; logFn(`${attacker.species.name}は倒れた！`, { faint: attacker.side }); }
      }
    }

    if (attacker.fainted) break;

    // 攻撃技命中後の追加効果（ひるみ・能力ランク変化・状態異常）：各ヒットごとに独立判定
    // ここは「defender.fainted」ではなく「defender.currentHp > 0」で判定する。
    // defender.faintedはこの少し下（相手を倒した場合の処理）で初めてtrueになるため、
    // 相手を倒した一撃の直後はまだfaintedがfalseのままこのブロックに入ってしまい、
    // selfRank（インファイトの防御・特防ダウンなど）が下のブロックと合わせて
    // 2回発動してしまう不具合があった。currentHpで判定することで、相手を倒した
    // ときは自分のselfRankが下のブロックで1回だけ発動するようにする。
    if (defender.currentHp > 0) {
      if (!suppressSecondary) {
        let flinchChance = move.flinchChance || 0;
        if (attacker.ability === ABILITY.TEN_NO_MEGUMI && abilityActive(attacker)) flinchChance = Math.min(100, flinchChance * 2);
        if (flinchChance && rand(1, 100) <= flinchChance) defender.flinch = true;
        applyRankChange(defender, move.oppRank, logFn, null, attacker);
        applyRankChange(attacker, move.selfRank, logFn, null, defender);
        applyStatus(defender, move.oppStatus, logFn, effectiveAbilityId(attacker));
        // げきりん(43)は専用の連続技処理で混乱を扱うためここでは除外
        if (move.id !== 43) applyStatus(attacker, move.selfStatus, logFn);
        // 有刺鉄線：場に何かのフィールドが張られている時、相手を確定でもうどく状態にする
        if (move.id === 500 && battleField.terrain && battleField.terrain !== 'none' && defender.currentHp > 0) {
          applyStatus(defender, [100, STATUS.BADLY_POISON], logFn, effectiveAbilityId(attacker));
        }
      }
      if (move.category === 'physical' && defender.currentHp > 0) {
        if (defender.ability === ABILITY.SEIDENKI && attacker.status === STATUS.NONE && rand(1, 100) <= 30) {
          if (!battleField.chemicalGasActive || defender.ability === ABILITY.KAGAKUHENKAGASU) {
            applyStatus(attacker, [100, STATUS.PARALYZE], logFn);
          }
        } else if (defender.ability === ABILITY.FUSHOKU_NO_TOGE && attacker.status === STATUS.NONE && rand(1, 100) <= 50) {
          if (!battleField.chemicalGasActive || defender.ability === ABILITY.KAGAKUHENKAGASU) {
            applyStatus(attacker, [100, STATUS.BADLY_POISON], logFn);
          }
        } else if (defender.ability === ABILITY.HONOO_NO_KARADA && attacker.status === STATUS.NONE && rand(1, 100) <= 30) {
          if (!battleField.chemicalGasActive || defender.ability === ABILITY.KAGAKUHENKAGASU) {
            applyStatus(attacker, [100, STATUS.BURN], logFn);
          }
        }
      }
    }

    if (defender.currentHp <= 0) {
      defender.fainted = true;
      // 相手を倒した場合でも、技自体は命中しているため自分のランク変化（selfRank）は発動する。
      // 朧一閃・ブリザードなどの「自分が状態異常になる」効果（selfStatus）も同様に、
      // 相手を倒した一撃で発動させる（上のdefender.currentHp > 0ブロックは相手が生存している
      // 場合しか通らないため、倒した場合はここで1回だけ適用する）。
      // げきりん(43)は専用の連続技処理で混乱を扱うため、ここでも除外する。
      if (!suppressSecondary && !attacker.fainted) {
        applyRankChange(attacker, move.selfRank, logFn, null, defender);
        if (move.id !== 43) applyStatus(attacker, move.selfStatus, logFn);
      }
      break;
    }

    // ドラゴンテール(49)／510：命中して相手を倒さなかった場合、相手を強制的に交代させる。
    // 相手が瀕死になった場合（直前のbreak）は発動しない。実際の交代処理は
    // runTurn側でpendingForceSwitchを見て行う（ui.js側のコールバックで解決）。
    if ((move.id === 49 || move.id === 510) && defender.currentHp > 0 && !defender.fainted) {
      defender.pendingForceSwitch = true;
    }
  }

  // サンパワー / アイスブレイク（技を出したことに対する自傷なので1回のみ）
  if (attacker.ability === ABILITY.SUN_POWER && battleField.weather === 'sun' && !attacker.fainted) {
    if (!battleField.chemicalGasActive || attacker.ability === ABILITY.KAGAKUHENKAGASU) {
      const selfDmg = Math.max(1, Math.floor(attacker.maxHp / 8));
      attacker.currentHp = Math.max(0, attacker.currentHp - selfDmg);
      logFn(`${attacker.species.name}のサンパワー！自分もダメージを受けた！`, { hit: attacker.side });
      if (attacker.currentHp <= 0) { attacker.fainted = true; logFn(`${attacker.species.name}は倒れた！`, { faint: attacker.side }); }
    }
  }
  if (attacker.ability === ABILITY.ICE_BREAK && battleField.weather === 'snow' && !attacker.fainted) {
    if (!battleField.chemicalGasActive || attacker.ability === ABILITY.KAGAKUHENKAGASU) {
      const selfDmg = Math.max(1, Math.floor(attacker.maxHp / 8));
      attacker.currentHp = Math.max(0, attacker.currentHp - selfDmg);
      logFn(`${attacker.species.name}のアイスブレイク！自分もダメージを受けた！`, { hit: attacker.side });
      if (attacker.currentHp <= 0) { attacker.fainted = true; logFn(`${attacker.species.name}は倒れた！`, { faint: attacker.side }); }
    }
  }

  // 反動・吸収技：本家仕様では両方のヒットの合計ダメージを基準に、最後のヒットの後で1回だけ適用する
  if (move.selfDestruct) {
    attacker.currentHp = 0;
  } else if (move.recoilRatio) {
    if (attacker.ability === ABILITY.HANDOUMUKOU) {
      logFn(`${attacker.species.name}のはんどうむこうが発動！`);
    } else {
      const recoilDmg = Math.max(1, Math.floor(totalDamageDealt * move.recoilRatio));
      attacker.currentHp = Math.max(0, attacker.currentHp - recoilDmg);
      logFn(`${attacker.species.name}は反動でダメージを受けた！`, { hit: attacker.side });
    }
  } else if (move.drainRatio) {
    let effDrainRatio = move.drainRatio;
    if (attacker.ability === ABILITY.HANASANAI &&
        (!battleField.chemicalGasActive || attacker.ability === ABILITY.KAGAKUHENKAGASU)) {
      effDrainRatio *= 1.25;
      logFn(`${attacker.species.name}の${abilityJp(attacker.ability)}が発動！`);
    }
    const healAmt = Math.max(1, Math.floor(totalDamageDealt * effDrainRatio));
    attacker.currentHp = Math.min(attacker.maxHp, attacker.currentHp + healAmt);
    logFn(`${attacker.species.name}は体力を吸い取った！`, { hit: attacker.side });
  }

  // ---- エルダーバースト：フィールド破壊 ----
  if (move.id === 59 && battleField.terrain !== 'none') {
    battleField.terrain = 'none';
    battleField.terrainTurns = 0;
    logFn(`フィールドが破壊された！`);
  }

  // ---- かげぬい／ランチャーアーム：命中してもなお相手が場に残っていれば、逃げられなくする ----
  // ちからずく持ちでは追加効果として扱い、発動しない（ガス中は特性が無効なので通常どおり発動）。
  if (SHADOW_TRAP_MOVE_IDS.includes(move.id) && !defender.fainted && !suppressSecondary) {
    applyShadowTrap(defender, logFn, attacker);
  }

  // ---- くろしお：バインド付与 ----
  if (move.id === 502 && battleField.weather === 'rain' && !defender.fainted) {
    if (defender.bindTurns === 0) {
      defender.bindTurns = 6;
      logFn(`${defender.species.name}はバインド状態になった！`);
    }
  }

  // ---- むらくもばらい：天気をなしに ----
  if (move.id === 150 && battleField.weather === 'rain') {
    battleField.weather = 'none';
    battleField.weatherTurns = 0;
    logFn(`天気が晴れになった！`);
  }

  // ---- テラーバインド：ダメージを与えた上で、相手の技を1つ封じる ----
  if (move.id === 180 && !defender.fainted) {
    const unlockable = defender.moves.filter(m => m && !m.locked);
    if (unlockable.length > 0) {
      const target = pick(unlockable);
      target.locked = true;
      logFn(`${defender.species.name}の${target.name}が封じられた！`);
    } else {
      logFn(`しかし、全ての技が既に封じられている！`);
    }
  }

  if (attacker.currentHp <= 0 && !attacker.fainted) {
    attacker.fainted = true;
    logFn(`${attacker.species.name}は倒れた！`, { faint: attacker.side });
  }

  if (defender.currentHp <= 0) {
    if (!defender.fainted) {
      defender.fainted = true;
      logFn(`${defender.species.name}は倒れた！`, { faint: defender.side });
    }
    if (move.id === 136) {
      setWeather('sun', 5, logFn);
    }
    if (move.id === 358) {
      setWeather('rain', 5, logFn);
    }
    if (defender.ability === ABILITY.YUUBABU && !attacker.fainted) {
      if (!battleField.chemicalGasActive || defender.ability === ABILITY.KAGAKUHENKAGASU) {
        const burstDmg = Math.max(1, Math.floor(defender.maxHp / 4));
        attacker.currentHp = Math.max(0, attacker.currentHp - burstDmg);
        logFn(`${defender.species.name}のゆうばくが発動！${attacker.species.name}は${burstDmg}のダメージを受けた！`, { hit: attacker.side });
        if (attacker.currentHp <= 0) {
          attacker.fainted = true;
          logFn(`${attacker.species.name}は倒れた！`, { faint: attacker.side });
        }
      }
    }
  } else if (!attacker.fainted) {
    // きたかぜたいよう：命中すると天候がひでり（sun）になる（5ターン）
    if (move.id === 136) {
      setWeather('sun', 5, logFn);
    }
    // ゆうだち：命中すると天候があめ（rain）になる（5ターン）
    if (move.id === 358) {
      setWeather('rain', 5, logFn);
    }
  }

  // 倒したときの特性
  if (defender.fainted && !attacker.fainted) {
    if (attacker.ability === ABILITY.JISHINKAJOU) {
      if (!battleField.chemicalGasActive || attacker.ability === ABILITY.KAGAKUHENKAGASU) {
        applyRankChange(attacker, [100, 1, 0, 0, 0, 0, 0, 0], logFn);
        logFn(`${attacker.species.name}のじしんかじょうが発動！`);
      }
    }
    if (attacker.ability === ABILITY.AFURERUCHISHIKI) {
      if (!battleField.chemicalGasActive || attacker.ability === ABILITY.KAGAKUHENKAGASU) {
        applyRankChange(attacker, [100, 0, 0, 1, 0, 0, 0, 0], logFn);
        logFn(`${attacker.species.name}のあふれるちしきが発動！`);
      }
    }
    if (attacker.ability === ABILITY.MAENOMERI) {
      if (!battleField.chemicalGasActive || attacker.ability === ABILITY.KAGAKUHENKAGASU) {
        applyRankChange(attacker, [100, 0, 0, 0, 0, 1, 0, 0], logFn);
        logFn(`${attacker.species.name}の${abilityJp(attacker.ability)}が発動！`);
      }
    }
  }

  checkAndTriggerFundo(attacker, logFn);
  checkAndTriggerFundo(defender, logFn);
  // じきゅうりょく等は、このexecuteMove内で実際にHPが減った側でのみ発動させる
  // （攻撃しただけの側で毎回誤発動していたバグの修正）。
  if (attacker.currentHp < attackerHpAtMoveStart) {
    applyDamageTakenEffects(attacker, logFn);
  }
  if (defender.currentHp < defenderHpAtMoveStart) {
    applyDamageTakenEffects(defender, logFn);
  }

  // 技を使った本人（attacker）のlastUsedMoveIdを記録（アンコール・ひややかパンチ用）
  attacker.lastUsedMoveId = move.id;

  if ((move.id === 3 || move.id === 349 || move.id === 80) && !attacker.fainted) {
    attacker.pendingSwitchOut = true;
  }
}

// ---- ターン処理 ----
// onImmediateSwitch: 交代技（とんぼがえり等）でpendingSwitchOutが立ったポケモンを
// その場で交代させるための非同期コールバック（ui.js側で実装）。
// 呼び出しシグネチャ: onImmediateSwitch(side) -> Promise<新しいアクティブポケモン or null>
// null は「交代できなかった（控えなし／バインド中など）」を意味し、その場合は元のポケモンのまま続行する。
async function runTurn(playerAction, cpuAction, playerPoke, cpuPoke, logFn, onImmediateSwitch) {
  // ---- まもるの状態リセット ----
  // まもるは「使ったそのターンだけ」有効な状態。ここで一旦解除しておき、
  // このターン中にまもるが選択された場合はexecuteMove内で改めてtrueになる。
  // 連続成功率のカウントも、このターンにまもるを選ばなかった側はリセットする
  // （本家仕様：前のターンにまもるを使っていないと連続ボーナスが途切れる）。
  [{ poke: playerPoke, action: playerAction }, { poke: cpuPoke, action: cpuAction }].forEach(({ poke, action }) => {
    if (!poke.fainted) {
      poke.protecting = false;
      const usingProtect = action.type === 'move' && action.move && action.move.id === 2019;
      if (!usingProtect) poke.protectStreak = 0;

      // ---- こらえるの状態リセット ----
      // こらえるも「使ったそのターンだけ」有効な状態。まもると全く同じ考え方でリセットする。
      // 連続成功率のカウントも、このターンにこらえるを選ばなかった側はリセットする
      // （本家仕様：前のターンにこらえるを使っていないと連続ボーナスが途切れる）。
      poke.enduring = false;
      const usingEndure = action.type === 'move' && action.move && action.move.id === 506;
      if (!usingEndure) poke.endureStreak = 0;
    }
  });

  const actions = [];
  if (playerAction.type === 'move') actions.push({ side: 'player', poke: playerPoke, target: cpuPoke, move: playerAction.move });
  if (cpuAction.type === 'move') actions.push({ side: 'cpu', poke: cpuPoke, target: playerPoke, move: cpuAction.move });

  if (battleField.terrain === 'psychic') {
    actions.forEach((a) => {
      if (movePriorityWithWeather(a.move) > 0) {
        logFn(`サイコフィールドが　${a.poke.species.name}の先制を　うちけした！`);
      }
    });
  }

  // ---- メガシンカの解決 ----
  // 本家仕様：メガシンカは「行動順を決める素早さ判定より前」に確定する。
  // そのため、メガシンカした本人のそのターンの素早さ比較には、変身後の実数値が使われる
  // （例：素早さ102のガブリアスがメガシンカして素早さ92のメガガブリアスになった場合、
  // 　相手の素早さが100なら、その回のメガガブリアスは相手より遅く行動する）。
  // これを再現するため、メガシンカの解決は必ず行動順ソートの「前」に行う。
  // メッセージは2段階：①「（トレーナー名）の メガリングが 反応した！」→②「〇〇はメガシンカした！」
  // ①の文言はトレーナー名を要するためUI側（makeLogFn）で組み立てる。ここではメタ情報のみ載せる。
  //
  // 重要：このターンの技（ダメージ・状態異常付与等）は、この時点ではまだ実行されていないが、
  // runTurn自体は同期的に進み、この後すぐ後続の技実行ループが走ってターンの計算が全て確定してしまう。
  // 一方でメガシンカの「演出」はUI側で後からキューを再生する形（drainMessages）で見せるため、
  // 演出中（画像が繭に隠れている間）にHUDのHP/状態異常だけ最新値（=ダメージ後・状態異常付与後）に
  // 更新されてしまうと、見た目上「メガシンカの演出中にもう攻撃を受けている」ように見えてしまう。
  // これを防ぐため、メガシンカが実際に起きた「その瞬間」のHP・状態異常をスナップショットとして
  // メタ情報に持たせ、UI側はそのスナップショットでHUDを更新する（＝本当のダメージ反映は、
  // 実際にその攻撃メッセージが表示されるタイミングまで見た目上も遅延される）。
  // なお、メガシンカ自体の解決順（player→cpuの配列順）は行動順の決定には影響しない
  // （メガシンカに優先度は無く、この後の素早さソートで改めて行動順が決まるため）。
  for (const action of actions) {
    const poke = action.poke;
    if (poke.fainted) continue;
    if (poke.wantsMegaEvolve) {
      // 予約中でも、既に相棒がこのバトルでメガシンカ済みなら不発として予約だけ解除する
      // （本家同様、1トレーナー1匹まで）。
      if (!canMegaEvolveNow(poke)) {
        poke.wantsMegaEvolve = false;
        continue;
      }
      poke.wantsMegaEvolve = false;
      logFn('', { megaRing: true, side: poke.side });
      const megaSucceeded = megaEvolve(poke);
      if (megaSucceeded) {
        logFn(`${poke.species.name}は　メガシンカした！`, {
          megaEvolve: true,
          side: poke.side,
          hpSnapshot: poke.currentHp,
          statusSnapshot: poke.status || STATUS.NONE,
          confuseSnapshot: poke.confuseTurns || 0,
        });
        // メガシンカで特性が変わった瞬間に発動する効果（いかく／天候セット／フィールドセット等）。
        // 例：メガライボルト（せいでんき→いかく）、メガライチュウX（せいでんき→エレキメイカー）。
        applyMegaEvolveAbilityTrigger(poke, logFn, action.target);
      }
    }
  }

  // メガシンカの解決が終わり、実数値（素早さ）が確定した状態で行動順を決める。
  if (battleField.trickRoom) {
    actions.sort((a, b) => {
      const pa = effectivePriority(a.poke, a.move), pb = effectivePriority(b.poke, b.move);
      if (pa !== pb) return pb - pa;
      return effectiveSpeed(a.poke) - effectiveSpeed(b.poke);
    });
  } else {
    actions.sort((a, b) => {
      const pa = effectivePriority(a.poke, a.move), pb = effectivePriority(b.poke, b.move);
      if (pa !== pb) return pb - pa;
      return effectiveSpeed(b.poke) - effectiveSpeed(a.poke);
    });
  }

  for (let i = 0; i < actions.length; i++) {
    const action = actions[i];
    if (action.poke.fainted || action.target.fainted) continue;
    if (!checkCanMove(action.poke, logFn)) continue;
    // ふいうち(29)用：相手がこのターン「攻撃技」を選んでいて、かつまだ行動していない場合のみ成功。
    // 相手が変化技を選んだ・交代した（=このターンactionsに技として存在しない）・既に行動済みなら失敗。
    // 対戦（CPU戦・トレーナー戦・対人戦のホスト側）はどれもこのrunTurnを通るため、ここで一括対応できる。
    const oppAction = actions.find((o, idx) => o !== action && o.poke === action.target);
    const oppIdx = oppAction ? actions.indexOf(oppAction) : -1;
    const opponentWillAttack = !!(oppAction && oppIdx > i && oppAction.move && oppAction.move.category !== 'status');
    executeMove(action.poke, action.target, action.move, logFn, { opponentWillAttack });
    if (action.target.fainted || action.poke.fainted) break;

    // とんぼがえり等で交代予約が立った場合、原作同様にここで即座に交代を解決する。
    // まだ実行されていない後続の行動があれば、そのtargetを新しいポケモンに差し替える。
    if (action.poke.pendingSwitchOut && !action.poke.fainted && typeof onImmediateSwitch === 'function') {
      action.poke.pendingSwitchOut = false;
      const leavingPoke = action.poke;
      const newActive = await onImmediateSwitch(action.side);
      if (newActive) {
        // かげぬい：縫い付けた本人が交代で場を離れたので、相手の縫い止めを解除する。
        // （action.target は、この技の対象＝相手側のポケモン）
        clearShadowTrapsBy(leavingPoke, action.target);
        for (let j = i + 1; j < actions.length; j++) {
          if (actions[j].poke === action.poke) actions[j].poke = newActive;
          if (actions[j].target === action.poke) actions[j].target = newActive;
        }
        if (action.side === 'player') playerPoke = newActive; else cpuPoke = newActive;
      }
    }

    // ドラゴンテール／ほえる／ふきとばし等：相手（action.target）に強制交代フラグが
    // 立った場合、ここで解決する。onImmediateSwitchは「指定したsideのアクティブ
    // ポケモンを交代させる」汎用コールバックなので、対象側（相手側）を指定してそのまま
    // 流用する（控えなし／バインド中なら内部でnullが返り不発）。
    if (action.target.pendingForceSwitch && !action.target.fainted && typeof onImmediateSwitch === 'function') {
      action.target.pendingForceSwitch = false;
      const leavingPoke = action.target;
      const targetSide = action.side === 'player' ? 'cpu' : 'player';
      const newActive = await onImmediateSwitch(targetSide);
      if (newActive) {
        clearShadowTrapsBy(leavingPoke, action.poke);
        for (let j = i + 1; j < actions.length; j++) {
          if (actions[j].poke === action.target) actions[j].poke = newActive;
          if (actions[j].target === action.target) actions[j].target = newActive;
        }
        if (targetSide === 'player') playerPoke = newActive; else cpuPoke = newActive;
      }
    }
  }

  // このターンの行動機会は既に終了しているため、これ以上消費されずに残ったひるみフラグは
  // 次ターンへ持ち越さずここで破棄する（「先攻に当てたひるみが次のターンに発動する」誤動作を防止）。
  if (!playerPoke.fainted) playerPoke.flinch = false;
  if (!cpuPoke.fainted) cpuPoke.flinch = false;

  [playerPoke, cpuPoke].forEach((p) => { if (!p.fainted) applyEndOfTurnStatus(p, logFn); });
  // いざない：仕込まれたねむりのカウントダウン（状態異常のダメージ処理の後、技入れ替えの前に判定）
  [playerPoke, cpuPoke].forEach((p) => { if (!p.fainted) applyIzanaiEndOfTurn(p, logFn); });
  // ランダムアクト：ターン終了時に技を全て入れ替える
  [playerPoke, cpuPoke].forEach((p) => { if (!p.fainted) applyRandomActEndOfTurn(p, logFn); });
  const alivePokes = [playerPoke, cpuPoke].filter((p) => !p.fainted);
  if (alivePokes.length > 0) applyEndOfTurnField(alivePokes, logFn);

  // いちじんのかぜ：このターン中に自分が瀕死になった場合、自分の場におい風を4ターン吹かせる。
  // 毒・天候ダメージ等、瀕死になる経路が多岐にわたるため、個別箇所に仕込まず
  // ターン終了時にまとめて判定する。同じ瀕死状態で二重発動しないよう、専用フラグで一度だけ処理する。
  [playerPoke, cpuPoke].forEach((p) => {
    if (p.fainted && p.ability === ABILITY.ICHIJINNOKAZE && !p._ichijinNoKazeTriggered) {
      p._ichijinNoKazeTriggered = true;
      if (!battleField.chemicalGasActive || p.ability === ABILITY.KAGAKUHENKAGASU) {
        if (p.side === 'player') battleField.tailwindPlayer = 4;
        else battleField.tailwindCpu = 4;
        logFn(`${p.species.name}の${abilityJp(p.ability)}が発動！おいかぜが吹き始めた！`);
      }
    }
  });
}


// ---- ターン終了時フィールド効果 ----
function applyEndOfTurnField(pokeList, logFn) {
  if (battleField.weather === 'sand') {
    pokeList.forEach((poke) => {
      if (poke.fainted) return;
      const defTypes = getEffectiveTypes(poke);
      const immune = defTypes.includes('rock') || defTypes.includes('ground') || defTypes.includes('steel');
      if (!immune) {
        const dmg = Math.max(1, Math.floor(poke.maxHp / 16));
        poke.currentHp = Math.max(0, poke.currentHp - dmg);
        logFn(`${poke.species.name}は　すなあらしの　ダメージを受けている…`, { hit: poke.side });
        if (poke.currentHp <= 0) { poke.currentHp = 0; poke.fainted = true; logFn(`${poke.species.name}は倒れた！`, { faint: poke.side }); }
        checkAndTriggerFundo(poke, logFn);
        applyDamageTakenEffects(poke, logFn);
      }
    });
  }
  if (battleField.terrain === 'grassy') {
    pokeList.forEach((poke) => {
      if (poke.fainted) return;
      const heal = Math.max(1, Math.floor(poke.maxHp / 16));
      poke.currentHp = Math.min(poke.maxHp, poke.currentHp + heal);
      logFn(`${poke.species.name}は　グラスフィールドで　HPが回復した！`, { hit: poke.side });
    });
  }
  if (battleField.weather === 'rain') {
    pokeList.forEach((poke) => {
      if (poke.fainted || poke.ability !== ABILITY.AMEUKEZARA || poke.currentHp >= poke.maxHp) return;
      const heal = Math.max(1, Math.floor(poke.maxHp / 16));
      poke.currentHp = Math.min(poke.maxHp, poke.currentHp + heal);
      logFn(`${poke.species.name}のあめうけざらでHPが回復した！`, { hit: poke.side });
    });
  }

  if (battleField.weather !== 'none') {
    battleField.weatherTurns--;
    if (battleField.weatherTurns <= 0) {
      const endMsg = {
        sun: 'ひざしが　もとに戻った。',
        rain: 'あめが　やんだ。',
        sand: 'すなあらしが　おさまった。',
        snow: 'ゆきが　やんだ。',
        starrysky: 'ほしの　またたきが　おさまった。',
      }[battleField.weather];
      battleField.weather = 'none';
      if (endMsg) logFn(endMsg);
    }
  }
  if (battleField.terrain !== 'none') {
    battleField.terrainTurns--;
    if (battleField.terrainTurns <= 0) {
      battleField.terrain = 'none';
      logFn('フィールドの　効果が　きえた。');
    }
  }

  if (battleField.playerReflect > 0) {
    battleField.playerReflect--;
    if (battleField.playerReflect === 0) logFn('自分のリフレクターが消えた！');
  }
  if (battleField.playerLightScreen > 0) {
    battleField.playerLightScreen--;
    if (battleField.playerLightScreen === 0) logFn('自分のひかりのかべが消えた！');
  }
  if (battleField.cpuReflect > 0) {
    battleField.cpuReflect--;
    if (battleField.cpuReflect === 0) logFn('相手のリフレクターが消えた！');
  }
  if (battleField.cpuLightScreen > 0) {
    battleField.cpuLightScreen--;
    if (battleField.cpuLightScreen === 0) logFn('相手のひかりのかべが消えた！');
  }

  if (battleField.tailwindPlayer > 0) {
    battleField.tailwindPlayer--;
    if (battleField.tailwindPlayer === 0) logFn('プレイヤー側のおいかぜが止んだ！');
  }
  if (battleField.tailwindCpu > 0) {
    battleField.tailwindCpu--;
    if (battleField.tailwindCpu === 0) logFn('相手側のおいかぜが止んだ！');
  }

  if (battleField.trickRoom) {
    battleField.trickRoomTurns--;
    if (battleField.trickRoomTurns <= 0) {
      battleField.trickRoom = false;
      logFn('トリックルームの効果が切れた！');
    }
  }
}

// ---- CPU AI ----
function weatherTerrainScoreMult(moveType, moveId) {
  let mult = 1.0;
  if (battleField.weather === 'sun') {
    if (moveType === 'fire') mult *= 1.5;
    else if (moveType === 'water') mult *= 0.5;
  } else if (battleField.weather === 'rain') {
    if (moveType === 'water') mult *= 1.5;
    else if (moveType === 'fire') mult *= 0.5;
  } else if (battleField.weather === 'starrysky') {
    if (moveType === 'ghost' || moveType === 'psychic' || moveType === 'steel') mult *= 1.3;
    else if (moveType === 'shine') mult *= 0.5;
    if (STARRY_SKY_BOOST_MOVE_IDS.includes(moveId)) mult *= 1.2;
  }
  if (battleField.terrain === 'grassy') {
    if (moveType === 'grass') mult *= 1.3;
    if (GRASSY_HALVED_MOVE_IDS.includes(moveId)) mult *= 0.5;
  } else if (battleField.terrain === 'electric') {
    if (moveType === 'electric') mult *= 1.3;
  } else if (battleField.terrain === 'psychic') {
    if (moveType === 'psychic') mult *= 1.3;
  } else if (battleField.terrain === 'misty') {
    if (moveType === 'dragon') mult *= 0.5;
  } else if (battleField.terrain === 'melody') {
    if (moveType === 'sound') mult *= 1.2;
  }
  return mult;
}

// cpuTeam を渡した場合のみ、「持ち技が全ていまひとつ以下の時、弱点をつける手持ちへ交代する」
// 判定を行う（ゆびをふるより優先。弱点をつける控えがいなければ従来通りゆびをふる優先）。
// cpuTeam省略時（既存呼び出し箇所等）は交代判定を行わず、これまで通り技のみを返す。
function chooseCpuAction(cpuPoke, playerPoke, cpuTeam, megaEvolutionEnabled, playerAction) {
  // メガシンカ判断：このバトルでメガシンカが有効（megaEvolutionEnabled）かつ、CPU側がまだ
  // 誰もメガシンカしておらず、今場に出ているポケモンがメガシンカ可能な種族なら、本家の
  // 「最初に出した該当ポケモンをメガシンカさせる」に倣い、機会があれば必ずメガシンカを予約する。
  // （実際の変身は既存のrunTurn側の予約解決ロジックがそのまま処理する）
  // 「メガなし」が選ばれている場合（megaEvolutionEnabled === false）は、種族的にメガシンカ
  // 可能なポケモンであっても絶対に予約しない。
  if (megaEvolutionEnabled && canMegaEvolveNow(cpuPoke)) {
    cpuPoke.wantsMegaEvolve = true;
  }

  // はかいこうせん等の反動：次のターンは強制的に動けないので、技選択自体を行わない。
  // （実際に行動を封じる処理は checkCanMove 側で行われるため、ここではダミーの
  //   アクションを返すだけでよい）
  if (cpuPoke.mustRechargeTurns > 0) {
    return { type: 'move', move: cpuPoke.moves.find(m => m.id === cpuPoke.lastUsedMoveId) || cpuPoke.moves[0] };
  }

  const usable = cpuPoke.moves.filter((m) => m.pp > 0 && !m.locked && !(m.id === 4 && cpuPoke.deaigashiraLocked) &&
    !(cpuPoke.typeLockTurns > 0 && cpuPoke.typeLockType === m.type));
  if (usable.length === 0) return { type: 'move', move: cpuPoke.moves.find(m => m.pp > 0) || cpuPoke.moves[0] };

  // げきりん強制連続使用
  if (cpuPoke.gekirinTurns > 0 && cpuPoke.gekirinMoveId !== null) {
    const forcedGekirin = cpuPoke.moves.find(m => m.id === cpuPoke.gekirinMoveId);
    if (forcedGekirin && forcedGekirin.pp > 0 && !forcedGekirin.locked) {
      return { type: 'move', move: forcedGekirin };
    }
  }

  // アンコール強制
  if (cpuPoke.encoreTurns > 0 && cpuPoke.encoreMoveId !== null) {
    const forced = cpuPoke.moves.find(m => m.id === cpuPoke.encoreMoveId);
    if (forced && forced.pp > 0 && !forced.locked) {
      return { type: 'move', move: forced };
    }
  }

  // 持ち技が全て「いまひとつ以下」の場合、ゆびをふるより優先して
  // プレイヤーの場のポケモンに弱点をつける（攻撃/特殊で効果抜群）控えがいれば交代する。
  // バインド中（交代不可）はこの判定自体をスキップし、従来通り技を選ぶ。
  if (Array.isArray(cpuTeam) && !isTrappedFromSwitching(cpuPoke)) {
    const defTypesForCheck = getEffectiveTypes(playerPoke);
    const allIneffective = defTypesForCheck && defTypesForCheck.length > 0 &&
      usable.some((m) => isDamagingMoveAI(m)) &&
      usable.every((m) => {
        if (!isDamagingMoveAI(m)) return true;
        const effType = resolveEffectiveMoveType(m, battleField);
        const mult = getTypeEffectiveness(effType, defTypesForCheck[0], defTypesForCheck[1], m.id);
        return mult < 1;
      });
    if (allIneffective) {
      const switchTarget = findCpuSwitchInForWeakness(cpuTeam, cpuPoke, playerPoke);
      if (switchTarget) {
        const idx = cpuTeam.indexOf(switchTarget);
        if (idx >= 0) return { type: 'switch', idx };
      }
    }
  }

  const best = chooseTrainerAttack(cpuPoke, playerPoke, usable, playerAction);
  return { type: 'move', move: best };
}

/* =========================================================================
   高度なCPU/野生AI（マイクラ版 pokedrock.js の chooseTrainerAttack を移植）
   -------------------------------------------------------------------------
   元実装は Minecraft Bedrock のエンティティ/タグ/動的プロパティを直接参照する
   コードだったため、データ取得部分のみこのゲームの battleField / poke オブジェクト
   構造に翻訳し、スコアリングの判断基準はそのまま踏襲している。
   技IDは原作と共通の体系（例: 485=ちょうはつ, 318=ステルスロック）なので、
   個別技の分岐はIDそのまま利用できる。
   ========================================================================= */

// ウェザーボール(503)・だいちのはどう(504) の実効タイプを、天候/フィールドの
// 現在の状態から解決する。対象外の技はそのままの固定タイプを返す。
// attacker は省略可。メガソーラー持ちが攻撃者の場合、ウェザーボールは実際の天候に関わらずひでり扱い（ほのお）になる。
function resolveEffectiveMoveType(move, battleField, attacker) {
  if (move.id === 503) {
    const map = { sun: 'fire', rain: 'water', snow: 'ice', sand: 'rock', starrysky: 'ghost' };
    const weather = isMegaSolarActive(attacker) ? 'sun' : battleField.weather;
    return map[weather] || move.type;
  }
  if (move.id === 504) {
    const map = { electric: 'electric', grassy: 'grass', misty: 'fairy', psychic: 'psychic', melody: 'sound' };
    return map[battleField.terrain] || move.type;
  }
  return move.type;
}

const HYPNOSIS_MOVE_ID = 293; // ねむり付与技の代表ID（実際の効果は applyMoveEffects 側で処理済み。ここは優先度スコア用の目印）

// AI評価用：連続技（複数回ヒットする技）の実質威力上書き。
// 原作のオーバーライド値をそのまま踏襲（該当技がない場合は無害）。
const _AI_MULTI_HIT_POWER_OVERRIDE = {
  472: 100, 48: 80, 309: 80, 189: 80, 461: 80, 388: 150, 367: 100,
};

function isDamagingMoveAI(move) {
  return move.category !== 'status' && (move.power || 0) > 0;
}

// 技IDから { chance, ranks:[atk,def,spa,spd,spe,acc,eva] } 形式を取り出す
// (gamedata.js の selfRank/oppRank は [chance, atk, def, spa, spd, spe, acc, eva] の配列形式)
function getSelfBoostAI(move) {
  if (!move.selfRank) return null;
  const r = move.selfRank;
  const target = (move.oppRankTarget === true) ? 'opp' : 'self'; // このゲームのselfRankは常に自分対象
  return { chance: r[0] || 0, ranks: r, target };
}
function getOppBoostAI(move) {
  if (!move.oppRank) return null;
  const r = move.oppRank;
  return { chance: r[0] || 0, ranks: r, target: 'opp' };
}
function getOppStatusEffectAI(move) {
  return move.oppStatus ? { chance: move.oppStatus[0] || 0, status: move.oppStatus[1] } : null;
}

// ranks配列 [chance, atk, def, spa, spd, spe, acc, eva] とcur(ranksオブジェクト)を比較し、
// 「上げようとしている/下げようとしている能力が、対象側で軒並み最大/最小に達している」かを判定
const RANK_KEYS_AI = ['atk', 'def', 'spa', 'spd', 'spe', 'acc', 'eva'];
function ranksAtMaxAI(ranksArr, curRanksObj) {
  let anyBoost = false, allMaxed = true;
  for (let i = 0; i < 7; i++) {
    const delta = ranksArr[i + 1] || 0;
    const key = RANK_KEYS_AI[i];
    const cur = (curRanksObj && curRanksObj[key]) || 0;
    if (delta > 0) {
      anyBoost = true;
      if (cur < 6) allMaxed = false;
    } else if (delta < 0) {
      anyBoost = true;
      if (cur > -6) allMaxed = false;
    }
  }
  return anyBoost && allMaxed;
}

// ダメージの最大乱数(1.0倍)見積もり。damage()本体と近い簡易式で、AIの選択比較専用。
function estimateMaxDamageAI(attacker, move, defender, atkTypes, mult) {
  if (!defender || !isDamagingMoveAI(move)) return 0;
  if (mult == null) mult = 1;
  if (mult === 0) return 0;
  const isSpecial = move.category === 'special';
  // calcDamage と同じ計算式の分岐（攻撃側/防御側の参照ステータスを damageFormula で決める）
  let atkOwner = attacker, atkStatKey = isSpecial ? 'spa' : 'atk';
  let defStatKey = isSpecial ? 'spd' : 'def';
  switch (move.damageFormula) {
    case 'selfDefVsOppDef':  atkStatKey = 'def'; defStatKey = 'def'; break;
    case 'selfSpaVsOppDef':  atkStatKey = 'spa'; defStatKey = 'def'; break; // サイコショック
    case 'selfAtkVsOppSpd':  atkStatKey = 'atk'; defStatKey = 'spd'; break; // ふゆのひざし
    case 'oppSpaVsOppSpd':   atkOwner = defender; atkStatKey = 'spa'; defStatKey = 'spd'; break; // クリアカード
    case 'oppAtkVsOppDef':   atkOwner = defender; atkStatKey = 'atk'; defStatKey = 'def'; break; // イカサマ
  }
  const atkVal = atkOwner.stats[atkStatKey];
  const atkRank = atkOwner.ranks[atkStatKey];
  const defVal = defender.stats[defStatKey];
  const defRank = defender.ranks[defStatKey];
  const effAtk = atkVal * rankMultiplier(atkRank);
  const effDef = defVal * rankMultiplier(defRank);
  let power = _AI_MULTI_HIT_POWER_OVERRIDE[move.id] ?? (move.power || 0);
  // きしかいせい(109)／不倶戴天(179)：残りHP割合による威力補正（damage()本体と同じ基準）
  if (move.id === 109 || move.id === 179) {
    const remRatio = attacker.maxHp > 0 ? attacker.currentHp / attacker.maxHp : 1;
    if (move.id === 109) {
      if (remRatio <= 0.09) power *= 10;
      else if (remRatio <= 0.10) power *= 7;
      else if (remRatio <= 0.20) power *= 4;
      else if (remRatio <= 0.40) power *= 2;
    } else {
      if (remRatio <= 0.03) power *= 24;
      else if (remRatio <= 0.04) power *= 15;
      else if (remRatio <= 0.10) power *= 10;
      else if (remRatio <= 0.30) power *= 4;
    }
  }
  const effType = resolveEffectiveMoveType(move, battleField);
  const stab = atkTypes.includes(effType) ? 1.5 : 1;
  const lv = attacker.level || 100;
  return 0.01 * stab * mult * 100 * ((0.2 * lv + 1) * effAtk * power / (25 * effDef) + 2);
}
// 先制技の確実KO判定用：最低乱数(0.85倍)でのダメージ
function estimateMinDamageAI(attacker, move, defender, atkTypes, mult) {
  return estimateMaxDamageAI(attacker, move, defender, atkTypes, mult) * 0.85;
}

// フィールド設置技(グラス/エレキ/サイコ/ミスト/メロディ)：moveId → { terrainKey, moveType }
const _FIELD_SET_MOVE_INFO_AI = {
  486: { terrainKey: 'grassy', moveType: 'grass' },
  487: { terrainKey: 'electric', moveType: 'electric' },
  488: { terrainKey: 'psychic', moveType: 'psychic' },
  489: { terrainKey: 'misty', moveType: 'fairy' },
  490: { terrainKey: 'melody', moveType: 'sound' },
};
// 持ち技リストの中に、指定タイプの「攻撃技」が他に存在するか
function _hasOtherAttackOfTypeAI(usableMoves, moveType, excludeMoveId) {
  return usableMoves.some((m) => m.id !== excludeMoveId && m.type === moveType && isDamagingMoveAI(m));
}

// 特性によるタイプ無効化（吸収系特性＋ふゆう）を判定する。
// 既存の TYPE_ABSORB_ABILITY_TYPE（ちくでん/ちょすい/もらいび/むしよけ/そうしょく）と
// ABILITY.FUYU（じめん技無効、ただしはかいこうせん等の貫通特性は考慮しない簡易判定）を利用。
function isAbilityTypeImmuneAI(moveType, ability) {
  if (ability === ABILITY.FUYU && moveType === 'ground') return true;
  return TYPE_ABSORB_ABILITY_TYPE[ability] === moveType;
}

// 控えの中から、プレイヤーの場のポケモンに「弱点をつける」（攻撃/特殊技で効果抜群＝2倍以上）
// 技を持つポケモンを探す。変化技は対象外。瀕死・場に出ている本人は除外。
// 複数見つかった場合は先頭（=手持ちの並び順で最初に見つかったもの）を返す。
function findCpuSwitchInForWeakness(cpuTeam, cpuActive, playerPoke) {
  const defTypes = getEffectiveTypes(playerPoke);
  if (!defTypes || defTypes.length === 0) return null;
  for (const candidate of cpuTeam) {
    if (!candidate || candidate === cpuActive || candidate.fainted) continue;
    const hasSuperEffective = (candidate.moves || []).some((m) => {
      if (!m || m.category === 'status') return false; // 攻撃・特殊のみ（変化技は除外）
      const effType = resolveEffectiveMoveType(m, battleField);
      if (isAbilityTypeImmuneAI(effType, playerPoke.ability)) return false;
      const mult = getTypeEffectiveness(effType, defTypes[0], defTypes[1], m.id);
      return mult >= 2;
    });
    if (hasSuperEffective) return candidate;
  }
  return null;
}

// 原作 chooseTrainerAttack の移植版。シングルバトル専用（このゲームはダブルバトル非対応）。
function chooseTrainerAttack(attacker, defender, usableMoves, opponentAction) {
  // ふいうち(29)：相手（プレイヤー）がこのターン「攻撃技」を選んでいる場合のみ使う。
  // 変化技・交代・行動なしの場合は失敗するので、他に選べる技があれば候補から外す。
  // （ふいうちしか使える技がない場合のみ、失敗を承知で候補に残す）
  const opponentAttacks = !!(opponentAction && opponentAction.type === 'move' &&
    opponentAction.move && opponentAction.move.category !== 'status');
  if (!opponentAttacks) {
    const withoutSucker = usableMoves.filter((m) => m.id !== 29);
    if (withoutSucker.length > 0) usableMoves = withoutSucker;
  }

  // アイニーチュ(ID1990)専用：こらえる(506)を最優先で使わせる。
  // プレイヤーが攻撃技を選んでいる時は最優先、変化技を選んでいる時は使わせない(-999)。
  if (attacker.speciesId === AINEECHU_SPECIES_ID) {
    const endureMove = usableMoves.find((m) => m.id === 506);
    if (endureMove) {
      const playerChoseStatusMove = !!(opponentAction && opponentAction.type === 'move' &&
        opponentAction.move && opponentAction.move.category === 'status');
      if (!playerChoseStatusMove) {
        return endureMove;
      }
      // 変化技選択時はこらえるを候補から除外（スコア-999扱い）し、通常評価に回す
      usableMoves = usableMoves.filter((m) => m.id !== 506);
      if (usableMoves.length === 0) return endureMove; // 他に選べる技が無ければ仕方なくこらえる
    }
  }

  const defTypes = getEffectiveTypes(defender);
  if (!defTypes || defTypes.length === 0) {
    return usableMoves[Math.floor(Math.random() * usableMoves.length)];
  }
  const atkTypes = getEffectiveTypes(attacker);
  const oppCurHp = defender.currentHp;
  const oppStatusVal = defender.status || STATUS.NONE;
  const oppRanks = defender.ranks;

  let scored = [];
  for (const move of usableMoves) {
    let score = 0, blocked = false;

    // ちょうはつ(485)：相手が変化技を選ぶと読める時だけ最優先。既にちょうはつ状態同士なら使わない。
    if (move.id === 485) {
      const alreadyTaunted = (attacker.tauntTurns || 0) > 0;
      const oppAlreadyTaunted = (defender.tauntTurns || 0) > 0;
      // プレイヤー操作の技を事前に知る手段がないため、「相手の技が全て変化技寄り」かどうかでは判定できない。
      // 原作は「相手が選んだ技」を参照できたが、このゲームでは選択前に評価する必要があるため、
      // 相手の変化技所持率が高い（＝5割以上）場合を "変化技を選びがち" とみなして優先させる。
      const oppMoves = (defender.moves || []).filter((m) => m.pp > 0);
      const oppStatusMoveRatio = oppMoves.length
        ? oppMoves.filter((m) => m.category === 'status').length / oppMoves.length : 0;
      if (alreadyTaunted || oppAlreadyTaunted || oppStatusMoveRatio < 0.5) {
        scored.push([move, -99, -1]);
        continue;
      } else {
        scored.push([move, 9, -1]);
        continue;
      }
    }

    // ちょうはつ中は変化技を選択肢から除外
    if ((attacker.tauntTurns || 0) > 0 && move.category === 'status') blocked = true;
    // アンコール中はアンコールされた技以外を除外（呼び出し元で既にフィルタ済みだが二重チェック）
    if ((attacker.encoreTurns || 0) > 0 && attacker.encoreMoveId && move.id !== attacker.encoreMoveId) blocked = true;
    // うつせみ：むしタイプ技使用不可状態なら除外
    if (attacker.utsusemiMoveLock && move.type === 'bug') blocked = true;

    const effType = resolveEffectiveMoveType(move, battleField);
    // 特性によるタイプ無効化（ちくでん/ちょすい/もらいび/むしよけ/そうしょく/ふゆう）：
    // 無効化される攻撃技は選ばれにくくする（ダメージ技として全く機能しないため）
    if (isDamagingMoveAI(move) && isAbilityTypeImmuneAI(effType, defender.ability)) blocked = true;
    const mult = getTypeEffectiveness(effType, defTypes[0], defTypes[1], move.id);
    if (mult === 0) blocked = true;

    // マジックミラー：相手がこの特性を持つ場合、自分に向けた変化技は跳ね返されて自分が不利益を受けるため使わない
    if (!blocked && move.category === 'status' && defender.ability === ABILITY.MAGIC_MIRROR) blocked = true;

    const oppStatusEff = getOppStatusEffectAI(move);
    if (!blocked && oppStatusEff && oppStatusVal !== STATUS.NONE) blocked = true;

    const selfBoost = getSelfBoostAI(move);
    const oppBoostEff = getOppBoostAI(move);
    if (!blocked && selfBoost && selfBoost.target === 'self' && ranksAtMaxAI(selfBoost.ranks, attacker.ranks)) blocked = true;
    if (!blocked && oppBoostEff && oppRanks && ranksAtMaxAI(oppBoostEff.ranks, oppRanks)) blocked = true;

    // ステルスロック(318)：相手の場に既にあるなら除外
    if (!blocked && move.id === 318) {
      const side = attacker.side === 'player' ? 'cpu' : 'player';
      if (hazardState[side] && hazardState[side].stealthRock) blocked = true;
    }
    // トリックルーム(474系):既にかかっているなら除外
    if (!blocked && move.id === 474 && battleField.trickRoom) blocked = true;
    // リフレクター(475)：自分の場に既にあるなら除外
    if (!blocked && move.id === 475) {
      const already = attacker.side === 'player' ? battleField.playerReflect : battleField.cpuReflect;
      if (already > 0) blocked = true;
    }
    // ひかりのかべ(476)：自分の場に既にあるなら除外
    if (!blocked && move.id === 476) {
      const already = attacker.side === 'player' ? battleField.playerLightScreen : battleField.cpuLightScreen;
      if (already > 0) blocked = true;
    }
    // おいかぜ(160)：自分の場に既にあるなら除外
    if (!blocked && move.id === 160) {
      const already = attacker.side === 'player' ? battleField.tailwindPlayer : battleField.tailwindCpu;
      if (already > 0) blocked = true;
    }
    // エルダーバースト(59)・有刺鉄線(500)：フィールドが無いなら除外
    if (!blocked && (move.id === 59 || move.id === 500)) {
      if (!battleField.terrain || battleField.terrain === 'none') blocked = true;
    }
    // フィールド設置技(486〜490)：対応フィールドが既に張られているなら除外
    if (!blocked && _FIELD_SET_MOVE_INFO_AI[move.id]) {
      if (battleField.terrain === _FIELD_SET_MOVE_INFO_AI[move.id].terrainKey) blocked = true;
    }
    // サイコフィールド中：優先度+1以上の技は必ず失敗する
    if (!blocked && movePriorityWithWeather(move) >= 1 && battleField.terrain === 'psychic') blocked = true;
    // ソニックガード：相手がこの特性を持つ場合、優先度+1以上の技は無効
    if (!blocked && movePriorityWithWeather(move) >= 1 && defender.ability === ABILITY.SONIC_GUARD) blocked = true;

    if (blocked) {
      scored.push([move, -99, -1]);
      continue;
    }

    const isDamaging = isDamagingMoveAI(move);
    const isPriority = movePriorityWithWeather(move) > 0;
    const dmg = isDamaging ? estimateMaxDamageAI(attacker, move, defender, atkTypes, mult) : 0;
    const canKO = isDamaging && oppCurHp != null && dmg >= oppCurHp;
    const minDmg = isDamaging && isPriority ? estimateMinDamageAI(attacker, move, defender, atkTypes, mult) : 0;
    const canKOGuaranteed = isDamaging && isPriority && oppCurHp != null && minDmg >= oppCurHp;
    const isBoostMove = selfBoost && selfBoost.target === 'self' &&
      ((selfBoost.ranks[1] || 0) > 0 || (selfBoost.ranks[3] || 0) > 0) && // 自分の攻撃or特攻を上げる技
      !isDamaging; // 攻撃技についでにランクが上がるタイプ(例:インファイト)は「積み技」として扱わない

    // ステルスロック：未設置なら最優先(+9)
    if (move.id === 318) { score += 9; }
    // トリックルーム/リフレクター/ひかりのかべ/おいかぜ：未設置なら+2
    else if ([474, 475, 476, 160].includes(move.id)) { score += 2; }
    // フィールド技：対応タイプの攻撃技を他に持つ場合のみ+2、持たない場合は-4
    else if (_FIELD_SET_MOVE_INFO_AI[move.id]) {
      score += _hasOtherAttackOfTypeAI(usableMoves, _FIELD_SET_MOVE_INFO_AI[move.id].moveType, move.id) ? 2 : -4;
    }
    // あさなぎ(498)：ひでり(sun)の時のみ使う
    else if (move.id === 498) {
      score += battleField.weather === 'sun' ? 4 : -4;
    }
    // ハリケーン(496)・黒潮(502)：あめ(rain)の時のみ使う
    else if ([496, 502].includes(move.id)) {
      score += battleField.weather === 'rain' ? 4 : -4;
    }
    // ゆびをふる(479)：自分の持ち技に相手への有効打(等倍以上)が一つも無い時、優先的に使う
    else if (move.id === 479) {
      const noEffectiveHit = usableMoves.every((other) => {
        if (other.id === 479) return true;
        if (!isDamagingMoveAI(other)) return true;
        const otherEffType = resolveEffectiveMoveType(other, battleField);
        const otherMult = getTypeEffectiveness(otherEffType, defTypes[0], defTypes[1], other.id);
        return otherMult < 1;
      });
      if (noEffectiveHit) { score += 3; }
    }
    // くろいきり(239)：自分の能力ランクいずれかが-2以下なら+2
    else if (move.id === 239 && Object.values(attacker.ranks).some((r) => (r || 0) <= -2)) { score += 2; }
    else if (isPriority && canKOGuaranteed) score += 6;
    else if (move.id === HYPNOSIS_MOVE_ID && oppStatusVal === STATUS.NONE) score += 5;
    else if (isDamaging && canKO && !isPriority) score += 4;
    else if (isDamaging && canKO && isPriority) score += 4;
    if (move.id !== 318 && isPriority && !canKOGuaranteed) score -= 2;
    else if (isBoostMove) {
      // 積み技：積んだ後に他のダメージ技で確定KOできる状況になるなら+3
      const atkDelta = (selfBoost.ranks[1] || 0), spAtkDelta = (selfBoost.ranks[3] || 0);
      const newAtkRank = Math.max(-6, Math.min(6, attacker.ranks.atk + atkDelta));
      const newSpAtkRank = Math.max(-6, Math.min(6, attacker.ranks.spa + spAtkDelta));
      const boostedAtk = attacker.stats.atk * rankMultiplier(newAtkRank);
      const boostedSpAtk = attacker.stats.spa * rankMultiplier(newSpAtkRank);
      let canKoAfter = false;
      for (const other of usableMoves) {
        if (other.id === move.id) continue;
        if (!isDamagingMoveAI(other)) continue;
        const otherMult = getTypeEffectiveness(other.type, defTypes[0], defTypes[1], other.id);
        if (otherMult === 0) continue;
        const otherIsSpecial = other.category === 'special';
        if (otherIsSpecial && spAtkDelta === 0) continue;
        if (!otherIsSpecial && atkDelta === 0) continue;
        const boostedAtkVal = otherIsSpecial ? boostedSpAtk : boostedAtk;
        const defStatKey = otherIsSpecial ? 'spd' : 'def';
        const effDef = defender.stats[defStatKey] * rankMultiplier(defender.ranks[defStatKey]);
        const power = other.power || 0;
        const stab = atkTypes.includes(other.type) ? 1.5 : 1;
        const lv = attacker.level || 100;
        const otherDmg = 0.01 * stab * otherMult * 100 * ((0.2 * lv + 1) * boostedAtkVal * power / (25 * effDef) + 2);
        if (oppCurHp != null && otherDmg >= oppCurHp) { canKoAfter = true; break; }
      }
      if (canKoAfter) score += 3;
    }

    if (score === 0 && isDamaging) score = 1;
    if (isDamaging && mult < 1 && mult > 0) score -= 3;
    scored.push([move, score, isDamaging ? dmg : -1]);
  }

  if (scored.length === 0) return usableMoves[Math.floor(Math.random() * usableMoves.length)];

  // 攻撃技が全て「いまひとつ以下」の場合の救済処理
  const allDamagingIneffective = usableMoves.some((m) => isDamagingMoveAI(m)) &&
    usableMoves.every((m) => {
      if (!isDamagingMoveAI(m)) return true;
      const effType = resolveEffectiveMoveType(m, battleField);
      const mult = getTypeEffectiveness(effType, defTypes[0], defTypes[1], m.id);
      return mult < 1;
    });
  if (allDamagingIneffective) {
    const fingerFlick = usableMoves.find((m) => m.id === 479);
    if (fingerFlick) return fingerFlick;
    const dmgCandidates = scored.filter(([m, sc, dmg]) => isDamagingMoveAI(m) && dmg >= 0);
    if (dmgCandidates.length > 0) {
      const maxDmg = Math.max(...dmgCandidates.map(([, , dmg]) => dmg));
      const bestDmgMoves = dmgCandidates.filter(([, , dmg]) => dmg === maxDmg).map(([m]) => m);
      return bestDmgMoves[Math.floor(Math.random() * bestDmgMoves.length)];
    }
  }

  // NaN対策の防御的フォールバック
  const safeScored = scored.map(([m, sc, dmg]) => [m, Number.isFinite(sc) ? sc : -99, Number.isFinite(dmg) ? dmg : -1]);
  const bestScore = Math.max(...safeScored.map(([, sc]) => sc));
  const topTier = safeScored.filter(([, sc]) => sc === bestScore);
  const maxDmg = topTier.length ? Math.max(...topTier.map(([, , dmg]) => dmg)) : -1;
  const bestMoves = topTier.filter(([, , dmg]) => dmg === maxDmg).map(([m]) => m);
  return bestMoves.length ? bestMoves[Math.floor(Math.random() * bestMoves.length)] : usableMoves[Math.floor(Math.random() * usableMoves.length)];
}