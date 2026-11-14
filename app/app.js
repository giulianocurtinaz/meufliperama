/* 📱 Meu Fliperama — app mobile-first (PWA) · fase 1 "jogar" (13/11/2026)
 *
 * Blueprint: claude/blueprint-fliperama-mobile-first.md (Projeto). Decisões do autor que este arquivo segue:
 *   · Android bom e iPhone; mesmo endereço em PC, celular e TV; o aparelho só muda o jeito de controlar e de mostrar.
 *   · Orientação obrigatória por jogo: celular na posição errada = jogo parado no aviso "gire o celular" (sem
 *     "jogar assim mesmo"); a única outra saída é voltar aos jogos.
 *   · Jogabilidade é escolha de quem CRIA (spec.jogabilidade_mobile): REGRAS (tiro auto, corre sozinho, pulo fixo,
 *     acelera sozinho) e JEITO DE CONTROLAR (botões, cruz, arrastar, deslizar, metades, inclinar). Cada opção é fixa
 *     ou liberada ao jogador. Regras liberadas mudam o placar (um ranking por modo); jeito de controlar não.
 *     Conforto (tamanho/transparência dos botões, canhoto, som, vibrar) é sempre do jogador.
 *   · Medição anônima: só contagens (sem IP, sem apelido, sem identificador).
 *
 * Roda em dois lugares, o mesmo arquivo:
 *   · casa (jogar.meufliperama.com.br/publico/fliperama/app/) — com placar público, recordes e medição;
 *   · cópia do GitHub (meufliperama.com.br/app/) — sem placar (sempre no ar, mesmo com a casa desligada).
 * Os controles alimentam o motor só por `controle(1, teclas)` — o motor e o replay do placar não mudam por causa do app.
 */
(function () {
  'use strict';

  // ───────────────────────── onde estou ─────────────────────────
  var CASA = location.pathname.indexOf('/publico/fliperama/') === 0;
  var DADOS = CASA ? '/publico/fliperama/jogos/' : '/jogos/';
  var API = CASA ? '/publico/fliperama' : null;                              // placar/recordes só na casa
  var REMOTO = CASA ? '' : 'https://jogar.meufliperama.com.br';              // ponte do celular e medição a partir do GitHub
  var QR_JS = CASA ? '/publico/fliperama/qrcode.js' : '/estudio/fliperama/qrcode.js';
  var URL_APP = CASA ? location.origin + '/publico/fliperama/app/' : 'https://meufliperama.com.br/app/';
  var URL_PLACAR = 'https://jogar.meufliperama.com.br/publico/fliperama/app/';
  // 📺 o QR da TV leva o celular sempre ao endereço público (funciona no Wi-Fi de casa e no 4G)
  var URL_PUB = CASA ? 'https://jogar.meufliperama.com.br/publico/fliperama/app/' : 'https://meufliperama.com.br/app/';

  var UA = navigator.userAgent || '';
  var IOS = /iPhone|iPad|iPod/.test(UA) || (/Macintosh/.test(UA) && navigator.maxTouchPoints > 1);
  var ANDROID = /Android/.test(UA);
  // 📺 modo TV (14/11/2026, foco do autor: "jogar no celular e na TV"): TV detectada ou o endereço termina em #/tv
  var TV = /Web0S|webOS|Tizen|SmartTV|SMART-TV|AFT|BRAVIA|GoogleTV|Android TV|HbbTV/i.test(UA) || /^#\/tv\b/.test(location.hash || '');
  var TOQUE = !TV && ((window.matchMedia && matchMedia('(pointer: coarse)').matches) || navigator.maxTouchPoints > 0);
  var APARELHO = TV ? 'tv' : (IOS ? 'iphone' : (ANDROID ? 'android' : (TOQUE ? 'outro' : 'pc')));
  function instalado() { return !!((window.matchMedia && (matchMedia('(display-mode: fullscreen)').matches || matchMedia('(display-mode: standalone)').matches)) || navigator.standalone); }

  // ───────────────────────── catálogos ─────────────────────────
  var GENERO = { plataforma: 'Plataforma', aventura: 'Aventura', nave: 'Nave', corrida: 'Corrida', labirinto: 'Labirinto',
                 travessia: 'Travessia', tiro_fixo: 'Tiro', quebra_blocos: 'Quebra-blocos', esporte: 'Esporte', quiz: 'Quiz',
                 briga_de_rua: 'Briga', rpg: 'RPG' };
  var ORIENT = { plataforma: 'deitado', aventura: 'deitado', corrida: 'deitado', briga_de_rua: 'deitado', rpg: 'deitado',
                 nave: 'em_pe', tiro_fixo: 'em_pe', labirinto: 'em_pe', travessia: 'em_pe', quebra_blocos: 'em_pe', esporte: 'em_pe', quiz: 'em_pe' };
  // jeitos de controlar que fazem sentido em cada gênero (o 1º é a sugestão quando o dev não escolheu)
  var CONTROLES = { plataforma: ['botoes', 'cruz', 'inclinar'], aventura: ['cruz', 'botoes'], briga_de_rua: ['cruz', 'botoes'],
                    rpg: ['cruz', 'botoes'], quiz: ['cruz', 'botoes'], nave: ['arrastar', 'cruz', 'botoes', 'inclinar'],
                    tiro_fixo: ['arrastar', 'botoes', 'inclinar'], corrida: ['metades', 'botoes', 'arrastar', 'inclinar'],
                    labirinto: ['deslizar', 'cruz', 'botoes'], travessia: ['deslizar', 'cruz', 'botoes'],
                    quebra_blocos: ['arrastar', 'botoes', 'inclinar'], esporte: ['arrastar', 'botoes', 'inclinar'] };
  var NOME_CTL = { botoes: 'botões', cruz: 'cruz flutuante', arrastar: 'arrastar o dedo', deslizar: 'deslizar', metades: 'metades da tela', inclinar: 'inclinar o celular' };
  var DICA_CTL = { botoes: 'botões na tela', cruz: 'encoste o polegar à esquerda: aparece a cruz', arrastar: 'arraste o dedo em qualquer lugar',
                   deslizar: 'deslize o dedo para andar · toque para a ação', metades: 'toque na metade esquerda ou direita para virar',
                   inclinar: 'incline o celular para os lados' };
  var NOME_REGRA = { tiro: 'Tiro', rolagem: 'Cenário', pulo: 'Pulo', aceleracao: 'Acelerar' };
  var NOME_VALOR = { botao: 'no botão', auto: 'automático', heroi: 'anda com o herói', sozinho: 'corre sozinho', variavel: 'segure = mais alto', fixo: 'sempre igual' };
  var USA_CIMA = { labirinto: 1, nave: 1, corrida: 1, travessia: 1, quiz: 1, aventura: 1, briga_de_rua: 1, rpg: 1 };
  var SO_LADOS = { tiro_fixo: 1, quebra_blocos: 1, esporte: 1, plataforma: 1 };
  var ROT_A = { plataforma: 'PULO', nave: 'TIRO', tiro_fixo: 'TIRO', briga_de_rua: 'SOCO', aventura: 'A', rpg: 'OK', quiz: 'OK', esporte: 'A', quebra_blocos: 'A' };

  // ───────────────────────── estado ─────────────────────────
  var S = { jogos: [], porSlug: {}, recordes: {}, motorV: '', perfis: null, motorPronto: null, filtro: 'todos',
            atual: null, r: null, spec: null, jg: null, ctl: null, K: {}, partidaT0: 0, fps: { n: 0, t0: 0, soma: 0, conta: 0 },
            placarResolver: null, ts: { chave: null, token: null, pronto: false }, desafio: null, instalarEvt: null };
  var PREF = { tam: 1, alfa: 0.16, mao: 'd', som: 1, vib: 1, ap: '' };
  try { Object.assign(PREF, JSON.parse(localStorage.getItem('flip_conforto') || '{}')); } catch (e) {}
  try { PREF.ap = PREF.ap || localStorage.getItem('fliperama_apelido') || ''; } catch (e) {}
  function salvarPref() { try { localStorage.setItem('flip_conforto', JSON.stringify(PREF)); if (PREF.ap) { localStorage.setItem('fliperama_apelido', PREF.ap); } } catch (e) {} }
  function escolhas(slug) { try { return JSON.parse(localStorage.getItem('flip_ctl_' + slug) || '{}'); } catch (e) { return {}; } }
  function salvarEscolhas(slug, o) { try { localStorage.setItem('flip_ctl_' + slug, JSON.stringify(o)); } catch (e) {} }

  // ───────────────────────── utilidades ─────────────────────────
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function aviso(t, ms) { var a = $('aviso'); a.textContent = t; a.style.display = 'block'; clearTimeout(aviso.t); aviso.t = setTimeout(function () { a.style.display = 'none'; }, ms || 2600); }
  function abrir(id) { $(id).classList.add('on'); }
  function fechar(id) { $(id).classList.remove('on'); }
  function vibrar(ms) { if (!PREF.vib) { return; } try { if (navigator.vibrate) { navigator.vibrate(ms); } } catch (e) {} }
  function seguro(f) { try { return f(); } catch (e) { return null; } }
  function fmt(n) { return Number(n || 0).toLocaleString('pt-BR'); }
  function orientacaoDe(j, spec) {
    var o = spec && spec.jogabilidade_mobile && spec.jogabilidade_mobile.orientacao && spec.jogabilidade_mobile.orientacao.padrao;
    return (o === 'deitado' || o === 'em_pe') ? o : ((j && j.orientacao) || ORIENT[(spec && spec.arquetipo) || (j && j.genero)] || 'deitado');
  }
  function deitadoAgora() { return window.innerWidth > window.innerHeight; }
  function carregarScript(src) {
    return new Promise(function (ok, erro) { var s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = function () { erro(new Error('não carregou ' + src)); }; document.head.appendChild(s); });
  }
  function json(url, op) { return fetch(url, op).then(function (r) { if (!r.ok) { throw new Error('erro ' + r.status); } return r.json(); }); }

  // ───────────────────────── 📊 medição anônima ─────────────────────────
  var FILA = [];
  function medir(ev, extra) {
    var e = { ev: ev, aparelho: APARELHO, instalado: instalado(), orient: TOQUE ? (deitadoAgora() ? 'deitado' : 'em_pe') : '-' };
    Object.keys(extra || {}).forEach(function (k) { e[k] = extra[k]; });
    FILA.push(e);
    if (FILA.length >= 20) { enviarMedicao(); }
  }
  function enviarMedicao() {
    if (!FILA.length) { return; }
    var lote = FILA.splice(0, 40);
    seguro(function () {
      // text/plain = pedido simples (sem preflight), que o keepalive aceita também a partir do GitHub
      fetch(REMOTO + '/publico/fliperama/metrica', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ eventos: lote }),
                                                    keepalive: true, mode: 'cors', credentials: 'omit' }).catch(function () {});
    });
  }
  setInterval(enviarMedicao, 20000);
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') { enviarMedicao(); pausarSeJogando(); } });

  // ───────────────────────── 📲 instalar (PWA) ─────────────────────────
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js', { scope: './' }).catch(function () {}); });
  }
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); S.instalarEvt = e; mostrarInstalar(); });
  window.addEventListener('appinstalled', function () { medir('instalou', {}); $('instalar').hidden = true; });
  function mostrarInstalar() {
    if (instalado() || TV) { $('instalar').hidden = true; return; }
    if (IOS) { $('instTxt').innerHTML = 'no iPhone: <b>Compartilhar ⬆</b> → <b>Adicionar à Tela de Início</b>'; $('instalar').hidden = false; return; }
    $('instalar').hidden = !S.instalarEvt;
  }
  $('instalar').onclick = function () {
    if (IOS) { abrir('vInstalar'); return; }
    if (S.instalarEvt) { S.instalarEvt.prompt(); S.instalarEvt.userChoice.then(function () { S.instalarEvt = null; mostrarInstalar(); }); }
  };
  $('inFechar').onclick = function () { fechar('vInstalar'); };

  // ───────────────────────── 🙂 apelido ─────────────────────────
  function validarApelido(a) {
    a = String(a || '').trim().toUpperCase();
    if (a.length < 3 || a.length > 12) { return { erro: 'De 3 a 12 letras ou números.' }; }
    if (!/^[A-Z0-9À-Ü]+( [A-Z0-9À-Ü]+)?$/.test(a)) { return { erro: 'Só letras e números (um espaço no máximo).' }; }
    if (/@|\d{6,}/.test(a)) { return { erro: 'Nada de e-mail ou telefone.' }; }
    return { ok: a };
  }
  $('btPerfil').onclick = function () { $('inAp2').value = PREF.ap || ''; $('apMsg2').textContent = ''; abrir('vApelido'); setTimeout(function () { $('inAp2').focus(); }, 60); };
  $('ap2Nao').onclick = function () { fechar('vApelido'); };
  $('ap2Ok').onclick = function () {
    var v = validarApelido($('inAp2').value); if (v.erro) { $('apMsg2').textContent = v.erro; return; }
    PREF.ap = v.ok; salvarPref(); fechar('vApelido'); $('meuAp').textContent = PREF.ap;
  };

  // ───────────────────────── 🗂 vitrine ─────────────────────────
  function capaUrl(j) { return j.capa ? DADOS + encodeURIComponent(j.slug) + '/capa.jpg?v=' + encodeURIComponent(j.capa_v || S.motorV) : ''; }
  function versaoJogo(j) { return encodeURIComponent(S.motorV + '-' + (j.versao || '')); }
  function imagem(j, cls) {
    var u = capaUrl(j);
    return '<span class="' + cls + '" style="' + (u ? "background-image:url('" + u + "')" : '') + '" role="img" aria-label="capa de ' + esc(j.nome) + '">' + (u ? '' : '🕹️') + '</span>';
  }
  function ultimos() { try { return JSON.parse(localStorage.getItem('flip_ultimos') || '[]'); } catch (e) { return []; } }
  function pintarVitrine() {
    var gens = ['todos'].concat(Object.keys(GENERO).filter(function (g) { return S.jogos.some(function (j) { return j.genero === g; }); }));
    $('fichas').innerHTML = gens.map(function (g) {
      return '<button type="button" role="tab" class="ficha" aria-selected="' + (g === S.filtro) + '" data-g="' + g + '">' + (g === 'todos' ? 'Todos' : esc(GENERO[g])) + '</button>';
    }).join('');
    Array.prototype.forEach.call($('fichas').children, function (b) { b.onclick = function () { S.filtro = b.getAttribute('data-g'); pintarVitrine(); }; });
    var lst = S.jogos.filter(function (j) { return S.filtro === 'todos' || j.genero === S.filtro; });
    $('tituloLista').textContent = S.filtro === 'todos' ? 'Todos os jogos' : GENERO[S.filtro];
    $('lista').innerHTML = lst.map(function (j) {
      var rec = S.recordes[j.slug], o = orientacaoDe(j);
      return '<button type="button" class="card" data-s="' + esc(j.slug) + '">' + imagem(j, 'im') + '<span class="info"><b>' + esc(j.nome) + '</b>' +
        '<span class="meta">' + esc(GENERO[j.genero] || 'Jogo') + (TOQUE ? ' · joga ' + (o === 'deitado' ? 'deitado ↔' : 'em pé ↕') : '') +
        (j.demo ? '<span class="tag">🤖 demo</span>' : ' · por ' + esc(j.autor)) + '</span>' +
        (API ? '<span class="rec">' + (rec ? '🏆 ' + fmt(rec.pontos) + ' · ' + esc(rec.apelido) : 'sem recorde ainda — seja o primeiro!') + '</span>' : '') +
        '</span></button>';
    }).join('') || '<p class="nota">Nenhum jogo aqui ainda.</p>';
    Array.prototype.forEach.call($('lista').querySelectorAll('.card'), function (b) { b.onclick = function () { irPara(b.getAttribute('data-s')); }; });
    var ult = ultimos().filter(function (s) { return S.porSlug[s]; }).slice(0, 8);
    $('secCont').hidden = !ult.length;
    $('continuar').innerHTML = ult.map(function (s) { var j = S.porSlug[s]; return '<button type="button" class="mini" data-s="' + esc(s) + '">' + imagem(j, 'im') + '<b>' + esc(j.nome) + '</b></button>'; }).join('');
    Array.prototype.forEach.call($('continuar').children, function (b) { b.onclick = function () { irPara(b.getAttribute('data-s')); }; });
    $('meuAp').textContent = PREF.ap || 'sem apelido';
    $('rodape').innerHTML = CASA ? 'Jogue sem cadastro. Para o placar, só um apelido inventado.'
      : 'Aqui é só para jogar. Para pôr o seu recorde no placar, jogue em <a style="color:var(--amarelo)" href="' + URL_PLACAR + '">jogar.meufliperama.com.br</a>.';
  }
  function carregarCatalogo() {
    return json(DADOS + 'jogos.json?t=' + Date.now()).then(function (d) {
      S.jogos = d.jogos || []; S.motorV = d.motor || ''; S.porSlug = {};
      S.jogos.forEach(function (j) { S.porSlug[j.slug] = j; });
      pintarVitrine();
      if (API) { json(API + '/recordes').then(function (r) { S.recordes = r.recordes || {}; pintarVitrine(); }).catch(function () {}); }
    }).catch(function () {
      $('lista').innerHTML = '<p class="nota">Não deu para carregar os jogos agora. Confira a internet e puxe a tela para baixo.</p>';
    });
  }
  function garantirMotor() {
    if (S.motorPronto) { return S.motorPronto; }
    S.motorPronto = (window.Fliperama ? Promise.resolve() : carregarScript('/estudio/fliperama/motor.js?v=' + encodeURIComponent(S.motorV)))
      .then(function () { return json('/estudio/fliperama/perfis.json?v=' + encodeURIComponent(S.motorV)); })
      .then(function (p) { S.perfis = p; })
      .catch(function (e) { S.motorPronto = null; throw e; });
    return S.motorPronto;
  }

  // ───────────────────────── 🧭 rotas (#/jogo/<slug>?d=pontos&m=modo) ─────────────────────────
  function irPara(slug) {
    if (TVL.ws && TVL.slot === 1) { mandarParaTv(slug); return; }   // 📺 ligado na TV: o jogo abre lá
    if (TV) { S.jogExterno = null; S.desafio = null; abrirJogo(slug); return; }   // na TV, pelo controle remoto
    location.hash = '#/jogo/' + encodeURIComponent(slug);
  }
  function lerRota() {
    var h = location.hash || '', lig = /^#\/ligar\/(\d{4,6})/.exec(h);
    if (lig) { history.replaceState(null, '', location.pathname + location.search + '#/'); ligarNaTv(lig[1]); return; }   // QR da TV
    if (TV) { return; }                                   // a TV não navega por endereço: quem abre o jogo é o celular
    var m = /^#\/jogo\/([^?]+)(?:\?(.*))?$/.exec(h);
    if (!m) { if (S.atual && !S.remoto) { sairDoJogo(true); } return; }
    var slug = decodeURIComponent(m[1]), q = {};
    (m[2] || '').split('&').forEach(function (p) { var kv = p.split('='); if (kv[0]) { q[kv[0]] = decodeURIComponent(kv[1] || ''); } });
    S.desafio = q.d ? { pontos: parseInt(q.d, 10) || 0, modo: q.m || '' } : null;
    if (!S.atual || S.atual.slug !== slug) { abrirJogo(slug); }
  }
  window.addEventListener('hashchange', lerRota);

  // ───────────────────────── 🎮 jogo ─────────────────────────
  function abrirJogo(slug) {
    var j = S.porSlug[slug];
    if (!j) { aviso('Esse jogo não está mais na vitrine.'); location.hash = '#/'; return; }
    if (S.r) { pararMotor(); }
    S.atual = j;
    try { var u = ultimos().filter(function (x) { return x !== slug; }); u.unshift(slug); localStorage.setItem('flip_ultimos', JSON.stringify(u.slice(0, 8))); } catch (e) {}
    $('vitrine').classList.remove('on'); $('jogo').classList.add('on');
    abrir('carregando'); fechar('comecar'); fechar('gire');
    $('ctl').innerHTML = ''; $('palco').innerHTML = '';
    telaCheia();
    Promise.all([garantirMotor(), json(DADOS + encodeURIComponent(slug) + '/spec.json?v=' + versaoJogo(j))]).then(function (rs) {
      if (S.atual !== j) { return; }
      S.spec = rs[1];
      j.orientacao = orientacaoDe(j, S.spec);
      medir('abriu', { slug: slug });
      iniciarMotor();
    }).catch(function (e) {
      fechar('carregando');
      $('palco').innerHTML = '<p class="nota" style="padding:24px;text-align:center">O jogo não abriu: ' + esc(e && e.message || e) + '</p>';
    });
  }
  function opcoesJogador() {
    if (TV && S.jogExterno) { return S.jogExterno; }       // 📺 as regras que o celular escolheu
    return regrasEscolhidas(S.atual.slug);
  }
  function iniciarMotor() {
    var j = S.atual, spec = S.spec;
    S.jg = window.Fliperama.jogabilidade ? window.Fliperama.jogabilidade(spec, opcoesJogador()) : { regras: {}, livres: {}, modo: '' };
    var op = { perfis: S.perfis, slug: j.slug, semToque: true, escalaLivre: true,
               jogabilidade: opcoesJogador(),
               alturaMax: function () { return $('palco').getBoundingClientRect().height || window.innerHeight; },
               aoEvento: aoEvento };
    if (API) { op.placarPublico = API; op.pedirApelido = pedirApelido; op.aoPlacar = aoPlacar; }
    else { op.placar = false; }
    try { S.r = window.Fliperama.iniciar($('palco'), spec, op); }
    catch (e) { fechar('carregando'); $('palco').innerHTML = '<p class="nota" style="padding:24px">O jogo não abriu: ' + esc(e.message) + '</p>'; return; }
    S.K = {};
    if (S.r && S.r.jogo && S.r.jogo.som) { S.r.jogo.som.mudo = !PREF.som; }
    fechar('carregando');
    $('cmNome').textContent = j.nome;
    $('cmDesafio').hidden = !S.desafio;
    if (S.desafio) { $('cmDesafio').textContent = '🏁 Desafio: bata ' + fmt(S.desafio.pontos) + ' pontos!'; }
    S.ctl = controleEscolhido();
    $('cmDica').textContent = TOQUE ? DICA_CTL[S.ctl] || '' : 'Teclado: setas andam · espaço = ação · Esc = pausa';
    $('btCel').hidden = TOQUE || TV;
    if (TV) { $('cmDica').textContent = CEL.sala ? 'no celular: toque em ▶ Jogar · código ' + CEL.sala.codigo : 'controle remoto: OK começa'; }
    abrir('comecar');
    montarControles();
    conferirGiro();
    medirFps();
    if (CEL.ws) { celTodos({ t: 'aberto', slug: j.slug }); }   // 📺 os celulares viram o controle deste jogo
  }
  function pararMotor() {
    seguro(function () { S.r.parar(); });
    S.r = null; S.K = {};
    cancelAnimationFrame(S.fps.raf);
  }
  function sairDoJogo(daRota) {
    var eraRemoto = S.remoto;
    pararMotor(); S.atual = null; S.spec = null; S.remoto = false;
    ['vPausa', 'vFim', 'vPlacar'].forEach(fechar);
    if (S.placarResolver) { S.placarResolver(null); S.placarResolver = null; }
    $('jogo').classList.remove('on', 'empe', 'remoto'); $('vitrine').classList.add('on');
    sairTelaCheia();
    if (!daRota && !TV && !eraRemoto) { location.hash = '#/'; }
    if (TV && CEL.ws) { celTodos({ t: 'saiu' }); }
    pintarVitrine();
  }
  function estado() { if (S.remoto) { return TVL.estado || 'titulo'; } return (S.r && S.r.jogo && S.r.jogo.estado) || 'titulo'; }
  function enviarTeclas() {
    if (S.remoto) { tvEnviar({ t: 'k', k: S.K, s: ++TVL.seq }); return; }     // 📺 celular controlando a TV
    if (S.r && S.r.controle) { S.r.controle(1, S.K); }
  }
  function pulso(k, ms) { S.K[k] = true; enviarTeclas(); setTimeout(function () { S.K[k] = false; enviarTeclas(); }, ms || 70); }
  function comecar() {
    fechar('comecar'); ligarSom();
    var tent = 0;
    (function vai() {
      var e = estado();
      if (e === 'jogando' || tent++ > 6) { return; }
      if (e === 'pausa') { pulso('pausa'); } else { pulso('start'); }
      setTimeout(vai, 220);
    })();
  }
  $('btComecar').onclick = comecar;
  function ligarSom() {   // iPhone: o som só liga dentro de um toque
    seguro(function () {
      var som = S.r && S.r.jogo && S.r.jogo.som; if (!som || som.mudo) { return; }
      if (som.ligar) { som.ligar(); }
      if (som.ctx && som.ctx.state === 'suspended') { som.ctx.resume(); }
    });
  }
  function aoEvento(nome, dados) {
    if (nome === 'comecou') {
      S.partidaT0 = performance.now(); S.fps.soma = 0; S.fps.conta = 0;
      medir('partida', { slug: S.atual && S.atual.slug, controle: TOQUE ? S.ctl : '', modo: S.jg ? S.jg.modo : '' });
    } else if (nome === 'fim_partida') {
      var ms = S.partidaT0 ? Math.round(performance.now() - S.partidaT0) : 0;
      medir('fim', { slug: S.atual && S.atual.slug, ms: ms, fps: S.fps.conta ? Math.round(S.fps.soma / S.fps.conta) : 0, modo: S.jg ? S.jg.modo : '' });
      var pts = (dados && dados.pontos) || 0;
      setTimeout(function () { mostrarFim(pts, !!(dados && dados.venceu)); }, 900);
    }
  }
  function medirFps() {   // quadros por segundo médios da partida (só número; vai na medição)
    var n = 0, t0 = performance.now();
    function q(t) {
      n++;
      if (t - t0 >= 2000) { if (estado() === 'jogando') { S.fps.soma += n * 1000 / (t - t0); S.fps.conta++; } n = 0; t0 = t; }
      S.fps.raf = requestAnimationFrame(q);
    }
    cancelAnimationFrame(S.fps.raf); S.fps.raf = requestAnimationFrame(q);
  }

  // ── tela cheia e orientação ──
  function telaCheia() {
    if (!TOQUE || IOS) { return; }      // no iPhone a tela cheia vem do app instalado
    seguro(function () {
      var el = document.documentElement, p = el.requestFullscreen ? el.requestFullscreen({ navigationUI: 'hide' }) : null;
      if (p && p.then) { p.then(travarGiro).catch(function () {}); }
    });
  }
  function travarGiro() {
    if (!S.atual) { return; }
    seguro(function () { if (screen.orientation && screen.orientation.lock) { screen.orientation.lock(S.atual.orientacao === 'deitado' ? 'landscape' : 'portrait').catch(function () {}); } });
  }
  function sairTelaCheia() {
    seguro(function () { if (screen.orientation && screen.orientation.unlock) { screen.orientation.unlock(); } });
    seguro(function () { if (document.fullscreenElement && document.exitFullscreen) { document.exitFullscreen().catch(function () {}); } });
  }
  var pausadoPeloGiro = false;
  function conferirGiro() {
    if (!S.atual) { return; }
    var quer = S.atual.orientacao, em = deitadoAgora() ? 'deitado' : 'em_pe';
    $('jogo').classList.toggle('empe', em === 'em_pe');
    if (!TOQUE || S.remoto) { fechar('gire'); return; }   // 📺 celular de controle: qualquer posição serve
    var ok = quer === em;
    $('gireTxt').textContent = quer === 'deitado' ? 'Deite o celular 📱↔' : 'Deixe o celular em pé 📱↕';
    if (!ok) {
      abrir('gire');
      if (estado() === 'jogando') { pulso('pausa'); pausadoPeloGiro = true; }
    } else {
      fechar('gire');
      if (pausadoPeloGiro && !$('vPausa').classList.contains('on')) { pausadoPeloGiro = false; setTimeout(function () { if (estado() === 'pausa') { pulso('pausa'); } }, 250); }
    }
  }
  window.addEventListener('resize', function () { if (S.atual) { conferirGiro(); montarControles(); } });
  $('gireSair').onclick = function () { sairDoJogo(false); };
  function pausarSeJogando() { if (S.atual && estado() === 'jogando') { abrirPausa(); } }

  // ───────────────────────── 🕹 controles ─────────────────────────
  function controlesPermitidos() {
    var g = S.spec.arquetipo, base = CONTROLES[g] || ['cruz', 'botoes'];
    var jm = (S.spec.jogabilidade_mobile || {}).controle || {};
    var padrao = base.indexOf(jm.padrao) >= 0 ? jm.padrao : base[0];
    var pode = [padrao];
    if (jm.livre) { (jm.alternativas || base).forEach(function (c) { if (base.indexOf(c) >= 0 && pode.indexOf(c) < 0) { pode.push(c); } }); }
    if (!('DeviceOrientationEvent' in window)) { pode = pode.filter(function (c) { return c !== 'inclinar'; }); if (!pode.length) { pode = ['botoes']; } }
    return pode;
  }
  function controleEscolhido() {
    var pode = controlesPermitidos(), e = escolhas(S.atual.slug).controle;
    return pode.indexOf(e) >= 0 ? e : pode[0];
  }
  function precisaA() {
    var g = S.spec.arquetipo, r = (S.jg && S.jg.regras) || {};
    if ((g === 'nave' || g === 'tiro_fixo') && r.tiro === 'auto') { return false; }
    return !!ROT_A[g];
  }
  function lado(nome) { return (nome === 'esq') !== (PREF.mao === 'c') ? 'left' : 'right'; }
  function botao(rotulo, tecla, css, tam, quad) {
    var d = document.createElement('div'), z = Math.round(tam * PREF.tam);
    d.className = 'bt' + (quad ? ' quad' : ''); d.textContent = rotulo;
    d.style.width = z + 'px'; d.style.height = z + 'px'; d.style.fontSize = Math.max(12, Math.round(z * (rotulo.length > 2 ? 0.2 : 0.34))) + 'px';
    Object.keys(css).forEach(function (p) { d.style[p] = css[p]; });
    function liga(v) { return function (ev) { ev.preventDefault(); ev.stopPropagation(); S.K[tecla] = v; d.classList.toggle('on', v); enviarTeclas(); if (v) { vibrar(10); ligarSom(); } }; }
    d.addEventListener('pointerdown', function (ev) { seguro(function () { d.setPointerCapture(ev.pointerId); }); liga(true)(ev); });
    d.addEventListener('pointerup', liga(false)); d.addEventListener('pointercancel', liga(false)); d.addEventListener('lostpointercapture', liga(false));
    $('ctl').appendChild(d);
    return d;
  }
  var BAIXO = 'calc(26px + var(--sb))';
  function botoesAcao() {
    var y = BAIXO, x = 'calc(22px + var(--sr))';
    if (precisaA()) { var c = { bottom: y }; c[lado('dir')] = x; botao(ROT_A[S.spec.arquetipo] || 'A', 'pulo', c, 96); }
    if (S.spec.arquetipo === 'nave') { var b = { bottom: 'calc(132px + var(--sb))' }; b[lado('dir')] = 'calc(30px + var(--sr))'; botao('BOMBA', 'bomba', b, 70); }
  }
  function cruzFixa() {
    var t = Math.round(58 * PREF.tam), base = 26;
    function p(rot, k, dx, dy) { var c = { bottom: 'calc(' + (base + dy * t) + 'px + var(--sb))' }; c[lado('esq')] = 'calc(' + (18 + dx * t) + 'px + var(--sl))'; botao(rot, k, c, 58, true); }
    if (USA_CIMA[S.spec.arquetipo]) { p('▲', 'cima', 1, 2); p('◀', 'esq', 0, 1); p('▶', 'dir', 2, 1); p('▼', 'baixo', 1, 0); }
    else { p(PREF.mao === 'c' ? '▶' : '◀', PREF.mao === 'c' ? 'dir' : 'esq', 0, 0); p(PREF.mao === 'c' ? '◀' : '▶', PREF.mao === 'c' ? 'esq' : 'dir', 1.5, 0); }
  }
  function zona(css) {
    var z = document.createElement('div'); z.className = 'zona';
    Object.keys(css).forEach(function (p) { z.style[p] = css[p]; });
    $('ctl').appendChild(z); return z;
  }
  function teclasDeVetor(dx, dy, morto, soLados) {
    var k = { esq: false, dir: false, cima: false, baixo: false };
    if (Math.abs(dx) > morto) { k[dx < 0 ? 'esq' : 'dir'] = true; }
    if (!soLados && Math.abs(dy) > morto) { k[dy < 0 ? 'cima' : 'baixo'] = true; }
    return k;
  }
  function aplicarDirecao(k) { var mudou = false; ['esq', 'dir', 'cima', 'baixo'].forEach(function (x) { if (!!S.K[x] !== !!k[x]) { S.K[x] = !!k[x]; mudou = true; } }); if (mudou) { enviarTeclas(); vibrar(5); } }
  function anel(x, y, dx, dy, on) {
    var a = $('anel'); a.style.display = on ? 'block' : 'none'; if (!on) { return; }
    a.style.left = x + 'px'; a.style.top = y + 'px';
    var d = Math.hypot(dx, dy) || 1, m = Math.min(1, d / 46);
    a.firstChild.style.transform = 'translate(' + (dx / d * 40 * m) + 'px,' + (dy / d * 40 * m) + 'px)';
  }
  // toque curto na tela = start (título/fim) ou ação (deslizar)
  function toqueCurto() { var e = estado(); if (e === 'titulo' || e === 'fim_jogo' || e === 'vitoria') { return; } if (S.ctl === 'deslizar') { pulso('pulo', 90); } }
  function gestos(z, tipo) {
    var t = null, soLados = !!SO_LADOS[S.spec.arquetipo];
    z.addEventListener('pointerdown', function (ev) {
      ev.preventDefault(); ligarSom(); seguro(function () { z.setPointerCapture(ev.pointerId); });
      t = { id: ev.pointerId, x: ev.clientX, y: ev.clientY, t0: performance.now(), mexeu: false, cruz: false, ult: 0 };
      if (tipo === 'metades') { var esq = ev.clientX < window.innerWidth / 2; aplicarDirecao({ esq: esq, dir: !esq }); }
      if (tipo === 'cruz') { t.cruz = true; anel(t.x, t.y, 0, 0, true); }
      if (tipo === 'deslizar') { t.timer = setTimeout(function () { if (t && !t.mexeu) { t.cruz = true; anel(t.x, t.y, 0, 0, true); } }, 230); }
    });
    z.addEventListener('pointermove', function (ev) {
      if (!t || ev.pointerId !== t.id) { return; }
      var dx = ev.clientX - t.x, dy = ev.clientY - t.y, d = Math.hypot(dx, dy);
      if (d > 10) { t.mexeu = true; }
      if (tipo === 'arrastar' || t.cruz) { aplicarDirecao(teclasDeVetor(dx, dy, 12, soLados && tipo === 'arrastar')); if (t.cruz) { anel(t.x, t.y, dx, dy, true); } return; }
      if (tipo === 'deslizar' && d > 28) {   // deslizou: anda naquela direção enquanto o dedo fica encostado
        var k = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? { esq: true } : { dir: true }) : (dy < 0 ? { cima: true } : { baixo: true });
        aplicarDirecao(k); t.x = ev.clientX; t.y = ev.clientY;
      }
    });
    function solta(ev) {
      if (!t || (ev && ev.pointerId !== t.id)) { return; }
      clearTimeout(t.timer);
      var curto = !t.mexeu && performance.now() - t.t0 < 250;
      if (tipo === 'deslizar' && !t.cruz && t.mexeu) { setTimeout(function () { aplicarDirecao({}); }, 90); }
      else if (tipo !== 'toque') { aplicarDirecao({}); }
      anel(0, 0, 0, 0, false); t = null;
      if (curto) { toqueCurto(); }
    }
    z.addEventListener('pointerup', solta); z.addEventListener('pointercancel', solta);
  }
  var giro = { on: false, ref: null };
  function ligarInclinar() {
    function ouvir() {
      if (giro.on) { return; }
      giro.on = true;
      window.addEventListener('deviceorientation', function (e) {
        if (!S.atual || S.ctl !== 'inclinar') { return; }
        var deitado = deitadoAgora(), ang = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
        var lad = deitado ? (e.beta || 0) * (ang === 90 ? 1 : -1) : (e.gamma || 0);
        var fr = deitado ? (e.gamma || 0) : (e.beta || 0);
        if (giro.ref == null) { giro.ref = fr; }
        var soLados = !!SO_LADOS[S.spec.arquetipo] || !USA_CIMA[S.spec.arquetipo];
        aplicarDirecao(teclasDeVetor(lad, soLados ? 0 : (fr - giro.ref), 9, soLados));
      });
    }
    var P = window.DeviceOrientationEvent;
    if (P && typeof P.requestPermission === 'function') {   // iPhone: precisa pedir dentro de um toque
      var b = document.createElement('button'); b.type = 'button'; b.className = 'grande'; b.textContent = '📱 Liberar o inclinar';
      b.style.cssText = 'position:absolute;left:50%;top:40%;transform:translateX(-50%);width:auto;padding:14px 22px;pointer-events:auto;z-index:2';
      b.onclick = function () { P.requestPermission().then(function (r) { if (r === 'granted') { ouvir(); b.remove(); } else { aviso('Sem permissão: troque o controle no ⏸.'); } }).catch(function () {}); };
      $('ctl').appendChild(b);
    } else { ouvir(); }
  }
  function montarControles() {
    var c = $('ctl'); c.innerHTML = ''; S.K = {}; enviarTeclas();
    document.documentElement.style.setProperty('--tam', PREF.tam); document.documentElement.style.setProperty('--alfa', PREF.alfa);
    if (!S.atual || !S.spec || !TOQUE) { return; }
    var t = S.ctl, g = S.spec.arquetipo;
    if (t === 'botoes') { cruzFixa(); botoesAcao(); gestos(zona({ left: '35%', right: '35%', top: '0', bottom: '0' }), 'toque'); return; }
    if (t === 'cruz') { gestos(zona(Object.assign({ top: '0', bottom: '0', width: '50%' }, PREF.mao === 'c' ? { right: '0' } : { left: '0' })), 'cruz'); botoesAcao(); return; }
    if (t === 'metades') { gestos(zona({ inset: '0' }), 'metades'); return; }
    if (t === 'inclinar') { gestos(zona({ inset: '0' }), 'toque'); botoesAcao(); giro.ref = null; ligarInclinar(); return; }
    // arrastar e deslizar: a tela toda é o controle (menos os botões)
    gestos(zona({ inset: '0' }), t);
    if (t === 'arrastar') { botoesAcao(); }
    void g;
  }

  // ───────────────────────── ⏸ pausa ─────────────────────────
  function seg(id, campo, conv) {
    Array.prototype.forEach.call($(id).children, function (b) {
      b.setAttribute('aria-pressed', String(PREF[campo]) === b.getAttribute('data-v'));
      b.onclick = function () {
        PREF[campo] = conv ? conv(b.getAttribute('data-v')) : b.getAttribute('data-v'); salvarPref(); seg(id, campo, conv);
        if (campo === 'som' && S.r && S.r.jogo && S.r.jogo.som) { S.r.jogo.som.mudo = !PREF.som; if (!PREF.som) { seguro(function () { S.r.jogo.som.parar(); }); } }
        montarControles();
      };
    });
  }
  function pintarControlesPausa() {
    var h = '', pode = TOQUE ? controlesPermitidos() : [];
    var livres = (S.jg && S.jg.livres) || {}, regrasLivres = Object.keys(livres);
    if (pode.length > 1 || regrasLivres.length) { h += '<div class="grupo">Controles · o criador deixou você escolher</div>'; }
    if (pode.length > 1) {
      h += '<div class="opcao"><span>Jeito de controlar</span><div class="seg" data-ctl="controle">' + pode.map(function (c) {
        return '<button type="button" data-v="' + c + '" aria-pressed="' + (c === S.ctl) + '">' + esc(NOME_CTL[c]) + '</button>'; }).join('') + '</div></div>';
    }
    regrasLivres.forEach(function (k) {
      h += '<div class="opcao"><span>' + esc(NOME_REGRA[k] || k) + '<span class="rot2">muda o placar · recomeça a partida</span></span><div class="seg" data-ctl="' + k + '">' +
        livres[k].map(function (v) { return '<button type="button" data-v="' + v + '" aria-pressed="' + (S.jg.regras[k] === v) + '">' + esc(NOME_VALOR[v] || v) + '</button>'; }).join('') + '</div></div>';
    });
    $('pControles').innerHTML = h;
    Array.prototype.forEach.call($('pControles').querySelectorAll('[data-ctl]'), function (grp) {
      var k = grp.getAttribute('data-ctl');
      Array.prototype.forEach.call(grp.children, function (b) {
        b.onclick = function () {
          var e = escolhas(S.atual.slug); e[k] = b.getAttribute('data-v'); salvarEscolhas(S.atual.slug, e);
          if (k === 'controle') { S.ctl = e[k]; montarControles(); pintarControlesPausa(); return; }
          fechar('vPausa'); recomecar();          // regra nova = partida nova (o placar é por modo)
        };
      });
    });
  }
  function abrirPausa() {
    if (!S.atual) { return; }
    if (S.remoto) { tvEnviar({ t: 'cmd', c: 'pausa' }); } else if (estado() === 'jogando') { pulso('pausa'); }
    seg('segTam', 'tam', parseFloat); seg('segAlfa', 'alfa', parseFloat); seg('segMao', 'mao'); seg('segSom', 'som', Number); seg('segVib', 'vib', Number);
    $('linVibrar').hidden = !(navigator.vibrate && TOQUE);
    pintarControlesPausa();
    abrir('vPausa');
  }
  $('btPausa').onclick = abrirPausa;
  $('pContinuar').onclick = function () {
    fechar('vPausa');
    if (S.remoto) { tvEnviar({ t: 'cmd', c: 'continuar' }); } else if (estado() === 'pausa') { pulso('pausa'); }
    conferirGiro();
  };
  function recomecar() {
    var s = S.atual && S.atual.slug; if (!s) { return; }
    if (S.remoto) { tvEnviar({ t: 'cmd', c: 'recomecar', jog: regrasEscolhidas(s) }); return; }   // 📺 a TV recomeça
    pararMotor(); var j = S.atual; S.atual = null; abrirJogoMesmo(j);
  }
  function abrirJogoMesmo(j) { S.atual = j; abrir('carregando'); iniciarMotor(); }
  $('pRecomecar').onclick = function () { fechar('vPausa'); recomecar(); };
  $('pSair').onclick = function () { fechar('vPausa'); if (S.remoto) { tvEnviar({ t: 'cmd', c: 'sair' }); } sairDoJogo(false); };
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && $('vPausa').classList.contains('on')) { e.stopPropagation(); } }, true);

  // ───────────────────────── 🏁 fim de partida, placar, desafio ─────────────────────────
  var ULT = { pontos: 0, venceu: false };
  function mostrarFim(pts, venceu) {
    if (!S.atual) { return; }
    ULT.pontos = pts; ULT.venceu = venceu;
    if (TV && CEL.ws) { setTimeout(function () { celTodos({ t: 'fim', pontos: pts, venceu: venceu, placar: !!S.placarResolver }); }, 30); }
    var rec = S.recordes[S.atual.slug], recPts = Math.max((rec && rec.pontos) || 0, (S.r && S.r.jogo && S.r.jogo.recorde && S.r.jogo.recorde.pontos) || 0);
    var novo = API && pts > 0 && pts > recPts;
    $('fimTit').textContent = venceu ? '🎉 Você venceu!' : (novo ? '🏆 Novo recorde!' : 'Fim de jogo');
    $('fimPts').textContent = fmt(pts);
    var txt = recPts ? 'recorde do jogo: ' + fmt(recPts) + ' pontos' : (API ? 'ninguém tem recorde aqui ainda' : '');
    if (S.desafio) { txt += (txt ? ' · ' : '') + (pts >= S.desafio.pontos ? '✔ desafio vencido!' : 'desafio: ' + fmt(S.desafio.pontos)); }
    if (S.jg && S.jg.modo && API) { txt += (txt ? ' · ' : '') + 'modo: ' + seloModo(S.jg.modo); }
    $('fimRec').textContent = txt;
    $('fimPlacar').hidden = !(S.placarResolver || (S.remoto && TVL.placar));
    $('fimAviso').className = 'msg ok';
    $('fimAviso').innerHTML = API ? '' : (pts > 0 ? 'Para valer no placar, jogue em <a style="color:var(--amarelo)" href="' + URL_PLACAR + '#/jogo/' + encodeURIComponent(S.atual.slug) + '">jogar.meufliperama.com.br</a>.' : '');
    $('fVerPlacar').hidden = !API;
    $('inAp').value = PREF.ap || ''; $('apMsg').textContent = '';
    abrir('vFim');
    if (S.placarResolver && !S.remoto) { prepararTurnstile(); }
  }
  function seloModo(m) {
    var R = { 'tiro=auto': '🔫 tiro auto', 'rolagem=sozinho': '🏃 corre sozinho', 'pulo=fixo': '🦘 pulo fixo', 'aceleracao=auto': '⏩ acelera sozinho' };
    return String(m || '').split(';').filter(Boolean).map(function (p) { return R[p] || p; }).join(' · ') || 'clássico';
  }
  // o motor pergunta o apelido no fim da partida (só na casa, só com pontos) — a resposta vem da folha de fim
  function pedirApelido() {
    return new Promise(function (ok) {
      S.placarResolver = ok;
      if ($('vFim').classList.contains('on')) { $('fimPlacar').hidden = false; prepararTurnstile(); }
    });
  }
  function resolverPlacar(v) { var f = S.placarResolver; S.placarResolver = null; $('fimPlacar').hidden = true; if (f) { f(v); } }
  function aoPlacar(r) {
    if (TV && CEL.ws) { celTodos({ t: 'placar', r: r }); }
    var a = $('fimAviso');
    if (r && r.erro) { a.className = 'msg'; a.textContent = r.erro; return; }
    if (r && r.ok) { a.className = 'msg ok'; a.textContent = r.recorde ? '🏆 Novo recorde! A casa vai conferir a partida.' : '✔ Pontos enviados! A casa vai conferir a partida.'; }
  }
  function prepararTurnstile() {
    if (!API || S.ts.pronto) { return; }
    S.ts.pronto = true;
    json(API + '/estado').then(function (e) {
      if (!e.turnstile_site_key) { return; }
      S.ts.chave = e.turnstile_site_key;
      var s = document.createElement('script'); s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'; s.async = true;
      s.onload = function () { seguro(function () { window.turnstile.render('#tsBox', { sitekey: S.ts.chave, size: 'flexible', callback: function (t) { S.ts.token = t; } }); }); };
      document.head.appendChild(s);
    }).catch(function () { S.ts.pronto = false; });
  }
  $('fPlacar').onclick = function () {
    var v = validarApelido($('inAp').value); if (v.erro) { $('apMsg').textContent = v.erro; return; }
    if (S.remoto) {   // 📺 o apelido vai para a TV, que manda a partida para a casa conferir
      PREF.ap = v.ok; salvarPref(); TVL.placar = false; $('fimPlacar').hidden = true;
      $('fimAviso').className = 'msg ok'; $('fimAviso').textContent = 'enviando pela TV…';
      tvEnviar({ t: 'cmd', c: 'placar', apelido: v.ok }); return;
    }
    if (S.ts.chave && !S.ts.token) { $('apMsg').textContent = 'Espere a verificação terminar…'; return; }
    PREF.ap = v.ok; salvarPref();
    var tk = S.ts.token; S.ts.token = null; seguro(function () { if (window.turnstile) { window.turnstile.reset('#tsBox'); } });
    $('fimAviso').className = 'msg ok'; $('fimAviso').textContent = 'enviando…';
    resolverPlacar({ apelido: v.ok, turnstile: tk });
  };
  $('fNovo').onclick = function () {
    if (S.remoto) { fechar('vFim'); tvEnviar({ t: 'cmd', c: 'novo' }); return; }
    resolverPlacar(null); fechar('vFim');
    var tent = 0;
    (function vai() { var e = estado(); if (e === 'jogando' || tent++ > 8) { return; } pulso('start'); setTimeout(vai, 240); })();
  };
  $('fSair').onclick = function () { if (S.remoto) { tvEnviar({ t: 'cmd', c: 'sair' }); } resolverPlacar(null); fechar('vFim'); sairDoJogo(false); };
  $('fAmigo').onclick = function () {
    var j = S.atual; if (!j) { return; }
    var url = URL_APP + '#/jogo/' + encodeURIComponent(j.slug) + '?d=' + ULT.pontos + (S.jg && S.jg.modo ? '&m=' + encodeURIComponent(S.jg.modo) : '');
    var txt = 'Fiz ' + fmt(ULT.pontos) + ' pontos em ' + j.nome + ' no Meu Fliperama! Você consegue mais?';
    if (navigator.share) { navigator.share({ title: j.nome + ' · Meu Fliperama', text: txt, url: url }).catch(function () {}); return; }
    window.open('https://wa.me/?text=' + encodeURIComponent(txt + ' ' + url), '_blank', 'noopener');
  };
  $('fVerPlacar').onclick = function () { verPlacar(S.jg ? S.jg.modo : ''); };
  function verPlacar(modo) {
    if (!API || !S.atual) { return; }
    $('plTit').textContent = '📋 Placar · ' + S.atual.nome;
    $('plTab').innerHTML = '<tr><td>carregando…</td></tr>';
    abrir('vPlacar');
    json(API + '/placar/' + encodeURIComponent(S.atual.slug) + '?top=10&modo=' + encodeURIComponent(modo || '')).then(function (d) {
      var L = d.placar || [];
      $('plTab').innerHTML = L.map(function (r, n) { return '<tr><td>' + (n + 1) + 'º</td><td>' + esc(r.apelido) + (r.venceu ? ' 🏁' : '') + '</td><td>' + fmt(r.pontos) + '</td></tr>'; }).join('') ||
        '<tr><td>Ninguém no placar deste modo ainda.</td></tr>';
      var ms = (d.modos || []);
      if (ms.length > 1 || (ms.length === 1 && ms[0].modo !== (modo || ''))) {
        $('plModos').innerHTML = ms.map(function (m) { return '<button type="button" data-m="' + esc(m.modo) + '" aria-pressed="' + (m.modo === (modo || '')) + '">' + esc(m.selo || 'clássico') + '</button>'; }).join('');
        Array.prototype.forEach.call($('plModos').children, function (b) { b.onclick = function () { verPlacar(b.getAttribute('data-m')); }; });
      } else { $('plModos').innerHTML = ''; }
      $('plNota').textContent = 'Só partidas conferidas pela casa (o robô joga de novo para conferir).';
    }).catch(function () { $('plTab').innerHTML = '<tr><td>Não deu para ler o placar agora.</td></tr>'; });
  }
  $('plFechar').onclick = function () { fechar('vPlacar'); };

  // ───────────────────────── 📺📱 TV + celular (14/11/2026 · foco do autor: "jogar no celular e na TV") ─────────────────────────
  // A TELA GRANDE (TV, ou PC) abre uma sala sem login na ponte (a mesma da TV da casa) e mostra QR + código.
  // O CELULAR lê o QR (abre este app em #/ligar/<código>) ou digita o código em "📺 Jogar na TV": vira o controle,
  // ESCOLHE O JOGO no próprio celular e ele abre na TV. Os controles do celular são os mesmos do jogo no celular
  // (por gênero, escolhidos pelo criador) — só que as teclas vão pela ponte. Até 2 celulares (J1 e J2).
  // Mensagens: celular→TV  oi · k (teclas, também serve de "estou vivo") · abrir {slug, jog} · cmd {c: pausa|continuar|
  //            recomecar|novo|sair|placar}; TV→celular  vaga · cheio · jogo · aberto {slug} · estado {e} · fim · placar · saiu.
  var CEL = { sala: null, ws: null, slots: {}, porCid: {}, estado: null };
  function abrirSala() {
    if (CEL.sala) { return Promise.resolve(CEL.sala); }
    return fetch(REMOTO + '/publico/fliperama/sala', { method: 'POST' }).then(function (r) { return r.json().then(function (j) { return [r.ok, j]; }); })
      .then(function (rj) {
        if (!rj[0]) { throw new Error((rj[1] && rj[1].detail) || 'Não deu para abrir a sala agora.'); }
        CEL.sala = rj[1];
        return (window.qrcode ? Promise.resolve() : carregarScript(QR_JS)).catch(function () {}).then(function () { ligarPonte(); return CEL.sala; });
      });
  }
  $('btCel').onclick = function () {
    abrir('vCel');
    if (CEL.sala) { desenharCel(); return; }
    $('celCorpo').textContent = 'abrindo…';
    abrirSala().then(desenharCel).catch(function (e) { $('celCorpo').textContent = (e && e.message) || 'O controle pelo celular está fora do ar agora — dá para jogar pelo teclado.'; });
  };
  $('celFechar').onclick = function () { fechar('vCel'); };
  function urlLigar() { return URL_PUB + '#/ligar/' + CEL.sala.codigo; }
  function qrCanvas(txt) {
    return seguro(function () {
      var q = window.qrcode(0, 'M'); q.addData(txt); q.make();
      var n = q.getModuleCount(), c = document.createElement('canvas'); c.width = n; c.height = n;
      var x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, n, n); x.fillStyle = '#000';
      for (var r = 0; r < n; r++) { for (var cc = 0; cc < n; cc++) { if (q.isDark(r, cc)) { x.fillRect(cc, r, 1, 1); } } }
      return c;
    });
  }
  function jogadoresTxt() { return [1, 2].map(function (n) { return CEL.slots[n] ? '🎮 J' + n + ' ✔' : ''; }).filter(Boolean).join(' · '); }
  function desenharCel() {
    var s = CEL.sala; if (!s) { return; }
    var end = URL_PUB.replace(/^https?:\/\//, '').replace(/\/$/, '');
    var html = '<div>No celular, aponte a câmera para o código<br>ou abra <b>' + esc(end) + '</b>, toque em <b>📺 Jogar na TV</b> e digite<br><span class="cod">' +
      esc(s.codigo) + '</span><br>' + (jogadoresTxt() || '<small>até 2 celulares</small>') + '</div>';
    ['celCorpo', 'tvQr'].forEach(function (id) {
      var el = $(id); if (!el) { return; }
      el.innerHTML = html; var c = qrCanvas(urlLigar()); if (c) { el.insertBefore(c, el.firstChild); }
    });
    if ($('tvCod')) { $('tvCod').textContent = s.codigo; }
    if (TV) { $('tvSelo').hidden = false; $('tvSelo').textContent = '📱 código ' + s.codigo + (jogadoresTxt() ? ' · ' + jogadoresTxt() : ''); }
  }
  function celPara(cid, m) { m.para = cid; if (CEL.ws && CEL.ws.readyState === 1) { CEL.ws.send(JSON.stringify(m)); } }
  function celTodos(m) { if (CEL.ws && CEL.ws.readyState === 1) { CEL.ws.send(JSON.stringify(m)); } }   // sem "para" = todos os celulares
  function ligarPonte() {
    if (!CEL.sala) { return; }
    var base = REMOTO ? REMOTO.replace(/^http/, 'ws') : (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host;
    var ws = new WebSocket(base + '/publico/fliperama/ponte/ws?papel=tv&sala=' + CEL.sala.codigo + '&chave=' + encodeURIComponent(CEL.sala.chave));
    CEL.ws = ws;
    ws.onmessage = function (ev) {
      var m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      var cid = m.de; if (!cid) { return; }
      if (m.t === 'oi') { celOi(cid, m); }
      else if (m.t === 'k') { if (!CEL.porCid[cid]) { celOi(cid, {}); } celTeclas(cid, m); }
      else if (m.t === 'tchau') { celSaiu(cid); }
      else if (m.t === 'abrir') { celAbrir(cid, m); }
      else if (m.t === 'cmd') { celCmd(cid, m); }
    };
    ws.onclose = function (ev) {
      if (CEL.ws !== ws) { return; }
      CEL.ws = null;
      if (ev.code === 4404) {     // a sala venceu: na TV abre outra sozinha; no PC avisa
        CEL.sala = null; CEL.slots = {}; CEL.porCid = {};
        if (TV) { setTimeout(function () { abrirSala().then(desenharCel).catch(function () {}); }, 1500); }
        else { $('celCorpo').textContent = 'O código venceu — toque em 📱 de novo.'; }
        return;
      }
      setTimeout(ligarPonte, 2000);
    };
  }
  function celOi(cid, m) {
    var livre = [m.quer, 1, 2].filter(function (n) { return (n === 1 || n === 2) && (!CEL.slots[n] || CEL.slots[n].cid === cid || Date.now() - (CEL.slots[n].visto || 0) > 4000); })[0];
    if (!livre) { celPara(cid, { t: 'cheio' }); return; }
    if (CEL.slots[livre] && CEL.slots[livre].cid !== cid) { delete CEL.porCid[CEL.slots[livre].cid]; }
    var sl = { n: livre, cid: cid, visto: Date.now(), seq: 0, k: {} };
    CEL.slots[livre] = sl; CEL.porCid[cid] = sl;
    celPara(cid, { t: 'vaga', slot: livre });
    if (livre === 2 && S.r && S.r.doisJogadores) { S.r.doisJogadores(true); }
    celPara(cid, { t: 'jogo', nome: S.atual ? S.atual.nome : 'Fliperama', dois: livre === 2 });
    if (S.atual) { celPara(cid, { t: 'aberto', slug: S.atual.slug }); celPara(cid, { t: 'estado', e: estado() }); }
    desenharCel();
    if (TV) { aviso('🎮 Celular ' + livre + ' ligado!'); }
  }
  function celTeclas(cid, m) {
    var sl = CEL.porCid[cid]; if (!sl) { return; }
    if (m.s != null) { if (m.s <= (sl.seq || 0)) { return; } sl.seq = m.s; }
    sl.visto = Date.now();
    var k = m.k || {}, antes = sl.k || {}; sl.k = k;
    var sem = {}; Object.keys(k).forEach(function (x) { if (x !== 'pausa') { sem[x] = k[x]; } });
    if (S.r && S.r.controle) { S.r.controle(sl.n, sem); }
    if (k.pausa && !antes.pausa) { abrirPausa(); }
    // o próprio botão (start/pulo) já começa o jogo no motor: aqui só sai a tela "▶ Jogar" da TV
    if ($('comecar').classList.contains('on') && ((k.pulo && !antes.pulo) || (k.start && !antes.start))) { fechar('comecar'); ligarSom(); }
  }
  function celAbrir(cid, m) {
    var sl = CEL.porCid[cid] || (celOi(cid, {}), CEL.porCid[cid]);
    if (!sl || (sl.n !== 1 && CEL.slots[1])) { celPara(cid, { t: 'aviso', txt: 'Quem escolhe o jogo é o celular 1.' }); return; }
    if (!S.porSlug[m.slug]) { celPara(cid, { t: 'aviso', txt: 'Esse jogo não está na TV — atualize a lista.' }); return; }
    ['vPausa', 'vFim', 'vPlacar', 'vCel'].forEach(fechar);
    if (S.placarResolver) { resolverPlacar(null); }
    S.jogExterno = m.jog || {}; S.desafio = null;
    abrirJogo(m.slug);
  }
  function celCmd(cid, m) {
    var sl = CEL.porCid[cid]; if (!sl || !S.atual) { return; }
    var e = estado();
    if (m.c === 'pausa') { if (e === 'jogando') { pulso('pausa'); } }
    else if (m.c === 'continuar') { if (e === 'pausa') { pulso('pausa'); } fechar('vPausa'); }
    else if (m.c === 'recomecar') { if (m.jog) { S.jogExterno = m.jog; } fechar('vPausa'); fechar('vFim'); if (S.placarResolver) { resolverPlacar(null); } recomecar(); }
    else if (m.c === 'novo') { $('fNovo').onclick(); }
    else if (m.c === 'sair') { if (S.placarResolver) { resolverPlacar(null); } sairDoJogo(false); }
    else if (m.c === 'placar' && m.apelido && S.placarResolver) {
      $('inAp').value = String(m.apelido).slice(0, 12);
      if (S.ts.chave && !S.ts.token) {      // a verificação da TV ainda não terminou: espera um pouco
        var t0 = Date.now(), f = setInterval(function () { if (S.ts.token || Date.now() - t0 > 8000) { clearInterval(f); $('fPlacar').onclick(); } }, 300);
      } else { $('fPlacar').onclick(); }
    }
  }
  function celSaiu(cid) {
    var sl = CEL.porCid[cid]; if (!sl) { return; }
    delete CEL.porCid[cid]; if (CEL.slots[sl.n] === sl) { delete CEL.slots[sl.n]; }
    if (S.r && S.r.controle) { S.r.controle(sl.n, {}); }
    if (sl.n === 2 && S.r && S.r.doisJogadores) { S.r.doisJogadores(false); }
    desenharCel();
  }
  setInterval(function () {
    Object.keys(CEL.porCid).forEach(function (cid) { if (Date.now() - (CEL.porCid[cid].visto || 0) > 3500) { celSaiu(cid); } });
    if (CEL.ws && S.atual) { var e = estado(); if (e !== CEL.estado) { CEL.estado = e; celTodos({ t: 'estado', e: e }); } }   // os celulares sabem se está jogando
  }, 250);

  // ── 📺 a TV: tela de espera com QR grande + a vitrine navegável pelo controle remoto ──
  function iniciarTv() {
    document.body.classList.add('modoTV');
    $('tvCasa').hidden = false; $('btTv').hidden = true; $('instalar').hidden = true;
    abrirSala().then(desenharCel).catch(function (e) { $('tvQr').textContent = (e && e.message) || 'A sala da TV não abriu — confira a internet.'; setTimeout(iniciarTv, 15000); });
    document.addEventListener('keydown', function (e) {   // setas do controle remoto andam pelos jogos
      if (S.atual || !/^Arrow/.test(e.key)) { return; }
      var bts = Array.prototype.slice.call(document.querySelectorAll('#lista .card'));
      if (!bts.length) { return; }
      var i = bts.indexOf(document.activeElement);
      if (i < 0) { bts[0].focus(); e.preventDefault(); return; }
      var cols = Math.max(1, bts.filter(function (b) { return b.offsetTop === bts[0].offsetTop; }).length);
      var d = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -cols, ArrowDown: cols }[e.key], n = Math.max(0, Math.min(bts.length - 1, i + d));
      bts[n].focus(); bts[n].scrollIntoView({ block: 'nearest' }); e.preventDefault();
    });
  }
  // no PC a vitrine abre o jogo direto; na TV também (controle remoto), mas o normal é o celular escolher

  // ── 📱 o celular ligado numa TV ──
  var TVL = { ws: null, codigo: null, slot: 0, seq: 0, estado: 'titulo', placar: false, vivo: null, desligado: false };
  function tvEnviar(m) { if (TVL.ws && TVL.ws.readyState === 1) { TVL.ws.send(JSON.stringify(m)); } }
  function ligarNaTv(codigo) {
    codigo = String(codigo || '').replace(/\D/g, '').slice(0, 6);
    if (codigo.length < 4) { $('ligMsg').textContent = 'O código tem 4 números (está na TV).'; return; }
    desligarTv(true);
    TVL.desligado = false; TVL.codigo = codigo;
    $('ligMsg').className = 'msg ok'; $('ligMsg').textContent = 'ligando na TV ' + codigo + '…';
    fetch(REMOTO + '/publico/fliperama/ponte/sala/' + codigo).then(function (r) {
      if (!r.ok) { throw new Error('Esse código não está aberto em nenhuma TV. Confira o número na tela.'); }
      conectarTv();
    }).catch(function (e) { $('ligMsg').className = 'msg'; $('ligMsg').textContent = e.message || 'Não deu para ligar agora.'; abrir('vLigar'); });
  }
  function conectarTv() {
    if (TVL.desligado || !TVL.codigo) { return; }
    var base = REMOTO ? REMOTO.replace(/^http/, 'ws') : (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host;
    var ws = new WebSocket(base + '/publico/fliperama/ponte/ws?papel=controle&sala=' + TVL.codigo);
    TVL.ws = ws;
    ws.onmessage = function (ev) {
      var m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.t === 'bemvindo') { tvEnviar({ t: 'oi', quer: TVL.slot || null, app: 1 }); }
      else if (m.t === 'vaga') { TVL.slot = m.slot; fechar('vLigar'); pintarTvLigada(); vibrar(30); aviso('📺 Ligado na TV! Você é o jogador ' + m.slot + (m.slot === 1 ? ' — escolha um jogo.' : '.')); }
      else if (m.t === 'cheio') { aviso('A TV já tem 2 celulares.'); desligarTv(); }
      else if (m.t === 'aberto') { abrirControle(m.slug); }
      else if (m.t === 'estado') { TVL.estado = m.e; if (m.e === 'jogando') { fechar('comecar'); } }
      else if (m.t === 'fim') { TVL.placar = !!m.placar; if (S.remoto) { mostrarFim(m.pontos || 0, !!m.venceu); vibrar([40, 30, 80]); } }
      else if (m.t === 'placar') { if (S.remoto) { aoPlacar(m.r); } }
      else if (m.t === 'saiu') { if (S.remoto) { sairDoJogo(true); } }
      else if (m.t === 'aviso') { aviso(m.txt || ''); }
    };
    ws.onclose = function (ev) {
      if (TVL.ws !== ws) { return; }
      TVL.ws = null; pintarTvLigada();
      if (ev.code === 4404) { aviso('A TV fechou a sala. Leia o código de novo.'); TVL.codigo = null; if (S.remoto) { sairDoJogo(true); } return; }
      if (!TVL.desligado) { setTimeout(conectarTv, 2000); }
    };
    clearInterval(TVL.vivo);
    TVL.vivo = setInterval(function () { tvEnviar({ t: 'k', k: S.remoto ? S.K : {}, s: ++TVL.seq }); }, 1000);   // "estou vivo"
  }
  function desligarTv(quieto) {
    TVL.desligado = true; clearInterval(TVL.vivo);
    if (TVL.ws) { seguro(function () { TVL.ws.close(); }); }
    TVL.ws = null; TVL.slot = 0;
    if (S.remoto) { sairDoJogo(true); }
    pintarTvLigada();
    if (!quieto) { TVL.codigo = null; }
  }
  function pintarTvLigada() {
    var b = $('btTv'); if (!b) { return; }
    var lig = !!(TVL.ws && TVL.slot);
    b.textContent = lig ? '📺 TV ' + TVL.codigo + ' · J' + TVL.slot : '📺 Jogar na TV';
    b.classList.toggle('ligado', lig);
    $('ligDesl').hidden = !lig;
  }
  function regrasEscolhidas(slug) { var e = escolhas(slug), o = {}; Object.keys(e).forEach(function (k) { if (k !== 'controle') { o[k] = e[k]; } }); return o; }
  function mandarParaTv(slug) {
    if (!S.porSlug[slug]) { return; }
    aviso('📺 abrindo ' + S.porSlug[slug].nome + ' na TV…');
    tvEnviar({ t: 'abrir', slug: slug, jog: regrasEscolhidas(slug) });
  }
  // o celular vira o controle do jogo que está na TV (mesmos controles do gênero, sem o motor)
  function abrirControle(slug) {
    var j = S.porSlug[slug]; if (!j) { aviso('Esse jogo não está na lista deste celular.'); return; }
    if (S.r) { pararMotor(); }
    S.remoto = true; S.atual = j; TVL.estado = 'titulo'; TVL.placar = false;
    ['vPausa', 'vFim', 'vPlacar'].forEach(fechar);
    $('vitrine').classList.remove('on'); $('jogo').classList.add('on', 'remoto');
    abrir('carregando'); fechar('comecar'); fechar('gire');
    $('ctl').innerHTML = '';
    $('palco').innerHTML = '<div class="naTv"><span class="ic" aria-hidden="true">📺</span><b>' + esc(j.nome) + '</b><span>jogando na TV · você é o jogador ' + TVL.slot + '</span></div>';
    telaCheia();
    Promise.all([garantirMotor(), json(DADOS + encodeURIComponent(slug) + '/spec.json?v=' + versaoJogo(j))]).then(function (rs) {
      if (S.atual !== j || !S.remoto) { return; }
      S.spec = rs[1]; j.orientacao = orientacaoDe(j, S.spec);
      S.jg = window.Fliperama.jogabilidade ? window.Fliperama.jogabilidade(S.spec, regrasEscolhidas(slug)) : { regras: {}, livres: {}, modo: '' };
      S.ctl = controleEscolhido();
      fechar('carregando');
      $('cmNome').textContent = j.nome; $('cmDesafio').hidden = true;
      $('cmDica').textContent = (DICA_CTL[S.ctl] || '') + ' · o jogo aparece na TV';
      $('btCel').hidden = true;
      if (TVL.slot === 1) { abrir('comecar'); }
      montarControles(); conferirGiro();
    }).catch(function (e) { fechar('carregando'); aviso('Não deu para montar o controle: ' + (e && e.message || e)); });
  }
  $('btTv').onclick = function () { $('ligCod').value = TVL.codigo || ''; pintarTvLigada(); abrir('vLigar'); setTimeout(function () { if (!TVL.slot) { $('ligCod').focus(); } }, 60); };
  $('ligOk').onclick = function () { ligarNaTv($('ligCod').value); };
  $('ligCod').addEventListener('keydown', function (e) { if (e.key === 'Enter') { ligarNaTv($('ligCod').value); } });
  $('ligDesl').onclick = function () { desligarTv(); fechar('vLigar'); aviso('Desligado da TV.'); };
  $('ligFechar').onclick = function () { fechar('vLigar'); };

  // teclado do PC: Enter/espaço no "▶ Jogar"
  document.addEventListener('keydown', function (e) {
    if (!S.atual) { return; }
    if ($('comecar').classList.contains('on') && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); comecar(); }
  });

  // ───────────────────────── início ─────────────────────────
  medir('app', {});
  $('ligEnd').textContent = URL_PUB.replace(/^https?:\/\//, '') + '#/tv';
  if (TV) { iniciarTv(); }
  mostrarInstalar();
  carregarCatalogo().then(lerRota);
  window.__fliperamaApp = { versao: '1.0', casa: CASA, aparelho: APARELHO };   // para o smoke
})();
