/* 🕹️ FLIPERAMA — motor de jogo da casa (BLUEPRINT Fliperama §4.3, E0 · 24/10/2026, Transcol).
 *
 * MANTIDO PELA CASA (core). Os jogos não trazem motor: trazem uma ESPECIFICAÇÃO (jogo.json)
 * que este arquivo executa. Uma melhoria aqui vale para todos os jogos do gênero.
 *
 * Regras que não dobram:
 *  · canvas 2D, JavaScript puro, sem dependência externa (a casa pode estar offline);
 *  · renderiza NA resolução do perfil de era e escala por inteiros (pixel nítido);
 *  · passo fixo de 1/60 s e RNG com semente — o mesmo jogo com as mesmas teclas dá sempre
 *    o mesmo resultado (é o que o robô testador e o placar antitrapaça vão usar);
 *  · erro do jogo nunca vira tela preta muda: aparece na tela e vai para o diagnóstico
 *    da casa (Infonotas.erroJS → control.miniapp_erro → erros.json da casa cliente).
 *
 * Uso:  Fliperama.iniciar(elemento, spec, { perfis, slug })
 * Gêneros: plataforma (E0) · labirinto, quebra_blocos, nave, corrida, tiro_fixo, travessia, esporte, quiz (E4) · aventura, rpg, briga_de_rua (E5).
 */
(function () {
  'use strict';

  var VERSAO = '0.9.9';   // 0.9.9 (30/10/2026): nave no jeito rio, combustível, pontes, acorda/cruza
  var PASSO = 1000 / 60;

  // ───────────────────────── utilidades ─────────────────────────
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function reportar(err, onde) {
    var msg = (err && err.message) ? err.message : String(err);
    try { console.error('[Fliperama]', onde || '', err); } catch (e) { /* nada */ }
    try {
      if (window.Infonotas && Infonotas.erroJS) {
        Infonotas.erroJS({ msg: '[motor ' + VERSAO + '] ' + (onde ? onde + ': ' : '') + msg,
                           caminho: 'fliperama/motor.js', pilha: err && err.stack ? String(err.stack).slice(0, 1500) : '' });
      }
    } catch (e) { /* o aviso nunca derruba o jogo */ }
    return msg;
  }

  // ───────────────────────── fonte 3×5 embutida ─────────────────────────
  var FONTE = {
    'A': '111101111101101', 'B': '110101110101110', 'C': '111100100100111', 'D': '110101101101110',
    'E': '111100110100111', 'F': '111100110100100', 'G': '111100101101111', 'H': '101101111101101',
    'I': '111010010010111', 'J': '001001001101111', 'K': '101101110101101', 'L': '100100100100111',
    'M': '101111111101101', 'N': '110101101101101', 'O': '111101101101111', 'P': '111101111100100',
    'Q': '111101101111001', 'R': '110101110101101', 'S': '111100111001111', 'T': '111010010010010',
    'U': '101101101101111', 'V': '101101101101010', 'W': '101101111111101', 'X': '101101010101101',
    'Y': '101101010010010', 'Z': '111001010100111', '0': '111101101101111', '1': '010110010010111',
    '2': '111001111100111', '3': '111001111001111', '4': '101101111001001', '5': '111100111001111',
    '6': '111100111101111', '7': '111001001001001', '8': '111101111101111', '9': '111101111001111',
    ':': '000010000010000', '.': '000000000000010', '!': '010010010000010', '-': '000000111000000',
    '?': '111001011000010', '/': '001001010100100', '+': '000010111010000', ' ': '000000000000000',
    ',': '000000000010100', '(': '010100100100010', ')': '010001001001010', "'": '010010000000000', '"': '101101000000000',
    '=': '000111000111000', '%': '101001010100101', '*': '000101010101000', ';': '000010000010100', '>': '100010001010100',
    '<': '001010100010001', '_': '000000000000111'
  };
  var ACENTOS = { 'Á': 'A', 'À': 'A', 'Â': 'A', 'Ã': 'A', 'É': 'E', 'Ê': 'E', 'Í': 'I', 'Ó': 'O', 'Ô': 'O',
                  'Õ': 'O', 'Ú': 'U', 'Ç': 'C' };
  function texto(ctx, s, x, y, cor, esc) {
    esc = esc || 1;
    s = String(s).toUpperCase();
    ctx.fillStyle = cor;
    for (var i = 0; i < s.length; i++) {
      var ch = ACENTOS[s[i]] || s[i];
      var g = FONTE[ch] || FONTE['?'];
      for (var p = 0; p < 15; p++) {
        if (g[p] === '1') { ctx.fillRect(x + (p % 3) * esc, y + Math.floor(p / 3) * esc, esc, esc); }
      }
      x += 4 * esc;
    }
  }
  function larguraTexto(s, esc) { return String(s).length * 4 * (esc || 1) - (esc || 1); }
  function textoCentro(ctx, s, w, y, cor, esc) { texto(ctx, s, Math.floor((w - larguraTexto(s, esc)) / 2), y, cor, esc); }

  // ───────────────────────── sprites ─────────────────────────
  function montarSprites(spec) {
    var out = {};
    var defs = spec.sprites || {};
    Object.keys(defs).forEach(function (nome) {
      var d = defs[nome];
      var quadros = (d.quadros || []).map(function (rows) {
        var c = document.createElement('canvas');
        c.width = d.w; c.height = d.h;
        var x = c.getContext('2d');
        for (var j = 0; j < rows.length; j++) {
          for (var i = 0; i < rows[j].length; i++) {
            var k = rows[j][i];
            if (k === '.' || k === ' ') { continue; }
            var cor = d.cores[parseInt(k, 36) - 1];
            if (!cor) { continue; }
            x.fillStyle = cor; x.fillRect(i, j, 1, 1);
          }
        }
        return c;
      });
      out[nome] = { w: d.w, h: d.h, quadros: quadros };
    });
    return out;
  }

  // ───────────────────────── 🎵 som v2 (25/10/2026, motor 0.9): biblioteca de efeitos e músicas, instrumentos ─────────────────────────
  // Efeitos: {onda, de, ate, dur, vol?, arp?:[Hz…], ruido?:true, vib?:Hz}; no jogo, `sons.efeitos.pulo` pode ser um
  // objeto ou o NOME de um efeito da biblioteca ("pulo_alto"). Músicas: {bpm, subdiv?(1–4), loop?, instrumentos?, canais}
  // ou "biblioteca:campo". Notas: C4, F#3, Bb2 · "-" segura a nota anterior · R (ou .) pausa · bateria: K bumbo,
  // S caixa, H chimbal, X prato. A música usa no máximo (canais da era − 1): um fica para os efeitos, como nas máquinas.
  var NOTAS = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  function freqDe(n) {
    var m = /^([A-G])(#|b)?(\d)$/.exec(n);
    if (!m) { return 0; }
    var s = NOTAS[m[1]] + (m[2] === '#' ? 1 : (m[2] === 'b' ? -1 : 0)) + (parseInt(m[3], 10) + 1) * 12;
    return 440 * Math.pow(2, (s - 69) / 12);
  }
  var SFX_BIBLIOTECA = {
    pulo: { onda: 'square', de: 260, ate: 620, dur: 0.14 },
    pulo_alto: { onda: 'square', de: 180, ate: 880, dur: 0.22 },
    pulo_mola: { onda: 'triangle', de: 150, ate: 1200, dur: 0.3, vib: 18 },
    moeda: { onda: 'square', arp: [988, 1319], dur: 0.18 },
    moeda2: { onda: 'square', arp: [1319, 1568, 2093], dur: 0.15 },
    gema: { onda: 'triangle', arp: [1047, 1319, 1568, 2093], dur: 0.25 },
    dano: { onda: 'sawtooth', de: 300, ate: 80, dur: 0.3 },
    pisao: { onda: 'square', de: 180, ate: 90, dur: 0.1 },
    poder: { onda: 'triangle', de: 400, ate: 1200, dur: 0.35 },
    cresce: { onda: 'square', arp: [392, 523, 659, 784, 1047, 784, 1047], dur: 0.45 },
    encolhe: { onda: 'square', arp: [1047, 784, 659, 523, 392], dur: 0.35 },
    vida: { onda: 'square', arp: [659, 784, 1319, 1047, 1175, 1568], dur: 0.5 },
    estrela: { onda: 'square', arp: [523, 659, 784, 1047], dur: 0.3, vib: 30 },
    bloco: { onda: 'square', de: 120, ate: 60, dur: 0.08 },
    quebra: { ruido: true, de: 2000, ate: 200, dur: 0.25 },
    surpresa: { onda: 'square', arp: [523, 784], dur: 0.12 },
    espada: { ruido: true, de: 4000, ate: 1500, dur: 0.12 },
    magia: { onda: 'sine', de: 300, ate: 1800, dur: 0.5, vib: 12 },
    tiro: { onda: 'square', de: 900, ate: 300, dur: 0.12 },
    // 🔫 02/11/2026 (autor): tiros para escolher no Estúdio de Música → 🔊 Barulhos (sons.efeitos.tiro)
    tiro_classico: { ruido: true, de: 3200, ate: 900, dur: 0.09 },
    tiro_metralhadora: { onda: 'square', de: 520, ate: 180, dur: 0.05, vol: 0.8 },
    tiro_canhao: { ruido: true, de: 900, ate: 60, dur: 0.32, vol: 1.3 },
    tiro_missil: { onda: 'sawtooth', de: 220, ate: 1400, dur: 0.35, vib: 22 },
    laser: { onda: 'sawtooth', de: 1600, ate: 200, dur: 0.2 },
    explosao: { ruido: true, de: 800, ate: 40, dur: 0.6 },
    porta: { onda: 'triangle', arp: [262, 330, 392], dur: 0.3 },
    chave: { onda: 'square', arp: [1568, 2093], dur: 0.2 },
    chefe: { onda: 'sawtooth', de: 120, ate: 40, dur: 0.5 },
    casco: { onda: 'square', de: 500, ate: 250, dur: 0.06 },
    fim: { onda: 'triangle', de: 520, ate: 1040, dur: 0.6 },
    vitoria: { onda: 'square', arp: [523, 659, 784, 1047, 784, 1047], dur: 0.7 },
    perdeu: { onda: 'triangle', arp: [494, 466, 440, 415], dur: 0.8 },
    menu: { onda: 'square', de: 700, ate: 700, dur: 0.05 },
    teleporte: { onda: 'sine', de: 200, ate: 2000, dur: 0.4, vib: 25 }
  };
  // 12 trilhas ORIGINAIS da casa (compostas para o Fliperama; nenhuma copia música de jogo conhecido).
  // Ordem dos canais = ordem de importância: melodia, baixo, bateria, harmonia (a era corta do fim para o começo).
  var MUSICAS_BIBLIOTECA = {
    tema: { bpm: 140, canais: [
      'C5 - E5 G5 - E5 C5 - D5 - F5 A5 - G5 F5 - E5 - G5 C6 - B5 A5 G5 F5 E5 D5 - C5 - - -',
      'C3 - G2 - C3 - G2 - D3 - A2 - D3 - G2 - C3 - E3 - A2 - E3 - F2 - G2 - C3 - G2 -',
      'K R H R S R H R K R H R S R H R K R H R S R H R K R H R S R S S'] },
    campo: { bpm: 150, canais: [
      'G4 - C5 - E5 D5 C5 - A4 - C5 - F5 E5 D5 - G4 - B4 - D5 C5 B4 - C5 - E5 - G5 - - - A5 - G5 - E5 - C5 - F5 - E5 - D5 - - - E5 F5 G5 - A5 G5 F5 E5 D5 - B4 - C5 - - -',
      'C3 R G3 R C3 R G3 R F2 R C3 R F2 R C3 R G2 R D3 R G2 R D3 R C3 R G3 R C3 R C3 R A2 R E3 R A2 R E3 R F2 R C3 R F2 R C3 R C3 R G3 R C3 R G3 R G2 R D3 R C3 R C3 R',
      'K R H K S R H R K R H K S R H R K R H K S R H R K R H K S R S R K R H K S R H R K R H K S R H R K R H K S R H R K R H K S S S R',
      'E4 R G4 R E4 R G4 R F4 R A4 R F4 R A4 R D4 R G4 R D4 R G4 R E4 R G4 R E4 R G4 R C4 R E4 R C4 R E4 R C4 R F4 R C4 R F4 R E4 R G4 R E4 R G4 R B3 R D4 R E4 R E4 R'] },
    caverna: { bpm: 110, canais: [
      'A4 - - C5 - - E5 - D5 - - B4 - - G4 - A4 - C5 - E5 - A5 - G#5 - - - E5 - - -',
      'A2 - - - E2 - - - G2 - - - D2 - - - F2 - - - C3 - - - E2 - - - E2 - B2 -',
      'K R R H R R S R K R R H R R S R K R R H R R S R K R R H R S S R'] },
    castelo: { bpm: 160, canais: [
      'D5 D5 F5 D5 A5 G5 F5 E5 D5 D5 F5 D5 Bb5 A5 G5 F5 E5 E5 G5 E5 C6 Bb5 A5 G5 A5 - - - A4 - - -',
      'D3 A2 D3 A2 D3 A2 D3 A2 Bb2 F2 Bb2 F2 Bb2 F2 Bb2 F2 C3 G2 C3 G2 C3 G2 C3 G2 A2 E2 A2 E2 A2 C#3 E3 A3',
      'K H K H S H K H K H K H S H K H K H K H S H K H K K S S X R R R'] },
    chefe: { bpm: 180, canais: [
      'E5 R E5 G5 R E5 B5 A5 G5 R F#5 R E5 R D5 R E5 R E5 G5 R E5 C6 B5 A5 - B5 - C6 - D6 -',
      'E2 E3 E2 E3 E2 E3 E2 E3 C2 C3 C2 C3 D2 D3 D2 D3 E2 E3 E2 E3 E2 E3 E2 E3 A2 A3 B2 B3 C3 C4 D3 D4',
      'K H S H K K S H K H S H K K S H K H S H K K S H K S K S K S X S'] },
    estrela: { bpm: 200, canais: [
      'C5 R C5 R C5 R D5 C5 R C5 R D5 C5 R D5 R D5 R D5 R D5 R E5 D5 R D5 R E5 D5 R E5 R',
      'C3 C4 C3 C4 C3 C4 C3 C4 C3 C4 C3 C4 C3 C4 C3 C4 D3 D4 D3 D4 D3 D4 D3 D4 D3 D4 D3 D4 D3 D4 D3 D4',
      'K H S H K H S H K H S H K H S H K H S H K H S H K H S H K S S S'] },
    ceu: { bpm: 120, instrumentos: [{ onda: 'triangle', vol: 1.3 }], canais: [
      'F5 - A5 - C6 - A5 - G5 - Bb5 - D6 - - - A5 - C6 - F6 - E6 - D6 - C6 - A5 - - -',
      'F3 - C3 - F3 - C3 - G2 - D3 - G2 - D3 - F3 - C3 - A2 - C3 - Bb2 - C3 - F2 - - -',
      'K R R R H R R R K R R R H R R R K R R R H R R R K R R R H R H R'] },
    gelo: { bpm: 130, canais: [
      'E6 B5 G#5 E5 B5 G#5 E5 B4 F#6 C#6 A5 F#5 C#6 A5 F#5 C#5 G#6 E6 B5 G#5 E6 B5 G#5 E5 A5 - B5 - E5 - - -',
      'E3 - - - B2 - - - F#3 - - - C#3 - - - E3 - - - G#2 - - - A2 - B2 - E2 - - -',
      'H R H R S R H R H R H R S R H R H R H R S R H R H R H R S R X R'] },
    praia: { bpm: 140, canais: [
      'G5 - B5 D6 - B5 G5 - A5 - C6 E6 - C6 A5 - B5 - D6 G6 - D6 B5 - A5 G5 F#5 A5 G5 - - -',
      'G2 R D3 G2 R D3 G2 R A2 R E3 A2 R E3 A2 R G2 R D3 G2 R D3 G2 R D3 R A2 D3 G2 R G2 R',
      'K R H K S R H H K R H K S R H H K R H K S R H H K R H K S R S S'] },
    vitoria: { bpm: 160, loop: false, canais: [
      'G4 C5 E5 G5 - E5 G5 - C6 - - - - - - -',
      'C3 - - - C3 - - - C3 - G2 - C3 - - -',
      'K R S R K R S R X R R R R R R R'] },
    fim: { bpm: 90, loop: false, canais: [
      'C5 - B4 - Bb4 - A4 - Ab4 - - - G4 - - -',
      'C3 - - - F2 - - - G2 - - - C2 - - -'] },
    misterio: { bpm: 100, canais: [
      'E5 R F5 R E5 R D#5 R E5 - - - B4 - - - C5 R C#5 R C5 R B4 R C5 - - - A4 - - -',
      'A2 - - - A2 - - - E2 - - - E2 - - - F2 - - - F2 - - - E2 - - - E2 - G#2 -',
      'K R R R R R H R K R R R R R H R K R R R R R H R K R R R S R H R'] }
  };
  var BATERIA = { K: 1, S: 1, H: 1, X: 1 };
  // 🎹 VOZES da casa (Estúdio de Música, 26/10/2026): receitas de síntese — nenhuma amostra de terceiros.
  // o: onda principal · o2/r2/v2: segunda onda (razão de frequência e volume) · a/d/s: ataque, queda, sustentação
  // lp: filtro passa-baixa · vib: vibrato (Hz) · oct: oitava · chip: a onda usada quando a pele do som é o chip
  var TIMBRES = {
    piano: { nome: 'Piano', o: 'triangle', o2: 'sine', r2: 2, v2: 0.25, a: 0.005, d: 0.9, s: 0, v: 1.6, chip: 'pulso25' },
    orgao: { nome: 'Órgão', o: 'square', o2: 'sine', r2: 2, v2: 0.5, a: 0.02, d: 0.1, s: 0.8, v: 0.6, lp: 2200, chip: 'square' },
    violino: { nome: 'Violino', o: 'sawtooth', a: 0.1, d: 0.2, s: 0.75, v: 0.8, lp: 2600, vib: 5.5, chip: 'pulso25' },
    harpa: { nome: 'Harpa', o: 'triangle', a: 0.002, d: 1.4, s: 0, v: 1.6, oct: 0, chip: 'triangle' },
    flauta: { nome: 'Flauta', o: 'sine', a: 0.06, d: 0.1, s: 0.85, v: 1.5, vib: 4.5, chip: 'triangle' },
    trompete: { nome: 'Trompete', o: 'sawtooth', a: 0.03, d: 0.15, s: 0.7, v: 0.7, lp: 3200, chip: 'pulso12' },
    guitarra: { nome: 'Guitarra', o: 'square', a: 0.004, d: 0.6, s: 0.15, v: 0.7, lp: 1800, chip: 'pulso25' },
    baixo: { nome: 'Baixo', o: 'triangle', a: 0.01, d: 0.5, s: 0.4, v: 2.2, chip: 'triangle' },
    sino: { nome: 'Sino', o: 'sine', o2: 'sine', r2: 2.76, v2: 0.35, a: 0.002, d: 1.8, s: 0, v: 1.4, chip: 'pulso12' },
    marimba: { nome: 'Marimba', o: 'sine', o2: 'sine', r2: 4, v2: 0.3, a: 0.002, d: 0.35, s: 0, v: 1.8, chip: 'triangle' },
    coral: { nome: 'Coral “aah”', o: 'sawtooth', a: 0.18, d: 0.2, s: 0.8, v: 0.6, lp: 1100, vib: 5, chip: 'pulso25' },
    chip: { nome: 'Chip 8 bits', o: 'pulso25', a: 0.002, d: 0.08, s: 0.6, v: 1, chip: 'pulso25' }
  };
  function Som(spec, perfil) {
    this.ctx = null; this.mudo = false; this.vol = 0.18; this.canais = perfil.canais || 2;
    var ef = (spec.sons && spec.sons.efeitos) || {}, self = this;
    this.sfx = {};
    Object.keys(SFX_BIBLIOTECA).forEach(function (k) { self.sfx[k] = SFX_BIBLIOTECA[k]; });
    Object.keys(ef).forEach(function (k) { var v = ef[k]; self.sfx[k] = typeof v === 'string' ? (SFX_BIBLIOTECA[v] || self.sfx[k]) : v; });
    this.musicas = (spec.sons && spec.sons.musicas) || {};
    this.tocando = null; this.timer = null; this.musId = 0; this.ondas = {};
    this.peleSom = 'voz'; this.seguirPele = !(spec.sons && spec.sons.pele_som === false); this.fundo = null;
  }
  // 🎹 a pele do som segue a pele da fase: no Pixel das eras de 8 bits (até 4 canais) a voz vira o chip da era
  Som.prototype.definirPele = function (estilo) {
    this.peleSom = this.seguirPele && (estilo || 'pixel') === 'pixel' && this.canais <= 4 ? 'chip' : 'voz';
  };
  Som.prototype.notaVoz = function (R, f, t, dur) {
    var c = this.ctx, g = c.createGain(), v = this.vol * 0.32 * (R.v || 1), fim = t + Math.max(0.06, dur) + (R.s ? 0.12 : Math.min(R.d, 1.2));
    var saida = g, f0 = f * Math.pow(2, R.oct || 0), self = this;
    if (R.lp) { var flt = c.createBiquadFilter(); flt.type = 'lowpass'; flt.frequency.value = R.lp; g.connect(flt); saida = flt; }
    saida.connect(this.saida());
    [[R.o, 1, 1], [R.o2, R.r2 || 2, R.v2 || 0.25]].forEach(function (p) {
      if (!p[0]) { return; }
      var o = self.oscilador(p[0]), og = c.createGain(); o.frequency.value = f0 * p[1]; og.gain.value = p[2];
      if (R.vib) { var l = c.createOscillator(), lg = c.createGain(); l.frequency.value = R.vib; lg.gain.value = f0 * 0.008; l.connect(lg); lg.connect(o.frequency); l.start(t); l.stop(fim + 0.05); }
      o.connect(og); og.connect(g); o.start(t); o.stop(fim + 0.05);
    });
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v, t + R.a);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, v * (R.s || 0.0001)), t + R.a + R.d);
    if (R.s) { g.gain.setValueAtTime(v * R.s, t + Math.max(R.a + R.d, dur)); }
    g.gain.exponentialRampToValueAtTime(0.0001, fim);
  };
  Som.prototype.ligar = function () {
    if (this.ctx) { return; }
    try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { this.ctx = null; }
  };
  // saída única (motor 0.9): um volume geral e, se `eco` estiver ligado (motor Phaser, "arte livre"), um eco suave
  Som.prototype.saida = function () {
    if (this._saida && this._saida.context === this.ctx) { return this._saida; }
    var g = this.ctx.createGain(); g.gain.value = 1;
    if (this.eco) {
      var d = this.ctx.createDelay(1), fb = this.ctx.createGain(), mix = this.ctx.createGain(), f = this.ctx.createBiquadFilter();
      d.delayTime.value = 0.18; fb.gain.value = 0.28; mix.gain.value = 0.22; f.type = 'lowpass'; f.frequency.value = 2400;
      g.connect(d); d.connect(f); f.connect(fb); fb.connect(d); f.connect(mix); mix.connect(this.ctx.destination);
    }
    g.connect(this.ctx.destination);
    this._saida = g; return g;
  };
  Som.prototype.resolverMusica = function (nome) {
    var m = this.musicas[nome];
    if (typeof m === 'string') { m = MUSICAS_BIBLIOTECA[m.replace(/^biblioteca:/, '')]; }
    else if (m && m.biblioteca) { m = Object.assign({}, MUSICAS_BIBLIOTECA[m.biblioteca] || {}, m); }
    if (!m && typeof nome === 'string' && nome.indexOf('biblioteca:') === 0) { m = MUSICAS_BIBLIOTECA[nome.slice(11)]; }
    return m && m.canais ? m : null;
  };
  Som.prototype.pulso = function (duty) {   // onda de pulso estreita (12,5% / 25%) — o timbre do NES
    if (this.ondas[duty]) { return this.ondas[duty]; }
    var n = 48, re = new Float32Array(n), im = new Float32Array(n);
    for (var k = 1; k < n; k++) { re[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * duty); }
    try { this.ondas[duty] = this.ctx.createPeriodicWave(re, im); } catch (e) { this.ondas[duty] = null; }
    return this.ondas[duty];
  };
  Som.prototype.ruido = function () {
    if (this.bufRuido) { return this.bufRuido; }
    var b = this.ctx.createBuffer(1, this.ctx.sampleRate, this.ctx.sampleRate), d = b.getChannelData(0), s = 22222;
    for (var i = 0; i < d.length; i++) { s = (s * 16807) % 2147483647; d[i] = (s / 1073741823.5) - 1; }
    this.bufRuido = b; return b;
  };
  Som.prototype.oscilador = function (onda) {
    var o = this.ctx.createOscillator();
    if (onda === 'pulso25' || onda === 'pulso12') { var w = this.pulso(onda === 'pulso25' ? 0.25 : 0.125); if (w) { o.setPeriodicWave(w); } else { o.type = 'square'; } }
    else { o.type = onda || 'square'; }
    return o;
  };
  Som.prototype.tocarRuido = function (t, dur, vol, fDe, fAte, tipoFiltro) {
    var src = this.ctx.createBufferSource(), f = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
    src.buffer = this.ruido(); f.type = tipoFiltro || 'bandpass';
    f.frequency.setValueAtTime(fDe || 1000, t);
    if (fAte && fAte !== fDe) { f.frequency.exponentialRampToValueAtTime(Math.max(30, fAte), t + dur); }
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.saida());
    src.start(t); src.stop(t + dur + 0.02);
  };
  Som.prototype.efeito = function (nome) {
    if (this.mudo || !this.ctx) { return; }
    var d = this.sfx[nome]; if (typeof d === 'string') { d = SFX_BIBLIOTECA[d]; }
    if (!d) { return; }
    var t = this.ctx.currentTime, dur = clamp(d.dur || 0.1, 0.02, 2), vol = this.vol * clamp(d.vol == null ? 1 : d.vol, 0, 2);
    if (d.ruido) { this.tocarRuido(t, dur, vol * 1.4, d.de || 1500, d.ate || 200); return; }
    var self = this;
    function um(t0, d0, f0, f1) {
      var o = self.oscilador(d.onda), g = self.ctx.createGain();
      o.frequency.setValueAtTime(f0, t0);
      if (f1 && f1 !== f0) { o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + d0); }
      if (d.vib) { var l = self.ctx.createOscillator(), lg = self.ctx.createGain(); l.frequency.value = d.vib; lg.gain.value = f0 * 0.04; l.connect(lg); lg.connect(o.frequency); l.start(t0); l.stop(t0 + d0 + 0.02); }
      g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + d0);
      o.connect(g); g.connect(self.saida()); o.start(t0); o.stop(t0 + d0 + 0.02);
    }
    if (d.arp && d.arp.length) {
      var p = dur / d.arp.length;
      for (var k = 0; k < d.arp.length; k++) { um(t + k * p, p * 1.1, d.arp[k], null); }
    } else { um(t, dur, d.de || 440, d.ate || d.de || 440); }
  };
  Som.prototype.nota = function (inst, tok, t, dur) {
    if (BATERIA[tok]) {
      if (tok === 'K') {
        var o = this.ctx.createOscillator(), g = this.ctx.createGain(); o.type = 'triangle';
        o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.12);
        g.gain.setValueAtTime(this.vol * 1.6, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
        o.connect(g); g.connect(this.saida()); o.start(t); o.stop(t + 0.16);
      } else if (tok === 'S') { this.tocarRuido(t, 0.12, this.vol * 0.9, 1800, 900, 'bandpass'); }
      else if (tok === 'H') { this.tocarRuido(t, 0.04, this.vol * 0.5, 8000, 8000, 'highpass'); }
      else { this.tocarRuido(t, 0.45, this.vol * 0.6, 6000, 3000, 'highpass'); }
      return;
    }
    var f = freqDe(tok); if (!f) { return; }
    var R = inst.timbre && TIMBRES[inst.timbre];
    if (R && this.peleSom !== 'chip') { this.notaVoz(R, f, t, dur); return; }
    if (R && !inst.onda) { inst = Object.assign({}, inst, { onda: R.chip }); }
    var o2 = this.oscilador(inst.onda), g2 = this.ctx.createGain(), v = this.vol * 0.32 * (inst.vol || 1);
    var fim = t + Math.max(0.03, dur * (inst.solta || 0.92));
    o2.frequency.setValueAtTime(f, t);
    g2.gain.setValueAtTime(0.0001, t); g2.gain.linearRampToValueAtTime(v, t + 0.005);
    g2.gain.setValueAtTime(v * 0.75, t + Math.min(0.08, dur * 0.5));
    g2.gain.exponentialRampToValueAtTime(0.0001, fim);
    o2.connect(g2); g2.connect(this.saida()); o2.start(t); o2.stop(fim + 0.02);
  };
  Som.prototype.musica = function (nome) {
    this.parar();
    var m = this.resolverMusica(nome);
    if (!m || this.mudo || !this.ctx) { return; }
    var self = this, bpm = clamp(m.bpm || 140, 60, 260), sub = clamp(m.subdiv || 2, 1, 4), passo = 60 / bpm / sub;
    var canais = (m.canais || []).slice(0, Math.max(1, this.canais - 1))
      .map(function (c) { return String(c).split(/\s+/).filter(Boolean).map(function (x) { return x === '.' ? 'R' : x; }); });
    var PADRAO = [{ onda: 'pulso25', vol: 1 }, { onda: 'triangle', vol: 1.6 }, { onda: 'square', vol: 0.6 }, { onda: 'pulso12', vol: 0.7 }];
    var inst = canais.map(function (c, ci) { return Object.assign({}, PADRAO[ci] || PADRAO[0], (m.instrumentos || [])[ci] || {}); });
    var len = Math.max.apply(null, canais.map(function (c) { return c.length; }).concat([1]));
    var loop = m.loop !== false, i = 0, prox = this.ctx.currentTime + 0.06, id = ++this.musId;
    this.tocando = nome;
    function agenda() {
      if (self.musId !== id || self.mudo || !self.ctx) { return; }
      var ate = self.ctx.currentTime + 0.15;
      while (prox < ate) {
        if (!loop && i >= len) { self.parar(); return; }
        for (var ci = 0; ci < canais.length; ci++) {
          var c = canais[ci], k = i % c.length, tok = c[k];
          if (!tok || tok === '-' || tok === 'R') { continue; }
          var n = 1; while (n < 32 && c[(k + n) % c.length] === '-' && (loop || k + n < c.length)) { n++; }
          self.nota(inst[ci], tok, prox, passo * n);
        }
        i++; if (loop) { i %= len; }
        prox += passo;
      }
    }
    agenda();
    this.timer = setInterval(agenda, 25);
  };
  Som.prototype.parar = function () { this.tocando = null; this.musId++; if (this.timer) { clearInterval(this.timer); this.timer = null; } };
  Som.prototype.alternarMudo = function () { this.mudo = !this.mudo; if (this.mudo) { this.parar(); this.motorParar(); } };
  // ✈ 02/11/2026 (autor): o BARULHO DO MOTOR do avião, como no River Raid — um som contínuo que sobe quando você acelera
  // (↑) e desce quando freia (↓). Receitas de síntese da casa (nenhuma amostra de terceiros). sons.motor escolhe:
  // classico · caca · monomotor · turbohelice · nenhum. O jogo chama `motorRitmo(r)` a cada quadro em que o avião voa;
  // parou de chamar (pausa, morte, fim, outra tela) → o motor some sozinho em ~0,2 s.
  var MOTORES = {
    classico: { nome: 'Clássico (8 bits)', desc: 'o zumbido grave dos jogos de 1982', o: 'pulso25', f: 62, ruido: 0.35, rf: 700, am: 0, lp: 1100, v: 0.55 },
    caca: { nome: 'Avião caça (jato)', desc: 'turbina rugindo, com assobio', o: 'sawtooth', f: 48, ruido: 1, rf: 1300, am: 0, lp: 2600, v: 0.5, assobio: 2400 },
    monomotor: { nome: 'Monomotor (hélice)', desc: 'o tec-tec-tec do motor a pistão', o: 'sawtooth', f: 46, ruido: 0.25, rf: 500, am: 22, lp: 900, v: 0.75 },
    turbohelice: { nome: 'Turbo-hélice', desc: 'hélice batendo + turbina fina', o: 'square', f: 88, ruido: 0.45, rf: 900, am: 38, lp: 1600, v: 0.5, assobio: 1500 }
  };
  Som.prototype.motorLigar = function (tipo) {
    var M0 = MOTORES[tipo]; if (!M0 || this.mudo || !this.ctx) { return null; }
    if (this.motor && this.motor.tipo === tipo) { return this.motor; }
    this.motorParar(true);
    var c = this.ctx, t = c.currentTime, out = c.createGain(), lp = c.createBiquadFilter(), self = this, nos = [];
    out.gain.value = 0.0001; lp.type = 'lowpass'; lp.frequency.value = M0.lp;
    var corpo = c.createGain(); corpo.gain.value = 1; corpo.connect(lp); lp.connect(out); out.connect(this.saida());
    var o = this.oscilador(M0.o), og = c.createGain(); o.frequency.value = M0.f; og.gain.value = 0.6; o.connect(og); og.connect(corpo); o.start(t); nos.push(o);
    var o2 = this.oscilador('triangle'), og2 = c.createGain(); o2.frequency.value = M0.f * 2.01; og2.gain.value = 0.25; o2.connect(og2); og2.connect(corpo); o2.start(t); nos.push(o2);
    var rs = c.createBufferSource(), rf = c.createBiquadFilter(), rg = c.createGain(); rs.buffer = this.ruido(); rs.loop = true;
    rf.type = 'bandpass'; rf.frequency.value = M0.rf; rf.Q.value = 0.8; rg.gain.value = M0.ruido; rs.connect(rf); rf.connect(rg); rg.connect(corpo); rs.start(t); nos.push(rs);
    var as = null, ag = null;
    if (M0.assobio) { as = c.createOscillator(); as.type = 'sine'; ag = c.createGain(); as.frequency.value = M0.assobio; ag.gain.value = 0.05; as.connect(ag); ag.connect(corpo); as.start(t); nos.push(as); }
    var lfo = null, lg = null;
    if (M0.am) {   // hélice: o volume "bate" no ritmo das pás
      lfo = c.createOscillator(); lfo.type = 'square'; lg = c.createGain(); lfo.frequency.value = M0.am; lg.gain.value = 0.45;
      corpo.gain.value = 0.55; lfo.connect(lg); lg.connect(corpo.gain); lfo.start(t); nos.push(lfo);
    }
    this.motor = { tipo: tipo, def: M0, out: out, o: o, o2: o2, rf: rf, as: as, lfo: lfo, nos: nos, ult: Date.now(), r: 1 };
    if (!this.motorVigia) {
      this.motorVigia = setInterval(function () { if (self.motor && Date.now() - self.motor.ult > 180) { self.motorParar(); } }, 100);
    }
    return this.motor;
  };
  Som.prototype.motorRitmo = function (r, tipo) {   // r ≈ 0,45 (freando) … 1 (normal) … 2,1 (acelerando)
    if (this.mudo || !this.ctx || !tipo || tipo === 'nenhum') { return; }
    var m = this.motorLigar(tipo); if (!m) { return; }
    var c = this.ctx, t = c.currentTime, D = m.def, k = 0.7 + 0.45 * clamp(r, 0.3, 2.5);
    m.ult = Date.now();
    if (Math.abs(k - m.r) > 0.01 || m.novo !== false) {
      m.r = k; m.novo = false;
      m.o.frequency.setTargetAtTime(D.f * k, t, 0.08); m.o2.frequency.setTargetAtTime(D.f * 2.01 * k, t, 0.08);
      m.rf.frequency.setTargetAtTime(D.rf * k, t, 0.1);
      if (m.as) { m.as.frequency.setTargetAtTime(D.assobio * (0.8 + 0.3 * k), t, 0.15); }
      if (m.lfo) { m.lfo.frequency.setTargetAtTime(D.am * k, t, 0.1); }
    }
    m.out.gain.setTargetAtTime(this.vol * 0.5 * D.v * (0.8 + 0.2 * k), t, 0.06);
  };
  Som.prototype.motorParar = function (ja) {
    var m = this.motor; if (!m) { return; }
    this.motor = null;
    try {
      var t = this.ctx.currentTime, fim = ja ? 0.02 : 0.25;
      m.out.gain.cancelScheduledValues(t); m.out.gain.setTargetAtTime(0.0001, t, fim / 3);
      m.nos.forEach(function (n) { try { n.stop(t + fim + 0.05); } catch (e) {} });
    } catch (e) {}
  };

  // ───────────────────────── entrada ─────────────────────────
  function Entrada(alvo) {
    var self = this;
    this.teclas = {}; this.antes = {};
    this.mapa = { ArrowLeft: 'esq', KeyA: 'esq', ArrowRight: 'dir', KeyD: 'dir', ArrowUp: 'cima', KeyW: 'cima',
                  Space: 'pulo', KeyZ: 'pulo', KeyX: 'pulo', Enter: 'pulo', NumpadEnter: 'pulo', KeyP: 'pausa', Escape: 'pausa',
                  KeyM: 'mudo', ArrowDown: 'baixo', KeyS: 'baixo', KeyC: 'bomba', KeyB: 'bomba' };
    // ✈✈ 2 jogadores no MESMO teclado (esquadrilha): o 1º fica nas setas + espaço/Z + C; o 2º em W A S D + F + G
    this.teclado2 = false; this.teclas2 = {}; this.pend2 = {};
    this.mapa2 = { KeyW: 'cima', KeyA: 'esq', KeyS: 'baixo', KeyD: 'dir', KeyF: 'pulo', KeyG: 'bomba' };
    // e.key como reserva: teclado sem `code` (alguns navegadores, automação, teclados virtuais)
    this.porTecla = { ' ': 'pulo', 'Spacebar': 'pulo', 'ArrowLeft': 'esq', 'ArrowRight': 'dir', 'ArrowUp': 'cima', 'Up': 'cima',
                      'ArrowDown': 'baixo', 'Down': 'baixo', 'Left': 'esq', 'Right': 'dir', 'Enter': 'pulo', 'Escape': 'pausa', 'a': 'esq', 'd': 'dir', 'w': 'cima',
                      's': 'baixo', 'z': 'pulo', 'x': 'pulo', 'p': 'pausa', 'm': 'mudo' };
    this.toque = {};
    // 📱 celular como controle (E7): o hospedeiro (TV) põe aqui o estado das teclas de cada jogador (1 e 2)
    this.remoto = { 1: {}, 2: {} }; this.pendR = { 1: {}, 2: {} }; this.antes2 = {};
    // 📺 controle remoto de TV (LG webOS, Samsung Tizen, Android TV): OK pula/começa, coloridos e play/pause, voltar pausa
    this.porCodigo = { 13: 'pulo', 37: 'esq', 38: 'cima', 39: 'dir', 40: 'baixo', 403: 'pulo', 404: 'pulo', 405: 'pausa', 406: 'mudo',
                       415: 'pausa', 19: 'pausa', 179: 'pausa', 10252: 'pausa', 461: 'pausa', 10009: 'pausa' };
    function acao(e) {
      return self.mapa[e.code] || self.porTecla[e.key] || self.porTecla[String(e.key || '').toLowerCase()]
        || self.porCodigo[e.keyCode] || (/^(MediaPlayPause|MediaPlay|MediaPause|GoBack|BrowserBack|Back)$/.test(e.key || '') ? 'pausa' : null)
        || (/^(ColorF0Red|ColorF1Green)$/.test(e.key || '') ? 'pulo' : null);
    }
    // Ouve a JANELA (não só o canvas): clicar fora do canvas não pode deixar o jogo surdo.
    // `pend` guarda o toque rápido (desceu e subiu entre dois quadros) para ele não se perder.
    this.pend = {};
    // Digitando no chat/num campo: a tecla é do texto, não do jogo (25/10/2026 — o André não conseguia escrever W A S D).
    function digitando(e) {
      var el = e.target || document.activeElement, tag = el && el.tagName ? el.tagName.toUpperCase() : '';
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!(el && el.isContentEditable);
    }
    window.addEventListener('keydown', function (e) {
      if (digitando(e)) { return; }
      if (self.teclado2 && self.mapa2[e.code]) { var a2 = self.mapa2[e.code]; if (!self.teclas2[a2]) { self.pend2[a2] = true; } self.teclas2[a2] = true; e.preventDefault(); return; }
      var a = acao(e); if (!a) { return; }
      if (!self.teclas[a]) { self.pend[a] = true; }
      self.teclas[a] = true; e.preventDefault();
    });
    window.addEventListener('keyup', function (e) {
      if (self.teclado2 && self.mapa2[e.code]) { self.teclas2[self.mapa2[e.code]] = false; return; }
      var a = acao(e); if (!a) { return; }
      if (digitando(e)) { self.teclas[a] = false; return; }
      self.teclas[a] = false; e.preventDefault();
    });
    window.addEventListener('blur', function () { self.teclas = {}; self.teclas2 = {}; });
  }
  Entrada.prototype.definirRemoto = function (slot, est) {
    var r = this.remoto[slot] || (this.remoto[slot] = {}), p = this.pendR[slot] || (this.pendR[slot] = {});
    Object.keys(est || {}).forEach(function (k) { if (est[k] && !r[k]) { p[k] = true; } });   // toque rápido não se perde
    this.remoto[slot] = Object.assign({}, est || {});
  };
  Entrada.prototype.ler = function () {
    var e = Object.assign({}, this.teclas), self = this;
    Object.keys(this.pend).forEach(function (k) { e[k] = true; });
    this.pend = {};
    Object.keys(this.toque).forEach(function (k) { if (this.toque[k]) { e[k] = true; } }, this);
    [this.remoto[1], this.pendR[1]].forEach(function (o) { Object.keys(o || {}).forEach(function (k) { if (o[k]) { e[k] = true; } }); });
    this.pendR[1] = {};
    var e2 = {};
    [this.remoto[2], this.pendR[2], this.teclas2, this.pend2].forEach(function (o) { Object.keys(o || {}).forEach(function (k) { if (o[k]) { e2[k] = true; } }); });
    this.pendR[2] = {}; this.pend2 = {};
    if (this.cimaPula && e2.cima) { e2.pulo = true; }
    try {
      var pads = navigator.getGamepads ? navigator.getGamepads() : [];
      for (var i = 0; i < pads.length; i++) {
        var p = pads[i]; if (!p) { continue; }
        if ((p.axes[0] || 0) < -0.4 || (p.buttons[14] && p.buttons[14].pressed)) { e.esq = true; }
        if ((p.axes[0] || 0) > 0.4 || (p.buttons[15] && p.buttons[15].pressed)) { e.dir = true; }
        if ((p.axes[1] || 0) < -0.5 || (p.buttons[12] && p.buttons[12].pressed)) { e.cima = true; }
        if ((p.axes[1] || 0) > 0.5 || (p.buttons[13] && p.buttons[13].pressed)) { e.baixo = true; }
        if ((p.buttons[0] && p.buttons[0].pressed) || (p.buttons[1] && p.buttons[1].pressed)) { e.pulo = true; }
        if (p.buttons[9] && p.buttons[9].pressed) { e.start = true; }
      }
    } catch (x) { /* navegador sem gamepad */ }
    if (this.cimaPula && e.cima) { e.pulo = true; }   // na plataforma, a seta para cima também pula
    var agora = {}, antes = this.antes;
    Object.keys(e).forEach(function (k) { agora[k] = !!e[k]; });
    agora.apertou = function (k) { return agora[k] && !antes[k]; };
    this.antes = Object.assign({}, agora);
    var a2 = {}, antes2 = this.antes2;
    Object.keys(e2).forEach(function (k) { a2[k] = !!e2[k]; });
    a2.apertou = function (k) { return a2[k] && !antes2[k]; };
    this.antes2 = Object.assign({}, a2);
    agora.j2 = a2;   // 2º jogador (só os gêneros de 2 jogadores olham)
    return agora;
  };

  // ───────────────────────── 🏆 placar: recorde na tela de título e a partida gravada ─────────────────────────
  function desenharRecorde(ctx, jogo, W, H) {
    var r = jogo.recorde, cor = (jogo.spec.cores || {});
    if (!r || !r.pontos) { return; }
    textoCentro(ctx, 'RECORDE ' + r.pontos + ' ' + String(r.apelido || '').slice(0, 12), W, Math.floor(H * 0.78), cor.destaque || '#F8B800', 1);
  }
  var BITS = ['esq', 'dir', 'cima', 'baixo', 'pulo', 'pausa', 'start', 'bomba'];   // bomba no fim: partidas antigas continuam iguais
  function mascara(inp) { var m = 0; for (var k = 0; k < BITS.length; k++) { if (inp[BITS[k]]) { m |= (1 << k); } } return m; }
  function deMascara(m) { var e = {}; for (var k = 0; k < BITS.length; k++) { if (m & (1 << k)) { e[BITS[k]] = true; } } return e; }
  // RLE: "mascara*vezes" separados por vírgula (uma partida de 5 min cabe em poucos KB)
  function gravador() {
    var partes = [], atual = -1, n = 0, total = 0;
    return {
      por: function (m) { total++; if (m === atual) { n++; return; } if (n) { partes.push(atual.toString(36) + (n > 1 ? '*' + n.toString(36) : '')); } atual = m; n = 1; },
      texto: function () { var p = partes.slice(); if (n) { p.push(atual.toString(36) + (n > 1 ? '*' + n.toString(36) : '')); } return p.join(','); },
      quadros: function () { return total; }
    };
  }
  function lerGravacao(txt) {
    var out = [];
    String(txt || '').split(',').forEach(function (p) { if (!p) { return; } var a = p.split('*'); var m = parseInt(a[0], 36), n = a[1] ? parseInt(a[1], 36) : 1; for (var k = 0; k < n && out.length < 400000; k++) { out.push(m); } });
    return out;
  }

  // ═══════════════════════════ 🪄 MODO MÁGICO (motor 0.9 · 25/10/2026) ═══════════════════════════
  // Um JavaScript pequeno, INTERPRETADO pela casa (nunca eval/Function): a IA escreve um trecho de código para
  // o que as peças e as regras não cobrem, e ele roda aqui dentro com orçamento de passos, sem acesso ao
  // navegador, à rede ou ao Infonotas — só ao objeto `jogo` (a API da casa), `evento`, `memoria` e `Math`.
  // Erro no código mágico nunca derruba o jogo: aparece numa faixa na tela e a fase continua.
  var Magico = (function () {
    var PROIBIDO = { __proto__: 1, constructor: 1, prototype: 1, __defineGetter__: 1, __defineSetter__: 1, __lookupGetter__: 1, __lookupSetter__: 1, caller: 1, callee: 1, arguments: 1 };
    var MET_LISTA = { push: 1, pop: 1, shift: 1, unshift: 1, indexOf: 1, includes: 1, join: 1, slice: 1, concat: 1, reverse: 1, splice: 1, length: 1 };
    var MET_TEXTO = { toUpperCase: 1, toLowerCase: 1, indexOf: 1, includes: 1, slice: 1, split: 1, trim: 1, charAt: 1, length: 1, startsWith: 1, endsWith: 1 };
    var MAX_TEXTO = 5000, MAX_LISTA = 5000;
    function Hospede(props) { for (var k in props) { if (Object.prototype.hasOwnProperty.call(props, k)) { this[k] = props[k]; } } }
    function falha(msg, linha) { var e = new Error((linha ? 'linha ' + linha + ': ' : '') + msg); e.magico = true; return e; }

    // ── tokens ──
    var PONT = ['===', '!==', '**', '=>', '==', '!=', '<=', '>=', '&&', '||', '++', '--', '+=', '-=', '*=', '/=', '%=',
                '+', '-', '*', '/', '%', '<', '>', '!', '=', '?', ':', '.', ',', ';', '(', ')', '[', ']', '{', '}'];
    function tokens(src) {
      var out = [], i = 0, n = src.length, linha = 1;
      while (i < n) {
        var c = src[i];
        if (c === '\n') { linha++; i++; continue; }
        if (c === ' ' || c === '\t' || c === '\r') { i++; continue; }
        if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') { i++; } continue; }
        if (c === '/' && src[i + 1] === '*') { i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') { linha++; } i++; } i += 2; continue; }
        if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) {
          var m = /^(\d*\.?\d+(?:[eE][-+]?\d+)?|\d+\.)/.exec(src.slice(i));
          out.push({ t: 'num', v: parseFloat(m[0]), l: linha }); i += m[0].length; continue;
        }
        if (c === '"' || c === "'" || c === '`') {
          var q = c, s = ''; i++;
          while (i < n && src[i] !== q) {
            if (src[i] === '\n' && q !== '`') { throw falha('texto sem fechar aspas', linha); }
            if (src[i] === '\\') { i++; var e = src[i]; s += e === 'n' ? '\n' : (e === 't' ? '\t' : e); i++; continue; }
            if (src[i] === '\n') { linha++; }
            s += src[i]; i++;
          }
          if (i >= n) { throw falha('texto sem fechar aspas', linha); }
          i++; out.push({ t: 'str', v: s, l: linha }); continue;
        }
        if (/[A-Za-z_$\u00C0-\u017F]/.test(c)) {
          var j = i; while (j < n && /[A-Za-z0-9_$\u00C0-\u017F]/.test(src[j])) { j++; }
          out.push({ t: 'id', v: src.slice(i, j), l: linha }); i = j; continue;
        }
        var achou = null;
        for (var k = 0; k < PONT.length; k++) { if (src.substr(i, PONT[k].length) === PONT[k]) { achou = PONT[k]; break; } }
        if (!achou) { throw falha('não entendi o símbolo "' + c + '"', linha); }
        out.push({ t: 'p', v: achou, l: linha }); i += achou.length;
      }
      out.push({ t: 'fim', v: '', l: linha });
      return out;
    }

    // ── análise (descida recursiva + Pratt) ──
    var CHAVES = { 'var': 1, 'let': 1, 'const': 1, 'if': 1, 'else': 1, 'while': 1, 'for': 1, 'break': 1, 'continue': 1, 'return': 1, 'function': 1, 'of': 0, 'in': 0 };
    var BIN = { '||': 1, '&&': 2, '==': 3, '!=': 3, '===': 3, '!==': 3, '<': 4, '>': 4, '<=': 4, '>=': 4, '+': 5, '-': 5, '*': 6, '/': 6, '%': 6, '**': 7 };
    function analisar(src) {
      var tk = tokens(String(src || '')), p = 0;
      function ver(v) { return tk[p].v === v && (tk[p].t === 'p' || tk[p].t === 'id'); }
      function pegar(v) { if (!ver(v)) { throw falha('esperava "' + v + '" e achei "' + (tk[p].v || 'fim do código') + '"', tk[p].l); } return tk[p++]; }
      function talvez(v) { if (ver(v)) { p++; return true; } return false; }
      function nome() { var t = tk[p]; if (t.t !== 'id' || CHAVES[t.v]) { throw falha('esperava um nome e achei "' + (t.v || 'fim do código') + '"', t.l); } p++; return t.v; }
      function bloco() { pegar('{'); var c = []; while (!ver('}')) { if (tk[p].t === 'fim') { throw falha('faltou fechar "}"', tk[p].l); } c.push(comando()); } p++; return { k: 'bloco', c: c }; }
      function decl() {
        var l = tk[p].l; p++; var itens = [];
        do { var nm = nome(), ini = null; if (talvez('=')) { ini = expr(); } itens.push([nm, ini]); } while (talvez(','));
        return { k: 'var', itens: itens, l: l };
      }
      function comando() {
        var t = tk[p], l = t.l, r;
        if (t.t === 'p' && t.v === ';') { p++; return { k: 'nada' }; }
        if (t.t === 'p' && t.v === '{') { return bloco(); }
        if (t.t === 'id') {
          if (t.v === 'var' || t.v === 'let' || t.v === 'const') { r = decl(); talvez(';'); return r; }
          if (t.v === 'if') { p++; pegar('('); var c = expr(); pegar(')'); var e1 = comando(), e2 = null; if (talvez('else')) { e2 = comando(); } return { k: 'if', c: c, a: e1, b: e2, l: l }; }
          if (t.v === 'while') { p++; pegar('('); var cw = expr(); pegar(')'); return { k: 'while', c: cw, corpo: comando(), l: l }; }
          if (t.v === 'for') {
            p++; pegar('(');
            if ((ver('var') || ver('let') || ver('const')) && tk[p + 2] && tk[p + 2].v === 'of') {
              p++; var nv = nome(); p++; var lista = expr(); pegar(')');
              return { k: 'forof', nome: nv, lista: lista, corpo: comando(), l: l };
            }
            var ini = null, cond = null, inc = null;
            if (!ver(';')) { ini = (ver('var') || ver('let') || ver('const')) ? decl() : { k: 'expr', e: expr() }; }
            pegar(';'); if (!ver(';')) { cond = expr(); } pegar(';'); if (!ver(')')) { inc = expr(); } pegar(')');
            return { k: 'for', ini: ini, c: cond, inc: inc, corpo: comando(), l: l };
          }
          if (t.v === 'break' || t.v === 'continue') { p++; talvez(';'); return { k: t.v, l: l }; }
          if (t.v === 'return') { p++; var v = null; if (!ver(';') && !ver('}') && tk[p].t !== 'fim' && tk[p].l === l) { v = expr(); } talvez(';'); return { k: 'return', e: v, l: l }; }
          if (t.v === 'function' && tk[p + 1].t === 'id') { p++; var fn = nome(); var f = funcao(l); return { k: 'var', itens: [[fn, f]], l: l }; }
        }
        r = { k: 'expr', e: expr(), l: l }; talvez(';'); return r;
      }
      function params() { pegar('('); var ps = []; if (!ver(')')) { do { ps.push(nome()); } while (talvez(',')); } pegar(')'); return ps; }
      function funcao(l) { var ps = params(); return { k: 'fn', ps: ps, corpo: bloco(), l: l }; }
      function setaAdiante() {   // ( a, b ) =>  ?
        var q = p, prof = 0;
        for (; q < tk.length; q++) { if (tk[q].v === '(' && tk[q].t === 'p') { prof++; } else if (tk[q].v === ')' && tk[q].t === 'p') { prof--; if (prof === 0) { break; } } }
        return tk[q + 1] && tk[q + 1].v === '=>';
      }
      function corpoSeta(ps, l) { if (ver('{')) { return { k: 'fn', ps: ps, corpo: bloco(), l: l }; } var e = expr1(); return { k: 'fn', ps: ps, corpo: { k: 'bloco', c: [{ k: 'return', e: e, l: l }] }, l: l }; }
      function primario() {
        var t = tk[p], l = t.l;
        if (t.t === 'num' || t.t === 'str') { p++; return { k: 'lit', v: t.v }; }
        if (t.t === 'id') {
          if (t.v === 'true' || t.v === 'false') { p++; return { k: 'lit', v: t.v === 'true' }; }
          if (t.v === 'null') { p++; return { k: 'lit', v: null }; }
          if (t.v === 'undefined') { p++; return { k: 'lit', v: undefined }; }
          if (t.v === 'function') { p++; if (tk[p].t === 'id' && !ver('(')) { p++; } return funcao(l); }
          if (tk[p + 1].v === '=>') { var n1 = nome(); p++; return corpoSeta([n1], l); }
          return { k: 'nome', v: nome(), l: l };
        }
        if (t.v === '(') {
          if (setaAdiante()) { var ps = params(); pegar('=>'); return corpoSeta(ps, l); }
          p++; var e = expr(); pegar(')'); return e;
        }
        if (t.v === '[') { p++; var it = []; while (!ver(']')) { it.push(expr1()); if (!talvez(',')) { break; } } pegar(']'); return { k: 'lista', it: it }; }
        if (t.v === '{') {
          p++; var pares = [];
          while (!ver('}')) {
            var kt = tk[p], chave;
            if (kt.t === 'id' || kt.t === 'str' || kt.t === 'num') { chave = String(kt.v); p++; } else { throw falha('chave de objeto inválida', kt.l); }
            if (PROIBIDO[chave]) { throw falha('o nome "' + chave + '" não pode ser usado', kt.l); }
            if (talvez(':')) { pares.push([chave, expr1()]); } else { pares.push([chave, { k: 'nome', v: chave, l: kt.l }]); }
            if (!talvez(',')) { break; }
          }
          pegar('}'); return { k: 'obj', pares: pares };
        }
        throw falha('não esperava "' + (t.v || 'fim do código') + '"', l);
      }
      function posfixo() {
        var e = primario();
        for (;;) {
          var l = tk[p].l;
          if (talvez('.')) { var nmp = tk[p]; if (nmp.t !== 'id') { throw falha('esperava um nome depois do ponto', l); } p++; e = { k: 'membro', o: e, nome: { k: 'lit', v: nmp.v }, l: l }; }
          else if (talvez('[')) { var ix = expr(); pegar(']'); e = { k: 'membro', o: e, nome: ix, l: l }; }
          else if (ver('(')) { p++; var args = []; if (!ver(')')) { do { args.push(expr1()); } while (talvez(',')); } pegar(')'); e = { k: 'chama', f: e, args: args, l: l }; }
          else if ((ver('++') || ver('--')) && tk[p].l === tk[p - 1].l) { var op = tk[p++].v; e = { k: 'incr', alvo: e, op: op, pos: true, l: l }; }
          else { return e; }
        }
      }
      function unario() {
        var t = tk[p];
        if (t.t === 'p' && (t.v === '!' || t.v === '-' || t.v === '+')) { p++; return { k: 'un', op: t.v, e: unario(), l: t.l }; }
        if (t.t === 'p' && (t.v === '++' || t.v === '--')) { p++; return { k: 'incr', alvo: unario(), op: t.v, pos: false, l: t.l }; }
        if (t.t === 'id' && t.v === 'typeof') { p++; return { k: 'un', op: 'typeof', e: unario(), l: t.l }; }
        return posfixo();
      }
      function binario(min) {
        var e = unario();
        for (;;) {
          var t = tk[p], pr = t.t === 'p' ? BIN[t.v] : 0;
          if (!pr || pr < min) { return e; }
          p++;
          var dir = binario(t.v === '**' ? pr : pr + 1);
          e = { k: (t.v === '&&' || t.v === '||') ? 'logico' : 'bin', op: t.v, a: e, b: dir, l: t.l };
        }
      }
      function expr1() {   // atribuição e ternário (sem vírgula)
        var l = tk[p].l, e = binario(1);
        if (talvez('?')) { var a = expr1(); pegar(':'); var b = expr1(); return { k: 'tern', c: e, a: a, b: b }; }
        var t = tk[p];
        if (t.t === 'p' && (t.v === '=' || t.v === '+=' || t.v === '-=' || t.v === '*=' || t.v === '/=' || t.v === '%=')) {
          if (e.k !== 'nome' && e.k !== 'membro') { throw falha('não dá para guardar valor aí', l); }
          p++; return { k: 'atrib', alvo: e, op: t.v, e: expr1(), l: l };
        }
        return e;
      }
      function expr() { return expr1(); }
      var prog = [];
      while (tk[p].t !== 'fim') { prog.push(comando()); }
      return { k: 'bloco', c: prog, raiz: true };
    }

    // ── execução (árvore, com orçamento de passos) ──
    var QUEBRA = { s: 'break' }, CONTINUA = { s: 'continue' };
    function Retorno(v) { this.v = v; }
    function Escopo(pai) { this.v = Object.create(null); this.pai = pai; }
    Escopo.prototype.achar = function (n) { var e = this; while (e) { if (n in e.v) { return e; } e = e.pai; } return null; };
    function FuncMagica(no, escopo, rodar) { this.no = no; this.escopo = escopo; this.rodar = rodar; }

    function executar(ast, globais, limite) {
      var passos = 0, max = limite || 50000, prof = 0;
      var raiz = new Escopo(null);
      Object.keys(globais).forEach(function (k) { raiz.v[k] = globais[k]; });
      function gasto(l) { if (++passos > max) { throw falha('o código mágico demorou demais (será um laço sem fim?)', l); } }
      function texto(v) { return typeof v === 'string' && v.length > MAX_TEXTO ? v.slice(0, MAX_TEXTO) : v; }
      function lerMembro(o, k, l) {
        if (o === null || o === undefined) { throw falha('tentei ler "' + k + '" de algo vazio', l); }
        if (typeof k !== 'number') { k = String(k); if (PROIBIDO[k]) { throw falha('"' + k + '" não pode ser usado', l); } }
        if (Array.isArray(o)) {
          if (typeof k === 'number' || /^\d+$/.test(k)) { return o[k]; }
          if (!MET_LISTA[k]) { throw falha('lista não tem "' + k + '"', l); }
          if (k === 'length') { return o.length; }
          return { nativa: Array.prototype[k], este: o, nome: k };
        }
        if (typeof o === 'string') {
          if (typeof k === 'number' || /^\d+$/.test(k)) { return o[k]; }
          if (!MET_TEXTO[k]) { throw falha('texto não tem "' + k + '"', l); }
          if (k === 'length') { return o.length; }
          return { nativa: String.prototype[k], este: o, nome: k };
        }
        if (o instanceof Hospede) { return Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined; }
        if (typeof o === 'object' && Object.getPrototypeOf(o) === null) { return o[k]; }
        if (typeof o === 'number' && k === 'toFixed') { return { nativa: Number.prototype.toFixed, este: o, nome: k }; }
        throw falha('não dá para ler "' + k + '" aqui', l);
      }
      function gravarMembro(o, k, v, l) {
        if (typeof k !== 'number') { k = String(k); if (PROIBIDO[k]) { throw falha('"' + k + '" não pode ser usado', l); } }
        if (Array.isArray(o)) {
          var ix = typeof k === 'number' ? k : (/^\d+$/.test(k) ? parseInt(k, 10) : NaN);
          if (isNaN(ix) || ix < 0 || ix > MAX_LISTA) { throw falha('posição de lista inválida', l); }
          o[ix] = v; return v;
        }
        if (o && typeof o === 'object' && !(o instanceof Hospede) && Object.getPrototypeOf(o) === null) { o[k] = texto(v); return v; }
        throw falha('não dá para mudar "' + k + '" aqui (use as funções do jogo)', l);
      }
      function chamar(f, args, l) {
        if (f instanceof FuncMagica) {
          if (++prof > 60) { prof = 0; throw falha('funções demais uma dentro da outra', l); }
          var esc = new Escopo(f.escopo);
          f.no.ps.forEach(function (n, i) { esc.v[n] = args[i]; });
          esc.v.argumentos = args.slice();
          var r = rodar(f.no.corpo, esc); prof--;
          return r instanceof Retorno ? r.v : undefined;
        }
        if (f && f.nativa) {
          if (f.nome === 'push' || f.nome === 'unshift' || f.nome === 'concat' || f.nome === 'splice') { if (f.este.length + args.length > MAX_LISTA) { throw falha('lista grande demais', l); } }
          var nat = args.map(function (a) { return a instanceof FuncMagica ? function () { return chamar(a, Array.prototype.slice.call(arguments), l); } : a; });
          var res = f.nativa.apply(f.este, nat);
          if (Array.isArray(res) && res.length > MAX_LISTA) { throw falha('lista grande demais', l); }
          return texto(res);
        }
        if (typeof f === 'function') {   // função da casa (API do jogo)
          var a2 = args.map(function (a) { return a instanceof FuncMagica ? function () { return chamar(a, Array.prototype.slice.call(arguments), l); } : a; });
          return f.apply(null, a2);
        }
        throw falha('isso não é uma função', l);
      }
      function aritm(op, a, b, l) {
        switch (op) {
          case '+': var r = a + b; if (typeof r === 'string' && r.length > MAX_TEXTO) { throw falha('texto grande demais', l); } return r;
          case '-': return a - b; case '*': return a * b; case '/': return a / b; case '%': return a % b;
          case '**': return Math.pow(a, b);
          case '==': return a == b; case '!=': return a != b;   // eslint-disable-line eqeqeq
          case '===': return a === b; case '!==': return a !== b;
          case '<': return a < b; case '>': return a > b; case '<=': return a <= b; case '>=': return a >= b;
        }
        throw falha('operação desconhecida ' + op, l);
      }
      function aval(n, esc) {
        gasto(n.l);
        switch (n.k) {
          case 'lit': return n.v;
          case 'nome': { var e = esc.achar(n.v); if (!e) { throw falha('não conheço "' + n.v + '"', n.l); } return e.v[n.v]; }
          case 'lista': { var arr = n.it.map(function (x) { return aval(x, esc); }); if (arr.length > MAX_LISTA) { throw falha('lista grande demais', n.l); } return arr; }
          case 'obj': { var o = Object.create(null); n.pares.forEach(function (pp) { o[pp[0]] = aval(pp[1], esc); }); return o; }
          case 'fn': return new FuncMagica(n, esc, rodar);
          case 'membro': return lerMembro(aval(n.o, esc), aval(n.nome, esc), n.l);
          case 'chama': {
            var f, este;
            if (n.f.k === 'membro') { este = aval(n.f.o, esc); f = lerMembro(este, aval(n.f.nome, esc), n.l); }
            else { f = aval(n.f, esc); }
            var args = n.args.map(function (x) { return aval(x, esc); });
            return chamar(f, args, n.l);
          }
          case 'un': { var v = aval(n.e, esc); if (n.op === '!') { return !v; } if (n.op === '-') { return -v; } if (n.op === 'typeof') { return v instanceof FuncMagica ? 'function' : (v === null ? 'object' : typeof v); } return +v; }
          case 'bin': return aritm(n.op, aval(n.a, esc), aval(n.b, esc), n.l);
          case 'logico': { var a = aval(n.a, esc); if (n.op === '&&') { return a ? aval(n.b, esc) : a; } return a ? a : aval(n.b, esc); }
          case 'tern': return aval(n.c, esc) ? aval(n.a, esc) : aval(n.b, esc);
          case 'atrib': {
            var val = aval(n.e, esc);
            if (n.op !== '=') { val = aritm(n.op.charAt(0), aval(n.alvo, esc), val, n.l); }
            return guardar(n.alvo, val, esc, n.l);
          }
          case 'incr': {
            var antes = aval(n.alvo, esc), depois = (+antes) + (n.op === '++' ? 1 : -1);
            guardar(n.alvo, depois, esc, n.l); return n.pos ? antes : depois;
          }
        }
        throw falha('não sei executar isso', n.l);
      }
      function guardar(alvo, val, esc, l) {
        if (alvo.k === 'nome') {
          var e = esc.achar(alvo.v);
          if (!e) { throw falha('a variável "' + alvo.v + '" não existe — crie com var ' + alvo.v + ' = ...', l); }
          if (e === raiz && globais.hasOwnProperty(alvo.v)) { throw falha('"' + alvo.v + '" é da casa e não pode ser trocado', l); }
          e.v[alvo.v] = texto(val); return val;
        }
        if (alvo.k === 'membro') { return gravarMembro(aval(alvo.o, esc), aval(alvo.nome, esc), val, l); }
        throw falha('não dá para guardar valor aí', l);
      }
      function rodar(n, esc) {
        gasto(n.l);
        switch (n.k) {
          case 'nada': return null;
          case 'expr': aval(n.e, esc); return null;
          case 'var': n.itens.forEach(function (it) { esc.v[it[0]] = it[1] ? aval(it[1], esc) : undefined; }); return null;
          case 'bloco': {
            var e2 = n.raiz ? esc : new Escopo(esc);
            for (var i = 0; i < n.c.length; i++) { var r = rodar(n.c[i], e2); if (r) { return r; } }
            return null;
          }
          case 'if': return aval(n.c, esc) ? rodar(n.a, esc) : (n.b ? rodar(n.b, esc) : null);
          case 'while': for (;;) { gasto(n.l); if (!aval(n.c, esc)) { return null; } var rw = rodar(n.corpo, esc); if (rw === QUEBRA) { return null; } if (rw instanceof Retorno) { return rw; } }
          case 'for': {
            var ef = new Escopo(esc);
            if (n.ini) { rodar(n.ini, ef); }
            for (;;) {
              gasto(n.l);
              if (n.c && !aval(n.c, ef)) { return null; }
              var rf = rodar(n.corpo, ef);
              if (rf === QUEBRA) { return null; } if (rf instanceof Retorno) { return rf; }
              if (n.inc) { aval(n.inc, ef); }
            }
          }
          case 'forof': {
            var lista = aval(n.lista, esc);
            if (!Array.isArray(lista) && typeof lista !== 'string') { throw falha('for...of precisa de uma lista', n.l); }
            for (var k = 0; k < lista.length; k++) {
              var eo = new Escopo(esc); eo.v[n.nome] = lista[k];
              var ro = rodar(n.corpo, eo);
              if (ro === QUEBRA) { return null; } if (ro instanceof Retorno) { return ro; }
            }
            return null;
          }
          case 'break': return QUEBRA;
          case 'continue': return CONTINUA;
          case 'return': return new Retorno(n.e ? aval(n.e, esc) : undefined);
        }
        throw falha('não sei executar isso', n.l);
      }
      var r = rodar(ast, raiz);
      return { passos: passos, valor: r instanceof Retorno ? r.v : undefined };
    }

    var cache = {};
    function compilar(src) {
      src = String(src || '');
      if (src.length > 6000) { throw falha('código mágico grande demais (máx. 6000 letras)'); }
      if (!cache[src]) { cache[src] = analisar(src); }
      return cache[src];
    }
    function objeto(props) { var o = Object.create(null); for (var k in props) { if (Object.prototype.hasOwnProperty.call(props, k)) { o[k] = props[k]; } } return o; }
    return { compilar: compilar, executar: executar, Hospede: Hospede, objeto: objeto };
  })();

  // ═══════════════════════════ 🃏 CARTAS DE COMPORTAMENTO (motor 0.9.6 · 26/10/2026) ═══════════════════════════
  // "QUANDO isto → FAÇA aquilo", por personagem: entidades.X.regras = [{quando, segundos?, distancia?, zona?,
  //   se:[{teste, ...}], juntar:'e'|'ou', faz:[{faz, ...}], senao:[{faz, ...}]}]
  // Princípio (ADR 26/10/2026, "autonomia controlada quase total"): a criança e a IA mudam o JEITO do inimigo com
  // cartas que a casa entende; a carta ✨ {faz:'codigo'} roda o mini-JS da casa quando nenhuma carta pronta serve.
  // Um inimigo COM cartas deixa de usar o jeito do gênero (andar, atirar, encostar). SEM cartas: igualzinho a antes
  // (o replay do placar dos jogos antigos não muda).
  var Cartas = (function () {
    var QUANDO = { sempre: 1, comeca: 1, a_cada: 1, perto: 1, longe: 1, borda: 1, parede: 1, beirada: 1, heroi: 1, atingido: 1,
                   zona_entra: 1, zona_sai: 1, heroi_zona: 1 };
    var SE = { heroi_perto: 1, heroi_longe: 1, heroi_grande: 1, heroi_no_chao: 1, heroi_a_esquerda: 1, heroi_a_direita: 1,
               valor: 1, sorte: 1, poucos_inimigos: 1, zona: 1 };
    var FAZ = { anda: 1, para: 1, vira: 1, desce: 1, sobe: 1, volta: 1, pula: 1, voa: 1, atira: 1, persegue: 1, foge: 1, dano: 1,
                explode: 1, gigante: 1, normal: 1, rapido: 1, devagar: 1, som: 1, muda: 1, codigo: 1, toca_musica: 1, volta_musica: 1 };
    var INSTANTE = { vira: 1, desce: 1, sobe: 1, volta: 1, pula: 1, atira: 1, dano: 1, explode: 1, som: 1, muda: 1, codigo: 1, toca_musica: 1, volta_musica: 1 };
    var DIRS = { esq: [-1, 0], dir: [1, 0], cima: [0, -1], baixo: [0, 1] };
    function tem(o) { return !!(o && o.def && Array.isArray(o.def.regras) && o.def.regras.length); }
    function prep(jogo, o) {
      if (o.cv) { return o.cv; }
      var d = jogo.cartaDirInicial ? jogo.cartaDirInicial(o) : [o.vx > 0 ? 1 : -1, 0];
      o.cv = { modo: 'para', dx: d[0], dy: d[1], mult: 1, voa: false, cond: {}, ult: {}, perto: {}, zonas: {}, ev: {}, aceso: {},
               iniciou: false, ux: o.x, uy: o.y, sorteioT: 0 };
      o.mem = Magico.objeto({});
      if (o.vida == null) { o.vidaMax = o.vida = clamp(o.def.vida || 1, 1, 50); }
      if (o.vidaMax == null) { o.vidaMax = o.vida; }
      return o.cv;
    }
    function centro(c) { return { x: c.x + c.w / 2, y: c.y + c.h / 2 }; }
    function distBlocos(jogo, o) { var a = centro(o), b = centro(jogo.heroi); return Math.sqrt(Math.pow(a.x - b.x, 2) + Math.pow(a.y - b.y, 2)) / jogo.T; }
    function naZona(jogo, x, y, cor) {
      var zs = jogo.fase && jogo.fase.zonas, T = jogo.T;
      if (!zs || !cor) { return false; }
      var lista = zs[cor];
      if (!Array.isArray(lista)) { return false; }
      var c = Math.floor(x / T) + 1, l = Math.floor(y / T) + 1;
      for (var k = 0; k < lista.length; k++) {
        var r = lista[k];
        if (Array.isArray(r) && r.length === 4 && c >= Math.min(r[0], r[2]) && c <= Math.max(r[0], r[2]) && l >= Math.min(r[1], r[3]) && l <= Math.max(r[1], r[3])) { return true; }
      }
      return false;
    }
    function heroiForte(jogo) { var h = jogo.heroi; return !!(h.grande || h.estrela > 0 || h.poder || jogo.assusta > 0); }
    function valorDe(o, nome) { if (nome === 'vida') { return o.vida; } var v = o.mem[nome]; return v == null ? 0 : v; }
    function testar(jogo, o, r) {
      var se = Array.isArray(r.se) ? r.se : [];
      if (!se.length) { return true; }
      var ou = r.juntar === 'ou', h = jogo.heroi;
      for (var k = 0; k < se.length && k < 6; k++) {
        var t = se[k] || {}, ok = false, d;
        switch (t.teste) {
          case 'heroi_perto': ok = distBlocos(jogo, o) <= clamp(t.distancia || 3, 0.5, 40); break;
          case 'heroi_longe': ok = distBlocos(jogo, o) > clamp(t.distancia || 3, 0.5, 40); break;
          case 'heroi_grande': ok = heroiForte(jogo); break;
          case 'heroi_no_chao': ok = h.chao !== false; break;
          case 'heroi_a_esquerda': ok = centro(h).x < centro(o).x; break;
          case 'heroi_a_direita': ok = centro(h).x > centro(o).x; break;
          case 'valor':
            d = valorDe(o, t.nome || 'contador');
            if (t.igual != null) { ok = String(d) === String(t.igual); }
            else if (t.menor != null) { ok = +d < +t.menor; }
            else if (t.maior != null) { ok = +d > +t.maior; }
            break;
          case 'sorte': ok = jogo.rng() * 100 < clamp(t.chance == null ? 50 : t.chance, 0, 100); break;
          case 'poucos_inimigos': {
            var n = 0; (jogo.objs || []).forEach(function (x) { if (x.vivo && x.tipo === 'inimigo') { n++; } });
            ok = n <= clamp(t.quantos || 5, 0, 500); break;
          }
          case 'zona': { var c = centro(o); ok = naZona(jogo, c.x, c.y, t.zona); break; }
          default: ok = false;
        }
        if (t.nao) { ok = !ok; }
        if (ou && ok) { return true; }
        if (!ou && !ok) { return false; }
      }
      return !ou;
    }
    function acender(jogo, o, k, ramo) {
      o.cv.aceso[k] = jogo.quadro;
      var u = jogo.ultimasCartas || (jogo.ultimasCartas = []);
      u.push({ letra: o.ch, regra: k, ramo: ramo, quadro: jogo.quadro });
      if (u.length > 16) { u.shift(); }
    }
    function rodar(jogo, o, r, k, continuo, dados) {
      var cv = o.cv, ok = testar(jogo, o, r), lista = ok ? r.faz : r.senao, ramo = ok ? 'faz' : 'senao';
      if (!Array.isArray(lista) || !lista.length) { cv.cond[k] = ramo; return; }
      var instantes = true;
      if (continuo) {
        var gap = Math.round(clamp(r.segundos || 1, 0.2, 60) * 60);
        instantes = cv.cond[k] !== ramo || (jogo.quadro - (cv.ult[k] == null ? -1e9 : cv.ult[k])) >= gap;
        if (instantes) { cv.ult[k] = jogo.quadro; }
      }
      cv.cond[k] = ramo;
      for (var a = 0; a < lista.length && a < 12; a++) {
        var ac = lista[a];
        if (!ac || !o.vivo) { continue; }
        if (continuo && INSTANTE[ac.faz] && !instantes) { continue; }
        fazer(jogo, o, ac, dados || {});
      }
      if (instantes) { acender(jogo, o, k, ramo); }
    }
    function manterJeito(jogo, o, r) {   // 🩹 02/11: só as cartas de JEITO (não instantâneas), sem acender a carta de novo
      if (!testar(jogo, o, r)) { return; }
      var lista = r.faz || [];
      for (var a = 0; a < lista.length && a < 12; a++) { var ac = lista[a]; if (ac && o.vivo && !INSTANTE[ac.faz]) { fazer(jogo, o, ac, {}); } }
    }
    function evento(jogo, o, nome, dados) {   // devolve true se alguma carta daquele evento existe
      if (!tem(o)) { return false; }
      var cv = prep(jogo, o), rs = o.def.regras, achou = false;
      if (nome !== 'atingido' && nome !== 'comeca' && cv.ev[nome] != null && jogo.quadro - cv.ev[nome] < (nome === 'heroi' ? 30 : 8)) { return true; }
      for (var k = 0; k < rs.length && k < 40; k++) {
        var r = rs[k];
        if (!r || r.quando !== nome) { continue; }
        achou = true; rodar(jogo, o, r, k, false, dados);
      }
      if (achou) { cv.ev[nome] = jogo.quadro; }
      return achou;
    }
    function passo(jogo, o) {
      var cv = prep(jogo, o), rs = o.def.regras;
      quadroDoObj(o);
      if (!cv.iniciou) { cv.iniciou = true; evento(jogo, o, 'comeca', {}); }
      var h = jogo.heroi, hc = centro(h), c = centro(o);
      for (var k = 0; k < rs.length && k < 40 && o.vivo; k++) {
        var r = rs[k]; if (!r) { continue; }
        var q = r.quando, dentro;
        if (q === 'sempre') { rodar(jogo, o, r, k, true, {}); }
        else if (q === 'a_cada') { var n = Math.round(clamp(r.segundos || 1, 0.2, 60) * 60); if ((o.t + k * 7) % n === 0) { rodar(jogo, o, r, k, false, {}); } }
        else if (q === 'perto' || q === 'longe') {
          var p = distBlocos(jogo, o) <= clamp(r.distancia || 3, 0.5, 40), est = q === 'perto' ? p : !p;
          if (est && !cv.perto[k]) { rodar(jogo, o, r, k, false, {}); }
          cv.perto[k] = est;
        } else if (q === 'zona_entra' || q === 'zona_sai' || q === 'heroi_zona') {
          dentro = q === 'heroi_zona' ? naZona(jogo, hc.x, hc.y, r.zona) : naZona(jogo, c.x, c.y, r.zona);
          var antes = cv.zonas[k];
          // 🩹 02/11/2026 (André, "Meu Rio"): o navio e o helicóptero NASCIAM dentro da zona azul e a carta "QUANDO entra
          // na zona → para" nunca disparava (só valia de fora para dentro). Agora nascer dentro conta como entrar, e
          // ENQUANTO está na zona o jeito da carta (para, anda, devagar…) continua valendo — senão "QUANDO perto → anda"
          // desfazia o "para" logo depois. As cartas instantâneas (atira, som…) só rodam na entrada.
          var entrou = q === 'zona_entra' ? (dentro && antes !== true) : (antes != null && dentro !== antes && (q === 'zona_sai' ? !dentro : dentro));
          if (entrou) { rodar(jogo, o, r, k, false, {}); }
          else if (q === 'zona_entra' && dentro) { manterJeito(jogo, o, r); }
          cv.zonas[k] = dentro;
        }
      }
      if (o.vivo) { mover(jogo, o); }
    }
    function velBase(jogo, o) { return jogo.cartaVel ? jogo.cartaVel(o) : clamp(o.def.velocidade || 0.6, 0.1, 3) * 0.9 * jogo.esc; }
    function sortear(jogo, o) { var ds = [[1, 0], [-1, 0], [0, -1], [0, 1]], d = ds[Math.floor(jogo.rng() * 4)]; o.cv.dx = d[0]; o.cv.dy = d[1]; }
    function mover(jogo, o) {
      var cv = o.cv, v = velBase(jogo, o) * cv.mult, h = jogo.heroi, dx = 0, dy = 0, T = jogo.T;
      cv.ux = o.x; cv.uy = o.y;
      if (cv.modo === 'anda' || cv.modo === 'sorteio') {
        if (cv.modo === 'sorteio' && --cv.sorteioT <= 0) { sortear(jogo, o); cv.sorteioT = 40 + Math.floor(jogo.rng() * 60); }
        dx = cv.dx * v; dy = cv.dy * v;
      } else if (cv.modo === 'vaivem') {
        if (!cv.dx) { cv.dx = -1; }
        if (o.x < o.x0 - T * 3) { cv.dx = 1; } else if (o.x > o.x0 + T * 3) { cv.dx = -1; }
        dx = cv.dx * v;
      } else if (cv.modo === 'persegue' || cv.modo === 'foge') {
        var s = cv.modo === 'foge' ? -1 : 1, a = centro(o), b = centro(h), ex = b.x - a.x, ey = b.y - a.y, dd = Math.sqrt(ex * ex + ey * ey) || 1;
        dx = s * ex / dd * v; dy = s * ey / dd * v;
        if (Math.abs(ex) > 1) { cv.dx = (s * ex > 0) ? 1 : -1; }
      }
      var res = jogo.cartaMover ? jogo.cartaMover(o, dx, dy, v) : moverLivre(jogo, o, dx, dy);
      res = res || {};
      if (res.parede) { if (cv.modo === 'sorteio') { cv.sorteioT = 0; } evento(jogo, o, 'parede', {}); }
      if (res.borda) { if (jogo.bordaEmGrupo) { (jogo._bordas || (jogo._bordas = {}))[o.ch] = 1; } else { evento(jogo, o, 'borda', {}); } }
      if (res.beirada) { evento(jogo, o, 'beirada', {}); }
    }
    function moverLivre(jogo, o, dx, dy) {   // gêneros vistos de cima / de lado sem gravidade: anda com colisão nos blocos
      var res = {}, m = 1;
      if (dx) {
        o.x += dx;
        if (o.x < 0 || o.x + o.w > jogo.larg) { o.x -= dx; res.borda = true; }
        else if (!o.cv.voa && jogo.caixaBate(o.x + m, o.y + m, o.w - 2 * m, o.h - 2 * m)) { o.x -= dx; res.parede = true; }
      }
      if (dy) {
        o.y += dy;
        if (o.y < 0 || o.y + o.h > jogo.alt) { o.y -= dy; res.borda = true; }
        else if (!o.cv.voa && jogo.caixaBate(o.x + m, o.y + m, o.w - 2 * m, o.h - 2 * m)) { o.y -= dy; res.parede = true; }
      }
      o.vx = dx || (o.cv.dx * 0.01);
      return res;
    }
    function fimDoQuadro(jogo) {   // tiro fixo: a FORMAÇÃO encosta na borda (todos da mesma letra reagem juntos)
      var b = jogo._bordas; if (!b) { return; }
      jogo._bordas = null;
      (jogo.objs || []).forEach(function (o) { if (o.vivo && b[o.ch] && tem(o)) { evento(jogo, o, 'borda', {}); } });
    }
    function escala(jogo, o, n) {
      var sp = jogo.sprites[o.def.sprite] || { w: jogo.T, h: jogo.T };
      if ((o.esc || 1) === n) { return; }
      var base = o.y + o.h, meio = o.x + o.w / 2;
      o.esc = n; o.w = sp.w * n; o.h = sp.h * n; o.x = meio - o.w / 2; o.y = base - o.h;
    }
    function atirar(jogo, o, a) {
      var cv = o.cv, d = a.dir || 'frente', vx = 0, vy = 0, vt = clamp(a.velocidade || 1, 0.3, 4) * 1.5 * jogo.esc;
      if (d === 'heroi') { var p = centro(o), q = centro(jogo.heroi), ex = q.x - p.x, ey = q.y - p.y, dd = Math.sqrt(ex * ex + ey * ey) || 1; vx = ex / dd * vt; vy = ey / dd * vt; }
      else if (DIRS[d]) { vx = DIRS[d][0] * vt; vy = DIRS[d][1] * vt; }
      else if (d === 'lado') { vx = (centro(jogo.heroi).x > centro(o).x ? 1 : -1) * vt; }
      else { vx = (cv.dx || (o.vx > 0 ? 1 : -1)) * vt; vy = cv.dy * vt; if (!cv.dx && !cv.dy) { vx = -vt; } }
      if (jogo.cartaTiro) { jogo.cartaTiro(o, vx, vy); return; }
      var lista = jogo.tirosInim || (jogo.tirosInim = []);
      if (lista.length >= (jogo.maxTirosCartas || 12)) { return; }
      var w = Math.max(2, jogo.T >> 2);
      lista.push({ x: o.x + o.w / 2 - w / 2, y: o.y + o.h / 2 - w / 2, w: w, h: w, vx: vx, vy: vy, cartas: true });
      jogo.som.efeito('tiro');
    }
    function tirosBase(jogo) {   // os gêneros que não tinham tiro de inimigo (aventura, briga, labirinto, travessia)
      var h = jogo.heroi;
      if (!jogo.tirosInim || !jogo.tirosInim.length) { return; }
      jogo.tirosInim = jogo.tirosInim.filter(function (b) {
        b.x += b.vx; b.y += b.vy;
        if (b.x < -jogo.T || b.y < -jogo.T || b.x > jogo.larg + jogo.T || b.y > jogo.alt + jogo.T) { return false; }
        if (jogo.caixaBate(b.x, b.y, b.w, b.h)) { return false; }
        if (bate(b, h, 1)) { jogo.ferir('tiro'); return false; }
        return true;
      });
    }
    function explodir(jogo, o) {
      if (jogo.cartaExplode) { jogo.cartaExplode(o); return; }
      o.vivo = false; jogo.pontos += o.def.pontos || 100; jogo.som.efeito('explosao');
    }
    function apiEu(jogo, o) {
      if (o.cv.api) { return o.cv.api; }
      var T = jogo.T;
      function f(ac) { return function (x) { var a = { faz: ac }; if (x != null) { a.dir = String(x); a.nome = String(x); } fazer(jogo, o, a, {}); }; }
      o.cv.api = new Magico.Hospede({
        letra: o.ch,
        coluna: function () { return Math.floor((o.x + o.w / 2) / T) + 1; },
        linha: function () { return Math.floor((o.y + o.h - 1) / T) + 1; },
        vida: function (n) { if (n) { o.vida = clamp(o.vida + (+n || 0), 0, 99); if (o.vida <= 0) { explodir(jogo, o); } } return o.vida; },
        anda: f('anda'), para: f('para'), vira: f('vira'), desce: f('desce'), sobe: f('sobe'), pula: f('pula'), voa: f('voa'),
        atira: f('atira'), persegue: f('persegue'), foge: f('foge'), explode: f('explode'), gigante: f('gigante'), normal: f('normal'),
        rapido: f('rapido'), devagar: f('devagar'), som: f('som'), dano: f('dano')
      });
      o.cv.apiH = new Magico.Hospede({
        heroi: function () { var h = jogo.heroi; return Magico.objeto({ coluna: Math.floor((h.x + h.w / 2) / T) + 1, linha: Math.floor((h.y + h.h - 1) / T) + 1, grande: heroiForte(jogo), no_chao: h.chao !== false }); },
        pontos: function (n) { if (n) { jogo.pontos = Math.max(0, jogo.pontos + (+n || 0)); } return jogo.pontos; },
        tempo: function () { return Math.floor(jogo.quadro / 60); },
        aleatorio: function (a, b) { a = Math.floor(+a || 0); b = Math.floor(b == null ? 1 : +b); return a + Math.floor(jogo.rng() * (b - a + 1)); },
        distancia: function () { return Math.round(distBlocos(jogo, o) * 10) / 10; }
      });
      return o.cv.api;
    }
    function codigo(jogo, o, src) {
      try {
        var eu = apiEu(jogo, o), J = o.cv.apiH;
        Magico.executar(Magico.compilar(src), { eu: eu, jogo: J, heroi: function () { return J.heroi(); }, memoria: o.mem, Math: Magico.objeto({ floor: Math.floor, abs: Math.abs, round: Math.round, min: Math.min, max: Math.max }) }, 20000);
      } catch (e) {
        var msg = e && e.magico ? e.message : 'erro no código mágico: ' + (e && e.message ? e.message : e);
        jogo.erroMagico = { texto: msg, ate: jogo.quadro + 360 };
        try { console.warn('[Fliperama · carta mágica]', msg); } catch (e2) { /* nada */ }
      }
    }
    function fazer(jogo, o, a, d) {
      var cv = prep(jogo, o), T = jogo.T, n;
      switch (a.faz) {
        case 'anda': {
          var dir = a.dir || 'frente';
          if (DIRS[dir]) { cv.dx = DIRS[dir][0]; cv.dy = DIRS[dir][1]; cv.modo = 'anda'; }
          else if (dir === 'vaivem') { cv.modo = 'vaivem'; }
          else if (dir === 'sorteio') { if (cv.modo !== 'sorteio') { cv.sorteioT = 0; } cv.modo = 'sorteio'; }
          else { if (!cv.dx && !cv.dy) { cv.dx = -1; } cv.modo = 'anda'; }
          break;
        }
        case 'para': cv.modo = 'para'; break;
        case 'vira': cv.dx = -cv.dx; cv.dy = -cv.dy; if (o.vx) { o.vx = -o.vx; } break;
        case 'desce': case 'sobe': {
          var s = (a.faz === 'desce' ? 1 : -1) * T * clamp(a.blocos || 0.5, 0.25, 4);
          if (jogo.cartaMover && jogo.cartaDegrau) { jogo.cartaDegrau(o, s); } else { o.y += s; }
          break;
        }
        case 'volta': o.x = cv.ux; o.y = cv.uy; cv.dx = -cv.dx; cv.dy = -cv.dy; if (cv.modo === 'persegue') { cv.modo = 'anda'; } break;
        case 'pula': if (jogo.cartaPula) { jogo.cartaPula(o, clamp(a.forca || 1, 0.3, 2)); } else { o.pulinho = 16; } break;
        case 'voa': cv.voa = a.sim !== false; break;
        case 'atira': atirar(jogo, o, a); break;
        case 'persegue': cv.modo = 'persegue'; break;
        case 'foge': cv.modo = 'foge'; break;
        case 'dano': if (jogo.cartaDano) { jogo.cartaDano(o); } else { jogo.ferir('cartas'); } break;
        case 'explode': explodir(jogo, o); break;
        case 'gigante': escala(jogo, o, clamp(a.vezes || 2, 1.5, 3)); break;
        case 'normal': escala(jogo, o, 1); cv.mult = 1; break;
        case 'rapido': cv.mult = clamp(a.vezes || 2, 1, 4); break;
        case 'devagar': cv.mult = 1 / clamp(a.vezes || 2, 1, 4); break;
        case 'som': jogo.som.efeito(String(a.nome || 'pulo')); break;
        case 'toca_musica': if (jogo.som.tocando !== a.nome) { jogo.som.musica(String(a.nome || '')); } break;
        case 'volta_musica': if (jogo.som.tocando !== jogo.som.fundo) { jogo.som.musica(jogo.som.fundo); } break;
        case 'muda': {
          var nome = String(a.nome || 'contador').slice(0, 30);
          if (a.vale != null) { n = typeof a.vale === 'number' ? a.vale : String(a.vale).slice(0, 40); }
          else { n = (+valorDe(o, nome) || 0) + (a.mais == null ? 1 : +a.mais || 0); }
          if (nome === 'vida') { o.vida = clamp(+n || 0, 0, 99); } else { o.mem[nome] = n; }
          break;
        }
        case 'codigo': codigo(jogo, o, a.codigo); break;
      }
    }
    // o herói encostou / acertou: devolve true se as cartas cuidaram (o gênero não faz o jeito antigo)
    function encostou(jogo, o) { evento(jogo, o, 'heroi', {}); return true; }
    function atingido(jogo, o, como) {
      if (!tem(o)) { return false; }
      prep(jogo, o);
      if (o.cvFerido > 0) { return true; }
      var tinha = evento(jogo, o, 'atingido', { como: como || '' });
      if (!tinha) { return false; }
      o.cvFerido = 20;
      if (o.vivo && o.vida <= 0) { explodir(jogo, o); }
      return true;
    }
    function quadroDoObj(o) { if (o.cvFerido > 0) { o.cvFerido--; } if (o.pulinho > 0) { o.pulinho--; } }
    function pulinhoY(o) { return o.pulinho > 0 ? -Math.round(Math.sin(o.pulinho / 16 * Math.PI) * 4) : 0; }

    // ── as cartas da casa: o jeito de hoje de cada gênero, escrito em cartas (para ver e para começar a mexer) ──
    function regrasCasa(spec, letra) {
      var e = ((spec && spec.entidades) || {})[letra] || {}, g = spec && spec.arquetipo, c = e.comportamento || '';
      var P = {}; (e.pecas || []).forEach(function (p) { P[p] = 1; }); (PECAS_LEGADO[c] || []).forEach(function (p) { P[p] = 1; });
      var R = [], dano = { quando: 'heroi', faz: [{ faz: 'dano' }] };
      if (e.tipo && e.tipo !== 'inimigo') { return []; }
      if (g === 'plataforma') {
        if (P.voa) { R.push({ quando: 'sempre', faz: [{ faz: 'voa' }, { faz: 'anda', dir: 'vaivem' }] }); }
        else if (P.segue) { R.push({ quando: 'sempre', se: [{ teste: 'heroi_perto', distancia: 12 }], faz: [{ faz: 'persegue' }], senao: [{ faz: 'anda' }] }); }
        else if (P.foge) { R.push({ quando: 'sempre', se: [{ teste: 'heroi_perto', distancia: 12 }], faz: [{ faz: 'foge' }], senao: [{ faz: 'anda' }] }); }
        else if (P.anda || c === 'patrulha' || c === 'pula' || !c) { R.push({ quando: 'sempre', faz: [{ faz: 'anda' }] }); }
        if (!P.voa) { R.push({ quando: 'parede', faz: [{ faz: 'vira' }] }); if (!e.cai) { R.push({ quando: 'beirada', faz: [{ faz: 'vira' }] }); } }
        if (P.pula || c === 'pula') { R.push({ quando: 'a_cada', segundos: Math.round(clamp(e.cadencia_pulo || 90, 20, 600) / 6) / 10, faz: [{ faz: 'pula' }] }); }
        if (P.atira) { R.push({ quando: 'a_cada', segundos: Math.round(clamp(e.cadencia || 120, 20, 900) / 6) / 10, se: [{ teste: 'heroi_perto', distancia: 12 }], faz: [{ faz: 'atira', dir: e.mira || P.voa ? 'heroi' : 'lado' }] }); }
        R.push(dano);
        return R;
      }
      if (g === 'tiro_fixo') {
        return [{ quando: 'sempre', faz: [{ faz: 'anda' }] },
                { quando: 'borda', faz: [{ faz: 'desce' }, { faz: 'vira' }] },
                { quando: 'sempre', se: [{ teste: 'poucos_inimigos', quantos: 5 }], faz: [{ faz: 'rapido' }] },
                { quando: 'a_cada', segundos: 2, se: [{ teste: 'sorte', chance: 6 }], faz: [{ faz: 'atira', dir: 'baixo' }] }];
      }
      if (g === 'nave' || g === 'corrida') {
        if (c === 'persegue') { R.push({ quando: 'sempre', faz: [{ faz: 'persegue' }] }); }
        else if (c === 'voa_seno') { R.push({ quando: 'sempre', faz: [{ faz: 'anda', dir: 'vaivem' }] }); }
        else if (c === 'patrulha' || c === 'faixa') { R.push({ quando: 'sempre', faz: [{ faz: 'anda' }] }, { quando: 'borda', faz: [{ faz: 'vira' }] }, { quando: 'parede', faz: [{ faz: 'vira' }] }); }
        else if (c === 'acorda') { R.push({ quando: 'perto', distancia: 7, faz: [{ faz: 'anda' }] }, { quando: 'borda', faz: [{ faz: 'vira' }] }, { quando: 'parede', faz: [{ faz: 'vira' }] }); }   // 🏞 o mesmo do motor2.py
        else if (c === 'cruza') { R.push({ quando: 'sempre', faz: [{ faz: 'voa' }, { faz: 'anda' }, { faz: 'rapido' }] }); }
        if (g === 'nave' && (e.atira || c === 'atira')) { R.push({ quando: 'a_cada', segundos: 1.7, faz: [{ faz: 'atira', dir: 'heroi' }] }); }
        R.push(dano);
        return R;
      }
      if (g === 'labirinto') {
        if (c === 'parado') { return [dano]; }
        if (c === 'persegue') { R.push({ quando: 'sempre', se: [{ teste: 'heroi_grande' }], faz: [{ faz: 'foge' }], senao: [{ faz: 'persegue' }] }); }
        else { R.push({ quando: 'sempre', se: [{ teste: 'heroi_grande' }], faz: [{ faz: 'foge' }], senao: [{ faz: 'anda', dir: 'sorteio' }] }); }
        R.push(dano);
        return R;
      }
      if (g === 'travessia') { return [{ quando: 'sempre', faz: [{ faz: 'anda' }] }, dano]; }
      if (g === 'aventura') {
        if (c === 'parado') { return [dano]; }
        if (c === 'persegue') { R.push({ quando: 'sempre', se: [{ teste: 'heroi_perto', distancia: 6 }], faz: [{ faz: 'persegue' }], senao: [{ faz: 'anda', dir: 'sorteio' }] }); }
        else { R.push({ quando: 'sempre', faz: [{ faz: 'anda', dir: 'sorteio' }] }); }
        R.push(dano);
        return R;
      }
      if (g === 'briga_de_rua') {
        if (c !== 'parado') { R.push({ quando: 'sempre', faz: [{ faz: 'persegue' }] }); }
        R.push(dano);
        return R;
      }
      return [];
    }
    var GENEROS_COM_CARTAS = { plataforma: 1, tiro_fixo: 1, nave: 1, corrida: 1, labirinto: 1, travessia: 1, aventura: 1, briga_de_rua: 1 };
    return { QUANDO: QUANDO, SE: SE, FAZ: FAZ, tem: tem, moverLivre: moverLivre, prep: prep, passo: passo, evento: evento, encostou: encostou, atingido: atingido,
             fimDoQuadro: fimDoQuadro, tirosBase: tirosBase, naZona: naZona, quadroDoObj: quadroDoObj, pulinhoY: pulinhoY, regrasCasa: regrasCasa,
             fazer: fazer, generos: GENEROS_COM_CARTAS };
  })();

  // 🏗 rastro da última jogada (Estúdio de Fases): onde o herói andou e onde caiu
  function gravarRastro(jogo) {
    var h = jogo.heroi; if (!h || (jogo.quadro % 3)) { return; }
    var r = jogo.rastro || (jogo.rastro = []);
    if (r.length < 6000) { r.push([Math.round(h.x + h.w / 2), Math.round(h.y + h.h), jogo.faseIdx]); }
  }
  function marcarQueda(jogo) {
    var h = jogo.heroi, r = jogo.rastro || (jogo.rastro = []);
    if (h && r.length < 6000) { r.push([Math.round(h.x + h.w / 2), Math.round(h.y + h.h), jogo.faseIdx, 1]); }
  }

  // ───────────────────────── o jogo de plataforma ─────────────────────────
  // Motor 0.9 (25/10/2026, "motor 2"): três camadas de personalização, todas OPCIONAIS — um jogo antigo,
  // sem elas, roda exatamente como antes (mesmo replay do placar):
  //   1. PEÇAS  — entidades montadas por peças combináveis (anda, pula, voa, segue, foge, atira, casco, espinho,
  //               chefe, gigante, fantasma, plataforma) + blocos surpresa, quebráveis, mortais e canos;
  //               herói que cresce (sprite_grande), estrela, animação por estado; fundo em camadas (parallax).
  //   2. REGRAS — "quando ISTO acontecer, faça AQUILO" (spec.regras).
  //   3. MÁGICO — a ação {acao:'codigo'} roda um trecho de mini-JavaScript da casa (Magico, acima).
  var PECAS = { anda: 1, pula: 1, voa: 1, segue: 1, foge: 1, atira: 1, casco: 1, espinho: 1, chefe: 1, gigante: 1, fantasma: 1, plataforma: 1 };
  var PECAS_LEGADO = { patrulha: ['anda'], pula: ['anda', 'pula'], voa_seno: ['voa'] };
  function Plataforma(spec, perfil, sprites, som, semente) {
    this.spec = spec; this.perfil = perfil; this.sprites = sprites; this.som = som;
    this.T = perfil.tile; this.W = perfil.w; this.H = perfil.h;
    this.semente = semente || 1; this.rng = mulberry32(this.semente);
    this.rngFx = mulberry32(99);   // efeitos visuais têm o próprio sorteio (não mexem no replay)
    var fis = spec.fisica || {}, her = spec.heroi || {};
    var esc = this.T / 8;
    this.esc = esc;
    this.g = clamp(fis.gravidade == null ? 0.9 : fis.gravidade, 0.3, 2) * 0.35 * esc;
    this.vmax = 6 * esc;
    this.correr = clamp(her.velocidade == null ? 1 : her.velocidade, 0.4, 3) * 1.6 * esc;
    var alt = clamp((her.pulo && her.pulo.altura) || 3.5, 1, 6) * this.T;
    this.vpulo = Math.sqrt(2 * this.g * alt);
    this.duplo = !!(her.pulo && her.pulo.duplo);
    this.base = { g: this.g, correr: this.correr, vpulo: this.vpulo, duplo: this.duplo };
    this.vidasIniciais = clamp(her.vidas || 3, 1, 9);
    this.estado = 'titulo';
    this.faseIdx = 0; this.pontos = 0; this.vidas = this.vidasIniciais; this.moedas = 0;
    this.quadro = 0; this.aviso = null;
    this.regras = Array.isArray(spec.regras) ? spec.regras : [];
    this.fx = []; this.msgs = []; this.tiros = []; this.bumps = []; this.tremor = 0;
  }

  Plataforma.prototype.novaPartida = function () {
    this.g = this.base.g; this.correr = this.base.correr; this.vpulo = this.base.vpulo; this.duplo = this.base.duplo;
    this.moedas = 0; this.grandeGuardado = false; this.regrasFeitas = {}; this.memoria = Magico.objeto({});
    this.erroMagico = null;
  };

  Plataforma.prototype.tamanhoHeroi = function (grande) {
    var her = this.spec.heroi || {}, T = this.T;
    var s = this.sprites[grande && her.sprite_grande ? her.sprite_grande : her.sprite] || { w: T, h: T };
    if (grande && !her.sprite_grande) { return { w: s.w, h: Math.round(s.h * 1.5) }; }
    return { w: s.w, h: s.h };
  };

  Plataforma.prototype.criarObjeto = function (ch, x, y) {   // x = centro, y = base (px)
    var e = (this.spec.entidades || {})[ch], T = this.T;
    if (!e) { return null; }
    var sp = this.sprites[e.sprite] || { w: T, h: T };
    var o = { tipo: e.tipo, def: e, ch: ch, w: sp.w, h: sp.h, vy: 0, vivo: true, t: 0, esc: 1 };
    if (Array.isArray(e.pecas) && e.pecas.length) {
      o.pecas = {}; e.pecas.forEach(function (p) { if (PECAS[p]) { o.pecas[p] = true; } });
      if (o.pecas.gigante) { o.esc = 2; o.w = sp.w * 2; o.h = sp.h * 2; }
      o.vidaMax = o.vida = clamp(e.vida || (o.pecas.chefe ? 5 : 1), 1, 50);
      o.esfria = 60;
    }
    o.x = x - o.w / 2; o.y = y - o.h; o.x0 = o.x; o.y0 = o.y;
    var vel = clamp(e.velocidade || 0.6, 0.1, 3) * (T / 8);
    o.vx = (e.tipo === 'inimigo' || (o.pecas && (o.pecas.anda || o.pecas.plataforma))) ? -vel : 0;
    if (o.pecas && o.pecas.plataforma && e.vertical) { o.vx = 0; o.vyp = -vel; }
    return o;
  };

  Plataforma.prototype.carregarFase = function (idx) {
    var f = this.spec.fases[idx], T = this.T, ents = this.spec.entidades || {}, tiles = this.spec.tiles || {};
    if (!this.memoria) { this.novaPartida(); }
    this.fase = f;
    this.mapa = f.mapa.map(function (r) { return r.split(''); });
    this.linhas = this.mapa.length;
    this.colunas = Math.max.apply(null, this.mapa.map(function (r) { return r.length; }));
    this.larg = this.colunas * T; this.alt = this.linhas * T;
    this.objs = [];
    this.inicio = { x: 0, y: 0 };
    this.usados = {};
    for (var j = 0; j < this.linhas; j++) {
      for (var i = 0; i < this.mapa[j].length; i++) {
        var ch = this.mapa[j][i];
        if (ch === '@') { this.inicio = { x: i * T, y: j * T }; this.mapa[j][i] = '.'; continue; }
        var e = ents[ch];
        if (e) {
          var o;
          if (Array.isArray(e.pecas) && e.pecas.length) {
            o = this.criarObjeto(ch, i * T + T / 2, (j + 1) * T);
            o.t = Math.floor(this.rng() * 60);
          } else {
            var sp = this.sprites[e.sprite] || { w: T, h: T };
            o = { tipo: e.tipo, def: e, ch: ch, x: i * T + (T - sp.w) / 2, y: (j + 1) * T - sp.h,
                  w: sp.w, h: sp.h, vx: (e.tipo === 'inimigo' ? -clamp(e.velocidade || 0.6, 0.1, 3) * (T / 8) : 0),
                  vy: 0, x0: i * T, y0: (j + 1) * T - sp.h, vivo: true, t: Math.floor(this.rng() * 60) };
          }
          this.objs.push(o);
          this.mapa[j][i] = '.';
        } else if (!tiles[ch]) {
          this.mapa[j][i] = '.';
        }
      }
    }
    var grande = !!this.grandeGuardado;
    var hs = this.tamanhoHeroi(grande);
    this.heroi = { x: this.inicio.x + (T - hs.w) / 2, y: this.inicio.y + T - hs.h, w: hs.w, h: hs.h, vx: 0, vy: 0,
                   chao: false, coyote: 0, buffer: 0, pulosAr: 0, olhando: 1, invuln: 0, poder: null, morto: 0,
                   grande: grande, estrela: 0 };
    this.cam = { x: 0, y: Math.max(0, this.alt - this.H) };
    this.tFase = 0; this.colMax = 0; this.tocando = {}; this.tiros = []; this.fx = []; this.bumps = []; this.msgs = [];
    this.contAntes = { pontos: this.pontos, moedas: this.moedas }; this.zonaH = {};
    if (this.som.definirPele) { this.som.definirPele(f.estilo || this.spec.estilo || 'pixel'); }
    this.som.fundo = f.musica;
    this.som.musica(f.musica);
    this.disparar('comecou_fase', { fase: idx + 1 });
  };

  Plataforma.prototype.tile = function (ci, cj) {
    if (cj < 0 || ci < 0 || ci >= this.colunas) { return ci < 0 || ci >= this.colunas ? { solido: true } : null; }
    if (cj >= this.linhas) { return null; }
    var ch = (this.mapa[cj] || [])[ci];
    return (this.spec.tiles || {})[ch] || null;
  };

  Plataforma.prototype.moverCorpo = function (c, permitePlataforma) {
    var T = this.T, i, j, t;
    c.vy = Math.min(c.vy + this.g, this.vmax);
    // eixo X
    c.x += c.vx;
    var j0 = Math.floor(c.y / T), j1 = Math.floor((c.y + c.h - 1) / T), bateuX = false;
    if (c.vx > 0) {
      i = Math.floor((c.x + c.w - 1) / T);
      for (j = j0; j <= j1; j++) { t = this.tile(i, j); if (t && t.solido && !t.plataforma) { c.x = i * T - c.w; bateuX = true; break; } }
    } else if (c.vx < 0) {
      i = Math.floor(c.x / T);
      for (j = j0; j <= j1; j++) { t = this.tile(i, j); if (t && t.solido && !t.plataforma) { c.x = (i + 1) * T; bateuX = true; break; } }
    }
    // eixo Y
    var antesBase = c.y + c.h;
    c.y += c.vy;
    var i0 = Math.floor(c.x / T), i1 = Math.floor((c.x + c.w - 1) / T);
    c.chao = false; c.teto = null;
    if (c.vy > 0) {
      j = Math.floor((c.y + c.h - 0.01) / T);   // 0.4.0: pousa já na 1ª fração de pixel (antes o herói "piscava" fora do chão)
      for (i = i0; i <= i1; i++) {
        t = this.tile(i, j);
        if (t && t.solido && (!t.plataforma || (permitePlataforma && antesBase <= j * T + 0.01))) {
          c.y = j * T - c.h; c.vy = 0; c.chao = true; break;
        }
      }
    } else if (c.vy < 0) {
      j = Math.floor(c.y / T);
      for (i = i0; i <= i1; i++) {
        t = this.tile(i, j);
        if (t && t.solido && !t.plataforma) {
          // 0.9: guarda QUAL bloco a cabeça bateu (o mais embaixo do centro) — bloco surpresa / quebrável
          var meio = Math.floor((c.x + c.w / 2) / T), alvo = i, tm = this.tile(meio, j);
          if (tm && tm.solido && !tm.plataforma) { alvo = meio; }
          c.teto = { i: alvo, j: j };
          c.y = (j + 1) * T; c.vy = 0; break;
        }
      }
    }
    return bateuX;
  };

  // 🃏 como as cartas mexem um personagem da plataforma (gravidade, parede, beirada, pulo, voo)
  Plataforma.prototype.cartaDirInicial = function (o) { return [o.vx > 0 ? 1 : -1, 0]; };
  Plataforma.prototype.cartaVel = function (o) { return clamp(o.def.velocidade || 0.6, 0.1, 3) * (this.T / 8); };
  Plataforma.prototype.cartaMover = function (o, dx, dy, v) {
    var cv = o.cv, T = this.T, res = {};
    if (cv.voa) {
      o.x += dx; o.y += dy;
      if (cv.modo !== 'persegue' && cv.modo !== 'foge' && !dy) { o.y += Math.cos(o.t / 20) * T / 20; }
      if (o.x < 0) { o.x = 0; res.borda = true; } else if (o.x + o.w > this.larg) { o.x = this.larg - o.w; res.borda = true; }
      if (o.y < 0) { o.y = 0; } else if (o.y + o.h > this.alt) { o.y = this.alt - o.h; }
      o.vx = dx || cv.dx * 0.001; o.vy = 0;
      return res;
    }
    if (cv.modo === 'para') { o.vx = cv.dx * 0.001; }
    else if (cv.modo === 'persegue' || cv.modo === 'foge') { o.vx = Math.abs(dx) > 0.01 ? (dx > 0 ? v : -v) : 0; }
    else { o.vx = dx; }
    if (this.moverCorpo(o, true)) { res.parede = true; }
    if (o.chao && Math.abs(o.vx) > 0.01) {
      var frente = o.vx > 0 ? Math.floor((o.x + o.w) / T) : Math.floor((o.x - 1) / T);
      var baixo = this.tile(frente, Math.floor((o.y + o.h + 1) / T));
      if (!baixo || !baixo.solido || baixo.mortal) { res.beirada = true; }
    }
    return res;
  };
  Plataforma.prototype.cartaDegrau = function (o, s) { o.y += s; };
  Plataforma.prototype.cartaPula = function (o, forca) { if (o.chao || o.cv.voa) { o.vy = -this.vpulo * 0.8 * forca; if (o.cv.voa) { o.y -= this.T; } } };
  Plataforma.prototype.cartaTiro = function (o, vx, vy) {
    if (this.tiros.length > 40) { return; }
    var e = o.def, tdef = e.tiro && (this.spec.entidades || {})[e.tiro], ts = tdef && this.sprites[tdef.sprite];
    var tw = ts ? ts.w : Math.max(2, 3 * this.esc), th = ts ? ts.h : Math.max(2, 3 * this.esc);
    this.tiros.push({ x: o.x + o.w / 2 - tw / 2, y: o.y + o.h * 0.4 - th / 2, w: tw, h: th, vida: 300, vx: vx, vy: vy,
                      sprite: tdef ? tdef.sprite : null, cor: e.cor_tiro || '#FCFCFC', t: 0 });
    this.som.efeito('tiro');
  };
  Plataforma.prototype.cartaDano = function (o) { var h = this.heroi; if (!h.invuln && !h.estrela && !h.morto) { this.ultimoDano = 'cartas:' + o.ch; this.ferir(); } };
  Plataforma.prototype.cartaExplode = function (o) { if (o.vivo) { this.derrotar(o, 'cartas'); } };
  Plataforma.prototype.olharZonas = function () {   // 🟦 zonas pintadas: "QUANDO o herói entra na zona azul"
    var zs = this.fase && this.fase.zonas, h = this.heroi;
    if (!zs || !this.regras.length) { return; }
    var cx = h.x + h.w / 2, cy = h.y + h.h / 2, self = this;
    Object.keys(zs).forEach(function (cor) {
      var d = Cartas.naZona(self, cx, cy, cor), antes = !!self.zonaH[cor];
      self.zonaH[cor] = d;
      if (d && !antes) { self.disparar('zona', { zona: cor }); } else if (!d && antes) { self.disparar('saiu_zona', { zona: cor }); }
    });
  };

  // ── camada 2 · REGRAS ──
  var EVENTOS = { comecou_fase: 1, pegou: 1, derrotou: 1, tocou: 1, bateu_bloco: 1, vida_do: 1, moedas: 1, pontos: 1, tempo: 1, chegou: 1, perdeu_vida: 1, apertou: 1,
                 zona: 1, saiu_zona: 1 };   // 0.9.6: zonas pintadas no Estúdio de Fases
  Plataforma.prototype.regraCasa = function (q, ev, d) {
    if (q.item && q.item !== d.item) { return false; }
    if (q.inimigo && q.inimigo !== d.inimigo) { return false; }
    if (q.bloco && q.bloco !== d.bloco) { return false; }
    if (q.botao && q.botao !== d.botao) { return false; }
    if (q.zona && q.zona !== d.zona) { return false; }
    if (ev === 'moedas' || ev === 'pontos') {
      if (q.chega != null) { return d.antes < q.chega && d.agora >= q.chega; }
      if (q.a_cada) { return Math.floor(d.agora / q.a_cada) > Math.floor(d.antes / q.a_cada); }
      return false;
    }
    if (ev === 'vida_do') { var ab = q.abaixo == null ? 50 : q.abaixo; return d.antes > ab && d.agora <= ab; }
    return true;
  };
  Plataforma.prototype.disparar = function (ev, dados) {
    var rs = this.regras;
    if (!rs.length || !EVENTOS[ev]) { return; }
    if ((this.profRegra || 0) > 4) { return; }   // regra que dispara regra que dispara regra… para aqui
    this.profRegra = (this.profRegra || 0) + 1;
    try {
      for (var k = 0; k < rs.length; k++) {
        var r = rs[k], q = r && r.quando;
        if (!q || q.evento !== ev) { continue; }
        if (r.fase && r.fase !== this.faseIdx + 1) { continue; }
        if (!this.regraCasa(q, ev, dados || {})) { continue; }
        if (r.uma_vez) { if (this.regrasFeitas[k]) { continue; } this.regrasFeitas[k] = 1; }
        var acoes = Array.isArray(r.entao) ? r.entao : (r.entao ? [r.entao] : []);
        for (var a = 0; a < acoes.length && a < 20; a++) { this.fazer(acoes[a], dados || {}); }
      }
    } finally { this.profRegra--; }
  };
  Plataforma.prototype.mensagem = function (txt, seg) {
    this.msgs = [{ texto: String(txt == null ? '' : txt).slice(0, 120), ate: this.quadro + Math.round(clamp(seg || 3, 0.5, 15) * 60) }];
  };
  Plataforma.prototype.soltar = function (ch, x, y, deBloco) {
    var o = this.criarObjeto(ch, x, y);
    if (!o) { return null; }
    if (this.objs.length > 300) { return null; }
    if (deBloco && o.tipo === 'coletavel') {      // moeda que sai do bloco: pula e já conta (como nas máquinas)
      this.pegar(o, true);
      this.fx.push({ sprite: o.def.sprite, x: o.x, y: o.y - this.T, vy: -3 * this.esc, g: 0.25 * this.esc, vida: 26 });
      return o;
    }
    if (deBloco) { o.sobe = o.h; o.y += o.h; if (o.vx) { o.vx = Math.abs(o.vx); } }   // sai de dentro do bloco e anda para a direita
    this.objs.push(o);
    return o;
  };
  Plataforma.prototype.crescer = function (sim) {
    var h = this.heroi; if (!h || h.grande === sim) { return; }
    var s = this.tamanhoHeroi(sim), base = h.y + h.h, meio = h.x + h.w / 2;
    h.grande = sim; h.w = s.w; h.h = s.h; h.x = meio - s.w / 2; h.y = base - s.h;
    this.som.efeito(sim ? 'cresce' : 'encolhe');
  };
  Plataforma.prototype.estrela = function (seg) {
    var h = this.heroi; if (!h) { return; }
    h.estrela = Math.round(clamp(seg || 10, 1, 60) * 60);
    this.som.efeito('estrela'); this.som.musica('biblioteca:estrela');
  };
  Plataforma.prototype.trocarBloco = function (i, j, para) {
    if (j < 0 || j >= this.linhas || i < 0 || i >= this.colunas) { return; }
    para = String(para || '.').charAt(0);
    if (para !== '.' && !(this.spec.tiles || {})[para]) { para = '.'; }
    this.mapa[j][i] = para;
  };
  Plataforma.prototype.terminarFase = function () {
    if (this.estado !== 'jogando') { return; }
    this.estado = 'fase_ok'; this.espera = 120; this.som.parar(); this.som.efeito('fim');
    this.grandeGuardado = !!(this.heroi && this.heroi.grande);
    if (this.evento) { this.evento('terminou_fase', { fase: this.faseIdx + 1 }); }
  };
  Plataforma.prototype.teleporte = function (col, lin, fase) {
    var T = this.T, h = this.heroi;
    if (fase && fase - 1 !== this.faseIdx && fase >= 1 && fase <= this.spec.fases.length) {
      this.grandeGuardado = !!h.grande; this.faseIdx = fase - 1; this.carregarFase(this.faseIdx); h = this.heroi;
    }
    if (col) { h.x = (clamp(col, 1, this.colunas) - 1) * T + (T - h.w) / 2; }
    if (lin) { h.y = clamp(lin, 1, this.linhas) * T - h.h; }
    h.vx = 0; h.vy = 0;
    this.cam.x = clamp(h.x - this.W / 2, 0, Math.max(0, this.larg - this.W));
    this.cam.y = clamp(h.y - this.H / 2, 0, Math.max(0, this.alt - this.H));
    this.som.efeito('teleporte');
  };
  Plataforma.prototype.fazer = function (a, d) {
    if (!a || typeof a !== 'object') { return; }
    var h = this.heroi, T = this.T, n;
    switch (a.acao) {
      case 'crescer': this.crescer(true); break;
      case 'encolher': this.crescer(false); break;
      case 'invencivel': this.estrela(a.segundos || 10); break;
      case 'vidas': this.vidas = clamp(this.vidas + (a.mais == null ? 1 : a.mais), 0, 99); if (a.mais !== -1) { this.som.efeito('vida'); } break;
      case 'pontos': this.pontos = Math.max(0, this.pontos + (a.mais || 0)); break;
      case 'moedas': this.moedas = Math.max(0, this.moedas + (a.mais || 0)); break;
      case 'soltar': {
        n = clamp(a.quantos || 1, 1, 10);
        for (var k = 0; k < n; k++) {
          var x, y;
          if (a.coluna) { x = (a.coluna - 1) * T + T / 2; y = (a.linha || 1) * T; }
          else if (a.onde === 'heroi' || d.x == null) { x = h.x + h.w / 2 + (k - (n - 1) / 2) * T; y = h.y - T; }
          else { x = d.x + (k - (n - 1) / 2) * T; y = d.y; }
          var o = this.soltar(a.item, x, y, false);
          if (o && o.tipo === 'inimigo' && o.vx) { o.vx = (k % 2 ? 1 : -1) * Math.abs(o.vx); }
        }
        break;
      }
      case 'musica': this.som.musica(a.nome || this.fase.musica); break;
      case 'volta_musica': this.som.musica(this.som.fundo || this.fase.musica); break;   // 🎵 volta a música de fundo
      case 'som': this.som.efeito(a.nome); break;
      case 'mensagem': this.mensagem(a.texto, a.segundos); break;
      case 'teleporte': this.teleporte(a.coluna, a.linha, a.fase); break;
      case 'trocar_bloco': {
        if (a.coluna) { this.trocarBloco(a.coluna - 1, (a.linha || 1) - 1, a.para); break; }
        for (var j = 0; j < this.linhas; j++) { for (var i = 0; i < this.colunas; i++) { if (this.mapa[j][i] === a.de) { this.trocarBloco(i, j, a.para); } } }
        break;
      }
      case 'velocidade': this.correr = this.base.correr * clamp(a.vezes == null ? 1 : a.vezes, 0.3, 3); break;
      case 'pulo': this.vpulo = this.base.vpulo * Math.sqrt(clamp(a.vezes == null ? 1 : a.vezes, 0.3, 3)); break;
      case 'gravidade': this.g = this.base.g * clamp(a.vezes == null ? 1 : a.vezes, 0.2, 3); this.vpulo = Math.sqrt(2 * this.g * (this.base.vpulo * this.base.vpulo / (2 * this.base.g))); break;
      case 'pulo_duplo': this.duplo = a.sim !== false; break;
      case 'terminar_fase': this.terminarFase(); break;
      case 'tremer': this.tremor = Math.round(clamp(a.segundos || 0.5, 0.1, 3) * 60); break;
      case 'codigo': this.magico(a.codigo, d); break;
    }
  };

  // ── camada 3 · MODO MÁGICO: a API `jogo` que o código vê ──
  Plataforma.prototype.apiMagica = function () {
    if (this._api) { return this._api; }
    var self = this, T = this.T;
    function num(v, a, b, pad) { v = +v; if (isNaN(v)) { v = pad; } return clamp(v, a, b); }
    this._api = new Magico.Hospede({
      heroi: function () { var h = self.heroi; return Magico.objeto({ coluna: Math.floor((h.x + h.w / 2) / T) + 1, linha: Math.floor((h.y + h.h - 1) / T) + 1, grande: !!h.grande, invencivel: h.estrela > 0, no_chao: !!h.chao, olhando: h.olhando }); },
      pontos: function (n) { if (n) { self.pontos = Math.max(0, self.pontos + num(n, -1e6, 1e6, 0)); } return self.pontos; },
      vidas: function (n) { if (n) { self.vidas = clamp(self.vidas + num(n, -9, 9, 0), 0, 99); } return self.vidas; },
      moedas: function (n) { if (n) { self.moedas = Math.max(0, self.moedas + num(n, -1e6, 1e6, 0)); } return self.moedas; },
      fase: function () { return self.faseIdx + 1; },
      tempo: function () { return Math.floor(self.tFase / 60); },
      soltar: function (letra, col, lin) { var a = { acao: 'soltar', item: String(letra || '') }; if (col) { a.coluna = num(col, 1, 999, 1); a.linha = num(lin, 1, 99, 1); } self.fazer(a, {}); },
      mensagem: function (t, s) { self.mensagem(t, s); },
      som: function (n) { self.som.efeito(String(n || '')); },
      musica: function (n) { self.som.musica(String(n || '')); },
      crescer: function () { self.crescer(true); },
      encolher: function () { self.crescer(false); },
      invencivel: function (s) { self.estrela(num(s, 1, 60, 10)); },
      teleporte: function (c, l) { self.teleporte(num(c, 1, 999, 1), num(l, 1, 99, 1)); },
      bloco: function (c, l) { var r = (self.mapa[num(l, 1, 999, 1) - 1] || [])[num(c, 1, 999, 1) - 1]; return r || '.'; },
      trocarBloco: function (c, l, letra) { self.trocarBloco(num(c, 1, 999, 1) - 1, num(l, 1, 999, 1) - 1, letra); },
      contar: function (letra) { var n = 0; self.objs.forEach(function (o) { if (o.vivo && o.ch === letra) { n++; } }); return n; },
      inimigos: function () { return self.objs.filter(function (o) { return o.vivo && o.tipo === 'inimigo'; }).slice(0, 100).map(function (o) { return Magico.objeto({ letra: o.ch, coluna: Math.floor((o.x + o.w / 2) / T) + 1, linha: Math.floor((o.y + o.h - 1) / T) + 1, vida: o.vida || 1 }); }); },
      terminarFase: function () { self.terminarFase(); },
      tremer: function (s) { self.fazer({ acao: 'tremer', segundos: s }, {}); },
      velocidade: function (v) { self.fazer({ acao: 'velocidade', vezes: v }, {}); },
      pulo: function (v) { self.fazer({ acao: 'pulo', vezes: v }, {}); },
      gravidade: function (v) { self.fazer({ acao: 'gravidade', vezes: v }, {}); },
      aleatorio: function (a, b) { a = Math.floor(num(a, -1e6, 1e6, 0)); b = Math.floor(num(b, -1e6, 1e6, 1)); return a + Math.floor(self.rng() * (b - a + 1)); }
    });
    this._math = new Magico.Hospede({ floor: Math.floor, ceil: Math.ceil, round: Math.round, abs: Math.abs, min: Math.min, max: Math.max,
      sqrt: Math.sqrt, sin: Math.sin, cos: Math.cos, PI: Math.PI, random: function () { return self.rng(); } });
    return this._api;
  };
  Plataforma.prototype.magico = function (codigo, d) {
    try {
      var ast = Magico.compilar(codigo);
      var ev = Magico.objeto({});
      Object.keys(d || {}).forEach(function (k) { var v = d[k]; if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') { ev[k] = v; } });
      if (d && d.x != null && ev.coluna == null) { ev.coluna = Math.floor(d.x / this.T) + 1; ev.linha = Math.ceil(d.y / this.T); }
      Magico.executar(ast, { jogo: this.apiMagica(), evento: ev, memoria: this.memoria, Math: this._math }, 50000);
    } catch (e) {
      var msg = e && e.magico ? e.message : 'erro no código mágico: ' + (e && e.message ? e.message : e);
      this.erroMagico = { texto: msg, ate: this.quadro + 360 };
      try { console.warn('[Fliperama · código mágico]', msg); } catch (e2) { /* nada */ }
    }
  };

  // ── camada 1 · PEÇAS: o que as peças de uma entidade fazem a cada quadro ──
  Plataforma.prototype.moverPecas = function (o, h) {
    var P = o.pecas, T = this.T, e = o.def, vel = clamp(e.velocidade || 0.6, 0.1, 3) * (T / 8);
    var dx = (h.x + h.w / 2) - (o.x + o.w / 2), dy = (h.y + h.h / 2) - (o.y + o.h / 2), perto = Math.abs(dx) < this.W * 0.75;
    if (o.sobe > 0) { var p = Math.min(o.sobe, 0.5 * this.esc); o.y -= p; o.sobe -= p; return; }   // saindo do bloco
    if (o.casco === 'parado') { o.vx = 0; this.moverCorpo(o, true); if (++o.tCasco > 420) { o.casco = null; o.vx = (dx > 0 ? 1 : -1) * vel; } return; }
    if (o.casco === 'chutado') { if (this.moverCorpo(o, true)) { o.vx = -o.vx; this.som.efeito('casco'); } return; }
    if (P.plataforma) {
      var raio = clamp(e.raio || 3, 1, 12) * T, x1 = o.x, y1 = o.y;
      if (e.vertical) { o.y += o.vyp; if (Math.abs(o.y - o.y0) > raio) { o.vyp = -o.vyp; o.y = o.y0 + (o.y > o.y0 ? raio : -raio); } }
      else { o.x += o.vx; if (Math.abs(o.x - o.x0) > raio) { o.vx = -o.vx; o.x = o.x0 + (o.x > o.x0 ? raio : -raio); } }
      o.dx = o.x - x1; o.dy = o.y - y1;
      return;
    }
    if (P.fantasma) {   // só se mexe quando o herói está de costas para ele
      var deCostas = (dx > 0 && h.olhando > 0) || (dx < 0 && h.olhando < 0);
      if (perto && deCostas) { var d = Math.sqrt(dx * dx + dy * dy) || 1; o.x += dx / d * vel * 0.7; o.y += dy / d * vel * 0.7; o.vx = dx > 0 ? 0.01 : -0.01; }
      return;
    }
    if (P.voa) {
      if ((P.segue || P.foge) && perto) {
        var s = P.foge ? -1 : 1, d2 = Math.sqrt(dx * dx + dy * dy) || 1;
        o.x += s * dx / d2 * vel; o.y += s * dy / d2 * vel; o.vx = s * dx > 0 ? 0.01 : -0.01;
      } else {
        o.x += o.vx;
        if (Math.abs(o.x - o.x0) > T * 4) { o.vx = -o.vx; }
        o.y = o.y0 - T + Math.sin(o.t / 20) * T;
      }
    } else {
      if (P.segue && perto) { o.vx = (dx > 0 ? 1 : -1) * vel; }
      else if (P.foge && perto) { o.vx = (dx > 0 ? -1 : 1) * vel; }
      else if (!P.anda) { o.vx = 0; }
      else if (!o.vx) { o.vx = -vel; }
      var bateu = this.moverCorpo(o, true);
      if (bateu) { o.vx = -o.vx; }
      else if (o.chao && P.anda && !P.segue && !e.cai && o.tipo === 'inimigo') {   // item que anda cai da beirada
        var frente = o.vx > 0 ? Math.floor((o.x + o.w) / T) : Math.floor((o.x - 1) / T);
        var baixo = this.tile(frente, Math.floor((o.y + o.h + 1) / T));
        if (!baixo || !baixo.solido || baixo.mortal) { o.vx = -o.vx; }   // peça nova não anda em espinho/lava
      }
      if (P.pula && o.chao && o.t % clamp(e.cadencia_pulo || 90, 20, 600) === 0) { o.vy = -this.vpulo * (P.chefe ? 0.9 : 0.8); }
    }
    if (P.atira && o.tipo === 'inimigo' && perto && --o.esfria <= 0) {
      o.esfria = clamp(e.cadencia || 120, 20, 900);
      var vt = clamp(e.velocidade_tiro || 1.5, 0.3, 5) * this.esc, dist = Math.sqrt(dx * dx + dy * dy) || 1;
      var mirar = e.mira === true || P.voa;
      var tdef = e.tiro && (this.spec.entidades || {})[e.tiro], ts = tdef && this.sprites[tdef.sprite];
      var tw = ts ? ts.w : Math.max(2, 3 * this.esc), th = ts ? ts.h : Math.max(2, 3 * this.esc);
      this.tiros.push({ x: o.x + o.w / 2 - tw / 2, y: o.y + o.h * 0.4 - th / 2, w: tw, h: th, vida: 300,
                        vx: mirar ? dx / dist * vt : (dx > 0 ? vt : -vt), vy: mirar ? dy / dist * vt : 0,
                        sprite: tdef ? tdef.sprite : null, cor: e.cor_tiro || '#FCFCFC', t: 0 });
      this.som.efeito('tiro');
    }
  };

  Plataforma.prototype.pegar = function (o, deBloco) {
    var h = this.heroi, e = o.def;
    o.vivo = false;
    if (o.tipo === 'coletavel') {
      this.pontos += e.pontos || 100; this.som.efeito(e.som || 'moeda');
      if (e.moeda !== false) { this.moedas++; }
    } else if (o.tipo === 'poder') {
      var da = e.da || 'escudo';
      if (da === 'crescer') { if (h.grande) { this.pontos += 1000; this.som.efeito('poder'); } else { this.crescer(true); } }
      else if (da === 'estrela') { this.estrela(e.segundos || 10); }
      else if (da === 'vida') { this.vidas = Math.min(99, this.vidas + 1); this.som.efeito('vida'); }
      else if (da === 'pulo_duplo') { this.duplo = true; this.som.efeito('poder'); }
      else { h.poder = da; this.som.efeito('poder'); }
      this.popup('+' + (e.pontos || (da === 'vida' ? '1UP' : 1000)), o.x, o.y);
    }
    this.disparar('pegou', { item: o.ch, x: o.x + o.w / 2, y: o.y + o.h, de_bloco: !!deBloco });
  };
  Plataforma.prototype.popup = function (txt, x, y) { if (this.fx.length < 120) { this.fx.push({ texto: String(txt), x: x, y: y, vy: -0.6, g: 0, vida: 40 }); } };
  Plataforma.prototype.estilhacos = function (x, y, cor, n, forca) {
    for (var k = 0; k < (n || 6) && this.fx.length < 160; k++) {
      var a = this.rngFx() * Math.PI * 2, v = (0.5 + this.rngFx()) * (forca || 1.5) * this.esc;
      this.fx.push({ x: x, y: y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 1.5 * this.esc, g: 0.18 * this.esc, vida: 30 + Math.floor(this.rngFx() * 20), cor: cor, tam: Math.max(1, Math.round(this.esc * (1 + this.rngFx()))) });
    }
  };
  Plataforma.prototype.derrotar = function (o, como) {
    if (como !== 'cartas' && Cartas.tem(o) && Cartas.atingido(this, o, como)) { return; }   // 🃏 "FOI ATINGIDA →" manda
    if (!o.vivo) { return; }
    o.vivo = false;
    var pts = o.def.pontos || (o.pecas && o.pecas.chefe ? 5000 : 200);
    this.pontos += pts; this.popup('+' + pts, o.x, o.y);
    this.estilhacos(o.x + o.w / 2, o.y + o.h / 2, (o.def.cor_estilhaco || '#FCFCFC'), o.pecas && o.pecas.chefe ? 24 : 6, o.pecas && o.pecas.chefe ? 3 : 1.5);
    if (o.pecas && o.pecas.chefe) { this.tremor = 40; this.som.efeito('explosao'); }
    this.disparar('derrotou', { inimigo: o.ch, x: o.x + o.w / 2, y: o.y + o.h, como: como || 'pisao' });
  };
  Plataforma.prototype.bateuCabeca = function (b) {
    var ch = this.mapa[b.j][b.i], td = (this.spec.tiles || {})[ch], T = this.T, h = this.heroi;
    if (!td) { return; }
    var chave = b.i + ',' + b.j;
    this.disparar('bateu_bloco', { bloco: ch, x: b.i * T + T / 2, y: b.j * T, coluna: b.i + 1, linha: b.j + 1 });
    var sur = td.surpresa;
    if (sur && !this.usados[chave]) {
      var solta = typeof sur === 'string' ? sur : sur.solta, vezes = typeof sur === 'object' ? clamp(sur.vezes || 1, 1, 20) : 1;
      this.usados[chave + '#'] = (this.usados[chave + '#'] || 0) + 1;
      if (this.usados[chave + '#'] >= vezes) {
        this.usados[chave] = true;
        var vira = (typeof sur === 'object' && sur.vira) || td.vira;
        if (vira && (vira === '.' || (this.spec.tiles || {})[vira])) { this.mapa[b.j][b.i] = vira; }
      }
      // o cogumelo do bloco vira estrela se o herói já é grande? Não — a criança decide com "se_grande"
      if (typeof sur === 'object' && sur.se_grande && h.grande) { solta = sur.se_grande; }
      this.bumps.push({ i: b.i, j: b.j, t: 10 });
      this.som.efeito('surpresa');
      this.soltar(solta, b.i * T + T / 2, b.j * T, true);
      this.bateuInimigoEm(b.i, b.j);
      return;
    }
    if (td.quebravel && !td.borda_mundo && (h.grande || !(this.spec.heroi || {}).sprite_grande || td.quebra_pequeno)) {
      this.mapa[b.j][b.i] = '.'; this.pontos += td.pontos || 50;
      this.estilhacos(b.i * T + T / 2, b.j * T + T / 2, td.cor || '#C84C0C', 8, 2);
      this.som.efeito('quebra'); this.bateuInimigoEm(b.i, b.j);
      return;
    }
    this.bumps.push({ i: b.i, j: b.j, t: 10 });   // bloco comum: só balança (não mexe em nada do jogo)
    this.som.efeito('bloco');
  };
  Plataforma.prototype.bateuInimigoEm = function (i, j) {   // inimigo em cima do bloco que o herói bateu cai derrotado
    var T = this.T, self = this;
    this.objs.forEach(function (o) {
      if (o.vivo && o.tipo === 'inimigo' && !(o.pecas && o.pecas.chefe) && Math.abs((o.y + o.h) - j * T) < 3 && o.x < (i + 1) * T && o.x + o.w > i * T) { self.derrotar(o, 'bloco'); }
    });
  };
  Plataforma.prototype.olharTiles = function (inp) {
    var h = this.heroi, T = this.T, tiles = this.spec.tiles || {}, agora = {}, self = this;
    var i0 = Math.floor((h.x + 1) / T), i1 = Math.floor((h.x + h.w - 2) / T), j0 = Math.floor((h.y + 1) / T), j1 = Math.floor((h.y + h.h) / T);
    var dano = false;
    for (var j = j0; j <= j1; j++) {
      for (var i = i0; i <= i1; i++) {
        var ch = (this.mapa[j] || [])[i], td = tiles[ch];
        if (!td) { continue; }
        agora[ch] = { i: i, j: j };
        if (td.mortal && (j < j1 || td.solido)) { dano = true; }
      }
    }
    if (dano && !h.invuln && !h.estrela) { this.ultimoDano = 'bloco'; this.ferir(); if (h.morto) { return; } }
    Object.keys(agora).forEach(function (ch) { if (!self.tocando[ch]) { self.disparar('tocou', { bloco: ch, x: agora[ch].i * T + T / 2, y: agora[ch].j * T, coluna: agora[ch].i + 1, linha: agora[ch].j + 1 }); } });
    this.tocando = agora;
    // cano / porta de passagem: em pé em cima e aperta ▼ (ou ▲ na frente, se `por_cima` for falso)
    if (h.chao && inp.apertou && (inp.apertou('baixo') || inp.apertou('cima'))) {
      var pe = Math.floor((h.y + h.h + 1) / T), meio = Math.floor((h.x + h.w / 2) / T);
      var cand = inp.apertou('baixo') ? [[meio, pe]] : [[meio, Math.floor((h.y + h.h - 1) / T)]];
      for (var c = 0; c < cand.length; c++) {
        var t2 = this.tile(cand[c][0], cand[c][1]);
        if (t2 && t2.entrada) { var en = t2.entrada; this.teleporte(en.coluna, en.linha, en.fase); return; }
      }
    }
  };

  Plataforma.prototype.atualizar = function (inp) {
    if (this.estado === 'construir') { this.quadro++; return; }   // 🏗 Estúdio de Fases: a fase parada, só para ver e construir
    if (this.lento && this.estado === 'jogando') { this.lentoT = (this.lentoT || 0) + 1; if (this.lentoT % 3) { return; } }   // 🐢 câmera lenta
    this.quadro++;
    if (inp.apertou('mudo')) { this.som.alternarMudo(); }
    if (this.estado === 'titulo' || this.estado === 'fim_jogo' || this.estado === 'vitoria') {
      if (inp.apertou('start') || inp.apertou('pulo')) {
        this.som.ligar();
        this.quadro = 0; this.rng = mulberry32(this.semente);   // partida nova = mesmo começo (replay do placar)
        this.pontos = 0; this.vidas = this.vidasIniciais; this.faseIdx = 0;
        this.novaPartida();
        this.carregarFase(0); this.estado = 'jogando';
      }
      return;
    }
    if (this.estado === 'pausa') { if (inp.apertou('pausa') || inp.apertou('start') || inp.apertou('pulo')) { this.estado = 'jogando'; } return; }
    if (this.estado === 'fase_ok') {
      if (--this.espera <= 0) {
        this.faseIdx++;
        if (this.faseIdx >= this.spec.fases.length) { this.estado = 'vitoria'; this.som.parar(); this.som.efeito('fim');
                                                       if (this.evento) { this.evento('venceu_jogo', { pontos: this.pontos }); } }
        else { this.carregarFase(this.faseIdx); this.estado = 'jogando'; }
      }
      return;
    }
    if (inp.apertou('pausa')) { this.estado = 'pausa'; return; }

    var h = this.heroi;
    this.atualizarFx();
    if (h.morto) {
      if (--h.morto <= 0) {
        if (this.vidas <= 0) { this.estado = 'fim_jogo'; this.som.parar(); return; }
        this.grandeGuardado = false;
        this.carregarFase(this.faseIdx);
      }
      return;
    }
    this.tFase++;
    // andar
    var alvo = (inp.dir ? 1 : 0) - (inp.esq ? 1 : 0);
    if (alvo) { h.olhando = alvo; }
    h.vx += (alvo * this.correr - h.vx) * (h.chao ? 0.35 : 0.18);
    if (Math.abs(h.vx) < 0.02) { h.vx = 0; }
    // pulo: coyote time + buffer + altura variável + pulo duplo
    h.coyote = h.chao ? 6 : Math.max(0, h.coyote - 1);
    h.buffer = inp.apertou('pulo') ? 6 : Math.max(0, h.buffer - 1);
    if (h.buffer && (h.coyote || (this.duplo && h.pulosAr < 1))) {
      if (!h.coyote) { h.pulosAr++; }
      h.vy = -this.vpulo; h.coyote = 0; h.buffer = 0; this.som.efeito('pulo');
    }
    if (!inp.pulo && h.vy < -this.vpulo * 0.45) { h.vy = -this.vpulo * 0.45; }
    this.moverCorpo(h, true);
    gravarRastro(this);
    if (h.teto) { this.bateuCabeca(h.teto); }
    if (h.chao) { h.pulosAr = 0; }
    if (h.invuln) { h.invuln--; }
    if (h.estrela && --h.estrela === 0) { this.som.musica(this.fase.musica); }
    if (h.estrela && (this.quadro & 3) === 0) { this.estilhacos(h.x + h.w / 2, h.y + h.h / 2, ['#F8B800', '#FCFCFC', '#F83800', '#3CBCFC'][(this.quadro >> 2) & 3], 1, 0.6); }
    if (h.y > this.alt + this.T * 2) { this.morrer(); return; }
    this.olharTiles(inp);
    if (h.morto || this.estado !== 'jogando') { return; }
    this.olharZonas();
    if (h.morto || this.estado !== 'jogando') { return; }

    // objetos
    var self = this, T = this.T;
    this.objs.forEach(function (o) {
      if (!o.vivo) { return; }
      o.t++;
      if (Cartas.tem(o)) {   // 🃏 cartas: o jeito do personagem é o que as cartas dizem
        if (o.sobe > 0) { var ps = Math.min(o.sobe, 0.5 * self.esc); o.y -= ps; o.sobe -= ps; } else { Cartas.passo(self, o); }
        if (!o.vivo) { return; }
      }
      else if (o.pecas) { self.moverPecas(o, h); }
      else if (o.tipo === 'inimigo') {
        var c = o.def.comportamento || 'patrulha';
        if (c === 'patrulha' || c === 'pula') {
          var bateu = self.moverCorpo(o, true);
          if (bateu) { o.vx = -o.vx; }
          else if (o.chao) {
            var frente = o.vx > 0 ? Math.floor((o.x + o.w) / T) : Math.floor((o.x - 1) / T);
            var baixo = self.tile(frente, Math.floor((o.y + o.h + 1) / T));
            if (!baixo || !baixo.solido) { o.vx = -o.vx; }
          }
          if (c === 'pula' && o.chao && o.t % 90 === 0) { o.vy = -self.vpulo * 0.8; }
        } else if (c === 'voa_seno') {
          o.x += o.vx;
          if (Math.abs(o.x - o.x0) > T * 4) { o.vx = -o.vx; }
          o.y = o.y0 - T + Math.sin(o.t / 20) * T;
        }
      }
      if (o.y > self.alt + T * 4) { o.vivo = false; return; }
      if (o.ferido) { o.ferido--; }
      if (o.semDano) { o.semDano--; }
      // casco chutado derruba os outros inimigos no caminho
      if (o.casco === 'chutado') {
        self.objs.forEach(function (b) { if (b !== o && b.vivo && b.tipo === 'inimigo' && !(b.pecas && b.pecas.chefe) && bate(o, b)) { self.derrotar(b, 'casco'); } });
      }
      if (o.pecas && o.pecas.plataforma) { return; }   // plataforma que anda: resolvida depois (o herói sobe nela)
      // contato com o herói
      if (h.x < o.x + o.w && h.x + h.w > o.x && h.y < o.y + o.h && h.y + h.h > o.y) {
        if (o.tipo === 'coletavel' || o.tipo === 'poder') { if (!(o.sobe > 0)) { self.pegar(o, false); } }
        else if (o.tipo === 'fim_de_fase') { self.terminarFase(); }
        else if (o.tipo === 'inimigo') {
          var deCima = h.vy > 0 && (h.y + h.h) - o.y < Math.max(6, h.vy + 3);
          var P = o.pecas || {};
          if (h.estrela) { self.derrotar(o, 'estrela'); self.som.efeito('pisao'); return; }
          if (Cartas.tem(o)) {
            if (deCima && o.def.pisavel !== false) { h.vy = -self.vpulo * 0.6; self.som.efeito('pisao'); self.derrotar(o, 'pisao'); return; }
            Cartas.encostou(self, o); return;
          }
          if (o.casco === 'parado') {         // chuta o casco
            o.casco = 'chutado'; o.vx = (h.x + h.w / 2 < o.x + o.w / 2 ? 1 : -1) * 4 * self.esc; o.semDano = 12; self.som.efeito('casco');
            if (deCima) { h.vy = -self.vpulo * 0.5; }
            return;
          }
          if (deCima && o.def.pisavel !== false && !P.espinho && !P.fantasma) {
            h.vy = -self.vpulo * 0.6; self.som.efeito('pisao');
            if (P.casco && o.casco !== 'parado') { o.casco = 'parado'; o.tCasco = 0; o.vx = 0; self.pontos += 100; self.popup('+100', o.x, o.y); return; }
            if (P.chefe || (o.vidaMax || 1) > 1) {
              if (o.ferido) { return; }
              var antes = Math.round(o.vida / o.vidaMax * 100);
              o.vida--; o.ferido = 50; self.tremor = 10; self.som.efeito('chefe');
              self.disparar('vida_do', { inimigo: o.ch, antes: antes, agora: Math.round(o.vida / o.vidaMax * 100), x: o.x + o.w / 2, y: o.y + o.h });
              if (o.vida <= 0) { self.derrotar(o, 'pisao'); }
              return;
            }
            if (o.pecas) { self.derrotar(o, 'pisao'); return; }
            o.vivo = false; self.pontos += o.def.pontos || 200;   // (inimigo antigo: igual ao motor 0.8)
            if (self.regras.length) { self.disparar('derrotou', { inimigo: o.ch, x: o.x + o.w / 2, y: o.y + o.h, como: 'pisao' }); }
            if (self.estilhacosLigados) { self.estilhacos(o.x + o.w / 2, o.y + o.h / 2, '#FCFCFC', 5); }
          } else if (!h.invuln && !o.semDano) { self.ultimoDano = o.def.comportamento || (o.pecas ? Object.keys(o.pecas).join('+') : 'patrulha'); self.ferir(); }
        }
      }
    });
    if (this.estado !== 'jogando' || h.morto) { return; }
    this.atualizarTiros(h);
    if (h.morto) { return; }
    // plataformas que andam: o herói pousa e é carregado
    for (var k = 0; k < this.objs.length; k++) {
      var pl = this.objs[k];
      if (!pl.vivo || !pl.pecas || !pl.pecas.plataforma) { continue; }
      var pe = h.y + h.h;
      if (h.vy >= 0 && h.x + h.w > pl.x + 1 && h.x < pl.x + pl.w - 1 && pe >= pl.y - 1 && pe <= pl.y + Math.max(4, h.vy + (pl.dy > 0 ? pl.dy : 0) + 2)) {
        h.y = pl.y - h.h; h.vy = 0; h.chao = true; h.x += pl.dx || 0; h.pulosAr = 0;
      }
    }
    this.limparObjs();
    // regras de tempo, coluna e contadores
    if (this.regras.length) {
      for (var r = 0; r < this.regras.length; r++) {
        var q = this.regras[r] && this.regras[r].quando;
        if (q && q.evento === 'tempo') {
          var s = Math.round((q.segundos || q.a_cada || 0) * 60);
          if (s > 0 && (q.a_cada ? this.tFase % s === 0 : this.tFase === s)) { this.dispararUma(r, 'tempo', {}); }
        }
      }
      var col = Math.floor((h.x + h.w / 2) / T) + 1;
      if (col > this.colMax) { var de = this.colMax; this.colMax = col; for (var r2 = 0; r2 < this.regras.length; r2++) { var q2 = this.regras[r2] && this.regras[r2].quando; if (q2 && q2.evento === 'chegou' && q2.coluna > de && q2.coluna <= col) { this.dispararUma(r2, 'chegou', {}); } } }
      if (this.pontos !== this.contAntes.pontos) { this.disparar('pontos', { antes: this.contAntes.pontos, agora: this.pontos }); }
      if (this.moedas !== this.contAntes.moedas) { this.disparar('moedas', { antes: this.contAntes.moedas, agora: this.moedas }); }
      this.contAntes = { pontos: this.pontos, moedas: this.moedas };
      ['cima', 'baixo'].forEach(function (b) { if (inp.apertou && inp.apertou(b)) { self.disparar('apertou', { botao: b }); } });
    }
    if (this.estado !== 'jogando') { return; }

    // câmera
    var alvoX = h.x + h.w / 2 - this.W / 2 + h.olhando * this.T * 2;
    this.cam.x += (clamp(alvoX, 0, Math.max(0, this.larg - this.W)) - this.cam.x) * 0.12;
    var alvoY = h.y + h.h / 2 - this.H / 2;
    this.cam.y += (clamp(alvoY, 0, Math.max(0, this.alt - this.H)) - this.cam.y) * 0.12;
  };
  Plataforma.prototype.dispararUma = function (idx, ev, d) {   // regra de tempo/coluna: só aquela regra
    var r = this.regras[idx];
    if (r.fase && r.fase !== this.faseIdx + 1) { return; }
    if (r.uma_vez) { if (this.regrasFeitas[idx]) { return; } this.regrasFeitas[idx] = 1; }
    var acoes = Array.isArray(r.entao) ? r.entao : (r.entao ? [r.entao] : []);
    for (var a = 0; a < acoes.length && a < 20; a++) { this.fazer(acoes[a], d); }
  };
  Plataforma.prototype.limparObjs = function () {
    if (this.objs.length > 80 && (this.quadro & 63) === 0) { this.objs = this.objs.filter(function (o) { return o.vivo; }); }
  };
  Plataforma.prototype.atualizarTiros = function (h) {
    var T = this.T, self = this;
    this.tiros = this.tiros.filter(function (t) {
      t.x += t.vx; t.y += t.vy; t.t++;
      if (--t.vida <= 0) { return false; }
      var tt = self.tile(Math.floor((t.x + t.w / 2) / T), Math.floor((t.y + t.h / 2) / T));
      if (tt && tt.solido && !tt.plataforma) { self.estilhacos(t.x, t.y, t.cor, 3, 0.8); return false; }
      if (bate(t, h, 1)) {
        if (h.estrela) { return false; }
        if (!h.invuln) { self.ultimoDano = 'tiro'; self.ferir(); }
        return false;
      }
      return true;
    });
  };
  Plataforma.prototype.atualizarFx = function () {
    if (this.tremor) { this.tremor--; }
    this.bumps = this.bumps.filter(function (b) { return --b.t > 0; });
    if (!this.fx.length) { return; }
    this.fx = this.fx.filter(function (p) { p.vida--; p.x += p.vx || 0; p.vy += p.g || 0; p.y += p.vy || 0; return p.vida > 0; });
  };

  Plataforma.prototype.ferir = function () {
    var h = this.heroi;
    if (h.estrela) { return; }
    if (h.poder) { h.poder = null; h.invuln = 90; this.som.efeito('dano'); h.vy = -this.vpulo * 0.4; return; }
    if (h.grande) { this.crescer(false); h.invuln = 100; this.som.efeito('dano'); return; }
    this.morrer();
  };
  Plataforma.prototype.morrer = function () {
    var h = this.heroi;
    this.vidas--; h.morto = 90; h.vy = -this.vpulo * 0.7; this.som.parar(); this.som.efeito('dano'); marcarQueda(this);
    if (this.evento) { this.evento('dano', { jogador: 1 }); }
    if (this.regras.length) { this.disparar('perdeu_vida', { vidas: this.vidas }); }
  };

  Plataforma.prototype.desenharSprite = function (ctx, nome, x, y, quadro, virar, escala, altura) {
    var s = this.sprites[nome];
    if (!s || !s.quadros.length) { ctx.fillStyle = '#FF00FF'; ctx.fillRect(x, y, this.T, this.T); return; }
    var q = s.quadros[quadro % s.quadros.length];
    var w = s.w * (escala || 1), hh = altura || s.h * (escala || 1);
    if (virar) { ctx.save(); ctx.translate(x + w, y); ctx.scale(-1, 1); ctx.drawImage(q, 0, 0, w, hh); ctx.restore(); }
    else if (escala || altura) { ctx.drawImage(q, x, y, w, hh); }
    else { ctx.drawImage(q, x, y); }
  };

  // ── fundo em camadas (parallax): montanhas, colinas, nuvens, estrelas, prédios ou um sprite repetido ──
  function sorteio(n) { n = (n ^ 61) ^ (n >>> 16); n = n + (n << 3); n = n ^ (n >>> 4); n = Math.imul(n, 0x27d4eb2d); n = n ^ (n >>> 15); return (n >>> 0) / 4294967296; }
  Plataforma.prototype.desenharFundo = function (ctx, cx, cy) {
    var camadas = this.fase.fundo, W = this.W, H = this.H, T = this.T, self = this;
    if (!Array.isArray(camadas)) { return; }
    camadas.slice(0, 6).forEach(function (c, ci) {
      if (!c || typeof c !== 'object') { return; }
      var fator = clamp(c.fator == null ? 0.3 : c.fator, 0, 1), off = cx * fator, base = Math.round(H * clamp(c.y == null ? 0.75 : c.y, 0, 1)) - Math.round(cy * fator * 0.3);
      var alt = Math.round(clamp(c.altura == null ? 0.3 : c.altura, 0.02, 1) * H), seed = (ci + 1) * 7919;
      ctx.fillStyle = c.cor || '#2038EC';
      var x, k, h;
      if (c.tipo === 'montanhas' || c.tipo === 'colinas') {
        var per = Math.max(16, Math.round(alt * (c.tipo === 'montanhas' ? 2.2 : 3)));
        for (x = 0; x < W; x++) {
          var wx = x + off, cel = Math.floor(wx / per), dentro = (wx - cel * per) / per;
          var amp = 0.55 + 0.45 * sorteio(cel + seed);
          if (c.tipo === 'montanhas') { h = (1 - Math.abs(dentro * 2 - 1)) * alt * amp; }
          else { var dd = dentro * 2 - 1; h = Math.sqrt(Math.max(0, 1 - dd * dd)) * alt * amp; }
          h = Math.round(h);
          ctx.fillRect(x, base - h, 1, H - base + h);
          if (c.cor2 && c.tipo === 'montanhas' && h > alt * 0.6) { ctx.fillStyle = c.cor2; ctx.fillRect(x, base - h, 1, Math.max(1, Math.round((h - alt * 0.6) * 0.8))); ctx.fillStyle = c.cor || '#2038EC'; }
        }
        if (c.cor2 && c.tipo === 'colinas') { ctx.fillStyle = c.cor2; ctx.fillRect(0, base, W, H - base); }
      } else if (c.tipo === 'nuvens') {
        var esp = Math.max(48, Math.round(W * 0.45));
        for (k = Math.floor(off / esp) - 1; k <= Math.floor((off + W) / esp) + 1; k++) {
          var nx = k * esp - off + Math.round(sorteio(k + seed) * esp * 0.5), ny = base - Math.round(sorteio(k * 3 + seed) * alt);
          var nw = Math.round(T * (2 + sorteio(k * 5 + seed) * 3));
          ctx.fillRect(nx, ny, nw, Math.round(T * 0.6));
          ctx.fillRect(nx + Math.round(nw * 0.2), ny - Math.round(T * 0.45), Math.round(nw * 0.6), Math.round(T * 0.5));
          ctx.fillRect(nx + Math.round(nw * 0.35), ny - Math.round(T * 0.75), Math.round(nw * 0.3), Math.round(T * 0.4));
          if (c.cor2) { ctx.fillStyle = c.cor2; ctx.fillRect(nx, ny + Math.round(T * 0.45), nw, Math.max(1, Math.round(T * 0.15))); ctx.fillStyle = c.cor || '#FCFCFC'; }
        }
      } else if (c.tipo === 'estrelas') {
        for (k = 0; k < 60; k++) {
          var sx = Math.floor((sorteio(k + seed) * W * 2 - off) % W); if (sx < 0) { sx += W; }
          var sy = Math.floor(sorteio(k * 7 + seed) * base);
          if ((self.quadro + k * 13) % 97 > 3) { ctx.fillRect(sx, sy, 1, 1); }
        }
      } else if (c.tipo === 'castelo') {     // torres com ameias e janelas em arco
        var tw = Math.max(12, Math.round(T * 3)), esp2 = tw * 2;
        for (k = Math.floor(off / esp2) - 1; k <= Math.floor((off + W) / esp2) + 1; k++) {
          var th = Math.round(alt * (0.55 + 0.45 * sorteio(k + seed))), tx = Math.round(k * esp2 - off + sorteio(k * 5 + seed) * tw);
          ctx.fillRect(tx, base - th, tw, H - base + th);
          for (var am = 0; am < tw; am += 4) { ctx.fillRect(tx + am, base - th - 3, 2, 3); }
          ctx.fillRect(tx - tw, base - Math.round(th * 0.45), tw * 3, H);   // muralha
          if (c.cor2) { ctx.fillStyle = c.cor2; var jw = Math.max(2, Math.round(tw / 5)); for (var jy2 = base - th + 6; jy2 < base - th * 0.5; jy2 += 10) { ctx.fillRect(tx + Math.round(tw / 2 - jw / 2), jy2 + 1, jw, 4); ctx.fillRect(tx + Math.round(tw / 2 - jw / 2) + 1, jy2, jw - 2, 1); } ctx.fillStyle = c.cor || '#2038EC'; }
        }
      } else if (c.tipo === 'predios') {
        var pw = Math.max(10, Math.round(T * 2));
        for (k = Math.floor(off / pw) - 1; k <= Math.floor((off + W) / pw) + 1; k++) {
          var ph = Math.round(alt * (0.4 + 0.6 * sorteio(k + seed))), px = k * pw - off;
          ctx.fillRect(px, base - ph, pw - 2, H - base + ph);
          if (c.cor2) { ctx.fillStyle = c.cor2; for (var jy = base - ph + 3; jy < base - 2; jy += 5) { for (var ix = px + 2; ix < px + pw - 4; ix += 4) { if (sorteio(ix * 31 + jy + seed) > 0.45) { ctx.fillRect(ix, jy, 2, 2); } } } ctx.fillStyle = c.cor || '#2038EC'; }
        }
      } else if (c.tipo === 'sprite' && c.sprite && self.sprites[c.sprite]) {
        var sp = self.sprites[c.sprite], e2 = Math.max(sp.w, Math.round((c.espaco || 4) * T));
        for (k = Math.floor(off / e2) - 1; k <= Math.floor((off + W) / e2) + 1; k++) { self.desenharSprite(ctx, c.sprite, Math.round(k * e2 - off), base - sp.h, (self.quadro >> 4) + k, false); }
      } else if (c.tipo === 'faixa') {
        ctx.fillRect(0, base, W, alt);
      }
    });
  };

  Plataforma.prototype.spriteDoHeroi = function () {
    var her = this.spec.heroi || {}, h = this.heroi, an = (h.grande ? her.animacoes_grande : her.animacoes) || {};
    var padrao = h.grande && her.sprite_grande ? her.sprite_grande : (h.poder && her.sprite_poder ? her.sprite_poder : her.sprite);
    var estado = h.morto ? 'morto' : (!h.chao ? (h.vy < 0 ? 'pulo' : 'queda') : (Math.abs(h.vx) > 0.2 ? 'anda' : 'parado'));
    var nome = an[estado] || (estado === 'queda' ? an.pulo : null) || padrao;
    if (h.poder && her.sprite_poder && !h.grande && !an[estado]) { nome = her.sprite_poder; }
    return { nome: this.sprites[nome] ? nome : padrao, estado: estado };
  };

  Plataforma.prototype.desenhar = function (ctx) {
    var W = this.W, H = this.H, T = this.T, spec = this.spec, cor = spec.cores || {};
    var tinta = cor.texto || '#FCFCFC', fundo = cor.fundo || '#000000';
    if (this.estado === 'titulo') {
      ctx.fillStyle = fundo; ctx.fillRect(0, 0, W, H);
      textoCentro(ctx, spec.titulo || 'MEU JOGO', W, Math.floor(H * 0.3), cor.destaque || '#F8B800', 2);
      if (spec.textos && spec.textos.subtitulo) { textoCentro(ctx, spec.textos.subtitulo, W, Math.floor(H * 0.3) + 18, tinta, 1); }
      if ((this.quadro >> 5) % 2 === 0) { textoCentro(ctx, 'APERTE ESPACO OU OK', W, Math.floor(H * 0.62), tinta, 1); }
      textoCentro(ctx, 'SETAS ANDAM  ESPACO PULA  M SOM', W, H - 14, cor.apagado || '#7C7C7C', 1);
      desenharRecorde(ctx, this, W, H);
      return;
    }
    if (this.estado === 'fim_jogo' || this.estado === 'vitoria') {
      ctx.fillStyle = fundo; ctx.fillRect(0, 0, W, H);
      var msg = this.estado === 'vitoria' ? ((spec.textos && spec.textos.vitoria) || 'VOCE VENCEU!') : 'FIM DE JOGO';
      textoCentro(ctx, msg, W, Math.floor(H * 0.35), cor.destaque || '#F8B800', 2);
      textoCentro(ctx, 'PONTOS ' + this.pontos, W, Math.floor(H * 0.35) + 22, tinta, 1);
      if (this.placarMsg) { textoCentro(ctx, this.placarMsg, W, Math.floor(H * 0.35) + 34, cor.destaque || '#F8B800', 1); }
      if ((this.quadro >> 5) % 2 === 0) { textoCentro(ctx, 'APERTE ESPACO OU OK', W, Math.floor(H * 0.65), tinta, 1); }
      return;
    }
    var f = this.fase;
    ctx.fillStyle = f.ceu || '#000000'; ctx.fillRect(0, 0, W, H);
    var cx = Math.round(this.cam.x), cy = Math.round(this.cam.y);
    if (this.tremor) { cx += Math.round((this.rngFx() * 2 - 1) * 2 * this.esc); cy += Math.round((this.rngFx() * 2 - 1) * 2 * this.esc); }
    // se o mapa é mais baixo que a tela, ancora no chão
    var dy = this.alt < H ? H - this.alt : 0;
    if (f.fundo) { this.desenharFundo(ctx, cx, cy - dy); }
    ctx.save(); ctx.translate(-cx, -cy + dy);
    var i0 = Math.max(0, Math.floor(cx / T)), i1 = Math.min(this.colunas - 1, Math.floor((cx + W) / T));
    var tiles = spec.tiles || {}, bumps = {};
    this.bumps.forEach(function (b) { bumps[b.i + ',' + b.j] = Math.round(Math.sin(b.t / 10 * Math.PI) * T * 0.35); });
    for (var j = 0; j < this.linhas; j++) {
      for (var i = i0; i <= i1; i++) {
        var td = tiles[this.mapa[j][i]];
        if (!td) { continue; }
        var by = j * T - (bumps[i + ',' + j] || 0);
        if (td.sprite && this.sprites[td.sprite]) {
          this.desenharSprite(ctx, td.sprite, i * T, by, this.sprites[td.sprite].quadros.length > 1 ? (this.quadro >> 4) : 0, false);
          if (td.surpresa && this.usados[i + ',' + j]) { ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fillRect(i * T, by, T, T); }
          continue;
        }
        ctx.fillStyle = (td.surpresa && this.usados[i + ',' + j]) ? (td.cor_usado || '#7C4C2C') : (td.cor || '#888888'); ctx.fillRect(i * T, by, T, T);
        if (td.borda && (j === 0 || this.mapa[j - 1][i] !== this.mapa[j][i])) { ctx.fillStyle = td.borda; ctx.fillRect(i * T, by, T, Math.max(1, T >> 3)); }
        if (td.surpresa && !this.usados[i + ',' + j]) { ctx.fillStyle = td.borda || '#FCFCFC'; var m = Math.round(T * 0.35); ctx.fillRect(i * T + m, by + m, T - 2 * m, T - 2 * m); }
      }
    }
    var self = this;
    this.objs.forEach(function (o) {
      if (!o.vivo) { return; }
      if (o.ferido && (self.quadro >> 2) % 2) { return; }
      var q = (o.tipo === 'inimigo') ? (o.t >> 3) : (o.t >> 4), nome = o.def.sprite;
      if (o.casco && o.def.sprite_casco) { nome = o.def.sprite_casco; q = o.casco === 'chutado' ? (o.t >> 2) : 0; }
      if (o.sobe > 0) {   // saindo do bloco: só a parte de cima aparece
        ctx.save(); ctx.beginPath(); ctx.rect(o.x - 2, o.y - 2, o.w + 4, o.h - o.sobe + 2); ctx.clip();
        self.desenharSprite(ctx, nome, Math.round(o.x), Math.round(o.y), q, o.vx > 0, o.esc > 1 ? o.esc : 0); ctx.restore(); return;
      }
      self.desenharSprite(ctx, nome, Math.round(o.x), Math.round(o.y), q, o.vx > 0, o.esc > 1 ? o.esc : 0);
    });
    this.tiros.forEach(function (t) {
      if (t.sprite && self.sprites[t.sprite]) { self.desenharSprite(ctx, t.sprite, Math.round(t.x), Math.round(t.y), t.t >> 3, t.vx > 0); }
      else { ctx.fillStyle = t.cor; ctx.fillRect(Math.round(t.x), Math.round(t.y), t.w, t.h); }
    });
    var h = this.heroi;
    if (!(h.invuln && (this.quadro >> 2) % 2)) {
      var her = spec.heroi || {}, sh = this.spriteDoHeroi();
      var anda = sh.estado === 'anda' ? (this.quadro >> 3) : (sh.estado === 'parado' ? (this.quadro >> 5) : 0);
      var spH = this.sprites[sh.nome];
      var altura = (h.grande && !her.sprite_grande && spH) ? h.h : 0;
      if (h.estrela && (this.quadro >> 1) % 2) { ctx.globalAlpha = 0.6; }
      if (spH && h.morto === 0 && sh.estado === 'parado' && spH.quadros.length > 1 && !(her.animacoes || {}).parado) { anda = 0; }
      this.desenharSprite(ctx, sh.nome, Math.round(h.x), Math.round(h.y), anda, h.olhando < 0, altura ? 1 : 0, altura);
      ctx.globalAlpha = 1;
    }
    // efeitos: estilhaços, moedas que saltam do bloco e "+200"
    this.fx.forEach(function (p) {
      if (p.texto) { texto(ctx, p.texto, Math.round(p.x), Math.round(p.y), tinta, 1); }
      else if (p.sprite) { self.desenharSprite(ctx, p.sprite, Math.round(p.x), Math.round(p.y), self.quadro >> 2, false); }
      else { ctx.fillStyle = p.cor || '#FCFCFC'; ctx.fillRect(Math.round(p.x), Math.round(p.y), p.tam || 1, p.tam || 1); }
    });
    ctx.restore();
    if (this.estado === 'construir') { return; }
    // HUD
    texto(ctx, 'VIDAS ' + Math.max(0, this.vidas), 4, 4, tinta, 1);
    var p = 'PONTOS ' + this.pontos; texto(ctx, p, W - larguraTexto(p, 1) - 4, 4, tinta, 1);
    textoCentro(ctx, 'FASE ' + (this.faseIdx + 1), W, 4, tinta, 1);
    if (this.moedas > 0 || (spec.hud && spec.hud.moedas)) { texto(ctx, 'MOEDAS ' + this.moedas, 4, 11, cor.destaque || '#F8B800', 1); }
    // barra de vida do chefe (só quando ele está na tela)
    for (var k = 0; k < this.objs.length; k++) {
      var o = this.objs[k];
      if (o.vivo && o.pecas && o.pecas.chefe && o.x + o.w > cx - T && o.x < cx + W + T) {
        var bw = Math.round(W * 0.4), bx = Math.round((W - bw) / 2), nm = String(o.def.nome || 'CHEFE').slice(0, 20);
        textoCentro(ctx, nm, W, 12, cor.destaque || '#F8B800', 1);
        ctx.fillStyle = '#000000'; ctx.fillRect(bx - 1, 18, bw + 2, 5);
        ctx.fillStyle = '#F83800'; ctx.fillRect(bx, 19, Math.round(bw * o.vida / o.vidaMax), 3);
        break;
      }
    }
    // mensagem da regra / do código mágico
    var ms = this.msgs[0];
    if (ms && this.quadro < ms.ate) {
      var porLinha = Math.max(10, Math.floor((W - 16) / 4)), pal = ms.texto.split(/\s+/), linhas = [], atual = '';
      pal.forEach(function (w) { if ((atual + ' ' + w).trim().length > porLinha) { linhas.push(atual); atual = w; } else { atual = (atual + ' ' + w).trim(); } });
      if (atual) { linhas.push(atual); }
      linhas = linhas.slice(0, 4);
      var bh = linhas.length * 7 + 8, by2 = 27;   // no alto (embaixo ficam o chão e o herói)
      ctx.fillStyle = 'rgba(0,0,0,.78)'; ctx.fillRect(6, by2, W - 12, bh);
      ctx.fillStyle = cor.destaque || '#F8B800'; ctx.fillRect(6, by2, W - 12, 1); ctx.fillRect(6, by2 + bh - 1, W - 12, 1);
      linhas.forEach(function (l, n) { textoCentro(ctx, l, W, by2 + 4 + n * 7, '#FCFCFC', 1); });
    }
    if (this.erroMagico && this.quadro < this.erroMagico.ate) {
      ctx.fillStyle = 'rgba(160,0,0,.85)'; ctx.fillRect(0, H - 12, W, 9);
      texto(ctx, ('CODIGO MAGICO: ' + this.erroMagico.texto).slice(0, Math.floor((W - 4) / 4)), 2, H - 10, '#FCFCFC', 1);
    }
    if (this.estado === 'pausa') { textoCentro(ctx, 'PAUSA', W, Math.floor(H / 2), cor.destaque || '#F8B800', 2); }
    if (this.estado === 'fase_ok') { textoCentro(ctx, (f.nome || 'FASE') + ' OK!', W, Math.floor(H / 2), cor.destaque || '#F8B800', 2); }
  };

  // 👆 APONTAR (BLUEPRINT Fliperama §3 passo 6): o que está neste ponto da tela? (coordenadas do canvas, em px da era)
  Plataforma.prototype.objetoEm = function (sx, sy) {
    if (!this.fase) { return null; }
    var dy = this.alt < this.H ? this.H - this.alt : 0;
    var x = sx + Math.round(this.cam.x), y = sy + Math.round(this.cam.y) - dy, T = this.T;
    var h = this.heroi;
    if (h && x >= h.x && x < h.x + h.w && y >= h.y && y < h.y + h.h) {
      return { tipo: 'heroi', sprite: (this.spec.heroi || {}).sprite, fase: this.faseIdx + 1 };
    }
    for (var k = 0; k < this.objs.length; k++) {
      var o = this.objs[k];
      if (o.vivo && x >= o.x - 2 && x < o.x + o.w + 2 && y >= o.y - 2 && y < o.y + o.h + 2) {
        return { tipo: o.tipo, letra: o.ch, sprite: o.def.sprite, comportamento: o.def.comportamento, fase: this.faseIdx + 1 };
      }
    }
    var ci = Math.floor(x / T), cj = Math.floor(y / T);
    var ch = (this.mapa[cj] || [])[ci];
    if (ch && (this.spec.tiles || {})[ch]) {
      return { tipo: 'bloco', letra: ch, coluna: ci + 1, linha: cj + 1, fase: this.faseIdx + 1 };
    }
    return { tipo: 'ceu', coluna: ci + 1, linha: cj + 1, fase: this.faseIdx + 1 };
  };
  Plataforma.prototype.pausar = function (sim) {
    if (sim && this.estado === 'jogando') { this.estado = 'pausa'; }
    else if (!sim && this.estado === 'pausa') { this.estado = 'jogando'; }
  };

  // 🤖 ROBÔ JOGADOR da plataforma (E3): anda para a direita e pula buraco, parede, degrau e inimigo.
  // `desajeitado` = reage atrasado e erra 15% dos pulos (mede se a fase é difícil demais para uma criança).
  Plataforma.prototype.roboEntrada = function (mem, desajeitado, rng) {
    var h = this.heroi, T = this.T, self = this;
    if (!h || h.morto) { if (!mem.morreu && self.ultimoDano && self.ultimoDano.indexOf('voa') === 0) { mem.morreuVoando = true; } mem.morreu = true; return {}; }
    if (mem.morreu) {                           // voltou: como uma criança, aprende a pular o inimigo mais cedo
      mem.morreu = false; mem.cuidado = 1 + Math.floor(rng() * 4); mem.fila = []; mem.segura = 0;   // tenta outro momento de pular
      mem.maxX = null; mem.recuo = 0; mem.espera = Math.floor(rng() * 45);   // e espera um pouco (os inimigos mudam de lugar)
    }
    if (mem.espera > 0) { mem.espera--; return {}; }
    mem.f = (mem.f || 0) + 1;
    if (mem.maxX == null || h.x > mem.maxX + 1) { mem.maxX = h.x; mem.parado = 0; } else { mem.parado++; }
    var dir = mem.recuo > 0 ? -1 : 1;
    if (mem.recuo > 0) { mem.recuo--; }
    // inimigo que voa e mergulha: se está baixo e perto à frente, recua um pouco; quando sobe, passa por baixo
    var mergulho = this.objs.some(function (o) {
      if (!o.vivo || o.tipo !== 'inimigo' || (String(o.def.comportamento || '').indexOf('voa') !== 0 && !(o.pecas && o.pecas.voa))) { return false; }
      var dx = o.x - (h.x + h.w);
      return dx > -T * 0.5 && dx < T * 2.2 && (o.y + o.h) > h.y - T * 0.8 && o.y < h.y + h.h;
    });
    if (mergulho && h.chao && (!desajeitado || mem.morreuVoando)) { dir = -1; }   // o desajeitado aprende depois de 2 tombos
    if (mem.parado > 240) { mem.recuo = 30; mem.parado = 0; }
    // 0.9: com chefe na tela, vai atrás dele (ele pode ficar para trás)
    for (var cq = 0; cq < this.objs.length; cq++) {
      var ch0 = this.objs[cq];
      if (ch0.vivo && ((ch0.pecas && ch0.pecas.chefe) || (ch0.tipo === 'fim_de_fase' && ch0.x < h.x)) && Math.abs(ch0.x - h.x) < this.W * 0.6) { dir = (ch0.x + ch0.w / 2 > h.x + h.w / 2) ? 1 : -1; mem.parado = 0; mem.recuo = 0; break; }
    }
    var pe = Math.floor((h.y + h.h + 1) / T);
    var frente = dir > 0 ? Math.floor((h.x + h.w + 2) / T) : Math.floor((h.x - 2) / T);
    function solidoEm(i, j) { var t = self.tile(i, j); return !!(t && t.solido); }
    function paredeEm(i, j) { var t = self.tile(i, j); return !!(t && t.solido && !t.plataforma); }
    function chaoBom(i, j) { var t = self.tile(i, j); return !!(t && t.solido && !t.mortal); }   // 0.9: espinho não é chão
    var semChao = !chaoBom(frente, pe) && !chaoBom(frente + dir, pe);
    // 0.9 · plataformas que andam: espera ela chegar perto antes de pular o buraco; em cima dela, espera a terra firme
    var plats = this.objs.filter(function (o) { return o.vivo && o.pecas && o.pecas.plataforma; });
    if (mem.alvoPlat) {                          // no ar indo para uma plataforma: mira o meio dela
      var ap = mem.alvoPlat;
      if (h.chao || !ap.vivo) { mem.alvoPlat = null; }
      else {
        var meioH = h.x + h.w / 2, meioP = ap.x + ap.w / 2, dd = meioP - meioH;
        return { dir: dd > T * 0.4, esq: dd < -T * 0.4, pulo: h.vy < 0 && (mem.segura-- > 0) };
      }
    }
    if (plats.length && !mergulho) {
      var embaixo = null;
      for (var q = 0; q < plats.length; q++) { var o0 = plats[q]; if (h.chao && Math.abs((h.y + h.h) - o0.y) < 3 && h.x + h.w > o0.x && h.x < o0.x + o0.w) { embaixo = o0; } }
      if (embaixo) {
        var col = Math.floor((h.x + h.w / 2) / T), terra = null;
        for (var k = 1; k <= 10 && terra === null; k++) { for (var jj = pe - 4; jj <= pe + 8; jj++) { if (chaoBom(col + k * dir, jj) && !paredeEm(col + k * dir, jj - 1)) { terra = k; break; } } }
        var outra = null;
        plats.forEach(function (o) { if (o !== embaixo && (dir > 0 ? o.x > embaixo.x + embaixo.w - 2 : o.x + o.w < embaixo.x + 2) && Math.abs(o.x - embaixo.x) < T * 6 && o.y > h.y - T * 3) { outra = o; } });
        mem.parado = 0;
        if (terra !== null && terra <= 3) { mem.segura = 20; return { dir: dir > 0, esq: dir < 0, pulo: true }; }
        if (outra) { mem.segura = (h.y + h.h) - outra.y > T ? 20 : 8; mem.alvoPlat = outra; return { dir: dir > 0, esq: dir < 0, pulo: true }; }
        var dc = (embaixo.x + embaixo.w / 2) - (h.x + h.w / 2);   // espera no meio da plataforma
        return { dir: dc > T * 0.3, esq: dc < -T * 0.3 };
      }
      if (semChao && h.chao) {
        var perto = plats.some(function (o) {
          var dx = dir > 0 ? o.x - (h.x + h.w) : h.x - (o.x + o.w);
          return dx > -T * 0.5 && dx < T * 2.2 && o.y > h.y - T * 3 && o.y < h.y + h.h + T * 3;
        });
        var vindo = plats.some(function (o) { var dx = dir > 0 ? o.x - (h.x + h.w) : h.x - (o.x + o.w); return dx > -T * 2 && dx < T * 10; });
        if (vindo && !perto && (mem.esperaPlat || 0) < 400) { mem.esperaPlat = (mem.esperaPlat || 0) + 1; mem.parado = 0; return {}; }
        if (perto) {
          var alvoP = null;
          plats.forEach(function (o) { var dx = dir > 0 ? o.x - (h.x + h.w) : h.x - (o.x + o.w); if (dx > -T * 0.5 && dx < T * 2.2 && (!alvoP || Math.abs(dx) < Math.abs(alvoP.dx))) { alvoP = { o: o, dx: dx }; } });
          var sobe = alvoP ? ((h.y + h.h) - alvoP.o.y) / T : 2;
          mem.esperaPlat = 0; mem.segura = sobe > 2.5 ? 22 : (sobe > 1 ? 12 : 6); mem.alvoPlat = alvoP ? alvoP.o : null;
          return { dir: dir > 0, esq: dir < 0, pulo: true };
        }
      }
    }
    var parede = paredeEm(frente, Math.floor((h.y + h.h - 1) / T)) || paredeEm(frente, Math.floor(h.y / T));
    var inimigo = this.objs.some(function (o) {
      if (!o.vivo || o.tipo !== 'inimigo') { return false; }
      if (o.pecas && o.pecas.plataforma) { return false; }
      var dx = dir > 0 ? o.x - (h.x + h.w) : h.x - (o.x + o.w);
      var mais = o.pecas && o.pecas.espinho ? -0.5 : (o.pecas && o.pecas.gigante ? 1.2 : 0);   // espinho: pula mais perto (o alto do pulo fica em cima dele)
      return dx > -2 && dx < T * (2.5 + mais + (desajeitado ? 0.6 : 0.3) * (mem.cuidado || 0)) && Math.abs((o.y + o.h) - (h.y + h.h)) < T * 2 + (o.esc > 1 ? o.h : 0);
    });
    // inimigo voando por cima do caminho do salto: espera ele passar (no chão, antes de pular buraco ou parede)
    var noAr = this.objs.some(function (o) {
      if (!o.vivo || o.tipo !== 'inimigo') { return false; }
      var dx = dir > 0 ? o.x - h.x : h.x - o.x;
      return dx > -T && dx < T * 5 && (o.y + o.h) <= h.y + 2 && h.y - (o.y + o.h) < T * 5;
    });
    if (h.chao && noAr && (semChao || parede) && (mem.aguardou || 0) < 150) { mem.aguardou = (mem.aguardou || 0) + 1; return {}; }
    if (!noAr) { mem.aguardou = 0; }
    var querPular = semChao || parede || inimigo || mem.parado > 60;
    if (desajeitado) {                         // reage 6 quadros depois e erra às vezes
      mem.fila = mem.fila || [];
      mem.fila.push(querPular);
      var atraso = Math.max(1, 6 - 2 * (mem.cuidado || 0));   // depois de um tombo, presta mais atenção
      while (mem.fila.length > atraso + 1) { mem.fila.shift(); }
      querPular = mem.fila.length > atraso ? mem.fila.shift() : false;
      if (querPular && rng() < 0.15) { querPular = false; }
    }
    if (h.chao && querPular) { mem.segura = 22; }
    var pulo = false;
    if (mem.segura > 0) { mem.segura--; pulo = true; }
    // pulo duplo: no ar, caindo, sem chão à frente → solta e aperta de novo
    // (0.4.0) só gasta o 2º pulo sobre um POÇO de verdade: nada sólido embaixo até o fundo da fase
    function poco(i) { for (var jj = Math.max(0, pe); jj < self.linhas; jj++) { if (solidoEm(i, jj)) { return false; } } return true; }
    var sobrePoco = poco(Math.floor((h.x + h.w / 2) / T)) && poco(frente);
    if (!h.chao && h.vy > 0.5 && this.duplo && h.pulosAr < 1 && (sobrePoco || parede) && !mem.duploUsado) {
      if (mem.soltou) { pulo = true; mem.duploUsado = true; mem.segura = 14; } else { pulo = false; mem.soltou = true; }
    }
    if (h.chao) { mem.duploUsado = false; mem.soltou = false; }
    // 0.9: no chão segurando o pulo há 3 quadros = o pulo já foi (ou bateu na cabeça): solta para poder pular de novo
    mem.chaoPulo = h.chao && pulo ? (mem.chaoPulo || 0) + 1 : 0;
    if (mem.chaoPulo > 3) { pulo = false; mem.segura = 0; mem.chaoPulo = 0; }
    return { dir: dir > 0, esq: dir < 0, pulo: pulo };
  };

  // ═══════════════════════════ E4 · os outros gêneros (24/10/2026) ═══════════════════════════
  // Todos herdam da BASE: estados (título, pausa, fase ok, fim, vitória), HUD, mapa por legenda, sprites, câmera,
  // 👆 apontar e o laço de vidas. Cada gênero só escreve: montarFase, passo, desenharMundo e roboEntrada.
  // ES5 de propósito: o modo TV roda em navegador de televisão.
  function Base(spec, perfil, sprites, som, semente) {
    this.spec = spec; this.perfil = perfil; this.sprites = sprites; this.som = som;
    this.T = perfil.tile; this.W = perfil.w; this.H = perfil.h; this.esc = this.T / 8;
    this.semente = semente || 1; this.rng = mulberry32(this.semente);
    var her = spec.heroi || {};
    this.vel = clamp(her.velocidade == null ? 1 : her.velocidade, 0.4, 3);
    this.vidasIniciais = clamp(her.vidas || 3, 1, 9);
    this.estado = 'titulo'; this.faseIdx = 0; this.pontos = 0; this.vidas = this.vidasIniciais;
    this.quadro = 0; this.morto = 0; this.cam = { x: 0, y: 0 }; this.objs = []; this.mapa = []; this.linhas = 0; this.colunas = 0;
    this.larg = this.W; this.alt = this.H; this.fase = {};
    var hs = sprites[her.sprite] || { w: this.T, h: this.T };
    this.heroi = { x: 0, y: 0, w: hs.w, h: hs.h, invuln: 0, poder: null };
  }
  Base.prototype.dicas = 'SETAS MOVEM  ESPACO OU OK  M SOM';
  Base.prototype.lerMapa = function (f) {
    var T = this.T, ents = this.spec.entidades || {}, tiles = this.spec.tiles || {}, self = this;
    this.mapa = (f.mapa || []).map(function (r) { return String(r).split(''); });
    this.linhas = this.mapa.length;
    this.colunas = this.linhas ? Math.max.apply(null, this.mapa.map(function (r) { return r.length; })) : 0;
    this.larg = this.colunas * T; this.alt = this.linhas * T;
    this.objs = []; this.inicio = { i: 0, j: Math.max(0, this.linhas - 1), x: 0, y: Math.max(0, this.linhas - 1) * T };
    for (var j = 0; j < this.linhas; j++) {
      for (var i = 0; i < this.mapa[j].length; i++) {
        var ch = this.mapa[j][i];
        if (ch === '@') { this.inicio = { i: i, j: j, x: i * T, y: j * T }; this.mapa[j][i] = '.'; continue; }
        var e = ents[ch];
        if (e) {
          var sp = this.sprites[e.sprite] || { w: T, h: T };
          this.objs.push({ tipo: e.tipo, def: e, ch: ch, i: i, j: j, x: i * T + (T - sp.w) / 2, y: j * T + (T - sp.h) / 2,
                           w: sp.w, h: sp.h, x0: i * T + (T - sp.w) / 2, y0: j * T + (T - sp.h) / 2, vx: 0, vy: 0,
                           vivo: true, t: Math.floor(self.rng() * 60) });
          this.mapa[j][i] = '.';
        } else if (!tiles[ch]) { this.mapa[j][i] = '.'; }
      }
    }
  };
  Base.prototype.carregarFase = function (idx) {
    this.faseIdx = idx; this.fase = (this.spec.fases || [])[idx] || {}; this.morto = 0; this.tiros = []; this.tirosInim = []; this.msgFase = null;
    this.heroi.invuln = 0; this.heroi.poder = null;
    this.montarFase(this.fase);
    if (this.som.definirPele) { this.som.definirPele(this.fase.estilo || this.spec.estilo || 'pixel'); }
    this.som.fundo = this.fase.musica;
    this.som.musica(this.fase.musica);
  };
  Base.prototype.montarFase = function (f) { this.lerMapa(f); };
  Base.prototype.tile = function (i, j) {
    if (i < 0 || j < 0 || i >= this.colunas || j >= this.linhas) { return this.foraSolido === false ? null : { solido: true, borda_mundo: true }; }
    return (this.spec.tiles || {})[this.mapa[j][i]] || null;
  };
  Base.prototype.solidoEm = function (px, py) { var t = this.tile(Math.floor(px / this.T), Math.floor(py / this.T)); return !!(t && t.solido); };
  Base.prototype.caixaBate = function (x, y, w, h) {   // algum bloco sólido dentro da caixa?
    var T = this.T, i0 = Math.floor(x / T), i1 = Math.floor((x + w - 0.01) / T), j0 = Math.floor(y / T), j1 = Math.floor((y + h - 0.01) / T);
    for (var j = j0; j <= j1; j++) { for (var i = i0; i <= i1; i++) { var t = this.tile(i, j); if (t && t.solido) { return { i: i, j: j, t: t }; } } }
    return null;
  };
  Base.prototype.quebrar = function (i, j) {
    var t = this.tile(i, j);
    if (t && t.quebravel && !t.borda_mundo) { this.mapa[j][i] = '.'; this.pontos += t.pontos || 50; this.som.efeito('pisao'); return true; }
    return false;
  };
  function bate(a, b, folga) { folga = folga || 0; return a.x + folga < b.x + b.w && a.x + a.w - folga > b.x && a.y + folga < b.y + b.h && a.y + a.h - folga > b.y; }
  Base.prototype.atualizar = function (inp) {
    if (this.estado === 'construir') { this.quadro++; return; }   // 🏗 Estúdio de Fases
    if (this.lento && this.estado === 'jogando') { this.lentoT = (this.lentoT || 0) + 1; if (this.lentoT % 3) { return; } }   // 🐢 câmera lenta
    this.quadro++;
    if (inp.apertou('mudo')) { this.som.alternarMudo(); }
    if (this.estado === 'titulo' || this.estado === 'fim_jogo' || this.estado === 'vitoria') {
      if (inp.apertou('start') || inp.apertou('pulo')) {
        this.som.ligar(); this.quadro = 0; this.rng = mulberry32(this.semente);   // partida nova = mesmo começo (replay do placar)
        this.pontos = 0; this.vidas = this.vidasIniciais; this.carregarFase(0); this.estado = 'jogando';
      }
      return;
    }
    if (this.estado === 'pausa') { if (inp.apertou('pausa') || inp.apertou('start') || inp.apertou('pulo')) { this.estado = 'jogando'; } return; }
    if (this.estado === 'fase_ok') {
      if (--this.espera <= 0) {
        if (this.faseIdx + 1 >= this.numFases(this.spec)) {
          this.estado = 'vitoria'; this.som.parar(); this.som.efeito('fim');
          if (this.evento) { this.evento('venceu_jogo', { pontos: this.pontos }); }
        } else { this.carregarFase(this.faseIdx + 1); this.estado = 'jogando'; }
      }
      return;
    }
    if (inp.apertou('pausa')) { this.estado = 'pausa'; return; }
    if (this.morto) {
      if (--this.morto <= 0) {
        if (this.vidas <= 0) { this.estado = 'fim_jogo'; this.som.parar(); if (this.evento) { this.evento('perdeu', { pontos: this.pontos }); } return; }
        this.renascer();
      }
      return;
    }
    if (this.heroi.invuln) { this.heroi.invuln--; }
    this.passo(inp);
    gravarRastro(this);
  };
  Base.prototype.numFases = function (spec) { return (spec.fases || []).length; };
  Base.prototype.renascer = function () { this.carregarFase(this.faseIdx); };
  Base.prototype.ferir = function (por) {
    if (this.morto || this.estado !== 'jogando' || this.heroi.invuln) { return; }
    if (this.heroi.poder === 'escudo' || this.heroi.poder === 'capacete') { this.heroi.poder = null; this.heroi.invuln = 90; this.som.efeito('dano'); return; }
    this.ultimoDano = por || '?'; this.vidas--; this.morto = 70; this.som.parar(); this.som.efeito('dano'); marcarQueda(this);
    if (this.evento) { this.evento('dano', { jogador: this.quemApanhou || 1 }); }
  };
  Base.prototype.concluirFase = function () {
    if (this.estado !== 'jogando') { return; }
    this.estado = 'fase_ok'; this.espera = 120; this.som.parar(); this.som.efeito('fim');
    if (this.evento) { this.evento('terminou_fase', { fase: this.faseIdx + 1 }); }
  };
  Base.prototype.desenharSprite = function (ctx, nome, x, y, quadro, virar) {
    var s = this.sprites[nome];
    if (!s || !s.quadros.length) { ctx.fillStyle = '#FF00FF'; ctx.fillRect(x, y, this.T, this.T); return; }
    var q = s.quadros[quadro % s.quadros.length];
    if (virar) { ctx.save(); ctx.translate(x + s.w, y); ctx.scale(-1, 1); ctx.drawImage(q, 0, 0); ctx.restore(); }
    else { ctx.drawImage(q, x, y); }
  };
  Base.prototype.seguir = function (cx, cy) {   // câmera: segue um ponto; mapa menor que a tela fica centrado/ancorado embaixo
    var W = this.W, H = this.H;
    this.cam.x = this.larg <= W ? -Math.floor((W - this.larg) / 2) : clamp(cx - W / 2, 0, this.larg - W);
    this.cam.y = this.alt <= H ? -(H - this.alt) : clamp(cy - H / 2, 0, this.alt - H);
  };
  Base.prototype.desenharTiles = function (ctx) {
    var T = this.T, tiles = this.spec.tiles || {}, cx = this.cam.x, cy = this.cam.y;
    var i0 = Math.max(0, Math.floor(cx / T)), i1 = Math.min(this.colunas - 1, Math.floor((cx + this.W) / T));
    var j0 = Math.max(0, Math.floor(cy / T)), j1 = Math.min(this.linhas - 1, Math.floor((cy + this.H) / T));
    for (var j = j0; j <= j1; j++) {
      for (var i = i0; i <= i1; i++) {
        var td = tiles[this.mapa[j][i]];
        if (!td) { continue; }
        if (td.sprite && this.sprites[td.sprite]) { this.desenharSprite(ctx, td.sprite, i * T, j * T, 0, false); continue; }
        ctx.fillStyle = td.cor || '#888888'; ctx.fillRect(i * T, j * T, T, T);
        if (td.borda) { ctx.fillStyle = td.borda; ctx.fillRect(i * T, j * T, T, Math.max(1, T >> 3)); }
      }
    }
  };
  Base.prototype.desenharObjs = function (ctx, filtro) {
    var self = this;
    this.objs.forEach(function (o) {
      if (!o.vivo || (filtro && !filtro(o))) { return; }
      var q = (o.tipo === 'inimigo') ? (o.t >> 3) : (o.t >> 4);
      self.desenharObj(ctx, o, q, o.vx > 0);
    });
  };
  // 🃏 personagem com cartas pode ficar gigante (escala) e dar pulinho (vistos de cima não têm gravidade)
  Base.prototype.desenharObj = function (ctx, o, q, virar, nome) {
    var x = Math.round(o.x), y = Math.round(o.y) + Cartas.pulinhoY(o), n = nome || o.def.sprite;
    if (o.esc && o.esc !== 1) { ctx.save(); ctx.translate(x, y); ctx.scale(o.esc, o.esc); this.desenharSprite(ctx, n, 0, 0, q, virar); ctx.restore(); return; }
    this.desenharSprite(ctx, n, x, y, q, virar);
  };
  // 🃏 cartas nos gêneros da casa: o mesmo laço para todos (cada gênero só diz como o corpo anda)
  Base.prototype.cartaDano = function (o) { this.ferir('cartas:' + o.ch); };
  Base.prototype.cartaExplode = function (o) { if (!o.vivo) { return; } o.vivo = false; this.pontos += o.def.pontos || 100; this.som.efeito('pisao'); };
  Base.prototype.desenharHeroi = function (ctx, virar) {
    var h = this.heroi, her = this.spec.heroi || {};
    if (this.morto && (this.quadro >> 2) % 2) { return; }
    if (h.invuln && (this.quadro >> 2) % 2) { return; }
    var nome = h.poder && her.sprite_poder ? her.sprite_poder : her.sprite;
    this.desenharSprite(ctx, nome, Math.round(h.x), Math.round(h.y), h.anda ? (this.quadro >> 3) : 0, virar);
  };
  Base.prototype.desenharTiros = function (ctx) {
    var cor = this.spec.cores || {}, T = this.T;
    ctx.fillStyle = cor.destaque || '#F8B800';
    (this.tiros || []).forEach(function (b) { ctx.fillRect(Math.round(b.x), Math.round(b.y), b.w, b.h); });
    ctx.fillStyle = cor.texto || '#FCFCFC';
    (this.tirosInim || []).forEach(function (b) { ctx.fillRect(Math.round(b.x), Math.round(b.y), b.w, b.h); });
  };
  Base.prototype.hud = function (ctx) {
    var cor = this.spec.cores || {}, tinta = cor.texto || '#FCFCFC', W = this.W;
    texto(ctx, 'VIDAS ' + Math.max(0, this.vidas), 4, 2, tinta, 1);
    var p = 'PONTOS ' + this.pontos; texto(ctx, p, W - larguraTexto(p, 1) - 4, 2, tinta, 1);
    textoCentro(ctx, this.textoMeio ? this.textoMeio() : 'FASE ' + (this.faseIdx + 1), W, 2, tinta, 1);
  };
  Base.prototype.desenhar = function (ctx) {
    var W = this.W, H = this.H, spec = this.spec, cor = spec.cores || {};
    var tinta = cor.texto || '#FCFCFC', fundo = cor.fundo || '#000000', dest = cor.destaque || '#F8B800';
    if (this.estado === 'titulo') {
      ctx.fillStyle = fundo; ctx.fillRect(0, 0, W, H);
      textoCentro(ctx, spec.titulo || 'MEU JOGO', W, Math.floor(H * 0.3), dest, 2);
      if (spec.textos && spec.textos.subtitulo) { textoCentro(ctx, spec.textos.subtitulo, W, Math.floor(H * 0.3) + 18, tinta, 1); }
      var hs = this.sprites[(spec.heroi || {}).sprite];
      if (hs) { this.desenharSprite(ctx, spec.heroi.sprite, Math.floor((W - hs.w) / 2), Math.floor(H * 0.47), this.quadro >> 4, false); }
      if ((this.quadro >> 5) % 2 === 0) { textoCentro(ctx, 'APERTE ESPACO OU OK', W, Math.floor(H * 0.68), tinta, 1); }
      textoCentro(ctx, this.dicas, W, H - 14, cor.apagado || '#7C7C7C', 1);
      desenharRecorde(ctx, this, W, H);
      return;
    }
    if (this.estado === 'fim_jogo' || this.estado === 'vitoria') {
      ctx.fillStyle = fundo; ctx.fillRect(0, 0, W, H);
      var msg = this.estado === 'vitoria' ? ((spec.textos && spec.textos.vitoria) || 'VOCE VENCEU!') : 'FIM DE JOGO';
      textoCentro(ctx, msg, W, Math.floor(H * 0.35), dest, 2);
      textoCentro(ctx, 'PONTOS ' + this.pontos, W, Math.floor(H * 0.35) + 22, tinta, 1);
      if (this.placarMsg) { textoCentro(ctx, this.placarMsg, W, Math.floor(H * 0.35) + 34, cor.destaque || '#F8B800', 1); }
      if ((this.quadro >> 5) % 2 === 0) { textoCentro(ctx, 'APERTE ESPACO OU OK', W, Math.floor(H * 0.65), tinta, 1); }
      return;
    }
    ctx.fillStyle = this.fase.ceu || fundo; ctx.fillRect(0, 0, W, H);
    ctx.save(); ctx.translate(-Math.round(this.cam.x), -Math.round(this.cam.y));
    this.desenharMundo(ctx);
    ctx.restore();
    if (this.estado === 'construir') { return; }
    this.hud(ctx);
    if (this.desenharTela) { this.desenharTela(ctx); }
    if (this.estado === 'pausa') { textoCentro(ctx, 'PAUSA', W, Math.floor(H / 2), dest, 2); }
    if (this.estado === 'fase_ok') { textoCentro(ctx, this.msgFase || ((this.fase.nome || 'FASE') + ' OK!'), W, Math.floor(H / 2), dest, 2); }
  };
  Base.prototype.objetoEm = function (sx, sy) {
    var x = sx + Math.round(this.cam.x), y = sy + Math.round(this.cam.y), T = this.T, h = this.heroi, f = this.faseIdx + 1;
    if (h && x >= h.x && x < h.x + h.w && y >= h.y && y < h.y + h.h) { return { tipo: 'heroi', sprite: (this.spec.heroi || {}).sprite, fase: f }; }
    for (var k = 0; k < this.objs.length; k++) {
      var o = this.objs[k];
      if (o.vivo && x >= o.x - 2 && x < o.x + o.w + 2 && y >= o.y - 2 && y < o.y + o.h + 2) {
        return { tipo: o.tipo, letra: o.ch, sprite: o.def.sprite, comportamento: o.def.comportamento, fase: f };
      }
    }
    var ci = Math.floor(x / T), cj = Math.floor(y / T), ch = (this.mapa[cj] || [])[ci];
    if (ch && (this.spec.tiles || {})[ch]) { return { tipo: 'bloco', letra: ch, coluna: ci + 1, linha: cj + 1, fase: f }; }
    return { tipo: 'ceu', coluna: ci + 1, linha: cj + 1, fase: f };
  };
  Base.prototype.pausar = Plataforma.prototype.pausar;
  function herdar(F, dicas) { F.prototype = Object.create(Base.prototype); F.prototype.constructor = F; F.prototype.dicas = dicas; return F; }
  function apertouDir(inp) {
    if (inp.apertou('esq')) { return [-1, 0]; } if (inp.apertou('dir')) { return [1, 0]; }
    if (inp.apertou('cima')) { return [0, -1]; } if (inp.apertou('baixo')) { return [0, 1]; }
    return null;
  }
  function dirSegurada(inp) {
    if (inp.esq) { return [-1, 0]; } if (inp.dir) { return [1, 0]; } if (inp.cima) { return [0, -1]; } if (inp.baixo) { return [0, 1]; }
    return null;
  }
  function entradaDeDir(d) { return d ? { esq: d[0] < 0, dir: d[0] > 0, cima: d[1] < 0, baixo: d[1] > 0 } : {}; }
  var DIRS4 = [[1, 0], [-1, 0], [0, -1], [0, 1]];

  // ───────────────────────── 🟡 LABIRINTO: pegue tudo, fuja dos fantasmas, o poder vira o jogo ─────────────────────────
  var Labirinto = herdar(function Labirinto(spec, perfil, sprites, som, semente) { Base.call(this, spec, perfil, sprites, som, semente); },
                         'SETAS ANDAM  PEGUE TUDO  M SOM');
  Labirinto.prototype.tempoMax = 180;
  Labirinto.prototype.livre = function (i, j) { var t = this.tile(i, j); return !(t && t.solido); };
  Labirinto.prototype.montarFase = function (f) {
    this.lerMapa(f);
    var self = this, T = this.T, h = this.heroi;
    h.ci = this.inicio.i; h.cj = this.inicio.j; h.dir = [0, 0]; h.p = 0; h.quer = null; h.olhando = 1;
    this.passoHeroi = 0.11 * this.vel;
    this.inims = this.objs.filter(function (o) { return o.tipo === 'inimigo'; });
    this.inims.forEach(function (o) { o.ci = o.i; o.cj = o.j; o.dir = [0, 0]; o.p = 0; o.volta = 60 + Math.floor(self.rng() * 60); });
    this.restantes = this.objs.filter(function (o) { return o.tipo === 'coletavel'; }).length;
    this.assusta = 0;
    this.posicionar(h); this.inims.forEach(function (o) { self.posicionar(o); });
    this.seguir(h.x, h.y);
  };
  Labirinto.prototype.renascer = function () {
    var self = this, h = this.heroi;
    h.ci = this.inicio.i; h.cj = this.inicio.j; h.dir = [0, 0]; h.p = 0; h.quer = null; this.assusta = 0;
    this.inims.forEach(function (o) { o.ci = o.i; o.cj = o.j; o.dir = [0, 0]; o.p = 0; o.volta = 60; self.posicionar(o); });
    this.posicionar(h);
  };
  Labirinto.prototype.posicionar = function (c) {
    var T = this.T;
    c.x = (c.ci + c.dir[0] * c.p) * T + (T - c.w) / 2; c.y = (c.cj + c.dir[1] * c.p) * T + (T - c.h) / 2;
  };
  Labirinto.prototype.andar = function (c, quer, v) {
    if (c.p === 0) {
      if (quer && this.livre(c.ci + quer[0], c.cj + quer[1])) { c.dir = quer; }
      else if (!this.livre(c.ci + c.dir[0], c.cj + c.dir[1])) { c.dir = [0, 0]; }
    } else if (quer && quer[0] === -c.dir[0] && quer[1] === -c.dir[1]) {   // meia-volta no meio do caminho
      c.ci += c.dir[0]; c.cj += c.dir[1]; c.p = 1 - c.p; c.dir = quer;
    }
    if (c.dir[0] || c.dir[1]) { c.p += v; if (c.p >= 1) { c.ci += c.dir[0]; c.cj += c.dir[1]; c.p = 0; } }
    this.posicionar(c);
  };
  Labirinto.prototype.escolherInim = function (o) {
    var h = this.heroi, self = this, rev = [-o.dir[0], -o.dir[1]];
    var ops = DIRS4.filter(function (d) { return self.livre(o.ci + d[0], o.cj + d[1]) && !(d[0] === rev[0] && d[1] === rev[1]); });
    if (!ops.length) { ops = DIRS4.filter(function (d) { return self.livre(o.ci + d[0], o.cj + d[1]); }); }
    if (!ops.length) { return [0, 0]; }
    var c = o.def.comportamento || 'patrulha';
    if (c === 'persegue' || this.assusta > 0) {
      if (this.assusta <= 0 && this.rng() < 0.15) { return ops[Math.floor(this.rng() * ops.length)]; }
      var sinal = this.assusta > 0 ? -1 : 1;
      ops.sort(function (a, b) {
        var da = Math.pow(o.ci + a[0] - h.ci, 2) + Math.pow(o.cj + a[1] - h.cj, 2), db = Math.pow(o.ci + b[0] - h.ci, 2) + Math.pow(o.cj + b[1] - h.cj, 2);
        return sinal * (da - db);
      });
      return ops[0];
    }
    return ops[Math.floor(this.rng() * ops.length)];
  };
  Labirinto.prototype.passo = function (inp) {
    var h = this.heroi, self = this, T = this.T;
    var q = dirSegurada(inp); if (q) { h.quer = q; }
    this.andar(h, h.quer, this.passoHeroi);
    h.anda = !!(h.dir[0] || h.dir[1]); if (h.dir[0]) { h.olhando = h.dir[0]; }
    if (this.assusta > 0) { this.assusta--; }
    this.inims.forEach(function (o) {
      if (!o.vivo) { return; }
      o.t++;
      if (o.volta > 0) { o.volta--; return; }
      if (Cartas.tem(o)) { Cartas.passo(self, o); return; }
      if ((o.def.comportamento || '') === 'parado') { return; }
      if (o.p === 0) { o.dir = self.escolherInim(o); }
      self.andar(o, null, clamp(o.def.velocidade || 0.6, 0.1, 3) * 0.1 * (self.assusta > 0 ? 0.55 : 1));
    });
    var caixa = { x: h.x + 1, y: h.y + 1, w: h.w - 2, h: h.h - 2 };
    for (var k = 0; k < this.objs.length; k++) {
      var o = this.objs[k];
      if (!o.vivo || !bate(caixa, o, o.tipo === 'inimigo' ? T * 0.2 : 0)) { continue; }
      if (o.tipo === 'coletavel') { o.vivo = false; this.restantes--; this.pontos += o.def.pontos || 10; this.som.efeito('moeda'); }
      else if (o.tipo === 'poder') { o.vivo = false; this.assusta = 420; this.pontos += 50; this.som.efeito('poder'); }
      else if (o.tipo === 'fim_de_fase') { if (this.restantes <= 0) { this.concluirFase(); return; } }
      else if (o.tipo === 'inimigo' && Cartas.tem(o)) {
        if (this.assusta > 0) { if (!Cartas.atingido(this, o, 'poder')) { this.pontos += o.def.pontos || 200; this.som.efeito('pisao'); o.ci = o.i; o.cj = o.j; o.p = 0; o.dir = [0, 0]; o.volta = 150; this.posicionar(o); } }
        else { Cartas.encostou(this, o); if (this.morto) { return; } }
      }
      else if (o.tipo === 'inimigo') {
        if (this.assusta > 0) { this.pontos += o.def.pontos || 200; this.som.efeito('pisao'); o.ci = o.i; o.cj = o.j; o.p = 0; o.dir = [0, 0]; o.volta = 150; this.posicionar(o); }
        else { this.ferir(o.def.comportamento || 'persegue'); return; }
      }
    }
    Cartas.tirosBase(this);
    if (this.morto) { return; }
    if (this.restantes <= 0 && !this.objs.some(function (o) { return o.tipo === 'fim_de_fase'; })) { this.concluirFase(); }
    this.seguir(h.x, h.y);
  };
  // 🃏 no labirinto as cartas andam pela grade: escolhem o caminho no meio de cada casa
  Labirinto.prototype.cartaDirInicial = function () { return [-1, 0]; };
  Labirinto.prototype.cartaVel = function (o) { return clamp(o.def.velocidade || 0.6, 0.1, 3) * 0.1 * (this.assusta > 0 ? 0.55 : 1); };
  Labirinto.prototype.cartaMover = function (o, dx, dy, v) {
    var cv = o.cv, res = {}, self = this, h = this.heroi;
    if (cv.modo === 'para') { return res; }
    if (o.p === 0) {
      var rev = [-o.dir[0], -o.dir[1]];
      var livres = DIRS4.filter(function (d) { return self.livre(o.ci + d[0], o.cj + d[1]); });
      var ops = livres.filter(function (d) { return !(d[0] === rev[0] && d[1] === rev[1]) || !(o.dir[0] || o.dir[1]); });
      if (!ops.length) { ops = livres; }
      var quer = null;
      if (cv.modo === 'persegue' || cv.modo === 'foge') {
        var sinal = cv.modo === 'foge' ? -1 : 1;
        ops.sort(function (a, b) {
          var da = Math.pow(o.ci + a[0] - h.ci, 2) + Math.pow(o.cj + a[1] - h.cj, 2), db = Math.pow(o.ci + b[0] - h.ci, 2) + Math.pow(o.cj + b[1] - h.cj, 2);
          return sinal * (da - db);
        });
        quer = ops[0] || null;
      } else if (cv.modo === 'sorteio') { quer = ops.length ? ops[Math.floor(this.rng() * ops.length)] : null; }
      else { quer = [cv.dx, cv.dy]; if (!this.livre(o.ci + quer[0], o.cj + quer[1])) { res.parede = true; quer = null; } }
      o.dir = quer || [0, 0];
      if (quer && cv.modo !== 'anda') { cv.dx = quer[0]; cv.dy = quer[1]; }
    }
    this.andar(o, null, v);
    o.vx = o.dir[0];
    return res;
  };
  Labirinto.prototype.textoMeio = function () { return this.restantes > 0 ? 'FALTAM ' + this.restantes : 'VA PARA A SAIDA'; };
  Labirinto.prototype.desenharMundo = function (ctx) {
    var self = this;
    this.desenharTiles(ctx);
    this.desenharObjs(ctx, function (o) { return o.tipo !== 'inimigo'; });
    this.inims.forEach(function (o) {
      if (!o.vivo) { return; }
      if (self.assusta > 0 && (self.assusta > 90 || (self.quadro >> 3) % 2)) { ctx.globalAlpha = 0.45; }
      self.desenharObj(ctx, o, o.t >> 3, o.dir[0] > 0);
      ctx.globalAlpha = 1;
    });
    this.desenharHeroi(ctx, this.heroi.olhando < 0);
  };
  // 🤖 caminho mais curto (BFS) até o item mais perto, fugindo das casas perto dos inimigos
  Labirinto.prototype.roboEntrada = function (mem, desajeitado, rng) {
    var h = this.heroi, self = this;
    if (this.morto) { return {}; }
    if (h.p !== 0 && mem.ult) { return mem.ult; }
    var perigo = {}, raio = 1;
    if (this.assusta <= 30) {
      this.inims.forEach(function (o) {
        if (!o.vivo) { return; }
        for (var a = -raio; a <= raio; a++) { for (var b = -raio; b <= raio; b++) { if (Math.abs(a) + Math.abs(b) <= raio) { perigo[(o.ci + a) + ',' + (o.cj + b)] = 1; perigo[(o.ci + o.dir[0] + a) + ',' + (o.cj + o.dir[1] + b)] = 1; } } }
      });
    }
    var alvos = {};
    this.objs.forEach(function (o) {
      if (!o.vivo) { return; }
      if (o.tipo === 'coletavel' || o.tipo === 'poder' || (o.tipo === 'fim_de_fase' && self.restantes <= 0) || (o.tipo === 'inimigo' && self.assusta > 60)) { alvos[(o.ci != null ? o.ci : o.i) + ',' + (o.cj != null ? o.cj : o.j)] = 1; }
    });
    function bfs(evitar) {
      var ini = h.ci + ',' + h.cj, vis = {}, fila = [[h.ci, h.cj, null]]; vis[ini] = 1;
      while (fila.length) {
        var c = fila.shift();
        if (alvos[c[0] + ',' + c[1]] && c[2]) { return c[2]; }
        for (var k = 0; k < 4; k++) {
          var d = DIRS4[k], ni = c[0] + d[0], nj = c[1] + d[1], key = ni + ',' + nj;
          if (vis[key] || !self.livre(ni, nj) || (evitar && perigo[key])) { continue; }
          vis[key] = 1; fila.push([ni, nj, c[2] || d]);
        }
      }
      return null;
    }
    var d = bfs(true);
    if (!d) {   // sem caminho seguro: foge para a casa livre mais longe dos inimigos
      var melhor = null, nota = -1;
      DIRS4.forEach(function (dd) {
        if (!self.livre(h.ci + dd[0], h.cj + dd[1])) { return; }
        var n = Math.min.apply(null, self.inims.filter(function (o) { return o.vivo; }).map(function (o) { return Math.abs(o.ci - h.ci - dd[0]) + Math.abs(o.cj - h.cj - dd[1]); }).concat([99]));
        if (n > nota) { nota = n; melhor = dd; }
      });
      d = (this.assusta > 30 ? bfs(false) : null) || melhor || bfs(false);
    }
    if (desajeitado && rng() < 0.1) { d = DIRS4[Math.floor(rng() * 4)]; }
    mem.ult = entradaDeDir(d);
    return mem.ult;
  };

  // ───────────────────────── 🧱 QUEBRA-BLOCOS ─────────────────────────
  var QuebraBlocos = herdar(function QuebraBlocos(spec, perfil, sprites, som, semente) { Base.call(this, spec, perfil, sprites, som, semente); },
                            'SETAS MOVEM  ESPACO LANCA  M SOM');
  QuebraBlocos.prototype.tempoMax = 180;
  QuebraBlocos.prototype.tile = function (i, j) { if (j >= this.linhas) { return null; } return Base.prototype.tile.call(this, i, j); };
  QuebraBlocos.prototype.montarFase = function (f) {
    this.lerMapa(f);
    var T = this.T, tiles = this.spec.tiles || {}, n = 0, self = this;
    this.mapa.forEach(function (r) { r.forEach(function (ch) { if (tiles[ch] && tiles[ch].quebravel) { n++; } }); });
    this.restantes = n;
    var larg = clamp((this.spec.heroi || {}).largura || 3, 2, 6) * T;
    this.raquete = { x: this.inicio.x + T / 2 - larg / 2, y: this.inicio.y + T - Math.max(2, T >> 2) - 1, w: larg, h: Math.max(2, T >> 2), base: larg, grande: 0 };
    this.velBola = Math.max(1.5 * this.esc, this.H / 100) * (1 + 0.12 * this.faseIdx) * clamp(this.vel, 0.6, 2);   // tela alta = bola mais rápida
    this.renascer();
  };
  QuebraBlocos.prototype.renascer = function () {
    var s = Math.max(2, this.T >> 2);
    this.bola = { x: 0, y: 0, w: s, h: s, vx: 0, vy: 0, presa: 90 };
    this.raquete.w = this.raquete.base; this.raquete.grande = 0;
    this.prender(); this.seguir(this.larg / 2, this.alt / 2);
  };
  QuebraBlocos.prototype.prender = function () { var r = this.raquete, b = this.bola; b.x = r.x + r.w / 2 - b.w / 2; b.y = r.y - b.h - 1; };
  QuebraBlocos.prototype.passo = function (inp) {
    var r = this.raquete, b = this.bola, T = this.T, vr = 2.4 * this.esc * clamp(this.vel, 0.6, 2);
    if (inp.esq) { r.x -= vr; } if (inp.dir) { r.x += vr; }
    r.x = clamp(r.x, 0, this.larg - r.w);
    this.heroi.x = r.x; this.heroi.y = r.y; this.heroi.w = r.w; this.heroi.h = r.h;
    if (r.grande > 0 && --r.grande === 0) { r.x += (r.w - r.base) / 2; r.w = r.base; }
    if (b.presa) {
      this.prender();
      if (inp.apertou('pulo') || inp.apertou('cima') || --b.presa <= 0) {
        b.presa = 0; var a = (this.rng() * 0.6 - 0.3); b.vx = this.velBola * Math.sin(a); b.vy = -this.velBola * Math.cos(a);
        this.som.efeito('pulo');
      }
      return;
    }
    var n = Math.max(1, Math.ceil(Math.max(Math.abs(b.vx), Math.abs(b.vy)) / (b.w / 2)));
    for (var k = 0; k < n; k++) {
      b.x += b.vx / n;
      var hit = this.caixaBate(b.x, b.y, b.w, b.h);
      if (b.x < 0 || b.x + b.w > this.larg || hit) { b.x -= b.vx / n; b.vx = -b.vx; if (hit) { this.bater(hit); } }
      b.y += b.vy / n;
      hit = this.caixaBate(b.x, b.y, b.w, b.h);
      if (b.y < 0 || hit) { b.y -= b.vy / n; b.vy = -b.vy; if (hit) { this.bater(hit); } }
      if (b.vy > 0 && bate(b, r)) {
        var rel = clamp(((b.x + b.w / 2) - (r.x + r.w / 2)) / (r.w / 2), -1, 1), ang = rel * 1.05;
        var v = Math.min(this.velBola * 1.6, Math.sqrt(b.vx * b.vx + b.vy * b.vy) * 1.01);
        b.vx = v * Math.sin(ang); b.vy = -v * Math.cos(ang); b.y = r.y - b.h; this.som.efeito('pisao');
      }
    }
    var self = this;
    this.objs.forEach(function (o) {
      if (!o.vivo || !bate(b, o)) { return; }
      o.vivo = false;
      if (o.tipo === 'poder') { r.grande = 900; var nw = Math.min(r.base * 1.6, T * 8); r.x -= (nw - r.w) / 2; r.w = nw; self.som.efeito('poder'); }
      else { self.pontos += o.def.pontos || 100; self.som.efeito('moeda'); }
    });
    if (b.y > this.alt + T) { this.ferir('bola'); return; }
    if (this.restantes <= 0) { this.concluirFase(); }
  };
  QuebraBlocos.prototype.bater = function (hit) {
    if (hit.t.quebravel && !hit.t.borda_mundo) { this.mapa[hit.j][hit.i] = '.'; this.restantes--; this.pontos += hit.t.pontos || 50; this.som.efeito('moeda'); }
  };
  QuebraBlocos.prototype.textoMeio = function () { return 'BLOCOS ' + this.restantes; };
  QuebraBlocos.prototype.desenharMundo = function (ctx) {
    var cor = this.spec.cores || {}, r = this.raquete, b = this.bola;
    this.desenharTiles(ctx); this.desenharObjs(ctx);
    if (this.morto && (this.quadro >> 2) % 2) { return; }
    ctx.fillStyle = cor.destaque || '#F8B800'; ctx.fillRect(Math.round(r.x), Math.round(r.y), Math.round(r.w), r.h);
    var hs = this.sprites[(this.spec.heroi || {}).sprite];
    if (hs) { this.desenharSprite(ctx, this.spec.heroi.sprite, Math.round(r.x + r.w / 2 - hs.w / 2), Math.round(r.y - hs.h), 0, false); }
    ctx.fillStyle = cor.texto || '#FCFCFC'; ctx.fillRect(Math.round(b.x), Math.round(b.y), b.w, b.h);
  };
  QuebraBlocos.prototype.preverX = function () {   // onde a bola chega na altura da raquete (refletindo nas paredes)
    var b = this.bola, r = this.raquete;
    if (b.vy <= 0) { return b.x + b.w / 2; }
    var t = (r.y - (b.y + b.h)) / b.vy, x = b.x + b.w / 2 + b.vx * t, L = this.larg;
    for (var k = 0; k < 8 && (x < 0 || x > L); k++) { x = x < 0 ? -x : 2 * L - x; }
    return x;
  };
  QuebraBlocos.prototype.roboEntrada = function (mem, desajeitado, rng) {
    var r = this.raquete, b = this.bola;
    if (this.morto) { return {}; }
    if (b.presa) { return { pulo: (b.presa % 20) === 0 }; }
    if (b.vy < 0 && mem.subiu !== true) { mem.subiu = true; }
    var xl = this.preverX();
    if (b.vy > 0 && mem.subiu !== false) {      // vai descer: escolhe um bloco para mirar (o robô esperto mira; o desajeitado chuta)
      mem.subiu = false;
      var T = this.T, alvos = [], tiles = this.spec.tiles || {};
      for (var j = 0; j < this.linhas; j++) { for (var i = 0; i < this.colunas; i++) { var td = tiles[this.mapa[j][i]]; if (td && td.quebravel) { alvos.push([i, j]); } } }
      var a = 0;
      if (alvos.length && !(desajeitado && rng() < 0.5)) {
        alvos.sort(function (p, q) { return q[1] - p[1] || Math.abs(p[0] * T - xl) - Math.abs(q[0] * T - xl); });
        var esc = alvos[Math.floor(rng() * Math.min(4, alvos.length))];
        a = Math.atan2((esc[0] + 0.5) * T - xl, Math.max(T, r.y - (esc[1] + 1) * T));
      } else { a = rng() * 1.6 - 0.8; }
      mem.ofs = -clamp(a / 1.05, -0.9, 0.9) * r.w / 2;
    }
    var alvo = xl + (b.vy > 0 ? (mem.ofs || 0) : 0);
    if (desajeitado) {
      mem.h = mem.h || []; mem.h.push(alvo); alvo = mem.h.length > 10 ? mem.h.shift() : alvo;
      if ((mem.f = (mem.f || 0) + 1) % 4 === 0) { return {}; }
    }
    var c = r.x + r.w / 2;
    return { esq: alvo < c - 2, dir: alvo > c + 2 };
  };

  // ───────────────────────── 🚀 NAVE (rolagem vertical) e 🏎 CORRIDA (a mesma pista, sem tiro) ─────────────────────────
  var Nave = herdar(function Nave(spec, perfil, sprites, som, semente) {
    Base.call(this, spec, perfil, sprites, som, semente); this.atira = true;
    if ((spec.fisica || {}).voo === 'rio') { this.dicas = 'SETAS DESVIAM  CIMA ACELERA  ESPACO ATIRA'; }
    this.esq = (spec.fisica || {}).voo === 'esquadrilha'; this.pilotos = [];   // ✈✈ esquadrilha (Asas de Trovão)
    if (this.esq) {
      this.pilotos = pilotosDe(spec);
      if (!this.pilotos.length) { this.pilotos = [{ nome: 'PILOTO', sprite: (spec.heroi || {}).sprite, arma: 'reto' }]; }
      this.sel = [0, 1 % this.pilotos.length]; this.usaTeclado2 = true; this.dicas = 'SETAS VOAM  ESPACO ATIRA  C BOMBA';
    }
  }, 'SETAS VOAM  ESPACO ATIRA  M SOM');
  // 🏞 30/10/2026 (autor: "o André tem que conseguir fazer um River Raid"): fisica.voo = 'rio' → o avião fica embaixo e
  // só vai para os lados; ↑ acelera e ↓ freia a pista. fisica.combustivel = true → tanque que esvazia sozinho, posto de
  // combustível (entidade tipo 'combustivel') enche, tanque vazio derruba. Tile com ponte:true → a ponte inteira explode
  // e vira o ponto de volta. Comportamentos novos: 'acorda' (parado até o avião chegar perto, depois vai e volta entre as
  // margens) e 'cruza' (atravessa a tela de lado, por cima de tudo). Sem isso no spec, a nave é a de sempre.
  Nave.prototype.montarFase = function (f) {
    this.lerMapa(f);
    var h = this.heroi, T = this.T, fis = this.spec.fisica || {}, self = this;
    this.rio = fis.voo === 'rio';
    this.rolar = clamp((fis.rolagem || 1), 0.3, 3) * 0.5 * this.esc * (1 + 0.08 * this.faseIdx);
    this.cam.x = this.larg <= this.W ? -Math.floor((this.W - this.larg) / 2) : 0;
    this.cam.y = Math.max(0, this.alt - this.H);
    // 🚀 29/10/2026 (estúdio "▶ Jogar daqui"): '@' acima da última tela → a câmera começa nele (antes ia sempre ao fundo)
    if (this.inicio.y < this.cam.y) { this.cam.y = clamp(this.inicio.y + 3 * T - this.H, 0, this.cam.y); }
    h.x = this.inicio.x + (T - h.w) / 2; h.y = this.inicio.y + (T - h.h) / 2; h.olhando = 1; h.vx = 0; h.inclina = 0;
    this.chegou = 0; this.esfria = 0; this.tiros = []; this.tirosInim = []; this.boom = []; this.treme = 0;
    this.vMul = 1; this.tanque = fis.combustivel ? 100 : null; this.alarme = 0;
    if (this.rio) {   // folga embaixo: o painel do tanque nunca cobre o avião (nem quando ele nasce no fim do mapa)
      this.cam.y = clamp(h.y + h.h + T * 4 - this.H, 0, Math.max(0, this.alt - this.H));
      this.yRio = Math.min(h.y - this.cam.y, this.H - T * 4 - h.h); h.y = this.cam.y + this.yRio;
    }
    this.pontes = [];   // linhas que têm ponte (de baixo para cima)
    for (var j = this.linhas - 1; j >= 0; j--) { if (this.mapa[j].some(function (c) { var t = (self.spec.tiles || {})[c]; return t && t.ponte; })) { this.pontes.push(j); } }
    if (!this._renascendo) { this.ckpt = null; }   // fase nova ou partida nova: sem ponto de volta
    this.objs.forEach(function (o) {
      o.ativo = false;
      if (o.tipo === 'inimigo') {
        var c = o.def.comportamento || 'parado', v = clamp(o.def.velocidade || 0.6, 0.1, 3) * self.esc;
        var lado = o.def.direcao === 'esq' ? -1 : (o.def.direcao === 'dir' ? 1 : (self.rng() < 0.5 ? -1 : 1));
        o.vx = c === 'cruza' ? lado * v * 1.4 : v * 0.6 * lado;
        o.acordou = c !== 'acorda';
      }
    });
  };
  // 🏞 morreu no rio: volta logo depois da última ponte que derrubou (ou do começo), tanque cheio, inimigos de volta
  Nave.prototype.renascer = function () {
    var h = this.heroi, T = this.T, self = this;
    if (this.rio) {
      var ck = this.ckpt;
      this._renascendo = true; this.montarFase(this.fase); this._renascendo = false;
      if (ck != null) {
        this.ckpt = ck;
        this.pontes.forEach(function (j) { if (j >= ck) { self.mapa[j] = self.mapa[j].map(function (c) { var t = (self.spec.tiles || {})[c]; return t && t.ponte ? '.' : c; }); } });
        // volta no corredor logo depois da ponte; se não couber, desce linha por linha até achar onde o avião cabe inteiro
        var meio = Math.floor(this.colunas / 2), col = null, lin = Math.min(this.linhas - 1, ck + 2);
        var larg = Math.max(1, Math.ceil(h.w / T)), alto = Math.max(1, Math.ceil(h.h / T));   // o avião pode ser maior que uma casa
        var cabe = function (i, l) { for (var q = -1; q <= larg; q++) { for (var r = -1; r <= alto; r++) { if (self.tile(i + q, l + r)) { return false; } } } return true; };
        for (var l2 = Math.min(this.linhas - 1, ck + 2); l2 < Math.min(this.linhas - 1, ck + 14) && col == null; l2++) {
          for (var d = 0; d < this.colunas * 2 && col == null; d++) { var i = meio + (d % 2 ? -((d + 1) >> 1) : (d >> 1)); if (i >= 0 && i + larg <= this.colunas && cabe(i, l2)) { col = i; lin = l2; } }
        }
        h.x = (col == null ? meio : col) * T + Math.max(0, (larg * T - h.w) / 2); h.y = lin * T;
        this.cam.y = clamp(h.y + h.h + T * 4 - this.H, 0, Math.max(0, this.alt - this.H)); this.yRio = Math.min(h.y - this.cam.y, this.H - T * 4 - h.h); h.y = this.cam.y + this.yRio;
        var limite = this.cam.y + this.H + T;
        this.objs.forEach(function (o) { if (o.y > limite) { o.vivo = false; } });
      }
      h.invuln = 90;
      this.som.musica(this.fase.musica);
      return;
    }
    this.cam.y = Math.min(Math.max(0, this.alt - this.H), this.cam.y + T * 3);
    h.x = clamp(h.x, 0, this.larg - h.w); h.y = this.cam.y + this.H - h.h - T;
    var livre = this.caixaBate(h.x, h.y, h.w, h.h);
    for (var k = 0; k < 16 && livre; k++) { h.x = (h.x + T) % Math.max(T, this.larg - h.w); livre = this.caixaBate(h.x, h.y, h.w, h.h); }
    h.invuln = 120; this.tiros = []; this.tirosInim = [];
    if (this.tanque != null) { this.tanque = 100; }
  };
  Nave.prototype.explodir = function (x, y, cor, muito) {   // 💥 estilhaços (o Atari só piscava; aqui voa pedaço)
    var n = muito ? 18 : 10;
    for (var k = 0; k < n; k++) { var a = this.rng() * Math.PI * 2, s = (0.6 + this.rng() * 1.8) * this.esc; this.boom.push({ x: x, y: y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, t: 0, max: 18 + (this.rng() * 14 | 0), cor: k % 3 === 0 ? '#FCFCFC' : (k % 3 === 1 ? '#F8B800' : (cor || '#E45C10')) }); }
  };
  // a ponte inteira cai junto (todas as casas de ponte ligadas na mesma linha)
  Nave.prototype.quebrar = function (i, j) {
    var t = this.tile(i, j);
    if (t && t.ponte && t.quebravel && !t.borda_mundo) {
      var T = this.T, self = this, n = 0;
      for (var a = i; a >= 0 && ((this.spec.tiles || {})[this.mapa[j][a]] || {}).ponte; a--) { this.mapa[j][a] = '.'; n++; this.explodir(a * T + T / 2, j * T + T / 2, '#A04C00'); }
      for (var b = i + 1; b < this.colunas && ((this.spec.tiles || {})[this.mapa[j][b]] || {}).ponte; b++) { this.mapa[j][b] = '.'; n++; this.explodir(b * T + T / 2, j * T + T / 2, '#A04C00'); }
      this.pontos += t.pontos || 500; this.som.efeito('pisao'); this.treme = 14;
      this.ckpt = j;
      if (this.evento) { this.evento('quebrou_ponte', { fase: this.faseIdx + 1 }); }   // 🧭 trilha: etapa "derrube uma ponte"
      if (this.evento) { this.evento('ponte', { linha: j }); }
      return true;
    }
    var ok = Base.prototype.quebrar.call(this, i, j);
    if (ok && this.rio) { this.explodir(i * this.T + this.T / 2, j * this.T + this.T / 2); }
    return ok;
  };
  Nave.prototype.passo = function (inp) {
    var h = this.heroi, T = this.T, self = this, v = 1.7 * this.esc * this.vel;
    if (this.rio) {   // ↑ acelera · ↓ freia · a pista nunca para
      var alvo = inp.cima ? 2.1 : (inp.baixo ? 0.45 : 1);
      this.vMul += (alvo - this.vMul) * 0.08;
    }
    var rola = this.rolar * (this.rio ? this.vMul : 1);
    // ✈ 02/11: o barulho do motor (sons.motor; no rio, sem escolha, o clássico)
    if (!this.morto && this.som && this.som.motorRitmo) {
      var tipoMotor = (this.spec.sons && this.spec.sons.motor) || (this.rio ? 'classico' : null);
      if (tipoMotor) { this.som.motorRitmo(this.rio ? this.vMul : 1, tipoMotor); }
    }
    // 👑 31/10 (André, etapa 13): o jogo terminava com o chefe vivo — agora a tela para quando o chefe entra e a fase só
    // acaba com ele derrotado (chefe que ficou para trás, embaixo da tela, não prende ninguém)
    var luta = this.chefeNaTela(), chefeAFrente = luta || this.chefeAFrente();
    if (luta && (this.lutaT = (this.lutaT || 0) + 1) > 60 * 60) {   // 60 s parado e o chefe não cai (ex.: escondido atrás de uma ilha): ele foge e o rio segue
      this.objs.forEach(function (o) { if (o.vivo && o.tipo === 'inimigo' && (o.def.vida || 1) >= 5) { o.fugiu = true; } });
      if (this.evento) { this.evento('chefe_fugiu', { fase: this.faseIdx + 1 }); }
      luta = false; chefeAFrente = false;
    }
    if (!luta) { this.lutaT = 0; }
    if (this.cam.y > 0 && !luta) { var dy0 = Math.min(rola, this.cam.y); this.cam.y -= dy0; h.y -= dy0; }
    else if (this.cam.y <= 0 && !chefeAFrente && ++this.chegou > 90) { this.concluirFase(); return; }
    if (this.rio) {
      var quer = (inp.esq ? -1 : 0) + (inp.dir ? 1 : 0);
      h.vx += (quer * v * 1.1 - h.vx) * 0.28;
      h.x += h.vx; h.inclina = Math.abs(h.vx) > v * 0.35 ? (h.vx < 0 ? -1 : 1) : 0;
      if (quer) { h.olhando = quer; }
      h.x = clamp(h.x, 0, this.larg - h.w); h.y = this.cam.y + this.yRio;
    } else {
      if (inp.esq) { h.x -= v; h.olhando = -1; } if (inp.dir) { h.x += v; h.olhando = 1; }
      if (inp.cima) { h.y -= v * 0.8; } if (inp.baixo) { h.y += v * 0.8; }
      h.x = clamp(h.x, 0, this.larg - h.w); h.y = clamp(h.y, this.cam.y + 10, this.cam.y + this.H - h.h);
    }
    h.anda = true;
    if (this.atira) {
      if (this.esfria > 0) { this.esfria--; }
      var podeAtirar = this.rio ? this.tiros.length === 0 : this.esfria <= 0;   // no rio: um míssil por vez, bem rápido
      if (inp.pulo && podeAtirar) {
        this.esfria = 12; var w = Math.max(1, T >> 3), hh = Math.max(3, T >> 1), vy = (this.rio ? -7 : -4) * this.esc;
        this.tiros.push({ x: h.x + h.w / 2 - w / 2, y: h.y - hh, w: w, h: hh, vy: vy, x0: h.x });
        if (h.poder === 'tiro_duplo') { this.tiros.push({ x: h.x, y: h.y, w: w, h: hh, vy: vy }); this.tiros.push({ x: h.x + h.w - w, y: h.y, w: w, h: hh, vy: vy }); }
        this.som.efeito('pulo');
      }
    }
    // ⛽ tanque: esvazia sempre no mesmo ritmo; posto enche (mais quando você passa devagar)
    if (this.tanque != null && !this.morto && !luta) {   // na luta com o chefe a tela para (sem posto novo): o tanque espera
      this.tanque -= 100 / (60 * 14);   // ~14 s de tanque cheio: o posto faz diferença
      if (this.tanque < 25 && (this.alarme++ % 40) === 0) { this.som.efeito('dano'); }
      if (this.tanque <= 0) { this.tanque = 0; this.explodir(h.x + h.w / 2, h.y + h.h / 2, null, true); if (this.evento) { this.evento('ficou_sem_combustivel', { fase: this.faseIdx + 1 }); } this.ferir('combustivel'); return; }
    }
    var topo = this.cam.y - T, baixo = this.cam.y + this.H + T;
    this.objs.forEach(function (o) {
      if (!o.vivo) { return; }
      if (!o.ativo) { if (o.y + o.h >= topo) { o.ativo = true; } else { return; } }
      if (o.y > baixo) { o.vivo = false; return; }
      o.t++;
      if (o.tipo === 'inimigo' && Cartas.tem(o)) {
        if (!self.rio) { if (self.atira) { o.y += 0.25 * self.esc * clamp(o.def.velocidade || 0.6, 0.1, 3); } else { o.y -= self.rolar * 0.45; } }
        Cartas.passo(self, o);
      }
      else if (o.tipo === 'inimigo') { self.moverInim(o); }
    });
    this.tiros = this.tiros.filter(function (b) {
      b.y += b.vy;
      var hit = self.caixaBate(b.x, b.y, b.w, b.h); if (hit) { self.quebrar(hit.i, hit.j); return false; }
      for (var k = 0; k < self.objs.length; k++) {
        var o = self.objs[k];
        if (o.vivo && o.ativo && (o.tipo === 'inimigo' || o.tipo === 'combustivel') && bate(b, o)) {
          if (o.tipo === 'inimigo' && Cartas.tem(o) && Cartas.atingido(self, o, 'tiro')) { return false; }
          o.vida = (o.vida || o.def.vida || 1) - 1;
          if (o.vida <= 0) { o.vivo = false; self.pontos += o.def.pontos || (o.tipo === 'combustivel' ? 80 : 100); self.som.efeito('pisao'); self.explodir(o.x + o.w / 2, o.y + o.h / 2, o.tipo === 'combustivel' ? '#B83C3C' : null, o.tipo === 'combustivel'); }
          return false;
        }
      }
      return b.y + b.h > self.cam.y;
    });
    this.tirosInim = this.tirosInim.filter(function (b) {
      b.x += b.vx; b.y += b.vy;
      if (self.caixaBate(b.x, b.y, b.w, b.h)) { return false; }
      if (bate(b, h, 1)) { self.ferir('tiro'); return false; }
      return b.y < baixo && b.y > topo;
    });
    this.boom = this.boom.filter(function (p) { p.x += p.vx; p.y += p.vy - (self.rio ? 0 : 0); p.vx *= 0.94; p.vy *= 0.94; return ++p.t < p.max; });
    if (this.treme > 0) { this.treme--; }
    if (this.morto) { return; }
    var caixa = { x: h.x + 1, y: h.y + 1, w: h.w - 2, h: h.h - 2 };
    // no rio a margem bate SEMPRE (a invencibilidade de quem acabou de voltar vale só para inimigos e tiros) — antes o avião
    // atravessava a margem invencível e, quando ela acabava, estava dentro da terra: morria de novo no mesmo lugar, em laço
    if (this.caixaBate(caixa.x, caixa.y, caixa.w, caixa.h) && (!h.invuln || this.rio)) {
      if (this.rio) { if (h.invuln) { h.invuln = 0; } this.explodir(h.x + h.w / 2, h.y + h.h / 2, null, true); }
      this.ferir('parede'); return;
    }
    var abastece = false;
    for (var k = 0; k < this.objs.length; k++) {
      var o = this.objs[k];
      if (!o.vivo || !o.ativo || !bate(caixa, o)) { continue; }
      if (o.tipo === 'combustivel') { abastece = true; continue; }
      if (o.tipo === 'coletavel') { o.vivo = false; this.pontos += o.def.pontos || 100; this.som.efeito('moeda'); }
      else if (o.tipo === 'poder') { o.vivo = false; h.poder = o.def.da || 'escudo'; this.som.efeito('poder'); }
      else if (o.tipo === 'fim_de_fase') { this.concluirFase(); return; }
      else if (o.tipo === 'inimigo' && Cartas.tem(o)) { Cartas.encostou(this, o); if (this.morto) { return; } }
      else if (o.tipo === 'inimigo') { if (this.rio) { this.explodir(h.x + h.w / 2, h.y + h.h / 2, null, true); o.vivo = false; } this.ferir(o.def.comportamento || 'patrulha'); if (this.morto && !this.atira) { o.vivo = false; } return; }
    }
    if (abastece && this.tanque != null && this.tanque < 100) {
      this.tanque = Math.min(100, this.tanque + 0.55 / Math.max(0.45, this.rio ? this.vMul : 1));
      if ((this.quadro % 10) === 0) { this.som.efeito('moeda'); }
    }
  };
  Nave.prototype.moverInim = function (o) {
    var c = o.def.comportamento || 'parado', T = this.T, h = this.heroi;
    if (!this.rio) {
      if (this.atira) { o.y += 0.25 * this.esc * clamp(o.def.velocidade || 0.6, 0.1, 3); }
      else { o.y -= this.rolar * 0.45; }       // corrida: os outros carros andam para a frente, mais devagar que você
    }
    if (c === 'acorda' && !o.acordou) {   // fica parado até o avião chegar perto (cada um acorda numa distância)
      var perto = T * (5 + ((o.i * 7 + o.j * 3) % 6));
      if (h.y - (o.y + o.h) < perto) { o.acordou = true; } else { return; }
    }
    if (c === 'patrulha' || c === 'faixa' || c === 'acorda') {
      o.x += o.vx; if (o.x < 0 || o.x + o.w > this.larg || this.caixaBate(o.x, o.y, o.w, o.h)) { o.vx = -o.vx; o.x += o.vx * 2; }
    } else if (c === 'cruza') {   // ✈ atravessa a tela por cima de tudo e reaparece do outro lado
      o.x += o.vx;
      if (o.vx > 0 && o.x > this.larg + T) { o.x = -o.w - T; } else if (o.vx < 0 && o.x + o.w < -T) { o.x = this.larg + T; }
    } else if (c === 'voa_seno') { o.x = o.x0 + Math.sin(o.t / 25) * T * 2; }
    else if (c === 'persegue') { o.x += clamp(h.x - o.x, -0.6 * this.esc, 0.6 * this.esc); }
    else if (c === 'pula') { o.y += Math.sin(o.t / 12) * 0.8 * this.esc; }
    if ((o.def.atira || c === 'atira') && this.atira && o.t % 100 === 50 && o.y < h.y) {
      var w = Math.max(2, T >> 2), dx = (h.x + h.w / 2) - (o.x + o.w / 2), dy = (h.y - o.y), d = Math.sqrt(dx * dx + dy * dy) || 1, sp = 1.4 * this.esc;
      this.tirosInim.push({ x: o.x + o.w / 2 - w / 2, y: o.y + o.h, w: w, h: w, vx: dx / d * sp, vy: dy / d * sp });
    }
  };
  Nave.prototype.cartaDirInicial = function (o) { return [o.vx >= 0 ? 1 : -1, 0]; };
  Nave.prototype.cartaVel = function (o) { return clamp(o.def.velocidade || 0.6, 0.1, 3) * 0.6 * this.esc; };
  Nave.prototype.cartaMover = function (o, dx, dy) {   // de lado bate na beira da pista; os blocos não seguram quem voa
    var res = {};
    o.x += dx;
    if (o.x < 0 || o.x + o.w > this.larg) { o.x -= dx; res.borda = true; }
    else if (!o.cv.voa && dx && this.caixaBate(o.x, o.y, o.w, o.h)) { o.x -= dx; res.parede = true; }
    o.y += dy;
    o.vx = dx || o.cv.dx * 0.01;
    return res;
  };
  Nave.prototype.textoMeio = function () { return 'FASE ' + (this.faseIdx + 1) + ' ' + Math.round(100 * (1 - this.cam.y / Math.max(1, this.alt - this.H))) + '%'; };
  Nave.prototype.desenharMundo = function (ctx) {
    var tremor = this.treme ? ((this.quadro % 2) ? 1 : -1) * Math.min(2, this.treme >> 2) : 0;
    if (tremor) { ctx.save(); ctx.translate(tremor, 0); }
    this.desenharTiles(ctx);
    var self = this, rio = this.rio, construindo = this.estado === 'construir';
    this.objs.forEach(function (o) {
      if (!o.vivo || (!o.ativo && !construindo)) { return; }   // 🏗 no Estúdio de Fases aparece TUDO (antes os inimigos sumiam)
      // no rio, quem anda de lado olha para onde vai (o desenho é feito olhando para a direita)
      var virar = rio && o.tipo === 'inimigo' && o.vx < 0 && (o.def.comportamento || 'parado') !== 'parado';
      self.desenharObj(ctx, o, o.t >> 3, virar);
      var vm = o.tipo === 'inimigo' ? (o.def.vida || 1) : 1;   // 👑 chefe (vida > 1): barra de vida em cima dele
      if (vm > 1 && !construindo) {
        var v = Math.max(0, o.vida == null ? vm : o.vida), bw = Math.max(10, Math.round(o.w)), bx = Math.round(o.x), by = Math.round(o.y) - 4;
        ctx.fillStyle = '#000'; ctx.fillRect(bx - 1, by - 1, bw + 2, 4);
        ctx.fillStyle = v / vm > 0.5 ? '#7EE787' : (v / vm > 0.25 ? '#FFB547' : '#F87171'); ctx.fillRect(bx, by, Math.max(1, Math.round(bw * v / vm)), 2);
      }
    });
    this.desenharTiros(ctx);
    this.desenharHeroi(ctx, false);
    (this.boom || []).forEach(function (p) { ctx.fillStyle = p.cor; var s = p.t < p.max / 2 ? 2 : 1; ctx.fillRect(Math.round(p.x), Math.round(p.y), s, s); });
    if (tremor) { ctx.restore(); }
  };
  // ✈ no rio o avião tem 2 quadros: reto e inclinado (o inclinado é desenhado indo para a direita)
  Nave.prototype.desenharHeroi = function (ctx, virar) {
    if (!this.rio) { return Base.prototype.desenharHeroi.call(this, ctx, virar); }
    var h = this.heroi, her = this.spec.heroi || {};
    if (this.morto) { return; }
    if (h.invuln && (this.quadro >> 2) % 2) { return; }
    var nome = h.poder && her.sprite_poder ? her.sprite_poder : her.sprite, s = this.sprites[nome];
    var q = s && s.quadros.length > 1 && h.inclina ? 1 : 0;
    this.desenharSprite(ctx, nome, Math.round(h.x), Math.round(h.y), q, h.inclina < 0);
  };
  // ⛽ painel do tanque: E · ½ · F com o ponteiro (só quando o jogo tem combustível)
  Nave.prototype.hud = function (ctx) {
    Base.prototype.hud.call(this, ctx);
    if (this.tanque == null) { return; }
    var W = this.W, H = this.H, cor = this.spec.cores || {}, tinta = cor.texto || '#FCFCFC';
    var gw = Math.min(72, Math.floor(W * 0.45)), gh = 11, gx = Math.floor((W - gw) / 2), gy = H - gh - 3;
    ctx.fillStyle = 'rgba(0,0,0,0.65)'; ctx.fillRect(gx - 3, gy - 2, gw + 6, gh + 4);
    ctx.fillStyle = tinta; ctx.fillRect(gx, gy, gw, 1); ctx.fillRect(gx, gy + gh - 1, gw, 1); ctx.fillRect(gx, gy, 1, gh); ctx.fillRect(gx + gw - 1, gy, 1, gh);
    texto(ctx, 'E', gx + 2, gy + 3, tinta, 1); texto(ctx, 'F', gx + gw - 5, gy + 3, tinta, 1);
    ctx.fillRect(gx + Math.floor(gw / 2), gy + 1, 1, 3);
    var px = gx + 7 + Math.round((gw - 14) * this.tanque / 100);
    var baixo = this.tanque < 25 && (this.quadro >> 3) % 2;
    ctx.fillStyle = baixo ? '#FF4D4D' : (cor.destaque || '#F8B800'); ctx.fillRect(px - 1, gy + 2, 3, gh - 4);
  };
  // 🤖 escolhe a "faixa" da tela com menos perigo nas próximas linhas (e, na nave, perto de um inimigo para acertar)
  Nave.prototype.roboEntrada = function (mem, desajeitado, rng) {
    var h = this.heroi, T = this.T, self = this;
    if (this.morto) { return {}; }
    mem.f = (mem.f || 0) + 1;
    var rio = this.rio, passo = Math.max(2, T / 2), melhor = h.x, nota = 1e9;
    var cx = rio ? h.x + (h.vx || 0) * 3.5 : h.x;   // 🏞 no rio o avião escorrega: o robô pensa onde ele vai PARAR
    if (!desajeitado || mem.f % 10 === 0 || mem.alvo == null) {
      for (var x = 0; x <= this.larg - h.w; x += passo) {
        var p = 0, dist = Math.abs(x - cx);
        for (var dy = -T * 5; dy <= h.h; dy += T / 2) {   // blocos à frente (a tela desce sobre você)
          if (this.caixaBate(x, h.y + dy, h.w, h.h)) { p += dy > -T * 2 ? (rio ? 400 : 60) : (rio ? 40 : 20); }
        }
        if (rio) {   // não dá para atravessar a margem: se tem terra entre onde estou e x, esse x não serve agora
          var a0 = Math.min(cx, x), a1 = Math.max(cx, x);
          for (var xx = a0; xx <= a1; xx += T / 2) { if (this.caixaBate(xx, h.y - T * 0.5, h.w, h.h)) { p += 300; break; } }
        }
        this.objs.forEach(function (o) {
          if (!o.vivo || !o.ativo || o.tipo !== 'inimigo') { return; }
          var ady = h.y - (o.y + o.h), ox = o.x + o.vx * 20, folga = T * 0.6;
          if (rio) {   // 🏞 no rio o inimigo vai e volta: a faixa perigosa é por onde ele ANDA até chegar em mim (o que dorme pode acordar)
            if (ady <= -T || ady >= T * 7) { return; }
            var tChega = Math.max(0, ady) / Math.max(0.5, (self.rolar || 1.5) * (self.vMul || 1));
            var ex = clamp(o.x + (o.vx || 0) * Math.min(tChega, 60), 0, self.larg - o.w), f2 = T * 0.5;   // onde ele vai estar quando eu chegar
            var dorme = (o.def && o.def.comportamento) === 'acorda' && !o.acordou;
            var a0 = Math.min(o.x, ex) - f2 - (dorme ? T : 0), a1 = Math.max(o.x, ex) + o.w + f2 + (dorme ? T : 0);
            if (a0 < x + h.w && a1 > x) { p += ady < T * 3 ? 160 : 45; }
            return;
          }
          if (ady > -T && ady < T * 6 && ox < x + h.w + T * 0.6 && ox + o.w > x - T * 0.6) { p += ady < T * 2 ? 80 : 25; }
        });
        (this.tirosInim || []).forEach(function (b) { var ady = h.y - b.y, bx = b.x + b.vx * Math.max(0, ady / Math.max(0.1, b.vy)); if (ady > -T && ady < T * 6 && bx > x - T * 0.5 && bx < x + h.w + T * 0.5) { p += 50; } });
        if (this.tanque != null && this.tanque < 60 && !mem.semPosto) {   // ⛽ tanque baixo (mem.semPosto: o Bit mostrando "fique sem combustível"): procura o posto de combustível à frente
          this.objs.forEach(function (o) { if (o.vivo && o.tipo === 'combustivel') { var ady = h.y - (o.y + o.h); if (ady > -T && ady < T * 10 && o.x < x + h.w && o.x + o.w > x) { p -= rio ? 35 : 70; } } });
        }
        if (this.atira) {   // gosta de ficar embaixo de um inimigo para acertar
          var mira = this.objs.some(function (o) { return o.vivo && o.ativo && o.tipo === 'inimigo' && o.y < h.y - T * (rio ? 3 : 2) && (!rio || o.y > h.y - T * 9) && Math.abs((o.x + o.w / 2) - (x + h.w / 2)) < T; });
          if (mira) { p -= rio ? 25 : 6; }   // 🏞 no rio: alinhar e atirar é o jeito de passar
        }
        p += dist / T * 1.5;
        if (p < nota) { nota = p; melhor = x; }
      }
      mem.alvo = melhor + (desajeitado && rng() < 0.2 ? (rng() * 2 - 1) * T * 2 : 0);
    }
    var alvoY = this.cam.y + this.H * 0.72;
    var frenteRuim = this.caixaBate(h.x, h.y - T * 1.5, h.w, h.h) && Math.abs(mem.alvo - h.x) > T;
    var muro = -1e9;   // a 1ª coisa sólida à frente (ex.: a ponte): se ela vem antes do posto, o tiro pega nela, não no posto
    for (var dyM = 0; dyM < this.H; dyM += T / 2) { if (this.caixaBate(h.x + h.w / 2 - 1, h.y - dyM, 2, 2)) { muro = h.y - dyM; break; } }
    this.objs.forEach(function (o) {   // um inimigo na frente do posto também leva o tiro antes
      if (o.vivo && o.tipo === 'inimigo' && o.y < h.y && o.x < h.x + h.w && o.x + o.w > h.x) { muro = Math.max(muro, o.y); }
    });
    var postoNaMira = !mem.semPosto && this.tanque != null && this.objs.some(function (o) { return o.vivo && o.tipo === 'combustivel' && o.y < h.y && o.y + o.h > muro && h.y - o.y < self.H && o.x < h.x + h.w && o.x + o.w > h.x; });
    if (rio) {   // no rio: mira onde vai parar; freia quando o caminho aperta; acelera só com o caminho livre e o tanque bom
      var pare = h.x + (h.vx || 0) * 3.5, apertado = false;
      for (var dy2 = -T * 4; dy2 <= 0; dy2 += T / 2) { if (this.caixaBate(h.x - T, h.y + dy2, h.w + 2 * T, h.h)) { apertado = true; break; } }
      return { esq: mem.alvo < pare - 1, dir: mem.alvo > pare + 1, pulo: this.atira && (mem.f % 2 === 0) && !postoNaMira,
               baixo: !desajeitado && (apertado || Math.abs(mem.alvo - h.x) > T * 2), cima: false };
    }
    return { esq: mem.alvo < h.x - 1, dir: mem.alvo > h.x + 1, pulo: this.atira && (mem.f % 2 === 0) && !postoNaMira,
             baixo: !desajeitado && (frenteRuim || h.y < alvoY - T), cima: !desajeitado && h.y > alvoY + T && !frenteRuim };
  };
  // ✈✈ ESQUADRILHA (30/10/2026 — Oficina 2 "Asas de Trovão", pedido do autor): fisica.voo = 'esquadrilha' vira um jogo de
  // tiro de aviões no estilo dos fliperamas de 16 bits, com TUDO original: escolha de piloto (spec.pilotos), arma de cada
  // piloto com 4 níveis (item poder 'nivel' = P), bomba que limpa a tela (item poder 'bomba' = B; tecla C ou B), 2 jogadores
  // ao mesmo tempo (J2: W A S D + F atira + G bomba; na TV, o 2º controle/celular), fundo em ladrilho que rola mais devagar
  // que o mapa (fase.ladrilho = {sprite, vel}), nuvens por cima (fase.nuvens), inimigos em 'onda' e 'mergulho', e chefão com
  // PARTES (entidade.partes = [{dx, dy, sprite, vida}]) — enquanto houver parte viva o corpo do chefe é blindado, e a tela
  // para de rolar até ele cair. Sem 'esquadrilha' no spec, a nave é exatamente a de antes.
  var ARMAS_ESQ = { reto: { cad: 8, nome: 'RETO' }, leque: { cad: 11, nome: 'LEQUE' }, laser: { cad: 4, nome: 'LASER' }, missil: { cad: 14, nome: 'MISSIL' } };
  function pilotosDe(spec) {
    var ps = Array.isArray(spec.pilotos) ? spec.pilotos.filter(function (p) { return p && p.sprite; }) : [];
    return ps.slice(0, 4);
  }
  Nave.prototype.jogadores = function () {
    var l = [this.heroi]; if (this.esq && this.j2ativo && this.h2 && !this.h2.fora) { l.push(this.h2); } return l;
  };
  Nave.prototype.vestir = function (h, i) {   // o piloto i: desenho, arma e velocidade
    var p = this.pilotos[i] || {}, s = this.sprites[p.sprite] || this.sprites[(this.spec.heroi || {}).sprite] || { w: this.T, h: this.T };
    h.piloto = i; h.sprite = p.sprite || (this.spec.heroi || {}).sprite; h.arma = ARMAS_ESQ[p.arma] ? p.arma : 'reto';
    h.corTiro = p.cor_tiro || null; h.velP = clamp(p.velocidade || 1, 0.5, 2); h.w = s.w; h.h = s.h;
    if (h.nivel == null) { h.nivel = 1; } if (h.bombas == null) { h.bombas = 2; } h.esfria = 0;
  };
  var naveMontar0 = Nave.prototype.montarFase, naveRenascer0 = Nave.prototype.renascer, navePasso0 = Nave.prototype.passo;
  var naveDesenharMundo0 = Nave.prototype.desenharMundo, naveHud0 = Nave.prototype.hud, naveRobo0 = Nave.prototype.roboEntrada;
  var naveHeroi0 = Nave.prototype.desenharHeroi, naveMover0 = Nave.prototype.moverInim;
  Nave.prototype.montarFase = function (f) {
    naveMontar0.call(this, f);
    if (!this.esq) { return; }
    var h = this.heroi, self = this, T = this.T;
    this.vestir(h, this.sel[0]);
    h.x = clamp(this.larg / 2 - h.w - (this.j2ativo ? T : -h.w / 2), 0, this.larg - h.w); h.y = this.cam.y + this.H - h.h - T * 2;
    if (this.j2ativo) {
      var h2 = this.h2 && !this.h2.fora ? this.h2 : { n: 2, invuln: 0, poder: null, vidas: this.vidas2 != null ? this.vidas2 : this.vidasIniciais };
      this.vestir(h2, this.sel[1]); h2.x = clamp(this.larg / 2 + T, 0, this.larg - h2.w); h2.y = h.y; h2.morto = 0; this.h2 = h2;
    } else { this.h2 = null; }
    this.flash = 0;
    // chefe com partes: cada parte é um inimigo de verdade, preso ao corpo
    var novos = [];
    this.objs.forEach(function (o) {
      if (o.tipo !== 'inimigo' || !Array.isArray(o.def.partes)) { return; }
      o.partes = [];
      o.def.partes.slice(0, 6).forEach(function (p, k) {
        var sp = self.sprites[p.sprite] || { w: T, h: T };
        var c = { tipo: 'inimigo', parte: true, pai: o, ch: o.ch, i: o.i, j: o.j, t: 0, vivo: true, ativo: false, x: o.x + (p.dx || 0), y: o.y + (p.dy || 0),
                  w: sp.w, h: sp.h, vx: 0, vy: 0, dx: p.dx || 0, dy: p.dy || 0, def: { sprite: p.sprite, vida: clamp(p.vida || 3, 1, 50), pontos: 300, atira: true, comportamento: 'parado' } };
        novos.push(c); o.partes.push(c);
      });
    });
    this.objs = this.objs.concat(novos);
  };
  Nave.prototype.renascer = function () {
    if (!this.esq) { return naveRenascer0.call(this); }
    var h = this.heroi, T = this.T;   // no ar não há "voltar ao ponto": o avião volta embaixo, piscando, com um nível a menos
    h.x = clamp(this.larg / 2 - h.w / 2, 0, this.larg - h.w); h.y = this.cam.y + this.H - h.h - T * 2;
    h.nivel = Math.max(1, (h.nivel || 1) - 1); h.bombas = Math.max(h.bombas || 0, 2); h.invuln = 120; this.tirosInim = [];
  };
  Nave.prototype.chefeAFrente = function () {   // um chefe vivo na tela ou ainda à frente (acima) dela
    var baixo = this.cam.y + this.H;
    return this.objs.some(function (o) { return o.vivo && !o.fugiu && o.tipo === 'inimigo' && !o.parte && (o.def.vida || 1) >= 5 && o.y < baixo; });
  };
  Nave.prototype.chefeNaTela = function () {
    // a tela para quando o chefe já entrou INTEIRO — e abaixo do placar, com lugar para a barra de vida em cima dele
    // (31/10, autor: a barra ficava escondida). No começo do mapa (a tela não sobe mais) vale onde ele estiver.
    var topo = this.cam.y <= 0 ? -1e9 : this.cam.y + 18, baixo = this.cam.y + this.H;
    return this.objs.some(function (o) { return o.vivo && !o.fugiu && o.tipo === 'inimigo' && !o.parte && (o.def.vida || 1) >= 5 && o.y >= topo && o.y < baixo; });
  };
  Nave.prototype.disparar = function (h) {
    var T = this.T, e = this.esc, n = clamp(h.nivel || 1, 1, 4), cx = h.x + h.w / 2, y = h.y - 2, self = this;
    var w = Math.max(1, T >> 3), hh = Math.max(3, T >> 1), cor = h.corTiro;
    function tiro(x, vx, vy, extra) { self.tiros.push(Object.assign({ x: x - w / 2, y: y - hh, w: w, h: hh, vx: vx || 0, vy: vy, dono: h.n || 1, cor: cor, dano: 1 }, extra || {})); }
    if (h.arma === 'leque') {
      var k = n * 2 - 1;
      for (var a = 0; a < k; a++) { var ang = (a - (k - 1) / 2) * 0.22; tiro(cx, Math.sin(ang) * 4.5 * e, -Math.cos(ang) * 4.5 * e); }
    } else if (h.arma === 'laser') {
      tiro(cx, 0, -8 * e, { w: w + n, h: hh * 2, perfura: n + 1, laser: true });
    } else if (h.arma === 'missil') {
      tiro(cx, 0, -5 * e);
      for (var m = 1; m < n; m++) { tiro(cx + (m % 2 ? -1 : 1) * h.w / 2, (m % 2 ? -1 : 1) * 1.2 * e, -3 * e, { missil: true, w: w + 1, h: hh - 1 }); }
    } else {
      for (var r = 0; r < n; r++) { tiro(cx + (r - (n - 1) / 2) * (w + 3), 0, -5.5 * e); }
    }
    h.esfria = ARMAS_ESQ[h.arma] ? ARMAS_ESQ[h.arma].cad : 8;
    this.som.efeito(h.arma === 'laser' ? 'laser' : 'tiro');
  };
  Nave.prototype.bomba = function (h) {
    if (!h.bombas) { return; }
    h.bombas--; this.flash = 18; this.treme = 20; this.tirosInim = []; h.invuln = Math.max(h.invuln || 0, 60);
    var topo = this.cam.y, baixo = this.cam.y + this.H, self = this;
    this.objs.forEach(function (o) {
      if (!o.vivo || o.tipo !== 'inimigo' || o.y + o.h < topo || o.y > baixo) { return; }
      self.ferirInimigo(o, 6, h.n || 1);
    });
    this.som.efeito('explosao');
    if (this.evento) { this.evento('bomba', { jogador: h.n || 1 }); }
  };
  Nave.prototype.ferirInimigo = function (o, dano, dono) {   // devolve true se o tiro "gastou" (bateu em alguém)
    if (o.pai && !o.pai.vivo) { o.vivo = false; return false; }
    if (o.partes && o.partes.some(function (p) { return p.vivo; })) { o.blindado = 8; return true; }   // corpo blindado: tire as partes primeiro
    if (Cartas.tem(o) && Cartas.atingido(this, o, 'tiro')) { return true; }
    o.vida = (o.vida || o.def.vida || 1) - dano;
    if (o.vida <= 0) {
      o.vivo = false;
      var pts = o.def.pontos || 100; if (dono === 2) { this.pontos2 = (this.pontos2 || 0) + pts; } else { this.pontos += pts; }
      var grande = (o.def.vida || 1) >= 5;
      this.explodir(o.x + o.w / 2, o.y + o.h / 2, null, grande); this.som.efeito(grande ? 'explosao' : 'pisao');
      if (grande) { this.treme = 30; if (this.evento) { this.evento('chefe_caiu', { fase: this.faseIdx + 1 }); } }
      (o.partes || []).forEach(function (p) { p.vivo = false; });
    } else { o.pisca = 4; }
    return true;
  };
  Nave.prototype.ferir2 = function (h2) {
    if (h2.morto || h2.invuln) { return; }
    h2.vidas--; h2.morto = 70; this.explodir(h2.x + h2.w / 2, h2.y + h2.h / 2, null, true); this.som.efeito('dano');
    if (h2.vidas <= 0) { h2.fora = true; }
  };
  Nave.prototype.passo = function (inp) {
    if (!this.esq) { return navePasso0.call(this, inp); }
    var T = this.T, self = this, js = this.jogadores();
    if (this.flash) { this.flash--; }
    // rola — e para quando o chefe está na tela (a luta é ali)
    if (!this.chefeNaTela()) {
      if (this.cam.y > 0) { var dy0 = Math.min(this.rolar, this.cam.y); this.cam.y -= dy0; js.forEach(function (h) { h.y -= dy0; }); }
      else if (++this.chegou > 90) { this.concluirFase(); return; }
    }
    js.forEach(function (h) {
      var e = h.n === 2 ? (inp.j2 || {}) : inp, ap = e.apertou || function () { return false; };
      if (h.n === 2) {
        if (h.morto) { if (--h.morto <= 0) { h.x = clamp(self.larg / 2, 0, self.larg - h.w); h.y = self.cam.y + self.H - h.h - T * 2; h.invuln = 120; h.nivel = Math.max(1, h.nivel - 1); } return; }
        if (h.invuln) { h.invuln--; }
      }
      var v = 1.9 * self.esc * self.vel * (h.velP || 1);
      if (e.esq) { h.x -= v; } if (e.dir) { h.x += v; } if (e.cima) { h.y -= v * 0.9; } if (e.baixo) { h.y += v * 0.9; }
      h.inclina = e.esq ? -1 : (e.dir ? 1 : 0); h.anda = true;
      h.x = clamp(h.x, 0, self.larg - h.w); h.y = clamp(h.y, self.cam.y + 12, self.cam.y + self.H - h.h);
      if (h.esfria > 0) { h.esfria--; }
      if (e.pulo && h.esfria <= 0) { self.disparar(h); }
      if (ap('bomba')) { self.bomba(h); }
    });
    var topo = this.cam.y - T, baixo = this.cam.y + this.H + T;
    this.objs.forEach(function (o) {
      if (!o.vivo) { return; }
      if (o.parte) {
        if (!o.pai.vivo) { o.vivo = false; return; }
        o.x = o.pai.x + o.dx; o.y = o.pai.y + o.dy; o.ativo = o.pai.ativo; o.t++;
        if (o.ativo && o.t % 90 === 45) { self.atirarEm(o); }
        return;
      }
      if (!o.ativo) { if (o.y + o.h >= topo) { o.ativo = true; } else { return; } }
      if (o.y > baixo) { o.vivo = false; return; }
      o.t++; if (o.pisca) { o.pisca--; } if (o.blindado) { o.blindado--; }
      if (o.tipo === 'inimigo' && Cartas.tem(o)) { o.y += 0.25 * self.esc * clamp(o.def.velocidade || 0.6, 0.1, 3); Cartas.passo(self, o); }
      else if (o.tipo === 'inimigo') { self.moverInim(o); }
    });
    // tiros dos jogadores: míssil persegue, laser atravessa
    this.tiros = this.tiros.filter(function (b) {
      if (b.missil) {
        var alvo = null, d0 = 1e9;
        self.objs.forEach(function (o) { if (o.vivo && o.ativo && o.tipo === 'inimigo' && o.y < b.y) { var d = Math.abs(o.x - b.x) + (b.y - o.y); if (d < d0) { d0 = d; alvo = o; } } });
        if (alvo) { var dx = (alvo.x + alvo.w / 2) - b.x; b.vx += clamp(dx, -1, 1) * 0.25 * self.esc; b.vx = clamp(b.vx, -3 * self.esc, 3 * self.esc); }
        b.vy = Math.max(-6 * self.esc, b.vy - 0.12 * self.esc);
      }
      b.x += b.vx || 0; b.y += b.vy;
      for (var k = 0; k < self.objs.length; k++) {
        var o = self.objs[k];
        if (o.vivo && o.ativo && o.tipo === 'inimigo' && bate(b, o)) {
          if (b.ja && b.ja.indexOf(o) >= 0) { continue; }
          var gastou = self.ferirInimigo(o, b.dano || 1, b.dono);
          if (b.perfura && gastou) { b.ja = (b.ja || []).concat([o]); if (--b.perfura > 0) { continue; } }
          if (gastou) { return false; }
        }
      }
      return b.y + b.h > self.cam.y - 4 && b.x > -8 && b.x < self.larg + 8;
    });
    this.tirosInim = this.tirosInim.filter(function (b) {
      b.x += b.vx; b.y += b.vy;
      for (var q = 0; q < js.length; q++) {
        var h = js[q]; if (h.morto || h.invuln) { continue; }
        if (bate(b, h, 1)) { if (h.n === 2) { self.ferir2(h); } else { self.ferir('tiro'); } return false; }
      }
      return b.y < baixo && b.y > topo && b.x > -8 && b.x < self.larg + 8;
    });
    this.boom = this.boom.filter(function (p) { p.x += p.vx; p.y += p.vy; p.vx *= 0.94; p.vy *= 0.94; return ++p.t < p.max; });
    if (this.treme > 0) { this.treme--; }
    // encostou: item, chefe, inimigo
    for (var q = 0; q < js.length; q++) {
      var h = js[q]; if (h.morto || (h.n !== 2 && this.morto)) { continue; }
      var caixa = { x: h.x + 2, y: h.y + 2, w: h.w - 4, h: h.h - 4 };
      for (var k = 0; k < this.objs.length; k++) {
        var o = this.objs[k];
        if (!o.vivo || !o.ativo || !bate(caixa, o)) { continue; }
        if (o.tipo === 'poder') {
          o.vivo = false; var da = o.def.da || 'escudo';
          if (da === 'nivel') { h.nivel = Math.min(4, (h.nivel || 1) + 1); } else if (da === 'bomba') { h.bombas = Math.min(5, (h.bombas || 0) + 1); } else { h.poder = da; }
          this.som.efeito('poder'); if (this.evento) { this.evento('pegou_' + da, { jogador: h.n || 1 }); }
        } else if (o.tipo === 'coletavel') { o.vivo = false; this.pontos += o.def.pontos || 100; this.som.efeito('moeda'); }
        else if (o.tipo === 'fim_de_fase') { this.concluirFase(); return; }
        else if (o.tipo === 'inimigo' && !h.invuln) {
          if ((o.def.vida || 1) < 5 && !o.parte) { this.ferirInimigo(o, 99, h.n || 1); }
          if (h.n === 2) { this.ferir2(h); } else { this.ferir(o.def.comportamento || 'patrulha'); if (this.morto) { return; } }
          break;
        }
      }
    }
  };
  Nave.prototype.atirarEm = function (o) {
    var js = this.jogadores().filter(function (h) { return !h.morto; }); if (!js.length) { return; }
    var h = js[(o.t >> 4) % js.length], T = this.T, w = Math.max(2, T >> 2);
    var dx = (h.x + h.w / 2) - (o.x + o.w / 2), dy = (h.y - o.y), d = Math.sqrt(dx * dx + dy * dy) || 1, sp = 1.5 * this.esc;
    this.tirosInim.push({ x: o.x + o.w / 2 - w / 2, y: o.y + o.h / 2, w: w, h: w, vx: dx / d * sp, vy: dy / d * sp });
  };
  // 🖼 30/10/2026: cenários prontos da casa (vista aérea 256×512, peças CC0 do Kenney compostas pela casa) — fase.ladrilho.imagem
  // 30/10 (tarde): também em ALTA (1024×2048 = 4×): o cenário sempre ocupa 256 de largura no jogo; na pele pixel a casa
  // reduz a imagem com suavização uma vez (fica limpa), e no Turbinado/HD ela entra inteira (a tela é Z vezes maior).
  var CENARIOS_URL = '/estudio/fliperama/hd/cenarios/', CENARIOS_IMG = {}, CEN_LARG = 256;
  function imagemCenario(id) {
    var c = CENARIOS_IMG[id];
    if (!c) {
      c = CENARIOS_IMG[id] = { im: new Image(), red: null };
      c.im.decoding = 'async';
      c.im.onerror = function () { if (!/\.jpg$/.test(c.im.src)) { c.im.src = CENARIOS_URL + encodeURIComponent(id) + '.jpg'; } };   // os HD são .jpg
      c.im.src = CENARIOS_URL + encodeURIComponent(id) + '.png';
    }
    var im = c.im;
    if (!(im.complete && im.naturalWidth)) { return null; }
    var k = CEN_LARG / im.naturalWidth, w = CEN_LARG, h = Math.round(im.naturalHeight * k);
    if (k < 1 && !c.red) {   // a versão reduzida (pele pixel), em passos de 1/2 para não serrilhar
      var src = im, sw = im.naturalWidth, sh = im.naturalHeight;
      while (sw / 2 >= w) { var t = document.createElement('canvas'); t.width = Math.round(sw / 2); t.height = Math.round(sh / 2); var tx = t.getContext('2d'); tx.imageSmoothingEnabled = true; tx.imageSmoothingQuality = 'high'; tx.drawImage(src, 0, 0, t.width, t.height); src = t; sw = t.width; sh = t.height; }
      c.red = src;
    }
    return { w: w, h: h, quadros: [k < 1 ? c.red : im], alta: k < 1 ? im : null };
  }
  Nave.prototype.desenharMundo = function (ctx) {
    var f = this.fase || {}, fs = f.ladrilho && (f.ladrilho.imagem ? imagemCenario(f.ladrilho.imagem) : this.sprites[f.ladrilho.sprite]);
    if (fs && fs.quadros && fs.quadros.length) {   // 🖼 fundo em ladrilho, rolando mais devagar que o mapa (parece longe)
      var vel = clamp(f.ladrilho.vel == null ? 0.5 : f.ladrilho.vel, 0, 1), sw = fs.w, sh = fs.h;
      var fina = fs.alta && ctx.getTransform && ctx.getTransform().a > 1.5, img = fina ? fs.alta : fs.quadros[0];
      var x0 = this.cam.x, y0 = this.cam.y, sy0 = (((-y0 * vel) % sh) + sh) % sh - sh;
      if (fina) { ctx.save(); ctx.imageSmoothingEnabled = true; }
      for (var sy = sy0; sy < this.H; sy += sh) {
        for (var sx = 0; sx < this.W + sw; sx += sw) { ctx.drawImage(img, Math.round(x0 + sx), Math.round(y0 + sy), sw, sh); }
      }
      if (fina) { ctx.restore(); }
    }
    naveDesenharMundo0.call(this, ctx);
    if (!this.esq) { return; }
    var self = this;
    if (this.h2 && this.j2ativo && !this.h2.fora && !this.h2.morto && !(this.h2.invuln && (this.quadro >> 2) % 2)) {
      var s2 = this.sprites[this.h2.sprite], q2 = s2 && s2.quadros.length > 1 && this.h2.inclina ? 1 : 0;
      this.desenharSprite(ctx, this.h2.sprite, Math.round(this.h2.x), Math.round(this.h2.y), q2, this.h2.inclina < 0);
    }
    if (f.nuvens) {   // ☁ nuvens por cima, mais rápidas (dá a sensação de altura)
      ctx.globalAlpha = 0.32; ctx.fillStyle = '#FFFFFF';
      for (var k = 0; k < 7; k++) {
        var nx = ((k * 97) % Math.max(1, this.larg)), ny = this.cam.y + ((k * 61 + this.quadro * (0.6 + (k % 3) * 0.25)) % (this.H + 60)) - 30;
        ctx.fillRect(Math.round(nx), Math.round(ny), 34 + (k % 3) * 14, 7 + (k % 2) * 4); ctx.fillRect(Math.round(nx) + 6, Math.round(ny) - 4, 20, 5);
      }
      ctx.globalAlpha = 1;
    }
    this.objs.forEach(function (o) { if (o.vivo && o.blindado && (self.quadro >> 1) % 2) { ctx.strokeStyle = '#5CE1E6'; ctx.strokeRect(Math.round(o.x) - 1, Math.round(o.y) - 1, o.w + 2, o.h + 2); } });
  };
  Nave.prototype.desenharTiros = function (ctx) {
    if (!this.esq) { return Base.prototype.desenharTiros.call(this, ctx); }
    var cor = this.spec.cores || {}, dest = cor.destaque || '#F8B800';
    (this.tiros || []).forEach(function (b) { ctx.fillStyle = b.cor || (b.dono === 2 ? '#3CBCFC' : dest); ctx.fillRect(Math.round(b.x), Math.round(b.y), b.w, b.h); });
    ctx.fillStyle = '#FF6B6B';
    (this.tirosInim || []).forEach(function (b) { ctx.fillRect(Math.round(b.x), Math.round(b.y), b.w, b.h); });
  };
  Nave.prototype.desenharHeroi = function (ctx, virar) {
    if (!this.esq) { return naveHeroi0.call(this, ctx, virar); }
    var h = this.heroi;
    if (this.morto) { return; }
    if (h.invuln && (this.quadro >> 2) % 2) { return; }
    var s = this.sprites[h.sprite], q = s && s.quadros.length > 1 && h.inclina ? 1 : 0;
    this.desenharSprite(ctx, h.sprite, Math.round(h.x), Math.round(h.y), q, h.inclina < 0);
  };
  Nave.prototype.hud = function (ctx) {
    if (!this.esq) { return naveHud0.call(this, ctx); }
    var cor = this.spec.cores || {}, tinta = cor.texto || '#FCFCFC', W = this.W, H = this.H, h = this.heroi, h2 = this.h2;
    texto(ctx, '1P ' + this.pontos, 4, 2, tinta, 1);
    texto(ctx, 'P' + (h.nivel || 1) + ' B' + (h.bombas || 0) + ' x' + Math.max(0, this.vidas), 4, 10, cor.destaque || '#F8B800', 1);
    if (this.j2ativo && h2) {
      var t2 = '2P ' + (this.pontos2 || 0); texto(ctx, t2, W - larguraTexto(t2, 1) - 4, 2, '#3CBCFC', 1);
      var b2 = h2.fora ? 'FORA' : 'P' + (h2.nivel || 1) + ' B' + (h2.bombas || 0) + ' x' + Math.max(0, h2.vidas); texto(ctx, b2, W - larguraTexto(b2, 1) - 4, 10, '#3CBCFC', 1);
    } else if ((this.quadro >> 5) % 2 === 0) { var j = 'F: 2P'; texto(ctx, j, W - larguraTexto(j, 1) - 4, 2, cor.apagado || '#7C7C7C', 1); }
    textoCentro(ctx, this.textoMeio(), W, 2, tinta, 1);
    if (this.flash) { ctx.globalAlpha = this.flash / 24; ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; }
  };
  Nave.prototype.escolherPiloto = function (inp) {
    var ps = this.pilotos, n = ps.length, j2 = inp.j2 || {}, a2 = j2.apertou || function () { return false; };
    this.quadro++;
    if (inp.apertou('mudo')) { this.som.alternarMudo(); }
    if (inp.apertou('esq')) { this.sel[0] = (this.sel[0] + n - 1) % n; this.som.efeito('pulo'); }
    if (inp.apertou('dir')) { this.sel[0] = (this.sel[0] + 1) % n; this.som.efeito('pulo'); }
    if (!this.j2ativo && (a2('pulo') || a2('start'))) { this.j2ativo = true; this.sel[1] = (this.sel[0] + 1) % n; this.som.efeito('poder'); if (this.evento) { this.evento('dois_jogadores', {}); } return; }
    if (this.j2ativo) {
      if (a2('esq')) { this.sel[1] = (this.sel[1] + n - 1) % n; this.som.efeito('pulo'); }
      if (a2('dir')) { this.sel[1] = (this.sel[1] + 1) % n; this.som.efeito('pulo'); }
    }
    if (inp.apertou('start') || inp.apertou('pulo')) {
      this.som.ligar(); this.quadro = 0; this.rng = mulberry32(this.semente);
      this.pontos = 0; this.pontos2 = 0; this.vidas = this.vidasIniciais; this.vidas2 = this.vidasIniciais;
      this.heroi.nivel = 1; this.heroi.bombas = 2; this.h2 = null;
      this.carregarFase(0); this.estado = 'jogando';
      if (this.evento) { this.evento('escolheu_piloto', { piloto: (ps[this.sel[0]] || {}).nome || '', dois: !!this.j2ativo }); }
    }
  };
  Nave.prototype.desenharEscolha = function (ctx) {
    var W = this.W, H = this.H, spec = this.spec, cor = spec.cores || {}, ps = this.pilotos, n = ps.length, self = this;
    var tinta = cor.texto || '#FCFCFC', dest = cor.destaque || '#F8B800';
    ctx.fillStyle = cor.fundo || '#000000'; ctx.fillRect(0, 0, W, H);
    textoCentro(ctx, spec.titulo || 'MEU JOGO', W, Math.floor(H * 0.1), dest, 2);
    textoCentro(ctx, 'ESCOLHA O SEU PILOTO', W, Math.floor(H * 0.1) + 20, tinta, 1);
    var larg = Math.floor(W / n), y = Math.floor(H * 0.38);
    ps.forEach(function (p, i) {
      var cx = larg * i + larg / 2, s = self.sprites[p.sprite];
      if (s) { self.desenharSprite(ctx, p.sprite, Math.round(cx - s.w / 2), y, (self.quadro >> 4), false); }
      var nm = String(p.nome || ('PILOTO ' + (i + 1))).toUpperCase().slice(0, 10), an = (ARMAS_ESQ[p.arma] || ARMAS_ESQ.reto).nome;
      texto(ctx, nm, Math.round(cx - larguraTexto(nm, 1) / 2), y + 34, tinta, 1);
      texto(ctx, an, Math.round(cx - larguraTexto(an, 1) / 2), y + 44, cor.apagado || '#9C9C9C', 1);
      if (self.sel[0] === i) { ctx.strokeStyle = dest; ctx.strokeRect(Math.round(cx - larg / 2) + 3, y - 8, larg - 6, 64); texto(ctx, '1P', Math.round(cx - larg / 2) + 6, y - 6, dest, 1); }
      if (self.j2ativo && self.sel[1] === i) { ctx.strokeStyle = '#3CBCFC'; ctx.strokeRect(Math.round(cx - larg / 2) + 5, y - 6, larg - 10, 60); texto(ctx, '2P', Math.round(cx + larg / 2) - 18, y - 6, '#3CBCFC', 1); }
    });
    if ((this.quadro >> 5) % 2 === 0) { textoCentro(ctx, '<  >  ESCOLHE    ESPACO COMECA', W, Math.floor(H * 0.74), tinta, 1); }
    textoCentro(ctx, this.j2ativo ? 'JOGADOR 2: A D ESCOLHE' : 'JOGADOR 2: APERTE F', W, Math.floor(H * 0.74) + 12, '#3CBCFC', 1);
    textoCentro(ctx, 'C OU B: BOMBA', W, H - 14, cor.apagado || '#7C7C7C', 1);
    desenharRecorde(ctx, this, W, H);
  };
  var naveAtualizar0 = Base.prototype.atualizar, naveDesenhar0 = Base.prototype.desenhar;
  Nave.prototype.atualizar = function (inp) {
    if (this.esq && this.pilotos.length) {
      if (this.estado === 'titulo') { return this.escolherPiloto(inp); }
      if ((this.estado === 'fim_jogo' || this.estado === 'vitoria') && (inp.apertou('pulo') || inp.apertou('start'))) { this.quadro++; this.estado = 'titulo'; return; }
    }
    return naveAtualizar0.call(this, inp);
  };
  Nave.prototype.desenhar = function (ctx) {
    if (this.esq && this.pilotos.length && this.estado === 'titulo') { return this.desenharEscolha(ctx); }
    return naveDesenhar0.call(this, ctx);
  };
  Nave.prototype.roboEntrada = function (mem, desajeitado, rng) {
    var e = naveRobo0.call(this, mem, desajeitado, rng);
    if (!this.esq && this.chefeNaTela()) {   // 👑 31/10: a tela parou na luta — o robô fica embaixo do chefe e atira
      var h0 = this.heroi, cam = this.cam.y, ch = null;
      this.objs.forEach(function (o) { if (!ch && o.vivo && o.tipo === 'inimigo' && !o.parte && (o.def.vida || 1) >= 5 && o.y >= cam) { ch = o; } });
      if (ch && !(desajeitado && mem.f % 7 === 0)) {
        var alvoX = ch.x + ch.w / 2 - h0.w / 2 + (this.rio ? -(h0.vx || 0) * 3.5 : 0);
        e.esq = alvoX < h0.x - 1; e.dir = alvoX > h0.x + 1; e.pulo = true; e.cima = false; e.baixo = false;
      }
    }
    if (this.esq) {   // o robô também solta bomba quando a tela enche de tiros
      var h = this.heroi, perto = (this.tirosInim || []).filter(function (b) { return Math.abs(b.x - h.x) < 24 && Math.abs(b.y - h.y) < 30; }).length;
      e.bomba = perto >= 3 && (h.bombas || 0) > 0 && !mem.bombou; mem.bombou = e.bomba ? 40 : Math.max(0, (mem.bombou || 0) - 1);
      e.pulo = true;
    }
    return e;
  };
  Nave.prototype.moverInim = function (o) {   // 🌊 'onda' (desce em zigue-zague largo) e 'mergulho' (desce e vem na sua direção)
    var c = o.def.comportamento, T = this.T;
    if (c === 'onda') { if (o.x0 == null) { o.x0 = o.x; } o.y += 0.5 * this.esc; o.x = clamp(o.x0 + Math.sin(o.t / 18) * T * 3, 0, this.larg - o.w); this.atiraSePode(o); return; }
    if (c === 'mergulho') {
      var h = this.heroi; o.y += (h.y - o.y < T * 8 ? 1.3 : 0.35) * this.esc;
      o.x += clamp((h.x + h.w / 2) - (o.x + o.w / 2), -1, 1) * 0.7 * this.esc; this.atiraSePode(o); return;
    }
    return naveMover0.call(this, o);
  };
  Nave.prototype.atiraSePode = function (o) { if (o.def.atira && o.t % 100 === 50 && o.y < this.heroi.y) { this.atirarEm(o); } };
  var Corrida = herdar(function Corrida(spec, perfil, sprites, som, semente) { Base.call(this, spec, perfil, sprites, som, semente); this.atira = false; },
                       'SETAS DIRIGEM  NAO BATA  M SOM');
  ['montarFase', 'renascer', 'passo', 'moverInim', 'textoMeio', 'desenharMundo', 'roboEntrada', 'cartaDirInicial', 'cartaVel', 'cartaMover', 'chefeNaTela', 'chefeAFrente'].forEach(function (k) { Corrida.prototype[k] = Nave.prototype[k]; });

  // ───────────────────────── 👾 TIRO FIXO: a formação desce, você atira de baixo ─────────────────────────
  var TiroFixo = herdar(function TiroFixo(spec, perfil, sprites, som, semente) { Base.call(this, spec, perfil, sprites, som, semente); },
                        'SETAS MOVEM  ESPACO ATIRA  M SOM');
  TiroFixo.prototype.tempoMax = 150;
  TiroFixo.prototype.montarFase = function (f) {
    this.lerMapa(f);
    var h = this.heroi, T = this.T;
    h.x = this.inicio.x + (T - h.w) / 2; h.y = this.inicio.y + T - h.h;
    this.inims = this.objs.filter(function (o) { return o.tipo === 'inimigo'; });
    this.total = this.inims.length; this.dirF = 1; this.tiros = []; this.tirosInim = []; this.esfria = 0;
    this.seguir(this.larg / 2, this.alt / 2);
  };
  TiroFixo.prototype.renascer = function () {
    if (this.invadiu) { this.invadiu = false; this.carregarFase(this.faseIdx); return; }
    this.heroi.x = this.inicio.x; this.tiros = []; this.tirosInim = []; this.heroi.invuln = 60;
  };
  TiroFixo.prototype.passo = function (inp) {
    var h = this.heroi, T = this.T, self = this, v = 1.6 * this.esc * this.vel;
    if (inp.esq) { h.x -= v; } if (inp.dir) { h.x += v; }
    h.x = clamp(h.x, 0, this.larg - h.w); h.anda = !!(inp.esq || inp.dir);
    if (this.esfria > 0) { this.esfria--; }
    var maxTiros = this.heroi.poder === 'tiro_duplo' ? 3 : 1;
    if (inp.pulo && this.esfria <= 0 && this.tiros.length < maxTiros) {
      var w = Math.max(1, T >> 3), hh = Math.max(3, T >> 1);
      this.tiros.push({ x: h.x + h.w / 2 - w / 2, y: h.y - hh, w: w, h: hh }); this.esfria = 14; this.som.efeito('pulo');
    }
    var vivos = this.inims.filter(function (o) { return o.vivo; });
    if (!vivos.length) { this.concluirFase(); return; }
    var vel = 0.22 * this.esc * (1 + 2.2 * (1 - vivos.length / Math.max(1, this.total))) * (1 + 0.15 * this.faseIdx);
    // 🃏 quem tem cartas anda do jeito das cartas; a formação da casa continua para os outros
    var forma = vivos.filter(function (o) { return !Cartas.tem(o); });
    vivos.forEach(function (o) { if (Cartas.tem(o)) { o.t++; Cartas.passo(self, o); } });
    Cartas.fimDoQuadro(this);
    forma.forEach(function (o) { o.t++; o.x += self.dirF * vel * clamp(o.def.velocidade || 0.6, 0.2, 3) / 0.6; });
    if (forma.some(function (o) { return o.x < 0 || o.x + o.w > self.larg; })) {
      this.dirF = -this.dirF;
      forma.forEach(function (o) { o.x = clamp(o.x, 0, self.larg - o.w); o.y += T / 2; });
    }
    if (this.morto) { return; }
    vivos = vivos.filter(function (o) { return o.vivo; });
    if (vivos.some(function (o) { return o.y + o.h >= h.y; })) { this.invadiu = true; this.ferir('invasao'); return; }
    if (!forma.length) { vivos = []; }
    var cad = Math.max(25, 70 - 6 * this.faseIdx - Math.floor(30 * (1 - vivos.length / Math.max(1, this.total))));
    if (vivos.length && this.quadro % cad === 0 && this.tirosInim.length < 3) {   // atira quem está mais embaixo na coluna
      var o = vivos[Math.floor(this.rng() * vivos.length)];
      var baixo = vivos.filter(function (x) { return Math.abs(x.x - o.x) < T / 2; }).sort(function (a, b) { return b.y - a.y; })[0];
      var w2 = Math.max(1, T >> 3);
      this.tirosInim.push({ x: baixo.x + baixo.w / 2, y: baixo.y + baixo.h, w: w2, h: Math.max(3, T >> 1), vx: 0, vy: 1.3 * this.esc });
    }
    this.tiros = this.tiros.filter(function (b) {
      b.y -= Math.max(3.5 * self.esc, self.H / 45);
      var hit = self.caixaBate(b.x, b.y, b.w, b.h); if (hit) { self.quebrar(hit.i, hit.j); return false; }
      for (var k = 0; k < self.inims.length; k++) {
        var vk = self.inims[k];
        if (vk.vivo && bate(b, vk)) {
          if (Cartas.tem(vk) && Cartas.atingido(self, vk, 'tiro')) { return false; }
          vk.vivo = false; self.pontos += vk.def.pontos || 100; self.som.efeito('pisao'); return false;
        }
      }
      for (var q = 0; q < self.objs.length; q++) { var c = self.objs[q]; if (c.vivo && c.tipo !== 'inimigo' && bate(b, c)) { c.vivo = false; if (c.tipo === 'poder') { h.poder = c.def.da || 'tiro_duplo'; self.som.efeito('poder'); } else { self.pontos += c.def.pontos || 300; self.som.efeito('moeda'); } return false; } }
      return b.y + b.h > 0;
    });
    this.tirosInim = this.tirosInim.filter(function (b) {
      b.y += b.vy; b.x += b.vx || 0;
      var hit = self.caixaBate(b.x, b.y, b.w, b.h); if (hit) { self.quebrar(hit.i, hit.j); return false; }
      if (bate(b, h, 1)) { self.ferir('tiro'); return false; }
      return b.y < self.alt && b.y > -self.T && b.x > -self.T && b.x < self.larg + self.T;
    });
    // inimigo com cartas que encosta no herói
    for (var q2 = 0; q2 < this.inims.length && !this.morto; q2++) { var oc = this.inims[q2]; if (oc.vivo && Cartas.tem(oc) && bate(oc, h, 1)) { Cartas.encostou(this, oc); } }
  };
  TiroFixo.prototype.bordaEmGrupo = true;
  TiroFixo.prototype.maxTirosCartas = 4;
  TiroFixo.prototype.cartaDirInicial = function () { return [this.dirF || 1, 0]; };
  TiroFixo.prototype.cartaVel = function (o) { return 0.22 * this.esc * 1.8 * clamp(o.def.velocidade || 0.6, 0.2, 3) / 0.6 * (1 + 0.15 * this.faseIdx); };
  TiroFixo.prototype.cartaMover = function (o, dx, dy) {
    var res = {};
    o.x += dx; o.y += dy;
    if (o.x < 0) { o.x = 0; res.borda = true; } else if (o.x + o.w > this.larg) { o.x = this.larg - o.w; res.borda = true; }
    if (o.y < 0) { o.y = 0; }
    o.vx = dx;
    return res;
  };
  TiroFixo.prototype.textoMeio = function () { return 'FASE ' + (this.faseIdx + 1) + '  RESTAM ' + this.inims.filter(function (o) { return o.vivo; }).length; };
  TiroFixo.prototype.desenharMundo = function (ctx) { this.desenharTiles(ctx); this.desenharObjs(ctx); this.desenharTiros(ctx); this.desenharHeroi(ctx, false); };
  TiroFixo.prototype.roboEntrada = function (mem, desajeitado, rng) {
    var h = this.heroi, T = this.T, cx = h.x + h.w / 2;
    if (this.morto) { return {}; }
    mem.f = (mem.f || 0) + 1;
    var perigo = (this.tirosInim || []).filter(function (b) { return b.y > h.y - T * (desajeitado ? 2 : 5) && b.y < h.y + h.h && Math.abs(b.x - cx) < T * 1.1; })[0];
    if (perigo && (!desajeitado || rng() < 0.6)) { var foge = perigo.x < cx ? 1 : -1; if (h.x < T && foge < 0) { foge = 1; } if (h.x > this.larg - h.w - T && foge > 0) { foge = -1; } return { esq: foge < 0, dir: foge > 0 }; }
    var vivos = this.inims.filter(function (o) { return o.vivo; });
    if (!vivos.length) { return {}; }
    if (mem.alvoO == null || !mem.alvoO.vivo || mem.f % 90 === 0) {
      vivos.sort(function (a, b) { return (b.y - a.y) * 4 + Math.abs(a.x - h.x) - Math.abs(b.x - h.x); });
      mem.alvoO = desajeitado && rng() < 0.3 ? vivos[Math.floor(rng() * vivos.length)] : vivos[0];
    }
    var o = mem.alvoO, alvo = o.x + o.w / 2 + this.dirF * T * 0.4;
    if (desajeitado && mem.f % 3 === 0) { return {}; }
    return { esq: alvo < cx - 2, dir: alvo > cx + 2, pulo: Math.abs(alvo - cx) < T * 0.7 && mem.f % 2 === 0 };
  };

  // ───────────────────────── 🐸 TRAVESSIA: atravesse as faixas (carros) e o rio (de carona) ─────────────────────────
  var Travessia = herdar(function Travessia(spec, perfil, sprites, som, semente) { Base.call(this, spec, perfil, sprites, som, semente); },
                         'SETAS PULAM  CHEGUE AO OUTRO LADO  M SOM');
  Travessia.prototype.montarFase = function (f) {
    this.lerMapa(f);
    var self = this, T = this.T, P = this.larg + 2 * T;
    this.periodo = P;
    this.objs.forEach(function (o) {
      if (o.tipo === 'inimigo' || o.tipo === 'carona') {
        var sentido = o.def.direcao === 'dir' ? 1 : (o.def.direcao === 'esq' ? -1 : (o.j % 2 ? 1 : -1));
        o.vx = sentido * clamp(o.def.velocidade || 0.6, 0.1, 3) * 0.55 * self.esc * (1 + 0.1 * self.faseIdx);
      }
    });
    this.renascer();
  };
  Travessia.prototype.renascer = function () {
    var h = this.heroi, T = this.T;
    h.ci = this.inicio.i; h.cj = this.inicio.j; h.x = h.ci * T + (T - h.w) / 2; h.y = h.cj * T + (T - h.h) / 2; h.salto = 0; h.melhor = h.cj; h.olhando = 1;
    this.seguir(h.x, h.y);
  };
  Travessia.prototype.moverObjs = function () {
    var P = this.periodo, T = this.T;
    var self = this;
    this.objs.forEach(function (o) {
      if (o.vivo && Cartas.tem(o)) { o.t++; Cartas.passo(self, o); return; }
      if (!o.vx) { return; }
      o.t++; o.x += o.vx;
      if (o.x >= P - T - o.w) { o.x -= P; } else if (o.x < -T - o.w) { o.x += P; }   // módulo exato (o robô prevê com a mesma conta)
    });
  };
  Travessia.prototype.caronaEm = function (cx, cy) {
    for (var k = 0; k < this.objs.length; k++) { var o = this.objs[k]; if (o.vivo && o.tipo === 'carona' && cx >= o.x - 1 && cx < o.x + o.w + 1 && cy >= o.y - 1 && cy < o.y + o.h + 1) { return o; } }
    return null;
  };
  Travessia.prototype.passo = function (inp) {
    var h = this.heroi, T = this.T;
    this.moverObjs();
    if (h.salto > 0) {
      h.salto--; h.x += h.sx; h.y += h.sy;
      if (h.salto === 0) { h.ci = Math.round((h.x - (T - h.w) / 2) / T); h.cj = Math.round((h.y - (T - h.h) / 2) / T); if (h.cj < h.melhor) { this.pontos += 10; h.melhor = h.cj; } }
    } else {
      var d = apertouDir(inp);
      if (d) {
        var ni = Math.round((h.x - (T - h.w) / 2) / T) + d[0], nj = h.cj + d[1], t = this.tile(ni, nj);
        if (!(t && t.solido)) { h.salto = 8; h.sx = (ni * T + (T - h.w) / 2 - h.x) / 8; h.sy = (nj * T + (T - h.h) / 2 - h.y) / 8; if (d[0]) { h.olhando = d[0]; } this.som.efeito('pulo'); }
      } else {
        var c = this.caronaEm(h.x + h.w / 2, h.y + h.h / 2);
        if (c) { h.x += c.vx; }
        var tt = this.tile(Math.floor((h.x + h.w / 2) / T), h.cj);
        if (!c && tt && tt.mortal) { this.ferir('agua'); return; }
        if (h.x < -T / 2 || h.x + h.w > this.larg + T / 2) { this.ferir('correnteza'); return; }
      }
    }
    h.anda = h.salto > 0;
    var caixa = { x: h.x + 1, y: h.y + 1, w: h.w - 2, h: h.h - 2 };
    for (var k = 0; k < this.objs.length; k++) {
      var o = this.objs[k];
      if (!o.vivo || !bate(caixa, o, 1)) { continue; }
      if (o.tipo === 'inimigo' && Cartas.tem(o)) { Cartas.encostou(this, o); if (this.morto) { return; } continue; }
      if (o.tipo === 'inimigo') { this.ferir(o.def.comportamento || 'faixa'); return; }
      if (o.tipo === 'coletavel') { o.vivo = false; this.pontos += o.def.pontos || 100; this.som.efeito('moeda'); }
      else if (o.tipo === 'poder') { o.vivo = false; h.poder = o.def.da || 'escudo'; this.som.efeito('poder'); }
      else if (o.tipo === 'fim_de_fase' && h.salto === 0) { this.concluirFase(); return; }
    }
    Cartas.tirosBase(this); if (this.morto) { return; }
    if (h.salto === 0 && h.cj === 0) { this.concluirFase(); return; }   // chegou na linha de cima: atravessou
    this.seguir(h.x, h.y);
  };
  Travessia.prototype.cartaDirInicial = function (o) { return [o.vx >= 0 ? 1 : -1, 0]; };
  Travessia.prototype.cartaVel = function (o) { return clamp(o.def.velocidade || 0.6, 0.1, 3) * 0.55 * this.esc * (1 + 0.1 * this.faseIdx); };
  Travessia.prototype.cartaMover = function (o, dx, dy) {   // a faixa dá a volta: quem sai de um lado entra pelo outro
    var P = this.periodo, T = this.T;
    o.x += dx; o.y = clamp(o.y + dy, 0, this.alt - o.h);
    if (o.x >= P - T - o.w) { o.x -= P; } else if (o.x < -T - o.w) { o.x += P; }
    o.vx = dx; o.j = Math.floor((o.y + o.h / 2) / T);
    return {};
  };
  Travessia.prototype.desenharMundo = function (ctx) {
    this.desenharTiles(ctx);
    var self = this;
    this.desenharObjs(ctx, function (o) { return o.tipo === 'carona'; });
    this.desenharObjs(ctx, function (o) { return o.tipo !== 'carona'; });
    this.desenharHeroi(ctx, this.heroi.olhando < 0);
  };
  // 🤖 só pula para a casa que vai continuar segura (prevê onde cada carro e cada tronco vão estar)
  Travessia.prototype.seguroEm = function (cx, cj, t0, t1, montado) {
    var T = this.T, P = this.periodo, self = this, tt = this.tile(Math.floor(cx / T), cj);
    if (tt && tt.solido) { return false; }
    for (var t = t0; t <= t1; t += 2) {
      var x = cx, carona = null;
      for (var k = 0; k < this.objs.length; k++) {
        var o = this.objs[k];
        if (!o.vivo || o.j !== cj || !(o.tipo === 'inimigo' || o.tipo === 'carona')) { continue; }
        var ox = o.x + o.vx * t; ox = ((ox + T + o.w) % P + P) % P - T - o.w;
        if (o.tipo === 'carona' && x >= ox - 1 && x < ox + o.w + 1) { carona = o; }
        if (o.tipo === 'inimigo' && x > ox - T * 0.9 && x < ox + o.w + T * 0.9) { return false; }
      }
      if (tt && tt.mortal && !carona) { return false; }
      if (carona && montado) { cx += carona.vx * 2; if (cx < T / 2 || cx > self.larg - T / 2) { return false; } }
    }
    return true;
  };
  Travessia.prototype.roboEntrada = function (mem, desajeitado, rng) {
    var h = this.heroi, T = this.T;
    if (this.morto || h.salto > 0) { return {}; }
    if (mem.solto) { mem.solto = false; return {}; }
    if (mem.espera > 0) { mem.espera--; return {}; }
    var cx = h.x + h.w / 2, olhar = desajeitado ? 20 : Math.max(4, 26 - Math.floor((mem.esperou || 0) / 12));   // esperou muito: arrisca mais
    var ops = [[0, -1], [0, 0], [-1, 0], [1, 0], [0, 1]], escolha = null;
    for (var k = 0; k < ops.length; k++) {
      var d = ops[k];
      if (d[0] === 0 && d[1] === 0) { if (this.seguroEm(cx, h.cj, 0, olhar, true)) { escolha = d; break; } continue; }
      if (d[1] === 0 && cx + d[0] * T < T / 2) { continue; }
      if (d[1] === 0 && cx + d[0] * T > this.larg - T / 2) { continue; }
      if (this.seguroEm(cx + d[0] * T, h.cj + d[1], d[1] ? 2 : 4, 8 + olhar, true) && this.seguroEm(cx, h.cj, 0, 8, true)) { escolha = d; break; }
    }
    if (desajeitado && (mem.esperou || 0) === 40 && rng() < 0.35) { escolha = [0, -1]; }   // impaciente: às vezes pula sem olhar
    if (!escolha) { escolha = [0, 0]; }
    var noRio = !!(this.tile(Math.floor(cx / T), h.cj) || {}).mortal;   // na água, perto da borda: sai antes de a correnteza levar
    if (noRio && cx < T * 1.5 && escolha[0] === 0 && escolha[1] === 0) { escolha = [1, 0]; }
    if (noRio && cx > this.larg - T * 1.5 && escolha[0] === 0 && escolha[1] === 0) { escolha = [-1, 0]; }
    if (escolha[0] === 0 && escolha[1] === 0) { mem.esperou = (mem.esperou || 0) + 1; return {}; }
    mem.esperou = 0; mem.solto = true; if (desajeitado) { mem.espera = 6; }
    return entradaDeDir(escolha);
  };

  // ───────────────────────── 🏓 ESPORTE: partida contra a máquina (raquete embaixo, a da máquina em cima) ─────────────────────────
  var Esporte = herdar(function Esporte(spec, perfil, sprites, som, semente) { Base.call(this, spec, perfil, sprites, som, semente); },
                       'SETAS MOVEM A RAQUETE  M SOM');
  Esporte.prototype.tempoMax = 180;
  Esporte.prototype.montarFase = function (f) {
    var T = this.T, W = this.W, H = this.H, larg = clamp((this.spec.heroi || {}).largura || 3, 2, 6) * T, hh = Math.max(2, T >> 2);
    this.mapa = []; this.linhas = 0; this.colunas = 0; this.objs = []; this.larg = W; this.alt = H; this.cam = { x: 0, y: 0 };
    this.eu = { x: W / 2 - larg / 2, y: H - T * 2, w: larg, h: hh };
    this.cpu = { x: W / 2 - larg / 2, y: T * 2 + 4, w: larg, h: hh };
    this.alvo = clamp(f.pontos || 5, 1, 15); this.habil = clamp(f.cpu == null ? 0.5 : f.cpu, 0.1, 1);
    this.placar = [0, 0]; this.saque = 1; this.velBola = Math.max(1.6 * this.esc, H / 85) * (1 + 0.12 * this.faseIdx);
    this.novoPonto();
  };
  Esporte.prototype.renascer = function () { this.placar = [0, 0]; this.novoPonto(); };
  Esporte.prototype.novoPonto = function () {
    var s = Math.max(2, this.T >> 2);
    this.bola = { x: this.W / 2 - s / 2, y: this.H / 2, w: s, h: s, vx: 0, vy: 0, espera: 60 };
    this.erroCpu = (this.rng() * 2 - 1) * (1 - this.habil) * this.T * 2.5;
  };
  Esporte.prototype.passo = function (inp) {
    var e = this.eu, c = this.cpu, b = this.bola, T = this.T, v = 2.3 * this.esc * this.vel, self = this;
    if (inp.esq) { e.x -= v; } if (inp.dir) { e.x += v; }
    e.x = clamp(e.x, 0, this.W - e.w);
    this.heroi.x = e.x; this.heroi.y = e.y; this.heroi.w = e.w; this.heroi.h = e.h;
    if (b.espera > 0) {
      if (--b.espera === 0) { var a = this.rng() * 0.8 - 0.4; b.vx = this.velBola * Math.sin(a); b.vy = this.velBola * Math.cos(a) * this.saque; }
      return;
    }
    if (this.j2ativo && inp.j2) {   // 👥 2 jogadores: a raquete de cima é do jogador 2
      if (inp.j2.esq) { c.x -= v; } if (inp.j2.dir) { c.x += v; }
      c.x = clamp(c.x, 0, this.W - c.w);
    } else {
      var vc = (0.8 + 1.6 * this.habil) * this.esc, alvo = b.vy < 0 ? b.x + b.w / 2 + this.erroCpu : this.W / 2;
      var cc = c.x + c.w / 2; c.x += clamp(alvo - cc, -vc, vc); c.x = clamp(c.x, 0, this.W - c.w);
    }
    var n = Math.max(1, Math.ceil(Math.max(Math.abs(b.vx), Math.abs(b.vy)) / (b.w / 2)));
    for (var k = 0; k < n; k++) {
      b.x += b.vx / n; b.y += b.vy / n;
      if (b.x < 0 || b.x + b.w > this.W) { b.x = clamp(b.x, 0, this.W - b.w); b.vx = -b.vx; }
      [[e, -1], [c, 1]].forEach(function (par) {
        var r = par[0];
        if ((par[1] < 0 ? b.vy > 0 : b.vy < 0) && bate(b, r)) {
          var rel = clamp(((b.x + b.w / 2) - (r.x + r.w / 2)) / (r.w / 2), -1, 1), ang = rel * 1.0;
          var vv = Math.min(self.velBola * 2, Math.sqrt(b.vx * b.vx + b.vy * b.vy) * 1.04);
          b.vx = vv * Math.sin(ang); b.vy = par[1] * vv * Math.cos(ang); b.y = par[1] < 0 ? r.y - b.h : r.y + r.h;
          self.som.efeito('pisao'); if (par[1] > 0) { self.erroCpu = (self.rng() * 2 - 1) * (1 - self.habil) * T * 2.5; }
        }
      });
    }
    if (b.y > this.H) { this.placar[1]++; this.saque = 1; this.som.efeito('dano'); this.fimPonto(); }
    else if (b.y + b.h < 0) { this.placar[0]++; this.pontos += 100; this.saque = -1; this.som.efeito('moeda'); this.fimPonto(); }
  };
  Esporte.prototype.fimPonto = function () {
    if (this.j2ativo) {   // 👥 partida entre os dois: ninguém perde vida; quem chegar primeiro vence a fase
      if (this.placar[0] >= this.alvo || this.placar[1] >= this.alvo) {
        var v1 = this.placar[0] >= this.alvo; this.vitorias = this.vitorias || [0, 0]; this.vitorias[v1 ? 0 : 1]++;
        this.msgFase = 'JOGADOR ' + (v1 ? 1 : 2) + ' VENCEU!'; this.concluirFase(); return;
      }
      this.novoPonto(); return;
    }
    if (this.placar[0] >= this.alvo) { this.pontos += 1000; this.concluirFase(); return; }
    if (this.placar[1] >= this.alvo) { this.ferir('partida'); return; }
    this.novoPonto();
  };
  Esporte.prototype.textoMeio = function () { return this.j2ativo ? 'J1 ' + this.placar[0] + ' X ' + this.placar[1] + ' J2' : 'VOCE ' + this.placar[0] + ' X ' + this.placar[1] + ' CPU'; };
  Esporte.prototype.desenharMundo = function (ctx) {
    var cor = this.spec.cores || {}, e = this.eu, c = this.cpu, b = this.bola, W = this.W, H = this.H, T = this.T;
    ctx.fillStyle = cor.apagado || '#7C7C7C';
    for (var x = 0; x < W; x += T) { ctx.fillRect(x, Math.floor(H / 2), Math.max(1, T >> 1), 1); }
    ctx.fillStyle = cor.destaque || '#F8B800'; ctx.fillRect(Math.round(e.x), Math.round(e.y), e.w, e.h);
    ctx.fillStyle = cor.texto || '#FCFCFC'; ctx.fillRect(Math.round(c.x), Math.round(c.y), c.w, c.h);
    var hs = this.sprites[(this.spec.heroi || {}).sprite];
    if (hs) { this.desenharSprite(ctx, this.spec.heroi.sprite, Math.round(e.x + e.w / 2 - hs.w / 2), Math.round(e.y + e.h + 1), 0, false); }
    var rival = null, ents = this.spec.entidades || {};
    Object.keys(ents).forEach(function (k) { if (!rival && ents[k].tipo === 'inimigo') { rival = ents[k].sprite; } });
    var rs = rival && this.sprites[rival];
    if (rs) { this.desenharSprite(ctx, rival, Math.round(c.x + c.w / 2 - rs.w / 2), Math.round(c.y - rs.h - 1), this.quadro >> 4, false); }
    if (!(this.morto && (this.quadro >> 2) % 2)) { ctx.fillStyle = cor.texto || '#FCFCFC'; ctx.fillRect(Math.round(b.x), Math.round(b.y), b.w, b.h); }
  };
  Esporte.prototype.roboEntrada = function (mem, desajeitado, rng) {
    var e = this.eu, b = this.bola;
    if (this.morto || b.espera > 0) { return {}; }
    var alvo = this.W / 2;
    if (b.vy > 0) {
      var t = (e.y - (b.y + b.h)) / b.vy, x = b.x + b.w / 2 + b.vx * t;
      for (var k = 0; k < 8 && (x < 0 || x > this.W); k++) { x = x < 0 ? -x : 2 * this.W - x; }
      if (mem.vy !== 1) { mem.vy = 1; mem.ofs = (rng() * 1.4 - 0.7) * e.w / 2; }
      alvo = x + mem.ofs;
    } else { mem.vy = -1; }
    if (desajeitado) { mem.h = mem.h || []; mem.h.push(alvo); alvo = mem.h.length > 12 ? mem.h.shift() : alvo; if ((mem.f = (mem.f || 0) + 1) % 3 === 0) { return {}; } }
    var c = e.x + e.w / 2;
    return { esq: alvo < c - 2, dir: alvo > c + 2 };
  };
  Esporte.prototype.objetoEm = function (sx, sy) {
    var f = this.faseIdx + 1;
    if (bate({ x: sx, y: sy, w: 1, h: 1 }, { x: this.eu.x, y: this.eu.y - this.T * 2, w: this.eu.w, h: this.T * 3 })) { return { tipo: 'heroi', sprite: (this.spec.heroi || {}).sprite, fase: f }; }
    if (bate({ x: sx, y: sy, w: 1, h: 1 }, { x: this.cpu.x, y: this.cpu.y - this.T * 2, w: this.cpu.w, h: this.T * 3 })) { return { tipo: 'inimigo', comportamento: 'cpu', fase: f }; }
    return { tipo: 'ceu', fase: f };
  };

  // ───────────────────────── ❓ QUIZ: perguntas com 2 a 4 respostas (errar custa uma vida) ─────────────────────────
  var Quiz = herdar(function Quiz(spec, perfil, sprites, som, semente) { Base.call(this, spec, perfil, sprites, som, semente); },
                    'SETAS ESCOLHEM  ESPACO OU OK RESPONDE');
  function quebrarLinhas(s, max) {
    var out = [], linha = '';
    String(s || '').split(/\s+/).forEach(function (p) {
      while (p.length > max) { if (linha) { out.push(linha); linha = ''; } out.push(p.slice(0, max)); p = p.slice(max); }
      if (!p) { return; }
      if ((linha + ' ' + p).trim().length > max) { out.push(linha); linha = p; } else { linha = (linha + ' ' + p).trim(); }
    });
    if (linha) { out.push(linha); }
    return out;
  }
  Quiz.prototype.montarFase = function (f) {
    this.mapa = []; this.objs = []; this.larg = this.W; this.alt = this.H; this.cam = { x: 0, y: 0 };
    this.perguntas = (f.perguntas || []).filter(function (p) { return p && p.opcoes && p.opcoes.length; });
    this.qi = 0; this.sel = 0; this.sel2 = 0; this.mostrar = 0; this.acertou = null; this.resp1 = null; this.resp2 = null;
    if (this.faseIdx === 0) { this.pontos2 = 0; }
  };
  Quiz.prototype.renascer = function () { /* a vida perdida já foi descontada; segue a mesma fase */ };
  Quiz.prototype.passo = function (inp) {
    var p = this.perguntas[this.qi];
    if (!p) { this.concluirFase(); return; }
    if (this.mostrar > 0) {
      if (--this.mostrar === 0 || ((inp.apertou('pulo')) && this.mostrar < 100)) {
        this.mostrar = 0;
        if (this.vidas <= 0) { this.estado = 'fim_jogo'; this.som.parar(); return; }
        this.qi++; this.sel = 0; this.sel2 = 0; this.acertou = null; this.acertou2 = null; this.resp1 = null; this.resp2 = null;
        if (this.qi >= this.perguntas.length) { this.concluirFase(); }
      }
      return;
    }
    var n = p.opcoes.length;
    if (this.j2ativo && inp.j2) {   // 👥 os dois respondem; a resposta aparece quando os dois escolheram
      var j2 = inp.j2;
      if (this.resp1 == null) {
        if (inp.apertou('cima') || inp.apertou('esq')) { this.sel = (this.sel + n - 1) % n; this.som.efeito('pisao'); }
        if (inp.apertou('baixo') || inp.apertou('dir')) { this.sel = (this.sel + 1) % n; this.som.efeito('pisao'); }
        if (inp.apertou('pulo')) { this.resp1 = this.sel; }
      }
      if (this.resp2 == null) {
        if (j2.apertou('cima') || j2.apertou('esq')) { this.sel2 = ((this.sel2 || 0) + n - 1) % n; this.som.efeito('pisao'); }
        if (j2.apertou('baixo') || j2.apertou('dir')) { this.sel2 = ((this.sel2 || 0) + 1) % n; this.som.efeito('pisao'); }
        if (j2.apertou('pulo')) { this.resp2 = this.sel2 || 0; }
      }
      if (this.resp1 != null && this.resp2 != null) {
        this.acertou = this.resp1 === p.certa; this.acertou2 = this.resp2 === p.certa;
        if (this.acertou) { this.pontos += 100; } if (this.acertou2) { this.pontos2 = (this.pontos2 || 0) + 100; }
        this.som.efeito(this.acertou || this.acertou2 ? 'moeda' : 'dano'); this.mostrar = 150;
      }
      return;
    }
    if (inp.apertou('cima') || inp.apertou('esq')) { this.sel = (this.sel + n - 1) % n; this.som.efeito('pisao'); }
    if (inp.apertou('baixo') || inp.apertou('dir')) { this.sel = (this.sel + 1) % n; this.som.efeito('pisao'); }
    if (inp.apertou('pulo')) {
      this.acertou = this.sel === p.certa;
      if (this.acertou) { this.pontos += 100; this.som.efeito('moeda'); this.mostrar = p.explica ? 120 : 50; }
      else { this.vidas--; this.ultimoDano = 'resposta'; this.som.efeito('dano'); this.mostrar = 160; }
    }
  };
  Quiz.prototype.textoMeio = function () { if (this.j2ativo) { return 'J1 ' + this.pontos + ' X ' + (this.pontos2 || 0) + ' J2'; } return 'PERGUNTA ' + Math.min(this.qi + 1, this.perguntas.length) + '/' + this.perguntas.length; };
  Quiz.prototype.desenharMundo = function (ctx) {
    var cor = this.spec.cores || {}, W = this.W, H = this.H, T = this.T, p = this.perguntas[this.qi], tinta = cor.texto || '#FCFCFC', dest = cor.destaque || '#F8B800';
    if (!p) { return; }
    var max = Math.floor((W - 12) / 4), y = 16;
    var hs = this.sprites[(this.spec.heroi || {}).sprite];
    if (hs) { this.desenharSprite(ctx, this.spec.heroi.sprite, W - hs.w - 6, y, this.quadro >> 4, false); max = Math.floor((W - hs.w - 18) / 4); }
    quebrarLinhas(p.pergunta, max).slice(0, 6).forEach(function (l) { texto(ctx, l, 6, y, tinta, 1); y += 8; });
    y += 6;
    var self = this, maxO = Math.floor((W - 22) / 4);
    p.opcoes.forEach(function (o, i) {
      var linhas = quebrarLinhas(o, maxO).slice(0, 2), on = i === self.sel;
      var c = tinta;
      if (self.mostrar && i === p.certa) { c = cor.destaque || '#F8B800'; }
      else if (self.mostrar && on && !self.acertou) { c = '#F83800'; }
      else if (on) { c = dest; }
      if (on && !self.mostrar && !(self.j2ativo && self.resp1 != null)) { texto(ctx, '>', 6, y, dest, 1); }
      if (self.j2ativo && i === (self.sel2 || 0) && !self.mostrar && self.resp2 == null) { texto(ctx, '<', W - 10, y, '#3CBCFC', 1); }
      linhas.forEach(function (l) { texto(ctx, l, 14, y, c, 1); y += 8; });
      y += 3;
    });
    if (this.j2ativo && !this.mostrar) {
      y += 4; texto(ctx, (this.resp1 != null ? 'J1 PRONTO' : 'J1 ...') + '   ' + (this.resp2 != null ? 'J2 PRONTO' : 'J2 ...'), 6, y, tinta, 1);
    }
    if (this.mostrar) {
      y += 4;
      if (this.j2ativo) { texto(ctx, 'J1 ' + (this.acertou ? 'CERTO' : 'ERROU') + '   J2 ' + (this.acertou2 ? 'CERTO' : 'ERROU'), 6, y, dest, 1); y += 9; }
      else { texto(ctx, this.acertou ? 'CERTO!' : 'NAO FOI DESSA VEZ', 6, y, this.acertou ? dest : '#F83800', 1); y += 9; }
      if (p.explica) { quebrarLinhas(p.explica, Math.floor((W - 12) / 4)).slice(0, 4).forEach(function (l) { texto(ctx, l, 6, y, tinta, 1); y += 8; }); }
    }
  };
  Quiz.prototype.roboEntrada = function (mem, desajeitado, rng) {
    var p = this.perguntas[this.qi];
    if (!p) { return {}; }
    if (mem.solto) { mem.solto = false; return {}; }
    if (this.mostrar > 0) { if (this.mostrar < 90) { mem.solto = true; return { pulo: true }; } return {}; }
    if (mem.qi !== this.qi) { mem.qi = this.qi; mem.alvo = desajeitado && rng() < 0.25 ? (p.certa + 1) % p.opcoes.length : p.certa; mem.pensa = desajeitado ? 40 : 6; }
    if (mem.pensa > 0) { mem.pensa--; return {}; }
    mem.solto = true;
    if (this.sel !== mem.alvo) { return { baixo: true }; }
    return { pulo: true };
  };
  Quiz.prototype.objetoEm = function () { return { tipo: 'pergunta', fase: this.faseIdx + 1, pergunta: this.qi + 1 }; };

  // ═══════════════════════════ E5 · aventura, RPG e briga de rua (25/10/2026) ═══════════════════════════
  function movimentoLivre(jogo, c, dx, dy) {   // anda com colisão nos blocos sólidos (eixo por eixo, desliza nas quinas)
    var m = 2;
    if (dx) { c.x += dx; if (jogo.caixaBate(c.x + m, c.y + m, c.w - 2 * m, c.h - 2 * m) || c.x < 0 || c.x + c.w > jogo.larg) { c.x -= dx; return false; } }
    if (dy) { c.y += dy; if (jogo.caixaBate(c.x + m, c.y + m, c.w - 2 * m, c.h - 2 * m) || c.y < 0 || c.y + c.h > jogo.alt) { c.y -= dy; return false; } }
    return true;
  }
  var OLHAR = { esq: [-1, 0], dir: [1, 0], cima: [0, -1], baixo: [0, 1] };

  // ───────────────────────── 🗝 AVENTURA: salas, chaves, portas e o tesouro ─────────────────────────
  var Aventura = herdar(function Aventura(spec, perfil, sprites, som, semente) { Base.call(this, spec, perfil, sprites, som, semente); },
                        'SETAS ANDAM  ESPACO ATACA  ACHE O TESOURO');
  Aventura.prototype.tempoMax = 180;
  Aventura.prototype.tile = function (i, j) {
    var t = Base.prototype.tile.call(this, i, j);
    if (t && t.porta) { return { solido: true, porta: true, cor: t.cor, borda: t.borda, sprite: t.sprite }; }
    return t;
  };
  Aventura.prototype.salaW = function () { return this.W; };
  Aventura.prototype.salaH = function () { return this.H - Math.max(8, this.T); };
  Aventura.prototype.montarFase = function (f) {
    this.lerMapa(f);
    var h = this.heroi, T = this.T, self = this;
    h.x = this.inicio.x + (T - h.w) / 2; h.y = this.inicio.y + (T - h.h) / 2; h.olhar = [0, 1]; h.golpe = 0; h.olhando = 1;
    this.chaves = 0; this.v = 1.3 * this.esc * this.vel;
    this.objs.forEach(function (o) { if (o.tipo === 'inimigo') { o.vida = o.def.vida || 2; o.dir = [0, 0]; o.troca = 0; o.dano = 0; } });
    this.posicionarCam();
  };
  Aventura.prototype.renascer = function () { this.heroi.invuln = 120; this.heroi.golpe = 0; };   // continua na mesma sala
  Aventura.prototype.posicionarCam = function () {
    var h = this.heroi, sw = this.salaW(), sh = this.salaH(), topo = this.H - sh;
    var cx = h.x + h.w / 2, cy = h.y + h.h / 2;
    this.cam.x = this.larg <= this.W ? -Math.floor((this.W - this.larg) / 2) : Math.min(this.larg - this.W, Math.floor(cx / sw) * sw);
    this.cam.y = this.alt <= sh ? -topo : Math.min(this.alt - sh, Math.floor(cy / sh) * sh) - topo;
  };
  Aventura.prototype.naTela = function (o) { return o.x + o.w > this.cam.x && o.x < this.cam.x + this.W && o.y + o.h > this.cam.y && o.y < this.cam.y + this.H; };
  Aventura.prototype.caixaGolpe = function () {
    var h = this.heroi, T = this.T, d = h.olhar;
    return { x: h.x + h.w / 2 - T / 2 + d[0] * T * 0.9, y: h.y + h.h / 2 - T / 2 + d[1] * T * 0.9, w: T, h: T };
  };
  Aventura.prototype.passo = function (inp) {
    var h = this.heroi, T = this.T, self = this, v = this.v;
    var dx = (inp.dir ? 1 : 0) - (inp.esq ? 1 : 0), dy = (inp.baixo ? 1 : 0) - (inp.cima ? 1 : 0);
    if (h.golpe > 0) { h.golpe--; dx = 0; dy = 0; }
    if (dx || dy) { h.olhar = dx ? [dx, 0] : [0, dy]; if (dx) { h.olhando = dx; } }
    h.anda = !!(dx || dy);
    // porta: encostou com chave, abre
    if (dx || dy) {
      var fx = h.x + h.w / 2 + h.olhar[0] * (h.w / 2 + 2), fy = h.y + h.h / 2 + h.olhar[1] * (h.h / 2 + 2);
      var ci = Math.floor(fx / T), cj = Math.floor(fy / T), td = (this.spec.tiles || {})[(this.mapa[cj] || [])[ci]];
      if (td && td.porta && this.chaves > 0) {   // 25/10/2026: a chave abre a porta INTEIRA (porta larga = vários blocos juntos)
        this.chaves--; this.pontos += 50; this.som.efeito('poder');
        var mp = this.mapa, pch = mp[cj][ci], pilha = [[cj, ci]];
        while (pilha.length) {
          var pp = pilha.pop(), py = pp[0], px = pp[1];
          if (py < 0 || py >= mp.length || px < 0 || px >= mp[py].length || mp[py][px] !== pch) { continue; }
          mp[py][px] = '.'; pilha.push([py + 1, px], [py - 1, px], [py, px + 1], [py, px - 1]);
        }
      }
    }
    // ajuda de quina (como nos jogos de aventura clássicos): bateu de lado perto da passagem? escorrega para alinhar
    if (dx && !movimentoLivre(this, h, dx * v, 0)) {
      var ay = Math.round((h.y - (T - h.h) / 2) / T) * T + (T - h.h) / 2 - h.y;
      if (ay && Math.abs(ay) < T * 0.45) { movimentoLivre(this, h, 0, clamp(ay, -v, v)); }
    }
    if (dy && !movimentoLivre(this, h, 0, dy * v)) {
      var ax = Math.round((h.x - (T - h.w) / 2) / T) * T + (T - h.w) / 2 - h.x;
      if (ax && Math.abs(ax) < T * 0.45) { movimentoLivre(this, h, clamp(ax, -v, v), 0); }
    }
    if (inp.apertou('pulo') && h.golpe <= 0) { h.golpe = 14; this.som.efeito('pulo'); }
    var golpe = h.golpe > 6 ? this.caixaGolpe() : null;
    this.objs.forEach(function (o) {
      if (!o.vivo || o.tipo !== 'inimigo' || !self.naTela(o)) { return; }
      o.t++;
      if (o.dano > 0) { o.dano--; movimentoLivre(self, o, o.kx, o.ky); return; }
      if (Cartas.tem(o)) {
        Cartas.passo(self, o);
        if (o.vivo && golpe && bate(golpe, o)) {
          o.dano = 14; o.kx = h.olhar[0] * 2 * self.esc; o.ky = h.olhar[1] * 2 * self.esc; self.som.efeito('pisao');
          if (!Cartas.atingido(self, o, 'golpe')) { o.vida--; if (o.vida <= 0) { o.vivo = false; self.pontos += o.def.pontos || 100; } }
        }
        return;
      }
      var c = o.def.comportamento || 'patrulha', vo = clamp(o.def.velocidade || 0.6, 0.1, 3) * 0.9 * self.esc;
      var ddx = (h.x - o.x), ddy = (h.y - o.y), dist = Math.sqrt(ddx * ddx + ddy * ddy);
      if (c === 'persegue' && dist < T * 6) {
        var ax = Math.abs(ddx) > Math.abs(ddy) ? [ddx > 0 ? 1 : -1, 0] : [0, ddy > 0 ? 1 : -1];
        if (o.t % 30 === 0 || !(o.dir[0] || o.dir[1])) { o.dir = ax; }
      } else if (c !== 'parado' && (--o.troca <= 0)) { o.dir = DIRS4[Math.floor(self.rng() * 4)]; o.troca = 40 + Math.floor(self.rng() * 60); }
      if (c !== 'parado' && !movimentoLivre(self, o, o.dir[0] * vo, o.dir[1] * vo)) { o.troca = 0; o.dir = DIRS4[Math.floor(self.rng() * 4)]; }
      if (golpe && bate(golpe, o)) {
        o.vida--; o.dano = 14; o.kx = h.olhar[0] * 2 * self.esc; o.ky = h.olhar[1] * 2 * self.esc; self.som.efeito('pisao');
        if (o.vida <= 0) { o.vivo = false; self.pontos += o.def.pontos || 100; }
      }
    });
    var caixa = { x: h.x + 2, y: h.y + 2, w: h.w - 4, h: h.h - 4 };
    for (var k = 0; k < this.objs.length; k++) {
      var o = this.objs[k];
      if (!o.vivo || !bate(caixa, o)) { continue; }
      if (o.tipo === 'chave') { o.vivo = false; this.chaves++; this.som.efeito('moeda'); }
      else if (o.tipo === 'coletavel') { o.vivo = false; this.pontos += o.def.pontos || 100; this.som.efeito('moeda'); }
      else if (o.tipo === 'poder') { o.vivo = false; h.poder = o.def.da || 'escudo'; this.som.efeito('poder'); }
      else if (o.tipo === 'fim_de_fase') { this.pontos += 500; this.concluirFase(); return; }
      else if (o.tipo === 'inimigo' && o.dano <= 0 && Cartas.tem(o)) { Cartas.encostou(this, o); if (this.morto) { return; } }
      else if (o.tipo === 'inimigo' && o.dano <= 0) { this.ferir(o.def.comportamento || 'patrulha'); return; }
    }
    Cartas.tirosBase(this);
    this.posicionarCam();
  };
  Aventura.prototype.textoMeio = function () { return 'FASE ' + (this.faseIdx + 1) + '  CHAVES ' + this.chaves; };
  Aventura.prototype.desenharMundo = function (ctx) {
    this.desenharTiles(ctx);
    var self = this;
    this.objs.forEach(function (o) { if (o.vivo && self.naTela(o) && !(o.dano && (self.quadro >> 1) % 2)) { self.desenharObj(ctx, o, o.t >> 3, Cartas.tem(o) ? o.vx > 0 : (o.dir && o.dir[0] > 0)); } });
    this.desenharHeroi(ctx, this.heroi.olhando < 0);
    if (this.heroi.golpe > 6) {
      var g = this.caixaGolpe(), cor = this.spec.cores || {};
      ctx.fillStyle = cor.destaque || '#F8B800';
      var h = this.heroi, d = h.olhar, L = this.T * 0.8, e = Math.max(2, this.T >> 3);
      if (d[0]) { ctx.fillRect(Math.round(d[0] > 0 ? h.x + h.w : h.x - L), Math.round(h.y + h.h / 2 - e / 2), Math.round(L), e); }
      else { ctx.fillRect(Math.round(h.x + h.w / 2 - e / 2), Math.round(d[1] > 0 ? h.y + h.h : h.y - L), e, Math.round(L)); }
    }
  };
  // 🤖 caminho (BFS pela grade) até o tesouro; se uma porta fecha o caminho e não há chave, vai buscar a chave
  Aventura.prototype.roboEntrada = function (mem, desajeitado, rng) {
    var h = this.heroi, T = this.T, self = this;
    if (this.morto) { return {}; }
    mem.f = (mem.f || 0) + 1;
    if (mem.solto) { mem.solto = false; return {}; }
    // inimigo perto: vira para ele e ataca
    var alvoI = null, dmin = 1e9;
    this.objs.forEach(function (o) {
      if (!o.vivo || o.tipo !== 'inimigo' || !self.naTela(o)) { return; }
      var dx = (o.x + o.w / 2) - (h.x + h.w / 2), dy = (o.y + o.h / 2) - (h.y + h.h / 2), d = Math.abs(dx) + Math.abs(dy);
      if (d < dmin) { dmin = d; alvoI = { dx: dx, dy: dy }; }
    });
    if (alvoI && dmin < T * (desajeitado ? 1.4 : 2.2)) {
      var lado = Math.abs(alvoI.dx) > Math.abs(alvoI.dy) ? [alvoI.dx > 0 ? 1 : -1, 0] : [0, alvoI.dy > 0 ? 1 : -1];
      if (h.olhar[0] !== lado[0] || h.olhar[1] !== lado[1]) { return entradaDeDir(lado); }
      if (h.golpe <= 0 && (!desajeitado || rng() < 0.5)) { mem.solto = true; return { pulo: true }; }
      return {};
    }
    var ci = Math.floor((h.x + h.w / 2) / T), cj = Math.floor((h.y + h.h / 2) / T), tiles = this.spec.tiles || {};
    function bfs(alvoTipo, podePorta) {
      var alvos = {};
      self.objs.forEach(function (o) { if (o.vivo && o.tipo === alvoTipo) { alvos[Math.floor((o.x + o.w / 2) / T) + ',' + Math.floor((o.y + o.h / 2) / T)] = 1; } });
      var vis = {}, fila = [[ci, cj, null]]; vis[ci + ',' + cj] = 1;
      while (fila.length) {
        var c = fila.shift();
        if (alvos[c[0] + ',' + c[1]]) { return { passo: c[2] || [0, 0], i: c[0], j: c[1] }; }
        for (var k = 0; k < 4; k++) {
          var d = DIRS4[k], ni = c[0] + d[0], nj = c[1] + d[1], key = ni + ',' + nj;
          if (vis[key] || ni < 0 || nj < 0 || ni >= self.colunas || nj >= self.linhas) { continue; }
          var td = tiles[self.mapa[nj][ni]];
          if (td && td.solido && !(td.porta && podePorta)) { continue; }
          vis[key] = 1; fila.push([ni, nj, c[2] || [ni, nj]]);
        }
      }
      return null;
    }
    if (mem.f % 6 === 1 || !mem.prox) {
      var r = bfs('fim_de_fase', this.chaves > 0) || bfs('chave', this.chaves > 0) || bfs('fim_de_fase', true);
      mem.prox = r ? r.passo : null;
      if (desajeitado && rng() < 0.08) { mem.prox = [ci + DIRS4[Math.floor(rng() * 4)][0], cj + DIRS4[Math.floor(rng() * 4)][1]]; }
    }
    if (!mem.prox) { return {}; }
    var tx = mem.prox[0] * T + T / 2, ty = mem.prox[1] * T + T / 2, cx = h.x + h.w / 2, cy = h.y + h.h / 2, e = {}, tol = this.v * 0.6;
    var ox = Math.abs(tx - cx) > tol, oy = Math.abs(ty - cy) > tol;
    if (ox && oy) {   // fora dos dois eixos: anda no eixo em que já está mais perto (centraliza antes de virar)
      if (Math.abs(ty - cy) < Math.abs(tx - cx)) { e[ty > cy ? 'baixo' : 'cima'] = true; } else { e[tx > cx ? 'dir' : 'esq'] = true; }
    } else if (ox) { e[tx > cx ? 'dir' : 'esq'] = true; }
    else if (oy) { e[ty > cy ? 'baixo' : 'cima'] = true; }
    return e;
  };

  // ───────────────────────── 👊 BRIGA DE RUA: a rua anda para a direita, as ondas te seguram ─────────────────────────
  var Briga = herdar(function Briga(spec, perfil, sprites, som, semente) { Base.call(this, spec, perfil, sprites, som, semente); },
                     'SETAS ANDAM  ESPACO SOCA  VA PARA A DIREITA');
  Briga.prototype.tempoMax = 180;
  Briga.prototype.montarFase = function (f) {
    this.lerMapa(f);
    var h = this.heroi, T = this.T, self = this;
    h.x = this.inicio.x; h.y = this.inicio.y + T - h.h; h.olhando = 1; h.soco = 0; h.combo = 0; h.ultimoSoco = 0; this.h2 = null;
    this.v = 1.2 * this.esc * this.vel;
    this.objs.forEach(function (o) {
      if (o.tipo === 'inimigo') { o.vida = o.def.vida || 3; o.ativo = false; o.prep = 0; o.dano = 0; o.y = o.j * T + T - o.h; o.olhando = -1; o.espera = 20 + Math.floor(self.rng() * 40); }
    });
    this.cam.x = 0; this.cam.y = this.alt <= this.H ? -(this.H - this.alt) : this.alt - this.H;
  };
  Briga.prototype.renascer = function () {
    var self = this;
    this.herois().forEach(function (h) { h.invuln = 120; h.soco = 0; });
  };
  Briga.prototype.herois = function () {   // 👥 co-op: o 2º herói entra quando o jogador 2 está ligado
    var h = this.heroi;
    if (this.j2ativo) {
      if (!this.h2) {
        this.h2 = { x: h.x, y: Math.min(h.y + this.T, this.alt - h.h), w: h.w, h: h.h, olhando: 1, soco: 0, combo: 0, ultimoSoco: 0, invuln: 60, poder: null, anda: false, n: 2 };
      }
      return [h, this.h2];
    }
    this.h2 = null;
    return [h];
  };
  Briga.prototype.travaX = function () {   // a câmera não passa do primeiro inimigo vivo (a onda segura a rua)
    var lim = this.larg - this.W, T = this.T;
    for (var k = 0; k < this.objs.length; k++) {
      var o = this.objs[k];
      if (o.vivo && o.tipo === 'inimigo') { lim = Math.min(lim, Math.max(0, o.x + o.w + T * 2 - this.W)); }
    }
    return Math.max(0, lim);
  };
  Briga.prototype.moverHeroi = function (h, inp) {
    var T = this.T, self = this, v = this.v;
    var dx = (inp.dir ? 1 : 0) - (inp.esq ? 1 : 0), dy = (inp.baixo ? 1 : 0) - (inp.cima ? 1 : 0);
    if (h.invuln && h !== this.heroi) { h.invuln--; }
    if (h.soco > 0) { h.soco--; dx = 0; dy = 0; }
    if (dx) { h.olhando = dx; }
    h.anda = !!(dx || dy);
    movimentoLivre(this, h, dx * v, 0); movimentoLivre(this, h, 0, dy * v * 0.7);
    h.x = clamp(h.x, this.cam.x, this.cam.x + this.W - h.w);
    if (inp.apertou('pulo') && h.soco <= 0) {
      h.combo = (this.quadro - h.ultimoSoco < 30) ? (h.combo + 1) % 3 : 0; h.ultimoSoco = this.quadro;
      h.soco = h.combo === 2 ? 16 : 10; this.som.efeito('pulo');
      var alcance = { x: h.olhando > 0 ? h.x + h.w * 0.5 : h.x - T * 0.9, y: h.y + h.h * 0.3, w: h.w * 0.5 + T * 0.9, h: h.h * 0.6 };
      this.objs.forEach(function (o) {
        if (!o.vivo || o.tipo !== 'inimigo' || !o.ativo) { return; }
        if (Math.abs((o.y + o.h) - (h.y + h.h)) > T * 0.7 || !bate(alcance, o)) { return; }
        o.prep = 0; o.dano = h.combo === 2 ? 30 : 12; o.kx = h.olhando * (h.combo === 2 ? 3 : 1) * self.esc;
        self.pontos += 20; self.som.efeito('pisao');
        if (Cartas.tem(o) && Cartas.atingido(self, o, h.combo === 2 ? 'combo' : 'soco')) { return; }
        o.vida -= h.combo === 2 ? 2 : 1;
        if (o.vida <= 0) { o.vivo = false; self.pontos += o.def.pontos || 100; }
      });
    }
  };
  Briga.prototype.passo = function (inp) {
    var T = this.T, self = this, hs = this.herois();
    this.moverHeroi(hs[0], inp);
    if (hs[1]) { this.moverHeroi(hs[1], inp.j2 || entradaDe({}, {})); }
    var topo = this.cam.x - T, fim = this.cam.x + this.W + T;
    this.objs.forEach(function (o) {
      if (!o.vivo || o.tipo !== 'inimigo') { return; }
      if (!o.ativo) { if (o.x < fim && o.x + o.w > topo) { o.ativo = true; } else { return; } }
      o.t++;
      if (o.dano > 0) { o.dano--; movimentoLivre(self, o, o.kx * (o.dano > 6 ? 1 : 0), 0); return; }
      if (o.espera > 0) { o.espera--; return; }
      // persegue o herói mais perto
      var h = hs[0];
      if (hs[1] && Math.abs(hs[1].x - o.x) + Math.abs(hs[1].y - o.y) < Math.abs(hs[0].x - o.x) + Math.abs(hs[0].y - o.y)) { h = hs[1]; }
      var ddx = (h.x + h.w / 2) - (o.x + o.w / 2), ddy = (h.y + h.h) - (o.y + o.h), vo = clamp(o.def.velocidade || 0.6, 0.1, 3) * 0.8 * self.esc;
      o.olhando = ddx > 0 ? 1 : -1;
      var perto = Math.abs(ddx) < (h.w + o.w) / 2 + T * 0.3 && Math.abs(ddy) < T * 0.5;
      if (o.prep > 0) {
        if (--o.prep === 0) {
          if (perto && !h.invuln) {
            if (h === self.heroi) { self.quemApanhou = 1; self.ferir(o.def.comportamento || 'persegue'); }
            else {   // co-op: as vidas são do time; o jogador 2 pisca e o time perde uma vida
              h.invuln = 120; self.vidas--; self.som.efeito('dano');
              if (self.evento) { self.evento('dano', { jogador: 2 }); }
              if (self.vidas <= 0) { self.quemApanhou = 2; self.vidas = 1; self.heroi.invuln = 0; self.ferir('persegue'); }
            }
          }
          o.espera = 40 + Math.floor(self.rng() * 40);
        }
        return;
      }
      if (Cartas.tem(o)) { o.alvoH = h; Cartas.passo(self, o); if (o.vivo && perto) { Cartas.encostou(self, o); } return; }
      if (perto) { o.prep = (o.def.vida || 3) >= 10 ? 14 : 18; return; }
      var c = o.def.comportamento || 'persegue';
      if (c === 'parado') { return; }
      var alvoX = ddx > 0 ? h.x - o.w - T * 0.1 : h.x + h.w + T * 0.1;
      movimentoLivre(self, o, clamp(alvoX - o.x, -vo, vo), 0);
      movimentoLivre(self, o, 0, clamp(ddy, -vo * 0.7, vo * 0.7));
    });
    for (var q = 0; q < hs.length; q++) {
      var hh = hs[q], caixa = { x: hh.x + 2, y: hh.y + 2, w: hh.w - 4, h: hh.h - 4 };
      for (var k = 0; k < this.objs.length; k++) {
        var o2 = this.objs[k];
        if (!o2.vivo || o2.tipo === 'inimigo' || !bate(caixa, o2)) { continue; }
        if (o2.tipo === 'coletavel') { o2.vivo = false; this.pontos += o2.def.pontos || 100; this.som.efeito('moeda'); }
        else if (o2.tipo === 'poder') { o2.vivo = false; hh.poder = o2.def.da || 'escudo'; this.som.efeito('poder'); }
        else if (o2.tipo === 'fim_de_fase') {
          if (!this.objs.some(function (x) { return x.vivo && x.tipo === 'inimigo'; })) { this.pontos += 500; this.concluirFase(); return; }
        }
      }
    }
    Cartas.tirosBase(this);
    var cx = hs.reduce(function (s, h) { return s + h.x + h.w / 2; }, 0) / hs.length;
    var alvo = clamp(cx - this.W / 2, 0, this.travaX());
    this.cam.x = Math.max(this.cam.x, Math.min(alvo, this.cam.x + 3 * this.esc));
  };
  Briga.prototype.cartaDirInicial = function () { return [-1, 0]; };
  Briga.prototype.cartaVel = function (o) { return clamp(o.def.velocidade || 0.6, 0.1, 3) * 0.8 * this.esc; };
  Briga.prototype.cartaDano = function (o) { if (!o.prep) { o.prep = (o.def.vida || 3) >= 10 ? 14 : 18; } };   // o soco do inimigo tem aviso (prepara e bate)
  Briga.prototype.cartaMover = function (o, dx, dy, v) {
    var cv = o.cv, h = o.alvoH || this.heroi, T = this.T;
    if (cv.modo === 'persegue') {
      var ddx = (h.x + h.w / 2) - (o.x + o.w / 2), ddy = (h.y + h.h) - (o.y + o.h);
      var alvoX = ddx > 0 ? h.x - o.w - T * 0.1 : h.x + h.w + T * 0.1;
      movimentoLivre(this, o, clamp(alvoX - o.x, -v, v), 0); movimentoLivre(this, o, 0, clamp(ddy, -v * 0.7, v * 0.7));
      o.olhando = ddx > 0 ? 1 : -1; return {};
    }
    var r = Cartas.moverLivre(this, o, dx, dy * 0.7);
    if (dx) { o.olhando = dx > 0 ? 1 : -1; }
    return r;
  };
  Briga.prototype.textoMeio = function () {
    var resta = this.objs.filter(function (o) { return o.vivo && o.tipo === 'inimigo' && o.ativo; }).length;
    return resta ? 'FASE ' + (this.faseIdx + 1) + '  INIMIGOS ' + resta : ((this.quadro >> 4) % 2 ? 'SIGA >>' : 'FASE ' + (this.faseIdx + 1));
  };
  Briga.prototype.desenharMundo = function (ctx) {
    this.desenharTiles(ctx);
    var self = this, lista = this.objs.filter(function (o) { return o.vivo && (o.tipo !== 'inimigo' || o.ativo); });
    lista.push({ heroi: true, y: this.heroi.y, h: this.heroi.h });
    if (this.h2) { lista.push({ heroi2: true, y: this.h2.y, h: this.h2.h }); }
    lista.sort(function (a, b) { return (a.y + a.h) - (b.y + b.h); });   // quem está mais embaixo fica na frente
    var cor = this.spec.cores || {};
    lista.forEach(function (o) {
      if (o.heroi2) {
        var h2 = self.h2;
        if (!(h2.invuln && (self.quadro >> 2) % 2)) { self.desenharSprite(ctx, (self.spec.heroi || {}).sprite, Math.round(h2.x), Math.round(h2.y), h2.anda ? (self.quadro >> 3) : 0, h2.olhando < 0); }
        texto(ctx, '2', Math.round(h2.x + h2.w / 2 - 1), Math.round(h2.y - 7), '#3CBCFC', 1);
        if (h2.soco > 4) { ctx.fillStyle = '#3CBCFC'; var e2 = Math.max(2, self.T >> 2); ctx.fillRect(Math.round(h2.olhando > 0 ? h2.x + h2.w : h2.x - e2 * 2), Math.round(h2.y + h2.h * 0.4), e2 * 2, e2); }
        return;
      }
      if (o.heroi) {
        self.desenharHeroi(ctx, self.heroi.olhando < 0);
        var h = self.heroi;
        if (self.h2) { texto(ctx, '1', Math.round(h.x + h.w / 2 - 1), Math.round(h.y - 7), cor.destaque || '#F8B800', 1); }
        if (h.soco > 4) { ctx.fillStyle = cor.destaque || '#F8B800'; var e = Math.max(2, self.T >> 2); ctx.fillRect(Math.round(h.olhando > 0 ? h.x + h.w : h.x - e * 2), Math.round(h.y + h.h * 0.4), e * 2, e); }
        return;
      }
      if (o.dano && (self.quadro >> 1) % 2) { return; }
      self.desenharObj(ctx, o, o.t >> 3, (o.olhando || -1) > 0);
      if (o.tipo === 'inimigo' && o.prep > 0) { ctx.fillStyle = '#F83800'; ctx.fillRect(Math.round(o.x + o.w / 2 - 1), Math.round(o.y - 5), 2, 3); }
      if (o.tipo === 'inimigo' && (o.def.vida || 3) >= 6) {   // chefe: barra de vida
        ctx.fillStyle = '#F83800'; ctx.fillRect(Math.round(o.x), Math.round(o.y - 3), Math.round(o.w * Math.max(0, o.vida) / o.def.vida), 2);
      }
    });
  };
  // 🤖 alinha na profundidade, encosta de lado e soca; sem inimigo, vai para a direita
  Briga.prototype.roboEntrada = function (mem, desajeitado, rng) {
    var h = this.heroi, T = this.T, self = this;
    if (this.morto) { return {}; }
    mem.f = (mem.f || 0) + 1;
    if (mem.solto) { mem.solto = false; return {}; }
    var alvo = null, dmin = 1e9;
    this.objs.forEach(function (o) {
      if (!o.vivo || o.tipo !== 'inimigo' || !o.ativo) { return; }
      var d = Math.abs(o.x - h.x) + Math.abs(o.y - h.y) * 2;
      if (d < dmin) { dmin = d; alvo = o; }
    });
    var e = {};
    if (!alvo) {
      var fim = this.objs.filter(function (o) { return o.vivo && o.tipo === 'fim_de_fase'; })[0];
      e.dir = true;
      if (fim) { var fy = fim.y + fim.h, hy = h.y + h.h; if (fy - hy > 2) { e.baixo = true; } else if (hy - fy > 2) { e.cima = true; } }
      return e;
    }
    var ddx = (alvo.x + alvo.w / 2) - (h.x + h.w / 2), ddy = (alvo.y + alvo.h) - (h.y + h.h);
    // esperto: se o inimigo está armando o golpe e não dá para bater antes, sai da linha
    if (!desajeitado && alvo.prep > 0 && alvo.prep < 10 && h.soco <= 0) { e[ddy >= 0 ? 'cima' : 'baixo'] = true; return e; }
    var dist = (h.w + alvo.w) / 2 + T * 0.15;
    if (Math.abs(ddy) > T * 0.25) { e[ddy > 0 ? 'baixo' : 'cima'] = true; }
    if (Math.abs(ddx) > dist + 2) { e[ddx > 0 ? 'dir' : 'esq'] = true; }
    else if (Math.abs(ddx) < dist - T * 0.5) { e[ddx > 0 ? 'esq' : 'dir'] = true; }
    if (Math.abs(ddy) <= T * 0.5 && Math.abs(ddx) < dist + T * 0.6) {
      if ((h.olhando > 0) !== (ddx > 0)) { e = {}; e[ddx > 0 ? 'dir' : 'esq'] = true; return e; }
      if (h.soco <= 0 && (!desajeitado || rng() < 0.35)) { mem.solto = true; return { pulo: true }; }
    }
    return e;
  };

  // ───────────────────────── ⚔ RPG: história + batalhas por turno ─────────────────────────
  var Rpg = herdar(function Rpg(spec, perfil, sprites, som, semente) { Base.call(this, spec, perfil, sprites, som, semente); },
                   'SETAS ESCOLHEM  ESPACO OU OK CONFIRMA');
  Rpg.prototype.usaCima = true;
  var MENU_RPG = ['ATACAR', 'MAGIA', 'POCAO', 'DEFENDER'];
  Rpg.prototype.montarFase = function (f) {
    var her = this.spec.heroi || {};
    this.mapa = []; this.objs = []; this.larg = this.W; this.alt = this.H; this.cam = { x: 0, y: 0 };
    this.batalhas = (f.batalhas || []).filter(function (b) { return b && b.inimigos && b.inimigos.length; });
    if (this.faseIdx === 0 || !this.st) {
      this.st = { hpMax: clamp(her.vida || 30, 5, 99), atk: clamp(her.ataque || 5, 1, 20), def: clamp(her.defesa || 1, 0, 10),
                  pocoes: clamp(her.pocoes == null ? 3 : her.pocoes, 0, 9), magias: clamp(her.magia == null ? 2 : her.magia, 0, 9) };
      this.st.hp = this.st.hpMax;
    }
    this.bi = 0; this.fila = f.historia ? [String(f.historia)] : []; this.iniciarBatalha();
  };
  Rpg.prototype.iniciarBatalha = function () {
    var b = this.batalhas[this.bi], ents = this.spec.entidades || {}, self = this;
    this.inims = (b ? b.inimigos : []).slice(0, 3).map(function (ch, k) {
      var d = ents[ch] || { sprite: null, vida: 5, ataque: 2 };
      return { def: d, ch: ch, vida: clamp(d.vida || 5, 1, 50), max: clamp(d.vida || 5, 1, 50), atk: clamp(d.ataque || 2, 1, 20), vivo: true, k: k, t: 0 };
    });
    if (b && b.texto) { this.fila.push(String(b.texto)); }
    this.modo = this.fila.length ? 'texto' : 'menu'; this.sel = 0; this.alvo = 0; this.msgT = 0; this.defendendo = false;
    this.st.magiasFase = this.st.magiasFase == null ? this.st.magias : this.st.magiasFase;
  };
  Rpg.prototype.renascer = function () {   // perdeu a batalha: recomeça a mesma batalha com a vida cheia
    this.st.hp = this.st.hpMax; this.fila = ['VOCE SE LEVANTA E TENTA DE NOVO!']; this.iniciarBatalha();
  };
  Rpg.prototype.msg = function (s) { this.fila.push(s); this.modo = 'texto'; this.msgT = 0; };
  Rpg.prototype.vivos = function () { return this.inims.filter(function (o) { return o.vivo; }); };
  Rpg.prototype.passo = function (inp) {
    var self = this, st = this.st;
    if (this.modo === 'texto') {
      this.msgT++;
      if ((inp.apertou('pulo') && this.msgT > 10) || this.msgT > 150) {
        this.fila.shift(); this.msgT = 0;
        if (!this.fila.length) { this.depoisDoTexto(); }
      }
      return;
    }
    if (this.modo === 'menu') {
      if (inp.apertou('cima')) { this.sel = (this.sel + 3) % 4; this.som.efeito('pisao'); }
      if (inp.apertou('baixo')) { this.sel = (this.sel + 1) % 4; this.som.efeito('pisao'); }
      if (inp.apertou('pulo')) {
        var op = MENU_RPG[this.sel];
        if (op === 'ATACAR') { this.modo = 'alvo'; this.alvo = this.inims.indexOf(this.vivos()[0]); return; }
        if (op === 'MAGIA') { if (st.magiasFase <= 0) { this.msg('SEM MAGIA!'); this.depois = 'menu'; return; } this.agir('magia'); return; }
        if (op === 'POCAO') { if (st.pocoes <= 0) { this.msg('SEM POCAO!'); this.depois = 'menu'; return; } this.agir('pocao'); return; }
        this.agir('defender');
      }
      return;
    }
    if (this.modo === 'alvo') {
      var vs = this.vivos(), i = vs.indexOf(this.inims[this.alvo]);
      if (i < 0) { i = 0; }
      if (inp.apertou('esq') || inp.apertou('cima')) { i = (i + vs.length - 1) % vs.length; }
      if (inp.apertou('dir') || inp.apertou('baixo')) { i = (i + 1) % vs.length; }
      this.alvo = this.inims.indexOf(vs[i]);
      if (inp.apertou('pulo')) { this.agir('atacar'); }
    }
  };
  Rpg.prototype.agir = function (acao) {
    var st = this.st, self = this, rng = this.rng;
    this.defendendo = false;
    if (acao === 'atacar') {
      var o = this.inims[this.alvo], dano = st.atk + Math.floor(rng() * 3), crit = rng() < 0.1;
      if (crit) { dano *= 2; }
      o.vida -= dano; this.som.efeito('pisao');
      this.msg((crit ? 'GOLPE CRITICO! ' : '') + 'VOCE CAUSA ' + dano + ' DE DANO');
      if (o.vida <= 0) { o.vivo = false; this.pontos += o.def.pontos || 100; this.msg('O INIMIGO CAIU!'); }
    } else if (acao === 'magia') {
      st.magiasFase--; this.som.efeito('poder');
      var dm = Math.floor(st.atk * 1.5);
      this.vivos().forEach(function (x) { x.vida -= dm; if (x.vida <= 0) { x.vivo = false; self.pontos += x.def.pontos || 100; } });
      this.msg('MAGIA! ' + dm + ' DE DANO EM TODOS');
    } else if (acao === 'pocao') {
      st.pocoes--; var cura = Math.max(10, Math.floor(st.hpMax * 0.5)); st.hp = Math.min(st.hpMax, st.hp + cura); this.som.efeito('moeda');
      this.msg('POCAO! +' + cura + ' DE VIDA');
    } else { this.defendendo = true; this.msg('VOCE SE DEFENDE'); }
    this.depois = 'inimigos';
  };
  Rpg.prototype.depoisDoTexto = function () {
    var st = this.st, self = this;
    if (this.depois === 'inimigos') {
      this.depois = null;
      if (!this.vivos().length) { this.venceuBatalha(); return; }
      this.vivos().forEach(function (o) {
        var d = Math.max(1, o.atk + Math.floor(self.rng() * 3) - st.def * (self.defendendo ? 2 : 1));
        if (self.defendendo) { d = Math.max(0, Math.floor(d / 2)); }
        st.hp -= d; self.fila.push((o.def.nome || 'O INIMIGO') + ' ATACA: -' + d);
      });
      this.som.efeito('dano');
      if (st.hp <= 0) { st.hp = 0; this.fila.push('VOCE CAIU...'); this.depois = 'caiu'; }
      this.modo = 'texto'; this.msgT = 0;
      return;
    }
    if (this.depois === 'caiu') { this.depois = null; this.ferir('batalha'); return; }
    if (this.depois === 'proxima') { this.depois = null; this.iniciarBatalha(); return; }
    if (this.depois === 'fim') { this.depois = null; this.concluirFase(); return; }
    this.depois = null; this.modo = 'menu';
  };
  Rpg.prototype.venceuBatalha = function () {
    var st = this.st;
    st.atk += 1; st.hpMax += 3; st.hp = Math.min(st.hpMax, st.hp + Math.floor(st.hpMax * 0.3));
    this.pontos += 200; this.som.efeito('fim');
    this.fila.push('VITORIA! ATAQUE +1  VIDA +3');
    this.bi++;
    this.depois = this.bi >= this.batalhas.length ? 'fim' : 'proxima';
    if (this.depois === 'fim') { st.magiasFase = st.magias; }
    this.modo = 'texto'; this.msgT = 0;
  };
  Rpg.prototype.textoMeio = function () { return 'FASE ' + (this.faseIdx + 1) + '  BATALHA ' + Math.min(this.bi + 1, this.batalhas.length) + '/' + this.batalhas.length; };
  Rpg.prototype.desenharMundo = function (ctx) {
    var W = this.W, H = this.H, T = this.T, cor = this.spec.cores || {}, tinta = cor.texto || '#FCFCFC', dest = cor.destaque || '#F8B800', self = this, st = this.st;
    var n = this.inims.length;
    this.inims.forEach(function (o, k) {
      o.t++;
      if (!o.vivo) { return; }
      var s = self.sprites[o.def.sprite] || { w: T, h: T }, x = Math.round((k + 1) * W / (n + 1) - s.w), y = Math.round(H * 0.18);
      ctx.save(); ctx.translate(x, y); ctx.scale(2, 2); self.desenharSprite(ctx, o.def.sprite, 0, 0, o.t >> 4, false); ctx.restore();
      ctx.fillStyle = cor.apagado || '#7C7C7C'; ctx.fillRect(x, y + s.h * 2 + 3, s.w * 2, 3);
      ctx.fillStyle = '#F83800'; ctx.fillRect(x, y + s.h * 2 + 3, Math.round(s.w * 2 * Math.max(0, o.vida) / o.max), 3);
      if (self.modo === 'alvo' && self.alvo === k && (self.quadro >> 3) % 2) { texto(ctx, 'V', x + s.w - 1, y - 8, dest, 1); }
    });
    var hs = this.sprites[(this.spec.heroi || {}).sprite], hy = Math.round(H * 0.55);
    if (hs) { ctx.save(); ctx.translate(8, hy); ctx.scale(2, 2); this.desenharSprite(ctx, this.spec.heroi.sprite, 0, 0, this.quadro >> 4, false); ctx.restore(); }
    var bx = 8 + (hs ? hs.w * 2 + 8 : 0);
    texto(ctx, 'VIDA ' + Math.max(0, st.hp) + '/' + st.hpMax, bx, hy, tinta, 1);
    ctx.fillStyle = cor.apagado || '#7C7C7C'; ctx.fillRect(bx, hy + 7, 60, 3);
    ctx.fillStyle = '#58D854'; ctx.fillRect(bx, hy + 7, Math.round(60 * Math.max(0, st.hp) / st.hpMax), 3);
    texto(ctx, 'ATQ ' + st.atk + ' DEF ' + st.def, bx, hy + 13, tinta, 1);
    var y0 = Math.round(H * 0.74);
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(4, y0 - 4, W - 8, H - y0);
    if (this.modo === 'texto' && this.fila.length) {
      quebrarLinhas(this.fila[0], Math.floor((W - 16) / 4)).slice(0, 4).forEach(function (l, i) { texto(ctx, l, 8, y0 + i * 8, tinta, 1); });
      if ((this.quadro >> 4) % 2) { texto(ctx, '>', W - 12, H - 10, dest, 1); }
    } else {
      MENU_RPG.forEach(function (m, i) {
        var extra = m === 'MAGIA' ? ' ' + st.magiasFase : (m === 'POCAO' ? ' ' + st.pocoes : '');
        var on = self.modo === 'menu' && i === self.sel;
        texto(ctx, (on ? '> ' : '  ') + m + extra, 8, y0 + i * 8, on ? dest : tinta, 1);
      });
      if (this.modo === 'alvo') { texto(ctx, 'ESCOLHA O ALVO', Math.floor(W / 2), y0, dest, 1); }
    }
  };
  // 🤖 esperto: poção com pouca vida, magia com 2+ inimigos, senão bate no mais fraco. Desajeitado: às vezes escolhe mal.
  Rpg.prototype.roboEntrada = function (mem, desajeitado, rng) {
    if (this.morto) { return {}; }
    if (mem.solto) { mem.solto = false; return {}; }
    var st = this.st, self = this;
    if (this.modo === 'texto') { if (this.msgT > 12) { mem.solto = true; return { pulo: true }; } return {}; }
    if (this.modo === 'menu') {
      if (mem.querOp == null) {
        var vs = this.vivos(), op = 0;
        if (st.hp < st.hpMax * (desajeitado ? 0.15 : 0.35) && st.pocoes > 0) { op = 2; }
        else if (vs.length >= 2 && st.magiasFase > 0) { op = 1; }
        if (desajeitado && rng() < 0.25) { op = Math.floor(rng() * 4); }
        mem.querOp = op;
      }
      mem.solto = true;
      if (this.sel !== mem.querOp) { return { baixo: true }; }
      mem.querOp = null;
      return { pulo: true };
    }
    if (this.modo === 'alvo') {
      var fraco = this.vivos().slice().sort(function (a, b) { return a.vida - b.vida; })[0];
      var idx = desajeitado ? this.alvo : this.inims.indexOf(fraco);
      mem.solto = true;
      if (this.alvo !== idx) { return { dir: true }; }
      return { pulo: true };
    }
    return {};
  };
  Rpg.prototype.objetoEm = function () { return { tipo: 'batalha', fase: this.faseIdx + 1, batalha: this.bi + 1 }; };

  [Labirinto, Travessia, Aventura, Briga].forEach(function (G) {
    var d = G.prototype.desenharMundo;
    G.prototype.desenharMundo = function (ctx) { d.call(this, ctx); if (this.tirosInim && this.tirosInim.length) { this.desenharTiros(ctx); } };
  });
  var GENEROS_E4 = { labirinto: Labirinto, quebra_blocos: QuebraBlocos, nave: Nave, corrida: Corrida, tiro_fixo: TiroFixo,
                     travessia: Travessia, esporte: Esporte, quiz: Quiz,
                     aventura: Aventura, rpg: Rpg, briga_de_rua: Briga };

  Plataforma.prototype.cimaPula = true;
  [Labirinto, Nave, Corrida, Travessia, Quiz, Aventura, Briga, Rpg].forEach(function (G) { G.prototype.usaCima = true; });
  [Esporte, Quiz, Briga].forEach(function (G) { G.prototype.doisJogadores = true; });   // 👥 E7
  var GENEROS = { plataforma: Plataforma };
  Object.keys(GENEROS_E4).forEach(function (k) { GENEROS[k] = GENEROS_E4[k]; });

  // ───────────────────────── 🤖 simular: o robô joga cada fase, sem tela e acelerado ─────────────────────────
  // Usado pelo robô do palco (engine/fliperama/robo_navegador.py) e pelo modo TV. Determinístico (semente fixa).
  function entradaDe(e, antes) {
    var r = {}; Object.keys(e || {}).forEach(function (k) { r[k] = !!e[k]; });
    r.apertou = function (k) { return r[k] && !(antes || {})[k]; };
    return r;
  }
  var SOM_MUDO = { ligar: function () {}, efeito: function () {}, musica: function () {}, parar: function () {}, alternarMudo: function () {} };
  function simular(spec, perfis, op) {
    op = op || {};
    var perfil = ((perfis && perfis.perfis) || perfis || {})[spec.perfil];
    if (!perfil) { throw new Error('perfil de era desconhecido: ' + spec.perfil); }
    var Genero = GENEROS[spec.arquetipo];
    if (!Genero) { throw new Error('gênero ainda não existe no motor: ' + spec.arquetipo); }
    var tela = document.createElement('canvas'); tela.width = perfil.w; tela.height = perfil.h;
    var ctx = tela.getContext('2d');
    var sprites = montarSprites(spec);
    var nFases = Genero.prototype.numFases ? Genero.prototype.numFases.call(null, spec) : (spec.fases || []).length;
    var max = op.maxQuadros || 60 * (Genero.prototype.tempoMax || 120), rel = { fases: [], quadros: 0, ms: 0, versao: VERSAO };
    var t0 = performance.now();
    ['esperto', 'desajeitado'].forEach(function (tipo) {
      for (var i = 0; i < nFases; i++) {
        var jogo = new Genero(spec, perfil, sprites, SOM_MUDO, op.semente || 20261024);
        jogo.vidasIniciais = 99; jogo.vidas = 99; jogo.faseIdx = i;
        jogo.carregarFase(i); jogo.estado = 'jogando';
        var mem = {}, rng = mulberry32(7 + i), antes = {}, f = 0, fim = null, onde = [];
        while (f < max) {
          var e = jogo.roboEntrada(mem, tipo === 'desajeitado', rng);
          var v0 = jogo.vidas, hx = jogo.heroi ? jogo.heroi.x : 0, hy = jogo.heroi ? jogo.heroi.y : 0;
          jogo.atualizar(entradaDe(e, antes)); antes = e; f++;
          if (jogo.vidas < v0 && onde.length < 30) { onde.push({ coluna: Math.floor(hx / jogo.T) + 1, caiu: hy > jogo.alt, por: hy > jogo.alt ? 'buraco' : (jogo.ultimoDano || '?'), no_ar: !!(jogo.__noAr) }); }
          jogo.ultimoDano = null; jogo.__noAr = jogo.heroi && !jogo.heroi.chao;
          if (f % 20 === 0) { jogo.desenhar(ctx); }
          if (jogo.estado === 'fase_ok' || jogo.estado === 'vitoria') { fim = 'concluiu'; break; }
          if (jogo.estado === 'fim_jogo') { fim = 'perdeu'; break; }
        }
        rel.quadros += f;
        rel.fases.push({ fase: i + 1, robo: tipo, concluiu: fim === 'concluiu', segundos: Math.round(f / 6) / 10,
                         mortes: Math.max(0, 99 - jogo.vidas), pontos: jogo.pontos || 0, mortes_em: onde });
      }
    });
    rel.ms = Math.round(performance.now() - t0);
    rel.ms_por_quadro = rel.quadros ? Math.round(rel.ms / rel.quadros * 1000) / 1000 : null;
    return rel;
  }

  // 🏆 REPLAY do placar: joga de novo a partida gravada (mesma semente) e devolve o que deu — a casa só aceita o
  // recorde se o replay der os mesmos pontos (antitrapaça; roda no robô do navegador, no servidor)
  function repetir(spec, perfis, op) {
    op = op || {};
    var perfil = ((perfis && perfis.perfis) || perfis || {})[spec.perfil];
    if (!perfil) { throw new Error('perfil de era desconhecido: ' + spec.perfil); }
    var Genero = GENEROS[spec.arquetipo];
    if (!Genero) { throw new Error('gênero ainda não existe no motor: ' + spec.arquetipo); }
    var jogo = new Genero(spec, perfil, montarSprites(spec), SOM_MUDO, op.semente || 20261024);
    var fila = lerGravacao(op.entradas), antes = {}, t0 = performance.now(), maxFase = 1;
    for (var k = 0; k < fila.length; k++) {
      var e = deMascara(fila[k]);
      jogo.atualizar(entradaDe(e, antes)); antes = e;
      if (jogo.estado === 'jogando') { maxFase = Math.max(maxFase, jogo.faseIdx + 1); }
      if (k > 0 && (jogo.estado === 'fim_jogo' || jogo.estado === 'vitoria')) { break; }
    }
    return { pontos: jogo.pontos || 0, fase: maxFase, venceu: jogo.estado === 'vitoria', estado: jogo.estado,
             quadros: fila.length, ms: Math.round(performance.now() - t0), versao: VERSAO };
  }

  // 🎬 MODO ATRAÇÃO (TV e capa): o robô esperto joga NA TELA, em tempo real
  function atracao(raiz, spec, opcoes) {
    opcoes = opcoes || {};
    if (usaPhaser(spec)) { return iniciarPhaser(raiz, spec, opcoes, true); }
    var r = iniciar(raiz, spec, Object.assign({}, opcoes, { semMudo: true }));
    var jogo = r.jogo, mem = {}, rng = mulberry32(3);
    jogo.som.mudo = true;
    jogo.som.ligar = function () {};
    jogo.vidasIniciais = 99;
    r.robo = true;
    jogo.__roboEntrada = function () {
      if (jogo.estado === 'titulo' || jogo.estado === 'fim_jogo' || jogo.estado === 'vitoria') { return { start: (jogo.quadro % 120) === 60 }; }
      return jogo.roboEntrada ? jogo.roboEntrada(mem, false, rng) : {};
    };
    return r;
  }

  // ───────────────────────── toque (celular / tablet) ─────────────────────────
  function botoesDeToque(raiz, entrada, comCima) {
    if (!('ontouchstart' in window) && !(navigator.maxTouchPoints > 0)) { return; }
    var barra = document.createElement('div');
    barra.setAttribute('data-doc', 'Fliperama · botões de toque · aparecem só em tela de toque');
    barra.style.cssText = 'position:absolute;left:0;right:0;bottom:8px;display:flex;justify-content:space-between;padding:0 12px;pointer-events:none';
    function bt(rotulo, acao) {
      var b = document.createElement('button');
      b.type = 'button'; b.textContent = rotulo; b.setAttribute('aria-label', acao);
      b.style.cssText = 'pointer-events:auto;width:64px;height:64px;margin:0 4px;border-radius:50%;border:2px solid rgba(255,255,255,.5);background:rgba(0,0,0,.35);color:#fff;font-size:22px';
      function on(e) { entrada.toque[acao] = true; e.preventDefault(); }
      function off(e) { entrada.toque[acao] = false; e.preventDefault(); }
      b.addEventListener('touchstart', on); b.addEventListener('touchend', off); b.addEventListener('touchcancel', off);
      return b;
    }
    var esq = document.createElement('div'), dir = document.createElement('div');
    esq.appendChild(bt('◀', 'esq')); esq.appendChild(bt('▶', 'dir'));
    if (comCima) { esq.appendChild(bt('▲', 'cima')); esq.appendChild(bt('▼', 'baixo')); }
    dir.appendChild(bt('A', 'pulo'));
    barra.appendChild(esq); barra.appendChild(dir);
    raiz.appendChild(barra);
  }

  // ───────────────────────── 🧩 motor Phaser (prova 2 do motor 2): carrega sob demanda ─────────────────────────
  var PHASER_V = '4.2.1', carregandoPhaser = null;
  function carregarScript(src) {
    return new Promise(function (ok, erro) {
      var s = document.createElement('script'); s.src = src; s.charset = 'utf-8'; s.onload = ok;
      s.onerror = function () { erro(new Error('não carregou ' + src)); }; document.head.appendChild(s);
    });
  }
  // 🎨 estilos (25/10/2026): "turbinado" e "hd" só existem no motor Phaser — uma fase com estilo já liga o Phaser
  function usaPhaser(spec) {
    if (!spec || spec.arquetipo !== 'plataforma') { return false; }
    if (spec.motor === 'phaser') { return true; }
    if (spec.estilo && spec.estilo !== 'pixel') { return true; }
    return (spec.fases || []).some(function (f) { return f && f.estilo && f.estilo !== 'pixel'; });
  }
  function iniciarPhaser(raiz, spec, opcoes, atracao) {
    raiz.innerHTML = '<div style="color:#FCFCFC;font:14px system-ui;padding:24px;text-align:center">carregando o motor Phaser…</div>';
    var alvo = null, parado = false;
    var r = { jogo: { estado: 'titulo', spec: spec }, versao: VERSAO + '+phaser', aceitaDois: false, robo: !!atracao,
              controle: function (sl, e) { if (alvo) { alvo.controle(sl, e); } }, doisJogadores: function () { return false; },
              pausar: function (s) { if (alvo) { alvo.pausar(s); } }, apontar: function () { return null; },
              estilo: function (n) { return alvo && alvo.estilo ? alvo.estilo(n) : null; }, estiloAtual: function () { return alvo && alvo.estiloAtual ? alvo.estiloAtual() : 'pixel'; },
              parar: function () { parado = true; if (alvo) { alvo.parar(); } },
              reconstruir: function () { if (alvo && alvo.reconstruir) { alvo.reconstruir(); } }, telaDoJogo: function () { return alvo && alvo.tela; } };
    if (!carregandoPhaser) {
      carregandoPhaser = (window.Phaser ? Promise.resolve() : carregarScript('/estudio/fliperama/phaser/phaser-' + PHASER_V + '.min.js'))
        .then(function () { return window.FliperamaPhaser ? null : carregarScript('/estudio/fliperama/motor-phaser.js?v=' + VERSAO + '.2'); });
    }
    carregandoPhaser.then(function () {
      if (parado) { return; }
      alvo = window.FliperamaPhaser.iniciar(raiz, spec, opcoes, atracao);
      r.jogo = alvo.jogo;
    }).catch(function (e) {
      carregandoPhaser = null;
      raiz.innerHTML = '<div style="color:#FCFCFC;font:14px system-ui;padding:24px;text-align:center">O motor Phaser não abriu: ' +
        String(reportar(e, 'carregar o motor Phaser')).replace(/[<>&]/g, '') + '</div>';
    });
    return r;
  }

  // ───────── 🚪 SAÍDA IGUAL EM TODOS OS JOGOS (25/10/2026, pedido do autor) ─────────
  // Na página do jogo publicado (/m/<jogo>), mesmo em tela cheia: botão "✕ Sair" no canto (aparece ao mexer o mouse ou
  // tocar) e a tecla Esc / Voltar do controle remoto abre "Sair do jogo?" com o jogo pausado; Esc de novo sai.
  // Fica no motor (e não no pacote de cada jogo) para valer também nos jogos que já foram publicados.
  function instalarSaida(r) {
    if (!/^\/m\//.test(location.pathname) || document.getElementById('fp-saida')) { return; }
    var css = document.createElement('style');
    css.textContent = '#fp-saida{position:fixed;top:12px;left:12px;z-index:9999;font:700 16px system-ui,sans-serif;color:#fff;background:rgba(10,10,30,.72);' +
      'border:2px solid rgba(255,255,255,.55);border-radius:999px;padding:8px 16px;cursor:pointer;transition:opacity .4s}' +
      '#fp-saida.some{opacity:0;pointer-events:none}#fp-dlg{position:fixed;inset:0;z-index:10000;display:grid;place-items:center;background:rgba(0,0,0,.6)}' +
      '#fp-dlg>div{background:#141433;border:3px solid #F8B800;border-radius:16px;padding:22px 26px;color:#fff;font:700 22px system-ui,sans-serif;text-align:center;min-width:280px}' +
      '#fp-dlg p{font-weight:500;font-size:15px;color:#BCC;margin:6px 0 16px}#fp-dlg button{font:700 18px system-ui,sans-serif;border-radius:10px;padding:10px 20px;margin:0 6px;cursor:pointer;border:3px solid transparent}' +
      '#fp-dlg button:focus{outline:none;border-color:#F8B800}#fp-dlg .sair{background:#F83800;color:#fff}#fp-dlg .fica{background:#2A9D4B;color:#fff}';
    document.head.appendChild(css);
    var bt = document.createElement('button');
    bt.id = 'fp-saida'; bt.type = 'button'; bt.textContent = '✕ Sair'; bt.title = 'Sair do jogo (Esc)';
    bt.setAttribute('data-doc', 'Fliperama · sair do jogo · o mesmo em todos os jogos: botão ✕ Sair ou Esc / Voltar');
    document.body.appendChild(bt);
    var esconder = null;
    function mostrar() { bt.classList.remove('some'); clearTimeout(esconder); esconder = setTimeout(function () { bt.classList.add('some'); }, 3000); }
    ['pointermove', 'pointerdown', 'touchstart'].forEach(function (ev) { window.addEventListener(ev, mostrar, { passive: true }); });
    mostrar();
    var dlg = null;
    function sair() {
      try { if (document.fullscreenElement && document.exitFullscreen) { document.exitFullscreen(); } } catch (e) { /* nada */ }
      try { if (r && r.parar) { r.parar(); } } catch (e) { /* nada */ }
      var ref = '';
      try { ref = document.referrer && new URL(document.referrer).origin === location.origin ? document.referrer : ''; } catch (e) { ref = ''; }
      location.href = ref && ref !== location.href ? ref : '/';
    }
    function fechar() { if (dlg) { dlg.remove(); dlg = null; try { if (r && r.pausar) { r.pausar(false); } } catch (e) { /* nada */ } } }
    function abrir() {
      if (dlg) { return; }
      try { if (r && r.pausar) { r.pausar(true); } } catch (e) { /* nada */ }
      dlg = document.createElement('div'); dlg.id = 'fp-dlg';
      dlg.innerHTML = '<div role="dialog" aria-label="Sair do jogo">Sair do jogo?<p>Esc de novo também sai.</p>' +
        '<button class="fica" type="button">Continuar</button><button class="sair" type="button">Sair</button></div>';
      document.body.appendChild(dlg);
      var bs = dlg.querySelectorAll('button');
      bs[0].onclick = fechar; bs[1].onclick = sair;
      bs[0].focus();
    }
    bt.addEventListener('click', function (ev) { ev.stopPropagation(); abrir(); });
    var VOLTA = /^(Escape|Backspace|GoBack|BrowserBack|Back)$/;
    window.addEventListener('keydown', function (ev) {
      var volta = VOLTA.test(ev.key) || ev.keyCode === 10009 || ev.keyCode === 461;   // 10009 Samsung · 461 LG
      if (dlg) {
        ev.stopImmediatePropagation(); ev.preventDefault();
        if (volta) { sair(); return; }
        var bs = dlg.querySelectorAll('button'), i = Array.prototype.indexOf.call(bs, document.activeElement);
        if (/^(ArrowLeft|ArrowRight|Left|Right|Tab)$/.test(ev.key)) { bs[i === 0 ? 1 : 0].focus(); }
        else if (ev.key === 'Enter' || ev.key === ' ') { (document.activeElement && document.activeElement.click) ? document.activeElement.click() : fechar(); }
        return;
      }
      if (volta) { ev.stopImmediatePropagation(); ev.preventDefault(); abrir(); }
    }, true);
  }

  // ───────── 🎨 ESTILOS EM TODOS OS GÊNEROS (25/10/2026): Pixel · Turbinado · HD · 3D ─────────
  // A plataforma desenha no Phaser; os outros 11 gêneros continuam no motor da casa e ganham uma "pele":
  //  · turbinado — o mesmo desenho ampliado (Scale2x duas vezes) e suavizado, numa tela 4× mais fina;
  //  · hd        — personagens, itens e blocos da biblioteca HD da casa (CC0), escolhidos pelo papel de cada coisa;
  //  · 3d        — o motor-3d.js monta um "palco" Three.js por baixo; o placar e os textos continuam por cima.
  // A simulação e as regras não mudam: só o desenho.
  var GENEROS_DE_CIMA = { labirinto: 1, aventura: 1, travessia: 1, nave: 1, corrida: 1, quebra_blocos: 1, tiro_fixo: 1, esporte: 1 };
  function scale2x(src) {
    var w = src.width, h = src.height, sc = src.getContext('2d').getImageData(0, 0, w, h), a = new Uint32Array(sc.data.buffer);
    var out = document.createElement('canvas'); out.width = w * 2; out.height = h * 2;
    var oc = out.getContext('2d'), od = oc.createImageData(w * 2, h * 2), b = new Uint32Array(od.data.buffer);
    function px(x, y) { x = x < 0 ? 0 : (x >= w ? w - 1 : x); y = y < 0 ? 0 : (y >= h ? h - 1 : y); return a[y * w + x]; }
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var E = a[y * w + x], B = px(x, y - 1), D = px(x - 1, y), Fv = px(x + 1, y), Hv = px(x, y + 1), e0 = E, e1 = E, e2 = E, e3 = E;
        if (B !== Hv && D !== Fv) { e0 = D === B ? D : E; e1 = B === Fv ? Fv : E; e2 = D === Hv ? D : E; e3 = Hv === Fv ? Fv : E; }
        var o = (y * 2) * (w * 2) + x * 2; b[o] = e0; b[o + 1] = e1; b[o + w * 2] = e2; b[o + w * 2 + 1] = e3;
      }
    }
    oc.putImageData(od, 0, 0);
    return out;
  }
  function corEscura(h) { var n = parseInt(String(h || '#000000').slice(1, 7), 16) || 0; return (((n >> 16) & 255) * 0.3 + ((n >> 8) & 255) * 0.59 + (n & 255) * 0.11) < 40; }
  function corAzul(h) { var n = parseInt(String(h || '#000000').slice(1, 7), 16) || 0; return (n & 255) > ((n >> 16) & 255) + 40; }
  // quem é quem no HD para os gêneros da casa (o que spec.hd pediu vale primeiro)
  function mapaPeleHD(spec, B) {
    var P = B.personagens, BL = B.blocos, ped = spec.hd || {}, her = spec.heroi || {}, ents = spec.entidades || {}, tiles = spec.tiles || {};
    function ok(id, tab) { return id && tab[id] ? id : null; }
    var pers = {}, blocos = {}, usados = {};
    var heroi = ok((ped.personagens || {})[her.sprite], P) || ok(ped.heroi, P) || (spec.arquetipo === 'nave' || spec.arquetipo === 'corrida' ? null : 'alien_verde');
    [her.sprite, her.sprite_poder, her.sprite_grande].forEach(function (n) { if (n && heroi) { pers[n] = heroi; } });
    Object.keys(ents).forEach(function (ch) {
      var e = ents[ch] || {}, n = e.sprite; if (!n || pers[n]) { return; }
      var quer = ok((ped.personagens || {})[n], P);
      if (!quer) {
        var pc = {}; (e.pecas || []).forEach(function (x) { pc[x] = 1; });
        var c = e.comportamento || '';
        if (e.tipo === 'coletavel') { quer = /gema|joia|diam/.test(n) ? 'gema_azul' : 'moeda_ouro'; }
        else if (e.tipo === 'poder') { quer = { crescer: 'cogumelo', estrela: 'estrela', vida: 'coracao' }[e.da] || 'estrela'; }
        else if (e.tipo === 'fim_de_fase') { quer = 'bandeira_verde'; }
        else if (e.tipo === 'chave') { quer = 'chave'; }
        else if (e.tipo === 'carona') { quer = 'plataforma_madeira'; }
        else if (/carro|nave|aviao|caminh|moto|tronco|bola|raquete/.test(n)) { quer = null; }      // veículos e coisas: fica o desenho turbinado
        else if (pc.plataforma) { quer = 'plataforma_madeira'; }
        else if (pc.chefe) { quer = 'besouro_gigante'; }
        else if (pc.casco) { quer = 'lesma'; }
        else if (pc.voa || /voa/.test(c) || /morcego|mosca|abelha|passaro|fantasma/.test(n)) { quer = usados.abelha ? 'mosca' : 'abelha'; }
        else if (pc.pula || c === 'pula') { quer = 'sapo'; }
        else if (pc.espinho) { quer = 'serra'; }
        else if (pc.atira) { quer = 'planta'; }
        else { quer = ['gosma_verde', 'rato', 'joaninha', 'sapo', 'gosma_roxa', 'minhoca'].filter(function (x) { return !usados[x]; })[0] || 'gosma_azul'; }
      }
      if (quer) { usados[quer] = 1; pers[n] = quer; }
    });
    var escuro = (spec.fases || []).some(function (f) { return corEscura(f && f.ceu); });
    var chaos = escuro ? ['tijolo_cinza', 'pedra', 'caixote', 'terra'] : ['tijolo', 'pedra', 'caixote', 'tijolo_cinza', 'terra'];
    var n = 0;
    Object.keys(tiles).forEach(function (ch) {
      var t = tiles[ch] || {}, quer = ok((ped.blocos || {})[ch], BL);
      if (!quer) {
        if (t.mortal && !t.solido) { quer = corAzul(t.cor) || /agua|rio|mar/.test(t.sprite || '') ? 'agua' : 'lava'; }
        else if (t.mortal) { quer = 'espinhos'; }
        else if (t.quebravel && spec.arquetipo === 'quebra_blocos') { quer = null; }         // os tijolos coloridos do quebra-blocos ficam com a cor deles
        else if (t.quebravel) { quer = 'tijolo'; }
        else if (t.solido) { quer = chaos[Math.min(chaos.length - 1, n++)]; }
        else { quer = null; }
      }
      blocos[ch] = quer;
    });
    return { pers: pers, blocos: blocos };
  }
  function criarPele(jogo, spec, sprites, perfil) {
    var Z = 4, T = perfil.tile, W = perfil.w, H = perfil.h;
    var turboCache = {}, hd = null, hdImgs = {}, hdPronto = false, hdCarregando = false, fundoImg = null;
    var proto = Object.getPrototypeOf(jogo);
    var BASE_HD = '/estudio/fliperama/hd/';
    function turbo(nome, q) {
      var k = nome + ':' + q;
      if (!turboCache[k]) { var s = sprites[nome]; turboCache[k] = scale2x(scale2x(s.quadros[q % s.quadros.length])); }
      return turboCache[k];
    }
    function img(arq) {
      if (!hdImgs[arq]) { var im = new Image(); im.decoding = 'async'; im.src = (hd && hd.B.dados && hd.B.dados[arq]) || BASE_HD + arq; hdImgs[arq] = im; }
      return hdImgs[arq];
    }
    function carregarHD() {
      if (hdCarregando) { return; }
      hdCarregando = true;
      fetch(BASE_HD + 'biblioteca.json').then(function (r) { return r.json(); }).then(function (B) { return clonesHD(B, spec, BASE_HD); }).then(function (B) {
        hd = { B: B, mapa: mapaPeleHD(spec, B) };
        Object.keys(hd.mapa.pers).forEach(function (n) { var p = B.personagens[hd.mapa.pers[n]]; if (p) { Object.keys(p.quadros).forEach(function (k) { p.quadros[k].forEach(img); }); } });
        Object.keys(hd.mapa.blocos).forEach(function (ch) { var b = B.blocos[hd.mapa.blocos[ch]]; if (b) { ['topo', 'meio', 'sozinho'].forEach(function (k) { if (b[k]) { img(b[k]); } }); } });
        hdPronto = true;
      }).catch(function (e) { reportar(e, 'biblioteca HD (gêneros)'); });
    }
    // 🎭 Estúdio (26/10/2026): spec.hd.ajustes[sprite] = {cor, tamanho} — a cor é uma tinta por cima do desenho HD (guardada pronta)
    var TINTA_AJ = { vermelho: '#FF3B3B', azul: '#3B7BFF', roxo: '#9B4DFF', dourado: '#FFC21A', sombra: '#0E0E1A' }, tingidos = {};
    function ajHD(nome) { var a = (((spec.hd || {}).ajustes) || {})[nome]; return a && typeof a === 'object' ? a : {}; }
    function tingido(im, cor) {
      var k = im.src + '|' + cor;
      if (!tingidos[k]) {
        var c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight;
        var x = c.getContext('2d'); x.drawImage(im, 0, 0);
        x.globalCompositeOperation = 'source-atop'; x.globalAlpha = cor === 'sombra' ? 0.8 : 0.45; x.fillStyle = TINTA_AJ[cor]; x.fillRect(0, 0, c.width, c.height);
        tingidos[k] = c;
      }
      return tingidos[k];
    }
    function quadroHD(nome, q, anda) {
      var pid = hd && hd.mapa.pers[nome], p = pid && hd.B.personagens[pid];
      if (!p) { return null; }
      var qs = (anda && p.quadros.anda) || p.quadros.parado;
      var im = img(qs[q % qs.length]);
      return im.complete && im.naturalWidth ? { im: im, papel: p.papel } : null;
    }
    function fundoHD(f) {
      if (GENEROS_DE_CIMA[spec.arquetipo] && !f.fundo_hd) { return null; }   // visto de cima: o chão é a cor da fase
      var id = f.fundo_hd || (spec.hd || {}).fundo || (corEscura(f.ceu) ? 'castelo' : 'campo'), fu = hd && hd.B.fundos[id];
      if (!fu) { return null; }
      var im = img(fu.arquivo);
      return im.complete && im.naturalWidth ? im : null;
    }
    var desenharSpriteSkin = function (ctx, nome, x, y, quadro, virar) {
      var s = sprites[nome];
      if (!s || !s.quadros.length) { return proto.desenharSprite.call(this, ctx, nome, x, y, quadro, virar); }
      var est = pele.est, w = s.w, h = s.h;
      ctx.save(); ctx.imageSmoothingEnabled = true;
      var alvo = null;
      if (est === 'hd') { alvo = quadroHD(nome, quadro || 0, (quadro || 0) > 0); }
      if (alvo) {
        var aj = ajHD(nome), tm = aj.tamanho || 1, fonte = TINTA_AJ[aj.cor] ? tingido(alvo.im, aj.cor) : alvo.im;
        var a = alvo.im.naturalWidth / alvo.im.naturalHeight, ah = h * (alvo.papel === 'heroi' ? 1.25 : 1.15) * tm, aw = ah * a;
        if (aw > w * 1.7 * tm) { aw = w * 1.7 * tm; ah = aw / a; }
        var dx = x + (w - aw) / 2, dy = y + h - ah;
        if (virar) { ctx.translate(dx + aw, dy); ctx.scale(-1, 1); ctx.drawImage(fonte, 0, 0, aw, ah); }
        else { ctx.drawImage(fonte, dx, dy, aw, ah); }
      } else {
        var t = turbo(nome, quadro || 0);
        if (virar) { ctx.translate(x + w, y); ctx.scale(-1, 1); ctx.drawImage(t, 0, 0, w, h); }
        else { ctx.drawImage(t, x, y, w, h); }
      }
      ctx.restore();
    };
    var desenharTilesSkin = function (ctx) {
      if (pele.est !== 'hd' || !hdPronto) { return proto.desenharTiles.call(this, ctx); }
      var tiles = spec.tiles || {}, cx = this.cam.x, cy = this.cam.y, self = this;
      var i0 = Math.max(0, Math.floor(cx / T)), i1 = Math.min(this.colunas - 1, Math.floor((cx + W) / T));
      var j0 = Math.max(0, Math.floor(cy / T)), j1 = Math.min(this.linhas - 1, Math.floor((cy + H) / T));
      ctx.save(); ctx.imageSmoothingEnabled = true;
      for (var j = j0; j <= j1; j++) {
        for (var i = i0; i <= i1; i++) {
          var ch = this.mapa[j][i], td = tiles[ch];
          if (!td) { continue; }
          var bid = hd.mapa.blocos[ch], b = bid && hd.B.blocos[bid];
          if (b) {
            var cima = j > 0 && hd.mapa.blocos[this.mapa[j - 1][i]] === bid;
            var im = img((cima && b.meio) || b.topo || b.sozinho || b.meio);
            if (im.complete && im.naturalWidth) { ctx.drawImage(im, i * T, j * T, T + 0.3, T + 0.3); continue; }
          }
          if (td.sprite && sprites[td.sprite]) { self.desenharSprite(ctx, td.sprite, i * T, j * T, 0, false); continue; }
          ctx.fillStyle = td.cor || '#888888'; ctx.fillRect(i * T, j * T, T, T);
          if (td.borda) { ctx.fillStyle = td.borda; ctx.fillRect(i * T, j * T, T, Math.max(1, T >> 3)); }
        }
      }
      ctx.restore();
    };
    var desenharMundoSkin = function (ctx) {
      if (pele.est === 'hd' && hdPronto) {
        var im = fundoHD(this.fase || {});
        if (im) {
          ctx.save(); ctx.imageSmoothingEnabled = true;
          var k = H / im.naturalHeight, lw = im.naturalWidth * k, x0 = this.cam.x - ((this.cam.x * 0.35) % lw);
          for (var x = x0; x < this.cam.x + W; x += lw) { ctx.drawImage(im, x, this.cam.y, lw + 0.5, H); }
          ctx.restore();
        }
      }
      return proto.desenharMundo.call(this, ctx);
    };
    var pele = {
      Z: Z, est: 'pixel',
      usar: function (est) {   // liga/desliga os desenhos da pele na instância do jogo
        pele.est = est;
        if (est === 'pixel') { delete jogo.desenharSprite; delete jogo.desenharTiles; delete jogo.desenharMundo; return; }
        if (est === 'hd' || est === '3d') { carregarHD(); }
        jogo.desenharSprite = desenharSpriteSkin; jogo.desenharTiles = desenharTilesSkin;
        if (proto.desenharMundo) { jogo.desenharMundo = desenharMundoSkin; }
      },
      pronto: function () { return hdPronto; }
    };
    return pele;
  }

  // ───────────────────────── ponto de entrada ─────────────────────────
  // 🏗 ESTÚDIO DE FASES (0.9.6): a mesma tela vira construir ⇄ jogar, como no Mario Maker
  function construirFase(jogo, fi) {
    if (!jogo || !jogo.carregarFase || !(jogo.spec.fases || [])[fi]) { return false; }
    try { jogo.som.parar(); } catch (e) { /* nada */ }
    if (jogo.novaPartida && !jogo.memoria) { jogo.novaPartida(); }
    jogo.faseIdx = fi; jogo.carregarFase(fi); jogo.estado = 'construir';
    try { jogo.som.parar(); } catch (e) { /* nada */ }
    return true;
  }
  function jogarFase(jogo, fi) {   // ▶ joga a fase fi agora (sem título); nada é salvo
    if (!jogo || !jogo.carregarFase || !(jogo.spec.fases || [])[fi]) { return false; }
    jogo.som.ligar(); jogo.quadro = 0; jogo.rng = mulberry32(jogo.semente);
    jogo.pontos = 0; jogo.vidas = jogo.vidasIniciais; jogo.faseIdx = fi; jogo.rastro = []; jogo.ultimasCartas = [];
    if (jogo.novaPartida) { jogo.novaPartida(); }
    jogo.carregarFase(fi); jogo.estado = 'jogando';
    return true;
  }
  function iniciar(raiz, spec, opcoes) {
    var r = iniciarJogo(raiz, spec, opcoes);
    r.construir = function (fi) { return construirFase(r.jogo, fi || 0); };
    r.jogar = function (fi) { return jogarFase(r.jogo, fi || 0); };
    if (opcoes && opcoes.construir) {
      var tenta = function () { if (r.jogo && r.jogo.carregarFase) { construirFase(r.jogo, opcoes.fase || 0); if (opcoes.pronto) { opcoes.pronto(r); } } else { setTimeout(tenta, 50); } };
      tenta();
    }
    try { instalarSaida(r); } catch (e) { /* a saída nunca derruba o jogo */ }
    return r;
  }
  function iniciarJogo(raiz, spec, opcoes) {
    opcoes = opcoes || {};
    if (usaPhaser(spec)) { return iniciarPhaser(raiz, spec, opcoes, false); }
    var perfis = (opcoes.perfis && opcoes.perfis.perfis) || opcoes.perfis || {};
    var perfil = perfis[spec.perfil];
    if (!perfil) { throw new Error('perfil de era desconhecido: ' + spec.perfil); }
    var Genero = GENEROS[spec.arquetipo];
    if (!Genero) { throw new Error('gênero ainda não existe no motor: ' + spec.arquetipo); }

    raiz.innerHTML = '';
    raiz.style.position = 'relative';
    var caixa = document.createElement('div');   // tela 3D (embaixo) e a tela da casa (em cima) na mesma casa da grade
    caixa.style.cssText = 'display:grid;grid-template-columns:100%;justify-items:center';
    raiz.appendChild(caixa);
    var tela = document.createElement('canvas');
    tela.width = perfil.w; tela.height = perfil.h;
    tela.tabIndex = 0;
    tela.setAttribute('data-doc', 'Fliperama · tela do jogo · motor da casa ' + VERSAO + ' · era ' + (perfil.apelido || perfil.nome) + ' · ' + perfil.w + '×' + perfil.h);
    tela.style.cssText = 'image-rendering:pixelated;image-rendering:crisp-edges;display:block;margin:0 auto;outline:none;background:#000;grid-area:1/1;position:relative;z-index:1';
    caixa.appendChild(tela);
    var telaFina = false, palco = null;
    function escalar() {
      var r = raiz.getBoundingClientRect();
      // 📐 29/10/2026 (autor): quem chama pode dizer a altura que cabe (opcoes.alturaMax) — o palco ocupa a largura toda
      var hMax = (typeof opcoes.alturaMax === 'function' && +opcoes.alturaMax()) || (window.innerHeight - 8);
      var kf = Math.min((r.width || window.innerWidth) / perfil.w, hMax / perfil.h);
      var k = telaFina ? Math.max(1, kf) : Math.max(1, Math.floor(kf));   // pixel: múltiplo inteiro; turbinado/HD/3D: ocupa o espaço
      tela.style.width = Math.floor(perfil.w * k) + 'px'; tela.style.height = Math.floor(perfil.h * k) + 'px';
      if (palco && palco.tela) { palco.tela.style.width = tela.style.width; palco.tela.style.height = tela.style.height; }
    }
    escalar(); window.addEventListener('resize', escalar);
    // 📐 o espaço do palco muda sem a janela mudar (abrir/fechar a conversa, página mais larga): reescala pela largura
    if (window.ResizeObserver) { var largVista = 0; new ResizeObserver(function () { var lw = Math.round(raiz.getBoundingClientRect().width); if (lw && lw !== largVista) { largVista = lw; escalar(); } }).observe(raiz); }

    var ctx = tela.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    var entrada = new Entrada(tela);
    entrada.cimaPula = !!Genero.prototype.cimaPula;
    if (!opcoes.semToque) { botoesDeToque(raiz, entrada, !!Genero.prototype.usaCima); }   // a TV (Android) diz que tem toque — lá não
    // 25/10/2026: foco SEM rolar a página (rolava 44 px e escondia o cabeçalho com o "🏠 Meus jogos")
    function focar() { try { tela.focus({ preventScroll: true }); } catch (e) { tela.focus(); } }
    focar();
    tela.addEventListener('pointerdown', focar);

    var spritesJogo = montarSprites(spec);
    var jogo = new Genero(spec, perfil, spritesJogo, new Som(spec, perfil), opcoes.semente || 20261024);
    entrada.teclado2 = !!jogo.usaTeclado2;   // ✈✈ esquadrilha: o 2º jogador joga no mesmo teclado (W A S D + F + G)
    // 🎨 estilos: pixel (o de sempre), turbinado, hd e 3d — por fase, com troca ao vivo
    var estForcado = {}, pele = criarPele(jogo, spec, spritesJogo, perfil), estTela = 'pixel';
    var palcoCarregando = false, palcoErro = false, palcoPronto = false;
    function estiloDa(i) { var f = (spec.fases || [])[i] || {}; return estForcado[i] || f.estilo || spec.estilo || 'pixel'; }
    function emJogo() { var e = jogo.estado; return !(e === 'titulo' || e === 'fim_jogo' || e === 'vitoria'); }
    function prepararPalco() {
      if (palcoCarregando || palcoErro) { return; }
      palcoCarregando = true;
      import('/estudio/fliperama/motor-3d.js?v=' + VERSAO).then(function (M3) {
        palco = M3.criarPalco({ W: perfil.w, H: perfil.h, Z: pele.Z, T: perfil.tile, genero: spec.arquetipo, cima: !!GENEROS_DE_CIMA[spec.arquetipo], spec: spec, sprites: spritesJogo });
        palco.tela.style.cssText = 'display:none;grid-area:1/1;margin:0 auto';
        caixa.insertBefore(palco.tela, tela);
        escalar();
        return palco.preparar();
      }).then(function () { palcoPronto = true; })
        .catch(function (e) { palcoErro = true; reportar(e, 'estilo 3D (gêneros)'); });
    }
    function prepararTela(est) {   // o tamanho da tela e a pele mudam com o estilo
      var fina = est !== 'pixel';
      if (fina !== telaFina) {
        telaFina = fina;
        tela.width = perfil.w * (fina ? pele.Z : 1); tela.height = perfil.h * (fina ? pele.Z : 1);
        tela.style.imageRendering = fina ? 'auto' : 'pixelated';
        escalar();
      }
      pele.usar(est);
      estTela = est;
    }
    function desenharQuadro() {
      var est = emJogo() ? estiloDa(jogo.faseIdx) : estiloDa(0);
      if (est === '3d' && !palcoPronto) { prepararPalco(); }
      var tres = est === '3d' && palcoPronto && emJogo();
      var pel = est === '3d' ? (tres ? '3d' : 'hd') : est;
      if (pel !== estTela) { prepararTela(pel); }
      if (palco) { palco.tela.style.display = tres ? 'block' : 'none'; }
      tela.style.background = tres ? 'transparent' : '#000';
      if (pel === 'pixel') { ctx.setTransform(1, 0, 0, 1, 0, 0); jogo.desenhar(ctx); return; }
      ctx.setTransform(pele.Z, 0, 0, pele.Z, 0, 0);
      ctx.imageSmoothingEnabled = false;
      if (!tres) { jogo.desenhar(ctx); return; }
      // 3D: o mundo vai para o palco (blocos e personagens); o resto (placar, textos, bola, tiros) fica na tela de cima
      ctx.clearRect(0, 0, perfil.w, perfil.h);
      var reg = palco.comecar(jogo), f = jogo.fase || {}, ceu = f.ceu, cor = spec.cores || {}, fundo = cor.fundo;
      var dsAntes = jogo.desenharSprite, dtAntes = jogo.desenharTiles;
      jogo.desenharSprite = function (c, nome, x, y, q, virar) { reg.sprite(c, nome, x, y, q, virar); };
      jogo.desenharTiles = function (c) { reg.tiles(c, this); };
      try { f.ceu = 'rgba(0,0,0,0)'; if (cor.fundo) { cor.fundo = 'rgba(0,0,0,0)'; } jogo.desenhar(ctx); }
      finally { f.ceu = ceu; if (fundo) { cor.fundo = fundo; } jogo.desenharSprite = dsAntes; jogo.desenharTiles = dtAntes; }
      palco.desenhar(jogo, ceu || fundo || '#000000');
    }
    // 🏅 a tela que hospeda o jogo fica sabendo de "terminou a fase" e "venceu" (Jornada do Jovem Dev)
    jogo.evento = function (nome, dados) { try { if (opcoes.aoEvento) { opcoes.aoEvento(nome, dados || {}); } } catch (e) { /* nunca derruba o jogo */ } };
    var acumulado = 0, ultimo = performance.now(), quebrado = null, raf = null;
    // 🏆 placar (E6): grava a partida e manda para a casa no fim — só no jogo de verdade (com slug), nunca no robô
    var grav = null, estadoAntes = jogo.estado;
    function token() { try { return localStorage.getItem('token') || ''; } catch (e) { return ''; } }
    function placarApi(caminho, corpo) {
      if (!opcoes.slug || !token() || typeof fetch !== 'function') { return Promise.resolve(null); }
      return fetch(caminho, corpo ? { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token() }, body: JSON.stringify(corpo) }
                               : { headers: { Authorization: 'Bearer ' + token() } })
        .then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
    }
    function lerRecorde() { placarApi('/estudio/fliperama/placar/' + encodeURIComponent(opcoes.slug) + '?top=1').then(function (d) { if (d && d.placar && d.placar[0]) { jogo.recorde = d.placar[0]; } }); }
    if (opcoes.slug && opcoes.placar !== false) { lerRecorde(); }
    function depoisDoPasso(inp) {
      var e = jogo.estado;
      if (grav) { grav.por(mascara(inp)); }
      var antes = estadoAntes; estadoAntes = e;
      var parado = function (s) { return s === 'titulo' || s === 'fim_jogo' || s === 'vitoria'; };
      if (parado(antes) && !parado(e)) {            // começou uma partida
        jogo.placarMsg = null;
        if (!jogo.__roboEntrada && opcoes.slug && opcoes.placar !== false && !jogo.j2ativo) { grav = gravador(); grav.por(mascara(inp)); }
        if (jogo.evento) { jogo.evento('comecou', {}); }
      } else if (!parado(antes) && parado(e)) {     // acabou
        if (jogo.evento) { jogo.evento('fim_partida', { pontos: jogo.pontos, venceu: e === 'vitoria' }); }
        if (grav && jogo.pontos > 0) {
          var corpo = { slug: opcoes.slug, pontos: jogo.pontos, fase: jogo.faseIdx + 1, venceu: e === 'vitoria',
                        entradas: grav.texto(), quadros: grav.quadros(), semente: jogo.semente, versao: VERSAO,
                        jogador_id: opcoes.jogador || null };   // 📺 TV: quem está jogando
          jogo.placarMsg = 'ENVIANDO PARA O PLACAR...';
          placarApi('/estudio/fliperama/placar', corpo).then(function (r) {
            jogo.placarMsg = r ? (r.recorde ? 'NOVO RECORDE! A CASA VAI CONFERIR' : 'PONTOS NO PLACAR!') : null;
            setTimeout(lerRecorde, 20000);
          });
        }
        grav = null;
      }
    }

    function quadro(agora) {
      raf = requestAnimationFrame(quadro);
      if (quebrado) { return; }
      acumulado += Math.min(250, agora - ultimo); ultimo = agora;
      try {
        while (acumulado >= PASSO) {
          if (jogo.__roboEntrada) { var _e = jogo.__roboEntrada(); jogo.atualizar(entradaDe(_e, jogo.__antes)); jogo.__antes = _e; estadoAntes = jogo.estado; }
          else { var _i = entrada.ler(); jogo.atualizar(_i); depoisDoPasso(_i); }
          acumulado -= PASSO;
        }
        desenharQuadro();
      } catch (e) {
        quebrado = reportar(e, 'laço do jogo');
        ctx.setTransform(telaFina ? pele.Z : 1, 0, 0, telaFina ? pele.Z : 1, 0, 0);
        ctx.fillStyle = '#000'; ctx.fillRect(0, 0, perfil.w, perfil.h);
        textoCentro(ctx, 'O JOGO QUEBROU', perfil.w, 20, '#F83800', 2);
        texto(ctx, quebrado.slice(0, 60), 4, 50, '#FCFCFC', 1);
        textoCentro(ctx, 'O ERRO FOI ENVIADO PARA A CASA', perfil.w, perfil.h - 16, '#7C7C7C', 1);
      }
    }
    raf = requestAnimationFrame(quadro);
    function apontar(clientX, clientY) {
      var r = tela.getBoundingClientRect();
      var sx = Math.floor((clientX - r.left) * perfil.w / r.width), sy = Math.floor((clientY - r.top) * perfil.h / r.height);   // (a tela fina continua em pixels da era)
      return jogo.objetoEm ? jogo.objetoEm(sx, sy) : null;
    }
    jogo.j2ativo = false;
    return { jogo: jogo, tela: tela, apontar: apontar,
             // 📱 celular como controle: o hospedeiro passa o estado das teclas de cada jogador
             controle: function (slot, est) { entrada.definirRemoto(slot, est || {}); },
             doisJogadores: function (sim) { jogo.j2ativo = !!sim && !!(Genero.prototype.doisJogadores || jogo.usaTeclado2); return jogo.j2ativo; },
             aceitaDois: !!(Genero.prototype.doisJogadores || jogo.usaTeclado2),
             pausar: function (s) { if (jogo.pausar) { jogo.pausar(s); } },
             // 🎨 troca ao vivo o estilo da fase que está na tela (o Jogar do Fliperama grava na especificação)
             estilo: function (nome) { var i = emJogo() ? (jogo.faseIdx || 0) : 0; estForcado[i] = nome; return i; },
             estiloAtual: function () { return estiloDa(emJogo() ? (jogo.faseIdx || 0) : 0); },
             parar: function () { cancelAnimationFrame(raf); jogo.som.parar(); window.removeEventListener('resize', escalar); try { if (palco) { palco.destruir(); } } catch (e) { /* nada */ } },
             reconstruir: function () { /* a casa redesenha tudo a cada quadro */ }, telaDoJogo: function () { return tela; },
             versao: VERSAO };
  }

  // ═══════════════════════ 🧬 CLONES (motor 0.9.8 · 26/10/2026, decisão do autor após a mini-bancada) ═══════════════════════
  // Personagem novo = um personagem PRONTO da casa (que já tem animação e esqueleto) + cores trocadas + acessórios do KIT.
  // spec.clones[id] = {nome, hd: {base, cores:[{de,para}], acessorios:[...]}, d3: {base, cores:{Material:"#hex"}, tinta, acessorios:[...]}}
  // acessório = {id (do KIT), cor:"#hex", escala:0.4–2.5, dx, dy (só HD, fração do desenho), sobe, frente (só 3D, em "cabeças")}
  // Usar no jogo: spec.hd.personagens[sprite] = "clone:<id>" e spec.d3.personagens[sprite] = "clone:<id>".
  // A criança monta à mão no Estúdio (🧬 Criar personagem) ou pede à IA, que preenche a mesma ficha.
  function hx(c) { var m = /^#?([0-9a-f]{6})$/i.exec(String(c || '')); var n = m ? parseInt(m[1], 16) : 0x888888; return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function hexDe(r, g, b) { return '#' + [r, g, b].map(function (v) { v = Math.max(0, Math.min(255, Math.round(v))); return (v < 16 ? '0' : '') + v.toString(16); }).join('').toUpperCase(); }
  function mudaLuz(c, k) { var p = hx(c); return hexDe(p[0] * k, p[1] * k, p[2] * k); }
  function rgb2hsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, h = 0, s = 0, d = mx - mn;
    if (d > 1e-6) { s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn); h = mx === r ? ((g - b) / d + (g < b ? 6 : 0)) : (mx === g ? (b - r) / d + 2 : (r - g) / d + 4); h *= 60; }
    return [h, s, l];
  }
  function hsl2rgb(h, s, l) {
    h = ((h % 360) + 360) % 360 / 360;
    if (s <= 0) { return [l * 255, l * 255, l * 255]; }
    var q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    function f(t) { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : (t < 0.5 ? q : (t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p)); }
    return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
  }
  // as "partes" de um desenho HD: as cores que mais aparecem, agrupadas pelo tom (a criança pinta cada parte)
  function partesHD(im) {
    var c = document.createElement('canvas'); c.width = im.naturalWidth || im.width; c.height = im.naturalHeight || im.height;
    var x = c.getContext('2d'); x.drawImage(im, 0, 0);
    var d = x.getImageData(0, 0, c.width, c.height).data, grupos = {}, tot = 0;
    for (var i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 200) { continue; }
      var hsl = rgb2hsl(d[i], d[i + 1], d[i + 2]);
      if (hsl[2] < 0.12) { continue; }   // contorno escuro: não é parte
      var k = hsl[1] < 0.15 ? 'g' + Math.round(hsl[2] * 4) : 'h' + Math.round(hsl[0] / 24) % 15;
      var gr = grupos[k] || (grupos[k] = { n: 0, r: 0, g: 0, b: 0 }); gr.n++; gr.r += d[i]; gr.g += d[i + 1]; gr.b += d[i + 2]; tot++;
    }
    return Object.keys(grupos).map(function (k) { var g = grupos[k]; return { cor: hexDe(g.r / g.n, g.g / g.n, g.b / g.n), frac: g.n / Math.max(1, tot) }; })
      .filter(function (p) { return p.frac >= 0.04; }).sort(function (a, b) { return b.frac - a.frac; }).slice(0, 5);
  }
  function recolorir(ctx, w, h, cores) {
    var alvo = (cores || []).map(function (c) { var a = hx(c.de), b = hx(c.para); return { de: rgb2hsl(a[0], a[1], a[2]), para: rgb2hsl(b[0], b[1], b[2]) }; });
    if (!alvo.length) { return; }
    var img = ctx.getImageData(0, 0, w, h), d = img.data;
    for (var i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 10) { continue; }
      var p = rgb2hsl(d[i], d[i + 1], d[i + 2]);
      if (p[2] < 0.12) { continue; }
      for (var k = 0; k < alvo.length; k++) {
        var de = alvo[k].de, pa = alvo[k].para, perto;
        if (de[1] < 0.15) { perto = p[1] < 0.18 && Math.abs(p[2] - de[2]) < 0.16; }
        else { var dh = Math.abs(p[0] - de[0]); dh = Math.min(dh, 360 - dh); perto = p[1] >= 0.12 && dh <= 16; }
        if (!perto) { continue; }
        var s = de[1] < 0.15 ? pa[1] : Math.min(1, pa[1] * (p[1] / Math.max(de[1], 0.05))), l = Math.max(0.05, Math.min(0.97, p[2] + (pa[2] - de[2])));
        var nv = hsl2rgb(pa[0], s, l); d[i] = nv[0]; d[i + 1] = nv[1]; d[i + 2] = nv[2];
        break;
      }
    }
    ctx.putImageData(img, 0, 0);
  }
  function svgPol(pts, cor) { return '<polygon points="' + pts + '" fill="' + cor + '"/>'; }
  // KIT da casa: onde fica, como aparece no HD (SVG 100×100, centro no ponto de encaixe) e no 3D (peças em "cabeças")
  var KIT = {
    chapeu_bruxo: { nome: 'Chapéu de bruxo', onde: 'cabeca', cor: '#5B2A86', hd: { l: 0.95, y: -0.38 },
      svg: function (c) { return svgPol('50,2 24,78 76,78', c) + '<ellipse cx="50" cy="80" rx="48" ry="10" fill="' + mudaLuz(c, 0.75) + '"/><rect x="27" y="62" width="46" height="9" fill="#F2C94C"/>'; },
      d3: [['cone', [0, 0.95, 0], [0.85, 1.1, 0.85]], ['cilindro', [0, 0.42, 0], [1.45, 0.07, 1.45], 0.75], ['cilindro', [0, 0.55, 0], [0.8, 0.12, 0.8], null, '#F2C94C']] },
    cartola: { nome: 'Cartola', onde: 'cabeca', cor: '#22222E', hd: { l: 0.8, y: -0.36 },
      svg: function (c) { return '<rect x="26" y="8" width="48" height="66" rx="4" fill="' + c + '"/><rect x="26" y="56" width="48" height="10" fill="#C0392B"/><ellipse cx="50" cy="78" rx="46" ry="9" fill="' + mudaLuz(c, 1.3) + '"/>'; },
      d3: [['cilindro', [0, 0.88, 0], [0.72, 0.8, 0.72]], ['cilindro', [0, 0.6, 0], [0.74, 0.12, 0.74], null, '#C0392B'], ['cilindro', [0, 0.47, 0], [1.25, 0.06, 1.25], 1.3]] },
    bone: { nome: 'Boné', onde: 'cabeca', cor: '#E53935', hd: { l: 0.8, y: -0.18 },
      svg: function (c) { return '<path d="M10 70 Q12 22 54 20 Q92 22 94 70 Z" fill="' + c + '"/><path d="M60 66 L100 70 L100 78 L58 76 Z" fill="' + mudaLuz(c, 0.7) + '"/><circle cx="52" cy="22" r="5" fill="' + mudaLuz(c, 0.7) + '"/>'; },
      d3: [['esfera', [0, 0.42, 0], [1.08, 0.66, 1.08]], ['cilindro', [0, 0.4, 0.55], [0.75, 0.05, 0.62], 0.7]] },
    coroa: { nome: 'Coroa', onde: 'cabeca', cor: '#F2C94C', hd: { l: 0.7, y: -0.22 },
      svg: function (c) { return svgPol('8,86 8,30 28,58 50,14 72,58 92,30 92,86', c) + '<rect x="8" y="76" width="84" height="10" fill="' + mudaLuz(c, 0.8) + '"/><circle cx="50" cy="66" r="7" fill="#E53935"/><circle cx="26" cy="72" r="5" fill="#2F80ED"/><circle cx="74" cy="72" r="5" fill="#27AE60"/>'; },
      d3: [['cilindro', [0, 0.62, 0], [0.82, 0.28, 0.82]], ['cone', [0.32, 0.86, 0], [0.18, 0.3, 0.18]], ['cone', [-0.32, 0.86, 0], [0.18, 0.3, 0.18]], ['cone', [0, 0.86, 0.32], [0.18, 0.3, 0.18]], ['cone', [0, 0.86, -0.32], [0.18, 0.3, 0.18]], ['esfera', [0, 0.62, 0.42], [0.14, 0.14, 0.08], null, '#E53935']] },
    capacete: { nome: 'Capacete', onde: 'cabeca', cor: '#E53935', hd: { l: 0.95, y: -0.12 },
      svg: function (c) { return '<path d="M6 74 Q6 14 50 12 Q94 14 94 74 Z" fill="' + c + '"/><path d="M2 70 L98 70 L98 80 L2 80 Z" fill="' + mudaLuz(c, 0.72) + '"/><path d="M40 24 L60 24 L58 56 L42 56 Z" fill="#F2C94C"/>'; },
      d3: [['esfera', [0, 0.38, -0.05], [1.18, 0.86, 1.18]], ['cilindro', [0, 0.18, 0], [1.3, 0.06, 1.3], 0.72], ['cubo', [0, 0.55, 0.52], [0.22, 0.32, 0.06], null, '#F2C94C']] },
    oculos: { nome: 'Óculos escuros', onde: 'rosto', cor: '#15151F', hd: { l: 0.62, y: 0 },
      svg: function (c) { return '<rect x="4" y="34" width="40" height="28" rx="12" fill="' + c + '"/><rect x="56" y="34" width="40" height="28" rx="12" fill="' + c + '"/><rect x="40" y="40" width="20" height="6" fill="' + c + '"/><rect x="10" y="39" width="12" height="6" rx="3" fill="#FFFFFF" opacity=".55"/><rect x="62" y="39" width="12" height="6" rx="3" fill="#FFFFFF" opacity=".55"/>'; },
      d3: [['cilindro', [0.22, 0.02, 0.56], [0.32, 0.06, 0.26], null, null, [90, 0, 0]], ['cilindro', [-0.22, 0.02, 0.56], [0.32, 0.06, 0.26], null, null, [90, 0, 0]], ['cubo', [0, 0.05, 0.58], [0.16, 0.04, 0.04]]] },
    tapa_olho: { nome: 'Tapa-olho', onde: 'rosto', cor: '#15151F', hd: { l: 0.62, y: 0 },
      svg: function (c) { return '<path d="M0 26 L100 46" stroke="' + c + '" stroke-width="6"/><ellipse cx="62" cy="44" rx="20" ry="17" fill="' + c + '"/>'; },
      d3: [['cilindro', [0.2, 0.04, 0.56], [0.3, 0.05, 0.28], null, null, [90, 0, 0]], ['toro', [0, 0.12, 0], [1.3, 1.3, 1.3], null, null, [90, 0, 14]]] },
    bigode: { nome: 'Bigode', onde: 'rosto', cor: '#4A2C1A', hd: { l: 0.5, y: 0.34 },
      svg: function (c) { return '<path d="M50 40 Q30 26 8 48 Q30 54 50 48 Q70 54 92 48 Q70 26 50 40 Z" fill="' + c + '"/>'; },
      d3: [['esfera', [0.13, -0.18, 0.55], [0.28, 0.09, 0.1]], ['esfera', [-0.13, -0.18, 0.55], [0.28, 0.09, 0.1]]] },
    chifres: { nome: 'Chifres', onde: 'cabeca', cor: '#F3E9D2', hd: { l: 0.85, y: -0.12 },
      svg: function (c) { return '<path d="M20 90 Q4 40 22 6 Q30 46 38 88 Z" fill="' + c + '"/><path d="M80 90 Q96 40 78 6 Q70 46 62 88 Z" fill="' + c + '"/>'; },
      d3: [['cone', [0.32, 0.62, 0], [0.2, 0.55, 0.2], null, null, [0, 0, -22]], ['cone', [-0.32, 0.62, 0], [0.2, 0.55, 0.2], null, null, [0, 0, 22]]] },
    orelhas_gato: { nome: 'Orelhas de gato', onde: 'cabeca', cor: '#F28DB2', hd: { l: 0.85, y: -0.08 },
      svg: function (c) { return svgPol('8,92 18,10 46,80', c) + svgPol('92,92 82,10 54,80', c) + svgPol('16,80 21,34 36,74', '#FFD6E5') + svgPol('84,80 79,34 64,74', '#FFD6E5'); },
      d3: [['piramide', [0.3, 0.62, 0], [0.32, 0.42, 0.14]], ['piramide', [-0.3, 0.62, 0], [0.32, 0.42, 0.14]]] },
    laco: { nome: 'Laço', onde: 'cabeca', cor: '#FF4D8D', hd: { l: 0.5, y: -0.05, x: 0.2 },
      svg: function (c) { return svgPol('50,50 8,24 8,76', c) + svgPol('50,50 92,24 92,76', c) + '<circle cx="50" cy="50" r="11" fill="' + mudaLuz(c, 0.75) + '"/>'; },
      d3: [['esfera', [0.18, 0.52, 0.1], [0.28, 0.2, 0.1]], ['esfera', [0.42, 0.52, 0.1], [0.28, 0.2, 0.1]], ['esfera', [0.3, 0.52, 0.12], [0.1, 0.1, 0.1], 0.75]] },
    aureola: { nome: 'Auréola', onde: 'cabeca', cor: '#FFE36E', hd: { l: 0.7, y: -0.5 },
      svg: function (c) { return '<ellipse cx="50" cy="50" rx="44" ry="14" fill="none" stroke="' + c + '" stroke-width="9"/>'; },
      d3: [['toro', [0, 0.9, 0], [0.9, 0.9, 0.9], null, null, [90, 0, 0]]] },
    capa: { nome: 'Capa', onde: 'costas', cor: '#C0392B', atras: true, hd: { l: 0.9, y: 0.1 },
      svg: function (c) { return '<path d="M30 4 L70 4 L96 98 L4 98 Z" fill="' + c + '"/><path d="M30 4 L70 4 L66 14 L34 14 Z" fill="' + mudaLuz(c, 0.7) + '"/>'; },
      d3: [['cubo', [0, -0.55, -0.42], [1.1, 1.7, 0.06], null, null, [8, 0, 0]]] },
    asas: { nome: 'Asas', onde: 'costas', cor: '#E8F4FF', atras: true, hd: { l: 1.2, y: -0.1 },
      svg: function (c) { return '<path d="M50 60 Q20 10 2 30 Q8 60 50 64 Z" fill="' + c + '" stroke="' + mudaLuz(c, 0.75) + '" stroke-width="3"/><path d="M50 60 Q80 10 98 30 Q92 60 50 64 Z" fill="' + c + '" stroke="' + mudaLuz(c, 0.75) + '" stroke-width="3"/>'; },
      d3: [['cubo', [0.55, 0.35, -0.42], [0.95, 0.6, 0.05], null, null, [0, -25, 20]], ['cubo', [-0.55, 0.35, -0.42], [0.95, 0.6, 0.05], null, null, [0, 25, -20]]] },
    estrela_peito: { nome: 'Estrela no peito', onde: 'corpo', cor: '#F2C94C', hd: { l: 0.4, y: -0.05 },
      svg: function (c) { return svgPol('50,4 62,38 98,38 69,59 80,94 50,73 20,94 31,59 2,38 38,38', c); },
      d3: [['cilindro', [0, 0, 0.42], [0.42, 0.05, 0.42], null, null, [90, 0, 0]]] },
  };
  // pontos de encaixe no desenho HD (fração da caixa do personagem; a casa desenha olhando para a direita)
  var ENCAIXE_HD = { cabeca: [0.5, 0], rosto: [0.62, 0.24], corpo: [0.5, 0.58], costas: [0.32, 0.45] };
  function svgKit(id, cor) { var k = KIT[id]; return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' + k.svg(cor || k.cor) + '</svg>'; }
  function imagemPronta(src) { return new Promise(function (ok, no) { var i = new Image(); i.onload = function () { ok(i); }; i.onerror = function () { no(new Error('imagem: ' + String(src).slice(0, 80))); }; i.src = src; }); }
  function caixaOpaca(c) {
    var x = c.getContext('2d'), d = x.getImageData(0, 0, c.width, c.height).data, x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
    for (var y = 0; y < c.height; y++) { for (var i = 0; i < c.width; i++) { if (d[(y * c.width + i) * 4 + 3] > 24) { if (i < x0) { x0 = i; } if (i > x1) { x1 = i; } if (y < y0) { y0 = y; } if (y > y1) { y1 = y; } } } }
    return x1 < 0 ? { x: 0, y: 0, w: c.width, h: c.height } : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }
  // um quadro HD do clone: o desenho da base recolorido + acessórios (os de trás antes, os da frente depois)
  function quadroClone(im, hd, svgs, semAcess) {
    var w = im.naturalWidth || im.width, h = im.naturalHeight || im.height;
    var base = document.createElement('canvas'); base.width = w; base.height = h;
    var bx = base.getContext('2d'); bx.drawImage(im, 0, 0); recolorir(bx, w, h, hd.cores);
    var cx = caixaOpaca(base), topo = 0;
    if (!semAcess) {   // espaço em cima para o que passa da cabeça (chapéu, auréola…): o desenho fica um pouco menor, nada é cortado
      (hd.acessorios || []).forEach(function (a) { var k = KIT[a.id]; if (!k) { return; }
        var t = cx.w * k.hd.l * Math.max(0.4, Math.min(2.5, +a.escala || 1)), p = ENCAIXE_HD[k.onde] || ENCAIXE_HD.cabeca;
        var alto = cx.y + cx.h * (p[1] + Math.max(-0.5, Math.min(0.5, +a.dy || 0))) + t * (k.hd.y || 0) - t / 2;
        topo = Math.max(topo, Math.ceil(-alto) + 2); });
      topo = Math.min(topo, Math.round(h * 0.7));
    }
    var c = document.createElement('canvas'); c.width = w; c.height = h + topo;
    var x = c.getContext('2d');
    function poe(a) {
      var k = KIT[a.id], sv = svgs[a.id + '|' + (a.cor || k.cor)]; if (!k || !sv) { return; }
      var e = Math.max(0.4, Math.min(2.5, +a.escala || 1)), t = cx.w * k.hd.l * e, p = ENCAIXE_HD[k.onde] || ENCAIXE_HD.cabeca;
      var px = cx.x + cx.w * (p[0] + (k.hd.x || 0) + Math.max(-0.5, Math.min(0.5, +a.dx || 0))), py = topo + cx.y + cx.h * (p[1] + Math.max(-0.5, Math.min(0.5, +a.dy || 0))) + t * (k.hd.y || 0);
      x.drawImage(sv, px - t / 2, py - t / 2, t, t);
    }
    var ac = semAcess ? [] : (hd.acessorios || []).slice(0, 8);
    ac.filter(function (a) { return KIT[a.id] && KIT[a.id].atras; }).forEach(poe);
    x.drawImage(base, 0, topo);
    ac.filter(function (a) { return KIT[a.id] && !KIT[a.id].atras; }).forEach(poe);
    return c;
  }
  // põe os clones do jogo na biblioteca HD já carregada: B.personagens["clone:<id>"], com os quadros em B.dados
  function clonesHD(B, spec, base) {
    var cl = (spec && spec.clones) || {}, ids = Object.keys(cl).filter(function (id) { var c = cl[id]; return c && c.hd && B.personagens[c.hd.base]; });
    if (!ids.length) { return Promise.resolve(B); }
    B.dados = B.dados || {}; B.tamanhos = B.tamanhos || {};
    base = base || '/estudio/fliperama/hd/';
    return Promise.all(ids.map(function (id) {
      var c = cl[id], hd = c.hd, bp = B.personagens[hd.base], svgs = {}, esperas = [];
      (hd.acessorios || []).forEach(function (a) { var k = KIT[a.id]; if (!k) { return; } var ch = a.id + '|' + (a.cor || k.cor);
        if (!svgs[ch]) { svgs[ch] = 1; esperas.push(imagemPronta('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgKit(a.id, a.cor))).then(function (i) { svgs[ch] = i; }).catch(function () { delete svgs[ch]; })); } });
      var quadros = {};
      Object.keys(bp.quadros).forEach(function (est) {
        quadros[est] = bp.quadros[est].map(function (arq, i) {
          var chave = 'clone/' + id + '/' + est + i;
          esperas.push(imagemPronta(B.dados[arq] || base + arq).then(function (im) { quadros['_' + chave] = im; }).catch(function () { /* quadro que não abriu fica de fora */ }));
          return chave;
        });
      });
      return Promise.all(esperas).then(function () {
        Object.keys(quadros).forEach(function (est) {
          if (est.charAt(0) === '_') { return; }
          quadros[est].forEach(function (chave) {
            var im = quadros['_' + chave]; if (!im) { return; }
            var cv = quadroClone(im, hd, svgs, est === 'morto');
            B.dados[chave] = cv.toDataURL('image/png'); B.tamanhos[chave] = [cv.width, cv.height];
          });
        });
        var q2 = {}; Object.keys(quadros).forEach(function (est) { if (est.charAt(0) !== '_') { var l = quadros[est].filter(function (k) { return B.dados[k]; }); if (l.length) { q2[est] = l; } } });
        if (q2.parado) { B.personagens['clone:' + id] = { nome: c.nome || bp.nome, papel: bp.papel, fonte: 'clone', base: hd.base, quadros: q2 }; }
      });
    })).then(function () { return B; });
  }

  window.Fliperama = { _scale2x: function (c) { return scale2x(c); }, _mapaPeleHD: function (spec, B) { return mapaPeleHD(spec, B); }, iniciar: iniciar, simular: simular, atracao: atracao, repetir: repetir, _mascara: mascara, _gravador: gravador, versao: VERSAO, reportar: reportar, _generos: GENEROS, _sprites: montarSprites, _motores: MOTORES,
                       // 🧩 motor 0.9: o motor Phaser (motor-phaser.js) reaproveita a simulação, as regras, o mágico e o som da casa
                       _timbres: TIMBRES, _musicasCasa: MUSICAS_BIBLIOTECA,
                       _kit: KIT, _svgKit: svgKit, _partesHD: partesHD, _clonesHD: clonesHD, _quadroClone: quadroClone, _encaixeHD: ENCAIXE_HD,
                       _cartas: { casa: function (spec, letra) { return Cartas.regrasCasa(spec, letra); }, QUANDO: Cartas.QUANDO, SE: Cartas.SE, FAZ: Cartas.FAZ, generos: Cartas.generos },
                       _interno: { Plataforma: Plataforma, Cartas: Cartas, Som: Som, Entrada: Entrada, Magico: Magico, montarSprites: montarSprites, mulberry32: mulberry32, entradaDe: entradaDe, texto: texto, textoCentro: textoCentro, larguraTexto: larguraTexto, PASSO: PASSO } };
})();
