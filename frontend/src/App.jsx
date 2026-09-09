import { useEffect, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';

const API_URL = 'http://localhost:4000/api';

const initialMachine = {
  qrCode: 'QR-P12',
  nombre: 'Prensa 12',
  linea: 'Línea 3'
};

export default function App() {
  const [qrCode, setQrCode] = useState('QR-P12');
  const [empleado, setEmpleado] = useState('48213');
  const [machineInfo, setMachineInfo] = useState(initialMachine);
  const [event, setEvent] = useState(null);
  const [checkinPoints, setCheckinPoints] = useState([]);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!scannerOpen) return undefined;

    const scanner = new Html5Qrcode('qr-reader');
    let active = true;

    scanner.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: { width: 250, height: 180 } },
      async (decodedText) => {
        if (!active) return;

        active = false;
        setQrCode(decodedText);
        setScannerOpen(false);

        try {
          const res = await fetch(`${API_URL}/maquinas/${encodeURIComponent(decodedText)}`);
          const data = await res.json();

          if (!res.ok) {
            setError(data?.error || 'El QR no corresponde a una máquina');
            return;
          }

          setMachineInfo({
            qrCode: data.qrCode,
            nombre: data.nombre,
            linea: data.linea?.nombre || 'Sin línea',
            puntos: data.puntos || []
          });
          setError('');
        } catch (err) {
          setError('No se pudo conectar con el backend');
        }

        scanner.stop().catch(() => {});
      },
      () => {}
    ).catch(() => {
      setScannerOpen(false);
      setError('No se pudo acceder a la cámara. Revisa los permisos.');
    });

    return () => {
      active = false;
      scanner.stop().catch(() => {});
    };
  }, [scannerOpen]);

  async function checkMachine() {
    try {
      const res = await fetch(`${API_URL}/maquinas/${encodeURIComponent(qrCode)}`);
      const data = await res.json();

      if (!res.ok) {
        setError(data?.error || 'No se pudo resolver la máquina');
        return;
      }

      setMachineInfo({
        qrCode: data.qrCode,
        nombre: data.nombre,
        linea: data.linea?.nombre || 'Sin línea',
        puntos: data.puntos || []
      });
      setError('');
    } catch (err) {
      setError('No se pudo conectar con el backend');
    }
  }

  async function openEvent() {
    try {
      const res = await fetch(`${API_URL}/eventos/checkin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ qrCode, numeroEmpleado: empleado })
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data?.error || 'No se pudo abrir el evento');
        return;
      }

      setEvent(data.evento);
      setCheckinPoints(data.evento.puntos || []);
      setError('');
    } catch (err) {
      setError('No se pudo abrir el LOTO');
    }
  }

  async function completeCheckinPoint(eventPoint, index) {
    if (index > 0 && !checkinPoints[index - 1].completado) {
      setError('Completa primero el punto anterior');
      return;
    }

    try {
      const res = await fetch(`${API_URL}/eventos/${event.id}/checkpoint`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          puntoBloqueoId: eventPoint.puntoBloqueoId,
          tipo: 'CHECKIN',
          completado: true
        })
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data?.error || 'No se pudo completar el punto');
        return;
      }

      setCheckinPoints((current) => current.map((point) =>
        point.puntoBloqueoId === eventPoint.puntoBloqueoId
          ? { ...point, completado: true }
          : point
      ));
      setError('');
    } catch (err) {
      setError('No se pudo guardar el punto');
    }
  }

  async function closeEvent() {
    if (!event) return;

    try {
      const payload = {
        puntos: [...checkinPoints].reverse().map((point, index) => ({
          puntoBloqueoId: point.puntoBloqueoId,
          orden: index + 1,
          completado: true
        }))
      };

      const res = await fetch(`${API_URL}/eventos/${event.id}/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data?.error || 'No se pudo cerrar el evento');
        return;
      }

      setEvent(null);
      setCheckinPoints([]);
      setError('');
      alert('LOTO cerrado correctamente');
    } catch (err) {
      setError('Error al cerrar el evento');
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">LOTO Digital</p>
          <h1>Check-in de máquina</h1>
        </div>
      </header>

      <main className="card">
        <label>
          QR de máquina
          <input value={qrCode} onChange={(e) => setQrCode(e.target.value)} />
        </label>

        <button className="secondary" onClick={() => setScannerOpen((open) => !open)}>
          {scannerOpen ? 'Cerrar cámara' : 'Escanear QR con cámara'}
        </button>

        {scannerOpen && <div id="qr-reader" className="qr-reader" />}

        <button className="secondary" onClick={checkMachine}>Resolver QR</button>

        {machineInfo && (
          <div className="machine-box">
            <p><strong>Máquina:</strong> {machineInfo.nombre}</p>
            <p><strong>Línea:</strong> {machineInfo.linea}</p>
          </div>
        )}

        <label>
          Número de empleado
          <input value={empleado} onChange={(e) => setEmpleado(e.target.value)} />
        </label>

        <button className="primary" onClick={openEvent}>Abrir evento LOTO</button>

        {event && (
          <section className="checklist">
            <h2>Checklist de bloqueo</h2>
            <ul>
              {checkinPoints.map((point, index) => (
                <li key={point.puntoBloqueoId}>
                  <input
                    type="checkbox"
                    checked={point.completado}
                    disabled={point.completado || (index > 0 && !checkinPoints[index - 1].completado)}
                    onChange={() => completeCheckinPoint(point, index)}
                  /> {point.puntoBloqueo?.nombre}
                </li>
              ))}
            </ul>
            <button className="danger" onClick={closeEvent}>Cerrar LOTO</button>
          </section>
        )}

        {error && <p className="error">{error}</p>}
      </main>
    </div>
  );
}
