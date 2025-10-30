const fs = require("fs");
const path = require("path");
const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const axios = require("axios");

const TURNOS_FILE = path.join(__dirname, "turnos.json");
const CITAS_FILE = path.join(__dirname, "citas.json");
const ADMIN_PHONE = "51959634347@c.us";
const SERVER_URL = "http://localhost:3000";

let turnosCache = [];
let pollingInterval = null;

function detectProfKeyFromString(str) {
  const s = (str || "").toLowerCase();
  if (s.includes("elio") || s.includes("támara") || s.includes("tamara"))
    return "elio";
  if (s.includes("manuel") || s.includes("romani")) return "manuel";
  if (s.includes("jimy") || s.includes("osorio")) return "jimy";
  if (s.includes("fernando") || s.includes("bustamante")) return "fernando";
  if (["elio", "manuel", "jimy", "fernando"].includes(s)) return s;
  if (s.includes("pediatr")) return "jimy";
  return "otro";
}

function detectProfDisplayFromKey(k) {
  const display = {
    elio: "CD Elio Támara",
    manuel: "CD Manuel Romani",
    jimy: "Esp. CD Jimy Osorio",
    fernando: "Esp. CD Fernando Bustamante",
  };
  return display[k] || k;
}

async function fetchTurnosFromServer(especialidad = null) {
  try {
    const url = `${SERVER_URL}/obtener-turnos${
      especialidad ? `?especialidad=${especialidad}` : ""
    }`;
    const res = await axios.get(url);
    if (res.data && res.data.length > 0) {
      const normalized = normalizeTurnos(res.data, especialidad);
      turnosCache = normalized;
      return normalized;
    } else {
      turnosCache = [];
      return [];
    }
  } catch (e) {
    console.error("Error fetching turnos:", e);
    turnosCache = [];
    return [];
  }
}

function normalizeTurnos(raw, especialidad = null) {
  const out = [];
  if (!raw) return out;
  const now = new Date();
  now.setUTCHours(0, 0, 0, 0);

  Object.values(raw || {}).forEach((group) => {
    if (group && group.date && Array.isArray(group.slots)) {
      const profRaw = (group.title || "").toString().toLowerCase();
      const profKey = detectProfKeyFromString(profRaw);
      const startDate = new Date(`${group.date}T00:00:00.000Z`);
      if (!startDate || startDate < now) return;

      group.slots.forEach((slot) => {
        const startStr = `${group.date}T${slot.start}:00.000Z`;
        const startDateSlot = new Date(startStr);
        if (!startDateSlot || startDateSlot < now) return;
        const endStr = `${group.date}T${slot.end}:00.000Z`;
        const endDateSlot =
          new Date(endStr) ||
          new Date(startDateSlot.getTime() + 40 * 60 * 1000);
        const esp =
          group.especialidad ||
          (profKey === "jimy" || profKey === "fernando"
            ? "pediatria"
            : "general");

        if (especialidad && esp !== especialidad) return;

        const fh = formatFechaHora(startDateSlot.toISOString());
        out.push({
          profKey,
          profTitle: group.title || detectProfDisplayFromKey(profKey),
          startISO: startDateSlot.toISOString(),
          endISO: endDateSlot.toISOString(),
          startTime: startDateSlot.getTime(),
          endTime: endDateSlot.getTime(),
          fecha: fh.fecha,
          hora: fh.hora,
          especialidad: esp,
          original: { ...group, slot },
        });
      });
    }
  });

  out.sort((a, b) => a.startTime - b.startTime);
  return out;
}

async function removeSlotFromServer(profKey, startISO, profTitle) {
  try {
    const res = await axios.post(`${SERVER_URL}/reservar-turno`, {
      profesional: profTitle,
      turnoInicio: startISO,
    });
    if (res.data.message && res.data.message.includes("correctamente")) {
      return true;
    } else {
      return false;
    }
  } catch (e) {
    console.error("Error reservando turno:", e);
    return false;
  }
}

async function addSlotBackToServer(profKey, startISO, endISO, profTitle, esp) {
  try {
    const res = await axios.post(`${SERVER_URL}/liberar-turno`, {
      profesional: profTitle,
      turnoInicio: startISO,
      turnoFin: endISO,
      title: profTitle,
      especialidad: esp,
    });
    if (res.data.message && res.data.message.includes("correctamente")) {
      return true;
    } else {
      return false;
    }
  } catch (e) {
    console.error("Error liberando turno:", e);
    return false;
  }
}

function readJsonFileSafe(filePath, isArray = false) {
  try {
    if (!fs.existsSync(filePath)) {
      const initial = isArray
        ? []
        : { elio: [], manuel: [], jimy: [], fernando: [] };
      writeJsonFileSafe(filePath, initial);
      return initial;
    }
    const raw = fs.readFileSync(filePath, "utf8").trim();
    if (!raw) {
      const initial = isArray
        ? []
        : { elio: [], manuel: [], jimy: [], fernando: [] };
      writeJsonFileSafe(filePath, initial);
      return initial;
    }
    const parsed = JSON.parse(raw);
    return parsed;
  } catch (e) {
    console.error("Error leyendo archivo JSON:", e);
    return isArray ? [] : { elio: [], manuel: [], jimy: [], fernando: [] };
  }
}

function writeJsonFileSafe(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
    return true;
  } catch (e) {
    console.error("Error escribiendo archivo JSON:", e);
    return false;
  }
}

function parseFechaLocal(fechaStr) {
  if (!fechaStr || typeof fechaStr !== "string") return null;
  const parts = fechaStr.split("/");
  if (parts.length === 3) {
    const [dd, mm, yyyy] = parts;
    return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  }
  return null;
}

function limpiarHora(horaStr) {
  if (!horaStr) return "";
  return horaStr
    .replace(/ a\. m\./i, "")
    .replace(/ p\. m\./i, "")
    .trim()
    .split(" ")[0];
}

function appendCitaRecord(record) {
  try {
    const fechaISO = parseFechaLocal(record.fecha);
    if (!fechaISO)
      throw new Error(`Formato de fecha inválido: ${record.fecha}`);
    const horaLimpia = limpiarHora(record.hora);
    if (!horaLimpia || !horaLimpia.includes(":"))
      throw new Error(`Formato de hora inválido: ${record.hora}`);
    const localDateTime = `${fechaISO}T${horaLimpia}:00.000`;
    const startUTC = new Date(localDateTime).toISOString();

    let arr = readJsonFileSafe(CITAS_FILE, true);
    arr.push({
      ...record,
      confirmedAt: new Date().toISOString(),
      startUTC,
    });
    const success = writeJsonFileSafe(CITAS_FILE, arr);
    if (!success) throw new Error("Error al escribir citas.json");
    return true;
  } catch (err) {
    console.error("Error en appendCitaRecord:", err);
    return false;
  }
}

function findCitaByDni(dni) {
  const citas = readJsonFileSafe(CITAS_FILE, true);
  return citas.find((c) => c.dni === dni && c.status !== "cancelada");
}

async function sendToAdmin(client, citaData, chatId) {
  try {
    const message = `✅ *Nueva cita confirmada*\n\n👤 Nombre: *${citaData.nombre}*\n🆔 DNI: *${citaData.dni}*\n🎂 Edad: *${citaData.edad}*\n🦷 Consultorio: *${citaData.consultorio}*\n📅 Fecha: *${citaData.fecha}*\n🕐 Hora: *${citaData.hora}*\n👨‍⚕️ Doctor: *${citaData.profesional}*`;
    await client.sendMessage(ADMIN_PHONE, message);
  } catch (error) {
    console.error("Error enviando confirmación al admin:", error);
  }
}

function findFirstSlotForConsultorio(
  normalizedSlots,
  consultorio,
  preference = null
) {
  const isPedi =
    consultorio === "odontopediatria" || consultorio === "pediatria";
  const targetEsp = isPedi ? "pediatria" : "general";

  let candidates = normalizedSlots.filter((s) => {
    if (s.especialidad !== targetEsp) return false;
    if (isPedi) return ["jimy", "fernando"].includes(s.profKey);
    return ["elio", "manuel"].includes(s.profKey);
  });

  if (candidates.length === 0) return null;

  if (!preference) return candidates[0];

  const filtered = candidates.filter((s) => {
    const dt = new Date(s.startISO);
    const hour = dt.getUTCHours();
    const jsDay = dt.getUTCDay();

    console.log(
      `Evaluando turno: ${s.profTitle} ${s.startISO} - Hora UTC: ${hour}, Día semana: ${jsDay}`
    );

    if (preference.dateISO && !s.startISO.startsWith(preference.dateISO)) {
      console.log(`  ❌ Rechazado: No coincide fecha ${preference.dateISO}`);
      return false;
    }

    if (preference.weekday !== undefined && jsDay !== preference.weekday) {
      console.log(
        `  ❌ Rechazado: No coincide día de semana (esperado: ${preference.weekday}, actual: ${jsDay})`
      );
      return false;
    }

    if (preference.timeOfDay) {
      if (preference.timeOfDay === "tarde" && hour < 18) {
        console.log(`  ❌ Rechazado: No es tarde (hora UTC ${hour} < 18)`);
        return false;
      }

      if (preference.timeOfDay === "mañana" && (hour < 12 || hour >= 17)) {
        console.log(`  ❌ Rechazado: No es mañana (hora UTC ${hour})`);
        return false;
      }
    }

    console.log(`  ✅ Aceptado: Cumple todas las preferencias`);

    return true;
  });

  return filtered.length > 0 ? filtered[0] : null;
}

function parsePreference(text) {
  text = (text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  if (!text) return null;

  const preference = {};

  if (
    /(tarde|por la tarde|en la tarde|horario tarde|turno tarde|de tarde)/i.test(
      text
    )
  ) {
    preference.timeOfDay = "tarde";
  } else if (
    /(mañana|manana|por la mañana|por la manana|en la mañana|en la manana|horario mañana|horario manana|turno mañana|turno manana|de mañana|de manana)/i.test(
      text
    )
  ) {
    preference.timeOfDay = "mañana";
  }

  const dayRegex =
    /(domingo|lunes|martes|miercoles|miércoles|jueves|viernes|sabado|sábado)/i;
  const dayMatch = text.match(dayRegex);
  if (dayMatch) {
    const dayWord = dayMatch[1]
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
    const dayMap = {
      domingo: 0,
      lunes: 1,
      martes: 2,
      miercoles: 3,
      jueves: 4,
      viernes: 5,
      sabado: 6,
    };
    preference.weekday = dayMap[dayWord] || undefined;
    console.log(
      `Día detectado: "${dayWord}" -> weekday: ${preference.weekday}`
    );
  }

  const md = text.match(/(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?/);
  if (md) {
    let dd = parseInt(md[1], 10),
      mm = parseInt(md[2], 10),
      yy = md[3] ? parseInt(md[3], 10) : new Date().getFullYear();
    if (yy < 100) yy += 2000;
    const dateStr = `${yy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(
      2,
      "0"
    )}`;
    preference.dateISO = dateStr;
  }

  if (
    !preference.timeOfDay &&
    preference.weekday === undefined &&
    !preference.dateISO
  ) {
    return null;
  }

  return preference;
}

function isValidName(text) {
  if (!text) return false;
  const tokens = text.trim().split(/\s+/);
  if (tokens.length < 2) return false;
  return tokens.every((t) => /^[A-Za-zÁÉÍÓÚáéíóúñÑ]+$/.test(t));
}

function isValidDni(text) {
  if (!text) return false;
  const digits = text.replace(/\D/g, "");
  return /^\d{8}$/.test(digits);
}

function isValidAge(text) {
  const n = parseInt(text, 10);
  return !isNaN(n) && n > 0 && n < 120;
}

function isGreeting(text) {
  return /(hola|buenas|buenos días|buenos dias|buen día|buen dia|buenas tardes|buenas noches|hi|hl|saludos)/i.test(
    text
  );
}

function isDirectRequestAppointment(text) {
  return /(cita|turno|reservar|quiero cita|quiero turno|deseo cita|necesito cita|tengo que sacar cita|agendar|solicitar cita)/i.test(
    text
  );
}

function isAffirm(text) {
  return /(^|\b)(si|sí|ok|claro|confirmo|confirmar|dale|dale que sí|yes|yep|afirmativo|correcto|exacto)(\b|$)/i.test(
    text
  );
}

function isDeny(text) {
  return /(^|\b)(no|cancelar|nunca|negativo|no gracias|nope|stop|rechazar)(\b|$)/i.test(
    text
  );
}

function isChangeRequest(text) {
  return /(cambiar|cambia|modificar|otro turno|otro día|otro dia|otro horario|diferente|prefiero otro|quiero otro)/i.test(
    text.toLowerCase()
  );
}

const conversations = new Map();
const reservationTimeouts = new Map();
const RESERVATION_TIMEOUT_MS = 5 * 60 * 1000;

async function releasePendingSlot(chatId) {
  const state = conversations.get(chatId);
  if (state && state.pendingSlot) {
    const slot = state.pendingSlot;
    await addSlotBackToServer(
      slot.profKey,
      slot.startISO,
      slot.endISO,
      slot.profTitle,
      slot.especialidad
    );
    state.pendingSlot = null;
    conversations.set(chatId, state);
  }
  if (reservationTimeouts.has(chatId)) {
    clearTimeout(reservationTimeouts.get(chatId));
    reservationTimeouts.delete(chatId);
  }
}

function startReservationTimeout(chatId) {
  if (reservationTimeouts.has(chatId)) {
    clearTimeout(reservationTimeouts.get(chatId));
  }

  const timeout = setTimeout(async () => {
    const state = conversations.get(chatId);
    if (state && state.pendingSlot) {
      console.log(`⏰ Timeout: liberando turno pendiente para ${chatId}`);
      await releasePendingSlot(chatId);
      await client.sendMessage(
        chatId,
        "⏰ *Tiempo agotado* ⌛\n\nEl turno propuesto ha sido *liberado automáticamente* por falta de confirmación.\n\nSi deseas reservar una cita, escribe *Cita* nuevamente. 📝"
      );
      resetFlow(chatId);
    } else {
      console.log(
        `⏰ Timeout: no hay turno pendiente para ${chatId}, no se libera.`
      );
    }
  }, RESERVATION_TIMEOUT_MS);

  reservationTimeouts.set(chatId, timeout);
}

function resetFlow(chatId) {
  if (reservationTimeouts.has(chatId)) {
    clearTimeout(reservationTimeouts.get(chatId));
    reservationTimeouts.delete(chatId);
  }
  conversations.delete(chatId);
}

function formatFechaHora(iso) {
  const d = new Date(iso);
  const fecha = d.toLocaleDateString("es-PE");
  const hora = d.toLocaleTimeString("es-PE", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return { fecha, hora };
}

function getAvailableDoctors(especialidad) {
  if (especialidad === "pediatria") {
    const jimySlots = turnosCache.filter((s) => s.profKey === "jimy");
    const fernandoSlots = turnosCache.filter((s) => s.profKey === "fernando");

    return {
      available: [
        ...(jimySlots.length > 0 ? ["jimy"] : []),
        ...(fernandoSlots.length > 0 ? ["fernando"] : []),
      ],
      unavailable: [
        ...(jimySlots.length === 0 ? ["jimy"] : []),
        ...(fernandoSlots.length === 0 ? ["fernando"] : []),
      ],
    };
  } else {
    const elioSlots = turnosCache.filter((s) => s.profKey === "elio");
    const manuelSlots = turnosCache.filter((s) => s.profKey === "manuel");

    return {
      available: [
        ...(elioSlots.length > 0 ? ["elio"] : []),
        ...(manuelSlots.length > 0 ? ["manuel"] : []),
      ],
      unavailable: [
        ...(elioSlots.length === 0 ? ["elio"] : []),
        ...(manuelSlots.length === 0 ? ["manuel"] : []),
      ],
    };
  }
}

function buildDoctorSelectionMessage(especialidad, includeManuel = false) {
  const doctors = getAvailableDoctors(especialidad);
  let message = "";
  let optionNumber = 1;

  if (especialidad === "pediatria") {
    message = "El paciente será atendido en *Odontopediatría* 👶🦷.\n\n";

    // Si solo hay 1 doctor disponible, mensaje especial
    if (doctors.available.length === 1 && doctors.unavailable.length > 0) {
      const availableDoc = doctors.available[0];
      message += `En este momento, solo tenemos turnos disponibles con:\n\n*${optionNumber}* - ${detectProfDisplayFromKey(
        availableDoc
      )}\n\n`;
      optionNumber++;

      doctors.unavailable.forEach((doc) => {
        message += `⚠️ El *${detectProfDisplayFromKey(
          doc
        )}* no tiene turnos disponibles por ahora. 😔\n`;
      });

      if (includeManuel) {
        message += `\n*${optionNumber}* - CD Manuel Romani (solo si el menor *ya lleva tratamiento previo* con él)\n`;
        optionNumber++;
      }

      message += `\n*${optionNumber}* - Sin preferencia (asignar el turno más próximo disponible)\n\n`;
      message += `¿Deseas reservar con *${detectProfDisplayFromKey(
        doctors.available[0]
      )}*?`;
    } else {
      // Si hay 2 o más doctores disponibles
      message +=
        "Por favor, selecciona el odontopediatra de tu preferencia escribiendo el *número*:\n\n";

      if (doctors.available.includes("jimy")) {
        message += `*${optionNumber}* - Esp. CD Jimy Osorio\n`;
        optionNumber++;
      }

      if (doctors.available.includes("fernando")) {
        message += `*${optionNumber}* - Esp. CD Fernando Bustamante\n`;
        optionNumber++;
      }

      if (includeManuel) {
        message += `*${optionNumber}* - CD Manuel Romani (solo si el menor *ya lleva tratamiento previo* con él)\n`;
        optionNumber++;
      }

      if (doctors.available.length > 0) {
        message += `*${optionNumber}* - Sin preferencia (asignar el turno más próximo disponible)`;
      }

      if (doctors.unavailable.length > 0) {
        message += "\n\n⚠️ *Odontopediatras sin turnos disponibles:*\n";
        doctors.unavailable.forEach((doc) => {
          message += `• ${detectProfDisplayFromKey(doc)}\n`;
        });
      }
    }
  } else {
    // Si solo hay 1 doctor disponible, mensaje especial
    if (doctors.available.length === 1 && doctors.unavailable.length > 0) {
      const availableDoc = doctors.available[0];
      message = `En este momento, solo tenemos turnos disponibles con:\n\n*${optionNumber}* - ${detectProfDisplayFromKey(
        availableDoc
      )}\n\n`;
      optionNumber++;

      doctors.unavailable.forEach((doc) => {
        message += `⚠️ El *${detectProfDisplayFromKey(
          doc
        )}* no tiene turnos disponibles por ahora. 😔\n`;
      });

      message += `\n*${optionNumber}* - Sin preferencia (asignar el turno más próximo disponible)\n\n`;
      message += `¿Deseas reservar con *${detectProfDisplayFromKey(
        doctors.available[0]
      )}*?`;
    } else {
      // Si hay 2 doctores disponibles
      message =
        "¿Llevas tratamiento con algún odontólogo? 🤔\n\nSi es así, escribe el número correspondiente:\n\n";

      if (doctors.available.includes("elio")) {
        message += `*${optionNumber}* - CD Elio Támara\n`;
        optionNumber++;
      }

      if (doctors.available.includes("manuel")) {
        message += `*${optionNumber}* - CD Manuel Romani\n`;
        optionNumber++;
      }

      if (doctors.available.length > 0) {
        message += `*${optionNumber}* - No tengo odontólogo preferido (asignar el más próximo disponible)`;
      }

      if (doctors.unavailable.length > 0) {
        message += "\n\n⚠️ *Odontólogos sin turnos disponibles:*\n";
        doctors.unavailable.forEach((doc) => {
          message += `• ${detectProfDisplayFromKey(doc)}\n`;
        });
      }
    }
  }

  return message;
}

const client = new Client({
  authStrategy: new LocalAuth({
    dataPath: process.env.SESSION_PATH || "./.wwebjs_auth",
  }),
  puppeteer: {
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--no-first-run",
      "--no-zygote",
      "--disable-gpu",
    ],
  },
});

client.on("qr", (qr) => qrcode.generate(qr, { small: true }));

client.on("ready", async () => {
  console.log("🤖 Bot listo y conectado a WhatsApp");
  await fetchTurnosFromServer();
  pollingInterval = setInterval(async () => {
    await fetchTurnosFromServer();
  }, 30000);
});

client.on("auth_failure", (msg) => console.error("Auth failure:", msg));

function startFlow(chatId) {
  conversations.set(chatId, {
    step: 1,
    data: {},
    pendingSlot: null,
    processing: false,
  });
}

client.on("message", async (msg) => {
  try {
    if (msg.fromMe) return;
    if (msg.timestamp < BOT_START_TS) return;

    const chatId = msg.from;

    // ✅ PERMITIR SIEMPRE AL ADMIN
    if (chatId === ADMIN_PHONE) {
      // El admin puede usar el bot siempre, continúa normalmente
      console.log("📞 Mensaje del admin, sin restricciones de horario");
    } else {
      // ⏰ VERIFICAR HORARIO PARA USUARIOS NORMALES
      if (!isFridayActiveHours()) {
        const outOfHoursMsg = getOutOfHoursMessage();
        await client.sendMessage(chatId, outOfHoursMsg);
        console.log(`⏰ Mensaje fuera de horario desde ${chatId}`);
        return; // Detiene la ejecución aquí
      }
    }

    const raw = (msg.body || "").trim();
    if (!raw) return;

    let state = conversations.get(chatId);
    if (!state)
      state = { step: 0, data: {}, pendingSlot: null, processing: false };

    if (state.processing) return;
    state.processing = true;
    conversations.set(chatId, state);

    const text = raw.toLowerCase();

    if (state.step === 0) {
      if (isDirectRequestAppointment(text)) {
        await fetchTurnosFromServer();
        if (turnosCache.length === 0) {
          await client.sendMessage(
            chatId,
            "Lo sentimos 😔, actualmente *no hay turnos disponibles*.\n\nLas citas se liberan todos los *viernes a las 7:30 AM* 🕢. Por favor, escríbenos en ese horario para reservar tu cita. 📅"
          );
          state.processing = false;
          return;
        }

        if (isChangeRequest(text) && state.data.dni) {
          state.step = 6;
          await client.sendMessage(
            chatId,
            `Entendido 🔄, quieres cambiar tu cita con DNI *${state.data.dni}*. Buscando... ⏳`
          );
          await handleChangeRequest(chatId, state);
          state.processing = false;
          return;
        } else {
          startFlow(chatId);
          await client.sendMessage(
            chatId,
            "📌 *IMPORTANTE:* Las citas se asignan *una por una*. Solo puede sacar *una cita por paciente*. Una vez termine con un paciente, podrá agendar otra para el siguiente.\n\n━━━━━━━━━━━━━━━━\n\nPara comenzar, por favor envíe el *Nombre y Apellido* del Paciente. 📝\n\n_(Mínimo 2 palabras y solo letras)_"
          );
          state.processing = false;
          return;
        }
      }
      if (isGreeting(text)) {
        await fetchTurnosFromServer();
        if (turnosCache.length === 0) {
          await client.sendMessage(
            chatId,
            "👋 Hola — Lo sentimos 😔, actualmente *no hay turnos disponibles*.\n\nLas citas se liberan todos los *viernes a las 7:30 AM* 🕢. Por favor, escríbenos en ese horario para reservar tu cita. 📅"
          );
          state.processing = false;
          return;
        }

        conversations.set(chatId, {
          step: 0.5,
          data: {},
          pendingSlot: null,
          processing: false,
        });
        await client.sendMessage(
          chatId,
          "👋 Hola — ¿Desea reservar una cita? 🤔\n\nResponda *SÍ* o *NO*."
        );
        state.processing = false;
        return;
      }
      state.processing = false;
      return;
    }

    if (state.step === 0.5) {
      if (isAffirm(text) || isDirectRequestAppointment(text)) {
        startFlow(chatId);
        await client.sendMessage(
          chatId,
          "📌 *IMPORTANTE:* Las citas se asignan *una por una*. Solo puede sacar *una cita por paciente*. Una vez termine con un paciente, podrá agendar otra para el siguiente.\n\n━━━━━━━━━━━━━━━━\n\nGenial. 😄\n\nEnvíe el *Nombre y Apellido* del Paciente por favor. 📝\n\n_(Mínimo 2 palabras y solo letras)_"
        );
        state.processing = false;
        return;
      }
      if (isDeny(text)) {
        resetFlow(chatId);
        await client.sendMessage(
          chatId,
          "De acuerdo. 👍 Si cambias de opinión escribe *Cita*."
        );
        state.processing = false;
        return;
      }
      await client.sendMessage(
        chatId,
        "Por favor responde:\n\n✅ *SÍ* si deseas una cita.\n❌ *NO* si no deseas una cita."
      );
      state.processing = false;
      return;
    }

    if (state.step === 1) {
      if (!isValidName(raw)) {
        await client.sendMessage(
          chatId,
          "❌ *Nombre incompleto o inválido.*\n\nPor favor envíe el *Nombre y Apellido* completo. 📝\n\n_(Mínimo 2 palabras y solo letras)_\n\n*Ejemplo:* Juan Pérez"
        );
        state.processing = false;
        return;
      }
      state.data.nombre = raw;
      state.step = 2;
      conversations.set(chatId, state);
      await client.sendMessage(
        chatId,
        "Perfecto. 😄\n\nAhora envíe el Número de *DNI* del Paciente. 🆔\n\n_(Debe tener exactamente 8 dígitos)_"
      );
      state.processing = false;
      return;
    }

    if (state.step === 2) {
      if (!isValidDni(raw)) {
        await client.sendMessage(
          chatId,
          "❌ *DNI inválido*.\n\nEl DNI debe tener *exactamente 8 dígitos*. ✅\n\nPor favor, verifique e intente nuevamente.\n\n*Ejemplo:* 12345678"
        );
        state.processing = false;
        return;
      }

      const dniDigits = raw.replace(/\D/g, "");
      const existingCita = findCitaByDni(dniDigits);
      if (existingCita) {
        await client.sendMessage(
          chatId,
          `⚠️ *Ya existe una cita registrada con este DNI:*\n\n👤 Nombre: *${existingCita.nombre}*\n🆔 DNI: *${existingCita.dni}*\n📅 Fecha: *${existingCita.fecha}*\n🕐 Hora: *${existingCita.hora}*\n👨‍⚕️ Doctor: *${existingCita.profesional}*\n\n━━━━━━━━━━━━━━━━\n\nSi deseas *cambiar* esta cita, escribe *"cambiar cita"*.\nSi deseas agendar para *otro paciente*, escribe *"cita"*.`
        );
        state.processing = false;
        resetFlow(chatId);
        return;
      }

      state.data.dni = dniDigits;
      state.step = 3;
      conversations.set(chatId, state);
      await client.sendMessage(
        chatId,
        "Gracias. 😄\n\nIndíqueme la *edad* del Paciente. 🎂\n\n_(Solo el número por favor)_\n\n*Ejemplo:*25"
      );
      state.processing = false;
      return;
    }

    if (state.step === 3) {
      if (!isValidAge(raw)) {
        await client.sendMessage(
          chatId,
          "❌ *Edad inválida*.\n\nPor favor envíe un número entre *1 y 119*. 🔢\n\n*Ejemplo:* 25"
        );
        state.processing = false;
        return;
      }

      const edad = parseInt(raw, 10);
      state.data.edad = edad;

      if (edad <= 11) {
        await fetchTurnosFromServer("pediatria");
        const doctors = getAvailableDoctors("pediatria");

        if (doctors.available.length === 0) {
          // NO HAY TURNOS EN ODONTOPEDIATRÍA
          await fetchTurnosFromServer("general");
          const doctorsGeneral = getAvailableDoctors("general");

          if (doctorsGeneral.available.length > 0) {
            await client.sendMessage(
              chatId,
              `😔 Lo sentimos, *no hay turnos disponibles* para *Odontopediatría* en este momento.\n\n✅ Sin embargo, tenemos turnos disponibles en *Odontología General* que solo se brinda a mayores de *11 años*.\n\nSi deseas agendar para un mayor de 11 años, escribe *Cita* nuevamente. 📝\n\nLas citas para odontopediatría se liberan todos los *viernes a las 7:30 AM* 🕢.`
            );
          } else {
            await client.sendMessage(
              chatId,
              "😔 Lo sentimos, *no hay turnos disponibles* en este momento ni en *Odontopediatría* ni en *Odontología General*.\n\nLas citas se liberan todos los *viernes a las 7:30 AM* 🕢. Por favor, escríbenos en ese horario. 📅"
            );
          }
          resetFlow(chatId);
          state.processing = false;
          return;
        }

        state.step = 3.6;
        conversations.set(chatId, state);
        const message = buildDoctorSelectionMessage("pediatria", true);
        await client.sendMessage(chatId, message);
        state.processing = false;
        return;
      } else {
        await fetchTurnosFromServer("general");
        const doctors = getAvailableDoctors("general");

        if (doctors.available.length === 0) {
          // NO HAY TURNOS EN ODONTOLOGÍA GENERAL
          await fetchTurnosFromServer("pediatria");
          const doctorsPediatria = getAvailableDoctors("pediatria");

          if (doctorsPediatria.available.length > 0) {
            await client.sendMessage(
              chatId,
              `😔 Lo sentimos, *no hay turnos disponibles* para *Odontología General* en este momento.\n\n✅ Aún tenemos turnos para *Odontopediatría* que solo se brinda a menores de *11 años*.\n\nSi deseas agendar para un menor, escribe *Cita* nuevamente. 📝 ¡Apresúrate que son muy limitados!\n\nLas citas para odontología general se liberan todos los *viernes a las 7:30 AM* 🕢.`
            );
          } else {
            await client.sendMessage(
              chatId,
              "😔 Lo sentimos, *no hay turnos disponibles* en este momento ni en *Odontología General* ni en *Odontopediatría*.\n\nLas citas se liberan todos los *viernes a las 7:30 AM* 🕢. Por favor, escríbenos en ese horario. 📅"
            );
          }
          resetFlow(chatId);
          state.processing = false;
          return;
        }

        state.data.consultorio = "odontologia general";
        state.step = 3.5;
        conversations.set(chatId, state);
        const message = buildDoctorSelectionMessage("general");
        await client.sendMessage(chatId, message);
        state.processing = false;
        return;
      }
    }

    if (state.step === 3.5) {
      const text = raw.trim();

      // Si dice NO cuando solo hay un doctor
      if (isDeny(text)) {
        await fetchTurnosFromServer("pediatria");
        const doctorsPediatria = getAvailableDoctors("pediatria");

        if (doctorsPediatria.available.length > 0) {
          await client.sendMessage(
            chatId,
            "Entendido. 👍\n\n✅ Aún tenemos turnos para *Odontopediatría* que solo se brinda a menores de *11 años*.\n\nSi deseas agendar para un menor, escribe *Cita*. 📝 ¡Apresúrate que son muy limitados!"
          );
        } else {
          await client.sendMessage(
            chatId,
            "Entendido. 👍 Si deseas reiniciar escribe la palabra *Cita*."
          );
        }
        resetFlow(chatId);
        state.processing = false;
        return;
      }

      const doctors = getAvailableDoctors("general");
      let validOptions = [];
      let currentOption = 1;

      if (doctors.available.includes("elio")) {
        validOptions.push({ num: currentOption.toString(), key: "elio" });
        currentOption++;
      }

      if (doctors.available.includes("manuel")) {
        validOptions.push({ num: currentOption.toString(), key: "manuel" });
        currentOption++;
      }

      const sinPreferenciaOption = currentOption.toString();

      if (text === validOptions.find((o) => o.key === "elio")?.num) {
        state.data.odontologoPreferido = "elio";
        state.step = 4;
        conversations.set(chatId, state);
        await client.sendMessage(
          chatId,
          `Has elegido al odontólogo *CD Elio Támara* ✅.\n\n━━━━━━━━━━━━━━━━\n*RESUMEN DE DATOS*\n━━━━━━━━━━━━━━━━\n\n👤 Nombre: *${state.data.nombre}*\n🆔 DNI: *${state.data.dni}*\n🎂 Edad: *${state.data.edad}*\n🦷 Consultorio: *${state.data.consultorio}*\n👨‍⚕️ Odontólogo: *CD Elio Támara*\n\n━━━━━━━━━━━━━━━━\n\nResponde *SÍ* para que te asigne el turno disponible con *CD Elio Támara*, o *NO* para cancelar.`
        );
        state.processing = false;
        return;
      } else if (text === validOptions.find((o) => o.key === "manuel")?.num) {
        state.data.odontologoPreferido = "manuel";
        state.step = 4;
        conversations.set(chatId, state);
        await client.sendMessage(
          chatId,
          `Has elegido al odontólogo *CD Manuel Romani* ✅.\n\n━━━━━━━━━━━━━━━━\n*RESUMEN DE DATOS*\n━━━━━━━━━━━━━━━━\n\n👤 Nombre: *${state.data.nombre}*\n🆔 DNI: *${state.data.dni}*\n🎂 Edad: *${state.data.edad}*\n🦷 Consultorio: *${state.data.consultorio}*\n👨‍⚕️ Odontólogo: *CD Manuel Romani*\n\n━━━━━━━━━━━━━━━━\n\nResponde *SÍ* para que te asigne el turno disponible con *CD Manuel Romani*, o *NO* para cancelar.`
        );
        state.processing = false;
        return;
      } else if (text === sinPreferenciaOption) {
        state.data.odontologoPreferido = null;
        state.step = 4;
        conversations.set(chatId, state);
        await client.sendMessage(
          chatId,
          `No tienes odontólogo preferido ✅.\n\n━━━━━━━━━━━━━━━━\n*RESUMEN DE DATOS*\n━━━━━━━━━━━━━━━━\n\n👤 Nombre: *${state.data.nombre}*\n🆔 DNI: *${state.data.dni}*\n🎂 Edad: *${state.data.edad}*\n🦷 Consultorio: *${state.data.consultorio}*\n👨‍⚕️ Odontólogo: *Cualquiera disponible*\n\n━━━━━━━━━━━━━━━━\n\nResponde *SÍ* para que te asigne el *turno más próximo disponible* con cualquiera de los odontólogos, o *NO* para cancelar.`
        );
        state.processing = false;
        return;
      } else {
        const message = buildDoctorSelectionMessage("general");
        await client.sendMessage(chatId, `❌ Opción inválida.\n\n${message}`);
        state.processing = false;
        return;
      }
    }

    if (state.step === 3.6) {
      const text = raw.trim();

      // Si dice NO cuando solo hay un doctor
      if (isDeny(text)) {
        await fetchTurnosFromServer("general");
        const doctorsGeneral = getAvailableDoctors("general");

        if (doctorsGeneral.available.length > 0) {
          await client.sendMessage(
            chatId,
            "Entendido. 👍\n\n✅ Aún tenemos turnos para *Odontología General* que solo se brinda a mayores de *11 años*.\n\nSi deseas agendar para un mayor, escribe *Cita*. 📝 ¡Apresúrate que son muy limitados!"
          );
        } else {
          await client.sendMessage(
            chatId,
            "Entendido. 👍 Si deseas reiniciar escribe la palabra *Cita*."
          );
        }
        resetFlow(chatId);
        state.processing = false;
        return;
      }

      const doctors = getAvailableDoctors("pediatria");
      let validOptions = [];
      let currentOption = 1;

      if (doctors.available.includes("jimy")) {
        validOptions.push({ num: currentOption.toString(), key: "jimy" });
        currentOption++;
      }

      if (doctors.available.includes("fernando")) {
        validOptions.push({ num: currentOption.toString(), key: "fernando" });
        currentOption++;
      }

      const manuelOption = currentOption.toString();
      currentOption++;
      const sinPreferenciaOption = currentOption.toString();

      if (text === validOptions.find((o) => o.key === "jimy")?.num) {
        state.data.odontologoPreferido = "jimy";
        state.data.consultorio = "odontopediatria";
        state.step = 4;
        conversations.set(chatId, state);
        await client.sendMessage(
          chatId,
          `Has elegido al odontopediatra *Esp. CD Jimy Osorio* ✅.\n\n━━━━━━━━━━━━━━━━\n*RESUMEN DE DATOS*\n━━━━━━━━━━━━━━━━\n\n👤 Nombre: *${state.data.nombre}*\n🆔 DNI: *${state.data.dni}*\n🎂 Edad: *${state.data.edad}*\n🦷 Consultorio: *${state.data.consultorio}*\n👨‍⚕️ Odontopediatra: *Esp. CD Jimy Osorio*\n\n━━━━━━━━━━━━━━━━\n\nResponde *SÍ* para que te asigne el turno disponible, o *NO* para cancelar.`
        );
        state.processing = false;
        return;
      } else if (text === validOptions.find((o) => o.key === "fernando")?.num) {
        state.data.odontologoPreferido = "fernando";
        state.data.consultorio = "odontopediatria";
        state.step = 4;
        conversations.set(chatId, state);
        await client.sendMessage(
          chatId,
          `Has elegido al odontopediatra *Esp. CD Fernando Bustamante* ✅.\n\n━━━━━━━━━━━━━━━━\n*RESUMEN DE DATOS*\n━━━━━━━━━━━━━━━━\n\n👤 Nombre: *${state.data.nombre}*\n🆔 DNI: *${state.data.dni}*\n🎂 Edad: *${state.data.edad}*\n🦷 Consultorio: *${state.data.consultorio}*\n👨‍⚕️ Odontopediatra: *Esp. CD Fernando Bustamante*\n\n━━━━━━━━━━━━━━━━\n\nResponde *SÍ* para que te asigne el turno disponible, o *NO* para cancelar.`
        );
        state.processing = false;
        return;
      } else if (text === manuelOption) {
        state.data.odontologoPreferido = "manuel";
        state.data.consultorio = "odontologia general";
        state.step = 4;
        conversations.set(chatId, state);
        await client.sendMessage(
          chatId,
          `El paciente tiene tratamiento previo con *CD Manuel Romani* ✅.\n\n━━━━━━━━━━━━━━━━\n*RESUMEN DE DATOS*\n━━━━━━━━━━━━━━━━\n\n👤 Nombre: *${state.data.nombre}*\n🆔 DNI: *${state.data.dni}*\n🎂 Edad: *${state.data.edad}*\n🦷 Consultorio: *${state.data.consultorio}*\n👨‍⚕️ Odontólogo: *CD Manuel Romani*\n\n━━━━━━━━━━━━━━━━\n\nResponde *SÍ* para que te asigne el turno disponible con *CD Manuel Romani*, o *NO* para cancelar.`
        );
        state.processing = false;
        return;
      } else if (text === sinPreferenciaOption) {
        state.data.odontologoPreferido = null;
        state.data.consultorio = "odontopediatria";
        state.step = 4;
        conversations.set(chatId, state);
        await client.sendMessage(
          chatId,
          `Sin preferencia de odontopediatra ✅.\n\n━━━━━━━━━━━━━━━━\n*RESUMEN DE DATOS*\n━━━━━━━━━━━━━━━━\n\n👤 Nombre: *${state.data.nombre}*\n🆔 DNI: *${state.data.dni}*\n🎂 Edad: *${state.data.edad}*\n🦷 Consultorio: *${state.data.consultorio}*\n👨‍⚕️ Odontopediatra: *Cualquiera disponible*\n\n━━━━━━━━━━━━━━━━\n\nResponde *SÍ* para que te asigne el *turno más próximo disponible* con cualquiera de los odontopediatras, o *NO* para cancelar.`
        );
        state.processing = false;
        return;
      } else {
        const message = buildDoctorSelectionMessage("pediatria", true);
        await client.sendMessage(chatId, `❌ Opción inválida.\n\n${message}`);
        state.processing = false;
        return;
      }
    }

    if (state.step === 4) {
      if (isAffirm(text)) {
        let slot = null;
        if (state.data.consultorio === "odontopediatria") {
          await fetchTurnosFromServer("pediatria");
          const normalized = turnosCache;
          if (normalized.length === 0) {
            await client.sendMessage(
              chatId,
              "Lo siento 😔, no hay turnos disponibles en este momento para *Odontopediatría*.\n\nEscríbanos el próximo *viernes a las 7:30 AM* 🕢 para reservar tu cita. 📅"
            );
            resetFlow(chatId);
            state.processing = false;
            return;
          }

          const odontologoPref = state.data.odontologoPreferido;

          if (odontologoPref) {
            const turnosPref = normalized.filter(
              (s) => s.profKey === odontologoPref
            );
            if (turnosPref.length > 0) {
              slot = turnosPref[0];
            } else {
              const otrosOdonto = ["jimy", "fernando"].filter(
                (k) => k !== odontologoPref
              );
              let slotAlterno = null;
              for (const otroDoc of otrosOdonto) {
                const turnosOtro = normalized.filter(
                  (s) => s.profKey === otroDoc
                );
                if (turnosOtro.length > 0) {
                  slotAlterno = turnosOtro[0];
                  break;
                }
              }
              if (slotAlterno) {
                slot = slotAlterno;
                await client.sendMessage(
                  chatId,
                  `⚠️ No hay turnos disponibles con *${detectProfDisplayFromKey(
                    odontologoPref
                  )}*.\n\nTe propongo un turno con *${slot.profTitle}*. 😊`
                );
              } else {
                await client.sendMessage(
                  chatId,
                  "Lo siento 😔, no hay turnos disponibles con ninguno de los odontopediatras.\n\nEscríbanos el próximo *viernes a las 7:30 AM* 🕢 para reservar tu cita. 📅"
                );
                resetFlow(chatId);
                state.processing = false;
                return;
              }
            }
          } else {
            const turnosJimy = normalized.filter((s) => s.profKey === "jimy");
            const turnosFernando = normalized.filter(
              (s) => s.profKey === "fernando"
            );
            if (turnosJimy.length === 0 && turnosFernando.length === 0) {
              await client.sendMessage(
                chatId,
                "Lo siento 😔, no hay turnos disponibles con ninguno de los odontopediatras.\n\nEscríbanos el próximo *viernes a las 7:30 AM* 🕢 para reservar tu cita. 📅"
              );
              resetFlow(chatId);
              state.processing = false;
              return;
            } else if (turnosJimy.length === 0) {
              slot = turnosFernando[0];
            } else if (turnosFernando.length === 0) {
              slot = turnosJimy[0];
            } else {
              slot =
                turnosJimy[0].startTime < turnosFernando[0].startTime
                  ? turnosJimy[0]
                  : turnosFernando[0];
            }
          }
        } else if (state.data.consultorio === "odontologia general") {
          await fetchTurnosFromServer("general");
          const normalized = turnosCache;

          if (normalized.length === 0) {
            await client.sendMessage(
              chatId,
              "Lo siento 😔, no hay turnos disponibles en este momento para *Odontología General*.\n\nEscríbanos el próximo *viernes a las 7:30 AM* 🕢 para reservar tu cita. 📅"
            );
            resetFlow(chatId);
            state.processing = false;
            return;
          }

          const odontologoPref = state.data.odontologoPreferido;

          if (odontologoPref) {
            const turnosPref = normalized.filter(
              (s) => s.profKey === odontologoPref
            );
            if (turnosPref.length > 0) {
              slot = turnosPref[0];
            } else {
              const otroDoc = odontologoPref === "elio" ? "manuel" : "elio";
              const turnosOtro = normalized.filter(
                (s) => s.profKey === otroDoc
              );
              if (turnosOtro.length > 0) {
                slot = turnosOtro[0];
                await client.sendMessage(
                  chatId,
                  `⚠️ No hay turnos disponibles con *${detectProfDisplayFromKey(
                    odontologoPref
                  )}*.\n\nTe propongo un turno con *${detectProfDisplayFromKey(
                    otroDoc
                  )}*. 😊`
                );
              } else {
                await client.sendMessage(
                  chatId,
                  "Lo siento 😔, no hay turnos disponibles con ninguno de los odontólogos.\n\nEscríbanos el próximo *viernes a las 7:30 AM* 🕢 para reservar tu cita. 📅"
                );
                resetFlow(chatId);
                state.processing = false;
                return;
              }
            }
          } else {
            const turnosElio = normalized.filter((s) => s.profKey === "elio");
            const turnosManuel = normalized.filter(
              (s) => s.profKey === "manuel"
            );
            if (turnosElio.length === 0 && turnosManuel.length === 0) {
              await client.sendMessage(
                chatId,
                "Lo siento 😔, no hay turnos disponibles con ninguno de los odontólogos.\n\nEscríbanos el próximo *viernes a las 7:30 AM* 🕢 para reservar tu cita. 📅"
              );
              resetFlow(chatId);
              state.processing = false;
              return;
            } else if (turnosElio.length === 0) {
              slot = turnosManuel[0];
            } else if (turnosManuel.length === 0) {
              slot = turnosElio[0];
            } else {
              slot =
                turnosElio[0].startTime < turnosManuel[0].startTime
                  ? turnosElio[0]
                  : turnosManuel[0];
            }
          }
        } else {
          await client.sendMessage(
            chatId,
            "❌ Consultorio no reconocido.\n\nPor favor reinicia con la palabra *Cita*."
          );
          resetFlow(chatId);
          state.processing = false;
          return;
        }

        const reserved = await removeSlotFromServer(
          slot.profKey,
          slot.startISO,
          slot.profTitle
        );
        if (!reserved) {
          await client.sendMessage(
            chatId,
            "Lo siento 😔, ese turno ya fue reservado por otra persona.\n\nIntenta de nuevo escribiendo *Cita*. 🔄"
          );
          resetFlow(chatId);
          state.processing = false;
          return;
        }

        state.pendingSlot = slot;
        state.step = 5;
        conversations.set(chatId, state);

        startReservationTimeout(chatId);

        const fh = formatFechaHora(slot.startISO);
        await client.sendMessage(
          chatId,
          `⚡ *¡Turno reservado temporalmente!* ⏱️\n\n⚠️ *IMPORTANTE:* Tienes *5 minutos* para confirmar, de lo contrario el turno será *liberado automáticamente*.\n\n━━━━━━━━━━━━━━━━\n*DETALLES DE LA CITA*\n━━━━━━━━━━━━━━━━\n\n👤 Nombre: *${state.data.nombre}*\n🆔 DNI: *${state.data.dni}*\n🎂 Edad: *${state.data.edad}*\n🦷 Consultorio: *${state.data.consultorio}*\n📅 Fecha: *${fh.fecha}*\n🕐 Hora: *${fh.hora}*\n👨‍⚕️ Doctor: *${slot.profTitle}*\n\n━━━━━━━━━━━━━━━━\n\n¿Confirmas esta cita? ✅ *SÍ* | ❌ *NO*\n\n💡 *Opcional:* Si deseas otro horario, indica tu preferencia:\n• Escribe: *tarde* o *mañana*\n• Escribe un día específico (ej: *lunes*, *martes*, *miércoles*)\n• O combina ambos (ej: *miércoles por la tarde*)`
        );
        state.processing = false;
        return;
      } else if (isDeny(text)) {
        resetFlow(chatId);
        await client.sendMessage(
          chatId,
          "Entendido. 👍 Si deseas reiniciar escribe la palabra *Cita*."
        );
        state.processing = false;
        return;
      } else {
        await client.sendMessage(
          chatId,
          "Por favor responde:\n\n✅ *SÍ* para continuar\n❌ *NO* para cancelar"
        );
        state.processing = false;
        return;
      }
    }

    if (state.step === 5) {
      if (isAffirm(text)) {
        const slot = state.pendingSlot;
        if (!slot) {
          await client.sendMessage(
            chatId,
            "❌ No hay turno pendiente.\n\nPor favor inicia de nuevo con *Cita*."
          );
          resetFlow(chatId);
          state.processing = false;
          return;
        }

        if (reservationTimeouts.has(chatId)) {
          clearTimeout(reservationTimeouts.get(chatId));
          reservationTimeouts.delete(chatId);
        }

        const fh = formatFechaHora(slot.startISO);
        const citaData = {
          nombre: state.data.nombre,
          dni: state.data.dni,
          edad: state.data.edad,
          consultorio: state.data.consultorio,
          profesional: slot.profTitle,
          fecha: fh.fecha,
          hora: fh.hora,
          chatId: chatId,
          status: "confirmada",
        };

        const saved = appendCitaRecord(citaData);
        if (!saved) {
          await addSlotBackToServer(
            slot.profKey,
            slot.startISO,
            slot.endISO,
            slot.profTitle,
            slot.especialidad
          );
          await client.sendMessage(
            chatId,
            "❌ Error al guardar su cita.\n\nPor favor intente de nuevo escribiendo *Cita*."
          );
          resetFlow(chatId);
          state.processing = false;
          return;
        }

        await client.sendMessage(
          chatId,
          `✅ *¡Cita confirmada exitosamente!* 🎉\n\n━━━━━━━━━━━━━━━━\n*RESUMEN DE TU CITA*\n━━━━━━━━━━━━━━━━\n\n👤 Nombre: *${state.data.nombre}*\n🆔 DNI: *${state.data.dni}*\n🎂 Edad: *${state.data.edad}*\n🦷 Consultorio: *${state.data.consultorio}*\n📅 Fecha: *${fh.fecha}*\n🕐 Hora: *${fh.hora}*\n👨‍⚕️ Doctor: *${slot.profTitle}*\n\n━━━━━━━━━━━━━━━━\n\n⏰ *Por favor llegar 10 minutos antes.*\n\n¡Gracias por confiar en nosotros! 😄✨`
        );

        await sendToAdmin(client, citaData, chatId);
        resetFlow(chatId);
        state.processing = false;
        return;
      }

      if (isChangeRequest(text)) {
        const pref = parsePreference(raw);
        console.log(`Preferencia parseada para "${raw}":`, pref);
        if (pref) {
          const esp =
            state.data.consultorio === "odontopediatria"
              ? "pediatria"
              : "general";
          await fetchTurnosFromServer(esp);
          const normalized = turnosCache;

          let candidatos = normalized;

          if (esp === "pediatria") {
            const odontologoPref = state.data.odontologoPreferido;
            if (odontologoPref) {
              candidatos = normalized.filter(
                (s) => s.profKey === odontologoPref
              );
            } else {
              candidatos = normalized.filter((s) =>
                ["jimy", "fernando"].includes(s.profKey)
              );
            }
          } else {
            const odontologoPref = state.data.odontologoPreferido;
            if (odontologoPref) {
              candidatos = normalized.filter(
                (s) => s.profKey === odontologoPref
              );
            } else {
              candidatos = normalized.filter(
                (s) => s.profKey === "elio" || s.profKey === "manuel"
              );
            }
          }

          const newSlot = findFirstSlotForConsultorio(
            candidatos,
            state.data.consultorio,
            pref
          );

          if (!newSlot) {
            const odontologoNombre =
              esp === "pediatria"
                ? state.data.odontologoPreferido
                  ? detectProfDisplayFromKey(state.data.odontologoPreferido)
                  : "odontopediatra seleccionado"
                : state.data.odontologoPreferido
                ? detectProfDisplayFromKey(state.data.odontologoPreferido)
                : "odontólogo seleccionado";

            const fhActual = formatFechaHora(state.pendingSlot.startISO);
            await client.sendMessage(
              chatId,
              `😔 Lo siento, no hay turnos disponibles para *"${raw}"* con el *${odontologoNombre}*.\n\n✅ Mantengo el turno actual:\n\n📅 Fecha: *${fhActual.fecha}*\n🕐 Hora: *${fhActual.hora}*\n👨‍⚕️ Doctor: *${state.pendingSlot.profTitle}*\n\n¿Confirmas este turno? (✅ *SÍ* / ❌ *NO*)\n\n💡 Puedes intentar con otra preferencia.`
            );
            state.processing = false;
            return;
          }

          const reserved = await removeSlotFromServer(
            newSlot.profKey,
            newSlot.startISO,
            newSlot.profTitle
          );

          if (!reserved) {
            const fh = formatFechaHora(state.pendingSlot.startISO);
            await client.sendMessage(
              chatId,
              `😔 Lo siento, el turno para *"${raw}"* ya fue reservado por otra persona.\n\n✅ Mantengo el turno actual:\n\n📅 Fecha: *${fh.fecha}*\n🕐 Hora: *${fh.hora}*\n👨‍⚕️ Doctor: *${state.pendingSlot.profTitle}*\n\n¿Confirmas este turno? (✅ *SÍ* / ❌ *NO*)`
            );
            state.processing = false;
            return;
          }

          if (state.pendingSlot) {
            await addSlotBackToServer(
              state.pendingSlot.profKey,
              state.pendingSlot.startISO,
              state.pendingSlot.endISO,
              state.pendingSlot.profTitle,
              state.pendingSlot.especialidad
            );
          }

          state.pendingSlot = newSlot;
          conversations.set(chatId, state);
          startReservationTimeout(chatId);

          const fh = formatFechaHora(newSlot.startISO);
          await client.sendMessage(
            chatId,
            `🔄 *Nuevo turno encontrado* para *"${raw}"*:\n\n📅 Fecha: *${fh.fecha}*\n🕐 Hora: *${fh.hora}*\n👨‍⚕️ Doctor: *${newSlot.profTitle}*\n\n⏰ Tienes *5 minutos* para confirmar.\n\n¿Confirmas? (✅ *SÍ* / ❌ *NO*)`
          );
          state.processing = false;
          return;
        }
      }

      const pref = parsePreference(raw);
      console.log(`Preferencia parseada para "${raw}":`, pref);
      if (pref) {
        const esp =
          state.data.consultorio === "odontopediatria"
            ? "pediatria"
            : "general";
        await fetchTurnosFromServer(esp);
        const normalized = turnosCache;

        let candidatos = normalized;

        if (esp === "pediatria") {
          const odontologoPref = state.data.odontologoPreferido;
          if (odontologoPref) {
            candidatos = normalized.filter((s) => s.profKey === odontologoPref);
          } else {
            candidatos = normalized.filter((s) =>
              ["jimy", "fernando"].includes(s.profKey)
            );
          }
        } else {
          const odontologoPref = state.data.odontologoPreferido;
          if (odontologoPref) {
            candidatos = normalized.filter((s) => s.profKey === odontologoPref);
          } else {
            candidatos = normalized.filter(
              (s) => s.profKey === "elio" || s.profKey === "manuel"
            );
          }
        }

        const newSlot = findFirstSlotForConsultorio(
          candidatos,
          state.data.consultorio,
          pref
        );

        if (!newSlot) {
          const odontologoNombre =
            esp === "pediatria"
              ? state.data.odontologoPreferido
                ? detectProfDisplayFromKey(state.data.odontologoPreferido)
                : "odontopediatra seleccionado"
              : state.data.odontologoPreferido
              ? detectProfDisplayFromKey(state.data.odontologoPreferido)
              : "odontólogo seleccionado";

          const fhActual = formatFechaHora(state.pendingSlot.startISO);
          await client.sendMessage(
            chatId,
            `😔 Lo siento, no hay turnos disponibles para *"${raw}"* con el *${odontologoNombre}*.\n\n✅ Mantengo el turno actual:\n\n📅 Fecha: *${fhActual.fecha}*\n🕐 Hora: *${fhActual.hora}*\n👨‍⚕️ Doctor: *${state.pendingSlot.profTitle}*\n\n¿Confirmas este turno? (✅ *SÍ* / ❌ *NO*)\n\n💡 Puedes intentar con otra preferencia.`
          );
          state.processing = false;
          return;
        }

        const reserved = await removeSlotFromServer(
          newSlot.profKey,
          newSlot.startISO,
          newSlot.profTitle
        );

        if (!reserved) {
          const fh = formatFechaHora(state.pendingSlot.startISO);
          await client.sendMessage(
            chatId,
            `😔 Lo siento, el turno para *"${raw}"* ya fue reservado por otra persona.\n\n✅ Mantengo el turno actual:\n\n📅 Fecha: *${fh.fecha}*\n🕐 Hora: *${fh.hora}*\n👨‍⚕️ Doctor: *${state.pendingSlot.profTitle}*\n\n¿Confirmas este turno? (✅ *SÍ* / ❌ *NO*)`
          );
          state.processing = false;
          return;
        }

        if (state.pendingSlot) {
          await addSlotBackToServer(
            state.pendingSlot.profKey,
            state.pendingSlot.startISO,
            state.pendingSlot.endISO,
            state.pendingSlot.profTitle,
            state.pendingSlot.especialidad
          );
        }

        state.pendingSlot = newSlot;
        conversations.set(chatId, state);
        startReservationTimeout(chatId);

        const fh = formatFechaHora(newSlot.startISO);
        await client.sendMessage(
          chatId,
          `🔄 *Nuevo turno encontrado* para *"${raw}"*:\n\n📅 Fecha: *${fh.fecha}*\n🕐 Hora: *${fh.hora}*\n👨‍⚕️ Doctor: *${newSlot.profTitle}*\n\n⏰ Tienes *5 minutos* para confirmar.\n\n¿Confirmas? (✅ *SÍ* / ❌ *NO*)`
        );
        state.processing = false;
        return;
      }

      if (isDeny(text)) {
        await releasePendingSlot(chatId);
        resetFlow(chatId);
        await client.sendMessage(
          chatId,
          "Entendido. 👍 Si deseas reiniciar escribe *Cita*."
        );
        state.processing = false;
        return;
      }

      await client.sendMessage(
        chatId,
        "❓ No entendí tu respuesta.\n\nPor favor responde:\n\n✅ *SÍ* para confirmar la cita\n❌ *NO* para cancelar la cita\n\n💡 *Opcional:* Indica una preferencia de horario:\n• *tarde* o *mañana*\n• Un día específico (ej: *lunes*, *martes*, *miércoles*)\n• O combina ambos (ej: *miércoles por la tarde*)"
      );
      state.processing = false;
      return;
    }

    if (state.step === 6) {
      const existingCita = findCitaByDni(state.data.dni);
      if (!existingCita) {
        await client.sendMessage(
          chatId,
          "❌ No encontré una cita con ese número de DNI.\n\n¿Quieres reservar una nueva? Escribe *Cita*. 📝"
        );
        resetFlow(chatId);
        state.processing = false;
        return;
      }
      let oldStartISO;
      if (existingCita.startUTC) {
        oldStartISO = existingCita.startUTC;
      } else {
        const fechaISO = parseFechaLocal(existingCita.fecha);
        const horaLimpia = limpiarHora(existingCita.hora);
        const localDateTime = `${fechaISO}T${horaLimpia}:00.000`;
        oldStartISO = new Date(localDateTime).toISOString();
      }
      const oldEndISO = new Date(
        new Date(oldStartISO).getTime() + 40 * 60 * 1000
      ).toISOString();
      const oldProfKey = detectProfKeyFromString(existingCita.profesional);
      const oldProfTitle = existingCita.profesional;
      const oldEsp =
        existingCita.consultorio === "odontopediatria"
          ? "pediatria"
          : "general";
      const addedBack = await addSlotBackToServer(
        oldProfKey,
        oldStartISO,
        oldEndISO,
        oldProfTitle,
        oldEsp
      );
      if (addedBack) {
        const citas = readJsonFileSafe(CITAS_FILE, true);
        const citaIdx = citas.findIndex(
          (c) => c.dni === state.data.dni && c.status !== "cancelada"
        );
        if (citaIdx !== -1) {
          citas[citaIdx].status = "cancelada";
          citas[citaIdx].cancelledAt = new Date().toISOString();
          writeJsonFileSafe(CITAS_FILE, citas);
        }
        await client.sendMessage(
          chatId,
          `✅ Cita anterior *cancelada exitosamente*.\n\n🔍 Buscando nuevo turno para *${
            state.data.consultorio || existingCita.consultorio
          }*... ⏳\n\n💡 Si deseas, indica una preferencia:\n• *tarde* o *mañana*\n• Un día específico (ej: *lunes*, *martes*, *miércoles*)\n• O combina ambos (ej: *jueves por la mañana*)`
        );
        const esp =
          existingCita.consultorio === "odontopediatria"
            ? "pediatria"
            : "general";
        await fetchTurnosFromServer(esp);
        const normalized = turnosCache;
        const newSlot = findFirstSlotForConsultorio(
          normalized,
          existingCita.consultorio
        );
        if (newSlot) {
          const reserved = await removeSlotFromServer(
            newSlot.profKey,
            newSlot.startISO,
            newSlot.profTitle
          );
          if (!reserved) {
            await client.sendMessage(
              chatId,
              "😔 El turno encontrado ya fue reservado.\n\nIntenta de nuevo escribiendo *Cita*. 🔄"
            );
            resetFlow(chatId);
            state.processing = false;
            return;
          }
          state.pendingSlot = newSlot;
          state.data.nombre = existingCita.nombre;
          state.data.edad = existingCita.edad;
          state.data.consultorio = existingCita.consultorio;
          state.step = 5;
          conversations.set(chatId, state);
          startReservationTimeout(chatId);
          const fh = formatFechaHora(newSlot.startISO);
          await client.sendMessage(
            chatId,
            `✨ *Nuevo turno propuesto:*\n\n📅 Fecha: *${fh.fecha}*\n🕐 Hora: *${fh.hora}*\n👨‍⚕️ Doctor: *${newSlot.profTitle}*\n\n⏰ Tienes *5 minutos* para confirmar.\n\n¿Confirmas? (✅ *SÍ* / ❌ *NO*)\n\n💡 *Opcional:* Si deseas otro horario, indica tu preferencia.`
          );
        } else {
          await client.sendMessage(
            chatId,
            "😔 No hay turnos disponibles en este momento.\n\nIntenta más tarde o escribe *Cita* el próximo *viernes a las 7:30 AM* 🕢. 📅"
          );
          resetFlow(chatId);
        }
      } else {
        await client.sendMessage(
          chatId,
          "❌ Error al cancelar la cita anterior.\n\nPor favor contacta al administrador. 📞"
        );
        resetFlow(chatId);
      }
      state.processing = false;
      return;
    }

    state.processing = false;
    conversations.set(chatId, state);
  } catch (err) {
    console.error("Error en mensaje:", err);
    try {
      await client.sendMessage(
        msg.from,
        "❌ Ocurrió un error interno.\n\nIntenta de nuevo escribiendo *Cita*. 🔄"
      );
    } catch (e) {
      console.error("Error enviando mensaje de error:", e);
    }
    const s = conversations.get(msg.from);
    if (s) {
      s.processing = false;
      conversations.set(msg.from, s);
    }
  }
});

async function handleChangeRequest(chatId, state) {
  if (!state.data.dni) {
    await client.sendMessage(
      chatId,
      "Para cambiar tu cita, proporciona tu número de *DNI*. 🆔"
    );
    state.step = 2;
  } else {
    state.step = 6;
  }
}

// ========== FUNCIONES DE HORARIO ==========
function getCurrentPeruTime() {
  // UTC-5 para Perú
  const now = new Date();
  const peruTime = new Date(now.getTime() - 5 * 60 * 60 * 1000);
  return peruTime;
}

function isFridayActiveHours() {
  const peruTime = getCurrentPeruTime();
  const dayOfWeek = peruTime.getUTCDay(); // 5 = viernes
  const hours = peruTime.getUTCHours();
  const minutes = peruTime.getUTCMinutes();

  // Verifica si es viernes (día 5)
  if (dayOfWeek !== 5) return false;

  // Verifica si está entre 7:30 y 11:00
  const currentTimeInMinutes = hours * 60 + minutes;
  const startTime = 7 * 60 + 30; // 7:30 AM = 450 minutos
  const endTime = 11 * 60; // 11:00 AM = 660 minutos

  return currentTimeInMinutes >= startTime && currentTimeInMinutes < endTime;
}

function getOutOfHoursMessage() {
  const peruTime = getCurrentPeruTime();
  const dayOfWeek = peruTime.getUTCDay();
  const hours = peruTime.getUTCHours();
  const minutes = peruTime.getUTCMinutes();
  const currentTimeInMinutes = hours * 60 + minutes;
  const startTime = 7 * 60 + 30;

  // Viernes antes de las 7:30 AM
  if (dayOfWeek === 5 && currentTimeInMinutes < startTime) {
    return "Buenos días, escríbanos por favor en nuestro horario de atención exactamente a las *7:30 a. m.* ⏰";
  }

  // Viernes después de las 11:00 AM
  if (dayOfWeek === 5 && currentTimeInMinutes >= 11 * 60) {
    return "Los cupos de atención ya se agotaron. 😔\n\nPor favor, escríbenos el próximo *viernes a partir de las 7:30 a. m.* 📅";
  }

  // Cualquier otro día (sábado a jueves)
  return "Las citas se asignan únicamente los días *viernes desde las 7:30 a. m.* 📅⏰";
}

const BOT_START_TS = Math.floor(Date.now() / 1000);

client.initialize();

console.log("🤖 BOT INICIANDO...");
