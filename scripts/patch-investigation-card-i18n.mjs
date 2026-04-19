#!/usr/bin/env node
/**
 * One-shot patch: fan out the new investigation-card and observer-note-review
 * i18n keys across all 20 non-English locales. Use this when ANTHROPIC_API_KEY
 * isn't available and `pnpm translate:sync` can't run.
 *
 * Adds to public/locales/<lng>/investigations.json:
 *   card.actions, card.settings, card.archive, card.unarchive, card.delete,
 *   card.sync, card.unsync, card.syncing, card.syncLocally, card.removeLocalCopy,
 *   card.members_one, card.members_other,
 *   card.dataMode.{local,synced,remote}, card.role.{owner,editor,viewer},
 *   card.status.{active,closed,archived},
 *   card.entity.{notes,tasks,iocs,events,whiteboards,chats}
 *
 * Adds to public/locales/<lng>/notes.json (under card.*):
 *   needsReview, needsReviewTitle
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', 'public', 'locales');

/** Per-locale strings. English keys live in the main locale files; this script
 * only writes the 20 non-English locales. */
const T = {
  ar: { actions: 'الإجراءات', settings: 'الإعدادات', archive: 'أرشفة', unarchive: 'إلغاء الأرشفة', delete: 'حذف', sync: 'مزامنة', unsync: 'إلغاء المزامنة', syncing: 'جارٍ المزامنة…', syncLocally: 'مزامنة محليًا', removeLocalCopy: 'إزالة النسخة المحلية', members_one: '{{count}} عضو', members_other: '{{count}} أعضاء', local: 'محلي', synced: 'متزامن', remote: 'بعيد', owner: 'المالك', editor: 'محرر', viewer: 'عارض', active: 'نشط', closed: 'مغلق', archived: 'مؤرشَف', notes: 'ملاحظات', tasks: 'مهام', iocs: 'مؤشرات', events: 'أحداث', whiteboards: 'لوحات', chats: 'محادثات', needsReview: 'يحتاج إلى مراجعة', needsReviewTitle: 'تم إنشاؤها بواسطة وكيل بدور المراقب — راجع قبل الاعتماد عليها كمخرج للتحقيق' },
  de: { actions: 'Aktionen', settings: 'Einstellungen', archive: 'Archivieren', unarchive: 'Aus Archiv entfernen', delete: 'Löschen', sync: 'Synchronisieren', unsync: 'Synchronisierung aufheben', syncing: 'Synchronisierung läuft…', syncLocally: 'Lokal synchronisieren', removeLocalCopy: 'Lokale Kopie entfernen', members_one: '{{count}} Mitglied', members_other: '{{count}} Mitglieder', local: 'Lokal', synced: 'Synchronisiert', remote: 'Remote', owner: 'Eigentümer', editor: 'Bearbeiter', viewer: 'Betrachter', active: 'Aktiv', closed: 'Geschlossen', archived: 'Archiviert', notes: 'Notizen', tasks: 'Aufgaben', iocs: 'IOCs', events: 'Ereignisse', whiteboards: 'Whiteboards', chats: 'Chats', needsReview: 'Überprüfung erforderlich', needsReviewTitle: 'Von einem Beobachter-Agenten erstellt — vor Verwendung als Untersuchungsergebnis prüfen' },
  es: { actions: 'Acciones', settings: 'Configuración', archive: 'Archivar', unarchive: 'Desarchivar', delete: 'Eliminar', sync: 'Sincronizar', unsync: 'Desincronizar', syncing: 'Sincronizando…', syncLocally: 'Sincronizar localmente', removeLocalCopy: 'Eliminar copia local', members_one: '{{count}} miembro', members_other: '{{count}} miembros', local: 'Local', synced: 'Sincronizado', remote: 'Remoto', owner: 'Propietario', editor: 'Editor', viewer: 'Lector', active: 'Activo', closed: 'Cerrado', archived: 'Archivado', notes: 'Notas', tasks: 'Tareas', iocs: 'IOCs', events: 'Eventos', whiteboards: 'Pizarras', chats: 'Chats', needsReview: 'Requiere revisión', needsReviewTitle: 'Creado por un agente observador — revisar antes de confiar como resultado de la investigación' },
  fa: { actions: 'اقدامات', settings: 'تنظیمات', archive: 'بایگانی', unarchive: 'خروج از بایگانی', delete: 'حذف', sync: 'همگام‌سازی', unsync: 'لغو همگام‌سازی', syncing: 'در حال همگام‌سازی…', syncLocally: 'همگام‌سازی محلی', removeLocalCopy: 'حذف نسخه محلی', members_one: '{{count}} عضو', members_other: '{{count}} عضو', local: 'محلی', synced: 'همگام', remote: 'دور', owner: 'مالک', editor: 'ویرایشگر', viewer: 'بیننده', active: 'فعال', closed: 'بسته', archived: 'بایگانی‌شده', notes: 'یادداشت‌ها', tasks: 'وظایف', iocs: 'IOCها', events: 'رویدادها', whiteboards: 'تخته‌ها', chats: 'گفتگوها', needsReview: 'نیاز به بازبینی', needsReviewTitle: 'توسط عامل ناظر ایجاد شده — قبل از اعتماد به‌عنوان خروجی تحقیق بازبینی کنید' },
  fr: { actions: 'Actions', settings: 'Paramètres', archive: 'Archiver', unarchive: 'Désarchiver', delete: 'Supprimer', sync: 'Synchroniser', unsync: 'Désynchroniser', syncing: 'Synchronisation…', syncLocally: 'Synchroniser localement', removeLocalCopy: 'Retirer la copie locale', members_one: '{{count}} membre', members_other: '{{count}} membres', local: 'Local', synced: 'Synchronisé', remote: 'Distant', owner: 'Propriétaire', editor: 'Éditeur', viewer: 'Lecteur', active: 'Actif', closed: 'Fermé', archived: 'Archivé', notes: 'Notes', tasks: 'Tâches', iocs: 'IOCs', events: 'Événements', whiteboards: 'Tableaux', chats: 'Discussions', needsReview: 'Révision requise', needsReviewTitle: "Créé par un agent observateur — à vérifier avant d'être considéré comme un résultat d'enquête" },
  he: { actions: 'פעולות', settings: 'הגדרות', archive: 'העבר לארכיון', unarchive: 'הוצא מהארכיון', delete: 'מחק', sync: 'סנכרן', unsync: 'בטל סנכרון', syncing: 'מסנכרן…', syncLocally: 'סנכרן מקומית', removeLocalCopy: 'הסר עותק מקומי', members_one: '{{count}} חבר', members_other: '{{count}} חברים', local: 'מקומי', synced: 'מסונכרן', remote: 'מרוחק', owner: 'בעלים', editor: 'עורך', viewer: 'צופה', active: 'פעיל', closed: 'סגור', archived: 'בארכיון', notes: 'הערות', tasks: 'משימות', iocs: 'IOCs', events: 'אירועים', whiteboards: 'לוחות', chats: 'שיחות', needsReview: 'דורש סקירה', needsReviewTitle: 'נכתב על ידי סוכן בתפקיד צופה — סקור לפני שתסתמך עליו כתוצר של החקירה' },
  hi: { actions: 'क्रियाएँ', settings: 'सेटिंग्स', archive: 'संग्रहित करें', unarchive: 'संग्रह से हटाएँ', delete: 'हटाएँ', sync: 'समन्वयित करें', unsync: 'समन्वय हटाएँ', syncing: 'समन्वयन हो रहा है…', syncLocally: 'स्थानीय रूप से समन्वयित करें', removeLocalCopy: 'स्थानीय प्रति हटाएँ', members_one: '{{count}} सदस्य', members_other: '{{count}} सदस्य', local: 'स्थानीय', synced: 'समन्वित', remote: 'दूरस्थ', owner: 'स्वामी', editor: 'संपादक', viewer: 'दर्शक', active: 'सक्रिय', closed: 'बंद', archived: 'संग्रहीत', notes: 'नोट्स', tasks: 'कार्य', iocs: 'IOCs', events: 'घटनाएँ', whiteboards: 'व्हाइटबोर्ड', chats: 'बातचीत', needsReview: 'समीक्षा आवश्यक', needsReviewTitle: 'पर्यवेक्षक एजेंट द्वारा लिखित — जाँच आउटपुट पर भरोसा करने से पहले समीक्षा करें' },
  id: { actions: 'Tindakan', settings: 'Pengaturan', archive: 'Arsipkan', unarchive: 'Batalkan arsip', delete: 'Hapus', sync: 'Sinkronkan', unsync: 'Batalkan sinkron', syncing: 'Menyinkronkan…', syncLocally: 'Sinkronkan secara lokal', removeLocalCopy: 'Hapus salinan lokal', members_one: '{{count}} anggota', members_other: '{{count}} anggota', local: 'Lokal', synced: 'Tersinkron', remote: 'Jarak jauh', owner: 'Pemilik', editor: 'Editor', viewer: 'Penampil', active: 'Aktif', closed: 'Ditutup', archived: 'Diarsipkan', notes: 'Catatan', tasks: 'Tugas', iocs: 'IOC', events: 'Peristiwa', whiteboards: 'Papan tulis', chats: 'Obrolan', needsReview: 'Perlu ditinjau', needsReviewTitle: 'Dibuat oleh agen pengamat — tinjau sebelum dipercaya sebagai keluaran investigasi' },
  it: { actions: 'Azioni', settings: 'Impostazioni', archive: 'Archivia', unarchive: 'Rimuovi dallʼarchivio', delete: 'Elimina', sync: 'Sincronizza', unsync: 'Annulla sincronizzazione', syncing: 'Sincronizzazione in corso…', syncLocally: 'Sincronizza localmente', removeLocalCopy: 'Rimuovi copia locale', members_one: '{{count}} membro', members_other: '{{count}} membri', local: 'Locale', synced: 'Sincronizzato', remote: 'Remoto', owner: 'Proprietario', editor: 'Editor', viewer: 'Visualizzatore', active: 'Attivo', closed: 'Chiuso', archived: 'Archiviato', notes: 'Note', tasks: 'Attività', iocs: 'IOC', events: 'Eventi', whiteboards: 'Lavagne', chats: 'Chat', needsReview: 'Richiede revisione', needsReviewTitle: 'Creata da un agente osservatore — verifica prima di considerarla un risultato dellʼindagine' },
  ja: { actions: 'アクション', settings: '設定', archive: 'アーカイブ', unarchive: 'アーカイブ解除', delete: '削除', sync: '同期', unsync: '同期解除', syncing: '同期中…', syncLocally: 'ローカルに同期', removeLocalCopy: 'ローカルコピーを削除', members_one: '{{count}} 名のメンバー', members_other: '{{count}} 名のメンバー', local: 'ローカル', synced: '同期済み', remote: 'リモート', owner: 'オーナー', editor: '編集者', viewer: '閲覧者', active: 'アクティブ', closed: 'クローズ', archived: 'アーカイブ済み', notes: 'ノート', tasks: 'タスク', iocs: 'IOC', events: 'イベント', whiteboards: 'ホワイトボード', chats: 'チャット', needsReview: '要レビュー', needsReviewTitle: 'オブザーバーロールのエージェントが作成 — 調査出力として信頼する前にレビューしてください' },
  ko: { actions: '작업', settings: '설정', archive: '보관', unarchive: '보관 해제', delete: '삭제', sync: '동기화', unsync: '동기화 해제', syncing: '동기화 중…', syncLocally: '로컬로 동기화', removeLocalCopy: '로컬 복사본 제거', members_one: '{{count}}명의 멤버', members_other: '{{count}}명의 멤버', local: '로컬', synced: '동기화됨', remote: '원격', owner: '소유자', editor: '편집자', viewer: '조회자', active: '활성', closed: '종료', archived: '보관됨', notes: '노트', tasks: '작업', iocs: 'IOC', events: '이벤트', whiteboards: '화이트보드', chats: '채팅', needsReview: '검토 필요', needsReviewTitle: '관찰자 역할 에이전트가 작성 — 조사 결과로 신뢰하기 전에 검토하세요' },
  nl: { actions: 'Acties', settings: 'Instellingen', archive: 'Archiveren', unarchive: 'Uit archief halen', delete: 'Verwijderen', sync: 'Synchroniseren', unsync: 'Synchronisatie opheffen', syncing: 'Synchroniseren…', syncLocally: 'Lokaal synchroniseren', removeLocalCopy: 'Lokale kopie verwijderen', members_one: '{{count}} lid', members_other: '{{count}} leden', local: 'Lokaal', synced: 'Gesynchroniseerd', remote: 'Extern', owner: 'Eigenaar', editor: 'Bewerker', viewer: 'Weergever', active: 'Actief', closed: 'Gesloten', archived: 'Gearchiveerd', notes: 'Notities', tasks: 'Taken', iocs: 'IOCs', events: 'Gebeurtenissen', whiteboards: 'Whiteboards', chats: 'Chats', needsReview: 'Beoordeling nodig', needsReviewTitle: 'Aangemaakt door een waarnemer-agent — controleer voordat je hierop vertrouwt als onderzoeksuitkomst' },
  pl: { actions: 'Akcje', settings: 'Ustawienia', archive: 'Archiwizuj', unarchive: 'Cofnij archiwizację', delete: 'Usuń', sync: 'Synchronizuj', unsync: 'Wyłącz synchronizację', syncing: 'Synchronizowanie…', syncLocally: 'Synchronizuj lokalnie', removeLocalCopy: 'Usuń lokalną kopię', members_one: '{{count}} członek', members_other: '{{count}} członków', local: 'Lokalne', synced: 'Zsynchronizowane', remote: 'Zdalne', owner: 'Właściciel', editor: 'Edytor', viewer: 'Czytelnik', active: 'Aktywne', closed: 'Zamknięte', archived: 'Zarchiwizowane', notes: 'Notatki', tasks: 'Zadania', iocs: 'IOC', events: 'Zdarzenia', whiteboards: 'Tablice', chats: 'Czaty', needsReview: 'Wymaga przeglądu', needsReviewTitle: 'Utworzono przez agenta-obserwatora — przejrzyj, zanim potraktujesz jako wynik dochodzenia' },
  'pt-BR': { actions: 'Ações', settings: 'Configurações', archive: 'Arquivar', unarchive: 'Desarquivar', delete: 'Excluir', sync: 'Sincronizar', unsync: 'Cancelar sincronização', syncing: 'Sincronizando…', syncLocally: 'Sincronizar localmente', removeLocalCopy: 'Remover cópia local', members_one: '{{count}} membro', members_other: '{{count}} membros', local: 'Local', synced: 'Sincronizado', remote: 'Remoto', owner: 'Proprietário', editor: 'Editor', viewer: 'Leitor', active: 'Ativo', closed: 'Fechado', archived: 'Arquivado', notes: 'Notas', tasks: 'Tarefas', iocs: 'IOCs', events: 'Eventos', whiteboards: 'Quadros', chats: 'Conversas', needsReview: 'Requer revisão', needsReviewTitle: 'Criado por um agente observador — revise antes de confiar como resultado da investigação' },
  ru: { actions: 'Действия', settings: 'Настройки', archive: 'В архив', unarchive: 'Из архива', delete: 'Удалить', sync: 'Синхронизировать', unsync: 'Отменить синхронизацию', syncing: 'Синхронизация…', syncLocally: 'Синхронизировать локально', removeLocalCopy: 'Удалить локальную копию', members_one: '{{count}} участник', members_other: '{{count}} участников', local: 'Локально', synced: 'Синхронизировано', remote: 'Удалённо', owner: 'Владелец', editor: 'Редактор', viewer: 'Наблюдатель', active: 'Активно', closed: 'Закрыто', archived: 'Архив', notes: 'Заметки', tasks: 'Задачи', iocs: 'IOC', events: 'События', whiteboards: 'Доски', chats: 'Чаты', needsReview: 'Требуется проверка', needsReviewTitle: 'Создано агентом-наблюдателем — проверьте перед использованием в качестве результата расследования' },
  th: { actions: 'การดำเนินการ', settings: 'การตั้งค่า', archive: 'เก็บถาวร', unarchive: 'ยกเลิกการเก็บถาวร', delete: 'ลบ', sync: 'ซิงก์', unsync: 'ยกเลิกซิงก์', syncing: 'กำลังซิงก์…', syncLocally: 'ซิงก์ในเครื่อง', removeLocalCopy: 'ลบสำเนาในเครื่อง', members_one: '{{count}} สมาชิก', members_other: '{{count}} สมาชิก', local: 'ในเครื่อง', synced: 'ซิงก์แล้ว', remote: 'ระยะไกล', owner: 'เจ้าของ', editor: 'ผู้แก้ไข', viewer: 'ผู้ดู', active: 'กำลังใช้งาน', closed: 'ปิด', archived: 'เก็บถาวรแล้ว', notes: 'บันทึก', tasks: 'งาน', iocs: 'IOC', events: 'เหตุการณ์', whiteboards: 'ไวท์บอร์ด', chats: 'แชต', needsReview: 'ต้องการตรวจสอบ', needsReviewTitle: 'สร้างโดยเอเจนต์ผู้สังเกต — ตรวจสอบก่อนเชื่อถือเป็นผลลัพธ์ของการสืบสวน' },
  tr: { actions: 'Eylemler', settings: 'Ayarlar', archive: 'Arşivle', unarchive: 'Arşivden Çıkar', delete: 'Sil', sync: 'Eşitle', unsync: 'Eşitlemeyi kaldır', syncing: 'Eşitleniyor…', syncLocally: 'Yerel olarak eşitle', removeLocalCopy: 'Yerel kopyayı kaldır', members_one: '{{count}} üye', members_other: '{{count}} üye', local: 'Yerel', synced: 'Eşitlenmiş', remote: 'Uzak', owner: 'Sahip', editor: 'Düzenleyici', viewer: 'Görüntüleyici', active: 'Aktif', closed: 'Kapalı', archived: 'Arşivlendi', notes: 'Notlar', tasks: 'Görevler', iocs: 'IOC', events: 'Olaylar', whiteboards: 'Beyaz tahtalar', chats: 'Sohbetler', needsReview: 'Gözden geçirilmeli', needsReviewTitle: 'Gözlemci rolündeki ajan tarafından oluşturuldu — soruşturma çıktısı olarak güvenmeden önce gözden geçirin' },
  uk: { actions: 'Дії', settings: 'Налаштування', archive: 'Архівувати', unarchive: 'Розархівувати', delete: 'Видалити', sync: 'Синхронізувати', unsync: 'Скасувати синхронізацію', syncing: 'Синхронізація…', syncLocally: 'Синхронізувати локально', removeLocalCopy: 'Видалити локальну копію', members_one: '{{count}} учасник', members_other: '{{count}} учасників', local: 'Локально', synced: 'Синхронізовано', remote: 'Віддалено', owner: 'Власник', editor: 'Редактор', viewer: 'Глядач', active: 'Активне', closed: 'Закрите', archived: 'Архівне', notes: 'Нотатки', tasks: 'Завдання', iocs: 'IOC', events: 'Події', whiteboards: 'Дошки', chats: 'Чати', needsReview: 'Потребує перегляду', needsReviewTitle: 'Створено агентом-спостерігачем — перевірте, перш ніж довіряти як результату розслідування' },
  vi: { actions: 'Thao tác', settings: 'Cài đặt', archive: 'Lưu trữ', unarchive: 'Bỏ lưu trữ', delete: 'Xóa', sync: 'Đồng bộ', unsync: 'Hủy đồng bộ', syncing: 'Đang đồng bộ…', syncLocally: 'Đồng bộ cục bộ', removeLocalCopy: 'Xóa bản sao cục bộ', members_one: '{{count}} thành viên', members_other: '{{count}} thành viên', local: 'Cục bộ', synced: 'Đã đồng bộ', remote: 'Từ xa', owner: 'Chủ sở hữu', editor: 'Trình chỉnh sửa', viewer: 'Người xem', active: 'Đang hoạt động', closed: 'Đã đóng', archived: 'Đã lưu trữ', notes: 'Ghi chú', tasks: 'Tác vụ', iocs: 'IOC', events: 'Sự kiện', whiteboards: 'Bảng trắng', chats: 'Trò chuyện', needsReview: 'Cần xem xét', needsReviewTitle: 'Được tạo bởi tác nhân quan sát — hãy xem xét trước khi tin tưởng làm kết quả điều tra' },
  'zh-CN': { actions: '操作', settings: '设置', archive: '归档', unarchive: '取消归档', delete: '删除', sync: '同步', unsync: '取消同步', syncing: '同步中…', syncLocally: '本地同步', removeLocalCopy: '移除本地副本', members_one: '{{count}} 位成员', members_other: '{{count}} 位成员', local: '本地', synced: '已同步', remote: '远程', owner: '所有者', editor: '编辑者', viewer: '查看者', active: '活动', closed: '关闭', archived: '已归档', notes: '笔记', tasks: '任务', iocs: 'IOC', events: '事件', whiteboards: '白板', chats: '对话', needsReview: '需要审核', needsReviewTitle: '由观察者角色的代理创建 — 在作为调查输出信任之前请审核' },
};

function patchInvestigations(file, t) {
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  const add = {
    'card.actions': t.actions,
    'card.settings': t.settings,
    'card.archive': t.archive,
    'card.unarchive': t.unarchive,
    'card.delete': t.delete,
    'card.sync': t.sync,
    'card.unsync': t.unsync,
    'card.syncing': t.syncing,
    'card.syncLocally': t.syncLocally,
    'card.removeLocalCopy': t.removeLocalCopy,
    'card.members_one': t.members_one,
    'card.members_other': t.members_other,
    'card.dataMode.local': t.local,
    'card.dataMode.synced': t.synced,
    'card.dataMode.remote': t.remote,
    'card.role.owner': t.owner,
    'card.role.editor': t.editor,
    'card.role.viewer': t.viewer,
    'card.status.active': t.active,
    'card.status.closed': t.closed,
    'card.status.archived': t.archived,
    'card.entity.notes': t.notes,
    'card.entity.tasks': t.tasks,
    'card.entity.iocs': t.iocs,
    'card.entity.events': t.events,
    'card.entity.whiteboards': t.whiteboards,
    'card.entity.chats': t.chats,
  };
  for (const [k, v] of Object.entries(add)) {
    if (!(k in json)) json[k] = v;
  }
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n', 'utf8');
}

function patchNotesCard(file, t) {
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  json.card = json.card || {};
  if (!('needsReview' in json.card)) json.card.needsReview = t.needsReview;
  if (!('needsReviewTitle' in json.card)) json.card.needsReviewTitle = t.needsReviewTitle;
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n', 'utf8');
}

let touched = 0;
for (const [lng, strings] of Object.entries(T)) {
  const inv = path.join(ROOT, lng, 'investigations.json');
  const notes = path.join(ROOT, lng, 'notes.json');
  if (fs.existsSync(inv)) { patchInvestigations(inv, strings); touched++; }
  if (fs.existsSync(notes)) patchNotesCard(notes, strings);
}
console.log(`Patched ${touched} locale(s).`);
