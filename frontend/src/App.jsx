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
  const [checkinSteps, setCheckinSteps] = useState([]);
  const [checkoutSteps, setCheckoutSteps] = useState([]);
  const [recoveryEmployee, setRecoveryEmployee] = useState('');
  const [activeEvents, setActiveEvents] = useState([]);
  const [catalogMachine, setCatalogMachine] = useState({ nombre: '', linea: '', qrCode: '' });
  const [catalogPoints, setCatalogPoints] = useState([{ nombre: '', tipoEnergia: 'OTRA' }]);
  const [catalogImages, setCatalogImages] = useState([{ url: '', etiqueta: 'Paso 5', orden: 1 }]);
  const [catalogMessage, setCatalogMessage] = useState('');
  const [mode, setMode] = useState('checkin');
  const [scannerOpen, setScannerOpen] = useState(false);
  const [error, setError] = useState('');

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
      puntos: data.puntos || [],
      imagenes: data.imagenes || []
    });
  }

  function normalizeGenericSteps(items = [], tipo) {
    return [...(items || [])]
      .filter((item) => item.tipo === tipo)
      .sort((a, b) => {
        const pasoA = a.pasoGenerico?.orden ?? a.orden ?? 0;
        const pasoB = b.pasoGenerico?.orden ?? b.orden ?? 0;
        return pasoA - pasoB;
      })
      .map((item) => ({
        ...item,
        pasoGenerico: item.pasoGenerico || {}
      }));
  }

  function energyImage(type) {
    return `/energy/${String(type || 'OTRA').toLowerCase()}.svg`;
  }

  useEffect(() => {
    if (!scannerOpen) return undefined;

    const scanner = new Html5Qrcode('qr-reader');
    let active = true;
    let stopPromise;

    function stopScanner() {
      if (!stopPromise) {
        stopPromise = scanner.stop()
          .then(() => scanner.clear())
          .catch(() => {});
      }

      return stopPromise;
    }

    scanner.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: { width: 250, height: 180 } },
      async (decodedText) => {
        if (!active) return;

        active = false;
        const scannedQr = extractQrCode(decodedText);
        await stopScanner();
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
      if (!active) return;
      setScannerOpen(false);
      setError('No se pudo acceder a la cámara. Revisa los permisos.');
    });

    return () => {
      active = false;
      stopScanner();
    };
  }, [scannerOpen]);

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
          puntos: catalogPoints.filter((point) => point.nombre.trim()),
          imagenes: catalogImages
            .filter((image) => image.url?.trim())
            .map((image, index) => ({
              ...image,
              orden: Number(image.orden || index + 1),
              etiqueta: image.etiqueta?.trim() || `Imagen ${index + 1}`
            }))
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

    if (mode === 'checkout') {
      try {
        const res = await fetch(`${API_URL}/eventos/reanudar`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ numeroEmpleado })
        });
        const data = await res.json();
        const eventoActivo = data.eventos?.[0];

        if (!res.ok) {
          setError(data?.error || 'No se pudo buscar la sesión de Check-out');
          return;
        }

        if (!eventoActivo) {
          setError('No hay una sesión LOTO abierta para ese empleado');
          return;
        }

        setResolvedMachine(eventoActivo.maquina);
        loadEvent(eventoActivo);
        setError('');
        return;
      } catch (err) {
        setError('No se pudo consultar la sesión de Check-out');
        return;
      }
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
    setCheckinSteps(normalizeGenericSteps(savedEvent.pasosGenericos, 'CHECKIN'));
    setCheckoutSteps(normalizeGenericSteps(savedEvent.pasosGenericos, 'CHECKOUT').reverse());
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
        if (res.status === 409 && data?.error === 'El evento ya está cerrado') {
          setEvent(null);
          setCheckinPoints([]);
          setCheckoutPoints([]);
          setCheckinSteps([]);
          setCheckoutSteps([]);
          setMode('checkout');
          setError('Esta sesión ya fue cerrada. Busca otra sesión activa.');
          return;
        }
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
        if (res.status === 409 && data?.error === 'El evento ya está cerrado') {
          setEvent(null);
          setCheckinPoints([]);
          setCheckoutPoints([]);
          setCheckinSteps([]);
          setCheckoutSteps([]);
          setMode('checkout');
          setError('Esta sesión ya fue cerrada. Busca otra sesión activa.');
          return;
        }
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

  async function completeCheckinStep(step) {
    if (!event || !step?.pasoGenericoId) return;

    try {
      const res = await fetch(`${API_URL}/eventos/${event.id}/checkpoint`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pasoGenericoId: step.pasoGenericoId,
          tipo: 'CHECKIN',
          completado: true
        })
      });
      const data = await res.json();

      if (!res.ok) {
        if (res.status === 409 && data?.error === 'El evento ya está cerrado') {
          setEvent(null);
          setCheckinPoints([]);
          setCheckoutPoints([]);
          setCheckinSteps([]);
          setCheckoutSteps([]);
          setMode('checkout');
          setError('Esta sesión ya fue cerrada. Busca otra sesión activa.');
          return;
        }
        setError(data?.error || 'No se pudo completar el paso');
        return;
      }

      setCheckinSteps((current) => current.map((item) =>
        item.pasoGenericoId === step.pasoGenericoId ? { ...item, completado: true } : item
      ));
      setError('');
    } catch (err) {
      setError('No se pudo guardar el paso');
    }
  }

  async function completeCheckoutStep(step) {
    if (!event || !step?.pasoGenericoId) return;

    try {
      const res = await fetch(`${API_URL}/eventos/${event.id}/checkpoint`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pasoGenericoId: step.pasoGenericoId,
          tipo: 'CHECKOUT',
          completado: true
        })
      });
      const data = await res.json();

      if (!res.ok) {
        if (res.status === 409 && data?.error === 'El evento ya está cerrado') {
          setEvent(null);
          setCheckinPoints([]);
          setCheckoutPoints([]);
          setCheckinSteps([]);
          setCheckoutSteps([]);
          setMode('checkout');
          setError('Esta sesión ya fue cerrada. Busca otra sesión activa.');
          return;
        }
        setError(data?.error || 'No se pudo registrar la reversión del paso');
        return;
      }

      setCheckoutSteps((current) => current.map((item) =>
        item.pasoGenericoId === step.pasoGenericoId ? { ...item, completado: true } : item
      ));
      setError('');
    } catch (err) {
      setError('No se pudo guardar la reversión del paso');
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
        <div className="brand-lockup">
          <img src="/zf-mark.svg" alt="ZF" className="zf-mark" />
          <div>
            <p className="eyebrow">Smart Factory ESL</p>
            <h1>Registro de LOTO</h1>
          </div>
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
            className={mode === 'catalog' ? 'mode-button active' : 'mode-button'}
            onClick={() => { setMode('catalog'); setEvent(null); setError(''); }}
          >
            Registrar máquina
          </button>
        </div>

        {mode === 'catalog' && (
          <section className="resume-section">
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

                <div className="energy-picker">
                  <img className="energy-picker-icon" src={energyImage(point.tipoEnergia)} alt="" />
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
                    <option value="GRAVEDAD">Gravedad</option>
                    <option value="OTRA">Otra</option>
                  </select>
                </div>

                {catalogPoints.length > 1 && (
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => {
                      setCatalogPoints(catalogPoints.filter((_, i) => i !== index));
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
                  { nombre: '', tipoEnergia: 'OTRA' }
                ])
              }
            >
              + Agregar punto de bloqueo
            </button>

            <label>Imágenes del paso 5</label>
            {catalogImages.map((image, index) => (
              <div key={index} className="catalog-image-row">
                <input
                  value={image.url}
                  onChange={(e) => {
                    const updated = [...catalogImages];
                    updated[index] = {
                      ...updated[index],
                      url: e.target.value
                    };
                    setCatalogImages(updated);
                  }}
                  placeholder="URL de la imagen"
                />
                {catalogImages.length > 1 && (
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => setCatalogImages(catalogImages.filter((_, i) => i !== index))}
                  >
                    Quitar
                  </button>
                )}
              </div>
            ))}

            <button
              type="button"
              className="secondary"
              onClick={() => setCatalogImages([
                ...catalogImages,
                { url: '', etiqueta: `Imagen ${catalogImages.length + 1}`, orden: catalogImages.length + 1 }
              ])}
            >
              + Agregar imagen del paso 5
            </button>

            <button className="secondary" onClick={registerMachine}>Registrar máquina</button>
            {catalogMessage && <p className="status-message">{catalogMessage}</p>}
          </section>
        )}

        {(mode === 'checkin' || mode === 'checkout') && !event && (
          <>
            {mode === 'checkin' && <label>
              QR de máquina
              <input value={qrCode} onChange={(e) => setQrCode(e.target.value)} />
            </label>}

            {mode === 'checkin' && <button className="secondary" onClick={() => setScannerOpen((open) => !open)}>
              {scannerOpen ? 'Cerrar cámara' : 'Escanear QR con cámara'}
            </button>}

            {mode === 'checkin' && scannerOpen && <div id="qr-reader" className="qr-reader" />}

            {mode === 'checkin' && machineInfo && (
              <div className="machine-box">
                <p><strong>Máquina:</strong> {machineInfo.nombre}</p>
                <p><strong>Línea:</strong> {machineInfo.linea}</p>
              </div>
            )}

            <label>
              Número de empleado
              <input value={empleado} onChange={(e) => setEmpleado(e.target.value)} />
            </label>

            <button className="primary" onClick={openEvent}>{mode === 'checkout' ? 'Buscar evento LOTO' : 'Abrir evento LOTO'}</button>
          </>
        )}

        {event && mode === 'checkin' && (
          <section className="checklist">
            <h2>Checklist de bloqueo</h2>

            <ul className="step-list">
              {checkinSteps.map((step, index) => (
                <li key={`checkin-step-${step.pasoGenericoId || index}`} className="step-row">
                  <input
                    type="checkbox"
                    checked={Boolean(step.completado)}
                    disabled={step.completado || (index > 0 && !checkinSteps[index - 1].completado)}
                    onChange={() => completeCheckinStep(step)}
                  />
                  <div className="step-text">
                    <strong>{step.pasoGenerico?.titulo || `Paso ${index + 1}`}</strong>
                    <p>{step.pasoGenerico?.descripcion}</p>
                    {step.pasoGenerico?.orden === 5 && machineInfo?.imagenes?.length > 0 && (
                      <div className="step-images">
                        {machineInfo.imagenes.map((image, imageIndex) => (
                          <figure key={`${step.pasoGenericoId}-${imageIndex}`}>
                            <img src={image.url} alt={image.etiqueta || `Imagen ${imageIndex + 1}`} />
                            {image.etiqueta && <figcaption>{image.etiqueta}</figcaption>}
                          </figure>
                        ))}
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>

            <div className="step-section-title">Paso 6: Bloquee las fuentes de energía</div>
            <ul className="step-list">
              {checkinPoints.map((point, index) => (
                <li key={point.puntoBloqueoId} className="point-row">
                  <input
                    type="checkbox"
                    checked={point.completado}
                    disabled={point.completado || (index > 0 && !checkinPoints[index - 1].completado)}
                    onChange={() => completeCheckinPoint(point, index)}
                  />
                  <img className="energy-icon" src={energyImage(point.puntoBloqueo?.tipoEnergia)} alt="" />
                  <span>{point.puntoBloqueo?.nombre} ({point.puntoBloqueo?.tipoEnergia || 'OTRA'})</span>
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

            <div className="step-section-title">Paso 6: Bloquee las fuentes de energía</div>
            <ul className="step-list">
              {checkoutPoints.map((point, index) => (
                <li key={`checkout-${point.puntoBloqueoId}`} className="point-row">
                  <input
                    type="checkbox"
                    checked={point.completado}
                    disabled={point.completado || (index > 0 && !checkoutPoints[index - 1].completado)}
                    onChange={() => completeCheckoutPoint(point, index)}
                  />
                  <img className="energy-icon" src={energyImage(point.puntoBloqueo?.tipoEnergia)} alt="" />
                  <span>{point.puntoBloqueo?.nombre} ({point.puntoBloqueo?.tipoEnergia || 'OTRA'})</span>
                </li>
              ))}
            </ul>

            <ul className="step-list">
              {checkoutSteps.map((step, index) => (
                <li key={`checkout-step-${step.pasoGenericoId || index}`} className="step-row">
                  <input
                    type="checkbox"
                    checked={Boolean(step.completado)}
                    disabled={step.completado || (index > 0 && !checkoutSteps[index - 1].completado)}
                    onChange={() => completeCheckoutStep(step)}
                  />
                  <div className="step-text">
                    <strong>{step.pasoGenerico?.titulo || `Paso ${index + 1}`}</strong>
                    <p>{step.pasoGenerico?.descripcion}</p>
                  </div>
                </li>
              ))}
            </ul>
            <button className="danger" disabled={!checkoutPoints.every((point) => point.completado) || !checkoutSteps.every((step) => step.completado)} onClick={closeEvent}>
              Cerrar LOTO
            </button>
          </section>
        )}

        {error && <p className="error">{error}</p>}
      </main>
    </div>
  );
}
