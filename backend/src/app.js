const express = require('express');
const cors = require('cors');
const prisma = require('./lib/prisma');

const app = express();

app.use(cors());
app.use(express.json());

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

app.get('/health', (req, res) => {
  res.json({ ok: true, message: 'LOTO API funcionando' });
});

app.get('/api/lineas', async (req, res) => {
  const lineas = await prisma.linea.findMany({
    include: { maquinas: true }
  });

  res.json(lineas);
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

app.post('/api/eventos/checkin', async (req, res) => {
  const { qrCode, numeroEmpleado } = req.body;

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

  const eventoAbierto = await prisma.eventoLOTO.findFirst({
    where: {
      maquinaId: maquina.id,
      estado: 'ABIERTO'
    }
  });

  if (eventoAbierto) {
    return res.status(409).json({
      error: 'La máquina ya tiene un LOTO abierto',
      eventoId: eventoAbierto.id
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

  if (completado && tipo === 'CHECKIN') {
    const anterior = evento.maquina.puntos.find((item) => item.orden === punto.orden - 1);
    const anteriorEvento = anterior && evento.puntos.find(
      (item) => item.puntoBloqueoId === anterior.id && item.tipo === 'CHECKIN'
    );

    if (anterior && !anteriorEvento?.completado) {
      return res.status(409).json({ error: 'Debes completar primero el punto anterior' });
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
      orden: 0,
      completado,
      realizadoAt: completado ? new Date() : null
    }
  });

  res.json({ message: 'Punto actualizado', punto: eventoPunto });
});

app.post('/api/eventos/:id/checkout', async (req, res) => {
  const { puntos } = req.body;

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

  const puntosCheckout = Array.isArray(puntos) ? puntos : [];
  const puntosInversos = [...evento.maquina.puntos].reverse();
  const checkoutValido = puntosInversos.every((punto, index) => {
    const recibido = puntosCheckout[index];
    return recibido &&
      Number(recibido.puntoBloqueoId) === punto.id &&
      Boolean(recibido.completado);
  });

  if (!checkoutValido || puntosCheckout.length !== evento.maquina.puntos.length) {
    return res.status(409).json({
      error: 'Completa el checklist de desbloqueo en orden inverso'
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

    for (const [index, punto] of puntosCheckout.entries()) {
      await tx.eventoPunto.upsert({
        where: {
          eventoId_puntoBloqueoId_tipo: {
            eventoId: evento.id,
            puntoBloqueoId: Number(punto.puntoBloqueoId),
            tipo: 'CHECKOUT'
          }
        },
        update: {
          completado: Boolean(punto.completado),
          realizadoAt: Boolean(punto.completado) ? new Date() : null
        },
        create: {
          eventoId: evento.id,
          puntoBloqueoId: Number(punto.puntoBloqueoId),
          tipo: 'CHECKOUT',
          orden: index + 1,
          completado: true,
          realizadoAt: new Date()
        }
      });
    }

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

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Error interno del servidor' });
});

module.exports = app;
