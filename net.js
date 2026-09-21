'use strict';
/* =========================================================
   対人戦ネットワーク層（ホスト権威方式）
   - ホストが engine.js を実行し、battle events を Firebase へ push
   - ゲストは events を受信して順番に再生、自分の行動だけ送信
   ========================================================= */

const Net = {
  db: null,
  roomRef: null,
  isHost: false,
  roomId: null,
  playerName: '',
  opponentName: '',
  opponentFavorite: null, // 相手のお気に入りポケモン { speciesId, shiny } または null
  ready: false,
  _unsubs: [],
  _eventsRef: null,
  _eventsHandler: null,

  /* ---- ハートビート（生存確認）関連 ----
     onDisconnect による即時 'closed' 化は、スマホの画面ロックや
     アプリのバックグラウンド化、Wi-Fi⇄モバイル回線の切替、電波の瞬断でも
     頻繁に発火してしまい、「本当は抜けていないのに退室扱いになる」
     誤検知の原因になっていた。
     代わりに、双方が一定間隔で「生きている」タイムスタンプを書き込み続け、
     相手のタイムスタンプが HEARTBEAT_TIMEOUT_MS 以上更新されなくなった
     ときにだけ「本当に退室した」とみなす方式に変更する。 */
  HEARTBEAT_INTERVAL_MS: 5000,
  HEARTBEAT_TIMEOUT_MS: 20000,
  _heartbeatTimer: null,
  _watchdogTimer: null,

  /* ---- Firebase接続状態の監視 ----
     Firebase Realtime Database の WebSocket は、スマホの回線切替や
     一時的な電波の乱れ、あるいはタブの負荷（重い描画処理でメインスレッドが
     詰まる等）が原因で、実際には何も問題がないのに一瞬「再接続」を
     行うことがある。onDisconnect() はソケットが確立された時点の状態に
     対して登録されるため、再接続のたびに登録し直さないと、
     古い接続に対する登録が意図せず発火したり、新しい接続に対して
     onDisconnect が未設定のままになったりする。
     .info/connected を監視し、再接続のたびに onDisconnect を張り直す。 */
  _connectedRef: null,
  _connectedHandler: null,
  _reconnectGraceUntil: 0,
  // 再接続直後は、相手のハートビートがまだ届いていなくても
  // 「切断」と誤判定しないための猶予（自分の再接続だけでなく、
  // 相手側が再接続した場合の反映遅延も考慮する）。
  RECONNECT_GRACE_MS: 8000,

  init() {
    if (this.ready) return true;
    if (typeof firebase === 'undefined') {
      console.warn('[Net] Firebase SDK未読込');
      return false;
    }
    if (!FIREBASE_CONFIG || !FIREBASE_CONFIG.databaseURL ||
        FIREBASE_CONFIG.databaseURL.indexOf('YOUR_PROJECT') >= 0) {
      console.warn('[Net] firebase-config.js が未設定');
      return false;
    }
    try {
      if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
      this.db = firebase.database();
      this.ready = true;
      return true;
    } catch (e) {
      console.error('[Net] 初期化失敗', e);
      return false;
    }
  },

  reset() {
    this._unsubs.forEach((fn) => { try { fn(); } catch (e) {} });
    this._unsubs = [];
    this._stopHeartbeat();
    this._stopWatchdog();
    this._unwireConnectionWatcher();
    this.roomRef = null;
    this.roomId = null;
    this.isHost = false;
    this.opponentName = '';
    this.opponentFavorite = null;
    this.megaEnabled = false;
    this.battleFormat = 'random';
    this._opponentPickPoolUnsub = null;
  },

  async createRoom(code, name, favorite, megaEnabled, battleFormat) {
    if (!this.init()) return 'error';
    this.isHost = true;
    this.roomId = code;
    this.playerName = name;
    this.roomRef = this.db.ref('rooms/' + code);
    const snap = await this.roomRef.once('value');
    if (snap.exists()) return 'exists';
    this.battleFormat = (battleFormat === 'team') ? 'team' : 'random';
    await this.roomRef.set({
      meta: {
        hostName: name,
        hostFavorite: favorite || null,
        guestName: null,
        guestFavorite: null,
        status: 'waiting',
        megaEnabled: !!megaEnabled,
        battleFormat: this.battleFormat,
        createdAt: firebase.database.ServerValue.TIMESTAMP,
        hostHeartbeat: firebase.database.ServerValue.TIMESTAMP,
        guestHeartbeat: 0,
      },
      hostTeam: null,
      guestTeam: null,
    });
    this._armDisconnectClose();
    return 'ok';
  },

  async joinRoom(code, name, favorite) {
    if (!this.init()) return 'error';
    this.isHost = false;
    this.roomId = code;
    this.playerName = name;
    this.roomRef = this.db.ref('rooms/' + code);
    const snap = await this.roomRef.once('value');
    if (!snap.exists()) return 'not-found';
    const data = snap.val();
    if (!data.meta) return 'not-found';
    if (data.meta.guestName) return 'full';
    if (data.meta.status !== 'waiting') return 'full';
    this.opponentName = data.meta.hostName || '';
    this.opponentFavorite = data.meta.hostFavorite || null;
    this.megaEnabled = !!data.meta.megaEnabled;
    this.battleFormat = (data.meta.battleFormat === 'team') ? 'team' : 'random';
    await this.roomRef.child('meta').update({
      guestName: name,
      guestFavorite: favorite || null,
      status: 'both-in',
      guestHeartbeat: firebase.database.ServerValue.TIMESTAMP,
    });
    this._armDisconnectClose();
    return 'ok';
  },

  // 自分のお気に入りポケモンを、入室後に変更した場合に部屋のmetaへ反映する
  async updateMyFavorite(favorite) {
    if (!this.roomRef) return;
    const key = this.isHost ? 'hostFavorite' : 'guestFavorite';
    try { await this.roomRef.child('meta').child(key).set(favorite || null); } catch (e) {}
  },

  /* ---- メガシンカ有無設定（対人戦：ホストのみ変更可） ----
     ホストが待機部屋でON/OFFを切り替えると meta/megaEnabled に反映され、
     ゲスト側は onMegaEnabledChange で常に最新の値を受け取る。 */
  megaEnabled: false,
  async setMegaEnabled(enabled) {
    if (!this.roomRef || !this.isHost) return;
    this.megaEnabled = !!enabled;
    try { await this.roomRef.child('meta/megaEnabled').set(!!enabled); } catch (e) {}
  },

  onMegaEnabledChange(cb) {
    if (!this.roomRef) return;
    const ref = this.roomRef.child('meta/megaEnabled');
    const handler = (snap) => {
      this.megaEnabled = !!snap.val();
      cb(this.megaEnabled);
    };
    ref.on('value', handler);
    this._unsubs.push(() => ref.off('value', handler));
  },

  /* ---- 対戦方式（ランダム／チーム）設定（対人戦：ホストのみ変更可） ----
     メガシンカ設定と同じ仕組み。ホストが待機部屋で切り替え、
     ゲスト側は onBattleFormatChange で常に最新の値を受け取る。
     format: 'random' | 'team' */
  battleFormat: 'random',
  async setBattleFormat(format) {
    if (!this.roomRef || !this.isHost) return;
    this.battleFormat = (format === 'team') ? 'team' : 'random';
    try { await this.roomRef.child('meta/battleFormat').set(this.battleFormat); } catch (e) {}
  },

  onBattleFormatChange(cb) {
    if (!this.roomRef) return;
    const ref = this.roomRef.child('meta/battleFormat');
    const handler = (snap) => {
      this.battleFormat = (snap.val() === 'team') ? 'team' : 'random';
      cb(this.battleFormat);
    };
    ref.on('value', handler);
    this._unsubs.push(() => ref.off('value', handler));
  },

  /* ---- チーム戦：選出前に「6匹の手持ち全体」をお互い閲覧できるようにする ----
     選出（3匹選ぶ）そのものは相手に見せないが、持ち込んだ6匹の顔ぶれは
     見える必要があるため、選出プールを専用パスで共有する。 */
  async sendPickPool(pool) {
    if (!this.roomRef) return;
    const path = this.isHost ? 'pickPool/hostPool' : 'pickPool/guestPool';
    const payload = pool.map(serializePokeForNet);
    let lastErr = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await this.roomRef.child(path).set(payload);
        return;
      } catch (e) {
        lastErr = e;
        await new Promise((r) => setTimeout(r, 400));
      }
    }
    throw lastErr;
  },

  _opponentPickPoolUnsub: null,
  onOpponentPickPool(cb) {
    if (!this.roomRef) return;
    if (this._opponentPickPoolUnsub) { this._opponentPickPoolUnsub(); this._opponentPickPoolUnsub = null; }
    const path = this.isHost ? 'pickPool/guestPool' : 'pickPool/hostPool';
    const ref = this.roomRef.child(path);
    let done = false;
    const handler = (snap) => {
      if (done) return;
      const data = snap.val();
      if (data && Array.isArray(data) && data.length > 0) {
        done = true;
        ref.off('value', handler);
        this._opponentPickPoolUnsub = null;
        cb(data.map(deserializePokeFromNet));
      }
    };
    ref.on('value', handler);
    const unsub = () => ref.off('value', handler);
    this._opponentPickPoolUnsub = unsub;
    this._unsubs.push(unsub);
  },

  async clearPickPool() {
    if (!this.roomRef) return;
    await this.roomRef.child('pickPool').remove();
  },

  /* ---- 切断時に自動で部屋を閉じる設定 ----
     旧方式は onDisconnect().set('closed') を使い、Firebaseとのソケット接続が
     切れた瞬間に即座に部屋を閉じていた。しかしこれはスマホの画面ロックや
     アプリのバックグラウンド化、回線の一瞬の瞬断でも発火してしまい、
     「本当は相手は抜けていないのに退室扱いになる」誤検知が非常に多かった。

     新方式：双方が HEARTBEAT_INTERVAL_MS ごとに自分の生存タイムスタンプ
     （meta/hostHeartbeat または meta/guestHeartbeat）を書き込み続ける。
     相手はこのタイムスタンプを監視し、HEARTBEAT_TIMEOUT_MS 以上更新が
     止まった場合にのみ「本当に退室した」と判定する。
     一時的な瞬断はこの猶予時間内に自然と復帰するため、誤検知が起きない。
     onDisconnect は「即closed」ではなく「ハートビートを0にする」用途にのみ
     使い、実際の退室判定はタイムスタンプの停滞で行う。 */
  _armDisconnectClose() {
    if (!this.roomRef) return;
    this._wireConnectionWatcher();
    this._startHeartbeat();
  },

  _disarmDisconnectClose() {
    if (!this.roomRef) return;
    try {
      const hbPath = this.isHost ? 'meta/hostHeartbeat' : 'meta/guestHeartbeat';
      this.roomRef.child(hbPath).onDisconnect().cancel();
    } catch (e) {}
    this._unwireConnectionWatcher();
    this._stopHeartbeat();
  },

  /* ---- .info/connected を監視し、再接続のたびに onDisconnect を再登録する ----
     Firebase公式が推奨するパターン。true（接続確立）になるたびに
     onDisconnect().set(0) を張り直すことで、瞬断からの再接続後も
     正しい切断検知が機能し続けるようにする。
     また、再接続が起きた直後は一時的な猶予期間を設け、その間は
     ウォッチドッグのタイムアウト判定を保留する（自分側の再接続の
     揺らぎで誤って「相手が切れた」と判定しないようにするため）。 */
  _wireConnectionWatcher() {
    this._unwireConnectionWatcher();
    if (!this.db) return;
    const hbPath = this.isHost ? 'meta/hostHeartbeat' : 'meta/guestHeartbeat';
    const ref = this.db.ref('.info/connected');
    const handler = (snap) => {
      if (snap.val() === true) {
        try { this.roomRef && this.roomRef.child(hbPath).onDisconnect().set(0); } catch (e) {}
        // 再接続直後はハートビートが届くまでの猶予を確保
        this._reconnectGraceUntil = Date.now() + this.RECONNECT_GRACE_MS;
        // 再接続できたのですぐにハートビートを打ち直す
        try {
          this.roomRef && this.roomRef.child(hbPath).set(firebase.database.ServerValue.TIMESTAMP);
        } catch (e) {}
      }
    };
    ref.on('value', handler);
    this._connectedRef = ref;
    this._connectedHandler = handler;
  },

  _unwireConnectionWatcher() {
    if (this._connectedRef && this._connectedHandler) {
      try { this._connectedRef.off('value', this._connectedHandler); } catch (e) {}
    }
    this._connectedRef = null;
    this._connectedHandler = null;
  },

  _startHeartbeat() {
    this._stopHeartbeat();
    if (!this.roomRef) return;
    const hbPath = this.isHost ? 'meta/hostHeartbeat' : 'meta/guestHeartbeat';
    const beat = () => {
      try { this.roomRef.child(hbPath).set(firebase.database.ServerValue.TIMESTAMP); } catch (e) {}
    };
    beat();
    this._heartbeatTimer = setInterval(beat, this.HEARTBEAT_INTERVAL_MS);
  },

  _stopHeartbeat() {
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
  },

  _stopWatchdog() {
    if (this._watchdogTimer) {
      clearInterval(this._watchdogTimer);
      this._watchdogTimer = null;
    }
  },

  /* ---- 部屋が閉じられた（相手が本当に抜けた）ことを監視 ----
     明示的な meta/status === 'closed'（相手が正常に退出ボタン等で抜けた場合）と、
     相手のハートビートが HEARTBEAT_TIMEOUT_MS 以上止まっている場合（異常切断）
     の両方を検知する。後者は猶予時間を挟むことで、一時的な瞬断による
     誤検知を防ぐ。 */
  onRoomClosed(cb) {
    if (!this.roomRef) return;
    let firedByStatus = false;

    const statusRef = this.roomRef.child('meta/status');
    const statusHandler = (snap) => {
      if (snap.val() === 'closed') {
        firedByStatus = true;
        cb();
      }
    };
    statusRef.on('value', statusHandler);
    this._unsubs.push(() => statusRef.off('value', statusHandler));

    // 相手のハートビートを監視するウォッチドッグ。
    // 最後に確認できた相手のハートビート時刻を記録し、定期的に
    // 「今の時刻 - 最後の心拍」が猶予時間を超えていないか確認する。
    const hbPath = this.isHost ? 'meta/guestHeartbeat' : 'meta/hostHeartbeat';
    const hbRef = this.roomRef.child(hbPath);
    let lastHeartbeatAt = Date.now();
    let sawAnyHeartbeat = false;

    const hbHandler = (snap) => {
      const v = snap.val();
      if (typeof v === 'number' && v > 0) {
        sawAnyHeartbeat = true;
        lastHeartbeatAt = Date.now();
      } else if (v === 0 && sawAnyHeartbeat) {
        // onDisconnectによる0書き込み＝相手が正常にソケットを切った合図。
        // ただしこれも猶予を与え、watchdogのタイムアウトチェックに任せる
        // （0の直後に再接続してハートビートが再開するケースを許容するため）。
      }
    };
    hbRef.on('value', hbHandler);
    this._unsubs.push(() => hbRef.off('value', hbHandler));

    this._stopWatchdog();
    this._watchdogTimer = setInterval(() => {
      if (firedByStatus) return;
      // 相手からまだ一度もハートビートを受け取っていない場合
      // （入室直後などタイミングの問題）は判定しない。
      if (!sawAnyHeartbeat) return;
      // 自分側が再接続した直後は、相手のハートビート反映にも
      // ラグが出ることがあるため、猶予期間中はタイムアウト判定を保留する。
      if (Date.now() < this._reconnectGraceUntil) return;
      const elapsed = Date.now() - lastHeartbeatAt;
      if (elapsed >= this.HEARTBEAT_TIMEOUT_MS) {
        this._stopWatchdog();
        cb();
      }
    }, 2000);
    this._unsubs.push(() => this._stopWatchdog());
  },

  onGuestJoined(cb) {
    if (!this.roomRef) return;
    const ref = this.roomRef.child('meta');
    const handler = (snap) => {
      const data = snap.val() || {};
      if (data.guestName) {
        this.opponentName = data.guestName;
        this.opponentFavorite = data.guestFavorite || null;
        cb(data.guestName);
      }
    };
    ref.on('value', handler);
    this._unsubs.push(() => ref.off('value', handler));
  },

  // 相手（ホスト視点ではゲスト、ゲスト視点ではホスト）のお気に入りポケモンが
  // 変化した時に呼ばれる。ルーム画面表示中にお気に入りを変更した場合に対応するため。
  onOpponentFavoriteChange(cb) {
    if (!this.roomRef) return;
    const key = this.isHost ? 'guestFavorite' : 'hostFavorite';
    const ref = this.roomRef.child('meta').child(key);
    const handler = (snap) => {
      this.opponentFavorite = snap.val() || null;
      cb(this.opponentFavorite);
    };
    ref.on('value', handler);
    this._unsubs.push(() => ref.off('value', handler));
  },

  onStatusChange(cb) {
    if (!this.roomRef) return;
    const ref = this.roomRef.child('meta/status');
    const handler = (snap) => cb(snap.val());
    ref.on('value', handler);
    this._unsubs.push(() => ref.off('value', handler));
  },

  /* ---- 準備完了ルーム（ソシャゲ風の1番/2番待機部屋） ---- */
  async setReady(ready) {
    if (!this.roomRef) return;
    const path = this.isHost ? 'ready/hostReady' : 'ready/guestReady';
    await this.roomRef.child(path).set(!!ready);
  },

  // 自分・相手両方のready状態の変化を監視する（cbは {mine, opponent} を受け取る）
  onReadyChange(cb) {
    if (!this.roomRef) return;
    const ref = this.roomRef.child('ready');
    const handler = (snap) => {
      const data = snap.val() || {};
      const mine = this.isHost ? !!data.hostReady : !!data.guestReady;
      const opponent = this.isHost ? !!data.guestReady : !!data.hostReady;
      cb({ mine, opponent });
    };
    ref.on('value', handler);
    this._unsubs.push(() => ref.off('value', handler));
  },

  async clearReady() {
    if (!this.roomRef) return;
    await this.roomRef.child('ready').remove();
  },

  async sendTeam(team) {
    if (!this.roomRef) return;
    const path = this.isHost ? 'hostTeam' : 'guestTeam';
    const payload = team.map(serializePokeForNet);
    // 対戦相手が「相手の選出を待っています…」のまま固まるのを防ぐため、
    // 通信が不安定な場合は数回リトライしてから諦める（ここで例外を投げると
    // 以降の画面遷移ごと止まってしまうため、最終手段としてthrowはする）。
    let lastErr = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await this.roomRef.child(path).set(payload);
        return;
      } catch (e) {
        lastErr = e;
        await new Promise((r) => setTimeout(r, 400));
      }
    }
    throw lastErr;
  },

  // 直前に登録された onOpponentTeam のリスナーを覚えておき、連戦などで再登録される際に
  // 必ず先に解除する。これを怠ると同じパスに複数の 'value' リスナーが積み重なり、
  // 片方のクロージャの done フラグと実際の受信が噛み合わずコールバックが呼ばれない
  // ことがある（「相手の選出を待っています…」のまま止まる不具合の一因）。
  _opponentTeamUnsub: null,
  onOpponentTeam(cb) {
    if (!this.roomRef) return;
    if (this._opponentTeamUnsub) { this._opponentTeamUnsub(); this._opponentTeamUnsub = null; }
    const path = this.isHost ? 'guestTeam' : 'hostTeam';
    const ref = this.roomRef.child(path);
    let done = false;
    const handler = (snap) => {
      if (done) return;
      const data = snap.val();
      if (data && Array.isArray(data) && data.length > 0) {
        done = true;
        ref.off('value', handler);
        this._opponentTeamUnsub = null;
        cb(data.map(deserializePokeFromNet));
      }
    };
    ref.on('value', handler);
    const unsub = () => ref.off('value', handler);
    this._opponentTeamUnsub = unsub;
    this._unsubs.push(unsub);
  },

  /* ---- 選出後の交換フェーズ（対人戦のみ） ---- */
  async setNegoDone(done) {
    if (!this.roomRef) return;
    const path = this.isHost ? 'nego/hostDone' : 'nego/guestDone';
    await this.roomRef.child(path).set(!!done);
  },

  onOpponentNegoDone(cb) {
    if (!this.roomRef) return;
    const path = this.isHost ? 'nego/guestDone' : 'nego/hostDone';
    const ref = this.roomRef.child(path);
    const handler = (snap) => cb(!!snap.val());
    ref.on('value', handler);
    const unsub = () => ref.off('value', handler);
    this._unsubs.push(unsub);
    return unsub;
  },

  async clearNego() {
    if (!this.roomRef) return;
    await this.roomRef.child('nego').remove();
  },

  async sendAction(action) {
    if (!this.roomRef) return;
    const path = this.isHost ? 'battle/hostAction' : 'battle/guestAction';
    await this.roomRef.child(path).set(serializeAction(action));
  },

  waitForOpponentAction(cb) {
    if (!this.roomRef) return;
    const path = this.isHost ? 'battle/guestAction' : 'battle/hostAction';
    const ref = this.roomRef.child(path);
    const handler = (snap) => {
      const data = snap.val();
      if (data) {
        ref.off('value', handler);
        ref.set(null);
        cb(data);
      }
    };
    ref.on('value', handler);
    this._unsubs.push(() => ref.off('value', handler));
  },

  /* ---- ホスト → ゲストへのイベント送信 ---- */
  async pushEvents(events) {
    if (!this.roomRef || !this.isHost) return;
    for (const ev of events) {
      await this.roomRef.child('battle/events').push(ev);
    }
  },

  async pushEvent(ev) {
    if (!this.roomRef || !this.isHost) return;
    await this.roomRef.child('battle/events').push(ev);
  },

  onEvent(cb) {
    if (!this.roomRef || this.isHost) return;
    // 同じ購読を二重に張らないためのガード（再接続やコード再実行での多重登録を防止）
    if (this._eventsRef) {
      this._eventsRef.off('child_added', this._eventsHandler);
    }
    const ref = this.roomRef.child('battle/events');
    const handler = (snap) => {
      const ev = snap.val();
      if (ev) cb(ev, snap.key);
    };
    ref.on('child_added', handler);
    this._eventsRef = ref;
    this._eventsHandler = handler;
    this._unsubs.push(() => ref.off('child_added', handler));
  },

  /* ---- 降参：双方向・常時リッスン可能な専用パス ----
     ターンの行動待ち（waitForOpponentAction）はお互いの通常行動が
     揃うまで発火しないため、降参のような「今すぐ試合を終わらせたい」
     意思表示には使えない。専用のパスを設けて常時購読することで、
     相手が自分の行動選択中でも即座に降参を検知できるようにする。 */
  async sendSurrender() {
    if (!this.roomRef) return;
    const path = this.isHost ? 'battle/hostSurrender' : 'battle/guestSurrender';
    await this.roomRef.child(path).set(true);
  },

  onOpponentSurrender(cb) {
    if (!this.roomRef) return;
    const path = this.isHost ? 'battle/guestSurrender' : 'battle/hostSurrender';
    const ref = this.roomRef.child(path);
    const handler = (snap) => {
      if (snap.val()) cb();
    };
    ref.on('value', handler);
    this._unsubs.push(() => ref.off('value', handler));
    return () => ref.off('value', handler);
  },

  async clearSurrenderFlags() {
    if (!this.roomRef) return;
    await this.roomRef.child('battle/hostSurrender').remove();
    await this.roomRef.child('battle/guestSurrender').remove();
  },

  async clearEvents() {
    if (!this.roomRef) return;
    await this.roomRef.child('battle/events').remove();
    await this.roomRef.child('battle/hostAction').remove();
    await this.roomRef.child('battle/guestAction').remove();
    await this.roomRef.child('battle/hostSurrender').remove();
    await this.roomRef.child('battle/guestSurrender').remove();
  },

  /* ---- 対戦終了後の連戦/退出選択 ---- */
  async setRematchChoice(choice) {
    // choice: 'rematch' | 'leave'
    if (!this.roomRef) return;
    const path = this.isHost ? 'rematch/hostChoice' : 'rematch/guestChoice';
    await this.roomRef.child(path).set(choice);
  },

  // 一度だけ相手の選択を受け取り、受け取った時点でリスナーを解除する（使い捨て）。
  // これにより、後続の resetForNextBattle() による削除（null化）を
  // 「相手の選択」として誤検知することがなくなる。
  onOpponentRematchChoice(cb) {
    if (!this.roomRef) return;
    const path = this.isHost ? 'rematch/guestChoice' : 'rematch/hostChoice';
    const ref = this.roomRef.child(path);
    let done = false;
    const handler = (snap) => {
      if (done) return;
      const v = snap.val();
      if (v) {
        done = true;
        ref.off('value', handler);
        cb(v);
      }
    };
    ref.on('value', handler);
    this._unsubs.push(() => ref.off('value', handler));
  },

  // 自分が相手の選択を受け取ったことを相手に伝える（ack）。
  async ackRematchChoice() {
    if (!this.roomRef) return;
    const path = this.isHost ? 'rematch/hostAck' : 'rematch/guestAck';
    await this.roomRef.child(path).set(true);
  },

  // 相手からのackを一度だけ待つ（相手が自分の選択を確実に受信したことの確認用）。
  waitOpponentAck() {
    if (!this.roomRef) return Promise.resolve();
    const path = this.isHost ? 'rematch/guestAck' : 'rematch/hostAck';
    const ref = this.roomRef.child(path);
    return new Promise((resolve) => {
      let done = false;
      const handler = (snap) => {
        if (done) return;
        if (snap.val()) {
          done = true;
          ref.off('value', handler);
          resolve();
        }
      };
      ref.on('value', handler);
      this._unsubs.push(() => ref.off('value', handler));
    });
  },

  async clearRematch() {
    if (!this.roomRef) return;
    await this.roomRef.child('rematch').remove();
  },

  // 連戦時：バトル・選出・交換フェーズのデータを次戦用にクリアする
  async resetForNextBattle() {
    if (!this.roomRef) return;
    await this.roomRef.child('battle').remove();
    await this.roomRef.child('nego').remove();
    await this.roomRef.child('rematch').remove();
    await this.roomRef.child('ready').remove();
    await this.roomRef.child('hostTeam').remove();
    await this.roomRef.child('guestTeam').remove();
    await this.roomRef.child('pickPool').remove();
  },

  /* ---- 部屋を明示的に閉じる（相手に通知） ---- */
  async closeRoom() {
    if (!this.roomRef) return;
    try { await this.roomRef.child('meta/status').set('closed'); } catch (e) {}
  },

  async leave() {
    if (this.roomRef) {
      try {
        this._disarmDisconnectClose();
        await this.closeRoom();
        if (this.isHost) {
          await this.roomRef.remove();
        } else {
          await this.roomRef.child('meta/guestName').remove();
          await this.roomRef.child('guestTeam').remove();
          await this.roomRef.child('battle').remove();
          await this.roomRef.child('nego').remove();
          await this.roomRef.child('rematch').remove();
          await this.roomRef.child('ready').remove();
          await this.roomRef.child('pickPool').remove();
        }
      } catch (e) {}
    }
    this.reset();
  },
};

/* ---- シリアライズ ---- */
function serializePokeForNet(p) {
  return {
    sid: p.speciesId,
    lv: p.level,
    nat: p.nature,
    ab: p.ability,
    evs: p.evs,
    iv: p.iv,
    stats: p.stats,
    mhp: p.maxHp,
    hp: p.currentHp,
    mids: p.moves.map((m) => m.id),
    st: p.status || 0,
    rk: p.ranks,
    es: p.energyStacks || 0,
    sh: !!p.shiny,
  };
}

function deserializePokeFromNet(d) {
  const species = GAME_DATA.species[d.sid];
  const moves = d.mids.map((id) => {
    if (!id) return null;
    const m = GAME_DATA.moves[id];
    if (!m) return null;
    return {
      id, name: m.name, type: m.type, power: m.power, accuracy: m.accuracy,
      category: m.category, pp: m.pp, maxPp: m.pp, priority: m.priority || 0,
      selfRank: m.selfRank, oppRank: m.oppRank, selfStatus: m.selfStatus,
      oppStatus: m.oppStatus, flinchChance: m.flinchChance || 0,
      drainRatio: m.drainRatio || null, recoilRatio: m.recoilRatio || null,
      selfDestruct: !!m.selfDestruct, chargeTurn: !!m.chargeTurn,
      damageFormula: m.damageFormula || null, callRandomMove: !!m.callRandomMove,
      locked: false,
    };
  }).filter(Boolean);
  return {
    speciesId: d.sid, species, level: d.lv, nature: d.nat, ability: d.ab,
    evs: d.evs, iv: d.iv, stats: d.stats, maxHp: d.mhp, currentHp: d.hp,
    moves,
    shiny: !!d.sh,
    status: d.st || 0, badlyPoisonCounter: 0, confuseTurns: 0, sleepTurns: 0,
    ranks: d.rk || { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, acc: 0, eva: 0 },
    flinch: false, fainted: false,
    fundoTriggered: false, moraibiActive: false, lazyTurns: false,
    firstTurn: true, gyakujouTriggered: false, energyStacks: d.es || 0,
    tauntTurns: 0, bindTurns: 0,
    removedTypes: [], changedType: null,
    hengenjizaiType: null, hengenjizaiUsed: false,
    typeLockTurns: 0, typeLockType: null,
    isMega: false, megaOriginalSpecies: null, megaOriginalAbility: null,
    lastUsedMoveId: null, encoreMoveId: null, encoreTurns: 0,
    utsusemiTurns: 0, infernoUsed: false,
    deaigashiraLocked: false, turnsOnField: 0, gekirinTurns: 0, gekirinMoveId: null,
    protecting: false, protectStreak: 0, critRank: 0,
  };
}

function serializeAction(a) {
  if (!a) return { type: 'none' };
  if (a.type === 'move') return { type: 'move', moveId: a.move.id, mega: !!a.mega };
  if (a.type === 'switch') return { type: 'switch', idx: a.idx };
  return { type: 'none' };
}