// Mini jogo do gabinete: modo demonstração que vira jogável com FICHA + START.
// Controles: ← → (ou A/D) movem, espaço atira. No celular, toque nos lados da tela.
(function () {
  "use strict";
  var cv = document.getElementById("demo");
  if (!cv) return;
  var ctx = cv.getContext("2d");
  var W = cv.width, H = cv.height;
  var aviso = document.getElementById("insira");
  var calmo = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var INVASOR = ["0010000100", "0001001000", "0011111100", "0110110110", "1111111111", "1011111101", "1010000101", "0001001000"];
  var NAVE = ["0001000", "0011100", "0111110", "1111111", "1101011"];
  var cores = ["#ff2fa0", "#2ff3ff", "#ffe14d", "#5dff6a"];

  var estrelas = [];
  for (var i = 0; i < 60; i++) estrelas.push({ x: Math.random() * W, y: Math.random() * H, v: 0.2 + Math.random() * 0.8 });

  var fichas = 0, jogando = false, teclas = {}, s;

  function novo() {
    s = { nave: W / 2, tiros: [], bombas: [], inv: [], dir: 1, pontos: 0, vidas: 3, recarga: 0, fim: 0, t: 0 };
    for (var l = 0; l < 4; l++) for (var c = 0; c < 8; c++)
      s.inv.push({ x: 40 + c * 30, y: 30 + l * 20, cor: cores[l], vivo: true });
  }
  novo();

  function sprite(m, x, y, cor, esc) {
    ctx.fillStyle = cor;
    for (var r = 0; r < m.length; r++) for (var c = 0; c < m[r].length; c++)
      if (m[r][c] === "1") ctx.fillRect(Math.round(x + c * esc), Math.round(y + r * esc), esc, esc);
  }
  function texto(t, x, y, cor, tam) {
    ctx.fillStyle = cor; ctx.font = (tam || 8) + "px 'Press Start 2P', monospace"; ctx.textAlign = "center";
    ctx.fillText(t, x, y);
  }

  function passo() {
    s.t++;
    estrelas.forEach(function (e) { e.y += e.v; if (e.y > H) { e.y = 0; e.x = Math.random() * W; } });
    if (s.fim) { if (--s.fim === 0) { if (jogando) { jogando = false; atualizaAviso(); } novo(); } return; }

    // movimento da nave
    if (jogando) {
      if (teclas.esq) s.nave -= 2.6;
      if (teclas.dir) s.nave += 2.6;
    } else {
      var alvo = s.inv.filter(function (v) { return v.vivo; })[0];
      if (alvo) s.nave += Math.sign(alvo.x + 10 - s.nave) * 1.6;
    }
    s.nave = Math.max(10, Math.min(W - 10, s.nave));

    if (s.recarga > 0) s.recarga--;
    if ((jogando ? teclas.tiro : s.t % 22 === 0) && s.recarga === 0) { s.tiros.push({ x: s.nave, y: H - 30 }); s.recarga = 14; }

    // invasores
    var vivos = s.inv.filter(function (v) { return v.vivo; });
    var borda = vivos.some(function (v) { return (s.dir > 0 && v.x > W - 30) || (s.dir < 0 && v.x < 10); });
    var vel = 0.25 + (32 - vivos.length) * 0.04;
    vivos.forEach(function (v) { if (borda) v.y += 8; else v.x += s.dir * vel; });
    if (borda) s.dir *= -1;
    if (vivos.length && Math.random() < 0.02 + (jogando ? 0.01 : 0)) {
      var q = vivos[Math.floor(Math.random() * vivos.length)];
      s.bombas.push({ x: q.x + 10, y: q.y + 16 });
    }

    s.tiros.forEach(function (t) { t.y -= 5; });
    s.bombas.forEach(function (b) { b.y += 2.2; });
    s.tiros = s.tiros.filter(function (t) {
      if (t.y < 0) return false;
      for (var k = 0; k < vivos.length; k++) {
        var v = vivos[k];
        if (v.vivo && t.x > v.x && t.x < v.x + 20 && t.y > v.y && t.y < v.y + 16) { v.vivo = false; s.pontos += 10; return false; }
      }
      return true;
    });
    s.bombas = s.bombas.filter(function (b) {
      if (b.y > H) return false;
      if (Math.abs(b.x - s.nave) < 10 && b.y > H - 30 && b.y < H - 16) {
        if (jogando) { s.vidas--; if (s.vidas <= 0) s.fim = 180; }
        return false;
      }
      return true;
    });
    if (!vivos.length || vivos.some(function (v) { return v.y > H - 50; })) s.fim = jogando && vivos.length ? 180 : 90;
  }

  function desenha() {
    ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#6c63a8";
    estrelas.forEach(function (e) { ctx.fillRect(e.x, e.y, 1, 1); });
    s.inv.forEach(function (v) { if (v.vivo) sprite(INVASOR, v.x, v.y, v.cor, 2); });
    sprite(NAVE, s.nave - 7, H - 26, "#5dff6a", 2);
    ctx.fillStyle = "#ffe14d"; s.tiros.forEach(function (t) { ctx.fillRect(t.x - 1, t.y, 2, 6); });
    ctx.fillStyle = "#ff2fa0"; s.bombas.forEach(function (b) { ctx.fillRect(b.x - 1, b.y, 2, 5); });
    ctx.textAlign = "left"; ctx.font = "8px 'Press Start 2P', monospace"; ctx.fillStyle = "#e9e4ff";
    ctx.fillText("PONTOS " + String(s.pontos).padStart(5, "0"), 8, 14);
    ctx.textAlign = "right"; ctx.fillText(jogando ? "VIDAS " + s.vidas : "FICHAS " + fichas, W - 8, 14);
    if (s.fim) texto(jogando && s.vidas <= 0 ? "GAME OVER" : (s.inv.some(function (v) { return v.vivo; }) ? "GAME OVER" : "VOCÊ VENCEU!"), W / 2, H / 2, "#ffe14d", 12);
    else if (!jogando && fichas > 0) texto("APERTE START", W / 2, H / 2 + 20, "#ffe14d", 10);
  }

  function atualizaAviso() {
    aviso.classList.toggle("oculto", jogando || fichas > 0);
  }

  function loop() { passo(); desenha(); if (!calmo || jogando) requestAnimationFrame(loop); else setTimeout(loop, 200); }

  document.getElementById("ficha").addEventListener("click", function () { if (fichas < 9) fichas++; atualizaAviso(); });
  document.getElementById("start").addEventListener("click", function () {
    if (jogando || fichas === 0) return;
    fichas--; novo(); jogando = true; atualizaAviso(); cv.focus && cv.focus();
  });

  var mapa = { ArrowLeft: "esq", KeyA: "esq", ArrowRight: "dir", KeyD: "dir", Space: "tiro" };
  window.addEventListener("keydown", function (e) {
    if (!jogando || !mapa[e.code]) return;
    teclas[mapa[e.code]] = true; e.preventDefault();
  });
  window.addEventListener("keyup", function (e) { if (mapa[e.code]) teclas[mapa[e.code]] = false; });

  // toque: metade esquerda/direita move e atira
  function toque(e) {
    if (!jogando) return;
    var r = cv.getBoundingClientRect(), x = e.touches[0].clientX - r.left;
    teclas.esq = x < r.width / 2; teclas.dir = !teclas.esq; teclas.tiro = true; e.preventDefault();
  }
  cv.addEventListener("touchstart", toque, { passive: false });
  cv.addEventListener("touchmove", toque, { passive: false });
  cv.addEventListener("touchend", function () { teclas.esq = teclas.dir = teclas.tiro = false; });

  loop();
})();
