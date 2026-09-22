import { useEffect, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';

const API_URL = import.meta.env.VITE_API_URL || '/api';

const CHECKOUT_STEPS = [
  'Verificar que las herramientas, refacciones y/o equipo utilizado para la intervención se retiren.',
  'Orden y limpieza del área.',
  'Volver a colocar las guardas y/o dispositivos de seguridad y validar su funcionamiento correcto.',
  'Notificar a los empleados afectados o interrumpidos, en la intervención de la máquina o equipo, desenergizado.',
  'Verificar que los dispositivos de arranque de la operación estén apagados (off).',
  'Retirar los candados y etiquetas de los dispositivos intervenidos y colocar el interruptor o fuente principal de energía en encendido (on).',
  'Verificar que la máquina opere de manera normal.'
];

const CHECKIN_STEPS = [
  { orden: 1, descripcion: 'Identificar la máquina o equipo que se va a intervenir y las fuentes de energía potenciales con las que opera (eléctrica, neumática, mecánica, hidráulica, gas, vapor, gravedad, química, térmica y agua), los puntos de candadeo y etiquetado, y el equipo de bloqueo que se necesitan.' },
  { orden: 2, descripcion: 'Notificar a los empleados que serán afectados o interrumpidos con este bloqueo, delimitar la zona de trabajo (cintas, poste delimitador, tablero, señal de alertas visible).' },
  { orden: 3, descripcion: 'Apagar la máquina o equipo desde el interruptor o fuente principal de energía.' },
  { orden: 4, descripcion: 'Solicitar un permiso de trabajo de riesgo y llenarlo de acuerdo al trabajo que se va a realizar.' },
  { orden: 5, descripcion: 'Aislar las fuentes de energía identificadas en la máquina o equipo. Están señaladas en la(s) siguiente(s) imagen(es).' },
  { orden: 7, descripcion: 'Liberar energía almacenada de manera controlada.' },
  { orden: 8, descripcion: 'Verificar el bloqueo siguiendo las instrucciones de verificación del paso 5.' },
  { orden: 9, descripcion: 'Mantener el bloqueo durante la intervención de la máquina o equipo.' }
];

const CHECKIN_STEP_ORDER = CHECKIN_STEPS.map((step) => step.orden);

export default function App() {
  const [qrCode, setQrCode] = useState('');
  const [empleado, setEmpleado] = useState('');
  const [machineInfo, setMachineInfo] = useState(null);
  const [event, setEvent] = useState(null);
  const [checkinPoints, setCheckinPoints] = useState([]);
  const [checkoutPoints, setCheckoutPoints] = useState([]);
  const [checkinSteps, setCheckinSteps] = useState([]);
  const [checkoutSteps, setCheckoutSteps] = useState([]);
  const [checkoutServiceSteps, setCheckoutServiceSteps] = useState([]);
  const [baseConditionConfirmed, setBaseConditionConfirmed] = useState(false);
  const [recoveryEmployee, setRecoveryEmployee] = useState('');
  const [activeEvents, setActiveEvents] = useState([]);
  const [catalogMachine, setCatalogMachine] = useState({ nombre: '', linea: '', qrCode: '' });
  const [catalogPoints, setCatalogPoints] = useState([{
    identificador: '',
    nombre: '',
    tipoEnergia: 'OTRA',
    ubicacion: '',
    metodoAccion: '',
    dispositivoBloqueo: '',
    validacion: ''
  }]);
  const [catalogImages, setCatalogImages] = useState([{ url: '', etiqueta: 'Paso 5', orden: 1 }]);
  const [catalogMessage, setCatalogMessage] = useState('');
  const [editingMachineId, setEditingMachineId] = useState(null);
  const [machines, setMachines] = useState([]);
  const [selectedMachine, setSelectedMachine] = useState(null);
  const [machinesMessage, setMachinesMessage] = useState('');
  const [activeMonitorEvents, setActiveMonitorEvents] = useState([]);
  const [monitorMessage, setMonitorMessage] = useState('');
  const [monitorNow, setMonitorNow] = useState(Date.now());
  const [eventHistory, setEventHistory] = useState([]);
  const [historyMessage, setHistoryMessage] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [adminUnlocked, setAdminUnlocked] = useState(false);
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

  function parseCheckoutSteps(value) {
    try {
      return JSON.parse(value || '[]');
    } catch (err) {
      return [];
    }
  }

  function getCheckinStep(order) {
    return checkinSteps.find((step) => step.pasoGenerico?.orden === order);
  }

  function checkinDefinition(order) {
    return CHECKIN_STEPS.find((step) => step.orden === order);
  }

  const hasCompleteCheckinSteps = CHECKIN_STEP_ORDER.every((order) => Boolean(getCheckinStep(order)));

  function checkoutPendingMessage() {
    if (!checkoutServiceSteps.includes(5)) return 'Completa los pasos 1 al 5 de Check-out.';
    if (!checkoutPoints.every((point) => point.completado)) return 'Retira todos los candados y etiquetas del paso 6.';
    if (!checkoutServiceSteps.includes(6)) return 'Confirma la casilla principal del paso 6.';
    if (!checkoutServiceSteps.includes(7)) return 'Completa el paso 7: verificar operación normal.';
    if (!baseConditionConfirmed) return 'Confirma que la máquina quedó en condición base.';
    return 'Checklist completo. Puedes cerrar el evento LOTO.';
  }

  function energyImage(type) {
    return `/energy/${String(type || 'OTRA').toLowerCase()}.svg`;
  }

  function updateCatalogPoint(index, field, value) {
    setCatalogPoints((current) => current.map((point, pointIndex) =>
      pointIndex === index ? { ...point, [field]: value } : point
    ));
  }

  function catalogHeaders(includeContentType = false) {
    return {
      ...(includeContentType ? { 'Content-Type': 'application/json' } : {}),
      'X-Admin-Password': adminPassword
    };
  }

  function formatElapsed(startedAt) {
    const totalMinutes = Math.max(0, Math.floor((monitorNow - new Date(startedAt).getTime()) / 60000));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${hours} h ${String(minutes).padStart(2, '0')} min`;
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

  useEffect(() => {
    if (mode !== 'active-events') return undefined;

    const timer = window.setInterval(() => setMonitorNow(Date.now()), 60000);
    return () => window.clearInterval(timer);
  }, [mode]);

  async function registerMachine() {
    if (!catalogMachine.nombre.trim() || !catalogMachine.linea.trim() || !catalogMachine.qrCode.trim()) {
      setCatalogMessage('Captura máquina, línea y QR');
      return;
    }

    try {
      const res = await fetch(`${API_URL}/catalogo/maquinas`, {
        method: 'POST',
        headers: catalogHeaders(true),
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
      setCatalogMessage(editingMachineId ? 'Máquina actualizada' : 'Máquina registrada y lista para Check-in');
    } catch (err) {
      setCatalogMessage('No se pudo conectar con el backend');
    }
  }

  async function loadMachines() {
    try {
      const res = await fetch(`${API_URL}/catalogo/maquinas`, {
        headers: catalogHeaders()
      });
      const data = await res.json();

      if (!res.ok) {
        setMachinesMessage(data?.error || 'No se pudieron cargar las máquinas');
        return;
      }

      setMachines(data);
      setSelectedMachine((current) => data.find((machine) => machine.id === current?.id) || data[0] || null);
      setMachinesMessage(data.length ? '' : 'No hay máquinas registradas');
    } catch (err) {
      setMachinesMessage('No se pudo conectar con el backend');
    }
  }

  async function loadActiveEvents() {
    try {
      const res = await fetch(`${API_URL}/eventos/activos`, {
        headers: catalogHeaders()
      });
      const data = await res.json();

      if (!res.ok) {
        setMonitorMessage(data?.error || 'No se pudieron cargar los eventos activos');
        return;
      }

      setActiveMonitorEvents(data);
      setMonitorNow(Date.now());
      setMonitorMessage(data.length ? '' : 'No hay eventos LOTO activos');
    } catch (err) {
      setMonitorMessage('No se pudo conectar con el backend');
    }
  }

  async function loadEventHistory() {
    try {
      const res = await fetch(`${API_URL}/eventos/historial`, { headers: catalogHeaders() });
      const data = await res.json();
      if (!res.ok) {
        setHistoryMessage(data?.error || 'No se pudo cargar el historial');
        return;
      }
      setEventHistory(data);
      setHistoryMessage(data.length ? '' : 'No hay eventos registrados');
    } catch (err) {
      setHistoryMessage('No se pudo conectar con el backend');
    }
  }

  async function adminCloseEvent(activeEvent) {
    if (!window.confirm(`¿Cerrar administrativamente el evento de ${activeEvent.maquina?.nombre}?`)) return;

    try {
      const res = await fetch(`${API_URL}/eventos/${activeEvent.id}/cierre-administrativo`, {
        method: 'POST',
        headers: catalogHeaders()
      });
      const data = await res.json();
      if (!res.ok) {
        setMonitorMessage(data?.error || 'No se pudo cerrar el evento');
        return;
      }
      setMonitorMessage(data.message);
      await loadActiveEvents();
    } catch (err) {
      setMonitorMessage('No se pudo conectar con el backend');
    }
  }

  function editMachine(machine) {
    setEditingMachineId(machine.id);
    setCatalogMachine({
      nombre: machine.nombre,
      linea: machine.linea?.nombre || '',
      qrCode: machine.qrCode
    });
    setCatalogPoints(machine.puntos.map((point) => ({
      identificador: point.identificador || '',
      nombre: point.nombre || '',
      tipoEnergia: point.tipoEnergia || 'OTRA',
      ubicacion: point.ubicacion || '',
      metodoAccion: point.metodoAccion || '',
      dispositivoBloqueo: point.dispositivoBloqueo || '',
      validacion: point.validacion || ''
    })));
    setCatalogImages(machine.imagenes.length
      ? machine.imagenes.map((image, index) => ({
        url: image.url,
        etiqueta: image.etiqueta || `Imagen ${index + 1}`,
        orden: image.orden || index + 1
      }))
      : [{ url: '', etiqueta: 'Paso 5', orden: 1 }]);
    setCatalogMessage(`Editando ${machine.nombre}`);
    setMode('catalog');
  }

  async function deleteMachine(machine) {
    if (!window.confirm(`¿Eliminar ${machine.nombre} y todo su historial LOTO? Esta acción no se puede deshacer.`)) return;

    try {
      const res = await fetch(`${API_URL}/catalogo/maquinas/${machine.id}`, {
        method: 'DELETE',
        headers: catalogHeaders()
      });
      const data = await res.json();

      if (!res.ok) {
        setMachinesMessage(data?.error || 'No se pudo eliminar la máquina');
        return;
      }

  setMachinesMessage(data.message);
      await loadMachines();
    } catch (err) {
      setMachinesMessage('No se pudo conectar con el backend');
    }
  }

  async function unlockAdministration() {
    if (!adminPassword) {
      setMachinesMessage('Introduce la contraseña de administración');
      return;
    }

    try {
      const res = await fetch(`${API_URL}/catalogo/acceso`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: adminPassword })
      });
      const data = await res.json();

      if (!res.ok) {
        setMachinesMessage(data?.error || 'No se pudo autorizar el acceso');
        return;
      }

      setAdminUnlocked(true);
      setMachinesMessage('');
      setMode('catalog');
    } catch (err) {
      setMachinesMessage('No se pudo conectar con el backend');
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

      setResolvedMachine(data.maquina);
      loadEvent(data.evento);
      setMode('checkin');
      setError('');
    } catch (err) {
      setError('No se pudo abrir el LOTO');
    }
  }

  function loadEvent(savedEvent) {
    const normalizedCheckinSteps = normalizeGenericSteps(savedEvent.pasosGenericos, 'CHECKIN');
    const needsStepReload = savedEvent.id && !CHECKIN_STEP_ORDER.every((order) =>
      normalizedCheckinSteps.some((step) => step.pasoGenerico?.orden === order)
    );

    setEvent(savedEvent);
    setCheckinPoints(savedEvent.puntos?.filter((point) => point.tipo === 'CHECKIN') || []);
    setCheckoutPoints([...(savedEvent.puntos?.filter((point) => point.tipo === 'CHECKIN') || [])].reverse().map((point) => ({
      ...point,
      completado: Boolean(savedEvent.puntos.find(
        (savedPoint) => savedPoint.puntoBloqueoId === point.puntoBloqueoId && savedPoint.tipo === 'CHECKOUT'
      )?.completado)
    })));
    setCheckinSteps(normalizedCheckinSteps);
    setCheckoutSteps(normalizeGenericSteps(savedEvent.pasosGenericos, 'CHECKOUT').reverse());
    setCheckoutServiceSteps(parseCheckoutSteps(savedEvent.checkoutPasos));
    setBaseConditionConfirmed(Boolean(savedEvent.confirmacionBase));

    if (needsStepReload) {
      fetch(`${API_URL}/eventos/${savedEvent.id}`)
        .then((res) => res.ok ? res.json() : null)
        .then((data) => {
          if (data?.evento) loadEvent(data.evento);
        })
        .catch(() => setError('No se pudieron cargar los pasos completos de Check-in'));
    }
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
          setMode('checkin');
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
          setMode('checkin');
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
          setMode('checkin');
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

  function finishCheckin() {
    const genericStepsComplete = checkinSteps.every((step) => step.completado);
    const lockoutPointsComplete = checkinPoints.every((point) => point.completado);

    if (!genericStepsComplete || !lockoutPointsComplete) {
      setError('Completa todos los pasos y bloqueos antes de finalizar el Check-in');
      return;
    }

    setEvent(null);
    setCheckinPoints([]);
    setCheckoutPoints([]);
    setCheckinSteps([]);
    setCheckoutSteps([]);
    setCheckoutServiceSteps([]);
    setBaseConditionConfirmed(false);
    setMode('checkin');
    setError('Check-in finalizado. El LOTO permanece abierto hasta realizar el Check-out.');
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

  async function completeCheckoutServiceStep(stepNumber) {
    try {
      const res = await fetch(`${API_URL}/eventos/${event.id}/checkout-step`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paso: stepNumber })
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data?.error || 'No se pudo completar el paso de Check-out');
        return;
      }

      setCheckoutServiceSteps(parseCheckoutSteps(data.checkoutPasos));
      setError('');
    } catch (err) {
      setError('No se pudo guardar el paso de Check-out');
    }
  }

  async function confirmBaseCondition() {
    try {
      const res = await fetch(`${API_URL}/eventos/${event.id}/confirmacion-base`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data?.error || 'No se pudo confirmar la condición base');
        return;
      }

      setBaseConditionConfirmed(true);
      setError('');
    } catch (err) {
      setError('No se pudo guardar la confirmación');
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
            className={['admin', 'catalog', 'machines', 'active-events', 'history'].includes(mode) ? 'mode-button active' : 'mode-button'}
            onClick={() => { setMode(adminUnlocked ? 'catalog' : 'admin'); setEvent(null); setError(''); setMachinesMessage(''); }}
          >
            Administración
          </button>
        </div>

        {mode === 'admin' && !adminUnlocked && (
          <section className="admin-access">
            <h2>Administración de máquinas</h2>
            <label>
              Contraseña
              <input
                type="password"
                value={adminPassword}
                onChange={(e) => setAdminPassword(e.target.value)}
                autoComplete="current-password"
              />
            </label>
            <button type="button" className="primary" onClick={unlockAdministration}>Acceder</button>
            {machinesMessage && <p className="error">{machinesMessage}</p>}
          </section>
        )}

        {adminUnlocked && ['catalog', 'machines', 'active-events', 'history'].includes(mode) && (
          <div className="admin-navigation">
            <button type="button" className={mode === 'catalog' ? 'secondary active-admin' : 'secondary'} onClick={() => { setEditingMachineId(null); setCatalogMachine({ nombre: '', linea: '', qrCode: '' }); setCatalogPoints([{ identificador: '', nombre: '', tipoEnergia: 'OTRA', ubicacion: '', metodoAccion: '', dispositivoBloqueo: '', validacion: '' }]); setCatalogImages([{ url: '', etiqueta: 'Paso 5', orden: 1 }]); setCatalogMessage(''); setMode('catalog'); }}>Registrar máquina</button>
            <button type="button" className={mode === 'machines' ? 'secondary active-admin' : 'secondary'} onClick={() => { setMode('machines'); loadMachines(); }}>Ver máquinas</button>
            <button type="button" className={mode === 'active-events' ? 'secondary active-admin' : 'secondary'} onClick={() => { setMode('active-events'); loadActiveEvents(); }}>Eventos activos</button>
            <button type="button" className={mode === 'history' ? 'secondary active-admin' : 'secondary'} onClick={() => { setMode('history'); loadEventHistory(); }}>Historial</button>
            <button type="button" className="secondary" onClick={() => { setAdminUnlocked(false); setAdminPassword(''); setMode('admin'); setMachines([]); setSelectedMachine(null); setActiveMonitorEvents([]); }}>Salir</button>
          </div>
        )}

        {mode === 'machines' && (
          <section className="machine-management">
            <div className="machine-management-heading">
              <h2>Máquinas registradas</h2>
              <button type="button" className="secondary" onClick={loadMachines}>Actualizar</button>
            </div>
            {machines.length > 0 && (
              <div className="machine-list" role="list">
                {machines.map((machine) => (
                  <button
                    key={machine.id}
                    type="button"
                    className={selectedMachine?.id === machine.id ? 'machine-list-item active' : 'machine-list-item'}
                    onClick={() => setSelectedMachine(machine)}
                  >
                    <strong>{machine.nombre}</strong>
                    <span>{machine.linea?.nombre || 'Sin línea'} · {machine.qrCode}</span>
                  </button>
                ))}
              </div>
            )}

            {selectedMachine && (
              <div className="machine-detail">
                <div className="machine-management-heading">
                  <div>
                    <h3>{selectedMachine.nombre}</h3>
                    <p>Línea {selectedMachine.linea?.nombre || 'Sin línea'} · QR: {selectedMachine.qrCode}</p>
                  </div>
                  <button type="button" className="danger" onClick={() => deleteMachine(selectedMachine)}>
                    Eliminar
                  </button>
                  <button type="button" className="secondary" onClick={() => editMachine(selectedMachine)}>
                    Editar
                  </button>
                </div>
                <div className="lock-table" role="table" aria-label={`Bloqueos de ${selectedMachine.nombre}`}>
                  <div className="lock-table-header" role="row">
                    <span aria-hidden="true" />
                    <span>ID</span>
                    <span>Fuente</span>
                    <span>Ubicación</span>
                    <span>Método / acción</span>
                    <span>Dispositivo de bloqueo</span>
                    <span>Validación</span>
                  </div>
                  {selectedMachine.puntos.map((point, index) => (
                    <div key={point.id} className="lock-table-row" role="row">
                      <span><img className="energy-icon" src={energyImage(point.tipoEnergia)} alt="" /></span>
                      <span>{point.identificador || `P${index + 1}`}</span>
                      <span>{point.nombre} ({point.tipoEnergia})</span>
                      <span>{point.ubicacion || 'Sin registrar'}</span>
                      <span>{point.metodoAccion || 'Sin registrar'}</span>
                      <span>{point.dispositivoBloqueo || 'Sin registrar'}</span>
                      <span>{point.validacion || 'Sin registrar'}</span>
                    </div>
                  ))}
                </div>

                {selectedMachine.imagenes.length > 0 && (
                  <div className="step-images">
                    {selectedMachine.imagenes.map((image) => (
                      <figure key={image.id}>
                        <img src={image.url} alt={image.etiqueta || 'Imagen del paso 5'} />
                        {image.etiqueta && <figcaption>{image.etiqueta}</figcaption>}
                      </figure>
                    ))}
                  </div>
                )}
              </div>
            )}
            {machinesMessage && <p className="status-message">{machinesMessage}</p>}
          </section>
        )}

        {mode === 'active-events' && (
          <section className="machine-management">
            <div className="machine-management-heading">
              <h2>Eventos LOTO activos</h2>
              <button type="button" className="secondary" onClick={loadActiveEvents}>Actualizar</button>
            </div>
            {activeMonitorEvents.length > 0 && (
              <div className="active-event-list">
                {activeMonitorEvents.map((activeEvent) => (
                  <article key={activeEvent.id} className="active-event-row">
                    <div><span>Empleado</span><strong>{activeEvent.operador?.numeroEmpleado}</strong></div>
                    <div><span>Máquina</span><strong>{activeEvent.maquina?.nombre}</strong><small>{activeEvent.maquina?.linea?.nombre || 'Sin línea'}</small></div>
                    <div><span>Tiempo en LOTO</span><strong>{formatElapsed(activeEvent.horaInicio)}</strong></div>
                    <button type="button" className="danger admin-close-button" onClick={() => adminCloseEvent(activeEvent)}>Cerrar evento</button>
                  </article>
                ))}
              </div>
            )}
            {monitorMessage && <p className="status-message">{monitorMessage}</p>}
          </section>
        )}

        {mode === 'history' && (
          <section className="machine-management">
            <div className="machine-management-heading">
              <h2>Historial LOTO</h2>
              <button type="button" className="secondary" onClick={loadEventHistory}>Actualizar</button>
            </div>
            {eventHistory.length > 0 && (
              <div className="active-event-list">
                {eventHistory.map((historyEvent) => (
                  <article key={historyEvent.id} className="active-event-row">
                    <div><span>Estado</span><strong>{historyEvent.estado}</strong></div>
                    <div><span>Empleado</span><strong>{historyEvent.operador?.numeroEmpleado}</strong></div>
                    <div><span>Máquina</span><strong>{historyEvent.maquina?.nombre}</strong><small>{historyEvent.maquina?.linea?.nombre || 'Sin línea'}</small></div>
                    <div><span>Inicio</span><strong>{new Date(historyEvent.horaInicio).toLocaleString('es-MX')}</strong></div>
                    <div><span>Duración</span><strong>{historyEvent.duracionMinutos == null ? 'En curso' : `${historyEvent.duracionMinutos} min`}</strong></div>
                  </article>
                ))}
              </div>
            )}
            {historyMessage && <p className="status-message">{historyMessage}</p>}
          </section>
        )}

        {mode === 'catalog' && (
          <section className="resume-section">
            <div className="machine-management-heading">
              <h2>{editingMachineId ? 'Editar máquina' : 'Registrar máquina'}</h2>
              {editingMachineId && <button type="button" className="secondary" onClick={() => { setEditingMachineId(null); setCatalogMachine({ nombre: '', linea: '', qrCode: '' }); setCatalogPoints([{ identificador: '', nombre: '', tipoEnergia: 'OTRA', ubicacion: '', metodoAccion: '', dispositivoBloqueo: '', validacion: '' }]); setCatalogImages([{ url: '', etiqueta: 'Paso 5', orden: 1 }]); setCatalogMessage(''); }}>Nueva</button>}
            </div>
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
              <input value={catalogMachine.qrCode} onChange={(e) => setCatalogMachine({ ...catalogMachine, qrCode: e.target.value })} placeholder="Ej. A8-M01" readOnly={Boolean(editingMachineId)} />
            </label>

            <label>Puntos de bloqueo</label>
            <div className="lock-table catalog-lock-table" role="table" aria-label="Fuentes de energía de la máquina">
              <div className="lock-table-header" role="row">
                <span>ID</span>
                <span>Fuente</span>
                <span>Ubicación</span>
                <span>Método / acción</span>
                <span>Dispositivo de bloqueo</span>
                <span>Validación</span>
              </div>
            {catalogPoints.map((point, index) => (
              <div key={index} className="lock-point-row lock-table-row" role="row">
                <input
                  value={point.identificador}
                  onChange={(e) => updateCatalogPoint(index, 'identificador', e.target.value)}
                  placeholder={`E${index + 1}`}
                  aria-label={`ID del punto ${index + 1}`}
                />

                <div className="energy-picker">
                  <img className="energy-picker-icon" src={energyImage(point.tipoEnergia)} alt="" />
                  <input
                    value={point.nombre}
                    onChange={(e) => updateCatalogPoint(index, 'nombre', e.target.value)}
                    placeholder="Ej. Eléctrica 440 V"
                    aria-label={`Fuente del punto ${index + 1}`}
                  />
                  <select
                    value={point.tipoEnergia}
                    onChange={(e) => updateCatalogPoint(index, 'tipoEnergia', e.target.value)}
                    aria-label={`Tipo de energía del punto ${index + 1}`}
                  >
                    <option value="ELECTRICA">Eléctrica</option>
                    <option value="NEUMATICA">Neumática</option>
                    <option value="HIDRAULICA">Hidráulica</option>
                    <option value="MECANICA">Mecánica</option>
                    <option value="GRAVEDAD">Gravedad</option>
                    <option value="OTRA">Otra</option>
                  </select>
                </div>

                <input value={point.ubicacion} onChange={(e) => updateCatalogPoint(index, 'ubicacion', e.target.value)} placeholder="Ej. Parte trasera lado izquierdo" aria-label={`Ubicación del punto ${index + 1}`} />
                <input value={point.metodoAccion} onChange={(e) => updateCatalogPoint(index, 'metodoAccion', e.target.value)} placeholder="Ej. Abrir interruptor" aria-label={`Método o acción del punto ${index + 1}`} />
                <input value={point.dispositivoBloqueo} onChange={(e) => updateCatalogPoint(index, 'dispositivoBloqueo', e.target.value)} placeholder="Ej. Candado y etiqueta" aria-label={`Dispositivo de bloqueo del punto ${index + 1}`} />
                <input value={point.validacion} onChange={(e) => updateCatalogPoint(index, 'validacion', e.target.value)} placeholder="Ej. Sin tensión" aria-label={`Validación del punto ${index + 1}`} />

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
                  {
                    identificador: '',
                    nombre: '',
                    tipoEnergia: 'OTRA',
                    ubicacion: '',
                    metodoAccion: '',
                    dispositivoBloqueo: '',
                    validacion: ''
                  }
                ])
              }
            >
              + Agregar punto de bloqueo
            </button>
            </div>

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
              {CHECKIN_STEP_ORDER.filter((order) => order <= 5).map((order, index) => {
                const step = getCheckinStep(order);
                const definition = checkinDefinition(order);
                const previousStep = index > 0 ? getCheckinStep(CHECKIN_STEP_ORDER[index - 1]) : null;

                return <li key={`checkin-step-${order}`} className="step-row">
                  <input
                    type="checkbox"
                    checked={Boolean(step?.completado)}
                    disabled={!step || step.completado || (index > 0 && !previousStep?.completado)}
                    onChange={() => completeCheckinStep(step)}
                  />
                  <div className="step-text">
                    <strong>{step?.pasoGenerico?.titulo || `Paso ${order}`}</strong>
                    <p>{step?.pasoGenerico?.descripcion || definition?.descripcion}</p>
                    {order === 5 && machineInfo?.imagenes?.length > 0 && (
                      <div className="step-images">
                        {machineInfo.imagenes.map((image, imageIndex) => (
                          <figure key={`${step?.pasoGenericoId || order}-${image.id || imageIndex}`}>
                            <img src={image.url} alt={image.etiqueta || `Imagen ${imageIndex + 1}`} />
                            {image.etiqueta && <figcaption>{image.etiqueta}</figcaption>}
                          </figure>
                        ))}
                      </div>
                    )}
                  </div>
                </li>
              })}
            </ul>

            <div className="step-section-title">Paso 6: Bloquee las fuentes de energía</div>
            <div className="lock-table" role="table" aria-label="Puntos de bloqueo">
              <div className="lock-table-header" role="row">
                <span aria-hidden="true" />
                <span>ID</span>
                <span>Fuente</span>
                <span>Ubicación</span>
                <span>Método / acción</span>
                <span>Dispositivo de bloqueo</span>
                <span>Validación</span>
              </div>
              {checkinPoints.map((point, index) => (
                <div key={point.puntoBloqueoId} className="point-row lock-table-row" role="row">
                  <input
                    type="checkbox"
                    checked={point.completado}
                    disabled={point.completado || !hasCompleteCheckinSteps || !checkinSteps.filter((step) => step.pasoGenerico?.orden <= 5).every((step) => step.completado) || (index > 0 && !checkinPoints[index - 1].completado)}
                    onChange={() => completeCheckinPoint(point, index)}
                  />
                  <span>{point.puntoBloqueo?.identificador || `P${index + 1}`}</span>
                  <span><img className="energy-icon" src={energyImage(point.puntoBloqueo?.tipoEnergia)} alt="" />{point.puntoBloqueo?.nombre} ({point.puntoBloqueo?.tipoEnergia || 'OTRA'})</span>
                  <span>{point.puntoBloqueo?.ubicacion || 'Sin registrar'}</span>
                  <span>{point.puntoBloqueo?.metodoAccion || 'Sin registrar'}</span>
                  <span>{point.puntoBloqueo?.dispositivoBloqueo || 'Sin registrar'}</span>
                  <span>{point.puntoBloqueo?.validacion || 'Confirmar bloqueo'}</span>
                </div>
              ))}
            </div>

            <ul className="step-list">
              {CHECKIN_STEP_ORDER.filter((order) => order >= 7).map((order, index) => {
                const step = getCheckinStep(order);
                const definition = checkinDefinition(order);
                const previousOrder = [5, 7, 8][index - 1];
                const previousStep = index > 0 ? getCheckinStep(previousOrder) : null;

                return <li key={`checkin-step-${order}`} className="step-row">
                  <input
                    type="checkbox"
                    checked={Boolean(step?.completado)}
                    disabled={!step || step.completado || (index > 0 && !previousStep?.completado) || !checkinPoints.every((point) => point.completado)}
                    onChange={() => completeCheckinStep(step)}
                  />
                  <div className="step-text">
                    <strong>{step?.pasoGenerico?.titulo || `Paso ${order}`}</strong>
                    <p>{step?.pasoGenerico?.descripcion || definition?.descripcion}</p>
                  </div>
                </li>
              })}
            </ul>

            <button className="primary" onClick={finishCheckin} disabled={!hasCompleteCheckinSteps || !checkinSteps.every((step) => step.completado) || !checkinPoints.every((point) => point.completado)}>
              Finalizar Check-in
            </button>
          </section>
        )}

        {event && mode === 'checkout' && (
          <section className="checklist">
            <p className="checkout-heading">Regresar máquina o equipo a servicio / condiciones normales de operación</p>
            <h2>Checklist de Check-out</h2>

            <ul className="step-list">
              {CHECKOUT_STEPS.map((description, index) => {
                const stepNumber = index + 1;
                const isLockoutRemoval = stepNumber === 6;
                const previousComplete = stepNumber === 1 || checkoutServiceSteps.includes(stepNumber - 1);
                const lockoutsComplete = checkoutPoints.every((point) => point.completado);

                return (
                  <li key={`checkout-service-${stepNumber}`} className="step-row checkout-step-row">
                    <input
                      type="checkbox"
                      checked={checkoutServiceSteps.includes(stepNumber)}
                      disabled={checkoutServiceSteps.includes(stepNumber) || !previousComplete || (isLockoutRemoval && !lockoutsComplete) || (stepNumber === 7 && !lockoutsComplete)}
                      onChange={() => completeCheckoutServiceStep(stepNumber)}
                    />
                    <div className="step-text">
                      <strong>Paso {stepNumber}</strong>
                      <p>{description}</p>
                      {isLockoutRemoval && (
                        <div className="checkout-lockout-list">
                          {checkoutPoints.map((point, pointIndex) => (
                            <label key={`checkout-${point.puntoBloqueoId}`} className="checkout-lockout-row">
                              <input
                                type="checkbox"
                                checked={point.completado}
                                disabled={point.completado || !previousComplete || (pointIndex > 0 && !checkoutPoints[pointIndex - 1].completado)}
                                onChange={() => completeCheckoutPoint(point, pointIndex)}
                              />
                              <img className="energy-icon" src={energyImage(point.puntoBloqueo?.tipoEnergia)} alt="" />
                              <span>{point.puntoBloqueo?.nombre} ({point.puntoBloqueo?.tipoEnergia || 'OTRA'})</span>
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>

            <label className="base-condition-confirmation">
              <input
                type="checkbox"
                checked={baseConditionConfirmed}
                disabled={baseConditionConfirmed || !checkoutServiceSteps.includes(7)}
                onChange={confirmBaseCondition}
              />
              <span>Al marcar esto estás de acuerdo que dejaste todo en condición base.</span>
            </label>

            <p className={baseConditionConfirmed && checkoutServiceSteps.includes(7) && checkoutPoints.every((point) => point.completado) ? 'checkout-ready' : 'checkout-pending'}>
              {checkoutPendingMessage()}
            </p>

            <button className="danger" disabled={!checkoutPoints.every((point) => point.completado) || !checkoutServiceSteps.includes(7) || !baseConditionConfirmed} onClick={closeEvent}>
              Cerrar LOTO
            </button>
          </section>
        )}

        {error && <p className="error">{error}</p>}
      </main>
    </div>
  );
}
