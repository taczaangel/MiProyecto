const express = require("express");
const path = require("path");
const users = require("./users");
const pool = require("./db");

require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
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

// POST /guardar-turno - Guardar múltiples turnos
app.post("/guardar-turno", async (req, res) => {
  try {
    let turnosToSave = req.body;

    // Si viene como array, convertir a objeto por profesional
    if (Array.isArray(turnosToSave)) {
      const obj = { elio: [], manuel: [], jimy: [], fernando: [] };
      turnosToSave.forEach((item) => {
        const profKey = getProfKeyFromString(item.profesional || item.title);
        if (obj[profKey]) {
          const start = item.turnoInicio || item.start || item.startISO;
          const end = item.turnoFin || item.end || item.endISO;
          if (start) {
            obj[profKey].push({
              title: item.title || item.profesional || profKey,
              start: typeof start === "string" ? start : start.toISOString(),
              end: end
                ? typeof end === "string"
                  ? end
                  : end.toISOString()
                : null,
              backgroundColor: item.backgroundColor || getColorForProf(profKey),
              borderColor: item.borderColor || getColorForProf(profKey),
              especialidad:
                item.especialidad || getEspecialidadFromProf(profKey),
            });
          }
        }
      });
      turnosToSave = obj;
    }

    let totalInsertados = 0;

    // Insertar turnos por profesional
    for (const [profesional, eventos] of Object.entries(turnosToSave)) {
      if (!Array.isArray(eventos)) continue;

      for (const evento of eventos) {
        // Verificar si ya existe
        const existe = await pool.query(
          `SELECT id FROM turnos 
           WHERE profesional = $1 AND start_time = $2`,
          [profesional, evento.start]
        );

        if (existe.rows.length === 0) {
          await pool.query(
            `INSERT INTO turnos 
            (profesional, title, start_time, end_time, background_color, border_color, all_day, especialidad)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
              profesional,
              evento.title,
              evento.start,
              evento.end,
              evento.backgroundColor,
              evento.borderColor,
              evento.allDay || false,
              evento.especialidad,
            ]
          );
          totalInsertados++;
        }
      }
    }

    console.log(`💾 Turnos guardados: ${totalInsertados} nuevos`);
    res.json({
      message: "Turnos guardados correctamente",
      insertados: totalInsertados,
    });
  } catch (error) {
    console.error("Error guardando turnos:", error);
    res.status(500).json({ message: "Error al guardar turnos" });
  }
});

// GET /obtener-turnos - Obtener turnos disponibles
app.get("/obtener-turnos", async (req, res) => {
  try {
    const especialidad = req.query.especialidad;
    const now = new Date();
    now.setUTCHours(0, 0, 0, 0);

    let query = `
      SELECT profesional, title, start_time, end_time, background_color, especialidad, held_by, held_until
      FROM turnos 
      WHERE start_time >= $1
    `;
    const params = [now];

    if (especialidad) {
      query += ` AND especialidad = $2`;
      params.push(especialidad);
    }

    query += ` ORDER BY start_time ASC`;

    const result = await pool.query(query, params);

    // Agrupar por profesional y fecha
    const agrupados = {};

    for (const t of result.rows) {
      const startDate = new Date(t.start_time);

      // Verificar si el hold está activo
      if (t.held_by && t.held_until) {
        const heldUntil = new Date(t.held_until);
        if (heldUntil > new Date()) {
          console.log(
            `⏳ Slot en hold activo: ${t.title} ${startDate
              .toISOString()
              .slice(11, 16)}Z`
          );
          continue; // No mostrar slots en hold
        } else {
          // Limpiar hold expirado
          await pool.query(
            `UPDATE turnos SET held_by = NULL, held_until = NULL WHERE profesional = $1 AND start_time = $2`,
            [t.profesional, t.start_time]
          );
          console.log(
            `🕐 Hold expirado auto: ${t.title} ${startDate
              .toISOString()
              .slice(11, 16)}Z`
          );
        }
      }

      const date = startDate.toISOString().split("T")[0];
      const horaInicio = `${startDate
        .getUTCHours()
        .toString()
        .padStart(2, "0")}:${startDate
        .getUTCMinutes()
        .toString()
        .padStart(2, "0")}`;
      const endDate = new Date(t.end_time);
      const horaFin = `${endDate
        .getUTCHours()
        .toString()
        .padStart(2, "0")}:${endDate
        .getUTCMinutes()
        .toString()
        .padStart(2, "0")}`;

      const key = `${t.profesional}_${date}`;
      if (!agrupados[key]) {
        agrupados[key] = {
          title: t.title,
          date,
          slots: [],
          color: t.background_color,
          especialidad: t.especialidad,
        };
      }
      agrupados[key].slots.push({ start: horaInicio, end: horaFin });
    }

    const turnos = Object.values(agrupados);
    console.log(
      `📖 Turnos obtenidos (futuros${
        especialidad ? `, ${especialidad}` : ""
      }): ${turnos.length} grupos`
    );
    res.json(turnos);
  } catch (error) {
    console.error("Error obteniendo turnos:", error);
    res.status(500).json({ message: "Error al obtener turnos" });
  }
});

// GET /obtener-citas - Obtener todas las citas
app.get("/obtener-citas", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, nombre, dni, edad, consultorio, profesional, fecha, hora, 
              chat_id as "chatId", status, confirmed_at as "confirmedAt", 
              start_utc as "startUTC"
       FROM citas 
       ORDER BY start_utc ASC`
    );

    console.log(`📖 Citas obtenidas: ${result.rows.length}`);
    res.json(result.rows);
  } catch (error) {
    console.error("Error obteniendo citas:", error);
    res.status(500).json({ message: "Error al obtener citas" });
  }
});

// POST /reservar-turno - Reservar un turno (elimina de disponibles)
app.post("/reservar-turno", async (req, res) => {
  try {
    const { profesional, turnoInicio, userJid } = req.body;

    if (!profesional || !turnoInicio) {
      return res
        .status(400)
        .json({ message: "Se requiere profesional y turnoInicio" });
    }

    const profKey = getProfKeyFromString(profesional);
    const startISO = new Date(turnoInicio).toISOString();

    // Buscar y eliminar el turno
    const result = await pool.query(
      `DELETE FROM turnos 
       WHERE profesional = $1 AND start_time = $2
       RETURNING *`,
      [profKey, startISO]
    );

    if (result.rows.length === 0) {
      return res
        .status(404)
        .json({ message: "Turno no encontrado (ya reservado?)" });
    }

    const eliminado = result.rows[0];
    console.log("🔒 Turno reservado:", eliminado.title, startISO);
    res.json({ message: "Turno reservado correctamente", eliminado });
  } catch (error) {
    console.error("Error reservando turno:", error);
    res.status(500).json({ message: "Error al reservar turno" });
  }
});

// POST /liberar-turno - Liberar un turno (vuelve a disponibles)
app.post("/liberar-turno", async (req, res) => {
  try {
    const { profesional, turnoInicio, turnoFin, title, especialidad } =
      req.body;

    if (!profesional || !turnoInicio) {
      return res
        .status(400)
        .json({ message: "Se requiere profesional y turnoInicio" });
    }

    const profKey = getProfKeyFromString(profesional);
    const startISO = new Date(turnoInicio).toISOString();
    const endISO = turnoFin ? new Date(turnoFin).toISOString() : null;

    // Verificar si ya existe
    const existe = await pool.query(
      `SELECT id FROM turnos WHERE profesional = $1 AND start_time = $2`,
      [profKey, startISO]
    );

    if (existe.rows.length > 0) {
      return res.status(409).json({ message: "Turno ya disponible" });
    }

    // Insertar turno liberado
    const result = await pool.query(
      `INSERT INTO turnos 
      (profesional, title, start_time, end_time, background_color, border_color, all_day, especialidad)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *`,
      [
        profKey,
        title || profesional,
        startISO,
        endISO,
        getColorForProf(profKey),
        getColorForProf(profKey),
        false,
        especialidad || getEspecialidadFromProf(profKey),
      ]
    );

    console.log("🔓 Turno liberado:", result.rows[0].title, startISO);
    res.json({
      message: "Turno liberado correctamente",
      nuevo: result.rows[0],
    });
  } catch (error) {
    console.error("Error liberando turno:", error);
    res.status(500).json({ message: "Error al liberar turno" });
  }
});

// POST /hold-turno - Bloquear temporalmente un turno (5 min)
app.post("/hold-turno", async (req, res) => {
  try {
    const { profesional, turnoInicio, userJid } = req.body;

    if (!profesional || !turnoInicio || !userJid) {
      return res
        .status(400)
        .json({ error: "Faltan datos: profesional, turnoInicio, userJid" });
    }

    const profKey = getProfKeyFromString(profesional);
    const startISO = new Date(turnoInicio).toISOString();
    const now = new Date();
    const holdUntil = new Date(now.getTime() + 5 * 60 * 1000); // 5 minutos

    // Verificar si existe y no está en hold
    const turno = await pool.query(
      `SELECT held_by, held_until FROM turnos 
       WHERE profesional = $1 AND start_time = $2`,
      [profKey, startISO]
    );

    if (turno.rows.length === 0) {
      return res.status(404).json({ error: "Slot no encontrado" });
    }

    const t = turno.rows[0];
    if (t.held_by && new Date(t.held_until) > now) {
      return res
        .status(409)
        .json({ error: "Slot ya en hold por otro usuario" });
    }

    // Aplicar hold
    await pool.query(
      `UPDATE turnos 
       SET held_by = $1, held_until = $2 
       WHERE profesional = $3 AND start_time = $4`,
      [userJid, holdUntil, profKey, startISO]
    );

    console.log(
      `⏳ Hold temporal creado: ${profesional} ${startISO.slice(
        11,
        16
      )}Z por ${userJid}`
    );
    res.json({
      success: true,
      message: "Hold temporal creado (5 min)",
      holdUntil: holdUntil.toISOString(),
    });
  } catch (error) {
    console.error("Error en hold:", error);
    res.status(500).json({ error: "Error al crear hold" });
  }
});

// POST /liberar-hold - Liberar un hold temporal
app.post("/liberar-hold", async (req, res) => {
  try {
    const { profesional, turnoInicio, userJid } = req.body;

    if (!profesional || !turnoInicio || !userJid) {
      return res
        .status(400)
        .json({ error: "Faltan datos: profesional, turnoInicio, userJid" });
    }

    const profKey = getProfKeyFromString(profesional);
    const startISO = new Date(turnoInicio).toISOString();

    const result = await pool.query(
      `UPDATE turnos 
       SET held_by = NULL, held_until = NULL 
       WHERE profesional = $1 AND start_time = $2 AND held_by = $3
       RETURNING *`,
      [profKey, startISO, userJid]
    );

    if (result.rows.length === 0) {
      return res
        .status(404)
        .json({ error: "Hold no encontrado o no pertenece a este usuario" });
    }

    console.log(
      `🔓 Hold liberado: ${profesional} ${startISO.slice(
        11,
        16
      )}Z por ${userJid}`
    );
    res.json({ success: true, message: "Hold liberado correctamente" });
  } catch (error) {
    console.error("Error liberando hold:", error);
    res.status(500).json({ error: "Error al liberar hold" });
  }
});

// Inicializar tablas al arrancar
async function initDB() {
  try {
    const fs = require("fs");
    const schemaPath = path.join(__dirname, "schema.sql");

    if (fs.existsSync(schemaPath)) {
      const schema = fs.readFileSync(schemaPath, "utf8");
      await pool.query(schema);
      console.log("✅ Tablas verificadas/creadas en PostgreSQL");
    }
  } catch (error) {
    console.error("❌ Error inicializando BD:", error);
  }
}

app.listen(PORT, async () => {
  await initDB();
  console.log(`✅ Servidor corriendo en http://localhost:${PORT}`);
  console.log(`🐘 PostgreSQL conectado - Railway Database`);
});
