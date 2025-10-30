document.addEventListener("DOMContentLoaded", function () {
  const calendarEl = document.getElementById("calendar");
  const profesionalSelect = document.getElementById("selectProfesional");
  const btnGuardar = document.getElementById("btnGuardar");
  const btnBorrar = document.getElementById("btnBorrar");
  const btnModoBorrar = document.getElementById("btnModoBorrar");
  const mensajeTemporal = document.getElementById("mensajeTemporal");

  const modalOverlay = document.getElementById("modalConfirm");
  const modalTitle = document.getElementById("modalTitle");
  const modalMessage = document.getElementById("modalMessage");
  const modalConfirmBtn = document.getElementById("modalConfirmBtn");
  const modalCancelBtn = document.getElementById("modalCancelBtn");

  let modoBorradoActivo = false;

  const profesionales = {
    elio: {
      title: "CD Elio Támara",
      color: "#007bff",
      especialidad: "general",
    },
    manuel: {
      title: "CD Manuel Romani",
      color: "#28a745",
      especialidad: "general",
    },
    jimy: {
      title: "Esp. CD Jimy Osorio",
      color: "#dc3545",
      especialidad: "pediatria",
    },
    fernando: {
      title: "Esp. CD Fernando Bustamante",
      color: "#ffc107",
      especialidad: "pediatria",
    },
  };

  const serverEvents = {
    elio: [],
    manuel: [],
    jimy: [],
    fernando: [],
  };

  const pendingEvents = {
    elio: [],
    manuel: [],
    jimy: [],
    fernando: [],
  };

  const cacheTurnos = {
    elio: null,
    manuel: null,
    jimy: null,
    fernando: null,
  };

  let cacheGlobal = null;
  let cacheTimestampGlobal = 0;
  const CACHE_DURATION = 5000;

  let fechaLunesSemana = new Date();
  const diaSemanaActual = fechaLunesSemana.getDay();
  const diff =
    fechaLunesSemana.getDate() -
    diaSemanaActual +
    (diaSemanaActual === 0 ? -6 : 1);
  fechaLunesSemana.setDate(diff + 7);
  fechaLunesSemana.setHours(0, 0, 0, 0);

  function formatoRango(inicioStr) {
    const inicio = new Date(fechaLunesSemana);
    const [hora, min] = inicioStr.split(":");
    inicio.setHours(parseInt(hora), parseInt(min), 0, 0);
    const fin = new Date(inicio.getTime() + 40 * 60 * 1000);
    return (
      inicio.toLocaleTimeString("es-PE", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      }) +
      " - " +
      fin.toLocaleTimeString("es-PE", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      })
    );
  }

  const bloquesHorarios = [
    "07:20",
    "08:00",
    "08:40",
    "09:20",
    "10:00",
    "10:40",
    "11:20",
    "12:00",
    "13:20",
    "14:00",
    "14:40",
    "15:20",
    "16:00",
    "16:40",
  ];

  const diasSemana = [
    "Lunes",
    "Martes",
    "Miércoles",
    "Jueves",
    "Viernes",
    "Sábado",
    "Domingo",
  ];

  function getProfKeyFromString(str) {
    const s = (str || "").toLowerCase();
    if (s.includes("elio") || s.includes("támara")) return "elio";
    if (s.includes("manuel") || s.includes("romani")) return "manuel";
    if (s.includes("jimy") || s.includes("osorio")) return "jimy";
    if (s.includes("fernando") || s.includes("bustamante")) return "fernando";
    return s || "otro";
  }

  function mostrarMensaje(mensaje, tipo = "info") {
    mensajeTemporal.textContent = mensaje;
    mensajeTemporal.className = `mensaje-temporal visible ${tipo}`;
    setTimeout(() => {
      mensajeTemporal.classList.remove("visible");
    }, 2500);
  }

  function setLoading(btn, loading) {
    if (loading) {
      btn.classList.add("loading");
      btn.disabled = true;
    } else {
      btn.classList.remove("loading");
      btn.disabled = false;
    }
  }

  function mostrarModal(titulo, mensaje, onConfirm) {
    modalTitle.textContent = titulo;
    modalMessage.textContent = mensaje;
    modalOverlay.classList.add("visible");
    currentConfirmCallback = onConfirm;
  }

  function cerrarModal() {
    modalOverlay.classList.remove("visible");
    currentConfirmCallback = null;
  }

  let currentConfirmCallback = null;

  modalConfirmBtn.addEventListener("click", () => {
    if (currentConfirmCallback) {
      currentConfirmCallback();
    }
    cerrarModal();
  });

  modalCancelBtn.addEventListener("click", cerrarModal);

  modalOverlay.addEventListener("click", (e) => {
    if (e.target === modalOverlay) cerrarModal();
  });

  function generarTabla() {
    calendarEl.innerHTML = "";

    const tabla = document.createElement("table");
    tabla.className = "calendario-tabla";

    const thead = document.createElement("thead");
    const filaHeader = document.createElement("tr");
    const thHora = document.createElement("th");
    thHora.textContent = "Horario";
    thHora.style.width = "150px";
    filaHeader.appendChild(thHora);

    diasSemana.forEach((dia) => {
      const th = document.createElement("th");
      th.textContent = dia;
      filaHeader.appendChild(th);
    });
    thead.appendChild(filaHeader);
    tabla.appendChild(thead);

    const tbody = document.createElement("tbody");
    bloquesHorarios.forEach((horaInicio) => {
      const fila = document.createElement("tr");

      const tdHora = document.createElement("td");
      tdHora.textContent =
        horaInicio === "12:00"
          ? "ALMUERZO (12:00 PM - 1:20 PM)"
          : formatoRango(horaInicio);
      tdHora.className = horaInicio === "12:00" ? "almuerzo" : "";
      fila.appendChild(tdHora);

      diasSemana.forEach((dia, diaIndex) => {
        const td = document.createElement("td");

        if (horaInicio === "12:00") {
          td.className = "almuerzo no-seleccionable";
        } else {
          td.dataset.dia = diaIndex === 6 ? 0 : diaIndex + 1;
          td.dataset.hora = horaInicio;
          td.className = "slot";
          td.addEventListener("click", manejarClickSlot);
        }

        fila.appendChild(td);
      });

      tbody.appendChild(fila);
    });

    tabla.appendChild(tbody);
    calendarEl.appendChild(tabla);

    window.slotsCache = calendarEl.querySelectorAll(".slot");
  }

  function limpiarSlots() {
    window.slotsCache.forEach((slot) => {
      slot.innerHTML = "";
      slot.style.backgroundColor = "";
      slot.classList.remove("ocupado");
      delete slot.dataset.profesional;
      delete slot.dataset.turnoInicio;
      delete slot.dataset.origen;
    });
  }

  function cargarServerEvents(profKey) {
    const cacheEntry = cacheTurnos[profKey];
    const now = Date.now();
    if (cacheEntry && now - cacheEntry.timestamp < CACHE_DURATION) {
      if (serverEvents[profKey].length === 0) {
        serverEvents[profKey] = cacheEntry.data.flatMap((grupo) => {
          const events = [];
          if (grupo.title.toLowerCase().includes(profKey)) {
            grupo.slots.forEach((slot) => {
              const startISO = `${grupo.date}T${slot.start}:00.000Z`;
              const endISO = `${grupo.date}T${slot.end}:00.000Z`;
              events.push({
                title: grupo.title,
                start: startISO,
                end: endISO,
                backgroundColor: grupo.color,
                borderColor: grupo.color,
                allDay: false,
                especialidad:
                  grupo.especialidad || profesionales[profKey].especialidad,
              });
            });
          }
          return events;
        });
      }
      return Promise.resolve(serverEvents[profKey]);
    }

    return fetch(
      `/obtener-turnos?especialidad=${profesionales[profKey].especialidad}`
    )
      .then((response) => response.json())
      .then((data) => {
        cacheTurnos[profKey] = { data, timestamp: now };
        serverEvents[profKey] = data.flatMap((grupo) => {
          const events = [];
          if (grupo.title.toLowerCase().includes(profKey)) {
            grupo.slots.forEach((slot) => {
              const startISO = `${grupo.date}T${slot.start}:00.000Z`;
              const endISO = `${grupo.date}T${slot.end}:00.000Z`;
              events.push({
                title: grupo.title,
                start: startISO,
                end: endISO,
                backgroundColor: grupo.color,
                borderColor: grupo.color,
                allDay: false,
                especialidad:
                  grupo.especialidad || profesionales[profKey].especialidad,
              });
            });
          }
          return events;
        });
        return serverEvents[profKey];
      })
      .catch((err) => {
        console.error("Error cargando eventos del servidor:", err);
        mostrarMensaje("Error al cargar turnos del servidor.", "error");
        return [];
      });
  }

  function actualizarSlots(profKey) {
    if (!profKey) {
      limpiarSlots();
      return;
    }

    limpiarSlots();

    cargarServerEvents(profKey).then((serverEvts) => {
      const visibleServer = serverEvts.filter(
        (e) => !pendingDeletes[profKey].includes(e.start)
      );
      visibleServer.forEach((evento) => {
        const startDate = new Date(evento.start);
        const diaSemana = startDate.getDay();
        const horaInicioStr = startDate.toTimeString().slice(0, 5);

        const slotEl = calendarEl.querySelector(
          `.slot[data-dia="${diaSemana}"][data-hora="${horaInicioStr}"]`
        );
        if (slotEl) {
          slotEl.innerHTML = `<div>${evento.title}</div>`;
          slotEl.style.backgroundColor = evento.backgroundColor;
          slotEl.classList.add("ocupado");
          slotEl.dataset.profesional = profKey;
          slotEl.dataset.turnoInicio = evento.start;
          slotEl.dataset.origen = "servidor";
        }
      });

      pendingEvents[profKey].forEach((evento) => {
        const startDate = new Date(evento.start);
        const diaSemana = startDate.getDay();
        const horaInicioStr = startDate.toTimeString().slice(0, 5);

        const slotEl = calendarEl.querySelector(
          `.slot[data-dia="${diaSemana}"][data-hora="${horaInicioStr}"]`
        );
        if (slotEl && !slotEl.classList.contains("ocupado")) {
          slotEl.innerHTML = `<div>${evento.title}</div>`;
          slotEl.style.backgroundColor = evento.backgroundColor;
          slotEl.classList.add("ocupado");
          slotEl.dataset.profesional = profKey;
          slotEl.dataset.turnoInicio = evento.start;
          slotEl.dataset.origen = "local";
        }
      });
    });
  }

  const pendingDeletes = {
    elio: [],
    manuel: [],
    jimy: [],
    fernando: [],
  };

  function manejarClickSlot(event) {
    const td = event.currentTarget;
    const dia = parseInt(td.dataset.dia);
    const horaInicio = td.dataset.hora;
    const seleccionado = profesionalSelect.value;

    if (horaInicio === "12:00") return;

    if (modoBorradoActivo) {
      if (
        td.classList.contains("ocupado") &&
        td.dataset.profesional &&
        td.dataset.turnoInicio
      ) {
        const profKey = td.dataset.profesional;
        const origen = td.dataset.origen || "servidor";
        const turnoInicio = td.dataset.turnoInicio;

        td.innerHTML = "";
        td.style.backgroundColor = "";
        td.classList.remove("ocupado");
        delete td.dataset.profesional;
        delete td.dataset.turnoInicio;
        delete td.dataset.origen;

        if (origen === "local") {
          pendingEvents[profKey] = pendingEvents[profKey].filter(
            (e) => e.start !== turnoInicio
          );
          mostrarMensaje("Eliminado correctamente.", "success");
        } else {
          if (!pendingDeletes[profKey].includes(turnoInicio)) {
            pendingDeletes[profKey].push(turnoInicio);
          }
          mostrarMensaje(
            "Eliminado correctamente (pendiente de guardar).",
            "success"
          );
        }
      } else {
        mostrarMensaje("No hay turno para borrar aquí.", "warning");
      }
      return;
    }

    if (!seleccionado) {
      profesionalSelect.classList.add("highlight");
      setTimeout(() => profesionalSelect.classList.remove("highlight"), 1500);
      return;
    }

    const yaOcupado = td.classList.contains("ocupado");
    if (yaOcupado) {
      mostrarMensaje("Slot ocupado.", "warning");
      return;
    }

    const fechaSlot = new Date(fechaLunesSemana);
    fechaSlot.setDate(fechaLunesSemana.getDate() + (dia === 0 ? 6 : dia - 1));
    const [hora, min] = horaInicio.split(":");
    fechaSlot.setHours(parseInt(hora), parseInt(min), 0, 0);
    const start = new Date(fechaSlot);
    const end = new Date(start.getTime() + 40 * 60 * 1000);
    const startISO = start.toISOString();
    const endISO = end.toISOString();

    const prof = profesionales[seleccionado];
    const nuevo = {
      title: prof.title,
      start: startISO,
      end: endISO,
      backgroundColor: prof.color,
      borderColor: prof.color,
      allDay: false,
      especialidad: prof.especialidad,
    };

    pendingEvents[seleccionado].push(nuevo);

    td.innerHTML = `<div>${prof.title}</div>`;
    td.style.backgroundColor = prof.color;
    td.classList.add("ocupado");
    td.dataset.profesional = seleccionado;
    td.dataset.turnoInicio = startISO;
    td.dataset.origen = "local";

    console.log("Slot agregado:", nuevo);
  }

  btnModoBorrar.addEventListener("click", () => {
    modoBorradoActivo = !modoBorradoActivo;
    btnModoBorrar.classList.toggle("active", modoBorradoActivo);
  });

  function cargarTurnosInicial() {
    const now = Date.now();
    if (cacheGlobal && now - cacheTimestampGlobal < CACHE_DURATION) {
      procesarTurnosGlobal(cacheGlobal);
      return;
    }

    setLoading(btnGuardar, true);
    fetch("/obtener-turnos")
      .then((response) => {
        if (!response.ok) throw new Error("No se pudo cargar turnos");
        return response.json();
      })
      .then((grupos) => {
        cacheGlobal = grupos;
        cacheTimestampGlobal = now;
        procesarTurnosGlobal(grupos);
      })
      .catch((err) => {
        console.error("Error leyendo turnos:", err);
        generarTabla();
        mostrarMensaje("Error al cargar turnos iniciales.", "error");
      })
      .finally(() => setLoading(btnGuardar, false));
  }

  function procesarTurnosGlobal(grupos) {
    Object.keys(serverEvents).forEach((key) => (serverEvents[key] = []));

    if (!Array.isArray(grupos) || grupos.length === 0) {
      generarTabla();
      const seleccionado = profesionalSelect.value;
      if (seleccionado) {
        actualizarSlots(seleccionado);
      }
      return;
    }

    grupos.forEach((grupo) => {
      const profKey = getProfKeyFromString(grupo.title);
      if (!profesionales[profKey]) return;

      grupo.slots.forEach((slot) => {
        const startISO = `${grupo.date}T${slot.start}:00.000Z`;
        const endISO = `${grupo.date}T${slot.end}:00.000Z`;
        serverEvents[profKey].push({
          title: grupo.title,
          start: startISO,
          end: endISO,
          backgroundColor: grupo.color,
          borderColor: grupo.color,
          allDay: false,
          especialidad:
            grupo.especialidad || profesionales[profKey].especialidad,
        });
      });
    });

    generarTabla();
    const seleccionado = profesionalSelect.value;
    if (seleccionado) {
      actualizarSlots(seleccionado);
    }
    console.log("📅 Turnos cargados:", grupos.length, "grupos");
  }

  profesionalSelect.addEventListener("change", () => {
    const seleccionado = profesionalSelect.value;
    actualizarSlots(seleccionado);
  });

  btnGuardar.addEventListener("click", async () => {
    setLoading(btnGuardar, true);
    try {
      const turnosObj = {};
      Object.keys(profesionales).forEach((key) => {
        const finalEvents = [
          ...serverEvents[key].filter(
            (e) => !pendingDeletes[key].includes(e.start)
          ),
          ...pendingEvents[key],
        ];
        turnosObj[key] = finalEvents.map((e) => ({
          title: e.title,
          start:
            typeof e.start === "string"
              ? e.start
              : new Date(e.start).toISOString(),
          end:
            typeof e.end === "string" ? e.end : new Date(e.end).toISOString(),
          backgroundColor: e.backgroundColor,
          borderColor: e.borderColor,
          allDay: e.allDay,
          especialidad:
            e.especialidad ||
            (key === "jimy" || key === "fernando" ? "pediatria" : "general"),
        }));
      });

      const res = await fetch("/guardar-turno", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(turnosObj),
      });

      const data = await res.json();
      if (res.ok) {
        mostrarMensaje(
          data.message || "Turnos guardados exitosamente.",
          "success"
        );
        Object.keys(pendingEvents).forEach((key) => (pendingEvents[key] = []));
        Object.keys(pendingDeletes).forEach(
          (key) => (pendingDeletes[key] = [])
        );
        cacheGlobal = null;
        Object.keys(cacheTurnos).forEach((key) => (cacheTurnos[key] = null));
        Object.keys(serverEvents).forEach((key) => (serverEvents[key] = []));
        cargarTurnosInicial();
      } else {
        mostrarMensaje(data.message || "Error al guardar.", "error");
      }
    } catch (err) {
      console.error("Error al guardar turnos:", err);
      mostrarMensaje("Error al guardar en el servidor.", "error");
    } finally {
      setLoading(btnGuardar, false);
    }
  });

  btnBorrar.addEventListener("click", () => {
    const seleccionado = profesionalSelect.value;
    if (!seleccionado) {
      mostrarMensaje("Selecciona un profesional.", "warning");
      return;
    }
    mostrarModal(
      "Confirmar Borrado Masivo",
      `¿Borrar todos los turnos de ${profesionales[seleccionado].title}?`,
      () => {
        setLoading(btnBorrar, true);

        serverEvents[seleccionado].forEach((e) => {
          if (!pendingDeletes[seleccionado].includes(e.start)) {
            pendingDeletes[seleccionado].push(e.start);
          }
        });
        pendingEvents[seleccionado] = [];
        actualizarSlots(seleccionado);
        mostrarMensaje(
          "Turnos marcados para borrado (guarda para confirmar).",
          "success"
        );
        setLoading(btnBorrar, false);
        cerrarModal();
      }
    );
  });

  generarTabla();
  cargarTurnosInicial();
});
