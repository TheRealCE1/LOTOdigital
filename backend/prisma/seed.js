const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  const linea = await prisma.linea.upsert({
    where: { nombre: 'Línea 3' },
    update: {},
    create: { nombre: 'Línea 3' }
  });

  const maquina = await prisma.maquina.upsert({
    where: { qrCode: 'QR-P12' },
    update: { nombre: 'Prensa 12', lineaId: linea.id },
    create: {
      nombre: 'Prensa 12',
      qrCode: 'QR-P12',
      lineaId: linea.id
    }
  });

  const puntos = [
    'Bloquear breaker principal',
    'Cerrar válvula neumática',
    'Cerrar válvula hidráulica'
  ];

  for (const [index, nombre] of puntos.entries()) {
    await prisma.puntoBloqueo.upsert({
      where: {
        maquinaId_orden: {
          maquinaId: maquina.id,
          orden: index + 1
        }
      },
      update: { nombre },
      create: {
        nombre,
        orden: index + 1,
        maquinaId: maquina.id
      }
    });
  }

  console.log(`Datos iniciales creados para ${maquina.nombre} (${maquina.qrCode})`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });