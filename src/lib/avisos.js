// Avisos no celular (notificação do próprio app). O script da planilha cutuca
// o celular todo dia ao meio-dia quando há conta fixa vencendo; o service worker
// (public/sw.js) pergunta o texto e mostra. Aqui: ligar, desligar e testar.

import { api } from './api.js';

export function suportaAvisos() {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

/** iPhone só recebe aviso com o app instalado na tela inicial (iOS 16.4+). */
export function precisaInstalarNoIphone() {
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent || '');
  const instalado = window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
  return ios && !instalado;
}

const deBase64Url = (s) => {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
};
const mesmaChave = (buf, chave) => {
  if (!buf) return false;
  const a = new Uint8Array(buf), b = deBase64Url(chave);
  return a.length === b.length && a.every((x, i) => x === b[i]);
};

function nomeDoAparelho() {
  const ua = navigator.userAgent || '';
  if (/iphone/i.test(ua)) return 'iPhone';
  if (/android/i.test(ua)) return 'Android';
  if (/windows/i.test(ua)) return 'Windows';
  if (/mac os/i.test(ua)) return 'Mac';
  return 'Navegador';
}

/** O service worker do app (sem ele não há aviso). Não espera para sempre. */
async function registro() {
  const reg = await Promise.race([
    navigator.serviceWorker.ready,
    new Promise((ok) => setTimeout(() => ok(null), 4000))
  ]);
  if (!reg) throw new Error('sem_service_worker');
  return reg;
}

/** 'sem_suporte' | 'instalar' | 'negado' | 'ligado' | 'desligado' */
export async function estadoDosAvisos() {
  if (!suportaAvisos()) return precisaInstalarNoIphone() ? 'instalar' : 'sem_suporte';
  if (Notification.permission === 'denied') return 'negado';
  try {
    const sub = await (await registro()).pushManager.getSubscription();
    return sub && Notification.permission === 'granted' ? 'ligado' : 'desligado';
  } catch (e) {
    return e?.message === 'sem_service_worker' ? 'sem_suporte' : 'desligado';
  }
}

export async function ligarAvisos(pessoa) {
  const permissao = await Notification.requestPermission();
  if (permissao !== 'granted') return { ok: false, erro: 'negado' };
  const v = await api.vapid();
  if (!v.ok) return v;
  const reg = await registro();
  let sub = await reg.pushManager.getSubscription();
  if (sub && !mesmaChave(sub.options?.applicationServerKey, v.chave)) { await sub.unsubscribe(); sub = null; }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: deBase64Url(v.chave) });
  return api.inscrever(sub.toJSON(), pessoa, nomeDoAparelho());
}

export async function desligarAvisos() {
  const sub = await (await registro()).pushManager.getSubscription();
  if (!sub) return { ok: true };
  const r = await api.desinscrever(sub.endpoint);
  await sub.unsubscribe().catch(() => {});
  return r.ok ? r : { ok: true };
}

export async function testarAviso() {
  const sub = await (await registro()).pushManager.getSubscription();
  if (!sub) return { ok: false, erro: 'nao_inscrito' };
  return api.testarAviso(sub.endpoint);
}
