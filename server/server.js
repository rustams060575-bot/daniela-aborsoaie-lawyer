// Мини-бэкенд без зависимостей (Node 18+): статика сайта + POST /api/chat
// Запуск:  node server/server.mjs   (ключи — в server/.env, см. .env.example)
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const SITE = resolve(here, '..');

// простейший загрузчик .env: server/.env, затем .env в корне проекта (над папкой site/)
for (const envFile of [join(here, '.env'), join(SITE, '..', '.env')]) {
  if (!existsSync(envFile)) continue;
  for (const l of readFileSync(envFile, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const {
  ANTHROPIC_API_KEY, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID,
  CLAUDE_MODEL = 'claude-sonnet-5-5', PORT = 8765
} = process.env;

const SYSTEM = `Eres el asistente virtual de la abogada Daniela Monalisa Aborsoaie en Alicante. Tu misión es recibir a los clientes con máxima empatía, calma y profesionalismo (estilo Silent Luxury).
REGLAS DE ORO:
1. Empatía y serenidad: Escucha al cliente, valida su preocupación de manera humana.
2. NINGÚN diagnóstico legal definitivo: Explica marcos generales (inmuebles, contratos, extranjería, derecho civil/penal en España), pero aclara siempre que la estrategia final la diseña Daniela personalmente.
3. Regla de 1 pregunta: Responde de forma concisa y haz ESTRICTAMENTE UNA sola pregunta de seguimiento por mensaje para no abrumar al usuario.
4. Idioma dinámico: Responde siempre en el idioma en el que te habla el usuario (español, inglés, ruso, etc.).
5. Captura de Lead: Cuando entiendas el problema principal, sugiere amablemente coordinar una revisión con Daniela y solicita su nombre y teléfono/email para que ella estudie su caso.
6. Herramienta submit_lead: Tan pronto como el usuario proporcione su contacto, utiliza la herramienta submit_lead para enviar el resumen a Telegram.
Notas técnicas: llama a submit_lead una sola vez y nunca inventes ni supongas un contacto; después de enviarla, confirma con calidez que Daniela leerá el caso personalmente.`;

const HANDOFF_BTN = { es: 'Transmitir a Daniela', en: 'Pass to Daniela', ru: 'Передать Daniela', ro: 'Transmite Danielei' };

const TOOLS = [{
  name: 'submit_lead',
  description: 'Envía la solicitud a la abogada (Telegram). Llamar solo cuando el usuario haya facilitado un teléfono o correo.',
  input_schema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Nombre del usuario, si lo dio' },
      contact: { type: 'string', description: 'Teléfono o correo facilitado por el usuario' },
      topic: { type: 'string', description: 'Área: penal, civil, familia, empresa, inmuebles, contratos u otra' },
      summary: { type: 'string', description: 'Resumen del asunto en español, 2-4 frases' },
      urgent: { type: 'boolean', description: 'true si hay plazos inminentes, detención o citación' }
    },
    required: ['contact', 'summary']
  }
}];

// ── лимиты ──
const MAX_BODY = 90_000, MAX_MSG = 1500, MAX_TURNS = 30;
const hits = new Map(); // ip → [timestamps]
const limited = ip => {
  const now = Date.now(), arr = (hits.get(ip) || []).filter(t => now - t < 60_000);
  arr.push(now); hits.set(ip, arr);
  return arr.length > 12;
};
setInterval(() => { const n = Date.now(); for (const [k, v] of hits) if (!v.some(t => n - t < 60_000)) hits.delete(k); }, 120_000).unref();

const clean = (s, n) => String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, n);

async function callClaude(messages, lang) {
  const r = await fetch((process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com') + '/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: 500, system: `${SYSTEM}\nIdioma de la interfaz del usuario: ${lang}.`, tools: TOOLS, messages }),
    signal: AbortSignal.timeout(30_000)
  });
  if (!r.ok) throw new Error(`Claude ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}
const textOf = j => (j.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();

// Заявка уходит в Telegram прямо при вызове submit_lead (onLead). Агент получает результат доставки
// и подтверждает клиенту отправку только если Telegram реально принял сообщение.
async function askClaude(messages, lang, onLead) {
  let j = await callClaude(messages, lang);
  let delivered = false;
  for (let i = 0; i < 2 && j.stop_reason === 'tool_use'; i++) {
    const results = [];
    for (const b of j.content.filter(x => x.type === 'tool_use')) {
      const inp = b.input || {};
      const contact = clean(inp.contact, 120);
      if (b.name !== 'submit_lead' || contact.length < 5) {
        results.push({ type: 'tool_result', tool_use_id: b.id, is_error: true, content: 'Falta un teléfono o correo válido. Pídelo al usuario.' });
        continue;
      }
      if (delivered) { results.push({ type: 'tool_result', tool_use_id: b.id, content: 'Ya enviada.' }); continue; }
      const ok = await onLead({
        name: clean(inp.name, 80), contact, topic: clean(inp.topic, 40),
        summary: clean(inp.summary, 800), urgent: !!inp.urgent
      }).catch(e => (console.error('submit_lead:', e.message), false));
      delivered = delivered || ok;
      results.push(ok
        ? { type: 'tool_result', tool_use_id: b.id, content: 'Solicitud entregada a Daniela. Confirma al usuario con calidez.' }
        : { type: 'tool_result', tool_use_id: b.id, is_error: true, content: 'No se pudo entregar la solicitud por un fallo técnico. NO digas que se envió: discúlpate brevemente y pide al usuario que pulse el botón «' + (HANDOFF_BTN[lang] || HANDOFF_BTN.es) + '» (debajo del chat) o lo intente de nuevo en un momento.' });
    }
    messages = [...messages, { role: 'assistant', content: j.content }, { role: 'user', content: results }];
    j = await callClaude(messages, lang);
  }
  return { text: textOf(j), lead: delivered };
}

async function sendTelegramChunk(text) {
  let err;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(`${process.env.TELEGRAM_API_BASE || 'https://api.telegram.org'}/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text, disable_web_page_preview: true }),
        signal: AbortSignal.timeout(10_000)
      });
      if (r.ok) return;
      const j = await r.json().catch(() => ({}));
      err = new Error(`Telegram ${r.status}: ${j.description || ''}`);
      if (r.status !== 429 && r.status < 500) break; // 400/401/403 — повторять бессмысленно
      await new Promise(res => setTimeout(res, (j.parameters?.retry_after || i + 1) * 1000));
    } catch (e) { err = e; await new Promise(res => setTimeout(res, 700 * (i + 1))); }
  }
  throw err;
}
// Telegram режет сообщения на 4096 символах: длинный текст отправляем частями по границам строк
async function notifyTelegram(text) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return false;
  const parts = []; let cur = '';
  for (const line of text.split('\n')) {
    const l = line.slice(0, 3500);
    if ((cur + '\n' + l).length > 3800) { parts.push(cur); cur = l; } else cur = cur ? cur + '\n' + l : l;
  }
  if (cur) parts.push(cur);
  for (let i = 0; i < parts.length; i++) await sendTelegramChunk(parts.length > 1 ? `(${i + 1}/${parts.length})\n${parts[i]}` : parts[i]);
  return true;
}

const LANG_NAMES = { es: 'Español', en: 'English', ru: 'Русский', ro: 'Română' };
const fmtDialog = history => history.map(m => (m.role === 'user' ? '👤 Клиент: ' : '🤖 Агент: ') + m.content).join('\n');
const fmtTime = () => new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Madrid' }).format(new Date());
// Единый формат заявки для Даниэлы
function formatLead({ title, urgent, sid, lang, name, contact, topic, summary, history }) {
  return [
    `📨 ${title}`,
    urgent ? '🔴 СРОЧНО' : '',
    `Имя: ${name || '—'}`,
    `Контакт: ${contact}`,
    `Язык интерфейса: ${LANG_NAMES[lang] || lang}`,
    `Тема: ${topic || '—'}`,
    `Сессия: ${sid} · ${fmtTime()} (Аликанте)`,
    '',
    `Суть обращения: ${summary || '— (не указана; см. переписку)'}`,
    '',
    '— Полный диалог —',
    fmtDialog(history)
  ].filter((l, i) => l !== '' || i > 0).join('\n');
}

async function handleChat(body) {
  const lang = ['es', 'en', 'ru', 'ro'].includes(body.lang) ? body.lang : 'es';
  const sid = clean(body.sid, 24) || '—';
  const topic = clean(body.topic, 40), name = clean(body.name, 80), contact = clean(body.contact, 120);
  const history = (Array.isArray(body.messages) ? body.messages : []).slice(-MAX_TURNS)
    .map(m => ({ role: m?.role === 'assistant' ? 'assistant' : 'user', content: clean(m?.content, MAX_MSG) }))
    .filter(m => m.content);
  while (history.length && history[0].role !== 'user') history.shift();
  if (!history.length || history[history.length - 1].role !== 'user') return [400, { error: 'bad_request' }];

  const head = `[${sid}] ${lang.toUpperCase()}${topic ? ' · ' + topic : ''}${name ? ' · ' + name : ''}`;

  // Передача заявки адвокату: только Telegram (без Claude), с перепиской
  if (body.handoff) {
    if (contact.length < 5) return [400, { error: 'contact_required' }];
    const sent = await notifyTelegram(formatLead({
      title: 'Заявка с сайта (кнопка «Передать»)', urgent: !!body.urgent || topic === 'ur', sid, lang, name, contact, topic,
      summary: history.filter(m => m.role === 'user').map(m => m.content).join(' / ').slice(0, 500), history
    })).catch(e => (console.error(e.message), false));
    return sent ? [200, { ok: true }] : [502, { error: 'notify_failed' }];
  }

  // Обычное сообщение: ответ Claude + уведомление в Telegram параллельно
  const last = history[history.length - 1].content;
  const [reply, tg] = await Promise.allSettled([
    askClaude(history, lang, lead => {
      if (sentLeads.has(sid + '|' + lead.contact)) return Promise.resolve(true); // дубль в рамках сессии не шлём
      return notifyTelegram(formatLead({
        title: 'Заявка с сайта (оформил AI-агент)', urgent: lead.urgent || topic === 'ur', sid, lang,
        name: lead.name || name, contact: lead.contact, topic: lead.topic || topic, summary: lead.summary, history
      })).then(() => { sentLeads.add(sid + '|' + lead.contact); return true; });
    }),
    notifyTelegram(`💬 Сообщение с сайта\n${head}\n\n${last}`)
  ]);
  if (tg.status === 'rejected') console.error(tg.reason.message);
  if (reply.status === 'rejected') { console.error(reply.reason.message); return [502, { error: 'ai_unavailable' }]; }
  const { text, lead } = reply.value;
  const leadSent = lead;
  return [200, { reply: text || '…', lead: leadSent }];
}

const sentLeads = new Set();

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.jpg': 'image/jpeg', '.png': 'image/png', '.mp3': 'audio/mpeg', '.mp4': 'video/mp4', '.svg': 'image/svg+xml', '.json': 'application/json' };

http.createServer(async (req, res) => {
  const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(obj)); };
  try {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/api/chat') {
      if (req.method !== 'POST') return send(405, { error: 'method' });
      if (limited(req.socket.remoteAddress || '')) return send(429, { error: 'rate_limited' });
      if (!ANTHROPIC_API_KEY) return send(503, { error: 'not_configured' });
      let raw = '';
      for await (const c of req) { raw += c; if (raw.length > MAX_BODY) return send(413, { error: 'too_large' }); }
      let body; try { body = JSON.parse(raw); } catch { return send(400, { error: 'bad_json' }); }
      const [code, out] = await handleChat(body);
      return send(code, out);
    }
    // статика (без server/, tools/, dot-файлов)
    const rel = normalize(decodeURIComponent(url.pathname)).replace(/^[/\\]+/, '') || 'index.html';
    const file = resolve(SITE, rel);
    const parts = rel.split(sep);
    if (!file.startsWith(SITE + sep) || parts.some(p => p.startsWith('.')) || ['server', 'tools'].includes(parts[0])) {
      res.writeHead(404); return res.end('Not found');
    }
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch (e) {
    if (e.code === 'ENOENT' || e.code === 'EISDIR') { res.writeHead(404); return res.end('Not found'); }
    console.error(e); send(500, { error: 'server' });
  }
}).listen(PORT, () => {
  console.log(`Сайт + /api/chat: http://127.0.0.1:${PORT}/index.html`);
  console.log(`Ключи: ANTHROPIC=${ANTHROPIC_API_KEY ? 'ok' : 'НЕТ'} · TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN ? 'ok' : 'НЕТ'} · TELEGRAM_CHAT_ID=${TELEGRAM_CHAT_ID ? 'ok' : 'НЕТ'}`);
  if (TELEGRAM_BOT_TOKEN) fetch(`${process.env.TELEGRAM_API_BASE || 'https://api.telegram.org'}/bot${TELEGRAM_BOT_TOKEN}/getMe`, { signal: AbortSignal.timeout(8000) })
    .then(r => r.json()).then(j => console.log(j.ok ? `Telegram-бот: @${j.result.username} — подключён` : 'Telegram: токен отклонён (' + j.description + ')'))
    .catch(e => console.log('Telegram: нет связи (' + e.message + ')'));
});
