#!/usr/bin/env node
/**
 * One-off patch for three drifted keys:
 *   - common:  error.unexpectedDetail
 *   - common:  header.caddylabs        (proper noun — stays as "CaddyLabs")
 *   - settings: general.caddylabsTagline
 *
 * Translations are inline because ANTHROPIC_API_KEY isn't available in this
 * environment. Only missing keys are written; existing translations are
 * preserved. Idempotent — safe to re-run.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const LOCALES = [
  'ar', 'de', 'es', 'fa', 'fr', 'he', 'hi', 'id', 'it', 'ja',
  'ko', 'nl', 'pl', 'pt-BR', 'ru', 'th', 'tr', 'uk', 'vi', 'zh-CN',
];

const TAGLINE = {
  ar:      'هذه أداة من CaddyLabs، صُنعت بحب ورموز في أيرلندا.',
  de:      'Ein CaddyLabs-Tool — mit Liebe und Tokens in Irland gemacht.',
  es:      'Una herramienta de CaddyLabs, hecha con amor y tokens en Irlanda.',
  fa:      'این ابزاری از CaddyLabs است که با عشق و توکن در ایرلند ساخته شده است.',
  fr:      'Un outil CaddyLabs, conçu avec amour et tokens en Irlande.',
  he:      'זהו כלי של CaddyLabs, נוצר באהבה וטוקנים באירלנד.',
  hi:      'यह एक CaddyLabs टूल है, जिसे प्यार और टोकन के साथ आयरलैंड में बनाया गया है।',
  id:      'Ini adalah alat CaddyLabs, dibuat dengan cinta dan token di Irlandia.',
  it:      'Uno strumento CaddyLabs, realizzato con amore e token in Irlanda.',
  ja:      'これはCaddyLabsのツールです。アイルランドで愛とトークンを込めて作られました。',
  ko:      'CaddyLabs의 도구입니다. 아일랜드에서 사랑과 토큰으로 만들었습니다.',
  nl:      'Een CaddyLabs-tool, met liefde en tokens gemaakt in Ierland.',
  pl:      'Narzędzie CaddyLabs — stworzone z miłością i tokenami w Irlandii.',
  'pt-BR': 'Uma ferramenta CaddyLabs, feita com amor e tokens na Irlanda.',
  ru:      'Это инструмент CaddyLabs, сделан с любовью и токенами в Ирландии.',
  th:      'นี่คือเครื่องมือของ CaddyLabs สร้างขึ้นด้วยความรักและโทเค็นในไอร์แลนด์',
  tr:      'Bir CaddyLabs aracı — İrlanda\'da sevgi ve token\'larla yapıldı.',
  uk:      'Це інструмент CaddyLabs, створений з любов\'ю та токенами в Ірландії.',
  vi:      'Đây là công cụ CaddyLabs, được tạo ra với tình yêu và token ở Ireland.',
  'zh-CN': '这是 CaddyLabs 的工具，在爱尔兰用爱与 Token 制成。',
};

const UNEXPECTED_ERROR = {
  ar:      'حدث خطأ غير متوقع.',
  de:      'Ein unerwarteter Fehler ist aufgetreten.',
  es:      'Ocurrió un error inesperado.',
  fa:      'خطای غیرمنتظره‌ای رخ داد.',
  fr:      'Une erreur inattendue s\'est produite.',
  he:      'אירעה שגיאה לא צפויה.',
  hi:      'एक अप्रत्याशित त्रुटि हुई।',
  id:      'Terjadi kesalahan yang tidak terduga.',
  it:      'Si è verificato un errore imprevisto.',
  ja:      '予期しないエラーが発生しました。',
  ko:      '예상치 못한 오류가 발생했습니다.',
  nl:      'Er is een onverwachte fout opgetreden.',
  pl:      'Wystąpił nieoczekiwany błąd.',
  'pt-BR': 'Ocorreu um erro inesperado.',
  ru:      'Произошла непредвиденная ошибка.',
  th:      'เกิดข้อผิดพลาดที่ไม่คาดคิด',
  tr:      'Beklenmedik bir hata oluştu.',
  uk:      'Сталася неочікувана помилка.',
  vi:      'Đã xảy ra lỗi không mong muốn.',
  'zh-CN': '发生了意外错误。',
};

let totalAdded = 0;

for (const locale of LOCALES) {
  // common.json — error.unexpectedDetail + header.caddylabs
  const commonPath = path.join(root, 'public/locales', locale, 'common.json');
  if (fs.existsSync(commonPath)) {
    const obj = JSON.parse(fs.readFileSync(commonPath, 'utf8'));
    let changed = false;
    if (!('error.unexpectedDetail' in obj)) {
      obj['error.unexpectedDetail'] = UNEXPECTED_ERROR[locale];
      changed = true; totalAdded++;
    }
    if (!('header.caddylabs' in obj)) {
      obj['header.caddylabs'] = 'CaddyLabs'; // proper noun — no translation
      changed = true; totalAdded++;
    }
    if (changed) {
      fs.writeFileSync(commonPath, JSON.stringify(obj, null, 2) + '\n', 'utf8');
      console.log(`  + ${locale}/common.json`);
    }
  }

  // settings.json — general.caddylabsTagline
  const settingsPath = path.join(root, 'public/locales', locale, 'settings.json');
  if (fs.existsSync(settingsPath)) {
    const obj = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    if (!('general.caddylabsTagline' in obj)) {
      obj['general.caddylabsTagline'] = TAGLINE[locale];
      fs.writeFileSync(settingsPath, JSON.stringify(obj, null, 2) + '\n', 'utf8');
      console.log(`  + ${locale}/settings.json`);
      totalAdded++;
    }
  }
}

console.log(`\nDone. ${totalAdded} keys added across ${LOCALES.length} locales.`);
