/* 🕹️ FLIPERAMA — motor Phaser 4 da casa ("arte livre", prova 2 do motor 2 · 25/10/2026).
 *
 * O jogo é o MESMO jogo.json: a simulação (física, peças, regras, código mágico, robô, som) é a da casa
 * (motor.js · Fliperama._interno.Plataforma). O Phaser 4 só DESENHA e ANIMA — em 3× a resolução da era,
 * com rolagem suave por subpixel, partículas, "amassar" no pouso, brilho nas moedas, vinheta, escuridão
 * com luz ao redor do herói nas fases escuras, balão de fala nas mensagens e eco suave no som.
 * Assim a comparação "casa × Phaser" mede só o visual e o peso, com o mesmo jogo e o mesmo placar.
 *
 * Liga com `"motor": "phaser"` na especificação (só plataforma, por enquanto). O motor.js carrega este
 * arquivo e o Phaser (vendorizado em /estudio/fliperama/phaser/, MIT) sob demanda.
 */
(function () {
  'use strict';
  var VERSAO = '0.9.8-phaser';
  var Z = 3;   // cada pixel da era vira 3×3 — a tela fica 3× mais fina para movimento e efeitos

  function cor(h) { return parseInt(String(h || '#000000').slice(1), 16); }
  function escuro(h) { var n = cor(h); return (((n >> 16) & 255) * 0.3 + ((n >> 8) & 255) * 0.59 + (n & 255) * 0.11) < 40; }

  function iniciar(raiz, spec, opcoes, atracao) {
    var F = window.Fliperama, I = F._interno;
    opcoes = opcoes || {};
    var perfis = (opcoes.perfis && opcoes.perfis.perfis) || opcoes.perfis || {};
    var perfil = perfis[spec.perfil];
    if (!perfil) { throw new Error('perfil de era desconhecido: ' + spec.perfil); }
    if (spec.arquetipo !== 'plataforma') { throw new Error('o motor Phaser por enquanto só joga plataforma'); }
    var W = perfil.w, H = perfil.h;
    raiz.innerHTML = '';
    raiz.style.position = 'relative';
    var host = document.createElement('div');
    host.setAttribute('data-doc', 'Fliperama · tela do jogo · motor Phaser 4 (arte livre) ' + VERSAO);
    host.style.cssText = 'display:grid;grid-template-columns:100%;justify-items:center;width:100%';   // grade: a tela 3D fica embaixo da tela do Phaser, na mesma casa
    raiz.appendChild(host);

    var sprites = I.montarSprites(spec);
    var som = new I.Som(spec, perfil); som.eco = true; som.canais = Math.max(som.canais, 5);
    var jogo = new I.Plataforma(spec, perfil, sprites, som, opcoes.semente || 20261024);
    jogo.evento = function (nome, dados) { try { if (opcoes.aoEvento) { opcoes.aoEvento(nome, dados || {}); } } catch (e) { /* nunca derruba */ } };
    var robo = null;
    if (atracao) {
      som.mudo = true; som.ligar = function () {};
      jogo.vidasIniciais = 99;
      var mem = {}, rng = I.mulberry32(3);
      robo = function () {
        if (jogo.estado === 'titulo' || jogo.estado === 'fim_jogo' || jogo.estado === 'vitoria') { return { start: (jogo.quadro % 120) === 60 }; }
        return jogo.roboEntrada(mem, false, rng);
      };
    }
    var entrada = null, antesRobo = {}, cena = null, quebrado = null;
    var her = spec.heroi || {};
    var jg = F.jogabilidade ? F.jogabilidade(spec, opcoes.jogabilidade || {}) : { regras: {}, livres: {}, modo: '' }, jgRegras = jg.regras;

    // ───────── 🎨 ESTILOS por fase (25/10/2026): "pixel" (o desenho da era), "turbinado" (o mesmo desenho ampliado
    // com Scale2x×2 e suavizado) e "hd" (a biblioteca HD da casa, CC0). A lógica é a mesma: só o desenho muda. ─────────
    var BASE_HD = '/estudio/fliperama/hd/';
    var estiloForcado = {};          // troca ao vivo (botão do Jogar) — por fase
    function estiloDa(idx) { var f = (spec.fases || [])[idx] || {}; return estiloForcado[idx] || f.estilo || spec.estilo || 'pixel'; }
    var BIB = null, carregandoBib = null;
    function biblioteca() {
      if (BIB) { return Promise.resolve(BIB); }
      if (!carregandoBib) { carregandoBib = fetch(BASE_HD + 'biblioteca.json').then(function (r) { return r.json(); })
        .then(function (b) { return F._clonesHD ? F._clonesHD(b, spec, BASE_HD) : b; }).then(function (b) { BIB = b; return b; }); }   // 🧬 0.9.8: clones do jogo
      return carregandoBib;
    }
    // quem é quem no HD: o que a especificação pediu (spec.hd) e, no que faltar, a casa escolhe pelo papel
    var HD = {};
    function mapaHD(fi) {
      fi = fi == null ? (jogo.faseIdx || 0) : fi;
      if (HD[fi]) { return HD[fi]; }
      var faseAqui = (spec.fases || [])[fi] || {};
      var pedido = spec.hd || {}, P = BIB.personagens, BL = BIB.blocos;
      var pers = {}, blocos = {}, ents = spec.entidades || {}, tiles = spec.tiles || {};
      function ok(id, tab) { return id && tab[id] ? id : null; }
      var heroiId = ok((pedido.personagens || {})[her.sprite], P) || ok(pedido.heroi, P) || 'alien_verde';
      [her.sprite, her.sprite_grande, her.sprite_poder].concat(Object.keys(her.animacoes || {}).map(function (k) { return her.animacoes[k]; }))
        .concat(Object.keys(her.animacoes_grande || {}).map(function (k) { return her.animacoes_grande[k]; }))
        .forEach(function (n) { if (n) { pers[n] = heroiId; } });
      var usados = {};
      Object.keys(ents).forEach(function (ch) {
        var e = ents[ch] || {}, n = e.sprite; if (!n || pers[n]) { return; }
        var quer = ok((pedido.personagens || {})[n], P);
        if (!quer) {
          var pc = {}; (e.pecas || []).forEach(function (x) { pc[x] = 1; });
          var c = e.comportamento || '';
          if (e.tipo === 'coletavel') { quer = 'moeda_ouro'; }
          else if (e.tipo === 'poder') { quer = { crescer: 'cogumelo', estrela: 'estrela', vida: 'coracao', pulo_duplo: 'gema_azul' }[e.da] || 'gema_verde'; }
          else if (e.tipo === 'fim_de_fase') { quer = 'bandeira_verde'; }
          else if (e.tipo === 'chave') { quer = 'chave'; }
          else if (pc.plataforma) { quer = 'plataforma_madeira'; }
          else if (pc.chefe) { quer = 'besouro_gigante'; }
          else if (pc.casco) { quer = 'lesma'; }
          else if (pc.voa || c.indexOf('voa') === 0) { quer = usados.abelha ? 'mosca' : 'abelha'; }
          else if (pc.pula || c === 'pula') { quer = 'sapo'; }
          else if (pc.espinho) { quer = 'serra'; }
          else if (pc.atira) { quer = 'planta'; }
          else { quer = ['gosma_verde', 'rato', 'minhoca', 'gosma_roxa', 'joaninha'].filter(function (x) { return !usados[x]; })[0] || 'gosma_azul'; }
        }
        usados[quer] = 1; pers[n] = quer;
        if (e.sprite_casco) { pers[e.sprite_casco] = quer; }
      });
      // blocos: o alvo de um "vira" é o bloco usado; o resto pelo jeito do bloco
      var viraDe = {};
      Object.keys(tiles).forEach(function (ch) { var t = tiles[ch] || {}; var v = t.vira || (t.surpresa && t.surpresa.vira); if (v) { viraDe[v] = 1; } });
      var solidos = Object.keys(tiles).filter(function (ch) { var t = tiles[ch] || {}; return t.solido && !t.mortal && !t.plataforma && !t.surpresa && !t.quebravel && !viraDe[ch] && !t.entrada; });
      // quem fica na superfície (com o céu em cima) é o chão "de verdade"; quem só aparece embaixo de outro vira o miolo dele
      var sup = {}, emb = {}, debaixoDe = {};
      [faseAqui].forEach(function (f) { var m = f.mapa || []; for (var j = 0; j < m.length; j++) { for (var i = 0; i < m[j].length; i++) {
        var c = m[j][i]; if (solidos.indexOf(c) < 0) { continue; }
        var cima = j > 0 ? m[j - 1][i] : '.';
        if (solidos.indexOf(cima) < 0) { sup[c] = (sup[c] || 0) + 1; } else { emb[c] = (emb[c] || 0) + 1; if (cima !== c) { (debaixoDe[c] = debaixoDe[c] || {})[cima] = ((debaixoDe[c] || {})[cima] || 0) + 1; } }
      } } });
      var miolo = {};
      solidos.forEach(function (c) {
        if ((sup[c] || 0) < 0.08 * ((sup[c] || 0) + (emb[c] || 0)) && debaixoDe[c]) {
          miolo[c] = Object.keys(debaixoDe[c]).sort(function (a, b) { return debaixoDe[c][b] - debaixoDe[c][a]; })[0];
        }
      });
      solidos = solidos.filter(function (c) { return !miolo[c]; });
      solidos.sort(function (a, b) { return (sup[b] || 0) - (sup[a] || 0); });
      var chaos = escuro(faseAqui.ceu) ? ['pedra', 'tijolo_cinza', 'terra', 'planeta', 'caixote'] : ['grama', 'caixote', 'tijolo_cinza', 'pedra', 'terra', 'areia', 'planeta'];
      Object.keys(tiles).forEach(function (ch) {
        var t = tiles[ch] || {}, quer = ok((pedido.blocos || {})[ch], BL);
        if (!quer) {
          if (viraDe[ch]) { quer = 'caixa_usada'; }
          else if (t.surpresa) { quer = 'caixa_surpresa'; }
          else if (t.quebravel) { quer = 'tijolo'; }
          else if (t.entrada) { quer = 'caixote'; }
          else if (t.mortal && !t.solido) { quer = 'lava'; }
          else if (t.mortal) { quer = 'espinhos'; }
          else if (t.plataforma) { quer = 'ponte'; }
          else if (!t.solido) { quer = null; }
          else { quer = chaos[Math.min(chaos.length - 1, solidos.indexOf(ch))] || 'pedra'; }
        }
        blocos[ch] = quer;
      });
      Object.keys(miolo).forEach(function (c) { if (!(pedido.blocos || {})[c]) { var raiz = miolo[c], n = 0; while (miolo[raiz] && n++ < 5) { raiz = miolo[raiz]; } blocos[c] = blocos[raiz]; } });
      HD[fi] = { pers: pers, blocos: blocos };
      return HD[fi];
    }
    function fundoHD(f) {
      var id = f.fundo_hd || (spec.hd || {}).fundo;
      if (id && BIB.fundos[id]) { return BIB.fundos[id]; }
      return BIB.fundos[escuro(f.ceu) ? 'castelo' : 'campo'];
    }
    // Scale2x (EPX): amplia o desenho da era sem perder o traço — duas vezes = 4×, e o Phaser ainda suaviza
    function scale2x(src) {
      var w = src.width, h = src.height, sc = src.getContext('2d').getImageData(0, 0, w, h), a = new Uint32Array(sc.data.buffer);
      var out = document.createElement('canvas'); out.width = w * 2; out.height = h * 2;
      var oc = out.getContext('2d'), od = oc.createImageData(w * 2, h * 2), b = new Uint32Array(od.data.buffer);
      function px(x, y) { x = x < 0 ? 0 : (x >= w ? w - 1 : x); y = y < 0 ? 0 : (y >= h ? h - 1 : y); return a[y * w + x]; }
      for (var y = 0; y < h; y++) {
        for (var x = 0; x < w; x++) {
          var E = a[y * w + x], B = px(x, y - 1), D = px(x - 1, y), Fv = px(x + 1, y), Hv = px(x, y + 1);
          var e0 = E, e1 = E, e2 = E, e3 = E;
          if (B !== Hv && D !== Fv) { e0 = D === B ? D : E; e1 = B === Fv ? Fv : E; e2 = D === Hv ? D : E; e3 = Hv === Fv ? Fv : E; }
          var o = (y * 2) * (w * 2) + x * 2;
          b[o] = e0; b[o + 1] = e1; b[o + w * 2] = e2; b[o + w * 2 + 1] = e3;
        }
      }
      oc.putImageData(od, 0, 0);
      return out;
    }

    // ───────── 🧊 estilo "3d" (25/10/2026): Three.js desenha a fase embaixo; o Phaser fica por cima com placar e efeitos ─────────
    var M3 = null, m3 = null, m3Carregando = false, m3Erro = false, m3Prontas = {};
    function prepararTres(fi) {
      if (m3Erro) { return; }
      var ir = function () {
        m3.preparar(spec, fi).then(function () { m3Prontas[fi] = true; if (cena) { cena.faseVista = null; } })
          .catch(function (e) { m3Erro = true; F.reportar(e, 'estilo 3D'); if (cena) { cena.faseVista = null; } });
      };
      if (m3) { ir(); return; }
      if (m3Carregando) { return; }
      m3Carregando = true;
      import('/estudio/fliperama/motor-3d.js?v=' + ((window.Fliperama && window.Fliperama.versao) || VERSAO)).then(function (mod) {
        M3 = mod; m3 = mod.criar(host, { W: W, H: H, Z: Z });
        m3.tela.style.gridArea = '1 / 1'; m3.tela.style.display = 'none';
        host.insertBefore(m3.tela, host.firstChild);
        escalar(); ir();
      }).catch(function (e) { m3Erro = true; F.reportar(e, 'estilo 3D (Three.js)'); if (cena) { cena.faseVista = null; } });
    }

    // ───────── a cena ─────────
    function Cena() { Phaser.Scene.call(this, { key: 'fliperama' }); }
    Cena.prototype = Object.create(Phaser.Scene.prototype);
    Cena.prototype.constructor = Cena;

    Cena.prototype.create = function () {
      cena = this;
      var S = this;
      // texturas: cada quadro de cada sprite vira uma textura "s:nome:q"
      Object.keys(sprites).forEach(function (n) {
        sprites[n].quadros.forEach(function (c, q) { S.textures.addCanvas('s:' + n + ':' + q, c); });
      });
      // partícula: um quadradinho branco (a cor vem do tint) e a luz (gradiente radial)
      var px = document.createElement('canvas'); px.width = px.height = 2;
      var pc = px.getContext('2d'); pc.fillStyle = '#fff'; pc.fillRect(0, 0, 2, 2);
      this.textures.addCanvas('px', px);
      var lz = document.createElement('canvas'); lz.width = lz.height = 256;
      var lc = lz.getContext('2d'), gr = lc.createRadialGradient(128, 128, 8, 128, 128, 128);
      gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.55, 'rgba(255,255,255,0.75)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      lc.fillStyle = gr; lc.fillRect(0, 0, 256, 256);
      this.textures.addCanvas('luz', lz);

      this.mundo = this.add.container(0, 0);
      this.camadas = this.add.container(0, 0).setDepth(-10);
      this.hud = this.add.container(0, 0).setDepth(100).setScrollFactor(0);
      this.poeira = this.add.particles(0, 0, 'px', { speed: { min: 10, max: 60 }, angle: { min: 200, max: 340 }, lifespan: 380,
        scale: { start: Z * 0.9, end: 0 }, alpha: { start: 0.8, end: 0 }, gravityY: 120, emitting: false }).setDepth(5);
      this.faisca = this.add.particles(0, 0, 'px', { speed: { min: 60, max: 260 }, lifespan: { min: 300, max: 700 },
        scale: { start: Z * 1.2, end: 0 }, alpha: { start: 1, end: 0 }, gravityY: 500, emitting: false }).setDepth(6);
      this.brilho = this.add.particles(0, 0, 'px', { speed: { min: 5, max: 30 }, lifespan: 500, scale: { start: Z, end: 0 },
        alpha: { start: 1, end: 0 }, blendMode: 'ADD', emitting: false }).setDepth(7);
      this.objsVis = new Map();
      this.tirosVis = [];
      this.hdPronto = false;
      this.textos = {};
      this.faseVista = null;
      this.tremorAntes = 0;
      this.montarHud();
      this.acum = 0;
      var self = this;
      var orig = jogo.carregarFase;
      jogo.carregarFase = function (i) { orig.call(jogo, i); self.faseVista = null; };
    };

    Cena.prototype.texto = function (chave, x, y, tam, corTxt, alinh) {
      var t = this.textos[chave];
      if (!t) {
        t = this.add.text(x, y, '', { fontFamily: '"Trebuchet MS", "Segoe UI", system-ui, sans-serif', fontSize: tam + 'px', fontStyle: 'bold',
          color: corTxt || '#FCFCFC', stroke: '#000000', strokeThickness: Math.max(3, tam / 5), align: alinh || 'left' });
        t.setShadow(0, 3, 'rgba(0,0,0,.6)', 4, true, true);
        if (alinh === 'center') { t.setOrigin(0.5, 0); } else if (alinh === 'right') { t.setOrigin(1, 0); }
        this.hud.add(t); this.textos[chave] = t;
      }
      return t;
    };
    Cena.prototype.montarHud = function () {
      var c = spec.cores || {};
      this.texto('vidas', 16, 10, 26, '#FCFCFC');
      this.texto('fase', W * Z / 2, 10, 26, '#FCFCFC', 'center');
      this.texto('pontos', W * Z - 16, 10, 26, '#FCFCFC', 'right');
      this.texto('moedas', 16, 42, 22, c.destaque || '#F8B800');
      this.barra = this.add.graphics(); this.hud.add(this.barra);
      this.texto('chefe', W * Z / 2, 40, 22, c.destaque || '#F8B800', 'center');
      this.balao = this.add.graphics(); this.hud.add(this.balao);
      this.texto('msg', W * Z / 2, 0, 24, '#FFFFFF', 'center').setWordWrapWidth(W * Z - 120);
      this.texto('erro', 12, H * Z - 34, 18, '#FFD0D0');
      this.tela = this.add.graphics(); this.hud.add(this.tela);
      this.hud.sendToBack(this.tela);
      this.texto('titulo', W * Z / 2, H * Z * 0.24, 54, c.destaque || '#F8B800', 'center').setWordWrapWidth(W * Z - 60);
      this.texto('sub', W * Z / 2, H * Z * 0.45, 26, '#FCFCFC', 'center').setWordWrapWidth(W * Z - 60);
      this.texto('aperte', W * Z / 2, H * Z * 0.62, 28, '#FCFCFC', 'center');
      this.texto('dica', W * Z / 2, H * Z - 48, 20, '#BCBCBC', 'center');
    };

    // ── o mundo da fase: fundo em camadas, blocos e o herói ──
    // texturas do estilo turbinado (feitas uma vez por sprite) e do HD (carregadas da biblioteca)
    Cena.prototype.texTurbo = function (nome, q) {
      var k = 't:' + nome + ':' + q;
      if (!this.textures.exists(k)) {
        var c = sprites[nome].quadros[q];
        this.textures.addCanvas(k, scale2x(scale2x(c)));
        try { this.textures.get(k).setFilter(Phaser.Textures.FilterMode.LINEAR); } catch (e) { /* ok */ }
      }
      return k;
    };
    Cena.prototype.carregarHD = function () {
      var S = this;
      if (this.hdCarregando) { return; }
      this.hdCarregando = true;
      biblioteca().then(function () {
        var m = mapaHD(), arqs = {};
        (spec.fases || []).forEach(function (f, fi) { var mb = mapaHD(fi).blocos; Object.keys(mb).forEach(function (ch) { var b = BIB.blocos[mb[ch]]; if (b) { ['topo', 'meio', 'esq', 'dir', 'sozinho'].forEach(function (k) { if (b[k]) { arqs[b[k]] = 1; } }); } }); });
        Object.keys(m.pers).forEach(function (n) { var p = BIB.personagens[m.pers[n]]; if (p) { Object.keys(p.quadros).forEach(function (k) { p.quadros[k].forEach(function (a) { arqs[a] = 1; }); }); } });
        Object.keys(m.blocos).forEach(function (ch) { var b = BIB.blocos[m.blocos[ch]]; if (b) { ['topo', 'meio', 'esq', 'dir', 'sozinho'].forEach(function (k) { if (b[k]) { arqs[b[k]] = 1; } }); } });
        (spec.fases || []).forEach(function (f) { var fu = fundoHD(f); if (fu) { arqs[fu.arquivo] = 1; } });
        Object.keys(arqs).forEach(function (a) { if (!S.textures.exists('hd:' + a)) { S.load.image('hd:' + a, (BIB.dados && BIB.dados[a]) || BASE_HD + a); } });
        S.load.once('complete', function () {
          Object.keys(arqs).forEach(function (a) { try { S.textures.get('hd:' + a).setFilter(Phaser.Textures.FilterMode.LINEAR); } catch (e) { /* ok */ } });
          S.hdPronto = true; S.faseVista = null;
        });
        S.load.start();
      }).catch(function (e) { F.reportar(e, 'biblioteca HD'); S.hdErro = true; S.faseVista = null; });
    };
    Cena.prototype.montarFase = function () {
      var S = this, f = jogo.fase, T = jogo.T;
      this.est = estiloDa(jogo.faseIdx);
      if (this.est === 'hd' && !this.hdPronto) { if (!this.hdErro) { this.carregarHD(); } this.est = this.hdErro ? 'turbinado' : 'turbinado'; }
      if (this.est === '3d') {
        if (!m3Prontas[jogo.faseIdx] || !m3) { prepararTres(jogo.faseIdx); this.est = 'turbinado'; }
        else { m3.montar(jogo, spec, sprites, jogo.faseIdx); }
      }
      this.mundo.removeAll(true); this.camadas.removeAll(true);
      this.objsVis.forEach(function (v) { v.destroy(); }); this.objsVis.clear();
      this.tirosVis.forEach(function (v) { v.destroy(); }); this.tirosVis = [];
      this.dy = jogo.alt < H ? H - jogo.alt : 0;
      // céu em degradê (arte livre)
      var ceu = document.createElement('canvas'); ceu.width = 4; ceu.height = H;
      var cc = ceu.getContext('2d'), g = cc.createLinearGradient(0, 0, 0, H), base = f.ceu || '#000000';
      g.addColorStop(0, Phaser.Display.Color.IntegerToColor(cor(base)).darken(escuro(base) ? 0 : 25).rgba);
      g.addColorStop(1, Phaser.Display.Color.IntegerToColor(cor(base)).lighten(escuro(base) ? 6 : 18).rgba);
      cc.fillStyle = g; cc.fillRect(0, 0, 4, H);
      var kc = 'ceu:' + jogo.faseIdx + ':' + Date.now();
      this.textures.addCanvas(kc, ceu);
      this.camadas.add(this.add.image(0, 0, kc).setOrigin(0, 0).setScale(W * Z / 4, Z).setScrollFactor(0));
      if (this.est === 'hd') {
        var fu = fundoHD(f), kf = 'hd:' + fu.arquivo, tam = BIB.tamanhos[fu.arquivo] || [1024, 512];
        var esc = (H * Z) / tam[1], larguraTela = W * Z;
        if (fu.repete) {
          var ts = this.add.tileSprite(0, 0, larguraTela, H * Z, kf).setOrigin(0, 0).setScrollFactor(0);
          ts.setTileScale(esc, esc); ts.fatorHD = 0.35 / esc; this.camadas.add(ts);
        } else {
          var esc2 = Math.max(esc, larguraTela * 1.25 / tam[0]);
          var im = this.add.image(0, H * Z, kf).setOrigin(0, 1).setScale(esc2).setScrollFactor(0);
          im.sobra = Math.max(0, tam[0] * esc2 - larguraTela); this.camadas.add(im);
        }
      }
      // camadas do fundo: o desenho é o mesmo da casa, numa tira larga, e o Phaser rola cada uma no seu passo
      (this.est === 'hd' ? [] : (f.fundo || [])).slice(0, 6).forEach(function (cam, ci) {
        var fator = Math.max(0, Math.min(1, cam.fator == null ? 0.3 : cam.fator));
        var larg = Math.ceil(W + Math.max(0, jogo.larg - W) * fator) + 2;
        var cv = document.createElement('canvas'); cv.width = larg; cv.height = H;
        var x = cv.getContext('2d');
        var falso = Object.create(jogo); falso.W = larg; falso.fase = { fundo: [cam] }; falso.quadro = 0;
        try { I.Plataforma.prototype.desenharFundo.call(falso, x, 0, 0); } catch (e) { /* camada ruim não derruba */ }
        var k = 'fundo:' + jogo.faseIdx + ':' + ci + ':' + Date.now();
        S.textures.addCanvas(k, cv);
        var img = S.add.image(0, 0, k).setOrigin(0, 0).setScale(Z).setScrollFactor(0);
        img.fator = fator;
        if (escuro(f.ceu)) { img.setAlpha(0.85); }
        S.camadas.add(img);
      });
      // blocos
      this.grade = [];
      this.animados = [];
      for (var j = 0; j < jogo.linhas; j++) {
        this.grade.push([]);
        for (var i = 0; i < jogo.colunas; i++) { this.grade[j].push(null); this.porBloco(i, j); }
      }
      this.mapaVisto = jogo.mapa.map(function (r) { return r.join(''); });
      // escuridão com luz ao redor do herói (fases de céu escuro)
      this.escura = escuro(f.ceu);
      if (this.luz) { this.luz.destroy(); this.luz = null; }
      // clima (arte livre): pólen no dia, vaga-lumes no escuro, brasas se a fase tem lava/castelo
      if (this.clima) { this.clima.destroy(); this.clima = null; }
      var temLava = Object.keys(spec.tiles || {}).some(function (k) { return (spec.tiles[k] || {}).mortal && !(spec.tiles[k] || {}).solido && jogo.mapa.some(function (r) { return r.indexOf(k) >= 0; }); });
      var tipoClima = temLava ? 'brasa' : (this.escura ? 'vagalume' : 'polen');
      var cfg = {
        polen: { tint: [0xFFFFFF, 0xFFF2A0, 0xD8F878], speedX: { min: -20, max: 25 }, speedY: { min: -8, max: 14 }, alpha: { start: 0.8, end: 0 }, blendMode: 'NORMAL', frequency: 260 },
        vagalume: { tint: [0xB8F818, 0xF8D878, 0x58F898], speedX: { min: -15, max: 15 }, speedY: { min: -15, max: 15 }, alpha: { start: 1, end: 0 }, blendMode: 'ADD', frequency: 220 },
        brasa: { tint: [0xF8B800, 0xF83800, 0xFCA044], speedX: { min: -12, max: 12 }, speedY: { min: -60, max: -20 }, alpha: { start: 1, end: 0 }, blendMode: 'ADD', frequency: 120 }
      }[tipoClima];
      this.clima = this.add.particles(0, 0, 'px', Object.assign({ x: { min: 0, max: W * Z }, y: { min: 0, max: H * Z }, lifespan: 4000,
        scale: { start: Z * 0.9, end: Z * 0.3 } }, cfg)).setScrollFactor(0).setDepth(8);

      if (this.escura) {
        this.luz = this.add.renderTexture(0, 0, W * Z, H * Z).setOrigin(0, 0).setScrollFactor(0).setDepth(50);
      }
      // herói
      this.heroiVis = this.add.image(0, 0, 's:' + her.sprite + ':0').setOrigin(0.5, 1).setScale(Z);
      this.heroiVis.setDepth(2);
      this.mundo.add(this.heroiVis);
      this.noArAntes = false;
      this.faseVista = f;
      this.cameras.main.fadeIn(350, 0, 0, 0);
    };
    Cena.prototype.porBloco = function (i, j) {
      var T = jogo.T, ch = jogo.mapa[j][i], td = (spec.tiles || {})[ch], v = this.grade[j][i];
      if (v) { v.destroy(); this.grade[j][i] = null; }
      if (!td) { return; }
      var img, x0 = i * T * Z, y0 = (j * T + this.dy) * Z;
      var bid = this.est === 'hd' ? mapaHD().blocos[ch] : null, bl = bid && BIB.blocos[bid];
      if (bl) {
        var mesmo = function (di, dj) { var c2 = (jogo.mapa[j + dj] || [])[i + di]; return c2 !== undefined && mapaHD().blocos[c2] === bid; };
        var a = bl.sozinho;
        if (bl.topo) {
          var cima = mesmo(0, -1);
          if (cima && bl.meio) { a = bl.meio; }
          else if (!mesmo(-1, 0) && !mesmo(1, 0)) { a = bl.sozinho || bl.topo; }
          else if (!mesmo(-1, 0) && bl.esq) { a = bl.esq; }
          else if (!mesmo(1, 0) && bl.dir) { a = bl.dir; }
          else { a = bl.topo; }
        }
        img = this.add.image(x0, y0, 'hd:' + a).setOrigin(0, 0).setDisplaySize(T * Z + 1, T * Z + 1);
      } else if (td.sprite && sprites[td.sprite]) {
        var turbo = this.est !== 'pixel';
        img = this.add.image(x0, y0, turbo ? this.texTurbo(td.sprite, 0) : 's:' + td.sprite + ':0').setOrigin(0, 0).setScale(turbo ? Z / 4 : Z);
        if (sprites[td.sprite].quadros.length > 1) { img.anim = td.sprite; img.turbo = turbo; this.animados.push(img); }
      } else {
        img = this.add.rectangle(i * T * Z, (j * T + this.dy) * Z, T * Z, T * Z, cor(td.cor || '#888888')).setOrigin(0, 0);
      }
      img.i = i; img.j = j;
      this.mundo.add(img);
      this.grade[j][i] = img;
    };

    // o desenho de um sprite no estilo da fase: {k: textura, esc} ou {k, w, h} (HD mantém a proporção da arte)
    // 🎭 Estúdio (26/10/2026): spec.hd.ajustes[sprite] = {cor, tamanho} — no jogo todo (a tinta do Phaser multiplica)
    var TINTA_AJ = { vermelho: 0xFF6A6A, azul: 0x7A9CFF, roxo: 0xB78CFF, dourado: 0xFFD66A, sombra: 0x34344A };
    function ajHD(nome) { var a = (((spec.hd || {}).ajustes) || {})[nome]; return a && typeof a === 'object' ? a : {}; }
    Cena.prototype.visual = function (nome, estado, q, corpo) {
      var sp = sprites[nome], n = sp.quadros.length;
      if (this.est === 'hd') {
        var pid = mapaHD().pers[nome], p = pid && BIB.personagens[pid];
        if (p) {
          var qs = p.quadros[estado] || (estado === 'queda' && p.quadros.pulo) || (estado === 'voa' && p.quadros.anda) || p.quadros.parado;
          var a = qs[(q || 0) % qs.length], tam = BIB.tamanhos[a] || [64, 64];
          var aj = ajHD(nome), tm = aj.tamanho || 1;
          var alvoH = corpo.h * Z * (p.papel === 'heroi' ? 1.25 : (p.papel === 'chefe' ? 1.15 : 1.1)) * tm, alvoW = alvoH * tam[0] / tam[1];
          var maxW = corpo.w * Z * (p.papel === 'plataforma' ? 1.05 : 2.2) * tm;
          if (alvoW > maxW) { alvoW = maxW; alvoH = alvoW * tam[1] / tam[0]; }
          return { k: 'hd:' + a, w: alvoW, h: alvoH, tint: TINTA_AJ[aj.cor] || null };
        }
      }
      if (this.est === 'turbinado' || this.est === 'hd') { return { k: this.texTurbo(nome, (q || 0) % n), esc: Z / 4 }; }
      return { k: 's:' + nome + ':' + ((q || 0) % n), esc: Z };
    };
    Cena.prototype.efeitos = function () {
      // o que o motor da casa empilha em jogo.fx vira partícula de verdade
      var S = this, T = jogo.T, dy = this.dy;
      jogo.fx.forEach(function (p) {
        var x = p.x * Z, y = (p.y + dy) * Z;
        if (p.texto) {
          var t = S.add.text(x, y, p.texto, { fontFamily: 'system-ui, sans-serif', fontSize: '22px', fontStyle: 'bold', color: '#FFFFFF', stroke: '#000', strokeThickness: 5 }).setOrigin(0.5, 1).setDepth(20);
          S.tweens.add({ targets: t, y: y - 60, alpha: 0, duration: 800, ease: 'Cubic.easeOut', onComplete: function () { t.destroy(); } });
        } else if (p.sprite) {
          var vp = S.visual(p.sprite, 'parado', 0, { w: 6, h: 8 });
          var im = S.add.image(x + 3 * Z, y, vp.k).setOrigin(0.5, 1).setDepth(20);
          if (vp.w) { im.setDisplaySize(vp.w, vp.h); } else { im.setScale(vp.esc); }
          S.tweens.add({ targets: im, y: y - 18 * Z, duration: 260, yoyo: true, ease: 'Quad.easeOut', onComplete: function () { S.brilho.explode(10, im.x, im.y - 8); im.destroy(); } });
        } else {
          S.faisca.setParticleTint(cor(p.cor || '#FCFCFC'));
          S.faisca.explode(1, x, y);
        }
      });
      jogo.fx = [];
    };

    Cena.prototype.desenharMundo = function () {
      var S = this, T = jogo.T, h = jogo.heroi, f = jogo.fase, dy = this.dy;
      if (this.faseVista !== f) { this.montarFase(); }
      // mapa mudou (bloco quebrou, surpresa virou usado, código mágico trocou bloco)
      for (var j = 0; j < jogo.linhas; j++) {
        var lin = jogo.mapa[j].join('');
        if (lin !== this.mapaVisto[j]) {
          for (var i = 0; i < lin.length; i++) { if (lin[i] !== this.mapaVisto[j][i]) { this.porBloco(i, j); } }
          this.mapaVisto[j] = lin;
        }
      }
      var q4 = jogo.quadro >> 4;
      this.animados.forEach(function (im) { if (im.active) { var qq = q4 % sprites[im.anim].quadros.length; im.setTexture(im.turbo ? S.texTurbo(im.anim, qq) : 's:' + im.anim + ':' + qq); } });
      // bloco que balança
      jogo.bumps.forEach(function (b) { var im = S.grade[b.j] && S.grade[b.j][b.i]; if (im) { im.y = (b.j * T + dy - Math.sin(b.t / 10 * Math.PI) * T * 0.35) * Z; } });
      // câmera: a da casa, sem arredondar (rolagem por subpixel)
      var cam = this.cameras.main;
      cam.scrollX = jogo.cam.x * Z; cam.scrollY = jogo.cam.y * Z;
      if (jogo.tremor > this.tremorAntes) { cam.shake(Math.max(150, jogo.tremor * 16), 0.006); }
      this.tremorAntes = jogo.tremor;
      this.camadas.list.forEach(function (im) {
        if (im.fator != null) { im.x = -jogo.cam.x * im.fator * Z; }
        else if (im.fatorHD != null) { im.tilePositionX = jogo.cam.x * Z * im.fatorHD; }
        else if (im.sobra != null) { im.x = -im.sobra * Math.min(1, jogo.cam.x / Math.max(1, jogo.larg - W)); }
      });
      // objetos
      var vistos = new Set();
      jogo.objs.forEach(function (o) {
        var v = S.objsVis.get(o);
        if (!o.vivo) {
          if (v) {
            if (o.tipo === 'inimigo' && !(o.pecas && o.pecas.plataforma)) {
              S.faisca.setParticleTint(0xFFFFFF); S.faisca.explode(12, v.x, v.y - v.displayHeight / 2);
              S.tweens.add({ targets: v, scaleY: 0.2, alpha: 0, duration: 220, onComplete: function () { v.destroy(); } });
            } else { S.brilho.explode(14, v.x, v.y - v.displayHeight / 2); v.destroy(); }
            S.objsVis.delete(o);
          }
          return;
        }
        vistos.add(o);
        var nome = o.def.sprite, qd = (o.tipo === 'inimigo') ? (o.t >> 3) : (o.t >> 4);
        if (o.casco && o.def.sprite_casco) { nome = o.def.sprite_casco; qd = o.casco === 'chutado' ? (o.t >> 2) : 0; }
        if (!sprites[nome]) { return; }
        var vis = S.visual(nome, o.casco ? 'casco' : (o.pecas && o.pecas.voa ? 'voa' : (Math.abs(o.vx || 0) > 0.05 || o.pecas && o.pecas.voa ? 'anda' : 'parado')), qd, o);
        if (!v) {
          v = S.add.image(0, 0, vis.k).setOrigin(0.5, 1);
          S.mundo.add(v); S.objsVis.set(o, v);
        }
        v.setTexture(vis.k);
        if (vis.w) { v.setDisplaySize(vis.w, vis.h); } else { v.setScale(vis.esc * (o.esc || 1)); }
        v.flipX = o.vx > 0;
        v.x = (o.x + o.w / 2) * Z; v.y = (o.y + o.h + dy) * Z;
        if (o.tipo === 'coletavel' && !o.pecas) { v.y += Math.sin((jogo.quadro + o.x) / 12) * Z * 1.2; }
        v.setAlpha(o.ferido && (jogo.quadro >> 2) % 2 ? 0.25 : 1);
        if (o.ferido) { v.setTint(0xFF8080); } else if (vis.tint) { v.setTint(vis.tint); } else { v.clearTint(); }
        if (o.sobe > 0) { var fr = v.frame; v.setCrop(0, 0, fr.width, fr.height * (1 - o.sobe / o.h)); } else if (v.isCropped) { v.setCrop(); }
      });
      // tiros
      while (this.tirosVis.length > jogo.tiros.length) { this.tirosVis.pop().destroy(); }
      jogo.tiros.forEach(function (t, n) {
        var v = S.tirosVis[n];
        if (!v) {
          v = t.sprite && sprites[t.sprite] ? S.add.image(0, 0, 's:' + t.sprite + ':0').setScale(Z) : S.add.rectangle(0, 0, t.w * Z, t.h * Z, cor(t.cor));
          S.mundo.add(v); S.tirosVis[n] = v;
        }
        v.x = (t.x + t.w / 2) * Z; v.y = (t.y + t.h / 2 + dy) * Z; v.rotation += 0.2;
      });
      // herói
      var hv = this.heroiVis, sh = jogo.spriteDoHeroi();
      var anda = sh.estado === 'anda' ? (jogo.quadro >> 3) : (sh.estado === 'parado' ? (jogo.quadro >> 5) : 0);
      if (sh.estado === 'parado' && !(her.animacoes || {}).parado) { anda = 0; }
      var sp = sprites[sh.nome];
      var visH = sp ? S.visual(sh.nome, sh.estado, anda, h) : null;
      if (visH) { hv.setTexture(visH.k); }
      var alto = (h.grande && !her.sprite_grande && sp) ? h.h / sp.h : 1;
      var escX = visH ? (visH.w ? visH.w / hv.frame.width : visH.esc) : Z, escY = visH ? (visH.w ? visH.h / hv.frame.height : visH.esc * alto) : Z * alto;
      hv.flipX = h.olhando < 0;
      hv.x = (h.x + h.w / 2) * Z; hv.y = (h.y + h.h + dy) * Z;
      hv.setVisible(!(h.invuln && (jogo.quadro >> 2) % 2));
      // pouso: amassa e levanta poeira
      if (h.chao && this.noArAntes && !h.morto) {
        this.poeira.setParticleTint(0xE0D0B0); this.poeira.explode(8, hv.x, hv.y);
        this.tweens.add({ targets: hv, scaleY: { from: escY * 0.75, to: escY }, scaleX: { from: escX * 1.2, to: escX }, duration: 160, ease: 'Back.easeOut' });
      } else if (!this.tweens.isTweening(hv)) { hv.setScale(escX, escY); }
      if (h.chao && Math.abs(h.vx) > 1 && (jogo.quadro & 7) === 0) { this.poeira.setParticleTint(0xC8B898); this.poeira.explode(1, hv.x - h.olhando * 4 * Z, hv.y); }
      this.noArAntes = !h.chao;
      if (h.estrela) {
        hv.setTint(Phaser.Display.Color.HSVToRGB((jogo.quadro % 30) / 30, 0.6, 1).color);
        if ((jogo.quadro & 1) === 0) { this.brilho.setParticleTint(Phaser.Display.Color.HSVToRGB(Math.random(), 1, 1).color); this.brilho.explode(1, hv.x, hv.y - hv.displayHeight / 2); }
      } else if (visH && visH.tint) { hv.setTint(visH.tint); } else { hv.clearTint(); }
      this.efeitos();
      // luz nas fases escuras
      if (this.luz) {
        var lx = hv.x - cam.scrollX, ly = hv.y - hv.displayHeight / 2 - cam.scrollY;
        this.luz.clear(); this.luz.fill(0x000010, this.est === 'hd' ? 0.35 : 0.55);
        this.luz.erase('luz', lx, ly);
        this.luz.erase('luz', lx, ly);   // (o erase centra a textura no ponto)
        jogo.tiros.forEach(function (t) { S.luz.erase('luz', t.x * Z - cam.scrollX, (t.y + dy) * Z - cam.scrollY); });
        this.luz.render();
      }
    };

    Cena.prototype.desenharHud = function () {
      var c = spec.cores || {}, est = jogo.estado, emJogo = !(est === 'titulo' || est === 'fim_jogo' || est === 'vitoria'), constr = est === 'construir';
      var tx = this.textos, S = this;
      var tres = this.est === '3d';
      this.mundo.setVisible(emJogo && !tres); this.camadas.setVisible(emJogo && !tres);
      if (this.luz) { this.luz.setVisible(emJogo && !tres); }
      if (m3) { m3.tela.style.display = emJogo && tres ? 'block' : 'none'; }
      ['vidas', 'fase', 'pontos', 'moedas'].forEach(function (k) { tx[k].setVisible(emJogo && !constr); });
      tx.vidas.setText('♥ ' + Math.max(0, jogo.vidas));
      tx.fase.setText(emJogo && jogo.fase ? (jogo.fase.nome || ('FASE ' + (jogo.faseIdx + 1))) : '');
      tx.pontos.setText(String(jogo.pontos).padStart(6, '0'));
      tx.moedas.setText(jogo.moedas > 0 || (spec.hud && spec.hud.moedas) ? '● ' + jogo.moedas : '');
      // chefe
      this.barra.clear(); tx.chefe.setText('');
      if (emJogo && !constr) {
        for (var k = 0; k < jogo.objs.length; k++) {
          var o = jogo.objs[k];
          if (o.vivo && o.pecas && o.pecas.chefe && o.x + o.w > jogo.cam.x - 8 && o.x < jogo.cam.x + W + 8) {
            var bw = W * Z * 0.42, bx = (W * Z - bw) / 2;
            tx.chefe.setText(String(o.def.nome || 'CHEFE'));
            this.barra.fillStyle(0x000000, 0.7).fillRoundedRect(bx - 4, 70, bw + 8, 18, 6);
            this.barra.fillStyle(0xF83800, 1).fillRoundedRect(bx, 74, bw * o.vida / o.vidaMax, 10, 4);
            break;
          }
        }
      }
      // balão de mensagem
      var ms = jogo.msgs[0];
      this.balao.clear();
      if (emJogo && !constr && ms && jogo.quadro < ms.ate) {
        tx.msg.setText(ms.texto).setY(108).setVisible(true);
        var bh = tx.msg.height + 24, bw2 = Math.min(W * Z - 60, tx.msg.width + 48);
        this.balao.fillStyle(0x101030, 0.88).fillRoundedRect((W * Z - bw2) / 2, 96, bw2, bh, 14);
        this.balao.lineStyle(3, cor(c.destaque || '#F8B800'), 1).strokeRoundedRect((W * Z - bw2) / 2, 96, bw2, bh, 14);
      } else { tx.msg.setVisible(false); }
      tx.erro.setText(jogo.erroMagico && jogo.quadro < jogo.erroMagico.ate ? '🪄 código mágico: ' + jogo.erroMagico.texto : '');
      // telas de título / fim
      this.tela.clear();
      tx.titulo.setVisible(!emJogo); tx.sub.setVisible(!emJogo); tx.aperte.setVisible(!emJogo); tx.dica.setVisible(!emJogo);
      if (!emJogo) {
        var g = this.tela;
        g.fillGradientStyle(0x0a0a2a, 0x0a0a2a, 0x2a1050, 0x2a1050, 1); g.fillRect(0, 0, W * Z, H * Z);
        for (var e = 0; e < 40; e++) { var sx = (e * 97 + jogo.quadro * (1 + e % 3)) % (W * Z), sy = (e * 53) % (H * Z); g.fillStyle(0xFFFFFF, 0.3 + (e % 3) * 0.2).fillRect(sx, sy, 3, 3); }
        if (est === 'titulo') {
          tx.titulo.setText(spec.titulo || 'MEU JOGO'); tx.sub.setText((spec.textos && spec.textos.subtitulo) || '');
          tx.dica.setText('◀ ▶ andam · espaço pula · ▼ entra no cano · M som' + (jogo.recorde ? '   ·   recorde ' + jogo.recorde.pontos : ''));
        } else {
          tx.titulo.setText(est === 'vitoria' ? ((spec.textos && spec.textos.vitoria) || 'VOCÊ VENCEU!') : 'FIM DE JOGO');
          tx.sub.setText('pontos ' + jogo.pontos); tx.dica.setText('');
        }
        tx.titulo.setScale(1 + Math.sin(jogo.quadro / 20) * 0.03);
        tx.aperte.setText('aperte ESPAÇO ou OK').setAlpha((jogo.quadro >> 5) % 2 ? 0.35 : 1);
      }
      if (est === 'pausa' || est === 'fase_ok') {
        tx.aperte.setVisible(true).setAlpha(1).setText(est === 'pausa' ? 'PAUSA' : ((jogo.fase && jogo.fase.nome) || 'FASE') + ' — CONSEGUIU!');
      }
    };

    Cena.prototype.update = function (tempo, delta) {
      if (quebrado) { return; }
      try {
        this.acum += Math.min(250, delta);
        while (this.acum >= I.PASSO) {
          var inp;
          if (robo) { var e = robo(); inp = I.entradaDe(e, antesRobo); antesRobo = e; } else { inp = entrada ? entrada.ler() : I.entradaDe({}, {}); }
          jogo.atualizar(robo || !F._aplicarModo ? inp : F._aplicarModo(jogo, inp, jgRegras));   // 🎮 13/11: regras de jogabilidade
          this.acum -= I.PASSO;
        }
        if (jogo.fase && jogo.estado !== 'titulo') { this.desenharMundo(); if (this.est === '3d' && m3) { m3.quadro(jogo, sprites, this.est); } }
        this.desenharHud();
      } catch (err) {
        quebrado = F.reportar(err, 'motor Phaser');
        this.textos.erro.setText('O JOGO QUEBROU: ' + quebrado.slice(0, 80));
      }
    };

    var jogoPhaser = new Phaser.Game({
      type: Phaser.AUTO, parent: host, width: W * Z, height: H * Z, pixelArt: true, backgroundColor: 'rgba(0,0,0,0)', transparent: true,
      scale: { mode: Phaser.Scale.NONE }, audio: { noAudio: true }, banner: false, scene: Cena
    });
    function escalar() {
      var cv = jogoPhaser && jogoPhaser.canvas; if (!cv || !cv.parentNode) { return; }
      var r = raiz.getBoundingClientRect(), larg = r.width || window.innerWidth;
      var hMax = (typeof opcoes.alturaMax === 'function' && +opcoes.alturaMax()) || (window.innerHeight - 8);   // 📐 29/10/2026
      var k = Math.min(larg / (W * Z), hMax / (H * Z));
      cv.style.width = Math.floor(W * Z * k) + 'px'; cv.style.height = Math.floor(H * Z * k) + 'px';
      cv.style.gridArea = '1 / 1'; cv.style.position = 'relative'; cv.style.zIndex = '1';
      if (m3) { m3.tela.style.width = cv.style.width; m3.tela.style.height = cv.style.height; }
      cv.style.outline = 'none'; cv.tabIndex = 0;
      if (!entrada) {
        entrada = new I.Entrada(cv);
        entrada.cimaPula = true;
        try { cv.focus({ preventScroll: true }); } catch (e) { cv.focus(); }
        cv.addEventListener('pointerdown', function () { try { cv.focus({ preventScroll: true }); } catch (e) { cv.focus(); } });
      }
    }
    var vigia = setInterval(function () { if (jogoPhaser.canvas && jogoPhaser.canvas.parentNode) { clearInterval(vigia); escalar(); } }, 30);
    window.addEventListener('resize', escalar);
    if (window.ResizeObserver) { var largVista = 0; new ResizeObserver(function () { var lw = Math.round(raiz.getBoundingClientRect().width); if (lw && lw !== largVista) { largVista = lw; escalar(); } }).observe(raiz); }   // 📐
    return {
      jogo: jogo, versao: VERSAO, aceitaDois: false, jogabilidade: jg,
      controle: function (slot, est) { if (entrada) { entrada.definirRemoto(slot, est || {}); } },
      doisJogadores: function () { return false; },
      pausar: function (s) { if (jogo.pausar) { jogo.pausar(s); } },
      apontar: function () { return null; },
      // 🎨 troca ao vivo o estilo da fase que está na tela (o Jogar do Fliperama grava na especificação)
      estilo: function (nome) { var i = jogo.faseIdx || 0; estiloForcado[i] = nome; if (cena) { cena.faseVista = null; } return i; },
      estiloAtual: function () { return estiloDa(jogo.faseIdx || 0); },
      reconstruir: function () { if (cena) { cena.faseVista = null; } },
      get tela() { return jogoPhaser && jogoPhaser.canvas; },
      parar: function () { clearInterval(vigia); window.removeEventListener('resize', escalar); som.parar(); try { jogoPhaser.destroy(true); } catch (e) { /* nada */ } try { if (m3) { m3.destruir(); } } catch (e) { /* nada */ } }
    };
  }

  window.FliperamaPhaser = { iniciar: iniciar, versao: VERSAO };
})();
