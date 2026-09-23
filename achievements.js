'use strict';
/* =========================================================
   実績（Achievements）
   おまけボタン（🏅）から開く全画面オーバーレイ。
   達成状況は localStorage に保存される。
   外部からは window.Achievements.unlock('id') で解除できる。
   ========================================================= */
(function () {
  const STORAGE_KEY = 'pokeriere_achievements_v1';
  const OVERLAY_ID  = 'achievements-overlay';
  const STYLE_ID    = 'achievements-style';

  /* ---- 実績定義 ----
     card: 達成時に表示する画像（プロジェクト直下に置く）
     追加する場合はここに追記するだけでOK。                    */
  const ACHIEVEMENTS = [
    { id: 'first_win',       title: 'はじめての勝利', desc: 'NPCバトルで初めて勝利する',        card: 'card1.png'  },
    { id: 'win_streak_5',    title: '疾風怒濤',          desc: 'NPCバトルで5連勝を達成する',       card: 'card2.png'  },
    { id: 'win_streak_10',        title: '風林火山',       desc: '10連勝目に登場するボスを倒す',     card: 'card3.png'  },
    { id: 'win_streak_15',   title: '百戦錬磨',         desc: 'NPCバトルで15連勝を達成する',      card: 'card4.png'  },
    { id: 'win_streak_team_5', title: 'チーム5連勝',  desc: 'チームバトルで5連勝を達成する',    card: 'card16.png' },
{ id: 'win_streak_team_10', title: 'Oracle',  desc: 'チームバトルでボスを倒す',    card: 'card17.png' },
    { id: 'mega_first',      title: 'メガシンカ',     desc: 'はじめてメガシンカを発動する',     card: 'card5.png'  },
    { id: 'pvp_first_win',   title: '対人戦初勝利',   desc: 'プレイヤーとのバトルで勝利する',   card: 'card6.png'  },
    { id: 'pokedex_50',      title: '図鑑ビギナー',      desc: '図鑑に50匹のポケモンを登録する',   card: 'card7.png'  },
    { id: 'pokedex_100',      title: 'ポケモン探検家',      desc: '図鑑に100匹のポケモンを登録する',   card: 'card8.png'  },
    { id: 'pokedex_150',      title: 'ポケモン収集家',      desc: '図鑑に150匹のポケモンを登録する',   card: 'card9.png' },
{ id: 'pokedex_200',      title: 'ポケモン研究員',      desc: '図鑑に200匹のポケモンを登録する',   card: 'card10.png' },
{ id: 'pokedex_250',      title: 'ポケモンマイスター',      desc: '図鑑に250匹のポケモンを登録する',   card: 'card11.png' },
{ id: 'pokedex_300',      title: 'ポケモン博士',      desc: '図鑑に300匹のポケモンを登録する',   card: 'card18.png' },
    { id: 'mega_pokedex_20',  title: 'メガ図鑑 20体',   desc: 'メガシンカ図鑑に20体を登録する',    card: 'card12.png' },
{ id: 'mega_pokedex_40',  title: 'メガ図鑑 40体',   desc: 'メガシンカ図鑑に40体を登録する',    card: 'card13.png' },
{ id: 'mega_pokedex_60',  title: 'メガ図鑑 60体',   desc: 'メガシンカ図鑑に60体を登録する',    card: 'card14.png' },
{ id: 'mega_pokedex_80',  title: 'メガ図鑑 80体',   desc: 'メガシンカ図鑑に80体を登録する',    card: 'card15.png' },
    { id: 'all_clear',       title: '完全制覇',       desc: 'すべての実績を解除する',           card: 'card99.png' },
  ];

  /* ---- 乱入ボス撃破の実績（1体につき1つ・自動生成） ----
     実績ID「intrusion_<種族ID>」＝そのポケモンを乱入戦で倒した記録。
     この実績が解除済みのポケモンは、二度と乱入ボスとして登場しない。
     IDリストは engine.js の INTRUSION_BOSS_IDS を使う（読み込めない場合の予備も持つ）。 */
  const INTRUSION_FALLBACK_IDS = [1030,476,171, 36, 91, 322, 347, 360, 1009, 1023, 1024, 1025, 1026];
  const INTRUSION_IDS = (typeof INTRUSION_BOSS_IDS !== 'undefined' && Array.isArray(INTRUSION_BOSS_IDS))
    ? INTRUSION_BOSS_IDS : INTRUSION_FALLBACK_IDS;
  const ALL_CLEAR_INDEX = ACHIEVEMENTS.findIndex((a) => a.id === 'all_clear');
  // 秘密の実績：未達成の間は名前・説明とも「？？？」。達成した後はネタバレの心配が無いので
  // 「乱入 ○○」と説明文を表示する（表示側は displayTitle/displayDesc で切り替える）。
  function speciesNameOf(sid) {
    try {
      const sp = GAME_DATA.species[sid];
      if (sp && sp.name) return sp.name;
    } catch (e) {}
    return '#' + sid;
  }
  const intrusionAchvs = INTRUSION_IDS.map((sid) => ({
    id: 'intrusion_' + sid,
    title: '？？？',
    desc: '？？？',
    card: 'intrusion_' + sid + '.png',
    secret: true,
    revealTitle: () => '乱入 ' + speciesNameOf(sid),
    revealDesc: () => '乱入してきた' + speciesNameOf(sid) + 'を倒す',
  }));
  // 「完全制覇」の直前に差し込む（完全制覇は常に最後）
  ACHIEVEMENTS.splice(ALL_CLEAR_INDEX >= 0 ? ALL_CLEAR_INDEX : ACHIEVEMENTS.length, 0, ...intrusionAchvs);

  /* ---- タイプ縛り5連勝の実績（1タイプにつき1つ・自動生成） ----
     NPCの「チームバトル」で、選出した6匹すべてが同じタイプ1体を持つ編成のまま
     5連勝すると解除される（判定・カウントは engine.js の TypeStreak が行う）。
     実績ID「type_streak_<タイプ英名>」。
     新しいタイプを追加したい場合は、下の TYPE_STREAK_TARGET_TYPES に
     { type: '英語タイプ名', label: '日本語表示名' } を1行追記するだけでよい
     （英語タイプ名は GAME_DATA の species.type1/type2 に入っている値と同じもの。
      例: bug/water/fire/grass/electric/psychic/rock/ground/flying/ice/
          dragon/dark/steel/fairy/fighting/poison/ghost/normal/sound）。 */
  const TYPE_STREAK_TARGET_TYPES = [
    { type: 'bug', label: 'むし' }, 
    { type: 'fire', label: 'ほのお' }, 
    { type: 'normal', label: 'ノーマル' }, 
    { type: 'flying', label: 'ひこう' }, 
    { type: 'dark', label: 'あく' }, 
    { type: 'psychic', label: 'エスパー' }, 
    { type: 'grass', label: 'くさ' }, 
    { type: 'rock', label: 'いわ' }, 
    { type: 'ghost', label: 'ゴースト' }, 
    { type: 'dragon', label: 'ドラゴン' }, 
    { type: 'shine', label: 'シャイン' }, 
    { type: 'steel', label: 'はがね' }, 
    { type: 'ice', label: 'こおり' }, 
    { type: 'poison', label: 'どく' }, 
  ];
  const TYPE_STREAK_GOAL = 5;
  function typeStreakAchievementId(type) { return 'type_streak_' + type; }
  const typeStreakAchvs = TYPE_STREAK_TARGET_TYPES.map(({ type, label }) => ({
    id: typeStreakAchievementId(type),
    title: label + 'タイプマスター',
    desc: `NPCチームバトルで${label}タイプ6匹のパーティを組み${TYPE_STREAK_GOAL}連勝する`,
    card: 'type_streak_' + type + '.png',
  }));
  ACHIEVEMENTS.splice(ALL_CLEAR_INDEX >= 0 ? ALL_CLEAR_INDEX + intrusionAchvs.length : ACHIEVEMENTS.length, 0, ...typeStreakAchvs);

  /* ---- 保存 ---- */
  let unlocked = new Set();
  let loaded = false;
  function load() {
    if (loaded) return;
    loaded = true;
    try {
      const arr = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (Array.isArray(arr)) unlocked = new Set(arr.map(String));
    } catch (e) {}
  }
  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify([...unlocked])); } catch (e) {}
  }

  /* ---- 公開 API ---- */
  function isUnlocked(id) {
    load();
    return unlocked.has(id);
  }
  function unlock(id) {
    load();
    if (!ACHIEVEMENTS.some((a) => a.id === id)) return false;
    if (unlocked.has(id)) return false;
    unlocked.add(id);
    save();
    tryAutoAllClear();
    if (isOpen()) render();
    return true;
  }
  function unlockAll() {
    load();
    ACHIEVEMENTS.forEach((a) => unlocked.add(a.id));
    save();
    if (isOpen()) render();
  }
  function resetAll() {
    unlocked = new Set();
    save();
    try { if (typeof resetMegaUnlocks === 'function') resetMegaUnlocks(); } catch (e) {}
    if (isOpen()) render();
  }
  function count() { load(); return unlocked.size; }
  function total() { return ACHIEVEMENTS.length; }
  function list() { return ACHIEVEMENTS.slice(); }

  function tryAutoAllClear() {
    const others = ACHIEVEMENTS.filter((a) => a.id !== 'all_clear');
    if (others.every((a) => unlocked.has(a.id)) && !unlocked.has('all_clear')) {
      unlocked.add('all_clear');
      save();
    }
  }

  /* ---- 既存セーブデータから実績を逆算解除する ---- */
  function checkAutoUnlocks() {
    load();
    try {
      if (typeof MaxWinStreak !== 'undefined') {
        const best = Math.max(MaxWinStreak.getOff(), MaxWinStreak.getOn());
        if (best >= 1)  unlock('first_win');
        if (best >= 5)  unlock('win_streak_5');
        if (best >= 10) unlock('win_streak_10');
        if (best >= 15) unlock('win_streak_15');
      }
      if (typeof MaxWinStreak !== 'undefined' && typeof MaxWinStreak.getTeam === 'function') {
        const bestTeam = MaxWinStreak.getTeam();
        if (bestTeam >= 5) unlock('win_streak_team_5');
if (bestTeam >= 10) unlock('win_streak_team_10');
      }
    } catch (e) {}

    try {
      if (typeof Pokedex !== 'undefined') {
        const c = Pokedex.count();
        if (c >= 50) unlock('pokedex_50');
if (c >= 100) unlock('pokedex_100');
if (c >= 150) unlock('pokedex_150');
if (c >= 200) unlock('pokedex_200');
if (c >= 250) unlock('pokedex_250');
        // メガ登録の有無・数
        const megaData = (typeof MEGA_EVOLUTION_DATA !== 'undefined' && MEGA_EVOLUTION_DATA) || {};
        let megaCount = 0;
        Object.keys(megaData).forEach((id) => {
          const num = Number(id);
          const entry = megaData[id];
          if (entry && entry.forms) {
            if (Pokedex.hasMega(num, 'X')) megaCount++;
            if (Pokedex.hasMega(num, 'Y')) megaCount++;
          } else {
            if (Pokedex.hasMega(num)) megaCount++;
          }
        });
        if (megaCount >= 1) unlock('mega_first');
        if (megaCount >= 20) unlock('mega_pokedex_20');
if (megaCount >= 40) unlock('mega_pokedex_40');
if (megaCount >= 60) unlock('mega_pokedex_60');
if (megaCount >= 80) unlock('mega_pokedex_80');
      }
    } catch (e) {}

    try {
      if (typeof BattleHistory !== 'undefined') {
        const entries = BattleHistory.get();
        if (entries.some((e) => e.mode === 'pvp' && e.win)) unlock('pvp_first_win');
        // 10の倍数の連勝 = ボス戦勝利
        if (entries.some((e) => e.mode === 'npc' && e.win && e.streak && e.streak % 10 === 0)) {
          unlock('win_streak_10');
        }
      }
    } catch (e) {}

    tryAutoAllClear();
  }

  /* ---- スタイル注入 ---- */
  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${OVERLAY_ID} {
        position: fixed; inset: 0; z-index: 280;
        display: flex; flex-direction: column;
        background:
          radial-gradient(circle at 18% 12%, rgba(91,140,255,0.24), transparent 52%),
          radial-gradient(circle at 88% 18%, rgba(139,107,255,0.22), transparent 52%),
          radial-gradient(circle at 80% 90%, rgba(79,214,122,0.16), transparent 50%),
          radial-gradient(circle at 10% 88%, rgba(255,93,93,0.12), transparent 50%),
          var(--bg-0, #e6e9ef);
        opacity: 0; pointer-events: none;
        transition: opacity .25s ease;
        font-family: var(--font-main, 'M PLUS Rounded 1c', sans-serif);
        color: var(--ink, #33394a);
        overscroll-behavior: contain;
        touch-action: manipulation;
      }
      #${OVERLAY_ID}.show { opacity: 1; pointer-events: auto; }

      .achv-header {
        flex: none;
        display: flex; align-items: center; justify-content: space-between;
        gap: 10px;
        padding: max(14px, env(safe-area-inset-top)) 18px 8px;
      }
      .achv-title {
        font-weight: 900;
        font-size: clamp(16px, 2.2vw, 22px);
        letter-spacing: 3px;
        margin: 0;
        background: linear-gradient(120deg, var(--accent-a, #5b8cff), var(--accent-b, #8b6bff));
        -webkit-background-clip: text; background-clip: text; color: transparent;
      }
      .achv-header-right {
        display: flex; align-items: center; gap: 10px;
      }
      .achv-count {
        font-weight: 900; font-size: 13px;
        background: var(--surface, #e3e7ee);
        box-shadow: var(--shadow-inset-sm,
          inset 3px 3px 6px rgba(163,169,184,0.5),
          inset -3px -3px 6px rgba(255,255,255,0.75));
        border-radius: 999px;
        padding: 7px 18px;
        color: var(--ink, #33394a);
        white-space: nowrap;
      }
      .achv-close-btn {
        width: 40px; height: 40px; border-radius: 50%;
        border: none;
        background: var(--surface, #e3e7ee);
        box-shadow: var(--shadow-light-sm,
          4px 4px 8px rgba(163,169,184,0.5),
          -4px -4px 8px rgba(255,255,255,0.8));
        font-size: 20px; font-weight: 900; color: var(--ink-soft, #6b7386);
        display: flex; align-items: center; justify-content: center;
        cursor: pointer; line-height: 1;
        padding: 0;
      }
      .achv-close-btn:active {
        transform: scale(0.94);
        box-shadow: var(--shadow-inset-sm,
          inset 3px 3px 6px rgba(163,169,184,0.5),
          inset -3px -3px 6px rgba(255,255,255,0.75));
      }

      .achv-body {
        flex: 1; min-height: 0;
        overflow-y: auto;
        padding: 6px 18px calc(24px + env(safe-area-inset-bottom));
        -webkit-overflow-scrolling: touch;
      }
      .achv-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
        gap: 14px;
      }

      .achv-card {
        position: relative;
        display: flex; flex-direction: column;
        align-items: stretch;
        padding: 12px 12px 14px;
        border-radius: var(--radius-md, 18px);
        background: var(--surface, #e3e7ee);
        box-shadow: var(--shadow-light,
          8px 8px 16px rgba(163,169,184,0.55),
          -8px -8px 16px rgba(255,255,255,0.85));
        border: none;
        text-align: left;
        font-family: inherit;
        color: inherit;
        transition: transform .15s ease, box-shadow .15s ease;
        min-height: 190px;
        overflow: hidden;
      }
      .achv-card.locked {
        background: var(--surface-deep, #d7dbe3);
        box-shadow: var(--shadow-inset-sm,
          inset 3px 3px 6px rgba(163,169,184,0.5),
          inset -3px -3px 6px rgba(255,255,255,0.75));
        cursor: default;
        opacity: 0.9;
      }
      .achv-card.unlocked { cursor: pointer; }
      .achv-card.unlocked:active {
        transform: scale(0.98);
        box-shadow: var(--shadow-inset,
          inset 5px 5px 10px rgba(163,169,184,0.5),
          inset -5px -5px 10px rgba(255,255,255,0.75));
      }

      .achv-card-imgwrap {
        position: relative;
        width: 100%;
        aspect-ratio: 1 / 1;
        max-height: 130px;
        border-radius: var(--radius-sm, 12px);
        background: var(--surface-deep, #d7dbe3);
        box-shadow: var(--shadow-inset-sm,
          inset 3px 3px 6px rgba(163,169,184,0.5),
          inset -3px -3px 6px rgba(255,255,255,0.75));
        display: flex; align-items: center; justify-content: center;
        overflow: hidden;
        margin-bottom: 10px;
      }
      .achv-card.unlocked .achv-card-imgwrap {
        background: var(--surface, #e3e7ee);
        box-shadow: var(--shadow-light-sm,
          4px 4px 8px rgba(163,169,184,0.5),
          -4px -4px 8px rgba(255,255,255,0.8));
      }
      .achv-card-img {
        width: 100%; height: 100%;
        object-fit: contain;
        display: block;
      }
      .achv-card-qmark {
        font-size: 56px; font-weight: 900;
        color: var(--ink-soft, #6b7386);
        opacity: 0.55;
        line-height: 1;
        text-shadow: 0 1px 0 rgba(255,255,255,0.55);
        user-select: none;
      }
      .achv-card-title {
        font-size: 13.5px; font-weight: 900;
        color: var(--ink, #33394a);
        line-height: 1.25;
        margin-bottom: 4px;
        word-break: break-word;
      }
      .achv-card.locked .achv-card-title {
        color: var(--ink-soft, #6b7386);
      }
      .achv-card-desc {
        font-size: 10.5px; font-weight: 700;
        color: var(--ink-soft, #6b7386);
        line-height: 1.35;
        word-break: break-word;
      }

      .achv-badge {
        position: absolute; top: 8px; right: 8px;
        font-size: 9px; font-weight: 900;
        padding: 3px 8px;
        border-radius: 999px;
        background: linear-gradient(135deg, var(--accent-a, #5b8cff), var(--accent-b, #8b6bff));
        color: #fff;
        box-shadow: 1px 1px 3px rgba(0,0,0,0.2);
        letter-spacing: 0.5px;
      }

      /* 乱入ボス実績：メガシンカ解放（タップで解放） */
      .achv-card.mega-pending {
        box-shadow: var(--shadow-light, 8px 8px 16px rgba(163,169,184,0.55), -8px -8px 16px rgba(255,255,255,0.85)),
                    0 0 0 3px rgba(255,93,140,0.55);
        animation: achvMegaPulse 1.3s ease-in-out infinite;
      }
      @keyframes achvMegaPulse {
        0%, 100% { transform: scale(1); }
        50%      { transform: scale(1.03); }
      }
      .achv-badge.mega-tap {
        background: linear-gradient(135deg, #ff5d8c, #ff9a4d);
        animation: achvMegaBlink .9s steps(2) infinite;
      }
      @keyframes achvMegaBlink { 0% { opacity: 1; } 100% { opacity: .55; } }
      .achv-badge.mega-done {
        background: linear-gradient(135deg, #4fd67a, #2fa860);
      }
      .achv-mega-note {
        margin-top: 6px; font-size: 10px; font-weight: 800; line-height: 1.3;
        color: #e0457a;
      }
      .achv-mega-note.done { color: #2fa860; }
      .achv-unlock-toast {
        position: fixed; left: 50%; bottom: calc(40px + env(safe-area-inset-bottom));
        transform: translateX(-50%) translateY(20px);
        z-index: 290; padding: 12px 22px; border-radius: 999px;
        background: linear-gradient(135deg, #ff5d8c, #8b6bff);
        color: #fff; font-weight: 900; font-size: 14px; letter-spacing: 1px;
        box-shadow: 0 6px 18px rgba(0,0,0,0.3);
        opacity: 0; pointer-events: none;
        transition: opacity .25s ease, transform .25s ease;
        max-width: 90vw; text-align: center;
      }
      .achv-unlock-toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }

      /* 縦長スマホ（横向き未対応端末） */
      @media (max-width: 480px) {
        .achv-grid { grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 10px; }
        .achv-card { padding: 10px; min-height: 160px; }
        .achv-card-imgwrap { max-height: 100px; margin-bottom: 8px; }
        .achv-card-qmark { font-size: 42px; }
      }
      /* 横画面（低い高さ） */
      @media (max-height: 420px) {
        .achv-header { padding: max(8px, env(safe-area-inset-top)) 14px 6px; }
        .achv-title { font-size: 15px; letter-spacing: 2px; }
        .achv-count { font-size: 11px; padding: 5px 14px; }
        .achv-close-btn { width: 34px; height: 34px; font-size: 17px; }
        .achv-body { padding: 4px 14px calc(16px + env(safe-area-inset-bottom)); }
        .achv-grid { grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 10px; }
        .achv-card { padding: 10px; min-height: 150px; }
        .achv-card-imgwrap { max-height: 90px; margin-bottom: 6px; }
        .achv-card-qmark { font-size: 40px; }
        .achv-card-title { font-size: 12px; }
        .achv-card-desc { font-size: 9.5px; }
        .achv-badge { font-size: 8px; padding: 2px 6px; top: 6px; right: 6px; }
      }
    `;
    document.head.appendChild(style);
  }

  /* ---- オーバーレイDOM ---- */
  function ensureOverlay() {
    injectStyle();
    if (document.getElementById(OVERLAY_ID)) return;
    const el = document.createElement('div');
    el.id = OVERLAY_ID;
    el.innerHTML = `
      <div class="achv-header">
        <p class="achv-title">実績</p>
        <div class="achv-header-right">
          <div class="achv-count" id="achv-count">0 / 0 達成</div>
          <button type="button" class="achv-close-btn" id="achv-close" aria-label="とじる">✕</button>
        </div>
      </div>
      <div class="achv-body">
        <div class="achv-grid" id="achv-grid"></div>
      </div>
    `;
    document.body.appendChild(el);
    el.querySelector('#achv-close').addEventListener('click', close);
    el.querySelector('#achv-grid').addEventListener('click', onGridClick);
  }

  /* ---- 乱入ボス実績 ⇔ メガシンカ解放 ---- */
  // 実績ID 'intrusion_<種族ID>' から種族IDを取り出す（乱入ボス実績でなければ null）。
  function megaSpeciesIdOf(achvId) {
    const m = /^intrusion_(\d+)$/.exec(achvId);
    return m ? Number(m[1]) : null;
  }
  // メガシンカ解放済みか（engine.js の isMegaUnlocked を使う。読めない場合は未解放扱い）
  function megaIsUnlocked(speciesId) {
    try { return typeof isMegaUnlocked === 'function' ? isMegaUnlocked(speciesId) : false; }
    catch (e) { return false; }
  }
  let toastTimer = null;
  function showUnlockToast(text) {
    let el = document.getElementById('achv-unlock-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'achv-unlock-toast';
      el.className = 'achv-unlock-toast';
      document.body.appendChild(el);
    }
    el.textContent = text;
    requestAnimationFrame(() => el.classList.add('show'));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
  }
  function onGridClick(e) {
    const card = e.target.closest('.achv-card');
    if (!card || card.disabled) return;
    const sid = megaSpeciesIdOf(card.dataset.id);
    if (sid === null) return;
    if (typeof unlockMega !== 'function') return;
    // 実績が解除済みで、まだ未解放のときだけ解放される（unlockMega側でも二重に判定）
    if (unlockMega(sid)) {
      showUnlockToast('✨ メガシンカが解放された！');
      render();
    }
  }

  /* ---- 描画 ---- */
  function render() {
    load();
    const grid = document.getElementById('achv-grid');
    const countEl = document.getElementById('achv-count');
    if (!grid || !countEl) return;
    countEl.textContent = `${count()} / ${total()} 達成`;

    grid.innerHTML = ACHIEVEMENTS.map((a) => {
      const got = unlocked.has(a.id);
      // 秘密の実績：達成後だけ本当の名前・説明を表示する
      const shownTitle = (a.secret && got && a.revealTitle) ? a.revealTitle() : a.title;
      const shownDesc  = (a.secret && got && a.revealDesc)  ? a.revealDesc()  : a.desc;
      // 乱入ボス実績：達成済みで、メガシンカがまだ未解放なら「タップで解放」状態
      const megaSid = megaSpeciesIdOf(a.id);
      const megaPending = got && megaSid !== null && !megaIsUnlocked(megaSid);
      const megaDone = got && megaSid !== null && megaIsUnlocked(megaSid);
      return `
        <button type="button"
                class="achv-card ${got ? 'unlocked' : 'locked'}${megaPending ? ' mega-pending' : ''}"
                data-id="${a.id}"
                ${got ? '' : 'disabled'}>
          <div class="achv-card-imgwrap">
            ${got
              ? `<img class="achv-card-img" src="./${a.card}" alt="${shownTitle}"
                       onerror="this.replaceWith(makeAchvFallback())">`
              : `<span class="achv-card-qmark">?</span>`}
          </div>
          <div class="achv-card-title">${shownTitle}</div>
          <div class="achv-card-desc">${shownDesc}</div>
          ${megaPending ? `<div class="achv-mega-note">タップでメガシンカを解放！</div>` : ''}
          ${megaDone ? `<div class="achv-mega-note done">メガシンカ解放済み</div>` : ''}
          ${megaPending ? `<span class="achv-badge mega-tap">TAP!</span>`
            : megaDone ? `<span class="achv-badge mega-done">解放済</span>`
            : (got ? `<span class="achv-badge">達成</span>` : '')}
        </button>
      `;
    }).join('');
  }

  // 画像が読み込めなかった時のフォールバック（★マーク）
  window.makeAchvFallback = function () {
    const s = document.createElement('span');
    s.className = 'achv-card-qmark';
    s.textContent = '★';
    s.style.color = '#f5b83d';
    s.style.opacity = '0.9';
    return s;
  };

  /* ---- 開閉 ---- */
  function isOpen() {
    const el = document.getElementById(OVERLAY_ID);
    return !!(el && el.classList.contains('show'));
  }
  function open() {
    ensureOverlay();
    checkAutoUnlocks();
    render();
    const el = document.getElementById(OVERLAY_ID);
    // 次フレームで show を付けて opacity トランジションを効かせる
    requestAnimationFrame(() => el.classList.add('show'));
  }
  function close() {
    const el = document.getElementById(OVERLAY_ID);
    if (el) el.classList.remove('show');
  }
  function toggle() { isOpen() ? close() : open(); }

  /* ---- ボタン接続 ---- */
  function bindTitleButton() {
    const btn = document.getElementById('btn-achievements');
    if (!btn || btn.dataset.achvBound === '1') return;
    btn.dataset.achvBound = '1';
    btn.addEventListener('click', () => open());
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindTitleButton);
  } else {
    bindTitleButton();
  }

  /* ---- 公開 ---- */
  window.Achievements = {
    open, close, toggle, isOpen,
    unlock, unlockAll, resetAll,
    isUnlocked, count, total, list,
    checkAutoUnlocks,
    typeStreakTargetTypes: () => TYPE_STREAK_TARGET_TYPES.map((t) => t.type),
  };
})();