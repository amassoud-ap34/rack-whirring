const GRID_UNIT = 25;
const PIN_STEM = 10;
const PIN_RADIUS = 4;

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');

const toolButtons = Array.from(document.querySelectorAll('.tool'));
const strokeColorInput = document.getElementById('strokeColor');
const wireColorInput = document.getElementById('wireColor');
const wireTypeInput = document.getElementById('wireType');
const fillColorInput = document.getElementById('fillColor');
const lineWidthInput = document.getElementById('lineWidth');
const lineWidthValue = document.getElementById('lineWidthValue');
const saveJsonBtn = document.getElementById('saveJsonBtn');
const loadJsonInput = document.getElementById('loadJsonInput');
const exportPngBtn = document.getElementById('exportPngBtn');
const newBtn = document.getElementById('newBtn');
const selectedWidthUInput = document.getElementById('selectedWidthU');
const selectedHeightUInput = document.getElementById('selectedHeightU');
const selectedRotationInput = document.getElementById('selectedRotation');
const applyTransformBtn = document.getElementById('applyTransformBtn');
const deleteSelectedBtn = document.getElementById('deleteSelectedBtn');

let activeTool = 'select';
let elements = [];
let connections = [];
let pointerDown = false;
let draftShape = null;
let selected = null;
let dragOffsetX = 0;
let dragOffsetY = 0;
let wireStartPin = null;
let hoveredPin = null;

const symbolPresets = {
  psw: { widthU: 12, heightU: 2 },
  mainFilter: { widthU: 5, heightU: 5 },
  whir: { widthU: 1, heightU: 2 },
  circuitBreaker: { widthU: 2, heightU: 3 },
  gnd: { widthU: 1.6, heightU: 1.8 },
};

function uid() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function toPixels(units) {
  return units * GRID_UNIT;
}

function toUnits(px) {
  return Math.max(0.1, Number((px / GRID_UNIT).toFixed(2)));
}

function getPos(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
}

function drawGrid() {
  ctx.save();
  ctx.strokeStyle = '#edf1f5';
  ctx.lineWidth = 1;
  for (let x = 0; x < canvas.width; x += GRID_UNIT) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvas.height);
    ctx.stroke();
  }
  for (let y = 0; y < canvas.height; y += GRID_UNIT) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
    ctx.stroke();
  }
  ctx.restore();
}

function elementCenter(element) {
  return {
    x: element.x + element.width / 2,
    y: element.y + element.height / 2,
  };
}

function withElementTransform(element, fn) {
  const center = elementCenter(element);
  ctx.save();
  ctx.translate(center.x, center.y);
  ctx.rotate((element.rotation || 0) * (Math.PI / 180));
  fn();
  ctx.restore();
}

function localToWorld(element, localX, localY) {
  const center = elementCenter(element);
  const dx = localX - element.width / 2;
  const dy = localY - element.height / 2;
  const angle = (element.rotation || 0) * (Math.PI / 180);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: center.x + dx * cos - dy * sin,
    y: center.y + dx * sin + dy * cos,
  };
}

function worldToLocal(element, x, y) {
  const center = elementCenter(element);
  const dx = x - center.x;
  const dy = y - center.y;
  const angle = -((element.rotation || 0) * (Math.PI / 180));
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: dx * cos - dy * sin + element.width / 2,
    y: dx * sin + dy * cos + element.height / 2,
  };
}

function rotateVector(vx, vy, deg) {
  const angle = deg * (Math.PI / 180);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: vx * cos - vy * sin,
    y: vx * sin + vy * cos,
  };
}

function basePins(element) {
  const pins = [];

  if (element.kind === 'psw') {
    pins.push({ id: 'ac230', label: 'AC 230V', x: 0, y: 0, side: 'top' });
    pins.push({ id: 'eth', label: 'ETHERNET', x: element.width, y: 0, side: 'top' });
    for (let i = 1; i <= 12; i += 1) {
      const ratio = i / 13;
      pins.push({
        id: `p${i}`,
        label: `P${i}`,
        x: Math.round(element.width * ratio),
        y: element.height,
        side: 'bottom',
      });
    }
  }

  if (element.kind === 'mainFilter') {
    pins.push({ id: 'l', label: 'L', x: 0, y: element.height * 0.2, side: 'left' });
    pins.push({ id: 'n', label: 'N', x: 0, y: element.height * 0.5, side: 'left' });
    pins.push({ id: 'pe', label: 'PE', x: 0, y: element.height * 0.8, side: 'left' });
    pins.push({ id: 'out', label: 'OUT', x: element.width, y: element.height * 0.35, side: 'right' });
    pins.push({ id: 'gnd', label: 'GND', x: element.width, y: element.height * 0.7, side: 'right' });
  }

  if (element.kind === 'whir') {
    pins.push({ id: 'top', label: '', x: element.width / 2, y: 0, side: 'top' });
    pins.push({ id: 'bottom', label: '', x: element.width / 2, y: element.height, side: 'bottom' });
  }

  if (element.kind === 'circuitBreaker') {
    pins.push({ id: 'top', label: '', x: element.width / 2, y: 0, side: 'top' });
    pins.push({ id: 'bottom', label: '', x: element.width / 2, y: element.height, side: 'bottom' });
  }

  if (element.kind === 'gnd') {
    pins.push({ id: 'top', label: 'GND', x: element.width / 2, y: 0, side: 'top' });
  }

  return pins;
}

function sideVector(side) {
  if (side === 'top') return { x: 0, y: -1 };
  if (side === 'bottom') return { x: 0, y: 1 };
  if (side === 'left') return { x: -1, y: 0 };
  return { x: 1, y: 0 };
}

function getSymbolPins(element) {
  if (element.type !== 'symbol') {
    return [];
  }

  return basePins(element).map((pin) => {
    const base = localToWorld(element, pin.x, pin.y);
    const localDir = sideVector(pin.side);
    const worldDir = rotateVector(localDir.x, localDir.y, element.rotation || 0);
    const tip = {
      x: base.x + worldDir.x * PIN_STEM,
      y: base.y + worldDir.y * PIN_STEM,
    };

    return {
      ...pin,
      elementId: element.id,
      base,
      tip,
      direction: worldDir,
    };
  });
}

function drawPin(pin) {
  ctx.save();
  ctx.strokeStyle = '#111111';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(pin.base.x, pin.base.y);
  ctx.lineTo(pin.tip.x, pin.tip.y);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(pin.tip.x, pin.tip.y, PIN_RADIUS, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.strokeStyle = '#111111';
  ctx.stroke();
  ctx.restore();
}

function drawPinLabel(pin) {
  if (!pin.label) {
    return;
  }

  const alignRight = pin.direction.x < -0.4;
  const up = pin.direction.y < -0.4;
  const down = pin.direction.y > 0.4;

  ctx.save();
  ctx.font = '11px Arial';
  const label = pin.label;
  const textWidth = ctx.measureText(label).width;
  const padX = 4;
  const padY = 2;

  let labelX = pin.tip.x + (alignRight ? -textWidth - 12 : 10);
  let labelY = pin.tip.y + 4;

  if (up) {
    labelY = pin.tip.y - 10;
  }
  if (down) {
    labelY = pin.tip.y + 14;
  }

  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.strokeStyle = '#d0d7de';
  ctx.lineWidth = 1;
  ctx.fillRect(labelX - padX, labelY - 10 - padY, textWidth + padX * 2, 14 + padY * 2);
  ctx.strokeRect(labelX - padX, labelY - 10 - padY, textWidth + padX * 2, 14 + padY * 2);

  ctx.fillStyle = '#111111';
  ctx.fillText(label, labelX, labelY);
  ctx.restore();
}

function drawRectElement(element) {
  withElementTransform(element, () => {
    if (element.fill !== '#ffffff') {
      ctx.fillStyle = element.fill;
      ctx.fillRect(-element.width / 2, -element.height / 2, element.width, element.height);
    }
    ctx.strokeStyle = element.stroke;
    ctx.lineWidth = element.lineWidth;
    ctx.strokeRect(-element.width / 2, -element.height / 2, element.width, element.height);
  });
}

function drawTextElement(element) {
  withElementTransform(element, () => {
    ctx.fillStyle = element.stroke;
    ctx.font = `${Math.max(12, element.lineWidth * 6)}px Arial`;
    ctx.fillText(element.text, -element.width / 2, 0);
  });
}

function drawSymbol(element) {
  withElementTransform(element, () => {
    if (element.fill !== '#ffffff') {
      ctx.fillStyle = element.fill;
      ctx.fillRect(-element.width / 2, -element.height / 2, element.width, element.height);
    }

    ctx.strokeStyle = element.stroke;
    ctx.lineWidth = element.lineWidth;
    ctx.strokeRect(-element.width / 2, -element.height / 2, element.width, element.height);

    ctx.fillStyle = element.stroke;
    ctx.font = '12px Arial';

    if (element.kind === 'psw') {
      ctx.fillText('PSW', -element.width / 2 + 8, -element.height / 2 + 16);
    }

    if (element.kind === 'mainFilter') {
      ctx.fillText('Main Filter', -element.width / 2 + 8, -element.height / 2 + 16);
    }

    if (element.kind === 'whir') {
      ctx.lineWidth = Math.max(1.2, element.lineWidth);
      ctx.beginPath();
      ctx.moveTo(0, -element.height / 2 + 8);
      ctx.lineTo(0, element.height / 2 - 8);
      ctx.stroke();
    }

    if (element.kind === 'circuitBreaker') {
      ctx.lineWidth = Math.max(1.2, element.lineWidth);
      ctx.beginPath();
      ctx.moveTo(0, -element.height / 2 + 8);
      ctx.lineTo(-3, -2);
      ctx.moveTo(3, 2);
      ctx.lineTo(0, element.height / 2 - 8);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(-6, 0);
      ctx.lineTo(6, 0);
      ctx.stroke();
    }

    if (element.kind === 'gnd') {
      const topY = -element.height / 2 + 8;
      const midY = topY + 8;
      ctx.lineWidth = Math.max(1.2, element.lineWidth);
      ctx.beginPath();
      ctx.moveTo(0, topY);
      ctx.lineTo(0, midY);
      ctx.moveTo(-8, midY);
      ctx.lineTo(8, midY);
      ctx.moveTo(-5, midY + 4);
      ctx.lineTo(5, midY + 4);
      ctx.moveTo(-2.5, midY + 8);
      ctx.lineTo(2.5, midY + 8);
      ctx.stroke();
    }
  });

  getSymbolPins(element).forEach((pin) => drawPin(pin));
}

function getPinPoint(connectionEnd) {
  const element = elements.find((item) => item.id === connectionEnd.elementId);
  if (!element || element.type !== 'symbol') {
    return null;
  }
  const pin = getSymbolPins(element).find((item) => item.id === connectionEnd.pinId);
  return pin || null;
}

function orthogonalPath(fromPoint, toPoint, routeStyle = 'auto') {
  const from = { x: fromPoint.x, y: fromPoint.y };
  const to = { x: toPoint.x, y: toPoint.y };

  if (Math.abs(from.x - to.x) < 0.5 || Math.abs(from.y - to.y) < 0.5) {
    return [from, to];
  }

  let bend;
  if (routeStyle === 'horizontal-first') {
    bend = { x: to.x, y: from.y };
  } else if (routeStyle === 'vertical-first') {
    bend = { x: from.x, y: to.y };
  } else {
    bend = Math.abs(from.x - to.x) >= Math.abs(from.y - to.y)
      ? { x: to.x, y: from.y }
      : { x: from.x, y: to.y };
  }

  return [from, bend, to];
}

function connectionPathPoints(connection) {
  const fromPin = getPinPoint(connection.from);
  const toPin = getPinPoint(connection.to);
  if (!fromPin || !toPin) {
    return null;
  }
  return orthogonalPath(fromPin.tip, toPin.tip, connection.routeStyle || 'auto');
}

function distanceToSegment(point, a, b) {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const apx = point.x - a.x;
  const apy = point.y - a.y;
  const abLenSq = abx * abx + aby * aby;
  if (abLenSq === 0) {
    return Math.hypot(point.x - a.x, point.y - a.y);
  }
  const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / abLenSq));
  const closestX = a.x + t * abx;
  const closestY = a.y + t * aby;
  return Math.hypot(point.x - closestX, point.y - closestY);
}

function drawConnection(connection, isSelected) {
  const path = connectionPathPoints(connection);
  if (!path || path.length < 2) {
    return;
  }

  ctx.save();
  ctx.strokeStyle = connection.color;
  ctx.lineWidth = connection.lineWidth;
  if (connection.typeStyle === 'dashed') {
    ctx.setLineDash([10, 6]);
  }

  ctx.beginPath();
  ctx.moveTo(path[0].x, path[0].y);
  for (let i = 1; i < path.length; i += 1) {
    ctx.lineTo(path[i].x, path[i].y);
  }
  ctx.stroke();

  if (isSelected) {
    const xs = path.map((p) => p.x);
    const ys = path.map((p) => p.y);
    ctx.setLineDash([5, 3]);
    ctx.strokeStyle = '#2563eb';
    ctx.strokeRect(Math.min(...xs) - 8, Math.min(...ys) - 8, Math.max(...xs) - Math.min(...xs) + 16, Math.max(...ys) - Math.min(...ys) + 16);
  }

  ctx.restore();
}

function getElementBounds(element) {
  const corners = [
    localToWorld(element, 0, 0),
    localToWorld(element, element.width, 0),
    localToWorld(element, element.width, element.height),
    localToWorld(element, 0, element.height),
  ];
  const xs = corners.map((point) => point.x);
  const ys = corners.map((point) => point.y);
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    w: Math.max(...xs) - Math.min(...xs),
    h: Math.max(...ys) - Math.min(...ys),
  };
}

function drawElementSelection(element) {
  const bounds = getElementBounds(element);
  ctx.save();
  ctx.strokeStyle = '#2563eb';
  ctx.setLineDash([5, 3]);
  ctx.strokeRect(bounds.x - 6, bounds.y - 6, bounds.w + 12, bounds.h + 12);
  ctx.restore();
}

function pointInElement(element, x, y) {
  const local = worldToLocal(element, x, y);
  return local.x >= 0 && local.x <= element.width && local.y >= 0 && local.y <= element.height;
}

function pickElement(x, y) {
  for (let i = elements.length - 1; i >= 0; i -= 1) {
    if (pointInElement(elements[i], x, y)) {
      return elements[i];
    }
  }
  return null;
}

function pickConnection(x, y) {
  for (let i = connections.length - 1; i >= 0; i -= 1) {
    const path = connectionPathPoints(connections[i]);
    if (!path) {
      continue;
    }
    for (let j = 0; j < path.length - 1; j += 1) {
      if (distanceToSegment({ x, y }, path[j], path[j + 1]) <= 8) {
        return connections[i];
      }
    }
  }
  return null;
}

function findPinHit(x, y) {
  for (let i = elements.length - 1; i >= 0; i -= 1) {
    const element = elements[i];
    if (element.type !== 'symbol') {
      continue;
    }
    const pin = getSymbolPins(element).find((item) => Math.hypot(item.tip.x - x, item.tip.y - y) <= 8);
    if (pin) {
      return pin;
    }
  }
  return null;
}

function redraw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGrid();

  connections.forEach((connection) => {
    const isSelected = selected && selected.type === 'connection' && selected.id === connection.id;
    drawConnection(connection, isSelected);
  });

  elements.forEach((element) => {
    if (element.type === 'rect') drawRectElement(element);
    if (element.type === 'text') drawTextElement(element);
    if (element.type === 'symbol') drawSymbol(element);

    const isSelected = selected && selected.type === 'element' && selected.id === element.id;
    if (isSelected) {
      drawElementSelection(element);
    }
  });

  if (draftShape) {
    drawRectElement(draftShape);
  }

  if (wireStartPin) {
    drawPin(wireStartPin);
    drawPinLabel({ ...wireStartPin, label: `START ${wireStartPin.label || wireStartPin.id}` });
  }

  if (hoveredPin) {
    drawPinLabel(hoveredPin);
  }
}

function activateTool(tool) {
  activeTool = tool;
  wireStartPin = null;
  toolButtons.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tool === tool);
  });
  redraw();
}

function selectElement(element) {
  if (!element) {
    selected = null;
    selectedWidthUInput.value = '';
    selectedHeightUInput.value = '';
    selectedRotationInput.value = '';
    return;
  }
  selected = { type: 'element', id: element.id };
  selectedWidthUInput.value = toUnits(element.width);
  selectedHeightUInput.value = toUnits(element.height);
  selectedRotationInput.value = Math.round(element.rotation || 0);
}

function deleteSelected() {
  if (!selected) {
    return;
  }
  if (selected.type === 'element') {
    elements = elements.filter((item) => item.id !== selected.id);
    connections = connections.filter((item) => item.from.elementId !== selected.id && item.to.elementId !== selected.id);
  }
  if (selected.type === 'connection') {
    connections = connections.filter((item) => item.id !== selected.id);
  }
  selected = null;
  selectElement(null);
  redraw();
}

function placeSymbol(kind, x, y) {
  const preset = symbolPresets[kind];
  const element = {
    id: uid(),
    type: 'symbol',
    kind,
    x,
    y,
    width: toPixels(preset.widthU),
    height: toPixels(preset.heightU),
    rotation: 0,
    stroke: strokeColorInput.value,
    fill: fillColorInput.value,
    lineWidth: Number(lineWidthInput.value),
  };
  elements.push(element);
  selectElement(element);
}

function updateHoveredPin(pos) {
  const pin = findPinHit(pos.x, pos.y);
  hoveredPin = pin
    ? {
        ...pin,
        label: pin.label || pin.id,
      }
    : null;
}

toolButtons.forEach((btn) => {
  btn.addEventListener('click', () => activateTool(btn.dataset.tool));
});

lineWidthInput.addEventListener('input', () => {
  lineWidthValue.textContent = `${lineWidthInput.value} px`;
});

applyTransformBtn.addEventListener('click', () => {
  if (!selected || selected.type !== 'element') {
    return;
  }
  const element = elements.find((item) => item.id === selected.id);
  if (!element) {
    return;
  }

  const widthU = Math.max(0.1, Number(selectedWidthUInput.value || toUnits(element.width)));
  const heightU = Math.max(0.1, Number(selectedHeightUInput.value || toUnits(element.height)));
  const rotation = Number(selectedRotationInput.value || 0);

  const safeWidthU = Math.max(0.1, Number.isFinite(widthU) ? widthU : toUnits(element.width));
  const safeHeightU = Math.max(0.1, Number.isFinite(heightU) ? heightU : toUnits(element.height));

  element.width = toPixels(safeWidthU);
  element.height = toPixels(safeHeightU);
  element.rotation = rotation;
  redraw();
});

deleteSelectedBtn.addEventListener('click', deleteSelected);

canvas.addEventListener('pointerdown', (event) => {
  const pos = getPos(event);
  pointerDown = true;

  if (activeTool === 'text') {
    const text = window.prompt('Text label:');
    if (text && text.trim()) {
      const element = {
        id: uid(),
        type: 'text',
        text: text.trim(),
        x: pos.x,
        y: pos.y,
        width: Math.max(80, text.trim().length * 10),
        height: 24,
        rotation: 0,
        stroke: strokeColorInput.value,
        fill: fillColorInput.value,
        lineWidth: Number(lineWidthInput.value),
      };
      elements.push(element);
      selectElement(element);
    }
    pointerDown = false;
    redraw();
    return;
  }

  if (symbolPresets[activeTool]) {
    placeSymbol(activeTool, pos.x, pos.y);
    pointerDown = false;
    redraw();
    return;
  }

  if (activeTool === 'wire') {
    const hitPin = findPinHit(pos.x, pos.y);
    if (!hitPin) {
      pointerDown = false;
      return;
    }

    if (!wireStartPin) {
      wireStartPin = hitPin;
      selected = null;
      pointerDown = false;
      redraw();
      return;
    }

    if (wireStartPin.elementId === hitPin.elementId) {
      window.alert('A pin cannot be wired to another pin on the same device.');
      pointerDown = false;
      return;
    }

    connections.push({
      id: uid(),
      from: { elementId: wireStartPin.elementId, pinId: wireStartPin.id },
      to: { elementId: hitPin.elementId, pinId: hitPin.id },
      color: wireColorInput.value,
      lineWidth: Number(lineWidthInput.value),
      typeStyle: wireTypeInput.value,
      routeStyle: 'auto',
    });

    wireStartPin = null;
    pointerDown = false;
    redraw();
    return;
  }

  if (activeTool === 'select') {
    const pickedElement = pickElement(pos.x, pos.y);
    if (pickedElement) {
      selectElement(pickedElement);
      dragOffsetX = pos.x;
      dragOffsetY = pos.y;
      redraw();
      return;
    }

    const pickedConnection = pickConnection(pos.x, pos.y);
    if (pickedConnection) {
      selected = { type: 'connection', id: pickedConnection.id };
      selectedWidthUInput.value = '';
      selectedHeightUInput.value = '';
      selectedRotationInput.value = '';
      pointerDown = false;
      redraw();
      return;
    }

    selectElement(null);
    pointerDown = false;
    redraw();
    return;
  }

  if (activeTool === 'rect') {
    draftShape = {
      id: uid(),
      type: 'rect',
      x: pos.x,
      y: pos.y,
      width: 1,
      height: 1,
      rotation: 0,
      stroke: strokeColorInput.value,
      fill: fillColorInput.value,
      lineWidth: Number(lineWidthInput.value),
    };
    redraw();
  }
});

canvas.addEventListener('pointermove', (event) => {
  const pos = getPos(event);
  updateHoveredPin(pos);

  if (!pointerDown) {
    redraw();
    return;
  }

  if (activeTool === 'select' && selected && selected.type === 'element') {
    const element = elements.find((item) => item.id === selected.id);
    if (!element) {
      return;
    }
    const dx = pos.x - dragOffsetX;
    const dy = pos.y - dragOffsetY;
    element.x += dx;
    element.y += dy;
    dragOffsetX = pos.x;
    dragOffsetY = pos.y;
    redraw();
    return;
  }

  if (activeTool === 'rect' && draftShape) {
    draftShape.width = pos.x - draftShape.x;
    draftShape.height = pos.y - draftShape.y;
    redraw();
  }
});

canvas.addEventListener('pointerup', () => {
  pointerDown = false;

  if (draftShape) {
    if (Math.abs(draftShape.width) > 2 && Math.abs(draftShape.height) > 2) {
      if (draftShape.width < 0) {
        draftShape.x += draftShape.width;
        draftShape.width = Math.abs(draftShape.width);
      }
      if (draftShape.height < 0) {
        draftShape.y += draftShape.height;
        draftShape.height = Math.abs(draftShape.height);
      }
      elements.push(draftShape);
      selectElement(draftShape);
    }
    draftShape = null;
  }

  redraw();
});

canvas.addEventListener('pointerleave', () => {
  pointerDown = false;
  hoveredPin = null;
  redraw();
});

window.addEventListener('keydown', (event) => {
  if (event.key === 'Delete' || event.key === 'Backspace') {
    deleteSelected();
  }
});

newBtn.addEventListener('click', () => {
  if (!window.confirm('Clear current drawing?')) {
    return;
  }
  elements = [];
  connections = [];
  selected = null;
  wireStartPin = null;
  hoveredPin = null;
  selectElement(null);
  redraw();
});

saveJsonBtn.addEventListener('click', () => {
  const payload = {
    version: 4,
    canvas: { width: canvas.width, height: canvas.height, unit: GRID_UNIT },
    elements,
    connections,
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `rack-whirring-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
});

loadJsonInput.addEventListener('change', async (event) => {
  const [file] = event.target.files;
  if (!file) {
    return;
  }

  try {
    const text = await file.text();
    const parsed = JSON.parse(text);

    if (Array.isArray(parsed.elements)) {
      elements = parsed.elements;
      connections = Array.isArray(parsed.connections) ? parsed.connections : [];
    } else if (Array.isArray(parsed.shapes)) {
      elements = parsed.shapes.map((shape) => {
        if (shape.type === 'symbol') {
          const x = Math.min(shape.x1, shape.x2);
          const y = Math.min(shape.y1, shape.y2);
          return {
            id: shape.id,
            type: 'symbol',
            kind: shape.symbolKind || shape.kind || 'whir',
            x,
            y,
            width: Math.abs(shape.x2 - shape.x1),
            height: Math.abs(shape.y2 - shape.y1),
            rotation: shape.rotation || 0,
            stroke: shape.stroke || '#111111',
            fill: shape.fill || '#ffffff',
            lineWidth: shape.lineWidth || 2,
          };
        }
        return {
          id: shape.id,
          type: shape.type === 'line' ? 'rect' : shape.type,
          text: shape.text || '',
          x: Math.min(shape.x1 ?? 0, shape.x2 ?? shape.x1 ?? 0),
          y: Math.min(shape.y1 ?? 0, shape.y2 ?? shape.y1 ?? 0),
          width: Math.abs((shape.x2 ?? shape.x1 ?? 0) - (shape.x1 ?? 0)) || 80,
          height: Math.abs((shape.y2 ?? shape.y1 ?? 0) - (shape.y1 ?? 0)) || 24,
          rotation: 0,
          stroke: shape.stroke || '#111111',
          fill: shape.fill || '#ffffff',
          lineWidth: shape.lineWidth || 2,
        };
      });
      connections = [];
    } else {
      throw new Error('Invalid JSON format.');
    }

    selected = null;
    wireStartPin = null;
    hoveredPin = null;
    selectElement(null);
    redraw();
  } catch (error) {
    window.alert(`Could not load file: ${error.message}`);
  } finally {
    event.target.value = '';
  }
});

exportPngBtn.addEventListener('click', () => {
  redraw();
  const url = canvas.toDataURL('image/png');
  const link = document.createElement('a');
  link.href = url;
  link.download = `rack-whirring-${new Date().toISOString().slice(0, 10)}.png`;
  link.click();
});

redraw();
