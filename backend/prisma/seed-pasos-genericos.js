const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const pasos = [
  {
    orden: 1,
    titulo: 'Paso 1',
    descripcion: 'Identificar la máquina o equipo que se va a intervenir y las fuentes de energía potenciales con las que opera (eléctrica, neumática, mecánica, hidráulica, gas, vapor, gravedad, química, térmica y agua), los puntos de candadeo y etiquetado, y el equipo de bloqueo que se necesitan.'
  },
  {
    orden: 2,
    titulo: 'Paso 2',
    descripcion: 'Notificar a los empleados que serán afectados o interrumpidos con este bloqueo, delimitar la zona de trabajo (cintas, poste delimitador, tablero, señal de alertas visible)'
  },
  {
    orden: 3,
    titulo: 'Paso 3',
    descripcion: 'Apagar la máquina o equipo desde el interruptor o fuente principal de energía'
  },
  {
    orden: 4,
    titulo: 'Paso 4',
    descripcion: 'Solicitar un permiso de trabajo de riesgo y llenarlo de acuerdo al trabajo que se va a realizar'
  },
  {
    orden: 5,
    titulo: 'Paso 5',
    descripcion: 'Aislar las fuentes de energía identificadas en la máquina o equipo. Están señaladas en la(s) siguiente(s) imagen(es).'
  },
  {
    orden: 7,
    titulo: 'Paso 7',
    descripcion: 'Liberar energía almacenada de manera controlada'
  },
  {
    orden: 8,
    titulo: 'Paso 8',
    descripcion: 'Verificar el bloqueo siguiendo las instrucciones de verificación del paso 5'
  },
  {
    orden: 9,
    titulo: 'Paso 9',
    descripcion: 'Mantener el bloqueo durante la intervención de la máquina o equipo'
  }
];

async function main() {
  await prisma.pasoGenerico.deleteMany({
    where: { orden: 10 }
  });

  for (const paso of pasos) {
    await prisma.pasoGenerico.upsert({
      where: { orden: paso.orden },
      update: paso,
      create: paso
    });
  }

  console.log(`Sembrados ${pasos.length} pasos genéricos`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
