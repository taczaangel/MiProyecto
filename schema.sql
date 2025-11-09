-- Tabla de Turnos (slots disponibles)
CREATE TABLE IF NOT EXISTS turnos (
  id SERIAL PRIMARY KEY,
  profesional VARCHAR(50) NOT NULL,
  title VARCHAR(200) NOT NULL,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  background_color VARCHAR(20) DEFAULT '#6c757d',
  border_color VARCHAR(20) DEFAULT '#6c757d',
  all_day BOOLEAN DEFAULT false,
  especialidad VARCHAR(50) NOT NULL,
  held_by VARCHAR(100),
  held_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tabla de Citas (reservas confirmadas)
CREATE TABLE IF NOT EXISTS citas (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(200) NOT NULL,
  dni VARCHAR(20) NOT NULL,
  edad INTEGER NOT NULL,
  consultorio VARCHAR(100) NOT NULL,
  profesional VARCHAR(50) NOT NULL,
  fecha VARCHAR(20) NOT NULL,
  hora VARCHAR(50) NOT NULL,
  chat_id VARCHAR(100) NOT NULL,
  status VARCHAR(50) DEFAULT 'pendiente',
  confirmed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,  -- ✅ AGREGAR ESTA LÍNEA
  start_utc TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices para mejorar rendimiento
CREATE INDEX IF NOT EXISTS idx_turnos_profesional ON turnos(profesional);
CREATE INDEX IF NOT EXISTS idx_turnos_start ON turnos(start_time);
CREATE INDEX IF NOT EXISTS idx_turnos_held ON turnos(held_by, held_until);
CREATE INDEX IF NOT EXISTS idx_citas_dni ON citas(dni);
CREATE INDEX IF NOT EXISTS idx_citas_chat ON citas(chat_id);
CREATE INDEX IF NOT EXISTS idx_citas_start ON citas(start_utc);