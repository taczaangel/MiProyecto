const express = require("express");
const path = require("path");
const fs = require("fs");
const users = require("./users");

const app = express();
const PORT = process.env.PORT || 3000;


app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const TURNOS_FILE = path.join(__dirname, "turnos.json");
const CITAS_FILE = path.join(__dirname, "citas.json"); // Para citas confirmadas

app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

app.post("/login", (req, res) => {
  const { username, password } = req.body;
  const user = users.find(
    (u) => u.username === username && u.password === password
  );

  if (user) {
    res.redirect(`/turnos.html?rol=${user.rol}&color=${user.color}`);
  } else {
    res.send('<h2>Credenciales incorrectas</h2><a href="/">Volver</a>');
  }
});

function getProfKeyFromString(str) {
  const s = (str || "").toLowerCase();
  if (s.includes("elio") || s.includes("támara")) return "elio";
  if (s.includes("manuel") || s.includes("romani")) return "manuel";
  if (s.includes("jimy") || s.includes("osorio")) return "jimy";
  if (s.includes("fernando") || s.includes("bustamante")) return "fernando";
  return s || "otro";
}

function getColorForProf(profKey) {
  switch (profKey) {
    case "elio":
      return "#007bff";
    case "manuel":
      return "#28a745";
    case "jimy":
      return "#dc3545";
    case "fernando":
      return "#ffc107";
    default:
      return "#6c757d";
  }
}

function getEspecialidadFromProf(profKey) {
  switch (profKey) {
    case "jimy":
    case "fernando":
      return "pediatria";
    default:
      return "general";
  }
}

function arrayToObjByProf(arrayPlano) {
  const obj = { elio: [], manuel: [], jimy: [], fernando: [] };
  arrayPlano.forEach((item) => {
    if (!item.profesional && !item.title) return;
    const profKey = getProfKeyFromString(item.profesional || item.title);
    if (!obj[profKey]) return;

    const start = item.turnoInicio || item.start || item.startISO;
    const end = item.turnoFin || item.end || item.endISO;
    if (!start) return;

    const evento = {
      title: item.title || item.profesional || profKey,
      start: typeof start === "string" ? start : start.toISOString(),
      end: end ? (typeof end === "string" ? end : end.toISOString()) : null,
      backgroundColor: item.backgroundColor || getColorForProf(profKey),
      borderColor: item.borderColor || getColorForProf(profKey),
      allDay: item.allDay || false,
      especialidad: item.especialidad || getEspecialidadFromProf(profKey),
    };
    obj[profKey].push(evento);
  });
  return obj;
}

function objToArrayPlano(objByProf) {
  const array = [];
  ["elio", "manuel", "jimy", "fernando"].forEach((key) => {
    if (Array.isArray(objByProf[key])) {
      objByProf[key].forEach((evento) => {
        array.push({
          profesional: key,
          title: evento.title,
          turnoInicio: evento.start,
          turnoFin: evento.end,
          backgroundColor: evento.backgroundColor,
          borderColor: evento.borderColor,
          allDay: evento.allDay,
          especialidad: evento.especialidad,
        });
      });
    }
  });
  return array;
}

app.post("/guardar-turno", (req, res) => {
  let turnosToSave;
  if (Array.isArray(req.body)) {
    turnosToSave = arrayToObjByProf(req.body);
  } else if (typeof req.body === "object" && req.body.elio !== undefined) {
    turnosToSave = { ...req.body };
    fs.readFile(TURNOS_FILE, "utf8", (err, data) => {
      let existentes = { elio: [], manuel: [], jimy: [], fernando: [] };
      if (!err && data) {
        try {
          const parsed = JSON.parse(data);
          if (typeof parsed === "object" && !Array.isArray(parsed)) {
            existentes = parsed;
          } else if (Array.isArray(parsed)) {
            existentes = arrayToObjByProf(parsed);
          }
        } catch (e) {
          console.error("Error parseando existentes:", e);
        }
      }

      ["elio", "manuel", "jimy", "fernando"].forEach((key) => {
        const nuevos = Array.isArray(turnosToSave[key])
          ? turnosToSave[key]
          : [];
        const existentesKey = existentes[key] || [];
        turnosToSave[key] = [...existentesKey];
        nuevos.forEach((nuevo) => {
          const yaExiste = existentesKey.some(
            (e) =>
              new Date(e.start).toISOString() ===
                new Date(nuevo.start).toISOString() &&
              new Date(e.end || e.start).toISOString() ===
                new Date(nuevo.end || nuevo.start).toISOString()
          );
          if (!yaExiste) {
            nuevo.especialidad =
              nuevo.especialidad || getEspecialidadFromProf(key);
            turnosToSave[key].push(nuevo);
          }
        });
      });

      fs.writeFile(
        TURNOS_FILE,
        JSON.stringify(turnosToSave, null, 2),
        "utf8",
        (err) => {
          if (err) {
            console.error("Error guardando turnos:", err);
            return res.status(500).json({ message: "Error al guardar turnos" });
          }
          console.log(
            "💾 Turnos guardados (merge):",
            Object.keys(turnosToSave).map(
              (k) => `${k}: ${turnosToSave[k].length}`
            )
          );
          res.json({ message: "Turnos guardados correctamente" });
        }
      );
    });
    return;
  } else {
    turnosToSave = arrayToObjByProf([req.body]);
  }

  fs.writeFile(
    TURNOS_FILE,
    JSON.stringify(turnosToSave, null, 2),
    "utf8",
    (err) => {
      if (err) {
        console.error("Error guardando turnos:", err);
        return res.status(500).json({ message: "Error al guardar turnos" });
      }
      console.log(
        "💾 Turnos guardados (simple):",
        Object.keys(turnosToSave).map((k) => `${k}: ${turnosToSave[k].length}`)
      );
      res.json({ message: "Turnos guardados correctamente" });
    }
  );
});

app.get("/obtener-turnos", (req, res) => {
  const especialidad = req.query.especialidad;
  const now = new Date();
  now.setUTCHours(0, 0, 0, 0);

  fs.readFile(TURNOS_FILE, "utf8", (err, data) => {
    if (err) {
      if (err.code === "ENOENT") {
        const initial = { elio: [], manuel: [], jimy: [], fernando: [] };
        fs.writeFileSync(TURNOS_FILE, JSON.stringify(initial, null, 2), "utf8");
        console.log("📄 turnos.json creado inicial");
        return res.json([]);
      }
      console.error("Error al leer turnos.json:", err);
      return res.status(500).json({ message: "Error al leer turnos" });
    }

    try {
      let turnos = JSON.parse(data);
      if (!turnos) turnos = [];

      let agrupados = {};
      if (typeof turnos === "object" && !Array.isArray(turnos)) {
        turnos = objToArrayPlano(turnos);
      }

      turnos.forEach((t) => {
        if (!t.turnoInicio && !t.start) return;
        const start = t.turnoInicio || t.start;
        const end = t.turnoFin || t.end;
        if (!start || !end) return;
        const startDate = new Date(start);
        if (startDate < now) return;

        let isHeldActive = false;
        if (t.heldBy && t.heldUntil) {
          const heldUntil = new Date(t.heldUntil);
          if (heldUntil > now) {
            isHeldActive = true;
            console.log(
              `⏳ Slot en hold activo: ${t.title || "Desconocido"} ${startDate
                .toISOString()
                .slice(11, 16)}Z`
            );
            return;
          } else {
            t.heldBy = null;
            t.heldUntil = null;
            console.log(
              `🕐 Hold expirado auto: ${t.title || "Desconocido"} ${startDate
                .toISOString()
                .slice(11, 16)}Z`
            );
          }
        }
        if (isHeldActive) return;

        const profesional = t.profesional || t.title || "Desconocido";
        const profKey = getProfKeyFromString(profesional);
        const esp = t.especialidad || getEspecialidadFromProf(profKey);
        // Filtrar por especialidad si se pide
        if (especialidad && esp !== especialidad) return;
        const date = startDate.toISOString().split("T")[0];
        const horaInicio = `${startDate
          .getUTCHours()
          .toString()
          .padStart(2, "0")}:${startDate
          .getUTCMinutes()
          .toString()
          .padStart(2, "0")}`;
        const horaFin = (() => {
          const endDate = new Date(end);
          return `${endDate.getUTCHours().toString().padStart(2, "0")}:${endDate
            .getUTCMinutes()
            .toString()
            .padStart(2, "0")}`;
        })();

        const key = `${profesional}_${date}`;
        if (!agrupados[key]) {
          agrupados[key] = {
            title: profesional,
            date,
            slots: [],
            color: getColorForProf(profKey),
            especialidad: esp,
          };
        }
        agrupados[key].slots.push({ start: horaInicio, end: horaFin });
      });

      const result = Object.values(agrupados);
      console.log(
        `📖 Turnos obtenidos (futuros${
          especialidad ? `, ${especialidad}` : ""
        }): ${result.length} grupos`
      );
      res.json(result);
    } catch (e) {
      console.error("Error al procesar turnos:", e);
      res.status(500).json({ message: "Error al procesar turnos" });
    }
  });
});

app.get("/obtener-citas", (req, res) => {
  fs.readFile(CITAS_FILE, "utf8", (err, data) => {
    if (err) {
      if (err.code === "ENOENT") {
        const initial = [];
        fs.writeFileSync(CITAS_FILE, JSON.stringify(initial, null, 2), "utf8");
        return res.json([]);
      }
      console.error("Error al leer citas.json:", err);
      return res.status(500).json({ message: "Error al leer citas" });
    }

    try {
      const citas = JSON.parse(data);
      if (!Array.isArray(citas)) citas = [];
      console.log(`📖 Citas obtenidas: ${citas.length}`);
      res.json(citas);
    } catch (e) {
      console.error("Error al procesar citas:", e);
      res.status(500).json({ message: "Error al procesar citas" });
    }
  });
});

app.post("/reservar-turno", (req, res) => {
  const { profesional, turnoInicio, userJid } = req.body;
  if (!profesional || !turnoInicio) {
    return res
      .status(400)
      .json({ message: "Se requiere profesional y turnoInicio" });
  }

  const profKey = getProfKeyFromString(profesional);
  const startISO = new Date(turnoInicio).toISOString();

  fs.readFile(TURNOS_FILE, "utf8", (err, data) => {
    let turnosObj = { elio: [], manuel: [], jimy: [], fernando: [] };
    if (err || !data) {
      return res.status(404).json({ message: "Turno no encontrado" });
    }

    try {
      const parsed = JSON.parse(data);
      if (typeof parsed === "object" && !Array.isArray(parsed)) {
        turnosObj = parsed;
      } else if (Array.isArray(parsed)) {
        turnosObj = arrayToObjByProf(parsed);
      }
    } catch (e) {
      console.error("Error parseando:", e);
      return res.status(500).json({ message: "Error al leer turnos" });
    }

    const list = turnosObj[profKey] || [];
    const idx = list.findIndex(
      (e) => new Date(e.start).toISOString() === startISO
    );
    if (idx === -1) {
      return res
        .status(404)
        .json({ message: "Turno no encontrado (ya reservado?)" });
    }

    const eliminado = list.splice(idx, 1)[0];
    turnosObj[profKey] = list;

    fs.writeFile(
      TURNOS_FILE,
      JSON.stringify(turnosObj, null, 2),
      "utf8",
      (err) => {
        if (err) {
          console.error("Error al actualizar turnos:", err);
          return res
            .status(500)
            .json({ message: "Error al actualizar turnos" });
        }
        console.log("🔒 Turno reservado:", eliminado.title, startISO);
        res.json({ message: "Turno reservado correctamente", eliminado });
      }
    );
  });
});

app.post("/liberar-turno", (req, res) => {
  const { profesional, turnoInicio, turnoFin, title, especialidad } = req.body;
  if (!profesional || !turnoInicio) {
    return res
      .status(400)
      .json({ message: "Se requiere profesional y turnoInicio" });
  }

  const profKey = getProfKeyFromString(profesional);
  const startISO = new Date(turnoInicio).toISOString();
  const endISO = turnoFin ? new Date(turnoFin).toISOString() : null;

  fs.readFile(TURNOS_FILE, "utf8", (err, data) => {
    let turnosObj = { elio: [], manuel: [], jimy: [], fernando: [] };
    if (err || !data) {
      return res.status(500).json({ message: "Error al leer turnos" });
    }

    try {
      const parsed = JSON.parse(data);
      if (typeof parsed === "object" && !Array.isArray(parsed)) {
        turnosObj = parsed;
      } else if (Array.isArray(parsed)) {
        turnosObj = arrayToObjByProf(parsed);
      }
    } catch (e) {
      console.error("Error parseando:", e);
      return res.status(500).json({ message: "Error al leer turnos" });
    }

    const list = turnosObj[profKey] || [];
    const yaExiste = list.some(
      (e) => new Date(e.start).toISOString() === startISO
    );
    if (yaExiste) {
      return res.status(409).json({ message: "Turno ya disponible" });
    }

    const nuevo = {
      title: title || profesional,
      start: startISO,
      end: endISO,
      backgroundColor: getColorForProf(profKey),
      borderColor: getColorForProf(profKey),
      allDay: false,
      especialidad: especialidad || getEspecialidadFromProf(profKey),
      heldBy: null,
      heldUntil: null,
    };

    if (nuevo.heldBy) {
      nuevo.heldBy = null;
      nuevo.heldUntil = null;
      console.log(
        `🔄 Held limpiado en liberación: ${profesional} ${startISO.slice(
          11,
          16
        )}Z`
      );
    }

    list.push(nuevo);
    turnosObj[profKey] = list;

    fs.writeFile(
      TURNOS_FILE,
      JSON.stringify(turnosObj, null, 2),
      "utf8",
      (err) => {
        if (err) {
          console.error("Error al actualizar turnos:", err);
          return res
            .status(500)
            .json({ message: "Error al actualizar turnos" });
        }
        console.log("🔓 Turno liberado:", nuevo.title, startISO);
        res.json({ message: "Turno liberado correctamente", nuevo });
      }
    );
  });
});

app.post("/hold-turno", (req, res) => {
  const { profesional, turnoInicio, userJid } = req.body;
  if (!profesional || !turnoInicio || !userJid) {
    return res.status(400).json({
      error: "Faltan datos: profesional, turnoInicio (ISO Z), userJid",
    });
  }

  const profKey = getProfKeyFromString(profesional);
  const startISO = new Date(turnoInicio).toISOString();
  const now = new Date();
  const holdUntil = new Date(now.getTime() + 5 * 60 * 1000).toISOString();

  fs.readFile(TURNOS_FILE, "utf8", (err, data) => {
    let turnosObj = { elio: [], manuel: [], jimy: [], fernando: [] };
    if (err || !data) {
      return res.status(404).json({ error: "No se pudo leer turnos.json" });
    }

    try {
      const parsed = JSON.parse(data);
      if (typeof parsed === "object" && !Array.isArray(parsed)) {
        turnosObj = parsed;
      } else if (Array.isArray(parsed)) {
        turnosObj = arrayToObjByProf(parsed);
      }
    } catch (e) {
      console.error("Error parseando en /hold-turno:", e);
      return res.status(500).json({ error: "Error al leer turnos" });
    }

    const list = turnosObj[profKey] || [];
    const idx = list.findIndex(
      (e) => new Date(e.start).toISOString() === startISO
    );
    if (idx === -1) {
      return res.status(404).json({ error: "Slot no encontrado" });
    }

    const evento = list[idx];
    // Chequea si libre (no held activo, no reservado – asumimos reserved no existe, ya que splicea)
    if (evento.heldBy && new Date(evento.heldUntil) > now) {
      return res
        .status(409)
        .json({ error: "Slot ya en hold por otro usuario" });
    }

    // Set hold
    evento.heldBy = userJid;
    evento.heldUntil = holdUntil;
    turnosObj[profKey] = list; // Actualiza lista

    fs.writeFile(
      TURNOS_FILE,
      JSON.stringify(turnosObj, null, 2),
      "utf8",
      (err) => {
        if (err) {
          console.error("Error al guardar hold:", err);
          return res.status(500).json({ error: "Error al guardar hold" });
        }
        console.log(
          `⏳ Hold temporal creado: ${profesional} ${startISO.slice(
            11,
            16
          )}Z por ${userJid} hasta ${holdUntil.slice(11, 16)}Z`
        );
        res.json({
          success: true,
          message: "Hold temporal creado (5 min)",
          holdUntil,
        });
      }
    );
  });
});

// ======== LIBERAR HOLD TEMPORAL (devuelve slot a disponible) ========
app.post("/liberar-hold", (req, res) => {
  const { profesional, turnoInicio, userJid } = req.body;
  if (!profesional || !turnoInicio || !userJid) {
    return res.status(400).json({
      error: "Faltan datos: profesional, turnoInicio (ISO Z), userJid",
    });
  }

  const profKey = getProfKeyFromString(profesional);
  const startISO = new Date(turnoInicio).toISOString();
  const now = new Date();

  fs.readFile(TURNOS_FILE, "utf8", (err, data) => {
    let turnosObj = { elio: [], manuel: [], jimy: [], fernando: [] };
    if (err || !data) {
      return res.status(404).json({ error: "No se pudo leer turnos.json" });
    }

    try {
      const parsed = JSON.parse(data);
      if (typeof parsed === "object" && !Array.isArray(parsed)) {
        turnosObj = parsed;
      } else if (Array.isArray(parsed)) {
        turnosObj = arrayToObjByProf(parsed);
      }
    } catch (e) {
      console.error("Error parseando en /liberar-hold:", e);
      return res.status(500).json({ error: "Error al leer turnos" });
    }

    const list = turnosObj[profKey] || [];
    const idx = list.findIndex(
      (e) =>
        new Date(e.start).toISOString() === startISO && e.heldBy === userJid
    );
    if (idx === -1) {
      return res
        .status(404)
        .json({ error: "Hold no encontrado o no pertenece a este usuario" });
    }

    const evento = list[idx];
    // Limpia hold
    evento.heldBy = null;
    evento.heldUntil = null;
    turnosObj[profKey] = list; // Actualiza

    fs.writeFile(
      TURNOS_FILE,
      JSON.stringify(turnosObj, null, 2),
      "utf8",
      (err) => {
        if (err) {
          console.error("Error al liberar hold:", err);
          return res.status(500).json({ error: "Error al liberar hold" });
        }
        console.log(
          `🔓 Hold liberado: ${profesional} ${startISO.slice(
            11,
            16
          )}Z por ${userJid}`
        );
        res.json({ success: true, message: "Hold liberado correctamente" });
      }
    );
  });
});

app.listen(PORT, () => {
  console.log(`✅ Servidor corriendo en http://localhost:${PORT}`);
  console.log(`📄 Archivos: turnos.json y citas.json listos para uso.`);
});

