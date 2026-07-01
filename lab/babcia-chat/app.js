/* app.js — Babcia Chat frontend.
 * - One profile (your name + reading language), many conversations (rooms).
 * - Each conversation is a passcode; you give it a private label on your device.
 * - Store-and-forward: polls the backend; unread badges on the chat list.
 * - Real Web Push: a service worker shows notifications even when closed.
 * No build step. */

(function () {
  "use strict";

  // Backend base URL = the live Render service by default (so the page works
  // anywhere — published or run locally). Add ?dev to the URL to target a local
  // backend on :8790 instead (for offline backend development).
  const RENDER_URL = "https://babcia-server.onrender.com";
  const dev = location.search.includes("dev");
  const API = dev ? "http://localhost:8790" : RENDER_URL;

  // name = canonical value sent to the backend (keep English — translation key);
  // label = shown in the picker (endonym); locale = for dates/times + detection.
  const LANGS = [
    { name: "Polish",     flag: "🇵🇱", label: "Polski",     locale: "pl" },
    { name: "English",    flag: "🇬🇧", label: "English",    locale: "en" },
    { name: "Spanish",    flag: "🇪🇸", label: "Español",    locale: "es" },
    { name: "German",     flag: "🇩🇪", label: "Deutsch",    locale: "de" },
    { name: "French",     flag: "🇫🇷", label: "Français",   locale: "fr" },
    { name: "Ukrainian",  flag: "🇺🇦", label: "Українська", locale: "uk" },
    { name: "Italian",    flag: "🇮🇹", label: "Italiano",   locale: "it" },
    { name: "Portuguese", flag: "🇵🇹", label: "Português",  locale: "pt" },
    { name: "Dutch",      flag: "🇳🇱", label: "Nederlands", locale: "nl" },
    { name: "Russian",    flag: "🇷🇺", label: "Русский",    locale: "ru" },
  ];
  const langInfo = (name) => LANGS.find((l) => l.name === name) || LANGS[1];

  /* ---------- UI translations (interface chrome) ---------- *
   * Keyed by canonical language name. English is the per-key fallback.
   * {label}/{lang} are interpolated by t(). */
  const I18N = {
    English: {
      tagline: "Talk to your family — everyone reads in their own language.",
      label_name: "Your name", ph_name: "e.g. Babcia", label_lang: "Your language",
      btn_continue: "Continue", rooms_title: "Your chats", edit: "Edit",
      readingIn: "reading in {lang}",
      alerts_on_btn: "🔔 Turn on alerts", alerts_are_on: "🔔 Alerts are on", alerts_blocked: "🔕 Alerts blocked",
      hint_off: "Get notified when someone writes — even when the app is closed.",
      hint_on: "You’ll be notified of new messages.",
      hint_blocked: "Notifications are blocked in your browser settings.",
      hint_unavailable: "Alerts aren’t available on the server yet.",
      hint_fail: "Couldn’t turn on alerts. Try again.",
      send_failed: "Couldn’t send — check your connection and try again.",
      new_conversation: "＋ New conversation", ph_addlabel: "Their name (e.g. Zosia)", ph_addpass: "Shared passcode",
      cancel: "Cancel", add: "Add", add_need: "Give it a name and a passcode.",
      add_dup: "You already have a chat with that passcode.", passcode: "passcode",
      rooms_empty: "No conversations yet.\nTap “New conversation”, give it a name and the passcode you agreed with them.",
      msgs_empty: "No messages yet.\nSay hello — it will wait here for them.",
      ph_message: "Write a message…", send: "Send", waking: "Waking up, one moment…", you: "You",
      remove_confirm: "Remove the chat with {label}? Messages stay on the server — you can re-add it with the same passcode.",
    },
    Polish: {
      tagline: "Rozmawiaj z rodziną — każdy czyta w swoim języku.",
      label_name: "Twoje imię", ph_name: "np. Babcia", label_lang: "Twój język",
      btn_continue: "Dalej", rooms_title: "Twoje rozmowy", edit: "Zmień",
      readingIn: "język: {lang}",
      alerts_on_btn: "🔔 Włącz powiadomienia", alerts_are_on: "🔔 Powiadomienia włączone", alerts_blocked: "🔕 Powiadomienia zablokowane",
      hint_off: "Otrzymuj powiadomienia o nowych wiadomościach — nawet gdy aplikacja jest zamknięta.",
      hint_on: "Będziesz powiadamiana o nowych wiadomościach.",
      hint_blocked: "Powiadomienia są zablokowane w ustawieniach przeglądarki.",
      hint_unavailable: "Powiadomienia nie są jeszcze dostępne na serwerze.",
      hint_fail: "Nie udało się włączyć powiadomień. Spróbuj ponownie.",
      send_failed: "Nie udało się wysłać — sprawdź połączenie i spróbuj ponownie.",
      new_conversation: "＋ Nowa rozmowa", ph_addlabel: "Ich imię (np. Zosia)", ph_addpass: "Wspólne hasło",
      cancel: "Anuluj", add: "Dodaj", add_need: "Podaj imię i hasło.",
      add_dup: "Masz już rozmowę z tym hasłem.", passcode: "hasło",
      rooms_empty: "Brak rozmów.\nKliknij „Nowa rozmowa”, podaj imię i ustalone wspólne hasło.",
      msgs_empty: "Brak wiadomości.\nPrzywitaj się — wiadomość poczeka tutaj na nich.",
      ph_message: "Napisz wiadomość…", send: "Wyślij", waking: "Budzę się, chwileczkę…", you: "Ty",
      remove_confirm: "Usunąć rozmowę z {label}? Wiadomości pozostaną na serwerze — możesz ją dodać ponownie z tym samym hasłem.",
    },
    Spanish: {
      tagline: "Habla con tu familia — cada uno lee en su propio idioma.",
      label_name: "Tu nombre", ph_name: "p. ej. Abuela", label_lang: "Tu idioma",
      btn_continue: "Continuar", rooms_title: "Tus chats", edit: "Editar",
      readingIn: "leyendo en {lang}",
      alerts_on_btn: "🔔 Activar avisos", alerts_are_on: "🔔 Avisos activados", alerts_blocked: "🔕 Avisos bloqueados",
      hint_off: "Recibe un aviso cuando alguien escriba — incluso con la app cerrada.",
      hint_on: "Recibirás avisos de mensajes nuevos.",
      hint_blocked: "Las notificaciones están bloqueadas en los ajustes del navegador.",
      hint_unavailable: "Los avisos aún no están disponibles en el servidor.",
      hint_fail: "No se pudieron activar los avisos. Inténtalo de nuevo.",
      send_failed: "No se pudo enviar — comprueba tu conexión e inténtalo de nuevo.",
      new_conversation: "＋ Nueva conversación", ph_addlabel: "Su nombre (p. ej. Zosia)", ph_addpass: "Contraseña compartida",
      cancel: "Cancelar", add: "Añadir", add_need: "Ponle un nombre y una contraseña.",
      add_dup: "Ya tienes un chat con esa contraseña.", passcode: "contraseña",
      rooms_empty: "Aún no hay conversaciones.\nPulsa «Nueva conversación», ponle un nombre y la contraseña acordada.",
      msgs_empty: "Aún no hay mensajes.\nSaluda — esperará aquí a que lo lean.",
      ph_message: "Escribe un mensaje…", send: "Enviar", waking: "Despertando, un momento…", you: "Tú",
      remove_confirm: "¿Eliminar el chat con {label}? Los mensajes se quedan en el servidor — puedes volver a añadirlo con la misma contraseña.",
    },
    German: {
      tagline: "Sprich mit deiner Familie — jeder liest in seiner eigenen Sprache.",
      label_name: "Dein Name", ph_name: "z. B. Oma", label_lang: "Deine Sprache",
      btn_continue: "Weiter", rooms_title: "Deine Chats", edit: "Ändern",
      readingIn: "liest auf {lang}",
      alerts_on_btn: "🔔 Hinweise einschalten", alerts_are_on: "🔔 Hinweise an", alerts_blocked: "🔕 Hinweise blockiert",
      hint_off: "Lass dich benachrichtigen, wenn jemand schreibt — auch bei geschlossener App.",
      hint_on: "Du wirst über neue Nachrichten benachrichtigt.",
      hint_blocked: "Benachrichtigungen sind in den Browser-Einstellungen blockiert.",
      hint_unavailable: "Hinweise sind auf dem Server noch nicht verfügbar.",
      hint_fail: "Hinweise konnten nicht eingeschaltet werden. Bitte erneut versuchen.",
      send_failed: "Konnte nicht gesendet werden — prüfe deine Verbindung und versuche es erneut.",
      new_conversation: "＋ Neue Unterhaltung", ph_addlabel: "Ihr Name (z. B. Zosia)", ph_addpass: "Gemeinsames Kennwort",
      cancel: "Abbrechen", add: "Hinzufügen", add_need: "Gib einen Namen und ein Kennwort ein.",
      add_dup: "Du hast bereits einen Chat mit diesem Kennwort.", passcode: "Kennwort",
      rooms_empty: "Noch keine Unterhaltungen.\nTippe auf „Neue Unterhaltung“, gib einen Namen und das vereinbarte Kennwort ein.",
      msgs_empty: "Noch keine Nachrichten.\nSag Hallo — sie wartet hier auf sie.",
      ph_message: "Nachricht schreiben…", send: "Senden", waking: "Wird aufgeweckt, einen Moment…", you: "Du",
      remove_confirm: "Chat mit {label} entfernen? Nachrichten bleiben auf dem Server — du kannst ihn mit demselben Kennwort wieder hinzufügen.",
    },
    French: {
      tagline: "Parlez à votre famille — chacun lit dans sa propre langue.",
      label_name: "Votre nom", ph_name: "ex. Mamie", label_lang: "Votre langue",
      btn_continue: "Continuer", rooms_title: "Vos discussions", edit: "Modifier",
      readingIn: "lit en {lang}",
      alerts_on_btn: "🔔 Activer les alertes", alerts_are_on: "🔔 Alertes activées", alerts_blocked: "🔕 Alertes bloquées",
      hint_off: "Soyez averti quand quelqu’un écrit — même appli fermée.",
      hint_on: "Vous serez averti des nouveaux messages.",
      hint_blocked: "Les notifications sont bloquées dans les réglages du navigateur.",
      hint_unavailable: "Les alertes ne sont pas encore disponibles sur le serveur.",
      hint_fail: "Impossible d’activer les alertes. Réessayez.",
      send_failed: "Échec de l’envoi — vérifiez votre connexion et réessayez.",
      new_conversation: "＋ Nouvelle conversation", ph_addlabel: "Son nom (ex. Zosia)", ph_addpass: "Code partagé",
      cancel: "Annuler", add: "Ajouter", add_need: "Donnez un nom et un code.",
      add_dup: "Vous avez déjà une discussion avec ce code.", passcode: "code",
      rooms_empty: "Aucune conversation.\nAppuyez sur « Nouvelle conversation », donnez un nom et le code convenu.",
      msgs_empty: "Aucun message.\nDites bonjour — il attendra ici qu’on le lise.",
      ph_message: "Écrivez un message…", send: "Envoyer", waking: "Réveil en cours, un instant…", you: "Vous",
      remove_confirm: "Supprimer la discussion avec {label} ? Les messages restent sur le serveur — vous pouvez la rajouter avec le même code.",
    },
    Ukrainian: {
      tagline: "Спілкуйтеся з родиною — кожен читає своєю мовою.",
      label_name: "Ваше ім’я", ph_name: "напр. Бабуся", label_lang: "Ваша мова",
      btn_continue: "Далі", rooms_title: "Ваші чати", edit: "Змінити",
      readingIn: "читає мовою: {lang}",
      alerts_on_btn: "🔔 Увімкнути сповіщення", alerts_are_on: "🔔 Сповіщення увімкнені", alerts_blocked: "🔕 Сповіщення заблоковані",
      hint_off: "Отримуйте сповіщення, коли хтось пише — навіть коли застосунок закрито.",
      hint_on: "Ви отримуватимете сповіщення про нові повідомлення.",
      hint_blocked: "Сповіщення заблоковані в налаштуваннях браузера.",
      hint_unavailable: "Сповіщення поки недоступні на сервері.",
      hint_fail: "Не вдалося увімкнути сповіщення. Спробуйте ще раз.",
      send_failed: "Не вдалося надіслати — перевірте з’єднання та спробуйте ще раз.",
      new_conversation: "＋ Нова розмова", ph_addlabel: "Їхнє ім’я (напр. Zosia)", ph_addpass: "Спільний пароль",
      cancel: "Скасувати", add: "Додати", add_need: "Вкажіть ім’я та пароль.",
      add_dup: "У вас уже є чат із цим паролем.", passcode: "пароль",
      rooms_empty: "Поки немає розмов.\nНатисніть «Нова розмова», вкажіть ім’я та узгоджений пароль.",
      msgs_empty: "Поки немає повідомлень.\nПривітайтеся — воно чекатиме тут на них.",
      ph_message: "Напишіть повідомлення…", send: "Надіслати", waking: "Прокидаюся, хвилинку…", you: "Ви",
      remove_confirm: "Видалити чат із {label}? Повідомлення лишаються на сервері — ви можете додати його знову з тим самим паролем.",
    },
    Italian: {
      tagline: "Parla con la tua famiglia — ognuno legge nella propria lingua.",
      label_name: "Il tuo nome", ph_name: "es. Nonna", label_lang: "La tua lingua",
      btn_continue: "Continua", rooms_title: "Le tue chat", edit: "Modifica",
      readingIn: "legge in {lang}",
      alerts_on_btn: "🔔 Attiva avvisi", alerts_are_on: "🔔 Avvisi attivi", alerts_blocked: "🔕 Avvisi bloccati",
      hint_off: "Ricevi un avviso quando qualcuno scrive — anche ad app chiusa.",
      hint_on: "Riceverai avvisi per i nuovi messaggi.",
      hint_blocked: "Le notifiche sono bloccate nelle impostazioni del browser.",
      hint_unavailable: "Gli avvisi non sono ancora disponibili sul server.",
      hint_fail: "Impossibile attivare gli avvisi. Riprova.",
      send_failed: "Invio non riuscito — controlla la connessione e riprova.",
      new_conversation: "＋ Nuova conversazione", ph_addlabel: "Il suo nome (es. Zosia)", ph_addpass: "Password condivisa",
      cancel: "Annulla", add: "Aggiungi", add_need: "Dai un nome e una password.",
      add_dup: "Hai già una chat con questa password.", passcode: "password",
      rooms_empty: "Ancora nessuna conversazione.\nTocca «Nuova conversazione», dai un nome e la password concordata.",
      msgs_empty: "Ancora nessun messaggio.\nSaluta — resterà qui ad aspettarli.",
      ph_message: "Scrivi un messaggio…", send: "Invia", waking: "Mi sto svegliando, un attimo…", you: "Tu",
      remove_confirm: "Rimuovere la chat con {label}? I messaggi restano sul server — puoi riaggiungerla con la stessa password.",
    },
    Portuguese: {
      tagline: "Fale com a sua família — cada um lê no seu próprio idioma.",
      label_name: "O seu nome", ph_name: "ex. Avó", label_lang: "O seu idioma",
      btn_continue: "Continuar", rooms_title: "As suas conversas", edit: "Editar",
      readingIn: "lendo em {lang}",
      alerts_on_btn: "🔔 Ativar alertas", alerts_are_on: "🔔 Alertas ativados", alerts_blocked: "🔕 Alertas bloqueados",
      hint_off: "Seja avisado quando alguém escrever — mesmo com a app fechada.",
      hint_on: "Será avisado de novas mensagens.",
      hint_blocked: "As notificações estão bloqueadas nas definições do navegador.",
      hint_unavailable: "Os alertas ainda não estão disponíveis no servidor.",
      hint_fail: "Não foi possível ativar os alertas. Tente novamente.",
      send_failed: "Não foi possível enviar — verifique a ligação e tente novamente.",
      new_conversation: "＋ Nova conversa", ph_addlabel: "O nome dele(a) (ex. Zosia)", ph_addpass: "Palavra-passe partilhada",
      cancel: "Cancelar", add: "Adicionar", add_need: "Dê um nome e uma palavra-passe.",
      add_dup: "Já tem uma conversa com essa palavra-passe.", passcode: "palavra-passe",
      rooms_empty: "Ainda sem conversas.\nToque em «Nova conversa», dê um nome e a palavra-passe combinada.",
      msgs_empty: "Ainda sem mensagens.\nDiga olá — vai esperar aqui por eles.",
      ph_message: "Escreva uma mensagem…", send: "Enviar", waking: "A acordar, um momento…", you: "Você",
      remove_confirm: "Remover a conversa com {label}? As mensagens ficam no servidor — pode adicioná-la de novo com a mesma palavra-passe.",
    },
    Dutch: {
      tagline: "Praat met je familie — iedereen leest in zijn eigen taal.",
      label_name: "Je naam", ph_name: "bijv. Oma", label_lang: "Je taal",
      btn_continue: "Doorgaan", rooms_title: "Je gesprekken", edit: "Wijzigen",
      readingIn: "leest in {lang}",
      alerts_on_btn: "🔔 Meldingen aanzetten", alerts_are_on: "🔔 Meldingen aan", alerts_blocked: "🔕 Meldingen geblokkeerd",
      hint_off: "Word gewaarschuwd als iemand schrijft — ook als de app dicht is.",
      hint_on: "Je krijgt meldingen van nieuwe berichten.",
      hint_blocked: "Meldingen zijn geblokkeerd in je browserinstellingen.",
      hint_unavailable: "Meldingen zijn nog niet beschikbaar op de server.",
      hint_fail: "Meldingen konden niet worden ingeschakeld. Probeer opnieuw.",
      send_failed: "Verzenden mislukt — controleer je verbinding en probeer opnieuw.",
      new_conversation: "＋ Nieuw gesprek", ph_addlabel: "Hun naam (bijv. Zosia)", ph_addpass: "Gedeelde toegangscode",
      cancel: "Annuleren", add: "Toevoegen", add_need: "Geef een naam en een toegangscode.",
      add_dup: "Je hebt al een gesprek met die toegangscode.", passcode: "toegangscode",
      rooms_empty: "Nog geen gesprekken.\nTik op ‘Nieuw gesprek’, geef een naam en de afgesproken toegangscode.",
      msgs_empty: "Nog geen berichten.\nZeg hallo — het wacht hier op ze.",
      ph_message: "Schrijf een bericht…", send: "Versturen", waking: "Aan het opstarten, een momentje…", you: "Jij",
      remove_confirm: "Gesprek met {label} verwijderen? Berichten blijven op de server — je kunt het opnieuw toevoegen met dezelfde toegangscode.",
    },
    Russian: {
      tagline: "Общайтесь с семьёй — каждый читает на своём языке.",
      label_name: "Ваше имя", ph_name: "напр. Бабушка", label_lang: "Ваш язык",
      btn_continue: "Далее", rooms_title: "Ваши чаты", edit: "Изменить",
      readingIn: "язык: {lang}",
      alerts_on_btn: "🔔 Включить уведомления", alerts_are_on: "🔔 Уведомления включены", alerts_blocked: "🔕 Уведомления заблокированы",
      hint_off: "Получайте уведомления, когда кто-то пишет — даже когда приложение закрыто.",
      hint_on: "Вы будете получать уведомления о новых сообщениях.",
      hint_blocked: "Уведомления заблокированы в настройках браузера.",
      hint_unavailable: "Уведомления пока недоступны на сервере.",
      hint_fail: "Не удалось включить уведомления. Попробуйте ещё раз.",
      send_failed: "Не удалось отправить — проверьте соединение и повторите попытку.",
      new_conversation: "＋ Новый разговор", ph_addlabel: "Их имя (напр. Zosia)", ph_addpass: "Общий пароль",
      cancel: "Отмена", add: "Добавить", add_need: "Укажите имя и пароль.",
      add_dup: "У вас уже есть чат с этим паролем.", passcode: "пароль",
      rooms_empty: "Пока нет разговоров.\nНажмите «Новый разговор», укажите имя и согласованный пароль.",
      msgs_empty: "Пока нет сообщений.\nПоздоровайтесь — оно подождёт их здесь.",
      ph_message: "Напишите сообщение…", send: "Отправить", waking: "Просыпаюсь, минутку…", you: "Вы",
      remove_confirm: "Удалить чат с {label}? Сообщения остаются на сервере — вы можете добавить его снова с тем же паролем.",
    },
  };
  // active UI language: profile reading-language, else entry pick, else detected
  function uiLang() { return store.profile.lang || setupLang || detectLang(); }
  function t(key, vars) {
    const dict = I18N[uiLang()] || I18N.English;
    let s = (dict[key] != null ? dict[key] : I18N.English[key]) || "";
    if (vars) for (const k in vars) s = s.split("{" + k + "}").join(vars[k]);
    return s;
  }
  // best-effort match of the browser/phone language to one we support
  function detectLang() {
    const codes = (navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || "en"]);
    for (const c of codes) {
      const two = String(c).slice(0, 2).toLowerCase();
      const hit = LANGS.find((l) => l.locale === two);
      if (hit) return hit.name;
    }
    return "English";
  }
  // apply all static [data-i18n]/[data-i18n-ph] text for the current language
  function applyI18n() {
    document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
    document.querySelectorAll("[data-i18n-ph]").forEach((el) => { el.placeholder = t(el.dataset.i18nPh); });
    document.documentElement.lang = langInfo(uiLang()).locale;
  }

  const STORE = "babcia-v2";
  const OLD_STORE = "babcia-chat";
  const $ = (s) => document.querySelector(s);

  /* persisted state:
   * { profile:{name,lang}, rooms:[{label,passcode,lastCount}], notify:bool } */
  let store = { profile: { name: "", lang: "" }, rooms: [], notify: false };
  let setupLang = "";                 // language chosen on the entry screen
  let active = null;                  // current room { label, passcode } or null
  let pollTimer = null, countsTimer = null, lastRendered = -1;

  /* ---------- persistence ---------- */
  function load() {
    try {
      const v2 = JSON.parse(localStorage.getItem(STORE) || "null");
      if (v2) { store = v2; store.rooms = store.rooms || []; return; }
      const old = JSON.parse(localStorage.getItem(OLD_STORE) || "null");
      if (old && old.name) {            // migrate single-room → profile + one room
        store.profile = { name: old.name, lang: old.lang || "" };
        if (old.room) store.rooms = [{ label: old.room, passcode: old.room, lastCount: 0 }];
        save();
      }
    } catch (_) {}
  }
  function save() { localStorage.setItem(STORE, JSON.stringify(store)); }

  /* ---------- screens ---------- */
  function show(id) {
    ["entry", "rooms", "chat"].forEach((s) => { $("#" + s).hidden = (s !== id); });
  }

  /* ---------- entry / profile ---------- */
  function buildLangs() {
    const wrap = $("#langs");
    LANGS.forEach((l) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "lang"; b.dataset.lang = l.name;
      b.setAttribute("aria-pressed", "false");
      b.innerHTML = `<span class="flag">${l.flag}</span><span>${l.label}</span>`;
      b.addEventListener("click", () => {
        document.querySelectorAll(".lang").forEach((x) => x.setAttribute("aria-pressed", "false"));
        b.setAttribute("aria-pressed", "true"); setupLang = l.name;
        applyI18n();                      // flip the entry screen to that language live
        validateEntry();
      });
      wrap.appendChild(b);
    });
  }
  function fillEntry() {
    $("#name").value = store.profile.name || "";
    setupLang = store.profile.lang || detectLang();   // preselect detected on first run
    document.querySelectorAll(".lang").forEach((x) =>
      x.setAttribute("aria-pressed", String(x.dataset.lang === setupLang)));
    applyI18n();
    validateEntry();
  }
  function validateEntry() {
    $("#enter-btn").disabled = !($("#name").value.trim() && setupLang);
  }
  function saveProfile() {
    const name = $("#name").value.trim();
    if (!name || !setupLang) return;
    store.profile = { name, lang: setupLang };
    save();
    syncPush();                         // keep push sub's name/lang current
    openRoomList();
  }

  /* ---------- conversation list ---------- */
  function openRoomList() {
    active = null; stopPolling();
    applyI18n();
    $("#rooms-you").textContent = `${store.profile.name} · ${t("readingIn", { lang: langInfo(store.profile.lang).label })}`;
    reflectNotifyState();
    renderRoomList();
    show("rooms");
    refreshCounts();                    // immediate badge refresh
    startCountsPolling();
  }
  function renderRoomList() {
    const box = $("#room-list");
    box.innerHTML = "";
    if (!store.rooms.length) {
      box.innerHTML = `<p class="empty-hint">${t("rooms_empty").split("\n").join("<br>")}</p>`;
      return;
    }
    store.rooms.forEach((r, i) => {
      const unread = Math.max(0, (countsCache[r.passcode] || 0) - (r.lastCount || 0));
      const card = document.createElement("div");
      card.className = "room-card";
      card.innerHTML = `
        <span class="room-avatar">${(r.label || "?").trim().charAt(0).toUpperCase()}</span>
        <span class="room-info">
          <span class="room-label"></span>
          <span class="room-sub"><span class="pc-label"></span>: <b></b></span>
        </span>
        <span class="room-badge"${unread ? "" : " hidden"}>${unread}</span>
        <button class="room-del" type="button" aria-label="Remove conversation">✕</button>`;
      card.querySelector(".room-label").textContent = r.label;
      card.querySelector(".pc-label").textContent = t("passcode");
      card.querySelector(".room-sub b").textContent = r.passcode;
      card.addEventListener("click", () => openRoom(i));
      const del = card.querySelector(".room-del");
      del.addEventListener("click", (e) => {
        e.stopPropagation();
        if (confirm(t("remove_confirm", { label: r.label }))) {
          store.rooms.splice(i, 1); save(); syncPush(); renderRoomList();
        }
      });
      box.appendChild(card);
    });
  }

  /* ---------- add conversation ---------- */
  function wireAddRoom() {
    $("#add-toggle").addEventListener("click", () => {
      $("#add-form").hidden = false; $("#add-toggle").hidden = true; $("#add-label").focus();
    });
    $("#add-cancel").addEventListener("click", closeAdd);
    $("#add-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const label = $("#add-label").value.trim();
      const passcode = $("#add-pass").value.trim();
      if (!label || !passcode) { $("#add-note").textContent = t("add_need"); return; }
      if (store.rooms.some((r) => r.passcode === passcode)) {
        $("#add-note").textContent = t("add_dup"); return;
      }
      store.rooms.push({ label, passcode, lastCount: 0 });
      save(); syncPush(); closeAdd(); renderRoomList(); refreshCounts();
    });
  }
  function closeAdd() {
    $("#add-form").hidden = true; $("#add-toggle").hidden = false;
    $("#add-label").value = ""; $("#add-pass").value = ""; $("#add-note").textContent = "";
  }

  /* ---------- a single conversation ---------- */
  async function openRoom(i) {
    const r = store.rooms[i]; if (!r) return;
    active = r;
    applyI18n();
    $("#head-room").textContent = r.label;
    $("#head-you").textContent = `${store.profile.name} · ${t("readingIn", { lang: langInfo(store.profile.lang).label })}`;
    show("chat");
    $("#messages").innerHTML = "";
    lastRendered = -1;
    await wakeUp();
    await refresh();                    // loads + marks read
    startPolling();
    $("#msg-input").focus();
  }

  /* ---------- cold start ---------- */
  async function wakeUp() {
    $("#waking").hidden = false;
    for (let i = 0; i < 20; i++) {
      try {
        const res = await fetch(API + "/api/health", { cache: "no-store" });
        if (res.ok) { $("#waking").hidden = true; return; }
      } catch (_) { /* still waking */ }
      await new Promise((r) => setTimeout(r, 3000));
    }
    $("#waking").hidden = true;
  }

  /* ---------- polling (active room) ---------- */
  function startPolling() { stopPolling(); pollTimer = setInterval(refresh, 3000); }
  function stopPolling() { if (pollTimer) clearInterval(pollTimer); pollTimer = null; }

  async function refresh() {
    if (!active) return;
    try {
      const res = await fetch(`${API}/api/messages?room=${encodeURIComponent(active.passcode)}&lang=${encodeURIComponent(store.profile.lang)}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      const msgs = data.messages || [];
      render(msgs);
      markRead(active.passcode, msgs.length);   // viewing == read
    } catch (_) { /* offline / waking — keep last view */ }
  }
  function markRead(passcode, count) {
    const r = store.rooms.find((x) => x.passcode === passcode);
    if (r && r.lastCount !== count) { r.lastCount = count; countsCache[passcode] = count; save(); }
  }

  /* ---------- polling (unread counts for the list) ---------- */
  let countsCache = {};
  function startCountsPolling() {
    stopCountsPolling();
    countsTimer = setInterval(refreshCounts, 8000);
  }
  function stopCountsPolling() { if (countsTimer) clearInterval(countsTimer); countsTimer = null; }
  async function refreshCounts() {
    if (!store.rooms.length) return;
    try {
      const list = store.rooms.map((r) => r.passcode).join(",");
      const res = await fetch(`${API}/api/counts?rooms=${encodeURIComponent(list)}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      countsCache = data.counts || {};
      if (!$("#rooms").hidden) renderRoomList();
    } catch (_) {}
  }

  /* ---------- render messages ---------- */
  function uiLocale() { return langInfo(store.profile.lang).locale; }
  function fmtTime(iso) {
    const d = new Date(iso);
    return d.toLocaleTimeString(uiLocale(), { hour: "2-digit", minute: "2-digit" });
  }
  function render(msgs) {
    const box = $("#messages");
    if (!msgs.length) {
      box.innerHTML = `<p class="empty-hint">${t("msgs_empty").split("\n").join("<br>")}</p>`;
      lastRendered = 0; return;
    }
    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
    box.innerHTML = "";
    let lastDay = "";
    for (const m of msgs) {
      const day = new Date(m.createdAt).toLocaleDateString(uiLocale(), { weekday: "long", day: "numeric", month: "short" });
      if (day !== lastDay) { lastDay = day; box.appendChild(elDay(day)); }
      box.appendChild(elBubble(m));
    }
    if (nearBottom || msgs.length !== lastRendered) box.scrollTop = box.scrollHeight;
    lastRendered = msgs.length;
  }
  function elDay(t) { const d = document.createElement("div"); d.className = "day-sep"; d.textContent = t; return d; }
  function elBubble(m) {
    const mine = m.sender === store.profile.name;
    const b = document.createElement("div");
    b.className = "bubble" + (mine ? " mine" : "");
    const who = document.createElement("div"); who.className = "who"; who.textContent = mine ? t("you") : m.sender;
    const text = document.createElement("div"); text.className = "text"; text.textContent = m.text;
    const meta = document.createElement("div"); meta.className = "meta";
    meta.appendChild(Object.assign(document.createElement("span"), { textContent: fmtTime(m.createdAt) }));
    b.append(who, text, meta);
    // Translations only — the original source text is never shown (kept personal).
    return b;
  }

  /* ---------- send ---------- */
  async function send(e) {
    e && e.preventDefault();
    if (!active) return;
    const ta = $("#msg-input"); const text = ta.value.trim();
    if (!text) return;
    const err = $("#send-err"); if (err) { err.hidden = true; err.textContent = ""; }
    $("#send-btn").disabled = true;
    try {
      const res = await fetch(API + "/api/message", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ room: active.passcode, sender: store.profile.name, sourceLang: store.profile.lang, text }),
      });
      if (!res.ok) throw new Error("http " + res.status);   // fetch resolves on 4xx/5xx — must check
      ta.value = ""; ta.style.height = "auto";               // only clear once it's actually stored
      await refresh();
      $("#messages").scrollTop = $("#messages").scrollHeight;
    } catch (_) {
      if (err) { err.textContent = t("send_failed"); err.hidden = false; }  // keep the text — nothing lost
    }
    $("#send-btn").disabled = false; ta.focus();
  }

  /* ---------- push notifications ---------- */
  function reflectNotifyState() {
    const btn = $("#notify-btn"); const hint = $("#notify-hint");
    const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    if (!supported) {
      $("#notify-bar").hidden = true; return;
    }
    if (Notification.permission === "granted" && store.notify) {
      btn.textContent = t("alerts_are_on"); btn.classList.add("on"); btn.disabled = true;
      hint.textContent = t("hint_on");
    } else if (Notification.permission === "denied") {
      btn.textContent = t("alerts_blocked"); btn.disabled = true;
      hint.textContent = t("hint_blocked");
    } else {
      btn.textContent = t("alerts_on_btn"); btn.classList.remove("on"); btn.disabled = false;
      hint.textContent = t("hint_off");
    }
  }
  function urlB64ToUint8(base64) {
    const pad = "=".repeat((4 - (base64.length % 4)) % 4);
    const b64 = (base64 + pad).replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(b64); const arr = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
    return arr;
  }
  async function enableNotifications() {
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") { reflectNotifyState(); return; }
      const cfg = await (await fetch(API + "/api/config", { cache: "no-store" })).json();
      if (!cfg.push || !cfg.vapidPublicKey) {
        $("#notify-hint").textContent = t("hint_unavailable");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlB64ToUint8(cfg.vapidPublicKey),
        });
      }
      await postSubscription(sub);
      store.notify = true; save();
      reflectNotifyState();
    } catch (err) {
      $("#notify-hint").textContent = t("hint_fail");
    }
  }
  async function postSubscription(sub) {
    await fetch(API + "/api/subscribe", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        subscription: sub, name: store.profile.name, lang: store.profile.lang,
        rooms: store.rooms.map((r) => r.passcode),
      }),
    });
  }
  // keep the server's record of (name, lang, rooms) in step after any change
  async function syncPush() {
    try {
      if (!store.notify || Notification.permission !== "granted") return;
      if (!("serviceWorker" in navigator)) return;
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) await postSubscription(sub);
    } catch (_) {}
  }

  /* ---------- service worker + deep-link from a notification ---------- */
  function registerSW() {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("sw.js").catch(() => {});
    navigator.serviceWorker.addEventListener("message", (e) => {
      if (e.data && e.data.type === "open-room") jumpToRoom(e.data.room);
    });
  }
  function jumpToRoom(passcode) {
    if (!passcode) return;
    const i = store.rooms.findIndex((r) => r.passcode === passcode);
    if (i >= 0) openRoom(i);
  }

  /* ---------- visibility: pause polling when hidden ---------- */
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { stopPolling(); stopCountsPolling(); return; }
    if (active) { refresh(); startPolling(); }
    else if (!$("#rooms").hidden) { refreshCounts(); startCountsPolling(); }
  });

  /* ---------- wire up ---------- */
  function init() {
    buildLangs();
    load();
    registerSW();

    ["#name"].forEach((s) => $(s).addEventListener("input", validateEntry));
    $("#enter-btn").addEventListener("click", saveProfile);
    $("#edit-profile-btn").addEventListener("click", () => { fillEntry(); show("entry"); });
    $("#back-btn").addEventListener("click", openRoomList);
    $("#notify-btn").addEventListener("click", enableNotifications);
    $("#composer").addEventListener("submit", send);
    wireAddRoom();

    // graceful logo fallback if the PNG isn't placed yet
    document.querySelectorAll("#logo-entry, .logo-sm").forEach((img) =>
      img.addEventListener("error", () => { img.style.visibility = "hidden"; }));

    // textarea auto-grow + Enter-to-send (Shift+Enter = newline)
    const ta = $("#msg-input");
    ta.addEventListener("input", () => { ta.style.height = "auto"; ta.style.height = Math.min(120, ta.scrollHeight) + "px"; });
    ta.addEventListener("keydown", (ev) => { if (ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); send(); } });
    ta.addEventListener("focus", () => setTimeout(() => { $("#messages").scrollTop = $("#messages").scrollHeight; }, 300));

    // first run → set up profile; returning → straight to the chat list
    if (store.profile.name && store.profile.lang) {
      openRoomList();
      const qp = new URLSearchParams(location.search).get("room");
      if (qp) jumpToRoom(qp);
    } else {
      fillEntry(); show("entry");
    }
  }
  init();
})();
