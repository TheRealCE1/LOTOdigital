const express = require('express');
const cors = require('cors');
const path = require('node:path');
const prisma = require('./lib/prisma');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../../frontend/dist')));

async function sendClosedEvent(evento, puntos) {
  const webhookUrl = process.env.POWER_AUTOMATE_URL;

  if (!webhookUrl) {
    return { sent: false, error: null };
  }

  const payload = {
    eventoId: String(evento.id),
    maquina: evento.maquina.nombre,
    linea: evento.maquina.linea.nombre,
    numeroEmpleado: evento.operador.numeroEmpleado,
    checkin: evento.horaInicio,
    checkout: evento.horaFin,
    duracionMinutos: evento.duracionMinutos,
    puntos: puntos.map((punto) => ({
      nombre: punto.puntoBloqueo.nombre,
      tipoEnergia: punto.puntoBloqueo.tipoEnergia,
      orden: punto.orden,
      tipo: punto.tipo,
      realizadoAt: punto.realizadoAt
    }))
  };

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      return { sent: false, error: `Webhook respondió HTTP ${response.status}` };
    }

    return { sent: true, error: null };
  } catch (error) {
    return { sent: false, error: error.message };
  }
}

function normalizeEmployeeNumber(value) {
  return String(value || '').trim();
}

app.get('/health', (req, res) => {
  res.json({ ok: true, message: 'LOTO API funcionando' });
});

app.get('/api/lineas', async (req, res) => {
  const lineas = await prisma.linea.findMany({
    include: { maquinas: true }
  });

  res.json(lineas);
});

app.post('/api/catalogo/maquinas', async (req, res) => {
  const { nombre, linea, qrCode, puntos = [] } = req.body;

  if (!nombre || !linea || !qrCode) {
    return res.status(400).json({
      error: 'nombre, linea y qrCode son obligatorios'
    });
  }

  const puntosValidos = Array.isArray(puntos) && puntos.length > 0
    ? puntos
    : [{ nombre: 'Bloqueo general', tipoEnergia: 'OTRA' }];

  try {
    const maquina = await prisma.$transaction(async (tx) => {
      const lineaRegistro = await tx.linea.upsert({
        where: { nombre: String(linea).trim() },
        update: {},
        create: { nombre: String(linea).trim() }
      });

      const maquinaRegistro = await tx.maquina.upsert({
        where: { qrCode: String(qrCode).trim() },
        update: { nombre: String(nombre).trim(), lineaId: lineaRegistro.id },
        create: {
          nombre: String(nombre).trim(),
          qrCode: String(qrCode).trim(),
          lineaId: lineaRegistro.id
        }
      });

      for (const [index, punto] of puntosValidos.entries()) {
        await tx.puntoBloqueo.upsert({
          where: {
            maquinaId_orden: {
              maquinaId: maquinaRegistro.id,
              orden: index + 1
            }
          },
          update: {
            nombre: String(punto.nombre || `Punto ${index + 1}`).trim(),
            tipoEnergia: punto.tipoEnergia || 'OTRA'
          },
          create: {
            nombre: String(punto.nombre || `Punto ${index + 1}`).trim(),
            tipoEnergia: punto.tipoEnergia || 'OTRA',
            orden: index + 1,
            maquinaId: maquinaRegistro.id
          }
        });
      }

      return tx.maquina.findUnique({
        where: { id: maquinaRegistro.id },
        include: { linea: true, puntos: { orderBy: { orden: 'asc' } } }
      });
    });

    return res.status(201).json({ message: 'Máquina registrada', maquina });
  } catch (error) {
    if (error.code === 'P2002') {
      return res.status(409).json({ error: 'El QR ya está registrado' });
    }

    throw error;
  }
});

app.get('/api/maquinas/:qrCode', async (req, res) => {
  const maquina = await prisma.maquina.findUnique({
    where: { qrCode: req.params.qrCode },
    include: { linea: true, puntos: { orderBy: { orden: 'asc' } } }
  });

  if (!maquina) {
    return res.status(404).json({ error: 'Máquina no encontrada' });
  }

  return res.json(maquina);
});

app.get('/api/eventos/activos', async (req, res) => {
  const eventos = await prisma.eventoLOTO.findMany({
    where: { estado: 'ABIERTO' },
    include: {
      maquina: true,
      operador: true,
      puntos: true
    },
    orderBy: { horaInicio: 'desc' }
  });

  res.json(eventos);
});

app.post('/api/eventos/reanudar', async (req, res) => {
  const numeroEmpleado = normalizeEmployeeNumber(req.body.numeroEmpleado);

  if (!numeroEmpleado) {
    return res.status(400).json({ error: 'numeroEmpleado es obligatorio' });
  }

  const eventos = await prisma.eventoLOTO.findMany({
    where: { estado: 'ABIERTO' },
    include: {
      maquina: { include: { linea: true } },
      operador: true,
      puntos: {
        include: { puntoBloqueo: true },
        orderBy: { orden: 'asc' }
      }
    },
    orderBy: { horaInicio: 'desc' }
  });

  res.json({
    eventos: eventos.filter((evento) =>
      normalizeEmployeeNumber(evento.operador.numeroEmpleado) === numeroEmpleado
    )
  });
});

app.post('/api/eventos/checkin', async (req, res) => {
  const qrCode = String(req.body.qrCode || '').trim();
  const numeroEmpleado = normalizeEmployeeNumber(req.body.numeroEmpleado);

  if (!qrCode || !numeroEmpleado) {
    return res.status(400).json({ error: 'qrCode y numeroEmpleado son obligatorios' });
  }

  const maquina = await prisma.maquina.findUnique({
    where: { qrCode },
    include: { linea: true, puntos: { orderBy: { orden: 'asc' } } }
  });

  if (!maquina) {
    return res.status(404).json({ error: 'QR no válido' });
  }

  let operador = await prisma.operador.findUnique({
    where: { numeroEmpleado }
  });

  if (!operador) {
    operador = await prisma.operador.create({
      data: { numeroEmpleado }
    });
  }

  const eventosAbiertos = await prisma.eventoLOTO.findMany({
    where: { maquinaId: maquina.id, estado: 'ABIERTO' },
    include: { operador: true },
    orderBy: { horaInicio: 'desc' }
  });
  const eventoAbierto = eventosAbiertos[0];

  if (eventoAbierto) {
    if (normalizeEmployeeNumber(eventoAbierto.operador.numeroEmpleado) === numeroEmpleado) {
      const eventoActivo = await prisma.eventoLOTO.findUnique({
        where: { id: eventoAbierto.id },
        include: {
          maquina: { include: { linea: true } },
          operador: true,
          puntos: {
            include: { puntoBloqueo: true },
            orderBy: { orden: 'asc' }
          }
        }
      });

      return res.status(200).json({
        message: 'LOTO abierto recuperado',
        resumed: true,
        evento: eventoActivo,
        maquina,
        operador
      });
    }

    return res.status(409).json({
      error: 'La máquina ya tiene un LOTO abierto',
      eventoId: eventoAbierto.id,
      operadorActivo: eventoAbierto.operador.numeroEmpleado
    });
  }

  let evento;

  try {
    evento = await prisma.$transaction(async (tx) => {
      const nuevoEvento = await tx.eventoLOTO.create({
        data: {
          maquinaId: maquina.id,
          operadorId: operador.id,
          estado: 'ABIERTO',
          horaInicio: new Date(),
          puntos: {
            create: maquina.puntos.map((punto) => ({
              puntoBloqueoId: punto.id,
              tipo: 'CHECKIN',
              orden: punto.orden,
              completado: false
            }))
          }
        }
      });

      await tx.bloqueoMaquina.create({
        data: { maquinaId: maquina.id, eventoId: nuevoEvento.id }
      });

      return tx.eventoLOTO.findUnique({
        where: { id: nuevoEvento.id },
        include: {
          maquina: { include: { linea: true } },
          operador: true,
          puntos: { include: { puntoBloqueo: true } }
        }
      });
    });
  } catch (error) {
    if (error.code === 'P2002') {
      return res.status(409).json({ error: 'La máquina ya tiene un LOTO abierto' });
    }

    throw error;
  }

  res.status(201).json({
    message: 'LOTO abierto correctamente',
    evento,
    maquina,
    operador
  });
});

app.post('/api/eventos/:id/checkpoint', async (req, res) => {
  const { puntoBloqueoId, tipo = 'CHECKIN', completado = true } = req.body;

  if (!puntoBloqueoId) {
    return res.status(400).json({ error: 'puntoBloqueoId es obligatorio' });
  }

  if (!['CHECKIN', 'CHECKOUT'].includes(tipo)) {
    return res.status(400).json({ error: 'tipo de checkpoint no válido' });
  }

  const evento = await prisma.eventoLOTO.findUnique({
    where: { id: Number(req.params.id) },
    include: {
      maquina: { include: { puntos: { orderBy: { orden: 'asc' } } } },
      puntos: true
    }
  });

  if (!evento) {
    return res.status(404).json({ error: 'Evento no encontrado' });
  }

  const punto = evento.maquina.puntos.find((item) => item.id === Number(puntoBloqueoId));

  if (!punto) {
    return res.status(400).json({ error: 'El punto no pertenece a la máquina del evento' });
  }

  if (completado) {
    const puntosOrdenados = tipo === 'CHECKIN'
      ? evento.maquina.puntos
      : [...evento.maquina.puntos].reverse();
    const indiceActual = puntosOrdenados.findIndex((item) => item.id === punto.id);
    const anterior = puntosOrdenados[indiceActual - 1];
    const tipoAnterior = tipo;
    const anteriorEvento = anterior && evento.puntos.find(
      (item) => item.puntoBloqueoId === anterior.id && item.tipo === tipoAnterior
    );

    if (anterior && !anteriorEvento?.completado) {
      return res.status(409).json({
        error: tipo === 'CHECKIN'
          ? 'Debes completar primero el punto anterior'
          : 'Debes retirar primero el bloqueo anterior en orden inverso'
      });
    }
  }

  if (evento.estado === 'CERRADO') {
    return res.status(409).json({ error: 'El evento ya está cerrado' });
  }

  const eventoPunto = await prisma.eventoPunto.upsert({
    where: {
      eventoId_puntoBloqueoId_tipo: {
        eventoId: Number(req.params.id),
        puntoBloqueoId: Number(puntoBloqueoId),
        tipo
      }
    },
    update: {
      completado,
      realizadoAt: completado ? new Date() : null
    },
    create: {
      eventoId: Number(req.params.id),
      puntoBloqueoId: Number(puntoBloqueoId),
      tipo,
      orden: tipo === 'CHECKIN'
        ? punto.orden
        : evento.maquina.puntos.length - punto.orden + 1,
      completado,
      realizadoAt: completado ? new Date() : null
    }
  });

  res.json({ message: 'Punto actualizado', punto: eventoPunto });
});

app.post('/api/eventos/:id/checkout', async (req, res) => {
  const evento = await prisma.eventoLOTO.findUnique({
    where: { id: Number(req.params.id) },
    include: {
      maquina: { include: { linea: true, puntos: { orderBy: { orden: 'asc' } } } },
      operador: true,
      puntos: true
    }
  });

  if (!evento) {
    return res.status(404).json({ error: 'Evento no encontrado' });
  }

  if (evento.estado === 'CERRADO') {
    return res.status(409).json({ error: 'El evento ya está cerrado' });
  }

  const checkinCompleto = evento.maquina.puntos.every((punto) =>
    evento.puntos.some(
      (eventoPunto) => eventoPunto.puntoBloqueoId === punto.id &&
        eventoPunto.tipo === 'CHECKIN' &&
        eventoPunto.completado
    )
  );

  if (!checkinCompleto) {
    return res.status(409).json({ error: 'No puedes cerrar el evento con el checklist de bloqueo incompleto' });
  }

  const puntosInversos = [...evento.maquina.puntos].reverse();
  const checkoutCompleto = puntosInversos.every((punto) =>
    evento.puntos.some(
      (eventoPunto) => eventoPunto.puntoBloqueoId === punto.id &&
        eventoPunto.tipo === 'CHECKOUT' &&
        eventoPunto.completado
    )
  );

  if (!checkoutCompleto) {
    return res.status(409).json({
      error: 'Confirma físicamente todos los puntos de desbloqueo en orden inverso'
    });
  }

  const cierre = new Date();
  const duracionMinutos = Math.max(
    0,
    Math.round((cierre - new Date(evento.horaInicio)) / 60000)
  );

  const eventoCerrado = await prisma.$transaction(async (tx) => {
    const cerrado = await tx.eventoLOTO.update({
    where: { id: evento.id },
    data: {
      estado: 'CERRADO',
      horaFin: cierre,
      duracionMinutos,
    },
    include: {
      maquina: { include: { linea: true } },
      operador: true
    }
    });

    await tx.bloqueoMaquina.deleteMany({ where: { eventoId: evento.id } });

    return cerrado;
  });

  const puntosCerrados = await prisma.eventoPunto.findMany({
    where: { eventoId: evento.id },
    include: { puntoBloqueo: true },
    orderBy: { orden: 'asc' }
  });
  const integracion = await sendClosedEvent(eventoCerrado, puntosCerrados);
  await prisma.eventoLOTO.update({
    where: { id: evento.id },
    data: {
      integracionEnviada: integracion.sent,
      integracionError: integracion.error
    }
  });

  res.json({
    message: 'Evento cerrado correctamente',
    evento: eventoCerrado,
    resumen: {
      eventoId: eventoCerrado.id,
      maquina: eventoCerrado.maquina.nombre,
      linea: eventoCerrado.maquina.linea.nombre,
      numeroEmpleado: eventoCerrado.operador.numeroEmpleado,
      checkin: eventoCerrado.horaInicio,
      checkout: eventoCerrado.horaFin,
      duracionMinutos,
      integracionEnviada: integracion.sent
    }
  });
});

app.post('/api/eventos/:id/integracion/reintentar', async (req, res) => {
  const evento = await prisma.eventoLOTO.findUnique({
    where: { id: Number(req.params.id) },
    include: {
      maquina: { include: { linea: true } },
      operador: true,
      puntos: { include: { puntoBloqueo: true }, orderBy: { orden: 'asc' } }
    }
  });

  if (!evento) {
    return res.status(404).json({ error: 'Evento no encontrado' });
  }

  if (evento.estado !== 'CERRADO') {
    return res.status(409).json({ error: 'Solo se puede reintentar un evento cerrado' });
  }

  if (evento.integracionEnviada) {
    return res.json({ message: 'La integración ya fue enviada', integracionEnviada: true });
  }

  const integracion = await sendClosedEvent(evento, evento.puntos);
  const actualizado = await prisma.eventoLOTO.update({
    where: { id: evento.id },
    data: {
      integracionEnviada: integracion.sent,
      integracionError: integracion.error
    }
  });

  return res.status(integracion.sent ? 200 : 502).json({
    message: integracion.sent ? 'Integración enviada correctamente' : 'No se pudo enviar la integración',
    integracionEnviada: actualizado.integracionEnviada,
    integracionError: actualizado.integracionError
  });
});

app.get(/^\/(?!api(?:\/|$)|health$).*/, (req, res, next) => {
  const indexPath = path.join(__dirname, '../../frontend/dist/index.html');
  res.sendFile(indexPath, (error) => {
    if (error) next(error);
  });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Error interno del servidor' });
});

module.exports = app;
