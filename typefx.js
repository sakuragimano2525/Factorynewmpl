// ============================================================
// typefx.js — タイプ別 Canvas パーティクルエフェクト
// sprite-slot (position:relative) の中に一時的に <canvas> を差し込み、
// requestAnimationFrame でパーティクルを描画、アニメーション終了後に
// 要素を自動削除する。ui.js の playTypeEffect(side, moveType) から呼ばれる。
// gamedata.js / engine.js のロジックには一切依存しない、純粋な演出モジュール。
// ============================================================

(function (global) {
  'use strict';

  // ---- 汎用ユーティリティ ----
  function rand(min, max) { return min + Math.random() * (max - min); }
  function pick(arr) { return arr[(Math.random() * arr.length) | 0]; }
  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
  function easeInCubic(t) { return t * t * t; }
  function easeOutQuint(t) { return 1 - Math.pow(1 - t, 5); }
  function easeInOutSine(t) { return -(Math.cos(Math.PI * t) - 1) / 2; }
  function lerp(a, b, t) { return a + (b - a) * t; }

  // ---- 疑似1次元ノイズ（Value Noise）：炎の揺らぎ・煙の乱流・水面のうねりに使う ----
  // 周波数freq・時間位相phase・シード値seedから滑らかな -1〜1 のノイズ値を返す。
  // Math.sinの多重合成（フラクタルノイズ的）で、単純なsin波より不規則で自然な揺らぎになる。
  function noise1(x, seed) {
    const s = seed * 91.7 + 13.1;
    return (
      Math.sin(x * 1.0 + s) * 0.5 +
      Math.sin(x * 2.13 + s * 1.7) * 0.28 +
      Math.sin(x * 4.7 + s * 0.6) * 0.14 +
      Math.sin(x * 9.1 + s * 2.3) * 0.08
    );
  }

  // ---- 画面シェイク（DOM要素のtransformを直接揺らす）----
  // wrapEl に対して振幅ampPx、時間durationMs、減衰カーブで細かく震わせる。
  // ゲーム画面全体（special-fx-layerの親 = battle-field想定）に掛けることで「衝撃の体感」を出す。
  function screenShake(targetEl, { ampPx = 14, durationMs = 420, freq = 26 } = {}) {
    if (!targetEl) return Promise.resolve();
    const start = performance.now();
    const prevTransform = targetEl.style.transform || '';
    const prevWillChange = targetEl.style.willChange || '';
    targetEl.style.willChange = 'transform';
    return new Promise((resolve) => {
      function frame(now) {
        const elapsed = now - start;
        const t = clamp01(elapsed / durationMs);
        if (t >= 1) {
          targetEl.style.transform = prevTransform;
          targetEl.style.willChange = prevWillChange;
          resolve();
          return;
        }
        // 減衰する高周波の揺れ：立ち上がりは急激、後半は指数的に収束
        const decay = Math.pow(1 - t, 2.2);
        const phase = elapsed * 0.001 * freq * Math.PI * 2;
        const dx = (noise1(phase, 3.1) * ampPx * decay);
        const dy = (noise1(phase * 1.3, 7.7) * ampPx * 0.7 * decay);
        const rot = noise1(phase * 0.7, 1.9) * decay * 0.6;
        targetEl.style.transform = `translate(${dx.toFixed(2)}px, ${dy.toFixed(2)}px) rotate(${rot.toFixed(3)}deg)`;
        requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    });
  }

  // ---- 全画面カラーフラッシュ（加算合成のオーバーレイdiv）----
  // 爆発・着弾の瞬間に一瞬強く発光してから急速に減衰する「衝撃の光」を演出する。
  // canvasパーティクルと違い、CSSのopacity遷移で最速の立ち上がりを出す。
  function screenFlash(wrapEl, { color = '#fff8e0', peakAlpha = 0.85, durationMs = 260, delay = 0 } = {}) {
    if (!wrapEl) return;
    const el = document.createElement('div');
    el.style.position = 'absolute';
    el.style.inset = '0';
    el.style.background = color;
    el.style.opacity = '0';
    el.style.pointerEvents = 'none';
    el.style.zIndex = '7';
    el.style.mixBlendMode = 'screen';
    wrapEl.appendChild(el);
    setTimeout(() => {
      requestAnimationFrame(() => {
        el.style.transition = `opacity ${Math.round(durationMs * 0.12)}ms ease-out`;
        el.style.opacity = String(peakAlpha);
        setTimeout(() => {
          el.style.transition = `opacity ${Math.round(durationMs * 0.88)}ms ease-in`;
          el.style.opacity = '0';
          setTimeout(() => el.remove(), durationMs);
        }, Math.round(durationMs * 0.12));
      });
    }, delay);
  }

  function hexToRgb(hex) {
    const h = hex.replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  function rgba(hex, a) {
    const { r, g, b } = hexToRgb(hex);
    return `rgba(${r},${g},${b},${a})`;
  }

  // ============================================================
  // パーティクル基底クラス：各タイプの spawn 関数が生成する単純なオブジェクト
  // { x, y, vx, vy, life, maxLife, draw(ctx, t) } を配列で管理し、
  // 毎フレーム update → draw する共通ランナー。
  // ============================================================
  function runParticleScene({ canvas, durationMs, spawn, background }) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    const particles = [];
    spawn(particles, w, h);

    return new Promise((resolve) => {
      const start = performance.now();
      function frame(now) {
        const elapsed = now - start;
        const t = clamp01(elapsed / durationMs);
        ctx.clearRect(0, 0, w, h);
        if (background) background(ctx, w, h, t);
        for (let i = 0; i < particles.length; i++) {
          const p = particles[i];
          const pt = clamp01((elapsed - (p.delay || 0)) / (p.maxLife || durationMs));
          if (elapsed < (p.delay || 0)) continue;
          p.update && p.update(pt, elapsed);
          // パーティクルごとに合成モードを指定できるようにする（'lighter'＝加算合成で発光感を出す）
          ctx.save();
          ctx.globalCompositeOperation = p.blend || 'source-over';
          p.draw(ctx, pt);
          ctx.restore();
        }
        if (elapsed < durationMs) {
          requestAnimationFrame(frame);
        } else {
          ctx.clearRect(0, 0, w, h);
          resolve();
        }
      }
      requestAnimationFrame(frame);
    });
  }

  // ============================================================
  // タイプ別シーン定義
  // 各関数は (particles配列, w, h) を受け取り、パーティクルを push する。
  // 中心 (w/2, h/2) がポケモンの中心とみなす。
  // 各タイプごとに「通常版」と「豪華版（威力90超）」の2つを専用設計する。
  // ============================================================

  // ---- むし (bug)：鋭い緑の切り裂き線 + 舞う葉 ----
  function spawnBug(particles, w, h) {
    const cx = w / 2, cy = h / 2;
    // 交差する斬撃ライン
    for (let i = 0; i < 3; i++) {
      const angle = rand(-0.5, 0.5) + i * 0.35 - 0.35;
      particles.push({
        delay: i * 60,
        maxLife: 260,
        draw(ctx, t) {
          const len = Math.max(w, h) * 0.9;
          const a = angle;
          const prog = easeOutCubic(t);
          ctx.save();
          ctx.translate(cx, cy);
          ctx.rotate(a);
          const alpha = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
          ctx.strokeStyle = rgba('#8fd13f', alpha);
          ctx.lineWidth = 5 * (1 - t * 0.4);
          ctx.shadowColor = rgba('#c8ff6e', 0.9);
          ctx.shadowBlur = 10;
          ctx.beginPath();
          ctx.moveTo(-len / 2 * prog, 0);
          ctx.lineTo(len / 2 * prog, 0);
          ctx.stroke();
          ctx.restore();
        }
      });
    }
    // 舞う葉のかけら
    for (let i = 0; i < 10; i++) {
      const a0 = rand(0, Math.PI * 2);
      const dist = rand(10, Math.max(w, h) * 0.4);
      particles.push({
        delay: rand(0, 120),
        maxLife: rand(360, 520),
        rot: rand(0, Math.PI * 2),
        draw(ctx, t) {
          const e = easeOutCubic(t);
          const x = cx + Math.cos(a0) * dist * e;
          const y = cy + Math.sin(a0) * dist * e - e * 14;
          const alpha = 1 - t;
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(this.rot + t * 4);
          ctx.fillStyle = rgba(pick(['#7fc93f', '#a8e063', '#4f9d2a']), alpha);
          ctx.beginPath();
          ctx.ellipse(0, 0, 6, 3, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      });
    }
  }

  // ---- むし・豪華版：巨大な虫の羽根の残像が乱舞し、無数の斬撃十字が炸裂する ----
  function spawnBugBig(particles, w, h) {
    const cx = w / 2, cy = h / 2;
    const R = Math.max(w, h);
    // 中心の毒々しい緑色フラッシュ
    particles.push({
      maxLife: 260,
      draw(ctx, t) {
        const alpha = t < 0.25 ? (t / 0.25) * 0.8 : 0.8 * (1 - (t - 0.25) / 0.75);
        const r = lerp(R * 0.1, R * 0.7, easeOutCubic(t));
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        grad.addColorStop(0, rgba('#eaffb0', alpha));
        grad.addColorStop(0.5, rgba('#8fd13f', alpha * 0.8));
        grad.addColorStop(1, 'rgba(143,209,63,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    // 巨大な交差斬撃（通常版の3本→7本、全方位に伸びる）
    for (let i = 0; i < 7; i++) {
      const angle = (Math.PI * i) / 7 + rand(-0.15, 0.15);
      particles.push({
        delay: i * 45,
        maxLife: 380,
        draw(ctx, t) {
          const len = R * 1.15;
          const prog = easeOutCubic(t);
          ctx.save();
          ctx.translate(cx, cy);
          ctx.rotate(angle);
          const alpha = t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4;
          ctx.strokeStyle = rgba('#a8ff5a', alpha);
          ctx.lineWidth = 6 * (1 - t * 0.5);
          ctx.shadowColor = rgba('#c8ff6e', 1);
          ctx.shadowBlur = 16;
          ctx.beginPath();
          ctx.moveTo(-len / 2 * prog, 0);
          ctx.lineTo(len / 2 * prog, 0);
          ctx.stroke();
          ctx.restore();
        }
      });
    }
    // 大きな半透明の羽根が2枚、左右に大きく展開して消える
    for (let side = -1; side <= 1; side += 2) {
      particles.push({
        delay: 60,
        maxLife: 460,
        draw(ctx, t) {
          const e = easeOutCubic(t);
          const alpha = Math.sin(Math.PI * clamp01(t)) * 0.55;
          ctx.save();
          ctx.translate(cx + side * R * 0.22 * e, cy - R * 0.05 * e);
          ctx.rotate(side * (0.5 + t * 0.4));
          ctx.fillStyle = rgba('#c8ff6e', alpha);
          ctx.beginPath();
          ctx.ellipse(0, 0, R * 0.22 * e, R * 0.11 * e, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      });
    }
    // 舞い散る葉と鱗粉（数を大幅増量、遠くまで飛ぶ）
    for (let i = 0; i < 26; i++) {
      const a0 = rand(0, Math.PI * 2);
      const dist = rand(R * 0.15, R * 0.85);
      particles.push({
        delay: rand(0, 260),
        maxLife: rand(420, 620),
        rot: rand(0, Math.PI * 2),
        col: pick(['#7fc93f', '#a8e063', '#4f9d2a', '#d8ff8a']),
        size: rand(5, 9),
        draw(ctx, t) {
          const e = easeOutCubic(t);
          const x = cx + Math.cos(a0) * dist * e;
          const y = cy + Math.sin(a0) * dist * e - e * 22;
          const alpha = Math.sin(Math.PI * clamp01(t));
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(this.rot + t * 5);
          ctx.fillStyle = rgba(this.col, alpha);
          ctx.shadowColor = rgba('#c8ff6e', 0.7);
          ctx.shadowBlur = 6;
          ctx.beginPath();
          ctx.ellipse(0, 0, this.size, this.size * 0.45, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      });
    }
  }



  // ---- あく (dark)：闇の波動と紫の靄 ----
  function spawnDark(particles, w, h) {
    const cx = w / 2, cy = h / 2;
    particles.push({
      maxLife: 420,
      draw(ctx, t) {
        const r = lerp(6, Math.max(w, h) * 0.55, easeOutCubic(t));
        const alpha = (1 - t) * 0.85;
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        grad.addColorStop(0, rgba('#2b1a3a', alpha));
        grad.addColorStop(0.6, rgba('#1a0f26', alpha * 0.7));
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    for (let i = 0; i < 8; i++) {
      const a0 = rand(0, Math.PI * 2);
      particles.push({
        delay: rand(40, 200),
        maxLife: rand(300, 420),
        draw(ctx, t) {
          const dist = lerp(4, Math.max(w, h) * 0.42, easeOutCubic(t));
          const x = cx + Math.cos(a0) * dist;
          const y = cy + Math.sin(a0) * dist;
          const alpha = (1 - t) * 0.8;
          ctx.fillStyle = rgba('#6a3fa0', alpha);
          ctx.beginPath();
          ctx.arc(x, y, lerp(10, 2, t), 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }
  }

  // ---- あく・豪華版：画面を覆う漆黒の暗雲から無数の爪痕が走り、深紅の目が光る ----
  function spawnDarkBig(particles, w, h) {
    const cx = w / 2, cy = h / 2;
    const R = Math.max(w, h);
    // 画面全体を覆う暗黒の靄（大きく・長く残る）
    particles.push({
      maxLife: 620,
      draw(ctx, t) {
        const alpha = (t < 0.3 ? t / 0.3 : 1 - (t - 0.3) / 0.7) * 0.55;
        ctx.fillStyle = rgba('#0d0714', alpha);
        ctx.fillRect(0, 0, w, h);
        const r = lerp(R * 0.15, R * 0.8, easeOutCubic(t));
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        grad.addColorStop(0, rgba('#3a2050', alpha * 1.3));
        grad.addColorStop(1, 'rgba(20,10,30,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    // 深紅に光る目が中心に浮かび上がる
    particles.push({
      delay: 100,
      maxLife: 340,
      draw(ctx, t) {
        const alpha = Math.sin(Math.PI * clamp01(t));
        ctx.fillStyle = rgba('#ff3b3b', alpha);
        ctx.shadowColor = rgba('#ff0000', 1);
        ctx.shadowBlur = 16;
        ctx.beginPath();
        ctx.ellipse(cx - 16, cy, 5, 7, 0, 0, Math.PI * 2);
        ctx.ellipse(cx + 16, cy, 5, 7, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    // 巨大な爪痕（3本セットを2回、時差で交差させる）
    for (let group = 0; group < 2; group++) {
      const baseAngle = group === 0 ? -0.5 : 2.5;
      for (let i = 0; i < 3; i++) {
        const angle = baseAngle + i * 0.22;
        particles.push({
          delay: group * 140 + i * 30,
          maxLife: 320,
          draw(ctx, t) {
            const len = R * 1.1;
            const prog = easeOutCubic(t);
            ctx.save();
            ctx.translate(cx, cy);
            ctx.rotate(angle);
            const alpha = t < 0.5 ? 1 : 1 - (t - 0.5) / 0.5;
            ctx.strokeStyle = rgba('#8a4fd6', alpha);
            ctx.lineWidth = 5 * (1 - t * 0.4);
            ctx.shadowColor = rgba('#ff3b3b', 0.7);
            ctx.shadowBlur = 10;
            ctx.beginPath();
            ctx.moveTo(-len / 2 * prog, 0);
            ctx.lineTo(len / 2 * prog, 0);
            ctx.stroke();
            ctx.restore();
          }
        });
      }
    }
    // 飛び散る紫の靄玉（数を増量・大きめ）
    for (let i = 0; i < 16; i++) {
      const a0 = rand(0, Math.PI * 2);
      particles.push({
        delay: rand(60, 280),
        maxLife: rand(360, 520),
        draw(ctx, t) {
          const dist = lerp(4, R * 0.6, easeOutCubic(t));
          const x = cx + Math.cos(a0) * dist;
          const y = cy + Math.sin(a0) * dist;
          const alpha = (1 - t) * 0.85;
          ctx.fillStyle = rgba('#6a3fa0', alpha);
          ctx.shadowColor = rgba('#3a2050', 0.9);
          ctx.shadowBlur = 8;
          ctx.beginPath();
          ctx.arc(x, y, lerp(13, 2, t), 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }
  }



  // ---- ドラゴン (dragon)：青紫の衝撃波リング + 螺旋光 ----
  function spawnDragon(particles, w, h) {
    const cx = w / 2, cy = h / 2;
    for (let i = 0; i < 2; i++) {
      particles.push({
        delay: i * 100,
        maxLife: 380,
        draw(ctx, t) {
          const r = lerp(4, Math.max(w, h) * 0.6, easeOutCubic(t));
          const alpha = (1 - t);
          ctx.strokeStyle = rgba('#5b6ee6', alpha);
          ctx.lineWidth = 4 * (1 - t);
          ctx.shadowColor = rgba('#8f6bff', 0.9);
          ctx.shadowBlur = 14;
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.stroke();
        }
      });
    }
    // 螺旋の光点
    const nSpiral = 16;
    for (let i = 0; i < nSpiral; i++) {
      particles.push({
        delay: i * 12,
        maxLife: 320,
        idx: i,
        draw(ctx, t) {
          const ang = this.idx * 0.9 + t * 6;
          const r = lerp(Math.max(w, h) * 0.42, 2, easeInCubic(t));
          const x = cx + Math.cos(ang) * r;
          const y = cy + Math.sin(ang) * r * 0.85;
          const alpha = 1 - t;
          ctx.fillStyle = rgba('#b39dff', alpha);
          ctx.beginPath();
          ctx.arc(x, y, 3.5, 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }
  }

  // ---- ドラゴン・豪華版：巨大な竜の顎の衝撃波と青紫の螺旋光が渦を巻く ----
  function spawnDragonBig(particles, w, h) {
    const cx = w / 2, cy = h / 2;
    const R = Math.max(w, h);
    // 中心の巨大フラッシュ
    particles.push({
      maxLife: 260,
      draw(ctx, t) {
        const alpha = t < 0.25 ? (t / 0.25) * 0.85 : 0.85 * (1 - (t - 0.25) / 0.75);
        const r = lerp(R * 0.1, R * 0.65, easeOutCubic(t));
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        grad.addColorStop(0, rgba('#e6e9ff', alpha));
        grad.addColorStop(0.5, rgba('#6f7cf0', alpha * 0.85));
        grad.addColorStop(1, 'rgba(111,124,240,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    // 4重の拡大衝撃波リング
    for (let i = 0; i < 4; i++) {
      particles.push({
        delay: i * 80,
        maxLife: 460,
        draw(ctx, t) {
          const r = lerp(4, R * 0.85, easeOutCubic(t));
          const alpha = (1 - t);
          ctx.strokeStyle = rgba('#5b6ee6', alpha);
          ctx.lineWidth = 5 * (1 - t * 0.6);
          ctx.shadowColor = rgba('#8f6bff', 1);
          ctx.shadowBlur = 18;
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.stroke();
        }
      });
    }
    // 二重の巨大な螺旋光点（内向き・外向き）
    const nSpiral = 28;
    for (let i = 0; i < nSpiral; i++) {
      const outward = i % 2 === 0;
      particles.push({
        delay: i * 10,
        maxLife: 420,
        idx: i,
        draw(ctx, t) {
          const ang = this.idx * 0.7 + t * (outward ? 8 : -8);
          const r = outward ? lerp(4, R * 0.55, easeOutCubic(t)) : lerp(R * 0.55, 4, easeInCubic(t));
          const x = cx + Math.cos(ang) * r;
          const y = cy + Math.sin(ang) * r * 0.85;
          const alpha = Math.sin(Math.PI * clamp01(t));
          ctx.fillStyle = rgba(outward ? '#b39dff' : '#6f7cf0', alpha);
          ctx.shadowColor = rgba('#8f6bff', 0.9);
          ctx.shadowBlur = 8;
          ctx.beginPath();
          ctx.arc(x, y, 4, 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }
    // 竜の顎が噛みつくような巨大な三日月形の衝撃波（左右から）
    for (let side = -1; side <= 1; side += 2) {
      particles.push({
        delay: 40,
        maxLife: 300,
        draw(ctx, t) {
          const e = easeOutCubic(t);
          const alpha = 1 - t;
          ctx.save();
          ctx.translate(cx + side * R * 0.05, cy);
          ctx.scale(side, 1);
          ctx.strokeStyle = rgba('#dcd6ff', alpha);
          ctx.lineWidth = 8 * (1 - t * 0.5);
          ctx.shadowColor = rgba('#8f6bff', 1);
          ctx.shadowBlur = 14;
          ctx.beginPath();
          ctx.arc(0, 0, R * 0.5 * e, -0.6, 0.6);
          ctx.stroke();
          ctx.restore();
        }
      });
    }
  }


  function zigzagPath(ctx, x0, y0, x1, y1, segments, jitter) {
    ctx.moveTo(x0, y0);
    for (let i = 1; i < segments; i++) {
      const t = i / segments;
      const x = lerp(x0, x1, t) + rand(-jitter, jitter);
      const y = lerp(y0, y1, t) + rand(-jitter, jitter);
      ctx.lineTo(x, y);
    }
    ctx.lineTo(x1, y1);
  }
  function spawnElectric(particles, w, h) {
    const cx = w / 2, cy = h / 2;
    for (let i = 0; i < 4; i++) {
      const angle = rand(0, Math.PI * 2);
      const len = rand(Math.max(w, h) * 0.3, Math.max(w, h) * 0.55);
      const x1 = cx + Math.cos(angle) * len;
      const y1 = cy + Math.sin(angle) * len;
      particles.push({
        delay: i * 45,
        maxLife: 180,
        draw(ctx, t) {
          const alpha = t < 0.5 ? 1 : 1 - (t - 0.5) / 0.5;
          ctx.strokeStyle = rgba('#fff59d', alpha);
          ctx.lineWidth = 3;
          ctx.shadowColor = rgba('#ffe74c', 1);
          ctx.shadowBlur = 16;
          ctx.beginPath();
          zigzagPath(ctx, cx, cy, x1, y1, 5, 6);
          ctx.stroke();
          ctx.strokeStyle = rgba('#ffffff', alpha * 0.9);
          ctx.lineWidth = 1.2;
          ctx.stroke();
        }
      });
    }
    // 中心のフラッシュ
    particles.push({
      maxLife: 150,
      draw(ctx, t) {
        const alpha = (1 - t) * 0.9;
        const r = lerp(4, 46, easeOutCubic(t));
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        grad.addColorStop(0, rgba('#fffde7', alpha));
        grad.addColorStop(1, 'rgba(255,235,59,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }

  // ---- でんき・豪華版：巨大な雷が全方位に落ち、画面が白く発光する ----
  function spawnElectricBig(particles, w, h) {
    const cx = w / 2, cy = h / 2;
    const R = Math.max(w, h);
    // 全方位への巨大稲妻（8方向）
    for (let i = 0; i < 8; i++) {
      const angle = (Math.PI * 2 * i) / 8 + rand(-0.15, 0.15);
      const len = R * rand(0.6, 0.95);
      const x1 = cx + Math.cos(angle) * len;
      const y1 = cy + Math.sin(angle) * len;
      particles.push({
        delay: i * 25,
        maxLife: 220,
        draw(ctx, t) {
          const alpha = t < 0.4 ? 1 : 1 - (t - 0.4) / 0.6;
          ctx.strokeStyle = rgba('#fff59d', alpha);
          ctx.lineWidth = 4;
          ctx.shadowColor = rgba('#ffe74c', 1);
          ctx.shadowBlur = 22;
          ctx.beginPath();
          zigzagPath(ctx, cx, cy, x1, y1, 6, 9);
          ctx.stroke();
          ctx.strokeStyle = rgba('#ffffff', alpha * 0.95);
          ctx.lineWidth = 1.6;
          ctx.stroke();
        }
      });
    }
    // 画面全体が瞬間的に白くフラッシュ（2回明滅）
    for (let i = 0; i < 2; i++) {
      particles.push({
        delay: i * 110,
        maxLife: 90,
        draw(ctx, t) {
          const alpha = (1 - t) * 0.5;
          ctx.fillStyle = rgba('#fffde7', alpha);
          ctx.fillRect(0, 0, w, h);
        }
      });
    }
    // 中心の巨大フラッシュ球
    particles.push({
      maxLife: 240,
      draw(ctx, t) {
        const alpha = (1 - t) * 0.95;
        const r = lerp(4, R * 0.5, easeOutCubic(t));
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        grad.addColorStop(0, rgba('#ffffff', alpha));
        grad.addColorStop(0.5, rgba('#fffde7', alpha * 0.8));
        grad.addColorStop(1, 'rgba(255,235,59,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    // 弾け飛ぶ小スパーク（多数）
    for (let i = 0; i < 18; i++) {
      const a0 = rand(0, Math.PI * 2);
      const dist = rand(R * 0.2, R * 0.7);
      particles.push({
        delay: rand(0, 200),
        maxLife: rand(180, 300),
        a0, dist,
        draw(ctx, t) {
          const e = easeOutCubic(t);
          const x = cx + Math.cos(a0) * dist * e;
          const y = cy + Math.sin(a0) * dist * e;
          const alpha = 1 - t;
          ctx.fillStyle = rgba('#ffe74c', alpha);
          ctx.shadowColor = rgba('#fff59d', 1);
          ctx.shadowBlur = 10;
          ctx.beginPath();
          ctx.arc(x, y, 2.5, 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }
  }


  function drawStar(ctx, x, y, r, rot) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const a = (Math.PI * 2 * i) / 5 - Math.PI / 2;
      const a2 = a + Math.PI / 5;
      ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      ctx.lineTo(Math.cos(a2) * r * 0.45, Math.sin(a2) * r * 0.45);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  function spawnFairy(particles, w, h) {
    const cx = w / 2, cy = h / 2;
    for (let i = 0; i < 12; i++) {
      const a0 = rand(0, Math.PI * 2);
      const dist = rand(Math.max(w, h) * 0.15, Math.max(w, h) * 0.45);
      particles.push({
        delay: rand(0, 160),
        maxLife: rand(320, 460),
        rot: rand(0, Math.PI * 2),
        col: pick(['#ff9fd6', '#ffd6ef', '#ffffff']),
        draw(ctx, t) {
          const e = easeOutCubic(t);
          const x = cx + Math.cos(a0) * dist * e;
          const y = cy + Math.sin(a0) * dist * e - Math.sin(t * Math.PI) * 8;
          const alpha = Math.sin(Math.PI * clamp01(t * 1.1));
          ctx.fillStyle = rgba(this.col, alpha);
          ctx.shadowColor = rgba('#ffd6ef', 0.8);
          ctx.shadowBlur = 8;
          drawStar(ctx, x, y, lerp(7, 3, t), this.rot + t * 3);
        }
      });
    }
  }

  // ---- フェアリー・豪華版：無数の星屑がハート状の軌道を描き、虹色の光輪が広がる ----
  function spawnFairyBig(particles, w, h) {
    const cx = w / 2, cy = h / 2;
    const R = Math.max(w, h);
    // 中心の淡いピンクフラッシュ
    particles.push({
      maxLife: 280,
      draw(ctx, t) {
        const alpha = t < 0.3 ? (t / 0.3) * 0.8 : 0.8 * (1 - (t - 0.3) / 0.7);
        const r = lerp(R * 0.1, R * 0.6, easeOutCubic(t));
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        grad.addColorStop(0, rgba('#fff0fa', alpha));
        grad.addColorStop(0.5, rgba('#ff9fd6', alpha * 0.8));
        grad.addColorStop(1, 'rgba(255,159,214,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    // 虹色の光輪リング（多色）
    const ringColors = ['#ff9fd6', '#ffe98a', '#b3ffe0', '#c8b3ff'];
    for (let i = 0; i < 4; i++) {
      particles.push({
        delay: i * 60,
        maxLife: 460,
        col: ringColors[i],
        draw(ctx, t) {
          const r = lerp(4, R * 0.6, easeOutCubic(t));
          const alpha = (1 - t) * 0.75;
          ctx.strokeStyle = rgba(this.col, alpha);
          ctx.lineWidth = 3.5;
          ctx.shadowColor = rgba(this.col, 0.9);
          ctx.shadowBlur = 12;
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.stroke();
        }
      });
    }
    // 大量の星が渦を巻きながら舞う（通常版12個→24個、外周まで広がる）
    for (let i = 0; i < 24; i++) {
      const a0 = rand(0, Math.PI * 2);
      const dist = rand(R * 0.15, R * 0.75);
      particles.push({
        delay: rand(0, 260),
        maxLife: rand(420, 620),
        a0, dist,
        rot: rand(0, Math.PI * 2),
        col: pick(['#ff9fd6', '#ffd6ef', '#ffffff', '#ffe98a']),
        draw(ctx, t) {
          const e = easeOutCubic(t);
          const spiral = this.a0 + t * 2.5;
          const x = cx + Math.cos(spiral) * this.dist * e;
          const y = cy + Math.sin(spiral) * this.dist * e - Math.sin(t * Math.PI) * 10;
          const alpha = Math.sin(Math.PI * clamp01(t * 1.1));
          ctx.fillStyle = rgba(this.col, alpha);
          ctx.shadowColor = rgba('#ffd6ef', 0.9);
          ctx.shadowBlur = 10;
          drawStar(ctx, x, y, lerp(9, 3, t), this.rot + t * 4);
        }
      });
    }
  }


  function spawnFighting(particles, w, h) {
    const cx = w / 2, cy = h / 2;
    particles.push({
      maxLife: 200,
      draw(ctx, t) {
        const alpha = (1 - t);
        const r = lerp(6, Math.max(w, h) * 0.35, easeOutCubic(t));
        ctx.strokeStyle = rgba('#ff6a3d', alpha);
        ctx.lineWidth = 6 * (1 - t);
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
      }
    });
    const n = 8;
    for (let i = 0; i < n; i++) {
      const angle = (Math.PI * 2 * i) / n + rand(-0.2, 0.2);
      particles.push({
        delay: 40,
        maxLife: 220,
        draw(ctx, t) {
          const len = lerp(6, Math.max(w, h) * 0.42, easeOutCubic(t));
          const alpha = 1 - t;
          const x0 = cx + Math.cos(angle) * len * 0.35;
          const y0 = cy + Math.sin(angle) * len * 0.35;
          const x1 = cx + Math.cos(angle) * len;
          const y1 = cy + Math.sin(angle) * len;
          ctx.strokeStyle = rgba('#d6431f', alpha);
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.moveTo(x0, y0);
          ctx.lineTo(x1, y1);
          ctx.stroke();
        }
      });
    }
  }

  // ---- かくとう・豪華版：巨大な拳の衝撃波が3連続で炸裂し、赤い闘気が渦巻く ----
  function spawnFightingBig(particles, w, h) {
    const cx = w / 2, cy = h / 2;
    const R = Math.max(w, h);
    // 3連続の巨大衝撃リング（インパクトを時間差で重ねる）
    for (let hit = 0; hit < 3; hit++) {
      particles.push({
        delay: hit * 130,
        maxLife: 220,
        draw(ctx, t) {
          const alpha = (1 - t);
          const r = lerp(6, R * 0.55, easeOutCubic(t));
          ctx.strokeStyle = rgba('#ff6a3d', alpha);
          ctx.lineWidth = 9 * (1 - t);
          ctx.shadowColor = rgba('#ffb347', 0.9);
          ctx.shadowBlur = 14;
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.stroke();
        }
      });
      // 各インパクトの瞬間フラッシュ
      particles.push({
        delay: hit * 130,
        maxLife: 110,
        draw(ctx, t) {
          const alpha = (1 - t) * 0.7;
          ctx.fillStyle = rgba('#ffdcc8', alpha);
          const r = lerp(4, R * 0.3, easeOutCubic(t));
          const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
          grad.addColorStop(0, rgba('#fff2e0', alpha));
          grad.addColorStop(1, 'rgba(255,106,61,0)');
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }
    // 放射状の衝撃線（通常版8本→14本、太く長く）
    const n = 14;
    for (let i = 0; i < n; i++) {
      const angle = (Math.PI * 2 * i) / n + rand(-0.15, 0.15);
      particles.push({
        delay: 60 + (i % 3) * 30,
        maxLife: 320,
        draw(ctx, t) {
          const len = lerp(6, R * 0.65, easeOutCubic(t));
          const alpha = 1 - t;
          const x0 = cx + Math.cos(angle) * len * 0.3;
          const y0 = cy + Math.sin(angle) * len * 0.3;
          const x1 = cx + Math.cos(angle) * len;
          const y1 = cy + Math.sin(angle) * len;
          ctx.strokeStyle = rgba('#d6431f', alpha);
          ctx.lineWidth = 5;
          ctx.shadowColor = rgba('#ff6a3d', 0.8);
          ctx.shadowBlur = 8;
          ctx.beginPath();
          ctx.moveTo(x0, y0);
          ctx.lineTo(x1, y1);
          ctx.stroke();
        }
      });
    }
    // 渦巻く赤い闘気の粒子
    for (let i = 0; i < 12; i++) {
      const a0 = rand(0, Math.PI * 2);
      particles.push({
        delay: rand(0, 200),
        maxLife: rand(300, 440),
        a0,
        draw(ctx, t) {
          const dist = lerp(R * 0.45, R * 0.1, easeInCubic(t));
          const ang = a0 + t * 5;
          const x = cx + Math.cos(ang) * dist;
          const y = cy + Math.sin(ang) * dist;
          const alpha = Math.sin(Math.PI * clamp01(t));
          ctx.fillStyle = rgba('#ff8a5a', alpha);
          ctx.shadowColor = rgba('#ff6a3d', 0.9);
          ctx.shadowBlur = 8;
          ctx.beginPath();
          ctx.arc(x, y, 4, 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }
  }


  function spawnFire(particles, w, h) {
    const cx = w / 2, cy = h * 0.62;
    // ベースの炎の塊
    for (let i = 0; i < 22; i++) {
      const x0 = cx + rand(-w * 0.16, w * 0.16);
      particles.push({
        delay: rand(0, 140),
        maxLife: rand(300, 480),
        x0,
        drift: rand(-8, 8),
        size: rand(10, 22),
        col: pick(['#ff7a1a', '#ff4d2e', '#ffb347', '#ffe17a']),
        draw(ctx, t) {
          const rise = h * 0.5;
          const y = cy - easeOutCubic(t) * rise;
          const x = this.x0 + this.drift * t + Math.sin(t * 8 + this.x0) * 4;
          const alpha = t < 0.15 ? t / 0.15 : (1 - (t - 0.15) / 0.85);
          const size = this.size * (1 - t * 0.55);
          const grad = ctx.createRadialGradient(x, y, 0, x, y, size);
          grad.addColorStop(0, rgba('#fff6cf', alpha));
          grad.addColorStop(0.35, rgba(this.col, alpha * 0.95));
          grad.addColorStop(1, 'rgba(255,60,0,0)');
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(x, y, size, 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }
    // 火の粉（上に流れる小さい光点）
    for (let i = 0; i < 10; i++) {
      const x0 = cx + rand(-w * 0.22, w * 0.22);
      particles.push({
        delay: rand(60, 220),
        maxLife: rand(260, 380),
        x0,
        draw(ctx, t) {
          const y = cy - easeOutCubic(t) * h * 0.65;
          const x = this.x0 + Math.sin(t * 10 + this.x0) * 5;
          const alpha = 1 - t;
          ctx.fillStyle = rgba('#ffd23f', alpha);
          ctx.beginPath();
          ctx.arc(x, y, 2, 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }
  }

  // ---- ほのお・豪華版：巨大な火柱が噴き上がり、画面全体に火の粉が舞う ----
  function spawnFireBig(particles, w, h) {
    const cx = w / 2, cy = h * 0.68;
    const R = Math.max(w, h);
    // 地面からの巨大フラッシュ（噴き上がりの起点）
    particles.push({
      maxLife: 260,
      draw(ctx, t) {
        const alpha = (1 - t) * 0.85;
        const r = lerp(w * 0.1, w * 0.5, easeOutCubic(t));
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        grad.addColorStop(0, rgba('#fff6cf', alpha));
        grad.addColorStop(0.4, rgba('#ff7a1a', alpha * 0.9));
        grad.addColorStop(1, 'rgba(255,60,0,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    // 巨大な火柱の塊（通常版22個→40個、より高く、より大きく）
    for (let i = 0; i < 40; i++) {
      const x0 = cx + rand(-w * 0.24, w * 0.24);
      particles.push({
        delay: rand(0, 220),
        maxLife: rand(380, 620),
        x0,
        drift: rand(-12, 12),
        size: rand(14, 30),
        col: pick(['#ff7a1a', '#ff4d2e', '#ffb347', '#ffe17a']),
        draw(ctx, t) {
          const rise = h * 0.75;
          const y = cy - easeOutCubic(t) * rise;
          const x = this.x0 + this.drift * t + Math.sin(t * 8 + this.x0) * 6;
          const alpha = t < 0.12 ? t / 0.12 : (1 - (t - 0.12) / 0.88);
          const size = this.size * (1 - t * 0.5);
          const grad = ctx.createRadialGradient(x, y, 0, x, y, size);
          grad.addColorStop(0, rgba('#fff6cf', alpha));
          grad.addColorStop(0.35, rgba(this.col, alpha * 0.95));
          grad.addColorStop(1, 'rgba(255,60,0,0)');
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(x, y, size, 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }
    // 渦を巻きながら舞い上がる火の粉（増量）
    for (let i = 0; i < 22; i++) {
      const x0 = cx + rand(-w * 0.3, w * 0.3);
      particles.push({
        delay: rand(60, 320),
        maxLife: rand(340, 500),
        x0,
        draw(ctx, t) {
          const y = cy - easeOutCubic(t) * h * 0.9;
          const x = this.x0 + Math.sin(t * 10 + this.x0) * 8;
          const alpha = 1 - t;
          ctx.fillStyle = rgba('#ffd23f', alpha);
          ctx.shadowColor = rgba('#ff7a1a', 0.9);
          ctx.shadowBlur = 8;
          ctx.beginPath();
          ctx.arc(x, y, 2.5, 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }
    // 左右に広がる爆発の輪
    particles.push({
      delay: 20,
      maxLife: 340,
      draw(ctx, t) {
        const r = lerp(w * 0.1, R * 0.6, easeOutCubic(t));
        const alpha = (1 - t) * 0.7;
        ctx.strokeStyle = rgba('#ff9142', alpha);
        ctx.lineWidth = 6 * (1 - t * 0.6);
        ctx.shadowColor = rgba('#ffb347', 0.9);
        ctx.shadowBlur = 14;
        ctx.beginPath();
        ctx.ellipse(cx, cy, r, r * 0.4, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    });
  }


  function spawnFlying(particles, w, h) {
    const cx = w / 2, cy = h / 2;
    for (let i = 0; i < 3; i++) {
      particles.push({
        delay: i * 60,
        maxLife: 360,
        idx: i,
        draw(ctx, t) {
          const alpha = (1 - t) * 0.85;
          const rBase = lerp(10, Math.max(w, h) * 0.5, easeOutCubic(t));
          ctx.strokeStyle = rgba('#eaf6ff', alpha);
          ctx.lineWidth = 3;
          ctx.beginPath();
          for (let a = 0; a <= Math.PI * 1.6; a += 0.15) {
            const r = rBase * (a / (Math.PI * 1.6));
            const x = cx + Math.cos(a + this.idx * 2 + t * 3) * r;
            const y = cy + Math.sin(a + this.idx * 2 + t * 3) * r * 0.6;
            if (a === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          }
          ctx.stroke();
        }
      });
    }
    // 舞う羽根
    for (let i = 0; i < 6; i++) {
      const a0 = rand(0, Math.PI * 2);
      particles.push({
        delay: rand(0, 150),
        maxLife: rand(320, 440),
        a0,
        rot: rand(0, Math.PI * 2),
        draw(ctx, t) {
          const dist = lerp(6, Math.max(w, h) * 0.4, easeOutCubic(t));
          const x = cx + Math.cos(this.a0 + t * 2) * dist;
          const y = cy + Math.sin(this.a0 + t * 2) * dist * 0.7;
          const alpha = 1 - t;
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(this.rot + t * 5);
          ctx.fillStyle = rgba('#ffffff', alpha * 0.9);
          ctx.beginPath();
          ctx.ellipse(0, 0, 7, 3, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      });
    }
  }

  // ---- ひこう・豪華版：巨大な竜巻状の風の渦が画面を覆い、羽根が無数に舞い散る ----
  function spawnFlyingBig(particles, w, h) {
    const cx = w / 2, cy = h / 2;
    const R = Math.max(w, h);
    // 中心の白いフラッシュ
    particles.push({
      maxLife: 240,
      draw(ctx, t) {
        const alpha = t < 0.3 ? (t / 0.3) * 0.7 : 0.7 * (1 - (t - 0.3) / 0.7);
        const r = lerp(R * 0.1, R * 0.5, easeOutCubic(t));
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        grad.addColorStop(0, rgba('#ffffff', alpha));
        grad.addColorStop(1, 'rgba(234,246,255,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    // 巨大な渦巻き風（通常版3本→6本、画面外周まで届く）
    for (let i = 0; i < 6; i++) {
      particles.push({
        delay: i * 45,
        maxLife: 480,
        idx: i,
        draw(ctx, t) {
          const alpha = (1 - t) * 0.85;
          const rBase = lerp(10, R * 0.75, easeOutCubic(t));
          ctx.strokeStyle = rgba('#eaf6ff', alpha);
          ctx.lineWidth = 3.5;
          ctx.shadowColor = rgba('#c8e8ff', 0.8);
          ctx.shadowBlur = 8;
          ctx.beginPath();
          for (let a = 0; a <= Math.PI * 2; a += 0.15) {
            const r = rBase * (a / (Math.PI * 2));
            const x = cx + Math.cos(a + this.idx * 1.2 + t * 4) * r;
            const y = cy + Math.sin(a + this.idx * 1.2 + t * 4) * r * 0.6;
            if (a === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          }
          ctx.stroke();
        }
      });
    }
    // 舞い散る羽根（大量、画面全体に広がる）
    for (let i = 0; i < 18; i++) {
      const a0 = rand(0, Math.PI * 2);
      particles.push({
        delay: rand(0, 260),
        maxLife: rand(420, 600),
        a0,
        rot: rand(0, Math.PI * 2),
        draw(ctx, t) {
          const dist = lerp(6, R * 0.7, easeOutCubic(t));
          const x = cx + Math.cos(this.a0 + t * 2.5) * dist;
          const y = cy + Math.sin(this.a0 + t * 2.5) * dist * 0.7;
          const alpha = 1 - t;
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(this.rot + t * 6);
          ctx.fillStyle = rgba('#ffffff', alpha * 0.9);
          ctx.beginPath();
          ctx.ellipse(0, 0, 9, 4, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      });
    }
  }


  function spawnGhost(particles, w, h) {
    const cx = w / 2, cy = h / 2;
    for (let i = 0; i < 6; i++) {
      const a0 = rand(0, Math.PI * 2);
      particles.push({
        delay: rand(0, 160),
        maxLife: rand(340, 480),
        a0,
        draw(ctx, t) {
          const dist = lerp(4, Math.max(w, h) * 0.32, easeOutCubic(t));
          const x = cx + Math.cos(this.a0) * dist;
          const y = cy + Math.sin(this.a0) * dist - t * 14;
          const alpha = Math.sin(Math.PI * clamp01(t)) * 0.75;
          const r = lerp(6, 20, t);
          const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
          grad.addColorStop(0, rgba('#a97bd6', alpha));
          grad.addColorStop(1, 'rgba(120,80,160,0)');
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }
    // 光る目
    particles.push({
      delay: 40,
      maxLife: 260,
      draw(ctx, t) {
        const alpha = Math.sin(Math.PI * clamp01(t));
        ctx.fillStyle = rgba('#e6d6ff', alpha);
        ctx.shadowColor = rgba('#c78bff', 1);
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.ellipse(cx - 9, cy, 3.5, 5, 0, 0, Math.PI * 2);
        ctx.ellipse(cx + 9, cy, 3.5, 5, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }

  // ---- ゴースト・豪華版：巨大な顔が浮かび上がり、無数の霊魂が渦を巻いて包み込む ----
  function spawnGhostBig(particles, w, h) {
    const cx = w / 2, cy = h / 2;
    const R = Math.max(w, h);
    // 画面を覆う紫の靄
    particles.push({
      maxLife: 500,
      draw(ctx, t) {
        const alpha = (t < 0.3 ? t / 0.3 : 1 - (t - 0.3) / 0.7) * 0.5;
        const r = lerp(R * 0.15, R * 0.75, easeOutCubic(t));
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        grad.addColorStop(0, rgba('#a97bd6', alpha));
        grad.addColorStop(1, 'rgba(80,50,110,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    // 巨大な光る目（通常版より大きく、二段階で拡大）
    particles.push({
      delay: 60,
      maxLife: 380,
      draw(ctx, t) {
        const alpha = Math.sin(Math.PI * clamp01(t));
        const scale = 1 + easeOutCubic(t) * 0.6;
        ctx.fillStyle = rgba('#e6d6ff', alpha);
        ctx.shadowColor = rgba('#c78bff', 1);
        ctx.shadowBlur = 18;
        ctx.beginPath();
        ctx.ellipse(cx - 16 * scale, cy, 5 * scale, 7.5 * scale, 0, 0, Math.PI * 2);
        ctx.ellipse(cx + 16 * scale, cy, 5 * scale, 7.5 * scale, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    // 大量の漂う霊魂の靄玉（通常版6個→16個、より遠く・より長く）
    for (let i = 0; i < 16; i++) {
      const a0 = rand(0, Math.PI * 2);
      particles.push({
        delay: rand(0, 300),
        maxLife: rand(420, 620),
        a0,
        draw(ctx, t) {
          const dist = lerp(4, R * 0.55, easeOutCubic(t));
          const x = cx + Math.cos(this.a0 + t * 1.5) * dist;
          const y = cy + Math.sin(this.a0 + t * 1.5) * dist - t * 24;
          const alpha = Math.sin(Math.PI * clamp01(t)) * 0.8;
          const r = lerp(8, 28, t);
          const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
          grad.addColorStop(0, rgba('#a97bd6', alpha));
          grad.addColorStop(1, 'rgba(120,80,160,0)');
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }
    // ぞわりと伸びる手のような紫の触手
    for (let i = 0; i < 5; i++) {
      const angle = rand(0, Math.PI * 2);
      particles.push({
        delay: rand(80, 220),
        maxLife: 340,
        draw(ctx, t) {
          const len = lerp(4, R * 0.4, easeOutCubic(t));
          const alpha = (1 - t) * 0.7;
          ctx.save();
          ctx.translate(cx, cy);
          ctx.rotate(angle);
          ctx.strokeStyle = rgba('#8a5ab0', alpha);
          ctx.lineWidth = 6 * (1 - t * 0.5);
          ctx.shadowColor = rgba('#c78bff', 0.8);
          ctx.shadowBlur = 10;
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.quadraticCurveTo(len * 0.5, Math.sin(t * 5) * 20, len, Math.sin(t * 5 + 1) * 10);
          ctx.stroke();
          ctx.restore();
        }
      });
    }
  }


  function spawnGrass(particles, w, h) {
    const cx = w / 2, cy = h / 2;
    for (let i = 0; i < 14; i++) {
      const a0 = rand(0, Math.PI * 2);
      const dist = rand(Math.max(w, h) * 0.12, Math.max(w, h) * 0.42);
      particles.push({
        delay: rand(0, 150),
        maxLife: rand(340, 480),
        a0, dist,
        rot: rand(0, Math.PI * 2),
        col: pick(['#5cb85c', '#7fd35f', '#3f9142']),
        draw(ctx, t) {
          const e = easeOutCubic(t);
          const x = cx + Math.cos(this.a0) * this.dist * e;
          const y = cy + Math.sin(this.a0) * this.dist * e + Math.sin(t * Math.PI) * -6;
          const alpha = Math.sin(Math.PI * clamp01(t));
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(this.rot + t * 3);
          ctx.fillStyle = rgba(this.col, alpha);
          ctx.beginPath();
          ctx.ellipse(0, 0, 8, 3.5, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      });
    }
    // 中心のポワッとした緑グロー
    particles.push({
      maxLife: 300,
      draw(ctx, t) {
        const alpha = (1 - t) * 0.5;
        const r = lerp(6, Math.max(w, h) * 0.3, easeOutCubic(t));
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        grad.addColorStop(0, rgba('#b6ff8f', alpha));
        grad.addColorStop(1, 'rgba(90,200,90,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }

  // ---- くさ・豪華版：巨大な花が咲き誇り、無数の葉とつるの渦が画面を包む ----
  function spawnGrassBig(particles, w, h) {
    const cx = w / 2, cy = h / 2;
    const R = Math.max(w, h);
    // 中心の巨大な緑グロー（花が開くイメージ）
    particles.push({
      maxLife: 380,
      draw(ctx, t) {
        const alpha = (1 - t) * 0.65;
        const r = lerp(6, R * 0.55, easeOutCubic(t));
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        grad.addColorStop(0, rgba('#eaffb0', alpha));
        grad.addColorStop(0.5, rgba('#7fd35f', alpha * 0.8));
        grad.addColorStop(1, 'rgba(90,200,90,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    // 花びら状の8方向の花弁エフェクト
    const petals = 8;
    for (let i = 0; i < petals; i++) {
      const angle = (Math.PI * 2 * i) / petals;
      particles.push({
        delay: 40,
        maxLife: 400,
        draw(ctx, t) {
          const dist = lerp(4, R * 0.32, easeOutCubic(t));
          const x = cx + Math.cos(angle) * dist;
          const y = cy + Math.sin(angle) * dist;
          const alpha = Math.sin(Math.PI * clamp01(t));
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(angle);
          ctx.fillStyle = rgba(pick(['#ff9fd6', '#ffffff', '#ffe98a']), alpha);
          ctx.beginPath();
          ctx.ellipse(0, 0, 12, 6, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      });
    }
    // 舞い散る葉（通常版14個→28個、渦を巻きながら広がる）
    for (let i = 0; i < 28; i++) {
      const a0 = rand(0, Math.PI * 2);
      const dist = rand(R * 0.1, R * 0.7);
      particles.push({
        delay: rand(0, 260),
        maxLife: rand(420, 620),
        a0, dist,
        rot: rand(0, Math.PI * 2),
        col: pick(['#5cb85c', '#7fd35f', '#3f9142', '#b6ff8f']),
        draw(ctx, t) {
          const e = easeOutCubic(t);
          const spiral = this.a0 + t * 2;
          const x = cx + Math.cos(spiral) * this.dist * e;
          const y = cy + Math.sin(spiral) * this.dist * e + Math.sin(t * Math.PI) * -10;
          const alpha = Math.sin(Math.PI * clamp01(t));
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(this.rot + t * 4);
          ctx.fillStyle = rgba(this.col, alpha);
          ctx.beginPath();
          ctx.ellipse(0, 0, 10, 4.5, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      });
    }
    // からみつくつる（弧を描く緑の線）
    for (let i = 0; i < 3; i++) {
      const angle = rand(0, Math.PI * 2);
      particles.push({
        delay: i * 70,
        maxLife: 420,
        draw(ctx, t) {
          const len = lerp(4, R * 0.5, easeOutCubic(t));
          const alpha = (1 - t) * 0.8;
          ctx.save();
          ctx.translate(cx, cy);
          ctx.rotate(angle);
          ctx.strokeStyle = rgba('#3f9142', alpha);
          ctx.lineWidth = 5;
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.quadraticCurveTo(len * 0.5, Math.sin(t * 6) * 26, len, Math.sin(t * 6 + 1) * 14);
          ctx.stroke();
          ctx.restore();
        }
      });
    }
  }


  function spawnGround(particles, w, h) {
    const cx = w / 2, cy = h * 0.88;
    // 地割れの光る亀裂
    for (let i = 0; i < 5; i++) {
      const angle = rand(-1.2, 1.2);
      particles.push({
        delay: i * 20,
        maxLife: 260,
        draw(ctx, t) {
          const len = lerp(4, w * 0.5, easeOutCubic(t));
          const alpha = 1 - t;
          ctx.save();
          ctx.translate(cx, cy);
          ctx.rotate(angle);
          ctx.strokeStyle = rgba('#a97a3a', alpha);
          ctx.lineWidth = 3;
          ctx.beginPath();
          zigzagPath(ctx, 0, 0, len, 0, 4, 4);
          ctx.stroke();
          ctx.restore();
        }
      });
    }
    // 舞い上がる岩の破片
    for (let i = 0; i < 14; i++) {
      const x0 = cx + rand(-w * 0.35, w * 0.35);
      const vUp = rand(h * 0.35, h * 0.6);
      particles.push({
        delay: rand(0, 120),
        maxLife: rand(300, 460),
        x0, vUp,
        vx: rand(-1, 1) * 20,
        size: rand(4, 9),
        rot: rand(0, Math.PI * 2),
        col: pick(['#a0783c', '#8a6530', '#c79a5b']),
        draw(ctx, t) {
          const rise = easeOutCubic(Math.min(1, t * 1.6));
          const fall = t > 0.55 ? easeInCubic((t - 0.55) / 0.45) : 0;
          const y = cy - this.vUp * rise + fall * this.vUp * 0.7;
          const x = this.x0 + this.vx * t;
          const alpha = 1 - Math.max(0, (t - 0.75) / 0.25);
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(this.rot + t * 6);
          ctx.fillStyle = rgba(this.col, alpha);
          ctx.fillRect(-this.size / 2, -this.size / 2, this.size, this.size);
          ctx.restore();
        }
      });
    }
    // 砂煙
    particles.push({
      maxLife: 380,
      draw(ctx, t) {
        const alpha = (1 - t) * 0.5;
        const r = lerp(8, w * 0.5, easeOutCubic(t));
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        grad.addColorStop(0, rgba('#c9a06a', alpha));
        grad.addColorStop(1, 'rgba(160,120,60,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.ellipse(cx, cy, r, r * 0.4, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }

  // ---- じめん・豪華版：画面全体に地割れが走り、巨大な土煙と岩塊が吹き飛ぶ ----
  function spawnGroundBig(particles, w, h) {
    const cx = w / 2, cy = h * 0.88;
    const R = Math.max(w, h);
    // 画面いっぱいの地割れ亀裂（通常版5本→9本、扇状に大きく広がる）
    for (let i = 0; i < 9; i++) {
      const angle = rand(-1.4, 1.4);
      particles.push({
        delay: i * 15,
        maxLife: 300,
        draw(ctx, t) {
          const len = lerp(4, w * 0.75, easeOutCubic(t));
          const alpha = 1 - t;
          ctx.save();
          ctx.translate(cx, cy);
          ctx.rotate(angle);
          ctx.strokeStyle = rgba('#a97a3a', alpha);
          ctx.lineWidth = 4;
          ctx.shadowColor = rgba('#ffcf7a', 0.7);
          ctx.shadowBlur = 6;
          ctx.beginPath();
          zigzagPath(ctx, 0, 0, len, 0, 5, 5);
          ctx.stroke();
          ctx.restore();
        }
      });
    }
    // 巨大な砂煙（通常版より濃く・大きく）
    particles.push({
      maxLife: 500,
      draw(ctx, t) {
        const alpha = (1 - t) * 0.65;
        const r = lerp(8, w * 0.75, easeOutCubic(t));
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        grad.addColorStop(0, rgba('#c9a06a', alpha));
        grad.addColorStop(1, 'rgba(160,120,60,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.ellipse(cx, cy, r, r * 0.45, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    // 舞い上がる岩の破片（通常版14個→28個、より高く、より大きい岩も混ぜる）
    for (let i = 0; i < 28; i++) {
      const x0 = cx + rand(-w * 0.45, w * 0.45);
      const vUp = rand(h * 0.45, h * 0.85);
      particles.push({
        delay: rand(0, 200),
        maxLife: rand(340, 540),
        x0, vUp,
        vx: rand(-1, 1) * 30,
        size: rand(5, 14),
        rot: rand(0, Math.PI * 2),
        col: pick(['#a0783c', '#8a6530', '#c79a5b']),
        draw(ctx, t) {
          const rise = easeOutCubic(Math.min(1, t * 1.6));
          const fall = t > 0.55 ? easeInCubic((t - 0.55) / 0.45) : 0;
          const y = cy - this.vUp * rise + fall * this.vUp * 0.7;
          const x = this.x0 + this.vx * t;
          const alpha = 1 - Math.max(0, (t - 0.75) / 0.25);
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(this.rot + t * 6);
          ctx.fillStyle = rgba(this.col, alpha);
          ctx.fillRect(-this.size / 2, -this.size / 2, this.size, this.size);
          ctx.restore();
        }
      });
    }
    // 地面から突き上がる巨岩の柱（新規演出）
    for (let i = 0; i < 3; i++) {
      const x0 = cx + rand(-w * 0.28, w * 0.28);
      particles.push({
        delay: i * 60,
        maxLife: 360,
        x0,
        draw(ctx, t) {
          const rise = easeOutCubic(Math.min(1, t * 1.8));
          const h0 = h * 0.45 * rise;
          const alpha = 1 - Math.max(0, (t - 0.6) / 0.4);
          ctx.fillStyle = rgba('#8a6530', alpha);
          ctx.fillRect(this.x0 - 9, cy - h0, 18, h0);
          ctx.fillStyle = rgba('#c79a5b', alpha);
          ctx.fillRect(this.x0 - 9, cy - h0, 18, 6);
          ctx.restore && ctx.restore();
        }
      });
    }
  }


  function spawnIce(particles, w, h) {
    const cx = w / 2, cy = h / 2;
    particles.push({
      maxLife: 260,
      draw(ctx, t) {
        const alpha = (1 - t) * 0.7;
        const r = lerp(4, Math.max(w, h) * 0.4, easeOutCubic(t));
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        grad.addColorStop(0, rgba('#eafcff', alpha));
        grad.addColorStop(1, 'rgba(140,220,240,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    for (let i = 0; i < 10; i++) {
      const a0 = rand(0, Math.PI * 2);
      particles.push({
        delay: rand(0, 120),
        maxLife: rand(280, 400),
        a0,
        rot: rand(0, Math.PI * 2),
        draw(ctx, t) {
          const dist = lerp(4, Math.max(w, h) * 0.42, easeOutCubic(t));
          const x = cx + Math.cos(this.a0) * dist;
          const y = cy + Math.sin(this.a0) * dist;
          const alpha = 1 - t;
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(this.rot + t * 2);
          ctx.strokeStyle = rgba('#bdf1ff', alpha);
          ctx.lineWidth = 1.6;
          ctx.shadowColor = rgba('#8fe9ff', 0.8);
          ctx.shadowBlur = 6;
          for (let k = 0; k < 3; k++) {
            ctx.save();
            ctx.rotate((Math.PI / 3) * k);
            ctx.beginPath();
            ctx.moveTo(0, -6);
            ctx.lineTo(0, 6);
            ctx.moveTo(-3, -3);
            ctx.lineTo(0, -6);
            ctx.lineTo(3, -3);
            ctx.stroke();
            ctx.restore();
          }
          ctx.restore();
        }
      });
    }
  }

  // ---- こおり・豪華版：巨大な氷結フラッシュと無数の結晶が画面を覆う ----
  function spawnIceBig(particles, w, h) {
    const cx = w / 2, cy = h / 2;
    const R = Math.max(w, h);
    // 中心の巨大な氷結フラッシュ
    particles.push({
      maxLife: 340,
      draw(ctx, t) {
        const alpha = (1 - t) * 0.85;
        const r = lerp(4, R * 0.65, easeOutCubic(t));
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        grad.addColorStop(0, rgba('#ffffff', alpha));
        grad.addColorStop(0.5, rgba('#eafcff', alpha * 0.85));
        grad.addColorStop(1, 'rgba(140,220,240,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    // 亀裂状に走る氷の閃光（8方向）
    for (let i = 0; i < 8; i++) {
      const angle = (Math.PI * 2 * i) / 8 + rand(-0.1, 0.1);
      particles.push({
        delay: i * 25,
        maxLife: 260,
        draw(ctx, t) {
          const len = lerp(4, R * 0.65, easeOutCubic(t));
          const alpha = t < 0.5 ? 1 : 1 - (t - 0.5) / 0.5;
          ctx.strokeStyle = rgba('#bdf1ff', alpha);
          ctx.lineWidth = 3;
          ctx.shadowColor = rgba('#8fe9ff', 1);
          ctx.shadowBlur = 14;
          ctx.beginPath();
          zigzagPath(ctx, cx, cy, cx + Math.cos(angle) * len, cy + Math.sin(angle) * len, 4, 5);
          ctx.stroke();
        }
      });
    }
    // 大量の氷の結晶（通常版10個→22個、より大きく回転）
    for (let i = 0; i < 22; i++) {
      const a0 = rand(0, Math.PI * 2);
      particles.push({
        delay: rand(0, 240),
        maxLife: rand(360, 540),
        a0,
        rot: rand(0, Math.PI * 2),
        scale: rand(0.8, 1.6),
        draw(ctx, t) {
          const dist = lerp(4, R * 0.6, easeOutCubic(t));
          const x = cx + Math.cos(this.a0) * dist;
          const y = cy + Math.sin(this.a0) * dist;
          const alpha = 1 - t;
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(this.rot + t * 2);
          ctx.scale(this.scale, this.scale);
          ctx.strokeStyle = rgba('#bdf1ff', alpha);
          ctx.lineWidth = 1.8;
          ctx.shadowColor = rgba('#8fe9ff', 0.9);
          ctx.shadowBlur = 8;
          for (let k = 0; k < 3; k++) {
            ctx.save();
            ctx.rotate((Math.PI / 3) * k);
            ctx.beginPath();
            ctx.moveTo(0, -8);
            ctx.lineTo(0, 8);
            ctx.moveTo(-4, -4);
            ctx.lineTo(0, -8);
            ctx.lineTo(4, -4);
            ctx.stroke();
            ctx.restore();
          }
          ctx.restore();
        }
      });
    }
    // 舞い散る細かい雪片
    for (let i = 0; i < 14; i++) {
      const x0 = rand(0, w);
      particles.push({
        delay: rand(0, 260),
        maxLife: rand(400, 560),
        x0,
        draw(ctx, t) {
          const y = t * h;
          const x = this.x0 + Math.sin(t * 6 + this.x0) * 10;
          const alpha = Math.sin(Math.PI * clamp01(t));
          ctx.fillStyle = rgba('#eafcff', alpha);
          ctx.beginPath();
          ctx.arc(x, y, 2, 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }
  }


  function spawnNormal(particles, w, h) {
    const cx = w / 2, cy = h / 2;
    particles.push({
      maxLife: 260,
      draw(ctx, t) {
        const r = lerp(6, Math.max(w, h) * 0.5, easeOutCubic(t));
        const alpha = (1 - t) * 0.8;
        ctx.strokeStyle = rgba('#f2f2ec', alpha);
        ctx.lineWidth = 4 * (1 - t);
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
      }
    });
    for (let i = 0; i < 3; i++) {
      const angle = rand(-0.4, 0.4) + i * 0.3 - 0.3;
      particles.push({
        delay: i * 50,
        maxLife: 220,
        draw(ctx, t) {
          const len = Math.max(w, h) * 0.7;
          const prog = easeOutCubic(t);
          const alpha = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
          ctx.save();
          ctx.translate(cx, cy);
          ctx.rotate(angle);
          ctx.strokeStyle = rgba('#ffffff', alpha);
          ctx.lineWidth = 4 * (1 - t * 0.4);
          ctx.shadowColor = rgba('#dcdccb', 0.8);
          ctx.shadowBlur = 8;
          ctx.beginPath();
          ctx.moveTo(-len / 2 * prog, 0);
          ctx.lineTo(len / 2 * prog, 0);
          ctx.stroke();
          ctx.restore();
        }
      });
    }
  }

  // ---- ノーマル・豪華版：純白の光が全方位に炸裂し、巨大な光の輪が広がる ----
  function spawnNormalBig(particles, w, h) {
    const cx = w / 2, cy = h / 2;
    const R = Math.max(w, h);
    // 中心の純白フラッシュ
    particles.push({
      maxLife: 240,
      draw(ctx, t) {
        const alpha = t < 0.25 ? (t / 0.25) * 0.85 : 0.85 * (1 - (t - 0.25) / 0.75);
        const r = lerp(R * 0.1, R * 0.6, easeOutCubic(t));
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        grad.addColorStop(0, rgba('#ffffff', alpha));
        grad.addColorStop(1, 'rgba(242,242,236,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    // 三重の拡大衝撃波
    for (let i = 0; i < 3; i++) {
      particles.push({
        delay: i * 70,
        maxLife: 420,
        draw(ctx, t) {
          const r = lerp(6, R * 0.75, easeOutCubic(t));
          const alpha = (1 - t) * 0.85;
          ctx.strokeStyle = rgba('#f2f2ec', alpha);
          ctx.lineWidth = 5 * (1 - t * 0.6);
          ctx.shadowColor = rgba('#ffffff', 0.7);
          ctx.shadowBlur = 12;
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.stroke();
        }
      });
    }
    // 放射状の光の斬撃（通常版3本→6本）
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI * i) / 6 + rand(-0.1, 0.1);
      particles.push({
        delay: i * 40,
        maxLife: 280,
        draw(ctx, t) {
          const len = R * 0.95;
          const prog = easeOutCubic(t);
          const alpha = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
          ctx.save();
          ctx.translate(cx, cy);
          ctx.rotate(angle);
          ctx.strokeStyle = rgba('#ffffff', alpha);
          ctx.lineWidth = 4 * (1 - t * 0.4);
          ctx.shadowColor = rgba('#dcdccb', 0.9);
          ctx.shadowBlur = 10;
          ctx.beginPath();
          ctx.moveTo(-len / 2 * prog, 0);
          ctx.lineTo(len / 2 * prog, 0);
          ctx.stroke();
          ctx.restore();
        }
      });
    }
    // 飛び散る光の粒子
    for (let i = 0; i < 16; i++) {
      const a0 = rand(0, Math.PI * 2);
      const dist = rand(R * 0.2, R * 0.65);
      particles.push({
        delay: rand(0, 200),
        maxLife: rand(280, 420),
        draw(ctx, t) {
          const e = easeOutCubic(t);
          const x = cx + Math.cos(a0) * dist * e;
          const y = cy + Math.sin(a0) * dist * e;
          const alpha = 1 - t;
          ctx.fillStyle = rgba('#ffffff', alpha);
          ctx.shadowColor = rgba('#f2f2ec', 0.8);
          ctx.shadowBlur = 8;
          ctx.beginPath();
          ctx.arc(x, y, 3, 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }
  }


  function spawnPoison(particles, w, h) {
    const cx = w / 2, cy = h * 0.6;
    particles.push({
      maxLife: 360,
      draw(ctx, t) {
        const alpha = (1 - t) * 0.5;
        const r = lerp(8, Math.max(w, h) * 0.4, easeOutCubic(t));
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        grad.addColorStop(0, rgba('#c15adf', alpha));
        grad.addColorStop(1, 'rgba(120,40,150,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    for (let i = 0; i < 12; i++) {
      const x0 = cx + rand(-w * 0.22, w * 0.22);
      particles.push({
        delay: rand(0, 160),
        maxLife: rand(320, 460),
        x0,
        size: rand(4, 10),
        wob: rand(0, Math.PI * 2),
        col: pick(['#a020c0', '#c060e0', '#7a2aa0']),
        draw(ctx, t) {
          const y = cy - easeOutCubic(t) * h * 0.55;
          const x = this.x0 + Math.sin(t * 6 + this.wob) * 6;
          const alpha = Math.sin(Math.PI * clamp01(t)) * 0.85;
          ctx.strokeStyle = rgba(this.col, alpha);
          ctx.fillStyle = rgba(this.col, alpha * 0.5);
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(x, y, this.size * (1 - t * 0.3), 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
      });
    }
  }

  // ---- どく・豪華版：紫の毒の沼が画面を覆い、巨大な気泡が次々と弾ける ----
  function spawnPoisonBig(particles, w, h) {
    const cx = w / 2, cy = h * 0.55;
    const R = Math.max(w, h);
    // 画面を覆う毒の靄（濃く・長く残る）
    particles.push({
      maxLife: 560,
      draw(ctx, t) {
        const alpha = (t < 0.25 ? t / 0.25 : 1 - (t - 0.25) / 0.75) * 0.55;
        const r = lerp(8, R * 0.75, easeOutCubic(t));
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        grad.addColorStop(0, rgba('#c15adf', alpha));
        grad.addColorStop(1, 'rgba(120,40,150,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    // 大きく弾ける毒泡（通常版12個→26個、より大きく）
    for (let i = 0; i < 26; i++) {
      const x0 = cx + rand(-w * 0.32, w * 0.32);
      particles.push({
        delay: rand(0, 260),
        maxLife: rand(380, 560),
        x0,
        size: rand(6, 16),
        wob: rand(0, Math.PI * 2),
        col: pick(['#a020c0', '#c060e0', '#7a2aa0', '#e0a0ff']),
        draw(ctx, t) {
          const y = cy - easeOutCubic(t) * h * 0.65;
          const x = this.x0 + Math.sin(t * 6 + this.wob) * 8;
          const alpha = Math.sin(Math.PI * clamp01(t)) * 0.9;
          ctx.strokeStyle = rgba(this.col, alpha);
          ctx.fillStyle = rgba(this.col, alpha * 0.5);
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(x, y, this.size * (1 - t * 0.3), 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          // 弾ける瞬間の小さな飛沫（気泡が消える直前）
          if (t > 0.85) {
            const burstAlpha = (1 - (t - 0.85) / 0.15) * 0.6;
            for (let k = 0; k < 3; k++) {
              const ba = (Math.PI * 2 * k) / 3;
              ctx.fillStyle = rgba(this.col, burstAlpha);
              ctx.beginPath();
              ctx.arc(x + Math.cos(ba) * this.size, y + Math.sin(ba) * this.size, 2, 0, Math.PI * 2);
              ctx.fill();
            }
          }
        }
      });
    }
    // 毒の紋章のような同心リング
    for (let i = 0; i < 2; i++) {
      particles.push({
        delay: i * 100,
        maxLife: 400,
        draw(ctx, t) {
          const r = lerp(4, R * 0.4, easeOutCubic(t));
          const alpha = (1 - t) * 0.7;
          ctx.strokeStyle = rgba('#c15adf', alpha);
          ctx.lineWidth = 4;
          ctx.shadowColor = rgba('#e0a0ff', 0.9);
          ctx.shadowBlur = 10;
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.stroke();
        }
      });
    }
  }


  function spawnPsychic(particles, w, h) {
    const cx = w / 2, cy = h / 2;
    for (let i = 0; i < 3; i++) {
      particles.push({
        delay: i * 90,
        maxLife: 420,
        draw(ctx, t) {
          const r = lerp(4, Math.max(w, h) * 0.55, easeOutCubic(t));
          const alpha = (1 - t) * 0.8;
          ctx.strokeStyle = rgba('#e0559e', alpha);
          ctx.lineWidth = 3;
          ctx.shadowColor = rgba('#ff9fd6', 0.8);
          ctx.shadowBlur = 12;
          ctx.beginPath();
          for (let a = 0; a < Math.PI * 2; a += 0.1) {
            const wobble = Math.sin(a * 5 + t * 10) * 3;
            const rr = r + wobble;
            const x = cx + Math.cos(a) * rr;
            const y = cy + Math.sin(a) * rr;
            if (a === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          }
          ctx.closePath();
          ctx.stroke();
        }
      });
    }
    // 浮遊する光点（念力の粒）
    for (let i = 0; i < 8; i++) {
      const a0 = rand(0, Math.PI * 2);
      particles.push({
        delay: rand(20, 160),
        maxLife: rand(320, 440),
        a0,
        draw(ctx, t) {
          const dist = lerp(6, Math.max(w, h) * 0.36, easeOutCubic(t));
          const ang = this.a0 + t * 3;
          const x = cx + Math.cos(ang) * dist;
          const y = cy + Math.sin(ang) * dist;
          const alpha = 1 - t;
          ctx.fillStyle = rgba('#f0a8d8', alpha);
          ctx.shadowColor = rgba('#ff9fd6', 0.8);
          ctx.shadowBlur = 8;
          ctx.beginPath();
          ctx.arc(x, y, 3, 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }
  }

  // ---- エスパー・豪華版：巨大な念力の波紋が幾重にも歪み、光る第三の目が浮かぶ ----
  function spawnPsychicBig(particles, w, h) {
    const cx = w / 2, cy = h / 2;
    const R = Math.max(w, h);
    // 中心にピンク〜紫のフラッシュ
    particles.push({
      maxLife: 280,
      draw(ctx, t) {
        const alpha = t < 0.3 ? (t / 0.3) * 0.8 : 0.8 * (1 - (t - 0.3) / 0.7);
        const r = lerp(R * 0.1, R * 0.55, easeOutCubic(t));
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        grad.addColorStop(0, rgba('#ffe0f4', alpha));
        grad.addColorStop(0.5, rgba('#e0559e', alpha * 0.8));
        grad.addColorStop(1, 'rgba(224,85,158,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    // 光る第三の目
    particles.push({
      delay: 80,
      maxLife: 320,
      draw(ctx, t) {
        const alpha = Math.sin(Math.PI * clamp01(t));
        ctx.fillStyle = rgba('#ffffff', alpha);
        ctx.shadowColor = rgba('#ff9fd6', 1);
        ctx.shadowBlur = 18;
        ctx.beginPath();
        ctx.ellipse(cx, cy, 10, 5, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = rgba('#e0559e', alpha);
        ctx.beginPath();
        ctx.arc(cx, cy, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    // 大きく歪む波紋リング（通常版3本→5本、より大きく歪む）
    for (let i = 0; i < 5; i++) {
      particles.push({
        delay: i * 70,
        maxLife: 480,
        draw(ctx, t) {
          const r = lerp(4, R * 0.7, easeOutCubic(t));
          const alpha = (1 - t) * 0.85;
          ctx.strokeStyle = rgba('#e0559e', alpha);
          ctx.lineWidth = 3.5;
          ctx.shadowColor = rgba('#ff9fd6', 0.9);
          ctx.shadowBlur = 14;
          ctx.beginPath();
          for (let a = 0; a < Math.PI * 2; a += 0.08) {
            const wobble = Math.sin(a * 6 + t * 12) * 5;
            const rr = r + wobble;
            const x = cx + Math.cos(a) * rr;
            const y = cy + Math.sin(a) * rr;
            if (a === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          }
          ctx.closePath();
          ctx.stroke();
        }
      });
    }
    // 浮遊する念力の光点（通常版8個→18個）
    for (let i = 0; i < 18; i++) {
      const a0 = rand(0, Math.PI * 2);
      particles.push({
        delay: rand(20, 260),
        maxLife: rand(360, 520),
        a0,
        draw(ctx, t) {
          const dist = lerp(6, R * 0.55, easeOutCubic(t));
          const ang = this.a0 + t * 4;
          const x = cx + Math.cos(ang) * dist;
          const y = cy + Math.sin(ang) * dist;
          const alpha = 1 - t;
          ctx.fillStyle = rgba('#f0a8d8', alpha);
          ctx.shadowColor = rgba('#ff9fd6', 0.9);
          ctx.shadowBlur = 10;
          ctx.beginPath();
          ctx.arc(x, y, 4, 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }
  }


  function spawnRock(particles, w, h) {
    const cx = w / 2, cy = h / 2;
    particles.push({
      maxLife: 180,
      draw(ctx, t) {
        const r = lerp(6, Math.max(w, h) * 0.32, easeOutCubic(t));
        const alpha = (1 - t);
        ctx.fillStyle = rgba('#8a6a45', alpha * 0.5);
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    for (let i = 0; i < 12; i++) {
      const angle = rand(0, Math.PI * 2);
      const dist = rand(Math.max(w, h) * 0.2, Math.max(w, h) * 0.48);
      particles.push({
        delay: rand(0, 90),
        maxLife: rand(280, 420),
        angle, dist,
        size: rand(6, 13),
        rot: rand(0, Math.PI * 2),
        col: pick(['#8a6a45', '#6e5335', '#a58257']),
        draw(ctx, t) {
          const e = easeOutCubic(t);
          const fall = t > 0.5 ? easeInCubic((t - 0.5) / 0.5) : 0;
          const x = cx + Math.cos(this.angle) * this.dist * e;
          const y = cy + Math.sin(this.angle) * this.dist * e + fall * 24;
          const alpha = 1 - Math.max(0, (t - 0.7) / 0.3);
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(this.rot + t * 5);
          ctx.fillStyle = rgba(this.col, alpha);
          ctx.beginPath();
          ctx.moveTo(-this.size / 2, this.size / 2);
          ctx.lineTo(0, -this.size / 2);
          ctx.lineTo(this.size / 2, this.size / 2);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        }
      });
    }
  }

  // ---- いわ・豪華版：巨大な岩塊が連続で叩きつけられ、地面が砕け散る ----
  function spawnRockBig(particles, w, h) {
    const cx = w / 2, cy = h / 2;
    const R = Math.max(w, h);
    // 巨大な茶色フラッシュ
    particles.push({
      maxLife: 220,
      draw(ctx, t) {
        const r = lerp(6, R * 0.5, easeOutCubic(t));
        const alpha = (1 - t) * 0.6;
        ctx.fillStyle = rgba('#8a6a45', alpha * 0.7);
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    // 連続落石インパクト（3連撃）
    for (let hit = 0; hit < 3; hit++) {
      const x0 = cx + rand(-w * 0.2, w * 0.2);
      particles.push({
        delay: hit * 120,
        maxLife: 200,
        x0,
        draw(ctx, t) {
          const alpha = (1 - t) * 0.8;
          const r = lerp(4, w * 0.28, easeOutCubic(t));
          ctx.strokeStyle = rgba('#6e5335', alpha);
          ctx.lineWidth = 6 * (1 - t);
          ctx.beginPath();
          ctx.arc(this.x0, cy, r, 0, Math.PI * 2);
          ctx.stroke();
        }
      });
    }
    // 飛び散る岩塊（通常版12個→26個、大きめの塊も混ぜる）
    for (let i = 0; i < 26; i++) {
      const angle = rand(0, Math.PI * 2);
      const dist = rand(R * 0.15, R * 0.7);
      particles.push({
        delay: rand(0, 160),
        maxLife: rand(320, 500),
        angle, dist,
        size: rand(7, 20),
        rot: rand(0, Math.PI * 2),
        col: pick(['#8a6a45', '#6e5335', '#a58257']),
        draw(ctx, t) {
          const e = easeOutCubic(t);
          const fall = t > 0.5 ? easeInCubic((t - 0.5) / 0.5) : 0;
          const x = cx + Math.cos(this.angle) * this.dist * e;
          const y = cy + Math.sin(this.angle) * this.dist * e + fall * 34;
          const alpha = 1 - Math.max(0, (t - 0.7) / 0.3);
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(this.rot + t * 6);
          ctx.fillStyle = rgba(this.col, alpha);
          ctx.beginPath();
          ctx.moveTo(-this.size / 2, this.size / 2);
          ctx.lineTo(0, -this.size / 2);
          ctx.lineTo(this.size / 2, this.size / 2);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        }
      });
    }
    // 舞い上がる砂埃
    particles.push({
      maxLife: 420,
      draw(ctx, t) {
        const alpha = (1 - t) * 0.4;
        const r = lerp(8, R * 0.55, easeOutCubic(t));
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        grad.addColorStop(0, rgba('#a58257', alpha));
        grad.addColorStop(1, 'rgba(140,110,70,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.ellipse(cx, cy, r, r * 0.5, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }


  function spawnSteel(particles, w, h) {
    const cx = w / 2, cy = h / 2;
    particles.push({
      maxLife: 260,
      draw(ctx, t) {
        const r = lerp(4, Math.max(w, h) * 0.5, easeOutCubic(t));
        const alpha = (1 - t) * 0.7;
        ctx.strokeStyle = rgba('#c7d3da', alpha);
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
      }
    });
    // 十字型のきらめき（メタリックフラッシュ）
    for (let i = 0; i < 4; i++) {
      const angle = (Math.PI / 4) + (Math.PI / 2) * i;
      particles.push({
        delay: 30,
        maxLife: 240,
        draw(ctx, t) {
          const len = lerp(4, Math.max(w, h) * 0.4, easeOutCubic(t));
          const alpha = 1 - t;
          const x0 = cx - Math.cos(angle) * len;
          const y0 = cy - Math.sin(angle) * len;
          const x1 = cx + Math.cos(angle) * len;
          const y1 = cy + Math.sin(angle) * len;
          ctx.strokeStyle = rgba('#eef4f7', alpha);
          ctx.lineWidth = 2.4;
          ctx.shadowColor = rgba('#ffffff', 0.9);
          ctx.shadowBlur = 10;
          ctx.beginPath();
          ctx.moveTo(x0, y0);
          ctx.lineTo(x1, y1);
          ctx.stroke();
        }
      });
    }
    // 金属片
    for (let i = 0; i < 6; i++) {
      const a0 = rand(0, Math.PI * 2);
      particles.push({
        delay: rand(20, 140),
        maxLife: rand(260, 360),
        a0,
        rot: rand(0, Math.PI * 2),
        draw(ctx, t) {
          const dist = lerp(4, Math.max(w, h) * 0.38, easeOutCubic(t));
          const x = cx + Math.cos(this.a0) * dist;
          const y = cy + Math.sin(this.a0) * dist;
          const alpha = 1 - t;
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(this.rot + t * 4);
          ctx.fillStyle = rgba('#dfe8ec', alpha);
          ctx.fillRect(-4, -1.5, 8, 3);
          ctx.restore();
        }
      });
    }
  }

  // ---- はがね・豪華版：銀の巨大な刃が交差し、鋭いメタリックフラッシュが連続で輝く ----
  function spawnSteelBig(particles, w, h) {
    const cx = w / 2, cy = h / 2;
    const R = Math.max(w, h);
    // 中心の銀白フラッシュ
    particles.push({
      maxLife: 240,
      draw(ctx, t) {
        const alpha = t < 0.25 ? (t / 0.25) * 0.9 : 0.9 * (1 - (t - 0.25) / 0.75);
        const r = lerp(R * 0.08, R * 0.55, easeOutCubic(t));
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        grad.addColorStop(0, rgba('#ffffff', alpha));
        grad.addColorStop(0.5, rgba('#c7d3da', alpha * 0.85));
        grad.addColorStop(1, 'rgba(199,211,218,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    // 拡大するリング（通常版1本→3本）
    for (let i = 0; i < 3; i++) {
      particles.push({
        delay: i * 60,
        maxLife: 340,
        draw(ctx, t) {
          const r = lerp(4, R * 0.65, easeOutCubic(t));
          const alpha = (1 - t) * 0.75;
          ctx.strokeStyle = rgba('#c7d3da', alpha);
          ctx.lineWidth = 4;
          ctx.shadowColor = rgba('#ffffff', 0.7);
          ctx.shadowBlur = 10;
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.stroke();
        }
      });
    }
    // 巨大な刃のようなメタリックフラッシュ十字（通常版4本→8本）
    for (let i = 0; i < 8; i++) {
      const angle = (Math.PI / 8) + (Math.PI / 4) * i;
      particles.push({
        delay: (i % 4) * 25,
        maxLife: 280,
        draw(ctx, t) {
          const len = lerp(4, R * 0.55, easeOutCubic(t));
          const alpha = 1 - t;
          const x0 = cx - Math.cos(angle) * len;
          const y0 = cy - Math.sin(angle) * len;
          const x1 = cx + Math.cos(angle) * len;
          const y1 = cy + Math.sin(angle) * len;
          ctx.strokeStyle = rgba('#eef4f7', alpha);
          ctx.lineWidth = 3;
          ctx.shadowColor = rgba('#ffffff', 1);
          ctx.shadowBlur = 14;
          ctx.beginPath();
          ctx.moveTo(x0, y0);
          ctx.lineTo(x1, y1);
          ctx.stroke();
        }
      });
    }
    // 飛び散る金属片（通常版6個→16個）
    for (let i = 0; i < 16; i++) {
      const a0 = rand(0, Math.PI * 2);
      particles.push({
        delay: rand(20, 220),
        maxLife: rand(300, 440),
        a0,
        rot: rand(0, Math.PI * 2),
        draw(ctx, t) {
          const dist = lerp(4, R * 0.55, easeOutCubic(t));
          const x = cx + Math.cos(this.a0) * dist;
          const y = cy + Math.sin(this.a0) * dist;
          const alpha = 1 - t;
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(this.rot + t * 5);
          ctx.fillStyle = rgba('#dfe8ec', alpha);
          ctx.shadowColor = rgba('#ffffff', 0.9);
          ctx.shadowBlur = 6;
          ctx.fillRect(-5, -2, 10, 4);
          ctx.restore();
        }
      });
    }
  }


  function spawnWater(particles, w, h) {
    const cx = w / 2, cy = h * 0.6;
    particles.push({
      maxLife: 340,
      draw(ctx, t) {
        const r = lerp(6, Math.max(w, h) * 0.42, easeOutCubic(t));
        const alpha = (1 - t) * 0.6;
        ctx.strokeStyle = rgba('#3ca0e6', alpha);
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.ellipse(cx, cy, r, r * 0.5, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    });
    for (let i = 0; i < 14; i++) {
      const angle = rand(-Math.PI, 0);
      const dist = rand(Math.max(w, h) * 0.15, Math.max(w, h) * 0.42);
      particles.push({
        delay: rand(0, 120),
        maxLife: rand(280, 420),
        angle, dist,
        size: rand(3, 7),
        col: pick(['#3ca0e6', '#7cc4f0', '#1c6fb0']),
        draw(ctx, t) {
          const e = easeOutCubic(t);
          const fall = t > 0.4 ? easeInCubic((t - 0.4) / 0.6) : 0;
          const x = cx + Math.cos(this.angle) * this.dist * e;
          const y = cy + Math.sin(this.angle) * this.dist * e + fall * 30;
          const alpha = 1 - Math.max(0, (t - 0.65) / 0.35);
          ctx.fillStyle = rgba(this.col, alpha);
          ctx.beginPath();
          ctx.arc(x, y, this.size, 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }
  }

  // ---- みず・豪華版：巨大な水柱が噴き上がり、大量のしぶきと波紋が広がる ----
  function spawnWaterBig(particles, w, h) {
    const cx = w / 2, cy = h * 0.6;
    const R = Math.max(w, h);
    // 中心の青いフラッシュ
    particles.push({
      maxLife: 260,
      draw(ctx, t) {
        const alpha = (1 - t) * 0.7;
        const r = lerp(6, R * 0.5, easeOutCubic(t));
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        grad.addColorStop(0, rgba('#eaf8ff', alpha));
        grad.addColorStop(0.5, rgba('#3ca0e6', alpha * 0.85));
        grad.addColorStop(1, 'rgba(60,160,230,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    // 二重の波紋リング
    for (let i = 0; i < 3; i++) {
      particles.push({
        delay: i * 90,
        maxLife: 460,
        draw(ctx, t) {
          const r = lerp(6, R * 0.6, easeOutCubic(t));
          const alpha = (1 - t) * 0.65;
          ctx.strokeStyle = rgba('#3ca0e6', alpha);
          ctx.lineWidth = 3.5;
          ctx.beginPath();
          ctx.ellipse(cx, cy, r, r * 0.5, 0, 0, Math.PI * 2);
          ctx.stroke();
        }
      });
    }
    // 大量に噴き上がる水しぶき（通常版14個→30個）
    for (let i = 0; i < 30; i++) {
      const angle = rand(-Math.PI, 0);
      const dist = rand(R * 0.15, R * 0.6);
      particles.push({
        delay: rand(0, 220),
        maxLife: rand(340, 520),
        angle, dist,
        size: rand(4, 10),
        col: pick(['#3ca0e6', '#7cc4f0', '#1c6fb0', '#eaf8ff']),
        draw(ctx, t) {
          const e = easeOutCubic(t);
          const fall = t > 0.4 ? easeInCubic((t - 0.4) / 0.6) : 0;
          const x = cx + Math.cos(this.angle) * this.dist * e;
          const y = cy + Math.sin(this.angle) * this.dist * e + fall * 44;
          const alpha = 1 - Math.max(0, (t - 0.65) / 0.35);
          ctx.fillStyle = rgba(this.col, alpha);
          ctx.shadowColor = rgba('#3ca0e6', 0.6);
          ctx.shadowBlur = 6;
          ctx.beginPath();
          ctx.arc(x, y, this.size, 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }
    // 中心から立ち上る巨大な水柱
    particles.push({
      maxLife: 380,
      draw(ctx, t) {
        const rise = easeOutCubic(Math.min(1, t * 1.5));
        const h0 = h * 0.55 * rise;
        const alpha = (1 - Math.max(0, (t - 0.6) / 0.4)) * 0.75;
        const grad = ctx.createLinearGradient(cx, cy, cx, cy - h0);
        grad.addColorStop(0, rgba('#3ca0e6', alpha));
        grad.addColorStop(1, rgba('#eaf8ff', 0));
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.ellipse(cx, cy - h0 / 2, 22, h0 / 2, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }


  function spawnSound(particles, w, h) {
    const cx = w / 2, cy = h / 2;
    for (let i = 0; i < 4; i++) {
      particles.push({
        delay: i * 70,
        maxLife: 320,
        draw(ctx, t) {
          const r = lerp(4, Math.max(w, h) * 0.55, easeOutCubic(t));
          const alpha = (1 - t) * 0.75;
          ctx.strokeStyle = rgba('#ffb347', alpha);
          ctx.lineWidth = 3 * (1 - t * 0.5);
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.stroke();
        }
      });
    }
  }

  // ---- サウンド・豪華版：巨大な同心円の音波が連続で広がり、空気を震わせる ----
  function spawnSoundBig(particles, w, h) {
    const cx = w / 2, cy = h / 2;
    const R = Math.max(w, h);
    // 中心のオレンジフラッシュ
    particles.push({
      maxLife: 220,
      draw(ctx, t) {
        const alpha = (1 - t) * 0.7;
        const r = lerp(4, R * 0.35, easeOutCubic(t));
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        grad.addColorStop(0, rgba('#fff2d9', alpha));
        grad.addColorStop(1, 'rgba(255,179,71,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    // 同心円状の音波リング（通常版4本→8本、より速く・より遠くまで）
    for (let i = 0; i < 8; i++) {
      particles.push({
        delay: i * 55,
        maxLife: 420,
        draw(ctx, t) {
          const r = lerp(4, R * 0.8, easeOutCubic(t));
          const alpha = (1 - t) * 0.75;
          ctx.strokeStyle = rgba('#ffb347', alpha);
          ctx.lineWidth = 4 * (1 - t * 0.5);
          ctx.shadowColor = rgba('#ffe0a8', 0.7);
          ctx.shadowBlur = 8;
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.stroke();
        }
      });
    }
    // 震える波形の輪郭線（新規：音の揺らぎを表現）
    for (let i = 0; i < 2; i++) {
      particles.push({
        delay: i * 120,
        maxLife: 380,
        draw(ctx, t) {
          const rBase = lerp(6, R * 0.5, easeOutCubic(t));
          const alpha = (1 - t) * 0.6;
          ctx.strokeStyle = rgba('#ffcf7a', alpha);
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          for (let a = 0; a < Math.PI * 2; a += 0.1) {
            const wobble = Math.sin(a * 10 + t * 16) * 6;
            const r = rBase + wobble;
            const x = cx + Math.cos(a) * r;
            const y = cy + Math.sin(a) * r;
            if (a === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          }
          ctx.closePath();
          ctx.stroke();
        }
      });
    }
  }


  function spawnShine(particles, w, h) {
    const cx = w / 2, cy = h / 2;
    particles.push({
      maxLife: 340,
      draw(ctx, t) {
        const alpha = (1 - t) * 0.85;
        const r = lerp(4, Math.max(w, h) * 0.42, easeOutCubic(t));
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        grad.addColorStop(0, rgba('#fff6c8', alpha));
        grad.addColorStop(0.5, rgba('#ffd23f', alpha * 0.7));
        grad.addColorStop(1, 'rgba(255,210,63,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    // 放射状の光条
    const rays = 8;
    for (let i = 0; i < rays; i++) {
      const angle = (Math.PI * 2 * i) / rays;
      particles.push({
        delay: 30,
        maxLife: 300,
        draw(ctx, t) {
          const len = lerp(4, Math.max(w, h) * 0.55, easeOutCubic(t));
          const alpha = (1 - t) * 0.8;
          const x1 = cx + Math.cos(angle) * len;
          const y1 = cy + Math.sin(angle) * len;
          ctx.strokeStyle = rgba('#ffe98a', alpha);
          ctx.lineWidth = 2.5;
          ctx.shadowColor = rgba('#fff6c8', 0.9);
          ctx.shadowBlur = 10;
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.lineTo(x1, y1);
          ctx.stroke();
        }
      });
    }
    // きらめく星の粒子
    for (let i = 0; i < 10; i++) {
      const a0 = rand(0, Math.PI * 2);
      particles.push({
        delay: rand(20, 160),
        maxLife: rand(300, 420),
        a0,
        rot: rand(0, Math.PI * 2),
        draw(ctx, t) {
          const dist = lerp(6, Math.max(w, h) * 0.4, easeOutCubic(t));
          const x = cx + Math.cos(this.a0) * dist;
          const y = cy + Math.sin(this.a0) * dist;
          const alpha = Math.sin(Math.PI * clamp01(t));
          ctx.fillStyle = rgba('#fff2b0', alpha);
          ctx.shadowColor = rgba('#ffe98a', 0.9);
          ctx.shadowBlur = 8;
          drawStar(ctx, x, y, lerp(6, 2, t), this.rot + t * 3);
        }
      });
    }
  }

  // ---- シャイン・豪華版：黄金の巨大な太陽フレアが炸裂し、光条と星が画面を埋め尽くす ----
  function spawnShineBig(particles, w, h) {
    const cx = w / 2, cy = h / 2;
    const R = Math.max(w, h);
    // 中心の巨大な黄金グロー
    particles.push({
      maxLife: 420,
      draw(ctx, t) {
        const alpha = (1 - t) * 0.9;
        const r = lerp(4, R * 0.65, easeOutCubic(t));
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        grad.addColorStop(0, rgba('#ffffff', alpha));
        grad.addColorStop(0.35, rgba('#fff6c8', alpha * 0.9));
        grad.addColorStop(0.7, rgba('#ffd23f', alpha * 0.6));
        grad.addColorStop(1, 'rgba(255,210,63,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    // 放射状の巨大な光条（通常版8本→16本、画面外周まで届く）
    const rays = 16;
    for (let i = 0; i < rays; i++) {
      const angle = (Math.PI * 2 * i) / rays;
      particles.push({
        delay: 20,
        maxLife: 380,
        draw(ctx, t) {
          const len = lerp(4, R * 0.85, easeOutCubic(t));
          const alpha = (1 - t) * 0.85;
          const x1 = cx + Math.cos(angle) * len;
          const y1 = cy + Math.sin(angle) * len;
          ctx.strokeStyle = rgba('#ffe98a', alpha);
          ctx.lineWidth = 3.5;
          ctx.shadowColor = rgba('#fff6c8', 1);
          ctx.shadowBlur = 14;
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.lineTo(x1, y1);
          ctx.stroke();
        }
      });
    }
    // ゆっくり回転する巨大リング（2重）
    for (let i = 0; i < 2; i++) {
      particles.push({
        delay: i * 90,
        maxLife: 460,
        draw(ctx, t) {
          const r = lerp(6, R * 0.6, easeOutCubic(t));
          const alpha = (1 - t) * 0.7;
          ctx.strokeStyle = rgba('#ffd23f', alpha);
          ctx.lineWidth = 4;
          ctx.shadowColor = rgba('#fff6c8', 0.9);
          ctx.shadowBlur = 12;
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.stroke();
        }
      });
    }
    // きらめく星の粒子（通常版10個→24個、遠くまで広がる）
    for (let i = 0; i < 24; i++) {
      const a0 = rand(0, Math.PI * 2);
      particles.push({
        delay: rand(20, 260),
        maxLife: rand(360, 540),
        a0,
        rot: rand(0, Math.PI * 2),
        draw(ctx, t) {
          const dist = lerp(6, R * 0.7, easeOutCubic(t));
          const x = cx + Math.cos(this.a0) * dist;
          const y = cy + Math.sin(this.a0) * dist;
          const alpha = Math.sin(Math.PI * clamp01(t));
          ctx.fillStyle = rgba('#fff2b0', alpha);
          ctx.shadowColor = rgba('#ffe98a', 1);
          ctx.shadowBlur = 10;
          drawStar(ctx, x, y, lerp(9, 3, t), this.rot + t * 4);
        }
      });
    }
  }

  // ============================================================
  // 専用大技エフェクト（インフェルノ／メイルストローム／イルミンスール）
  // 通常のタイプエフェクトとは別枠。sprite-slotではなく戦闘画面全体（battle-field）
  // を覆う専用キャンバスで再生する、長め・大迫力の一点物演出。
  // 構成は共通して「地面（画面下部）から巨大な柱が突き上げる」→「そのまま持続」
  // →「周囲に欠片（火の粉／雨／土）が降り注ぐ」の3幕構成。
  // ============================================================

  // ---- インフェルノ：下から炎が噴き上げ、火の粉が舞い降りる ----
  // ============================================================
  // インフェルノ：業火が大地を割って噴き上がる超高火力演出
  // 構成：①前兆の熱波と地割れ ②黒煙を纏いながら乱流で揺らめく炎柱 ③芯の白熱コア
  //       ④根本の爆風衝撃波＋飛散する火の粉塊 ⑤降り注ぐ燃えかす
  // 「ノイズによる不規則な揺らぎ」「黒煙による質感の重さ」「加算合成の発光」の3点で
  // これまでの単純な円グラデーション演出から質感を大きく引き上げる。
  // ============================================================
  function spawnInfernoSpecial(particles, w, h) {
    const cx = w / 2, groundY = h * 0.92;
    const R = Math.max(w, h);
    const seedA = rand(0, 100), seedB = rand(0, 100), seedC = rand(0, 100);

    // ---- 幕0: 前兆の陽炎（着火前の熱ゆらぎ）と地面の亀裂 ----
    particles.push({
      maxLife: 190,
      draw(ctx, t) {
        const alpha = Math.sin(Math.PI * clamp01(t)) * 0.55;
        const wob = noise1(t * 8, seedA) * 10;
        const grad = ctx.createRadialGradient(cx + wob, groundY, 0, cx + wob, groundY, w * 0.5);
        grad.addColorStop(0, rgba('#ffb347', alpha));
        grad.addColorStop(0.55, rgba('#c94a1a', alpha * 0.5));
        grad.addColorStop(1, 'rgba(180,40,10,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, groundY - h * 0.28, w, h * 0.45);
      }
    });
    // 地割れの亀裂（複数本、内側から光が漏れる質感を二重線で表現）
    for (let i = 0; i < 6; i++) {
      const ang = rand(-1.25, -1.9);
      const ox = rand(-w * 0.24, w * 0.24);
      particles.push({
        delay: 20 + i * 14,
        maxLife: 280,
        ang, ox,
        draw(ctx, t) {
          const len = lerp(6, w * (0.14 + Math.abs(ox) / w * 0.1), easeOutCubic(t));
          const alpha = (1 - t) * 0.95;
          ctx.save();
          ctx.translate(cx + this.ox, groundY);
          ctx.rotate(this.ang);
          // 外側：暗く太い亀裂本体
          ctx.strokeStyle = rgba('#5a1a08', alpha);
          ctx.lineWidth = 5;
          ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(len, 0); ctx.stroke();
          // 内側：熱で光る発光ライン
          ctx.strokeStyle = rgba('#ffe17a', alpha);
          ctx.lineWidth = 2;
          ctx.shadowColor = rgba('#fff2b0', 1);
          ctx.shadowBlur = 12;
          ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(len, 0); ctx.stroke();
          ctx.restore();
        }
      });
    }

    // ---- 幕1: 黒煙が先行して膨れ上がる（炎の「重さ」を出すための下地）----
    const smokeStart = 90;
    for (let i = 0; i < 16; i++) {
      const x0 = cx + rand(-w * 0.22, w * 0.22);
      particles.push({
        delay: smokeStart + rand(0, 200),
        maxLife: rand(700, 1000),
        x0,
        drift: rand(-10, 10),
        size: rand(40, 76),
        seed: rand(0, 100),
        blend: 'source-over',
        draw(ctx, t) {
          const rise = easeOutCubic(t);
          const y = groundY - rise * h * rand(0.55, 0.95);
          const wob = noise1(t * 5 + this.seed, this.seed) * 26;
          const x = this.x0 + this.drift * t * 20 + wob;
          const alpha = (t < 0.15 ? t / 0.15 : (1 - Math.max(0, (t - 0.5) / 0.5))) * 0.42;
          const size = this.size * (0.6 + t * 0.9);
          const grad = ctx.createRadialGradient(x, y, 0, x, y, size);
          grad.addColorStop(0, rgba('#3a2018', alpha));
          grad.addColorStop(0.6, rgba('#1a0e0a', alpha * 0.7));
          grad.addColorStop(1, 'rgba(10,6,4,0)');
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(x, y, size, 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }

    // ---- 幕2: 業火の柱が乱流で揺らめきながら突き上げる（メインビジュアル）----
    const columnStart = 170;
    const columnRise = 560;
    // 柱を構成する複数の「炎の舌」レイヤー（下から上に向かう不規則な揺らぎ）
    for (let i = 0; i < 90; i++) {
      const x0 = cx + rand(-w * 0.17, w * 0.17);
      const seed = rand(0, 100);
      const lane = rand(0, 1); // 揺らぎの位相をずらす
      particles.push({
        delay: columnStart + rand(0, 300),
        maxLife: rand(520, 780),
        x0, seed, lane,
        drift: rand(-6, 6),
        size: rand(14, 30),
        col: pick(['#ff5a1a', '#ff2e0e', '#ff8a2e', '#ffb347']),
        blend: 'lighter',
        draw(ctx, t) {
          const rise = h * 1.08;
          const y = groundY - easeOutCubic(t) * rise;
          // ノイズによる不規則な横揺れ（sin単体より荒々しく乱れる）
          const turbulence = noise1(t * 10 + this.lane * 6, this.seed) * (18 + t * 22);
          const x = this.x0 + this.drift * t * 8 + turbulence;
          const alpha = (t < 0.08 ? t / 0.08 : (1 - (t - 0.08) / 0.92)) * 0.9;
          const size = this.size * (1 - t * 0.5) * (1 + Math.abs(noise1(t * 14, this.seed + 5)) * 0.35);
          const grad = ctx.createRadialGradient(x, y, 0, x, y, size);
          grad.addColorStop(0, rgba('#fffbe0', alpha));
          grad.addColorStop(0.28, rgba('#ffdf6a', alpha * 0.95));
          grad.addColorStop(0.6, rgba(this.col, alpha * 0.85));
          grad.addColorStop(1, 'rgba(180,20,0,0)');
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(x, y, size, 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }
    // 柱の芯（縦に伸びる白熱コア、左右にノイズで蛇行させてリアルな一本の炎に見せる）
    particles.push({
      delay: columnStart,
      maxLife: columnRise + 300,
      blend: 'lighter',
      draw(ctx, t) {
        const rise = easeOutCubic(Math.min(1, t * 1.35));
        const h0 = h * 0.9 * rise;
        const alpha = (1 - Math.max(0, (t - 0.5) / 0.5)) * 0.92;
        const segments = 14;
        ctx.save();
        for (let s = 0; s < segments; s++) {
          const st = s / segments;
          const y = groundY - h0 * st;
          const wob = noise1(st * 6 + t * 9, seedB) * lerp(4, 26, st);
          const x = cx + wob;
          const segW = lerp(30, 8, st) * (1 - t * 0.25);
          const grad = ctx.createRadialGradient(x, y, 0, x, y, segW * 1.6);
          grad.addColorStop(0, rgba('#ffffff', alpha));
          grad.addColorStop(0.35, rgba('#ffe98a', alpha * 0.95));
          grad.addColorStop(0.7, rgba('#ff8a2e', alpha * 0.6));
          grad.addColorStop(1, 'rgba(255,90,20,0)');
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(x, y, segW, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }
    });
    // ---- 爆風の衝撃波リング（根本から複数波、速度と太さを変えて重層化）----
    for (let i = 0; i < 3; i++) {
      particles.push({
        delay: columnStart + i * 80,
        maxLife: 420 - i * 40,
        blend: 'lighter',
        draw(ctx, t) {
          const r = lerp(w * 0.06, R * (0.5 + i * 0.12), easeOutQuint(t));
          const alpha = (1 - t) * (0.75 - i * 0.15);
          ctx.strokeStyle = rgba(i === 0 ? '#fff2b0' : '#ff9142', alpha);
          ctx.lineWidth = (9 - i * 2) * (1 - t * 0.6);
          ctx.shadowColor = rgba('#ffb347', 0.9);
          ctx.shadowBlur = 18;
          ctx.beginPath();
          ctx.ellipse(cx, groundY, r, r * 0.3, 0, 0, Math.PI * 2);
          ctx.stroke();
        }
      });
    }
    // 根本で弾ける火球の塊（大粒、勢いよく飛散）
    for (let i = 0; i < 20; i++) {
      const ang = rand(-Math.PI * 0.95, -Math.PI * 0.05);
      const speed = rand(w * 0.18, w * 0.38);
      particles.push({
        delay: columnStart + rand(0, 60),
        maxLife: rand(360, 560),
        ang, speed,
        size: rand(6, 14),
        col: pick(['#ff5a1a', '#ffb347', '#ff2e0e']),
        blend: 'lighter',
        draw(ctx, t) {
          const e = easeOutCubic(t);
          const grav = t * t * h * 0.3;
          const x = cx + Math.cos(this.ang) * this.speed * e;
          const y = groundY + Math.sin(this.ang) * this.speed * e + grav;
          const alpha = (1 - t) * 0.95;
          const size = this.size * (1 - t * 0.5);
          const grad = ctx.createRadialGradient(x, y, 0, x, y, size);
          grad.addColorStop(0, rgba('#fff6cf', alpha));
          grad.addColorStop(0.5, rgba(this.col, alpha * 0.9));
          grad.addColorStop(1, 'rgba(255,60,0,0)');
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(x, y, size, 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }

    // ---- 幕3: 立ち上る残り火の黒煙（画面上部へゆっくり漂う）----
    const afterSmokeStart = 520;
    for (let i = 0; i < 12; i++) {
      const x0 = cx + rand(-w * 0.3, w * 0.3);
      particles.push({
        delay: afterSmokeStart + rand(0, 400),
        maxLife: rand(900, 1300),
        x0,
        size: rand(30, 60),
        seed: rand(0, 100),
        draw(ctx, t) {
          const rise = easeOutCubic(t);
          const y = groundY - rise * h * 1.0 - h * 0.05;
          const wob = noise1(t * 4 + this.seed, this.seed) * 30;
          const x = this.x0 + wob;
          const alpha = (t < 0.1 ? t / 0.1 : (1 - Math.max(0, (t - 0.55) / 0.45))) * 0.3;
          const size = this.size * (0.7 + t * 0.8);
          const grad = ctx.createRadialGradient(x, y, 0, x, y, size);
          grad.addColorStop(0, rgba('#2a1812', alpha));
          grad.addColorStop(1, 'rgba(20,12,10,0)');
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(x, y, size, 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }

    // ---- 幕4: 火の粉が画面全体に降り注ぐ（燃えかすの質感を出すため矩形チップ状に）----
    const emberStart = 600;
    for (let i = 0; i < 46; i++) {
      const x0 = rand(w * 0.02, w * 0.98);
      const y0 = rand(-h * 0.15, h * 0.35);
      particles.push({
        delay: emberStart + rand(0, 520),
        maxLife: rand(680, 1020),
        x0, y0,
        sway: rand(8, 24),
        swaySpeed: rand(1.2, 2.8),
        size: rand(2, 5),
        col: pick(['#ffb347', '#ffd23f', '#ff7a1a', '#ff4d2e']),
        rot: rand(0, Math.PI * 2),
        spin: rand(-3, 3),
        blend: 'lighter',
        draw(ctx, t) {
          const fall = easeInCubic(t);
          const y = this.y0 + fall * (h - this.y0) * 1.05;
          const x = this.x0 + Math.sin(t * this.swaySpeed * Math.PI + this.rot) * this.sway;
          const alpha = t < 0.06 ? t / 0.06 : (1 - Math.max(0, (t - 0.7) / 0.3));
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(this.rot + t * this.spin);
          ctx.fillStyle = rgba(this.col, alpha);
          ctx.shadowColor = rgba('#ffdf8a', 0.9);
          ctx.shadowBlur = 8;
          ctx.beginPath();
          ctx.rect(-this.size / 2, -this.size / 2, this.size, this.size * 1.6);
          ctx.fill();
          ctx.restore();
        }
      });
    }
  }

  // ============================================================
  // かさいせんぷう（やけのはらも共通）：画面全体が山火事のように燃え上がり、
  // その中心に火災旋風（ファイヤートルネード）が巻き起こる超高火力演出。
  // 構成：①画面全体が赤黒く染まり山火事の熱気に包まれる ②地平線一帯に業火の壁が広がる
  //       ③中心で炎が渦を巻きながら巨大な火柱＝火災旋風となって立ち昇る
  //       ④旋風の頂点で爆発的に破裂し、無数の火の粉と黒煙が全画面に降り注ぐ
  // 「加算合成による発光」「ノイズによる乱流」「回転する螺旋パーティクル」を組み合わせ、
  // 画面全体が炎に飲み込まれる圧倒的なスケール感を狙う。
  // ============================================================
  function spawnFireWhirlwindSpecial(particles, w, h) {
    // 自分側（画面下寄り＝手前）から相手側（画面上寄り＝奥）へ、
    // 斜め上に向かって地獄の業火が吹き荒れる構図。
    const originX = w * 0.5, originY = h * 1.02;      // 自分側の発生源（画面外下）
    const targetX = w * 0.5, targetY = h * -0.02;      // 相手側の着弾点（画面外上）
    const dirX = targetX - originX, dirY = targetY - originY;
    const dirLen = Math.hypot(dirX, dirY) || 1;
    const ux = dirX / dirLen, uy = dirY / dirLen;   // 進行方向の単位ベクトル
    const px = -uy, py = ux;                         // 進行方向に垂直な単位ベクトル（横幅方向）
    const R = Math.max(w, h);
    const seedA = rand(0, 100), seedB = rand(0, 100), seedC = rand(0, 100);

    // ---- 幕0: 世界が地獄のように赤黒く染まる（山火事の熱波が画面全体を覆う前兆）----
    particles.push({
      maxLife: 300,
      draw(ctx, t) {
        const alpha = Math.sin(Math.PI * clamp01(t)) * 0.6;
        ctx.fillStyle = rgba('#1a0402', alpha * 0.7);
        ctx.fillRect(0, 0, w, h);
        const grad = ctx.createRadialGradient(w / 2, h * 0.6, 0, w / 2, h * 0.6, R * 0.95);
        grad.addColorStop(0, rgba('#8a0e02', alpha * 0.55));
        grad.addColorStop(0.6, rgba('#3a0400', alpha * 0.4));
        grad.addColorStop(1, 'rgba(10,0,0,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);
      }
    });

    // ---- 幕1: 画面全体が焦土と化す（黒く焦げた地面、燻る不気味な炎、立ち込める黒煙）----
    const scorchStart = 30;
    // 画面全体を覆う焦げた大地（暗い炭化色のグラデーションで下から侵食）
    particles.push({
      delay: scorchStart,
      maxLife: 900,
      draw(ctx, t) {
        const grow = easeOutCubic(Math.min(1, t * 2));
        const alpha = grow * (1 - Math.max(0, (t - 0.75) / 0.25));
        const grad = ctx.createLinearGradient(0, h, 0, h * (1 - grow * 0.9));
        grad.addColorStop(0, rgba('#0c0503', alpha * 0.85));
        grad.addColorStop(0.5, rgba('#2a0e04', alpha * 0.5));
        grad.addColorStop(1, 'rgba(20,4,0,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);
      }
    });
    // 焦土のあちこちで燻る不穏な残り火（地獄の亀裂のような赤い光）
    for (let i = 0; i < 16; i++) {
      const x0 = rand(w * 0.0, w * 1.0);
      const y0 = rand(h * 0.7, h * 1.05);
      particles.push({
        delay: scorchStart + rand(0, 260),
        maxLife: rand(700, 1000),
        x0, y0,
        size: rand(14, 34),
        seed: rand(0, 100),
        blend: 'lighter',
        draw(ctx, t) {
          const pulse = 0.6 + Math.abs(noise1(t * 8 + this.seed, this.seed)) * 0.4;
          const alpha = Math.sin(Math.PI * clamp01(t)) * 0.7 * pulse;
          const grad = ctx.createRadialGradient(this.x0, this.y0, 0, this.x0, this.y0, this.size);
          grad.addColorStop(0, rgba('#ff5a1a', alpha));
          grad.addColorStop(0.5, rgba('#8a0e02', alpha * 0.6));
          grad.addColorStop(1, 'rgba(60,4,0,0)');
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(this.x0, this.y0, this.size, 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }
    // 立ち込める禍々しい黒煙（画面全体に重くたなびく）
    for (let i = 0; i < 18; i++) {
      const x0 = rand(w * -0.05, w * 1.05);
      particles.push({
        delay: scorchStart + rand(20, 280),
        maxLife: rand(850, 1150),
        x0,
        size: rand(38, 74),
        seed: rand(0, 100),
        draw(ctx, t) {
          const rise = easeOutCubic(t);
          const y = h * (0.95 - rise * rand(0.4, 0.85));
          const wob = noise1(t * 4 + this.seed, this.seed) * 26;
          const x = this.x0 + wob;
          const alpha = (t < 0.15 ? t / 0.15 : (1 - Math.max(0, (t - 0.5) / 0.5))) * 0.42;
          const size = this.size * (0.6 + t * 0.9);
          const grad = ctx.createRadialGradient(x, y, 0, x, y, size);
          grad.addColorStop(0, rgba('#241012', alpha));
          grad.addColorStop(0.6, rgba('#120608', alpha * 0.75));
          grad.addColorStop(1, 'rgba(8,4,4,0)');
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(x, y, size, 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }

    // ---- 幕2: 自分側の背後で地獄の業火が渦を巻き、巨大な火災旋風となって相手側へ吹き荒れる ----
    const spinStart = 300;
    const travelMs = 640;      // 旋風が発生源から着弾点まで進む時間
    // 旋風の"現在の中心座標"を進行度prog(0〜1)から計算するヘルパー
    function whirlCenter(prog) {
      const e = easeInOutSine(clamp01(prog));
      return { x: lerp(originX, targetX, e), y: lerp(originY, targetY, e) };
    }
    // 螺旋を描きながら突き進む地獄の炎粒（進行方向の軸まわりに回転しつつ前進）
    for (let i = 0; i < 150; i++) {
      const seed = rand(0, 100);
      const phase0 = rand(0, Math.PI * 2);
      const orbitR0 = rand(w * 0.05, w * 0.30);
      const dir = Math.random() < 0.5 ? 1 : -1;
      const along0 = rand(0, 1);
      const col = pick(['#ff2e0e', '#c8130a', '#ff5a1a', '#8a0e02', '#ff8a2e']);
      particles.push({
        delay: spinStart + rand(0, 360),
        maxLife: rand(520, 780),
        seed, phase0, orbitR0, dir, along0, col,
        size: rand(14, 30),
        blend: 'lighter',
        draw(ctx, t) {
          const e = easeOutCubic(t);
          // この粒は旋風全体の帯の中で along0 の位置に留まりつつ、旋風自体が前進していく
          const prog = clamp01(this.along0 * 0.4 + e * 0.6);
          const c = whirlCenter(prog);
          // 前進するほど渦が狭まる（相手に迫るにつれ収束する恐ろしい勢い）
          const orbitR = this.orbitR0 * (1 - prog * 0.55) * (1 + Math.abs(noise1(t * 3, this.seed)) * 0.2);
          const spin = this.phase0 + this.dir * (t * 10 + noise1(t * 3, this.seed) * 0.7);
          const turbulence = noise1(t * 13 + this.seed, this.seed) * (8 + t * 12);
          const ox = Math.cos(spin) * orbitR + turbulence;
          const oy = Math.sin(spin) * orbitR * 0.5;
          const x = c.x + px * ox + ux * oy * 0.2;
          const y = c.y + py * ox + uy * oy * 0.2;
          const alpha = (t < 0.08 ? t / 0.08 : (1 - (t - 0.08) / 0.92)) * 0.95;
          const size = this.size * (1 - t * 0.4) * (1 + Math.abs(noise1(t * 14, this.seed + 5)) * 0.3);
          const grad = ctx.createRadialGradient(x, y, 0, x, y, size);
          grad.addColorStop(0, rgba('#fff2b0', alpha));
          grad.addColorStop(0.25, rgba('#ff8a2e', alpha * 0.95));
          grad.addColorStop(0.55, rgba(this.col, alpha * 0.9));
          grad.addColorStop(1, 'rgba(40,2,0,0)');
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(x, y, size, 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }
    // 旋風の芯（進行方向に伸びる荒れ狂う白熱〜血のような赤の帯。地獄の業火らしく禍々しい脈動を見せる）
    particles.push({
      delay: spinStart,
      maxLife: travelMs + 280,
      blend: 'lighter',
      draw(ctx, t) {
        const alpha = (1 - Math.max(0, (t - 0.45) / 0.55)) * 0.96;
        const segments = 22;
        const headProg = clamp01(t * 1.25);
        ctx.save();
        for (let s = 0; s < segments; s++) {
          const st = s / segments;
          // 先端(headProg)から発生源側へ帯を伸ばす
          const prog = clamp01(headProg - st * 0.55);
          if (prog <= 0) continue;
          const c = whirlCenter(prog);
          const spin = t * 9 + st * 6;
          const wobAmt = lerp(30, 8, st) * (1 - t * 0.15);
          const wob = Math.cos(spin) * wobAmt + noise1(st * 7 + t * 10, seedB) * lerp(14, 4, st);
          const x = c.x + px * wob;
          const y = c.y + py * wob;
          const segW = lerp(10, 34, prog) * (1 - t * 0.15);
          const pulse = 1 + Math.abs(noise1(t * 10 + st * 5, seedC)) * 0.25;
          const grad = ctx.createRadialGradient(x, y, 0, x, y, segW * pulse * 1.6);
          grad.addColorStop(0, rgba('#fff6d0', alpha));
          grad.addColorStop(0.3, rgba('#ff3a0a', alpha * 0.95));
          grad.addColorStop(0.65, rgba('#8a0602', alpha * 0.7));
          grad.addColorStop(1, 'rgba(30,0,0,0)');
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(x, y, segW * pulse, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }
    });
    // 旋風にまとわりつく漆黒の煙のリボン（地獄の獣が身をよじるような不気味な軌跡）
    for (let i = 0; i < 6; i++) {
      const dir = i % 2 === 0 ? 1 : -1;
      const phase = rand(0, Math.PI * 2);
      const along0 = rand(0, 0.4);
      particles.push({
        delay: spinStart + rand(0, 140),
        maxLife: rand(650, 860),
        dir, phase, along0,
        seed: rand(0, 100),
        draw(ctx, t) {
          const e = easeOutCubic(t);
          const alpha = (1 - Math.max(0, (t - 0.55) / 0.45)) * 0.35;
          ctx.strokeStyle = rgba('#0a0404', alpha);
          ctx.lineWidth = 7;
          ctx.beginPath();
          const steps = 20;
          for (let s = 0; s <= steps; s++) {
            const st = s / steps;
            const prog = clamp01(this.along0 + (e * 0.7) * st);
            const c = whirlCenter(prog);
            const spin = this.phase + this.dir * (t * 8 + st * 5);
            const orbitR = (w * 0.16) * (1 - prog * 0.6);
            const ox = Math.cos(spin) * orbitR;
            const x = c.x + px * ox;
            const y = c.y + py * ox;
            if (s === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          }
          ctx.stroke();
        }
      });
    }
    // 旋風の中に走る禍々しい亀裂状の閃光（地獄の炎らしい凶暴さのアクセント）
    for (let i = 0; i < 8; i++) {
      const along0 = rand(0.1, 0.85);
      particles.push({
        delay: spinStart + rand(60, 420),
        maxLife: rand(140, 220),
        along0,
        ang: rand(0, Math.PI * 2),
        len: rand(w * 0.05, w * 0.12),
        draw(ctx, t) {
          const c = whirlCenter(this.along0);
          const alpha = (1 - t) * 0.85;
          ctx.save();
          ctx.strokeStyle = rgba('#fff2c0', alpha);
          ctx.lineWidth = 2.4 * (1 - t * 0.5);
          ctx.shadowColor = rgba('#ff5a1a', 0.9);
          ctx.shadowBlur = 12;
          ctx.beginPath();
          ctx.moveTo(c.x - Math.cos(this.ang) * this.len, c.y - Math.sin(this.ang) * this.len);
          ctx.lineTo(c.x + Math.cos(this.ang) * this.len, c.y + Math.sin(this.ang) * this.len);
          ctx.stroke();
          ctx.restore();
        }
      });
    }

    // ---- 幕3: 旋風が相手側へ激突し、爆発的に破裂して衝撃波と火球が飛び散る ----
    const burstStart = spinStart + travelMs + 60;
    const burstX = targetX, burstY = h * 0.18; // 実際に見える範囲内で着弾させる
    for (let i = 0; i < 3; i++) {
      particles.push({
        delay: burstStart + i * 70,
        maxLife: 460 - i * 40,
        blend: 'lighter',
        draw(ctx, t) {
          const r = lerp(w * 0.08, R * (0.6 + i * 0.15), easeOutQuint(t));
          const alpha = (1 - t) * (0.8 - i * 0.15);
          ctx.strokeStyle = rgba(i === 0 ? '#fff2b0' : '#ff3a0a', alpha);
          ctx.lineWidth = (11 - i * 2) * (1 - t * 0.6);
          ctx.shadowColor = rgba('#ff5a1a', 0.9);
          ctx.shadowBlur = 22;
          ctx.beginPath();
          ctx.ellipse(burstX, burstY, r, r * 0.7, 0, 0, Math.PI * 2);
          ctx.stroke();
        }
      });
    }
    for (let i = 0; i < 34; i++) {
      const ang = rand(0, Math.PI * 2);
      const speed = rand(w * 0.18, w * 0.4);
      particles.push({
        delay: burstStart + rand(0, 80),
        maxLife: rand(400, 600),
        ang, speed,
        size: rand(6, 16),
        col: pick(['#ff5a1a', '#ff2e0e', '#8a0e02']),
        blend: 'lighter',
        draw(ctx, t) {
          const e = easeOutCubic(t);
          const grav = t * t * h * 0.16;
          const x = burstX + Math.cos(this.ang) * this.speed * e;
          const y = burstY + Math.sin(this.ang) * this.speed * e + grav;
          const alpha = (1 - t) * 0.95;
          const size = this.size * (1 - t * 0.5);
          const grad = ctx.createRadialGradient(x, y, 0, x, y, size);
          grad.addColorStop(0, rgba('#fff6cf', alpha));
          grad.addColorStop(0.5, rgba(this.col, alpha * 0.9));
          grad.addColorStop(1, 'rgba(255,40,0,0)');
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(x, y, size, 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }

    // ---- 幕4: 焼き尽くされた黒煙が画面全体にたなびく（地獄の余韻）----
    const afterSmokeStart = burstStart + 260;
    for (let i = 0; i < 14; i++) {
      const x0 = rand(w * 0.0, w * 1.0);
      particles.push({
        delay: afterSmokeStart + rand(0, 420),
        maxLife: rand(900, 1300),
        x0,
        size: rand(32, 64),
        seed: rand(0, 100),
        draw(ctx, t) {
          const rise = easeOutCubic(t);
          const y = h * 0.95 - rise * h * 1.0 - h * 0.05;
          const wob = noise1(t * 4 + this.seed, this.seed) * 30;
          const x = this.x0 + wob;
          const alpha = (t < 0.1 ? t / 0.1 : (1 - Math.max(0, (t - 0.55) / 0.45))) * 0.32;
          const size = this.size * (0.7 + t * 0.8);
          const grad = ctx.createRadialGradient(x, y, 0, x, y, size);
          grad.addColorStop(0, rgba('#1c0c0e', alpha));
          grad.addColorStop(1, 'rgba(14,6,8,0)');
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(x, y, size, 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }

    // ---- 幕5: 全画面に舞い散る火の粉（地獄の業火が撒き散らす燃えかす）----
    const emberStart = spinStart + 80;
    for (let i = 0; i < 70; i++) {
      const x0 = rand(w * 0.0, w * 1.0);
      const y0 = rand(-h * 0.15, h * 0.6);
      particles.push({
        delay: emberStart + rand(0, 700),
        maxLife: rand(700, 1080),
        x0, y0,
        sway: rand(8, 26),
        swaySpeed: rand(1.2, 2.8),
        size: rand(2, 5),
        col: pick(['#ffb347', '#ffd23f', '#ff7a1a', '#ff4d2e']),
        rot: rand(0, Math.PI * 2),
        spin: rand(-3, 3),
        blend: 'lighter',
        draw(ctx, t) {
          const fall = easeInCubic(t);
          const y = this.y0 + fall * (h - this.y0) * 1.05;
          const x = this.x0 + Math.sin(t * this.swaySpeed * Math.PI + this.rot) * this.sway;
          const alpha = t < 0.06 ? t / 0.06 : (1 - Math.max(0, (t - 0.7) / 0.3));
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(this.rot + t * this.spin);
          ctx.fillStyle = rgba(this.col, alpha);
          ctx.shadowColor = rgba('#ffdf8a', 0.9);
          ctx.shadowBlur = 8;
          ctx.beginPath();
          ctx.rect(-this.size / 2, -this.size / 2, this.size, this.size * 1.6);
          ctx.fill();
          ctx.restore();
        }
      });
    }
  }

  // ---- メイルストローム：地面に渦潮ができ、回転しながら水柱が突き上げ、雨が降る ----
  // ============================================================
  // メイルストローム：海が渦を巻いて巨大な水柱が突き上げる超高火力演出
  // 構成：①水面の隆起と渦潮の発生 ②渦に巻き込まれる大量の泡と飛沫 ③うねる水柱本体
  //       ④天辺での大爆発と飛沫の飛散 ⑤どしゃ降りの雨と地面のしぶき跳ね返り
  // 「ノイズによる水面のうねり」「深い藍〜白泡までの階調」「加算合成の水しぶき発光」を軸に強化。
  // ============================================================
  function spawnMaelstromSpecial(particles, w, h) {
    const cx = w / 2, groundY = h * 0.92;
    const R = Math.max(w, h);
    const seedA = rand(0, 100), seedB = rand(0, 100);

    // ---- 幕0: 水面が不穏にうねり、渦の予兆となる暗い水面が盛り上がる ----
    particles.push({
      maxLife: 200,
      draw(ctx, t) {
        const alpha = Math.sin(Math.PI * clamp01(t)) * 0.6;
        const grad = ctx.createRadialGradient(cx, groundY, 0, cx, groundY, w * 0.5);
        grad.addColorStop(0, rgba('#0d3a5c', alpha));
        grad.addColorStop(0.6, rgba('#08243a', alpha * 0.6));
        grad.addColorStop(1, 'rgba(8,36,58,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, groundY - h * 0.14, w, h * 0.22);
      }
    });

    // ---- 幕1: 渦潮が形成される（多重の同心楕円がうねりながら回転、ノイズで歪ませる）----
    for (let i = 0; i < 6; i++) {
      particles.push({
        delay: i * 45,
        maxLife: 460,
        idx: i,
        seed: rand(0, 100),
        draw(ctx, t) {
          const rx0 = lerp(w * 0.04, w * 0.38, easeOutCubic(t));
          ctx.save();
          ctx.translate(cx, groundY);
          ctx.rotate(t * 7 + this.idx * 0.6);
          const alpha = (1 - t) * 0.85;
          // うねりで歪んだ楕円を細かい線分で描き、単なる幾何学円に見えないようにする
          ctx.beginPath();
          const segs = 40;
          for (let s = 0; s <= segs; s++) {
            const a = (s / segs) * Math.PI * 1.7;
            const wob = 1 + noise1(a * 3 + t * 6, this.seed) * 0.18;
            const rx = rx0 * wob, ry = rx * 0.3 * wob;
            const px = Math.cos(a) * rx, py = Math.sin(a) * ry;
            if (s === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
          }
          ctx.strokeStyle = rgba(i % 2 === 0 ? '#3ca0e6' : '#0d5c8c', alpha);
          ctx.lineWidth = 4;
          ctx.shadowColor = rgba('#bfe8ff', 0.9);
          ctx.shadowBlur = 12;
          ctx.stroke();
          ctx.restore();
        }
      });
    }
    // 渦の中心の暗い深淵（吸い込まれる質感、多層グラデーション）
    particles.push({
      maxLife: 320,
      draw(ctx, t) {
        const alpha = Math.sin(Math.PI * clamp01(t)) * 0.75;
        const grad = ctx.createRadialGradient(cx, groundY, 0, cx, groundY, w * 0.18);
        grad.addColorStop(0, rgba('#020e18', alpha));
        grad.addColorStop(0.5, rgba('#08344f', alpha * 0.85));
        grad.addColorStop(1, 'rgba(8,52,79,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.ellipse(cx, groundY, w * 0.18, w * 0.055, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    // 渦に巻き込まれる無数の泡（中心へ吸い込まれながら回転）
    for (let i = 0; i < 30; i++) {
      const startAng = rand(0, Math.PI * 2);
      const startR = rand(w * 0.16, w * 0.4);
      particles.push({
        delay: rand(0, 180),
        maxLife: rand(320, 460),
        startAng, startR,
        size: rand(2, 5),
        draw(ctx, t) {
          const e = easeInCubic(t);
          const ang = this.startAng + t * 8;
          const r = this.startR * (1 - e * 0.9);
          const x = cx + Math.cos(ang) * r;
          const y = groundY + Math.sin(ang) * r * 0.3;
          const alpha = (1 - t) * 0.8;
          ctx.fillStyle = rgba('#eaf8ff', alpha);
          ctx.beginPath();
          ctx.arc(x, y, this.size, 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }

    // ---- 幕2: 回転・蛇行しながら突き上げる巨大な水柱（メインビジュアル）----
    const columnStart = 190;
    // 柱の芯（セグメント分割してノイズで蛇行させ、直線的な楕円に見せない）
    particles.push({
      delay: columnStart,
      maxLife: 660,
      blend: 'lighter',
      draw(ctx, t) {
        const rise = easeOutCubic(Math.min(1, t * 1.35));
        const h0 = h * 0.98 * rise;
        const alpha = (1 - Math.max(0, (t - 0.5) / 0.5)) * 0.85;
        const segments = 16;
        for (let s = 0; s < segments; s++) {
          const st = s / segments;
          const y = groundY - h0 * st;
          const wob = noise1(st * 5 + t * 7, seedA) * lerp(3, 22, st);
          const x = cx + wob;
          const segW = lerp(34, 10, st);
          const grad = ctx.createRadialGradient(x, y, 0, x, y, segW * 1.5);
          grad.addColorStop(0, rgba('#eaf8ff', alpha));
          grad.addColorStop(0.4, rgba('#3ca0e6', alpha * 0.9));
          grad.addColorStop(0.75, rgba('#0d5c8c', alpha * 0.7));
          grad.addColorStop(1, 'rgba(13,92,140,0)');
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(x, y, segW, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    });
    // 柱に巻き付く螺旋の飛沫（回転しながら上昇、数を大幅増量）
    for (let i = 0; i < 70; i++) {
      const phase = rand(0, Math.PI * 2);
      const radius0 = rand(12, 44);
      particles.push({
        delay: columnStart + rand(0, 340),
        maxLife: rand(480, 720),
        phase, radius0,
        size: rand(3, 9),
        col: pick(['#3ca0e6', '#7cc4f0', '#eaf8ff', '#1c6fb0', '#bfe8ff']),
        blend: 'lighter',
        draw(ctx, t) {
          const rise = easeOutCubic(t);
          const y = groundY - rise * h * 0.98 + noise1(t * 9, this.phase) * 6;
          const spin = t * 11 + this.phase;
          const rad = this.radius0 * (1 - t * 0.35) + Math.sin(t * 20) * 3;
          const x = cx + Math.cos(spin) * rad;
          const alpha = t < 0.06 ? t / 0.06 : (1 - Math.max(0, (t - 0.68) / 0.32));
          ctx.fillStyle = rgba(this.col, alpha);
          ctx.shadowColor = rgba('#bfe8ff', 0.85);
          ctx.shadowBlur = 7;
          ctx.beginPath();
          ctx.ellipse(x, y, this.size, this.size * 1.5, spin, 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }
    // 頂点で弾ける飛沫の大爆発（多層・時間差）
    for (let i = 0; i < 2; i++) {
      particles.push({
        delay: columnStart + 400 + i * 60,
        maxLife: 380 - i * 60,
        blend: 'lighter',
        draw(ctx, t) {
          const alpha = (1 - t) * (0.9 - i * 0.2);
          const r = lerp(10, w * (0.32 + i * 0.1), easeOutQuint(t));
          const grad = ctx.createRadialGradient(cx, groundY - h * 0.85, 0, cx, groundY - h * 0.85, r);
          grad.addColorStop(0, rgba('#ffffff', alpha));
          grad.addColorStop(0.4, rgba('#eaf8ff', alpha * 0.9));
          grad.addColorStop(0.7, rgba('#3ca0e6', alpha * 0.7));
          grad.addColorStop(1, 'rgba(60,160,230,0)');
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(cx, groundY - h * 0.85, r, 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }
    // 天辺から飛び散る大粒の水塊（放物線を描いて落下）
    for (let i = 0; i < 24; i++) {
      const ang = rand(-Math.PI * 0.9, -Math.PI * 0.1);
      const speed = rand(w * 0.14, w * 0.34);
      particles.push({
        delay: columnStart + rand(400, 460),
        maxLife: rand(420, 640),
        ang, speed,
        size: rand(4, 10),
        blend: 'lighter',
        draw(ctx, t) {
          const e = easeOutCubic(Math.min(1, t * 1.6));
          const grav = t * t * h * 0.55;
          const x = cx + Math.cos(this.ang) * this.speed * e;
          const y = (groundY - h * 0.85) + Math.sin(this.ang) * this.speed * e + grav;
          const alpha = (1 - t) * 0.9;
          const grad = ctx.createRadialGradient(x, y, 0, x, y, this.size * (1 - t * 0.4));
          grad.addColorStop(0, rgba('#eaf8ff', alpha));
          grad.addColorStop(0.6, rgba('#3ca0e6', alpha * 0.85));
          grad.addColorStop(1, 'rgba(60,160,230,0)');
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(x, y, this.size * (1 - t * 0.4), 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }
    // 底面に広がる波紋（多重・重層）
    for (let i = 0; i < 4; i++) {
      particles.push({
        delay: columnStart + i * 90,
        maxLife: 460 - i * 30,
        draw(ctx, t) {
          const r = lerp(w * 0.05, R * (0.45 + i * 0.08), easeOutQuint(t));
          const alpha = (1 - t) * (0.65 - i * 0.1);
          ctx.strokeStyle = rgba('#3ca0e6', alpha);
          ctx.lineWidth = 3.5 * (1 - t * 0.4);
          ctx.beginPath();
          ctx.ellipse(cx, groundY, r, r * 0.28, 0, 0, Math.PI * 2);
          ctx.stroke();
        }
      });
    }

    // ---- 幕3: 辺り一面に激しい雨が降り注ぐ（密度を大幅増量、風で斜めに流れる質感）----
    const rainStart = 600;
    for (let i = 0; i < 64; i++) {
      const x0 = rand(-w * 0.08, w * 1.08);
      const y0 = rand(-h * 0.35, h * 0.1);
      particles.push({
        delay: rainStart + rand(0, 460),
        maxLife: rand(380, 600),
        x0, y0,
        len: rand(18, 34),
        speed: rand(0.9, 1.3),
        draw(ctx, t) {
          const fall = easeInCubic(t) * this.speed;
          const y = this.y0 + fall * (h - this.y0 + 60);
          const x = this.x0 - fall * 22;
          const alpha = t < 0.08 ? t / 0.08 : (1 - Math.max(0, (t - 0.78) / 0.22));
          ctx.strokeStyle = rgba('#aee0ff', alpha * 0.9);
          ctx.lineWidth = 2;
          ctx.shadowColor = rgba('#eaf8ff', 0.4);
          ctx.shadowBlur = 2;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x - 7, y + this.len);
          ctx.stroke();
        }
      });
    }
    // 雨粒が地面に落ちて跳ねる小さな飛沫（地面付近にランダムに発生）
    for (let i = 0; i < 22; i++) {
      const x0 = rand(w * 0.05, w * 0.95);
      particles.push({
        delay: rainStart + 120 + rand(0, 520),
        maxLife: rand(160, 260),
        x0,
        draw(ctx, t) {
          const r = lerp(1, 8, easeOutCubic(t));
          const alpha = (1 - t) * 0.6;
          ctx.strokeStyle = rgba('#eaf8ff', alpha);
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.ellipse(this.x0, groundY + h * 0.04, r, r * 0.35, 0, 0, Math.PI * 2);
          ctx.stroke();
        }
      });
    }
  }

  // ---- イルミンスール：大地から大樹が突き上げ、土くれが周囲に散らばる ----
  // ============================================================
  // イルミンスール：大地を割って世界樹が突き上げる超高火力演出
  // 構成：①大地の隆起と地割れ ②土煙を纏いながら乱流で伸びる幹 ③枝が波打つように展開
  //       ④満開の樹冠が咲き誇る爆発的発光 ⑤木漏れ日と舞い散る葉・花びら・胞子
  // 「ノイズによる枝の不規則な這い方」「土から緑への階調」「加算合成の生命力の輝き」を軸に強化。
  // ============================================================
  function spawnYggdrasillSpecial(particles, w, h) {
    const cx = w / 2, groundY = h * 0.92;
    const R = Math.max(w, h);
    const seedA = rand(0, 100), seedB = rand(0, 100);

    // ---- 幕0: 大地が唸りを上げて隆起する予兆（土色の熱波と地鳴りの光）----
    particles.push({
      maxLife: 210,
      draw(ctx, t) {
        const alpha = Math.sin(Math.PI * clamp01(t)) * 0.7;
        const wob = noise1(t * 6, seedA) * 12;
        const grad = ctx.createRadialGradient(cx + wob, groundY, 0, cx + wob, groundY, w * 0.5);
        grad.addColorStop(0, rgba('#c9a15a', alpha));
        grad.addColorStop(0.45, rgba('#7a5230', alpha * 0.6));
        grad.addColorStop(1, 'rgba(122,82,48,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, groundY - h * 0.16, w, h * 0.28);
      }
    });
    // 地割れの亀裂（内側に発光ラインを重ね、根が這うような質感に）
    for (let i = 0; i < 7; i++) {
      const ang = rand(-2.7, -0.4);
      const ox = rand(-w * 0.28, w * 0.28);
      particles.push({
        delay: 25 + i * 13,
        maxLife: 290,
        ang, ox,
        draw(ctx, t) {
          const len = lerp(6, w * (0.14 + Math.abs(ox) / w * 0.12), easeOutCubic(t));
          const alpha = (1 - t) * 0.9;
          ctx.save();
          ctx.translate(cx + this.ox, groundY);
          ctx.rotate(this.ang);
          ctx.strokeStyle = rgba('#4a3018', alpha);
          ctx.lineWidth = 4;
          ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(len, 0); ctx.stroke();
          ctx.strokeStyle = rgba('#c9e070', alpha);
          ctx.lineWidth = 1.6;
          ctx.shadowColor = rgba('#e6ffb0', 0.9);
          ctx.shadowBlur = 10;
          ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(len, 0); ctx.stroke();
          ctx.restore();
        }
      });
    }
    // 土煙が先行して立ち上る（幹が突き上げる前の下地、質感の重さを出す）
    for (let i = 0; i < 14; i++) {
      const x0 = cx + rand(-w * 0.2, w * 0.2);
      particles.push({
        delay: 60 + rand(0, 160),
        maxLife: rand(500, 720),
        x0,
        size: rand(30, 58),
        seed: rand(0, 100),
        draw(ctx, t) {
          const rise = easeOutCubic(t);
          const y = groundY - rise * h * rand(0.2, 0.4);
          const wob = noise1(t * 5 + this.seed, this.seed) * 20;
          const x = this.x0 + wob;
          const alpha = (t < 0.15 ? t / 0.15 : (1 - Math.max(0, (t - 0.5) / 0.5))) * 0.4;
          const size = this.size * (0.6 + t * 0.7);
          const grad = ctx.createRadialGradient(x, y, 0, x, y, size);
          grad.addColorStop(0, rgba('#a8875a', alpha));
          grad.addColorStop(0.6, rgba('#6a4a26', alpha * 0.6));
          grad.addColorStop(1, 'rgba(106,74,38,0)');
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(x, y, size, 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }

    // ---- 幕2: 巨大な世界樹が地面から突き上げる（幹はノイズで少し蛇行させ生命感を出す）----
    const treeStart = 190;
    particles.push({
      delay: treeStart,
      maxLife: 660,
      draw(ctx, t) {
        const rise = easeOutCubic(Math.min(1, t * 1.3));
        const h0 = h * 0.98 * rise;
        const alpha = (1 - Math.max(0, (t - 0.6) / 0.4)) * 0.96;
        const segments = 12;
        ctx.save();
        ctx.globalAlpha = alpha;
        // 幹を複数セグメントに分けて左右にノイズで揺らし、生きた木肌の質感に
        ctx.beginPath();
        const leftPts = [], rightPts = [];
        for (let s = 0; s <= segments; s++) {
          const st = s / segments;
          const y = groundY - h0 * st;
          const wob = noise1(st * 4 + t * 2, seedB) * lerp(2, 10, st);
          const width = lerp(46, 22, st);
          leftPts.push([cx - width / 2 + wob, y]);
          rightPts.push([cx + width / 2 + wob, y]);
        }
        ctx.moveTo(leftPts[0][0], leftPts[0][1]);
        for (let s = 1; s < leftPts.length; s++) ctx.lineTo(leftPts[s][0], leftPts[s][1]);
        for (let s = rightPts.length - 1; s >= 0; s--) ctx.lineTo(rightPts[s][0], rightPts[s][1]);
        ctx.closePath();
        const grad = ctx.createLinearGradient(cx, groundY, cx, groundY - h0);
        grad.addColorStop(0, '#3a2410');
        grad.addColorStop(0.5, '#5a3a1e');
        grad.addColorStop(1, '#8a6a3a');
        ctx.fillStyle = grad;
        ctx.fill();
        // 木肌の縦筋（質感の追加）
        ctx.strokeStyle = 'rgba(40,24,10,0.35)';
        ctx.lineWidth = 1.4;
        for (let s = 0; s < leftPts.length - 1; s++) {
          ctx.beginPath();
          ctx.moveTo(lerp(leftPts[s][0], rightPts[s][0], 0.3), leftPts[s][1]);
          ctx.lineTo(lerp(leftPts[s + 1][0], rightPts[s + 1][0], 0.3), leftPts[s + 1][1]);
          ctx.stroke();
        }
        ctx.restore();
      }
    });
    // 幹から左右に伸びる枝（ノイズで曲がり、途中で二股に分かれるような複雑さを追加）
    for (let i = 0; i < 12; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const heightRatio = 0.28 + (i / 12) * 0.65;
      const branchLen = w * rand(0.13, 0.24);
      const seed = rand(0, 100);
      particles.push({
        delay: treeStart + 100 + i * 34,
        maxLife: 440,
        side, heightRatio, branchLen, seed,
        draw(ctx, t) {
          const alpha = (1 - Math.max(0, (t - 0.6) / 0.4)) * 0.92;
          const grow = easeOutCubic(t);
          const y0 = groundY - h * 0.98 * this.heightRatio;
          const x0 = cx;
          ctx.strokeStyle = rgba('#6a4a26', alpha);
          ctx.lineWidth = 7 * (1 - this.heightRatio * 0.5);
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(x0, y0);
          const segs = 5;
          let px = x0, py = y0;
          for (let s = 1; s <= segs; s++) {
            const st = (s / segs) * grow;
            const bend = noise1(st * 5 + this.seed, this.seed) * 14;
            const nx = x0 + this.side * this.branchLen * st + bend;
            const ny = y0 - this.branchLen * 0.4 * st;
            ctx.lineTo(nx, ny);
            px = nx; py = ny;
          }
          ctx.stroke();
        }
      });
    }
    // 樹冠（枝葉が茂る緑のグロー、数を増やし多色階調で「満開の生命力」を表現、加算合成で発光）
    for (let i = 0; i < 10; i++) {
      const ox = rand(-w * 0.26, w * 0.26);
      const oy = rand(-h * 0.07, h * 0.07);
      particles.push({
        delay: treeStart + 230 + i * 26,
        maxLife: 480,
        ox, oy,
        size: rand(w * 0.13, w * 0.24),
        col: pick(['#5cb85c', '#7fd35f', '#3f9142', '#a8e063', '#c9f06a']),
        blend: 'lighter',
        draw(ctx, t) {
          const alpha = (1 - Math.max(0, (t - 0.6) / 0.4)) * 0.75 * clamp01(t * 3);
          const y = groundY - h * 0.98 + this.oy;
          const x = cx + this.ox;
          const grad = ctx.createRadialGradient(x, y, 0, x, y, this.size);
          grad.addColorStop(0, rgba('#f2ffd0', alpha));
          grad.addColorStop(0.35, rgba(this.col, alpha * 0.9));
          grad.addColorStop(1, 'rgba(63,145,66,0)');
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(x, y, this.size, 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }
    // 満開の瞬間の中心フラッシュ（樹冠が咲き誇る一撃）
    particles.push({
      delay: treeStart + 250,
      maxLife: 340,
      blend: 'lighter',
      draw(ctx, t) {
        const alpha = (1 - t) * 0.85;
        const r = lerp(10, w * 0.34, easeOutQuint(t));
        const y = groundY - h * 0.98;
        const grad = ctx.createRadialGradient(cx, y, 0, cx, y, r);
        grad.addColorStop(0, rgba('#ffffff', alpha));
        grad.addColorStop(0.4, rgba('#e6ffb0', alpha * 0.9));
        grad.addColorStop(0.7, rgba('#7fd35f', alpha * 0.6));
        grad.addColorStop(1, 'rgba(127,211,95,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    // 根本の砂煙の爆風リング（多重化）
    for (let i = 0; i < 3; i++) {
      particles.push({
        delay: treeStart + i * 70,
        maxLife: 380 - i * 30,
        draw(ctx, t) {
          const r = lerp(w * 0.06, R * (0.42 + i * 0.1), easeOutQuint(t));
          const alpha = (1 - t) * (0.7 - i * 0.14);
          ctx.strokeStyle = rgba(i === 0 ? '#e6ffb0' : '#a8875a', alpha);
          ctx.lineWidth = (8 - i) * (1 - t * 0.6);
          ctx.beginPath();
          ctx.ellipse(cx, groundY, r, r * 0.3, 0, 0, Math.PI * 2);
          ctx.stroke();
        }
      });
    }

    // ---- 幕3: 木漏れ日の光条（樹冠から放射状に差し込む光、生命力の演出）----
    for (let i = 0; i < 8; i++) {
      const ang = rand(0, Math.PI * 2);
      particles.push({
        delay: treeStart + 280 + rand(0, 100),
        maxLife: rand(400, 560),
        ang,
        len: rand(w * 0.2, w * 0.4),
        blend: 'lighter',
        draw(ctx, t) {
          const alpha = (1 - t) * 0.3;
          const y = groundY - h * 0.98;
          const grow = easeOutCubic(t);
          ctx.save();
          ctx.translate(cx, y);
          ctx.rotate(this.ang);
          const grad = ctx.createLinearGradient(0, 0, this.len * grow, 0);
          grad.addColorStop(0, rgba('#ffffe0', alpha));
          grad.addColorStop(1, 'rgba(255,255,224,0)');
          ctx.strokeStyle = grad;
          ctx.lineWidth = 5;
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.lineTo(this.len * grow, 0);
          ctx.stroke();
          ctx.restore();
        }
      });
    }

    // ---- 幕4: 葉っぱ・花びら・胞子が舞い散る（土くれよりも軽やかに、種類を増やす）----
    const debrisStart = 640;
    // 舞い散る葉（回転する木の葉型パス）
    for (let i = 0; i < 26; i++) {
      const x0 = rand(w * 0.05, w * 0.95);
      const y0 = rand(-h * 0.25, h * 0.3);
      particles.push({
        delay: debrisStart + rand(0, 480),
        maxLife: rand(700, 1000),
        x0, y0,
        size: rand(5, 10),
        rot: rand(0, Math.PI * 2),
        spin: rand(-2.5, 2.5),
        sway: rand(14, 34),
        swaySpeed: rand(1, 2.2),
        col: pick(['#5cb85c', '#7fd35f', '#a8e063', '#3f9142']),
        draw(ctx, t) {
          const fall = easeInCubic(t) * 0.85;
          const y = this.y0 + fall * (h - this.y0) * 1.1;
          const x = this.x0 + Math.sin(t * this.swaySpeed * Math.PI + this.rot) * this.sway;
          const alpha = t < 0.06 ? t / 0.06 : (1 - Math.max(0, (t - 0.75) / 0.25));
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(this.rot + t * this.spin);
          ctx.fillStyle = rgba(this.col, alpha);
          // 葉っぱ型（涙滴パス）
          ctx.beginPath();
          ctx.moveTo(0, -this.size);
          ctx.quadraticCurveTo(this.size * 0.8, 0, 0, this.size);
          ctx.quadraticCurveTo(-this.size * 0.8, 0, 0, -this.size);
          ctx.fill();
          ctx.restore();
        }
      });
    }
    // 光る胞子・花粉（小粒、加算合成で幻想的に）
    for (let i = 0; i < 30; i++) {
      const x0 = rand(w * 0.05, w * 0.95);
      const y0 = rand(-h * 0.1, h * 0.4);
      particles.push({
        delay: debrisStart + rand(0, 560),
        maxLife: rand(600, 900),
        x0, y0,
        size: rand(1.5, 3.5),
        seed: rand(0, 100),
        blend: 'lighter',
        draw(ctx, t) {
          const drift = noise1(t * 3, this.seed) * 30;
          const rise = -t * h * 0.15;
          const x = this.x0 + drift;
          const y = this.y0 + rise + Math.sin(t * 4 + this.seed) * 10;
          const alpha = (t < 0.1 ? t / 0.1 : (1 - Math.max(0, (t - 0.6) / 0.4))) * 0.85;
          ctx.fillStyle = rgba('#f2ffb0', alpha);
          ctx.shadowColor = rgba('#f2ffb0', 0.9);
          ctx.shadowBlur = 6;
          ctx.beginPath();
          ctx.arc(x, y, this.size, 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }
    // 土くれの飛散（重みのある要素として残す）
    for (let i = 0; i < 16; i++) {
      const x0 = rand(w * 0.1, w * 0.9);
      const y0 = rand(-h * 0.1, h * 0.2);
      particles.push({
        delay: debrisStart + rand(0, 380),
        maxLife: rand(500, 720),
        x0, y0,
        size: rand(3, 6),
        rot: rand(0, Math.PI * 2),
        spin: rand(-4, 4),
        col: pick(['#8a6a3a', '#a8875a', '#6a4a26']),
        draw(ctx, t) {
          const fall = easeInCubic(t);
          const y = this.y0 + fall * (h - this.y0) * 1.05;
          const x = this.x0 + Math.sin(t * 3 + this.rot) * 6;
          const alpha = t < 0.08 ? t / 0.08 : (1 - Math.max(0, (t - 0.78) / 0.22));
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(this.rot + t * this.spin);
          ctx.fillStyle = rgba(this.col, alpha);
          ctx.beginPath();
          ctx.rect(-this.size / 2, -this.size / 2, this.size, this.size);
          ctx.fill();
          ctx.restore();
        }
      });
    }
  }

  // ============================================================
  // かみなり：雷雲が渦巻き、フラクタル分岐した本物の稲妻が天から撃ち下ろす演出
  // 構成：①雷雲が空を覆い明滅する予兆 ②枝分かれしまくる本物の稲妻が垂直落下
  //       ③着弾の瞬間に視界が真っ白になる大閃光 ④着弾点からの放電衝撃波と地面のスパーク
  //       ⑤残光の中を漂う静電気の火花と余韻の雷鳴フラッシュ
  // 「稲妻はギザギザの折れ線＋フラクタル分岐」「着弾は白飛びするほどの閃光」「電気特有の紫〜白の階調」がキモ。
  // ============================================================
  function spawnThunderSpecial(particles, w, h) {
    const cx = w / 2, groundY = h * 0.9;
    const R = Math.max(w, h);
    const seedA = rand(0, 100), seedB = rand(0, 100);

    // ---- 幕0: 雷雲が空を覆い、内部で明滅する（本雷が落ちる前の重い予感）----
    for (let i = 0; i < 5; i++) {
      const ox = rand(-w * 0.3, w * 0.3);
      particles.push({
        delay: i * 20,
        maxLife: 220,
        ox,
        seed: rand(0, 100),
        draw(ctx, t) {
          const flicker = Math.abs(noise1(t * 22, this.seed)) * 0.7 + 0.2;
          const alpha = Math.sin(Math.PI * clamp01(t)) * flicker * 0.6;
          const grad = ctx.createRadialGradient(cx + this.ox, h * 0.05, 0, cx + this.ox, h * 0.05, w * 0.4);
          grad.addColorStop(0, rgba('#e8dfff', alpha));
          grad.addColorStop(0.5, rgba('#7a5ccf', alpha * 0.6));
          grad.addColorStop(1, 'rgba(58,40,110,0)');
          ctx.fillStyle = grad;
          ctx.fillRect(0, -h * 0.1, w, h * 0.4);
        }
      });
    }
    // 暗い雲の帯（電気を帯びた重厚な質感の下地）
    particles.push({
      maxLife: 200,
      draw(ctx, t) {
        const alpha = Math.sin(Math.PI * clamp01(t)) * 0.5;
        const grad = ctx.createLinearGradient(0, -h * 0.1, 0, h * 0.28);
        grad.addColorStop(0, rgba('#2a1f4a', alpha));
        grad.addColorStop(1, 'rgba(42,31,74,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, -h * 0.1, w, h * 0.4);
      }
    });

    // ---- ギザギザのフラクタル稲妻を描くヘルパー関数 ----
    // 再帰的に折れ線を分割してランダムにずらし（中点変位法）、本物の稲妻特有の
    // 鋭くギザギザした軌道を作る。枝分かれ（サブボルト）も一定確率で生やす。
    function buildBoltPath(x0, y0, x1, y1, seed, depth) {
      const pts = [[x0, y0], [x1, y1]];
      let d = seed;
      for (let iter = 0; iter < depth; iter++) {
        const next = [pts[0]];
        for (let i = 0; i < pts.length - 1; i++) {
          const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
          const mx = (ax + bx) / 2, my = (ay + by) / 2;
          d = (d * 9301 + 49297) % 233280;
          const rnd = d / 233280;
          const dx = bx - ax, dy = by - ay;
          const len = Math.hypot(dx, dy) || 1;
          const nx = -dy / len, ny = dx / len;
          const disp = (rnd - 0.5) * len * (0.35 / (iter + 1));
          next.push([mx + nx * disp, my + ny * disp]);
          next.push([bx, by]);
        }
        pts.length = 0;
        pts.push(...next);
      }
      return pts;
    }
    function drawBolt(ctx, pts, alpha, coreCol, glowCol, widthMul) {
      // 外側の太いグロー（発光）
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = rgba(glowCol, alpha * 0.55);
      ctx.lineWidth = 10 * widthMul;
      ctx.shadowColor = rgba(glowCol, 0.95);
      ctx.shadowBlur = 26;
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.beginPath();
      pts.forEach(([x, y], i) => i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y));
      ctx.stroke();
      // 内側の細い白い芯
      ctx.strokeStyle = rgba(coreCol, alpha);
      ctx.lineWidth = 2.4 * widthMul;
      ctx.shadowBlur = 10;
      ctx.beginPath();
      pts.forEach(([x, y], i) => i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y));
      ctx.stroke();
      ctx.restore();
    }

    // ---- 幕1: 本雷が2〜3本、時間差でギザギザに天から撃ち下ろす ----
    const boltStart = 130;
    const boltCount = 3;
    const boltSeeds = [];
    for (let i = 0; i < boltCount; i++) {
      const x0 = cx + rand(-w * 0.22, w * 0.22);
      const seed = Math.floor(rand(1, 99999));
      const path = buildBoltPath(x0, -h * 0.08, x0 + rand(-w * 0.1, w * 0.1), groundY, seed, 5);
      boltSeeds.push({ x0, path });
      // 主稲妻本体：先端から徐々に伸びる「描画進捗」でリアルな落雷の速度感を出す
      particles.push({
        delay: boltStart + i * 90,
        maxLife: i === 0 ? 130 : 90,
        path, idx: i,
        draw(ctx, t) {
          const grow = Math.min(1, t * 3.2); // 一瞬で伸びきる（雷は一瞬）
          const cut = Math.floor(this.path.length * grow);
          const visible = this.path.slice(0, Math.max(2, cut));
          const alpha = t < 0.5 ? 1 : (1 - (t - 0.5) / 0.5);
          drawBolt(ctx, visible, alpha, '#ffffff', this.idx === 0 ? '#c9b8ff' : '#8a6fe0', this.idx === 0 ? 1.3 : 0.8);
        }
      });
      // 枝分かれのサブボルト（本体の途中から数本、短く分岐）
      for (let b = 0; b < 3; b++) {
        const branchStartIdx = Math.floor(path.length * rand(0.2, 0.6));
        const [bx, by] = path[branchStartIdx] || [x0, groundY * 0.5];
        const branchPath = buildBoltPath(bx, by, bx + rand(-w * 0.12, w * 0.12), by + rand(h * 0.08, h * 0.2), seed + b + 1, 3);
        particles.push({
          delay: boltStart + i * 90 + rand(10, 40),
          maxLife: 70,
          branchPath,
          draw(ctx, t) {
            const alpha = (1 - t) * 0.8;
            drawBolt(ctx, this.branchPath, alpha, '#ffffff', '#a894ff', 0.5);
          }
        });
      }
    }

    // ---- 幕2: 着弾の瞬間、視界が真っ白になるほどの巨大閃光（複数回明滅で雷特有のちらつき感）----
    const impactStart = boltStart + 40;
    for (let i = 0; i < 3; i++) {
      particles.push({
        delay: impactStart + i * 55,
        maxLife: 40 + i * 10,
        blend: 'lighter',
        draw(ctx, t) {
          const alpha = (1 - t) * (i === 0 ? 1 : 0.5);
          ctx.fillStyle = rgba('#ffffff', alpha);
          ctx.fillRect(0, 0, w, h);
        }
      });
    }
    // 着弾点の巨大な光球（紫白のコントラスト）
    particles.push({
      delay: impactStart,
      maxLife: 260,
      blend: 'lighter',
      draw(ctx, t) {
        const alpha = (1 - t) * 0.95;
        const r = lerp(6, w * 0.34, easeOutQuint(t));
        const grad = ctx.createRadialGradient(cx, groundY, 0, cx, groundY, r);
        grad.addColorStop(0, rgba('#ffffff', alpha));
        grad.addColorStop(0.35, rgba('#e0d0ff', alpha * 0.9));
        grad.addColorStop(0.7, rgba('#8a6fe0', alpha * 0.6));
        grad.addColorStop(1, 'rgba(138,111,224,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, groundY, r, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    // 放電の衝撃波リング（多重）
    for (let i = 0; i < 3; i++) {
      particles.push({
        delay: impactStart + i * 40,
        maxLife: 300 - i * 30,
        blend: 'lighter',
        draw(ctx, t) {
          const r = lerp(w * 0.04, R * (0.4 + i * 0.14), easeOutQuint(t));
          const alpha = (1 - t) * (0.85 - i * 0.18);
          ctx.strokeStyle = rgba(i === 0 ? '#ffffff' : '#c9b8ff', alpha);
          ctx.lineWidth = (7 - i) * (1 - t * 0.5);
          ctx.shadowColor = rgba('#c9b8ff', 0.9);
          ctx.shadowBlur = 16;
          ctx.beginPath();
          ctx.arc(cx, groundY, r, 0, Math.PI * 2);
          ctx.stroke();
        }
      });
    }
    // 地面を這うギザギザの放電スパーク（着弾点から複数方向へ）
    for (let i = 0; i < 8; i++) {
      const ang = (i / 8) * Math.PI * 2 + rand(-0.2, 0.2);
      const len = rand(w * 0.1, w * 0.22);
      const path = buildBoltPath(cx, groundY, cx + Math.cos(ang) * len, groundY + Math.sin(ang) * len * 0.25, Math.floor(rand(1, 99999)), 3);
      particles.push({
        delay: impactStart + rand(0, 30),
        maxLife: 220,
        path,
        draw(ctx, t) {
          const grow = Math.min(1, t * 4);
          const cut = Math.floor(this.path.length * grow);
          const visible = this.path.slice(0, Math.max(2, cut));
          const alpha = (1 - t) * 0.85;
          drawBolt(ctx, visible, alpha, '#ffffff', '#a894ff', 0.4);
        }
      });
    }
    // 弾ける静電気の火花（小粒、飛散）
    for (let i = 0; i < 26; i++) {
      const ang = rand(0, Math.PI * 2);
      const speed = rand(w * 0.06, w * 0.2);
      particles.push({
        delay: impactStart + rand(0, 60),
        maxLife: rand(200, 380),
        ang, speed,
        size: rand(2, 4),
        blend: 'lighter',
        draw(ctx, t) {
          const e = easeOutCubic(t);
          const x = cx + Math.cos(this.ang) * this.speed * e;
          const y = groundY + Math.sin(this.ang) * this.speed * e * 0.4;
          const alpha = (1 - t) * 0.9 * (Math.abs(noise1(t * 20, this.ang)) * 0.5 + 0.5);
          ctx.fillStyle = rgba('#e8dfff', alpha);
          ctx.shadowColor = rgba('#c9b8ff', 0.9);
          ctx.shadowBlur = 8;
          ctx.beginPath();
          ctx.arc(x, y, this.size, 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }

    // ---- 幕3: 残響の雷鳴フラッシュ（遠くでもう一度光るような余韻）----
    particles.push({
      delay: impactStart + 340,
      maxLife: 220,
      blend: 'lighter',
      draw(ctx, t) {
        const alpha = Math.sin(Math.PI * clamp01(t)) * 0.35;
        ctx.fillStyle = rgba('#d8caff', alpha);
        ctx.fillRect(0, 0, w, h);
      }
    });
    // 空に漂う残留放電の光点
    for (let i = 0; i < 14; i++) {
      const x0 = rand(w * 0.1, w * 0.9);
      const y0 = rand(h * 0.05, h * 0.5);
      particles.push({
        delay: impactStart + 200 + rand(0, 300),
        maxLife: rand(300, 480),
        x0, y0,
        seed: rand(0, 100),
        blend: 'lighter',
        draw(ctx, t) {
          const flicker = Math.abs(noise1(t * 16, this.seed));
          const alpha = (1 - t) * flicker * 0.8;
          ctx.fillStyle = rgba('#e8dfff', alpha);
          ctx.shadowColor = rgba('#c9b8ff', 0.9);
          ctx.shadowBlur = 6;
          ctx.beginPath();
          ctx.arc(this.x0, this.y0, 2, 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }
  }

  // ============================================================
  // りゅうせいぐん：満天の夜空を、無数の流星が左上から右下へ長い尾を引いて降り注ぐ演出
  // 構成：①空が深い夜に暗転し、星が瞬く予兆 ②左上の空から右下へ、流星が次々に斜めに走り抜ける
  //       ③一発ごとに着弾して火柱＋衝撃波＋岩片が弾け、地面が赤熱する
  //       ④流星の密度が最高潮に達した後、特大の主星が左上の空から斜めに落ちる
  //       ⑤主星の着弾で画面全体を焼き尽くす大爆発 ⑥余燼（残り火・火の粉）が漂う余韻
  // 原作の「夜空を斜めに切り裂く流星の雨」の見え方を最優先する：
  //   ・全流星の落下方向を左上→右下に統一する（一つの空から降っている統一感）
  //   ・尾を長く、頭を小さく鋭くして「走っている」速度感を出す
  //   ・後半ほど密度を上げ、最後に特大の主星で締める
  // 配色は 深い夜空（濃紺〜藍）と 橙〜白金（流星・爆発）のコントラストで統一する。
  // ============================================================
  function spawnMeteorShowerSpecial(particles, w, h) {
    const cx = w / 2, groundY = h * 0.88;
    const R = Math.max(w, h);
    // 全ての流星が落ちる共通の向き：左上 → 右下（画面上で約35°の緩い斜め）。
    // ※canvasはy軸が下向きなので、右へ進みつつ下へ進む単位ベクトルが (cos, sin) の正の値になる。
    //   角度を浅め(35°)にすると流星が横に長く流れて見え、原作の「夜空を走る流星」に近づく。
    const FALL_ANG = Math.PI * 0.195;               // ≒ 35°
    const fdx = Math.cos(FALL_ANG), fdy = Math.sin(FALL_ANG);

    // ---- 幕0: 空が深い夜に暗転する（流星を際立たせる下地）----
    particles.push({
      maxLife: 3000,   // 演出の全体尺に合わせる（主星の落下〜大爆発の間も暗いまま保つ）
      draw(ctx, t) {
        // 素早く暗くなり、大爆発の余韻が引く終盤(約2000ms〜)にゆっくり明けていく
        const a = t < 0.06 ? t / 0.06 : (t > 0.85 ? 1 - (t - 0.85) / 0.15 : 1);
        const grad = ctx.createLinearGradient(0, 0, 0, h);
        grad.addColorStop(0, rgba('#040414', a * 0.84));
        grad.addColorStop(0.5, rgba('#0a0c2e', a * 0.66));
        grad.addColorStop(1, rgba('#1a1236', a * 0.36));
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);
      }
    });
    // 天の川のような淡い光の帯（夜空の奥行き。流星と同じ左上→右下の向きに流す）
    particles.push({
      maxLife: 3000,
      blend: 'lighter',
      draw(ctx, t) {
        const env = t < 0.08 ? t / 0.08 : (t > 0.85 ? (1 - t) / 0.15 : 1);
        ctx.save();
        ctx.translate(w * 0.5, h * 0.3);
        ctx.rotate(FALL_ANG);
        const g = ctx.createLinearGradient(0, -h * 0.16, 0, h * 0.16);
        g.addColorStop(0, 'rgba(120,130,230,0)');
        g.addColorStop(0.5, rgba('#8a96ff', env * 0.16));
        g.addColorStop(1, 'rgba(120,130,230,0)');
        ctx.fillStyle = g;
        ctx.fillRect(-R, -h * 0.16, R * 2, h * 0.32);
        ctx.restore();
      }
    });
    // 空に瞬く星（暗転した空の奥行き。数を増やして満天の星空にする）
    for (let i = 0; i < 70; i++) {
      const sx = rand(0, w), sy = rand(0, h * 0.72);
      const seed = rand(0, 100);
      const sz = rand(0.7, 2.3);
      particles.push({
        delay: rand(0, 220),
        maxLife: 2750,
        blend: 'lighter',
        draw(ctx, t) {
          const env = t < 0.06 ? t / 0.06 : (t > 0.85 ? (1 - t) / 0.15 : 1);
          const tw = Math.abs(noise1(t * 14, seed)) * 0.7 + 0.3;
          ctx.fillStyle = rgba(i % 5 === 0 ? '#ffe9c0' : '#dfe4ff', env * tw * 0.9);
          ctx.beginPath();
          ctx.arc(sx, sy, sz, 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }

    // ---- 流星を1本描くヘルパー（炎の尾を引く隕石）----
    // 「頭（明るい核）」と「尾（後方に伸びる多層の炎）」で構成する。
    // headX/Y は現在位置、tail は尾の長さ、size は頭の大きさ、a は不透明度。
    function drawMeteor(ctx, headX, headY, tail, size, a) {
      const tx = headX - fdx * tail, ty = headY - fdy * tail;
      ctx.save();
      ctx.lineCap = 'round';
      // 外側の広い炎（橙〜赤）
      const g1 = ctx.createLinearGradient(tx, ty, headX, headY);
      g1.addColorStop(0, 'rgba(255,80,20,0)');
      g1.addColorStop(0.6, rgba('#ff7a1a', a * 0.5));
      g1.addColorStop(1, rgba('#ffb84a', a * 0.9));
      ctx.strokeStyle = g1;
      ctx.lineWidth = size * 2.4;
      ctx.shadowColor = rgba('#ff6a1a', 0.9);
      ctx.shadowBlur = 24;
      ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(headX, headY); ctx.stroke();
      // 中間の明るい炎（黄）
      const g2 = ctx.createLinearGradient(tx, ty, headX, headY);
      g2.addColorStop(0, 'rgba(255,200,80,0)');
      g2.addColorStop(1, rgba('#ffe08a', a));
      ctx.strokeStyle = g2;
      ctx.lineWidth = size * 1.3;
      ctx.shadowBlur = 14;
      ctx.beginPath(); ctx.moveTo(tx + fdx * tail * 0.25, ty + fdy * tail * 0.25); ctx.lineTo(headX, headY); ctx.stroke();
      // 芯（白熱）
      ctx.strokeStyle = rgba('#ffffff', a);
      ctx.lineWidth = size * 0.55;
      ctx.shadowBlur = 8;
      ctx.beginPath(); ctx.moveTo(headX - fdx * tail * 0.4, headY - fdy * tail * 0.4); ctx.lineTo(headX, headY); ctx.stroke();
      // 頭（燃える岩塊）：発光する核
      const hg = ctx.createRadialGradient(headX, headY, 0, headX, headY, size * 1.6);
      hg.addColorStop(0, rgba('#ffffff', a));
      hg.addColorStop(0.35, rgba('#ffd98a', a * 0.95));
      hg.addColorStop(1, 'rgba(255,90,20,0)');
      ctx.fillStyle = hg;
      ctx.beginPath(); ctx.arc(headX, headY, size * 1.6, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }

    // ---- 幕2: 流星群の雨（左上の夜空から右下へ次々に走り抜け、地面で着弾する）----
    // 出発点は「着弾点から落下方向を逆に辿り、画面の外（左上）まで遡った点」にする。
    // これにより流星は必ず画面外から現れて斜めに横切る。着弾点は画面中央〜右寄りに散らす。
    const rainStart = 300;
    const meteorCount = 34;
    // 時刻の配り方：序盤はまばら → 後半ほど密に（本家の「降り注ぐ」クライマックス感）。
    // i/(n-1) を 0..1 に取り、二乗で前半を間延びさせ後半を詰める。
    const rainSpan = 1000;
    for (let i = 0; i < meteorCount; i++) {
      const k = i / (meteorCount - 1);
      // 着弾点：画面の右寄り〜中央。落下方向が右下なので、右に寄せるほど軌跡が画面を長く横切る。
      const landX = cx + rand(w * 0.02, w * 0.42);
      const landY = groundY + rand(-h * 0.05, h * 0.03);
      // 出発点は「画面の左上の外」。着弾点から落下方向を遡り、y が画面上端(-h*0.12)より上に
      // 来るまで、かつ x が画面左端(-w*0.1)より外に出るまで遡る（＝必ず画面外から入ってくる）。
      const backY = (landY + h * 0.12) / fdy;              // 上端の外まで遡る距離
      const backX = (landX + w * 0.1) / fdx;               // 左端の外まで遡る距離
      const back = Math.max(backY, backX);                 // 両方を満たす長い方
      const startX = landX - fdx * back, startY = landY - fdy * back;
      const delay = rainStart + Math.pow(k, 1.35) * rainSpan + rand(-14, 14);
      const flight = rand(300, 420);           // 少し長く飛ばし、同時に夜空を走る本数を増やす（派手さ）
      const size = rand(3.4, 6.6);
      const tail = rand(h * 0.34, h * 0.62);   // 尾を長く（走っている速度感）
      // 隕石本体の落下
      particles.push({
        delay,
        maxLife: flight,
        blend: 'lighter',
        draw(ctx, t) {
          // 着弾後(t>=1)はrunParticleSceneがpt=1のままdrawを呼び続けるため、ここで明示的に描画を止める
          if (t >= 1) return;
          const p = easeInCubic(t) * 0.4 + t * 0.6; // 加速しながら落ちる
          const x = lerp(startX, landX, p), y = lerp(startY, landY, p);
          const a = t < 0.08 ? t / 0.08 : 1;
          drawMeteor(ctx, x, y, tail * (0.6 + 0.4 * p), size, a);
        }
      });
      // 着弾：閃光＋火柱＋衝撃波
      const hit = delay + flight;
      particles.push({ // 着弾の閃光
        delay: hit,
        maxLife: 220,
        blend: 'lighter',
        draw(ctx, t) {
          const a = (1 - t) * 0.95;
          const r = lerp(size * 2, size * 11, easeOutQuint(t));
          const g = ctx.createRadialGradient(landX, landY, 0, landX, landY, r);
          g.addColorStop(0, rgba('#ffffff', a));
          g.addColorStop(0.3, rgba('#ffd98a', a * 0.9));
          g.addColorStop(0.7, rgba('#ff6a1a', a * 0.5));
          g.addColorStop(1, 'rgba(255,60,10,0)');
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.arc(landX, landY, r, 0, Math.PI * 2); ctx.fill();
        }
      });
      particles.push({ // 上に噴き上がる火柱
        delay: hit,
        maxLife: 380,
        blend: 'lighter',
        draw(ctx, t) {
          const rise = easeOutCubic(t);
          const a = (1 - t) * 0.85;
          const ph = size * 9 * rise;
          const g = ctx.createLinearGradient(landX, landY, landX, landY - ph);
          g.addColorStop(0, rgba('#ffe08a', a));
          g.addColorStop(0.5, rgba('#ff8a2a', a * 0.75));
          g.addColorStop(1, 'rgba(255,60,10,0)');
          ctx.fillStyle = g;
          const bw = size * (2.6 - t * 1.2);
          ctx.beginPath();
          ctx.moveTo(landX - bw, landY);
          ctx.quadraticCurveTo(landX - bw * 0.3, landY - ph * 0.6, landX, landY - ph);
          ctx.quadraticCurveTo(landX + bw * 0.3, landY - ph * 0.6, landX + bw, landY);
          ctx.closePath();
          ctx.fill();
        }
      });
      particles.push({ // 地面を走る衝撃波リング（横に潰した楕円）
        delay: hit,
        maxLife: 340,
        blend: 'lighter',
        draw(ctx, t) {
          const r = lerp(size * 1.5, size * 15, easeOutQuint(t));
          ctx.strokeStyle = rgba('#ffcf8a', (1 - t) * 0.7);
          ctx.lineWidth = 3.4 * (1 - t * 0.6);
          ctx.shadowColor = rgba('#ff8a2a', 0.9);
          ctx.shadowBlur = 12;
          ctx.beginPath();
          ctx.ellipse(landX, landY, r, r * 0.3, 0, 0, Math.PI * 2);
          ctx.stroke();
        }
      });
      // 弾け飛ぶ火の粉・岩片
      for (let k = 0; k < 6; k++) {
        const ang = rand(-Math.PI * 0.95, -Math.PI * 0.05); // 上半分へ放射
        const sp = rand(size * 5, size * 13);
        const g = rand(0.8, 1.5);
        const rad = rand(1.6, 3);   // 半径は生成時に固定（フレームごとのrandはチラつきの原因）
        particles.push({
          delay: hit,
          maxLife: rand(300, 520),
          blend: 'lighter',
          draw(ctx, t) {
            const e = easeOutCubic(t);
            const x = landX + Math.cos(ang) * sp * e;
            const y = landY + Math.sin(ang) * sp * e + g * t * t * h * 0.16;
            ctx.fillStyle = rgba(k % 2 ? '#ffd98a' : '#ff8a2a', (1 - t) * 0.9);
            ctx.shadowColor = rgba('#ff6a1a', 0.9);
            ctx.shadowBlur = 8;
            ctx.beginPath();
            ctx.arc(x, y, rad, 0, Math.PI * 2);
            ctx.fill();
          }
        });
      }
    }

    // ---- 幕3: 静寂 → 左上の夜空から特大の主星が斜めに落ちる ----
    // 流星の雨のあと一瞬だけ間を置き（静寂）、最後に他の流星より圧倒的に大きな主星を落とす。
    const bigStart = rainStart + rainSpan + 200;   // 流星の雨が途切れた後の「間」
    const bigFlight = 560;   // 迫ってくる姿を見せるため、小流星(230〜320ms)より明確に遅く大きく
    const bigHit = bigStart + bigFlight;
    // 主星本体：巨大な燃える隕石が左上の画面外から中心めがけて斜めに
    const bigTailLen = R * 0.95;
    const bigSize = w * 0.075;   // 小流星(3.4〜6.6px)の数倍：一目で「主星」とわかる大きさ
    // 主星の着弾点は画面中央やや右。落下方向を遡り、画面の上端/左端のすぐ外を出発点にする
    // （遡りすぎると画面外を飛んでいる時間が長く、肝心の「迫ってくる姿」が見えない）。
    const bigLandX = cx + w * 0.06;
    const bigBackY = (groundY + h * 0.14) / fdy;
    const bigBackX = (bigLandX + w * 0.12) / fdx;
    const bigBack = Math.max(bigBackY, bigBackX);
    const bigStartX = bigLandX - fdx * bigBack, bigStartY = groundY - fdy * bigBack;
    // 主星が近づくにつれ、空の左上が赤熱して明るくなる（接近の予感）
    particles.push({
      delay: bigStart,
      maxLife: bigFlight,
      blend: 'lighter',
      draw(ctx, t) {
        if (t >= 1) return;
        const a = easeInCubic(t) * 0.55;
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, w * 0.75);
        g.addColorStop(0, rgba('#ffd98a', a));
        g.addColorStop(0.5, rgba('#ff7a2a', a * 0.5));
        g.addColorStop(1, 'rgba(255,90,20,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h * 0.7);
      }
    });
    particles.push({
      delay: bigStart,
      maxLife: bigFlight,
      blend: 'lighter',
      draw(ctx, t) {
        if (t >= 1) return;   // 着弾後は描かない（爆発側の演出に引き継ぐ）
        const p = easeInCubic(t) * 0.3 + t * 0.7;   // ほぼ等速：画面内を悠然と、しかし確実に迫ってくる
        const x = lerp(bigStartX, bigLandX, p), y = lerp(bigStartY, groundY, p);
        drawMeteor(ctx, x, y, bigTailLen * (0.5 + 0.5 * p), bigSize, 1);
        // 主星の周囲を包む熱波のオーラ
        const g = ctx.createRadialGradient(x, y, 0, x, y, bigSize * 5);
        g.addColorStop(0, rgba('#ffe9b0', 0.55));
        g.addColorStop(1, 'rgba(255,100,20,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(x, y, bigSize * 5, 0, Math.PI * 2); ctx.fill();
      }
    });

    // ---- 幕4: 主星の着弾＝画面全体を焼き尽くす大爆発 ----
    // 着弾の閃光：画面全体の白飛びはDOM側のscreenFlash(SPECIAL_IMPACT_FX)が担当するため、
    // ここでは着弾点を中心にした放射状の光に留める（全面を白で塗ると二重で眩しくなり、
    // 着弾の瞬間そのものが見えなくなる）。
    particles.push({
      delay: bigHit,
      maxLife: 160,
      blend: 'lighter',
      draw(ctx, t) {
        const a = (1 - t) * 0.9;
        const r = lerp(w * 0.1, R * 0.75, easeOutCubic(t));
        const g = ctx.createRadialGradient(bigLandX, groundY, 0, bigLandX, groundY, r);
        g.addColorStop(0, rgba('#ffffff', a));
        g.addColorStop(0.45, rgba('#fff0c8', a * 0.55));
        g.addColorStop(1, 'rgba(255,220,160,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
      }
    });
    // 巨大な火球（白→黄→橙→赤のグラデ）
    particles.push({
      delay: bigHit,
      maxLife: 620,
      blend: 'lighter',
      draw(ctx, t) {
        const a = (1 - t) * 0.95;
        const r = lerp(8, R * 0.62, easeOutQuint(t));
        const g = ctx.createRadialGradient(bigLandX, groundY, 0, bigLandX, groundY, r);
        g.addColorStop(0, rgba('#ffffff', a));
        g.addColorStop(0.25, rgba('#ffe08a', a * 0.95));
        g.addColorStop(0.55, rgba('#ff8a2a', a * 0.75));
        g.addColorStop(0.85, rgba('#c8281a', a * 0.4));
        g.addColorStop(1, 'rgba(120,20,10,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(bigLandX, groundY, r, 0, Math.PI * 2); ctx.fill();
      }
    });
    // 多重の衝撃波（橙・白・紫が重なり竜の魔力を感じさせる）
    for (let i = 0; i < 4; i++) {
      const col = ['#ffffff', '#ffd98a', '#ff8a2a', '#b89aff'][i];
      particles.push({
        delay: bigHit + i * 55,
        maxLife: 520 - i * 40,
        blend: 'lighter',
        draw(ctx, t) {
          const r = lerp(w * 0.04, R * (0.55 + i * 0.16), easeOutQuint(t));
          ctx.strokeStyle = rgba(col, (1 - t) * (0.9 - i * 0.14));
          ctx.lineWidth = (9 - i * 1.6) * (1 - t * 0.55);
          ctx.shadowColor = rgba(col, 0.9);
          ctx.shadowBlur = 20;
          ctx.beginPath();
          ctx.ellipse(bigLandX, groundY, r, r * 0.34, 0, 0, Math.PI * 2);
          ctx.stroke();
        }
      });
    }
    // 中心から立ち昇る巨大な火柱：太い根元から、揺らめきながら上へ広がり散っていく炎の柱。
    // 内側（白熱）・中間（黄橙）・外側（赤）の3層を、それぞれ少しずつ違う揺らぎで重ねて炎の厚みを出す。
    const pillarSeed = rand(0, 100);
    const pillarLayers = [
      { wMul: 1.00, col0: '#c8281a', col1: '#ff5a1a', aMul: 0.55, seedOff: 0 },
      { wMul: 0.72, col0: '#ff8a2a', col1: '#ffc060', aMul: 0.75, seedOff: 7 },
      { wMul: 0.42, col0: '#ffe9a0', col1: '#ffffff', aMul: 0.95, seedOff: 13 },
    ];
    pillarLayers.forEach((L) => {
      particles.push({
        delay: bigHit,
        maxLife: 560,
        blend: 'lighter',
        draw(ctx, t) {
          const rise = easeOutCubic(clamp01(t / 0.55));
          const fade = 1 - Math.max(0, (t - 0.25) / 0.75);
          const a = fade * fade * L.aMul;   // 二乗で減衰させ、消え際に薄い残像が長く残らないようにする
          if (a <= 0.02) return;
          const ph = h * 0.92 * rise;
          const baseW = w * 0.15 * L.wMul * (1 - t * 0.35);
          const steps = 18;
          // 高さ方向に18分割し、左右の縁を「太さ×揺らぎ」で結んで炎の輪郭にする
          const left = [], right = [];
          for (let i = 0; i <= steps; i++) {
            const k = i / steps;                                    // 0=根元 1=先端
            const taper = Math.pow(1 - k, 0.85) * (1 + 0.55 * Math.sin(k * Math.PI)); // 中ほどが膨らむ
            const sway = noise1(k * 4 + t * 9, pillarSeed + L.seedOff) * baseW * 0.55 * k;
            const bw = baseW * taper;
            const y = groundY - ph * k;
            left.push([bigLandX + sway - bw, y]);
            right.push([bigLandX + sway + bw, y]);
          }
          const g = ctx.createLinearGradient(bigLandX, groundY, bigLandX, groundY - ph);
          g.addColorStop(0, rgba(L.col1, a));
          g.addColorStop(0.5, rgba(L.col0, a * 0.8));
          g.addColorStop(1, 'rgba(255,60,10,0)');
          ctx.fillStyle = g;
          ctx.shadowColor = rgba('#ff6a1a', 0.8);
          ctx.shadowBlur = 16;
          ctx.beginPath();
          ctx.moveTo(left[0][0], left[0][1]);
          for (let i = 1; i < left.length; i++) ctx.lineTo(left[i][0], left[i][1]);
          for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i][0], right[i][1]);
          ctx.closePath();
          ctx.fill();
        }
      });
    });
    // 四方に飛び散る燃える岩片（放物線を描いて降る）
    for (let i = 0; i < 30; i++) {
      const ang = rand(-Math.PI * 0.98, -Math.PI * 0.02);
      const sp = rand(w * 0.22, w * 0.6);
      const grav = rand(1.0, 1.9);
      const sz = rand(2.4, 6);
      particles.push({
        delay: bigHit + rand(0, 40),
        maxLife: rand(460, 740),   // 最長でも bigHit+40+740=2370ms < 全体尺2400ms（途中で切れない）
        blend: 'lighter',
        draw(ctx, t) {
          const e = easeOutCubic(t);
          const x = bigLandX + Math.cos(ang) * sp * e;
          const y = groundY + Math.sin(ang) * sp * e + grav * t * t * h * 0.34;
          ctx.fillStyle = rgba(i % 3 === 0 ? '#ffffff' : (i % 3 === 1 ? '#ffd98a' : '#ff8a2a'), (1 - t) * 0.92);
          ctx.shadowColor = rgba('#ff6a1a', 0.95);
          ctx.shadowBlur = 10;
          ctx.beginPath();
          ctx.arc(x, y, sz * (1 - t * 0.45), 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }
    // 地面の赤熱（焼け焦げた大地の残り火）
    particles.push({
      delay: bigHit + 60,
      maxLife: 700,
      blend: 'lighter',
      draw(ctx, t) {
        const a = Math.sin(Math.PI * clamp01(t)) * 0.5;
        const g = ctx.createLinearGradient(0, groundY - h * 0.12, 0, h);
        g.addColorStop(0, 'rgba(255,90,20,0)');
        g.addColorStop(0.5, rgba('#ff7a1a', a));
        g.addColorStop(1, rgba('#c8281a', a * 0.7));
        ctx.fillStyle = g;
        ctx.fillRect(0, groundY - h * 0.12, w, h - (groundY - h * 0.12));
      }
    });

    // ---- 幕5: 余燼（消えかけの残り火が漂う静かな余韻）----
    for (let i = 0; i < 22; i++) {
      const x0 = bigLandX + rand(-w * 0.4, w * 0.4);
      const seed = rand(0, 100);
      const riseSpeed = rand(0.1, 0.22);   // 上昇速度は生成時に固定
      const yOff = rand(0, h * 0.06);
      particles.push({
        delay: bigHit + 100 + rand(0, 160),
        maxLife: rand(380, 520),   // 最長でも bigHit+100+160+520=2370ms < 全体尺2400ms（途中で切れない）
        blend: 'lighter',
        draw(ctx, t) {
          const x = x0 + noise1(t * 3, seed) * 14;
          const y = groundY - t * h * riseSpeed - yOff;
          const fl = Math.abs(noise1(t * 18, seed)) * 0.6 + 0.4;
          ctx.fillStyle = rgba('#ffb060', (1 - t) * fl * 0.85);
          ctx.shadowColor = rgba('#ff6a1a', 0.9);
          ctx.shadowBlur = 7;
          ctx.beginPath();
          ctx.arc(x, y, 1.8, 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }
  }

// ============================================================
// ムーンフォース：夜空に満月が浮かび、月光の柱が降り注いで大地を浄化する演出
// 構成：①夜空の暗転と星々 ②満月がゆっくり浮かび上がる ③月から放射状に降り注ぐ月光
//       ④月光が収束して地面に巨大な光の柱が着弾 ⑤着弾点からフェアリー色の光輪が広がる
//       ⑥月が砕けて無数の光の粒子が舞い散る余韻
// 「銀白〜淡紫〜フェアリーピンクのグラデーション」「月本体のクレーター質感」
// 「コーン状に広がる月光」でフェアリー技らしい優美さと神秘性を表現する。
// ============================================================
function spawnMoonblastSpecial(particles, w, h) {
  const cx = w / 2;
  const groundY = h * 0.9;
  const R = Math.max(w, h);
  const moonX = cx;
  const moonY = h * 0.18;
  const moonR = Math.min(w, h) * 0.1;

  // ---- 幕0: 夜空が暗転する ----
  particles.push({
    maxLife: 2200,
    draw(ctx, t) {
      const env = t < 0.08 ? t / 0.08 : (t > 0.88 ? (1 - t) / 0.12 : 1);
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, rgba('#040418', env * 0.8));
      grad.addColorStop(0.6, rgba('#0a0a28', env * 0.55));
      grad.addColorStop(1, rgba('#141030', env * 0.28));
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
    }
  });

  // 星々が瞬く
  for (let i = 0; i < 44; i++) {
    const sx = rand(0, w), sy = rand(0, h * 0.65);
    const seed = rand(0, 100);
    const sz = rand(0.8, 2.0);
    particles.push({
      delay: rand(0, 200),
      maxLife: 2000,
      blend: 'lighter',
      draw(ctx, t) {
        const env = t < 0.06 ? t / 0.06 : (t > 0.88 ? (1 - t) / 0.12 : 1);
        const tw = Math.abs(noise1(t * 12, seed)) * 0.7 + 0.3;
        ctx.fillStyle = rgba(i % 5 === 0 ? '#ffe8ff' : '#e8e4ff', env * tw * 0.85);
        ctx.beginPath();
        ctx.arc(sx, sy, sz, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }

  // ---- 幕1: 満月が空に浮かび上がる ----
  particles.push({
    delay: 100,
    maxLife: 2100,
    blend: 'lighter',
    draw(ctx, t) {
      const grow = t < 0.2 ? easeOutQuint(t / 0.2) : 1;
      const shatter = t > 0.82 ? Math.max(0, 1 - easeOutQuint((t - 0.82) / 0.18)) : 1;
      const size = moonR * grow * shatter;
      if (size <= 0.5) return;

      // 外側のオーラ
      const auraGrad = ctx.createRadialGradient(moonX, moonY, 0, moonX, moonY, size * 3);
      auraGrad.addColorStop(0, rgba('#ffffff', 0.7 * shatter));
      auraGrad.addColorStop(0.3, rgba('#e8e0ff', 0.4 * shatter));
      auraGrad.addColorStop(1, 'rgba(232,224,255,0)');
      ctx.fillStyle = auraGrad;
      ctx.beginPath();
      ctx.arc(moonX, moonY, size * 3, 0, Math.PI * 2);
      ctx.fill();

      // 月本体（銀白の円）
      const moonGrad = ctx.createRadialGradient(moonX - size * 0.3, moonY - size * 0.3, 0, moonX, moonY, size);
      moonGrad.addColorStop(0, rgba('#ffffff', shatter));
      moonGrad.addColorStop(0.7, rgba('#f0eaff', shatter));
      moonGrad.addColorStop(1, rgba('#d8c8f0', shatter * 0.9));
      ctx.fillStyle = moonGrad;
      ctx.beginPath();
      ctx.arc(moonX, moonY, size, 0, Math.PI * 2);
      ctx.fill();

      // 月のクレーター
      ctx.fillStyle = rgba('#c8b8e0', 0.3 * shatter);
      [[-0.3, -0.2, 0.18], [0.25, 0.15, 0.14], [-0.15, 0.35, 0.1], [0.15, -0.35, 0.08]].forEach(([ox, oy, r]) => {
        ctx.beginPath();
        ctx.arc(moonX + size * ox, moonY + size * oy, size * r, 0, Math.PI * 2);
        ctx.fill();
      });
    }
  });

  // ---- 幕2: 月から降り注ぐ月光のコーン ----
  particles.push({
    delay: 400,
    maxLife: 1700,
    blend: 'lighter',
    draw(ctx, t) {
      const env = t < 0.15 ? t / 0.15 : (t > 0.75 ? (1 - t) / 0.25 : 1);
      if (env <= 0) return;
      const topY = moonY + moonR;
      const topHalfW = moonR * 0.5;
      const botHalfW = w * 0.6;
      const botY = h * 1.05;
      const grad = ctx.createLinearGradient(0, topY, 0, botY);
      grad.addColorStop(0, rgba('#ffffff', env * 0.5));
      grad.addColorStop(0.5, rgba('#f0e0ff', env * 0.22));
      grad.addColorStop(1, 'rgba(200,168,255,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(moonX - topHalfW, topY);
      ctx.lineTo(moonX + topHalfW, topY);
      ctx.lineTo(moonX + botHalfW, botY);
      ctx.lineTo(moonX - botHalfW, botY);
      ctx.closePath();
      ctx.fill();
    }
  });

  // 細い光条の束
  for (let i = 0; i < 14; i++) {
    const angle = rand(-0.5, 0.5);
    particles.push({
      delay: 420 + i * 22,
      maxLife: 800,
      blend: 'lighter',
      draw(ctx, t) {
        if (t >= 1) return;
        const env = Math.sin(Math.PI * t) * 0.65;
        const len = R * 0.8;
        const x1 = moonX + Math.sin(angle) * len;
        const y1 = moonY + Math.cos(angle) * len;
        const grad = ctx.createLinearGradient(moonX, moonY, x1, y1);
        grad.addColorStop(0, rgba('#ffffff', env));
        grad.addColorStop(0.6, rgba('#f0e0ff', env * 0.5));
        grad.addColorStop(1, 'rgba(200,168,255,0)');
        ctx.strokeStyle = grad;
        ctx.lineWidth = rand(1.5, 3);
        ctx.beginPath();
        ctx.moveTo(moonX, moonY);
        ctx.lineTo(x1, y1);
        ctx.stroke();
      }
    });
  }

  // ---- 幕3: 光の柱が地面に着弾 ----
  const strikeStart = 750;
  particles.push({
    delay: strikeStart,
    maxLife: 1000,
    blend: 'lighter',
    draw(ctx, t) {
      if (t >= 1) return;
      const grow = easeOutQuint(Math.min(1, t * 3));
      const fade = t > 0.55 ? (1 - (t - 0.55) / 0.45) : 1;
      const env = grow * fade * 0.9;
      if (env <= 0) return;
      const topY = moonY + moonR * 0.5;
      const hitX = cx;
      const hitY = groundY;
      const topW = moonR * 0.6;
      const botW = w * 0.14;
      const grad = ctx.createLinearGradient(0, topY, 0, hitY);
      grad.addColorStop(0, rgba('#ffffff', env));
      grad.addColorStop(0.5, rgba('#ffe8ff', env * 0.8));
      grad.addColorStop(1, rgba('#c8a8ff', env * 0.4));
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(moonX - topW, topY);
      ctx.lineTo(moonX + topW, topY);
      ctx.lineTo(hitX + botW, hitY);
      ctx.lineTo(hitX - botW, hitY);
      ctx.closePath();
      ctx.fill();

      // 中心の白いコア
      ctx.strokeStyle = rgba('#ffffff', env);
      ctx.lineWidth = topW * 0.6;
      ctx.beginPath();
      ctx.moveTo(moonX, topY);
      ctx.lineTo(hitX, hitY);
      ctx.stroke();
    }
  });

  // ---- 幕4: 着弾点の光の輪 ----
  const impactStart = strikeStart + 400;
  particles.push({
    delay: impactStart,
    maxLife: 260,
    blend: 'lighter',
    draw(ctx, t) {
      const env = (1 - t) * 0.9;
      const r = lerp(w * 0.03, R * 0.5, easeOutQuint(t));
      const grad = ctx.createRadialGradient(cx, groundY, 0, cx, groundY, r);
      grad.addColorStop(0, rgba('#ffffff', env));
      grad.addColorStop(0.4, rgba('#ffe8ff', env * 0.7));
      grad.addColorStop(1, 'rgba(200,168,255,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, groundY, r, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  const ringColors = ['#ffffff', '#ffb8e0', '#c8a8ff', '#e8d8ff'];
  for (let i = 0; i < 4; i++) {
    particles.push({
      delay: impactStart + i * 50,
      maxLife: 500 - i * 30,
      blend: 'lighter',
      draw(ctx, t) {
        const r = lerp(w * 0.04, R * (0.45 + i * 0.14), easeOutQuint(t));
        const env = (1 - t) * (0.85 - i * 0.13);
        ctx.strokeStyle = rgba(ringColors[i], env);
        ctx.lineWidth = (7 - i) * (1 - t * 0.55);
        ctx.shadowColor = rgba(ringColors[i], 0.9);
        ctx.shadowBlur = 18;
        ctx.beginPath();
        ctx.ellipse(cx, groundY, r, r * 0.32, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    });
  }

  // ---- 幕5: 月が砕けて破片が舞い散る ----
  for (let i = 0; i < 24; i++) {
    const ang = rand(0, Math.PI * 2);
    const sp = rand(w * 0.15, w * 0.5);
    const grav = rand(0.6, 1.4);
    const sz = rand(3, 8);
    particles.push({
      delay: impactStart + rand(0, 60),
      maxLife: rand(650, 850),
      blend: 'lighter',
      draw(ctx, t) {
        if (t >= 1) return;
        const e = easeOutCubic(t);
        const x = moonX + Math.cos(ang) * sp * e;
        const y = moonY + Math.sin(ang) * sp * e + grav * t * t * h * 0.4;
        const env = (1 - t) * 0.9;
        ctx.fillStyle = rgba('#f0eaff', env);
        ctx.shadowColor = rgba('#ffe8ff', 0.9);
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.arc(x, y, sz * (1 - t * 0.5), 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }

  // 舞い降りる光の粒子（キラキラと降る）
  for (let i = 0; i < 36; i++) {
    const x0 = rand(w * 0.02, w * 0.98);
    const y0 = rand(-h * 0.15, h * 0.3);
    const size = rand(2, 5);
    const sway = rand(15, 40);
    const swaySpeed = rand(0.6, 1.5);
    const rot = rand(0, Math.PI * 2);
    const col = pick(['#ffffff', '#ffe8ff', '#c8a8ff', '#ffb8e0']);
    particles.push({
      delay: impactStart + 100 + rand(0, 200),
      maxLife: rand(500, 700),
      blend: 'lighter',
      draw(ctx, t) {
        if (t >= 1) return;
        const fall = easeInCubic(t);
        const y = y0 + fall * (h - y0) * 1.05;
        const x = x0 + Math.sin(t * swaySpeed * Math.PI + rot) * sway;
        const env = t < 0.08 ? t / 0.08 : (1 - Math.max(0, (t - 0.75) / 0.25));
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(t * 2 + rot);
        ctx.fillStyle = rgba(col, env);
        ctx.shadowColor = rgba(col, 0.8);
        ctx.shadowBlur = 8;
        for (let k = 0; k < 2; k++) {
          ctx.save();
          ctx.rotate((k / 2) * Math.PI);
          ctx.fillRect(-size / 2, -0.6, size, 1.2);
          ctx.restore();
        }
        ctx.restore();
      }
    });
  }

  // ---- 幕6: 余韻の光の粒 ----
  for (let i = 0; i < 18; i++) {
    const x0 = cx + rand(-w * 0.4, w * 0.4);
    const y0 = groundY + rand(-h * 0.3, -h * 0.05);
    const seed = rand(0, 100);
    const riseSpeed = rand(0.1, 0.25);
    particles.push({
      delay: impactStart + 150 + rand(0, 150),
      maxLife: rand(450, 650),
      blend: 'lighter',
      draw(ctx, t) {
        if (t >= 1) return;
        const x = x0 + noise1(t * 3, seed) * 16;
        const y = y0 - t * h * riseSpeed;
        const env = Math.sin(Math.PI * clamp01(t)) * 0.85;
        ctx.fillStyle = rgba('#f0e8ff', env);
        ctx.shadowColor = rgba('#c8a8ff', 0.9);
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(x, y, 2, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }
}
// ============================================================
// ミキシング：DJミキサーで音楽がミックスされ、音のエネルギーが一点に集まって
// クライマックスで解放される、自己強化（攻撃+2／特攻+2）用の専用演出
// 構成：①ステージ暗転＋下部にイコライザーバー出現 ②四方から音符が中心へ収束
//       ③波形リングが中心へ吸い込まれる ④中心で色が混ざり合い光球が膨張
//       ⑤クライマックスの白閃光 ⑥全方位に音波バースト＋音符が舞い散る
//       ⑦残像の光の粒が漂う余韻
// 「ミキシング＝複数の音を混ぜる」という意味どおり、色とりどりの音符・波形・
// 光球が中心で「混ざり合う」瞬間をクライマックスに据える。
// サウンドタイプの可視色（アンバー #ffb347）を基調に、DJ機材を思わせる
// マゼンタ／シアン／紫をアクセントとして重ねる。
// ============================================================
function spawnMixingSpecial(particles, w, h) {
  const cx = w / 2, cy = h / 2;
  const R = Math.max(w, h);
  const seedA = rand(0, 100), seedB = rand(0, 100);

  // ミキシングの4色（音色を象徴するカラーパレット）
  const MIX_COLORS = ['#ffb347', '#ff4fa8', '#4fcfff', '#a855ff'];
  const NOTES = ['♪', '♫', '♬', '♩'];

  // ---- 幕0: ステージが暗転する（クラブの照明が落ちる） ----
  particles.push({
    maxLife: 1800,
    draw(ctx, t) {
      const env = t < 0.08 ? t / 0.08 : (t > 0.9 ? (1 - t) / 0.1 : 1);
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.8);
      grad.addColorStop(0, rgba('#1a0a2e', env * 0.72));
      grad.addColorStop(0.6, rgba('#0a0518', env * 0.85));
      grad.addColorStop(1, rgba('#000000', env * 0.94));
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
    }
  });

  // ---- 幕0.5: 画面下部にイコライザーバーが現れ、音の鼓動を可視化する ----
  const EQ_COUNT = 20;
  for (let i = 0; i < EQ_COUNT; i++) {
    const bx = (i + 0.5) * (w / EQ_COUNT);
    const phase = (i / EQ_COUNT) * Math.PI * 4;
    const col = MIX_COLORS[i % MIX_COLORS.length];
    const maxBarH = h * 0.24;
    const barW = (w / EQ_COUNT) * 0.55;
    particles.push({
      delay: 80 + i * 10,
      maxLife: 1500,
      blend: 'lighter',
      draw(ctx, t) {
        if (t >= 1) return;
        const env = t < 0.1 ? t / 0.1 : (t > 0.85 ? (1 - t) / 0.15 : 1);
        if (env <= 0) return;
        // 音に合わせて伸び縮みするノイズ駆動のバー
        const pump = Math.abs(noise1(t * 10 + phase, seedA + i)) * 0.6 + 0.4;
        // クライマックス（t≈0.61 = 1100ms）でバーが大きく伸びる
        const peakBoost = (t > 0.55 && t < 0.75) ? 1.9 : 1;
        const barH = maxBarH * pump * env * peakBoost;
        const grad = ctx.createLinearGradient(0, h, 0, h - barH);
        grad.addColorStop(0, rgba(col, env * 0.9));
        grad.addColorStop(0.7, rgba(col, env * 0.35));
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(bx - barW / 2, h - barH, barW, barH);
      }
    });
  }

  // ---- 幕1: 四方から音符が中心へ収束する（音がミックスされる！） ----
  const NOTE_COUNT = 28;
  for (let i = 0; i < NOTE_COUNT; i++) {
    const ang = (i / NOTE_COUNT) * Math.PI * 2 + rand(-0.15, 0.15);
    const dist = rand(R * 0.35, R * 0.6);
    const note = NOTES[i % NOTES.length];
    const col = MIX_COLORS[i % MIX_COLORS.length];
    const size = rand(16, 26);
    const spin = rand(-2, 2);
    const wobblePhase = rand(0, Math.PI * 2);
    particles.push({
      delay: 150 + (i % 8) * 40,
      maxLife: 900,
      blend: 'lighter',
      draw(ctx, t) {
        if (t >= 1) return;
        // 外→中心へ、後半ほど加速しながら吸い込まれる
        const e = easeInCubic(t);
        const r = dist * (1 - e);
        const wob = Math.sin(t * 20 + wobblePhase) * 8;
        const x = cx + Math.cos(ang) * r + wob * -Math.sin(ang);
        const y = cy + Math.sin(ang) * r + wob * Math.cos(ang);
        const env = t < 0.1 ? t / 0.1 : (1 - Math.max(0, (t - 0.7) / 0.3));
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(t * spin * 3);
        ctx.font = `${size}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.shadowColor = rgba(col, 1);
        ctx.shadowBlur = 14;
        ctx.fillStyle = rgba(col, env);
        ctx.fillText(note, 0, 0);
        ctx.restore();
      }
    });
  }

  // ---- 幕1.5: 波形リングが外側から中心へ収束する ----
  for (let i = 0; i < 5; i++) {
    const col = MIX_COLORS[i % MIX_COLORS.length];
    particles.push({
      delay: 200 + i * 90,
      maxLife: 800,
      blend: 'lighter',
      draw(ctx, t) {
        if (t >= 1) return;
        const e = easeInCubic(t);
        const rBase = R * 0.55 * (1 - e * 0.92);
        const env = t < 0.12 ? t / 0.12 : (1 - Math.max(0, (t - 0.7) / 0.3));
        ctx.save();
        ctx.strokeStyle = rgba(col, env);
        ctx.lineWidth = 3.5;
        ctx.shadowColor = rgba(col, 0.9);
        ctx.shadowBlur = 14;
        ctx.beginPath();
        // サイン波でうねる円（音の波形を可視化）
        const segs = 80;
        for (let s = 0; s <= segs; s++) {
          const a = (s / segs) * Math.PI * 2;
          const wave = Math.sin(a * 6 + t * 18) * 8 * (1 - e);
          const rr = rBase + wave;
          const x = cx + Math.cos(a) * rr;
          const y = cy + Math.sin(a) * rr;
          if (s === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.stroke();
        ctx.restore();
      }
    });
  }

  // ---- 幕1.7: 中心で回転するレコード盤のような多重リング ----
  particles.push({
    delay: 350,
    maxLife: 900,
    blend: 'lighter',
    draw(ctx, t) {
      if (t >= 1) return;
      const env = t < 0.1 ? t / 0.1 : (t > 0.75 ? (1 - t) / 0.25 : 1);
      if (env <= 0) return;
      const rBase = R * 0.12 * easeOutCubic(Math.min(1, t * 1.5));
      const rot = t * Math.PI * 6;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(rot);
      // 同心円の溝
      ctx.strokeStyle = rgba('#ffb347', env * 0.75);
      ctx.lineWidth = 1.5;
      for (let i = 0; i < 5; i++) {
        ctx.beginPath();
        ctx.arc(0, 0, rBase * (0.3 + i * 0.18), 0, Math.PI * 2);
        ctx.stroke();
      }
      // ラジアル方向のトラックマーク
      ctx.strokeStyle = rgba('#ff4fa8', env * 0.55);
      ctx.lineWidth = 2;
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * rBase * 0.3, Math.sin(a) * rBase * 0.3);
        ctx.lineTo(Math.cos(a) * rBase * 0.9, Math.sin(a) * rBase * 0.9);
        ctx.stroke();
      }
      ctx.restore();
    }
  });

  // ---- 幕2: 中心で4色の光球が混ざり合う（ミキシングの本質） ----
  MIX_COLORS.forEach((col, i) => {
    const ang = (i / MIX_COLORS.length) * Math.PI * 2;
    const dist0 = R * 0.08;
    particles.push({
      delay: 450,
      maxLife: 900,
      blend: 'lighter',
      draw(ctx, t) {
        if (t >= 1) return;
        const grow = easeOutCubic(Math.min(1, t * 2));
        // 後半になると中心へ寄り、色が混ざり合う
        const merge = easeInCubic(Math.max(0, (t - 0.4) / 0.6));
        const x = cx + Math.cos(ang + t * 8) * dist0 * (1 - merge);
        const y = cy + Math.sin(ang + t * 8) * dist0 * (1 - merge);
        const r = R * 0.05 * grow;
        const env = t < 0.1 ? t / 0.1 : (1 - Math.max(0, (t - 0.75) / 0.25));
        const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
        grad.addColorStop(0, rgba('#ffffff', env * 0.35));
        grad.addColorStop(0.5, rgba(col, env * 0.9));
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  });

  // 中心の脈打つコア（クライマックスに向けて膨張していく）
  particles.push({
    delay: 450,
    maxLife: 850,
    blend: 'lighter',
    draw(ctx, t) {
      if (t >= 1) return;
      const grow = easeOutQuint(Math.min(1, t * 1.6));
      const pulse = 0.85 + Math.abs(noise1(t * 12, seedB)) * 0.3;
      const r = R * 0.18 * grow * pulse;
      const env = t < 0.05 ? t / 0.05 : 1;
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      grad.addColorStop(0, rgba('#ffe0f5', env * 0.55));
      grad.addColorStop(0.35, rgba('#d8a8ff', env * 0.75));
      grad.addColorStop(0.7, rgba('#8b5ce0', env * 0.5));
      grad.addColorStop(1, 'rgba(140,90,220,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
    }
  });

  // 変更後：白ではなく、ほんのり色付いた柔らかい光に
  particles.push({
    delay: 1100,
    maxLife: 220,
    blend: 'lighter',
    draw(ctx, t) {
      const env = (1 - t) * 0.3;                 // 全画面の発光は控えめに
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.7);
      grad.addColorStop(0, rgba('#ffe8ff', env * 1.0));
      grad.addColorStop(0.5, rgba('#c8a8ff', env * 0.6));
      grad.addColorStop(1, 'rgba(168,85,255,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
    }
  });

  // ---- 幕4: 全方位に音波バースト（強化された力の解放） ----
  const RING_COLORS = ['#ffffff', '#ffb347', '#ff4fa8', '#4fcfff', '#a855ff'];
  for (let i = 0; i < 5; i++) {
    const col = RING_COLORS[i];
    particles.push({
      delay: 1100 + i * 55,
      maxLife: 550 - i * 30,
      blend: 'lighter',
      draw(ctx, t) {
        const r = lerp(w * 0.03, R * (0.5 + i * 0.13), easeOutQuint(t));
        const env = (1 - t) * (0.9 - i * 0.13);
        ctx.strokeStyle = rgba(col, env);
        ctx.lineWidth = (8 - i * 1.2) * (1 - t * 0.5);
        ctx.shadowColor = rgba(col, 0.9);
        ctx.shadowBlur = 20;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
      }
    });
  }

  // 全方位に飛び散る音符（解放された音の余韻）
  const burstNoteMax = 550;
  for (let i = 0; i < 24; i++) {
    const ang = (i / 24) * Math.PI * 2 + rand(-0.1, 0.1);
    const dist = rand(R * 0.3, R * 0.65);
    const note = NOTES[i % NOTES.length];
    const col = MIX_COLORS[i % MIX_COLORS.length];
    const size = rand(18, 28);
    const spin = rand(-3, 3);
    particles.push({
      delay: 1100 + rand(0, 80),
      maxLife: rand(400, burstNoteMax),
      blend: 'lighter',
      draw(ctx, t) {
        if (t >= 1) return;
        const e = easeOutCubic(t);
        const x = cx + Math.cos(ang) * dist * e;
        const y = cy + Math.sin(ang) * dist * e;
        const env = (1 - t) * 0.95;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(t * spin + i);
        ctx.font = `${size}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.shadowColor = rgba(col, 1);
        ctx.shadowBlur = 14;
        ctx.fillStyle = rgba(col, env);
        ctx.fillText(note, 0, 0);
        ctx.restore();
      }
    });
  }

  // ---- 幕5: 残像の光の粒（余韻） ----
  for (let i = 0; i < 20; i++) {
    const ang = rand(0, Math.PI * 2);
    const dist = rand(R * 0.15, R * 0.7);
    const col = MIX_COLORS[i % MIX_COLORS.length];
    const size = rand(2, 3.5);
    particles.push({
      delay: 1150 + rand(0, 150),
      maxLife: rand(300, 450),
      blend: 'lighter',
      draw(ctx, t) {
        if (t >= 1) return;
        const e = easeOutCubic(t);
        const x = cx + Math.cos(ang) * dist * e;
        const y = cy + Math.sin(ang) * dist * e;
        const env = (1 - t) * 0.9;
        ctx.fillStyle = rgba(col, env);
        ctx.shadowColor = rgba(col, 0.9);
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.arc(x, y, size, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }
}
  // ============================================================
  // ふぶき：極寒の吹雪が渦巻き、視界を白く塗り潰しながら凍てつく大結晶が突き刺さる演出
  // 構成：①冷気が噴き出し辺りが白く霞む予兆 ②横殴りの猛吹雪が画面を覆う
  //       ③巨大な氷結晶が中心に向かって突き刺さる ④氷結の瞬間の白い閃光と亀裂状の凍結波
  //       ⑤舞い散る粉雪と結晶片、凍りついた息のような白い靄の余韻
  // 「吹雪は横殴りの強い流れと密度」「結晶はシャープな多角形で鋭さを出す」「凍結は青白い階調と亀裂質感」がキモ。
  // ============================================================
  function spawnBlizzardSpecial(particles, w, h) {
    const cx = w / 2, cy = h * 0.5;
    const R = Math.max(w, h);
    const seedA = rand(0, 100), seedB = rand(0, 100);

    // ---- 幕0: 冷気が噴き出し、辺りが白く霞み始める（予兆）----
    particles.push({
      maxLife: 200,
      draw(ctx, t) {
        const alpha = Math.sin(Math.PI * clamp01(t)) * 0.4;
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, w * 0.6);
        grad.addColorStop(0, rgba('#eaf6ff', alpha));
        grad.addColorStop(0.6, rgba('#a8d8f0', alpha * 0.5));
        grad.addColorStop(1, 'rgba(168,216,240,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);
      }
    });
    // 噴き出す冷気の霧（下から立ち上る質感）
    for (let i = 0; i < 10; i++) {
      const x0 = rand(w * 0.1, w * 0.9);
      particles.push({
        delay: rand(0, 100),
        maxLife: rand(400, 600),
        x0,
        size: rand(30, 56),
        seed: rand(0, 100),
        draw(ctx, t) {
          const rise = easeOutCubic(t);
          const y = h * 0.9 - rise * h * 0.5;
          const wob = noise1(t * 5 + this.seed, this.seed) * 20;
          const x = this.x0 + wob;
          const alpha = (t < 0.2 ? t / 0.2 : (1 - Math.max(0, (t - 0.5) / 0.5))) * 0.35;
          const grad = ctx.createRadialGradient(x, y, 0, x, y, this.size);
          grad.addColorStop(0, rgba('#eaf6ff', alpha));
          grad.addColorStop(1, 'rgba(234,246,255,0)');
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(x, y, this.size, 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }

    // ---- 幕1: 横殴りの猛吹雪が画面を強く覆う（密度濃く、風の乱流で不規則に）----
    const blizzardStart = 90;
    const windAngle = -0.25; // わずかに斜めに吹き付ける
    for (let i = 0; i < 90; i++) {
      const x0 = rand(-w * 0.2, w * 1.1);
      const y0 = rand(-h * 0.1, h * 1.1);
      const seed = rand(0, 100);
      particles.push({
        delay: blizzardStart + rand(0, 380),
        maxLife: rand(340, 560),
        x0, y0, seed,
        speed: rand(0.7, 1.4),
        len: rand(20, 46),
        thick: rand(1, 2.6),
        draw(ctx, t) {
          const dist = easeInOutSine(t) * this.speed;
          const turb = noise1(t * 8 + this.seed, this.seed) * 14;
          const x = this.x0 + Math.cos(windAngle) * dist * w * 1.3 + turb;
          const y = this.y0 + Math.sin(windAngle) * dist * w * 1.3 + turb * 0.5;
          const alpha = (t < 0.08 ? t / 0.08 : (1 - Math.max(0, (t - 0.75) / 0.25))) * 0.75;
          ctx.strokeStyle = rgba('#eaf6ff', alpha);
          ctx.lineWidth = this.thick;
          ctx.shadowColor = rgba('#dff0ff', 0.5);
          ctx.shadowBlur = 3;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x - Math.cos(windAngle) * this.len, y - Math.sin(windAngle) * this.len);
          ctx.stroke();
        }
      });
    }
    // 吹雪の中の白い濃霧の帯（層状に流れ、視界を覆う質感を強化）
    for (let i = 0; i < 5; i++) {
      particles.push({
        delay: blizzardStart + i * 60,
        maxLife: 420,
        idx: i,
        draw(ctx, t) {
          const alpha = Math.sin(Math.PI * clamp01(t)) * 0.28;
          const y = h * (0.15 + i * 0.18);
          const grad = ctx.createLinearGradient(0, y - 40, 0, y + 40);
          grad.addColorStop(0, 'rgba(234,246,255,0)');
          grad.addColorStop(0.5, rgba('#eaf6ff', alpha));
          grad.addColorStop(1, 'rgba(234,246,255,0)');
          ctx.fillStyle = grad;
          ctx.fillRect(0, y - 40, w, 80);
        }
      });
    }

    // ---- 幕2: 巨大な氷結晶が中心に向かって四方から突き刺さる（メインビジュアル）----
    const shardStart = 260;
    // 氷結晶を描くヘルパー：シャープな六芒星型の多角形
    function drawCrystal(ctx, x, y, size, rot, alpha, coreAlpha) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rot);
      ctx.globalCompositeOperation = 'lighter';
      // 外側の6本の鋭い光条
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const grad = ctx.createLinearGradient(0, 0, Math.cos(a) * size, Math.sin(a) * size);
        grad.addColorStop(0, rgba('#ffffff', alpha));
        grad.addColorStop(0.5, rgba('#bfe8ff', alpha * 0.7));
        grad.addColorStop(1, 'rgba(191,232,255,0)');
        ctx.strokeStyle = grad;
        ctx.lineWidth = size * 0.09;
        ctx.shadowColor = rgba('#eaf8ff', 0.9);
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(a) * size, Math.sin(a) * size);
        ctx.stroke();
        // 各光条から小さな枝
        const branchLen = size * 0.32;
        const bx = Math.cos(a) * size * 0.55, by = Math.sin(a) * size * 0.55;
        ctx.lineWidth = size * 0.04;
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.lineTo(bx + Math.cos(a + 0.9) * branchLen, by + Math.sin(a + 0.9) * branchLen);
        ctx.moveTo(bx, by);
        ctx.lineTo(bx + Math.cos(a - 0.9) * branchLen, by + Math.sin(a - 0.9) * branchLen);
        ctx.stroke();
      }
      // 中心のコア発光
      const coreGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, size * 0.22);
      coreGrad.addColorStop(0, rgba('#ffffff', coreAlpha));
      coreGrad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = coreGrad;
      ctx.beginPath();
      ctx.arc(0, 0, size * 0.22, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    // 4方向から中心へ突き刺さる巨大結晶
    const dirs = [
      { ang: Math.PI * 1.25, name: 'tl' }, { ang: Math.PI * 1.75, name: 'tr' },
      { ang: Math.PI * 0.75, name: 'bl' }, { ang: Math.PI * 0.25, name: 'br' },
    ];
    dirs.forEach((d, i) => {
      const startDist = R * 0.7;
      particles.push({
        delay: shardStart + i * 50,
        maxLife: 260,
        ang: d.ang,
        draw(ctx, t) {
          const e = easeOutQuint(Math.min(1, t * 1.4));
          const dist = lerp(startDist, 0, e);
          const x = cx + Math.cos(this.ang) * dist;
          const y = cy + Math.sin(this.ang) * dist;
          const alpha = t < 0.7 ? 1 : (1 - (t - 0.7) / 0.3);
          const size = lerp(w * 0.05, w * 0.2, e);
          drawCrystal(ctx, x, y, size, this.ang + t * 2, alpha * 0.9, alpha);
        }
      });
    });
    // 中心の巨大結晶（着弾と同時に最大サイズで発光）
    particles.push({
      delay: shardStart + 180,
      maxLife: 340,
      draw(ctx, t) {
        const grow = easeOutQuint(Math.min(1, t * 2.2));
        const size = w * 0.32 * grow;
        const alpha = (1 - Math.max(0, (t - 0.5) / 0.5)) * 0.95;
        drawCrystal(ctx, cx, cy, size, t * 1.5, alpha, alpha);
      }
    });

    // ---- 幕3: 凍結の瞬間、視界が白く染まる閃光と、亀裂状に走る凍結波 ----
    const freezeStart = shardStart + 190;
    particles.push({
      delay: freezeStart,
      maxLife: 200,
      blend: 'lighter',
      draw(ctx, t) {
        const alpha = (1 - t) * 0.85;
        ctx.fillStyle = rgba('#ffffff', alpha);
        ctx.fillRect(0, 0, w, h);
      }
    });
    // 凍結の亀裂波（中心から放射状にガラスが割れるような線）
    for (let i = 0; i < 12; i++) {
      const ang = (i / 12) * Math.PI * 2 + rand(-0.15, 0.15);
      particles.push({
        delay: freezeStart + rand(0, 30),
        maxLife: 320,
        ang,
        len: rand(R * 0.3, R * 0.55),
        draw(ctx, t) {
          const grow = easeOutCubic(Math.min(1, t * 2.4));
          const len = this.len * grow;
          const alpha = (1 - t) * 0.7;
          ctx.strokeStyle = rgba('#bfe8ff', alpha);
          ctx.lineWidth = 1.6;
          ctx.shadowColor = rgba('#eaf8ff', 0.8);
          ctx.shadowBlur = 6;
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.lineTo(cx + Math.cos(this.ang) * len, cy + Math.sin(this.ang) * len);
          ctx.stroke();
        }
      });
    }
    // 衝撃波リング（多重、冷気特有の水色〜白）
    for (let i = 0; i < 3; i++) {
      particles.push({
        delay: freezeStart + i * 40,
        maxLife: 300 - i * 30,
        blend: 'lighter',
        draw(ctx, t) {
          const r = lerp(w * 0.04, R * (0.4 + i * 0.13), easeOutQuint(t));
          const alpha = (1 - t) * (0.75 - i * 0.15);
          ctx.strokeStyle = rgba(i === 0 ? '#ffffff' : '#bfe8ff', alpha);
          ctx.lineWidth = (6 - i) * (1 - t * 0.5);
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.stroke();
        }
      });
    }

    // ---- 幕4: 舞い散る粉雪と結晶片、凍った白い靄の余韻 ----
    const snowStart = freezeStart + 100;
    for (let i = 0; i < 40; i++) {
      const x0 = rand(w * 0.02, w * 0.98);
      const y0 = rand(-h * 0.15, h * 0.3);
      particles.push({
        delay: snowStart + rand(0, 500),
        maxLife: rand(600, 900),
        x0, y0,
        size: rand(2, 5),
        sway: rand(10, 26),
        swaySpeed: rand(0.8, 1.8),
        rot: rand(0, Math.PI * 2),
        draw(ctx, t) {
          const fall = easeInCubic(t) * 0.8;
          const y = this.y0 + fall * (h - this.y0) * 1.1;
          const x = this.x0 + Math.sin(t * this.swaySpeed * Math.PI + this.rot) * this.sway;
          const alpha = (t < 0.06 ? t / 0.06 : (1 - Math.max(0, (t - 0.75) / 0.25))) * 0.9;
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(t * 3 + this.rot);
          ctx.fillStyle = rgba('#ffffff', alpha);
          ctx.shadowColor = rgba('#eaf8ff', 0.7);
          ctx.shadowBlur = 4;
          // 六角の雪片っぽいシンプルな十字
          for (let k = 0; k < 3; k++) {
            ctx.save();
            ctx.rotate((k / 3) * Math.PI);
            ctx.fillRect(-this.size / 2, -0.7, this.size, 1.4);
            ctx.restore();
          }
          ctx.restore();
        }
      });
    }
    // 凍った白い靄が漂う余韻
    for (let i = 0; i < 6; i++) {
      const x0 = rand(w * 0.1, w * 0.9);
      particles.push({
        delay: snowStart + rand(0, 300),
        maxLife: rand(500, 700),
        x0,
        size: rand(40, 70),
        draw(ctx, t) {
          const alpha = (t < 0.2 ? t / 0.2 : (1 - Math.max(0, (t - 0.5) / 0.5))) * 0.22;
          const y = h * rand(0.3, 0.7);
          const grad = ctx.createRadialGradient(this.x0, y, 0, this.x0, y, this.size);
          grad.addColorStop(0, rgba('#eaf6ff', alpha));
          grad.addColorStop(1, 'rgba(234,246,255,0)');
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(this.x0, y, this.size, 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }
  }

  // ============================================================
  // パワージェム：自分のポケモンの周りに宝石が生まれ、相手のポケモンへ次々に飛んでいく演出
  // 原作のように「全画面」ではなく、攻撃側スプライト → 防御側スプライトの“飛翔”で見せる。
  // 構成：①攻撃側の周囲に宝石が生成され、きらめきながら浮かぶ（チャージ）
  //       ②宝石が時間差で放物線を描き、光の尾を引いて相手へ飛翔
  //       ③宝石ごとに着弾（小さな光と火花）、全弾着弾で相手の上で大きく爆ぜる
  //       ④着弾点に舞い散る宝石の破片と光の粒（余韻）
  // 「多色の宝石（ピンク・水色・黄・緑・紫）」「宝石らしい多面体のカット」「光の尾」がキモ。
  // 着弾の総仕上げ（全弾着弾）が SPECIAL_IMPACT_FX の閃光・シェイクと同期する。
  //
  // info = { from:{x,y}, to:{x,y}, scale }  ※ playSpecialTypeEffect が実測して渡す。
  //   from … 攻撃側スプライト中心（special-fx-layer 基準のpx座標）
  //   to   … 防御側スプライト中心
  //   scale … スプライトの大きさに応じた宝石サイズ倍率（自機=大/相手=小の画面差に追従）
  // ============================================================
  const POWERGEM_GEM_COUNT = 9;          // 飛ばす宝石の数
  const POWERGEM_CHARGE_MS = 380;        // ①チャージ（宝石が周囲に生成される）
  const POWERGEM_STAGGER_MS = 70;        // ②宝石ごとの発射間隔
  const POWERGEM_FLIGHT_MS = 340;        // 1個あたりの飛翔時間
  // 全弾着弾の時刻（＝SPECIAL_IMPACT_FX[312] のフラッシュ・シェイクの基準）
  //   最後の宝石の着弾 = charge + stagger*(N-1) + flight
  const POWERGEM_FINAL_IMPACT_MS =
    POWERGEM_CHARGE_MS + POWERGEM_STAGGER_MS * (POWERGEM_GEM_COUNT - 1) + POWERGEM_FLIGHT_MS;

  function spawnPowerGemSpecial(particles, w, h, info) {
    // 座標情報が渡されなかった場合の保険（左下→右上の想定配置）
    const from = (info && info.from) || { x: w * 0.28, y: h * 0.68 };
    const to = (info && info.to) || { x: w * 0.72, y: h * 0.32 };
    const S = (info && info.scale) || 1;
    const R = Math.max(w, h);

    // 宝石の色パレット（多色）：{ 本体, 明るい面, 暗い面, 発光 }
    const PALETTE = [
      { base: '#ff6fb5', hi: '#ffd0ea', lo: '#c2307f', glow: '#ff9fd2' }, // ピンク
      { base: '#5cc8ff', hi: '#d2f1ff', lo: '#2a86c8', glow: '#9fe0ff' }, // 水色
      { base: '#ffd84a', hi: '#fff4b8', lo: '#d09a12', glow: '#ffe98a' }, // 黄
      { base: '#5fe39a', hi: '#c9fadf', lo: '#25a865', glow: '#95f2bf' }, // 緑
      { base: '#b58cff', hi: '#e6d8ff', lo: '#7a4fd0', glow: '#cfb4ff' }, // 紫
    ];

    // ---- 宝石（多面体カット）を描くヘルパー ----
    // 六角形のブリリアントカット風：外周6点＋中央の面で、明面／暗面をグラデで塗り分ける。
    function drawGem(ctx, x, y, size, rot, col, alpha) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rot);
      // 外周の6頂点（少し縦に潰して宝石らしいシルエットに）
      const pts = [];
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
        pts.push([Math.cos(a) * size * 0.9, Math.sin(a) * size]);
      }
      // 発光（加算合成）
      ctx.globalCompositeOperation = 'lighter';
      const halo = ctx.createRadialGradient(0, 0, 0, 0, 0, size * 2.1);
      halo.addColorStop(0, rgba(col.glow, alpha * 0.55));
      halo.addColorStop(1, rgba(col.glow, 0));
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(0, 0, size * 2.1, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      // 各面（中心と外周2点で作る三角形）を明暗つけて塗る＝カット面
      for (let i = 0; i < 6; i++) {
        const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % 6];
        const lit = (i === 0 || i === 1 || i === 5);
        ctx.fillStyle = rgba(lit ? col.hi : (i === 3 ? col.lo : col.base), alpha);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.closePath();
        ctx.fill();
      }
      // 輪郭
      ctx.strokeStyle = rgba('#ffffff', alpha * 0.85);
      ctx.lineWidth = Math.max(1, size * 0.09);
      ctx.beginPath();
      pts.forEach(([px, py], i) => i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py));
      ctx.closePath();
      ctx.stroke();
      // 中央の白いきらめき
      ctx.globalCompositeOperation = 'lighter';
      const core = ctx.createRadialGradient(-size * 0.2, -size * 0.3, 0, -size * 0.2, -size * 0.3, size * 0.5);
      core.addColorStop(0, rgba('#ffffff', alpha));
      core.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = core;
      ctx.beginPath();
      ctx.arc(-size * 0.2, -size * 0.3, size * 0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // 4方向の十字きらめき（宝石が光を反射する「キラッ」）
    function drawSparkle(ctx, x, y, size, alpha, color) {
      ctx.save();
      ctx.translate(x, y);
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = rgba(color, alpha);
      ctx.shadowColor = rgba(color, 0.9);
      ctx.shadowBlur = size * 0.8;
      ctx.beginPath();
      ctx.moveTo(0, -size);
      ctx.quadraticCurveTo(size * 0.12, -size * 0.12, size, 0);
      ctx.quadraticCurveTo(size * 0.12, size * 0.12, 0, size);
      ctx.quadraticCurveTo(-size * 0.12, size * 0.12, -size, 0);
      ctx.quadraticCurveTo(-size * 0.12, -size * 0.12, 0, -size);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    // ---- 宝石ごとの軌道をあらかじめ決める ----
    // 攻撃側スプライトの周囲（半円状）に浮かぶ位置 → 相手の中心付近（少しバラつかせる）へ着弾。
    const dx = to.x - from.x, dy = to.y - from.y;
    const dist = Math.hypot(dx, dy) || 1;
    const dirAng = Math.atan2(dy, dx);
    const gems = [];
    for (let i = 0; i < POWERGEM_GEM_COUNT; i++) {
      // 周囲に浮かぶ位置：攻撃側の“前方の半円”に扇状に配置し、前列・後列で奥行きも付ける
      const fan = (i / (POWERGEM_GEM_COUNT - 1) - 0.5) * Math.PI * 1.15;
      const ringR = (34 + (i % 3) * 12) * S;
      const hoverX = from.x + Math.cos(dirAng + fan + Math.PI * 0.5) * ringR * 0.9 - Math.cos(dirAng) * 8 * S;
      const hoverY = from.y + Math.sin(dirAng + fan + Math.PI * 0.5) * ringR * 0.9 - Math.sin(dirAng) * 8 * S;
      // 着弾点：相手の中心付近に散らして「全部が当たる」感を出す
      const spread = 26 * S;
      const hitX = to.x + rand(-spread, spread);
      const hitY = to.y + rand(-spread, spread) * 0.8;
      gems.push({
        col: PALETTE[i % PALETTE.length],
        hoverX, hoverY, hitX, hitY,
        size: (7 + rand(0, 3)) * S,
        spin: rand(-6, 6),
        arc: rand(0.10, 0.22) * dist * (i % 2 ? 1 : -1), // 放物線のふくらみ（左右に散らす）
        seed: rand(0, 100),
        launch: POWERGEM_CHARGE_MS + i * POWERGEM_STAGGER_MS, // 発射時刻
      });
    }

    // ---- 幕0：攻撃側の足元に宝石色の魔法陣めいた光（予兆）----
    particles.push({
      maxLife: POWERGEM_CHARGE_MS + 200,
      blend: 'lighter',
      draw(ctx, t) {
        const a = Math.sin(Math.PI * clamp01(t)) * 0.55;
        const r = lerp(10 * S, 62 * S, easeOutCubic(t));
        const g = ctx.createRadialGradient(from.x, from.y, 0, from.x, from.y, r);
        g.addColorStop(0, rgba('#ffffff', a * 0.7));
        g.addColorStop(0.45, rgba('#ff9fd2', a * 0.55));
        g.addColorStop(0.8, rgba('#9fe0ff', a * 0.3));
        g.addColorStop(1, 'rgba(159,224,255,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(from.x, from.y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    });

    // ---- 幕1：宝石が周囲に生成され、きらめきながら浮かぶ → 発射 ----
    gems.forEach((g, i) => {
      // ①出現〜滞空（原点から膨らんで浮かぶ）
      particles.push({
        delay: i * 36,
        maxLife: g.launch - i * 36,
        draw(ctx, t) {
          // runParticleScene は maxLife 経過後も pt=1 で draw を呼び続ける。
          // 発射（t=1）した宝石が元の位置に居残って飛翔中の宝石と二重に見えないよう、ここで打ち切る。
          if (t >= 1) return;
          const pop = easeOutCubic(clamp01(t * 2.2));
          const bob = noise1(t * 6 + g.seed, g.seed) * 3 * S;
          const x = lerp(from.x, g.hoverX, pop);
          const y = lerp(from.y, g.hoverY, pop) + bob;
          drawGem(ctx, x, y, g.size * (0.4 + 0.6 * pop), t * g.spin, g.col, clamp01(t * 4));
          // 出現時のきらめき
          if (t > 0.35 && t < 0.85) {
            const sp = Math.sin(Math.PI * ((t - 0.35) / 0.5));
            drawSparkle(ctx, x + g.size * 0.7, y - g.size * 0.7, g.size * 1.1 * sp, sp * 0.9, '#ffffff');
          }
        }
      });

      // ②飛翔（放物線＋光の尾）
      particles.push({
        delay: g.launch,
        maxLife: POWERGEM_FLIGHT_MS,
        draw(ctx, t) {
          const e = easeInCubic(t) * 0.55 + t * 0.45; // 加速しつつ最後まで届く
          // 放物線：直線補間に、進行方向と直交する方向のふくらみを重ねる
          const bend = Math.sin(Math.PI * e) * g.arc;
          const nx = -dy / dist, ny = dx / dist;
          const px = lerp(g.hoverX, g.hitX, e) + nx * bend;
          const py = lerp(g.hoverY, g.hitY, e) + ny * bend;
          // 光の尾：過去の位置をなぞって薄く描く
          for (let k = 6; k >= 1; k--) {
            const te = Math.max(0, e - k * 0.045);
            const tb = Math.sin(Math.PI * te) * g.arc;
            const tx = lerp(g.hoverX, g.hitX, te) + nx * tb;
            const ty = lerp(g.hoverY, g.hitY, te) + ny * tb;
            const ta = (1 - k / 7) * 0.5;
            ctx.save();
            ctx.globalCompositeOperation = 'lighter';
            ctx.fillStyle = rgba(g.col.glow, ta);
            ctx.shadowColor = rgba(g.col.glow, 0.8);
            ctx.shadowBlur = 8;
            ctx.beginPath();
            ctx.arc(tx, ty, g.size * (0.55 - k * 0.05), 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
          }
          // 着弾の直前でふっと消え、着弾の光に置き換わる（宝石が相手にめり込んで残らないように）
          const fade = t > 0.9 ? 1 - (t - 0.9) / 0.1 : 1;
          drawGem(ctx, px, py, g.size, t * g.spin * 3, g.col, fade);
        }
      });

      // ③個別の着弾（小さな光と火花）
      particles.push({
        delay: g.launch + POWERGEM_FLIGHT_MS,
        maxLife: 240,
        blend: 'lighter',
        draw(ctx, t) {
          const a = 1 - t;
          const r = lerp(2 * S, 22 * S, easeOutQuint(t));
          const gr = ctx.createRadialGradient(g.hitX, g.hitY, 0, g.hitX, g.hitY, r);
          gr.addColorStop(0, rgba('#ffffff', a));
          gr.addColorStop(0.5, rgba(g.col.glow, a * 0.7));
          gr.addColorStop(1, rgba(g.col.glow, 0));
          ctx.fillStyle = gr;
          ctx.beginPath();
          ctx.arc(g.hitX, g.hitY, r, 0, Math.PI * 2);
          ctx.fill();
          // 放射状の火花
          ctx.strokeStyle = rgba('#ffffff', a * 0.9);
          ctx.lineWidth = 1.4;
          for (let k = 0; k < 6; k++) {
            const ang = (k / 6) * Math.PI * 2 + g.seed;
            const r0 = r * 0.5, r1 = r * (1.1 + 0.3 * (k % 2));
            ctx.beginPath();
            ctx.moveTo(g.hitX + Math.cos(ang) * r0, g.hitY + Math.sin(ang) * r0);
            ctx.lineTo(g.hitX + Math.cos(ang) * r1, g.hitY + Math.sin(ang) * r1);
            ctx.stroke();
          }
        }
      });
    });

    // ---- 幕2：全弾着弾の総仕上げ（相手の上で宝石色の大きな光が弾ける）----
    const fin = POWERGEM_FINAL_IMPACT_MS;
    particles.push({
      delay: fin,
      maxLife: 380,
      blend: 'lighter',
      draw(ctx, t) {
        const a = (1 - t) * 0.95;
        const r = lerp(8 * S, 92 * S, easeOutQuint(t));
        const g = ctx.createRadialGradient(to.x, to.y, 0, to.x, to.y, r);
        g.addColorStop(0, rgba('#ffffff', a));
        g.addColorStop(0.3, rgba('#ffd0ea', a * 0.9));
        g.addColorStop(0.6, rgba('#9fe0ff', a * 0.55));
        g.addColorStop(1, 'rgba(159,224,255,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(to.x, to.y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    // 衝撃波リング（多重・虹色っぽく色を変える）
    ['#ffffff', '#ff9fd2', '#9fe0ff'].forEach((c, i) => {
      particles.push({
        delay: fin + i * 35,
        maxLife: 360 - i * 40,
        blend: 'lighter',
        draw(ctx, t) {
          const r = lerp(6 * S, R * (0.12 + i * 0.04), easeOutQuint(t));
          ctx.strokeStyle = rgba(c, (1 - t) * (0.85 - i * 0.15));
          ctx.lineWidth = (5 - i) * (1 - t * 0.5);
          ctx.shadowColor = rgba(c, 0.9);
          ctx.shadowBlur = 12;
          ctx.beginPath();
          ctx.arc(to.x, to.y, r, 0, Math.PI * 2);
          ctx.stroke();
        }
      });
    });
    // 大きな十字きらめき（爆ぜた瞬間の「キラーン」）
    particles.push({
      delay: fin,
      maxLife: 420,
      blend: 'lighter',
      draw(ctx, t) {
        const a = Math.sin(Math.PI * clamp01(t)) * 0.95;
        drawSparkle(ctx, to.x, to.y, lerp(10 * S, 78 * S, easeOutCubic(t)), a, '#ffffff');
      }
    });

    // ---- 幕3：着弾点に散る宝石の破片と光の粒（余韻）----
    for (let i = 0; i < 22; i++) {
      const col = PALETTE[i % PALETTE.length];
      const ang = rand(0, Math.PI * 2);
      const sp = rand(28, 92) * S;
      const isShard = i % 2 === 0; // 偶数＝小さな宝石の破片／奇数＝光の粒
      particles.push({
        delay: fin + rand(0, 40),
        maxLife: rand(360, 560),
        blend: isShard ? 'source-over' : 'lighter',
        ang, sp, col,
        size: rand(2.5, 5) * S,
        spin: rand(-9, 9),
        seed: rand(0, 100),
        draw(ctx, t) {
          const e = easeOutCubic(t);
          const x = to.x + Math.cos(this.ang) * this.sp * e;
          // 破片は重力で少し落ちる
          const y = to.y + Math.sin(this.ang) * this.sp * e * 0.8 + (isShard ? t * t * 26 * S : 0);
          const a = (1 - t) * (0.6 + 0.4 * Math.abs(noise1(t * 18, this.seed)));
          if (isShard) {
            drawGem(ctx, x, y, this.size, t * this.spin, this.col, a);
          } else {
            ctx.fillStyle = rgba(this.col.glow, a);
            ctx.shadowColor = rgba(this.col.glow, 0.9);
            ctx.shadowBlur = 7;
            ctx.beginPath();
            ctx.arc(x, y, this.size * 0.7, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      });
    }
  }

  // ============================================================
  // ジェムレーザー：宝石が光を集め、極太のレーザービームを相手へ一直線に撃ち込む演出
  // パワージェム（宝石の連射）と対比させ、こちらは「一点集中の極太の1本」で見せる。
  // 構成：①攻撃側の前に大きな宝石が現れ、周囲の小さな宝石が吸い寄せられて光が収束（チャージ）
  //       ②宝石から相手へ、白い芯＋虹色の光の層を重ねた極太ビームが一気に伸びる（発射）
  //       ③ビームが脈動しながら照射され、相手側に着弾光が育つ（照射）
  //       ④ビームが細く絞られて消え、相手の上で光が弾ける（着弾・収束）
  // 「宝石がレンズになる」「芯は白飛び・外周は多色」「ビームの中を色が流れる」がキモ。
  //
  // info = { from:{x,y}, to:{x,y}, scale } は spawnPowerGemSpecial と同じ（playSpecialTypeEffect が実測）。
  // ============================================================
  const GEMLASER_CHARGE_MS = 520;        // ①チャージ（宝石が光を集める）
  const GEMLASER_EXTEND_MS = 110;        // ②ビームが相手まで伸びきるまで
  const GEMLASER_HOLD_MS = 380;          // ③照射している時間（伸びきってから絞り始めるまで）
  const GEMLASER_FADE_MS = 240;          // ④ビームが絞られて消えるまで
  // ビームが相手に届く（＝ダメージの瞬間）。フラッシュはこの時刻に合わせる。
  const GEMLASER_HIT_MS = GEMLASER_CHARGE_MS + GEMLASER_EXTEND_MS;
  const GEMLASER_END_MS = GEMLASER_HIT_MS + GEMLASER_HOLD_MS + GEMLASER_FADE_MS;

  function spawnGemLaserSpecial(particles, w, h, info) {
    const from = (info && info.from) || { x: w * 0.28, y: h * 0.68 };
    const to = (info && info.to) || { x: w * 0.72, y: h * 0.32 };
    const S = (info && info.scale) || 1;
    const R = Math.max(w, h);

    // 宝石の色パレット（パワージェムと同じ5色。虹色のビームにも使う）
    const PALETTE = [
      { base: '#ff6fb5', hi: '#ffd0ea', lo: '#c2307f', glow: '#ff9fd2' }, // ピンク
      { base: '#5cc8ff', hi: '#d2f1ff', lo: '#2a86c8', glow: '#9fe0ff' }, // 水色
      { base: '#ffd84a', hi: '#fff4b8', lo: '#d09a12', glow: '#ffe98a' }, // 黄
      { base: '#5fe39a', hi: '#c9fadf', lo: '#25a865', glow: '#95f2bf' }, // 緑
      { base: '#b58cff', hi: '#e6d8ff', lo: '#7a4fd0', glow: '#cfb4ff' }, // 紫
    ];

    // ビームの向き・長さ
    const dx = to.x - from.x, dy = to.y - from.y;
    const len = Math.hypot(dx, dy) || 1;
    const ang = Math.atan2(dy, dx);
    const nx = -dy / len, ny = dx / len; // 進行方向に直交する単位ベクトル
    // 発射口：攻撃側の中心から相手方向へ少し前に出した位置に大宝石を浮かべる
    const muzzle = { x: from.x + Math.cos(ang) * 40 * S, y: from.y + Math.sin(ang) * 40 * S };
    const gemSize = 15 * S;              // 大宝石の大きさ
    // ビームの最大太さ（外周の光の幅）。「極太」に見せたいので相手スプライトの約1/3〜1/2を目安にする。
    // 被弾側が大きい画面(自機が撃たれる時)で太くなりすぎないよう、上限を設ける。
    const beamW = Math.min(42 * S, 46);

    // ---- 宝石（多面体カット）を描くヘルパー（パワージェムと同じ形状） ----
    function drawGem(ctx, x, y, size, rot, col, alpha) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rot);
      const pts = [];
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
        pts.push([Math.cos(a) * size * 0.9, Math.sin(a) * size]);
      }
      ctx.globalCompositeOperation = 'lighter';
      const halo = ctx.createRadialGradient(0, 0, 0, 0, 0, size * 2.1);
      halo.addColorStop(0, rgba(col.glow, alpha * 0.55));
      halo.addColorStop(1, rgba(col.glow, 0));
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(0, 0, size * 2.1, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      for (let i = 0; i < 6; i++) {
        const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % 6];
        const lit = (i === 0 || i === 1 || i === 5);
        ctx.fillStyle = rgba(lit ? col.hi : (i === 3 ? col.lo : col.base), alpha);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.closePath();
        ctx.fill();
      }
      ctx.strokeStyle = rgba('#ffffff', alpha * 0.85);
      ctx.lineWidth = Math.max(1, size * 0.09);
      ctx.beginPath();
      pts.forEach(([px, py], i) => i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py));
      ctx.closePath();
      ctx.stroke();
      ctx.globalCompositeOperation = 'lighter';
      const core = ctx.createRadialGradient(-size * 0.2, -size * 0.3, 0, -size * 0.2, -size * 0.3, size * 0.5);
      core.addColorStop(0, rgba('#ffffff', alpha));
      core.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = core;
      ctx.beginPath();
      ctx.arc(-size * 0.2, -size * 0.3, size * 0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // 4方向の十字きらめき
    function drawSparkle(ctx, x, y, size, alpha, color) {
      ctx.save();
      ctx.translate(x, y);
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = rgba(color, alpha);
      ctx.shadowColor = rgba(color, 0.9);
      ctx.shadowBlur = size * 0.8;
      ctx.beginPath();
      ctx.moveTo(0, -size);
      ctx.quadraticCurveTo(size * 0.12, -size * 0.12, size, 0);
      ctx.quadraticCurveTo(size * 0.12, size * 0.12, 0, size);
      ctx.quadraticCurveTo(-size * 0.12, size * 0.12, -size, 0);
      ctx.quadraticCurveTo(-size * 0.12, -size * 0.12, 0, -size);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    // ビームの「太さ係数」を時刻(ms)から返す：発射で一気に太くなり、照射中は脈動、最後は絞られる。
    //   0 = ビームなし、1 = 最大の太さ
    function beamStrength(ms) {
      if (ms < GEMLASER_CHARGE_MS) return 0;
      const sinceFire = ms - GEMLASER_CHARGE_MS;
      const holdEnd = GEMLASER_EXTEND_MS + GEMLASER_HOLD_MS;
      if (sinceFire < GEMLASER_EXTEND_MS) return easeOutCubic(sinceFire / GEMLASER_EXTEND_MS);
      if (sinceFire < holdEnd) {
        // 照射中：細かく脈動（1.0 前後で±8%）
        return 1 + Math.sin((sinceFire - GEMLASER_EXTEND_MS) * 0.05) * 0.08;
      }
      const f = clamp01((sinceFire - holdEnd) / GEMLASER_FADE_MS);
      return Math.pow(1 - f, 1.6); // 細く絞られる
    }
    // ビームが相手へ伸びている割合（0〜1）。発射から EXTEND_MS で先端が相手に到達する。
    function beamReach(ms) {
      if (ms < GEMLASER_CHARGE_MS) return 0;
      return easeOutQuint(clamp01((ms - GEMLASER_CHARGE_MS) / GEMLASER_EXTEND_MS));
    }

    // ============ ①チャージ：光を集める ============
    // 攻撃側の足元にうっすら宝石色の光
    particles.push({
      maxLife: GEMLASER_CHARGE_MS + 120,
      blend: 'lighter',
      draw(ctx, t) {
        const a = Math.sin(Math.PI * clamp01(t)) * 0.5;
        const r = lerp(12 * S, 58 * S, easeOutCubic(t));
        const g = ctx.createRadialGradient(from.x, from.y, 0, from.x, from.y, r);
        g.addColorStop(0, rgba('#ffffff', a * 0.6));
        g.addColorStop(0.5, rgba('#9fe0ff', a * 0.5));
        g.addColorStop(1, 'rgba(159,224,255,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(from.x, from.y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    });

    // 大宝石：ゆっくり回りながら現れ、チャージが進むほど強く発光する。発射後はビームの光源として残る。
    particles.push({
      delay: 60,
      maxLife: GEMLASER_END_MS - 60,
      draw(ctx, t) {
        const ms = 60 + t * (GEMLASER_END_MS - 60);
        const appear = easeOutCubic(clamp01((ms - 60) / 260));
        const fadeOut = ms > GEMLASER_END_MS - 200 ? clamp01((GEMLASER_END_MS - ms) / 200) : 1;
        if (fadeOut <= 0 || appear <= 0) return;
        // 宝石が「光を吸い込む」ほど輝きを増す（チャージ終盤で最大）
        const charge = clamp01(ms / GEMLASER_CHARGE_MS);
        const pulse = 1 + charge * 0.12 * Math.sin(ms * 0.045);
        // 宝石の色を時間でゆっくり変える＝プリズムのように色が移ろう
        const colIdx = (ms / 110) | 0;
        const col = PALETTE[colIdx % PALETTE.length];
        // 発光（チャージが進むほど大きい）
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const hr = gemSize * (2.4 + charge * 2.6) * appear;
        const hg = ctx.createRadialGradient(muzzle.x, muzzle.y, 0, muzzle.x, muzzle.y, hr);
        hg.addColorStop(0, rgba('#ffffff', 0.85 * fadeOut));
        hg.addColorStop(0.35, rgba(col.glow, 0.55 * fadeOut));
        hg.addColorStop(1, rgba(col.glow, 0));
        ctx.fillStyle = hg;
        ctx.beginPath();
        ctx.arc(muzzle.x, muzzle.y, hr, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        drawGem(ctx, muzzle.x, muzzle.y, gemSize * appear * pulse, ms * 0.004, col, fadeOut);
      }
    });

    // 周囲の小さな宝石が吸い寄せられて大宝石に溶け込む（光が収束する感じ）
    for (let i = 0; i < 12; i++) {
      const col = PALETTE[i % PALETTE.length];
      const a0 = (i / 12) * Math.PI * 2 + rand(-0.2, 0.2);
      const r0 = rand(58, 92) * S;
      const startAt = rand(60, 260);
      const life = rand(240, 300);
      particles.push({
        delay: startAt,
        maxLife: life,
        draw(ctx, t) {
          if (t >= 1) return; // 吸い込まれたら消える（居残り防止）
          const e = easeInCubic(t);              // 後半ほど加速して吸い込まれる
          const rr = lerp(r0, 2 * S, e);
          const spin = a0 + t * 2.4;             // 渦を巻きながら寄る
          const x = muzzle.x + Math.cos(spin) * rr;
          const y = muzzle.y + Math.sin(spin) * rr * 0.8;
          const a = clamp01(t * 5) * (1 - Math.max(0, (t - 0.85) / 0.15));
          drawGem(ctx, x, y, (4.5 * S) * (1 - t * 0.5), t * 8, col, a);
        }
      });
    }
    // 収束する光の筋（大宝石に向かって細い光条が縮む）
    for (let i = 0; i < 8; i++) {
      const a0 = (i / 8) * Math.PI * 2;
      particles.push({
        delay: 120 + i * 18,
        maxLife: GEMLASER_CHARGE_MS - 120 - i * 18,
        blend: 'lighter',
        draw(ctx, t) {
          const outer = lerp(78 * S, 14 * S, easeInCubic(t));
          const inner = outer - 16 * S * (1 - t * 0.4);
          ctx.strokeStyle = rgba('#e8f6ff', Math.sin(Math.PI * clamp01(t)) * 0.65);
          ctx.lineWidth = 1.5;
          ctx.shadowColor = rgba('#9fe0ff', 0.9);
          ctx.shadowBlur = 6;
          ctx.beginPath();
          ctx.moveTo(muzzle.x + Math.cos(a0) * outer, muzzle.y + Math.sin(a0) * outer);
          ctx.lineTo(muzzle.x + Math.cos(a0) * inner, muzzle.y + Math.sin(a0) * inner);
          ctx.stroke();
        }
      });
    }

    // ============ ②③④ビーム本体 ============
    // 1つのパーティクルで全期間を描く（太さ・長さを時刻から直接計算するため）。
    particles.push({
      delay: GEMLASER_CHARGE_MS,
      maxLife: GEMLASER_END_MS - GEMLASER_CHARGE_MS,
      blend: 'lighter',
      draw(ctx, t) {
        const ms = GEMLASER_CHARGE_MS + t * (GEMLASER_END_MS - GEMLASER_CHARGE_MS);
        const k = beamStrength(ms);
        if (k <= 0.01) return;
        const reach = beamReach(ms);
        // ビームの端点：発射口 → 先端。先端は相手の中心を少し越えた位置まで（突き抜ける勢い）
        const endX = muzzle.x + (to.x - muzzle.x) * reach;
        const endY = muzzle.y + (to.y - muzzle.y) * reach;

        // 層を外→内へ重ねる：外周ほど太く暗い多色、中心ほど細く白い。
        // 各層は「進行方向に直交する幅」を持つ帯として塗る（線幅=層の太さ）。
        const layers = [
          { wMul: 1.00, col: '#ff9fd2', a: 0.16 },  // 最外：ピンクの淡い光
          { wMul: 0.80, col: '#9fe0ff', a: 0.22 },  // 水色
          { wMul: 0.62, col: '#cfb4ff', a: 0.30 },  // 紫
          { wMul: 0.44, col: '#95f2bf', a: 0.36 },  // 緑
          { wMul: 0.30, col: '#ffe98a', a: 0.55 },  // 黄
          { wMul: 0.16, col: '#ffffff', a: 0.95 },  // 芯：白飛び
        ];
        ctx.lineCap = 'round';
        layers.forEach((L) => {
          ctx.strokeStyle = rgba(L.col, L.a * Math.min(1, k * 1.2));
          ctx.lineWidth = Math.max(0.5, beamW * L.wMul * k);
          ctx.shadowColor = rgba(L.col, 0.9);
          ctx.shadowBlur = 14 * S * k;
          ctx.beginPath();
          ctx.moveTo(muzzle.x, muzzle.y);
          ctx.lineTo(endX, endY);
          ctx.stroke();
        });

        // ビームの中を流れる色の光（プリズムのように、多色の光の粒が発射口→相手へ流れる）
        ctx.shadowBlur = 0;
        for (let i = 0; i < 16; i++) {
          const base = ((i / 16) + ms * 0.0022) % 1;      // 0〜1 を周回して流れ続ける
          const px = muzzle.x + (endX - muzzle.x) * base;
          const py = muzzle.y + (endY - muzzle.y) * base;
          // 進行方向と直交する方向にゆらす（ビームの内部で光が波打つ）
          const wob = Math.sin(base * 14 + ms * 0.02 + i) * beamW * 0.16 * k;
          const c = PALETTE[i % PALETTE.length];
          ctx.fillStyle = rgba(c.hi, 0.85 * k);
          ctx.beginPath();
          ctx.arc(px + nx * wob, py + ny * wob, Math.max(0.8, 3.2 * S * k), 0, Math.PI * 2);
          ctx.fill();
        }
      }
    });

    // 発射口の閃光（発射の瞬間にドンと光る）
    particles.push({
      delay: GEMLASER_CHARGE_MS - 20,
      maxLife: 260,
      blend: 'lighter',
      draw(ctx, t) {
        const a = (1 - t) * 0.95;
        const r = lerp(10 * S, 58 * S, easeOutQuint(t));
        const g = ctx.createRadialGradient(muzzle.x, muzzle.y, 0, muzzle.x, muzzle.y, r);
        g.addColorStop(0, rgba('#ffffff', a));
        g.addColorStop(0.4, rgba('#cfe9ff', a * 0.7));
        g.addColorStop(1, 'rgba(159,224,255,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(muzzle.x, muzzle.y, r, 0, Math.PI * 2);
        ctx.fill();
        drawSparkle(ctx, muzzle.x, muzzle.y, lerp(8 * S, 46 * S, easeOutCubic(t)), a, '#ffffff');
      }
    });

    // ============ 着弾：相手の上でビームが当たり続ける光 ============
    // 着弾光球：ビームが届いた瞬間から育ち、照射が終わるとしぼむ
    particles.push({
      delay: GEMLASER_HIT_MS - 30,
      maxLife: GEMLASER_HOLD_MS + GEMLASER_FADE_MS + 60,
      blend: 'lighter',
      draw(ctx, t) {
        const ms = t * (GEMLASER_HOLD_MS + GEMLASER_FADE_MS + 60);
        const grow = easeOutCubic(clamp01(ms / 90));
        const fade = ms > GEMLASER_HOLD_MS ? Math.pow(1 - clamp01((ms - GEMLASER_HOLD_MS) / (GEMLASER_FADE_MS + 60)), 1.4) : 1;
        const pulse = 1 + Math.sin(ms * 0.06) * 0.1;
        const r = 46 * S * grow * pulse * (0.6 + 0.4 * fade);
        const a = fade * 0.95;
        if (a <= 0.01) return;
        const g = ctx.createRadialGradient(to.x, to.y, 0, to.x, to.y, r);
        g.addColorStop(0, rgba('#ffffff', a));
        g.addColorStop(0.35, rgba('#ffe98a', a * 0.8));
        g.addColorStop(0.65, rgba('#9fe0ff', a * 0.5));
        g.addColorStop(1, 'rgba(159,224,255,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(to.x, to.y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    // 着弾点から四方へ弾ける火花（照射中ずっと出続ける）
    for (let i = 0; i < 26; i++) {
      const col = PALETTE[i % PALETTE.length];
      const sa = ang + Math.PI + rand(-1.1, 1.1);        // 相手から「手前側」へ跳ね返るように散る
      const spd = rand(30, 96) * S;
      const born = GEMLASER_HIT_MS + rand(0, GEMLASER_HOLD_MS);
      const dotR = rand(1.6, 3.4) * S;   // 大きさは生成時に固定（draw内で乱数を引くとチラつく）
      particles.push({
        delay: born,
        maxLife: rand(180, 320),
        blend: 'lighter',
        draw(ctx, t) {
          const e = easeOutCubic(t);
          const x = to.x + Math.cos(sa) * spd * e;
          const y = to.y + Math.sin(sa) * spd * e + t * t * 14 * S;
          const a = (1 - t) * 0.95;
          ctx.fillStyle = rgba(col.glow, a);
          ctx.shadowColor = rgba(col.glow, 0.9);
          ctx.shadowBlur = 7;
          ctx.beginPath();
          ctx.arc(x, y, dotR * (1 - t * 0.4), 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }

    // ============ ④ビームが絞られて消える瞬間：相手の上で光が弾ける ============
    const burstAt = GEMLASER_HIT_MS + GEMLASER_HOLD_MS;
    particles.push({
      delay: burstAt,
      maxLife: 380,
      blend: 'lighter',
      draw(ctx, t) {
        const a = (1 - t) * 0.9;
        const r = lerp(10 * S, 86 * S, easeOutQuint(t));
        const g = ctx.createRadialGradient(to.x, to.y, 0, to.x, to.y, r);
        g.addColorStop(0, rgba('#ffffff', a));
        g.addColorStop(0.3, rgba('#ffd0ea', a * 0.85));
        g.addColorStop(0.62, rgba('#9fe0ff', a * 0.5));
        g.addColorStop(1, 'rgba(159,224,255,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(to.x, to.y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    ['#ffffff', '#ffe98a', '#9fe0ff'].forEach((c, i) => {
      particles.push({
        delay: burstAt + i * 30,
        maxLife: 360 - i * 40,
        blend: 'lighter',
        draw(ctx, t) {
          const r = lerp(6 * S, R * (0.11 + i * 0.035), easeOutQuint(t));
          ctx.strokeStyle = rgba(c, (1 - t) * (0.85 - i * 0.15));
          ctx.lineWidth = (5 - i) * (1 - t * 0.5);
          ctx.shadowColor = rgba(c, 0.9);
          ctx.shadowBlur = 12;
          ctx.beginPath();
          ctx.arc(to.x, to.y, r, 0, Math.PI * 2);
          ctx.stroke();
        }
      });
    });
    particles.push({
      delay: burstAt,
      maxLife: 400,
      blend: 'lighter',
      draw(ctx, t) {
        const a = Math.sin(Math.PI * clamp01(t)) * 0.95;
        drawSparkle(ctx, to.x, to.y, lerp(10 * S, 74 * S, easeOutCubic(t)), a, '#ffffff');
      }
    });
    // 散る宝石の破片と光の粒（余韻）
    for (let i = 0; i < 18; i++) {
      const col = PALETTE[i % PALETTE.length];
      const a1 = rand(0, Math.PI * 2);
      const sp = rand(26, 84) * S;
      const isShard = i % 2 === 0;
      const shardR = rand(2.4, 4.4) * S; // 生成時に固定
      particles.push({
        delay: burstAt + rand(0, 40),
        maxLife: rand(340, 520),
        blend: isShard ? 'source-over' : 'lighter',
        draw(ctx, t) {
          const e = easeOutCubic(t);
          const x = to.x + Math.cos(a1) * sp * e;
          const y = to.y + Math.sin(a1) * sp * e * 0.8 + (isShard ? t * t * 24 * S : 0);
          const a = 1 - t;
          if (isShard) {
            drawGem(ctx, x, y, shardR, t * 8, col, a);
          } else {
            ctx.fillStyle = rgba(col.glow, a);
            ctx.shadowColor = rgba(col.glow, 0.9);
            ctx.shadowBlur = 7;
            ctx.beginPath();
            ctx.arc(x, y, 2.4 * S, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      });
    }
  }

  // ============================================================
  // シグナルビーム：口・触角から相手へ、渦を巻きながら回転する虹色の光の輪を撃ち込む演出
  // （ダイヤモンド・パール version 準拠：画面シェイクなしの、細く鋭いリング状ビーム）
  // 構成：①攻撃側の前に小さな光点が生まれ、細い光条が渦状に巻き上がる（チャージ）
  //       ②光点から相手へ、螺旋を描く虹色のリングの連なりが一直線に伸びていく（発射）
  //       ③リングが相手に届き続け、渦を巻いたまま照射される（照射）
  //       ④照射が終わり、相手の上でリングがはじけ、虹色の光の粒が舞い散る（着弾・収束）
  // パワージェム／ジェムレーザーと違い「太い光の帯」ではなく「回転する小さな輪の連なり」で見せるのが肝。
  // 画面は揺らさない（原作の見た目に忠実に、フラッシュのみで着弾を表現する）。
  //
  // info = { from:{x,y}, to:{x,y}, scale } は spawnPowerGemSpecial と同じ（playSpecialTypeEffect が実測）。
  // ============================================================
  const SIGNALBEAM_CHARGE_MS = 300;      // ①チャージ（光点が生まれ、渦が巻き始める）
  const SIGNALBEAM_EXTEND_MS = 260;      // ②リングの列が相手まで伸びきるまで
  const SIGNALBEAM_HOLD_MS = 260;        // ③伸びきった後、なお照射している時間
  const SIGNALBEAM_FADE_MS = 220;        // ④リングの列が消えていくまで
  // ビームが相手に届く（＝ダメージの瞬間）。フラッシュはこの時刻に合わせる。
  const SIGNALBEAM_HIT_MS = SIGNALBEAM_CHARGE_MS + SIGNALBEAM_EXTEND_MS;
  const SIGNALBEAM_END_MS = SIGNALBEAM_HIT_MS + SIGNALBEAM_HOLD_MS + SIGNALBEAM_FADE_MS;

  function spawnSignalBeamSpecial(particles, w, h, info) {
    const from = (info && info.from) || { x: w * 0.28, y: h * 0.68 };
    const to = (info && info.to) || { x: w * 0.72, y: h * 0.32 };
    const S = (info && info.scale) || 1;

    // 原作のシグナルビームは「虹色」：赤〜紫を巡るパレット
    const RAINBOW = ['#ff5f6d', '#ffc23f', '#fff35c', '#7fe97f', '#5cc8ff', '#8f7bff', '#e07bff'];

    const dx = to.x - from.x, dy = to.y - from.y;
    const len = Math.hypot(dx, dy) || 1;
    const ang = Math.atan2(dy, dx);
    const nx = -dy / len, ny = dx / len; // 進行方向に直交する単位ベクトル
    // 発射口：攻撃側の中心から相手方向へ少し前に出した位置
    const muzzle = { x: from.x + Math.cos(ang) * 34 * S, y: from.y + Math.sin(ang) * 34 * S };
    const ringR = Math.min(13 * S, 15);        // リング1個の半径（原作同様、細く小さい）
    const ringSpacing = 34 * S;                 // リングとリングの間隔（進行方向）
    const ringCount = 9;                        // 一度に見えるリングの数

    // ---- 虹色のリング（原作の輪っかを模した楕円リング）を描くヘルパー ----
    // spin: リング自体の自転角。face: リングが正面を向くほど大きな円、横を向くほど細い楕円に見える。
    function drawRing(ctx, x, y, r, spin, alpha, colIdx) {
      if (alpha <= 0.01) return;
      const col = RAINBOW[((colIdx % RAINBOW.length) + RAINBOW.length) % RAINBOW.length];
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(ang); // ビームの進行方向にリングの傾きを揃える
      const squash = 0.42; // リングを進行方向から見た形（薄い楕円＝渦を巻く輪）
      ctx.scale(1, squash);
      ctx.rotate(spin);
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = rgba(col, alpha);
      ctx.lineWidth = Math.max(1.2, r * 0.34);
      ctx.shadowColor = rgba(col, 0.9);
      ctx.shadowBlur = 8 * S;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.stroke();
      // 内側にうっすら白い芯を入れて、輪に厚みを出す
      ctx.strokeStyle = rgba('#ffffff', alpha * 0.55);
      ctx.lineWidth = Math.max(0.6, r * 0.14);
      ctx.shadowBlur = 0;
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.78, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    function drawSparkle(ctx, x, y, size, alpha, color) {
      ctx.save();
      ctx.translate(x, y);
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = rgba(color, alpha);
      ctx.shadowColor = rgba(color, 0.9);
      ctx.shadowBlur = size * 0.8;
      ctx.beginPath();
      ctx.moveTo(0, -size);
      ctx.quadraticCurveTo(size * 0.12, -size * 0.12, size, 0);
      ctx.quadraticCurveTo(size * 0.12, size * 0.12, 0, size);
      ctx.quadraticCurveTo(-size * 0.12, size * 0.12, -size, 0);
      ctx.quadraticCurveTo(-size * 0.12, -size * 0.12, 0, -size);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    // ビームの先端が相手へ伸びている割合（0〜1）
    function beamReach(ms) {
      if (ms < SIGNALBEAM_CHARGE_MS) return 0;
      return easeOutCubic(clamp01((ms - SIGNALBEAM_CHARGE_MS) / SIGNALBEAM_EXTEND_MS));
    }
    // 全体の発光の強さ（発射で立ち上がり、照射中は一定、消える瞬間に絞る）
    function beamStrength(ms) {
      if (ms < SIGNALBEAM_CHARGE_MS) return 0;
      const sinceFire = ms - SIGNALBEAM_CHARGE_MS;
      const holdEnd = SIGNALBEAM_EXTEND_MS + SIGNALBEAM_HOLD_MS;
      if (sinceFire < SIGNALBEAM_EXTEND_MS) return easeOutCubic(sinceFire / SIGNALBEAM_EXTEND_MS);
      if (sinceFire < holdEnd) return 1;
      const f = clamp01((sinceFire - holdEnd) / SIGNALBEAM_FADE_MS);
      return Math.pow(1 - f, 1.5);
    }

    // ============ ①チャージ：発射口に光点が生まれ、渦が巻き始める ============
    particles.push({
      maxLife: SIGNALBEAM_CHARGE_MS + 80,
      blend: 'lighter',
      draw(ctx, t) {
        const a = Math.sin(Math.PI * clamp01(t)) * 0.7;
        const r = lerp(3 * S, 13 * S, easeOutCubic(t));
        const g = ctx.createRadialGradient(muzzle.x, muzzle.y, 0, muzzle.x, muzzle.y, r);
        g.addColorStop(0, rgba('#ffffff', a));
        g.addColorStop(0.5, rgba('#bfe8ff', a * 0.6));
        g.addColorStop(1, 'rgba(191,232,255,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(muzzle.x, muzzle.y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    // チャージ中、口元で細い虹色の光条が渦を巻いて集まる
    for (let i = 0; i < 6; i++) {
      const col = RAINBOW[i % RAINBOW.length];
      const a0 = (i / 6) * Math.PI * 2;
      particles.push({
        delay: 40 + i * 20,
        maxLife: SIGNALBEAM_CHARGE_MS - 40 - i * 20,
        blend: 'lighter',
        draw(ctx, t) {
          const outer = lerp(30 * S, 4 * S, easeInCubic(t));
          const spin = a0 + t * 6;
          const x = muzzle.x + Math.cos(spin) * outer;
          const y = muzzle.y + Math.sin(spin) * outer * 0.6;
          const alpha = Math.sin(Math.PI * clamp01(t)) * 0.85;
          ctx.fillStyle = rgba(col, alpha);
          ctx.shadowColor = rgba(col, 0.9);
          ctx.shadowBlur = 6;
          ctx.beginPath();
          ctx.arc(x, y, 2.2 * S, 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }

    // ============ ②③リング列本体：渦を巻きながら相手へ伸びていくビーム ============
    // 1つのパーティクルで全期間を描く（リング位置・spin・太さを時刻から直接計算するため）。
    particles.push({
      delay: SIGNALBEAM_CHARGE_MS,
      maxLife: SIGNALBEAM_END_MS - SIGNALBEAM_CHARGE_MS,
      blend: 'lighter',
      draw(ctx, t) {
        const ms = SIGNALBEAM_CHARGE_MS + t * (SIGNALBEAM_END_MS - SIGNALBEAM_CHARGE_MS);
        const k = beamStrength(ms);
        if (k <= 0.01) return;
        const reach = beamReach(ms);
        const tipX = muzzle.x + (to.x - muzzle.x) * reach;
        const tipY = muzzle.y + (to.y - muzzle.y) * reach;
        const tipLen = Math.hypot(tipX - muzzle.x, tipY - muzzle.y);

        // 芯の細い直線（リングの中心を貫く光の筋）
        ctx.strokeStyle = rgba('#ffffff', 0.5 * k);
        ctx.lineWidth = Math.max(0.8, 2.2 * S * k);
        ctx.shadowColor = rgba('#ffffff', 0.8);
        ctx.shadowBlur = 6 * S;
        ctx.beginPath();
        ctx.moveTo(muzzle.x, muzzle.y);
        ctx.lineTo(tipX, tipY);
        ctx.stroke();
        ctx.shadowBlur = 0;

        // 発射口→先端に向かって並ぶ、渦を巻くリングの連なり
        for (let i = 0; i < ringCount; i++) {
          // 先端(=0)から根元へ向かうほど距離が大きくなる。奔流のように連続的に流れる。
          const flow = (ms * 0.5) % ringSpacing; // 流れのオフセット（リングが手前から湧き続ける）
          const distFromTip = i * ringSpacing + flow;
          if (distFromTip > tipLen) continue; // 先端より奥（まだ届いていない）は描かない
          const pos = clamp01(1 - distFromTip / Math.max(tipLen, 1));
          const rx = lerp(muzzle.x, tipX, pos);
          const ry = lerp(muzzle.y, tipY, pos);
          // 根元に近いほど薄く、先端に近いほど濃い（伸びていく躍動感）
          const edgeFade = clamp01(distFromTip / (ringSpacing * 1.4));
          const alpha = k * Math.min(1, edgeFade) * 0.85;
          const spin = ms * 0.02 + i * 1.1; // リングごとに回転位相をずらして渦らせる
          drawRing(ctx, rx, ry, ringR * (0.75 + 0.25 * Math.sin(spin)), spin, alpha, i);
        }
      }
    });

    // 発射口の閃光（発射の瞬間に小さく光る。原作同様、控えめ）
    particles.push({
      delay: SIGNALBEAM_CHARGE_MS - 15,
      maxLife: 200,
      blend: 'lighter',
      draw(ctx, t) {
        const a = (1 - t) * 0.85;
        const r = lerp(6 * S, 26 * S, easeOutQuint(t));
        const g = ctx.createRadialGradient(muzzle.x, muzzle.y, 0, muzzle.x, muzzle.y, r);
        g.addColorStop(0, rgba('#ffffff', a));
        g.addColorStop(0.5, rgba('#e07bff', a * 0.5));
        g.addColorStop(1, 'rgba(224,123,255,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(muzzle.x, muzzle.y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    });

    // ============ 着弾：相手の上でリングが渦を巻いて弾け続ける ============
    particles.push({
      delay: SIGNALBEAM_HIT_MS - 20,
      maxLife: SIGNALBEAM_HOLD_MS + SIGNALBEAM_FADE_MS + 40,
      blend: 'lighter',
      draw(ctx, t) {
        const ms = t * (SIGNALBEAM_HOLD_MS + SIGNALBEAM_FADE_MS + 40);
        const grow = easeOutCubic(clamp01(ms / 80));
        const fade = ms > SIGNALBEAM_HOLD_MS ? Math.pow(1 - clamp01((ms - SIGNALBEAM_HOLD_MS) / (SIGNALBEAM_FADE_MS + 40)), 1.3) : 1;
        const r = 22 * S * grow * (0.7 + 0.3 * fade);
        const a = fade * 0.8;
        if (a <= 0.01) return;
        const g = ctx.createRadialGradient(to.x, to.y, 0, to.x, to.y, r);
        g.addColorStop(0, rgba('#ffffff', a));
        g.addColorStop(0.4, rgba('#e07bff', a * 0.6));
        g.addColorStop(1, 'rgba(224,123,255,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(to.x, to.y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    // 着弾点で回転しながら弾ける小さな虹色リング（渦の余韻）
    for (let i = 0; i < 7; i++) {
      particles.push({
        delay: SIGNALBEAM_HIT_MS + i * 26,
        maxLife: SIGNALBEAM_HOLD_MS + SIGNALBEAM_FADE_MS - i * 20,
        blend: 'lighter',
        draw(ctx, t) {
          const r = lerp(4 * S, 24 * S, easeOutCubic(t));
          const alpha = (1 - t) * 0.85;
          drawRing(ctx, to.x, to.y, r, t * 5 + i, alpha, i + 2);
        }
      });
    }

    // ============ ④着弾後：虹色の光の粒が四方へ舞い散る ============
    const burstAt = SIGNALBEAM_HIT_MS + SIGNALBEAM_HOLD_MS;
    for (let i = 0; i < 20; i++) {
      const col = RAINBOW[i % RAINBOW.length];
      const sa = rand(0, Math.PI * 2);
      const spd = rand(24, 74) * S;
      const dotR = rand(1.6, 3.2) * S;
      particles.push({
        delay: burstAt + rand(0, 30),
        maxLife: rand(220, 380),
        blend: 'lighter',
        draw(ctx, t) {
          const e = easeOutCubic(t);
          const x = to.x + Math.cos(sa) * spd * e;
          const y = to.y + Math.sin(sa) * spd * e + t * t * 16 * S;
          const a = (1 - t) * 0.9;
          ctx.fillStyle = rgba(col, a);
          ctx.shadowColor = rgba(col, 0.9);
          ctx.shadowBlur = 6;
          ctx.beginPath();
          ctx.arc(x, y, dotR * (1 - t * 0.4), 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }
    particles.push({
      delay: burstAt,
      maxLife: 320,
      blend: 'lighter',
      draw(ctx, t) {
        const a = Math.sin(Math.PI * clamp01(t)) * 0.75;
        drawSparkle(ctx, to.x, to.y, lerp(6 * S, 40 * S, easeOutCubic(t)), a, '#ffffff');
      }
    });
  }

  // ============================================================
  // オーラファイト（オリジナル技）：念を込めて赤い薄いオーラの拳を作り、相手へ殴りつけるように飛ばす演出
  // （剣盾のダイナックルのイメージ：拳の形をしたエネルギーが相手を殴る。ただし今回は「上から」ではなく、
  //   攻撃側の手元で念を込めて拳を作り上げ、その拳を相手へ向かって飛ばす）
  // 構成：①攻撃側の前で、赤い念の筋が渦を巻いて集まり、回る「念の輪」の中に拳の形が浮かび上がる（念を込める）
  //       ②拳がぎゅっと握り込まれて震え、殴る直前に一度うしろへ引く（溜め）
  //       ③拳が残像と赤い風の筋を引きながら、相手へ一直線に飛ぶ（発射）
  //       ④命中の瞬間、拳が相手にめり込み、衝撃のギザギザ星と赤い波紋が広がって、拳が砕け散る（炸裂）
  //       ⑤赤い火の粉と靄が立ちのぼって消える（余韻）
  // 見た目の肝：拳は「輪郭線＋ごく薄い塗り」だけで描き、相手のポケモンが透けて見える薄いオーラにすること。
  //             拳の形は、4本の指を縦に重ねた握り拳＋指を上から押さえる親指を、輪郭線の重なりで表現している。
  //             拳の向きは常に進行方向（攻撃側→相手）に向け、左向きのときは左右反転して親指が上に残るようにしている。
  // 画面は揺らさない（あくのはどう・はどうだん・きあいだまと同じ方針）。
  //
  // info = { from:{x,y}, to:{x,y}, scale } は spawnFocusBlastSpecial と同じ（playSpecialTypeEffect が実測）。
  // ============================================================
  const AURAFIST_FORM_MS = 560;      // ①念を込めて拳が浮かび上がる
  const AURAFIST_HOLD_MS = 220;      // ②握り込んで震え、うしろへ引く
  const AURAFIST_FLIGHT_MS = 280;    // ③拳が手元→相手へ届くまで
  const AURAFIST_LINGER_MS = 200;    // 命中後、拳が相手にめり込んで砕けるまで
  const AURAFIST_LAUNCH_MS = AURAFIST_FORM_MS + AURAFIST_HOLD_MS;   // 拳を放つ時刻
  // 拳が相手に届く（＝ダメージの瞬間）。フラッシュ等はこの時刻に合わせる。
  const AURAFIST_HIT_MS = AURAFIST_LAUNCH_MS + AURAFIST_FLIGHT_MS;
  const AURAFIST_END_MS = AURAFIST_HIT_MS + 760;

  function spawnAuraFistSpecial(particles, w, h, info) {
    const from = (info && info.from) || { x: w * 0.28, y: h * 0.68 };
    const to = (info && info.to) || { x: w * 0.72, y: h * 0.32 };
    const S = (info && info.scale) || 1;
    const seed = rand(0, 100);

    const dx = to.x - from.x, dy = to.y - from.y;
    const dist = Math.hypot(dx, dy) || 1;
    const ux = dx / dist, uy = dy / dist;
    const ang = Math.atan2(dy, dx);
    const perpX = -uy, perpY = ux;   // 進行方向に直交する単位ベクトル
    // 拳を作る位置：攻撃側の中心から相手方向へ少し前に出した位置
    const hand = { x: from.x + ux * 46 * S, y: from.y + uy * 46 * S - 6 * S };
    // 命中位置：相手の中心
    const target = { x: to.x, y: to.y };

    const FIST_R = 32 * S;        // 拳の基準サイズ（単位座標1 = この長さ）
    const HIT_SCALE = 1.25;       // 命中時の拳の大きさ（飛びながら少し大きくなる）
    const WIND_UP = 16 * S;       // 殴る直前にうしろへ引く距離
    // 引いた位置（発射の起点）と、命中時の拳の位置（拳頭が相手の中心に届く位置）
    const startPos = { x: hand.x - ux * WIND_UP, y: hand.y - uy * WIND_UP };
    const endPos = { x: target.x - ux * FIST_R * HIT_SCALE * 0.6, y: target.y - uy * FIST_R * HIT_SCALE * 0.6 };

    // オーラの配色：赤（薄く透ける）。芯だけ淡いピンクに寄せて、白飛びさせない
    const DEEP = '#a80f1e';     // 濃い赤（輪郭の根元・靄）
    const RED = '#ff2a3a';      // 赤（主色）
    const RED_HI = '#ff6a70';   // 明るい赤（縁）
    const PINK = '#ffc4c8';     // 淡いピンク（最も明るい部分）
    const WHITE = '#ffffff';

    // ---- 拳の形（単位座標。+x が殴る向き、-y が上＝親指側）----
    // 4本の指を縦に積み、その前面が指の第二関節の折れ。親指が上の3本の指を縦に押さえ、うしろに手首が続く。
    // すべて同じ向き（時計回り）の角丸長方形なので、1回の fill() で重なりが二重塗りにならない。
    const FIST_LEN = [0.80, 0.86, 0.82, 0.70];   // 各指の長さ（小指だけ短い）
    function rr(ctx, x, y, wd, ht, r) {
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + wd - r, y);
      ctx.arc(x + wd - r, y + r, r, -Math.PI / 2, 0);
      ctx.lineTo(x + wd, y + ht - r);
      ctx.arc(x + wd - r, y + ht - r, r, 0, Math.PI / 2);
      ctx.lineTo(x + r, y + ht);
      ctx.arc(x + r, y + ht - r, r, Math.PI / 2, Math.PI);
      ctx.lineTo(x, y + r);
      ctx.arc(x + r, y + r, r, Math.PI, Math.PI * 1.5);
      ctx.closePath();
    }
    function fistPath(ctx) {
      rr(ctx, -0.78, -0.6, 0.98, 1.2, 0.3);                 // 手の甲
      for (let i = 0; i < 4; i++) {                          // 4本の指（縦に積む）
        const cy = -0.45 + 0.3 * i;
        rr(ctx, -0.02, cy - 0.15, FIST_LEN[i] + 0.02, 0.3, 0.15);
      }
      rr(ctx, 0.36, -0.7, 0.32, 1.0, 0.16);                 // 親指（上の3本の指を縦に押さえる）
      rr(ctx, -1.35, -0.38, 0.65, 0.76, 0.16);              // 手首
    }

    // ---- 拳の状態を時刻(ms)から直接計算する（浮かび上がる→握る→引く→飛ぶ→めり込む を1本の関数で扱う）----
    function fistState(ms) {
      let x, y, sc, alpha = 1, build = 1, flight = 0;
      if (ms < AURAFIST_FORM_MS) {
        build = clamp01(ms / AURAFIST_FORM_MS);
        sc = 0.4 + 0.6 * easeOutCubic(build);
        x = hand.x;
        y = hand.y + Math.sin(ms * 0.012) * 1.6 * S;
        alpha = clamp01(ms / 120);
      } else if (ms < AURAFIST_LAUNCH_MS) {
        const f = (ms - AURAFIST_FORM_MS) / AURAFIST_HOLD_MS;
        sc = 1 - 0.06 * Math.sin(Math.min(1, f * 1.4) * Math.PI / 2);          // ぎゅっと握り込む
        const pull = easeInOutSine(clamp01((f - 0.3) / 0.7));                  // 殴る前にうしろへ引く
        const tremble = f * 1.4 * S;                                           // 力が入って小刻みに震える
        x = lerp(hand.x, startPos.x, pull) + noise1(ms * 0.09, seed) * tremble;
        y = lerp(hand.y, startPos.y, pull) + noise1(ms * 0.11, seed + 4) * tremble;
      } else if (ms < AURAFIST_HIT_MS) {
        flight = clamp01((ms - AURAFIST_LAUNCH_MS) / AURAFIST_FLIGHT_MS);
        const e = easeInCubic(flight) * 0.55 + flight * 0.45;                  // 一気に加速して殴りつける
        x = lerp(startPos.x, endPos.x, e);
        y = lerp(startPos.y, endPos.y, e);
        sc = lerp(1, HIT_SCALE, easeInCubic(flight));
      } else {
        const p = clamp01((ms - AURAFIST_HIT_MS) / AURAFIST_LINGER_MS);
        const push = easeOutCubic(clamp01(p * 2.2));                           // 相手にめり込む
        x = endPos.x + ux * 6 * S * push;
        y = endPos.y + uy * 6 * S * push;
        sc = HIT_SCALE + 0.08 * p;
        alpha = 1 - Math.pow(p, 1.5);                                          // 砕けて消える
        flight = 1;
      }
      return { x, y, sc, alpha, build, flight };
    }

    // ---- 拳を1つ描く。simple=true は残像用（塗りと輪郭だけの軽い描き方）----
    function drawFist(ctx, x, y, sc, alpha, build, ms, simple) {
      if (alpha <= 0.01 || sc <= 0.05) return;
      const R = FIST_R * sc;
      const fillA = alpha * build * build;   // 浮かび上がる間は、塗りは遅れて濃くなる
      const lineA = alpha * build;
      const px = (n) => n / R;                // 画面上のpx幅 → 単位座標の線幅
      ctx.save();
      ctx.translate(x, y);
      // 向き：右向きはそのまま回転。左向きは左右反転して、親指が上に残るようにする
      if (ux < 0) { ctx.rotate(ang + Math.PI); ctx.scale(-1, 1); } else { ctx.rotate(ang); }
      ctx.scale(R, R);
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineJoin = 'round';
      ctx.shadowBlur = 0;
      // 薄い塗り（うしろの手首ほど透ける）
      const gf = ctx.createLinearGradient(-1.35, 0, 0.9, 0);
      gf.addColorStop(0, rgba(DEEP, 0));
      gf.addColorStop(0.3, rgba(RED, 0.16 * fillA));
      gf.addColorStop(1, rgba(RED_HI, 0.34 * fillA));
      ctx.fillStyle = gf;
      ctx.beginPath();
      fistPath(ctx);
      ctx.fill();
      // 発光（太く淡い赤の縁どり）
      if (!simple) {
        ctx.strokeStyle = rgba(RED, 0.24 * lineA);
        ctx.lineWidth = px(6 * S);
        ctx.shadowColor = rgba(RED, 0.95);
        ctx.shadowBlur = 14 * S;
        ctx.beginPath();
        fistPath(ctx);
        ctx.stroke();
        ctx.shadowBlur = 0;
      }
      // 輪郭線（手首側は透け、拳頭に向かって明るくなる）
      const gs = ctx.createLinearGradient(-1.35, 0, 0.9, 0);
      gs.addColorStop(0, rgba(RED, 0));
      gs.addColorStop(0.35, rgba(RED, 0.55 * lineA));
      gs.addColorStop(1, rgba(PINK, 0.95 * lineA));
      ctx.strokeStyle = gs;
      ctx.lineWidth = px((simple ? 1.6 : 2.1) * S);
      ctx.beginPath();
      fistPath(ctx);
      ctx.stroke();
      if (!simple) {
        // 拳頭（各指の付け根の関節）のハイライト
        ctx.strokeStyle = rgba(PINK, 0.7 * lineA);
        ctx.lineWidth = px(1.6 * S);
        for (let i = 0; i < 4; i++) {
          ctx.beginPath();
          ctx.arc(FIST_LEN[i] - 0.13, -0.45 + 0.3 * i, 0.075, -1.2, 1.2);
          ctx.stroke();
        }
        // ゆらめくオーラの外縁（少し大きい輪郭が揺れながら重なる）
        for (let k = 1; k <= 2; k++) {
          const wob = 0.045 * k;
          ctx.save();
          ctx.translate(noise1(ms * 0.011 + k * 3, seed) * wob, noise1(ms * 0.014 + k * 5, seed + 2) * wob);
          ctx.scale(1 + 0.1 * k, 1 + 0.1 * k);
          ctx.strokeStyle = rgba(RED, (0.26 / k) * lineA);
          ctx.lineWidth = px(1.6 * S);
          ctx.beginPath();
          fistPath(ctx);
          ctx.stroke();
          ctx.restore();
        }
      }
      ctx.restore();
    }

    // 赤い光の塊を描く（放射グラデーション）
    function glow(ctx, x, y, r, a, inner, mid, outer) {
      if (a <= 0.01 || r <= 0.5) return;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, rgba(inner, a));
      g.addColorStop(0.35, rgba(mid, a * 0.85));
      g.addColorStop(0.75, rgba(outer, a * 0.4));
      g.addColorStop(1, rgba(outer, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    // 「念の輪」：途切れ途切れの円弧が回る細い輪（念を込めていることを表す）
    function drawSealRing(ctx, cx, cy, r, rot, a, col, segs, span) {
      if (a <= 0.01 || r <= 0.5) return;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(1, 0.8);
      ctx.strokeStyle = rgba(col, a);
      ctx.lineWidth = Math.max(1, 2 * S);
      ctx.lineCap = 'round';
      ctx.shadowColor = rgba(col, 0.9);
      ctx.shadowBlur = 6 * S;
      ctx.beginPath();
      for (let s = 0; s < segs; s++) {
        const a0 = rot + (s / segs) * Math.PI * 2;
        ctx.moveTo(Math.cos(a0) * r, Math.sin(a0) * r);
        ctx.arc(0, 0, r, a0, a0 + span);
      }
      ctx.stroke();   // 全部の円弧を1回でまとめて描く
      ctx.restore();
    }

    // ============ ①念を込める：手元に赤い念が渦を巻いて集まる ============
    // 手元にうっすら広がる赤いオーラ（念を込めるほど濃くなる）
    particles.push({
      maxLife: AURAFIST_LAUNCH_MS + 60,
      blend: 'lighter',
      draw(ctx, t) {
        const ms = t * (AURAFIST_LAUNCH_MS + 60);
        const f = clamp01(ms / AURAFIST_FORM_MS);
        const a = Math.sin(Math.PI * clamp01(t)) * 0.42;
        glow(ctx, hand.x, hand.y, lerp(16, 78, easeOutCubic(f)) * S, a, PINK, RED, DEEP);
      }
    });
    // 回る「念の輪」（外側と内側で逆向きに回る）
    particles.push({
      delay: 40,
      maxLife: AURAFIST_LAUNCH_MS - 100,
      blend: 'lighter',
      draw(ctx, t) {
        const ms = 40 + t * (AURAFIST_LAUNCH_MS - 100);
        const a = Math.sin(Math.PI * clamp01(t)) * 0.65;
        drawSealRing(ctx, hand.x, hand.y, FIST_R * lerp(2.5, 1.95, easeOutCubic(t)), ms * 0.006, a, RED_HI, 10, 0.42);
        drawSealRing(ctx, hand.x, hand.y, FIST_R * lerp(1.9, 1.5, easeOutCubic(t)), -ms * 0.009, a * 0.85, RED, 8, 0.5);
      }
    });
    // 外から手元へ、赤い念の筋が螺旋を描いて集まる（尾を引く）
    for (let i = 0; i < 20; i++) {
      const a0 = (i / 20) * Math.PI * 2 + rand(-0.25, 0.25);
      const r0 = rand(62, 116) * S;
      const w0 = rand(0.9, 1.5);
      particles.push({
        delay: rand(0, AURAFIST_FORM_MS * 0.7),
        maxLife: rand(260, 380),
        blend: 'lighter',
        draw(ctx, t) {
          if (t >= 1) return;
          const a = clamp01(t * 4) * (1 - Math.max(0, (t - 0.85) / 0.15));
          ctx.lineCap = 'round';
          ctx.shadowBlur = 0;   // 線分が多いのでぼかしは付けない（加算合成で光らせる）
          let prevX = 0, prevY = 0;
          for (let k = 0; k <= 6; k++) {
            const tk = Math.max(0, t - k * 0.035);
            const rad = lerp(r0, FIST_R * 0.5, easeInCubic(tk));
            const sp = a0 + tk * 3.2 * w0;
            const x = hand.x + Math.cos(sp) * rad;
            const y = hand.y + Math.sin(sp) * rad * 0.82;
            if (k > 0) {
              ctx.strokeStyle = rgba(k % 2 ? RED_HI : RED, a * (1 - k / 7) * 0.8);
              ctx.lineWidth = Math.max(0.8, (2.4 - k * 0.28) * S);
              ctx.beginPath();
              ctx.moveTo(prevX, prevY);
              ctx.lineTo(x, y);
              ctx.stroke();
            }
            prevX = x; prevY = y;
          }
        }
      });
    }
    // 拳が立ち上がる間、拳から立ちのぼる赤い火の粉
    for (let i = 0; i < 12; i++) {
      const sx = rand(-0.9, 0.7);
      const rise = rand(20, 46) * S;
      particles.push({
        delay: rand(AURAFIST_FORM_MS * 0.25, AURAFIST_LAUNCH_MS - 60),
        maxLife: rand(320, 480),
        blend: 'lighter',
        draw(ctx, t) {
          const b = fistState(Math.min(AURAFIST_LAUNCH_MS, AURAFIST_FORM_MS * 0.25 + i * 40));
          const x = b.x + ux * sx * FIST_R - ux * 10 * S * t;
          const y = b.y + uy * sx * FIST_R - rise * easeOutCubic(t);
          const a = Math.sin(Math.PI * clamp01(t)) * 0.85;
          ctx.fillStyle = rgba(i % 2 ? RED_HI : PINK, a);
          ctx.shadowColor = rgba(RED, 0.9);
          ctx.shadowBlur = 6 * S;
          ctx.beginPath();
          ctx.arc(x, y, 2.2 * S * (1 - t * 0.4), 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }

    // ============ ②放つ直前：握り込んだ瞬間に赤い光が強く瞬く ============
    particles.push({
      delay: AURAFIST_LAUNCH_MS - 80,
      maxLife: 220,
      blend: 'lighter',
      draw(ctx, t) {
        const a = Math.sin(Math.PI * clamp01(t)) * 0.7;
        const b = fistState(AURAFIST_LAUNCH_MS - 20);
        glow(ctx, b.x, b.y, lerp(FIST_R * 1.2, FIST_R * 2.6, easeOutCubic(t)), a, PINK, RED, DEEP);
      }
    });

    // ============ ①②③拳本体：浮かび上がる→握る→引く→飛ぶ→めり込む を1つのパーティクルで描く ============
    particles.push({
      delay: 40,
      maxLife: AURAFIST_HIT_MS + AURAFIST_LINGER_MS - 40,
      blend: 'lighter',
      draw(ctx, t) {
        const ms = 40 + t * (AURAFIST_HIT_MS + AURAFIST_LINGER_MS - 40);
        const st = fistState(ms);
        // 飛翔中：拳の後ろに赤い風の筋（速度線）と、拳の残像を引く
        if (st.flight > 0 && ms <= AURAFIST_HIT_MS) {
          const reach = 40 + 64 * st.flight;
          for (let j = -2; j <= 2; j++) {
            const ox = perpX * j * FIST_R * 0.3 * st.sc;
            const oy = perpY * j * FIST_R * 0.3 * st.sc;
            const sx = st.x + ox - ux * FIST_R * 0.5 * st.sc;
            const sy = st.y + oy - uy * FIST_R * 0.5 * st.sc;
            const len = reach * S * (1 - Math.abs(j) * 0.16);
            const gr = ctx.createLinearGradient(sx, sy, sx - ux * len, sy - uy * len);
            gr.addColorStop(0, rgba(RED_HI, 0.75));
            gr.addColorStop(1, rgba(RED, 0));
            ctx.strokeStyle = gr;
            ctx.lineWidth = Math.max(1, 1.8 * S * (1 - Math.abs(j) * 0.16));
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(sx, sy);
            ctx.lineTo(sx - ux * len, sy - uy * len);
            ctx.stroke();
          }
          for (let k = 5; k >= 1; k--) {
            const msk = ms - k * 26;
            if (msk < AURAFIST_LAUNCH_MS) continue;
            const g = fistState(msk);
            drawFist(ctx, g.x, g.y, g.sc, 0.34 * (1 - k / 6), 1, msk, true);
          }
        }
        drawFist(ctx, st.x, st.y, st.sc, st.alpha, st.build, ms, false);
      }
    });
    // 飛翔中に拳からこぼれる赤い火の粉
    for (let i = 0; i < 16; i++) {
      const at = AURAFIST_LAUNCH_MS + (i / 16) * AURAFIST_FLIGHT_MS * 0.92;
      const off = rand(-1, 1);
      const col = i % 2 === 0 ? PINK : RED_HI;
      particles.push({
        delay: at,
        maxLife: rand(220, 340),
        blend: 'lighter',
        draw(ctx, t) {
          const b = fistState(at);
          const x = b.x + perpX * off * FIST_R * 0.7 - ux * 20 * S * t;
          const y = b.y + perpY * off * FIST_R * 0.7 - uy * 20 * S * t + t * t * 8 * S;
          ctx.fillStyle = rgba(col, (1 - t) * 0.9);
          ctx.shadowColor = rgba(RED, 0.9);
          ctx.shadowBlur = 6 * S;
          ctx.beginPath();
          ctx.arc(x, y, 2.3 * S * (1 - t * 0.5), 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }

    // ============ ④命中：拳がめり込み、衝撃の星と赤い波紋が広がって砕け散る ============
    // 中心の白ピンクの閃光（ごく短く。白飛びさせない）
    particles.push({
      delay: AURAFIST_HIT_MS - 10,
      maxLife: 260,
      blend: 'lighter',
      draw(ctx, t) {
        glow(ctx, target.x, target.y, lerp(10 * S, 72 * S, easeOutQuint(t)), Math.pow(1 - t, 1.4) * 0.85, WHITE, PINK, RED);
      }
    });
    // 広がる赤い大きな光
    particles.push({
      delay: AURAFIST_HIT_MS,
      maxLife: 560,
      blend: 'lighter',
      draw(ctx, t) {
        const grow = easeOutCubic(clamp01(t / 0.3));
        const fade = t < 0.35 ? 1 : Math.pow(1 - (t - 0.35) / 0.65, 1.3);
        glow(ctx, target.x, target.y, 96 * S * grow, fade * 0.55, PINK, RED, DEEP);
      }
    });
    // 衝撃のギザギザ星（殴った瞬間の「ドンッ」を表す）
    const burstRot = rand(0, Math.PI * 2);
    particles.push({
      delay: AURAFIST_HIT_MS - 10,
      maxLife: 340,
      blend: 'lighter',
      draw(ctx, t) {
        const R0 = lerp(14 * S, 92 * S, easeOutCubic(t));
        const a = 1 - t;
        const spikes = 10;
        ctx.beginPath();
        for (let s = 0; s < spikes * 2; s++) {
          const aa = burstRot + (s / (spikes * 2)) * Math.PI * 2;
          const rad = s % 2 === 0 ? R0 : R0 * 0.42;
          const x = target.x + Math.cos(aa) * rad;
          const y = target.y + Math.sin(aa) * rad;
          if (s === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.fillStyle = rgba(RED, a * 0.28);
        ctx.fill();
        ctx.strokeStyle = rgba(PINK, a * 0.9);
        ctx.lineWidth = Math.max(1, 2.4 * S * (1 - t * 0.5));
        ctx.lineJoin = 'round';
        ctx.shadowColor = rgba(RED, 0.9);
        ctx.shadowBlur = 10 * S;
        ctx.stroke();
      }
    });
    // 広がる赤い波紋（細い輪が3重）
    for (let i = 0; i < 3; i++) {
      particles.push({
        delay: AURAFIST_HIT_MS + i * 60,
        maxLife: 440,
        blend: 'lighter',
        draw(ctx, t) {
          const r = lerp(12 * S, 96 * S, easeOutCubic(t));
          const a = (1 - t) * 0.9;
          ctx.strokeStyle = rgba(i === 0 ? PINK : (i === 1 ? RED_HI : RED), a);
          ctx.lineWidth = Math.max(1, (5 - i) * S * (1 - t * 0.6));
          ctx.shadowColor = rgba(RED, 0.9);
          ctx.shadowBlur = 10 * S;
          ctx.beginPath();
          ctx.arc(target.x, target.y, r, 0, Math.PI * 2);
          ctx.stroke();
        }
      });
    }
    // 足元へ広がる平たい衝撃波（重い一撃であることを示す。画面は揺らさない）
    particles.push({
      delay: AURAFIST_HIT_MS + 20,
      maxLife: 460,
      blend: 'lighter',
      draw(ctx, t) {
        const r = lerp(16 * S, 108 * S, easeOutCubic(t));
        const a = (1 - t) * 0.65;
        if (a <= 0.01) return;
        ctx.save();
        ctx.translate(target.x, target.y + 16 * S);
        ctx.scale(1, 0.34);
        ctx.strokeStyle = rgba(RED, a);
        ctx.lineWidth = Math.max(1.5, 7 * S * (1 - t * 0.6));
        ctx.shadowColor = rgba(RED, 0.9);
        ctx.shadowBlur = 10 * S;
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    });
    // 四方へ走る光条（放射状の線）
    const rayN = 12;
    for (let i = 0; i < rayN; i++) {
      const ra = (i / rayN) * Math.PI * 2 + rand(-0.12, 0.12);
      const rl = rand(58, 112) * S;
      particles.push({
        delay: AURAFIST_HIT_MS + rand(0, 30),
        maxLife: rand(240, 380),
        blend: 'lighter',
        draw(ctx, t) {
          const e = easeOutCubic(t);
          const inner = lerp(6 * S, rl * 0.5, e);
          const outer = lerp(16 * S, rl, e);
          ctx.strokeStyle = rgba(i % 2 === 0 ? PINK : RED_HI, (1 - t) * 0.9);
          ctx.lineWidth = Math.max(1, 3.4 * S * (1 - t));
          ctx.lineCap = 'round';
          ctx.shadowColor = rgba(RED, 0.9);
          ctx.shadowBlur = 8 * S;
          ctx.beginPath();
          ctx.moveTo(target.x + Math.cos(ra) * inner, target.y + Math.sin(ra) * inner);
          ctx.lineTo(target.x + Math.cos(ra) * outer, target.y + Math.sin(ra) * outer);
          ctx.stroke();
        }
      });
    }
    // 砕け散る拳のかけら（薄い赤の破片が回りながら飛ぶ）
    for (let i = 0; i < 12; i++) {
      const sa = rand(0, Math.PI * 2);
      const spd = rand(40, 112) * S;
      const spin = rand(-6, 6);
      const rot0 = rand(0, Math.PI);
      const sz = rand(4, 9) * S;
      particles.push({
        delay: AURAFIST_HIT_MS + rand(0, 40),
        maxLife: rand(300, 480),
        blend: 'lighter',
        draw(ctx, t) {
          const e = easeOutCubic(t);
          const x = target.x + Math.cos(sa) * spd * e;
          const y = target.y + Math.sin(sa) * spd * e * 0.85 + t * t * 14 * S;
          const a = (1 - t) * 0.85;
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(rot0 + spin * t);
          ctx.fillStyle = rgba(RED, a * 0.35);
          ctx.strokeStyle = rgba(RED_HI, a);
          ctx.lineWidth = Math.max(1, 1.4 * S);
          ctx.beginPath();
          ctx.moveTo(-sz, -sz * 0.6);
          ctx.lineTo(sz, -sz * 0.3);
          ctx.lineTo(sz * 0.5, sz * 0.7);
          ctx.lineTo(-sz * 0.7, sz * 0.4);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          ctx.restore();
        }
      });
    }
    // 飛び散る赤い火の粉（重力で少し落ちる）
    for (let i = 0; i < 28; i++) {
      const col = i % 3 === 0 ? PINK : (i % 3 === 1 ? RED_HI : RED);
      const sa = rand(0, Math.PI * 2);
      const spd = rand(34, 112) * S;
      const dotR = rand(1.4, 3.2) * S;
      particles.push({
        delay: AURAFIST_HIT_MS + rand(0, 70),
        maxLife: rand(280, 500),
        blend: 'lighter',
        draw(ctx, t) {
          const e = easeOutCubic(t);
          const x = target.x + Math.cos(sa) * spd * e;
          const y = target.y + Math.sin(sa) * spd * e + t * t * 20 * S;
          ctx.fillStyle = rgba(col, (1 - t) * 0.92);
          ctx.shadowColor = rgba(RED, 0.9);
          ctx.shadowBlur = 6;
          ctx.beginPath();
          ctx.arc(x, y, dotR * (1 - t * 0.4), 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }

    // ============ ⑤余韻：赤いオーラの靄が立ちのぼって薄れる ============
    for (let i = 0; i < 8; i++) {
      const sa = rand(0, Math.PI * 2);
      const dd = rand(14, 54) * S;
      const rise = rand(16, 42) * S;
      particles.push({
        delay: AURAFIST_HIT_MS + 140 + rand(0, 130),
        maxLife: rand(340, 520),
        blend: 'lighter',
        draw(ctx, t) {
          const e = easeOutCubic(t);
          const x = target.x + Math.cos(sa + t * 1.3) * dd * e;
          const y = target.y + Math.sin(sa + t * 1.3) * dd * e * 0.7 - rise * e;
          glow(ctx, x, y, lerp(10, 22, t) * S, (1 - t) * 0.3, PINK, RED, DEEP);
        }
      });
    }
  }

  // ============================================================
  // スリートスピア（attack227・オリジナル／威力120・命中100）専用演出
  // オーラファイト(117)と同じ「①練り込む→②構える→③投げつける→④着弾で爆発→⑤余韻」の
  // 5段構成を踏襲しつつ、拳の代わりに透き通った「氷の長槍」を手元に結晶化させ、
  // 相手へ投げつけて命中の瞬間に大きく砕け散る（ブリザードランスのイメージ）。
  // 氷の質感は単色べた塗りにせず、内部の芯・中間層・縁の3層グラデーション＋
  // 六角結晶を思わせる多角形の刃面＋鋭い白ハイライト筋＋内部の気泡状の粒で
  // 「冷たく硬い透明な結晶」を意識している。
  //   ①練成：手元に冷気が渦を巻いて集まり、透明な氷の槍が結晶化していく
  //   ②構え：槍を握り直し、切っ先が細かく凍りつく音もなく静かに震える
  //   ③投擲：槍が白い冷気の尾を引きながら一直線に相手へ突き刺さる
  //   ④着弾：氷の槍が砕け、鋭い結晶片と冷気の衝撃波が四方に爆ぜる
  //   ⑤余韻：砕けた場所に薄い霜と冷気の靄がしばらく残る
  // ============================================================
  const SLEETSPEAR_FORM_MS = 520;      // ①槍が結晶化する
  const SLEETSPEAR_HOLD_MS = 200;      // ②構えて静かに震える
  const SLEETSPEAR_FLIGHT_MS = 240;    // ③手元→相手へ届くまで（速い投擲）
  const SLEETSPEAR_LINGER_MS = 200;    // 着弾後、槍がめり込んで砕けるまで
  const SLEETSPEAR_LAUNCH_MS = SLEETSPEAR_FORM_MS + SLEETSPEAR_HOLD_MS;   // 槍を投げる時刻
  const SLEETSPEAR_HIT_MS = SLEETSPEAR_LAUNCH_MS + SLEETSPEAR_FLIGHT_MS; // 命中（ダメージ）の瞬間
  const SLEETSPEAR_END_MS = SLEETSPEAR_HIT_MS + 780;

  function spawnSleetSpearSpecial(particles, w, h, info) {
    const from = (info && info.from) || { x: w * 0.28, y: h * 0.68 };
    const to = (info && info.to) || { x: w * 0.72, y: h * 0.32 };
    const S = (info && info.scale) || 1;
    const seed = rand(0, 100);

    const dx = to.x - from.x, dy = to.y - from.y;
    const dist = Math.hypot(dx, dy) || 1;
    const ux = dx / dist, uy = dy / dist;
    const ang = Math.atan2(dy, dx);
    const perpX = -uy, perpY = ux;
    // 槍を結晶化させる位置：攻撃側の中心から相手方向へ少し前に出した位置
    const hand = { x: from.x + ux * 44 * S, y: from.y + uy * 44 * S - 8 * S };
    const target = { x: to.x, y: to.y };

    const SPEAR_LEN = 74 * S;      // 槍の全長（単位座標1 = この長さ）
    const HIT_SCALE = 1.12;
    const WIND_UP = 14 * S;        // 投げる直前にうしろへ引く距離
    const startPos = { x: hand.x - ux * WIND_UP, y: hand.y - uy * WIND_UP };
    const endPos = { x: target.x - ux * SPEAR_LEN * HIT_SCALE * 0.34, y: target.y - uy * SPEAR_LEN * HIT_SCALE * 0.34 };

    // 氷の配色：芯は白に近い水色、中間は澄んだ水色、縁と靄は深い青
    const DEEP = '#0d3d5c';      // 深い青（縁の暗部・靄）
    const BLUE = '#2f8fd4';      // 澄んだ水色（主色）
    const BLUE_HI = '#8fd8ff';   // 明るい水色（面のハイライト）
    const ICE_CORE = '#eafcff'; // ほぼ白い氷の芯
    const WHITE = '#ffffff';

    // ---- 槍の形（単位座標。+x が穂先の向き、原点は槍のだいたいの重心）----
    // 六角結晶を思わせる多角形の穂先＋角柱状の柄。左右非対称にせず、まっすぐ鋭く。
    function spearPath(ctx) {
      // 穂先（鋭い五角形）
      ctx.moveTo(0.62, 0);
      ctx.lineTo(0.30, -0.16);
      ctx.lineTo(0.08, -0.10);
      ctx.lineTo(0.08, 0.10);
      ctx.lineTo(0.30, 0.16);
      ctx.closePath();
      // 柄（角柱：わずかに先細りの六角形シルエット）
      ctx.moveTo(0.10, -0.085);
      ctx.lineTo(-0.55, -0.06);
      ctx.lineTo(-0.62, 0);
      ctx.lineTo(-0.55, 0.06);
      ctx.lineTo(0.10, 0.085);
      ctx.closePath();
    }
    // 結晶の「面」の切り替わりを示す内部の稜線（ハイライトの筋に使う）
    function spearFacetLines(ctx) {
      ctx.moveTo(0.62, 0); ctx.lineTo(0.08, -0.10);
      ctx.moveTo(0.62, 0); ctx.lineTo(0.08, 0.10);
      ctx.moveTo(0.30, -0.16); ctx.lineTo(-0.55, -0.06);
      ctx.moveTo(0.30, 0.16); ctx.lineTo(-0.55, 0.06);
    }

    // ---- 槍の状態を時刻(ms)から算出：結晶化→構え→引く→飛ぶ→めり込む ----
    function spearState(ms) {
      let x, y, sc, alpha = 1, build = 1, flight = 0;
      if (ms < SLEETSPEAR_FORM_MS) {
        build = clamp01(ms / SLEETSPEAR_FORM_MS);
        sc = 0.35 + 0.65 * easeOutCubic(build);
        x = hand.x;
        y = hand.y + Math.sin(ms * 0.01) * 1.4 * S;
        alpha = clamp01(ms / 120);
      } else if (ms < SLEETSPEAR_LAUNCH_MS) {
        const f = (ms - SLEETSPEAR_FORM_MS) / SLEETSPEAR_HOLD_MS;
        const pull = easeInOutSine(clamp01((f - 0.25) / 0.75));
        const tremble = f * 0.9 * S;   // 冷気を帯びて細かく震える（音もなく張り詰めた緊張感）
        x = lerp(hand.x, startPos.x, pull) + noise1(ms * 0.1, seed) * tremble;
        y = lerp(hand.y, startPos.y, pull) + noise1(ms * 0.12, seed + 4) * tremble;
        sc = 1;
      } else if (ms < SLEETSPEAR_HIT_MS) {
        flight = clamp01((ms - SLEETSPEAR_LAUNCH_MS) / SLEETSPEAR_FLIGHT_MS);
        const e = easeInCubic(flight) * 0.5 + flight * 0.5;   // 鋭く加速して突き刺さる
        x = lerp(startPos.x, endPos.x, e);
        y = lerp(startPos.y, endPos.y, e);
        sc = lerp(1, HIT_SCALE, easeInCubic(flight));
      } else {
        const p = clamp01((ms - SLEETSPEAR_HIT_MS) / SLEETSPEAR_LINGER_MS);
        const push = easeOutCubic(clamp01(p * 2.4));
        x = endPos.x + ux * 5 * S * push;
        y = endPos.y + uy * 5 * S * push;
        sc = HIT_SCALE + 0.05 * p;
        alpha = 1 - Math.pow(p, 1.6);
        flight = 1;
      }
      return { x, y, sc, alpha, build, flight };
    }

    // ---- 槍を1本描く。simple=true は残像用の軽量描画 ----
    function drawSpear(ctx, x, y, sc, alpha, build, ms, simple) {
      if (alpha <= 0.01 || sc <= 0.05) return;
      const R = SPEAR_LEN * sc;
      const fillA = alpha * build * build;
      const lineA = alpha * build;
      const px = (n) => n / R;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(ang);
      ctx.scale(R, R);
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineJoin = 'round';
      ctx.shadowBlur = 0;
      // ---- 塗り：柄から穂先へ、深い青→澄んだ水色→ほぼ白の芯、という3層の透明感グラデーション ----
      const gf = ctx.createLinearGradient(-0.62, 0, 0.62, 0);
      gf.addColorStop(0, rgba(DEEP, 0.10 * fillA));
      gf.addColorStop(0.45, rgba(BLUE, 0.30 * fillA));
      gf.addColorStop(0.8, rgba(BLUE_HI, 0.5 * fillA));
      gf.addColorStop(1, rgba(ICE_CORE, 0.75 * fillA));
      ctx.fillStyle = gf;
      ctx.beginPath();
      spearPath(ctx);
      ctx.fill();
      if (!simple) {
        // 発光（淡い水色の縁の光暈：結晶が冷気を纏っている質感）
        ctx.strokeStyle = rgba(BLUE_HI, 0.26 * lineA);
        ctx.lineWidth = px(6 * S);
        ctx.shadowColor = rgba(BLUE_HI, 0.95);
        ctx.shadowBlur = 13 * S;
        ctx.beginPath();
        spearPath(ctx);
        ctx.stroke();
        ctx.shadowBlur = 0;
      }
      // 輪郭線（柄側はやや暗く、穂先に向かって白く鋭く明るくなる＝氷の硬質感）
      const gs = ctx.createLinearGradient(-0.62, 0, 0.62, 0);
      gs.addColorStop(0, rgba(DEEP, 0.5 * lineA));
      gs.addColorStop(0.5, rgba(BLUE, 0.7 * lineA));
      gs.addColorStop(1, rgba(WHITE, 0.98 * lineA));
      ctx.strokeStyle = gs;
      ctx.lineWidth = px((simple ? 1.5 : 1.9) * S);
      ctx.beginPath();
      spearPath(ctx);
      ctx.stroke();
      if (!simple) {
        // 結晶の面の切り替わりを示す内部の稜線（細く鋭い白いハイライト筋＝ガラス質の反射）
        ctx.strokeStyle = rgba(WHITE, 0.55 * lineA);
        ctx.lineWidth = px(0.9 * S);
        ctx.beginPath();
        spearFacetLines(ctx);
        ctx.stroke();
        // 内部に閉じ込められた小さな気泡状の粒（氷の内部構造らしいディテール）
        ctx.fillStyle = rgba(BLUE_HI, 0.4 * lineA);
        const bubbles = [[-0.38, -0.02, 0.018], [-0.2, 0.025, 0.014], [-0.04, -0.03, 0.012], [0.16, 0.01, 0.01]];
        for (const [bx, by, br] of bubbles) {
          ctx.beginPath();
          ctx.arc(bx, by, br, 0, Math.PI * 2);
          ctx.fill();
        }
        // 穂先の鋭いハイライト（一番明るい一点）
        ctx.strokeStyle = rgba(WHITE, 0.9 * lineA);
        ctx.lineWidth = px(1.3 * S);
        ctx.beginPath();
        ctx.moveTo(0.55, -0.02);
        ctx.lineTo(0.62, 0);
        ctx.lineTo(0.55, 0.02);
        ctx.stroke();
        // わずかに揺れる冷気のオーラ外縁（薄く2重）
        for (let k = 1; k <= 2; k++) {
          const wob = 0.035 * k;
          ctx.save();
          ctx.translate(noise1(ms * 0.01 + k * 3, seed) * wob, noise1(ms * 0.013 + k * 5, seed + 2) * wob);
          ctx.scale(1 + 0.06 * k, 1 + 0.06 * k);
          ctx.strokeStyle = rgba(BLUE_HI, (0.16 / k) * lineA);
          ctx.lineWidth = px(1.2 * S);
          ctx.beginPath();
          spearPath(ctx);
          ctx.stroke();
          ctx.restore();
        }
      }
      ctx.restore();
    }

    // 水色の光の塊（放射グラデーション）
    function glow(ctx, x, y, r, a, inner, mid, outer) {
      if (a <= 0.01 || r <= 0.5) return;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, rgba(inner, a));
      g.addColorStop(0.35, rgba(mid, a * 0.85));
      g.addColorStop(0.75, rgba(outer, a * 0.4));
      g.addColorStop(1, rgba(outer, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    // 六角の結晶リング（冷気を練り込んでいることを示す、途切れた六角形の光の輪が回る）
    function drawHexRing(ctx, cx, cy, r, rot, a, col) {
      if (a <= 0.01 || r <= 0.5) return;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(rot);
      ctx.scale(1, 0.82);
      ctx.strokeStyle = rgba(col, a);
      ctx.lineWidth = Math.max(1, 1.8 * S);
      ctx.lineCap = 'round';
      ctx.shadowColor = rgba(col, 0.9);
      ctx.shadowBlur = 6 * S;
      ctx.beginPath();
      for (let s = 0; s < 6; s++) {
        const a0 = (s / 6) * Math.PI * 2;
        const a1 = a0 + (Math.PI * 2 / 6) * 0.7;
        ctx.moveTo(Math.cos(a0) * r, Math.sin(a0) * r);
        ctx.lineTo(Math.cos(a1) * r, Math.sin(a1) * r);
      }
      ctx.stroke();
      ctx.restore();
    }

    // ============ ①練成：手元に冷気が集まり、透明な氷の槍が結晶化していく ============
    particles.push({
      maxLife: SLEETSPEAR_LAUNCH_MS + 60,
      blend: 'lighter',
      draw(ctx, t) {
        const ms = t * (SLEETSPEAR_LAUNCH_MS + 60);
        const f = clamp01(ms / SLEETSPEAR_FORM_MS);
        const a = Math.sin(Math.PI * clamp01(t)) * 0.4;
        glow(ctx, hand.x, hand.y, lerp(14, 70, easeOutCubic(f)) * S, a, ICE_CORE, BLUE, DEEP);
      }
    });
    // 回る六角の結晶リング（外側・内側で逆回転）
    particles.push({
      delay: 30,
      maxLife: SLEETSPEAR_LAUNCH_MS - 90,
      blend: 'lighter',
      draw(ctx, t) {
        const ms = 30 + t * (SLEETSPEAR_LAUNCH_MS - 90);
        const a = Math.sin(Math.PI * clamp01(t)) * 0.6;
        drawHexRing(ctx, hand.x, hand.y, SPEAR_LEN * lerp(0.9, 0.68, easeOutCubic(t)), ms * 0.0045, a, BLUE_HI);
        drawHexRing(ctx, hand.x, hand.y, SPEAR_LEN * lerp(0.65, 0.5, easeOutCubic(t)), -ms * 0.007, a * 0.8, ICE_CORE);
      }
    });
    // 外から手元へ冷気の筋が渦を巻いて集まる（尾を引く氷片の軌跡）
    for (let i = 0; i < 16; i++) {
      const a0 = (i / 16) * Math.PI * 2 + rand(-0.25, 0.25);
      const r0 = rand(50, 96) * S;
      const w0 = rand(0.9, 1.5);
      particles.push({
        delay: rand(0, SLEETSPEAR_FORM_MS * 0.7),
        maxLife: rand(240, 360),
        blend: 'lighter',
        draw(ctx, t) {
          if (t >= 1) return;
          const a = clamp01(t * 4) * (1 - Math.max(0, (t - 0.85) / 0.15));
          ctx.lineCap = 'round';
          ctx.shadowBlur = 0;
          let prevX = 0, prevY = 0;
          for (let k = 0; k <= 5; k++) {
            const tk = Math.max(0, t - k * 0.04);
            const rad = lerp(r0, SPEAR_LEN * 0.4, easeInCubic(tk));
            const sp = a0 + tk * 2.8 * w0;
            const x = hand.x + Math.cos(sp) * rad;
            const y = hand.y + Math.sin(sp) * rad * 0.82;
            if (k > 0) {
              ctx.strokeStyle = rgba(k % 2 ? BLUE_HI : BLUE, a * (1 - k / 6) * 0.8);
              ctx.lineWidth = Math.max(0.8, (2.2 - k * 0.28) * S);
              ctx.beginPath();
              ctx.moveTo(prevX, prevY);
              ctx.lineTo(x, y);
              ctx.stroke();
            }
            prevX = x; prevY = y;
          }
        }
      });
    }
    // 結晶化していく槍から立ちのぼる細かい霜の粒（キラキラと舞い上がる）
    for (let i = 0; i < 12; i++) {
      const sx = rand(-0.5, 0.5);
      const rise = rand(16, 38) * S;
      particles.push({
        delay: rand(SLEETSPEAR_FORM_MS * 0.3, SLEETSPEAR_LAUNCH_MS - 50),
        maxLife: rand(300, 460),
        blend: 'lighter',
        draw(ctx, t) {
          const b = spearState(Math.min(SLEETSPEAR_LAUNCH_MS, SLEETSPEAR_FORM_MS * 0.3 + i * 36));
          const x = b.x + ux * sx * SPEAR_LEN - ux * 6 * S * t;
          const y = b.y + uy * sx * SPEAR_LEN - rise * easeOutCubic(t);
          const a = Math.sin(Math.PI * clamp01(t)) * 0.85;
          ctx.fillStyle = rgba(i % 2 ? BLUE_HI : ICE_CORE, a);
          ctx.shadowColor = rgba(BLUE, 0.9);
          ctx.shadowBlur = 5 * S;
          ctx.beginPath();
          ctx.arc(x, y, 1.6 * S * (1 - t * 0.4), 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }

    // ============ ②投げる直前：構え直した瞬間、冷気が強く瞬く ============
    particles.push({
      delay: SLEETSPEAR_LAUNCH_MS - 70,
      maxLife: 200,
      blend: 'lighter',
      draw(ctx, t) {
        const a = Math.sin(Math.PI * clamp01(t)) * 0.6;
        const b = spearState(SLEETSPEAR_LAUNCH_MS - 20);
        glow(ctx, b.x, b.y, lerp(SPEAR_LEN * 0.55, SPEAR_LEN * 1.15, easeOutCubic(t)), a, ICE_CORE, BLUE, DEEP);
      }
    });

    // ============ ①②③槍本体：結晶化→構える→引く→飛ぶ→めり込む を1つのパーティクルで描く ============
    particles.push({
      delay: 40,
      maxLife: SLEETSPEAR_HIT_MS + SLEETSPEAR_LINGER_MS - 40,
      blend: 'lighter',
      draw(ctx, t) {
        const ms = 40 + t * (SLEETSPEAR_HIT_MS + SLEETSPEAR_LINGER_MS - 40);
        const st = spearState(ms);
        // 飛翔中：槍の後ろに白い冷気の尾（速度線）と、槍の残像
        if (st.flight > 0 && ms <= SLEETSPEAR_HIT_MS) {
          const reach = 46 + 70 * st.flight;
          for (let j = -2; j <= 2; j++) {
            const ox = perpX * j * SPEAR_LEN * 0.06 * st.sc;
            const oy = perpY * j * SPEAR_LEN * 0.06 * st.sc;
            const sx = st.x + ox - ux * SPEAR_LEN * 0.3 * st.sc;
            const sy = st.y + oy - uy * SPEAR_LEN * 0.3 * st.sc;
            const len = reach * S * (1 - Math.abs(j) * 0.16);
            const gr = ctx.createLinearGradient(sx, sy, sx - ux * len, sy - uy * len);
            gr.addColorStop(0, rgba(BLUE_HI, 0.7));
            gr.addColorStop(1, rgba(BLUE, 0));
            ctx.strokeStyle = gr;
            ctx.lineWidth = Math.max(1, 1.7 * S * (1 - Math.abs(j) * 0.16));
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(sx, sy);
            ctx.lineTo(sx - ux * len, sy - uy * len);
            ctx.stroke();
          }
          for (let k = 4; k >= 1; k--) {
            const msk = ms - k * 24;
            if (msk < SLEETSPEAR_LAUNCH_MS) continue;
            const g = spearState(msk);
            drawSpear(ctx, g.x, g.y, g.sc, 0.3 * (1 - k / 5), 1, msk, true);
          }
        }
        drawSpear(ctx, st.x, st.y, st.sc, st.alpha, st.build, ms, false);
      }
    });
    // 飛翔中に槍からこぼれる細かい氷片
    for (let i = 0; i < 14; i++) {
      const at = SLEETSPEAR_LAUNCH_MS + (i / 14) * SLEETSPEAR_FLIGHT_MS * 0.92;
      const off = rand(-1, 1);
      const col = i % 2 === 0 ? ICE_CORE : BLUE_HI;
      particles.push({
        delay: at,
        maxLife: rand(200, 320),
        blend: 'lighter',
        draw(ctx, t) {
          const b = spearState(at);
          const x = b.x + perpX * off * SPEAR_LEN * 0.1 - ux * 18 * S * t;
          const y = b.y + perpY * off * SPEAR_LEN * 0.1 - uy * 18 * S * t + t * t * 7 * S;
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(rand(0, Math.PI));
          ctx.fillStyle = rgba(col, (1 - t) * 0.9);
          ctx.shadowColor = rgba(BLUE, 0.9);
          ctx.shadowBlur = 5 * S;
          ctx.beginPath();
          ctx.moveTo(0, -2 * S); ctx.lineTo(1.3 * S, 0); ctx.lineTo(0, 2 * S); ctx.lineTo(-1.3 * S, 0);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        }
      });
    }

    // ============ ④着弾：氷の槍が突き刺さり、鋭い結晶片と冷気の衝撃波が爆ぜる ============
    // 中心の白い閃光（氷が砕ける瞬間の鋭い煌めき）
    particles.push({
      delay: SLEETSPEAR_HIT_MS - 10,
      maxLife: 260,
      blend: 'lighter',
      draw(ctx, t) {
        glow(ctx, target.x, target.y, lerp(9 * S, 70 * S, easeOutQuint(t)), Math.pow(1 - t, 1.4) * 0.9, WHITE, ICE_CORE, BLUE);
      }
    });
    // 広がる水色の大きな光
    particles.push({
      delay: SLEETSPEAR_HIT_MS,
      maxLife: 560,
      blend: 'lighter',
      draw(ctx, t) {
        const grow = easeOutCubic(clamp01(t / 0.3));
        const fade = t < 0.35 ? 1 : Math.pow(1 - (t - 0.35) / 0.65, 1.3);
        glow(ctx, target.x, target.y, 94 * S * grow, fade * 0.5, BLUE_HI, BLUE, DEEP);
      }
    });
    // 砕けた結晶の六角の破断面（殴打技の星芒の代わりに、氷らしい六角の破片フレーム）
    const burstRot = rand(0, Math.PI * 2);
    particles.push({
      delay: SLEETSPEAR_HIT_MS - 10,
      maxLife: 320,
      blend: 'lighter',
      draw(ctx, t) {
        const R0 = lerp(12 * S, 86 * S, easeOutCubic(t));
        const a = 1 - t;
        ctx.beginPath();
        for (let s = 0; s < 6; s++) {
          const aa = burstRot + (s / 6) * Math.PI * 2;
          const x = target.x + Math.cos(aa) * R0;
          const y = target.y + Math.sin(aa) * R0;
          if (s === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.fillStyle = rgba(BLUE, a * 0.22);
        ctx.fill();
        ctx.strokeStyle = rgba(ICE_CORE, a * 0.9);
        ctx.lineWidth = Math.max(1, 2.2 * S * (1 - t * 0.5));
        ctx.lineJoin = 'round';
        ctx.shadowColor = rgba(BLUE_HI, 0.9);
        ctx.shadowBlur = 9 * S;
        ctx.stroke();
      }
    });
    // 広がる水色の波紋（細い輪が3重）
    for (let i = 0; i < 3; i++) {
      particles.push({
        delay: SLEETSPEAR_HIT_MS + i * 55,
        maxLife: 420,
        blend: 'lighter',
        draw(ctx, t) {
          const r = lerp(11 * S, 92 * S, easeOutCubic(t));
          const a = (1 - t) * 0.85;
          ctx.strokeStyle = rgba(i === 0 ? ICE_CORE : (i === 1 ? BLUE_HI : BLUE), a);
          ctx.lineWidth = Math.max(1, (4.6 - i) * S * (1 - t * 0.6));
          ctx.shadowColor = rgba(BLUE, 0.9);
          ctx.shadowBlur = 10 * S;
          ctx.beginPath();
          ctx.arc(target.x, target.y, r, 0, Math.PI * 2);
          ctx.stroke();
        }
      });
    }
    // 足元へ広がる平たい冷気の衝撃波
    particles.push({
      delay: SLEETSPEAR_HIT_MS + 15,
      maxLife: 440,
      blend: 'lighter',
      draw(ctx, t) {
        const r = lerp(15 * S, 104 * S, easeOutCubic(t));
        const a = (1 - t) * 0.6;
        if (a <= 0.01) return;
        ctx.save();
        ctx.translate(target.x, target.y + 15 * S);
        ctx.scale(1, 0.32);
        ctx.strokeStyle = rgba(BLUE, a);
        ctx.lineWidth = Math.max(1.5, 6.5 * S * (1 - t * 0.6));
        ctx.shadowColor = rgba(BLUE, 0.9);
        ctx.shadowBlur = 9 * S;
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    });
    // 四方へ走る冷気の光条
    const rayN = 11;
    for (let i = 0; i < rayN; i++) {
      const ra = (i / rayN) * Math.PI * 2 + rand(-0.12, 0.12);
      const rl = rand(54, 106) * S;
      particles.push({
        delay: SLEETSPEAR_HIT_MS + rand(0, 30),
        maxLife: rand(220, 360),
        blend: 'lighter',
        draw(ctx, t) {
          const e = easeOutCubic(t);
          const inner = lerp(6 * S, rl * 0.5, e);
          const outer = lerp(15 * S, rl, e);
          ctx.strokeStyle = rgba(i % 2 === 0 ? ICE_CORE : BLUE_HI, (1 - t) * 0.9);
          ctx.lineWidth = Math.max(1, 3.2 * S * (1 - t));
          ctx.lineCap = 'round';
          ctx.shadowColor = rgba(BLUE, 0.9);
          ctx.shadowBlur = 7 * S;
          ctx.beginPath();
          ctx.moveTo(target.x + Math.cos(ra) * inner, target.y + Math.sin(ra) * inner);
          ctx.lineTo(target.x + Math.cos(ra) * outer, target.y + Math.sin(ra) * outer);
          ctx.stroke();
        }
      });
    }
    // 砕け散る氷の結晶片（鋭い菱形の破片が回転しながら勢いよく飛ぶ。氷らしい硬質な輝き）
    for (let i = 0; i < 14; i++) {
      const sa = rand(0, Math.PI * 2);
      const spd = rand(42, 118) * S;
      const spin = rand(-7, 7);
      const rot0 = rand(0, Math.PI);
      const sz = rand(3.5, 8) * S;
      particles.push({
        delay: SLEETSPEAR_HIT_MS + rand(0, 40),
        maxLife: rand(300, 500),
        blend: 'lighter',
        draw(ctx, t) {
          const e = easeOutCubic(t);
          const x = target.x + Math.cos(sa) * spd * e;
          const y = target.y + Math.sin(sa) * spd * e * 0.85 + t * t * 16 * S;
          const a = (1 - t) * 0.9;
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(rot0 + spin * t);
          // 菱形（氷の結晶片）：中心を白く、縁を水色にして硬質なガラス感を出す
          const gp = ctx.createLinearGradient(-sz, 0, sz, 0);
          gp.addColorStop(0, rgba(BLUE, a * 0.3));
          gp.addColorStop(0.5, rgba(ICE_CORE, a * 0.75));
          gp.addColorStop(1, rgba(BLUE_HI, a * 0.4));
          ctx.fillStyle = gp;
          ctx.strokeStyle = rgba(WHITE, a * 0.95);
          ctx.lineWidth = Math.max(1, 1.2 * S);
          ctx.beginPath();
          ctx.moveTo(0, -sz);
          ctx.lineTo(sz * 0.55, 0);
          ctx.lineTo(0, sz);
          ctx.lineTo(-sz * 0.55, 0);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          ctx.restore();
        }
      });
    }
    // 飛び散る細かい氷の粒（重力で少し落ちる、きらきらと輝く）
    for (let i = 0; i < 26; i++) {
      const col = i % 3 === 0 ? ICE_CORE : (i % 3 === 1 ? BLUE_HI : BLUE);
      const sa = rand(0, Math.PI * 2);
      const spd = rand(32, 108) * S;
      const dotR = rand(1.3, 3) * S;
      particles.push({
        delay: SLEETSPEAR_HIT_MS + rand(0, 70),
        maxLife: rand(260, 480),
        blend: 'lighter',
        draw(ctx, t) {
          const e = easeOutCubic(t);
          const x = target.x + Math.cos(sa) * spd * e;
          const y = target.y + Math.sin(sa) * spd * e + t * t * 22 * S;
          ctx.fillStyle = rgba(col, (1 - t) * 0.9);
          ctx.shadowColor = rgba(BLUE, 0.9);
          ctx.shadowBlur = 6;
          ctx.beginPath();
          ctx.arc(x, y, dotR * (1 - t * 0.4), 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }

    // ============ ⑤余韻：砕けた場所に薄い霜と冷気の靄がしばらく漂う ============
    for (let i = 0; i < 8; i++) {
      const sa = rand(0, Math.PI * 2);
      const dd = rand(12, 50) * S;
      const rise = rand(14, 38) * S;
      particles.push({
        delay: SLEETSPEAR_HIT_MS + 150 + rand(0, 140),
        maxLife: rand(320, 500),
        blend: 'lighter',
        draw(ctx, t) {
          const e = easeOutCubic(t);
          const x = target.x + Math.cos(sa + t * 1.1) * dd * e;
          const y = target.y + Math.sin(sa + t * 1.1) * dd * e * 0.7 - rise * e;
          glow(ctx, x, y, lerp(9, 20, t) * S, (1 - t) * 0.28, ICE_CORE, BLUE_HI, DEEP);
        }
      });
    }
    // 地面近くに薄く広がる白い霜（すぐには消えず、じわじわ薄れる）
    particles.push({
      delay: SLEETSPEAR_HIT_MS + 40,
      maxLife: 620,
      blend: 'source-over',
      draw(ctx, t) {
        const alpha = (1 - t) * 0.18;
        const r = lerp(20, 70, easeOutCubic(t)) * S;
        const g = ctx.createRadialGradient(target.x, target.y + 10 * S, 0, target.x, target.y + 10 * S, r);
        g.addColorStop(0, rgba('#eafcff', alpha));
        g.addColorStop(1, 'rgba(234,252,255,0)');
        ctx.fillStyle = g;
        ctx.save();
        ctx.translate(target.x, target.y + 10 * S);
        ctx.scale(1, 0.4);
        ctx.translate(-target.x, -(target.y + 10 * S));
        ctx.beginPath();
        ctx.arc(target.x, target.y + 10 * S, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    });
  }

  // ============================================================
  // ガイアキューブ（attack218・オリジナル／じめん・特殊・威力200・1回休みの反動技）専用演出
  // パワージェム(312)の「複数の物体を生成して相手へ飛ばす」構成と、じしん(203)の
  // 「大地が裂けて岩柱が突き上がる」構成を組み合わせた、本作最大級の大技演出。
  //   ①練成：攻撃側の周囲に、古代文字が刻まれた色とりどりの石のキューブが
  //     いくつも生成され、重々しく浮遊する
  //   ②投擲：キューブが順番に相手へ撃ち出され、それぞれ違う色の光の尾を引いて飛ぶ
  //   ③着弾：キューブが次々と相手に突き刺さり、突き刺さった場所から
  //     ひびの光が走る
  //   ④解放：全弾突き刺さった直後、キューブの隙間から大地の力（金褐色と深緑の光）が
  //     一気に噴き出し、足元が裂けて岩柱が突き上がり、巨大な爆発が起こる
  //   ⑤余韻：土煙とキューブの残光が画面を覆ってゆっくり晴れる
  // 威力200・反動技という原作の重さに見合うよう、パワージェム/じしんよりも
  // 一回り大きく・長く・多層に演出を重ねている。
  // ============================================================
  const GAIACUBE_COUNT = 7;              // 飛ばすキューブの数
  const GAIACUBE_CHARGE_MS = 520;        // ①チャージ（キューブが生成される）
  const GAIACUBE_STAGGER_MS = 80;        // ②キューブごとの発射間隔
  const GAIACUBE_FLIGHT_MS = 380;        // 1個あたりの飛翔時間
  // 全弾着弾の時刻
  const GAIACUBE_FINAL_IMPACT_MS =
    GAIACUBE_CHARGE_MS + GAIACUBE_STAGGER_MS * (GAIACUBE_COUNT - 1) + GAIACUBE_FLIGHT_MS;
  const GAIACUBE_RELEASE_MS = GAIACUBE_FINAL_IMPACT_MS + 160;   // ④ガイアのパワー解放（少し溜めてから）
  const GAIACUBE_PILLAR_MS = 560;                                 // 岩柱が突き上がる尺
  const GAIACUBE_END_MS = GAIACUBE_RELEASE_MS + GAIACUBE_PILLAR_MS + 820;

  function spawnGaiaCubeSpecial(particles, w, h, info) {
    const from = (info && info.from) || { x: w * 0.28, y: h * 0.68 };
    const to = (info && info.to) || { x: w * 0.72, y: h * 0.32 };
    const S = (info && info.scale) || 1;
    const R = Math.max(w, h);
    // じしん演出と同じ考え方で「地面」の高さを相手の少し下に置く（岩柱の起点）
    const groundY = Math.min(h - 6 * S, to.y + 34 * S);

    // 古代キューブの色パレット（大地の力を思わせる、土・鉱物・苔むした色調の多色）
    const PALETTE = [
      { base: '#c9a24a', hi: '#f5deA0', lo: '#8a6420', glow: '#e8c878' },  // 琥珀・砂岩
      { base: '#7a9e5c', hi: '#c8e6a8', lo: '#456030', glow: '#a8d480' },  // 苔緑
      { base: '#b06840', hi: '#e8a878', lo: '#6e3c20', glow: '#d89060' },  // 赤土
      { base: '#8a7cc0', hi: '#d0c4f0', lo: '#4e3e8a', glow: '#b8a8e8' },  // 紫水晶
      { base: '#5c8ca0', hi: '#a8d8e8', lo: '#2e4e5c', glow: '#84c0d4' },  // 青銅緑青
    ];

    // ---- 古代キューブを描く：正方形の6面体を疑似3D（上面・正面・側面）で描き、
    //      面ごとに古代文字めいた刻印の筋を薄く入れる ----
    function drawCube(ctx, x, y, size, rot, tilt, col, alpha) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rot);
      const s = size;
      const skew = 0.42 + 0.12 * Math.sin(tilt);   // 上面の見え方をわずかに揺らす（重々しい浮遊感）
      // 発光ハロー
      ctx.globalCompositeOperation = 'lighter';
      const halo = ctx.createRadialGradient(0, 0, 0, 0, 0, s * 2.0);
      halo.addColorStop(0, rgba(col.glow, alpha * 0.5));
      halo.addColorStop(1, rgba(col.glow, 0));
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(0, 0, s * 2.0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      // 正面
      ctx.fillStyle = rgba(col.base, alpha);
      ctx.fillRect(-s * 0.5, -s * 0.1, s, s * 0.9);
      // 側面（右、暗め）
      ctx.fillStyle = rgba(col.lo, alpha);
      ctx.beginPath();
      ctx.moveTo(s * 0.5, -s * 0.1);
      ctx.lineTo(s * 0.5 + s * 0.3, -s * 0.1 - s * skew);
      ctx.lineTo(s * 0.5 + s * 0.3, s * 0.8 - s * skew);
      ctx.lineTo(s * 0.5, s * 0.8);
      ctx.closePath();
      ctx.fill();
      // 上面（明るめ）
      ctx.fillStyle = rgba(col.hi, alpha);
      ctx.beginPath();
      ctx.moveTo(-s * 0.5, -s * 0.1);
      ctx.lineTo(-s * 0.5 + s * 0.3, -s * 0.1 - s * skew);
      ctx.lineTo(s * 0.5 + s * 0.3, -s * 0.1 - s * skew);
      ctx.lineTo(s * 0.5, -s * 0.1);
      ctx.closePath();
      ctx.fill();
      // 古代文字めいた刻印の筋（正面に薄く、発光する細い線）
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = rgba(col.glow, alpha * 0.8);
      ctx.lineWidth = Math.max(0.6, s * 0.045);
      ctx.beginPath();
      ctx.moveTo(-s * 0.28, s * 0.05); ctx.lineTo(s * 0.05, s * 0.05);
      ctx.moveTo(-s * 0.15, s * 0.05); ctx.lineTo(-s * 0.15, s * 0.5);
      ctx.moveTo(-s * 0.28, s * 0.6); ctx.lineTo(s * 0.05, s * 0.6);
      ctx.moveTo(s * 0.18, s * 0.15); ctx.lineTo(s * 0.18, s * 0.55);
      ctx.stroke();
      ctx.globalCompositeOperation = 'source-over';
      // 輪郭
      ctx.strokeStyle = rgba('#fff8e0', alpha * 0.8);
      ctx.lineWidth = Math.max(1, s * 0.06);
      ctx.strokeRect(-s * 0.5, -s * 0.1, s, s * 0.9);
      ctx.beginPath();
      ctx.moveTo(s * 0.5, -s * 0.1); ctx.lineTo(s * 0.5 + s * 0.3, -s * 0.1 - s * skew);
      ctx.lineTo(s * 0.5 + s * 0.3, s * 0.8 - s * skew); ctx.lineTo(s * 0.5, s * 0.8);
      ctx.moveTo(-s * 0.5, -s * 0.1); ctx.lineTo(-s * 0.5 + s * 0.3, -s * 0.1 - s * skew);
      ctx.lineTo(s * 0.5 + s * 0.3, -s * 0.1 - s * skew);
      ctx.stroke();
      ctx.restore();
    }

    // ---- キューブごとの軌道をあらかじめ決める ----
    const dx = to.x - from.x, dy = to.y - from.y;
    const dist = Math.hypot(dx, dy) || 1;
    const dirAng = Math.atan2(dy, dx);
    const cubes = [];
    for (let i = 0; i < GAIACUBE_COUNT; i++) {
      const fan = (i / (GAIACUBE_COUNT - 1) - 0.5) * Math.PI * 0.95;
      const ringR = (40 + (i % 3) * 14) * S;
      const hoverX = from.x + Math.cos(dirAng + fan + Math.PI * 0.5) * ringR * 0.85 - Math.cos(dirAng) * 10 * S;
      const hoverY = from.y + Math.sin(dirAng + fan + Math.PI * 0.5) * ringR * 0.85 - Math.sin(dirAng) * 10 * S;
      const spread = 24 * S;
      const hitX = to.x + rand(-spread, spread);
      const hitY = to.y + rand(-spread, spread) * 0.7;
      cubes.push({
        col: PALETTE[i % PALETTE.length],
        hoverX, hoverY, hitX, hitY,
        size: (12 + rand(0, 4)) * S,
        spin: rand(-2.2, 2.2),
        arc: rand(0.08, 0.18) * dist * (i % 2 ? 1 : -1),
        seed: rand(0, 100),
        launch: GAIACUBE_CHARGE_MS + i * GAIACUBE_STAGGER_MS,
      });
    }

    // ---- ①予兆：攻撃側の足元に大地の力を思わせる古代の光の陣 ----
    particles.push({
      maxLife: GAIACUBE_CHARGE_MS + 220,
      blend: 'lighter',
      draw(ctx, t) {
        const a = Math.sin(Math.PI * clamp01(t)) * 0.55;
        const r = lerp(12 * S, 76 * S, easeOutCubic(t));
        const g = ctx.createRadialGradient(from.x, from.y, 0, from.x, from.y, r);
        g.addColorStop(0, rgba('#fff2c0', a * 0.7));
        g.addColorStop(0.45, rgba('#c9a24a', a * 0.55));
        g.addColorStop(0.8, rgba('#7a9e5c', a * 0.3));
        g.addColorStop(1, 'rgba(122,158,92,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(from.x, from.y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    // 六角の結界紋（回転する多角形の輪。古代の力を練っている印象）
    particles.push({
      delay: 30,
      maxLife: GAIACUBE_CHARGE_MS - 80,
      blend: 'lighter',
      draw(ctx, t) {
        const ms = 30 + t * (GAIACUBE_CHARGE_MS - 80);
        const a = Math.sin(Math.PI * clamp01(t)) * 0.6;
        const rr = 60 * S * lerp(0.7, 1, easeOutCubic(t));
        ctx.save();
        ctx.translate(from.x, from.y);
        ctx.rotate(ms * 0.003);
        ctx.scale(1, 0.75);
        ctx.strokeStyle = rgba('#e8c878', a);
        ctx.lineWidth = Math.max(1, 2 * S);
        ctx.shadowColor = rgba('#c9a24a', 0.9);
        ctx.shadowBlur = 8 * S;
        ctx.beginPath();
        for (let k = 0; k < 6; k++) {
          const a0 = (k / 6) * Math.PI * 2;
          const x0 = Math.cos(a0) * rr, y0 = Math.sin(a0) * rr;
          if (k === 0) ctx.moveTo(x0, y0); else ctx.lineTo(x0, y0);
        }
        ctx.closePath();
        ctx.stroke();
        ctx.restore();
      }
    });

    // ---- ①②キューブが生成→浮遊→発射 ----
    cubes.forEach((c, i) => {
      particles.push({
        delay: i * 44,
        maxLife: c.launch - i * 44,
        draw(ctx, t) {
          if (t >= 1) return;
          const pop = easeOutCubic(clamp01(t * 2));
          const bob = noise1(t * 5 + c.seed, c.seed) * 3.5 * S;
          const x = lerp(from.x, c.hoverX, pop);
          const y = lerp(from.y, c.hoverY, pop) + bob;
          drawCube(ctx, x, y, c.size * (0.35 + 0.65 * pop), t * c.spin * 0.6, t * 5 + c.seed, c.col, clamp01(t * 3.5));
        }
      });
      // 飛翔
      particles.push({
        delay: c.launch,
        maxLife: GAIACUBE_FLIGHT_MS,
        draw(ctx, t) {
          const e = easeInCubic(t) * 0.5 + t * 0.5;
          const bend = Math.sin(Math.PI * e) * c.arc;
          const nx = -dy / dist, ny = dx / dist;
          const px = lerp(c.hoverX, c.hitX, e) + nx * bend;
          const py = lerp(c.hoverY, c.hitY, e) + ny * bend;
          // 光の尾
          for (let k = 5; k >= 1; k--) {
            const te = Math.max(0, e - k * 0.05);
            const tb = Math.sin(Math.PI * te) * c.arc;
            const tx = lerp(c.hoverX, c.hitX, te) + nx * tb;
            const ty = lerp(c.hoverY, c.hitY, te) + ny * tb;
            const ta = (1 - k / 6) * 0.5;
            ctx.save();
            ctx.globalCompositeOperation = 'lighter';
            ctx.fillStyle = rgba(c.col.glow, ta);
            ctx.shadowColor = rgba(c.col.glow, 0.8);
            ctx.shadowBlur = 9;
            ctx.beginPath();
            ctx.arc(tx, ty, c.size * (0.4 - k * 0.04), 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
          }
          const fade = t > 0.9 ? 1 - (t - 0.9) / 0.1 : 1;
          drawCube(ctx, px, py, c.size, t * c.spin * 2.4, t * 6 + c.seed, c.col, fade);
        }
      });
      // 個別の着弾（突き刺さる衝撃＋ひびの光）
      particles.push({
        delay: c.launch + GAIACUBE_FLIGHT_MS,
        maxLife: 280,
        blend: 'lighter',
        draw(ctx, t) {
          const a = 1 - t;
          const r = lerp(3 * S, 26 * S, easeOutQuint(t));
          const gr = ctx.createRadialGradient(c.hitX, c.hitY, 0, c.hitX, c.hitY, r);
          gr.addColorStop(0, rgba('#fff2c0', a));
          gr.addColorStop(0.5, rgba(c.col.glow, a * 0.7));
          gr.addColorStop(1, rgba(c.col.glow, 0));
          ctx.fillStyle = gr;
          ctx.beginPath();
          ctx.arc(c.hitX, c.hitY, r, 0, Math.PI * 2);
          ctx.fill();
          // 突き刺さった場所から走る小さなひびの光
          ctx.strokeStyle = rgba('#fff2c0', a * 0.9);
          ctx.lineWidth = 1.4 * S;
          for (let k = 0; k < 5; k++) {
            const ang = (k / 5) * Math.PI * 2 + c.seed;
            const r0 = r * 0.4, r1 = r * (1.0 + 0.3 * (k % 2));
            ctx.beginPath();
            ctx.moveTo(c.hitX + Math.cos(ang) * r0, c.hitY + Math.sin(ang) * r0);
            ctx.lineTo(c.hitX + Math.cos(ang) * r1, c.hitY + Math.sin(ang) * r1);
            ctx.stroke();
          }
        }
      });
      // 突き刺さった後、キューブがその場に残って静かに発光する（解放の瞬間まで）
      particles.push({
        delay: c.launch + GAIACUBE_FLIGHT_MS,
        maxLife: GAIACUBE_RELEASE_MS - (c.launch + GAIACUBE_FLIGHT_MS) + 40,
        draw(ctx, t) {
          if (t >= 1) return;
          const pulse = 0.85 + Math.sin(t * 10 + c.seed) * 0.12;
          drawCube(ctx, c.hitX, c.hitY, c.size * pulse, c.spin * 2.4 + t * 0.4, t * 8 + c.seed, c.col, 0.95);
        }
      });
    });

    // ============ ④解放：全弾突き刺さった直後、大地の力が一気に噴き出す ============
    const rel = GAIACUBE_RELEASE_MS;

    // 解放直前：一瞬の静寂（キューブの光がすっと収束する予備動作）
    particles.push({
      delay: GAIACUBE_FINAL_IMPACT_MS,
      maxLife: rel - GAIACUBE_FINAL_IMPACT_MS + 40,
      blend: 'lighter',
      draw(ctx, t) {
        const a = clamp01(t * 2.5) * 0.5;
        const r = lerp(70 * S, 18 * S, easeInCubic(clamp01(t * 1.3)));
        const g = ctx.createRadialGradient(to.x, to.y, 0, to.x, to.y, r);
        g.addColorStop(0, rgba('#fff2c0', a));
        g.addColorStop(1, 'rgba(255,242,192,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(to.x, to.y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    });

    // 中心の白〜金の大閃光（解放の瞬間）
    particles.push({
      delay: rel,
      maxLife: 420,
      blend: 'lighter',
      draw(ctx, t) {
        const a = Math.pow(1 - t, 1.3) * 1;
        const r = lerp(10 * S, 130 * S, easeOutQuint(t));
        const g = ctx.createRadialGradient(to.x, to.y, 0, to.x, to.y, r);
        g.addColorStop(0, rgba('#ffffff', a));
        g.addColorStop(0.28, rgba('#fff2c0', a * 0.95));
        g.addColorStop(0.6, rgba('#c9a24a', a * 0.6));
        g.addColorStop(1, 'rgba(122,158,92,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(to.x, to.y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    // 大きな十字きらめき
    particles.push({
      delay: rel,
      maxLife: 480,
      blend: 'lighter',
      draw(ctx, t) {
        const a = Math.sin(Math.PI * clamp01(t)) * 0.95;
        const size = lerp(14 * S, 100 * S, easeOutCubic(t));
        ctx.save();
        ctx.translate(to.x, to.y);
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = rgba('#ffffff', a);
        ctx.shadowColor = rgba('#fff2c0', 0.9);
        ctx.shadowBlur = size * 0.7;
        ctx.beginPath();
        ctx.moveTo(0, -size);
        ctx.quadraticCurveTo(size * 0.1, -size * 0.1, size, 0);
        ctx.quadraticCurveTo(size * 0.1, size * 0.1, 0, size);
        ctx.quadraticCurveTo(-size * 0.1, size * 0.1, -size, 0);
        ctx.quadraticCurveTo(-size * 0.1, -size * 0.1, 0, -size);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    });
    // 多重の衝撃波リング（金褐色〜深緑）
    ['#fff2c0', '#c9a24a', '#7a9e5c'].forEach((col, i) => {
      particles.push({
        delay: rel + i * 40,
        maxLife: 460 - i * 40,
        blend: 'lighter',
        draw(ctx, t) {
          const r = lerp(8 * S, R * (0.14 + i * 0.045), easeOutQuint(t));
          ctx.strokeStyle = rgba(col, (1 - t) * (0.9 - i * 0.16));
          ctx.lineWidth = (6 - i) * S * (1 - t * 0.5);
          ctx.shadowColor = rgba(col, 0.9);
          ctx.shadowBlur = 13 * S;
          ctx.beginPath();
          ctx.arc(to.x, to.y, r, 0, Math.PI * 2);
          ctx.stroke();
        }
      });
    });

    // ---- 足元が裂けて岩柱が突き上がる（じしんの岩柱演出を、着弾点周辺に集約して再現）----
    const pillarCount = 5;
    for (let i = 0; i < pillarCount; i++) {
      const px0 = to.x + (i - (pillarCount - 1) / 2) * 26 * S + rand(-6, 6) * S;
      const delay = rel + 40 + rand(0, 180);
      const height = (60 + rand(0, 46)) * S;
      const width = (16 + rand(0, 10)) * S;
      particles.push({
        delay,
        maxLife: GAIACUBE_PILLAR_MS + 260,
        px0, height, width,
        draw(ctx, t) {
          const rise = easeOutQuint(clamp01(t / 0.4));
          const settle = t > 0.55 ? Math.sin((t - 0.55) / 0.45 * Math.PI) * 4 * S : 0;
          const h0 = this.height * rise;
          const alpha = 1 - Math.max(0, (t - 0.7) / 0.3);
          ctx.save();
          ctx.translate(settle, 0);
          const grad = ctx.createLinearGradient(this.px0 - this.width / 2, 0, this.px0 + this.width / 2, 0);
          grad.addColorStop(0, rgba('#6e4e22', alpha));
          grad.addColorStop(0.5, rgba('#c9a24a', alpha));
          grad.addColorStop(1, rgba('#5c3f1e', alpha));
          ctx.fillStyle = grad;
          ctx.fillRect(this.px0 - this.width / 2, groundY - h0, this.width, h0 + 20 * S);
          ctx.fillStyle = rgba('#f5deA0', alpha);
          ctx.beginPath();
          ctx.moveTo(this.px0 - this.width / 2, groundY - h0);
          ctx.lineTo(this.px0, groundY - h0 - 12 * S * rise);
          ctx.lineTo(this.px0 + this.width / 2, groundY - h0);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        }
      });
      // 岩柱の根元で弾ける苔緑がかった砂煙
      particles.push({
        delay,
        maxLife: 360,
        px0,
        draw(ctx, t) {
          const alpha = (1 - t) * 0.6;
          const r = lerp(6 * S, 46 * S, easeOutCubic(t));
          const grad = ctx.createRadialGradient(this.px0, groundY, 0, this.px0, groundY, r);
          grad.addColorStop(0, rgba('#d8c088', alpha));
          grad.addColorStop(1, 'rgba(122,158,92,0)');
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.ellipse(this.px0, groundY, r, r * 0.35, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }

    // 画面各所に飛び散る岩の破片（威力200らしく多め・遠くまで）
    for (let i = 0; i < 20; i++) {
      const ang = rand(0, Math.PI * 2);
      const sp = rand(40, 140) * S;
      particles.push({
        delay: rel + rand(0, 60),
        maxLife: rand(420, 640),
        ang, sp,
        size: rand(3, 7) * S,
        spin: rand(-8, 8),
        rot0: rand(0, Math.PI * 2),
        col: pick(['#c9a24a', '#7a9e5c', '#8a6420', '#f5deA0']),
        draw(ctx, t) {
          const e = easeOutCubic(t);
          const x = to.x + Math.cos(this.ang) * this.sp * e;
          const y = to.y + Math.sin(this.ang) * this.sp * e * 0.75 + t * t * 30 * S;
          const a = (1 - t) * 0.9;
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(this.rot0 + t * this.spin);
          ctx.fillStyle = rgba(this.col, a);
          ctx.beginPath();
          ctx.moveTo(-this.size, -this.size * 0.7);
          ctx.lineTo(this.size, -this.size * 0.4);
          ctx.lineTo(this.size * 0.6, this.size);
          ctx.lineTo(-this.size * 0.7, this.size * 0.6);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        }
      });
    }

    // 画面全体に舞い上がる土煙（横に広い楕円グラデーションを重ねる、じしんより大きく長く）
    for (let i = 0; i < 3; i++) {
      const cx = to.x + (i - 1) * w * 0.14;
      particles.push({
        delay: rel + 60 + i * 70,
        maxLife: GAIACUBE_END_MS - rel - 60,
        cx,
        draw(ctx, t) {
          const grow = easeOutCubic(clamp01(t / 0.4));
          const fade = t < 0.4 ? 1 : Math.pow(1 - (t - 0.4) / 0.6, 1.2);
          const r = w * (0.2 + grow * 0.17);
          const grad = ctx.createRadialGradient(this.cx, groundY, 0, this.cx, groundY, r);
          grad.addColorStop(0, rgba('#c9a06a', fade * 0.48));
          grad.addColorStop(1, 'rgba(160,140,90,0)');
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.ellipse(this.cx, groundY - r * 0.15, r, r * 0.5, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }

    // 土色の全画面フラッシュ（土埃が最も舞い上がる瞬間）
    particles.push({
      delay: rel + 140,
      maxLife: 420,
      blend: 'source-over',
      draw(ctx, t) {
        const alpha = Math.sin(Math.PI * clamp01(t)) * 0.3;
        ctx.fillStyle = rgba('#b09a5e', alpha);
        ctx.fillRect(0, 0, w, h);
      }
    });

    // 飛び散るキューブの破片と光の粒（余韻。パワージェムの幕3に相当）
    for (let i = 0; i < 18; i++) {
      const col = PALETTE[i % PALETTE.length];
      const ang = rand(0, Math.PI * 2);
      const sp = rand(24, 84) * S;
      const isShard = i % 2 === 0;
      particles.push({
        delay: rel + 100 + rand(0, 60),
        maxLife: rand(380, 580),
        blend: isShard ? 'source-over' : 'lighter',
        ang, sp, col,
        size: rand(4, 8) * S,
        spin: rand(-4, 4),
        seed: rand(0, 100),
        draw(ctx, t) {
          const e = easeOutCubic(t);
          const x = to.x + Math.cos(this.ang) * this.sp * e;
          const y = to.y + Math.sin(this.ang) * this.sp * e * 0.8 + (isShard ? t * t * 24 * S : 0);
          const a = (1 - t) * (0.6 + 0.4 * Math.abs(noise1(t * 16, this.seed)));
          if (isShard) {
            drawCube(ctx, x, y, this.size, t * this.spin, t * 6 + this.seed, this.col, a);
          } else {
            ctx.fillStyle = rgba(this.col.glow, a);
            ctx.shadowColor = rgba(this.col.glow, 0.9);
            ctx.shadowBlur = 8 * S;
            ctx.beginPath();
            ctx.arc(x, y, this.size * 0.6, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      });
    }
  }

  // ============================================================
  // いばらがため（attack198・オリジナル／くさ・特殊・威力70・命中100・
  // 与えたダメージの75%を吸収）専用演出
  // 相手の足元の地面を突き破って何本もの茨が生え、螺旋を描きながら
  // 相手の体に絡みついて締め上げ、生命力（力）を吸い上げる、というリアル寄りの構成。
  // 他のくさ技（葉っぱ・花びら系）と差別化するため、「太い茎に節と棘のある茨」を
  // 二次ベジェ曲線でひとつずつ手描きし、成長→巻きつき→締め付け→吸収→枯死の
  // 一連の流れを、時間差つきの多数のパーティクルで重ねている。
  //   ①地鳴り：相手の足元の地面にひびが走り、土が跳ね上がる
  //   ②生長：地面を割って茨が下から伸び上がる（先端が成長し、棘が順に生える）
  //   ③絡みつき：茨が相手の胴体に螺旋状に巻きつき、締め付けて食い込む
  //            （赤黒い傷の滲みと、締め付けの衝撃リング）
  //   ④吸収：茨の棘の先から黄緑の光の雫が滲み出し、攻撃側へ吸い込まれていく
  //            （＝HPドレイン。最後に攻撃側で淡い緑の回復フラッシュ）
  //   ⑤枯死：役目を終えた茨が黄土色に枯れて縮み、塵となって崩れる
  // ============================================================
  const THORN_QUAKE_MS = 200;       // ①足元の地鳴り
  const THORN_GROW_MS = 420;        // ②茨が地面から伸び上がって巻きつく
  const THORN_SQUEEZE_MS = 240;     // ③締め付け
  const THORN_HIT_MS = THORN_QUAKE_MS + THORN_GROW_MS;                  // 巻きつき完了（ダメージ発生の体感タイミング）
  const THORN_DRAIN_START_MS = THORN_HIT_MS + 80;                       // ④吸収開始
  const THORN_DRAIN_MS = 560;       // ④吸収の尺（雫が攻撃側へ届くまで）
  const THORN_WITHER_MS = 420;      // ⑤枯死
  const THORN_END_MS = THORN_DRAIN_START_MS + THORN_DRAIN_MS + THORN_WITHER_MS;

  // 茨1本ぶんの中心線を返す：足元(bx,by)から相手の胴体を螺旋状に登る曲線。
  // t=0..1 で根元→先端。返り値は {x, y, tx, ty(接線), depth(前後関係: -1=奥, 1=手前)}。
  // 螺旋は「ポケモンの周囲を回る楕円軌道＋上昇」で表現し、depthで手前側の茨だけを
  // 相手のスプライトより前面に描く（奥側は暗く描くことで立体感を出す）。
  function thornCurvePoint(t, cfg) {
    // 高さ：根元から胴体上部まで。ease でゆるやかに立ち上がる
    const rise = easeOutCubic(t);
    const y = cfg.by - rise * cfg.height;
    // 螺旋角度：根元では地面に沿って外側へ、上に行くほど巻きつく
    const ang = cfg.phase + t * cfg.turns * Math.PI * 2;
    // 半径：根元は広く、胴体の位置で相手の体に沿って締まる（wobbleで有機的に）
    const r = lerp(cfg.rBase, cfg.rBody, easeOutCubic(clamp01(t * 1.6)));
    const x = cfg.bx + Math.cos(ang) * r + noise1(t * 5, cfg.seed) * 2.2 * cfg.S;
    const depth = Math.sin(ang);   // +1 = 手前側, -1 = 奥側
    // 楕円軌道の奥行き分だけ y を微調整（手前が少し下に来る）
    const yy = y + depth * cfg.rBody * 0.16;
    return { x, y: yy, depth };
  }

  // 茨1本を描画：中心線を細かく分割して、太さが先細りになる茎＋節＋棘を描く。
  // grow … 0..1 先端がどこまで伸びたか / squeeze … 0..1 締め付けの強さ
  // wither … 0..1 枯れ具合 / front … true なら手前側の茎のみ, false なら奥側のみ
  function drawThornVine(ctx, cfg, grow, squeeze, wither, front) {
    const S = cfg.S;
    const seg = 26;
    const maxT = clamp01(grow);
    if (maxT <= 0.001) return;
    // 枯れるにつれて 緑→黄土→茶 へ色が変わる
    const colMain = wither < 0.5
      ? mixHex('#2f7a2a', '#8a7a3a', wither / 0.5)
      : mixHex('#8a7a3a', '#4a3a24', (wither - 0.5) / 0.5);
    const colDark = mixHex('#164a17', '#3a2c18', clamp01(wither * 1.2));
    const colLight = mixHex('#7fc75a', '#b0a060', clamp01(wither * 1.1));
    let prev = null;
    for (let i = 0; i <= seg; i++) {
      const t = (i / seg) * maxT;
      const p = thornCurvePoint(t, cfg);
      // 締め付けで半径が縮む（相手の体に食い込む）
      if (squeeze > 0) {
        const pull = squeeze * 0.14;
        p.x = lerp(p.x, cfg.bx, pull);
      }
      const isFront = p.depth >= 0;
      if (prev && isFront === front) {
        // 太さ：根元が太く先端が細い。枯れると痩せる
        const thick = lerp(cfg.thick, cfg.thick * 0.28, t / Math.max(0.001, maxT)) * (1 - wither * 0.35) * S;
        const shade = front ? 1 : 0.55;      // 奥側の茎は暗くして立体感を出す
        ctx.lineCap = 'round';
        // 影（濃い緑）
        ctx.strokeStyle = rgba(colDark, 0.95 * shade);
        ctx.lineWidth = Math.max(1, thick * 1.25);
        ctx.beginPath(); ctx.moveTo(prev.x, prev.y); ctx.lineTo(p.x, p.y); ctx.stroke();
        // 本体
        ctx.strokeStyle = rgba(colMain, 0.98 * shade);
        ctx.lineWidth = Math.max(0.8, thick);
        ctx.beginPath(); ctx.moveTo(prev.x, prev.y); ctx.lineTo(p.x, p.y); ctx.stroke();
        // ハイライト（手前側のみ、上側にうっすら光沢）
        if (front) {
          ctx.strokeStyle = rgba(colLight, 0.55);
          ctx.lineWidth = Math.max(0.5, thick * 0.32);
          ctx.beginPath(); ctx.moveTo(prev.x, prev.y - thick * 0.22); ctx.lineTo(p.x, p.y - thick * 0.22); ctx.stroke();
        }
      }
      prev = p;
    }
    // 棘：一定間隔で茎から斜めに生える三角形。先端側の棘ほど遅れて生える
    const thorns = cfg.thorns;
    for (let k = 0; k < thorns; k++) {
      const tt = (k + 0.6) / thorns;
      if (tt > maxT) continue;
      const p = thornCurvePoint(tt, cfg);
      if (squeeze > 0) p.x = lerp(p.x, cfg.bx, squeeze * 0.14);
      const isFront = p.depth >= 0;
      if (isFront !== front) continue;
      // 棘の生え具合：茎が到達してから少し遅れて伸びる
      const sprout = clamp01((maxT - tt) * 6);
      // 棘の向き：茎の進行方向に対して左右交互に、外側へ向かって反る
      const side = (k % 2 === 0) ? 1 : -1;
      const p2 = thornCurvePoint(Math.min(1, tt + 0.02), cfg);
      const tx = p2.x - p.x, ty = p2.y - p.y;
      const tl = Math.max(0.001, Math.hypot(tx, ty));
      const nx = -ty / tl * side, ny = tx / tl * side;
      const len = (6.5 + (k % 3) * 1.6) * S * sprout * (1 - wither * 0.5);
      const base = 2.2 * S * (1 - wither * 0.3);
      const shade = front ? 1 : 0.55;
      ctx.fillStyle = rgba(mixHex('#3a2a14', '#6a5230', wither), 0.95 * shade);
      ctx.beginPath();
      ctx.moveTo(p.x - (tx / tl) * base, p.y - (ty / tl) * base);
      ctx.lineTo(p.x + (tx / tl) * base, p.y + (ty / tl) * base);
      // 先端はやや進行方向へ反らせる（鉤状の棘）
      ctx.lineTo(p.x + nx * len + (tx / tl) * len * 0.35, p.y + ny * len + (ty / tl) * len * 0.35);
      ctx.closePath();
      ctx.fill();
    }
  }

  // 16進カラー2色の線形補間（枯れ具合の色変化用）
  function mixHex(a, b, t) {
    const ca = hexToRgb(a), cb = hexToRgb(b);
    const k = clamp01(t);
    const r = Math.round(lerp(ca.r, cb.r, k));
    const g = Math.round(lerp(ca.g, cb.g, k));
    const bl = Math.round(lerp(ca.b, cb.b, k));
    return '#' + ((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1);
  }

  function spawnThornBindSpecial(particles, w, h, info) {
    const from = (info && info.from) || { x: w * 0.28, y: h * 0.68 };
    const to = (info && info.to) || { x: w * 0.72, y: h * 0.32 };
    const S = (info && info.scale) || 1;
    // 相手スプライトの足元＝中心のやや下、胴体高さ＝スプライトサイズの約0.6倍
    const bodyH = 62 * S;
    const footY = to.y + 34 * S;
    const seedBase = rand(0, 100);

    // ---- 茨の設定：6本。奥側から手前側まで位相をずらして配置し、螺旋を成す ----
    const vines = [];
    const VINE_N = 6;
    for (let i = 0; i < VINE_N; i++) {
      const ratio = i / VINE_N;
      const lane = (i - (VINE_N - 1) / 2) / ((VINE_N - 1) / 2);   // -1..+1：根元を左右に散らす
      // 高さを大きくばらつかせ、胴体の低い所〜頭近くまで満遍なく絡める（束にならないように）
      const hRatio = 0.55 + (i % 3) * 0.24 + rand(-0.05, 0.05);
      vines.push({
        bx: to.x + lane * 26 * S + rand(-4, 4) * S,
        by: footY + rand(-3, 5) * S,
        height: bodyH * hRatio,
        phase: ratio * Math.PI * 2 + rand(-0.3, 0.3),
        turns: rand(0.8, 1.9) * (i % 2 === 0 ? 1 : -1),    // 巻き方向を交互にして、体の上で交差させる
        rBase: rand(34, 48) * S,
        rBody: rand(20, 30) * S,                            // 胴体を包むよう、少し広めに巻く
        thick: rand(3.6, 5.6),
        thorns: 8 + ((Math.random() * 4) | 0),
        seed: seedBase + i * 7.3,
        S,
        delay: THORN_QUAKE_MS - 40 + i * 34,       // 生え始めを少しずつずらす
      });
    }

    // ---- ①地鳴り：足元に土色のもやと、亀裂と、跳ね上がる土の粒 ----
    particles.push({
      maxLife: THORN_QUAKE_MS + 200,
      draw(ctx, t) {
        const alpha = Math.sin(Math.PI * clamp01(t)) * 0.5;
        const wob = noise1(t * 9, seedBase) * 3 * S;
        const r = 56 * S;
        const g = ctx.createRadialGradient(to.x + wob, footY, 0, to.x + wob, footY, r);
        g.addColorStop(0, rgba('#8a6a3a', alpha));
        g.addColorStop(0.55, rgba('#4a3418', alpha * 0.55));
        g.addColorStop(1, 'rgba(74,52,24,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.ellipse(to.x + wob, footY, r, r * 0.34, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    for (let i = 0; i < 8; i++) {
      const ang = rand(0, Math.PI * 2);
      const len = rand(16, 38) * S;
      particles.push({
        delay: 20 + i * 12,
        maxLife: 300,
        draw(ctx, t) {
          const e = easeOutCubic(t);
          const alpha = (1 - t) * 0.85;
          ctx.save();
          ctx.translate(to.x, footY);
          ctx.scale(1, 0.36);              // 地面上のひびに見えるよう縦を潰す
          ctx.rotate(ang);
          ctx.strokeStyle = rgba('#2a1a0a', alpha);
          ctx.lineWidth = 2.6 * S;
          ctx.lineCap = 'round';
          ctx.beginPath(); ctx.moveTo(4 * S, 0); ctx.lineTo(4 * S + len * e, 0); ctx.stroke();
          ctx.strokeStyle = rgba('#9ad060', alpha * 0.7);   // 割れ目の奥に覗く生命力の緑
          ctx.lineWidth = 0.9 * S;
          ctx.beginPath(); ctx.moveTo(4 * S, 0); ctx.lineTo(4 * S + len * e * 0.9, 0); ctx.stroke();
          ctx.restore();
        }
      });
    }
    for (let i = 0; i < 16; i++) {
      const ox = rand(-30, 30) * S;
      const vy = rand(22, 46) * S;
      const dotR = rand(1.4, 2.6) * S;
      particles.push({
        delay: THORN_QUAKE_MS - 30 + rand(0, 140),
        maxLife: rand(300, 440),
        draw(ctx, t) {
          const x = to.x + ox * (0.6 + t * 0.6);
          const y = footY - vy * Math.sin(t * Math.PI) + t * t * 12 * S;
          const alpha = (1 - t) * 0.9;
          ctx.fillStyle = rgba(i % 3 === 0 ? '#6a4a26' : '#3a2812', alpha);
          ctx.beginPath();
          ctx.arc(x, y, dotR * (1 - t * 0.4), 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }

    // ---- ②〜③〜⑤ 茨本体：1本ごとに「奥側の茎」「手前側の茎」を別パーティクルで描き、
    //      手前側は相手の上に、奥側は下（先に描画）に重なるようにする ----
    // 相手スプライトそのものはこのcanvasの外側(DOM)にあるため、奥側/手前側は
    // 単純に同じcanvas内で「奥側→(体)→手前側」の順に描画される想定で二層に分ける。
    const lifeMs = THORN_END_MS;
    vines.forEach((v) => {
      const growMs = THORN_GROW_MS - (v.delay - (THORN_QUAKE_MS - 40)) * 0.4;
      const stateAt = (elapsed) => {
        const gt = clamp01((elapsed - v.delay) / growMs);
        const grow = easeOutCubic(gt);
        // 締め付け：巻きつき完了後に脈打つように締まる
        const sq0 = clamp01((elapsed - THORN_HIT_MS) / THORN_SQUEEZE_MS);
        const squeeze = easeOutCubic(sq0) * (1 - clamp01((elapsed - THORN_HIT_MS - THORN_SQUEEZE_MS - 60) / 260) * 0.45);
        // 枯死：吸収が終わる頃から色が抜けて縮む
        const wStart = THORN_DRAIN_START_MS + THORN_DRAIN_MS - 120;
        const wither = clamp01((elapsed - wStart) / THORN_WITHER_MS);
        // 枯れて縮む（先端から短くなる）
        const shrink = wither > 0.55 ? 1 - clamp01((wither - 0.55) / 0.45) * 0.85 : 1;
        return { grow: grow * shrink, squeeze, wither };
      };
      // 奥側（相手の体より後ろ）
      particles.push({
        delay: 0,
        maxLife: lifeMs,
        draw(ctx, t) {
          const el = t * lifeMs;
          const st = stateAt(el);
          const fade = el > lifeMs - 160 ? clamp01((lifeMs - el) / 160) : 1;
          ctx.globalAlpha = fade;
          drawThornVine(ctx, v, st.grow, st.squeeze, st.wither, false);
        }
      });
      // 手前側（相手の体の前）
      particles.push({
        delay: 0,
        maxLife: lifeMs,
        draw(ctx, t) {
          const el = t * lifeMs;
          const st = stateAt(el);
          const fade = el > lifeMs - 160 ? clamp01((lifeMs - el) / 160) : 1;
          ctx.globalAlpha = fade;
          drawThornVine(ctx, v, st.grow, st.squeeze, st.wither, true);
        }
      });
    });

    // ---- ③締め付けの瞬間：胴体を中心に緑白の衝撃リングと、傷が滲む赤黒いもや ----
    particles.push({
      delay: THORN_HIT_MS,
      maxLife: 380,
      draw(ctx, t) {
        const e = easeOutCubic(t);
        const r = lerp(10, 54, e) * S;
        const alpha = (1 - t) * 0.55;
        ctx.strokeStyle = rgba('#c8ff9a', alpha);
        ctx.lineWidth = Math.max(1, 3 * S * (1 - t * 0.6));
        ctx.shadowColor = rgba('#7fd35f', 0.8);
        ctx.shadowBlur = 8 * S;
        ctx.beginPath();
        ctx.ellipse(to.x, to.y + 6 * S, r, r * 0.55, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    });
    particles.push({
      delay: THORN_HIT_MS + 20,
      maxLife: 420,
      draw(ctx, t) {
        const alpha = Math.sin(Math.PI * clamp01(t)) * 0.4;
        const r = lerp(10, 40, easeOutCubic(t)) * S;
        const g = ctx.createRadialGradient(to.x, to.y + 8 * S, 0, to.x, to.y + 8 * S, r);
        g.addColorStop(0, rgba('#8a1a24', alpha));
        g.addColorStop(1, 'rgba(58,10,16,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(to.x, to.y + 8 * S, r, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    // 締め付けで食い込む棘の跡：小さな赤い点が胴体まわりにぽつぽつ現れて消える
    for (let i = 0; i < 12; i++) {
      const a0 = rand(0, Math.PI * 2);
      const rr = rand(8, 22) * S;
      particles.push({
        delay: THORN_HIT_MS + rand(0, 90),
        maxLife: rand(260, 380),
        draw(ctx, t) {
          const alpha = Math.sin(Math.PI * clamp01(t)) * 0.85;
          ctx.fillStyle = rgba('#c0303e', alpha);
          ctx.beginPath();
          ctx.arc(to.x + Math.cos(a0) * rr, to.y + 6 * S + Math.sin(a0) * rr * 0.6, 1.5 * S, 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }

    // ---- ④吸収：棘の先から黄緑の光の雫が滲み出し、弧を描いて攻撃側へ吸い込まれる ----
    for (let i = 0; i < 26; i++) {
      const a0 = rand(0, Math.PI * 2);
      const rr = rand(10, 34) * S;
      const sx = to.x + Math.cos(a0) * rr;
      const sy = to.y + rand(-22, 30) * S;
      const startDelay = THORN_DRAIN_START_MS + rand(0, 280);
      const arc = rand(-26, 26) * S;         // 軌道の膨らみ（一直線にならないよう散らす）
      particles.push({
        delay: startDelay,
        maxLife: rand(340, 460),
        blend: 'lighter',
        draw(ctx, t) {
          // 前半：ふわっと滲み出す／後半：加速して攻撃側へ吸い込まれる
          const pull = easeInCubic(clamp01((t - 0.12) / 0.88));
          const mx = (sx + from.x) / 2 + arc, my = (sy + from.y) / 2 - 22 * S;
          const x = (1 - pull) * (1 - pull) * sx + 2 * (1 - pull) * pull * mx + pull * pull * from.x;
          const y = (1 - pull) * (1 - pull) * sy + 2 * (1 - pull) * pull * my + pull * pull * from.y;
          // 胴体付近で雫が重なって白飛びしないよう、立ち上がりは控えめ→攻撃側へ近づくほど明るく
          const fadeIn = clamp01(t / 0.22);
          const alpha = (t < 0.88 ? 0.95 : (1 - (t - 0.88) / 0.12) * 0.95) * (0.35 + 0.65 * pull) * fadeIn;
          const size = lerp(3.6, 1.6, clamp01(t)) * S;
          const g = ctx.createRadialGradient(x, y, 0, x, y, size * 2.6);
          g.addColorStop(0, rgba('#f4ffc8', alpha));
          g.addColorStop(0.4, rgba('#9be05a', alpha * 0.8));
          g.addColorStop(1, 'rgba(90,190,60,0)');
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(x, y, size * 2.6, 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }
    // 吸収中、相手の胴体から立ちのぼる「力が抜けていく」薄い緑のもや
    particles.push({
      delay: THORN_DRAIN_START_MS,
      maxLife: THORN_DRAIN_MS,
      draw(ctx, t) {
        const alpha = Math.sin(Math.PI * clamp01(t)) * 0.2;
        const r = 46 * S;
        const g = ctx.createRadialGradient(to.x, to.y, 0, to.x, to.y, r);
        g.addColorStop(0, rgba('#b6f070', alpha));
        g.addColorStop(1, 'rgba(120,200,70,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(to.x, to.y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    // 攻撃側で雫が届いた瞬間の回復フラッシュ（HPが戻った感触）
    particles.push({
      delay: THORN_DRAIN_START_MS + 300,
      maxLife: 320,
      blend: 'lighter',
      draw(ctx, t) {
        const alpha = (1 - t) * 0.55;
        const r = lerp(4, 32, easeOutCubic(t)) * S;
        const g = ctx.createRadialGradient(from.x, from.y, 0, from.x, from.y, r);
        g.addColorStop(0, rgba('#eaffc8', alpha));
        g.addColorStop(0.6, rgba('#7fd35f', alpha * 0.5));
        g.addColorStop(1, 'rgba(90,200,90,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(from.x, from.y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    for (let i = 0; i < 6; i++) {
      const a0 = rand(0, Math.PI * 2);
      particles.push({
        delay: THORN_DRAIN_START_MS + 320 + rand(0, 100),
        maxLife: rand(360, 500),
        blend: 'lighter',
        draw(ctx, t) {
          const e = easeOutCubic(t);
          const x = from.x + Math.cos(a0) * 16 * S * e;
          const y = from.y - 6 * S - e * 30 * S;
          const alpha = (1 - t) * 0.85;
          ctx.fillStyle = rgba('#d8ffa0', alpha);
          ctx.beginPath();
          ctx.arc(x, y, 2 * S * (1 - t * 0.5), 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }

    // ---- ⑤枯死：茨が崩れて舞う、黄土色の塵と枯れ葉 ----
    for (let i = 0; i < 20; i++) {
      const ox = rand(-30, 30) * S;
      const oy = rand(-40, 30) * S;
      const drift = rand(-14, 14) * S;
      particles.push({
        delay: THORN_DRAIN_START_MS + THORN_DRAIN_MS - 100 + rand(0, 260),
        maxLife: rand(360, 520),
        rot: rand(0, Math.PI * 2),
        draw(ctx, t) {
          const x = to.x + ox + drift * t;
          const y = to.y + oy + t * 26 * S;
          const alpha = Math.sin(Math.PI * clamp01(t)) * 0.7;
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(this.rot + t * 4);
          ctx.fillStyle = rgba(i % 3 === 0 ? '#8a7a3a' : '#5a4a26', alpha);
          ctx.beginPath();
          ctx.ellipse(0, 0, 3.4 * S, 1.4 * S, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      });
    }
  }

  // ============================================================
  // ラピッドフレア（attack139・オリジナル／ほのお・特殊・威力100・命中100・
  // 自分の素早さを上げる）専用演出
  // 他の炎技（かえんほうしゃ＝持続照射、フレアドライブ＝体当たり）とは差別化し、
  // 「疾走する一条の炎」を相手へ撃ち込む、スピード感を前面に出した構成。
  // 素早さアップという固有効果を、着弾後に攻撃側の足元へ立ちのぼる
  // 黄緑がかった「疾風のオーラ」として視覚化しているのが最大の特徴。
  //   ①予備動作：足元に炎と疾風が同時に渦を巻き、素早く圧縮される（他の炎技より短い溜め）
  //   ②発射：彗星のように細長く伸びた炎の弾が、高速の残像を引いて一直線に飛ぶ
  //   ③着弾：炎が爆ぜて燃え広がる
  //   ④素早さアップ：攻撃側の足元に黄緑〜金色の疾風オーラが渦巻き、
  //     何本もの速度線（スピードライン）が後方から前方へ駆け抜けて、
  //     最後に上へすっと吹き抜けて消える（素早さが上がった実感を演出）
  // ============================================================
  const RAPIDFLARE_FORM_MS = 260;       // ①足元に炎と疾風が集まる（短い溜め＝素早さを予感させる）
  const RAPIDFLARE_HOLD_MS = 90;        // ②発射直前、ぎゅっと圧縮される
  const RAPIDFLARE_LAUNCH_MS = RAPIDFLARE_FORM_MS + RAPIDFLARE_HOLD_MS;
  const RAPIDFLARE_FLIGHT_MS = 170;     // ③彗星が手元→相手へ届くまで（他の炎技よりかなり速い）
  const RAPIDFLARE_HIT_MS = RAPIDFLARE_LAUNCH_MS + RAPIDFLARE_FLIGHT_MS;
  const RAPIDFLARE_BOOST_MS = 620;      // ④素早さアップのオーラ演出の尺
  const RAPIDFLARE_END_MS = RAPIDFLARE_HIT_MS + RAPIDFLARE_BOOST_MS + 260;

  function spawnRapidFlareSpecial(particles, w, h, info) {
    const from = (info && info.from) || { x: w * 0.28, y: h * 0.68 };
    const to = (info && info.to) || { x: w * 0.72, y: h * 0.32 };
    const S = (info && info.scale) || 1;
    const seed = rand(0, 100);

    const dx = to.x - from.x, dy = to.y - from.y;
    const dist = Math.hypot(dx, dy) || 1;
    const ux = dx / dist, uy = dy / dist;
    const perpX = -uy, perpY = ux;
    const hand = { x: from.x + ux * 36 * S, y: from.y + uy * 36 * S - 6 * S };
    const target = { x: to.x, y: to.y };

    // 炎の配色（白熱した芯・黄・橙・赤の速い炎）
    const WHITE = '#ffffff';
    const PALE = '#fff3c0';
    const GOLD = '#ffcf3a';
    const ORANGE = '#ff7a1a';
    const RED = '#e8420a';
    // 素早さアップのオーラ配色（黄緑〜黄、風のような色）
    const WIND_CORE = '#f4ffd0';
    const WIND_MAIN = '#c8ef4a';
    const WIND_DEEP = '#6fae1a';

    function glow(ctx, x, y, r, a, inner, mid, outer) {
      if (a <= 0.01 || r <= 0.5) return;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, rgba(inner, a));
      g.addColorStop(0.35, rgba(mid, a * 0.85));
      g.addColorStop(0.75, rgba(outer, a * 0.4));
      g.addColorStop(1, rgba(outer, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    // ============ ①予備動作：足元に炎と疾風が同時に集まり、素早く圧縮される ============
    particles.push({
      maxLife: RAPIDFLARE_LAUNCH_MS + 50,
      blend: 'lighter',
      draw(ctx, t) {
        const ms = t * (RAPIDFLARE_LAUNCH_MS + 50);
        const f = clamp01(ms / RAPIDFLARE_FORM_MS);
        const a = Math.sin(Math.PI * clamp01(t)) * 0.5;
        glow(ctx, hand.x, hand.y, lerp(10, 46, easeOutCubic(f)) * S, a, PALE, ORANGE, RED);
      }
    });
    // 渦を巻きながら手元へ吸い込まれる炎の筋（他の炎技より短く速い螺旋）
    for (let i = 0; i < 12; i++) {
      const a0 = (i / 12) * Math.PI * 2 + rand(-0.2, 0.2);
      const r0 = rand(30, 60) * S;
      particles.push({
        delay: rand(0, RAPIDFLARE_FORM_MS * 0.6),
        maxLife: rand(140, 210),
        blend: 'lighter',
        draw(ctx, t) {
          if (t >= 1) return;
          const a = clamp01(t * 5) * (1 - Math.max(0, (t - 0.8) / 0.2));
          const rad = lerp(r0, 4 * S, easeInCubic(t));
          const sp = a0 + t * 5.5;
          const x = hand.x + Math.cos(sp) * rad;
          const y = hand.y + Math.sin(sp) * rad * 0.8;
          ctx.fillStyle = rgba(i % 2 ? GOLD : ORANGE, a * 0.85);
          ctx.shadowColor = rgba(ORANGE, 0.9);
          ctx.shadowBlur = 5 * S;
          ctx.beginPath();
          ctx.arc(x, y, 2 * S, 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }
    // 圧縮の瞬間：ぎゅっと縮んでから発射する予兆の瞬き
    particles.push({
      delay: RAPIDFLARE_LAUNCH_MS - 60,
      maxLife: 160,
      blend: 'lighter',
      draw(ctx, t) {
        const a = Math.sin(Math.PI * clamp01(t)) * 0.7;
        glow(ctx, hand.x, hand.y, lerp(30 * S, 12 * S, easeInCubic(t)), a, WHITE, PALE, GOLD);
      }
    });

    // ============ ②発射：彗星のように細長い炎の弾が高速で飛ぶ ============
    const cometLen = 46 * S;
    function cometPos(e) {
      // 加速しながら一直線に飛ぶ（他の技よりイージングを鋭くして「速さ」を強調）
      const ee = Math.pow(e, 0.55);
      return { x: lerp(hand.x, target.x, ee), y: lerp(hand.y, target.y, ee) };
    }
    particles.push({
      delay: RAPIDFLARE_LAUNCH_MS,
      maxLife: RAPIDFLARE_FLIGHT_MS,
      blend: 'lighter',
      draw(ctx, t) {
        const head = cometPos(t);
        // 尾（過去位置を何点かなぞって描く、細長い彗星の尾）
        for (let k = 8; k >= 1; k--) {
          const te = Math.max(0, t - k * 0.05);
          const p = cometPos(te);
          const ta = (1 - k / 9) * 0.85;
          const rr = (cometLen * 0.16) * (1 - k / 10);
          ctx.fillStyle = rgba(k < 3 ? PALE : (k < 6 ? GOLD : ORANGE), ta);
          ctx.shadowColor = rgba(ORANGE, 0.9);
          ctx.shadowBlur = 7 * S;
          ctx.beginPath();
          ctx.arc(p.x, p.y, Math.max(1, rr), 0, Math.PI * 2);
          ctx.fill();
        }
        // 頭部（白熱の芯）
        const g = ctx.createRadialGradient(head.x, head.y, 0, head.x, head.y, 13 * S);
        g.addColorStop(0, rgba(WHITE, 1));
        g.addColorStop(0.4, rgba(PALE, 0.95));
        g.addColorStop(0.75, rgba(GOLD, 0.7));
        g.addColorStop(1, rgba(ORANGE, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(head.x, head.y, 13 * S, 0, Math.PI * 2);
        ctx.fill();
        // 横に散る細かい火の粉（速さで千切れる炎）
        for (let k = 0; k < 2; k++) {
          const off = rand(-1, 1);
          const bx = head.x + perpX * off * 8 * S - ux * rand(4, 16) * S;
          const by = head.y + perpY * off * 8 * S - uy * rand(4, 16) * S;
          ctx.fillStyle = rgba(k ? GOLD : PALE, 0.75);
          ctx.beginPath();
          ctx.arc(bx, by, 1.6 * S, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    });

    // ============ ③着弾：炎が爆ぜて燃え広がる ============
    particles.push({
      delay: RAPIDFLARE_HIT_MS - 8,
      maxLife: 260,
      blend: 'lighter',
      draw(ctx, t) {
        glow(ctx, target.x, target.y, lerp(9 * S, 64 * S, easeOutQuint(t)), Math.pow(1 - t, 1.4) * 0.9, WHITE, PALE, ORANGE);
      }
    });
    particles.push({
      delay: RAPIDFLARE_HIT_MS,
      maxLife: 440,
      blend: 'lighter',
      draw(ctx, t) {
        const grow = easeOutCubic(clamp01(t / 0.32));
        const fade = t < 0.35 ? 1 : Math.pow(1 - (t - 0.35) / 0.65, 1.3);
        glow(ctx, target.x, target.y, 74 * S * grow, fade * 0.55, GOLD, ORANGE, RED);
      }
    });
    // 衝撃波リング
    for (let i = 0; i < 2; i++) {
      particles.push({
        delay: RAPIDFLARE_HIT_MS + i * 45,
        maxLife: 320,
        blend: 'lighter',
        draw(ctx, t) {
          const e = easeOutCubic(t);
          const r = (20 * S) * (0.7 + e * 2.4);
          const alpha = (1 - t) * 0.5;
          ctx.strokeStyle = rgba(i === 0 ? PALE : ORANGE, alpha);
          ctx.lineWidth = Math.max(1, 2.6 * S * (1 - t * 0.5));
          ctx.shadowColor = rgba(ORANGE, 0.9);
          ctx.shadowBlur = 9 * S;
          ctx.beginPath();
          ctx.arc(target.x, target.y, r, 0, Math.PI * 2);
          ctx.stroke();
        }
      });
    }
    // 燃え広がる火の粉（上へ舞う）
    for (let i = 0; i < 14; i++) {
      const sx = rand(-14, 14) * S;
      const rise = rand(20, 44) * S;
      particles.push({
        delay: RAPIDFLARE_HIT_MS + rand(0, 90),
        maxLife: rand(280, 420),
        blend: 'lighter',
        draw(ctx, t) {
          const x = target.x + sx - t * 4 * S;
          const y = target.y - rise * easeOutCubic(t);
          const a = Math.sin(Math.PI * clamp01(t)) * 0.85;
          ctx.fillStyle = rgba(i % 2 ? ORANGE : PALE, a);
          ctx.shadowColor = rgba(RED, 0.9);
          ctx.shadowBlur = 6 * S;
          ctx.beginPath();
          ctx.arc(x, y, 2 * S * (1 - t * 0.4), 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }

    // ============ ④素早さアップ：攻撃側の足元に疾風のオーラが渦巻き、駆け抜けて消える ============
    const boostStart = RAPIDFLARE_HIT_MS + 120;   // 着弾を見届けてから、少し間を置いて立ち上る
    // 足元に広がる黄緑の光（ステータスアップの合図）
    particles.push({
      delay: boostStart,
      maxLife: RAPIDFLARE_BOOST_MS,
      blend: 'lighter',
      draw(ctx, t) {
        const a = Math.sin(Math.PI * clamp01(t)) * 0.5;
        const r = lerp(14 * S, 58 * S, easeOutCubic(clamp01(t * 1.4)));
        glow(ctx, from.x, from.y + 10 * S, r, a, WIND_CORE, WIND_MAIN, WIND_DEEP);
      }
    });
    // 渦を巻く疾風のリボン（2本、逆向きに回りながら立ちのぼる）
    for (let i = 0; i < 2; i++) {
      const dir = i === 0 ? 1 : -1;
      particles.push({
        delay: boostStart + i * 40,
        maxLife: RAPIDFLARE_BOOST_MS - 40,
        blend: 'lighter',
        draw(ctx, t) {
          const rise = easeOutCubic(t) * 70 * S;
          const a = Math.sin(Math.PI * clamp01(t)) * 0.8;
          ctx.strokeStyle = rgba(i === 0 ? WIND_MAIN : WIND_CORE, a);
          ctx.lineWidth = Math.max(1, 2.2 * S * (1 - t * 0.4));
          ctx.lineCap = 'round';
          ctx.shadowColor = rgba(WIND_MAIN, 0.9);
          ctx.shadowBlur = 6 * S;
          ctx.beginPath();
          for (let s = 0; s <= 20; s++) {
            const st = s / 20;
            const yy = from.y + 12 * S - rise * st;
            const wob = Math.sin(st * Math.PI * 3 + t * 6) * (10 * S) * dir * (1 - st * 0.3);
            const xx = from.x + wob;
            if (s === 0) ctx.moveTo(xx, yy); else ctx.lineTo(xx, yy);
          }
          ctx.stroke();
        }
      });
    }
    // 後方から前方へ駆け抜ける速度線（スピードライン。素早さが上がった実感を演出）
    for (let i = 0; i < 9; i++) {
      const laneOff = rand(-1, 1);
      const startDelay = boostStart + 60 + rand(0, 260);
      const len = rand(20, 40) * S;
      particles.push({
        delay: startDelay,
        maxLife: rand(180, 260),
        blend: 'lighter',
        draw(ctx, t) {
          const e = easeOutCubic(t);
          const baseX = from.x + perpX * laneOff * 26 * S - ux * 30 * S;
          const baseY = from.y + perpY * laneOff * 26 * S - 4 * S - laneOff * 4 * S;
          const travel = (60 * S) * e;
          const hx = baseX + ux * travel;
          const hy = baseY + uy * travel;
          const tx = hx - ux * len * (1 - e * 0.3);
          const ty = hy - uy * len * (1 - e * 0.3);
          const a = Math.sin(Math.PI * clamp01(t)) * 0.85;
          const gr = ctx.createLinearGradient(hx, hy, tx, ty);
          gr.addColorStop(0, rgba(WIND_CORE, a));
          gr.addColorStop(1, rgba(WIND_MAIN, 0));
          ctx.strokeStyle = gr;
          ctx.lineWidth = Math.max(1, 2 * S);
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(hx, hy);
          ctx.lineTo(tx, ty);
          ctx.stroke();
        }
      });
    }
    // 最後にすっと上へ吹き抜ける疾風（オーラの締めくくり）
    particles.push({
      delay: boostStart + RAPIDFLARE_BOOST_MS - 260,
      maxLife: 320,
      blend: 'lighter',
      draw(ctx, t) {
        const e = easeOutCubic(t);
        const y = from.y + 12 * S - e * 90 * S;
        const a = (1 - t) * 0.6;
        glow(ctx, from.x, y, lerp(10, 26, t) * S, a, WIND_CORE, WIND_MAIN, WIND_DEEP);
      }
    });
    // 小さな黄緑の光の粒が舞い上がって消える
    for (let i = 0; i < 10; i++) {
      const sx = rand(-20, 20) * S;
      const rise = rand(50, 100) * S;
      particles.push({
        delay: boostStart + rand(0, 300),
        maxLife: rand(300, 480),
        blend: 'lighter',
        draw(ctx, t) {
          const x = from.x + sx + Math.sin(t * 6 + i) * 4 * S;
          const y = from.y + 10 * S - rise * easeOutCubic(t);
          const a = Math.sin(Math.PI * clamp01(t)) * 0.75;
          ctx.fillStyle = rgba(i % 2 ? WIND_CORE : WIND_MAIN, a);
          ctx.shadowColor = rgba(WIND_MAIN, 0.9);
          ctx.shadowBlur = 5 * S;
          ctx.beginPath();
          ctx.arc(x, y, 1.8 * S * (1 - t * 0.3), 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }
  }

  // ============================================================
  // インファイト（attack103）専用演出：XY／サンムーン系の格闘技演出を再現
  // 「攻撃側が一瞬で相手へ肉薄し、拳・膝を高速で連打してから、
  //  最後の一撃で強く弾き飛ばす」近接乱打戦をイメージした構成。
  // オーラファイトのような練り込んだ「気を込める」演出とは違い、
  // インファイトは溜めなしで即座に踏み込む「スピード重視の接近格闘」。
  //   ①踏み込み：攻撃側から相手へ向けて白い残像の突進線が走る（ほぼ一瞬）
  //   ②乱打：相手の周りで白〜オレンジの衝撃波・ヒットスパークが
  //     テンポよく4回連続で弾ける（各打撃ごとに軽い画面フラッシュ）
  //   ③フィニッシュ：最後の一撃だけ一回り大きく、白い閃光の十字と
  //     放射状の衝撃波で締めくくる
  // ============================================================
  const CLOSECOMBAT_DASH_MS = 130;        // ①踏み込みの残像
  const CLOSECOMBAT_HIT_GAP_MS = 130;     // ②各打撃の間隔
  const CLOSECOMBAT_HIT_COUNT = 4;        //    通常打撃の回数（フィニッシュは別枠）
  const CLOSECOMBAT_FIRST_HIT_MS = CLOSECOMBAT_DASH_MS + 40;
  const CLOSECOMBAT_FINISH_MS = CLOSECOMBAT_FIRST_HIT_MS + CLOSECOMBAT_HIT_COUNT * CLOSECOMBAT_HIT_GAP_MS;
  const CLOSECOMBAT_END_MS = CLOSECOMBAT_FINISH_MS + 560;

  function spawnCloseCombatSpecial(particles, w, h, info) {
    const from = (info && info.from) || { x: w * 0.28, y: h * 0.68 };
    const to = (info && info.to) || { x: w * 0.72, y: h * 0.32 };
    const S = (info && info.scale) || 1;

    const dx = to.x - from.x, dy = to.y - from.y;
    const dist = Math.hypot(dx, dy) || 1;
    const ux = dx / dist, uy = dy / dist;
    const perpX = -uy, perpY = ux;
    const target = { x: to.x, y: to.y };
    const R = 30 * S;

    // ---- ①踏み込み：攻撃側から相手へ、白く尾を引く突進の残像線が一瞬で走る ----
    particles.push({
      delay: 0,
      maxLife: CLOSECOMBAT_DASH_MS + 60,
      blend: 'lighter',
      draw(ctx, t) {
        const e = easeInCubic(clamp01(t / 0.7));
        const headX = lerp(from.x, target.x - ux * R * 1.2, e);
        const headY = lerp(from.y, target.y - uy * R * 1.2, e);
        const tailLen = dist * 0.5 * (1 - Math.abs(t - 0.4));
        const alpha = clamp01(1 - t) * 0.85;
        for (let j = -1; j <= 1; j++) {
          const ox = perpX * j * 7 * S, oy = perpY * j * 7 * S;
          const grad = ctx.createLinearGradient(
            headX + ox, headY + oy,
            headX - ux * tailLen + ox, headY - uy * tailLen + oy
          );
          grad.addColorStop(0, rgba('#ffffff', alpha * (1 - Math.abs(j) * 0.3)));
          grad.addColorStop(1, rgba('#ffb347', 0));
          ctx.strokeStyle = grad;
          ctx.lineWidth = Math.max(1, (3 - Math.abs(j)) * S);
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(headX + ox, headY + oy);
          ctx.lineTo(headX - ux * tailLen + ox, headY - uy * tailLen + oy);
          ctx.stroke();
        }
      }
    });

    // ---- 打撃の座標データ（通常4発＋フィニッシュ1発）を用意 ----
    const hits = [];
    for (let i = 0; i < CLOSECOMBAT_HIT_COUNT; i++) {
      const ang = rand(0, Math.PI * 2);
      hits.push({
        at: CLOSECOMBAT_FIRST_HIT_MS + i * CLOSECOMBAT_HIT_GAP_MS,
        angle: ang,
        big: false,
      });
    }
    hits.push({ at: CLOSECOMBAT_FINISH_MS, angle: rand(0, Math.PI * 2), big: true });

    hits.forEach((hit) => {
      const scale = hit.big ? 1.7 : 1;
      const jx = target.x + Math.cos(hit.angle) * R * 0.35;
      const jy = target.y + Math.sin(hit.angle) * R * 0.35 * 0.7;

      // 打撃の瞬間：白い芯＋オレンジの縁を持つ短い衝撃グロー
      particles.push({
        delay: hit.at,
        maxLife: hit.big ? 320 : 180,
        blend: 'lighter',
        draw(ctx, t) {
          const a = Math.pow(1 - t, 1.6);
          const r = lerp(8 * S, (hit.big ? 46 : 26) * S, easeOutQuint(t)) * scale;
          const g = ctx.createRadialGradient(jx, jy, 0, jx, jy, r);
          g.addColorStop(0, rgba('#ffffff', a * 0.95));
          g.addColorStop(0.45, rgba('#ffd08a', a * 0.7));
          g.addColorStop(1, rgba('#ff8c2a', 0));
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(jx, jy, r, 0, Math.PI * 2);
          ctx.fill();
        }
      });

      // 打撃の瞬間：放射状の衝撃線（インパクトスパーク）
      particles.push({
        delay: hit.at,
        maxLife: hit.big ? 260 : 150,
        blend: 'lighter',
        draw(ctx, t) {
          const a = 1 - t;
          const len = lerp(6 * S, (hit.big ? 40 : 22) * S, easeOutCubic(t)) * scale;
          const spikes = hit.big ? 9 : 6;
          ctx.strokeStyle = rgba('#ffffff', a * 0.9);
          ctx.lineWidth = Math.max(1, (hit.big ? 2.6 : 1.8) * S);
          ctx.shadowColor = rgba('#ffb347', 0.9);
          ctx.shadowBlur = 8 * S;
          for (let k = 0; k < spikes; k++) {
            const a0 = hit.angle + (k / spikes) * Math.PI * 2;
            ctx.beginPath();
            ctx.moveTo(jx + Math.cos(a0) * len * 0.35, jy + Math.sin(a0) * len * 0.35);
            ctx.lineTo(jx + Math.cos(a0) * len, jy + Math.sin(a0) * len);
            ctx.stroke();
          }
        }
      });

      // 通常打撃だけ：小さな「衝撃の星」形マーク（ギザギザ）を軽く添える
      if (!hit.big) {
        particles.push({
          delay: hit.at,
          maxLife: 200,
          blend: 'lighter',
          draw(ctx, t) {
            const a = 1 - t;
            const r0 = lerp(6 * S, 18 * S, easeOutCubic(t));
            ctx.beginPath();
            for (let s = 0; s < 10; s++) {
              const aa = hit.angle * 1.7 + (s / 10) * Math.PI * 2;
              const rad = s % 2 === 0 ? r0 : r0 * 0.4;
              const x = jx + Math.cos(aa) * rad;
              const y = jy + Math.sin(aa) * rad;
              if (s === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            }
            ctx.closePath();
            ctx.fillStyle = rgba('#fff3d6', a * 0.55);
            ctx.fill();
            ctx.strokeStyle = rgba('#ffffff', a * 0.8);
            ctx.lineWidth = Math.max(1, 1.6 * S);
            ctx.stroke();
          }
        });
      }
    });

    // ---- ③フィニッシュ：最後の一撃の後、白い十字の閃光と広がる衝撃波でしっかり締める ----
    particles.push({
      delay: CLOSECOMBAT_FINISH_MS - 10,
      maxLife: 300,
      blend: 'lighter',
      draw(ctx, t) {
        const alpha = 1 - t;
        const len = R * (1.6 + t * 1.6);
        ctx.save();
        ctx.translate(target.x, target.y);
        ctx.strokeStyle = rgba('#ffffff', alpha * 0.95);
        ctx.lineWidth = 3.4 * S;
        ctx.shadowColor = rgba('#ffb347', 0.9);
        ctx.shadowBlur = 16 * S;
        for (let k = 0; k < 4; k++) {
          const a = (Math.PI / 4) + (k * Math.PI / 2);
          ctx.beginPath();
          ctx.moveTo(-Math.cos(a) * len, -Math.sin(a) * len);
          ctx.lineTo(Math.cos(a) * len, Math.sin(a) * len);
          ctx.stroke();
        }
        ctx.restore();
      }
    });
    // 広がる衝撃波リング（フィニッシュのみ、外側へ大きく広がって消える）
    for (let i = 0; i < 2; i++) {
      particles.push({
        delay: CLOSECOMBAT_FINISH_MS + i * 60,
        maxLife: 420,
        blend: 'lighter',
        draw(ctx, t) {
          const e = easeOutCubic(t);
          const r = R * (0.8 + e * 2.4);
          const alpha = (1 - t) * 0.5;
          ctx.strokeStyle = rgba('#ffcf8a', alpha);
          ctx.lineWidth = Math.max(1, 3 * S * (1 - t * 0.5));
          ctx.shadowColor = rgba('#ff8c2a', 0.7);
          ctx.shadowBlur = 10 * S;
          ctx.beginPath();
          ctx.arc(target.x, target.y, r, 0, Math.PI * 2);
          ctx.stroke();
        }
      });
    }
  }

  // ============================================================
  // きあいだま：全身の気を両手の間に溜め込んで金色の大きな球にし、渾身の力で相手へ撃ち出す演出
  // （ダイヤモンド・パール版準拠：球は「白い芯 → 淡い黄 → 金色 → 橙の縁」の温かい光の塊。
  //   はどうだんの水色の軽快な球と違い、こちらは大きく重く、溜めがはっきり見える。画面シェイクなし）
  // 構成：①攻撃側の前に金色の気の粒が渦を巻いて集まり、光の輪が外から球へ縮んで吸い込まれる（気を溜める）
  //       ②球が大きく脈打ち、縁の光条が勢いよく回る。放つ直前に一瞬ぎゅっと縮む（溜め）
  //       ③球が金色の太い尾と火の粉を引きながら、相手へ一直線に飛ぶ（発射）
  //       ④命中の瞬間、金色の光が大きく爆ぜて、光の輪・光条・足元の衝撃波が広がる（炸裂）
  //       ⑤金色の火の粉がきらめきながら舞い落ちる（余韻）
  // 見た目の肝：「外から内へ縮む光の輪」で"気を集中させる"ことを表す点、球の縁を回る光条、
  //             はどうだんより一回り大きい球と、少しゆっくり重く飛ぶ速度。
  //
  // info = { from:{x,y}, to:{x,y}, scale } は spawnAuraSphereSpecial と同じ（playSpecialTypeEffect が実測）。
  // ============================================================
  const FOCUSBLAST_FORM_MS = 640;      // ①気を溜めて球が膨らむ（はどうだんより長く、溜めを見せる）
  const FOCUSBLAST_HOLD_MS = 220;      // ②大きく脈打ち、放つ直前にぎゅっと縮む
  const FOCUSBLAST_FLIGHT_MS = 340;    // ③球が手元→相手へ届くまで（重いぶん、はどうだんよりやや遅い）
  const FOCUSBLAST_LAUNCH_MS = FOCUSBLAST_FORM_MS + FOCUSBLAST_HOLD_MS;   // 球を放つ時刻
  // 球が相手に届く（＝ダメージの瞬間）。フラッシュ等はこの時刻に合わせる。
  const FOCUSBLAST_HIT_MS = FOCUSBLAST_LAUNCH_MS + FOCUSBLAST_FLIGHT_MS;
  const FOCUSBLAST_END_MS = FOCUSBLAST_HIT_MS + 800;

  function spawnFocusBlastSpecial(particles, w, h, info) {
    const from = (info && info.from) || { x: w * 0.28, y: h * 0.68 };
    const to = (info && info.to) || { x: w * 0.72, y: h * 0.32 };
    const S = (info && info.scale) || 1;
    const seed = rand(0, 100);

    const dx = to.x - from.x, dy = to.y - from.y;
    const dist = Math.hypot(dx, dy) || 1;
    const ux = dx / dist, uy = dy / dist;
    // 球を作る位置：攻撃側の中心から相手方向へ少し前に出した位置（両手の間）
    const hand = { x: from.x + ux * 40 * S, y: from.y + uy * 40 * S - 4 * S };
    // 命中位置：相手の中心
    const target = { x: to.x, y: to.y };

    const BALL_R = 27 * S;   // 球の半径（はどうだん=20 より一回り大きい）

    // きあいだまの配色（DP準拠：白い芯・淡い黄・金色・橙）
    const WHITE = '#ffffff';
    const PALE = '#fff4c2';     // 芯の周りの淡い黄
    const GOLD = '#ffd83a';     // 金色（主色）
    const AMBER = '#ffaa1c';    // 琥珀（縁）
    const ORANGE = '#e8740a';   // 橙（外縁）

    // ---- 球の位置・大きさ・脈動を時刻(ms)から直接計算する（溜め→脈動→飛翔を1本の関数で扱う）----
    function ballState(ms) {
      let r;
      if (ms < FOCUSBLAST_FORM_MS) {
        const f = clamp01(ms / FOCUSBLAST_FORM_MS);
        r = BALL_R * (0.1 + 0.9 * easeOutCubic(f));
      } else if (ms < FOCUSBLAST_LAUNCH_MS) {
        const f = (ms - FOCUSBLAST_FORM_MS) / FOCUSBLAST_HOLD_MS;   // 0〜1
        // 大きく脈打ってから、放つ直前にぎゅっと縮む（撃ち出す反動のため）
        const pulse = 1 + 0.16 * Math.sin(Math.min(f, 0.7) / 0.7 * Math.PI * 2);
        const squeeze = f > 0.7 ? 1 - 0.14 * Math.sin(((f - 0.7) / 0.3) * Math.PI * 0.5) : 1;
        r = BALL_R * pulse * squeeze;
      } else {
        r = BALL_R * 1.05;
      }
      let x = hand.x, y = hand.y, flight = 0;
      if (ms >= FOCUSBLAST_LAUNCH_MS) {
        flight = clamp01((ms - FOCUSBLAST_LAUNCH_MS) / FOCUSBLAST_FLIGHT_MS);
        const e = easeInCubic(flight) * 0.4 + flight * 0.6;         // 溜めた力が解放され、終わりに向けて加速
        x = lerp(hand.x, target.x, e);
        y = lerp(hand.y, target.y, e);
      } else {
        y += Math.sin(ms * 0.013) * 1.8 * S;                        // 手元で小さく揺れる
      }
      return { x, y, r, flight };
    }

    // 金色の光の塊を描く（放射グラデーション）
    function glow(ctx, x, y, r, a, inner, mid, outer) {
      if (a <= 0.01 || r <= 0.5) return;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, rgba(inner, a));
      g.addColorStop(0.35, rgba(mid, a * 0.85));
      g.addColorStop(0.75, rgba(outer, a * 0.4));
      g.addColorStop(1, rgba(outer, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    // 球本体：白い芯 → 淡い黄 → 金 → 橙の縁 + 縁を回る光条 + 外側のにじみ
    function drawBall(ctx, ms, alpha) {
      const b = ballState(ms);
      if (alpha <= 0.01 || b.r <= 0.5) return b;
      const spin = ms * 0.011;
      ctx.globalCompositeOperation = 'lighter';
      // 外側のにじみ（大きく淡い金色のオーラ）
      glow(ctx, b.x, b.y, b.r * 2.8, alpha * 0.55, GOLD, AMBER, ORANGE);
      // 縁を回る光条（長短を交互に、ゆっくり回る）
      const rayN = 14;
      ctx.lineCap = 'round';
      for (let k = 0; k < rayN; k++) {
        const ra = spin + (k / rayN) * Math.PI * 2;
        const long = k % 2 === 0;
        const r0 = b.r * 1.02;
        const r1 = b.r * (long ? 1.62 : 1.34) * (0.92 + 0.08 * Math.sin(ms * 0.02 + k));
        ctx.strokeStyle = rgba(long ? PALE : GOLD, alpha * (long ? 0.8 : 0.6));
        ctx.lineWidth = Math.max(1, b.r * (long ? 0.075 : 0.05));
        ctx.shadowColor = rgba(GOLD, 0.9);
        ctx.shadowBlur = 8 * S;
        ctx.beginPath();
        ctx.moveTo(b.x + Math.cos(ra) * r0, b.y + Math.sin(ra) * r0);
        ctx.lineTo(b.x + Math.cos(ra) * r1, b.y + Math.sin(ra) * r1);
        ctx.stroke();
      }
      ctx.shadowBlur = 0;
      // 球の本体（縁を少し波打たせた輪郭。芯が白く、外へ向かって黄→金→橙）
      const segs = 32;
      ctx.beginPath();
      for (let s = 0; s <= segs; s++) {
        const aa = (s / segs) * Math.PI * 2;
        const bump = noise1(aa * 2.4 + spin * 2, seed) * b.r * 0.05;
        const rr = b.r + bump;
        const px = b.x + Math.cos(aa) * rr, py = b.y + Math.sin(aa) * rr;
        if (s === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r * 1.05);
      g.addColorStop(0, rgba(WHITE, alpha));
      g.addColorStop(0.3, rgba(PALE, alpha));
      g.addColorStop(0.62, rgba(GOLD, alpha * 0.95));
      g.addColorStop(0.88, rgba(AMBER, alpha * 0.8));
      g.addColorStop(1, rgba(ORANGE, alpha * 0.5));
      ctx.fillStyle = g;
      ctx.fill();
      // 球の中でゆらめく明るい塊（球が「燃えている」感じを出す）
      for (let k = 0; k < 2; k++) {
        const ka = spin * (2.2 + k) + k * 3.1;
        glow(ctx, b.x + Math.cos(ka) * b.r * 0.32, b.y + Math.sin(ka) * b.r * 0.32, b.r * 0.55, alpha * 0.5, WHITE, PALE, GOLD);
      }
      return b;
    }

    // 十字の光条（きらめき）
    function drawStar(ctx, x, y, size, a, color) {
      if (a <= 0.01 || size <= 0.5) return;
      ctx.save();
      ctx.translate(x, y);
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = rgba(color, a);
      ctx.shadowColor = rgba(color, 0.9);
      ctx.shadowBlur = size * 0.7;
      ctx.beginPath();
      ctx.moveTo(0, -size);
      ctx.quadraticCurveTo(size * 0.1, -size * 0.1, size, 0);
      ctx.quadraticCurveTo(size * 0.1, size * 0.1, 0, size);
      ctx.quadraticCurveTo(-size * 0.1, size * 0.1, -size, 0);
      ctx.quadraticCurveTo(-size * 0.1, -size * 0.1, 0, -size);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    // ============ ①気を溜める：外から球へ、金色の気が螺旋を描いて集まる ============
    // 球の周りにうっすら広がる金色のオーラ（溜めに合わせて膨らむ）
    particles.push({
      maxLife: FOCUSBLAST_LAUNCH_MS + 60,
      blend: 'lighter',
      draw(ctx, t) {
        const ms = t * (FOCUSBLAST_LAUNCH_MS + 60);
        const f = clamp01(ms / FOCUSBLAST_FORM_MS);
        const a = Math.sin(Math.PI * clamp01(t)) * 0.5;
        glow(ctx, hand.x, hand.y, lerp(14, 72, easeOutCubic(f)) * S, a, PALE, GOLD, AMBER);
      }
    });
    // 外から球へ吸い込まれる金色の光の筋（尾を引きながら螺旋）
    for (let i = 0; i < 26; i++) {
      const a0 = (i / 26) * Math.PI * 2 + rand(-0.25, 0.25);
      const r0 = rand(58, 108) * S;
      const sz = rand(1.9, 3.8) * S;
      const col = i % 3 === 0 ? PALE : (i % 3 === 1 ? GOLD : AMBER);
      particles.push({
        delay: rand(0, FOCUSBLAST_FORM_MS * 0.66),
        maxLife: rand(240, 340),
        blend: 'lighter',
        draw(ctx, t) {
          if (t >= 1) return;
          const e = easeInCubic(t);
          const rr = lerp(r0, BALL_R * 0.5, e);
          const spin = a0 + t * 3.4;
          const x = hand.x + Math.cos(spin) * rr;
          const y = hand.y + Math.sin(spin) * rr * 0.85;
          // 少し手前の位置（尾）
          const t2 = Math.max(0, t - 0.1);
          const rr2 = lerp(r0, BALL_R * 0.5, easeInCubic(t2));
          const spin2 = a0 + t2 * 3.4;
          const x2 = hand.x + Math.cos(spin2) * rr2;
          const y2 = hand.y + Math.sin(spin2) * rr2 * 0.85;
          const a = clamp01(t * 4) * (1 - Math.max(0, (t - 0.85) / 0.15));
          ctx.strokeStyle = rgba(col, a * 0.75);
          ctx.lineWidth = sz * 0.9;
          ctx.lineCap = 'round';
          ctx.shadowColor = rgba(col, 0.9);
          ctx.shadowBlur = 7 * S;
          ctx.beginPath();
          ctx.moveTo(x2, y2);
          ctx.lineTo(x, y);
          ctx.stroke();
          ctx.fillStyle = rgba(WHITE, a);
          ctx.beginPath();
          ctx.arc(x, y, sz, 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }
    // 外から球へ「縮んで」吸い込まれる光の輪（気を一点に集中させる：はどうだんの広がる輪と逆）
    for (let i = 0; i < 4; i++) {
      particles.push({
        delay: 60 + i * 150,
        maxLife: 380,
        blend: 'lighter',
        draw(ctx, t) {
          const r = lerp(BALL_R * 3.6, BALL_R * 0.9, easeInCubic(t));
          const a = Math.sin(Math.PI * clamp01(t)) * 0.7;
          ctx.strokeStyle = rgba(i % 2 === 0 ? GOLD : PALE, a);
          ctx.lineWidth = Math.max(1, 3 * S * (1 - t * 0.5));
          ctx.shadowColor = rgba(GOLD, 0.9);
          ctx.shadowBlur = 8 * S;
          ctx.beginPath();
          ctx.arc(hand.x, hand.y, r, 0, Math.PI * 2);
          ctx.stroke();
        }
      });
    }
    // 球が生まれる瞬間の小さな閃光
    particles.push({
      delay: 20,
      maxLife: 240,
      blend: 'lighter',
      draw(ctx, t) {
        glow(ctx, hand.x, hand.y, lerp(4 * S, 32 * S, easeOutQuint(t)), (1 - t) * 0.7, WHITE, GOLD, AMBER);
      }
    });

    // ============ ②溜め：放つ直前に、気が一点にぎゅっと詰まる ============
    // 縮んだ瞬間に球のまわりで金色の光が強く瞬く
    particles.push({
      delay: FOCUSBLAST_LAUNCH_MS - 70,
      maxLife: 200,
      blend: 'lighter',
      draw(ctx, t) {
        const a = Math.sin(Math.PI * clamp01(t)) * 0.85;
        glow(ctx, hand.x, hand.y, lerp(BALL_R * 1.4, BALL_R * 2.6, easeOutCubic(t)), a, WHITE, PALE, GOLD);
      }
    });

    // ============ ①②③球本体：溜め→脈動→飛翔を1つのパーティクルで描く ============
    // 命中の瞬間まで描き、命中と同時に消す（弾けるのは④が担当）。
    particles.push({
      delay: 40,
      maxLife: FOCUSBLAST_HIT_MS - 40,
      blend: 'lighter',
      draw(ctx, t) {
        const ms = 40 + t * (FOCUSBLAST_HIT_MS - 40);
        drawBall(ctx, ms, clamp01((ms - 40) / 120));
      }
    });

    // ============ ③飛翔中：球の後ろに引く金色の太い尾と、火の粉 ============
    particles.push({
      delay: FOCUSBLAST_LAUNCH_MS,
      maxLife: FOCUSBLAST_FLIGHT_MS + 120,
      blend: 'lighter',
      draw(ctx, t) {
        const ms = FOCUSBLAST_LAUNCH_MS + t * (FOCUSBLAST_FLIGHT_MS + 120);
        const afterHit = ms > FOCUSBLAST_HIT_MS;
        const tailFade = afterHit ? Math.max(0, 1 - (ms - FOCUSBLAST_HIT_MS) / 120) : 1;
        if (tailFade <= 0.01) return;
        const head = ballState(Math.min(ms, FOCUSBLAST_HIT_MS));
        if (head.flight <= 0) return;
        // 尾の先端：直近の位置を遡る（進行方向と逆へ太く伸びる）
        const tailMs = Math.min(ms, FOCUSBLAST_HIT_MS) - 140;
        const tail = ballState(Math.max(FOCUSBLAST_LAUNCH_MS, tailMs));
        const gr = ctx.createLinearGradient(tail.x, tail.y, head.x, head.y);
        gr.addColorStop(0, rgba(ORANGE, 0));
        gr.addColorStop(0.55, rgba(AMBER, 0.42 * tailFade));
        gr.addColorStop(1, rgba(PALE, 0.8 * tailFade));
        ctx.strokeStyle = gr;
        ctx.lineCap = 'round';
        ctx.lineWidth = head.r * 1.6;
        ctx.beginPath();
        ctx.moveTo(tail.x, tail.y);
        ctx.lineTo(head.x, head.y);
        ctx.stroke();
        // 白い芯の筋
        ctx.strokeStyle = rgba(WHITE, 0.5 * tailFade);
        ctx.lineWidth = Math.max(1, head.r * 0.4);
        ctx.beginPath();
        ctx.moveTo(lerp(tail.x, head.x, 0.35), lerp(tail.y, head.y, 0.35));
        ctx.lineTo(head.x, head.y);
        ctx.stroke();
      }
    });
    // 飛翔中に球からこぼれる金色の火の粉
    for (let i = 0; i < 16; i++) {
      const at = FOCUSBLAST_LAUNCH_MS + (i / 16) * FOCUSBLAST_FLIGHT_MS * 0.92;
      const off = rand(-1, 1);
      const col = i % 2 === 0 ? PALE : GOLD;
      particles.push({
        delay: at,
        maxLife: rand(220, 360),
        blend: 'lighter',
        draw(ctx, t) {
          const b = ballState(at);
          const px = -uy, py = ux;
          const x = b.x + px * off * b.r * 0.9 - ux * 18 * S * t;
          const y = b.y + py * off * b.r * 0.9 - uy * 18 * S * t + t * t * 10 * S;   // 火の粉は少し落ちる
          ctx.fillStyle = rgba(col, (1 - t) * 0.9);
          ctx.shadowColor = rgba(GOLD, 0.9);
          ctx.shadowBlur = 6 * S;
          ctx.beginPath();
          ctx.arc(x, y, 2.5 * S * (1 - t * 0.5), 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }

    // ============ ④命中：金色の光が大きく爆ぜる ============
    // 中心の白い閃光（ごく短く強い）
    particles.push({
      delay: FOCUSBLAST_HIT_MS - 10,
      maxLife: 280,
      blend: 'lighter',
      draw(ctx, t) {
        const a = Math.pow(1 - t, 1.4);
        glow(ctx, target.x, target.y, lerp(14 * S, 88 * S, easeOutQuint(t)), a * 0.95, WHITE, PALE, GOLD);
      }
    });
    // 広がる金色の大きな光（はどうだんより大きく、長く残る）
    particles.push({
      delay: FOCUSBLAST_HIT_MS,
      maxLife: 620,
      blend: 'lighter',
      draw(ctx, t) {
        const grow = easeOutCubic(clamp01(t / 0.3));
        const fade = t < 0.35 ? 1 : Math.pow(1 - (t - 0.35) / 0.65, 1.3);
        glow(ctx, target.x, target.y, 108 * S * grow, fade * 0.62, PALE, GOLD, ORANGE);
      }
    });
    // 広がる光の輪（金色の輪が3重）
    for (let i = 0; i < 3; i++) {
      particles.push({
        delay: FOCUSBLAST_HIT_MS + i * 65,
        maxLife: 460,
        blend: 'lighter',
        draw(ctx, t) {
          const r = lerp(12 * S, 100 * S, easeOutCubic(t));
          const a = (1 - t) * 0.9;
          ctx.strokeStyle = rgba(i === 0 ? WHITE : (i === 1 ? PALE : GOLD), a);
          ctx.lineWidth = Math.max(1, (6 - i) * S * (1 - t * 0.6));
          ctx.shadowColor = rgba(GOLD, 0.9);
          ctx.shadowBlur = 10 * S;
          ctx.beginPath();
          ctx.arc(target.x, target.y, r, 0, Math.PI * 2);
          ctx.stroke();
        }
      });
    }
    // 足元へ広がる平たい衝撃波（重い一撃であることを示す。画面は揺らさない）
    particles.push({
      delay: FOCUSBLAST_HIT_MS + 20,
      maxLife: 480,
      blend: 'lighter',
      draw(ctx, t) {
        const r = lerp(16 * S, 112 * S, easeOutCubic(t));
        const a = (1 - t) * 0.7;
        if (a <= 0.01) return;
        ctx.save();
        ctx.translate(target.x, target.y + 16 * S);
        ctx.scale(1, 0.34);
        ctx.strokeStyle = rgba(AMBER, a);
        ctx.lineWidth = Math.max(1.5, 8 * S * (1 - t * 0.6));
        ctx.shadowColor = rgba(GOLD, 0.9);
        ctx.shadowBlur = 10 * S;
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    });
    // 四方へ走る光条（放射状の線）
    const rayN = 12;
    for (let i = 0; i < rayN; i++) {
      const ra = (i / rayN) * Math.PI * 2 + rand(-0.12, 0.12);
      const rl = rand(62, 118) * S;
      particles.push({
        delay: FOCUSBLAST_HIT_MS + rand(0, 30),
        maxLife: rand(260, 400),
        blend: 'lighter',
        draw(ctx, t) {
          const e = easeOutCubic(t);
          const inner = lerp(6 * S, rl * 0.5, e);
          const outer = lerp(16 * S, rl, e);
          ctx.strokeStyle = rgba(i % 2 === 0 ? PALE : GOLD, (1 - t) * 0.9);
          ctx.lineWidth = Math.max(1, 3.6 * S * (1 - t));
          ctx.lineCap = 'round';
          ctx.shadowColor = rgba(GOLD, 0.9);
          ctx.shadowBlur = 8 * S;
          ctx.beginPath();
          ctx.moveTo(target.x + Math.cos(ra) * inner, target.y + Math.sin(ra) * inner);
          ctx.lineTo(target.x + Math.cos(ra) * outer, target.y + Math.sin(ra) * outer);
          ctx.stroke();
        }
      });
    }
    // 飛び散る金色の火の粉（重力で少し落ちる）
    for (let i = 0; i < 30; i++) {
      const col = i % 3 === 0 ? WHITE : (i % 3 === 1 ? PALE : GOLD);
      const sa = rand(0, Math.PI * 2);
      const spd = rand(36, 118) * S;
      const dotR = rand(1.5, 3.4) * S;
      particles.push({
        delay: FOCUSBLAST_HIT_MS + rand(0, 70),
        maxLife: rand(300, 520),
        blend: 'lighter',
        draw(ctx, t) {
          const e = easeOutCubic(t);
          const x = target.x + Math.cos(sa) * spd * e;
          const y = target.y + Math.sin(sa) * spd * e + t * t * 22 * S;
          ctx.fillStyle = rgba(col, (1 - t) * 0.92);
          ctx.shadowColor = rgba(GOLD, 0.9);
          ctx.shadowBlur = 6;
          ctx.beginPath();
          ctx.arc(x, y, dotR * (1 - t * 0.4), 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }

    // ============ ⑤余韻：金色の火の粉がきらめきながら舞い落ちる ============
    particles.push({
      delay: FOCUSBLAST_HIT_MS + 60,
      maxLife: 460,
      blend: 'lighter',
      draw(ctx, t) {
        const a = Math.sin(Math.PI * clamp01(t)) * 0.85;
        drawStar(ctx, target.x, target.y, lerp(8 * S, 54 * S, easeOutCubic(t)), a, WHITE);
      }
    });
    for (let i = 0; i < 10; i++) {
      const sa = rand(0, Math.PI * 2);
      const dd = rand(18, 66) * S;
      particles.push({
        delay: FOCUSBLAST_HIT_MS + 130 + rand(0, 170),
        maxLife: rand(340, 520),
        blend: 'lighter',
        draw(ctx, t) {
          const e = easeOutCubic(t);
          const x = target.x + Math.cos(sa) * dd * e;
          const y = target.y + Math.sin(sa) * dd * e - 14 * S * e + t * t * 20 * S;   // ふわりと浮いてから落ちる
          drawStar(ctx, x, y, lerp(2, 8, Math.sin(Math.PI * clamp01(t))) * S, (1 - t) * 0.88, i % 2 ? PALE : GOLD);
        }
      });
    }
  }

  // ============================================================
  // はどうだん：両手の間に水色の波動を集めて球にし、相手へ撃ち出して命中させる演出
  // （ダイヤモンド・パール版準拠：球は「水色〜白」の明るい光の塊。シャドーボールの暗い球とは正反対で、
  //   すべて加算合成（lighter）の発光で描く。画面シェイクなし）
  // 構成：①攻撃側の前に水色の波動の粒が渦を巻いて集まり、小さな光の球が生まれて膨らむ（収束）
  //       ②球が眩く脈打ち、周囲に水色のオーラのリングが広がる（溜め）
  //       ③球が水色の光の尾を引きながら、相手へ一直線に飛ぶ（発射。はどうだんは必中＝迷わず一直線）
  //       ④命中の瞬間、水色の光が爆ぜて光の輪と光条が四方へ走る（炸裂）
  //       ⑤水色の光の粒がきらめきながら舞い散る（余韻）
  // 見た目の肝：「白い芯 → 明るい水色 → 濃い青の縁」の三層グラデーション、球の周りを回る細い水色の環、
  //             飛翔中の尾が「波動」らしく細長く伸びること。
  //
  // info = { from:{x,y}, to:{x,y}, scale } は spawnShadowBallSpecial と同じ（playSpecialTypeEffect が実測）。
  // ============================================================
  const AURASPHERE_FORM_MS = 520;      // ①収束：波動が集まって球が膨らむ
  const AURASPHERE_HOLD_MS = 160;      // ②溜め：球が眩く脈打ってから放つまで
  const AURASPHERE_FLIGHT_MS = 300;    // ③球が手元→相手へ届くまで（はどうだんは速い）
  const AURASPHERE_LAUNCH_MS = AURASPHERE_FORM_MS + AURASPHERE_HOLD_MS;   // 球を放つ時刻
  // 球が相手に届く（＝ダメージの瞬間）。フラッシュ等はこの時刻に合わせる。
  const AURASPHERE_HIT_MS = AURASPHERE_LAUNCH_MS + AURASPHERE_FLIGHT_MS;
  const AURASPHERE_END_MS = AURASPHERE_HIT_MS + 680;

  // ============================================================
  // じしん（attack203）専用大技エフェクト：全画面演出（XY版準拠）
  // wrapEl には battle-field 全体（画面全体）が渡される想定。
  // 構成：①予兆：画面全体がわずかに縦揺れしながら地面ラインに細かいヒビが走る
  //       ②本震：画面全域の地面に太い亀裂が扇状かつ左右に走り、土煙が巻き上がる
  //       ③複数の岩柱が時間差で画面各所の地面から突き上がる
  //       ④舞い上がる無数の土塊・砂粒が画面全体に飛散し、土色のフラッシュで覆う
  //       ⑤余韻：土煙がゆっくり晴れていく
  // 「画面全体が舞台」「亀裂は一箇所からでなく地面全体に横並びで走る」
  // 「岩柱が複数箇所からタイミングをずらして突き上がる」のがXY版の特徴。
  // ============================================================
  const QUAKE_PRE_MS = 220;        // ①予兆の縦揺れ・細かいヒビ
  const QUAKE_CRACK_MS = 340;      // ②本震：亀裂が地面全体に走る
  const QUAKE_PILLAR_MS = 520;     // ③岩柱が突き上がる尺
  const QUAKE_PILLAR_START_MS = QUAKE_PRE_MS + 60;
  const QUAKE_DUST_PEAK_MS = QUAKE_PILLAR_START_MS + 160;
  const QUAKE_END_MS = QUAKE_PILLAR_START_MS + QUAKE_PILLAR_MS + 720;

  function spawnEarthquakeSpecial(particles, w, h) {
    const groundY = h * 0.86;

    // ---- ①予兆：地面ラインに細かいヒビが素早く走る（本震の前触れ）----
    for (let i = 0; i < 6; i++) {
      const x0 = rand(w * 0.05, w * 0.95);
      const ang = rand(-0.3, 0.3);
      particles.push({
        delay: i * 18,
        maxLife: QUAKE_PRE_MS,
        draw(ctx, t) {
          const len = lerp(4, w * 0.09, easeOutCubic(t));
          const alpha = (1 - t) * 0.7;
          ctx.save();
          ctx.translate(x0, groundY);
          ctx.rotate(ang);
          ctx.strokeStyle = rgba('#5a3f1e', alpha);
          ctx.lineWidth = 2;
          ctx.beginPath();
          zigzagPath(ctx, 0, 0, len, 0, 3, 3);
          ctx.stroke();
          ctx.restore();
        }
      });
    }

    // ---- ②本震：地面全体に太い亀裂が扇状かつ横並びに何本も走る ----
    const crackCount = 10;
    const crackPaths = [];
    for (let i = 0; i < crackCount; i++) {
      const x0 = (i + 0.5) / crackCount * w + rand(-w * 0.03, w * 0.03);
      const dir = rand(-1, 1);
      const len = rand(w * 0.1, w * 0.18);
      const path = [];
      let cx = x0, cy = groundY;
      const segs = 6;
      for (let s = 0; s <= segs; s++) {
        path.push([cx, cy]);
        cx += (dir * len / segs) + rand(-8, 8);
        cy += rand(-4, 10);
      }
      crackPaths.push(path);
      particles.push({
        delay: QUAKE_PRE_MS + rand(0, 120),
        maxLife: QUAKE_CRACK_MS + 380,
        path,
        draw(ctx, t) {
          const grow = clamp01(t / 0.35);
          const cut = Math.max(2, Math.floor(this.path.length * grow));
          const alpha = t < 0.55 ? 1 : (1 - (t - 0.55) / 0.45);
          ctx.save();
          ctx.strokeStyle = rgba('#4a3016', alpha);
          ctx.lineWidth = 5;
          ctx.lineJoin = 'round';
          ctx.beginPath();
          this.path.slice(0, cut).forEach(([px, py], k) => k === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py));
          ctx.stroke();
          ctx.strokeStyle = rgba('#ffcf7a', alpha * 0.85);
          ctx.lineWidth = 1.6;
          ctx.shadowColor = rgba('#ffcf7a', 0.7);
          ctx.shadowBlur = 6;
          ctx.beginPath();
          this.path.slice(0, cut).forEach(([px, py], k) => k === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py));
          ctx.stroke();
          ctx.restore();
        }
      });
    }
    // 地面ライン全体（横一直線）を強調する太い基準線（亀裂が走る土台）
    particles.push({
      delay: QUAKE_PRE_MS,
      maxLife: QUAKE_CRACK_MS + 260,
      draw(ctx, t) {
        const alpha = (1 - Math.max(0, (t - 0.5) / 0.5)) * 0.5;
        ctx.strokeStyle = rgba('#3a2510', alpha);
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(0, groundY);
        ctx.lineTo(w, groundY);
        ctx.stroke();
      }
    });

    // ---- ③複数の岩柱：画面各所の地面から時間差で突き上がる ----
    const pillarCount = 6;
    for (let i = 0; i < pillarCount; i++) {
      const x0 = (i + 0.5) / pillarCount * w + rand(-w * 0.03, w * 0.03);
      const delay = QUAKE_PILLAR_START_MS + rand(0, 260);
      const height = h * rand(0.22, 0.42);
      const width = rand(w * 0.05, w * 0.085);
      particles.push({
        delay,
        maxLife: QUAKE_PILLAR_MS + 240,
        x0, height, width,
        draw(ctx, t) {
          const rise = easeOutQuint(clamp01(t / 0.42));
          const settle = t > 0.55 ? Math.sin((t - 0.55) / 0.45 * Math.PI) * 6 : 0; // 突き上がった後の微揺れ
          const h0 = this.height * rise;
          const alpha = 1 - Math.max(0, (t - 0.72) / 0.28);
          ctx.save();
          ctx.translate(settle, 0);
          // 岩柱本体
          const grad = ctx.createLinearGradient(this.x0 - this.width / 2, 0, this.x0 + this.width / 2, 0);
          grad.addColorStop(0, rgba('#5c3f1e', alpha));
          grad.addColorStop(0.5, rgba('#8a6530', alpha));
          grad.addColorStop(1, rgba('#4a3016', alpha));
          ctx.fillStyle = grad;
          ctx.fillRect(this.x0 - this.width / 2, groundY - h0, this.width, h0 + 20);
          // 頂部の明るいハイライト（割れた岩肌）
          ctx.fillStyle = rgba('#c79a5b', alpha);
          ctx.beginPath();
          ctx.moveTo(this.x0 - this.width / 2, groundY - h0);
          ctx.lineTo(this.x0, groundY - h0 - 14 * rise);
          ctx.lineTo(this.x0 + this.width / 2, groundY - h0);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        }
      });
      // 岩柱が突き上がる瞬間、根元から砂煙が弾ける
      particles.push({
        delay,
        maxLife: 340,
        x0,
        draw(ctx, t) {
          const alpha = (1 - t) * 0.6;
          const r = lerp(6, w * 0.09, easeOutCubic(t));
          const grad = ctx.createRadialGradient(this.x0, groundY, 0, this.x0, groundY, r);
          grad.addColorStop(0, rgba('#d8b784', alpha));
          grad.addColorStop(1, 'rgba(160,120,60,0)');
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.ellipse(this.x0, groundY, r, r * 0.35, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }

    // ---- ④画面全体に舞い上がる土塊・砂粒 ----
    for (let i = 0; i < 46; i++) {
      const x0 = rand(w * 0.02, w * 0.98);
      const vUp = rand(h * 0.2, h * 0.55);
      particles.push({
        delay: QUAKE_PILLAR_START_MS + rand(0, 320),
        maxLife: rand(360, 620),
        x0, vUp,
        vx: rand(-1, 1) * 26,
        size: rand(3, 9),
        rot: rand(0, Math.PI * 2),
        col: pick(['#a0783c', '#8a6530', '#c79a5b', '#5c3f1e']),
        draw(ctx, t) {
          const rise = easeOutCubic(Math.min(1, t * 1.6));
          const fall = t > 0.5 ? easeInCubic((t - 0.5) / 0.5) : 0;
          const y = groundY - this.vUp * rise + fall * this.vUp * 0.8;
          const x = this.x0 + this.vx * t;
          const alpha = 1 - Math.max(0, (t - 0.75) / 0.25);
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(this.rot + t * 5);
          ctx.fillStyle = rgba(this.col, alpha);
          ctx.fillRect(-this.size / 2, -this.size / 2, this.size, this.size);
          ctx.restore();
        }
      });
    }

    // 画面全体を覆う土煙（横に広い楕円グラデーションを複数重ねる）
    for (let i = 0; i < 3; i++) {
      const cx = (i + 0.5) / 3 * w;
      particles.push({
        delay: QUAKE_PILLAR_START_MS + i * 60,
        maxLife: QUAKE_END_MS - QUAKE_PILLAR_START_MS,
        cx,
        draw(ctx, t) {
          const grow = easeOutCubic(clamp01(t / 0.4));
          const fade = t < 0.4 ? 1 : Math.pow(1 - (t - 0.4) / 0.6, 1.2);
          const r = w * (0.22 + grow * 0.16);
          const grad = ctx.createRadialGradient(this.cx, groundY, 0, this.cx, groundY, r);
          grad.addColorStop(0, rgba('#c9a06a', fade * 0.5));
          grad.addColorStop(1, 'rgba(160,120,60,0)');
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.ellipse(this.cx, groundY - r * 0.15, r, r * 0.5, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }

    // ---- 土色の全画面フラッシュ（土埃が最も舞い上がる瞬間、視界を茶色く霞ませる）----
    particles.push({
      delay: QUAKE_DUST_PEAK_MS,
      maxLife: 380,
      blend: 'source-over',
      draw(ctx, t) {
        const alpha = Math.sin(Math.PI * clamp01(t)) * 0.28;
        ctx.fillStyle = rgba('#b08a4e', alpha);
        ctx.fillRect(0, 0, w, h);
      }
    });
  }

  // ============================================================
  // 「きば」系技 共通演出：かみなりのキバ(attack61)／こおりのキバ(attack222)／ほのおのキバ(attack124)
  // 原作共通の構成：口元に属性のエネルギーを纏った鋭い牙が2本浮かび上がり、
  // 一瞬で相手へ肉薄して噛みつき、噛みついた属性のエフェクト（電撃／冷気／火炎）が
  // 命中の瞬間に弾ける。属性ごとに色・質感・追加エフェクトだけを差し替える。
  //   ①予備動作：口元に牙が浮かび上がり、属性の粒子を纏う
  //   ②突進：牙が白い残像を引きながら一瞬で相手へ到達
  //   ③噛みつき：牙が相手にめり込み、属性エフェクトが炸裂
  //   ④引き戻し：牙がすっと消える
  // ============================================================
  const FANG_FORM_MS = 260;      // ①牙が浮かび上がる
  const FANG_DASH_MS = 160;      // ②突進
  const FANG_BITE_MS = FANG_FORM_MS + FANG_DASH_MS;   // 噛みつく時刻
  const FANG_LINGER_MS = 220;    // ③噛みついたまま少し留まる
  const FANG_END_MS = FANG_BITE_MS + FANG_LINGER_MS + 560;

  // 牙の形（単位座標。+x が噛みつく方向）。上下2本の鋭い三角形が挟み込む。
  function fangPath(ctx) {
    ctx.moveTo(-0.5, -0.62);
    ctx.lineTo(0.55, -0.08);
    ctx.lineTo(-0.5, -0.2);
    ctx.closePath();
    ctx.moveTo(-0.5, 0.62);
    ctx.lineTo(0.55, 0.08);
    ctx.lineTo(-0.5, 0.2);
    ctx.closePath();
  }

  // theme: { core, main, deep, name } の配色と、attach() で属性固有のパーティクルを追加する関数
  function spawnFangSpecial(particles, w, h, info, theme) {
    const from = (info && info.from) || { x: w * 0.28, y: h * 0.68 };
    const to = (info && info.to) || { x: w * 0.72, y: h * 0.32 };
    const S = (info && info.scale) || 1;

    const dx = to.x - from.x, dy = to.y - from.y;
    const dist = Math.hypot(dx, dy) || 1;
    const ux = dx / dist, uy = dy / dist;
    const perpX = -uy, perpY = ux;
    const ang = Math.atan2(dy, dx);

    const mouth = { x: from.x + ux * 30 * S, y: from.y + uy * 30 * S };
    const target = { x: to.x - ux * 14 * S, y: to.y - uy * 14 * S };
    const FANG_R = 30 * S;

    function fangState(ms) {
      if (ms < FANG_FORM_MS) {
        const f = clamp01(ms / FANG_FORM_MS);
        return { x: mouth.x, y: mouth.y, sc: 0.3 + 0.7 * easeOutCubic(f), alpha: clamp01(ms / 100) };
      }
      if (ms < FANG_BITE_MS) {
        const f = clamp01((ms - FANG_FORM_MS) / FANG_DASH_MS);
        const e = easeInCubic(f);
        return { x: lerp(mouth.x, target.x, e), y: lerp(mouth.y, target.y, e), sc: lerp(1, 1.15, f), alpha: 1 };
      }
      const p = clamp01((ms - FANG_BITE_MS) / FANG_LINGER_MS);
      return { x: target.x, y: target.y, sc: 1.15 - 0.1 * p, alpha: 1 - Math.pow(p, 2) };
    }

    function drawFang(ctx, st, ms) {
      if (st.alpha <= 0.01 || st.sc <= 0.05) return;
      const R = FANG_R * st.sc;
      ctx.save();
      ctx.translate(st.x, st.y);
      ctx.rotate(ang);
      ctx.scale(R, R);
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineJoin = 'round';
      // 塗り
      const gf = ctx.createLinearGradient(-0.5, 0, 0.55, 0);
      gf.addColorStop(0, rgba(theme.deep, 0));
      gf.addColorStop(0.4, rgba(theme.main, 0.35 * st.alpha));
      gf.addColorStop(1, rgba(theme.core, 0.75 * st.alpha));
      ctx.fillStyle = gf;
      ctx.beginPath();
      fangPath(ctx);
      ctx.fill();
      // 縁の発光
      ctx.strokeStyle = rgba(theme.main, 0.7 * st.alpha);
      ctx.lineWidth = 0.06;
      ctx.shadowColor = rgba(theme.main, 0.9);
      ctx.shadowBlur = 8 * S;
      ctx.beginPath();
      fangPath(ctx);
      ctx.stroke();
      // 先端のハイライト
      ctx.strokeStyle = rgba(theme.core, 0.9 * st.alpha);
      ctx.lineWidth = 0.035;
      ctx.shadowBlur = 0;
      ctx.beginPath();
      fangPath(ctx);
      ctx.stroke();
      ctx.restore();
    }

    // ---- ①予備動作：口元に牙が浮かび上がる淡い発光 ----
    particles.push({
      delay: 0,
      maxLife: FANG_FORM_MS + 60,
      blend: 'lighter',
      draw(ctx, t) {
        const ms = t * (FANG_FORM_MS + 60);
        const f = clamp01(ms / FANG_FORM_MS);
        const a = Math.sin(Math.PI * clamp01(t)) * 0.5;
        const r = lerp(8, FANG_R * 1.4, easeOutCubic(f)) * S;
        const g = ctx.createRadialGradient(mouth.x, mouth.y, 0, mouth.x, mouth.y, r);
        g.addColorStop(0, rgba(theme.core, a));
        g.addColorStop(0.5, rgba(theme.main, a * 0.7));
        g.addColorStop(1, rgba(theme.deep, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(mouth.x, mouth.y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    });

    // ---- ②③④牙本体：浮かび上がる→突進→噛みつく→消える ----
    particles.push({
      delay: 20,
      maxLife: FANG_BITE_MS + FANG_LINGER_MS - 20,
      blend: 'lighter',
      draw(ctx, t) {
        const ms = 20 + t * (FANG_BITE_MS + FANG_LINGER_MS - 20);
        const st = fangState(ms);
        // 突進中：白い速度線の残像
        if (ms >= FANG_FORM_MS && ms < FANG_BITE_MS) {
          const reach = 30 * S;
          for (let j = -1; j <= 1; j++) {
            const ox = perpX * j * FANG_R * 0.35, oy = perpY * j * FANG_R * 0.35;
            const gr = ctx.createLinearGradient(st.x + ox, st.y + oy, st.x - ux * reach + ox, st.y - uy * reach + oy);
            gr.addColorStop(0, rgba('#ffffff', 0.6));
            gr.addColorStop(1, rgba(theme.main, 0));
            ctx.strokeStyle = gr;
            ctx.lineWidth = Math.max(1, 1.6 * S);
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(st.x + ox, st.y + oy);
            ctx.lineTo(st.x - ux * reach + ox, st.y - uy * reach + oy);
            ctx.stroke();
          }
        }
        drawFang(ctx, st, ms);
      }
    });

    // ---- ③噛みついた瞬間：白い芯のフラッシュ＋属性色の衝撃波 ----
    particles.push({
      delay: FANG_BITE_MS - 10,
      maxLife: 240,
      blend: 'lighter',
      draw(ctx, t) {
        const a = Math.pow(1 - t, 1.5);
        const r = lerp(8 * S, 44 * S, easeOutQuint(t));
        const g = ctx.createRadialGradient(target.x, target.y, 0, target.x, target.y, r);
        g.addColorStop(0, rgba('#ffffff', a * 0.9));
        g.addColorStop(0.45, rgba(theme.main, a * 0.75));
        g.addColorStop(1, rgba(theme.deep, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(target.x, target.y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    for (let i = 0; i < 2; i++) {
      particles.push({
        delay: FANG_BITE_MS + i * 50,
        maxLife: 360,
        blend: 'lighter',
        draw(ctx, t) {
          const e = easeOutCubic(t);
          const r = FANG_R * (0.7 + e * 2.2);
          const alpha = (1 - t) * 0.45;
          ctx.strokeStyle = rgba(theme.main, alpha);
          ctx.lineWidth = Math.max(1, 2.6 * S * (1 - t * 0.5));
          ctx.shadowColor = rgba(theme.core, 0.8);
          ctx.shadowBlur = 10 * S;
          ctx.beginPath();
          ctx.arc(target.x, target.y, r, 0, Math.PI * 2);
          ctx.stroke();
        }
      });
    }

    // 属性固有の追加演出（電撃の火花／冷気の結晶／火炎の粉）
    if (theme.attach) theme.attach(particles, target, FANG_BITE_MS, S, from, mouth, ang);
  }

  // かみなりのキバ：黄色い電撃の牙。噛みついた瞬間、細かい電撃のスパークが弾ける
  function spawnThunderFangSpecial(particles, w, h, info) {
    spawnFangSpecial(particles, w, h, info, {
      core: '#fff9c4', main: '#ffe600', deep: '#a87f00',
      attach(particles, target, hitMs, S) {
        for (let i = 0; i < 10; i++) {
          const a0 = rand(0, Math.PI * 2);
          particles.push({
            delay: hitMs + rand(0, 60),
            maxLife: rand(160, 260),
            draw(ctx, t) {
              const e = t;
              const len = lerp(4, 24, e) * S;
              ctx.strokeStyle = rgba('#fff9c4', (1 - t) * 0.9);
              ctx.lineWidth = Math.max(1, 1.6 * S);
              ctx.shadowColor = rgba('#ffe600', 0.9);
              ctx.shadowBlur = 6 * S;
              ctx.beginPath();
              ctx.moveTo(target.x, target.y);
              ctx.lineTo(target.x + Math.cos(a0) * len, target.y + Math.sin(a0) * len * 0.7);
              ctx.stroke();
            }
          });
        }
      }
    });
  }

  // こおりのキバ：水色の冷気の牙。噛みついた瞬間、鋭い氷の結晶片が飛び散り白い霜が広がる
  function spawnIceFangSpecial(particles, w, h, info) {
    spawnFangSpecial(particles, w, h, info, {
      core: '#ffffff', main: '#8fe0ff', deep: '#1f6fa8',
      attach(particles, target, hitMs, S) {
        for (let i = 0; i < 8; i++) {
          const a0 = rand(0, Math.PI * 2);
          const dist = rand(14, 30) * S;
          particles.push({
            delay: hitMs + rand(0, 60),
            maxLife: rand(280, 420),
            rot: rand(0, Math.PI * 2),
            draw(ctx, t) {
              const e = easeOutCubic(t);
              const x = target.x + Math.cos(a0) * dist * e;
              const y = target.y + Math.sin(a0) * dist * e;
              const alpha = (1 - t) * 0.9;
              ctx.save();
              ctx.translate(x, y);
              ctx.rotate(this.rot + t * 3);
              ctx.fillStyle = rgba('#dff6ff', alpha);
              ctx.strokeStyle = rgba('#8fe0ff', alpha);
              ctx.lineWidth = 1;
              ctx.beginPath();
              ctx.moveTo(0, -5 * S); ctx.lineTo(2 * S, 0); ctx.lineTo(0, 5 * S); ctx.lineTo(-2 * S, 0);
              ctx.closePath();
              ctx.fill();
              ctx.stroke();
              ctx.restore();
            }
          });
        }
        // 白い霜のもや
        particles.push({
          delay: hitMs,
          maxLife: 420,
          draw(ctx, t) {
            const alpha = (1 - t) * 0.35;
            const r = lerp(6, 40, easeOutCubic(t)) * S;
            const g = ctx.createRadialGradient(target.x, target.y, 0, target.x, target.y, r);
            g.addColorStop(0, rgba('#ffffff', alpha));
            g.addColorStop(1, 'rgba(143,224,255,0)');
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(target.x, target.y, r, 0, Math.PI * 2);
            ctx.fill();
          }
        });
      }
    });
  }

  // ほのおのキバ：赤橙の火炎の牙。噛みついた瞬間、火の粉が舞い上がり短く炎が揺らめく
  function spawnFireFangSpecial(particles, w, h, info) {
    spawnFangSpecial(particles, w, h, info, {
      core: '#fff3b0', main: '#ff7a1a', deep: '#a8330a',
      attach(particles, target, hitMs, S) {
        for (let i = 0; i < 10; i++) {
          const sx = rand(-8, 8) * S;
          const rise = rand(16, 34) * S;
          particles.push({
            delay: hitMs + rand(0, 70),
            maxLife: rand(260, 400),
            draw(ctx, t) {
              const x = target.x + sx - t * 6 * S;
              const y = target.y - rise * easeOutCubic(t);
              const a = Math.sin(Math.PI * clamp01(t)) * 0.85;
              ctx.fillStyle = rgba(i % 2 ? '#ff7a1a' : '#fff3b0', a);
              ctx.shadowColor = rgba('#ff4d1a', 0.9);
              ctx.shadowBlur = 6 * S;
              ctx.beginPath();
              ctx.arc(x, y, 2.2 * S * (1 - t * 0.4), 0, Math.PI * 2);
              ctx.fill();
            }
          });
        }
      }
    });
  }

  // ============================================================
  // 「噛みつき」系技 共通演出：きゅうけつ(attack7)／かみつく(attack24)／かみくだく(attack25)
  // 「きば」系（浮遊する2本の牙が突進する）とは違い、こちらは大きく開いた「口」その
  // ものが相手に迫って噛みつく演出。タイミング定数はFANG_*系をそのまま流用し、
  // 噛みつき動作の統一感を保つ。
  //   ①予備動作：口元が属性色にぎらりと発光する
  //   ②突進：牙型のシルエット（大きく開いた顎）が白い残像を引いて肉薄
  //   ③噛みつき：着弾の瞬間に閃光＋衝撃波、属性固有の追加演出
  //   ④引き戻し：スッと消える
  // ============================================================

  // 大きく開いた顎のシルエット（単位座標。+x が噛みつく方向）。fangPathより厚みがあり、
  // 上下の牙の間隔も広い＝「がぶっ」と大きく噛みつく印象を出す。
  function bitePath(ctx) {
    ctx.moveTo(-0.5, -0.78);
    ctx.lineTo(0.5, -0.14);
    ctx.lineTo(0.2, -0.14);
    ctx.lineTo(0.5, -0.04);
    ctx.lineTo(-0.5, -0.26);
    ctx.closePath();
    ctx.moveTo(-0.5, 0.78);
    ctx.lineTo(0.5, 0.14);
    ctx.lineTo(0.2, 0.14);
    ctx.lineTo(0.5, 0.04);
    ctx.lineTo(-0.5, 0.26);
    ctx.closePath();
  }

  // theme: { core, main, deep, attach } の配色と、attach() で属性固有の追加演出を差し込む。
  // spawnFangSpecial と共通のFANG_*タイミングを使うが、牙の形をbitePathに変えて
  // 「大顎で噛みつく」見た目にしている。
  function spawnBiteSpecial(particles, w, h, info, theme) {
    const from = (info && info.from) || { x: w * 0.28, y: h * 0.68 };
    const to = (info && info.to) || { x: w * 0.72, y: h * 0.32 };
    const S = (info && info.scale) || 1;

    const dx = to.x - from.x, dy = to.y - from.y;
    const dist = Math.hypot(dx, dy) || 1;
    const ux = dx / dist, uy = dy / dist;
    const ang = Math.atan2(dy, dx);

    const mouth = { x: from.x + ux * 30 * S, y: from.y + uy * 30 * S };
    const target = { x: to.x - ux * 14 * S, y: to.y - uy * 14 * S };
    const BITE_R = 34 * S;

    function biteState(ms) {
      if (ms < FANG_FORM_MS) {
        const f = clamp01(ms / FANG_FORM_MS);
        return { x: mouth.x, y: mouth.y, sc: 0.25 + 0.6 * easeOutCubic(f), alpha: clamp01(ms / 100) };
      }
      if (ms < FANG_BITE_MS) {
        const f = clamp01((ms - FANG_FORM_MS) / FANG_DASH_MS);
        const e = easeInCubic(f);
        return { x: lerp(mouth.x, target.x, e), y: lerp(mouth.y, target.y, e), sc: lerp(0.85, 1.2, f), alpha: 1 };
      }
      const p = clamp01((ms - FANG_BITE_MS) / FANG_LINGER_MS);
      return { x: target.x, y: target.y, sc: 1.2 - 0.15 * p, alpha: 1 - Math.pow(p, 2) };
    }

    function drawBite(ctx, st) {
      if (st.alpha <= 0.01 || st.sc <= 0.05) return;
      const R = BITE_R * st.sc;
      ctx.save();
      ctx.translate(st.x, st.y);
      ctx.rotate(ang);
      ctx.scale(R, R);
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineJoin = 'round';
      const gf = ctx.createLinearGradient(-0.5, 0, 0.5, 0);
      gf.addColorStop(0, rgba(theme.deep, 0));
      gf.addColorStop(0.45, rgba(theme.main, 0.32 * st.alpha));
      gf.addColorStop(1, rgba(theme.core, 0.7 * st.alpha));
      ctx.fillStyle = gf;
      ctx.beginPath();
      bitePath(ctx);
      ctx.fill();
      ctx.strokeStyle = rgba(theme.main, 0.65 * st.alpha);
      ctx.lineWidth = 0.05;
      ctx.shadowColor = rgba(theme.main, 0.85);
      ctx.shadowBlur = 7 * S;
      ctx.beginPath();
      bitePath(ctx);
      ctx.stroke();
      ctx.strokeStyle = rgba(theme.core, 0.85 * st.alpha);
      ctx.lineWidth = 0.03;
      ctx.shadowBlur = 0;
      ctx.beginPath();
      bitePath(ctx);
      ctx.stroke();
      ctx.restore();
    }

    // ①予備動作：口元の発光
    particles.push({
      delay: 0,
      maxLife: FANG_FORM_MS + 60,
      blend: 'lighter',
      draw(ctx, t) {
        const ms = t * (FANG_FORM_MS + 60);
        const f = clamp01(ms / FANG_FORM_MS);
        const a = Math.sin(Math.PI * clamp01(t)) * 0.45;
        const r = lerp(8, BITE_R * 1.3, easeOutCubic(f)) * S;
        const g = ctx.createRadialGradient(mouth.x, mouth.y, 0, mouth.x, mouth.y, r);
        g.addColorStop(0, rgba(theme.core, a));
        g.addColorStop(0.5, rgba(theme.main, a * 0.65));
        g.addColorStop(1, rgba(theme.deep, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(mouth.x, mouth.y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    });

    // ②③④大顎本体
    particles.push({
      delay: 20,
      maxLife: FANG_BITE_MS + FANG_LINGER_MS - 20,
      blend: 'lighter',
      draw(ctx, t) {
        const ms = 20 + t * (FANG_BITE_MS + FANG_LINGER_MS - 20);
        const st = biteState(ms);
        drawBite(ctx, st);
      }
    });

    // ③噛みついた瞬間：白い芯のフラッシュ
    particles.push({
      delay: FANG_BITE_MS - 10,
      maxLife: 240,
      blend: 'lighter',
      draw(ctx, t) {
        const a = Math.pow(1 - t, 1.5);
        const r = lerp(8 * S, 46 * S, easeOutQuint(t));
        const g = ctx.createRadialGradient(target.x, target.y, 0, target.x, target.y, r);
        g.addColorStop(0, rgba('#ffffff', a * 0.9));
        g.addColorStop(0.45, rgba(theme.main, a * 0.7));
        g.addColorStop(1, rgba(theme.deep, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(target.x, target.y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    });

    if (theme.attach) theme.attach(particles, target, FANG_BITE_MS, S, from, mouth, ang);
  }

  // きゅうけつ：あく色の牙で噛みつき、命中の瞬間に相手からHPを表す赤い粒子が
  // 吸い出されて攻撃側（from）へ吸い込まれていく。原作の「体力を奪う」印象を再現。
  function spawnLeechBiteSpecial(particles, w, h, info) {
    spawnBiteSpecial(particles, w, h, info, {
      core: '#ffb3b3', main: '#c23b4a', deep: '#3a0d14',
      attach(particles, target, hitMs, S, from) {
        const src = from || target;
        // 命中直後：赤黒い靄が噛みついた場所に滲む
        particles.push({
          delay: hitMs,
          maxLife: 300,
          draw(ctx, t) {
            const alpha = (1 - t) * 0.4;
            const r = lerp(6, 30, easeOutCubic(t)) * S;
            const g = ctx.createRadialGradient(target.x, target.y, 0, target.x, target.y, r);
            g.addColorStop(0, rgba('#c23b4a', alpha));
            g.addColorStop(1, 'rgba(58,13,20,0)');
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(target.x, target.y, r, 0, Math.PI * 2);
            ctx.fill();
          }
        });
        // 赤い粒（HPの雫）が噛んだ場所から生まれ、少し遅れて攻撃側へ吸い込まれていく
        for (let i = 0; i < 9; i++) {
          const a0 = rand(0, Math.PI * 2);
          const spread = rand(6, 20) * S;
          const startDelay = hitMs + 60 + rand(0, 80);
          particles.push({
            delay: startDelay,
            maxLife: rand(340, 460),
            sx: target.x + Math.cos(a0) * spread,
            sy: target.y + Math.sin(a0) * spread,
            draw(ctx, t) {
              // 前半：噛んだ場所でふわっと浮かぶ／後半：吸い込まれるように加速しながらfromへ
              const pull = easeInCubic(clamp01((t - 0.15) / 0.85));
              const x = lerp(this.sx, src.x, pull);
              const y = lerp(this.sy, src.y, pull) - Math.sin(t * Math.PI) * 10 * S;
              const alpha = t < 0.85 ? 0.9 : (1 - (t - 0.85) / 0.15) * 0.9;
              const size = lerp(4, 1.5, clamp01(t)) * S;
              ctx.fillStyle = rgba('#e0475a', alpha);
              ctx.shadowColor = rgba('#ff8a95', 0.8);
              ctx.shadowBlur = 5 * S;
              ctx.beginPath();
              ctx.ellipse(x, y - size * 0.6, size * 0.6, size, 0, 0, Math.PI * 2);
              ctx.fill();
            }
          });
        }
        // 攻撃側に吸収された瞬間の淡い緑がかった回復フラッシュ（HPが戻った感触）
        particles.push({
          delay: hitMs + 340,
          maxLife: 260,
          draw(ctx, t) {
            const alpha = (1 - t) * 0.5;
            const r = lerp(4, 26, easeOutCubic(t)) * S;
            const g = ctx.createRadialGradient(src.x, src.y, 0, src.x, src.y, r);
            g.addColorStop(0, rgba('#ffe0e2', alpha));
            g.addColorStop(1, 'rgba(194,59,74,0)');
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(src.x, src.y, r, 0, Math.PI * 2);
            ctx.fill();
          }
        });
      }
    });
  }

  // かみつく：あく色の牙でシンプルに一噛み。噛みついた瞬間に小さな爪痕状の
  // 閃光が散る、軽めの演出（低威力技らしく控えめ）。
  function spawnBiteSpecialMove(particles, w, h, info) {
    spawnBiteSpecial(particles, w, h, info, {
      core: '#e8d9ff', main: '#6a3fa0', deep: '#1e0f2e',
      attach(particles, target, hitMs, S) {
        for (let i = 0; i < 5; i++) {
          const a0 = -0.6 + i * 0.3;
          particles.push({
            delay: hitMs + rand(0, 40),
            maxLife: rand(180, 260),
            draw(ctx, t) {
              const len = lerp(3, 16, easeOutCubic(t)) * S;
              const alpha = (1 - t) * 0.75;
              ctx.strokeStyle = rgba('#a876e0', alpha);
              ctx.lineWidth = Math.max(1, 2 * S * (1 - t * 0.5));
              ctx.lineCap = 'round';
              ctx.shadowColor = rgba('#6a3fa0', 0.7);
              ctx.shadowBlur = 4 * S;
              ctx.beginPath();
              ctx.moveTo(target.x, target.y);
              ctx.lineTo(target.x + Math.cos(a0) * len, target.y + Math.sin(a0) * len);
              ctx.stroke();
            }
          });
        }
      }
    });
  }

  // かみくだく：かみつくより鋭く「バキッ」と骨まで砕く印象。噛みついた瞬間、
  // 白いひび割れ状の閃光が放射状に走り、紫黒の破片が飛び散る（威力が高い分やや派手）。
  function spawnCrunchSpecial(particles, w, h, info) {
    spawnBiteSpecial(particles, w, h, info, {
      core: '#ffffff', main: '#7a4fc4', deep: '#150a22',
      attach(particles, target, hitMs, S) {
        // ひび割れ状の閃光ライン（放射状）
        for (let i = 0; i < 6; i++) {
          const a0 = rand(0, Math.PI * 2);
          const len = rand(18, 34) * S;
          particles.push({
            delay: hitMs,
            maxLife: 220,
            draw(ctx, t) {
              const e = easeOutQuint(t);
              const alpha = (1 - t) * 0.9;
              ctx.strokeStyle = rgba('#ffffff', alpha);
              ctx.lineWidth = Math.max(1, 2 * S * (1 - t * 0.6));
              ctx.lineCap = 'round';
              ctx.shadowColor = rgba('#a876e0', 0.8);
              ctx.shadowBlur = 6 * S;
              ctx.beginPath();
              ctx.moveTo(target.x, target.y);
              ctx.lineTo(target.x + Math.cos(a0) * len * e, target.y + Math.sin(a0) * len * e);
              ctx.stroke();
            }
          });
        }
        // 砕けた破片（紫黒の小片）が飛び散る
        for (let i = 0; i < 8; i++) {
          const a0 = rand(0, Math.PI * 2);
          const dist = rand(16, 34) * S;
          particles.push({
            delay: hitMs + rand(0, 60),
            maxLife: rand(280, 400),
            rot: rand(0, Math.PI * 2),
            draw(ctx, t) {
              const e = easeOutCubic(t);
              const x = target.x + Math.cos(a0) * dist * e;
              const y = target.y + Math.sin(a0) * dist * e + t * t * 14 * S;
              const alpha = (1 - t) * 0.85;
              ctx.save();
              ctx.translate(x, y);
              ctx.rotate(this.rot + t * 5);
              ctx.fillStyle = rgba(i % 2 ? '#7a4fc4' : '#2a1840', alpha);
              ctx.beginPath();
              ctx.moveTo(-3 * S, -3 * S); ctx.lineTo(3 * S, -1.5 * S); ctx.lineTo(1.5 * S, 3 * S); ctx.lineTo(-2.5 * S, 1.5 * S);
              ctx.closePath();
              ctx.fill();
              ctx.restore();
            }
          });
        }
      }
    });
  }

  // じゃあくなキバ（オリジナル・威力120）：あく色の牙。かみなりのキバ等と同じ
  // spawnFangSpecial基盤を使い、噛みついた瞬間に濃い紫黒の衝撃波と、獲物を
  // 引き裂くような鋭い爪痕状の閃光が複数走る（高威力技らしく大ぶりに）。
  function spawnDarkFangSpecial(particles, w, h, info) {
    spawnFangSpecial(particles, w, h, info, {
      core: '#e8d9ff', main: '#7a3fd4', deep: '#12081c',
      attach(particles, target, hitMs, S) {
        // 大ぶりな爪痕状の閃光（3本、扇状に）
        for (let i = 0; i < 3; i++) {
          const a0 = -0.5 + i * 0.5;
          particles.push({
            delay: hitMs + i * 30,
            maxLife: 260,
            draw(ctx, t) {
              const len = lerp(6, 40, easeOutQuint(t)) * S;
              const alpha = (1 - t) * 0.9;
              ctx.strokeStyle = rgba('#c9a6ff', alpha);
              ctx.lineWidth = Math.max(1.4, 3 * S * (1 - t * 0.5));
              ctx.lineCap = 'round';
              ctx.shadowColor = rgba('#7a3fd4', 0.9);
              ctx.shadowBlur = 9 * S;
              ctx.beginPath();
              ctx.moveTo(target.x, target.y);
              ctx.lineTo(target.x + Math.cos(a0) * len, target.y + Math.sin(a0) * len);
              ctx.stroke();
            }
          });
        }
        // 濃い紫黒の衝撃波（通常のfang波紋より一回り大きい）
        for (let i = 0; i < 2; i++) {
          particles.push({
            delay: hitMs + i * 60,
            maxLife: 400,
            draw(ctx, t) {
              const e = easeOutCubic(t);
              const r = (34 * S) * (0.6 + e * 2.6);
              const alpha = (1 - t) * 0.5;
              ctx.strokeStyle = rgba('#7a3fd4', alpha);
              ctx.lineWidth = Math.max(1.2, 3 * S * (1 - t * 0.5));
              ctx.shadowColor = rgba('#e8d9ff', 0.8);
              ctx.shadowBlur = 12 * S;
              ctx.beginPath();
              ctx.arc(target.x, target.y, r, 0, Math.PI * 2);
              ctx.stroke();
            }
          });
        }
        // 黒い靄が噛んだ場所を包む
        particles.push({
          delay: hitMs,
          maxLife: 440,
          draw(ctx, t) {
            const alpha = (1 - t) * 0.4;
            const r = lerp(8, 46, easeOutCubic(t)) * S;
            const g = ctx.createRadialGradient(target.x, target.y, 0, target.x, target.y, r);
            g.addColorStop(0, rgba('#2a1440', alpha));
            g.addColorStop(1, 'rgba(18,8,28,0)');
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(target.x, target.y, r, 0, Math.PI * 2);
            ctx.fill();
          }
        });
      }
    });
  }

  // サイコファング：エスパー色の牙。spawnFangSpecial基盤を使い、噛みついた瞬間に
  // ピンク〜紫のサイケデリックな波紋が同心円状に広がり、小さな光の粒がふわふわと
  // 漂いながら消える（エスパー技らしい幻惑的な質感）。
  function spawnPsychicFangSpecial(particles, w, h, info) {
    spawnFangSpecial(particles, w, h, info, {
      core: '#ffe0fa', main: '#ff5fb0', deep: '#5a1250',
      attach(particles, target, hitMs, S) {
        // 同心円状に広がるサイケデリックな波紋（複数色を重ねる）
        const ringColors = ['#ff5fb0', '#b25fff', '#5fc8ff'];
        for (let i = 0; i < 3; i++) {
          particles.push({
            delay: hitMs + i * 70,
            maxLife: 420,
            draw(ctx, t) {
              const e = easeOutCubic(t);
              const r = (26 * S) * (0.5 + e * 2.4);
              const alpha = (1 - t) * 0.55;
              ctx.strokeStyle = rgba(ringColors[i], alpha);
              ctx.lineWidth = Math.max(1, 2.4 * S * (1 - t * 0.5));
              ctx.shadowColor = rgba(ringColors[i], 0.9);
              ctx.shadowBlur = 10 * S;
              ctx.beginPath();
              ctx.arc(target.x, target.y, r, 0, Math.PI * 2);
              ctx.stroke();
            }
          });
        }
        // ふわふわ漂う光の粒（エスパー特有の浮遊感）
        for (let i = 0; i < 10; i++) {
          const a0 = rand(0, Math.PI * 2);
          const dist = rand(10, 34) * S;
          particles.push({
            delay: hitMs + rand(0, 120),
            maxLife: rand(360, 520),
            phase: rand(0, Math.PI * 2),
            draw(ctx, t) {
              const e = easeOutCubic(t);
              const wobble = Math.sin(t * 8 + this.phase) * 4 * S;
              const x = target.x + Math.cos(a0) * dist * e + wobble;
              const y = target.y + Math.sin(a0) * dist * e - e * 16 * S;
              const alpha = (1 - t) * 0.8;
              ctx.fillStyle = rgba(i % 2 ? '#ffe0fa' : '#b25fff', alpha);
              ctx.shadowColor = rgba('#ff5fb0', 0.8);
              ctx.shadowBlur = 5 * S;
              ctx.beginPath();
              ctx.arc(x, y, lerp(3, 0.8, t) * S, 0, Math.PI * 2);
              ctx.fill();
            }
          });
        }
      }
    });
  }

  // ディーナスバイト（オリジナル・威力120／みずタイプの牙系）：spawnFangSpecial基盤を
  // 使い、牙を青白い水のオーラで包む。噛みついた瞬間、口元から大量の水が溢れ出し、
  // 飛沫が弾け、サメが獲物に食らいつくような荒々しい水しぶきの柱が立ち上る。
  function spawnAquaFangSpecial(particles, w, h, info) {
    spawnFangSpecial(particles, w, h, info, {
      core: '#e8fbff', main: '#2fb0e6', deep: '#063a5c',
      attach(particles, target, hitMs, S, from, mouth, ang) {
        const ux = Math.cos(ang), uy = Math.sin(ang);
        const perpX = -uy, perpY = ux;

        // 噛みついた瞬間：口元（牙の付け根＝target付近）から水が「溢れ出す」ような
        // 太いしぶきの束。噛む方向の逆側（perp方向左右）へ勢いよく弾ける。
        for (let i = 0; i < 14; i++) {
          const spread = rand(-1, 1);
          const speed = rand(22, 46) * S;
          const upBias = rand(0.3, 1) * S;
          particles.push({
            delay: hitMs + rand(0, 90),
            maxLife: rand(320, 480),
            draw(ctx, t) {
              const e = easeOutCubic(t);
              const grav = t * t * 20 * S;
              const x = target.x + perpX * spread * speed * e - ux * 6 * S * e;
              const y = target.y + perpY * spread * speed * e - uy * 6 * S * e - upBias * 18 * e + grav;
              const alpha = (1 - t) * 0.85;
              const size = lerp(3.4, 0.8, t) * S;
              ctx.fillStyle = rgba(i % 3 === 0 ? '#e8fbff' : '#2fb0e6', alpha);
              ctx.shadowColor = rgba('#2fb0e6', 0.85);
              ctx.shadowBlur = 5 * S;
              ctx.beginPath();
              ctx.ellipse(x, y, size, size * 1.4, Math.atan2(perpY * spread, perpX * spread), 0, Math.PI * 2);
              ctx.fill();
            }
          });
        }

        // 口から溢れる水の「柱」：ターゲット位置から一瞬太く噴き出し、すぐ崩れて落ちる
        particles.push({
          delay: hitMs,
          maxLife: 340,
          draw(ctx, t) {
            const rise = easeOutCubic(clamp01(t / 0.35));
            const fall = t < 0.35 ? 0 : easeInCubic((t - 0.35) / 0.65);
            const len = (30 * S) * rise;
            const alpha = (1 - fall) * 0.55;
            const topX = target.x - ux * len * 0.3;
            const topY = target.y - uy * len * 0.3 - len * 0.9 + fall * 16 * S;
            const grad = ctx.createLinearGradient(target.x, target.y, topX, topY);
            grad.addColorStop(0, rgba('#2fb0e6', alpha));
            grad.addColorStop(1, rgba('#e8fbff', 0));
            ctx.strokeStyle = grad;
            ctx.lineWidth = Math.max(2, 7 * S * (1 - fall * 0.6));
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(target.x, target.y);
            ctx.lineTo(topX, topY);
            ctx.stroke();
          }
        });

        // 着水のような波紋（青白）
        for (let i = 0; i < 2; i++) {
          particles.push({
            delay: hitMs + 60 + i * 90,
            maxLife: 380,
            draw(ctx, t) {
              const e = easeOutCubic(t);
              const r = (24 * S) * (0.5 + e * 2.2);
              const alpha = (1 - t) * 0.5;
              ctx.strokeStyle = rgba('#2fb0e6', alpha);
              ctx.lineWidth = Math.max(1, 2.4 * S * (1 - t * 0.5));
              ctx.shadowColor = rgba('#e8fbff', 0.7);
              ctx.shadowBlur = 8 * S;
              ctx.beginPath();
              ctx.ellipse(target.x, target.y, r, r * 0.6, 0, 0, Math.PI * 2);
              ctx.stroke();
            }
          });
        }

        // 水しぶきの霧（周囲が一瞬濡れて煙るような淡い水色のもや）
        particles.push({
          delay: hitMs,
          maxLife: 460,
          draw(ctx, t) {
            const alpha = (1 - t) * 0.3;
            const r = lerp(8, 48, easeOutCubic(t)) * S;
            const g = ctx.createRadialGradient(target.x, target.y, 0, target.x, target.y, r);
            g.addColorStop(0, rgba('#e8fbff', alpha));
            g.addColorStop(1, 'rgba(47,176,230,0)');
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(target.x, target.y, r, 0, Math.PI * 2);
            ctx.fill();
          }
        });
      }
    });
  }

  // ============================================================
  // ひゃっきやこう（attack172／attack175は共通演出）専用大技エフェクト
  // レジェンズアルセウス／SV版の演出を再現：
  //   ①攻撃側の左右から、青白い鬼火のような2つの魂（コアの光＋尾を引く霊魂の煙）が生まれる
  //   ②2つの魂は互いに逆側へ回り込むように弧を描いて相手へ向かい、
  //     相手の手前でちょうどX字を描くように軌道が交差する
  //   ③交差した直後、それぞれの魂は入れ替わった側（左の魂は右へ、右の魂は左へ）から
  //     相手に命中し、青白い閃光とともに弾ける
  // 単一の球を放つシャドーボール／あくのはどうとは違い、「2つの光点が独立して
  // 曲線軌道を描き、交差する瞬間の見せ場を作る」のがひゃっきやこうの核。
  // ============================================================
  const NIGHTSHADE_FORM_MS = 300;      // ①2つの魂が生まれる
  const NIGHTSHADE_FLIGHT_MS = 560;    // ②③魂が弧を描いて相手へ届くまで（交差含む）
  const NIGHTSHADE_HIT_MS = NIGHTSHADE_FORM_MS + NIGHTSHADE_FLIGHT_MS;
  const NIGHTSHADE_END_MS = NIGHTSHADE_HIT_MS + 620;
  const NIGHTSHADE_CROSS_T = 0.62;     // 飛翔のうち何割の時点でX字に交差するか

  function spawnNightShadeSpecial(particles, w, h, info) {
    const from = (info && info.from) || { x: w * 0.28, y: h * 0.68 };
    const to = (info && info.to) || { x: w * 0.72, y: h * 0.32 };
    const S = (info && info.scale) || 1;

    const dx = to.x - from.x, dy = to.y - from.y;
    const dist = Math.hypot(dx, dy) || 1;
    const ux = dx / dist, uy = dy / dist;
    const perpX = -uy, perpY = ux;

    // 出発点：攻撃側の中心から左右にわずかにずらした2箇所
    const spawnOffset = 16 * S;
    const soul = [
      { side: -1, start: { x: from.x - perpX * spawnOffset, y: from.y - perpY * spawnOffset } },
      { side: 1, start: { x: from.x + perpX * spawnOffset, y: from.y + perpY * spawnOffset } },
    ];
    // 命中点：交差した後は左右が入れ替わるので、side=-1の魂はto側の+方向、side=1の魂は-方向に着弾する
    const hitOffset = 20 * S;
    soul[0].end = { x: to.x + perpX * hitOffset, y: to.y + perpY * hitOffset };
    soul[1].end = { x: to.x - perpX * hitOffset, y: to.y - perpY * hitOffset };
    // 弧の膨らみ：中間地点で左右に大きく膨らんでから交差点へ収束する
    const bow = dist * 0.32;

    // 魂の位置を時刻(ms)から計算：出発→弧を描いて接近→交差点通過→着弾点へ
    function soulPos(s, ms) {
      if (ms < NIGHTSHADE_FORM_MS) {
        const f = clamp01(ms / NIGHTSHADE_FORM_MS);
        return { x: s.start.x, y: s.start.y, scale: easeOutCubic(f), alpha: clamp01(ms / 120) };
      }
      const f = clamp01((ms - NIGHTSHADE_FORM_MS) / NIGHTSHADE_FLIGHT_MS);
      const e = easeInOutSine(f);
      // ベジェ的な弧：start → (膨らんだ制御点) → 交差点(相手の少し手前) → end
      const crossPoint = { x: lerp(from.x, to.x, NIGHTSHADE_CROSS_T), y: lerp(from.y, to.y, NIGHTSHADE_CROSS_T) };
      let px, py;
      if (f < NIGHTSHADE_CROSS_T) {
        const localT = f / NIGHTSHADE_CROSS_T;
        const le = easeInOutSine(localT);
        const bowAmt = Math.sin(Math.PI * localT) * bow * s.side;
        px = lerp(s.start.x, crossPoint.x, le) + perpX * bowAmt;
        py = lerp(s.start.y, crossPoint.y, le) + perpY * bowAmt;
      } else {
        const localT = (f - NIGHTSHADE_CROSS_T) / (1 - NIGHTSHADE_CROSS_T);
        const le = easeInCubic(localT);
        // 交差後は逆サイドへ弧を描きながら着弾点へ向かう（Xの後半の線）
        const bowAmt = Math.sin(Math.PI * localT) * bow * 0.5 * -s.side;
        px = lerp(crossPoint.x, s.end.x, le) + perpX * bowAmt;
        py = lerp(crossPoint.y, s.end.y, le) + perpY * bowAmt;
      }
      return { x: px, y: py, scale: 1, alpha: 1, e };
    }

    const SOUL_R = 13 * S;
    const CORE = '#eaffff';
    const BLUE = '#7fe8ff';
    const BLUE_DEEP = '#2a9fd6';
    const NAVY = '#1a3f8a';

    // ---- ①魂が生まれる瞬間の淡い発光 ----
    soul.forEach((s) => {
      particles.push({
        delay: 0,
        maxLife: NIGHTSHADE_FORM_MS + 60,
        blend: 'lighter',
        draw(ctx, t) {
          const ms = t * (NIGHTSHADE_FORM_MS + 60);
          const p = soulPos(s, Math.min(ms, NIGHTSHADE_FORM_MS));
          const a = Math.sin(Math.PI * clamp01(t)) * 0.7;
          const r = lerp(4, SOUL_R * 1.8, p.scale) * S;
          const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
          g.addColorStop(0, rgba(CORE, a));
          g.addColorStop(0.5, rgba(BLUE, a * 0.8));
          g.addColorStop(1, rgba(BLUE_DEEP, 0));
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
          ctx.fill();
        }
      });
    });

    // ---- ②③魂本体：弧を描いて接近し、交差して着弾する。青白い鬼火のコア＋揺らめく尾 ----
    soul.forEach((s, idx) => {
      // 尾（残像）：直前数フレームの位置を繋いで、揺らめく煙のような帯にする
      particles.push({
        delay: 20,
        maxLife: NIGHTSHADE_HIT_MS - 20,
        blend: 'lighter',
        draw(ctx, t) {
          const ms = 20 + t * (NIGHTSHADE_HIT_MS - 20);
          const trailN = 8;
          ctx.lineCap = 'round';
          for (let k = trailN; k >= 1; k--) {
            const msk = ms - k * 22;
            if (msk < 0) continue;
            const p0 = soulPos(s, Math.max(0, msk - 22));
            const p1 = soulPos(s, msk);
            const fade = (1 - k / trailN);
            ctx.strokeStyle = rgba(k % 2 === idx % 2 ? BLUE : BLUE_DEEP, fade * 0.5);
            ctx.lineWidth = Math.max(1, SOUL_R * 0.9 * fade);
            ctx.beginPath();
            ctx.moveTo(p0.x, p0.y);
            ctx.lineTo(p1.x, p1.y);
            ctx.stroke();
          }
        }
      });
      // 魂のコア本体（丸い光点。鬼火らしく小刻みに明滅・揺らめく）
      particles.push({
        delay: NIGHTSHADE_FORM_MS - 40,
        maxLife: NIGHTSHADE_FLIGHT_MS + 80,
        blend: 'lighter',
        seed: rand(0, 100),
        draw(ctx, t) {
          const ms = NIGHTSHADE_FORM_MS - 40 + t * (NIGHTSHADE_FLIGHT_MS + 80);
          const p = soulPos(s, clamp01(ms));
          const flicker = 0.85 + 0.15 * Math.sin(ms * 0.05 + this.seed);
          const r = SOUL_R * flicker;
          const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 1.6);
          g.addColorStop(0, rgba(CORE, 0.95));
          g.addColorStop(0.4, rgba(BLUE, 0.85));
          g.addColorStop(0.75, rgba(BLUE_DEEP, 0.5));
          g.addColorStop(1, rgba(NAVY, 0));
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(p.x, p.y, r * 1.6, 0, Math.PI * 2);
          ctx.fill();
          // 鬼火らしい細い炎のゆらめき（コアの周りに2〜3本）
          for (let f = 0; f < 3; f++) {
            const fa = ms * 0.006 + f * 2.1 + this.seed;
            const flen = r * (1.3 + 0.4 * Math.sin(ms * 0.02 + f));
            ctx.strokeStyle = rgba(CORE, 0.5);
            ctx.lineWidth = Math.max(1, 1.4 * S);
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(p.x + Math.cos(fa) * flen, p.y + Math.sin(fa) * flen);
            ctx.stroke();
          }
        }
      });
    });

    // ---- 交差の瞬間：中央でX字が交わる一瞬、青白い閃光が小さく弾ける ----
    particles.push({
      delay: NIGHTSHADE_FORM_MS + NIGHTSHADE_FLIGHT_MS * NIGHTSHADE_CROSS_T - 30,
      maxLife: 220,
      blend: 'lighter',
      draw(ctx, t) {
        const crossPoint = { x: lerp(from.x, to.x, NIGHTSHADE_CROSS_T), y: lerp(from.y, to.y, NIGHTSHADE_CROSS_T) };
        const a = Math.pow(1 - t, 1.6) * 0.8;
        const r = lerp(6 * S, 26 * S, easeOutQuint(t));
        const g = ctx.createRadialGradient(crossPoint.x, crossPoint.y, 0, crossPoint.x, crossPoint.y, r);
        g.addColorStop(0, rgba(CORE, a));
        g.addColorStop(0.5, rgba(BLUE, a * 0.7));
        g.addColorStop(1, rgba(BLUE_DEEP, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(crossPoint.x, crossPoint.y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    });

    // ---- ③着弾：2つの魂がそれぞれ入れ替わった側から命中し、弾けて青白い衝撃波が広がる ----
    soul.forEach((s) => {
      particles.push({
        delay: NIGHTSHADE_HIT_MS - 10,
        maxLife: 280,
        blend: 'lighter',
        draw(ctx, t) {
          const a = Math.pow(1 - t, 1.5);
          const r = lerp(8 * S, 40 * S, easeOutQuint(t));
          const g = ctx.createRadialGradient(s.end.x, s.end.y, 0, s.end.x, s.end.y, r);
          g.addColorStop(0, rgba(CORE, a * 0.95));
          g.addColorStop(0.45, rgba(BLUE, a * 0.75));
          g.addColorStop(1, rgba(BLUE_DEEP, 0));
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(s.end.x, s.end.y, r, 0, Math.PI * 2);
          ctx.fill();
        }
      });
      // 着弾の衝撃波リング
      particles.push({
        delay: NIGHTSHADE_HIT_MS,
        maxLife: 380,
        blend: 'lighter',
        draw(ctx, t) {
          const e = easeOutCubic(t);
          const r = SOUL_R * (1 + e * 3.2);
          const alpha = (1 - t) * 0.55;
          ctx.strokeStyle = rgba(BLUE, alpha);
          ctx.lineWidth = Math.max(1, 2.6 * S * (1 - t * 0.5));
          ctx.shadowColor = rgba(CORE, 0.8);
          ctx.shadowBlur = 10 * S;
          ctx.beginPath();
          ctx.arc(s.end.x, s.end.y, r, 0, Math.PI * 2);
          ctx.stroke();
        }
      });
      // 弾け散る青白い光の粒
      for (let i = 0; i < 8; i++) {
        const a0 = rand(0, Math.PI * 2);
        const spd = rand(14, 34) * S;
        particles.push({
          delay: NIGHTSHADE_HIT_MS + rand(0, 30),
          maxLife: rand(260, 420),
          draw(ctx, t) {
            const e = easeOutCubic(t);
            const x = s.end.x + Math.cos(a0) * spd * e;
            const y = s.end.y + Math.sin(a0) * spd * e;
            const alpha = (1 - t) * 0.85;
            ctx.fillStyle = rgba(CORE, alpha);
            ctx.shadowColor = rgba(BLUE, 0.9);
            ctx.shadowBlur = 6 * S;
            ctx.beginPath();
            ctx.arc(x, y, 2 * S * (1 - t * 0.4), 0, Math.PI * 2);
            ctx.fill();
          }
        });
      }
    });
  }

  // ============================================================
  // サイコキネシス（attack292／attack300は共通演出）／専用大技エフェクト
  // ダイヤモンド・パール版の原作演出を再現：
  //   ①相手の足元から紫〜マゼンタの同心円状の波紋が幾重にも立ち上がる
  //   ②相手を取り囲むように、渦を巻く紫色の光の帯（螺旋）が上昇していく
  //   ③相手の周囲に脈打つリング状のオーラが数本、外側へ広がりながら明滅する
  //   ④最後に相手全体が紫色にフラッシュし、超能力で軽く持ち上げられるように
  //     ふわっと浮遊してから静かに戻る
  // 全体を通して紫〜マゼンタ系の色調で統一し、画面を大きく揺らすような
  // 破壊的演出は使わず、「念動力でじわりと締め上げる」不穏な質感を出す。
  // ============================================================
  const PSYKINESIS_RIPPLE_MS = 420;     // ①波紋が立ち上がり始める尺
  const PSYKINESIS_SPIRAL_MS = 780;     // ②螺旋の光の帯が渦を巻いて上昇する尺
  const PSYKINESIS_RING_START_MS = 260; // ③リングオーラの発生開始（波紋と少し重なる）
  const PSYKINESIS_LIFT_MS = 900;       // ④浮遊が始まる時刻
  const PSYKINESIS_LIFT_DUR_MS = 520;   //    浮き上がって戻ってくるまでの尺
  const PSYKINESIS_HIT_MS = PSYKINESIS_LIFT_MS + 40; // フラッシュ・ダメージの基準時刻
  const PSYKINESIS_END_MS = PSYKINESIS_LIFT_MS + PSYKINESIS_LIFT_DUR_MS + 340;

  function spawnPsykinesisSpecial(particles, w, h, info) {
    const to = (info && info.to) || { x: w * 0.5, y: h * 0.5 };
    const S = (info && info.scale) || 1;
    const cx = to.x, cy = to.y;
    const baseR = 46 * S;

    // ---- ①同心円の波紋：紫〜マゼンタのリングが足元から幾重にも立ち上がって広がる ----
    for (let i = 0; i < 5; i++) {
      particles.push({
        delay: i * 150,
        maxLife: PSYKINESIS_RIPPLE_MS + 520,
        blend: 'lighter',
        draw(ctx, t) {
          const e = easeOutCubic(t);
          const r = baseR * (0.5 + e * 2.6);
          const alpha = (1 - t) * 0.55;
          ctx.save();
          ctx.translate(cx, cy);
          ctx.scale(1, 0.42); // 足元の楕円パースペクティブ
          ctx.strokeStyle = rgba('#b34fff', alpha);
          ctx.lineWidth = 4 * S * (1 - t * 0.5);
          ctx.shadowColor = rgba('#e08cff', 0.8);
          ctx.shadowBlur = 14;
          ctx.beginPath();
          ctx.arc(0, 0, r, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }
      });
    }

    // ---- ②渦を巻く光の帯：相手の周りを螺旋状に上昇しながら包み込む ----
    const spiralStrands = 3;
    for (let s = 0; s < spiralStrands; s++) {
      const phase0 = (s / spiralStrands) * Math.PI * 2;
      particles.push({
        delay: 80 + s * 60,
        maxLife: PSYKINESIS_SPIRAL_MS,
        blend: 'lighter',
        draw(ctx, t) {
          const e = easeInOutSine(t);
          const segs = 26;
          ctx.save();
          ctx.translate(cx, cy);
          const grad = ctx.createLinearGradient(0, baseR * 1.4, 0, -baseR * 2.6);
          grad.addColorStop(0, rgba('#7a1fd6', 0));
          grad.addColorStop(0.15, rgba('#a83cff', 0.85));
          grad.addColorStop(0.55, rgba('#e6a8ff', 0.95));
          grad.addColorStop(1, rgba('#ffffff', 0));
          ctx.strokeStyle = grad;
          ctx.lineWidth = 5 * S;
          ctx.shadowColor = rgba('#c874ff', 0.9);
          ctx.shadowBlur = 12;
          ctx.beginPath();
          for (let i = 0; i <= segs; i++) {
            const f = i / segs;
            const height = lerp(baseR * 1.3, -baseR * 2.6, f) * (0.3 + e * 0.7);
            const turn = phase0 + f * Math.PI * 3.2 + t * Math.PI * 1.4;
            const radius = baseR * (1.15 - f * 0.35) * (0.4 + e * 0.6);
            const px = Math.cos(turn) * radius;
            const py = height + Math.sin(turn) * radius * 0.32;
            if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
          }
          ctx.globalAlpha = clamp01(1 - Math.abs(t - 0.55) * 1.1);
          ctx.stroke();
          ctx.restore();
        }
      });
    }

    // ---- ③脈打つリングオーラ：相手本体を締め付けるように明滅しながら外側へ広がる ----
    for (let i = 0; i < 4; i++) {
      particles.push({
        delay: PSYKINESIS_RING_START_MS + i * 180,
        maxLife: 640,
        blend: 'lighter',
        draw(ctx, t) {
          const pulse = 0.5 + 0.5 * Math.sin(t * Math.PI * 5);
          const e = easeOutCubic(t);
          const rx = baseR * (0.75 + e * 0.9);
          const ry = rx * 1.18;
          const alpha = (1 - e) * (0.35 + pulse * 0.35);
          ctx.save();
          ctx.translate(cx, cy - baseR * 0.15);
          ctx.strokeStyle = rgba('#d966ff', alpha);
          ctx.lineWidth = 3 * S;
          ctx.shadowColor = rgba('#f0b3ff', 0.9);
          ctx.shadowBlur = 10;
          ctx.beginPath();
          ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }
      });
    }

    // ---- 中心の紫オーラの発光（相手本体を包む靄）----
    particles.push({
      delay: 0,
      maxLife: PSYKINESIS_LIFT_MS + 200,
      blend: 'lighter',
      draw(ctx, t) {
        const glow = 0.22 + 0.14 * Math.sin(t * Math.PI * 6);
        const r = baseR * 1.5;
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        grad.addColorStop(0, rgba('#e6b3ff', glow));
        grad.addColorStop(0.6, rgba('#a83cff', glow * 0.5));
        grad.addColorStop(1, rgba('#a83cff', 0));
        ctx.save();
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    });

    // ---- 浮遊する光の粒：螺旋の帯から零れ落ちるように舞い上がる ----
    for (let i = 0; i < 22; i++) {
      const a0 = rand(0, Math.PI * 2);
      const r0 = rand(baseR * 0.3, baseR * 1.1);
      particles.push({
        delay: rand(100, PSYKINESIS_SPIRAL_MS * 0.8),
        maxLife: rand(420, 680),
        seed: rand(0, 10),
        draw(ctx, t) {
          const e = easeOutCubic(t);
          const rise = e * baseR * 2.2;
          const wob = Math.sin(t * Math.PI * 4 + this.seed) * baseR * 0.25;
          const x = cx + Math.cos(a0) * r0 * (1 - e * 0.3) + wob;
          const y = cy - rise + Math.sin(a0) * r0 * 0.3;
          const alpha = (1 - t) * 0.85;
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          ctx.fillStyle = rgba('#f3d0ff', alpha);
          ctx.shadowColor = rgba('#ffffff', 0.9);
          ctx.shadowBlur = 6;
          ctx.beginPath();
          ctx.arc(x, y, 2.2 * S * (1 - t * 0.4), 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      });
    }

    // ---- ④着弾フラッシュの光芒（十字型に伸びる閃光）----
    particles.push({
      delay: PSYKINESIS_HIT_MS - 20,
      maxLife: 260,
      blend: 'lighter',
      draw(ctx, t) {
        const alpha = 1 - t;
        const len = baseR * (1.6 + t * 1.2);
        ctx.save();
        ctx.translate(cx, cy);
        ctx.strokeStyle = rgba('#ffffff', alpha * 0.9);
        ctx.lineWidth = 3 * S;
        ctx.shadowColor = rgba('#e6a8ff', 0.9);
        ctx.shadowBlur = 16;
        for (let k = 0; k < 4; k++) {
          const a = (Math.PI / 4) + (k * Math.PI / 2);
          ctx.beginPath();
          ctx.moveTo(-Math.cos(a) * len, -Math.sin(a) * len);
          ctx.lineTo(Math.cos(a) * len, Math.sin(a) * len);
          ctx.stroke();
        }
        ctx.restore();
      }
    });
  }

  function spawnAuraSphereSpecial(particles, w, h, info) {
    const from = (info && info.from) || { x: w * 0.28, y: h * 0.68 };
    const to = (info && info.to) || { x: w * 0.72, y: h * 0.32 };
    const S = (info && info.scale) || 1;

    const dx = to.x - from.x, dy = to.y - from.y;
    const dist = Math.hypot(dx, dy) || 1;
    const ux = dx / dist, uy = dy / dist;
    const ang = Math.atan2(dy, dx);
    // 球を作る位置：攻撃側の中心から相手方向へ少し前に出した位置（両手の間）
    const hand = { x: from.x + ux * 38 * S, y: from.y + uy * 38 * S - 4 * S };
    // 命中位置：相手の中心
    const target = { x: to.x, y: to.y };

    const BALL_R = 20 * S;   // 球の半径

    // はどうだんの配色（DP準拠：白い芯・水色・濃い青）
    const WHITE = '#ffffff';
    const CYAN_HI = '#c8f4ff';   // 芯の周りの淡い水色
    const CYAN = '#5fd8ff';      // 明るい水色（主色）
    const BLUE = '#2a9dff';      // 縁の青
    const DEEP = '#1a5fd8';      // 濃い青（外縁）

    // ---- 球の位置・大きさ・脈動を時刻(ms)から直接計算する（収束→溜め→飛翔を1本の関数で扱う）----
    function ballState(ms) {
      let r;
      if (ms < AURASPHERE_FORM_MS) {
        const f = clamp01(ms / AURASPHERE_FORM_MS);
        r = BALL_R * (0.1 + 0.9 * easeOutCubic(f));
      } else if (ms < AURASPHERE_LAUNCH_MS) {
        const f = (ms - AURASPHERE_FORM_MS) / AURASPHERE_HOLD_MS;
        r = BALL_R * (1 + 0.14 * Math.sin(f * Math.PI * 2));     // 眩く脈打つ
      } else {
        r = BALL_R * 1.04;
      }
      let x = hand.x, y = hand.y, flight = 0;
      if (ms >= AURASPHERE_LAUNCH_MS) {
        flight = clamp01((ms - AURASPHERE_LAUNCH_MS) / AURASPHERE_FLIGHT_MS);
        const e = easeInCubic(flight) * 0.3 + flight * 0.7;      // 一直線に、終わりに向けて少し加速
        x = lerp(hand.x, target.x, e);
        y = lerp(hand.y, target.y, e);
      } else {
        y += Math.sin(ms * 0.014) * 1.6 * S;                     // 手元で小さく揺れる
      }
      return { x, y, r, flight };
    }

    // 水色の光の塊を描く（放射グラデーション）
    function glow(ctx, x, y, r, a, inner, mid, outer) {
      if (a <= 0.01 || r <= 0.5) return;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, rgba(inner, a));
      g.addColorStop(0.35, rgba(mid, a * 0.85));
      g.addColorStop(0.75, rgba(outer, a * 0.4));
      g.addColorStop(1, rgba(outer, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    // 球本体を描く：白い芯 → 水色 → 青の縁 + 周りを回る細い環 + 外側のにじみ
    function drawBall(ctx, ms, alpha) {
      const b = ballState(ms);
      if (alpha <= 0.01 || b.r <= 0.5) return b;
      const spin = ms * 0.016;
      ctx.globalCompositeOperation = 'lighter';
      // 外側のにじみ（大きく淡い水色のオーラ）
      glow(ctx, b.x, b.y, b.r * 2.6, alpha * 0.5, CYAN, BLUE, DEEP);
      // 球の本体（芯が白く、外へ向かって水色→青）
      const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r);
      g.addColorStop(0, rgba(WHITE, alpha));
      g.addColorStop(0.32, rgba(CYAN_HI, alpha));
      g.addColorStop(0.68, rgba(CYAN, alpha * 0.95));
      g.addColorStop(1, rgba(BLUE, alpha * 0.55));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
      // 球の周りを回る細い水色の環（傾いた楕円が2本、逆向きに回る）
      for (let k = 0; k < 2; k++) {
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(spin * (k === 0 ? 1 : -1.3) + k * 1.2);
        ctx.scale(1, 0.34);
        ctx.strokeStyle = rgba(k === 0 ? CYAN_HI : CYAN, alpha * 0.85);
        ctx.lineWidth = Math.max(1, b.r * 0.08);
        ctx.shadowColor = rgba(CYAN, 0.9);
        ctx.shadowBlur = 8 * S;
        ctx.beginPath();
        ctx.arc(0, 0, b.r * 1.5, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
      return b;
    }

    // 十字の光条（きらめき）
    function drawStar(ctx, x, y, size, a, color) {
      if (a <= 0.01 || size <= 0.5) return;
      ctx.save();
      ctx.translate(x, y);
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = rgba(color, a);
      ctx.shadowColor = rgba(color, 0.9);
      ctx.shadowBlur = size * 0.7;
      ctx.beginPath();
      ctx.moveTo(0, -size);
      ctx.quadraticCurveTo(size * 0.1, -size * 0.1, size, 0);
      ctx.quadraticCurveTo(size * 0.1, size * 0.1, 0, size);
      ctx.quadraticCurveTo(-size * 0.1, size * 0.1, -size, 0);
      ctx.quadraticCurveTo(-size * 0.1, -size * 0.1, 0, -size);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    // ============ ①収束：外から球へ、水色の波動が螺旋を描いて集まる ============
    // 球の周りにうっすら広がる水色のオーラ（生成に合わせて膨らむ）
    particles.push({
      maxLife: AURASPHERE_LAUNCH_MS + 60,
      blend: 'lighter',
      draw(ctx, t) {
        const ms = t * (AURASPHERE_LAUNCH_MS + 60);
        const f = clamp01(ms / AURASPHERE_FORM_MS);
        const a = Math.sin(Math.PI * clamp01(t)) * 0.5;
        glow(ctx, hand.x, hand.y, lerp(12, 62, easeOutCubic(f)) * S, a, CYAN_HI, CYAN, BLUE);
      }
    });
    // 外から球へ吸い込まれる水色の光の筋（尾を引きながら螺旋）
    for (let i = 0; i < 22; i++) {
      const a0 = (i / 22) * Math.PI * 2 + rand(-0.25, 0.25);
      const r0 = rand(52, 96) * S;
      const sz = rand(1.8, 3.6) * S;
      const col = i % 3 === 0 ? CYAN_HI : (i % 3 === 1 ? CYAN : BLUE);
      particles.push({
        delay: rand(0, AURASPHERE_FORM_MS * 0.62),
        maxLife: rand(220, 320),
        blend: 'lighter',
        draw(ctx, t) {
          if (t >= 1) return;
          const e = easeInCubic(t);
          const rr = lerp(r0, BALL_R * 0.45, e);
          const spin = a0 + t * 3.6;
          const x = hand.x + Math.cos(spin) * rr;
          const y = hand.y + Math.sin(spin) * rr * 0.85;
          // 少し手前の位置（尾）
          const t2 = Math.max(0, t - 0.1);
          const rr2 = lerp(r0, BALL_R * 0.45, easeInCubic(t2));
          const spin2 = a0 + t2 * 3.6;
          const x2 = hand.x + Math.cos(spin2) * rr2;
          const y2 = hand.y + Math.sin(spin2) * rr2 * 0.85;
          const a = clamp01(t * 4) * (1 - Math.max(0, (t - 0.85) / 0.15));
          ctx.strokeStyle = rgba(col, a * 0.75);
          ctx.lineWidth = sz * 0.9;
          ctx.lineCap = 'round';
          ctx.shadowColor = rgba(col, 0.9);
          ctx.shadowBlur = 7 * S;
          ctx.beginPath();
          ctx.moveTo(x2, y2);
          ctx.lineTo(x, y);
          ctx.stroke();
          ctx.fillStyle = rgba(WHITE, a);
          ctx.beginPath();
          ctx.arc(x, y, sz, 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }
    // 球が生まれる瞬間の小さな閃光
    particles.push({
      delay: 20,
      maxLife: 240,
      blend: 'lighter',
      draw(ctx, t) {
        glow(ctx, hand.x, hand.y, lerp(4 * S, 30 * S, easeOutQuint(t)), (1 - t) * 0.7, WHITE, CYAN, BLUE);
      }
    });

    // ============ ②溜め：脈打つたびに水色の光の輪が広がる ============
    for (let i = 0; i < 3; i++) {
      particles.push({
        delay: AURASPHERE_FORM_MS - 60 + i * 70,
        maxLife: 300,
        blend: 'lighter',
        draw(ctx, t) {
          const r = lerp(BALL_R * 1.1, BALL_R * 3.2, easeOutCubic(t));
          const a = (1 - t) * 0.75;
          ctx.strokeStyle = rgba(i === 1 ? CYAN_HI : CYAN, a);
          ctx.lineWidth = Math.max(1, 3 * S * (1 - t));
          ctx.shadowColor = rgba(CYAN, 0.9);
          ctx.shadowBlur = 8 * S;
          ctx.beginPath();
          ctx.arc(hand.x, hand.y, r, 0, Math.PI * 2);
          ctx.stroke();
        }
      });
    }

    // ============ ①②③球本体：収束→溜め→飛翔を1つのパーティクルで描く ============
    // 命中の瞬間まで描き、命中と同時に消す（弾けるのは④が担当）。
    particles.push({
      delay: 40,
      maxLife: AURASPHERE_HIT_MS - 40,
      blend: 'lighter',
      draw(ctx, t) {
        const ms = 40 + t * (AURASPHERE_HIT_MS - 40);
        drawBall(ctx, ms, clamp01((ms - 40) / 110));
      }
    });

    // ============ ③飛翔中：球の後ろに引く水色の光の尾（波動らしく細長く） ============
    particles.push({
      delay: AURASPHERE_LAUNCH_MS,
      maxLife: AURASPHERE_FLIGHT_MS + 120,
      blend: 'lighter',
      draw(ctx, t) {
        const ms = AURASPHERE_LAUNCH_MS + t * (AURASPHERE_FLIGHT_MS + 120);
        const afterHit = ms > AURASPHERE_HIT_MS;
        const tailFade = afterHit ? Math.max(0, 1 - (ms - AURASPHERE_HIT_MS) / 120) : 1;
        if (tailFade <= 0.01) return;
        const head = ballState(Math.min(ms, AURASPHERE_HIT_MS));
        if (head.flight <= 0) return;
        // 尾の先端：直近の位置を遡る（進行方向と逆へ細長く伸びる）
        const tailMs = Math.min(ms, AURASPHERE_HIT_MS) - 120;
        const tail = ballState(Math.max(AURASPHERE_LAUNCH_MS, tailMs));
        const gr = ctx.createLinearGradient(tail.x, tail.y, head.x, head.y);
        gr.addColorStop(0, rgba(BLUE, 0));
        gr.addColorStop(0.6, rgba(CYAN, 0.42 * tailFade));
        gr.addColorStop(1, rgba(CYAN_HI, 0.75 * tailFade));
        ctx.strokeStyle = gr;
        ctx.lineCap = 'round';
        ctx.lineWidth = head.r * 1.5;
        ctx.beginPath();
        ctx.moveTo(tail.x, tail.y);
        ctx.lineTo(head.x, head.y);
        ctx.stroke();
        // 細い白い芯の筋
        ctx.strokeStyle = rgba(WHITE, 0.5 * tailFade);
        ctx.lineWidth = Math.max(1, head.r * 0.35);
        ctx.beginPath();
        ctx.moveTo(lerp(tail.x, head.x, 0.35), lerp(tail.y, head.y, 0.35));
        ctx.lineTo(head.x, head.y);
        ctx.stroke();
      }
    });
    // 飛翔中に球からこぼれる水色の光の粒
    for (let i = 0; i < 12; i++) {
      const at = AURASPHERE_LAUNCH_MS + (i / 12) * AURASPHERE_FLIGHT_MS * 0.92;
      const off = rand(-1, 1);
      const col = i % 2 === 0 ? CYAN_HI : CYAN;
      particles.push({
        delay: at,
        maxLife: rand(200, 320),
        blend: 'lighter',
        draw(ctx, t) {
          const b = ballState(at);
          const px = -uy, py = ux;
          const x = b.x + px * off * b.r * 0.9 - ux * 16 * S * t;
          const y = b.y + py * off * b.r * 0.9 - uy * 16 * S * t;
          ctx.fillStyle = rgba(col, (1 - t) * 0.85);
          ctx.shadowColor = rgba(CYAN, 0.9);
          ctx.shadowBlur = 6 * S;
          ctx.beginPath();
          ctx.arc(x, y, 2.2 * S * (1 - t * 0.5), 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }

    // ============ ④命中：水色の光が爆ぜる ============
    // 中心の白い閃光（ごく短く強い）
    particles.push({
      delay: AURASPHERE_HIT_MS - 10,
      maxLife: 260,
      blend: 'lighter',
      draw(ctx, t) {
        const a = Math.pow(1 - t, 1.4);
        glow(ctx, target.x, target.y, lerp(12 * S, 72 * S, easeOutQuint(t)), a * 0.95, WHITE, CYAN_HI, CYAN);
      }
    });
    // 広がる水色の大きな光
    particles.push({
      delay: AURASPHERE_HIT_MS,
      maxLife: 520,
      blend: 'lighter',
      draw(ctx, t) {
        const grow = easeOutCubic(clamp01(t / 0.3));
        const fade = t < 0.35 ? 1 : Math.pow(1 - (t - 0.35) / 0.65, 1.3);
        glow(ctx, target.x, target.y, 86 * S * grow, fade * 0.6, CYAN_HI, CYAN, BLUE);
      }
    });
    // 広がる光の輪（水色の細い輪が3重）
    for (let i = 0; i < 3; i++) {
      particles.push({
        delay: AURASPHERE_HIT_MS + i * 60,
        maxLife: 420,
        blend: 'lighter',
        draw(ctx, t) {
          const r = lerp(10 * S, 84 * S, easeOutCubic(t));
          const a = (1 - t) * 0.9;
          ctx.strokeStyle = rgba(i === 0 ? WHITE : (i === 1 ? CYAN_HI : CYAN), a);
          ctx.lineWidth = Math.max(1, (5 - i) * S * (1 - t * 0.6));
          ctx.shadowColor = rgba(CYAN, 0.9);
          ctx.shadowBlur = 10 * S;
          ctx.beginPath();
          ctx.arc(target.x, target.y, r, 0, Math.PI * 2);
          ctx.stroke();
        }
      });
    }
    // 四方へ走る光条（放射状の線）
    const rayN = 10;
    for (let i = 0; i < rayN; i++) {
      const ra = (i / rayN) * Math.PI * 2 + rand(-0.12, 0.12);
      const rl = rand(52, 96) * S;
      particles.push({
        delay: AURASPHERE_HIT_MS + rand(0, 30),
        maxLife: rand(240, 360),
        blend: 'lighter',
        draw(ctx, t) {
          const e = easeOutCubic(t);
          const inner = lerp(6 * S, rl * 0.5, e);
          const outer = lerp(14 * S, rl, e);
          ctx.strokeStyle = rgba(i % 2 === 0 ? CYAN_HI : CYAN, (1 - t) * 0.85);
          ctx.lineWidth = Math.max(1, 3.2 * S * (1 - t));
          ctx.lineCap = 'round';
          ctx.shadowColor = rgba(CYAN, 0.9);
          ctx.shadowBlur = 8 * S;
          ctx.beginPath();
          ctx.moveTo(target.x + Math.cos(ra) * inner, target.y + Math.sin(ra) * inner);
          ctx.lineTo(target.x + Math.cos(ra) * outer, target.y + Math.sin(ra) * outer);
          ctx.stroke();
        }
      });
    }
    // 飛び散る光の粒
    for (let i = 0; i < 24; i++) {
      const col = i % 3 === 0 ? WHITE : (i % 3 === 1 ? CYAN_HI : CYAN);
      const sa = rand(0, Math.PI * 2);
      const spd = rand(30, 100) * S;
      const dotR = rand(1.4, 3.2) * S;
      particles.push({
        delay: AURASPHERE_HIT_MS + rand(0, 60),
        maxLife: rand(260, 460),
        blend: 'lighter',
        draw(ctx, t) {
          const e = easeOutCubic(t);
          const x = target.x + Math.cos(sa) * spd * e;
          const y = target.y + Math.sin(sa) * spd * e - t * 8 * S;
          ctx.fillStyle = rgba(col, (1 - t) * 0.9);
          ctx.shadowColor = rgba(CYAN, 0.9);
          ctx.shadowBlur = 6;
          ctx.beginPath();
          ctx.arc(x, y, dotR * (1 - t * 0.4), 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }

    // ============ ⑤余韻：水色の光がきらめいて舞い散る ============
    particles.push({
      delay: AURASPHERE_HIT_MS + 60,
      maxLife: 420,
      blend: 'lighter',
      draw(ctx, t) {
        const a = Math.sin(Math.PI * clamp01(t)) * 0.8;
        drawStar(ctx, target.x, target.y, lerp(8 * S, 46 * S, easeOutCubic(t)), a, WHITE);
      }
    });
    for (let i = 0; i < 8; i++) {
      const sa = rand(0, Math.PI * 2);
      const dd = rand(16, 58) * S;
      particles.push({
        delay: AURASPHERE_HIT_MS + 120 + rand(0, 140),
        maxLife: rand(300, 460),
        blend: 'lighter',
        draw(ctx, t) {
          const e = easeOutCubic(t);
          const x = target.x + Math.cos(sa) * dd * e;
          const y = target.y + Math.sin(sa) * dd * e - 18 * S * e;
          drawStar(ctx, x, y, lerp(2, 7, Math.sin(Math.PI * clamp01(t))) * S, (1 - t) * 0.85, i % 2 ? CYAN_HI : CYAN);
        }
      });
    }
  }

  // ============================================================
  // シャドーボール：黒紫の影の球を作り上げ、相手へ投げつけて炸裂させる演出
  // （本家のイメージ：攻撃側の前で小さな影が寄り集まって膨らみ、うねる黒紫の球になる →
  //   球を作ってから相手へ飛ばす → 命中の瞬間に球が弾けて黒紫の波が広がる）
  // 構成：①攻撃側の前に影の粒が渦を巻いて集まり、球が小さく生まれて膨らむ（生成）
  //       ②球が一瞬ためを作って脈打つ（溜め）
  //       ③球が回転しながら相手へ飛び、後ろに影の尾を引く（発射）
  //       ④命中の瞬間、球が弾けて黒紫の衝撃波と影の飛沫が広がる（炸裂）
  //       ⑤影の靄が薄れて消える（余韻）
  // 画面は揺らさない（あくのはどうと同じ方針）。ここは「球そのもの」が主役なので、
  // 球の実体は暗く（source-over）、縁の光だけ加算合成（lighter）で描いて「暗いのに光る」を出す。
  //
  // info = { from:{x,y}, to:{x,y}, scale } は spawnDarkPulseSpecial と同じ（playSpecialTypeEffect が実測）。
  // ============================================================
  const SHADOWBALL_FORM_MS = 560;      // ①生成：影が集まって球が膨らむ
  const SHADOWBALL_HOLD_MS = 140;      // ②溜め：球が脈打ってから放つまで
  const SHADOWBALL_FLIGHT_MS = 380;    // ③球が口元→相手へ届くまで
  const SHADOWBALL_LAUNCH_MS = SHADOWBALL_FORM_MS + SHADOWBALL_HOLD_MS;   // 球を放つ時刻
  // 球が相手に届く（＝ダメージの瞬間）。フラッシュ等はこの時刻に合わせる。
  const SHADOWBALL_HIT_MS = SHADOWBALL_LAUNCH_MS + SHADOWBALL_FLIGHT_MS;
  const SHADOWBALL_END_MS = SHADOWBALL_HIT_MS + 720;

  function spawnShadowBallSpecial(particles, w, h, info) {
    const from = (info && info.from) || { x: w * 0.28, y: h * 0.68 };
    const to = (info && info.to) || { x: w * 0.72, y: h * 0.32 };
    const S = (info && info.scale) || 1;
    const seed = rand(0, 100);

    const dx = to.x - from.x, dy = to.y - from.y;
    const dist = Math.hypot(dx, dy) || 1;
    const ux = dx / dist, uy = dy / dist;
    // 球を作る位置：攻撃側の中心から相手方向へ少し前に出した位置（口元／手元）
    const hand = { x: from.x + ux * 38 * S, y: from.y + uy * 38 * S - 6 * S };
    // 命中位置：相手の中心
    const target = { x: to.x, y: to.y };

    const BALL_R = 24 * S;   // 球の半径（本家同様、しっかり大きな球）

    // 影の配色：実体は漆黒〜黒紫、縁の光は赤紫〜ピンク
    const CORE_IN = '#06020c';
    const CORE_MID = '#1a0a2e';
    const CORE_OUT = '#3a1466';
    const EDGE = ['#a02cff', '#c845f0', '#ff5fc0'];

    // ---- 球の位置・大きさ・脈動を時刻(ms)から直接計算する（生成→溜め→飛翔を1本の関数で扱う）----
    function ballState(ms) {
      // 半径：生成中は小さな点からじわじわ膨らみ、溜めで少し脈打つ
      let r;
      if (ms < SHADOWBALL_FORM_MS) {
        const f = clamp01(ms / SHADOWBALL_FORM_MS);
        r = BALL_R * (0.12 + 0.88 * easeOutCubic(f));
      } else if (ms < SHADOWBALL_LAUNCH_MS) {
        const f = (ms - SHADOWBALL_FORM_MS) / SHADOWBALL_HOLD_MS;
        r = BALL_R * (1 + 0.1 * Math.sin(f * Math.PI * 2));     // 一瞬ぐっと脈打つ
      } else {
        r = BALL_R * 1.02;
      }
      // 位置：発射までは手元、発射後は相手へ（少し加速する）
      let x = hand.x, y = hand.y;
      let flight = 0;
      if (ms >= SHADOWBALL_LAUNCH_MS) {
        flight = clamp01((ms - SHADOWBALL_LAUNCH_MS) / SHADOWBALL_FLIGHT_MS);
        const e = easeInCubic(flight) * 0.35 + flight * 0.65;   // 出だしは軽く、終わりに向けて加速
        x = lerp(hand.x, target.x, e);
        y = lerp(hand.y, target.y, e);
      } else {
        // 生成中は手元でふわふわ浮く
        y += Math.sin(ms * 0.012) * 2 * S;
      }
      return { x, y, r, flight };
    }

    // 球を描く：暗い実体 + うねる表面 + 縁の赤紫の光 + 内側の影の渦
    function drawBall(ctx, ms, alpha) {
      const b = ballState(ms);
      if (alpha <= 0.01 || b.r <= 0.5) return b;
      const spin = ms * 0.012;                                  // 球の回転
      // 表面を少し波打たせた輪郭（スカスカの円ではなく「うねる影」）
      const segs = 30;
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.globalCompositeOperation = 'source-over';
      ctx.beginPath();
      for (let s = 0; s <= segs; s++) {
        const aa = (s / segs) * Math.PI * 2;
        const bump = noise1(aa * 2.6 + spin, seed) * b.r * 0.08;
        const rr = b.r + bump;
        const px = Math.cos(aa) * rr, py = Math.sin(aa) * rr;
        if (s === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      const g = ctx.createRadialGradient(-b.r * 0.28, -b.r * 0.3, 0, 0, 0, b.r * 1.05);
      g.addColorStop(0, rgba(CORE_OUT, alpha));
      g.addColorStop(0.45, rgba(CORE_MID, alpha));
      g.addColorStop(1, rgba(CORE_IN, alpha));
      ctx.fillStyle = g;
      ctx.fill();
      // 内側で回る影の渦（球が回転して見える）
      ctx.save();
      ctx.clip();
      for (let k = 0; k < 3; k++) {
        const ka = spin * (1.2 + k * 0.3) + k * 2.1;
        const kx = Math.cos(ka) * b.r * 0.42;
        const ky = Math.sin(ka) * b.r * 0.42;
        const kg = ctx.createRadialGradient(kx, ky, 0, kx, ky, b.r * 0.7);
        kg.addColorStop(0, rgba('#5a20a0', alpha * 0.55));
        kg.addColorStop(1, 'rgba(90,32,160,0)');
        ctx.fillStyle = kg;
        ctx.fillRect(-b.r, -b.r, b.r * 2, b.r * 2);
      }
      ctx.restore();
      // 縁の赤紫の光（加算合成で禍々しく光る）
      ctx.globalCompositeOperation = 'lighter';
      ctx.shadowColor = rgba(EDGE[1], 0.95);
      ctx.shadowBlur = 16 * S;
      ctx.strokeStyle = rgba(EDGE[0], alpha * 0.8);
      ctx.lineWidth = Math.max(1.5, b.r * 0.09);
      ctx.beginPath();
      ctx.arc(0, 0, b.r * 1.02, 0, Math.PI * 2);
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = rgba(EDGE[2], alpha * 0.4);
      ctx.lineWidth = Math.max(1, b.r * 0.04);
      ctx.beginPath();
      ctx.arc(0, 0, b.r * 0.9, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      return b;
    }

    function drawShadowMist(ctx, x, y, r, alpha, inner, outer) {
      if (alpha <= 0.01 || r <= 0.5) return;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, rgba(inner, alpha));
      g.addColorStop(0.55, rgba(outer, alpha * 0.7));
      g.addColorStop(1, rgba(outer, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    // ============ ①生成：手元の周りの影が球へ吸い込まれる ============
    // 球の外側にうっすら広がる、暗い影のオーラ（球の生成に合わせて膨らむ）
    particles.push({
      maxLife: SHADOWBALL_LAUNCH_MS + 60,
      draw(ctx, t) {
        const ms = t * (SHADOWBALL_LAUNCH_MS + 60);
        const f = clamp01(ms / SHADOWBALL_FORM_MS);
        const a = Math.sin(Math.PI * clamp01(t)) * 0.55;
        drawShadowMist(ctx, hand.x, hand.y, lerp(10, 58, easeOutCubic(f)) * S, a, '#0a0416', '#2a1048');
      }
    });
    // 外から球へ、螺旋を描いて吸い込まれる影の粒
    for (let i = 0; i < 20; i++) {
      const a0 = (i / 20) * Math.PI * 2 + rand(-0.25, 0.25);
      const r0 = rand(48, 92) * S;
      const sz = rand(2.6, 5.4) * S;
      const col = EDGE[i % EDGE.length];
      particles.push({
        delay: rand(0, SHADOWBALL_FORM_MS * 0.62),
        maxLife: rand(230, 340),
        draw(ctx, t) {
          if (t >= 1) return;
          const e = easeInCubic(t);
          const rr = lerp(r0, BALL_R * 0.5, e);
          const spin = a0 + t * 3.4;                        // 巻き込まれるように回転
          const x = hand.x + Math.cos(spin) * rr;
          const y = hand.y + Math.sin(spin) * rr * 0.85;
          const a = clamp01(t * 4) * (1 - Math.max(0, (t - 0.82) / 0.18));
          // 暗い実体
          ctx.fillStyle = rgba('#12081f', a * 0.95);
          ctx.beginPath();
          ctx.arc(x, y, sz, 0, Math.PI * 2);
          ctx.fill();
          // 縁の光
          ctx.globalCompositeOperation = 'lighter';
          ctx.strokeStyle = rgba(col, a * 0.8);
          ctx.lineWidth = 1.2 * S;
          ctx.shadowColor = rgba(col, 0.9);
          ctx.shadowBlur = 6 * S;
          ctx.beginPath();
          ctx.arc(x, y, sz + 0.8, 0, Math.PI * 2);
          ctx.stroke();
        }
      });
    }
    // 球が生まれる瞬間の小さな光（白ではなく赤紫）
    particles.push({
      delay: 20,
      maxLife: 260,
      blend: 'lighter',
      draw(ctx, t) {
        const a = (1 - t) * 0.6;
        const r = lerp(4 * S, 26 * S, easeOutQuint(t));
        const g = ctx.createRadialGradient(hand.x, hand.y, 0, hand.x, hand.y, r);
        g.addColorStop(0, rgba('#ffc8f2', a));
        g.addColorStop(0.5, rgba('#a02cff', a * 0.55));
        g.addColorStop(1, 'rgba(160,44,255,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(hand.x, hand.y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    });

    // ============ ①②③球本体：生成→溜め→飛翔を1つのパーティクルで描く ============
    // 命中の瞬間まで描き、命中と同時に消す（弾けるのは④が担当）。
    particles.push({
      delay: 40,
      maxLife: SHADOWBALL_HIT_MS - 40,
      draw(ctx, t) {
        const ms = 40 + t * (SHADOWBALL_HIT_MS - 40);
        const fadeIn = clamp01((ms - 40) / 120);
        drawBall(ctx, ms, fadeIn);
      }
    });

    // ============ ③飛翔中：球の後ろに引く影の尾と、こぼれる影の粒 ============
    // 尾：直近の球の位置を遡って、だんだん小さく薄くなる暗い塊を並べる
    particles.push({
      delay: SHADOWBALL_LAUNCH_MS,
      maxLife: SHADOWBALL_FLIGHT_MS + 140,
      draw(ctx, t) {
        const ms = SHADOWBALL_LAUNCH_MS + t * (SHADOWBALL_FLIGHT_MS + 140);
        const afterHit = ms > SHADOWBALL_HIT_MS;
        const tailFade = afterHit ? Math.max(0, 1 - (ms - SHADOWBALL_HIT_MS) / 140) : 1;
        if (tailFade <= 0.01) return;
        const N = 9;
        for (let k = N; k >= 1; k--) {
          const back = k * 16;                                       // 何ms前の位置か
          const b = ballState(Math.min(ms, SHADOWBALL_HIT_MS) - back);
          if (b.flight <= 0) continue;                               // まだ発射していない位置は描かない
          const f = 1 - k / (N + 1);
          drawShadowMist(ctx, b.x, b.y, b.r * (0.5 + 0.55 * f), f * 0.5 * tailFade, '#12081f', '#2a1048');
        }
        // 尾の縁の光（球の直後だけ、赤紫がにじむ）
        const head = ballState(Math.min(ms, SHADOWBALL_HIT_MS));
        ctx.globalCompositeOperation = 'lighter';
        const gl = ctx.createRadialGradient(head.x, head.y, head.r * 0.6, head.x, head.y, head.r * 1.9);
        gl.addColorStop(0, 'rgba(160,44,255,0)');
        gl.addColorStop(0.5, rgba('#a02cff', 0.32 * tailFade));
        gl.addColorStop(1, 'rgba(160,44,255,0)');
        ctx.fillStyle = gl;
        ctx.beginPath();
        ctx.arc(head.x, head.y, head.r * 1.9, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    // 飛翔中に球からこぼれ落ちる影の粒
    for (let i = 0; i < 14; i++) {
      const at = SHADOWBALL_LAUNCH_MS + (i / 14) * SHADOWBALL_FLIGHT_MS * 0.92;
      const off = rand(-1, 1);
      const rise = rand(6, 22) * S;
      const col = EDGE[i % EDGE.length];
      particles.push({
        delay: at,
        maxLife: rand(220, 340),
        blend: 'lighter',
        draw(ctx, t) {
          const b = ballState(at);                                   // こぼれた瞬間の球の位置
          const px = -uy, py = ux;                                   // 進行方向に直交
          const x = b.x + px * off * b.r * 0.9 - ux * 12 * S * t;
          const y = b.y + py * off * b.r * 0.9 - uy * 12 * S * t - rise * easeOutCubic(t);
          const a = (1 - t) * 0.85;
          ctx.fillStyle = rgba(col, a);
          ctx.shadowColor = rgba(col, 0.9);
          ctx.shadowBlur = 6 * S;
          ctx.beginPath();
          ctx.arc(x, y, 2.4 * S * (1 - t * 0.5), 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }

    // ============ ④命中：球が弾けて黒紫の衝撃波と影の飛沫が広がる ============
    // 相手を包む暗転（source-over で確実に暗く沈める。白い閃光は使わない）
    particles.push({
      delay: SHADOWBALL_HIT_MS - 20,
      maxLife: 620,
      draw(ctx, t) {
        const grow = easeOutCubic(clamp01(t / 0.22));
        const fade = t < 0.4 ? 1 : Math.pow(1 - (t - 0.4) / 0.6, 1.4);
        drawShadowMist(ctx, target.x, target.y, 74 * S * grow, fade * 0.8, '#07030d', '#1a0a2e');
      }
    });
    // 弾ける瞬間の赤紫の光（縁だけがカッと光る）
    particles.push({
      delay: SHADOWBALL_HIT_MS - 10,
      maxLife: 300,
      blend: 'lighter',
      draw(ctx, t) {
        const a = (1 - t) * 0.85;
        const r = lerp(14 * S, 70 * S, easeOutQuint(t));
        const g = ctx.createRadialGradient(target.x, target.y, r * 0.3, target.x, target.y, r);
        g.addColorStop(0, rgba('#ffc8f2', a * 0.6));
        g.addColorStop(0.55, rgba('#a02cff', a * 0.7));
        g.addColorStop(1, 'rgba(160,44,255,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(target.x, target.y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    // 広がる黒紫の衝撃波リング（暗い帯 + 赤紫の縁）
    for (let i = 0; i < 3; i++) {
      particles.push({
        delay: SHADOWBALL_HIT_MS + i * 70,
        maxLife: 420,
        draw(ctx, t) {
          const r = lerp(12 * S, 82 * S, easeOutCubic(t));
          const a = (1 - t) * 0.9;
          if (a <= 0.01) return;
          ctx.save();
          ctx.translate(target.x, target.y);
          ctx.scale(1, 0.72);
          ctx.globalCompositeOperation = 'source-over';
          ctx.strokeStyle = rgba('#12081f', a * 0.85);
          ctx.lineWidth = Math.max(2, r * 0.17) * (1 - t * 0.4);
          ctx.beginPath();
          ctx.arc(0, 0, r, 0, Math.PI * 2);
          ctx.stroke();
          ctx.globalCompositeOperation = 'lighter';
          ctx.shadowColor = rgba(EDGE[i % EDGE.length], 0.9);
          ctx.shadowBlur = 8 * S;
          ctx.strokeStyle = rgba(EDGE[i % EDGE.length], a * 0.8);
          ctx.lineWidth = Math.max(1, r * 0.05);
          ctx.beginPath();
          ctx.arc(0, 0, r * 1.08, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }
      });
    }
    // 四方へ飛び散る影の飛沫（暗い塊 + 光る粒）
    for (let i = 0; i < 16; i++) {
      const sa = rand(0, Math.PI * 2);
      const spd = rand(34, 98) * S;
      const sz = rand(3, 7) * S;
      particles.push({
        delay: SHADOWBALL_HIT_MS + rand(0, 50),
        maxLife: rand(320, 520),
        draw(ctx, t) {
          const e = easeOutCubic(t);
          const x = target.x + Math.cos(sa) * spd * e;
          const y = target.y + Math.sin(sa) * spd * e * 0.85 + t * t * 16 * S;
          const a = (1 - t) * 0.85;
          ctx.fillStyle = rgba('#12081f', a);
          ctx.beginPath();
          ctx.arc(x, y, sz * (1 - t * 0.5), 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }
    for (let i = 0; i < 22; i++) {
      const col = EDGE[i % EDGE.length];
      const sa = rand(0, Math.PI * 2);
      const spd = rand(28, 92) * S;
      const dotR = rand(1.4, 3.2) * S;
      particles.push({
        delay: SHADOWBALL_HIT_MS + rand(0, 60),
        maxLife: rand(260, 460),
        blend: 'lighter',
        draw(ctx, t) {
          const e = easeOutCubic(t);
          const x = target.x + Math.cos(sa) * spd * e;
          const y = target.y + Math.sin(sa) * spd * e - t * 10 * S;
          const a = (1 - t) * 0.9;
          ctx.fillStyle = rgba(col, a);
          ctx.shadowColor = rgba(col, 0.9);
          ctx.shadowBlur = 6;
          ctx.beginPath();
          ctx.arc(x, y, dotR * (1 - t * 0.4), 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }

    // ============ ⑤余韻：影の靄が立ちのぼって薄れる ============
    for (let i = 0; i < 9; i++) {
      const sa = rand(0, Math.PI * 2);
      const dd = rand(14, 52) * S;
      const rise = rand(14, 40) * S;
      particles.push({
        delay: SHADOWBALL_HIT_MS + 160 + rand(0, 100),
        maxLife: rand(320, 480),
        draw(ctx, t) {
          const e = easeOutCubic(t);
          const x = target.x + Math.cos(sa + t * 1.4) * dd * e;
          const y = target.y + Math.sin(sa + t * 1.4) * dd * e * 0.7 - rise * e;
          drawShadowMist(ctx, x, y, lerp(9, 20, t) * S, (1 - t) * 0.55, '#12081f', '#2a1048');
        }
      });
    }
  }

  // ============================================================
  // あくのはどう：悪意を込めた黒紫の波動を、幾重もの輪として相手へ放つ演出
  // （ダイヤモンド・パール〜 version 準拠：画面シェイクなし。着弾は「白く光る」のではなく「暗く沈む」）
  // 構成：①攻撃側の前で、黒紫の波動が渦を巻いて口元に集まる（チャージ）
  //       ②口元から、縁に赤紫の光を宿した黒紫の輪が、波紋のように次々と相手へ広がりながら進む（発射）
  //       ③輪が相手を包み込み、相手の周りが黒紫の靄で暗く沈む（照射）
  //       ④波動が弱まり、黒紫の靄と細かな闇の粒が渦を巻いて霧散する（余韻）
  // シグナルビーム（細い虹色の輪）との違いは「輪が進むほど大きく広がる」「黒い実体（source-over）と縁の光（lighter）の二層」「暗転」。
  //
  // info = { from:{x,y}, to:{x,y}, scale } は spawnSignalBeamSpecial と同じ（playSpecialTypeEffect が実測）。
  // ============================================================
  const DARKPULSE_CHARGE_MS = 380;      // ①チャージ（波動が渦を巻いて集まる）
  const DARKPULSE_FLIGHT_MS = 340;      // 輪1つが口元→相手へ届くまで
  const DARKPULSE_EMIT_MS = 520;        // ②③輪を撃ち出し続ける時間
  const DARKPULSE_RING_COUNT = 6;       // 撃ち出す輪の数
  // 最初の輪が相手に届く（＝ダメージの瞬間）。フラッシュ等はこの時刻に合わせる。
  const DARKPULSE_HIT_MS = DARKPULSE_CHARGE_MS + DARKPULSE_FLIGHT_MS;
  const DARKPULSE_EMIT_END_MS = DARKPULSE_CHARGE_MS + DARKPULSE_EMIT_MS;
  const DARKPULSE_END_MS = DARKPULSE_EMIT_END_MS + DARKPULSE_FLIGHT_MS + 260;

  function spawnDarkPulseSpecial(particles, w, h, info) {
    const from = (info && info.from) || { x: w * 0.28, y: h * 0.68 };
    const to = (info && info.to) || { x: w * 0.72, y: h * 0.32 };
    const S = (info && info.scale) || 1;

    // 悪の波動の配色：漆黒〜黒紫の実体、縁は赤紫〜ピンクの禍々しい光
    const CORE = ['#0d0616', '#1a0d2b', '#2a1245'];   // 輪の実体（暗い）
    const EDGE = ['#b13bff', '#d24fd8', '#ff5fb0'];   // 輪の縁の光（明るい）

    const dx = to.x - from.x, dy = to.y - from.y;
    const len = Math.hypot(dx, dy) || 1;
    const ang = Math.atan2(dy, dx);
    // 発射口：攻撃側の中心から相手方向へ少し前に出した位置
    const muzzle = { x: from.x + Math.cos(ang) * 36 * S, y: from.y + Math.sin(ang) * 36 * S };
    const travel = Math.hypot(to.x - muzzle.x, to.y - muzzle.y) || 1;

    // ---- 波動の輪を描くヘルパー ----
    // 進行方向に面した「縦長の楕円リング」。u=0（口元）→1（相手）で大きく広がる。
    // 実体（暗い帯：通常合成）と、縁の光（加算合成）の二層で「暗いのに禍々しく光る」を出す。
    function drawWaveRing(ctx, x, y, r, alpha, wobble, colIdx) {
      if (alpha <= 0.01 || r <= 0.5) return;
      const core = CORE[((colIdx % CORE.length) + CORE.length) % CORE.length];
      const edge = EDGE[((colIdx % EDGE.length) + EDGE.length) % EDGE.length];
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(ang);
      ctx.scale(0.42, 1);                 // 進行方向から見た輪（縦に長い楕円）
      ctx.rotate(wobble);                 // 輪のゆらぎ（不安定な波動感）
      // 実体：黒紫の太い帯（暗さを出す）
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = rgba(core, alpha * 0.92);
      ctx.lineWidth = Math.max(2, r * 0.3);
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.stroke();
      // 縁の光：外側と内側に赤紫の細い輪郭
      ctx.globalCompositeOperation = 'lighter';
      ctx.shadowColor = rgba(edge, 0.95);
      ctx.shadowBlur = 10 * S;
      ctx.strokeStyle = rgba(edge, alpha * 0.85);
      ctx.lineWidth = Math.max(1, r * 0.07);
      ctx.beginPath();
      ctx.arc(0, 0, r * 1.16, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = rgba(edge, alpha * 0.45);
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.84, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // 暗い靄の塊（source-over）
    function drawDarkMist(ctx, x, y, r, alpha, innerCol, outerCol) {
      if (alpha <= 0.01 || r <= 0.5) return;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, rgba(innerCol, alpha));
      g.addColorStop(0.55, rgba(outerCol, alpha * 0.7));
      g.addColorStop(1, rgba(outerCol, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    // ============ ①チャージ：口元に黒紫の波動が渦を巻いて集まる ============
    // 口元の暗い核（だんだん濃く・大きくなる）
    particles.push({
      maxLife: DARKPULSE_CHARGE_MS + 100,
      draw(ctx, t) {
        const a = Math.sin(Math.PI * clamp01(t * 0.95)) * 0.9;
        const r = lerp(6 * S, 30 * S, easeOutCubic(t));
        drawDarkMist(ctx, muzzle.x, muzzle.y, r, a, '#0d0616', '#2a1245');
      }
    });
    // 核のまわりの赤紫の光（発光の縁）
    particles.push({
      maxLife: DARKPULSE_CHARGE_MS + 100,
      blend: 'lighter',
      draw(ctx, t) {
        const a = Math.sin(Math.PI * clamp01(t)) * 0.5;
        const r = lerp(8 * S, 34 * S, easeOutCubic(t));
        const g = ctx.createRadialGradient(muzzle.x, muzzle.y, r * 0.35, muzzle.x, muzzle.y, r);
        g.addColorStop(0, 'rgba(177,59,255,0)');
        g.addColorStop(0.7, rgba('#b13bff', a));
        g.addColorStop(1, 'rgba(177,59,255,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(muzzle.x, muzzle.y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    // 外から吸い込まれる、渦を巻く波動の筋
    for (let i = 0; i < 9; i++) {
      const a0 = (i / 9) * Math.PI * 2 + rand(-0.2, 0.2);
      const col = EDGE[i % EDGE.length];
      particles.push({
        delay: 20 + i * 26,
        maxLife: DARKPULSE_CHARGE_MS - 30 - i * 20,
        draw(ctx, t) {
          const outer = lerp(56 * S, 5 * S, easeInCubic(t));
          const spin = a0 + t * 5.2;             // 巻き込まれるように回転
          const x = muzzle.x + Math.cos(spin) * outer;
          const y = muzzle.y + Math.sin(spin) * outer * 0.62;
          const alpha = Math.sin(Math.PI * clamp01(t)) * 0.9;
          // 暗い塊（実体）
          ctx.fillStyle = rgba('#12081f', alpha);
          ctx.beginPath();
          ctx.arc(x, y, lerp(5, 2.4, t) * S, 0, Math.PI * 2);
          ctx.fill();
          // 縁の光
          ctx.globalCompositeOperation = 'lighter';
          ctx.strokeStyle = rgba(col, alpha * 0.8);
          ctx.lineWidth = 1.2 * S;
          ctx.shadowColor = rgba(col, 0.9);
          ctx.shadowBlur = 6 * S;
          ctx.beginPath();
          ctx.arc(x, y, lerp(5, 2.4, t) * S + 1, 0, Math.PI * 2);
          ctx.stroke();
        }
      });
    }

    // ============ ②発射：輪を次々と撃ち出す ============
    // 1つの輪は「口元で小さく → 相手の位置で大きく」広がりながら進む。
    const ringInterval = (DARKPULSE_EMIT_MS - 60) / (DARKPULSE_RING_COUNT - 1);
    for (let i = 0; i < DARKPULSE_RING_COUNT; i++) {
      const launch = DARKPULSE_CHARGE_MS + i * ringInterval;
      const wob = rand(-0.5, 0.5);
      particles.push({
        delay: launch,
        maxLife: DARKPULSE_FLIGHT_MS + 90,
        draw(ctx, t) {
          const u = easeInOutSine(clamp01(t * (DARKPULSE_FLIGHT_MS + 90) / DARKPULSE_FLIGHT_MS));
          const pu = Math.min(1, u);
          const x = lerp(muzzle.x, to.x, pu);
          const y = lerp(muzzle.y, to.y, pu);
          // 進むほど輪が大きく広がる（波紋のように）
          const r = lerp(9 * S, 46 * S, easeOutCubic(pu));
          // 出だしは立ち上がり、相手を通り抜けるあたりで薄れる
          const fadeIn = clamp01(t / 0.12);
          const fadeOut = t < 0.78 ? 1 : 1 - (t - 0.78) / 0.22;
          const alpha = fadeIn * fadeOut;
          drawWaveRing(ctx, x, y, r, alpha, wob + t * 1.4, i);
        }
      });
      // 輪の直後に引く、暗い残像の靄（尾を引く）
      particles.push({
        delay: launch + 30,
        maxLife: DARKPULSE_FLIGHT_MS,
        draw(ctx, t) {
          const u = easeInOutSine(clamp01(t));
          const x = lerp(muzzle.x, to.x, u);
          const y = lerp(muzzle.y, to.y, u);
          const r = lerp(14 * S, 40 * S, easeOutCubic(u));
          const a = Math.sin(Math.PI * clamp01(t)) * 0.4;
          drawDarkMist(ctx, x, y, r, a, '#160a26', '#2a1245');
        }
      });
    }

    // 波動の通り道：口元→相手をうっすら覆う暗い帯（輪が通った跡が暗く沈む）
    particles.push({
      delay: DARKPULSE_CHARGE_MS,
      maxLife: DARKPULSE_EMIT_END_MS - DARKPULSE_CHARGE_MS + DARKPULSE_FLIGHT_MS * 0.5,
      draw(ctx, t) {
        const total = DARKPULSE_EMIT_END_MS - DARKPULSE_CHARGE_MS + DARKPULSE_FLIGHT_MS * 0.5;
        const ms = t * total;
        const reach = easeOutCubic(clamp01(ms / DARKPULSE_FLIGHT_MS));
        const k = t < 0.75 ? 1 : 1 - (t - 0.75) / 0.25;
        const tipX = lerp(muzzle.x, to.x, reach);
        const tipY = lerp(muzzle.y, to.y, reach);
        const gr = ctx.createLinearGradient(muzzle.x, muzzle.y, tipX, tipY);
        gr.addColorStop(0, rgba('#12081f', 0.55 * k));
        gr.addColorStop(1, rgba('#12081f', 0.15 * k));
        ctx.strokeStyle = gr;
        ctx.lineCap = 'round';
        ctx.lineWidth = lerp(14, 46, reach) * S;
        ctx.beginPath();
        ctx.moveTo(muzzle.x, muzzle.y);
        ctx.lineTo(tipX, tipY);
        ctx.stroke();
      }
    });

    // 発射口の閃光（黒紫の光がぱっと広がる。白ではなく赤紫）
    particles.push({
      delay: DARKPULSE_CHARGE_MS - 15,
      maxLife: 240,
      blend: 'lighter',
      draw(ctx, t) {
        const a = (1 - t) * 0.8;
        const r = lerp(8 * S, 42 * S, easeOutQuint(t));
        const g = ctx.createRadialGradient(muzzle.x, muzzle.y, 0, muzzle.x, muzzle.y, r);
        g.addColorStop(0, rgba('#ffd0f5', a));
        g.addColorStop(0.45, rgba('#b13bff', a * 0.6));
        g.addColorStop(1, 'rgba(177,59,255,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(muzzle.x, muzzle.y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    });

    // ============ ③着弾：相手が黒紫の靄に包まれて暗く沈む ============
    const holdMs = DARKPULSE_EMIT_END_MS - DARKPULSE_HIT_MS + 120;
    const fadeMs = DARKPULSE_END_MS - DARKPULSE_EMIT_END_MS;
    // 相手を包む大きな暗転（source-over で確実に暗くする）
    particles.push({
      delay: DARKPULSE_HIT_MS - 30,
      maxLife: holdMs + fadeMs + 30,
      draw(ctx, t) {
        const ms = t * (holdMs + fadeMs + 30);
        const grow = easeOutCubic(clamp01(ms / 140));
        const fade = ms > holdMs ? Math.pow(1 - clamp01((ms - holdMs) / fadeMs), 1.4) : 1;
        const r = 78 * S * grow * (0.85 + 0.15 * fade);
        const a = fade * 0.78;
        drawDarkMist(ctx, to.x, to.y, r, a, '#07030d', '#1a0d2b');
      }
    });
    // 暗転の縁でうねる赤紫の光（相手の輪郭が禍々しく光る）
    particles.push({
      delay: DARKPULSE_HIT_MS - 30,
      maxLife: holdMs + fadeMs + 30,
      blend: 'lighter',
      draw(ctx, t) {
        const ms = t * (holdMs + fadeMs + 30);
        const grow = easeOutCubic(clamp01(ms / 140));
        const fade = ms > holdMs ? Math.pow(1 - clamp01((ms - holdMs) / fadeMs), 1.3) : 1;
        const pulse = 0.85 + 0.15 * Math.sin(ms * 0.03);
        const r = 70 * S * grow * pulse;
        const a = fade * 0.42;
        if (a <= 0.01) return;
        const g = ctx.createRadialGradient(to.x, to.y, r * 0.5, to.x, to.y, r);
        g.addColorStop(0, 'rgba(177,59,255,0)');
        g.addColorStop(0.75, rgba('#b13bff', a));
        g.addColorStop(1, 'rgba(255,95,176,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(to.x, to.y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    // 相手の上で弾けて広がる、着弾のリング（届いた輪が相手の周りで波打つ）
    for (let i = 0; i < 5; i++) {
      particles.push({
        delay: DARKPULSE_HIT_MS + i * 70,
        maxLife: 380,
        draw(ctx, t) {
          const r = lerp(14 * S, 66 * S, easeOutCubic(t));
          const alpha = (1 - t) * 0.9;
          if (alpha <= 0.01) return;
          ctx.save();
          ctx.translate(to.x, to.y);
          ctx.scale(1, 0.62);                 // 相手の足元に広がる平たい波紋
          ctx.globalCompositeOperation = 'source-over';
          ctx.strokeStyle = rgba('#12081f', alpha * 0.85);
          ctx.lineWidth = Math.max(2, r * 0.16) * (1 - t * 0.4);
          ctx.beginPath();
          ctx.arc(0, 0, r, 0, Math.PI * 2);
          ctx.stroke();
          ctx.globalCompositeOperation = 'lighter';
          ctx.strokeStyle = rgba(EDGE[i % EDGE.length], alpha * 0.8);
          ctx.lineWidth = Math.max(1, r * 0.05);
          ctx.shadowColor = rgba(EDGE[i % EDGE.length], 0.9);
          ctx.shadowBlur = 8 * S;
          ctx.beginPath();
          ctx.arc(0, 0, r * 1.08, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }
      });
    }

    // ============ ④余韻：黒紫の靄が渦を巻いて立ちのぼり、闇の粒が霧散する ============
    const burstAt = DARKPULSE_EMIT_END_MS;
    for (let i = 0; i < 12; i++) {
      const sa = rand(0, Math.PI * 2);
      const dist = rand(18, 60) * S;
      const rise = rand(14, 44) * S;
      particles.push({
        delay: burstAt + rand(0, 90),
        maxLife: rand(320, 520),
        draw(ctx, t) {
          const e = easeOutCubic(t);
          const x = to.x + Math.cos(sa + t * 1.6) * dist * e;
          const y = to.y + Math.sin(sa + t * 1.6) * dist * e * 0.7 - rise * e;
          const a = (1 - t) * 0.6;
          const r = lerp(9, 20, t) * S;
          drawDarkMist(ctx, x, y, r, a, '#12081f', '#2a1245');
        }
      });
    }
    for (let i = 0; i < 18; i++) {
      const col = EDGE[i % EDGE.length];
      const sa = rand(0, Math.PI * 2);
      const spd = rand(24, 76) * S;
      const dotR = rand(1.4, 3) * S;
      particles.push({
        delay: burstAt - 60 + rand(0, 80),
        maxLife: rand(260, 460),
        blend: 'lighter',
        draw(ctx, t) {
          const e = easeOutCubic(t);
          const x = to.x + Math.cos(sa) * spd * e;
          const y = to.y + Math.sin(sa) * spd * e - t * 12 * S;   // 闇の粒はふわりと浮く
          const a = (1 - t) * 0.9;
          ctx.fillStyle = rgba(col, a);
          ctx.shadowColor = rgba(col, 0.9);
          ctx.shadowBlur = 6;
          ctx.beginPath();
          ctx.arc(x, y, dotR * (1 - t * 0.4), 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }
  }

  // ============================================================
  // グラベルブレス：口元に砂利を含んだ息を溜め、砂礫の奔流を相手へ吹きつけて叩き込む演出
  // ジェムレーザー（一点集中の光線）と対比させ、こちらは「広がる砂礫の奔流」で見せる。
  // 構成：①攻撃側の口元に砂埃が渦を巻いて集まり、息を吸い込むように溜める（チャージ）
  //       ②息が吹き出し、砂利・小石・砂塵が扇状に広がりながら相手へ一気に流れ込む（噴射）
  //       ③砂礫が相手に降りかかり続け、当たった石が弾けて跳ね返る（照射）
  //       ④奔流が弱まり、砂煙が相手の周りに舞い上がって晴れていく（余韻）
  // 「ビームではなく粒の集合」「奥行き（手前が大きく速い・奥が小さく遅い）」「砂煙が風に流される」がキモ。
  //
  // info = { from:{x,y}, to:{x,y}, scale } は spawnPowerGemSpecial と同じ（playSpecialTypeEffect が実測）。
  // ============================================================
  const GRAVELBREATH_CHARGE_MS = 480;    // ①チャージ（砂埃が口元へ集まる）
  const GRAVELBREATH_BLAST_MS = 640;     // ②③砂礫を噴射し続ける時間
  const GRAVELBREATH_FLIGHT_MS = 300;    // 砂礫1粒が口元→相手へ飛ぶ時間
  // 最初の砂礫が相手に届く（＝ダメージの瞬間）。フラッシュ等はこの時刻に合わせる。
  const GRAVELBREATH_HIT_MS = GRAVELBREATH_CHARGE_MS + GRAVELBREATH_FLIGHT_MS;
  // 砂礫の噴射が終わる時刻（最後の1粒が発射される時刻）
  const GRAVELBREATH_BLAST_END_MS = GRAVELBREATH_CHARGE_MS + GRAVELBREATH_BLAST_MS;
  const GRAVELBREATH_END_MS = GRAVELBREATH_BLAST_END_MS + GRAVELBREATH_FLIGHT_MS;

  function spawnGravelBreathSpecial(particles, w, h, info) {
    const from = (info && info.from) || { x: w * 0.28, y: h * 0.68 };
    const to = (info && info.to) || { x: w * 0.72, y: h * 0.32 };
    const S = (info && info.scale) || 1;
    const R = Math.max(w, h);

    // 砂利・岩の配色（既存の地面/岩系に合わせた黄土〜茶〜灰）
    const STONE = [
      { base: '#8a6a45', hi: '#c9a878', lo: '#5a4329' }, // 茶色い石
      { base: '#9c8563', hi: '#d8c6a0', lo: '#65523a' }, // 明るい砂岩
      { base: '#7a6a58', hi: '#b8a890', lo: '#4a3f33' }, // 灰茶の礫
      { base: '#a58257', hi: '#e0c08a', lo: '#6e5335' }, // 黄土の石
      { base: '#6f6a64', hi: '#a8a29a', lo: '#3f3b37' }, // 灰色の石
    ];
    const DUST = ['#d8c6a0', '#c9a878', '#b8a07a', '#e4d6b4']; // 砂塵の色

    // ビームと違い「扇状に広がる」ため、進行方向と直交方向の基準ベクトルを用意する。
    const dx = to.x - from.x, dy = to.y - from.y;
    const len = Math.hypot(dx, dy) || 1;
    const ang = Math.atan2(dy, dx);
    const ux = dx / len, uy = dy / len;          // 進行方向の単位ベクトル
    const nx = -uy, ny = ux;                      // 直交方向の単位ベクトル
    // 口元：攻撃側の中心から相手方向へ少し前
    const mouth = { x: from.x + ux * 34 * S, y: from.y + uy * 34 * S };

    // ---- 石（多角形の礫）を描くヘルパー ----
    // 不規則な多角形＋明暗の面で「ゴツゴツした石」に見せる。sides/jitter は生成時に固定した値を渡す。
    function drawStone(ctx, x, y, size, rot, col, alpha, shape) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rot);
      const n = shape.length;
      // 本体（暗い下地）
      ctx.fillStyle = rgba(col.base, alpha);
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const r = size * shape[i];
        i === 0 ? ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r) : ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      ctx.closePath();
      ctx.fill();
      // 明るい面（左上側だけ塗って立体感を出す）
      ctx.fillStyle = rgba(col.hi, alpha * 0.7);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      for (let i = 0; i < Math.ceil(n / 2); i++) {
        const a = (i / n) * Math.PI * 2 + Math.PI * 0.75;
        const r = size * shape[i % n];
        ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      ctx.closePath();
      ctx.fill();
      // 影の面（右下）
      ctx.fillStyle = rgba(col.lo, alpha * 0.55);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      for (let i = 0; i < Math.ceil(n / 2); i++) {
        const a = (i / n) * Math.PI * 2 - Math.PI * 0.25;
        const r = size * shape[(i + 2) % n];
        ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    // 石の輪郭（各頂点の半径の揺らぎ）を作る。生成時に1度だけ決めて固定する（毎フレーム変えるとチラつく）。
    function makeShape() {
      const n = 5 + ((rand(0, 3)) | 0);          // 5〜7角形
      const arr = [];
      for (let i = 0; i < n; i++) arr.push(rand(0.65, 1.15));
      return arr;
    }

    // 砂煙の塊（ぼんやりした円グラデ）を描くヘルパー
    function drawDust(ctx, x, y, r, alpha, color) {
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, rgba(color, alpha));
      g.addColorStop(0.6, rgba(color, alpha * 0.5));
      g.addColorStop(1, rgba(color, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    // ============ ①チャージ：砂埃が口元へ集まる ============
    // 攻撃側の足元に土煙
    particles.push({
      maxLife: GRAVELBREATH_CHARGE_MS + 160,
      draw(ctx, t) {
        const a = Math.sin(Math.PI * clamp01(t)) * 0.4;
        drawDust(ctx, from.x, from.y + 10 * S, lerp(16 * S, 60 * S, easeOutCubic(t)), a, '#c9a878');
      }
    });
    // 周囲の砂埃と小石が、渦を巻きながら口元へ吸い込まれる（息を吸い込む＝溜め）
    for (let i = 0; i < 26; i++) {
      const a0 = (i / 26) * Math.PI * 2 + rand(-0.25, 0.25);
      const r0 = rand(46, 96) * Math.min(S, 1.0);   // 吸い込み半径は S=1.0 で頭打ち（大きい画面で散らかるのを防ぐ）
      const startAt = rand(0, 260);
      const life = rand(220, 320);
      const isStone = i % 3 === 0;
      const col = STONE[i % STONE.length];
      const dustCol = DUST[i % DUST.length];
      const size = (isStone ? rand(2.4, 4.2) : rand(7, 13)) * S;
      const shape = makeShape();
      particles.push({
        delay: startAt,
        maxLife: life,
        draw(ctx, t) {
          if (t >= 1) return; // 吸い込まれたら消える（居残り防止）
          const e = easeInCubic(t);
          const rr = lerp(r0, 3 * S, e);
          const spin = a0 + t * 2.6;
          const x = mouth.x + Math.cos(spin) * rr;
          const y = mouth.y + Math.sin(spin) * rr * 0.75;
          const a = clamp01(t * 4) * (1 - Math.max(0, (t - 0.85) / 0.15));
          if (isStone) drawStone(ctx, x, y, size, t * 9, col, a, shape);
          else drawDust(ctx, x, y, size, a * 0.5, dustCol);
        }
      });
    }
    // 口元に溜まる砂色の光（溜めるほど濃く大きく）
    particles.push({
      delay: 100,
      maxLife: GRAVELBREATH_CHARGE_MS - 60,
      draw(ctx, t) {
        const a = clamp01(t * 2) * (1 - Math.max(0, (t - 0.9) / 0.1)) * 0.6;
        drawDust(ctx, mouth.x, mouth.y, lerp(8 * S, 34 * S, easeOutCubic(t)), a, '#e4d6b4');
      }
    });

    // ============ ②③砂礫の奔流：扇状に広がりながら相手へ ============
    // 粒ごとに「発射時刻・扇の角度オフセット・速度・大きさ」をあらかじめ決める。
    // 手前（近い）ほど大きく速く、奥ほど小さく遅い…ではなく、ここでは粒の「サイズ階層」で奥行きを出す:
    //   大粒(少数・大きく直線的) / 中粒 / 小粒(多数・細かい砂で相手の周りに広がる)。
    const STONE_COUNT = 46;   // 石（多角形の礫）
    const SAND_COUNT = 90;    // 細かい砂粒（点）
    // 扇の広がり：口元では細く、相手に近づくほど広がる（＝ブレスの形）
    const SPREAD_END = 0.55 * 62 * S;   // 相手位置での扇の半幅(px)

    for (let i = 0; i < STONE_COUNT; i++) {
      const launch = GRAVELBREATH_CHARGE_MS + rand(0, GRAVELBREATH_BLAST_MS);
      const side = rand(-1, 1);                   // 扇の中の左右位置（-1〜1）
      const col = STONE[i % STONE.length];
      const shape = makeShape();
      const size = rand(3.2, 7.2) * S;
      const flight = GRAVELBREATH_FLIGHT_MS * rand(0.8, 1.15);
      const spin = rand(-12, 12);
      const bob = rand(-0.18, 0.18);              // 進行方向のゆらぎ（直線ではなく風に乗る感じ）
      const seed = rand(0, 100);
      particles.push({
        delay: launch,
        maxLife: flight,
        draw(ctx, t) {
          const e = easeInCubic(t) * 0.5 + t * 0.5;   // 加速しながら飛ぶ
          // 扇状の位置：進行方向に進むほど、直交方向へ広がる
          const fan = side * SPREAD_END * e;
          const wave = Math.sin(t * 9 + seed) * 5 * S * (1 - t) + bob * 40 * S * e;
          const px = mouth.x + (to.x - mouth.x) * e + nx * (fan + wave);
          const py = mouth.y + (to.y - mouth.y) * e + ny * (fan + wave);
          const a = clamp01(t * 8) * (t > 0.92 ? (1 - (t - 0.92) / 0.08) : 1);
          // 進行方向に向かって細長くブレる石の残像（速度感）
          for (let k = 3; k >= 1; k--) {
            const te = Math.max(0, e - k * 0.035);
            const tx = mouth.x + (to.x - mouth.x) * te + nx * (side * SPREAD_END * te + wave);
            const ty = mouth.y + (to.y - mouth.y) * te + ny * (side * SPREAD_END * te + wave);
            ctx.fillStyle = rgba('#d8c6a0', a * (0.16 - k * 0.03));
            ctx.beginPath();
            ctx.arc(tx, ty, size * (0.75 - k * 0.12), 0, Math.PI * 2);
            ctx.fill();
          }
          drawStone(ctx, px, py, size * (0.7 + 0.3 * e), t * spin, col, a, shape);
        }
      });
    }
    // 細かい砂粒（数が多く、奔流の密度と「砂の風」を作る）
    for (let i = 0; i < SAND_COUNT; i++) {
      const launch = GRAVELBREATH_CHARGE_MS + rand(0, GRAVELBREATH_BLAST_MS + 60);
      const side = rand(-1.15, 1.15);
      const dustCol = DUST[i % DUST.length];
      const size = rand(1.2, 2.6) * S;
      const flight = GRAVELBREATH_FLIGHT_MS * rand(0.7, 1.05);
      const seed = rand(0, 100);
      particles.push({
        delay: launch,
        maxLife: flight,
        draw(ctx, t) {
          const e = easeOutCubic(t) * 0.6 + t * 0.4;   // 砂は軽いので序盤に勢いよく出て、失速する
          const fan = side * SPREAD_END * (0.4 + e * 0.9);
          const wave = Math.sin(t * 11 + seed) * 7 * S * (1 - t * 0.5);
          const px = mouth.x + (to.x - mouth.x) * e + nx * (fan + wave);
          const py = mouth.y + (to.y - mouth.y) * e + ny * (fan + wave);
          const a = clamp01(t * 6) * (1 - t * 0.7);
          ctx.fillStyle = rgba(dustCol, a * 0.9);
          ctx.fillRect(px - size / 2, py - size / 2, size, size);
        }
      });
    }
    // 奔流を包む砂煙（ブレス全体が「砂まじりの風」に見えるように、口元→相手へ流れる煙の塊）
    for (let i = 0; i < 16; i++) {
      const launch = GRAVELBREATH_CHARGE_MS + i * (GRAVELBREATH_BLAST_MS / 16);
      const side = rand(-0.9, 0.9);
      const dustCol = DUST[i % DUST.length];
      const r = rand(16, 30) * S;
      particles.push({
        delay: launch,
        maxLife: GRAVELBREATH_FLIGHT_MS + 180,
        draw(ctx, t) {
          const e = easeOutCubic(t);
          const fan = side * SPREAD_END * (0.3 + e);
          const px = mouth.x + (to.x - mouth.x) * e + nx * fan;
          const py = mouth.y + (to.y - mouth.y) * e + ny * fan;
          const a = Math.sin(Math.PI * clamp01(t)) * 0.28;
          drawDust(ctx, px, py, r * (0.6 + e * 1.1), a, dustCol);
        }
      });
    }

    // 発射口の吹き出し（息が吹き出す瞬間の砂煙の破裂）
    particles.push({
      delay: GRAVELBREATH_CHARGE_MS - 20,
      maxLife: 300,
      draw(ctx, t) {
        const a = (1 - t) * 0.7;
        drawDust(ctx, mouth.x, mouth.y, lerp(10 * S, 56 * S, easeOutQuint(t)), a, '#e4d6b4');
      }
    });

    // ============ ③着弾：砂礫が相手に降りかかり続ける ============
    // 相手の上に立ち込める砂煙（噴射の間ずっと濃くなり、終わると晴れていく）
    particles.push({
      delay: GRAVELBREATH_HIT_MS - 40,
      maxLife: (GRAVELBREATH_BLAST_END_MS - GRAVELBREATH_HIT_MS) + 520,
      draw(ctx, t) {
        const total = (GRAVELBREATH_BLAST_END_MS - GRAVELBREATH_HIT_MS) + 520;
        const ms = t * total;
        const active = GRAVELBREATH_BLAST_END_MS - GRAVELBREATH_HIT_MS + 40;
        const grow = easeOutCubic(clamp01(ms / 160));
        const fade = ms > active ? 1 - clamp01((ms - active) / (total - active)) : 1;
        const a = grow * fade * 0.55;
        if (a <= 0.01) return;
        // 揺らぎのある複数の塊を重ねて「モクモクした煙」に見せる
        for (let k = 0; k < 5; k++) {
          const off = noise1(ms * 0.006 + k * 3.1, k + 1.7) * 22 * S;
          const off2 = noise1(ms * 0.005 + k * 2.3, k + 5.9) * 16 * S;
          drawDust(ctx, to.x + off, to.y + off2 - k * 3 * S, (34 + k * 6) * S * (0.7 + 0.3 * grow), a * (0.9 - k * 0.1), DUST[k % DUST.length]);
        }
      }
    });
    // 当たった石が弾けて跳ね返る（噴射中ずっと出続ける）
    for (let i = 0; i < 40; i++) {
      const born = GRAVELBREATH_HIT_MS + rand(0, GRAVELBREATH_BLAST_MS);
      const col = STONE[i % STONE.length];
      const shape = makeShape();
      // 手前（攻撃側）へ向けて弾かれる方向＋ばらつき
      const bounceAng = ang + Math.PI + rand(-1.3, 1.3);
      const spd = rand(28, 88) * S;
      const size = rand(1.8, 3.6) * S;
      const spin = rand(-14, 14);
      const hitOff = { x: rand(-20, 20) * S, y: rand(-20, 20) * S };
      particles.push({
        delay: born,
        maxLife: rand(230, 380),
        draw(ctx, t) {
          const e = easeOutCubic(t);
          const x = to.x + hitOff.x + Math.cos(bounceAng) * spd * e;
          // 弾かれた石は重力で落ちる
          const y = to.y + hitOff.y + Math.sin(bounceAng) * spd * e * 0.85 + t * t * 34 * S;
          const a = 1 - Math.max(0, (t - 0.55) / 0.45);
          drawStone(ctx, x, y, size, t * spin, col, a, shape);
        }
      });
    }
    // 着弾の細かい砂しぶき（相手の周りに弾ける砂粒）
    for (let i = 0; i < 44; i++) {
      const born = GRAVELBREATH_HIT_MS + rand(0, GRAVELBREATH_BLAST_MS + 60);
      const dustCol = DUST[i % DUST.length];
      const a1 = rand(0, Math.PI * 2);
      const spd = rand(20, 70) * S;
      const sz = rand(1.4, 2.8) * S;
      particles.push({
        delay: born,
        maxLife: rand(200, 340),
        draw(ctx, t) {
          const e = easeOutCubic(t);
          const x = to.x + Math.cos(a1) * spd * e;
          const y = to.y + Math.sin(a1) * spd * e * 0.7 + t * t * 18 * S;
          ctx.fillStyle = rgba(dustCol, (1 - t) * 0.85);
          ctx.fillRect(x - sz / 2, y - sz / 2, sz, sz);
        }
      });
    }

    // ============ ④余韻：奔流が弱まり、砂煙が舞い上がって晴れる ============
    const tail = GRAVELBREATH_BLAST_END_MS;
    // 地面を這う砂埃の衝撃波（着弾の総仕上げ）
    particles.push({
      delay: tail - 60,
      maxLife: 380,
      draw(ctx, t) {
        const r = lerp(10 * S, 78 * S, easeOutQuint(t));
        ctx.strokeStyle = rgba('#d8c6a0', (1 - t) * 0.55);
        ctx.lineWidth = 5 * (1 - t * 0.6);
        ctx.beginPath();
        ctx.ellipse(to.x, to.y + 8 * S, r, r * 0.42, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    });
    // 舞い上がる砂煙（ゆっくり上へ昇って消える）
    for (let i = 0; i < 9; i++) {
      const ox = rand(-34, 34) * S;
      const dustCol = DUST[i % DUST.length];
      const r = rand(20, 34) * S;
      particles.push({
        delay: tail - 100 + rand(0, 160),
        maxLife: rand(420, 600),
        draw(ctx, t) {
          const rise = easeOutCubic(t);
          const y = to.y + 6 * S - rise * 42 * S;
          const x = to.x + ox + Math.sin(t * 4 + ox) * 8 * S;
          const a = (t < 0.2 ? t / 0.2 : (1 - Math.max(0, (t - 0.4) / 0.6))) * 0.34;
          drawDust(ctx, x, y, r * (0.8 + t * 0.7), a, dustCol);
        }
      });
    }
  }

  // ============================================================
  // ステルスロック：尖った岩が相手を取り巻くように浮かび、輪郭だけを残して透明になり、場に溶けて消える演出
  // 攻撃技ではなく「場に岩を撒く設置技」なので、ダメージ演出（ヒット/フラッシュ）は出さない。
  // 構成：①攻撃側の前に岩片が現れ、宙に浮かぶ（予兆）
  //       ②岩が相手の周囲へ飛び、円を描いて巻きつく（取り巻き）
  //       ③岩が輪郭だけを残して透け、その輪郭も溶けて見えなくなる（透明化＝場に潜む）
  //       ④相手の足元に、ごくわずかな岩の気配（ひび割れ模様の淡い光）だけが残って消える（余韻）
  // 「岩が“回りながら”取り巻く」「実体→輪郭のみ→無、の2段階で透ける」がキモ。
  //
  // info = { from:{x,y}, to:{x,y}, scale } は spawnPowerGemSpecial と同じ（playSpecialTypeEffect が実測）。
  // ここでの to は「岩を撒く相手（被弾側）」の位置。
  // ============================================================
  const STEALTHROCK_GATHER_MS = 380;     // ①岩片が現れて浮かぶ
  const STEALTHROCK_FLY_MS = 420;        // ②岩が相手の周りへ飛ぶ時間（重い岩なので宝石よりゆっくり）
  const STEALTHROCK_ORBIT_MS = 620;      // ②③相手の周りを回り続ける時間（この間に透けていく）
  // 岩が相手の周囲に着く時刻（＝「巻かれた」瞬間）
  const STEALTHROCK_ARRIVE_MS = STEALTHROCK_GATHER_MS + STEALTHROCK_FLY_MS;
  const STEALTHROCK_END_MS = STEALTHROCK_ARRIVE_MS + STEALTHROCK_ORBIT_MS;

  function spawnStealthRockSpecial(particles, w, h, info) {
    const from = (info && info.from) || { x: w * 0.28, y: h * 0.68 };
    const to = (info && info.to) || { x: w * 0.72, y: h * 0.32 };
    const S = (info && info.scale) || 1;
    const R = Math.max(w, h);

    // 岩の配色（ステルスロック＝灰青がかった重い岩。グラベルブレスの茶色い砂利と差別化する）
    const ROCK = [
      { base: '#7b8290', hi: '#b9c0cc', lo: '#454b57' }, // 灰青の岩
      { base: '#6d7480', hi: '#a9b1bd', lo: '#3a404a' }, // 濃い灰青
      { base: '#8a8f99', hi: '#c8ccd4', lo: '#4d525c' }, // 明るい灰
      { base: '#7a7468', hi: '#b4ad9e', lo: '#443f36' }, // 灰茶
    ];
    const EDGE = '#dfe6f2';   // 輪郭線（透けたあとも残る淡い青白）
    const AURA = '#a9bdd9';   // 岩の気配（透明化の光）

    // ---- 尖った岩（クリスタル状の三角錐）を描くヘルパー ----
    // solid=1で実体、0で輪郭のみ、その間は面の塗りが薄くなる。
    // 「実体→輪郭のみ→無」の2段階で透けさせるため、塗り(fillA)と輪郭(edgeA)を別々に受け取る。
    // shape は頂点の半径揺らぎ（生成時に固定：毎フレーム変えるとチラつく）。
    function drawSpike(ctx, x, y, size, rot, col, fillA, edgeA, shape) {
      if (fillA <= 0.005 && edgeA <= 0.005) return;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rot);
      // 縦長の尖った多角形：上に鋭い先端、下は太い。
      const pts = [
        [0, -size * 1.55 * shape[0]],            // 先端
        [size * 0.62 * shape[1], -size * 0.35],
        [size * 0.78 * shape[2], size * 0.55],
        [size * 0.2 * shape[3], size * 0.95],
        [-size * 0.55 * shape[4], size * 0.7],
        [-size * 0.72 * shape[5], -size * 0.25],
      ];
      const path = () => {
        ctx.beginPath();
        pts.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)));
        ctx.closePath();
      };
      if (fillA > 0.005) {
        // 下地
        ctx.fillStyle = rgba(col.base, fillA);
        path();
        ctx.fill();
        // 明るい面（左上）
        ctx.fillStyle = rgba(col.hi, fillA * 0.65);
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        ctx.lineTo(pts[1][0], pts[1][1]);
        ctx.lineTo(0, size * 0.1);
        ctx.lineTo(pts[5][0], pts[5][1]);
        ctx.closePath();
        ctx.fill();
        // 影の面（右下）
        ctx.fillStyle = rgba(col.lo, fillA * 0.6);
        ctx.beginPath();
        ctx.moveTo(pts[1][0], pts[1][1]);
        ctx.lineTo(pts[2][0], pts[2][1]);
        ctx.lineTo(pts[3][0], pts[3][1]);
        ctx.lineTo(0, size * 0.1);
        ctx.closePath();
        ctx.fill();
      }
      if (edgeA > 0.005) {
        // 輪郭線＋面の稜線（透けたあとも岩の形が分かるように残す）
        ctx.strokeStyle = rgba(EDGE, edgeA);
        ctx.lineWidth = Math.max(1, size * 0.11);
        ctx.lineJoin = 'round';
        ctx.shadowColor = rgba(AURA, edgeA * 0.9);
        ctx.shadowBlur = 8 * S;
        path();
        ctx.stroke();
        ctx.lineWidth = Math.max(0.8, size * 0.05);
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        ctx.lineTo(0, size * 0.1);
        ctx.moveTo(pts[1][0], pts[1][1]);
        ctx.lineTo(0, size * 0.1);
        ctx.moveTo(pts[3][0], pts[3][1]);
        ctx.lineTo(0, size * 0.1);
        ctx.stroke();
      }
      ctx.restore();
    }
    function makeShape() {
      const arr = [];
      for (let i = 0; i < 6; i++) arr.push(rand(0.82, 1.18));
      return arr;
    }

    // 岩が相手の周りを回る円軌道の中心・半径。相手スプライトを取り囲むように、やや横長の楕円。
    const orbitCx = to.x, orbitCy = to.y + 6 * S;
    const orbitRx = 60 * S, orbitRy = 30 * S;

    // ============ ①予兆：攻撃側の前に岩が現れる ============
    // 足元に灰青の光（岩の気配）
    particles.push({
      maxLife: STEALTHROCK_GATHER_MS + 140,
      draw(ctx, t) {
        const a = Math.sin(Math.PI * clamp01(t)) * 0.4;
        const r = lerp(12 * S, 54 * S, easeOutCubic(t));
        const g = ctx.createRadialGradient(from.x, from.y + 8 * S, 0, from.x, from.y + 8 * S, r);
        g.addColorStop(0, rgba(AURA, a * 0.7));
        g.addColorStop(1, rgba(AURA, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(from.x, from.y + 8 * S, r, 0, Math.PI * 2);
        ctx.fill();
      }
    });

    // ============ ②③岩が飛び、相手を取り巻いて回り、透けて消える ============
    const ROCK_COUNT = 10;
    for (let i = 0; i < ROCK_COUNT; i++) {
      const col = ROCK[i % ROCK.length];
      const shape = makeShape();
      const size = rand(6.5, 10.5) * S;
      const spin = rand(-3, 3);
      // 攻撃側の前に浮かぶ位置（扇状に少し散らす）
      const hoverAng = rand(-1.0, 1.0);
      const dxv = to.x - from.x, dyv = to.y - from.y;
      const dlen = Math.hypot(dxv, dyv) || 1;
      const ux = dxv / dlen, uy = dyv / dlen;
      const nxv = -uy, nyv = ux;
      const hover = {
        x: from.x + ux * 38 * S + nxv * Math.sin(hoverAng) * 34 * S,
        y: from.y + uy * 38 * S + nyv * Math.sin(hoverAng) * 34 * S - Math.abs(Math.cos(hoverAng)) * 14 * S,
      };
      // 円軌道上の“定位置”（相手の周りに等間隔＋少しばらつき）
      const orbitAng0 = (i / ROCK_COUNT) * Math.PI * 2 + rand(-0.15, 0.15);
      const orbitSpeed = rand(2.4, 3.2);   // 全員同じ向きに回る（“巻かれる”見た目）
      const orbitJitter = rand(0.9, 1.12);
      const startAt = i * 26;
      const seed = rand(0, 100);
      // 岩ごとに透明化の開始をずらし、一斉に消えず“順に溶けていく”ようにする
      const meltAt = rand(0.28, 0.50);
      // 溶け終わり：meltAt からの「溶けきるまでの長さ」を岩ごとに変える。
      // 必ず orbitP=0.94 までに完全に消え終わる（最後の最後まで薄い輪郭が残ってプツッと消えるのを防ぐ）。
      const meltEnd = Math.min(0.94, meltAt + rand(0.34, 0.46));
      const totalLife = STEALTHROCK_END_MS - startAt;
      particles.push({
        delay: startAt,
        maxLife: totalLife,
        draw(ctx, t) {
          const ms = startAt + t * totalLife;            // 演出開始からの経過ms
          // ---- 位置：浮かぶ → 相手の周りへ飛ぶ → 回り続ける ----
          let x, y, rot;
          if (ms < STEALTHROCK_GATHER_MS) {
            // ①出現：原点から膨らんで浮かぶ
            const p = easeOutCubic(clamp01((ms - startAt) / (STEALTHROCK_GATHER_MS - startAt)));
            const bob = noise1(ms * 0.006 + seed, seed) * 2.5 * S;
            x = lerp(from.x, hover.x, p);
            y = lerp(from.y, hover.y, p) + bob;
            rot = ms * 0.002 * spin;
          } else if (ms < STEALTHROCK_ARRIVE_MS) {
            // ②相手の周りの円軌道へ向かって飛ぶ（加速しながら）
            const p = easeInCubic(clamp01((ms - STEALTHROCK_GATHER_MS) / STEALTHROCK_FLY_MS)) * 0.6
                    + clamp01((ms - STEALTHROCK_GATHER_MS) / STEALTHROCK_FLY_MS) * 0.4;
            const ang = orbitAng0 + (ms - STEALTHROCK_GATHER_MS) * 0.001 * orbitSpeed;
            const tx = orbitCx + Math.cos(ang) * orbitRx * orbitJitter;
            const ty = orbitCy + Math.sin(ang) * orbitRy * orbitJitter;
            x = lerp(hover.x, tx, p);
            y = lerp(hover.y, ty, p);
            rot = ms * 0.002 * spin + p * 2;
          } else {
            // ③円軌道を回り続ける（少しずつ内側へ絞られ、相手の足元に吸い込まれる）
            const since = ms - STEALTHROCK_ARRIVE_MS;
            const ang = orbitAng0 + (ms - STEALTHROCK_GATHER_MS) * 0.001 * orbitSpeed;
            const shrink = 1 - clamp01(since / STEALTHROCK_ORBIT_MS) * 0.25;
            x = orbitCx + Math.cos(ang) * orbitRx * orbitJitter * shrink;
            y = orbitCy + Math.sin(ang) * orbitRy * orbitJitter * shrink;
            rot = ms * 0.002 * spin + 2;
          }
          // ---- 透明化：実体 → 輪郭のみ → 無 ----
          // 円軌道に着いてから meltAt(0.30〜0.55) の割合で溶け始める。
          //   前半：塗りが抜けて輪郭だけになる／後半：輪郭も溶けて見えなくなる
          const orbitP = clamp01((ms - STEALTHROCK_ARRIVE_MS) / STEALTHROCK_ORBIT_MS);
          let fillA = clamp01((ms - startAt) / 120);                     // 出現時のフェードイン
          let edgeA = clamp01((ms - startAt) / 120);
          if (orbitP > meltAt) {
            const m = clamp01((orbitP - meltAt) / (meltEnd - meltAt));   // 0→1：溶けの進行（meltEndで完了）
            fillA *= 1 - clamp01(m / 0.55);                               // 前半で塗りが消える（輪郭は残る）
            edgeA *= 1 - clamp01((m - 0.35) / 0.65);                      // 後半で輪郭も消える
          }
          // 奥行き：楕円の奥側(上)は少し小さく暗く、手前(下)は大きく明るく
          const depth = 0.85 + 0.3 * ((y - (orbitCy - orbitRy)) / (orbitRy * 2 + 0.001));
          drawSpike(ctx, x, y, size * depth, rot, col, fillA, edgeA, shape);
        }
      });
    }

    // 岩が取り巻いた瞬間の“ドサッ”と気配が走る輪（衝撃ではなく静かな波紋）
    particles.push({
      delay: STEALTHROCK_ARRIVE_MS - 40,
      maxLife: 420,
      draw(ctx, t) {
        const r = lerp(14 * S, orbitRx * 1.25, easeOutQuint(t));
        ctx.strokeStyle = rgba(AURA, (1 - t) * 0.55);
        ctx.lineWidth = 3 * (1 - t * 0.6);
        ctx.shadowColor = rgba(AURA, 0.7);
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.ellipse(orbitCx, orbitCy, r, r * 0.5, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    });
    // 岩が回る軌道のうっすらした光の輪（“ここを岩が取り巻いている”ことを示す）
    particles.push({
      delay: STEALTHROCK_ARRIVE_MS - 60,
      maxLife: STEALTHROCK_ORBIT_MS + 160,
      draw(ctx, t) {
        const a = Math.sin(Math.PI * clamp01(t)) * 0.3;
        ctx.strokeStyle = rgba(AURA, a);
        ctx.lineWidth = 1.6;
        ctx.setLineDash([5 * S, 6 * S]);
        ctx.beginPath();
        ctx.ellipse(orbitCx, orbitCy, orbitRx, orbitRy, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    });

    // ============ ④余韻：足元にひび割れ模様の淡い気配が残って消える ============
    // 岩が溶けきる頃（ORBIT の終盤）に、地面へ放射状のひび割れが淡く浮かぶ。
    const crackAt = STEALTHROCK_ARRIVE_MS + STEALTHROCK_ORBIT_MS * 0.55;
    const CRACKS = 9;
    for (let i = 0; i < CRACKS; i++) {
      const a1 = (i / CRACKS) * Math.PI * 2 + rand(-0.2, 0.2);
      const l1 = rand(24, 46) * S;
      const kink = rand(-0.5, 0.5);
      const l2 = l1 * rand(0.45, 0.7);
      particles.push({
        delay: crackAt + rand(0, 60),
        maxLife: 620,
        draw(ctx, t) {
          const grow = easeOutCubic(clamp01(t * 2.2));
          const a = grow * (1 - Math.max(0, (t - 0.35) / 0.65)) * 0.5;
          if (a <= 0.01) return;
          const x0 = to.x, y0 = to.y + 12 * S;
          // 楕円（地面の遠近）に沿うよう y を潰す
          const x1 = x0 + Math.cos(a1) * l1 * grow, y1 = y0 + Math.sin(a1) * l1 * 0.45 * grow;
          const x2 = x1 + Math.cos(a1 + kink) * l2 * grow, y2 = y1 + Math.sin(a1 + kink) * l2 * 0.45 * grow;
          ctx.strokeStyle = rgba(EDGE, a);
          ctx.lineWidth = 1.5;
          ctx.shadowColor = rgba(AURA, a);
          ctx.shadowBlur = 6;
          ctx.beginPath();
          ctx.moveTo(x0, y0);
          ctx.lineTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
        }
      });
    }
    // 岩が溶けるときに舞う、透明な岩の粒子（消える瞬間のきらめき）
    for (let i = 0; i < 26; i++) {
      const a1 = rand(0, Math.PI * 2);
      const rr = rand(0.7, 1.15);
      const rise = rand(14, 40) * S;
      const born = STEALTHROCK_ARRIVE_MS + rand(STEALTHROCK_ORBIT_MS * 0.35, STEALTHROCK_ORBIT_MS * 0.95);
      const sz = rand(1.4, 2.8) * S;
      particles.push({
        delay: born,
        maxLife: rand(320, 480),
        blend: 'lighter',
        draw(ctx, t) {
          const x = orbitCx + Math.cos(a1) * orbitRx * rr * (1 - t * 0.2);
          const y = orbitCy + Math.sin(a1) * orbitRy * rr - t * rise;
          ctx.fillStyle = rgba(EDGE, (1 - t) * 0.7);
          ctx.shadowColor = rgba(AURA, 0.9);
          ctx.shadowBlur = 6;
          ctx.beginPath();
          ctx.arc(x, y, sz * (1 - t * 0.5), 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }
  }

// ============================================================
// フレアドライブ：自分のポケモンの「画像そのもの」が炎を纏って相手へ突進し、
// 激突後に元の位置へ戻ってくる演出（本家準拠）
// ・元のスプライト要素は演出中だけ透明化し、Canvas上に同じ画像を描画して動かす
// ・炎は spawnFlareDriveSpecial のパーティクル群を流用（頭は描かない）
// ・突進 → 激突 → 戻り の3段階すべてで、画像はCanvas上を実際に移動する
// ============================================================
const FLAREDRIVE_CHARGE_MS = 500;   // ①炎を纏う
const FLAREDRIVE_DASH_MS   = 280;   // ②突進
const FLAREDRIVE_IMPACT_MS = 220;   // ③激突
const FLAREDRIVE_RETURN_MS = 380;   // ④戻り
// 相手に激突する瞬間（＝ダメージの瞬間）
const FLAREDRIVE_HIT_MS = FLAREDRIVE_CHARGE_MS + FLAREDRIVE_DASH_MS;
const FLAREDRIVE_END_MS = FLAREDRIVE_HIT_MS + FLAREDRIVE_IMPACT_MS + FLAREDRIVE_RETURN_MS;

// 炎のパーティクル群（頭＝ポケモン画像は含めない。Canvas側で別途描画する）
function spawnFlareDriveSpecial(particles, w, h, info) {
  const from = (info && info.from) || { x: w * 0.28, y: h * 0.68 };
  const to   = (info && info.to)   || { x: w * 0.72, y: h * 0.32 };
  const S = (info && info.scale) || 1;
  const R = Math.max(w, h);

  const dx = to.x - from.x, dy = to.y - from.y;
  const dist = Math.hypot(dx, dy) || 1;
  const ang = Math.atan2(dy, dx);
  const ux = dx / dist, uy = dy / dist;
  const nx = -uy, ny = ux;

  // ============ 幕1: チャージ（炎を纏う） ============
  // 攻撃側の中心で炎のオーラが渦を巻きながら膨れ上がる
  particles.push({
    maxLife: FLAREDRIVE_CHARGE_MS + 80,
    blend: 'lighter',
    draw(ctx, t) {
      const a = Math.sin(Math.PI * clamp01(t)) * 0.75;
      const r = lerp(14 * S, 72 * S, easeOutCubic(t));
      const g = ctx.createRadialGradient(from.x, from.y, 0, from.x, from.y, r);
      g.addColorStop(0, rgba('#fff6cf', a));
      g.addColorStop(0.3, rgba('#ffb347', a * 0.9));
      g.addColorStop(0.65, rgba('#ff5a1a', a * 0.6));
      g.addColorStop(1, 'rgba(255,60,10,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(from.x, from.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  // 外から中心へ渦を巻いて吸い込まれる火の粉
  for (let i = 0; i < 26; i++) {
    const a0 = (i / 26) * Math.PI * 2 + rand(-0.3, 0.3);
    const r0 = rand(75, 140) * S;
    const size = rand(2, 4.5) * S;
    const col = pick(['#fff6cf', '#ffb347', '#ff7a1a', '#ff4d2e']);
    const startAt = rand(0, 320);
    particles.push({
      delay: startAt,
      maxLife: rand(280, 400),
      blend: 'lighter',
      draw(ctx, t) {
        if (t >= 1) return;
        const e = easeInCubic(t);
        const rr = lerp(r0, 3 * S, e);
        const spin = a0 + t * 3.4;
        const x = from.x + Math.cos(spin) * rr;
        const y = from.y + Math.sin(spin) * rr * 0.85;
        const a = clamp01(t * 5) * (1 - Math.max(0, (t - 0.85) / 0.15));
        ctx.fillStyle = rgba(col, a);
        ctx.shadowColor = rgba('#ff9a3a', 0.9);
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(x, y, size * (1 - t * 0.3), 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }
  // 立ち上る炎の舌
  for (let i = 0; i < 16; i++) {
    const seed = rand(0, 100);
    const ox = rand(-46, 46) * S;
    particles.push({
      delay: rand(0, 280),
      maxLife: rand(300, 500),
      blend: 'lighter',
      draw(ctx, t) {
        if (t >= 1) return;
        const rise = easeOutCubic(t);
        const turb = noise1(t * 8 + seed, seed) * 20 * S;
        const x = from.x + ox + turb * 0.7;
        const y = from.y - rise * 65 * S + noise1(t * 6 + seed + 3, seed) * 8;
        const a = (t < 0.2 ? t / 0.2 : (1 - (t - 0.2) / 0.8)) * 0.8;
        const size = (9 + Math.abs(noise1(t * 10, seed)) * 12) * S * (1 - t * 0.4);
        const grad = ctx.createRadialGradient(x, y, 0, x, y, size);
        grad.addColorStop(0, rgba('#fff6cf', a));
        grad.addColorStop(0.4, rgba('#ff9a3a', a * 0.9));
        grad.addColorStop(1, 'rgba(255,60,0,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(x, y, size, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }

  // ============ 幕2: 突進の尾と火花（頭＝ポケモン画像は Canvas 側で描画） ============
  particles.push({
    delay: FLAREDRIVE_CHARGE_MS,
    maxLife: FLAREDRIVE_DASH_MS,
    blend: 'lighter',
    draw(ctx, t) {
      if (t >= 1) return;
      const e = easeInCubic(t) * 0.4 + t * 0.6;
      const x = lerp(from.x, to.x, e);
      const y = lerp(from.y, to.y, e);

      // 尾（進行方向の逆に伸びる多層の炎）
      for (let k = 7; k >= 1; k--) {
        const te = Math.max(0, e - k * 0.06);
        const tx = lerp(from.x, to.x, te);
        const ty = lerp(from.y, to.y, te);
        const ta = (1 - k / 8) * 0.75;
        const tSize = 44 * S * (1 - k * 0.09);
        const grad = ctx.createRadialGradient(tx, ty, 0, tx, ty, tSize);
        grad.addColorStop(0, rgba('#ffd98a', ta));
        grad.addColorStop(0.45, rgba('#ff7a1a', ta * 0.75));
        grad.addColorStop(1, 'rgba(255,60,10,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(tx, ty, tSize, 0, Math.PI * 2);
        ctx.fill();
      }

      // 進行方向へ流れる火花（速度感）
      for (let s = 0; s < 5; s++) {
        const off = rand(-1, 1) * 10 * S;
        const px = x - ux * (30 + s * 6) * S + nx * off;
        const py = y - uy * (30 + s * 6) * S + ny * off;
        ctx.fillStyle = rgba('#fff6cf', 0.85 * (1 - s / 6));
        ctx.beginPath();
        ctx.arc(px, py, (3.5 - s * 0.4) * S, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  });
  // 突進中にまき散らす火の粉
  for (let i = 0; i < 34; i++) {
    const startAt = FLAREDRIVE_CHARGE_MS + rand(0, FLAREDRIVE_DASH_MS * 0.85);
    const lateral = rand(-1, 1);
    const size = rand(2, 4.5) * S;
    const seed = rand(0, 100);
    const col = pick(['#fff6cf', '#ffb347', '#ff7a1a', '#ff4d2e']);
    particles.push({
      delay: startAt,
      maxLife: rand(340, 520),
      blend: 'lighter',
      draw(ctx, t) {
        if (t >= 1) return;
        const dashT = clamp01((startAt - FLAREDRIVE_CHARGE_MS) / FLAREDRIVE_DASH_MS);
        const e = clamp01(dashT + t * 0.14);
        const baseX = lerp(from.x, to.x, e);
        const baseY = lerp(from.y, to.y, e);
        const drift = t * 46 * S;
        const x = baseX + nx * lateral * drift;
        const y = baseY + ny * lateral * drift + Math.sin(t * 6 + seed) * 4 + t * t * 20 * S;
        const flick = 0.6 + Math.abs(noise1(t * 16 + seed, seed)) * 0.4;
        const a = (1 - t) * 0.9 * flick;
        ctx.fillStyle = rgba(col, a);
        ctx.shadowColor = rgba('#ff9a3a', 0.9);
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(x, y, size * (1 - t * 0.4), 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }

  // ============ 幕3: 激突（大爆発） ============
  particles.push({
    delay: FLAREDRIVE_HIT_MS,
    maxLife: 280,
    blend: 'lighter',
    draw(ctx, t) {
      const a = (1 - t) * 0.95;
      const r = lerp(12 * S, 120 * S, easeOutQuint(t));
      const g = ctx.createRadialGradient(to.x, to.y, 0, to.x, to.y, r);
      g.addColorStop(0,    rgba('#ffffff', a));
      g.addColorStop(0.25, rgba('#fff6cf', a * 0.95));
      g.addColorStop(0.55, rgba('#ffb347', a * 0.7));
      g.addColorStop(0.85, rgba('#ff4d2e', a * 0.35));
      g.addColorStop(1,    'rgba(255,60,10,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(to.x, to.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  for (let i = 0; i < 3; i++) {
    particles.push({
      delay: FLAREDRIVE_HIT_MS + i * 45,
      maxLife: 480 - i * 60,
      blend: 'lighter',
      draw(ctx, t) {
        const r = lerp(10 * S, R * (0.24 + i * 0.08), easeOutQuint(t));
        const a = (1 - t) * (0.85 - i * 0.15);
        const col = i === 0 ? '#ffffff' : (i === 1 ? '#ffd98a' : '#ff7a1a');
        ctx.strokeStyle = rgba(col, a);
        ctx.lineWidth = (7 - i * 1.5) * (1 - t * 0.5);
        ctx.shadowColor = rgba(col, 0.9);
        ctx.shadowBlur = 18;
        ctx.beginPath();
        ctx.ellipse(to.x, to.y, r, r * 0.85, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    });
  }
  for (let i = 0; i < 30; i++) {
    const sa = rand(0, Math.PI * 2);
    const sp = rand(60, 230) * S;
    const size = rand(4, 10) * S;
    const grav = rand(0.6, 1.4);
    const seed = rand(0, 100);
    const col = pick(['#fff6cf', '#ffd98a', '#ff9a3a', '#ff4d2e', '#ff2e0e']);
    particles.push({
      delay: FLAREDRIVE_HIT_MS + rand(0, 60),
      maxLife: rand(480, 700),
      blend: 'lighter',
      draw(ctx, t) {
        const e = easeOutCubic(t);
        const x = to.x + Math.cos(sa) * sp * e;
        const y = to.y + Math.sin(sa) * sp * e + grav * t * t * h * 0.14;
        const flick = 0.6 + Math.abs(noise1(t * 18 + seed, seed)) * 0.4;
        const a = (1 - t) * 0.95 * flick;
        const grad = ctx.createRadialGradient(x, y, 0, x, y, size);
        grad.addColorStop(0,    rgba('#ffffff', a));
        grad.addColorStop(0.35, rgba(col, a * 0.9));
        grad.addColorStop(1,    'rgba(255,60,0,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(x, y, size, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }
  // 大十字きらめき（突進方向に傾ける）
  particles.push({
    delay: FLAREDRIVE_HIT_MS,
    maxLife: 400,
    blend: 'lighter',
    draw(ctx, t) {
      const a = Math.sin(Math.PI * clamp01(t)) * 0.95;
      const size = lerp(15 * S, 95 * S, easeOutCubic(t));
      ctx.save();
      ctx.translate(to.x, to.y);
      ctx.rotate(ang);
      ctx.fillStyle = rgba('#ffffff', a);
      ctx.shadowColor = rgba('#ffd98a', 1);
      ctx.shadowBlur = size * 0.4;
      for (let k = 0; k < 4; k++) {
        ctx.save();
        ctx.rotate((k / 4) * Math.PI);
        ctx.beginPath();
        ctx.moveTo(0, -size);
        ctx.quadraticCurveTo(size * 0.12, -size * 0.12, size, 0);
        ctx.quadraticCurveTo(size * 0.12, size * 0.12, 0, size);
        ctx.quadraticCurveTo(-size * 0.12, size * 0.12, -size, 0);
        ctx.quadraticCurveTo(-size * 0.12, -size * 0.12, 0, -size);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
      ctx.restore();
    }
  });
  // 着弾点から立ち上る炎の余韻
  for (let i = 0; i < 8; i++) {
    const seed = rand(0, 100);
    const ox = rand(-24, 24) * S;
    particles.push({
      delay: FLAREDRIVE_HIT_MS + rand(0, 100),
      maxLife: rand(400, 580),
      blend: 'lighter',
      draw(ctx, t) {
        if (t >= 1) return;
        const rise = easeOutCubic(t);
        const turb = noise1(t * 6 + seed, seed) * 14 * S;
        const x = to.x + ox + turb;
        const y = to.y - rise * 70 * S;
        const a = (t < 0.15 ? t / 0.15 : (1 - (t - 0.15) / 0.85)) * 0.6;
        const size = 16 * S * (1 - t * 0.5);
        const grad = ctx.createRadialGradient(x, y, 0, x, y, size);
        grad.addColorStop(0, rgba('#fff6cf', a));
        grad.addColorStop(0.5, rgba('#ff9a3a', a * 0.85));
        grad.addColorStop(1, 'rgba(255,60,0,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(x, y, size, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }

  // ============ 幕4: 戻りの残像と残り火 ============
  particles.push({
    delay: FLAREDRIVE_HIT_MS + FLAREDRIVE_IMPACT_MS,
    maxLife: FLAREDRIVE_RETURN_MS,
    blend: 'lighter',
    draw(ctx, t) {
      if (t >= 1) return;
      const e = easeOutCubic(t);
      const x = lerp(to.x, from.x, e);
      const y = lerp(to.y, from.y, e);

      for (let k = 6; k >= 1; k--) {
        const te = Math.max(0, e - k * 0.08);
        const tx = lerp(to.x, from.x, te);
        const ty = lerp(to.y, from.y, te);
        const ta = (1 - k / 7) * 0.45;
        const tSize = 30 * S * (1 - k * 0.1);
        const grad = ctx.createRadialGradient(tx, ty, 0, tx, ty, tSize);
        grad.addColorStop(0, rgba('#ffd98a', ta));
        grad.addColorStop(0.6, rgba('#ff7a1a', ta * 0.6));
        grad.addColorStop(1, 'rgba(255,60,10,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(tx, ty, tSize, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  });
  for (let i = 0; i < 24; i++) {
    const startAt = FLAREDRIVE_HIT_MS + FLAREDRIVE_IMPACT_MS + rand(0, FLAREDRIVE_RETURN_MS * 0.8);
    const lateral = rand(-1, 1);
    const size = rand(2, 3.6) * S;
    const seed = rand(0, 100);
    const col = pick(['#fff6cf', '#ffb347', '#ff7a1a']);
    particles.push({
      delay: startAt,
      maxLife: rand(320, 500),
      blend: 'lighter',
      draw(ctx, t) {
        if (t >= 1) return;
        const dashT = clamp01((startAt - FLAREDRIVE_HIT_MS - FLAREDRIVE_IMPACT_MS) / FLAREDRIVE_RETURN_MS);
        const e = easeOutCubic(clamp01(dashT + t * 0.12));
        const baseX = lerp(to.x, from.x, e);
        const baseY = lerp(to.y, from.y, e);
        const drift = t * 32 * S;
        const x = baseX + nx * lateral * drift;
        const y = baseY + ny * lateral * drift - t * 22 * S;
        const flick = 0.6 + Math.abs(noise1(t * 16 + seed, seed)) * 0.4;
        const a = (1 - t) * 0.85 * flick;
        ctx.fillStyle = rgba(col, a);
        ctx.shadowColor = rgba('#ff9a3a', 0.9);
        ctx.shadowBlur = 7;
        ctx.beginPath();
        ctx.arc(x, y, size * (1 - t * 0.3), 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }
  // 戻り切ったあと、攻撃側にわずかに残る炎の余韻
  particles.push({
    delay: FLAREDRIVE_HIT_MS + FLAREDRIVE_IMPACT_MS + FLAREDRIVE_RETURN_MS * 0.7,
    maxLife: 300,
    blend: 'lighter',
    draw(ctx, t) {
      const a = (1 - t) * 0.55;
      const r = lerp(8 * S, 44 * S, easeOutCubic(t));
      const g = ctx.createRadialGradient(from.x, from.y, 0, from.x, from.y, r);
      g.addColorStop(0, rgba('#fff6cf', a));
      g.addColorStop(0.5, rgba('#ff9a3a', a * 0.7));
      g.addColorStop(1, 'rgba(255,60,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(from.x, from.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

// ============================================================
// フレアドライブ専用ランナー：Canvas上に「ポケモンの画像そのもの」を描画しながら
// 突進 → 激突 → 戻り を再生する。元のスプライト要素は演出中だけ透明化する。
// ============================================================
function playFlareDriveOnCanvas(layerEl, defSide) {
  const atkSide = defSide === 'opp' ? 'self' : 'opp';
  const atkWrap = document.getElementById(atkSide === 'opp' ? 'sprite-opp-wrap' : 'sprite-self-wrap');
  const defWrap = document.getElementById(defSide === 'opp' ? 'sprite-opp-wrap' : 'sprite-self-wrap');
  if (!layerEl || !atkWrap || !defWrap) return Promise.resolve();

  const atkImg = atkWrap.querySelector('img, .sprite-fallback');
  const defImg = defWrap.querySelector('img, .sprite-fallback');
  if (!atkImg) return Promise.resolve();

  const lr = layerEl.getBoundingClientRect();
  const aRect = atkImg.getBoundingClientRect();
  const dRect = (defImg || defWrap).getBoundingClientRect();
  const from = { x: aRect.left - lr.left + aRect.width / 2, y: aRect.top - lr.top + aRect.height / 2 };
  const to   = { x: dRect.left - lr.left + dRect.width / 2, y: dRect.top - lr.top + dRect.height / 2 };
  const spriteW = aRect.width || 120;
  const spriteH = aRect.height || 120;

  const w = lr.width, h = lr.height;
  const dpr = Math.min(2, window.devicePixelRatio || 1);

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;';
  layerEl.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.imageSmoothingEnabled = false;

  // 元のスプライトを一時的に透明化（Canvas側で同じ画像を描画する）
  const prevVisibility = atkImg.style.visibility;
  atkImg.style.visibility = 'hidden';

  const isSelfFlipped = (atkSide === 'self');
  const spriteSrc = atkImg;
  const info = { from, to, scale: 1 };

  // 炎のパーティクル群（頭＝画像は含まない）
  const particles = [];
  spawnFlareDriveSpecial(particles, w, h, info);

  // スプライトの現在位置（時間から算出）
  function spritePos(ms) {
    if (ms < FLAREDRIVE_CHARGE_MS) {
      return { x: from.x, y: from.y, a: 0 };
    }
    if (ms < FLAREDRIVE_HIT_MS) {
      const p = (ms - FLAREDRIVE_CHARGE_MS) / FLAREDRIVE_DASH_MS;
      const e = easeInCubic(p) * 0.4 + p * 0.6;
      return { x: lerp(from.x, to.x, e), y: lerp(from.y, to.y, e), a: 1 };
    }
    if (ms < FLAREDRIVE_HIT_MS + FLAREDRIVE_IMPACT_MS) {
      const p = (ms - FLAREDRIVE_HIT_MS) / FLAREDRIVE_IMPACT_MS;
      return { x: to.x, y: to.y, a: 1 - p * 0.85 };
    }
    const p = (ms - FLAREDRIVE_HIT_MS - FLAREDRIVE_IMPACT_MS) / FLAREDRIVE_RETURN_MS;
    const e = easeOutCubic(p);
    return { x: lerp(to.x, from.x, e), y: lerp(to.y, from.y, e), a: 1 };
  }

  return new Promise((resolve) => {
    const start = performance.now();
    let resolved = false;
    const finish = () => {
      if (resolved) return;
      resolved = true;
      try { ctx.clearRect(0, 0, w, h); } catch (e) {}
      try { canvas.remove(); } catch (e) {}
      try { atkImg.style.visibility = prevVisibility; } catch (e) {}
      resolve();
    };

    function frame(now) {
      const ms = now - start;
      if (ms >= FLAREDRIVE_END_MS) { finish(); return; }

      ctx.clearRect(0, 0, w, h);

      // ① 炎のパーティクル（画像の下層）
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        if (ms < (p.delay || 0)) continue;
        const pt = clamp01((ms - (p.delay || 0)) / (p.maxLife || FLAREDRIVE_END_MS));
        p.update && p.update(pt, ms);
        ctx.save();
        ctx.globalCompositeOperation = p.blend || 'source-over';
        p.draw(ctx, pt);
        ctx.restore();
      }

      // ② スプライト画像を現在位置に描画
      const sp = spritePos(ms);
      if (spriteSrc && spriteSrc.complete && sp.a > 0.01) {
        ctx.save();
        ctx.globalAlpha = sp.a;
        ctx.translate(sp.x, sp.y);
        if (isSelfFlipped) ctx.scale(-1, 1);
        ctx.drawImage(spriteSrc, -spriteW / 2, -spriteH / 2, spriteW, spriteH);
        ctx.restore();

        // 突進中：ポケモンのシルエットに炎のオレンジを加算合成で重ねて
        // 「体に炎がまとわりついている」見た目にする
        if (ms >= FLAREDRIVE_CHARGE_MS && ms < FLAREDRIVE_HIT_MS + FLAREDRIVE_IMPACT_MS * 0.5) {
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = 0.32 * sp.a;
          ctx.translate(sp.x, sp.y);
          if (isSelfFlipped) ctx.scale(-1, 1);
          ctx.filter = 'brightness(0) sepia(1) hue-rotate(-25deg) saturate(6) brightness(1.5)';
          ctx.drawImage(spriteSrc, -spriteW / 2, -spriteH / 2, spriteW, spriteH);
          ctx.filter = 'none';
          ctx.restore();
        }
      }

      // ③ 突進中、体の周囲を回る小さな火花（最前面の追加演出）
      if (ms >= FLAREDRIVE_CHARGE_MS && ms < FLAREDRIVE_HIT_MS) {
        const p = (ms - FLAREDRIVE_CHARGE_MS) / FLAREDRIVE_DASH_MS;
        const e = easeInCubic(p) * 0.4 + p * 0.6;
        const cx = lerp(from.x, to.x, e);
        const cy = lerp(from.y, to.y, e);
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        for (let s = 0; s < 4; s++) {
          const ang2 = (s / 4) * Math.PI * 2 + ms * 0.01;
          const rr = spriteW * 0.55;
          const x = cx + Math.cos(ang2) * rr;
          const y = cy + Math.sin(ang2) * rr * 0.7;
          ctx.fillStyle = rgba('#fff6cf', 0.85);
          ctx.shadowColor = rgba('#ff9a3a', 0.9);
          ctx.shadowBlur = 8;
          ctx.beginPath();
          ctx.arc(x, y, 3.5, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }

      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  });
}

// ============================================================
// サンダーダイブ／エレキスピン：フレアドライブの「画像そのものが突進する」構造を流用した、でんき版。
// 炎の代わりに電撃（稲妻の閃光・バチバチ弾ける火花・電気の輪）を纏って突進し、
// 激突の瞬間に雷が四方に走る。炎よりやや派手め（閃光を強く・稲妻を多めに）に調整。
// ・元のスプライト要素は演出中だけ透明化し、Canvas上に同じ画像を描画して動かす
// ============================================================
const THUNDERDIVE_CHARGE_MS = 460;   // ①電気を纏う（フレアドライブよりわずかに速く溜める）
const THUNDERDIVE_DASH_MS   = 260;   // ②突進（電気らしく少し速い）
const THUNDERDIVE_IMPACT_MS = 240;   // ③激突（雷が弾ける分わずかに長め）
const THUNDERDIVE_RETURN_MS = 380;   // ④戻り
const THUNDERDIVE_HIT_MS = THUNDERDIVE_CHARGE_MS + THUNDERDIVE_DASH_MS;
const THUNDERDIVE_END_MS = THUNDERDIVE_HIT_MS + THUNDERDIVE_IMPACT_MS + THUNDERDIVE_RETURN_MS;

// ジグザグな稲妻パスを描くユーティリティ（電撃らしいギザギザの線）
function drawLightningBolt(ctx, x0, y0, x1, y1, segments, jitter, seed) {
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  const dx = x1 - x0, dy = y1 - y0;
  for (let i = 1; i < segments; i++) {
    const t = i / segments;
    const nx = -dy, ny = dx;
    const nlen = Math.hypot(nx, ny) || 1;
    const off = noise1(t * 7 + seed, seed) * jitter;
    const px = x0 + dx * t + (nx / nlen) * off;
    const py = y0 + dy * t + (ny / nlen) * off;
    ctx.lineTo(px, py);
  }
  ctx.lineTo(x1, y1);
}

// 電撃のパーティクル群（頭＝ポケモン画像は含めない。Canvas側で別途描画する）
function spawnThunderDiveSpecial(particles, w, h, info) {
  const from = (info && info.from) || { x: w * 0.28, y: h * 0.68 };
  const to   = (info && info.to)   || { x: w * 0.72, y: h * 0.32 };
  const S = (info && info.scale) || 1;
  const R = Math.max(w, h);

  const dx = to.x - from.x, dy = to.y - from.y;
  const dist = Math.hypot(dx, dy) || 1;
  const ang = Math.atan2(dy, dx);
  const ux = dx / dist, uy = dy / dist;
  const nx = -uy, ny = ux;

  // ============ 幕1: チャージ（電気を纏う） ============
  // 攻撃側の中心に電光のオーラが渦を巻きながら膨れ上がる
  particles.push({
    maxLife: THUNDERDIVE_CHARGE_MS + 80,
    blend: 'lighter',
    draw(ctx, t) {
      const a = Math.sin(Math.PI * clamp01(t)) * 0.85;
      const r = lerp(14 * S, 76 * S, easeOutCubic(t));
      const g = ctx.createRadialGradient(from.x, from.y, 0, from.x, from.y, r);
      g.addColorStop(0, rgba('#ffffff', a));
      g.addColorStop(0.28, rgba('#fff98a', a * 0.95));
      g.addColorStop(0.6, rgba('#ffe600', a * 0.7));
      g.addColorStop(1, 'rgba(255,220,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(from.x, from.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  // 外から中心へ渦を巻いて吸い込まれる電気の粒
  for (let i = 0; i < 30; i++) {
    const a0 = (i / 30) * Math.PI * 2 + rand(-0.3, 0.3);
    const r0 = rand(78, 150) * S;
    const size = rand(2, 4.5) * S;
    const col = pick(['#ffffff', '#fff98a', '#ffe600', '#7cf5ff']);
    const startAt = rand(0, 300);
    particles.push({
      delay: startAt,
      maxLife: rand(240, 360),
      blend: 'lighter',
      draw(ctx, t) {
        if (t >= 1) return;
        const e = easeInCubic(t);
        const rr = lerp(r0, 3 * S, e);
        const spin = a0 + t * 4.2;
        const x = from.x + Math.cos(spin) * rr;
        const y = from.y + Math.sin(spin) * rr * 0.85;
        const a = clamp01(t * 6) * (1 - Math.max(0, (t - 0.8) / 0.2));
        ctx.fillStyle = rgba(col, a);
        ctx.shadowColor = rgba('#fff98a', 0.95);
        ctx.shadowBlur = 9;
        ctx.beginPath();
        ctx.arc(x, y, size * (1 - t * 0.3), 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }
  // 体の周りをバチバチ走る小さな稲妻（炎の「舌」の代わり）
  for (let i = 0; i < 12; i++) {
    const seed = rand(0, 100);
    const a0 = rand(0, Math.PI * 2);
    particles.push({
      delay: rand(40, THUNDERDIVE_CHARGE_MS - 40),
      maxLife: rand(70, 130),
      blend: 'lighter',
      draw(ctx, t) {
        if (t >= 1) return;
        const r1 = rand ? 18 * S : 18 * S;
        const x0 = from.x + Math.cos(a0) * 12 * S;
        const y0 = from.y + Math.sin(a0) * 12 * S;
        const x1 = from.x + Math.cos(a0 + rand(-0.8, 0.8)) * (46 + r1) * S;
        const y1 = from.y + Math.sin(a0 + rand(-0.8, 0.8)) * (46 + r1) * S * 0.85;
        const a = (1 - t) * 0.9;
        ctx.strokeStyle = rgba('#ffffff', a);
        ctx.lineWidth = 2 * S;
        ctx.shadowColor = rgba('#fff98a', 1);
        ctx.shadowBlur = 10;
        drawLightningBolt(ctx, x0, y0, x1, y1, 4, 9 * S, seed);
        ctx.stroke();
      }
    });
  }
  // 立ち上る電気のスパーク粒（炎の火の粉の代わり、白〜黄で強めに発光）
  for (let i = 0; i < 18; i++) {
    const seed = rand(0, 100);
    const ox = rand(-46, 46) * S;
    particles.push({
      delay: rand(0, 260),
      maxLife: rand(220, 380),
      blend: 'lighter',
      draw(ctx, t) {
        if (t >= 1) return;
        const rise = easeOutCubic(t);
        const turb = noise1(t * 10 + seed, seed) * 22 * S;
        const x = from.x + ox + turb * 0.7;
        const y = from.y - rise * 60 * S + noise1(t * 8 + seed + 3, seed) * 8;
        const a = (t < 0.15 ? t / 0.15 : (1 - (t - 0.15) / 0.85)) * 0.9;
        const size = (3 + Math.abs(noise1(t * 14, seed)) * 3.5) * S * (1 - t * 0.3);
        const grad = ctx.createRadialGradient(x, y, 0, x, y, size);
        grad.addColorStop(0, rgba('#ffffff', a));
        grad.addColorStop(0.4, rgba('#fff98a', a * 0.9));
        grad.addColorStop(1, 'rgba(255,230,0,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(x, y, size, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }

  // ============ 幕2: 突進の尾と火花（頭＝ポケモン画像は Canvas 側で描画） ============
  particles.push({
    delay: THUNDERDIVE_CHARGE_MS,
    maxLife: THUNDERDIVE_DASH_MS,
    blend: 'lighter',
    draw(ctx, t) {
      if (t >= 1) return;
      const e = easeInCubic(t) * 0.4 + t * 0.6;
      const x = lerp(from.x, to.x, e);
      const y = lerp(from.y, to.y, e);

      // 尾（進行方向の逆に伸びる多層の電光）
      for (let k = 7; k >= 1; k--) {
        const te = Math.max(0, e - k * 0.055);
        const tx = lerp(from.x, to.x, te);
        const ty = lerp(from.y, to.y, te);
        const ta = (1 - k / 8) * 0.8;
        const tSize = 42 * S * (1 - k * 0.09);
        const grad = ctx.createRadialGradient(tx, ty, 0, tx, ty, tSize);
        grad.addColorStop(0, rgba('#ffffff', ta));
        grad.addColorStop(0.4, rgba('#fff98a', ta * 0.85));
        grad.addColorStop(1, 'rgba(255,220,0,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(tx, ty, tSize, 0, Math.PI * 2);
        ctx.fill();
      }

      // 尾に沿って走る細い稲妻（電気らしさの核）
      for (let b = 0; b < 2; b++) {
        const bt = Math.max(0, e - 0.1 - b * 0.05);
        const bx = lerp(from.x, to.x, bt);
        const by = lerp(from.y, to.y, bt);
        ctx.strokeStyle = rgba('#ffffff', 0.85);
        ctx.lineWidth = 2 * S;
        ctx.shadowColor = rgba('#fff98a', 1);
        ctx.shadowBlur = 9;
        drawLightningBolt(ctx, x, y, bx - ux * 24 * S, by - uy * 24 * S, 3, 10 * S, b * 30 + t * 40);
        ctx.stroke();
      }

      // 進行方向へ流れる火花（速度感）
      for (let s = 0; s < 5; s++) {
        const off = rand(-1, 1) * 10 * S;
        const px = x - ux * (30 + s * 6) * S + nx * off;
        const py = y - uy * (30 + s * 6) * S + ny * off;
        ctx.fillStyle = rgba('#ffffff', 0.9 * (1 - s / 6));
        ctx.beginPath();
        ctx.arc(px, py, (3.5 - s * 0.4) * S, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  });
  // 突進中にまき散らす電気の粒
  for (let i = 0; i < 36; i++) {
    const startAt = THUNDERDIVE_CHARGE_MS + rand(0, THUNDERDIVE_DASH_MS * 0.85);
    const lateral = rand(-1, 1);
    const size = rand(2, 4.5) * S;
    const seed = rand(0, 100);
    const col = pick(['#ffffff', '#fff98a', '#ffe600', '#7cf5ff']);
    particles.push({
      delay: startAt,
      maxLife: rand(300, 460),
      blend: 'lighter',
      draw(ctx, t) {
        if (t >= 1) return;
        const dashT = clamp01((startAt - THUNDERDIVE_CHARGE_MS) / THUNDERDIVE_DASH_MS);
        const e = clamp01(dashT + t * 0.14);
        const baseX = lerp(from.x, to.x, e);
        const baseY = lerp(from.y, to.y, e);
        const drift = t * 44 * S;
        const x = baseX + nx * lateral * drift;
        const y = baseY + ny * lateral * drift + Math.sin(t * 7 + seed) * 4;
        const flick = 0.55 + Math.abs(noise1(t * 20 + seed, seed)) * 0.45;
        const a = (1 - t) * 0.95 * flick;
        ctx.fillStyle = rgba(col, a);
        ctx.shadowColor = rgba('#fff98a', 0.95);
        ctx.shadowBlur = 9;
        ctx.beginPath();
        ctx.arc(x, y, size * (1 - t * 0.4), 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }

  // ============ 幕3: 激突（大放電） ============
  particles.push({
    delay: THUNDERDIVE_HIT_MS,
    maxLife: 260,
    blend: 'lighter',
    draw(ctx, t) {
      const a = (1 - t) * 1.0;
      const r = lerp(12 * S, 135 * S, easeOutQuint(t));
      const g = ctx.createRadialGradient(to.x, to.y, 0, to.x, to.y, r);
      g.addColorStop(0,    rgba('#ffffff', a));
      g.addColorStop(0.22, rgba('#fff98a', a * 0.97));
      g.addColorStop(0.5,  rgba('#ffe600', a * 0.75));
      g.addColorStop(0.8,  rgba('#7cf5ff', a * 0.35));
      g.addColorStop(1,    'rgba(255,230,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(to.x, to.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  // 着弾点から四方八方へ走る稲妻（派手さの主役。フレアドライブより本数多め）
  for (let i = 0; i < 9; i++) {
    const a0 = (i / 9) * Math.PI * 2 + rand(-0.25, 0.25);
    const len = rand(70, 150) * S;
    const seed = rand(0, 100);
    particles.push({
      delay: THUNDERDIVE_HIT_MS + rand(0, 40),
      maxLife: rand(180, 300),
      blend: 'lighter',
      draw(ctx, t) {
        if (t >= 1) return;
        const e = easeOutCubic(clamp01(t / 0.4));
        const x1 = to.x + Math.cos(a0) * len * e;
        const y1 = to.y + Math.sin(a0) * len * e;
        const a = (1 - t) * 0.95;
        ctx.strokeStyle = rgba('#ffffff', a);
        ctx.lineWidth = 3 * S * (1 - t * 0.5);
        ctx.shadowColor = rgba('#fff98a', 1);
        ctx.shadowBlur = 14;
        drawLightningBolt(ctx, to.x, to.y, x1, y1, 5, 14 * S, seed);
        ctx.stroke();
      }
    });
  }
  for (let i = 0; i < 3; i++) {
    particles.push({
      delay: THUNDERDIVE_HIT_MS + i * 40,
      maxLife: 460 - i * 60,
      blend: 'lighter',
      draw(ctx, t) {
        const r = lerp(10 * S, R * (0.26 + i * 0.08), easeOutQuint(t));
        const a = (1 - t) * (0.9 - i * 0.15);
        const col = i === 0 ? '#ffffff' : (i === 1 ? '#fff98a' : '#ffe600');
        ctx.strokeStyle = rgba(col, a);
        ctx.lineWidth = (7 - i * 1.5) * (1 - t * 0.5);
        ctx.shadowColor = rgba(col, 0.95);
        ctx.shadowBlur = 20;
        ctx.beginPath();
        ctx.ellipse(to.x, to.y, r, r * 0.85, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    });
  }
  for (let i = 0; i < 32; i++) {
    const sa = rand(0, Math.PI * 2);
    const sp = rand(60, 240) * S;
    const size = rand(4, 10) * S;
    const grav = rand(0.5, 1.2);
    const seed = rand(0, 100);
    const col = pick(['#ffffff', '#fff98a', '#ffe600', '#7cf5ff']);
    particles.push({
      delay: THUNDERDIVE_HIT_MS + rand(0, 60),
      maxLife: rand(420, 640),
      blend: 'lighter',
      draw(ctx, t) {
        const e = easeOutCubic(t);
        const x = to.x + Math.cos(sa) * sp * e;
        const y = to.y + Math.sin(sa) * sp * e + grav * t * t * h * 0.1;
        const flick = 0.55 + Math.abs(noise1(t * 22 + seed, seed)) * 0.45;
        const a = (1 - t) * 1.0 * flick;
        const grad = ctx.createRadialGradient(x, y, 0, x, y, size);
        grad.addColorStop(0,    rgba('#ffffff', a));
        grad.addColorStop(0.35, rgba(col, a * 0.9));
        grad.addColorStop(1,    'rgba(255,230,0,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(x, y, size, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }
  // 大十字きらめき（突進方向に傾ける）
  particles.push({
    delay: THUNDERDIVE_HIT_MS,
    maxLife: 380,
    blend: 'lighter',
    draw(ctx, t) {
      const a = Math.sin(Math.PI * clamp01(t)) * 1.0;
      const size = lerp(16 * S, 100 * S, easeOutCubic(t));
      ctx.save();
      ctx.translate(to.x, to.y);
      ctx.rotate(ang);
      ctx.fillStyle = rgba('#ffffff', a);
      ctx.shadowColor = rgba('#fff98a', 1);
      ctx.shadowBlur = size * 0.45;
      for (let k = 0; k < 4; k++) {
        ctx.save();
        ctx.rotate((k / 4) * Math.PI);
        ctx.beginPath();
        ctx.moveTo(0, -size);
        ctx.quadraticCurveTo(size * 0.1, -size * 0.1, size, 0);
        ctx.quadraticCurveTo(size * 0.1, size * 0.1, 0, size);
        ctx.quadraticCurveTo(-size * 0.1, size * 0.1, -size, 0);
        ctx.quadraticCurveTo(-size * 0.1, -size * 0.1, 0, -size);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
      ctx.restore();
    }
  });
  // 着弾点でバチバチ弾ける残留スパーク（炎の余韻の代わり）
  for (let i = 0; i < 10; i++) {
    const seed = rand(0, 100);
    const ox = rand(-26, 26) * S;
    particles.push({
      delay: THUNDERDIVE_HIT_MS + rand(0, 100),
      maxLife: rand(200, 340),
      blend: 'lighter',
      draw(ctx, t) {
        if (t >= 1) return;
        const x = to.x + ox + noise1(t * 12 + seed, seed) * 16 * S;
        const y = to.y + noise1(t * 12 + seed + 5, seed) * 16 * S - t * 20 * S;
        const a = (1 - t) * 0.85 * (0.5 + Math.abs(noise1(t * 24 + seed, seed)) * 0.5);
        ctx.fillStyle = rgba('#ffffff', a);
        ctx.shadowColor = rgba('#fff98a', 1);
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(x, y, 2.6 * S, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }

  // ============ 幕4: 戻りの残像と残り電気 ============
  particles.push({
    delay: THUNDERDIVE_HIT_MS + THUNDERDIVE_IMPACT_MS,
    maxLife: THUNDERDIVE_RETURN_MS,
    blend: 'lighter',
    draw(ctx, t) {
      if (t >= 1) return;
      const e = easeOutCubic(t);
      const x = lerp(to.x, from.x, e);
      const y = lerp(to.y, from.y, e);

      for (let k = 6; k >= 1; k--) {
        const te = Math.max(0, e - k * 0.08);
        const tx = lerp(to.x, from.x, te);
        const ty = lerp(to.y, from.y, te);
        const ta = (1 - k / 7) * 0.5;
        const tSize = 28 * S * (1 - k * 0.1);
        const grad = ctx.createRadialGradient(tx, ty, 0, tx, ty, tSize);
        grad.addColorStop(0, rgba('#fff98a', ta));
        grad.addColorStop(0.6, rgba('#ffe600', ta * 0.6));
        grad.addColorStop(1, 'rgba(255,220,0,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(tx, ty, tSize, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  });
  for (let i = 0; i < 24; i++) {
    const startAt = THUNDERDIVE_HIT_MS + THUNDERDIVE_IMPACT_MS + rand(0, THUNDERDIVE_RETURN_MS * 0.8);
    const lateral = rand(-1, 1);
    const size = rand(2, 3.6) * S;
    const seed = rand(0, 100);
    const col = pick(['#ffffff', '#fff98a', '#ffe600']);
    particles.push({
      delay: startAt,
      maxLife: rand(300, 460),
      blend: 'lighter',
      draw(ctx, t) {
        if (t >= 1) return;
        const dashT = clamp01((startAt - THUNDERDIVE_HIT_MS - THUNDERDIVE_IMPACT_MS) / THUNDERDIVE_RETURN_MS);
        const e = easeOutCubic(clamp01(dashT + t * 0.12));
        const baseX = lerp(to.x, from.x, e);
        const baseY = lerp(to.y, from.y, e);
        const drift = t * 30 * S;
        const x = baseX + nx * lateral * drift;
        const y = baseY + ny * lateral * drift - t * 20 * S;
        const flick = 0.55 + Math.abs(noise1(t * 18 + seed, seed)) * 0.45;
        const a = (1 - t) * 0.9 * flick;
        ctx.fillStyle = rgba(col, a);
        ctx.shadowColor = rgba('#fff98a', 0.95);
        ctx.shadowBlur = 7;
        ctx.beginPath();
        ctx.arc(x, y, size * (1 - t * 0.3), 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }
  // 戻り切ったあと、攻撃側にわずかに残る電気の余韻
  particles.push({
    delay: THUNDERDIVE_HIT_MS + THUNDERDIVE_IMPACT_MS + THUNDERDIVE_RETURN_MS * 0.7,
    maxLife: 280,
    blend: 'lighter',
    draw(ctx, t) {
      const a = (1 - t) * 0.6;
      const r = lerp(8 * S, 42 * S, easeOutCubic(t));
      const g = ctx.createRadialGradient(from.x, from.y, 0, from.x, from.y, r);
      g.addColorStop(0, rgba('#fff98a', a));
      g.addColorStop(0.5, rgba('#ffe600', a * 0.7));
      g.addColorStop(1, 'rgba(255,220,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(from.x, from.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

// ============================================================
// サンダーダイブ専用ランナー：Canvas上に「ポケモンの画像そのもの」を描画しながら
// 突進 → 激突 → 戻り を再生する。元のスプライト要素は演出中だけ透明化する。
// （playFlareDriveOnCanvas のでんき版。電撃フィルタ・雷本数がやや派手め）
// ============================================================
function playThunderDiveOnCanvas(layerEl, defSide) {
  const atkSide = defSide === 'opp' ? 'self' : 'opp';
  const atkWrap = document.getElementById(atkSide === 'opp' ? 'sprite-opp-wrap' : 'sprite-self-wrap');
  const defWrap = document.getElementById(defSide === 'opp' ? 'sprite-opp-wrap' : 'sprite-self-wrap');
  if (!layerEl || !atkWrap || !defWrap) return Promise.resolve();

  const atkImg = atkWrap.querySelector('img, .sprite-fallback');
  const defImg = defWrap.querySelector('img, .sprite-fallback');
  if (!atkImg) return Promise.resolve();

  const lr = layerEl.getBoundingClientRect();
  const aRect = atkImg.getBoundingClientRect();
  const dRect = (defImg || defWrap).getBoundingClientRect();
  const from = { x: aRect.left - lr.left + aRect.width / 2, y: aRect.top - lr.top + aRect.height / 2 };
  const to   = { x: dRect.left - lr.left + dRect.width / 2, y: dRect.top - lr.top + dRect.height / 2 };
  const spriteW = aRect.width || 120;
  const spriteH = aRect.height || 120;

  const w = lr.width, h = lr.height;
  const dpr = Math.min(2, window.devicePixelRatio || 1);

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;';
  layerEl.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.imageSmoothingEnabled = false;

  // 元のスプライトを一時的に透明化（Canvas側で同じ画像を描画する）
  const prevVisibility = atkImg.style.visibility;
  atkImg.style.visibility = 'hidden';

  const isSelfFlipped = (atkSide === 'self');
  const spriteSrc = atkImg;
  const info = { from, to, scale: 1 };

  // 電撃のパーティクル群（頭＝画像は含まない）
  const particles = [];
  spawnThunderDiveSpecial(particles, w, h, info);

  // スプライトの現在位置（時間から算出）
  function spritePos(ms) {
    if (ms < THUNDERDIVE_CHARGE_MS) {
      return { x: from.x, y: from.y, a: 0 };
    }
    if (ms < THUNDERDIVE_HIT_MS) {
      const p = (ms - THUNDERDIVE_CHARGE_MS) / THUNDERDIVE_DASH_MS;
      const e = easeInCubic(p) * 0.4 + p * 0.6;
      return { x: lerp(from.x, to.x, e), y: lerp(from.y, to.y, e), a: 1 };
    }
    if (ms < THUNDERDIVE_HIT_MS + THUNDERDIVE_IMPACT_MS) {
      const p = (ms - THUNDERDIVE_HIT_MS) / THUNDERDIVE_IMPACT_MS;
      return { x: to.x, y: to.y, a: 1 - p * 0.85 };
    }
    const p = (ms - THUNDERDIVE_HIT_MS - THUNDERDIVE_IMPACT_MS) / THUNDERDIVE_RETURN_MS;
    const e = easeOutCubic(p);
    return { x: lerp(to.x, from.x, e), y: lerp(to.y, from.y, e), a: 1 };
  }

  return new Promise((resolve) => {
    const start = performance.now();
    let resolved = false;
    const finish = () => {
      if (resolved) return;
      resolved = true;
      try { ctx.clearRect(0, 0, w, h); } catch (e) {}
      try { canvas.remove(); } catch (e) {}
      try { atkImg.style.visibility = prevVisibility; } catch (e) {}
      resolve();
    };

    function frame(now) {
      const ms = now - start;
      if (ms >= THUNDERDIVE_END_MS) { finish(); return; }

      ctx.clearRect(0, 0, w, h);

      // ① 電撃のパーティクル（画像の下層）
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        if (ms < (p.delay || 0)) continue;
        const pt = clamp01((ms - (p.delay || 0)) / (p.maxLife || THUNDERDIVE_END_MS));
        p.update && p.update(pt, ms);
        ctx.save();
        ctx.globalCompositeOperation = p.blend || 'source-over';
        p.draw(ctx, pt);
        ctx.restore();
      }

      // ② スプライト画像を現在位置に描画
      const sp = spritePos(ms);
      if (spriteSrc && spriteSrc.complete && sp.a > 0.01) {
        ctx.save();
        ctx.globalAlpha = sp.a;
        ctx.translate(sp.x, sp.y);
        if (isSelfFlipped) ctx.scale(-1, 1);
        ctx.drawImage(spriteSrc, -spriteW / 2, -spriteH / 2, spriteW, spriteH);
        ctx.restore();

        // 突進中：ポケモンのシルエットに電気の黄色を加算合成で重ねて
        // 「体に電気がまとわりついている」見た目にする（フレアドライブより強め＝派手め）
        if (ms >= THUNDERDIVE_CHARGE_MS && ms < THUNDERDIVE_HIT_MS + THUNDERDIVE_IMPACT_MS * 0.5) {
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = 0.4 * sp.a;
          ctx.translate(sp.x, sp.y);
          if (isSelfFlipped) ctx.scale(-1, 1);
          ctx.filter = 'brightness(0) sepia(1) hue-rotate(-32deg) saturate(8) brightness(1.9)';
          ctx.drawImage(spriteSrc, -spriteW / 2, -spriteH / 2, spriteW, spriteH);
          ctx.filter = 'none';
          ctx.restore();
        }
      }

      // ③ 突進中、体の周囲を回る小さな電気火花＋バチバチ稲妻（最前面の追加演出、フレアドライブより本数多め）
      if (ms >= THUNDERDIVE_CHARGE_MS && ms < THUNDERDIVE_HIT_MS) {
        const p = (ms - THUNDERDIVE_CHARGE_MS) / THUNDERDIVE_DASH_MS;
        const e = easeInCubic(p) * 0.4 + p * 0.6;
        const cx = lerp(from.x, to.x, e);
        const cy = lerp(from.y, to.y, e);
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        for (let s = 0; s < 6; s++) {
          const ang2 = (s / 6) * Math.PI * 2 + ms * 0.014;
          const rr = spriteW * 0.55;
          const x = cx + Math.cos(ang2) * rr;
          const y = cy + Math.sin(ang2) * rr * 0.7;
          ctx.fillStyle = rgba('#ffffff', 0.9);
          ctx.shadowColor = rgba('#fff98a', 1);
          ctx.shadowBlur = 9;
          ctx.beginPath();
          ctx.arc(x, y, 3.2, 0, Math.PI * 2);
          ctx.fill();
        }
        // 体を横切る細い稲妻（フレアドライブにはない、電気ならではの派手要素）
        if ((ms | 0) % 90 < 45) {
          const seed = Math.floor(ms / 90);
          ctx.strokeStyle = rgba('#ffffff', 0.8);
          ctx.lineWidth = 1.6;
          ctx.shadowColor = rgba('#fff98a', 1);
          ctx.shadowBlur = 8;
          drawLightningBolt(
            ctx,
            cx - spriteW * 0.4, cy - spriteH * 0.3,
            cx + spriteW * 0.4, cy + spriteH * 0.3,
            4, 10, seed
          );
          ctx.stroke();
        }
        ctx.restore();
      }

      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  });
}

// ============================================================
// げきりん（attack43）専用演出（リニューアル版）
// 旧版は「攻撃側から相手まで赤い稲妻線が一直線に走る」構成で、ビームのように
// 見えてしまっていた。そのため線による攻撃表現を全廃し、
// 「竜が怒りで我を忘れ、相手へ何度も襲いかかる」暴走の演出に作り直した。
//   ①暴走：攻撃側が赤黒く染まってその場で激しく震え、足元から赤黒い瘴気が
//          立ちのぼる。震えは徐々に激しくなり、体の輪郭に赤い脈動が走る。
//   ②咆哮：画面が赤紫に染まり、攻撃側を中心に衝撃リングが四方へ広がる。
//   ③乱舞：攻撃側自身が相手へ突進して爪で切り裂き、大きく弾かれるように
//          位置を変えてまた突進する、を3回繰り返す（3撃目のみ最大威力）。
//          突進の軌跡は太い赤黒の残像で、着弾は「三本の爪痕＋衝撃波＋火花」で見せる。
//   ④余韻：赤黒い残り火が立ちのぼり、攻撃側は元の位置へ戻って収まる。
// ・元のスプライト要素は演出中だけ透明化し、Canvas上に同じ画像を描画して
//   動かす（playFlareDriveOnCanvasと同じ方式）。
// ============================================================
const OUTRAGE_RAGE_MS = 520;        // ①その場で激しく震える
const OUTRAGE_FLASH_MS = 160;       // ②咆哮の赤紫フラッシュ
const OUTRAGE_STRIKE_MS = 190;      // ③1回の突進〜着弾（往路）
const OUTRAGE_RECOIL_MS = 130;      // ③着弾後、弾かれて次の助走位置へ
const OUTRAGE_BOLT_MS = (OUTRAGE_STRIKE_MS + OUTRAGE_RECOIL_MS) * 3;   // ③乱舞全体の尺（旧名を維持）
const OUTRAGE_HIT_MS = OUTRAGE_RAGE_MS + OUTRAGE_FLASH_MS;             // 乱舞の開始時刻（旧名を維持）
const OUTRAGE_RETURN_MS = 260;      // ④元の位置へ戻る
const OUTRAGE_END_MS = OUTRAGE_HIT_MS + OUTRAGE_BOLT_MS + OUTRAGE_RETURN_MS + 160;

// 各撃の着弾時刻（画面シェイク・フラッシュと連動させる）
function outrageHitTime(n) {           // n = 0,1,2
  return OUTRAGE_HIT_MS + (OUTRAGE_STRIKE_MS + OUTRAGE_RECOIL_MS) * n + OUTRAGE_STRIKE_MS;
}

// 1撃ごとの「助走位置」と「着弾点のずれ」。毎回違う角度から襲いかかる。
// 相手の周囲を半円状に回り込むようにして、単調な往復突進に見せない。
function outrageStrikePlan(from, to, S) {
  const dx = to.x - from.x, dy = to.y - from.y;
  const dist = Math.hypot(dx, dy) || 1;
  const ux = dx / dist, uy = dy / dist;
  const nx = -uy, ny = ux;
  const back = 70 * S;                  // 相手から離れる距離（助走の長さ）
  return [
    // 1撃目：正面から
    { start: { x: from.x, y: from.y }, hit: { x: to.x - ux * 22 * S, y: to.y - uy * 22 * S }, claw: -0.55, power: 0.75 },
    // 2撃目：上側へ大きく弾かれ、斜め上から叩きつける
    { start: { x: to.x - ux * back + nx * 62 * S, y: to.y - uy * back + ny * 62 * S }, hit: { x: to.x + nx * 8 * S, y: to.y + ny * 8 * S }, claw: 0.5, power: 0.85 },
    // 3撃目：下側へ回り込み、最大の一撃
    { start: { x: to.x - ux * back - nx * 66 * S, y: to.y - uy * back - ny * 66 * S }, hit: { x: to.x - ux * 4 * S, y: to.y - uy * 4 * S }, claw: -0.15, power: 1.0 },
  ];
}

// 爪痕1組（3本）を描く共通関数。メイン版・フォールバック版で同じ見た目にするため共有する。
// 「格子」に見えないよう、3本を平行に・十分な間隔で並べ、中央の1本を最も長く太くして
// 竜の爪が引き裂いた形にする。各爪は根元が太く先端が細い刃の形で、
// 走った直後に外側から内側へ明るい芯が現れ、その後じわっと暗い血のような赤へ沈んで消える。
// cx,cy … 爪痕の中心 / ang … 爪の走る向き(rad) / power … 0..1 / el … 着弾からの経過ms
function drawOutrageClaws(ctx, cx, cy, ang, power, S, el) {
  const dxu = Math.cos(ang), dyu = Math.sin(ang);   // 爪の走る向き
  const nxu = -dyu, nyu = dxu;                       // 爪と直交する向き（並べる方向）
  const gap = (15 + power * 4) * S;                  // 爪同士の間隔（広めに取り、格子にしない）
  const lens = [0.78, 1.0, 0.7];                     // 中央が最長
  const baseLen = (46 + power * 20) * S;
  for (let c = 0; c < 3; c++) {
    const runP = clamp01((el - c * 26) / 150);        // 1本ずつ順に走る
    if (runP <= 0) continue;
    const fade = el > 340 ? clamp01(1 - (el - 340) / 240) : 1;
    if (fade <= 0) continue;
    const off = (c - 1) * gap;
    // 3本を少し扇状に開く（平行より力強く見える）
    const aa = ang + (c - 1) * 0.07;
    const ux2 = Math.cos(aa), uy2 = Math.sin(aa);
    const ax = cx + nxu * off, ay = cy + nyu * off;
    const len = baseLen * lens[c] * easeOutQuint(runP);
    const wd = (6.2 + power * 2.2) * S * (c === 1 ? 1.15 : 0.95);
    const x0 = ax - ux2 * len * 0.5, y0 = ay - uy2 * len * 0.5;
    const x1 = ax + ux2 * len * 0.5, y1 = ay + uy2 * len * 0.5;
    // 刃の形：始点(根元)側が太く、終点(先端)へ向けて尖る非対称な紡錘形
    const bx = x0 + (x1 - x0) * 0.3, by = y0 + (y1 - y0) * 0.3;    // 最も太い位置
    const sink = clamp01((el - 200) / 380);                        // 時間とともに赤黒く沈む
    ctx.save();
    ctx.globalAlpha = fade;
    // 外側の傷：暗い赤（通常合成で、背景を暗く潰して傷を「凹み」に見せる）
    ctx.fillStyle = rgba(sink > 0.5 ? '#5a0a18' : '#8a0e22', 0.92);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.quadraticCurveTo(bx + nxu * wd * 1.25, by + nyu * wd * 1.25, x1, y1);
    ctx.quadraticCurveTo(bx - nxu * wd * 1.25, by - nyu * wd * 1.25, x0, y0);
    ctx.closePath(); ctx.fill();
    // 発光：傷の縁が赤く光る（加算合成）。走った直後が最も強い
    ctx.globalCompositeOperation = 'lighter';
    ctx.shadowColor = rgba('#ff1a3a', 0.95); ctx.shadowBlur = 12 * S;
    ctx.fillStyle = rgba('#ff2a48', (1 - sink * 0.75) * 0.95);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.quadraticCurveTo(bx + nxu * wd * 0.85, by + nyu * wd * 0.85, x1, y1);
    ctx.quadraticCurveTo(bx - nxu * wd * 0.85, by - nyu * wd * 0.85, x0, y0);
    ctx.closePath(); ctx.fill();
    // 中心の白い芯（走った瞬間だけ強く光る）
    ctx.shadowBlur = 0;
    const coreA = (1 - clamp01((el - 60) / 200)) * 0.95;
    if (coreA > 0.02) {
      ctx.fillStyle = rgba('#fff0f2', coreA);
      ctx.beginPath();
      ctx.moveTo(x0 + ux2 * len * 0.08, y0 + uy2 * len * 0.08);
      ctx.quadraticCurveTo(bx + nxu * wd * 0.32, by + nyu * wd * 0.32, x1 - ux2 * len * 0.08, y1 - uy2 * len * 0.08);
      ctx.quadraticCurveTo(bx - nxu * wd * 0.32, by - nyu * wd * 0.32, x0 + ux2 * len * 0.08, y0 + uy2 * len * 0.08);
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }
}

function playOutrageOnCanvas(layerEl, defSide) {
  const atkSide = defSide === 'opp' ? 'self' : 'opp';
  const atkWrap = document.getElementById(atkSide === 'opp' ? 'sprite-opp-wrap' : 'sprite-self-wrap');
  const defWrap = document.getElementById(defSide === 'opp' ? 'sprite-opp-wrap' : 'sprite-self-wrap');
  if (!layerEl || !atkWrap || !defWrap) return Promise.resolve();

  const atkImg = atkWrap.querySelector('img, .sprite-fallback');
  const defImg = defWrap.querySelector('img, .sprite-fallback');
  if (!atkImg) return Promise.resolve();

  const lr = layerEl.getBoundingClientRect();
  const aRect = atkImg.getBoundingClientRect();
  const dRect = (defImg || defWrap).getBoundingClientRect();
  const from = { x: aRect.left - lr.left + aRect.width / 2, y: aRect.top - lr.top + aRect.height / 2 };
  const to   = { x: dRect.left - lr.left + dRect.width / 2, y: dRect.top - lr.top + dRect.height / 2 };
  const spriteW = aRect.width || 120;
  const spriteH = aRect.height || 120;
  const S = Math.max(0.6, Math.min(1.6, spriteW / 120));

  const w = lr.width, h = lr.height;
  const dpr = Math.min(2, window.devicePixelRatio || 1);

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;';
  layerEl.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.imageSmoothingEnabled = false;

  const prevVisibility = atkImg.style.visibility;
  atkImg.style.visibility = 'hidden';
  const isSelfFlipped = (atkSide === 'self');
  const spriteSrc = atkImg;
  const seed = rand(0, 100);
  const plan = outrageStrikePlan(from, to, S);

  // ---- 事前に決めておく乱数要素（drawの中でrandを呼ぶとチラつくため） ----
  const miasma = [];                    // ①足元の瘴気
  for (let i = 0; i < 14; i++) {
    miasma.push({ ox: rand(-0.5, 0.5), delay: rand(0, 380), life: rand(420, 640), rise: rand(34, 78), sz: rand(9, 18), sway: rand(-10, 10) });
  }
  const embers = [];                    // ④余韻の残り火
  for (let i = 0; i < 16; i++) {
    embers.push({ ox: rand(-0.45, 0.45), delay: rand(0, 220), life: rand(420, 700), rise: rand(30, 84), sz: rand(1.4, 3), sway: rand(-16, 16) });
  }
  // 各撃の火花・破片（着弾ごとに散り方を変える）
  const sparks = plan.map((pl) => {
    const arr = [];
    const n = Math.round(16 + pl.power * 10);
    for (let i = 0; i < n; i++) {
      arr.push({ ang: rand(0, Math.PI * 2), spd: rand(28, 86) * (0.6 + pl.power * 0.6), life: rand(220, 380), sz: rand(1.4, 3.2), hot: Math.random() < 0.45 });
    }
    return arr;
  });

  // 突進する攻撃側の「現在位置・向き・アルファ」を時刻から求める
  function spritePose(ms) {
    if (ms < OUTRAGE_HIT_MS) return { x: from.x, y: from.y, rot: 0, dashing: false, strike: -1, p: 0 };
    const t = ms - OUTRAGE_HIT_MS;
    if (t < OUTRAGE_BOLT_MS) {
      const unit = OUTRAGE_STRIKE_MS + OUTRAGE_RECOIL_MS;
      const k = Math.min(2, Math.floor(t / unit));
      const u = t - k * unit;
      const pl = plan[k];
      if (u < OUTRAGE_STRIKE_MS) {
        // 助走位置→着弾点：終盤ほど加速する急襲。最初の1撃目だけ元の位置から発進する
        const p = clamp01(u / OUTRAGE_STRIKE_MS);
        const e = easeInCubic(p) * 0.65 + p * 0.35;
        return { x: lerp(pl.start.x, pl.hit.x, e), y: lerp(pl.start.y, pl.hit.y, e), rot: 0, dashing: true, strike: k, p };
      }
      // 着弾後：次の助走位置へ弾かれるように離れる（最終撃は元の位置へ向かう準備）
      const p = clamp01((u - OUTRAGE_STRIKE_MS) / OUTRAGE_RECOIL_MS);
      const next = k < 2 ? plan[k + 1].start : from;
      const e = easeOutCubic(p);
      return { x: lerp(pl.hit.x, next.x, e), y: lerp(pl.hit.y, next.y, e), rot: 0, dashing: false, strike: k, p: 1 + p };
    }
    // ④元の位置へ戻る
    const p = clamp01((t - OUTRAGE_BOLT_MS) / OUTRAGE_RETURN_MS);
    const last = plan[2].start;
    const e = easeOutCubic(p);
    return { x: lerp(last.x, from.x, e), y: lerp(last.y, from.y, e), rot: 0, dashing: false, strike: -1, p: 3 };
  }

  // ---- 赤黒い着色用のオフスクリーン ----
  // スプライトの元の色（青など）を活かしたまま「暗く・赤く」染めるため、
  // ①スプライトを描く ②source-atopで暗赤を重ねる（＝形状の内側だけ着色）を
  // 小さなcanvas上で行い、それをメインcanvasへ貼る方式にする。
  const tintCanvas = document.createElement('canvas');
  tintCanvas.width = Math.max(2, Math.ceil(spriteW * 1.5));
  tintCanvas.height = Math.max(2, Math.ceil(spriteH * 1.5));
  const tctx = tintCanvas.getContext('2d');
  tctx.imageSmoothingEnabled = false;

  // amount: 0..1 で赤黒さの強さ。edgeGlow: 輪郭の赤い発光の強さ
  function drawTintedSprite(x, y, amount, edgeGlow) {
    const tw = tintCanvas.width, th = tintCanvas.height;
    tctx.clearRect(0, 0, tw, th);
    tctx.save();
    tctx.translate(tw / 2, th / 2);
    if (isSelfFlipped) tctx.scale(-1, 1);
    tctx.drawImage(spriteSrc, -spriteW / 2, -spriteH / 2, spriteW, spriteH);
    tctx.restore();
    if (amount > 0.01) {
      // 形状の内側だけに、暗い赤を重ねる（元の色は透けて残る＝青竜が「赤黒く」なる）
      tctx.globalCompositeOperation = 'source-atop';
      // 暗く沈める（主成分）→ 上から下へ向かって赤みを足す（頭側は暗め・足側に赤が濃い）
      tctx.fillStyle = rgba('#2a0410', amount * 0.42);
      tctx.fillRect(0, 0, tw, th);
      const gr = tctx.createLinearGradient(0, 0, 0, th);
      gr.addColorStop(0, rgba('#c0102a', amount * 0.10));
      gr.addColorStop(1, rgba('#ff2038', amount * 0.30));
      tctx.fillStyle = gr;
      tctx.fillRect(0, 0, tw, th);
      tctx.globalCompositeOperation = 'source-over';
    }
    ctx.drawImage(tintCanvas, x - tw / 2, y - th / 2);
    // 輪郭の赤い発光：シルエットを赤で塗りつぶしたものを、ぼかして背後に敷く
    if (edgeGlow > 0.01) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = edgeGlow;
      ctx.filter = 'blur(' + (3 * S) + 'px) brightness(0) saturate(100%) invert(14%) sepia(90%) saturate(3000%) hue-rotate(-8deg)';
      ctx.drawImage(tintCanvas, x - tw / 2, y - th / 2);
      ctx.filter = 'none';
      ctx.restore();
    }
  }

  return new Promise((resolve) => {
    const start = performance.now();
    let resolved = false;
    const finish = () => {
      if (resolved) return;
      resolved = true;
      try { ctx.clearRect(0, 0, w, h); } catch (e) {}
      try { canvas.remove(); } catch (e) {}
      try { atkImg.style.visibility = prevVisibility; } catch (e) {}
      resolve();
    };

    function frame(now) {
      const ms = now - start;
      if (ms >= OUTRAGE_END_MS) { finish(); return; }
      ctx.clearRect(0, 0, w, h);

      // =========================================================
      // 背景レイヤー（スプライトの下）
      // =========================================================

      // ---- ①足元から立ちのぼる赤黒い瘴気（暴走の予兆）----
      if (ms < OUTRAGE_HIT_MS + 120) {
        miasma.forEach((m) => {
          const t = clamp01((ms - m.delay) / m.life);
          if (ms < m.delay || t >= 1) return;
          const a = Math.sin(Math.PI * t) * 0.5 * (0.5 + 0.5 * clamp01(ms / OUTRAGE_RAGE_MS));
          const x = from.x + m.ox * spriteW * 0.9 + m.sway * t * S;
          const y = from.y + spriteH * 0.38 - m.rise * easeOutCubic(t) * S;
          const r = m.sz * S * (0.8 + t * 1.4);
          const g = ctx.createRadialGradient(x, y, 0, x, y, r);
          g.addColorStop(0, rgba('#7a0f24', a));
          g.addColorStop(0.6, rgba('#3a0612', a * 0.6));
          g.addColorStop(1, 'rgba(20,0,8,0)');
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
        });
      }

      // ---- ③乱舞：突進の軌跡（太い赤黒の残像）。線ではなく「面」で見せる ----
      const pose = spritePose(ms);
      if (ms >= OUTRAGE_HIT_MS && ms < OUTRAGE_HIT_MS + OUTRAGE_BOLT_MS) {
        const t = ms - OUTRAGE_HIT_MS;
        const unit = OUTRAGE_STRIKE_MS + OUTRAGE_RECOIL_MS;
        const k = Math.min(2, Math.floor(t / unit));
        const u = t - k * unit;
        const pl = plan[k];
        if (u < OUTRAGE_STRIKE_MS + 90) {
          // 直近の残像を8つ重ねて描く（古いほど薄く小さく）
          const trailN = 8;
          for (let i = trailN; i >= 1; i--) {
            const tp = Math.max(0, ms - i * 12);
            const ps = spritePose(tp);
            if (!ps.dashing) continue;
            const ta = (1 - i / (trailN + 1)) * 0.55;
            ctx.save();
            ctx.globalAlpha = ta;
            ctx.translate(ps.x, ps.y);
            if (isSelfFlipped) ctx.scale(-1, 1);
            ctx.scale(1 - i * 0.02, 1 - i * 0.02);
            ctx.filter = 'brightness(0) saturate(100%) invert(10%) sepia(100%) saturate(4500%) hue-rotate(-12deg) brightness(0.85)';
            ctx.drawImage(spriteSrc, -spriteW / 2, -spriteH / 2, spriteW, spriteH);
            ctx.filter = 'none';
            ctx.restore();
          }
        }
      }

      // =========================================================
      // ①〜④ スプライト本体
      // =========================================================
      if (spriteSrc && spriteSrc.complete) {
        let px = pose.x, py = pose.y, tintA = 0;
        if (ms < OUTRAGE_RAGE_MS) {
          // ①その場で高速に震える：後半ほど激しく、縦にも跳ねる
          const f = clamp01(ms / OUTRAGE_RAGE_MS);
          const amp = (2.2 + 4.6 * easeInCubic(f)) * S;
          px += Math.sin(ms * 0.09) * amp;
          py += Math.sin(ms * 0.05 + 1.3) * amp * 0.4 - easeInCubic(f) * 2.5 * S;
          // 赤い脈動：心臓の鼓動のように強弱をつける
          tintA = (0.55 + 0.25 * Math.sin(ms * 0.03)) * easeOutCubic(f);
        } else if (ms < OUTRAGE_HIT_MS) {
          // ②咆哮：ぐっと身を反らして力を溜める（わずかに縮んで見える）
          tintA = 0.9;
          py -= 3 * S;
        } else if (pose.strike >= 0 || ms < OUTRAGE_HIT_MS + OUTRAGE_BOLT_MS) {
          tintA = pose.dashing ? 1.0 : 0.75;          // 突進中はより赤黒く
        } else {
          tintA = 0.75 * (1 - clamp01((ms - OUTRAGE_HIT_MS - OUTRAGE_BOLT_MS) / OUTRAGE_RETURN_MS));
        }
        // 突進中は進行方向へわずかに伸びる（速度感）。伸縮はメインcanvas全体の変形として掛ける
        ctx.save();
        if (pose.dashing) {
          const stretch = 1 + 0.18 * easeInCubic(pose.p);
          const ang = Math.atan2(to.y - py, to.x - px);
          ctx.translate(px, py);
          ctx.rotate(ang); ctx.scale(stretch, 1 / Math.sqrt(stretch)); ctx.rotate(-ang);
          ctx.translate(-px, -py);
        }
        drawTintedSprite(px, py, tintA, tintA * 0.42);
        ctx.restore();
      }

      // =========================================================
      // 前景レイヤー（スプライトの上）
      // =========================================================

      // ---- ②咆哮：画面が赤紫に染まり、衝撃リングが広がる ----
      if (ms >= OUTRAGE_RAGE_MS && ms < OUTRAGE_HIT_MS + 140) {
        const p = clamp01((ms - OUTRAGE_RAGE_MS) / OUTRAGE_FLASH_MS);
        const a = Math.sin(Math.PI * clamp01(p)) * 0.5;
        if (ms < OUTRAGE_HIT_MS) {
          ctx.save();
          ctx.fillStyle = rgba('#a01840', a);
          ctx.fillRect(0, 0, w, h);
          ctx.restore();
        }
        // 衝撃リング（二重）：攻撃側から四方へ
        for (let i = 0; i < 2; i++) {
          const rp = clamp01((ms - OUTRAGE_RAGE_MS - i * 60) / 300);
          if (rp <= 0 || rp >= 1) continue;
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          ctx.strokeStyle = rgba(i === 0 ? '#ff4a5a' : '#c0203c', (1 - rp) * 0.7);
          ctx.lineWidth = Math.max(1, (5 - rp * 3.5) * S);
          ctx.shadowColor = rgba('#ff1a3a', 0.9); ctx.shadowBlur = 12 * S;
          ctx.beginPath();
          ctx.arc(from.x, from.y, lerp(14, 110, easeOutCubic(rp)) * S, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }
      }

      // ---- ③各撃の着弾演出：爪痕・衝撃波・火花 ----
      for (let k = 0; k < 3; k++) {
        const ht = outrageHitTime(k);
        const el = ms - ht;
        if (el < 0 || el > 520) continue;
        const pl = plan[k];
        const hx = pl.hit.x, hy = pl.hit.y;
        // 着弾点は、相手の中心へ寄せて表示（相手のスプライトの上に爪痕が乗るように）
        const cx = lerp(hx, to.x, 0.7), cy = lerp(hy, to.y, 0.7);
        const pw = pl.power;

        // (a) 一瞬の白赤の閃光
        if (el < 150) {
          const fp = clamp01(el / 150);
          const r = lerp(8, 44 + pw * 22, easeOutCubic(fp)) * S;
          const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
          g.addColorStop(0, rgba('#ffffff', (1 - fp) * 0.9));
          g.addColorStop(0.35, rgba('#ff5a6a', (1 - fp) * 0.75));
          g.addColorStop(1, 'rgba(120,10,30,0)');
          ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = g;
          ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill(); ctx.restore();
        }

        // (b) 三本の爪痕：竜の爪が斜めに引き裂いた傷。線（ビーム）ではなく太い刃の形で見せる
        drawOutrageClaws(ctx, cx, cy, pl.claw, pw, S, el);

        // (c) 衝撃波：円形の主リング＋地面を這う平たい波。撃ごとに大きくなり、3撃目は二重
        const rings = pw >= 1 ? 2 : 1;
        for (let r0 = 0; r0 < rings; r0++) {
          const rp = clamp01((el - r0 * 80) / 380);
          if (rp <= 0 || rp >= 1) continue;
          const rr = lerp(10, 78 + pw * 44, easeOutCubic(rp)) * S;
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          ctx.strokeStyle = rgba(r0 === 0 ? '#ff7a88' : '#c01c3c', (1 - rp) * 0.85);
          ctx.lineWidth = Math.max(1.2, (6 - rp * 4.4) * S);
          ctx.shadowColor = rgba('#ff1a3a', 0.95); ctx.shadowBlur = 14 * S;
          ctx.beginPath(); ctx.arc(cx, cy, rr, 0, Math.PI * 2); ctx.stroke();
          ctx.restore();
        }
        {
          // 地面を這う平たい波（足元の高さ＝相手の中心よりやや下）
          const gp = clamp01((el - 30) / 360);
          if (gp > 0 && gp < 1) {
            ctx.save();
            ctx.globalCompositeOperation = 'lighter';
            ctx.strokeStyle = rgba('#ff3a52', (1 - gp) * 0.55);
            ctx.lineWidth = Math.max(1, (4 - gp * 3) * S);
            ctx.shadowColor = rgba('#ff1a3a', 0.8); ctx.shadowBlur = 8 * S;
            ctx.beginPath();
            ctx.ellipse(to.x, to.y + 30 * S, lerp(14, 110 + pw * 40, easeOutCubic(gp)) * S, lerp(4, 22 + pw * 8, easeOutCubic(gp)) * S, 0, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
          }
        }

        // (d) 火花・破片：放射状に飛び散り、重力で落ちる
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        sparks[k].forEach((sp) => {
          const st = clamp01(el / sp.life);
          if (st >= 1) return;
          const e = easeOutCubic(st);
          const x = cx + Math.cos(sp.ang) * sp.spd * e * S;
          const y = cy + Math.sin(sp.ang) * sp.spd * e * S * 0.8 + st * st * 18 * S;
          const a = (1 - st) * 0.95;
          ctx.fillStyle = rgba(sp.hot ? '#ffd0c8' : '#ff2a3a', a);
          ctx.shadowColor = rgba('#ff2a3a', 0.9); ctx.shadowBlur = 6 * S;
          ctx.beginPath(); ctx.arc(x, y, sp.sz * S * (1 - st * 0.5), 0, Math.PI * 2); ctx.fill();
        });
        ctx.restore();
      }

      // ---- ④余韻：攻撃側に赤黒い残り火が立ちのぼる ----
      const endStart = OUTRAGE_HIT_MS + OUTRAGE_BOLT_MS;
      if (ms >= endStart) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        embers.forEach((m) => {
          const t = clamp01((ms - endStart - m.delay) / m.life);
          if (ms - endStart < m.delay || t >= 1) return;
          const a = Math.sin(Math.PI * t) * 0.85;
          const x = from.x + m.ox * spriteW + m.sway * t * S;
          const y = from.y + spriteH * 0.2 - m.rise * easeOutCubic(t) * S;
          ctx.fillStyle = rgba('#ff3a48', a);
          ctx.shadowColor = rgba('#ff1a3a', 0.9); ctx.shadowBlur = 6 * S;
          ctx.beginPath(); ctx.arc(x, y, m.sz * S * (1 - t * 0.4), 0, Math.PI * 2); ctx.fill();
        });
        ctx.restore();
      }

      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  });
}

// げきりんのフォールバック用軽量版：playOutrageOnCanvasが使えない環境（wrapEl取得失敗時など）向け。
// スプライト自体は動かせないため、メイン版と同じ「赤紫フラッシュ→3連撃の爪痕・衝撃波・火花」を
// 攻撃側→相手の座標だけで再現する簡易パーティクル版。赤い線（ビーム）表現は使わない。
function spawnOutrageFallbackSpecial(particles, w, h, info) {
  const from = (info && info.from) || { x: w * 0.28, y: h * 0.68 };
  const to = (info && info.to) || { x: w * 0.72, y: h * 0.32 };
  const S = (info && info.scale) || 1;
  const plan = outrageStrikePlan(from, to, S);

  // ①攻撃側が赤黒く脈打つ（震えの代わりに、足元の赤黒いオーラで表現）
  particles.push({
    maxLife: OUTRAGE_RAGE_MS + 40,
    blend: 'lighter',
    draw(ctx, t) {
      const a = (0.35 + 0.15 * Math.sin(t * 40)) * Math.sin(Math.PI * clamp01(t)) ;
      const r = lerp(12, 44, t) * S;
      const g = ctx.createRadialGradient(from.x, from.y, 0, from.x, from.y, r);
      g.addColorStop(0, rgba('#ff2a3a', a));
      g.addColorStop(1, 'rgba(80,10,20,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(from.x, from.y, r, 0, Math.PI * 2); ctx.fill();
    }
  });
  // ②赤紫の全画面フラッシュと、攻撃側から広がる衝撃リング
  particles.push({
    delay: OUTRAGE_RAGE_MS,
    maxLife: OUTRAGE_FLASH_MS,
    draw(ctx, t) {
      ctx.fillStyle = rgba('#a01840', Math.sin(Math.PI * clamp01(t)) * 0.5);
      ctx.fillRect(0, 0, w, h);
    }
  });
  particles.push({
    delay: OUTRAGE_RAGE_MS,
    maxLife: 300,
    blend: 'lighter',
    draw(ctx, t) {
      ctx.strokeStyle = rgba('#ff4a5a', (1 - t) * 0.7);
      ctx.lineWidth = Math.max(1, (5 - t * 3.5) * S);
      ctx.beginPath(); ctx.arc(from.x, from.y, lerp(14, 110, easeOutCubic(t)) * S, 0, Math.PI * 2); ctx.stroke();
    }
  });

  // ③3連撃：各着弾点に閃光・三本の爪痕・衝撃波・火花
  plan.forEach((pl, k) => {
    const ht = outrageHitTime(k);
    const cx = lerp(pl.hit.x, to.x, 0.7), cy = lerp(pl.hit.y, to.y, 0.7);
    const pw = pl.power;
    particles.push({
      delay: ht, maxLife: 150, blend: 'lighter',
      draw(ctx, t) {
        const r = lerp(8, 44 + pw * 22, easeOutCubic(t)) * S;
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        g.addColorStop(0, rgba('#ffffff', (1 - t) * 0.9));
        g.addColorStop(0.35, rgba('#ff5a6a', (1 - t) * 0.75));
        g.addColorStop(1, 'rgba(120,10,30,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
      }
    });
    // 爪痕：メイン版と共通の描画関数を使う（着弾からの経過msをtから復元して渡す）
    particles.push({
      delay: ht, maxLife: 580,
      draw(ctx, t) { drawOutrageClaws(ctx, cx, cy, pl.claw, pw, S, t * 580); }
    });
    // 衝撃波：円形の主リング
    particles.push({
      delay: ht, maxLife: 380, blend: 'lighter',
      draw(ctx, t) {
        ctx.strokeStyle = rgba('#ff7a88', (1 - t) * 0.85);
        ctx.lineWidth = Math.max(1.2, (6 - t * 4.4) * S);
        ctx.shadowColor = rgba('#ff1a3a', 0.95); ctx.shadowBlur = 14 * S;
        ctx.beginPath(); ctx.arc(cx, cy, lerp(10, 78 + pw * 44, easeOutCubic(t)) * S, 0, Math.PI * 2); ctx.stroke();
      }
    });
    const n = Math.round(14 + pw * 8);
    for (let i = 0; i < n; i++) {
      const ang = rand(0, Math.PI * 2), spd = rand(28, 86) * (0.6 + pw * 0.6), sz = rand(1.4, 3.2), hot = Math.random() < 0.45;
      particles.push({
        delay: ht, maxLife: rand(220, 380), blend: 'lighter',
        draw(ctx, t) {
          const e = easeOutCubic(t);
          ctx.fillStyle = rgba(hot ? '#ffd0c8' : '#ff2a3a', (1 - t) * 0.95);
          ctx.beginPath();
          ctx.arc(cx + Math.cos(ang) * spd * e * S, cy + Math.sin(ang) * spd * e * S * 0.8 + t * t * 18 * S, sz * S * (1 - t * 0.5), 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }
  });
}

// ============================================================
// かみかぜ／しはいのかぜ／かみわたし：攻撃側の背後から神々しい風が吹き荒れ、
// 相手を薙ぎ払う演出。風は攻撃側を通り抜け、相手を越えて画面外まで流れていく。
// 構成：①背後に黄金の神気が立ち上る ②青白い風の帯が背後から吹き出す
//       ③風に乗って花びら・葉・光の粒が舞う ④相手を越えた位置で風が渦を巻いて消える
// 「流れる光の帯」「神々しい黄金の光」「風に舞う花びら」がキモ。
// ============================================================
const KAMIKAZE_CHARGE_MS = 420;
const KAMIKAZE_FLOW_MS = 900;
const KAMIKAZE_HIT_MS = KAMIKAZE_CHARGE_MS + 240;
const KAMIKAZE_END_MS = KAMIKAZE_CHARGE_MS + KAMIKAZE_FLOW_MS + 240;

function spawnKamikazeSpecial(particles, w, h, info) {
  const from = (info && info.from) || { x: w * 0.28, y: h * 0.68 };
  const to = (info && info.to) || { x: w * 0.72, y: h * 0.32 };
  const S = (info && info.scale) || 1;
  const R = Math.max(w, h);
  const dx = to.x - from.x, dy = to.y - from.y;
  const dist = Math.hypot(dx, dy) || 1;
  const ang = Math.atan2(dy, dx);
  const ux = dx / dist, uy = dy / dist;
  const nx = -uy, ny = ux;
  // 風の起点：攻撃側の背後の画面外
  const origin = { x: from.x - ux * 130 * S, y: from.y - uy * 130 * S };
  // 風の終点：相手を越えた画面外
  const terminus = { x: to.x + ux * 130 * S, y: to.y + uy * 130 * S };
  const seedA = rand(0, 100);

  // ---- 幕0：背後に黄金の神気が立ち上る ----
  particles.push({
    maxLife: KAMIKAZE_CHARGE_MS + 240,
    blend: 'lighter',
    draw(ctx, t) {
      const env = Math.sin(Math.PI * clamp01(t)) * 0.85;
      const r = lerp(20 * S, 130 * S, easeOutCubic(t));
      const g = ctx.createRadialGradient(origin.x, origin.y, 0, origin.x, origin.y, r);
      g.addColorStop(0, rgba('#fff8d0', env));
      g.addColorStop(0.35, rgba('#ffe98a', env * 0.75));
      g.addColorStop(0.7, rgba('#a8e0ff', env * 0.4));
      g.addColorStop(1, 'rgba(168,224,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(origin.x, origin.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  // 黄金の神気から放射される光条
  for (let i = 0; i < 10; i++) {
    const a0 = (i / 10) * Math.PI * 2 + rand(-0.15, 0.15);
    const len0 = rand(60, 130) * S;
    particles.push({
      delay: 40 + i * 22,
      maxLife: KAMIKAZE_CHARGE_MS + 100,
      blend: 'lighter',
      draw(ctx, t) {
        const grow = easeOutCubic(Math.min(1, t * 2));
        const alpha = Math.sin(Math.PI * clamp01(t)) * 0.8;
        const ex = origin.x + Math.cos(a0) * len0 * grow;
        const ey = origin.y + Math.sin(a0) * len0 * grow;
        ctx.strokeStyle = rgba('#fff2b0', alpha);
        ctx.shadowColor = rgba('#ffe98a', 0.9);
        ctx.shadowBlur = 14;
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.moveTo(origin.x, origin.y);
        ctx.lineTo(ex, ey);
        ctx.stroke();
      }
    });
  }
  // 中心の核（収束する光の粒）
  for (let i = 0; i < 16; i++) {
    const a0 = (i / 16) * Math.PI * 2 + rand(-0.25, 0.25);
    const r0 = rand(60, 110) * S;
    const sz = rand(2, 4) * S;
    particles.push({
      delay: rand(0, 300),
      maxLife: rand(200, 300),
      blend: 'lighter',
      draw(ctx, t) {
        if (t >= 1) return;
        const e = easeInCubic(t);
        const rr = lerp(r0, 3 * S, e);
        const spin = a0 + t * 3;
        const x = origin.x + Math.cos(spin) * rr;
        const y = origin.y + Math.sin(spin) * rr * 0.85;
        const a = clamp01(t * 5) * (1 - Math.max(0, (t - 0.85) / 0.15));
        ctx.fillStyle = rgba('#fff5c0', a);
        ctx.shadowColor = rgba('#ffe98a', 1);
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.arc(x, y, sz, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }

  // ---- 幕1：風の帯（背後 → 相手を越えた先まで流れる光の帯） ----
  const STREAK_COUNT = 16;
  for (let i = 0; i < STREAK_COUNT; i++) {
    const lateral = (i / (STREAK_COUNT - 1) - 0.5) * 2.0;  // -1〜+1の横オフセット
    const flowSpeed = rand(0.7, 1.3);
    const flowDelay = rand(0, 600);
    const streakLen = rand(0.30, 0.50);   // 帯の長さ（パス全体に対する割合）
    const seed = rand(0, 100);
    const width = rand(2.2, 5.5) * S;
    const hue = pick(['#e0f4ff', '#c8e8ff', '#eaf8ff', '#d6ecff']);
    particles.push({
      delay: flowDelay,
      maxLife: rand(520, 820),
      blend: 'lighter',
      draw(ctx, t) {
        const env = Math.sin(Math.PI * clamp01(t));
        if (env <= 0.05) return;
        // パス上の位置：帯の先頭が -streakLen から 1.0 まで動く
        const head = -streakLen + (1 + streakLen) * t * flowSpeed;
        const tail = head - streakLen;
        const perpBase = lateral * 70 * S;
        ctx.strokeStyle = rgba(hue, env * 0.85);
        ctx.shadowColor = rgba('#a8e0ff', 1);
        ctx.shadowBlur = 14;
        ctx.lineWidth = width * env;
        ctx.lineCap = 'round';
        ctx.beginPath();
        const segs = 22;
        let started = false;
        for (let s = 0; s <= segs; s++) {
          const k = s / segs;
          const kPath = tail + (head - tail) * k;
          if (kPath < -0.05 || kPath > 1.05) continue;
          const kk = clamp01(kPath);
          // パス上の基点
          const bx = lerp(origin.x, terminus.x, kk);
          const by = lerp(origin.y, terminus.y, kk);
          // 進行方向に垂直な揺らぎ（風の乱流）
          const wob1 = noise1(kk * 5 + t * 5 + seed, seed) * 22 * S;
          const wob2 = noise1(kk * 5 + t * 5 + seed + 3, seed + 3) * 22 * S;
          const px = bx + nx * (perpBase + wob1 + wob2 * 0.5);
          const py = by + ny * (perpBase + wob1 + wob2 * 0.5);
          if (!started) { ctx.moveTo(px, py); started = true; }
          else ctx.lineTo(px, py);
        }
        if (started) ctx.stroke();
      }
    });
  }

  // ---- 幕2：風に乗って舞う花びら・葉 ----
  for (let i = 0; i < 24; i++) {
    const lateral = rand(-1.0, 1.0);
    const flowSpeed = rand(0.8, 1.4);
    const flowDelay = rand(0, 700);
    const size = rand(5, 10) * S;
    const rot0 = rand(0, Math.PI * 2);
    const rotV = rand(-6, 6);
    const col = pick(['#ffd6ef', '#fff0d0', '#d8f0ff', '#ffe9a0']);
    const isPetal = i % 2 === 0;
    const seed = rand(0, 100);
    particles.push({
      delay: flowDelay,
      maxLife: rand(560, 860),
      draw(ctx, t) {
        const env = Math.sin(Math.PI * clamp01(t));
        if (env <= 0.05) return;
        const head = -0.1 + 1.2 * t * flowSpeed;
        const kk = clamp01(head);
        const bx = lerp(origin.x, terminus.x, kk);
        const by = lerp(origin.y, terminus.y, kk);
        const wob1 = noise1(kk * 4 + t * 4 + seed, seed) * 32 * S;
        const wob2 = noise1(kk * 4 + t * 4 + seed + 7, seed + 7) * 32 * S;
        const x = bx + nx * (lateral * 70 * S + wob1 + wob2);
        const y = by + ny * (lateral * 70 * S + wob1 + wob2) - Math.sin(t * Math.PI) * 12 * S;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(rot0 + t * rotV);
        if (isPetal) {
          // 花びら（涙滴型）
          ctx.fillStyle = rgba(col, env);
          ctx.shadowColor = rgba(col, 0.7);
          ctx.shadowBlur = 6;
          ctx.beginPath();
          ctx.moveTo(0, -size);
          ctx.quadraticCurveTo(size * 0.8, 0, 0, size);
          ctx.quadraticCurveTo(-size * 0.8, 0, 0, -size);
          ctx.fill();
        } else {
          // 葉っぱ（細長い楕円）
          ctx.fillStyle = rgba(col, env);
          ctx.shadowColor = rgba(col, 0.7);
          ctx.shadowBlur = 6;
          ctx.beginPath();
          ctx.ellipse(0, 0, size * 0.9, size * 0.4, 0, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }
    });
  }

  // ---- 幕3：風に乗る光の粒（速く流れる） ----
  for (let i = 0; i < 40; i++) {
    const lateral = rand(-1.1, 1.1);
    const flowSpeed = rand(0.9, 1.6);
    const flowDelay = rand(0, 720);
    const sz = rand(1.6, 3.4) * S;
    const col = pick(['#ffffff', '#eaf8ff', '#fff5c0']);
    const seed = rand(0, 100);
    particles.push({
      delay: flowDelay,
      maxLife: rand(420, 660),
      blend: 'lighter',
      draw(ctx, t) {
        const env = Math.sin(Math.PI * clamp01(t));
        if (env <= 0.1) return;
        const head = -0.05 + 1.1 * t * flowSpeed;
        const kk = clamp01(head);
        const bx = lerp(origin.x, terminus.x, kk);
        const by = lerp(origin.y, terminus.y, kk);
        const wob = noise1(kk * 5 + t * 6 + seed, seed) * 20 * S;
        const x = bx + nx * (lateral * 80 * S + wob);
        const y = by + ny * (lateral * 80 * S + wob);
        ctx.fillStyle = rgba(col, env);
        ctx.shadowColor = rgba('#a8e0ff', 1);
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.arc(x, y, sz, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }

  // ---- 幕4：相手を越えた位置で風が渦を巻いて消える ----
  particles.push({
    delay: KAMIKAZE_HIT_MS - 60,
    maxLife: 620,
    blend: 'lighter',
    draw(ctx, t) {
      const env = Math.sin(Math.PI * clamp01(t));
      const spin = t * 8;
      // 渦を構成する曲線（4本の渦巻き）
      for (let i = 0; i < 4; i++) {
        const baseAng = (i / 4) * Math.PI * 2;
        const r = lerp(8 * S, 90 * S, easeOutCubic(t));
        ctx.strokeStyle = rgba('#eaf8ff', env * 0.7);
        ctx.shadowColor = rgba('#a8e0ff', 0.9);
        ctx.shadowBlur = 12;
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        for (let s = 0; s <= 24; s++) {
          const k = s / 24;
          const a = baseAng + spin + k * Math.PI * 1.6;
          const rr = r * k;
          const px = to.x + Math.cos(a) * rr;
          const py = to.y + Math.sin(a) * rr;
          if (s === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.stroke();
      }
    }
  });
  // 相手側での風圧の輪（風が相手を叩く瞬間）
  particles.push({
    delay: KAMIKAZE_HIT_MS,
    maxLife: 420,
    blend: 'lighter',
    draw(ctx, t) {
      const r = lerp(8 * S, R * 0.32, easeOutQuint(t));
      const a = (1 - t) * 0.8;
      ctx.strokeStyle = rgba('#eaf8ff', a);
      ctx.lineWidth = 5 * (1 - t * 0.5);
      ctx.shadowColor = rgba('#a8e0ff', 0.9);
      ctx.shadowBlur = 16;
      ctx.beginPath();
      ctx.ellipse(to.x, to.y, r * 0.6, r, ang, 0, Math.PI * 2);
      ctx.stroke();
    }
  });
  // 相手を越えた位置で弾ける光の粒
  for (let i = 0; i < 26; i++) {
    const sa = rand(0, Math.PI * 2);
    const sp = rand(30, 120) * S;
    const sz = rand(2, 4.5) * S;
    const col = pick(['#ffffff', '#eaf8ff', '#fff5c0', '#ffe98a']);
    particles.push({
      delay: KAMIKAZE_HIT_MS + rand(0, 120),
      maxLife: rand(420, 640),
      blend: 'lighter',
      draw(ctx, t) {
        const e = easeOutCubic(t);
        const x = to.x + Math.cos(sa) * sp * e;
        const y = to.y + Math.sin(sa) * sp * e - t * t * h * 0.04;
        const a = (1 - t) * 0.9;
        ctx.fillStyle = rgba(col, a);
        ctx.shadowColor = rgba('#a8e0ff', 0.9);
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(x, y, sz * (1 - t * 0.4), 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }
}

// ============================================================
// ハイドロポンプ：口元から極太の高圧水流を放ち、相手を押し流す演出（原作準拠）
// 構成：①口元に水が渦を巻いて集まり、水球が形成される ②極太の水流がまっすぐ伸びる
//       ③水流に沿って雫と気泡が流れ、水の輪が押し寄せる ④着弾で大量の水しぶき
//       ⑤地面を水が這い、蒸気と泡が残る
// 「太く真っ直ぐな水の柱」「水流の中を流れる気泡」「着弾のしぶき」がキモ。
// ============================================================
const HYDROPUMP_CHARGE_MS = 360;
const HYDROPUMP_EXTEND_MS = 160;
const HYDROPUMP_SUSTAIN_MS = 620;
const HYDROPUMP_FADE_MS = 320;
const HYDROPUMP_HIT_MS = HYDROPUMP_CHARGE_MS + HYDROPUMP_EXTEND_MS;
const HYDROPUMP_END_MS = HYDROPUMP_HIT_MS + HYDROPUMP_SUSTAIN_MS + HYDROPUMP_FADE_MS;

function spawnHydroPumpSpecial(particles, w, h, info) {
  const from = (info && info.from) || { x: w * 0.28, y: h * 0.68 };
  const to = (info && info.to) || { x: w * 0.72, y: h * 0.32 };
  const S = (info && info.scale) || 1;
  const R = Math.max(w, h);
  const dx = to.x - from.x, dy = to.y - from.y;
  const dist = Math.hypot(dx, dy) || 1;
  const ang = Math.atan2(dy, dx);
  const ux = dx / dist, uy = dy / dist;
  const nx = -uy, ny = ux;
  const mouth = { x: from.x + ux * 30 * S, y: from.y + uy * 30 * S };
  const beamW = Math.min(48 * S, 58);
  const seedA = rand(0, 100), seedB = rand(0, 100);

  function beamStrength(ms) {
    if (ms < HYDROPUMP_CHARGE_MS) return 0;
    const since = ms - HYDROPUMP_CHARGE_MS;
    if (since < HYDROPUMP_EXTEND_MS) return easeOutQuint(since / HYDROPUMP_EXTEND_MS);
    if (since < HYDROPUMP_EXTEND_MS + HYDROPUMP_SUSTAIN_MS) return 1 + Math.sin((since - HYDROPUMP_EXTEND_MS) * 0.05) * 0.06;
    const f = (since - HYDROPUMP_EXTEND_MS - HYDROPUMP_SUSTAIN_MS) / HYDROPUMP_FADE_MS;
    return Math.pow(1 - clamp01(f), 1.6);
  }
  function beamReach(ms) {
    if (ms < HYDROPUMP_CHARGE_MS) return 0;
    return easeOutQuint(clamp01((ms - HYDROPUMP_CHARGE_MS) / HYDROPUMP_EXTEND_MS));
  }

  // ---- 幕0：口元に水が集まり、水球が形成される ----
  particles.push({
    maxLife: HYDROPUMP_CHARGE_MS + 60,
    blend: 'lighter',
    draw(ctx, t) {
      const a = Math.sin(Math.PI * clamp01(t)) * 0.65;
      const r = lerp(8 * S, 42 * S, easeOutCubic(t));
      const g = ctx.createRadialGradient(mouth.x, mouth.y, 0, mouth.x, mouth.y, r);
      g.addColorStop(0, rgba('#ffffff', a));
      g.addColorStop(0.4, rgba('#bfe8ff', a * 0.9));
      g.addColorStop(0.75, rgba('#3ca0e6', a * 0.5));
      g.addColorStop(1, 'rgba(60,160,230,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(mouth.x, mouth.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  // 集まる水滴（外から中心へ、渦を巻いて）
  for (let i = 0; i < 18; i++) {
    const a0 = (i / 18) * Math.PI * 2 + rand(-0.2, 0.2);
    const r0 = rand(50, 85) * S;
    const sz = rand(3, 6) * S;
    particles.push({
      delay: rand(0, 260),
      maxLife: rand(220, 320),
      draw(ctx, t) {
        if (t >= 1) return;
        const e = easeInCubic(t);
        const rr = lerp(r0, 4 * S, e);
        const spin = a0 + t * 3;
        const x = mouth.x + Math.cos(spin) * rr;
        const y = mouth.y + Math.sin(spin) * rr * 0.85;
        const a = clamp01(t * 4) * (1 - Math.max(0, (t - 0.85) / 0.15));
        const g = ctx.createRadialGradient(x, y, 0, x, y, sz * 1.8);
        g.addColorStop(0, rgba('#ffffff', a));
        g.addColorStop(0.4, rgba('#bfe8ff', a * 0.85));
        g.addColorStop(1, 'rgba(60,160,230,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, sz * 1.8, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }
  // 練り上がる水球
  particles.push({
    delay: 60,
    maxLife: HYDROPUMP_CHARGE_MS - 40,
    blend: 'lighter',
    draw(ctx, t) {
      const grow = easeOutCubic(Math.min(1, t * 2));
      const a = clamp01(t * 3) * (1 - Math.max(0, (t - 0.9) / 0.1));
      const r = 18 * S * grow * (1 + Math.abs(noise1(t * 8, seedA)) * 0.15);
      const g = ctx.createRadialGradient(mouth.x - r * 0.3, mouth.y - r * 0.3, 0, mouth.x, mouth.y, r);
      g.addColorStop(0, rgba('#ffffff', a));
      g.addColorStop(0.4, rgba('#bfe8ff', a * 0.95));
      g.addColorStop(0.8, rgba('#3ca0e6', a * 0.8));
      g.addColorStop(1, 'rgba(28,111,176,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(mouth.x, mouth.y, r, 0, Math.PI * 2);
      ctx.fill();
      // 表面のハイライト
      ctx.strokeStyle = rgba('#ffffff', a * 0.7);
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(mouth.x, mouth.y, r * 0.7, Math.PI * 1.1, Math.PI * 1.7);
      ctx.stroke();
    }
  });

  // ---- 幕1：極太の水流本体（3層のグラデ） ----
  const LAYERS = [
    { n: 34, wMul: 1.10, aMul: 0.35, col0: '#3ca0e6', col1: '#1c6fb0', seedOff: 0 },
    { n: 28, wMul: 0.78, aMul: 0.60, col0: '#bfe8ff', col1: '#3ca0e6', seedOff: 6 },
    { n: 20, wMul: 0.42, aMul: 0.90, col0: '#ffffff', col1: '#bfe8ff', seedOff: 12 },
  ];
  LAYERS.forEach((L, li) => {
    particles.push({
      delay: HYDROPUMP_CHARGE_MS,
      maxLife: HYDROPUMP_END_MS - HYDROPUMP_CHARGE_MS,
      blend: 'lighter',
      draw(ctx, t) {
        const ms = HYDROPUMP_CHARGE_MS + t * (HYDROPUMP_END_MS - HYDROPUMP_CHARGE_MS);
        const k = beamStrength(ms);
        if (k <= 0.02) return;
        const reach = beamReach(ms);
        const time = ms / 1000;
        for (let i = 0; i < L.n; i++) {
          const kk = (i + 0.5) / L.n;
          if (kk > reach) break;
          const px = mouth.x + (to.x - mouth.x) * kk;
          const py = mouth.y + (to.y - mouth.y) * kk;
          const jit = noise1(kk * 5 + time * 7 + L.seedOff, seedA + li) * beamW * 0.16 * kk;
          const jit2 = noise1(kk * 4 + time * 8 + L.seedOff + 3, seedB + li) * beamW * 0.16 * kk;
          const x = px + nx * (jit + jit2 * 0.5);
          const y = py + ny * (jit + jit2 * 0.5);
          const taper = Math.min(1, kk * 5) * Math.max(0.4, 1 - Math.pow(kk, 3) * 0.5);
          const size = beamW * L.wMul * taper * (0.9 + Math.abs(noise1(kk * 6 + time * 10 + L.seedOff, seedA + li)) * 0.25);
          const a = k * L.aMul * (1 - kk * 0.25) * (0.85 + Math.abs(noise1(kk * 8 + time * 12, seedB + li)) * 0.25);
          const g = ctx.createRadialGradient(x, y, 0, x, y, size);
          g.addColorStop(0, rgba(L.col0, a));
          g.addColorStop(0.5, rgba(L.col1, a * 0.85));
          g.addColorStop(1, 'rgba(28,111,176,0)');
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(x, y, size, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    });
  });

  // ---- 水流に沿って流れる気泡と雫 ----
  for (let i = 0; i < 44; i++) {
    const phase = rand(0, 1);
    const side = rand(-1, 1);
    const sp = rand(0.8, 1.5);
    const sz = rand(2, 4.5) * S;
    const isBubble = i % 2 === 0;
    const seed = rand(0, 100);
    particles.push({
      delay: HYDROPUMP_CHARGE_MS,
      maxLife: HYDROPUMP_END_MS - HYDROPUMP_CHARGE_MS,
      blend: 'lighter',
      draw(ctx, t) {
        const ms = HYDROPUMP_CHARGE_MS + t * (HYDROPUMP_END_MS - HYDROPUMP_CHARGE_MS);
        const k = beamStrength(ms);
        if (k <= 0.1) return;
        const reach = beamReach(ms);
        const flow = ((ms * 0.0024 * sp + phase) % 1) * reach;
        const px = mouth.x + (to.x - mouth.x) * flow;
        const py = mouth.y + (to.y - mouth.y) * flow;
        const wob = Math.sin(flow * 16 + ms * 0.02 + seed) * beamW * 0.22 * k;
        const perp = side * beamW * 0.55 + wob;
        const x = px + nx * perp;
        const y = py + ny * perp;
        const a = k * (1 - Math.max(0, (flow - 0.85) / 0.15));
        if (isBubble) {
          // 気泡（輪郭のみ）
          ctx.strokeStyle = rgba('#ffffff', a);
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.arc(x, y, sz, 0, Math.PI * 2);
          ctx.stroke();
        } else {
          // 水滴（塗りつぶし）
          const g = ctx.createRadialGradient(x, y, 0, x, y, sz * 1.3);
          g.addColorStop(0, rgba('#ffffff', a));
          g.addColorStop(0.5, rgba('#bfe8ff', a * 0.85));
          g.addColorStop(1, 'rgba(60,160,230,0)');
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(x, y, sz * 1.3, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    });
  }

  // ---- 水流を横切る水の輪（押し寄せる波紋） ----
  for (let i = 0; i < 8; i++) {
    const phase = rand(0, 1);
    particles.push({
      delay: HYDROPUMP_CHARGE_MS,
      maxLife: HYDROPUMP_END_MS - HYDROPUMP_CHARGE_MS,
      blend: 'lighter',
      draw(ctx, t) {
        const ms = HYDROPUMP_CHARGE_MS + t * (HYDROPUMP_END_MS - HYDROPUMP_CHARGE_MS);
        const k = beamStrength(ms);
        if (k <= 0.2) return;
        const reach = beamReach(ms);
        const flow = ((ms * 0.0011 + phase) % 1) * reach;
        const px = mouth.x + (to.x - mouth.x) * flow;
        const py = mouth.y + (to.y - mouth.y) * flow;
        const a = k * 0.55;
        const rw = beamW * 1.15 * k;
        ctx.strokeStyle = rgba('#eaf8ff', a);
        ctx.lineWidth = 3.5;
        ctx.shadowColor = rgba('#bfe8ff', 0.9);
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.ellipse(px, py, rw * 0.25, rw, ang + Math.PI / 2, 0, Math.PI * 2);
        ctx.stroke();
      }
    });
  }

  // 発射口の閃光
  particles.push({
    delay: HYDROPUMP_CHARGE_MS - 20,
    maxLife: 280,
    blend: 'lighter',
    draw(ctx, t) {
      const a = (1 - t) * 0.95;
      const r = lerp(10 * S, 62 * S, easeOutQuint(t));
      const g = ctx.createRadialGradient(mouth.x, mouth.y, 0, mouth.x, mouth.y, r);
      g.addColorStop(0, rgba('#ffffff', a));
      g.addColorStop(0.4, rgba('#bfe8ff', a * 0.85));
      g.addColorStop(1, 'rgba(60,160,230,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(mouth.x, mouth.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  });

  // ---- 幕2：着弾＝大量の水しぶき ----
  // 巨大な水の輪（広がる）
  particles.push({
    delay: HYDROPUMP_HIT_MS,
    maxLife: 440,
    blend: 'lighter',
    draw(ctx, t) {
      const a = (1 - t) * 0.9;
      const r = lerp(8 * S, 84 * S, easeOutQuint(t));
      const g = ctx.createRadialGradient(to.x, to.y, 0, to.x, to.y, r);
      g.addColorStop(0, rgba('#ffffff', a));
      g.addColorStop(0.35, rgba('#bfe8ff', a * 0.9));
      g.addColorStop(0.7, rgba('#3ca0e6', a * 0.55));
      g.addColorStop(1, 'rgba(60,160,230,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(to.x, to.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  // 二重波紋リング
  for (let i = 0; i < 3; i++) {
    particles.push({
      delay: HYDROPUMP_HIT_MS + i * 45,
      maxLife: 420 - i * 40,
      blend: 'lighter',
      draw(ctx, t) {
        const r = lerp(10 * S, R * (0.16 + i * 0.06), easeOutQuint(t));
        const a = (1 - t) * (0.85 - i * 0.15);
        const col = i === 0 ? '#ffffff' : '#bfe8ff';
        ctx.strokeStyle = rgba(col, a);
        ctx.lineWidth = (7 - i * 1.6) * (1 - t * 0.5);
        ctx.shadowColor = rgba(col, 0.9);
        ctx.shadowBlur = 14;
        ctx.beginPath();
        ctx.ellipse(to.x, to.y + 8 * S, r, r * 0.75, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    });
  }
  // 放射状に飛び散る水滴（重力で落ちる）
  for (let i = 0; i < 40; i++) {
    const sa = rand(-Math.PI, Math.PI);
    const sp = rand(50, 200) * S;
    const sz = rand(3, 8) * S;
    const grav = rand(0.8, 1.8);
    const col = pick(['#ffffff', '#bfe8ff', '#7cc4f0', '#3ca0e6']);
    particles.push({
      delay: HYDROPUMP_HIT_MS + rand(0, 60),
      maxLife: rand(480, 720),
      draw(ctx, t) {
        const e = easeOutCubic(t);
        const x = to.x + Math.cos(sa) * sp * e;
        const y = to.y + Math.sin(sa) * sp * e * 0.85 + grav * t * t * h * 0.16;
        const a = 1 - Math.max(0, (t - 0.7) / 0.3);
        const g = ctx.createRadialGradient(x, y, 0, x, y, sz * 1.4);
        g.addColorStop(0, rgba('#ffffff', a));
        g.addColorStop(0.5, rgba(col, a * 0.9));
        g.addColorStop(1, 'rgba(60,160,230,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, sz * 1.4, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }
  // 細かい飛沫（拡散する霧状）
  for (let i = 0; i < 50; i++) {
    const sa = rand(0, Math.PI * 2);
    const sp = rand(80, 280) * S;
    const sz = rand(1, 2.4) * S;
    const grav = rand(1.2, 2.2);
    particles.push({
      delay: HYDROPUMP_HIT_MS + rand(0, 40),
      maxLife: rand(340, 520),
      blend: 'lighter',
      draw(ctx, t) {
        const e = easeOutCubic(t);
        const x = to.x + Math.cos(sa) * sp * e;
        const y = to.y + Math.sin(sa) * sp * e * 0.85 + grav * t * t * h * 0.2;
        const a = (1 - t) * 0.9;
        ctx.fillStyle = rgba('#eaf8ff', a);
        ctx.shadowColor = rgba('#bfe8ff', 0.8);
        ctx.shadowBlur = 6;
        ctx.beginPath();
        ctx.arc(x, y, sz, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }
  // 地面を這う水（着弾点の下に水たまりが広がる）
  particles.push({
    delay: HYDROPUMP_HIT_MS + 30,
    maxLife: 680,
    draw(ctx, t) {
      const grow = easeOutCubic(Math.min(1, t * 1.6));
      const fade = 1 - Math.max(0, (t - 0.65) / 0.35);
      const a = grow * fade * 0.7;
      if (a <= 0.01) return;
      const rx = 96 * S * grow;
      const ry = rx * 0.24;
      const cy = to.y + 22 * S;
      const g = ctx.createRadialGradient(to.x, cy, 0, to.x, cy, rx);
      g.addColorStop(0, rgba('#bfe8ff', a));
      g.addColorStop(0.4, rgba('#3ca0e6', a * 0.8));
      g.addColorStop(1, 'rgba(28,111,176,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(to.x, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
      // 表面のハイライト
      ctx.strokeStyle = rgba('#eaf8ff', a * 0.6);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(to.x, cy - ry * 0.3, rx * 0.7, ry * 0.4, 0, Math.PI, Math.PI * 2);
      ctx.stroke();
    }
  });
}

// ============================================================
// アクアボルト：電気を帯びたハイドロポンプ。水流の中を雷が走る演出
// 構成：①口元に水と電気が同時に集まる ②水の柱が伸びる
//       ③柱の中を黄色い電気が縦横に走る ④着弾で水しぶき＋電気の炸裂
//       ⑤水が地面を這い、電気の火花が弾ける余韻
// 「水＋電気」の相反する2元素の融合がキモ。青と黄色の対比。
// ============================================================
const AQUAVOLT_CHARGE_MS = 420;
const AQUAVOLT_EXTEND_MS = 140;
const AQUAVOLT_SUSTAIN_MS = 560;
const AQUAVOLT_FADE_MS = 340;
const AQUAVOLT_HIT_MS = AQUAVOLT_CHARGE_MS + AQUAVOLT_EXTEND_MS;
const AQUAVOLT_END_MS = AQUAVOLT_HIT_MS + AQUAVOLT_SUSTAIN_MS + AQUAVOLT_FADE_MS;

function spawnAquaVoltSpecial(particles, w, h, info) {
  const from = (info && info.from) || { x: w * 0.28, y: h * 0.68 };
  const to = (info && info.to) || { x: w * 0.72, y: h * 0.32 };
  const S = (info && info.scale) || 1;
  const R = Math.max(w, h);
  const dx = to.x - from.x, dy = to.y - from.y;
  const dist = Math.hypot(dx, dy) || 1;
  const ang = Math.atan2(dy, dx);
  const ux = dx / dist, uy = dy / dist;
  const nx = -uy, ny = ux;
  const mouth = { x: from.x + ux * 30 * S, y: from.y + uy * 30 * S };
  const beamW = Math.min(46 * S, 56);
  const seedA = rand(0, 100), seedB = rand(0, 100);

  function beamStrength(ms) {
    if (ms < AQUAVOLT_CHARGE_MS) return 0;
    const since = ms - AQUAVOLT_CHARGE_MS;
    if (since < AQUAVOLT_EXTEND_MS) return easeOutQuint(since / AQUAVOLT_EXTEND_MS);
    if (since < AQUAVOLT_EXTEND_MS + AQUAVOLT_SUSTAIN_MS) return 1 + Math.sin((since - AQUAVOLT_EXTEND_MS) * 0.07) * 0.06;
    const f = (since - AQUAVOLT_EXTEND_MS - AQUAVOLT_SUSTAIN_MS) / AQUAVOLT_FADE_MS;
    return Math.pow(1 - clamp01(f), 1.6);
  }
  function beamReach(ms) {
    if (ms < AQUAVOLT_CHARGE_MS) return 0;
    return easeOutQuint(clamp01((ms - AQUAVOLT_CHARGE_MS) / AQUAVOLT_EXTEND_MS));
  }

  // ---- 幕0：口元に水と電気が集まる ----
  particles.push({
    maxLife: AQUAVOLT_CHARGE_MS + 60,
    blend: 'lighter',
    draw(ctx, t) {
      const a = Math.sin(Math.PI * clamp01(t)) * 0.7;
      const r = lerp(8 * S, 46 * S, easeOutCubic(t));
      const g = ctx.createRadialGradient(mouth.x, mouth.y, 0, mouth.x, mouth.y, r);
      g.addColorStop(0, rgba('#ffffff', a));
      g.addColorStop(0.3, rgba('#bfe8ff', a * 0.85));
      g.addColorStop(0.6, rgba('#7cc4f0', a * 0.6));
      g.addColorStop(0.85, rgba('#fff59d', a * 0.4));
      g.addColorStop(1, 'rgba(255,235,59,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(mouth.x, mouth.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  // 集まる水滴
  for (let i = 0; i < 16; i++) {
    const a0 = (i / 16) * Math.PI * 2 + rand(-0.2, 0.2);
    const r0 = rand(50, 85) * S;
    const sz = rand(2.5, 5) * S;
    particles.push({
      delay: rand(0, 280),
      maxLife: rand(220, 320),
      draw(ctx, t) {
        if (t >= 1) return;
        const e = easeInCubic(t);
        const rr = lerp(r0, 4 * S, e);
        const spin = a0 + t * 3;
        const x = mouth.x + Math.cos(spin) * rr;
        const y = mouth.y + Math.sin(spin) * rr * 0.85;
        const a = clamp01(t * 4) * (1 - Math.max(0, (t - 0.85) / 0.15));
        const g = ctx.createRadialGradient(x, y, 0, x, y, sz * 1.5);
        g.addColorStop(0, rgba('#ffffff', a));
        g.addColorStop(0.5, rgba('#bfe8ff', a * 0.9));
        g.addColorStop(1, 'rgba(60,160,230,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, sz * 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }
  // 集まる電気火花（ジグザグに伸びる）
  for (let i = 0; i < 8; i++) {
    const a0 = rand(0, Math.PI * 2);
    const arcLen = rand(40, 90) * S;
    const seed = rand(0, 100);
    particles.push({
      delay: rand(0, 340),
      maxLife: 140,
      blend: 'lighter',
      draw(ctx, t) {
        const alpha = Math.sin(Math.PI * clamp01(t)) * 0.95;
        const grow = easeOutCubic(Math.min(1, t * 3));
        const ex = mouth.x + Math.cos(a0) * arcLen * grow;
        const ey = mouth.y + Math.sin(a0) * arcLen * grow;
        ctx.strokeStyle = rgba('#fff59d', alpha);
        ctx.shadowColor = rgba('#ffe74c', 1);
        ctx.shadowBlur = 12;
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.moveTo(mouth.x, mouth.y);
        const segs = 5;
        for (let s = 1; s <= segs; s++) {
          const k = s / segs;
          const px = lerp(mouth.x, ex, k) + noise1(k * 5 + t * 15, seed) * 12 * S;
          const py = lerp(mouth.y, ey, k) + noise1(k * 5 + t * 15 + 3, seed) * 12 * S;
          ctx.lineTo(px, py);
        }
        ctx.stroke();
      }
    });
  }

  // ---- 幕1：水の柱本体（ハイドロポンプと同じ構造） ----
  const LAYERS = [
    { n: 30, wMul: 1.05, aMul: 0.35, col0: '#3ca0e6', col1: '#1c6fb0', seedOff: 0 },
    { n: 24, wMul: 0.72, aMul: 0.60, col0: '#bfe8ff', col1: '#3ca0e6', seedOff: 6 },
    { n: 18, wMul: 0.38, aMul: 0.90, col0: '#ffffff', col1: '#bfe8ff', seedOff: 12 },
  ];
  LAYERS.forEach((L, li) => {
    particles.push({
      delay: AQUAVOLT_CHARGE_MS,
      maxLife: AQUAVOLT_END_MS - AQUAVOLT_CHARGE_MS,
      blend: 'lighter',
      draw(ctx, t) {
        const ms = AQUAVOLT_CHARGE_MS + t * (AQUAVOLT_END_MS - AQUAVOLT_CHARGE_MS);
        const k = beamStrength(ms);
        if (k <= 0.02) return;
        const reach = beamReach(ms);
        const time = ms / 1000;
        for (let i = 0; i < L.n; i++) {
          const kk = (i + 0.5) / L.n;
          if (kk > reach) break;
          const px = mouth.x + (to.x - mouth.x) * kk;
          const py = mouth.y + (to.y - mouth.y) * kk;
          const jit = noise1(kk * 5 + time * 7 + L.seedOff, seedA + li) * beamW * 0.16 * kk;
          const jit2 = noise1(kk * 4 + time * 8 + L.seedOff + 3, seedB + li) * beamW * 0.16 * kk;
          const x = px + nx * (jit + jit2 * 0.5);
          const y = py + ny * (jit + jit2 * 0.5);
          const taper = Math.min(1, kk * 5) * Math.max(0.4, 1 - Math.pow(kk, 3) * 0.5);
          const size = beamW * L.wMul * taper * (0.9 + Math.abs(noise1(kk * 6 + time * 10 + L.seedOff, seedA + li)) * 0.25);
          const a = k * L.aMul * (1 - kk * 0.25) * (0.85 + Math.abs(noise1(kk * 8 + time * 12, seedB + li)) * 0.25);
          const g = ctx.createRadialGradient(x, y, 0, x, y, size);
          g.addColorStop(0, rgba(L.col0, a));
          g.addColorStop(0.5, rgba(L.col1, a * 0.85));
          g.addColorStop(1, 'rgba(28,111,176,0)');
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(x, y, size, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    });
  });

  // ---- 柱の中を走る黄色い電気（アクアボルトの主役） ----
  for (let i = 0; i < 10; i++) {
    const phase = rand(0, 1);
    const flowSpeed = rand(0.9, 1.6);
    const seed = rand(0, 100);
    particles.push({
      delay: AQUAVOLT_CHARGE_MS,
      maxLife: AQUAVOLT_END_MS - AQUAVOLT_CHARGE_MS,
      blend: 'lighter',
      draw(ctx, t) {
        const ms = AQUAVOLT_CHARGE_MS + t * (AQUAVOLT_END_MS - AQUAVOLT_CHARGE_MS);
        const k = beamStrength(ms);
        if (k <= 0.15) return;
        const reach = beamReach(ms);
        const flow = ((ms * 0.0026 * flowSpeed + phase) % 1) * reach;
        // 短いジグザグを描く
        const segLen = 0.12;
        ctx.strokeStyle = rgba('#fff59d', k * 0.95);
        ctx.shadowColor = rgba('#ffe74c', 1);
        ctx.shadowBlur = 16;
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        const segs = 6;
        let started = false;
        for (let s = 0; s <= segs; s++) {
          const ff = flow - segLen + segLen * (s / segs);
          if (ff < 0) continue;
          const baseX = mouth.x + (to.x - mouth.x) * ff;
          const baseY = mouth.y + (to.y - mouth.y) * ff;
          const wob = noise1(ff * 18 + ms * 0.04 + seed, seed) * beamW * 0.7 * k;
          const px = baseX + nx * wob;
          const py = baseY + ny * wob;
          if (!started) { ctx.moveTo(px, py); started = true; }
          else ctx.lineTo(px, py);
        }
        if (started) ctx.stroke();
        // 内側の白い芯
        ctx.strokeStyle = rgba('#ffffff', k * 0.9);
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    });
  }
  // 柱の中を走る水滴（電気で加速）
  for (let i = 0; i < 30; i++) {
    const phase = rand(0, 1);
    const side = rand(-1, 1);
    const sp = rand(1.0, 1.7);
    const sz = rand(2, 4) * S;
    particles.push({
      delay: AQUAVOLT_CHARGE_MS,
      maxLife: AQUAVOLT_END_MS - AQUAVOLT_CHARGE_MS,
      blend: 'lighter',
      draw(ctx, t) {
        const ms = AQUAVOLT_CHARGE_MS + t * (AQUAVOLT_END_MS - AQUAVOLT_CHARGE_MS);
        const k = beamStrength(ms);
        if (k <= 0.1) return;
        const reach = beamReach(ms);
        const flow = ((ms * 0.0030 * sp + phase) % 1) * reach;
        const px = mouth.x + (to.x - mouth.x) * flow;
        const py = mouth.y + (to.y - mouth.y) * flow;
        const wob = Math.sin(flow * 20 + ms * 0.03 + side) * beamW * 0.2 * k;
        const perp = side * beamW * 0.55 + wob;
        const x = px + nx * perp;
        const y = py + ny * perp;
        const a = k * (1 - Math.max(0, (flow - 0.85) / 0.15));
        ctx.fillStyle = rgba('#eaf8ff', a);
        ctx.shadowColor = rgba('#bfe8ff', 0.9);
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(x, y, sz, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }

  // 発射口の閃光（青＋黄）
  particles.push({
    delay: AQUAVOLT_CHARGE_MS - 20,
    maxLife: 300,
    blend: 'lighter',
    draw(ctx, t) {
      const a = (1 - t) * 0.95;
      const r = lerp(10 * S, 66 * S, easeOutQuint(t));
      const g = ctx.createRadialGradient(mouth.x, mouth.y, 0, mouth.x, mouth.y, r);
      g.addColorStop(0, rgba('#ffffff', a));
      g.addColorStop(0.35, rgba('#bfe8ff', a * 0.85));
      g.addColorStop(0.7, rgba('#fff59d', a * 0.6));
      g.addColorStop(1, 'rgba(255,235,59,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(mouth.x, mouth.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  });

  // ---- 幕2：着弾＝水しぶき＋電気の炸裂 ----
  particles.push({
    delay: AQUAVOLT_HIT_MS,
    maxLife: 440,
    blend: 'lighter',
    draw(ctx, t) {
      const a = (1 - t) * 0.92;
      const r = lerp(8 * S, 86 * S, easeOutQuint(t));
      const g = ctx.createRadialGradient(to.x, to.y, 0, to.x, to.y, r);
      g.addColorStop(0, rgba('#ffffff', a));
      g.addColorStop(0.3, rgba('#bfe8ff', a * 0.85));
      g.addColorStop(0.6, rgba('#fff59d', a * 0.6));
      g.addColorStop(1, 'rgba(255,235,59,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(to.x, to.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  // 電気の衝撃波（ジグザグ）／水の輪 の二重
  for (let i = 0; i < 4; i++) {
    const isElec = i % 2 === 0;
    const col = isElec ? '#fff59d' : '#bfe8ff';
    particles.push({
      delay: AQUAVOLT_HIT_MS + i * 40,
      maxLife: 420 - i * 30,
      blend: 'lighter',
      draw(ctx, t) {
        const r = lerp(10 * S, R * (0.16 + i * 0.05), easeOutQuint(t));
        const a = (1 - t) * (0.85 - i * 0.15);
        ctx.strokeStyle = rgba(col, a);
        ctx.lineWidth = (6 - i * 1.2) * (1 - t * 0.5);
        ctx.shadowColor = rgba(col, 0.9);
        ctx.shadowBlur = 14;
        if (isElec) {
          // ジグザグ波紋
          ctx.beginPath();
          const segs = 40;
          for (let s = 0; s <= segs; s++) {
            const aa = (s / segs) * Math.PI * 2;
            const jitter = noise1(aa * 6 + t * 10, i) * r * 0.15;
            const rr = r + jitter;
            const px = to.x + Math.cos(aa) * rr;
            const py = to.y + Math.sin(aa) * rr;
            if (s === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
          }
          ctx.closePath();
          ctx.stroke();
        } else {
          ctx.beginPath();
          ctx.ellipse(to.x, to.y + 8 * S, r, r * 0.75, 0, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    });
  }
  // 放射状の水の飛沫
  for (let i = 0; i < 34; i++) {
    const sa = rand(-Math.PI, Math.PI);
    const sp = rand(50, 190) * S;
    const sz = rand(3, 7) * S;
    const grav = rand(0.8, 1.8);
    const col = pick(['#ffffff', '#bfe8ff', '#7cc4f0']);
    particles.push({
      delay: AQUAVOLT_HIT_MS + rand(0, 60),
      maxLife: rand(460, 680),
      draw(ctx, t) {
        const e = easeOutCubic(t);
        const x = to.x + Math.cos(sa) * sp * e;
        const y = to.y + Math.sin(sa) * sp * e * 0.85 + grav * t * t * h * 0.15;
        const a = 1 - Math.max(0, (t - 0.7) / 0.3);
        const g = ctx.createRadialGradient(x, y, 0, x, y, sz * 1.4);
        g.addColorStop(0, rgba('#ffffff', a));
        g.addColorStop(0.5, rgba(col, a * 0.9));
        g.addColorStop(1, 'rgba(60,160,230,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, sz * 1.4, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }
  // 放射状に飛び散る電気火花（ギザギザの短い線）
  for (let i = 0; i < 22; i++) {
    const sa = rand(-Math.PI, Math.PI);
    const sp = rand(60, 220) * S;
    const len = rand(14, 30) * S;
    const seed = rand(0, 100);
    particles.push({
      delay: AQUAVOLT_HIT_MS + rand(0, 80),
      maxLife: rand(300, 480),
      blend: 'lighter',
      draw(ctx, t) {
        const e = easeOutCubic(t);
        const x0 = to.x + Math.cos(sa) * sp * e;
        const y0 = to.y + Math.sin(sa) * sp * e;
        const x1 = x0 + Math.cos(sa) * len;
        const y1 = y0 + Math.sin(sa) * len;
        const a = (1 - t) * 0.9;
        ctx.strokeStyle = rgba('#fff59d', a);
        ctx.shadowColor = rgba('#ffe74c', 1);
        ctx.shadowBlur = 10;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        const segs = 4;
        for (let s = 1; s <= segs; s++) {
          const k = s / segs;
          const px = lerp(x0, x1, k) + noise1(k * 5 + t * 12, seed) * 5 * S;
          const py = lerp(y0, y1, k) + noise1(k * 5 + t * 12 + 3, seed) * 5 * S;
          ctx.lineTo(px, py);
        }
        ctx.stroke();
      }
    });
  }
  // 地面の水（這う）
  particles.push({
    delay: AQUAVOLT_HIT_MS + 30,
    maxLife: 680,
    draw(ctx, t) {
      const grow = easeOutCubic(Math.min(1, t * 1.6));
      const fade = 1 - Math.max(0, (t - 0.65) / 0.35);
      const a = grow * fade * 0.65;
      if (a <= 0.01) return;
      const rx = 90 * S * grow;
      const ry = rx * 0.24;
      const cy = to.y + 22 * S;
      const g = ctx.createRadialGradient(to.x, cy, 0, to.x, cy, rx);
      g.addColorStop(0, rgba('#bfe8ff', a));
      g.addColorStop(0.4, rgba('#3ca0e6', a * 0.75));
      g.addColorStop(1, 'rgba(28,111,176,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(to.x, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  // 地面を這う電気火花（水たまりの中でバチバチ）
  for (let i = 0; i < 14; i++) {
    const x0 = to.x + rand(-70, 70) * S;
    const seed = rand(0, 100);
    particles.push({
      delay: AQUAVOLT_HIT_MS + 100 + rand(0, 300),
      maxLife: 140,
      blend: 'lighter',
      draw(ctx, t) {
        const alpha = Math.sin(Math.PI * clamp01(t)) * 0.9;
        const y0 = to.y + 20 * S;
        const len = rand(20, 40) * S;
        const dir = rand(-1, 1) > 0 ? 1 : -1;
        ctx.strokeStyle = rgba('#fff59d', alpha);
        ctx.shadowColor = rgba('#ffe74c', 1);
        ctx.shadowBlur = 8;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        const segs = 4;
        for (let s = 1; s <= segs; s++) {
          const k = s / segs;
          const px = x0 + dir * len * k;
          const py = y0 + noise1(k * 5 + t * 15, seed) * 6 * S;
          ctx.lineTo(px, py);
        }
        ctx.stroke();
      }
    });
  }
}

// ============================================================
// なみのり：巨大な波が左右から押し寄せ、相手を飲み込んで砕ける演出（原作準拠）
// 構成：①画面下部に水面が盛り上がる ②巨大な波が左（攻撃側の背後）から立ち上がる
//       ③波が前方に傾き、頂点がせり上がる ④相手の位置で波が砕けてしぶきが舞う
//       ⑤水が引き、泡と水たまりが残る
// 「大きな波の輪郭（カーブした頂点）」「手前と奥の2層の波」「砕けた泡」がキモ。
// ============================================================
const SURF_CHARGE_MS = 400;   // 海面が出現
const SURF_RISE_MS   = 450;   // 波が立ち上がる
const SURF_SURGE_MS  = 550;   // 波が相手へ押し寄せる
const SURF_CRASH_MS  = 350;   // 波が砕ける
const SURF_RECEDE_MS = 450;   // 水が引く
// 波が相手に到達する瞬間（＝ダメージの瞬間）
const SURF_HIT_MS = SURF_CHARGE_MS + SURF_RISE_MS + SURF_SURGE_MS;
const SURF_END_MS = SURF_HIT_MS + SURF_CRASH_MS + SURF_RECEDE_MS;

function spawnSurfSpecial(particles, w, h, info) {
  const from = (info && info.from) || { x: w * 0.28, y: h * 0.68 };
  const to   = (info && info.to)   || { x: w * 0.72, y: h * 0.32 };
  const S = (info && info.scale) || 1;
  const R = Math.max(w, h);
  const TOTAL = SURF_END_MS;

  // 海面の基準線（画面下部寄り、相手の少し下）
  const baseY = Math.min(h * 0.95, to.y + 110 * S);
  // 波の最大高さ（画面のほとんどを覆う）
  const MAX_WAVE_H = h * 0.92;
  // 波の横幅（画面幅より少し広く）
  const WAVE_W = w * 1.2;

  // 波の頂点X（時刻から算出）
  function getCrestX(ms) {
    if (ms < SURF_CHARGE_MS + SURF_RISE_MS) return from.x;
    if (ms < SURF_HIT_MS) {
      const p = (ms - SURF_CHARGE_MS - SURF_RISE_MS) / SURF_SURGE_MS;
      return lerp(from.x, to.x + w * 0.15, easeInOutSine(p));
    }
    return to.x + w * 0.15;
  }

  // 波の高さ（時刻から算出）
  function getWaveH(ms) {
    if (ms < SURF_CHARGE_MS) return 0;
    if (ms < SURF_CHARGE_MS + SURF_RISE_MS) {
      const p = (ms - SURF_CHARGE_MS) / SURF_RISE_MS;
      return MAX_WAVE_H * easeOutCubic(p);
    }
    if (ms < SURF_HIT_MS) return MAX_WAVE_H;
    if (ms < SURF_END_MS - SURF_RECEDE_MS) {
      const p = (ms - SURF_HIT_MS) / SURF_CRASH_MS;
      return MAX_WAVE_H * (1 - p * 0.55);
    }
    const p = (ms - (SURF_END_MS - SURF_RECEDE_MS)) / SURF_RECEDE_MS;
    return MAX_WAVE_H * 0.45 * (1 - p);
  }

  // 波の透明度（時刻から算出）
  function getWaveAlpha(ms) {
    if (ms < SURF_CHARGE_MS) return 0;
    if (ms < SURF_END_MS - SURF_RECEDE_MS) return 1;
    const p = (ms - (SURF_END_MS - SURF_RECEDE_MS)) / SURF_RECEDE_MS;
    return Math.max(0, 1 - p * 1.2);
  }

  // 波の本体（ベジェで一枚の水の壁を描く）
  function drawWaveBody(ctx, crestX, crestH, alpha, isFront) {
    const crestY = baseY - crestH;
    const halfW = WAVE_W / 2;
    const leftX = crestX - halfW;
    const rightX = crestX + halfW;

    ctx.beginPath();
    ctx.moveTo(leftX, baseY);
    // 左側：ゆるやかに立ち上がる背面
    ctx.bezierCurveTo(
      leftX + halfW * 0.25, baseY - crestH * 0.4,
      crestX - halfW * 0.45, crestY + crestH * 0.08,
      crestX - halfW * 0.10, crestY
    );
    // 波頭の砕けた先端
    ctx.bezierCurveTo(
      crestX - halfW * 0.03, crestY - crestH * 0.05,
      crestX + halfW * 0.05, crestY + crestH * 0.02,
      crestX + halfW * 0.18, crestY + crestH * 0.12
    );
    // 右側：砕けて落ちる前面
    ctx.bezierCurveTo(
      crestX + halfW * 0.5, crestY + crestH * 0.6,
      rightX - halfW * 0.15, baseY - crestH * 0.10,
      rightX, baseY
    );
    ctx.closePath();

    const grad = ctx.createLinearGradient(0, crestY, 0, baseY);
    if (isFront) {
      grad.addColorStop(0,    rgba('#ffffff', alpha));
      grad.addColorStop(0.18, rgba('#eaf8ff', alpha * 0.95));
      grad.addColorStop(0.55, rgba('#7cc4f0', alpha * 0.92));
      grad.addColorStop(0.85, rgba('#3ca0e6', alpha * 0.9));
      grad.addColorStop(1,    rgba('#1c6fb0', alpha * 0.92));
    } else {
      grad.addColorStop(0,   rgba('#bfe8ff', alpha * 0.65));
      grad.addColorStop(0.5, rgba('#7cc4f0', alpha * 0.55));
      grad.addColorStop(1,   rgba('#1c6fb0', alpha * 0.6));
    }
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.strokeStyle = rgba('#ffffff', alpha * (isFront ? 1 : 0.6));
    ctx.lineWidth = isFront ? 3.5 : 2;
    ctx.stroke();
  }

  // 波頭に沿って白い泡をまぶす
  function drawCrestFoam(ctx, crestX, crestH, alpha) {
    const crestY = baseY - crestH;
    const halfW = WAVE_W / 2;
    for (let i = 0; i < 30; i++) {
      const k = i / 29;
      const px = crestX - halfW * 0.45 + k * halfW * 0.65;
      const t2 = Math.sin(Math.PI * k * 0.95);
      const py = crestY + (1 - t2) * crestH * 0.5;
      const r = 3 + Math.abs(noise1(i * 1.7, 42)) * 8;
      const a = alpha * (0.55 + Math.abs(noise1(i * 2.3, 7)) * 0.45);
      const g = ctx.createRadialGradient(px, py, 0, px, py, r);
      g.addColorStop(0,   rgba('#ffffff', a));
      g.addColorStop(0.6, rgba('#eaf8ff', a * 0.7));
      g.addColorStop(1,   'rgba(234,248,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ============ 幕0: 海面が画面下部に出現 ============
  particles.push({
    maxLife: TOTAL,
    draw(ctx, t) {
      const ms = t * TOTAL;
      let a, waterTop;
      if (ms < SURF_CHARGE_MS) {
        const p = ms / SURF_CHARGE_MS;
        a = easeOutCubic(p) * 0.7;
        waterTop = baseY - h * 0.08 * p;
      } else if (ms < SURF_END_MS - SURF_RECEDE_MS) {
        a = 0.7;
        waterTop = baseY - h * 0.08;
      } else {
        const p = (ms - (SURF_END_MS - SURF_RECEDE_MS)) / SURF_RECEDE_MS;
        a = 0.7 * (1 - p);
        waterTop = baseY - h * 0.08 * (1 - p * 0.5);
      }
      if (a <= 0.01) return;
      const g = ctx.createLinearGradient(0, waterTop, 0, h);
      g.addColorStop(0,   rgba('#eaf8ff', a * 0.5));
      g.addColorStop(0.4, rgba('#7cc4f0', a * 0.6));
      g.addColorStop(1,   rgba('#1c6fb0', a * 0.85));
      ctx.fillStyle = g;
      ctx.fillRect(0, waterTop, w, h - waterTop);
    }
  });

  // ============ 幕1-4: 巨大な波本体 ============
  // 奥の波（背面・少し霞む）
  particles.push({
    maxLife: TOTAL,
    draw(ctx, t) {
      const ms = t * TOTAL;
      const waveH = getWaveH(ms) * 0.85;
      const alpha = getWaveAlpha(ms) * 0.6;
      if (waveH <= 4 || alpha <= 0.02) return;
      const crestX = getCrestX(ms) + w * 0.06;
      drawWaveBody(ctx, crestX, waveH, alpha, false);
    }
  });
  // 手前の波（メイン）
  particles.push({
    maxLife: TOTAL,
    draw(ctx, t) {
      const ms = t * TOTAL;
      const waveH = getWaveH(ms);
      const alpha = getWaveAlpha(ms);
      if (waveH <= 4 || alpha <= 0.02) return;
      const crestX = getCrestX(ms);
      drawWaveBody(ctx, crestX, waveH, alpha, true);
      if (ms > SURF_CHARGE_MS + SURF_RISE_MS * 0.5) {
        drawCrestFoam(ctx, crestX, waveH, alpha);
      }
    }
  });

  // ============ 攻撃側の足元：波が盛り上がる気配（波に乗る演出） ============
  particles.push({
    maxLife: SURF_CHARGE_MS + SURF_RISE_MS,
    blend: 'lighter',
    draw(ctx, t) {
      const p = clamp01(t);
      const a = Math.sin(Math.PI * p) * 0.55;
      if (a <= 0.01) return;
      const r = lerp(15 * S, 100 * S, easeOutCubic(p));
      const g = ctx.createRadialGradient(from.x, from.y, 0, from.x, from.y, r);
      g.addColorStop(0,   rgba('#ffffff', a));
      g.addColorStop(0.5, rgba('#7cc4f0', a * 0.55));
      g.addColorStop(1,   'rgba(60,160,230,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(from.x, from.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  });

  // ============ 波頭から飛び散る水滴（波の進行中） ============
  for (let i = 0; i < 50; i++) {
    const startAt = SURF_CHARGE_MS + SURF_RISE_MS * 0.6 + rand(0, SURF_SURGE_MS + 100);
    const lateral = rand(-0.5, 0.5);
    const size = rand(2, 5) * S;
    const speed = rand(0.75, 1.15);
    const seed = rand(0, 100);
    particles.push({
      delay: startAt,
      maxLife: rand(380, 580),
      blend: 'lighter',
      draw(ctx, t) {
        if (t >= 1) return;
        const e = easeOutCubic(t);
        const px = lerp(from.x, to.x + w * 0.15, e * speed);
        const crestY = baseY - MAX_WAVE_H * (1 - Math.pow(e, 1.6));
        const py = crestY + lateral * 100 * S + Math.sin(t * 9 + seed) * 18;
        const a = clamp01(t * 5) * (1 - Math.max(0, (t - 0.7) / 0.3));
        const sz = size * (1 - t * 0.3);
        ctx.fillStyle = rgba('#ffffff', a * 0.9);
        ctx.shadowColor = rgba('#bfe8ff', 0.9);
        ctx.shadowBlur = 6;
        ctx.beginPath();
        ctx.arc(px, py, sz, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }

  // ============ 幕3: 波が相手を飲み込む瞬間の爆発 ============
  particles.push({
    delay: SURF_HIT_MS - 60,
    maxLife: 420,
    blend: 'lighter',
    draw(ctx, t) {
      const a = (1 - t) * 0.9;
      const r = lerp(20 * S, R * 0.42, easeOutQuint(t));
      const g = ctx.createRadialGradient(to.x, to.y, 0, to.x, to.y, r);
      g.addColorStop(0,    rgba('#ffffff', a));
      g.addColorStop(0.35, rgba('#eaf8ff', a * 0.9));
      g.addColorStop(0.7,  rgba('#7cc4f0', a * 0.55));
      g.addColorStop(1,    'rgba(60,160,230,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(to.x, to.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  });

  // 衝撃波リング
  for (let i = 0; i < 3; i++) {
    particles.push({
      delay: SURF_HIT_MS + i * 55,
      maxLife: 480 - i * 60,
      blend: 'lighter',
      draw(ctx, t) {
        const r = lerp(15 * S, R * (0.22 + i * 0.08), easeOutQuint(t));
        const a = (1 - t) * (0.85 - i * 0.15);
        const col = i === 0 ? '#ffffff' : (i === 1 ? '#eaf8ff' : '#bfe8ff');
        ctx.strokeStyle = rgba(col, a);
        ctx.lineWidth = (7 - i * 1.5) * (1 - t * 0.5);
        ctx.shadowColor = rgba(col, 0.9);
        ctx.shadowBlur = 16;
        ctx.beginPath();
        ctx.ellipse(to.x, to.y + 10 * S, r, r * 0.8, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    });
  }

  // 放射状に飛び散る水しぶき（大粒）
  for (let i = 0; i < 52; i++) {
    const sa = rand(-Math.PI * 0.95, 0.05);
    const sp = rand(100, 330) * S;
    const sz = rand(3, 8) * S;
    const grav = rand(0.9, 1.7);
    const col = pick(['#ffffff', '#eaf8ff', '#bfe8ff', '#7cc4f0']);
    particles.push({
      delay: SURF_HIT_MS + rand(0, 90),
      maxLife: rand(560, 820),
      draw(ctx, t) {
        const e = easeOutCubic(t);
        const x = to.x + Math.cos(sa) * sp * e;
        const y = to.y + Math.sin(sa) * sp * e + grav * t * t * h * 0.55;
        const a = 1 - Math.max(0, (t - 0.7) / 0.3);
        const g = ctx.createRadialGradient(x, y, 0, x, y, sz * 1.6);
        g.addColorStop(0,   rgba('#ffffff', a));
        g.addColorStop(0.5, rgba(col, a * 0.9));
        g.addColorStop(1,   'rgba(60,160,230,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, sz * 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }

  // 舞い上がる白泡の塊
  for (let i = 0; i < 30; i++) {
    const sa = rand(-Math.PI * 0.9, -Math.PI * 0.1);
    const sp = rand(70, 250) * S;
    const sz = rand(6, 15) * S;
    const grav = rand(0.7, 1.5);
    particles.push({
      delay: SURF_HIT_MS + rand(0, 130),
      maxLife: rand(620, 880),
      draw(ctx, t) {
        const e = easeOutCubic(t);
        const x = to.x + Math.cos(sa) * sp * e;
        const y = to.y + Math.sin(sa) * sp * e + grav * t * t * h * 0.5;
        const a = (1 - t) * 0.85;
        const g = ctx.createRadialGradient(x, y, 0, x, y, sz * 1.4);
        g.addColorStop(0,   rgba('#ffffff', a));
        g.addColorStop(0.5, rgba('#eaf8ff', a * 0.7));
        g.addColorStop(1,   'rgba(191,232,255,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, sz * 1.4, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }

  // 細かい霧状の飛沫
  for (let i = 0; i < 60; i++) {
    const sa = rand(-Math.PI, 0);
    const sp = rand(80, 300) * S;
    const sz = rand(1.2, 2.8) * S;
    const grav = rand(1.1, 2.0);
    particles.push({
      delay: SURF_HIT_MS + rand(0, 110),
      maxLife: rand(460, 660),
      blend: 'lighter',
      draw(ctx, t) {
        const e = easeOutCubic(t);
        const x = to.x + Math.cos(sa) * sp * e;
        const y = to.y + Math.sin(sa) * sp * e + grav * t * t * h * 0.55;
        const a = (1 - t) * 0.9;
        ctx.fillStyle = rgba('#eaf8ff', a);
        ctx.shadowColor = rgba('#bfe8ff', 0.7);
        ctx.shadowBlur = 5;
        ctx.beginPath();
        ctx.arc(x, y, sz, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }
}

// ============================================================
// はかいこうせん：極太の破壊光線で対象を"貫き砕く"演出
// 構成：①空気が歪み、白熱球が収束し、周囲に電気アークが走る（チャージ）
//       ②極太のソリッドビームが一瞬で伸び、相手を貫通して向こう側まで突き抜ける
//       ③ビーム内を高エネルギー火花が流れ、周囲に稲妻が絡みつく
//       ④着弾：白飛びと共に硬いシャードが放射状に飛散、地面に亀裂、二次爆発、黒煙
// 「硬いソリッドな光線」「白〜金〜黄の階調」「貫通→破壊」がキモ。
// ============================================================
const HYPERBEAM_CHARGE_MS = 700;   // タメ
const HYPERBEAM_EXTEND_MS = 90;    // 一瞬で伸びる（レーザー感）
const HYPERBEAM_SUSTAIN_MS = 540;  // 撃ち続ける
const HYPERBEAM_FADE_MS = 420;     // 消える
const HYPERBEAM_HIT_MS = HYPERBEAM_CHARGE_MS + HYPERBEAM_EXTEND_MS;
const HYPERBEAM_END_MS = HYPERBEAM_HIT_MS + HYPERBEAM_SUSTAIN_MS + HYPERBEAM_FADE_MS;

function spawnHyperBeamSpecial(particles, w, h, info) {
  const from = (info && info.from) || { x: w * 0.28, y: h * 0.68 };
  const to = (info && info.to) || { x: w * 0.72, y: h * 0.32 };
  const S = (info && info.scale) || 1;
  const R = Math.max(w, h);
  const dx = to.x - from.x, dy = to.y - from.y;
  const dist = Math.hypot(dx, dy) || 1;
  const ang = Math.atan2(dy, dx);
  const ux = dx / dist, uy = dy / dist;
  const nx = -uy, ny = ux;
  const muzzle = { x: from.x + ux * 28 * S, y: from.y + uy * 28 * S };
  // ビームは相手を"貫く"ように、相手を超えた位置まで伸びる
  const overshoot = 0.32;
  const beamTotalLen = dist * (1 + overshoot);
  const beamW = Math.min(54 * S, 66);
  const seedA = rand(0, 100);

  function beamStrength(ms) {
    if (ms < HYPERBEAM_CHARGE_MS) return 0;
    const since = ms - HYPERBEAM_CHARGE_MS;
    if (since < HYPERBEAM_EXTEND_MS) return easeOutQuint(since / HYPERBEAM_EXTEND_MS);
    if (since < HYPERBEAM_EXTEND_MS + HYPERBEAM_SUSTAIN_MS) return 1 + Math.sin((since - HYPERBEAM_EXTEND_MS) * 0.08) * 0.05;
    const f = (since - HYPERBEAM_EXTEND_MS - HYPERBEAM_SUSTAIN_MS) / HYPERBEAM_FADE_MS;
    return Math.pow(1 - clamp01(f), 1.6);
  }
  function beamReach(ms) {
    if (ms < HYPERBEAM_CHARGE_MS) return 0;
    return easeOutQuint(clamp01((ms - HYPERBEAM_CHARGE_MS) / HYPERBEAM_EXTEND_MS));
  }

  // ---- 幕0：チャージ ----
  // 画面が少し暗くなる（タメ）
  particles.push({
    maxLife: HYPERBEAM_CHARGE_MS + 40,
    draw(ctx, t) {
      const env = t < 0.6 ? (t / 0.6) * 0.35 : 0.35 * (1 - (t - 0.6) / 0.4);
      ctx.fillStyle = `rgba(8,4,24,${env})`;
      ctx.fillRect(0, 0, w, h);
    }
  });
  // 中心の白熱球（ノイズで脈動）
  particles.push({
    maxLife: HYPERBEAM_CHARGE_MS + 80,
    blend: 'lighter',
    draw(ctx, t) {
      const env = clamp01(t * 2.5);
      const pulse = 0.85 + Math.abs(noise1(t * 12, seedA)) * 0.3;
      const r = lerp(6 * S, 46 * S, easeOutCubic(t)) * pulse;
      const g = ctx.createRadialGradient(muzzle.x, muzzle.y, 0, muzzle.x, muzzle.y, r);
      g.addColorStop(0, rgba('#ffffff', env));
      g.addColorStop(0.3, rgba('#fff8d0', env * 0.95));
      g.addColorStop(0.65, rgba('#ffd24a', env * 0.55));
      g.addColorStop(1, 'rgba(255,180,40,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(muzzle.x, muzzle.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  // 口元に走る小さな電気アーク（チャージ中）
  for (let i = 0; i < 14; i++) {
    const a0 = rand(0, Math.PI * 2);
    const arcLen = rand(20, 42) * S;
    const seed = rand(0, 100);
    particles.push({
      delay: rand(0, 560),
      maxLife: 130,
      blend: 'lighter',
      draw(ctx, t) {
        const alpha = Math.sin(Math.PI * clamp01(t)) * 0.9;
        const grow = easeOutCubic(Math.min(1, t * 3));
        const x1 = muzzle.x + Math.cos(a0) * arcLen * grow;
        const y1 = muzzle.y + Math.sin(a0) * arcLen * grow;
        ctx.strokeStyle = rgba('#ffffff', alpha);
        ctx.shadowColor = rgba('#fff2a8', 1);
        ctx.shadowBlur = 10;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(muzzle.x, muzzle.y);
        const segs = 4;
        for (let s = 1; s <= segs; s++) {
          const k = s / segs;
          const px = lerp(muzzle.x, x1, k) + noise1(k * 6 + t * 14, seed) * 8 * S;
          const py = lerp(muzzle.y, y1, k) + noise1(k * 6 + t * 14 + 3, seed) * 8 * S;
          ctx.lineTo(px, py);
        }
        ctx.stroke();
      }
    });
  }
  // 高速で吸い込まれる光の粒
  for (let i = 0; i < 30; i++) {
    const a0 = (i / 30) * Math.PI * 2 + rand(-0.2, 0.2);
    const r0 = rand(60, 115) * S;
    const sz = rand(1.6, 3.2) * S;
    const sp = rand(0.6, 1.4);
    particles.push({
      delay: rand(0, 540),
      maxLife: rand(160, 260),
      blend: 'lighter',
      draw(ctx, t) {
        if (t >= 1) return;
        const e = easeInCubic(t);
        const rr = lerp(r0, 2 * S, e * sp);
        const spin = a0 + t * 4;
        const x = muzzle.x + Math.cos(spin) * rr;
        const y = muzzle.y + Math.sin(spin) * rr * 0.85;
        const a = clamp01(t * 5) * (1 - Math.max(0, (t - 0.85) / 0.15));
        ctx.fillStyle = rgba('#fff5c0', a);
        ctx.shadowColor = rgba('#ffd24a', 1);
        ctx.shadowBlur = 9;
        ctx.beginPath();
        ctx.arc(x, y, sz, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }
  // 空気の歪み（マズルから広がる波紋）
  for (let i = 0; i < 4; i++) {
    particles.push({
      delay: 200 + i * 130,
      maxLife: 520,
      draw(ctx, t) {
        const r = lerp(6 * S, 95 * S, easeOutQuint(t));
        const a = (1 - t) * 0.22;
        ctx.strokeStyle = rgba('#e0e8ff', a);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.ellipse(muzzle.x, muzzle.y, r, r * 0.85, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    });
  }

  // ---- 幕1：極太ビーム本体（ハードエッジのソリッド形状） ----
  particles.push({
    delay: HYPERBEAM_CHARGE_MS,
    maxLife: HYPERBEAM_END_MS - HYPERBEAM_CHARGE_MS,
    blend: 'lighter',
    draw(ctx, t) {
      const ms = HYPERBEAM_CHARGE_MS + t * (HYPERBEAM_END_MS - HYPERBEAM_CHARGE_MS);
      const k = beamStrength(ms);
      if (k <= 0.02) return;
      const reach = beamReach(ms);
      const len = beamTotalLen * reach;
      ctx.save();
      ctx.translate(muzzle.x, muzzle.y);
      ctx.rotate(ang);
      const wM = beamW * k;
      const wE = beamW * 0.86 * k;
      // 最外殻：淡い金のオーラ（柔らかい）
      const g1 = ctx.createLinearGradient(0, -wM * 1.9, 0, wM * 1.9);
      g1.addColorStop(0, 'rgba(255,200,60,0)');
      g1.addColorStop(0.35, `rgba(255,220,120,${0.5 * k})`);
      g1.addColorStop(0.5, `rgba(255,245,200,${0.95 * k})`);
      g1.addColorStop(0.65, `rgba(255,220,120,${0.5 * k})`);
      g1.addColorStop(1, 'rgba(255,200,60,0)');
      ctx.fillStyle = g1;
      ctx.beginPath();
      ctx.moveTo(0, -wM * 1.9);
      ctx.lineTo(len, -wE * 1.9);
      ctx.lineTo(len, wE * 1.9);
      ctx.lineTo(0, wM * 1.9);
      ctx.closePath();
      ctx.fill();
      // 中間層：硬い黄色帯
      const g2 = ctx.createLinearGradient(0, -wM, 0, wM);
      g2.addColorStop(0, 'rgba(255,170,30,0)');
      g2.addColorStop(0.18, `rgba(255,200,60,${0.9 * k})`);
      g2.addColorStop(0.5, `rgba(255,240,180,${k})`);
      g2.addColorStop(0.82, `rgba(255,200,60,${0.9 * k})`);
      g2.addColorStop(1, 'rgba(255,170,30,0)');
      ctx.fillStyle = g2;
      ctx.beginPath();
      ctx.moveTo(0, -wM);
      ctx.lineTo(len, -wE);
      ctx.lineTo(len, wE);
      ctx.lineTo(0, wM);
      ctx.closePath();
      ctx.fill();
      // 芯：白熱の硬い帯
      const g3 = ctx.createLinearGradient(0, -wM * 0.38, 0, wM * 0.38);
      g3.addColorStop(0, 'rgba(255,255,255,0)');
      g3.addColorStop(0.5, `rgba(255,255,255,${k})`);
      g3.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g3;
      ctx.beginPath();
      ctx.moveTo(0, -wM * 0.38);
      ctx.lineTo(len, -wE * 0.38);
      ctx.lineTo(len, wE * 0.38);
      ctx.lineTo(0, wM * 0.38);
      ctx.closePath();
      ctx.fill();
      // 中心線（極細の白）
      ctx.strokeStyle = `rgba(255,255,255,${k})`;
      ctx.lineWidth = Math.max(1, 1.5 * S);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(len, 0);
      ctx.stroke();
      // ビーム先端のエネルギー球
      if (reach > 0.95) {
        const tipA = (reach - 0.95) / 0.05;
        const tipR = beamW * 0.95 * k * tipA;
        const tg = ctx.createRadialGradient(len, 0, 0, len, 0, tipR);
        tg.addColorStop(0, `rgba(255,255,255,${k})`);
        tg.addColorStop(0.4, `rgba(255,240,180,${0.9 * k})`);
        tg.addColorStop(1, 'rgba(255,200,60,0)');
        ctx.fillStyle = tg;
        ctx.beginPath();
        ctx.arc(len, 0, tipR, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  });
  // ビームに沿って走る高エネルギー火花
  for (let i = 0; i < 36; i++) {
    const phase = rand(0, 1);
    const side = rand(-1, 1);
    const sp = rand(0.9, 1.6);
    const sz = rand(1.8, 3.6) * S;
    const seed = rand(0, 100);
    particles.push({
      delay: HYPERBEAM_CHARGE_MS,
      maxLife: HYPERBEAM_END_MS - HYPERBEAM_CHARGE_MS,
      blend: 'lighter',
      draw(ctx, t) {
        const ms = HYPERBEAM_CHARGE_MS + t * (HYPERBEAM_END_MS - HYPERBEAM_CHARGE_MS);
        const k = beamStrength(ms);
        if (k <= 0.15) return;
        const reach = beamReach(ms);
        const flow = ((ms * 0.0032 * sp + phase) % 1) * reach;
        const wob = Math.sin(flow * 22 + ms * 0.03 + seed) * beamW * 0.25 * k;
        const px = muzzle.x + ux * (beamTotalLen * flow);
        const py = muzzle.y + uy * (beamTotalLen * flow);
        const x = px + nx * (side * beamW * 0.55 + wob);
        const y = py + ny * (side * beamW * 0.55 + wob);
        const a = k * (1 - Math.max(0, (flow - 0.85) / 0.15));
        ctx.fillStyle = rgba('#ffffff', a);
        ctx.shadowColor = rgba('#fff2a8', 1);
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.arc(x, y, sz, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }
  // ビームに絡みつく走査稲妻（ビーム軸に沿って走る）
  for (let i = 0; i < 6; i++) {
    const phase = rand(0, 1);
    const seed = rand(0, 100);
    particles.push({
      delay: HYPERBEAM_CHARGE_MS,
      maxLife: HYPERBEAM_END_MS - HYPERBEAM_CHARGE_MS,
      blend: 'lighter',
      draw(ctx, t) {
        const ms = HYPERBEAM_CHARGE_MS + t * (HYPERBEAM_END_MS - HYPERBEAM_CHARGE_MS);
        const k = beamStrength(ms);
        if (k <= 0.2) return;
        const reach = beamReach(ms);
        const flow = ((ms * 0.0016 + phase) % 1) * reach;
        const segLen = 0.18;
        const segs = 6;
        ctx.strokeStyle = rgba('#ffffff', k * 0.7);
        ctx.shadowColor = rgba('#fff2a8', 1);
        ctx.shadowBlur = 12;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        for (let s = 0; s <= segs; s++) {
          const ff = flow + (s / segs) * segLen;
          if (ff > reach) break;
          const baseX = muzzle.x + ux * (beamTotalLen * ff);
          const baseY = muzzle.y + uy * (beamTotalLen * ff);
          const wob = noise1(ff * 12 + ms * 0.02 + seed, seed) * beamW * 0.9 * k;
          const px = baseX + nx * wob;
          const py = baseY + ny * wob;
          if (s === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.stroke();
      }
    });
  }
  // 発射口の後方爆風（リコイル）
  const backAng = ang + Math.PI;
  for (let i = 0; i < 3; i++) {
    particles.push({
      delay: HYPERBEAM_CHARGE_MS + i * 45,
      maxLife: 420,
      blend: 'lighter',
      draw(ctx, t) {
        const r = lerp(8 * S, 95 * S, easeOutQuint(t));
        const a = (1 - t) * 0.7;
        const px = muzzle.x + Math.cos(backAng) * r * 0.4;
        const py = muzzle.y + Math.sin(backAng) * r * 0.4;
        ctx.strokeStyle = rgba('#fff2a8', a);
        ctx.lineWidth = (5 - i) * (1 - t * 0.5);
        ctx.shadowColor = rgba('#ffd24a', 0.9);
        ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.ellipse(px, py, r * 0.75, r * 0.4, backAng, 0, Math.PI * 2);
        ctx.stroke();
      }
    });
  }
  // マズル閃光（発射の瞬間）
  particles.push({
    delay: HYPERBEAM_CHARGE_MS - 20,
    maxLife: 280,
    blend: 'lighter',
    draw(ctx, t) {
      const a = (1 - t) * 0.95;
      const r = lerp(10 * S, 95 * S, easeOutQuint(t));
      const g = ctx.createRadialGradient(muzzle.x, muzzle.y, 0, muzzle.x, muzzle.y, r);
      g.addColorStop(0, rgba('#ffffff', a));
      g.addColorStop(0.3, rgba('#fff2a8', a * 0.9));
      g.addColorStop(0.7, rgba('#ffd24a', a * 0.5));
      g.addColorStop(1, 'rgba(255,180,40,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(muzzle.x, muzzle.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  });

  // ---- 幕2：着弾＝破壊 ----
  // 巨大な白熱球
  particles.push({
    delay: HYPERBEAM_HIT_MS,
    maxLife: 460,
    blend: 'lighter',
    draw(ctx, t) {
      const a = (1 - t) * 0.95;
      const r = lerp(10 * S, 115 * S, easeOutQuint(t));
      const g = ctx.createRadialGradient(to.x, to.y, 0, to.x, to.y, r);
      g.addColorStop(0, rgba('#ffffff', a));
      g.addColorStop(0.22, rgba('#fff8d0', a));
      g.addColorStop(0.5, rgba('#ffd24a', a * 0.75));
      g.addColorStop(0.8, rgba('#ff9a2a', a * 0.35));
      g.addColorStop(1, 'rgba(255,80,10,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(to.x, to.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  // 貫通の残像：着弾点の"先"にも細い光が抜ける
  particles.push({
    delay: HYPERBEAM_HIT_MS,
    maxLife: 200,
    blend: 'lighter',
    draw(ctx, t) {
      const a = (1 - t) * 0.7;
      const overshootLen = dist * 0.32;
      ctx.save();
      ctx.translate(to.x, to.y);
      ctx.rotate(ang);
      const w = beamW * 0.6 * (1 - t * 0.5);
      const g = ctx.createLinearGradient(0, 0, overshootLen, 0);
      g.addColorStop(0, rgba('#ffffff', a));
      g.addColorStop(0.4, rgba('#fff2a8', a * 0.7));
      g.addColorStop(1, 'rgba(255,180,40,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(0, -w);
      ctx.lineTo(overshootLen, -w * 0.3);
      ctx.lineTo(overshootLen, w * 0.3);
      ctx.lineTo(0, w);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  });
  // 硬い多重衝撃波
  for (let i = 0; i < 4; i++) {
    particles.push({
      delay: HYPERBEAM_HIT_MS + i * 45,
      maxLife: 480 - i * 50,
      blend: 'lighter',
      draw(ctx, t) {
        const r = lerp(10 * S, R * (0.18 + i * 0.075), easeOutQuint(t));
        const a = (1 - t) * (0.9 - i * 0.15);
        const col = i === 0 ? '#ffffff' : (i === 1 ? '#fff2a8' : (i === 2 ? '#ffd24a' : '#ff9a2a'));
        ctx.strokeStyle = rgba(col, a);
        ctx.lineWidth = (9 - i * 1.6) * (1 - t * 0.5);
        ctx.shadowColor = rgba(col, 0.9);
        ctx.shadowBlur = 18;
        ctx.beginPath();
        ctx.ellipse(to.x, to.y, r, r * 0.85, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    });
  }
  // 硬い三角形シャード（エネルギー破片）が放射状に飛散
  for (let i = 0; i < 22; i++) {
    const sa = rand(0, Math.PI * 2);
    const sp = rand(50, 200) * S;
    const sz = rand(7, 16) * S;
    const grav = rand(0.4, 1.2);
    const rotV = rand(-9, 9);
    const rot0 = rand(0, Math.PI * 2);
    const col = pick(['#ffffff', '#fff2a8', '#ffd24a', '#ffb347']);
    particles.push({
      delay: HYPERBEAM_HIT_MS + rand(0, 50),
      maxLife: rand(500, 720),
      blend: 'lighter',
      draw(ctx, t) {
        const e = easeOutCubic(t);
        const x = to.x + Math.cos(sa) * sp * e;
        const y = to.y + Math.sin(sa) * sp * e * 0.85 + grav * t * t * h * 0.12;
        const a = (1 - t) * 0.95;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(rot0 + t * rotV);
        ctx.fillStyle = rgba(col, a);
        ctx.shadowColor = rgba(col, 0.9);
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.moveTo(0, -sz);
        ctx.lineTo(sz * 0.7, sz * 0.8);
        ctx.lineTo(-sz * 0.7, sz * 0.6);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    });
  }
  // 地面の亀裂（着弾点から放射状に走る、ジグザグ＋熱い芯）
  for (let i = 0; i < 10; i++) {
    const sa = (i / 10) * Math.PI * 2 + rand(-0.15, 0.15);
    const crackLen = rand(60, 140) * S;
    const seed = rand(0, 100);
    particles.push({
      delay: HYPERBEAM_HIT_MS + rand(0, 40),
      maxLife: 640,
      draw(ctx, t) {
        const grow = easeOutCubic(clamp01(t * 2.2));
        const a = grow * (1 - Math.max(0, (t - 0.4) / 0.6)) * 0.9;
        if (a <= 0.01) return;
        // 外側：暗い亀裂本体
        ctx.strokeStyle = rgba('#3a2010', a);
        ctx.lineWidth = 3;
        ctx.beginPath();
        const segments = 4;
        ctx.moveTo(to.x, to.y + 8 * S);
        for (let s = 1; s <= segments; s++) {
          const k = s / segments;
          const rr = crackLen * k * grow;
          const jitter = noise1(k * 4 + seed, seed) * 12 * S;
          const px = to.x + Math.cos(sa) * rr + jitter;
          const py = to.y + 8 * S + Math.sin(sa) * rr * 0.45 + jitter * 0.5;
          ctx.lineTo(px, py);
        }
        ctx.stroke();
        // 内側：熱で光る芯
        ctx.strokeStyle = rgba('#ffd24a', a * 0.8);
        ctx.lineWidth = 1.2;
        ctx.shadowColor = rgba('#fff2a8', 1);
        ctx.shadowBlur = 6;
        ctx.stroke();
      }
    });
  }
  // 岩塊（回転しながら放物線で飛散）
  for (let i = 0; i < 26; i++) {
    const sa = rand(-Math.PI * 0.95, -Math.PI * 0.05);
    const sp = rand(50, 180) * S;
    const sz = rand(3, 9) * S;
    const grav = rand(1, 1.8);
    const rotV = rand(-8, 8);
    const rot0 = rand(0, Math.PI * 2);
    const col = pick(['#8a6a45', '#a58257', '#6e5335', '#c9a878']);
    particles.push({
      delay: HYPERBEAM_HIT_MS + rand(0, 60),
      maxLife: rand(600, 820),
      draw(ctx, t) {
        const e = easeOutCubic(t);
        const x = to.x + Math.cos(sa) * sp * e;
        const y = to.y + Math.sin(sa) * sp * e + grav * t * t * h * 0.35;
        const a = 1 - Math.max(0, (t - 0.7) / 0.3);
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(rot0 + t * rotV);
        ctx.fillStyle = rgba(col, a);
        ctx.fillRect(-sz / 2, -sz / 2, sz, sz * 0.85);
        ctx.restore();
      }
    });
  }
  // 二次爆発（着弾点の周囲で時間差）
  for (let i = 0; i < 3; i++) {
    const delay = HYPERBEAM_HIT_MS + 180 + i * 90;
    const ox = rand(-60, 60) * S;
    const oy = rand(-40, 30) * S;
    particles.push({
      delay,
      maxLife: 340,
      blend: 'lighter',
      draw(ctx, t) {
        const a = (1 - t) * 0.7;
        const r = lerp(6 * S, 60 * S, easeOutQuint(t));
        const g = ctx.createRadialGradient(to.x + ox, to.y + oy, 0, to.x + ox, to.y + oy, r);
        g.addColorStop(0, rgba('#ffffff', a));
        g.addColorStop(0.4, rgba('#fff2a8', a * 0.85));
        g.addColorStop(1, 'rgba(255,180,40,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(to.x + ox, to.y + oy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }
  // 立ち上る黒煙
  for (let i = 0; i < 16; i++) {
    const ox = rand(-60, 60) * S;
    const oy = rand(-40, 20) * S;
    const size = rand(30, 55) * S;
    const seed = rand(0, 100);
    particles.push({
      delay: HYPERBEAM_HIT_MS + 120 + rand(0, 260),
      maxLife: rand(620, 820),
      draw(ctx, t) {
        const rise = easeOutCubic(t);
        const x = to.x + ox + noise1(t * 4 + seed, seed) * 22 * S;
        const y = to.y + oy - rise * 70 * S;
        const a = (t < 0.12 ? t / 0.12 : (1 - Math.max(0, (t - 0.45) / 0.55))) * 0.45;
        const g = ctx.createRadialGradient(x, y, 0, x, y, size);
        g.addColorStop(0, rgba('#2a1812', a));
        g.addColorStop(0.5, rgba('#1a0e0a', a * 0.7));
        g.addColorStop(1, 'rgba(10,6,4,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, size, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }
  // 余燼（明滅する火の粉が漂う）
  for (let i = 0; i < 22; i++) {
    const ox = rand(-80, 80) * S;
    const oy = rand(-50, 30) * S;
    const sz = rand(1.6, 3.2) * S;
    const seed = rand(0, 100);
    particles.push({
      delay: HYPERBEAM_HIT_MS + 200 + rand(0, 200),
      maxLife: rand(500, 720),
      blend: 'lighter',
      draw(ctx, t) {
        const x = to.x + ox + noise1(t * 3 + seed, seed) * 18 * S;
        const y = to.y + oy - t * h * 0.14;
        const flick = 0.5 + Math.abs(noise1(t * 18 + seed, seed)) * 0.5;
        const a = (1 - t) * flick * 0.9;
        ctx.fillStyle = rgba('#ffb060', a);
        ctx.shadowColor = rgba('#ff6a1a', 0.9);
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(x, y, sz, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }
}

// ============================================================
// きりふだ：切り札＝ハートのエースを展開し、相手めがけて投げつける演出
// 構成：①トランプが扇状に展開され、中央のエースが輝く（チャージ）
//       ②エースのカードが回転しながら相手へ飛翔、桃色の尾を引く
//       ③他のカードも追従するように続く（ハートのオマージュ）
//       ④着弾：巨大なハート型の爆発、ハートとカードが放射状に舞う
//       ⑤余韻に♠♥♦♣が舞い散る
// 「白カードに赤ハートのエース」「扇状の展開」「ハート形の炸裂」がキモ。
// ============================================================
const TRUMPCARD_CHARGE_MS = 520;
const TRUMPCARD_FLIGHT_MS = 380;
const TRUMPCARD_HIT_MS = TRUMPCARD_CHARGE_MS + TRUMPCARD_FLIGHT_MS;
const TRUMPCARD_END_MS = TRUMPCARD_HIT_MS + 780;

function spawnTrumpCardSpecial(particles, w, h, info) {
  const from = (info && info.from) || { x: w * 0.28, y: h * 0.68 };
  const to = (info && info.to) || { x: w * 0.72, y: h * 0.32 };
  const S = (info && info.scale) || 1;
  const R = Math.max(w, h);
  const dx = to.x - from.x, dy = to.y - from.y;
  const dist = Math.hypot(dx, dy) || 1;
  const ang = Math.atan2(dy, dx);
  const nx = -Math.sin(ang), ny = Math.cos(ang);

  // ---- ハートのパスを描くヘルパー ----
  function heartPath(ctx, cx, cy, r, rot) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rot);
    ctx.beginPath();
    ctx.moveTo(0, -r * 0.28);
    ctx.bezierCurveTo(-r * 0.55, -r * 1.05, -r * 1.25, -r * 0.3, 0, r * 0.75);
    ctx.bezierCurveTo(r * 1.25, -r * 0.3, r * 0.55, -r * 1.05, 0, -r * 0.28);
    ctx.closePath();
    ctx.restore();
  }
  function fillHeart(ctx, cx, cy, r, rot, color, alpha) {
    heartPath(ctx, cx, cy, r, rot);
    ctx.fillStyle = rgba(color, alpha);
    ctx.fill();
  }

  // ---- トランプ（白い角丸カード＋中央に赤ハート）を描くヘルパー ----
  function drawCard(ctx, x, y, cw, ch, rot, alpha, opts) {
    const o = opts || {};
    const borderCol = o.borderCol || '#ff3b5c';
    const suitCol = o.suitCol || '#ff3b5c';
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    const r = Math.min(cw, ch) * 0.16;
    ctx.beginPath();
    ctx.moveTo(-cw / 2 + r, -ch / 2);
    ctx.lineTo(cw / 2 - r, -ch / 2);
    ctx.arcTo(cw / 2, -ch / 2, cw / 2, -ch / 2 + r, r);
    ctx.lineTo(cw / 2, ch / 2 - r);
    ctx.arcTo(cw / 2, ch / 2, cw / 2 - r, ch / 2, r);
    ctx.lineTo(-cw / 2 + r, ch / 2);
    ctx.arcTo(-cw / 2, ch / 2, -cw / 2, ch / 2 - r, r);
    ctx.lineTo(-cw / 2, -ch / 2 + r);
    ctx.arcTo(-cw / 2, -ch / 2, -cw / 2 + r, -ch / 2, r);
    ctx.closePath();
    // 影（加算合成は使わない）
    ctx.fillStyle = rgba('#ffffff', alpha);
    ctx.fill();
    // ボーダー
    ctx.strokeStyle = rgba(borderCol, alpha * 0.9);
    ctx.lineWidth = cw * 0.06;
    ctx.stroke();
    // 中央のハート
    fillHeart(ctx, 0, 0, Math.min(cw, ch) * 0.32, 0, suitCol, alpha);
    // 光沢ハイライト
    ctx.strokeStyle = rgba('#ffffff', alpha * 0.7);
    ctx.lineWidth = cw * 0.03;
    ctx.beginPath();
    ctx.moveTo(-cw * 0.35, -ch * 0.38);
    ctx.lineTo(cw * 0.35, -ch * 0.38);
    ctx.stroke();
    ctx.restore();
  }

  // ---- 幕0：足元に淡い桃色の光（予兆）----
  particles.push({
    maxLife: TRUMPCARD_CHARGE_MS + 120,
    blend: 'lighter',
    draw(ctx, t) {
      const a = Math.sin(Math.PI * clamp01(t)) * 0.5;
      const r = lerp(12 * S, 60 * S, easeOutCubic(t));
      const g = ctx.createRadialGradient(from.x, from.y, 0, from.x, from.y, r);
      g.addColorStop(0, rgba('#ffffff', a * 0.7));
      g.addColorStop(0.5, rgba('#ff9fc0', a * 0.5));
      g.addColorStop(1, 'rgba(255,155,190,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(from.x, from.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  });

  // ---- 幕1：7枚のカードが扇状に展開。中央（idx=3）がエース ----
  const CARD_COUNT = 7;
  const ACE_IDX = 3;
  const fanRadius = 62 * S;
  for (let i = 0; i < CARD_COUNT; i++) {
    const isAce = i === ACE_IDX;
    const fanT = (i - (CARD_COUNT - 1) / 2);
    const localAngle = ang + fanT * 0.24;      // 攻撃方向を中心に扇状に開く
    // 開いた位置（扇の根元）
    const openX = from.x + Math.cos(localAngle) * fanRadius;
    const openY = from.y + Math.sin(localAngle) * fanRadius * 0.9;
    // エースはさらに前方へ、他はそのまま
    const cw = (isAce ? 34 : 26) * S;
    const ch = cw * 1.4;
    const cardRot = (isAce ? 0 : fanT * 0.25) + ang;
    const delay = isAce ? 0 : 30 * Math.abs(fanT);
    const appearAt = TRUMPCARD_CHARGE_MS * (isAce ? 0.85 : 1.0);

    if (isAce) {
      // エース：開いた位置に到達後、そのまま飛翔粒子が動かすので、ここでは
      // チャージ完了までの滞空のみを描く（飛翔は別パーティクル）。
      particles.push({
        delay,
        maxLife: appearAt - delay + 20,
        blend: 'source-over',
        draw(ctx, t) {
          if (t >= 1) return;
          const pop = easeOutCubic(clamp01(t * 1.8));
          const bob = noise1(t * 4, i * 3) * 2.5 * S;
          // 出現時は原点から扇の位置へ
          const x = lerp(from.x, openX, pop);
          const y = lerp(from.y, openY, pop) + bob;
          // チャージが進むほど赤いオーラが強まる
          const auraA = Math.sin(Math.PI * clamp01(t)) * 0.5;
          const aura = ctx.createRadialGradient(x, y, 0, x, y, cw * 1.6);
          aura.addColorStop(0, rgba('#ffffff', auraA * 0.6));
          aura.addColorStop(0.5, rgba('#ff6b8a', auraA * 0.5));
          aura.addColorStop(1, 'rgba(255,80,120,0)');
          ctx.fillStyle = aura;
          ctx.beginPath();
          ctx.arc(x, y, cw * 1.6, 0, Math.PI * 2);
          ctx.fill();
          drawCard(ctx, x, y, cw, ch, cardRot, clamp01(t * 3), {
            borderCol: '#ff3b5c', suitCol: '#ff3b5c',
          });
        }
      });
    } else {
      // 他のカード：扇の位置にポップしてフェードアウト（エースの飛翔で吹き飛ぶ）
      particles.push({
        delay,
        maxLife: appearAt + 200 - delay,
        blend: 'source-over',
        draw(ctx, t) {
          if (t >= 1) return;
          const pop = easeOutCubic(clamp01(t * 2.2));
          const x = lerp(from.x, openX, pop);
          const y = lerp(from.y, openY, pop) + noise1(t * 5, i) * 2 * S;
          // チャージ完了後は急速にフェード（エースを送り出した余波）
          const fadeIn = clamp01(t * 3);
          const fadeOut = t > 0.85 ? (1 - (t - 0.85) / 0.15) : 1;
          const a = fadeIn * fadeOut;
          drawCard(ctx, x, y, cw, ch, cardRot, a, {
            borderCol: '#8a8a96', suitCol: '#8a8a96',
          });
        }
      });
    }
  }

  // ---- 幕2：エースが回転しながら相手へ飛翔、桃色の尾を引く ----
  particles.push({
    delay: TRUMPCARD_CHARGE_MS,
    maxLife: TRUMPCARD_FLIGHT_MS,
    blend: 'source-over',
    draw(ctx, t) {
      if (t >= 1) return;
      const e = easeInCubic(t) * 0.55 + t * 0.45;
      // 軽く弧を描く（上にふわっと浮いてから着弾）
      const arc = Math.sin(Math.PI * e) * 34 * S;
      const startX = from.x + Math.cos(ang) * fanRadius;
      const startY = from.y + Math.sin(ang) * fanRadius * 0.9;
      const x = lerp(startX, to.x, e) + nx * arc;
      const y = lerp(startY, to.y, e) + ny * arc - Math.sin(Math.PI * e) * 14 * S;
      const spin = ang + e * Math.PI * 4;   // 2回転
      const cw = 34 * S, ch = cw * 1.4;
      // 桃色の尾（過去位置をなぞる）
      for (let k = 6; k >= 1; k--) {
        const te = Math.max(0, e - k * 0.045);
        const ta = Math.sin(Math.PI * te) * 34 * S;
        const tx = lerp(startX, to.x, te) + nx * ta;
        const ty = lerp(startY, to.y, te) + ny * ta - Math.sin(Math.PI * te) * 14 * S;
        const tA = (1 - k / 7) * 0.45;
        const g = ctx.createRadialGradient(tx, ty, 0, tx, ty, cw * 0.9);
        g.addColorStop(0, rgba('#ffffff', tA * 0.7));
        g.addColorStop(0.4, rgba('#ff6b8a', tA * 0.6));
        g.addColorStop(1, 'rgba(255,80,120,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(tx, ty, cw * 0.9, 0, Math.PI * 2);
        ctx.fill();
      }
      // エース本体（輝きを強めながら）
      const auraA = 0.7;
      const aura = ctx.createRadialGradient(x, y, 0, x, y, cw * 1.6);
      aura.addColorStop(0, rgba('#ffffff', auraA * 0.7));
      aura.addColorStop(0.4, rgba('#ff6b8a', auraA * 0.55));
      aura.addColorStop(1, 'rgba(255,80,120,0)');
      ctx.fillStyle = aura;
      ctx.beginPath();
      ctx.arc(x, y, cw * 1.6, 0, Math.PI * 2);
      ctx.fill();
      const fade = t > 0.9 ? 1 - (t - 0.9) / 0.1 : 1;
      drawCard(ctx, x, y, cw, ch, spin, fade, {
        borderCol: '#ff3b5c', suitCol: '#ff3b5c',
      });
    }
  });

  // ---- 幕3：着弾＝ハート形の爆発 ----
  // 中心から巨大なハートが浮かぶ
  particles.push({
    delay: TRUMPCARD_HIT_MS,
    maxLife: 520,
    blend: 'lighter',
    draw(ctx, t) {
      const grow = easeOutQuint(Math.min(1, t * 2.5));
      const fade = 1 - Math.max(0, (t - 0.5) / 0.5);
      const r = 78 * S * grow;
      const a = fade * 0.95;
      if (a <= 0.01) return;
      // 外側グロー
      const aura = ctx.createRadialGradient(to.x, to.y, 0, to.x, to.y, r * 1.4);
      aura.addColorStop(0, rgba('#ffffff', a * 0.9));
      aura.addColorStop(0.35, rgba('#ff9fc0', a * 0.7));
      aura.addColorStop(1, 'rgba(255,80,120,0)');
      ctx.fillStyle = aura;
      ctx.beginPath();
      ctx.arc(to.x, to.y, r * 1.4, 0, Math.PI * 2);
      ctx.fill();
      // 中央のハート
      fillHeart(ctx, to.x, to.y, r, 0, '#ff3b5c', a);
      // 白い芯
      fillHeart(ctx, to.x, to.y, r * 0.55, 0, '#ffffff', a * 0.85);
    }
  });
  // 衝撃波（白→桃→赤）
  ['#ffffff', '#ff9fc0', '#ff3b5c'].forEach((col, i) => {
    particles.push({
      delay: TRUMPCARD_HIT_MS + i * 40,
      maxLife: 440 - i * 50,
      blend: 'lighter',
      draw(ctx, t) {
        const r = lerp(10 * S, R * (0.16 + i * 0.06), easeOutQuint(t));
        const a = (1 - t) * (0.85 - i * 0.15);
        ctx.strokeStyle = rgba(col, a);
        ctx.lineWidth = (6 - i) * (1 - t * 0.5);
        ctx.shadowColor = rgba(col, 0.9);
        ctx.shadowBlur = 14;
        ctx.beginPath();
        ctx.arc(to.x, to.y, r, 0, Math.PI * 2);
        ctx.stroke();
      }
    });
  });
  // 中央の大十字きらめき
  particles.push({
    delay: TRUMPCARD_HIT_MS,
    maxLife: 420,
    blend: 'lighter',
    draw(ctx, t) {
      const a = Math.sin(Math.PI * clamp01(t)) * 0.95;
      const size = lerp(10 * S, 72 * S, easeOutCubic(t));
      ctx.save();
      ctx.translate(to.x, to.y);
      ctx.fillStyle = rgba('#ffffff', a);
      ctx.shadowColor = rgba('#ff9fc0', 1);
      ctx.shadowBlur = size * 0.4;
      for (let k = 0; k < 4; k++) {
        ctx.save();
        ctx.rotate((k / 4) * Math.PI);
        ctx.beginPath();
        ctx.moveTo(0, -size);
        ctx.quadraticCurveTo(size * 0.1, -size * 0.1, size, 0);
        ctx.quadraticCurveTo(size * 0.1, size * 0.1, 0, size);
        ctx.quadraticCurveTo(-size * 0.1, size * 0.1, -size, 0);
        ctx.quadraticCurveTo(-size * 0.1, -size * 0.1, 0, -size);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
      ctx.restore();
    }
  });
  // 飛び散るハート（大小入り混じる）
  for (let i = 0; i < 24; i++) {
    const sa = rand(0, Math.PI * 2);
    const sp = rand(50, 175) * S;
    const sz = rand(4, 9) * S;
    const grav = rand(0.5, 1.4);
    const rot0 = rand(0, Math.PI * 2);
    const rotV = rand(-2.5, 2.5);
    const col = pick(['#ff3b5c', '#ff6b8a', '#ff9fc0', '#ffffff']);
    particles.push({
      delay: TRUMPCARD_HIT_MS + rand(0, 60),
      maxLife: rand(520, 720),
      blend: 'lighter',
      draw(ctx, t) {
        const e = easeOutCubic(t);
        const x = to.x + Math.cos(sa) * sp * e;
        const y = to.y + Math.sin(sa) * sp * e * 0.85 + grav * t * t * h * 0.1;
        const a = (1 - t) * 0.95;
        fillHeart(ctx, x, y, sz * (1 - t * 0.4), rot0 + t * rotV, col, a);
      }
    });
  }
  // 舞い散るカード片（小さな白カード）
  for (let i = 0; i < 10; i++) {
    const sa = rand(0, Math.PI * 2);
    const sp = rand(60, 145) * S;
    const cw = rand(10, 16) * S, ch = cw * 1.4;
    const grav = rand(0.7, 1.4);
    const rot0 = rand(0, Math.PI * 2);
    const rotV = rand(-4, 4);
    const col = pick(['#ff3b5c', '#ff6b8a', '#ffffff']);
    particles.push({
      delay: TRUMPCARD_HIT_MS + rand(0, 80),
      maxLife: rand(560, 780),
      blend: 'source-over',
      draw(ctx, t) {
        const e = easeOutCubic(t);
        const x = to.x + Math.cos(sa) * sp * e;
        const y = to.y + Math.sin(sa) * sp * e * 0.85 + grav * t * t * h * 0.12;
        const a = (1 - t) * 0.85;
        drawCard(ctx, x, y, cw, ch, rot0 + t * rotV, a, {
          borderCol: col, suitCol: col,
        });
      }
    });
  }
  // 余韻：桃色の光の粒
  for (let i = 0; i < 18; i++) {
    const ox = rand(-60, 60) * S;
    const oy = rand(-60, 30) * S;
    const sz = rand(1.5, 3.5) * S;
    const seed = rand(0, 100);
    particles.push({
      delay: TRUMPCARD_HIT_MS + 120 + rand(0, 180),
      maxLife: rand(480, 660),
      blend: 'lighter',
      draw(ctx, t) {
        const y = to.y + oy - t * h * 0.1;
        const x = to.x + ox + noise1(t * 3 + seed, seed) * 14 * S;
        const a = Math.sin(Math.PI * clamp01(t)) * 0.8;
        ctx.fillStyle = rgba('#ffb8d0', a);
        ctx.shadowColor = rgba('#ff6b8a', 0.9);
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(x, y, sz, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }
}

// ============================================================
// ヘドロばくだん／バッドポイズン：口元で毒の塊を練り、相手へ投げつける演出
// 構成：①口元に紫の毒液が渦を巻いて集まる（チャージ）
//       ②毒の塊が放物線を描きながら相手へ飛翔、紫の尾を引く
//       ③着弾：紫の大爆発、毒液が飛び散り、地面を這う
//       ④飛沫が降り注ぎ、毒の沼が残って蒸発する余韻
// 「粘性のある毒の塊」「ドス黒い紫＋黄緑の気泡」「着弾後の毒だまり」がキモ。
// ============================================================
const SLUDGEBOMB_CHARGE_MS = 400;
const SLUDGEBOMB_FLIGHT_MS = 340;
const SLUDGEBOMB_HIT_MS = SLUDGEBOMB_CHARGE_MS + SLUDGEBOMB_FLIGHT_MS;
const SLUDGEBOMB_END_MS = SLUDGEBOMB_HIT_MS + 760;

function spawnSludgeBombSpecial(particles, w, h, info) {
  const from = (info && info.from) || { x: w * 0.28, y: h * 0.68 };
  const to = (info && info.to) || { x: w * 0.72, y: h * 0.32 };
  const S = (info && info.scale) || 1;
  const R = Math.max(w, h);
  const dx = to.x - from.x, dy = to.y - from.y;
  const dist = Math.hypot(dx, dy) || 1;
  const ux = dx / dist, uy = dy / dist;
  const nx = -uy, ny = ux;
  const mouth = { x: from.x + ux * 30 * S, y: from.y + uy * 30 * S };
  const seedA = rand(0, 100);

  // 毒の配色
  const PURPLES = ['#7a2aa0', '#a020c0', '#c060e0', '#5a1880'];
  const ACCENTS = ['#aac040', '#c8e070', '#e0a0ff'];

  // ---- 幕0：口元で毒液が渦を巻いて集まる ----
  particles.push({
    maxLife: SLUDGEBOMB_CHARGE_MS + 60,
    blend: 'lighter',
    draw(ctx, t) {
      const a = Math.sin(Math.PI * clamp01(t)) * 0.55;
      const r = lerp(8 * S, 42 * S, easeOutCubic(t));
      const g = ctx.createRadialGradient(mouth.x, mouth.y, 0, mouth.x, mouth.y, r);
      g.addColorStop(0, rgba('#e0a0ff', a));
      g.addColorStop(0.4, rgba('#a020c0', a * 0.8));
      g.addColorStop(1, 'rgba(90,24,128,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(mouth.x, mouth.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  // 集まる毒の雫（外から中心へ）
  for (let i = 0; i < 16; i++) {
    const a0 = (i / 16) * Math.PI * 2 + rand(-0.2, 0.2);
    const r0 = rand(46, 80) * S;
    const sz = rand(3, 6) * S;
    const col = pick(PURPLES);
    particles.push({
      delay: rand(0, 260),
      maxLife: rand(220, 320),
      draw(ctx, t) {
        if (t >= 1) return;
        const e = easeInCubic(t);
        const rr = lerp(r0, 4 * S, e);
        const spin = a0 + t * 2.6;
        const x = mouth.x + Math.cos(spin) * rr;
        const y = mouth.y + Math.sin(spin) * rr * 0.85;
        const a = clamp01(t * 4) * (1 - Math.max(0, (t - 0.85) / 0.15));
        const g = ctx.createRadialGradient(x, y, 0, x, y, sz * 1.6);
        g.addColorStop(0, rgba('#e0a0ff', a));
        g.addColorStop(0.5, rgba(col, a * 0.85));
        g.addColorStop(1, 'rgba(90,24,128,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, sz * 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }
  // 練り上がる毒塊（中心で膨らむボコボコの塊）
  particles.push({
    delay: 60,
    maxLife: SLUDGEBOMB_CHARGE_MS - 40,
    blend: 'lighter',
    draw(ctx, t) {
      const grow = easeOutCubic(Math.min(1, t * 2));
      const a = clamp01(t * 3) * (1 - Math.max(0, (t - 0.85) / 0.15));
      const baseR = 16 * S * grow;
      // ノイズで表面をデコボコに
      ctx.save();
      ctx.translate(mouth.x, mouth.y);
      ctx.beginPath();
      const segs = 24;
      for (let s = 0; s <= segs; s++) {
        const aa = (s / segs) * Math.PI * 2;
        const bump = noise1(aa * 3 + t * 8, seedA) * baseR * 0.25;
        const rr = baseR + bump;
        const px = Math.cos(aa) * rr;
        const py = Math.sin(aa) * rr;
        if (s === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      const g = ctx.createRadialGradient(-baseR * 0.3, -baseR * 0.3, 0, 0, 0, baseR);
      g.addColorStop(0, rgba('#e0a0ff', a));
      g.addColorStop(0.4, rgba('#a020c0', a * 0.95));
      g.addColorStop(0.8, rgba('#5a1880', a * 0.85));
      g.addColorStop(1, 'rgba(40,10,60,0)');
      ctx.fillStyle = g;
      ctx.fill();
      // 表面の気泡（黄緑のハイライト）
      for (let k = 0; k < 3; k++) {
        const ba = (k / 3) * Math.PI * 2 + t * 4;
        const bd = baseR * 0.5;
        const bx = Math.cos(ba) * bd;
        const by = Math.sin(ba) * bd;
        const bg = ctx.createRadialGradient(bx, by, 0, bx, by, baseR * 0.22);
        bg.addColorStop(0, rgba('#c8e070', a * 0.8));
        bg.addColorStop(1, 'rgba(200,224,112,0)');
        ctx.fillStyle = bg;
        ctx.beginPath();
        ctx.arc(bx, by, baseR * 0.22, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  });

  // ---- 幕1：毒塊が放物線を描いて飛翔、紫の尾を引く ----
  particles.push({
    delay: SLUDGEBOMB_CHARGE_MS,
    maxLife: SLUDGEBOMB_FLIGHT_MS,
    blend: 'lighter',
    draw(ctx, t) {
      if (t >= 1) return;
      const e = easeInCubic(t) * 0.5 + t * 0.5;
      // 放物線（軽く山なり）
      const arc = Math.sin(Math.PI * e) * dist * 0.22;
      const px = lerp(mouth.x, to.x, e);
      const py = lerp(mouth.y, to.y, e) - arc;   // 画面上方向に山を作る
      const size = (16 + (1 - e) * 6) * S;

      // 紫の尾（過去位置をなぞる、粘性のある雫状）
      for (let k = 8; k >= 1; k--) {
        const te = Math.max(0, e - k * 0.035);
        const ta = Math.sin(Math.PI * te) * dist * 0.22;
        const tx = lerp(mouth.x, to.x, te);
        const ty = lerp(mouth.y, to.y, te) - ta;
        const tA = (1 - k / 9) * 0.7;
        const tSize = size * (0.35 + k * 0.05);
        const g = ctx.createRadialGradient(tx, ty, 0, tx, ty, tSize);
        g.addColorStop(0, rgba('#e0a0ff', tA));
        g.addColorStop(0.4, rgba('#a020c0', tA * 0.8));
        g.addColorStop(1, 'rgba(90,24,128,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(tx, ty, tSize, 0, Math.PI * 2);
        ctx.fill();
      }

      // 本体（デコボコの塊）
      ctx.save();
      ctx.translate(px, py);
      // 前方向に軽く伸びる（進行方向の楕円）
      const spin = e * Math.PI * 6;
      ctx.rotate(spin);
      ctx.beginPath();
      const segs = 20;
      for (let s = 0; s <= segs; s++) {
        const aa = (s / segs) * Math.PI * 2;
        const bump = noise1(aa * 3 + e * 12, seedA) * size * 0.22;
        const rr = size + bump;
        const bx = Math.cos(aa) * rr * 1.15;
        const by = Math.sin(aa) * rr * 0.9;
        if (s === 0) ctx.moveTo(bx, by); else ctx.lineTo(bx, by);
      }
      ctx.closePath();
      const bg = ctx.createRadialGradient(-size * 0.3, -size * 0.3, 0, 0, 0, size * 1.3);
      bg.addColorStop(0, rgba('#e0a0ff', 1));
      bg.addColorStop(0.4, rgba('#a020c0', 0.95));
      bg.addColorStop(0.8, rgba('#5a1880', 0.9));
      bg.addColorStop(1, 'rgba(40,10,60,0)');
      ctx.fillStyle = bg;
      ctx.fill();
      // 黄緑の気泡ハイライト
      for (let k = 0; k < 3; k++) {
        const ba = (k / 3) * Math.PI * 2 + e * 8;
        const bd = size * 0.4;
        const bx = Math.cos(ba) * bd;
        const by = Math.sin(ba) * bd;
        const bg2 = ctx.createRadialGradient(bx, by, 0, bx, by, size * 0.25);
        bg2.addColorStop(0, rgba('#c8e070', 0.9));
        bg2.addColorStop(1, 'rgba(200,224,112,0)');
        ctx.fillStyle = bg2;
        ctx.beginPath();
        ctx.arc(bx, by, size * 0.25, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      // 飛翔中にぽたぽた落ちる雫
      if (Math.random() < 0.6) {
        const dropX = px + rand(-8, 8) * S;
        const dropY = py + rand(4, 12) * S;
        const dg = ctx.createRadialGradient(dropX, dropY, 0, dropX, dropY, 3 * S);
        dg.addColorStop(0, rgba('#a020c0', 0.8));
        dg.addColorStop(1, 'rgba(90,24,128,0)');
        ctx.fillStyle = dg;
        ctx.beginPath();
        ctx.arc(dropX, dropY, 3 * S, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  });

  // ---- 幕2：着弾＝紫の大爆発 ----
  particles.push({
    delay: SLUDGEBOMB_HIT_MS,
    maxLife: 420,
    blend: 'lighter',
    draw(ctx, t) {
      const a = (1 - t) * 0.92;
      const r = lerp(8 * S, 76 * S, easeOutQuint(t));
      const g = ctx.createRadialGradient(to.x, to.y, 0, to.x, to.y, r);
      g.addColorStop(0, rgba('#e0a0ff', a));
      g.addColorStop(0.3, rgba('#a020c0', a * 0.9));
      g.addColorStop(0.7, rgba('#5a1880', a * 0.6));
      g.addColorStop(1, 'rgba(40,10,60,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(to.x, to.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  // 衝撃波（紫のドロッとした輪）
  for (let i = 0; i < 3; i++) {
    particles.push({
      delay: SLUDGEBOMB_HIT_MS + i * 50,
      maxLife: 400 - i * 40,
      blend: 'lighter',
      draw(ctx, t) {
        const r = lerp(10 * S, R * (0.14 + i * 0.055), easeOutQuint(t));
        const a = (1 - t) * (0.8 - i * 0.15);
        const col = i === 0 ? '#e0a0ff' : (i === 1 ? '#a020c0' : '#5a1880');
        ctx.strokeStyle = rgba(col, a);
        ctx.lineWidth = (7 - i * 1.4) * (1 - t * 0.5);
        ctx.shadowColor = rgba(col, 0.9);
        ctx.shadowBlur = 14;
        ctx.beginPath();
        ctx.ellipse(to.x, to.y + 8 * S, r, r * 0.75, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    });
  }
  // 放射状に飛び散る毒の飛沫（大小入り混じる、重力で落ちる）
  for (let i = 0; i < 34; i++) {
    const sa = rand(0, Math.PI * 2);
    const sp = rand(40, 165) * S;
    const sz = rand(3, 8) * S;
    const grav = rand(0.7, 1.7);
    const col = pick(PURPLES);
    const seed = rand(0, 100);
    particles.push({
      delay: SLUDGEBOMB_HIT_MS + rand(0, 60),
      maxLife: rand(460, 680),
      draw(ctx, t) {
        const e = easeOutCubic(t);
        const x = to.x + Math.cos(sa) * sp * e;
        const y = to.y + Math.sin(sa) * sp * e * 0.85 + grav * t * t * h * 0.14;
        const flick = 0.7 + Math.abs(noise1(t * 14 + seed, seed)) * 0.3;
        const a = (1 - t) * 0.95 * flick;
        const g = ctx.createRadialGradient(x, y, 0, x, y, sz * 1.6);
        g.addColorStop(0, rgba('#e0a0ff', a));
        g.addColorStop(0.45, rgba(col, a * 0.9));
        g.addColorStop(1, 'rgba(60,15,80,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, sz * 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }
  // 地面に広がる毒だまり（着弾点の下に沈殿）
  particles.push({
    delay: SLUDGEBOMB_HIT_MS + 30,
    maxLife: 640,
    draw(ctx, t) {
      const grow = easeOutCubic(Math.min(1, t * 1.6));
      const fade = 1 - Math.max(0, (t - 0.6) / 0.4);
      const a = grow * fade * 0.85;
      if (a <= 0.01) return;
      const rx = 76 * S * grow;
      const ry = rx * 0.28;
      const cy = to.y + 18 * S;
      // 毒だまり本体
      const g = ctx.createRadialGradient(to.x, cy, 0, to.x, cy, rx);
      g.addColorStop(0, rgba('#a020c0', a));
      g.addColorStop(0.5, rgba('#7a2aa0', a * 0.85));
      g.addColorStop(1, 'rgba(60,15,80,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(to.x, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
      // 表面の気泡（黄緑）
      for (let k = 0; k < 4; k++) {
        const ba = (k / 4) * Math.PI * 2 + t * 3;
        const bx = to.x + Math.cos(ba) * rx * 0.5;
        const by = cy + Math.sin(ba) * ry * 0.5;
        const bA = Math.sin(Math.PI * clamp01(t)) * 0.7;
        const bg = ctx.createRadialGradient(bx, by, 0, bx, by, 4 * S);
        bg.addColorStop(0, rgba('#c8e070', bA));
        bg.addColorStop(1, 'rgba(200,224,112,0)');
        ctx.fillStyle = bg;
        ctx.beginPath();
        ctx.arc(bx, by, 4 * S, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  });
  // 立ち上る毒の蒸気（紫の煙）
  for (let i = 0; i < 12; i++) {
    const ox = rand(-50, 50) * S;
    const oy = rand(-20, 20) * S;
    const size = rand(28, 46) * S;
    const seed = rand(0, 100);
    particles.push({
      delay: SLUDGEBOMB_HIT_MS + 100 + rand(0, 220),
      maxLife: rand(540, 760),
      draw(ctx, t) {
        const rise = easeOutCubic(t);
        const x = to.x + ox + noise1(t * 4 + seed, seed) * 18 * S;
        const y = to.y + oy - rise * 55 * S;
        const a = (t < 0.15 ? t / 0.15 : (1 - Math.max(0, (t - 0.45) / 0.55))) * 0.4;
        const g = ctx.createRadialGradient(x, y, 0, x, y, size);
        g.addColorStop(0, rgba('#7a2aa0', a));
        g.addColorStop(0.5, rgba('#5a1880', a * 0.7));
        g.addColorStop(1, 'rgba(40,10,60,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, size, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }
}
// ============================================================
// かえんほうしゃ：口元から火炎の奔流をまっすぐに放ち、相手を焼き尽くす演出
// 構成：①口元に火の粉が渦を巻いて集まる（チャージ） ②紅〜白の多層の火炎が扇状に伸びる
//       ③火の舌が乱流で揺らめきながら相手へ押し寄せる ④着弾点で爆炎が炸裂
//       ⑤燃えかすが放射状に弾け、黒煙が立ち上る余韻
// 「流れる火炎のタング」「火の粉の尾」「紅→白の温度階調」がキモ。
// ============================================================
const FLAMETHROWER_CHARGE_MS = 380;
const FLAMETHROWER_EXTEND_MS = 180;
const FLAMETHROWER_SUSTAIN_MS = 620;
const FLAMETHROWER_FADE_MS = 320;
const FLAMETHROWER_HIT_MS = FLAMETHROWER_CHARGE_MS + FLAMETHROWER_EXTEND_MS;
const FLAMETHROWER_END_MS = FLAMETHROWER_HIT_MS + FLAMETHROWER_SUSTAIN_MS + FLAMETHROWER_FADE_MS;

function spawnFlamethrowerSpecial(particles, w, h, info) {
  const from = (info && info.from) || { x: w * 0.28, y: h * 0.68 };
  const to = (info && info.to) || { x: w * 0.72, y: h * 0.32 };
  const S = (info && info.scale) || 1;
  const R = Math.max(w, h);

  const dx = to.x - from.x, dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  const nx = -uy, ny = ux;
  const mouth = { x: from.x + ux * 30 * S, y: from.y + uy * 30 * S };
  const beamW = Math.min(46 * S, 54);
  const seedA = rand(0, 100), seedB = rand(0, 100);

  function flameStrength(ms) {
    if (ms < FLAMETHROWER_CHARGE_MS) return 0;
    const since = ms - FLAMETHROWER_CHARGE_MS;
    if (since < FLAMETHROWER_EXTEND_MS) return easeOutCubic(since / FLAMETHROWER_EXTEND_MS);
    if (since < FLAMETHROWER_EXTEND_MS + FLAMETHROWER_SUSTAIN_MS) return 1;
    const f = (since - FLAMETHROWER_EXTEND_MS - FLAMETHROWER_SUSTAIN_MS) / FLAMETHROWER_FADE_MS;
    return Math.pow(1 - clamp01(f), 1.6);
  }
  function beamReach(ms) {
    if (ms < FLAMETHROWER_CHARGE_MS) return 0;
    return easeOutQuint(clamp01((ms - FLAMETHROWER_CHARGE_MS) / FLAMETHROWER_EXTEND_MS));
  }

  // ---- 幕0：口元に火の粉が集まる ----
  particles.push({
    maxLife: FLAMETHROWER_CHARGE_MS + 60,
    blend: 'lighter',
    draw(ctx, t) {
      const a = Math.sin(Math.PI * clamp01(t)) * 0.6;
      const r = lerp(8 * S, 38 * S, easeOutCubic(t));
      const g = ctx.createRadialGradient(mouth.x, mouth.y, 0, mouth.x, mouth.y, r);
      g.addColorStop(0, rgba('#fff8d0', a));
      g.addColorStop(0.4, rgba('#ffb347', a * 0.8));
      g.addColorStop(1, 'rgba(255,90,20,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(mouth.x, mouth.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  for (let i = 0; i < 16; i++) {
    const a0 = (i / 16) * Math.PI * 2 + rand(-0.2, 0.2);
    const r0 = rand(36, 66) * S;
    const startAt = rand(0, 200);
    const seed = rand(0, 100);
    particles.push({
      delay: startAt,
      maxLife: rand(200, 280),
      blend: 'lighter',
      draw(ctx, t) {
        if (t >= 1) return;
        const e = easeInCubic(t);
        const rr = lerp(r0, 4 * S, e);
        const spin = a0 + t * 3;
        const x = mouth.x + Math.cos(spin) * rr;
        const y = mouth.y + Math.sin(spin) * rr * 0.8;
        const a = clamp01(t * 4) * (1 - Math.max(0, (t - 0.85) / 0.15));
        const size = (2.5 + 2 * Math.abs(noise1(t * 10, seed))) * S;
        const g = ctx.createRadialGradient(x, y, 0, x, y, size * 2.5);
        g.addColorStop(0, rgba('#ffe9a0', a));
        g.addColorStop(0.5, rgba('#ff9a3a', a * 0.7));
        g.addColorStop(1, 'rgba(255,90,20,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, size * 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }

  // ---- 幕1〜3：火炎の奔流（4層のソフトブロブを加算合成で重ねる） ----
  const LAYERS = [
    { n: 24, wMul: 1.10, aMul: 0.28, spread: 0.65, col0: '#ff7a1a', col1: '#ff2e0e', seedOff: 0 },
    { n: 22, wMul: 0.80, aMul: 0.50, spread: 0.30, col0: '#ffd98a', col1: '#ff5a1a', seedOff: 7 },
    { n: 18, wMul: 0.50, aMul: 0.75, spread: -0.10, col0: '#fff6cf', col1: '#ff8a2e', seedOff: 13 },
    { n: 14, wMul: 0.26, aMul: 0.95, spread: -0.35, col0: '#ffffff', col1: '#ffd98a', seedOff: 21 },
  ];
  LAYERS.forEach((L, li) => {
    particles.push({
      delay: FLAMETHROWER_CHARGE_MS,
      maxLife: FLAMETHROWER_END_MS - FLAMETHROWER_CHARGE_MS,
      blend: 'lighter',
      draw(ctx, t) {
        const ms = FLAMETHROWER_CHARGE_MS + t * (FLAMETHROWER_END_MS - FLAMETHROWER_CHARGE_MS);
        const k = flameStrength(ms);
        if (k <= 0.02) return;
        const reach = beamReach(ms);
        const time = ms / 1000;
        for (let i = 0; i < L.n; i++) {
          const kk = (i + 0.5) / L.n;
          if (kk > reach) break;
          const px = mouth.x + (to.x - mouth.x) * kk;
          const py = mouth.y + (to.y - mouth.y) * kk;
          const jit = noise1(kk * 5 + time * 6 + L.seedOff, seedA + li * 3) * beamW * 0.38 * kk;
          const jit2 = noise1(kk * 4 + time * 7 + L.seedOff + 5, seedB + li * 3) * beamW * 0.38 * kk;
          const x = px + nx * (jit + jit2 * 0.5);
          const y = py + ny * (jit + jit2 * 0.5);
          const baseTaper = Math.min(1, kk * 4);
          const taper = baseTaper * (1 + L.spread * kk) * Math.max(0.2, 1 - Math.pow(kk, 3) * 0.5);
          const size = beamW * L.wMul * taper * (0.85 + Math.abs(noise1(kk * 6 + time * 10 + L.seedOff, seedA + li)) * 0.35);
          const a = k * L.aMul * (1 - kk * 0.35) * (0.85 + Math.abs(noise1(kk * 8 + time * 12, seedB + li)) * 0.3);
          const g = ctx.createRadialGradient(x, y, 0, x, y, size);
          g.addColorStop(0, rgba(L.col0, a));
          g.addColorStop(0.4, rgba(L.col1, a * 0.85));
          g.addColorStop(1, 'rgba(255,60,0,0)');
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(x, y, size, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    });
  });

  // ---- 火の粉：炎から飛び出して進行方向に流れる ----
  for (let i = 0; i < 36; i++) {
    const startAt = FLAMETHROWER_CHARGE_MS + rand(0, FLAMETHROWER_SUSTAIN_MS + 220);
    const kStart = rand(0, 0.5);
    const kEnd = rand(0.7, 1.15);
    const sideOff = rand(-1, 1);
    const sp = rand(0.8, 1.4);
    const size = rand(1.6, 3.2) * S;
    const col = pick(['#ffe9a0', '#ffb347', '#ff7a1a', '#ff4d2e']);
    const seed = rand(0, 100);
    particles.push({
      delay: startAt,
      maxLife: rand(280, 460),
      blend: 'lighter',
      draw(ctx, t) {
        if (t >= 1) return;
        const e = easeOutCubic(t);
        const kk = lerp(kStart, kEnd, e * sp);
        const px = mouth.x + (to.x - mouth.x) * kk;
        const py = mouth.y + (to.y - mouth.y) * kk;
        const drift = noise1(kk * 4 + t * 4, seed) * 14 * S * e;
        const perp = sideOff * beamW * 0.7 * (1 - kk * 0.3) + drift;
        const x = px + nx * perp;
        const y = py + ny * perp;
        const a = (1 - t) * 0.95;
        ctx.fillStyle = rgba(col, a);
        ctx.shadowColor = rgba('#ff9a3a', 0.9);
        ctx.shadowBlur = 6 * S;
        ctx.beginPath();
        ctx.arc(x, y, size * (1 - t * 0.4), 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }

  // ---- 幕4：着弾の爆炎 ----
  particles.push({
    delay: FLAMETHROWER_HIT_MS,
    maxLife: 400,
    blend: 'lighter',
    draw(ctx, t) {
      const a = (1 - t) * 0.92;
      const r = lerp(8 * S, 66 * S, easeOutQuint(t));
      const g = ctx.createRadialGradient(to.x, to.y, 0, to.x, to.y, r);
      g.addColorStop(0, rgba('#ffffff', a));
      g.addColorStop(0.25, rgba('#ffe9a0', a * 0.95));
      g.addColorStop(0.6, rgba('#ff7a1a', a * 0.7));
      g.addColorStop(1, 'rgba(255,60,10,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(to.x, to.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  for (let i = 0; i < 3; i++) {
    particles.push({
      delay: FLAMETHROWER_HIT_MS + i * 55,
      maxLife: 340 - i * 40,
      blend: 'lighter',
      draw(ctx, t) {
        const r = lerp(10 * S, R * (0.12 + i * 0.055), easeOutQuint(t));
        const a = (1 - t) * (0.8 - i * 0.15);
        ctx.strokeStyle = rgba(i === 0 ? '#ffe9a0' : '#ff7a1a', a);
        ctx.lineWidth = (6 - i) * (1 - t * 0.5);
        ctx.shadowColor = rgba('#ff9a3a', 0.9);
        ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.arc(to.x, to.y, r, 0, Math.PI * 2);
        ctx.stroke();
      }
    });
  }
  // 燃えかすが放射状に弾ける（明滅する火の粒）
  for (let i = 0; i < 24; i++) {
    const sa = rand(0, Math.PI * 2);
    const sp = rand(28, 115) * S;
    const sz = rand(2, 4.5) * S;
    const col = pick(['#ffe9a0', '#ffb347', '#ff4d2e']);
    const grav = rand(0.5, 1.2);
    const seed = rand(0, 100);
    particles.push({
      delay: FLAMETHROWER_HIT_MS + rand(0, 60),
      maxLife: rand(340, 560),
      blend: 'lighter',
      draw(ctx, t) {
        const e = easeOutCubic(t);
        const x = to.x + Math.cos(sa) * sp * e;
        const y = to.y + Math.sin(sa) * sp * e * 0.85 + grav * t * t * h * 0.06;
        const flick = 0.5 + Math.abs(noise1(t * 20 + seed, seed)) * 0.5;
        const a = (1 - t) * 0.95 * flick;
        ctx.fillStyle = rgba(col, a);
        ctx.shadowColor = rgba('#ff9a3a', 0.9);
        ctx.shadowBlur = 6 * S;
        ctx.beginPath();
        ctx.arc(x, y, sz * (1 - t * 0.5), 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }
  // 黒煙が立ち上る余韻
  for (let i = 0; i < 10; i++) {
    const ox = rand(-24, 24) * S;
    const oy = rand(-24, 24) * S;
    const size = rand(24, 42) * S;
    const seed = rand(0, 100);
    particles.push({
      delay: FLAMETHROWER_HIT_MS + 80 + rand(0, 200),
      maxLife: rand(500, 700),
      draw(ctx, t) {
        const rise = easeOutCubic(t);
        const x = to.x + ox + noise1(t * 4 + seed, seed) * 16 * S;
        const y = to.y + oy - rise * 40 * S;
        const a = (t < 0.15 ? t / 0.15 : (1 - Math.max(0, (t - 0.4) / 0.6))) * 0.4;
        const g = ctx.createRadialGradient(x, y, 0, x, y, size);
        g.addColorStop(0, rgba('#2a1812', a));
        g.addColorStop(1, 'rgba(20,12,10,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, size, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }
}

// ============================================================
// だいもんじ：火球を相手へ撃ち込み、着弾点に炎が「大」の字を描いて燃え広がる演出
// 原作（ダイパ以降のバトル演出）の象徴である「大の字」を再現する。
// 構成：①口元に火球が生まれる（チャージ）
//       ②火球が尾を引きながら相手へ飛ぶ
//       ③着弾の閃光と同時に、炎が「大」の字の4画（横棒→縦棒→左払い→右払い）を順に走る
//       ④「大」が揺らめきながら燃え盛る（この間に相手へダメージが入る体感）
//       ⑤ 大の字が爆ぜて火の粉が四散し、黒煙が立ち上る余韻
// 「大」の字のシルエットが一目で読めること、火線の先端が明るく後ろが赤い温度階調がキモ。
//
// info = { from:{x,y}, to:{x,y}, scale }  ※ playSpecialTypeEffect が実測して渡す。
// ============================================================
const DAIMONJI_CHARGE_MS = 340;    // 口元に火球が生まれる
const DAIMONJI_FLY_MS = 300;       // 火球が相手へ飛ぶ
const DAIMONJI_HIT_MS = DAIMONJI_CHARGE_MS + DAIMONJI_FLY_MS;   // 着弾（大の字の描き始め）
const DAIMONJI_DRAW_MS = 300;      // 「大」の4画を描き切るまで
const DAIMONJI_BURN_MS = 520;      // 「大」が燃え盛る
const DAIMONJI_FADE_MS = 360;      // 爆ぜて消える
const DAIMONJI_BURST_MS = DAIMONJI_HIT_MS + DAIMONJI_DRAW_MS + DAIMONJI_BURN_MS;  // 爆散の瞬間
const DAIMONJI_END_MS = DAIMONJI_BURST_MS + DAIMONJI_FADE_MS + 200;

function spawnDaimonjiSpecial(particles, w, h, info) {
  const from = (info && info.from) || { x: w * 0.28, y: h * 0.68 };
  const to = (info && info.to) || { x: w * 0.72, y: h * 0.32 };
  const S = (info && info.scale) || 1;
  const R = Math.max(w, h);

  const dx = to.x - from.x, dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  const mouth = { x: from.x + ux * 30 * S, y: from.y + uy * 30 * S };

  // ---- 「大」の字の4画（着弾点 to を中心とした座標） ----
  // 実際の「大」の構造：横棒を縦線が貫き、その交点から左右へ両足が払われる。
  // 相手スプライトを覆う大きさ。縮小画面でも比率が保たれるよう S で拡縮する。
  const K = 58 * S;   // 「大」の基準サイズ（半幅）
  const cx = to.x, cy = to.y;
  // 「大」の字形：横棒は幅広く、縦の頭は横棒からわずかに出る程度、
  // 両足は交点から大きく開いて安定した三角形のシルエットを作る（縦に間延びさせない）。
  const BAR_Y = cy - K * 0.34;      // 横棒の高さ（字の上1/3あたり）
  const TOP_Y = cy - K * 1.02;      // 縦の頭の先端（横棒の上にはっきり出す）
  const FOOT_Y = cy + K * 0.86;     // 両足の先端
  const FOOT_DX = K * 1.12;         // 両足の開き（横棒の幅と同程度に広げる）
  // 筆順どおり時間順に描く：①横棒 ②縦棒 ③左払い ④右払い
  //   ①横棒   ：左から右へ一直線（幅広）
  //   ②縦棒   ：頭の先端から横棒を貫いて交点まで一気に引く
  //   ③左払い ：交点から左下へ大きく払う
  //   ④右払い ：交点から右下へ大きく払う
  const JX = cx, JY = BAR_Y + K * 0.10;   // 両足の付け根（横棒のすぐ下の交点）
  const STROKES = [
    { x0: cx - K * 1.22, y0: BAR_Y, x1: cx + K * 1.22, y1: BAR_Y, w: 19 * S, t0: 0.00, t1: 0.30 },
    { x0: cx,            y0: TOP_Y, x1: cx,            y1: JY,    w: 19 * S, t0: 0.24, t1: 0.50 },
    { x0: JX,            y0: JY,    x1: cx - FOOT_DX,  y1: FOOT_Y, w: 21 * S, t0: 0.44, t1: 0.74 },
    { x0: JX,            y0: JY,    x1: cx + FOOT_DX,  y1: FOOT_Y, w: 21 * S, t0: 0.68, t1: 1.00 },
  ];

  // 大の字全体の強度（描画→燃焼→爆散で減衰）。msは演出開始からの絶対時刻。
  function daimonjiStrength(ms) {
    if (ms < DAIMONJI_HIT_MS) return 0;
    if (ms < DAIMONJI_BURST_MS) return 1;
    const f = (ms - DAIMONJI_BURST_MS) / DAIMONJI_FADE_MS;
    return Math.pow(1 - clamp01(f), 1.5);
  }
  // 各画がどこまで描かれたか（0〜1）。先端が伸びていく表現に使う。
  function strokeProgress(st, ms) {
    const p = (ms - DAIMONJI_HIT_MS) / DAIMONJI_DRAW_MS;
    return easeOutCubic(clamp01((p - st.t0) / (st.t1 - st.t0)));
  }

  // ---- 幕0：口元に火の粉と火球の種が集まる ----
  particles.push({
    maxLife: DAIMONJI_CHARGE_MS + 40,
    blend: 'lighter',
    draw(ctx, t) {
      const a = Math.sin(Math.PI * clamp01(t)) * 0.7;
      const r = lerp(6 * S, 26 * S, easeOutCubic(t));
      const g = ctx.createRadialGradient(mouth.x, mouth.y, 0, mouth.x, mouth.y, r);
      g.addColorStop(0, rgba('#fff8d0', a));
      g.addColorStop(0.45, rgba('#ffb347', a * 0.85));
      g.addColorStop(1, 'rgba(255,80,20,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(mouth.x, mouth.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  for (let i = 0; i < 12; i++) {
    const a0 = (i / 12) * Math.PI * 2 + rand(-0.25, 0.25);
    const r0 = rand(30, 56) * S;
    const seed = rand(0, 100);
    particles.push({
      delay: rand(0, 170),
      maxLife: rand(170, 240),
      blend: 'lighter',
      draw(ctx, t) {
        if (t >= 1) return;
        const rr = lerp(r0, 3 * S, easeInCubic(t));
        const spin = a0 + t * 3.2;
        const x = mouth.x + Math.cos(spin) * rr;
        const y = mouth.y + Math.sin(spin) * rr * 0.8;
        const a = clamp01(t * 4) * (1 - Math.max(0, (t - 0.85) / 0.15));
        const size = (2.2 + 1.8 * Math.abs(noise1(t * 10, seed))) * S;
        const g = ctx.createRadialGradient(x, y, 0, x, y, size * 2.4);
        g.addColorStop(0, rgba('#ffe9a0', a));
        g.addColorStop(0.5, rgba('#ff9a3a', a * 0.7));
        g.addColorStop(1, 'rgba(255,80,20,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, size * 2.4, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }

  // ---- 幕1：火球が尾を引きながら相手へ飛ぶ ----
  particles.push({
    delay: DAIMONJI_CHARGE_MS,
    maxLife: DAIMONJI_FLY_MS,
    blend: 'lighter',
    draw(ctx, t) {
      const e = easeInCubic(t) * 0.35 + t * 0.65;   // 徐々に加速
      // 尾（過去の位置に小さな火の玉を並べる）
      for (let k = 7; k >= 0; k--) {
        const tt = clamp01(e - k * 0.035);
        const x = lerp(mouth.x, to.x, tt);
        const y = lerp(mouth.y, to.y, tt);
        const fade = 1 - k / 8;
        const r = (17 - k * 1.5) * S;
        const a = 0.75 * fade;
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, rgba(k === 0 ? '#ffffff' : '#ffd98a', a));
        g.addColorStop(0.45, rgba('#ff7a1a', a * 0.85));
        g.addColorStop(1, 'rgba(255,50,10,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  });
  // 火球から後方へ散る火の粉
  for (let i = 0; i < 20; i++) {
    const tAt = rand(0.05, 0.95);
    const side = rand(-1, 1);
    const size = rand(1.6, 3.0) * S;
    const col = pick(['#ffe9a0', '#ffb347', '#ff7a1a']);
    particles.push({
      delay: DAIMONJI_CHARGE_MS + tAt * DAIMONJI_FLY_MS,
      maxLife: rand(160, 260),
      blend: 'lighter',
      draw(ctx, t) {
        if (t >= 1) return;
        const base = lerp(mouth.x, to.x, tAt * 0.7 + 0.15);
        const baseY = lerp(mouth.y, to.y, tAt * 0.7 + 0.15);
        const x = base - ux * 30 * S * t + -uy * side * 14 * S;
        const y = baseY - uy * 30 * S * t + ux * side * 14 * S + t * 10 * S;
        ctx.fillStyle = rgba(col, (1 - t) * 0.9);
        ctx.beginPath();
        ctx.arc(x, y, size * (1 - t * 0.5), 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }

  // ---- 幕2：着弾の閃光（大の字が走り出す合図） ----
  particles.push({
    delay: DAIMONJI_HIT_MS,
    maxLife: 300,
    blend: 'lighter',
    draw(ctx, t) {
      const a = (1 - t) * 0.95;
      const r = lerp(10 * S, 74 * S, easeOutQuint(t));
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, rgba('#ffffff', a));
      g.addColorStop(0.3, rgba('#ffe9a0', a * 0.95));
      g.addColorStop(0.65, rgba('#ff7a1a', a * 0.7));
      g.addColorStop(1, 'rgba(255,50,10,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
    }
  });

  // ---- 幕2〜3：「大」の字の炎（4画をそれぞれ多層の火線として描く） ----
  // 各画を、太い赤→中間のオレンジ→細い白黄の3層でソフトブロブを並べて描き、
  // 火線の先端（描き進んでいる側）ほど明るく、根元ほど赤く落ち着く温度階調にする。
  const BODY_LAYERS = [
    { wMul: 1.00, aMul: 0.34, col0: '#ff7a1a', col1: '#ff2e0e' },
    { wMul: 0.66, aMul: 0.60, col0: '#ffd98a', col1: '#ff5a1a' },
    { wMul: 0.34, aMul: 0.90, col0: '#ffffff', col1: '#ffd98a' },
  ];
  STROKES.forEach((st, si) => {
    const seedA = rand(0, 100), seedB = rand(0, 100);
    const sx = st.x1 - st.x0, sy = st.y1 - st.y0;
    const sl = Math.hypot(sx, sy) || 1;
    const snx = -sy / sl, sny = sx / sl;    // 画に垂直な方向（揺らぎ用）
    particles.push({
      delay: DAIMONJI_HIT_MS,
      maxLife: DAIMONJI_END_MS - DAIMONJI_HIT_MS,
      blend: 'lighter',
      draw(ctx, t) {
        const ms = DAIMONJI_HIT_MS + t * (DAIMONJI_END_MS - DAIMONJI_HIT_MS);
        const k = daimonjiStrength(ms);
        if (k <= 0.02) return;
        const prog = strokeProgress(st, ms);
        if (prog <= 0) return;
        const time = ms / 1000;
        const N = 40;
        BODY_LAYERS.forEach((L, li) => {
          for (let i = 0; i < N; i++) {
            const kk = (i + 0.5) / N;
            if (kk > prog) break;
            const px = lerp(st.x0, st.x1, kk);
            const py = lerp(st.y0, st.y1, kk);
            // 火の揺らぎ：画に垂直方向にゆらゆら、時間で乱流
            const jit = noise1(kk * 6 + time * 9 + si * 5, seedA + li * 3) * st.w * 0.28;
            const x = px + snx * jit;
            const y = py + sny * jit - Math.abs(noise1(kk * 5 + time * 7, seedB + li)) * 4 * S;
            // 先端が明るい：描いている最中は先頭付近を強調。描き終えた後は全体が均一に燃える。
            const drawing = ms < DAIMONJI_HIT_MS + DAIMONJI_DRAW_MS + 60;
            const headBoost = drawing ? clamp01(1 - (prog - kk) * 3.2) : 0;
            const flick = 0.85 + Math.abs(noise1(kk * 8 + time * 12, seedB + li)) * 0.3;
            const size = st.w * L.wMul * (0.9 + Math.abs(noise1(kk * 6 + time * 10, seedA + li)) * 0.3)
                       * (0.8 + headBoost * 0.35);
            const a = k * L.aMul * flick * (0.72 + headBoost * 0.5) * 0.62;
            const g = ctx.createRadialGradient(x, y, 0, x, y, size);
            g.addColorStop(0, rgba(L.col0, a));
            g.addColorStop(0.42, rgba(L.col1, a * 0.85));
            g.addColorStop(1, 'rgba(255,60,0,0)');
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(x, y, size, 0, Math.PI * 2);
            ctx.fill();
          }
        });
      }
    });
  });

  // 大の字全体を包む、うっすらとした熱のオーラ（燃え盛りの間だけ）
  particles.push({
    delay: DAIMONJI_HIT_MS + DAIMONJI_DRAW_MS * 0.5,
    maxLife: DAIMONJI_END_MS - DAIMONJI_HIT_MS - DAIMONJI_DRAW_MS * 0.5,
    blend: 'lighter',
    draw(ctx, t) {
      const ms = DAIMONJI_HIT_MS + DAIMONJI_DRAW_MS * 0.5 + t * (DAIMONJI_END_MS - DAIMONJI_HIT_MS - DAIMONJI_DRAW_MS * 0.5);
      const k = daimonjiStrength(ms);
      if (k <= 0.02) return;
      const pulse = 0.85 + 0.15 * Math.sin(ms * 0.03);
      const r = K * 1.55 * pulse;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, rgba('#ff9a3a', k * 0.26));
      g.addColorStop(0.6, rgba('#ff5a1a', k * 0.14));
      g.addColorStop(1, 'rgba(255,40,10,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
    }
  });

  // 火線から立ち上る火の粉（燃焼中、各画の上から湧き上がる）
  for (let i = 0; i < 42; i++) {
    const st = STROKES[i % STROKES.length];
    const along = rand(0.05, 0.95);
    const startAt = DAIMONJI_HIT_MS + DAIMONJI_DRAW_MS * st.t0 + rand(0, DAIMONJI_DRAW_MS + DAIMONJI_BURN_MS - 60);
    const drift = rand(-14, 14) * S;
    const rise = rand(26, 66) * S;
    const size = rand(1.6, 3.4) * S;
    const col = pick(['#ffe9a0', '#ffb347', '#ff7a1a', '#ff4d2e']);
    const seed = rand(0, 100);
    particles.push({
      delay: startAt,
      maxLife: rand(300, 480),
      blend: 'lighter',
      draw(ctx, t) {
        if (t >= 1) return;
        const bx = lerp(st.x0, st.x1, along);
        const by = lerp(st.y0, st.y1, along);
        const e = easeOutCubic(t);
        const x = bx + drift * e + noise1(t * 5 + seed, seed) * 8 * S;
        const y = by - rise * e;
        const a = (1 - t) * 0.92;
        ctx.fillStyle = rgba(col, a);
        ctx.shadowColor = rgba('#ff9a3a', 0.9);
        ctx.shadowBlur = 6 * S;
        ctx.beginPath();
        ctx.arc(x, y, size * (1 - t * 0.45), 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }

  // ---- 幕4：大の字が爆ぜる（爆散の瞬間） ----
  particles.push({
    delay: DAIMONJI_BURST_MS,
    maxLife: 380,
    blend: 'lighter',
    draw(ctx, t) {
      const a = (1 - t) * 0.9;
      const r = lerp(14 * S, 92 * S, easeOutQuint(t));
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, rgba('#ffffff', a));
      g.addColorStop(0.28, rgba('#ffe9a0', a * 0.95));
      g.addColorStop(0.62, rgba('#ff7a1a', a * 0.7));
      g.addColorStop(1, 'rgba(255,50,10,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  for (let i = 0; i < 3; i++) {
    particles.push({
      delay: DAIMONJI_BURST_MS + i * 55,
      maxLife: 340 - i * 40,
      blend: 'lighter',
      draw(ctx, t) {
        const r = lerp(12 * S, R * (0.13 + i * 0.055), easeOutQuint(t));
        const a = (1 - t) * (0.8 - i * 0.15);
        ctx.strokeStyle = rgba(i === 0 ? '#ffe9a0' : '#ff7a1a', a);
        ctx.lineWidth = (6 - i) * (1 - t * 0.5);
        ctx.shadowColor = rgba('#ff9a3a', 0.9);
        ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
      }
    });
  }
  // 大の字の火線が砕けたように、線上から放射状に火の粒が弾ける
  for (let i = 0; i < 40; i++) {
    const st = STROKES[i % STROKES.length];
    const along = rand(0, 1);
    const ox = lerp(st.x0, st.x1, along);
    const oy = lerp(st.y0, st.y1, along);
    const ang = Math.atan2(oy - cy, ox - cx) + rand(-0.7, 0.7);
    const sp = rand(34, 130) * S;
    const sz = rand(2, 4.6) * S;
    const col = pick(['#ffe9a0', '#ffb347', '#ff4d2e']);
    const grav = rand(0.5, 1.2);
    const seed = rand(0, 100);
    particles.push({
      delay: DAIMONJI_BURST_MS + rand(0, 60),
      maxLife: rand(340, 560),
      blend: 'lighter',
      draw(ctx, t) {
        const e = easeOutCubic(t);
        const x = ox + Math.cos(ang) * sp * e;
        const y = oy + Math.sin(ang) * sp * e * 0.85 + grav * t * t * h * 0.06;
        const flick = 0.5 + Math.abs(noise1(t * 20 + seed, seed)) * 0.5;
        const a = (1 - t) * 0.95 * flick;
        ctx.fillStyle = rgba(col, a);
        ctx.shadowColor = rgba('#ff9a3a', 0.9);
        ctx.shadowBlur = 6 * S;
        ctx.beginPath();
        ctx.arc(x, y, sz * (1 - t * 0.5), 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }
  // 黒煙が立ち上る余韻
  for (let i = 0; i < 10; i++) {
    const ox = rand(-30, 30) * S;
    const oy = rand(-30, 30) * S;
    const size = rand(26, 46) * S;
    const seed = rand(0, 100);
    particles.push({
      delay: DAIMONJI_BURST_MS + 80 + rand(0, 200),
      maxLife: rand(500, 700),
      draw(ctx, t) {
        const rise = easeOutCubic(t);
        const x = cx + ox + noise1(t * 4 + seed, seed) * 16 * S;
        const y = cy + oy - rise * 42 * S;
        const a = (t < 0.15 ? t / 0.15 : (1 - Math.max(0, (t - 0.4) / 0.6))) * 0.4;
        const g = ctx.createRadialGradient(x, y, 0, x, y, size);
        g.addColorStop(0, rgba('#2a1812', a));
        g.addColorStop(1, 'rgba(20,12,10,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, size, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }
}

// ============================================================
// だいちのちから：相手の足元の地面が黄金色に発光してひび割れ、
// 地中から噴き上がる大地のエネルギーが相手を下から突き上げる演出。
// 原作の効果テキスト「相手の足下へ大地の力を放出する」を再現する。
// じしん（画面全体が揺れる広域演出）とは対照的に、相手の足元一点に
// 力を集中させる「局所噴出」が持ち味。
// 構成：①相手の足元に大地の力が集まり、じわりと黄金色に発光する（予兆）
//       ②足元の地面にクモの巣状の亀裂が走り、亀裂から光が漏れる
//       ③亀裂の中心から閃光と共に大地のエネルギーが噴き上がり、
//         相手を包むように土色〜黄金色の柱が突き上がる
//       ④岩の破片と土煙が四方へ弾け、相手の足元に地割れの跡が残る余韻
// 「足元中心の局所演出」「亀裂から漏れる黄金の光」「下から突き上げる噴出」がキモ。
//
// info = { from:{x,y}, to:{x,y}, scale }  ※ playSpecialTypeEffect が実測して渡す。
// ============================================================
const EARTHPOWER_OMEN_MS = 300;     // ①足元が発光し始める予兆
const EARTHPOWER_CRACK_MS = 260;    // ②地面に亀裂が走る
const EARTHPOWER_ERUPT_MS = 420;    // ③大地のエネルギーが噴き上がる
const EARTHPOWER_SETTLE_MS = 520;   // ④破片・土煙が収まる余韻
const EARTHPOWER_CRACK_START_MS = EARTHPOWER_OMEN_MS;
const EARTHPOWER_ERUPT_START_MS = EARTHPOWER_CRACK_START_MS + EARTHPOWER_CRACK_MS;
const EARTHPOWER_SETTLE_START_MS = EARTHPOWER_ERUPT_START_MS + EARTHPOWER_ERUPT_MS;
const EARTHPOWER_END_MS = EARTHPOWER_SETTLE_START_MS + EARTHPOWER_SETTLE_MS + 200;
// 「着弾」＝大地のエネルギーが噴き上がって相手にダメージが入る体感タイミング
const EARTHPOWER_HIT_MS = EARTHPOWER_ERUPT_START_MS;

function spawnEarthPowerSpecial(particles, w, h, info) {
  const to = (info && info.to) || { x: w * 0.7, y: h * 0.72 };
  const S = (info && info.scale) || 1;
  // 相手の足元＝スプライト中心よりやや下。じしんの土色パレットと合わせつつ、
  // だいちのちから特有の黄金〜橙のエネルギー色を主役にする。
  const gx = to.x, gy = to.y + 26 * S;
  const R = Math.max(w, h);

  // ---- ①予兆：足元の地面がじわりと黄土色に発光する ----
  particles.push({
    maxLife: EARTHPOWER_OMEN_MS + 60,
    blend: 'lighter',
    draw(ctx, t) {
      const e = easeOutCubic(t);
      const a = Math.sin(Math.PI * clamp01(t)) * 0.5;
      const rx = lerp(10 * S, 46 * S, e);
      const g = ctx.createRadialGradient(gx, gy, 0, gx, gy, rx);
      g.addColorStop(0, rgba('#ffe28a', a));
      g.addColorStop(0.5, rgba('#d9a53c', a * 0.7));
      g.addColorStop(1, 'rgba(120,80,20,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(gx, gy, rx, rx * 0.4, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  // 予兆中、足元から立ち上る小さな土の粒（地中で何かが蠢く気配）
  for (let i = 0; i < 10; i++) {
    const a0 = rand(0, Math.PI * 2);
    const r0 = rand(8, 30) * S;
    const seed = rand(0, 100);
    particles.push({
      delay: rand(40, EARTHPOWER_OMEN_MS - 40),
      maxLife: rand(140, 220),
      blend: 'lighter',
      draw(ctx, t) {
        if (t >= 1) return;
        const rr = r0 * (1 - easeInCubic(t) * 0.6);
        const x = gx + Math.cos(a0) * rr;
        const y = gy + Math.sin(a0) * rr * 0.4 - t * 10 * S;
        const a = clamp01(t * 4) * (1 - Math.max(0, (t - 0.7) / 0.3));
        const size = (2 + Math.abs(noise1(t * 8, seed))) * S;
        ctx.fillStyle = rgba('#d9a53c', a * 0.8);
        ctx.beginPath();
        ctx.arc(x, y, size, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }

  // ---- ②地面にクモの巣状の亀裂が走る ----
  // 中心(gx,gy)から放射状に亀裂を伸ばし、さらに同心円状の亀裂で繋いで
  // 「クモの巣」らしいネットワーク構造にする。
  const CRACK_N = 8;
  const crackPaths = [];
  for (let i = 0; i < CRACK_N; i++) {
    const ang = (i / CRACK_N) * Math.PI * 2 + rand(-0.15, 0.15);
    const len = rand(38, 62) * S;
    const segs = 5;
    const path = [[gx, gy]];
    let cx = gx, cy = gy;
    for (let s = 1; s <= segs; s++) {
      const k = s / segs;
      cx = gx + Math.cos(ang) * len * k + rand(-4, 4) * S;
      cy = gy + Math.sin(ang) * len * k * 0.55 + rand(-3, 3) * S;   // 縦を潰して足元の地面らしい楕円状に
      path.push([cx, cy]);
    }
    crackPaths.push(path);
    particles.push({
      delay: EARTHPOWER_CRACK_START_MS + rand(0, 100),
      maxLife: EARTHPOWER_END_MS - EARTHPOWER_CRACK_START_MS,
      path,
      draw(ctx, t) {
        const ms = t * this.maxLife;
        const grow = clamp01(ms / 220);
        const cut = Math.max(2, Math.floor(this.path.length * easeOutCubic(grow)));
        // 亀裂が走った後は、噴出フェーズの間ずっと明るく発光し続け、余韻でゆっくり消える
        const eruptStart = EARTHPOWER_ERUPT_START_MS - EARTHPOWER_CRACK_START_MS;
        const settleStart = EARTHPOWER_SETTLE_START_MS - EARTHPOWER_CRACK_START_MS;
        let glow;
        if (ms < eruptStart) glow = 0.5;
        else if (ms < settleStart) glow = 1;
        else glow = Math.max(0, 1 - (ms - settleStart) / (EARTHPOWER_SETTLE_MS + 200));
        ctx.save();
        ctx.strokeStyle = rgba('#3a2510', 0.85);
        ctx.lineWidth = 3.5 * S;
        ctx.lineJoin = 'round';
        ctx.beginPath();
        this.path.slice(0, cut).forEach(([px, py], k) => k === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py));
        ctx.stroke();
        ctx.strokeStyle = rgba('#ffcf5a', glow * 0.9);
        ctx.lineWidth = 1.6 * S;
        ctx.shadowColor = rgba('#ffcf5a', 0.9);
        ctx.shadowBlur = 8 * S * glow;
        ctx.beginPath();
        this.path.slice(0, cut).forEach(([px, py], k) => k === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py));
        ctx.stroke();
        ctx.restore();
      }
    });
  }
  // 亀裂同士を繋ぐ同心円状の割れ目（クモの巣の横糸）
  for (let ring = 0; ring < 2; ring++) {
    const rr = (26 + ring * 20) * S;
    particles.push({
      delay: EARTHPOWER_CRACK_START_MS + 80 + ring * 60,
      maxLife: EARTHPOWER_END_MS - EARTHPOWER_CRACK_START_MS - 80 - ring * 60,
      draw(ctx, t) {
        const ms = t * this.maxLife;
        const grow = easeOutCubic(clamp01(ms / 200));
        const eruptStart = EARTHPOWER_ERUPT_START_MS - EARTHPOWER_CRACK_START_MS - 80 - ring * 60;
        const settleStart = EARTHPOWER_SETTLE_START_MS - EARTHPOWER_CRACK_START_MS - 80 - ring * 60;
        let glow;
        if (ms < eruptStart) glow = 0.4;
        else if (ms < settleStart) glow = 0.9;
        else glow = Math.max(0, 0.9 - (ms - settleStart) / (EARTHPOWER_SETTLE_MS + 200));
        ctx.save();
        ctx.strokeStyle = rgba('#4a3016', 0.6);
        ctx.lineWidth = 2 * S;
        ctx.beginPath();
        ctx.ellipse(gx, gy, rr * grow, rr * grow * 0.42, 0, 0, Math.PI * 2 * grow);
        ctx.stroke();
        ctx.strokeStyle = rgba('#ffcf5a', glow * 0.5);
        ctx.lineWidth = 1 * S;
        ctx.beginPath();
        ctx.ellipse(gx, gy, rr * grow, rr * grow * 0.42, 0, 0, Math.PI * 2 * grow);
        ctx.stroke();
        ctx.restore();
      }
    });
  }

  // ---- ③大地のエネルギーが噴き上がる：着弾の閃光 ----
  particles.push({
    delay: EARTHPOWER_HIT_MS,
    maxLife: 340,
    blend: 'lighter',
    draw(ctx, t) {
      const a = (1 - t) * 0.9;
      const r = lerp(10 * S, 70 * S, easeOutQuint(t));
      const g = ctx.createRadialGradient(gx, gy, 0, gx, gy, r);
      g.addColorStop(0, rgba('#fff6d0', a));
      g.addColorStop(0.3, rgba('#ffcf5a', a * 0.95));
      g.addColorStop(0.65, rgba('#c8781e', a * 0.7));
      g.addColorStop(1, 'rgba(140,80,20,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(gx, gy, r, r * 0.55, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  });

  // 複数の光る土柱が、相手の足元を囲むように時間差で噴き上がる
  const PILLAR_N = 8;
  for (let i = 0; i < PILLAR_N; i++) {
    const ang = (i / PILLAR_N) * Math.PI * 2 + rand(-0.2, 0.2);
    const orbitR = rand(14, 36) * S;
    const px0 = gx + Math.cos(ang) * orbitR;
    const py0 = gy + Math.sin(ang) * orbitR * 0.45;
    const height = rand(66, 108) * S;
    const width = rand(10, 17) * S;
    const delay = EARTHPOWER_ERUPT_START_MS + rand(0, 160);
    particles.push({
      delay,
      maxLife: EARTHPOWER_ERUPT_MS + 220,
      blend: 'lighter',
      draw(ctx, t) {
        const rise = easeOutQuint(clamp01(t / 0.45));
        const settle = t > 0.55 ? Math.sin((t - 0.55) / 0.45 * Math.PI) * 3 * S : 0;
        const h0 = height * rise;
        const alpha = 1 - Math.max(0, (t - 0.68) / 0.32);
        const gtop = py0 - h0;
        ctx.save();
        ctx.translate(settle, 0);
        // 土色の柱本体
        const grad = ctx.createLinearGradient(px0 - width / 2, 0, px0 + width / 2, 0);
        grad.addColorStop(0, rgba('#5c3f1e', alpha * 0.9));
        grad.addColorStop(0.5, rgba('#c8781e', alpha));
        grad.addColorStop(1, rgba('#5c3f1e', alpha * 0.9));
        ctx.fillStyle = grad;
        ctx.fillRect(px0 - width / 2, gtop, width, h0 + 16 * S);
        // 内側の黄金の発光コア
        const coreGrad = ctx.createLinearGradient(px0 - width * 0.3, 0, px0 + width * 0.3, 0);
        coreGrad.addColorStop(0, 'rgba(255,207,90,0)');
        coreGrad.addColorStop(0.5, rgba('#ffe28a', alpha * 0.9));
        coreGrad.addColorStop(1, 'rgba(255,207,90,0)');
        ctx.fillStyle = coreGrad;
        ctx.fillRect(px0 - width * 0.3, gtop, width * 0.6, h0 + 12 * S);
        // 頂部の光る破片ハイライト
        ctx.fillStyle = rgba('#fff6d0', alpha);
        ctx.beginPath();
        ctx.moveTo(px0 - width / 2, gtop);
        ctx.lineTo(px0, gtop - 12 * S * rise);
        ctx.lineTo(px0 + width / 2, gtop);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    });
    // 各柱の根元から砂煙が弾ける
    particles.push({
      delay,
      maxLife: 300,
      blend: 'lighter',
      draw(ctx, t) {
        const alpha = (1 - t) * 0.6;
        const r = lerp(4 * S, 22 * S, easeOutCubic(t));
        const g = ctx.createRadialGradient(px0, py0, 0, px0, py0, r);
        g.addColorStop(0, rgba('#ffcf5a', alpha));
        g.addColorStop(1, 'rgba(160,120,60,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.ellipse(px0, py0, r, r * 0.4, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }

  // 噴出中、亀裂の隙間から次々と光の粒が吹き上がる
  for (let i = 0; i < 30; i++) {
    const ang = rand(0, Math.PI * 2);
    const r0 = rand(6, 40) * S;
    const riseH = rand(30, 78) * S;
    const size = rand(1.8, 3.6) * S;
    const col = pick(['#ffe28a', '#ffcf5a', '#d9a53c']);
    const seed = rand(0, 100);
    particles.push({
      delay: EARTHPOWER_ERUPT_START_MS + rand(0, EARTHPOWER_ERUPT_MS - 60),
      maxLife: rand(280, 440),
      blend: 'lighter',
      draw(ctx, t) {
        if (t >= 1) return;
        const e = easeOutCubic(t);
        const x = gx + Math.cos(ang) * r0 + noise1(t * 6 + seed, seed) * 6 * S;
        const y = gy + Math.sin(ang) * r0 * 0.45 - riseH * e;
        const a = (1 - t) * 0.9;
        ctx.fillStyle = rgba(col, a);
        ctx.shadowColor = rgba('#ffcf5a', 0.9);
        ctx.shadowBlur = 6 * S;
        ctx.beginPath();
        ctx.arc(x, y, size * (1 - t * 0.4), 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }

  // ---- ④余韻：岩の破片が四方へ弾け、土煙が舞ってからゆっくり収まる ----
  for (let i = 0; i < 26; i++) {
    const ang = rand(0, Math.PI * 2);
    const sp = rand(30, 100) * S;
    const sz = rand(2, 5) * S;
    const col = pick(['#8a6530', '#c79a5b', '#5c3f1e', '#ffcf5a']);
    const grav = rand(0.6, 1.3);
    const rot0 = rand(0, Math.PI * 2);
    particles.push({
      delay: EARTHPOWER_ERUPT_START_MS + 60 + rand(0, 220),
      maxLife: rand(360, 580),
      draw(ctx, t) {
        const e = easeOutCubic(t);
        const x = gx + Math.cos(ang) * sp * e;
        const y = gy + Math.sin(ang) * sp * e * 0.5 - sp * 0.25 * e * (1 - e) + grav * t * t * h * 0.05;
        const a = (1 - t) * 0.95;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(rot0 + t * 5);
        ctx.fillStyle = rgba(col, a);
        ctx.fillRect(-sz / 2, -sz / 2, sz, sz);
        ctx.restore();
      }
    });
  }
  // 土煙が舞い上がって薄れていく余韻
  for (let i = 0; i < 8; i++) {
    const ox = rand(-30, 30) * S;
    const oy = rand(-10, 10) * S;
    const size = rand(24, 42) * S;
    const seed = rand(0, 100);
    particles.push({
      delay: EARTHPOWER_SETTLE_START_MS - 60 + rand(0, 160),
      maxLife: rand(460, 640),
      draw(ctx, t) {
        const rise = easeOutCubic(t);
        const x = gx + ox + noise1(t * 4 + seed, seed) * 14 * S;
        const y = gy + oy - rise * 30 * S;
        const a = (t < 0.15 ? t / 0.15 : (1 - Math.max(0, (t - 0.4) / 0.6))) * 0.38;
        const g = ctx.createRadialGradient(x, y, 0, x, y, size);
        g.addColorStop(0, rgba('#8a6530', a));
        g.addColorStop(1, 'rgba(90,65,30,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, size, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }
  // 地割れの跡（最後まで残るうっすらとした裂け目のシルエット）
  particles.push({
    delay: EARTHPOWER_SETTLE_START_MS,
    maxLife: EARTHPOWER_END_MS - EARTHPOWER_SETTLE_START_MS,
    draw(ctx, t) {
      const a = (1 - t) * 0.35;
      ctx.save();
      ctx.strokeStyle = rgba('#3a2510', a);
      ctx.lineWidth = 2 * S;
      crackPaths.forEach((path) => {
        ctx.beginPath();
        path.forEach(([px, py], k) => k === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py));
        ctx.stroke();
      });
      ctx.restore();
    }
  });
}

// ============================================================
// ルクシオンエア（オリジナル・でんきタイプ、りゅうせいぐんのでんき版）
// 相手を包み込む「雷を帯びた竜巻」が荒れ狂う、りゅうせいぐんに匹敵する大技演出。
// 構成：①空が紫がかった黒雲に覆われ、稲妻が奥で明滅する（暗雲の予兆）
//       ②自分の足元から放電が立ち上り、周囲の空気を吸い込みながら帯電していく（チャージ）
//       ③相手の足元から黄色い竜巻が巻き起こり、渦を巻きながら相手を包み込むように立ち上がる
//       ④竜巻の内部を無数のジグザグ稲妻が駆け巡り、外周にも放電の輪が纏わりつく（本体：竜巻＋雷）
//       ⑤竜巻が収束すると同時に中心で巨大な放電が爆発し、閃光と衝撃波が全方位に走る
//       ⑥余韻：静電気の火花と千切れた暗雲の残骸が舞って消える
// りゅうせいぐん（複数幕・多層グラデーション・派手な大爆発）の構成密度を踏襲しつつ、
// 10まんボルトのジグザグ稲妻（drawBolt）を竜巻内部で多数走らせて「電気を帯びた竜巻」にする。
// 配色は 黄〜白（電撃の芯）× 紫がかった暗雲・風（竜巻の外殻）のコントラストで統一する。
//
// info = { from:{x,y}, to:{x,y}, scale }  ※ playSpecialTypeEffect が実測して渡す。
// ============================================================
const LUXIONAIR_OMEN_MS = 340;        // ①暗雲が立ち込め、奥で稲妻が明滅する予兆
const LUXIONAIR_CHARGE_MS = 340;      // ②自分の足元が帯電し、風を吸い込み始める
const LUXIONAIR_FORM_MS = 360;        // ③相手の足元から竜巻が巻き起こり立ち上がる
const LUXIONAIR_RAGE_MS = 620;        // ④竜巻の中で雷が荒れ狂う本体フェーズ
const LUXIONAIR_BURST_MS = 460;       // ⑤収束と同時に中心で大放電が爆発
const LUXIONAIR_SETTLE_MS = 520;      // ⑥静電気の火花・暗雲の残骸が舞う余韻

const LUXIONAIR_CHARGE_START_MS = LUXIONAIR_OMEN_MS;
const LUXIONAIR_FORM_START_MS = LUXIONAIR_CHARGE_START_MS + LUXIONAIR_CHARGE_MS;
const LUXIONAIR_RAGE_START_MS = LUXIONAIR_FORM_START_MS + LUXIONAIR_FORM_MS;
const LUXIONAIR_BURST_START_MS = LUXIONAIR_RAGE_START_MS + LUXIONAIR_RAGE_MS;
const LUXIONAIR_SETTLE_START_MS = LUXIONAIR_BURST_START_MS + LUXIONAIR_BURST_MS;
const LUXIONAIR_END_MS = LUXIONAIR_SETTLE_START_MS + LUXIONAIR_SETTLE_MS + 200;
// 「着弾」＝竜巻が相手を完全に包み、ダメージが入る体感タイミング
const LUXIONAIR_HIT_MS = LUXIONAIR_FORM_START_MS;

function spawnLuxionAirSpecial(particles, w, h, info) {
  const from = (info && info.from) || { x: w * 0.28, y: h * 0.68 };
  const to = (info && info.to) || { x: w * 0.72, y: h * 0.32 };
  const S = (info && info.scale) || 1;
  const R = Math.max(w, h);
  const dx = to.x - from.x, dy = to.y - from.y;
  const dist = Math.hypot(dx, dy) || 1;
  const nx = -dy / dist, ny = dx / dist;

  const tx = to.x, ty = to.y;                 // 竜巻の中心＝相手の位置
  const groundY = ty + 30 * S;                 // 竜巻の足元
  const TOP_Y = ty - 78 * S;                   // 竜巻の頭頂
  const TWIST_H = groundY - TOP_Y;             // 竜巻の全高

  // ---- ジグザグ稲妻ヘルパー（10まんボルトのdrawBoltを踏襲。芯＋発光＋枝分かれ）----
  function drawBolt(ctx, p0, p1, seed, alpha, coreColor, glowColor, widthScale, withBranches) {
    const segs = 8;
    const pts = [p0];
    for (let i = 1; i < segs; i++) {
      const t = i / segs;
      const bx = lerp(p0.x, p1.x, t);
      const by = lerp(p0.y, p1.y, t);
      const wob = noise1(t * 9 + seed, seed) * (1 - Math.abs(t - 0.5) * 1.1) * 20 * S;
      const perpx = -(p1.y - p0.y), perpy = (p1.x - p0.x);
      const pl = Math.hypot(perpx, perpy) || 1;
      pts.push({ x: bx + (perpx / pl) * wob, y: by + (perpy / pl) * wob });
    }
    pts.push(p1);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = rgba(glowColor, alpha * 0.55);
    ctx.lineWidth = 7 * widthScale * S;
    ctx.shadowColor = rgba(glowColor, 0.9);
    ctx.shadowBlur = 14 * S;
    ctx.beginPath();
    pts.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
    ctx.stroke();
    ctx.strokeStyle = rgba(coreColor, alpha);
    ctx.lineWidth = 2.4 * widthScale * S;
    ctx.shadowBlur = 7 * S;
    ctx.beginPath();
    pts.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
    ctx.stroke();
    if (withBranches) {
      for (let i = 2; i < pts.length - 1; i += 2) {
        const bp = pts[i];
        const ang = Math.atan2(pts[i + 1].y - pts[i - 1].y, pts[i + 1].x - pts[i - 1].x) + (i % 4 === 0 ? 1.1 : -1.1);
        const len = rand(8, 18) * S;
        ctx.lineWidth = 1.2 * widthScale * S;
        ctx.strokeStyle = rgba(coreColor, alpha * 0.7);
        ctx.beginPath();
        ctx.moveTo(bp.x, bp.y);
        ctx.lineTo(bp.x + Math.cos(ang) * len, bp.y + Math.sin(ang) * len);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  // ---- 幕0：空が紫がかった暗雲に覆われ、奥で稲妻が明滅する（暗雲の予兆）----
  particles.push({
    maxLife: LUXIONAIR_END_MS,
    draw(ctx, t) {
      const a = t < 0.05 ? t / 0.05 : (t > 0.88 ? Math.max(0, 1 - (t - 0.88) / 0.12) : 1);
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, rgba('#0c0a1a', a * 0.72));
      grad.addColorStop(0.55, rgba('#181228', a * 0.5));
      grad.addColorStop(1, rgba('#241a30', a * 0.28));
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
    }
  });
  // 遠雷（画面奥で明滅する紫がかった閃光。竜巻本体とは無関係に散発的に光る）
  for (let i = 0; i < 5; i++) {
    const fx = rand(w * 0.1, w * 0.9), fy = rand(h * 0.05, h * 0.35);
    particles.push({
      delay: rand(0, LUXIONAIR_RAGE_START_MS + LUXIONAIR_RAGE_MS),
      maxLife: rand(90, 160),
      blend: 'lighter',
      draw(ctx, t) {
        const a = Math.sin(Math.PI * t) * 0.35;
        const g = ctx.createRadialGradient(fx, fy, 0, fx, fy, w * 0.22);
        g.addColorStop(0, rgba('#c9a8ff', a));
        g.addColorStop(1, 'rgba(160,120,255,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(fx, fy, w * 0.22, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }

  // ---- 幕1：自分の足元が帯電し、風を吸い込み始める（チャージ）----
  particles.push({
    delay: LUXIONAIR_CHARGE_START_MS,
    maxLife: LUXIONAIR_CHARGE_MS + 80,
    blend: 'lighter',
    draw(ctx, t) {
      if (t >= 1) return;
      const pulse = 0.7 + Math.abs(noise1(t * 12, 5)) * 0.3;
      const a = Math.sin(Math.PI * clamp01(t * 1.1)) * 0.6 * pulse;
      const r = lerp(12 * S, 44 * S, easeOutCubic(t));
      const g = ctx.createRadialGradient(from.x, from.y, 0, from.x, from.y, r);
      g.addColorStop(0, rgba('#ffffff', a * 0.8));
      g.addColorStop(0.4, rgba('#fff066', a * 0.7));
      g.addColorStop(0.8, rgba('#ffd23f', a * 0.3));
      g.addColorStop(1, 'rgba(255,210,63,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(from.x, from.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  // 自分から相手へ、風とともに吸い寄せられていく電光の粒（竜巻を呼び寄せる予備動作）
  for (let i = 0; i < 22; i++) {
    const t0 = rand(0, LUXIONAIR_CHARGE_MS - 40);
    const sideOff = rand(-1, 1);
    const seed = rand(0, 100);
    particles.push({
      delay: LUXIONAIR_CHARGE_START_MS + t0,
      maxLife: LUXIONAIR_CHARGE_MS - t0 + 60,
      blend: 'lighter',
      draw(ctx, t) {
        const e = easeInCubic(t);
        const x = lerp(from.x, tx, e) + nx * sideOff * 22 * S * (1 - e);
        const y = lerp(from.y, ty, e) + ny * sideOff * 22 * S * (1 - e);
        const a = clamp01(t * 3) * (1 - Math.max(0, (t - 0.8) / 0.2)) * 0.85;
        const size = (1.8 + Math.abs(noise1(t * 8, seed)) * 1.6) * S;
        ctx.fillStyle = rgba('#fff9c4', a);
        ctx.shadowColor = rgba('#ffe066', 0.9);
        ctx.shadowBlur = 6 * S;
        ctx.beginPath();
        ctx.arc(x, y, size, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }

  // ---- 竜巻の輪郭を高さkごとに描くヘルパー ----
  // k=0(足元)〜1(頭頂)。時間で回転・膨張し、下は太く上はすぼまる典型的な竜巻シルエット。
  function twistRadius(k, growth) {
    const base = (34 + 14 * Math.sin(k * Math.PI * 0.9)) * S * growth;
    return base * (1 - k * 0.35);
  }

  // ---- 幕2：相手の足元から竜巻が巻き起こり、渦を巻きながら立ち上がる ----
  const twistSeedA = rand(0, 100), twistSeedB = rand(0, 100);
  particles.push({
    delay: LUXIONAIR_FORM_START_MS,
    maxLife: LUXIONAIR_END_MS - LUXIONAIR_FORM_START_MS,
    blend: 'lighter',
    draw(ctx, t) {
      const ms = LUXIONAIR_FORM_START_MS + t * (LUXIONAIR_END_MS - LUXIONAIR_FORM_START_MS);
      // 竜巻の存在強度：形成で立ち上がり、暴れフェーズで最大、収束フェーズで縮んで消える
      let growth, heightK;
      if (ms < LUXIONAIR_RAGE_START_MS) {
        const f = clamp01((ms - LUXIONAIR_FORM_START_MS) / LUXIONAIR_FORM_MS);
        growth = easeOutCubic(f);
        heightK = easeOutCubic(f);
      } else if (ms < LUXIONAIR_BURST_START_MS) {
        growth = 1; heightK = 1;
      } else if (ms < LUXIONAIR_SETTLE_START_MS) {
        const f = clamp01((ms - LUXIONAIR_BURST_START_MS) / LUXIONAIR_BURST_MS);
        growth = 1 - easeInCubic(f) * 0.85;
        heightK = 1 - easeInCubic(f) * 0.3;
      } else return;
      if (growth <= 0.02) return;
      const time = ms / 1000;
      const rings = 26;
      for (let i = 0; i < rings; i++) {
        const k = (i / rings) * heightK;
        const r = twistRadius(k, growth);
        if (r <= 0.5) continue;
        const cy = groundY - TWIST_H * k;
        const spin = time * (5.5 - k * 2.2) + k * 8 + twistSeedA;
        const wob = noise1(k * 6 + time * 4, twistSeedB) * 6 * S * growth;
        // 竜巻の帯（横に潰した楕円を回転位相で明滅させ、渦巻く風の層に見せる）
        const bandA = (0.30 + 0.16 * Math.abs(Math.sin(spin))) * growth;
        const g = ctx.createRadialGradient(tx + wob, cy, 0, tx + wob, cy, r);
        g.addColorStop(0, 'rgba(120,90,180,0)');
        g.addColorStop(0.55, rgba('#a08cf0', bandA * 0.7));
        g.addColorStop(1, rgba('#5a4a8a', bandA));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.ellipse(tx + wob, cy, r, r * 0.34, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  });
  // 竜巻の外殻を這う、風の縦筋（螺旋状に上へ流れる線）
  for (let i = 0; i < 14; i++) {
    const phase0 = rand(0, Math.PI * 2);
    const seed = rand(0, 100);
    particles.push({
      delay: LUXIONAIR_FORM_START_MS + rand(0, 80),
      maxLife: LUXIONAIR_END_MS - LUXIONAIR_FORM_START_MS,
      blend: 'lighter',
      draw(ctx, t) {
        const ms = LUXIONAIR_FORM_START_MS + t * (LUXIONAIR_END_MS - LUXIONAIR_FORM_START_MS);
        let growth, heightK;
        if (ms < LUXIONAIR_RAGE_START_MS) {
          const f = clamp01((ms - LUXIONAIR_FORM_START_MS) / LUXIONAIR_FORM_MS);
          growth = easeOutCubic(f); heightK = easeOutCubic(f);
        } else if (ms < LUXIONAIR_BURST_START_MS) {
          growth = 1; heightK = 1;
        } else if (ms < LUXIONAIR_SETTLE_START_MS) {
          const f = clamp01((ms - LUXIONAIR_BURST_START_MS) / LUXIONAIR_BURST_MS);
          growth = 1 - easeInCubic(f) * 0.85; heightK = 1 - easeInCubic(f) * 0.3;
        } else return;
        if (growth <= 0.02) return;
        const time = ms / 1000;
        const steps = 16;
        ctx.strokeStyle = rgba('#c9baff', 0.62 * growth);
        ctx.lineWidth = 2 * S;
        ctx.shadowColor = rgba('#c9baff', 0.8);
        ctx.shadowBlur = 6 * S;
        ctx.beginPath();
        for (let s = 0; s <= steps; s++) {
          const k = (s / steps) * heightK;
          const r = twistRadius(k, growth) * 0.92;
          const spin = time * (5.5 - k * 2.2) + k * 8 + phase0;
          const px = tx + Math.cos(spin) * r;
          const py = groundY - TWIST_H * k;
          if (s === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.stroke();
      }
    });
  }

  // ---- 幕3：竜巻の内部を無数のジグザグ稲妻が駆け巡る（本体：竜巻＋雷）----
  const boltCount = 16;
  for (let i = 0; i < boltCount; i++) {
    const k = i / (boltCount - 1);
    const delay = LUXIONAIR_RAGE_START_MS + k * LUXIONAIR_RAGE_MS * 0.85 + rand(-20, 20);
    const seed = rand(0, 100);
    const k0 = rand(0.05, 0.5), k1 = rand(0.45, 0.95);
    const ang0 = rand(0, Math.PI * 2), ang1 = ang0 + rand(-2.4, 2.4);
    particles.push({
      delay,
      maxLife: 130,
      blend: 'lighter',
      draw(ctx, t) {
        const alpha = t < 0.4 ? 1 : (1 - (t - 0.4) / 0.6);
        const r0 = twistRadius(k0, 1) * 0.85;
        const r1 = twistRadius(k1, 1) * 0.85;
        const p0 = { x: tx + Math.cos(ang0) * r0, y: groundY - TWIST_H * k0 };
        const p1 = { x: tx + Math.cos(ang1) * r1, y: groundY - TWIST_H * k1 };
        drawBolt(ctx, p0, p1, seed, alpha, '#fffde0', '#ffe066', 0.85, true);
      }
    });
  }
  // 竜巻を貫くように、中心軸へ向かって時折り太い縦稲妻が落ちる（暴れの強調）
  for (let i = 0; i < 4; i++) {
    const delay = LUXIONAIR_RAGE_START_MS + 90 + i * (LUXIONAIR_RAGE_MS - 120) / 4 + rand(-15, 15);
    const seed = rand(0, 100);
    particles.push({
      delay,
      maxLife: 160,
      blend: 'lighter',
      draw(ctx, t) {
        const alpha = t < 0.3 ? 1 : (1 - (t - 0.3) / 0.7);
        const p0 = { x: tx + rand(-6, 6) * S, y: TOP_Y };
        const p1 = { x: tx, y: groundY };
        drawBolt(ctx, p0, p1, seed, alpha, '#ffffff', '#fff066', 1.5, true);
      }
    });
  }
  // 竜巻の頭頂で明滅する紫〜白のコロナ（電気を帯びた風の圧力）
  particles.push({
    delay: LUXIONAIR_RAGE_START_MS,
    maxLife: LUXIONAIR_RAGE_MS + 100,
    blend: 'lighter',
    draw(ctx, t) {
      if (t >= 1) return;
      const flick = 0.6 + Math.abs(noise1(t * 16, 9)) * 0.4;
      const a = flick * 0.5;
      const r = 30 * S;
      const g = ctx.createRadialGradient(tx, TOP_Y, 0, tx, TOP_Y, r);
      g.addColorStop(0, rgba('#fff9c4', a));
      g.addColorStop(0.5, rgba('#c9a8ff', a * 0.6));
      g.addColorStop(1, 'rgba(160,120,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(tx, TOP_Y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  });

  // ---- 幕4：竜巻が収束すると同時に中心で巨大な放電が爆発 ----
  particles.push({
    delay: LUXIONAIR_BURST_START_MS,
    maxLife: 260,
    blend: 'lighter',
    draw(ctx, t) {
      const a = (1 - t) * 0.95;
      const r = lerp(10 * S, 80 * S, easeOutQuint(t));
      const g = ctx.createRadialGradient(tx, ty, 0, tx, ty, r);
      g.addColorStop(0, rgba('#ffffff', a));
      g.addColorStop(0.3, rgba('#fff066', a * 0.95));
      g.addColorStop(0.65, rgba('#c9a8ff', a * 0.6));
      g.addColorStop(1, 'rgba(160,120,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(tx, ty, r, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  // 多重の衝撃波（黄・白・紫の電撃らしいコントラスト）
  for (let i = 0; i < 4; i++) {
    const col = ['#ffffff', '#fff066', '#c9a8ff', '#8a6fd6'][i];
    particles.push({
      delay: LUXIONAIR_BURST_START_MS + i * 50,
      maxLife: 460 - i * 36,
      blend: 'lighter',
      draw(ctx, t) {
        const r = lerp(6 * S, R * (0.32 + i * 0.1), easeOutQuint(t));
        ctx.strokeStyle = rgba(col, (1 - t) * (0.85 - i * 0.13));
        ctx.lineWidth = (7 - i * 1.2) * (1 - t * 0.5) * S;
        ctx.shadowColor = rgba(col, 0.9);
        ctx.shadowBlur = 16 * S;
        ctx.beginPath();
        ctx.arc(tx, ty, r, 0, Math.PI * 2);
        ctx.stroke();
      }
    });
  }
  // 放射状に走る太い稲妻（爆発の瞬間、全方位へ電撃が走り抜ける）
  for (let i = 0; i < 8; i++) {
    const ang = (i / 8) * Math.PI * 2 + rand(-0.2, 0.2);
    const len = rand(60, 110) * S;
    const seed = rand(0, 100);
    particles.push({
      delay: LUXIONAIR_BURST_START_MS + rand(0, 40),
      maxLife: 200,
      blend: 'lighter',
      draw(ctx, t) {
        const alpha = t < 0.35 ? 1 : (1 - (t - 0.35) / 0.65);
        const e = easeOutQuint(clamp01(t / 0.4 + 0.3));
        const p0 = { x: tx, y: ty };
        const p1 = { x: tx + Math.cos(ang) * len * e, y: ty + Math.sin(ang) * len * e };
        drawBolt(ctx, p0, p1, seed, alpha, '#fffde0', '#ffe066', 1, false);
      }
    });
  }

  // ---- 幕5：静電気の火花と千切れた暗雲の残骸が舞う余韻 ----
  for (let i = 0; i < 26; i++) {
    const ang = rand(0, Math.PI * 2);
    const sp = rand(30, 100) * S;
    const sz = rand(1.6, 3.4) * S;
    const col = pick(['#fff9c4', '#fff066', '#c9a8ff']);
    const grav = rand(0.4, 1.0);
    const seed = rand(0, 100);
    particles.push({
      delay: LUXIONAIR_BURST_START_MS + 60 + rand(0, 240),
      maxLife: rand(340, 560),
      blend: 'lighter',
      draw(ctx, t) {
        const e = easeOutCubic(t);
        const flick = 0.5 + Math.abs(noise1(t * 20 + seed, seed)) * 0.5;
        const x = tx + Math.cos(ang) * sp * e;
        const y = ty + Math.sin(ang) * sp * e * 0.7 + grav * t * t * h * 0.05;
        const a = (1 - t) * 0.9 * flick;
        ctx.fillStyle = rgba(col, a);
        ctx.shadowColor = rgba('#ffe066', 0.9);
        ctx.shadowBlur = 6 * S;
        ctx.beginPath();
        ctx.arc(x, y, sz * (1 - t * 0.4), 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }
  // 千切れて薄れていく暗雲の残骸（紫がかった靄）
  for (let i = 0; i < 8; i++) {
    const ox = rand(-34, 34) * S;
    const oy = rand(-40, -10) * S;
    const size = rand(24, 44) * S;
    const seed = rand(0, 100);
    particles.push({
      delay: LUXIONAIR_SETTLE_START_MS - 40 + rand(0, 160),
      maxLife: rand(420, 600),
      draw(ctx, t) {
        const drift = easeOutCubic(t);
        const x = tx + ox + noise1(t * 4 + seed, seed) * 14 * S;
        const y = ty + oy - drift * 26 * S;
        const a = (t < 0.15 ? t / 0.15 : (1 - Math.max(0, (t - 0.4) / 0.6))) * 0.32;
        const g = ctx.createRadialGradient(x, y, 0, x, y, size);
        g.addColorStop(0, rgba('#4a3a6a', a));
        g.addColorStop(1, 'rgba(60,45,90,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, size, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }
}

// ============================================================
// 10まんボルト：自分の体が帯電し、そこから相手へ電撃を放って痺れさせる演出
// 構成：①自分の輪郭にバチバチと電気が走り、周囲に電光の粒子が渦を巻いて集まる（帯電チャージ）
//       ②帯電がピークに達し、体全体が発光する（放出の予備動作）
//       ③自分から相手へ、複数のジグザグ稲妻が同時に何本も走り抜ける（電撃ネット状に枝分かれ）
//       ④相手に着弾し、黄色い閃光と共に相手の全身を電撃が包んで痺れさせる
//       ⑤着弾点で火花が飛び散り、余韻の電光がチラチラと明滅して消える
// 「黄色〜白の高圧な発光」「ジグザグの稲妻＋枝分かれ」「痺れを思わせる明滅」がキモ。
// パワージェム・ヘドロばくだんと同程度の尺・派手さ（過度に長くしない）。
//
// info = { from:{x,y}, to:{x,y}, scale }  ※ playSpecialTypeEffect が実測して渡す。
// ============================================================
const THUNDERBOLT_CHARGE_MS = 360;     // ①②自分が帯電するまで
const THUNDERBOLT_BOLT_COUNT = 4;      // 相手へ放つ稲妻の本数
const THUNDERBOLT_STAGGER_MS = 55;     // 稲妻ごとの発射間隔
const THUNDERBOLT_STRIKE_MS = 90;      // 1本あたりが相手に届くまでの時間（ほぼ瞬間）
const THUNDERBOLT_FINAL_HIT_MS =
  THUNDERBOLT_CHARGE_MS + THUNDERBOLT_STAGGER_MS * (THUNDERBOLT_BOLT_COUNT - 1) + THUNDERBOLT_STRIKE_MS;
const THUNDERBOLT_PARALYZE_MS = 480;   // ④相手が電撃に包まれて痺れる時間
const THUNDERBOLT_END_MS = THUNDERBOLT_FINAL_HIT_MS + THUNDERBOLT_PARALYZE_MS + 260;

function spawnThunderboltSpecial(particles, w, h, info) {
  const from = (info && info.from) || { x: w * 0.28, y: h * 0.68 };
  const to = (info && info.to) || { x: w * 0.72, y: h * 0.32 };
  const S = (info && info.scale) || 1;
  const R = Math.max(w, h);
  const dx = to.x - from.x, dy = to.y - from.y;
  const dist = Math.hypot(dx, dy) || 1;
  const nx = -dy / dist, ny = dx / dist; // 進行方向に垂直な単位ベクトル

  // ジグザグ稲妻を1本描くヘルパー（p0→p1の間を、乱数シードに基づいて折れ線で描く。枝分かれも生やす）
  function drawBolt(ctx, p0, p1, seed, alpha, coreColor, glowColor, widthScale, withBranches) {
    const segs = 9;
    const pts = [p0];
    for (let i = 1; i < segs; i++) {
      const t = i / segs;
      const bx = lerp(p0.x, p1.x, t);
      const by = lerp(p0.y, p1.y, t);
      const wob = noise1(t * 9 + seed, seed) * (1 - Math.abs(t - 0.5) * 1.1) * 22 * S;
      pts.push({ x: bx + nx * wob, y: by + ny * wob });
    }
    pts.push(p1);
    // 外側の発光レイヤー
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = rgba(glowColor, alpha * 0.55);
    ctx.lineWidth = 8 * widthScale * S;
    ctx.shadowColor = rgba(glowColor, 0.9);
    ctx.shadowBlur = 16 * S;
    ctx.beginPath();
    pts.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
    ctx.stroke();
    // 芯（白〜黄の高輝度な線）
    ctx.strokeStyle = rgba(coreColor, alpha);
    ctx.lineWidth = 2.6 * widthScale * S;
    ctx.shadowBlur = 8 * S;
    ctx.beginPath();
    pts.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
    ctx.stroke();
    // 枝分かれ（電撃ネット状の凶暴さを補強）
    if (withBranches) {
      for (let i = 2; i < pts.length - 1; i += 2) {
        const bp = pts[i];
        const ang = Math.atan2(pts[i + 1].y - pts[i - 1].y, pts[i + 1].x - pts[i - 1].x) + (i % 4 === 0 ? 1.1 : -1.1);
        const len = rand(10, 22) * S;
        const bx2 = bp.x + Math.cos(ang) * len;
        const by2 = bp.y + Math.sin(ang) * len;
        ctx.lineWidth = 1.4 * widthScale * S;
        ctx.strokeStyle = rgba(coreColor, alpha * 0.7);
        ctx.beginPath();
        ctx.moveTo(bp.x, bp.y);
        ctx.lineTo(bx2, by2);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  // ---- 幕1：自分の輪郭にバチバチと電気が走り、周囲に電光の粒子が渦を巻いて集まる（帯電チャージ）----
  // 足元の帯電フィールド（黄色い光の輪が脈動しながら膨らむ）
  particles.push({
    maxLife: THUNDERBOLT_CHARGE_MS + 120,
    blend: 'lighter',
    draw(ctx, t) {
      if (t >= 1) return;
      const pulse = 0.7 + Math.abs(noise1(t * 14, 3)) * 0.3;
      const a = Math.sin(Math.PI * clamp01(t * 1.15)) * 0.6 * pulse;
      const r = lerp(14 * S, 50 * S, easeOutCubic(t));
      const g = ctx.createRadialGradient(from.x, from.y, 0, from.x, from.y, r);
      g.addColorStop(0, rgba('#ffffff', a * 0.8));
      g.addColorStop(0.4, rgba('#fff066', a * 0.7));
      g.addColorStop(0.8, rgba('#ffd23f', a * 0.35));
      g.addColorStop(1, 'rgba(255,210,63,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(from.x, from.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  // 自分の体を這う細かい電光（輪郭に沿ってバチバチ走る短い線）
  for (let i = 0; i < 20; i++) {
    const ang = rand(0, Math.PI * 2);
    const orbitR = rand(14, 40) * S;
    const seed = rand(0, 100);
    particles.push({
      delay: rand(0, THUNDERBOLT_CHARGE_MS - 60),
      maxLife: rand(60, 120),
      ang, orbitR, seed,
      draw(ctx, t) {
        const a = Math.sin(Math.PI * t) * 0.9;
        const cx = from.x + Math.cos(this.ang) * this.orbitR;
        const cy = from.y + Math.sin(this.ang) * this.orbitR * 0.85;
        const len = rand(6, 14) * S;
        const ang2 = this.ang + Math.PI / 2 + noise1(t * 20, this.seed) * 0.8;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = rgba('#fff9c4', a);
        ctx.lineWidth = 1.6 * S;
        ctx.shadowColor = rgba('#ffe066', 0.9);
        ctx.shadowBlur = 8 * S;
        ctx.beginPath();
        ctx.moveTo(cx - Math.cos(ang2) * len * 0.5, cy - Math.sin(ang2) * len * 0.5);
        ctx.lineTo(cx + Math.cos(ang2) * len * 0.5, cy + Math.sin(ang2) * len * 0.5);
        ctx.stroke();
        ctx.restore();
      }
    });
  }
  // 周囲から自分の体に吸い込まれる電光の粒（帯電が高まっていく様子）
  for (let i = 0; i < 22; i++) {
    const ang = rand(0, Math.PI * 2);
    const r0 = rand(50, 100) * S;
    const seed = rand(0, 100);
    const launchDelay = rand(0, THUNDERBOLT_CHARGE_MS - 100);
    particles.push({
      delay: launchDelay,
      maxLife: THUNDERBOLT_CHARGE_MS - launchDelay,
      ang, r0, seed,
      size: rand(2, 4) * S,
      draw(ctx, t) {
        const e = easeInCubic(t);
        const r = lerp(this.r0, 4 * S, e);
        const wob = noise1(t * 8 + this.seed, this.seed) * 6 * S;
        const x = from.x + Math.cos(this.ang) * r + wob;
        const y = from.y + Math.sin(this.ang) * r * 0.85 + wob;
        const a = clamp01(t * 3) * 0.9;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = rgba('#fff9c4', a);
        ctx.shadowColor = rgba('#ffe066', 0.9);
        ctx.shadowBlur = 6 * S;
        ctx.beginPath();
        ctx.arc(x, y, this.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    });
  }
  // 帯電ピーク：自分の全身がまばゆく発光する瞬間（放出の予備動作）
  particles.push({
    delay: THUNDERBOLT_CHARGE_MS - 90,
    maxLife: 140,
    blend: 'lighter',
    draw(ctx, t) {
      const a = Math.sin(Math.PI * clamp01(t)) * 0.85;
      const r = lerp(30 * S, 58 * S, easeOutCubic(t));
      const g = ctx.createRadialGradient(from.x, from.y, 0, from.x, from.y, r);
      g.addColorStop(0, rgba('#ffffff', a));
      g.addColorStop(0.5, rgba('#fff066', a * 0.8));
      g.addColorStop(1, 'rgba(255,240,102,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(from.x, from.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  });

  // ---- 幕2：自分から相手へ、複数のジグザグ稲妻が同時に何本も走り抜ける ----
  for (let i = 0; i < THUNDERBOLT_BOLT_COUNT; i++) {
    const launch = THUNDERBOLT_CHARGE_MS + i * THUNDERBOLT_STAGGER_MS;
    const seed = rand(0, 100);
    const spreadAtSource = rand(-14, 14) * S; // 発射元での微妙なブレ（体の各部から出るイメージ）
    const spreadAtTarget = rand(-20, 20) * S; // 着弾点も少しずつずらす
    particles.push({
      delay: launch,
      maxLife: THUNDERBOLT_STRIKE_MS + 90,
      seed, spreadAtSource, spreadAtTarget,
      draw(ctx, t) {
        const alpha = t < 0.5 ? 1 : (1 - (t - 0.5) / 0.5);
        const p0 = { x: from.x + nx * this.spreadAtSource, y: from.y + ny * this.spreadAtSource };
        const p1 = { x: to.x + nx * this.spreadAtTarget, y: to.y + ny * this.spreadAtTarget };
        drawBolt(ctx, p0, p1, this.seed + t * 3, alpha, '#fffde0', '#ffe066', 1, true);
      }
    });
  }

  // ---- 幕3：相手に着弾。黄色い閃光と共に相手の全身を電撃が包んで痺れさせる ----
  const fin = THUNDERBOLT_FINAL_HIT_MS;
  // 全弾着弾の大閃光
  particles.push({
    delay: fin,
    maxLife: 380,
    blend: 'lighter',
    draw(ctx, t) {
      const a = (1 - t) * 0.95;
      const r = lerp(10 * S, 90 * S, easeOutQuint(t));
      const g = ctx.createRadialGradient(to.x, to.y, 0, to.x, to.y, r);
      g.addColorStop(0, rgba('#ffffff', a));
      g.addColorStop(0.35, rgba('#fff9c4', a * 0.9));
      g.addColorStop(0.7, rgba('#ffd23f', a * 0.5));
      g.addColorStop(1, 'rgba(255,210,63,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(to.x, to.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  // 衝撃波リング
  ['#ffffff', '#fff066', '#ffd23f'].forEach((c, i) => {
    particles.push({
      delay: fin + i * 30,
      maxLife: 320 - i * 30,
      blend: 'lighter',
      draw(ctx, t) {
        const r = lerp(6 * S, R * (0.1 + i * 0.035), easeOutQuint(t));
        ctx.strokeStyle = rgba(c, (1 - t) * (0.85 - i * 0.15));
        ctx.lineWidth = (5 - i) * (1 - t * 0.5);
        ctx.shadowColor = rgba(c, 0.9);
        ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.arc(to.x, to.y, r, 0, Math.PI * 2);
        ctx.stroke();
      }
    });
  });
  // 相手の全身を包む「痺れ」の電撃ネット（体の輪郭付近を細かい稲妻が這い回る）
  for (let i = 0; i < 26; i++) {
    const ang0 = rand(0, Math.PI * 2);
    const seed = rand(0, 100);
    const startDelay = fin + rand(0, THUNDERBOLT_PARALYZE_MS - 80);
    particles.push({
      delay: startDelay,
      maxLife: rand(70, 130),
      ang0, seed,
      draw(ctx, t) {
        const a = Math.sin(Math.PI * t) * 0.9;
        const orbitR = (26 + (this.seed % 20)) * S;
        const cx = to.x + Math.cos(this.ang0) * orbitR;
        const cy = to.y + Math.sin(this.ang0) * orbitR * 0.9;
        const len = rand(8, 18) * S;
        const ang2 = this.ang0 + Math.PI / 2 + noise1(t * 18, this.seed) * 0.9;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = rgba('#fff9c4', a);
        ctx.lineWidth = 1.8 * S;
        ctx.shadowColor = rgba('#ffe066', 0.9);
        ctx.shadowBlur = 8 * S;
        ctx.beginPath();
        ctx.moveTo(cx - Math.cos(ang2) * len * 0.5, cy - Math.sin(ang2) * len * 0.5);
        ctx.lineTo(cx + Math.cos(ang2) * len * 0.5, cy + Math.sin(ang2) * len * 0.5);
        ctx.stroke();
        ctx.restore();
      }
    });
  }
  // 痺れの間、相手の体が数回明滅する（電撃に痺れて硬直する様子）
  for (let i = 0; i < 4; i++) {
    particles.push({
      delay: fin + 60 + i * 110,
      maxLife: 90,
      blend: 'lighter',
      draw(ctx, t) {
        const a = Math.sin(Math.PI * t) * 0.5;
        const r = 34 * S;
        const g = ctx.createRadialGradient(to.x, to.y, 0, to.x, to.y, r);
        g.addColorStop(0, rgba('#fff9c4', a));
        g.addColorStop(1, 'rgba(255,249,196,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(to.x, to.y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }

  // ---- 幕4：着弾点で火花が飛び散り、余韻の電光がチラチラ明滅して消える ----
  for (let i = 0; i < 20; i++) {
    const ang = rand(0, Math.PI * 2);
    const sp = rand(24, 88) * S;
    particles.push({
      delay: fin + rand(0, 60),
      maxLife: rand(300, 480),
      ang, sp,
      size: rand(2, 4) * S,
      seed: rand(0, 100),
      draw(ctx, t) {
        const e = easeOutCubic(t);
        const x = to.x + Math.cos(this.ang) * this.sp * e;
        const y = to.y + Math.sin(this.ang) * this.sp * e * 0.85;
        const flick = 0.5 + Math.abs(noise1(t * 22 + this.seed, this.seed)) * 0.5;
        const a = (1 - t) * 0.95 * flick;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = rgba('#fff9c4', a);
        ctx.shadowColor = rgba('#ffe066', 0.9);
        ctx.shadowBlur = 6 * S;
        ctx.beginPath();
        ctx.arc(x, y, this.size * (1 - t * 0.4), 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    });
  }
}

// ============================================================
// れいとうビーム：口元から結晶の光線を一直線に放ち、着弾点で凍結させる演出
// 構成：①口元に冷気が渦を巻いて集まり、氷の結晶が実る ②鋭い結晶質のビームが伸びる
//       ③無数のダイヤ結晶と雪片がビームに沿って流れる ④着弾点で凍結の大閃光と
//       蜘蛛状の氷の亀裂 ⑤舞い散る粉雪と結晶片の余韻
// 「ダイヤ形の結晶が流れる」「白〜淡青〜水色の階調」「蜘蛛状に広がる凍結」がキモ。
// ============================================================
const ICEBEAM_CHARGE_MS = 350;
const ICEBEAM_EXTEND_MS = 150;
const ICEBEAM_SUSTAIN_MS = 520;
const ICEBEAM_FADE_MS = 300;
const ICEBEAM_HIT_MS = ICEBEAM_CHARGE_MS + ICEBEAM_EXTEND_MS;
const ICEBEAM_END_MS = ICEBEAM_HIT_MS + ICEBEAM_SUSTAIN_MS + ICEBEAM_FADE_MS;

function spawnIceBeamSpecial(particles, w, h, info) {
  const from = (info && info.from) || { x: w * 0.28, y: h * 0.68 };
  const to = (info && info.to) || { x: w * 0.72, y: h * 0.32 };
  const S = (info && info.scale) || 1;
  const R = Math.max(w, h);

  const dx = to.x - from.x, dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const ang = Math.atan2(dy, dx);
  const ux = dx / len, uy = dy / len;
  const nx = -uy, ny = ux;
  const mouth = { x: from.x + ux * 30 * S, y: from.y + uy * 30 * S };
  const beamW = Math.min(28 * S, 34);
  const seedA = rand(0, 100);

  function beamStrength(ms) {
    if (ms < ICEBEAM_CHARGE_MS) return 0;
    const since = ms - ICEBEAM_CHARGE_MS;
    if (since < ICEBEAM_EXTEND_MS) return easeOutQuint(since / ICEBEAM_EXTEND_MS);
    if (since < ICEBEAM_EXTEND_MS + ICEBEAM_SUSTAIN_MS) {
      // 照射中：わずかに脈動
      return 1 + Math.sin((since - ICEBEAM_EXTEND_MS) * 0.06) * 0.06;
    }
    const f = (since - ICEBEAM_EXTEND_MS - ICEBEAM_SUSTAIN_MS) / ICEBEAM_FADE_MS;
    return Math.pow(1 - clamp01(f), 1.5);
  }
  function beamReach(ms) {
    if (ms < ICEBEAM_CHARGE_MS) return 0;
    return easeOutQuint(clamp01((ms - ICEBEAM_CHARGE_MS) / ICEBEAM_EXTEND_MS));
  }

  // ---- ダイヤ形の結晶を描くヘルパー ----
  function drawIceDiamond(ctx, x, y, size, rot, alpha) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, size * 1.8);
    g.addColorStop(0, rgba('#ffffff', alpha));
    g.addColorStop(0.4, rgba('#bfe8ff', alpha * 0.6));
    g.addColorStop(1, 'rgba(191,232,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, size * 1.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = rgba('#ffffff', alpha * 0.95);
    ctx.beginPath();
    ctx.moveTo(0, -size);
    ctx.lineTo(size * 0.55, 0);
    ctx.lineTo(0, size);
    ctx.lineTo(-size * 0.55, 0);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = rgba('#7fd3e0', alpha * 0.9);
    ctx.lineWidth = Math.max(0.6, size * 0.13);
    ctx.beginPath();
    ctx.moveTo(0, -size);
    ctx.lineTo(0, size);
    ctx.moveTo(-size * 0.55, 0);
    ctx.lineTo(size * 0.55, 0);
    ctx.stroke();
    ctx.restore();
  }

  // ---- 幕0：口元に冷気が集まり、氷晶が実る ----
  particles.push({
    maxLife: ICEBEAM_CHARGE_MS + 60,
    blend: 'lighter',
    draw(ctx, t) {
      const a = Math.sin(Math.PI * clamp01(t)) * 0.55;
      const r = lerp(8 * S, 34 * S, easeOutCubic(t));
      const g = ctx.createRadialGradient(mouth.x, mouth.y, 0, mouth.x, mouth.y, r);
      g.addColorStop(0, rgba('#ffffff', a));
      g.addColorStop(0.5, rgba('#bfe8ff', a * 0.8));
      g.addColorStop(1, 'rgba(127,211,224,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(mouth.x, mouth.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  for (let i = 0; i < 14; i++) {
    const a0 = (i / 14) * Math.PI * 2 + rand(-0.2, 0.2);
    const r0 = rand(34, 62) * S;
    const seed = rand(0, 100);
    const sz = rand(2.5, 5) * S;
    particles.push({
      delay: rand(0, 220),
      maxLife: rand(200, 280),
      draw(ctx, t) {
        if (t >= 1) return;
        const e = easeInCubic(t);
        const rr = lerp(r0, 4 * S, e);
        const spin = a0 + t * 2.4;
        const x = mouth.x + Math.cos(spin) * rr;
        const y = mouth.y + Math.sin(spin) * rr * 0.8;
        const a = clamp01(t * 4) * (1 - Math.max(0, (t - 0.85) / 0.15));
        drawIceDiamond(ctx, x, y, sz, spin + t * 3, a * 0.9);
      }
    });
  }

  // ---- 幕1〜3：結晶のビーム本体（3層のソフトブロブ） ----
  const LAYERS = [
    { n: 32, wMul: 1.05, aMul: 0.35, col0: '#ffffff', col1: '#7fd3e0', seedOff: 0 },
    { n: 26, wMul: 0.65, aMul: 0.6, col0: '#ffffff', col1: '#bfe8ff', seedOff: 5 },
    { n: 18, wMul: 0.32, aMul: 0.95, col0: '#ffffff', col1: '#ffffff', seedOff: 11 },
  ];
  LAYERS.forEach((L, li) => {
    particles.push({
      delay: ICEBEAM_CHARGE_MS,
      maxLife: ICEBEAM_END_MS - ICEBEAM_CHARGE_MS,
      blend: 'lighter',
      draw(ctx, t) {
        const ms = ICEBEAM_CHARGE_MS + t * (ICEBEAM_END_MS - ICEBEAM_CHARGE_MS);
        const k = beamStrength(ms);
        if (k <= 0.02) return;
        const reach = beamReach(ms);
        const time = ms / 1000;
        for (let i = 0; i < L.n; i++) {
          const kk = (i + 0.5) / L.n;
          if (kk > reach) break;
          const px = mouth.x + (to.x - mouth.x) * kk;
          const py = mouth.y + (to.y - mouth.y) * kk;
          const jit = noise1(kk * 6 + time * 8 + L.seedOff, seedA + li * 3) * beamW * 0.22 * kk;
          const jit2 = noise1(kk * 5 + time * 9 + L.seedOff + 3, seedA + li) * beamW * 0.22 * kk;
          const x = px + nx * (jit + jit2 * 0.5);
          const y = py + ny * (jit + jit2 * 0.5);
          const taper = Math.min(1, kk * 5) * Math.max(0.35, 1 - Math.pow(kk, 3) * 0.55);
          const size = beamW * L.wMul * taper * (0.9 + Math.abs(noise1(kk * 7 + time * 12 + L.seedOff, seedA + li)) * 0.25);
          const a = k * L.aMul * (1 - kk * 0.3) * (0.85 + Math.abs(noise1(kk * 9 + time * 14, seedA + li)) * 0.3);
          const g = ctx.createRadialGradient(x, y, 0, x, y, size);
          g.addColorStop(0, rgba(L.col0, a));
          g.addColorStop(0.45, rgba(L.col1, a * 0.85));
          g.addColorStop(1, 'rgba(127,211,224,0)');
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(x, y, size, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    });
  });

  // ---- ビームに沿って流れるダイヤ結晶 ----
  for (let i = 0; i < 40; i++) {
    const startAt = ICEBEAM_CHARGE_MS + rand(0, ICEBEAM_SUSTAIN_MS + 180);
    const kStart = rand(-0.05, 0.2);
    const kEnd = rand(1.0, 1.15);
    const sideOff = rand(-0.85, 0.85);
    const sp = rand(0.85, 1.25);
    const sz = rand(2.5, 5.5) * S;
    const spin = rand(-2, 2);
    const seed = rand(0, 100);
    particles.push({
      delay: startAt,
      maxLife: rand(300, 460),
      draw(ctx, t) {
        if (t >= 1) return;
        const e = easeOutCubic(t);
        const kk = lerp(kStart, kEnd, e * sp);
        if (kk > 1.05) return;
        const px = mouth.x + (to.x - mouth.x) * kk;
        const py = mouth.y + (to.y - mouth.y) * kk;
        const drift = noise1(kk * 5 + t * 3, seed) * beamW * 0.35 * e;
        const perp = sideOff * beamW * 0.5 + drift;
        const x = px + nx * perp;
        const y = py + ny * perp;
        const a = clamp01(t * 6) * (1 - Math.max(0, (t - 0.7) / 0.3));
        drawIceDiamond(ctx, x, y, sz * (1 - t * 0.35), ang + t * spin, a * 0.95);
      }
    });
  }

  // ---- 幕4：着弾＝凍結 ----
  particles.push({
    delay: ICEBEAM_HIT_MS,
    maxLife: 300,
    blend: 'lighter',
    draw(ctx, t) {
      const a = (1 - t) * 0.9;
      ctx.fillStyle = rgba('#eaf8ff', a * 0.75);
      const r = lerp(6 * S, 60 * S, easeOutQuint(t));
      const g = ctx.createRadialGradient(to.x, to.y, 0, to.x, to.y, r);
      g.addColorStop(0, rgba('#ffffff', a));
      g.addColorStop(0.4, rgba('#eaf8ff', a * 0.9));
      g.addColorStop(1, 'rgba(191,232,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(to.x, to.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  // 蜘蛛状に広がる氷の亀裂
  for (let i = 0; i < 12; i++) {
    const a0 = (i / 12) * Math.PI * 2 + rand(-0.15, 0.15);
    const len1 = rand(28, 52) * S;
    const kink = rand(-0.5, 0.5);
    const len2 = len1 * rand(0.4, 0.7);
    particles.push({
      delay: ICEBEAM_HIT_MS + rand(0, 40),
      maxLife: 380,
      draw(ctx, t) {
        const grow = easeOutCubic(clamp01(t * 2.5));
        const a = grow * (1 - Math.max(0, (t - 0.5) / 0.5)) * 0.9;
        if (a <= 0.01) return;
        const x1 = to.x + Math.cos(a0) * len1 * grow;
        const y1 = to.y + Math.sin(a0) * len1 * grow;
        const x2 = x1 + Math.cos(a0 + kink) * len2 * grow;
        const y2 = y1 + Math.sin(a0 + kink) * len2 * grow;
        ctx.strokeStyle = rgba('#bfe8ff', a);
        ctx.lineWidth = 2.2;
        ctx.shadowColor = rgba('#eaf8ff', 1);
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.moveTo(to.x, to.y);
        ctx.lineTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }
    });
  }
  // 着弾点に突き刺さる巨大な結晶（メイン）
  particles.push({
    delay: ICEBEAM_HIT_MS + 30,
    maxLife: 340,
    blend: 'lighter',
    draw(ctx, t) {
      const grow = easeOutQuint(Math.min(1, t * 3));
      const a = (1 - Math.max(0, (t - 0.5) / 0.5)) * 0.95;
      const size = w * 0.11 * grow;
      drawIceDiamond(ctx, to.x, to.y, size, t * 0.8, a);
    }
  });
  // 粉雪が降り注ぐ余韻
  for (let i = 0; i < 26; i++) {
    const x0 = to.x + rand(-90, 90) * S;
    const y0 = to.y + rand(-40, 10) * S;
    const size = rand(1.5, 3.5) * S;
    const sway = rand(8, 18) * S;
    const seed = rand(0, 100);
    const rot = rand(0, Math.PI * 2);
    particles.push({
      delay: ICEBEAM_HIT_MS + rand(0, 200),
      maxLife: rand(420, 620),
      draw(ctx, t) {
        const fall = easeInCubic(t) * 0.9;
        const y = y0 + fall * h * 0.35;
        const x = x0 + Math.sin(t * 4 + seed) * sway;
        const a = (t < 0.1 ? t / 0.1 : (1 - Math.max(0, (t - 0.65) / 0.35))) * 0.85;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(t * 2 + rot);
        ctx.fillStyle = rgba('#eaf8ff', a);
        ctx.shadowColor = rgba('#bfe8ff', 0.7);
        ctx.shadowBlur = 4;
        for (let k = 0; k < 3; k++) {
          ctx.save();
          ctx.rotate((k / 3) * Math.PI);
          ctx.fillRect(-size / 2, -0.6, size, 1.2);
          ctx.restore();
        }
        ctx.restore();
      }
    });
  }
}

// ============================================================
// ラスターカノン：口元で光が収束して銀の砲撃を放ち、着弾で金属片を飛散させる演出
// 構成：①周囲の光が口元へ吸い込まれ、六角形のエネルギーパターンが浮かぶ（チャージ）
//       ②銀の極太ビームが一直線に伸びる ③ビーム内を六角セグメントが回転しながら流れる
//       ④着弾で銀の大閃光、無数の金属片と火花が放射状に弾ける ⑤金属粉が静かに降る余韻
// 「回転する六角セグメント」「銀〜白金の階調」「着弾の金属質な破片」がキモ。
// ============================================================
const FLASHCANNON_CHARGE_MS = 420;
const FLASHCANNON_EXTEND_MS = 200;
const FLASHCANNON_SUSTAIN_MS = 480;
const FLASHCANNON_FADE_MS = 340;
const FLASHCANNON_HIT_MS = FLASHCANNON_CHARGE_MS + FLASHCANNON_EXTEND_MS;
const FLASHCANNON_END_MS = FLASHCANNON_HIT_MS + FLASHCANNON_SUSTAIN_MS + FLASHCANNON_FADE_MS;

function spawnFlashCannonSpecial(particles, w, h, info) {
  const from = (info && info.from) || { x: w * 0.28, y: h * 0.68 };
  const to = (info && info.to) || { x: w * 0.72, y: h * 0.32 };
  const S = (info && info.scale) || 1;
  const R = Math.max(w, h);

  const dx = to.x - from.x, dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const ang = Math.atan2(dy, dx);
  const ux = dx / len, uy = dy / len;
  const nx = -uy, ny = ux;
  const muzzle = { x: from.x + ux * 34 * S, y: from.y + uy * 34 * S };
  const beamW = Math.min(34 * S, 40);
  const seedA = rand(0, 100);

  function beamStrength(ms) {
    if (ms < FLASHCANNON_CHARGE_MS) return 0;
    const since = ms - FLASHCANNON_CHARGE_MS;
    if (since < FLASHCANNON_EXTEND_MS) return easeOutQuint(since / FLASHCANNON_EXTEND_MS);
    if (since < FLASHCANNON_EXTEND_MS + FLASHCANNON_SUSTAIN_MS) {
      return 1 + Math.sin((since - FLASHCANNON_EXTEND_MS) * 0.04) * 0.05;
    }
    const f = (since - FLASHCANNON_EXTEND_MS - FLASHCANNON_SUSTAIN_MS) / FLASHCANNON_FADE_MS;
    return Math.pow(1 - clamp01(f), 1.6);
  }
  function beamReach(ms) {
    if (ms < FLASHCANNON_CHARGE_MS) return 0;
    return easeOutQuint(clamp01((ms - FLASHCANNON_CHARGE_MS) / FLASHCANNON_EXTEND_MS));
  }

  // ---- 六角形を描くヘルパー（セグメント／破片で共用） ----
  function drawHexagon(ctx, x, y, size, rot, fillA, edgeA, fillCol, edgeCol) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    const pts = [];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
      pts.push([Math.cos(a) * size, Math.sin(a) * size]);
    }
    if (fillA > 0.005) {
      ctx.fillStyle = rgba(fillCol || '#c7d3da', fillA);
      ctx.beginPath();
      pts.forEach(([px, py], i) => i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py));
      ctx.closePath();
      ctx.fill();
    }
    if (edgeA > 0.005) {
      ctx.strokeStyle = rgba(edgeCol || '#ffffff', edgeA);
      ctx.lineWidth = Math.max(0.8, size * 0.16);
      ctx.beginPath();
      pts.forEach(([px, py], i) => i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py));
      ctx.closePath();
      ctx.stroke();
    }
    ctx.restore();
  }

  // ---- 幕0：口元に光が収束し、六角の光条が浮かぶ ----
  particles.push({
    maxLife: FLASHCANNON_CHARGE_MS + 60,
    blend: 'lighter',
    draw(ctx, t) {
      const a = Math.sin(Math.PI * clamp01(t)) * 0.7;
      const r = lerp(8 * S, 44 * S, easeOutCubic(t));
      const g = ctx.createRadialGradient(muzzle.x, muzzle.y, 0, muzzle.x, muzzle.y, r);
      g.addColorStop(0, rgba('#ffffff', a));
      g.addColorStop(0.4, rgba('#e8f0f8', a * 0.9));
      g.addColorStop(0.75, rgba('#a8b8c8', a * 0.5));
      g.addColorStop(1, 'rgba(168,184,200,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(muzzle.x, muzzle.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  // 収束する光の筋（六角形の光条）
  for (let i = 0; i < 12; i++) {
    const a0 = (i / 12) * Math.PI * 2;
    const startR = rand(50, 78) * S;
    const startAt = rand(40, 260);
    const life = FLASHCANNON_CHARGE_MS - startAt;
    particles.push({
      delay: startAt,
      maxLife: Math.max(120, life),
      blend: 'lighter',
      draw(ctx, t) {
        const outer = lerp(startR, 12 * S, easeInCubic(t));
        const inner = outer - 14 * S * (1 - t * 0.4);
        ctx.strokeStyle = rgba('#e8f0f8', Math.sin(Math.PI * clamp01(t)) * 0.7);
        ctx.lineWidth = 1.6;
        ctx.shadowColor = rgba('#ffffff', 0.9);
        ctx.shadowBlur = 6;
        ctx.beginPath();
        ctx.moveTo(muzzle.x + Math.cos(a0) * outer, muzzle.y + Math.sin(a0) * outer);
        ctx.lineTo(muzzle.x + Math.cos(a0) * inner, muzzle.y + Math.sin(a0) * inner);
        ctx.stroke();
      }
    });
  }
  // 収束していく小さな六角片
  for (let i = 0; i < 10; i++) {
    const a0 = (i / 10) * Math.PI * 2 + rand(-0.2, 0.2);
    const r0 = rand(48, 74) * S;
    const sz = rand(3, 6) * S;
    const spin = rand(-4, 4);
    particles.push({
      delay: rand(0, 220),
      maxLife: rand(220, 320),
      blend: 'lighter',
      draw(ctx, t) {
        if (t >= 1) return;
        const e = easeInCubic(t);
        const rr = lerp(r0, 4 * S, e);
        const spinA = a0 + t * 3;
        const x = muzzle.x + Math.cos(spinA) * rr;
        const y = muzzle.y + Math.sin(spinA) * rr * 0.8;
        const a = clamp01(t * 4) * (1 - Math.max(0, (t - 0.85) / 0.15));
        drawHexagon(ctx, x, y, sz * (1 - t * 0.4), t * spin, a * 0.6, a, '#e8f0f8', '#ffffff');
      }
    });
  }

  // ---- 幕1〜3：銀の砲撃ビーム本体（3層） ----
  const LAYERS = [
    { n: 26, wMul: 1.05, aMul: 0.35, col0: '#ffffff', col1: '#a8b8c8', seedOff: 0 },
    { n: 20, wMul: 0.68, aMul: 0.6, col0: '#ffffff', col1: '#e8f0f8', seedOff: 6 },
    { n: 14, wMul: 0.34, aMul: 0.95, col0: '#ffffff', col1: '#ffffff', seedOff: 12 },
  ];
  LAYERS.forEach((L, li) => {
    particles.push({
      delay: FLASHCANNON_CHARGE_MS,
      maxLife: FLASHCANNON_END_MS - FLASHCANNON_CHARGE_MS,
      blend: 'lighter',
      draw(ctx, t) {
        const ms = FLASHCANNON_CHARGE_MS + t * (FLASHCANNON_END_MS - FLASHCANNON_CHARGE_MS);
        const k = beamStrength(ms);
        if (k <= 0.02) return;
        const reach = beamReach(ms);
        const time = ms / 1000;
        for (let i = 0; i < L.n; i++) {
          const kk = (i + 0.5) / L.n;
          if (kk > reach) break;
          const px = muzzle.x + (to.x - muzzle.x) * kk;
          const py = muzzle.y + (to.y - muzzle.y) * kk;
          const jit = noise1(kk * 5 + time * 5 + L.seedOff, seedA + li * 3) * beamW * 0.14 * kk;
          const x = px + nx * jit;
          const y = py + ny * jit;
          const taper = Math.min(1, kk * 5) * Math.max(0.4, 1 - Math.pow(kk, 3) * 0.45);
          const size = beamW * L.wMul * taper * (0.92 + Math.abs(noise1(kk * 6 + time * 9 + L.seedOff, seedA + li)) * 0.2);
          const a = k * L.aMul * (1 - kk * 0.25) * (0.9 + Math.abs(noise1(kk * 8 + time * 11, seedA + li)) * 0.2);
          const g = ctx.createRadialGradient(x, y, 0, x, y, size);
          g.addColorStop(0, rgba(L.col0, a));
          g.addColorStop(0.5, rgba(L.col1, a * 0.85));
          g.addColorStop(1, 'rgba(168,184,200,0)');
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(x, y, size, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    });
  });

  // ---- ビーム内を回転しながら流れる六角セグメント（メカニカル感） ----
  for (let i = 0; i < 14; i++) {
    const phase = rand(0, 1);
    const sz = rand(5, 9) * S;
    const spinSpeed = rand(-6, 6);
    const seed = rand(0, 100);
    particles.push({
      delay: FLASHCANNON_CHARGE_MS,
      maxLife: FLASHCANNON_END_MS - FLASHCANNON_CHARGE_MS,
      blend: 'lighter',
      draw(ctx, t) {
        const ms = FLASHCANNON_CHARGE_MS + t * (FLASHCANNON_END_MS - FLASHCANNON_CHARGE_MS);
        const k = beamStrength(ms);
        if (k <= 0.1) return;
        const reach = beamReach(ms);
        // 進行方向に沿って周回する（フロー）
        const kk = ((ms * 0.0022 + phase) % 1) * reach;
        if (kk > reach) return;
        const px = muzzle.x + (to.x - muzzle.x) * kk;
        const py = muzzle.y + (to.y - muzzle.y) * kk;
        const wob = Math.sin(kk * 14 + ms * 0.02 + seed) * beamW * 0.18;
        const x = px + nx * wob;
        const y = py + ny * wob;
        const rot = ms * 0.008 * spinSpeed + phase * 6;
        const a = k * 0.85 * (1 - Math.max(0, (kk - 0.85) / 0.15)) * clamp01(kk * 4);
        drawHexagon(ctx, x, y, sz * (0.7 + 0.3 * Math.abs(noise1(ms * 0.008 + phase * 6, seed))), rot, 0, a, null, '#ffffff');
      }
    });
  }

  // ---- 幕4：着弾＝金属の砕け散り ----
  particles.push({
    delay: FLASHCANNON_HIT_MS,
    maxLife: 280,
    blend: 'lighter',
    draw(ctx, t) {
      const a = (1 - t) * 0.95;
      const r = lerp(6 * S, 58 * S, easeOutQuint(t));
      const g = ctx.createRadialGradient(to.x, to.y, 0, to.x, to.y, r);
      g.addColorStop(0, rgba('#ffffff', a));
      g.addColorStop(0.4, rgba('#e8f0f8', a * 0.85));
      g.addColorStop(0.75, rgba('#a8b8c8', a * 0.5));
      g.addColorStop(1, 'rgba(168,184,200,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(to.x, to.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  // 銀の衝撃波（3重）
  for (let i = 0; i < 3; i++) {
    particles.push({
      delay: FLASHCANNON_HIT_MS + i * 40,
      maxLife: 360 - i * 50,
      blend: 'lighter',
      draw(ctx, t) {
        const r = lerp(8 * S, R * (0.13 + i * 0.05), easeOutQuint(t));
        const a = (1 - t) * (0.85 - i * 0.15);
        ctx.strokeStyle = rgba(i === 0 ? '#ffffff' : '#c7d3da', a);
        ctx.lineWidth = (6 - i) * (1 - t * 0.5);
        ctx.shadowColor = rgba('#e8f0f8', 0.9);
        ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.arc(to.x, to.y, r, 0, Math.PI * 2);
        ctx.stroke();
      }
    });
  }
  // 金属片（六角形）が放射状に弾け飛ぶ
  for (let i = 0; i < 26; i++) {
    const a0 = rand(0, Math.PI * 2);
    const sp = rand(35, 130) * S;
    const sz = rand(3.5, 7) * S;
    const spin = rand(-10, 10);
    const grav = rand(0.5, 1.3);
    const col = pick(['#c7d3da', '#e8f0f8', '#a8b8c8', '#ffffff']);
    particles.push({
      delay: FLASHCANNON_HIT_MS + rand(0, 50),
      maxLife: rand(420, 620),
      draw(ctx, t) {
        const e = easeOutCubic(t);
        const x = to.x + Math.cos(a0) * sp * e;
        const y = to.y + Math.sin(a0) * sp * e * 0.85 + grav * t * t * h * 0.09;
        const a = 1 - Math.max(0, (t - 0.55) / 0.45);
        drawHexagon(ctx, x, y, sz * (1 - t * 0.35), a0 + t * spin, a * 0.9, a, col, '#ffffff');
      }
    });
  }
  // 小さな火花（明滅）
  for (let i = 0; i < 20; i++) {
    const a0 = rand(0, Math.PI * 2);
    const sp = rand(40, 120) * S;
    const sz = rand(1.6, 3) * S;
    const seed = rand(0, 100);
    particles.push({
      delay: FLASHCANNON_HIT_MS + rand(0, 80),
      maxLife: rand(240, 400),
      blend: 'lighter',
      draw(ctx, t) {
        const e = easeOutCubic(t);
        const x = to.x + Math.cos(a0) * sp * e;
        const y = to.y + Math.sin(a0) * sp * e;
        const flick = 0.5 + Math.abs(noise1(t * 24 + seed, seed)) * 0.5;
        ctx.fillStyle = rgba('#ffffff', (1 - t) * flick);
        ctx.shadowColor = rgba('#e8f0f8', 1);
        ctx.shadowBlur = 6 * S;
        ctx.beginPath();
        ctx.arc(x, y, sz * (1 - t * 0.4), 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }
  // 金属粉が静かに舞い降りる余韻
  for (let i = 0; i < 16; i++) {
    const x0 = to.x + rand(-70, 70) * S;
    const y0 = to.y + rand(-30, 20) * S;
    const sz = rand(1.5, 3) * S;
    const sway = rand(6, 14) * S;
    const rot = rand(0, Math.PI * 2);
    particles.push({
      delay: FLASHCANNON_HIT_MS + rand(0, 200),
      maxLife: rand(480, 680),
      draw(ctx, t) {
        const fall = easeInCubic(t) * 0.9;
        const y = y0 + fall * h * 0.3;
        const x = x0 + Math.sin(t * 3.5 + rot) * sway;
        const a = (t < 0.1 ? t / 0.1 : (1 - Math.max(0, (t - 0.7) / 0.3))) * 0.85;
        drawHexagon(ctx, x, y, sz, rot + t * 2, 0, a, null, '#e8f0f8');
      }
    });
  }
}

// ============================================================
// てっていこうせん（attack333／334,335,338は共通演出・剣盾で追加／はがね・特殊・
// 最大HPの半分を失う反動技）専用演出
// ラスターカノン(332)の「六角形モチーフの光を収束させて撃つ」構成を踏襲しつつ、
// 反動技としての一発の重さ・スケール感を上回るよう設計している。
//   ・ビームは銀白ではなく、鈍い鋼色〜青灰色を基調にした重厚な色調
//   ・ビーム幅・到達後の余韻をラスターカノンより一回り太く長くし、圧の強さを出す
//   ・発射の瞬間、攻撃側自身にも赤黒い亀裂状の光と反動の衝撃波が返る
//     （HPを自ら大きく削って撃つ技であることを視覚化する、最大の差別化ポイント）
//   ①練成：口元に鋼色の光が収束、脈打つように赤黒い予兆が一瞬重なる
//   ②発射：極太の鋼色ビームが一直線に伸びる（ラスターカノンより太く長い）
//   ③着弾：巨大な金属衝撃波と破片が弾け飛ぶ
//   ④反動：発射と同時に攻撃側の足元にも赤黒い亀裂の光が走り、鈍い衝撃が返る
// ============================================================
const BEHEMOTHBEAM_CHARGE_MS = 480;      // ①練成（ラスターカノンよりわずかに長い溜め）
const BEHEMOTHBEAM_EXTEND_MS = 220;      // ビームが伸びきるまで
const BEHEMOTHBEAM_SUSTAIN_MS = 520;     // 太いビームを維持
const BEHEMOTHBEAM_FADE_MS = 360;
const BEHEMOTHBEAM_HIT_MS = BEHEMOTHBEAM_CHARGE_MS + BEHEMOTHBEAM_EXTEND_MS;
const BEHEMOTHBEAM_END_MS = BEHEMOTHBEAM_HIT_MS + BEHEMOTHBEAM_SUSTAIN_MS + BEHEMOTHBEAM_FADE_MS;

function spawnBehemothBeamSpecial(particles, w, h, info) {
  const from = (info && info.from) || { x: w * 0.28, y: h * 0.68 };
  const to = (info && info.to) || { x: w * 0.72, y: h * 0.32 };
  const S = (info && info.scale) || 1;
  const R = Math.max(w, h);

  const dx = to.x - from.x, dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  const nx = -uy, ny = ux;
  const muzzle = { x: from.x + ux * 34 * S, y: from.y + uy * 34 * S };
  const beamW = Math.min(48 * S, 56);   // ラスターカノン(34)より太い
  const seedA = rand(0, 100);

  // 鋼の配色：銀白ではなく鈍い鋼色〜青灰色を基調にする
  const STEEL_CORE = '#f0f4f6';
  const STEEL_MAIN = '#8fa0ac';
  const STEEL_DEEP = '#4a5860';
  const STEEL_EDGE = '#c4d0d6';
  // 反動（自傷）の配色：赤黒い亀裂の光
  const RECOIL_CORE = '#ffb0b0';
  const RECOIL_MAIN = '#c0202a';
  const RECOIL_DEEP = '#3a0a0e';

  function beamStrength(ms) {
    if (ms < BEHEMOTHBEAM_CHARGE_MS) return 0;
    const since = ms - BEHEMOTHBEAM_CHARGE_MS;
    if (since < BEHEMOTHBEAM_EXTEND_MS) return easeOutQuint(since / BEHEMOTHBEAM_EXTEND_MS);
    if (since < BEHEMOTHBEAM_EXTEND_MS + BEHEMOTHBEAM_SUSTAIN_MS) {
      return 1 + Math.sin((since - BEHEMOTHBEAM_EXTEND_MS) * 0.035) * 0.05;
    }
    const f = (since - BEHEMOTHBEAM_EXTEND_MS - BEHEMOTHBEAM_SUSTAIN_MS) / BEHEMOTHBEAM_FADE_MS;
    return Math.pow(1 - clamp01(f), 1.6);
  }
  function beamReach(ms) {
    if (ms < BEHEMOTHBEAM_CHARGE_MS) return 0;
    return easeOutQuint(clamp01((ms - BEHEMOTHBEAM_CHARGE_MS) / BEHEMOTHBEAM_EXTEND_MS));
  }

  function drawHexagonBB(ctx, x, y, size, rot, fillA, edgeA, fillCol, edgeCol) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    const pts = [];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
      pts.push([Math.cos(a) * size, Math.sin(a) * size]);
    }
    if (fillA > 0.005) {
      ctx.fillStyle = rgba(fillCol || STEEL_MAIN, fillA);
      ctx.beginPath();
      pts.forEach(([px, py], i) => i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py));
      ctx.closePath();
      ctx.fill();
    }
    if (edgeA > 0.005) {
      ctx.strokeStyle = rgba(edgeCol || STEEL_CORE, edgeA);
      ctx.lineWidth = Math.max(0.9, size * 0.17);
      ctx.beginPath();
      pts.forEach(([px, py], i) => i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py));
      ctx.closePath();
      ctx.stroke();
    }
    ctx.restore();
  }

  // ---- ①練成：口元に鋼色の光が収束、脈打つように赤黒い予兆が一瞬重なる ----
  particles.push({
    maxLife: BEHEMOTHBEAM_CHARGE_MS + 60,
    blend: 'lighter',
    draw(ctx, t) {
      const a = Math.sin(Math.PI * clamp01(t)) * 0.72;
      const r = lerp(10 * S, 54 * S, easeOutCubic(t));
      const g = ctx.createRadialGradient(muzzle.x, muzzle.y, 0, muzzle.x, muzzle.y, r);
      g.addColorStop(0, rgba(STEEL_CORE, a));
      g.addColorStop(0.4, rgba(STEEL_EDGE, a * 0.9));
      g.addColorStop(0.75, rgba(STEEL_MAIN, a * 0.5));
      g.addColorStop(1, 'rgba(74,88,96,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(muzzle.x, muzzle.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  // HPを削る予兆：溜めの後半、攻撃側の輪郭が赤黒く一瞬脈打つ
  particles.push({
    delay: BEHEMOTHBEAM_CHARGE_MS * 0.45,
    maxLife: BEHEMOTHBEAM_CHARGE_MS * 0.55 + 40,
    blend: 'lighter',
    draw(ctx, t) {
      const pulse = Math.abs(Math.sin(t * Math.PI * 2.4));
      const a = Math.sin(Math.PI * clamp01(t)) * 0.35 * pulse;
      const r = lerp(20, 50, t) * S;
      const g = ctx.createRadialGradient(from.x, from.y, 0, from.x, from.y, r);
      g.addColorStop(0, rgba(RECOIL_MAIN, a));
      g.addColorStop(1, 'rgba(58,10,14,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(from.x, from.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  // 収束する光の筋（六角形の光条、ラスターカノンよりやや太く重い）
  for (let i = 0; i < 14; i++) {
    const a0 = (i / 14) * Math.PI * 2;
    const startR = rand(58, 92) * S;
    const startAt = rand(40, 300);
    const life = BEHEMOTHBEAM_CHARGE_MS - startAt;
    particles.push({
      delay: startAt,
      maxLife: Math.max(120, life),
      blend: 'lighter',
      draw(ctx, t) {
        const outer = lerp(startR, 14 * S, easeInCubic(t));
        const inner = outer - 18 * S * (1 - t * 0.4);
        ctx.strokeStyle = rgba(STEEL_EDGE, Math.sin(Math.PI * clamp01(t)) * 0.75);
        ctx.lineWidth = 2.2;
        ctx.shadowColor = rgba(STEEL_CORE, 0.9);
        ctx.shadowBlur = 7;
        ctx.beginPath();
        ctx.moveTo(muzzle.x + Math.cos(a0) * outer, muzzle.y + Math.sin(a0) * outer);
        ctx.lineTo(muzzle.x + Math.cos(a0) * inner, muzzle.y + Math.sin(a0) * inner);
        ctx.stroke();
      }
    });
  }
  // 収束していく大きめの六角片（重厚感）
  for (let i = 0; i < 12; i++) {
    const a0 = (i / 12) * Math.PI * 2 + rand(-0.2, 0.2);
    const r0 = rand(54, 86) * S;
    const sz = rand(4, 7.5) * S;
    const spin = rand(-4, 4);
    particles.push({
      delay: rand(0, 260),
      maxLife: rand(240, 340),
      blend: 'lighter',
      draw(ctx, t) {
        if (t >= 1) return;
        const e = easeInCubic(t);
        const rr = lerp(r0, 4 * S, e);
        const spinA = a0 + t * 3;
        const x = muzzle.x + Math.cos(spinA) * rr;
        const y = muzzle.y + Math.sin(spinA) * rr * 0.8;
        const a = clamp01(t * 4) * (1 - Math.max(0, (t - 0.85) / 0.15));
        drawHexagonBB(ctx, x, y, sz * (1 - t * 0.4), t * spin, a * 0.65, a, STEEL_EDGE, STEEL_CORE);
      }
    });
  }

  // ---- ②発射：極太の鋼色ビーム本体（3層。ラスターカノンより一回り太い） ----
  const LAYERS = [
    { n: 30, wMul: 1.1, aMul: 0.38, col0: STEEL_CORE, col1: STEEL_MAIN, seedOff: 0 },
    { n: 22, wMul: 0.7, aMul: 0.62, col0: STEEL_CORE, col1: STEEL_EDGE, seedOff: 6 },
    { n: 16, wMul: 0.36, aMul: 0.97, col0: '#ffffff', col1: STEEL_CORE, seedOff: 12 },
  ];
  LAYERS.forEach((L, li) => {
    particles.push({
      delay: BEHEMOTHBEAM_CHARGE_MS,
      maxLife: BEHEMOTHBEAM_END_MS - BEHEMOTHBEAM_CHARGE_MS,
      blend: 'lighter',
      draw(ctx, t) {
        const ms = BEHEMOTHBEAM_CHARGE_MS + t * (BEHEMOTHBEAM_END_MS - BEHEMOTHBEAM_CHARGE_MS);
        const k = beamStrength(ms);
        if (k <= 0.02) return;
        const reach = beamReach(ms);
        const time = ms / 1000;
        for (let i = 0; i < L.n; i++) {
          const kk = (i + 0.5) / L.n;
          if (kk > reach) break;
          const px = muzzle.x + (to.x - muzzle.x) * kk;
          const py = muzzle.y + (to.y - muzzle.y) * kk;
          const jit = noise1(kk * 5 + time * 4.5 + L.seedOff, seedA + li * 3) * beamW * 0.12 * kk;
          const x = px + nx * jit;
          const y = py + ny * jit;
          const taper = Math.min(1, kk * 5) * Math.max(0.45, 1 - Math.pow(kk, 3) * 0.4);
          const size = beamW * L.wMul * taper * (0.92 + Math.abs(noise1(kk * 6 + time * 8, seedA + li)) * 0.2);
          const a = k * L.aMul * (1 - kk * 0.22) * (0.9 + Math.abs(noise1(kk * 8 + time * 10, seedA + li)) * 0.2);
          const g = ctx.createRadialGradient(x, y, 0, x, y, size);
          g.addColorStop(0, rgba(L.col0, a));
          g.addColorStop(0.5, rgba(L.col1, a * 0.85));
          g.addColorStop(1, 'rgba(74,88,96,0)');
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(x, y, size, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    });
  });
  // ビーム内を回転しながら流れる六角セグメント（メカニカル感、やや大きめ）
  for (let i = 0; i < 16; i++) {
    const phase = rand(0, 1);
    const sz = rand(6, 10) * S;
    const spinSpeed = rand(-6, 6);
    const seed = rand(0, 100);
    particles.push({
      delay: BEHEMOTHBEAM_CHARGE_MS,
      maxLife: BEHEMOTHBEAM_END_MS - BEHEMOTHBEAM_CHARGE_MS,
      blend: 'lighter',
      draw(ctx, t) {
        const ms = BEHEMOTHBEAM_CHARGE_MS + t * (BEHEMOTHBEAM_END_MS - BEHEMOTHBEAM_CHARGE_MS);
        const k = beamStrength(ms);
        if (k <= 0.1) return;
        const reach = beamReach(ms);
        const kk = ((ms * 0.002 + phase) % 1) * reach;
        if (kk > reach) return;
        const px = muzzle.x + (to.x - muzzle.x) * kk;
        const py = muzzle.y + (to.y - muzzle.y) * kk;
        const wob = Math.sin(kk * 14 + ms * 0.018 + seed) * beamW * 0.16;
        const x = px + nx * wob;
        const y = py + ny * wob;
        const rot = ms * 0.007 * spinSpeed + phase * 6;
        const a = k * 0.88 * (1 - Math.max(0, (kk - 0.85) / 0.15)) * clamp01(kk * 4);
        drawHexagonBB(ctx, x, y, sz * (0.7 + 0.3 * Math.abs(noise1(ms * 0.008 + phase * 6, seed))), rot, 0, a, null, STEEL_CORE);
      }
    });
  }

  // ---- ③着弾：巨大な金属衝撃波と破片 ----
  particles.push({
    delay: BEHEMOTHBEAM_HIT_MS,
    maxLife: 320,
    blend: 'lighter',
    draw(ctx, t) {
      const a = (1 - t) * 0.95;
      const r = lerp(8 * S, 78 * S, easeOutQuint(t));
      const g = ctx.createRadialGradient(to.x, to.y, 0, to.x, to.y, r);
      g.addColorStop(0, rgba('#ffffff', a));
      g.addColorStop(0.4, rgba(STEEL_EDGE, a * 0.85));
      g.addColorStop(0.75, rgba(STEEL_MAIN, a * 0.5));
      g.addColorStop(1, 'rgba(74,88,96,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(to.x, to.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  // 鋼の衝撃波（3重、ラスターカノンより一回り大きい半径）
  for (let i = 0; i < 3; i++) {
    particles.push({
      delay: BEHEMOTHBEAM_HIT_MS + i * 45,
      maxLife: 420 - i * 55,
      blend: 'lighter',
      draw(ctx, t) {
        const r = lerp(10 * S, R * (0.17 + i * 0.055), easeOutQuint(t));
        const a = (1 - t) * (0.88 - i * 0.15);
        ctx.strokeStyle = rgba(i === 0 ? '#ffffff' : STEEL_EDGE, a);
        ctx.lineWidth = (7 - i) * (1 - t * 0.5);
        ctx.shadowColor = rgba(STEEL_CORE, 0.9);
        ctx.shadowBlur = 13;
        ctx.beginPath();
        ctx.arc(to.x, to.y, r, 0, Math.PI * 2);
        ctx.stroke();
      }
    });
  }
  // 金属片（六角形）が放射状に弾け飛ぶ（数を多めに、重厚な破壊感）
  for (let i = 0; i < 30; i++) {
    const a0 = rand(0, Math.PI * 2);
    const sp = rand(40, 145) * S;
    const sz = rand(4, 8) * S;
    const spin = rand(-10, 10);
    const grav = rand(0.5, 1.3);
    const col = pick([STEEL_EDGE, STEEL_CORE, STEEL_MAIN, '#ffffff']);
    particles.push({
      delay: BEHEMOTHBEAM_HIT_MS + rand(0, 55),
      maxLife: rand(450, 650),
      draw(ctx, t) {
        const e = easeOutCubic(t);
        const x = to.x + Math.cos(a0) * sp * e;
        const y = to.y + Math.sin(a0) * sp * e * 0.85 + grav * t * t * h * 0.09;
        const a = 1 - Math.max(0, (t - 0.55) / 0.45);
        drawHexagonBB(ctx, x, y, sz * (1 - t * 0.35), a0 + t * spin, a * 0.9, a, col, '#ffffff');
      }
    });
  }
  // 小さな火花（明滅）
  for (let i = 0; i < 22; i++) {
    const a0 = rand(0, Math.PI * 2);
    const sp = rand(45, 130) * S;
    const sz = rand(1.8, 3.2) * S;
    const seed = rand(0, 100);
    particles.push({
      delay: BEHEMOTHBEAM_HIT_MS + rand(0, 80),
      maxLife: rand(260, 420),
      blend: 'lighter',
      draw(ctx, t) {
        const e = easeOutCubic(t);
        const x = to.x + Math.cos(a0) * sp * e;
        const y = to.y + Math.sin(a0) * sp * e;
        const flick = 0.5 + Math.abs(noise1(t * 24 + seed, seed)) * 0.5;
        ctx.fillStyle = rgba('#ffffff', (1 - t) * flick);
        ctx.shadowColor = rgba(STEEL_CORE, 1);
        ctx.shadowBlur = 6 * S;
        ctx.beginPath();
        ctx.arc(x, y, sz * (1 - t * 0.4), 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }
  // 金属粉が静かに舞い降りる余韻
  for (let i = 0; i < 18; i++) {
    const x0 = to.x + rand(-78, 78) * S;
    const y0 = to.y + rand(-32, 22) * S;
    const sz = rand(1.6, 3.2) * S;
    const sway = rand(6, 15) * S;
    const rot = rand(0, Math.PI * 2);
    particles.push({
      delay: BEHEMOTHBEAM_HIT_MS + rand(0, 220),
      maxLife: rand(500, 700),
      draw(ctx, t) {
        const fall = easeInCubic(t) * 0.9;
        const y = y0 + fall * h * 0.3;
        const x = x0 + Math.sin(t * 3.5 + rot) * sway;
        const a = (t < 0.1 ? t / 0.1 : (1 - Math.max(0, (t - 0.7) / 0.3))) * 0.85;
        drawHexagonBB(ctx, x, y, sz, rot + t * 2, 0, a, null, STEEL_EDGE);
      }
    });
  }

  // ---- ④反動：発射と同時に攻撃側の足元にも赤黒い亀裂の光と鈍い衝撃が返る ----
  // （HPを大きく失う反動技であることを視覚化する、この技最大の特徴）
  particles.push({
    delay: BEHEMOTHBEAM_CHARGE_MS,
    maxLife: 380,
    blend: 'lighter',
    draw(ctx, t) {
      const a = (1 - t) * 0.7;
      const r = lerp(6 * S, 40 * S, easeOutQuint(t));
      const g = ctx.createRadialGradient(from.x, from.y, 0, from.x, from.y, r);
      g.addColorStop(0, rgba(RECOIL_CORE, a));
      g.addColorStop(0.5, rgba(RECOIL_MAIN, a * 0.75));
      g.addColorStop(1, 'rgba(58,10,14,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(from.x, from.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  // 赤黒い亀裂状の光条（攻撃側の足元から放射状に走る、自傷ダメージの表現）
  for (let i = 0; i < 6; i++) {
    const a0 = rand(0, Math.PI * 2);
    const len = rand(20, 42) * S;
    particles.push({
      delay: BEHEMOTHBEAM_CHARGE_MS + rand(0, 40),
      maxLife: 300,
      blend: 'lighter',
      draw(ctx, t) {
        const e = easeOutQuint(t);
        const a = (1 - t) * 0.85;
        ctx.strokeStyle = rgba(RECOIL_MAIN, a);
        ctx.lineWidth = Math.max(1, 2.4 * S * (1 - t * 0.5));
        ctx.shadowColor = rgba(RECOIL_CORE, 0.9);
        ctx.shadowBlur = 7 * S;
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(from.x + Math.cos(a0) * len * e, from.y + Math.sin(a0) * len * e);
        ctx.stroke();
      }
    });
  }
  // 反動の鈍い衝撃波（攻撃側の足元、赤黒くこもった一撃）
  particles.push({
    delay: BEHEMOTHBEAM_CHARGE_MS + 20,
    maxLife: 340,
    blend: 'lighter',
    draw(ctx, t) {
      const r = lerp(8 * S, 46 * S, easeOutCubic(t));
      const a = (1 - t) * 0.55;
      ctx.strokeStyle = rgba(RECOIL_DEEP === '#3a0a0e' ? RECOIL_MAIN : RECOIL_MAIN, a);
      ctx.lineWidth = Math.max(1, 3.4 * S * (1 - t * 0.5));
      ctx.shadowColor = rgba(RECOIL_CORE, 0.7);
      ctx.shadowBlur = 8 * S;
      ctx.beginPath();
      ctx.arc(from.x, from.y, r, 0, Math.PI * 2);
      ctx.stroke();
    }
  });
}

  // ---- レジストリ：moveType文字列 → spawn関数（通常版） ----
  const SCENES = {
    bug: spawnBug,
    dark: spawnDark,
    dragon: spawnDragon,
    electric: spawnElectric,
    fairy: spawnFairy,
    fighting: spawnFighting,
    fire: spawnFire,
    flying: spawnFlying,
    ghost: spawnGhost,
    grass: spawnGrass,
    ground: spawnGround,
    ice: spawnIce,
    normal: spawnNormal,
    poison: spawnPoison,
    psychic: spawnPsychic,
    rock: spawnRock,
    steel: spawnSteel,
    water: spawnWater,
    sound: spawnSound,
    shine: spawnShine,
  };
  const DURATION_MS = {
    bug: 480, dark: 460, dragon: 480, electric: 340, fairy: 500,
    fighting: 380, fire: 560, flying: 500, ghost: 520, grass: 500,
    ground: 520, ice: 440,
    normal: 300, poison: 460, psychic: 480, rock: 420, steel: 320,
    water: 420, sound: 380, shine: 420,
  };

  // ---- レジストリ：moveType文字列 → spawn関数（豪華版／威力90超）----
  // 各タイプごとに専用設計した豪華版シーンを使用（共通ブースターの使い回しは廃止）。
  const BIG_SCENES = {
    bug: spawnBugBig,
    dark: spawnDarkBig,
    dragon: spawnDragonBig,
    electric: spawnElectricBig,
    fairy: spawnFairyBig,
    fighting: spawnFightingBig,
    fire: spawnFireBig,
    flying: spawnFlyingBig,
    ghost: spawnGhostBig,
    grass: spawnGrassBig,
    ground: spawnGroundBig,
    ice: spawnIceBig,
    normal: spawnNormalBig,
    poison: spawnPoisonBig,
    psychic: spawnPsychicBig,
    rock: spawnRockBig,
    steel: spawnSteelBig,
    water: spawnWaterBig,
    sound: spawnSoundBig,
    shine: spawnShineBig,
  };
  // 豪華版は通常版より尺を伸ばし、「ちょっと長い豪華な演出」に見せる。
  const BIG_DURATION_MS = {};
  Object.keys(DURATION_MS).forEach((key) => {
    BIG_DURATION_MS[key] = Math.round(DURATION_MS[key] * 1.6) + 260;
  });

  // ============================================================
  // 公開API： playCanvasTypeEffect(wrapEl, moveType, big) -> Promise
  // wrapEl: sprite-slot要素（position:relative）
  // moveType: 'fire' 'water' 'bug' ... などのタイプキー
  // big: true のとき、威力90超の技向けの豪華版シーンを再生する。
  // 対応シーンが無いタイプ（未実装分）は null を返し、呼び出し側で
  // 従来の絵文字エフェクトにフォールバックできるようにする。
  // ============================================================
  function playCanvasTypeEffect(wrapEl, moveType, big) {
    const scenes = big ? BIG_SCENES : SCENES;
    const spawn = scenes[moveType];
    if (!spawn || !wrapEl) return null;
    const rect = wrapEl.getBoundingClientRect();
    const w = Math.max(60, Math.round(rect.width || wrapEl.offsetWidth || 120));
    const h = Math.max(60, Math.round(rect.height || wrapEl.offsetHeight || 120));
    const dpr = Math.min(2, window.devicePixelRatio || 1);

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.position = 'absolute';
    canvas.style.left = '0';
    canvas.style.top = '0';
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    canvas.style.pointerEvents = 'none';
    canvas.style.zIndex = '5';
    canvas.className = 'type-fx-canvas';
    wrapEl.appendChild(canvas);

    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    const duration = (big ? BIG_DURATION_MS[moveType] : DURATION_MS[moveType]) || 420;
    return runParticleScene({
      canvas: { getContext: () => ctx, width: w, height: h },
      durationMs: duration,
      spawn,
    }).then(() => {
      canvas.remove();
    });
  }

  // ============================================================
  // 専用大技エフェクト：技ID → spawn関数（技ごとの専用フルスクリーン演出）
  // wrapEl には battle-field 全体（スプライト枠ではない、画面全体のコンテナ）を渡す。
  // ============================================================
  const SPECIAL_SCENES = {
    480: spawnInfernoSpecial,       // インフェルノ
    483: spawnMaelstromSpecial,     // メイルストローム
    484: spawnYggdrasillSpecial,    // イルミンスール
    253: spawnHyperBeamSpecial,      // はかいこうせん
254: spawnTrumpCardSpecial,      // きりふだ
273: spawnSludgeBombSpecial,     // ヘドロばくだん
277: spawnSludgeBombSpecial,     // バッドポイズン（ヘドロばくだんと共通演出）
53: spawnMeteorShowerSpecial,   // りゅうせいぐん
    73: spawnThunderSpecial,        // かみなり
    79: spawnThunderSpecial,        // ルクスノヴァ（かみなりと共通演出）
    93: spawnMoonblastSpecial, 
235: spawnBlizzardSpecial,      // ふぶき
   374: spawnMixingSpecial,  
 236: spawnBlizzardSpecial,      // ブリザード（ふぶきと共通演出）
    237: spawnBlizzardSpecial,      // ヘイルストーム（ふぶきと共通演出）
    312: spawnPowerGemSpecial,      // パワージェム（自分→相手へ宝石が飛翔する演出）
    315: spawnGemLaserSpecial,      // ジェムレーザー（宝石が光を集め、極太ビームを相手へ撃ち込む演出）
    13: spawnSignalBeamSpecial,     // シグナルビーム（渦を巻く虹色のリングを相手へ撃ち込む演出）
    18: spawnSignalBeamSpecial,     // 翔音セレナーデ（シグナルビームと共通演出）
    317: spawnGravelBreathSpecial,  // グラベルブレス（砂利まじりの息を、扇状の砂礫の奔流として相手へ吹きつける演出）
    132: spawnFlamethrowerSpecial,     // かえんほうしゃ
    133: spawnDaimonjiSpecial,         // だいもんじ（火球を撃ち込み、炎が「大」の字を描いて燃え広がる）
    216: spawnEarthPowerSpecial,       // だいちのちから（相手の足元が黄金に発光→亀裂→大地のエネルギー噴出）
    78: spawnLuxionAirSpecial,        // ルクシオンエア（オリジナル・りゅうせいぐんのでんき版、雷を帯びた竜巻が相手を包む）
    215: spawnEarthPowerSpecial,       // （だいちのちからと共通演出）
    138: spawnFireWhirlwindSpecial,  // かさいせんぷう
    499: spawnFireWhirlwindSpecial,  // やけのはら（かさいせんぷうと共通演出）
    72: spawnThunderboltSpecial,     // 10まんボルト
    75: spawnThunderboltSpecial,     // ほうでん（10まんボルトと共通演出）
    76: spawnThunderboltSpecial,     // パラボラチャージ（10まんボルトと共通演出）
  233: spawnIceBeamSpecial,         // れいとうビーム
  332: spawnFlashCannonSpecial,     // ラスターカノン
153: spawnKamikazeSpecial,
  156: spawnKamikazeSpecial,
  157: spawnKamikazeSpecial,
  353: spawnHydroPumpSpecial,
  354: spawnAquaVoltSpecial,
  355: spawnSurfSpecial,
  123: spawnFlareDriveSpecial,      // フレアドライブ（炎を纏って突進→激突→戻る）
  63: spawnThunderDiveSpecial,      // サンダーダイブ（フレアドライブのでんき版）
  66: spawnThunderDiveSpecial,      // エレキスピン（サンダーダイブと共通演出）
  43: spawnOutrageFallbackSpecial,  // げきりん（DP実機再現。通常はplayOutrageOnCanvas経由、これはフォールバック用）
  333: spawnBehemothBeamSpecial,   // てっていこうせん（剣盾・鋼の巨大ビーム＋反動の演出）
  334: spawnBehemothBeamSpecial,   // （てっていこうせんと共通演出）
  335: spawnBehemothBeamSpecial,   // （てっていこうせんと共通演出）
  338: spawnBehemothBeamSpecial,   // （てっていこうせんと共通演出）
318: spawnStealthRockSpecial,   // ステルスロック（岩が相手を取り巻き、透明になって消える設置演出）
  32: spawnDarkPulseSpecial,      // あくのはどう（黒紫の波動の輪を相手へ放つ演出）
  33: spawnDarkPulseSpecial,      // （あくのはどうと共通演出）
  37: spawnDarkPulseSpecial,      // （あくのはどうと共通演出）
  173: spawnShadowBallSpecial,    // シャドーボール（影の球を作って相手へ投げつける演出）
  112: spawnAuraSphereSpecial,    // はどうだん（水色の波動の球を作って相手へ撃ち出す演出）
  113: spawnFocusBlastSpecial,    // きあいだま（気を溜めた金色の大きな球を相手へ撃ち出す演出）
  117: spawnAuraFistSpecial,      // オーラファイト（念を込めた赤い薄いオーラの拳を作って相手へ飛ばす演出）
  292: spawnPsykinesisSpecial,    // サイコキネシス（DP版の原作演出：紫の波紋・螺旋オーラ・浮遊）
  300: spawnPsykinesisSpecial,    // （サイコキネシスと共通演出）
  103: spawnCloseCombatSpecial,   // インファイト（XY／サンムーン系：踏み込み→乱打→フィニッシュ）
  203: spawnEarthquakeSpecial,    // じしん（XY系：全画面の地割れ・岩柱・土煙演出）
  172: spawnNightShadeSpecial,    // ひゃっきやこう（レジェンズアルセウス／SV系：2つの魂がX字に交差して命中）
  175: spawnNightShadeSpecial,    // （ひゃっきやこうと共通演出）
  61: spawnThunderFangSpecial,    // かみなりのキバ（電撃の牙で噛みつく）
  222: spawnIceFangSpecial,       // こおりのキバ（冷気の牙で噛みつく）
  124: spawnFireFangSpecial,      // ほのおのキバ（火炎の牙で噛みつく）
  7: spawnLeechBiteSpecial,       // きゅうけつ（あくの牙で噛みつき、HPを吸い取る）
  24: spawnBiteSpecialMove,       // かみつく（あくの牙でシンプルに一噛み）
  25: spawnCrunchSpecial,         // かみくだく（あくの牙で鋭く砕く）
  28: spawnDarkFangSpecial,       // じゃあくなキバ（オリジナル・あくの牙、威力120）
  284: spawnPsychicFangSpecial,   // サイコファング（エスパーの牙）
  348: spawnAquaFangSpecial,      // ディーナスバイト（オリジナル・みずの牙、威力120）
  227: spawnSleetSpearSpecial,    // スリートスピア（オリジナル・氷の長槍を結晶化させて投げつける、威力120）
  218: spawnGaiaCubeSpecial,      // ガイアキューブ（オリジナル・古代キューブを撃ち込み、大地の力を解放する、威力200）
  139: spawnRapidFlareSpecial,    // ラピッドフレア（オリジナル・疾走する炎弾を撃ち込み、自分に素早さの疾風オーラを纏う）
  198: spawnThornBindSpecial,     // いばらがため（オリジナル・足元から茨が絡みつき、力を吸い取る／HP75%ドレイン）
  };
  // 攻撃側スプライト→防御側スプライトの座標が必要な（飛翔型の）専用演出の技ID。
  const FLIGHT_MOVE_IDS = [312,123,63,66, 153,156,157,353,354,355,253,254,273,277,315,78,132,133,215,216,233,332,317, 318, 72, 75, 76, 13, 18, 32, 33, 37, 173, 112, 113, 117, 292, 300, 103, 172, 175, 61, 222, 124, 7, 24, 25, 28, 284, 348, 227, 218, 139, 198, 43, 333, 334, 335, 338];
  const SPECIAL_DURATION_MS = {
    480: 1900,
    483: 1900,
    484: 1900,
    53: 3000,
    73: 1700,
    79: 1700,
    93: 2200,
    235: 1800,
    236: 1800,
    374: 1800,
    237: 1800,
    153: KAMIKAZE_END_MS + 200,
156: KAMIKAZE_END_MS + 200,
157: KAMIKAZE_END_MS + 200,
353: HYDROPUMP_END_MS + 260,
354: AQUAVOLT_END_MS + 260,
355: SURF_END_MS + 200,
    253: HYPERBEAM_END_MS + 260,
254: TRUMPCARD_END_MS + 200,
273: SLUDGEBOMB_END_MS + 260,
277: SLUDGEBOMB_END_MS + 260,
    312: POWERGEM_FINAL_IMPACT_MS + 620,   // 最終着弾 + 余韻（破片・光の粒が消えるまで）
    315: GEMLASER_END_MS + 480,            // ビームが消えた後の爆ぜ・破片が消えるまで
    13: SIGNALBEAM_END_MS + 420,           // シグナルビーム：着弾後の光の粒が消えるまで
    18: SIGNALBEAM_END_MS + 420,           // 翔音セレナーデ（シグナルビームと共通）
    317: GRAVELBREATH_END_MS + 560,        // 砂礫が届き終わった後、砂煙が晴れるまで
    132: FLAMETHROWER_END_MS + 220,   // かえんほうしゃ
    133: DAIMONJI_END_MS,             // だいもんじ：大の字が爆ぜた後の火の粉・黒煙が消えるまで
    216: EARTHPOWER_END_MS,            // だいちのちから：地割れの跡と土煙が消えるまで
    78: LUXIONAIR_END_MS,               // ルクシオンエア：静電気の火花と暗雲の残骸が消えるまで
    215: EARTHPOWER_END_MS,            // （だいちのちからと共通演出）
    138: 2000,  // かさいせんぷう
    499: 2000,  // やけのはら（かさいせんぷうと共通）
    72: THUNDERBOLT_END_MS,   // 10まんボルト
    75: THUNDERBOLT_END_MS,   // ほうでん（10まんボルトと共通）
    76: THUNDERBOLT_END_MS,   // パラボラチャージ（10まんボルトと共通）
  233: ICEBEAM_END_MS + 260,        // れいとうビーム
  332: FLASHCANNON_END_MS + 260,
  123: FLAREDRIVE_END_MS + 200,
  63: THUNDERDIVE_END_MS + 200,
  66: THUNDERDIVE_END_MS + 200,
  43: OUTRAGE_END_MS + 100,             // げきりん：赤紫フラッシュと衝撃線が消えるまで
  333: BEHEMOTHBEAM_END_MS + 260,       // てっていこうせん：破片・金属粉と反動の亀裂が消えるまで
  334: BEHEMOTHBEAM_END_MS + 260,       // （てっていこうせんと共通演出）
  335: BEHEMOTHBEAM_END_MS + 260,       // （てっていこうせんと共通演出）
  338: BEHEMOTHBEAM_END_MS + 260,       // （てっていこうせんと共通演出）
318: STEALTHROCK_END_MS + 420,         // 岩が溶けきった後、足元のひび割れの余韻が消えるまで
  32: DARKPULSE_END_MS + 200,            // あくのはどう：靄と闇の粒が消えるまで
  33: DARKPULSE_END_MS + 200,            // （あくのはどうと共通）
  37: DARKPULSE_END_MS + 200,            // （あくのはどうと共通）
  173: SHADOWBALL_END_MS + 200,          // シャドーボール：影の靄が消えるまで
  112: AURASPHERE_END_MS + 200,          // はどうだん：光の粒が消えるまで
  113: FOCUSBLAST_END_MS + 200,          // きあいだま：金色の火の粉が消えるまで
  292: PSYKINESIS_END_MS,       // サイコキネシス：浮遊が収まり残光が消えるまで
  300: PSYKINESIS_END_MS,       // （サイコキネシスと共通）
  103: CLOSECOMBAT_END_MS,      // インファイト：フィニッシュの衝撃波が消えるまで
  203: QUAKE_END_MS,            // じしん：土煙が晴れるまで
  172: NIGHTSHADE_END_MS,       // ひゃっきやこう：着弾の光の粒が消えるまで
  175: NIGHTSHADE_END_MS,       // （ひゃっきやこうと共通）
  61: FANG_END_MS,              // かみなりのキバ
  222: FANG_END_MS,             // こおりのキバ
  124: FANG_END_MS,             // ほのおのキバ
  7: FANG_END_MS + 200,         // きゅうけつ：HP吸収の粒子が攻撃側に戻るまで少し長め
  24: FANG_END_MS,              // かみつく
  25: FANG_END_MS + 100,        // かみくだく：破片が飛び散り終わるまでやや長め
  28: FANG_END_MS + 160,        // じゃあくなキバ：衝撃波・爪痕が消えるまで
  284: FANG_END_MS + 180,       // サイコファング：波紋と浮遊する光の粒が消えるまで
  348: FANG_END_MS + 160,       // ディーナスバイト：水しぶきと水柱が消えるまで
  227: SLEETSPEAR_END_MS,       // スリートスピア：氷片と霜の余韻が消えるまで
  218: GAIACUBE_END_MS,         // ガイアキューブ：土煙とキューブの残光が消えるまで
  139: RAPIDFLARE_END_MS,       // ラピッドフレア：疾風オーラの余韻が消えるまで
  198: THORN_END_MS + 120,      // いばらがため：茨が枯れて崩れ、塵が消えるまで
  117: AURAFIST_END_MS + 200,            // オーラファイト：赤い火の粉と靄が消えるまで
  };
  // 技ごとの画面シェイク・フラッシュ演出設定（インパクトの瞬間＝delayに合わせて発火）
  const SPECIAL_IMPACT_FX = {
    480: { // インフェルノ：噴き上がりの瞬間に強いオレンジフラッシュ＋激しいシェイク
      flashes: [
        { color: '#fff3c4', peakAlpha: 0.9, durationMs: 260, delay: 170 },
        { color: '#ff6a1a', peakAlpha: 0.45, durationMs: 420, delay: 210 },
      ],
      shakes: [
        { ampPx: 3, durationMs: 160, freq: 30, delay: 0 },
        { ampPx: 20, durationMs: 520, freq: 34, delay: 175 },
      ],
    },
    483: { // メイルストローム：水柱が突き上げる瞬間に青白いフラッシュ＋うねる横揺れ
      flashes: [
        { color: '#eaf8ff', peakAlpha: 0.8, durationMs: 260, delay: 190 },
        { color: '#3ca0e6', peakAlpha: 0.35, durationMs: 460, delay: 230 },
      ],
      shakes: [
        { ampPx: 3, durationMs: 180, freq: 20, delay: 0 },
        { ampPx: 16, durationMs: 560, freq: 22, delay: 195 },
      ],
    },
    484: { // イルミンスール：大樹が突き上げる瞬間に緑白フラッシュ＋重い縦揺れ
      flashes: [
        { color: '#f4ffd8', peakAlpha: 0.75, durationMs: 260, delay: 210 },
        { color: '#4a8a2a', peakAlpha: 0.3, durationMs: 480, delay: 250 },
      ],
      shakes: [
        { ampPx: 3, durationMs: 180, freq: 18, delay: 0 },
        { ampPx: 18, durationMs: 600, freq: 16, delay: 215 },
      ],
    },
   374: {
  flashes: [
    { color: '#ffb347', peakAlpha: 0.28, durationMs: 350, delay: 400 },
    { color: '#ffe8ff', peakAlpha: 0.35, durationMs: 260, delay: 1100 },  // 白→淡いピンク、αも0.9→0.35
    { color: '#ff4fa8', peakAlpha: 0.28, durationMs: 500, delay: 1130 },
  ],
  shakes: [
    { ampPx: 4,  durationMs: 120, freq: 38, delay: 400 },
    { ampPx: 5,  durationMs: 120, freq: 40, delay: 700 },
    { ampPx: 6,  durationMs: 120, freq: 42, delay: 950 },
    { ampPx: 12, durationMs: 520, freq: 30, delay: 1100 },   // 24→12に半減
  ],
},
 // 追記（SPECIAL_IMPACT_FX オブジェクトの末尾、既存の特殊ID共有の直前あたり）
93: { // ムーンフォース：月光の柱が着弾する瞬間に白銀の閃光＋優美で力強い揺れ
  flashes: [
    { color: '#f0eaff', peakAlpha: 0.45, durationMs: 500, delay: 500 },   // 満月が最大輝度に達した時
    { color: '#ffffff', peakAlpha: 0.9,  durationMs: 240, delay: 1150 },  // 光の柱の着弾
    { color: '#ffb8e0', peakAlpha: 0.35, durationMs: 500, delay: 1180 },  // フェアリー色の余韻
  ],
  shakes: [
    { ampPx: 3,  durationMs: 350, freq: 14, delay: 400 },   // 満月が浮かぶ静かな揺れ
    { ampPx: 18, durationMs: 560, freq: 22, delay: 1150 },  // 光の柱の着弾
  ],
},
53: { // りゅうせいぐん：流星の雨の間は細かく揺れ続け、主星の着弾で白飛び＋最大級のシェイク
      // 主星の着弾タイミング = rainStart(300) + rainSpan(1000) + 200 + bigFlight(560) = 2060ms
      flashes: [
        { color: '#ffe9b0', peakAlpha: 0.3, durationMs: 260, delay: 1800 },  // 主星の接近（空が赤熱する）
        { color: '#ffffff', peakAlpha: 0.85, durationMs: 200, delay: 2060 }, // 着弾の白飛び（着弾の瞬間が見える強さに抑える）
        { color: '#ff8a2a', peakAlpha: 0.4, durationMs: 520, delay: 2090 },  // 大爆発の熱（明るい背景で白く飛び過ぎない強さ）
      ],
      shakes: [
        { ampPx: 4, durationMs: 1500, freq: 34, delay: 400 },   // 流星が降り注ぐ間の連続した細かい振動
        { ampPx: 26, durationMs: 800, freq: 30, delay: 2060 },  // 主星の着弾
      ],
    },
    73: { // かみなり：落雷の瞬間に真っ白な閃光を複数回明滅＋鋭く短いシェイク（雷特有のビリビリ感）
      flashes: [
        { color: '#ffffff', peakAlpha: 0.95, durationMs: 140, delay: 170 },
        { color: '#ffffff', peakAlpha: 0.5, durationMs: 140, delay: 225 },
        { color: '#c9b8ff', peakAlpha: 0.4, durationMs: 320, delay: 280 },
      ],
      shakes: [
        { ampPx: 2, durationMs: 100, freq: 40, delay: 0 },
        { ampPx: 22, durationMs: 340, freq: 46, delay: 168 },
      ],
    },
    138: { // かさいせんぷう：山火事が燃え広がる立ち上がりで赤いフラッシュ、
           // 火災旋風が頂点で破裂する瞬間に強いオレンジフラッシュ＋激しいシェイク
      flashes: [
        { color: '#ff7a1a', peakAlpha: 0.35, durationMs: 300, delay: 60 },
        { color: '#fff3c4', peakAlpha: 0.9, durationMs: 260, delay: 680 },
        { color: '#ff6a1a', peakAlpha: 0.45, durationMs: 480, delay: 710 },
      ],
      shakes: [
        { ampPx: 3, durationMs: 200, freq: 24, delay: 40 },
        { ampPx: 22, durationMs: 560, freq: 32, delay: 680 },
      ],
    },
    499: null, // やけのはらはSPECIAL_IMPACT_FX[138]を後で共有代入
    235: { // ふぶき：結晶が突き刺さる瞬間に白い閃光＋固く鋭いシェイク
      flashes: [
        { color: '#ffffff', peakAlpha: 0.85, durationMs: 220, delay: 440 },
        { color: '#bfe8ff', peakAlpha: 0.4, durationMs: 420, delay: 470 },
      ],
      shakes: [
        { ampPx: 2, durationMs: 140, freq: 22, delay: 0 },
        { ampPx: 15, durationMs: 420, freq: 28, delay: 445 },
      ],
    },
  };
  // パワージェム：全弾着弾の瞬間に画面フラッシュだけを入れる（画面シェイクは入れない）。
  // 宝石が相手に飛んでいく様子を主役にするため、画面全体は揺らさない。
  // 時刻は spawnPowerGemSpecial の定数（POWERGEM_*）と連動させている。
  (function () {
    const fin = POWERGEM_FINAL_IMPACT_MS;
    const firstHit = POWERGEM_CHARGE_MS + POWERGEM_FLIGHT_MS;        // 最初の宝石の着弾
    SPECIAL_IMPACT_FX[312] = {
      flashes: [
        { color: '#ffd0ea', peakAlpha: 0.28, durationMs: 200, delay: firstHit },   // 初弾の着弾（うっすら）
        { color: '#ffffff', peakAlpha: 0.7, durationMs: 220, delay: fin },         // 全弾着弾の閃光
        { color: '#9fe0ff', peakAlpha: 0.32, durationMs: 420, delay: fin + 30 },   // 宝石色の余韻
      ],
      shakes: [],   // シェイクなし
    };
  })();
  // オーラファイト：画面シェイクなし（あくのはどう・はどうだん・きあいだまと同じ方針）。
  // 拳そのものが「薄く透ける赤いオーラ」なので、画面フラッシュは念を込め始めた瞬間・放つ瞬間・命中の瞬間に、
  // 赤を淡く重ねるだけにしている。命中の白ピンクの閃光は canvas 内（中心のグロー）が担当し、画面全体は白飛びさせない。
  // 時刻は spawnAuraFistSpecial の定数（AURAFIST_*）と連動させている。
  SPECIAL_IMPACT_FX[117] = {
    flashes: [
      { color: '#ff2a3a', peakAlpha: 0.1, durationMs: 220, delay: 40 },                           // 念を込め始める（ごく淡く）
      { color: '#ff6a70', peakAlpha: 0.16, durationMs: 200, delay: AURAFIST_LAUNCH_MS - 30 },     // 握り込んで放つ直前
      { color: '#ffd0d4', peakAlpha: 0.32, durationMs: 240, delay: AURAFIST_HIT_MS },             // 拳が命中した瞬間
      { color: '#ff2a3a', peakAlpha: 0.22, durationMs: 440, delay: AURAFIST_HIT_MS + 30 },        // 赤の余韻
    ],
    shakes: [],   // シェイクなし
  };
  // スリートスピア：構えて放つ直前に淡い水色の瞬き、氷の槍が突き刺さった瞬間に
  // 白〜水色のフラッシュと軽いシェイク（威力120の刺突技らしい重さを出す）。
  SPECIAL_IMPACT_FX[227] = {
    flashes: [
      { color: '#8fd8ff', peakAlpha: 0.12, durationMs: 200, delay: 40 },                            // 冷気を練り始める（ごく淡く）
      { color: '#eafcff', peakAlpha: 0.18, durationMs: 180, delay: SLEETSPEAR_LAUNCH_MS - 25 },      // 構え直して放つ直前
      { color: '#ffffff', peakAlpha: 0.55, durationMs: 200, delay: SLEETSPEAR_HIT_MS },              // 氷の槍が突き刺さった瞬間
      { color: '#2f8fd4', peakAlpha: 0.3, durationMs: 440, delay: SLEETSPEAR_HIT_MS + 30 },          // 水色の余韻
    ],
    shakes: [
      { ampPx: 11, durationMs: 210, freq: 34, delay: SLEETSPEAR_HIT_MS },
    ],
  };
  // ガイアキューブ：威力200・反動技という原作の重さに見合う、本作最大級のフラッシュ・シェイク。
  // ①キューブが次々と突き刺さる間は控えめな金色の点滅、②大地の力が解放される瞬間に
  // 白〜金の強い閃光、③岩柱が突き上がる間はじしんを上回る長く重い縦揺れを入れている。
  // 時刻は spawnGaiaCubeSpecial の定数（GAIACUBE_*）と連動させている。
  SPECIAL_IMPACT_FX[218] = {
    flashes: [
      { color: '#fff2c0', peakAlpha: 0.16, durationMs: 180, delay: GAIACUBE_CHARGE_MS },                    // 練成完了・発射開始
      { color: '#e8c878', peakAlpha: 0.14, durationMs: 200, delay: GAIACUBE_FINAL_IMPACT_MS },              // 最後のキューブが突き刺さる
      { color: '#ffffff', peakAlpha: 0.95, durationMs: 220, delay: GAIACUBE_RELEASE_MS },                   // 大地の力・解放
      { color: '#c9a24a', peakAlpha: 0.5, durationMs: 460, delay: GAIACUBE_RELEASE_MS + 40 },               // 金褐色の余韻
      { color: '#b08a4e', peakAlpha: 0.34, durationMs: 480, delay: GAIACUBE_RELEASE_MS + 220 },             // 土埃が最も舞う瞬間
    ],
    shakes: [
      { ampPx: 6, durationMs: 160, freq: 30, delay: GAIACUBE_FINAL_IMPACT_MS },                             // 最後のキューブが刺さる瞬間の小さな衝撃
      { ampPx: 30, durationMs: GAIACUBE_PILLAR_MS + 520, freq: 18, delay: GAIACUBE_RELEASE_MS },            // 大地の力解放：じしんを上回る長く重い縦揺れ
    ],
  };
  // いばらがため：茨が地面を割る瞬間に小さな地鳴り、巻きつき・締め付けの瞬間に
  // 控えめな緑白のフラッシュと短い横揺れ。ドレイン技なので、吸収が始まる瞬間には
  // 画面ではなく攻撃側の回復フラッシュ（canvas内）を主役にし、画面全体は揺らさない。
  // 時刻は spawnThornBindSpecial の定数（THORN_*）と連動させている。
  SPECIAL_IMPACT_FX[198] = {
    flashes: [
      { color: '#c8ff9a', peakAlpha: 0.08, durationMs: 200, delay: THORN_HIT_MS - 30 },          // 巻きつき完了
      { color: '#eaffd0', peakAlpha: 0.14, durationMs: 160, delay: THORN_HIT_MS },                // 締め付けの瞬間
      { color: '#2f7a2a', peakAlpha: 0.2, durationMs: 420, delay: THORN_HIT_MS + 30 },           // 深緑の余韻
      { color: '#d8ffa0', peakAlpha: 0.12, durationMs: 260, delay: THORN_DRAIN_START_MS + 300 }, // 攻撃側へ力が届く
    ],
    shakes: [
      { ampPx: 4, durationMs: 200, freq: 24, delay: THORN_QUAKE_MS - 30 },   // 地面を割って茨が出る
      { ampPx: 8, durationMs: 220, freq: 30, delay: THORN_HIT_MS },          // 締め付け
    ],
  };
  // ラピッドフレア：着弾の瞬間に橙のフラッシュ＋短いシェイク、その後、素早さが
  // 上がる瞬間にごく淡い黄緑のフラッシュを重ねる（ステータス変化の合図、控えめに）。
  // 時刻は spawnRapidFlareSpecial の定数（RAPIDFLARE_*）と連動させている。
  SPECIAL_IMPACT_FX[139] = {
    flashes: [
      { color: '#fff3c0', peakAlpha: 0.14, durationMs: 140, delay: RAPIDFLARE_LAUNCH_MS - 20 },   // 発射直前の圧縮
      { color: '#ffd23a', peakAlpha: 0.42, durationMs: 180, delay: RAPIDFLARE_HIT_MS },            // 着弾の瞬間
      { color: '#ff7a1a', peakAlpha: 0.22, durationMs: 340, delay: RAPIDFLARE_HIT_MS + 30 },       // 橙の余韻
      { color: '#c8ef4a', peakAlpha: 0.14, durationMs: 320, delay: RAPIDFLARE_HIT_MS + 140 },      // 素早さアップの淡い黄緑
    ],
    shakes: [
      { ampPx: 8, durationMs: 170, freq: 32, delay: RAPIDFLARE_HIT_MS },
    ],
  };
  // きあいだま：画面シェイクなし（あくのはどう・はどうだんと同じ方針）。球そのものが金色の光なので、
  // 画面フラッシュは球が生まれる瞬間・放つ瞬間・命中の瞬間に、金色を淡く重ねるだけにしている。
  // 命中の白い閃光は canvas 内（中心の白いグロー）が担当し、画面全体は白飛びさせない。
  // 時刻は spawnFocusBlastSpecial の定数（FOCUSBLAST_*）と連動させている。
  SPECIAL_IMPACT_FX[113] = {
    flashes: [
      { color: '#ffd83a', peakAlpha: 0.14, durationMs: 220, delay: 20 },                          // 球が生まれる瞬間（ごく淡く）
      { color: '#ffe680', peakAlpha: 0.2, durationMs: 200, delay: FOCUSBLAST_LAUNCH_MS - 30 },    // 放つ直前、気が詰まった瞬間
      { color: '#fff4c2', peakAlpha: 0.36, durationMs: 260, delay: FOCUSBLAST_HIT_MS },           // 球が命中した瞬間
      { color: '#ffaa1c', peakAlpha: 0.24, durationMs: 460, delay: FOCUSBLAST_HIT_MS + 30 },      // 金〜橙の余韻
    ],
    shakes: [],   // シェイクなし
  };
  // はどうだん：画面シェイクなし（DP準拠）。球そのものが明るい水色の光なので、
  // 画面フラッシュは球が生まれる瞬間と命中の瞬間に、水色を淡く重ねるだけにしている。
  // 命中の白い閃光は canvas 内（中心の白いグロー）が担当し、画面全体は白飛びさせない。
  // 時刻は spawnAuraSphereSpecial の定数（AURASPHERE_*）と連動させている。
  SPECIAL_IMPACT_FX[112] = {
    flashes: [
      { color: '#5fd8ff', peakAlpha: 0.16, durationMs: 220, delay: 20 },                         // 球が生まれる瞬間（ごく淡く）
      { color: '#eaf8ff', peakAlpha: 0.34, durationMs: 240, delay: AURASPHERE_HIT_MS },          // 球が命中した瞬間
      { color: '#5fd8ff', peakAlpha: 0.22, durationMs: 420, delay: AURASPHERE_HIT_MS + 30 },     // 水色の余韻
    ],
    shakes: [],   // シェイクなし
  };
  // サイコキネシス（attack292／attack300は共通）：
  // 念動力による演出なので、物理的な衝撃を思わせる画面シェイクは使わない。
  // 波紋が立ち上がる瞬間にごく淡い紫を、相手が浮き上がって光る瞬間に
  // 強めの紫〜白のフラッシュを重ねて「持ち上げられた」感を出す。
  // 時刻は spawnPsykinesisSpecial の定数（PSYKINESIS_*）と連動させている。
  SPECIAL_IMPACT_FX[292] = {
    flashes: [
      { color: '#c874ff', peakAlpha: 0.14, durationMs: 260, delay: 20 },                          // 波紋が立ち上がる瞬間（ごく淡く）
      { color: '#ffffff', peakAlpha: 0.5, durationMs: 220, delay: PSYKINESIS_HIT_MS },            // 浮遊とともに白く光る瞬間
      { color: '#b34fff', peakAlpha: 0.32, durationMs: 460, delay: PSYKINESIS_HIT_MS + 30 },      // 紫の余韻
    ],
    shakes: [],   // シェイクなし（念動力の演出のため物理的な振動は使わない）
  };
  SPECIAL_IMPACT_FX[300] = SPECIAL_IMPACT_FX[292];
  // インファイト（attack103）：XY／サンムーン系の近接乱打演出。
  // 通常打撃4発それぞれに軽いフラッシュと小刻みなシェイクを合わせ、
  // 「連続で殴られている」体感を出す。最後のフィニッシュだけ一回り強く。
  // 時刻は spawnCloseCombatSpecial の定数（CLOSECOMBAT_*）と連動させている。
  (function () {
    const flashes = [];
    const shakes = [];
    for (let i = 0; i < CLOSECOMBAT_HIT_COUNT; i++) {
      const at = CLOSECOMBAT_FIRST_HIT_MS + i * CLOSECOMBAT_HIT_GAP_MS;
      flashes.push({ color: '#fff3d6', peakAlpha: 0.3, durationMs: 140, delay: at });
      shakes.push({ ampPx: 6, durationMs: 110, freq: 46, delay: at });
    }
    flashes.push({ color: '#ffffff', peakAlpha: 0.6, durationMs: 200, delay: CLOSECOMBAT_FINISH_MS });
    flashes.push({ color: '#ff8c2a', peakAlpha: 0.3, durationMs: 380, delay: CLOSECOMBAT_FINISH_MS + 30 });
    shakes.push({ ampPx: 20, durationMs: 340, freq: 34, delay: CLOSECOMBAT_FINISH_MS });
    SPECIAL_IMPACT_FX[103] = { flashes, shakes };
  })();
  // じしん（attack203）：全画面演出。地面が割れて岩柱が突き上がる「本震」を、
  // 縦成分を強めた長い画面シェイクと、土色の全画面フラッシュで表現する。
  // 時刻は spawnEarthquakeSpecial の定数（QUAKE_*）と連動させている。
  SPECIAL_IMPACT_FX[203] = {
    flashes: [
      { color: '#b08a4e', peakAlpha: 0.22, durationMs: 260, delay: QUAKE_PRE_MS },              // 本震の始まり
      { color: '#c9a06a', peakAlpha: 0.3, durationMs: 420, delay: QUAKE_DUST_PEAK_MS },         // 土埃が最も舞う瞬間
    ],
    shakes: [
      { ampPx: 5, durationMs: QUAKE_PRE_MS, freq: 30, delay: 0 },                                // ①予兆の小さな縦揺れ
      { ampPx: 24, durationMs: QUAKE_PILLAR_MS + 460, freq: 20, delay: QUAKE_PRE_MS },           // ②③本震：長く重い縦揺れ
    ],
  };
  // ひゃっきやこう（attack172／attack175は共通）：
  // 2つの魂がX字に交差して両側から命中する演出。画面フラッシュは
  // 交差の瞬間にごく淡く、着弾の瞬間に青白い光を少し強めに重ねる。
  // 画面シェイクは軽めにして「実体のない魂による攻撃」の質感を保つ。
  // 時刻は spawnNightShadeSpecial の定数（NIGHTSHADE_*）と連動させている。
  (function () {
    const crossDelay = NIGHTSHADE_FORM_MS + NIGHTSHADE_FLIGHT_MS * NIGHTSHADE_CROSS_T;
    SPECIAL_IMPACT_FX[172] = {
      flashes: [
        { color: '#7fe8ff', peakAlpha: 0.16, durationMs: 200, delay: crossDelay },              // X字交差の瞬間
        { color: '#eaffff', peakAlpha: 0.45, durationMs: 200, delay: NIGHTSHADE_HIT_MS },       // 着弾の瞬間
        { color: '#2a9fd6', peakAlpha: 0.24, durationMs: 400, delay: NIGHTSHADE_HIT_MS + 30 },  // 青の余韻
      ],
      shakes: [
        { ampPx: 10, durationMs: 220, freq: 30, delay: NIGHTSHADE_HIT_MS },
      ],
    };
    SPECIAL_IMPACT_FX[175] = SPECIAL_IMPACT_FX[172];
  })();
  // 「きば」系技（かみなりのキバ／こおりのキバ／ほのおのキバ）共通方針：
  // 噛みついた瞬間に白い芯＋属性色のフラッシュ、軽い画面シェイクを1回だけ入れる。
  // 時刻は spawnFangSpecial の定数（FANG_*）と共通で連動させている。
  SPECIAL_IMPACT_FX[61] = {
    flashes: [
      { color: '#fff9c4', peakAlpha: 0.5, durationMs: 200, delay: FANG_BITE_MS },
      { color: '#ffe600', peakAlpha: 0.26, durationMs: 380, delay: FANG_BITE_MS + 30 },
    ],
    shakes: [
      { ampPx: 10, durationMs: 200, freq: 38, delay: FANG_BITE_MS },
    ],
  };
  SPECIAL_IMPACT_FX[222] = {
    flashes: [
      { color: '#ffffff', peakAlpha: 0.5, durationMs: 200, delay: FANG_BITE_MS },
      { color: '#8fe0ff', peakAlpha: 0.26, durationMs: 400, delay: FANG_BITE_MS + 30 },
    ],
    shakes: [
      { ampPx: 8, durationMs: 200, freq: 32, delay: FANG_BITE_MS },
    ],
  };
  SPECIAL_IMPACT_FX[124] = {
    flashes: [
      { color: '#fff3b0', peakAlpha: 0.5, durationMs: 200, delay: FANG_BITE_MS },
      { color: '#ff7a1a', peakAlpha: 0.26, durationMs: 380, delay: FANG_BITE_MS + 30 },
    ],
    shakes: [
      { ampPx: 10, durationMs: 200, freq: 36, delay: FANG_BITE_MS },
    ],
  };
  // 「噛みつき」系技（きゅうけつ／かみつく／かみくだく／じゃあくなキバ／
  // サイコファング／ディーナスバイト）：噛みついた瞬間に閃光＋シェイクを1回。
  // きゅうけつはHP吸収の余韻があるので、シェイクを短め・控えめにしている。
  SPECIAL_IMPACT_FX[7] = {
    flashes: [
      { color: '#ffe0e2', peakAlpha: 0.4, durationMs: 200, delay: FANG_BITE_MS },
      { color: '#c23b4a', peakAlpha: 0.2, durationMs: 360, delay: FANG_BITE_MS + 30 },
    ],
    shakes: [
      { ampPx: 6, durationMs: 160, freq: 30, delay: FANG_BITE_MS },
    ],
  };
  SPECIAL_IMPACT_FX[24] = {
    flashes: [
      { color: '#e8d9ff', peakAlpha: 0.4, durationMs: 180, delay: FANG_BITE_MS },
      { color: '#6a3fa0', peakAlpha: 0.2, durationMs: 320, delay: FANG_BITE_MS + 30 },
    ],
    shakes: [
      { ampPx: 6, durationMs: 160, freq: 30, delay: FANG_BITE_MS },
    ],
  };
  SPECIAL_IMPACT_FX[25] = {
    flashes: [
      { color: '#ffffff', peakAlpha: 0.55, durationMs: 200, delay: FANG_BITE_MS },
      { color: '#7a4fc4', peakAlpha: 0.28, durationMs: 380, delay: FANG_BITE_MS + 30 },
    ],
    shakes: [
      { ampPx: 12, durationMs: 220, freq: 40, delay: FANG_BITE_MS },
    ],
  };
  SPECIAL_IMPACT_FX[28] = {
    flashes: [
      { color: '#e8d9ff', peakAlpha: 0.55, durationMs: 220, delay: FANG_BITE_MS },
      { color: '#7a3fd4', peakAlpha: 0.32, durationMs: 420, delay: FANG_BITE_MS + 30 },
    ],
    shakes: [
      { ampPx: 14, durationMs: 240, freq: 38, delay: FANG_BITE_MS },
    ],
  };
  SPECIAL_IMPACT_FX[284] = {
    flashes: [
      { color: '#ffe0fa', peakAlpha: 0.5, durationMs: 220, delay: FANG_BITE_MS },
      { color: '#ff5fb0', peakAlpha: 0.28, durationMs: 420, delay: FANG_BITE_MS + 30 },
    ],
    shakes: [
      { ampPx: 8, durationMs: 200, freq: 30, delay: FANG_BITE_MS },
    ],
  };
  SPECIAL_IMPACT_FX[348] = {
    flashes: [
      { color: '#e8fbff', peakAlpha: 0.55, durationMs: 220, delay: FANG_BITE_MS },
      { color: '#2fb0e6', peakAlpha: 0.3, durationMs: 420, delay: FANG_BITE_MS + 30 },
    ],
    shakes: [
      { ampPx: 12, durationMs: 220, freq: 34, delay: FANG_BITE_MS },
    ],
  };
  // シャドーボール：あくのはどうと同じ方針（画面シェイクなし・白い閃光なし）。
  // 「暗く沈む」表現は canvas 内（source-over の暗転）が担当し、画面フラッシュは
  // 球が生まれる瞬間と命中の瞬間に、ごく淡い赤紫を重ねるだけにしている。
  // 時刻は spawnShadowBallSpecial の定数（SHADOWBALL_*）と連動させている。
  SPECIAL_IMPACT_FX[173] = {
    flashes: [
      { color: '#a02cff', peakAlpha: 0.14, durationMs: 220, delay: 20 },                        // 球が生まれる瞬間（ごく淡く）
      { color: '#c845f0', peakAlpha: 0.26, durationMs: 340, delay: SHADOWBALL_HIT_MS },         // 球が命中して弾ける瞬間
    ],
    shakes: [],   // シェイクなし
  };
  // あくのはどう：画面シェイクなし（ご要望）。白い閃光は使わず、光はごく控えめな赤紫のみ。
  // 「暗く沈む」表現はcanvas内（source-over の暗転）が担当する。screenFlashは mix-blend-mode:screen の
  // 加算合成なので、黒を指定しても画面は暗くならない点に注意。
  // 時刻は spawnDarkPulseSpecial の定数（DARKPULSE_*）と連動させている。
  (function () {
    const fx = {
      flashes: [
        { color: '#b13bff', peakAlpha: 0.22, durationMs: 200, delay: DARKPULSE_CHARGE_MS - 20 },   // 発射の瞬間（うっすら）
        { color: '#d24fd8', peakAlpha: 0.2, durationMs: 320, delay: DARKPULSE_HIT_MS },            // 最初の輪が届いた瞬間
      ],
      shakes: [],   // シェイクなし
    };
    SPECIAL_IMPACT_FX[32] = fx;
    SPECIAL_IMPACT_FX[33] = fx;
    SPECIAL_IMPACT_FX[37] = fx;
  })();
  // シグナルビーム／翔音セレナーデ：全弾着弾の瞬間に画面フラッシュだけを入れる（画面シェイクは入れない）。
  // ダイヤモンド・パール原作準拠で、パワージェムやジェムレーザーと同じ「揺らさない」方針。
  // 時刻は spawnSignalBeamSpecial の定数（SIGNALBEAM_*）と連動させている。
  (function () {
    const fx = {
      flashes: [
        { color: '#ffffff', peakAlpha: 0.45, durationMs: 200, delay: SIGNALBEAM_HIT_MS },
        { color: '#e07bff', peakAlpha: 0.25, durationMs: 380, delay: SIGNALBEAM_HIT_MS + 30 },
      ],
      shakes: [], // シェイクなし
    };
    SPECIAL_IMPACT_FX[13] = fx;
    SPECIAL_IMPACT_FX[18] = fx;
  })();
  // ジェムレーザー：画面フラッシュのみ（画面シェイクなし。パワージェムと同じ方針）。
  // ビームが相手に届く瞬間（＝ダメージの瞬間）に白い閃光、ビームが消えて光が弾ける瞬間に宝石色の余韻。
  // 時刻は spawnGemLaserSpecial の定数（GEMLASER_*）と連動させている。
  SPECIAL_IMPACT_FX[315] = {
    flashes: [
      { color: '#ffffff', peakAlpha: 0.32, durationMs: 200, delay: GEMLASER_CHARGE_MS - 20 },     // 発射の瞬間（うっすら）
      { color: '#ffffff', peakAlpha: 0.7, durationMs: 220, delay: GEMLASER_HIT_MS },              // ビームが届いた瞬間
      { color: '#9fe0ff', peakAlpha: 0.3, durationMs: 460, delay: GEMLASER_HIT_MS + GEMLASER_HOLD_MS }, // 光が弾ける余韻
    ],
    shakes: [],   // シェイクなし
  };
  // はかいこうせん：チャージで軽く揺れ、着弾で重い大振動（要望どおり）
SPECIAL_IMPACT_FX[253] = {
  flashes: [
    { color: '#fff2a8', peakAlpha: 0.5, durationMs: 220, delay: HYPERBEAM_CHARGE_MS - 20 },  // 発射の瞬間
    { color: '#ffffff', peakAlpha: 0.9, durationMs: 180, delay: HYPERBEAM_HIT_MS },           // 着弾の白飛び
    { color: '#ff9a2a', peakAlpha: 0.4, durationMs: 500, delay: HYPERBEAM_HIT_MS + 30 },      // 爆発の余韻
  ],
  shakes: [
    { ampPx: 3,  durationMs: 160, freq: 30, delay: HYPERBEAM_CHARGE_MS - 40 },   // 発射の小刻み
    { ampPx: 26, durationMs: 640, freq: 32, delay: HYPERBEAM_HIT_MS },           // 着弾の大振動
  ],
};
// きりふだ：着弾で桃色のフラッシュのみ（シェイクなし）
SPECIAL_IMPACT_FX[254] = {
  flashes: [
    { color: '#ffe0f0', peakAlpha: 0.35, durationMs: 240, delay: TRUMPCARD_HIT_MS },
    { color: '#ff3b5c', peakAlpha: 0.28, durationMs: 420, delay: TRUMPCARD_HIT_MS + 30 },
  ],
  shakes: [],
};
// ヘドロばくだん：着弾で紫のフラッシュのみ（シェイクなし）
SPECIAL_IMPACT_FX[273] = {
  flashes: [
    { color: '#e0a0ff', peakAlpha: 0.42, durationMs: 220, delay: SLUDGEBOMB_HIT_MS },
    { color: '#7a2aa0', peakAlpha: 0.28, durationMs: 440, delay: SLUDGEBOMB_HIT_MS + 30 },
  ],
  shakes: [],
};
// バッドポイズンはヘドロばくだんと共通演出・共通フラッシュ
// 10まんボルト：着弾の瞬間に黄色い閃光＋短く鋭いシェイク（電撃が体を痺れさせる衝撃）
(function () {
  const fin = THUNDERBOLT_FINAL_HIT_MS;
  const fx = {
    flashes: [
      { color: '#fff9c4', peakAlpha: 0.85, durationMs: 200, delay: fin },
      { color: '#ffd23f', peakAlpha: 0.35, durationMs: 420, delay: fin + 30 },
    ],
    shakes: [
      { ampPx: 3, durationMs: 120, freq: 40, delay: THUNDERBOLT_CHARGE_MS - 90 },  // 帯電ピークの小刻み
      { ampPx: 16, durationMs: 300, freq: 42, delay: fin },                        // 着弾の鋭いシェイク
    ],
  };
  SPECIAL_IMPACT_FX[72] = fx;
  SPECIAL_IMPACT_FX[75] = fx;
  SPECIAL_IMPACT_FX[76] = fx;
})();
SPECIAL_IMPACT_FX[277] = SPECIAL_IMPACT_FX[273];
// かみかぜ：風が相手を叩く瞬間に淡い翠のフラッシュのみ（シェイクなし）
SPECIAL_IMPACT_FX[153] = {
  flashes: [
    { color: '#eaf8ff', peakAlpha: 0.32, durationMs: 220, delay: KAMIKAZE_HIT_MS },
    { color: '#ffe98a', peakAlpha: 0.22, durationMs: 400, delay: KAMIKAZE_HIT_MS + 40 },
  ],
  shakes: [],
};
// しはいのかぜ／かみわたしはかみかぜと共通
SPECIAL_IMPACT_FX[156] = SPECIAL_IMPACT_FX[153];
SPECIAL_IMPACT_FX[157] = SPECIAL_IMPACT_FX[153];

// ハイドロポンプ：着弾で青白いフラッシュのみ（シェイクなし）
SPECIAL_IMPACT_FX[353] = {
  flashes: [
    { color: '#eaf8ff', peakAlpha: 0.55, durationMs: 220, delay: HYDROPUMP_HIT_MS },
    { color: '#3ca0e6', peakAlpha: 0.3, durationMs: 440, delay: HYDROPUMP_HIT_MS + 30 },
  ],
  shakes: [],
};
// アクアボルト：着弾で青＋黄のフラッシュ（電気を帯びているので少し派手に）
SPECIAL_IMPACT_FX[354] = {
  flashes: [
    { color: '#eaf8ff', peakAlpha: 0.5, durationMs: 200, delay: AQUAVOLT_HIT_MS },
    { color: '#fff59d', peakAlpha: 0.45, durationMs: 260, delay: AQUAVOLT_HIT_MS + 30 },
    { color: '#3ca0e6', peakAlpha: 0.28, durationMs: 440, delay: AQUAVOLT_HIT_MS + 70 },
  ],
  shakes: [],
};
// なみのり：着弾で白〜水色の大きなフラッシュ（波の砕け）
SPECIAL_IMPACT_FX[355] = {
  flashes: [
    { color: '#ffffff', peakAlpha: 0.6, durationMs: 240, delay: SURF_HIT_MS },
    { color: '#bfe8ff', peakAlpha: 0.32, durationMs: 480, delay: SURF_HIT_MS + 40 },
  ],
  shakes: [],
};

  SPECIAL_IMPACT_FX[132] = {
  flashes: [
    { color: '#ffe9a0', peakAlpha: 0.55, durationMs: 240, delay: FLAMETHROWER_HIT_MS },
    { color: '#ff7a1a', peakAlpha: 0.28, durationMs: 420, delay: FLAMETHROWER_HIT_MS + 30 },
  ],
  shakes: [],
};
SPECIAL_IMPACT_FX[133] = {
  flashes: [
    { color: '#ffffff', peakAlpha: 0.7,  durationMs: 240, delay: DAIMONJI_HIT_MS },
    { color: '#ff7a1a', peakAlpha: 0.26, durationMs: 420, delay: DAIMONJI_HIT_MS + 30 },
    { color: '#fff3c4', peakAlpha: 0.6,  durationMs: 260, delay: DAIMONJI_BURST_MS },
    { color: '#ff5a1a', peakAlpha: 0.32, durationMs: 460, delay: DAIMONJI_BURST_MS + 30 },
  ],
  shakes: [
    { ampPx: 9,  durationMs: 260, freq: 30, delay: DAIMONJI_HIT_MS },
    { ampPx: 22, durationMs: 460, freq: 32, delay: DAIMONJI_BURST_MS },
  ],
};
SPECIAL_IMPACT_FX[216] = {
  flashes: [
    { color: '#ffcf5a', peakAlpha: 0.28, durationMs: 220, delay: EARTHPOWER_CRACK_START_MS },
    { color: '#fff6d0', peakAlpha: 0.75, durationMs: 260, delay: EARTHPOWER_HIT_MS },
    { color: '#c8781e', peakAlpha: 0.34, durationMs: 460, delay: EARTHPOWER_HIT_MS + 30 },
  ],
  shakes: [
    { ampPx: 4,  durationMs: 200, freq: 22, delay: EARTHPOWER_CRACK_START_MS },
    { ampPx: 20, durationMs: 480, freq: 28, delay: EARTHPOWER_HIT_MS },
  ],
};
SPECIAL_IMPACT_FX[215] = SPECIAL_IMPACT_FX[216];
SPECIAL_IMPACT_FX[78] = {
  flashes: [
    { color: '#c9a8ff', peakAlpha: 0.22, durationMs: 260, delay: LUXIONAIR_FORM_START_MS },
    { color: '#fff066', peakAlpha: 0.3,  durationMs: 200, delay: LUXIONAIR_RAGE_START_MS + 180 },
    { color: '#ffffff', peakAlpha: 0.85, durationMs: 260, delay: LUXIONAIR_BURST_START_MS },
    { color: '#8a6fd6', peakAlpha: 0.34, durationMs: 480, delay: LUXIONAIR_BURST_START_MS + 30 },
  ],
  shakes: [
    { ampPx: 5,  durationMs: 220, freq: 24, delay: LUXIONAIR_FORM_START_MS },
    { ampPx: 8,  durationMs: LUXIONAIR_RAGE_MS, freq: 40, delay: LUXIONAIR_RAGE_START_MS },
    { ampPx: 24, durationMs: 520, freq: 30, delay: LUXIONAIR_BURST_START_MS },
  ],
};
// れいとうビーム：着弾で白〜淡青の冷色フラッシュのみ（シェイクなし）
SPECIAL_IMPACT_FX[233] = {
  flashes: [
    { color: '#ffffff', peakAlpha: 0.6, durationMs: 220, delay: ICEBEAM_HIT_MS },
    { color: '#bfe8ff', peakAlpha: 0.3, durationMs: 420, delay: ICEBEAM_HIT_MS + 30 },
  ],
  shakes: [],
};
// ラスターカノン：着弾で銀白のフラッシュのみ（シェイクなし）
SPECIAL_IMPACT_FX[332] = {
  flashes: [
    { color: '#ffffff', peakAlpha: 0.7, durationMs: 240, delay: FLASHCANNON_HIT_MS },
    { color: '#c7d3da', peakAlpha: 0.32, durationMs: 460, delay: FLASHCANNON_HIT_MS + 30 },
  ],
  shakes: [],
};

// フレアドライブ：チャージ中に軽く揺れ、激突の瞬間に強いオレンジ系フラッシュ＋大振動
// 戻りは軽い余韻だけにして「突進して戻ってきた」流れを体感できるようにしている
SPECIAL_IMPACT_FX[123] = {
  flashes: [
    { color: '#ffb347', peakAlpha: 0.35, durationMs: 260, delay: FLAREDRIVE_CHARGE_MS - 80 },
    { color: '#ffffff', peakAlpha: 0.95, durationMs: 180, delay: FLAREDRIVE_HIT_MS },
    { color: '#ff7a1a', peakAlpha: 0.45, durationMs: 480, delay: FLAREDRIVE_HIT_MS + 30 },
  ],
  shakes: [
    { ampPx: 3,  durationMs: 180, freq: 26, delay: FLAREDRIVE_CHARGE_MS - 100 },
    { ampPx: 26, durationMs: 600, freq: 32, delay: FLAREDRIVE_HIT_MS },
  ],
};
// サンダーダイブ／エレキスピン：フレアドライブと同じ構成だが、電気らしくやや派手め
// （閃光を強め・チャージ時の小刻みな震えも少し強め）に調整
SPECIAL_IMPACT_FX[63] = {
  flashes: [
    { color: '#fff98a', peakAlpha: 0.45, durationMs: 220, delay: THUNDERDIVE_CHARGE_MS - 80 },
    { color: '#ffffff', peakAlpha: 1.0, durationMs: 160, delay: THUNDERDIVE_HIT_MS },
    { color: '#ffe600', peakAlpha: 0.55, durationMs: 460, delay: THUNDERDIVE_HIT_MS + 30 },
  ],
  shakes: [
    { ampPx: 4,  durationMs: 180, freq: 34, delay: THUNDERDIVE_CHARGE_MS - 100 },
    { ampPx: 28, durationMs: 580, freq: 38, delay: THUNDERDIVE_HIT_MS },
  ],
};
SPECIAL_IMPACT_FX[66] = SPECIAL_IMPACT_FX[63];
// げきりん：暴走の震え→咆哮の赤紫フラッシュ→3連撃の各着弾で画面を揺らす。
// 撃ごとに揺れが強くなり、3撃目のフィニッシュが最大（威力120の暴れ技らしい畳みかけ）。
// 時刻は playOutrageOnCanvas の定数（OUTRAGE_*）と outrageHitTime() に連動させている。
SPECIAL_IMPACT_FX[43] = {
  flashes: [
    { color: '#a01840', peakAlpha: 0.32, durationMs: OUTRAGE_FLASH_MS, delay: OUTRAGE_RAGE_MS },   // 咆哮
    { color: '#ff5a6a', peakAlpha: 0.12, durationMs: 140, delay: outrageHitTime(0) },               // 1撃目
    { color: '#ff5a6a', peakAlpha: 0.16, durationMs: 150, delay: outrageHitTime(1) },               // 2撃目
    { color: '#ffd0d4', peakAlpha: 0.34, durationMs: 220, delay: outrageHitTime(2) },               // 3撃目（フィニッシュ）
    { color: '#8a1030', peakAlpha: 0.24, durationMs: 420, delay: outrageHitTime(2) + 30 },          // 赤黒い余韻
  ],
  shakes: [
    { ampPx: 4, durationMs: OUTRAGE_RAGE_MS, freq: 42, delay: 0 },                                  // 暴走中の小刻みな揺れ
    { ampPx: 9, durationMs: 150, freq: 34, delay: outrageHitTime(0) },
    { ampPx: 12, durationMs: 170, freq: 32, delay: outrageHitTime(1) },
    { ampPx: 22, durationMs: 360, freq: 30, delay: outrageHitTime(2) },
  ],
};
// てっていこうせん：ラスターカノン(332)よりワンランク強い着弾フラッシュ・シェイクに加え、
// 発射の瞬間に攻撃側へ返る反動を示す赤黒いフラッシュを一瞬重ねる（自傷ダメージの合図）。
// 時刻は spawnBehemothBeamSpecial の定数（BEHEMOTHBEAM_*）と連動させている。
SPECIAL_IMPACT_FX[333] = {
  flashes: [
    { color: '#c0202a', peakAlpha: 0.18, durationMs: 200, delay: BEHEMOTHBEAM_CHARGE_MS },        // 発射と同時の反動（自傷）
    { color: '#ffffff', peakAlpha: 0.8, durationMs: 260, delay: BEHEMOTHBEAM_HIT_MS },             // 着弾の瞬間
    { color: '#8fa0ac', peakAlpha: 0.38, durationMs: 500, delay: BEHEMOTHBEAM_HIT_MS + 30 },       // 鋼色の余韻
  ],
  shakes: [
    { ampPx: 18, durationMs: 260, freq: 30, delay: BEHEMOTHBEAM_HIT_MS },
  ],
};
SPECIAL_IMPACT_FX[334] = SPECIAL_IMPACT_FX[333];
SPECIAL_IMPACT_FX[335] = SPECIAL_IMPACT_FX[333];
SPECIAL_IMPACT_FX[338] = SPECIAL_IMPACT_FX[333];
  // グラベルブレス：画面シェイクなし（パワージェム・ジェムレーザーと同じ方針）。
  // 砂礫の演出なので白飛びの閃光は使わず、着弾の瞬間に砂色のごく弱い光だけを入れる。
  // 時刻は spawnGravelBreathSpecial の定数（GRAVELBREATH_*）と連動させている。
  SPECIAL_IMPACT_FX[317] = {
    flashes: [
      { color: '#e4d6b4', peakAlpha: 0.22, durationMs: 180, delay: GRAVELBREATH_CHARGE_MS - 20 },  // 吹き出しの瞬間
      { color: '#f0e2c0', peakAlpha: 0.3, durationMs: 240, delay: GRAVELBREATH_HIT_MS },           // 最初の砂礫が届いた瞬間
    ],
    shakes: [],   // シェイクなし
  };
  // ステルスロック：ダメージを与える技ではなく「場に岩を撒く設置技」なので、
  // 画面フラッシュ・画面シェイクはどちらも入れない（静かに岩が巻きつき、透けて消える演出）。
  SPECIAL_IMPACT_FX[318] = { flashes: [], shakes: [] };
  // ルクスノヴァはかみなりと、ブリザード／ヘイルストームはふぶきと
  // 全く同じ画面シェイク・フラッシュ演出を共有する。
  SPECIAL_IMPACT_FX[499] = SPECIAL_IMPACT_FX[138];
  SPECIAL_IMPACT_FX[79] = SPECIAL_IMPACT_FX[73];
  SPECIAL_IMPACT_FX[236] = SPECIAL_IMPACT_FX[235];
  SPECIAL_IMPACT_FX[237] = SPECIAL_IMPACT_FX[235];

  // 「攻撃側→防御側」の飛翔演出が要る技（パワージェムなど）向け：
  // 両スプライトの中心を special-fx-layer 基準のpx座標で実測して返す。
  // defSide … 被弾側（'self' | 'opp'）。攻撃側はその反対側。
  // 実際の <img> の描画矩形を使う（sprite-slot は画像より大きく中心がズレるため）。
  function measureAttackVector(layerEl, defSide) {
    if (defSide !== 'self' && defSide !== 'opp') return null;
    const atkSide = defSide === 'opp' ? 'self' : 'opp';
    const getCenter = (side) => {
      const slot = document.getElementById(side === 'opp' ? 'sprite-opp-wrap' : 'sprite-self-wrap');
      if (!slot) return null;
      const img = slot.querySelector('img, .sprite-fallback') || slot;
      const r = img.getBoundingClientRect();
      const lr = layerEl.getBoundingClientRect();
      if (!r.width || !r.height) return null;
      return { x: r.left - lr.left + r.width / 2, y: r.top - lr.top + r.height / 2, size: Math.max(r.width, r.height) };
    };
    const from = getCenter(atkSide), to = getCenter(defSide);
    if (!from || !to) return null;
    // 宝石の大きさは「相手スプライトの大きさ」を基準にする（縮小画面でも比率が保たれる）。
    // 基準サイズ(相手=120px相当)に対する倍率。極端な値は丸める。
    const scale = Math.max(0.6, Math.min(1.6, to.size / 120));
    return { from: { x: from.x, y: from.y }, to: { x: to.x, y: to.y }, scale };
  }

  function playSpecialTypeEffect(wrapEl, moveId, defSide) {
  // フレアドライブは「ポケモンの画像そのものが移動する」専用演出を使う
  if (moveId === 123) {
    return playFlareDriveOnCanvas(wrapEl, defSide);
  }
  // サンダーダイブ／エレキスピンはフレアドライブのでんき版（同じく画像そのものが移動する）
  if (moveId === 63 || moveId === 66) {
    return playThunderDiveOnCanvas(wrapEl, defSide);
  }
  // げきりん：ダイヤモンド・パール実機の「その場で激しく震える」演出専用（画像は移動しない）
  if (moveId === 43) {
    return playOutrageOnCanvas(wrapEl, defSide);
  }
const spawn = SPECIAL_SCENES[moveId];
    if (!spawn || !wrapEl) return null;
    const rect = wrapEl.getBoundingClientRect();
    const w = Math.max(60, Math.round(rect.width || wrapEl.offsetWidth || 300));
    const h = Math.max(60, Math.round(rect.height || wrapEl.offsetHeight || 300));
    const dpr = Math.min(2, window.devicePixelRatio || 1);

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.position = 'absolute';
    canvas.style.left = '0';
    canvas.style.top = '0';
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    canvas.style.pointerEvents = 'none';
    canvas.className = 'special-fx-canvas';
    wrapEl.appendChild(canvas);

    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    // シェイク対象は special-fx-layer の親（画面全体＝battle-field）を優先的に使う。
    // 取得できない場合は special-fx-layer 自体を揺らす。
    const shakeTarget = wrapEl.parentElement || wrapEl;

    const impactFx = SPECIAL_IMPACT_FX[moveId];
    if (impactFx) {
      (impactFx.flashes || []).forEach((f) => screenFlash(wrapEl, f));
      (impactFx.shakes || []).forEach((s) => screenShake(shakeTarget, s));
    }

    const duration = SPECIAL_DURATION_MS[moveId] || 1600;
    // 飛翔演出が要る技だけ、攻撃側→防御側の座標を実測して spawn の第4引数に渡す。
    // 既存の spawn 関数（インフェルノ等）は第4引数を無視するので影響しない。
    const info = FLIGHT_MOVE_IDS.indexOf(moveId) !== -1 ? measureAttackVector(wrapEl, defSide) : null;
    return runParticleScene({
      canvas: { getContext: () => ctx, width: w, height: h },
      durationMs: duration,
      spawn: (particles, cw, ch) => spawn(particles, cw, ch, info),
    }).then(() => {
      canvas.remove();
    });
  }

  global.TypeFX = {
    play: playCanvasTypeEffect,
    playSpecial: playSpecialTypeEffect,
    SUPPORTED_TYPES: Object.keys(SCENES),
    SPECIAL_MOVE_IDS: Object.keys(SPECIAL_SCENES).map(Number),
  };
})(window);
