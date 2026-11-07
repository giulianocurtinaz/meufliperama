(function () {
  "use strict";

  // ---------- Botões "Entrar" ----------
  var url = (window.FLIPERAMA && window.FLIPERAMA.entrar) || "";
  document.querySelectorAll(".js-entrar").forEach(function (a) {
    if (url) { a.href = url; a.rel = "noopener"; }
    else { a.classList.add("embreve"); a.href = "#entrar"; }
  });
  var t = document.querySelector(".js-entrar-texto");
  if (url && t) t.textContent = "Recebeu convite? Digite seu e-mail, use o código que chegar nele e depois entre com seu usuário do Infonotas.";

  // ---------- Pega-estrelas ----------
  var cv = document.getElementById("jogo");
  if (!cv) return;
  var ctx = cv.getContext("2d"), W = cv.width, H = cv.height;
  var calmo = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var linhas = {};
  document.querySelectorAll(".codigo .ln").forEach(function (el) { linhas[el.dataset.l] = el; });
  var timers = {};
  function acende(nome, ms) {
    var el = linhas[nome]; if (!el) return;
    el.classList.add("ativa");
    clearTimeout(timers[nome]);
    timers[nome] = setTimeout(function () { el.classList.remove("ativa"); }, ms || 350);
  }

  var s, jogando = false, teclas = {};
  function novo() { s = { x: W / 2, pontos: 0, vidas: 3, coisas: [], t: 0, fim: false }; }
  novo();

  function estrela(x, y, r) {
    ctx.beginPath();
    for (var i = 0; i < 10; i++) {
      var a = Math.PI / 5 * i - Math.PI / 2, rr = i % 2 ? r * 0.45 : r;
      ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    ctx.closePath(); ctx.fillStyle = "#ffd23f"; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = "#2b2350"; ctx.stroke();
  }
  function nuvem(x, y) {
    ctx.fillStyle = "#7d7a99"; ctx.strokeStyle = "#2b2350"; ctx.lineWidth = 2;
    [[-10, 2, 10], [0, -4, 12], [11, 2, 9]].forEach(function (c) { ctx.beginPath(); ctx.arc(x + c[0], y + c[1], c[2], 0, 7); ctx.fill(); ctx.stroke(); });
    ctx.fillStyle = "#3a86ff"; [-8, 0, 8].forEach(function (d) { ctx.fillRect(x + d - 1, y + 12, 2, 6); });
  }
  function cesta(x) {
    var y = H - 34;
    ctx.fillStyle = "#ff9f1c"; ctx.strokeStyle = "#2b2350"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(x - 30, y); ctx.lineTo(x + 30, y); ctx.lineTo(x + 22, y + 24); ctx.lineTo(x - 22, y + 24); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x - 26, y + 9); ctx.lineTo(x + 26, y + 9); ctx.stroke();
  }
  function texto(t, y, tam) {
    ctx.fillStyle = "#2b2350"; ctx.textAlign = "center"; ctx.font = "700 " + tam + "px Fredoka, sans-serif"; ctx.fillText(t, W / 2, y);
  }

  function passo() {
    if (!jogando || s.fim) return;
    s.t++;
    if (s.t % 30 === 0) acende("loop", 200);
    var mexeu = false;
    if (teclas.esq) { s.x -= 4.5; mexeu = true; }
    if (teclas.dir) { s.x += 4.5; mexeu = true; }
    if (mexeu) acende("tecla");
    s.x = Math.max(32, Math.min(W - 32, s.x));
    var ritmo = Math.max(22, 50 - Math.floor(s.pontos / 3) * 3);
    if (s.t % ritmo === 0) s.coisas.push({ x: 20 + Math.random() * (W - 40), y: -15, chuva: Math.random() < 0.3, v: 1.6 + Math.random() * 1.2 + s.pontos * 0.04 });
    s.coisas = s.coisas.filter(function (c) {
      c.y += c.v;
      if (c.y > H - 40 && c.y < H - 14 && Math.abs(c.x - s.x) < 32) {
        if (c.chuva) { s.vidas--; acende("chuva", 600); if (s.vidas <= 0) { s.fim = true; jogando = false; acende("fim", 1800); botao.textContent = "▶ Jogar de novo"; } }
        else { s.pontos++; acende("estrela", 500); }
        return false;
      }
      return c.y < H + 20;
    });
  }

  function desenha() {
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#bfe6ff"; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#7ed957"; ctx.fillRect(0, H - 10, W, 10);
    s.coisas.forEach(function (c) { c.chuva ? nuvem(c.x, c.y) : estrela(c.x, c.y, 11); });
    cesta(s.x);
    ctx.textAlign = "left"; ctx.font = "700 16px Fredoka, sans-serif"; ctx.fillStyle = "#2b2350";
    ctx.fillText("pontos = " + s.pontos, 12, 24);
    ctx.textAlign = "right"; ctx.fillText("vidas = " + s.vidas, W - 12, 24);
    if (s.fim) { texto("Fim de jogo!", H / 2 - 6, 30); texto("Você pegou " + s.pontos + " estrela" + (s.pontos === 1 ? "" : "s"), H / 2 + 24, 18); }
    else if (!jogando) { texto("Pega-estrelas", H / 2 - 10, 30); texto("aperte ▶ Jogar", H / 2 + 20, 18); }
  }

  function loop() { passo(); desenha(); requestAnimationFrame(loop); }

  var botao = document.getElementById("comecar");
  botao.addEventListener("click", function () {
    novo(); jogando = true; acende("var", 600); botao.textContent = "↺ Recomeçar"; cv.focus();
  });
  function segura(id, k) {
    var b = document.getElementById(id);
    ["pointerdown"].forEach(function (e) { b.addEventListener(e, function (ev) { ev.preventDefault(); teclas[k] = true; }); });
    ["pointerup", "pointerleave", "pointercancel"].forEach(function (e) { b.addEventListener(e, function () { teclas[k] = false; }); });
  }
  segura("esq", "esq"); segura("dir", "dir");

  var mapa = { ArrowLeft: "esq", KeyA: "esq", ArrowRight: "dir", KeyD: "dir" };
  cv.addEventListener("keydown", function (e) { if (mapa[e.code]) { teclas[mapa[e.code]] = true; e.preventDefault(); } });
  window.addEventListener("keydown", function (e) { if (jogando && mapa[e.code] && document.activeElement === document.body) { teclas[mapa[e.code]] = true; e.preventDefault(); } });
  window.addEventListener("keyup", function (e) { if (mapa[e.code]) teclas[mapa[e.code]] = false; });
  function toque(e) {
    if (!jogando) return;
    var r = cv.getBoundingClientRect();
    s.x = (e.touches[0].clientX - r.left) * (W / r.width); acende("tecla"); e.preventDefault();
  }
  cv.addEventListener("touchstart", toque, { passive: false });
  cv.addEventListener("touchmove", toque, { passive: false });

  if (document.fonts && document.fonts.ready) document.fonts.ready.then(desenha);
  loop();
})();
