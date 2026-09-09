import { useMemo, useState } from 'react';

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
  const [error, setError] = useState('');

  const steps = useMemo(
    () => [
      'Bloquear breaker principal',
      'Cerrar válvula neumática',
      'Cerrar válvula hidráulica'
    ],
    []
  );

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
        linea: data.linea?.nombre || 'Sin línea'
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
      setError('');
    } catch (err) {
      setError('No se pudo abrir el LOTO');
    }
  }

  async function closeEvent() {
    if (!event) return;

    try {
      const payload = {
        puntos: steps.map((step, index) => ({
          puntoBloqueoId: index + 1,
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
              {steps.map((step, index) => (
                <li key={step}>
                  <input type="checkbox" defaultChecked={index === 0} /> {step}
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
