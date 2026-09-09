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
    { nombre: 'Bloquear breaker principal', tipoEnergia: 'ELECTRICA' },
    { nombre: 'Cerrar válvula neumática', tipoEnergia: 'NEUMATICA' },
    { nombre: 'Cerrar válvula hidráulica', tipoEnergia: 'HIDRAULICA' }
  ];

  for (const [index, punto] of puntos.entries()) {
    await prisma.puntoBloqueo.upsert({
      where: {
        maquinaId_orden: {
          maquinaId: maquina.id,
          orden: index + 1
        }
      },
      update: { nombre: punto.nombre, tipoEnergia: punto.tipoEnergia },
      create: {
        nombre: punto.nombre,
        tipoEnergia: punto.tipoEnergia,
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