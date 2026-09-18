import { useEffect, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';

const API_URL = import.meta.env.VITE_API_URL || '/api';

export default function App() {
  const [qrCode, setQrCode] = useState('');
  const [empleado, setEmpleado] = useState('');
  const [machineInfo, setMachineInfo] = useState(null);
  const [event, setEvent] = useState(null);
  const [checkinPoints, setCheckinPoints] = useState([]);
  const [checkoutPoints, setCheckoutPoints] = useState([]);
  const [recoveryEmployee, setRecoveryEmployee] = useState('');
  const [activeEvents, setActiveEvents] = useState([]);
  const [catalogMachine, setCatalogMachine] = useState({ nombre: '', linea: '', qrCode: '' });
  const [catalogPoints, setCatalogPoints] = useState([{ nombre: '', tipoEnergia: 'OTRA' }]);
  const [catalogMessage, setCatalogMessage] = useState('');
  const [mode, setMode] = useState('checkin');
  const [scannerOpen, setScannerOpen] = useState(false);
  const [error, setError] = useState('');

  const ENERGY_ICONS = {
    ELECTRICA: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="13 2 3 14 11 14 10 22 21 10 13 10 13 2" />
      </svg>
    ),
    NEUMATICA: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 9h13a3 3 0 1 0-2.5-4.7" />
        <path d="M2 15h17a3 3 0 1 1-2.5 4.7" />
        <path d="M2 12h9" />
      </svg>
    ),
    HIDRAULICA: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2s7 8.5 7 13a7 7 0 1 1-14 0c0-4.5 7-13 7-13z" />
      </svg>
    ),
    MECANICA: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    ),
    OTRA: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="5" y="11" width="14" height="10" rx="2" />
        <path d="M8 11V7a4 4 0 0 1 8 0v4" />
      </svg>
    )
  };

  function EnergyIcon({ tipo }) {
    return (
      <span className={`energy-icon energy-${(tipo || 'OTRA').toLowerCase()}`} aria-hidden="true">
        {ENERGY_ICONS[tipo] || ENERGY_ICONS.OTRA}
      </span>
    );
  }

  function extractQrCode(value) {
    const rawValue = String(value || '').trim();

    try {
      const url = new URL(rawValue);
      return url.searchParams.get('qr')?.trim() || rawValue;
    } catch (err) {
      return rawValue;
    }
  }

  function setResolvedMachine(data) {
    setMachineInfo({
      qrCode: data.qrCode,
      nombre: data.nombre,
      linea: data.linea?.nombre || 'Sin línea',
      puntos: data.puntos || []
    });
  }

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

        try {
          await scanner.stop();
        } catch (err) {
          // ya se detuvo o el nodo ya no existe, se ignora
        }

        const scannedQr = extractQrCode(decodedText);
        setQrCode(scannedQr);
        setScannerOpen(false);

        try {
          const res = await fetch(`${API_URL}/maquinas/${encodeURIComponent(scannedQr)}`);
          const data = await res.json();

          if (!res.ok) {
            setError(data?.error || 'El QR no corresponde a una máquina');
            return;
          }

          setResolvedMachine(data);
          setError('');
        } catch (err) {
          setError('No se pudo conectar con el backend');
        }
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
    const scannedQr = extractQrCode(qrCode);

    if (!scannedQr) {
      setError('Primero escanea o introduce un QR');
      return;
    }

    try {
      const res = await fetch(`${API_URL}/maquinas/${encodeURIComponent(scannedQr)}`);
      const data = await res.json();

      if (!res.ok) {
        setError(data?.error || 'No se pudo resolver la máquina');
        return;
      }

      setQrCode(scannedQr);
      setResolvedMachine(data);
      setError('');
    } catch (err) {
      setError('No se pudo conectar con el backend');
    }
  }

  async function registerMachine() {
    if (!catalogMachine.nombre.trim() || !catalogMachine.linea.trim() || !catalogMachine.qrCode.trim()) {
      setCatalogMessage('Captura máquina, línea y QR');
      return;
    }

    try {
      const res = await fetch(`${API_URL}/catalogo/maquinas`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...catalogMachine,
          puntos: catalogPoints.filter((point) => point.nombre.trim())
        })
      });
      const data = await res.json();

      if (!res.ok) {
        setCatalogMessage(data?.error || 'No se pudo registrar la máquina');
        return;
      }

      setQrCode(data.maquina.qrCode);
      setResolvedMachine(data.maquina);
      setCatalogMessage('Máquina registrada y lista para Check-in');
    } catch (err) {
      setCatalogMessage('No se pudo conectar con el backend');
    }
  }

  async function openEvent() {
    const numeroEmpleado = empleado.trim();

    if (!numeroEmpleado) {
      setError('Introduce tu número de empleado');
      return;
    }

    try {
      const res = await fetch(`${API_URL}/eventos/checkin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ qrCode: extractQrCode(qrCode), numeroEmpleado })
      });

      const data = await res.json();

      if (!res.ok) {
        if (res.status === 409 && data?.operadorActivo) {
          setError(`La máquina está bloqueada por el empleado ${data.operadorActivo}. Debe completar su Check-out antes de iniciar otro LOTO.`);
          return;
        }
        setError(data?.error || 'No se pudo abrir el evento');
        return;
      }

      loadEvent(data.evento);
      setMode('checkin');
      setError('');
    } catch (err) {
      setError('No se pudo abrir el LOTO');
    }
  }

  function loadEvent(savedEvent) {
    setEvent(savedEvent);
    setCheckinPoints(savedEvent.puntos?.filter((point) => point.tipo === 'CHECKIN') || []);
    setCheckoutPoints([...(savedEvent.puntos?.filter((point) => point.tipo === 'CHECKIN') || [])].reverse().map((point) => ({
        ...point,
        completado: Boolean(savedEvent.puntos.find(
          (savedPoint) => savedPoint.puntoBloqueoId === point.puntoBloqueoId && savedPoint.tipo === 'CHECKOUT'
        )?.completado)
      })));
  }

  async function resumeEvents() {
    if (!recoveryEmployee.trim()) {
      setError('Introduce tu número de empleado para recuperar la sesión');
      return;
    }

    try {
      const res = await fetch(`${API_URL}/eventos/reanudar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ numeroEmpleado: recoveryEmployee.trim() })
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data?.error || 'No se pudieron buscar sesiones');
        return;
      }

      setActiveEvents(data.eventos || []);
      setError(data.eventos?.length ? '' : 'No hay sesiones LOTO abiertas para ese empleado');
    } catch (err) {
      setError('No se pudo consultar la sesión guardada');
    }
  }

  async function completeCheckoutPoint(eventPoint, index) {
    if (index > 0 && !checkoutPoints[index - 1].completado) {
      setError('Retira primero el bloqueo anterior');
      return;
    }

    try {
      const res = await fetch(`${API_URL}/eventos/${event.id}/checkpoint`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          puntoBloqueoId: eventPoint.puntoBloqueoId,
          tipo: 'CHECKOUT',
          completado: true
        })
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data?.error || 'No se pudo registrar el retiro');
        return;
      }

      setCheckoutPoints((current) => current.map((point) =>
        point.puntoBloqueoId === eventPoint.puntoBloqueoId
          ? { ...point, completado: true }
          : point
      ));
      setError('');
    } catch (err) {
      setError('No se pudo guardar el retiro');
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
      const res = await fetch(`${API_URL}/eventos/${event.id}/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data?.error || 'No se pudo cerrar el evento');
        return;
      }

      setEvent(null);
      setCheckinPoints([]);
      setCheckoutPoints([]);
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
          <p className="eyebrow">Smart Factory</p>
          <h1>Registro de LOTO</h1>
        </div>
      </header>

      <main className="card">
        <div className="mode-switch" role="tablist" aria-label="Flujo LOTO">
          <button
            className={mode === 'checkin' ? 'mode-button active' : 'mode-button'}
            onClick={() => { setMode('checkin'); setEvent(null); setError(''); }}
          >
            Check-in
          </button>
          <button
            className={mode === 'checkout' ? 'mode-button active' : 'mode-button'}
            onClick={() => { setMode('checkout'); setEvent(null); setError(''); }}
          >
            Check-out
          </button>
          <button
            className={mode === 'registro' ? 'mode-button active' : 'mode-button'}
            onClick={() => { setMode('registro'); setEvent(null); setError(''); }}
          >
            Registrar máquina
          </button>
        </div>

        {mode === 'registro' && (
          <section className="resume-section">
            <h2>Registrar máquina nueva</h2>
            <label>
              Máquina
              <input value={catalogMachine.nombre} onChange={(e) => setCatalogMachine({ ...catalogMachine, nombre: e.target.value })} placeholder="Ej. Prensa 12" />
            </label>
            <label>
              Línea
              <input value={catalogMachine.linea} onChange={(e) => setCatalogMachine({ ...catalogMachine, linea: e.target.value })} placeholder="Ej. A8" />
            </label>
            <label>
              QR
              <input value={catalogMachine.qrCode} onChange={(e) => setCatalogMachine({ ...catalogMachine, qrCode: e.target.value })} placeholder="Ej. A8-M01" />
            </label>
            <label>Puntos de bloqueo</label>

          {catalogPoints.map((point, index) => (
            <div key={index} className="lock-point-row">
              <input
                value={point.nombre}
                onChange={(e) => {
                  const updated = [...catalogPoints];
                  updated[index] = {
                    ...updated[index],
                    nombre: e.target.value
                  };
                  setCatalogPoints(updated);
                }}
                placeholder={`Punto de bloqueo ${index + 1}`}
              />

              <span className="energy-select-wrap">
                <EnergyIcon tipo={point.tipoEnergia} />
                <select
                  value={point.tipoEnergia}
                  onChange={(e) => {
                    const updated = [...catalogPoints];
                    updated[index] = {
                      ...updated[index],
                      tipoEnergia: e.target.value
                    };
                    setCatalogPoints(updated);
                  }}
                >
                  <option value="ELECTRICA">Eléctrica</option>
                  <option value="NEUMATICA">Neumática</option>
                  <option value="HIDRAULICA">Hidráulica</option>
                  <option value="MECANICA">Mecánica</option>
                  <option value="OTRA">Otra</option>
                </select>
              </span>

              {catalogPoints.length > 1 && (
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    setCatalogPoints(
                      catalogPoints.filter((_, i) => i !== index)
                    );
                  }}
                >
                  Eliminar
                </button>
              )}
            </div>
          ))}

          <button
            type="button"
            className="secondary"
            onClick={() =>
              setCatalogPoints([
                ...catalogPoints,
                {
                  nombre: '',
                  tipoEnergia: 'OTRA'
                }
              ])
            }
          >
            + Agregar punto de bloqueo
          </button>
          <button className="secondary" onClick={registerMachine}>Registrar máquina</button>
          {catalogMessage && <p className="status-message">{catalogMessage}</p>}
          </section>
        )}

        {mode === 'checkin' && <>
        <label>
          QR de máquina
          <input
            value={qrCode}
            onChange={(e) => setQrCode(e.target.value)}
            onBlur={() => { if (qrCode.trim()) checkMachine(); }}
            onKeyDown={(e) => { if (e.key === 'Enter' && qrCode.trim()) { e.preventDefault(); checkMachine(); } }}
          />
        </label>

        <button className="secondary" onClick={() => setScannerOpen((open) => !open)}>
          {scannerOpen ? 'Cerrar cámara' : 'Escanear QR con cámara'}
        </button>

        {scannerOpen && <div id="qr-reader" className="qr-reader" />}

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
        </>}

        {mode === 'checkout' && <section className="resume-section">
          <h2>Continuar sesión guardada</h2>
          <label>
            Número de empleado
            <input
              value={recoveryEmployee}
              onChange={(e) => setRecoveryEmployee(e.target.value)}
              placeholder="Ej. 48213"
            />
          </label>
          <button className="secondary" onClick={resumeEvents}>Buscar mis bloqueos activos</button>
          {activeEvents.length > 0 && (
            <ul className="session-list">
              {activeEvents.map((savedEvent) => (
                <li key={savedEvent.id}>
                  <span>
                    {savedEvent.maquina.nombre} · {savedEvent.maquina.linea.nombre}
                  </span>
                  <button className="secondary" onClick={() => {
                    loadEvent(savedEvent);
                    setMode('checkout');
                    setResolvedMachine(savedEvent.maquina);
                    setError('');
                  }}>
                    Continuar
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>}

        {event && mode === 'checkin' && (
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
                  />
                  <EnergyIcon tipo={point.puntoBloqueo?.tipoEnergia} />
                  {point.puntoBloqueo?.nombre} ({point.puntoBloqueo?.tipoEnergia || 'OTRA'})
                </li>
              ))}
            </ul>
            <button className="secondary" onClick={() => setMode('checkout')}>
              Ir a Check-out cuando termine el trabajo
            </button>
          </section>
        )}

        {event && mode === 'checkout' && (
          <section className="checklist">
            <h2>Checklist de desbloqueo</h2>
            <ul>
              {checkoutPoints.map((point, index) => (
                <li key={`checkout-${point.puntoBloqueoId}`}>
                  <input
                    type="checkbox"
                    checked={point.completado}
                    disabled={point.completado || (index > 0 && !checkoutPoints[index - 1].completado)}
                    onChange={() => completeCheckoutPoint(point, index)}
                  />
                  <EnergyIcon tipo={point.puntoBloqueo?.tipoEnergia} />
                  {point.puntoBloqueo?.nombre} ({point.puntoBloqueo?.tipoEnergia || 'OTRA'})
                </li>
              ))}
            </ul>
            <button className="danger" disabled={!checkoutPoints.every((point) => point.completado)} onClick={closeEvent}>
              Cerrar LOTO
            </button>
          </section>
        )}

        {error && <p className="error">{error}</p>}
      </main>
    </div>
  );
}
