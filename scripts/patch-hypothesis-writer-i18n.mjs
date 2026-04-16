#!/usr/bin/env node
/**
 * One-off patch for the Hypothesis Writer profile name + description across
 * the 19 non-English locales. ANTHROPIC_API_KEY isn't available so
 * translations are inline. Idempotent.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const NAME = {
  ar: 'كاتب الفرضيات',
  de: 'Hypothesenautor',
  es: 'Redactor de Hipótesis',
  fa: 'نویسنده فرضیه',
  fr: 'Rédacteur d\'Hypothèses',
  he: 'כותב השערות',
  hi: 'परिकल्पना लेखक',
  id: 'Penulis Hipotesis',
  it: 'Autore di Ipotesi',
  ja: '仮説ライター',
  ko: '가설 작성자',
  nl: 'Hypotheseschrijver',
  pl: 'Autor Hipotez',
  'pt-BR': 'Redator de Hipóteses',
  ru: 'Автор гипотез',
  th: 'ผู้เขียนสมมติฐาน',
  tr: 'Hipotez Yazarı',
  uk: 'Автор гіпотез',
  vi: 'Người Viết Giả Thuyết',
  'zh-CN': '假设作者',
};

const DESCRIPTION = {
  ar: 'يولّد نظريات عمل قابلة للتفنيد للقضية — ادعاء، أدلة (مع/ضد)، ثقة، كيفية الاختبار — كملاحظات منظمة.',
  de: 'Erstellt falsifizierbare Arbeitshypothesen zum Fall — Behauptung, Beweise (für/gegen), Vertrauen, Testmethode — als strukturierte Notizen.',
  es: 'Genera teorías de trabajo falsables del caso — afirmación, evidencia (a favor/en contra), confianza, cómo probar — como notas estructuradas.',
  fa: 'نظریه‌های کاری ابطال‌پذیری از پرونده تولید می‌کند — ادعا، شواهد (له/علیه)، اعتماد، نحوه آزمایش — به‌صورت یادداشت‌های ساختاریافته.',
  fr: 'Génère des théories de travail falsifiables sur l\'affaire — affirmation, preuves (pour/contre), confiance, méthode de test — sous forme de notes structurées.',
  he: 'מייצר תיאוריות עבודה הניתנות להפרכה לגבי המקרה — טענה, ראיות (בעד/נגד), ביטחון, כיצד לבדוק — כהערות מובנות.',
  hi: 'मामले की मिथ्याकरणीय कार्यशील सिद्धांत उत्पन्न करता है — दावा, प्रमाण (पक्ष/विपक्ष), विश्वास, परीक्षण कैसे करें — संरचित नोट्स के रूप में।',
  id: 'Menghasilkan teori kerja yang dapat difalsifikasi dari kasus — klaim, bukti (mendukung/menentang), kepercayaan, cara menguji — sebagai catatan terstruktur.',
  it: 'Genera teorie di lavoro falsificabili del caso — affermazione, prove (a favore/contro), confidenza, come testare — come note strutturate.',
  ja: '事件に関する反証可能な作業仮説を生成します — 主張、証拠（賛成/反対）、信頼度、検証方法 — 構造化されたノートとして。',
  ko: '사건에 대한 반증 가능한 작업 가설을 생성합니다 — 주장, 증거(찬성/반대), 신뢰도, 테스트 방법 — 구조화된 노트로.',
  nl: 'Genereert falsifieerbare werkhypothesen over de zaak — claim, bewijs (voor/tegen), vertrouwen, hoe te testen — als gestructureerde notities.',
  pl: 'Generuje falsyfikowalne teorie robocze sprawy — twierdzenie, dowody (za/przeciw), pewność, jak przetestować — w postaci ustrukturyzowanych notatek.',
  'pt-BR': 'Gera teorias de trabalho falsificáveis do caso — alegação, evidências (a favor/contra), confiança, como testar — como notas estruturadas.',
  ru: 'Создаёт фальсифицируемые рабочие гипотезы по делу — утверждение, доказательства (за/против), уверенность, как проверить — в виде структурированных заметок.',
  th: 'สร้างทฤษฎีการทำงานที่หักล้างได้สำหรับคดี — ข้ออ้าง หลักฐาน (สนับสนุน/คัดค้าน) ความเชื่อมั่น วิธีทดสอบ — เป็นบันทึกที่มีโครงสร้าง',
  tr: 'Davanın yanlışlanabilir çalışma teorilerini üretir — iddia, kanıt (lehte/aleyhte), güven, nasıl test edilir — yapılandırılmış notlar olarak.',
  uk: 'Створює фальсифіковані робочі гіпотези щодо справи — твердження, докази (за/проти), впевненість, як перевірити — у вигляді структурованих нотаток.',
  vi: 'Tạo các giả thuyết làm việc có thể bác bỏ về vụ việc — tuyên bố, bằng chứng (ủng hộ/phản đối), độ tin cậy, cách kiểm tra — dưới dạng ghi chú có cấu trúc.',
  'zh-CN': '为案件生成可证伪的工作假设——主张、证据（支持/反对）、信心度、如何测试——作为结构化笔记。',
};

let totalAdded = 0;
for (const locale of Object.keys(NAME)) {
  const p = path.join(root, 'public/locales', locale, 'agent.json');
  if (!fs.existsSync(p)) continue;
  const obj = JSON.parse(fs.readFileSync(p, 'utf8'));
  let changed = false;
  if (!('builtinProfile.hypothesisWriter.name' in obj)) {
    obj['builtinProfile.hypothesisWriter.name'] = NAME[locale];
    changed = true; totalAdded++;
  }
  if (!('builtinProfile.hypothesisWriter.description' in obj)) {
    obj['builtinProfile.hypothesisWriter.description'] = DESCRIPTION[locale];
    changed = true; totalAdded++;
  }
  if (changed) {
    fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n', 'utf8');
    console.log(`  + ${locale}/agent.json`);
  }
}
console.log(`\nDone. ${totalAdded} keys added.`);
