#!/usr/bin/env node
// VK autopost validation script (step [0] из VK_AUTOPOST_PLAN.md)
// Проверяет цепочки публикации ДО написания плагина.
// Требует Node 18+ (глобальные fetch / FormData / Blob).
//
// Токен берётся из переменной окружения VK_TOKEN (чтобы не светить в истории shell).
//
// Команды:
//   auth-url                         — печатает ссылку для получения Kate Mobile токена
//   probe                            — проверяет, что токен жив (users.get) + кто это
//   clip   <video> [--wallpost] [--group <id>]   — режим Clips/Both (shortVideo.create)
//   video  <video> [--publish]       [--group <id>]   — режим Video (video.save + wall.post)
//   delete <owner_id> <video_id>     — удалить тестовое видео/клип (cleanup)
//
// Примеры:
//   node scripts/vk-validate.mjs auth-url
//   VK_TOKEN=vk1.a... node scripts/vk-validate.mjs probe
//   VK_TOKEN=vk1.a... node scripts/vk-validate.mjs clip ./test_vertical.mp4 --wallpost
//   VK_TOKEN=vk1.a... node scripts/vk-validate.mjs delete 12345 67890

import { readFile, stat } from 'node:fs/promises';
import { basename } from 'node:path';

const API = 'https://api.vk.com/method';
const V = '5.199';
const SHORTVIDEO_V = '5.249'; // версия, на которой Клипы подтверждённо работают (репо H04X4/vk-clips)
// Публичные client_id (широко известны; для implicit-flow получения токена).
const VK_COM_CLIENT_ID = '6287487';      // ★ vk.com — браузерный flow + Клипы (shortVideo) + видео. ОСНОВНОЙ.
const KATE_CLIENT_ID = '2685278';        // Kate Mobile — video.save/wall.post, НО shortVideo скрыт
const VK_ADMIN_CLIENT_ID = '6121396';    // VK Admin — заблокирован (~апр 2026)
const VK_OFFICIAL_CLIENT_ID = '2274003'; // офиц. приложение VK — только direct-auth, браузером НЕ работает
// «Живой» User-Agent помогает upload-серверам VK (особенно shortVideo).
const UA = 'KateMobileAndroid/56 lite-460 (Android 11; SDK 30; arm64-v8a; Xiaomi; ru)';

const TOKEN = process.env.VK_TOKEN || '';

function die(msg) { console.error('\n❌ ' + msg + '\n'); process.exit(1); }

function parseFlags(argv) {
  const flags = {}; const pos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) { flags[key] = next; i++; }
      else flags[key] = true;
    } else pos.push(a);
  }
  return { flags, pos };
}

// Вызов метода VK API. Печатает полный ответ для отладки.
async function callApi(method, params = {}, version = V) {
  const body = new URLSearchParams({ ...params, access_token: TOKEN, v: version });
  const url = `${API}/${method}`;
  console.log(`\n→ ${method}  ${JSON.stringify(params)}  (v=${version})`);
  const res = await fetch(url, { method: 'POST', body });
  const json = await res.json();
  console.log(`← ${method}:`, JSON.stringify(json, null, 2));
  if (json.error) {
    die(`VK API error ${json.error.error_code}: ${json.error.error_msg}`);
  }
  return json.response;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Загрузка файла на upload_url (multipart). fieldName критичен — печатаем сырой ответ.
async function uploadFile(uploadUrl, filePath, fieldName) {
  const buf = await readFile(filePath);
  const fd = new FormData();
  fd.append(fieldName, new Blob([buf], { type: 'video/mp4' }), basename(filePath));
  console.log(`\n⇪ upload → ${uploadUrl.slice(0, 80)}...  (field="${fieldName}", ${buf.length} bytes)`);
  const res = await fetch(uploadUrl, { method: 'POST', body: fd, headers: { 'User-Agent': UA } });
  const text = await res.text();
  console.log(`⇪ upload HTTP ${res.status}:`, text.slice(0, 2000));
  if (res.status !== 200) {
    console.warn(`\n⚠️  upload вернул ${res.status}. Если 403 "Can't get file item containing data" —\n` +
      `   попробуй другое имя поля (--field video_file) — формат multipart у shortVideo капризный.`);
  }
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

async function ensureToken() {
  if (!TOKEN) die('Не задан VK_TOKEN. Сначала: node scripts/vk-validate.mjs auth-url');
}

async function ensureFile(p) {
  if (!p) die('Не указан путь к видеофайлу.');
  try { const s = await stat(p); return s.size; }
  catch { die(`Файл не найден: ${p}`); }
}

// ---------- команды ----------

function cmdAuthUrl(flags) {
  let clientId = VK_COM_CLIENT_ID, label = '★ vk.com (6287487) — Клипы + видео, браузерный flow. ОСНОВНОЙ.';
  if (flags.client) { clientId = String(flags.client); label = `custom client_id=${clientId}`; }
  else if (flags.kate) { clientId = KATE_CLIENT_ID; label = 'Kate Mobile — только обычное видео (без Клипов)'; }
  else if (flags.admin) { clientId = VK_ADMIN_CLIENT_ID; label = 'VK Admin — ⚠️ заблокирован (~апр 2026)'; }
  else if (flags.official) { clientId = VK_OFFICIAL_CLIENT_ID; label = 'VK официальное (2274003) — ⚠️ браузером НЕ работает (direct-auth)'; }
  const scope = 'video,wall,groups,photos,docs,offline';
  const url = `https://oauth.vk.com/authorize?client_id=${clientId}` +
    `&scope=${scope}&redirect_uri=https://oauth.vk.com/blank.html` +
    `&display=mobile&response_type=token&revoke=1&v=${V}`;
  console.log(`\n[${label}]`);
  console.log('\n1) Открой эту ссылку в браузере, залогинься в свой VK и разреши доступ:\n');
  console.log('   ' + url + '\n');
  console.log('2) После согласия браузер откроет страницу blank.html.');
  console.log('   В адресной строке будет:  https://oauth.vk.com/blank.html#access_token=vk1.a....&expires_in=0&user_id=...');
  console.log('3) Скопируй значение access_token (начинается с vk1.a...) — это твой постоянный токен.');
  console.log('   expires_in=0 = бессрочный (scope offline).\n');
  console.log('Дальше запускай команды так:');
  console.log('   VK_TOKEN=<твой_токен> node scripts/vk-validate.mjs probe\n');
  console.log('⚠️  Токен = полный доступ к аккаунту. Не коммить, не пересылай.');
}

async function cmdProbe() {
  await ensureToken();
  const me = await callApi('users.get', {});
  const u = me?.[0];
  if (u) console.log(`\n✅ Токен живой. Это: ${u.first_name} ${u.last_name} (id ${u.id}).`);
}

// Режим Clips / Both — полный flow shortVideo (create → upload → edit → publish).
// Воспроизводит проверенный рецепт из репо H04X4/vk-clips (нужен VK Admin токен!).
async function cmdClip(pos, flags) {
  await ensureToken();
  const video = pos[0];
  const size = await ensureFile(video);
  const wallpost = flags.wallpost ? '1' : '0';
  const field = flags.field || 'file';
  const group = flags.group ? String(flags.group) : null;
  const waitSec = flags.wait ? Number(flags.wait) : 80; // обработка ролика перед edit/publish

  console.log(`\n=== РЕЖИМ ${wallpost === '1' ? 'Both (Post + Reels)' : 'Clips (reels)'} ===`);
  console.log('ℹ️  ТОКЕН должен быть от vk.com (auth-url, дефолт). Kate Mobile тут даёт "Unknown method passed".');
  console.log('⚠️  Это РЕАЛЬНО опубликует клип. После проверки удали через delete + delete-post.');

  // 1) create
  const createP = { file_size: String(size) };
  if (group) createP.group_id = group;
  const created = await callApi('shortVideo.create', createP, SHORTVIDEO_V);
  if (!created?.upload_url) die('shortVideo.create не вернул upload_url.');

  // 2) upload (поле "file")
  const up = await uploadFile(created.upload_url, video, field);
  const ownerId = up?.owner_id ?? created.owner_id;
  const videoId = up?.video_id ?? created.video_id;

  // 3) ждём обработку
  console.log(`\n⏳ Жду обработку ролика ${waitSec} сек перед edit/publish...`);
  await sleep(waitSec * 1000);

  // 4) edit (описание + параметры)
  const editP = {
    video_id: String(videoId), owner_id: String(ownerId),
    description: flags.caption || 'test clip (validation)',
    privacy_view: 'all', can_make_duet: '1',
  };
  if (group) editP.group_id = group;
  await callApi('shortVideo.edit', editP, SHORTVIDEO_V);

  // 5) publish
  const pubP = {
    video_id: String(videoId), owner_id: String(ownerId),
    license_agree: '1', publish_date: '0', wallpost,
  };
  if (group) pubP.group_id = group;
  await callApi('shortVideo.publish', pubP, SHORTVIDEO_V);

  console.log('\n✅ Клип опубликован. Проверь:');
  console.log(`   Клипы:  https://vk.com/clip${ownerId}_${videoId}`);
  if (wallpost === '1') console.log('   Лента:  на стене должен быть пост с этим клипом.');
  console.log(`\n🧹 Удалить после проверки:\n   VK_TOKEN=$VK_TOKEN node scripts/vk-validate.mjs delete ${ownerId} ${videoId}`);
}

// Режим Video — video.save + upload + wall.post
async function cmdVideo(pos, flags) {
  await ensureToken();
  const video = pos[0];
  await ensureFile(video);
  const field = flags.field || 'video_file';

  console.log('\n=== РЕЖИМ Video (Post) ===');

  const params = { name: flags.name || 'test video (validation)', description: flags.caption || '', is_private: '1' };
  if (flags.group) params.group_id = String(flags.group);

  const saved = await callApi('video.save', params);
  if (!saved?.upload_url) die('video.save не вернул upload_url.');

  await uploadFile(saved.upload_url, video, field);

  const ownerId = saved.owner_id;
  const videoId = saved.video_id;
  console.log(`\n✅ Видео загружено (приватно): https://vk.com/video${ownerId}_${videoId}`);

  if (flags.publish) {
    console.log('\n⚠️  --publish: публикую пост на стену...');
    const wp = {
      owner_id: flags.group ? `-${flags.group}` : String(ownerId),
      message: flags.caption || '',
      attachments: `video${ownerId}_${videoId}`,
    };
    if (flags.group) wp.from_group = '1';
    const post = await callApi('wall.post', wp);
    console.log(`\n✅ Опубликовано: https://vk.com/wall${wp.owner_id}_${post.post_id}`);
    console.log(`\n🧹 Удалить пост:  wall.delete owner_id=${wp.owner_id} post_id=${post.post_id}`);
  } else {
    console.log('\nℹ️  Пост на стену НЕ делался (нет --publish). Видео лежит приватно.');
  }
  console.log(`\n🧹 Удалить видео:\n   VK_TOKEN=$VK_TOKEN node scripts/vk-validate.mjs delete ${ownerId} ${videoId}`);
}

async function cmdDelete(pos) {
  await ensureToken();
  const [ownerId, videoId] = pos;
  if (!ownerId || !videoId) die('Использование: delete <owner_id> <video_id>');
  await callApi('video.delete', { owner_id: String(ownerId), video_id: String(videoId) });
  console.log('\n✅ Видео удалено.');
}

async function cmdDeletePost(pos) {
  await ensureToken();
  const [ownerId, postId] = pos;
  if (!ownerId || !postId) die('Использование: delete-post <owner_id> <post_id>');
  await callApi('wall.delete', { owner_id: String(ownerId), post_id: String(postId) });
  console.log('\n✅ Пост удалён.');
}

// ---------- entry ----------
const [, , cmd, ...rest] = process.argv;
const { flags, pos } = parseFlags(rest);

switch (cmd) {
  case 'auth-url': cmdAuthUrl(flags); break;
  case 'probe':    await cmdProbe(); break;
  case 'clip':     await cmdClip(pos, flags); break;
  case 'video':    await cmdVideo(pos, flags); break;
  case 'delete':   await cmdDelete(pos); break;
  case 'delete-post': await cmdDeletePost(pos); break;
  default:
    console.log('Команды: auth-url [--official] | probe | clip <video> [--wallpost] [--group id] | video <video> [--publish] [--group id] | delete <owner_id> <video_id> | delete-post <owner_id> <post_id>');
    console.log('Подробности — в шапке файла scripts/vk-validate.mjs');
}
