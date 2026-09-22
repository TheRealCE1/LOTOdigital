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

app.get('/api/catalogo/maquinas', async (req, res) => {
  const maquinas = await prisma.maquina.findMany({
    include: {
      linea: true,
      puntos: { orderBy: { orden: 'asc' } },
      imagenes: { orderBy: { orden: 'asc' } },
      bloqueoActivo: true
    },
    orderBy: [{ linea: { nombre: 'asc' } }, { nombre: 'asc' }]
  });

  res.json(maquinas);
});

app.delete('/api/catalogo/maquinas/:id', async (req, res) => {
  const maquinaId = Number(req.params.id);

  if (!Number.isInteger(maquinaId)) {
    return res.status(400).json({ error: 'Identificador de máquina no válido' });
  }

  const maquina = await prisma.maquina.findUnique({
    where: { id: maquinaId },
    include: {
      bloqueoActivo: true,
      eventos: { select: { id: true }, take: 1 }
    }
  });

  if (!maquina) {
    return res.status(404).json({ error: 'Máquina no encontrada' });
  }

  if (maquina.bloqueoActivo) {
    return res.status(409).json({ error: 'No se puede eliminar una máquina con un LOTO abierto' });
  }

  if (maquina.eventos.length > 0) {
    return res.status(409).json({ error: 'No se puede eliminar una máquina con historial LOTO; el historial debe conservarse' });
  }

  await prisma.$transaction(async (tx) => {
    await tx.imagenMaquina.deleteMany({ where: { maquinaId } });
    await tx.puntoBloqueo.deleteMany({ where: { maquinaId } });
    await tx.maquina.delete({ where: { id: maquinaId } });
  });

  return res.json({ message: 'Máquina eliminada' });
});

app.post('/api/catalogo/maquinas', async (req, res) => {
  const { nombre, linea, qrCode, puntos = [], imagenes = [] } = req.body;

  if (!nombre || !linea || !qrCode) {
    return res.status(400).json({
      error: 'nombre, linea y qrCode son obligatorios'
    });
  }

  const puntosValidos = Array.isArray(puntos) && puntos.length > 0
    ? puntos
    : [{ nombre: 'Bloqueo general', tipoEnergia: 'OTRA' }];

  const imagenesValidas = Array.isArray(imagenes)
    ? imagenes
        .map((imagen, index) => ({
          url: String(imagen?.url || '').trim(),
          etiqueta: String(imagen?.etiqueta || '').trim() || `Imagen ${index + 1}`,
          orden: Number(imagen?.orden || index + 1)
        }))
        .filter((imagen) => imagen.url)
    : [];

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
            tipoEnergia: punto.tipoEnergia || 'OTRA',
            identificador: String(punto.identificador || '').trim() || null,
            ubicacion: String(punto.ubicacion || '').trim() || null,
            metodoAccion: String(punto.metodoAccion || '').trim() || null,
            dispositivoBloqueo: String(punto.dispositivoBloqueo || '').trim() || null,
            validacion: String(punto.validacion || '').trim() || null
          },
          create: {
            nombre: String(punto.nombre || `Punto ${index + 1}`).trim(),
            tipoEnergia: punto.tipoEnergia || 'OTRA',
            identificador: String(punto.identificador || '').trim() || null,
            ubicacion: String(punto.ubicacion || '').trim() || null,
            metodoAccion: String(punto.metodoAccion || '').trim() || null,
            dispositivoBloqueo: String(punto.dispositivoBloqueo || '').trim() || null,
            validacion: String(punto.validacion || '').trim() || null,
            orden: index + 1,
            maquinaId: maquinaRegistro.id
          }
        });
      }

      await tx.imagenMaquina.deleteMany({ where: { maquinaId: maquinaRegistro.id } });

      for (const imagen of imagenesValidas) {
        await tx.imagenMaquina.create({
          data: {
            maquinaId: maquinaRegistro.id,
            url: imagen.url,
            etiqueta: imagen.etiqueta,
            orden: imagen.orden
          }
        });
      }

      return tx.maquina.findUnique({
        where: { id: maquinaRegistro.id },
        include: {
          linea: true,
          puntos: { orderBy: { orden: 'asc' } },
          imagenes: { orderBy: { orden: 'asc' } }
        }
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
    include: {
      linea: true,
      puntos: { orderBy: { orden: 'asc' } },
      imagenes: { orderBy: { orden: 'asc' } }
    }
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
      maquina: { include: { linea: true, imagenes: { orderBy: { orden: 'asc' } } } },
      operador: true,
      puntos: {
        include: { puntoBloqueo: true },
        orderBy: { orden: 'asc' }
      },
      pasosGenericos: {
        include: { pasoGenerico: true },
        orderBy: { id: 'asc' }
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
    include: {
      linea: true,
      puntos: { orderBy: { orden: 'asc' } },
      imagenes: { orderBy: { orden: 'asc' } }
    }
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
          maquina: { include: { linea: true, imagenes: { orderBy: { orden: 'asc' } } } },
          operador: true,
          puntos: {
            include: { puntoBloqueo: true },
            orderBy: { orden: 'asc' }
          },
          pasosGenericos: {
            include: { pasoGenerico: true },
            orderBy: { id: 'asc' }
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
      const pasosGenericos = await tx.pasoGenerico.findMany({
        orderBy: { orden: 'asc' }
      });

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
          },
          pasosGenericos: {
            create: pasosGenericos.flatMap((paso) => [
              {
                pasoGenericoId: paso.id,
                tipo: 'CHECKIN',
                completado: false
              },
              {
                pasoGenericoId: paso.id,
                tipo: 'CHECKOUT',
                completado: false
              }
            ])
          }
        }
      });

      await tx.bloqueoMaquina.create({
        data: { maquinaId: maquina.id, eventoId: nuevoEvento.id }
      });

      return tx.eventoLOTO.findUnique({
        where: { id: nuevoEvento.id },
        include: {
          maquina: { include: { linea: true, imagenes: { orderBy: { orden: 'asc' } } } },
          operador: true,
          puntos: { include: { puntoBloqueo: true } },
          pasosGenericos: { include: { pasoGenerico: true } }
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
  const {
    puntoBloqueoId,
    pasoGenericoId,
    tipo = 'CHECKIN',
    completado = true
  } = req.body;

  if (!puntoBloqueoId && !pasoGenericoId) {
    return res.status(400).json({
      error: 'puntoBloqueoId o pasoGenericoId es obligatorio'
    });
  }

  if (!['CHECKIN', 'CHECKOUT'].includes(tipo)) {
    return res.status(400).json({ error: 'tipo de checkpoint no válido' });
  }

  const evento = await prisma.eventoLOTO.findUnique({
    where: { id: Number(req.params.id) },
    include: {
      maquina: {
        include: {
          puntos: { orderBy: { orden: 'asc' } },
          imagenes: { orderBy: { orden: 'asc' } }
        }
      },
      puntos: true,
      pasosGenericos: {
        include: { pasoGenerico: true },
        orderBy: { id: 'asc' }
      }
    }
  });

  if (!evento) {
    return res.status(404).json({ error: 'Evento no encontrado' });
  }

  if (evento.estado === 'CERRADO') {
    return res.status(409).json({ error: 'El evento ya está cerrado' });
  }

  if (puntoBloqueoId) {
    const punto = evento.maquina.puntos.find((item) => item.id === Number(puntoBloqueoId));

    if (!punto) {
      return res.status(400).json({ error: 'El punto no pertenece a la máquina del evento' });
    }

    const pasosPreviosCompletos = evento.pasosGenericos
      .filter((item) => item.tipo === 'CHECKIN' && item.pasoGenerico.orden <= 5)
      .every((item) => item.completado);

    if (tipo === 'CHECKIN' && completado && !pasosPreviosCompletos) {
      return res.status(409).json({ error: 'Debes completar los pasos 1 al 5 antes de bloquear las fuentes de energía' });
    }

    if (completado) {
      const puntosOrdenados = tipo === 'CHECKIN'
        ? evento.maquina.puntos
        : [...evento.maquina.puntos].reverse();
      const indiceActual = puntosOrdenados.findIndex((item) => item.id === punto.id);
      const anterior = puntosOrdenados[indiceActual - 1];
      const anteriorEvento = anterior && evento.puntos.find(
        (item) => item.puntoBloqueoId === anterior.id && item.tipo === tipo
      );

      if (anterior && !anteriorEvento?.completado) {
        return res.status(409).json({
          error: tipo === 'CHECKIN'
            ? 'Debes completar primero el punto anterior'
            : 'Debes retirar primero el bloqueo anterior en orden inverso'
        });
      }
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

    return res.json({ message: 'Punto actualizado', punto: eventoPunto });
  }

  const paso = evento.pasosGenericos.find((item) => item.pasoGenericoId === Number(pasoGenericoId));

  if (!paso) {
    return res.status(400).json({ error: 'El paso no pertenece al checklist del evento' });
  }

  const bloqueosCompletos = evento.maquina.puntos.every((punto) =>
    evento.puntos.some((item) =>
      item.puntoBloqueoId === punto.id && item.tipo === 'CHECKIN' && item.completado
    )
  );

  if (tipo === 'CHECKIN' && completado && paso.pasoGenerico.orden >= 7 && !bloqueosCompletos) {
    return res.status(409).json({ error: 'Debes completar el paso 6 antes de continuar' });
  }

  const pasoOrdenado = [...evento.pasosGenericos]
    .filter((item) => item.tipo === tipo)
    .sort((a, b) => (tipo === 'CHECKOUT'
      ? b.pasoGenerico.orden - a.pasoGenerico.orden
      : a.pasoGenerico.orden - b.pasoGenerico.orden));

  if (completado) {
    const indiceActual = pasoOrdenado.findIndex((item) => item.pasoGenericoId === Number(pasoGenericoId));
    const anterior = pasoOrdenado[indiceActual - 1];
    const anteriorCompletado = anterior
      ? evento.pasosGenericos.find(
        (item) => item.pasoGenericoId === anterior.pasoGenericoId && item.tipo === tipo
      )?.completado
      : true;

    if (anterior && !anteriorCompletado) {
      return res.status(409).json({
        error: tipo === 'CHECKIN'
          ? 'Debes completar primero el paso anterior'
          : 'Debes revertir primero el paso anterior en orden inverso'
      });
    }
  }

  const eventoPaso = await prisma.eventoPasoGenerico.upsert({
    where: {
      eventoId_pasoGenericoId_tipo: {
        eventoId: Number(req.params.id),
        pasoGenericoId: Number(pasoGenericoId),
        tipo
      }
    },
    update: {
      completado,
      realizadoAt: completado ? new Date() : null
    },
    create: {
      eventoId: Number(req.params.id),
      pasoGenericoId: Number(pasoGenericoId),
      tipo,
      completado,
      realizadoAt: completado ? new Date() : null
    }
  });

  return res.json({ message: 'Paso actualizado', paso: eventoPaso });
});

app.post('/api/eventos/:id/checkout', async (req, res) => {
  const evento = await prisma.eventoLOTO.findUnique({
    where: { id: Number(req.params.id) },
    include: {
      maquina: {
        include: {
          linea: true,
          puntos: { orderBy: { orden: 'asc' } },
          imagenes: { orderBy: { orden: 'asc' } }
        }
      },
      operador: true,
      puntos: true,
      pasosGenericos: {
        include: { pasoGenerico: true },
        orderBy: { id: 'asc' }
      }
    }
  });

  if (!evento) {
    return res.status(404).json({ error: 'Evento no encontrado' });
  }

  if (evento.estado === 'CERRADO') {
    return res.status(409).json({ error: 'El evento ya está cerrado' });
  }

  const pasosCheckin = [...evento.pasosGenericos]
    .filter((item) => item.tipo === 'CHECKIN')
    .sort((a, b) => a.pasoGenerico.orden - b.pasoGenerico.orden);

  const checkinCompleto = pasosCheckin.every((item) => item.completado) &&
    evento.maquina.puntos.every((punto) =>
      evento.puntos.some(
        (eventoPunto) => eventoPunto.puntoBloqueoId === punto.id &&
          eventoPunto.tipo === 'CHECKIN' &&
          eventoPunto.completado
      )
    );

  if (!checkinCompleto) {
    return res.status(409).json({ error: 'No puedes cerrar el evento con el checklist de bloqueo incompleto' });
  }

  const pasosCheckout = [...evento.pasosGenericos]
    .filter((item) => item.tipo === 'CHECKOUT')
    .sort((a, b) => b.pasoGenerico.orden - a.pasoGenerico.orden);

  const puntosInversos = [...evento.maquina.puntos].reverse();
  const checkoutCompleto = pasosCheckout.every((item) => item.completado) &&
    puntosInversos.every((punto) =>
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
