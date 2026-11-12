/* 🧊 FLIPERAMA — estilo "3D" das fases (2,5D, à moda do Wii U · 25/10/2026).
 *
 * O jogo continua o MESMO jogo.json e a MESMA simulação da casa (motor.js · Plataforma): o herói anda para os
 * lados, as peças, regras, código mágico e o robô não mudam. Este módulo só DESENHA a fase em 3D com Three.js
 * (vendorizado em /estudio/fliperama/three/, MIT) e a biblioteca 3D livre da casa (/estudio/fliperama/3d/, CC0:
 * Quaternius, Kenney e KayKit).
 *
 * O truque da câmera: ela olha reto para a fase (sem girar), um pouco acima, com o "quadro" deslocado (projeção
 * fora do eixo). Assim o plano da frente (z = 0) cai EXATAMENTE onde o Phaser desenha — o placar, as mensagens,
 * as partículas e a luz do Phaser continuam por cima, no lugar certo — e ainda se vê o topo e o lado dos blocos.
 *
 * É carregado sob demanda pelo motor Phaser (motor-phaser.js) quando uma fase está no estilo "3d".
 */
import * as THREE from './three/three.module.js';
import { GLTFLoader } from './three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from './three/addons/utils/SkeletonUtils.js';

export const VERSAO = '0.9.8-3d';
const BASE = '/estudio/fliperama/3d/';

function escuro(h) {
  const n = parseInt(String(h || '#000000').slice(1), 16);
  return (((n >> 16) & 255) * 0.3 + ((n >> 8) & 255) * 0.59 + (n & 255) * 0.11) < 40;
}
function mulberry(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// cenários prontos (o fundo da fase em 3D): enfeites atrás, chão de trás, morros e céu
export const CENARIOS = {
  campo: { chao: '#6DBE45', fundo: ['arvore', 'arvore_fruta', 'arbusto', 'arbusto_fruta', 'pedra_1', 'cerca', 'planta_grande'], morro: '#4FA83A', nuvens: true },
  floresta: { chao: '#3F8F3A', fundo: ['arvore_1', 'arvore_2', 'arvore_3', 'arvore_4', 'cogumelo_gigante', 'arbusto', 'planta_grande'], morro: '#2E6E30', nuvens: true },
  montanha: { chao: '#9AA4AE', fundo: ['pedra_1', 'pedra_2', 'arvore_4', 'pedra_1', 'arvore_3'], morro: '#B8C4CE', nuvens: true, neve: true },
  deserto: { chao: '#E2C17A', fundo: ['pedra_1', 'pedra_2', 'caveira', 'planta_grande', 'pedra_2'], morro: '#D9A85B', nuvens: false },
  castelo: { chao: '#4A4458', fundo: ['pilar', 'caveira', 'pilar', 'pedra_2'], morro: '#2C2838', nuvens: false, escuro: true, parede: '#3E3850' },
};

// 🎭 Estúdio (26/10/2026): ajustes por personagem, no jogo todo — spec.d3.ajustes[sprite] = {cor, tamanho, olhar, espessura}
export const CORES_AJUSTE = { vermelho: '#FF3B3B', azul: '#3B7BFF', roxo: '#9B4DFF', dourado: '#FFC21A', sombra: '#1A1A2A' };
export function ajusteDe(spec, nome) { const a = (((spec || {}).d3 || {}).ajustes || {})[nome]; return a && typeof a === 'object' ? a : {}; }
const OLHAR = { camera: 0.78, lado: 1, frente: 0 };
export function tingir(o3, cor) {
  if (!cor || cor === 'original') { return; }
  const hex = CORES_AJUSTE[cor] || cor, sombra = cor === 'sombra';
  o3.traverse((m) => {
    if (!m.isMesh || !m.material) { return; }
    const tinge = (mt) => { const c = mt.clone(); if (c.color) { if (sombra) { c.color.multiplyScalar(0.18); } else { c.color.lerp(new THREE.Color(hex), 0.55); } } return c; };
    m.material = Array.isArray(m.material) ? m.material.map(tinge) : tinge(m.material);
  });
}

// ═══════════ 🧬 CLONES (0.9.8): personagem novo = um da casa (com esqueleto e animações) + cores + acessórios do kit ═══════════
// spec.clones[id].d3 = {base, cores:{Material:"#hex"}, tinta, acessorios:[{id, cor, escala, sobe, frente}]}; o kit (formas) vem do motor.js
export function registrarClones(spec, B) {
  const cl = (spec && spec.clones) || {}, P = B.personagens;
  Object.keys(cl).forEach((id) => {
    const c = cl[id], d = c && c.d3, bp = d && P[d.base];
    if (!bp || bp.clone) { return; }
    const p = Object.assign({}, bp, { nome: c.nome || bp.nome, clone: d, base: d.base }); delete p.cor;
    P['clone:' + id] = p;
  });
  return B;
}
const FORMAS = {
  esfera: () => new THREE.SphereGeometry(0.5, 18, 12), cubo: () => new THREE.BoxGeometry(1, 1, 1), cone: () => new THREE.ConeGeometry(0.5, 1, 18),
  cilindro: () => new THREE.CylinderGeometry(0.5, 0.5, 1, 20), toro: () => new THREE.TorusGeometry(0.4, 0.09, 10, 28), piramide: () => new THREE.ConeGeometry(0.5, 1, 4),
};
function ossoDe(o3, tipo) {
  const pad = { cabeca: [/^head$/i, /^head\./i, /head/i], corpo: [/^(chest|spine\.?2|upperchest)$/i, /^(torso|body|spine\.?1|spine)$/i, /chest|torso|spine|body/i] }[tipo];
  const ossos = []; o3.traverse((o) => { if (o.isBone) { ossos.push(o); } });
  for (const re of pad) { const b = ossos.find((o) => re.test(o.name)); if (b) { return b; } }
  return null;
}
function corLuz(hex, k) { const c = new THREE.Color(hex); return k ? c.multiplyScalar(k) : c; }
export function vestirClone(o3, cl) {
  if (!cl) { return; }
  // 1) cores por material (e tinta para os modelos de uma textura só)
  const cores = cl.cores || {}, tinta = /^#[0-9a-f]{6}$/i.test(cl.tinta || '') ? cl.tinta : null;
  o3.traverse((m) => {
    if (!m.isMesh || !m.material) { return; }
    const pinta = (mt) => { const c = mt.clone(), nova = cores[mt.name]; if (nova && /^#[0-9a-f]{6}$/i.test(nova) && c.color) { c.color = new THREE.Color(nova); } else if (tinta && c.map && c.color) { c.color = new THREE.Color(tinta); } return c; };
    m.material = Array.isArray(m.material) ? m.material.map(pinta) : pinta(m.material);
  });
  // 2) acessórios do kit presos ao osso (seguem a cabeça quando ela mexe)
  const KIT = (globalThis.Fliperama && globalThis.Fliperama._kit) || {};
  const acs = (cl.acessorios || []).filter((a) => KIT[a.id]); if (!acs.length) { return; }
  o3.updateMatrixWorld(true);
  const caixa = new THREE.Box3().setFromObject(o3, true), alto = Math.max(1e-6, caixa.max.y - caixa.min.y);
  const cab = ossoDe(o3, 'cabeca'), corpo = ossoDe(o3, 'corpo') || cab;
  const pc = new THREE.Vector3(); if (cab) { cab.getWorldPosition(pc); } else { pc.set((caixa.min.x + caixa.max.x) / 2, caixa.max.y - alto * 0.12, (caixa.min.z + caixa.max.z) / 2); }
  const deitado = Math.max(caixa.max.x - caixa.min.x, caixa.max.z - caixa.min.z) > alto * 1.3;   // bicho de quatro patas, cobra…
  const u = cab ? Math.max(alto * (deitado ? 0.45 : 0.12), Math.min(alto * 0.45, caixa.max.y - pc.y)) : alto * 0.18;   // "uma cabeça"
  acs.slice(0, 8).forEach((a) => {
    const k = KIT[a.id], e = Math.max(0.4, Math.min(2.5, +a.escala || 1)), cor = /^#[0-9a-f]{6}$/i.test(a.cor || '') ? a.cor : k.cor;
    const naCabeca = k.onde === 'cabeca' || k.onde === 'rosto', osso = naCabeca ? cab : corpo;
    const o = new THREE.Vector3(); if (osso) { osso.getWorldPosition(o); } else { o.copy(pc); }
    if (naCabeca) { o.y = (cab ? pc.y : o.y) + u * 0.5; }
    o.y += (Math.max(-1, Math.min(1, +a.sobe || 0))) * u; o.z += (Math.max(-1, Math.min(1, +a.frente || 0))) * u;
    const g = new THREE.Group();
    k.d3.forEach((pt) => {
      const [forma, pos, tam, luz, corFixa, rot] = pt, ger = FORMAS[forma]; if (!ger) { return; }
      const m = new THREE.Mesh(ger(), new THREE.MeshStandardMaterial({ color: corFixa ? new THREE.Color(corFixa) : corLuz(cor, luz), roughness: 0.55, metalness: corFixa === '#F2C94C' ? 0.35 : 0.05 }));
      m.position.set(pos[0] * u * e, pos[1] * u * e, pos[2] * u * e); m.scale.set(tam[0] * u * e, tam[1] * u * e, tam[2] * u * e);
      if (rot) { m.rotation.set(rot[0] * Math.PI / 180, rot[1] * Math.PI / 180, rot[2] * Math.PI / 180); }
      m.frustumCulled = false; g.add(m);
    });
    g.position.copy(o); o3.add(g); g.updateMatrixWorld(true);
    if (osso) { osso.attach(g); }
  });
}

let BIB = null, carregandoBib = null;
export function biblioteca() {
  if (BIB) { return Promise.resolve(BIB); }
  if (!carregandoBib) { carregandoBib = fetch(BASE + 'biblioteca.json').then((r) => r.json()).then((b) => { BIB = b; return b; }); }
  return carregandoBib;
}

// ───────── quem é quem no 3D: o que a especificação pediu (spec.d3) e, no que faltar, a casa escolhe pelo papel ─────────
// o que o jogo já escolheu no HD vale como dica para o 3D (o mesmo bloco, no jeito 3D)
const DO_HD = { grama: 'grama_3d', terra: 'terra_3d', pedra: 'pedra_3d', tijolo_cinza: 'pedra_3d', planeta: 'pedra_3d', areia: 'areia_3d', neve: 'neve_3d',
  caixote: 'caixote_3d', tijolo: 'tijolo_3d', caixa_surpresa: 'caixa_surpresa_3d', caixa_usada: 'caixa_usada_3d', caixa_moeda: 'caixa_moeda_kenney',
  caixa_moeda_usada: 'caixa_usada_3d', espinhos: 'espinhos_3d', lava: 'lava_3d', agua: 'agua_3d', ponte: 'ponte_3d', cogumelo_vermelho: 'ponte_3d' };
export function mapa3D(spec, fi, B) {
  registrarClones(spec, B);
  const f = (spec.fases || [])[fi] || {}, P = B.personagens, BL = B.blocos;
  const pedido = Object.assign({}, spec.d3 || {});
  if (spec.hd && spec.hd.blocos) {
    const bl = {}; Object.keys(spec.hd.blocos).forEach((ch) => { const id = DO_HD[spec.hd.blocos[ch]]; if (id && BL[id]) { bl[ch] = id; } });
    pedido.blocos = Object.assign(bl, (spec.d3 || {}).blocos || {});
  }
  const her = spec.heroi || {}, ents = spec.entidades || {}, tiles = spec.tiles || {};
  const ok = (id, tab) => (id === 'voxel' && tab === P ? 'voxel' : (id && tab[id] ? id : null));
  const pers = {}, blocos = {};
  const heroiNome = (porNome(her.sprite, B) || []).filter((x) => P[x] && P[x].papel !== 'item' && !P[x].veiculo)[0];
  const heroiId = ok((pedido.personagens || {})[her.sprite], P) || ok(pedido.heroi, P) || heroiNome || 'aventureiro_3d';
  [her.sprite, her.sprite_grande, her.sprite_poder].concat(Object.values(her.animacoes || {})).concat(Object.values(her.animacoes_grande || {}))
    .forEach((n) => { if (n) { pers[n] = heroiId; } });
  const deTiro = {};
  Object.values(ents).forEach((e) => { if (e && e.tiro) { deTiro[e.tiro] = 1; } });
  const usados = {};
  Object.keys(ents).forEach((ch) => {
    const e = ents[ch] || {}, n = e.sprite;
    if (!n || pers[n]) { return; }
    let quer = ok((pedido.personagens || {})[n], P);
    if (!quer) {
      const pc = {}; (e.pecas || []).forEach((x) => { pc[x] = 1; });
      const c = e.comportamento || '';
      if (deTiro[ch]) { quer = 'bala_canhao'; }
      else if (e.tipo === 'inimigo' && !/^(alien|morcego|gosma|monstro|inimigo)/.test(n) && porNome(n, B)) { const l = porNome(n, B); quer = l.filter((x) => !usados[x])[0] || l[0]; }
      else if (e.tipo === 'coletavel') { quer = e.moeda === false ? 'gema_azul_3d' : 'moeda_3d'; }
      else if (e.tipo === 'poder') { quer = { crescer: 'cogumelo_3d', estrela: 'estrela_3d', vida: 'coracao_3d', pulo_duplo: 'raio' }[e.da] || 'gema_verde_3d'; }
      else if (e.tipo === 'fim_de_fase') { quer = 'bandeira_3d'; }
      else if (e.tipo === 'chave') { quer = 'chave_3d'; }
      else if (pc.plataforma) { quer = 'plataforma_3d'; }
      else if (pc.chefe) { quer = usados.aranha_rainha ? 'monstro_rei' : 'aranha_rainha'; }
      else if (pc.casco) { quer = 'caranguejo'; }
      else if (pc.voa || c.indexOf('voa') === 0) { quer = usados.abelha_3d ? 'vespa' : 'abelha_3d'; }
      else if (pc.pula || c === 'pula') { quer = 'sapo_3d'; }
      else if (pc.espinho) { quer = pc.anda ? 'bola_espinhos' : 'serra_3d'; }
      else if (pc.atira) { quer = 'canhao'; }
      else { quer = ['monstrinho', 'rato_3d', 'cobra', 'aranha', 'cobra_brava'].filter((x) => !usados[x])[0] || 'monstrinho'; }
    }
    usados[quer] = 1; pers[n] = quer;
    if (e.sprite_casco) { pers[e.sprite_casco] = quer; }
  });
  // blocos: igual ao HD — o alvo de um "vira" é a caixa usada; o chão de verdade é quem fica na superfície
  const viraDe = {};
  Object.keys(tiles).forEach((ch) => { const t = tiles[ch] || {}; const v = t.vira || (t.surpresa && t.surpresa.vira); if (v) { viraDe[v] = 1; } });
  let solidos = Object.keys(tiles).filter((ch) => { const t = tiles[ch] || {}; return t.solido && !t.mortal && !t.plataforma && !t.surpresa && !t.quebravel && !viraDe[ch] && !t.entrada; });
  const sup = {}, emb = {}, debaixoDe = {}, m = f.mapa || [];
  for (let j = 0; j < m.length; j++) {
    for (let i = 0; i < m[j].length; i++) {
      const c = m[j][i]; if (solidos.indexOf(c) < 0) { continue; }
      const cima = j > 0 ? m[j - 1][i] : '.';
      if (solidos.indexOf(cima) < 0) { sup[c] = (sup[c] || 0) + 1; }
      else { emb[c] = (emb[c] || 0) + 1; if (cima !== c) { (debaixoDe[c] = debaixoDe[c] || {})[cima] = ((debaixoDe[c] || {})[cima] || 0) + 1; } }
    }
  }
  const miolo = {};
  solidos.forEach((c) => { if ((sup[c] || 0) < 0.08 * ((sup[c] || 0) + (emb[c] || 0)) && debaixoDe[c]) { miolo[c] = Object.keys(debaixoDe[c]).sort((a, b) => debaixoDe[c][b] - debaixoDe[c][a])[0]; } });
  solidos = solidos.filter((c) => !miolo[c]).sort((a, b) => (sup[b] || 0) - (sup[a] || 0));
  const cen = cenarioDa(spec, fi);
  const chaos = escuro(f.ceu) || cen === 'castelo' ? ['pedra_3d', 'tijolo_3d', 'caixote_3d', 'bloco_azul', 'terra_3d']
    : (cen === 'deserto' ? ['areia_3d', 'pedra_3d', 'caixote_3d', 'tijolo_3d', 'bloco_azul'] : (cen === 'montanha' ? ['neve_3d', 'pedra_3d', 'caixote_3d', 'gelo_3d', 'bloco_azul']
      : ['grama_3d', 'caixote_3d', 'bloco_verde', 'rocha_grama', 'tijolo_3d', 'bloco_azul']));
  Object.keys(tiles).forEach((ch) => {
    const t = tiles[ch] || {};
    let quer = ok((pedido.blocos || {})[ch], BL);
    if (!quer) {
      if (viraDe[ch]) { quer = 'caixa_usada_3d'; }
      else if (t.surpresa) { quer = 'caixa_surpresa_3d'; }
      else if (t.quebravel) { quer = 'tijolo_3d'; }
      else if (t.entrada) { quer = 'caixote_3d'; }
      else if (t.mortal && !t.solido) { quer = 'lava_3d'; }
      else if (t.mortal) { quer = 'espinhos_3d'; }
      else if (t.plataforma) { quer = 'ponte_3d'; }
      else if (!t.solido) { quer = null; }
      else { quer = chaos[Math.min(chaos.length - 1, solidos.indexOf(ch))] || 'pedra_3d'; }
    }
    blocos[ch] = quer;
  });
  Object.keys(miolo).forEach((c) => { if (!(pedido.blocos || {})[c]) { let r = miolo[c], n = 0; while (miolo[r] && n++ < 5) { r = miolo[r]; } blocos[c] = blocos[r]; } });
  return { pers, blocos, cenario: cen };
}
export function cenarioDa(spec, fi) {
  const f = (spec.fases || [])[fi] || {};
  const c = f.cenario_3d || (spec.d3 || {}).cenario;
  if (c && CENARIOS[c]) { return c; }
  if (escuro(f.ceu)) { return 'castelo'; }
  const n = (f.nome || '').toUpperCase();
  if (/DESERT|DUNA|AREIA|PRAIA/.test(n)) { return 'deserto'; }
  if (/NEVE|GELO|GELAD|MONTANH/.test(n)) { return 'montanha'; }
  if (/FLOREST|COGUMEL|MATA|SELVA/.test(n)) { return 'floresta'; }
  if (/CASTEL|TEMPLO|CAVERNA|MASMORRA|TORRE|PEDRA/.test(n)) { return 'castelo'; }
  return 'campo';
}
// os arquivos que uma fase precisa (para carregar antes de mostrar)
export function arquivosDa(spec, fi, B) {
  const mp = mapa3D(spec, fi, B), arqs = new Set();
  Object.values(mp.pers).forEach((id) => { const p = B.personagens[id]; if (p) { arqs.add(p.arquivo); } });
  Object.values(mp.blocos).forEach((id) => { const b = id && B.blocos[id]; if (b && b.topo) { arqs.add(b.topo); arqs.add(b.meio || b.topo); } });
  CENARIOS[mp.cenario].fundo.forEach((id) => { const e = B.enfeites[id]; if (e) { arqs.add(e.arquivo); } });
  ['nuvem_1', 'nuvem_2', 'nuvem_3', 'grama_1', 'grama_2'].forEach((id) => { const e = B.enfeites[id]; if (e) { arqs.add(e.arquivo); } });
  arqs.add(B.personagens.bala_canhao.arquivo);
  return Array.from(arqs);
}

// ───────── carregar e "normalizar" os modelos (cada um vira 1×1×1, com o pé no chão) ─────────
const loader = new GLTFLoader();
// alguns modelos (abelha, vespa, caranguejo) trazem números inválidos (NaN) nos vértices: a caixa do modelo virava NaN
// e ele sumia da tela. Troca por 0 e reequilibra os pesos do esqueleto.
function limparNaN(raiz) {
  raiz.traverse((o) => {
    if (!o.isMesh || !o.geometry) { return; }
    const at = o.geometry.attributes;
    Object.keys(at).forEach((k) => { const a = at[k].array; let mudou = false; for (let i = 0; i < a.length; i++) { if (!Number.isFinite(a[i])) { a[i] = 0; mudou = true; } } if (mudou) { at[k].needsUpdate = true; } });
    if (at.skinWeight) {
      const w = at.skinWeight.array;
      for (let i = 0; i < w.length; i += 4) { const t = w[i] + w[i + 1] + w[i + 2] + w[i + 3]; if (t > 0) { for (let k = 0; k < 4; k++) { w[i + k] /= t; } } else { w[i] = 1; } }
      at.skinWeight.needsUpdate = true;
    }
    o.geometry.computeBoundingBox(); o.geometry.computeBoundingSphere();
  });
}
const cache = new Map();
function carregar(arq) {
  if (!cache.has(arq)) {
    cache.set(arq, loader.loadAsync(BASE + arq).then((g) => {
      const raiz = g.scene;
      limparNaN(raiz);
      raiz.updateMatrixWorld(true);
      const caixa = new THREE.Box3().setFromObject(raiz, true), tam = new THREE.Vector3(), centro = new THREE.Vector3();
      caixa.getSize(tam); caixa.getCenter(centro);
      raiz.traverse((o) => { if (o.isMesh) { o.frustumCulled = false; if (o.material) { o.material.side = THREE.FrontSide; } } });
      return { cena: raiz, clipes: g.animations || [], tam, centro, min: caixa.min.clone(), pele: !!raiz.getObjectByProperty('type', 'SkinnedMesh') };
    }));
  }
  return cache.get(arq);
}
// 🧬 os materiais (as "partes" que a criança pinta) de um personagem 3D
export async function materiaisDe(pid) {
  const B = await biblioteca(), p = B.personagens[pid]; if (!p) { return []; }
  const mod = await carregar(p.arquivo), out = [], visto = {};
  mod.cena.traverse((m) => { if (!m.isMesh || !m.material) { return; } (Array.isArray(m.material) ? m.material : [m.material]).forEach((mt) => {
    if (!mt.name || visto[mt.name]) { return; } visto[mt.name] = 1; out.push({ nome: mt.name, cor: mt.color ? '#' + mt.color.getHexString(THREE.SRGBColorSpace).toUpperCase() : '#888888', textura: !!mt.map }); }); });
  return out;
}
export function precarregar(lista) { return Promise.all(lista.map((a) => carregar(a).catch(() => null))); }
function pronto(arq) { const p = cache.get(arq); return p && p._v; }
// guarda o valor resolvido para uso síncrono no quadro
function marcarProntos(lista) { return Promise.all(lista.map((a) => carregar(a).then((v) => { cache.get(a)._v = v; }).catch(() => null))); }

// peças de um bloco para instanciar: cada malha do modelo com a sua matriz, já dentro do cubo unitário
function pecasDoBloco(mod) {
  const g = new THREE.Group(), r = mod.cena.clone(true);
  r.position.set(-mod.centro.x, -mod.centro.y, -mod.centro.z);
  g.add(r);
  g.scale.set(1 / Math.max(mod.tam.x, 1e-6), 1 / Math.max(mod.tam.y, 1e-6), 1 / Math.max(mod.tam.z, 1e-6));
  g.updateMatrixWorld(true);
  const pecas = [];
  r.traverse((o) => { if (o.isMesh) { pecas.push({ geo: o.geometry, mat: o.material, m: o.matrixWorld.clone() }); } });
  return pecas;
}

// ───────── o mundo 3D ─────────
export function criar(host, opts) {
  const W = opts.W, H = opts.H, Z = opts.Z;
  const render = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
  render.setPixelRatio(1);
  render.setSize(W * Z, H * Z, false);
  render.toneMapping = THREE.ACESFilmicToneMapping;
  render.toneMappingExposure = 1.05;
  const tela = render.domElement;
  tela.setAttribute('data-doc', 'Fliperama · estilo 3D da fase · Three.js ' + THREE.REVISION + ' + biblioteca 3D CC0');
  const cena = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(40, W / H, 0.5, 400);
  const hemi = new THREE.HemisphereLight(0xFFFFFF, 0x557744, 1.6);
  const sol = new THREE.DirectionalLight(0xFFF4DD, 2.2);
  sol.position.set(-4, 10, 9);
  const tocha = new THREE.PointLight(0xFFB060, 0, 14, 1.4);
  cena.add(hemi, sol, sol.target, tocha);
  const raizFase = new THREE.Group(); cena.add(raizFase);
  const raizObjs = new THREE.Group(); cena.add(raizObjs);
  let antes = performance.now();
  let st = null;   // estado da fase montada
  const D = 15, ALTO = 4.2;   // distância da câmera e quanto ela fica acima do meio da tela (em blocos)

  function texSprite(sprites, nome, q) {
    const sp = sprites[nome]; if (!sp) { return null; }
    const k = nome + ':' + q;
    st.texs = st.texs || {};
    if (!st.texs[k]) {
      const t = new THREE.CanvasTexture(sp.quadros[q % sp.quadros.length]);
      t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace;
      st.texs[k] = t;
    }
    return st.texs[k];
  }

  function montar(jogo, spec, sprites, fi) {
    desmontar();
    const B = BIB, mp = mapa3D(spec, fi, B), T = jogo.T, f = jogo.fase || {};
    const cenId = mp.cenario, cen = CENARIOS[cenId];
    const dy = jogo.alt < H ? H - jogo.alt : 0;
    st = { fi, mp, T, dy, objs: new Map(), tiros: [], cel: {}, mapaVisto: null, sprites, spec, cen: cenId, sombras: [] };
    // céu, névoa e luz
    const base = new THREE.Color(f.ceu || '#6888FC');
    const noite = !!cen.escuro || escuro(f.ceu);
    const cv = document.createElement('canvas'); cv.width = 4; cv.height = 256;
    const cx = cv.getContext('2d'), gr = cx.createLinearGradient(0, 0, 0, 256);
    const topo = base.clone().multiplyScalar(noite ? 0.6 : 0.78), baixo = base.clone().lerp(new THREE.Color(0xFFFFFF), noite ? 0.08 : 0.45);
    gr.addColorStop(0, '#' + topo.getHexString()); gr.addColorStop(1, '#' + baixo.getHexString());
    cx.fillStyle = gr; cx.fillRect(0, 0, 4, 256);
    const ceuTex = new THREE.CanvasTexture(cv); ceuTex.colorSpace = THREE.SRGBColorSpace;
    cena.background = ceuTex;
    cena.fog = new THREE.Fog(baixo, 28, 95);
    hemi.intensity = noite ? 1.25 : 1.6; sol.intensity = noite ? 1.0 : 2.2;
    hemi.groundColor.set(noite ? 0x221a2a : 0x557744);
    tocha.intensity = noite ? 60 : 0;
    st.noite = noite;
    // blocos (instanciados: um desenho por tipo de bloco, muitas cópias)
    st.blocosGrupo = new THREE.Group(); raizFase.add(st.blocosGrupo);
    montarBlocos(jogo);
    // cenário: chão de trás, enfeites, morros e nuvens
    const r = mulberry(1234 + fi * 77);
    const linhas = jogo.linhas, cols = jogo.colunas;
    const tops = [];
    for (let i = 0; i < cols; i++) {
      // o chão da coluna: de baixo para cima, o último bloco sólido grudado no fundo (o teto do castelo não conta)
      let jj = -1;
      for (let j = linhas - 1; j >= 0; j--) { const t = (spec.tiles || {})[jogo.mapa[j][i]]; if (t && t.solido && !t.mortal) { jj = j; } else { break; } }
      tops.push(jj);
    }
    const cont = {}; tops.forEach((j) => { if (j >= 0) { cont[j] = (cont[j] || 0) + 1; } });
    const jBase = Number(Object.keys(cont).sort((a, b) => cont[b] - cont[a])[0] || (linhas - 2));
    const yBase = -(jBase * T + dy) / T;
    st.yBase = yBase;
    const chao = new THREE.Mesh(new THREE.PlaneGeometry(cols + 120, 140), new THREE.MeshLambertMaterial({ color: cen.chao }));
    chao.rotation.x = -Math.PI / 2; chao.position.set(cols / 2, yBase - 0.02, -2.2 - 70);
    raizFase.add(chao);
    // enfeites atrás (escala pela altura pedida na biblioteca)
    const colocar = (id, x, y, z, esc, giro) => {
      const e = B.enfeites[id]; const mod = e && pronto(e.arquivo); if (!mod) { return null; }
      const o = mod.cena.clone(true);
      const k = (e.altura * (esc || 1)) / Math.max(mod.tam.y, 1e-6);
      const g = new THREE.Group(); o.position.set(-mod.centro.x, -mod.min.y, -mod.centro.z); g.add(o);
      g.scale.setScalar(k); g.position.set(x, y, z); g.rotation.y = giro || 0;
      if (e.onde === 'ceu') { o.traverse((m) => { if (m.isMesh) { m.material = new THREE.MeshBasicMaterial({ color: 0xFFFFFF, fog: false, transparent: true, opacity: 0.92 }); } }); }
      raizFase.add(g); return g;
    };
    for (let x = -6; x < cols + 8; x += 2 + r() * 3) {
      const id = cen.fundo[Math.floor(r() * cen.fundo.length)];
      colocar(id, x, yBase, -3.2 - r() * 9, 0.8 + r() * 0.6, r() * Math.PI * 2);
    }
    // gramas na frente, em cima do chão de verdade (só no campo e na floresta)
    if (cenId === 'campo' || cenId === 'floresta') {
      for (let i = 0; i < cols; i++) {
        if (tops[i] < 0 || r() < 0.55) { continue; }
        const t = (spec.tiles || {})[jogo.mapa[tops[i]][i]];
        if (!t || mp.blocos[jogo.mapa[tops[i]][i]] !== 'grama_3d') { continue; }
        colocar(r() < 0.5 ? 'grama_1' : 'grama_2', i + 0.2 + r() * 0.6, -(tops[i] * T + dy) / T, -1.1 - r() * 0.8, 0.7 + r() * 0.5, r() * 6);
      }
    }
    // morros ao longe
    const morroMat = new THREE.MeshLambertMaterial({ color: cen.morro });
    for (let x = -20; x < cols + 30; x += 12 + r() * 10) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 10), morroMat);
      m.scale.set(8 + r() * 10, 4 + r() * 7, 6); m.position.set(x, yBase - 1, -38 - r() * 20);
      raizFase.add(m);
    }
    if (cen.nuvens) {
      for (let x = -10; x < cols + 20; x += 9 + r() * 9) {
        colocar('nuvem_' + (1 + Math.floor(r() * 3)), x, yBase + 7 + r() * 6, -22 - r() * 18, 1.5 + r(), 0);
      }
    }
    if (cen.neve) { chao.material.color.set('#E8F0F6'); }
    // castelo: parede de tijolos ao fundo com tochas acesas
    if (cen.parede) {
      const tc = document.createElement('canvas'); tc.width = 128; tc.height = 64;
      const c2 = tc.getContext('2d'); c2.fillStyle = cen.parede; c2.fillRect(0, 0, 128, 64);
      c2.strokeStyle = 'rgba(0,0,0,.45)'; c2.lineWidth = 3;
      for (let yy = 0; yy <= 64; yy += 16) { c2.beginPath(); c2.moveTo(0, yy); c2.lineTo(128, yy); c2.stroke(); }
      for (let yy = 0; yy < 64; yy += 16) { for (let xx = (yy / 16) % 2 ? 16 : 0; xx <= 128; xx += 32) { c2.beginPath(); c2.moveTo(xx, yy); c2.lineTo(xx, yy + 16); c2.stroke(); } }
      const tex = new THREE.CanvasTexture(tc); tex.colorSpace = THREE.SRGBColorSpace; tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set((cols + 60) / 4, 6);
      const par = new THREE.Mesh(new THREE.PlaneGeometry(cols + 60, 24), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 }));
      par.position.set(cols / 2, yBase + 10, -9); raizFase.add(par);
      const fogo = new THREE.MeshBasicMaterial({ color: 0xFFB040, fog: false }), haste = new THREE.MeshLambertMaterial({ color: 0x5A3A22 });
      for (let x = 4; x < cols; x += 10) {
        const h1 = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.9, 6), haste); h1.position.set(x, yBase + 3, -8.8); raizFase.add(h1);
        const ch = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), fogo); ch.position.set(x, yBase + 3.6, -8.8); ch.scale.y = 1.5; raizFase.add(ch);
        (st.chamas = st.chamas || []).push(ch);
        if (x % 20 === 4) { const lz = new THREE.PointLight(0xFF9A40, 25, 12, 1.6); lz.position.set(x, yBase + 3.8, -7.5); raizFase.add(lz); }
      }
    }
    st.mapaVisto = jogo.mapa.map((l) => l.join(''));
  }

  // os blocos da fase: InstancedMesh por (tipo de bloco, parte, malha)
  function montarBlocos(jogo) {
    const B = BIB, mp = st.mp, T = st.T, dy = st.dy, spec = st.spec, tiles = spec.tiles || {};
    st.blocosGrupo.children.slice().forEach((c) => { st.blocosGrupo.remove(c); if (c.isInstancedMesh) { c.dispose(); } });
    st.cel = {};
    const grupos = new Map();   // chave → {pecas, cels:[{i,j,prof}]}
    const planos = [];          // tiles sem bloco 3D mas com desenho: viram um "papel" com o desenho da era
    const caixas = [];          // blocos procedurais (lava, água, gelo) e sólidos sem modelo
    for (let j = 0; j < jogo.linhas; j++) {
      for (let i = 0; i < jogo.colunas; i++) {
        const ch = jogo.mapa[j][i], td = tiles[ch];
        if (!td) { continue; }
        const bid = mp.blocos[ch], bl = bid && B.blocos[bid];
        const chaoFundo = td.solido && !td.mortal && !td.surpresa && !td.quebravel && !td.plataforma;
        const prof = bl && bl.fino ? 1 : (chaoFundo ? 2 : 1);
        if (bl && bl.topo) {
          const cima = j > 0 ? mp.blocos[jogo.mapa[j - 1][i]] : null;
          const arq = (cima === bid && bl.meio) ? bl.meio : bl.topo;
          const mod = pronto(arq);
          if (!mod) { continue; }
          const k = arq;
          if (!grupos.has(k)) { grupos.set(k, { pecas: pecasDoBloco(mod), cels: [] }); }
          grupos.get(k).cels.push({ i, j, prof, fino: !!bl.fino });
        } else if (bl && bl.procedural) {
          caixas.push({ i, j, prof, proc: bl.procedural });
        } else if (td.sprite && st.sprites[td.sprite]) {
          if (td.solido) { caixas.push({ i, j, prof, sprite: td.sprite }); } else { planos.push({ i, j, sprite: td.sprite }); }
        } else if (td.solido) {
          caixas.push({ i, j, prof, proc: { cor: td.cor || '#888888' } });
        }
      }
    }
    const M = new THREE.Matrix4(), S = new THREE.Matrix4();
    const matCel = (c) => {
      const h = c.fino ? 0.35 : 1;
      const y = -(c.j * T + dy) / T - (c.fino ? h / 2 : 0.5);
      return new THREE.Matrix4().compose(new THREE.Vector3(c.i + 0.5, y, -c.prof / 2), new THREE.Quaternion(), new THREE.Vector3(1, h, c.prof));
    };
    grupos.forEach((g) => {
      g.pecas.forEach((p) => {
        const im = new THREE.InstancedMesh(p.geo, p.mat, g.cels.length);
        g.cels.forEach((c, n) => {
          const base = matCel(c);
          M.multiplyMatrices(base, p.m); im.setMatrixAt(n, M);
          const k = c.i + ',' + c.j; (st.cel[k] = st.cel[k] || []).push({ im, n, base, p: p.m });
        });
        im.instanceMatrix.needsUpdate = true; im.frustumCulled = false;
        st.blocosGrupo.add(im);
      });
    });
    const geoCaixa = new THREE.BoxGeometry(1, 1, 1);
    st.lavas = [];
    caixas.forEach((c) => {
      let mat;
      if (c.sprite) {
        const tx = texSprite(st.sprites, c.sprite, 0);
        mat = new THREE.MeshLambertMaterial({ map: tx });
      } else {
        const liq = c.proc.liquido;
        mat = new THREE.MeshStandardMaterial({ color: c.proc.cor, emissive: liq ? new THREE.Color(c.proc.brilho || c.proc.cor) : 0x000000,
          emissiveIntensity: liq ? 0.6 : 0, roughness: liq ? 0.3 : 0.85, transparent: !!(liq && c.proc.cor === '#2E8BFF'), opacity: 0.85 });
        if (liq) { st.lavas.push(mat); }
        else if (c.proc.topo) {   // a face de cima mais clara (a ordem das faces da caixa: +x, -x, +y, -y, +z, -z)
          const topo = new THREE.MeshStandardMaterial({ color: c.proc.topo, roughness: 0.85 });
          mat = [mat, mat, topo, mat, mat, mat];
        }
      }
      const m = new THREE.Mesh(geoCaixa, mat);
      const base = matCel(c); m.applyMatrix4(base); m.matrixAutoUpdate = true;
      st.blocosGrupo.add(m);
      (st.cel[c.i + ',' + c.j] = st.cel[c.i + ',' + c.j] || []).push({ mesh: m, base });
    });
    planos.forEach((c) => {
      const sp = st.sprites[c.sprite], tx = texSprite(st.sprites, c.sprite, 0);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(sp.w / T, sp.h / T), new THREE.MeshBasicMaterial({ map: tx, transparent: true, alphaTest: 0.4 }));
      m.position.set(c.i + 0.5, -(c.j * T + dy) / T - 1 + sp.h / T / 2, -0.5);
      st.blocosGrupo.add(m);
    });
  }

  // ── personagens e itens ──
  function novoVisual(o, nome, ehHeroi) {
    const B = BIB, pid = st.mp.pers[nome], p = pid && B.personagens[pid], mod = p && pronto(p.arquivo);
    const aj = ajusteDe(st.spec, nome);
    const v = { raiz: new THREE.Group(), pid, p, mixer: null, acoes: {}, atual: null, plano: null, nome, aj };
    if (pid === 'voxel' && st.sprites[nome]) {
      // bloquinhos do próprio desenho (opção do Estúdio): a figura ganha volume
      v.vox = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshLambertMaterial({ vertexColors: true }));
      v.dz = Math.max(2, Math.min(8, aj.espessura || 4)); v.raiz.add(v.vox); v.spW = st.sprites[nome].w; v.spH = st.sprites[nome].h;
      raizObjs.add(v.raiz);
      return v;
    }
    if (mod) {
      const o3 = mod.pele ? cloneSkinned(mod.cena) : mod.cena.clone(true);
      if (p.clone) { vestirClone(o3, p.clone); }
      if (aj.cor && aj.cor !== 'original') { tingir(o3, aj.cor); }
      else if (p.cor) { tingir(o3, p.cor); }
      const piv = new THREE.Group(), ori = new THREE.Group(); o3.position.set(-mod.centro.x, -mod.min.y, -mod.centro.z);
      ori.rotation.y = (p.frente || 0) * Math.PI / 180; ori.add(o3); piv.add(ori);
      v.modelo = piv; v.tam = mod.tam; v.raiz.add(piv);
      if (mod.clipes.length && p.anims && Object.keys(p.anims).length) {
        v.mixer = new THREE.AnimationMixer(o3);
        Object.keys(p.anims).forEach((k) => { const c = THREE.AnimationClip.findByName(mod.clipes, p.anims[k]); if (c) { v.acoes[k] = v.mixer.clipAction(c); } });
      }
      // sombra redonda no chão
      const sombra = new THREE.Mesh(new THREE.CircleGeometry(0.5, 20), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false }));
      sombra.rotation.x = -Math.PI / 2; v.sombra = sombra; raizObjs.add(sombra);
    } else if (st.sprites[nome]) {
      // sem modelo 3D: um "papel" com o desenho da era (como os recortes de papel)
      const sp = st.sprites[nome];
      v.plano = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: texSprite(st.sprites, nome, 0), transparent: true, alphaTest: 0.4, side: THREE.DoubleSide }));
      v.plano.position.y = 0.5; v.raiz.add(v.plano); v.spW = sp.w; v.spH = sp.h;
    }
    raizObjs.add(v.raiz);
    return v;
  }
  function tocar(v, estado) {
    if (!v.mixer) { return; }
    const a = v.acoes[estado] || (estado === 'voa' && v.acoes.anda) || (estado === 'queda' && v.acoes.pulo) || v.acoes.parado || v.acoes.anda;
    if (!a || a === v.atual) { return; }
    a.reset(); a.setLoop(estado === 'morto' ? THREE.LoopOnce : THREE.LoopRepeat); a.clampWhenFinished = true;
    if (v.atual) { a.crossFadeFrom(v.atual, 0.15, false); }
    a.play(); v.atual = a;
  }
  // coloca um visual no lugar do corpo da simulação (pé no chão, centro do corpo)
  function posicionar(v, corpo, olhando, estado, mult, dt, quadro, extra) {
    const T = st.T, dy = st.dy;
    const x = (corpo.x + corpo.w / 2) / T, y = -(corpo.y + corpo.h + dy) / T;
    v.raiz.position.set(x, y, -0.5);
    if (v.modelo) {
      const p = v.p, alvoH = (corpo.h / T) * mult * (p.papel === 'fim' ? 1 : 1);
      let k = alvoH * (v.aj && v.aj.tamanho ? v.aj.tamanho : 1) / Math.max(v.tam.y, 1e-6);
      const larg = Math.max(v.tam.x, v.tam.z) * k, maxL = (corpo.w / T) * (p.papel === 'plataforma' ? 1.05 : 2.4);
      if (larg > maxL * (v.aj && v.aj.tamanho ? v.aj.tamanho : 1)) { k *= maxL * (v.aj && v.aj.tamanho ? v.aj.tamanho : 1) / larg; }
      v.modelo.scale.setScalar(k * (extra && extra.amassa ? 1 : 1));
      if (extra && extra.esticaY) { v.modelo.scale.y *= extra.esticaY; v.modelo.scale.x *= 1 / Math.sqrt(extra.esticaY); }
      const giro = (p.giro || 0) * Math.PI / 180;
      if (p.gira === 'y') { v.modelo.rotation.y = quadro * 0.06; }
      else if (p.gira === 'z') { v.modelo.rotation.z = -quadro * 0.15 * (olhando || 1); }
      else if (p.giro) {
        const fo = OLHAR[(v.aj && v.aj.olhar) || 'camera'];
        const alvo = olhando < 0 ? -giro * fo : giro * fo;   // um pouco virado para a câmera (ou de lado / de frente, no Estúdio)
        v.modelo.rotation.y += (alvo - v.modelo.rotation.y) * 0.35;
      }
      tocar(v, estado);
      if (v.mixer) { v.mixer.update(dt); }
      if (v.sombra) {
        const yc = chaoAbaixo(corpo);
        v.sombra.visible = yc !== null && v.raiz.visible;
        if (yc !== null) { const dist = Math.max(0, y - yc); v.sombra.position.set(x, yc + 0.02, -0.5); v.sombra.scale.setScalar(Math.max(0.2, (corpo.w / T) * 1.1 - dist * 0.08)); v.sombra.material.opacity = Math.max(0.05, 0.3 - dist * 0.04); }
      }
    } else if (v.vox) {
      const sp = st.sprites[v.nome], qn = (estado === 'anda' ? (quadro >> 3) : 0) % sp.quadros.length, tm = (v.aj && v.aj.tamanho) || 1;
      v.vox.geometry = voxelGeo(sp.quadros[qn], v.dz, v.nome + ':' + qn + ':' + v.dz);
      const sc = (corpo.w / sp.w) / T * tm, vira = olhando > 0 ? -1 : 1;
      v.vox.scale.set(sc * vira, sc, sc);
      v.vox.position.set(-vira * sp.w * sc / 2, sp.h * sc, -(v.dz * sc) / 2);
    } else if (v.plano) {
      v.plano.scale.set(v.spW / T * (olhando > 0 ? -1 : 1), v.spH / T, 1);
      v.plano.position.y = v.spH / T / 2;
      const q = estado === 'anda' ? (quadro >> 3) : 0, tx = texSprite(st.sprites, v.nome, q);
      if (v.plano.material.map !== tx) { v.plano.material.map = tx; v.plano.material.needsUpdate = true; }
    }
  }
  function chaoAbaixo(corpo) {
    const T = st.T, dy = st.dy, j0 = Math.max(0, Math.floor((corpo.y + corpo.h - 1) / T)), i = Math.floor((corpo.x + corpo.w / 2) / T), tiles = st.spec.tiles || {};
    for (let j = j0; j < st.linhas; j++) { const t = tiles[(st.mapaRef[j] || [])[i]]; if (t && (t.solido || t.plataforma)) { return -(j * T + dy) / T; } }
    return null;
  }
  function soltar(v) {
    raizObjs.remove(v.raiz); if (v.sombra) { raizObjs.remove(v.sombra); }
    if (v.mixer) { v.mixer.stopAllAction(); }
  }

  function quadro(jogo, sprites, est) {
    if (!st) { return; }
    const agora = performance.now(), dt = Math.min(0.05, (agora - antes) / 1000); antes = agora;
    const T = st.T, dy = st.dy, q = jogo.quadro;
    st.linhas = jogo.linhas; st.mapaRef = jogo.mapa;
    // mapa mudou? (bloco quebrou, surpresa virou usada, código mágico trocou um bloco)
    let mudou = false;
    for (let j = 0; j < jogo.linhas; j++) { if (jogo.mapa[j].join('') !== st.mapaVisto[j]) { mudou = true; break; } }
    if (mudou) { montarBlocos(jogo); st.mapaVisto = jogo.mapa.map((l) => l.join('')); }
    // bloco que balança quando o herói bate a cabeça
    const M = new THREE.Matrix4(), off = new THREE.Matrix4();
    (st.bumpsAntes || []).forEach((k) => { (st.cel[k] || []).forEach((c) => { if (c.im) { M.multiplyMatrices(c.base, c.p); c.im.setMatrixAt(c.n, M); c.im.instanceMatrix.needsUpdate = true; } else { c.mesh.position.setFromMatrixPosition(c.base); } }); });
    st.bumpsAntes = [];
    jogo.bumps.forEach((b) => {
      const k = b.i + ',' + b.j, sobe = Math.sin(b.t / 10 * Math.PI) * 0.35;
      off.makeTranslation(0, sobe, 0);
      (st.cel[k] || []).forEach((c) => { if (c.im) { M.multiplyMatrices(off, c.base).multiply(c.p); c.im.setMatrixAt(c.n, M); c.im.instanceMatrix.needsUpdate = true; } else { c.mesh.position.setFromMatrixPosition(c.base); c.mesh.position.y += sobe; } });
      st.bumpsAntes.push(k);
    });
    (st.lavas || []).forEach((m) => { m.emissiveIntensity = 0.5 + Math.sin(q / 14) * 0.2; });
    (st.chamas || []).forEach((c, k) => { c.scale.set(1 + Math.sin(q / 5 + k) * 0.12, 1.5 + Math.sin(q / 3 + k * 2) * 0.25, 1); });
    // objetos
    const vistos = new Set();
    jogo.objs.forEach((o) => {
      let v = st.objs.get(o);
      if (!o.vivo) {
        if (v) {
          if (!v.morrendo) { v.morrendo = 30; if (v.acoes.morto) { tocar(v, 'morto'); } }
          v.morrendo--;
          const k = v.morrendo / 30; v.raiz.scale.setScalar(Math.max(0.01, k)); if (v.mixer) { v.mixer.update(dt); }
          if (v.morrendo <= 0) { soltar(v); st.objs.delete(o); }
        }
        return;
      }
      vistos.add(o);
      let nome = o.def.sprite;
      if (o.casco && o.def.sprite_casco) { nome = o.def.sprite_casco; }
      if (!nome) { return; }
      if (!v || v.nome !== nome) { if (v) { soltar(v); } v = novoVisual(o, nome, false); st.objs.set(o, v); }
      const anda = Math.abs(o.vx || 0) > 0.05;
      const estado = o.pecas && o.pecas.voa ? 'voa' : (anda ? 'anda' : 'parado');
      const mult = v.p ? ({ heroi: 1.3, chefe: 1.15, fim: 1.0, item: 0.9, poder: 0.95, plataforma: 1, tiro: 1 }[v.p.papel] || 1.15) : 1;
      const corpo = o.tipo === 'coletavel' && !o.pecas ? { x: o.x, y: o.y + Math.sin((q + o.x) / 12) * 1.2, w: o.w, h: o.h } : o;
      posicionar(v, corpo, o.vx > 0 ? 1 : (o.vx < 0 ? -1 : (v.olhou || 1)), estado, mult, dt, q, o.casco ? { esticaY: 0.5 } : null);
      if (o.vx) { v.olhou = o.vx > 0 ? 1 : -1; }
      v.raiz.visible = !(o.ferido && (q >> 2) % 2);
    });
    st.objs.forEach((v, o) => { if (!vistos.has(o) && o.vivo) { soltar(v); st.objs.delete(o); } });
    // tiros: bolinhas (ou a bala de canhão)
    while (st.tiros.length > jogo.tiros.length) { raizObjs.remove(st.tiros.pop()); }
    jogo.tiros.forEach((t, n) => {
      let m = st.tiros[n];
      if (!m) {
        const mod = pronto(BIB.personagens.bala_canhao.arquivo);
        if (mod && !t.cor) { m = new THREE.Group(); const c = mod.cena.clone(true); c.position.set(-mod.centro.x, -mod.centro.y, -mod.centro.z); m.add(c); m.userData.esc = 1 / Math.max(mod.tam.x, mod.tam.y, 1e-6); }
        else { m = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 8), new THREE.MeshStandardMaterial({ color: t.cor || '#FCFCFC', emissive: new THREE.Color(t.cor || '#FCFCFC'), emissiveIntensity: 0.6 })); m.userData.esc = 1; }
        raizObjs.add(m); st.tiros[n] = m;
      }
      const s = Math.max(t.w, t.h) / T * 1.3 * m.userData.esc;
      m.scale.setScalar(s); m.position.set((t.x + t.w / 2) / T, -(t.y + t.h / 2 + dy) / T, -0.5); m.rotation.z -= 0.2;
    });
    // herói
    const h = jogo.heroi, sh = jogo.spriteDoHeroi();
    if (!st.heroi || st.heroi.nome !== sh.nome) { if (st.heroi) { soltar(st.heroi); } st.heroi = novoVisual(h, sh.nome, true); }
    const vh = st.heroi;
    let estH = h.morto ? 'morto' : (!h.chao ? 'pulo' : (Math.abs(h.vx) > 0.3 ? 'anda' : 'parado'));
    if (jogo.estado === 'fase_ok' || jogo.estado === 'vitoria') { estH = 'vitoria'; }
    posicionar(vh, h, h.olhando, estH, 1.3, dt, q, null);
    vh.raiz.visible = !(h.invuln && (q >> 2) % 2);
    if (vh.modelo) {
      const brilha = !!h.estrela;
      if (brilha !== vh.brilhando) {
        vh.modelo.traverse((m) => { if (m.isMesh && m.material && m.material.emissive) { if (!m.userData.matOrig) { m.userData.matOrig = m.material; m.material = m.material.clone(); } if (!brilha) { m.material = m.userData.matOrig; } } });
        vh.brilhando = brilha;
      }
      if (brilha) { const c = new THREE.Color().setHSL((q % 30) / 30, 0.9, 0.5); vh.modelo.traverse((m) => { if (m.isMesh && m.material && m.material.emissive) { m.material.emissive.copy(c); m.material.emissiveIntensity = 0.7; } }); }
    }
    // luz da tocha segue o herói nas fases escuras
    if (st.noite) { tocha.position.set(vh.raiz.position.x + 0.5, vh.raiz.position.y + 1.6, 1.2); }
    // câmera: o plano da frente (z = 0) bate com a tela do Phaser
    let tx = 0, ty = 0;
    if (jogo.tremor > 0) { tx = (Math.random() - 0.5) * 0.25; ty = (Math.random() - 0.5) * 0.25; }
    const xl = jogo.cam.x / T + tx, xr = (jogo.cam.x + W) / T + tx, yt = -jogo.cam.y / T + ty, yb = -(jogo.cam.y + H) / T + ty;
    const cx = (xl + xr) / 2, cy = (yt + yb) / 2 + ALTO, n = 0.5;
    cam.position.set(cx, cy, D); cam.rotation.set(0, 0, 0); cam.updateMatrixWorld(true);
    cam.projectionMatrix.makePerspective((xl - cx) * n / D, (xr - cx) * n / D, (yt - cy) * n / D, (yb - cy) * n / D, n, 400);
    cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
    sol.position.set(cx - 6, cy + 12, 10); sol.target.position.set(cx, cy - 6, -2); sol.target.updateMatrixWorld();
    render.render(cena, cam);
  }

  function desmontar() {
    while (raizFase.children.length) { raizFase.remove(raizFase.children[0]); }
    if (st) { st.objs.forEach((v) => soltar(v)); if (st.heroi) { soltar(st.heroi); } st.tiros.forEach((m) => raizObjs.remove(m)); }
    while (raizObjs.children.length) { raizObjs.remove(raizObjs.children[0]); }
    st = null;
  }

  return {
    tela, versao: VERSAO,
    // carrega o que a fase precisa; resolve quando dá para montar
    preparar: (spec, fi) => biblioteca().then((B) => marcarProntos(arquivosDa(spec, fi, B))),
    montar, quadro, desmontar,
    faseMontada: () => (st ? st.fi : null),
    destruir: () => { desmontar(); render.dispose(); if (tela.parentNode) { tela.parentNode.removeChild(tela); } },
  };
}

// ═══════════════════════ 🧊 PALCO 3D DOS GÊNEROS DA CASA (25/10/2026) ═══════════════════════
// Labirinto, aventura, travessia, nave, corrida, quebra-blocos, tiro fixo e esporte são vistos DE CIMA: o chão é a tela
// e as paredes sobem na direção da câmera. Briga de rua, quiz e RPG são vistos DE LADO, como a plataforma.
// O motor da casa desenha normalmente; o que seria desenho de bloco e de personagem é "gravado" e vira 3D aqui.
// O resto (placar, textos, bola, tiros) continua na tela de cima, que fica exatamente sobre o plano da frente (z = 0).
// Quem não tem modelo na biblioteca vira uma figura de bloquinhos (voxel) feita do PRÓPRIO desenho do jogo.
// Padrão (26/10): TODO gênero usa modelos da biblioteca; bloquinhos (voxel) só quando o jogo pede ("voxel" no spec.d3).
// A escolha automática olha o NOME do desenho (carro, nave, lobo, esqueleto...) e, se não reconhecer, o gênero.
const POR_NOME = [
  [/sapo|ra$|perereca|frog/, ['sapo_3d']], [/abelha/, ['abelha_3d']], [/vespa|mosca|morcego|bat|inseto/, ['vespa', 'abelha_3d']],
  [/aranha/, ['aranha', 'aranha_rainha']], [/cobra|serpente/, ['cobra', 'cobra_brava']], [/rato|camundongo/, ['rato_3d']], [/carangue|siri/, ['caranguejo']],
  [/t-?rex|tiranos/, ['trex']], [/raptor/, ['raptor']], [/tricera/, ['triceratops']], [/dino/, ['raptor', 'triceratops', 'estegossauro', 'trex']],
  [/lobo/, ['lobo']], [/raposa/, ['raposa']], [/cachorr|^cao|dog|husky/, ['cachorro']], [/cavalo|egua|potro/, ['cavalo']], [/vaca/, ['vaca']],
  [/touro|^boi/, ['touro']], [/cervo|veado|rena/, ['cervo']], [/lhama|alpaca/, ['alpaca']],
  [/esquelet|caveira|zumbi|morto_vivo/, ['esqueleto', 'esqueleto_guerreiro', 'esqueleto_ladino', 'esqueleto_mago']], [/fantasma/, ['esqueleto_mago']],
  [/bruxa|feiticeir/, ['pessoa_bruxa']], [/robo|androide|mech/, ['robo_george', 'robo_leela', 'robo_mike', 'robo_stan']], [/cavaleir/, ['cavaleiro_3d']],
  [/barbar|viking|guerreiro/, ['barbaro_3d']], [/mago|bruxo/, ['maga_3d']], [/ninja|ladr|ladin/, ['ladino_3d', 'ladino_capuz_3d']], [/rei$|^rei_|monarca/, ['pessoa_rei']],
  [/guerreira|princesa|rainha/, ['pessoa_guerreira']], [/menina|garota/, ['pessoa_menina']], [/menino|garoto|crianca/, ['pessoa_menino']],
  [/policia|guarda/, ['pessoa_policial']], [/astronaut/, ['pessoa_astronauta']], [/cientist/, ['pessoa_cientista']], [/punk|valent|bandid/, ['pessoa_punk', 'pessoa_punk2']],
  [/fazendeir/, ['pessoa_fazendeiro']], [/operari|pedreir/, ['pessoa_operario']], [/soldad/, ['pessoa_soldada']],
  [/ambulan/, ['ambulancia']], [/bombeir/, ['bombeiros']], [/viatura|policia/, ['policia']], [/taxi/, ['taxi']], [/trator/, ['trator']],
  [/caminh|onibus|bus/, ['caminhao', 'caminhao_lixo', 'entrega']], [/kart|moto/, ['kart_azul', 'kart_2']], [/van|furg/, ['van', 'entrega']], [/jipe|suv/, ['jipe']],
  [/carro|auto|veiculo|car$/, ['carro', 'carro_esporte', 'carro_hatch', 'taxi', 'policia', 'jipe', 'van']],
  [/navio|transatl/, ['navio', 'navio_pirata']], [/pirata/, ['navio_pirata']], [/veleiro/, ['veleiro']], [/barco|bote|canoa|jangada|tronco|balsa/, ['barquinho', 'bote', 'barco_viking', 'veleiro']],
  [/nave|foguete|ovni|disco|ship/, ['nave_bob', 'nave_dispatcher', 'nave_insurgente', 'nave_omen']],
  [/gema|joia|diam|cristal/, ['gema_azul_3d', 'gema_verde_3d', 'gema_rosa_3d']], [/moeda|ouro|coin/, ['moeda_3d']], [/estrela/, ['estrela_3d']], [/cora[cç]/, ['coracao_3d']],
  [/chave/, ['chave_3d']], [/bau|tesouro/, ['bau_3d']], [/bandeira|chegada/, ['bandeira_3d']], [/cogumelo/, ['cogumelo_3d']], [/fruta|maca|banana/, ['fruta']],
  [/bomba/, ['bomba_3d']], [/serra/, ['serra_3d']], [/canh/, ['canhao']], [/monstr|alien|gosma|slime|bicho/, ['monstrinho', 'monstro_rei']],
];
const HEROI_DO_GENERO = { labirinto: 'aventureiro_3d', aventura: 'cavaleiro_3d', rpg: 'cavaleiro_3d', briga_de_rua: 'pessoa_aventureiro', quiz: 'pessoa_menina',
  esporte: 'pessoa_menino', travessia: 'pessoa_menino', corrida: 'carro_corrida', nave: 'nave_striker', tiro_fixo: 'nave_spitfire', quebra_blocos: 'plataforma_3d' };
const INIMIGOS_DO_GENERO = {
  corrida: ['carro', 'taxi', 'policia', 'caminhao', 'van', 'jipe', 'carro_esporte'], travessia: ['carro', 'caminhao', 'taxi', 'van', 'policia', 'jipe'],
  nave: ['nave_bob', 'nave_dispatcher', 'nave_insurgente', 'nave_omen'], tiro_fixo: ['nave_bob', 'nave_omen', 'nave_dispatcher', 'nave_insurgente'],
  briga_de_rua: ['pessoa_punk', 'pessoa_punk2', 'pessoa_operario', 'robo_mike'], esporte: ['pessoa_punk', 'pessoa_policial', 'pessoa_soldada'],
  quiz: ['pessoa_bruxa', 'robo_stan'],
};
const INIMIGOS_PADRAO = ['esqueleto', 'esqueleto_guerreiro', 'monstrinho', 'aranha', 'rato_3d', 'esqueleto_ladino', 'cobra', 'sapo_3d', 'caranguejo', 'cobra_brava'];
const CHEFE_DO_GENERO = { nave: 'nave_chefe', tiro_fixo: 'nave_chefe', corrida: 'caminhao', travessia: 'caminhao', briga_de_rua: 'robo_george' };
export function porNome(nome, B) {
  const n = String(nome || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  for (const [re, lista] of POR_NOME) { if (re.test(n)) { return lista.filter((id) => B.personagens[id]); } }
  return null;
}
export function mapaPalco(spec, B) {
  registrarClones(spec, B);
  const P = B.personagens, ped = spec.d3 || {}, her = spec.heroi || {}, ents = spec.entidades || {}, g = spec.arquetipo;
  const ok = (id) => (id === 'voxel' ? 'voxel' : (id && P[id] ? id : null));
  const pers = {}, usados = {};
  const escolher = (lista, falta) => { const l = (lista || []).filter((x) => P[x]); return l.filter((x) => !usados[x])[0] || l[0] || falta; };
  const heroi = ok((ped.personagens || {})[her.sprite]) || ok(ped.heroi) || escolher(porNome(her.sprite, B), null) || HEROI_DO_GENERO[g] || 'aventureiro_3d';
  usados[heroi] = 1;
  [her.sprite, her.sprite_poder, her.sprite_grande].forEach((n) => { if (n) { pers[n] = heroi; } });
  Object.keys(ents).forEach((ch) => {
    const e = ents[ch] || {}, n = e.sprite;
    if (!n || pers[n]) { return; }
    let quer = ok((ped.personagens || {})[n]);
    if (!quer) {
      const pc = {}; (e.pecas || []).forEach((x) => { pc[x] = 1; });
      const nome = porNome(n, B);
      if (e.tipo === 'coletavel') { quer = escolher(nome && nome.some((x) => P[x].papel === 'item') ? nome : null, /gema|joia|diam/.test(n) ? 'gema_azul_3d' : 'moeda_3d'); }
      else if (e.tipo === 'poder') { quer = { crescer: 'cogumelo_3d', estrela: 'estrela_3d', vida: 'coracao_3d', pulo_duplo: 'raio' }[e.da] || escolher(nome, 'estrela_3d'); }
      else if (e.tipo === 'fim_de_fase') { quer = /bau|tesouro/.test(n) ? 'bau_3d' : 'bandeira_3d'; }
      else if (e.tipo === 'chave') { quer = 'chave_3d'; }
      else if (e.tipo === 'carona') { quer = escolher(nome && nome.some((x) => P[x].veiculo) ? nome : ['barquinho', 'bote', 'barco_viking', 'veleiro'], 'barquinho'); }
      else if (pc.chefe) { quer = CHEFE_DO_GENERO[g] && P[CHEFE_DO_GENERO[g]] ? CHEFE_DO_GENERO[g] : (nome ? escolher(nome) : (g === 'labirinto' ? 'aranha_rainha' : 'esqueleto_rei')); }
      else if (nome && !(INIMIGOS_DO_GENERO[g] && /^(alien|morcego|gosma|monstro|inimigo)/.test(n))) { quer = escolher(nome); }
      else if (INIMIGOS_DO_GENERO[g]) { quer = escolher(INIMIGOS_DO_GENERO[g]); }
      else if (pc.voa || /voa/.test(e.comportamento || '')) { quer = escolher(['abelha_3d', 'vespa']); }
      else { quer = escolher(INIMIGOS_PADRAO, 'monstrinho'); }
    }
    usados[quer] = 1; pers[n] = quer;
  });
  const heroiSprites = {}; [her.sprite, her.sprite_poder, her.sprite_grande].forEach((n) => { if (n) { heroiSprites[n] = 1; } });
  return { pers, heroi, heroiSprites, comModelo: true };
}

// figura de bloquinhos a partir de um quadro de sprite (só as faces que aparecem; cor de cada pixel)
const VOXEL = new Map();
function voxelGeo(cv, dz, chave) {
  if (VOXEL.has(chave)) { return VOXEL.get(chave); }
  const w = cv.width, h = cv.height, d = cv.getContext('2d').getImageData(0, 0, w, h).data;
  const pos = [], cor = [], nor = [], c = new THREE.Color();
  const cheio = (x, y) => x >= 0 && y >= 0 && x < w && y < h && d[(y * w + x) * 4 + 3] >= 128;
  const face = (v, n, r, g, b) => { for (const k of [0, 1, 2, 0, 2, 3]) { pos.push(...v[k]); nor.push(...n); cor.push(r, g, b); } };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!cheio(x, y)) { continue; }
      const i = (y * w + x) * 4;
      c.setRGB(d[i] / 255, d[i + 1] / 255, d[i + 2] / 255, THREE.SRGBColorSpace);
      const x0 = x, x1 = x + 1, y0 = -(y + 1), y1 = -y, z0 = 0, z1 = dz;
      const k = 0.82;   // laterais um pouco mais escuras: dá volume mesmo sem muita luz
      face([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [0, 0, 1], c.r, c.g, c.b);
      if (!cheio(x - 1, y)) { face([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], [-1, 0, 0], c.r * k, c.g * k, c.b * k); }
      if (!cheio(x + 1, y)) { face([[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], [1, 0, 0], c.r * k, c.g * k, c.b * k); }
      if (!cheio(x, y - 1)) { face([[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], [0, 1, 0], c.r * 0.95, c.g * 0.95, c.b * 0.95); }
      if (!cheio(x, y + 1)) { face([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], [0, -1, 0], c.r * 0.7, c.g * 0.7, c.b * 0.7); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(cor, 3));
  VOXEL.set(chave, g);
  return g;
}
// peças de um modelo parado (moeda, estrela...) com o pé na origem e 1 de altura — para instanciar
function pecasDoModelo(mod) {
  const g = new THREE.Group(), r = mod.cena.clone(true);
  r.position.set(-mod.centro.x, -mod.min.y, -mod.centro.z);
  g.add(r); g.scale.setScalar(1 / Math.max(mod.tam.y, 1e-6)); g.updateMatrixWorld(true);
  const pecas = [];
  r.traverse((o) => { if (o.isMesh) { pecas.push({ geo: o.geometry, mat: o.material, m: o.matrixWorld.clone() }); } });
  return { pecas, larg: Math.max(mod.tam.x, mod.tam.z) / Math.max(mod.tam.y, 1e-6) };
}

const RUMO_FIXO = { nave: [Math.PI, 0], tiro_fixo: [Math.PI, 0], corrida: [Math.PI, Math.PI] };
export function criarPalco(opts) {
  const W = opts.W, H = opts.H, Z = opts.Z, T = opts.T, spec = opts.spec, sprites = opts.sprites, cima = !!opts.cima;
  const render = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
  render.setPixelRatio(1); render.setSize(W * Z, H * Z, false);
  render.toneMapping = THREE.ACESFilmicToneMapping; render.toneMappingExposure = 1.05;
  const tela = render.domElement;
  tela.setAttribute('data-doc', 'Fliperama · estilo 3D (' + (cima ? 'visto de cima' : 'de lado') + ') · ' + spec.arquetipo + ' · Three.js');
  const cena = new THREE.Scene(), cam = new THREE.PerspectiveCamera(40, W / H, 0.5, 400);
  const hemi = new THREE.HemisphereLight(0xFFFFFF, 0x556655, 1.5), sol = new THREE.DirectionalLight(0xFFF4DD, 2.0);
  cena.add(hemi, sol, sol.target);
  const fundo = new THREE.Group(), blocos = new THREE.Group(), figuras = new THREE.Group();
  cena.add(fundo, blocos, figuras);
  const WT = W / T, HT = H / T;
  let mp = null, ceuVisto = null, antes = performance.now();
  const instTiles = new Map();     // caractere → InstancedMesh
  const poolVoxel = new Map();     // nome → [Mesh]
  const poolModelo = new Map();    // nome → [{raiz, mixer, acoes, atual, ...}]
  const instModelo = new Map();    // pid → {pecas:[InstancedMesh], cap, larg}
  const ultimo = new Map();        // nome:k → {x, y, dir}
  let reg = null;

  function papelDe(nome) {
    const pid = mp && mp.pers[nome];
    return pid || (sprites[nome] ? 'voxel' : null);
  }
  // ── o fundo: de cima, um chão com a cor da fase; de lado, céu, chão ao longe e enfeites do cenário ──
  function montarFundo(ceu) {
    while (fundo.children.length) { fundo.remove(fundo.children[0]); }
    const base = new THREE.Color(ceu || '#203040'), noite = escuro(ceu);
    hemi.intensity = noite ? 1.1 : 1.5; sol.intensity = noite ? 1.0 : 2.0;
    if (cima) {
      cena.background = base.clone().multiplyScalar(0.55);
      cena.fog = null;
      const tc = document.createElement('canvas'); tc.width = tc.height = 64;
      const x = tc.getContext('2d'); x.fillStyle = ceu || '#203040'; x.fillRect(0, 0, 64, 64);
      for (let k = 0; k < 140; k++) { x.fillStyle = 'rgba(' + (k % 2 ? '255,255,255' : '0,0,0') + ',0.05)'; x.fillRect((k * 37) % 64, (k * 53) % 64, 2, 2); }
      const tex = new THREE.CanvasTexture(tc); tex.colorSpace = THREE.SRGBColorSpace; tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(WT / 2, HT / 2);
      const chao = new THREE.Mesh(new THREE.PlaneGeometry(WT + 40, HT + 40), new THREE.MeshLambertMaterial({ map: tex }));
      chao.position.set(WT / 2, -HT / 2, -0.01); fundo.add(chao);
      return;
    }
    const cv = document.createElement('canvas'); cv.width = 4; cv.height = 256;
    const cx = cv.getContext('2d'), gr = cx.createLinearGradient(0, 0, 0, 256);
    gr.addColorStop(0, '#' + base.clone().multiplyScalar(noite ? 0.6 : 0.8).getHexString());
    gr.addColorStop(1, '#' + base.clone().lerp(new THREE.Color(0xFFFFFF), noite ? 0.08 : 0.4).getHexString());
    cx.fillStyle = gr; cx.fillRect(0, 0, 4, 256);
    const tx = new THREE.CanvasTexture(cv); tx.colorSpace = THREE.SRGBColorSpace; cena.background = tx;
    const cenId = (spec.d3 || {}).cenario && CENARIOS[(spec.d3 || {}).cenario] ? spec.d3.cenario : (noite ? 'castelo' : 'campo');
    const cen = CENARIOS[cenId];
    cena.fog = new THREE.Fog(base.clone().lerp(new THREE.Color(0xFFFFFF), 0.3), 26, 90);
    const chao = new THREE.Mesh(new THREE.PlaneGeometry(400, 120), new THREE.MeshLambertMaterial({ color: cen.chao }));
    chao.rotation.x = -Math.PI / 2; chao.position.set(WT / 2, -HT - 0.01, -60); fundo.add(chao);
    const r = mulberry(77), B = BIB;
    const deco = new THREE.Group(); deco.name = 'deco'; fundo.add(deco);
    for (let xx = -20; xx < 220 && false; xx += 2.5 + r() * 3) {   // (de lado, nos gêneros da casa o chão da frente é a rua/o palco: sem árvores na frente)
      const id = cen.fundo[Math.floor(r() * cen.fundo.length)], e = B.enfeites[id], mod = e && pronto(e.arquivo);
      if (!mod) { continue; }
      const o = mod.cena.clone(true), g = new THREE.Group();
      o.position.set(-mod.centro.x, -mod.min.y, -mod.centro.z); g.add(o);
      g.scale.setScalar(e.altura * (0.8 + r() * 0.6) / Math.max(mod.tam.y, 1e-6)); g.position.set(xx, -HT, -3 - r() * 10); g.rotation.y = r() * 6.28;
      deco.add(g);
    }
    const mm = new THREE.MeshLambertMaterial({ color: cen.morro });
    for (let xx = -30; xx < 240; xx += 12 + r() * 10) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10), mm); m.scale.set(8 + r() * 10, 4 + r() * 6, 6); m.position.set(xx, -HT - 1, -38 - r() * 20); deco.add(m);
    }
  }
  // ── blocos: um InstancedMesh por caractere, cor ou desenho do próprio bloco ──
  function instDoTile(ch, td) {
    if (instTiles.has(ch)) { return instTiles.get(ch); }
    let mat;
    if (td.sprite && sprites[td.sprite]) {
      const t = new THREE.CanvasTexture(sprites[td.sprite].quadros[0]); t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace;
      mat = new THREE.MeshLambertMaterial({ map: t });
    } else {
      const liq = td.mortal && !td.solido;
      mat = new THREE.MeshStandardMaterial({ color: td.cor || '#888888', roughness: liq ? 0.25 : 0.85, emissive: liq ? new THREE.Color(td.cor || '#2E8BFF') : 0x000000, emissiveIntensity: liq ? 0.35 : 0 });
    }
    const cap = Math.ceil(WT + 3) * Math.ceil(HT + 3);
    const im = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, cap);
    im.count = 0; im.frustumCulled = false; blocos.add(im); instTiles.set(ch, im);
    return im;
  }
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), S3 = new THREE.Vector3();
  function desenharTiles(lista) {
    instTiles.forEach((im) => { im.count = 0; });
    lista.forEach((t) => {
      const im = instDoTile(t.ch, t.td), x = (t.sx + t.w / 2) / T, y = -(t.sy + t.h / 2) / T, sw = t.w / T, sh = t.h / T;
      if (im.count >= im.instanceMatrix.count) { return; }
      if (cima) {
        const alto = t.td.solido ? (t.td.quebravel && spec.arquetipo === 'quebra_blocos' ? 0.45 : 0.7) : (t.td.mortal ? 0.02 : 0.03);
        const z = t.td.mortal && !t.td.solido ? -0.05 : 0;
        M.compose(V.set(x, y, z + alto / 2), Q.identity(), S3.set(sw * (t.td.solido ? 0.98 : 1.0), sh * (t.td.solido ? 0.98 : 1.0), alto));
      } else {
        const fundoT = !t.td.solido;
        M.compose(V.set(x, y, fundoT ? -1.6 : -0.5), Q.identity(), S3.set(sw, sh, fundoT ? 0.2 : 1));
      }
      im.setMatrixAt(im.count++, M);
    });
    instTiles.forEach((im) => { im.instanceMatrix.needsUpdate = true; });
  }
  // ── personagens ──
  function voxelMesh(nome, k) {
    let p = poolVoxel.get(nome); if (!p) { p = []; poolVoxel.set(nome, p); }
    if (!p[k]) { p[k] = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true })); p[k].frustumCulled = false; figuras.add(p[k]); }
    return p[k];
  }
  function modeloVis(nome, k, pid) {
    let p = poolModelo.get(nome); if (!p) { p = []; poolModelo.set(nome, p); }
    if (!p[k]) {
      const pp = BIB.personagens[pid], mod = pronto(pp.arquivo);
      if (!mod) { return null; }
      const o3 = mod.pele ? cloneSkinned(mod.cena) : mod.cena.clone(true);
      const aj = ajusteDe(spec, nome);
      if (pp.clone) { vestirClone(o3, pp.clone); }
      if (aj.cor && aj.cor !== 'original') { tingir(o3, aj.cor); } else if (pp.cor) { tingir(o3, pp.cor); }
      const piv = new THREE.Group(), ori = new THREE.Group(); o3.position.set(-mod.centro.x, -mod.min.y, -mod.centro.z);
      ori.rotation.y = (pp.frente || 0) * Math.PI / 180; ori.add(o3); piv.add(ori);
      piv.scale.setScalar(1 / Math.max(mod.tam.y, 1e-6));
      const raiz = new THREE.Group(), gira = new THREE.Group(); gira.add(piv); raiz.add(gira);
      if (cima) { gira.rotation.x = Math.PI / 2; }   // de cima: o "para cima" do modelo aponta para a câmera
      const v = { raiz, gira, piv, pp, larg: Math.max(mod.tam.x, mod.tam.z) / Math.max(mod.tam.y, 1e-6), mixer: null, acoes: {}, atual: null, ang: 0 };
      if (mod.clipes.length && pp.anims) {
        v.mixer = new THREE.AnimationMixer(o3);
        Object.keys(pp.anims).forEach((a) => { const c = THREE.AnimationClip.findByName(mod.clipes, pp.anims[a]); if (c) { v.acoes[a] = v.mixer.clipAction(c); } });
      }
      figuras.add(raiz); p[k] = v;
    }
    return p[k];
  }
  function tocar(v, estado) {
    if (!v.mixer) { return; }
    const a = v.acoes[estado] || (estado === 'voa' && v.acoes.anda) || v.acoes.parado || v.acoes.anda;
    if (!a || a === v.atual) { return; }
    a.reset(); a.play(); if (v.atual) { a.crossFadeFrom(v.atual, 0.15, false); }
    v.atual = a;
  }
  function desenharFiguras(lista, quadro, dt) {
    const usados = new Map();
    poolVoxel.forEach((p) => p.forEach((m) => { m.visible = false; }));
    poolModelo.forEach((p) => p.forEach((v) => { if (v) { v.raiz.visible = false; } }));
    instModelo.forEach((e) => e.ims.forEach((im) => { im.count = 0; }));
    lista.forEach((f) => {
      const k = usados.get(f.nome) || 0; usados.set(f.nome, k + 1);
      const papel = papelDe(f.nome), s = sprites[f.nome];
      if (!papel || !s) { return; }
      const chave = f.nome + ':' + k, ant = ultimo.get(chave);
      const cx = f.sx + f.w / 2, cy = cima ? f.sy + f.h / 2 : f.sy + f.h;
      const dx = ant ? cx - ant.x : 0, dy = ant ? cy - ant.y : 0, anda = Math.abs(dx) + Math.abs(dy) > 0.05;
      let dir = ant ? ant.dir : (f.virar ? 1 : -1);
      if (Math.abs(dx) > 0.05) { dir = dx > 0 ? 1 : -1; }
      let ang = ant ? ant.ang : 0;
      if (cima && anda) { ang = Math.atan2(dx, dy); }   // de cima: olha para onde anda (0 = para baixo, na direção da câmera)
      const fixo = RUMO_FIXO[spec.arquetipo];
      if (cima && fixo) { ang = mp.heroiSprites[f.nome] ? fixo[0] : fixo[1]; }
      ultimo.set(chave, { x: cx, y: cy, dir, ang });
      const pp = papel !== 'voxel' && BIB.personagens[papel], mod = pp && pronto(pp.arquivo);
      if (papel === 'voxel' || !mod) {
        const aj = ajusteDe(spec, f.nome), m = voxelMesh(f.nome, k), q = (f.q || 0) % s.quadros.length, dz = aj.espessura ? Math.max(2, Math.min(8, aj.espessura)) : (cima ? Math.max(2, Math.round(Math.min(s.w, s.h) / 3)) : 4);
        m.geometry = voxelGeo(s.quadros[q], dz, f.nome + ':' + q + ':' + dz);
        const tv = aj.tamanho || 1, sc = (f.w / s.w) / T * tv;   // tamanho do Estúdio: cresce a partir do pé (centro embaixo)
        const ox = (f.w * (1 - tv)) / 2 / T, oy = (cima ? (f.h * (1 - tv)) / 2 : f.h * (1 - tv)) / T;
        m.scale.set(f.virar ? -sc : sc, sc, sc);
        m.position.set((f.virar ? f.sx + f.w : f.sx) / T + (f.virar ? -ox : ox), -f.sy / T - oy, cima ? 0 : -0.5 - (dz * sc) / 2);
        m.material.opacity = f.alpha == null ? 1 : f.alpha;
        m.visible = true;
        return;
      }
      const mult = pp.veiculo ? 1 : ({ heroi: 1.35, chefe: 1.3, item: 0.85, poder: 0.9, fim: 1.6, plataforma: 0.6, tiro: 0.8 }[pp.papel] || 1.25);
      const ajF = ajusteDe(spec, f.nome), tam = ajF.tamanho || 1;
      let alto = (cima ? Math.max(f.w, f.h) * 1.5 : f.h) / T * mult * tam;   // de cima a altura quase não aparece: o modelo fica maior
      const temAnim = pp.anims && Object.keys(pp.anims).length;
      if (!mod.pele && !temAnim && !pp.veiculo && !pp.frente && pp.papel !== 'plataforma') {
        // parado e sem esqueleto (moeda, estrela, bandeira): instanciado — o labirinto pode ter centenas
        let e = instModelo.get(papel);
        if (!e) { const pm = pecasDoModelo(mod); e = { pm, ims: pm.pecas.map((p) => { const im = new THREE.InstancedMesh(p.geo, p.mat, 512); im.count = 0; im.frustumCulled = false; figuras.add(im); return im; }) }; instModelo.set(papel, e); }
        const lmax = (Math.max(f.w, f.h) / T) * 1.1;
        if (alto * e.pm.larg > lmax) { alto = lmax / e.pm.larg; }
        const giro = pp.gira === 'y' ? quadro * 0.06 : 0;
        const base = new THREE.Matrix4();
        if (cima) { base.compose(V.set(cx / T, -cy / T, 0), Q.setFromEuler(new THREE.Euler(Math.PI / 2, giro, 0, 'XYZ')), S3.set(alto, alto, alto)); }
        else { base.compose(V.set(cx / T, -cy / T, -0.5), Q.setFromEuler(new THREE.Euler(0, giro, 0)), S3.set(alto, alto, alto)); }
        e.ims.forEach((im, n) => { if (im.count < 512) { M.multiplyMatrices(base, e.pm.pecas[n].m); im.setMatrixAt(im.count++, M); } });
        return;
      }
      const v = modeloVis(f.nome, k, papel); if (!v) { return; }
      // veículo: o comprimento é o que manda (cabe no desenho); gente e bicho podem passar um pouco
      const lmax = (cima ? Math.max(f.w, f.h) : f.w) / T * (pp.veiculo || pp.papel === 'plataforma' ? 1.15 : 2.2);
      if (alto * v.larg > lmax * tam || pp.veiculo) { alto = lmax * tam / v.larg; }
      v.piv.scale.setScalar(alto / 1);
      v.piv.scale.multiplyScalar(1 / Math.max(pronto(pp.arquivo).tam.y, 1e-6));
      v.raiz.position.set(cx / T, -cy / T, cima ? 0 : -0.5);
      if (cima) { let da = ang - v.ang; while (da > Math.PI) { da -= 2 * Math.PI; } while (da < -Math.PI) { da += 2 * Math.PI; } v.ang += da * 0.35; v.raiz.rotation.z = v.ang; }
      else { const giro = (pp.giro || 0) * Math.PI / 180, alvo = (dir < 0 ? -giro : giro) * OLHAR[ajF.olhar || 'camera']; v.gira.rotation.y += (alvo - v.gira.rotation.y) * 0.35; }
      if (pp.gira === 'y') { v.gira.rotation.y = quadro * 0.06; }
      tocar(v, anda ? (pp.anims && pp.anims.voa ? 'voa' : 'anda') : 'parado');
      if (v.mixer) { v.mixer.update(dt); }
      v.raiz.visible = true;
    });
    instModelo.forEach((e) => e.ims.forEach((im) => { im.instanceMatrix.needsUpdate = true; }));
  }
  function camera(jogo) {
    // o plano da frente (z = 0) é exatamente a tela da casa: [0, W] × [0, H] em pixels da era
    const D = cima ? 16 : 15, xl = 0, xr = WT, yt = 0, yb = -HT, n = 0.5;
    const cx = WT / 2, cy = -HT / 2 + (cima ? -6.5 : 4.2);
    cam.position.set(cx, cy, D); cam.rotation.set(0, 0, 0); cam.updateMatrixWorld(true);
    cam.projectionMatrix.makePerspective((xl - cx) * n / D, (xr - cx) * n / D, (yt - cy) * n / D, (yb - cy) * n / D, n, 400);
    cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
    sol.position.set(cx - 5, cy + (cima ? 4 : 12), 14); sol.target.position.set(cx, -HT / 2, 0); sol.target.updateMatrixWorld();
    const deco = fundo.getObjectByName('deco');
    if (deco && jogo && jogo.cam) { deco.position.x = -(jogo.cam.x / T) * 0.5; }
  }

  return {
    tela, versao: VERSAO,
    preparar: () => biblioteca().then((B) => {
      mp = mapaPalco(spec, B);
      const arqs = new Set();
      Object.values(mp.pers).forEach((pid) => { const p = B.personagens[pid]; if (p) { arqs.add(p.arquivo); } });
      if (!cima) { Object.values(CENARIOS).forEach((c) => c.fundo.forEach((id) => { const e = B.enfeites[id]; if (e) { arqs.add(e.arquivo); } })); }
      return marcarProntos(Array.from(arqs));
    }),
    // grava o que o motor da casa desenharia neste quadro (em pixels da era, já na tela)
    comecar: () => {
      reg = { tiles: [], figuras: [] };
      return {
        sprite: (ctx, nome, x, y, q, virar) => {
          const s = sprites[nome]; if (!s) { return; }
          const m = ctx.getTransform(), sc = Math.hypot(m.a, m.b) / Z;
          reg.figuras.push({ nome, sx: (m.a * x + m.c * y + m.e) / Z, sy: (m.b * x + m.d * y + m.f) / Z, w: s.w * sc, h: s.h * sc, q: q || 0, virar: !!virar, alpha: ctx.globalAlpha });
        },
        tiles: (ctx, jogo) => {
          const tiles = spec.tiles || {}, m = ctx.getTransform(), cx = jogo.cam.x, cy = jogo.cam.y;
          const i0 = Math.max(0, Math.floor(cx / T)), i1 = Math.min(jogo.colunas - 1, Math.floor((cx + W) / T));
          const j0 = Math.max(0, Math.floor(cy / T)), j1 = Math.min(jogo.linhas - 1, Math.floor((cy + H) / T));
          for (let j = j0; j <= j1; j++) {
            for (let i = i0; i <= i1; i++) {
              const ch = jogo.mapa[j][i], td = tiles[ch]; if (!td) { continue; }
              reg.tiles.push({ ch, td, sx: (m.a * i * T + m.e) / Z, sy: (m.d * j * T + m.f) / Z, w: T * m.a / Z, h: T * m.d / Z });
            }
          }
        }
      };
    },
    desenhar: (jogo, ceu) => {
      if (!mp || !reg) { return; }
      const agora = performance.now(), dt = Math.min(0.05, (agora - antes) / 1000); antes = agora;
      const chaveCeu = ceu + ':' + jogo.faseIdx;
      if (chaveCeu !== ceuVisto) { montarFundo(ceu); ceuVisto = chaveCeu; }
      desenharTiles(reg.tiles);
      desenharFiguras(reg.figuras, jogo.quadro || 0, dt);
      camera(jogo);
      render.render(cena, cam);
    },
    destruir: () => { render.dispose(); if (tela.parentNode) { tela.parentNode.removeChild(tela); } },
  };
}

// ───────── 🎭 prévia do Estúdio de Personagens (26/10/2026): um modelo da biblioteca (ou os bloquinhos do desenho) girando ─────────
// mostrar({pid, aj, quadros: [canvas...], estado}) · estado('parado'|'anda'|'pulo'|'dano'|'vitoria'|'morto') · destruir()
export async function previa3D(host, opts) {
  opts = opts || {};
  const W = opts.w || 320, H = opts.h || 320;
  const B = await biblioteca();
  const render = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  render.setPixelRatio(Math.min(2, window.devicePixelRatio || 1)); render.setSize(W, H);
  render.toneMapping = THREE.ACESFilmicToneMapping; render.outputColorSpace = THREE.SRGBColorSpace;
  render.domElement.style.cssText = 'display:block;max-width:100%;touch-action:none;cursor:grab';
  host.innerHTML = ''; host.appendChild(render.domElement);
  const cena = new THREE.Scene();
  cena.add(new THREE.HemisphereLight(0xFFFFFF, 0x667766, 1.9));
  const sol = new THREE.DirectionalLight(0xFFF4E0, 2.2); sol.position.set(3, 6, 5); cena.add(sol);
  const chao = new THREE.Mesh(new THREE.CircleGeometry(0.9, 40), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.18 }));
  chao.rotation.x = -Math.PI / 2; cena.add(chao);
  const cam = new THREE.PerspectiveCamera(32, W / H, 0.05, 50); cam.position.set(0, 0.9, 3.4); cam.lookAt(0, 0.55, 0);
  const giro = new THREE.Group(); cena.add(giro);
  let mixer = null, acoes = {}, atual = null, ang = 0.5, arrastando = null, auto = true, pp = null, vivo = true, antes = performance.now();
  const el = render.domElement;
  el.addEventListener('pointerdown', (e) => { arrastando = e.clientX; auto = false; el.style.cursor = 'grabbing'; try { el.setPointerCapture(e.pointerId); } catch (x) {} });
  el.addEventListener('pointermove', (e) => { if (arrastando != null) { ang += (e.clientX - arrastando) * 0.012; arrastando = e.clientX; } });
  el.addEventListener('pointerup', () => { arrastando = null; el.style.cursor = 'grab'; });
  function tocarP(estado) {
    if (!mixer) { return; }
    const a = acoes[estado] || (estado === 'dano' && acoes.parado) || acoes.parado || acoes.anda;
    if (!a || a === atual) { return; }
    a.reset(); a.setLoop(estado === 'morto' ? THREE.LoopOnce : THREE.LoopRepeat); a.clampWhenFinished = true;
    if (atual) { a.crossFadeFrom(atual, 0.2, false); }
    a.play(); atual = a;
  }
  function laco() {
    if (!vivo) { return; }
    const agora = performance.now(), dt = Math.min(0.05, (agora - antes) / 1000); antes = agora;
    if (auto) { ang += dt * 0.5; }
    giro.rotation.y = ang;
    if (mixer) { mixer.update(dt); }
    if (pp && pp.gira === 'y') { giro.rotation.y = ang * 2; }
    render.render(cena, cam);
    requestAnimationFrame(laco);
  }
  requestAnimationFrame(laco);
  return {
    tela: el,
    async mostrar(o) {
      while (giro.children.length) { giro.remove(giro.children[0]); }
      mixer = null; acoes = {}; atual = null; pp = null;
      const aj = o.aj || {}, tam = Math.max(0.7, Math.min(1.5, aj.tamanho || 1));
      if (o.pid === 'voxel' || !o.pid) {
        const q = (o.quadros || [])[0]; if (!q) { return; }
        const dz = Math.max(2, Math.min(8, aj.espessura || 4)), geo = voxelGeo(q, dz, 'previa:' + (o.chave || '') + ':' + dz);
        const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
        const k = 1.2 * tam / Math.max(q.width, q.height);
        m.scale.set(k, k, k); m.position.set(-q.width * k / 2, q.height * k, -dz * k / 2);
        giro.add(m);
        if (o.quadros.length > 1) {   // os quadros do desenho em sequência
          let n = 0; const qs = o.quadros;
          mixer = { update: () => { n++; if (n % 14 === 0) { const qq = qs[(n / 14) % qs.length]; m.geometry = voxelGeo(qq, dz, 'previa:' + (o.chave || '') + ':' + ((n / 14) % qs.length) + ':' + dz); } } };
        }
        return;
      }
      pp = B.personagens[o.pid]; if (!pp) { return; }
      const mod = await carregar(pp.arquivo);
      const o3 = mod.pele ? cloneSkinned(mod.cena) : mod.cena.clone(true);
      if (pp.clone) { vestirClone(o3, pp.clone); }
      if (aj.cor && aj.cor !== 'original') { tingir(o3, aj.cor); } else if (pp.cor) { tingir(o3, pp.cor); }
      const piv = new THREE.Group(), ori = new THREE.Group();
      o3.position.set(-mod.centro.x, -mod.min.y, -mod.centro.z); ori.rotation.y = (pp.frente || 0) * Math.PI / 180; ori.add(o3); piv.add(ori);
      const alto = Math.max(mod.tam.y, 1e-6), larg = Math.max(mod.tam.x, mod.tam.z) / alto;
      const k = (larg > 1.3 ? 1.3 / larg : 1.15) * tam / alto;
      piv.scale.setScalar(k); giro.add(piv);
      if (mod.clipes.length && pp.anims) {
        mixer = new THREE.AnimationMixer(o3);
        Object.keys(pp.anims).forEach((a) => { const c = THREE.AnimationClip.findByName(mod.clipes, pp.anims[a]); if (c) { acoes[a] = mixer.clipAction(c); } });
        tocarP(o.estado || 'parado');
      }
    },
    animacoes() { return Object.keys(acoes); },
    estado(e) { tocarP(e); },
    girar(v) { auto = v !== false; },
    destruir() { vivo = false; render.dispose(); if (el.parentNode) { el.parentNode.removeChild(el); } },
  };
}
