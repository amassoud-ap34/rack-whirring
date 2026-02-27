const GRID_UNIT = 25;
const PIN_STEM = 10;
const PIN_RADIUS = 4;
const NODE_RADIUS = 4;
const MIN_U = 0.1;

const $ = (id) => document.getElementById(id);

const canvas = $('board');
const ctx = canvas.getContext('2d');

const ui = {
  tools: Array.from(document.querySelectorAll('.tool')),
  strokeColor: $('strokeColor'),
  wireColor: $('wireColor'),
  wireType: $('wireType'),
  fillColor: $('fillColor'),
  lineWidth: $('lineWidth'),
  lineWidthValue: $('lineWidthValue'),
  saveJson: $('saveJsonBtn'),
  loadJson: $('loadJsonInput'),
  exportPng: $('exportPngBtn'),
  newBtn: $('newBtn'),
  shareLink: $('shareLinkBtn'),
  selectedWidthU: $('selectedWidthU'),
  selectedHeightU: $('selectedHeightU'),
  selectedRotation: $('selectedRotation'),
  applyTransform: $('applyTransformBtn'),
  deleteSelected: $('deleteSelectedBtn'),
};

const symbolPresets = {
  psw: { widthU: 12, heightU: 2 },
  mainFilter: { widthU: 5, heightU: 5 },
  whir: { widthU: 1, heightU: 2 },
  circuitBreaker: { widthU: 2, heightU: 3 },
  gnd: { widthU: 1.6, heightU: 1.8 },
};

const state = {
  activeTool: 'select',
  elements: [],
  nodes: [],
  connections: [],
  pointerDown: false,
  draftShape: null,
  selected: null,
  dragOffsetX: 0,
  dragOffsetY: 0,
  wireDraft: null,
  hoveredPin: null,
};

const uid = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const toPixels = (units) => units * GRID_UNIT;
const toUnits = (px) => Math.max(MIN_U, Number((px / GRID_UNIT).toFixed(2)));
const clampU = (value) => Math.max(MIN_U, Number.isFinite(value) ? value : MIN_U);

function getPos(event) {
  const rect = canvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function buildPayload() {
  return {
    version: 5,
    canvas: { width: canvas.width, height: canvas.height, unit: GRID_UNIT },
    elements: state.elements,
    nodes: state.nodes,
    connections: state.connections,
  };
}

function encodeShareData(payload) {
  return btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
}

function decodeShareData(encoded) {
  return JSON.parse(decodeURIComponent(escape(atob(encoded))));
}

function normalizeOldShape(shape) {
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
}

function normalizeEndpoint(endpoint) {
  if (!endpoint) {
    return null;
  }
  if (endpoint.kind) {
    return endpoint;
  }
  if (endpoint.elementId && endpoint.pinId) {
    return { kind: 'pin', elementId: endpoint.elementId, pinId: endpoint.pinId };
  }
  return null;
}

function normalizeConnection(connection) {
  return {
    ...connection,
    from: normalizeEndpoint(connection.from),
    to: normalizeEndpoint(connection.to),
    bends: Array.isArray(connection.bends) ? connection.bends : [],
  };
}

function applyLoadedData(parsed) {
  if (Array.isArray(parsed.elements)) {
    state.elements = parsed.elements;
    state.nodes = Array.isArray(parsed.nodes) ? parsed.nodes : [];
    state.connections = Array.isArray(parsed.connections)
      ? parsed.connections.map(normalizeConnection)
      : [];
    return;
  }

  if (Array.isArray(parsed.shapes)) {
    state.elements = parsed.shapes.map(normalizeOldShape);
    state.nodes = [];
    state.connections = [];
    return;
  }

  throw new Error('Invalid JSON format.');
}

function resetTransientState() {
  state.selected = null;
  state.hoveredPin = null;
  state.wireDraft = null;
  state.draftShape = null;
  state.pointerDown = false;
  setSelectedUI(null);
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
  return { x: element.x + element.width / 2, y: element.y + element.height / 2 };
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
  return { x: center.x + dx * cos - dy * sin, y: center.y + dx * sin + dy * cos };
}

function worldToLocal(element, x, y) {
  const center = elementCenter(element);
  const dx = x - center.x;
  const dy = y - center.y;
  const angle = -((element.rotation || 0) * (Math.PI / 180));
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { x: dx * cos - dy * sin + element.width / 2, y: dx * sin + dy * cos + element.height / 2 };
}

function rotateVector(vx, vy, deg) {
  const angle = deg * (Math.PI / 180);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { x: vx * cos - vy * sin, y: vx * sin + vy * cos };
}

function sideVector(side) {
  if (side === 'top') return { x: 0, y: -1 };
  if (side === 'bottom') return { x: 0, y: 1 };
  if (side === 'left') return { x: -1, y: 0 };
  return { x: 1, y: 0 };
}

function basePins(element) {
  const pins = [];

  if (element.kind === 'psw') {
    pins.push({ id: 'ac230', label: 'AC 230V', x: 0, y: 0, side: 'top' });
    pins.push({ id: 'eth', label: 'ETHERNET', x: element.width, y: 0, side: 'top' });
    for (let i = 1; i <= 12; i += 1) {
      const ratio = i / 13;
      pins.push({ id: `p${i}`, label: `P${i}`, x: Math.round(element.width * ratio), y: element.height, side: 'bottom' });
    }
  }

  if (element.kind === 'mainFilter') {
    pins.push({ id: 'l', label: 'L', x: 0, y: element.height * 0.2, side: 'left' });
    pins.push({ id: 'n', label: 'N', x: 0, y: element.height * 0.5, side: 'left' });
    pins.push({ id: 'pe', label: 'PE', x: 0, y: element.height * 0.8, side: 'left' });
    pins.push({ id: 'out', label: 'OUT', x: element.width, y: element.height * 0.35, side: 'right' });
    pins.push({ id: 'gnd', label: 'GND', x: element.width, y: element.height * 0.7, side: 'right' });
  }

  if (element.kind === 'whir' || element.kind === 'circuitBreaker') {
    pins.push({ id: 'top', label: '', x: element.width / 2, y: 0, side: 'top' });
    pins.push({ id: 'bottom', label: '', x: element.width / 2, y: element.height, side: 'bottom' });
  }

  if (element.kind === 'gnd') {
    pins.push({ id: 'top', label: 'GND', x: element.width / 2, y: 0, side: 'top' });
  }

  return pins;
}

function getSymbolPins(element) {
  if (element.type !== 'symbol') {
    return [];
  }

  return basePins(element).map((pin) => {
    const base = localToWorld(element, pin.x, pin.y);
    const direction = rotateVector(sideVector(pin.side).x, sideVector(pin.side).y, element.rotation || 0);
    const tip = { x: base.x + direction.x * PIN_STEM, y: base.y + direction.y * PIN_STEM };
    return { ...pin, elementId: element.id, base, tip, direction };
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

function drawNode(node) {
  ctx.save();
  ctx.fillStyle = '#111111';
  ctx.beginPath();
  ctx.arc(node.x, node.y, NODE_RADIUS, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawPinLabel(pin) {
  if (!pin.label) return;

  const alignRight = pin.direction.x < -0.4;
  const up = pin.direction.y < -0.4;
  const down = pin.direction.y > 0.4;

  ctx.save();
  ctx.font = '11px Arial';
  const textWidth = ctx.measureText(pin.label).width;
  const padX = 4;
  const padY = 2;

  let labelX = pin.tip.x + (alignRight ? -textWidth - 12 : 10);
  let labelY = pin.tip.y + 4;
  if (up) labelY = pin.tip.y - 10;
  if (down) labelY = pin.tip.y + 14;

  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.strokeStyle = '#d0d7de';
  ctx.lineWidth = 1;
  ctx.fillRect(labelX - padX, labelY - 10 - padY, textWidth + padX * 2, 14 + padY * 2);
  ctx.strokeRect(labelX - padX, labelY - 10 - padY, textWidth + padX * 2, 14 + padY * 2);

  ctx.fillStyle = '#111111';
  ctx.fillText(pin.label, labelX, labelY);
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

function drawSymbolBody(element) {
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
}

function drawSymbol(element) {
  withElementTransform(element, () => drawSymbolBody(element));
  getSymbolPins(element).forEach(drawPin);
}

function getNodeById(nodeId) {
  return state.nodes.find((node) => node.id === nodeId) || null;
}

function getEndpointPoint(endpoint) {
  const normalized = normalizeEndpoint(endpoint);
  if (!normalized) {
    return null;
  }

  if (normalized.kind === 'node') {
    const node = getNodeById(normalized.nodeId);
    return node ? { x: node.x, y: node.y } : null;
  }

  const element = state.elements.find((item) => item.id === normalized.elementId);
  if (!element || element.type !== 'symbol') {
    return null;
  }

  const pin = getSymbolPins(element).find((item) => item.id === normalized.pinId);
  return pin ? { x: pin.tip.x, y: pin.tip.y } : null;
}

function orthogonalPath(fromPoint, toPoint, routeStyle = 'auto') {
  const from = { x: fromPoint.x, y: fromPoint.y };
  const to = { x: toPoint.x, y: toPoint.y };
  if (Math.abs(from.x - to.x) < 0.5 || Math.abs(from.y - to.y) < 0.5) return [from, to];

  let bend;
  if (routeStyle === 'horizontal-first') bend = { x: to.x, y: from.y };
  else if (routeStyle === 'vertical-first') bend = { x: from.x, y: to.y };
  else bend = Math.abs(from.x - to.x) >= Math.abs(from.y - to.y) ? { x: to.x, y: from.y } : { x: from.x, y: to.y };

  return [from, bend, to];
}

function ensureOrthogonalToTarget(lastPoint, targetPoint) {
  if (!lastPoint || !targetPoint) {
    return [];
  }
  if (Math.abs(lastPoint.x - targetPoint.x) < 0.5 || Math.abs(lastPoint.y - targetPoint.y) < 0.5) {
    return [];
  }
  return Math.abs(lastPoint.x - targetPoint.x) >= Math.abs(lastPoint.y - targetPoint.y)
    ? [{ x: targetPoint.x, y: lastPoint.y }]
    : [{ x: lastPoint.x, y: targetPoint.y }];
}

function compactPath(path) {
  if (!Array.isArray(path) || path.length === 0) {
    return [];
  }

  const compacted = [path[0]];
  for (let i = 1; i < path.length; i += 1) {
    const prev = compacted[compacted.length - 1];
    const current = path[i];
    if (Math.abs(prev.x - current.x) < 0.5 && Math.abs(prev.y - current.y) < 0.5) {
      continue;
    }
    compacted.push(current);
  }

  if (compacted.length <= 2) {
    return compacted;
  }

  const optimized = [compacted[0]];
  for (let i = 1; i < compacted.length - 1; i += 1) {
    const a = optimized[optimized.length - 1];
    const b = compacted[i];
    const c = compacted[i + 1];
    const sameVertical = Math.abs(a.x - b.x) < 0.5 && Math.abs(b.x - c.x) < 0.5;
    const sameHorizontal = Math.abs(a.y - b.y) < 0.5 && Math.abs(b.y - c.y) < 0.5;
    if (!(sameVertical || sameHorizontal)) {
      optimized.push(b);
    }
  }
  optimized.push(compacted[compacted.length - 1]);
  return optimized;
}

function connectionPathPoints(connection) {
  const from = getEndpointPoint(connection.from);
  const to = getEndpointPoint(connection.to);
  if (!from || !to) {
    return null;
  }

  const bends = Array.isArray(connection.bends) ? connection.bends : [];
  if (bends.length === 0) {
    return orthogonalPath(from, to, connection.routeStyle || 'auto');
  }

  const fullPath = compactPath([from, ...bends, ...ensureOrthogonalToTarget(bends[bends.length - 1], to), to]);
  return fullPath;
}

function distanceToSegment(point, a, b) {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const apx = point.x - a.x;
  const apy = point.y - a.y;
  const abLenSq = abx * abx + aby * aby;
  if (abLenSq === 0) return Math.hypot(point.x - a.x, point.y - a.y);
  const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / abLenSq));
  const closestX = a.x + t * abx;
  const closestY = a.y + t * aby;
  return Math.hypot(point.x - closestX, point.y - closestY);
}

function projectToSegment(point, a, b) {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const abLenSq = abx * abx + aby * aby;
  if (abLenSq === 0) {
    return { x: a.x, y: a.y, t: 0 };
  }
  const apx = point.x - a.x;
  const apy = point.y - a.y;
  const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / abLenSq));
  return { x: a.x + t * abx, y: a.y + t * aby, t };
}

function drawConnection(connection, isSelected) {
  const path = connectionPathPoints(connection);
  if (!path || path.length < 2) return;

  ctx.save();
  ctx.strokeStyle = connection.color;
  ctx.lineWidth = connection.lineWidth;
  if (connection.typeStyle === 'dashed') ctx.setLineDash([10, 6]);

  ctx.beginPath();
  ctx.moveTo(path[0].x, path[0].y);
  for (let i = 1; i < path.length; i += 1) ctx.lineTo(path[i].x, path[i].y);
  ctx.stroke();

  if (isSelected) {
    const xs = path.map((p) => p.x);
    const ys = path.map((p) => p.y);
    ctx.setLineDash([5, 3]);
    ctx.strokeStyle = '#2563eb';
    ctx.strokeRect(
      Math.min(...xs) - 8,
      Math.min(...ys) - 8,
      Math.max(...xs) - Math.min(...xs) + 16,
      Math.max(...ys) - Math.min(...ys) + 16,
    );
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
  const xs = corners.map((p) => p.x);
  const ys = corners.map((p) => p.y);
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    w: Math.max(...xs) - Math.min(...xs),
    h: Math.max(...ys) - Math.min(...ys),
  };
}

function drawElementSelection(element) {
  const b = getElementBounds(element);
  ctx.save();
  ctx.strokeStyle = '#2563eb';
  ctx.setLineDash([5, 3]);
  ctx.strokeRect(b.x - 6, b.y - 6, b.w + 12, b.h + 12);
  ctx.restore();
}

function pointInElement(element, x, y) {
  const local = worldToLocal(element, x, y);
  return local.x >= 0 && local.x <= element.width && local.y >= 0 && local.y <= element.height;
}

function pickElement(x, y) {
  for (let i = state.elements.length - 1; i >= 0; i -= 1) {
    if (pointInElement(state.elements[i], x, y)) return state.elements[i];
  }
  return null;
}

function pickConnection(x, y) {
  for (let i = state.connections.length - 1; i >= 0; i -= 1) {
    const path = connectionPathPoints(state.connections[i]);
    if (!path) continue;
    for (let j = 0; j < path.length - 1; j += 1) {
      if (distanceToSegment({ x, y }, path[j], path[j + 1]) <= 8) return state.connections[i];
    }
  }
  return null;
}

function findPinHit(x, y) {
  for (let i = state.elements.length - 1; i >= 0; i -= 1) {
    const element = state.elements[i];
    if (element.type !== 'symbol') continue;
    const pin = getSymbolPins(element).find((item) => Math.hypot(item.tip.x - x, item.tip.y - y) <= 8);
    if (pin) return pin;
  }
  return null;
}

function findNodeHit(x, y) {
  for (let i = state.nodes.length - 1; i >= 0; i -= 1) {
    const node = state.nodes[i];
    if (Math.hypot(node.x - x, node.y - y) <= 8) {
      return node;
    }
  }
  return null;
}

function findConnectionSegmentHit(x, y) {
  for (let i = state.connections.length - 1; i >= 0; i -= 1) {
    const connection = state.connections[i];
    const path = connectionPathPoints(connection);
    if (!path) continue;

    for (let segmentIndex = 0; segmentIndex < path.length - 1; segmentIndex += 1) {
      const a = path[segmentIndex];
      const b = path[segmentIndex + 1];
      const distance = distanceToSegment({ x, y }, a, b);
      if (distance <= 8) {
        const projected = projectToSegment({ x, y }, a, b);
        return { connection, segmentIndex, point: { x: projected.x, y: projected.y } };
      }
    }
  }
  return null;
}

function nearestExistingNode(point) {
  return state.nodes.find((node) => Math.hypot(node.x - point.x, node.y - point.y) <= 8) || null;
}

function getOrCreateNode(point) {
  const existing = nearestExistingNode(point);
  if (existing) {
    return existing;
  }
  const node = { id: uid(), x: point.x, y: point.y };
  state.nodes.push(node);
  return node;
}

function endpointEqual(a, b) {
  if (!a || !b || a.kind !== b.kind) {
    return false;
  }
  if (a.kind === 'node') {
    return a.nodeId === b.nodeId;
  }
  return a.elementId === b.elementId && a.pinId === b.pinId;
}

function endpointsOnSameElement(a, b) {
  return a && b && a.kind === 'pin' && b.kind === 'pin' && a.elementId === b.elementId;
}

function resolveWireEndpoint(pos) {
  const pin = findPinHit(pos.x, pos.y);
  if (pin) {
    return {
      endpoint: { kind: 'pin', elementId: pin.elementId, pinId: pin.id },
      point: { x: pin.tip.x, y: pin.tip.y },
    };
  }

  const node = findNodeHit(pos.x, pos.y);
  if (node) {
    return {
      endpoint: { kind: 'node', nodeId: node.id },
      point: { x: node.x, y: node.y },
    };
  }

  const segmentHit = findConnectionSegmentHit(pos.x, pos.y);
  if (segmentHit) {
    const createdNode = getOrCreateNode(segmentHit.point);
    return {
      endpoint: { kind: 'node', nodeId: createdNode.id },
      point: { x: createdNode.x, y: createdNode.y },
    };
  }

  return null;
}

function redraw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGrid();

  state.connections.forEach((connection) => {
    const isSelected =
      state.selected && state.selected.type === 'connection' && state.selected.id === connection.id;
    drawConnection(connection, isSelected);
  });

  state.nodes.forEach(drawNode);

  state.elements.forEach((element) => {
    if (element.type === 'rect') drawRectElement(element);
    if (element.type === 'text') drawTextElement(element);
    if (element.type === 'symbol') drawSymbol(element);

    const selectedElement =
      state.selected && state.selected.type === 'element' && state.selected.id === element.id;
    if (selectedElement) drawElementSelection(element);
  });

  if (state.draftShape) drawRectElement(state.draftShape);

  if (state.wireDraft) {
    const previewPath = compactPath([
      state.wireDraft.startPoint,
      ...state.wireDraft.bends,
      ...ensureOrthogonalToTarget(
        state.wireDraft.bends[state.wireDraft.bends.length - 1] || state.wireDraft.startPoint,
        state.wireDraft.cursor,
      ),
      state.wireDraft.cursor,
    ]);

    ctx.save();
    ctx.strokeStyle = ui.wireColor.value;
    ctx.lineWidth = Number(ui.lineWidth.value);
    if (ui.wireType.value === 'dashed') {
      ctx.setLineDash([10, 6]);
    }
    ctx.beginPath();
    ctx.moveTo(previewPath[0].x, previewPath[0].y);
    for (let i = 1; i < previewPath.length; i += 1) {
      ctx.lineTo(previewPath[i].x, previewPath[i].y);
    }
    ctx.stroke();
    ctx.restore();

    drawPinLabel({
      label: 'WIRE START',
      tip: state.wireDraft.startPoint,
      direction: { x: 1, y: 0 },
    });
  }

  if (state.hoveredPin) drawPinLabel(state.hoveredPin);
}

function setSelectedUI(element) {
  if (!element) {
    ui.selectedWidthU.value = '';
    ui.selectedHeightU.value = '';
    ui.selectedRotation.value = '';
    return;
  }
  ui.selectedWidthU.value = toUnits(element.width);
  ui.selectedHeightU.value = toUnits(element.height);
  ui.selectedRotation.value = Math.round(element.rotation || 0);
}

function selectElement(element) {
  if (!element) {
    state.selected = null;
    setSelectedUI(null);
    return;
  }
  state.selected = { type: 'element', id: element.id };
  setSelectedUI(element);
}

function activateTool(tool) {
  state.activeTool = tool;
  state.wireDraft = null;
  ui.tools.forEach((btn) => btn.classList.toggle('active', btn.dataset.tool === tool));
  redraw();
}

function purgeUnusedNodes() {
  const used = new Set();
  state.connections.forEach((connection) => {
    const from = normalizeEndpoint(connection.from);
    const to = normalizeEndpoint(connection.to);
    if (from && from.kind === 'node') used.add(from.nodeId);
    if (to && to.kind === 'node') used.add(to.nodeId);
  });
  state.nodes = state.nodes.filter((node) => used.has(node.id));
}

function deleteSelected() {
  if (!state.selected) return;

  if (state.selected.type === 'element') {
    const id = state.selected.id;
    state.elements = state.elements.filter((item) => item.id !== id);
    state.connections = state.connections.filter((item) => {
      const from = normalizeEndpoint(item.from);
      const to = normalizeEndpoint(item.to);
      const fromDeleted = from && from.kind === 'pin' && from.elementId === id;
      const toDeleted = to && to.kind === 'pin' && to.elementId === id;
      return !fromDeleted && !toDeleted;
    });
  } else {
    state.connections = state.connections.filter((item) => item.id !== state.selected.id);
  }

  purgeUnusedNodes();
  state.selected = null;
  setSelectedUI(null);
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
    stroke: ui.strokeColor.value,
    fill: ui.fillColor.value,
    lineWidth: Number(ui.lineWidth.value),
  };
  state.elements.push(element);
  selectElement(element);
}

function applyTransformToSelected() {
  if (!state.selected || state.selected.type !== 'element') return;
  const element = state.elements.find((item) => item.id === state.selected.id);
  if (!element) return;

  const widthU = clampU(Number(ui.selectedWidthU.value || toUnits(element.width)));
  const heightU = clampU(Number(ui.selectedHeightU.value || toUnits(element.height)));
  const rotation = Number(ui.selectedRotation.value || 0);

  element.width = toPixels(widthU);
  element.height = toPixels(heightU);
  element.rotation = Number.isFinite(rotation) ? rotation : 0;
  redraw();
}

function updateHoveredPin(pos) {
  const pin = findPinHit(pos.x, pos.y);
  state.hoveredPin = pin ? { ...pin, label: pin.label || pin.id } : null;
}

function tryLoadFromShareLink() {
  const hash = window.location.hash || '';
  if (!hash.startsWith('#d=')) return;

  try {
    const parsed = decodeShareData(hash.slice(3));
    applyLoadedData(parsed);
    resetTransientState();
    redraw();
  } catch {
    window.alert('Could not load drawing from shared link.');
  }
}

function orthogonalizeBend(lastPoint, clickedPoint) {
  const dx = Math.abs(clickedPoint.x - lastPoint.x);
  const dy = Math.abs(clickedPoint.y - lastPoint.y);
  if (dx >= dy) {
    return { x: clickedPoint.x, y: lastPoint.y };
  }
  return { x: lastPoint.x, y: clickedPoint.y };
}

function startWireDraft(resolved) {
  state.wireDraft = {
    start: resolved.endpoint,
    startPoint: resolved.point,
    bends: [],
    cursor: resolved.point,
  };
  state.selected = null;
}

function addWireBend(pos) {
  if (!state.wireDraft) return;
  const anchor =
    state.wireDraft.bends[state.wireDraft.bends.length - 1] || state.wireDraft.startPoint;
  const bend = orthogonalizeBend(anchor, pos);
  if (Math.hypot(bend.x - anchor.x, bend.y - anchor.y) < 2) {
    return;
  }
  state.wireDraft.bends.push(bend);
}

function completeWire(resolvedEnd) {
  if (!state.wireDraft) {
    return;
  }

  const startEndpoint = state.wireDraft.start;
  const endEndpoint = resolvedEnd.endpoint;

  if (endpointEqual(startEndpoint, endEndpoint)) {
    return;
  }

  if (endpointsOnSameElement(startEndpoint, endEndpoint)) {
    window.alert('A pin cannot be wired to another pin on the same device.');
    return;
  }

  const finalAnchor = state.wireDraft.bends[state.wireDraft.bends.length - 1] || state.wireDraft.startPoint;
  const extraBends = ensureOrthogonalToTarget(finalAnchor, resolvedEnd.point);
  const fullPath = compactPath([
    state.wireDraft.startPoint,
    ...state.wireDraft.bends,
    ...extraBends,
    resolvedEnd.point,
  ]);

  const bends = fullPath.slice(1, -1);

  state.connections.push({
    id: uid(),
    from: startEndpoint,
    to: endEndpoint,
    bends,
    color: ui.wireColor.value,
    lineWidth: Number(ui.lineWidth.value),
    typeStyle: ui.wireType.value,
    routeStyle: 'auto',
  });

  state.wireDraft = null;
  redraw();
}

function onPointerDown(event) {
  const pos = getPos(event);
  state.pointerDown = true;

  if (state.activeTool === 'text') {
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
        stroke: ui.strokeColor.value,
        fill: ui.fillColor.value,
        lineWidth: Number(ui.lineWidth.value),
      };
      state.elements.push(element);
      selectElement(element);
    }
    state.pointerDown = false;
    redraw();
    return;
  }

  if (symbolPresets[state.activeTool]) {
    placeSymbol(state.activeTool, pos.x, pos.y);
    state.pointerDown = false;
    redraw();
    return;
  }

  if (state.activeTool === 'wire') {
    const resolved = resolveWireEndpoint(pos);

    if (!state.wireDraft) {
      if (resolved) {
        startWireDraft(resolved);
        state.pointerDown = false;
        redraw();
      } else {
        state.pointerDown = false;
      }
      return;
    }

    if (resolved) {
      completeWire(resolved);
      state.pointerDown = false;
      return;
    }

    addWireBend(pos);
    state.pointerDown = false;
    redraw();
    return;
  }

  if (state.activeTool === 'select') {
    const pickedElement = pickElement(pos.x, pos.y);
    if (pickedElement) {
      selectElement(pickedElement);
      state.dragOffsetX = pos.x;
      state.dragOffsetY = pos.y;
      redraw();
      return;
    }

    const pickedConnection = pickConnection(pos.x, pos.y);
    if (pickedConnection) {
      state.selected = { type: 'connection', id: pickedConnection.id };
      setSelectedUI(null);
      state.pointerDown = false;
      redraw();
      return;
    }

    selectElement(null);
    state.pointerDown = false;
    redraw();
    return;
  }

  if (state.activeTool === 'rect') {
    state.draftShape = {
      id: uid(),
      type: 'rect',
      x: pos.x,
      y: pos.y,
      width: 1,
      height: 1,
      rotation: 0,
      stroke: ui.strokeColor.value,
      fill: ui.fillColor.value,
      lineWidth: Number(ui.lineWidth.value),
    };
    redraw();
  }
}

function onPointerMove(event) {
  const pos = getPos(event);
  updateHoveredPin(pos);

  if (state.wireDraft) {
    const anchor = state.wireDraft.bends[state.wireDraft.bends.length - 1] || state.wireDraft.startPoint;
    state.wireDraft.cursor = orthogonalizeBend(anchor, pos);
  }

  if (!state.pointerDown) {
    redraw();
    return;
  }

  if (state.activeTool === 'select' && state.selected && state.selected.type === 'element') {
    const element = state.elements.find((item) => item.id === state.selected.id);
    if (!element) return;
    const dx = pos.x - state.dragOffsetX;
    const dy = pos.y - state.dragOffsetY;
    element.x += dx;
    element.y += dy;
    state.dragOffsetX = pos.x;
    state.dragOffsetY = pos.y;
    redraw();
    return;
  }

  if (state.activeTool === 'rect' && state.draftShape) {
    state.draftShape.width = pos.x - state.draftShape.x;
    state.draftShape.height = pos.y - state.draftShape.y;
    redraw();
  }
}

function onPointerUp() {
  state.pointerDown = false;

  if (state.draftShape) {
    if (Math.abs(state.draftShape.width) > 2 && Math.abs(state.draftShape.height) > 2) {
      if (state.draftShape.width < 0) {
        state.draftShape.x += state.draftShape.width;
        state.draftShape.width = Math.abs(state.draftShape.width);
      }
      if (state.draftShape.height < 0) {
        state.draftShape.y += state.draftShape.height;
        state.draftShape.height = Math.abs(state.draftShape.height);
      }
      state.elements.push(state.draftShape);
      selectElement(state.draftShape);
    }
    state.draftShape = null;
  }

  redraw();
}

function onPointerLeave() {
  state.pointerDown = false;
  state.hoveredPin = null;
  redraw();
}

function clearAll() {
  if (!window.confirm('Clear current drawing?')) return;
  state.elements = [];
  state.nodes = [];
  state.connections = [];
  resetTransientState();
  redraw();
}

function saveJson() {
  const blob = new Blob([JSON.stringify(buildPayload(), null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `rack-whirring-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

async function loadJson(event) {
  const [file] = event.target.files;
  if (!file) return;

  try {
    applyLoadedData(JSON.parse(await file.text()));
    resetTransientState();
    redraw();
  } catch (error) {
    window.alert(`Could not load file: ${error.message}`);
  } finally {
    event.target.value = '';
  }
}

function exportPng() {
  redraw();
  const url = canvas.toDataURL('image/png');
  const link = document.createElement('a');
  link.href = url;
  link.download = `rack-whirring-${new Date().toISOString().slice(0, 10)}.png`;
  link.click();
}

async function shareLink() {
  try {
    const encoded = encodeShareData(buildPayload());
    const baseUrl = `${window.location.origin}${window.location.pathname}`;
    const link = `${baseUrl}#d=${encoded}`;

    if (link.length > 18000) {
      window.alert(
        'This drawing is too large for a URL link. Please use Save JSON instead.',
      );
      return;
    }

    await navigator.clipboard.writeText(link);
    window.alert('Share link copied to clipboard.');
  } catch {
    const fallback = `${window.location.href.split('#')[0]}#d=${encodeShareData(
      buildPayload(),
    )}`;
    window.prompt('Copy this share link:', fallback);
  }
}

function bindEvents() {
  ui.tools.forEach((btn) =>
    btn.addEventListener('click', () => activateTool(btn.dataset.tool)),
  );

  ui.lineWidth.addEventListener('input', () => {
    ui.lineWidthValue.textContent = `${ui.lineWidth.value} px`;
  });

  ui.applyTransform.addEventListener('click', applyTransformToSelected);
  ui.deleteSelected.addEventListener('click', deleteSelected);
  ui.newBtn.addEventListener('click', clearAll);
  ui.saveJson.addEventListener('click', saveJson);
  ui.loadJson.addEventListener('change', loadJson);
  ui.exportPng.addEventListener('click', exportPng);
  ui.shareLink.addEventListener('click', shareLink);

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointerleave', onPointerLeave);

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Delete' || event.key === 'Backspace') {
      deleteSelected();
      return;
    }
    if (event.key === 'Escape' && state.wireDraft) {
      state.wireDraft = null;
      redraw();
    }
  });
}

bindEvents();
tryLoadFromShareLink();
redraw();
